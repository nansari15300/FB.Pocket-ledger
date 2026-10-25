/**
 * Per-op detail events behind each online-trigger log row (popup in Settings > Log of online trigger).
 * Bounded everywhere: max OPS_PER_ROW per row, OPS_GLOBAL in total, OPS_PER_REQUEST described per
 * request, strings cut to OPS_STR_MAX, bodies > OPS_PARSE_MAX_BODY never parsed. Persisted on a
 * separate throttled key (OPS_PERSIST_MS). Not synced live across tabs (read from storage on open).
 */
export type OnlineTriggerOpOutcome = "pending" | "received" | "failed" | "quota";
export type OnlineTriggerOpEvent = {
  id: string;
  rowId: string;
  t: number;
  from: string;
  action: string;
  outcome: OnlineTriggerOpOutcome;
  reply: string;
  reason: string;
};
export type OnlineTriggerOpSettleDetail = {
  status?: number;
  ms?: number;
  /** Short (<= 2 KB) server reply body or error message, only for failed requests. */
  text?: string;
  /** Error kind tracked at the transport: TimeoutError | AbortError | NetworkError | TypeError ... */
  errName?: string;
  /** navigator.onLine === false when the failure happened. */
  offline?: boolean;
  grpcStatus?: string;
  grpcMessage?: string;
};

export const OPS_PER_ROW = 50;
export const OPS_GLOBAL = 2000;
export const OPS_PER_REQUEST = 10;
export const OPS_STR_MAX = 120;
const OPS_PARSE_MAX_BODY = 64 * 1024;
const OPS_PERSIST_MS = 5000;
const OPS_KEY = "pl_online_trigger_ops_v1";

const byRow = new Map<string, OnlineTriggerOpEvent[]>();
const trimmedByRow = new Map<string, number>();
let total = 0;
let seq = 0;
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function cut(v: unknown): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > OPS_STR_MAX ? s.slice(0, OPS_STR_MAX - 1) + "\u2026" : s;
}

function bumpTrim(rowId: string, n = 1): void {
  trimmedByRow.set(rowId, (trimmedByRow.get(rowId) || 0) + n);
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(OPS_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as { e?: OnlineTriggerOpEvent[]; tr?: [string, number][] };
    for (const ev of (parsed.e || []).slice(-OPS_GLOBAL)) {
      if (!ev || !ev.rowId || !ev.id) continue;
      const arr = byRow.get(ev.rowId) || [];
      arr.push(ev);
      byRow.set(ev.rowId, arr);
      total += 1;
    }
    for (const [k, n] of parsed.tr || []) trimmedByRow.set(k, n);
  } catch {
    /* ignore */
  }
}

function schedulePersist(): void {
  if (typeof localStorage === "undefined" || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const e: OnlineTriggerOpEvent[] = [];
      for (const arr of byRow.values()) for (const ev of arr) e.push(ev);
      const tr = [...trimmedByRow.entries()].slice(-500);
      localStorage.setItem(OPS_KEY, JSON.stringify({ e, tr }));
    } catch {
      /* quota */
    }
  }, OPS_PERSIST_MS);
}

/** Add one event per described op (bounded). Returns the event objects so settle can update them. */
export function addOnlineTriggerOps(rowId: string, from: string, actions: string[], opCount: number): OnlineTriggerOpEvent[] {
  hydrate();
  const now = Date.now();
  const list = actions.slice(0, OPS_PER_REQUEST);
  const extra = Math.max(0, opCount - list.length);
  if (list.length === 0) list.push("Request");
  if (extra > 0) list[list.length - 1] = `${list[list.length - 1]} (+${extra} more op${extra === 1 ? "" : "s"})`;
  const arr = byRow.get(rowId) || [];
  const created: OnlineTriggerOpEvent[] = [];
  for (const a of list) {
    const ev: OnlineTriggerOpEvent = {
      id: `${now.toString(36)}-${++seq}`,
      rowId,
      t: now,
      from: cut(from),
      action: cut(a),
      outcome: "pending",
      reply: "",
      reason: "",
    };
    arr.push(ev);
    created.push(ev);
    total += 1;
  }
  if (arr.length > OPS_PER_ROW) {
    const drop = arr.length - OPS_PER_ROW;
    arr.splice(0, drop);
    total -= drop;
    bumpTrim(rowId, drop);
  }
  byRow.set(rowId, arr);
  // Global cap: evict oldest events from the oldest rows (Map keeps insertion order).
  while (total > OPS_GLOBAL) {
    const k = byRow.keys().next().value as string | undefined;
    if (k == null) break;
    const a = byRow.get(k)!;
    const drop = Math.min(a.length, total - OPS_GLOBAL);
    a.splice(0, drop);
    total -= drop;
    bumpTrim(k, drop);
    if (a.length === 0) byRow.delete(k);
  }
  schedulePersist();
  return created;
}

