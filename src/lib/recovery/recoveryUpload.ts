"use client";

/**
 * Recovery mode: push one company from this PC's SQLite to the Pocket Ledger Server.
 * Same steps as the backup-restore upload (pbRestoreUpload): company root -> attachments
 * (`local:` -> `pbatt:`) -> every record in small batches; then a count check.
 *
 * Differences: the server main admin does the upload through /api/pl/recovery/* so the company
 * is owned by the ORIGINAL owner email (a placeholder server account when that person has none
 * yet), members keep their emails and roles, and this PC's SQLite is only read (never changed).
 * Re-running is safe: the server upserts by app ids, and finished batches are remembered on this
 * PC so a stopped / failed push resumes where it was.
 *
 * Checkpoint (per company + server): localStorage "pl_recovery_resume_v1", key "<server url>|<company id>".
 * After every finished batch it stores the batch count, records sent and the running new/updated/same
 * totals, so a push cut by Stop, a network drop or closing the app continues from the next batch
 * (also after an app restart). If the company's records changed in between, it starts from the
 * beginning again (safe: upserts by app id). Passwords are never stored in the checkpoint.
 */

import {
  getValidPocketBaseAuth,
  pbFormRequest,
  pbRequest,
  PocketBaseRequestError,
} from "@/lib/pocketbaseData/pbClient";
import { encodeDocForPocketBase } from "@/lib/pocketbaseData/pbSync";
import { replaceRefsDeep } from "@/lib/pocketbaseData/pbAttachments";
import { ONLINE_DATA_SERVER_POCKETBASE_ID } from "@/lib/onlineDataServer";
import { pocketLedgerStorageDocFields } from "@/lib/firebaseStoragePaths";
import { readCompanyDocs, type RecoveryCompany, type RecoveryDoc } from "@/lib/recovery/recoveryReader";

const UPLOADED_KEY = "pl_recovery_uploaded_v1";
const RESUME_KEY = "pl_recovery_resume_v1";
const BATCH_MAX_DOCS = 200;
const BATCH_MAX_CHARS = 3_000_000;
const REQ_TIMEOUT_MS = 120_000;

/** Device-only markers that must not go to the server copy. */
const LOCAL_ONLY_KEYS = [
  "localCompanyUsers",
  "localOnly",
  "firestoreSyncDisabled",
  "localPersistence",
  "plServerShared",
  "plServerGateId",
  "plServerGateServerUrl",
  "plServerHostCompanyId",
  "authoritativeCompanyId",
  "syncedFromCloud",
  "isOwned",
  "passwordHash",
  "adminUsername",
];

export type RecoveryPhase = "company" | "records" | "verify" | "done";
export type RecoveryProgress = { phase: RecoveryPhase; label: string; done: number; total: number };

export type RecoveryUploadedMark = {
  atMs: number;
  records: number;
  files: number;
  missingFiles: number;
  ownerEmail: string;
  members: number;
};

export type RecoveryPushResult = RecoveryUploadedMark & {
  created: number;
  updated: number;
  same: number;
  keptServer: number;
  unsupported: number;
  /** Records the server could not take (bad data). */
  failedRecords: number;
  tooBigFiles: number;
  countMismatch: Array<{ coll: string; source: number; server: number }>;
  resumedFromBatch: number;
};

/** Server said no for a reason the admin must fix (owner email, company owned by someone else...). */
export class RecoveryConflictError extends Error {
  code: string;
  constructor(code: string) {
    super(conflictMessage(code));
    this.name = "RecoveryConflictError";
    this.code = code;
  }
}

export function conflictMessage(code: string): string {
  switch (code) {
    case "owner_email_missing":
      return "This company has no owner email on this PC. Enter the owner's email and push again.";
    case "owner_uid_email_mismatch":
    case "owner_email_has_other_uid":
      return "The owner email belongs to a different account on the server. Check the owner email.";
    case "company_exists_with_other_owner":
      return "This company is already on the server with a different owner. It was not changed.";
    default:
      return `The server did not accept this company (${code}).`;
  }
}

