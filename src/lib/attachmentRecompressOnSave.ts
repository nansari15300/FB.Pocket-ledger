"use client";

/**
 * Edit/create Save: existing image URLs + new image Files over company cap
 * (Online 100KB / Local·PL·Drive 150KB) → recompress to File for re-upload.
 */
import { toast as sonnerToast } from "sonner";
import { compressVoucherAttachment } from "@/lib/compression";
import { sniffBlobKindForPreview } from "@/lib/attachmentFormatLabel";
import { getBlobFromLocalFileRef, isLocalFileRef } from "@/lib/localPendingFiles";
import { getRemoteAttachmentBlobPreferOfflineCache } from "@/lib/offlineAttachmentUrlCache";
import {
  convertPdfAttachmentsToJpegIfEnabled,
  looksLikePdfAttachmentUrl,
  shouldSuggestPdfAsImage,
} from "@/lib/voucherAttachmentPdfAsImage";

function isImageFile(f: File): boolean {
  const t = (f.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)$/i.test(f.name || "");
}

export function looksLikeImageAttachmentUrl(url: string): boolean {
  const low = String(url || "").toLowerCase();
  if (!low) return false;
  if (looksLikePdfAttachmentUrl(url)) return false;
  if (low.includes("image%2f") || low.includes("image/")) return true;
  const path = low.split("?")[0] || "";
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)$/.test(path)) return true;
  // `local:` / drive — blob sniff decide karega (size known after local read).
  if (isLocalFileRef(url) || low.startsWith("drive:")) return true;
  // HTTPS without image MIME/extension: full download mat (edit Save hang).
  return false;
}

async function loadAttachmentBlob(
  url: string,
  opts?: { companyId?: string | null; signal?: AbortSignal }
): Promise<Blob | null> {
  const { throwIfAttachmentCompressionAborted } = await import("@/lib/attachmentCompressionUi");
  throwIfAttachmentCompressionAborted(opts?.signal);
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;

  if (isLocalFileRef(trimmed)) {
    let blob = await getBlobFromLocalFileRef(trimmed);
    if (!blob || blob.size === 0) {
      const { readActiveAttachmentCompanyId } = await import("@/lib/firestorePermissionSuppress");
      const cid = opts?.companyId?.trim() || readActiveAttachmentCompanyId() || undefined;
      if (cid) {
        const { resolvePlServerStaffAttachmentPreviewBlob } = await import(
          "@/lib/plServerAttachmentFetch"
        );
        blob = await resolvePlServerStaffAttachmentPreviewBlob(trimmed, { companyId: cid });
      }
    }
    return blob && blob.size > 0 ? blob : null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    let blob = await getRemoteAttachmentBlobPreferOfflineCache(trimmed, undefined, {
      companyId: opts?.companyId,
      explicitUserRequest: true,
    });
    if (!blob || blob.size === 0) {
      try {
        const res = await fetch(trimmed, { mode: "cors", signal: opts?.signal });
        if (!res.ok) return null;
        blob = await res.blob();
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          const { AttachmentCompressionCancelledError } = await import("@/lib/attachmentCompressionUi");
          throw new AttachmentCompressionCancelledError();
        }
        return null;
      }
    }
    return blob && blob.size > 0 ? blob : null;
  }

  if (trimmed.startsWith("drive:")) {
    try {
      const { fetchAttachmentRefBlob } = await import("@/lib/attachmentRefBlobFetch");
      const { readActiveAttachmentCompanyId } = await import("@/lib/firestorePermissionSuppress");
      const cid = opts?.companyId?.trim() || readActiveAttachmentCompanyId() || undefined;
      const blob = await fetchAttachmentRefBlob(trimmed, { companyId: cid });
      return blob && blob.size > 0 ? blob : null;
    } catch {
      return null;
    }
  }

  return null;
}

function fileNameForCompressedImage(urlOrName: string, contentType: string): string {
  const base =
    String(urlOrName || "image")
      .split(/[\\/]/)
      .pop()
      ?.split("?")[0] || "image";
  const stem = base.replace(/\.[a-z0-9]+$/i, "") || "image";
  const t = (contentType || "").toLowerCase();
  if (t.includes("png")) return `${stem}.png`;
  if (t.includes("webp")) return `${stem}.webp`;
  return `${stem}.jpg`;
}

