import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import type admin from "@/lib/server/pbAdminTypes";

import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import {
  getEsewaEpayV2FormUrl,
  isBillingGatewayAvailable,
  mergeGatewayKeysWithEnv,
  parseGatewayPaymentFlags,
  type GatewayKeys,
} from "@/ai/flows/gateway-keys";
import { serverDb } from "@/lib/server/appDb";
import { DEFAULT_PLANS, type PlanId, normalizePlanIdForClient } from "@/config/plans";
import {
  buildMergedFrozenStateAfterPaidUpgrade,
  resolveCompanyPlanTierStartedAtMs,
} from "@/lib/billingFrozenPlanSnapshots";
import { getEffectivePlanPricesForRegion } from "@/lib/server/getEffectivePlanPrices";
import type { BillingRegionId } from "@/lib/billingRegions";
import { billingCurrencyToGatewayCode, currencyMinorUnitFactor } from "@/lib/billingRegions";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import {
  classifyPlanChange,
  quotePaidPlanPurchase,
  daysLeftRounded,
  SUBSCRIPTION_TERM_KEYS_FOR_PLAN_CHANGE,
  type SubscriptionTermKey,
} from "@/lib/subscriptionPlanMath";
import { PAID_PLAN_IDS } from "@/lib/payments/stripeCheckoutFulfill";
import { syncCompanyPlanExpiryFromStripe } from "@/lib/payments/syncCompanyPlanExpiryFromStripe";
import {
  PENDING_PLAN_CHANGES_COLLECTION,
  PENDING_PLAN_CHANGE_TTL_MS,
} from "@/lib/payments/planChangeApply";
import { getPublicAppHrefForPaymentRedirects } from "@/lib/checkoutPublicOrigin";
import { applyOwnerPlanMirrorBatched } from "@/lib/server/mirrorOwnerCompanyPlanBilling";
import { persistAccountCanonicalPlanDoc } from "@/lib/server/accountCanonicalPlan";
import { resolveBillingCaller } from "@/lib/server/billingCaller";

import { serverTimestamp, Timestamp } from "@/lib/server/pbBilling/fieldValue";

type AdminKeysResult = {
  stored: GatewayKeys;
  adminReadOk: boolean;
  docExists: boolean;
  adminError?: string;
};

async function getGatewayKeysFromAdmin(): Promise<AdminKeysResult> {
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/payment_gateways").get();
    return {
      stored: (snap.exists ? (snap.data() as GatewayKeys) : {}) as GatewayKeys,
      adminReadOk: true,
      docExists: snap.exists,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[plan-change-checkout] gateway read failed", e);
    return { stored: {}, adminReadOk: false, docExists: false, adminError: msg };
  }
}

function hasStripeInEnv(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_TEST_SECRET_KEY?.trim());
}

function stripeConfigHelpMessage(adminResult: AdminKeysResult): string {
  const envHint = hasStripeInEnv()
    ? "STRIPE_SECRET_KEY is set but empty after merge — restart dev/server after editing .env.local."
    : "Add STRIPE_SECRET_KEY=sk_test_… to .env.local, then restart dev.";

  if (!adminResult.adminReadOk) {
    return `Stripe unavailable (Admin SDK). ${adminResult.adminError || ""} ${envHint}`;
  }
  if (!adminResult.docExists) {
    return `Save Stripe secret in Admin → Bank Settings. ${envHint}`;
  }
  if (!adminResult.stored.stripeSecretKey?.trim()) {
    return `Bank Settings: paste Stripe secret. ${envHint}`;
  }
  return `Stripe not configured. ${envHint}`;
}

// `plan_change_only`: paid→paid upgrade / renew-style zero net; paid **downgrade** sirf `/api/company/downgrade-plan`.
// Legacy multi-year keys: pending docs / old client — server par accept, naye UI dropdown me nahi.
const VALID_TERMS = SUBSCRIPTION_TERM_KEYS_FOR_PLAN_CHANGE;

type ProrationGateway = "stripe" | "khalti" | "esewa";

