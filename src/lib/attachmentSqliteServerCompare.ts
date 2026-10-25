"use client";

/**
 * Pre-download: SQLite local bytes vs server (HTTPS) attachment refs.
 * Storage folder LIST nahi — company docs ke refs se compare, sirf missing download/upload.
 */

import type { Company } from "@/hooks/useCompany";
import { collectAttachmentRefsFromBackupData, probeAttachmentRefForBackup } from "@/lib/attachmentBackupBundle";
import { COLLECTIONS_TO_BACKUP } from "@/lib/companyBackupCollections";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { looksLikeFirebaseStorageObjectPath } from "@/lib/firebaseStorageDownloadUrl";
import { prefetchHttpsAttachmentUrls } from "@/lib/offlineAttachmentUrlCache";
import { isCloudBackedCompanyShape, runOfflineFullWarmSync } from "@/lib/offlineFullWarmSync";
import { backupPrefersLocalSnapshot } from "@/lib/backupLocalFirst";

const HTTPS_REF = /^https?:\/\//i;
const PROBE_CONCURRENCY = 4;

export type AttachmentCompareProgress = {
  phase: string;
  detail: string;
  percent?: number;
};

export type AttachmentSqliteServerCompare = {
  sqliteFileCount: number;
  serverFileCount: number;
  bothCount: number;
  notInSqlite: string[];
  notOnServer: string[];
};

function isRemoteAttachmentRef(ref: string): boolean {
  const s = ref.trim();
  if (!s || isLocalFileRef(s)) return false;
  return HTTPS_REF.test(s) || looksLikeFirebaseStorageObjectPath(s);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

async function loadBackupDataFromSqlite(
  companyId: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const backupData: Record<string, unknown> = {};
  for (const colName of COLLECTIONS_TO_BACKUP) {
    throwIfAborted(signal);
    backupData[colName] = (await listCompanyDocsFromBrowserDb(companyId, colName, {
      forBackupMerge: true,
    })) as Array<Record<string, unknown> & { id: string }>;
  }
  return backupData;
}

async function probeLocalBytes(
  refs: string[],
  companyId: string,
  signal: AbortSignal | undefined,
  onItem: (done: number, total: number) => void
): Promise<Set<string>> {
  const hasBytes = new Set<string>();
  if (refs.length === 0) return hasBytes;
  let next = 0;
  let done = 0;
  const total = refs.length;

  async function worker(): Promise<void> {
    for (;;) {
      throwIfAborted(signal);
      const i = next++;
      if (i >= refs.length) return;
      const ref = refs[i]!;
      const ok = await probeAttachmentRefForBackup(ref, signal, {
        localOnly: true,
        companyId,
        galleryUrls: refs,
      });
      if (ok) hasBytes.add(ref);
      done += 1;
      onItem(done, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, refs.length || 1) }, () => worker())
  );
  return hasBytes;
}

