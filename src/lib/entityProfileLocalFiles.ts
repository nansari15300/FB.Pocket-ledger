"use client";

/**
 * Party / Bank / Staff / Item: offline/local = IndexedDB + `local:uuid` + `syncPendingFiles`.
 * Online `uploadEntityAvatarAndDocumentsRemote` — turant Storage URL Firestore me (dusre device par turant kaam).
 */
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { storage } from "@/lib/plClientSession";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { companyRowUsesSqliteLedgerWrites, isServerGateCompany } from "@/lib/companyStorageKind";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { generateLocalFileId, LOCAL_FILE_PREFIX, putPendingFile, removePendingFile, isLocalFileRef } from "@/lib/localPendingFiles";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import {
  isEligibleLocalDriveSyncCompanyRow,
  shouldUseLocalCloudSync,
} from "@/lib/localCloudSync/companyConfig";
import { uploadPendingAttachmentPayloadToDrive } from "@/lib/localCloudSync/driveCloudSyncClient";
import { compressMasterAttachmentForCompany } from "@/lib/attachmentCompressionUi";
import { convertPdfAttachmentsToJpegIfEnabled } from "@/lib/voucherAttachmentPdfAsImage";
import {
  buildStorageObjectPath,
  buildStoragePathPrefix,
  resolveCompanyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";

export {
  MASTER_SAVE_PDF_AS_IMAGE_STORAGE_KEY,
  readMasterSavePdfAsImagePreference,
  readLockPdfAsPdfPreference,
} from "@/lib/attachmentPdfOptions";

async function maybeConvertMasterDocumentPdfsToImages(
  files: File[],
  savePdfAsImage?: boolean,
  companyId?: string | null,
  opts?: { lockPdfAsPdf?: boolean; lockedPdfFileUrls?: readonly string[] }
): Promise<File[]> {
  const { readMasterSavePdfAsImagePreference, readLockPdfAsPdfPreference } = await import(
    "@/lib/attachmentPdfOptions"
  );
  const lockPdfAsPdf = opts?.lockPdfAsPdf ?? readLockPdfAsPdfPreference(false);
  const enabled = (savePdfAsImage ?? readMasterSavePdfAsImagePreference(false)) && !lockPdfAsPdf;
  if (!enabled || files.length === 0) return files;
  const converted = await convertPdfAttachmentsToJpegIfEnabled(files, true, {
    companyId,
    lockPdfAsPdf,
    lockedPdfFileUrls: opts?.lockedPdfFileUrls,
  });
  return converted.filter((item): item is File => item instanceof File);
}

async function compressEntityProfileFileForPending(
  file: File,
  companyId?: string | null
): Promise<{
  blob: Blob;
  contentType: string;
  fileName: string;
}> {
  const { file: compressed } = await compressMasterAttachmentForCompany(file, companyId);
  return {
    blob: compressed,
    contentType: compressed.type || file.type || "application/octet-stream",
    fileName: compressed.name || file.name,
  };
}

/** Drive sync ON: save ke turant baad avatar/doc upload — `local:` stale na rahe, shared users `drive:` se load karein. */
async function tryImmediateDriveUploadForStagedEntityFile(params: {
  companyId: string;
  collectionSeg: EntityProfileCollection | "items";
  entityId: string;
  field: string;
  localId: string;
  blob: Blob;
  contentType: string;
  fileName: string;
}): Promise<string | null> {
  const cid = String(params.companyId || "").trim();
  if (!cid || !(await shouldUseLocalCloudSync(cid))) return null;
  try {
    const reg = await getLocalCompanyById(cid, { includeDeleted: true });
    const driveRef = await uploadPendingAttachmentPayloadToDrive({
      companyId: cid,
      companyName: typeof reg?.name === "string" ? reg.name : undefined,
      company: (reg ?? null) as Record<string, unknown> | null,
      collection: params.collectionSeg,
      docId: params.entityId,
      field: params.field,
      blob: params.blob,
      contentType: params.contentType,
      fileName: params.fileName,
    });
    if (driveRef?.trim()) {
      try {
        await removePendingFile(params.localId);
      } catch {
        /* pending cleanup best-effort */
      }
      return driveRef.trim();
    }
  } catch (e) {
    console.warn("[entityProfile] immediate Drive upload failed — keeping local: pending ref", e);
  }
  return null;
}

/** Local company — avatar/docs Firebase Storage par nahi; `local:` + Google Drive sync. */
export async function shouldStageEntityProfileFilesLocally(
  companyId: string,
  company?: { storageOption?: string; plServerShared?: boolean } | null
): Promise<boolean> {
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  if (isPlServerThinStaffClient()) return true;
  // Global local-first (web = EXE): masters never upload inline on save; background pending sync does it.
  try {
    const { apkEmbeddedSqliteFirstWritesPreferred } = await import("@/lib/apkOnlineFirestoreWritePolicy");
    if (apkEmbeddedSqliteFirstWritesPreferred()) return true;
  } catch {
    /* continue */
  }
  if (company && (isOfflineCompanyStorage(company) || isServerGateCompany(company) || companyRowUsesSqliteLedgerWrites(company))) {
    return true;
  }
  if (await shouldUseLocalCloudSync(cid)) return true;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return false;
  if (isOfflineCompanyStorage(reg as { storageOption?: string })) return true;
  if (isServerGateCompany(reg as { plServerShared?: boolean })) return true;
  if (companyRowUsesSqliteLedgerWrites(reg as { storageOption?: string; plServerShared?: boolean })) return true;
  return isEligibleLocalDriveSyncCompanyRow(reg);
}

/** Master payload me `local:` avatar/docs — PlServer save se pehle bytes server par push. */
export function recordContainsLocalPendingEntityFileRef(obj: Record<string, unknown>): boolean {
  return listLocalAttachmentRefsInEntityRecord(obj).length > 0;
}

/** Party/bank/staff/item master row se saare `local:` attachment refs. */
export function listLocalAttachmentRefsInEntityRecord(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pushRef = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const u = raw.trim();
    if (u && isLocalFileRef(u)) out.push(u);
  };
  pushRef(obj.fileUrl);
  pushRef(obj.avatarUrl);
  for (const key of ["documentFileUrls", "fileUrls"] as const) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const u of arr) pushRef(u);
  }
  return out;
}

