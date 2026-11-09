"use client";

import { useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, isFirestoreBlockedForServerSession } from "@/lib/plClientSession";
import {
  applyLocalDevPocketBaseGuard,
  DEFAULT_ONLINE_DATA_SERVER_SETTINGS,
  ONLINE_DATA_SERVER_CHANGED_EVENT,
  ONLINE_DATA_SERVER_SETTINGS_COLLECTION,
  ONLINE_DATA_SERVER_SETTINGS_ID,
  fetchOnlineDataServerFromPocketBase,
  normalizeOnlineDataServerSettings,
  readCachedOnlineDataServerSettings,
  writeCachedOnlineDataServerSettings,
  type OnlineDataServerSettings,
} from "@/lib/onlineDataServer";

/** Live SuperAdmin online data server - cached first, then PocketBase, then Firestore. */
export function useOnlineDataServerSettings(): {
  settings: OnlineDataServerSettings;
  loading: boolean;
} {
  const [settings, setSettings] = useState<OnlineDataServerSettings>(() => readCachedOnlineDataServerSettings());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // 1. Initial cached value
    setSettings(readCachedOnlineDataServerSettings());

    // 2. Fetch directly from PocketBase server
    void fetchOnlineDataServerFromPocketBase().then((fromPb) => {
      if (!cancelled && fromPb) {
        setSettings(fromPb);
        writeCachedOnlineDataServerSettings(fromPb);
        setLoading(false);
      }
    });

    // 3. Listen to local changes / sync events across tabs
    const onSettingsChanged = (e: Event) => {
      const d = (e as CustomEvent<OnlineDataServerSettings>).detail;
      if (d) setSettings(d);
      else setSettings(readCachedOnlineDataServerSettings());
      setLoading(false);
    };
    window.addEventListener(ONLINE_DATA_SERVER_CHANGED_EVENT, onSettingsChanged);

    // 4. Focus / online re-check
    const refresh = () => {
      void fetchOnlineDataServerFromPocketBase().then((fromPb) => {
        if (!cancelled && fromPb) {
          setSettings(fromPb);
          writeCachedOnlineDataServerSettings(fromPb);
        }
      });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);

    // 5. Firestore fallback listener only if not blocked
    let unsubFirestore: (() => void) | null = null;
    if (!isFirestoreBlockedForServerSession()) {
      try {
        unsubFirestore = onSnapshot(
          doc(firestore, ONLINE_DATA_SERVER_SETTINGS_COLLECTION, ONLINE_DATA_SERVER_SETTINGS_ID),
          (snap) => {
            if (snap.exists()) {
              const next = applyLocalDevPocketBaseGuard(normalizeOnlineDataServerSettings(snap.data()));
              setSettings(next);
              writeCachedOnlineDataServerSettings(next);
            }
            setLoading(false);
          },
          () => {
            setLoading(false);
          }
        );
      } catch {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
      window.removeEventListener(ONLINE_DATA_SERVER_CHANGED_EVENT, onSettingsChanged);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      unsubFirestore?.();
    };
  }, []);

  return { settings, loading };
}

export { DEFAULT_ONLINE_DATA_SERVER_SETTINGS };
