"use client";

import { fetchPbAttachmentBlob, isPbAttachmentRef } from "@/lib/pocketbaseData/pbAttachments";
import { shouldUseInAppPdfPreviewOverlay } from "@/lib/shouldUseInAppPdfPreview";
import { showInAppPdfPreview } from "@/lib/inAppPdfPreview";
import { normalizeAttachmentUrlForDevicePreview } from "@/lib/attachmentHoldClipboard";
import {
  openHttpPdfInExternalBrowser,
  openLocalFileUriInExternalViewer,
  openPdfBlobInExternalViewer,
  shouldOpenPdfInExternalViewer,
} from "@/lib/openPdfExternal";
import { showInAppImagePreview } from "@/lib/inAppImagePreview";
import { openAttachmentGalleryInApp } from "@/lib/inAppAttachmentGallery";
import { showAppAlert, showAppConfirm } from "@/lib/appAlertDialog";
import { tryGetBlobFromFirebaseStorageDownloadUrl } from "@/lib/storageGetBlobFromDownloadUrl";
import {
  looksLikeFirebaseStorageObjectPath,
  normalizeFirebaseStorageObjectPathForSdk,
} from "@/lib/firebaseStorageDownloadUrl";
import { isOfflineCacheableAttachmentRef } from "@/lib/attachmentRefBlobFetch";
import {
  getOfflineCachedAttachmentNativeRef,
  getRemoteAttachmentBlobPreferOfflineCache,
  tryOfflineCachedAttachmentBlobMultiKey,
} from "@/lib/offlineAttachmentUrlCache";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import {
  isLocalFileRef,
  getBlobFromLocalFileRef,
  getLocalFileRefMeta,
  getLocalFileRefMetaSync,
} from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import { tryResolveRemoteUrlForStaleLocalAttachment } from "@/lib/resolveVoucherAttachmentRemoteUrl";
import { tryResolveInterCompanyPeerAttachmentUrl } from "@/lib/interCompany/interCompanyAttachmentPeerResolve";
import { resolveStaticAttachmentDisplay } from "@/lib/staticAttachmentDisplayUrl";
import { sniffBlobKindForPreview } from "@/lib/attachmentFormatLabel";
// STRICT (parked) open forcePdfKind: also import getAttachmentFormatLabel

/** UI se pata ho to sniffing kam: pdf / image / unknown */
export type AttachmentKindHint = "pdf" | "image" | "other";

/** Multi-file: same set me se ek open — gallery arrows / swipe */
export type OpenAttachmentGalleryOpts = {
  urls: readonly string[];
  startIndex: number;
  kinds?: readonly AttachmentKindHint[];
};

/** Jab device IndexedDB se `local:` blob gayab ho lekin voucher Firestore / mirror pe HTTPS URL ho */
export type OpenAttachmentServerFallback = {
  companyId: string;
  voucherId: string;
  clientFileUrls?: readonly string[] | null;
  interCompanyPeer?: {
    peerCompanyId: string;
    peerVoucherId: string;
  };
};

function pathLooksImage(pathLower: string): boolean {
  return /\.(jpe?g|jfif|png|gif|webp|bmp|svg|heic|heif)$/.test(pathLower);
}

function pathLooksPdf(pathLower: string): boolean {
  if (pathLower.endsWith(".pdf")) return true;
  /** Firebase `...%2Fname.pdf` — encoded slash ke saath bhi .pdf check */
  if (pathLower.includes(".pdf")) return true;
  try {
    const dec = decodeURIComponent(pathLower);
    return dec.endsWith(".pdf") || /\.pdf(\?|$)/i.test(dec);
  } catch {
    return false;
  }
}

/** Click-open cache path: HTTPS + Firebase path + `local:`/`drive:` (embedded preload cache). */
function isRemoteCacheableAttachmentSource(value: string): boolean {
  return isOfflineCacheableAttachmentRef(value);
}

function showInAppPdfOpenError(sourceUrl: string): void {
  // Native/static flow: show clear English error and optional external-app open fallback (in-app dialog, no browser popup).
  if (typeof window === "undefined") return;
  void showAppConfirm("PDF preview could not be loaded. Please check internet/CORS and try again.\n\nOpen in other app?", {
    title: "PDF preview",
    confirmLabel: "Open in other app",
    cancelLabel: "Close",
  })
    .then((shouldOpenExternally) => {
      if (shouldOpenExternally) window.open(sourceUrl, "_blank", "noopener,noreferrer");
    })
    .catch(() => {
      /* dialog unavailable: nothing to open */
    });
}

