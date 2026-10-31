/**
 * Shared helper to get effective voucher history settings (company + plan).
 * Used by both client (voucherActionsClient) and server (voucher-actions, actions).
 */
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc, getDocFromServer } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getPlan, type PlanId } from "@/config/plans";
import { isLocalOnlyMode } from "@/lib/localMode";
import { apkEmbeddedSqliteFirstWritesPreferred } from "@/lib/apkOnlineFirestoreWritePolicy";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";

export type VoucherHistoryFullBehavior = 'block_edit' | 'allow_edit_delete_last';

/**
 * Firestore / legacy docs kabhi-kabhi galat ya purana string store karte hain; form + Select sirf do valid values jaante hain.
 * Invalid / empty ko safe default pe map karo taaki refresh ke baad bhi dropdown + zod sahi rahein.
 */
export function normalizeVoucherHistoryFullBehavior(raw: unknown): VoucherHistoryFullBehavior {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "block_edit") return "block_edit";
  if (s === "allow_edit_delete_last") return "allow_edit_delete_last";
  return "allow_edit_delete_last";
}

export async function getEffectiveHistorySettings(companyId: string): Promise<{ enabled: boolean; limit: number; fullBehavior: VoucherHistoryFullBehavior }> {
  const localDefaults = { enabled: true, limit: 10, fullBehavior: "allow_edit_delete_last" as const };
  if (isLocalOnlyMode()) {
    return localDefaults;
  }
  try {
    const reg = await getLocalCompanyById(companyId);
    if (reg && isOfflineCompanyStorage(reg as { storageOption?: string })) {
      return localDefaults;
    }
    // PL Server staff/host — Firestore company/plans read mat (Save 30s hang).
    if (reg) {
      const { isServerGateCompany } = await import("@/lib/companyStorageKind");
      if (isServerGateCompany(reg as { plServerShared?: boolean })) return localDefaults;
      const { isLocalServerShareableCompany } = await import("@/lib/localServerShareableCompanies");
      if (isLocalServerShareableCompany(reg)) return localDefaults;
    }
  } catch {
    /* registry miss */
  }
  // Static/APK + device offline: `getDocFromServer` / company read mat — `saveVoucherOfflineLocalCreate` "Saving…" yahin atakta tha.
  if (apkEmbeddedSqliteFirstWritesPreferred() || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return localDefaults;
  }
  // Prefer server read so live settings (from Voucher Settings) apply immediately; fallback to cache if offline
  let companySnap;
  try {
    companySnap = await getDocFromServer(doc(firestore, "companies", companyId));
  } catch {
    companySnap = await getDoc(doc(firestore, "companies", companyId));
  }
  const companyData = companySnap.data() || {};
  const planId = (companyData?.planId as PlanId) || "basic";
  const defaultPlan = getPlan(planId);
  const plansSnap = await getDoc(doc(firestore, "app_settings", "plans"));
  const plansData = plansSnap.exists() ? plansSnap.data() : {};
  const fromFs = (plansData as any)?.[planId];
  const plan = fromFs
    ? { ...defaultPlan, ...fromFs, entitlements: { ...defaultPlan.entitlements, ...(fromFs.entitlements || {}) } }
    : defaultPlan;
  const planEnabled = plan.entitlements.voucherHistoryEnabled === true;
  const planLimitRaw = Number(plan.entitlements.voucherHistoryLimit) || 0;
  const planLimit = planLimitRaw > 0 ? Math.min(100, planLimitRaw) : 10;
  const companyEnabled = (companyData as any).voucherHistoryEnabled !== false;
  const companyLimit = Math.max(1, Math.min(100, Number((companyData as any).voucherHistoryLimit) || 10));
  const enabled = planEnabled && companyEnabled;
  const limit = enabled ? Math.min(companyLimit, planLimit) : 0;
  const fullBehavior = normalizeVoucherHistoryFullBehavior((companyData as any).voucherHistoryFullBehavior);
  return { enabled, limit, fullBehavior };
}

/** Returns the plan's max voucher history limit for a company. Used to cap company settings. */
export async function getPlanVoucherHistoryLimit(companyId: string): Promise<number> {
  if (isLocalOnlyMode()) {
    // Local-only mode me plan lookup Firestore se na karo; fallback cap use karo.
    return 10;
  }
  if (apkEmbeddedSqliteFirstWritesPreferred() || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return 10;
  }
  const companySnap = await getDoc(doc(firestore, "companies", companyId));
  const companyData = companySnap.data() || {};
  const planId = (companyData?.planId as PlanId) || "basic";
  const defaultPlan = getPlan(planId);
  const plansSnap = await getDoc(doc(firestore, "app_settings", "plans"));
  const plansData = plansSnap.exists() ? plansSnap.data() : {};
  const fromFs = (plansData as any)?.[planId];
  const plan = fromFs
    ? { ...defaultPlan, ...fromFs, entitlements: { ...defaultPlan.entitlements, ...(fromFs.entitlements || {}) } }
    : defaultPlan;
  const raw = Number(plan.entitlements.voucherHistoryLimit) || 0;
  return raw > 0 ? Math.min(100, raw) : 10;
}
