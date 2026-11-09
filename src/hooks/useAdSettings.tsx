"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { DEFAULT_AD_SETTINGS, normalizeAdSettings, type AdSettings } from "@/lib/adSettings";
import { readCachedAdSettings, writeCachedAdSettings } from "@/lib/ads/adSettingsCache";

type AdSettingsContextValue = {
  settings: AdSettings;
  adsEnabled: boolean;
  loading: boolean;
};

const AdSettingsContext = createContext<AdSettingsContextValue>({
  settings: DEFAULT_AD_SETTINGS,
  adsEnabled: false,
  loading: true,
});

export function AdSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AdSettings>(DEFAULT_AD_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readCachedAdSettings();
    setSettings(cached);
    setLoading(false);

    const unsub = onSnapshot(
      doc(firestore, "app_settings", "ad_settings"),
      (snap) => {
        const next = normalizeAdSettings(snap.exists() ? snap.data() : undefined);
        setSettings(next);
        writeCachedAdSettings(next);
        setLoading(false);
      },
      () => {
        setSettings(readCachedAdSettings());
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const value = useMemo<AdSettingsContextValue>(
    () => ({
      settings,
      adsEnabled: settings.enabled === true,
      loading,
    }),
    [settings, loading]
  );

  return <AdSettingsContext.Provider value={value}>{children}</AdSettingsContext.Provider>;
}

export function useAdSettings(): AdSettingsContextValue {
  return useContext(AdSettingsContext);
}
