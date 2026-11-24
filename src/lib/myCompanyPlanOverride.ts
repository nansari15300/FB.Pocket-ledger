/**
 * My Company (`server-manage-company`) is the server's own books — not an end-user
 * subscription. Plan SKUs (Basic / Pro Plus / …) apply only to retailers; here every
 * cap is forced unlimited (beyond even Pro Plus file/day limits).
 */
import { DEFAULT_PLANS, type Entitlements, type Plan, type PlanId } from "@/config/plans";
import {
  isPackedServerManageCompany,
  SERVER_MANAGE_COMPANY_ID,
} from "@/lib/plServerPackedApp";

export function isMyCompanyPlanExempt(
  companyOrId: { id?: unknown; name?: unknown; interCompanyCompanyCode?: unknown } | string | null | undefined
): boolean {
  if (companyOrId == null || companyOrId === "") return false;
  if (typeof companyOrId === "string") {
    return String(companyOrId).trim() === SERVER_MANAGE_COMPANY_ID;
  }
  return isPackedServerManageCompany(companyOrId);
}

/** Display / storage plan id — catalog still has a row; entitlements are overridden. */
export const MY_COMPANY_PLAN_ID: PlanId = "pro-plus";

/** Full unlimited entitlements for My Company (overrides Pro Plus caps too). */
export function myCompanyUnlimitedEntitlements(): Entitlements {
  const base = { ...DEFAULT_PLANS["pro-plus"].entitlements };
  return {
    ...base,
    maxOnlineCompanies: -1,
    maxUsers: -1,
    maxCompanies: -1,
    maxAttachmentsGB: -1,
    maxStorageGB: -1,
    maxUsersLocal: -1,
    maxCompaniesLocal: -1,
    maxAttachmentsGBLocal: -1,
    maxStorageGBLocal: -1,
    maxCompressImageKb: 150,
    minCompressImageKb: 50,
    maxCompressImageKbLocal: 150,
    minCompressImageKbLocal: 50,
    dailyVoucherLimit: -1,
    monthlyVoucherLimit: -1,
    dailyVoucherLimitLocal: -1,
    monthlyVoucherLimitLocal: -1,
    hasMultiDeviceSync: true,
    maxDevices: -1,
    maxDevicesLocal: -1,
    hasPrioritySupport: true,
    hasAuditLogs: true,
    hasRoleBasedAccess: true,
    allowCompanyAdminRecycleBin: true,
    canAddAvatar: true,
    canAddFileImagePdf: true,
    maxVoucherFileCount: 10,
    voucherHistoryEnabled: true,
    voucherHistoryLimit: 100,
    interCompanyVoucherEnabled: true,
    maxInterCompanyPartners: -1,
    shareForReconciliationEnabled: true,
    maxReconciliationLedgers: -1,
    attachmentBackupRestoreEnabled: true,
    maxAttachmentBackupPerMonth: -1,
    maxAttachmentRestorePerMonth: -1,
    maxLocalToOnlineAttachmentMB: -1,
    savedAccountSwitchEnabled: true,
    allowFirebaseOnlineCompanies: true,
    googleDriveSyncEnabled: true,
    maxGoogleDriveSyncCompanies: -1,
    maxGoogleDriveSyncUsers: -1,
    allowLocalAppServer: true,
    masterAccountFreezeEnabled: true,
    ocrVoucherAutofillEnabled: true,
    ocrServerKeyAllowed: true,
    ocrUserKeyAllowed: true,
    hrModuleEnabled: true,
  };
}

export function myCompanyUnlimitedPlan(): Plan {
  return {
    ...DEFAULT_PLANS["pro-plus"],
    id: MY_COMPANY_PLAN_ID,
    name: "My Company (unlimited)",
    tagline: "Server books — plan limits do not apply",
    isFree: true,
    entitlements: myCompanyUnlimitedEntitlements(),
  };
}

/** Merge helper: if My Company, replace entitlements; else return input. */
export function applyMyCompanyEntitlementOverride(
  companyOrId: { id?: unknown } | string | null | undefined,
  entitlements: Entitlements
): Entitlements {
  return isMyCompanyPlanExempt(companyOrId) ? myCompanyUnlimitedEntitlements() : entitlements;
}
