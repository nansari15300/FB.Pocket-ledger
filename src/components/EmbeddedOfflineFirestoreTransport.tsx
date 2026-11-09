"use client";

/**
 * APK/static/EXE: `navigator` offline hone par Firestore network disable — Write/Listen ERR spam + save hang kam.
 * Online par enable taaki outbox flush / plan sync chal sake (company ledger ab bhi SQLite-first).
 *
 * Online/offline events debounce — rapid flaps + wake-from-other-app pe enableNetwork/onSnapshot race (ca9) kam.
 */

import { useEffect } from "react";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import { syncEmbeddedFirestoreTransportFromNavigator } from "@/lib/plClientSession";

const NETWORK_SYNC_DEBOUNCE_MS = 900;

export function EmbeddedOfflineFirestoreTransport() {
  useEffect(() => {
    if (!isEmbeddedOfflinePreloadClient()) return;
    let timer: number | null = null;
    const apply = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void syncEmbeddedFirestoreTransportFromNavigator();
      }, NETWORK_SYNC_DEBOUNCE_MS);
    };
    // First paint: run once without waiting full debounce.
    void syncEmbeddedFirestoreTransportFromNavigator();
    window.addEventListener("online", apply);
    window.addEventListener("offline", apply);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("online", apply);
      window.removeEventListener("offline", apply);
    };
  }, []);
  return null;
}
