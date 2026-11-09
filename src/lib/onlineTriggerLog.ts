"use client";

import { adToBs } from "@/lib/bs-date";
import { isServerQuotaHoldActive, startServerQuotaHold } from "@/lib/serverQuotaHold";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import {
  addOnlineTriggerOps,
  clearOnlineTriggerOps,
  describeOnlineTriggerRequest,
  reclassifyOnlineTriggerRowOps,
  settleOnlineTriggerOps,
  type OnlineTriggerOpEvent,
} from "@/lib/onlineTriggerOps";

export const ONLINE_TRIGGER_LOG_EVENT = "pl-online-trigger-log";
export const ONLINE_TRIGGER_QUOTA_HOLD_EVENT = "pl-online-trigger-quota-hold";
export const ONLINE_TRIGGER_LOG_PAGE_SIZES = [10, 15, 20, 30, 50, 100] as const;
export const ONLINE_TRIGGER_LOG_PAGE_SIZE = 20;
export const ONLINE_TRIGGER_QUOTA_HOLD_MS = 30 * 60 * 1000;

export type OnlineTriggerLogRow = {
  id: string;
  date: string;
  time: string;
  api: string;
  sentFrom: string;
  voucherType: string;
  header: string;
  feature: string;
  codePath: string;
  count: number;
  success: number;
  failed: number;
  /** Ops that failed because of quota / billing (resource-exhausted). Not counted in failed. */
  quota?: number;
  /** Grouped (month/week/day) rows only: raw row ids behind the group. Never persisted. */
  memberIds?: string[];
  /** Grouped rows only: distinct API names inside the group. Never persisted. */
  apis?: string[];
};

export type OnlineTriggerScope = {
  feature?: string;
  codePath?: string;
  voucherType?: string;
  header?: string;
  sentFrom?: string;
};

const STORAGE_KEY = "pl_online_trigger_log_v1";
const MAX_ROWS = 4000;
const PERSIST_MAX = 4000;
const PERSIST_PER_SOURCE = 500;
const QUOTA_FAIL_WINDOW_MS = 5 * 60 * 1000;

const scopeStack: OnlineTriggerScope[] = [];
let rows: OnlineTriggerLogRow[] = [];
let installed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let idSeq = 0;

export function pushOnlineTriggerScope(scope: OnlineTriggerScope): () => void {
  scopeStack.push(scope);
  return () => {
    const i = scopeStack.lastIndexOf(scope);
    if (i >= 0) scopeStack.splice(i, 1);
  };
}

export async function withOnlineTriggerScope<T>(
  scope: OnlineTriggerScope,
  fn: () => Promise<T> | T
): Promise<T> {
  const pop = pushOnlineTriggerScope(scope);
  try {
    return await fn();
  } finally {
    pop();
  }
}

function mergedScope(): OnlineTriggerScope {
  const out: OnlineTriggerScope = {};
  for (const s of scopeStack) Object.assign(out, s);
  return out;
}

