"use client";

/**
 * Offline full-warm sync: HTTPS attachment bytes IndexedDB cache (Firestore mirror URLs only).
 * `FilePreview` / galley pe pehle yahan dekho → offline open after online preload.
 */

import { openDB, getPendingIndexedDbFullName } from "@/lib/offlineDb";
import {
  looksLikeFirebaseStorageDownloadUrl,
  tryFetchFirebaseStorageDownloadUrlBlob,
  tryGetBlobFromFirebaseStorageDownloadUrl,
} from "@/lib/storageGetBlobFromDownloadUrl";
import {
  looksLikeFirebaseStorageObjectPath,
  normalizeFirebaseStorageObjectPathForSdk,
  tryGetStoragePathFromFirebaseDownloadUrl,
} from "@/lib/firebaseStorageDownloadUrl";
import { storage } from "@/lib/firebase";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { electronAttachmentDisplayUrlFromPath } from "@/lib/electronAttachmentFs";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import {
  getAttachmentFileUriFromDataDir,
  readAttachmentBlobFromDataDir,
  writeAttachmentBlobToDataDir,
  attachmentFileExistsInDataDir,
} from "@/lib/capacitorAttachmentFs";
import {
  getAttachmentFileRef,
  upsertAttachmentFileRef,
} from "@/lib/attachmentFileRefStore";
import { Capacitor } from "@capacitor/core";
import { getBlob, ref } from "@/lib/pocketbaseData/pbStorage";
import {
  fetchAttachmentRefBlob,
  isOfflineCacheableAttachmentRef,
  offlineCacheKeyForAttachmentRef,
} from "@/lib/attachmentRefBlobFetch";
import {
  getBlobFromLocalFileRef,
  getLocalFileRefMeta,
  getLocalFileRefMetaSync,
  isLocalFileRef,
} from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyAttachmentSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";

/** Forensic: build par `NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG=1` — cache HIT/MISS / stable-key proof (temporary trace only). */
function offlineAttachmentForensicEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG === "1";
}

/** Bade PDF/scan offline bhi cache ho sakein — purana 40MB se kai vouchers miss ho rahe the. */
export const OFFLINE_ATTACHMENT_MAX_CACHED_BYTES = 96 * 1024 * 1024;

/** SHA-256 hex — stable IndexedDB primary key */
export async function offlineAttachmentStoreId(urlStr: string): Promise<string> {
  const trimmed = urlStr.trim();
  const { computeSha256HexFromStringUtf8 } = await import("@/lib/security/sha256Hex");
  return computeSha256HexFromStringUtf8(trimmed);
}

/** Firebase signed URL token बदलने पर भी same file hit रहे: stable object-path आधारित alternate cache key. */
function getStableFirebaseObjectKey(urlStr: string): string | null {
  try {
    const raw = String(urlStr || "").trim();
    const pathFromDownloadUrl = tryGetStoragePathFromFirebaseDownloadUrl(raw);
    // Bare / encoded tail ko `voucher-files/…` me map karo taaki HTTPS vs relative same disk cache hit kare.
    const normForSdk = normalizeFirebaseStorageObjectPathForSdk(raw);
    let stable: string | null = null;
    if (pathFromDownloadUrl) stable = `firebase-object:${pathFromDownloadUrl}`;
    else if (
      /^voucher-files\//i.test(normForSdk) ||
      /^companies\//i.test(normForSdk) ||
      /^entity-files\//i.test(normForSdk)
    ) {
      stable = `firebase-object:${normForSdk.replace(/^\/+/, "")}`;
    }
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_STABLE_KEY]", {
        originalInput: urlStr,
        trimmed: raw,
        pathFromDownloadUrlParser: pathFromDownloadUrl,
        normalizedPathForSdk: normForSdk,
        stableFirebaseObjectKey: stable,
      });
    }
    return stable;
  } catch (e) {
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_STABLE_KEY]", {
        originalInput: urlStr,
        stableFirebaseObjectKey: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  }
}

/** Cache lookup: HTTPS/Firebase path + `local:`/`drive:`/`PL_ATTACH_V1` (mobile/APK preload). */
function supportsOfflineAttachmentLookup(raw: string): boolean {
  return isOfflineCacheableAttachmentRef(raw);
}

/** IndexedDB/native key — `PL_ATTACH` decode karke stable ref. */
function offlineAttachmentCacheLookupKey(raw: string): string {
  const decoded = offlineCacheKeyForAttachmentRef(raw);
  return decoded || String(raw || "").trim();
}

