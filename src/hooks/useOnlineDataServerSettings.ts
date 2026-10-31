"use client";

import { useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, isFirestoreBlockedForServerSession } from "@/lib/firebase";
import {
  applyLocalDevPocketBaseGuard,
  DEFAULT_ONLINE_DATA_SERVER_SETTINGS,
  ONLINE_DATA_SERVER_SETTINGS_COLLECTION,
  ONLINE_DATA_SERVER_SETTINGS_ID,
  normalizeOnlineDataServerSettings,
  readCachedOnlineDataServerSettings,
  writeCachedOnlineDataServerSettings,
  type OnlineDataServerSettings,
} from "@/lib/onlineDataServer";

/** Live SuperAdmin online data server - cached first, then Firestore. */
export function useOnlineDataServerSettings(): {
  settings: OnlineDataServerSettings;
  loading: boolean;
} {
  const [settings, setSettings] = useState<OnlineDataServerSettings>(() => readCachedOnlineDataServerSettings());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSettings(readCachedOnlineDataServerSettings());
    // Pocket Ledger Server login: no Firestore listener at all - cached settings only.
    if (isFirestoreBlockedForServerSession()) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(firestore, ONLINE_DATA_SERVER_SETTINGS_COLLECTION, ONLINE_DATA_SERVER_SETTINGS_ID),
      (snap) => {
        // Local dev: ignore a production (non-local) pocketbaseUrl saved in Firestore.
        const next = applyLocalDevPocketBaseGuard(normalizeOnlineDataServerSettings(snap.exists() ? snap.data() : undefined));
        setSettings(next);
        writeCachedOnlineDataServerSettings(next);
        setLoading(false);
      },
      () => {
        setSettings(readCachedOnlineDataServerSettings());
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { settings, loading };
}

export { DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
