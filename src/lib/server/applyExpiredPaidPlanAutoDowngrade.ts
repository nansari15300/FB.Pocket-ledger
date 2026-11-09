/**
 * Paid plan ki `planExpiry` beet chuki ho aur owner ne opt-out na kiya ho — company ko Basic par server-side.
 * `sync-plan` call par chalta hai taaki app khulte hi expiry resolve ho.
 */
import type admin from "@/lib/server/pbAdminTypes";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import { applyOwnerPlanMirrorBatched } from "@/lib/server/mirrorOwnerCompanyPlanBilling";
import { persistAccountCanonicalPlanDoc } from "@/lib/server/accountCanonicalPlan";

import { deleteField, serverTimestamp, Timestamp } from "@/lib/server/pbBilling/fieldValue";

const PAID: PlanId[] = ["advance", "pro", "pro-plus"];

function planExpiryMsFromCompanyData(data: Record<string, unknown>): number | null {
  if (typeof data.planExpiryMs === "number" && Number.isFinite(data.planExpiryMs)) {
    return data.planExpiryMs;
  }
  const pe = data.planExpiry as { toMillis?: () => number } | undefined;
  if (pe && typeof pe.toMillis === "function") return pe.toMillis();
  return null;
}

export async function applyExpiredPaidPlanAutoDowngradeIfEligible(args: {
  db: admin.firestore.Firestore;
  companyRef: admin.firestore.DocumentReference;
  snapData: Record<string, unknown>;
  decoded: admin.auth.DecodedIdToken;
  nowMs?: number;
}): Promise<boolean> {
  const now = args.nowMs ?? Date.now();
  if (!isCompanyOwner(args.decoded, args.snapData as { ownerId?: string; ownerEmail?: string })) {
    return false;
  }

  const planId = normalizePlanIdForClient(args.snapData.planId != null ? String(args.snapData.planId) : undefined);
  if (!PAID.includes(planId)) return false;

  const expMs = planExpiryMsFromCompanyData(args.snapData);
  if (expMs == null || expMs >= now) return false;

  /** `undefined` / missing = default ON (expire par Basic); sirf explicit `false` se band. */
  const autoDowngrade = args.snapData.autoDowngradeToBasicWhenExpired;
  if (autoDowngrade === false) return false;

  const autoDownMs = Date.now();
  const autoDownTs = Timestamp.fromMillis(autoDownMs);
  const companyPatch: Record<string, unknown> = {
    planId: "basic",
    planExpiry: deleteField(),
    planExpiryMs: deleteField(),
    stripeSubscriptionId: deleteField(),
    planUpgradedAt: autoDownTs,
    planUpgradedAtMs: autoDownMs,
    lastAutoDowngradeToBasicAt: serverTimestamp(),
    lastAutoDowngradeToBasicReason: "paid_plan_expired_no_renewal",
  };

  const batch = args.db.batch();
  batch.update(args.companyRef, companyPatch);
  const histRef = args.companyRef.collection("subscription_history").doc();
  batch.set(histRef, {
    oldPlanId: planId,
    newPlanId: "basic",
    oldExpiryMs: expMs,
    newExpiryMs: null,
    source: "auto_downgrade_paid_expired",
    createdAt: serverTimestamp(),
  });
  await batch.commit();

  const ownerId = String(args.snapData.ownerId ?? args.decoded.uid ?? "").trim();
  if (ownerId) {
    await applyOwnerPlanMirrorBatched(args.db, ownerId, (docId) =>
      docId === args.companyRef.id ? {} : companyPatch
    );
    await persistAccountCanonicalPlanDoc(args.db, ownerId, {
      planId: "basic",
      planExpiryMs: null,
      planUpgradedAtMs: autoDownMs,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
  }
  return true;
}
