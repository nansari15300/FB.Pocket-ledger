/**
 * Shared read seam: drop-in `getDoc` / `getDocs` / `onSnapshot` (+ FromServer / FromCache / count)
 * with the Firestore signatures. Firebase companies (and every non-company path): the call goes
 * straight to Firestore, unchanged. Pocket Ledger Server (PocketBase) companies:
 *   - `companies/{id}` (company root doc) `getDoc` / `getDocFromServer` -> server copy (member
 *     passwords there are bcrypt hashes; the data only carries `hasPassword` markers). Plan /
 *     billing fields still come from Firestore (written by server routes with Firebase Admin).
 *     Firestore is used when the server copy is missing / dirty / a root write is in flight.
 *     `onSnapshot` and `getDocFromCache` on the root stay on Firestore for now.
 *     Server login (pl_users, no Firebase session): the root is read from the server only (every
 *     read incl. `onSnapshot` / `getDocFromCache`), falling back to this device's registry row.
 *   - `companies/{id}/{coll}/{doc}`         -> local SQLite mirror, server when not mirrored yet
 *   - `companies/{id}/{coll}` (+ where / orderBy / limit / startAt...) -> local SQLite mirror,
 *     evaluated in memory (the mirror is kept current by writes + the server pull)
 *   - `onSnapshot` re-reads on local mirror bumps (writes, server pull).
 * Anything the seam cannot evaluate (collection groups, deeper paths) goes to Firestore.
 */

import {
  doc as fsDoc,
  getCountFromServer as fsGetCountFromServer,
  getDoc as fsGetDoc,
  getDocFromCache as fsGetDocFromCache,
  getDocFromServer as fsGetDocFromServer,
  getDocs as fsGetDocs,
  getDocsFromCache as fsGetDocsFromCache,
  getDocsFromServer as fsGetDocsFromServer,
  onSnapshot as fsOnSnapshot,
  Timestamp,
} from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import {
  isPocketBaseCompanyId,
  isPocketBaseRootWritePending,
  listPocketBaseCompanyIds,
} from "@/lib/pocketbaseData/pbCompanyRegistry";
import { isPocketBaseAppSessionActive, readPocketBaseAppProfile } from "@/lib/pocketbaseData/pbAppSession";
import { pbRequest, getValidPocketBaseAuth } from "@/lib/pocketbaseData/pbClient";
import { USER_GLOBAL_ROOTS } from "@/lib/pocketbaseData/pbGlobalDocs";
import { isSuperAdminEmail } from "@/lib/recovery/recoveryMode";
import { isPocketBaseRealtimeLive } from "@/lib/pocketbaseData/pbRealtimeState";


type AnyRec = Record<string, unknown>;

type PbTarget =
  | { kind: "doc"; companyId: string; coll: string; docId: string; path: string }
  | { kind: "query"; companyId: string; coll: string; path: string; q: ParsedQuery | null }
  | { kind: "root"; companyId: string; path: string };

type ParsedFilter =
  | { type: "field"; field: string[]; key: boolean; op: string; value: unknown }
  | { type: "composite"; op: string; filters: ParsedFilter[] };

type ParsedQuery = {
  filters: ParsedFilter[];
  orderBy: { field: string[]; key: boolean; dir: "asc" | "desc" }[];
  limit: number | null;
  limitToLast: boolean;
  startAt: { position: unknown[]; inclusive: boolean } | null;
  endAt: { position: unknown[]; inclusive: boolean } | null;
};

class Unsupported extends Error {}

/* ------------------------------------------------------------------ */
/* target parsing                                                      */
/* ------------------------------------------------------------------ */

function noPocketBaseCompanies(): boolean {
  try {
    return listPocketBaseCompanyIds().length === 0;
  } catch {
    return true;
  }
}

function segmentsOf(path: unknown): string[] | null {
  if (!path || typeof path !== "object") return null;
  const p = path as { toArray?: () => unknown; segments?: unknown };
  const arr = typeof p.toArray === "function" ? p.toArray() : p.segments;
  return Array.isArray(arr) ? arr.map(String) : null;
}

/** proto Value (Firestore internal) -> plain JS value; timestamps -> Timestamp */
function decodeValue(v: unknown): unknown {
  if (!v || typeof v !== "object") throw new Unsupported("value");
  const o = v as AnyRec;
  if ("nullValue" in o) return null;
  if ("booleanValue" in o) return !!o.booleanValue;
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return Number(o.doubleValue);
  if ("stringValue" in o) return String(o.stringValue);
  if ("timestampValue" in o) {
    const t = o.timestampValue as unknown;
    if (typeof t === "string") return Timestamp.fromMillis(Date.parse(t));
    if (t && typeof t === "object") {
      const ts = t as { seconds?: unknown; nanos?: unknown };
      return new Timestamp(Number(ts.seconds) || 0, Number(ts.nanos) || 0);
    }
    throw new Unsupported("timestamp");
  }
  if ("referenceValue" in o) {
    // ".../documents/companies/x/coll/id" -> document id (key filters compare ids)
    const parts = String(o.referenceValue).split("/");
    return { __ref: parts[parts.length - 1] || "" };
  }
  if ("arrayValue" in o) {
    const vals = ((o.arrayValue as AnyRec | null)?.values as unknown[]) || [];
    return vals.map(decodeValue);
  }
  if ("mapValue" in o) {
    const fields = ((o.mapValue as AnyRec | null)?.fields as AnyRec) || {};
    const out: AnyRec = {};
    for (const k of Object.keys(fields)) out[k] = decodeValue(fields[k]);
    return out;
  }
  throw new Unsupported("value type");
}

function parseFieldPath(f: unknown): { field: string[]; key: boolean } {
  const segs = segmentsOf(f);
  if (!segs || !segs.length) throw new Unsupported("field path");
  return { field: segs, key: segs.length === 1 && segs[0] === "__name__" };
}

