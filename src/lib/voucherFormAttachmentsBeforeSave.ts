"use client";

import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import { readLockedPdfFileUrlsFromRow } from "@/lib/attachmentPdfOptions";
import {
  normalizeFormFileUrlsForSave,
  uploadVoucherAttachmentFileToFirebase,
} from "@/lib/voucherFormAttachmentSave";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldDeferStorageIncrementUntilPendingUpload,
  shouldStageNewVoucherFilesAsLocalPending,
} from "@/lib/voucherLocalAttachmentUpload";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";

export type VoucherAttachmentsBeforeSaveResult = {
  fileUrls: string[];
  preGeneratedVoucherId?: string;
};

/**
 * Payment Out / Journal shared path: add-time compress → save par sirf zarurat par recompress → local stage ya Firebase upload.
 */
export async function resolveVoucherAttachmentsBeforeSave(params: {
  companyId: string;
  company: { planId?: string | null; storageOption?: string | null };
  files: (File | string)[];
  savePdfAsImage: boolean;
  lockedPdfSource?: Record<string, unknown> | null;
  storageFolder: string;
  maxFileCount: number;
  idArgForFirestore: string | null | undefined;
  isEditingAndConverting: boolean;
  voucherIdForFirebaseUpload?: string;
  onStorageLimitBlocked?: (message: string) => void;
}): Promise<VoucherAttachmentsBeforeSaveResult | null> {
  // Edit-time recompress + re-upload of oversized HTTPS images is KEPT (user decision).
  // Phase 2 hotfix: a compress / shared-rewrite failure must not block the save; keep the original list.
  let filesForSave: (File | string)[] = params.files;
  const plT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    // Safety cap: a WebView decode/encode that never settles must not leave "Saving..." spinning forever.
    filesForSave = await Promise.race([
      prepareVoucherAttachmentsForSave(params.files, {
        companyId: params.companyId,
        savePdfAsImage: params.savePdfAsImage,
        lockedPdfFileUrls: readLockedPdfFileUrlsFromRow(params.lockedPdfSource),
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("prepare attachments timed out (120 s)")), 120_000)
      ),
    ]);
  } catch (err) {
    console.warn("[resolveVoucherAttachmentsBeforeSave] prepare failed, keeping original attachments", err);
    filesForSave = params.files;
  } finally {
    try {
      const { dismissAttachmentCompressionProgressToast, isAttachmentCompressionProgressActive } = await import(
        "@/lib/attachmentCompressionUi"
      );
      if (isAttachmentCompressionProgressActive()) dismissAttachmentCompressionProgressToast();
    } catch {
      /* ignore */
    }
  }

  console.info("[PL-DEBUG-SAVE] step=prepareAttachments(recompress/pdf)", Math.round(performance.now() - plT0), "ms");
  let fileUrls = normalizeFormFileUrlsForSave(
    filesForSave.filter((f): f is string => typeof f === "string")
  );
  let preGeneratedVoucherId: string | undefined;
  const newFilesToUpload = filesForSave.filter((f): f is File => f instanceof File);

  if (newFilesToUpload.length === 0) {
    return { fileUrls, preGeneratedVoucherId };
  }

  const totalNewBytes = newFilesToUpload.reduce((sum, f) => sum + (f.size || 0), 0);
  let limitCheck: { allowed: boolean; message?: string } = { allowed: true };
  let skipLimitCheck = false;
  try {
    // Quota pause: server limit read would retry resource-exhausted for seconds ("Saving..." spinner).
    const { isServerQuotaHoldActive } = await import("@/lib/serverQuotaHold");
    skipLimitCheck = isServerQuotaHoldActive() || totalNewBytes <= 0;
  } catch {
    /* ignore */
  }
  if (!skipLimitCheck) try {
    limitCheck = await checkStorageLimit(
      params.companyId,
      params.company?.planId,
      { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes },
      params.company?.storageOption
    );
  } catch (e) {
    // Limit check unreachable (quota / offline): do not block the save; files stage as local-pending below.
    console.warn("[resolveVoucherAttachmentsBeforeSave] storage limit check failed", e);
  }
  if (!limitCheck.allowed) {
    params.onStorageLimitBlocked?.(limitCheck.message ?? "Storage limit reached");
    return null;
  }

  if (await shouldStageNewVoucherFilesAsLocalPending(params.companyId)) {
    const voucherIdForLocalAttachments = params.isEditingAndConverting ? null : params.idArgForFirestore ?? null;
    const { fileUrls: merged, preGeneratedVoucherId: preGen } = await appendLocalOnlyVoucherFilesToUrls({
      companyId: params.companyId,
      storageFolder: params.storageFolder,
      existingFileUrls: fileUrls,
      newFiles: newFilesToUpload,
      maxFileCount: params.maxFileCount,
      existingVoucherId: voucherIdForLocalAttachments,
    });
    fileUrls = merged;
    if (preGen) preGeneratedVoucherId = preGen;
    if (!shouldDeferStorageIncrementUntilPendingUpload()) {
      try {
        await incrementCompanyStorage(params.companyId, {
          attachmentsBytes: totalNewBytes,
          storageBytes: totalNewBytes,
        });
      } catch {
        /* offline / local company */
      }
    }
  } else {
    const up = await uploadVoucherFilesOrStageLocalPending({
      companyId: params.companyId,
      storageFolder: params.storageFolder,
      existingFileUrls: fileUrls,
      files: newFilesToUpload,
      maxFileCount: params.maxFileCount,
      existingVoucherId: params.isEditingAndConverting ? null : params.idArgForFirestore ?? null,
      voucherIdForFirebaseUpload: params.voucherIdForFirebaseUpload,
    });
    fileUrls = up.fileUrls;
    if (up.preGeneratedVoucherId) preGeneratedVoucherId = up.preGeneratedVoucherId;
  }

  return { fileUrls, preGeneratedVoucherId };
}