async function openInMemoryUrlAttachment(
  url: string,
  opts?: { title?: string; kind?: AttachmentKindHint }
): Promise<boolean> {
  const u = String(url || "").trim();
  if (!u.startsWith("blob:") && !u.startsWith("data:")) return false;
  try {
    const blob = await fetch(u).then((r) => r.blob());
    if (!blob || blob.size <= 0) return false;
    /** PDF label + JPEG bytes (Lock/save-as-image) → Height-fit image preview, native PDF viewer mat. */
    if (opts?.kind === "pdf") {
      const mime = (blob.type || "").toLowerCase();
      if (mime.startsWith("image/")) {
        return await openPdfBlobAsImagePreview(blob, opts?.title ?? "PDF");
      }
    }
    await openBlobAttachmentInApp(blob, opts);
    return true;
  } catch {
    return false;
  }
}

async function resolveOpenAttachmentKind(blob: Blob, hint: AttachmentKindHint): Promise<AttachmentKindHint> {
  const mime = (blob.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || mime.includes("pdf")) return "pdf";
  const sniffed = await sniffBlobKindForPreview(blob);
  if (sniffed === "image" || sniffed === "pdf") return sniffed;
  return hint;
}

async function openBlobAttachmentInApp(
  blob: Blob,
  opts?: {
    title?: string;
    kind?: AttachmentKindHint;
  }
): Promise<void> {
  // Server bytes arrive as octet-stream / no type far more often than not. Re-type from the magic
  // bytes first, otherwise `resolveOpenAttachmentKind` classifies a JPEG as "other" and the
  // full-screen viewer opens it outside the app (blank/black on APK).
  const typedBlob = await (await import("@/lib/imageBlobMimeSniff")).withUsableImageMime(blob);
  const kind = await resolveOpenAttachmentKind(typedBlob, opts?.kind ?? "other");
  const bUrl = URL.createObjectURL(typedBlob);
  const dispose = () => {
    try {
      URL.revokeObjectURL(bUrl);
    } catch {
      /* ignore */
    }
  };
  if (kind === "image") {
    showInAppImagePreview(bUrl, dispose, { title: opts?.title ?? "Image" });
    return;
  }
  if (kind === "pdf") {
    if (shouldUseInAppPdfPreviewOverlay()) {
      // Real PDF viewer (page scroll, zoom, print) is the default: an attachment that IS a PDF
      // should open as a PDF. Rasterising the first page first made every PDF look like a picture
      // with no way to reach page 2+, search, or zoom into text.
      await showInAppPdfPreview(bUrl, dispose, {
        title: opts?.title ?? "PDF",
        fileName: "document.pdf",
      });
      return;
    }
    dispose();
    await openPdfBlobInExternalViewer(typedBlob, opts?.title ? `${opts.title}.pdf` : "document.pdf");
    return;
  }
  dispose();
  window.open(bUrl, "_blank", "noopener,noreferrer");
}

async function openPdfBlobAsImagePreview(blob: Blob, title: string): Promise<boolean> {
  try {
    const mime = (blob.type || "").toLowerCase();
    let isImage = mime.startsWith("image/");
    if (!isImage && mime !== "application/pdf" && !mime.includes("pdf")) {
      const sniffed = await sniffBlobKindForPreview(blob);
      isImage = sniffed === "image";
    }
    /** Voucher "PDF" jo as JPEG store hai — party jaisa Browser/Width/Height preview. */
    if (isImage) {
      const url = URL.createObjectURL(blob);
      showInAppImagePreview(url, () => URL.revokeObjectURL(url), { title });
      return true;
    }
    // Real PDF bytes: not an image, let the caller use the PDF viewer.
    return false;
  } catch {
    return false;
  }
}


async function tryOpenPlServerLocalAttachment(
  companyId: string,
  localUrl: string,
  opts?: { title?: string; kind?: AttachmentKindHint }
): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid || !isLocalFileRef(localUrl)) return false;
  const { fetchPlServerAttachmentBlob } = await import("@/lib/plServerAttachmentFetch");
  const remoteBlob = await fetchPlServerAttachmentBlob(cid, localUrl);
  if (!remoteBlob || remoteBlob.size <= 0) return false;
  await openBlobAttachmentInApp(remoteBlob, opts);
  return true;
}

/**
 * Files tick OFF: open only if bytes already on device — no HTTPS / Storage / Drive download.
 */
