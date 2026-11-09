/**
 * Shared Stripe Checkout → Firestore payment doc + company plan upgrade (webhook + browser sync fallback).
 */
import "server-only";
import Stripe from "stripe";
import type admin from "@/lib/server/pbAdminTypes";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";
import { mergeGatewayKeysWithEnv, type GatewayKeys } from "@/ai/flows/gateway-keys";
import { serverDb } from "@/lib/server/appDb";
import { applyPlanChangeOneTimeToFirestore } from "@/lib/payments/planChangeApply";
import {
  applyAddonPurchaseToFirestore,
  parseAddonItemsFromCheckoutMetadata,
} from "@/lib/payments/addonCheckoutApply";
import { findOwnedCompanyIdForUser } from "@/lib/payments/resolveStripeFirestoreCompany";
import { grantAccountCanonicalPlan } from "@/lib/server/accountCanonicalPlan";
import { mirrorSubscriptionPaymentWithUserLookup } from "@/lib/adminPanelAccounting/mirrorSubscriptionPayment";
import type { VerifiedLocalPlanApplyPayload } from "@/lib/payments/localStripePlanApplyTypes";
import {
  SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT,
  termDurationMs,
  type SubscriptionTermKey,
} from "@/lib/subscriptionPlanMath";

import { serverTimestamp, Timestamp } from "@/lib/server/pbBilling/fieldValue";

/** Paid SKUs only; basic stays free and is not granted via checkout. */
export const PAID_PLAN_IDS = new Set<PlanId>(["advance", "pro", "pro-plus"]);

// Purane Stripe metadata (`year_2`…) ab bhi parse — initiate route ke saath same set.
const VALID_SUBSCRIPTION_TERM_KEYS = SUBSCRIPTION_TERM_KEYS_FOR_CHECKOUT;

/**
 * Sirf env — scripts / quick checks. API routes ko `getStripeForPaymentsMerged` use karna chahiye:
 * `/api/payments/initiate` Bank Settings (Firestore) se key leta hai; agar webhook/sync sirf env use kare to
 * galat account pe `sessions.retrieve` / `subscriptions.retrieve` → planId update ho jata hai lekin planExpiry null.
 */
export function getStripeForPayments(): Stripe {
  const secretKey =
    process.env.STRIPE_SECRET_KEY?.trim() ||
    (process.env.NODE_ENV === "development"
      ? process.env.STRIPE_TEST_SECRET_KEY?.trim()
      : undefined);
  if (!secretKey) {
    throw new Error(
      process.env.NODE_ENV === "development"
        ? "Stripe server key missing: set STRIPE_SECRET_KEY or STRIPE_TEST_SECRET_KEY in .env.local, then restart dev."
        : "STRIPE_SECRET_KEY is not configured"
    );
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-12-15.clover" as any,
  });
}

/** `/api/payments/initiate` jaisa: `app_settings/payment_gateways` + env merge — checkout jis account pe bana usi se fulfill. */
export async function getStripeForPaymentsMerged(): Promise<Stripe> {
  let stored: GatewayKeys = {};
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    if (snap.exists) stored = (snap.data() as GatewayKeys) || {};
  } catch {
    /* Firebase Admin na ho / read fail — sirf env */
  }
  const keys = mergeGatewayKeysWithEnv(stored);
  const secretKey = keys.stripeSecretKey?.trim();
  if (!secretKey) {
    throw new Error(
      process.env.NODE_ENV === "development"
        ? "Stripe server key missing: Admin → Bank Settings me secret save karo, ya STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY .env.local me."
        : "Stripe is not configured (Bank Settings or STRIPE_SECRET_KEY)"
    );
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-12-15.clover" as any,
  });
}

