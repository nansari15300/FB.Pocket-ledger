"use client";

import {
  getCompanyDocFromBrowserDb,
  upsertCompanyDocInBrowserDb,
  notifyBrowserDbCollectionUpdated,
} from "@/lib/localCompanyDocMirror";
import {
  buildCloudSyncManifestFromCompany,
  mergeRemoteCloudSyncManifestIntoLocalCompany,
  patchLocalCompanyCloudSyncFields,
  readCloudSyncConfigFromCompany,
  readCloudSyncDriveShareUsers,
  shouldUseLocalCloudSync,
} from "@/lib/localCloudSync/companyConfig";
import { maybeShareDriveCompanyFolder } from "@/lib/localCloudSync/driveCloudSyncClient";
import { runWithRemoteCloudSyncApply } from "@/lib/localCloudSync/enqueueFromWrite";
import {
  mergeRemotePayloadIntoLocal,
  shouldApplyRemoteCloudSyncOp,
} from "@/lib/localCloudSync/conflict";
import { logLocalCloudSync, warnLocalCloudSync } from "@/lib/localCloudSync/logger";
import {
  FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG,
  hasDriveApiAuthSession,
  isDriveAuthRequiredError,
  waitForFirebaseAuthReady,
} from "@/lib/firebaseAuthForApi";
import { getSyncProviderForCompany } from "@/lib/localCloudSync/providers";
import { backfillLocalDocsToCloudSyncOutbox } from "@/lib/localCloudSync/backfillOutbox";
import {
  CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG,
  isCloudSyncEncryptionReady,
  readCloudSyncDriveEncryptionFromCompany,
} from "@/lib/localCloudSync/driveEncryption";
import {
  uploadOpeningSnapshotToDrive,
  downloadAndMergeOpeningUsersFromDrive,
  downloadAndMergeOpeningMastersFromDrive,
} from "@/lib/localCloudSync/openingDriveSnapshot";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

export type RunLocalCloudSyncCycleOptions = {
  force?: boolean;
  /** Drive restore/join: pehle masters + voucher ops; attachment bytes baad me background. */
  ledgerOnly?: boolean;
  /** Background phase after ledgerOnly — pending attachment upload + opening snapshot. */
  attachmentsOnly?: boolean;
};
import { syncPendingFilesForCompany, listPendingFilesForCompany } from "@/lib/localPendingFiles";
import {
  getCloudSyncCursor,
  listPendingLocalCloudSyncOps,
  markLocalCloudSyncOpsSynced,
  markLocalCloudSyncOpSynced,
  protectedLocalCloudSyncRowKeySet,
  setCloudSyncCursor,
} from "@/lib/localCloudSync/queue";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import {
  countNewCloudSyncFileRefs,
  countUniqueCloudSyncFileRefsInOps,
  voucherIdentityKeyFromOp,
} from "@/lib/localCloudSync/syncSummaryAttachments";
import type { CloudSyncCompanyRef, CloudSyncLastSyncSummary } from "@/lib/localCloudSync/types";
import { CLOUD_SYNC_AUTO_REHYDRATE_INTERVAL_MS } from "@/lib/localCloudSync/types";
import { appendCloudSyncSummaryHistory } from "@/lib/localCloudSync/syncSummaryHistory";
import type { CloudSyncSummaryHistoryEntry } from "@/lib/localCloudSync/syncSummaryHistory";
import { prepareDriveFullReuploadFromLocal, rehydrateLocalAttachmentRefsForDrive } from "@/lib/localCloudSync/driveFullReupload";
import { processDriveFolderRepairGate } from "@/lib/localCloudSync/driveFolderRepair";
import { notifyDriveCloudSyncStatus } from "@/lib/localCloudSync/driveCloudSyncUiEvents";
import type { CloudSyncRunStatus, LocalCloudSyncOperation } from "@/lib/localCloudSync/types";
import { getOrCreateClientDeviceId } from "@/lib/security/deviceIdentity";

const VOUCHER_SYNC_TABLE = "vouchers";

const syncLocks = new Set<string>();

