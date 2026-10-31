"use client";

/**
 * Recovery mode: push one company from this PC's SQLite to the Pocket Ledger Server.
 * Same steps as the backup-restore upload (pbRestoreUpload): company root -> attachments
 * (`local:` and Firebase Storage URLs -> `pbatt:`) -> every record in small batches; then a count check.
 * Firebase files: bytes from this PC's cache first. source "local" (default) stops there: nothing is read from
 * Firebase (no Firestore, no Storage); a file that is only a Firebase link is skipped and listed in `notOnPc`.
 * source "firebase" then also tries Firebase Storage (signed-in recovery session).
 * Missing bytes keep the original URL and count as `missingFiles`. SQLite on this PC is not rewritten.
 * While a push runs, 429 / 402 replies never start the app-wide quota pause (serverQuotaHold); a 429 from the
 * Pocket Ledger Server is waited out and retried (withRetry).
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
import { beginRecoveryQuotaSuppress } from "@/lib/serverQuotaHold";
import { noteUserInitiatedServerAction } from "@/lib/quotaAdminNotice";
import { RECOVERY_TEXT, readRecoveryLang, type RecoveryPushSource } from "@/lib/recovery/recoveryLocales";

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
  /** Same counts split by Masters / Vouchers / Files. */
  byKind: RecoveryKindSplit;
  /** Files sent to the server in this push (they were missing there). */
  uploadedFiles: number;
  /** Files the server already had: nothing was sent, no second copy was made. */
  alreadyOnServerFiles: number;
  /** Where this push took its data from ("local" never touched Firebase). */
  source: RecoveryPushSource;
  /** Names of files that were not on this PC (skipped or not copyable), capped. */
  notOnPc: string[];
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
    if (err.status === 429) return "The Pocket Ledger Server is busy (too many requests). Wait a minute, then press Retry.";
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

/** Counts of one kind of item in a push. */
export type RecoveryKindCounts = { created: number; updated: number; unchanged: number; failed: number };
/**
 * Push counts split by kind.
 * - masters: every record that is not a voucher (parties, groups, items, bank / expense accounts, staff,
 *   taxes, expense groups, unassigned documents, docs / settings ...).
 * - vouchers: the `vouchers` collection only.
 * - files: created = uploaded, unchanged = already on the server, failed = too big / rejected,
 *   notOnPc = bytes not on this PC (not uploaded). Files have no "updated".
 */
export type RecoveryKindSplit = {
  masters: RecoveryKindCounts;
  vouchers: RecoveryKindCounts;
  files: RecoveryKindCounts & { notOnPc: number };
};

const emptyKind = (): RecoveryKindCounts => ({ created: 0, updated: 0, unchanged: 0, failed: 0 });
const emptyRecordKinds = (): { masters: RecoveryKindCounts; vouchers: RecoveryKindCounts } => ({
  masters: emptyKind(),
  vouchers: emptyKind(),
});

type ResumeSum = { create: number; update: number; same: number; kept_server: number; unsupported: number; bad: number };

type ResumeMark = {
  sig: string;
  doneBatches: number;
  atMs: number;
  /** records already sent (older marks may not have it) */
  sent?: number;
  total?: number;
  sum?: ResumeSum;
  /** masters / vouchers split of `sum` (older marks do not have it) */
  kinds?: { masters: RecoveryKindCounts; vouchers: RecoveryKindCounts };
  files?: { files: number; missing: number; tooBig: number; uploaded?: number; alreadyOnServer?: number };
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

/** Waits (ms) after a 429 from the Pocket Ledger Server: back off and retry instead of failing / pausing the app. */
const RATE_WAITS_MS = [2000, 4000, 8000, 15000, 30000, 30000];
/** Set by pushCompanyToServer while a push runs: shows "server busy, waiting" in the progress line. */
let rateBackoffNote: (() => void) | null = null;

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Stopped", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Stopped", "AbortError"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Two quiet retries for network / server hiccups, then the error goes to the dialog.
 * A 429 (server rate limit) gets its own longer back-off (up to ~90 s in total) before it is reported.
 */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let quiet = 0;
  let rate = 0;
  for (;;) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (e) {
      if (!transient(e)) throw e;
      if (e instanceof PocketBaseRequestError && e.status === 429) {
        if (rate >= RATE_WAITS_MS.length) throw e;
        rateBackoffNote?.();
        await sleepAbortable(RATE_WAITS_MS[rate++], signal);
        continue;
      }
      quiet += 1;
      if (quiet >= 3) throw e;
      await sleepAbortable(1500 * quiet, signal);
    }
  }
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

