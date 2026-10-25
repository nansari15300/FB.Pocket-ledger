"use client";

import { listCompanyDocsFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { COLLECTIONS_TO_BACKUP } from "@/lib/companyBackupCollections";
import { fetchAttachmentRefBlob } from "@/lib/attachmentRefBlobFetch";
import { getLocalCompanyById, removeLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { getBrowserDbForCompanyId } from "@/lib/localSqlite";
import { logLocalCloudSync } from "@/lib/localCloudSync/logger";
import { isCloudSyncTrackableFileRef } from "@/lib/localCloudSync/syncSummaryAttachments";
import { uploadPendingAttachmentPayloadToDrive } from "@/lib/localCloudSync/driveCloudSyncClient";
import { isDriveFileRef } from "@/lib/localCloudSync/pocketLedgerDrivePaths";
import { isLocalFileRef, putPendingFile, getPendingFiles, LOCAL_FILE_PREFIX } from "@/lib/localPendingFiles";
import { setCloudSyncCursor } from "@/lib/localCloudSync/queue";
import type { CloudSyncManifest } from "@/lib/localCloudSync/types";
import { readCloudSyncConfigFromCompany } from "@/lib/localCloudSync/companyConfig";
import { postDriveJsonViaClient } from "@/lib/localCloudSync/driveApiClient";
import { getDriveApiUser, hasDriveApiAuthSession } from "@/lib/firebaseAuthForApi";
import { warnLocalCloudSync } from "@/lib/localCloudSync/logger";
import type { LocalCompanyDoc } from "@/lib/localCompanyStore";
import {
  buildStoragePathPrefix,
  companyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";

export type DriveFullReuploadPrepResult = {
  prepared: boolean;
  unsyncedOps: number;
  backfilledRows: number;
  requeuedLocalFiles: number;
  reuploadedDriveRefs: number;
};

async function isOwnerDeviceForDriveRepair(row: LocalCompanyDoc | null | undefined): Promise<boolean> {
  if (!row) return false;
  if ((row as { driveSharedJoin?: unknown }).driveSharedJoin === true) return false;
  const ownerEmail = String(row.ownerEmail || "").trim().toLowerCase();
  if (!ownerEmail) return true;
  try {
    const user = await getDriveApiUser();
    const email = String(user.email || "").trim().toLowerCase();
    return !email || email === ownerEmail;
  } catch {
    return false;
  }
}

function isAliveDoc(row: Record<string, unknown>): boolean {
  return row.isDeleted !== true;
}

/** Drive folder khali / delete ho gaya — local pehle sync ho chuka ho. */
export function shouldPrepareDriveFullReuploadFromLocal(input: {
  manifest: CloudSyncManifest;
  remoteOpCount: number;
  lastSyncedOp: number;
  historicalBackfillDone: boolean;
  force?: boolean;
}): boolean {
  if (input.force) return true;
  const driveEmpty =
    (Number(input.manifest.latestOp) || 0) === 0 && (Number(input.remoteOpCount) || 0) === 0;
  if (!driveEmpty) return false;
  return input.lastSyncedOp > 0 || input.historicalBackfillDone === true;
}

/**
 * @deprecated Prefer `processDriveFolderRepairGate` — repair ab 2 min delay + owner confirm ke saath hota hai.
 * Returns true jab repair apply ho chuka ho (fresh upload queue).
 */
export async function ensureFreshDriveSyncWhenDriveFolderMissing(companyId: string): Promise<boolean> {
  const { processDriveFolderRepairGate } = await import("@/lib/localCloudSync/driveFolderRepair");
  const gate = await processDriveFolderRepairGate(companyId);
  return gate.action === "applied";
}

export async function unsyncCloudSyncOutboxForCompany(companyId: string): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!cid) return 0;
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return 0;
  const res = db
    .prepare(
      `UPDATE cloud_sync_outbox SET synced_at = NULL WHERE company_id = ? AND synced_at IS NOT NULL`
    )
    .run(cid);
  return Number(res.changes) || 0;
}

export async function clearCloudSyncHistoricalBackfillDone(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return;
  if ((reg as { cloudSyncHistoricalBackfillDone?: boolean }).cloudSyncHistoricalBackfillDone !== true) return;
  await upsertLocalCompany({
    ...reg,
    cloudSyncHistoricalBackfillDone: false,
    updatedAt: Date.now(),
  });
}

/** Drive wipe / fresh sync — local bytes (offline cache, electron disk, pending). */
async function resolveLocalBytesForDriveReupload(ref: string, companyId: string): Promise<Blob | null> {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return null;

  let blob = await fetchAttachmentRefBlob(trimmed, { companyId });
  if (blob && blob.size > 0) return blob;

  try {
    const { tryOfflineCachedAttachmentBlobMultiKey, getAttachmentBlobForBackupEmbed } = await import(
      "@/lib/offlineAttachmentUrlCache"
    );
    blob = await tryOfflineCachedAttachmentBlobMultiKey(trimmed);
    if (blob && blob.size > 0) return blob;
    blob = await getAttachmentBlobForBackupEmbed(trimmed, { skipDiskWrite: true });
    if (blob && blob.size > 0) return blob;
  } catch {
    /* optional caches */
  }

  return null;
}

function inferStoragePathPrefix(
  collection: string,
  doc: Record<string, unknown>,
  companyId: string,
  field: string,
  usePocketLedger: boolean
): string {
  const voucherType =
    collection === "vouchers" ? String(doc.voucherType ?? doc.type ?? "journal").trim() || "journal" : undefined;
  return buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: collection,
    fieldKey: field,
    voucherType,
  });
}

