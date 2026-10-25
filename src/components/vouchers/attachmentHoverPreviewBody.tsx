"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openAttachmentInApp } from "@/lib/openAttachmentInApp";
import { isOnlineCompanyAttachmentNetworkAllowed } from "@/lib/onlineCompanySelectorSyncPolicy";
import { tryGetStoragePathFromFirebaseDownloadUrl, looksLikeFirebaseStorageObjectPath } from "@/lib/firebaseStorageDownloadUrl";
import {
  isLocalFileRef,
  getLocalFileRefMeta,
  getLocalFileRefMetaSync,
  getBlobFromLocalFileRef,
} from "@/lib/localPendingFiles";
import {
  VoucherAttachmentFallbackContext,
  useVoucherAttachmentFallback,
} from "@/contexts/VoucherAttachmentFallbackContext";
import {
  getAttachmentFormatLabel,
  getAttachmentFormatLabelFromHints,
  sniffBlobKindForPreview,
} from "@/lib/attachmentFormatLabel";

/**
 * `local:<uuid>` has no extension => URL label is "FILE". Use pending-file meta hints; when still unknown
 * return "LOCAL_UNKNOWN" so the portal does NOT paint the raw blob as <img> (PDF => blank) but sniffs bytes.
 */
function portalFormatLabel(url: string): string {
  const fmt = getAttachmentFormatLabel(url);
  if (fmt !== "FILE" || !isLocalFileRef(url)) return fmt;
  const meta = getLocalFileRefMetaSync(url);
  return getAttachmentFormatLabelFromHints(meta?.fileName ?? null, meta?.contentType ?? null) || "LOCAL_UNKNOWN";
}
import {
  getRemoteAttachmentBlobPreferOfflineCache,
  seedOfflineAttachmentCacheFromBlob,
  tryOfflineCachedAttachmentBlobMultiKey,
} from "@/lib/offlineAttachmentUrlCache";
import {
  embeddedAttachmentDisplayUsesLocalBytesOnly,
  usesEmbeddedNativeAttachmentStorage,
} from "@/lib/usesEmbeddedNativeAttachmentStorage";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { normalizeAttachmentUrlForDevicePreview } from "@/lib/attachmentHoldClipboard";
import { forgetHoverBlobUrl, peekHoverCachedBlobUrl, rememberHoverBlobUrl } from "@/lib/attachmentHoverBlobCache";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { useCompany } from "@/hooks/useCompany";
import { readActiveAttachmentCompanyId } from "@/lib/firestorePermissionSuppress";
import { canFetchPlServerAttachmentForCompany } from "@/lib/plServerAttachmentFetch";
import { requestAttachmentUiRefresh } from "@/lib/attachmentLoadReady";
import {
  grantExplicitAttachmentNetworkFetch,
  isOnlineCompanyAttachmentFilesTickEnabled,
} from "@/lib/attachmentNetworkGate";
import {
  companyAttachmentMode,
  companyRequiresLocalAttachmentUrlsOnly,
  resolveStaticAttachmentDisplay,
} from "@/lib/staticAttachmentDisplayUrl";
import type { CompanyAttachmentMode } from "@/lib/companyAttachmentStrategies/types";
import { useAttachmentPreviewGallery } from "@/components/vouchers/attachmentPreviewGalleryContext";

export async function prewarmHoverPreviewHttpsUrls(
  urls: readonly string[],
  options?: { signal?: AbortSignal; maxUrls?: number; companyId?: string }
): Promise<void> {
  // Idle path: visible rows ke liye LRU + `getRemoteAttachmentBlobPreferOfflineCache` — hover turant; app-start par global preload nahi.
  // Poori company bytes background: `CompanyAttachmentOfflineBackfillManager` / `runEmbeddedAttachmentPrefetchPhase` + ab wahan `prioritizeUrls` bhi.
  // HTTPS signed URLs + raw Storage object-path + `local:`/`drive:` device refs — offline avatar / hover dono IndexedDB se hit.
  const maxUrls = Math.max(1, Math.min(400, options?.maxUrls ?? 200));
  const { readActiveAttachmentCompanyId } = await import("@/lib/firestorePermissionSuppress");
  const companyId = options?.companyId ?? readActiveAttachmentCompanyId() ?? undefined;
  if (companyId && !isOnlineCompanyAttachmentFilesTickEnabled(companyId)) {
    return;
  }
  const unique = [...new Set(urls.map((u) => String(u || "").trim()).filter((u) => {
    // Transaction table visible rows: HTTPS + raw Storage path + Drive/local refs warm.
    return (
      /^https?:\/\//i.test(u) ||
      looksLikeFirebaseStorageObjectPath(u) ||
      isLocalFileRef(u) ||
      isDriveFileRef(u)
    );
  }))].slice(0, maxUrls);
  const { markAttachmentUrlReady } = await import("@/lib/attachmentLoadReady");

  const warmOne = async (url: string): Promise<void> => {
    if (options?.signal?.aborted) return;
    if (peekHoverCachedBlobUrl(url)) {
      markAttachmentUrlReady(url);
      return;
    }
    try {
      let blob: Blob | null = null;
      if (isLocalFileRef(url) && companyId) {
        const { resolvePlServerStaffAttachmentPreviewBlob } = await import("@/lib/plServerAttachmentFetch");
        blob = await resolvePlServerStaffAttachmentPreviewBlob(url, {
          companyId,
          signal: options?.signal,
        });
      }
      if (!blob?.size) {
        blob = await getRemoteAttachmentBlobPreferOfflineCache(url, options?.signal, { companyId });
      }
      if (!blob || blob.size === 0) return;
      const kind = await sniffBlobKindForPreview(blob);
      const mime =
        kind === "pdf"
          ? "application/pdf"
          : kind === "image"
            ? blob.type?.startsWith("image/")
              ? blob.type
              : "image/jpeg"
            : blob.type || "application/octet-stream";
      const typed =
        blob.type === mime || (kind === "image" && blob.type?.startsWith("image/"))
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: mime });
      const objectUrl = URL.createObjectURL(typed);
      rememberHoverBlobUrl(url, objectUrl);
      markAttachmentUrlReady(url);
    } catch {
      // Visible-list warm is best-effort; hover open path will still fetch on demand if needed.
    }
  };

  // Parallel pool — serial await made PL-server gallery page flips ~20s for 10 thumbs.
  const pool = Math.min(8, Math.max(1, unique.length));
  let cursor = 0;
  const workers = Array.from({ length: pool }, async () => {
    while (cursor < unique.length) {
      if (options?.signal?.aborted) return;
      const i = cursor++;
      await warmOne(unique[i]!);
    }
  });
  await Promise.all(workers);
}

