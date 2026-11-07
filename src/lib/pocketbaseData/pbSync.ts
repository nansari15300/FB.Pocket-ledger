"use client";

/**
 * Pocket Ledger Server (PocketBase) company data sync.
 *
 * Write path: writeEntity -> SQLite + sync_outbox (same as Firebase companies) ->
 *   flushVoucherOutbox -> `pushOutboxRowToPocketBase` (this file).
 * Direct mutation wrappers (setDoc/updateDoc/deleteDoc/addDoc on `companies/{id}/...`)
 *   -> `pbWriteAppDoc` for PocketBase companies.
 * Read path: `pullPocketBaseCompanyToLocal` -> SQLite mirror (`company_docs`), driven by the
 *   server change log (`pl_change_log`). Idle poll / live apply: selected company only.
 *
 * Rows: one per app document, key = (company, app_id[, kind | coll]); the full document is
 * in `data` (timestamps encoded as `{__fsTs, seconds, nanoseconds}` like the outbox).
 * Deletes are soft (`deleted: true`, data = tombstone) so other devices see them.
 */

import { Timestamp } from "@/lib/pbCompat/firestore";
import {
  getValidPocketBaseAuth,
  pbCreate,
  pbFirst,
  pbListAll,
  pbQuote,
  pbRequest,
  PocketBaseRequestError,
} from "@/lib/pocketbaseData/pbClient";
import {
  anyDateToMs,
  appCollectionForPbRecord,
  pbTargetForAppCollection,
  PB_DATA_COLLECTIONS,
  PB_GROUP_KINDS,
} from "@/lib/pocketbaseData/pbMapping";
import {
  clearPocketBaseCompanyPruned,
  isActivePocketBaseCompanyId,
  listActivePocketBaseCompanyIds,
  listPocketBaseCompanyIds,
} from "@/lib/pocketbaseData/pbCompanyRegistry";
import { clearPbOutboxCompanyBlock, isPocketBaseCompanyMissingError } from "@/lib/pocketbaseData/pbOutboxBlock";
import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";
import { resetPbDataPullProgress, setPbDataPullProgress } from "@/lib/pocketbaseData/pbSyncProgress";

type PbRecord = Record<string, unknown> & { id: string };

const PB_HARD_DELETED = "_pbHardDeleted";
const COMPANY_REC_KEY = "pl_pb_company_records_v1";
const CURSOR_KEY_PREFIX = "pl_pb_pull_cursor_v1:";

/* ------------------------------------------------------------------ */
/* value encoding                                                      */
/* ------------------------------------------------------------------ */

function isFieldValueSentinel(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const m = (v as { _methodName?: unknown })._methodName;
  return typeof m === "string" ? m : null;
}

/** Server-side field operation (Firestore FieldValue equivalent, applied in the server transaction). */
export type PbFieldOp = { path: string; op: "inc" | "union" | "remove" | "delete" | "serverTime"; value?: unknown };

/**
 * Operand of a Firestore FieldValue. Its property names are minified in the SDK build,
 * so scan own properties (also works for FieldValues revived from outbox JSON).
 */
function fieldValueOperand(v: object, want: "number" | "array"): unknown {
  for (const k of Object.keys(v)) {
    if (k === "_methodName") continue;
    const x = (v as Record<string, unknown>)[k];
    if (want === "number" ? typeof x === "number" && Number.isFinite(x) : Array.isArray(x)) return x;
  }
  return undefined;
}

function clientTimestampValue(): Record<string, unknown> {
  const now = Date.now();
  return { __fsTs: true, seconds: Math.floor(now / 1000), nanoseconds: (now % 1000) * 1e6 };
}

/**
 * App value -> JSON-safe value for the server (`undefined` = drop the key).
 * `path` + `ops`: FieldValues at a representable path become server field ops;
 * without them (array elements, keys with dots) serverTimestamp = client time, others dropped.
 */
function encodeValue(v: unknown, path?: string | null, ops?: PbFieldOp[] | null, setMode?: boolean): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "function") return undefined;
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? { __fsTs: true, seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 } : null;
  }
  if (typeof v !== "object") return v;
  const sentinel = isFieldValueSentinel(v);
  if (sentinel) {
    const canOp = !!ops && !!path;
    if (/serverTimestamp/i.test(sentinel)) {
      if (canOp) {
        ops!.push({ path: path!, op: "serverTime" });
        return undefined;
      }
      return clientTimestampValue();
    }
    if (/deleteField/i.test(sentinel)) {
      if (canOp && !setMode) ops!.push({ path: path!, op: "delete" });
      return undefined;
    }
    if (canOp && /increment/i.test(sentinel)) {
      const by = fieldValueOperand(v, "number");
      if (typeof by === "number") {
        ops!.push({ path: path!, op: "inc", value: by });
        return undefined;
      }
    }
    if (canOp && /arrayUnion|arrayRemove/i.test(sentinel)) {
      const els = fieldValueOperand(v, "array");
      if (Array.isArray(els)) {
        ops!.push({ path: path!, op: /arrayUnion/i.test(sentinel) ? "union" : "remove", value: encodeValue(els) });
        return undefined;
      }
    }
    console.warn("[pbSync] unsupported Firestore FieldValue dropped:", sentinel);
    return undefined;
  }
  if (typeof Blob !== "undefined" && v instanceof Blob) return undefined;
  const ts = v as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  if (typeof ts.toDate === "function" && typeof ts.seconds === "number") {
    return { __fsTs: true, seconds: ts.seconds, nanoseconds: Number(ts.nanoseconds) || 0 };
  }
  if (Array.isArray(v)) return v.map((x) => encodeValue(x)).filter((x) => x !== undefined);
  // Firestore refs (DocumentReference) -> path string
  const ref = v as { path?: unknown; firestore?: unknown };
  if (typeof ref.path === "string" && ref.firestore) return ref.path;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const childPath = path && ops && k && !k.includes(".") ? `${path}.${k}` : null;
    const e = encodeValue(val, childPath, ops, setMode);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

export function encodeDocForPocketBase(data: Record<string, unknown>): Record<string, unknown> {
  return (encodeValue(data) as Record<string, unknown>) || {};
}

/**
 * Encode a write for the server: plain data + field ops (increment, arrayUnion/Remove,
 * deleteField, serverTimestamp). `update` keys are dotted paths (Firestore updateDoc).
 */
export function encodeWriteForPocketBase(
  data: Record<string, unknown> | null | undefined,
  mode: PbWriteMode
): { data: Record<string, unknown>; fieldOps: PbFieldOp[] } {
  const fieldOps: PbFieldOp[] = [];
  const out: Record<string, unknown> = {};
  const setMode = mode === "set";
  for (const [k, val] of Object.entries(data || {})) {
    const pathOk = !!k && (mode === "update" ? /^[^.]+(\.[^.]+)*$/.test(k) : !k.includes("."));
    const e = encodeValue(val, pathOk ? k : null, pathOk ? fieldOps : null, setMode);
    if (e !== undefined) out[k] = e;
  }
  return { data: out, fieldOps };
}

/** Server JSON -> app values (Timestamps revived). */
export function decodeDocFromPocketBase(data: unknown): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as { __fsTs?: unknown; seconds?: unknown; nanoseconds?: unknown };
      if (o.__fsTs === true && typeof o.seconds === "number") {
        return new Timestamp(o.seconds, Math.max(0, Math.min(999_999_999, Number(o.nanoseconds) || 0)));
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  const r = walk(data);
  return r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
}