function dash(v: unknown): string {
  const s = String(v || "").trim();
  return s || "—";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function stampNow(): { date: string; time: string } {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(
      d.getMilliseconds()
    ).padStart(3, "0")}`,
  };
}

function sentFromFromPath(pathname: string): string {
  const p = String(pathname || "").toLowerCase();
  if (p.includes("/admin")) return "Admin";
  if (p.includes("/party")) return "Party";
  if (p.includes("/staff")) return "Staff";
  if (p.includes("/bank-cash")) return "Bank/Cash";
  if (p.includes("/tax")) return "Tax";
  if (p.includes("/incomes")) return "Income & Expense";
  if (p.includes("/items")) return "Items";
  if (p.includes("/reports")) return "Reports";
  if (p.includes("/dashboard")) return "Dashboard";
  if (p.includes("/settings")) return "Settings";
  if (p.includes("/gallery")) return "Gallery";
  if (p.includes("/gate")) return "Gate";
  if (p.includes("/production")) return "Production";
  if (p.includes("/billing")) return "Billing";
  if (p.includes("/backup")) return "Backup";
  if (p.includes("/recycle-bin")) return "Recycle Bin";
  return "—";
}

function voucherTypeFromDom(): string {
  if (typeof document === "undefined") return "";
  const el = document.querySelector("[data-pl-voucher-dialog-type], [data-pl-voucher-type]");
  const raw = el?.getAttribute("data-pl-voucher-dialog-type") || el?.getAttribute("data-pl-voucher-type") || "";
  return String(raw).trim();
}

function classifyUrl(url: string, method: string): { api: string; feature: string; codePath: string } | null {
  const u = String(url || "");
  const m = String(method || "GET").toUpperCase();
  if (!u) return null;
  if (/identitytoolkit|securetoken|firebaseinstallations|firebaselogging|crashlytics/i.test(u)) {
    return null;
  }

  if (/firebasestorage\.googleapis\.com|storage\.googleapis\.com\/.*firebasestorage/i.test(u)) {
    const isList = /[?&]prefix=/i.test(u) || /\/o\?/.test(u) && /delimiter=/i.test(u);
    if (m === "DELETE") return { api: "delete", feature: "storage", codePath: "@/lib/pocketbaseData/pbStorage" };
    if (m === "POST" || m === "PUT" || m === "PATCH") {
      return { api: "upload", feature: "storage", codePath: "@/lib/pocketbaseData/pbStorage" };
    }
    if (isList && m === "GET") return { api: "list", feature: "storage", codePath: "@/lib/pocketbaseData/pbStorage" };
    if (/alt=media/i.test(u)) return { api: "download", feature: "storage", codePath: "@/lib/pocketbaseData/pbStorage" };
    return { api: "getURL", feature: "storage", codePath: "@/lib/pocketbaseData/pbStorage" };
  }

  if (/firestore\.googleapis\.com/i.test(u)) {
    if (/\/Listen|:listen|Listen\/channel/i.test(u)) {
      return { api: "listen", feature: "live-sync", codePath: "firebase/firestore" };
    }
    if (/:commit|:write|:batchWrite|\/Write\b/i.test(u) || m === "PATCH" || m === "DELETE" || m === "PUT") {
      return { api: "write", feature: "live-sync", codePath: "firebase/firestore" };
    }
    if (/:list|:listDocuments|listCollectionIds/i.test(u)) {
      return { api: "list", feature: "live-sync", codePath: "firebase/firestore" };
    }
    if (m === "POST" && /documents:/.test(u) && !/:runQuery|:batchGet/i.test(u)) {
      return { api: "write", feature: "live-sync", codePath: "firebase/firestore" };
    }
    return { api: "read", feature: "live-sync", codePath: "firebase/firestore" };
  }

  return null;
}

let logChannel: BroadcastChannel | null = null;

function getLogChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (logChannel) return logChannel;
  try {
    logChannel = new BroadcastChannel("pl-online-trigger-log");
  } catch {
    logChannel = null;
  }
  return logChannel;
}

let emitTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesced: at most one UI event per 250ms, however many requests are logged. */
function emit(): void {
  if (typeof window === "undefined" || emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    window.dispatchEvent(new Event(ONLINE_TRIGGER_LOG_EVENT));
  }, 250);
}

function pingOtherTabs(incoming?: OnlineTriggerLogRow[]): void {
  try {
    getLogChannel()?.postMessage({ t: Date.now(), rows: incoming || null });
  } catch {
    /* ignore */
  }
}

function pullSharedLog(): void {
  rows = mergeLogRows(rows, readLocalLog());
  emit();
}

function parseStored(raw: string | null): OnlineTriggerLogRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r === "object" && r.id) as OnlineTriggerLogRow[];
  } catch {
    return [];
  }
}

function logSourceKey(r: OnlineTriggerLogRow): string {
  if (isQuotaLogRow(r)) return "quota";
  return `${String(r.date || "").slice(0, 7)}|${r.sentFrom}|${r.voucherType}`;
}

function trimLogRows(list: OnlineTriggerLogRow[], max: number): OnlineTriggerLogRow[] {
  if (list.length <= max) return list;
  const sorted = list.slice().sort((a, b) => {
    const c = stampKey(a).localeCompare(stampKey(b));
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
  const buckets = new Map<string, OnlineTriggerLogRow[]>();
  for (const r of sorted) {
    const k = logSourceKey(r);
    const arr = buckets.get(k) || [];
    arr.push(r);
    buckets.set(k, arr);
  }
  const keptIds = new Set<string>();
  for (const [key, arr] of buckets) {
    const take = key === "quota" ? arr : arr.slice(-PERSIST_PER_SOURCE);
    for (const r of take) keptIds.add(r.id);
  }
  let kept = sorted.filter((r) => keptIds.has(r.id));
  if (kept.length <= max) return kept;
  const quota = kept.filter(isQuotaLogRow);
  const rest = kept.filter((r) => !isQuotaLogRow(r));
  const newestBySource = new Map<string, OnlineTriggerLogRow>();
  for (const r of rest) newestBySource.set(logSourceKey(r), r);
  const pin = [...quota, ...newestBySource.values()];
  const pinIds = new Set(pin.map((r) => r.id));
  const extra = rest.filter((r) => !pinIds.has(r.id)).slice(-(Math.max(0, max - pin.length)));
  return [...pin, ...extra].sort((a, b) => {
    const c = stampKey(a).localeCompare(stampKey(b));
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
}

const TRIM_SLACK = 250;

function mergeLogRows(a: OnlineTriggerLogRow[], b: OnlineTriggerLogRow[]): OnlineTriggerLogRow[] {
  const map = new Map<string, OnlineTriggerLogRow>();
  for (const r of a) map.set(r.id, r);
  for (const r of b) map.set(r.id, r);
  return trimLogRows([...map.values()], MAX_ROWS);
}

function readLocalLog(): OnlineTriggerLogRow[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return parseStored(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function schedulePersist(): void {
  if (typeof localStorage === "undefined") return;
  if (persistTimer) return; // throttle (was debounce: reset on every request)
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const merged = trimLogRows(mergeLogRows(readLocalLog(), rows), PERSIST_MAX);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      rows = merged;
      pingOtherTabs(merged.slice(-20));
    } catch {
      /* quota */
    }
  }, 2000);
}

function hydrate(): void {
  rows = readLocalLog();
  if (rows.length > 0) return;
  try {
    if (typeof sessionStorage !== "undefined") {
      const legacy = parseStored(sessionStorage.getItem(STORAGE_KEY));
      if (legacy.length) {
        rows = legacy;
        sessionStorage.removeItem(STORAGE_KEY);
        schedulePersist();
      }
    }
  } catch {
    /* ignore */
  }
}

export function recordOnlineTrigger(partial: {
  api: string;
  feature?: string;
  codePath?: string;
  header?: string;
  sentFrom?: string;
  voucherType?: string;
  success: number;
  failed: number;
  quota?: number;
  count?: number;
}): string {
  const scope = mergedScope();
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const sentFrom = dash(partial.sentFrom || scope.sentFrom || sentFromFromPath(path));
  const voucherType = dash(partial.voucherType || scope.voucherType || voucherTypeFromDom());
  let header = dash(partial.header || scope.header);
  if (header === "—" && sentFrom !== "—" && voucherType === "—") {
    header = `${sentFrom} ledger`;
  }
  const { date, time } = stampNow();
  const row: OnlineTriggerLogRow = {
    id: `ot-${Date.now().toString(36)}-${++idSeq}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    time,
    api: dash(partial.api),
    sentFrom,
    voucherType,
    header,
    feature: dash(partial.feature || scope.feature),
    codePath: dash(partial.codePath || scope.codePath),
    count: Math.max(1, Number(partial.count) || 1),
    success: Math.max(0, Number(partial.success) || 0),
    failed: Math.max(0, Number(partial.failed) || 0),
    quota: Math.max(0, Number(partial.quota) || 0),
  };
  rows.push(row);
  // Amortised trim (full sort only every TRIM_SLACK rows, not on every request).
  if (rows.length > MAX_ROWS + TRIM_SLACK) rows = trimLogRows(rows, MAX_ROWS);
  schedulePersist();
  emit();
  return row.id;
}

/**
 * Sent / Received / Failed model (row fields: count = Sent, success = Received, failed = Failed).
 * A row is recorded when ops are SENT (count = ops, received/failed 0 = in-flight), then settled
 * once the server replies (received += ops), quota/billing errors (quota += ops), or other errors / timeouts / rejections (failed += ops).
 */
