import { serverDb } from "@/lib/server/appDb";
import { DEFAULT_PLANS, type Plan, type PlanId } from "@/config/plans";
import { mergeAppSettingsPlansDoc } from "@/lib/mergeAppSettingsPlans";
import type { BillingRegionId } from "@/lib/billingRegions";
import {
  DEFAULT_BILLING_PRICING_SETTINGS,
  resolveRegionalPlanPrices,
  type BillingPricingSettings,
} from "@/lib/billingRegionalPricing";
import { fetchLiveFxRatesServer } from "@/lib/liveFxRates";
import type { SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import { grossPriceNpr } from "@/lib/subscriptionPlanMath";
import { regionalCheckoutCharge } from "@/lib/billingRegionalPricing";

export async function getBillingPricingSettings(): Promise<BillingPricingSettings> {
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/billing_pricing").get();
    if (!snap.exists) return DEFAULT_BILLING_PRICING_SETTINGS;
    const d = snap.data() as Record<string, unknown>;
    return {
      baseCurrency: String(d.baseCurrency ?? "NPR").toUpperCase(),
      baseRegion: (d.baseRegion as BillingRegionId) ?? "nepal",
      updatedAtMs: typeof d.updatedAtMs === "number" ? d.updatedAtMs : undefined,
    };
  } catch {
    return DEFAULT_BILLING_PRICING_SETTINGS;
  }
}

export async function getMergedPlan(planId: PlanId): Promise<Plan> {
  const def = DEFAULT_PLANS[planId];
  try {
    const db = serverDb();
    const snap = await db.doc("app_settings/plans").get();
    const merged = mergeAppSettingsPlansDoc(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
    return merged.find((p) => p.id === planId) ?? def;
  } catch {
    return def;
  }
}

/** Server checkout — region prices + aaj ka FX fallback. */
export async function getEffectiveRegionalCheckout(
  planId: PlanId,
  termKey: SubscriptionTermKey,
  region: BillingRegionId
) {
  const settings = await getBillingPricingSettings();
  const plan = await getMergedPlan(planId);
  let fx = null;
  try {
    fx = await fetchLiveFxRatesServer(settings.baseCurrency);
  } catch (e) {
    console.warn("[getEffectiveRegionalCheckout] FX fetch failed", e);
  }
  return regionalCheckoutCharge(plan, termKey, region, fx, settings);
}

/** Back-compat: NPR Nepal base monthly/yearly. */
export async function getEffectivePlanPrices(planId: PlanId): Promise<{ monthly: number; yearly: number }> {
  const plan = await getMergedPlan(planId);
  const settings = await getBillingPricingSettings();
  let fx = null;
  try {
    fx = await fetchLiveFxRatesServer(settings.baseCurrency);
  } catch {
    /* ignore */
  }
  const p = resolveRegionalPlanPrices(plan, "nepal", fx, settings);
  return { monthly: p.monthly, yearly: p.yearly };
}

export async function getEffectivePlanPricesForRegion(
  planId: PlanId,
  region: BillingRegionId
): Promise<{ monthly: number; yearly: number; currency: string; symbol: string }> {
  const plan = await getMergedPlan(planId);
  const settings = await getBillingPricingSettings();
  let fx = null;
  try {
    fx = await fetchLiveFxRatesServer(settings.baseCurrency);
  } catch {
    /* ignore */
  }
  const p = resolveRegionalPlanPrices(plan, region, fx, settings);
  return { monthly: p.monthly, yearly: p.yearly, currency: p.currency, symbol: p.symbol };
}

export async function getEffectiveGrossForRegion(
  planId: PlanId,
  termKey: SubscriptionTermKey,
  region: BillingRegionId
): Promise<number> {
  const p = await getEffectivePlanPricesForRegion(planId, region);
  return grossPriceNpr(termKey, p.monthly, p.yearly);
}