async function tryOpenAttachmentFromDeviceCacheOnly(
  url: string,
  opts?: { title?: string; kind?: AttachmentKindHint; companyId?: string }
): Promise<boolean> {
  const u = String(url || "").trim();
  if (!u) return false;

  if (await openInMemoryUrlAttachment(u, { title: opts?.title, kind: opts?.kind })) {
    return true;
  }

  const cid = String(opts?.companyId || "").trim();

  if (isLocalFileRef(u)) {
    if (usesEmbeddedNativeAttachmentStorage()) {
      const meta = getLocalFileRefMetaSync(u) ?? (await getLocalFileRefMeta(u));
      const ct = String(meta?.contentType || "").toLowerCase();
      const kindHint = opts?.kind ?? "other";
      const isPdf = kindHint === "pdf" || ct.includes("pdf");
      const isImg = kindHint === "image" || ct.startsWith("image/");
      if (isImg && meta?.displayUrl && !isPdf) {
        showInAppImagePreview(meta.displayUrl, () => {}, { title: opts?.title ?? "Image" });
        return true;
      }
    }
    const blob = await getBlobFromLocalFileRef(u, cid ? { companyId: cid } : undefined);
    if (blob && blob.size > 0) {
      await openBlobAttachmentInApp(blob, { title: opts?.title, kind: opts?.kind });
      return true;
    }
    return false;
  }

  // HTTPS / Storage path / drive: — IndexedDB / native disk / hover LRU only (no network).
  // Cell-thumb mat pehle — blurry open; full LRU → disk cache → phir cell-thumb last resort.
  try {
    const { peekHoverCachedBlobUrl } = await import("@/lib/attachmentHoverBlobCache");
    const fullCached = peekHoverCachedBlobUrl(u);
    if (fullCached && (await openInMemoryUrlAttachment(fullCached, { title: opts?.title, kind: opts?.kind }))) {
      return true;
    }
  } catch {
    /* ignore */
  }

  const cached =
    (await tryOfflineCachedAttachmentBlobMultiKey(u)) ||
    (await getRemoteAttachmentBlobPreferOfflineCache(u, undefined, {
      companyId: cid || undefined,
      localOnly: true,
      galleryUrls: undefined,
    }));
  if (cached && cached.size > 0) {
    await openBlobAttachmentInApp(cached, { title: opts?.title, kind: opts?.kind });
    return true;
  }

  try {
    const { getBlobFromAttachmentRefPreferLocalFirst } = await import("@/lib/attachmentPreviewResolve");
    const localBlob = await getBlobFromAttachmentRefPreferLocalFirst(u, {
      companyId: cid || undefined,
      localLedgerOnly: true,
    });
    if (localBlob && localBlob.size > 0) {
      await openBlobAttachmentInApp(localBlob, { title: opts?.title, kind: opts?.kind });
      return true;
    }
  } catch {
    /* ignore */
  }

  /** PDF: thumb JPEG se open mat — galat zoom; sirf poora PDF bytes (upar wale steps). */
  if (opts?.kind !== "pdf") {
    try {
      const { peekHoverCachedBlobUrl } = await import("@/lib/attachmentHoverBlobCache");
      // FilePreview PDF thumbs use `::cell-thumb-v2`; ledger cells use `::cell-thumb`.
      for (const thumbKey of [`${u}::cell-thumb-v2`, `${u}::cell-thumb`, `${u}::pdf-portal`]) {
        const cellThumb = peekHoverCachedBlobUrl(thumbKey);
        if (cellThumb && (await openInMemoryUrlAttachment(cellThumb, { title: opts?.title, kind: opts?.kind }))) {
          return true;
        }
        const persistedThumb = await tryOfflineCachedAttachmentBlobMultiKey(thumbKey);
        if (persistedThumb && persistedThumb.size > 0) {
          await openBlobAttachmentInApp(persistedThumb, { title: opts?.title, kind: opts?.kind });
          return true;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const native = await getOfflineCachedAttachmentNativeRef(u);
  if (native?.fileUri && isCapacitorNativeApp()) {
    await openLocalFileUriInExternalViewer(
      native.fileUri,
      native.contentType || "application/octet-stream",
      opts?.title ?? "File"
    );
    return true;
  }

  return false;
}

/**
 * File PDF ya image: overlay / gallery; HTTP URL par fetch + blob (CORS allow ho to) — web par bhi bahar tab kam.
 */
export async function openAttachmentInApp(
  url: string,
  opts?: {
    title?: string;
    kind?: AttachmentKindHint;
    gallery?: OpenAttachmentGalleryOpts;
    serverFallback?: OpenAttachmentServerFallback;
    /** Local / server-gate company: HTTPS mat — pehle SQLite+disk cache, phir download. */
    localLedgerOnly?: boolean;
    /**
     * Online company row (Company Selector). When set, Files tick OFF → open/load blocked.
     * Prefer passing this from UI that has `useCompany()`.
     */
    gateCompany?: { id?: string; storageOption?: string | null; syncPolicy?: string | null; syncedFromCloud?: boolean; authoritativeCompanyId?: string } | null;
  }
): Promise<void> {
  // PL_ATTACH_V1: clipboard marker aa gaya to underlying src (local:/https) decode karo —
  // warna isLocalFileRef check miss karta tha aur error dialog dikhta tha.
  const u = normalizeAttachmentUrlForDevicePreview(String(url || "").trim());
  if (!u) return;

  // Pocket Ledger Server (PocketBase) link: open the server bytes with the same in-app viewers.
  if (isPbAttachmentRef(u)) {
    const blob = await fetchPbAttachmentBlob(u);
    if (blob) {
      await openBlobAttachmentInApp(blob, { title: opts?.title, kind: opts?.kind });
    } else {
      const { showAppAlert } = await import("@/lib/appAlertDialog");
      showAppAlert("This attachment could not be loaded from Pocket Ledger Server. Check the connection and try again.", "Attachment");
    }
    return;
  }

  // STRICT (parked): PDF URL / label → hamesha PDF open path (portal JPEG raster se kind:image skip).
  // const pathOnlyForKind = u.split("?")[0].split("#")[0].toLowerCase();
  // const forcePdfKind =
  //   getAttachmentFormatLabel(u) === "PDF" ||
  //   pathLooksPdf(pathOnlyForKind) ||
  //   u.toLowerCase().startsWith("data:application/pdf");
  // if (forcePdfKind && opts?.kind !== "pdf") {
  //   opts = { ...opts, kind: "pdf" };
  // }

  /**
   * Files tick OFF (Online): no network download.
   * Already on device (`local:` / IndexedDB / native cache / hover blob) → open anyway.
   */
  let attachmentNetworkBlocked = false;
  const gateCid = String(
    opts?.gateCompany?.id || opts?.serverFallback?.companyId || ""
  ).trim();
  if (gateCid) {
    const { isOnlineCompanyAttachmentNetworkAllowed } = await import(
      "@/lib/onlineCompanySelectorSyncPolicy"
    );
    if (
      !isOnlineCompanyAttachmentNetworkAllowed(
        gateCid,
        (opts?.gateCompany as never) ?? null
      )
    ) {
      attachmentNetworkBlocked = true;
    }
  }

  if (attachmentNetworkBlocked) {
    const opened = await tryOpenAttachmentFromDeviceCacheOnly(u, {
      title: opts?.title,
      kind: opts?.kind,
      companyId: gateCid || undefined,
    });
    if (!opened && typeof window !== "undefined") {
      showAppAlert(
        "This file is not on this device. Turn on Files in Company Selector (Online tab), then Save — to download. Already downloaded files still open.",
        "File not on this device"
      );
    }
    return;
  }

  const openFetchCompanyId =
    gateCid || String(opts?.serverFallback?.companyId || "").trim() || undefined;
  if (openFetchCompanyId) {
    const { grantExplicitAttachmentNetworkFetch } = await import("@/lib/attachmentNetworkGate");
    grantExplicitAttachmentNetworkFetch(u, openFetchCompanyId);
  }
  const explicitOpenFetch = {
    companyId: openFetchCompanyId,
    explicitUserRequest: true as const,
  };

  if (await openInMemoryUrlAttachment(u, { title: opts?.title, kind: opts?.kind })) {
    return;
  }

  const g = opts?.gallery;
  if (g) {
    const normalized = g.urls.map((x) => String(x).trim()).filter((s) => s.length > 0);
    if (normalized.length > 1) {
      const i = Math.max(0, Math.min(g.startIndex, normalized.length - 1));
      const galleryMode = opts?.serverFallback?.companyId && opts?.localLedgerOnly ? "server" : opts?.localLedgerOnly ? "local" : "online";
      openAttachmentGalleryInApp(normalized, i, {
        title: opts?.title,
        kinds: g.kinds,
        localLedgerOnly: opts?.localLedgerOnly,
        companyId: opts?.serverFallback?.companyId,
        companyMode: galleryMode,
      });
      return;
    }
  }

  // Drive cloud sync ref — offline preload cache pehle, phir pending/local match, phir Drive API.
  if (isDriveFileRef(u)) {
    const blob =
      (await getRemoteAttachmentBlobPreferOfflineCache(u, undefined, { galleryUrls: g?.urls })) ||
      (await getBlobFromLocalFileRef(u));
    if (!blob) {
      if (typeof window !== "undefined") {
        showAppAlert(
          "Could not download this attachment from Google Drive. Check internet and Drive connection.",
          "Download failed"
        );
      }
      return;
    }
    const bUrl = URL.createObjectURL(blob);
    try {
      const ct = blob.type.toLowerCase();
      const isPdf = opts?.kind === "pdf" || ct.includes("pdf");
      const isImg = opts?.kind === "image" || ct.startsWith("image/");
      if (isImg) {
        showInAppImagePreview(bUrl, () => URL.revokeObjectURL(bUrl), { title: opts?.title ?? "Image" });
        return;
      }
      if (isPdf && shouldUseInAppPdfPreviewOverlay()) {
        showInAppPdfPreview(bUrl, () => URL.revokeObjectURL(bUrl), { title: opts?.title ?? "PDF" });
        return;
      }
      if (isPdf) {
        await openPdfBlobInExternalViewer(blob, opts?.title ?? "PDF");
        URL.revokeObjectURL(bUrl);
        return;
      }
      window.open(bUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(bUrl), 60_000);
    } catch (e) {
      URL.revokeObjectURL(bUrl);
      throw e;
    }
    return;
  }

  // Local-first: blob IndexedDB me — SQLite/Firestore me sirf `local:uuid` string
  if (isLocalFileRef(u)) {
    const kindHint = opts?.kind ?? "other";
    const sf = opts?.serverFallback;
    const sfCompanyId = String(sf?.companyId || "").trim();

    // Hover LRU full pehle; cell-thumb mat — warna blurry open + full bytes skip.
    try {
      const { peekHoverCachedBlobUrl } = await import("@/lib/attachmentHoverBlobCache");
      const fullCached = peekHoverCachedBlobUrl(u);
      if (fullCached && (await openInMemoryUrlAttachment(fullCached, { title: opts?.title, kind: kindHint }))) {
        return;
      }
    } catch {
      /* ignore */
    }

    try {
      const cached = await tryOfflineCachedAttachmentBlobMultiKey(u);
      if (cached && cached.size > 0) {
        await openBlobAttachmentInApp(cached, { title: opts?.title, kind: kindHint });
        return;
      }
    } catch {
      /* ignore */
    }

    // Native/APK: image thumb fast-path; PDF/other hamesha bytes se (displayUrl revoke / fetch race avoid).
    if (usesEmbeddedNativeAttachmentStorage()) {
      const meta = getLocalFileRefMetaSync(u) ?? (await getLocalFileRefMeta(u));
      const ct = String(meta?.contentType || "").toLowerCase();
      const isPdf = kindHint === "pdf" || ct.includes("pdf");
      const isImg = kindHint === "image" || ct.startsWith("image/");
      if (isImg && meta?.displayUrl && !isPdf) {
        showInAppImagePreview(meta.displayUrl, () => {}, { title: opts?.title ?? "Image" });
        return;
      }
      if (meta?.fileUri && isCapacitorNativeApp() && !isPdf) {
        if (isImg && meta.displayUrl) {
          showInAppImagePreview(meta.displayUrl, () => {}, { title: opts?.title ?? "Image" });
          return;
        }
        await openLocalFileUriInExternalViewer(
          meta.fileUri,
          meta.contentType || "application/octet-stream",
          opts?.title ?? "File"
        );
        return;
      }
    }
    let blob = await getBlobFromLocalFileRef(u, sfCompanyId ? { companyId: sfCompanyId } : undefined);
    if (!blob?.size && sfCompanyId) {
      if (await tryOpenPlServerLocalAttachment(sfCompanyId, u, { title: opts?.title, kind: kindHint })) {
        return;
      }
    }
    if (!blob?.size) {
      const { readActiveAttachmentCompanyId } = await import("@/lib/firestorePermissionSuppress");
      const activeCid = String(readActiveAttachmentCompanyId() || "").trim();
      if (activeCid && activeCid !== sfCompanyId) {
        if (await tryOpenPlServerLocalAttachment(activeCid, u, { title: opts?.title, kind: kindHint })) {
          return;
        }
      }
    }
    if (!blob?.size && sfCompanyId) {
      const { resolvePlServerStaffAttachmentPreviewBlob } = await import("@/lib/plServerAttachmentFetch");
      blob = await resolvePlServerStaffAttachmentPreviewBlob(u, { companyId: sfCompanyId });
    }
    if (!blob?.size) {
      if (sf?.companyId && sf?.voucherId) {
        const remote = await tryResolveRemoteUrlForStaleLocalAttachment(
          sf.companyId,
          sf.voucherId,
          u,
          sf.clientFileUrls
        );
        if (remote && !isLocalFileRef(remote)) {
          await openAttachmentInApp(remote, {
            title: opts?.title,
            kind: opts?.kind,
            gallery: opts?.gallery,
          });
          return;
        }
        if (sf.interCompanyPeer) {
          const peerUrl = await tryResolveInterCompanyPeerAttachmentUrl({
            staleUrl: u,
            clientFileUrls: sf.clientFileUrls,
            peerCompanyId: sf.interCompanyPeer.peerCompanyId,
            peerVoucherId: sf.interCompanyPeer.peerVoucherId,
          });
          if (peerUrl && peerUrl !== u) {
            await openAttachmentInApp(peerUrl, {
              title: opts?.title,
              kind: opts?.kind,
              gallery: opts?.gallery,
            });
            return;
          }
        }
      }
      console.warn("[openAttachmentInApp] local attachment bytes not found", u);
      if (typeof window !== "undefined") {
        showAppAlert(
          "Attachment file not found on this device (cache may have been cleared). " +
            "Could not load a copy from the server — check internet or re-upload the file if the voucher still shows an old local link.",
          "File not found"
        );
      }
      return;
    }
    await openBlobAttachmentInApp(blob, { title: opts?.title, kind: kindHint });
    return;
  }

  const sfCompanyId = opts?.serverFallback?.companyId;
  const normalizedStoragePath = normalizeFirebaseStorageObjectPathForSdk(u, { companyId: sfCompanyId });
  if (looksLikeFirebaseStorageObjectPath(normalizedStoragePath, { companyId: sfCompanyId })) {
    const blob =
      (await tryOfflineCachedAttachmentBlobMultiKey(normalizedStoragePath)) ||
      (await getRemoteAttachmentBlobPreferOfflineCache(normalizedStoragePath, undefined, {
        galleryUrls: g?.urls,
        ...explicitOpenFetch,
      }));
    if (blob && blob.size > 0) {
      const bUrl = URL.createObjectURL(blob);
      const dispose = () => {
        try {
          URL.revokeObjectURL(bUrl);
        } catch {
          /* ignore */
        }
      };
      const mime = (blob.type || "").toLowerCase();
      const kindHint = opts?.kind ?? "other";
      if (kindHint === "image" || mime.startsWith("image/")) {
        showInAppImagePreview(bUrl, dispose, { title: opts?.title ?? "Image" });
        return;
      }
      if (kindHint === "pdf" || mime.includes("pdf")) {
        if (shouldUseInAppPdfPreviewOverlay()) {
          // Real PDF viewer by default — see openBlobAttachmentInApp for the rationale.
          await showInAppPdfPreview(bUrl, dispose, { title: opts?.title ?? "PDF" });
          return;
        }
        dispose();
        await openPdfBlobInExternalViewer(blob, opts?.title ?? "PDF");
        return;
      }
      window.open(bUrl, "_blank", "noopener,noreferrer");
      setTimeout(dispose, 60_000);
      return;
    }
  }

  if (!shouldUseInAppPdfPreviewOverlay()) {
    window.open(u, "_blank", "noopener,noreferrer");
    return;
  }

  const kind = opts?.kind ?? "other";
  const localLedgerOnly = opts?.localLedgerOnly === true;
  const pathOnly = u.split("?")[0].split("#")[0].toLowerCase();
  const isDataImage = u.startsWith("data:image/");
  const isDataPdf = u.startsWith("data:application/pdf") || u.toLowerCase().startsWith("data:application%2fpdf");
  const isHttp = /^https?:\/\//i.test(u);
  const online = typeof navigator !== "undefined" && navigator.onLine;
  const embeddedInstantHttps =
    usesEmbeddedNativeAttachmentStorage() && isHttp && online && !localLedgerOnly;
  const strategyMode = localLedgerOnly
    ? opts?.serverFallback?.companyId
      ? "server"
      : "local"
    : "online";

  if (embeddedInstantHttps) {
    if (kind === "image" || isDataImage || pathLooksImage(pathOnly)) {
      // A Firebase signed URL paints in a desktop tab but stays blank in the Capacitor WebView
      // (sandboxed storage / offline). Resolve the bytes first and open the object URL, with the
      // raw URL only as a last resort.
      void (async () => {
        try {
          const { fetchAttachmentRefBlob } = await import("@/lib/attachmentRefBlobFetch");
          const { withUsableImageMime } = await import("@/lib/imageBlobMimeSniff");
          const raw = await fetchAttachmentRefBlob(u);
          if (raw && raw.size > 0) {
            // Server bytes often arrive as octet-stream; a blob: URL with no image MIME paints
            // nothing in the WebView (black full-screen preview).
            const blob = await withUsableImageMime(raw);
            const src = URL.createObjectURL(blob);
            showInAppImagePreview(src, () => URL.revokeObjectURL(src), { title: opts?.title ?? "Image" });
            return;
          }
        } catch {
          /* fall through to the direct URL */
        }
        showInAppImagePreview(u, () => {}, { title: opts?.title ?? "Image" });
      })();
      void getRemoteAttachmentBlobPreferOfflineCache(u, undefined, {
        awaitDiskWrite: false,
        ...explicitOpenFetch,
      });
      return;
    }
    if (kind === "pdf" || isDataPdf || pathLooksPdf(pathOnly)) {
      if (shouldUseInAppPdfPreviewOverlay()) {
        void showInAppPdfPreview(u, () => {}, {
          title: opts?.title ?? "PDF",
          fileName: "document.pdf",
        });
        void getRemoteAttachmentBlobPreferOfflineCache(u, undefined, {
          awaitDiskWrite: false,
          ...explicitOpenFetch,
        });
        return;
      }
      await openHttpPdfInExternalBrowser(u);
      void getRemoteAttachmentBlobPreferOfflineCache(u, undefined, {
        awaitDiskWrite: false,
        ...explicitOpenFetch,
      });
      return;
    }
  }

  if (kind === "image" || isDataImage || pathLooksImage(pathOnly)) {
    if (!isDataImage && (usesEmbeddedNativeAttachmentStorage() || localLedgerOnly)) {
      const resolved = await resolveStaticAttachmentDisplay(u, {
        localLedgerOnly,
        companyMode: strategyMode,
        companyId: opts?.serverFallback?.companyId,
      });
      if (resolved.displayUrl) {
        showInAppImagePreview(resolved.displayUrl, () => {}, {
          title: opts?.title ?? "Image",
        });
        return;
      }
      if (resolved.blob && resolved.blob.size > 0) {
        const bUrl = URL.createObjectURL(resolved.blob);
        showInAppImagePreview(bUrl, () => URL.revokeObjectURL(bUrl), {
          title: opts?.title ?? "Image",
        });
        return;
      }
      if (localLedgerOnly) {
        const cid = opts?.serverFallback?.companyId;
        if (cid && isLocalFileRef(u) && (await tryOpenPlServerLocalAttachment(cid, u, opts))) {
          return;
        }
        showInAppPdfOpenError(u);
        return;
      }
    }
    // Web browser: pehle local warm cache (IndexedDB), phir gated network.
    if (!isDataImage && isRemoteCacheableAttachmentSource(u)) {
      try {
        const cached =
          (await tryOfflineCachedAttachmentBlobMultiKey(u)) ||
          (await getRemoteAttachmentBlobPreferOfflineCache(u, undefined, explicitOpenFetch));
        if (cached && cached.size > 0) {
          const bUrl = URL.createObjectURL(cached);
          showInAppImagePreview(bUrl, () => URL.revokeObjectURL(bUrl), { title: opts?.title ?? "Image" });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    if (usesEmbeddedNativeAttachmentStorage() && isHttp && online) {
      showInAppImagePreview(u, () => {}, { title: opts?.title ?? "Image" });
      void getRemoteAttachmentBlobPreferOfflineCache(u, undefined, {
        awaitDiskWrite: false,
        ...explicitOpenFetch,
      });
      return;
    }
    showInAppPdfOpenError(u);
    return;
  }

  if (kind === "pdf" || isDataPdf || pathLooksPdf(pathOnly)) {
    if (localLedgerOnly || usesEmbeddedNativeAttachmentStorage()) {
      const resolved = await resolveStaticAttachmentDisplay(u, {
        localLedgerOnly,
        companyMode: strategyMode,
        companyId: opts?.serverFallback?.companyId,
      });
      if (resolved.displayUrl) {
        if (shouldUseInAppPdfPreviewOverlay()) {
          await showInAppPdfPreview(resolved.displayUrl, () => {}, {
            title: opts?.title ?? "PDF",
            fileName: "document.pdf",
          });
          return;
        }
        await openHttpPdfInExternalBrowser(resolved.displayUrl);
        return;
      }
      if (resolved.blob && resolved.blob.size > 0) {
        if (shouldOpenPdfInExternalViewer()) {
          await openPdfBlobInExternalViewer(resolved.blob, opts?.title ?? "PDF");
          return;
        }
        const bUrl = URL.createObjectURL(resolved.blob);
        await showInAppPdfPreview(bUrl, () => URL.revokeObjectURL(bUrl), {
          title: opts?.title ?? "PDF",
          fileName: "document.pdf",
        });
        return;
      }
      if (localLedgerOnly) {
        const cid = opts?.serverFallback?.companyId;
        if (cid && isLocalFileRef(u) && (await tryOpenPlServerLocalAttachment(cid, u, opts))) {
          return;
        }
        showInAppPdfOpenError(u);
        return;
      }
    }
    await openPdfFromUrl(u, opts?.title, explicitOpenFetch);
    return;
  }

  try {
    let blob: Blob | null = await tryGetBlobFromFirebaseStorageDownloadUrl(u, undefined, explicitOpenFetch);
    if (!blob) {
      const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
      if (isRemoteAttachmentNetworkFetchAllowed(u, explicitOpenFetch)) {
        const res = await fetch(u, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(String(res.status));
        blob = await res.blob();
      }
    }
    const mime = (blob.type || "").toLowerCase();
    const bUrl = URL.createObjectURL(blob);
    const dispose = () => {
      try {
        URL.revokeObjectURL(bUrl);
      } catch {
        /* ignore */
      }
    };
    if (mime.startsWith("image/")) {
      showInAppImagePreview(bUrl, dispose, { title: opts?.title ?? "Image" });
      return;
    }
    // SDK blob ko empty `type` pani huna sakcha — extension sanga PDF māno
    if (mime === "application/pdf" || mime.includes("pdf") || pathLooksPdf(pathOnly)) {
      if (shouldOpenPdfInExternalViewer()) {
        dispose();
        await openPdfBlobInExternalViewer(blob, opts?.title ? `${opts.title}.pdf` : "document.pdf");
        return;
      }
      showInAppPdfPreview(bUrl, dispose, {
        title: opts?.title ?? "PDF",
        fileName: "document.pdf",
      });
      return;
    }
    dispose();
    window.open(u, "_blank", "noopener,noreferrer");
  } catch {
    if (shouldUseInAppPdfPreviewOverlay()) {
      showInAppPdfOpenError(u);
      return;
    }
    window.open(u, "_blank", "noopener,noreferrer");
  }
}

async function openPdfFromUrl(
  u: string,
  title?: string,
  fetchOpts?: { companyId?: string; explicitUserRequest?: boolean }
): Promise<void> {
  const fileName = title ? `${title.replace(/[/\\?%*:|"<>]/g, "_")}.pdf` : "document.pdf";
  const isHttp = /^https?:\/\//i.test(u);
  const explicitFetch = {
    companyId: fetchOpts?.companyId,
    explicitUserRequest: fetchOpts?.explicitUserRequest ?? true,
  };

  if (isHttp) {
    const online = typeof navigator !== "undefined" && navigator.onLine;
    if (
      online &&
      usesEmbeddedNativeAttachmentStorage() &&
      shouldUseInAppPdfPreviewOverlay()
    ) {
      void showInAppPdfPreview(u, () => {}, { title: title ?? "PDF", fileName: "document.pdf" });
      void getRemoteAttachmentBlobPreferOfflineCache(u, undefined, {
        awaitDiskWrite: false,
        ...explicitFetch,
      });
      return;
    }
    try {
      // Native/exe offline reliability: network se pehle local cache try karo.
      const cachedRef = await getOfflineCachedAttachmentNativeRef(u);
      if (cachedRef?.fileUri && shouldOpenPdfInExternalViewer()) {
        await openLocalFileUriInExternalViewer(
          cachedRef.fileUri,
          cachedRef.contentType || "application/pdf",
          fileName
        );
        return;
      }
      const cachedBlob = await tryOfflineCachedAttachmentBlobMultiKey(u);
      if (cachedBlob && cachedBlob.size > 0) {
        if (shouldOpenPdfInExternalViewer()) {
          await openPdfBlobInExternalViewer(cachedBlob, fileName);
          return;
        }
        const cachedUrl = URL.createObjectURL(cachedBlob);
        showInAppPdfPreview(cachedUrl, () => URL.revokeObjectURL(cachedUrl), {
          title: title ?? "PDF",
          fileName: "document.pdf",
        });
        return;
      }
    } catch {
      /* cache miss / read fail → network path */
    }
  }

  if (shouldOpenPdfInExternalViewer() && isHttp) {
    await openHttpPdfInExternalBrowser(u);
    return;
  }
  if (shouldOpenPdfInExternalViewer() && u.startsWith("data:")) {
    try {
      const res = await fetch(u);
      const blob = await res.blob();
      await openPdfBlobInExternalViewer(blob, fileName);
      return;
    } catch {
      /* fall through to fetch path */
    }
  }

  try {
    let blob: Blob | null =
      (await tryOfflineCachedAttachmentBlobMultiKey(u)) ||
      (await tryGetBlobFromFirebaseStorageDownloadUrl(u, undefined, explicitFetch));
    if (!blob) {
      blob = await getRemoteAttachmentBlobPreferOfflineCache(u, undefined, explicitFetch);
    }
    if (!blob) {
      const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
      if (isRemoteAttachmentNetworkFetchAllowed(u, explicitFetch)) {
        const res = await fetch(u, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(String(res.status));
        blob = await res.blob();
      }
    }
    if (shouldOpenPdfInExternalViewer()) {
      await openPdfBlobInExternalViewer(blob, fileName);
      return;
    }
    const bUrl = URL.createObjectURL(blob);
    showInAppPdfPreview(bUrl, () => URL.revokeObjectURL(bUrl), {
      title: title ?? "PDF",
      fileName: "document.pdf",
    });
    // Background: next offline open ke liye bytes cache me likho.
    if (blob.size > 0 && (isStaticAppBuild() || isElectronDesktopApp())) {
      void getRemoteAttachmentBlobPreferOfflineCache(u).catch(() => undefined);
    }
  } catch {
    if (shouldUseInAppPdfPreviewOverlay()) {
      showInAppPdfOpenError(u);
      return;
    }
    window.open(u, "_blank", "noopener,noreferrer");
  }
}