function collectRefFieldPaths(
  value: unknown,
  topField: string,
  out: Array<{ field: string; ref: string; arrayIndex?: number }>
): void {
  if (typeof value === "string" && isCloudSyncTrackableFileRef(value)) {
    out.push({ field: topField, ref: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      if (typeof item === "string" && isCloudSyncTrackableFileRef(item)) {
        out.push({ field: topField, ref: item, arrayIndex: idx });
      } else {
        collectRefFieldPaths(item, topField, out);
      }
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectRefFieldPaths(v, topField ? `${topField}.${k}` : k, out);
    }
  }
}

async function patchDocFieldRef(
  companyId: string,
  collection: string,
  docId: string,
  field: string,
  existing: Record<string, unknown>,
  oldRef: string,
  driveRef: string,
  arrayIndex?: number
): Promise<void> {
  const cur = existing[field];
  let next: unknown;
  if (Array.isArray(cur) && arrayIndex != null && arrayIndex >= 0) {
    const arr = [...cur];
    if (arr[arrayIndex] === oldRef) arr[arrayIndex] = driveRef;
    else return;
    next = arr;
  } else if (cur === oldRef) {
    next = driveRef;
  } else {
    return;
  }
  await upsertCompanyDocInBrowserDb(
    companyId,
    collection,
    docId,
    { ...existing, [field]: next, updatedAt: Date.now() },
    { notify: true, force: true, skipCloudSyncEnqueue: true }
  );
}

/** `local:` pending queue + cached `drive:` bytes dubara upload (Drive folder wipe ke baad). */
export async function rehydrateLocalAttachmentRefsForDrive(
  companyId: string,
  options?: { forceUploadDriveRefs?: boolean }
): Promise<{
  requeuedLocalFiles: number;
  reuploadedDriveRefs: number;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { requeuedLocalFiles: 0, reuploadedDriveRefs: 0 };

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  const canRepairDriveRefs = await isOwnerDeviceForDriveRepair(reg);
  if (!canRepairDriveRefs) {
    logLocalCloudSync("Drive attachment repair skipped: owner device required", {
      companyId: cid,
      ownerEmail: reg?.ownerEmail || null,
    });
    return { requeuedLocalFiles: 0, reuploadedDriveRefs: 0 };
  }
  const pending = await getPendingFiles();
  const pendingIds = new Set(pending.map((p) => p.id));
  const usePocketLedger = companyUsesPocketLedgerStorage(reg);
  let requeuedLocalFiles = 0;
  let reuploadedDriveRefs = 0;

  for (const collection of COLLECTIONS_TO_BACKUP) {
    const rows = await listCompanyDocsFromBrowserDb(cid, collection, { forBackupMerge: true });
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (!isAliveDoc(row)) continue;
      const docId = String(row.id ?? "").trim();
      if (!docId) continue;

      const refFields: Array<{ field: string; ref: string; arrayIndex?: number }> = [];
      for (const [k, v] of Object.entries(row)) {
        if (k === "id") continue;
        collectRefFieldPaths(v, k, refFields);
      }

      for (const { field, ref, arrayIndex } of refFields) {
        if (isLocalFileRef(ref)) {
          const localId = ref.slice(LOCAL_FILE_PREFIX.length).trim();
          if (!localId || pendingIds.has(localId)) continue;
          const blob = await resolveLocalBytesForDriveReupload(ref, cid);
          if (!blob || blob.size <= 0) continue;
          await putPendingFile({
            id: localId,
            blob,
            contentType: blob.type || "application/octet-stream",
            docPath: `companies/${cid}/${collection}/${docId}`,
            field,
            storagePathPrefix: inferStoragePathPrefix(collection, row, cid, field, usePocketLedger),
          });
          pendingIds.add(localId);
          requeuedLocalFiles += 1;
          continue;
        }

        if (isDriveFileRef(ref)) {
          if (options?.forceUploadDriveRefs !== true) {
            const { downloadDriveAttachmentBlob } = await import("@/lib/localCloudSync/driveCloudSyncClient");
            const onDrive = await downloadDriveAttachmentBlob(ref, cid);
            if (onDrive && onDrive.size > 0) continue;
          }

          const blob = await resolveLocalBytesForDriveReupload(ref, cid);
          if (!blob || blob.size <= 0) continue;
          const driveRef = await uploadPendingAttachmentPayloadToDrive({
            companyId: cid,
            companyName: typeof reg?.name === "string" ? reg.name : undefined,
            company: (reg ?? null) as Record<string, unknown> | null,
            collection,
            docId,
            field,
            blob,
            contentType: blob.type || "application/octet-stream",
          });
          await patchDocFieldRef(cid, collection, docId, field, row, ref, driveRef, arrayIndex);
          if (Array.isArray(row[field]) && arrayIndex != null) {
            const arr = [...(row[field] as unknown[])];
            arr[arrayIndex] = driveRef;
            row[field] = arr;
          } else {
            row[field] = driveRef;
          }
          reuploadedDriveRefs += 1;
        }
      }
    }
  }

  return { requeuedLocalFiles, reuploadedDriveRefs };
}