export async function prewarmVisibleAttachmentRefsForInstantOpen(
  urls: readonly string[],
  options?: { signal?: AbortSignal; maxUrls?: number; companyId?: string }
): Promise<void> {
  // Instant-open behavior: visible rows ke attachments ko same prewarm pipeline se pehle hydrate karo.
  await prewarmHoverPreviewHttpsUrls(urls, options);
}

/** EXE preview: download + disk write — isse zyada mat wait karo; retry dikhao. */
const EMBEDDED_PREVIEW_DOWNLOAD_TIMEOUT_MS = 28_000;
const PDF_HOVER_RASTER_TIMEOUT_MS = 45_000;

/** Full-quality portal raster only — never `::cell-thumb` (tiny Fit-window 100%). */
function pdfPortalCacheKey(url: string): string {
  return `${url}::pdf-portal-v2`;
}

function pdfPortalCacheKeyLegacy(url: string): string {
  return `${url}::pdf-portal`;
}

function peekPdfPortalCachedBlobUrl(url: string): string | null {
  return (
    peekHoverCachedBlobUrl(pdfPortalCacheKey(url)) ||
    peekHoverCachedBlobUrl(pdfPortalCacheKeyLegacy(url)) ||
    null
  );
}

async function peekPersistedPdfPortalBlob(url: string): Promise<Blob | null> {
  try {
    const { tryOfflineCachedAttachmentBlobMultiKey } = await import("@/lib/offlineAttachmentUrlCache");
    return (
      (await tryOfflineCachedAttachmentBlobMultiKey(pdfPortalCacheKey(url))) ||
      (await tryOfflineCachedAttachmentBlobMultiKey(pdfPortalCacheKeyLegacy(url))) ||
      null
    );
  } catch {
    return null;
  }
}

function rememberPdfPortalRaster(urlKey: string, rasterUrl: string, rasterBlob?: Blob | null): void {
  rememberHoverBlobUrl(pdfPortalCacheKey(urlKey), rasterUrl);
  rememberHoverBlobUrl(pdfPortalCacheKeyLegacy(urlKey), rasterUrl);
  if (rasterBlob && rasterBlob.size > 0) {
    void seedOfflineAttachmentCacheFromBlob(pdfPortalCacheKey(urlKey), rasterBlob);
    void seedOfflineAttachmentCacheFromBlob(pdfPortalCacheKeyLegacy(urlKey), rasterBlob);
  }
}

type PortalPdfRasterMeta = { pageCount: number; onePageHeightPx: number };

const portalPdfMetaByCacheKey = new Map<string, PortalPdfRasterMeta>();

