"use client";

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { resolvePlanIdForActiveCompany } from "@/lib/accountPlanForOwner";
import type { EntitlementKey } from "@/config/plans";

const HR_ENTITLEMENT_KEY: EntitlementKey = "hrModuleEnabled";

/**
 * HR module gate — `useMasterAccountFreezeFeature` jaisa:
 * company.settings.hrModuleEnabled (boolean) override pehle, warna active plan `entitlements.hrModuleEnabled === true`.
 * Phir `can("hr_view")` AND. SuperAdmin hamesha pass.
 * Server bhi 403 `hr_disabled` se enforce karta hai — ye sirf UI gate hai.
 */
export function useHrModuleFeature() {
  const { customUser, loading: authLoading } = useAuth() as ReturnType<typeof useAuth> & { loading?: boolean };
  const { company, allCompanies, loading: companyLoading } = useCompany() as ReturnType<typeof useCompany> & {
    loading?: boolean;
  };
  const { can, permissionsResolved } = usePermissions() as ReturnType<typeof usePermissions> & {
    permissionsResolved?: boolean;
  };
  const livePlans = useLivePlans();

  const isSuperAdmin = customUser?.role === "SuperAdmin";

  const planEnabled = useMemo(() => {
    if (!company) return false;
    const planId = resolvePlanIdForActiveCompany(
      company,
      allCompanies,
      customUser?.uid,
      customUser?.email
    );
    const plan = getPlanFromPlans(livePlans, planId);
    const companyOverride = (company as { settings?: Record<string, unknown> } | null)?.settings?.[
      HR_ENTITLEMENT_KEY
    ];
    if (typeof companyOverride === "boolean") return companyOverride;
    return plan.entitlements[HR_ENTITLEMENT_KEY] === true;
  }, [company, allCompanies, customUser?.uid, customUser?.email, livePlans]);

  const loading =
    authLoading === true ||
    companyLoading === true ||
    (!isSuperAdmin && permissionsResolved === false);

  const enabled = isSuperAdmin || (planEnabled && can("hr_view"));

  return {
    enabled,
    loading,
    planEnabled: isSuperAdmin || planEnabled,
    canManage: enabled && (isSuperAdmin || can("hr_manage")),
    canAttendance: enabled && (isSuperAdmin || can("hr_attendance")),
    canApproveLeave: enabled && (isSuperAdmin || can("hr_leave_approve")),
    canPayroll: enabled && (isSuperAdmin || can("hr_payroll")),
  };
}
