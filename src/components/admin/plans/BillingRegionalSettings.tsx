"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CountrySearchCombobox } from "@/components/shared/CountrySearchCombobox";
import {
  COUNTRY_CURRENCY_ROWS,
  getDefaultCurrencyForCountry,
  getCurrencySymbolForCode,
} from "@/lib/worldCurrencies";
import {
  BILLING_REGIONS,
  billingRegionToDefaultCountry,
  countryToBillingRegion,
  type BillingRegionId,
} from "@/lib/billingRegions";
import {
  DEFAULT_BILLING_PRICING_SETTINGS,
  type BillingPricingSettings,
} from "@/lib/billingRegionalPricing";
import { Loader2, RefreshCw } from "lucide-react";
import { getBillingApiUrl } from "@/lib/billingApiOrigin";
import { useToast } from "@/hooks/use-toast";
import type { FxRatesSnapshot } from "@/lib/liveFxRates";

/** FX line: base symbol + 1 = target symbol + converted amount. */
function formatFxLine(
  baseSymbol: string,
  baseCode: string,
  targetSymbol: string,
  targetCode: string,
  rate: number | null | undefined
): string {
  if (baseCode === targetCode) {
    return `${baseSymbol} 1 = ${targetSymbol} 1`;
  }
  if (rate == null || !Number.isFinite(rate)) return "—";
  const converted =
    rate >= 1
      ? rate.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : rate.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return `${baseSymbol} 1 = ${targetSymbol} ${converted}`;
}