const PL_SERVER_ENTITY_ATTACHMENT_FLUSH_BUDGET_MS = 20_000;

/** Stage ke baad `/__pl_attachment` upload — host loopback + staff gate (party/master rule). */
async function flushPlServerAttachmentsAfterEntityStaging(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  try {
    const { flushPlServerAttachmentsAfterStagingBudgeted } = await import(
      "@/lib/plServerAttachmentUploadQueue"
    );
    await flushPlServerAttachmentsAfterStagingBudgeted(cid, {
      budgetMs: PL_SERVER_ENTITY_ATTACHMENT_FLUSH_BUDGET_MS,
    });
  } catch {
    /* best-effort */
  }
}

function safeEntityFileName(name: string | undefined): string {
  if (!name?.trim()) return "file";
  return name
    .trim()
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

/** Offline staging path segment — Firebase +IndexedDB pending files */
export type EntityProfileCollection = "parties" | "bank_accounts" | "staff" | "taxes" | "expense_accounts";

const DEFAULT_MAX_ENTITY_DOCS = 5;

/** Profile photo — sirf image (ppic). */
export function isProfileAvatarImageFile(file: File | null | undefined): boolean {
  if (!file || typeof file !== "object") return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  const n = String(file.name || "").toLowerCase();
  if (!n) return false;
  return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/.test(n);
}

/** Dusra section — image ya PDF. */
export function isProfileDocumentFile(file: File | null | undefined): boolean {
  if (!file || typeof file !== "object") return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("image/") || t === "application/pdf") return true;
  const n = String(file.name || "").toLowerCase();
  if (!n) return false;
  return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?|pdf)$/.test(n);
}