type OnlineTriggerOutcome = "received" | "failed" | "quota";

function settleOnlineTrigger(id: string, outcome: OnlineTriggerOutcome): void {
  let idx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.id === id) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return;
  const r = rows[idx]!;
  const pending = Math.max(0, r.count - r.success - r.failed - (r.quota || 0));
  if (pending <= 0) return;
  const next =
    outcome === "received"
      ? { ...r, success: r.success + pending }
      : outcome === "quota"
        ? { ...r, quota: (r.quota || 0) + pending }
        : { ...r, failed: r.failed + pending };
  rows = rows.slice();
  rows[idx] = next;
  schedulePersist();
  emit();
}

function bodyToText(body: unknown): string | null {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
  return null;
}

function opsInFirestoreMessage(msg: unknown): number {
  if (!msg || typeof msg !== "object") return 0;
  const m = msg as Record<string, unknown>;
  let n = 0;
  if (m.addTarget) n += 1;
  if (m.removeTarget != null) n += 1;
  if (Array.isArray(m.writes)) n += m.writes.length;
  return n;
}

/**
 * How many server ops one HTTP request carries.
 * - Firestore WebChannel POST (Listen/Write channel): one op per addTarget / removeTarget / write.
 *   Handshake-only POSTs and the GET long-poll (server -> client reply stream) carry 0 ops.
 * - Firestore REST: writes[] length, batchGet documents[] length, otherwise 1.
 * - Storage and anything else: 1.
 */
/** Record per-op detail events for a just-recorded row (bounded; small bodies only). */
function startOps(sentId: string | null, url: string, method: string, body: unknown, ops: number): OnlineTriggerOpEvent[] | null {
  if (!sentId) return null;
  try {
    const r = rows[rows.length - 1];
    const row = r && r.id === sentId ? r : rows.find((x) => x.id === sentId);
    const from = row
      ? [row.sentFrom, row.voucherType, row.header, row.feature].filter((x) => x && x !== "-").join(" / ")
      : "-";
    const actions = describeOnlineTriggerRequest(url, method, bodyToText(body), row?.voucherType || "");
    return addOnlineTriggerOps(sentId, from || "-", actions, ops);
  } catch {
    return null;
  }
}

function countRequestOps(url: string, method: string, body: unknown): number {
  const u = String(url || "");
  const m = String(method || "GET").toUpperCase();
  if (!/firestore\.googleapis\.com/i.test(u)) return 1;
  const text = bodyToText(body);
  if (text && text.length > 512 * 1024) return 1; // never parse huge bodies on the main thread
  if (/\/channel/i.test(u)) {
    if (m === "GET") return 0;
    if (text == null) return 1;
    let n = 0;
    try {
      const params = new URLSearchParams(text);
      params.forEach((v, k) => {
        if (!/^req\d+___data__$/.test(k)) return;
        try {
          n += opsInFirestoreMessage(JSON.parse(v));
        } catch {
          /* ignore */
        }
      });
    } catch {
      return 1;
    }
    return n;
  }
  if (text) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (Array.isArray(j.writes)) return Math.max(1, j.writes.length);
      if (Array.isArray(j.documents)) return Math.max(1, j.documents.length);
    } catch {
      /* ignore */
    }
  }
  return 1;
}

export function listOnlineTriggerLog(): OnlineTriggerLogRow[] {
  rows = mergeLogRows(rows, readLocalLog());
  // Old stored "Quota exceeded" marker rows are hidden: quota now lives only in the Qta exceeded column.
  return rows.filter((r) => !isQuotaLogRow(r));
}

export function clearOnlineTriggerLog(): void {
  rows = [];
  clearOnlineTriggerOps();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  pingOtherTabs();
  emit();
}

export const ONLINE_TRIGGER_LOG_HEADERS = [
  "Date",
  "Time",
  "API",
  "Sent From / Type",
  "Header",
  "Feature",
  "Code path",
  "Sent",
  "Received",
  "Failed",
  "Qta exceeded",
] as const;

export function formatOnlineTriggerSentFromType(row: Pick<OnlineTriggerLogRow, "sentFrom" | "voucherType">): string {
  const from = String(row.sentFrom || "—").trim() || "—";
  const type = String(row.voucherType || "—").trim() || "—";
  return `${from} / ${type}`;
}

/** Stored ISO AD. Display: AD→AD, BS→BS, Both→AD. */
export function formatOnlineTriggerDateLabel(
  dateLabel: string,
  formatAd: (date: Date) => string,
  formatBs: (date: Date) => string,
  dateSystem: "AD" | "BS" | "Both"
): string {
  const fmt = dateSystem === "BS" ? formatBs : formatAd;
  return String(dateLabel || "")
    .split(/\s*→\s*/)
    .map((part) => {
      const iso = part.trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      if (!m) return iso || "—";
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(d.getTime())) return iso;
      return fmt(d) || iso;
    })
    .join(" → ");
}

export type OnlineTriggerLogView = "monthly" | "weekly" | "daily";
export type OnlineTriggerDateSystem = "AD" | "BS" | "Both";

export function onlineTriggerLogHasTimeColumn(_view: OnlineTriggerLogView): boolean {
  return true;
}

export function onlineTriggerLogHeadersForView(_view: OnlineTriggerLogView): string[] {
  return [...ONLINE_TRIGGER_LOG_HEADERS];
}

function mixedField(values: string[]): string {
  const uniq = [...new Set(values.map((v) => String(v || "—")))];
  return uniq.length === 1 ? uniq[0]! : "—";
}

