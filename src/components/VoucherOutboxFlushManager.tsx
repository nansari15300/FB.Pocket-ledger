"use client";

/**
 * Local-first / embedded: flush pending `sync_outbox` rows to Firestore when the network is up, on focus, or on an interval (~8s).
 * Must also run on Capacitor with Firebase UI mode — previously the manager returned early when `isLocalOnlyMode` was false.
 * Pocket Ledger Server (PocketBase) companies: the same flush pushes their rows to the server.
 * Other devices' changes arrive via realtime SSE (Live/Delta); this poll is only a fallback.
 */

import { useEffect } from "react";
import { flushVoucherOutbox } from "@/lib/localVoucherOutbox";
import { SERVER_QUOTA_HOLD_END_EVENT } from "@/lib/serverQuotaHold";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import {
  FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT,
  isFirebaseLedgerDataSyncDisabled,
} from "@/lib/firebaseLedgerDataSyncDisabled";
import { listActivePocketBaseCompanyIds } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { SELECTED_COMPANY_CHANGED_EVENT } from "@/lib/selectedCompanyStorage";

/** PocketBase pull after a flush — SSE is primary; this poll is the fallback. */
function pullPocketBaseCompaniesInBackground(opts?: { force?: boolean; visible?: boolean }): void {
  if (!listActivePocketBaseCompanyIds().length) return;
  void import("@/lib/pocketbaseData/pbSync")
    .then((sync) => {
      const minIntervalMs = opts?.force ? 0 : opts?.visible ? 2_000 : 8_000;
      return sync.pullAllPocketBaseCompaniesThrottled(minIntervalMs, opts?.force ? { force: true } : undefined);
    })
    .catch(() => {});
}

export function VoucherOutboxFlushManager() {
  useEffect(() => {
    // PL Server staff: authoritative queue + SQLite mirror — Firestore outbox flush UI churn na kare.
    if (isPlServerThinStaffClient()) return;
    // Capacitor + Firebase data source: `isLocalOnlyMode` may be false but outbox flush is still required, or masters stay stuck in the queue.
    // Local-first sync engine: default ON for online-category companies; disable with env flag.
    if (process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "0") return;
    /** Let the browser "online" event settle before flushing — reduces races with Firestore watch streams (ca9). */
    const FLUSH_AFTER_ONLINE_MS = 900;
    const ONLINE_DEBOUNCE_MS = 1200;

    // Browser `setTimeout` ids are numbers here; Node typings use `Timeout` — this effect is window-only.
    let onlineTimer: number | null = null;
    const pendingFlushTimers: number[] = [];
    /** Failed flush: retry quickly (2s, 4s, then the 8s interval) instead of waiting for the next tick. */
    let failRetryMs = 2_000;
    const runFlush = () => {
      void flushVoucherOutbox()
        .then((res) => {
          if (res && res.failed > 0) {
            const wait = failRetryMs;
            failRetryMs = Math.min(failRetryMs * 2, 8_000);
            scheduleFlush(wait);
          } else {
            failRetryMs = 2_000;
          }
          pullPocketBaseCompaniesInBackground();
        })
        .catch(() => {});
    };
    function scheduleFlush(delayMs: number) {
      const t = window.setTimeout(() => {
        const i = pendingFlushTimers.indexOf(t);
        if (i !== -1) pendingFlushTimers.splice(i, 1);
        if (isFirebaseLedgerDataSyncDisabled()) return;
        runFlush();
      }, delayMs);
      pendingFlushTimers.push(t);
    }
    const tick = () => {
      if (isFirebaseLedgerDataSyncDisabled()) return;
      runFlush();
    };
    const onOnline = () => {
      if (onlineTimer != null) clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => {
        onlineTimer = null;
        scheduleFlush(FLUSH_AFTER_ONLINE_MS);
      }, ONLINE_DEBOUNCE_MS);
    };
    const onVisibleOrFocus = () => {
      if (document.visibilityState === "visible") {
        scheduleFlush(350);
        pullPocketBaseCompaniesInBackground({ visible: true });
      } else {
        // Writer tab background: send queued rows before Chrome throttles timers.
        scheduleFlush(0);
      }
    };
    const onDataSyncChanged = (event: Event) => {
      const disabled = Boolean((event as CustomEvent<{ disabled?: boolean }>).detail?.disabled);
      if (!disabled) scheduleFlush(0);
    };
    /** Quota pause ended (or cleared manually): resume sending the queued outbox. */
    const onQuotaHoldEnd = () => scheduleFlush(500);
    window.addEventListener(SERVER_QUOTA_HOLD_END_EVENT, onQuotaHoldEnd);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onVisibleOrFocus);
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onDataSyncChanged);
    document.addEventListener("visibilitychange", onVisibleOrFocus);
    const onSelectedCompany = () => {
      pullPocketBaseCompaniesInBackground({ force: true, visible: true });
    };
    window.addEventListener(SELECTED_COMPANY_CHANGED_EVENT, onSelectedCompany);
    if (typeof navigator !== "undefined" && navigator.onLine && !isFirebaseLedgerDataSyncDisabled()) scheduleFlush(FLUSH_AFTER_ONLINE_MS);
    /** Periodic retry jab awaited flush fail / queue baaki ho — 15s→8s taake web/exe cross-device kam late */
    const iv = setInterval(tick, 8_000);
    return () => {
      if (onlineTimer != null) clearTimeout(onlineTimer);
      pendingFlushTimers.forEach((t) => clearTimeout(t));
      window.removeEventListener(SERVER_QUOTA_HOLD_END_EVENT, onQuotaHoldEnd);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onVisibleOrFocus);
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onDataSyncChanged);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
      window.removeEventListener(SELECTED_COMPANY_CHANGED_EVENT, onSelectedCompany);
      clearInterval(iv);
    };
  }, []);
  return null;
}
