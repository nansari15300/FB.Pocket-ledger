import "server-only";

import { randomBytes } from "crypto";
import admin from "firebase-admin";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import { pocketBaseServerUrlForApi } from "@/lib/localCloudSync/server/pbBearerAuth";

/**
 * Plan / billing documents on the Pocket Ledger Server (PocketBase), for server companies.
 *
 * The billing code was written for the Firestore Admin SDK; this is a small Firestore-like
 * adapter over the server's key-gated billing endpoints (`/api/pl/billing/get|query|commit`,
 * pb_hooks/lib/billing_api.js), so the same code runs against either store:
 *   collection / doc / where("==" | "array-contains") / orderBy / limit / get,
 *   DocumentReference get / set (merge) / update / create / delete, batch(), runTransaction().
 * Values: FieldValue (serverTimestamp, delete, increment, arrayUnion, arrayRemove) and
 * Timestamp / Date are sent in the same JSON form as the app sync; reads give Timestamps back.
 *
 * Supported on the server: companies/{id} (+ payments, subscription_history), users/{uid}
 * (+ billing_payments), app_settings/*, pending_* checkout docs. app_settings reads fall back to
 * Firebase while a setting is not saved on the server. Other roots (the admin panel accounting
 * mirror) go to Firebase when it is configured, else they fail.
 *
 * Auth: header X-PL-Hosting-Key = PL_HOSTING_KEY (the app link key from Hosting settings).
 */

export const PB_BILLING_KEY_ENV = "PL_HOSTING_KEY";
const SERVER_ROOTS = new Set([
  "companies",
  "users",
  "app_settings",
  "pending_subscription_checkouts",
  "pending_plan_changes",
  "pending_addon_purchases",
  "ad_wallets",
]);
const FALLBACK_READ_ROOTS = new Set(["app_settings"]);
const TX_ATTEMPTS = 5;
const MAX_BATCH = 500;

type Json = unknown;
type FieldOp = { path: string; op: "serverTime" | "delete" | "inc" | "union" | "remove"; value?: Json };
type WireDoc = { path: string; id?: string; exists?: boolean; data?: Record<string, Json>; version: string | null };
type WriteOp = "set" | "merge" | "update" | "create" | "delete";
type Write = { path: string; op: WriteOp; data?: Record<string, Json>; fieldOps?: FieldOp[] };

export type PbBillingTransport = (endpoint: "get" | "query" | "commit", body: unknown) => Promise<{ status: number; json: any }>;

export class PbBillingError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "PbBillingError";
  }
}

/** Link key for the server billing endpoints (env only, never logged). */
export function pbBillingKey(): string {
  return String(process.env[PB_BILLING_KEY_ENV] ?? "").trim();
}

/** True when the app can reach the server billing endpoints (link key set). */
export function pbBillingReady(): boolean {
  return pbBillingKey().length >= 24;
}