/** Plain-English text for any push error. */
export function recoveryErrorMessage(err: unknown): string {
  if (err instanceof RecoveryConflictError) return err.message;
  if (err instanceof DOMException && err.name === "AbortError") return "Stopped. Press Retry to continue.";
  if (err instanceof PocketBaseRequestError) {
    if (err.status === 401) return "Your server sign-in has ended. Sign in to the server again, then press Retry.";
    if (err.status === 403) return "This account is not the server's main admin, so recovery upload is not allowed.";
    if (err.status === 0 || err.status >= 500) return "The Pocket Ledger Server could not be reached. Check the server, then press Retry.";
    return `The server refused the upload (${err.status}). Press Retry, or check the server log.`;
  }
  const m = err instanceof Error ? err.message : String(err || "");
  return m || "Upload failed. Press Retry.";
}

function serverUrl(): string {
  return getValidPocketBaseAuth()?.url || "";
}

function markKey(companyId: string, url = serverUrl()): string {
  return `${url}|${companyId}`;
}

function readMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeMapEntry<T>(key: string, k: string, v: T | null): void {
  if (typeof window === "undefined") return;
  try {
    const m = readMap<T>(key);
    if (v === null) delete m[k];
    else m[k] = v;
    window.localStorage.setItem(key, JSON.stringify(m));
  } catch {
    /* storage full: marks are only a convenience */
  }
}

/** Uploaded marks for the given server (default: the signed-in one). */
export function readUploadedMarks(url?: string): Record<string, RecoveryUploadedMark> {
  const base = url ?? serverUrl();
  const out: Record<string, RecoveryUploadedMark> = {};
  for (const [k, v] of Object.entries(readMap<RecoveryUploadedMark>(UPLOADED_KEY))) {
    const i = k.lastIndexOf("|");
    if (i > 0 && k.slice(0, i) === base) out[k.slice(i + 1)] = v;
  }
  return out;
}

type ResumeSum = { create: number; update: number; same: number; kept_server: number; unsupported: number; bad: number };

type ResumeMark = {
  sig: string;
  doneBatches: number;
  atMs: number;
  /** records already sent (older marks may not have it) */
  sent?: number;
  total?: number;
  sum?: ResumeSum;
  files?: { files: number; missing: number; tooBig: number };
};

/** Unfinished push (batches already on the server) for this company, if any. */
export function readResumeMark(
  companyId: string
): { doneBatches: number; sent: number; total: number; atMs: number } | null {
  const m = readMap<ResumeMark>(RESUME_KEY)[markKey(companyId)];
  return m && m.doneBatches > 0
    ? { doneBatches: m.doneBatches, sent: Number(m.sent) || 0, total: Number(m.total) || 0, atMs: Number(m.atMs) || 0 }
    : null;
}