function parseFilter(f: unknown): ParsedFilter {
  const o = f as AnyRec;
  if (Array.isArray(o?.filters)) {
    return { type: "composite", op: String(o.op || "and"), filters: (o.filters as unknown[]).map(parseFilter) };
  }
  if (o && "field" in o && "op" in o && "value" in o) {
    const fp = parseFieldPath(o.field);
    return { type: "field", ...fp, op: String(o.op), value: decodeValue(o.value) };
  }
  throw new Unsupported("filter");
}

function parseBound(b: unknown): ParsedQuery["startAt"] {
  if (!b) return null;
  const o = b as { position?: unknown; inclusive?: unknown };
  if (!Array.isArray(o.position)) throw new Unsupported("bound");
  return { position: o.position.map(decodeValue), inclusive: o.inclusive === true };
}

function parseQueryImpl(qi: unknown): ParsedQuery {
  const o = qi as AnyRec;
  if (!o || !Array.isArray(o.filters) || !Array.isArray(o.explicitOrderBy)) throw new Unsupported("query");
  const lim = o.limit;
  return {
    filters: (o.filters as unknown[]).map(parseFilter),
    orderBy: (o.explicitOrderBy as AnyRec[]).map((ob) => ({
      ...parseFieldPath(ob.field),
      dir: ob.dir === "desc" ? "desc" : "asc",
    })),
    limit: typeof lim === "number" && Number.isFinite(lim) ? lim : null,
    limitToLast: o.limitType === "L",
    startAt: parseBound(o.startAt),
    endAt: parseBound(o.endAt),
  };
}

/** PocketBase company target of a ref / query, or null (-> Firestore). */
function pbTargetOf(refOrQuery: unknown): PbTarget | null {
  const o = refOrQuery as AnyRec | null;
  if (!o || typeof o !== "object") return null;
  try {
    if (o.type === "document" || o.type === "collection") {
      const parts = String(o.path || "").split("/").filter(Boolean);
      if (parts[0] !== "companies" || !isPocketBaseCompanyId(parts[1])) return null;
      const path = parts.join("/");
      if (o.type === "document" && parts.length === 2) {
        return { kind: "root", companyId: parts[1], path };
      }
      if (o.type === "document" && parts.length === 4 && !parts[2].startsWith("_")) {
        return { kind: "doc", companyId: parts[1], coll: parts[2], docId: parts[3], path };
      }
      if (o.type === "collection" && parts.length === 3) {
        return { kind: "query", companyId: parts[1], coll: parts[2], path, q: null };
      }
      return null;
    }
    if (o.type === "query") {
      const qi = o._query as AnyRec | undefined;
      if (!qi || qi.collectionGroup) return null;
      const parts = segmentsOf(qi.path);
      if (!parts || parts.length !== 3 || parts[0] !== "companies" || !isPocketBaseCompanyId(parts[1])) return null;
      return { kind: "query", companyId: parts[1], coll: parts[2], path: parts.join("/"), q: parseQueryImpl(qi) };
    }
  } catch {
    return null; // not understood -> Firestore (unchanged behaviour)
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* in-memory query evaluation                                          */
/* ------------------------------------------------------------------ */

function getField(docData: AnyRec, id: string, field: string[], key: boolean): unknown {
  if (key) return { __ref: id };
  let cur: unknown = docData;
  for (const p of field) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as AnyRec)[p];
  }
  return cur;
}

function isTimestampLike(v: unknown): v is { toMillis: () => number } {
  return !!v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function";
}

/** Firestore type order: null < bool < number < timestamp < string < ref < array < map */
function typeRank(v: unknown): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (isTimestampLike(v) || v instanceof Date) return 3;
  if (typeof v === "string") return 4;
  if (v && typeof v === "object" && "__ref" in (v as AnyRec)) return 5;
  if (Array.isArray(v)) return 6;
  return 7;
}

function cmp(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 0:
      return 0;
    case 1:
      return a === b ? 0 : a ? 1 : -1;
    case 2: {
      const x = a as number;
      const y = b as number;
      if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : -1;
      if (Number.isNaN(y)) return 1;
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case 3: {
      const x = a instanceof Date ? a.getTime() : (a as { toMillis: () => number }).toMillis();
      const y = b instanceof Date ? b.getTime() : (b as { toMillis: () => number }).toMillis();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case 4:
      return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
    case 5: {
      const x = String((a as AnyRec).__ref);
      const y = String((b as AnyRec).__ref);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case 6: {
      const x = a as unknown[];
      const y = b as unknown[];
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = cmp(x[i], y[i]);
        if (c) return c;
      }
      return x.length - y.length;
    }
    default: {
      const x = JSON.stringify(a);
      const y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    }
  }
}

function eq(a: unknown, b: unknown): boolean {
  return typeRank(a) === typeRank(b) && cmp(a, b) === 0;
}

function matchField(f: Extract<ParsedFilter, { type: "field" }>, d: AnyRec, id: string): boolean {
  const v = getField(d, id, f.field, f.key);
  const val = f.value;
  switch (f.op) {
    case "==":
      return v !== undefined && eq(v, val);
    case "!=":
      return v !== undefined && v !== null && !eq(v, val);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (v === undefined || typeRank(v) !== typeRank(val)) return false;
      const c = cmp(v, val);
      return f.op === "<" ? c < 0 : f.op === "<=" ? c <= 0 : f.op === ">" ? c > 0 : c >= 0;
    }
    case "array-contains":
      return Array.isArray(v) && v.some((x) => eq(x, val));
    case "array-contains-any":
      return Array.isArray(v) && Array.isArray(val) && v.some((x) => val.some((y) => eq(x, y)));
    case "in":
      return v !== undefined && Array.isArray(val) && val.some((y) => eq(v, y));
    case "not-in":
      return v !== undefined && v !== null && Array.isArray(val) && !val.some((y) => eq(v, y));
    default:
      throw new Unsupported(`op ${f.op}`);
  }
}

