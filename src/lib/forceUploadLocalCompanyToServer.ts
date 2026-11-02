"use client";

/**
 * Company Profile — force upload: SQLite mirror + pending attachments deep scan → Firestore/Storage.
 */

import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } from "@/lib/firestoreToLocalCompanyPull";
import {
  deserializeLocalDbValue,
  listCompanyDocRawRowsWithLocalRefHint,
} from "@/lib/localCompanyDocMirror";
import { pushAllLocalCompanyDocsToFirestore } from "@/lib/migrateLocalCompanySubcollectionsToFirestore";
import {
  canSyncCompanyToServer,
  flushVoucherOutbox,
} from "@/lib/localVoucherOutbox";
import {
  getBlobFromLocalFileRef,
  getLocalFileRefMeta,
  getPendingFiles,
  isLocalFileRef,
  isValidPendingSubcollectionDocPath,
  listPendingFilesForCompany,
  LOCAL_FILE_PREFIX,
  putPendingFile,
  syncPendingFilesForCompany,
} from "@/lib/localPendingFiles";
import { syncPendingMasterMutations } from "@/lib/localPendingMasters";
import { syncPendingVoucherMutations } from "@/lib/localPendingVouchers";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import { flushPendingBrowserDbSave } from "@/lib/localSqlite";
import { yieldToMain } from "@/lib/yieldToMain";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import {
  buildStoragePathPrefix,
  companyUsesPocketLedgerStorage,
  POCKET_LEDGER_APP_ROOT,
  type CompanyStorageLayoutRow,
} from "@/lib/firebaseStoragePaths";

export type ForceUploadProgress = {
  phase: string;
  done: number;
  total: number;
  detail?: string;
};

export type ForceUploadMode = "full" | "docsOnly" | "filesOnly";

export type ForceUploadLocalCompanyResult = {
  ok: boolean;
  message?: string;
  docsPushed: number;
  outboxFlushed: number;
  outboxFailed: number;
  filesSynced: number;
  filesFailed: number;
  localRefsFound: number;
  localRefsRequeued: number;
  /** Pending/IDB me blob nahi mila (requeue se pehle). */
  localRefsMissingBytes: number;
  /** Storage pe file mili → `local:` HTTPS ban gaya. */
  localRefsRelinked: number;
  /** End par SQLite me abhi bhi `local:` + bytes missing. */
  localRefsStillStuck: number;
  /** Console / toast — pehle kuch stuck refs. */
  missingSample: string[];
  pendingMastersSynced: number;
  pendingMastersFailed: number;
  pendingVouchersSynced: number;
  pendingVouchersFailed: number;
  errors: string[];
};

const FORCE_UPLOAD_TRACE = "[FORCE_UPLOAD_TRACE]";

function forceUploadTrace(phase: string, detail: Record<string, unknown>): void {
  try {
    console.warn(FORCE_UPLOAD_TRACE, phase, detail);
  } catch {
    /* ignore */
  }
}

type LocalRefHit = {
  localId: string;
  docPath: string;
  field: string;
  storagePathPrefix: string;
  fileName?: string;
};

function inferStoragePathPrefix(
  collectionName: string,
  doc: Record<string, unknown>,
  fsCompanyId: string,
  fieldKey: string,
  usePocketLedger: boolean
): string {
  const voucherType =
    collectionName === "vouchers" ? String(doc.type || "journal").trim() || "journal" : undefined;
  return buildStoragePathPrefix({
    companyId: fsCompanyId,
    usePocketLedger,
    collectionName,
    fieldKey,
    voucherType,
  });
}