/** Subscription `current_period_end` na mile to checkout metadata `subscriptionTermKey` se approximate end (pehli subscribe par N/A se bachao). */
function planExpiryMsFallbackFromCheckoutMetadata(
  metadata: Record<string, string | null | undefined>
): number | null {
  const raw = typeof metadata.subscriptionTermKey === "string" ? metadata.subscriptionTermKey.trim() : "";
  if (!raw || !VALID_SUBSCRIPTION_TERM_KEYS.has(raw as SubscriptionTermKey)) return null;
  return Date.now() + termDurationMs(raw as SubscriptionTermKey);
}

function subscriptionPeriodEndMs(sub: unknown): number | null {
  const end = (sub as { current_period_end?: number })?.current_period_end;
  return typeof end === "number" ? end * 1000 : null;
}

/** Successful retrieve jisme `current_period_end` mila — webhook metadata + expiry ek hi loop se. */
export type StripeSubscriptionPeriodResult = {
  subscription: Stripe.Subscription;
  endMs: number;
};

/**
 * Pehli subscription par Stripe kabhi `current_period_end` ek tick baad populate karta hai —
 * checkout.session.completed jaldi aaye to null; retry + invoice.paid subscription_create se patch.
 */
export async function getSubscriptionWithPeriodEndRetry(
  stripe: Stripe,
  subscriptionId: string,
  opts?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<StripeSubscriptionPeriodResult | null> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const endMs = subscriptionPeriodEndMs(subscription);
      if (endMs != null) return { subscription, endMs };
    } catch (e) {
      console.warn("[stripe] subscription retrieve for period end", { attempt, subscriptionId, e });
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  return null;
}

export async function getSubscriptionCurrentPeriodEndMs(
  stripe: Stripe,
  subscriptionId: string,
  opts?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<number | null> {
  const r = await getSubscriptionWithPeriodEndRetry(stripe, subscriptionId, opts);
  return r?.endMs ?? null;
}

/**
 * Whether company doc should get planId/planExpiry after checkout.session.completed.
 * payment_status alone can lag for subscription mode; then we trust subscription status.
 */
export async function shouldUpgradeCompanyAfterCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  planId: string | undefined,
  billingIntent: string | undefined
): Promise<boolean> {
  if (billingIntent === "donation") return false;
  if (!planId) return false;
  if (!PAID_PLAN_IDS.has(planId as PlanId)) return false;

  const ps = session.payment_status;
  if (ps === "paid" || ps === "no_payment_required") return true;

  const subRef = session.subscription;
  const subId = typeof subRef === "string" ? subRef : subRef?.id;
  if (session.mode !== "subscription" || !subId) return false;

  const sub = await stripe.subscriptions.retrieve(subId);
  const st = sub.status;
  return st === "active" || st === "trialing";
}

export type StripeCheckoutFulfillResult =
  | { ok: true; mirrorLocal?: VerifiedLocalPlanApplyPayload }
  | { ok: false; reason: string };

/**
 * One-time Stripe Checkout (`mode: payment`) after prorated plan math — metadata written by `/api/payments/plan-change-checkout`.
 */
