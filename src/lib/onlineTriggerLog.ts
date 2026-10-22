"use client";

export const ONLINE_TRIGGER_LOG_EVENT = "pl-online-trigger-log";
export const ONLINE_TRIGGER_LOG_PAGE_SIZE = 25;

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
};

export type OnlineTriggerScope = {
  feature?: string;
  codePath?: string;
  voucherType?: string;
  header?: string;
  sentFrom?: string;
};

const STORAGE_KEY = "pl_online_trigger_log_v1";
const MAX_ROWS = 800;
const PERSIST_MAX = 500;

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
    if (m === "DELETE") return { api: "delete", feature: "storage", codePath: "firebase/storage" };
    if (m === "POST" || m === "PUT" || m === "PATCH") {
      return { api: "upload", feature: "storage", codePath: "firebase/storage" };
    }
    if (isList && m === "GET") return { api: "list", feature: "storage", codePath: "firebase/storage" };
    if (/alt=media/i.test(u)) return { api: "download", feature: "storage", codePath: "firebase/storage" };
    return { api: "getURL", feature: "storage", codePath: "firebase/storage" };
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

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ONLINE_TRIGGER_LOG_EVENT));
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

function mergeLogRows(a: OnlineTriggerLogRow[], b: OnlineTriggerLogRow[]): OnlineTriggerLogRow[] {
  const map = new Map<string, OnlineTriggerLogRow>();
  for (const r of a) map.set(r.id, r);
  for (const r of b) map.set(r.id, r);
  const merged = [...map.values()];
  merged.sort((x, y) => {
    const dx = `${x.date} ${x.time}`;
    const dy = `${y.date} ${y.time}`;
    return dx < dy ? -1 : dx > dy ? 1 : 0;
  });
  return merged.length > MAX_ROWS ? merged.slice(-MAX_ROWS) : merged;
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
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const merged = mergeLogRows(readLocalLog(), rows).slice(-PERSIST_MAX);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      rows = merged;
    } catch {
      /* quota */
    }
  }, 400);
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
  success: number;
  failed: number;
  count?: number;
}): void {
  const scope = mergedScope();
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const sentFrom = dash(scope.sentFrom || sentFromFromPath(path));
  const voucherType = dash(scope.voucherType || voucherTypeFromDom());
  let header = dash(scope.header);
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
    feature: dash(scope.feature || partial.feature),
    codePath: dash(scope.codePath || partial.codePath),
    count: Math.max(1, Number(partial.count) || 1),
    success: Math.max(0, Number(partial.success) || 0),
    failed: Math.max(0, Number(partial.failed) || 0),
  };
  rows.push(row);
  if (rows.length > MAX_ROWS) rows = rows.slice(-MAX_ROWS);
  schedulePersist();
  emit();
}

export function listOnlineTriggerLog(): OnlineTriggerLogRow[] {
  return rows.slice();
}

export function clearOnlineTriggerLog(): void {
  rows = [];
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
  emit();
}

export const ONLINE_TRIGGER_LOG_HEADERS = [
  "Date",
  "Time",
  "API",
  "Sent from",
  "Voucher type",
  "Header",
  "Feature",
  "Code path",
  "Count",
  "Success",
  "Failed",
] as const;

export type OnlineTriggerLogView = "monthly" | "weekly" | "daily" | "details";

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

function isoWeekMeta(dateStr: string): { key: string; label: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return { key: dateStr, label: dateStr };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
  const thu = new Date(start);
  thu.setDate(start.getDate() + 3);
  const weekYear = thu.getFullYear();
  const jan4 = new Date(weekYear, 0, 4);
  const jan4Mon = new Date(jan4);
  jan4Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const week = 1 + Math.round((start.getTime() - jan4Mon.getTime()) / 604800000);
  return {
    key: `${weekYear}-W${String(week).padStart(2, "0")}`,
    label: `${fmt(start)} → ${fmt(end)}`,
  };
}

function collapseGroup(arr: OnlineTriggerLogRow[], id: string, dateLabel: string, timeLabel: string): OnlineTriggerLogRow {
  const sorted = arr.slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const first = sorted[0]!;
  return {
    id,
    date: dateLabel,
    time: timeLabel,
    api: mixedField(sorted.map((x) => x.api)),
    sentFrom: first.sentFrom,
    voucherType: first.voucherType,
    header: mixedField(sorted.map((x) => x.header)),
    feature: mixedField(sorted.map((x) => x.feature)),
    codePath: mixedField(sorted.map((x) => x.codePath)),
    count: sorted.reduce((s, x) => s + x.count, 0),
    success: sorted.reduce((s, x) => s + x.success, 0),
    failed: sorted.reduce((s, x) => s + x.failed, 0),
  };
}

/** Collapse by page (Sent from) + voucher type inside a date bucket. */
export function groupOnlineTriggerLog(
  list: OnlineTriggerLogRow[],
  view: OnlineTriggerLogView
): OnlineTriggerLogRow[] {
  if (view === "details") return list;
  const buckets = new Map<string, OnlineTriggerLogRow[]>();
  for (const r of list) {
    let period = r.date;
    if (view === "monthly") period = String(r.date || "").slice(0, 7);
    if (view === "weekly") period = isoWeekMeta(r.date).key;
    const key = `${period}|${r.sentFrom}|${r.voucherType}`;
    const arr = buckets.get(key) || [];
    arr.push(r);
    buckets.set(key, arr);
  }
  const out: OnlineTriggerLogRow[] = [];
  for (const [key, arr] of buckets) {
    const sorted = arr.slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    let dateLabel = first.date;
    let timeLabel = first.time === last.time ? first.time : `${first.time} → ${last.time}`;
    if (view === "monthly") {
      dateLabel = String(first.date || "").slice(0, 7);
      timeLabel = "—";
    } else if (view === "weekly") {
      dateLabel = isoWeekMeta(first.date).label;
      timeLabel = "—";
    } else if (view === "daily") {
      dateLabel = first.date;
    }
    out.push(collapseGroup(sorted, `grp-${key}`, dateLabel, timeLabel));
  }
  out.sort((a, b) => `${b.date} ${b.time} ${b.sentFrom}`.localeCompare(`${a.date} ${a.time} ${a.sentFrom}`));
  return out;
}

export function formatOnlineTriggerRowTsv(row: OnlineTriggerLogRow, _view: OnlineTriggerLogView = "details"): string {
  return [
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
  ].join("\t");
}

export function formatOnlineTriggerLogTsv(list: OnlineTriggerLogRow[], view: OnlineTriggerLogView = "details"): string {
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

export function installOnlineTriggerLog(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  hydrate();
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    if (e.newValue == null) {
      rows = [];
      emit();
      return;
    }
    rows = mergeLogRows(rows, parseStored(e.newValue));
    emit();
  });

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const classified = classifyUrl(url, method);
    if (!classified) return origFetch(input, init);
    try {
      const res = await origFetch(input, init);
      recordOnlineTrigger({
        ...classified,
        success: res.ok ? 1 : 0,
        failed: res.ok ? 0 : 1,
      });
      return res;
    } catch (err) {
      recordOnlineTrigger({ ...classified, success: 0, failed: 1 });
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
    const classified = meta ? classifyUrl(meta.url, meta.method) : null;
    if (classified) {
      this.addEventListener("loadend", () => {
        const ok = this.status >= 200 && this.status < 400;
        recordOnlineTrigger({
          ...classified,
          success: ok ? 1 : 0,
          failed: ok ? 0 : 1,
        });
      });
    }
    return origSend.call(this, body);
  };
}