function scrapeLocalRefsFromValue(
  value: unknown,
  fieldKey: string,
  docPath: string,
  collectionName: string,
  doc: Record<string, unknown>,
  fsCompanyId: string,
  out: LocalRefHit[],
  depth: number,
  usePocketLedger: boolean
): void {
  if (depth > 24) return;
  if (typeof value === "string" && isLocalFileRef(value)) {
    const localId = value.slice(LOCAL_FILE_PREFIX.length).trim();
    if (!localId) return;
    out.push({
      localId,
      docPath,
      field: fieldKey,
      storagePathPrefix: inferStoragePathPrefix(collectionName, doc, fsCompanyId, fieldKey, usePocketLedger),
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scrapeLocalRefsFromValue(item, fieldKey, docPath, collectionName, doc, fsCompanyId, out, depth + 1, usePocketLedger);
    }
    return;
  }
  if (value && typeof value === "object") {
    const keepParentField = fieldKey === "unassignedFile";
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      scrapeLocalRefsFromValue(
        v,
        keepParentField ? fieldKey : k,
        docPath,
        collectionName,
        doc,
        fsCompanyId,
        out,
        depth + 1,
        usePocketLedger
      );
    }
  }
}

async function collectLocalRefsFromSqlite(
  localCompanyId: string,
  fsCompanyId: string,
  usePocketLedger: boolean
): Promise<LocalRefHit[]> {
  const hits: LocalRefHit[] = [];
  const seenDoc = new Set<string>();

  for (const collectionName of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
    await yieldToMain();
    const rawRows = await listCompanyDocRawRowsWithLocalRefHint(localCompanyId, fsCompanyId, collectionName);
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i]!;
      const docId = String(row.id ?? "").trim();
      if (!docId) continue;
      const docPath = `companies/${fsCompanyId}/${collectionName}/${docId}`;
      if (seenDoc.has(docPath)) continue;
      seenDoc.add(docPath);
      try {
        const parsed = JSON.parse(row.data) as Record<string, unknown>;
        const data = deserializeLocalDbValue(parsed) as Record<string, unknown>;
        for (const [k, v] of Object.entries(data)) {
          if (k === "id") continue;
          scrapeLocalRefsFromValue(v, k, docPath, collectionName, data, fsCompanyId, hits, 0, usePocketLedger);
        }
      } catch {
        /* corrupt row */
      }
      if (i > 0 && i % 20 === 0) await yieldToMain();
    }
  }
  return hits;
}

function preferPendingStoragePathPrefix(
  hit: LocalRefHit,
  meta: { storagePathPrefix?: string } | null | undefined,
  fallbackCompanyId: string
): string {
  const metaPrefix = String(meta?.storagePathPrefix || "").trim();
  const hitPrefix = String(hit.storagePathPrefix || "").trim();
  const pocketRoot = `${POCKET_LEDGER_APP_ROOT}/`;
  // Fresh scrape (hit) wins over stale IDB meta after folder-structure migrate.
  if (hitPrefix.startsWith(pocketRoot)) return hitPrefix;
  if (metaPrefix.startsWith(pocketRoot)) return metaPrefix;
  if (hitPrefix) return hitPrefix;
  if (metaPrefix) return metaPrefix;
  return `companies/${fallbackCompanyId}/attachments`;
}

/** Pending miss hone par offline preview cache se bytes recover. */
async function resolveBlobForForceRequeue(
  localRef: string,
  companyId: string
): Promise<{ blob: Blob | null; source: "pending" | "offline_cache" | "none" }> {
  const pendingBlob = await getBlobFromLocalFileRef(localRef, {
    companyId,
    context: "forceUpload",
  });
  if (pendingBlob && pendingBlob.size > 0) {
    return { blob: pendingBlob, source: "pending" };
  }
  try {
    const { getOfflineCachedAttachmentBlob } = await import("@/lib/offlineAttachmentUrlCache");
    const cached = await getOfflineCachedAttachmentBlob(localRef);
    if (cached && cached.size > 0) {
      return { blob: cached, source: "offline_cache" };
    }
  } catch {
    /* ignore */
  }
  return { blob: null, source: "none" };
}