function parseStoredAdDate(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** AD/Both → AD month day; BS → BS month day. */
function calendarYmd(
  dateStr: string,
  dateSystem: OnlineTriggerDateSystem
): { y: number; m: number; d: number } {
  const ad = parseStoredAdDate(dateStr);
  if (!ad) return { y: 0, m: 1, d: 1 };
  if (dateSystem === "BS") {
    const bs = adToBs(ad);
    return { y: bs.y, m: bs.m, d: bs.d };
  }
  return { y: ad.getFullYear(), m: ad.getMonth() + 1, d: ad.getDate() };
}

function calendarMonthKey(dateStr: string, dateSystem: OnlineTriggerDateSystem): string {
  const { y, m } = calendarYmd(dateStr, dateSystem);
  return `${y}-${pad2(m)}`;
}

function weekOfMonthOrdinal(
  dateStr: string,
  dateSystem: OnlineTriggerDateSystem = "AD"
): { n: number; label: string } {
  const { d } = calendarYmd(dateStr, dateSystem);
  const n = Math.max(1, Math.min(5, Math.ceil(d / 7)));
  const labels = ["1st Week", "2nd Week", "3rd Week", "4th Week", "5th Week"] as const;
  return { n, label: labels[n - 1]! };
}

function stampKey(row: OnlineTriggerLogRow): string {
  return `${row.date} ${row.time}`;
}

function isQuotaLogRow(r: OnlineTriggerLogRow): boolean {
  return (
    r.api === "quota" ||
    r.feature === "quota-hold" ||
    /quota exceeded/i.test(r.header) ||
    /quota exceeded/i.test(r.voucherType)
  );
}

function sortByCreatedAsc(arr: OnlineTriggerLogRow[]): OnlineTriggerLogRow[] {
  return arr.slice().sort((a, b) => {
    const c = stampKey(a).localeCompare(stampKey(b));
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
}

function periodRangeLabels(arr: OnlineTriggerLogRow[]): { dateLabel: string; timeLabel: string } {
  const sorted = sortByCreatedAsc(arr);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const dateLabel = first.date === last.date ? first.date : `${first.date} → ${last.date}`;
  const startTime = first.time || "—";
  const endTime = last.time || "—";
  const timeLabel = startTime === endTime ? startTime : `${startTime} → ${endTime}`;
  return { dateLabel, timeLabel };
}

function collapseGroup(arr: OnlineTriggerLogRow[], id: string, dateLabel: string, timeLabel: string): OnlineTriggerLogRow {
  const first = arr[0]!;
  return {
    id,
    date: dateLabel,
    time: timeLabel,
    api: mixedField(arr.map((x) => x.api)),
    sentFrom: first.sentFrom,
    voucherType: first.voucherType,
    header: mixedField(arr.map((x) => x.header)),
    feature: mixedField(arr.map((x) => x.feature)),
    codePath: mixedField(arr.map((x) => x.codePath)),
    count: arr.reduce((s, x) => s + x.count, 0),
    success: arr.reduce((s, x) => s + x.success, 0),
    failed: arr.reduce((s, x) => s + x.failed, 0),
    quota: arr.reduce((s, x) => s + (x.quota || 0), 0),
    memberIds: arr.flatMap((x) => x.memberIds ?? [x.id]),
    apis: [...new Set(arr.flatMap((x) => x.apis ?? [x.api]))].sort(),
  };
}

/** Collapse by page (Sent from) + voucher type inside a date bucket. Date/time stay on first create. */
export function groupOnlineTriggerLog(
  list: OnlineTriggerLogRow[],
  view: OnlineTriggerLogView,
  dateSystem: OnlineTriggerDateSystem = "AD"
): OnlineTriggerLogRow[] {
  const buckets = new Map<string, OnlineTriggerLogRow[]>();
  for (const r of list) {
    let period = r.date;
    if (view === "monthly") period = calendarMonthKey(r.date, dateSystem);
    if (view === "weekly") {
      const wom = weekOfMonthOrdinal(r.date, dateSystem);
      period = `${calendarMonthKey(r.date, dateSystem)}-W${wom.n}`;
    }
    const quotaRow = isQuotaLogRow(r);
    const api = quotaRow ? "quota" : r.api;
    const key = quotaRow
      ? `${period}|quota|quota|${api}`
      : `${period}|${r.sentFrom}|${r.voucherType}|${api}`;
    const arr = buckets.get(key) || [];
    arr.push(r);
    buckets.set(key, arr);
  }
  const out: { row: OnlineTriggerLogRow; created: string }[] = [];
  for (const [key, arr] of buckets) {
    const createdOrder = arr.slice().sort((a, b) => {
      const c = stampKey(a).localeCompare(stampKey(b));
      return c !== 0 ? c : a.id.localeCompare(b.id);
    });
    const first = createdOrder[0]!;
    const range = periodRangeLabels(createdOrder);
    let dateLabel = range.dateLabel;
    let timeLabel = range.timeLabel;
    if (view === "weekly") {
      dateLabel = weekOfMonthOrdinal(first.date, dateSystem).label;
    }
    out.push({
      created: stampKey(first),
      row: collapseGroup(createdOrder, `grp-${key}`, dateLabel, timeLabel),
    });
  }
  out.sort((a, b) => {
    const c = b.created.localeCompare(a.created);
    if (c !== 0) return c;
    const s = a.row.sentFrom.localeCompare(b.row.sentFrom);
    if (s !== 0) return s;
    return a.row.api.localeCompare(b.row.api);
  });
  return out.map((x) => x.row);
}

export type OnlineTriggerWeekNode = {
  key: string;
  expandKey: string;
  row: OnlineTriggerLogRow;
  types: OnlineTriggerLogRow[];
};

export type OnlineTriggerMonthNode = {
  key: string;
  expandKey: string;
  row: OnlineTriggerLogRow;
  weeks: OnlineTriggerWeekNode[];
};

export type OnlineTriggerFlatRow = {
  key: string;
  row: OnlineTriggerLogRow;
  depth: 0 | 1 | 2;
  expandKey?: string;
};

/** Monthly → weeks → daily per API type (no details). */
export function buildOnlineTriggerLogMonthTree(
  list: OnlineTriggerLogRow[],
  dateSystem: OnlineTriggerDateSystem = "AD"
): OnlineTriggerMonthNode[] {
  type DayBucket = { rows: OnlineTriggerLogRow[]; api: string };
  type WeekBucket = { rows: OnlineTriggerLogRow[]; days: Map<string, DayBucket> };
  type MonthBucket = { rows: OnlineTriggerLogRow[]; weeks: Map<string, WeekBucket> };
  const months = new Map<string, MonthBucket>();

  for (const r of list) {
    const month = calendarMonthKey(r.date, dateSystem);
    const wom = weekOfMonthOrdinal(r.date, dateSystem);
    const quota = isQuotaLogRow(r);
    const sent = quota ? "quota" : r.sentFrom;
    const vtype = quota ? "quota" : r.voucherType;
    const api = quota ? "quota" : r.api;
    const monthKey = `${month}|${sent}|${vtype}|${api}`;
    const weekKey = `${month}|W${wom.n}|${sent}|${vtype}|${api}`;
    const dayKey = `${r.date}|${sent}|${vtype}|${api}`;

    let monthBucket = months.get(monthKey);
    if (!monthBucket) {
      monthBucket = { rows: [], weeks: new Map() };
      months.set(monthKey, monthBucket);
    }
    monthBucket.rows.push(r);

    let weekBucket = monthBucket.weeks.get(weekKey);
    if (!weekBucket) {
      weekBucket = { rows: [], days: new Map() };
      monthBucket.weeks.set(weekKey, weekBucket);
    }
    weekBucket.rows.push(r);

    let dayBucket = weekBucket.days.get(dayKey);
    if (!dayBucket) {
      dayBucket = { rows: [], api: r.api };
      weekBucket.days.set(dayKey, dayBucket);
    }
    dayBucket.rows.push(r);
  }

  const tree: OnlineTriggerMonthNode[] = [];
  for (const [monthKey, monthBucket] of months) {
    const monthSorted = sortByCreatedAsc(monthBucket.rows);
    const weeks: OnlineTriggerWeekNode[] = [];
    for (const [weekKey, weekBucket] of monthBucket.weeks) {
      const weekSorted = sortByCreatedAsc(weekBucket.rows);
      const types: OnlineTriggerLogRow[] = [];
      for (const [dayKey, dayBucket] of weekBucket.days) {
        const daySorted = sortByCreatedAsc(dayBucket.rows);
        const dayRange = periodRangeLabels(daySorted);
        types.push(collapseGroup(daySorted, `day-${dayKey}`, dayRange.dateLabel, dayRange.timeLabel));
      }
      types.sort((a, b) => {
        const c = `${b.date} ${b.api}`.localeCompare(`${a.date} ${a.api}`);
        return c !== 0 ? c : a.id.localeCompare(b.id);
      });
      const weekRange = periodRangeLabels(weekSorted);
      const weekFirst = weekSorted[0]!;
      const weekLabel = weekOfMonthOrdinal(weekFirst.date, dateSystem).label;
      const weekExpand = `exp-w:${weekFirst.date}|${weekFirst.sentFrom}|${weekFirst.voucherType}|${weekFirst.api}`;
      weeks.push({
        key: `week:${weekKey}`,
        expandKey: weekExpand,
        row: collapseGroup(weekSorted, `week-${weekKey}`, weekLabel, weekRange.timeLabel),
        types,
      });
    }
    weeks.sort((a, b) => {
      const na = Number(/\|W(\d+)/.exec(a.key)?.[1] || 0);
      const nb = Number(/\|W(\d+)/.exec(b.key)?.[1] || 0);
      return nb - na || a.key.localeCompare(b.key);
    });
    const monthRange = periodRangeLabels(monthSorted);
    const monthFirst = monthSorted[0]!;
    const monthExpand = `exp-m:${String(monthFirst.date).slice(0, 7)}|${monthFirst.sentFrom}|${monthFirst.voucherType}|${monthFirst.api}`;
    tree.push({
      key: `month:${monthKey}`,
      expandKey: monthExpand,
      row: collapseGroup(monthSorted, `month-${monthKey}`, monthRange.dateLabel, monthRange.timeLabel),
      weeks,
    });
  }
  tree.sort((a, b) => {
    const d = b.row.date.localeCompare(a.row.date);
    if (d !== 0) return d;
    const s = a.row.sentFrom.localeCompare(b.row.sentFrom);
    if (s !== 0) return s;
    return a.row.api.localeCompare(b.row.api);
  });
  return tree;
}

export function flattenOnlineTriggerMonthTree(
  tree: OnlineTriggerMonthNode[],
  expandedMonths: ReadonlySet<string>,
  expandedWeeks: ReadonlySet<string>
): OnlineTriggerFlatRow[] {
  const out: OnlineTriggerFlatRow[] = [];
  for (const month of tree) {
    const monthExpandKey = month.expandKey;
    out.push({
      key: month.key,
      row: month.row,
      depth: 0,
      expandKey: month.weeks.length > 0 ? monthExpandKey : undefined,
    });
    if (!expandedMonths.has(monthExpandKey)) continue;
    for (const week of month.weeks) {
      const weekExpandKey = week.expandKey;
      out.push({
        key: week.key,
        row: week.row,
        depth: 1,
        expandKey: week.types.length > 0 ? weekExpandKey : undefined,
      });
      if (!expandedWeeks.has(weekExpandKey)) continue;
      for (const typeRow of week.types) {
        out.push({ key: typeRow.id, row: typeRow, depth: 2 });
      }
    }
  }
  return out;
}

export function onlineTriggerLogRowMatchesSearch(row: OnlineTriggerLogRow, searchTerm: string): boolean {
  const q = searchTerm.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.date,
    row.time,
    row.api,
    row.sentFrom,
    row.voucherType,
    row.header,
    row.feature,
    row.codePath,
    String(row.count),
    String(row.success),
    String(row.failed),
    String(row.quota || 0),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function formatOnlineTriggerRowTsv(row: OnlineTriggerLogRow, _view: OnlineTriggerLogView = "daily"): string {
  return [
    row.date,
    row.time,
    row.api,
    formatOnlineTriggerSentFromType(row),
    row.header,
    row.feature,
    row.codePath,
    String(row.count),
    String(row.success),
    String(row.failed),
    String(row.quota || 0),
  ].join("\t");
}

export function formatOnlineTriggerLogTsv(list: OnlineTriggerLogRow[], view: OnlineTriggerLogView = "daily"): string {
  return [
    onlineTriggerLogHeadersForView(view).join("\t"),
    ...list.map((row) => formatOnlineTriggerRowTsv(row, view)),
  ].join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input || "");
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== "undefined" && input instanceof Request) return input.method || "GET";
  return "GET";
}

/** Strict token: only a real server quota code (gRPC RESOURCE_EXHAUSTED / Firebase resource-exhausted / Storage quota). */
const STRICT_QUOTA_TOKEN = /resource[-_ ]?exhausted|storage\/quota-exceeded/i;

/** For 2xx bodies / live streams (may contain user data): strict token only. */
function isStreamQuota(text: string): boolean {
  return STRICT_QUOTA_TOKEN.test(String(text || ""));
}

/** Console / SDK log lines (no server reply in hand): must be a Firebase error with code resource-exhausted. */
function isFirebaseQuotaLog(text: string): boolean {
  const t = String(text || "");
  return /resource[-_]exhausted/i.test(t) && /firebase|firestore|flushVoucherOutbox/i.test(t);
}

/** For a server ERROR reply only (non-2xx body, grpc-message, statusText): quota or explicit billing text. */
function isQuotaMessage(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("quota exceeded") ||
    t.includes("exceeded quota") ||
    t.includes("resource exhausted") ||
    t.includes("resource-exhausted") ||
    t.includes("resource_exhausted") ||
    t.includes("resourceexhausted") ||
    // Billing / payment (Storage maps HTTP 402 -> storage/quota-exceeded; GCP billing-disabled texts)
    t.includes("storage/quota-exceeded") ||
    t.includes("quota for bucket") ||
    t.includes("payment required") ||
    t.includes("billing account") ||
    t.includes("billing is disabled") ||
    t.includes("billing has been disabled") ||
    t.includes("billing_disabled") ||
    t.includes("billing not enabled") ||
    t.includes("requires billing") ||
    t.includes("project has been suspended") ||
    t.includes("consumer_suspended") ||
    // (no "maximum backoff" / "error 8": those also fire for plain network failures)
    /"code"\s*:\s*(8|429|402)\b/.test(t) ||
    t.includes("grpc-status\":8")
  );
}

function isQuotaHoldTarget(url: string, method: string): boolean {
  if (classifyUrl(url, method)) return true;
  const u = String(url || "");
  return /\/api\/auth\/web-access/i.test(u) || /\/api\/company\//i.test(u);
}

/** PocketBase-native routes: a 429/402 here is the Pocket Ledger Server, never Firebase quota. */
const PB_NATIVE_PATH_RE =
  /\/api\/(pl|collections|files|realtime|admins|superusers|health|batch|settings|backups|logs|crons?)(\/|\?|$)/i;

/**
 * Quota detection is limited to Firebase / Google endpoints (Firestore, Storage, Identity Toolkit, any
 * *.googleapis.com / firebaseio / firebasestorage.app) and the hosted pocket-ledger.com Next API. PocketBase
 * URLs (/api/pl/*, /api/collections/*, /api/files/*, /api/realtime ...) and the localhost app server never count.
 */
function isQuotaEligibleUrl(rawUrl: string): boolean {
  const raw = String(rawUrl || "").trim();
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw, typeof location !== "undefined" ? location.href : "http://localhost/");
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return false;
  if (PB_NATIVE_PATH_RE.test(u.pathname)) return false;
  if (
    host === "googleapis.com" ||
    host.endsWith(".googleapis.com") ||
    host.endsWith(".firebaseio.com") ||
    host.endsWith(".firebasestorage.app") ||
    host.endsWith(".firebaseapp.com")
  ) {
    return true;
  }
  if (host === "pocket-ledger.com" || host.endsWith(".pocket-ledger.com")) {
    return /\/api\//i.test(u.pathname);
  }
  return false;
}