const BILLING_RE = /billing|payment required|suspended|quota for bucket/i;
const QUOTA_RE = /resource[-_ ]?exhausted|quota exceeded|exceeded quota|storage\/quota-exceeded/i;
const GRPC_NAMES: Record<string, string> = {
  "1": "CANCELLED", "2": "UNKNOWN", "3": "INVALID_ARGUMENT", "4": "DEADLINE_EXCEEDED", "5": "NOT_FOUND",
  "6": "ALREADY_EXISTS", "7": "PERMISSION_DENIED", "8": "RESOURCE_EXHAUSTED", "9": "FAILED_PRECONDITION",
  "10": "ABORTED", "13": "INTERNAL", "14": "UNAVAILABLE", "16": "UNAUTHENTICATED",
};

/** Parse the server's own error ({error:{code,status,message}} / Storage / Firestore) from a short body. */
function serverError(text: string | undefined): { code: string; message: string } {
  const t = String(text || "").slice(0, 2000);
  if (!t.trim()) return { code: "", message: "" };
  try {
    let j = JSON.parse(t) as unknown;
    if (Array.isArray(j)) j = j[0];
    const e = (j as { error?: { code?: unknown; status?: unknown; message?: unknown } })?.error;
    if (e && typeof e === "object") {
      return { code: String(e.status || e.code || ""), message: String(e.message || "") };
    }
  } catch {
    /* not JSON */
  }
  return { code: "", message: t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) };
}

export function friendlyFailure(outcome: "failed" | "quota", d: OnlineTriggerOpSettleDetail): string {
  const st = d.status ?? 0;
  const se = serverError(d.text);
  const grpc = d.grpcStatus ? GRPC_NAMES[d.grpcStatus] || `gRPC ${d.grpcStatus}` : "";
  const hay = `${se.code} ${se.message} ${grpc} ${d.grpcMessage || ""} ${d.text || ""}`;
  let label: string;
  if (st === 0 && d.offline) label = "Offline";
  else if (st === 0 && /timeout/i.test(d.errName || "")) label = "Timeout";
  else if (st === 0 && /abort/i.test(d.errName || "")) label = "Cancelled";
  else if (/storage\/quota-exceeded|quota for bucket/i.test(hay)) label = "Storage quota exceeded";
  else if (st === 402 || BILLING_RE.test(hay)) label = "Billing issue";
  else if (d.grpcStatus === "8" || /resource[-_ ]?exhausted/i.test(hay))
    label = "Firestore quota exceeded (resource-exhausted)";
  else if (st === 429 || QUOTA_RE.test(hay)) label = "Quota exceeded";
  else if (outcome === "quota") label = "Quota exceeded";
  else if (st === 0 && /network|typeerror|failed to fetch/i.test(`${d.errName || ""} ${d.text || ""}`)) label = "Network error";
  else if (st === 401 || st === 403 || /PERMISSION_DENIED|UNAUTHENTICATED/i.test(hay)) label = "Permission denied";
  else if (st === 404 || /NOT_FOUND/i.test(hay)) label = "Not found";
  else if (st === 400) label = "Bad request";
  else if (st >= 500 || /UNAVAILABLE|INTERNAL/i.test(hay)) label = "Server error";
  else if (/DEADLINE_EXCEEDED/i.test(hay)) label = "Timeout";
  else label = "Unknown";
  const raw = [
    st ? `HTTP ${st}` : "no HTTP status",
    d.errName || "",
    grpc,
    se.code && se.code !== String(st) ? se.code : "",
    se.message ? `"${se.message.slice(0, 60)}"` : d.grpcMessage ? `"${d.grpcMessage.slice(0, 60)}"` : "",
  ].filter(Boolean);
  return cut(`${label} (${raw.join(" \u00b7 ")})`);
}

