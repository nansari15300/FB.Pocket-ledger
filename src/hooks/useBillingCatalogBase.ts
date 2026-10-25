"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { billingRegionToDefaultCountry } from "@/lib/billingRegions";
import type { BillingRegionId } from "@/lib/billingRegions";
import { getDefaultCurrencyForCountry } from "@/lib/worldCurrencies";

/** Admin catalog base — `billing_pricing.defaultRegionCountry` (live sync). */
export function useBillingCatalogBase() {
  const [baseCountry, setBaseCountry] = useState("Nepal");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(firestore, "app_settings", "billing_pricing"), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as Record<string, unknown>;
        const region = (d.baseRegion as BillingRegionId) ?? "nepal";
        const country =
          String(d.defaultRegionCountry ?? "").trim() ||
          String(d.baseCountry ?? "").trim() ||
          billingRegionToDefaultCountry(region);
        setBaseCountry(country);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const row = useMemo(() => getDefaultCurrencyForCountry(baseCountry), [baseCountry]);

  return {
    loading,
    baseCountry,
    symbol: row.symbol,
    currencyCode: row.currencyCode,
  };
}
