"use client";

import { uploadVoucherFilesOrStageLocalPending, checkStorageLimitSafe } from "@/lib/voucherFormAttachmentsBeforeSave";
import { prepareVoucherAttachmentsForSave } from "@/lib/attachmentRecompressOnSave";
import {
  normalizeFormFileUrlsForSave,
  uploadVoucherAttachmentFileToFirebase,
} from "@/lib/voucherFormAttachmentSave";
import {
  appendLocalOnlyVoucherFilesToUrls,
  shouldStageNewVoucherFilesAsLocalPending,
  shouldDeferStorageIncrementUntilPendingUpload,
} from "@/lib/voucherLocalAttachmentUpload";
import { checkStorageLimit, incrementCompanyStorage } from "@/lib/storageUsageClient";

export async function prepareLoanJournalAttachments(params: {
  companyId: string;
  companyPlanId?: string | null;
  companyStorageOption?: string | null;
  files: (File | string)[];
  savePdfAsImage?: boolean;
  existingVoucherId?: string | null;
}): Promise<{ fileUrls: string[]; preGeneratedVoucherId?: string }> {
  const files = params.files || [];
  if (files.length === 0) return { fileUrls: [] };

  const filesForSave = await prepareVoucherAttachmentsForSave(files, {
    companyId: params.companyId,
    savePdfAsImage: params.savePdfAsImage,
  });
  let fileUrls = normalizeFormFileUrlsForSave(
    filesForSave.filter((f): f is string => typeof f === "string")
  );
  let preGeneratedVoucherId: string | undefined;
  const newFiles = filesForSave.filter((f): f is File => f instanceof File);
  if (newFiles.length === 0) return { fileUrls, preGeneratedVoucherId };

  const totalNewBytes = newFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const limitCheck = await checkStorageLimitSafe(
    params.companyId,
    params.companyPlanId ?? undefined,
    { attachmentsBytes: totalNewBytes, storageBytes: totalNewBytes },
    params.companyStorageOption ?? undefined
  );
  if (!limitCheck.allowed) {
    throw new Error(limitCheck.message || "Storage limit reached.");
  }

  if (await shouldStageNewVoucherFilesAsLocalPending(params.companyId)) {
    const { fileUrls: merged, preGeneratedVoucherId: preGen } = await appendLocalOnlyVoucherFilesToUrls({
      companyId: params.companyId,
      storageFolder: "journal",
      existingFileUrls: fileUrls,
      newFiles,
      maxFileCount: Math.max(fileUrls.length + newFiles.length, 10),
      existingVoucherId: params.existingVoucherId ?? null,
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
        /* offline */
      }
    }
    return { fileUrls, preGeneratedVoucherId };
  }

  {
    const up = await uploadVoucherFilesOrStageLocalPending({
      companyId: params.companyId,
      storageFolder: "journal",
      existingFileUrls: fileUrls,
      files: newFiles,
      existingVoucherId: params.existingVoucherId ?? null,
    });
    fileUrls = up.fileUrls;
    if (up.preGeneratedVoucherId) preGeneratedVoucherId = up.preGeneratedVoucherId;
  }
  return { fileUrls, preGeneratedVoucherId };
}
