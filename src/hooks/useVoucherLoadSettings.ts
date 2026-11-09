"use client";

import { useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import {
  DEFAULT_VOUCHER_LOAD_SETTINGS,
  normalizeVoucherLoadSettings,
  readCachedVoucherLoadSettings,
  writeCachedVoucherLoadSettings,
  type VoucherLoadSettings,
} from "@/lib/voucherLoadModeSettings";

/** Live SuperAdmin voucher load mode — cached first, then Firestore. */
export function useVoucherLoadSettings(): {
  settings: VoucherLoadSettings;
  loading: boolean;
} {
  const [settings, setSettings] = useState<VoucherLoadSettings>(() => readCachedVoucherLoadSettings());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSettings(readCachedVoucherLoadSettings());
    const unsub = onSnapshot(
      doc(firestore, "app_settings", "voucher_load"),
      (snap) => {
        const next = normalizeVoucherLoadSettings(snap.exists() ? snap.data() : undefined);
        setSettings(next);
        writeCachedVoucherLoadSettings(next);
        setLoading(false);
      },
      () => {
        setSettings(readCachedVoucherLoadSettings());
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { settings, loading };
}

export { DEFAULT_VOUCHER_LOAD_SETTINGS };