export function settleOnlineTriggerOps(
  evs: OnlineTriggerOpEvent[] | null | undefined,
  outcome: "received" | "failed" | "quota",
  d: OnlineTriggerOpSettleDetail
): void {
  if (!evs || evs.length === 0) return;
  const ms = d.ms != null ? `, ${Math.round(d.ms)} ms` : "";
  const reply = outcome === "received" ? cut(`Server replied successfully (HTTP ${d.status ?? 200}${ms})`) : "";
  const reason = outcome === "received" ? "" : friendlyFailure(outcome, d);
  for (const ev of evs) {
    if (ev.outcome !== "pending") continue;
    ev.outcome = outcome;
    ev.reply = reply;
    ev.reason = reason;
  }
  schedulePersist();
}

/** Quota detected later (stream / log): move this row's received + pending events to quota. */
export function reclassifyOnlineTriggerRowOps(rowId: string): void {
  const arr = byRow.get(rowId);
  if (!arr) return;
  let changed = false;
  for (const ev of arr) {
    if (ev.outcome !== "received" && ev.outcome !== "pending") continue;
    ev.outcome = "quota";
    ev.reason = "Firestore quota exceeded (resource-exhausted) - reported by server after the reply";
    changed = true;
  }
  if (changed) schedulePersist();
}

export function clearOnlineTriggerOps(): void {
  byRow.clear();
  trimmedByRow.clear();
  total = 0;
  try {
    localStorage.removeItem(OPS_KEY);
  } catch {
    /* ignore */
  }
}

/** Read events for the given raw row ids (newest first). Called only when the popup opens. */
export function getOnlineTriggerOps(
  rowIds: readonly string[],
  outcome: OnlineTriggerOpOutcome | "all"
): { events: OnlineTriggerOpEvent[]; trimmed: number } {
  hydrate();
  const ids = new Set(rowIds);
  const seen = new Set<string>();
  const events: OnlineTriggerOpEvent[] = [];
  let trimmed = 0;
  for (const id of ids) {
    trimmed += trimmedByRow.get(id) || 0;
    for (const ev of byRow.get(id) || []) {
      seen.add(ev.id);
      if (outcome === "all" || ev.outcome === outcome) events.push(ev);
    }
  }
  // Other tabs' events (not synced live): one bounded read from storage.
  try {
    const raw = localStorage.getItem(OPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { e?: OnlineTriggerOpEvent[] };
      for (const ev of parsed.e || []) {
        if (!ev || seen.has(ev.id) || !ids.has(ev.rowId)) continue;
        if (outcome === "all" || ev.outcome === outcome) events.push(ev);
      }
    }
  } catch {
    /* ignore */
  }
  events.sort((a, b) => b.t - a.t || b.id.localeCompare(a.id));
  return { events, trimmed };
}

// ---- Action descriptions (bounded parsing only) ----

function docInfo(name: unknown): { coll: string; id: string } {
  const s = String(name || "");
  const i = s.indexOf("/documents/");
  const segs = (i >= 0 ? s.slice(i + 11) : s).split("/").filter(Boolean);
  if (segs.length === 0) return { coll: "documents", id: "" };
  if (segs.length % 2 === 1) return { coll: segs[segs.length - 1]!, id: "" };
  return { coll: segs[segs.length - 2]!, id: segs[segs.length - 1]! };
}

function shortId(id: string): string {
  return id.length > 14 ? id.slice(0, 12) + "\u2026" : id;
}

function writeAction(w: Record<string, unknown>, voucherType: string): string {
  const vt = voucherType && voucherType !== "-" ? voucherType : "";
  if (w.delete) {
    const d = docInfo(w.delete);
    return `Deleted ${d.coll} ${shortId(d.id)}`.trim();
  }
  const upd = w.update as { name?: string } | undefined;
  if (upd) {
    const d = docInfo(upd.name);
    const verb = w.updateMask ? "Edited" : "Saved";
    if (d.coll === "vouchers" && vt) return `User ${verb.toLowerCase()} a ${vt} voucher ${shortId(d.id)}`.trim();
    return `${verb} ${d.coll} ${shortId(d.id)}`.trim();
  }
  const tr = w.transform as { document?: string } | undefined;
  if (tr) {
    const d = docInfo(tr.document);
    return `Updated fields ${d.coll} ${shortId(d.id)}`.trim();
  }
  return "Write";
}