/** GET /api/pl/recovery/check: is the signed-in server account the main admin? */
export async function checkRecoveryAccess(): Promise<{ ok: boolean; email: string; reason?: string }> {
  if (!getValidPocketBaseAuth()) return { ok: false, email: "", reason: "not_signed_in" };
  try {
    const r = (await pbRequest("/api/pl/recovery/check", { method: "GET" })) as { ok?: boolean; email?: string };
    return { ok: r?.ok === true, email: String(r?.email || "") };
  } catch (e) {
    const st = e instanceof PocketBaseRequestError ? e.status : 0;
    return { ok: false, email: "", reason: st === 403 ? "not_admin" : st === 401 ? "not_signed_in" : "offline" };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
}

function transient(e: unknown): boolean {
  if (!(e instanceof PocketBaseRequestError)) return !(e instanceof RecoveryConflictError);
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

/** Two quiet retries for network / server hiccups, then the error goes to the dialog. */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < 3; i++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!transient(e) || i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Company root for the server: original owner + members, device-only markers removed. */
function buildRoot(c: RecoveryCompany, ownerEmail: string, typedPassword: string): Record<string, unknown> {
  const root: Record<string, unknown> = { ...encodeDocForPocketBase(c.data) };
  for (const k of LOCAL_ONLY_KEYS) delete root[k];
  const sqlitePw = typeof c.data.password === "string" ? c.data.password : "";
  if (typedPassword) {
    root.password = typedPassword;
  } else if (sqlitePw) {
    root.password = sqlitePw;
  } else {
    // no password known on this PC: keep whatever the server already has (nothing on a new company)
    delete root.password;
    root.hasPassword = true;
  }
  if (Array.isArray(root.sharedWith)) {
    root.sharedWith = root.sharedWith.map((m) => {
      if (!m || typeof m !== "object" || Array.isArray(m)) return m;
      const r = { ...(m as Record<string, unknown>) };
      const pw = [r.password, r.pass, r.pwd].some((x) => typeof x === "string" && x !== "");
      if (!pw) {
        delete r.password;
        delete r.pass;
        delete r.pwd;
        r.hasPassword = true; // keep the member's server password, if any
      }
      return r;
    });
  }
  root.id = c.id;
  root.name = c.name;
  root.ownerEmail = ownerEmail;
  if (c.ownerId) root.ownerId = c.ownerId;
  root.storageOption = "firebase";
  root.syncPolicy = "online";
  root.onlineServerId = ONLINE_DATA_SERVER_POCKETBASE_ID;
  root.onlineDataBackend = ONLINE_DATA_SERVER_POCKETBASE_ID;
  Object.assign(root, pocketLedgerStorageDocFields(c.id));
  // no time stamp here: an unchanged company stays "same" on a re-push
  root.plServerRecovery = { by: "sqlite-recovery" };
  return root;
}

function makeBatches(docs: RecoveryDoc[]): RecoveryDoc[][] {
  const out: RecoveryDoc[][] = [];
  let cur: RecoveryDoc[] = [];
  let size = 0;
  for (const d of docs) {
    const n = JSON.stringify(d.data).length;
    if (cur.length && (cur.length >= BATCH_MAX_DOCS || size + n > BATCH_MAX_CHARS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(d);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

function collectLocalRefs(v: unknown, into: Set<string>): void {
  if (typeof v === "string") {
    if (v.startsWith("local:") && v.length > 6) into.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectLocalRefs(x, into);
    return;
  }
  if (!v || typeof v !== "object") return;
  for (const x of Object.values(v as Record<string, unknown>)) collectLocalRefs(x, into);
}

function categoryForCollection(coll: string): string {
  switch (coll) {
    case "vouchers":
      return "voucher";
    case "unassigned_documents":
      return "unassigned";
    case "parties":
      return "party";
    case "items":
      return "item";
    case "staff":
      return "staff";
    default:
      return "other";
  }
}

const attAppId = (localRef: string) => `att_${localRef.slice("local:".length)}`.slice(0, 200);

type FileStats = { files: number; missing: number; tooBig: number };

/** `local:` refs in one batch -> server files. Returns the ref map (missing bytes keep `local:`). */
async function pushBatchFiles(
  companyId: string,
  batch: RecoveryDoc[],
  stats: FileStats,
  signal?: AbortSignal
): Promise<Map<string, string>> {
  const owner = new Map<string, RecoveryDoc>();
  for (const d of batch) {
    const refs = new Set<string>();
    collectLocalRefs(d.data, refs);
    for (const r of refs) if (!owner.has(r)) owner.set(r, d);
  }
  const map = new Map<string, string>();
  if (!owner.size) return map;
  const all = Array.from(owner.keys());
  for (let i = 0; i < all.length; i += 500) {
    const part = all.slice(i, i + 500);
    const res = (await withRetry(
      () =>
        pbRequest("/api/pl/recovery/attachments/exist", {
          method: "POST",
          body: { company: companyId, appIds: part.map(attAppId) },
        }),
      signal
    )) as { refs?: Record<string, string> };
    for (const r of part) {
      const ref = res?.refs?.[attAppId(r)];
      if (ref) {
        map.set(r, ref);
        stats.files += 1;
      }
    }
  }
  const lp = await import("@/lib/localPendingFiles");
  for (const [localRef, doc] of owner) {
    if (map.has(localRef)) continue;
    throwIfAborted(signal);
    let blob: Blob | null = null;
    let fileName = "file";
    let mime = "";
    try {
      const p = await lp.getPendingPayloadForLocalRef(localRef);
      if (p?.blob && p.blob.size > 0) {
        blob = p.blob;
        fileName = str(p.fileName) || fileName;
        mime = str(p.contentType);
      }
    } catch {
      /* try the other store */
    }
    if (!blob) {
      try {
        blob = await lp.getBlobFromLocalFileRef(localRef);
        const meta = await lp.getLocalFileRefMeta(localRef).catch(() => null);
        if (meta) {
          fileName = str(meta.fileName) || fileName;
          mime = str(meta.contentType) || mime;
        }
      } catch {
        blob = null;
      }
    }
    if (!blob || blob.size <= 0) {
      stats.missing += 1;
      continue;
    }
    const type = mime || blob.type || "application/octet-stream";
    const typed = blob.type ? blob : new Blob([blob], { type });
    try {
      const rec = (await withRetry(() => {
        const fd = new FormData();
        fd.append("company", companyId);
        fd.append("app_id", attAppId(localRef));
        fd.append("category", categoryForCollection(doc.coll));
        fd.append("owner_coll", doc.coll);
        fd.append("owner_app_id", doc.id);
        fd.append("file_name", fileName.slice(0, 300));
        fd.append("mime", type.slice(0, 100));
        fd.append("size", String(typed.size));
        fd.append("source_url", localRef.slice(0, 2000));
        fd.append("updatedAtMs", String(Date.now()));
        fd.append("file", typed, fileName);
        return pbFormRequest("/api/pl/recovery/attachment", fd);
      }, signal)) as { ref?: string };
      if (rec?.ref) {
        map.set(localRef, rec.ref);
        stats.files += 1;
      } else {
        stats.missing += 1;
      }
    } catch (e) {
      const code = e instanceof PocketBaseRequestError ? String((e.data as { code?: unknown } | null)?.code || "") : "";
      if (code === "file_too_big") {
        stats.tooBig += 1;
        continue;
      }
      throw e;
    }
  }
  return map;
}

/**
 * Push one company. `password`: typed in the dialog when SQLite has none (optional).
 * `ownerEmail`: only when this PC has no owner email for the company.
 */
export async function pushCompanyToServer(input: {
  company: RecoveryCompany;
  password?: string;
  ownerEmail?: string;
  onProgress?: (p: RecoveryProgress) => void;
  signal?: AbortSignal;
}): Promise<RecoveryPushResult> {
  const c = input.company;
  const progress = input.onProgress ?? (() => {});
  const signal = input.signal;
  if (!getValidPocketBaseAuth()) throw new PocketBaseRequestError("not signed in", 401);
  const ownerEmail = (str(input.ownerEmail) || c.ownerEmail).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new RecoveryConflictError("owner_email_missing");
  const key = markKey(c.id);

  // 1) company + owner + members
  progress({ phase: "company", label: "Creating the company on the server", done: 0, total: 1 });
  const root = buildRoot(c, ownerEmail, str(input.password) ? String(input.password) : "");
  const cres = (await withRetry(
    () =>
      pbRequest("/api/pl/recovery/company", {
        method: "POST",
        timeoutMs: REQ_TIMEOUT_MS,
        body: {
          apply: true,
          company: {
            id: c.id,
            data: root,
            ownerUid: c.ownerId || undefined,
            ownerEmail,
            ownerName: str(c.data.ownerName) || undefined,
            updatedAtMs: c.updatedAt || Date.now(),
          },
        },
      }),
    signal
  )) as { ok?: boolean; conflict?: string };
  if (!cres?.ok) throw new RecoveryConflictError(String(cres?.conflict || "rejected"));

  // 2) records (+ their files), resumable by batch
  const docs = await readCompanyDocs(c.id);
  const batches = makeBatches(docs);
  const sig = `${docs.length}:${batches.length}:${batches.map((b) => b.length).join(",")}`;
  const prev = readMap<ResumeMark>(RESUME_KEY)[key];
  const start = prev && prev.sig === sig ? Math.min(prev.doneBatches, batches.length) : 0;
  const resumed = start > 0 && prev ? prev : null;
  const stats: FileStats = { files: 0, missing: 0, tooBig: 0, ...(resumed?.files || {}) };
  const sum: ResumeSum = { create: 0, update: 0, same: 0, kept_server: 0, unsupported: 0, bad: 0, ...(resumed?.sum || {}) };
  let sent = batches.slice(0, start).reduce((n, b) => n + b.length, 0);
  progress({ phase: "records", label: "Uploading records and files", done: sent, total: docs.length });
  for (let i = start; i < batches.length; i++) {
    throwIfAborted(signal);
    const batch = batches[i];
    const map = await pushBatchFiles(c.id, batch, stats, signal);
    const body = {
      apply: true,
      company: c.id,
      docs: batch.map((d) => ({
        coll: d.coll,
        id: d.id,
        data: encodeDocForPocketBase(replaceRefsDeep(d.data, map)),
        at: d.at || undefined,
      })),
    };
    const r = (await withRetry(
      () => pbRequest("/api/pl/recovery/docs", { method: "POST", body, timeoutMs: REQ_TIMEOUT_MS }),
      signal
    )) as { counts?: Record<string, Record<string, number>> };
    for (const per of Object.values(r?.counts || {})) {
      for (const [k, n] of Object.entries(per || {})) {
        if (k in sum) sum[k as keyof typeof sum] += Number(n) || 0;
      }
    }
    sent += batch.length;
    writeMapEntry<ResumeMark>(RESUME_KEY, key, {
      sig,
      doneBatches: i + 1,
      atMs: Date.now(),
      sent,
      total: docs.length,
      sum: { ...sum },
      files: { ...stats },
    });
    progress({ phase: "records", label: "Uploading records and files", done: sent, total: docs.length });
  }

  // 3) count check
  progress({ phase: "verify", label: "Checking the server copy", done: 0, total: 1 });
  const want: Record<string, number> = {};
  for (const d of docs) want[d.coll] = (want[d.coll] || 0) + 1;
  const pw = str(input.password) || (typeof c.data.password === "string" ? c.data.password : "");
  const v = (await withRetry(
    () =>
      pbRequest("/api/pl/recovery/verify", {
        method: "POST",
        timeoutMs: REQ_TIMEOUT_MS,
        body: { company: c.id, counts: want, passwords: pw ? { root: pw } : {} },
      }),
    signal
  )) as { counts?: Record<string, { source: number; server: number }>; members?: unknown[] };
  const countMismatch: RecoveryPushResult["countMismatch"] = [];
  for (const [coll, x] of Object.entries(v?.counts || {})) {
    if (x && Number(x.server) < Number(x.source)) countMismatch.push({ coll, source: x.source, server: x.server });
  }
  const members = Array.isArray(v?.members) ? Math.max(0, v!.members!.length - 1) : c.members.length;

  const mark: RecoveryUploadedMark = {
    atMs: Date.now(),
    records: docs.length,
    files: stats.files,
    missingFiles: stats.missing,
    ownerEmail,
    members,
  };
  writeMapEntry(UPLOADED_KEY, key, mark);
  writeMapEntry<ResumeMark>(RESUME_KEY, key, null);
  progress({ phase: "done", label: "Done", done: docs.length, total: docs.length });
  return {
    ...mark,
    created: sum.create,
    updated: sum.update,
    same: sum.same,
    keptServer: sum.kept_server,
    unsupported: sum.unsupported,
    failedRecords: sum.bad,
    tooBigFiles: stats.tooBig,
    countMismatch,
    resumedFromBatch: start,
  };
}