/** Header sync spinner — active Drive company cycle chal raha ho. */
export function isLocalCloudSyncCycleRunning(companyId: string): boolean {
  return syncLocks.has(String(companyId || "").trim());
}

async function patchCloudSyncRunStatus(companyId: string, status: CloudSyncRunStatus, lastError?: string | null): Promise<void> {
  await patchLocalCompanyCloudSyncFields(companyId, {
    cloudSyncStatus: status,
    ...(lastError !== undefined ? { cloudSyncLastError: lastError } : {}),
  });
  notifyDriveCloudSyncStatus(companyId, status);
}

type CycleSummaryDraft = {
  skipBulkReuploadCounts: boolean;
  attachSynced: number;
  bulkReuploadRefs: number;
  openingAttachmentFiles: number;
  addedFiles: number;
  addedVouchers: number;
  uploadedVouchers: number;
  downloadedFiles: number;
  downloadedVouchers: number;
};

function buildUploadedFilesFromCycleDraft(draft: CycleSummaryDraft): number {
  const fresh = draft.attachSynced + draft.openingAttachmentFiles;
  if (draft.skipBulkReuploadCounts) return fresh;
  return fresh + draft.bulkReuploadRefs;
}

function cycleSummaryHasActivity(draft: CycleSummaryDraft): boolean {
  return (
    buildUploadedFilesFromCycleDraft(draft) > 0 ||
    draft.uploadedVouchers > 0 ||
    draft.addedFiles > 0 ||
    draft.addedVouchers > 0 ||
    draft.downloadedFiles > 0 ||
    draft.downloadedVouchers > 0
  );
}

async function persistCloudSyncCycleSummary(
  companyId: string,
  draft: CycleSummaryDraft,
  options?: { resetHistory?: boolean; at?: number }
): Promise<CloudSyncLastSyncSummary> {
  const uploadedFiles = buildUploadedFilesFromCycleDraft(draft);
  const lastSyncSummary: CloudSyncLastSyncSummary = {
    addedFiles: draft.addedFiles,
    addedVouchers: draft.addedVouchers,
    uploadedFiles,
    uploadedVouchers: draft.uploadedVouchers,
    downloadedFiles: draft.downloadedFiles,
    downloadedVouchers: draft.downloadedVouchers,
  };
  const now = options?.at ?? Date.now();
  const regForHistory = await getLocalCompanyById(companyId, { includeDeleted: true });
  const cfgForHistory = readCloudSyncConfigFromCompany(regForHistory);

  if (options?.resetHistory) {
    const entry: CloudSyncSummaryHistoryEntry = { ...lastSyncSummary, at: now };
    await patchLocalCompanyCloudSyncFields(companyId, {
      cloudSyncLastSyncSummary: lastSyncSummary,
      cloudSyncSummaryHistory: cycleSummaryHasActivity(draft) ? [entry] : [],
      cloudSyncSummaryResetAt: now,
    });
    return lastSyncSummary;
  }

  const summaryHistory = appendCloudSyncSummaryHistory(cfgForHistory.cloudSyncSummaryHistory, {
    ...lastSyncSummary,
    at: now,
  });
  await patchLocalCompanyCloudSyncFields(companyId, {
    cloudSyncLastSyncSummary: lastSyncSummary,
    cloudSyncSummaryHistory: summaryHistory,
  });
  return lastSyncSummary;
}

/** Sync cycle ke dauran user ne OFF kiya ho to upload/manifest/share abort — folder recreate na ho. */
async function abortIfCloudSyncTurnedOff(companyId: string): Promise<boolean> {
  if (await shouldUseLocalCloudSync(companyId)) return false;
  await patchCloudSyncRunStatus(companyId, "idle", null);
  await setCloudSyncCursor(companyId, { syncStatus: "idle", lastError: null });
  return true;
}

