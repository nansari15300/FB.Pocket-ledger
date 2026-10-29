"use client";

import { useEffect, useState } from "react";
import {
  forgetHoverBlobUrl,
  peekHoverCachedBlobUrl,
  rememberHoverBlobUrl,
} from "@/lib/attachmentHoverBlobCache";
import { isNonImageBlobObjectUrl, sniffBlobKindForPreview } from "@/lib/attachmentFormatLabel";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import {
  getOfflineCachedAttachmentNativeRef,
  getRemoteAttachmentBlobPreferOfflineCache,
  isOfflineCachedAttachmentOnDevice,
  seedOfflineAttachmentCacheFromBlob,
  tryOfflineCachedAttachmentBlobMultiKey,
} from "@/lib/offlineAttachmentUrlCache";
import { useCompany } from "@/hooks/useCompany";
import {
  ensureAttachmentUiRefreshListeners,
  getAttachmentUiRefreshTick,
  markAttachmentUrlReady,
  requestAttachmentUiRefresh,
  subscribeAttachmentLoadStore,
} from "@/lib/attachmentLoadReady";
import {
  looksLikeFirebaseStorageDownloadUrl,
  tryGetBlobFromFirebaseStorageDownloadUrl,
} from "@/lib/storageGetBlobFromDownloadUrl";
import { isRemoteAttachmentNetworkFetchAllowed, isRemoteHttpsAttachmentUrl } from "@/lib/attachmentNetworkGate";
import {
  clearAttachmentNoFile,
  isAttachmentNoFile,
  markAttachmentNoFile,
  markAttachmentNoFileInferred,
  probeRemoteAttachmentBytes,
} from "@/lib/attachmentNoFileSession";

function thumbCacheKey(url: string): string {
  return `${url}::cell-thumb`;
}

function pdfPortalCacheKey(url: string): string {
  return `${url}::pdf-portal`;
}

/**
 * Cached cell thumb. `local:` refs: never fall back to the shared `url` key - that holds the raw
 * file blob (PDF for pending PDFs) seeded by localPendingFiles / FilePreview, not an <img> thumb.
 */
function peekCachedCellThumb(url: string): string | undefined {
  return (
    peekHoverCachedBlobUrl(thumbCacheKey(url)) ??
    (isLocalFileRef(url) ? undefined : peekHoverCachedBlobUrl(url)) ??
    undefined
  );
}

function isInlineImagePreviewUrl(raw: string): boolean {
  return /^data:image\//i.test(String(raw || "").trim()) || /^blob:/i.test(String(raw || "").trim());
}

export function invalidateAttachmentThumbDisplayUrl(
  rawUrl: string | undefined | null,
  displayUrl?: string | null
): void {
  const url = String(rawUrl || "").trim();
  if (!url) return;
  const expected = displayUrl?.trim() || undefined;
  // Cell thumb pehle — shared hover `url` key tabhi clear jab wahi blob ho.
  forgetHoverBlobUrl(thumbCacheKey(url), expected);
  const hoverCached = peekHoverCachedBlobUrl(url);
  // `local:` shared key = raw file blob (FilePreview / open use it); a bad <img> thumb must not revoke it.
  if (hoverCached && !isLocalFileRef(url) && (!expected || hoverCached === expected)) {
    forgetHoverBlobUrl(url, expected);
  }
  // Explicit refresh (prefs change / <img> error): re-check whether the file exists now.
  clearAttachmentNoFile(url);
  requestAttachmentUiRefresh();
}

