"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useCompany } from "@/hooks/useCompany";
import { LOCAL_AUTH_CHANGED_EVENT } from "@/lib/localApiClient";
import { PL_GATE_CHANGED_EVENT } from "@/lib/gates/gateTypes";
import { refreshPlServerAccessContext } from "@/lib/plServerAccessContext";
import {
  registerPlServerCompanyTransportHint,
  resolvePlServerDeltaTransport,
  syncPlServerSharedCompanyLive,
  isPlServerRemoteLivePullReason,
} from "@/lib/plServerClientDeltaSync";
import { plServerCompanyLedgerNeedsFullPull } from "@/lib/plServerLedgerDeltaGate";
import {
  BROWSER_DB_COLLECTION_BUMP,
  listCompanyDocsFromBrowserDb,
  notifyBrowserDbCollectionUpdated,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import {
  buildLivePullSchedulerSnapshot,
  livePullDevLog,
  plNavLog,
  plServerVoucherFlowLog,
} from "@/lib/plServerLivePullDevLog";
import { markPlServerReadSyncReconnecting, getPlServerReadSyncHealth, markPlServerReadUsingLocalCache } from "@/lib/plServerReadSyncHealth";
import { shouldRunPlServerContinuousLiveSync } from "@/lib/plGatePageOrigin";
import { isPlHubServerClientMode } from "@/lib/plRemoteServerClient";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { plServerLiveCollectionsForPathname } from "@/lib/plServerVisiblePageLiveCache";
import type { CompanyBackupCollection } from "@/lib/companyBackupCollections";
import { readCurrentAppAccountIdentity } from "@/lib/appAccountIdentity";

/** SSE down: slow fallback poll (not an idle snapshot while the stream is healthy). */
const LIVE_FOCUS_POLL_MS = 30_000;
/**
 * SSE only after at least one real `change` event (not merely EventSource open).
 * WAN tunnels often leave SSE "open" without delivering events — then we keep the fallback poll.
 * After events are proven, idle focus_poll and full_check are not scheduled at all.
 */
/** Unused while SSE is healthy; kept as the fallback interval cap hint. */
const LIVE_FULL_CHECK_MS = 3 * 60_000;
/** Host slow / 1–2 fails — UI local SQLite se chale, network kam dabao. */
const LIVE_POLL_MS_AFTER_FAILURE = 45_000;
/** Host down — sirf sparse reopen try; offline SQLite use atakna nahi chahiye. */
const LIVE_POLL_MS_HOST_DOWN = 90_000;
const LIVE_SERVER_EVENT_RETRY_MS = 5_000;
const HUB_COMPANY_META_POLL_MS = 30_000;
/** SSE open + silent too long → trust drop, resume normal focus_poll. */
const LIVE_SSE_STALE_MS = 90_000;

function isParallelFocusPullReason(reason: string): boolean {
  return (
    reason === "focus_poll" ||
    reason === "window_focus" ||
    reason === "visibility_visible" ||
    reason.startsWith("server_event_") ||
    reason.startsWith("remote_bump_") ||
    reason.startsWith("queued_remote_bump_")
  );
}

/** Routine polls — host unreachable hone par skip (local mirror already complete). */
function isSkippableWhenHostDown(reason: string): boolean {
  return (
    reason === "focus_poll" ||
    reason === "full_check" ||
    reason === "route_change" ||
    reason.startsWith("queued_focus_poll") ||
    reason.startsWith("queued_full_check") ||
    reason.startsWith("queued_route_change")
  );
}

function hostLooksUnreachable(health: ReturnType<typeof getPlServerReadSyncHealth>): boolean {
  // 1 fail enough — pehle cache usable par counter 0 ho jata tha isliye kabhi skip nahi hota tha.
  return (
    health.consecutiveFailures >= 1 ||
    health.state === "sharing_unavailable" ||
    health.state === "offline" ||
    health.lastError === "offline_cached_view"
  );
}
/** P2P client: poll + reconnect pull — server → client. Local save ke bump par pull mat karo (stale server client edit overwrite karta tha). */
export function PlServerLiveSyncManager() {
  const pathname = usePathname();
  const { companyId, company } = useCompany();
  const companyPlServerShared = company?.plServerShared;
  const companyStorageOption = company?.storageOption;
  const companySyncedFromCloud = company?.syncedFromCloud;
  const companyRowId = company?.id;
  const companyPlServerGateId = (company as { plServerGateId?: string } | null | undefined)?.plServerGateId;
  const companyPlServerGateServerUrl = (company as { plServerGateServerUrl?: string } | null | undefined)?.plServerGateServerUrl;
  const companyPlServerHostCompanyId = (company as { plServerHostCompanyId?: string } | null | undefined)?.plServerHostCompanyId;
  const companyMetaRef = useRef({
    companyPlServerShared,
    companyStorageOption,
    companySyncedFromCloud,
    companyRowId,
    companyPlServerGateId,
    companyPlServerGateServerUrl,
    companyPlServerHostCompanyId,
  });
  companyMetaRef.current = {
    companyPlServerShared,
    companyStorageOption,
    companySyncedFromCloud,
    companyRowId,
    companyPlServerGateId,
    companyPlServerGateServerUrl,
    companyPlServerHostCompanyId,
  };
  const syncingRef = useRef(false);
  const focusSyncingRef = useRef(false);
  const lastPullRef = useRef(0);
  const pollIntervalMsRef = useRef(LIVE_FOCUS_POLL_MS);
  const pollTimerRef = useRef<number | null>(null);
  const fullCheckTimerRef = useRef<number | null>(null);
  const effectRunRef = useRef(0);
  const pathnameRef = useRef(pathname);
  const pendingPullReasonRef = useRef<string | null>(null);
  const schedulerBumpTimerRef = useRef<number | null>(null);
  const serverEventRetryTimerRef = useRef<number | null>(null);
  /** EventSource OPEN — not enough alone for idle focus_poll skip. */
  const serverEventsOpenRef = useRef(false);
  /** Last successful SSE `change` payload — proves live stream is delivering. */
  const lastServerChangeEventAtRef = useRef(0);
  const [schedulerEpoch, setSchedulerEpoch] = useState(0);

  useEffect(() => {
    livePullDevLog("component_mounted");
    return () => {
      livePullDevLog("component_unmounted");
    };
  }, []);

  /** Gate / local auth / shared-company context — scheduler re-arm when prerequisites arrive after mount. */
  useEffect(() => {
    const bump = () => {
      if (schedulerBumpTimerRef.current != null) {
        window.clearTimeout(schedulerBumpTimerRef.current);
      }
      // Pehle 100ms — LOCAL_AUTH/gate chatter pe LiveSync remount → meta HTTP flood + crash.
      schedulerBumpTimerRef.current = window.setTimeout(() => {
        schedulerBumpTimerRef.current = null;
        setSchedulerEpoch((n) => {
          const next = n + 1;
          livePullDevLog("scheduler_epoch_bump", { schedulerEpoch: next });
          plNavLog("scheduler_epoch_bump", { schedulerEpoch: next });
          return next;
        });
      }, 2_500);
    };
    window.addEventListener(PL_GATE_CHANGED_EVENT, bump);
    window.addEventListener(LOCAL_AUTH_CHANGED_EVENT, bump);
    return () => {
      if (schedulerBumpTimerRef.current != null) {
        window.clearTimeout(schedulerBumpTimerRef.current);
        schedulerBumpTimerRef.current = null;
      }
      if (serverEventRetryTimerRef.current != null) {
        window.clearTimeout(serverEventRetryTimerRef.current);
        serverEventRetryTimerRef.current = null;
      }
      window.removeEventListener(PL_GATE_CHANGED_EVENT, bump);
      window.removeEventListener(LOCAL_AUTH_CHANGED_EVENT, bump);
    };
  }, []);

  useEffect(() => {
    effectRunRef.current += 1;
    const runNumber = effectRunRef.current;
    const meta = companyMetaRef.current;
    const snap = buildLivePullSchedulerSnapshot(
      companyId,
      companyId
        ? {
            id: meta.companyRowId,
            plServerShared: meta.companyPlServerShared,
            storageOption: meta.companyStorageOption,
            syncedFromCloud: meta.companySyncedFromCloud,
            plServerGateId: meta.companyPlServerGateId,
            plServerGateServerUrl: meta.companyPlServerGateServerUrl,
            plServerHostCompanyId: meta.companyPlServerHostCompanyId,
          }
        : null
    );
    livePullDevLog("effect_run", {
      runNumber,
      schedulerEpoch,
      deps: {
        companyId: snap.companyId || null,
        plServerShared: snap.companyPlServerShared,
        storageOption: snap.storageOption,
        schedulerEpoch,
      },
      ...snap,
    });

    if (!shouldRunPlServerContinuousLiveSync()) {
      livePullDevLog("scheduler_not_started", {
        runNumber,
        reason: "hub_origin_no_live_sync",
        blockers: snap.blockers,
      });
      return;
    }

    const id = snap.companyId;
    if (id && meta.companyPlServerGateServerUrl) {
      registerPlServerCompanyTransportHint(id, meta.companyPlServerGateServerUrl);
    }
    if (!id) {
      livePullDevLog("scheduler_not_started", { runNumber, reason: "no_company_id", blockers: snap.blockers });
      plServerVoucherFlowLog("scheduler_not_started", { runNumber, reason: "no_company_id", blockers: snap.blockers });
      return;
    }
    if (!snap.accessContextEnabled) {
      livePullDevLog("scheduler_not_started", {
        runNumber,
        reason: "accessContextFalse",
        blockers: snap.blockers,
      });
      plServerVoucherFlowLog("scheduler_not_started", {
        runNumber,
        companyId: id,
        reason: "accessContextFalse",
        blockers: snap.blockers,
      });
      return;
    }
    if (!snap.canSync) {
      livePullDevLog("scheduler_not_started", {
        runNumber,
        reason: "canSync_false",
        blockers: snap.blockers,
        activeGateId: snap.activeGateId,
        activeGateType: snap.activeGateType,
        gateConnected: snap.gateConnected,
        localAuthTokenPresent: snap.localAuthTokenPresent,
        gateCompanyAllowed: snap.gateCompanyAllowed,
      });
      plServerVoucherFlowLog("scheduler_not_started", {
        runNumber,
        companyId: id,
        reason: "canSync_false",
        blockers: snap.blockers,
        activeGateType: snap.activeGateType,
        gateConnected: snap.gateConnected,
        localAuthTokenPresent: snap.localAuthTokenPresent,
        gateCompanyAllowed: snap.gateCompanyAllowed,
      });
      return;
    }
    if (!snap.isServerRow) {
      livePullDevLog("scheduler_not_started", {
        runNumber,
        reason: "companySharedFalse",
        blockers: snap.blockers,
        companyPlServerShared: snap.companyPlServerShared,
      });
      plServerVoucherFlowLog("scheduler_not_started", {
        runNumber,
        companyId: id,
        reason: "companySharedFalse",
        blockers: snap.blockers,
        companyPlServerShared: snap.companyPlServerShared,
      });
      return;
    }

    function sseTrustworthyForIdleSkip(): boolean {
      if (!serverEventsOpenRef.current) return false;
      const last = lastServerChangeEventAtRef.current;
      if (!last) return false;
      return Date.now() - last < LIVE_SSE_STALE_MS;
    }

    function desiredFocusPollMs(): number {
      if (sseTrustworthyForIdleSkip()) return 0;
      const health = getPlServerReadSyncHealth(id);
      if (health.consecutiveFailures >= 3) return Math.max(LIVE_POLL_MS_HOST_DOWN, LIVE_FOCUS_POLL_MS);
      if (health.consecutiveFailures >= 2) return LIVE_POLL_MS_AFTER_FAILURE;
      return LIVE_FOCUS_POLL_MS;
    }

    function schedulePoll() {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      if (fullCheckTimerRef.current) window.clearInterval(fullCheckTimerRef.current);
      fullCheckTimerRef.current = null;
      if (sseTrustworthyForIdleSkip()) {
        pollIntervalMsRef.current = 0;
        return;
      }
      const nextMs = desiredFocusPollMs();
      pollIntervalMsRef.current = nextMs;
      pollTimerRef.current = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void runPull("focus_poll");
      }, nextMs);
    }

    const runPull = async (reason: string) => {
      const remoteTriggered = isPlServerRemoteLivePullReason(reason);
      const parallelFocus = isParallelFocusPullReason(reason);
      const healthBefore = getPlServerReadSyncHealth(id);
      // SSE open alone ≠ healthy (WAN silent stream). Skip idle poll only after real change events.
      if (reason === "focus_poll" && sseTrustworthyForIdleSkip()) {
        markPlServerReadUsingLocalCache(id);
        livePullDevLog("poll_skipped", {
          reason: "sse_proven_idle",
          trigger: reason,
          companyId: id,
          lastSseChangeAgeMs: Date.now() - lastServerChangeEventAtRef.current,
        });
        plServerVoucherFlowLog("poll_skipped", {
          companyId: id,
          reason: "sse_proven_idle",
          trigger: reason,
        });
        const nextMs = desiredFocusPollMs();
        if (nextMs !== pollIntervalMsRef.current) schedulePoll();
        return;
      }
      // Host down / unreachable: local SQLite pe pura data hai — menu mat atkao.
      if (isSkippableWhenHostDown(reason) && hostLooksUnreachable(healthBefore)) {
        markPlServerReadUsingLocalCache(id);
        livePullDevLog("poll_skipped", {
          reason: "host_unreachable_use_local_sqlite",
          trigger: reason,
          companyId: id,
          consecutiveFailures: healthBefore.consecutiveFailures,
          healthState: healthBefore.state,
        });
        plServerVoucherFlowLog("poll_skipped", {
          reason: "host_unreachable_use_local_sqlite",
          trigger: reason,
          companyId: id,
          consecutiveFailures: healthBefore.consecutiveFailures,
        });
        return;
      }
      if (syncingRef.current) {
        // Parallel meta/ledger while another pull runs = main-thread + SQLite contention → sidebar freeze.
        // Queue once; hub meta timer / SSE handle roles.
        if (parallelFocus && reason === "focus_poll") {
          livePullDevLog("poll_skipped", { reason: "sync_in_flight_no_parallel_focus", trigger: reason, companyId: id });
          plNavLog("poll_skipped_in_flight", { companyId: id, trigger: reason });
          pendingPullReasonRef.current = pendingPullReasonRef.current || reason;
          return;
        }
        if (parallelFocus && !focusSyncingRef.current) {
          focusSyncingRef.current = true;
          try {
            const focusCollectionsForLog = plServerLiveCollectionsForPathname(pathnameRef.current);
            const serverEventCollectionMatch = reason.match(/^server_event_(.+)$/);
            const serverEventCollection = serverEventCollectionMatch?.[1]?.trim() || "";
            let focusCollections = focusCollectionsForLog;
            if (serverEventCollection) {
              focusCollections = [
                ...new Set([serverEventCollection, ...focusCollectionsForLog]),
              ] as CompanyBackupCollection[];
            }
            plNavLog("parallel_focus_pull", { companyId: id, trigger: reason, focusCollections });
            const result = await syncPlServerSharedCompanyLive(id, {
              pollOnly: true,
              focusCollections,
              ignoreLivePullPause: true,
              pullReason: reason,
            });
            if (result.ok && result.changedCollections?.length) {
              for (const col of result.changedCollections) {
                notifyBrowserDbCollectionUpdated(id, col, { immediate: true, source: "pl_server_pull" });
              }
            }
          } finally {
            focusSyncingRef.current = false;
          }
          return;
        }
        livePullDevLog("poll_skipped", { reason: "sync_in_flight", trigger: reason, companyId: id });
        pendingPullReasonRef.current = reason;
        plServerVoucherFlowLog("poll_queued_after_in_flight", { trigger: reason, companyId: id });
        return;
      }
      if (focusSyncingRef.current && parallelFocus) {
        return;
      }
      if (reason === "focus_poll" && typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (!isPlServerThinStaffClient()) {
          livePullDevLog("poll_skipped", { reason: "offline", trigger: reason, companyId: id });
          plServerVoucherFlowLog("poll_skipped", { reason: "offline", trigger: reason, companyId: id });
          return;
        }
      }
      const now = Date.now();
      const pollDebounceMs = Math.max(400, pollIntervalMsRef.current - 400);
      const debounceReason = reason === "focus_poll";
      if (debounceReason && now - lastPullRef.current < pollDebounceMs) {
        livePullDevLog("poll_skipped", { reason: "poll_debounce", trigger: reason, companyId: id });
        plServerVoucherFlowLog("poll_skipped", {
          reason: "poll_debounce",
          trigger: reason,
          companyId: id,
          elapsedMs: now - lastPullRef.current,
          debounceMs: pollDebounceMs,
        });
        return;
      }
      const serverEventCollectionMatch = reason.match(/^server_event_(.+)$/);
      const serverEventCollection = serverEventCollectionMatch?.[1]?.trim() || "";
      const mountLight = reason === "mount_light";
      // Default: page focus collections. Full ledger sirf jab local empty/behind.
      let focusCollectionsForLog: CompanyBackupCollection[] | undefined =
        plServerLiveCollectionsForPathname(pathnameRef.current);
      if (serverEventCollection) {
        const pageCollections = plServerLiveCollectionsForPathname(pathnameRef.current);
        focusCollectionsForLog = [
          ...new Set([serverEventCollection, ...pageCollections]),
        ] as CompanyBackupCollection[];
      } else if (reason === "mount" || reason === "full_check") {
        const needsFull = await plServerCompanyLedgerNeedsFullPull(id);
        if (needsFull) {
          focusCollectionsForLog = undefined;
        }
        livePullDevLog("full_ledger_decision", {
          trigger: reason,
          companyId: id,
          needsFull,
          mode: needsFull ? "full_ledger" : "focus_only",
        });
      }
      const fullCheck = !focusCollectionsForLog;
      livePullDevLog("poll_started", { trigger: reason, companyId: id, sharedCompaniesCount: snap.sharedCompaniesCount });
      if (!focusCollectionsForLog || (focusCollectionsForLog as readonly string[]).includes("vouchers")) {
        plServerVoucherFlowLog("poll_started", {
          trigger: reason,
          companyId: id,
          fullCheck,
          focusCollections: focusCollectionsForLog,
        });
      }
      syncingRef.current = true;
      let pullOk = false;
      try {
        // Meta: mount / soft full_check only — focus_poll pe har baar meta = setCompany storm + UI freeze.
        // Live role = hub 30s timer + company_meta SSE.
        if (
          (isPlHubServerClientMode() || isPlServerThinStaffClient()) &&
          (reason === "mount" || reason === "full_check" || reason === "mount_light")
        ) {
          plNavLog("company_meta_pull", { companyId: id, trigger: reason });
          const { pullPlServerCompanyMetaFromHost } = await import("@/lib/plServerCompanyMetaSync");
          await pullPlServerCompanyMetaFromHost(id).catch(() => undefined);
        }
        if (reason === "mount" || reason === "full_check" || reason === "mount_light") {
          // Cached gate/company context is enough to paint and pull the active
          // company. Refresh permissions in parallel so a slow host cannot hold
          // the SQLite-first UI or focused voucher lane blank.
          void refreshPlServerAccessContext().catch(() => null);
        }
        const focusCollections = focusCollectionsForLog;
        const result = await syncPlServerSharedCompanyLive(id, {
          pollOnly: mountLight || reason !== "mount",
          focusCollections,
          ignoreLivePullPause: remoteTriggered || mountLight,
          pullReason: reason,
        });
        pullOk = result.ok;
        lastPullRef.current = Date.now();
        livePullDevLog("pull_finished", {
          trigger: reason,
          companyId: id,
          ok: result.ok,
          fullPull: result.fullPull,
          focusCollections,
          changedCollections: result.changedCollections,
        });
        // No full voucher table scan here — was EXE idle lag on every poll.
        if (!focusCollections || (focusCollections as readonly string[]).includes("vouchers")) {
          plServerVoucherFlowLog("poll_finished", {
            trigger: reason,
            companyId: id,
            ok: result.ok,
            fullPull: result.fullPull,
            focusCollections,
            changedCollections: result.changedCollections,
          });
        }
        const bumpCollections: CompanyBackupCollection[] =
          result.changedCollections?.length
            ? result.changedCollections
            : serverEventCollection
              ? ([serverEventCollection] as CompanyBackupCollection[])
              : [];
        if ((result.ok || remoteTriggered) && bumpCollections.length > 0) {
          // Focus/full delta already notified per upserted collection. Only bump when
          // SSE collection hint had no changedCollections (avoid double UI remmerge).
          if (!result.changedCollections?.length) {
            for (const col of bumpCollections) {
              notifyBrowserDbCollectionUpdated(id, col, { immediate: true, source: "pl_server_pull" });
              if (col === "vouchers") {
                plServerVoucherFlowLog("ui_bump_dispatched", {
                  trigger: reason,
                  companyId: id,
                  collection: col,
                });
              }
            }
          }
        }
        {
          const nextMs = desiredFocusPollMs();
          if (nextMs !== pollIntervalMsRef.current) {
            schedulePoll();
          }
        }
        if (result.ok && reason === "mount") {
          const vouchers = await listCompanyDocsFromBrowserDb(id, "vouchers", { forBackupMerge: true });
          if (vouchers.length === 0) {
            console.warn("[PlServerLiveSyncManager] vouchers still empty after mount pull");
          }
        }
      } finally {
        syncingRef.current = false;
        const queuedReason = pendingPullReasonRef.current;
        pendingPullReasonRef.current = null;
        if (queuedReason) {
          window.setTimeout(() => void runPull(`queued_${queuedReason}`), pullOk ? 50 : 2_000);
        }
      }
    };

    livePullDevLog("scheduler_started", {
      runNumber,
      schedulerEpoch,
      companyId: id,
      pollMs: LIVE_FOCUS_POLL_MS,
      fullCheckMs: LIVE_FULL_CHECK_MS,
      ...snap,
    });
    // Let the dashboard paint its local SQLite projection first. Network sync still
    // starts within one second, but cannot monopolize the cold-start database read.
    const initialPullTimer = window.setTimeout(() => {
      void (async () => {
        const needsFull = await plServerCompanyLedgerNeedsFullPull(id);
        void runPull(needsFull ? "mount" : "mount_light");
      })();
    }, 750);
    schedulePoll();
    let eventSource: EventSource | null = null;
    let eventsConnectInFlight = false;
    let hubMetaTimer: number | null = null;
    const startServerEvents = () => {
      if (isPlHubServerClientMode() || isPlServerThinStaffClient()) {
        if (hubMetaTimer == null) {
          hubMetaTimer = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            void import("@/lib/plServerCompanyMetaSync").then(({ pullPlServerCompanyMetaFromHost }) =>
              pullPlServerCompanyMetaFromHost(id)
            );
          }, HUB_COMPANY_META_POLL_MS);
          void import("@/lib/plServerCompanyMetaSync").then(({ pullPlServerCompanyMetaFromHost }) =>
            pullPlServerCompanyMetaFromHost(id)
          );
        }
      }
      if (typeof EventSource === "undefined") return;
      if (eventSource || eventsConnectInFlight) return;
      const transport = resolvePlServerDeltaTransport(id);
      if (!transport) return;
      eventsConnectInFlight = true;
      void (async () => {
        try {
          const { resolvePlServerHostCompanyId } = await import("@/lib/plServerHostCompanyId");
          const hostCompanyId = (await resolvePlServerHostCompanyId(id)) || id;
          if (eventSource) return;
          const url = new URL(`${transport.baseUrl.replace(/\/$/, "")}/__pl_company_delta_events`);
          // Host SSE `client.companyId` host canonical id pe match hota hai (local slug_xxx alag ho sakta hai).
          url.searchParams.set("companyId", hostCompanyId);
          const appAccount = readCurrentAppAccountIdentity();
          if (appAccount) url.searchParams.set("appAccount", appAccount);
          eventSource = new EventSource(url.toString());
          eventSource.onopen = () => {
            serverEventsOpenRef.current = true;
            // Do not mark proven until a real `change` arrives — open-only was WAN silent-fail.
            plServerVoucherFlowLog("server_event_open", { companyId: id });
            schedulePoll();
          };
          eventSource.addEventListener("change", (event) => {
            lastServerChangeEventAtRef.current = Date.now();
            schedulePoll();
            let payload: { collection?: unknown; source?: unknown; docs?: unknown; company?: unknown } = {};
            try {
              payload = JSON.parse((event as MessageEvent).data || "{}") as typeof payload;
            } catch {
              payload = {};
            }
            const collection = String(payload.collection || "").trim();
            if (!collection) return;
            plServerVoucherFlowLog("server_event_pull", {
              companyId: id,
              collection,
              source: String(payload.source || ""),
            });
            if (collection === "company_meta") {
              if (payload.company && typeof payload.company === "object") {
                void import("@/lib/plServerCompanyMetaSync").then(
                  ({ applyPlServerCompanyMetaPatch }) =>
                    applyPlServerCompanyMetaPatch(
                      id,
                      payload.company as Record<string, unknown>
                    )
                );
                return;
              }
              void (async () => {
                const { pullPlServerCompanyMetaFromHost } = await import("@/lib/plServerCompanyMetaSync");
                await pullPlServerCompanyMetaFromHost(id);
              })();
              return;
            }
            const liveDocs = Array.isArray(payload.docs)
              ? (payload.docs as Array<Record<string, unknown>>)
              : [];
            if (liveDocs.length > 0) {
              void (async () => {
                const { applyPlServerLiveDeltaDocs } = await import("@/lib/plServerClientCompanyDelta");
                const result = await applyPlServerLiveDeltaDocs(
                  id,
                  collection as CompanyBackupCollection,
                  liveDocs
                );
                // Docs already applied — UI merge only (pl_host_remote_write would re-pull).
                notifyBrowserDbCollectionUpdated(id, collection, {
                  immediate: true,
                  source: "pl_server_pull",
                });
                plServerVoucherFlowLog("server_event_docs_applied", {
                  companyId: id,
                  collection,
                  received: liveDocs.length,
                  upserted: result.upserted,
                  skipped: result.skipped,
                });
              })();
              return;
            }
            void runPull(`server_event_${collection}`);
          });
          eventSource.onerror = () => {
            serverEventsOpenRef.current = false;
            lastServerChangeEventAtRef.current = 0;
            plServerVoucherFlowLog("server_event_error", { companyId: id });
            if (eventSource) {
              eventSource.close();
              eventSource = null;
            }
            schedulePoll();
            if (serverEventRetryTimerRef.current != null) {
              window.clearTimeout(serverEventRetryTimerRef.current);
            }
            serverEventRetryTimerRef.current = window.setTimeout(() => {
              serverEventRetryTimerRef.current = null;
              const health = getPlServerReadSyncHealth(id);
              if (health.consecutiveFailures < 2 || typeof navigator === "undefined" || navigator.onLine) {
                startServerEvents();
              }
            }, LIVE_SERVER_EVENT_RETRY_MS);
          };
        } catch {
          eventSource = null;
        } finally {
          eventsConnectInFlight = false;
        }
      })();
    };
    startServerEvents();
    const onOnline = () => {
      markPlServerReadSyncReconnecting(id);
      serverEventsOpenRef.current = false;
      lastServerChangeEventAtRef.current = 0;
      pollIntervalMsRef.current = LIVE_FOCUS_POLL_MS;
      schedulePoll();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (serverEventRetryTimerRef.current != null) {
        window.clearTimeout(serverEventRetryTimerRef.current);
        serverEventRetryTimerRef.current = null;
      }
      startServerEvents();
      void runPull("online");
    };
    let hiddenAt = 0;
    const HIDDEN_WAKE_MS = 15_000;
    const onFocus = () => {
      if (sseTrustworthyForIdleSkip()) return;
      void runPull("window_focus");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (!sseTrustworthyForIdleSkip() || hiddenFor >= HIDDEN_WAKE_MS) {
        void runPull("visibility_visible");
      }
    };
    const electronTabBridge = (
      window as unknown as {
        plElectronTabBridge?: {
          onLiveSyncResume?: (callback: (payload: { reason?: string }) => void) => () => void;
        };
      }
    ).plElectronTabBridge;
    const unsubscribeElectronResume = electronTabBridge?.onLiveSyncResume?.((payload) => {
      markPlServerReadSyncReconnecting(id);
      serverEventsOpenRef.current = false;
      lastServerChangeEventAtRef.current = 0;
      pollIntervalMsRef.current = LIVE_FOCUS_POLL_MS;
      schedulePoll();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      startServerEvents();
      void runPull(`electron_resume_${String(payload?.reason || "window")}`);
    });
    const onLocalBump = (event: Event) => {
      const detail = (event as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (!detail || detail.companyId !== id) return;
      // Same-tab pull already applied docs — UI merge via pl_server_pull; do not re-pull (loop → freeze).
      if (detail.source === "pl_server_pull") {
        return;
      }
      if (detail.source === "pl_host_remote_write") {
        void import("@/lib/plServerLiveChangeTrace")
          .then(({ plServerLiveChangeTrace }) =>
            plServerLiveChangeTrace("live_pull_remote_bump", {
              companyId: id,
              collection: detail.collection,
            })
          )
          .catch(() => undefined);
        void runPull(`remote_bump_${detail.collection}`);
        return;
      }
      const focusCollections = plServerLiveCollectionsForPathname(pathnameRef.current);
      if (!(focusCollections as readonly string[]).includes(detail.collection)) return;
      plServerVoucherFlowLog("local_bump_seen_no_pull", {
        companyId: id,
        collection: detail.collection,
        source: detail.source || "local_write",
      });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onLocalBump);

    return () => {
      livePullDevLog("scheduler_stopped", { runNumber, schedulerEpoch, companyId: id });
      serverEventsOpenRef.current = false;
      lastServerChangeEventAtRef.current = 0;
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (fullCheckTimerRef.current) window.clearInterval(fullCheckTimerRef.current);
      window.clearTimeout(initialPullTimer);
      if (eventSource) eventSource.close();
      if (hubMetaTimer != null) window.clearInterval(hubMetaTimer);
      if (serverEventRetryTimerRef.current != null) window.clearTimeout(serverEventRetryTimerRef.current);
      pollTimerRef.current = null;
      fullCheckTimerRef.current = null;
      eventSource = null;
      hubMetaTimer = null;
      serverEventRetryTimerRef.current = null;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onLocalBump);
      unsubscribeElectronResume?.();
    };
  }, [companyId, schedulerEpoch]);

  /**
   * Route change: SQLite-first paint only.
   * Pehle har menu click pe vouchers/parties pl_server_pull remmerge (immediate) → EXE UI 1+ min freeze.
   * New page mounts already SQLite se padhta hai; host deltas = focus_poll / SSE.
   */
  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    const from = pathnameRef.current;
    pathnameRef.current = pathname;
    if (!companyId) return;
    const id = String(companyId).trim();
    if (!id) return;

    const focusCollections = plServerLiveCollectionsForPathname(pathname);
    plNavLog("route_sqlite_first_no_remmerge", {
      companyId: id,
      from,
      pathname,
      focusCollections,
      networkPull: false,
      collectionBump: false,
    });
    livePullDevLog("route_local_sqlite_only", {
      companyId: id,
      pathname,
      focusCollections,
    });
  }, [pathname, companyId]);

  return null;
}
