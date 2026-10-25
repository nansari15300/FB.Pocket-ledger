import type { Company } from "@/hooks/useCompany";
import {
  readMasterSavePdfAsImagePreference,
  syncEntityAttachmentsAfterSave,
  uploadEntityAvatarAndDocumentsRemote,
} from "@/lib/entityProfileLocalFiles";
import { incrementCompanyStorage } from "@/lib/storageUsageClient";
import { nowIso } from "../db/loanIds";

export async function saveLoanLiabilityAttachments(params: {
  companyId: string;
  company: Company | null;
  staffId: string;
  avatar?: File | string | null;
  documents?: (File | string)[];
}): Promise<void> {
  const staffId = String(params.staffId || "").trim();
  if (!staffId || !params.companyId) return;

  const avatar = params.avatar ?? null;
  const documents = params.documents ?? [];
  const hasWork =
    avatar instanceof File ||
    documents.some((d) => d instanceof File) ||
    avatar === null ||
    (typeof avatar === "string" && avatar.length > 0) ||
    documents.some((d) => typeof d === "string");

  if (!hasWork) return;

  const { prepareMasterEditAttachmentsForSave } = await import("@/lib/attachmentRecompressOnSave");
  const prepared = await prepareMasterEditAttachmentsForSave({
    companyId: params.companyId,
    avatar,
    documents,
  });

  let fileUrl: string | null = typeof prepared.avatar === "string" ? prepared.avatar : null;
  if (prepared.avatar === null) fileUrl = null;

  const newDocFiles = prepared.newDocFiles;
  const keptDocUrls = prepared.keptDocUrls;
  let documentFileUrls = [...keptDocUrls];

  const totalBytes =
    (prepared.avatar instanceof File ? prepared.avatar.size : 0) + newDocFiles.reduce((s, f) => s + f.size, 0);
  if (totalBytes > 0) {
    const { checkStorageLimitSafe } = await import("@/lib/voucherFormAttachmentsBeforeSave");
    const limitCheck = await checkStorageLimitSafe(
      params.companyId,
      params.company?.planId,
      { attachmentsBytes: totalBytes, storageBytes: totalBytes },
      params.company?.storageOption
    );
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.message || "Storage limit reached.");
    }
  }

  const needAvatarUpload = prepared.avatar instanceof File;
  const needNewDocsUpload = newDocFiles.length > 0;
  if (needAvatarUpload || needNewDocsUpload) {
    const uploaded = await uploadEntityAvatarAndDocumentsRemote({
      companyId: params.companyId,
      collectionSeg: "staff",
      entityId: staffId,
      avatarFile: needAvatarUpload ? (prepared.avatar as File) : null,
      documentFiles: needNewDocsUpload ? newDocFiles : [],
      company: params.company,
      savePdfAsImage: readMasterSavePdfAsImagePreference(false),
    });
    if (uploaded.fileUrl) fileUrl = uploaded.fileUrl;
    documentFileUrls = [...keptDocUrls, ...uploaded.documentFileUrls];
    if (totalBytes > 0) {
      try {
        await incrementCompanyStorage(params.companyId, {
          attachmentsBytes: totalBytes,
          storageBytes: totalBytes,
        });
      } catch {
        /* offline */
      }
    }
  }

  const { writeLoanEntity } = await import("../db/loanEntityWrite");
  const patch = await writeLoanEntity({
    companyId: params.companyId,
    collectionName: "staff",
    docId: staffId,
    operation: "create",
    data: {
      fileUrl: fileUrl || null,
      documentFileUrls: documentFileUrls.length ? documentFileUrls : [],
      updatedAt: nowIso(),
    },
    options: { merge: true, skipPlanMutationGate: true },
  });
  if (patch.ok === false) throw new Error(patch.error || "Could not save loan account attachments.");

  try {
    await syncEntityAttachmentsAfterSave(params.companyId);
  } catch {
    /* best-effort */
  }
}