/** File column / indicator — warmed LRU se chhota image thumb; PDF first-page raster optional. */
export function useAttachmentThumbDisplayUrl(
  rawUrl: string | undefined | null,
  ready: boolean,
  companyIdProp?: string,
  refreshKey = 0,
  resolveFallback?: {
    voucherId?: string;
    clientFileUrls?: readonly string[] | null;
    filesNetworkAllowed?: boolean;
    /** Tick-only File column: run the same byte lookup (no thumb / no PDF raster) just to detect URL-only rows. */
    noFileProbeOnly?: boolean;
  }
): string | null {
  const { companyId: shellCid, company } = useCompany();
  const companyId = companyIdProp ?? shellCid;
  const url = String(rawUrl || "").trim();
  const fallbackClientFileUrlsKey =
    !resolveFallback?.clientFileUrls || resolveFallback.clientFileUrls.length === 0
      ? ""
      : resolveFallback.clientFileUrls.map((u) => String(u || "").trim()).join("\u0001");
  const [uiRefreshTick, setUiRefreshTick] = useState(() => getAttachmentUiRefreshTick());

  const [thumb, setThumb] = useState<string | null>(() => {
    if (!url) return null;
    if (isInlineImagePreviewUrl(url)) return url;
    return peekCachedCellThumb(url) ?? null;
  });

  useEffect(() => {
    ensureAttachmentUiRefreshListeners();
    if (!url) {
      setThumb(null);
      setUiRefreshTick(getAttachmentUiRefreshTick());
      return;
    }
    const readCached = () =>
      isInlineImagePreviewUrl(url)
        ? url
        : peekCachedCellThumb(url);

    const applyCached = () => {
      setUiRefreshTick(getAttachmentUiRefreshTick());
      const cached = readCached();
      if (cached) setThumb(cached);
    };
    applyCached();
    const unsub = subscribeAttachmentLoadStore(applyCached);
    return unsub;
  }, [url]);

  useEffect(() => {
    if (!url || refreshKey <= 0) return;
    const cached = peekCachedCellThumb(url);
    if (!cached) setThumb(null);
  }, [url, refreshKey]);

  /** Refresh / live-pull: offline disk se turant — existing cell-thumb blob mat overwrite/revoke. */
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      try {
        if (await isOfflineCachedAttachmentOnDevice(url)) {
          markAttachmentUrlReady(url);
        }
        const existingThumb = peekCachedCellThumb(url);
        if (existingThumb && !(isLocalFileRef(url) && (await isNonImageBlobObjectUrl(existingThumb)))) {
          if (!cancelled) setThumb(existingThumb);
          markAttachmentUrlReady(url);
          return;
        }
        const persistedThumb = await tryOfflineCachedAttachmentBlobMultiKey(thumbCacheKey(url));
        if (persistedThumb?.size) {
          const thumbUrl = URL.createObjectURL(persistedThumb);
          rememberHoverBlobUrl(thumbCacheKey(url), thumbUrl);
          if (!cancelled) setThumb(thumbUrl);
          markAttachmentUrlReady(url);
          return;
        }
        // PDF native displayUrl ko `<img>` mat — pehle sniff/raster path (neeche ready effect).
        if (isLocalFileRef(url)) return;
        const native = await getOfflineCachedAttachmentNativeRef(url);
        if (cancelled || !native?.displayUrl?.trim()) return;
        const ct = String(native.contentType || "").toLowerCase();
        if (ct.includes("pdf")) return;
        rememberHoverBlobUrl(url, native.displayUrl);
        rememberHoverBlobUrl(thumbCacheKey(url), native.displayUrl);
        markAttachmentUrlReady(url);
        setThumb(native.displayUrl);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, uiRefreshTick, refreshKey]);

  useEffect(() => {
    if (!url) return;
    const rawCached = peekCachedCellThumb(url);
    // local: blob thumb is verified async below (PDF blob under ::cell-thumb => raster path).
    const verifyLocalCached = Boolean(rawCached && isLocalFileRef(url) && /^blob:/i.test(rawCached));
    const cached = verifyLocalCached ? undefined : rawCached;
    if (cached) {
      setThumb(cached);
      // Portal/focus refresh: cache hit pe naya objectURL mat banao —
      // warna purana blob revoke → File column Preview → tick shift.
      // Sirf explicit invalidate (refreshKey / onError) par re-resolve.
      if (refreshKey <= 0) return;
    }
    if (!ready && !verifyLocalCached) return;
    // Session-cached "remote file has no bytes": do not refetch on every refresh tick.
    if (refreshKey <= 0 && isAttachmentNoFile(url)) return;
    const networkAllowed = resolveFallback?.filesNetworkAllowed !== false;

    let cancelled = false;
    void (async () => {
      try {
        if (verifyLocalCached && rawCached) {
          if (!(await isNonImageBlobObjectUrl(rawCached))) {
            if (!cancelled) setThumb(rawCached);
            if (refreshKey <= 0) return;
          } else {
            forgetHoverBlobUrl(thumbCacheKey(url), rawCached);
          }
        }
        if (!ready || cancelled) return;
        let blob: Blob | null = null;
        if (/^(data:|blob:)/i.test(url) && !isInlineImagePreviewUrl(url)) {
          try {
            blob = await fetch(url).then((res) => (res.ok ? res.blob() : null));
          } catch {
            blob = null;
          }
        }
        if (!blob?.size && isLocalFileRef(url)) {
          const { getBlobFromLocalFileRef } = await import("@/lib/localPendingFiles");
          blob = await getBlobFromLocalFileRef(url, { companyId: companyId ?? undefined });
        }
        if (!blob?.size) {
          const { isPbAttachmentRef, fetchPbAttachmentBlob } = await import(
            "@/lib/pocketbaseData/pbAttachments"
          );
          if (isPbAttachmentRef(url)) {
            blob = await fetchPbAttachmentBlob(url);
          }
        }
        if (
          !blob?.size &&
          isLocalFileRef(url) &&
          companyId &&
          resolveFallback?.voucherId &&
          networkAllowed
        ) {
          try {
            const { tryResolveRemoteUrlForStaleLocalAttachment } = await import(
              "@/lib/resolveVoucherAttachmentRemoteUrl"
            );
            const remoteUrl = await tryResolveRemoteUrlForStaleLocalAttachment(
              companyId,
              resolveFallback.voucherId,
              url,
              resolveFallback.clientFileUrls
            );
            if (remoteUrl && !isLocalFileRef(remoteUrl)) {
              if (looksLikeFirebaseStorageDownloadUrl(remoteUrl)) {
                blob = await tryGetBlobFromFirebaseStorageDownloadUrl(remoteUrl, undefined, {
                  companyId,
                });
              }
              if (!blob?.size) {
                blob = await getRemoteAttachmentBlobPreferOfflineCache(remoteUrl, undefined, {
                  companyId: companyId ?? undefined,
                  company,
                });
              }
              if (blob?.size) {
                void seedOfflineAttachmentCacheFromBlob(url, blob);
                void seedOfflineAttachmentCacheFromBlob(remoteUrl, blob);
              }
            }
          } catch {
            /* stale online fallback optional */
          }
        }
        if (!blob?.size && isLocalFileRef(url) && companyId) {
          const { resolvePlServerStaffAttachmentPreviewBlob } = await import("@/lib/plServerAttachmentFetch");
          blob = await resolvePlServerStaffAttachmentPreviewBlob(url, { companyId });
        }
        if (!networkAllowed && isRemoteHttpsAttachmentUrl(url)) {
          return;
        }
        if (!blob?.size && looksLikeFirebaseStorageDownloadUrl(url)) {
          blob = await tryGetBlobFromFirebaseStorageDownloadUrl(url, undefined, {
            companyId: companyId ?? undefined,
          });
        }
        if (!blob?.size) {
          blob = await getRemoteAttachmentBlobPreferOfflineCache(url, undefined, {
            companyId: companyId ?? undefined,
            company,
          });
        }
        if (cancelled) return;
        if (!blob?.size) {
          // URL-only row (ref present, no bytes anywhere). Definitive: server says 404/410/0 bytes.
          // Otherwise (CORS-blocked HEAD, Firebase object missing, `local:` ref never uploaded, relative/object-path ref)
          // the real load above (cache / SDK / fetch) already tried and returned nothing -> inferred verdict (memory, expires).
          const isHttp = /^https?:\/\//i.test(url);
          if (networkAllowed && !/^(data:|blob:)/i.test(url)) {
            if (isHttp && blob && blob.size === 0) {
              markAttachmentNoFile(url);
            } else {
              const verdict = isHttp ? await probeRemoteAttachmentBytes(url) : "unknown";
              if (cancelled) return;
              if (verdict === "no-bytes") {
                markAttachmentNoFile(url);
              } else if (
                verdict === "unknown" &&
                (typeof navigator === "undefined" || navigator.onLine !== false) &&
                isRemoteAttachmentNetworkFetchAllowed(url, {
                  companyId: companyId ?? undefined,
                  company,
                })
              ) {
                markAttachmentNoFileInferred(url);
              }
            }
          }
          return;
        }
        if (resolveFallback?.noFileProbeOnly) {
          // Bytes exist: nothing to render in tick-only mode; just drop any stale "no file" verdict.
          clearAttachmentNoFile(url);
          return;
        }
        const kind = await sniffBlobKindForPreview(blob);
        if (kind === "image") {
          const typed =
            blob.type?.startsWith("image/") && blob.type !== "application/octet-stream"
              ? blob
              : new Blob([await blob.arrayBuffer()], { type: "image/jpeg" });
          const ou = URL.createObjectURL(typed);
          // Cell thumb alag key — hover portal `url` key overwrite se revoke na ho.
          // Full LRU me cell-thumb mat seed — portal/open blurry 300% zoom avoid.
          rememberHoverBlobUrl(thumbCacheKey(url), ou);
          if (!cancelled) setThumb(ou);
          markAttachmentUrlReady(url);
          clearAttachmentNoFile(url);
          return;
        }
        if (kind === "pdf") {
          const pdfBlob =
            blob.type === "application/pdf"
              ? blob
              : new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
          const { convertPdfFirstPageToImage } = await import("@/lib/pdfToImage");
          const result = await convertPdfFirstPageToImage(pdfBlob, 0.55, 96);
          rememberHoverBlobUrl(thumbCacheKey(url), result.thumbnailUrl);
          void seedOfflineAttachmentCacheFromBlob(thumbCacheKey(url), result.thumbnailBlob);
          if (!cancelled) setThumb(result.thumbnailUrl);
          markAttachmentUrlReady(url);
          clearAttachmentNoFile(url);
          if (!peekHoverCachedBlobUrl(pdfPortalCacheKey(url))) {
            void convertPdfFirstPageToImage(pdfBlob, 0.92, 1800)
              .then((full) => {
                rememberHoverBlobUrl(pdfPortalCacheKey(url), full.thumbnailUrl);
                void seedOfflineAttachmentCacheFromBlob(pdfPortalCacheKey(url), full.thumbnailBlob);
              })
              .catch(() => undefined);
          }
        }
      } catch {
        /* thumb optional — Preview mode placeholder / tick-only fallback */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    url,
    ready,
    companyId,
    uiRefreshTick,
    refreshKey,
    resolveFallback?.voucherId,
    fallbackClientFileUrlsKey,
    resolveFallback?.filesNetworkAllowed,
    resolveFallback?.noFileProbeOnly,
  ]);

  return thumb;
}