function matchFilter(f: ParsedFilter, d: AnyRec, id: string): boolean {
  if (f.type === "field") return matchField(f, d, id);
  if (f.op === "or") return f.filters.some((x) => matchFilter(x, d, id));
  return f.filters.every((x) => matchFilter(x, d, id));
}

/** Firestore: inequality fields are implicitly ordered after the explicit orderBy; then the doc id. */
function effectiveOrder(q: ParsedQuery): ParsedQuery["orderBy"] {
  const out = q.orderBy.slice();
  const seen = new Set(out.map((o) => o.field.join(".")));
  const lastDir = out.length ? out[out.length - 1].dir : "asc";
  const ineq: { field: string[]; key: boolean }[] = [];
  const walk = (f: ParsedFilter) => {
    if (f.type === "composite") return f.filters.forEach(walk);
    if (["<", "<=", ">", ">=", "!=", "not-in"].includes(f.op)) ineq.push({ field: f.field, key: f.key });
  };
  q.filters.forEach(walk);
  ineq.sort((a, b) => (a.field.join(".") < b.field.join(".") ? -1 : 1));
  for (const f of ineq) {
    const k = f.field.join(".");
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ ...f, dir: lastDir });
    }
  }
  if (!seen.has("__name__")) out.push({ field: ["__name__"], key: true, dir: lastDir });
  return out;
}

function boundCompare(
  bound: { position: unknown[] },
  order: ParsedQuery["orderBy"],
  d: AnyRec,
  id: string
): number {
  for (let i = 0; i < bound.position.length && i < order.length; i++) {
    const o = order[i];
    let c = cmp(bound.position[i], getField(d, id, o.field, o.key));
    if (o.dir === "desc") c = -c;
    if (c) return c;
  }
  return 0;
}

type Row = { id: string; data: AnyRec };

function runQuery(rows: Row[], q: ParsedQuery | null): Row[] {
  if (!q) return rows.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let out = rows.filter((r) => q.filters.every((f) => matchFilter(f, r.data, r.id)));
  const order = effectiveOrder(q);
  // orderBy also filters out docs without the field
  out = out.filter((r) => order.every((o) => o.key || getField(r.data, r.id, o.field, o.key) !== undefined));
  out.sort((a, b) => {
    for (const o of order) {
      let c = cmp(getField(a.data, a.id, o.field, o.key), getField(b.data, b.id, o.field, o.key));
      if (o.dir === "desc") c = -c;
      if (c) return c;
    }
    return 0;
  });
  if (q.startAt) {
    const s = q.startAt;
    out = out.filter((r) => {
      const c = boundCompare(s, order, r.data, r.id);
      return s.inclusive ? c <= 0 : c < 0;
    });
  }
  if (q.endAt) {
    const e = q.endAt;
    out = out.filter((r) => {
      const c = boundCompare(e, order, r.data, r.id);
      return e.inclusive ? c >= 0 : c > 0;
    });
  }
  if (q.limit !== null) out = q.limitToLast ? out.slice(Math.max(0, out.length - q.limit)) : out.slice(0, q.limit);
  return out;
}

/* ------------------------------------------------------------------ */
/* snapshots                                                           */
/* ------------------------------------------------------------------ */

const META = Object.freeze({ hasPendingWrites: false, fromCache: true, isEqual: () => true });

function readPath(data: AnyRec | undefined, field: unknown): unknown {
  let cur: unknown = data;
  const parts = Array.isArray(segmentsOf(field)) ? (segmentsOf(field) as string[]) : String(field).split(".");
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as AnyRec)[part];
  }
  return cur;
}

function makeDocSnapshot(ref: unknown, id: string, data: AnyRec | null, converter?: unknown): AnyRec {
  const stored = data ? { ...data } : undefined;
  const snap: AnyRec = {
    id,
    ref,
    metadata: META,
    exists: () => !!stored,
    get: (field: unknown) => readPath(stored, field),
  };
  const conv = converter as { fromFirestore?: (s: unknown, o?: unknown) => unknown } | null | undefined;
  snap.data = (opts?: unknown) => {
    if (!stored) return undefined;
    if (conv && typeof conv.fromFirestore === "function") {
      return conv.fromFirestore({ ...snap, data: () => ({ ...stored }) }, opts);
    }
    return { ...stored };
  };
  return snap;
}

function docRefFor(companyId: string, coll: string, id: string, converter?: unknown): unknown {
  const r = fsDoc(firestore, "companies", companyId, coll, id);
  return converter ? r.withConverter(converter as never) : r;
}

function stripId(d: AnyRec): AnyRec {
  // mirror rows carry `id`; Firestore data() only has it when the doc stored it. Keep it: the app
  // writes `id` into most docs and readers spread `{ id: d.id, ...d.data() }` either way.
  return d;
}

function makeQuerySnapshot(query: unknown, docs: AnyRec[], prev: Map<string, string> | null): AnyRec {
  let changes: AnyRec[] | null = null;
  const snap: AnyRec = {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    query,
    metadata: META,
    forEach: (cb: (d: unknown) => void, thisArg?: unknown) => docs.forEach((d) => cb.call(thisArg, d)),
    docChanges: () => {
      if (changes) return changes;
      const list: AnyRec[] = [];
      const now = new Map<string, number>();
      docs.forEach((d, i) => now.set(String(d.id), i));
      if (prev) {
        let oi = 0;
        for (const id of prev.keys()) {
          if (!now.has(id)) list.push({ type: "removed", doc: makeDocSnapshot(null, id, null), oldIndex: oi, newIndex: -1 });
          oi++;
        }
      }
      docs.forEach((d, i) => {
        const id = String(d.id);
        if (!prev || !prev.has(id)) list.push({ type: "added", doc: d, oldIndex: -1, newIndex: i });
        else if (prev.get(id) !== (d as { __sig?: string }).__sig) list.push({ type: "modified", doc: d, oldIndex: i, newIndex: i });
      });
      changes = list;
      return list;
    },
  };
  return snap;
}

