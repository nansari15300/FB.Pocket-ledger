import { serverDb } from "@/lib/server/appDb";
import { DEFAULT_PLANS, type PlanId } from "@/config/plans";
import {
  getEffectivePlanPrices as getNepalEffectivePlanPrices,
  getEffectivePlanPricesForRegion,
} from "@/lib/server/getEffectivePlanRegionalPrice";
import type { BillingRegionId } from "@/lib/billingRegions";

export {
  getBillingPricingSettings,
  getEffectiveRegionalCheckout,
  getEffectivePlanPricesForRegion,
  getEffectiveGrossForRegion,
  getMergedPlan,
} from "@/lib/server/getEffectivePlanRegionalPrice";

/** Admin-marked or default “free” SKU — used for one-click plan select without checkout. */
export async function getEffectivePlanIsFree(planId: PlanId): Promise<boolean> {
  const def = DEFAULT_PLANS[planId];
  if (def.isFree === true) return true;
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/plans").get();
    if (!snap.exists) return false;
    const row = (snap.data() as Record<string, { isFree?: boolean }>)[planId];
    return row?.isFree === true;
  } catch {
    return false;
  }
}

/** Firestore plans — Nepal region base (legacy name `Npr`). */
export async function getEffectivePlanPrices(planId: PlanId): Promise<{ monthly: number; yearly: number }> {
  return getNepalEffectivePlanPrices(planId);
}

export async function getEffectivePlanPricesRegional(
  planId: PlanId,
  region: BillingRegionId
) {
  return getEffectivePlanPricesForRegion(planId, region);
}