function collectFileRefs(v: unknown, into: Set<string>): void {
  if (typeof v === "string") {
    if (v.startsWith("local:") && v.length > 6) into.add(v);
    else if (pbRefRecordId(v)) into.add(v);
    else if (isFirebaseFileRef(v)) into.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectFileRefs(x, into);
    return;
  }
  if (!v || typeof v !== "object") return;
  for (const x of Object.values(v as Record<string, unknown>)) collectFileRefs(x, into);
}

/** Record id of a server file ref `pbatt:<id>/<name>` (15 chars a-z0-9), else "". */
function pbRefRecordId(s: string): string {
  const m = /^pbatt:([a-z0-9]{15})\/[^/]+$/.exec(s);
  return m ? m[1]! : "";
}

function isFirebaseFileRef(s: string): boolean {
  if (!s || s.startsWith("pbatt:") || s.startsWith("local:") || s.startsWith("blob:") || s.startsWith("data:")) {
    return false;
  }
  const l = s.toLowerCase();
  if (
    l.includes("firebasestorage.googleapis.com") ||
    l.includes("firebasestorage.app") ||
    (l.includes("googleapis.com") && l.includes("/o/")) ||
    l.includes("storage.googleapis.com")
  ) {
    return true;
  }
  if (/^(https?:|drive:|capacitor:|file:)/i.test(s)) return false;
  return (
    /^voucher-files\//i.test(s) ||
    /^companies\//i.test(s) ||
    /^entity-files\//i.test(s) ||
    /^pocket-ledger\//i.test(s)
  );
}

function fileNameFromRef(ref: string, fallback = "file"): string {
  try {
    const path = /^https?:\/\//i.test(ref) ? decodeURIComponent(new URL(ref).pathname) : ref;
    const base = path.split("/").pop() || "";
    const name = decodeURIComponent(base.split("?")[0] || "");
    return (name || fallback).slice(0, 300);
  } catch {
    return fallback;
  }
}

async function attAppIdForRemote(url: string): Promise<string> {
  let key = url.split("?")[0] || url;
  try {
    const { tryGetStoragePathFromFirebaseDownloadUrl } = await import("@/lib/firebaseStorageDownloadUrl");
    key = tryGetStoragePathFromFirebaseDownloadUrl(url) || key;
  } catch {
    /* path parse optional */
  }
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    return `att_fb_${hex.slice(0, 40)}`;
  } catch {
    const safe = key.replace(/[^A-Za-z0-9._:-]/g, "_").slice(-80);
    return `att_fb_${safe}`.slice(0, 200);
  }
}

const FILE_FETCH_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

async function fetchUrlBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FILE_FETCH_MS);
  const onParent = () => ac.abort();
  signal?.addEventListener("abort", onParent, { once: true });
  try {
    if (typeof window !== "undefined" && window.location.hostname === "localhost") {
      const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
      if (ua.includes("electron")) {
        const res = await fetch(`/__firebase_blob_proxy?url=${encodeURIComponent(url)}`, {
          method: "GET",
          signal: ac.signal,
        });
        if (res.ok) {
          const b = await res.blob();
          if (b.size > 0) return b;
        }
      }
    }
  } catch {
    /* try CORS */
  }
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", signal: ac.signal });
    if (!res.ok) return null;
    const b = await res.blob();
    return b.size > 0 ? b : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParent);
  }
}