function isQuotaHoldActive(): boolean {
  return isServerQuotaHoldActive();
}

function rowStampMs(r: OnlineTriggerLogRow): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(`${r.date} ${r.time}`);
  if (!m) return 0;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Number(String(m[7] || "0").slice(0, 3).padEnd(3, "0"))
  ).getTime();
}

/** HTTP 200 Firestore listen/write ko success mat gino jab quota error aa chuka ho. */
function reclassifyRecentFirestoreAsFailed(): void {
  const now = Date.now();
  let changed = false;
  rows = rows.map((r) => {
    if (isQuotaLogRow(r)) return r;
    if (r.feature !== "live-sync" && r.codePath !== "firebase/firestore") return r;
    const pending = Math.max(0, r.count - r.success - r.failed - (r.quota || 0));
    if (r.success <= 0 && pending <= 0) return r;
    const ts = rowStampMs(r);
    // Only ops still in flight or sent in the last QUOTA_FAIL_WINDOW_MS (~5 min); not the whole day.
    const recent = ts > 0 && now - ts <= QUOTA_FAIL_WINDOW_MS;
    if (!recent && pending <= 0) return r;
    changed = true;
    reclassifyOnlineTriggerRowOps(r.id);
    return {
      ...r,
      quota: Math.max(1, r.success + pending + (r.quota || 0)),
      success: 0,
    };
  });
  if (changed) {
    schedulePersist();
    emit();
  }
}