/* ------------------------------------------------------------------ */
/* PocketBase reads                                                    */
/* ------------------------------------------------------------------ */

async function readDocPb(companyId: string, coll: string, docId: string): Promise<AnyRec | null> {
  const { getCompanyDocFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
  const local = (await getCompanyDocFromBrowserDb(companyId, coll, docId, { includeDeleted: true })) as AnyRec | null;
  if (local) return local;
  try {
    const { pbReadAppDoc } = await import("@/lib/pocketbaseData/pbSync");
    const r = await pbReadAppDoc(companyId, coll, docId);
    return r.exists ? r.data : null;
  } catch {
    return null;
  }
}

async function readCollectionPb(companyId: string, coll: string): Promise<Row[]> {
  const { listCompanyDocsFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
  const docs = (await listCompanyDocsFromBrowserDb(companyId, coll, { includeSoftDeleted: true })) as AnyRec[];
  return docs.map((d) => ({ id: String(d.id || ""), data: d })).filter((r) => r.id);
}

function signature(d: AnyRec): string {
  // cheap change marker for docChanges(): djb2 hash of the stored JSON
  let s = "";
  try {
    s = JSON.stringify(d);
  } catch {
    return String(Date.now());
  }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

async function pbGetDocSnapshot(ref: unknown, t: Extract<PbTarget, { kind: "doc" }>): Promise<unknown> {
  const converter = (ref as { converter?: unknown }).converter || null;
  const data = await readDocPb(t.companyId, t.coll, t.docId);
  return makeDocSnapshot(ref, t.docId, data ? stripId(data) : null, converter);
}

async function pbGetQuerySnapshot(
  query: unknown,
  t: Extract<PbTarget, { kind: "query" }>,
  prev: Map<string, string> | null
): Promise<{ snap: AnyRec; sig: Map<string, string> }> {
  const converter = (query as { converter?: unknown }).converter || null;
  const rows = runQuery(await readCollectionPb(t.companyId, t.coll), t.q);
  const sig = new Map<string, string>();
  const docs = rows.map((r) => {
    const s = makeDocSnapshot(docRefFor(t.companyId, t.coll, r.id, converter), r.id, stripId(r.data), converter);
    const g = signature(r.data);
    s.__sig = g;
    sig.set(r.id, g);
    return s;
  });
  return { snap: makeQuerySnapshot(query, docs, prev), sig };
}

/** Keys that the old Firebase Admin server routes wrote straight into the Firestore root doc.
 *  Nothing merges them from Firestore any more — the server owns them — but the list stays next to
 *  the seam for anyone auditing the root snapshot shape. */
const FIRESTORE_MANAGED_ROOT_KEYS_RE = /^(plan|billing|stripe|demoPlan|subscription|autoDowngrade|previousPlan)/;

/**
 * Company root of a Pocket Ledger Server company — the SERVER COPY IS THE ONLY COPY.
 * Plan / billing keys used to be overlaid from Firestore; server routes now write them straight
 * into `pl_companies.data`, so nothing is merged in from Firebase any more.
 */
/** Keys of this device's registry row that are not part of the company root doc. */
const LOCAL_ONLY_ROOT_KEYS = ["password", "localCompanyUsers", "adminPassword"];

/**
 * Server copy only; when it is not reachable, this device's registry row (passwords removed);
 * else a missing doc.
 */
async function pbGetRootSnapshotServerOnly(ref: unknown, t: Extract<PbTarget, { kind: "root" }>): Promise<unknown> {
  const converter = (ref as { converter?: unknown }).converter || null;
  let data: AnyRec | null = null;
  try {
    const pb = await import("@/lib/pocketbaseData/pbSync").then((m) => m.pbReadCompanyRoot(t.companyId));
    if (pb.exists && pb.data) data = { ...pb.data };
  } catch {
    data = null;
  }
  if (!data) {
    try {
      const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
      const row = await getLocalCompanyById(t.companyId);
      if (row) data = { ...(row as unknown as AnyRec) };
    } catch {
      data = null;
    }
  }
  if (data) for (const k of LOCAL_ONLY_ROOT_KEYS) delete data[k];
  return makeDocSnapshot(ref, t.companyId, data, converter);
}

async function pbGetRootSnapshot(fsFn: Fn, args: unknown[], t: Extract<PbTarget, { kind: "root" }>): Promise<unknown> {
  if (isPocketBaseAppSessionActive()) return pbGetRootSnapshotServerOnly(args[0], t);
  /**
   * Server is the only copy of a PocketBase company root now (Firestore keeps authentication only).
   * It used to be read from both places in parallel and merged, which is exactly what kept a
   * stale Firestore copy alive. `fsFn` stays in the signature so the callers do not need a cast.
   */
  void fsFn;
  const ref = args[0];
  const converter = (ref as { converter?: unknown }).converter || null;
  if (isPocketBaseRootWritePending(t.companyId)) {
    const fresh = await pbGetRootSnapshotServerOnly(ref, t);
    if (fresh) return fresh;
  }
  const pb = await import("@/lib/pocketbaseData/pbSync")
    .then((m) => m.pbReadCompanyRoot(t.companyId))
    .catch(() => null);
  if (pb?.exists && pb.data) {
    const data: AnyRec = { ...pb.data };
    delete data.password;
    return makeDocSnapshot(ref, t.companyId, data, converter);
  }
  // Server has no copy yet (brand-new company): the local registry row is the seed.
  return pbGetRootSnapshotServerOnly(ref, t);
}

/* ------------------------------------------------------------------ */
/* Admin Panel on a server login (super admin)                          */
/* ------------------------------------------------------------------ */
/*
 * Server login + super admin + an Admin Panel page: global paths the company seam does not
 * serve (users, companies, other users' company data, app_settings, ...) are read from the
 * server's read-only admin routes (pb_hooks/lib/admin_view.js) instead of Firestore (which is
 * off for the whole server session). Queries run in memory like the company seam.
 */

/** "admin" = super-admin Admin Panel routes; "user" = the signed-in user's own udoc routes (pb_hooks/lib/udoc.js). */
type GlobalMode = "admin" | "user";

type AdminTarget =
  | { kind: "doc"; path: string; id: string; mode: GlobalMode }
  | { kind: "query"; parent: string; q: ParsedQuery | null; mode: GlobalMode };

/** Non-company document roots served by the server's general document store in a server login. */

/**
 * Non-company document roots live on the server for BOTH logins (Google/Firebase sign-in and the
 * pl_users server sign-in). This must match `udocDocPath` in pbGlobalDocs, otherwise writes would
 * go to the server and reads would still come from a now-stale Firestore copy.
 */
function globalModeFor(parts: string[]): GlobalMode | null {
  if (!parts.length || !USER_GLOBAL_ROOTS.has(parts[0])) return null;
  if (isAdminServerDataActive()) return "admin";
  try {
    if (isPocketBaseAppSessionActive()) return "user";
  } catch {
    /* fall through */
  }
  try {
    return getValidPocketBaseAuth() ? "user" : null;
  } catch {
    return null;
  }
}

function isAdminPanelPage(): boolean {
  try {
    return typeof window !== "undefined" && /\/admin(\/|$)/.test(window.location.pathname);
  } catch {
    return false;
  }
}

/**
 * Write one allow-listed `app_settings/*` doc to the Pocket Ledger Server (main admin only,
 * `/api/pl/admin/set`), then drop the admin read caches so the page re-reads the new value.
 */
async function adminPbRequest(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number }
): Promise<unknown> {
  return pbRequest(path, init);
}

export async function adminServerSetDoc(path: string, data: Record<string, unknown>, merge = true): Promise<void> {
  const { encodeDocForPocketBase } = await import("@/lib/pocketbaseData/pbSync");
  await adminPbRequest("/api/pl/admin/set", {
    method: "POST",
    body: { path, data: encodeDocForPocketBase(data), merge },
    timeoutMs: 30_000,
  });
  adminListCache.clear();
  adminDocCache.clear();
}

/** Server login of a super admin on an Admin Panel page. */
export function isAdminServerDataActive(): boolean {
  if (!isAdminPanelPage()) return false;
  try {
    // Same gate as `globalModeFor`: a server token is enough (a Google login mints one too).
    if (!isPocketBaseAppSessionActive() && !getValidPocketBaseAuth()) return false;
    return isSuperAdminEmail(readPocketBaseAppProfile()?.email);
  } catch {
    return false;
  }
}

function adminTargetOf(refOrQuery: unknown): AdminTarget | null {
  const o = refOrQuery as AnyRec | null;
  if (!o || typeof o !== "object") return null;
  try {
    if (o.type === "document" || o.type === "collection") {
      const parts = String(o.path || "").split("/").filter(Boolean);
      if (!parts.length) return null;
      const m = globalModeFor(parts);
      if (!m) return null;
      if (o.type === "document" && parts.length % 2 === 0) {
        return { kind: "doc", path: parts.join("/"), id: parts[parts.length - 1], mode: m };
      }
      if (o.type === "collection" && parts.length % 2 === 1) return { kind: "query", parent: parts.join("/"), q: null, mode: m };
      return null;
    }
    if (o.type === "query") {
      const qi = o._query as AnyRec | undefined;
      if (!qi || qi.collectionGroup) return null;
      const parts = segmentsOf(qi.path);
      if (!parts || parts.length % 2 !== 1) return null;
      const m = globalModeFor(parts);
      if (!m) return null;
      return { kind: "query", parent: parts.join("/"), q: parseQueryImpl(qi), mode: m };
    }
  } catch {
    return null;
  }
  return null;
}

type AdminRow = { id: string; path: string; data: AnyRec };
const ADMIN_CACHE_MS = 3_000;
const adminListCache = new Map<string, { at: number; p: Promise<AdminRow[]> }>();
const adminDocCache = new Map<string, { at: number; p: Promise<AnyRec | null> }>();

async function decodeAdmin(data: unknown): Promise<AnyRec> {
  const m = await import("@/lib/pocketbaseData/pbSync");
  return m.decodeDocFromPocketBase(data);
}

/** Equality / simple filters the server can apply itself (primitive values only). */
function udocHints(q: ParsedQuery | null): { where: unknown[]; orderBy?: unknown[]; limit?: number } {
  const where: unknown[] = [];
  let complete = true;
  const SERVER_OPS = new Set(["==", "in", "array-contains", "array-contains-any"]);
  const prim = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
  for (const f of q?.filters || []) {
    if (f.type === "field" && !f.key && SERVER_OPS.has(f.op) && (prim(f.value) || (Array.isArray(f.value) && f.value.every(prim)))) {
      where.push([f.field.join("."), f.op, f.value]);
    } else complete = false;
  }
  const out: { where: unknown[]; orderBy?: unknown[]; limit?: number } = { where };
  if (q && complete && !q.startAt && !q.endAt && !q.limitToLast && q.orderBy.length <= 1) {
    if (q.orderBy.length === 1 && !q.orderBy[0].key) out.orderBy = [q.orderBy[0].field.join("."), q.orderBy[0].dir];
    if (q.limit && (q.orderBy.length === 0 || out.orderBy)) out.limit = q.limit;
  }
  return out;
}

function adminList(parent: string, mode: GlobalMode = "admin", q: ParsedQuery | null = null): Promise<AdminRow[]> {
  const hints = mode === "user" ? udocHints(q) : null;
  const cacheKey = mode === "user" ? `u|${parent}|${JSON.stringify(hints)}` : parent;
  const hit = adminListCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.p;
  const p = (async () => {
    const r = (await adminPbRequest(mode === "user" ? "/api/pl/udoc/list" : "/api/pl/admin/list", {
      method: "POST",
      body: mode === "user" ? { parent, ...hints } : { parent },
      timeoutMs: 60_000,
    })) as {
      docs?: { id?: unknown; path?: unknown; data?: unknown }[];
    };
    const out: AdminRow[] = [];
    for (const d of Array.isArray(r?.docs) ? r.docs : []) {
      const id = String(d?.id || "");
      if (!id) continue;
      out.push({ id, path: String(d.path || `${parent}/${id}`), data: await decodeAdmin(d.data) });
    }
    return out;
  })();
  adminListCache.set(cacheKey, { at: Date.now(), p });
  p.catch(() => adminListCache.delete(cacheKey));
  return p;
}

/**
 * Many listeners re-read their own `users/...`, `conversations/...` ... doc at (nearly) the same moment
 * (poll tick, realtime "udoc written" event). One request per doc made the server queue hundreds of
 * `/api/pl/udoc/get` calls at once and the app's 15s request timeout fired ("request timed out").
 * The server already accepts up to 200 paths per call, so docs asked for within a few ms share one request.
 */
const USER_GET_BATCH_MS = 30;
const USER_GET_BATCH_MAX = 100;
type UserGetWaiter = { resolve: (d: AnyRec | null) => void; reject: (e: unknown) => void };
let userGetQueue = new Map<string, UserGetWaiter[]>();
let userGetTimer: ReturnType<typeof setTimeout> | null = null;

function flushUserGets(): void {
  userGetTimer = null;
  const batch = userGetQueue;
  userGetQueue = new Map();
  const paths = Array.from(batch.keys());
  for (let i = 0; i < paths.length; i += USER_GET_BATCH_MAX) {
    const chunk = paths.slice(i, i + USER_GET_BATCH_MAX);
    const rejectAll = (e: unknown) => {
      for (const p of chunk) for (const w of batch.get(p) || []) w.reject(e);
    };
    adminPbRequest("/api/pl/udoc/get", { method: "POST", body: { paths: chunk }, timeoutMs: 30_000 })
      .then(async (r) => {
        const docs = (Array.isArray((r as { docs?: unknown[] } | null)?.docs) ? (r as { docs: unknown[] }).docs : []) as {
          exists?: unknown;
          data?: unknown;
          denied?: unknown;
        }[];
        for (let j = 0; j < chunk.length; j++) {
          const ws = batch.get(chunk[j]) || [];
          const d = docs[j];
          if (d && d.denied === true) {
            const err = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
            for (const w of ws) w.reject(err);
            continue;
          }
          try {
            const out = d && d.exists === true ? await decodeAdmin(d.data) : null;
            for (const w of ws) w.resolve(out);
          } catch (e) {
            for (const w of ws) w.reject(e);
          }
        }
      })
      .catch(rejectAll);
  }
}

function userDocBatched(path: string): Promise<AnyRec | null> {
  return new Promise<AnyRec | null>((resolve, reject) => {
    const ws = userGetQueue.get(path);
    if (ws) ws.push({ resolve, reject });
    else userGetQueue.set(path, [{ resolve, reject }]);
    if (!userGetTimer) userGetTimer = setTimeout(flushUserGets, USER_GET_BATCH_MS);
  });
}

/** Drop the short read caches; calls within 400ms of the last drop share it (many listeners fire together). */
let lastAdminCacheClear = 0;
function clearAdminCaches(): void {
  const n = Date.now();
  if (n - lastAdminCacheClear < 400) return;
  lastAdminCacheClear = n;
  adminListCache.clear();
  adminDocCache.clear();
}

function adminDoc(path: string, mode: GlobalMode = "admin"): Promise<AnyRec | null> {
  const cacheKey = mode === "user" ? `u|${path}` : path;
  const hit = adminDocCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.p;
  if (mode === "user") {
    const pu = userDocBatched(path);
    adminDocCache.set(cacheKey, { at: Date.now(), p: pu });
    pu.catch(() => adminDocCache.delete(cacheKey));
    return pu;
  }
  const p = (async () => {
    const r = (await adminPbRequest("/api/pl/admin/get", {
      method: "POST",
      body: { paths: [path] },
      timeoutMs: 30_000,
    })) as {
      docs?: { exists?: unknown; data?: unknown; denied?: unknown }[];
    };
    const d = Array.isArray(r?.docs) ? r.docs[0] : null;
    if (d && d.denied === true) {
      throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    }
    return d && d.exists === true ? decodeAdmin(d.data) : null;
  })();
  adminDocCache.set(cacheKey, { at: Date.now(), p });
  p.catch(() => adminDocCache.delete(cacheKey));
  return p;
}

function adminRefFor(path: string, converter: unknown): unknown {
  const parts = path.split("/").filter(Boolean);
  const r = fsDoc(firestore, parts[0], ...parts.slice(1));
  return converter ? r.withConverter(converter as never) : r;
}

async function adminGetDocSnapshot(ref: unknown, t: Extract<AdminTarget, { kind: "doc" }>): Promise<AnyRec> {
  const converter = (ref as { converter?: unknown }).converter || null;
  const data = await adminDoc(t.path, t.mode);
  return makeDocSnapshot(ref, t.id, data, converter);
}

async function adminGetQuerySnapshot(
  query: unknown,
  t: Extract<AdminTarget, { kind: "query" }>,
  prev: Map<string, string> | null
): Promise<{ snap: AnyRec; sig: Map<string, string> }> {
  const converter = (query as { converter?: unknown }).converter || null;
  const all = await adminList(t.parent, t.mode, t.q);
  const byId = new Map(all.map((r) => [r.id, r.path]));
  const rows = runQuery(all.map((r) => ({ id: r.id, data: r.data })), t.q);
  const sig = new Map<string, string>();
  const docs = rows.map((r) => {
    const s = makeDocSnapshot(adminRefFor(byId.get(r.id) || `${t.parent}/${r.id}`, converter), r.id, r.data, converter);
    const g = signature(r.data);
    s.__sig = g;
    sig.set(r.id, g);
    return s;
  });
  return { snap: makeQuerySnapshot(query, docs, prev), sig };
}

const ADMIN_POLL_MS = 600_000;
/** SSE down: poll udoc every 60s. SSE up: skip ticks until this 10m fallback. */
const USER_POLL_MS = 60_000;
const USER_POLL_WHEN_LIVE_MS = 600_000;

const userPollers = new Set<() => void>();
let userPollTicker: ReturnType<typeof setInterval> | null = null;
let lastUserPollAt = 0;
function startUserPollTicker(): void {
  if (userPollTicker) return;
  userPollTicker = setInterval(() => {
    const now = Date.now();
    if (isPocketBaseRealtimeLive() && now - lastUserPollAt < USER_POLL_WHEN_LIVE_MS) return;
    lastUserPollAt = now;
    for (const fn of Array.from(userPollers)) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }, USER_POLL_MS);
}
function stopUserPollTickerIfIdle(): void {
  if (userPollers.size === 0 && userPollTicker) {
    clearInterval(userPollTicker);
    userPollTicker = null;
  }
}

/** Admin `onSnapshot`: server read now, on server change events, and every 30s (only changes emit). */
function onAdminSnapshot(args: unknown[], t: AdminTarget): () => void {
  const target = args[0];
  const obs = observerFrom(args);
  let closed = false;
  let running = false;
  let again = false;
  let prevSig: Map<string, string> | null = null;
  let lastKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (t.kind === "query") {
        const r = await adminGetQuerySnapshot(target, t, prevSig);
        const key = Array.from(r.sig.entries()).map(([k, v]) => `${k}=${v}`).join("|");
        prevSig = r.sig;
        if (!closed && key !== lastKey) {
          lastKey = key;
          obs.next?.(r.snap);
        }
      } else {
        const snap = await adminGetDocSnapshot(target, t);
        const raw = (snap.exists as () => boolean)() ? (snap.data as () => unknown)() : null;
        const key = raw ? signature(raw as AnyRec) : "none";
        if (!closed && key !== lastKey) {
          lastKey = key;
          obs.next?.(snap);
        }
      }
    } catch (e) {
      if (!closed) obs.error?.(e);
    } finally {
      running = false;
      if (again && !closed) {
        again = false;
        void emit();
      }
    }
  };
  const schedule = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      clearAdminCaches();
      void emit();
    }, 1_500);
  };
  // General (user-mode) docs live in the server's udoc store: local company-mirror bumps / company-root pulls
  // never change them (writes and server pushes fire "pl-udoc-written"), so only admin-mode listeners follow those.
  const followCompanyEvents = t.mode !== "user";
  let bumpEvent = "";
  if (followCompanyEvents) {
    void import("@/lib/localCompanyDocMirror").then((m) => {
      if (closed) return;
      bumpEvent = m.BROWSER_DB_COLLECTION_BUMP;
      window.addEventListener(bumpEvent, schedule);
    });
    window.addEventListener("pl-pb-company-root-updated", schedule);
  }
  const pollTick = () => {
    if (isPocketBaseRealtimeLive()) return;
    if (typeof document !== "undefined" && document.hidden) return;
    clearAdminCaches();
    void emit();
  };
  let poll: ReturnType<typeof setInterval> | null = null;
  if (t.mode === "user") {
    // one shared ticker for all user-mode listeners so their reads land in the same batched request.
    // While SSE is live, ticks are skipped (pl-udoc-written + 90s fallback); 10s only if the stream is down.
    userPollers.add(pollTick);
    startUserPollTicker();
    lastUserPollAt = Date.now();
  } else {
    poll = setInterval(pollTick, ADMIN_POLL_MS);
  }
  window.addEventListener("pl-udoc-written", schedule);
  void emit();
  return () => {
    closed = true;
    if (poll) clearInterval(poll);
    if (t.mode === "user") {
      userPollers.delete(pollTick);
      stopUserPollTickerIfIdle();
    }
    if (timer) clearTimeout(timer);
    if (followCompanyEvents) window.removeEventListener("pl-pb-company-root-updated", schedule);
    window.removeEventListener("pl-udoc-written", schedule);
    if (bumpEvent) window.removeEventListener(bumpEvent, schedule);
  };
}