async function fulfillPlanChangeOneTimePayment(
  session: Stripe.Checkout.Session,
  db: admin.firestore.Firestore
): Promise<StripeCheckoutFulfillResult> {
  const metadata = session.metadata || {};
  const companyId = metadata.companyId?.trim();
  const userId = metadata.userId?.trim();
  const targetPlanId = metadata.targetPlanId?.trim();
  const previousPlanId = metadata.previousPlanId?.trim() ?? "";

  if (!companyId) return { ok: false as const, reason: "missing_companyId" };
  // Metadata company local-only ho to Firestore me owner ki pehli / preferred company par apply karo.
  let effectiveCompanyId = companyId;
  if (!(await db.collection("companies").doc(companyId).get()).exists && userId?.trim()) {
    const resolved = await findOwnedCompanyIdForUser(db, userId.trim(), companyId);
    if (resolved) effectiveCompanyId = resolved;
  }
  if (!targetPlanId || !PAID_PLAN_IDS.has(targetPlanId as PlanId)) {
    return { ok: false as const, reason: "invalid_targetPlanId" };
  }

  const ps = session.payment_status;
  if (ps !== "paid" && ps !== "no_payment_required") {
    return { ok: false as const, reason: "payment_not_complete" };
  }

  const netFromMeta = Number(metadata.netNpr ?? "");
  const expectedPaisa = Number.isFinite(netFromMeta) ? Math.round(netFromMeta * 100) : null;
  const actualPaisa =
    session.amount_total != null && typeof session.amount_total === "number" ? session.amount_total : null;
  // Guard against tampered metadata vs charged amount (tolerate rounding).
  if (expectedPaisa != null && actualPaisa != null && Math.abs(expectedPaisa - actualPaisa) > 2) {
    console.warn("[stripe fulfill] plan-change amount mismatch", { expectedPaisa, actualPaisa, sessionId: session.id });
    return { ok: false as const, reason: "amount_mismatch" };
  }

  const newPlanExpiryMs = Number(metadata.newPlanExpiryMs ?? "");
  if (!Number.isFinite(newPlanExpiryMs) || newPlanExpiryMs <= 0) {
    return { ok: false as const, reason: "invalid_newPlanExpiryMs" };
  }

  const prevExpMsRaw = metadata.previousPlanExpiryMs;
  const previousPlanExpiryMs =
    prevExpMsRaw != null && prevExpMsRaw !== "" ? Number(prevExpMsRaw) : null;

  const planChangeHistory = {
    oldPlanId: previousPlanId || null,
    newPlanId: targetPlanId,
    oldExpiryMs: previousPlanExpiryMs != null && Number.isFinite(previousPlanExpiryMs) ? previousPlanExpiryMs : null,
    newExpiryMs: newPlanExpiryMs,
    oldDaysLeft:
      metadata.previousDaysLeft != null && metadata.previousDaysLeft !== ""
        ? Number(metadata.previousDaysLeft)
        : null,
    newDaysLeft: metadata.newDaysLeft != null && metadata.newDaysLeft !== "" ? Number(metadata.newDaysLeft) : null,
    grossNpr: metadata.grossNpr != null && metadata.grossNpr !== "" ? Number(metadata.grossNpr) : null,
    creditNpr: metadata.creditNpr != null && metadata.creditNpr !== "" ? Number(metadata.creditNpr) : null,
    netNpr: metadata.netNpr != null && metadata.netNpr !== "" ? Number(metadata.netNpr) : null,
    termKey: metadata.termKey?.trim() || null,
    changeKind: metadata.changeKind?.trim() || null,
  };

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  const applied = await applyPlanChangeOneTimeToFirestore({
    db,
    companyId: effectiveCompanyId,
    userId: userId || null,
    paymentId: session.id,
    gateway: "stripe",
    amountNpr: session.amount_total != null ? session.amount_total / 100 : 0,
    currency: session.currency || "npr",
    targetPlanId: targetPlanId as PlanId,
    previousPlanId: previousPlanId || null,
    planChangeHistory,
    newPlanExpiryMs,
    paymentStatus: session.payment_status,
    stripeCustomerId,
    stripeSessionId: session.id,
    historyExtra: { stripeSessionId: session.id },
    historySource: "stripe_plan_change",
  });

  if (applied.ok === false) {
    return { ok: false as const, reason: applied.reason };
  }
  // Firestore update ho chuka — browser me SQLite / profile abhi Basic reh sakta tha; client isi payload se align karega
  const mirrorUid = userId?.trim();
  if (!mirrorUid) return { ok: true as const };
  return {
    ok: true as const,
    mirrorLocal: {
      companyId: metadata.companyId?.trim() || effectiveCompanyId,
      authoritativeCompanyId: effectiveCompanyId,
      planId: targetPlanId,
      userId: mirrorUid,
      planExpiryMs: newPlanExpiryMs,
      stripeCustomerId,
      stripeSubscriptionId: null,
      lastStripeCheckoutSessionId: session.id,
      source: "plan_change",
    },
  };
}

/**
 * Idempotent: merge payment doc; always re-run upgrade check (handles webhook retry after payment write only).
 */
export async function fulfillStripeCheckoutSessionCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  db: admin.firestore.Firestore
): Promise<StripeCheckoutFulfillResult> {
  const metadata = session.metadata || {};

  // Prorated upgrades/renews use Checkout `mode: payment` + metadata.planChange (not subscription mode).
  if (session.mode === "payment" && metadata.planChange === "true") {
    return fulfillPlanChangeOneTimePayment(session, db);
  }

  // Device/user add-ons — one-time payment; do not change planId.
  if (session.mode === "payment" && metadata.addonPurchase === "true") {
    const companyId = metadata.companyId?.trim() || "";
    const userId = metadata.userId?.trim() || "";
    const items = parseAddonItemsFromCheckoutMetadata(metadata);
    const applied = await applyAddonPurchaseToFirestore({
      db,
      companyId,
      userId,
      paymentId: session.id,
      gateway: "stripe",
      amount: session.amount_total != null ? session.amount_total / 100 : 0,
      currency: session.currency || "npr",
      items,
    });
    if (applied.ok === false) {
      return { ok: false as const, reason: applied.reason };
    }
    return { ok: true as const };
  }

  const companyId = metadata.companyId?.trim();
  const planId = metadata.planId?.trim();
  const userId = metadata.userId?.trim();
  const billingIntent = (metadata.billingIntent?.trim() || "subscribe") as "donation" | "subscribe";

  if (!companyId) {
    if (!userId || !planId || !PAID_PLAN_IDS.has(planId as PlanId)) {
      return { ok: false as const, reason: "missing_account_subscription_metadata" };
    }
    const upgrade = await shouldUpgradeCompanyAfterCheckout(stripe, session, planId, billingIntent);
    if (!upgrade) return { ok: true as const };

    const stripeCustomerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const stripeSubscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    let planExpiryMs: number | null = null;
    if (session.mode === "subscription" && stripeSubscriptionId) {
      planExpiryMs = await getSubscriptionCurrentPeriodEndMs(stripe, stripeSubscriptionId);
    }
    planExpiryMs ??= planExpiryMsFallbackFromCheckoutMetadata(metadata);
    if (planExpiryMs == null) return { ok: false as const, reason: "missing_plan_expiry" };

    const tierSwitchMs = Date.now();
    await grantAccountCanonicalPlan(
      db,
      userId,
      {
        planId: normalizePlanIdForClient(planId),
        planExpiryMs,
        planUpgradedAtMs: tierSwitchMs,
        stripeCustomerId,
        stripeSubscriptionId,
      },
      `stripe_subscribe:${session.id}`
    );
    await db.collection("users").doc(userId).collection("billing_payments").doc(session.id).set(
      {
        paymentId: session.id,
        planId,
        amount: session.amount_total != null ? session.amount_total / 100 : 0,
        currency: session.currency || "usd",
        gateway: "stripe",
        status: session.payment_status,
        billingIntent,
        stripeCustomerId,
        stripeSubscriptionId,
        planExpiryMs,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    await mirrorSubscriptionPaymentWithUserLookup(db, {
      paymentId: session.id,
      userId,
      amountNpr: session.amount_total != null ? session.amount_total / 100 : 0,
      gateway: "stripe",
      planId,
      customerCompanyId: null,
      customerCompanyName: null,
      subscriptionTermKey:
        typeof metadata.subscriptionTermKey === "string" ? metadata.subscriptionTermKey : null,
    });
    return { ok: true as const };
  }

  // `companyId` checkout pe selected ho sakta hai lekin sirf local SQLite me — Firestore me owner ki company resolve karo.
  const primaryCoRef = db.collection("companies").doc(companyId);
  const primaryCoSnap = await primaryCoRef.get();
  let effectiveCompanyId = companyId;
  let companySnap = primaryCoSnap;
  if (!primaryCoSnap.exists && userId?.trim()) {
    const resolved = await findOwnedCompanyIdForUser(db, userId.trim(), companyId);
    if (resolved) {
      effectiveCompanyId = resolved;
      companySnap = await db.collection("companies").doc(resolved).get();
    }
  }

  const paymentRef = db
    .collection("companies")
    .doc(effectiveCompanyId)
    .collection("payments")
    .doc(session.id);

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  // Persist period end on the payment doc so admin/history shows per-checkout expiry (company.planExpiry is latest only).
  let planExpiryMs: number | null = null;
  if (session.mode === "subscription" && stripeSubscriptionId) {
    planExpiryMs = await getSubscriptionCurrentPeriodEndMs(stripe, stripeSubscriptionId);
    if (planExpiryMs == null) {
      console.warn("[stripe fulfill] planExpiryMs still null after retries", { sessionId: session.id, stripeSubscriptionId });
      planExpiryMs = planExpiryMsFallbackFromCheckoutMetadata(metadata);
      if (planExpiryMs != null) {
        console.warn("[stripe fulfill] planExpiryMs from checkout metadata term (fallback)", {
          sessionId: session.id,
          subscriptionTermKey: metadata.subscriptionTermKey,
        });
      }
    }
  }

  // merge: safe for duplicate webhook / sync retries without clobbering fields
  await paymentRef.set(
    {
      paymentId: session.id,
      userId: userId || null,
      planId: planId || null,
      amount: session.amount_total != null ? session.amount_total / 100 : 0,
      currency: session.currency || "usd",
      gateway: "stripe",
      status: session.payment_status,
      stripeCustomerId,
      stripeSubscriptionId,
      billingIntent,
      ...(planExpiryMs != null ? { planExpiryMs } : {}),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  const upgrade = await shouldUpgradeCompanyAfterCheckout(stripe, session, planId, billingIntent);
  if (!upgrade) {
    if (planId && PAID_PLAN_IDS.has(planId as PlanId) && billingIntent !== "donation") {
      console.warn("[stripe fulfill] skipped plan upgrade", {
        sessionId: session.id,
        payment_status: session.payment_status,
        mode: session.mode,
        planId,
      });
    }
    return { ok: true as const };
  }

  const planExpiry: admin.firestore.Timestamp | null =
    planExpiryMs != null ? Timestamp.fromMillis(planExpiryMs) as unknown as admin.firestore.Timestamp : null;

  const companyRef = db.collection("companies").doc(effectiveCompanyId);
  if (!companySnap.exists) {
    console.error("[stripe fulfill] company not found:", effectiveCompanyId, "metadata was", companyId);
    return { ok: false as const, reason: "company_not_found" };
  }

  const coData = companySnap.data() as { ownerId?: string } | undefined;
  const ownerId = String(coData?.ownerId ?? userId ?? "").trim();
  const tierSwitchMs = Date.now();
  const patch: Record<string, unknown> = {
    planId,
    lastStripeCheckoutSessionId: session.id,
    planUpgradedAt: Timestamp.fromMillis(tierSwitchMs),
    planUpgradedAtMs: tierSwitchMs,
  };
  if (planExpiry) {
    patch.planExpiry = planExpiry;
    // Client sync / billing `planExpiryMs` path — Timestamp ke saath numeric bhi taaki SQLite mirror align rahe.
    if (planExpiryMs != null) patch.planExpiryMs = planExpiryMs;
  }
  if (stripeCustomerId) patch.stripeCustomerId = stripeCustomerId;
  if (stripeSubscriptionId) patch.stripeSubscriptionId = stripeSubscriptionId;

  if (ownerId) {
    if (planId && PAID_PLAN_IDS.has(planId as PlanId)) {
      const pid = normalizePlanIdForClient(planId);
      const expiryCanon = planExpiryMs ?? (planExpiry ? planExpiry.toMillis() : null);
      await grantAccountCanonicalPlan(db, ownerId, {
        planId: pid,
        planExpiryMs: expiryCanon,
        planUpgradedAtMs: tierSwitchMs,
        stripeCustomerId: stripeCustomerId ?? null,
        stripeSubscriptionId: stripeSubscriptionId ?? null,
      }, `stripe_subscribe:${session.id}`);
    }
  } else {
    await companyRef.update(patch);
  }

  if (planId && PAID_PLAN_IDS.has(planId as PlanId)) {
    const coDataFull = companySnap.data() as Record<string, unknown> | undefined;
    await mirrorSubscriptionPaymentWithUserLookup(db, {
      paymentId: session.id,
      userId: userId || ownerId || null,
      amountNpr: session.amount_total != null ? session.amount_total / 100 : 0,
      gateway: "stripe",
      planId,
      customerCompanyId: effectiveCompanyId,
      customerCompanyName: String(coDataFull?.name ?? coDataFull?.companyName ?? "").trim() || null,
      subscriptionTermKey:
        typeof metadata.subscriptionTermKey === "string" ? metadata.subscriptionTermKey : null,
    });
  }

  const planExpiryMsForMirror = planExpiryMs ?? (planExpiry ? planExpiry.toMillis() : null);
  const mirrorUid = userId?.trim();
  let mirrorLocal: VerifiedLocalPlanApplyPayload | undefined;
  if (mirrorUid && planId && planExpiryMsForMirror != null) {
    mirrorLocal = {
      companyId: metadata.companyId?.trim() || effectiveCompanyId,
      authoritativeCompanyId: effectiveCompanyId,
      planId,
      userId: mirrorUid,
      planExpiryMs: planExpiryMsForMirror,
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      lastStripeCheckoutSessionId: session.id,
      source: "subscription",
    };
  }
  return { ok: true as const, mirrorLocal };
}

/**
 * Firestore me `companies/{companyId}` na ho (offline/local-only) lekin Stripe payment verified ho —
 * client local SQLite registry me plan apply kar sake; sirf tab return jab session + metadata valid hon.
 */
export async function buildVerifiedLocalPlanApplyPayload(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<VerifiedLocalPlanApplyPayload | null> {
  const metadata = session.metadata || {};
  const companyId = metadata.companyId?.trim();
  const userId = metadata.userId?.trim();
  if (!companyId || !userId) return null;

  if (session.mode === "payment" && metadata.planChange === "true") {
    const targetPlanId = metadata.targetPlanId?.trim();
    const newPlanExpiryMs = Number(metadata.newPlanExpiryMs ?? "");
    if (!targetPlanId || !PAID_PLAN_IDS.has(targetPlanId as PlanId)) return null;
    if (!Number.isFinite(newPlanExpiryMs) || newPlanExpiryMs <= 0) return null;
    const ps = session.payment_status;
    if (ps !== "paid" && ps !== "no_payment_required") return null;
    const stripeCustomerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    return {
      companyId,
      planId: targetPlanId,
      userId,
      planExpiryMs: newPlanExpiryMs,
      stripeCustomerId,
      stripeSubscriptionId: null,
      lastStripeCheckoutSessionId: session.id,
      source: "plan_change",
    };
  }

  const planId = metadata.planId?.trim();
  const billingIntent = (metadata.billingIntent?.trim() || "subscribe") as "donation" | "subscribe";
  if (!planId || billingIntent === "donation") return null;
  const upgrade = await shouldUpgradeCompanyAfterCheckout(stripe, session, planId, billingIntent);
  if (!upgrade) return null;

  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  let planExpiryMs: number | null = null;
  if (session.mode === "subscription" && stripeSubscriptionId) {
    planExpiryMs = await getSubscriptionCurrentPeriodEndMs(stripe, stripeSubscriptionId);
    if (planExpiryMs == null) {
      planExpiryMs = planExpiryMsFallbackFromCheckoutMetadata(metadata);
    }
  }
  if (planExpiryMs == null) return null;

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  return {
    companyId,
    planId,
    userId,
    planExpiryMs,
    stripeCustomerId,
    stripeSubscriptionId,
    lastStripeCheckoutSessionId: session.id,
    source: "subscription",
  };
}