const CLOCK_SKEW_KEY = "pl_pb_clock_skew_v1";
let clockSkewMs: number | null = null;

/** server clock - device clock (ms), learned from server replies; 0 until known. */
export function pbClockSkewMs(): number {
  if (clockSkewMs !== null) return clockSkewMs;
  clockSkewMs = 0;
  if (typeof window !== "undefined") {
    try {
      const v = Number(window.localStorage.getItem(CLOCK_SKEW_KEY));
      if (Number.isFinite(v) && Math.abs(v) < 366 * 86_400_000) clockSkewMs = Math.trunc(v);
    } catch {
      /* ignore */
    }
  }
  return clockSkewMs;
}

/** Remember the server clock from a reply (`serverNow`), measured around the request. */
function noteServerNow(serverNow: unknown, sentAt: number): void {
  const sn = Number(serverNow);
  if (!Number.isFinite(sn) || sn <= 0) return;
  const now = Date.now();
  if (now - sentAt > 10_000) return; // slow reply: estimate too rough
  const skew = Math.trunc(sn - (sentAt + now) / 2);
  const prev = pbClockSkewMs();
  if (Math.abs(skew - prev) < 1000) return; // ignore network jitter
  clockSkewMs = skew;
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(CLOCK_SKEW_KEY, String(skew));
  } catch {
    /* ignore */
  }
}

/** Device time -> server time (edit times sent as `at`, so conflict checks use one clock). */
export function pbServerTime(deviceMs: number = Date.now()): number {
  return Math.trunc(deviceMs + pbClockSkewMs());
}

export function pbDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const k = "pl_pb_device_id_v1";
    let id = window.localStorage.getItem(k) || "";
    if (!id) {
      id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `d_${Date.now()}`;
      window.localStorage.setItem(k, id);
    }
    return id.slice(0, 100);
  } catch {
    return "";
  }
}

