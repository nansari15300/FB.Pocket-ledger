/**
 * Shared Firestore writes for prorated plan renew / upgrade (one-time payment, any gateway).
 * Stripe webhook + sync + Khalti/eSewa completion routes all funnel through this for consistent payment rows / admin history.
 */
import type admin from "@/lib/server/pbAdminTypes";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";
import {
  buildMergedFrozenStateAfterPaidUpgrade,
  resolveCompanyPlanTierStartedAtMs,
} from "@/lib/billingFrozenPlanSnapshots";
import { getEffectivePlanPrices } from "@/lib/server/getEffectivePlanPrices";
import { PAID_PLAN_IDS } from "@/lib/payments/stripeCheckoutFulfill";
import { applyOwnerPlanMirrorBatched } from "@/lib/server/mirrorOwnerCompanyPlanBilling";
import { persistAccountCanonicalPlanDoc } from "@/lib/server/accountCanonicalPlan";
import { mirrorSubscriptionPaymentToAdminCompany } from "@/lib/adminPanelAccounting/mirrorSubscriptionPayment";

import { serverTimestamp, Timestamp } from "@/lib/server/pbBilling/fieldValue";

/** Snapshot stored on payment docs + merged into admin plan-change History dialog. */
export type PlanChangeHistoryFirestore = {
  oldPlanId: string | null;
  newPlanId: string;
  oldExpiryMs: number | null;
  newExpiryMs: number;
  oldDaysLeft: number | null;
  newDaysLeft: number | null;
  grossNpr: number | null;
  creditNpr: number | null;
  netNpr: number | null;
  termKey: string | null;
  changeKind: string | null;
};

export type ApplyPlanChangeOneTimeInput = {
  db: admin.firestore.Firestore;
  companyId: string;
  userId: string | null;
  paymentId: string;
  gateway: "stripe" | "khalti" | "esewa";
  amountNpr: number;
  currency: string;
  targetPlanId: PlanId;
  previousPlanId: string | null;
  planChangeHistory: PlanChangeHistoryFirestore;
  newPlanExpiryMs: number;
  paymentStatus: string;
  /** Stripe-only: links company to customer for future invoices. */
  stripeCustomerId?: string | null;
  /** Marks company.lastStripeCheckoutSessionId when set (Stripe one-time renew). */
  stripeSessionId?: string | null;
  /** Extra fields on subscription_history (e.g. stripeSessionId). */
  historyExtra?: Record<string, unknown>;
  /** Distinct source string per gateway for ops / debugging. */
  historySource: string;
};

export type ApplyPlanChangeResult = { ok: true } | { ok: false; reason: string };

/**
 * Idempotent: if this paymentId already fulfilled (`planChangeFulfillComplete`), no-op success (avoids duplicate history rows on webhook retry).
 */
