"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/plClientSession";
import type { Plan } from "@/config/plans";
import {
  BILLING_REGIONS,
  billingRegionToDefaultCountry,
  countryToBillingRegion,
  type BillingRegionId,
} from "@/lib/billingRegions";
import {
  DEFAULT_BILLING_PRICING_SETTINGS,
  formatPlanPriceForCountry,
  formatRegionalMoney,
  regionalCheckoutChargeForCountry,
  resolveRegionalPlanPrices,
  type BillingPricingSettings,
} from "@/lib/billingRegionalPricing";
import type { FxRatesSnapshot } from "@/lib/liveFxRates";
import type { SubscriptionTermKey } from "@/lib/subscriptionPlanMath";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { getDefaultCurrencyForCountry } from "@/lib/worldCurrencies";

/**
 * Plan prices — user country (dropdown) se region + FX convert.
 * @param countryOverride Billing page country picker; khali = company.country
 */
export function useBillingRegionPricing(countryOverride?: string | null) {
  const { company } = useCompany();
  const country = useMemo(() => {
    const picked = String(countryOverride ?? "").trim();
    if (picked) return picked;
    return String(company?.country ?? "").trim() || "Nepal";
  }, [countryOverride, company?.country]);

  const region = useMemo(() => countryToBillingRegion(country), [country]);
  const regionMeta = BILLING_REGIONS[region];
  const currencyRow = useMemo(() => getDefaultCurrencyForCountry(country), [country]);

  const [pricingSettings, setPricingSettings] = useState<BillingPricingSettings>(
    DEFAULT_BILLING_PRICING_SETTINGS
  );
  const [fx, setFx] = useState<FxRatesSnapshot | null>(null);
  const [fxLoading, setFxLoading] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(firestore, "app_settings", "billing_pricing"), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as Record<string, unknown>;
      const baseRegion = (d.baseRegion as BillingRegionId) ?? "nepal";
      setPricingSettings({
        baseCurrency: String(d.baseCurrency ?? "NPR").toUpperCase(),
        baseCountry: String(d.baseCountry ?? "").trim() || undefined,
        defaultRegionCountry:
          String(d.defaultRegionCountry ?? "").trim() ||
          billingRegionToDefaultCountry(baseRegion),
        saarcFxCountry: String(d.saarcFxCountry ?? "").trim() || undefined,
        internationalFxCountry: String(d.internationalFxCountry ?? "").trim() || undefined,
        baseRegion,
      });
    });
    return () => unsub();
  }, []);

  const refreshFx = useCallback(async (base?: string) => {
    const b = (base || pricingSettings.baseCurrency || "NPR").toUpperCase();
    setFxLoading(true);
    try {
      const res = await fetch(getBillingApiUrl(`/api/billing/fx-rates?base=${encodeURIComponent(b)}`));
      const data = await res.json();
      if (res.ok && data.rates) {
        setFx({
          base: data.base,
          date: data.date,
          rates: data.rates,
          fetchedAtMs: data.fetchedAtMs ?? Date.now(),
        });
      }
    } catch {
      /* offline — regional admin prices still work */
    } finally {
      setFxLoading(false);
    }
  }, [pricingSettings.baseCurrency]);

  useEffect(() => {
    void refreshFx(pricingSettings.baseCurrency);
  }, [pricingSettings.baseCurrency, refreshFx]);

  const displaySymbol = currencyRow.symbol;
  const displayCurrency = currencyRow.currencyCode;

  const formatPlanTermPrice = useCallback(
    (plan: Plan, termKey: SubscriptionTermKey) =>
      formatPlanPriceForCountry(plan, termKey, country, fx, pricingSettings),
    [country, fx, pricingSettings]
  );

  const getCheckoutForPlan = useCallback(
    (plan: Plan, termKey: SubscriptionTermKey) =>
      regionalCheckoutChargeForCountry(plan, termKey, country, fx, pricingSettings),
    [country, fx, pricingSettings]
  );

  const resolvePlanPrices = useCallback(
    (plan: Plan) => resolveRegionalPlanPrices(plan, region, fx, pricingSettings),
    [region, fx, pricingSettings]
  );

  const formatAmount = useCallback(
    (amount: number, symbol?: string, currencyCode?: string) =>
      formatRegionalMoney(amount, symbol ?? displaySymbol, currencyCode ?? displayCurrency),
    [displaySymbol, displayCurrency]
  );

  return {
    country,
    region,
    regionLabel: regionMeta.label,
    displaySymbol,
    displayCurrency,
    fx,
    fxLoading,
    refreshFx,
    pricingSettings,
    formatPlanTermPrice,
    getCheckoutForPlan,
    resolvePlanPrices,
    formatAmount,
  };
}