/**
 * Drive folder delete / khali hone par poora local ledger + attachments dubara enqueue/upload.
 */
export async function prepareDriveFullReuploadFromLocal(
  companyId: string,
  input: {
    manifest: CloudSyncManifest;
    remoteOpCount: number;
    lastSyncedOp: number;
    historicalBackfillDone: boolean;
    force?: boolean;
  }
): Promise<DriveFullReuploadPrepResult> {
  const empty: DriveFullReuploadPrepResult = {
    prepared: false,
    unsyncedOps: 0,
    backfilledRows: 0,
    requeuedLocalFiles: 0,
    reuploadedDriveRefs: 0,
  };
  const cid = String(companyId || "").trim();
  if (!cid) return empty;
  if (!shouldPrepareDriveFullReuploadFromLocal(input)) return empty;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!(await isOwnerDeviceForDriveRepair(reg))) {
    logLocalCloudSync("drive full reupload skipped: owner device required", {
      companyId: cid,
      ownerEmail: reg?.ownerEmail || null,
      force: input.force === true,
    });
    return empty;
  }

  const unsyncedOps = await unsyncCloudSyncOutboxForCompany(cid);
  await clearCloudSyncHistoricalBackfillDone(cid);
  await setCloudSyncCursor(cid, { lastSyncedOp: 0, lastError: null, syncStatus: "idle" });

  const { requeuedLocalFiles, reuploadedDriveRefs } = await rehydrateLocalAttachmentRefsForDrive(cid, {
    forceUploadDriveRefs: input.force === true || input.remoteOpCount === 0,
  });

  logLocalCloudSync("drive full reupload prepared", {
    companyId: cid,
    unsyncedOps,
    requeuedLocalFiles,
    reuploadedDriveRefs,
    force: input.force === true,
  });

  return {
    prepared: true,
    unsyncedOps,
    backfilledRows: 0,
    requeuedLocalFiles,
    reuploadedDriveRefs,
  };
}

/** Manual — saari `drive:` refs scan; missing files local bytes se dubara upload. */
export async function runManualDriveAttachmentRehydrate(companyId: string): Promise<{
  ok: boolean;
  requeuedLocalFiles: number;
  reuploadedDriveRefs: number;
  uploadedPendingFiles: number;
  error?: string;
}> {
  const empty = {
    ok: false,
    requeuedLocalFiles: 0,
    reuploadedDriveRefs: 0,
    uploadedPendingFiles: 0,
  };
  const cid = String(companyId || "").trim();
  if (!cid) return { ...empty, error: "missing companyId" };

  const { shouldUseLocalCloudSync } = await import("@/lib/localCloudSync/companyConfig");
  if (!(await shouldUseLocalCloudSync(cid))) {
    return { ...empty, error: "cloud sync disabled" };
  }

  if (!hasDriveApiAuthSession()) {
    return { ...empty, error: "Sign in to Google Drive first" };
  }

  const { processDriveFolderRepairGate } = await import("@/lib/localCloudSync/driveFolderRepair");
  const repairGate = await processDriveFolderRepairGate(cid);
  if (repairGate.action === "blocked") {
    return { ...empty, error: repairGate.message };
  }

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return { ...empty, error: "company not found" };
  if (!(await isOwnerDeviceForDriveRepair(reg))) {
    return { ...empty, error: "Use the owner account on this device to repair Drive attachments" };
  }

  const rehyd = await rehydrateLocalAttachmentRefsForDrive(cid);
  await upsertLocalCompany({
    ...reg,
    cloudSyncLastAttachmentRehydrateAt: Date.now(),
    updatedAt: Date.now(),
  });

  const { syncPendingFilesForCompany, listPendingFilesForCompany } = await import("@/lib/localPendingFiles");
  let uploadedPendingFiles = 0;
  for (let round = 0; round < 24; round++) {
    const result = await syncPendingFilesForCompany(cid, {});
    uploadedPendingFiles += result.uploaded;
    if ((await listPendingFilesForCompany(cid)).length === 0) break;
  }

  logLocalCloudSync("manual attachment rehydrate", { companyId: cid, ...rehyd, uploadedPendingFiles });
  return { ok: true, ...rehyd, uploadedPendingFiles };
}