export function reportOnlineTriggerQuotaExceeded(message?: string): void {
  // Only real quota / billing texts start the global hold (not backoff / network noise).
  if (message == null || !isFirebaseQuotaLog(message)) return;
  noteQuotaExceeded();
}

let quotaNoteBusy = false;
let pbOnlyQuotaSignalLogged = false;
let quotaNoteLastAt = 0;
let quotaNoteTrailing: ReturnType<typeof setTimeout> | null = null;
const QUOTA_NOTE_THROTTLE_MS = 3000;

/** Throttled + re-entrancy safe entry for every quota signal (warn, SDK log, XHR, stream). */
function noteQuotaExceeded(): void {
  if (quotaNoteBusy) return;
  if (isPocketBaseOnlyAppSession()) {
    // PocketBase-only login: Firebase is not the data server. Log once, never hold / popup / admin notice.
    if (!pbOnlyQuotaSignalLogged) {
      pbOnlyQuotaSignalLogged = true;
      try {
        console.info("[quota] Firebase quota signal ignored: Pocket Ledger Server login session (no hold, no popup)");
      } catch {
        /* ignore */
      }
    }
    return;
  }
  const now = Date.now();
  const wait = quotaNoteLastAt + QUOTA_NOTE_THROTTLE_MS - now;
  if (wait > 0) {
    if (!quotaNoteTrailing) {
      quotaNoteTrailing = setTimeout(() => {
        quotaNoteTrailing = null;
        noteQuotaExceeded();
      }, wait);
    }
    return;
  }
  quotaNoteLastAt = now;
  quotaNoteBusy = true;
  try {
    noteQuotaExceededNow();
  } finally {
    quotaNoteBusy = false;
  }
}