async function getOfflineAttachmentStoreIdsForLookup(urlStr: string): Promise<string[]> {
  const trimmed = offlineAttachmentCacheLookupKey(urlStr);
  if (!supportsOfflineAttachmentLookup(urlStr)) {
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_STORE_IDS]", {
        originalInput: urlStr,
        trimmed,
        supportsLookup: false,
        hashIds: [],
        stableFirebaseObjectKey: null,
      });
    }
    return [];
  }
  const ids: string[] = [];
  const primaryHash = await offlineAttachmentStoreId(trimmed);
  ids.push(primaryHash);
  const stable = getStableFirebaseObjectKey(trimmed);
  let stableHash: string | null = null;
  if (stable) {
    stableHash = await offlineAttachmentStoreId(stable);
    ids.push(stableHash);
  }
  const uniq = Array.from(new Set(ids));
  if (offlineAttachmentForensicEnabled()) {
    console.warn("[FORENSIC_OFFLINE_CACHE_STORE_IDS]", {
      originalInput: urlStr,
      trimmed,
      supportsLookup: true,
      stableFirebaseObjectKey: stable,
      hashIdPrimary: primaryHash,
      hashIdStableAlias: stableHash,
      hashIds: uniq,
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  return uniq;
}

async function getOfflineAttachmentStoreIdsForWrite(urlStr: string): Promise<string[]> {
  // Write ke waqt exact URL + stable object-path dono keys persist karo for stronger cross-page/cache hit.
  return await getOfflineAttachmentStoreIdsForLookup(urlStr);
}

function isEligibleAttachmentHttpsUrl(raw: string): boolean {
  const u = raw.trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) return false;
  const lower = u.toLowerCase();
  // Common non-attachment / huge HTML pages skip
  if (/(youtube\.com|youtu\.be|vimeo\.com|facebook\.com|twitter\.com|maps\.google)/i.test(lower)) return false;
  return true;
}

/** Raw Firebase object-path (`voucher-files/...`) ko SDK se blob me resolve karo for static/offline cache warm. */
async function getBlobFromFirebaseObjectPath(path: string): Promise<Blob | null> {
  try {
    const { blockFirebaseStorageHitOnPlServer } = await import("@/lib/plServerFirebaseHitTrace");
    if (blockFirebaseStorageHitOnPlServer("getBlobFromFirebaseObjectPath", path)) {
      return null;
    }
  } catch {
    /* optional */
  }
  try {
    const storageRef = ref(storage, path);
    const blob = await getBlob(storageRef);
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** Warm prefetch worker — HTTPS/Storage path only (cache miss; caller pehle `getOfflineCached` check kare). */
export async function fetchHttpsAttachmentBlobForPrefetchMiss(
  url: string,
  signal?: AbortSignal
): Promise<Blob | null> {
  const r = await blobFromHybridFetch(url.trim(), signal, uiAttachmentCacheMissTimeoutMs());
  return r.blob && r.blob.size > 0 ? r.blob : null;
}

const BACKUP_EMBED_FETCH_TIMEOUT_MS = 90_000;

export type AttachmentBlobForBackupOptions = {
  signal?: AbortSignal;
  /** Backup zip collect: sirf bytes chahiye — `pl-attachments` write skip (tez). */
  skipDiskWrite?: boolean;
  /** Sirf device cache / pending — network fetch mat karo (SQLite-only backup scan). */
  localOnly?: boolean;
};

/** Backup embed: cache/disk pehle; online par SDK/fetch (UI preview timeout se chhota). */
export async function getAttachmentBlobForBackupEmbed(
  urlStr: string,
  options?: AttachmentBlobForBackupOptions
): Promise<Blob | null> {
  const signal = options?.signal;
  const trimmed = offlineAttachmentCacheLookupKey(urlStr);
  if (!trimmed || !supportsOfflineAttachmentLookup(urlStr)) return null;

  const cached = await tryOfflineCachedAttachmentBlobMultiKey(trimmed);
  if (cached && cached.size > 0) return cached;

  if (options?.localOnly === true) return null;

  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  const fetchTarget =
    /^https?:\/\//i.test(trimmed) ? trimmed : normalizeFirebaseStorageObjectPathForSdk(trimmed);
  if (!fetchTarget) return null;

  const fetchResult = await blobFromHybridFetch(fetchTarget, signal, BACKUP_EMBED_FETCH_TIMEOUT_MS);
  const fresh = fetchResult.blob;
  if (!fresh?.size) return null;

  if (!options?.skipDiskWrite && fresh.size <= OFFLINE_ATTACHMENT_MAX_CACHED_BYTES) {
    if (usesEmbeddedNativeAttachmentStorage()) {
      await putCachedBlob(trimmed, fresh);
    } else {
      void putCachedBlob(trimmed, fresh);
    }
  }
  return fresh;
}

/** UI click/hover: cache miss par download + disk/IDB write, phir native display URL ya blob. */
export async function ensureOfflineCachedAttachmentDisplay(
  urlStr: string,
  signal?: AbortSignal,
  options?: { companyId?: string; galleryUrls?: readonly string[]; localOnly?: boolean }
): Promise<{
  displayUrl: string | null;
  blob: Blob | null;
  contentType: string | null;
}> {
  const trimmed = String(urlStr || "").trim();
  if (!trimmed) return { displayUrl: null, blob: null, contentType: null };
  const { readActiveAttachmentCompanyId } = await import("@/lib/firestorePermissionSuppress");
  const companyId = options?.companyId ?? readActiveAttachmentCompanyId() ?? undefined;

  if (isLocalFileRef(trimmed)) {
    if (usesEmbeddedNativeAttachmentStorage()) {
      const meta = getLocalFileRefMetaSync(trimmed) ?? (await getLocalFileRefMeta(trimmed));
      if (meta?.displayUrl) {
        return { displayUrl: meta.displayUrl, blob: null, contentType: meta.contentType ?? null };
      }
    }
    let blob = await getBlobFromLocalFileRef(trimmed, { companyId });
    if ((!blob || blob.size <= 0) && companyId) {
      const { fetchPlServerAttachmentBlob } = await import("@/lib/plServerAttachmentFetch");
      blob = await fetchPlServerAttachmentBlob(companyId, trimmed, signal);
      if (blob && blob.size > 0) {
        void putCachedBlob(trimmed, blob);
      }
    }
    return { displayUrl: null, blob, contentType: blob?.type ?? null };
  }

  const native = await getOfflineCachedAttachmentNativeRef(trimmed);
  if (native?.displayUrl) {
    return { displayUrl: native.displayUrl, blob: null, contentType: native.contentType };
  }

  const cached = await tryOfflineCachedAttachmentBlobMultiKey(trimmed);
  if (cached && cached.size > 0) {
    return { displayUrl: null, blob: cached, contentType: cached.type || null };
  }

  if (options?.localOnly === true) {
    return { displayUrl: null, blob: null, contentType: null };
  }

  const blob = await getRemoteAttachmentBlobPreferOfflineCache(trimmed, signal, {
    awaitDiskWrite: false,
    companyId,
    galleryUrls: options?.galleryUrls,
  });
  if (blob && blob.size > 0) {
    void putCachedBlob(trimmed, blob);
    const nativeAfter = await getOfflineCachedAttachmentNativeRef(trimmed);
    if (nativeAfter?.displayUrl) {
      return { displayUrl: nativeAfter.displayUrl, blob: null, contentType: nativeAfter.contentType };
    }
    return { displayUrl: null, blob, contentType: blob.type || null };
  }

  return { displayUrl: null, blob: null, contentType: null };
}

async function blobFromHybridFetch(
  url: string,
  signal?: AbortSignal,
  /** Prefetch = lambi wait; UI hover/click = chhota cap taaki spinner 20s na atke */
  timeoutMs: number = prefetchRequestTimeoutMs()
): Promise<HybridFetchResult> {
  const recentFailure = readRecentAttachmentFetchFailure(url);
  if (recentFailure) {
    return {
      blob: null,
      status: recentFailure.status,
      retryable: false,
      source: "exception",
      error: recentFailure.error,
    };
  }

  const objectPathForSdk = normalizeFirebaseStorageObjectPathForSdk(url);
  if (
    /^voucher-files\//i.test(objectPathForSdk) ||
    /^companies\//i.test(objectPathForSdk) ||
    /^entity-files\//i.test(objectPathForSdk)
  ) {
    // Mirrored rows me raw object-path ho to bhi cache hydrate ho; sirf HTTPS URLs par depend mat karo.
    const b = await runWithTimeoutSignal(
      (_scopedSignal) => getBlobFromFirebaseObjectPath(objectPathForSdk),
      timeoutMs,
      signal
    ).catch(() => null);
    if (b && b.size > 0) {
      clearRecentAttachmentFetchFailure(url);
      return { blob: b, status: 200, retryable: false, source: "firebase_sdk" };
    }
    const failure: HybridFetchResult = {
      blob: null,
      status: null,
      retryable: true,
      source: "exception",
      error: "firebase_object_path_fetch_failed",
    };
    rememberRecentAttachmentFetchFailure(url, failure);
    return failure;
  }
  if (!isEligibleAttachmentHttpsUrl(url)) {
    return { blob: null, status: null, retryable: false, source: "http_error", error: "ineligible_url" };
  }
  if (looksLikeFirebaseStorageDownloadUrl(url)) {
    const b = await runWithTimeoutSignal(
      (scopedSignal) => tryGetBlobFromFirebaseStorageDownloadUrl(url, scopedSignal),
      timeoutMs,
      signal
    ).catch(() => null);
    if (b && b.size > 0) {
      clearRecentAttachmentFetchFailure(url);
      return { blob: b, status: 200, retryable: false, source: "firebase_sdk" };
    }
    const pathFromUrl = tryGetStoragePathFromFirebaseDownloadUrl(url);
    if (pathFromUrl) {
      const b2 = await runWithTimeoutSignal(
        (_scopedSignal) => getBlobFromFirebaseObjectPath(pathFromUrl),
        timeoutMs,
        signal
      ).catch(() => null);
      if (b2 && b2.size > 0) {
        clearRecentAttachmentFetchFailure(url);
        clearRecentAttachmentFetchFailure(pathFromUrl);
        return { blob: b2, status: 200, retryable: false, source: "firebase_sdk" };
      }
    }
    const corsBlob = await runWithTimeoutSignal(
      (scopedSignal) => tryFetchFirebaseStorageDownloadUrlBlob(url, scopedSignal),
      timeoutMs,
      signal
    ).catch(() => null);
    if (corsBlob && corsBlob.size > 0) {
      clearRecentAttachmentFetchFailure(url);
      return { blob: corsBlob, status: 200, retryable: false, source: "http_fetch" };
    }
    const failure: HybridFetchResult = {
      blob: null,
      status: null,
      retryable: false,
      source: "exception",
      error: "firebase_storage_download_failed",
    };
    rememberRecentAttachmentFetchFailure(url, failure);
    return failure;
  }
  try {
    const res = await runWithTimeoutSignal(
      (scopedSignal) => fetch(url, { mode: "cors", credentials: "omit", signal: scopedSignal }),
      timeoutMs,
      signal
    );
    if (!res.ok) {
      const status = typeof res.status === "number" ? res.status : null;
      const retryable = status != null && RETRYABLE_HTTP.has(status);
      const failure: HybridFetchResult = {
        blob: null,
        status,
        retryable,
        source: "http_error",
        error: `http_${status ?? "unknown"}`,
      };
      rememberRecentAttachmentFetchFailure(url, failure);
      return failure;
    }
    const blob = await res.blob();
    if (blob && blob.size > 0) clearRecentAttachmentFetchFailure(url);
    return { blob, status: res.status, retryable: false, source: "http_fetch" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      blob: null,
      status: null,
      retryable: true,
      source: "exception",
      error: msg,
    };
  }
}

type CachedRow = {
  id: string;
  /** Original HTTPS — debug duplicate-key issues */
  url: string;
  blob: Blob;
  size: number;
  cachedAtMs: number;
  contentType: string | null;
};

type OfflineCacheMeta = {
  url: string;
  cachedAtMs: number;
};

export type OfflineCachedAttachmentNativeRef = {
  fileUri: string;
  displayUrl: string;
  contentType: string | null;
  size: number;
};

type HybridFetchResult = {
  blob: Blob | null;
  status: number | null;
  retryable: boolean;
  source: "firebase_sdk" | "http_fetch" | "http_error" | "exception";
  error?: string;
};

type PrefetchItemLogEvent = {
  url: string;
  attempt: number;
  status: number | null;
  ok: boolean;
  retryable: boolean;
  note: string;
};

const RETRYABLE_HTTP = new Set([429, 502, 503, 504]);
const PREFETCH_MAX_RETRIES = 3;
const PREFETCH_BASE_BACKOFF_MS = 350;
/** Stability guard: mobile warm-sync me zyada parallel download unstable; desktop par zyada workers. */
const PREFETCH_CONCURRENCY_HARD_MAX = 12;
/** Per-item guard: hung request worker ko indefinite block na kare (web). */
const PREFETCH_REQUEST_TIMEOUT_MS = 45_000;
/** APK/EXE: bade PDF/scan — 20s par retry storm se 20+ min warm avoid. */
const PREFETCH_REQUEST_TIMEOUT_EMBEDDED_MS = 120_000;

function prefetchRequestTimeoutMs(): number {
  return usesEmbeddedNativeAttachmentStorage()
    ? PREFETCH_REQUEST_TIMEOUT_EMBEDDED_MS
    : PREFETCH_REQUEST_TIMEOUT_MS;
}
/** Hover / FilePreview / openAttachment — cache miss par poora warm timeout mat lagao (user “tick” slow feel). */
function uiAttachmentCacheMissTimeoutMs(): number {
  return usesEmbeddedNativeAttachmentStorage() ? 22_000 : 7_500;
}

/** Static EXE/APK guard: broken remote URLs should not block every hover/page refresh. */
type AttachmentFetchFailureMemo = {
  untilMs: number;
  status: number | null;
  error: string;
};

const RECENT_ATTACHMENT_FETCH_FAILURE_TTL_MS = 10 * 60 * 1000;
const recentAttachmentFetchFailures = new Map<string, AttachmentFetchFailureMemo>();

function attachmentFetchFailureMemoKey(raw: string): string {
  const stable = getStableFirebaseObjectKey(raw);
  return (stable || offlineAttachmentCacheLookupKey(raw)).trim();
}

function readRecentAttachmentFetchFailure(raw: string): AttachmentFetchFailureMemo | null {
  const key = attachmentFetchFailureMemoKey(raw);
  if (!key) return null;
  const memo = recentAttachmentFetchFailures.get(key);
  if (!memo) return null;
  if (memo.untilMs <= Date.now()) {
    recentAttachmentFetchFailures.delete(key);
    return null;
  }
  return memo;
}

function rememberRecentAttachmentFetchFailure(raw: string, result: HybridFetchResult): void {
  if (result.blob?.size || result.retryable) return;
  const key = attachmentFetchFailureMemoKey(raw);
  if (!key) return;
  const error = result.error || result.source || "fetch_failed";
  recentAttachmentFetchFailures.set(key, {
    untilMs: Date.now() + RECENT_ATTACHMENT_FETCH_FAILURE_TTL_MS,
    status: result.status,
    error,
  });
  if (recentAttachmentFetchFailures.size > 500) {
    const now = Date.now();
    for (const [k, memo] of recentAttachmentFetchFailures) {
      if (memo.untilMs <= now || recentAttachmentFetchFailures.size > 500) {
        recentAttachmentFetchFailures.delete(k);
      }
      if (recentAttachmentFetchFailures.size <= 500) break;
    }
  }
}

function clearRecentAttachmentFetchFailure(raw: string): void {
  const key = attachmentFetchFailureMemoKey(raw);
  if (key) recentAttachmentFetchFailures.delete(key);
}

/** Parent abort + timeout: Firebase `getBlob` ignores signals, so race it with a timer. */
async function runWithTimeoutSignal<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (parentSignal?.aborted) ctrl.abort();
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  const ms = Math.max(1, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ctrl.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(new DOMException(`Timed out after ${ms}ms`, "TimeoutError"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

/** Retry delay with exponential backoff + jitter — Firebase throttling burst me workers stagger ho jayein. */
function backoffDelayMs(attempt: number): number {
  const exp = PREFETCH_BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 160);
  return exp + jitter;
}

/** Debug log helper: item-level success/failure visibility while warm progress row aggregate rehta hai. */
function emitPrefetchLog(
  event: PrefetchItemLogEvent,
  onItemLog?: (event: PrefetchItemLogEvent) => void
): void {
  try {
    onItemLog?.(event);
  } catch {
    /* callback errors should never break sync */
  }
  try {
    const expectedClientHttp =
      !event.ok &&
      !event.retryable &&
      event.status != null &&
      event.status >= 400 &&
      event.status < 500;
    const expectedPrefetchMiss =
      !event.ok &&
      (event.note === "firebase_storage_download_failed" ||
        event.note === "firebase_object_path_fetch_failed" ||
        event.note === "ineligible_url" ||
        event.note === "device_ref_fetch_failed");
    const level = event.ok
      ? "debug"
      : event.retryable
        ? "warn"
        : expectedPrefetchMiss || expectedClientHttp
          ? "warn"
          : "error";
    const msg = `[offlineAttachmentUrlCache] ${event.ok ? "OK" : "FAIL"} attempt=${event.attempt} status=${event.status ?? "n/a"} note=${event.note}`;
    if (level === "error") console.error(msg, event.url);
    else if (level === "warn") console.warn(msg, event.url);
    else if (process.env.NODE_ENV !== "production") console.debug(msg, event.url);
  } catch {
    /* ignore logging failures */
  }
}

/** Capacitor cache: URL hash id -> DataDirectory file path + SQLite metadata row. */
function offlineCacheDataDirPath(id: string, contentType?: string | null): string {
  let ext = "bin";
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("pdf")) ext = "pdf";
  else if (ct.includes("jpeg") || ct.includes("jpg") || ct.includes("jfif") || ct.includes("pjpeg")) ext = "jpg";
  else if (ct.includes("png")) ext = "png";
  else if (ct.includes("webp")) ext = "webp";
  else if (ct.includes("gif")) ext = "gif";
  return `attachments/offline-cache/${id}.${ext}`;
}

/**
 * Preview/open hot path: signed HTTPS URL, bare `voucher-files/…` path, stable object-key —
 * warm sync kabhi alag string se likhta hai, voucher row kabhi doosri — sab keys try karo.
 */
export async function tryOfflineCachedAttachmentBlobMultiKey(urlStr: string): Promise<Blob | null> {
  const trimmed = String(urlStr || "").trim();
  if (!trimmed) return null;

  // Pending `local:` — SHA hash loop se pehle direct IndexedDB get.
  const decoded = offlineCacheKeyForAttachmentRef(trimmed);
  if (isLocalFileRef(decoded || trimmed)) {
    const localBlob = await getBlobFromLocalFileRef(decoded || trimmed);
    if (localBlob && localBlob.size > 0) return localBlob;
  }

  const tryKey = async (key: string): Promise<Blob | null> => {
    const k = String(key || "").trim();
    if (!k) return null;
    const b = await getOfflineCachedAttachmentBlob(k);
    return b && b.size > 0 ? b : null;
  };

  let hit = await tryKey(trimmed);
  if (hit) return hit;

  const pathFromUrl = tryGetStoragePathFromFirebaseDownloadUrl(trimmed);
  if (pathFromUrl) {
    hit = await tryKey(pathFromUrl);
    if (hit) return hit;
    hit = await tryKey(`firebase-object:${pathFromUrl}`);
    if (hit) return hit;
  }

  const norm = normalizeFirebaseStorageObjectPathForSdk(trimmed);
  if (norm && norm !== trimmed) {
    hit = await tryKey(norm);
    if (hit) return hit;
  }

  return null;
}

async function readOfflineCacheBlobFromIndexedDb(
  ids: string[],
  originalInput?: string
): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDB();
    return await new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction("offlineAttachmentBlobs", "readonly");
        const st = tx.objectStore("offlineAttachmentBlobs");
        const tryAt = (idx: number) => {
          if (idx >= ids.length) {
            resolve(null);
            return;
          }
          const req = st.get(ids[idx]!);
          req.onerror = () => tryAt(idx + 1);
          req.onsuccess = () => {
            const row = req.result as CachedRow | undefined;
            if (row?.blob && row.blob.size) {
              if (offlineAttachmentForensicEnabled()) {
                console.warn("[FORENSIC_OFFLINE_CACHE_READ]", {
                  originalInput,
                  cacheHit: true,
                  blobSource: "indexeddb_offlineAttachmentBlobs",
                  idMatched: ids[idx],
                  byteSize: row.blob.size,
                });
              }
              resolve(row.blob);
            } else tryAt(idx + 1);
          };
        };
        tryAt(0);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/** Warm prefetch: disk/IDB par file maujood hai? — poora blob read mat karo (EXE par bahut slow). */
export async function isOfflineCachedAttachmentOnDevice(urlStr: string): Promise<boolean> {
  if (!supportsOfflineAttachmentLookup(urlStr)) return false;
  try {
    const ids = await getOfflineAttachmentStoreIdsForLookup(urlStr.trim());
    if (ids.length === 0) return false;

    if (usesEmbeddedNativeAttachmentStorage()) {
      for (const id of ids) {
        const row = await getAttachmentFileRef("offline_cache", id);
        if (!row?.filePath || Number(row.size || 0) <= 0) continue;
        if (await attachmentFileExistsInDataDir(row.filePath)) return true;
      }
      if (typeof indexedDB !== "undefined") {
        const legacy = await readOfflineCacheBlobFromIndexedDb(ids, urlStr);
        if (legacy && legacy.size > 0) return true;
      }
      return false;
    }

    if (typeof indexedDB === "undefined") return false;
    const db = await openDB();
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction("offlineAttachmentBlobs", "readonly");
        const st = tx.objectStore("offlineAttachmentBlobs");
        const tryAt = (idx: number) => {
          if (idx >= ids.length) {
            resolve(false);
            return;
          }
          const req = st.get(ids[idx]!);
          req.onerror = () => tryAt(idx + 1);
          req.onsuccess = () => {
            const row = req.result as CachedRow | undefined;
            resolve(!!(row?.blob && row.blob.size > 0));
          };
        };
        tryAt(0);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

/** Warm sync / preview: native disk+SQLite (APK/EXE) ya IndexedDB (web). */
export async function getOfflineCachedAttachmentBlob(urlStr: string): Promise<Blob | null> {
  if (!supportsOfflineAttachmentLookup(urlStr)) return null;
  try {
    const ids = await getOfflineAttachmentStoreIdsForLookup(urlStr.trim());
    if (ids.length === 0) return null;

    if (usesEmbeddedNativeAttachmentStorage()) {
      for (const id of ids) {
        const row = await getAttachmentFileRef("offline_cache", id);
        if (!row) continue;
        const b = await readAttachmentBlobFromDataDir(
          row.filePath,
          row.contentType,
          row.sha256Hex ?? undefined
        );
        if (b && b.size > 0) {
          return b;
        }
      }
      // Purana EXE build: IndexedDB me bytes the, SQLite row nahi — ek baar disk par migrate karo.
      const legacy = await readOfflineCacheBlobFromIndexedDb(ids, urlStr);
      if (legacy && legacy.size > 0) {
        void putCachedBlob(urlStr.trim(), legacy);
        return legacy;
      }
      return null;
    }

    return await readOfflineCacheBlobFromIndexedDb(ids, urlStr);
  } catch {
    return null;
  }
}

/** Native fast-path: APK `convertFileSrc`; EXE session `blob:` from disk (no HTTPS). */
export async function getOfflineCachedAttachmentNativeRef(
  urlStr: string
): Promise<OfflineCachedAttachmentNativeRef | null> {
  if (!usesEmbeddedNativeAttachmentStorage()) return null;
  if (!supportsOfflineAttachmentLookup(urlStr)) return null;
  try {
    const ids = await getOfflineAttachmentStoreIdsForLookup(urlStr.trim());
    if (ids.length === 0) return null;
    for (const id of ids) {
      const row = await getAttachmentFileRef("offline_cache", id);
      if (!row?.filePath) continue;
      const fileUri = await getAttachmentFileUriFromDataDir(row.filePath);
      if (!fileUri) continue;
      let displayUrl: string | null = null;
      if (isCapacitorNativeApp()) {
        displayUrl = Capacitor.convertFileSrc(fileUri);
      } else {
        displayUrl = await electronAttachmentDisplayUrlFromPath(row.filePath, row.contentType);
      }
      if (!displayUrl) continue;
      return {
        fileUri,
        displayUrl,
        contentType: row.contentType ?? null,
        size: Number(row.size || 0),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeOfflineCacheBlobToIndexedDb(
  ids: string[],
  urlStr: string,
  blob: Blob
): Promise<boolean> {
  const baseRow = {
    url: urlStr.trim(),
    blob,
    size: blob.size,
    cachedAtMs: Date.now(),
    contentType: blob.type?.trim() || null,
  };
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("offlineAttachmentBlobs", "readwrite");
      tx.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      try {
        const st = tx.objectStore("offlineAttachmentBlobs");
        for (const id of ids) {
          st.put({
            id,
            ...baseRow,
          } satisfies CachedRow);
        }
      } catch {
        resolve();
      }
    });
    return true;
  } catch {
    return false;
  }
}

async function putCachedBlob(urlStr: string, blob: Blob): Promise<boolean> {
  if (!blob?.size || blob.size > OFFLINE_ATTACHMENT_MAX_CACHED_BYTES) {
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_PUT]", {
        originalInput: urlStr,
        skipped: true,
        reason: !blob?.size ? "empty_blob" : "over_max_bytes",
        blobSize: blob?.size ?? 0,
      });
    }
    return false;
  }
  const ids = await getOfflineAttachmentStoreIdsForWrite(urlStr.trim());
  if (offlineAttachmentForensicEnabled()) {
    console.warn("[FORENSIC_OFFLINE_CACHE_PUT]", {
      originalInput: urlStr,
      blobSize: blob.size,
      contentType: blob.type || null,
      hashIdsWritten: ids,
      targetStore: usesEmbeddedNativeAttachmentStorage()
        ? "native_offline_cache_sqlite+disk"
        : "indexeddb_offlineAttachmentBlobs",
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  if (usesEmbeddedNativeAttachmentStorage()) {
    // APK/EXE: bytes disk par; SQLite row me path+meta (IndexedDB blob overhead avoid).
    const canonicalId = ids[0];
    if (!canonicalId) return false;
    const path = offlineCacheDataDirPath(canonicalId, blob.type || null);
    const ok = await writeAttachmentBlobToDataDir(path, blob);
    if (!ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[offlineAttachmentUrlCache] native disk write failed", {
          path,
          blobSize: blob.size,
        });
      }
      // Disk IPC fail: IndexedDB fallback taaki preview / offline reuse chale.
      const fbOk = await writeOfflineCacheBlobToIndexedDb(ids, urlStr, blob);
      if (fbOk) {
        void import("@/lib/attachmentLoadReady").then((m) => {
          m.markAttachmentUrlReady(urlStr);
          m.requestAttachmentUiRefresh();
        });
      }
      return fbOk;
    }
    const meta: OfflineCacheMeta = { url: urlStr.trim(), cachedAtMs: Date.now() };
    // Warm path: SHA-256 mat block karo — preview sirf disk bytes use karta hai.
    for (const id of ids) {
      await upsertAttachmentFileRef({
        scope: "offline_cache",
        id,
        filePath: path,
        contentType: blob.type?.trim() || null,
        size: blob.size,
        metaJson: JSON.stringify(meta),
        updatedAt: meta.cachedAtMs,
        sha256Hex: null,
      });
    }
    void import("@/lib/attachmentLoadReady").then((m) => {
      m.markAttachmentUrlReady(urlStr);
      m.requestAttachmentUiRefresh();
    });
    return true;
  }
  const ok = await writeOfflineCacheBlobToIndexedDb(ids, urlStr, blob);
  if (ok) {
    void import("@/lib/attachmentLoadReady").then((m) => {
      m.markAttachmentUrlReady(urlStr);
      m.requestAttachmentUiRefresh();
    });
  }
  return ok;
}

/** Upload ke turant baad: staff preview server re-fetch skip — pending blob se offline cache seed. */
export async function seedOfflineAttachmentCacheFromBlob(urlStr: string, blob: Blob): Promise<boolean> {
  const trimmed = String(urlStr || "").trim();
  if (!trimmed || !blob?.size) return false;
  return putCachedBlob(trimmed, blob);
}

/**
 * Preview path: SDK/fetch ke pehle cache; successful download ko background me IndexedDB rakho (offline rerun).
 */
export type RemoteAttachmentBlobPreferCacheOptions = {
  /** `drive:` par gallery me parallel `local:` ho to pehle wahi bytes use karo. */
  galleryUrls?: readonly string[];
  /** Google Drive download resolve ke liye company registry. */
  companyId?: string;
  /** Online lazy gate — embedded EXE/APK matches web visible-page rules. */
  company?: import("@/hooks/useCompany").Company | null;
  /** true = disk/IDB write complete hone ka wait (prefetch). false = turant blob return (preview). */
  awaitDiskWrite?: boolean;
  /** Local company gallery: cache miss par Firebase/network mat chalao. */
  localOnly?: boolean;
  /** Edit / open / hover — visible-page list bypass. */
  explicitUserRequest?: boolean;
  bypassVisiblePageCheck?: boolean;
};

export async function getRemoteAttachmentBlobPreferOfflineCache(
  urlStr: string,
  signal?: AbortSignal,
  preferCacheOptions?: RemoteAttachmentBlobPreferCacheOptions
): Promise<Blob | null> {
  const trimmed = offlineAttachmentCacheLookupKey(urlStr);
  if (!supportsOfflineAttachmentLookup(urlStr)) {
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_REMOTE_PREFER]", {
        originalInput: urlStr,
        trimmed,
        outcome: "unsupported_lookup_string",
        finalBlobSource: null,
      });
    }
    return null;
  }
  const cached = await tryOfflineCachedAttachmentBlobMultiKey(trimmed);
  if (cached && cached.size > 0) {
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_REMOTE_PREFER]", {
        originalInput: urlStr,
        trimmed,
        outcome: "return_primary_cache_hit",
        finalBlobSource: "indexeddb_or_native_cache_via_getOfflineCachedAttachmentBlob",
        byteSize: cached.size,
        navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      });
    }
    return cached;
  }
  // Tail-only mirror key alag ho to normalized path se doosri cache key try karo.
  const altKey = /^https?:\/\//i.test(trimmed) ? "" : normalizeFirebaseStorageObjectPathForSdk(trimmed);
  if (altKey && altKey !== trimmed) {
    const altCached = await getOfflineCachedAttachmentBlob(altKey);
    if (altCached && altCached.size > 0) {
      if (offlineAttachmentForensicEnabled()) {
        console.warn("[FORENSIC_OFFLINE_CACHE_REMOTE_PREFER]", {
          originalInput: urlStr,
          trimmed,
          altKey,
          outcome: "return_alt_key_cache_hit",
          finalBlobSource: "indexeddb_or_native_cache_via_alt_normalized_key",
          byteSize: altCached.size,
          navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
        });
      }
      return altCached;
    }
  }

  // Cache miss + offline: network/SDK fetch mat chalao — warna lamba hang / spinner (`HoverPreviewHttpsAwareImage`).
  // APK WebView: `navigator.onLine` kabhi galat false hota hai jab Firebase chal raha ho — thumbnail mat roko.
  if (typeof navigator !== "undefined" && !navigator.onLine && !usesEmbeddedNativeAttachmentStorage()) {
    if (offlineAttachmentForensicEnabled()) {
      console.warn("[FORENSIC_OFFLINE_CACHE_REMOTE_PREFER]", {
        originalInput: urlStr,
        trimmed,
        altKey: altKey || null,
        outcome: "offline_bailout_no_network_fetch",
        reason: "navigator.offline_and_not_capacitor",
        finalBlobSource: null,
        isCapacitorNativeApp: isCapacitorNativeApp(),
      });
    }
    return null;
  }

  // Cloud data sync off / Files tick off / visible-page gate: Firebase Storage network fetch mat karo.
  const attachmentSyncCompanyId = String(preferCacheOptions?.companyId || "").trim();
  const filesTickBlocks =
    isFirebaseLedgerDataSyncDisabled() ||
    preferCacheOptions?.localOnly === true ||
    (attachmentSyncCompanyId && !isFirebaseLedgerCompanyAttachmentSyncEnabled(attachmentSyncCompanyId));
  if (filesTickBlocks) {
    const isDeviceRef = isLocalFileRef(trimmed) || isDriveFileRef(trimmed);
    if (!isDeviceRef) {
      if (offlineAttachmentForensicEnabled()) {
        console.warn("[FORENSIC_OFFLINE_CACHE_REMOTE_PREFER]", {
          originalInput: urlStr,
          trimmed,
          outcome: "firebase_ledger_sync_disabled_no_network_fetch",
          finalBlobSource: null,
        });
      }
      return null;
    }
  } else if (!isLocalFileRef(trimmed) && !isDriveFileRef(trimmed)) {
    try {
      const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
      if (
        !isRemoteAttachmentNetworkFetchAllowed(trimmed, {
          companyId: attachmentSyncCompanyId || null,
          company: preferCacheOptions?.company ?? null,
          explicitUserRequest: preferCacheOptions?.explicitUserRequest,
          bypassVisiblePageCheck: preferCacheOptions?.bypassVisiblePageCheck,
        })
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }

  const fetchTarget = altKey && altKey !== trimmed && !/^https?:\/\//i.test(trimmed) ? altKey : trimmed;
  let fresh: Blob | null = null;
  const isDeviceRef = isLocalFileRef(trimmed) || isDriveFileRef(trimmed);
  let fetchResult: HybridFetchResult | null = null;
  if (isDeviceRef) {
    // `local:` / `drive:` — pending bytes pehle, phir Drive API (Firebase-style preload cache miss).
    fresh = await fetchAttachmentRefBlob(urlStr, {
      signal,
      galleryUrls: preferCacheOptions?.galleryUrls,
      companyId: preferCacheOptions?.companyId,
    });
  } else {
    fetchResult = await blobFromHybridFetch(fetchTarget, signal, uiAttachmentCacheMissTimeoutMs());
    fresh = fetchResult.blob;
  }
  if (offlineAttachmentForensicEnabled()) {
    console.warn("[FORENSIC_OFFLINE_CACHE_REMOTE_PREFER]", {
      originalInput: urlStr,
      trimmed,
      fetchTarget,
      hybridFetchSource: fetchResult?.source ?? (isDeviceRef ? "device_ref_fetch" : null),
      hybridFetchStatus: fetchResult?.status ?? null,
      hybridFetchError: fetchResult?.error ?? null,
      outcome: fresh && fresh.size > 0 ? "network_or_sdk_fresh_blob" : "fetch_returned_empty",
      finalBlobSource:
        fresh && fresh.size > 0
          ? isDeviceRef
            ? "local_pending_or_drive_api"
            : fetchResult?.source === "firebase_sdk"
              ? "firebase_sdk_getBlob_or_tryGetBlobFromFirebaseStorageDownloadUrl"
              : fetchResult?.source === "http_fetch"
                ? "http_fetch_cors"
                : String(fetchResult?.source ?? "unknown")
          : null,
      byteSize: fresh?.size ?? 0,
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  if (fresh?.size && fresh.size <= OFFLINE_ATTACHMENT_MAX_CACHED_BYTES) {
    const write = putCachedBlob(trimmed, fresh);
    if (usesEmbeddedNativeAttachmentStorage() && preferCacheOptions?.awaitDiskWrite === true) {
      await write;
    } else {
      void write;
    }
  }
  return fresh;
}

export type PrefetchAttachmentsProgress = {
  /** Success (new disk bytes) */
  cachedNew: number;
  skippedAlreadyCached: number;
  skippedBudget: number;
  failed: number;
};

/**
 * Bounded concurrent prefetch — full warm sync; existing cache ids skip GET.
 */
export async function prefetchHttpsAttachmentUrls(
  urls: Iterable<string>,
  options?: {
    /** Default 6 — zyada par mobile CPU/network saturate */
    concurrency?: number;
    /** Total byte budget rough cap (warm run). */
    maxTotalBytesApprox?: number;
    /** Max DISTINCT URLs attempted */
    maxUrls?: number;
    /** Visible ledger / UI — same run me pehle attempt; baaki mirror URLs skip nahi, sirf order */
    prioritizeUrls?: readonly string[];
    signal?: AbortSignal;
    /** Har URL attempt complete — first-login overlay attachment row % ke liye */
    onItemDone?: (done: number, total: number) => void;
    /** Per-item detailed log hook (success/failure/status) — diagnostics / telemetry ke liye. */
    onItemLog?: (event: PrefetchItemLogEvent) => void;
    /** Second warm pass: 0/total report se header % reset mat karo. */
    skipLeadingZeroReport?: boolean;
    /** `drive:` / cross-device `local:` resolve — active SQLite company id. */
    mirrorCompanyId?: string;
  }
): Promise<PrefetchAttachmentsProgress> {
  const prefetchCompanyId = String(options?.mirrorCompanyId || "").trim();
  if (
    isFirebaseLedgerDataSyncDisabled() ||
    (prefetchCompanyId && !isFirebaseLedgerCompanyAttachmentSyncEnabled(prefetchCompanyId))
  ) {
    return { cachedNew: 0, skippedAlreadyCached: 0, skippedBudget: 0, failed: 0 };
  }
  const uniq = [
    ...new Set(
      [...urls]
        .map((u) => offlineCacheKeyForAttachmentRef(String(u || "")) || String(u || "").trim())
        .filter((value) => value && isOfflineCacheableAttachmentRef(value))
    ),
  ];
  if (offlineAttachmentForensicEnabled()) {
    const rawDistinct = [...new Set([...urls].map((u) => String(u || "").trim()).filter((s) => s.length > 0))];
    const rejected = rawDistinct.filter((v) => !isOfflineCacheableAttachmentRef(v));
    console.warn("[FORENSIC_PREFETCH_INPUT_FILTER]", {
      rawDistinctCount: rawDistinct.length,
      acceptedDistinctCount: uniq.length,
      rejectedDistinctCount: rejected.length,
      rejectedSample: rejected.slice(0, 60),
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  uniq.sort(); // deterministic — prioritize ke baad baaki company files stable order
  const maxUrls = typeof options?.maxUrls === "number" ? Math.max(0, options.maxUrls) : 2500;
  const seenOrdered = new Set<string>();
  const ordered: string[] = [];
  for (const raw of options?.prioritizeUrls ?? []) {
    const value = offlineCacheKeyForAttachmentRef(String(raw || "")) || String(raw || "").trim();
    if (!value || !isOfflineCacheableAttachmentRef(value)) continue;
    if (seenOrdered.has(value)) continue;
    seenOrdered.add(value);
    ordered.push(value);
  }
  for (const value of uniq) {
    if (seenOrdered.has(value)) continue;
    seenOrdered.add(value);
    ordered.push(value);
  }
  const list = ordered.slice(0, maxUrls);
  // Strict pool cap: caller kitni bhi badi value de, worker pool max 6 hi rahe.
  const concurrency = Math.max(1, Math.min(PREFETCH_CONCURRENCY_HARD_MAX, options?.concurrency ?? 6));
  let remainingBudget = typeof options?.maxTotalBytesApprox === "number" ? Math.max(0, options!.maxTotalBytesApprox!) : 350 * 1024 * 1024;
  if (process.env.NODE_ENV === "development") {
    console.log("[offlineAttachmentUrlCache] prefetch_start", {
      inputUnique: uniq.length,
      totalItems: list.length,
      maxUrls,
      concurrency,
      remainingBudget,
    });
  }

  const progress: PrefetchAttachmentsProgress = {
    cachedNew: 0,
    skippedAlreadyCached: 0,
    skippedBudget: 0,
    failed: 0,
  };

  const totalItems = list.length;
  let doneItems = 0;
  const bump = () => {
    doneItems++;
    options?.onItemDone?.(doneItems, totalItems);
  };

  // Ek hi FIFO chain — parallel workers ki `remainingBudget` double-spend avoid
  let budgetChain = Promise.resolve();
  /** Bytes reserve karna — microtask FIFO se safe taaki prefetch cap stable rahe */
  function reserveBytesOrFail(bytes: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      budgetChain = budgetChain
        .then(() => {
          if (typeof bytes !== "number" || bytes <= 0 || bytes > remainingBudget) {
            resolve(false);
            return;
          }
          remainingBudget -= bytes;
          resolve(true);
        })
        .catch(() => resolve(false));
    });
  }

  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      if (options?.signal?.aborted) return;
      const i = idx++;
      if (i >= list.length) return;
      const u = list[i];
      if (process.env.NODE_ENV === "development") {
        console.log("[offlineAttachmentUrlCache] worker_start", { index: i, total: list.length, url: u });
      }
      try {
        const alreadyOnDevice = await isOfflineCachedAttachmentOnDevice(u);
        if (alreadyOnDevice) {
          progress.skippedAlreadyCached++;
          emitPrefetchLog(
            {
              url: u,
              attempt: 0,
              status: 200,
              ok: true,
              retryable: false,
              note: "already_cached",
            },
            options?.onItemLog
          );
          bump();
          continue;
        }
        let wrote = false;
        for (let attempt = 1; attempt <= PREFETCH_MAX_RETRIES; attempt++) {
          if (options?.signal?.aborted) break;
          let blob: Blob | null = null;
          let prefetchStatus: number | null = 200;
          let prefetchRetryable = false;
          let prefetchNote = "cached_new";
          if (isLocalFileRef(u) || isDriveFileRef(u)) {
            blob = await fetchAttachmentRefBlob(u, {
              signal: options?.signal,
              companyId: options?.mirrorCompanyId,
            });
            if (!blob?.size) {
              prefetchStatus = null;
              // Stale `local:` refs (source device) — retry se fayda nahi.
              prefetchRetryable = isDriveFileRef(u);
              prefetchNote = "device_ref_fetch_failed";
            }
          } else {
            const fetched = await blobFromHybridFetch(u, options?.signal);
            blob = fetched.blob;
            prefetchStatus = fetched.status;
            prefetchRetryable = fetched.retryable;
            prefetchNote = fetched.error || fetched.source;
          }
          if (!blob?.size) {
            emitPrefetchLog(
              {
                url: u,
                attempt,
                status: prefetchStatus,
                ok: false,
                retryable: prefetchRetryable,
                note: prefetchNote,
              },
              options?.onItemLog
            );
            if (prefetchRetryable && attempt < PREFETCH_MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
              continue;
            }
            break;
          }
          const reserved = await reserveBytesOrFail(blob.size);
          if (!reserved) {
            progress.skippedBudget++;
            emitPrefetchLog(
              {
                url: u,
                attempt,
                status: 0,
                ok: false,
                retryable: false,
                note: "budget_exceeded",
              },
              options?.onItemLog
            );
            break;
          }
          if (process.env.NODE_ENV === "development") {
            console.log("[offlineAttachmentUrlCache] cache_write_begin", {
              url: u,
              attempt,
              size: blob.size,
              contentType: blob.type || null,
            });
          }
          const stored = await putCachedBlob(u, blob);
          if (!stored) {
            emitPrefetchLog(
              {
                url: u,
                attempt,
                status: prefetchStatus,
                ok: false,
                retryable: true,
                note: "cache_write_failed",
              },
              options?.onItemLog
            );
            if (attempt < PREFETCH_MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
              continue;
            }
            break;
          }
          wrote = true;
          emitPrefetchLog(
            {
              url: u,
              attempt,
              status: prefetchStatus,
              ok: true,
              retryable: false,
              note: "cached_new",
            },
            options?.onItemLog
          );
          break;
        }
        if (wrote) progress.cachedNew++;
        else progress.failed++;
        bump();
      } catch (e) {
        progress.failed++;
        // Worker catch debug: network/path/fs exceptions direct logcat/inspect me readable rahein.
        console.error("[offlineAttachmentUrlCache] worker_catch", {
          url: u,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
        emitPrefetchLog(
          {
            url: u,
            attempt: PREFETCH_MAX_RETRIES,
            status: null,
            ok: false,
            retryable: true,
            note: e instanceof Error ? e.message : "worker_exception",
          },
          options?.onItemLog
        );
        bump();
      }
    }
  }

  if (totalItems === 0) {
    options?.onItemDone?.(0, 0);
  } else if (!options?.skipLeadingZeroReport) {
    // UI ko turant denominator mil jaye; pehla item slow/hang ho tab bhi 0/N visible rahe.
    options?.onItemDone?.(0, totalItems);
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  if (offlineAttachmentForensicEnabled()) {
    console.warn("[FORENSIC_PREFETCH_RUN_SUMMARY]", {
      progress,
      totalItems,
      attemptedListLength: list.length,
      maxUrlsApplied: maxUrls,
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  return progress;
}
/**
 * Offline-cache rows whose original ref starts with `prefix` (e.g. `pbatt:` = Pocket Ledger Server files):
 * count + bytes, optionally removing them (IndexedDB rows and native disk files). Used by the
 * "files on this device" storage control.
 */
export async function scanOrClearOfflineCachedAttachmentsByPrefix(
  prefix: string,
  clear: boolean
): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  const seenPaths = new Set<string>();
  if (usesEmbeddedNativeAttachmentStorage()) {
    try {
      const { listAttachmentFileRefs, deleteAttachmentFileRef } = await import("@/lib/attachmentFileRefStore");
      const { deleteAttachmentBlobFromDataDir } = await import("@/lib/capacitorAttachmentFs");
      const rows = await listAttachmentFileRefs("offline_cache");
      for (const row of rows) {
        let url = "";
        try {
          url = String((JSON.parse(row.metaJson || "{}") as { url?: string }).url || "");
        } catch {
          url = "";
        }
        if (!url.startsWith(prefix)) continue;
        if (!seenPaths.has(row.filePath)) {
          seenPaths.add(row.filePath);
          count += 1;
          bytes += Math.max(0, Number(row.size || 0));
          if (clear) {
            try {
              await deleteAttachmentBlobFromDataDir(row.filePath);
            } catch {
              /* ignore */
            }
          }
        }
        if (clear) {
          try {
            await deleteAttachmentFileRef("offline_cache", row.id);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* native index optional */
    }
  }
  if (typeof indexedDB === "undefined") return { count, bytes };
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction("offlineAttachmentBlobs", clear ? "readwrite" : "readonly");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        const req = tx.objectStore("offlineAttachmentBlobs").openCursor();
        req.onerror = () => resolve();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return;
          const row = cur.value as CachedRow | undefined;
          if (row && typeof row.url === "string" && row.url.startsWith(prefix)) {
            // two keys (exact + stable) can hold the same file: count once per url
            count += 1;
            bytes += Math.max(0, Number(row.size || 0));
            if (clear) cur.delete();
          }
          cur.continue();
        };
      } catch {
        resolve();
      }
    });
  } catch {
    /* ignore */
  }
  if (clear) {
    void import("@/lib/attachmentLoadReady").then((m) => m.requestAttachmentUiRefresh()).catch(() => {});
  }
  return { count, bytes };
}