function defaultTransport(): PbBillingTransport {
  return async (endpoint, body) => {
    const key = pbBillingKey();
    if (key.length < 24) {
      throw new PbBillingError(14, "Server billing is not linked: set PL_HOSTING_KEY (Hosting settings > App link key).");
    }
    const res = await fetch(`${pocketBaseServerUrlForApi()}/api/pl/billing/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PL-Hosting-Key": key },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };
}

// ---------- values ----------

function fvKind(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  if (!(v instanceof admin.firestore.FieldValue)) return null;
  const name = String((v as { methodName?: unknown }).methodName || "");
  if (name) return name.replace(/^FieldValue\./, "");
  if (v.isEqual(admin.firestore.FieldValue.delete())) return "delete";
  if (v.isEqual(admin.firestore.FieldValue.serverTimestamp())) return "serverTimestamp";
  return "unknown";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function tsJson(seconds: number, nanoseconds: number) {
  return { __fsTs: true, seconds, nanoseconds };
}

/** App value -> JSON; FieldValues found at `path` go to `ops` (null ops = not allowed here). */
export function encodeValue(v: unknown, path: string, ops: FieldOp[] | null): Json {
  if (v === undefined) return undefined;
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof admin.firestore.Timestamp) return tsJson(v.seconds, v.nanoseconds);
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? tsJson(Math.floor(ms / 1000), (((ms % 1000) + 1000) % 1000) * 1e6) : null;
  }
  const kind = fvKind(v);
  if (kind) {
    if (!ops || !path) throw new PbBillingError(3, `FieldValue.${kind} is not allowed here`);
    const any = v as unknown as { operand?: unknown; elements?: unknown[] };
    switch (kind) {
      case "delete":
        ops.push({ path, op: "delete" });
        break;
      case "serverTimestamp":
        ops.push({ path, op: "serverTime" });
        break;
      case "increment":
        ops.push({ path, op: "inc", value: Number(any.operand) });
        break;
      case "arrayUnion":
        ops.push({ path, op: "union", value: (any.elements || []).map((x) => encodeValue(x, "", null)) });
        break;
      case "arrayRemove":
        ops.push({ path, op: "remove", value: (any.elements || []).map((x) => encodeValue(x, "", null)) });
        break;
      default:
        throw new PbBillingError(3, `Unsupported FieldValue at ${path}`);
    }
    return undefined;
  }
  if (Array.isArray(v)) return v.map((x) => encodeValue(x, "", null) ?? null);
  if (typeof v === "object") {
    const ts = v as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown; toMillis?: unknown };
    if (typeof ts.toMillis === "function" && typeof (ts.seconds ?? ts._seconds) === "number") {
      return tsJson(Number(ts.seconds ?? ts._seconds), Number(ts.nanoseconds ?? ts._nanoseconds) || 0);
    }
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const e = encodeValue(x, path ? `${path}.${k}` : k, ops);
      if (e !== undefined) out[k] = e;
    }
    return out;
  }
  return null;
}

function encodeData(data: Record<string, unknown>, ops: FieldOp[], dotted: boolean): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(data || {})) {
    // update(): dotted keys address nested fields; set(): keys are plain field names
    const path = k;
    if (!dotted && k.includes(".")) throw new PbBillingError(3, `Field name with a dot is not supported: ${k}`);
    const e = encodeValue(v, path, ops);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

export function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === "object") {
    const o = v as { __fsTs?: unknown; seconds?: unknown; nanoseconds?: unknown };
    if (o.__fsTs === true && typeof o.seconds === "number") {
      return new admin.firestore.Timestamp(o.seconds, Math.max(0, Math.min(999999999, Number(o.nanoseconds) || 0)));
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = decodeValue(x);
    return out;
  }
  return v;
}

function getField(data: Record<string, unknown> | undefined, field: string): unknown {
  let cur: unknown = data;
  for (const p of field.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function checkPath(path: string, wantDoc: boolean): string[] {
  const s = String(path || "").split("/").filter((x) => x.length > 0);
  if (!s.length || (s.length % 2 === 0) !== wantDoc) {
    throw new PbBillingError(3, `Bad ${wantDoc ? "document" : "collection"} path: ${path}`);
  }
  return s;
}

function serverError(status: number, json: any, what: string): PbBillingError {
  const code = String(json?.code || "");
  const msg = String(json?.message || `server billing ${what} failed (HTTP ${status})`);
  if (code === "not_found" || status === 404) return new PbBillingError(5, `5 NOT_FOUND: ${msg}`);
  if (code === "already_exists") return new PbBillingError(6, `6 ALREADY_EXISTS: ${msg}`);
  if (code === "aborted") return new PbBillingError(10, `10 ABORTED: ${msg}`);
  if (status === 403) return new PbBillingError(7, `7 PERMISSION_DENIED: ${msg}`);
  if (status >= 500) return new PbBillingError(14, `14 UNAVAILABLE: ${msg}`);
  return new PbBillingError(3, `3 INVALID_ARGUMENT: ${msg}`);
}

// ---------- snapshots ----------

class PbDocSnap {
  readonly id: string;
  readonly ref: PbDocRef;
  readonly exists: boolean;
  private readonly _data: Record<string, unknown> | undefined;
  readonly createTime = undefined;
  readonly updateTime = undefined;
  readonly readTime: admin.firestore.Timestamp;
  constructor(ref: PbDocRef, data: Record<string, unknown> | undefined) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this._data = data;
    this.readTime = admin.firestore.Timestamp.now();
  }
  data(): Record<string, unknown> | undefined {
    return this._data === undefined ? undefined : (decodeValue(this._data) as Record<string, unknown>);
  }
  get(field: string): unknown {
    return this._data === undefined ? undefined : decodeValue(getField(this._data, field));
  }
}

class PbQuerySnap {
  readonly docs: PbDocSnap[];
  constructor(docs: PbDocSnap[]) {
    this.docs = docs;
  }
  get empty() {
    return this.docs.length === 0;
  }
  get size() {
    return this.docs.length;
  }
  forEach(cb: (d: PbDocSnap) => void) {
    this.docs.forEach(cb);
  }
}

// ---------- refs / queries ----------

const AUTO_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 20-character id like Firestore's auto ids. */
function autoId(): string {
  const b = randomBytes(40);
  let out = "";
  for (let i = 0; i < b.length && out.length < 20; i++) {
    if (b[i] < 248) out += AUTO_ID_CHARS[b[i] % 62];
  }
  return out.length === 20 ? out : autoId();
}

type Where = [string, string, Json];

class PbQuery {
  constructor(
    protected readonly db: PbBillingFirestore,
    readonly path: string,
    protected readonly wheres: Where[] = [],
    protected readonly order: [string, "asc" | "desc"] | null = null,
    protected readonly lim: number | null = null
  ) {}
  where(field: unknown, op: string, value: unknown): PbQuery {
    const f = String(field);
    if (!/^[A-Za-z0-9_]{1,100}$/.test(f)) throw new PbBillingError(3, `Unsupported where field: ${f}`);
    if (op !== "==" && op !== "array-contains") throw new PbBillingError(3, `Unsupported where op: ${op}`);
    if (!["string", "number", "boolean"].includes(typeof value)) throw new PbBillingError(3, "Unsupported where value");
    return new PbQuery(this.db, this.path, [...this.wheres, [f, op, value as Json]], this.order, this.lim);
  }
  orderBy(field: unknown, dir: "asc" | "desc" = "asc"): PbQuery {
    // FieldPath.documentId() = the default order (by id)
    if (field instanceof admin.firestore.FieldPath) return new PbQuery(this.db, this.path, this.wheres, null, this.lim);
    const f = String(field);
    if (!/^[A-Za-z0-9_]{1,100}$/.test(f)) throw new PbBillingError(3, `Unsupported orderBy field: ${f}`);
    return new PbQuery(this.db, this.path, this.wheres, [f, dir === "desc" ? "desc" : "asc"], this.lim);
  }
  limit(n: number): PbQuery {
    return new PbQuery(this.db, this.path, this.wheres, this.order, Math.max(1, Math.min(500, Math.floor(n))));
  }
  async get(): Promise<PbQuerySnap> {
    const r = await this.db._call("query", {
      parent: this.path,
      where: this.wheres,
      orderBy: this.order,
      limit: this.lim ?? 500,
    });
    const docs = ((r.docs || []) as WireDoc[]).map(
      (w) => new PbDocSnap(new PbDocRef(this.db, w.path), (w.data || {}) as Record<string, unknown>)
    );
    return new PbQuerySnap(docs);
  }
}

export class PbCollectionRef extends PbQuery {
  readonly id: string;
  constructor(db: PbBillingFirestore, path: string) {
    super(db, checkPath(path, false).join("/"));
    this.id = this.path.split("/").pop() || "";
  }
  doc(id?: string): PbDocRef {
    const docId = id && String(id).trim() ? String(id) : autoId();
    return new PbDocRef(this.db, `${this.path}/${docId}`);
  }
  async add(data: Record<string, unknown>): Promise<PbDocRef> {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

export class PbDocRef {
  readonly path: string;
  readonly id: string;
  constructor(private readonly db: PbBillingFirestore, path: string) {
    this.path = checkPath(path, true).join("/");
    this.id = this.path.split("/").pop() || "";
  }
  get parent(): PbCollectionRef {
    return new PbCollectionRef(this.db, this.path.split("/").slice(0, -1).join("/"));
  }
  collection(name: string): PbCollectionRef {
    return new PbCollectionRef(this.db, `${this.path}/${name}`);
  }
  async get(): Promise<PbDocSnap> {
    return (await this.db._getDocs([this]))[0].snap;
  }
  async set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
    await this.db._commit([toWrite(this, opts?.merge ? "merge" : "set", data)], []);
  }
  async update(data: Record<string, unknown>): Promise<void> {
    await this.db._commit([toWrite(this, "update", data)], []);
  }
  async create(data: Record<string, unknown>): Promise<void> {
    await this.db._commit([toWrite(this, "create", data)], []);
  }
  async delete(): Promise<void> {
    await this.db._commit([{ path: this.path, op: "delete" }], []);
  }
}

function toWrite(ref: PbDocRef, op: WriteOp, data?: Record<string, unknown>): Write {
  if (op === "delete") return { path: ref.path, op };
  const fieldOps: FieldOp[] = [];
  const enc = encodeData(data || {}, fieldOps, op === "update");
  if (op !== "merge" && op !== "update" && fieldOps.some((f) => f.op === "delete")) {
    throw new PbBillingError(3, "FieldValue.delete() needs set(..., {merge:true}) or update()");
  }
  return { path: ref.path, op, data: enc, fieldOps };
}

type AnyRef = PbDocRef | admin.firestore.DocumentReference;

class PbBatch {
  private pb: Write[] = [];
  private fb: admin.firestore.WriteBatch | null = null;
  private committed = false;
  constructor(private readonly db: PbBillingFirestore) {}
  private fbBatch(): admin.firestore.WriteBatch {
    if (!this.fb) this.fb = getAdminDb().batch();
    return this.fb;
  }
  private add(ref: AnyRef, op: WriteOp, data?: Record<string, unknown>) {
    if (this.committed) throw new PbBillingError(9, "Batch already committed");
    if (ref instanceof PbDocRef) {
      this.pb.push(toWrite(ref, op, data));
      if (this.pb.length > MAX_BATCH) throw new PbBillingError(3, "Batch too large");
      return;
    }
    const b = this.fbBatch();
    if (op === "delete") b.delete(ref);
    else if (op === "update") b.update(ref, data as admin.firestore.UpdateData<admin.firestore.DocumentData>);
    else if (op === "create") b.create(ref, data as admin.firestore.DocumentData);
    else b.set(ref, data as admin.firestore.DocumentData, { merge: op === "merge" });
  }
  set(ref: AnyRef, data: Record<string, unknown>, opts?: { merge?: boolean }) {
    this.add(ref, opts?.merge ? "merge" : "set", data);
    return this;
  }
  update(ref: AnyRef, data: Record<string, unknown>) {
    this.add(ref, "update", data);
    return this;
  }
  create(ref: AnyRef, data: Record<string, unknown>) {
    this.add(ref, "create", data);
    return this;
  }
  delete(ref: AnyRef) {
    this.add(ref, "delete");
    return this;
  }
  async commit(): Promise<unknown[]> {
    this.committed = true;
    if (this.pb.length) await this.db._commit(this.pb, []);
    if (this.fb) await this.fb.commit();
    return [];
  }
}

class PbTransaction {
  readonly writes: Write[] = [];
  readonly checks = new Map<string, string | null>();
  constructor(private readonly db: PbBillingFirestore) {}
  async get(target: PbDocRef | PbQuery): Promise<any> {
    if (this.writes.length) throw new PbBillingError(3, "Transactions need all reads before writes");
    if (target instanceof PbDocRef) {
      const [r] = await this.db._getDocs([target]);
      this.checks.set(target.path, r.version);
      return r.snap;
    }
    if (target instanceof PbQuery) {
      const snap = await target.get();
      return snap;
    }
    throw new PbBillingError(3, "This transaction can only read server billing documents");
  }
  async getAll(...refs: PbDocRef[]): Promise<PbDocSnap[]> {
    const rs = await this.db._getDocs(refs);
    rs.forEach((r, i) => this.checks.set(refs[i].path, r.version));
    return rs.map((r) => r.snap);
  }
  private ref(ref: unknown): PbDocRef {
    if (!(ref instanceof PbDocRef)) throw new PbBillingError(3, "This transaction can only write server billing documents");
    return ref;
  }
  set(ref: PbDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) {
    this.writes.push(toWrite(this.ref(ref), opts?.merge ? "merge" : "set", data));
    return this;
  }
  update(ref: PbDocRef, data: Record<string, unknown>) {
    this.writes.push(toWrite(this.ref(ref), "update", data));
    return this;
  }
  create(ref: PbDocRef, data: Record<string, unknown>) {
    this.writes.push(toWrite(this.ref(ref), "create", data));
    return this;
  }
  delete(ref: PbDocRef) {
    this.writes.push({ path: this.ref(ref).path, op: "delete" });
    return this;
  }
}

export class PbBillingFirestore {
  readonly plStore = "server" as const;
  private readonly transport: PbBillingTransport;
  constructor(transport?: PbBillingTransport) {
    this.transport = transport ?? defaultTransport();
  }

  /** Root not kept on the server -> Firebase (admin panel accounting mirror), when configured. */
  private firebaseFor(root: string): admin.firestore.Firestore {
    if (!isFirebaseAdminConfigured()) {
      throw new PbBillingError(9, `"${root}" is not stored on the Pocket Ledger Server and Firebase is not configured`);
    }
    return getAdminDb();
  }

  collection(path: string): any {
    const root = checkPath(path, false)[0];
    if (!SERVER_ROOTS.has(root)) return this.firebaseFor(root).collection(path);
    return new PbCollectionRef(this, path);
  }
  doc(path: string): any {
    const root = checkPath(path, true)[0];
    if (!SERVER_ROOTS.has(root)) return this.firebaseFor(root).doc(path);
    return new PbDocRef(this, path);
  }
  batch(): any {
    return new PbBatch(this);
  }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    let last: unknown = null;
    for (let attempt = 1; attempt <= TX_ATTEMPTS; attempt++) {
      const tx = new PbTransaction(this);
      const out = await fn(tx);
      try {
        const checks = [...tx.checks.entries()].map(([path, version]) => ({ path, version }));
        if (tx.writes.length) await this._commit(tx.writes, checks);
        return out;
      } catch (e) {
        last = e;
        if (!(e instanceof PbBillingError) || e.code !== 10) throw e;
        await new Promise((r) => setTimeout(r, 60 * attempt));
      }
    }
    throw last;
  }

  /** @internal */
  async _call(endpoint: "get" | "query" | "commit", body: unknown): Promise<any> {
    let r: { status: number; json: any };
    try {
      r = await this.transport(endpoint, body);
    } catch (e) {
      if (e instanceof PbBillingError) throw e;
      throw new PbBillingError(14, `14 UNAVAILABLE: Pocket Ledger Server not reachable (${e instanceof Error ? e.message : String(e)})`);
    }
    if (r.status !== 200 || !r.json || r.json.ok !== true) throw serverError(r.status, r.json, endpoint);
    return r.json;
  }

  /** @internal */
  async _getDocs(refs: PbDocRef[]): Promise<{ snap: PbDocSnap; version: string | null }[]> {
    if (!refs.length) return [];
    const r = await this._call("get", { paths: refs.map((x) => x.path) });
    const docs = (r.docs || []) as WireDoc[];
    const out: { snap: PbDocSnap; version: string | null }[] = [];
    for (let i = 0; i < refs.length; i++) {
      const w = docs[i];
      const ref = refs[i];
      if (w && w.exists) {
        out.push({ snap: new PbDocSnap(ref, (w.data || {}) as Record<string, unknown>), version: w.version ?? null });
        continue;
      }
      // global settings not saved on the server yet -> Firebase copy (read only)
      const root = ref.path.split("/")[0];
      if (FALLBACK_READ_ROOTS.has(root) && isFirebaseAdminConfigured()) {
        try {
          const fs = await getAdminDb().doc(ref.path).get();
          if (fs.exists) {
            const enc = encodeValue(fs.data() || {}, "", null) as Record<string, unknown>;
            out.push({ snap: new PbDocSnap(ref, enc), version: null });
            continue;
          }
        } catch {
          /* Firebase read failed: treat as missing */
        }
      }
      out.push({ snap: new PbDocSnap(ref, undefined), version: null });
    }
    return out;
  }

  /** @internal */
  async _commit(writes: Write[], checks: { path: string; version: string | null }[]): Promise<void> {
    if (!writes.length) return;
    await this._call("commit", { writes, checks });
  }
}

let shared: PbBillingFirestore | null = null;

/** Firestore-shaped handle for server companies (cast so existing billing helpers accept it). */
export function pbBillingDb(): admin.firestore.Firestore {
  if (!shared) shared = new PbBillingFirestore();
  return shared as unknown as admin.firestore.Firestore;
}

export function isPbBillingDb(db: unknown): boolean {
  return db instanceof PbBillingFirestore;
}