/* ------------------------------------------------------------------ */
/* public API (Firestore signatures)                                   */
/* ------------------------------------------------------------------ */

type Fn = (...a: unknown[]) => unknown;

function wrapDocRead(fsFn: Fn, rootFromServer: boolean): Fn {
  return (...args: unknown[]) => {
    const t = noPocketBaseCompanies() ? null : pbTargetOf(args[0]);
    if (!t) {
      const at = adminTargetOf(args[0]);
      if (at && at.kind === "doc") return adminGetDocSnapshot(args[0], at);
    }
    if (!t || t.kind === "query") return fsFn(...args);
    if (t.kind === "root") {
      return rootFromServer || isPocketBaseAppSessionActive() ? pbGetRootSnapshot(fsFn, args, t) : fsFn(...args);
    }
    return pbGetDocSnapshot(args[0], t);
  };
}

function wrapQueryRead(fsFn: Fn): Fn {
  return (...args: unknown[]) => {
    const t = noPocketBaseCompanies() ? null : pbTargetOf(args[0]);
    if (!t) {
      const at = adminTargetOf(args[0]);
      if (at && at.kind === "query") return adminGetQuerySnapshot(args[0], at, null).then((r) => r.snap);
    }
    if (!t || t.kind !== "query") return fsFn(...args);
    return pbGetQuerySnapshot(args[0], t, null).then((r) => r.snap);
  };
}

