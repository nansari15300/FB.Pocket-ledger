"use client";

/**
 * Pocket Ledger Server realtime (admin Live / Delta).
 *
 * PocketBase 0.23+ (this server is 0.40.x) requires topics `collection/*`, not the bare
 * collection name. The SSE event name is that same topic (`pl_vouchers/*`).
 *
 *   Live  — change-log + data collections; collection events apply to SQLite immediately.
 *   Delta — `pl_change_log/*` only; then the existing change-log pull.
 *
 * EventSource cannot send Authorization, so the primary stream is `fetch` with the token.
 * EventSource (`?authorization=`) is the fallback.
 * Server `pl_ping` (once a minute) keeps the Cloudflare tunnel open — do not drop/reconnect
 * on a timer; that used to force a company catch-up every 80s.
 */

import { getValidPocketBaseAuth, pbRequest } from "@/lib/pocketbaseData/pbClient";
import { PB_DATA_COLLECTIONS } from "@/lib/pocketbaseData/pbMapping";
import {
  appCompanyIdForPocketBaseRecord,
  applyPocketBaseRealtimeRecord,
  pbDeviceId,
  pocketBaseCompanyRecId,
  pullPocketBaseCompanyToLocalHealed,
  pullPocketBaseVoucherFormMastersToLocal,
} from "@/lib/pocketbaseData/pbSync";
import {
  activePocketBaseCompanyId,
  dialogActivePocketBaseCompanyId,
  isActivePocketBaseCompanyId,
  listActivePocketBaseCompanyIds,
  listPocketBaseCompanyIds,
} from "@/lib/pocketbaseData/pbCompanyRegistry";
import { SELECTED_COMPANY_CHANGED_EVENT } from "@/lib/selectedCompanyStorage";
import { setPocketBaseRealtimeLive } from "@/lib/pocketbaseData/pbRealtimeState";

export type PocketBaseRealtimeMode = "live" | "delta";

const CHANGE_LOG_TOPIC = "pl_change_log";
/** Custom server event (pb_hooks/lib/udoc.js): messages / users / settings changed on another device. */
const UDOC_TOPIC = "pl_udoc";
/** Migration-fixed collection ids (subscribe both name and id). */
const COLLECTION_IDS: Record<string, string> = {
  pl_change_log: "plc_change_log",
  pl_companies: "plc_companies",
  pl_vouchers: "plc_vouchers",
  pl_parties: "plc_parties",
  pl_bank_accounts: "plc_bank_accounts",
  pl_staff: "plc_staff",
  pl_items: "plc_items",
  pl_taxes: "plc_taxes",
  pl_expense_accounts: "plc_expense_accounts",
  pl_groups: "plc_groups",
  pl_unassigned_documents: "plc_unassigned_documents",
  pl_docs: "plc_docs",
};
const LIVE_COLLECTIONS = [...PB_DATA_COLLECTIONS, "pl_companies"] as const;
const PULL_DEBOUNCE_MS = 400;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 15_000;
const CONNECT_WAIT_MS = 8_000;
const CATCHUP_MIN_MS = 8_000;
/** Tab focus / visibility: at most one catch-up pull per minute while SSE is already live. */
const FOCUS_CATCHUP_MIN_MS = 60_000;

type RealtimePayload = {
  action?: string;
  record?: Record<string, unknown> & {
    company?: string;
    deviceId?: string;
    collectionName?: string;
    collectionId?: string;
  };
};

let feedConnected = false;
let pushPauseDepth = 0;
let pauseDropStream: (() => void) | null = null;
let pauseReconnect: (() => void) | null = null;
let pauseCatchup: (() => void) | null = null;
const streamDroppedWaiters: Array<() => void> = [];

function notifyStreamDropped(): void {
  while (streamDroppedWaiters.length) {
    const done = streamDroppedWaiters.shift();
    try {
      done?.();
    } catch {
      /* ignore */
    }
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = typeof window !== "undefined" ? window.setTimeout : setTimeout;
    t(resolve, ms);
  });
}