function rememberPortalPdfMeta(urlKey: string, meta: PortalPdfRasterMeta | undefined): void {
  if (!meta || meta.pageCount <= 1 || meta.onePageHeightPx < 1) return;
  const key = pdfPortalCacheKey(urlKey);
  portalPdfMetaByCacheKey.set(key, meta);
  portalPdfMetaByCacheKey.set(pdfPortalCacheKeyLegacy(urlKey), meta);
  try {
    sessionStorage.setItem(`pl-portal-pdf-meta:${key}`, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

function peekPortalPdfMeta(urlKey: string): PortalPdfRasterMeta | undefined {
  const key = pdfPortalCacheKey(urlKey);
  const mem =
    portalPdfMetaByCacheKey.get(key) || portalPdfMetaByCacheKey.get(pdfPortalCacheKeyLegacy(urlKey));
  if (mem) return mem;
  try {
    const raw = sessionStorage.getItem(`pl-portal-pdf-meta:${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PortalPdfRasterMeta;
    if (parsed.pageCount > 1 && parsed.onePageHeightPx > 1) {
      portalPdfMetaByCacheKey.set(key, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** EXE/APK: pl-attachments / blob cache; web: online par HTTPS allowed. */
function HoverPreviewHttpsAwareImage(props: {
  url: string;
  alt?: string;
  className?: string;
  loading?: React.ImgHTMLAttributes<HTMLImageElement>["loading"];
  onDoubleClick?: React.MouseEventHandler<HTMLImageElement>;
  localLedgerOnly?: boolean;
  /** Company Selector Files tick — network download/upload. */
  filesNetworkAllowed?: boolean;
  companyId?: string;
  companyMode?: CompanyAttachmentMode;
}) {
  const u = String(props.url || "");
  const localBytesOnly = props.localLedgerOnly === true || embeddedAttachmentDisplayUsesLocalBytesOnly();
  const filesNetworkAllowed = props.filesNetworkAllowed !== false;
  const [displaySrc, setDisplaySrc] = React.useState<string>(() => {
    if (!/^https?:\/\//i.test(u)) {
      if (u.startsWith("blob:") || u.startsWith("data:")) return u;
      const fromLru = peekHoverCachedBlobUrl(u);
      if (fromLru) return fromLru;
      return "";
    }
    const fromLru = peekHoverCachedBlobUrl(u);
    if (fromLru) return fromLru;
    // Files untick / local-only: raw HTTPS mat — pehle IndexedDB/blob cache.
    if (
      !localBytesOnly &&
      filesNetworkAllowed &&
      typeof navigator !== "undefined" &&
      navigator.onLine
    ) {
      return u;
    }
    return "";
  });
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    setReloadKey(0);
  }, [u]);

  React.useEffect(() => {
    if (filesNetworkAllowed && props.companyId && /^https?:\/\//i.test(u)) {
      grantExplicitAttachmentNetworkFetch(u, props.companyId);
    }
  }, [u, filesNetworkAllowed, props.companyId]);

  React.useEffect(() => {
    let cancelled = false;
    let blobUrlToRevoke: string | null = null;
    setLoadFailed(false);
    const ac = new AbortController();
    const timeoutId =
      localBytesOnly && typeof window !== "undefined"
        ? window.setTimeout(() => ac.abort(), EMBEDDED_PREVIEW_DOWNLOAD_TIMEOUT_MS)
        : undefined;

    const applyResolved = (displayUrl: string | null, blob: Blob | null) => {
      if (cancelled) return;
      if (displayUrl) {
        // Local-only: HTTPS displayUrl mat — network gate bypass ho jata.
        if (localBytesOnly && /^https?:\/\//i.test(displayUrl)) {
          /* fall through to blob / fail */
        } else {
          setLoadFailed(false);
          setDisplaySrc(displayUrl);
          if (!localBytesOnly && /^https?:\/\//i.test(displayUrl)) {
            void import("@/lib/offlineAttachmentUrlCache")
              .then(({ getRemoteAttachmentBlobPreferOfflineCache }) =>
                getRemoteAttachmentBlobPreferOfflineCache(displayUrl, ac.signal, {
                  companyId: props.companyId,
                  awaitDiskWrite: false,
                })
              )
              .then((cached) => {
                if (cancelled || !cached || cached.size <= 0) return;
                const ou = URL.createObjectURL(cached);
                rememberHoverBlobUrl(u, ou);
              })
              .catch(() => {});
          }
          return;
        }
      }
      if (blob && blob.size > 0) {
        const ou = URL.createObjectURL(blob);
        rememberHoverBlobUrl(u, ou);
        blobUrlToRevoke = ou;
        setLoadFailed(false);
        setDisplaySrc(ou);
        return;
      }
      if (
        !localBytesOnly &&
        filesNetworkAllowed &&
        typeof navigator !== "undefined" &&
        navigator.onLine &&
        /^https?:\/\//i.test(u)
      ) {
        setLoadFailed(false);
        setDisplaySrc(u);
        // Web pe raw HTTPS dikha — IndexedDB me likho taaki Files untick ke baad local open chale.
        void import("@/lib/offlineAttachmentUrlCache")
          .then(({ getRemoteAttachmentBlobPreferOfflineCache }) =>
            getRemoteAttachmentBlobPreferOfflineCache(u, ac.signal, {
              companyId: props.companyId,
              awaitDiskWrite: false,
              explicitUserRequest: true,
            })
          )
          .then((cached) => {
            if (cancelled || !cached || cached.size <= 0) return;
            const ou = URL.createObjectURL(cached);
            rememberHoverBlobUrl(u, ou);
          })
          .catch(() => {});
      } else {
        setDisplaySrc("");
        setLoadFailed(true);
      }
    };

    if (!/^https?:\/\//i.test(u)) {
      if (u.startsWith("blob:") || u.startsWith("data:")) {
        setDisplaySrc(u);
        return () => {
          cancelled = true;
        };
      }
      setDisplaySrc((prev) => (prev.startsWith("blob:") || prev.startsWith("data:") ? prev : prev || ""));
      void resolveStaticAttachmentDisplay(u, {
        localLedgerOnly: localBytesOnly,
        companyMode: props.companyMode,
        signal: ac.signal,
        companyId: props.companyId,
      })
        .then((resolved) => {
          applyResolved(resolved.displayUrl, resolved.blob);
        })
        .catch(() => {
          applyResolved(null, null);
        });
      return () => {
        cancelled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        ac.abort();
        if (blobUrlToRevoke && peekHoverCachedBlobUrl(u) !== blobUrlToRevoke) {
          try {
            URL.revokeObjectURL(blobUrlToRevoke);
          } catch {
            /* ignore */
          }
        }
      };
    }

    const cached = peekHoverCachedBlobUrl(u);
    if (cached) {
      setDisplaySrc(cached);
      return () => {
        cancelled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        ac.abort();
      };
    }

    const isHttps = /^https?:\/\//i.test(u);
    const online = typeof navigator !== "undefined" && navigator.onLine;
    const canInstantHttps = isHttps && online && !localBytesOnly && filesNetworkAllowed;

    // Local-only: purana raw HTTPS src mat rakho (Files untick ke baad network leak).
    if (!canInstantHttps) {
      setDisplaySrc((prev) => {
        if (prev.startsWith("blob:") || prev.startsWith("data:")) return prev;
        return "";
      });
    } else {
      setDisplaySrc((prev) => prev || u);
    }

    void resolveStaticAttachmentDisplay(u, {
      localLedgerOnly: localBytesOnly,
      companyMode: props.companyMode,
      signal: ac.signal,
      companyId: props.companyId,
    })
      .then((resolved) => {
        if (cancelled) return;
        if (canInstantHttps) {
          if (resolved.blob && resolved.blob.size > 0) {
            applyResolved(resolved.displayUrl, resolved.blob);
            return;
          }
          applyResolved(resolved.displayUrl || u, null);
          return;
        }
        applyResolved(resolved.displayUrl, resolved.blob);
      })
      .catch(() => {
        if (!canInstantHttps) applyResolved(null, null);
      });

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      ac.abort();
      if (blobUrlToRevoke && peekHoverCachedBlobUrl(u) !== blobUrlToRevoke) {
        try {
          URL.revokeObjectURL(blobUrlToRevoke);
        } catch {
          /* ignore */
        }
      }
    };
  }, [u, localBytesOnly, filesNetworkAllowed, props.companyId, props.companyMode, reloadKey]);

  if (!displaySrc) {
    if (loadFailed) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const failHint = !filesNetworkAllowed
        ? "Turn on Files in Company Selector (Online tab), then Save — or check your network. Already downloaded files still open."
        : offline
          ? "Connect once online to download, or wait for background sync. Or turn on Files in Company Selector if it is off."
          : "Check Files tick in Company Selector (Online tab) and Save, or check your network — then retry.";
      return (
        <div className="flex min-h-[200px] min-w-[220px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <span>File not on this device</span>
          <span className="text-xs opacity-80">{failHint}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setLoadFailed(false);
              setDisplaySrc("");
              setReloadKey((k) => k + 1);
            }}
          >
            {filesNetworkAllowed ? "Retry download" : "Retry local"}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex min-h-[200px] min-w-[220px] flex-col items-center justify-center gap-2 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading preview" />
        {localBytesOnly ? (
          <span className="text-xs text-muted-foreground">
            {filesNetworkAllowed ? "Loading from device…" : "Looking for local file…"}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob: / path / remote fallback
    <img
      src={displaySrc}
      alt={props.alt ?? ""}
      draggable={false}
      className={props.className}
      loading={props.loading}
      onDoubleClick={props.onDoubleClick}
      onError={() => {
        forgetHoverBlobUrl(u, displaySrc);
        if (reloadKey >= 2) {
          setDisplaySrc("");
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        setDisplaySrc("");
        setReloadKey((n) => n + 1);
        requestAttachmentUiRefresh();
      }}
    />
  );
}

/** Multi-file row / local pending: gallery swipe App me */
export type AttachmentPreviewGalleryOpts = { urls: readonly string[]; startIndex: number };

/** Portal raster — single page ya multi-page stitched JPEG; portal scroll se saari pages. */
function PdfPortalRasterImg({
  src,
  onOpen,
  portalMeta,
}: {
  src: string;
  onOpen: () => void;
  portalMeta?: PortalPdfRasterMeta | null;
}) {
  const [derivedMeta, setDerivedMeta] = React.useState<PortalPdfRasterMeta | null>(null);
  const effectiveMeta = portalMeta ?? derivedMeta;
  const multi = effectiveMeta && effectiveMeta.pageCount > 1 && effectiveMeta.onePageHeightPx > 1;

  React.useEffect(() => {
    if (!multi) return;
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [multi, effectiveMeta?.pageCount, effectiveMeta?.onePageHeightPx]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!portalMeta && img.naturalWidth > 1 && img.naturalHeight > 1) {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const estPageH = nw * (297 / 210);
      const pageRatio = nh / estPageH;
      if (pageRatio >= 1.32) {
        const pages = Math.max(2, Math.round(pageRatio));
        setDerivedMeta({ pageCount: pages, onePageHeightPx: nh / pages });
      }
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  };

  return (
    // eslint-disable-next-line @next/next/no-img-element -- pdf.js portal raster
    <img
      data-pdf-portal-page="1"
      {...(multi
        ? {
            "data-pdf-portal-pages": String(effectiveMeta!.pageCount),
            "data-pdf-portal-one-page-h": String(Math.round(effectiveMeta!.onePageHeightPx)),
          }
        : {})}
      src={src}
      alt=""
      draggable={false}
      className="block h-auto w-auto max-h-none max-w-none object-contain"
      loading="eager"
      onLoad={handleLoad}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    />
  );
}

function HttpsPdfPortalHoverPreview({
  url,
  onOpen,
  companyId,
}: {
  url: string;
  onOpen: () => void;
  companyId?: string | null;
}) {
  const effectiveUrl = React.useMemo(() => normalizeAttachmentUrlForDevicePreview(url), [url]);

  React.useEffect(() => {
    if (companyId) grantExplicitAttachmentNetworkFetch(effectiveUrl, companyId);
  }, [effectiveUrl, companyId]);

  const portalCached = peekPdfPortalCachedBlobUrl(effectiveUrl);
  if (portalCached) {
    return (
      <PdfPortalRasterImg
        src={portalCached}
        portalMeta={peekPortalPdfMeta(effectiveUrl)}
        onOpen={onOpen}
      />
    );
  }

  const cellThumb = peekHoverCachedBlobUrl(`${effectiveUrl}::cell-thumb`);
  // STRICT (parked): cell-thumb mat pass — portal pe tiny thumb freeze.
  // return (
  //   <LocalPdfBlobHoverPreview
  //     sourceUrl={effectiveUrl}
  //     onOpen={onOpen}
  //     companyId={companyId}
  //     portalCacheKey={effectiveUrl}
  //   />
  // );
  return (
    <LocalPdfBlobHoverPreview
      sourceUrl={effectiveUrl}
      onOpen={onOpen}
      instantThumbUrl={cellThumb}
      companyId={companyId}
      portalCacheKey={effectiveUrl}
    />
  );
}

/**
 * Portal PDF raster. STRICT (parked): cell-thumb kabhi final nahi.
 * Filhal: instantThumbUrl se pehle paint, phir full portal upgrade.
 */
function LocalPdfBlobHoverPreview({
  sourceUrl,
  blob,
  onOpen,
  instantThumbUrl,
  companyId,
  portalCacheKey,
}: {
  sourceUrl: string;
  blob?: Blob | null;
  onOpen: () => void;
  instantThumbUrl?: string | null;
  companyId?: string | null;
  portalCacheKey?: string;
}) {
  const cacheKey = portalCacheKey || sourceUrl;
  // STRICT (parked): only peekPdfPortalCachedBlobUrl — no instantThumbUrl initial.
  // const [thumbUrl, setThumbUrl] = React.useState<string | null>(() => peekPdfPortalCachedBlobUrl(cacheKey));
  // const [loading, setLoading] = React.useState(() => !peekPdfPortalCachedBlobUrl(cacheKey));
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(
    () => peekPdfPortalCachedBlobUrl(cacheKey) || instantThumbUrl || null
  );
  const [loading, setLoading] = React.useState(
    () => !peekPdfPortalCachedBlobUrl(cacheKey) && !instantThumbUrl
  );

  React.useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), PDF_HOVER_RASTER_TIMEOUT_MS);
    void (async () => {
      try {
        const already = peekPdfPortalCachedBlobUrl(cacheKey);
        if (already) {
          if (!cancelled) {
            setThumbUrl(already);
            setLoading(false);
          }
          return;
        }
        // STRICT (parked): setLoading(true); setThumbUrl(null);
        if (!instantThumbUrl) {
          setLoading(true);
          setThumbUrl(null);
        }

        const persisted = await peekPersistedPdfPortalBlob(cacheKey);
        if (persisted?.size && !cancelled) {
          const portalUrl = URL.createObjectURL(persisted);
          rememberPdfPortalRaster(cacheKey, portalUrl, persisted);
          setThumbUrl(portalUrl);
          setLoading(false);
          return;
        }

        let pdfBlob = blob && blob.size > 0 ? blob : null;
        if (!pdfBlob?.size) {
          pdfBlob = await getRemoteAttachmentBlobPreferOfflineCache(sourceUrl, ac.signal, {
            companyId: companyId ?? undefined,
            explicitUserRequest: true,
          });
        }
        if (!pdfBlob?.size) {
          try {
            const { getBlobFromAttachmentRefPreferLocalFirst } = await import(
              "@/lib/attachmentPreviewResolve"
            );
            pdfBlob = await getBlobFromAttachmentRefPreferLocalFirst(sourceUrl, {
              companyId: companyId ?? undefined,
            });
          } catch {
            /* optional */
          }
        }
        if (!pdfBlob?.size && isLocalFileRef(sourceUrl)) {
          pdfBlob = await getBlobFromLocalFileRef(sourceUrl, {
            companyId: companyId ?? undefined,
          });
        }
        if (!pdfBlob?.size && (sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:"))) {
          pdfBlob = await fetch(sourceUrl, { signal: ac.signal }).then((r) => (r.ok ? r.blob() : null));
        }
        if (ac.signal.aborted || cancelled) return;
        if (!pdfBlob?.size) throw new Error("empty_pdf");
        const kind = await sniffBlobKindForPreview(pdfBlob);
        // Offline cache kabhi cell-thumb JPEG ko full URL pe store karta hai — reject.
        if (kind !== "pdf") throw new Error("not_pdf");
        if (pdfBlob.type !== "application/pdf") {
          pdfBlob = new Blob([await pdfBlob.arrayBuffer()], { type: "application/pdf" });
        }
        const { convertPdfForPortalRasterPreview } = await import("@/lib/pdfToImageExport");
        const result = await convertPdfForPortalRasterPreview(pdfBlob, {
          quality: 0.92,
          maxPageWidth: 1800,
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) {
          URL.revokeObjectURL(result.thumbnailUrl);
          return;
        }
        rememberPdfPortalRaster(cacheKey, result.thumbnailUrl, result.thumbnailBlob);
        rememberPortalPdfMeta(cacheKey, result.portalMeta);
        setThumbUrl(result.thumbnailUrl);
      } catch {
        if (!cancelled && !instantThumbUrl) setThumbUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      ac.abort();
    };
  }, [sourceUrl, blob, companyId, cacheKey, instantThumbUrl]);

  if (loading && !thumbUrl) {
    return (
      <div className="flex min-h-[280px] min-w-[280px] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading full PDF preview" />
      </div>
    );
  }
  if (!thumbUrl) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <span>PDF full preview could not load — Open for full size</span>
        <Button type="button" size="sm" variant="secondary" onClick={onOpen}>
          Open PDF
        </Button>
      </div>
    );
  }
  return <PdfPortalRasterImg src={thumbUrl} portalMeta={peekPortalPdfMeta(cacheKey)} onOpen={onOpen} />;
}

/** `local:` / `drive:` / `PL_ATTACH_V1` — PC hover preview: local/pending pehle, phir Drive (HTTPS image path alag). */
export function LocalFileRefTooltipPreview({
  url,
  gallery,
  companyId: companyIdProp,
}: {
  url: string;
  gallery?: AttachmentPreviewGalleryOpts;
  companyId?: string | null;
}) {
  const voucherAttachmentFb = useVoucherAttachmentFallback();
  const { company } = useCompany();
  const companyId =
    companyIdProp ??
    voucherAttachmentFb?.companyId ??
    company?.id ??
    readActiveAttachmentCompanyId() ??
    null;
  const effectiveUrl = React.useMemo(() => normalizeAttachmentUrlForDevicePreview(url), [url]);
  const galleryUrlsKey = gallery?.urls?.join("\x1e") ?? "";
  const galleryDepKey =
    gallery && gallery.urls.length > 1 ? `${gallery.startIndex}:${galleryUrlsKey}` : galleryUrlsKey;

  const initialCached = React.useMemo(() => {
    const pdfPortal = peekPdfPortalCachedBlobUrl(effectiveUrl);
    if (pdfPortal) return { objectUrl: pdfPortal, mime: "image/jpeg" as const, fromCellThumb: false };
    const full = peekHoverCachedBlobUrl(effectiveUrl);
    const fmt = portalFormatLabel(effectiveUrl);
    // STRICT (parked): PDF pe cell-thumb initial mat.
    // if (fmt === "PDF") {
    //   if (full) return { objectUrl: full, mime: "application/pdf" as const, fromCellThumb: false };
    //   return null;
    // }
    // if (full) return { objectUrl: full, mime: "image/jpeg" as const, fromCellThumb: false };
    // return null;
    if (fmt === "LOCAL_UNKNOWN") return null;
    if (fmt === "PDF" && !full) return null;
    const cellThumb = peekHoverCachedBlobUrl(`${effectiveUrl}::cell-thumb`);
    const cachedPreviewUrl = full || cellThumb;
    if (!cachedPreviewUrl) return null;
    if (full) {
      if (fmt === "PDF") {
        return { objectUrl: full, mime: "application/pdf" as const, fromCellThumb: false };
      }
      return { objectUrl: full, mime: "image/jpeg" as const, fromCellThumb: false };
    }
    return { objectUrl: cellThumb!, mime: "image/jpeg" as const, fromCellThumb: true };
  }, [effectiveUrl]);

  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; objectUrl: string; mime: string; blob?: Blob; fromCellThumb?: boolean }
  >(() =>
    initialCached
      ? {
          status: "ready",
          objectUrl: initialCached.objectUrl,
          mime: initialCached.mime,
          fromCellThumb: initialCached.fromCellThumb,
        }
      : { status: "loading" }
  );
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const urlRef = { current: null as string | null };
    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), EMBEDDED_PREVIEW_DOWNLOAD_TIMEOUT_MS);
    const cid = companyId ?? readActiveAttachmentCompanyId() ?? undefined;

    const cellThumb = peekHoverCachedBlobUrl(`${effectiveUrl}::cell-thumb`);
    const pdfPortal = peekPdfPortalCachedBlobUrl(effectiveUrl);
    const fullCached = peekHoverCachedBlobUrl(effectiveUrl);
    if (pdfPortal) {
      setState({ status: "ready", objectUrl: pdfPortal, mime: "image/jpeg", fromCellThumb: false });
      window.clearTimeout(timeoutId);
      return () => {
        cancelled = true;
        ac.abort();
      };
    }
    void (async () => {
      try {
        const persistedPortal = await peekPersistedPdfPortalBlob(effectiveUrl);
        if (cancelled || !persistedPortal?.size) return;
        const portalUrl = URL.createObjectURL(persistedPortal);
        urlRef.current = portalUrl;
        rememberPdfPortalRaster(effectiveUrl, portalUrl, persistedPortal);
        setState({ status: "ready", objectUrl: portalUrl, mime: "image/jpeg", fromCellThumb: false });
        window.clearTimeout(timeoutId);
      } catch {
        /* optional */
      }
    })();
    if (fullCached) {
      const fmt = portalFormatLabel(effectiveUrl);
      if (fmt === "LOCAL_UNKNOWN") {
        // Unknown local bytes (often PDF): sniff + raster in the async path below.
        setState({ status: "loading" });
      } else if (fmt === "PDF") {
        setState({ status: "ready", objectUrl: fullCached, mime: "application/pdf", fromCellThumb: false });
        // Continue async — attach blob / optional upgrade.
      } else {
        setState({
          status: "ready",
          objectUrl: fullCached,
          mime: "image/jpeg",
          fromCellThumb: false,
        });
        window.clearTimeout(timeoutId);
        return () => {
          cancelled = true;
          ac.abort();
        };
      }
    } else if (cellThumb && getAttachmentFormatLabel(effectiveUrl) !== "PDF") {
      // Instant paint from cell thumb, then continue async to upgrade to full bytes.
      setState({ status: "ready", objectUrl: cellThumb, mime: "image/jpeg", fromCellThumb: true });
    } else {
      // STRICT (parked): cell-thumb se portal ready mat.
      setState({ status: "loading" });
    }

    void (async () => {
      try {
        let blob: Blob | null = null;

        if (fullCached) {
          try {
            const fromHover = await fetch(fullCached, { signal: ac.signal }).then((r) =>
              r.ok ? r.blob() : null
            );
            if (fromHover && fromHover.size > 0) blob = fromHover;
          } catch {
            /* fall through */
          }
        }

        if (!blob?.size) {
          try {
            const { tryOfflineCachedAttachmentBlobMultiKey } = await import(
              "@/lib/offlineAttachmentUrlCache"
            );
            blob = await tryOfflineCachedAttachmentBlobMultiKey(effectiveUrl);
          } catch {
            /* cache optional */
          }
        }

        const { isPlRemoteServerClientMode, isPlSharingServerPortOrigin } = await import(
          "@/lib/plRemoteServerClient"
        );
        const staffRemote = isPlRemoteServerClientMode() || isPlSharingServerPortOrigin();
        if (!blob?.size && !staffRemote && isLocalFileRef(effectiveUrl)) {
          blob = await getBlobFromLocalFileRef(effectiveUrl, {
            companyId: cid,
          });
        }
        if (
          !blob?.size &&
          !staffRemote &&
          usesEmbeddedNativeAttachmentStorage() &&
          isLocalFileRef(effectiveUrl)
        ) {
          const meta = getLocalFileRefMetaSync(effectiveUrl) ?? (await getLocalFileRefMeta(effectiveUrl));
          if (meta?.displayUrl && (meta.filePath || meta.fileUri)) {
            try {
              const fetched = await fetch(meta.displayUrl, { signal: ac.signal }).then((r) =>
                r.ok ? r.blob() : null
              );
              if (fetched && fetched.size > 0) blob = fetched;
            } catch {
              /* fall through */
            }
          }
        }
        if (!blob || blob.size <= 0) {
          const { resolvePlServerStaffAttachmentPreviewBlob } = await import("@/lib/plServerAttachmentFetch");
          blob = await resolvePlServerStaffAttachmentPreviewBlob(effectiveUrl, {
            galleryUrls: gallery?.urls,
            companyId: cid,
            signal: ac.signal,
          });
        }
        if (
          !blob?.size &&
          /^https?:\/\//i.test(effectiveUrl) &&
          !ac.signal.aborted
        ) {
          try {
            blob = await getRemoteAttachmentBlobPreferOfflineCache(effectiveUrl, ac.signal, {
              companyId: cid,
              explicitUserRequest: true,
            });
          } catch {
            /* fall through */
          }
        }
        if (cancelled) return;
        if (!blob || blob.size === 0) {
          console.warn("[attachmentPreview] no bytes for attachment", effectiveUrl);
          setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
          return;
        }
        let mime = String(blob.type || "application/octet-stream").toLowerCase();
        if (mime === "application/octet-stream" || !blob.type || mime === "binary/octet-stream") {
          const kind = await sniffBlobKindForPreview(blob);
          if (kind === "pdf") mime = "application/pdf";
          else if (kind === "image") mime = "image/jpeg";
        }
        if (mime.includes("pdf") && blob.type !== "application/pdf") {
          blob = new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
          mime = "application/pdf";
        }
        if (mime.includes("pdf")) {
          const { convertPdfForPortalRasterPreview } = await import("@/lib/pdfToImageExport");
          const result = await convertPdfForPortalRasterPreview(blob, {
            quality: 0.92,
            maxPageWidth: 1800,
            signal: ac.signal,
          });
          if (cancelled) {
            URL.revokeObjectURL(result.thumbnailUrl);
            return;
          }
          urlRef.current = result.thumbnailUrl;
          rememberPdfPortalRaster(effectiveUrl, result.thumbnailUrl, result.thumbnailBlob);
          rememberPortalPdfMeta(effectiveUrl, result.portalMeta);
          setState({ status: "ready", objectUrl: result.thumbnailUrl, mime: "image/jpeg", fromCellThumb: false });
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          urlRef.current = null;
          return;
        }
        rememberHoverBlobUrl(effectiveUrl, objectUrl);
        // Don't seed full key into cell-thumb — keep thumb separate so portal can upgrade.
        // Don't replace a working cell-thumb image with "octet-stream" / unknown type UI.
        if (!mime.startsWith("image/") && !mime.includes("pdf") && cellThumb) {
          return;
        }
        setState({ status: "ready", objectUrl, mime, blob, fromCellThumb: false });
      } catch (e) {
        if (!cancelled) {
          console.warn("[attachmentPreview] preview failed", effectiveUrl, e);
          setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      ac.abort();
      urlRef.current = null;
    };
  }, [url, effectiveUrl, galleryDepKey, companyId, reloadKey]);

  const openAttachment = React.useCallback(() => {
    // STRICT (parked): URL PDF label → hamesha pdf open.
    // const labelIsPdf = getAttachmentFormatLabel(effectiveUrl) === "PDF";
    // const kind: "pdf" | "image" | "other" = labelIsPdf
    //   ? "pdf"
    //   : state.status === "ready" && state.mime.startsWith("image/")
    //     ? "image"
    //     : ...
    const kind: "pdf" | "image" | "other" =
      state.status === "ready" && state.mime.startsWith("image/")
        ? "image"
        : state.status === "ready" && (state.mime === "application/pdf" || state.mime.includes("pdf"))
          ? "pdf"
          : getAttachmentFormatLabel(effectiveUrl) === "PDF"
            ? "pdf"
            : "other";
    const multi =
      gallery && gallery.urls.length > 1 ? { urls: gallery.urls, startIndex: gallery.startIndex } : undefined;
    // STRICT (parked): localLedgerOnly + https serverFallback
    // const localLedgerOnly = ...
    const serverFallback =
      companyId &&
      (isLocalFileRef(effectiveUrl) || voucherAttachmentFb?.interCompanyPeer)
        ? {
            companyId,
            voucherId: voucherAttachmentFb?.voucherId ?? "",
            clientFileUrls: gallery?.urls,
            interCompanyPeer: voucherAttachmentFb?.interCompanyPeer,
          }
        : undefined;
    void openAttachmentInApp(effectiveUrl, {
      kind,
      gallery: multi,
      serverFallback,
      gateCompany: company,
    });
  }, [effectiveUrl, state, gallery, voucherAttachmentFb, companyId, company]);

  const canRemoteFetch = canFetchPlServerAttachmentForCompany(companyId);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[200px] min-w-[220px] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading preview" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <span>
          {canRemoteFetch
            ? "Could not load preview from server — try Open or Retry"
            : "File stored on this device — try Open"}
        </span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setReloadKey((n) => n + 1)}>
            Retry
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={openAttachment}>
            Open
          </Button>
        </div>
      </div>
    );
  }

  const { objectUrl, mime } = state;
  const isPdf = mime === "application/pdf" || mime.includes("pdf");
  // Cell-thumb JPEG / sniff miss pe bhi image dikhao — Open file pe pehle se chal raha tha.
  const isImage =
    mime.startsWith("image/") ||
    Boolean(state.fromCellThumb) ||
    (!isPdf && (mime === "application/octet-stream" || mime === "binary/octet-stream") && Boolean(objectUrl));
  const cellThumbForPdf =
    isPdf || state.fromCellThumb
      ? peekHoverCachedBlobUrl(`${effectiveUrl}::cell-thumb`)
      : null;
  const portalPdfMeta = peekPortalPdfMeta(effectiveUrl);
  const isPortalPdfRaster =
    isImage &&
    (portalPdfMeta != null ||
      peekHoverCachedBlobUrl(pdfPortalCacheKey(effectiveUrl)) === objectUrl);
  // STRICT (parked): labelIsPdf || isPdf || isPortalPdfRaster → LocalPdfBlobHoverPreview, no cell-thumb img.

  /** Voucher FilePreview hover jaisa — max-w-full / center flex mat (AttachmentHoverPortal width-fit + scroll) */
  return (
    <div className="flex w-max max-w-none flex-shrink-0 flex-col gap-1">
      {isPortalPdfRaster ? (
        <PdfPortalRasterImg src={objectUrl} portalMeta={portalPdfMeta} onOpen={openAttachment} />
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: preview
        <img
          src={objectUrl}
          alt=""
          draggable={false}
          className="block h-auto w-auto max-h-none max-w-none object-contain"
          loading="eager"
          onDoubleClick={(e) => {
            e.stopPropagation();
            openAttachment();
          }}
        />
      ) : isPdf ? (
        <LocalPdfBlobHoverPreview
          sourceUrl={objectUrl}
          blob={state.status === "ready" ? state.blob : undefined}
          onOpen={openAttachment}
          instantThumbUrl={cellThumbForPdf}
          companyId={companyId}
          portalCacheKey={effectiveUrl}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <span>Preview not available for this type</span>
          <Button type="button" size="sm" variant="secondary" onClick={openAttachment}>
            Open
          </Button>
        </div>
      )}
    </div>
  );
}

export function MultiAttachmentPortalPreview({
  urls,
  companyId: companyIdProp,
  voucherId,
}: {
  urls: readonly string[];
  companyId?: string | null;
  voucherId?: string | null;
}) {
  const gallery = useAttachmentPreviewGallery();
  const { companyId: shellCompanyId } = useCompany();
  const list = React.useMemo(
    () => urls.map((u) => String(u || "").trim()).filter(Boolean),
    [urls]
  );
  const urlsKey = React.useMemo(() => list.join("\x1e"), [list]);
  const activeIndex =
    gallery && gallery.urls.length > 1
      ? Math.min(Math.max(gallery.index, 0), Math.max(list.length - 1, 0))
      : 0;
  const galleryOpts = React.useMemo(
    () => (list.length > 1 ? { urls: list, startIndex: activeIndex } : undefined),
    [urlsKey, activeIndex, list]
  );

  if (list.length === 0) {
    return (
      <div className="flex min-h-[120px] min-w-[200px] flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
        <span>No preview</span>
        <span className="text-xs opacity-80">No file attached</span>
      </div>
    );
  }

  const currentUrl = list[activeIndex] ?? list[0]!;

  const body = (
    <SingleAttachmentHoverPreviewBody
      url={currentUrl}
      companyId={companyIdProp ?? shellCompanyId ?? readActiveAttachmentCompanyId()}
      gallery={galleryOpts}
    />
  );
  const cid = String(companyIdProp ?? shellCompanyId ?? readActiveAttachmentCompanyId() ?? "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid) return body;
  return (
    <VoucherAttachmentFallbackContext.Provider value={{ companyId: cid, voucherId: vid }}>
      {body}
    </VoucherAttachmentFallbackContext.Provider>
  );
}

export function isPublicStaticImageUrl(url: string | null | undefined): boolean {
  const u = String(url ?? "").trim();
  if (!u) return false;
  if (u.startsWith("blob:") || u.startsWith("data:")) return true;
  if (u.startsWith("/") && !u.startsWith("//")) return true;
  return false;
}

/** App public assets (`/app-icon.png`, `/icons/…`) — attachment download pipeline ki zaroorat nahi. */
export function PublicStaticImagePreviewBody({ url }: { url: string }) {
  return (
    <div className="flex min-h-[160px] min-w-[200px] items-center justify-center p-4">
      <img
        src={url}
        alt=""
        draggable={false}
        className="max-h-[min(70vh,520px)] max-w-[min(92vw,520px)] object-contain"
      />
    </div>
  );
}

export function SingleAttachmentHoverPreviewBody({
  url,
  gallery,
  companyId: companyIdProp,
}: {
  url: string;
  gallery?: AttachmentPreviewGalleryOpts;
  companyId?: string | null;
}) {
  const { company } = useCompany();
  const voucherAttachmentFb = useVoucherAttachmentFallback();
  const filesNetworkAllowed =
    !company?.id || isOnlineCompanyAttachmentNetworkAllowed(String(company.id), company);
  const localLedgerOnly =
    companyRequiresLocalAttachmentUrlsOnly(company) ||
    embeddedAttachmentDisplayUsesLocalBytesOnly() ||
    !filesNetworkAllowed;
  const attachmentMode = companyAttachmentMode(company, { localLedgerOnly });
  const normalized = trimEntityFileUrlForPreview(url);
  if (!normalized) {
    return (
      <div className="flex min-h-[120px] min-w-[200px] flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
        <span>No preview</span>
        <span className="text-xs opacity-80">No file attached</span>
      </div>
    );
  }
  const u = String(normalized);
  const effectiveUrl = normalizeAttachmentUrlForDevicePreview(u);
  const cleanUrl = effectiveUrl.split("?")[0].toLowerCase();
  // `drive:` / `PL_ATTACH` ko HTTPS image branch mat bhejo — wahan spinner atka rehta tha.
  const usesDeviceBlobPreview = isLocalFileRef(effectiveUrl) || isDriveFileRef(effectiveUrl);
  const storagePathRaw = !usesDeviceBlobPreview ? tryGetStoragePathFromFirebaseDownloadUrl(u) : null;
  const pathLower = (storagePathRaw || "").toLowerCase();
  const fmt = getAttachmentFormatLabel(effectiveUrl || u);
  const cachedCellThumb = peekHoverCachedBlobUrl(`${effectiveUrl}::cell-thumb`);
  const cachedFullHover = peekHoverCachedBlobUrl(effectiveUrl);
  const pathLooksImage =
    /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff)(\?|$)/i.test(pathLower) ||
    /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(cleanUrl);
  const isPdf =
    !usesDeviceBlobPreview &&
    (fmt === "PDF" ||
      u.startsWith("data:application/pdf") ||
      effectiveUrl.startsWith("data:application/pdf") ||
      cleanUrl.endsWith(".pdf") ||
      effectiveUrl.toLowerCase().includes(".pdf") ||
      pathLower.includes(".pdf"));
  // STRICT (parked): cell-thumb / full hover se IMAGE mat decide.
  // Firebase signed URLs aksar bina `.jpg` ke aate hain — File column thumb IMAGE dikhata hai, portal FILE sochta tha.
  const isImage =
    !usesDeviceBlobPreview &&
    !isPdf &&
    (["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "IMAGE"].includes(fmt) ||
      u.startsWith("data:image/") ||
      effectiveUrl.startsWith("data:image/") ||
      pathLooksImage ||
      Boolean(cachedCellThumb) ||
      Boolean(cachedFullHover));
  /** Extension-less https — Open file chalega; blob sniff se image/pdf decide. */
  const tryHttpsBlobPreview =
    !usesDeviceBlobPreview &&
    !isImage &&
    !isPdf &&
    /^https?:\/\//i.test(effectiveUrl);
  const galleryOpts = gallery;
  const openAtt = () =>
    void openAttachmentInApp(effectiveUrl, {
      // STRICT (parked): kind: isPdf ? "pdf" first
      kind: isImage || tryHttpsBlobPreview ? "image" : isPdf ? "pdf" : "other",
      localLedgerOnly,
      gateCompany: company,
      gallery:
        galleryOpts && galleryOpts.urls.length > 1
          ? { urls: galleryOpts.urls, startIndex: galleryOpts.startIndex }
          : undefined,
      serverFallback:
        voucherAttachmentFb?.companyId && voucherAttachmentFb?.voucherId
          ? {
              companyId: voucherAttachmentFb.companyId,
              voucherId: voucherAttachmentFb.voucherId,
              clientFileUrls: galleryOpts?.urls,
              interCompanyPeer: voucherAttachmentFb.interCompanyPeer,
            }
          : company?.id
            ? { companyId: company.id, voucherId: "" }
            : undefined,
    });
  const caption = usesDeviceBlobPreview
    ? isPdf
      ? "PDF"
      : fmt === "FILE"
        ? ""
        : fmt
    : isPdf
      ? "PDF"
      : isImage || tryHttpsBlobPreview
        ? fmt === "FILE"
          ? "IMAGE"
          : fmt
        : fmt;

  /** Bahar AttachmentHoverPortal — yahi markup FilePreview hoverPanel ke image branch jaisa (taaki zoom/width sahi) */
  return (
    <div className="flex w-max max-w-none flex-col gap-1">
      {usesDeviceBlobPreview || tryHttpsBlobPreview ? (
        <LocalFileRefTooltipPreview
          url={u}
          gallery={galleryOpts}
          companyId={companyIdProp ?? voucherAttachmentFb?.companyId ?? company?.id ?? readActiveAttachmentCompanyId()}
        />
      ) : isImage ? (
        <HoverPreviewHttpsAwareImage
          url={u}
          localLedgerOnly={localLedgerOnly}
          filesNetworkAllowed={filesNetworkAllowed}
          companyMode={attachmentMode}
          companyId={voucherAttachmentFb?.companyId ?? company?.id}
          alt=""
          className="block h-auto w-auto max-h-none max-w-none object-contain"
          loading="eager"
          onDoubleClick={(e) => {
            e.stopPropagation();
            openAtt();
          }}
        />
      ) : isPdf ? (
        <HttpsPdfPortalHoverPreview
          url={u}
          onOpen={openAtt}
          companyId={voucherAttachmentFb?.companyId ?? company?.id ?? companyIdProp ?? undefined}
        />
      ) : (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-muted-foreground">
          <span>Preview not available for this type</span>
          <Button type="button" size="sm" variant="secondary" onClick={openAtt}>
            Open file
          </Button>
        </div>
      )}
      {caption ? (
        <p className="text-center text-[10px] font-semibold text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}
