import { getCurrencySymbolForCode } from "@/lib/worldCurrencies";
import type { RegionalPlanPricesMap } from "@/lib/billingRegionalPricing";

export type PlanId = "basic" | "advance" | "pro" | "pro-plus";

/** Monotonic order for upgrade / downgrade UI (basic is 0). */
export const PLAN_TIER_ORDER: PlanId[] = ["basic", "advance", "pro", "pro-plus"];

/**
 * Firestore / admin / legacy strings → canonical SKU.
 * `proplus`, `Pro Plus`, `pro_plus` waghera ko map karo — warna strict `PLAN_TIER_ORDER.includes` fail ho kar shared user ko "Basic" dikh jata hai.
 * Core tier order + `higherPlanByTier` static build / web dono me yahi; ye helper har jagah ek hi canonical `planId` ensure karta hai.
 * Next API routes (`plan-change-checkout`, `sync-plan`, …) bhi isi ko import karein — strict match se `proplus` manual Firestore = galat `basic`.
 */
export function normalizePlanIdForClient(raw?: string | null): PlanId {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
  if (s === "proplus") return "pro-plus";
  if (PLAN_TIER_ORDER.includes(s as PlanId)) return s as PlanId;
  return "basic";
}

export function planTierIndex(planId?: string | null): number {
  const id = normalizePlanIdForClient(planId);
  const i = PLAN_TIER_ORDER.indexOf(id);
  return i >= 0 ? i : 0;
}

/**
 * Voucher quota / entitlements: Firestore `companies` kabhi purana `basic` chipkata hai jab SQLite mirror + UI `pro-plus` ho chuke hon —
 * dono source me se zyada paid tier lo.
 */
export function higherPlanByTier(
  firestorePlanId?: string | null,
  sqliteOrOtherPlanId?: string | null
): PlanId {
  const a = normalizePlanIdForClient(firestorePlanId);
  const b = normalizePlanIdForClient(sqliteOrOtherPlanId);
  const ia = planTierIndex(a);
  const ib = planTierIndex(b);
  return ib > ia ? b : a;
}

/** Next paid SKU above current (e.g. advance → pro). Null if already on top paid tier. */
export function getNextPaidUpgrade(fromPlanId?: string | null): PlanId | null {
  const cur = planTierIndex(fromPlanId);
  for (let t = cur + 1; t < PLAN_TIER_ORDER.length; t++) {
    const id = PLAN_TIER_ORDER[t];
    if (id !== "basic") return id;
  }
  return null;
}

export type BillingCycle = "monthly" | "yearly";