/** True after subscribe succeeded and the stream is still open. */
export function isPocketBaseRealtimeConnected(): boolean {
  return feedConnected;
}

/**
 * HTTP/1.1 ~6 connections/host: the live SSE fetch can starve the writer's outbox POST
 * until a page refresh drops the stream. Pause SSE around PocketBase pushes and wait
 * until the slot is actually free (voucher JSON is larger than master edits).
 */
export async function pausePocketBaseRealtimeForPush(): Promise<void> {
  pushPauseDepth += 1;
  if (pushPauseDepth > 1) return;
  if (!pauseDropStream) return;
  const dropped = new Promise<void>((resolve) => {
    streamDroppedWaiters.push(resolve);
  });
  pauseDropStream();
  await Promise.race([dropped, waitMs(250)]);
  // Chrome keeps the aborted SSE socket counted briefly; give the voucher POST a slot.
  await waitMs(40);
}

export function resumePocketBaseRealtimeAfterPush(): void {
  pushPauseDepth = Math.max(0, pushPauseDepth - 1);
  if (pushPauseDepth === 0) {
    pauseReconnect?.();
    pauseCatchup?.();
  }
}

function wildcard(name: string): string {
  return `${name}/*`;
}

/** PocketBase 0.23+ collection-wide topic is `name/*` (id/* as alias). */
function topicsFor(mode: PocketBaseRealtimeMode): string[] {
  const names = mode === "live" ? [CHANGE_LOG_TOPIC, ...LIVE_COLLECTIONS] : [CHANGE_LOG_TOPIC];
  const out: string[] = [UDOC_TOPIC];
  const add = (n: string) => {
    if (!n || out.includes(n)) return;
    out.push(n);
  };
  for (const name of names) {
    add(wildcard(name));
    const id = COLLECTION_IDS[name];
    if (id) add(wildcard(id));
  }
  return out;
}

function eventNamesToListen(mode: PocketBaseRealtimeMode): string[] {
  return ["PB_CONNECT", ...topicsFor(mode)];
}

/** `pl_vouchers/*` / `plc_vouchers` / `pl_vouchers` -> collection name. */
function collectionFromTopic(eventName: string, rec?: RealtimePayload["record"]): string {
  const fromRec = String(rec?.collectionName || "").trim();
  if (fromRec) return fromRec;
  const fromId = String(rec?.collectionId || "").trim();
  for (const [name, id] of Object.entries(COLLECTION_IDS)) {
    if (id === fromId) return name;
  }
  const raw = String(eventName || "").split("?")[0].trim();
  const base = raw.endsWith("/*") ? raw.slice(0, -2) : raw.includes("/") ? raw.split("/")[0] : raw;
  for (const [name, id] of Object.entries(COLLECTION_IDS)) {
    if (base === name || base === id) return name;
  }
  return base;
}

function parseSse(buffer: string): { rest: string; events: Array<{ event: string; data: string; id: string }> } {
  const events: Array<{ event: string; data: string; id: string }> = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  for (const block of parts) {
    let event = "message";
    let data = "";
    let id = "";
    for (const rawLine of block.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
    }
    if (event || data) events.push({ event, data, id });
  }
  return { rest, events };
}

function realtimeUrl(authUrl: string, token?: string): string {
  const base = `${authUrl.replace(/\/+$/, "")}/api/realtime`;
  if (!token) return base;
  return `${base}?authorization=${encodeURIComponent(token)}`;
}