export const getDoc = wrapDocRead(fsGetDoc as Fn, true) as typeof fsGetDoc;
export const getDocFromServer = wrapDocRead(fsGetDocFromServer as Fn, true) as typeof fsGetDocFromServer;
export const getDocFromCache = wrapDocRead(fsGetDocFromCache as Fn, false) as typeof fsGetDocFromCache;
export const getDocs = wrapQueryRead(fsGetDocs as Fn) as typeof fsGetDocs;
export const getDocsFromServer = wrapQueryRead(fsGetDocsFromServer as Fn) as typeof fsGetDocsFromServer;
export const getDocsFromCache = wrapQueryRead(fsGetDocsFromCache as Fn) as typeof fsGetDocsFromCache;

export const getCountFromServer = ((...args: unknown[]) => {
  const t = noPocketBaseCompanies() ? null : pbTargetOf(args[0]);
  if (!t) {
    const at = adminTargetOf(args[0]);
    if (at && at.kind === "query") {
      return adminGetQuerySnapshot(args[0], at, null).then((r) => {
        const count = r.snap.size as number;
        return { data: () => ({ count }) };
      });
    }
  }
  if (!t || t.kind !== "query") return (fsGetCountFromServer as Fn)(...args);
  return pbGetQuerySnapshot(args[0], t, null).then((r) => {
    const count = r.snap.size as number;
    return { data: () => ({ count }) };
  });
}) as typeof fsGetCountFromServer;