export type EntitlementKey =
  /** Max companies that may be linked to Firestore (manual “upload”); 0 = local-only unlimited. Offline/local rows do not count. */
  | "maxOnlineCompanies"
  | "maxUsers"
  | "maxCompanies"
  | "maxAttachmentsGB"
  | "maxStorageGB"
  /** Image post-compress ceiling (KB) for online companies. 0 = platform default (100 KB). */
  | "maxCompressImageKb"
  /** Image post-compress floor (KB) for online — compress output stays in [min, max]. 0 = platform default (50 KB). */
  | "minCompressImageKb"
  /** Same numeric caps as above, applied when `storageOption` is device-local (SQLite-first). Falls back to online key if unset. */
  | "maxUsersLocal"
  | "maxCompaniesLocal"
  | "maxAttachmentsGBLocal"
  | "maxCompressImageKbLocal"
  | "minCompressImageKbLocal"
  | "maxStorageGBLocal"
  | "dailyVoucherLimitLocal"
  | "monthlyVoucherLimitLocal"
  | "hasMultiDeviceSync"
  | "maxDevices"
  /** Billing chart + admin: cloud vs SQLite-first company — abhi runtime limit same; alag SKU future ke liye. */
  | "maxDevicesLocal"
  | "hasPrioritySupport"
  | "hasAuditLogs"
  | "hasRoleBasedAccess"
  | "dailyVoucherLimit"
  | "monthlyVoucherLimit"
  | "allowCompanyAdminRecycleBin"
  | "canAddAvatar"
  | "canAddFileImagePdf"
  | "maxVoucherFileCount"
  /** Plan-wise: enable voucher edit history. */
  | "voucherHistoryEnabled"
  /** Plan-wise: max history entries per voucher (1–100). 0 = use default 10. */
  | "voucherHistoryLimit"
  /** Plan-wise: Inter Company voucher create/edit (admin tick). Missing = off. */
  | "interCompanyVoucherEnabled"
  /** Max joined inter-company partner companies (Join tab). 0 = none; -1 = unlimited. */
  | "maxInterCompanyPartners"
  /** Plan-wise: APK/EXE saved account quick switch on login + logout save. */
  | "savedAccountSwitchEnabled"
  /** Plan-wise: Share for Reconciliation (header + cross-user ledger match). */
  | "shareForReconciliationEnabled"
  /** Max ledgers a user can join/share for reconciliation. 0 = none; -1 = unlimited. */
  | "maxReconciliationLedgers"
  /** Backup/restore `.plbp` me attachment bytes embed + restore (Option A). Off = data-only URLs. */
  | "attachmentBackupRestoreEnabled"
  /** Per owner per calendar month — attachment wala backup count; 0 = none; -1 = unlimited. */
  | "maxAttachmentBackupPerMonth"
  /** Per owner per calendar month — attachment wala restore count; 0 = none; -1 = unlimited. */
  | "maxAttachmentRestorePerMonth"
  /** Local company → cloud upload: max attachment payload (MB); 0 = none; -1 = unlimited. */
  | "maxLocalToOnlineAttachmentMB"
  /** Online Firestore companies (`storageOption: firebase`) — off = create/edit me local/online choice hide. */
  | "allowFirebaseOnlineCompanies"
  /** Google Drive sync for device-local companies. */
  | "googleDriveSyncEnabled"
  /** Per owner: local companies that may actively sync to Google Drive. 0 = none; -1 = unlimited. */
  | "maxGoogleDriveSyncCompanies"
  /** Per Drive-synced company: owner + shared Drive users. 0 = no sharing; -1 = unlimited. */
  | "maxGoogleDriveSyncUsers"
  /** EXE LAN server (Settings → Server) — share local companies on network. */
  | "allowLocalAppServer"
  /** Plan-wise: freeze party / bank / staff / tax master accounts. */
  | "masterAccountFreezeEnabled"
  /** Plan-wise: local OCR voucher autofill (Add Voucher). Missing/undefined = enabled. */
  | "ocrVoucherAutofillEnabled"
  /** Plan-wise: HR module (employees / attendance / leaves / payroll). Missing/undefined = disabled. */
  | "hrModuleEnabled";

export type Entitlements = Record<EntitlementKey, number | boolean>;

/**
 * Admin / plan caps:
 * - `0` = exact zero / not allowed
 * - `-1` = unlimited
 * - `> 0` = that hard limit
 */
export const UNLIMITED_ENTITLEMENT = -1;

export function isUnlimitedEntitlementCap(n: number | null | undefined): boolean {
  const v = Number(n);
  return Number.isFinite(v) && v < 0;
}

export function isZeroEntitlementCap(n: number | null | undefined): boolean {
  const v = Number(n);
  return Number.isFinite(v) && v === 0;
}

/** Prefer unlimited when either side is unlimited; else the larger finite cap. */
export function maxEntitlementCap(a: number, b: number): number {
  if (isUnlimitedEntitlementCap(a) || isUnlimitedEntitlementCap(b)) return UNLIMITED_ENTITLEMENT;
  const na = Number(a);
  const nb = Number(b);
  return Math.max(Number.isFinite(na) ? na : 0, Number.isFinite(nb) ? nb : 0);
}

/** Profile / billing / admin table label for numeric caps. */
export function formatEntitlementCapLabel(n: number | null | undefined): string {
  if (isUnlimitedEntitlementCap(n)) return "Unlimited";
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return String(v);
}

