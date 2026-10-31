"use client";

/**
 * Pocket Ledger Server realtime for every signed-in device that has server companies.
 * Follows Admin → Company sync mode: Live = collection SSE, Delta = change-log SSE.
 * Shared by web, EXE and APK (mounted in providers).
 */

import { useEffect } from "react";
import { getValidPocketBaseAuth, PL_PB_AUTH_CHANGED_EVENT } from "@/lib/pocketbaseData/pbClient";
import { activePocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { SELECTED_COMPANY_CHANGED_EVENT } from "@/lib/selectedCompanyStorage";
import {
  FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT,
} from "@/lib/firebaseLedgerSyncMode";
import {
  ensureGlobalSyncModeSettingsHydrated,
  readCachedGlobalSyncModeSettings,
  refreshGlobalSyncModeFromPocketBase,
} from "@/lib/globalSyncModeSettings";
import type { PocketBaseRealtimeMode } from "@/lib/pocketbaseData/pbRealtime";

const RECHECK_MS = 30_000;
/** Server login: re-read the admin's Live/Delta mode from the server this often (and on focus / online). */
const SYNC_MODE_REFRESH_MS = 60_000;

function currentMode(): PocketBaseRealtimeMode {
  return readCachedGlobalSyncModeSettings().mode === "full_online" ? "live" : "delta";
}

function liveFeedKey(): string {
  const auth = getValidPocketBaseAuth();
  if (!auth) return "";
  if (!activePocketBaseCompanyId()) return "";
  return `${auth.url}|${auth.userId}|${currentMode()}`;
}

export function PocketBaseLiveSyncManager() {
  useEffect(() => {
    let key = "";
    let stop: (() => void) | null = null;
    const evaluate = () => {
      const next = liveFeedKey();
      if (next === key) return;
      stop?.();
      stop = null;
      key = next;
      if (!next) {
        // signed out / no server company selected: stop the background file pull
        void import("@/lib/pocketbaseData/pbFilesPull").then((m) => m.stopPbFilesSync()).catch(() => {});
        return;
      }
      // App start / sign-in / company switch: continue (or begin) pulling every server file to this device.
      void import("@/lib/pocketbaseData/pbFilesPull").then((m) => m.resumePbFilesSync()).catch(() => {});
      const mode = currentMode();
      void import("@/lib/pocketbaseData/pbRealtime")
        .then((m) => {
          if (key === next && !stop) stop = m.startPocketBaseLiveChangeFeed(mode);
        })
        .catch(() => {});
    };
    evaluate();
    void ensureGlobalSyncModeSettingsHydrated().then(() => evaluate()).catch(() => {});
    window.addEventListener(PL_PB_AUTH_CHANGED_EVENT, evaluate);
    window.addEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, evaluate);
    window.addEventListener(SELECTED_COMPANY_CHANGED_EVENT, evaluate);
    const iv = window.setInterval(evaluate, RECHECK_MS);
    // Server login only (no-op otherwise): pick up a changed sync_mode without a page reload.
    const refreshMode = () => {
      void refreshGlobalSyncModeFromPocketBase().catch(() => {});
    };
    const onVisibleMode = () => {
      if (document.visibilityState === "visible") refreshMode();
    };
    refreshMode();
    const ivMode = window.setInterval(refreshMode, SYNC_MODE_REFRESH_MS);
    window.addEventListener("focus", refreshMode);
    window.addEventListener("online", refreshMode);
    window.addEventListener(PL_PB_AUTH_CHANGED_EVENT, refreshMode);
    document.addEventListener("visibilitychange", onVisibleMode);
    return () => {
      window.removeEventListener("focus", refreshMode);
      window.removeEventListener("online", refreshMode);
      window.removeEventListener(PL_PB_AUTH_CHANGED_EVENT, refreshMode);
      document.removeEventListener("visibilitychange", onVisibleMode);
      clearInterval(ivMode);
      window.removeEventListener(PL_PB_AUTH_CHANGED_EVENT, evaluate);
      window.removeEventListener(FIREBASE_LEDGER_SYNC_MODE_CHANGED_EVENT, evaluate);
      window.removeEventListener(SELECTED_COMPANY_CHANGED_EVENT, evaluate);
      clearInterval(iv);
      key = "";
      stop?.();
      stop = null;
    };
  }, []);
  return null;
}