type Observer = { next?: (v: unknown) => void; error?: (e: unknown) => void; complete?: () => void };

function observerFrom(args: unknown[]): Observer {
  let i = 1;
  const a1 = args[1] as AnyRec | undefined;
  // (ref, options, ...) - options object without next/error
  if (a1 && typeof a1 === "object" && typeof a1.next !== "function" && typeof a1.error !== "function" &&
    ("includeMetadataChanges" in a1 || "source" in a1 || Object.keys(a1).length === 0)) {
    i = 2;
  }
  const a = args[i];
  if (a && typeof a === "object") return a as Observer;
  return {
    next: typeof a === "function" ? (a as Observer["next"]) : undefined,
    error: typeof args[i + 1] === "function" ? (args[i + 1] as Observer["error"]) : undefined,
    complete: typeof args[i + 2] === "function" ? (args[i + 2] as Observer["complete"]) : undefined,
  };
}

/** `onSnapshot`: PocketBase company targets re-read the local mirror on every change bump. */
export const onSnapshot = ((...args: unknown[]) => {
  if (typeof window === "undefined") return (fsOnSnapshot as Fn)(...args);
  const t = noPocketBaseCompanies() ? null : pbTargetOf(args[0]);
  if (!t) {
    const at = adminTargetOf(args[0]);
    if (at) return onAdminSnapshot(args, at);
  }
  if (t && t.kind === "root" && isPocketBaseAppSessionActive()) return onRootSnapshotServerOnly(args, t);
  if (!t || t.kind === "root") return (fsOnSnapshot as Fn)(...args);
  const target = args[0];
  const obs = observerFrom(args);
  let closed = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let prevSig: Map<string, string> | null = null;

  const emit = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (t.kind === "query") {
        const r = await pbGetQuerySnapshot(target, t, prevSig);
        prevSig = r.sig;
        if (!closed) obs.next?.(r.snap);
      } else {
        const snap = await pbGetDocSnapshot(target, t);
        if (!closed) obs.next?.(snap);
      }
    } catch (e) {
      if (!closed) obs.error?.(e);
    } finally {
      running = false;
      if (again && !closed) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void emit();
    }, 120);
  };
  const onBump = (ev: Event) => {
    const d = (ev as CustomEvent<{ companyId?: string; collection?: string }>).detail;
    if (!d || d.companyId !== t.companyId) return;
    if (d.collection && d.collection !== t.coll) return;
    schedule();
  };
  let bumpEvent = "";
  void import("@/lib/localCompanyDocMirror").then((m) => {
    if (closed) return;
    bumpEvent = m.BROWSER_DB_COLLECTION_BUMP;
    window.addEventListener(bumpEvent, onBump);
  });
  void emit();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (bumpEvent) window.removeEventListener(bumpEvent, onBump);
  };
}) as typeof fsOnSnapshot;