/** `used >= cap` when cap is finite (including exact 0); never “full” when unlimited. */
export function isAtOrOverEntitlementCap(used: number, cap: number): boolean {
  if (isUnlimitedEntitlementCap(cap)) return false;
  const c = Number(cap);
  if (!Number.isFinite(c)) return true;
  return used >= c;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** ISO 4217 — admin base catalog currency (`billing_pricing.baseCurrency`). */
  currency: string;
  price: {
    monthly: number; // price per month in currency units (e.g., NPR)
    yearly: number;  // discounted annual price (12m - discount)
  };
  /** Nepal / SAARC / International — admin alag rate; user country se region pick. */
  regionalPrices?: RegionalPlanPricesMap;
  commissionRate?: number; // Commission percentage for distributors
  isFree?: boolean; // Mark plan as free regardless of price
  discountPercentage?: number;
  limitedTimeOfferDate?: any;
  /**
   * Derived per-tier mirror of the catalog-level `onlineDemo` offer.
   * Only the selected demo planId is enabled; other tiers stay off.
   */
  demo?: {
    enabled: boolean;
    /** Full demo length granted when an owner activates this tier (1–999 days). */
    days: number;
  };
  highlight?: boolean; // For UI emphasis (e.g., popular)
  /** Super Admin: hide tier from Billing plan matrix — does not revoke active subscribers. */
  hiddenFromBilling?: boolean;
  entitlements: Entitlements;
  features: string[]; // Human friendly bullets for UI
}

/** Billing comparison columns — hidden tiers omitted for all users (active subscriptions unchanged). */
export function plansVisibleOnBillingPage(plans: Plan[]): Plan[] {
  return plans.filter((p) => p.hiddenFromBilling !== true);
}

/** Paid tiers that may be offered as the single online demo. */
export type OnlineDemoPlanId = Exclude<PlanId, "basic">;

/** One catalog-level demo offer — Admin list card under Pro Plus. */
export type OnlineDemoOffer = {
  enabled: boolean;
  days: number;
  planId: OnlineDemoPlanId;
  /**
   * When false, an owner who already finished a demo cannot click Demo again
   * to get another full period. First-time activation is always allowed.
   */
  allowExtendAfterExpiry: boolean;
};

export const ONLINE_DEMO_PLAN_IDS: OnlineDemoPlanId[] = ["advance", "pro", "pro-plus"];

export const DEFAULT_ONLINE_DEMO_OFFER: OnlineDemoOffer = {
  enabled: true,
  days: 100,
  planId: "pro-plus",
  allowExtendAfterExpiry: false,
};

export function clampOnlineDemoDays(raw: unknown): number {
  return Math.min(999, Math.max(1, Math.floor(Number(raw) || 1)));
}

export function sanitizeOnlineDemoOffer(raw: unknown): OnlineDemoOffer {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const planIdRaw = String(row.planId || "").trim().toLowerCase();
  const planId = (ONLINE_DEMO_PLAN_IDS as readonly string[]).includes(planIdRaw)
    ? (planIdRaw as OnlineDemoPlanId)
    : DEFAULT_ONLINE_DEMO_OFFER.planId;
  return {
    enabled: row.enabled === true,
    days: clampOnlineDemoDays(row.days ?? DEFAULT_ONLINE_DEMO_OFFER.days),
    planId,
    allowExtendAfterExpiry: row.allowExtendAfterExpiry === true,
  };
}

