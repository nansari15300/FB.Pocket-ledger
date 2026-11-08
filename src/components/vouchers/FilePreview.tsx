"use client";

import { fetchPbAttachmentBlob, isPbAttachmentRef } from "@/lib/pocketbaseData/pbAttachments";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import { resolveCurrentAttachmentUrlAfterLoadError } from "@/lib/attachmentCurrentUrlFallback";
import * as React from "react";
import { useCallback, useEffect, useState, useRef } from "react";
import Image from "next/image";
import { Copy, FileText, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { openAttachmentInApp } from "@/lib/openAttachmentInApp";
import { AttachmentHoverPortal, useTapInteractionMode } from "@/components/vouchers/AttachmentHoverPortal";
import { MultiAttachmentPortalPreview } from "@/components/vouchers/attachmentHoverPreviewBody";
import { storage } from "@/lib/firebase";
import { ref, getBlob, getMetadata } from "@/lib/pocketbaseData/pbStorage";
import {
  getAttachmentFormatLabel,
  getAttachmentFormatLabelFromHints,
  getAttachmentPreviewKindFromHints,
  isNonImageBlobObjectUrl,
  sniffBlobKindForPreview,
} from "@/lib/attachmentFormatLabel";
import {
  looksLikeFirebaseStorageObjectPath,
  normalizeFirebaseStorageObjectPathForSdk,
  tryGetStoragePathFromFirebaseDownloadUrl,
} from "@/lib/firebaseStorageDownloadUrl";
import {
  getOfflineCachedAttachmentBlob,
  getOfflineCachedAttachmentNativeRef,
  getRemoteAttachmentBlobPreferOfflineCache,
  seedOfflineAttachmentCacheFromBlob,
  tryOfflineCachedAttachmentBlobMultiKey,
} from "@/lib/offlineAttachmentUrlCache";
import {
  getBlobFromLocalFileRef,
  getLocalFileRefMeta,
  getLocalFileRefMetaSync,
  getPendingPayloadForLocalRef,
  isLocalFileRef,
  LOCAL_FILE_PREFIX,
} from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { useVoucherAttachmentFallback } from "@/contexts/VoucherAttachmentFallbackContext";
import { tryResolveRemoteUrlForStaleLocalAttachment } from "@/lib/resolveVoucherAttachmentRemoteUrl";
import { getBlobFromAttachmentRefPreferLocalFirst } from "@/lib/attachmentPreviewResolve";
import { tryResolveInterCompanyPeerAttachmentUrl } from "@/lib/interCompany/interCompanyAttachmentPeerResolve";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { shouldUseAttachmentLazyLoad } from "@/lib/webAttachmentLazyLoadPolicy";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import {
  useAttachmentHoldPointer,
  ATTACHMENT_HOLD_MS_MOBILE,
  ATTACHMENT_HOLD_MS_DESKTOP,
} from "@/hooks/useAttachmentHoldPointer";
import {
  buildHoldPayloadFromPreviewSource,
  normalizeAttachmentUrlForDevicePreview,
  writeAttachmentHoldClipboard,
  refreshAttachmentHoldSessionBackup,
} from "@/lib/attachmentHoldClipboard";
import { toast as sonnerToast } from "sonner";
import { useCrossCompanyAttachmentAccess } from "@/hooks/useCrossCompanyAttachmentAccess";
import { useCompany } from "@/hooks/useCompany";
import { isOnlineCompanyAttachmentNetworkAllowed } from "@/lib/onlineCompanySelectorSyncPolicy";
import { FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { grantExplicitAttachmentNetworkFetchBatch } from "@/lib/attachmentNetworkGate";
import {
  companyAttachmentMode,
  companyRequiresLocalAttachmentUrlsOnly,
  companyUsesLocalAttachmentSourcesOnly,
  prefersLocalAttachmentDisplayFirst,
  resolveStaticAttachmentDisplay,
} from "@/lib/staticAttachmentDisplayUrl";
import {
  collectAccessibleCompanyIdsForAttachmentPolicy,
  isCrossCompanyAttachmentVisibleToUser,
} from "@/lib/crossCompanyAttachmentAccess";
import { forgetHoverBlobUrl, peekHoverCachedBlobUrl, rememberHoverBlobUrl } from "@/lib/attachmentHoverBlobCache";
import {
  ATTACHMENT_REUSE_COUNT_EVENT,
  attachmentPersistableRefsMatch,
  noteAttachmentUnlinkedInUi,
  rememberAttachmentReuseOriginPlace,
  resolveAttachmentReuseUiMeta,
} from "@/lib/companyAttachmentRegistry";
import { useVoucherListReuseHint } from "@/lib/voucherAttachmentListReuseIndex";
import {
  ensureAttachmentUiRefreshListeners,
  getAttachmentUrlLoadStatus,
  subscribeAttachmentLoadStore,
} from "@/lib/attachmentLoadReady";
import {
  looksLikeFirebaseStorageDownloadUrl,
  tryGetBlobFromFirebaseStorageDownloadUrl,
} from "@/lib/storageGetBlobFromDownloadUrl";

/** Forensic: `NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG=1` — FilePreview branch + ATTACHMENT_PREVIEW_DOWNGRADE proof. */
const FILE_PREVIEW_FORENSIC =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG === "1";

/** `next/image` + `blob:` / `data:` / signed HTTPS — portal hover `<img>` jaisa; Next/Image remotePatterns miss par edit thumb blank. */
function isBlobOrDataDisplayUrl(u: string | null | undefined): boolean {
  if (!u || typeof u !== "string") return false;
  if (u.startsWith("blob:") || u.startsWith("data:")) return true;
  if (/^https?:\/\//i.test(u)) return true;
  return false;
}

/** Raw Firebase object path / `local:` — kabhi `<img src>` mat; pehle blob/native resolve. */
function isUnresolvedAttachmentPreviewUrl(url: string | null | undefined): boolean {
  const u = String(url || "").trim();
  if (!u) return true;
  if (isLocalFileRef(u)) return true;
  // Restore leftovers: `voucher-files/...` as display URL → broken thumb showing path text.
  if (
    looksLikeFirebaseStorageObjectPath(u) ||
    /^voucher-files\//i.test(u) ||
    /^companies\/[^/]+\/(voucher-files|entity-files|pending-files)\//i.test(u) ||
    /^entity-files\//i.test(u)
  ) {
    return true;
  }
  return false;
}

function logFilePreviewForensic(tag: string, payload: Record<string, unknown>) {
  if (!FILE_PREVIEW_FORENSIC) return;
  console.warn("[FORENSIC_FILE_PREVIEW]", { tag, ...payload });
}

/** Warmed LRU blob abhi paint-able hai? Revoked / dead blob → FilePreview broken `local:` alt. */
async function isUsableWarmedAttachmentDisplayUrl(displayUrl: string): Promise<boolean> {
  const u = String(displayUrl || "").trim();
  if (!u || isUnresolvedAttachmentPreviewUrl(u)) return false;
  if (u.startsWith("data:")) return true;
  if (!u.startsWith("blob:")) {
    // Native convertFileSrc / https — fetch mat; sirf blob: revoke race check.
    return /^https?:\/\//i.test(u) || u.startsWith("capacitor:") || u.startsWith("file:");
  }
  try {
    const blob = await fetch(u).then((r) => r.blob());
    return Boolean(blob && blob.size > 0);
  } catch {
    return false;
  }
}

/** Web preview helper: `local:uuid` -> IndexedDB/Pending / PL staff fetch -> browser `blob:` URL. */
async function resolveLocalRefToBlobUrlForPreview(
  localRef: string,
  galleryUrls?: readonly string[],
  companyId?: string,
  staleRemoteFallback?: {
    voucherId?: string;
    clientFileUrls?: readonly string[] | null;
    enabled?: boolean;
  }
): Promise<{ blob: Blob | null; blobUrl: string | null }> {
  try {
    const { getOfflineCachedAttachmentNativeRef } = await import("@/lib/offlineAttachmentUrlCache");
    const native = await getOfflineCachedAttachmentNativeRef(localRef);
    if (native?.displayUrl?.trim()) {
      return { blob: null, blobUrl: native.displayUrl.trim() };
    }
  } catch {
    /* optional */
  }
  const directLocal = await getBlobFromLocalFileRef(
    localRef,
    companyId ? { companyId } : undefined
  );
  if (directLocal && directLocal.size > 0) {
    return { blob: directLocal, blobUrl: URL.createObjectURL(directLocal) };
  }
  if (companyId && staleRemoteFallback?.enabled && staleRemoteFallback.voucherId) {
    try {
      const remoteUrl = await tryResolveRemoteUrlForStaleLocalAttachment(
        companyId,
        staleRemoteFallback.voucherId,
        localRef,
        staleRemoteFallback.clientFileUrls
      );
      if (remoteUrl && !isLocalFileRef(remoteUrl)) {
        let remoteBlob: Blob | null = null;
        if (looksLikeFirebaseStorageDownloadUrl(remoteUrl)) {
          remoteBlob = await tryGetBlobFromFirebaseStorageDownloadUrl(remoteUrl, undefined, {
            companyId,
            explicitUserRequest: staleRemoteFallback?.enabled,
          });
        }
        if (!remoteBlob?.size) {
          remoteBlob = await getRemoteAttachmentBlobPreferOfflineCache(remoteUrl, undefined, {
            companyId,
            explicitUserRequest: staleRemoteFallback?.enabled,
          });
        }
        if (remoteBlob && remoteBlob.size > 0) {
          void seedOfflineAttachmentCacheFromBlob(localRef, remoteBlob);
          void seedOfflineAttachmentCacheFromBlob(remoteUrl, remoteBlob);
          return { blob: remoteBlob, blobUrl: URL.createObjectURL(remoteBlob) };
        }
      }
    } catch {
      /* online stale-local fallback optional */
    }
  }
  // Staff / server-company: local miss par `/__pl_attachment`.
  if (companyId) {
    try {
      const { resolvePlServerStaffAttachmentPreviewBlob } = await import("@/lib/plServerAttachmentFetch");
      const remote = await resolvePlServerStaffAttachmentPreviewBlob(localRef, {
        companyId,
        galleryUrls,
      });
      if (remote && remote.size > 0) {
        return { blob: remote, blobUrl: URL.createObjectURL(remote) };
      }
    } catch {
      /* fall through */
    }
  }
  const { getBlobFromAttachmentRefPreferLocalFirst } = await import("@/lib/attachmentPreviewResolve");
  const b = await getBlobFromAttachmentRefPreferLocalFirst(localRef, { galleryUrls, companyId });
  if (!b || b.size <= 0) return { blob: null, blobUrl: null };
  return { blob: b, blobUrl: URL.createObjectURL(b) };
}

/** Sirf tab jab `resolvedType==="other"` aur URL null — generic FILE icon fail point. */
function logAttachmentPreviewDowngradeToGenericFile(
  reasonTag: string,
  fileValue: File | string,
  resolvedUrl: string | null,
  resolvedType: string,
  extra?: Record<string, unknown>
) {
  if (!FILE_PREVIEW_FORENSIC) return;
  if (resolvedType === "other" && (resolvedUrl == null || resolvedUrl === "")) {
    console.warn("ATTACHMENT_PREVIEW_DOWNGRADE_TO_GENERIC_FILE", {
      reasonTag,
      originalFile: typeof fileValue === "string" ? fileValue : fileValue?.name,
      resolvedUrl,
      resolvedType,
      ...extra,
    });
  }
}

function isImageFormatLabel(label: string | null | undefined): boolean {
  return ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF"].includes(
    String(label || "").toUpperCase()
  );
}

/** JPG seedha browser decode; PDF = download + pdf.js + canvas — 3–6s pehli baar normal. Dubara same URL tez ho: LRU cache. */
const PDF_THUMB_LRU_MAX = 40;
const pdfThumbLru = new Map<string, string>();
/** Same PDF key ke parallel renders ko dedupe karo — rerender storm me duplicate pdf.js work avoid. */
const pdfThumbInFlight = new Map<string, Promise<string | null>>();

function pdfThumbCacheKey(
  fileObject: File | undefined,
  pdfUrl: string,
  firebaseStoragePath: string | undefined,
  edge: number
): string {
  if (fileObject instanceof File) {
    return `f:${fileObject.name}:${fileObject.size}:${fileObject.lastModified}:${edge}`;
  }
  return `u:${pdfUrl}|${firebaseStoragePath ?? ""}|${edge}`;
}

function pdfThumbBlobIsCached(blobUrl: string | null): boolean {
  if (!blobUrl) return false;
  for (const v of pdfThumbLru.values()) if (v === blobUrl) return true;
  return false;
}

function pdfThumbCacheGet(key: string): string | undefined {
  const v = pdfThumbLru.get(key);
  if (v === undefined) return undefined;
  pdfThumbLru.delete(key);
  pdfThumbLru.set(key, v);
  return v;
}

/** Jagah kam ho to purani entry hatao; blob revoke nahi — warna dusra tile jiska img abhi wahi URL ho to tut jaye */
function pdfThumbCacheSet(key: string, blobUrl: string) {
  pdfThumbLru.delete(key);
  pdfThumbLru.set(key, blobUrl);
  while (pdfThumbLru.size > PDF_THUMB_LRU_MAX) {
    const oldest = pdfThumbLru.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    pdfThumbLru.delete(oldest);
  }
}

/** Tooltip/hover FilePreview jiska previewBox 600×700 hai — wahi layoutMaxEdge=700 cache key */
const GALLERY_PDF_HOVER_THUMB_EDGE = 700;
// `NEXT_PUBLIC_STATIC_BUILD` / Capacitor pe pehle 5s tha — Firebase PDF + IndexedDB warm slow → fetch abort, lal icon, phir dubara try se 30–60s feel. `next dev` jaisa 25s taaki gallery/hover web jaisa.
const PDF_REMOTE_FETCH_TIMEOUT_MS = 25_000;

function sharedPdfCellThumbKey(url: string): string {
  return `${url}::cell-thumb-v2`;
}

function sharedAttachmentCellThumbKey(url: string): string {
  return `${url}::cell-thumb`;
}

function sharedPdfPortalThumbKey(url: string): string {
  return `${url}::pdf-portal`;
}

/**
 * Gallery "Full preview" ON par current page ke PDF hovers ke liye pdf.js + pehla page pehle se cache me;
 * mouse le jate hi tooltip me turant thumb dikhe.
 */
export async function prewarmPdfThumbnailsForGallery(
  entries: ReadonlyArray<{ url: string; storagePath?: string }>,
  signal?: AbortSignal,
  localAttachmentOnly = false,
  opts?: { companyId?: string | null }
): Promise<void> {
  const seen = new Set<string>();
  const { convertPdfFirstPageToImage } = await import("@/lib/pdfToImage");
  for (const { url, storagePath: entryStoragePath } of entries) {
    if (signal?.aborted) return;
    const u = String(url).trim();
    if (!u) continue;
    let storagePath = entryStoragePath;
    if (!storagePath && opts?.companyId) {
      const fromUrl = tryGetStoragePathFromFirebaseDownloadUrl(u);
      if (fromUrl) storagePath = fromUrl;
      else {
        const norm = normalizeFirebaseStorageObjectPathForSdk(u, { companyId: opts.companyId });
        if (
          /^voucher-files\//i.test(norm) ||
          /^companies\//i.test(norm) ||
          /^entity-files\//i.test(norm)
        ) {
          storagePath = norm;
        }
      }
    }
    // Local gallery = `data:application/pdf`; Firebase URL kabhi filename me literal `.pdf` na ho — label se sniff
    const base = u.split("?")[0].toLowerCase();
    let isPdfEntry =
      u.startsWith("data:application/pdf") ||
      getAttachmentFormatLabel(u) === "PDF" ||
      base.endsWith(".pdf");
    // Voucher attachment `local:uuid` — gallery page can contain hundreds of local JPEGs.
    // Use saved metadata only; blob sniff here turns normal gallery idle into heavy disk/pdf work.
    if (!isPdfEntry && u.startsWith(LOCAL_FILE_PREFIX)) {
      try {
        const meta = await getLocalFileRefMeta(u);
        isPdfEntry =
          String(meta?.contentType || "").toLowerCase().includes("pdf") ||
          getAttachmentFormatLabelFromHints(meta?.fileName, meta?.contentType) === "PDF";
      } catch {
        /* skip */
      }
    }
    if (!isPdfEntry) continue;
    const ck = pdfThumbCacheKey(undefined, u, storagePath, GALLERY_PDF_HOVER_THUMB_EDGE);
    if (seen.has(ck)) continue;
    seen.add(ck);
    if (pdfThumbCacheGet(ck)) continue;
    try {
      let pdfFile: Blob;
      if (storagePath && !localAttachmentOnly) {
        // Pocket Ledger Server login only: no Firebase Storage fallback.
        if (isPocketBaseOnlyAppSession()) continue;
        const storageRef = ref(storage, storagePath);
        pdfFile = await getBlob(storageRef);
      } else if (u.startsWith(LOCAL_FILE_PREFIX)) {
        if (isCapacitorNativeApp()) continue;
        const lb = await getBlobFromLocalFileRef(u);
        if (!lb || lb.size === 0) continue;
        pdfFile = lb;
      } else if (u.startsWith("data:")) {
        const res = await fetch(u, { signal });
        if (!res.ok) continue;
        pdfFile = await res.blob();
      } else if (isPbAttachmentRef(u)) {
        const lb = (await tryOfflineCachedAttachmentBlobMultiKey(u)) || (await fetchPbAttachmentBlob(u));
        if (!lb || lb.size === 0) continue;
        pdfFile = lb;
      } else if (u.startsWith("http") || u.startsWith("blob:")) {
        // Full warm sync ne IndexedDB me jo PDF cache kiya ho — gallery hover turant
        let pdfFileHttp: Blob | null = null;
        if (u.startsWith("http")) {
          pdfFileHttp = await getRemoteAttachmentBlobPreferOfflineCache(u, signal, {
            localOnly: localAttachmentOnly,
          });
        }
        if (!pdfFileHttp || pdfFileHttp.size === 0) {
          if (localAttachmentOnly) continue;
          const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
          if (
            !isRemoteAttachmentNetworkFetchAllowed(u, {
              companyId: opts?.companyId,
              bypassVisiblePageCheck: true,
            })
          ) {
            continue;
          }
          const res = await fetch(u, { mode: "cors", signal });
          if (!res.ok) continue;
          pdfFileHttp = await res.blob();
        }
        pdfFile = pdfFileHttp;
      } else {
        continue;
      }
      if (signal?.aborted) return;
      // Gallery hover box is 600×700 — warm portal-quality raster so preview is not a soft tile thumb.
      const result = await convertPdfFirstPageToImage(pdfFile, 0.92, 1800, { signal });
      if (signal?.aborted) {
        URL.revokeObjectURL(result.thumbnailUrl);
        return;
      }
      pdfThumbCacheSet(ck, result.thumbnailUrl);
      rememberHoverBlobUrl(sharedPdfPortalThumbKey(u), result.thumbnailUrl);
      void seedOfflineAttachmentCacheFromBlob(sharedPdfPortalThumbKey(u), result.thumbnailBlob);
      // Grid tile (160px): cell-thumb bhi seed — portal-only warm se lal PDF icon reh jata tha.
      rememberHoverBlobUrl(sharedPdfCellThumbKey(u), result.thumbnailUrl);
      void seedOfflineAttachmentCacheFromBlob(sharedPdfCellThumbKey(u), result.thumbnailBlob);
    } catch {
      /* ek PDF fail ho to baaki warm rahein */
    }
  }
}

async function fetchBlobWithTimeout(
  input: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Blob> {
  // Online warm sync cache — offline pe bina network PDF thumb
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const warm = await getOfflineCachedAttachmentBlob(input);
    if (warm && warm.size > 0) return warm;
  }
  // APK/static: hung network calls should fail fast so thumbnail UI doesn't spin forever.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { mode: "cors", signal: controller.signal });
    if (!res.ok) throw new Error(`PDF fetch ${res.status}`);
    return await res.blob();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

/** Thumbnail format badge — compact size (e.g. `86 KB`). */
function formatBytesForThumbBadge(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    const rounded = kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10;
    return `${rounded} KB`;
  }
  const mb = kb / 1024;
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${rounded} MB`;
}

/** First positive byte length — parent meta, File.size, or loaded Blob. */
function pickAttachmentByteSize(
  ...candidates: Array<number | null | undefined | Blob>
): number | null {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
    if (c && typeof c === "object" && "size" in c) {
      const n = Number((c as Blob).size);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** Remount / sibling tiles — once size known, badge instantly. */
const attachmentByteSizeMemory = new Map<string, number>();

function rememberAttachmentByteSize(url: string | null | undefined, bytes: number | null | undefined): void {
  const u = String(url || "").trim();
  const n = pickAttachmentByteSize(bytes);
  if (!u || n == null) return;
  attachmentByteSizeMemory.set(u, n);
}

function recalledAttachmentByteSize(url: string | null | undefined): number | null {
  const u = String(url || "").trim();
  if (!u) return null;
  return pickAttachmentByteSize(attachmentByteSizeMemory.get(u));
}

/** Browser already downloaded the image — Resource Timing se size (jab Timing-Allow-Origin ho). */
function byteSizeFromPerformanceResource(url: string | null | undefined): number | null {
  const u = String(url || "").trim();
  if (!u || typeof performance === "undefined" || typeof performance.getEntriesByName !== "function") {
    return null;
  }
  try {
    const entries = performance.getEntriesByName(u) as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const n = pickAttachmentByteSize(e?.encodedBodySize, e?.transferSize, e?.decodedBodySize);
      if (n != null) return n;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Web badge size without full download (hang-safe).
 * 1) offline cache  2) Storage getMetadata (always OK)  3) HEAD/Range only when allowHttpPeek
 */
async function peekRemoteAttachmentByteSize(
  url: string,
  opts?: {
    signal?: AbortSignal;
    storagePath?: string | null;
    companyId?: string | null;
    /** false = skip HEAD/Range only; getMetadata + cache still run */
    allowHttpPeek?: boolean;
  }
): Promise<number | null> {
  const u = String(url || "").trim();
  if (!u) return null;

  const remembered = recalledAttachmentByteSize(u);
  if (remembered != null) return remembered;

  if (isLocalFileRef(u)) {
    try {
      const meta = getLocalFileRefMetaSync(u);
      const syncSize = pickAttachmentByteSize(meta?.size);
      if (syncSize != null) return syncSize;
      const asyncMeta = await getLocalFileRefMeta(u);
      return pickAttachmentByteSize(asyncMeta?.size);
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(u)) return null;

  try {
    const cached = await getOfflineCachedAttachmentBlob(u);
    const fromCache = pickAttachmentByteSize(cached);
    if (fromCache != null) return fromCache;
  } catch {
    /* miss */
  }

  if (opts?.signal?.aborted) return null;

  const rawPath =
    String(opts?.storagePath || "").trim() ||
    tryGetStoragePathFromFirebaseDownloadUrl(u) ||
    "";
  const objectPath =
    (rawPath &&
      normalizeFirebaseStorageObjectPathForSdk(rawPath, {
        companyId: opts?.companyId ?? undefined,
      })) ||
    rawPath;
  if (objectPath) {
    try {
      const meta = await getMetadata(ref(storage, objectPath));
      const n = Number(meta?.size || 0);
      if (Number.isFinite(n) && n > 0) {
        rememberAttachmentByteSize(u, n);
        return n;
      }
    } catch {
      /* path/auth miss */
    }
  }
  if (opts?.signal?.aborted) return null;
  if (opts?.allowHttpPeek === false) return null;

  try {
    const head = await fetch(u, { method: "HEAD", mode: "cors", signal: opts?.signal });
    if (head.ok) {
      const n = Number(head.headers.get("content-length") || "");
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* CORS / HEAD unsupported */
  }
  if (opts?.signal?.aborted) return null;

  try {
    const ranged = await fetch(u, {
      method: "GET",
      mode: "cors",
      headers: { Range: "bytes=0-0" },
      signal: opts?.signal,
    });
    const cr = ranged.headers.get("content-range") || "";
    const m = /\/(\d+)\s*$/.exec(cr);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) {
        try {
          await ranged.body?.cancel();
        } catch {
          /* ignore */
        }
        return n;
      }
    }
    if (ranged.status === 200) {
      const n = Number(ranged.headers.get("content-length") || "");
      try {
        await ranged.body?.cancel();
      } catch {
        /* ignore */
      }
      if (Number.isFinite(n) && n > 0) return n;
    } else {
      try {
        await ranged.body?.cancel();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface FilePreviewProps {
  file: File | string;
  onRemove?: () => void;
  isAvatar?: boolean;
  isCompressing?: boolean;
  compressionResult?: { originalSize: number; compressedSize: number } | null;
  children?: React.ReactNode;
  size?: number;
  fileSize?: number; // Accept size from parent
  /** Square ke alawa fixed box (sirf gallery hover jaise); set ho to width/height yahi, PDF raster = max(edge) */
  previewBox?: { width: number; height: number };
  className?: string;
  disabled?: boolean; // Block add/remove; preview optional via allowPreviewWhenDisabled
  /** Edit locked par bhi thumbnail click se open allow (IC view-only) */
  allowPreviewWhenDisabled?: boolean;
  /** Firebase Storage path (e.g. companies/xxx/unassigned/yyy.pdf). When set, PDF thumbnail is loaded via SDK to avoid CORS/fetch failures. */
  storagePath?: string;
  /** object-contain = full image visible at best quality; object-cover = crop to fill (default). */
  objectFit?: "cover" | "contain";
  /**
   * Hover par bada side-panel (zoom) — default off: thumbnail click = open file; chaho to `true` se purana hover zoom wapas.
   */
  enableHoverFullPreview?: boolean;
  /** Thumbnail ke corner par chhota PDF/JPEG text; forms + gallery ke liye default on. */
  showFormatBadge?: boolean;
  /** Gallery tiles: outer frame/shadow hata do — sirf ek 1px border rakho. */
  flushFrame?: boolean;
  /** Saved URLs only (same voucher/entity set) — click par multi-file viewer ← → / swipe */
  attachmentGallery?: { urls: string[]; startIndex: number };
  /** Voucher edit: `files` se string URLs — server pe HTTPS milne par index match */
  attachmentClientFileUrls?: string[];
  /** ~2s hold = clipboard me attachment ref (paste = nayi copy upload). Gallery / nested hover par false. */
  holdAttachmentClipboard?: boolean;
  /** EXE/SQLite mirror tail (`27e15173%2Fpayment_out%2F…`) → `voucher-files/{companyId}/…` resolve */
  attachmentCompanyId?: string;
  /** Gallery local company: Firebase Storage/network mat chhedo — sirf cache + `local:`. */
  forceLocalAttachmentOnly?: boolean;
  /** Voucher `files[].name` / gallery caption — `local:uuid` URL pe extension nahi hoti. */
  sourceFileName?: string | null;
  /** Voucher `files[].contentType` — PDF/JPEG type bina sniff. */
  contentType?: string | null;
  /** Gallery grid: once a local cached preview paints, late generic/error passes must not replace it. */
  stableLocalPreviewOnly?: boolean;
  /** HTTPS reuse badge (2/3/4…) — company-wide how many places use this file. */
  showReuseCountBadge?: boolean;
  /**
   * Current place key (`vouchers/id`, `parties/id`, …).
   * Origin (earliest linked doc) → green badge; reuse wale pe blue.
   */
  attachmentReusePlaceKey?: string | null;
}

const getCleanName = (name: string) => {
  if (name.includes('_')) {
    return name.split('_').slice(1).join('_');
  }
  return name;
};

// Bade hover-preview ka max width — transaction table file column se align
const HOVER_PREVIEW_MAX_PX = 800;

export function FilePreview({
  file,
  onRemove,
  isAvatar = false,
  isCompressing: isCompressingProp,
  compressionResult,
  children,
  size = 96,
  fileSize,
  previewBox,
  className,
  disabled = false,
  allowPreviewWhenDisabled = false,
  storagePath,
  objectFit = "cover",
  enableHoverFullPreview = false,
  showFormatBadge = true,
  flushFrame = false,
  attachmentGallery,
  attachmentClientFileUrls,
  holdAttachmentClipboard = true,
  attachmentCompanyId,
  forceLocalAttachmentOnly = false,
  sourceFileName = null,
  contentType = null,
  stableLocalPreviewOnly = false,
  showReuseCountBadge = false,
  attachmentReusePlaceKey = null,
}: FilePreviewProps) {
  const voucherAttachmentFb = useVoucherAttachmentFallback();
  const { companyId: shellCompanyId, company } = useCompany();
  const { activeCompanyId, accessibleCompanyIds } = useCrossCompanyAttachmentAccess();
  // UI guard: koi stale PL marker aa jaye to preview/open path me underlying src (`local:`/https) use karo.
  const normalizedPreviewFile = React.useMemo(
    () => (typeof file === "string" ? normalizeAttachmentUrlForDevicePreview(file) : file),
    [file]
  );
  const fileRefForLoadStatus = typeof normalizedPreviewFile === "string" ? normalizedPreviewFile.trim() : "";
  /** Sirf is file ka ready/loading — global tick mat (gallery: ek file ready → 16 tiles blink). */
  const fileLoadStatus = React.useSyncExternalStore(
    subscribeAttachmentLoadStore,
    () =>
      fileRefForLoadStatus && isLocalFileRef(fileRefForLoadStatus)
        ? getAttachmentUrlLoadStatus(fileRefForLoadStatus)
        : "ready",
    () => "ready"
  );
  React.useEffect(() => {
    ensureAttachmentUiRefreshListeners();
  }, []);
  // Edit forms me fallback company id dene se Firebase object-path resolve stable rehta hai.
  const pathCompanyId = attachmentCompanyId ?? voucherAttachmentFb?.companyId ?? shellCompanyId ?? undefined;
  const [filesTickEpoch, setFilesTickEpoch] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrefs = () => setFilesTickEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
  }, []);
  const localLedgerOnly = React.useMemo(() => {
    if (forceLocalAttachmentOnly || companyRequiresLocalAttachmentUrlsOnly(company)) return true;
    if (companyUsesLocalAttachmentSourcesOnly(company)) return true;
    const cid = String(pathCompanyId || company?.id || "").trim();
    if (!cid) return false;
    // Files tick OFF → no network fetch; local blob/cache still shows / opens.
    return !isOnlineCompanyAttachmentNetworkAllowed(cid, company);
  }, [forceLocalAttachmentOnly, company, pathCompanyId, filesTickEpoch]);
  const attachmentMode = React.useMemo(
    () => companyAttachmentMode(company, { localLedgerOnly }),
    [company, localLedgerOnly]
  );
  const preferLocalAttachmentFirst = React.useMemo(
    () => prefersLocalAttachmentDisplayFirst(company),
    [company]
  );
  const fileRef = typeof normalizedPreviewFile === "string" ? normalizedPreviewFile.trim() : "";
  const expandedAccessibleCompanyIds = React.useMemo(() => {
    const peerId = voucherAttachmentFb?.interCompanyPeer?.peerCompanyId;
    if (!peerId) return accessibleCompanyIds;
    return collectAccessibleCompanyIdsForAttachmentPolicy([], [peerId, ...[...accessibleCompanyIds]]);
  }, [accessibleCompanyIds, voucherAttachmentFb?.interCompanyPeer?.peerCompanyId]);
  const policyAllowsAttachmentView = React.useMemo(() => {
    if (!fileRef || isLocalFileRef(fileRef) || isDriveFileRef(fileRef)) return true;
    if (voucherAttachmentFb?.interCompanyPeer) return true;
    return isCrossCompanyAttachmentVisibleToUser(fileRef, activeCompanyId, expandedAccessibleCompanyIds);
  }, [
    fileRef,
    activeCompanyId,
    expandedAccessibleCompanyIds,
    voucherAttachmentFb?.interCompanyPeer,
  ]);
  const [offlineCacheReadable, setOfflineCacheReadable] = React.useState(false);
  React.useEffect(() => {
    if (!fileRef || policyAllowsAttachmentView) {
      setOfflineCacheReadable(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { getOfflineCachedAttachmentBlob } = await import("@/lib/offlineAttachmentUrlCache");
        const blob = await getOfflineCachedAttachmentBlob(fileRef);
        if (!cancelled) setOfflineCacheReadable(Boolean(blob && blob.size > 0));
      } catch {
        if (!cancelled) setOfflineCacheReadable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileRef, policyAllowsAttachmentView]);
  const attachmentBlockedByCrossCompanyPolicy =
    Boolean(fileRef) &&
    !policyAllowsAttachmentView &&
    !offlineCacheReadable;

  // Edit / gallery open: user ne file dekhi — is voucher ke HTTPS URLs ke liye network grant.
  React.useEffect(() => {
    if (localLedgerOnly) return;
    const cid = String(pathCompanyId || "").trim();
    if (!cid) return;
    const grantUrls: string[] = [];
    if (typeof file === "string") {
      const trimmed = file.trim();
      if (/^https?:\/\//i.test(trimmed)) grantUrls.push(trimmed);
    }
    for (const raw of attachmentClientFileUrls || []) {
      const trimmed = String(raw || "").trim();
      if (/^https?:\/\//i.test(trimmed)) grantUrls.push(trimmed);
    }
    for (const raw of attachmentGallery?.urls || []) {
      const trimmed = String(raw || "").trim();
      if (/^https?:\/\//i.test(trimmed)) grantUrls.push(trimmed);
    }
    if (grantUrls.length > 0) grantExplicitAttachmentNetworkFetchBatch(grantUrls, cid);
  }, [
    file,
    pathCompanyId,
    localLedgerOnly,
    attachmentClientFileUrls,
    attachmentGallery?.urls,
  ]);

  // URL-only props (e.g. gallery vouchers) par Firebase SDK se blob — fetch/CORS fail hone par bhi thumb mile.
  // Local/`local:` restore: purana `files[].storagePath` Firebase disturb na kare.
  const resolvedStoragePath = React.useMemo(() => {
    if (typeof file === "string" && isLocalFileRef(file)) return undefined;
    if (localLedgerOnly) return undefined;
    if (storagePath) return storagePath;
    if (typeof file === "string") {
      const fromUrl = tryGetStoragePathFromFirebaseDownloadUrl(file);
      if (fromUrl) return fromUrl;
      const norm = normalizeFirebaseStorageObjectPathForSdk(file, { companyId: pathCompanyId });
      if (
        /^voucher-files\//i.test(norm) ||
        /^companies\//i.test(norm) ||
        /^entity-files\//i.test(norm)
      ) {
        return norm;
      }
    }
    return undefined;
  }, [file, storagePath, pathCompanyId, localLedgerOnly]);

  /** Voucher attach grid: parent `h-16`/`h-24` + `w-full` — inline 96px style mat lagao (Add box chhota na dikhe) */
  const fillsParentAttachSlot = Boolean(
    className && /\bw-full\b/.test(className) && /\bh-(?:16|24)\b/.test(className)
  );
  const layoutW = fillsParentAttachSlot ? size : previewBox?.width ?? size;
  const layoutH = fillsParentAttachSlot ? size : previewBox?.height ?? size;
  const layoutMaxEdge = Math.max(layoutW, layoutH);

  // Sirf content fingerprints — naya array/object ref (parent tick / interval) par preview `useEffect` na chale, blob revoke flash na ho.
  const attachmentClientUrlsFingerprint =
    !Array.isArray(attachmentClientFileUrls) || attachmentClientFileUrls.length === 0
      ? ""
      : attachmentClientFileUrls.join("\u0001");
  const attachmentGalleryFingerprint =
    !attachmentGallery?.urls?.length
      ? ""
      : `${attachmentGallery.startIndex}\u0001${attachmentGallery.urls.join("\u0001")}`;
  const voucherAttachmentFbFingerprint = voucherAttachmentFb
    ? `${voucherAttachmentFb.companyId}\u0001${voucherAttachmentFb.voucherId}`
    : "";

  /** `local:` + runtime displayUrl (EXE/APK disk OR web IDB putPendingFile blob URL) — spinner skip. */
  const immediateLocalInfo = React.useMemo(() => {
    if (!(typeof file === "string" && isLocalFileRef(file))) {
      return null;
    }
    const meta = getLocalFileRefMetaSync(file);
    if (!meta?.displayUrl || isUnresolvedAttachmentPreviewUrl(meta.displayUrl)) return null;
    let type: "image" | "pdf" | "other" = "other";
    const ct = String(meta.contentType || "").toLowerCase();
    const hintKind = getAttachmentPreviewKindFromHints(meta.fileName, meta.contentType);
    if (hintKind === "pdf" || ct.includes("pdf")) type = "pdf";
    else if (hintKind === "image" || ct.startsWith("image/")) type = "image";
    // Restore / pending: octet-stream + no extension → sync FILE icon mat paint; async sniff chalao.
    if (
      type === "other" &&
      (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream")
    ) {
      return null;
    }
    let name = "file";
    if (meta.fileName) {
      try {
        name = decodeURIComponent(String(meta.fileName));
      } catch {
        name = String(meta.fileName);
      }
    }
    const hinted = getAttachmentFormatLabelFromHints(meta.fileName, meta.contentType) || "";
    const formatLabel = type === "pdf" ? "PDF" : type === "image" ? hinted || "IMAGE" : hinted || "FILE";
    return {
      url: meta.displayUrl,
      type,
      name,
      size: Number(meta.size || fileSize || 0) || null,
      formatLabel,
    } as const;
  }, [file, fileSize]);

  const [fileInfo, setFileInfo] = useState<{
    url: string | null;
    type: "image" | "pdf" | "other";
    name: string;
    size: number | null;
    formatLabel: string;
  }>(
    immediateLocalInfo
      ? {
          url: immediateLocalInfo.url,
          type: immediateLocalInfo.type,
          name: immediateLocalInfo.name,
          size: immediateLocalInfo.size,
          formatLabel: immediateLocalInfo.formatLabel,
        }
      : { url: null, type: "other", name: "loading...", size: null, formatLabel: "" }
  );

  /** 404 / object-not-found: doc re-read (local → server) → current URL (recompress swap on another device). */
  const tryCurrentDocUrlFallback = React.useCallback(() => {
    const src = typeof normalizedPreviewFile === "string" ? String(normalizedPreviewFile).trim() : "";
    if (!/^https?:\/\//i.test(src) || forceLocalAttachmentOnly) return;
    const gUrls = attachmentGallery?.urls ?? [];
    void resolveCurrentAttachmentUrlAfterLoadError({
      companyId: pathCompanyId,
      placeKey: attachmentReusePlaceKey,
      badUrl: src,
      siblingUrls: gUrls,
      index: attachmentGallery ? gUrls.findIndex((u) => u === src) : undefined,
    }).then((nextUrl) => {
      if (!nextUrl) return;
      setFileInfo((prev) => ({ ...prev, url: nextUrl }));
      setIsLoading(false);
    });
  }, [normalizedPreviewFile, forceLocalAttachmentOnly, attachmentGallery, pathCompanyId, attachmentReusePlaceKey]);

  /**
   * Hang-safe KB badge: warm/early-return paths size skip karte the.
   * getMetadata/cache hamesha; HEAD/Range sirf jab Files network allow.
   */
  React.useEffect(() => {
    if (typeof File !== "undefined" && file instanceof File && file.size > 0) return;
    if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0) return;
    if (typeof file !== "string") return;
    const src = String(file).trim();
    if (!src) return;
    if (!/^https?:\/\//i.test(src) && !isLocalFileRef(src)) return;
    if (pickAttachmentByteSize(fileInfo.size) != null) return;

    const ac = new AbortController();
    void (async () => {
      const peeked = await peekRemoteAttachmentByteSize(src, {
        signal: ac.signal,
        storagePath: resolvedStoragePath || storagePath,
        companyId: pathCompanyId,
        // Files OFF: HTTP Range mat; Storage metadata + cache ab bhi size de sakte hain.
        allowHttpPeek: !localLedgerOnly,
      });
      if (!peeked || ac.signal.aborted) return;
      rememberAttachmentByteSize(src, peeked);
      setFileInfo((prev) => {
        if (pickAttachmentByteSize(prev.size) != null) return prev;
        return { ...prev, size: peeked };
      });
    })();
    return () => ac.abort();
  }, [
    file,
    fileSize,
    fileInfo.size,
    resolvedStoragePath,
    storagePath,
    pathCompanyId,
    localLedgerOnly,
  ]);

  const [isLoading, setIsLoading] = useState(immediateLocalInfo ? false : true);

  /** Recompress/reuse ke baad FILE icon stuck — cached blob se image wapas. */
  React.useEffect(() => {
    if (typeof file !== "string") return;
    const src = String(file).trim();
    if (!/^https?:\/\//i.test(src)) return;
    if (fileInfo.type === "image" && fileInfo.url && !isUnresolvedAttachmentPreviewUrl(fileInfo.url)) {
      return;
    }
    const fmt = String(fileInfo.formatLabel || getAttachmentFormatLabel(src) || "").toUpperCase();
    const looksImage =
      ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF", "IMAGE"].includes(
        fmt
      ) || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(src.split("?")[0] || "");
    if (!looksImage) return;

    let cancelled = false;
    void (async () => {
      const warmed = peekHoverCachedBlobUrl(src);
      if (warmed && (await isUsableWarmedAttachmentDisplayUrl(warmed))) {
        if (cancelled) return;
        setFileInfo((prev) => ({
          ...prev,
          url: warmed,
          type: "image",
          formatLabel:
            prev.formatLabel === "FILE" || prev.formatLabel === "OTHER" ? "JPG" : prev.formatLabel || "JPG",
        }));
        setIsLoading(false);
        return;
      }
      try {
        let blob = await getOfflineCachedAttachmentBlob(src);
        if ((!blob || blob.size === 0) && !localLedgerOnly) {
          blob = await getRemoteAttachmentBlobPreferOfflineCache(src, undefined, {
            localOnly: false,
            companyId: pathCompanyId,
            explicitUserRequest: true,
          });
        }
        if (cancelled || !blob || blob.size === 0) return;
        const objectUrl = URL.createObjectURL(blob);
        rememberHoverBlobUrl(src, objectUrl);
        rememberAttachmentByteSize(src, blob.size);
        setFileInfo((prev) => ({
          ...prev,
          url: objectUrl,
          type: "image",
          formatLabel:
            prev.formatLabel === "FILE" || prev.formatLabel === "OTHER" ? "JPG" : prev.formatLabel || "JPG",
          size: pickAttachmentByteSize(prev.size, blob.size),
        }));
        setIsLoading(false);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, fileInfo.type, fileInfo.url, fileInfo.formatLabel, localLedgerOnly, pathCompanyId]);

  const [pdfThumbnail, setPdfThumbnail] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [lastGoodLocalPreview, setLastGoodLocalPreview] = useState<{
    fileInfo: typeof fileInfo;
    pdfThumbnail: string | null;
  } | null>(null);
  React.useEffect(() => {
    if (!(stableLocalPreviewOnly && typeof normalizedPreviewFile === "string" && isLocalFileRef(normalizedPreviewFile))) {
      setLastGoodLocalPreview(null);
      return;
    }
    const hasGoodImage = fileInfo.type === "image" && Boolean(fileInfo.url && !isUnresolvedAttachmentPreviewUrl(fileInfo.url));
    const hasGoodPdf = fileInfo.type === "pdf" && Boolean(pdfThumbnail);
    if (!hasGoodImage && !hasGoodPdf) return;
    setLastGoodLocalPreview((prev) => {
      if (
        prev?.fileInfo.url === fileInfo.url &&
        prev.fileInfo.type === fileInfo.type &&
        prev.pdfThumbnail === pdfThumbnail
      ) {
        return prev;
      }
      return { fileInfo, pdfThumbnail };
    });
  }, [fileInfo, normalizedPreviewFile, pdfThumbnail, stableLocalPreviewOnly]);
  const hasResolvedFileInfo =
    (Boolean(fileInfo.url && !isUnresolvedAttachmentPreviewUrl(fileInfo.url)) && fileInfo.type !== "other") ||
    (fileInfo.type === "pdf" && Boolean(pdfThumbnail));
  /** Render-time source: async/disk-recovered state wins over stale sync displayUrl. */
  const pinnedLocalPreview =
    stableLocalPreviewOnly && typeof normalizedPreviewFile === "string" && isLocalFileRef(normalizedPreviewFile)
      ? lastGoodLocalPreview
      : null;
  const viewFileInfo = pinnedLocalPreview?.fileInfo ?? (hasResolvedFileInfo ? fileInfo : immediateLocalInfo ?? fileInfo);
  const viewPdfThumbnail = pinnedLocalPreview?.pdfThumbnail ?? pdfThumbnail;
  const viewIsLoading = Boolean(pinnedLocalPreview) || hasResolvedFileInfo || immediateLocalInfo ? false : isLoading;
  const [previewTimedOut, setPreviewTimedOut] = React.useState(false);

  React.useEffect(() => {
    setPreviewTimedOut(false);
    const t = window.setTimeout(() => setPreviewTimedOut(true), 28_000);
    return () => window.clearTimeout(t);
  }, [normalizedPreviewFile]);

  const thumbnailUrlRef = useRef<string | null>(null);
  const pdfThumbnailKeyRef = useRef<string | null>(null);
  const badPdfThumbCacheKeysRef = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInfoRef = useRef(fileInfo);
  fileInfoRef.current = fileInfo;

  // Revoke object URL to avoid memory leaks (thumbnails are blob URLs)
  const revokeThumbnailUrl = useCallback((url: string | null) => {
    if (url && url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }, []);

  const setPdfThumbnailSafe = useCallback((url: string | null) => {
    if (!url && thumbnailUrlRef.current && fileInfoRef.current.type === "pdf") {
      return;
    }
    if (thumbnailUrlRef.current !== url) {
      const prev = thumbnailUrlRef.current;
      // Shared cache blob revoke mat karo — warna dusra FilePreview + tutega
      if (prev && !pdfThumbBlobIsCached(prev)) revokeThumbnailUrl(prev);
      thumbnailUrlRef.current = url;
      setPdfThumbnail(url);
    }
  }, [revokeThumbnailUrl]);

  // pdf.js pehli baar 10–40s bhi le sakta hai; 5s = hover/popup me preview hamesha fail (reference-app jaisa lamba race)
  const PDF_THUMBNAIL_FETCH_RACE_MS = 28_000;
  /** Sirf stuck/hang: normal case me unmount se abort hota hai */
  const PDF_THUMBNAIL_EFFECT_HARD_ABORT_MS = 35_000;

  // Generate PDF thumbnail (first page as image). Supports multiple PDFs; loading state and fallback icon handled.
  const generatePdfThumbnail = useCallback(
    async (
      pdfUrl: string,
      fileObject?: File,
      firebaseStoragePath?: string,
      signal?: AbortSignal
    ) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new DOMException("PDF preview timed out", "AbortError")),
          PDF_THUMBNAIL_FETCH_RACE_MS
        );
        signal?.addEventListener("abort", () => clearTimeout(t), { once: true });
      });

      const ck = pdfThumbCacheKey(
        fileObject instanceof File ? fileObject : undefined,
        pdfUrl,
        firebaseStoragePath,
        layoutMaxEdge
      );
      pdfThumbnailKeyRef.current = ck;

      const run = async (): Promise<string | null> => {
        const sharedThumbKey = sharedPdfCellThumbKey(pdfUrl);
        const portalKey = sharedPdfPortalThumbKey(pdfUrl);
        const wantsSharpPortal = layoutMaxEdge >= GALLERY_PDF_HOVER_THUMB_EDGE;
        const skipCachedThumb = badPdfThumbCacheKeysRef.current.has(sharedThumbKey);

        // Company Files / large hover: use ::pdf-portal, not small cell thumb (blurry upscale).
        if (wantsSharpPortal && !skipCachedThumb) {
          const portalCached = peekHoverCachedBlobUrl(portalKey);
          if (portalCached) {
            pdfThumbCacheSet(ck, portalCached);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(portalCached);
            return portalCached;
          }
          const persistedPortal = await tryOfflineCachedAttachmentBlobMultiKey(portalKey);
          if (persistedPortal?.size) {
            const portalUrl = URL.createObjectURL(persistedPortal);
            rememberHoverBlobUrl(portalKey, portalUrl);
            pdfThumbCacheSet(ck, portalUrl);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(portalUrl);
            return portalUrl;
          }
        }

        const sharedThumb = skipCachedThumb ? undefined : peekHoverCachedBlobUrl(sharedThumbKey);
        if (!wantsSharpPortal && !skipCachedThumb) {
          const portalForGrid = peekHoverCachedBlobUrl(portalKey);
          if (portalForGrid) {
            pdfThumbCacheSet(ck, portalForGrid);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(portalForGrid);
            return portalForGrid;
          }
        }
        if (sharedThumb && !wantsSharpPortal) {
          pdfThumbCacheSet(ck, sharedThumb);
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(sharedThumb);
          return sharedThumb;
        }
        if (sharedThumb && wantsSharpPortal) {
          pdfThumbCacheSet(ck, sharedThumb);
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(sharedThumb);
        }
        const persistedSharedThumb = skipCachedThumb ? null : await tryOfflineCachedAttachmentBlobMultiKey(sharedThumbKey);
        if (persistedSharedThumb?.size && !wantsSharpPortal) {
          const persistedThumbUrl = URL.createObjectURL(persistedSharedThumb);
          rememberHoverBlobUrl(sharedThumbKey, persistedThumbUrl);
          pdfThumbCacheSet(ck, persistedThumbUrl);
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(persistedThumbUrl);
          return persistedThumbUrl;
        }
        if (persistedSharedThumb?.size && wantsSharpPortal && !sharedThumb) {
          const persistedThumbUrl = URL.createObjectURL(persistedSharedThumb);
          rememberHoverBlobUrl(sharedThumbKey, persistedThumbUrl);
          pdfThumbCacheSet(ck, persistedThumbUrl);
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(persistedThumbUrl);
        }
        const cachedBlobUrl = skipCachedThumb ? undefined : pdfThumbCacheGet(ck);
        if (cachedBlobUrl && !wantsSharpPortal) {
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(cachedBlobUrl);
          return cachedBlobUrl;
        }
        // Native/local path: persisted jpg thumb ho to PDF bytes read ki zaroorat nahi.
        if (isCapacitorNativeApp() && !wantsSharpPortal) {
          const { getNativePdfThumbnailDisplayUrl } = await import("@/lib/pdfToImage");
          const nativeThumb = await getNativePdfThumbnailDisplayUrl(ck);
          if (nativeThumb) {
            pdfThumbCacheSet(ck, nativeThumb);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(nativeThumb);
            return nativeThumb;
          }
        }
        // Existing in-flight promise reuse — same key par dobara heavy render/fetch mat chalao.
        const existingInflight = pdfThumbInFlight.get(ck);
        if (existingInflight) {
          const reused = await existingInflight;
          if (reused) {
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(reused);
          }
          return reused;
        }

        setIsPdfLoading(true);
        const job = (async (): Promise<string | null> => {
          let pdfFile: File | ArrayBuffer | Blob;

          if (fileObject instanceof File) {
            pdfFile = fileObject;
          } else if (firebaseStoragePath && storage && !localLedgerOnly) {
          // Pehle signed URL → SDK+fetch helper (CORS + naya `*.firebasestorage.app` host); phir direct getBlob — sirf getBlob+5s pe web "online" preview fail hota tha.
            let resolved: Blob | null = null;
            if (pdfUrl.startsWith("http")) {
            // Pehle warm-sync IndexedDB; phir SDK/getBlob path (helper se bytes background cache)
              resolved =
                (await tryOfflineCachedAttachmentBlobMultiKey(pdfUrl)) ||
                (await getRemoteAttachmentBlobPreferOfflineCache(pdfUrl, signal, {
                  localOnly: localLedgerOnly,
                  companyId: pathCompanyId,
                  explicitUserRequest: stableLocalPreviewOnly,
                  bypassVisiblePageCheck: stableLocalPreviewOnly,
                }));
            }
            if (!resolved && !isPocketBaseOnlyAppSession()) {
              try {
                const storageRef = ref(storage, firebaseStoragePath);
                resolved = await Promise.race([
                  getBlob(storageRef),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("Storage getBlob timeout")), PDF_REMOTE_FETCH_TIMEOUT_MS)
                  ),
                ]);
              } catch {
                resolved = null;
              }
            }
            // Signed download URL ab bhi kaam kar sakta hai jab getBlob/rules fail — bina iske hover me sirf lal PDF icon
            if (!resolved && pdfUrl.startsWith("http") && !isPocketBaseOnlyAppSession()) {
              try {
                resolved = await fetchBlobWithTimeout(pdfUrl, PDF_REMOTE_FETCH_TIMEOUT_MS, signal);
              } catch {
                resolved = null;
              }
            }
            if (!resolved) {
              setIsPdfLoading(false);
              return null;
            }
            pdfFile = resolved;
          } else if (pdfUrl.startsWith("blob:")) {
            const response = await fetch(pdfUrl, { signal });
            pdfFile = await response.blob();
          } else if (pdfUrl.startsWith(LOCAL_FILE_PREFIX)) {
            // APK edit voucher: `local:` PDF thumb — cache miss pe bhi bytes resolve karke raster banao
            // (pehle Cap early-return → sirf red PDF icon; preview nahi).
            const cid = String(pathCompanyId || voucherAttachmentFb?.companyId || "").trim();
            let blob = await getBlobFromLocalFileRef(pdfUrl, cid ? { companyId: cid } : undefined);
            if ((!blob || blob.size <= 0) && cid) {
              try {
                const { fetchPlServerAttachmentBlob } = await import("@/lib/plServerAttachmentFetch");
                blob = (await fetchPlServerAttachmentBlob(cid, pdfUrl, signal)) ?? null;
              } catch {
                blob = null;
              }
            }
            if (!blob || blob.size <= 0) {
              setIsPdfLoading(false);
              return null;
            }
            pdfFile = blob;
          } else if (isPbAttachmentRef(pdfUrl)) {
            const blob =
              (await tryOfflineCachedAttachmentBlobMultiKey(pdfUrl)) ||
              (await fetchPbAttachmentBlob(pdfUrl));
            if (!blob || blob.size <= 0) {
              setIsPdfLoading(false);
              return null;
            }
            pdfFile = blob;
          } else if (pdfUrl.startsWith("data:")) {
            // Local unassigned gallery: PDF `localStorage` me data URL — pehle yahan branch na thi to sirf lal PDF icon
            const response = await fetch(pdfUrl, { signal });
            pdfFile = await response.blob();
          } else if (pdfUrl.startsWith("http")) {
            // Warm cache → SDK/fetch (timeout wala fallback jab helper null)
            const hydrated =
              (await tryOfflineCachedAttachmentBlobMultiKey(pdfUrl)) ||
              (await getRemoteAttachmentBlobPreferOfflineCache(pdfUrl, signal, {
                localOnly: localLedgerOnly,
                companyId: pathCompanyId,
                explicitUserRequest: stableLocalPreviewOnly,
                bypassVisiblePageCheck: stableLocalPreviewOnly,
              }));
            pdfFile =
              hydrated && hydrated.size > 0
                ? hydrated
                : localLedgerOnly
                  ? null
                  : await fetchBlobWithTimeout(pdfUrl, PDF_REMOTE_FETCH_TIMEOUT_MS, signal);
            if (!pdfFile) {
              setIsPdfLoading(false);
              return null;
            }
          } else {
            setIsPdfLoading(false);
            return null;
          }

          if (signal?.aborted) return null;

          const { convertPdfFirstPageToImage } = await import("@/lib/pdfToImage");
          const result = wantsSharpPortal
            ? await convertPdfFirstPageToImage(pdfFile, 0.92, 1800, { signal })
            : await convertPdfFirstPageToImage(
                pdfFile,
                0.85,
                layoutMaxEdge > 150 ? 800 : 600,
                { signal }
              );

          if (signal?.aborted) {
            revokeThumbnailUrl(result.thumbnailUrl);
            return null;
          }
          let finalThumbUrl = result.thumbnailUrl;
          // Native/APK: generated thumb ko DataDirectory me persist karo, agle render me direct path load ho.
          if (isCapacitorNativeApp() && !wantsSharpPortal) {
            const { saveNativePdfThumbnail } = await import("@/lib/pdfToImage");
            const persistedUrl = await saveNativePdfThumbnail(ck, result.thumbnailBlob);
            if (persistedUrl) {
              try {
                URL.revokeObjectURL(result.thumbnailUrl);
              } catch {
                /* ignore */
              }
              finalThumbUrl = persistedUrl;
            }
          }
          pdfThumbCacheSet(ck, finalThumbUrl);
          if (wantsSharpPortal) {
            rememberHoverBlobUrl(portalKey, finalThumbUrl);
            void seedOfflineAttachmentCacheFromBlob(portalKey, result.thumbnailBlob);
          } else {
            rememberHoverBlobUrl(sharedThumbKey, finalThumbUrl);
            badPdfThumbCacheKeysRef.current.delete(sharedThumbKey);
            void seedOfflineAttachmentCacheFromBlob(sharedThumbKey, result.thumbnailBlob);
            if (!peekHoverCachedBlobUrl(portalKey)) {
              void convertPdfFirstPageToImage(pdfFile, 0.92, 1800, { signal })
                .then((full) => {
                  rememberHoverBlobUrl(portalKey, full.thumbnailUrl);
                  void seedOfflineAttachmentCacheFromBlob(portalKey, full.thumbnailBlob);
                })
                .catch(() => undefined);
            }
          }
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(finalThumbUrl);
          return finalThumbUrl;
        })();
        pdfThumbInFlight.set(ck, job);
        try {
          return await job;
        } finally {
          pdfThumbInFlight.delete(ck);
        }
      };

      try {
        await Promise.race([run(), timeoutPromise]);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        setPdfThumbnailSafe(null);
      } finally {
        setIsPdfLoading(false);
      }
    },
    [
      layoutMaxEdge,
      pathCompanyId,
      voucherAttachmentFb?.companyId,
      revokeThumbnailUrl,
      setPdfThumbnailSafe,
      localLedgerOnly,
      stableLocalPreviewOnly,
    ]
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let pdfThumbDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    let fileObject: File | null = null;

    const processFile = async () => {
      // Decode-on-read: effect ke andar bhi normalized file value use karo.
      const file = normalizedPreviewFile;
      const painted = fileInfoRef.current;
      if (
        typeof file === "string" &&
        painted.url &&
        !isUnresolvedAttachmentPreviewUrl(painted.url) &&
        painted.type !== "other"
      ) {
        // Gallery remount / fileLoadStatus churn: painted URL pehle se hai — full re-resolve mat.
        // PDF thumb miss (abort ke baad) → schedule regenerate; image → verify blob still usable.
        const paintedUrlOk =
          !painted.url.startsWith("blob:") ||
          (await isUsableWarmedAttachmentDisplayUrl(painted.url));
        if (!paintedUrlOk) {
          // Revoked blob — neeche full resolve.
        } else if (painted.type === "pdf") {
          setIsLoading(false);
          const edge = Math.max(layoutW, layoutH);
          const pdfThumbSource =
            isLocalFileRef(file) || getAttachmentFormatLabel(file) === "PDF" ? file : painted.url;
          const ck = pdfThumbCacheKey(
            undefined,
            pdfThumbSource,
            resolvedStoragePath,
            edge
          );
          const sharedThumb = peekHoverCachedBlobUrl(sharedPdfCellThumbKey(pdfThumbSource));
          const portalThumb = peekHoverCachedBlobUrl(sharedPdfPortalThumbKey(pdfThumbSource));
          if (edge >= GALLERY_PDF_HOVER_THUMB_EDGE && portalThumb) {
            pdfThumbCacheSet(ck, portalThumb);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(portalThumb);
            return;
          }
          if (edge < GALLERY_PDF_HOVER_THUMB_EDGE && portalThumb) {
            pdfThumbCacheSet(ck, portalThumb);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(portalThumb);
            return;
          }
          if (sharedThumb && edge < GALLERY_PDF_HOVER_THUMB_EDGE) {
            pdfThumbCacheSet(ck, sharedThumb);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(sharedThumb);
            return;
          }
          if (sharedThumb && edge >= GALLERY_PDF_HOVER_THUMB_EDGE) {
            pdfThumbCacheSet(ck, sharedThumb);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(sharedThumb);
            // Fall through to regenerate portal-quality below.
          } else {
          const persistedSharedThumb = await tryOfflineCachedAttachmentBlobMultiKey(sharedPdfCellThumbKey(pdfThumbSource));
          if (persistedSharedThumb?.size && edge < GALLERY_PDF_HOVER_THUMB_EDGE) {
            const persistedThumbUrl = URL.createObjectURL(persistedSharedThumb);
            rememberHoverBlobUrl(sharedPdfCellThumbKey(pdfThumbSource), persistedThumbUrl);
            pdfThumbCacheSet(ck, persistedThumbUrl);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(persistedThumbUrl);
            return;
          }
          const cached = pdfThumbCacheGet(ck);
          if (cached && edge < GALLERY_PDF_HOVER_THUMB_EDGE) {
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(cached);
            return;
          }
          }
          if (!controller.signal.aborted) {
            pdfThumbDebounceTimer = setTimeout(() => {
              if (!controller.signal.aborted) {
                generatePdfThumbnail(pdfThumbSource, undefined, resolvedStoragePath, controller.signal);
              }
            }, 120);
          }
          return;
        } else {
          setIsLoading(false);
          return;
        }
      }
      if (typeof file === "string") {
        const wantsSharpPdf = layoutMaxEdge >= GALLERY_PDF_HOVER_THUMB_EDGE;
        const sharedCellThumb =
          (wantsSharpPdf ? peekHoverCachedBlobUrl(sharedPdfPortalThumbKey(file)) : undefined) ||
          peekHoverCachedBlobUrl(sharedAttachmentCellThumbKey(file)) ||
          peekHoverCachedBlobUrl(sharedPdfCellThumbKey(file));
        if (
          sharedCellThumb &&
          !controller.signal.aborted &&
          (await isUsableWarmedAttachmentDisplayUrl(sharedCellThumb)) &&
          // Raw PDF blob under a thumb key (pending local: seed) => not an image; fall through to PDF raster path.
          !(await isNonImageBlobObjectUrl(sharedCellThumb))
        ) {
          const lbl = getAttachmentFormatLabel(file);
          const hintKind = getAttachmentPreviewKindFromHints(sourceFileName, contentType);
          const thumbType =
            hintKind === "pdf" || lbl === "PDF" ? "pdf" : "image";
          setFileInfo({
            url: thumbType === "pdf" ? file : sharedCellThumb,
            type: thumbType,
            name:
              isLocalFileRef(file) || file.startsWith(LOCAL_FILE_PREFIX)
                ? "Attachment"
                : file.split("/").pop()?.split("?")[0] || "file",
            size: pickAttachmentByteSize(fileSize),
            formatLabel: thumbType === "pdf" ? "PDF" : lbl === "FILE" || lbl === "OTHER" ? "IMAGE" : lbl || "IMAGE",
          });
          if (thumbType === "pdf") {
            const ck = pdfThumbCacheKey(undefined, file, resolvedStoragePath, layoutMaxEdge);
            pdfThumbCacheSet(ck, sharedCellThumb);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(sharedCellThumb);
          }
          setIsLoading(false);
          // Large PDF preview: cell thumb is only an instant placeholder — keep resolving the
          // portal-quality raster unless it is already the cached portal image.
          const alreadySharp =
            sharedCellThumb === peekHoverCachedBlobUrl(sharedPdfPortalThumbKey(file));
          if (thumbType === "pdf" && wantsSharpPdf && !alreadySharp) {
            pdfThumbDebounceTimer = setTimeout(() => {
              if (!controller.signal.aborted) {
                generatePdfThumbnail(file, undefined, resolvedStoragePath, controller.signal);
              }
            }, 120);
          }
          return;
        }
        const warmed = peekHoverCachedBlobUrl(file);
        // `local:` + revoked blob: early paint → broken img + alt=`local:uuid` (masters Edit Party).
        // Sirf usable warmed URL pe short-circuit; warna full resolve (PL staff fetch).
        if (warmed && !controller.signal.aborted && (await isUsableWarmedAttachmentDisplayUrl(warmed))) {
          let warmedType: "image" | "pdf" | "other" = "image";
          const lbl = getAttachmentFormatLabel(file);
          const hintKind = getAttachmentPreviewKindFromHints(sourceFileName, contentType);
          if (hintKind === "pdf" || lbl === "PDF" || file.toLowerCase().includes(".pdf")) {
            warmedType = "pdf";
          } else if (hintKind === "image") {
            warmedType = "image";
          } else if (isLocalFileRef(file) && (lbl === "FILE" || lbl === "OTHER" || !lbl)) {
            // local: extension nahi — sniff se type; default image mat (PDF masters broken).
            try {
              const probe = await fetch(warmed).then((r) => r.blob());
              const kind = await sniffBlobKindForPreview(probe);
              if (kind === "pdf") warmedType = "pdf";
              else if (kind === "image") warmedType = "image";
              else warmedType = "other";
            } catch {
              warmedType = "other";
            }
          }
          if (warmedType !== "other") {
            setFileInfo({
              url: warmed,
              type: warmedType,
              name:
                isLocalFileRef(file) || file.startsWith(LOCAL_FILE_PREFIX)
                  ? "Attachment"
                  : file.split("/").pop()?.split("?")[0] || "file",
              size: pickAttachmentByteSize(fileSize),
              formatLabel: warmedType === "pdf" ? "PDF" : lbl === "FILE" || lbl === "OTHER" ? "IMAGE" : lbl || "IMAGE",
            });
            setIsLoading(false);
            if (warmedType === "pdf") {
              pdfThumbDebounceTimer = setTimeout(() => {
                if (!controller.signal.aborted) {
                  generatePdfThumbnail(warmed, undefined, resolvedStoragePath, controller.signal);
                }
              }, 120);
            }
            return;
          }
          forgetHoverBlobUrl(file, warmed);
        } else if (warmed) {
          forgetHoverBlobUrl(file, warmed);
        }
        if (isLocalFileRef(file)) {
          const persistedPdfThumb = await tryOfflineCachedAttachmentBlobMultiKey(sharedPdfCellThumbKey(file));
          if (persistedPdfThumb?.size) {
            const thumbUrl = URL.createObjectURL(persistedPdfThumb);
            rememberHoverBlobUrl(sharedPdfCellThumbKey(file), thumbUrl);
            const ck = pdfThumbCacheKey(undefined, file, resolvedStoragePath, layoutMaxEdge);
            pdfThumbCacheSet(ck, thumbUrl);
            pdfThumbnailKeyRef.current = ck;
            setPdfThumbnailSafe(thumbUrl);
            setFileInfo({
              url: file,
              type: "pdf",
              name: "Attachment",
              size: pickAttachmentByteSize(fileSize, persistedPdfThumb),
              formatLabel: "PDF",
            });
            setIsLoading(false);
            return;
          }
          const cachedBlob = await tryOfflineCachedAttachmentBlobMultiKey(file);
          if (cachedBlob?.size) {
            const kind = await sniffBlobKindForPreview(cachedBlob);
            if (kind === "image") {
              const typed =
                cachedBlob.type?.startsWith("image/") && cachedBlob.type !== "application/octet-stream"
                  ? cachedBlob
                  : new Blob([await cachedBlob.arrayBuffer()], { type: "image/jpeg" });
              objectUrl = URL.createObjectURL(typed);
              rememberHoverBlobUrl(file, objectUrl);
              rememberHoverBlobUrl(sharedPdfCellThumbKey(file), objectUrl);
              setFileInfo({
                url: objectUrl,
                type: "image",
                name: "Attachment",
                size: pickAttachmentByteSize(fileSize, cachedBlob),
                formatLabel: getAttachmentFormatLabel(file) === "FILE" ? "JPEG" : getAttachmentFormatLabel(file),
              });
              setIsLoading(false);
              return;
            }
            if (kind === "pdf") {
              const pdfBlob =
                cachedBlob.type === "application/pdf"
                  ? cachedBlob
                  : new Blob([await cachedBlob.arrayBuffer()], { type: "application/pdf" });
              objectUrl = URL.createObjectURL(pdfBlob);
              rememberHoverBlobUrl(file, objectUrl);
              setFileInfo({
                url: objectUrl,
                type: "pdf",
                name: "Attachment",
                size: pickAttachmentByteSize(fileSize, cachedBlob),
                formatLabel: "PDF",
              });
              setIsLoading(false);
              pdfThumbDebounceTimer = setTimeout(() => {
                if (!controller.signal.aborted) {
                  generatePdfThumbnail(file, undefined, resolvedStoragePath, controller.signal);
                }
              }, 0);
              return;
            }
          }
        }
      }
      let resolvedUrl: string | null = null;
      let resolvedType: "image" | "pdf" | "other" = "other";
      let resolvedName = "file";
      let resolvedSize: number | null = fileSize ?? null;
      let localFormatHint: string | null = null;

      try {
      /** EXE/APK: disk/SQLite cache pehle — spinner + HTTPS fetch avoid (online company bhi). */
      if (typeof file === "string" && preferLocalAttachmentFirst) {
        try {
          const staticResolved = await resolveStaticAttachmentDisplay(file, {
            localLedgerOnly,
            companyMode: attachmentMode,
            signal: controller.signal,
            companyId: pathCompanyId,
          });
          if (staticResolved.displayUrl || (staticResolved.blob && staticResolved.blob.size > 0)) {
            if (staticResolved.displayUrl) {
              resolvedUrl = staticResolved.displayUrl;
            } else if (staticResolved.blob) {
              objectUrl = URL.createObjectURL(staticResolved.blob);
              resolvedUrl = objectUrl;
            }
            const nativeCt = String(staticResolved.contentType || contentType || "").toLowerCase();
            try {
              resolvedName = decodeURIComponent(file.split("/").pop()?.split("?")[0] || "file");
            } catch {
              resolvedName = file.split("/").pop()?.split("?")[0] || "file";
            }
            if (sourceFileName?.trim()) {
              try {
                resolvedName = decodeURIComponent(String(sourceFileName).trim());
              } catch {
                resolvedName = String(sourceFileName).trim();
              }
            }
            const lbl = getAttachmentFormatLabel(file);
            const hintKind = getAttachmentPreviewKindFromHints(sourceFileName, contentType || staticResolved.contentType);
            const cleanUrl = file.split("?")[0].toLowerCase();
            if (nativeCt.includes("pdf") || hintKind === "pdf") resolvedType = "pdf";
            else if (nativeCt.startsWith("image/") || hintKind === "image") resolvedType = "image";
            else if (lbl === "PDF" || cleanUrl.endsWith(".pdf") || cleanUrl.includes(".pdf")) {
              resolvedType = "pdf";
            } else if (
              ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF"].includes(lbl) ||
              cleanUrl.match(/\.(jpe?g|jfif|gif|png|webp|bmp|svg|heic|heif|avif|tiff?)(\?|$)/i)
            ) {
              resolvedType = "image";
            }
            // `local:uuid` + octet-stream: sniff before early-return (gallery PDF otherwise stuck as FILE).
            if (resolvedType === "other" && staticResolved.blob && staticResolved.blob.size > 0) {
              const kind = await sniffBlobKindForPreview(staticResolved.blob);
              if (kind === "pdf") resolvedType = "pdf";
              else if (kind === "image") resolvedType = "image";
            }
            let formatLabel =
              getAttachmentFormatLabelFromHints(sourceFileName, contentType || staticResolved.contentType) ||
              getAttachmentFormatLabel(file);
            if (resolvedType === "pdf") formatLabel = "PDF";
            else if (resolvedType === "image" && (formatLabel === "FILE" || formatLabel === "OTHER")) {
              formatLabel = "IMAGE";
            }
            if (resolvedUrl?.startsWith("blob:") || resolvedUrl?.startsWith("data:")) {
              rememberHoverBlobUrl(file, resolvedUrl);
            }
            resolvedSize = pickAttachmentByteSize(resolvedSize, fileSize, staticResolved.blob);
            setFileInfo({
              url: resolvedUrl,
              type: resolvedType,
              name:
                resolvedName.startsWith(LOCAL_FILE_PREFIX) || isLocalFileRef(resolvedName)
                  ? "Attachment"
                  : resolvedName,
              size: resolvedSize,
              formatLabel,
            });
            setIsLoading(false);
            if (resolvedType === "pdf" && resolvedUrl) {
              pdfThumbDebounceTimer = setTimeout(() => {
                if (!controller.signal.aborted) {
                  // blob: pehle — local: pe dubara IDB read avoid (gallery 20 tiles).
                  const pdfSrc =
                    resolvedUrl!.startsWith("blob:") || resolvedUrl!.startsWith("data:")
                      ? resolvedUrl!
                      : file;
                  generatePdfThumbnail(pdfSrc, undefined, resolvedStoragePath, controller.signal);
                }
              }, 120);
            }
            return;
          }
        } catch {
          /* cache miss — legacy branches */
        }
        if (
          typeof file === "string" &&
          isLocalFileRef(file) &&
          pathCompanyId &&
          !controller.signal.aborted
        ) {
          try {
            const { resolvePlServerStaffAttachmentPreviewBlob, canFetchPlServerAttachmentForCompany } =
              await import("@/lib/plServerAttachmentFetch");
            if (canFetchPlServerAttachmentForCompany(pathCompanyId)) {
              const remoteBlob = await resolvePlServerStaffAttachmentPreviewBlob(file, {
                companyId: pathCompanyId,
                signal: controller.signal,
              });
              if (remoteBlob && remoteBlob.size > 0) {
                objectUrl = URL.createObjectURL(remoteBlob);
                rememberHoverBlobUrl(file, objectUrl);
                resolvedUrl = objectUrl;
                resolvedSize = pickAttachmentByteSize(resolvedSize, fileSize, remoteBlob);
                const kind = await sniffBlobKindForPreview(remoteBlob);
                if (kind === "pdf") resolvedType = "pdf";
                else if (kind === "image") resolvedType = "image";
                try {
                  resolvedName = decodeURIComponent(file.split("/").pop()?.split("?")[0] || "file");
                } catch {
                  resolvedName = file.split("/").pop()?.split("?")[0] || "file";
                }
                let formatLabel = getAttachmentFormatLabel(file);
                if (resolvedType === "pdf") formatLabel = "PDF";
                else if (resolvedType === "image") formatLabel = "IMAGE";
                setFileInfo({
                  url: resolvedUrl,
                  type: resolvedType,
                  name: resolvedName.startsWith(LOCAL_FILE_PREFIX) ? "Attachment" : resolvedName,
                  size: resolvedSize,
                  formatLabel,
                });
                setIsLoading(false);
                if (resolvedType === "pdf" && resolvedUrl) {
                  pdfThumbDebounceTimer = setTimeout(() => {
                    if (!controller.signal.aborted) {
                      generatePdfThumbnail(resolvedUrl!, undefined, resolvedStoragePath, controller.signal);
                    }
                  }, 120);
                }
                return;
              }
            }
          } catch {
            /* pl server early fetch */
          }
        }
      }

      setIsLoading(true);

      if (typeof file === "string") {
        if ((/^https?:\/\//i.test(file) || isPbAttachmentRef(file)) && !file.startsWith(LOCAL_FILE_PREFIX)) {
          const staticResolved = await resolveStaticAttachmentDisplay(file, {
            localLedgerOnly,
            companyMode: attachmentMode,
            signal: controller.signal,
            companyId: pathCompanyId,
          });
          let nativeCt = String(staticResolved.contentType || "").toLowerCase();
          if (staticResolved.displayUrl) {
            resolvedUrl = staticResolved.displayUrl;
          } else if (staticResolved.blob && staticResolved.blob.size > 0) {
            objectUrl = URL.createObjectURL(staticResolved.blob);
            resolvedUrl = objectUrl;
          } else if (
            typeof navigator !== "undefined" &&
            navigator.onLine &&
            usesEmbeddedNativeAttachmentStorage() &&
            !localLedgerOnly
          ) {
            resolvedUrl = file;
          } else {
            resolvedUrl = null;
          }
          try {
            resolvedName = decodeURIComponent(file.split("/").pop()?.split("?")[0] || "file");
          } catch {
            resolvedName = file.split("/").pop()?.split("?")[0] || "file";
          }
          const lbl = getAttachmentFormatLabel(file);
          const cleanUrl = file.split("?")[0].toLowerCase();
          if (nativeCt.includes("pdf")) {
            resolvedType = "pdf";
          } else if (nativeCt.startsWith("image/")) {
            resolvedType = "image";
          } else if (lbl === "PDF" || cleanUrl.endsWith(".pdf") || cleanUrl.includes(".pdf")) {
            resolvedType = "pdf";
          } else if (
            ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF"].includes(lbl) ||
            cleanUrl.match(/\.(jpeg|jpg|jfif|gif|png|webp|bmp|svg|heic|heif|avif|tiff?)(\?|$)/)
          ) {
            resolvedType = "image";
          } else {
            resolvedType = "image";
          }
          let formatLabel = getAttachmentFormatLabel(file);
          if (resolvedType === "pdf") formatLabel = "PDF";
          else if (resolvedType === "image" && (formatLabel === "FILE" || formatLabel === "OTHER"))
            formatLabel = "IMAGE";

          if (!resolvedUrl && resolvedType === "image") {
            resolvedType = "other";
            logAttachmentPreviewDowngradeToGenericFile(
              "https_branch_labeled_image_but_no_blob_or_native_displayUrl",
              file,
              resolvedUrl,
              resolvedType,
              { localLedgerOnly }
            );
          }

          logFilePreviewForensic("https_url_branch_first_paint", {
            originalFile: file,
            resolvedUrl,
            resolvedType,
            localLedgerOnly,
          });

          resolvedSize = pickAttachmentByteSize(resolvedSize, fileSize, staticResolved.blob);

          setFileInfo({
            url: resolvedUrl,
            type: resolvedType,
            name: resolvedName,
            size: resolvedSize,
            formatLabel,
          });
          setIsLoading(false);

          // `pbatt:` / https PDF: this branch returns before the shared generatePdfThumbnail
          // call. Probe below also skips PocketBase (localLedgerOnly + Firebase cache helper),
          // so tile stayed on the red PDF icon. Raster from bytes we already have, else fetch.
          if (resolvedType === "pdf") {
            const PDF_THUMB_DEBOUNCE_MS = 120;
            pdfThumbDebounceTimer = setTimeout(() => {
              if (controller.signal.aborted) return;
              const blob = staticResolved.blob;
              const asFile =
                blob && blob.size > 0
                  ? new File(
                      [blob],
                      resolvedName.toLowerCase().endsWith(".pdf") ? resolvedName : `${resolvedName || "file"}.pdf`,
                      { type: blob.type || "application/pdf" }
                    )
                  : undefined;
              void generatePdfThumbnail(file, asFile, resolvedStoragePath, controller.signal);
            }, PDF_THUMB_DEBOUNCE_MS);
          }

          // Web: inline peek (dedicated effect bhi chalta hai) — warm path skip cover.
          if (!resolvedSize && typeof file === "string") {
            void (async () => {
              const peeked = await peekRemoteAttachmentByteSize(file, {
                signal: controller.signal,
                storagePath: resolvedStoragePath,
                companyId: pathCompanyId,
                allowHttpPeek: !localLedgerOnly,
              });
              if (!peeked || controller.signal.aborted) return;
              setFileInfo((prev) => ({
                ...prev,
                size: pickAttachmentByteSize(prev.size, peeked),
              }));
            })();
          }

          // Sniff/cache later: first paint fast rakho, phir background me disk cache hydrate karke offline-safe blob URL par swap karo.
          void (async () => {
            try {
              // 1) Offline/restart fast fallback: pehle local cache read try.
              let probe = await getOfflineCachedAttachmentBlob(file);
              // 2) Cache miss + online: network se hydrate (EXE/APK). Web browser: tile mount pe
              //    full Firebase download mat — Files tick ON hone se bhi (edit save hang / refresh stall).
              const webLazyNoNetwork = shouldUseAttachmentLazyLoad(company);
              if (
                (!probe || probe.size === 0) &&
                !localLedgerOnly &&
                !webLazyNoNetwork &&
                !controller.signal.aborted &&
                typeof navigator !== "undefined" &&
                (navigator.onLine || isCapacitorNativeApp())
              ) {
                // Persist run ko component lifecycle se mat baandho; tile unmount ho tab bhi cache fill complete ho.
                probe = await getRemoteAttachmentBlobPreferOfflineCache(file, undefined, {
                  localOnly: localLedgerOnly,
                  companyId: pathCompanyId,
                });
              }
              if (!probe || probe.size === 0 || controller.signal.aborted) return;
              const probeSize = pickAttachmentByteSize(fileSize, probe);
              const kind = await sniffBlobKindForPreview(probe);
              if (controller.signal.aborted) return;
              if (kind === "pdf") {
                setFileInfo((prev) => ({
                  ...prev,
                  type: "pdf",
                  formatLabel: "PDF",
                  size: pickAttachmentByteSize(prev.size, probeSize),
                }));
                const PDF_THUMB_DEBOUNCE_MS = 120;
                pdfThumbDebounceTimer = setTimeout(() => {
                  if (!controller.signal.aborted) {
                    generatePdfThumbnail(file, undefined, resolvedStoragePath, controller.signal);
                  }
                }, PDF_THUMB_DEBOUNCE_MS);
              } else if (kind === "image") {
                // Web: https display URL rakhkar sirf size badge update — full blob URL swap mount storm avoid.
                if (webLazyNoNetwork) {
                  setFileInfo((prev) => ({
                    ...prev,
                    type: "image",
                    formatLabel:
                      prev.formatLabel === "FILE" || prev.formatLabel === "OTHER"
                        ? "IMAGE"
                        : prev.formatLabel,
                    size: pickAttachmentByteSize(prev.size, probeSize),
                  }));
                  return;
                }
                // Remote URL pe hi atke rehne se offline restart par image टूट सकती है; blob URL swap se stable preview.
                if (objectUrl) {
                  try {
                    URL.revokeObjectURL(objectUrl);
                  } catch {
                    /* ignore */
                  }
                }
                objectUrl = URL.createObjectURL(probe);
                setFileInfo((prev) => ({
                  ...prev,
                  type: "image",
                  formatLabel:
                    prev.formatLabel === "FILE" || prev.formatLabel === "OTHER"
                      ? "IMAGE"
                      : prev.formatLabel,
                  url: objectUrl,
                  size: pickAttachmentByteSize(prev.size, probeSize),
                }));
              } else if (probeSize != null) {
                setFileInfo((prev) => ({
                  ...prev,
                  size: pickAttachmentByteSize(prev.size, probeSize),
                }));
              }
            } catch {
              /* background sniff best-effort */
            }
          })();
          return;
        }
        const fileIsLocalRef = typeof file === "string" && isLocalFileRef(file);
        // `local:` + leftover storagePath → Firebase object-path branch mat; local bytes pehle.
        const isStorageObjectPath =
          !fileIsLocalRef &&
          !localLedgerOnly &&
          (looksLikeFirebaseStorageObjectPath(file, { companyId: pathCompanyId }) ||
            Boolean(
              resolvedStoragePath &&
                /^voucher-files\//i.test(resolvedStoragePath) &&
                typeof file === "string" &&
                !/^https?:\/\//i.test(file)
            ));
        resolvedUrl = isStorageObjectPath || fileIsLocalRef ? null : file;
        if (isStorageObjectPath) {
          try {
            // Broken relative path flicker avoid: raw `voucher-files/...` ko pehle offline cache/native ref se resolve karo.
            const nativeCached = usesEmbeddedNativeAttachmentStorage()
              ? await getOfflineCachedAttachmentNativeRef(file)
              : null;
            if (nativeCached?.displayUrl && !isUnresolvedAttachmentPreviewUrl(nativeCached.displayUrl)) {
              resolvedUrl = nativeCached.displayUrl;
              const ct = String(nativeCached.contentType || "").toLowerCase();
              if (ct.includes("pdf")) resolvedType = "pdf";
              else if (ct.startsWith("image/")) resolvedType = "image";
            } else {
              // Raw object-path (`voucher-files/...`) ke liye cache miss par SDK fetch + cache write try karo.
              const fetchKey = resolvedStoragePath || file;
              let cachedBlob = await tryOfflineCachedAttachmentBlobMultiKey(fetchKey);
              if ((!cachedBlob || cachedBlob.size === 0) && !controller.signal.aborted && !localLedgerOnly) {
                cachedBlob = await getRemoteAttachmentBlobPreferOfflineCache(fetchKey, controller.signal, {
                  localOnly: localLedgerOnly,
                });
              }
              if (cachedBlob && cachedBlob.size > 0) {
                const kind = await sniffBlobKindForPreview(cachedBlob);
                if (kind === "image" || kind === "pdf") {
                  objectUrl = URL.createObjectURL(cachedBlob);
                  resolvedUrl = objectUrl;
                  resolvedType = kind;
                }
              }
            }
          } catch {
            /* cache miss; keep fallback flow */
          }
          logFilePreviewForensic("object_path_branch_result", {
            originalFile: file,
            resolvedUrl,
            resolvedType,
            isStorageObjectPath,
          });
        }
        // blob: — URL extension/label PDF nahi batata; fetch + MIME ya %PDF header (local voucher hover fix)
        if (file.startsWith("blob:")) {
          try {
            const b = await fetch(file).then((r) => r.blob());
            const kind = await sniffBlobKindForPreview(b);
            if (kind === "pdf") resolvedType = "pdf";
            else if (kind === "image") resolvedType = "image";
          } catch {
            /* revoked / network — neeche URL-based fallback */
          }
        }
        /* `local:` — Native par direct file-path URL; web par putPendingFile blob URL / IDB / Host fetch. */
        if (file.startsWith(LOCAL_FILE_PREFIX)) {
          try {
            // Sync meta (EXE disk OR web IDB putPendingFile displayUrl) — spinner skip.
            const localMetaSync = getLocalFileRefMetaSync(file);
            const localMeta = localMetaSync || (await getLocalFileRefMeta(file));
            let b: Blob | null | undefined = null;
            if (localMeta?.displayUrl) {
              if (localMeta.fileName) {
                try {
                  resolvedName = decodeURIComponent(String(localMeta.fileName));
                } catch {
                  resolvedName = String(localMeta.fileName);
                }
              }
              const hintKind = getAttachmentPreviewKindFromHints(localMeta.fileName, localMeta.contentType);
              if (hintKind === "pdf" || (localMeta.contentType || "").toLowerCase().includes("pdf")) {
                resolvedType = "pdf";
              } else if (hintKind === "image" || (localMeta.contentType || "").toLowerCase().startsWith("image/")) {
                resolvedType = "image";
              }
              // Restore leftover: displayUrl kabhi raw Firebase path — paint mat, blob resolve.
              if (!isUnresolvedAttachmentPreviewUrl(localMeta.displayUrl)) {
                resolvedUrl = localMeta.displayUrl;
              }
              localFormatHint = getAttachmentFormatLabelFromHints(localMeta.fileName, localMeta.contentType);
              // Restore ke baad contentType kabhi octet-stream / restored_* name → FILE icon.
              // Bytes sniff karke IMAGE/PDF promote karo (displayUrl pehle se paint ho sake).
              if (resolvedType === "other") {
                try {
                  b = await getBlobFromLocalFileRef(file, {
                    companyId: pathCompanyId ?? voucherAttachmentFb?.companyId,
                  });
                  if (b && b.size > 0) {
                    const kind = await sniffBlobKindForPreview(b);
                    if (kind === "pdf") {
                      resolvedType = "pdf";
                      localFormatHint = "PDF";
                    } else if (kind === "image") {
                      resolvedType = "image";
                      objectUrl = URL.createObjectURL(b);
                      resolvedUrl = objectUrl;
                      rememberHoverBlobUrl(file, objectUrl);
                      localFormatHint =
                        getAttachmentFormatLabelFromHints(localMeta.fileName, b.type || localMeta.contentType) ||
                        "IMAGE";
                    }
                  }
                } catch {
                  /* keep displayUrl + other */
                }
              }
              if (isUnresolvedAttachmentPreviewUrl(resolvedUrl)) {
                const localResolved = await resolveLocalRefToBlobUrlForPreview(
                  file,
                  attachmentClientFileUrls,
                  pathCompanyId ?? voucherAttachmentFb?.companyId,
                  {
                    voucherId: voucherAttachmentFb?.voucherId,
                    clientFileUrls: attachmentClientFileUrls,
                    enabled: !localLedgerOnly,
                  }
                );
                b = localResolved.blob ?? b;
                if (b && b.size > 0) {
                  const kind = await sniffBlobKindForPreview(b);
                  objectUrl = localResolved.blobUrl || URL.createObjectURL(b);
                  resolvedUrl = objectUrl;
                  rememberHoverBlobUrl(file, objectUrl);
                  if (kind === "pdf") {
                    resolvedType = "pdf";
                    localFormatHint = "PDF";
                  } else if (kind === "image") {
                    resolvedType = "image";
                    localFormatHint =
                      getAttachmentFormatLabelFromHints(localMeta.fileName, b.type || localMeta.contentType) ||
                      localFormatHint ||
                      "IMAGE";
                  }
                } else if (
                  localResolved.blobUrl &&
                  !isUnresolvedAttachmentPreviewUrl(localResolved.blobUrl)
                ) {
                  resolvedUrl = localResolved.blobUrl;
                  rememberHoverBlobUrl(file, localResolved.blobUrl);
                  if (resolvedType === "other") {
                    resolvedType = localFormatHint === "PDF" ? "pdf" : "image";
                  }
                }
              }
            } else {
              // Offline cache + pending IndexedDB — `local:` ref ko browser preview ke liye blob URL me resolve karo.
              const localResolved = await resolveLocalRefToBlobUrlForPreview(
                file,
                attachmentClientFileUrls,
                pathCompanyId ?? voucherAttachmentFb?.companyId,
                {
                  voucherId: voucherAttachmentFb?.voucherId,
                  clientFileUrls: attachmentClientFileUrls,
                  enabled: !localLedgerOnly,
                }
              );
              b = localResolved.blob;
              const payload = b ? null : await getPendingPayloadForLocalRef(file);
              if (!b && payload?.blob) b = payload.blob;
              localFormatHint =
                getAttachmentFormatLabelFromHints(payload?.fileName, payload?.contentType) ||
                (b ? getAttachmentFormatLabelFromHints(null, b.type || null) : null);
              if (payload?.fileName) {
                try {
                  resolvedName = decodeURIComponent(String(payload.fileName));
                } catch {
                  resolvedName = String(payload.fileName);
                }
              }
              if (b && b.size > 0) {
                const kind = await sniffBlobKindForPreview(b);
                objectUrl = localResolved.blobUrl || URL.createObjectURL(b);
                resolvedUrl = objectUrl;
                rememberHoverBlobUrl(file, objectUrl);
                if (kind === "pdf") {
                  resolvedType = "pdf";
                } else if (kind === "image") {
                  resolvedType = "image";
                }
              } else if (
                localResolved.blobUrl &&
                !isUnresolvedAttachmentPreviewUrl(localResolved.blobUrl)
              ) {
                // Native displayUrl without blob — still paintable.
                resolvedUrl = localResolved.blobUrl;
                rememberHoverBlobUrl(file, localResolved.blobUrl);
                const lbl = getAttachmentFormatLabel(file);
                if (lbl === "PDF") resolvedType = "pdf";
                else resolvedType = "image";
              }
            }
          } catch {
            /* pending missing */
          }
          if (
            isUnresolvedAttachmentPreviewUrl(resolvedUrl) &&
            typeof file === "string" &&
            file.startsWith(LOCAL_FILE_PREFIX) &&
            (pathCompanyId || voucherAttachmentFb?.companyId) &&
            // Offline / local-restore company: Firebase/PL URL try mat karo — bytes disk/pending pe hone chahiye.
            !localLedgerOnly
          ) {
            try {
              const { fetchPlServerAttachmentBlob } = await import("@/lib/plServerAttachmentFetch");
              const cid = String(pathCompanyId || voucherAttachmentFb?.companyId || "").trim();
              const remoteBlob = await fetchPlServerAttachmentBlob(cid, file, controller.signal);
              if (remoteBlob && remoteBlob.size > 0 && !controller.signal.aborted) {
                objectUrl = URL.createObjectURL(remoteBlob);
                rememberHoverBlobUrl(file, objectUrl);
                resolvedUrl = objectUrl;
                const kind = await sniffBlobKindForPreview(remoteBlob);
                if (kind === "pdf") resolvedType = "pdf";
                else if (kind === "image") resolvedType = "image";
              }
            } catch {
              /* pl server attachment early fetch */
            }
          }
          if (typeof file === "string" && file.startsWith(LOCAL_FILE_PREFIX)) {
            logFilePreviewForensic("local_ref_branch_result", {
              originalFile: file,
              resolvedUrl,
              resolvedType,
            });
          }
        }
        // Drive ref: blob download karke preview type detect karo, taaki second device par bhi attachment dikh sake.
        if (isDriveFileRef(file)) {
          try {
            const driveCompanyId =
              String(pathCompanyId || voucherAttachmentFb?.companyId || "").trim() || undefined;
            // Offline preload cache → pending `local:` → Drive (turant preview / edit jaisa).
            const b =
              (await getRemoteAttachmentBlobPreferOfflineCache(file, controller.signal, {
                companyId: driveCompanyId,
              })) || (await getBlobFromLocalFileRef(file, { companyId: driveCompanyId }));
            if (b && b.size > 0) {
              const kind = await sniffBlobKindForPreview(b);
              if (kind === "pdf") resolvedType = "pdf";
              else if (kind === "image") {
                resolvedType = "image";
                objectUrl = URL.createObjectURL(b);
                resolvedUrl = objectUrl;
              } else {
                resolvedType = "other";
              }
              resolvedName = file.split("/").pop() || "file";
            }
          } catch {
            /* drive fetch fail — fallback remains generic */
          }
        }
        if (resolvedType === "other") {
          /** URL ma literal `.pdf` na ho (encoded path) — badge jaisa hi label se type (gallery mobile PDF open fix) */
          const lblEarly = getAttachmentFormatLabel(file);
          if (lblEarly === "PDF" || file.startsWith("data:application/pdf")) {
            resolvedType = "pdf";
          } else if (
            file.startsWith("data:image/") ||
            ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF"].includes(lblEarly)
          ) {
            resolvedType = "image";
          } else {
            const cleanUrl = file.split("?")[0].toLowerCase();
            if (cleanUrl.endsWith(".pdf")) {
              resolvedType = "pdf";
            } else if (cleanUrl.match(/\.(jpe?g|jfif|gif|png|webp|bmp|svg|heic|heif|avif|tiff?)(\?|$)/i)) {
              resolvedType = "image";
            }
          }
          /** HTTPS link: URL se type na nikle (query-only, encoded path, non-.pdf path) — sniff se PDF/image branch */
          if (resolvedType === "other" && /^https?:\/\//i.test(file)) {
            try {
              let probe: Blob | null = null;
              try {
                const r = await fetch(file, {
                  mode: "cors",
                  credentials: "omit",
                  signal: controller.signal,
                  headers: { Range: "bytes=0-16383" },
                });
                if ((r.ok || r.status === 206) && !controller.signal.aborted) {
                  probe = await r.blob();
                }
              } catch {
                /* Range/CORS — neeche pura blob */
              }
              if ((!probe || probe.size === 0) && !controller.signal.aborted) {
                // Warm-sync cache pehle; phir lamba fallback (full warm IndexedDB offline sniff)
                probe = await getRemoteAttachmentBlobPreferOfflineCache(file, controller.signal);
              }
              if ((!probe || probe.size === 0) && !controller.signal.aborted) {
                probe = await fetchBlobWithTimeout(file, PDF_REMOTE_FETCH_TIMEOUT_MS, controller.signal);
              }
              if (probe && probe.size > 0 && !controller.signal.aborted) {
                const kind = await sniffBlobKindForPreview(probe);
                if (kind === "pdf") {
                  resolvedType = "pdf";
                } else if (kind === "image") {
                  resolvedType = "image";
                  // Offline: `<Image src={https}>` fail; IndexedDB warm → pura blob; Range probe aksar kata hua JPEG
                  let imgBlob: Blob | null =
                    (await getRemoteAttachmentBlobPreferOfflineCache(file, controller.signal)) ||
                    probe;
                  if ((!imgBlob || imgBlob.size === 0) && !controller.signal.aborted) {
                    imgBlob = await fetchBlobWithTimeout(file, PDF_REMOTE_FETCH_TIMEOUT_MS, controller.signal);
                  }
                  if (imgBlob && imgBlob.size > 0 && !controller.signal.aborted) {
                    const imgKind = await sniffBlobKindForPreview(imgBlob);
                    if (imgKind === "image") {
                      objectUrl = URL.createObjectURL(imgBlob);
                      resolvedUrl = objectUrl;
                    }
                  }
                }
              }
            } catch {
              /* preview niche PDF path try nahi karega */
            }
          }
        }
        // `.jpg`/label se `image` ho gaya par HTTPS probe skip — `resolvedUrl` ab bhi remote; offline preview fix
        if (
          typeof file === "string" &&
          /^https?:\/\//i.test(file) &&
          resolvedType === "image" &&
          resolvedUrl === file
        ) {
          const navOn = typeof navigator !== "undefined" && navigator.onLine;
          // Electron online: remote URL pehle — tez decode; Capacitor online bhi (warm miss par background branch cover).
          if (navOn && isElectronDesktopApp()) {
            /* resolvedUrl === file unchanged */
          } else if (navOn && isCapacitorNativeApp()) {
            /* online APK: HTTPS first paint; offline case upar warmEarly se handle */
          } else {
            // Web offline / Capacitor offline jahan ab bhi raw URL bacha ho — sirf cache/blob, network mat
            try {
              const imgBlob =
                (await getOfflineCachedAttachmentBlob(file)) ||
                (navOn ? await getRemoteAttachmentBlobPreferOfflineCache(file, controller.signal) : null) ||
                (navOn ? await fetchBlobWithTimeout(file, PDF_REMOTE_FETCH_TIMEOUT_MS, controller.signal) : null);
              if (imgBlob && imgBlob.size > 0 && !controller.signal.aborted) {
                const imgKind = await sniffBlobKindForPreview(imgBlob);
                if (imgKind === "image") {
                  if (objectUrl) URL.revokeObjectURL(objectUrl);
                  objectUrl = URL.createObjectURL(imgBlob);
                  resolvedUrl = objectUrl;
                }
              }
            } catch {
              /* cache/network — icon fallback */
            }
          }
        }
        // Save ke turant baad: IndexedDB blob `syncPendingFiles` hata chuka ho, form abhi `local:` string dikhata ho — Firestore HTTPS se thumb restore (openAttachmentInApp jaisa).
        if (
          isUnresolvedAttachmentPreviewUrl(resolvedUrl) &&
          typeof file === "string" &&
          file.startsWith(LOCAL_FILE_PREFIX) &&
          voucherAttachmentFb?.companyId &&
          voucherAttachmentFb?.voucherId
        ) {
          try {
            const clientList =
              attachmentClientFileUrls ??
              (attachmentGallery?.urls && attachmentGallery.urls.length > 0
                ? [...attachmentGallery.urls]
                : undefined);
            const remote = await tryResolveRemoteUrlForStaleLocalAttachment(
              voucherAttachmentFb.companyId,
              voucherAttachmentFb.voucherId,
              file,
              clientList
            );
            let openUrl = remote && !isLocalFileRef(remote) ? remote : null;
            if (!openUrl && voucherAttachmentFb.interCompanyPeer) {
              const peerUrl = await tryResolveInterCompanyPeerAttachmentUrl({
                staleUrl: file,
                clientFileUrls: clientList,
                peerCompanyId: voucherAttachmentFb.interCompanyPeer.peerCompanyId,
                peerVoucherId: voucherAttachmentFb.interCompanyPeer.peerVoucherId,
              });
              if (peerUrl && !isLocalFileRef(peerUrl)) openUrl = peerUrl;
            }
            if (openUrl) {
              let probe: Blob | null = await tryOfflineCachedAttachmentBlobMultiKey(openUrl);
              const navOn =
                typeof navigator !== "undefined" &&
                (navigator.onLine || isCapacitorNativeApp() || isElectronDesktopApp());
              if ((!probe || probe.size === 0) && navOn && !localLedgerOnly && !controller.signal.aborted) {
                if (looksLikeFirebaseStorageDownloadUrl(openUrl)) {
                  probe = await tryGetBlobFromFirebaseStorageDownloadUrl(openUrl, controller.signal, {
                    companyId: voucherAttachmentFb.companyId,
                    explicitUserRequest: true,
                  });
                }
                if (!probe?.size) {
                  probe = await getRemoteAttachmentBlobPreferOfflineCache(openUrl, controller.signal, {
                    companyId: voucherAttachmentFb.companyId,
                    explicitUserRequest: true,
                  });
                }
              }
              if (probe && probe.size > 0 && !controller.signal.aborted) {
                void seedOfflineAttachmentCacheFromBlob(file, probe);
                void seedOfflineAttachmentCacheFromBlob(openUrl, probe);
                objectUrl = URL.createObjectURL(probe);
                resolvedUrl = objectUrl;
                const kind = await sniffBlobKindForPreview(probe);
                if (kind === "pdf") resolvedType = "pdf";
                else if (kind === "image") resolvedType = "image";
                else resolvedType = "other";
              }
              try {
                resolvedName = decodeURIComponent(openUrl.split("/").pop()?.split("?")[0] || "file");
              } catch {
                resolvedName = openUrl.split("/").pop()?.split("?")[0] || "file";
              }
            }
          } catch {
            /* stale-resolve best-effort */
          }
        }
        if (
          isUnresolvedAttachmentPreviewUrl(resolvedUrl) &&
          typeof file === "string" &&
          file.startsWith(LOCAL_FILE_PREFIX) &&
          (pathCompanyId || voucherAttachmentFb?.companyId)
        ) {
          try {
            const { fetchPlServerAttachmentBlob } = await import("@/lib/plServerAttachmentFetch");
            const cid = String(pathCompanyId || voucherAttachmentFb?.companyId || "").trim();
            const remoteBlob = await fetchPlServerAttachmentBlob(cid, file, controller.signal);
            if (remoteBlob && remoteBlob.size > 0 && !controller.signal.aborted) {
              objectUrl = URL.createObjectURL(remoteBlob);
              resolvedUrl = objectUrl;
              const kind = await sniffBlobKindForPreview(remoteBlob);
              if (kind === "pdf") resolvedType = "pdf";
              else if (kind === "image") resolvedType = "image";
            }
          } catch {
            /* pl server attachment best-effort */
          }
        }
        // Render safety: URL source null ho to image/pdf force na karo; warna voucher edit me broken thumbnail flicker hota hai.
        if (isUnresolvedAttachmentPreviewUrl(resolvedUrl)) {
          resolvedUrl = null;
          resolvedType = "other";
          logAttachmentPreviewDowngradeToGenericFile(
            "final_guard_resolvedUrl_null_force_type_other",
            file,
            null,
            "other",
            {
              typeofFile: typeof file === "string" ? "string" : "file",
            }
          );
        }
        try {
          resolvedName = decodeURIComponent(file.split("/").pop()?.split("?")[0] || "file");
        } catch (e) {
          console.error("Could not decode file name", e);
        }
      } else if (file instanceof File) {
        fileObject = file;
        objectUrl = URL.createObjectURL(file);
        resolvedUrl = objectUrl;
        resolvedName = file.name;
        resolvedSize = file.size;
        if (file.type.startsWith("image/")) {
          resolvedType = "image";
        } else if (file.type === "application/pdf") {
          resolvedType = "pdf";
        } else if (!file.type || file.type === "application/octet-stream") {
          // Naye pick / SQLite restore — kabhi `type` khali hota hai; %PDF se PDF branch
          const kind = await sniffBlobKindForPreview(file);
          if (kind === "pdf") resolvedType = "pdf";
          else if (kind === "image") resolvedType = "image";
        }
      }

      // `local:` / hints se asli JPEG-PDF label; warna URL/File helper
      let formatLabel = getAttachmentFormatLabel(typeof file === "string" ? file : file);
      if (localFormatHint) formatLabel = localFormatHint;
      const hintedKind = getAttachmentPreviewKindFromHints(
        resolvedName && resolvedName !== "file" ? resolvedName : null,
        localFormatHint === "PDF"
          ? "application/pdf"
          : isImageFormatLabel(localFormatHint)
            ? `image/${String(localFormatHint).toLowerCase().replace("jpg", "jpeg")}`
            : null
      );
      if (hintedKind && resolvedType === "other" && !isUnresolvedAttachmentPreviewUrl(resolvedUrl)) {
        resolvedType = hintedKind;
      }
      if (resolvedType === "pdf") formatLabel = "PDF";
      else if (resolvedType === "image" && (formatLabel === "FILE" || formatLabel === "IMAGE")) {
        formatLabel = localFormatHint || "IMAGE";
      }

      if (
        resolvedType === "other" &&
        fileInfoRef.current.url &&
        fileInfoRef.current.type !== "other" &&
        !controller.signal.aborted
      ) {
        setIsLoading(false);
        return;
      }

      setFileInfo({
        url: resolvedUrl,
        type: resolvedType,
        name:
          resolvedName.startsWith(LOCAL_FILE_PREFIX) || isLocalFileRef(resolvedName)
            ? "Attachment"
            : resolvedName,
        size: resolvedSize,
        formatLabel,
      });
      setIsLoading(false);

      logFilePreviewForensic("final_ui_state_after_setFileInfo", {
        originalFile: typeof file === "string" ? file : file.name,
        resolvedUrl,
        resolvedType,
        formatLabel,
        finalUiKind:
          resolvedType === "image" && resolvedUrl
            ? "image"
            : resolvedType === "pdf"
              ? "pdf"
              : !resolvedUrl
                ? "generic_FILE_or_null_url"
                : "other_non_image_pdf_with_url",
      });

      if (resolvedType === "pdf") {
        const pdfThumbSource =
          typeof file === "string" && (isLocalFileRef(file) || getAttachmentFormatLabel(file) === "PDF")
            ? file
            : resolvedUrl || "";
        const pdfCacheKey = pdfThumbCacheKey(
          fileObject instanceof File ? fileObject : undefined,
          pdfThumbSource,
          resolvedStoragePath,
          layoutMaxEdge
        );
        const portalPdfThumb = peekHoverCachedBlobUrl(sharedPdfPortalThumbKey(pdfThumbSource));
        const sharedPdfThumb = peekHoverCachedBlobUrl(sharedPdfCellThumbKey(pdfThumbSource));
        const persistedSharedPdfThumb =
          sharedPdfThumb || portalPdfThumb
            ? null
            : await tryOfflineCachedAttachmentBlobMultiKey(
                layoutMaxEdge >= GALLERY_PDF_HOVER_THUMB_EDGE
                  ? sharedPdfPortalThumbKey(pdfThumbSource)
                  : sharedPdfCellThumbKey(pdfThumbSource)
              );
        const preferPortal = layoutMaxEdge >= GALLERY_PDF_HOVER_THUMB_EDGE;
        const cachedPdfThumb =
          (preferPortal ? portalPdfThumb : null) ||
          sharedPdfThumb ||
          (!preferPortal ? portalPdfThumb : null) ||
          pdfThumbCacheGet(pdfCacheKey);
        if (cachedPdfThumb) {
          if (portalPdfThumb && preferPortal) pdfThumbCacheSet(pdfCacheKey, portalPdfThumb);
          else if (sharedPdfThumb && !preferPortal) pdfThumbCacheSet(pdfCacheKey, sharedPdfThumb);
          pdfThumbnailKeyRef.current = pdfCacheKey;
          setPdfThumbnailSafe(cachedPdfThumb);
        } else if (persistedSharedPdfThumb?.size) {
          const persistedThumbUrl = URL.createObjectURL(persistedSharedPdfThumb);
          rememberHoverBlobUrl(
            preferPortal ? sharedPdfPortalThumbKey(pdfThumbSource) : sharedPdfCellThumbKey(pdfThumbSource),
            persistedThumbUrl
          );
          pdfThumbCacheSet(pdfCacheKey, persistedThumbUrl);
          pdfThumbnailKeyRef.current = pdfCacheKey;
          setPdfThumbnailSafe(persistedThumbUrl);
        } else if (pdfThumbnailKeyRef.current === pdfCacheKey && thumbnailUrlRef.current) {
          // Same PDF ka thumb already visible hai; refresh/live-pull pass me icon fallback flash mat dikhao.
        } else if (typeof file === "string" && isLocalFileRef(file) && thumbnailUrlRef.current) {
          // Local refs par current good thumb hold karo; cache miss/live refresh generic flash/loop na banaye.
        } else {
          setPdfThumbnailSafe(null); // clear previous so loading shows for a different uncached PDF
        }
        // Rerender churn me turant regenerate mat karo; short debounce se duplicate work kam hota hai.
        const PDF_THUMB_DEBOUNCE_MS = 120;
        if (fileObject) {
          pdfThumbDebounceTimer = setTimeout(() => {
            if (!controller.signal.aborted) {
              generatePdfThumbnail(resolvedUrl!, fileObject!, undefined, controller.signal);
            }
          }, PDF_THUMB_DEBOUNCE_MS);
        } else if (resolvedUrl) {
          // resolvedStoragePath: voucher download URLs par getBlob (CORS se behtar)
          pdfThumbDebounceTimer = setTimeout(() => {
            if (!controller.signal.aborted) {
              generatePdfThumbnail(pdfThumbSource || resolvedUrl, undefined, resolvedStoragePath, controller.signal);
            }
          }, PDF_THUMB_DEBOUNCE_MS);
        }
      } else {
        setPdfThumbnailSafe(null);
      }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    processFile();

    // Purana 3s abort = thumbnail kaam karte PDF bhi cut; lamba safety net = sirf asli hang
    const timeoutId = setTimeout(() => controller.abort(), PDF_THUMBNAIL_EFFECT_HARD_ABORT_MS);

    return () => {
      clearTimeout(timeoutId);
      if (pdfThumbDebounceTimer) clearTimeout(pdfThumbDebounceTimer);
      controller.abort();
      // Shared hover LRU me jo blob hai usko revoke mat karo — Edit Party / masters dubara open
      // par revoked `blob:` → broken img + alt=`local:uuid` (open theek, preview toot).
      const revokeLater = objectUrl;
      if (revokeLater) {
        const fileKey =
          typeof normalizedPreviewFile === "string" ? String(normalizedPreviewFile).trim() : "";
        const cached = fileKey ? peekHoverCachedBlobUrl(fileKey) : undefined;
        if (cached !== revokeLater) {
          setTimeout(() => {
            try {
              URL.revokeObjectURL(revokeLater);
            } catch {
              /* ignore */
            }
          }, 0);
        }
      }
      const thumb = thumbnailUrlRef.current;
      if (thumb && !pdfThumbBlobIsCached(thumb)) revokeThumbnailUrl(thumb);
      thumbnailUrlRef.current = null;
      // Do NOT setPdfThumbnail(null) here — gallery page remount / fileLoadStatus churn
      // clears PDF thumbs then early-returns without regenerating (blank until full refresh).
    };
  }, [
    normalizedPreviewFile,
    fileSize,
    resolvedStoragePath,
    layoutW,
    layoutH,
    generatePdfThumbnail,
    setPdfThumbnailSafe,
    revokeThumbnailUrl,
    voucherAttachmentFbFingerprint,
    attachmentClientUrlsFingerprint,
    attachmentGalleryFingerprint,
    pathCompanyId,
    attachmentCompanyId,
    fileLoadStatus,
    attachmentMode,
    localLedgerOnly,
    preferLocalAttachmentFirst,
    sourceFileName,
    contentType,
  ]);

  /** Thumbnail click + hover portal par double-click = browser / in-app open (same rules) */
  const canHoldCopyAttachment =
    holdAttachmentClipboard &&
    !disabled &&
    ((typeof file === "string" && String(file).trim().length > 0) || file instanceof File);

  /** Touch vs mouse — mobile par hold se Copy chip, desktop par hover + optional 2s hold copy */
  const tapInteractionMode = useTapInteractionMode();
  const [mobileCopyRevealed, setMobileCopyRevealed] = useState(false);

  /** Long-press + desktop hover par Copy button — ek hi payload/toast path; HTTPS ho to clipboard me link + session me PL paste. */
  const runHoldCopyNow = useCallback(async () => {
    const placeKey = String(attachmentReusePlaceKey || "").trim() || null;
    const payload = buildHoldPayloadFromPreviewSource({
      file: file as File | string,
      storagePath: resolvedStoragePath,
      companyId: String(attachmentCompanyId || shellCompanyId || "").trim() || undefined,
      placeKey,
    });
    if (!payload) return;
    const httpsFromProp =
      typeof file === "string" && /^https?:\/\//i.test(String(file).trim()) ? String(file).trim() : undefined;
    const httpsFromResolved =
      viewFileInfo.url && /^https?:\/\//i.test(String(viewFileInfo.url)) ? String(viewFileInfo.url) : undefined;
    const clipboardDisplayUrl = httpsFromProp ?? httpsFromResolved;
    const persistable =
      (typeof file === "string" &&
      (/^https?:\/\//i.test(String(file).trim()) ||
        String(file).trim().startsWith("local:") ||
        /^drive:/i.test(String(file).trim()))
        ? String(file).trim()
        : "") ||
      String(payload.src || "").trim();
    const cid = String(attachmentCompanyId || shellCompanyId || "").trim();
    if (cid && persistable && placeKey) {
      rememberAttachmentReuseOriginPlace(cid, persistable, placeKey);
    }
    const ok = await writeAttachmentHoldClipboard(payload, { clipboardDisplayUrl });
    refreshAttachmentHoldSessionBackup(payload);
    sonnerToast.success(ok ? "Copied" : "Saved for paste in this tab", {
      description: ok
        ? clipboardDisplayUrl
          ? "Same company paste reuses this file; other company creates a new copy."
          : "Paste reuses saved attachment when possible; unsaved file uploads as new copy."
        : "Clipboard blocked — try Paste on empty slot (uses last copy in this tab).",
    });
    setMobileCopyRevealed(false);
  }, [
    file,
    resolvedStoragePath,
    viewFileInfo.url,
    attachmentCompanyId,
    shellCompanyId,
    attachmentReusePlaceKey,
  ]);

  const reuseBadgeCompanyId = String(attachmentCompanyId || shellCompanyId || "").trim();
  const reuseBadgeUrl =
    typeof file === "string" &&
    (/^https?:\/\//i.test(String(file).trim()) ||
      String(file).trim().startsWith("local:") ||
      /^drive:/i.test(String(file).trim()))
      ? String(file).trim()
      : typeof viewFileInfo?.url === "string" &&
          (/^https?:\/\//i.test(String(viewFileInfo.url)) ||
            String(viewFileInfo.url).trim().startsWith("local:") ||
            /^drive:/i.test(String(viewFileInfo.url)))
        ? String(viewFileInfo.url).trim()
        : "";
  const currentReusePlaceKey = String(attachmentReusePlaceKey || "").trim();
  const listReuseHint = useVoucherListReuseHint(reuseBadgeUrl, currentReusePlaceKey || null);
  const [reuseCount, setReuseCount] = useState(0);
  const [reuseOriginPlaceKey, setReuseOriginPlaceKey] = useState<string | null>(null);
  const [reuseOriginDetached, setReuseOriginDetached] = useState(false);
  useEffect(() => {
    if (
      !showReuseCountBadge ||
      !reuseBadgeCompanyId ||
      !reuseBadgeUrl
    ) {
      setReuseCount(0);
      setReuseOriginPlaceKey(null);
      setReuseOriginDetached(false);
      return;
    }
    let cancelled = false;
    let badgesOn = true;
    void import("@/lib/firebaseBillingOptimization").then((m) => {
      if (cancelled) return;
      badgesOn = m.attachmentReuseShareUrlBadgesEnabled();
      if (!badgesOn) {
        setReuseCount(0);
        setReuseOriginPlaceKey(null);
        setReuseOriginDetached(false);
      }
    });
    const refresh = () => {
      void import("@/lib/firebaseBillingOptimization").then((m) => {
        if (cancelled || !m.attachmentReuseShareUrlBadgesEnabled()) return;
        const formPeerCount =
          Array.isArray(attachmentClientFileUrls) && reuseBadgeUrl
            ? attachmentClientFileUrls.filter((x) =>
                attachmentPersistableRefsMatch(String(x || ""), reuseBadgeUrl)
              ).length
            : 0;
        void resolveAttachmentReuseUiMeta(reuseBadgeCompanyId, reuseBadgeUrl, {
          includeFormBoost: true,
          formPeerCount,
        }).then((meta) => {
          if (cancelled) return;
          setReuseCount(meta.count);
          setReuseOriginPlaceKey(meta.originPlaceKey);
          setReuseOriginDetached(Boolean(meta.originDetached));
        });
      });
    };
    refresh();
    const onReuse = (ev: Event) => {
      const detail = (ev as CustomEvent<{ companyId?: string; url?: string; count?: number }>).detail;
      if (!detail) return;
      const detailUrl = String(detail.url || "").trim();
      if (!detailUrl || !attachmentPersistableRefsMatch(detailUrl, reuseBadgeUrl)) return;
      refresh();
    };
    window.addEventListener(ATTACHMENT_REUSE_COUNT_EVENT, onReuse as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(ATTACHMENT_REUSE_COUNT_EVENT, onReuse as EventListener);
    };
  }, [showReuseCountBadge, reuseBadgeCompanyId, reuseBadgeUrl, attachmentClientFileUrls]);

  // Meta sticky origin first — list earliest promote mat (source delete pe galat green).
  const effectiveOriginPlaceKey =
    reuseOriginPlaceKey || (reuseOriginDetached ? null : listReuseHint.originPlaceKey) || null;
  const isReuseOriginPlace =
    !reuseOriginDetached &&
    Boolean(currentReusePlaceKey) &&
    Boolean(effectiveOriginPlaceKey) &&
    currentReusePlaceKey === effectiveOriginPlaceKey;
  /** Forms: reuse count number. Green = live source; blue = reuse OR source-removed leftover. */
  const isSharedAcrossPlaces =
    (Math.max(reuseCount, listReuseHint.count) >= 2 || reuseOriginDetached) &&
    Boolean(reuseBadgeUrl);
  const showReuseNumberBadge = showReuseCountBadge && isSharedAcrossPlaces;

  const copyAttachmentHold = useAttachmentHoldPointer({
    disabled: !canHoldCopyAttachment,
    holdMs: tapInteractionMode ? ATTACHMENT_HOLD_MS_MOBILE : ATTACHMENT_HOLD_MS_DESKTOP,
    onHoldComplete: tapInteractionMode
      ? () => {
          setMobileCopyRevealed(true);
        }
      : runHoldCopyNow,
  });
  const pointerOpenGuardRef = useRef<{ x: number; y: number; pointerType: string; at: number } | null>(null);
  const skipNextClickOpenRef = useRef(false);

  const portalShareMeta = React.useMemo(() => {
    const rawRef =
      typeof normalizedPreviewFile === "string"
        ? normalizeAttachmentUrlForDevicePreview(normalizedPreviewFile)
        : "";
    const underlyingLocalRef =
      typeof normalizedPreviewFile === "string" && isLocalFileRef(normalizedPreviewFile)
        ? normalizedPreviewFile
        : "";
    const isPdfAttachment =
      viewFileInfo.formatLabel === "PDF" || viewFileInfo.type === "pdf";
    const url = isPdfAttachment
      ? underlyingLocalRef ||
        (rawRef && !rawRef.startsWith("blob:") ? rawRef : "") ||
        (viewFileInfo.url && !String(viewFileInfo.url).startsWith("blob:") ? String(viewFileInfo.url) : "") ||
        rawRef ||
        String(viewFileInfo.url || "")
      : underlyingLocalRef ||
        (rawRef && !rawRef.startsWith("blob:") ? rawRef : "") ||
        (viewFileInfo.url && !String(viewFileInfo.url).startsWith("blob:") ? String(viewFileInfo.url) : "") ||
        rawRef ||
        String(viewFileInfo.url || "");
    const trimmed = String(url).trim();
    if (!trimmed) return null;
    return { url: trimmed, name: viewFileInfo.name || "attachment" };
  }, [
    normalizedPreviewFile,
    viewFileInfo.formatLabel,
    viewFileInfo.type,
    viewFileInfo.url,
    viewFileInfo.name,
  ]);

  const openAttachmentFromFileInfo = useCallback(() => {
    // Files tick OFF: openAttachmentInApp still opens device cache; blocks download.
    const rawRef =
      typeof normalizedPreviewFile === "string"
        ? normalizeAttachmentUrlForDevicePreview(normalizedPreviewFile)
        : "";
    const underlyingLocalRef =
      typeof normalizedPreviewFile === "string" && isLocalFileRef(normalizedPreviewFile)
        ? normalizedPreviewFile
        : "";
    const isMemoryUrl = (u: string) => u.startsWith("blob:") || u.startsWith("data:");
    const isPdfAttachment =
      viewFileInfo.formatLabel === "PDF" || viewFileInfo.type === "pdf";
    // IC + other edit forms: thumb already resolved to memory blob while Files OFF —
    // prefer that over canonical HTTPS (network blocked) so open matches portal / Payment In.
    const previewMemoryUrl = (() => {
      if (!localLedgerOnly) return "";
      /** PDF: party jaisa — thumb JPEG / cell-thumb mat; sirf full PDF bytes cache ya canonical ref. */
      if (isPdfAttachment) {
        if (!rawRef && !underlyingLocalRef) return "";
        const canonical = underlyingLocalRef || rawRef;
        const full = peekHoverCachedBlobUrl(canonical);
        if (full && isMemoryUrl(full)) return full;
        return "";
      }
      const fromView = String(viewFileInfo.url || "").trim();
      if (fromView && isMemoryUrl(fromView)) return fromView;
      const fromPdf = String(viewPdfThumbnail || "").trim();
      if (fromPdf && isMemoryUrl(fromPdf)) return fromPdf;
      if (!rawRef) return "";
      const full = peekHoverCachedBlobUrl(rawRef);
      if (full && isMemoryUrl(full)) return full;
      const v2 = peekHoverCachedBlobUrl(sharedPdfCellThumbKey(rawRef));
      if (v2 && isMemoryUrl(v2)) return v2;
      const v1 = peekHoverCachedBlobUrl(sharedAttachmentCellThumbKey(rawRef));
      if (v1 && isMemoryUrl(v1)) return v1;
      return "";
    })();
    // Click-open: network ON → canonical `local:` / https. Files OFF + local blob → open blob.
    // PDF: kabhi bhi tile thumb blob ko https se upar mat rakho — raster + Height fit ke liye canonical ref.
    const openSrc = isPdfAttachment
      ? previewMemoryUrl ||
        underlyingLocalRef ||
        (rawRef && !rawRef.startsWith("blob:") ? rawRef : "") ||
        (viewFileInfo.url && !viewFileInfo.url.startsWith("blob:") ? viewFileInfo.url : "") ||
        rawRef ||
        viewFileInfo.url ||
        ""
      : previewMemoryUrl ||
        underlyingLocalRef ||
        (rawRef && !rawRef.startsWith("blob:") ? rawRef : "") ||
        (viewFileInfo.url && !viewFileInfo.url.startsWith("blob:") ? viewFileInfo.url : "") ||
        rawRef ||
        viewFileInfo.url ||
        "";
    if (!openSrc) return;
    const kind =
      viewFileInfo.formatLabel === "PDF" || viewFileInfo.type === "pdf"
        ? "pdf"
        : viewFileInfo.type === "image" ||
            ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF"].includes(
              viewFileInfo.formatLabel || ""
            )
          ? "image"
          : "other";
    const g =
      attachmentGallery && attachmentGallery.urls.length > 1
        ? { urls: attachmentGallery.urls, startIndex: attachmentGallery.startIndex }
        : undefined;
    const clientList =
      attachmentClientFileUrls ??
      (attachmentGallery?.urls && attachmentGallery.urls.length > 0 ? [...attachmentGallery.urls] : undefined);
    const cid = String(pathCompanyId || voucherAttachmentFb?.companyId || "").trim();
    const serverFallback =
      cid && (underlyingLocalRef || isLocalFileRef(openSrc) || voucherAttachmentFb?.interCompanyPeer)
        ? {
            companyId: cid,
            voucherId: voucherAttachmentFb?.voucherId ?? "",
            clientFileUrls: clientList,
            interCompanyPeer: voucherAttachmentFb?.interCompanyPeer,
          }
        : undefined;
    void openAttachmentInApp(openSrc, {
      title: viewFileInfo.name,
      kind,
      gallery: g,
      serverFallback,
      localLedgerOnly,
      gateCompany: company,
    });
  }, [
    viewFileInfo.url,
    viewFileInfo.type,
    viewFileInfo.name,
    viewFileInfo.formatLabel,
    viewPdfThumbnail,
    normalizedPreviewFile,
    attachmentGalleryFingerprint,
    attachmentClientUrlsFingerprint,
    voucherAttachmentFbFingerprint,
    pathCompanyId,
    localLedgerOnly,
    voucherAttachmentFb?.interCompanyPeer,
    voucherAttachmentFb?.companyId,
    voucherAttachmentFb?.voucherId,
    company,
    shellCompanyId,
  ]);

  const recoverPreviewFromLocalCache = useCallback(
    async (badUrl: string | null | undefined) => {
      if (typeof normalizedPreviewFile !== "string" || !isLocalFileRef(normalizedPreviewFile)) return false;
      const cachedBlob = await tryOfflineCachedAttachmentBlobMultiKey(normalizedPreviewFile);
      if (!cachedBlob?.size) return false;
      const kind = await sniffBlobKindForPreview(cachedBlob);
      if (kind === "image") {
        const typed =
          cachedBlob.type?.startsWith("image/") && cachedBlob.type !== "application/octet-stream"
            ? cachedBlob
            : new Blob([await cachedBlob.arrayBuffer()], { type: "image/jpeg" });
        const recoveredUrl = URL.createObjectURL(typed);
        rememberHoverBlobUrl(normalizedPreviewFile, recoveredUrl);
        rememberHoverBlobUrl(sharedPdfCellThumbKey(normalizedPreviewFile), recoveredUrl);
        setFileInfo((prev) =>
          !badUrl || prev.url === badUrl || prev.type === "other"
            ? {
                ...prev,
                url: recoveredUrl,
                type: "image",
                formatLabel:
                  prev.formatLabel === "FILE" || prev.formatLabel === "OTHER"
                    ? getAttachmentFormatLabel(normalizedPreviewFile) === "FILE"
                      ? "JPEG"
                      : getAttachmentFormatLabel(normalizedPreviewFile)
                    : prev.formatLabel,
              }
            : prev
        );
        setIsLoading(false);
        return true;
      }
      if (kind === "pdf") {
        const persistedPdfThumb = await tryOfflineCachedAttachmentBlobMultiKey(sharedPdfCellThumbKey(normalizedPreviewFile));
        if (persistedPdfThumb?.size) {
          const recoveredThumbUrl = URL.createObjectURL(persistedPdfThumb);
          rememberHoverBlobUrl(sharedPdfCellThumbKey(normalizedPreviewFile), recoveredThumbUrl);
          const ck = pdfThumbCacheKey(undefined, normalizedPreviewFile, resolvedStoragePath, layoutMaxEdge);
          pdfThumbCacheSet(ck, recoveredThumbUrl);
          pdfThumbnailKeyRef.current = ck;
          setPdfThumbnailSafe(recoveredThumbUrl);
        }
        setFileInfo((prev) =>
          !badUrl || prev.url === badUrl || prev.type === "other"
            ? {
                ...prev,
                url: normalizedPreviewFile,
                type: "pdf",
                name: "Attachment",
                formatLabel: "PDF",
              }
            : prev
        );
        setIsLoading(false);
        return true;
      }
      return false;
    },
    [layoutMaxEdge, normalizedPreviewFile, resolvedStoragePath, setPdfThumbnailSafe]
  );

  const handlePreviewClick = (e: React.MouseEvent) => {
    if (children || (disabled && !allowPreviewWhenDisabled)) return;
    /* Mobile: Copy chip khula ho to short tap se file open na ho — sirf Copy dabayein */
    if (tapInteractionMode && mobileCopyRevealed) return;
    e.preventDefault();
    e.stopPropagation();
    pointerOpenGuardRef.current = null;
    if (skipNextClickOpenRef.current) {
      skipNextClickOpenRef.current = false;
      return;
    }
    openAttachmentFromFileInfo();
  };

  const handlePreviewPointerDown = (e: React.PointerEvent) => {
    if (children || (disabled && !allowPreviewWhenDisabled)) return;
    if (e.button !== 0) return;
    pointerOpenGuardRef.current = {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
      at: Date.now(),
    };
  };

  const handlePreviewPointerUp = (e: React.PointerEvent) => {
    if (children || (disabled && !allowPreviewWhenDisabled)) return;
    if (tapInteractionMode && mobileCopyRevealed) return;
    const start = pointerOpenGuardRef.current;
    pointerOpenGuardRef.current = null;
    if (!start || start.pointerType !== e.pointerType) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > 12 * 12) return;
    if (Date.now() - start.at > 700) return;
    e.preventDefault();
    e.stopPropagation();
    skipNextClickOpenRef.current = true;
    openAttachmentFromFileInfo();
  };

  // Avatar par bhi hover preview (user); children / explicit off = nested-tooltip se bacho
  const showHoverFullPreview =
    enableHoverFullPreview &&
    !children &&
    Boolean(viewFileInfo.url) &&
    !viewIsLoading &&
    (viewFileInfo.type === "image" || viewFileInfo.type === "pdf");

  const hoverPortalGalleryUrls = React.useMemo(() => {
    const fromGallery = attachmentGallery?.urls
      ?.map((u) => String(u || "").trim())
      .filter(Boolean);
    if (fromGallery && fromGallery.length > 1) return fromGallery;
    const fromClient = attachmentClientFileUrls
      ?.map((u) => String(u || "").trim())
      .filter(Boolean);
    if (fromClient && fromClient.length > 1) return [...new Set(fromClient)];
    return null;
  }, [attachmentGallery, attachmentClientFileUrls, attachmentGalleryFingerprint, attachmentClientUrlsFingerprint]);

  const hoverPortalGalleryStartIndex = React.useMemo(() => {
    if (attachmentGallery && attachmentGallery.urls.length > 1) {
      return Math.min(
        Math.max(attachmentGallery.startIndex, 0),
        attachmentGallery.urls.length - 1
      );
    }
    if (!hoverPortalGalleryUrls) return 0;
    const self =
      typeof normalizedPreviewFile === "string" ? String(normalizedPreviewFile).trim() : "";
    if (!self) return 0;
    const idx = hoverPortalGalleryUrls.findIndex((u) => u === self);
    return idx >= 0 ? idx : 0;
  }, [attachmentGallery, hoverPortalGalleryUrls, normalizedPreviewFile]);

  /** Image already painted (browser downloaded) → KB badge without remount storm. */
  const applyThumbSizeAfterImagePaint = useCallback(
    (displayUrl: string | null | undefined) => {
      if (pickAttachmentByteSize(fileSize, fileInfoRef.current.size) != null) return;
      const display = String(displayUrl || "").trim();
      const source = typeof file === "string" ? String(file).trim() : "";
      const fromPerf = pickAttachmentByteSize(
        byteSizeFromPerformanceResource(display),
        byteSizeFromPerformanceResource(source)
      );
      if (fromPerf != null) {
        rememberAttachmentByteSize(source || display, fromPerf);
        setFileInfo((prev) =>
          pickAttachmentByteSize(prev.size) != null ? prev : { ...prev, size: fromPerf }
        );
        return;
      }

      void (async () => {
        if (pickAttachmentByteSize(fileInfoRef.current.size, fileSize) != null) return;

        if (display.startsWith("blob:") || display.startsWith("data:")) {
          try {
            const blob = await fetch(display).then((r) => r.blob());
            const n = pickAttachmentByteSize(blob);
            if (n != null) {
              rememberAttachmentByteSize(source || display, n);
              setFileInfo((prev) =>
                pickAttachmentByteSize(prev.size) != null ? prev : { ...prev, size: n }
              );
              return;
            }
          } catch {
            /* ignore */
          }
        }

        if (!source || (!/^https?:\/\//i.test(source) && !isLocalFileRef(source))) return;

        const peeked = await peekRemoteAttachmentByteSize(source, {
          storagePath: resolvedStoragePath || storagePath,
          companyId: pathCompanyId,
          allowHttpPeek: !localLedgerOnly,
        });
        if (peeked != null) {
          rememberAttachmentByteSize(source, peeked);
          setFileInfo((prev) =>
            pickAttachmentByteSize(prev.size) != null ? prev : { ...prev, size: peeked }
          );
          return;
        }

        // Gallery grid: full re-fetch mat (hang). Edit attach tiles: one cache/network size read OK.
        if (stableLocalPreviewOnly || localLedgerOnly) return;
        if (!/^https?:\/\//i.test(source)) return;
        try {
          const blob = await getRemoteAttachmentBlobPreferOfflineCache(source, undefined, {
            localOnly: false,
            companyId: pathCompanyId,
            explicitUserRequest: true,
          });
          const n = pickAttachmentByteSize(blob);
          if (n != null) {
            rememberAttachmentByteSize(source, n);
            setFileInfo((prev) =>
              pickAttachmentByteSize(prev.size) != null ? prev : { ...prev, size: n }
            );
          }
        } catch {
          /* ignore */
        }
      })();
    },
    [
      file,
      fileSize,
      resolvedStoragePath,
      storagePath,
      pathCompanyId,
      localLedgerOnly,
      stableLocalPreviewOnly,
    ]
  );

  const ThumbnailContent = () => {
    // PDF first-page thumb = progressive; spinner mat — icon dikhao jab tak raster ready.
    if (!previewTimedOut && viewIsLoading && !(viewFileInfo.type === "pdf" && viewFileInfo.url)) {
      return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
    }

    if (previewTimedOut && !viewFileInfo.url && !viewPdfThumbnail) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-muted/40 p-1 text-center">
          <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="text-[9px] font-semibold leading-tight text-muted-foreground">
            {viewFileInfo.formatLabel || "FILE"}
          </span>
        </div>
      );
    }
    
    switch (viewFileInfo.type) {
      case "image":
        if (isUnresolvedAttachmentPreviewUrl(viewFileInfo.url)) {
          return children || (
            <div className="flex h-full w-full flex-col items-center justify-center bg-slate-50 text-slate-500">
              <FileText className="h-8 w-8" />
              <span className="mt-1 text-xs font-bold uppercase">File</span>
            </div>
          );
        }
        return (
          children ||
          (isBlobOrDataDisplayUrl(viewFileInfo.url) ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob:/data: Next Image se `ERR_FILE_NOT_FOUND` race
            <img
              src={viewFileInfo.url!}
              alt={viewFileInfo.name?.startsWith(LOCAL_FILE_PREFIX) ? "Attachment" : viewFileInfo.name}
              className={cn(
                "absolute inset-0 h-full w-full",
                objectFit === "contain" ? "object-contain" : "object-cover"
              )}
              onLoad={() => applyThumbSizeAfterImagePaint(viewFileInfo.url)}
              onError={() => {
                const bad = viewFileInfo.url;
                tryCurrentDocUrlFallback();
                if (typeof normalizedPreviewFile === "string" && bad) {
                  forgetHoverBlobUrl(normalizedPreviewFile, bad);
                }
                // Revoked blob → File icon; loading spinner loop mat (gallery remount churn).
                void recoverPreviewFromLocalCache(bad).then((recovered) => {
                  if (recovered) return;
                  if (typeof normalizedPreviewFile === "string" && isLocalFileRef(normalizedPreviewFile)) {
                    setIsLoading(false);
                    return;
                  }
                  setFileInfo((prev) =>
                    prev.url === bad ? { ...prev, url: null, type: "other" } : prev
                  );
                  setIsLoading(false);
                });
              }}
            />
          ) : (
            <Image
              src={viewFileInfo.url!}
              alt={viewFileInfo.name?.startsWith(LOCAL_FILE_PREFIX) ? "Attachment" : viewFileInfo.name}
              fill
              sizes={`${layoutMaxEdge}px`}
              className={objectFit === "contain" ? "object-contain" : "object-cover"}
              unoptimized
              onLoad={() => applyThumbSizeAfterImagePaint(viewFileInfo.url)}
              onError={() => {
                const bad = viewFileInfo.url;
                tryCurrentDocUrlFallback();
                const source =
                  typeof normalizedPreviewFile === "string" ? String(normalizedPreviewFile).trim() : "";
                void (async () => {
                  if (await recoverPreviewFromLocalCache(bad)) return;
                  if (source && source !== bad && (await recoverPreviewFromLocalCache(source))) return;
                  // Recompress/reuse: naya HTTPS cached blob se paint (FILE icon mat).
                  if (source && /^https?:\/\//i.test(source) && !localLedgerOnly) {
                    try {
                      let blob = await getOfflineCachedAttachmentBlob(source);
                      if (!blob || blob.size === 0) {
                        blob = await getRemoteAttachmentBlobPreferOfflineCache(source, undefined, {
                          localOnly: false,
                          companyId: pathCompanyId,
                          explicitUserRequest: true,
                        });
                      }
                      if (blob && blob.size > 0) {
                        const objectUrl = URL.createObjectURL(blob);
                        rememberHoverBlobUrl(source, objectUrl);
                        rememberAttachmentByteSize(source, blob.size);
                        setFileInfo((prev) => ({
                          ...prev,
                          url: objectUrl,
                          type: "image",
                          formatLabel:
                            prev.formatLabel === "FILE" || prev.formatLabel === "OTHER"
                              ? "JPG"
                              : prev.formatLabel || "JPG",
                          size: pickAttachmentByteSize(prev.size, blob.size),
                        }));
                        setIsLoading(false);
                        return;
                      }
                    } catch {
                      /* fall through */
                    }
                  }
                  if (typeof normalizedPreviewFile === "string" && isLocalFileRef(normalizedPreviewFile)) {
                    setIsLoading(false);
                    return;
                  }
                  setFileInfo((prev) =>
                    prev.url === bad || prev.url == null
                      ? { ...prev, url: null, type: "other" }
                      : prev
                  );
                  setIsLoading(false);
                })();
              }}
            />
          ))
        );
      case "pdf":
        // Show PDF thumbnail if available, otherwise show icon
        if (viewPdfThumbnail) {
          return (
            children ||
            (isBlobOrDataDisplayUrl(viewPdfThumbnail) ? (
              // eslint-disable-next-line @next/next/no-img-element -- PDF first-page thumb = object URL
              <img
                src={viewPdfThumbnail}
                alt={viewFileInfo.name}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  objectFit === "contain" ? "object-contain" : "object-cover"
                )}
                onError={() => {
                  const bad = viewPdfThumbnail;
                  if (typeof normalizedPreviewFile === "string" && bad) {
                    const sharedKey = sharedPdfCellThumbKey(normalizedPreviewFile);
                    badPdfThumbCacheKeysRef.current.add(sharedKey);
                    forgetHoverBlobUrl(sharedKey, bad);
                  }
                  if (typeof normalizedPreviewFile === "string") {
                    void generatePdfThumbnail(normalizedPreviewFile, undefined, resolvedStoragePath);
                  } else {
                    setIsLoading(false);
                  }
                }}
              />
            ) : (
              <Image
                src={viewPdfThumbnail}
                alt={viewFileInfo.name}
                fill
                sizes={`${layoutMaxEdge}px`}
                className={objectFit === "contain" ? "object-contain" : "object-cover"}
                unoptimized
                onError={() => {
                  const bad = viewPdfThumbnail;
                  if (typeof normalizedPreviewFile === "string" && bad) {
                    const sharedKey = sharedPdfCellThumbKey(normalizedPreviewFile);
                    badPdfThumbCacheKeysRef.current.add(sharedKey);
                    forgetHoverBlobUrl(sharedKey, bad);
                  }
                  if (typeof normalizedPreviewFile === "string") {
                    void generatePdfThumbnail(normalizedPreviewFile, undefined, resolvedStoragePath);
                  } else {
                    setIsLoading(false);
                  }
                }}
              />
            ))
          );
        }
        // Fallback to icon if thumbnail generation fails / still in progress
        return (
          <div className="flex h-full w-full flex-col items-center justify-center bg-red-50 text-red-500">
            <FileText className="h-8 w-8 mb-1" />
            <span className="text-[12px] font-black leading-none">
              {isPdfLoading ? "…" : "PDF"}
            </span>
          </div>
        );
      default:
        return children || (
          <div className="flex h-full w-full flex-col items-center justify-center bg-slate-50 text-slate-500">
            <FileText className="h-8 w-8" />
            <span className="mt-1 text-xs font-bold uppercase">File</span>
          </div>
        );
    }
  };
  
  const reduction = compressionResult
    ? (((compressionResult.originalSize - compressionResult.compressedSize) / compressionResult.originalSize) * 100).toFixed(0)
    : 0;
    
  const showSpinner = isCompressingProp || viewIsLoading;

  /** Unsaved File → exact size; https/local → cache/blob/memory size when known. */
  const thumbSizeBytes = (() => {
    if (typeof File !== "undefined" && file instanceof File && file.size > 0) return file.size;
    if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0) return fileSize;
    const fromInfo = Number(viewFileInfo?.size);
    if (Number.isFinite(fromInfo) && fromInfo > 0) return fromInfo;
    if (typeof file === "string") return recalledAttachmentByteSize(file);
    return null;
  })();
  const thumbSizeLabel = thumbSizeBytes != null ? formatBytesForThumbBadge(thumbSizeBytes) : "";
  const formatBadgeText = [viewFileInfo.formatLabel, thumbSizeLabel].filter(Boolean).join(" · ");

  /** Hold handlers thumbnail par — touch target; browser long-press menu band */
  const thumbHoldHandlers = canHoldCopyAttachment
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          handlePreviewPointerDown(e);
          copyAttachmentHold.onPointerDown(e);
        },
        onPointerMove: copyAttachmentHold.onPointerMove,
        onPointerUp: (e: React.PointerEvent) => {
          copyAttachmentHold.onPointerUp();
          handlePreviewPointerUp(e);
        },
        onPointerCancel: copyAttachmentHold.onPointerCancel,
        onPointerLeave: copyAttachmentHold.onPointerLeave,
        onClickCapture: copyAttachmentHold.onClickCapture,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {
        onPointerDown: handlePreviewPointerDown,
        onPointerUp: handlePreviewPointerUp,
      };

  // Thumbnail box: hover tooltip ke andar bhi yahi layout (preview + badge + compression strip)
  const borderedPreview = (
    <div
      className={cn(
        "relative w-full h-full rounded-lg overflow-hidden flex items-center justify-center touch-manipulation border",
        flushFrame ? "border-blue-300 bg-transparent shadow-none" : "border-border bg-background shadow-sm",
        disabled && !allowPreviewWhenDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        disabled && allowPreviewWhenDisabled && "opacity-90"
      )}
      title={
        isSharedAcrossPlaces && isReuseOriginPlace
          ? `Original source — also used in ${reuseCount} places`
          : isSharedAcrossPlaces
            ? `Reused file — used in ${reuseCount} places`
            : undefined
      }
      onClick={children || (disabled && !allowPreviewWhenDisabled) ? undefined : handlePreviewClick}
      {...thumbHoldHandlers}
    >
      <ThumbnailContent />

      {showSpinner && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
      {/* Compression strip ke upar corner label taaki dono dikhein */}
      {showFormatBadge && formatBadgeText && !showSpinner && (
        <span
          className={cn(
            "pointer-events-none absolute z-[12] max-w-[92%] truncate rounded bg-black/55 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white",
            compressionResult ? "bottom-5 left-1" : "bottom-1 left-1"
          )}
          title={
            thumbSizeBytes != null
              ? `${viewFileInfo.formatLabel || "FILE"} · ${formatBytes(thumbSizeBytes)}`
              : viewFileInfo.formatLabel || undefined
          }
        >
          {formatBadgeText}
        </span>
      )}
      {showReuseNumberBadge && !showSpinner ? (
        <span
          className={cn(
            "pointer-events-none absolute z-[13] flex min-h-[18px] min-w-[18px] items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold leading-none text-white shadow-md",
            isReuseOriginPlace ? "bg-emerald-600" : "bg-blue-600",
            compressionResult ? "bottom-5 right-1" : "bottom-1 right-1"
          )}
          title={
            isReuseOriginPlace
              ? `Original source — used in ${Math.max(reuseCount, listReuseHint.count)} places`
              : reuseOriginDetached
                ? `Reused file — original source removed; still linked here`
                : `Reused file — used in ${Math.max(reuseCount, listReuseHint.count)} places`
          }
          aria-label={`Used ${Math.max(reuseCount, listReuseHint.count)} times`}
        >
          {Math.max(reuseCount, listReuseHint.count) > 99
            ? "99+"
            : Math.max(reuseCount, listReuseHint.count)}
        </span>
      ) : null}
      {compressionResult && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-emerald-600/90 py-0.5 text-center text-[10px] font-medium text-white">
          -{reduction}%
        </div>
      )}
    </div>
  );

  /** PC hover par Copy — mobile par `tapInteractionMode` se alag chip */
  const finePointerCopyBar = canHoldCopyAttachment && !tapInteractionMode ? (
    <div className="pointer-events-none absolute inset-0 z-[60] flex items-start justify-center gap-1 bg-transparent pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="pointer-events-auto h-7 gap-0.5 px-2 text-[10px] font-semibold shadow-md"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void runHoldCopyNow();
        }}
      >
        <Copy className="h-3 w-3 shrink-0" aria-hidden />
        Copy
      </Button>
    </div>
  ) : null;

  /** Mobile: ~1s hold ke baad Copy chip; click se copy (PC hover jaisa) */
  const mobileCopyBar =
    canHoldCopyAttachment && tapInteractionMode && mobileCopyRevealed ? (
      <div className="pointer-events-none absolute inset-0 z-[60] flex items-start justify-center gap-1 bg-transparent pt-0.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="pointer-events-auto h-7 gap-0.5 px-2 text-[10px] font-semibold shadow-md"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            void runHoldCopyNow();
          }}
        >
          <Copy className="h-3 w-3 shrink-0" aria-hidden />
          Copy
        </Button>
      </div>
    ) : null;

  // Hover popup: PDF ke liye nested FilePreview mat chalao — dubara fetch + chhota timeout; wahi raster thumb bara dikhao
  const hoverPanel =
    viewFileInfo.type === "image" && viewFileInfo.url ? (
      // eslint-disable-next-line @next/next/no-img-element -- portal max-h + object-contain = screen fit
      <img
        src={viewFileInfo.url}
        alt=""
        draggable={false}
        className="h-auto w-auto max-h-none max-w-none object-contain"
        onDoubleClick={(e) => {
          e.stopPropagation();
          openAttachmentFromFileInfo();
        }}
      />
    ) : viewFileInfo.type === "pdf" && viewPdfThumbnail ? (
      // eslint-disable-next-line @next/next/no-img-element -- PDF first page = cached blob URL, pdf.js dubara portal me nahi
      <img
        src={viewPdfThumbnail}
        alt=""
        draggable={false}
        className="h-auto w-auto max-h-none max-w-none object-contain"
        onDoubleClick={(e) => {
          e.stopPropagation();
          openAttachmentFromFileInfo();
        }}
      />
    ) : viewFileInfo.type === "pdf" && (isPdfLoading || viewIsLoading) ? (
      <div className="flex min-h-[280px] w-full flex-col items-center justify-center gap-2 px-4 py-8">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">Loading PDF preview…</span>
      </div>
    ) : viewFileInfo.type === "pdf" && viewFileInfo.url ? (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-muted-foreground">
        <FileText className="h-12 w-12 shrink-0 opacity-50" aria-hidden />
        <span>Preview could not be generated</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            void openAttachmentInApp(viewFileInfo.url!, {
              title: viewFileInfo.name,
              kind: "pdf",
              localLedgerOnly,
            })
          }
        >
          Open PDF
        </Button>
      </div>
    ) : (
      <FilePreview
        file={file}
        storagePath={resolvedStoragePath}
        size={HOVER_PREVIEW_MAX_PX}
        objectFit="contain"
        enableHoverFullPreview={false}
        showFormatBadge={false}
        disabled={disabled}
        fileSize={fileSize}
        isAvatar={isAvatar}
        holdAttachmentClipboard={false}
        attachmentReusePlaceKey={attachmentReusePlaceKey}
        attachmentCompanyId={attachmentCompanyId}
      />
    );

  if (attachmentBlockedByCrossCompanyPolicy) {
    return (
      <div
        className={cn(
          "relative flex flex-col items-center justify-center rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-2 text-center",
          className
        )}
        style={{ width: previewBox?.width ?? size, height: previewBox?.height ?? size }}
        title="Attachment belongs to another company that is not on your account"
      >
        <FileText className="mb-1 h-6 w-6 text-muted-foreground" />
        <p className="text-[10px] leading-tight text-muted-foreground">
          Other company file
          <br />
          (not available here)
        </p>
        {onRemove && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-0.5 h-6 w-6 text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn("relative group h-full w-full", className)}
      style={
        fillsParentAttachSlot ? undefined : { width: `${layoutW}px`, height: `${layoutH}px` }
      }
    >
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const cid = reuseBadgeCompanyId;
            const url = reuseBadgeUrl;
            onRemove();
            if (cid && url) {
              window.setTimeout(() => {
                void noteAttachmentUnlinkedInUi(cid, url);
              }, 0);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -right-2 -top-2 z-[100] flex min-h-[28px] min-w-[28px] items-center justify-center rounded-full bg-red-500 p-1.5 text-white opacity-0 shadow-lg transition-opacity pointer-events-auto group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {showHoverFullPreview ? (
        <AttachmentHoverPortal
          triggerClassName="h-full w-full min-h-0 min-w-0"
          openOnHover={tapInteractionMode}
          galleryUrls={hoverPortalGalleryUrls ?? undefined}
          galleryStartIndex={hoverPortalGalleryStartIndex}
          shareAttachmentUrl={portalShareMeta?.url}
          shareFileName={portalShareMeta?.name}
          onPreviewDoubleClick={
            viewFileInfo.type === "pdf" && viewFileInfo.url
              ? (e) => {
                  e.stopPropagation();
                  openAttachmentFromFileInfo();
                }
              : undefined
          }
          preview={
            hoverPortalGalleryUrls && hoverPortalGalleryUrls.length > 1 ? (
              <MultiAttachmentPortalPreview
                urls={hoverPortalGalleryUrls}
                companyId={pathCompanyId || attachmentCompanyId}
                voucherId={voucherAttachmentFb?.voucherId}
              />
            ) : (
              <>
                {hoverPanel}
                <p className="pt-1 text-center text-[10px] font-semibold text-muted-foreground">
                  {viewFileInfo.formatLabel}
                </p>
              </>
            )
          }
        >
          <div className="relative h-full w-full min-h-0 min-w-0">
            {borderedPreview}
            {finePointerCopyBar}
            {mobileCopyBar}
          </div>
        </AttachmentHoverPortal>
      ) : (
        <div className="relative h-full w-full min-h-0 min-w-0">
          {borderedPreview}
          {finePointerCopyBar}
          {mobileCopyBar}
        </div>
      )}
    </div>
  );
}