function noteQuotaExceededNow(): void {
  if (isQuotaHoldActive()) {
    reclassifyRecentFirestoreAsFailed();
    return;
  }
  reclassifyRecentFirestoreAsFailed();
  // No separate marker row: quota only increments Qta exceeded on the affected op rows.
  // Global, persisted 30-min pause (serverQuotaHold.ts); it dispatches ONLINE_TRIGGER_QUOTA_HOLD_EVENT on end.
  startServerQuotaHold();
}

async function peekResponseText(res: Response, max = 8000, timeoutMs = 350): Promise<string> {
  try {
    const clone = res.clone();
    const reader = clone.body?.getReader();
    if (!reader) return (await clone.text()).slice(0, max);
    const decoder = new TextDecoder();
    let out = "";
    const deadline = Date.now() + timeoutMs;
    while (out.length < max && Date.now() < deadline) {
      const remain = Math.max(20, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) => {
          setTimeout(() => resolve({ done: true, value: undefined }), remain);
        }),
      ]);
      if (chunk.value) out += decoder.decode(chunk.value, { stream: true });
      if (chunk.done) break;
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    return out.slice(0, max);
  } catch {
    return "";
  }
}

async function responseLooksLikeQuota(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status === 402) return true;
  if (isQuotaMessage(res.statusText || "")) return true;
  const grpcStatus = String(res.headers.get("grpc-status") || "");
  const grpcMessage = String(res.headers.get("grpc-message") || "");
  if (grpcStatus === "8" || isQuotaMessage(grpcMessage)) return true;
  const t = await peekResponseText(res);
  return res.ok ? isStreamQuota(t) : isQuotaMessage(t);
}

function xhrLooksLikeQuota(xhr: XMLHttpRequest): boolean {
  if (xhr.status === 429 || xhr.status === 402) return true;
  try {
    const exposed = String(xhr.getAllResponseHeaders() || "").toLowerCase();
    const grpc = exposed.includes("grpc-status:") ? xhr.getResponseHeader("grpc-status") || "" : "";
    const grpcMsg = exposed.includes("grpc-message:") ? xhr.getResponseHeader("grpc-message") || "" : "";
    if (grpc === "8" || isQuotaMessage(grpcMsg)) return true;
  } catch {
    /* ignore */
  }
  try {
    const full = xhr.responseType === "" || xhr.responseType === "text" ? String(xhr.responseText || "") : "";
    const t = full.length > 16000 ? `${full.slice(0, 8000)} ${full.slice(-8000)}` : full;
    if (xhr.status >= 400 ? isQuotaMessage(t) : isStreamQuota(t)) return true;
  } catch {
    return false;
  }
  return false;
}

