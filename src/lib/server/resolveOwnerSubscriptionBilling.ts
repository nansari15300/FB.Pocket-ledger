import "server-only";
import type admin from "@/lib/server/pbAdminTypes";
import { normalizePlanIdForClient, type PlanId } from "@/config/plans";
import {
  accountPlanCanonFromUserDocFields,
  pickAccountPlanCanonFromCompanySnapshots,
} from "@/lib/server/accountCanonicalPlan";
import { findOwnedCompanyIdForUser } from "@/lib/payments/resolveStripeFirestoreCompany";

export type ResolvedOwnerSubscription = {
  planId: PlanId;
  expiryMs: number;
  /** Firestore `companies/{id}` for payment attribution — optional when owner is local-only. */
  paymentCompanyId: string | null;
};

export type ResolveOwnerSubscriptionResult =
  | { ok: true; subscription: ResolvedOwnerSubscription }
  | { ok: false; error: string; status: number };

/**
 * Account-first billing gate: `users/{uid}.accountCanonical*` wins; owned Firestore companies are fallback.
 * Does not require a Firestore company doc to exist (local-only owners still pass when user canon is valid).
 */
export async function resolveOwnerActivePaidSubscription(
  db: admin.firestore.Firestore,
  userId: string,
  preferredCompanyId?: string | null
): Promise<ResolveOwnerSubscriptionResult> {
  const uid = String(userId || "").trim();
  if (!uid) {
    return { ok: false, error: "userId required", status: 400 };
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const udata = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;
  const userCanon = accountPlanCanonFromUserDocFields(udata);

  const ownedSnap = await db.collection("companies").where("ownerId", "==", uid).limit(40).get();
  const companyRows = ownedSnap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));
  const companyCanon = pickAccountPlanCanonFromCompanySnapshots(companyRows);

  const planId = normalizePlanIdForClient(
    userCanon?.planId || companyCanon?.planId || "basic"
  );
  let expiryMs: number | null = userCanon?.planExpiryMs ?? companyCanon?.planExpiryMs ?? null;

  if (planId === "basic") {
    return {
      ok: false,
      error: "Active paid plan period required before buying add-ons",
      status: 400,
    };
  }
  if (expiryMs == null || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    return {
      ok: false,
      error: "Active paid plan period required before buying add-ons",
      status: 400,
    };
  }

  const paymentCompanyId = await findOwnedCompanyIdForUser(db, uid, preferredCompanyId);

  return {
    ok: true,
    subscription: {
      planId,
      expiryMs,
      paymentCompanyId,
    },
  };
}