/** Admin: base country (search) + live FX — plan regional rows is base se convert ho sakte hain. */
export function BillingRegionalSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<BillingPricingSettings>(DEFAULT_BILLING_PRICING_SETTINGS);
  const [baseCountry, setBaseCountry] = useState("Nepal");
  const [saarcCountry, setSaarcCountry] = useState("India");
  const [internationalCountry, setInternationalCountry] = useState("United States");
  const [defaultRegionCountry, setDefaultRegionCountry] = useState("Nepal");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fx, setFx] = useState<FxRatesSnapshot | null>(null);
  const [fxBusy, setFxBusy] = useState(false);

  const baseRow = useMemo(() => getDefaultCurrencyForCountry(baseCountry), [baseCountry]);
  const baseSymbol = baseRow.symbol;
  const baseCode = baseRow.currencyCode; // dropdown country = FX base code (settings se pehle sync)

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, "app_settings", "billing_pricing"));
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          const code = String(d.baseCurrency ?? "NPR").toUpperCase();
          const country =
            String(d.baseCountry ?? "").trim() ||
            COUNTRY_CURRENCY_ROWS.find((r) => r.currencyCode === code)?.country ||
            "Nepal";
          const saarcFx =
            String(d.saarcFxCountry ?? "").trim() ||
            DEFAULT_BILLING_PRICING_SETTINGS.saarcFxCountry ||
            "India";
          const intlFx =
            String(d.internationalFxCountry ?? "").trim() ||
            DEFAULT_BILLING_PRICING_SETTINGS.internationalFxCountry ||
            "United States";
          const baseRegion = (d.baseRegion as BillingRegionId) ?? "nepal";
          const defaultRegion =
            String(d.defaultRegionCountry ?? "").trim() ||
            billingRegionToDefaultCountry(baseRegion);
          setSettings({
            baseCurrency: code,
            baseCountry: country,
            saarcFxCountry: saarcFx,
            internationalFxCountry: intlFx,
            defaultRegionCountry: defaultRegion,
            baseRegion,
            updatedAtMs: typeof d.updatedAtMs === "number" ? d.updatedAtMs : undefined,
          });
          setBaseCountry(country);
          setSaarcCountry(saarcFx);
          setInternationalCountry(intlFx);
          setDefaultRegionCountry(defaultRegion);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadFx = useCallback(async (base: string) => {
    setFxBusy(true);
    try {
      const res = await fetch(getBillingApiUrl(`/api/billing/fx-rates?base=${encodeURIComponent(base)}`));
      const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<FxRatesSnapshot>;
      if (!res.ok) throw new Error(data.error || "FX failed");
      setFx(data as FxRatesSnapshot);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "FX rates",
        description: e instanceof Error ? e.message : "Could not load today's rates.",
      });
    } finally {
      setFxBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!loading) void loadFx(baseCode);
  }, [loading, baseCode, loadFx]);

  const handleDefaultRegionCountryChange = (country: string) => {
    const row = getDefaultCurrencyForCountry(country);
    setDefaultRegionCountry(country);
    setBaseCountry(country); // 1st box read-only — yahi country + symbol dikhe
    setSettings((s) => ({
      ...s,
      defaultRegionCountry: country,
      baseCountry: country,
      baseCurrency: row.currencyCode,
      baseRegion: countryToBillingRegion(country),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(firestore, "app_settings", "billing_pricing"),
        {
          ...settings,
          baseCountry,
          baseCurrency: baseRow.currencyCode,
          saarcFxCountry: saarcCountry,
          internationalFxCountry: internationalCountry,
          defaultRegionCountry,
          updatedAtMs: Date.now(),
        },
        { merge: true }
      );
      toast({ title: "Saved", description: `Base set to ${baseCountry} (${baseSymbol} 1 · ${baseCode}).` });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="pl-chrome-card pl-chrome-tone-emerald">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Regional billing &amp; live FX</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* PC (lg+): country + region — ek row; symbol+1 dropdown trigger me */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-end lg:gap-6 w-full">
          <div className="space-y-2 min-w-0">
            <Label>Base country</Label>
            {/* Read-only — searchable dropdown se jo country select ho, name + symbol */}
            <div
              className="flex h-10 w-full items-center rounded-md border border-input bg-muted/60 px-3 py-2 text-sm font-medium"
              aria-readonly="true"
            >
              {baseCountry} · {baseSymbol}
            </div>
          </div>

          <div className="space-y-2 min-w-0">
            <Label>Default billing region (search country)</Label>
            <CountrySearchCombobox
              scope="all"
              symbolWithOne={false}
              value={defaultRegionCountry}
              onChange={handleDefaultRegionCountryChange}
              placeholder="Search country…"
            />
          </div>
        </div>

        <div className="rounded-md border border-emerald-200/70 bg-emerald-50/35 p-3 text-sm space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              Today&apos;s FX (1 {baseSymbol} = …)
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="!rounded-md" // Refresh: pill nahi, chaukona
              disabled={fxBusy}
              onClick={() => loadFx(baseCode)}
            >
              {fxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1">Refresh</span>
            </Button>
          </div>
          {fx ? (
            <ul className="flex flex-col md:flex-row md:flex-nowrap gap-2 w-full min-w-0">
              {/* Nepal — fixed NPR; dropdown nahi */}
              <li className="md:flex-1 md:min-w-0 md:basis-0 rounded border border-emerald-200/60 bg-background px-3 py-2 space-y-1.5">
                <span className="font-medium block text-sm">{BILLING_REGIONS.nepal.label}</span>
                <span className="text-sm font-semibold tabular-nums block truncate">
                  {formatFxLine(
                    baseSymbol,
                    baseCode,
                    getCurrencySymbolForCode("NPR"),
                    "NPR",
                    fx.rates.NPR
                  )}
                </span>
              </li>

              {/* SAARC — dropdown + rate ek hi row */}
              <li className="md:flex-1 md:min-w-0 md:basis-0 rounded border border-emerald-200/60 bg-background px-3 py-2 space-y-1.5">
                <span className="font-medium block text-sm">{BILLING_REGIONS.saarc.label}</span>
                <div className="flex flex-row items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <CountrySearchCombobox
                      scope="saarc"
                      value={saarcCountry}
                      onChange={setSaarcCountry}
                      placeholder="SAARC…"
                    />
                  </div>
                  <span className="text-xs sm:text-sm font-semibold tabular-nums shrink-0 whitespace-nowrap">
                    {formatFxLine(
                      baseSymbol,
                      baseCode,
                      getDefaultCurrencyForCountry(saarcCountry).symbol,
                      getDefaultCurrencyForCountry(saarcCountry).currencyCode,
                      fx.rates[getDefaultCurrencyForCountry(saarcCountry).currencyCode]
                    )}
                  </span>
                </div>
              </li>

              {/* International — dropdown + rate ek hi row */}
              <li className="md:flex-1 md:min-w-0 md:basis-0 rounded border border-emerald-200/60 bg-background px-3 py-2 space-y-1.5">
                <span className="font-medium block text-sm">{BILLING_REGIONS.international.label}</span>
                <div className="flex flex-row items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <CountrySearchCombobox
                      scope="international"
                      value={internationalCountry}
                      onChange={setInternationalCountry}
                      placeholder="Country…"
                    />
                  </div>
                  <span className="text-xs sm:text-sm font-semibold tabular-nums shrink-0 whitespace-nowrap">
                    {formatFxLine(
                      baseSymbol,
                      baseCode,
                      getDefaultCurrencyForCountry(internationalCountry).symbol,
                      getDefaultCurrencyForCountry(internationalCountry).currencyCode,
                      fx.rates[getDefaultCurrencyForCountry(internationalCountry).currencyCode]
                    )}
                  </span>
                </div>
              </li>
            </ul>
          ) : (
            <p className="text-muted-foreground">Rates not loaded — check network.</p>
          )}
        </div>

        <Button type="button" className="!rounded-md" onClick={save} disabled={saving}> {/* Save: rectangle */}
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save regional billing settings
        </Button>
      </CardContent>
    </Card>
  );
}