export async function runLocalCloudSyncCycle(
  companyId: string,
  options?: RunLocalCloudSyncCycleOptions
): Promise<{
  ok: boolean;
  error?: string;
  uploaded: number;
  downloaded: number;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { ok: false, error: "missing companyId", uploaded: 0, downloaded: 0 };
  if (isLocalGoogleDriveSyncDisabled()) {
    return { ok: false, error: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE, uploaded: 0, downloaded: 0 };
  }

  const ledgerOnly = options?.ledgerOnly === true;
  const attachmentsOnly = options?.attachmentsOnly === true;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, error: "offline", uploaded: 0, downloaded: 0 };
  }

  if (syncLocks.has(cid) && !options?.force) {
    return { ok: false, error: "sync already running", uploaded: 0, downloaded: 0 };
  }

  if (!(await shouldUseLocalCloudSync(cid))) {
    return { ok: false, error: "cloud sync disabled or firestore company", uploaded: 0, downloaded: 0 };
  }

  // Firebase session restore hone tak wait — startup par galat "Sign in required" error mat likho.
  await waitForFirebaseAuthReady();
  if (!hasDriveApiAuthSession()) {
    return { ok: false, error: FIREBASE_SIGN_IN_REQUIRED_FOR_DRIVE_MSG, uploaded: 0, downloaded: 0 };
  }

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return { ok: false, error: "company not found", uploaded: 0, downloaded: 0 };

  const cfg = readCloudSyncConfigFromCompany(reg);
  if (!cfg.cloudSyncEnabled) return { ok: false, error: "cloud sync disabled", uploaded: 0, downloaded: 0 };

  const repairGate = await processDriveFolderRepairGate(cid);
  if (repairGate.action === "blocked") {
    return { ok: false, error: repairGate.message, uploaded: 0, downloaded: 0 };
  }

  const regAfterFresh = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!regAfterFresh) return { ok: false, error: "company not found", uploaded: 0, downloaded: 0 };

  const historicalBackfillDone =
    (regAfterFresh as { cloudSyncHistoricalBackfillDone?: boolean }).cloudSyncHistoricalBackfillDone === true;

  const encCfg = readCloudSyncDriveEncryptionFromCompany(regAfterFresh as Record<string, unknown>);
  if (encCfg.encryptAny && !(await isCloudSyncEncryptionReady(cid))) {
    return {
      ok: false,
      error: CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG,
      uploaded: 0,
      downloaded: 0,
    };
  }

  syncLocks.add(cid);
  await patchCloudSyncRunStatus(cid, "syncing", null);
  await setCloudSyncCursor(cid, { syncStatus: "syncing", lastError: null });

  let uploaded = 0;
  let downloaded = 0;
  let summaryDraft: CycleSummaryDraft = {
    skipBulkReuploadCounts: false,
    attachSynced: 0,
    bulkReuploadRefs: 0,
    openingAttachmentFiles: 0,
    addedFiles: 0,
    addedVouchers: 0,
    uploadedVouchers: 0,
    downloadedFiles: 0,
    downloadedVouchers: 0,
  };
  let summaryPersisted = false;

  const flushPartialSummaryIfNeeded = async () => {
    if (summaryPersisted || !cycleSummaryHasActivity(summaryDraft)) return;
    await persistCloudSyncCycleSummary(cid, summaryDraft);
    summaryPersisted = true;
  };

  try {
    const provider = getSyncProviderForCompany();
    // Drive folder: `Pocket Ledger/{CompanyName__id}/` — registry se readable name bhejo
    const syncRef: CloudSyncCompanyRef = {
      companyId: cid,
      companyName: typeof regAfterFresh.name === "string" ? regAfterFresh.name : undefined,
      // Joined local company — owner ka shared folder id (poora Pocket Ledger root nahi).
      driveSharedFolderId:
        typeof regAfterFresh.cloudSyncDriveFolderId === "string" && regAfterFresh.cloudSyncDriveFolderId.trim()
          ? regAfterFresh.cloudSyncDriveFolderId.trim()
          : undefined,
    };

    let cursor = await getCloudSyncCursor(cid);
    let manifest = await provider.getManifest(syncRef);
    const manifestLatestOp = Number(manifest.latestOp) || 0;
    const regForPrep = regAfterFresh;
    let prep = await prepareDriveFullReuploadFromLocal(cid, {
      manifest,
      remoteOpCount: manifestLatestOp,
      lastSyncedOp: cursor.lastSyncedOp,
      historicalBackfillDone:
        (regForPrep as { cloudSyncHistoricalBackfillDone?: boolean }).cloudSyncHistoricalBackfillDone === true,
    });
    if (prep.prepared) {
      cursor = await getCloudSyncCursor(cid);
      summaryDraft.skipBulkReuploadCounts = true;
      summaryDraft.bulkReuploadRefs += prep.reuploadedDriveRefs;
    }

    // Pending attach queue khali + Drive par file missing — local bytes se dubara upload.
    const pendingAttachBefore = await listPendingFilesForCompany(cid);
    const lastAttachRehyd =
      Number((regAfterFresh as { cloudSyncLastAttachmentRehydrateAt?: number }).cloudSyncLastAttachmentRehydrateAt) ||
      0;
    if (
      !ledgerOnly &&
      !attachmentsOnly &&
      pendingAttachBefore.length === 0 &&
      !prep.prepared &&
      Date.now() - lastAttachRehyd > CLOUD_SYNC_AUTO_REHYDRATE_INTERVAL_MS
    ) {
      const rehyd = await rehydrateLocalAttachmentRefsForDrive(cid);
      summaryDraft.bulkReuploadRefs += rehyd.reuploadedDriveRefs;
      await upsertLocalCompany({
        ...regAfterFresh,
        cloudSyncLastAttachmentRehydrateAt: Date.now(),
        updatedAt: Date.now(),
      } as typeof regAfterFresh);
    }

    if (await abortIfCloudSyncTurnedOff(cid)) {
      await flushPartialSummaryIfNeeded();
      return { ok: false, error: "cloud sync disabled", uploaded, downloaded };
    }

    // Pehle attachment bytes → Drive, phir ops enqueue (payload me `drive:` refs sahi hon).
    let attachSync = { synced: 0, uploaded: 0, failed: 0, lastError: undefined as string | undefined };
    if (!ledgerOnly) {
      for (let attachRound = 0; attachRound < 24; attachRound++) {
        const round = await syncPendingFilesForCompany(cid, {
          onProgress: (done) => {
            notifyDriveCloudSyncStatus(cid, "syncing", {
              uploadedFiles: attachSync.uploaded + done,
              uploadedVouchers: summaryDraft.uploadedVouchers,
            });
          },
        });
        attachSync.synced += round.synced;
        attachSync.uploaded += round.uploaded;
        attachSync.failed += round.failed;
        if (round.uploaded > 0) {
          notifyDriveCloudSyncStatus(cid, "syncing", {
            uploadedFiles: attachSync.uploaded,
            uploadedVouchers: summaryDraft.uploadedVouchers,
          });
        }
        if (round.lastError) attachSync.lastError = round.lastError;
        if (round.synced === 0 && round.failed === 0) break;
        if ((await listPendingFilesForCompany(cid)).length === 0) break;
      }
    }
    summaryDraft.attachSynced = attachSync.uploaded;
    if (!ledgerOnly) {
      const { uploadLocalMasterAttachmentRefsToDrive } = await import(
        "@/lib/localCloudSync/openingDriveSnapshot"
      );
      const masterAttachUploaded = await uploadLocalMasterAttachmentRefsToDrive(cid);
      if (masterAttachUploaded > 0) {
        summaryDraft.attachSynced += masterAttachUploaded;
        logLocalCloudSync("master attachments uploaded before ops", {
          companyId: cid,
          count: masterAttachUploaded,
        });
      }
    }
    if (summaryDraft.attachSynced > 0) {
      if (attachSync.synced > 0) {
        logLocalCloudSync("attachments uploaded to Drive", { companyId: cid, ...attachSync });
      }
      const { refreshPendingCloudSyncOpsFromMirrorAfterAttachments } = await import(
        "@/lib/localCloudSync/enqueueFromWrite"
      );
      await refreshPendingCloudSyncOpsFromMirrorAfterAttachments(cid);
    }

    if (!ledgerOnly && !attachmentsOnly && (prep.prepared || !historicalBackfillDone)) {
      await backfillLocalDocsToCloudSyncOutbox(cid, { force: prep.prepared });
    }

    if (await abortIfCloudSyncTurnedOff(cid)) {
      await flushPartialSummaryIfNeeded();
      return { ok: false, error: "cloud sync disabled", uploaded, downloaded };
    }

    let uploadedThisCycleRowKeys = new Set<string>();

    if (!ledgerOnly && !attachmentsOnly) {
      const pending = await listPendingLocalCloudSyncOps(cid);
      const uploadManifest = await provider.getManifest(syncRef);
      let nextGlobalOp = Math.max(Number(uploadManifest.latestOp) || 0, cursor.lastSyncedOp);
      let maxUploadedSeq = cursor.lastSyncedOp;
      const uploadedVoucherKeys = new Set<string>();
      const addedVoucherKeysFromUpload = new Set<string>();
      for (const op of pending) {
        nextGlobalOp += 1;
        const driveOp: LocalCloudSyncOperation = { ...op, opSeq: nextGlobalOp };
        await provider.uploadOperation(syncRef, driveOp);
        uploadedThisCycleRowKeys.add(`${op.table}:${op.rowId}`);
        await markLocalCloudSyncOpSynced(cid, op.opSeq);
        uploaded += 1;
        if (op.table === VOUCHER_SYNC_TABLE) {
          uploadedVoucherKeys.add(voucherIdentityKeyFromOp(op));
          if (op.action === "create") addedVoucherKeysFromUpload.add(voucherIdentityKeyFromOp(op));
        }
        notifyDriveCloudSyncStatus(cid, "syncing", {
          uploadedFiles: summaryDraft.attachSynced,
          uploadedVouchers: uploadedVoucherKeys.size,
        });
        maxUploadedSeq = nextGlobalOp;
      }
      summaryDraft.uploadedVouchers = uploadedVoucherKeys.size;
      summaryDraft.addedVouchers = addedVoucherKeysFromUpload.size;
      if (pending.length > 0) {
        summaryDraft.addedFiles = countUniqueCloudSyncFileRefsInOps(pending);
        logLocalCloudSync("uploaded ops with global seq", {
          companyId: cid,
          count: pending.length,
          throughOp: maxUploadedSeq,
        });
      }
      if (pending.length > 0 && maxUploadedSeq > cursor.lastSyncedOp) {
        await markLocalCloudSyncOpsSynced(cid, maxUploadedSeq);
      }
      cursor = await getCloudSyncCursor(cid);
      if (maxUploadedSeq > uploadManifest.latestOp) {
        manifest = { ...uploadManifest, latestOp: maxUploadedSeq, updatedAt: Date.now() };
      }
    }

    const maxUploadedSeqForCycle = cursor.lastSyncedOp;

    if (await abortIfCloudSyncTurnedOff(cid)) {
      await flushPartialSummaryIfNeeded();
      return { ok: false, error: "cloud sync disabled", uploaded, downloaded };
    }
    const regForShare = (await mergeRemoteCloudSyncManifestIntoLocalCompany(cid, manifest)) ?? regAfterFresh;

    let cycleNow = Date.now();
    let newLastSyncedOp = cursor.lastSyncedOp;
    let latestOpForManifest = manifest.latestOp;

    if (!attachmentsOnly) {
      const pendingRowKeys = await protectedLocalCloudSyncRowKeySet(cid);
      for (const key of uploadedThisCycleRowKeys) pendingRowKeys.add(key);

      const OPENING_PULL_MIN_INTERVAL_MS = 5 * 60 * 1000;
      const lastOpeningPull =
        Number((regAfterFresh as { cloudSyncLastOpeningPullAt?: unknown }).cloudSyncLastOpeningPullAt) || 0;
      const manifestUpdatedAt = typeof manifest.updatedAt === "number" ? manifest.updatedAt : 0;
      const shouldPullOpening =
        prep.prepared ||
        cursor.lastSyncedOp === 0 ||
        Date.now() - lastOpeningPull >= OPENING_PULL_MIN_INTERVAL_MS ||
        (manifestUpdatedAt > 0 && manifestUpdatedAt > lastOpeningPull);

      if (shouldPullOpening) {
        try {
          await downloadAndMergeOpeningUsersFromDrive(cid, syncRef);
        } catch (e) {
          warnLocalCloudSync("opening users download skipped", {
            companyId: cid,
            msg: e instanceof Error ? e.message : String(e),
          });
        }

        try {
          await downloadAndMergeOpeningMastersFromDrive(cid, syncRef, { skipRowKeys: pendingRowKeys });
        } catch (e) {
          warnLocalCloudSync("opening masters download skipped", {
            companyId: cid,
            msg: e instanceof Error ? e.message : String(e),
          });
        }

        await upsertLocalCompany({
          ...regAfterFresh,
          cloudSyncLastOpeningPullAt: Date.now(),
          updatedAt: Date.now(),
        } as typeof regAfterFresh);
      }

      const localDeviceId = getOrCreateClientDeviceId();
      const allRemoteOps =
        manifestLatestOp > cursor.lastSyncedOp
          ? await provider.downloadOperations(syncRef, cursor.lastSyncedOp)
          : [];
      allRemoteOps.sort((a, b) => a.opSeq - b.opSeq);
      let maxRemoteSeq = cursor.lastSyncedOp;
      const downloadedVoucherKeys = new Set<string>();
      let downloadedFiles = 0;
      const touchedLedgerCollections = new Set<string>();

      await runWithRemoteCloudSyncApply(async () => {
        for (const op of allRemoteOps) {
          const rowKey = `${op.table}:${op.rowId}`;
          if (pendingRowKeys.has(rowKey)) continue;

          // Isi cycle me upload hue ops — echo skip
          if (op.opSeq <= maxUploadedSeqForCycle && op.deviceId === localDeviceId) {
            if (op.opSeq > maxRemoteSeq) maxRemoteSeq = op.opSeq;
            continue;
          }

          // Pehle sync ho chuki apni purani ops (local seq) — dubara mat lagao
          if (op.opSeq <= cursor.lastSyncedOp && op.deviceId === localDeviceId) {
            if (op.opSeq > maxRemoteSeq) maxRemoteSeq = op.opSeq;
            continue;
          }

          const local = (await getCompanyDocFromBrowserDb(cid, op.table, op.rowId)) as Record<string, unknown> | null;
          if (!shouldApplyRemoteCloudSyncOp(local, op, { pendingLocalRow: pendingRowKeys.has(rowKey) })) {
            if (op.opSeq > maxRemoteSeq) maxRemoteSeq = op.opSeq;
            continue;
          }
          const merged = mergeRemotePayloadIntoLocal(local, op);
          await upsertCompanyDocInBrowserDb(cid, op.table, op.rowId, merged, {
            notify: false,
            skipCloudSyncEnqueue: true,
            force: true,
          });
          downloaded += 1;
          touchedLedgerCollections.add(op.table);
          if (op.table === VOUCHER_SYNC_TABLE) {
            downloadedVoucherKeys.add(voucherIdentityKeyFromOp(op));
          }
          const newFileRefs = countNewCloudSyncFileRefs(local, merged);
          if (newFileRefs > 0) downloadedFiles += newFileRefs;
          if (op.opSeq > maxRemoteSeq) maxRemoteSeq = op.opSeq;
        }
      });
      for (const table of touchedLedgerCollections) {
        notifyBrowserDbCollectionUpdated(cid, table);
      }
      summaryDraft.downloadedFiles = downloadedFiles;
      summaryDraft.downloadedVouchers = downloadedVoucherKeys.size;

      // Cursor sirf actually upload/download hue ops par advance — manifest.latestOp se mat badhao.
      newLastSyncedOp = Math.max(cursor.lastSyncedOp, maxUploadedSeqForCycle, maxRemoteSeq);
      if (
        allRemoteOps.length === 0 &&
        manifest.latestOp > cursor.lastSyncedOp &&
        newLastSyncedOp < manifest.latestOp
      ) {
        warnLocalCloudSync("download cursor behind manifest — Drive par ops missing ya read fail", {
          companyId: cid,
          cursor: cursor.lastSyncedOp,
          manifestLatest: manifest.latestOp,
        });
      }
      latestOpForManifest = Math.max(manifest.latestOp, maxUploadedSeqForCycle, maxRemoteSeq);
      if (await abortIfCloudSyncTurnedOff(cid)) {
        await flushPartialSummaryIfNeeded();
        return { ok: false, error: "cloud sync disabled", uploaded, downloaded };
      }
      await provider.updateManifest(
        syncRef,
        buildCloudSyncManifestFromCompany(regForShare as Record<string, unknown>, {
          latestOp: latestOpForManifest,
          updatedAt: Date.now(),
          companyId: cid,
          driveShareUsers: readCloudSyncDriveShareUsers(regForShare as Record<string, unknown>),
        })
      ).catch((e) => {
        warnLocalCloudSync("manifest update skipped — ops uploaded", {
          companyId: cid,
          msg: e instanceof Error ? e.message : String(e),
        });
      });

      cycleNow = Date.now();
      await setCloudSyncCursor(cid, {
        lastSyncedOp: newLastSyncedOp,
        lastSyncAt: cycleNow,
        syncStatus: ledgerOnly ? "syncing" : "idle",
        lastError: null,
      });
      await patchLocalCompanyCloudSyncFields(cid, {
        cloudSyncLastSyncAt: cycleNow,
        cloudSyncStatus: ledgerOnly ? "syncing" : "idle",
        cloudSyncLastError: null,
      });
      notifyDriveCloudSyncStatus(cid, ledgerOnly ? "syncing" : "idle");

      if (ledgerOnly) {
        const regMark = await getLocalCompanyById(cid, { includeDeleted: true });
        if (regMark) {
          await upsertLocalCompany({
            ...regMark,
            cloudSyncHistoricalBackfillDone: true,
            updatedAt: Date.now(),
          });
        }
        const lastSyncSummary = await persistCloudSyncCycleSummary(cid, summaryDraft, { at: cycleNow });
        summaryPersisted = true;
        logLocalCloudSync("ledger restore phase ok", {
          companyId: cid,
          downloaded,
          lastSyncedOp: newLastSyncedOp,
          lastSyncSummary,
        });
        return { ok: true, uploaded, downloaded };
      }
    } else {
      cycleNow = Date.now();
    }

    const sharedUsers = readCloudSyncDriveShareUsers(regForShare as Record<string, unknown>);
    if (sharedUsers.length > 0) {
      if (await abortIfCloudSyncTurnedOff(cid)) {
        await flushPartialSummaryIfNeeded();
        return { ok: false, error: "cloud sync disabled", uploaded, downloaded };
      }
      await maybeShareDriveCompanyFolder({
        companyId: cid,
        companyName: syncRef.companyName,
        users: sharedUsers,
      });
    }

    if (await abortIfCloudSyncTurnedOff(cid)) {
      await flushPartialSummaryIfNeeded();
      return { ok: false, error: "cloud sync disabled", uploaded, downloaded };
    }
    const openingUpload = await uploadOpeningSnapshotToDrive(cid);
    summaryDraft.openingAttachmentFiles = openingUpload.attachmentFiles;

    const lastSyncSummary = await persistCloudSyncCycleSummary(cid, summaryDraft, {
      resetHistory: summaryDraft.skipBulkReuploadCounts,
      at: cycleNow,
    });
    summaryPersisted = true;

    if (attachmentsOnly || !ledgerOnly) {
      await setCloudSyncCursor(cid, { syncStatus: "idle", lastError: null });
      await patchCloudSyncRunStatus(cid, "idle", null);
    }

    logLocalCloudSync("cycle ok", {
      companyId: cid,
      uploaded,
      downloaded,
      lastSyncedOp: newLastSyncedOp,
      manifestLatestOp: latestOpForManifest,
      attachments: attachSync.synced,
      lastSyncSummary,
    });
    return { ok: true, uploaded, downloaded };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await flushPartialSummaryIfNeeded();
    // Auth abhi ready nahi — permanent error state mat chipkao (background retry karega).
    if (isDriveAuthRequiredError(e)) {
      warnLocalCloudSync("cycle skipped — auth required", { companyId: cid, msg });
      return { ok: false, error: msg, uploaded, downloaded };
    }
    warnLocalCloudSync("cycle failed", { companyId: cid, msg });
    await setCloudSyncCursor(cid, { syncStatus: "error", lastError: msg });
    await patchCloudSyncRunStatus(cid, "error", msg);
    return { ok: false, error: msg, uploaded, downloaded };
  } finally {
    syncLocks.delete(cid);
  }
}