function argsText(args: unknown[]): string {
  return args
    .slice(0, 8)
    .map((a) => {
      if (a == null) return "";
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name} ${a.message}`;
      if (typeof a === "object") {
        const o = a as { code?: unknown; message?: unknown; status?: unknown };
        return `${String(o.code || "")} ${String(o.message || "")} ${String(o.status || "")}`;
      }
      return String(a);
    })
    .join(" ");
}

/**
 * Quota errors that never show on the HTTP status (WebChannel 200 + error later in the stream,
 * SDK backoff, outbox "row failed ... resource-exhausted") are only visible in log calls.
 * Observe them passively: console output is passed through unchanged (firebase.ts still hides
 * console.error quota spam exactly as before), we only count them.
 */
function installQuotaLogObservers(): void {
  try {
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      let quotaLine = false;
      try {
        quotaLine = isFirebaseQuotaLog(argsText(args).slice(0, 4000));
      } catch {
        quotaLine = false;
      }
      // Firestore resource-exhausted SDK logs (RestConnection/WebChannel BatchGetDocuments/Commit/RunQuery/Listen,
      // outbox quota rows): hidden from console like Storage quota; counted in Qta exceeded instead.
      const pbOnlyNow = isPocketBaseOnlyAppSession();
      if (!quotaLine || pbOnlyNow) prevWarn.apply(console, args as []);
      if (!quotaLine || pbOnlyNow) return;
      const quotaText = argsText(args).slice(0, 4000);
      void Promise.all([import("@/lib/quotaAdminNotice"), import("@/lib/plClientSession")])
        .then(([n, fb]) => n.notifyQuotaErrorForAdmin(quotaText, fb.auth?.currentUser?.email))
        .catch(() => undefined);
      if (quotaNoteBusy) return;
      try {
        noteQuotaExceeded();
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* ignore */
  }
  // Firebase SDK logger (independent of console filtering).
  void import("@/lib/pbCompat/app")
    .then((m) => {
      m.onLog(
        (entry) => {
          try {
            if (isFirebaseQuotaLog(`firebase ${entry.message} ${argsText(entry.args || [])}`)) noteQuotaExceeded();
          } catch {
            /* ignore */
          }
        },
        { level: "warn" }
      );
    })
    .catch(() => undefined);
}

/** Firestore WebChannel downlink (fetch streams): error frames arrive long after the 200 headers. */
function sniffFirestoreStreamForQuota(res: Response): void {
  let clone: Response;
  try {
    clone = res.clone();
  } catch {
    return;
  }
  const reader = clone.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let tail = "";
  const pump = (): void => {
    reader
      .read()
      .then(({ done, value }) => {
        if (value) {
          tail = (tail + decoder.decode(value, { stream: true })).slice(-4000);
          if (isStreamQuota(tail)) {
            noteQuotaExceeded();
            tail = "";
          }
        }
        if (done) return;
        pump();
      })
      .catch(() => undefined);
  };
  pump();
}

export function installOnlineTriggerLog(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  hydrate();
  // Hold persistence lives only in serverQuotaHold.ts: it is cleared on every page load (a refresh never continues a pause).
  window.addEventListener("storage", (e) => {
    if (e.key && e.key !== STORAGE_KEY) return;
    if (e.key === STORAGE_KEY && e.newValue == null) {
      rows = [];
      emit();
      return;
    }
    pullSharedLog();
  });
  window.addEventListener("focus", pullSharedLog);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pullSharedLog();
  });
  const ch = getLogChannel();
  if (ch) {
    ch.onmessage = (ev: MessageEvent) => {
      const incoming = (ev.data && (ev.data as { rows?: OnlineTriggerLogRow[] }).rows) || null;
      if (Array.isArray(incoming) && incoming.length > 0) {
        rows = mergeLogRows(rows, incoming);
        emit();
        return;
      }
      pullSharedLog();
    };
  }

  installQuotaLogObservers();
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const quotaUrlOk = isQuotaEligibleUrl(url);
    const classified = classifyUrl(url, method);
    const ops = classified ? countRequestOps(url, method, init?.body) : 0;
    const sentId = classified && ops > 0 ? recordOnlineTrigger({ ...classified, count: ops, success: 0, failed: 0 }) : null;
    const evs = startOps(sentId, url, method, init?.body, ops);
    const t0 = Date.now();
    try {
      const res = await origFetch(input, init);
      if (classified && /firestore\.googleapis\.com/i.test(url) && /\/channel/i.test(url)) {
        sniffFirestoreStreamForQuota(res);
      }
      const quotaHit = quotaUrlOk ? await responseLooksLikeQuota(res) : false;
      if (quotaHit) noteQuotaExceeded();
      const outcome = quotaHit ? "quota" : res.ok ? "received" : "failed";
      if (sentId) settleOnlineTrigger(sentId, outcome);
      if (evs && outcome !== "received") {
        // Real reason: short server body (bounded peek, failed requests only) + gRPC headers.
        void peekResponseText(res, 2000, 300).then((text) =>
          settleOnlineTriggerOps(evs, outcome, {
            status: res.status,
            ms: Date.now() - t0,
            text,
            grpcStatus: res.headers.get("grpc-status") || "",
            grpcMessage: res.headers.get("grpc-message") || "",
          })
        );
      } else {
        settleOnlineTriggerOps(evs, outcome, { status: res.status, ms: Date.now() - t0 });
      }
      return res;
    } catch (err) {
      // fetch rejects for network / abort / offline: never quota unless the error carries the strict code.
      const quotaErr = quotaUrlOk && isStreamQuota(String(err));
      if (quotaErr) noteQuotaExceeded();
      if (sentId) settleOnlineTrigger(sentId, quotaErr ? "quota" : "failed");
      settleOnlineTriggerOps(evs, quotaErr ? "quota" : "failed", {
        status: 0,
        errName: (err as { name?: string } | null)?.name || "",
        text: String((err as { message?: string } | null)?.message || err).slice(0, 200),
        offline: typeof navigator !== "undefined" && navigator.onLine === false,
      });
      throw err;
    }
  };

  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    (this as XMLHttpRequest & { __plOt?: { method: string; url: string } }).__plOt = {
      method: String(method || "GET"),
      url: String(url || ""),
    };
    return origOpen.call(this, method, url, async, username, password);
  };
  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = (this as XMLHttpRequest & { __plOt?: { method: string; url: string } }).__plOt;
    const url = meta?.url || "";
    const method = meta?.method || "GET";
    const quotaUrlOk = isQuotaEligibleUrl(url);
    const classified = meta ? classifyUrl(url, method) : null;
    const ops = classified ? countRequestOps(url, method, body) : 0;
    const sentId = classified && ops > 0 ? recordOnlineTrigger({ ...classified, count: ops, success: 0, failed: 0 }) : null;
    const evs = startOps(sentId, url, method, body, ops);
    const t0 = Date.now();
    let endKind = "";
    if (sentId) {
      this.addEventListener("timeout", () => (endKind = "TimeoutError"));
      this.addEventListener("abort", () => (endKind = "AbortError"));
      this.addEventListener("error", () => (endKind = endKind || "NetworkError"));
    }
    if (classified || isQuotaHoldTarget(url, method)) {
      let lastSniff = 0;
      const sniffQuota = () => {
        if ((this as XMLHttpRequest & { __plOtQuota?: boolean }).__plOtQuota) return;
        const t = Date.now();
        if (this.readyState !== 4 && t - lastSniff < 500) return;
        lastSniff = t;
        if (quotaUrlOk && xhrLooksLikeQuota(this)) {
          (this as XMLHttpRequest & { __plOtQuota?: boolean }).__plOtQuota = true;
          noteQuotaExceeded();
        }
      };
      this.addEventListener("progress", sniffQuota);
      this.addEventListener("readystatechange", sniffQuota);
      this.addEventListener("loadend", () => {
        const quotaHit =
          quotaUrlOk &&
          (Boolean((this as XMLHttpRequest & { __plOtQuota?: boolean }).__plOtQuota) ||
            xhrLooksLikeQuota(this));
        if (quotaHit) noteQuotaExceeded();
        if (sentId) {
          // loadend also fires on error / timeout / abort (status 0) -> Failed.
          const ok = this.status >= 200 && this.status < 400;
          const outcome = quotaHit ? "quota" : ok ? "received" : "failed";
          settleOnlineTrigger(sentId, outcome);
          let text = "";
          let grpcStatus = "";
          let grpcMessage = "";
          if (outcome !== "received") {
            try {
              if (this.responseType === "" || this.responseType === "text") text = String(this.responseText || "").slice(0, 2000);
            } catch {
              /* ignore */
            }
            try {
              // Only read grpc-* when CORS-exposed (getResponseHeader on a non-exposed header logs
              // "Refused to get unsafe header" in Chrome).
              const exposed = String(this.getAllResponseHeaders() || "").toLowerCase();
              if (exposed.includes("grpc-status:")) grpcStatus = this.getResponseHeader("grpc-status") || "";
              if (exposed.includes("grpc-message:")) grpcMessage = this.getResponseHeader("grpc-message") || "";
            } catch {
              /* ignore */
            }
          }
          settleOnlineTriggerOps(evs, outcome, {
            status: this.status,
            ms: Date.now() - t0,
            errName: endKind,
            text,
            grpcStatus,
            grpcMessage,
            offline: this.status === 0 && typeof navigator !== "undefined" && navigator.onLine === false,
          });
        }
      });
    }
    return origSend.call(this, body);
  };
}
