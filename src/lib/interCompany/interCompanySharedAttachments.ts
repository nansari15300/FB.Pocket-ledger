"use client";

/**
 * Inter Company — source attachments ko target company ke apne refs me copy karo
 * taaki dusri device / peer company apni storage se file khol sake (shared HTTPS link kaafi nahi).
 */
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { storage } from "@/lib/plClientSession";
import { incrementCompanyStorage } from "@/lib/storageUsageClient";
import { fetchAttachmentRefBlob } from "@/lib/attachmentRefBlobFetch";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { touchRegistryAfterStorageUpload } from "@/lib/companyAttachmentRegistry";
import {
  appendLocalOnlyVoucherFilesToUrls,
  blobFromAttachmentRefForCopy,
  fileNameFromInterCompanyAttachmentRef,
} from "@/lib/voucherLocalAttachmentUpload";
import { patchVoucherFields } from "@/lib/voucherActionsClient";
import { canSyncCompanyToServer, flushVoucherOutbox } from "@/lib/localVoucherOutbox";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyDataSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { isClientNavigatorOffline } from "@/lib/apkOnlineFirestoreWritePolicy";

async function blobForInterCompanyPeerCopy(
  srcRef: string,
  blobByRef: ReadonlyMap<string, Blob> | undefined,
  sourceCompanyId?: string
): Promise<Blob | null> {
  const refStr = srcRef.trim();
  if (!refStr) return null;
  const staged = blobByRef?.get(refStr);
  if (staged && staged.size > 0) return staged;
  const cid = String(sourceCompanyId || "").trim() || undefined;
  const viaPreview = await fetchAttachmentRefBlob(refStr, {
    companyId: cid,
    galleryUrls: blobByRef ? [...blobByRef.keys()] : undefined,
  });
  if (viaPreview && viaPreview.size > 0) return viaPreview;
  const viaCopy = await blobFromAttachmentRefForCopy(refStr, {
    companyId: cid,
    galleryUrls: blobByRef ? [...blobByRef.keys()] : undefined,
  });
  if (viaCopy && viaCopy.size > 0) return viaCopy;
  return null;
}

async function ensureBlobsForAttachmentRefs(
  companyId: string,
  urls: string[],
  existing?: ReadonlyMap<string, Blob>
): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>(existing ? [...existing.entries()] : []);
  for (const raw of urls) {
    const u = String(raw || "").trim();
    if (!u) continue;
    const have = out.get(u);
    if (have && have.size > 0) continue;
    const blob = await blobForInterCompanyPeerCopy(u, out, companyId);
    if (blob && blob.size > 0) out.set(u, blob);
  }
  return out;
}

/** Online peer company: bytes Firebase Storage pe — dusri device `local:` IndexedDB nahi dekhti. */
async function shouldUploadInterCompanyPeerCopyToFirebase(peerCompanyId: string): Promise<boolean> {
  const cid = String(peerCompanyId || "").trim();
  if (!cid) return false;
  if (isFirebaseLedgerDataSyncDisabled()) return false;
  if (!isFirebaseLedgerCompanyDataSyncEnabled(cid)) return false;
  if (isClientNavigatorOffline()) return false;
  if (!(await canSyncCompanyToServer(cid))) return false;
  return true;
}

/**
 * IC peer side: hamesha apni copy (bytes) — same HTTPS link dusri device / khaki block tod deta hai.
 */