/** Phase 2 hotfix: storage limit check that never throws (unreachable server = allowed; files stage locally). */
export async function checkStorageLimitSafe(
  companyId: string,
  planId: string | null | undefined,
  bytes: { attachmentsBytes: number; storageBytes: number },
  storageOption?: string | null
): Promise<{ allowed: boolean; message?: string }> {
  try {
    const res = await checkStorageLimit(companyId, planId as never, bytes, storageOption as never);
    return { allowed: res.allowed, message: res.message ?? undefined };
  } catch (e) {
    console.warn("[checkStorageLimitSafe] storage limit check failed - allowing save", e);
    return { allowed: true };
  }
}

/**
 * Phase 2 hotfix (shared by every voucher form): direct Storage upload of new files; any failure (quota,
 * billing, network) stages that file and the rest as persisted `local:` pending refs. The voucher always
 * saves; PendingAttachmentSyncBridge uploads in background and patches the HTTPS URL.
 */
export async function uploadVoucherFilesOrStageLocalPending(params: {
  companyId: string;
  storageFolder: string;
  existingFileUrls: string[];
  files: File[];
  maxFileCount?: number;
  existingVoucherId: string | null;
  voucherIdForFirebaseUpload?: string;
  onUploaded?: (url: string, file: File) => void;
}): Promise<{ fileUrls: string[]; preGeneratedVoucherId?: string }> {
  let fileUrls = [...params.existingFileUrls];
  let preGeneratedVoucherId: string | undefined;
  const max = params.maxFileCount ?? Number.MAX_SAFE_INTEGER;
  const failedUploads: File[] = [];
  for (const file of params.files) {
    if (fileUrls.length + failedUploads.length >= max) break;
    if (failedUploads.length > 0) {
      // Storage already failing: stage the rest locally without hammering the server.
      failedUploads.push(file);
      continue;
    }
    try {
      const url = await uploadVoucherAttachmentFileToFirebase({
        companyId: params.companyId,
        voucherType: params.storageFolder,
        file,
        voucherId: params.voucherIdForFirebaseUpload,
      });
      fileUrls.push(url);
      params.onUploaded?.(url, file);
      try {
        await incrementCompanyStorage(params.companyId, {
          attachmentsBytes: file.size,
          storageBytes: file.size,
        });
      } catch {
        /* usage counter only */
      }
    } catch (e) {
      console.warn("[uploadVoucherFilesOrStageLocalPending] upload failed, staging file as local-pending", e);
      try {
        const { reportOnlineTriggerQuotaExceeded } = await import("@/lib/onlineTriggerLog");
        reportOnlineTriggerQuotaExceeded(
          String((e as { code?: string })?.code ?? "") + " " + String((e as { message?: string })?.message ?? "")
        );
      } catch {
        /* ignore */
      }
      failedUploads.push(file);
    }
  }
  if (failedUploads.length > 0) {
    const { fileUrls: merged, preGeneratedVoucherId: preGen } = await appendLocalOnlyVoucherFilesToUrls({
      companyId: params.companyId,
      storageFolder: params.storageFolder,
      existingFileUrls: fileUrls,
      newFiles: failedUploads,
      maxFileCount: Number.isFinite(max) ? max : fileUrls.length + failedUploads.length,
      existingVoucherId: params.existingVoucherId,
    });
    fileUrls = merged;
    if (preGen) preGeneratedVoucherId = preGen;
  }
  return { fileUrls, preGeneratedVoucherId };
}
