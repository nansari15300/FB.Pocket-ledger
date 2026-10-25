import type { Plan, PlanId } from "@/config/plans";
import type { Permission } from "@/lib/permissions";
import {
  isDeviceLocalCompany,
  isServerGateCompany,
  type CompanyStorageRow,
} from "@/lib/companyStorageKind";
import { planAllowsInterCompanyVoucher } from "@/lib/planSyncEntitlements";

type CompanyRow = (CompanyStorageRow & { isOwned?: boolean }) | null | undefined;

/** Header button + voucher tab — online plan tick + shared-user IC create permission. */
export function isInterCompanyVoucherFeatureDisabled(options: {
  company: CompanyRow;
  planId: PlanId | string | null | undefined;
  livePlan?: Plan | null;
  can?: (permission: Permission) => boolean;
}): boolean {
  const { company, planId, livePlan, can } = options;
  if (company && (isDeviceLocalCompany(company) || isServerGateCompany(company))) return true;
  if (!planAllowsInterCompanyVoucher(planId, livePlan)) return true;
  if (company?.isOwned === false && can && !can("create_inter_company_voucher")) return true;
  return false;
}

/** Shared user edit — Manage Sharing → Edit IC voucher. Owner/admin skip. */
export function sharedUserCanEditInterCompanyVoucher(
  company: CompanyRow,
  can: (permission: Permission) => boolean
): boolean {
  if (company?.isOwned !== false) return true;
  return can("edit_inter_company_voucher");
}

/** IC approve (either side) - owner/admin always; shared user needs "Approve IC voucher". */
export function sharedUserCanApproveInterCompanyVoucher(
  company: CompanyRow,
  can: (permission: Permission) => boolean
): boolean {
  if (company?.isOwned !== false) return true;
  return can("approve_inter_company_voucher");
}