async function requeueLocalAttachmentRefs(
  hits: LocalRefHit[],
  pendingIds: Set<string>,
  companyId: string
): Promise<{ requeued: number; missingBytes: number; rescuedFromCache: number; missingSample: string[] }> {
  let requeued = 0;
  let missingBytes = 0;
  let rescuedFromCache = 0;
  const seen = new Set<string>();
  const missingSample: string[] = [];

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    if (seen.has(hit.localId)) continue;
    seen.add(hit.localId);

    const ref = `${LOCAL_FILE_PREFIX}${hit.localId}`;
    const meta = await getLocalFileRefMeta(ref);
    const resolved = await resolveBlobForForceRequeue(ref, companyId);
    const blob = resolved.blob;
    if (!blob || blob.size <= 0) {
      missingBytes++;
      const sample = `${hit.docPath}#${hit.field} → ${hit.localId.slice(0, 12)}…`;
      if (missingSample.length < 8) missingSample.push(sample);
      forceUploadTrace("MISSING_BYTES", {
        localId: hit.localId,
        docPath: hit.docPath,
        field: hit.field,
        storagePathPrefix: hit.storagePathPrefix,
        hasMeta: Boolean(meta),
        metaFileName: meta?.fileName || null,
        metaDocPath: meta?.docPath || null,
      });
      continue;
    }
    if (resolved.source === "offline_cache") {
      rescuedFromCache++;
      forceUploadTrace("RESCUED_OFFLINE_CACHE", {
        localId: hit.localId,
        docPath: hit.docPath,
        field: hit.field,
        bytes: blob.size,
      });
    }

    const alreadyQueued = pendingIds.has(hit.localId);
    const docPath = isValidPendingSubcollectionDocPath(hit.docPath)
      ? hit.docPath
      : isValidPendingSubcollectionDocPath(meta?.docPath || "")
        ? String(meta?.docPath)
        : hit.docPath;
    const cidFromPath = /^companies\/([^/]+)\//.exec(hit.docPath)?.[1] || "unknown";
    // Already queued (restore orphan path / stale field) — blob rakho, target meta refresh.
    if (alreadyQueued) {
      const existing = (await getPendingFiles()).find((p) => p.id === hit.localId);
      if (existing?.blob && existing.blob.size > 0) {
        const nextPath = isValidPendingSubcollectionDocPath(docPath) ? docPath : existing.docPath;
        const pathStale =
          nextPath !== existing.docPath ||
          (hit.field && hit.field !== existing.field) ||
          preferPendingStoragePathPrefix(hit, meta, cidFromPath) !== existing.storagePathPrefix;
        if (pathStale && isValidPendingSubcollectionDocPath(nextPath)) {
          await putPendingFile({
            ...existing,
            docPath: nextPath,
            field: hit.field || meta?.field || existing.field || "fileUrls",
            storagePathPrefix: preferPendingStoragePathPrefix(hit, meta, cidFromPath),
            fileName: meta?.fileName || hit.fileName || existing.fileName,
          });
          forceUploadTrace("PENDING_META_REFRESH", {
            localId: hit.localId,
            docPath: nextPath,
            field: hit.field || existing.field,
          });
        }
      } else if (blob.size > 0) {
        // Queue id hai lekin blob empty — cache/pending read se heal.
        await putPendingFile({
          id: hit.localId,
          blob,
          contentType: meta?.contentType || blob.type || "application/octet-stream",
          docPath: isValidPendingSubcollectionDocPath(docPath)
            ? docPath
            : existing?.docPath || docPath,
          field: hit.field || meta?.field || existing?.field || "fileUrls",
          storagePathPrefix: preferPendingStoragePathPrefix(hit, meta, cidFromPath),
          fileName: meta?.fileName || hit.fileName || existing?.fileName,
        });
        requeued++;
        forceUploadTrace("HEALED_EMPTY_PENDING", {
          localId: hit.localId,
          source: resolved.source,
          bytes: blob.size,
        });
      }
      continue;
    }
    await putPendingFile({
      id: hit.localId,
      blob,
      contentType: meta?.contentType || blob.type || "application/octet-stream",
      docPath,
      field: hit.field || meta?.field || "fileUrls",
      storagePathPrefix: preferPendingStoragePathPrefix(hit, meta, cidFromPath),
      fileName: meta?.fileName || hit.fileName,
    });
    requeued++;
    pendingIds.add(hit.localId);
    forceUploadTrace("REQUEUED", {
      localId: hit.localId,
      docPath,
      field: hit.field,
      source: resolved.source,
      bytes: blob.size,
      storagePathPrefix: preferPendingStoragePathPrefix(hit, meta, cidFromPath),
    });
    if (i > 0 && i % 5 === 0) await yieldToMain();
  }

  forceUploadTrace("REQUEUE_SUMMARY", {
    hits: hits.length,
    unique: seen.size,
    requeued,
    missingBytes,
    rescuedFromCache,
  });
  return { requeued, missingBytes, rescuedFromCache, missingSample };
}