export async function resolveInterCompanyPeerAttachmentUrls(args: {
  targetCompanyId: string;
  sourceFileUrls: string[];
  targetVoucherId: string;
  attachmentBlobByRef?: ReadonlyMap<string, Blob>;
  sourceCompanyId?: string;
}): Promise<string[]> {
  const sourceFileUrls = (args.sourceFileUrls || []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  if (sourceFileUrls.length === 0) return [];
  return replicateInterCompanySharedAttachmentsToPeer(args);
}

export async function replicateInterCompanySharedAttachmentsToPeer(args: {
  targetCompanyId: string;
  sourceFileUrls: string[];
  targetVoucherId: string;
  /** Save ke waqt abhi memory / IndexedDB me maujood blobs — dubara read fail hone par fallback */
  attachmentBlobByRef?: ReadonlyMap<string, Blob>;
  sourceCompanyId?: string;
}): Promise<string[]> {
  const targetCompanyId = String(args.targetCompanyId || "").trim();
  const targetVoucherId = String(args.targetVoucherId || "").trim();
  const sourceCompanyId = String(args.sourceCompanyId || "").trim();
  const sourceFileUrls = (args.sourceFileUrls || []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  if (!targetCompanyId || !targetVoucherId || sourceFileUrls.length === 0) return [];

  const blobByRef = await ensureBlobsForAttachmentRefs(
    sourceCompanyId,
    sourceFileUrls,
    args.attachmentBlobByRef
  );

  const staged: { blob: Blob; fileName: string }[] = [];
  for (let i = 0; i < sourceFileUrls.length; i++) {
    const srcRef = sourceFileUrls[i]!.trim();
    const blob = await blobForInterCompanyPeerCopy(srcRef, blobByRef, sourceCompanyId);
    if (!blob || blob.size <= 0) {
      throw new Error(
        "Could not copy attachment for the other company's own storage. The voucher is saved — other side may still preview via the linked copy. Open the file once on this device, then save again to attach locally there."
      );
    }
    staged.push({
      blob,
      fileName: fileNameFromInterCompanyAttachmentRef(srcRef, i + 1, blob.type),
    });
  }

  const uploadToFirebase = await shouldUploadInterCompanyPeerCopyToFirebase(targetCompanyId);
  if (!uploadToFirebase) {
    const newFiles = staged.map(
      ({ blob, fileName }) =>
        new File([blob], fileName, { type: blob.type || "application/octet-stream" })
    );
    const { fileUrls } = await appendLocalOnlyVoucherFilesToUrls({
      companyId: targetCompanyId,
      storageFolder: "inter_company",
      existingFileUrls: [],
      newFiles,
      maxFileCount: Math.max(newFiles.length, 20),
      existingVoucherId: targetVoucherId,
    });
    try {
      const { syncPendingFilesForCompany } = await import("@/lib/localPendingFiles");
      await syncPendingFilesForCompany(targetCompanyId, { forceUploadPendingBlob: true });
    } catch {
      /* pending upload best-effort — local: refs still on this device */
    }
    return fileUrls;
  }

  const out: string[] = [];
  for (const { blob, fileName } of staged) {
    const objectPath = `voucher-files/${targetCompanyId}/inter_company/${Date.now()}_${fileName}`;
    const storageRef = ref(storage, objectPath);
    await uploadBytes(storageRef, blob, {
      contentType: blob.type || "application/octet-stream",
    });
    const httpsUrl = await getDownloadURL(storageRef);
    out.push(httpsUrl);
    try {
      await incrementCompanyStorage(targetCompanyId, {
        attachmentsBytes: blob.size,
        storageBytes: blob.size,
      });
      await touchRegistryAfterStorageUpload(targetCompanyId, httpsUrl);
    } catch {
      /* usage counter non-fatal */
    }
  }
  return out;
}

async function copyOwnFilesToPeerIfShared(args: {
  share: boolean;
  ownFileUrls: string[];
  ownCompanyId: string;
  peerCompanyId: string;
  peerVoucherId: string;
  attachmentBlobByRef?: ReadonlyMap<string, Blob>;
}): Promise<{ copies: string[]; warning?: string }> {
  if (!args.share || args.ownFileUrls.length === 0) return { copies: [] };
  try {
    const copies = await resolveInterCompanyPeerAttachmentUrls({
      targetCompanyId: args.peerCompanyId,
      sourceFileUrls: args.ownFileUrls,
      targetVoucherId: args.peerVoucherId,
      attachmentBlobByRef: args.attachmentBlobByRef,
      sourceCompanyId: args.ownCompanyId,
    });
    return { copies };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not copy attachment for the other company's own storage.";
    console.warn("[IC] attachment share copy:", err);
    return { copies: [], warning: message };
  }
}

/**
 * Dono taraf ka "apna" file set + har taraf ka share toggle — final combined `fileUrls`
 * (apna + jo peer ne share kiya) dono vouchers par patch. `interCompanyOwnFileUrls` se
 * agli baar edit khulne par sirf apna box hi apni files dikhaye (peer copy repeat na ho).
 */
export async function reconcileAndPatchInterCompanyAttachmentSharing(args: {
  sourceCompanyId: string;
  sourceVoucherId: string;
  sourceOwnFileUrls: string[];
  shareSourceToTarget: boolean;
  targetCompanyId: string;
  targetVoucherId: string;
  targetOwnFileUrls: string[];
  shareTargetToSource: boolean;
  sourceAttachmentBlobByRef?: ReadonlyMap<string, Blob>;
  targetAttachmentBlobByRef?: ReadonlyMap<string, Blob>;
}): Promise<{ attachmentReplicationWarning?: string }> {
  const sourceCompanyId = String(args.sourceCompanyId || "").trim();
  const sourceVoucherId = String(args.sourceVoucherId || "").trim();
  const targetCompanyId = String(args.targetCompanyId || "").trim();
  const targetVoucherId = String(args.targetVoucherId || "").trim();
  if (!sourceCompanyId || !sourceVoucherId || !targetCompanyId || !targetVoucherId) {
    throw new Error("Linked Inter Company voucher not found.");
  }

  const sourceOwnFileUrls = (args.sourceOwnFileUrls || []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  const targetOwnFileUrls = (args.targetOwnFileUrls || []).filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );

  const [sourceBlobs, targetBlobs] = await Promise.all([
    args.shareSourceToTarget
      ? ensureBlobsForAttachmentRefs(sourceCompanyId, sourceOwnFileUrls, args.sourceAttachmentBlobByRef)
      : Promise.resolve(new Map<string, Blob>()),
    args.shareTargetToSource
      ? ensureBlobsForAttachmentRefs(targetCompanyId, targetOwnFileUrls, args.targetAttachmentBlobByRef)
      : Promise.resolve(new Map<string, Blob>()),
  ]);

  const [toTarget, toSource] = await Promise.all([
    copyOwnFilesToPeerIfShared({
      share: args.shareSourceToTarget === true,
      ownFileUrls: sourceOwnFileUrls,
      ownCompanyId: sourceCompanyId,
      peerCompanyId: targetCompanyId,
      peerVoucherId: targetVoucherId,
      attachmentBlobByRef: sourceBlobs,
    }),
    copyOwnFilesToPeerIfShared({
      share: args.shareTargetToSource === true,
      ownFileUrls: targetOwnFileUrls,
      ownCompanyId: targetCompanyId,
      peerCompanyId: sourceCompanyId,
      peerVoucherId: sourceVoucherId,
      attachmentBlobByRef: targetBlobs,
    }),
  ]);

  await patchVoucherFields(sourceCompanyId, sourceVoucherId, {
    interCompanyOwnFileUrls: sourceOwnFileUrls,
    interCompanyShareAttachmentsWithPeer: args.shareSourceToTarget === true,
    interCompanySharePeerAttachmentsToSource: args.shareTargetToSource === true,
    fileUrls: [...sourceOwnFileUrls, ...toSource.copies],
  });
  await patchVoucherFields(targetCompanyId, targetVoucherId, {
    interCompanyOwnFileUrls: targetOwnFileUrls,
    interCompanyShareAttachmentsWithPeer: args.shareSourceToTarget === true,
    interCompanySharePeerAttachmentsToSource: args.shareTargetToSource === true,
    fileUrls: [...targetOwnFileUrls, ...toTarget.copies],
  });

  void flushVoucherOutbox().catch(() => undefined);

  const warning = toTarget.warning || toSource.warning;
  return warning ? { attachmentReplicationWarning: warning } : {};
}
