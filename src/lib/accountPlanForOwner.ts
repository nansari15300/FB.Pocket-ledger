"use client";

import { isDeviceLocalCompany } from "@/lib/companyStorageKind";
import { normalizePlanIdForClient, type PlanId, planTierIndex } from "@/config/plans";
import { readAccountPlanLocalCache } from "@/lib/accountPlanLocalCache";
import { resolvePlServerSharedOwnerPlanId } from "@/lib/plServerAccessContext";
import { isMyCompanyPlanExempt, MY_COMPANY_PLAN_ID } from "@/lib/myCompanyPlanOverride";

/**
 * Account-level plan: highest tier among companies the Firebase user owns.
 * Local row may stay "basic" while another owned company or Stripe mirror already has "advance" — entitlements use this.
 */
export function highestPlanIdAmongOwnedCompanies(
  allCompanies: ReadonlyArray<{ planId?: string | null | undefined; isOwned?: boolean; ownerId?: string }>,
  firebaseUid: string | undefined | null
): PlanId | null {
  if (!firebaseUid?.trim()) return null;
  const uid = firebaseUid.trim();
  const owned = allCompanies.filter(
    (c) => c.isOwned === true && String(c.ownerId || "").trim() === uid
  );
  if (owned.length === 0) return null;
  let best: PlanId = "basic";
  let bestIdx = -1;
  for (const c of owned) {
    const id = normalizePlanIdForClient(c.planId);
    const idx = planTierIndex(id);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = id;
    }
  }
  return best;
}

/** Resolved SKU for hooks/UI: owned aggregate first, then active company (e.g. shared or loading). */
export function resolveEffectiveAccountPlanId(
  allCompanies: ReadonlyArray<{ planId?: string | null | undefined; isOwned?: boolean; ownerId?: string }>,
  firebaseUid: string | undefined | null,
  activeCompanyPlanId: string | undefined | null
): PlanId {
  const fromOwned = highestPlanIdAmongOwnedCompanies(allCompanies, firebaseUid);
  const active = normalizePlanIdForClient(activeCompanyPlanId);
  const cachedAccount = readAccountPlanLocalCache(firebaseUid);
  const fromAccount = cachedAccount?.planId ?? null;
  let best = fromOwned ?? active;
  if (fromAccount && planTierIndex(fromAccount) > planTierIndex(best)) best = fromAccount;
  return best;
}

/**
 * Billing / user caps: owner `users/{uid}.accountCanonicalPlanId` wins (Stripe + admin SKU),
 * then viewer's own canonical when they are the owner, then owned-company aggregate.
 */
export function resolveAccountPlanIdForEntitlements(
  ownerUserData: Record<string, unknown> | null | undefined,
  allCompanies: ReadonlyArray<{ planId?: string | null | undefined; isOwned?: boolean; ownerId?: string }>,
  ownerUid: string | undefined | null,
  activeCompanyPlanId: string | undefined | null,
  viewerAccountCanonicalPlanId?: string | null
): PlanId {
  const ownerCanon = String(ownerUserData?.accountCanonicalPlanId || "").trim();
  if (ownerCanon) return normalizePlanIdForClient(ownerCanon);
  const uid = String(ownerUid || "").trim();
  const viewerCanon = String(viewerAccountCanonicalPlanId || "").trim();
  if (uid && viewerCanon) return normalizePlanIdForClient(viewerCanon);
  return resolveEffectiveAccountPlanId(allCompanies, ownerUid, activeCompanyPlanId);
}

type CompanyPlanRow = {
  id?: string;
  planId?: string | null | undefined;
  isOwned?: boolean;
  ownerId?: string;
  ownerEmail?: string | null;
  plServerShared?: boolean;
};

/** Firebase user is owner of this company row (billing / account SKU). */
export function isCompanyOwnedByFirebaseUser(
  company: CompanyPlanRow | null | undefined,
  firebaseUid: string | undefined | null,
  firebaseEmail?: string | null
): boolean {
  if (!company) return false;
  if (company.isOwned === true) return true;
  const uid = String(firebaseUid || "").trim();
  const oid = String(company.ownerId || "").trim();
  if (uid && oid && uid === oid) return true;
  const ue = String(firebaseEmail || "")
    .toLowerCase()
    .trim();
  const oe = String(company.ownerEmail || "")
    .toLowerCase()
    .trim();
  return !!ue && !!oe && ue === oe;
}

/**
 * Active company ke liye plan tier:
 * - **Owned** → account-level best owned SKU (`resolveEffectiveAccountPlanId`)
 * - **Shared** → isi company doc ka `planId` (owner subscription — shared user ka apna basic plan yahan mix na ho)
 */
export function resolvePlanIdForActiveCompany(
  company: CompanyPlanRow | null | undefined,
  allCompanies: ReadonlyArray<CompanyPlanRow>,
  firebaseUid: string | undefined | null,
  firebaseEmail?: string | null
): PlanId {
  if (!company) {
    return resolveEffectiveAccountPlanId(allCompanies, firebaseUid, null);
  }
  // My Company = server books — not an end-user SKU (caps overridden in myCompanyPlanOverride).
  if (isMyCompanyPlanExempt(company)) return MY_COMPANY_PLAN_ID;
  if (isCompanyOwnedByFirebaseUser(company, firebaseUid, firebaseEmail)) {
    return resolveEffectiveAccountPlanId(allCompanies, firebaseUid, company.planId);
  }
  const rowPlan = normalizePlanIdForClient(company.planId);
  const fromPlServer = company.id ? resolvePlServerSharedOwnerPlanId(String(company.id)) : null;
  if (fromPlServer && planTierIndex(fromPlServer) > planTierIndex(rowPlan)) {
    return fromPlServer;
  }
  return rowPlan;
}

/** Device-local owned row: Firebase account plan overlay (SQLite basic + online Pro). */
export function overlayOwnerAccountPlanOnLocalCompany<
  T extends CompanyPlanRow & { id?: string; storageOption?: string | null }
>(
  company: T,
  allCompanies: ReadonlyArray<CompanyPlanRow>,
  firebaseUid: string | null | undefined,
  firebaseEmail?: string | null
): T {
  if (!company?.id || !firebaseUid?.trim()) return company;
  if (!isDeviceLocalCompany(company)) return company;
  if (!isCompanyOwnedByFirebaseUser(company, firebaseUid, firebaseEmail)) return company;
  const effective = resolvePlanIdForActiveCompany(company, allCompanies, firebaseUid, firebaseEmail);
  const current = normalizePlanIdForClient(company.planId);
  if (effective === current) return company;
  if (planTierIndex(effective) <= planTierIndex(current)) return company;
  return { ...company, planId: effective };
}
