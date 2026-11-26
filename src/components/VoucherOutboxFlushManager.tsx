"use client";

/**
 * Flush pending `sync_outbox` rows when there is work to do (enqueue, online, focus
 * after a long hide, pagehide). No idle 8s timer and no 30/60s snapshot pull while
 * PocketBase SSE is connected. Catch-up pull runs only on: app start, SSE (re)connect,
 * coming online, and visibility wake after the tab was hidden long enough.
 * When SSE is down, a slow backoff poll (30s, capped at a few minutes) is the fallback.
 */

import { useEffect } from "react";
import {
  countAllSyncOutboxRows,
  flushVoucherOutbox,
  PL_OUTBOX_CHANGED_EVENT,
} from "@/lib/localVoucherOutbox";
import { SERVER_QUOTA_HOLD_END_EVENT } from "@/lib/serverQuotaHold";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import {
  FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT,
  isFirebaseLedgerDataSyncDisabled,
} from "@/lib/firebaseLedgerDataSyncDisabled";
import { listActivePocketBaseCompanyIds } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { SELECTED_COMPANY_CHANGED_EVENT } from "@/lib/selectedCompanyStorage";

const HIDDEN_WAKE_MS = 15_000;
const SSE_DOWN_POLL_START_MS = 30_000;
const SSE_DOWN_POLL_MAX_MS = 3 * 60_000;
const FLUSH_AFTER_ONLINE_MS = 900;
const ONLINE_DEBOUNCE_MS = 1200;

function catchUpPocketBase(reason: "start" | "reconnect" | "online" | "wake" | "company" | "sse-down"): void {
  if (!listActivePocketBaseCompanyIds().length) return;
  void Promise.all([import("@/lib/pocketbaseData/pbSync"), import("@/lib/pocketbaseData/pbRealtime")])
    .then(([sync, rt]) => {
      const sseUp = rt.isPocketBaseRealtimeConnected();
      if (reason === "sse-down") {
        if (sseUp) return;
        return sync.pullAllPocketBaseCompaniesThrottled(SSE_DOWN_POLL_START_MS);
      }
      return sync.pullAllPocketBaseCompaniesThrottled(0, { force: true });
    })
    .catch(() => {});
}

export function VoucherOutboxFlushManager() {
  useEffect(() => {
    if (isPlServerThinStaffClient()) return;
    if (process.env.NEXT_PUBLIC_ENABLE_AUTO_BACKUP_SYNC === "0") return;

    let onlineTimer: number | null = null;
    let flushTimer: number | null = null;
    let sseDownTimer: number | null = null;
    let hiddenAt = 0;
    let failRetryMs = 2_000;
    let sseDownMs = SSE_DOWN_POLL_START_MS;
    let stopped = false;

    const runFlushIfNeeded = () => {
      if (stopped || isFirebaseLedgerDataSyncDisabled()) return;
      void (async () => {
        const pending = await countAllSyncOutboxRows();
        if (!pending) {
          failRetryMs = 2_000;
          return;
        }
        const res = await flushVoucherOutbox();
        if (res && res.failed > 0) {
          const wait = failRetryMs;
          failRetryMs = Math.min(failRetryMs * 2, 60_000);
          scheduleFlush(wait);
        } else {
          failRetryMs = 2_000;
        }
      })().catch(() => {});
    };

    function scheduleFlush(delayMs: number) {
      if (flushTimer != null) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        runFlushIfNeeded();
      }, delayMs);
    }

    const armSseDownFallback = () => {
      if (sseDownTimer != null) window.clearTimeout(sseDownTimer);
      sseDownTimer = window.setTimeout(() => {
        sseDownTimer = null;
        if (stopped) return;
        void import("@/lib/pocketbaseData/pbRealtime")
          .then((rt) => {
            if (rt.isPocketBaseRealtimeConnected()) {
              sseDownMs = SSE_DOWN_POLL_START_MS;
              armSseDownFallback();
              return;
            }
            catchUpPocketBase("sse-down");
            sseDownMs = Math.min(Math.round(sseDownMs * 1.5), SSE_DOWN_POLL_MAX_MS);
            armSseDownFallback();
          })
          .catch(() => armSseDownFallback());
      }, sseDownMs);
    };

    const onOnline = () => {
      if (onlineTimer != null) clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => {
        onlineTimer = null;
        scheduleFlush(FLUSH_AFTER_ONLINE_MS);
        catchUpPocketBase("online");
      }, ONLINE_DEBOUNCE_MS);
    };
    const onVisibleOrFocus = () => {
      if (document.visibilityState === "visible") {
        const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = 0;
        scheduleFlush(350);
        if (hiddenFor >= HIDDEN_WAKE_MS) catchUpPocketBase("wake");
      } else {
        hiddenAt = Date.now();
        scheduleFlush(0);
      }
    };
    const onDataSyncChanged = (event: Event) => {
      const disabled = Boolean((event as CustomEvent<{ disabled?: boolean }>).detail?.disabled);
      if (!disabled) scheduleFlush(0);
    };
    const onQuotaHoldEnd = () => scheduleFlush(500);
    const onOutboxChanged = () => scheduleFlush(0);
    const onSelectedCompany = () => catchUpPocketBase("company");
    const onRealtime = () => {
      sseDownMs = SSE_DOWN_POLL_START_MS;
      catchUpPocketBase("reconnect");
    };
    const onPageHide = () => {
      if (isFirebaseLedgerDataSyncDisabled()) return;
      try {
        void flushVoucherOutbox();
      } catch {
        /* page is going away */
      }
    };

    window.addEventListener(SERVER_QUOTA_HOLD_END_EVENT, onQuotaHoldEnd);
    window.addEventListener(PL_OUTBOX_CHANGED_EVENT, onOutboxChanged);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onVisibleOrFocus);
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onDataSyncChanged);
    document.addEventListener("visibilitychange", onVisibleOrFocus);
    window.addEventListener(SELECTED_COMPANY_CHANGED_EVENT, onSelectedCompany);
    window.addEventListener("pl-pb-realtime-connected", onRealtime);
    window.addEventListener("pagehide", onPageHide);

    catchUpPocketBase("start");
    if (typeof navigator !== "undefined" && navigator.onLine && !isFirebaseLedgerDataSyncDisabled()) {
      scheduleFlush(FLUSH_AFTER_ONLINE_MS);
    }
    armSseDownFallback();

    return () => {
      stopped = true;
      if (onlineTimer != null) clearTimeout(onlineTimer);
      if (flushTimer != null) clearTimeout(flushTimer);
      if (sseDownTimer != null) clearTimeout(sseDownTimer);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener(SERVER_QUOTA_HOLD_END_EVENT, onQuotaHoldEnd);
      window.removeEventListener(PL_OUTBOX_CHANGED_EVENT, onOutboxChanged);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onVisibleOrFocus);
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onDataSyncChanged);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
      window.removeEventListener(SELECTED_COMPANY_CHANGED_EVENT, onSelectedCompany);
      window.removeEventListener("pl-pb-realtime-connected", onRealtime);
    };
  }, []);
  return null;
}