/**
 * Shared HTTPS (source already in company / paste reuse):
 * over cap → compress → new upload → rewrite ALL places (source included) → delete old.
 * Never returns a File for shared refs (File = fork → alag URL / alag badge).
 * Under cap / not cloud / fail → original URL (shared link rahe).
 *
 * Simple product rule (online + offline reuse):
 * - New add / reuse: same bytes (same URL) on every voucher.
 * - Edit oversized reused: compress once → new URL everywhere → delete old (storage save).
 */
export async function ensureSharedHttpsAttachmentCompressed(params: {
  companyId?: string | null;
  fromUrl: string;
  /** Already-compressed image; omit to load+compress inside. */
  compressed?: File;
  silent?: boolean;
}): Promise<string> {
  const cid = String(params.companyId || "").trim();
  const fromUrl = String(params.fromUrl || "").trim();
  if (!cid || !/^https?:\/\//i.test(fromUrl)) return fromUrl;

  try {
    // NOTE: `shouldStageNewVoucherFilesAsLocalPending` yahan mat use karo.
    // Online SQLite-first pe woh true hota hai (nayi File → local: stage),
    // lekin shared HTTPS over Online 100KB / EXE 150KB pe Firebase
    // upload + company-wide rewrite chahiye.

    const { isFirebaseLedgerDataSyncDisabled } = await import(
      "@/lib/firebaseLedgerDataSyncDisabled"
    );
    if (isFirebaseLedgerDataSyncDisabled()) return fromUrl;

    const { isPlServerThinStaffClient } = await import("@/lib/plServerThinStaffClient");
    if (isPlServerThinStaffClient()) return fromUrl;

    const { isClientNavigatorOffline } = await import("@/lib/apkOnlineFirestoreWritePolicy");
    if (isClientNavigatorOffline()) return fromUrl;

    const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
    const { isCloudBackedCompanyShape } = await import("@/lib/offlineFullWarmSync");
    const row = await getLocalCompanyById(cid, { includeDeleted: true });
    // Sirf Online/cloud companies: shared HTTPS Storage rewrite. Local/PL → as-is.
    if (!isCloudBackedCompanyShape(row as never)) return fromUrl;

    const {
      countAttachmentUsageInCompany,
      getAttachmentReuseSessionHintAsync,
      getFirebaseAttachmentRefCount,
      linkCloudAttachmentRefs,
    } = await import("@/lib/companyAttachmentRegistry");
    const [usage, sessionHint, registryCount] = await Promise.all([
      countAttachmentUsageInCompany(cid, fromUrl),
      getAttachmentReuseSessionHintAsync(cid, fromUrl),
      getFirebaseAttachmentRefCount(cid, fromUrl),
    ]);
    // Shared = SQLite places / paste session / Firestore registry.
    const isShared = usage >= 1 || sessionHint >= 2 || registryCount >= 2;
    if (!isShared) return fromUrl;

    const { resolveAttachmentImageKbBand } = await import("@/lib/attachmentCompressionUi");
    const band = await resolveAttachmentImageKbBand(cid);
    const maxBytes = band.maxKb * 1024;

    let compressed = params.compressed ?? null;
    if (!compressed) {
      const blob = await loadAttachmentBlob(fromUrl, { companyId: cid });
      if (!blob || blob.size <= maxBytes) return fromUrl;
      const kind = await sniffBlobKindForPreview(blob);
      if (kind !== "image") return fromUrl;
      const type = (blob.type || "image/jpeg").toLowerCase().startsWith("image/")
        ? blob.type || "image/jpeg"
        : "image/jpeg";
      const srcFile = new File([blob], fileNameForCompressedImage(fromUrl, type), { type });
      const next = await compressVoucherAttachment(srcFile, maxBytes, { minKB: band.minKb });
      if (next.size >= blob.size) return fromUrl;
      compressed = next;
    }
    // Caller-provided File: over-cap path already made it smaller — upload + rewrite all places.

    if (!params.silent) {
      const { VOUCHER_SONNER_TOAST_CN, VOUCHER_SONNER_TOAST_POSITION } = await import(
        "@/lib/voucherSaveUi"
      );
      sonnerToast.message("Compressing shared file — updating all reuse places…", {
        position: VOUCHER_SONNER_TOAST_POSITION,
        classNames: { toast: VOUCHER_SONNER_TOAST_CN },
      });
    }

    const { uploadVoucherAttachmentFileToFirebase } = await import(
      "@/lib/voucherFormAttachmentSave"
    );
    const toUrl = await uploadVoucherAttachmentFileToFirebase({
      companyId: cid,
      voucherType: "attachments",
      file: compressed,
    });

    try {
      const { seedOfflineAttachmentCacheFromBlob } = await import(
        "@/lib/offlineAttachmentUrlCache"
      );
      await seedOfflineAttachmentCacheFromBlob(toUrl, compressed);
    } catch {
      /* non-fatal */
    }
    try {
      const { rememberHoverBlobUrl } = await import("@/lib/attachmentHoverBlobCache");
      const blobUrl = URL.createObjectURL(compressed);
      rememberHoverBlobUrl(toUrl, blobUrl);
      rememberHoverBlobUrl(`${toUrl}::cell-thumb`, blobUrl);
    } catch {
      /* non-fatal */
    }

    try {
      const { incrementCompanyStorage } = await import("@/lib/storageUsageClient");
      await incrementCompanyStorage(cid, {
        attachmentsBytes: compressed.size,
        storageBytes: compressed.size,
      });
    } catch {
      /* non-fatal */
    }

    const { rewriteCompanyHttpsAttachmentUrlEverywhere } = await import(
      "@/lib/rewriteCompanyHttpsAttachmentUrl"
    );
    const result = await rewriteCompanyHttpsAttachmentUrlEverywhere({
      companyId: cid,
      fromUrl,
      toUrl,
    });

    // Target form abhi SQLite me na ho — registry/session pe naya URL link.
    try {
      await linkCloudAttachmentRefs(cid, [toUrl]);
    } catch {
      /* non-fatal */
    }

    if (!params.silent) {
      const { showAttachmentCompressionDoneToast } = await import("@/lib/attachmentCompressionUi");
      if (result.deletedOld) {
        showAttachmentCompressionDoneToast("File compressed");
      } else if (result.rewrittenPlaces > 0) {
        showAttachmentCompressionDoneToast(`Shared file updated in ${result.rewrittenPlaces} places`);
      }
    }
    return toUrl;
  } catch (e) {
    console.error("[recompress] shared https compress failed — keep shared URL", e);
    // Fork mat: pehli URL hi rakh (badge / same ref).
    return fromUrl;
  }
}

/**
 * Over-cap HTTPS on Save:
 * - Reused (anywhere / session / registry) → compress + rewrite all + delete old (string URL).
 * - Never return File for reused HTTPS (File = per-voucher upload fork).
 * - Not reused → File so this voucher alone re-uploads.
 */
async function propagateReusedHttpsRecompressOrReturnFile(params: {
  companyId?: string | null;
  fromUrl: string;
  compressed: File;
  silent?: boolean;
}): Promise<File | string> {
  const cid = String(params.companyId || "").trim();
  const fromUrl = String(params.fromUrl || "").trim();
  if (!cid || !/^https?:\/\//i.test(fromUrl)) return params.compressed;
  // Global local-first: no inline Storage upload / registry reads on save. Return the compressed File; it is
  // staged as local: pending with replacesUrl=fromUrl, and the background upload swaps the URL everywhere and
  // deletes the old object only when nothing references it.
  try {
    const { apkEmbeddedSqliteFirstWritesPreferred } = await import("@/lib/apkOnlineFirestoreWritePolicy");
    if (apkEmbeddedSqliteFirstWritesPreferred()) {
      markRecompressReplacementSourceUrl(params.compressed, fromUrl);
      return params.compressed;
    }
  } catch {
    /* continue legacy path */
  }

  const {
    countAttachmentUsageInCompany,
    getAttachmentReuseSessionHintAsync,
    getFirebaseAttachmentRefCount,
  } = await import("@/lib/companyAttachmentRegistry");
  const [usage, sessionHint, registryCount] = await Promise.all([
    countAttachmentUsageInCompany(cid, fromUrl),
    getAttachmentReuseSessionHintAsync(cid, fromUrl),
    getFirebaseAttachmentRefCount(cid, fromUrl),
  ]);
  const isShared = usage >= 1 || sessionHint >= 2 || registryCount >= 2;
  if (!isShared) return params.compressed;

  const rewritten = await ensureSharedHttpsAttachmentCompressed({
    companyId: cid,
    fromUrl,
    compressed: params.compressed,
    silent: params.silent,
  });
  if (rewritten !== fromUrl) return rewritten;

  // Shared rewrite fail/skip → per-voucher upload (dev: warna purani URL + size same dikhe).
  try {
    const { uploadVoucherAttachmentFileToFirebase } = await import(
      "@/lib/voucherFormAttachmentSave"
    );
    return await uploadVoucherAttachmentFileToFirebase({
      companyId: cid,
      voucherType: "attachments",
      file: params.compressed,
    });
  } catch (e) {
    console.error("[recompress] shared fallback upload failed — return File", e);
    return params.compressed;
  }
}

/**
 * Phase 2 hotfix: compressed File that replaces an already-uploaded HTTPS attachment (edit-time recompress
 * whose immediate re-upload failed). Staging code reads this so the pending upload later swaps the old URL
 * everywhere and deletes the old Storage object only when nothing references it (same rule as
 * rewriteCompanyHttpsAttachmentUrlEverywhere).
 */
const recompressReplacementSourceUrl = new WeakMap<Blob, string>();

export function getRecompressReplacementSourceUrl(file: Blob | null | undefined): string | undefined {
  if (!file) return undefined;
  return recompressReplacementSourceUrl.get(file);
}

export function markRecompressReplacementSourceUrl(file: Blob, fromUrl: string): void {
  if (file && /^https?:\/\//i.test(String(fromUrl || ""))) recompressReplacementSourceUrl.set(file, fromUrl);
}

type SaveCompressJob =
  | { index: number; kind: "file"; file: File }
  | { index: number; kind: "url"; url: string; blob: Blob; srcFile: File };

/**
 * Images over company cap → compressed `File` (re-upload). Under-cap / non-image unchanged.
 * Online ≤100KB; Local / PL Server / Drive ≤150KB.
 * Reused HTTPS: upload + company-wide rewrite + delete old immediately.
 * Multi-file: download + compress parallel (pehle sequential tha → 2nd file 10× slow).
 */
export async function recompressOversizedImageAttachmentsOnSave(
  items: (File | string)[],
  opts?: { companyId?: string | null; silent?: boolean }
): Promise<(File | string)[]> {
  if (!items.length) return items;
  const { resolveAttachmentImageKbBand } = await import("@/lib/attachmentCompressionUi");
  const band = await resolveAttachmentImageKbBand(opts?.companyId);
  const maxBytes = band.maxKb * 1024;

  const hasOversizedImageFile = items.some(
    (item) => item instanceof File && isImageFile(item) && item.size > maxBytes
  );
  const hasImageUrl = items.some((item) => {
    if (typeof item !== "string") return false;
    const url = String(item || "").trim();
    return url.length > 0 && looksLikeImageAttachmentUrl(url);
  });
  // Add-time compress (Payment jaisa): sirf File/PDF under cap — save par dubara download/compress mat karo.
  if (!hasOversizedImageFile && !hasImageUrl) return items;

  let skipExistingUrlRecompress = false;
  try {
    const { apkEmbeddedSqliteFirstWritesPreferred } = await import("@/lib/apkOnlineFirestoreWritePolicy");
    skipExistingUrlRecompress = apkEmbeddedSqliteFirstWritesPreferred();
  } catch {
    /* ignore */
  }
  try {
    const { isServerQuotaHoldActive } = await import("@/lib/serverQuotaHold");
    if (isServerQuotaHoldActive()) skipExistingUrlRecompress = true;
  } catch {
    /* ignore */
  }
  // Existing HTTPS: Storage download/recompress quota pe 4–5 min chipak jata hai, file size wahi rehti.
  // Local-first / quota: sirf naye oversized File jobs; toast mat dikhao.
  if (skipExistingUrlRecompress && !hasOversizedImageFile) return items;

  const passthrough = new Map<number, File | string>();
  const jobs: SaveCompressJob[] = [];

  items.forEach((item, index) => {
    if (item instanceof File) {
      if (isImageFile(item) && item.size > maxBytes) {
        jobs.push({ index, kind: "file", file: item });
      } else {
        passthrough.set(index, item);
      }
      return;
    }
    const url = String(item || "").trim();
    if (!url || !looksLikeImageAttachmentUrl(url)) {
      passthrough.set(index, item);
      return;
    }
    // Local-first save path: do NOT download every existing image URL (Storage https / local: blob) just to
    // check its size - that cost ~2 s per save (and hangs on Storage quota). New files are compressed at
    // add-time; existing refs are kept as-is.
    if (skipExistingUrlRecompress) passthrough.set(index, item);
  });

  const urlIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      if (passthrough.has(index)) return false;
      return typeof item === "string" && looksLikeImageAttachmentUrl(String(item || "").trim());
    });

  const {
    setAttachmentCompressionProgress,
    finishAttachmentCompressionProgress,
    createParallelAttachmentCompressionReporter,
    beginAttachmentCompressionAbortScope,
    endAttachmentCompressionAbortScope,
    throwIfAttachmentCompressionAborted,
    isAttachmentCompressionCancelledError,
    showAttachmentCompressionCancelledToast,
    dismissAttachmentCompressionProgressToast,
  } = await import("@/lib/attachmentCompressionUi");
  const signal = beginAttachmentCompressionAbortScope();
  let compressionCancelled = false;

  try {
    await Promise.all(
      urlIndexes.map(async ({ item, index }) => {
        const url = String(item || "").trim();
        try {
          throwIfAttachmentCompressionAborted(signal);
          const blob = await loadAttachmentBlob(url, { companyId: opts?.companyId, signal });
          if (!blob || blob.size <= maxBytes) {
            passthrough.set(index, url);
            return;
          }
          const kind = await sniffBlobKindForPreview(blob);
          if (kind !== "image") {
            passthrough.set(index, url);
            return;
          }
          const type = (blob.type || "image/jpeg").toLowerCase().startsWith("image/")
            ? blob.type || "image/jpeg"
            : "image/jpeg";
          jobs.push({
            index,
            kind: "url",
            url,
            blob,
            srcFile: new File([blob], fileNameForCompressedImage(url, type), { type }),
          });
        } catch (e) {
          if (isAttachmentCompressionCancelledError(e)) throw e;
          passthrough.set(index, url);
        }
      })
    );

    if (jobs.length === 0) return items;

    const reportJob = createParallelAttachmentCompressionReporter(jobs.length, opts?.silent);
    if (!opts?.silent) setAttachmentCompressionProgress(1);

    const results = new Map<number, File | string>(passthrough);

    await Promise.all(
      jobs.map(async (job, jobIdx) => {
        throwIfAttachmentCompressionAborted(signal);
        reportJob(jobIdx, 0);
        const srcFile = job.kind === "file" ? job.file : job.srcFile;
        const beforeBytes = job.kind === "file" ? job.file.size : job.blob.size;
        const compressed = await compressVoucherAttachment(srcFile, maxBytes, {
          minKB: band.minKb,
          onProgress: opts?.silent ? undefined : (pct) => reportJob(jobIdx, pct),
          signal,
        });
        reportJob(jobIdx, 100);

        if (job.kind === "file") {
          results.set(job.index, compressed.size < beforeBytes ? compressed : job.file);
          return;
        }

        if (compressed.size < beforeBytes) {
          throwIfAttachmentCompressionAborted(signal);
          const next = await propagateReusedHttpsRecompressOrReturnFile({
            companyId: opts?.companyId,
            fromUrl: job.url,
            compressed,
            silent: opts?.silent,
          });
          // Upload failed / per-voucher re-upload: remember which HTTPS URL this File replaces.
          if (next instanceof Blob) markRecompressReplacementSourceUrl(next, job.url);
          results.set(job.index, next);
        } else {
          results.set(job.index, job.url);
        }
      })
    );

    return items.map((item, index) => results.get(index) ?? item);
  } catch (e) {
    if (isAttachmentCompressionCancelledError(e)) {
      compressionCancelled = true;
      dismissAttachmentCompressionProgressToast();
      showAttachmentCompressionCancelledToast();
    }
    throw e;
  } finally {
    endAttachmentCompressionAbortScope();
    if (compressionCancelled) {
      dismissAttachmentCompressionProgressToast();
    } else if (!opts?.silent) {
      setAttachmentCompressionProgress(100);
      finishAttachmentCompressionProgress();
    }
  }
}

/** PDF→JPEG (optional) then oversized-image recompress — voucher / master shared save entry. */
export async function prepareVoucherAttachmentsForSave(
  items: (File | string)[],
  opts?: {
    companyId?: string | null;
    savePdfAsImage?: boolean;
    lockPdfAsPdf?: boolean;
    lockedPdfFileUrls?: readonly string[];
  }
): Promise<(File | string)[]> {
  let pdfToastId: string | number | undefined;
  try {
    const { readLockPdfAsPdfPreference } = await import("@/lib/attachmentPdfOptions");
    const lockPdfAsPdf = opts?.lockPdfAsPdf ?? readLockPdfAsPdfPreference(false);
    const lockedPdfFileUrls = opts?.lockedPdfFileUrls;
    const savePdfAsImage = !!opts?.savePdfAsImage && !lockPdfAsPdf;

    let out = items;
    if (savePdfAsImage && shouldSuggestPdfAsImage(items)) {
      pdfToastId = sonnerToast.loading("Converting PDF attachments to image…");
      out = await convertPdfAttachmentsToJpegIfEnabled(out, true, {
        companyId: opts?.companyId,
        lockPdfAsPdf,
        lockedPdfFileUrls,
      });
      sonnerToast.dismiss(pdfToastId);
      pdfToastId = undefined;
    } else if (savePdfAsImage) {
      out = await convertPdfAttachmentsToJpegIfEnabled(out, true, {
        companyId: opts?.companyId,
        lockPdfAsPdf,
        lockedPdfFileUrls,
      });
    }
    return await recompressOversizedImageAttachmentsOnSave(out, { companyId: opts?.companyId });
  } finally {
    if (pdfToastId != null) sonnerToast.dismiss(pdfToastId);
  }
}

/** Master edit Save: PDF toggle (pref) + oversized image recompress for doc slots. */
export async function prepareMasterDocumentSlotsForSave(
  slots: (File | string)[],
  opts?: {
    companyId?: string | null;
    savePdfAsImage?: boolean;
    lockPdfAsPdf?: boolean;
    lockedPdfFileUrls?: readonly string[];
  }
): Promise<(File | string)[]> {
  const { readMasterSavePdfAsImagePreference, readLockPdfAsPdfPreference } = await import(
    "@/lib/attachmentPdfOptions"
  );
  return prepareVoucherAttachmentsForSave(slots, {
    companyId: opts?.companyId,
    savePdfAsImage: opts?.savePdfAsImage ?? readMasterSavePdfAsImagePreference(false),
    lockPdfAsPdf: opts?.lockPdfAsPdf ?? readLockPdfAsPdfPreference(false),
    lockedPdfFileUrls: opts?.lockedPdfFileUrls,
  });
}

/** Party/staff/bank/tax/expense edit — avatar + docs in one Prepare step. */
export async function prepareMasterEditAttachmentsForSave(params: {
  companyId?: string | null;
  avatar: File | string | null;
  documents: (File | string)[];
}): Promise<{
  avatar: File | string | null;
  newDocFiles: File[];
  keptDocUrls: string[];
}> {
  const docs = await prepareMasterDocumentSlotsForSave(params.documents, {
    companyId: params.companyId,
  });
  let avatar = params.avatar;
  if (avatar != null) {
    const [next] = await recompressOversizedImageAttachmentsOnSave([avatar], {
      companyId: params.companyId,
      silent: true,
    });
    avatar = next ?? null;
  }
  return {
    avatar,
    newDocFiles: docs.filter((x): x is File => x instanceof File),
    keptDocUrls: docs.filter((x): x is string => typeof x === "string"),
  };
}