async function flushOutboxUntilIdle(maxRounds = 8): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const { getBrowserDbForNamespace } = await import("@/lib/localSqlite");
  const { SQLITE_STORAGE_NAMESPACES } = await import("@/lib/sqliteStorageNamespace");
  for (let i = 0; i < maxRounds; i++) {
    let count = 0;
    for (const ns of SQLITE_STORAGE_NAMESPACES) {
      const db = await getBrowserDbForNamespace(ns);
      const pending = db?.prepare(`SELECT COUNT(*) AS c FROM sync_outbox`).get() as { c?: number } | undefined;
      count += Number(pending?.c ?? 0);
    }
    if (!count) break;
    const round = await flushVoucherOutbox();
    ok += round.ok;
    failed += round.failed;
    if (round.ok === 0 && round.failed === 0) break;
  }
  return { ok, failed };
}

async function syncCompanyFilesUntilIdle(
  companyId: string,
  maxRounds = 6,
  onProgress?: (done: number, total: number, detail?: string) => void,
  forceUploadPendingBlob = false
): Promise<{ synced: number; failed: number; lastError?: string }> {
  let synced = 0;
  let failed = 0;
  let lastError: string | undefined;
  let cumulativeDone = 0;
  const initialTotal = Math.max(1, (await listPendingFilesForCompany(companyId)).length);
  for (let i = 0; i < maxRounds; i++) {
    const remaining = await listPendingFilesForCompany(companyId);
    if (!remaining.length) break;
    const total = Math.max(initialTotal, remaining.length, synced + remaining.length);
    const round = await syncPendingFilesForCompany(companyId, {
      onProgress: (done, _total, fileName) => {
        onProgress?.(cumulativeDone + done, total, fileName);
      },
      forceUploadPendingBlob,
    });
    cumulativeDone += round.synced + round.failed;
    synced += round.synced;
    failed += round.failed;
    if (round.lastError) lastError = round.lastError;
    onProgress?.(cumulativeDone, total);
    if (round.synced === 0 && round.failed === 0) break;
    await yieldToMain();
  }
  return { synced, failed, lastError };
}

/**
 * Deep scan local SQLite + pending file store; push unsynced ledger rows and attachments to server.
 */