export const DEFAULT_PLANS: Record<PlanId, Plan> = {
  basic: {
    id: "basic",
    name: "Basic",
    tagline: "Solo / starter use",
    currency: "NPR",
    price: { monthly: 0, yearly: 0 }, // Free tier
    commissionRate: 0,
    isFree: true,
    highlight: false,
    entitlements: {
      maxOnlineCompanies: 0,
      maxUsers: 1,
      maxCompanies: 1,
      maxAttachmentsGB: 1,
      maxStorageGB: 1,
      maxCompressImageKb: 100,
      minCompressImageKb: 50,
      maxUsersLocal: 1,
      maxCompaniesLocal: 1,
      maxAttachmentsGBLocal: 1,
      maxStorageGBLocal: 1,
      maxCompressImageKbLocal: 150,
      minCompressImageKbLocal: 50,
      dailyVoucherLimit: 25,
      monthlyVoucherLimit: 500,
      dailyVoucherLimitLocal: 25,
      monthlyVoucherLimitLocal: 500,
      hasMultiDeviceSync: false,
      maxDevices: 1,
      maxDevicesLocal: 1,
      hasPrioritySupport: false,
      hasAuditLogs: false,
      hasRoleBasedAccess: false,
      allowCompanyAdminRecycleBin: false,
      canAddAvatar: false,
      canAddFileImagePdf: false,
      maxVoucherFileCount: 0,
      voucherHistoryEnabled: false,
      voucherHistoryLimit: 0,
      interCompanyVoucherEnabled: false,
      maxInterCompanyPartners: 1,
      shareForReconciliationEnabled: false,
      maxReconciliationLedgers: 0,
      attachmentBackupRestoreEnabled: false,
      maxAttachmentBackupPerMonth: 0,
      maxAttachmentRestorePerMonth: 0,
      maxLocalToOnlineAttachmentMB: 0,
      savedAccountSwitchEnabled: false,
      allowFirebaseOnlineCompanies: false,
      googleDriveSyncEnabled: false,
      maxGoogleDriveSyncCompanies: 0,
      maxGoogleDriveSyncUsers: 0,
      allowLocalAppServer: false,
      masterAccountFreezeEnabled: false,
      ocrVoucherAutofillEnabled: true,
      hrModuleEnabled: false,
    },
    features: [
      "Unlimited local (offline) companies",
      "0 online cloud companies (local-only sync)",
      "Single user",
      "1 GB storage & attachments",
      "Single device login",
      "Local backup export",
    ],
  },
  advance: {
    id: "advance",
    name: "Advance",
    tagline: "Small teams & growing firms",
    currency: "NPR",
    price: { monthly: 999, yearly: 9990 }, // ~2 months off
    commissionRate: 5,
    isFree: false,
    highlight: true,
    entitlements: {
      maxOnlineCompanies: 1,
      maxUsers: 5,
      maxCompanies: 3,
      maxAttachmentsGB: 10,
      maxStorageGB: 10,
      maxCompressImageKb: 100,
      minCompressImageKb: 50,
      maxUsersLocal: 5,
      maxCompaniesLocal: 3,
      maxAttachmentsGBLocal: 10,
      maxStorageGBLocal: 10,
      maxCompressImageKbLocal: 150,
      minCompressImageKbLocal: 50,
      dailyVoucherLimit: 100,
      monthlyVoucherLimit: 2500,
      dailyVoucherLimitLocal: 100,
      monthlyVoucherLimitLocal: 2500,
      hasMultiDeviceSync: true,
      maxDevices: 3,
      maxDevicesLocal: 3,
      hasPrioritySupport: false,
      hasAuditLogs: true,
      hasRoleBasedAccess: true,
      allowCompanyAdminRecycleBin: true,
      canAddAvatar: true,
      canAddFileImagePdf: true,
      maxVoucherFileCount: 3,
      voucherHistoryEnabled: true,
      voucherHistoryLimit: 10,
      interCompanyVoucherEnabled: false,
      maxInterCompanyPartners: 3,
      shareForReconciliationEnabled: false,
      maxReconciliationLedgers: 0,
      attachmentBackupRestoreEnabled: true,
      maxAttachmentBackupPerMonth: 2,
      maxAttachmentRestorePerMonth: 2,
      maxLocalToOnlineAttachmentMB: 500,
      savedAccountSwitchEnabled: true,
      allowFirebaseOnlineCompanies: true,
      googleDriveSyncEnabled: true,
      maxGoogleDriveSyncCompanies: 1,
      // Same as maxUsersLocal — Drive share cannot exceed local company users.
      maxGoogleDriveSyncUsers: 5,
      allowLocalAppServer: true,
      masterAccountFreezeEnabled: true,
      ocrVoucherAutofillEnabled: true,
      hrModuleEnabled: true,
    },
    features: [
      "1 online company + unlimited offline",
      "Up to 5 users",
      "3 companies",
      "10 GB storage & attachments",
      "Multi-device sync (up to 3 devices)",
      "Role based access",
      "Audit logs",
      "Email support (24–48h)",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Agencies & enterprises",
    currency: "NPR",
    price: { monthly: 2499, yearly: 24990 }, // ~2 months off
    commissionRate: 5,
    isFree: false,
    highlight: false,
    entitlements: {
      maxOnlineCompanies: 3,
      maxUsers: 50,
      maxCompanies: 25,
      maxAttachmentsGB: 200,
      maxStorageGB: 200,
      maxCompressImageKb: 100,
      minCompressImageKb: 50,
      maxUsersLocal: 50,
      maxCompaniesLocal: 25,
      maxAttachmentsGBLocal: 200,
      maxStorageGBLocal: 200,
      maxCompressImageKbLocal: 150,
      minCompressImageKbLocal: 50,
      dailyVoucherLimit: -1, // unlimited
      monthlyVoucherLimit: -1, // unlimited
      dailyVoucherLimitLocal: -1,
      monthlyVoucherLimitLocal: -1,
      hasMultiDeviceSync: true,
      maxDevices: 10,
      maxDevicesLocal: 10,
      hasPrioritySupport: true,
      hasAuditLogs: true,
      hasRoleBasedAccess: true,
      allowCompanyAdminRecycleBin: true,
      canAddAvatar: true,
      canAddFileImagePdf: true,
      maxVoucherFileCount: 5,
      voucherHistoryEnabled: true,
      voucherHistoryLimit: 20,
      interCompanyVoucherEnabled: false,
      maxInterCompanyPartners: 10,
      shareForReconciliationEnabled: true,
      maxReconciliationLedgers: 10,
      attachmentBackupRestoreEnabled: true,
      maxAttachmentBackupPerMonth: 5,
      maxAttachmentRestorePerMonth: 5,
      maxLocalToOnlineAttachmentMB: 2000,
      savedAccountSwitchEnabled: true,
      allowFirebaseOnlineCompanies: true,
      googleDriveSyncEnabled: true,
      maxGoogleDriveSyncCompanies: 3,
      maxGoogleDriveSyncUsers: 50, // = maxUsersLocal
      allowLocalAppServer: true,
      masterAccountFreezeEnabled: true,
      ocrVoucherAutofillEnabled: true,
      hrModuleEnabled: true,
    },
    features: [
      "3 online companies + unlimited offline",
      "Up to 50 users",
      "25 companies",
      "200 GB storage & attachments",
      "Multi-device sync (up to 10 devices)",
      "Priority support (SLA)",
      "Advanced audit & backups",
    ],
  },
  "pro-plus": {
    id: "pro-plus",
    name: "Pro Plus",
    tagline: "For large-scale operations",
    currency: "NPR",
    price: { monthly: 4999, yearly: 49990 },
    commissionRate: 5,
    isFree: false,
    highlight: false,
    entitlements: {
      maxOnlineCompanies: 10,
      maxUsers: 100,
      maxCompanies: 100,
      maxAttachmentsGB: 500,
      maxStorageGB: 500,
      maxCompressImageKb: 100,
      minCompressImageKb: 50,
      maxUsersLocal: 100,
      maxCompaniesLocal: 100,
      maxAttachmentsGBLocal: 500,
      maxStorageGBLocal: 500,
      maxCompressImageKbLocal: 150,
      minCompressImageKbLocal: 50,
      dailyVoucherLimit: -1, // unlimited
      monthlyVoucherLimit: -1, // unlimited
      dailyVoucherLimitLocal: -1,
      monthlyVoucherLimitLocal: -1,
      hasMultiDeviceSync: true,
      maxDevices: 25,
      maxDevicesLocal: 25,
      hasPrioritySupport: true,
      hasAuditLogs: true,
      hasRoleBasedAccess: true,
      allowCompanyAdminRecycleBin: true,
      canAddAvatar: true,
      canAddFileImagePdf: true,
      maxVoucherFileCount: 5,
      voucherHistoryEnabled: true,
      voucherHistoryLimit: 50,
      interCompanyVoucherEnabled: false,
      maxInterCompanyPartners: -1,
      shareForReconciliationEnabled: true,
      maxReconciliationLedgers: -1,
      attachmentBackupRestoreEnabled: true,
      maxAttachmentBackupPerMonth: 10,
      maxAttachmentRestorePerMonth: 10,
      maxLocalToOnlineAttachmentMB: 5000,
      savedAccountSwitchEnabled: true,
      allowFirebaseOnlineCompanies: true,
      googleDriveSyncEnabled: true,
      maxGoogleDriveSyncCompanies: 10,
      maxGoogleDriveSyncUsers: 100, // = maxUsersLocal
      allowLocalAppServer: true,
      masterAccountFreezeEnabled: true,
      ocrVoucherAutofillEnabled: true,
      hrModuleEnabled: true,
    },
    features: [
      "10 online companies + unlimited offline",
      "Up to 100 users",
      "100 companies",
      "500 GB storage & attachments",
      "Multi-device sync (up to 25 devices)",
      "Dedicated support",
      "Advanced audit & backups",
    ],
  },
};

// ---------- Helpers ----------
export function getPlan(planId?: PlanId | null): Plan {
  if (!planId) return DEFAULT_PLANS.basic;
  return DEFAULT_PLANS[planId] ?? DEFAULT_PLANS.basic;
}

export function isFeatureEnabled(
  planId: PlanId,
  key: Exclude<
    EntitlementKey,
    | "maxUsers"
    | "maxCompanies"
    | "maxAttachmentsGB"
    | "maxStorageGB"
    | "maxUsersLocal"
    | "maxCompaniesLocal"
    | "maxAttachmentsGBLocal"
    | "maxStorageGBLocal"
    | "dailyVoucherLimit"
    | "monthlyVoucherLimit"
    | "dailyVoucherLimitLocal"
    | "monthlyVoucherLimitLocal"
    | "maxDevices"
    | "maxDevicesLocal"
    | "voucherHistoryLimit"
  >
): boolean {
  const p = getPlan(planId);
  const v = p.entitlements[key];
  return typeof v === "boolean" ? v : false;
}

export function limitFor(
  planId: PlanId,
  key: Extract<
    EntitlementKey,
    | "maxOnlineCompanies"
    | "maxUsers"
    | "maxCompanies"
    | "maxAttachmentsGB"
    | "maxStorageGB"
    | "maxUsersLocal"
    | "maxCompaniesLocal"
    | "maxAttachmentsGBLocal"
    | "maxStorageGBLocal"
    | "dailyVoucherLimit"
    | "monthlyVoucherLimit"
    | "dailyVoucherLimitLocal"
    | "monthlyVoucherLimitLocal"
    | "maxDevices"
    | "maxDevicesLocal"
    | "voucherHistoryLimit"
    | "maxInterCompanyPartners"
    | "maxReconciliationLedgers"
    | "maxAttachmentBackupPerMonth"
    | "maxAttachmentRestorePerMonth"
    | "maxLocalToOnlineAttachmentMB"
    | "maxGoogleDriveSyncCompanies"
    | "maxGoogleDriveSyncUsers"
  >
): number {
  const p = getPlan(planId);
  const v = p.entitlements[key];
  return typeof v === "number" ? v : 0;
}

/** Keys that share online (`baseKey`) + local (`*Local`) entitlements — admin PlanDetails + `numericEntitlement`. */
export type NumericEntitlementBaseKey =
  | "maxUsers"
  | "maxCompanies"
  | "maxAttachmentsGB"
  | "maxStorageGB"
  | "dailyVoucherLimit"
  | "monthlyVoucherLimit";

const LOCAL_NUMERIC_ENTITLEMENT_KEY: Record<NumericEntitlementBaseKey, EntitlementKey> = {
  maxUsers: "maxUsersLocal",
  maxCompanies: "maxCompaniesLocal",
  maxAttachmentsGB: "maxAttachmentsGBLocal",
  maxStorageGB: "maxStorageGBLocal",
  dailyVoucherLimit: "dailyVoucherLimitLocal",
  monthlyVoucherLimit: "monthlyVoucherLimitLocal",
};

/** App-wide: missing `storageOption` → treat as device-local (matches `isOfflineCompanyStorage`). */
export function companyStorageIsLocal(storageOption?: string | null): boolean {
  return String(storageOption || "local").toLowerCase() === "local";
}

/**
 * Read plan cap for cloud vs SQLite-first company. Local key missing (old Firestore) → use online value.
 * Caps: `0` = none / not allowed; `-1` = unlimited; `>0` = hard limit.
 */
export function numericEntitlement(
  entitlements: Partial<Entitlements> | undefined,
  baseKey: NumericEntitlementBaseKey,
  useLocalLimit: boolean
): number {
  const e = entitlements ?? ({} as Partial<Entitlements>);
  if (useLocalLimit) {
    const lk = LOCAL_NUMERIC_ENTITLEMENT_KEY[baseKey];
    const lv = e[lk];
    const bv = e[baseKey];
    const isVoucherQuota = baseKey === "dailyVoucherLimit" || baseKey === "monthlyVoucherLimit";
    const localN = typeof lv === "number" && Number.isFinite(lv) ? lv : null;
    const baseN = typeof bv === "number" && Number.isFinite(bv) ? bv : null;
    if (isVoucherQuota) {
      // Prefer the local bucket when set (including exact 0 = blocked).
      if (localN != null) return localN;
      if (baseN != null) return baseN;
      return 0;
    }
    if (localN != null) return localN;
  }
  const v = e[baseKey];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Online-bucket caps — `allowFirebaseOnlineCompanies === false` par exact 0 (legacy migrate mat karo). */
export const ONLINE_ENTITLEMENT_CAP_KEYS = [
  "maxUsers",
  "maxCompanies",
  "maxAttachmentsGB",
  "maxStorageGB",
  "dailyVoucherLimit",
  "monthlyVoucherLimit",
  "maxDevices",
  "maxOnlineCompanies",
  "maxLocalToOnlineAttachmentMB",
] as const satisfies ReadonlyArray<EntitlementKey>;

export function isOnlineEntitlementCapKey(key: EntitlementKey): boolean {
  return (ONLINE_ENTITLEMENT_CAP_KEYS as readonly string[]).includes(key);
}

/** Keys that historically treated `0` as unlimited before `zero_means_none`. */
export const LEGACY_ZERO_MEANT_UNLIMITED_KEYS = [
  "dailyVoucherLimit",
  "dailyVoucherLimitLocal",
  "monthlyVoucherLimit",
  "monthlyVoucherLimitLocal",
  "maxInterCompanyPartners",
  "maxReconciliationLedgers",
  "maxAttachmentBackupPerMonth",
  "maxAttachmentRestorePerMonth",
  "maxLocalToOnlineAttachmentMB",
  "maxUsers",
  "maxUsersLocal",
  "maxCompanies",
  "maxCompaniesLocal",
  "maxAttachmentsGB",
  "maxAttachmentsGBLocal",
  "maxStorageGB",
  "maxStorageGBLocal",
  "maxDevices",
  "maxDevicesLocal",
] as const satisfies ReadonlyArray<EntitlementKey>;

/** In-memory only until `app_settings/plans.entitlementCapConvention === "zero_means_none"`. */
export function migrateLegacyUnlimitedZeroEntitlements(
  entitlements: Partial<Entitlements> | undefined
): Partial<Entitlements> {
  if (!entitlements) return {};
  const out: Partial<Entitlements> = { ...entitlements };
  const onlineOff = out.allowFirebaseOnlineCompanies === false;
  for (const key of LEGACY_ZERO_MEANT_UNLIMITED_KEYS) {
    // Allow-online OFF + exact 0 must stay "none", not become unlimited.
    if (onlineOff && isOnlineEntitlementCapKey(key)) continue;
    if (out[key] === 0) out[key] = UNLIMITED_ENTITLEMENT;
  }
  return out;
}

export function formatPrice(
  plan: Plan,
  cycle: BillingCycle = "monthly",
  forceShowPrice = false,
  /** Company/user display symbol — billing page `useDisplayCurrency` se pass karo. */
  displaySymbolOverride?: string
): string {
  if (plan.isFree && !forceShowPrice) return "Free";
  const amount = plan.price[cycle];
  const suffix =
    displaySymbolOverride?.trim() ||
    getCurrencySymbolForCode(plan.currency) ||
    plan.currency;
  if (amount === 0 && !forceShowPrice) return "Free";
  return `${suffix} ${amount.toLocaleString("en-IN")}/${cycle === "monthly" ? "mo" : "yr"}`;
}