/** Cache on this PC, then Firebase Storage. Recovery must not use the Files-tick network gate. */
async function blobFromFirebaseFile(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const { tryOfflineCachedAttachmentBlobMultiKey } = await import("@/lib/offlineAttachmentUrlCache");
    const cached = await tryOfflineCachedAttachmentBlobMultiKey(url);
    if (cached && cached.size > 0) return cached;
  } catch {
    /* cache optional */
  }
  let path = "";
  try {
    const {
      tryGetStoragePathFromFirebaseDownloadUrl,
      looksLikeFirebaseStorageObjectPath,
      normalizeFirebaseStorageObjectPathForSdk,
    } = await import("@/lib/firebaseStorageDownloadUrl");
    path =
      tryGetStoragePathFromFirebaseDownloadUrl(url) ||
      (looksLikeFirebaseStorageObjectPath(url) ? normalizeFirebaseStorageObjectPathForSdk(url) : "");
  } catch {
    path = "";
  }
  if (path) {
    try {
      const [{ getBlob, ref }, { storage }] = await Promise.all([
        import("@/lib/pocketbaseData/pbStorage"),
        import("@/lib/firebase"),
      ]);
      const blob = await withTimeout(getBlob(ref(storage, path)), FILE_FETCH_MS, signal);
      if (blob && blob.size > 0) return blob;
    } catch {
      /* fallback to HTTPS */
    }
  }
  if (/^https?:\/\//i.test(url)) return fetchUrlBlob(url, signal);
  return null;
}

