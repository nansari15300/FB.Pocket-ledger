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
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import {
  isPocketBaseCompanyId,
  isPocketBaseRootWritePending,
  listPocketBaseCompanyIds,
} from "@/lib/pocketbaseData/pbCompanyRegistry";
import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";


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

/** Root fields written by server routes (Firebase Admin) straight to Firestore. */
function isFirestoreManagedRootKey(k: string): boolean {
  return /^(plan|billing|stripe|demoPlan|subscription|autoDowngrade|previousPlan)/.test(k);
}

/**
 * Company root of a Pocket Ledger Server company: server copy (no plaintext passwords), plan /
 * billing keys overlaid from Firestore. Falls back to the Firestore read when the server copy is
 * not usable.
 */
/** Keys of this device's registry row that are not part of the company root doc. */
const LOCAL_ONLY_ROOT_KEYS = ["password", "localCompanyUsers", "adminPassword"];

/**
 * Server login (no Firebase session): server copy only; when it is not reachable, this device's
 * registry row (passwords removed); else a missing doc.
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
  if (isPocketBaseRootWritePending(t.companyId)) return fsFn(...args);
  const ref = args[0];
  const [pbRes, fsRes] = await Promise.allSettled([
    import("@/lib/pocketbaseData/pbSync").then((m) => m.pbReadCompanyRoot(t.companyId)),
    Promise.resolve().then(() => fsFn(...args)),
  ]);
  const pb = pbRes.status === "fulfilled" ? pbRes.value : null;
  if (!pb || !pb.exists || !pb.data || isPocketBaseRootWritePending(t.companyId)) {
    if (fsRes.status === "fulfilled") return fsRes.value;
    throw fsRes.reason;
  }
  const data: AnyRec = { ...pb.data };
  delete data.password;
  if (fsRes.status === "fulfilled") {
    const fsSnap = fsRes.value as { exists?: () => boolean; data?: () => unknown };
    const fsData = fsSnap?.exists?.() ? (fsSnap.data?.() as AnyRec | undefined) : undefined;
    if (fsData && typeof fsData === "object") {
      for (const k of Object.keys(data)) if (isFirestoreManagedRootKey(k) && !(k in fsData)) delete data[k];
      for (const k of Object.keys(fsData)) if (isFirestoreManagedRootKey(k)) data[k] = fsData[k];
    }
  }
  const converter = (ref as { converter?: unknown }).converter || null;
  return makeDocSnapshot(ref, t.companyId, data, converter);
}

/* ------------------------------------------------------------------ */
/* public API (Firestore signatures)                                   */
/* ------------------------------------------------------------------ */

type Fn = (...a: unknown[]) => unknown;

function wrapDocRead(fsFn: Fn, rootFromServer: boolean): Fn {
  return (...args: unknown[]) => {
    if (noPocketBaseCompanies()) return fsFn(...args);
    const t = pbTargetOf(args[0]);
    if (!t || t.kind === "query") return fsFn(...args);
    if (t.kind === "root") {
      return rootFromServer || isPocketBaseAppSessionActive() ? pbGetRootSnapshot(fsFn, args, t) : fsFn(...args);
    }
    return pbGetDocSnapshot(args[0], t);
  };
}

function wrapQueryRead(fsFn: Fn): Fn {
  return (...args: unknown[]) => {
    if (noPocketBaseCompanies()) return fsFn(...args);
    const t = pbTargetOf(args[0]);
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
  if (noPocketBaseCompanies()) return (fsGetCountFromServer as Fn)(...args);
  const t = pbTargetOf(args[0]);
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
  if (noPocketBaseCompanies() || typeof window === "undefined") return (fsOnSnapshot as Fn)(...args);
  const t = pbTargetOf(args[0]);
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
  const poll = setInterval(() => void emit(), 60_000);
  void emit();
  return () => {
    closed = true;
    clearInterval(poll);
    window.removeEventListener("pl-pb-company-root-updated", onRoot);
  };
}

/** test hook: in-memory query evaluation */
export const __pbReadSeamTest = { pbTargetOf, runQuery, pbGetRootSnapshot, onRootSnapshotServerOnly };