export async function stageEntityAvatarAndDocuments(params: {
  companyId: string;
  collectionSeg: EntityProfileCollection;
  entityId: string;
  avatarFile: File | null;
  documentFiles: File[];
  maxDocuments?: number;
  savePdfAsImage?: boolean;
}): Promise<{ fileUrl: string | null; documentFileUrls: string[] }> {
  const { companyId, collectionSeg, entityId, avatarFile, documentFiles } = params;
  const maxDocuments = params.maxDocuments ?? DEFAULT_MAX_ENTITY_DOCS;
  const filesForSave = await maybeConvertMasterDocumentPdfsToImages(
    documentFiles,
    params.savePdfAsImage,
    companyId
  );
  const documentFileUrls: string[] = [];
  const stageLocally = await shouldStageEntityProfileFilesLocally(companyId);
  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(companyId);
  const docCompanyId = stageLocally ? String(companyId || "").trim() : fsCompanyId;
  const basePath = `companies/${docCompanyId}/${collectionSeg}/${entityId}`;
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(companyId);
  const avatarPrefix = buildStoragePathPrefix({
    companyId: fsCompanyId,
    usePocketLedger,
    collectionName: collectionSeg,
    fieldKey: "fileUrl",
  });
  const documentsPrefix = buildStoragePathPrefix({
    companyId: fsCompanyId,
    usePocketLedger,
    collectionName: collectionSeg,
    fieldKey: "documentFileUrls",
  });

  let fileUrl: string | null = null;
  if (avatarFile && isProfileAvatarImageFile(avatarFile)) {
    const id = generateLocalFileId();
    const staged = await compressEntityProfileFileForPending(avatarFile, companyId);
    await putPendingFile({
      replacesUrl: await recompressReplacementUrlFor(avatarFile),
      id,
      blob: staged.blob,
      contentType: staged.contentType,
      docPath: basePath,
      field: "fileUrl",
      storagePathPrefix: avatarPrefix,
      fileName: staged.fileName,
    });
    const driveRef = await tryImmediateDriveUploadForStagedEntityFile({
      companyId,
      collectionSeg,
      entityId,
      field: "fileUrl",
      localId: id,
      blob: staged.blob,
      contentType: staged.contentType,
      fileName: staged.fileName,
    });
    fileUrl = driveRef ?? `${LOCAL_FILE_PREFIX}${id}`;
  }

  for (const f of filesForSave) {
    if (documentFileUrls.length >= maxDocuments) break;
    if (!isProfileDocumentFile(f)) continue;
    const id = generateLocalFileId();
    const staged = await compressEntityProfileFileForPending(f, companyId);
    await putPendingFile({
      replacesUrl: await recompressReplacementUrlFor(f),
      id,
      blob: staged.blob,
      contentType: staged.contentType,
      docPath: basePath,
      field: "documentFileUrls",
      storagePathPrefix: documentsPrefix,
      fileName: staged.fileName,
    });
    const driveRef = await tryImmediateDriveUploadForStagedEntityFile({
      companyId,
      collectionSeg,
      entityId,
      field: "documentFileUrls",
      localId: id,
      blob: staged.blob,
      contentType: staged.contentType,
      fileName: staged.fileName,
    });
    documentFileUrls.push(driveRef ?? `${LOCAL_FILE_PREFIX}${id}`);
  }
  await flushPlServerAttachmentsAfterEntityStaging(companyId);
  return { fileUrl, documentFileUrls };
}

async function recompressReplacementUrlFor(f: Blob): Promise<string | undefined> {
  try {
    const { getRecompressReplacementSourceUrl } = await import("@/lib/attachmentRecompressOnSave");
    return getRecompressReplacementSourceUrl(f);
  } catch {
    return undefined;
  }
}

/** Phase 2 hotfix: Storage failure / quota must never block a master save. */
async function reportMasterUploadFailure(e: unknown): Promise<void> {
  console.warn("[entityProfile] remote upload failed - staging files as local pending", e);
  try {
    const { reportOnlineTriggerQuotaExceeded } = await import("@/lib/onlineTriggerLog");
    reportOnlineTriggerQuotaExceeded(
      String((e as { code?: string })?.code ?? "") + " " + String((e as { message?: string })?.message ?? "")
    );
  } catch {
    /* ignore */
  }
}

/** Online Firebase company: Storage URL; local/Drive company par hamesha `stageEntityAvatarAndDocuments`. */
export async function uploadEntityAvatarAndDocumentsRemote(params: {
  companyId: string;
  collectionSeg: EntityProfileCollection;
  /** Future path scoping; storage prefix me company se hi enough hai */
  entityId: string;
  avatarFile: File | null;
  documentFiles: File[];
  maxDocuments?: number;
  company?: { storageOption?: string; plServerShared?: boolean } | null;
  savePdfAsImage?: boolean;
}): Promise<{ fileUrl: string | null; documentFileUrls: string[] }> {
  if (await shouldStageEntityProfileFilesLocally(params.companyId, params.company)) {
    return stageEntityAvatarAndDocuments(params);
  }
  try {
    return await uploadEntityAvatarAndDocumentsRemoteDirect(params);
  } catch (e) {
    await reportMasterUploadFailure(e);
    return stageEntityAvatarAndDocuments(params);
  }
}