/** Start the live/delta feed; returns a stop function. */
export function startPocketBaseLiveChangeFeed(mode: PocketBaseRealtimeMode = "delta"): () => void {
  if (typeof window === "undefined") return () => {};
  let closed = false;
  let retryMs = RECONNECT_MIN_MS;
  /** Consecutive failed subscribe POSTs (e.g. 404 stale client id): back off even while the tab is visible. */
  let subFailStreak = 0;
  let retryTimer: number | null = null;
  let pullTimer: number | null = null;
  let connectWatch: number | null = null;
  let pulling = false;
  let applying = false;
  let es: EventSource | null = null;
  let abort: AbortController | null = null;
  let useFetch = typeof fetch === "function" && typeof ReadableStream !== "undefined";
  let lastCatchupAt = 0;
  const pendingPull = new Set<string>();
  const pendingDialogMasters = new Set<string>();
  let dialogMasterTimer: number | null = null;
  let pullingDialogMasters = false;
  const liveQueue: Array<{ collection: string; action?: string; record: Record<string, unknown> }> = [];
  const myDevice = pbDeviceId();
  const topics = topicsFor(mode);
  const listenNames = eventNamesToListen(mode);

  const setConnected = (v: boolean) => {
    feedConnected = v;
    setPocketBaseRealtimeLive(v);
  };

  const clearConnectWatch = () => {
    if (connectWatch != null) {
      window.clearTimeout(connectWatch);
      connectWatch = null;
    }
  };

  const dropStream = () => {
    setConnected(false);
    clearConnectWatch();
    if (abort) {
      try {
        abort.abort();
      } catch {
        /* ignore */
      }
      abort = null;
    }
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
      es = null;
    }
    notifyStreamDropped();
  };

  const schedulePull = () => {
    if (closed || pullTimer != null) return;
    pullTimer = window.setTimeout(() => void runPulls(), PULL_DEBOUNCE_MS);
  };

  const scheduleDialogMasters = () => {
    if (closed || dialogMasterTimer != null) return;
    dialogMasterTimer = window.setTimeout(() => void runDialogMasterPulls(), PULL_DEBOUNCE_MS);
  };

  const runDialogMasterPulls = async () => {
    dialogMasterTimer = null;
    if (pullingDialogMasters || closed) return;
    pullingDialogMasters = true;
    const ids = Array.from(pendingDialogMasters).filter((id) => id === dialogActivePocketBaseCompanyId());
    pendingDialogMasters.clear();
    try {
      for (const id of ids) {
        if (closed) break;
        if (id !== dialogActivePocketBaseCompanyId()) continue;
        try {
          await pullPocketBaseVoucherFormMastersToLocal(id);
        } catch (e) {
          console.warn("[pbRealtime] dialog masters pull failed", id, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      pullingDialogMasters = false;
      if (pendingDialogMasters.size) scheduleDialogMasters();
    }
  };

  const queueAll = (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() - lastCatchupAt < CATCHUP_MIN_MS) return;
    lastCatchupAt = Date.now();
    for (const id of listActivePocketBaseCompanyIds()) pendingPull.add(id);
    schedulePull();
  };

  const runPulls = async () => {
    pullTimer = null;
    if (pulling || closed) return;
    pulling = true;
    const ids = Array.from(pendingPull).filter(isActivePocketBaseCompanyId);
    pendingPull.clear();
    try {
      for (const id of ids) {
        if (closed) break;
        if (!isActivePocketBaseCompanyId(id)) continue; // switched away mid-loop: that company sleeps
        try {
          await pullPocketBaseCompanyToLocalHealed(id, { oncePerSession: true });
        } catch (e) {
          console.warn("[pbRealtime] pull failed", id, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      pulling = false;
      if (pendingPull.size) schedulePull();
    }
  };

  const drainLive = async () => {
    if (applying || closed) return;
    applying = true;
    try {
      while (liveQueue.length && !closed) {
        const item = liveQueue.shift()!;
        try {
          const r = await applyPocketBaseRealtimeRecord(item.collection, item.record, item.action);
          if (r === "unmapped" && activePocketBaseCompanyId()) queueAll();
        } catch (e) {
          console.warn("[pbRealtime] live apply failed", item.collection, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      applying = false;
      if (liveQueue.length && !closed) void drainLive();
    }
  };

  const onChangeLog = (data: RealtimePayload) => {
    const rec = data?.record;
    const companyRecId = pocketBaseCompanyRecId(rec);
    if (!companyRecId) return;
    if (myDevice && rec?.deviceId === myDevice) return;
    const hit = appCompanyIdForPocketBaseRecord(companyRecId, listPocketBaseCompanyIds());
    if (hit.appCompanyId) {
      if (hit.appCompanyId === activePocketBaseCompanyId()) {
        pendingPull.add(hit.appCompanyId);
        schedulePull();
        return;
      }
      if (hit.appCompanyId === dialogActivePocketBaseCompanyId()) {
        pendingDialogMasters.add(hit.appCompanyId);
        scheduleDialogMasters();
      }
    }
  };

  const onCollectionEvent = (collection: string, data: RealtimePayload) => {
    const rec = data?.record;
    if (!rec) return;
    if (myDevice && rec.deviceId === myDevice) return;
    liveQueue.push({ collection, action: data.action, record: rec });
    void drainLive();
  };

  const handleFrame = (eventName: string, rawData: string, lastId: string) => {
    if (closed) return;
    // Server keep-alive ping (pb_hooks/realtime_ping.pb.js): only keeps the tunnel stream open.
    if (eventName === "pl_ping") return;
    if (eventName === UDOC_TOPIC) {
      try {
        window.dispatchEvent(new Event("pl-udoc-written"));
      } catch {
        /* ignore */
      }
      return;
    }
    if (eventName === "PB_CONNECT") {
      let clientId = "";
      try {
        clientId = String((JSON.parse(rawData || "{}") as { clientId?: string }).clientId || "");
      } catch {
        /* ignore */
      }
      if (!clientId) clientId = lastId;
      if (!clientId) return;
      void pbRequest("/api/realtime", { method: "POST", body: { clientId, subscriptions: topics } })
        .then(() => {
          if (closed) return;
          retryMs = RECONNECT_MIN_MS;
          subFailStreak = 0;
          clearConnectWatch();
          setConnected(true);
          // Real reconnect only (stream was down). Catch-up missed change-log rows; nudge udoc listeners once.
          queueAll({ force: true });
          try {
            window.dispatchEvent(new Event("pl-udoc-written"));
          } catch {
            /* ignore */
          }
        })
        .catch((e) => {
          console.warn("[pbRealtime] subscribe failed", e instanceof Error ? e.message : e);
          subFailStreak = Math.min(subFailStreak + 1, 6);
          dropStream();
          scheduleReconnect();
        });
      return;
    }
    let data: RealtimePayload | null = null;
    try {
      data = JSON.parse(rawData || "{}") as RealtimePayload;
    } catch {
      return;
    }
    const coll = collectionFromTopic(eventName, data?.record);
    if (!coll || coll === "message") return;
    if (coll === CHANGE_LOG_TOPIC) {
      onChangeLog(data);
      return;
    }
    if (mode === "live") {
      onCollectionEvent(coll, data);
      return;
    }
    onChangeLog(data);
  };

  const scheduleReconnect = () => {
    if (closed || retryTimer != null || pushPauseDepth > 0) return;
    setConnected(false);
    const baseWait = document.visibilityState === "visible" ? Math.min(retryMs, RECONNECT_MIN_MS) : retryMs;
    const wait = subFailStreak > 0 ? Math.max(baseWait, Math.min(RECONNECT_MIN_MS * 2 ** subFailStreak, 60_000)) : baseWait;
    retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  };

  const armConnectWatch = () => {
    clearConnectWatch();
    connectWatch = window.setTimeout(() => {
      connectWatch = null;
      if (closed || feedConnected) return;
      dropStream();
      if (useFetch) {
        useFetch = false;
        retryMs = RECONNECT_MIN_MS;
        connect();
        return;
      }
      scheduleReconnect();
    }, CONNECT_WAIT_MS);
  };

  const connectFetch = (auth: NonNullable<ReturnType<typeof getValidPocketBaseAuth>>) => {
    const ctrl = new AbortController();
    abort = ctrl;
    armConnectWatch();
    void (async () => {
      try {
        const res = await fetch(realtimeUrl(auth.url), {
          method: "GET",
          headers: { Accept: "text/event-stream", Authorization: auth.token },
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`realtime http ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parsed = parseSse(buf);
          buf = parsed.rest;
          for (const ev of parsed.events) handleFrame(ev.event, ev.data, ev.id);
        }
        if (!closed) {
          dropStream();
          scheduleReconnect();
        }
      } catch (e) {
        if (closed || ctrl.signal.aborted) return;
        console.warn("[pbRealtime] fetch stream failed", e instanceof Error ? e.message : e);
        dropStream();
        useFetch = false;
        retryMs = RECONNECT_MIN_MS;
        connect();
      }
    })();
  };

  const connectEventSource = (auth: NonNullable<ReturnType<typeof getValidPocketBaseAuth>>) => {
    if (typeof EventSource === "undefined") {
      scheduleReconnect();
      return;
    }
    const src = new EventSource(realtimeUrl(auth.url, auth.token));
    es = src;
    armConnectWatch();
    const onEsEvent = (ev: Event) => {
      const me = ev as MessageEvent;
      handleFrame(ev.type, String(me.data || ""), me.lastEventId || "");
    };
    for (const name of listenNames) src.addEventListener(name, onEsEvent);
    src.onerror = () => {
      if (src.readyState === EventSource.CLOSED) {
        if (es === src) dropStream();
        scheduleReconnect();
      }
    };
  };

  function connect() {
    if (closed || pushPauseDepth > 0) return;
    if (es || abort) dropStream();
    const auth = getValidPocketBaseAuth();
    if (!auth) {
      scheduleReconnect();
      return;
    }
    if (useFetch) connectFetch(auth);
    else connectEventSource(auth);
  }

  const onVisible = () => {
    if (closed || document.visibilityState !== "visible") return;
    if (!feedConnected) {
      queueAll({ force: true });
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      retryMs = RECONNECT_MIN_MS;
      dropStream();
      connect();
      return;
    }
    if (Date.now() - lastCatchupAt < FOCUS_CATCHUP_MIN_MS) return;
    queueAll({ force: true });
  };

  const onFocus = () => {
    if (closed || document.visibilityState !== "visible") return;
    if (feedConnected && Date.now() - lastCatchupAt < FOCUS_CATCHUP_MIN_MS) return;
    queueAll({ force: true });
  };

  const onOnline = () => {
    if (closed) return;
    retryMs = RECONNECT_MIN_MS;
    queueAll({ force: true });
    if (!feedConnected) {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      dropStream();
      connect();
    }
  };

  const onSelectedCompany = () => {
    if (closed) return;
    pendingPull.clear();
    liveQueue.length = 0;
    const id = activePocketBaseCompanyId();
    if (!id) return;
    lastCatchupAt = 0;
    pendingPull.add(id);
    schedulePull();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener(SELECTED_COMPANY_CHANGED_EVENT, onSelectedCompany);
  pauseDropStream = () => {
    if (retryTimer != null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    dropStream();
  };
  pauseReconnect = () => {
    if (closed) return;
    retryMs = RECONNECT_MIN_MS;
    connect();
  };
  pauseCatchup = () => {
    if (closed) return;
    queueAll({ force: true });
  };
  connect();

  return () => {
    closed = true;
    setConnected(false);
    if (pauseDropStream) pauseDropStream = null;
    if (pauseReconnect) pauseReconnect = null;
    if (pauseCatchup) pauseCatchup = null;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener(SELECTED_COMPANY_CHANGED_EVENT, onSelectedCompany);
    if (retryTimer != null) window.clearTimeout(retryTimer);
    if (pullTimer != null) window.clearTimeout(pullTimer);
    if (dialogMasterTimer != null) window.clearTimeout(dialogMasterTimer);
    dropStream();
    pendingPull.clear();
    pendingDialogMasters.clear();
    liveQueue.length = 0;
  };
}