function bumpConvertedDocTimes(data: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return { ...data, updatedAt: now, lastEditedAt: now };
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

type FileStats = {
  files: number;
  missing: number;
  tooBig: number;
  notOnPc?: string[];
  /** Files sent to the server in this push (new bytes). */
  uploaded?: number;
  /** Files the server already had (nothing sent, no second copy made). */
  alreadyOnServer?: number;
};

/** Count a file whose bytes are not on this PC (and could not be fetched); remember its name (capped). */
function noteMissingFile(stats: FileStats, fileName: string): void {
  stats.missing += 1;
  const list = stats.notOnPc || (stats.notOnPc = []);
  if (list.length < 200) list.push(fileName);
}

/** This PC's attachment cache only (IndexedDB): never Firebase, never the network. */
async function blobFromLocalCacheOnly(url: string): Promise<Blob | null> {
  try {
    const { tryOfflineCachedAttachmentBlobMultiKey } = await import("@/lib/offlineAttachmentUrlCache");
    const cached = await tryOfflineCachedAttachmentBlobMultiKey(url);
    return cached && cached.size > 0 ? cached : null;
  } catch {
    return null;
  }
}

type FileProgress = (label: string) => void;

/** `local:` + Firebase Storage refs in one batch -> server files (`pbatt:`). Missing bytes keep the original URL. */
async function pushBatchFiles(
  companyId: string,
  batch: RecoveryDoc[],
  stats: FileStats,
  signal?: AbortSignal,
  onFileProgress?: FileProgress,
  source: RecoveryPushSource = "local"
): Promise<Map<string, string>> {
  const owner = new Map<string, RecoveryDoc>();
  for (const d of batch) {
    const refs = new Set<string>();
    collectFileRefs(d.data, refs);
    for (const r of refs) if (!owner.has(r)) owner.set(r, d);
  }
  const map = new Map<string, string>();
  /** `pbatt:` refs whose record is already on the server (nothing to send). */
  const existingPb = new Set<string>();
  if (!owner.size) return map;
  const all = Array.from(owner.keys());
  const appIdByRef = new Map<string, string>();
  for (const r of all) {
    const pbId = pbRefRecordId(r);
    // A `pbatt:` ref already points at a server record id: its app_id is derived from that id, so a
    // re-push of the same ref can never make a second record.
    appIdByRef.set(r, pbId ? `att_pb_${pbId}` : r.startsWith("local:") ? attAppId(r) : await attAppIdForRemote(r));
  }
  for (let i = 0; i < all.length; i += 500) {
    const part = all.slice(i, i + 500);
    const partPb = part.filter((r) => pbRefRecordId(r));
    const res = (await withRetry(
      () =>
        pbRequest("/api/pl/recovery/attachments/exist", {
          method: "POST",
          body: {
            company: companyId,
            appIds: part.filter((r) => !pbRefRecordId(r)).map((r) => appIdByRef.get(r) || attAppId(r)),
            recordIds: partPb.map((r) => pbRefRecordId(r)),
          },
        }),
      signal
    )) as { refs?: Record<string, string>; byId?: Record<string, string> };
    if (partPb.length && !res?.byId) {
      // Old server hook (no id support): stop instead of risking a second copy of every file.
      throw new Error("The server must be restarted once to re-push files by id (server hook updated).");
    }
    for (const r of part) {
      const pbId = pbRefRecordId(r);
      if (pbId) {
        const have = res.byId?.[pbId];
        if (have) {
          stats.alreadyOnServer = (stats.alreadyOnServer || 0) + 1;
          stats.files += 1;
          existingPb.add(r);
          // same record, different stored file name: point the doc at the name the server has
          if (have !== r) map.set(r, have);
        }
        continue;
      }
      const appId = appIdByRef.get(r) || attAppId(r);
      const ref = res?.refs?.[appId];
      if (ref) {
        map.set(r, ref);
        stats.files += 1;
        stats.alreadyOnServer = (stats.alreadyOnServer || 0) + 1;
      }
    }
  }
  const lp = await import("@/lib/localPendingFiles");
  let done = 0;
  const pending = all.filter((r) => !map.has(r) && !existingPb.has(r)).length;
  for (const [fileRef, doc] of owner) {
    if (map.has(fileRef) || existingPb.has(fileRef)) continue;
    throwIfAborted(signal);
    done += 1;
    onFileProgress?.(`Copying files to server ${done} / ${pending}`);
    let blob: Blob | null = null;
    let fileName = fileNameFromRef(fileRef, "file");
    let mime = "";
    if (fileRef.startsWith("local:")) {
      try {
        const p = await lp.getPendingPayloadForLocalRef(fileRef);
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
          blob = await lp.getBlobFromLocalFileRef(fileRef);
          const meta = await lp.getLocalFileRefMeta(fileRef).catch(() => null);
          if (meta) {
            fileName = str(meta.fileName) || fileName;
            mime = str(meta.contentType) || mime;
          }
        } catch {
          blob = null;
        }
      }
    } else if (pbRefRecordId(fileRef)) {
      // Dangling server ref (record missing on this server): the bytes can only come from this device's
      // file cache (the old server's files that were downloaded here); the original Firebase URL is not kept.
      blob = await blobFromLocalCacheOnly(fileRef);
    } else {
      blob = source === "firebase" ? await blobFromFirebaseFile(fileRef, signal) : await blobFromLocalCacheOnly(fileRef);
    }
    if (!blob || blob.size <= 0) {
      noteMissingFile(stats, fileName);
      continue;
    }
    const type = mime || blob.type || "application/octet-stream";
    const typed = blob.type ? blob : new Blob([blob], { type });
    const appId = appIdByRef.get(fileRef) || attAppId(fileRef);
    try {
      const rec = (await withRetry(() => {
        const fd = new FormData();
        fd.append("company", companyId);
        fd.append("app_id", appId);
        // keep the id the voucher already points at, so the existing ref resolves to this record
        if (pbRefRecordId(fileRef)) fd.append("id", pbRefRecordId(fileRef));
        fd.append("category", categoryForCollection(doc.coll));
        fd.append("owner_coll", doc.coll);
        fd.append("owner_app_id", doc.id);
        fd.append("file_name", fileName.slice(0, 300));
        fd.append("mime", type.slice(0, 100));
        fd.append("size", String(typed.size));
        fd.append("source_url", fileRef.slice(0, 2000));
        fd.append("updatedAtMs", String(Date.now()));
        fd.append("file", typed, fileName);
        return pbFormRequest("/api/pl/recovery/attachment", fd);
      }, signal)) as { ref?: string; existed?: boolean };
      if (rec?.ref) {
        if (!pbRefRecordId(fileRef) || rec.ref !== fileRef) map.set(fileRef, rec.ref);
        stats.files += 1;
        // server says it already had it (parallel / earlier push): counted as existing, not uploaded
        if (rec.existed) stats.alreadyOnServer = (stats.alreadyOnServer || 0) + 1;
        else stats.uploaded = (stats.uploaded || 0) + 1;
      } else {
        noteMissingFile(stats, fileName);
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
  /** "local" (default): only SQLite + files cached on this PC, Firebase never touched. "firebase": also copy files from Firebase Storage. */
  source?: RecoveryPushSource;
  onProgress?: (p: RecoveryProgress) => void;
  signal?: AbortSignal;
}): Promise<RecoveryPushResult> {
  // A push is a user action: no startup quota popup for it, and 429 / 402 replies never start the app-wide pause.
  noteUserInitiatedServerAction();
  const endSuppress = beginRecoveryQuotaSuppress();
  let lastProgress: RecoveryProgress = { phase: "company", label: "", done: 0, total: 1 };
  const userProgress = input.onProgress;
  rateBackoffNote = () => userProgress?.({ ...lastProgress, label: RECOVERY_TEXT[readRecoveryLang()].serverBusy });
  try {
    return await pushCompanyToServerInner({
      ...input,
      onProgress: (p) => {
        lastProgress = p;
        userProgress?.(p);
      },
    });
  } finally {
    rateBackoffNote = null;
    endSuppress();
  }
}

async function pushCompanyToServerInner(input: {
  company: RecoveryCompany;
  password?: string;
  ownerEmail?: string;
  source?: RecoveryPushSource;
  onProgress?: (p: RecoveryProgress) => void;
  signal?: AbortSignal;
}): Promise<RecoveryPushResult> {
  const c = input.company;
  const source: RecoveryPushSource = input.source === "firebase" ? "firebase" : "local";
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

  // 1b) company logo / stamp / avatar: copy Firebase or local files onto the server
  const rootStats: FileStats = { files: 0, missing: 0, tooBig: 0 };
  {
    const rootDoc: RecoveryDoc = { coll: "company", id: c.id, data: root, at: c.updatedAt || Date.now() };
    const rootMap = await pushBatchFiles(
      c.id,
      [rootDoc],
      rootStats,
      signal,
      (label) => progress({ phase: "company", label, done: 1, total: 1 }),
      source
    );
    if (rootMap.size) {
      const nextRoot = replaceRefsDeep(root, rootMap);
      await withRetry(
        () =>
          pbRequest("/api/pl/recovery/company", {
            method: "POST",
            timeoutMs: REQ_TIMEOUT_MS,
            body: {
              apply: true,
              company: {
                id: c.id,
                data: nextRoot,
                ownerUid: c.ownerId || undefined,
                ownerEmail,
                ownerName: str(c.data.ownerName) || undefined,
                updatedAtMs: Date.now(),
              },
            },
          }),
        signal
      );
    }
  }

  // 2) records (+ their files), resumable by batch
  const docs = await readCompanyDocs(c.id);
  const batches = makeBatches(docs);
  const sig = `f2:${docs.length}:${batches.length}:${batches.map((b) => b.length).join(",")}`;
  const prev = readMap<ResumeMark>(RESUME_KEY)[key];
  const start = prev && prev.sig === sig ? Math.min(prev.doneBatches, batches.length) : 0;
  const resumed = start > 0 && prev ? prev : null;
  const stats: FileStats = { files: 0, missing: 0, tooBig: 0, ...(resumed?.files || {}) };
  if (!resumed) {
    stats.files += rootStats.files;
    stats.missing += rootStats.missing;
    stats.tooBig += rootStats.tooBig;
    stats.uploaded = (stats.uploaded || 0) + (rootStats.uploaded || 0);
    stats.alreadyOnServer = (stats.alreadyOnServer || 0) + (rootStats.alreadyOnServer || 0);
    stats.notOnPc = [...(rootStats.notOnPc || [])];
  }
  const sum: ResumeSum = { create: 0, update: 0, same: 0, kept_server: 0, unsupported: 0, bad: 0, ...(resumed?.sum || {}) };
  // Masters / Vouchers split (a resume mark from before this field existed restarts the split at zero).
  const kinds = emptyRecordKinds();
  if (resumed?.kinds) {
    Object.assign(kinds.masters, resumed.kinds.masters);
    Object.assign(kinds.vouchers, resumed.kinds.vouchers);
  }
  let sent = batches.slice(0, start).reduce((n, b) => n + b.length, 0);
  progress({ phase: "records", label: "Uploading records and files", done: sent, total: docs.length });
  for (let i = start; i < batches.length; i++) {
    throwIfAborted(signal);
    const batch = batches[i];
    const map = await pushBatchFiles(
      c.id,
      batch,
      stats,
      signal,
      (label) => progress({ phase: "records", label, done: sent, total: docs.length }),
      source
    );
    const convertedKeys = new Set<string>();
    if (map.size) {
      for (const d of batch) {
        const refs = new Set<string>();
        collectFileRefs(d.data, refs);
        for (const r of refs) {
          if (map.has(r)) convertedKeys.add(`${d.coll}/${d.id}`);
        }
      }
    }
    const body = {
      apply: true,
      company: c.id,
      docs: batch.map((d) => {
        const next = replaceRefsDeep(d.data, map);
        const converted = convertedKeys.has(`${d.coll}/${d.id}`);
        const data = converted ? bumpConvertedDocTimes(next) : next;
        return {
          coll: d.coll,
          id: d.id,
          data: encodeDocForPocketBase(data),
          at: converted ? Date.now() : d.at || undefined,
        };
      }),
    };
    const r = (await withRetry(
      () => pbRequest("/api/pl/recovery/docs", { method: "POST", body, timeoutMs: REQ_TIMEOUT_MS }),
      signal
    )) as { counts?: Record<string, Record<string, number>> };
    for (const [collName, per] of Object.entries(r?.counts || {})) {
      const kind = collName === "vouchers" ? kinds.vouchers : kinds.masters;
      for (const [k, n] of Object.entries(per || {})) {
        const v = Number(n) || 0;
        if (k in sum) sum[k as keyof typeof sum] += v;
        if (k === "create") kind.created += v;
        else if (k === "update") kind.updated += v;
        else if (k === "same" || k === "kept_server") kind.unchanged += v;
        else if (k === "bad" || k === "unsupported") kind.failed += v;
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
      kinds: { masters: { ...kinds.masters }, vouchers: { ...kinds.vouchers } },
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
    byKind: {
      masters: kinds.masters,
      vouchers: kinds.vouchers,
      files: {
        created: stats.uploaded || 0,
        updated: 0,
        unchanged: stats.alreadyOnServer || 0,
        failed: stats.tooBig,
        notOnPc: stats.missing,
      },
    },
    uploadedFiles: stats.uploaded || 0,
    alreadyOnServerFiles: stats.alreadyOnServer || 0,
    source,
    notOnPc: stats.notOnPc || [],
    countMismatch,
    resumedFromBatch: start,
  };
}