/** Server login: root `onSnapshot` = server read now, on root-updated events, and every 60s. */
function onRootSnapshotServerOnly(args: unknown[], t: Extract<PbTarget, { kind: "root" }>): () => void {
  const obs = observerFrom(args);
  let closed = false;
  let running = false;
  let again = false;
  let lastSig = "";
  const emit = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const snap = (await pbGetRootSnapshotServerOnly(args[0], t)) as AnyRec;
      const raw = (snap.exists as () => boolean)() ? (snap.data as () => unknown)() : null;
      const sig = raw ? signature(raw as AnyRec) : "none";
      if (!closed && sig !== lastSig) {
        lastSig = sig;
        obs.next?.(snap);
      }
    } catch (e) {
      if (!closed) obs.error?.(e);
    } finally {
      running = false;
      if (again && !closed) {
        again = false;
        void emit();
      }
    }
  };
  const onRoot = (ev: Event) => {
    const d = (ev as CustomEvent<{ companyId?: string }>).detail;
    if (d && d.companyId && d.companyId !== t.companyId) return;
    void emit();
  };
  window.addEventListener("pl-pb-company-root-updated", onRoot);
  const poll = setInterval(() => {
    if (isPocketBaseRealtimeLive()) return;
    if (typeof document !== "undefined" && document.hidden) return;
    void emit();
  }, 600_000);
  void emit();
  return () => {
    closed = true;
    clearInterval(poll);
    window.removeEventListener("pl-pb-company-root-updated", onRoot);
  };
}

/** test hook: in-memory query evaluation */
export const __pbReadSeamTest = { pbTargetOf, runQuery, pbGetRootSnapshot, onRootSnapshotServerOnly };
