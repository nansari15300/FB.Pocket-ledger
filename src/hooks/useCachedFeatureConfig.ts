"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";

const FEATURE_CONFIG_STORAGE_KEY = "app_settings:features";

const OFFLINE_BASE_FEATURE_CONFIG: Record<string, boolean> = {
  // Local no-login fallback: basic/safe feature visibility defaults when no admin snapshot is cached.
  dashboard: true,
  party: true,
  "bank-cash": true,
  staff: true,
  loans: true,
  tax: true,
  incomes: true,
  items: true,
  reports: true,
  gallery: true,
  gate: true,
  production: false,
  "sale-note": false,
  "purchase-note": false,
  quotations: false,
  messages: true,
  billing: true,
  "distributor-signup": false,
  backup: true,
  "import-export": true,
  "recycle-bin": true,
  settings: true,
  "company-storage-tabs": true,
  company_tab_local: true,
  company_tab_server: true,
  company_tab_online: true,
  company_tab_pocketbase: true,
};

function readCachedFeatureConfig(): Record<string, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FEATURE_CONFIG_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

function writeCachedFeatureConfig(value: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FEATURE_CONFIG_STORAGE_KEY, JSON.stringify(value));
  } catch {}
}

export function useCachedFeatureConfig(defaultConfig: Record<string, boolean> = {}) {
  // SSR + first client render must match; localStorage reads sirf mount ke baad effect me karo.
  const [featureConfig, setFeatureConfig] = useState<Record<string, boolean>>(defaultConfig);
  const [loading, setLoading] = useState(true);

  // Stabilize inline defaults like useCachedFeatureConfig({}) so the Firestore subscription effect does not loop.
  const defaultConfigKey = useMemo(() => JSON.stringify(defaultConfig), [defaultConfig]);
  const fallbackConfig = useMemo(
    () => ({ ...OFFLINE_BASE_FEATURE_CONFIG, ...defaultConfig }),
    [defaultConfigKey]
  );

  useEffect(() => {
    const cached = readCachedFeatureConfig();
    if (cached) {
      // Restore the last known feature config immediately so sidebar/pages remain usable after offline refresh.
      setFeatureConfig(cached);
      setLoading(false);
    }

    // Pehle local-only + SUPER_ADMIN_SYNC=0 par yahan return tha — admin "Add/Remove Features" kabhi sync nahi hota tha.
    // Hamesha Firestore subscribe: online jaisa; offline / deny par cached / fallback.
    const unsub = onSnapshot(doc(firestore, "app_settings", "features"), (docSnap) => {
      const nextConfig = docSnap.exists() ? (docSnap.data() as Record<string, boolean>) : fallbackConfig;
      setFeatureConfig({ ...nextConfig, "import-export": true });
      writeCachedFeatureConfig({ ...nextConfig, "import-export": true });
      setLoading(false);
    }, () => {
      // Offline / permission: pehle cache dikhao; warna OFFLINE_BASE taaki menu khali na rahe.
      if (!cached) {
        setFeatureConfig(fallbackConfig);
        writeCachedFeatureConfig(fallbackConfig);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [fallbackConfig]);

  return { featureConfig, loading };
}