export async function applyPlanChangeOneTimeToFirestore(input: ApplyPlanChangeOneTimeInput): Promise<ApplyPlanChangeResult> {
  const {
    db,
    companyId,
    userId,
    paymentId,
    gateway,
    amountNpr,
    currency,
    targetPlanId,
    previousPlanId,
    planChangeHistory,
    newPlanExpiryMs,
    paymentStatus,
    stripeCustomerId,
    stripeSessionId,
    historyExtra,
    historySource,
  } = input;

  if (!PAID_PLAN_IDS.has(targetPlanId)) {
    return { ok: false, reason: "invalid_targetPlanId" };
  }

  const companyRef = db.collection("companies").doc(companyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    return { ok: false, reason: "company_not_found" };
  }
  const cdata = companySnap.data() as Record<string, unknown>;

  const paymentRef = companyRef.collection("payments").doc(paymentId);
  const paySnap = await paymentRef.get();
  // Idempotent retries (webhook + client sync): do not duplicate `subscription_history` rows —
  // lekin Admin Panel mirror hamesha try (pehli baar mirror fail ho to dubara pe books banen).
  const alreadyFulfilled = paySnap.exists && paySnap.get("planChangeFulfillComplete") === true;

  if (!alreadyFulfilled) {
  await paymentRef.set(
    {
      paymentId,
      userId,
      planId: targetPlanId,
      amount: amountNpr,
      currency: currency.toLowerCase(),
      gateway,
      status: paymentStatus,
      billingIntent: "subscribe",
      planChangeFrom: previousPlanId,
      planChangeTo: targetPlanId,
      planChangeHistory,
      planExpiryMs: newPlanExpiryMs,
      planChangeOneTime: true,
      planChangeFulfillComplete: true,
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  const planExpiry = Timestamp.fromMillis(newPlanExpiryMs);
  const tierSwitchMs = Date.now();
  const planUpgradedAtTs = Timestamp.fromMillis(tierSwitchMs);

  /** Saari owned companies par yahi slice — `billingFrozen*` sirf checkout wali company (tier ramp). */
  const commonCompanyPatch: Record<string, unknown> = {
    planId: targetPlanId,
    planUpgradedAt: planUpgradedAtTs,
    planUpgradedAtMs: tierSwitchMs,
    planExpiry,
    planExpiryMs: newPlanExpiryMs,
  };
  if (stripeSessionId) {
    commonCompanyPatch.lastStripeCheckoutSessionId = stripeSessionId;
  }
  if (stripeCustomerId) {
    commonCompanyPatch.stripeCustomerId = stripeCustomerId;
  }

  const hist = planChangeHistory;
  const oldPid = normalizePlanIdForClient(
    hist.oldPlanId != null ? String(hist.oldPlanId) : previousPlanId != null ? String(previousPlanId) : undefined
  );
  let frozenPatch: Record<string, unknown> | null = null;
  if (hist.changeKind === "upgrade" && oldPid !== "basic" && PAID_PLAN_IDS.has(oldPid)) {
    const prices = await getEffectivePlanPrices(oldPid);
    frozenPatch =
      buildMergedFrozenStateAfterPaidUpgrade({
        existingLedgerRaw: cdata.billingFrozenUsageLedger,
        existingBlockedRaw: cdata.billingBlockedDowngradePlanIds,
        nowMs: Date.now(),
        oldPlanId: oldPid,
        oldExpiryMs: hist.oldExpiryMs,
        oldYearly: prices.yearly,
        oldPlanStartedAtMs: resolveCompanyPlanTierStartedAtMs(cdata),
        targetPlanId,
      }) ?? null;
  }

  const primaryPatch =
    frozenPatch && Object.keys(frozenPatch).length > 0 ? { ...commonCompanyPatch, ...frozenPatch } : commonCompanyPatch;

  const ownerId = String(cdata.ownerId ?? userId ?? "").trim();
  if (ownerId) {
    await applyOwnerPlanMirrorBatched(db, ownerId, (docId) =>
      docId === companyId ? primaryPatch : commonCompanyPatch
    );
    // `users/{ownerId}` par canonical tier — SuperAdmin / sync-plan drift heal ke liye warm cache.
    const stripeCustMerged =
      (typeof stripeCustomerId === "string" && stripeCustomerId.trim() ? stripeCustomerId.trim() : null) ??
      (typeof cdata.stripeCustomerId === "string" && cdata.stripeCustomerId.trim() ? cdata.stripeCustomerId.trim() : null);
    const stripeSubMerged =
      typeof cdata.stripeSubscriptionId === "string" && cdata.stripeSubscriptionId.trim()
        ? cdata.stripeSubscriptionId.trim()
        : null;
    await persistAccountCanonicalPlanDoc(db, ownerId, {
      planId: targetPlanId,
      planExpiryMs: newPlanExpiryMs,
      planUpgradedAtMs: tierSwitchMs,
      stripeCustomerId: stripeCustMerged,
      stripeSubscriptionId: stripeSubMerged,
    });
  } else {
    await companyRef.update(primaryPatch);
  }

  await companyRef.collection("subscription_history").add({
    ...planChangeHistory,
    source: historySource,
    gateway,
    paymentId,
    ...(historyExtra ?? {}),
    createdAt: serverTimestamp(),
  });
  }

  let userName: string | null = null;
  let userEmail: string | null = null;
  if (userId) {
    const userSnap = await db.collection("users").doc(userId).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      userName = String(u.displayName ?? u.name ?? u.email ?? "").trim() || null;
      userEmail = String(u.email ?? "").trim() || null;
    }
  }

  // Always (re)try Admin Panel Company books — mirror is idempotent by paymentId.
  await mirrorSubscriptionPaymentToAdminCompany(db, {
    paymentId,
    userId,
    userName,
    userEmail,
    amountNpr,
    gateway,
    planId: targetPlanId,
    customerCompanyId: companyId,
    customerCompanyName: String(cdata.name ?? cdata.companyName ?? "").trim() || null,
    subscriptionTermKey: planChangeHistory.termKey ?? null,
  });

  return { ok: true };
}

/** Root collection: server-created checkout intents for Khalti/eSewa proration (client only has pendingId). */
export const PENDING_PLAN_CHANGES_COLLECTION = "pending_plan_changes";

/** Pending docs older than this are rejected (TTL-style, no Cloud Function required). */
export const PENDING_PLAN_CHANGE_TTL_MS = 60 * 60 * 1000;