/** Drive restore/join ke baad — attachment bytes + opening snapshot background me (UI pehle dikhe). */
export function scheduleDriveAttachmentSyncAfterRestore(companyId: string): void {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  if (isLocalGoogleDriveSyncDisabled()) return;
  void runLocalCloudSyncCycle(cid, { force: true, attachmentsOnly: true }).catch((e) => {
    warnLocalCloudSync("background attachment sync failed", {
      companyId: cid,
      msg: e instanceof Error ? e.message : String(e),
    });
  });
}

/** Master/voucher save ke baad — poora Drive cycle background (SQLite pehle sync ho chuka). */
export function scheduleLocalCloudSyncInBackground(
  companyId: string,
  options?: { force?: boolean }
): void {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  if (isLocalGoogleDriveSyncDisabled()) return;
  void runLocalCloudSyncCycle(cid, { force: options?.force === true }).catch((e) => {
    warnLocalCloudSync("background cloud sync failed", {
      companyId: cid,
      msg: e instanceof Error ? e.message : String(e),
    });
  });
}

export async function getLocalCloudSyncStatus(companyId: string): Promise<{
  pending: number;
  pendingFiles: number;
  pendingVouchers: number;
  lastSyncAt: number | null;
  lastSyncedOp: number;
  status: string;
  lastError: string | null;
  lastSyncSummary: CloudSyncLastSyncSummary;
  syncSummaryHistory: CloudSyncSummaryHistoryEntry[];
  syncSummaryResetAt: number | null;
}> {
  if (isLocalGoogleDriveSyncDisabled()) {
    return {
      pending: 0,
      pendingFiles: 0,
      pendingVouchers: 0,
      lastSyncAt: null,
      lastSyncedOp: 0,
      status: "disabled",
      lastError: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
      lastSyncSummary: {
        addedFiles: 0,
        addedVouchers: 0,
        uploadedFiles: 0,
        uploadedVouchers: 0,
        downloadedFiles: 0,
        downloadedVouchers: 0,
      },
      syncSummaryHistory: [],
      syncSummaryResetAt: null,
    };
  }
  const cursor = await getCloudSyncCursor(companyId);
  const pendingOps = await listPendingLocalCloudSyncOps(companyId);
  const pendingVoucherKeys = new Set<string>();
  for (const op of pendingOps) {
    if (op.table === VOUCHER_SYNC_TABLE) pendingVoucherKeys.add(voucherIdentityKeyFromOp(op));
  }
  const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
  const cfg = readCloudSyncConfigFromCompany(reg);
  return {
    pending: pendingOps.length,
    pendingFiles: countUniqueCloudSyncFileRefsInOps(pendingOps),
    pendingVouchers: pendingVoucherKeys.size,
    lastSyncAt: cfg.cloudSyncLastSyncAt ?? cursor.lastSyncAt,
    lastSyncedOp: cursor.lastSyncedOp,
    status: cfg.cloudSyncStatus,
    lastError: cfg.cloudSyncLastError,
    lastSyncSummary: cfg.cloudSyncLastSyncSummary,
    syncSummaryHistory: cfg.cloudSyncSummaryHistory,
    syncSummaryResetAt: cfg.cloudSyncSummaryResetAt,
  };
}
