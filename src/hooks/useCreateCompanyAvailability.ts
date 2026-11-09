"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useCachedFeatureConfig } from "@/hooks/useCachedFeatureConfig";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { resolveEffectiveAccountPlanId } from "@/lib/accountPlanForOwner";
import {
  EMPTY_PURCHASED_PLAN_ADDONS,
  parsePurchasedPlanAddOns,
  type PurchasedPlanAddOns,
} from "@/lib/planAddOns";
import {
  computeCreateCompanyAvailability,
  type CreateCompanyAvailability,
} from "@/lib/createCompanyAvailability";
import type { PlanId } from "@/config/plans";

export function useCreateCompanyAvailability(): {
  availability: CreateCompanyAvailability;
  loading: boolean;
  accountPlanId: PlanId;
  accountPlan: ReturnType<typeof getPlanFromPlans>;
  ownerAddons: PurchasedPlanAddOns;
} {
  const { user, customUser } = useAuth();
  const { featureConfig, loading: featureLoading } = useCachedFeatureConfig();
  const { allCompanies, allCompaniesRegistry, company } = useCompany();
  const livePlans = useLivePlans();
  const companyRowsForCreate = useMemo(
    () => (allCompaniesRegistry?.length ? allCompaniesRegistry : allCompanies),
    [allCompaniesRegistry, allCompanies]
  );
  const accountPlanId = useMemo(
    () =>
      customUser?.accountCanonicalPlanId
        ? (customUser.accountCanonicalPlanId as PlanId)
        : resolveEffectiveAccountPlanId(companyRowsForCreate, user?.uid, company?.planId),
    [customUser?.accountCanonicalPlanId, companyRowsForCreate, user?.uid, company?.planId]
  );
  const accountPlan = useMemo(
    () => getPlanFromPlans(livePlans, accountPlanId),
    [accountPlanId, livePlans]
  );
  const [ownerAddons, setOwnerAddons] = useState<PurchasedPlanAddOns>(EMPTY_PURCHASED_PLAN_ADDONS);
  const [addonsReady, setAddonsReady] = useState(false);

  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setOwnerAddons(EMPTY_PURCHASED_PLAN_ADDONS);
      setAddonsReady(true);
      return;
    }
    setAddonsReady(false);
    const unsub = onSnapshot(
      doc(firestore, "users", uid),
      (snap) => {
        setOwnerAddons(parsePurchasedPlanAddOns(snap.exists() ? (snap.data() as Record<string, unknown>) : null));
        setAddonsReady(true);
      },
      () => {
        setOwnerAddons(EMPTY_PURCHASED_PLAN_ADDONS);
        setAddonsReady(true);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  const availability = useMemo(
    () =>
      computeCreateCompanyAvailability({
        featureConfig,
        planId: accountPlanId,
        plan: accountPlan,
        ownerAddons,
        companyRows: companyRowsForCreate,
        ownerUid: user?.uid,
      }),
    [featureConfig, accountPlanId, accountPlan, ownerAddons, companyRowsForCreate, user?.uid]
  );

  return {
    availability,
    loading: featureLoading || !addonsReady,
    accountPlanId,
    accountPlan,
    ownerAddons,
  };
}