export async function forceUploadLocalCompanyToServer(
  localCompanyId: string,
  options?: {
    mode?: ForceUploadMode;
    onProgress?: (p: ForceUploadProgress) => void;
    /** Restore resume: cumulative progress offset (files already uploaded). */
    progressBaseline?: number;
    /** Restore resume: fixed total file count across tabs. */
    progressTotal?: number;
    /** Online restore: upload pending blobs even when Firestore doc lacks `local:` needle. */
    forceRestorePendingUpload?: boolean;
    /** With-files restore data phase: strip HTTPS + local: from cloud docs. */
    omitAllAttachmentUrls?: boolean;
  }
): Promise<ForceUploadLocalCompanyResult> {
  const mode = options?.mode ?? "full";
  const onProgress = options?.onProgress;
  const progressBaseline = Math.max(0, options?.progressBaseline ?? 0);
  const progressTotalFixed = options?.progressTotal;
  const forceUploadPendingBlob = options?.forceRestorePendingUpload === true;
  const report = (phase: string, done: number, total: number, detail?: string) => {
    const cumulativeDone = progressBaseline + done;
    const cumulativeTotal = Math.max(total, progressTotalFixed ?? total, cumulativeDone);
    onProgress?.({ phase, done: cumulativeDone, total: cumulativeTotal, detail });
  };
  const cid = String(localCompanyId || "").trim();
  const empty: ForceUploadLocalCompanyResult = {
    ok: false,
    docsPushed: 0,
    outboxFlushed: 0,
    outboxFailed: 0,
    filesSynced: 0,
    filesFailed: 0,
    localRefsFound: 0,
    localRefsRequeued: 0,
    localRefsMissingBytes: 0,
    localRefsRelinked: 0,
    localRefsStillStuck: 0,
    missingSample: [],
    pendingMastersSynced: 0,
    pendingMastersFailed: 0,
    pendingVouchersSynced: 0,
    pendingVouchersFailed: 0,
    errors: [],
  };
  if (!cid) {
    return { ...empty, message: "No company selected." };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ...empty, message: "You are offline. Connect to the internet and try again." };
  }
  if (!(await canSyncCompanyToServer(cid))) {
    return {
      ...empty,
      message: "This company is device-only (not configured for cloud sync).",
    };
  }

  // Pocket Ledger Server (PocketBase) company: incremental push to the server (pending outbox rows, files with
  // `local:` refs, dirty root) - never Firestore, never a full re-read / re-write of every document.
  {
    const pbRegistryRow = await getLocalCompanyById(cid, { includeDeleted: true });
    if (isPocketBaseCompany(cid, pbRegistryRow)) {
      const { syncPocketBaseCompanyNow } = await import("@/lib/syncCompanyNow");
      const r = await syncPocketBaseCompanyNow(cid, {
        onProgress: (p) => report(p.phase, p.done, p.total, p.detail),
      });
      const failedStatus = r.status === "error" || r.status === "offline" || r.status === "signed_out";
      return {
        ...empty,
        ok: !failedStatus && (r.status !== "partial" || r.pushed > 0),
        message: failedStatus || r.status === "partial" ? r.message : undefined,
        docsPushed: r.pushed,
        outboxFlushed: r.pushed,
        outboxFailed: r.failed,
        localRefsFound: r.filesQueued + r.stuckFiles,
        localRefsRequeued: r.filesQueued,
        localRefsMissingBytes: r.stuckFiles,
        localRefsStillStuck: r.stuckFiles,
        errors: r.status === "partial" || r.status === "error" ? [r.message] : [],
      };
    }
  }

  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(cid);
  const localCompanyRow = await getLocalCompanyById(cid, { includeDeleted: true });
  const companyRef = doc(firestore, "companies", fsCompanyId);
  const companySnap = await getDoc(companyRef);
  const usePocketLedger =
    companyUsesPocketLedgerStorage(localCompanyRow) ||
    (companySnap.exists() &&
      companyUsesPocketLedgerStorage(companySnap.data() as CompanyStorageLayoutRow));
  if (!companySnap.exists() && mode !== "docsOnly") {
    return {
      ...empty,
      message: "Company is not on the server yet. Wait for initial sync or use Upload to cloud first.",
    };
  }

  const errors: string[] = [];

  let localRefs: LocalRefHit[] = [];
  let requeued = 0;
  let missingBytes = 0;
  let rescuedFromCache = 0;
  let missingSample: string[] = [];
  if (mode !== "docsOnly") {
    localRefs = await collectLocalRefsFromSqlite(cid, fsCompanyId, usePocketLedger);
    await yieldToMain();
    const pending = await getPendingFiles();
    const pendingIds = new Set(pending.map((p) => p.id));
    forceUploadTrace("SCAN", {
      companyId: cid,
      fsCompanyId,
      usePocketLedger,
      localRefs: localRefs.length,
      pendingForAllCompanies: pending.length,
      mode,
    });
    const rq = await requeueLocalAttachmentRefs(localRefs, pendingIds, cid);
    requeued = rq.requeued;
    missingBytes = rq.missingBytes;
    rescuedFromCache = rq.rescuedFromCache;
    missingSample = rq.missingSample;
    await yieldToMain();
  }

  let fileRound1: { synced: number; failed: number; lastError?: string } = { synced: 0, failed: 0 };
  if (mode !== "docsOnly") {
    const pendingTotal = Math.max(1, (await listPendingFilesForCompany(cid)).length, localRefs.length);
    const fileProgress = (done: number, total: number, detail?: string) => {
      report("Uploading attachments", done, Math.max(total, pendingTotal), detail);
    };
    fileProgress(0, pendingTotal);
    fileRound1 = await syncCompanyFilesUntilIdle(
      cid,
      forceUploadPendingBlob ? 4 : 6,
      fileProgress,
      forceUploadPendingBlob
    );
    await yieldToMain();
  }

  let docsPushed = 0;
  if (mode !== "filesOnly") {
    report("Uploading company data", 0, COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS.length);
    try {
      const { pushed, errors: pushErrors } = await pushAllLocalCompanyDocsToFirestore(fsCompanyId, {
        sqliteCompanyId: cid,
        omitLocalFileRefs: true,
        omitAllAttachmentUrls: options?.omitAllAttachmentUrls === true,
        onCollectionProgress: (col, index, total) => {
          report("Uploading company data", index + 1, total, col.replace(/_/g, " "));
        },
      });
      docsPushed += pushed;
      if (pushErrors.length) errors.push(...pushErrors.slice(0, 5));
    } catch (e) {
      errors.push(`Document push: ${e instanceof Error ? e.message : String(e)}`);
    }
    await yieldToMain();
  }

  let outboxFlush = { ok: 0, failed: 0 };
  if (mode !== "filesOnly") {
    outboxFlush = await flushOutboxUntilIdle();
    await yieldToMain();
  }

  let fileRound2: { synced: number; failed: number; lastError?: string } = { synced: 0, failed: 0 };
  let fileRound3: { synced: number; failed: number; lastError?: string } = { synced: 0, failed: 0 };
  // filesOnly restore: round 1 enough — round 2/3 doc/outbox ke baad hain, warna 42/42 par atak jata hai.
  if (mode !== "docsOnly" && mode !== "filesOnly") {
    const fileProgress2 = (done: number, total: number, detail?: string) => {
      report(
        "Uploading attachments",
        fileRound1.synced + fileRound1.failed + done,
        Math.max(total, fileRound1.synced + fileRound1.failed + total),
        detail
      );
    };
    fileRound2 = await syncCompanyFilesUntilIdle(cid, 6, fileProgress2, forceUploadPendingBlob);
    await yieldToMain();
  }

  let masterResult = { synced: 0, failed: 0 };
  let voucherResult = { synced: 0, failed: 0 };
  if (mode !== "filesOnly") {
    masterResult = await syncPendingMasterMutations();
    await yieldToMain();
    voucherResult = await syncPendingVoucherMutations();
    await yieldToMain();
  }

  if (mode !== "docsOnly" && mode !== "filesOnly") {
    const baseDone = fileRound1.synced + fileRound1.failed + fileRound2.synced + fileRound2.failed;
    fileRound3 = await syncCompanyFilesUntilIdle(cid, 6, (done, total, detail) => {
      report("Uploading attachments", baseDone + done, Math.max(total, baseDone + total), detail);
    }, forceUploadPendingBlob);
  }

  const filesSynced = fileRound1.synced + fileRound2.synced + fileRound3.synced;
  const filesFailed = fileRound1.failed + fileRound2.failed + fileRound3.failed;
  if (fileRound3.lastError || fileRound2.lastError || fileRound1.lastError) {
    errors.push(fileRound3.lastError || fileRound2.lastError || fileRound1.lastError || "");
  }

  let localRefsRelinked = 0;
  let localRefsStillStuck = 0;
  // Full + filesOnly: pending empty / bytes gayab → Storage se HTTPS recovery.
  if (mode !== "docsOnly" && (missingBytes > 0 || localRefs.length > 0)) {
    report("Linking file URLs", 0, 1, "Checking Firebase Storage for stuck local: refs…");
    try {
      const { relinkLocalAttachmentsFromFirebaseStorage } = await import(
        "@/lib/relinkLocalAttachmentsFromStorage"
      );
      const relink = await relinkLocalAttachmentsFromFirebaseStorage(cid);
      localRefsRelinked = relink.relinked;
      forceUploadTrace("RELINK", {
        localRefs: relink.localRefs,
        relinked: relink.relinked,
        missed: relink.missed,
      });
    } catch (e) {
      console.warn("[forceUpload] relink local→HTTPS failed", e);
      forceUploadTrace("RELINK_FAILED", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // Re-scan: jo local: bach gaya woh truly stuck.
    try {
      const remainingHits = await collectLocalRefsFromSqlite(cid, fsCompanyId, usePocketLedger);
      const seen = new Set<string>();
      const stillSample: string[] = [];
      for (const hit of remainingHits) {
        if (seen.has(hit.localId)) continue;
        seen.add(hit.localId);
        const blob = await getBlobFromLocalFileRef(`${LOCAL_FILE_PREFIX}${hit.localId}`, {
          companyId: cid,
          context: "forceUpload-recount",
        });
        if (!blob || blob.size <= 0) {
          localRefsStillStuck++;
          if (stillSample.length < 8) {
            stillSample.push(`${hit.docPath}#${hit.field} → ${hit.localId.slice(0, 12)}…`);
          }
          forceUploadTrace("STILL_STUCK", {
            localId: hit.localId,
            docPath: hit.docPath,
            field: hit.field,
          });
        }
      }
      if (stillSample.length) missingSample = stillSample;
      forceUploadTrace("FINAL", {
        filesSynced,
        filesFailed,
        missingBytesAtScan: missingBytes,
        rescuedFromCache,
        localRefsRelinked,
        localRefsStillStuck,
        remainingLocalRefs: remainingHits.length,
      });
    } catch (e) {
      localRefsStillStuck = missingBytes;
      forceUploadTrace("RECOUNT_FAILED", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    report("Linking file URLs", 1, 1, `${localRefsRelinked} linked · ${localRefsStillStuck} still missing bytes`);
  }

  let ok =
    errors.length === 0 ||
    docsPushed > 0 ||
    filesSynced > 0 ||
    localRefsRelinked > 0 ||
    outboxFlush.ok > 0 ||
    masterResult.synced > 0 ||
    voucherResult.synced > 0;

  // Restore files phase: bucket pe pehle se upload / orphan queue = false "Nothing uploaded" mat dikhao.
  if (mode === "filesOnly" && forceUploadPendingBlob) {
    const remainingPending = (await listPendingFilesForCompany(cid)).length;
    if (remainingPending === 0 || filesSynced > 0 || localRefs.length > 0) {
      ok = true;
      // Stale lastError (orphan / already-on-cloud) user ko internet error mat dikhao.
      if (filesSynced === 0 || remainingPending === 0) {
        errors.length = 0;
      }
    }
  }

  if (localRefsStillStuck === 0 && (filesSynced > 0 || localRefsRelinked > 0 || docsPushed > 0)) {
    ok = true;
  }

  return {
    ok,
    message: ok
      ? undefined
      : "Nothing was uploaded. Check internet connection and try again.",
    docsPushed,
    outboxFlushed: outboxFlush.ok,
    outboxFailed: outboxFlush.failed,
    filesSynced,
    filesFailed,
    localRefsFound: localRefs.length,
    localRefsRequeued: requeued,
    localRefsMissingBytes: missingBytes,
    localRefsRelinked,
    localRefsStillStuck,
    missingSample,
    pendingMastersSynced: masterResult.synced,
    pendingMastersFailed: masterResult.failed,
    pendingVouchersSynced: voucherResult.synced,
    pendingVouchersFailed: voucherResult.failed,
    errors: errors.filter(Boolean),
  };
}
