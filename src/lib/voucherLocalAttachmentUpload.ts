"use client";

/**
 * Local/static company: nayi files Firebase Storage ke bina — IndexedDB blob + voucher JSON me `local:uuid` ref.
 * SQLite `company_docs` me URLs string ke roop me; actual bytes `offlineDb` pendingFiles store me.
 */
import { generateLocalVoucherIdForCreate } from "@/lib/localEntityIds";
import {
  generateLocalFileId,
  getBlobFromLocalFileRef,
  LOCAL_FILE_PREFIX,
  isLocalFileRef,
  putPendingFile,
} from "@/lib/localPendingFiles";
import {
  apkCloudCompanyUsesSqliteFirstWrites,
  apkEmbeddedSqliteFirstWritesPreferred,
  isClientNavigatorOffline,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { getRemoteAttachmentBlobPreferOfflineCache } from "@/lib/offlineAttachmentUrlCache";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import { isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import {
  buildStoragePathPrefix,
  resolveCompanyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";

/**
 * Legacy rollback: `NEXT_PUBLIC_VOUCHER_ATTACHMENT_FIRESTORE_IMMEDIATE_UPLOAD=1` → purana flow (online + Firestore-first par form `uploadBytes` await).
 * Default: false — nayi files hamesha `local:` + IndexedDB, `saveVoucher` blocking hydrate skip (background `syncPendingFiles`).
 */
export function voucherAttachmentFirestoreImmediateUploadEnabled(): boolean {
  // NEXT_PUBLIC vars are build-time injected on client bundles; missing/blank should safely default to disabled.
  const raw =
    typeof process !== "undefined"
      ? String(process.env.NEXT_PUBLIC_VOUCHER_ATTACHMENT_FIRESTORE_IMMEDIATE_UPLOAD ?? "").trim()
      : "";
  return raw === "1";
}

/** Single product gate: immediate Storage upload on save off unless legacy env above. */
export function voucherNewAttachmentsAlwaysStageAsLocalPending(): boolean {
  if (isPlServerThinStaffClient()) return true;
  // Web online: hamesha Firebase-immediate semantics treat karo; `local:` sirf offline/embedded flows me.
  if (typeof navigator !== "undefined" && navigator.onLine && !isElectronDesktopApp() && !isCapacitorNativeApp() && !isStaticAppBuild()) {
    return false;
  }
  // Embedded/offline ya explicit legacy toggle par pending-stage policy allow rahe.
  return !voucherAttachmentFirestoreImmediateUploadEnabled();
}

/** `saveVoucher` / `patchVoucherFields`: payload me `local:` ho to blocking `hydrateVoucherLocalAttachmentsForServer` skip kar sakte ho (setDoc id + `syncPendingFiles`). */
export function recordContainsLocalPendingVoucherFileRef(obj: Record<string, unknown>): boolean {
  const urls = obj.fileUrls;
  if (Array.isArray(urls)) {
    for (const u of urls) {
      if (typeof u === "string" && isLocalFileRef(u)) return true;
    }
  }
  const uf = obj.unassignedFile;
  if (uf && typeof uf === "object" && uf !== null) {
    const urlStr = (uf as Record<string, unknown>).url;
    if (typeof urlStr === "string" && isLocalFileRef(urlStr)) return true;
  }
  return false;
}

const STAGE_TIMEOUT = Symbol("stage-timeout");
/** IndexedDB / Capacitor Filesystem write that never settles must not block "Saving..." forever. */
function raceStageTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof STAGE_TIMEOUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(STAGE_TIMEOUT), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function appendLocalOnlyVoucherFilesToUrls(params: {
  companyId: string;
  /** `voucher-files/${companyId}/${storageFolder}/...` — sale, purchase, journal, payment_in, ... */
  storageFolder: string;
  existingFileUrls: string[];
  newFiles: File[];
  maxFileCount: number;
  /** Edit par existing id; create par null — tab naya voucher id yahi generate hoga */
  existingVoucherId: string | null;
}): Promise<{ fileUrls: string[]; preGeneratedVoucherId?: string }> {
  const { companyId, storageFolder, existingFileUrls, newFiles, maxFileCount, existingVoucherId } = params;
  const out = [...existingFileUrls];
  if (newFiles.length === 0) return { fileUrls: out };

  const fsRes = await raceStageTimeout(resolveAuthoritativeFirestoreCompanyId(companyId).catch(() => companyId), 5_000);
  const fsCompanyId = fsRes === STAGE_TIMEOUT ? companyId : fsRes;
  // PL staff: pending docPath local company id pe rakho — upload queue flush key mismatch (host id vs local id) avoid.
  let docCompanyId = fsCompanyId || companyId;
  try {
    const { isPlServerThinStaffCompany } = await import("@/lib/plServerThinStaffClient");
    if ((await raceStageTimeout(isPlServerThinStaffCompany(companyId), 3_000)) === true) docCompanyId = companyId;
  } catch {
    /* keep fsCompanyId */
  }
  const voucherIdForDoc = existingVoucherId || generateLocalVoucherIdForCreate();
  const preGeneratedVoucherId = existingVoucherId ? undefined : voucherIdForDoc;
  const plRes = await raceStageTimeout(resolveCompanyUsesPocketLedgerStorage(companyId).catch(() => false), 5_000);
  const usePocketLedger = plRes === STAGE_TIMEOUT ? false : plRes;
  if (plRes === STAGE_TIMEOUT) console.warn("[PL-DEBUG-SAVE] stage: resolveCompanyUsesPocketLedgerStorage timed out (5 s), default false");
  const storagePathPrefix = buildStoragePathPrefix({
    companyId,
    usePocketLedger,
    collectionName: "vouchers",
    fieldKey: "fileUrls",
    voucherType: storageFolder,
  });

  const { getRecompressReplacementSourceUrl } = await import("@/lib/attachmentRecompressOnSave");
  for (const file of newFiles) {
    if (out.length >= maxFileCount) break;
    const localFileId = generateLocalFileId();
    const pendingFile = {
      // Phase 2 hotfix: edit-time recompress whose re-upload failed -> swap + delete old after background upload.
      replacesUrl: getRecompressReplacementSourceUrl(file),
      id: localFileId,
      blob: file,
      contentType: file.type || "application/octet-stream",
      docPath: `companies/${docCompanyId}/vouchers/${voucherIdForDoc}`,
      field: "fileUrls",
      storagePathPrefix,
      fileName: file.name,
    };
    const localRef = `${LOCAL_FILE_PREFIX}${localFileId}`;
    const putP = putPendingFile(pendingFile);
    const putRes = await raceStageTimeout(putP, 15_000);
    if (putRes === STAGE_TIMEOUT) {
      // Write still in flight: keep the ref (bytes land when the write finishes) instead of blocking save / dropping file.
      console.warn("[PL-DEBUG-SAVE] stage: putPendingFile timed out (15 s); keeping ref, write continues in background", {
        localRef,
        fileName: file.name,
        size: file.size,
      });
      putP.catch((e) => {
        console.error("[voucherLocalAttachmentUpload] background putPendingFile failed; retrying once", e);
        void putPendingFile(pendingFile).catch((e2) =>
          console.error("[voucherLocalAttachmentUpload] retry putPendingFile failed", localRef, e2)
        );
      });
      out.push(localRef);
      continue;
    }
    const readBack = async () => {
      const r = await raceStageTimeout(getBlobFromLocalFileRef(localRef), 8_000);
      return r === STAGE_TIMEOUT ? STAGE_TIMEOUT : r;
    };
    let stagedBlob = await readBack();
    if (stagedBlob === STAGE_TIMEOUT) {
      console.warn("[PL-DEBUG-SAVE] stage: read-back timed out (8 s); write succeeded, keeping ref", localRef);
      out.push(localRef);
      continue;
    }
    if (!stagedBlob || stagedBlob.size <= 0) {
      const again = await raceStageTimeout(putPendingFile(pendingFile), 15_000);
      const rb = again === STAGE_TIMEOUT ? STAGE_TIMEOUT : await readBack();
      if (rb === STAGE_TIMEOUT) {
        console.warn("[PL-DEBUG-SAVE] stage: re-put/read-back timed out; keeping ref", localRef);
        out.push(localRef);
        continue;
      }
      stagedBlob = rb;
    }
    if (!stagedBlob || stagedBlob.size <= 0) {
      console.warn("[voucherLocalAttachmentUpload] pending file bytes missing after stage", {
        companyId,
        storageFolder,
        fileName: file.name,
        size: file.size,
      });
      continue;
    }
    out.push(localRef);
  }
  return { fileUrls: out, preGeneratedVoucherId };
}

/**
 * Voucher forms: nayi `File` — `appendLocalOnlyVoucherFilesToUrls` vs Storage `uploadBytes`.
 * Default (`voucherNewAttachmentsAlwaysStageAsLocalPending`): hamesha local stage — online + Server writes ON par bhi form `uploadBytes` await nahi.
 * Legacy env `NEXT_PUBLIC_VOUCHER_ATTACHMENT_FIRESTORE_IMMEDIATE_UPLOAD=1` par sirf offline / sqlite-first par stage (purana UX).
 */
export async function shouldStageNewVoucherFilesAsLocalPending(companyId: string): Promise<boolean> {
  // Cloud data sync off: Firebase Storage mat chhedo — nayi files `local:` pending stage.
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  // PL staff writes are server-authoritative, but bytes must travel via `/__pl_attachment`, not Firebase Storage.
  if (isPlServerThinStaffClient()) return true;
  // Offline client: stage in IndexedDB (`local:`) so user can still save and sync later.
  if (isClientNavigatorOffline()) return true;
  // Embedded shells (EXE/APK/static): keep local pending pipeline.
  if (isElectronDesktopApp() || isCapacitorNativeApp() || isStaticAppBuild()) return true;
  // Global local-first (web = EXE): never upload inline on save; background pending sync uploads + patches URL.
  if (apkEmbeddedSqliteFirstWritesPreferred()) return true;
  // Hosted web online: hamesha Firebase HTTPS — sqlite-first online company par bhi `local:` mat stage
  // (warna 2nd file web pe invisible / delete cross-device stale rehta hai).
  if (typeof navigator !== "undefined" && navigator.onLine) return false;
  // Offline embedded / non-web: sqlite-first companies local stage.
  if (await apkCloudCompanyUsesSqliteFirstWrites(String(companyId || "").trim())) return true;
  // Legacy explicit toggle can force immediate upload mode in non-web contexts.
  if (voucherAttachmentFirestoreImmediateUploadEnabled()) return false;
  return apkCloudCompanyUsesSqliteFirstWrites(String(companyId || "").trim());
}

/**
 * `local:` + IndexedDB stage: usage counter `syncPendingFiles` / hydrate upload par —
 * save ke waqt `incrementCompanyStorage` await se "Saving…" mat atkao.
 */
export function shouldDeferStorageIncrementUntilPendingUpload(): boolean {
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  if (isPlServerThinStaffClient()) return true;
  // Web online immediate upload (cloud Firestore company only): increment right away.
  if (typeof navigator !== "undefined" && navigator.onLine && !isElectronDesktopApp() && !isCapacitorNativeApp() && !isStaticAppBuild()) {
    return false;
  }
  return true;
}

function fileNameFromAttachmentRef(ref: string, fallbackIndex: number, contentType?: string): string {
  // URL/path se file name hint nikalo taaki copied attachments meaningful naam se save ho.
  const storagePath = tryGetStoragePathFromFirebaseDownloadUrl(ref);
  const fromPath = storagePath?.split("/").pop()?.trim();
  if (fromPath) return fromPath;
  try {
    const u = new URL(ref);
    const base = decodeURIComponent((u.pathname.split("/").pop() || "").split("?")[0] || "");
    if (base && !/^o$/i.test(base)) return base;
  } catch {
    /* non-url refs: local:/drive: fallback */
  }
  const ct = String(contentType || "").toLowerCase();
  const ext = ct.includes("pdf")
    ? "pdf"
    : ct.includes("png")
      ? "png"
      : ct.includes("webp")
        ? "webp"
        : ct.includes("jpeg") || ct.includes("jpg")
          ? "jpg"
          : "bin";
  return `copied_attachment_${fallbackIndex}.${ext}`;
}

/** Inter-company copy flow ke liye stable file-name helper export (build contract). */
export function fileNameFromInterCompanyAttachmentRef(
  ref: string,
  fallbackIndex: number,
  contentType?: string
): string {
  return fileNameFromAttachmentRef(ref, fallbackIndex, contentType);
}

/** Inter-company copy: local/drive/http ref se blob resolve karke peer upload pipeline ko do. */
export async function blobFromAttachmentRefForCopy(
  ref: string,
  options?: { companyId?: string; galleryUrls?: readonly string[] }
): Promise<Blob | null> {
  if (isLocalFileRef(ref) || isDriveFileRef(ref)) {
    return getRemoteAttachmentBlobPreferOfflineCache(ref, undefined, {
      galleryUrls: options?.galleryUrls,
      companyId: options?.companyId,
    });
  }
  if (/^https?:\/\//i.test(ref)) {
    return getRemoteAttachmentBlobPreferOfflineCache(ref);
  }
  // Local ref strict fallback: pending store se direct read.
  if (isLocalFileRef(ref)) {
    return getBlobFromLocalFileRef(ref);
  }
  return null;
}

/**
 * Copy To / Save & Copy To: har attachment ko naye `File` bytes me clone karo —
 * draft me dikhe + save par naya URL/upload (purana ref reuse na ho).
 */
export async function cloneVoucherAttachmentsAsNewFilesForCopy<T extends Record<string, unknown>>(params: {
  sourceCompanyId?: string;
  voucher: T;
}): Promise<{ voucher: T; importedCount: number }> {
  if (typeof File === "undefined") return { voucher: params.voucher, importedCount: 0 };
  const source = params.voucher;
  const cid = String(params.sourceCompanyId || "").trim();
  const rawUrls = Array.isArray(source.fileUrls) ? source.fileUrls : [];
  const existingFiles = rawUrls.filter(
    (u): u is File => typeof File !== "undefined" && u instanceof File
  );
  const strUrls = rawUrls
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((u) => u.trim());
  const uf = source.unassignedFile;
  if (strUrls.length === 0 && uf && typeof uf === "object" && uf !== null) {
    const url = String((uf as { url?: string }).url || "").trim();
    if (url) strUrls.push(url);
  }
  if (strUrls.length === 0) {
    if (existingFiles.length > 0) {
      return {
        voucher: { ...source, fileUrls: existingFiles, files: [], unassignedFile: null } as T,
        importedCount: 0,
      };
    }
    return { voucher: source, importedCount: 0 };
  }

  const clonedFiles: File[] = [...existingFiles];
  let importedCount = 0;
  for (let i = 0; i < strUrls.length; i++) {
    const ref = strUrls[i]!;
    const blob = await blobFromAttachmentRefForCopy(ref, {
      companyId: cid || undefined,
      galleryUrls: strUrls,
    });
    if (!blob || blob.size <= 0) continue;
    clonedFiles.push(
      new File([blob], fileNameFromAttachmentRef(ref, clonedFiles.length + 1, blob.type), {
        type: blob.type || "application/octet-stream",
      })
    );
    importedCount += 1;
  }
  if (clonedFiles.length === 0) return { voucher: source, importedCount: 0 };

  return {
    voucher: {
      ...source,
      fileUrls: clonedFiles,
      files: [],
      unassignedFile: null,
    } as T,
    importedCount,
  };
}

/**
 * Copy-to-local-company: remote/local refs ko File objects me materialize karo taaki target local company save par
 * `appendLocalOnlyVoucherFilesToUrls` se predictable `local:` refs ban sakein (stale cross-company URLs persist na hon).
 */
export async function importVoucherAttachmentsAsFilesForLocalCloudCopy<T extends Record<string, unknown>>(params: {
  targetCompanyId: string;
  sourceCompanyId?: string;
  voucher: T;
}): Promise<{ voucher: T; importedCount: number }> {
  const targetCompanyId = String(params.targetCompanyId || "").trim();
  if (!targetCompanyId || typeof File === "undefined") return { voucher: params.voucher, importedCount: 0 };
  const reg = await getLocalCompanyById(targetCompanyId);
  // Sirf device-local storage company ke liye force-import; cloud company ko pass-through URLs rehne do.
  if (!reg || !isOfflineCompanyStorage(reg as { storageOption?: string })) {
    return { voucher: params.voucher, importedCount: 0 };
  }
  return cloneVoucherAttachmentsAsNewFilesForCopy({
    sourceCompanyId: params.sourceCompanyId,
    voucher: params.voucher,
  });
}

/**
 * SQLite/local company save se pehle remote refs ko local pending refs me rewrite karo.
 * Isse local company rows me cross-company HTTPS refs persist nahi hote, aur attachment offline-open safe rehta hai.
 */
export async function rewriteRemoteVoucherAttachmentsForOfflineCompany(
  companyId: string,
  data: Record<string, unknown>,
  existingVoucherId: string | null
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  const reg = await getLocalCompanyById(cid);
  if (!reg || !isOfflineCompanyStorage(reg as { storageOption?: string })) return;
  const { shouldUseLocalCloudSync } = await import("@/lib/localCloudSync/companyConfig");
  if (await shouldUseLocalCloudSync(cid)) {
    // Google Drive sync: `local:` stage + background upload; `drive:` refs save par mat rewrite karo.
    return;
  }

  const storageFolder = String(data.type || "journal").trim() || "journal";
  const rawUrls = Array.isArray(data.fileUrls) ? data.fileUrls : [];
  const strUrls = rawUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  if (strUrls.length === 0) return;

  const keepAsIs: string[] = [];
  const stagedFiles: File[] = [];
  for (let i = 0; i < strUrls.length; i++) {
    const ref = strUrls[i]!.trim();
    // Existing local refs ko preserve karo; sirf remote/drive refs ko bytes-read karke local pending banao.
    if (isLocalFileRef(ref)) {
      keepAsIs.push(ref);
      continue;
    }
    const blob = await blobFromAttachmentRefForCopy(ref, { companyId: cid, galleryUrls: strUrls });
    if (!blob || blob.size <= 0) {
      // Unreadable ref ko drop na karo; original ref retain rahe to data loss na ho.
      keepAsIs.push(ref);
      continue;
    }
    stagedFiles.push(
      new File([blob], fileNameFromAttachmentRef(ref, i + 1, blob.type), {
        type: blob.type || "application/octet-stream",
      })
    );
  }
  if (stagedFiles.length === 0) {
    data.fileUrls = keepAsIs;
    return;
  }
  const { fileUrls } = await appendLocalOnlyVoucherFilesToUrls({
    companyId: cid,
    storageFolder,
    existingFileUrls: keepAsIs,
    newFiles: stagedFiles,
    maxFileCount: Math.max(keepAsIs.length + stagedFiles.length, 20),
    existingVoucherId,
  });
  data.fileUrls = fileUrls;
}