async function uploadEntityAvatarAndDocumentsRemoteDirect(
  params: Parameters<typeof uploadEntityAvatarAndDocumentsRemote>[0]
): Promise<{ fileUrl: string | null; documentFileUrls: string[] }> {
  const { companyId, collectionSeg, avatarFile, documentFiles } = params;
  const maxDocuments = params.maxDocuments ?? DEFAULT_MAX_ENTITY_DOCS;
  const filesForSave = await maybeConvertMasterDocumentPdfsToImages(
    documentFiles,
    params.savePdfAsImage,
    companyId
  );
  const documentFileUrls: string[] = [];
  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(companyId);
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(companyId);
  const avatarPrefix = buildStoragePathPrefix({
    companyId: fsCompanyId,
    usePocketLedger,
    collectionName: collectionSeg,
    fieldKey: "fileUrl",
  });
  const documentsPrefix = buildStoragePathPrefix({
    companyId: fsCompanyId,
    usePocketLedger,
    collectionName: collectionSeg,
    fieldKey: "documentFileUrls",
  });

  let fileUrl: string | null = null;
  if (avatarFile && isProfileAvatarImageFile(avatarFile)) {
    const storagePath = buildStorageObjectPath({
      prefix: avatarPrefix,
      fileName: avatarFile.name,
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, avatarFile, { contentType: avatarFile.type || "image/jpeg" });
    fileUrl = await getDownloadURL(storageRef);
  }

  for (const f of filesForSave) {
    if (documentFileUrls.length >= maxDocuments) break;
    if (!isProfileDocumentFile(f)) continue;
    const storagePath = buildStorageObjectPath({
      prefix: documentsPrefix,
      fileName: f.name,
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, f, { contentType: f.type || "application/octet-stream" });
    documentFileUrls.push(await getDownloadURL(storageRef));
  }
  return { fileUrl, documentFileUrls };
}

/** Item: thumbnail `avatarUrl` (image) alag, `fileUrls` attachments. */
export async function stageItemAvatarAndAttachments(params: {
  companyId: string;
  itemId: string;
  avatarFile: File | null;
  attachmentFiles: File[];
  maxAttachments: number;
  savePdfAsImage?: boolean;
}): Promise<{ avatarUrl: string | null; newAttachmentUrls: string[] }> {
  const { companyId, itemId, avatarFile, attachmentFiles } = params;
  const filesForSave = await maybeConvertMasterDocumentPdfsToImages(
    attachmentFiles,
    params.savePdfAsImage,
    companyId
  );
  const basePath = `companies/${companyId}/items/${itemId}`;
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(companyId);
  const avatarPrefix = buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: "items",
    fieldKey: "avatarUrl",
  });
  const attachmentsPrefix = buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: "items",
    fieldKey: "fileUrls",
  });

  let avatarUrl: string | null = null;
  if (avatarFile && isProfileAvatarImageFile(avatarFile)) {
    const id = generateLocalFileId();
    const staged = await compressEntityProfileFileForPending(avatarFile, companyId);
    await putPendingFile({
      replacesUrl: await recompressReplacementUrlFor(avatarFile),
      id,
      blob: staged.blob,
      contentType: staged.contentType,
      docPath: basePath,
      field: "avatarUrl",
      storagePathPrefix: avatarPrefix,
      fileName: staged.fileName,
    });
    const driveRef = await tryImmediateDriveUploadForStagedEntityFile({
      companyId,
      collectionSeg: "items",
      entityId: itemId,
      field: "avatarUrl",
      localId: id,
      blob: staged.blob,
      contentType: staged.contentType,
      fileName: staged.fileName,
    });
    avatarUrl = driveRef ?? `${LOCAL_FILE_PREFIX}${id}`;
  }

  const newAttachmentUrls: string[] = [];
  for (const f of filesForSave) {
    if (newAttachmentUrls.length >= params.maxAttachments) break;
    if (!isProfileDocumentFile(f)) continue;
    const id = generateLocalFileId();
    const staged = await compressEntityProfileFileForPending(f, companyId);
    await putPendingFile({
      replacesUrl: await recompressReplacementUrlFor(f),
      id,
      blob: staged.blob,
      contentType: staged.contentType,
      docPath: basePath,
      field: "fileUrls",
      storagePathPrefix: attachmentsPrefix,
      fileName: staged.fileName,
    });
    const driveRef = await tryImmediateDriveUploadForStagedEntityFile({
      companyId,
      collectionSeg: "items",
      entityId: itemId,
      field: "fileUrls",
      localId: id,
      blob: staged.blob,
      contentType: staged.contentType,
      fileName: staged.fileName,
    });
    newAttachmentUrls.push(driveRef ?? `${LOCAL_FILE_PREFIX}${id}`);
  }
  await flushPlServerAttachmentsAfterEntityStaging(companyId);
  return { avatarUrl, newAttachmentUrls };
}