/** Relation field from a realtime/API record (`"xyz"` or `{ id: "xyz" }`). */
export function pocketBaseCompanyRecId(rec: Record<string, unknown> | null | undefined): string {
  const c = rec?.company;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (c && typeof c === "object") {
    const id = (c as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* company                                                             */
/* ------------------------------------------------------------------ */

function readCompanyRecMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COMPANY_REC_KEY);
    const o = raw ? (JSON.parse(raw) as unknown) : {};
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberCompanyRec(appCompanyId: string, recId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const m = readCompanyRecMap();
    const key = `${getValidPocketBaseAuth()?.url || ""}|${appCompanyId}`;
    if (recId) m[key] = recId;
    else delete m[key];
    window.localStorage.setItem(COMPANY_REC_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/**
 * App company id for a server company record id (from the local cache only, no request).
 * `someUnmapped`: a candidate company has no cached record id yet (used by the live feed).
 */
export function appCompanyIdForPocketBaseRecord(
  recId: string,
  candidates: string[]
): { appCompanyId: string | null; someUnmapped: boolean } {
  const m = readCompanyRecMap();
  const url = getValidPocketBaseAuth()?.url || "";
  let someUnmapped = false;
  for (const id of candidates) {
    const rec = m[`${url}|${id}`];
    if (rec === recId) return { appCompanyId: id, someUnmapped: false };
    if (!rec) someUnmapped = true;
  }
  return { appCompanyId: null, someUnmapped };
}

export type PocketBaseCompanyInfo = {
  name?: string;
  pan?: string;
  country?: string;
  currencyCode?: string;
  fiscalYearStartMs?: number;
  fiscalYearEndMs?: number;
  planId?: string;
};

/** Company name/PAN/etc. from the local registry row (used when the first push creates the server company). */
async function companyInfoFromLocalRegistry(appCompanyId: string): Promise<PocketBaseCompanyInfo> {
  try {
    const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
    const row = (await getLocalCompanyById(appCompanyId, { includeDeleted: true })) as Record<string, unknown> | null;
    if (!row) return {};
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    return {
      name: str(row.name),
      pan: str(row.pan),
      country: str(row.country),
      currencyCode: str(row.currencyCode),
      fiscalYearStartMs: anyDateToMs(row.fiscalYearStart),
      fiscalYearEndMs: anyDateToMs(row.fiscalYearEnd),
      planId: str(row.planId),
    };
  } catch {
    return {};
  }
}

/**
 * Server record id of the company (`pl_companies.app_id` = app company id).
 * Creates it (owner = signed-in user) when `createIfMissing` and it does not exist.
 */
export async function ensurePocketBaseCompany(
  appCompanyId: string,
  opts?: { createIfMissing?: boolean; info?: PocketBaseCompanyInfo }
): Promise<string> {
  const auth = getValidPocketBaseAuth();
  const key = `${auth?.url || ""}|${appCompanyId}`;
  const cached = readCompanyRecMap()[key];
  if (cached) return cached;
  const found = await pbFirst<PbRecord>("pl_companies", `app_id = ${pbQuote(appCompanyId)}`);
  if (found?.id) {
    rememberCompanyRec(appCompanyId, found.id);
    clearPocketBaseCompanyPruned(appCompanyId);
    clearPbOutboxCompanyBlock(appCompanyId);
    return found.id;
  }
  if (!opts?.createIfMissing || !auth) {
    throw new PocketBaseRequestError(
      "Pocket Ledger Server: this company is not on the server, or you are not a member of it",
      404
    );
  }
  const i = opts.info || {};
  const body: Record<string, unknown> = {
    app_id: appCompanyId,
    name: String(i.name || "").slice(0, 300),
    owner: auth.userId,
    owner_email: auth.email,
    updatedAtMs: Date.now(),
  };
  if (i.pan) body.pan = String(i.pan).slice(0, 50);
  if (i.country) body.country = String(i.country).slice(0, 50);
  if (i.currencyCode) body.currency_code = String(i.currencyCode).slice(0, 10);
  if (Number.isFinite(i.fiscalYearStartMs)) body.fy_start_ms = Math.trunc(i.fiscalYearStartMs as number);
  if (Number.isFinite(i.fiscalYearEndMs)) body.fy_end_ms = Math.trunc(i.fiscalYearEndMs as number);
  if (i.planId) body.plan_id = String(i.planId).slice(0, 100);
  try {
    const rec = await pbCreate<PbRecord>("pl_companies", body);
    rememberCompanyRec(appCompanyId, rec.id);
    clearPocketBaseCompanyPruned(appCompanyId);
    clearPbOutboxCompanyBlock(appCompanyId);
    return rec.id;
  } catch (e) {
    if (e instanceof PocketBaseRequestError && e.status === 400) {
      throw new PocketBaseRequestError(
        "Pocket Ledger Server: company id already exists on the server and you are not a member of it",
        403,
        e.data
      );
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* company root doc (`companies/{id}`) + members                       */
/* ------------------------------------------------------------------ */
// Dual write: Firestore stays the source of the root doc (company list, gate, Firebase tools);
// the server copy (pl_companies.data + pl_company_members) is written after it and read first.
// A failed server write marks the root "dirty": reads fall back to Firestore and the next pull
// pushes the Firestore copy again.

const ROOT_DIRTY_KEY = "pl_pb_company_root_dirty_v1";
/** Root doc (pl_companies list) cache. 30s: realtime / change-log pulls delete the entry on any remote root change. */
const ROOT_CACHE_MS = 30_000;
const rootCache = new Map<string, { at: number; value: { exists: boolean; data: Record<string, unknown> | null } }>();

function readRootDirty(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(ROOT_DIRTY_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export function setPocketBaseCompanyRootDirty(companyId: string, dirty: boolean): void {
  if (typeof window === "undefined" || !companyId) return;
  const s = readRootDirty();
  if (dirty === s.has(companyId)) return;
  if (dirty) s.add(companyId);
  else s.delete(companyId);
  rootCache.delete(companyId);
  try {
    window.localStorage.setItem(ROOT_DIRTY_KEY, JSON.stringify(Array.from(s)));
  } catch {
    /* ignore */
  }
}

export function isPocketBaseCompanyRootDirty(companyId: string): boolean {
  return readRootDirty().has(companyId);
}

function emitRootUpdated(companyId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("pl-pb-company-root-updated", { detail: { companyId } }));
  } catch {
    /* ignore */
  }
}

/** Simple company fields -> local registry row (company list, header, members). */
async function mirrorRootToRegistry(companyId: string, doc: Record<string, unknown>): Promise<void> {
  try {
    const { getLocalCompanyById, upsertLocalCompany } = await import("@/lib/localCompanyStore");
    const row = (await getLocalCompanyById(companyId, { includeDeleted: true })) as Record<string, unknown> | null;
    if (!row) return;
    const keys = ["name", "address", "phone", "email", "pan", "hasPassword", "sharedWith", "sharedWithEmails", "sharedWithEmailsLower"];
    const patch: Record<string, unknown> = {};
    for (const k of keys) {
      if (doc[k] === undefined) continue;
      let v = doc[k];
      if (k === "sharedWith" && Array.isArray(v)) {
        // the server copy has no member passwords: keep the ones this device already has
        const pw = new Map<string, unknown>();
        for (const m of Array.isArray(row.sharedWith) ? (row.sharedWith as Record<string, unknown>[]) : []) {
          if (m && typeof m === "object" && m.password) pw.set(String(m.email || "").toLowerCase(), m.password);
        }
        v = (v as Record<string, unknown>[]).map((m) => {
          const p = m && typeof m === "object" ? pw.get(String(m.email || "").toLowerCase()) : undefined;
          return p !== undefined ? { ...m, password: p } : m;
        });
      }
      if (JSON.stringify(v) !== JSON.stringify(row[k])) patch[k] = v;
    }
    if (!Object.keys(patch).length) return;
    await (upsertLocalCompany as (r: Record<string, unknown>) => Promise<unknown>)({ ...row, ...patch, id: companyId });
  } catch {
    /* registry refresh is best effort */
  }
}

/**
 * Write the company root doc to the server (after the Firestore write succeeded).
 * mode: set | merge | update (dotted paths). Member lists are reconciled server side
 * (owner / SuperAdmin / CompanyAdmin only). Company / member passwords in the payload are
 * turned into bcrypt hashes by the server and never stored as text (the stored copy only
 * carries `hasPassword: true` markers; unlock is checked with `pbCompanyUnlock`).
 */
export async function pbWriteCompanyRoot(
  appCompanyId: string,
  data: Record<string, unknown> | null | undefined,
  mode: "set" | "merge" | "update",
  /** Server login (no Firestore copy): the server is the only copy, so a failure is thrown to the caller. */
  opts?: { throwOnError?: boolean }
): Promise<{ data: Record<string, unknown>; updatedAtMs: number } | null> {
  if (!getValidPocketBaseAuth()) {
    if (opts?.throwOnError) throw new Error("Pocket Ledger Server: sign in again to save this change.");
    setPocketBaseCompanyRootDirty(appCompanyId, true);
    return null;
  }
  try {
    const enc = encodeWriteForPocketBase(data || {}, mode);
    const clean = enc.data;
    const fieldOps = enc.fieldOps;
    await ensurePocketBaseCompany(appCompanyId, {
      createIfMissing: true,
      info: await companyInfoFromLocalRegistry(appCompanyId),
    });
    const sentAt = Date.now();
    const res = (await pbRequest("/api/pl/data/company", {
      method: "POST",
      body: {
        company: appCompanyId,
        mode,
        data: clean,
        fieldOps,
        at: pbServerTime(sentAt),
        deviceId: pbDeviceId(),
      },
    })) as { ok?: boolean; data?: Record<string, unknown>; updatedAtMs?: number; serverNow?: number };
    noteServerNow(res?.serverNow, sentAt);
    rootCache.delete(appCompanyId);
    setPocketBaseCompanyRootDirty(appCompanyId, false);
    emitRootUpdated(appCompanyId);
    return { data: (res?.data as Record<string, unknown>) || {}, updatedAtMs: Number(res?.updatedAtMs) || 0 };
  } catch (e) {
    if (opts?.throwOnError) throw e;
    // no write access (viewer): nothing to retry; the owner's devices keep the server copy
    if (!(e instanceof PocketBaseRequestError && e.status === 403)) setPocketBaseCompanyRootDirty(appCompanyId, true);
    console.warn("[pbSync] company root write failed (Firestore copy kept):", e instanceof Error ? e.message : e);
    return null;
  }
}

export type PbCompanyUnlockResult =
  | { status: "ok" }
  | { status: "wrong" | "locked"; message: string }
  /** no password stored on the server for this user */
  | { status: "none" }
  /** not signed in to the server / offline / old server */
  | { status: "unavailable" };

/** Company unlock check on the server (bcrypt hashes); the password is never stored on the device. */
export async function pbCompanyUnlock(
  appCompanyId: string,
  username: string,
  password: string
): Promise<PbCompanyUnlockResult> {
  if (!appCompanyId || !getValidPocketBaseAuth()) return { status: "unavailable" };
  try {
    const res = (await pbRequest("/api/pl/company/unlock", {
      method: "POST",
      body: { company: appCompanyId, username, password },
    })) as { ok?: boolean; reason?: string; message?: string };
    if (res?.ok === true) return { status: "ok" };
    if (res?.reason === "none") return { status: "none" };
    if (res?.reason === "wrong") return { status: "wrong", message: String(res.message || "Wrong company username or password.") };
    return { status: "unavailable" };
  } catch (e) {
    if (e instanceof PocketBaseRequestError && e.status === 429) {
      return { status: "locked", message: "Too many wrong attempts. Try again in a few minutes." };
    }
    return { status: "unavailable" };
  }
}

/**
 * Server copy of the company root doc. `exists: false` = not usable (not on the server yet,
 * empty, or a newer local change is still unsent) -> callers read Firestore instead.
 */
export async function pbReadCompanyRoot(
  appCompanyId: string
): Promise<{ exists: boolean; data: Record<string, unknown> | null }> {
  const none = { exists: false, data: null };
  // Server login: there is no Firestore copy to prefer, so a stale dirty mark is ignored.
  if (!getValidPocketBaseAuth() || (isPocketBaseCompanyRootDirty(appCompanyId) && !isPocketBaseAppSessionActive())) {
    return none;
  }
  const hit = rootCache.get(appCompanyId);
  if (hit && Date.now() - hit.at < ROOT_CACHE_MS) return hit.value;
  let value: { exists: boolean; data: Record<string, unknown> | null } = none;
  try {
    const rec = await pbFirst<PbRecord>("pl_companies", `app_id = ${pbQuote(appCompanyId)}`);
    const raw = rec && rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : null;
    if (rec && raw && Object.keys(raw).length > 1) {
      value = { exists: true, data: { ...decodeDocFromPocketBase(raw), id: appCompanyId } };
    }
  } catch {
    return none;
  }
  rootCache.set(appCompanyId, { at: Date.now(), value });
  return value;
}

/** Copy the Firestore company root to the server (after a Firestore transaction / backfill). */
export async function pbPushCompanyRootFromFirestore(
  companyId: string
): Promise<{ data: Record<string, unknown>; updatedAtMs: number } | null> {
  // Server login: no Firestore session; the server copy is the only one.
  if (isPocketBaseAppSessionActive()) return null;
  try {
    const [{ doc, getDoc }, { firestore }] = await Promise.all([import("@/lib/pbCompat/firestore"), import("@/lib/firebase")]);
    const snap = await getDoc(doc(firestore, "companies", companyId));
    if (!snap.exists()) return null;
    return await pbWriteCompanyRoot(companyId, snap.data() as Record<string, unknown>, "set");
  } catch {
    setPocketBaseCompanyRootDirty(companyId, true);
    return null;
  }
}

/** Pull step: push a missing / dirty server root from Firestore, refresh the registry row. */
const rootBackfillAt = new Map<string, number>();

async function syncCompanyRoot(companyId: string, rootChanged: boolean): Promise<void> {
  const dirty = isPocketBaseCompanyRootDirty(companyId) && !isPocketBaseAppSessionActive();
  let server: { exists: boolean; data: Record<string, unknown> | null } = dirty
    ? { exists: false, data: null }
    : await pbReadCompanyRoot(companyId);
  if (dirty || !server.exists) {
    // one Firestore read + push per company per 10 minutes at most
    const last = rootBackfillAt.get(companyId) || 0;
    if (Date.now() - last < 600_000) return;
    rootBackfillAt.set(companyId, Date.now());
    const r = await pbPushCompanyRootFromFirestore(companyId);
    if (!r) return;
    server = { exists: true, data: { ...decodeDocFromPocketBase(r.data), id: companyId } };
  } else if (!rootChanged) {
    return;
  }
  if (server.data) await mirrorRootToRegistry(companyId, server.data);
  emitRootUpdated(companyId);
}

/* ------------------------------------------------------------------ */
/* rows                                                                */
/* ------------------------------------------------------------------ */

function rowFilter(companyRec: string, appColl: string, docId: string): { collection: string; filter: string; key: Record<string, string> } {
  const t = pbTargetForAppCollection(appColl);
  if (!t) throw new PocketBaseRequestError(`Pocket Ledger Server: unsupported collection "${appColl}"`, 400);
  let filter = `company = ${pbQuote(companyRec)} && app_id = ${pbQuote(docId)}`;
  for (const [k, v] of Object.entries(t.key)) filter += ` && ${k} = ${pbQuote(v)}`;
  return { collection: t.collection, filter, key: t.key };
}

export type PbWriteMode = "set" | "merge" | "update" | "delete";

/** One write in a server batch / transaction. */
export type PbBatchOp = {
  coll: string;
  id: string;
  mode: PbWriteMode;
  data?: Record<string, unknown> | null;
  /** client time of the edit (ms) - conflict check; default now */
  at?: number;
};

/** Transaction precondition: the row must still exist / not exist / have this version. */
export type PbExpect = { coll: string; id: string; exists?: boolean; version?: string };

export type PbOpResult = {
  coll: string;
  id: string;
  /** ok | merged (older edit merged into newer server doc) | rejected (older set/delete, server doc kept) */
  status: "ok" | "merged" | "rejected";
  exists: boolean;
  /** stored document (server JSON encoding) */
  data: Record<string, unknown>;
  updatedAtMs: number;
  version: string;
};

function checkDocId(docId: string): string {
  const id = String(docId || "").trim();
  if (!id || id.length > 200) throw new PocketBaseRequestError("Pocket Ledger Server: bad document id", 400);
  return id;
}

/**
 * Several writes in ONE server transaction (`/api/pl/data/batch`): all or nothing.
 * FieldValues (increment, arrayUnion/Remove, deleteField, serverTimestamp) are applied on the server.
 * `expects` (transactions): any mismatch -> 409 `code: "conflict"`, nothing written.
 */
export async function pbBatchWrite(appCompanyId: string, ops: PbBatchOp[], expects?: PbExpect[]): Promise<PbOpResult[]> {
  if (!ops.length) return [];
  if (ops.length > 500) throw new PocketBaseRequestError("Pocket Ledger Server: too many writes in one batch (max 500)", 400);
  const now = Date.now();
  const body = ops.map((o) => {
    const id = checkDocId(o.id);
    if (!pbTargetForAppCollection(o.coll)) {
      throw new PocketBaseRequestError(`Pocket Ledger Server: unsupported collection "${o.coll}"`, 400);
    }
    const enc = encodeWriteForPocketBase(o.data, o.mode);
    const at = pbServerTime(Number.isFinite(o.at) && (o.at as number) > 0 ? Math.trunc(o.at as number) : now);
    return { coll: o.coll, id, mode: o.mode, data: enc.data, fieldOps: enc.fieldOps, at };
  });
  await ensurePocketBaseCompany(appCompanyId, {
    createIfMissing: true,
    info: await companyInfoFromLocalRegistry(appCompanyId),
  });
  const sentAt = Date.now();
  type BatchRes = { ok?: boolean; results?: PbOpResult[]; serverNow?: number };
  const sendBatch = async () =>
    (await pbRequest("/api/pl/data/batch", {
      method: "POST",
      body: { company: appCompanyId, deviceId: pbDeviceId(), ops: body, expects: expects || [] },
    })) as BatchRes;
  let res: BatchRes;
  try {
    res = await sendBatch();
  } catch (e) {
    if (!(e instanceof PocketBaseRequestError) || e.status !== 404 || !isPocketBaseCompanyMissingError(e)) throw e;
    // 404 "company not found": the cached server record id is stale (company deleted / server restored).
    // Forget it, look the company up ONCE; retry the write only if it is really there. Otherwise the
    // caller (outbox flush) treats this as a permanent error and stops retrying that company.
    rememberCompanyRec(appCompanyId, null);
    let again: PbRecord | null = null;
    try {
      again = await pbFirst<PbRecord>("pl_companies", `app_id = ${pbQuote(appCompanyId)}`);
    } catch {
      throw e;
    }
    if (!again?.id) throw e;
    rememberCompanyRec(appCompanyId, again.id);
    res = await sendBatch();
  }
  noteServerNow(res?.serverNow, sentAt);
  const results = Array.isArray(res?.results) ? res.results : [];
  for (const r of results) {
    if (r.status !== "ok") console.warn("[pbSync] write conflict:", r.status, r.coll, r.id);
  }
  return results;
}

/**
 * Write one app document to the server (one-op batch).
 * - set: replace the document
 * - merge: deep merge (setDoc merge:true)
 * - update: dotted-path patch (updateDoc)
 * - delete: deleteDoc (row kept as a tombstone so other devices see it)
 * Returns the stored (encoded) document.
 */
export async function pbWriteAppDoc(
  appCompanyId: string,
  appColl: string,
  docId: string,
  data: Record<string, unknown> | null | undefined,
  mode: PbWriteMode
): Promise<Record<string, unknown>> {
  const [r] = await pbBatchWrite(appCompanyId, [{ coll: appColl, id: docId, mode, data }]);
  return (r?.data as Record<string, unknown>) || {};
}

/** Current server copy of one document (null = does not exist / deleted with deleteDoc). */
export async function pbReadAppDoc(
  appCompanyId: string,
  appColl: string,
  docId: string
): Promise<{ exists: boolean; data: Record<string, unknown> | null; version: string }> {
  const id = checkDocId(docId);
  const companyRec = await ensurePocketBaseCompany(appCompanyId);
  const { collection, filter } = rowFilter(companyRec, appColl, id);
  const rec = await pbFirst<PbRecord>(collection, filter);
  if (!rec) return { exists: false, data: null, version: "" };
  const raw = (rec.data && typeof rec.data === "object" ? rec.data : {}) as Record<string, unknown>;
  const version = String(rec.updated || "");
  if (rec.deleted === true && raw[PB_HARD_DELETED] === true) return { exists: false, data: null, version };
  return { exists: true, data: pbRecordToAppDoc(rec), version };
}

/* ------------------------------------------------------------------ */
/* outbox push                                                         */
/* ------------------------------------------------------------------ */

export type PbOutboxRow = {
  company_id: string;
  collection_name: string;
  doc_id: string;
  op: string;
  payload: string;
  /** sync_outbox.created_at (ms) = time of the local edit */
  created_at?: number | null;
};

/**
 * Push one `sync_outbox` row (payload = full merged doc, outbox JSON encoding).
 * Conflict: when another device saved a newer copy, the server keeps it ("rejected") and
 * this device's local copy is replaced with the server copy.
 *
 * File-replace-on-edit (vouchers): a rejected SET must not silently throw away the user's
 * new `fileUrls`. Retry once with a fresh `at`. The post-upload rewrite also uses a fresh
 * `at` so it is not rejected as older than the JSON write that just succeeded.
 */
export async function pushOutboxRowToPocketBase(row: PbOutboxRow): Promise<PbOpResult | null> {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const isTombstone =
    row.op !== "delete" &&
    (payload.isDeleted === true || payload.deleted === true);
  // Recycle-bin soft delete: merge tombstone. Full SET was rejected when server `updatedAtMs`
  // was newer, so PocketBase never logged the delete and the other device kept the voucher.
  const mode: PbWriteMode = row.op === "delete" ? "delete" : isTombstone ? "merge" : "set";
  const at = Number(row.created_at);
  const writeOnce = async (data: Record<string, unknown>, atOverrideMs?: number) => {
    const useAt =
      Number.isFinite(atOverrideMs) && (atOverrideMs as number) > 0
        ? Math.trunc(atOverrideMs as number)
        : Number.isFinite(at) && at > 0
          ? at
          : undefined;
    const [result] = await pbBatchWrite(row.company_id, [
      {
        coll: row.collection_name,
        id: row.doc_id,
        mode,
        data,
        at: useAt,
      },
    ]);
    return result || null;
  };
  const payloadHasLocalRef = (data: Record<string, unknown>) => JSON.stringify(data).includes('"local:"');
  const fileUrlsFingerprint = (raw: unknown): string => {
    if (!Array.isArray(raw)) return "";
    return raw
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter(Boolean)
      .join("\n");
  };
  const convertPendingLocals = async (
    data: Record<string, unknown>
  ): Promise<import("@/lib/pocketbaseData/pbAttachments").PbAttachmentConversion | null> => {
    if (mode === "delete" || !payloadHasLocalRef(data)) return null;
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    // Give the file upload time - a short abort left `local:` on the voucher.
    const timer = ac ? setTimeout(() => ac.abort(), 60_000) : null;
    try {
      const [{ convertLocalRefsForPocketBase }, { getPendingPayloadForLocalRef }] = await Promise.all([
        import("@/lib/pocketbaseData/pbAttachments"),
        import("@/lib/localPendingFiles"),
      ]);
      const pbCompanyId = await ensurePocketBaseCompany(row.company_id, {
        createIfMissing: true,
        info: await companyInfoFromLocalRegistry(row.company_id),
      });
      return await convertLocalRefsForPocketBase({
        pbCompanyId,
        coll: row.collection_name,
        docId: row.doc_id,
        data,
        deviceId: pbDeviceId(),
        getPending: getPendingPayloadForLocalRef,
        signal: ac?.signal,
      });
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // JSON first - voucher attachment upload used to occupy the HTTP/1.1 slot so the
  // other device only saw the edit after the writer refreshed (SSE dropped, POST ran).
  let r = await writeOnce(payload);
  let conversion: import("@/lib/pocketbaseData/pbAttachments").PbAttachmentConversion | null = null;

  if (mode !== "delete" && r?.status !== "rejected" && payloadHasLocalRef(payload)) {
    conversion = await convertPendingLocals(payload);
    if (conversion?.converted.size) {
      payload = conversion.data;
      // Fresh at: same outbox `created_at` would look older than the JSON write above.
      r = await writeOnce(payload, Date.now());
    }
  }

  // Approved rule: edit + replace file on PocketBase - do not let a rejected SET restore the
  // old fileUrls. One fresh-at retry (after uploading any pending local: bytes).
  if (
    r?.status === "rejected" &&
    mode === "set" &&
    row.collection_name === "vouchers" &&
    Object.prototype.hasOwnProperty.call(payload, "fileUrls") &&
    fileUrlsFingerprint(payload.fileUrls) !== fileUrlsFingerprint(r.data?.fileUrls)
  ) {
    let retryPayload = payload;
    let retryConversion = conversion;
    if (payloadHasLocalRef(retryPayload)) {
      const uploaded = await convertPendingLocals(retryPayload);
      if (uploaded?.converted.size) {
        retryPayload = uploaded.data;
        retryConversion = uploaded;
      }
    }
    const retry = await writeOnce(retryPayload, Date.now());
    if (retry && retry.status !== "rejected") {
      payload = retryPayload;
      conversion = retryConversion;
      r = retry;
    } else if (retry) {
      r = retry;
    }
  }

  if (conversion && conversion.converted.size && r && r.status !== "rejected") {
    await applyAttachmentLinksLocally(row, conversion);
  }
  if (r && r.status === "rejected") {
    try {
      const { upsertCompanyDocInBrowserDb } = await import("@/lib/localCompanyDocMirror");
      await upsertCompanyDocInBrowserDb(
        row.company_id,
        row.collection_name,
        row.doc_id,
        pbRecordToAppDoc({ app_id: row.doc_id, data: r.data, deleted: r.exists === false }),
        { force: true, notify: true, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
      );
    } catch {
      /* next pull repairs the mirror */
    }
  }
  return r || null;
}

/** After a push: local copy gets the `pbatt:` links too, then the pending bytes can go. */
async function applyAttachmentLinksLocally(
  row: PbOutboxRow,
  conversion: import("@/lib/pocketbaseData/pbAttachments").PbAttachmentConversion
): Promise<void> {
  try {
    const [{ getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb }, { replaceRefsDeep }] = await Promise.all([
      import("@/lib/localCompanyDocMirror"),
      import("@/lib/pocketbaseData/pbAttachments"),
    ]);
    const local = (await getCompanyDocFromBrowserDb(row.company_id, row.collection_name, row.doc_id, {
      includeDeleted: true,
    })) as Record<string, unknown> | null;
    if (local) {
      await upsertCompanyDocInBrowserDb(
        row.company_id,
        row.collection_name,
        row.doc_id,
        { ...replaceRefsDeep(local, conversion.converted), id: row.doc_id },
        { force: true, notify: true, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
      );
    }
  } catch {
    /* next pull brings the links */
    return;
  }
  if (!conversion.uploadedPendingIds.length) return;
  try {
    const { removePendingFile } = await import("@/lib/localPendingFiles");
    for (const id of conversion.uploadedPendingIds) await removePendingFile(id);
  } catch {
    /* orphan pending rows are cleaned by the pending-file sweep */
  }
}

/* ------------------------------------------------------------------ */
/* pull                                                                */
/* ------------------------------------------------------------------ */

type Cursor = { atMs: number; url: string };

/** Pull position per signed-in server user + company (another user on this device pulls fully). */
function cursorKey(companyId: string): string | null {
  const uid = getValidPocketBaseAuth()?.userId || "";
  return uid ? `${CURSOR_KEY_PREFIX}${uid}:${companyId}` : null;
}

function readCursor(companyId: string): Cursor | null {
  if (typeof window === "undefined") return null;
  const key = cursorKey(companyId);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    const o = raw ? (JSON.parse(raw) as Partial<Cursor>) : null;
    return o && Number.isFinite(o.atMs) && o.url ? { atMs: Number(o.atMs), url: String(o.url) } : null;
  } catch {
    return null;
  }
}

function writeCursor(companyId: string, c: Cursor | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CURSOR_KEY_PREFIX + companyId); // legacy (device-wide) key
    const key = cursorKey(companyId);
    if (!key) return;
    if (c) window.localStorage.setItem(key, JSON.stringify(c));
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Server row -> app document (`id` = app id; soft-deleted rows carry isDeleted). */
export function pbRecordToAppDoc(rec: Record<string, unknown>): Record<string, unknown> {
  const doc = decodeDocFromPocketBase(rec.data);
  const id = String(rec.app_id || "");
  const out: Record<string, unknown> = { ...doc, id };
  delete out[PB_HARD_DELETED];
  if (rec.deleted === true && out.isDeleted !== true) out.isDeleted = true;
  return out;
}

export type PbPullResult = {
  full: boolean;
  changed: number;
  collections: Record<string, number>;
  /** Docs the local SQLite write failed/paused on. The pull cursor is NOT advanced when > 0. */
  failed?: number;
};

async function mirrorDocs(
  companyId: string,
  byColl: Map<string, Record<string, unknown>[]>,
  failedOut?: { n: number },
  mirrorOpts?: { notify?: boolean }
): Promise<Record<string, number>> {
  const { mirrorCollectionDocsToBrowserDbSilent, notifyBrowserDbCollectionUpdated } = await import(
    "@/lib/localCompanyDocMirror"
  );
  const counts: Record<string, number> = {};
  for (const [coll, docs] of byColl) {
    if (!docs.length) continue;
    const result = await mirrorCollectionDocsToBrowserDbSilent(companyId, coll, docs, {
      force: true,
      mergePreferNewer: true,
    });
    if (failedOut && result.failed) failedOut.n += result.failed;
    if (!result.upserted) continue;
    counts[coll] = result.upserted;
    // Open lists (dashboard, daybook, ledgers, vouchers, parties, items) re-read SQLite on this bump.
    if (mirrorOpts?.notify !== false) {
      notifyBrowserDbCollectionUpdated(companyId, coll, { source: "pl_server_pull", immediate: true });
    }
  }
  return counts;
}

/**
 * Live-patch open lists from SQLite (post-merge), never from a stale incoming server row.
 * Writer save: local newer stays; painting the old server copy caused a 20ms old-narration flash.
 */
async function dispatchPbMirrorLivePatches(
  companyId: string,
  byColl: Map<string, Record<string, unknown>[]>,
  opts?: { insertIfMissing?: boolean }
): Promise<void> {
  const insertIfMissing = opts?.insertIfMissing !== false;
  const { getCompanyDocFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
  for (const [coll, docs] of byColl) {
    for (const doc of docs) {
      const id = String(doc.id || "");
      if (!id) continue;
      const local = ((await getCompanyDocFromBrowserDb(companyId, coll, id, {
        includeDeleted: true,
      })) || doc) as Record<string, unknown>;
      if (coll === "vouchers") {
        const { dispatchVoucherLivePatch } = await import("@/lib/voucherFormAttachmentSave");
        dispatchVoucherLivePatch(companyId, id, { ...local, id });
      } else {
        const { dispatchMasterLivePatch, isMasterLivePatchCollection } = await import(
          "@/lib/masterEntityLivePatch"
        );
        if (isMasterLivePatchCollection(coll)) {
          dispatchMasterLivePatch(companyId, coll, id, { ...local, id }, { insertIfMissing });
        }
      }
    }
  }
}

/**
 * Apply one PocketBase realtime collection event to the local SQLite mirror (Live mode).
 * Same merge rules as a change-log pull (newer local / pending outbox wins).
 */
export async function applyPocketBaseRealtimeRecord(
  collection: string,
  rec: Record<string, unknown> | null | undefined,
  action?: string
): Promise<"applied" | "skipped" | "unmapped"> {
  if (!rec || typeof rec !== "object") return "skipped";
  const auth = getValidPocketBaseAuth();
  if (!auth) return "skipped";
  const companyRecId = pocketBaseCompanyRecId(rec);
  if (!companyRecId) return "skipped";
  const myDevice = pbDeviceId();
  if (myDevice && String(rec.deviceId || "") === myDevice) return "skipped";
  const ids = listPocketBaseCompanyIds();
  const hit = appCompanyIdForPocketBaseRecord(companyRecId, ids);
  if (!hit.appCompanyId) return hit.someUnmapped ? "unmapped" : "skipped";
  if (!isActivePocketBaseCompanyId(hit.appCompanyId)) return "skipped";

  if (collection === "pl_companies") {
    rootCache.delete(hit.appCompanyId);
    await syncCompanyRoot(hit.appCompanyId, true);
    return "applied";
  }
  if (!(PB_DATA_COLLECTIONS as readonly string[]).includes(collection)) return "skipped";

  const row = String(action || "").toLowerCase() === "delete" ? { ...rec, deleted: true } : rec;
  const byColl = new Map<string, Record<string, unknown>[]>();
  if (!groupRecords(collection, [row], byColl)) return "skipped";
  const collections = await mirrorDocs(hit.appCompanyId, byColl);
  if (Object.keys(collections).length) {
    try {
      await dispatchPbMirrorLivePatches(hit.appCompanyId, byColl, {
        insertIfMissing: String(action || "").toLowerCase() !== "delete",
      });
    } catch {
      /* collection bump already refreshed open lists */
    }
  }
  // A voucher / document from another device may carry a new file: fetch it to this device (debounced).
  if (String(action || "").toLowerCase() !== "delete") queuePbFilesForCompany(hit.appCompanyId);
  return "applied";
}

function groupRecords(
  collection: string,
  recs: Record<string, unknown>[],
  into: Map<string, Record<string, unknown>[]>,
  opts?: { skipOwnDevice?: boolean }
): number {
  const myDevice = opts?.skipOwnDevice ? pbDeviceId() : "";
  let n = 0;
  for (const r of recs) {
    if (myDevice && String(r.deviceId || "") === myDevice) continue;
    const appColl = appCollectionForPbRecord(collection, r);
    if (!appColl || !r.app_id) continue;
    const list = into.get(appColl) || [];
    list.push(pbRecordToAppDoc(r));
    into.set(appColl, list);
    n++;
  }
  return n;
}

/**
 * Pull server changes for one company into the local SQLite mirror.
 * First run (or server URL change): full read of every data collection.
 * Later runs: only rows named in the server change log since the cursor.
 */
export async function pullPocketBaseCompanyToLocal(companyId: string, opts?: { full?: boolean }): Promise<PbPullResult> {
  const auth = getValidPocketBaseAuth();
  if (!auth) return { full: false, changed: 0, collections: {} };
  const companyRec = await ensurePocketBaseCompany(companyId);
  const cf = `company = ${pbQuote(companyRec)}`;
  const cursor = opts?.full ? null : readCursor(companyId);
  const byColl = new Map<string, Record<string, unknown>[]>();

  if (!cursor || cursor.url !== auth.url) {
    // cursor taken before the full read: anything written during the read is pulled again next time
    const latest = await pbFirst<{ at_ms?: number }>("pl_change_log", cf, "-at_ms");
    const maxAt = Number(latest?.at_ms) || 0;
    let changed = 0;
    const failedOut = { n: 0 };
    const collections: Record<string, number> = {};
    // Write page by page (500 rows) straight into local SQLite: bounded memory, visible progress, and a
    // killed / offline pull keeps what was already written (the cursor below is saved only after a full success).
    let totalDocs: number | null = 0;
    try {
      const counts = await Promise.all(PB_DATA_COLLECTIONS.map((c) => pbServerCount(c, cf)));
      for (const n of counts) {
        if (n == null) {
          totalDocs = null;
          break;
        }
        totalDocs += n;
      }
    } catch {
      totalDocs = null;
    }
    setPbDataPullProgress({ active: true, companyId, collection: "", docs: 0, total: totalDocs }, true);
    let docsDone = 0;
    try {
      const { notifyBrowserDbCollectionUpdated } = await import("@/lib/localCompanyDocMirror");
      for (const coll of PB_DATA_COLLECTIONS) {
        setPbDataPullProgress({ collection: coll });
        const touched = new Set<string>();
        await pbListAll<PbRecord>(coll, cf, {
          discard: true,
          onPage: async (recs, page) => {
            const pageMap = new Map<string, Record<string, unknown>[]>();
            changed += groupRecords(coll, recs, pageMap);
            const part = await mirrorDocs(companyId, pageMap, failedOut, { notify: page === 1 });
            for (const [k, v] of Object.entries(part)) {
              collections[k] = (collections[k] || 0) + v;
              touched.add(k);
            }
            if (Object.keys(part).length) {
              try {
                await dispatchPbMirrorLivePatches(companyId, pageMap);
              } catch {
                /* collection bump already refreshed open lists */
              }
            }
            docsDone += recs.length;
            setPbDataPullProgress({ docs: docsDone });
          },
        });
        for (const k of touched) {
          notifyBrowserDbCollectionUpdated(companyId, k, { source: "pl_server_pull", immediate: true });
        }
      }
    } finally {
      resetPbDataPullProgress();
    }
    await syncCompanyRoot(companyId, true);
    if (failedOut.n > 0 && docsDone === 0) {
      // Complete failure: 0 docs written, discard cursor to force full pull next time.
      console.warn("[pbSync] full pull: ALL writes failed (" + failedOut.n + ") - cursor not saved", companyId);
      writeCursor(companyId, null);
      return { full: true, changed, collections, failed: failedOut.n };
    }
    if (failedOut.n > 0) {
      // Partial failure: some docs written successfully - save cursor to avoid full re-download next time.
      console.warn("[pbSync] full pull: partial write failure", failedOut.n, "docs - cursor saved anyway", companyId);
    }
    // Save cursor (even on partial failure, so next pull is incremental delta not full).
    writeCursor(companyId, { atMs: maxAt, url: auth.url });
    // First login / full pull: bring every server file of this company to the device too.
    void import("@/lib/pocketbaseData/pbFilesPull")
      .then((m) => m.queuePbFilesSync(companyId, { delayMs: 500 }))
      .catch(() => {});
    return { full: true, changed, collections };
  }

  // 2s overlap: rows written in the same millisecond window are re-read (idempotent).
  const since = Math.max(0, cursor.atMs - 2000);
  const logs = await pbListAll<{ coll?: string; record_id?: string; op?: string; at_ms?: number }>(
    "pl_change_log",
    `${cf} && at_ms >= ${since}`,
    { sort: "at_ms", fields: "coll,record_id,op,at_ms", maxPages: 20 }
  );
  if (!logs.length) {
    if (isPocketBaseCompanyRootDirty(companyId)) await syncCompanyRoot(companyId, false);
    return { full: false, changed: 0, collections: {} };
  }
  let maxAt = cursor.atMs;
  let rootChanged = false;
  const idsByColl = new Map<string, Set<string>>();
  for (const l of logs) {
    maxAt = Math.max(maxAt, Number(l.at_ms) || 0);
    const coll = String(l.coll || "");
    if (coll === "pl_companies") rootChanged = true;
    if (!(PB_DATA_COLLECTIONS as readonly string[]).includes(coll) || !l.record_id) continue;
    const s = idsByColl.get(coll) || new Set<string>();
    s.add(String(l.record_id));
    idsByColl.set(coll, s);
  }
  let changed = 0;
  for (const [coll, ids] of idsByColl) {
    const all = Array.from(ids);
    for (let i = 0; i < all.length; i += 40) {
      const chunk = all.slice(i, i + 40);
      const f = `${cf} && (${chunk.map((id) => `id = ${pbQuote(id)}`).join(" || ")})`;
      const recs = await pbListAll<PbRecord>(coll, f);
      changed += groupRecords(coll, recs, byColl, { skipOwnDevice: true });
    }
  }
  const failedOut = { n: 0 };
  const collections = await mirrorDocs(companyId, byColl, failedOut);
  if (Object.keys(collections).length) {
    try {
      await dispatchPbMirrorLivePatches(companyId, byColl);
    } catch {
      /* collection bump already refreshed open lists */
    }
  }
  if (rootChanged || isPocketBaseCompanyRootDirty(companyId)) {
    rootCache.delete(companyId);
    await syncCompanyRoot(companyId, rootChanged);
  }
  if (failedOut.n > 0) {
    // Keep the old cursor: the same change-log window is read again next pull (idempotent merge).
    console.warn("[pbSync] pull: local write failed for", failedOut.n, "docs - cursor not advanced", companyId);
    return { full: false, changed, collections, failed: failedOut.n };
  }
  writeCursor(companyId, { atMs: maxAt, url: auth.url });
  if (changed > 0) queuePbFilesForCompany(companyId);
  return { full: false, changed, collections };
}

/** New / changed server rows may carry new files: queue the (debounced, incremental) device file pull. */
function queuePbFilesForCompany(companyId: string): void {
  void import("@/lib/pocketbaseData/pbFilesPull")
    .then((m) => m.queuePbFilesSync(companyId))
    .catch(() => {});
}

/** Min gap between server-count integrity checks per user+company (background / idle paths). */
const HEAL_CHECK_MIN_INTERVAL_MS = 5 * 60_000;
/** After a heal full pull that still left the mirror short of the server, wait longer before retrying. */
const HEAL_STILL_SHORT_BACKOFF_MS = 30 * 60_000;
const healNextCheckAt = new Map<string, number>();

/** Core collections whose absence makes the app look empty (accounts / parties / groups / vouchers / expense heads). */
const HEAL_CORE_COLLECTIONS: ReadonlyArray<{ label: string; pb: string; appColls: readonly string[]; kindFilter?: boolean }> = [
  { label: "parties", pb: "pl_parties", appColls: ["parties"] },
  { label: "bank_accounts", pb: "pl_bank_accounts", appColls: ["bank_accounts"] },
  { label: "groups", pb: "pl_groups", appColls: PB_GROUP_KINDS as readonly string[], kindFilter: true },
  { label: "vouchers", pb: "pl_vouchers", appColls: ["vouchers"] },
  { label: "expense_accounts", pb: "pl_expense_accounts", appColls: ["expense_accounts"] },
];

/** Cheap server count for one company collection (perPage=1 -> totalItems); null when unknown. */
async function pbServerCount(collection: string, filter: string): Promise<number | null> {
  try {
    const q = new URLSearchParams({ page: "1", perPage: "1", filter });
    const res = (await pbRequest(`/api/collections/${collection}/records?${q.toString()}`)) as { totalItems?: unknown };
    const n = Number(res?.totalItems);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Compare local mirror counts with the server (live rows only) for the core collections.
 * Returns a reason string when the mirror is missing rows the server has, else "".
 * Local count includes tombstones, so local >= server-alive is the healthy case.
 */
async function localMirrorShortReason(companyId: string, companyRec: string): Promise<string> {
  const { countCompanyDocsInBrowserDb } = await import("@/lib/localCompanyDocMirror");
  const cf = `company = ${pbQuote(companyRec)} && deleted = false`;
  const localCounts: Record<string, number> = {};
  for (const c of HEAL_CORE_COLLECTIONS) {
    let n = 0;
    for (const appColl of c.appColls) n += await countCompanyDocsInBrowserDb(companyId, appColl);
    localCounts[c.label] = n;
  }
  const allLocalEmpty = localCounts.parties === 0 && localCounts.vouchers === 0;
  const short: string[] = [];
  let serverUnknown = false;
  for (const c of HEAL_CORE_COLLECTIONS) {
    const filter = c.kindFilter
      ? `${cf} && (${(PB_GROUP_KINDS as readonly string[]).map((k) => `kind = ${pbQuote(k)}`).join(" || ")})`
      : cf;
    const server = await pbServerCount(c.pb, filter);
    if (server == null) {
      serverUnknown = true;
      continue;
    }
    const local = localCounts[c.label];
    // Only force full pull if local is completely empty for this collection.
    // If local already has data (even partial), incremental delta will fill gaps.
    if (server > 0 && local === 0) short.push(`${c.label} local=${local} server=${server}`);
  }
  if (short.length) return short.join(", ");
  // Server counts unavailable: keep the legacy emptiness heal (no parties and no vouchers locally).
  if (serverUnknown && allLocalEmpty) return "local empty (server counts unavailable)";
  return "";
}

/**
 * Pull with self-heal. When a pull cursor exists but this origin's local mirror is missing rows the
 * server has (empty/wiped SQLite, copied or stale cursor, partial earlier write), do a FULL pull instead
 * of an incremental one - an incremental pull only replays change-log rows and never repairs holes.
 * The check compares per-collection local counts with a cheap server count (parties, bank accounts,
 * groups, vouchers, expense heads) and is throttled per user+company.
 * `oncePerSession`: background paths - run the check at most once per few minutes. Explicit callers
 * (manual sync button) always check.
 */
export async function pullPocketBaseCompanyToLocalHealed(
  companyId: string,
  opts?: { oncePerSession?: boolean }
): Promise<PbPullResult> {
  let full = false;
  const key = `${getValidPocketBaseAuth()?.userId || ""}:${companyId}`;
  const now = Date.now();
  const throttled = opts?.oncePerSession === true && now < (healNextCheckAt.get(key) || 0);
  if (!throttled && readCursor(companyId)) {
    healNextCheckAt.set(key, now + HEAL_CHECK_MIN_INTERVAL_MS);
    try {
      const companyRec = await ensurePocketBaseCompany(companyId);
      const reason = await localMirrorShortReason(companyId, companyRec);
      if (reason) {
        console.warn("[pbSync] local mirror short of server but pull cursor exists - full pull", companyId, reason);
        full = true;
      }
    } catch {
      /* count/check failed: keep the normal incremental pull */
    }
  }
  try {
    const res = await pullPocketBaseCompanyToLocal(companyId, full ? { full: true } : undefined);
    if (full) {
      if (res.failed) {
        healNextCheckAt.set(key, Date.now() + 30_000); // write failed: retry soon
      } else {
        // Still short after a clean full pull (e.g. rows the server has that cannot mirror): back off.
        try {
          const rec = await ensurePocketBaseCompany(companyId);
          if (await localMirrorShortReason(companyId, rec)) healNextCheckAt.set(key, Date.now() + HEAL_STILL_SHORT_BACKOFF_MS);
        } catch {
          /* ignore */
        }
      }
    }
    return res;
  } catch (e) {
    healNextCheckAt.set(key, Date.now() + 30_000);
    throw e;
  }
}

let pullAllRunning = false;
let lastPullAllAt = 0;

/** Throttled pull of the selected PocketBase company only (idle sync). */
export async function pullAllPocketBaseCompaniesThrottled(
  minIntervalMs = 30_000,
  opts?: { force?: boolean }
): Promise<void> {
  if (pullAllRunning) return;
  if (!opts?.force && Date.now() - lastPullAllAt < minIntervalMs) return;
  if (!getValidPocketBaseAuth()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const ids = listActivePocketBaseCompanyIds();
  if (!ids.length) return;
  pullAllRunning = true;
  lastPullAllAt = Date.now();
  try {
    for (const id of ids) {
      try {
        if (!isActivePocketBaseCompanyId(id)) continue; // switched away mid-loop: that company sleeps
        await pullPocketBaseCompanyToLocalHealed(id, { oncePerSession: true });
      } catch (e) {
        console.warn("[pbSync] pull failed", id, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    pullAllRunning = false;
  }
}

/** Forget local sync state for a company (e.g. after sign-out or server change). */
export function resetPocketBaseCompanySyncState(companyId: string): void {
  writeCursor(companyId, null);
  rootCache.delete(companyId);
  rememberCompanyRec(companyId, null);
}