function listenAction(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = m.addTarget as Record<string, unknown> | undefined;
  if (add) {
    const q = add.query as { parent?: string; structuredQuery?: { from?: { collectionId?: string }[] } } | undefined;
    const docs = (add.documents as { documents?: string[] } | undefined)?.documents;
    if (q?.structuredQuery?.from?.[0]?.collectionId) out.push(`Listen: ${q.structuredQuery.from[0].collectionId}`);
    else if (docs && docs.length) {
      const d = docInfo(docs[0]);
      out.push(`Listen: ${d.coll} ${shortId(d.id)}`.trim());
    } else out.push("Listen: query");
  }
  if (m.removeTarget != null) out.push(`Stop listening (target ${String(m.removeTarget)})`);
  if (Array.isArray(m.writes)) return out;
  return out;
}

function storageAction(url: string, method: string): string {
  const m = /\/o\/([^?]+)/.exec(url);
  let path = "";
  try {
    path = m ? decodeURIComponent(m[1]!) : "";
  } catch {
    path = m ? m[1]! : "";
  }
  const base = path.split("/").pop() || path;
  const M = method.toUpperCase();
  if (M === "DELETE") return `Delete file ${base}`.trim();
  if (M === "POST" || M === "PUT" || M === "PATCH") return `Upload file ${base}`.trim();
  if (/alt=media/i.test(url)) return `Download file ${base}`.trim();
  if (/[?&]prefix=/i.test(url)) return "List folder";
  return `Get file URL ${base}`.trim();
}

/** Human readable actions for one request (<= OPS_PER_REQUEST). Small bodies only. */
export function describeOnlineTriggerRequest(url: string, method: string, bodyText: string | null, voucherType: string): string[] {
  const u = String(url || "");
  if (/firebasestorage|storage\.googleapis/i.test(u)) return [storageAction(u, method)];
  if (!/firestore\.googleapis\.com/i.test(u)) return [`${method.toUpperCase()} request`];
  if (bodyText == null) return ["Firestore request"];
  if (bodyText.length > OPS_PARSE_MAX_BODY) return ["Firestore request (large body not inspected)"];
  const out: string[] = [];
  try {
    if (/\/channel/i.test(u)) {
      const params = new URLSearchParams(bodyText);
      params.forEach((v, k) => {
        if (out.length >= OPS_PER_REQUEST || !/^req\d+___data__$/.test(k)) return;
        try {
          const msg = JSON.parse(v) as Record<string, unknown>;
          out.push(...listenAction(msg));
          if (Array.isArray(msg.writes)) for (const w of msg.writes) out.push(writeAction(w as Record<string, unknown>, voucherType));
        } catch {
          /* ignore */
        }
      });
      return out.slice(0, OPS_PER_REQUEST);
    }
    const j = JSON.parse(bodyText || "{}") as Record<string, unknown>;
    if (Array.isArray(j.writes)) for (const w of j.writes.slice(0, OPS_PER_REQUEST)) out.push(writeAction(w as Record<string, unknown>, voucherType));
    else if (Array.isArray(j.documents))
      for (const d of j.documents.slice(0, OPS_PER_REQUEST)) {
        const x = docInfo(d);
        out.push(`Read ${x.coll} ${shortId(x.id)}`.trim());
      }
    else if (j.structuredQuery) {
      const sq = j.structuredQuery as { from?: { collectionId?: string }[] };
      out.push(`Query ${sq.from?.[0]?.collectionId || "collection"}`);
    }
  } catch {
    /* ignore */
  }
  if (out.length === 0) {
    const d = docInfo(u.split("?")[0]);
    out.push(`${method.toUpperCase() === "GET" ? "Read" : method.toUpperCase()} ${d.coll} ${shortId(d.id)}`.trim());
  }
  return out.slice(0, OPS_PER_REQUEST);
}