type Body = {
  companyId?: string;
  targetPlanId?: PlanId;
  term?: SubscriptionTermKey;
  /** Defaults to stripe; Khalti/eSewa use pending_plan_changes + `/api/payments/complete-plan-change-*`. */
  gateway?: ProrationGateway;
  billingRegion?: BillingRegionId;
  /** Full term price; purchased days stack on current plan end (no unused-time credit). */
  stackOnExpiry?: boolean;
};

function normalizeProrationGateway(raw: unknown): ProrationGateway {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "stripe";
  if (s === "khalti" || s === "esewa" || s === "stripe") return s;
  return "stripe";
}

/**
 * Prorated Stripe one-time checkout: credit unused time at current yearly rate, charge net NPR, extend planExpiry.
 * Zero net applies Firestore + audit payment row immediately (no Stripe session).
 */
export async function POST(req: NextRequest) {
  try {
    const billingCaller = await resolveBillingCaller(req);
    if (!billingCaller.ok) {
      return NextResponse.json({ error: billingCaller.error }, { status: billingCaller.status });
    }
    const decoded = billingCaller.decoded;

    const body = (await req.json()) as Body;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    const targetPlanId = body.targetPlanId;
    const term = body.term;
    const gateway = normalizeProrationGateway(body.gateway);

    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }
    if (!targetPlanId || !PAID_PLAN_IDS.has(targetPlanId)) {
      return NextResponse.json({ error: "Invalid paid targetPlanId" }, { status: 400 });
    }
    if (!term || !VALID_TERMS.has(term)) {
      return NextResponse.json({ error: "Invalid subscription term" }, { status: 400 });
    }

    const db = billingCaller.db;
    const companyRef = db.collection("companies").doc(companyId);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const cdata = companySnap.data() as {
      ownerId?: string;
      ownerEmail?: string;
      planId?: string;
      planExpiry?: admin.firestore.Timestamp;
      planExpiryMs?: number;
      /** Chhoota hua tier par kitna din/NPR — frozen pill ramp (pre-upgrade snapshot). */
      planUpgradedAt?: admin.firestore.Timestamp;
      planUpgradedAtMs?: number;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      billingFrozenUsageLedger?: unknown;
      billingBlockedDowngradePlanIds?: unknown;
    };
    if (!isCompanyOwner(decoded, cdata)) {
      return NextResponse.json({ error: "Only the company owner can change plans" }, { status: 403 });
    }

    const currentPlanId = normalizePlanIdForClient(cdata.planId != null ? String(cdata.planId) : undefined);
    // One-time proration builds on an active paid SKU; Basic → paid stays on recurring `/api/payments/initiate`.
    if (currentPlanId === "basic" || !PAID_PLAN_IDS.has(currentPlanId)) {
      return NextResponse.json(
        {
          error:
            "New subscriptions from Basic use the checkout below (recurring). Proration applies after you are on a paid plan.",
        },
        { status: 400 }
      );
    }
    const changeKind = classifyPlanChange(currentPlanId, targetPlanId);
    // Paid→paid **downgrade**: UI sirf "Downgrade" button — value → cheap tier par zyada din; `plan_change_only` neeche band.
    if (changeKind === "downgrade" && term === "plan_change_only") {
      return NextResponse.json(
        {
          error:
            "To move down a paid tier, use the Downgrade button in that plan’s column. It converts your remaining subscription value into days at the lower plan’s yearly rate. “Just change plan” is only for moving up a tier without payment.",
        },
        { status: 400 }
      );
    }
    if (changeKind === "downgrade" && term !== "plan_change_only") {
      return NextResponse.json(
        {
          error:
            "Lower paid tiers use the Downgrade button. This checkout is for renewals and upgrades only.",
        },
        { status: 400 }
      );
    }

    const adminGwGate = await getGatewayKeysFromAdmin();
    const keysGate = mergeGatewayKeysWithEnv(adminGwGate.stored);
    const paymentFlagsGate = parseGatewayPaymentFlags(adminGwGate.stored as Record<string, unknown>);
    if (!isBillingGatewayAvailable(gateway, keysGate, paymentFlagsGate)) {
      return NextResponse.json(
        { error: "This payment method is disabled or not configured.", code: "gateway_disabled" },
        { status: 403 }
      );
    }

    const nowMs = Date.now();
    // Pehla subscription Firestore par planExpiry likh na chhoot jaye to proration "abhi se" maan leta hai — Stripe period se backfill.
    let currentExpiryMs = cdata.planExpiry?.toMillis?.() ?? null;
    if (currentExpiryMs == null && typeof cdata.planExpiryMs === "number" && Number.isFinite(cdata.planExpiryMs)) {
      currentExpiryMs = cdata.planExpiryMs;
    }
    const stripeSubId = typeof cdata.stripeSubscriptionId === "string" ? cdata.stripeSubscriptionId.trim() : "";
    if (currentExpiryMs == null && stripeSubId) {
      const adminResult = await getGatewayKeysFromAdmin();
      const keys = mergeGatewayKeysWithEnv(adminResult.stored);
      const sk = keys.stripeSecretKey?.trim();
      if (sk) {
        const stripeForRepair = new Stripe(sk, { apiVersion: "2025-12-15.clover" as any });
        const repairedMs = await syncCompanyPlanExpiryFromStripe({
          companyRef,
          stripeSubscriptionId: stripeSubId,
          stripe: stripeForRepair,
        });
        if (repairedMs != null) {
          currentExpiryMs = repairedMs;
          console.info("[plan-change-checkout] planExpiry backfilled from Stripe before quote", { companyId });
        }
      }
    }
    const billingRegion: BillingRegionId =
      body.billingRegion === "saarc" || body.billingRegion === "international"
        ? body.billingRegion
        : "nepal";
    const curPrices = await getEffectivePlanPricesForRegion(currentPlanId, billingRegion);
    const tgtPrices = await getEffectivePlanPricesForRegion(targetPlanId, billingRegion);
    const checkoutCurrency = billingCurrencyToGatewayCode(tgtPrices.currency);
    const minorFactor = currencyMinorUnitFactor(tgtPrices.currency);

    if (term === "plan_change_only") {
      if (currentExpiryMs == null || currentExpiryMs <= nowMs) {
        return NextResponse.json(
          { error: "Just change plan needs an active paid subscription with a future expiry date." },
          { status: 400 }
        );
      }
    }

    // Paid term renew/upgrade: always stack full list price on current end date.
    // Do not trust client `stackOnExpiry` alone — missing flag used to apply unused-time credit
    // and silently zero-net (no Stripe, no Admin Panel payment) when balance ≫ term price.
    const stackOnExpiry = term !== "plan_change_only";
    const quote = quotePaidPlanPurchase({
      nowMs,
      currentExpiryMs,
      currentYearly: curPrices.yearly,
      targetMonthly: tgtPrices.monthly,
      targetYearly: tgtPrices.yearly,
      term,
      subtractUnusedCredit: stackOnExpiry ? false : true,
    });

    const previousDaysLeft = daysLeftRounded(nowMs, currentExpiryMs);
    const newDaysLeft = daysLeftRounded(nowMs, quote.newExpiryMs);

    const planChangeHistory = {
      oldPlanId: currentPlanId,
      newPlanId: targetPlanId,
      oldExpiryMs: currentExpiryMs,
      newExpiryMs: quote.newExpiryMs,
      oldDaysLeft: previousDaysLeft,
      newDaysLeft,
      grossNpr: quote.grossNpr,
      creditNpr: quote.creditNpr,
      netNpr: quote.netNpr,
      termKey: term,
      changeKind,
    };

    // Zero net: only “Just change plan” (tier remap, charge 0). Paid term must open gateway.
    if (quote.netNpr <= 0) {
      if (stackOnExpiry) {
        return NextResponse.json(
          {
            error:
              quote.grossNpr <= 0
                ? "Plan price is missing or zero — cannot start checkout. Check Admin → Plans pricing."
                : "Term purchase must be charged (stack on expiry). Refresh billing and try again.",
          },
          { status: 400 }
        );
      }
      const paymentDocId = `plan_change_${uuidv4()}`;
      const paymentRef = companyRef.collection("payments").doc(paymentDocId);
      const batch = db.batch();
      const frozenPatch =
        changeKind === "upgrade" && PAID_PLAN_IDS.has(currentPlanId)
          ? buildMergedFrozenStateAfterPaidUpgrade({
              existingLedgerRaw: cdata.billingFrozenUsageLedger,
              existingBlockedRaw: cdata.billingBlockedDowngradePlanIds,
              nowMs,
              oldPlanId: currentPlanId,
              oldExpiryMs: currentExpiryMs,
              oldYearly: curPrices.yearly,
              oldPlanStartedAtMs: resolveCompanyPlanTierStartedAtMs(cdata),
              targetPlanId,
            })
          : null;
      const planSwitchMs = Date.now();
      const planSwitchTs = Timestamp.fromMillis(planSwitchMs);
      const primaryCompanyUpdate: Record<string, unknown> = {
        planId: targetPlanId,
        planExpiry: Timestamp.fromMillis(quote.newExpiryMs),
        planExpiryMs: quote.newExpiryMs,
        planUpgradedAt: planSwitchTs,
        planUpgradedAtMs: planSwitchMs,
        ...(frozenPatch ?? {}),
      };
      batch.update(companyRef, primaryCompanyUpdate);
      batch.set(paymentRef, {
        paymentId: paymentDocId,
        userId: decoded.uid,
        planId: targetPlanId,
        amount: 0,
        currency: "npr",
        gateway: "internal",
        status: "completed",
        billingIntent: "subscribe",
        planChangeFrom: currentPlanId,
        planChangeTo: targetPlanId,
        planChangeHistory,
        planExpiryMs: quote.newExpiryMs,
        planChangeOneTime: true,
        createdAt: serverTimestamp(),
      });
      const histRef = companyRef.collection("subscription_history").doc();
      batch.set(histRef, {
        ...planChangeHistory,
        source: "server_proration_zero_net",
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      const mirrorOwnerId = String(cdata.ownerId ?? decoded.uid ?? "").trim();
      const siblingOnlyPatch: Record<string, unknown> = {
        planId: targetPlanId,
        planExpiry: Timestamp.fromMillis(quote.newExpiryMs),
        planExpiryMs: quote.newExpiryMs,
        planUpgradedAt: planSwitchTs,
        planUpgradedAtMs: planSwitchMs,
      };
      await applyOwnerPlanMirrorBatched(db, mirrorOwnerId, (docId) =>
        docId === companyId ? {} : siblingOnlyPatch
      );
      // Owner `users/*` canonical — zero-net branch ne saari owned companies mirror kar di.
      const stripeCust =
        typeof cdata.stripeCustomerId === "string" && cdata.stripeCustomerId.trim()
          ? cdata.stripeCustomerId.trim()
          : null;
      const stripeSub =
        typeof cdata.stripeSubscriptionId === "string" && cdata.stripeSubscriptionId.trim()
          ? cdata.stripeSubscriptionId.trim()
          : null;
      if (mirrorOwnerId) {
        await persistAccountCanonicalPlanDoc(db, mirrorOwnerId, {
          planId: targetPlanId,
          planExpiryMs: quote.newExpiryMs,
          planUpgradedAtMs: planSwitchMs,
          stripeCustomerId: stripeCust,
          stripeSubscriptionId: stripeSub,
        });
      }
      // Client toast: upgrade par end date pehle ho sakti hai — `planChangeHistory` se compare.
      return NextResponse.json({ ok: true, applied: true, quote, planChangeHistory });
    }

    if ((gateway === "khalti" || gateway === "esewa") && billingRegion !== "nepal") {
      return NextResponse.json(
        { error: "Khalti and eSewa only support Nepal (NPR). Use Stripe for SAARC / International." },
        { status: 400 }
      );
    }

    // Khalti/eSewa proration: persist server-side intent so return callbacks cannot forge company/plan/amount.
    if (gateway === "khalti" || gateway === "esewa") {
      const adminResult = await getGatewayKeysFromAdmin();
      const keys = mergeGatewayKeysWithEnv(adminResult.stored);
      const pendingId = uuidv4();
      const expiresAt = Timestamp.fromMillis(Date.now() + PENDING_PLAN_CHANGE_TTL_MS);
      const pendingRef = db.collection(PENDING_PLAN_CHANGES_COLLECTION).doc(pendingId);

      await pendingRef.set({
        companyId,
        userId: decoded.uid,
        targetPlanId,
        previousPlanId: currentPlanId,
        termKey: term,
        changeKind,
        planChangeHistory,
        newPlanExpiryMs: quote.newExpiryMs,
        netNpr: quote.netNpr,
        grossNpr: quote.grossNpr,
        creditNpr: quote.creditNpr,
        gateway,
        status: "pending",
        createdAt: serverTimestamp(),
        expiresAt,
      });

      if (gateway === "khalti") {
        if (!keys.khaltiPublicKey) {
          await pendingRef.delete().catch(() => {});
          return NextResponse.json({ error: "Khalti is not configured (public key)." }, { status: 500 });
        }
        return NextResponse.json({
          gateway: "khalti" as const,
          pendingId,
          publicKey: keys.khaltiPublicKey,
          amount: Math.round(quote.netNpr * 100),
          product_identity: pendingId,
          product_name: `Plan renew: ${currentPlanId} → ${targetPlanId}`,
          returnUrl: getPublicAppHrefForPaymentRedirects(
            req,
            `/billing/plan-change/khalti?pendingId=${encodeURIComponent(pendingId)}`
          ),
          quote,
        });
      }

      if (!keys.esewaMerchantCode || !keys.esewaSecretKey) {
        await pendingRef.delete().catch(() => {});
        return NextResponse.json({ error: "eSewa is not configured (merchant code + secret)." }, { status: 500 });
      }

      const product_code = keys.esewaMerchantCode;
      const total_amount_in_rupees = quote.netNpr;
      const message = `total_amount=${total_amount_in_rupees},transaction_uuid=${pendingId},product_code=${product_code}`;
      const signature = crypto.createHmac("sha256", keys.esewaSecretKey).update(message).digest("base64");
      const eSewaUrl = getEsewaEpayV2FormUrl(product_code);

      return NextResponse.json({
        gateway: "esewa" as const,
        pendingId,
        url: eSewaUrl,
        amount: total_amount_in_rupees,
        oid: pendingId,
        successUrl: getPublicAppHrefForPaymentRedirects(req, "/billing/plan-change/esewa"),
        failUrl: getPublicAppHrefForPaymentRedirects(req, "/billing/cancel"),
        merchantCode: product_code,
        signature,
        signedFieldNames: "total_amount,transaction_uuid,product_code",
        quote,
      });
    }

    const adminResult = await getGatewayKeysFromAdmin();
    const keys = mergeGatewayKeysWithEnv(adminResult.stored);
    if (!keys.stripeSecretKey) {
      return NextResponse.json({ error: stripeConfigHelpMessage(adminResult) }, { status: 500 });
    }

    const stripe = new Stripe(keys.stripeSecretKey, { apiVersion: "2025-12-15.clover" as any });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: checkoutCurrency,
            product_data: {
              name: `Plan ${changeKind}: ${currentPlanId} → ${targetPlanId} (${term})`,
            },
            unit_amount: Math.round(quote.netNpr * minorFactor),
          },
          quantity: 1,
        },
      ],
      success_url: getPublicAppHrefForPaymentRedirects(
        req,
        "/billing/success?session_id={CHECKOUT_SESSION_ID}"
      ),
      cancel_url: getPublicAppHrefForPaymentRedirects(req, "/billing/cancel"),
      metadata: {
        planChange: "true",
        companyId,
        userId: decoded.uid,
        targetPlanId,
        previousPlanId: currentPlanId,
        newPlanExpiryMs: String(quote.newExpiryMs),
        previousPlanExpiryMs: currentExpiryMs != null ? String(currentExpiryMs) : "",
        previousDaysLeft: String(previousDaysLeft),
        newDaysLeft: String(newDaysLeft),
        grossNpr: String(quote.grossNpr),
        creditNpr: String(quote.creditNpr),
        netNpr: String(quote.netNpr),
        termKey: term,
        changeKind,
        billingIntent: "subscribe",
        paymentGateway: "stripe",
        ...(billingCaller.store === "server" ? { plStore: "server" } : {}),
      },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 500 });
    }

    return NextResponse.json({ url: session.url, quote });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[plan-change-checkout]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