/** Item online Firebase: Storage URLs; local/Drive company par `stageItemAvatarAndAttachments`. */
export async function uploadItemAvatarAndAttachmentsRemote(params: {
  companyId: string;
  itemId: string;
  avatarFile: File | null;
  attachmentFiles: File[];
  maxAttachments: number;
  savePdfAsImage?: boolean;
}): Promise<{ avatarUrl: string | null; newAttachmentUrls: string[] }> {
  if (await shouldStageEntityProfileFilesLocally(params.companyId)) {
    return stageItemAvatarAndAttachments(params);
  }
  try {
    return await uploadItemAvatarAndAttachmentsRemoteDirect(params);
  } catch (e) {
    await reportMasterUploadFailure(e);
    return stageItemAvatarAndAttachments(params);
  }
}

async function uploadItemAvatarAndAttachmentsRemoteDirect(
  params: Parameters<typeof uploadItemAvatarAndAttachmentsRemote>[0]
): Promise<{ avatarUrl: string | null; newAttachmentUrls: string[] }> {
  const { companyId, avatarFile, attachmentFiles, maxAttachments } = params;
  const filesForSave = await maybeConvertMasterDocumentPdfsToImages(
    attachmentFiles,
    params.savePdfAsImage,
    companyId
  );
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(companyId);
  const avatarPrefix = buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: "items",
    fieldKey: "avatarUrl",
  });
  const attachmentsPrefix = buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: "items",
    fieldKey: "fileUrls",
  });
  let avatarUrl: string | null = null;
  if (avatarFile && isProfileAvatarImageFile(avatarFile)) {
    const storagePath = buildStorageObjectPath({
      prefix: avatarPrefix,
      fileName: avatarFile.name,
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, avatarFile, { contentType: avatarFile.type || "image/jpeg" });
    avatarUrl = await getDownloadURL(storageRef);
  }
  const newAttachmentUrls: string[] = [];
  for (const f of filesForSave) {
    if (newAttachmentUrls.length >= maxAttachments) break;
    if (!isProfileDocumentFile(f)) continue;
    const storagePath = buildStorageObjectPath({
      prefix: attachmentsPrefix,
      fileName: f.name,
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, f, { contentType: f.type || "application/octet-stream" });
    newAttachmentUrls.push(await getDownloadURL(storageRef));
  }
  return { avatarUrl, newAttachmentUrls };
}

/** Save ke baad attachments + Drive delta — UI block mat karo (SQLite save pehle ho chuka hota hai). */
export function syncEntityAttachmentsAfterSave(companyId: string): void {
  void syncEntityAttachmentsAfterSaveAsync(companyId);
}

export async function syncEntityAttachmentsAfterSaveAndWait(companyId: string): Promise<void> {
  await syncEntityAttachmentsAfterSaveAsync(companyId);
}

async function syncEntityAttachmentsAfterSaveAsync(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  try {
    const { shouldEnqueuePlServerAttachmentUpload, flushPlServerAttachmentsAfterStagingBudgeted } =
      await import("@/lib/plServerAttachmentUploadQueue");
    if (await shouldEnqueuePlServerAttachmentUpload(cid)) {
      await flushPlServerAttachmentsAfterStagingBudgeted(cid, {
        budgetMs: PL_SERVER_ENTITY_ATTACHMENT_FLUSH_BUDGET_MS,
      });
      return;
    }
    if (await shouldUseLocalCloudSync(cid)) {
      const { scheduleLocalCloudSyncInBackground } = await import("@/lib/localCloudSync/engine");
      scheduleLocalCloudSyncInBackground(cid, { force: true });
      return;
    }
    const { syncPendingFiles } = await import("@/lib/localPendingFiles");
    await syncPendingFiles();
  } catch (e) {
    console.warn("[entityProfile] attachment sync after save", e);
  }
}
