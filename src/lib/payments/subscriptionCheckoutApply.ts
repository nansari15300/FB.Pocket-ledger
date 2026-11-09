/**
 * Khalti/eSewa **new subscription** checkout → Firestore plan upgrade (Stripe webhook jaisa, bina subscription id).
 */
import type admin from "@/lib/server/pbAdminTypes";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";
import { PAID_PLAN_IDS } from "@/lib/payments/stripeCheckoutFulfill";
import { findOwnedCompanyIdForUser } from "@/lib/payments/resolveStripeFirestoreCompany";
import { grantAccountCanonicalPlan } from "@/lib/server/accountCanonicalPlan";
import { mirrorSubscriptionPaymentToAdminCompany } from "@/lib/adminPanelAccounting/mirrorSubscriptionPayment";
import { termDurationMs, type SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import type { VerifiedLocalPlanApplyPayload } from "@/lib/payments/localStripePlanApplyTypes";

import { serverTimestamp, Timestamp } from "@/lib/server/pbBilling/fieldValue";

export type ApplySubscriptionCheckoutInput = {
  db: admin.firestore.Firestore;
  /** Optional legacy/display context. A new account may subscribe before creating any company. */
  companyId?: string | null;
  userId: string;
  paymentId: string;
  gateway: "khalti" | "esewa";
  amountNpr: number;
  currency: string;
  planId: PlanId;
  subscriptionTermKey: SubscriptionTermKey;
  billingIntent: "subscribe" | "donation";
};

export type ApplySubscriptionCheckoutResult =
  | { ok: true; mirrorLocal?: VerifiedLocalPlanApplyPayload }
  | { ok: false; reason: string };

/**
 * Idempotent: payment doc `subscriptionFulfillComplete` — webhook / success page dubara call safe.
 */
export async function applyNewSubscriptionCheckoutToFirestore(
  input: ApplySubscriptionCheckoutInput
): Promise<ApplySubscriptionCheckoutResult> {
  const {
    db,
    companyId: rawCompanyId,
    userId,
    paymentId,
    gateway,
    amountNpr,
    currency,
    planId,
    subscriptionTermKey,
    billingIntent,
  } = input;

  const companyId = String(rawCompanyId || "").trim();

  if (billingIntent === "donation") {
    if (!companyId) {
      await db.collection("users").doc(userId).collection("billing_payments").doc(paymentId).set(
        {
          paymentId,
          amount: amountNpr,
          currency: currency.toLowerCase(),
          gateway,
          status: "completed",
          billingIntent: "donation",
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      return { ok: true };
    }
    const primaryRef = db.collection("companies").doc(companyId);
    let effectiveCompanyId = companyId;
    let companySnap = await primaryRef.get();
    if (!companySnap.exists && userId) {
      const resolved = await findOwnedCompanyIdForUser(db, userId, companyId);
      if (resolved) {
        effectiveCompanyId = resolved;
        companySnap = await db.collection("companies").doc(resolved).get();
      }
    }
    if (companySnap.exists) {
      const payRef = db.collection("companies").doc(effectiveCompanyId).collection("payments").doc(paymentId);
      await payRef.set(
        {
          paymentId,
          userId,
          amount: amountNpr,
          currency: currency.toLowerCase(),
          gateway,
          status: "completed",
          billingIntent: "donation",
          subscriptionFulfillComplete: true,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    return { ok: true };
  }

  const targetPlanId = normalizePlanIdForClient(planId);
  if (!PAID_PLAN_IDS.has(targetPlanId)) {
    return { ok: false, reason: "invalid_planId" };
  }

  const planExpiryMs = Date.now() + termDurationMs(subscriptionTermKey);
  const tierSwitchMs = Date.now();
  if (!companyId) {
    await grantAccountCanonicalPlan(
      db,
      userId,
      {
        planId: targetPlanId,
        planExpiryMs,
        planUpgradedAtMs: tierSwitchMs,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      },
      `${gateway}_subscribe:${paymentId}`
    );
    return { ok: true };
  }

  const primaryRef = db.collection("companies").doc(companyId);
  let effectiveCompanyId = companyId;
  let companySnap = await primaryRef.get();
  if (!companySnap.exists && userId) {
    const resolved = await findOwnedCompanyIdForUser(db, userId, companyId);
    if (resolved) {
      effectiveCompanyId = resolved;
      companySnap = await db.collection("companies").doc(resolved).get();
    }
  }
  if (!companySnap.exists) {
    return { ok: false, reason: "company_not_found" };
  }

  const paymentRef = db.collection("companies").doc(effectiveCompanyId).collection("payments").doc(paymentId);
  const paySnap = await paymentRef.get();
  if (paySnap.exists && paySnap.get("subscriptionFulfillComplete") === true) {
    const mirrorLocal: VerifiedLocalPlanApplyPayload = {
      companyId: effectiveCompanyId,
      planId: targetPlanId,
      planExpiryMs: Number(paySnap.get("planExpiryMs") ?? 0),
      userId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      lastStripeCheckoutSessionId: paymentId,
      source: "subscription",
    };
    return { ok: true, mirrorLocal };
  }

  const planExpiry = Timestamp.fromMillis(planExpiryMs);
  const planUpgradedAtTs = Timestamp.fromMillis(tierSwitchMs);

  await paymentRef.set(
    {
      paymentId,
      userId,
      planId: targetPlanId,
      amount: amountNpr,
      currency: currency.toLowerCase(),
      gateway,
      status: "completed",
      billingIntent: "subscribe",
      subscriptionTermKey,
      planExpiryMs,
      subscriptionFulfillComplete: true,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  const patch: Record<string, unknown> = {
    planId: targetPlanId,
    planExpiry,
    planExpiryMs,
    planUpgradedAt: planUpgradedAtTs,
    planUpgradedAtMs: tierSwitchMs,
  };

  const cdata = companySnap.data() as { ownerId?: string } | undefined;
  const ownerId = String(cdata?.ownerId ?? userId ?? "").trim();
  if (ownerId) {
    await grantAccountCanonicalPlan(db, ownerId, {
      planId: targetPlanId,
      planExpiryMs,
      planUpgradedAtMs: tierSwitchMs,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    }, `${gateway}_subscribe:${paymentId}`);
  } else {
    await db.collection("companies").doc(effectiveCompanyId).update(patch);
  }

  await db
    .collection("companies")
    .doc(effectiveCompanyId)
    .collection("subscription_history")
    .add({
      newPlanId: targetPlanId,
      newExpiryMs: planExpiryMs,
      netNpr: amountNpr,
      termKey: subscriptionTermKey,
      source: `${gateway}_subscribe`,
      gateway,
      paymentId,
      createdAt: serverTimestamp(),
    });

  const cdataFull = companySnap.data() as Record<string, unknown> | undefined;
  let userName: string | null = null;
  let userEmail: string | null = null;
  const userSnap = await db.collection("users").doc(userId).get();
  if (userSnap.exists) {
    const u = userSnap.data() as Record<string, unknown>;
    userName = String(u.displayName ?? u.name ?? u.email ?? "").trim() || null;
    userEmail = String(u.email ?? "").trim() || null;
  }

  await mirrorSubscriptionPaymentToAdminCompany(db, {
    paymentId,
    userId,
    userName,
    userEmail,
    amountNpr,
    gateway,
    planId: targetPlanId,
    customerCompanyId: effectiveCompanyId,
    customerCompanyName: String(cdataFull?.name ?? cdataFull?.companyName ?? "").trim() || null,
    subscriptionTermKey,
  });

  return {
    ok: true,
    mirrorLocal: {
      companyId: effectiveCompanyId,
      planId: targetPlanId,
      planExpiryMs,
      userId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      lastStripeCheckoutSessionId: paymentId,
      source: "subscription",
    },
  };
}