export async function scanAttachmentSqliteVsServer(args: {
  company: Company;
  companyId: string;
  signal?: AbortSignal;
  onProgress?: (p: AttachmentCompareProgress) => void;
}): Promise<AttachmentSqliteServerCompare> {
  const companyId = String(args.companyId || "").trim();
  if (!companyId) {
    return {
      sqliteFileCount: 0,
      serverFileCount: 0,
      bothCount: 0,
      notInSqlite: [],
      notOnServer: [],
    };
  }

  if (isCloudBackedCompanyShape(args.company) && typeof navigator !== "undefined" && navigator.onLine) {
    args.onProgress?.({
      phase: "Scanning",
      detail: "Reading company data from server into SQLite…",
      percent: 4,
    });
    throwIfAborted(args.signal);
    await runOfflineFullWarmSync({
      company: args.company,
      localCompanyId: companyId,
      signal: args.signal,
      includeAttachmentPrefetch: false,
      skipWarmBootstrapFlag: true,
    });
  }

  args.onProgress?.({ phase: "Scanning", detail: "Reading attachment links from SQLite…", percent: 12 });
  const backupData = await loadBackupDataFromSqlite(companyId, args.signal);
  const refs = collectAttachmentRefsFromBackupData(backupData);

  args.onProgress?.({
    phase: "Scanning",
    detail: `Checking ${refs.length} file(s) on this device…`,
    percent: 20,
  });
  const hasLocal = await probeLocalBytes(refs, companyId, args.signal, (done, total) => {
    args.onProgress?.({
      phase: "Scanning",
      detail: `Checking files ${done} / ${total}…`,
      percent: total <= 0 ? 90 : 20 + Math.round((done / total) * 70),
    });
  });

  const notInSqlite: string[] = [];
  const notOnServer: string[] = [];
  let sqliteFileCount = 0;
  let serverFileCount = 0;
  let bothCount = 0;

  for (const ref of refs) {
    const remote = isRemoteAttachmentRef(ref);
    const localRef = isLocalFileRef(ref);
    const localBytes = hasLocal.has(ref);
    if (localBytes) sqliteFileCount += 1;
    if (remote) serverFileCount += 1;
    if (remote && localBytes) bothCount += 1;
    if (remote && !localBytes) notInSqlite.push(ref);
    if (localRef) notOnServer.push(ref);
  }

  args.onProgress?.({ phase: "Ready", detail: "Scan complete.", percent: 100 });
  return { sqliteFileCount, serverFileCount, bothCount, notInSqlite, notOnServer };
}

export async function mergeAttachmentSqliteAndServer(args: {
  companyId: string;
  notInSqlite: string[];
  notOnServer: string[];
  signal?: AbortSignal;
  onProgress?: (p: AttachmentCompareProgress) => void;
}): Promise<{ downloaded: number; uploaded: number; failed: number; error?: string }> {
  const companyId = String(args.companyId || "").trim();
  const toDownload = args.notInSqlite.filter(isRemoteAttachmentRef);
  const toUpload = args.notOnServer.filter(isLocalFileRef);
  let downloaded = 0;
  let uploaded = 0;
  let failed = 0;
  let error: string | undefined;

  throwIfAborted(args.signal);

  if (toDownload.length > 0) {
    args.onProgress?.({
      phase: "Downloading",
      detail: `Loading ${toDownload.length} missing file(s) into SQLite…`,
      percent: 5,
    });
    const prefetch = await prefetchHttpsAttachmentUrls(toDownload, {
      concurrency: 6,
      maxUrls: backupPrefersLocalSnapshot() ? 50_000 : 12_000,
      maxTotalBytesApprox: backupPrefersLocalSnapshot() ? 8_000 * 1024 * 1024 : 2_500 * 1024 * 1024,
      signal: args.signal,
      onItemDone: (done, total) => {
        args.onProgress?.({
          phase: "Downloading",
          detail: `Download ${done} / ${total}`,
          percent: total <= 0 ? 50 : Math.min(50, Math.round((done / total) * 50)),
        });
      },
    });
    downloaded = prefetch.cachedNew + prefetch.skippedAlreadyCached;
    failed += prefetch.failed + prefetch.skippedBudget;
  }

  throwIfAborted(args.signal);

  if (toUpload.length > 0) {
    args.onProgress?.({
      phase: "Uploading",
      detail: `Sending ${toUpload.length} local file(s) to server…`,
      percent: 55,
    });
    const { syncPendingFilesForCompany } = await import("@/lib/localPendingFiles");
    const up = await syncPendingFilesForCompany(companyId, {
      forceUploadPendingBlob: true,
      onProgress: (done, total, fileName) => {
        args.onProgress?.({
          phase: "Uploading",
          detail: fileName ? `Upload ${done} / ${total} — ${fileName}` : `Upload ${done} / ${total}`,
          percent: total <= 0 ? 95 : 55 + Math.round((done / Math.max(1, total)) * 40),
        });
      },
    });
    uploaded = up.uploaded;
    failed += up.failed;
    if (up.lastError) error = up.lastError;
  }

  args.onProgress?.({
    phase: "Complete",
    detail: "SQLite and server updated for missing files only.",
    percent: 100,
  });
  return { downloaded, uploaded, failed, error };
}
