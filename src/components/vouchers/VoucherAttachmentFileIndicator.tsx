"use client";

import { resolveCurrentAttachmentUrlAfterLoadError } from "@/lib/attachmentCurrentUrlFallback";
import * as React from "react";
import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAttachmentUrlsReadyState } from "@/hooks/useAttachmentUrlsReadyState";
import {
  invalidateAttachmentThumbDisplayUrl,
  useAttachmentThumbDisplayUrl,
} from "@/hooks/useAttachmentThumbDisplayUrl";
import { useCompany } from "@/hooks/useCompany";
import { shouldUseAttachmentLazyLoad } from "@/lib/webAttachmentLazyLoadPolicy";
import { isOnlineCompanyFilesUiAllowed } from "@/lib/onlineCompanySelectorSyncPolicy";
import {
  FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT,
  type FirebaseLedgerCompanySyncPrefsChangedDetail,
} from "@/lib/firebaseLedgerCompanySyncPrefs";
import { requestAttachmentUiRefresh } from "@/lib/attachmentLoadReady";
import {
  ATTACHMENT_REUSE_COUNT_EVENT,
  attachmentPersistableRefsMatch,
  buildAttachmentReusePlaceKey,
  resolveAttachmentReuseUiMeta,
} from "@/lib/companyAttachmentRegistry";
import { useVoucherListReuseHint, lookupVoucherListReuseHint } from "@/lib/voucherAttachmentListReuseIndex";
import { useAttachmentNoFile } from "@/lib/attachmentNoFileSession";
import { AttachmentNoFileEye } from "@/components/vouchers/AttachmentNoFileEye";

type Props = {
  urls: readonly string[];
  className?: string;
  size?: "sm" | "md";
  displayMode?: "preview" | "tick";
  companyId?: string;
  voucherId?: string;
  /** Override place key; default `vouchers/{voucherId}` when voucherId set. */
  attachmentReusePlaceKey?: string | null;
  clientFileUrls?: readonly string[] | null;
  /** Prior FY / deferred row: tick/placeholder until user opens (click still loads). */
  suppressAutoThumbLoad?: boolean;
  "aria-label"?: string;
};

/** File column / OB row — Preview = square; Tick only = check. Files tick OFF: local cache only (no download). */
export function VoucherAttachmentFileIndicator({
  urls,
  className,
  size = "md",
  displayMode = "preview",
  companyId: companyIdProp,
  voucherId,
  attachmentReusePlaceKey: attachmentReusePlaceKeyProp,
  clientFileUrls,
  suppressAutoThumbLoad = false,
  "aria-label": ariaLabel = "Attachment",
}: Props) {
  const { company, companyId: shellCid } = useCompany();
  const companyId = companyIdProp ?? shellCid;
  const [syncPrefsTick, setSyncPrefsTick] = React.useState(0);
  const urlsKey = urls.map((url) => String(url || "").trim()).filter(Boolean).join("\u0001");
  const clientFileUrlsKey = (clientFileUrls || [])
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .join("\u0001");
  const filesNetworkAllowed = React.useMemo(
    () => !companyId || isOnlineCompanyFilesUiAllowed(String(companyId), company),
    [companyId, company, syncPrefsTick]
  );
  const primaryUrl = React.useMemo(
    () => urls.map((u) => String(u || "").trim()).find(Boolean),
    [urls]
  );
  const readyState = useAttachmentUrlsReadyState(urls);
  /**
   * Lazy thumb load: only start fetching once the cell has been near the viewport (sticky once true,
   * so scrolling away never blinks / re-fetches). Already-cached thumbs render immediately regardless.
   */
  const [rootEl, setRootEl] = React.useState<HTMLElement | null>(null);
  const [inView, setInView] = React.useState(
    () => typeof window === "undefined" || typeof IntersectionObserver === "undefined"
  );
  React.useEffect(() => {
    if (inView || !rootEl) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    io.observe(rootEl);
    return () => io.disconnect();
  }, [inView, rootEl]);
  const [thumbRetryKey, setThumbRetryKey] = React.useState(0);
  /** 404 fallback: current URL re-read from the doc (local -> server) after a swap on another device. */
  const [currentDocUrlOverride, setCurrentDocUrlOverride] = React.useState<string | null>(null);
  /**
   * URL present but no file bytes (verdict cached for the url the thumb hook actually loads: primary or
   * current-doc override). Multi-url cells show one thumb for the primary url, so the primary verdict decides.
   */
  const effectiveThumbSrc = currentDocUrlOverride ?? primaryUrl;
  const noFile = useAttachmentNoFile(effectiveThumbSrc ? [effectiveThumbSrc] : null);
  React.useEffect(() => {
    setThumbRetryKey(0);
    setCurrentDocUrlOverride(null);
  }, [primaryUrl, displayMode]);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<FirebaseLedgerCompanySyncPrefsChangedDetail>).detail;
      const changedIds = Array.isArray(detail?.companyIds) ? detail.companyIds.map(String) : [];
      if (changedIds.length > 0 && companyId && !changedIds.includes(String(companyId))) return;
      setThumbRetryKey(0);
      setSyncPrefsTick((n) => n + 1);
      requestAttachmentUiRefresh();
    };
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefsChanged);
    return () => {
      window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefsChanged);
    };
  }, [companyId]);
  React.useEffect(() => {
    if (syncPrefsTick <= 0 || !filesNetworkAllowed) return;
    const currentUrls = urlsKey ? urlsKey.split("\u0001") : [];
    for (const url of currentUrls) invalidateAttachmentThumbDisplayUrl(url);
    requestAttachmentUiRefresh();
  }, [clientFileUrlsKey, companyId, filesNetworkAllowed, syncPrefsTick, urlsKey]);
  const wantsPreview = displayMode === "preview";
  // Files OFF: sirf device cache se thumb; network kabhi nahi. Files ON: visible page + lazy load.
  // Tick-only mode: same lazy byte lookup (probe only, no thumb) so URL-only rows can show the eye instead of the tick.
  const allowThumbLoad =
    inView &&
    !suppressAutoThumbLoad &&
    filesNetworkAllowed &&
    (readyState === "ready" || shouldUseAttachmentLazyLoad(company));
  const thumbUrl = useAttachmentThumbDisplayUrl(
    currentDocUrlOverride ?? primaryUrl,
    allowThumbLoad,
    companyId,
    thumbRetryKey,
    {
      voucherId,
      clientFileUrls,
      filesNetworkAllowed,
      noFileProbeOnly: !wantsPreview,
    }
  );

  const currentReusePlaceKey = React.useMemo(() => {
    const fromProp = String(attachmentReusePlaceKeyProp || "").trim();
    if (fromProp) return fromProp;
    return buildAttachmentReusePlaceKey("vouchers", voucherId) || "";
  }, [attachmentReusePlaceKeyProp, voucherId]);

  const trimmedUrls = React.useMemo(
    () => urls.map((u) => String(u || "").trim()).filter(Boolean),
    [urlsKey]
  );

  const REUSE_ORIGIN_FRAME = "#22c55e";
  const REUSE_COPY_FRAME = "#2563eb";

  /** Multi-file collapsed cell: per-URL origin vs reuse (for 50/50 horizontal frame). */
  const [urlReuseRoles, setUrlReuseRoles] = React.useState<
    Record<string, "origin" | "reuse" | "none">
  >({});
  React.useEffect(() => {
    if (!wantsPreview || !companyId || trimmedUrls.length === 0) {
      setUrlReuseRoles({});
      return;
    }
    let cancelled = false;
    const unique = [...new Set(trimmedUrls)];
    void Promise.all(
      unique.map(async (url) => {
        const meta = await resolveAttachmentReuseUiMeta(companyId, url);
        const listHint = lookupVoucherListReuseHint(url, currentReusePlaceKey || null);
        const count = Math.max(meta.count, listHint.count);
        const shared = count >= 2 || meta.originDetached;
        if (!shared) return [url, "none"] as const;
        const originKey = meta.originPlaceKey || listHint.originPlaceKey;
        const isOrigin =
          !meta.originDetached &&
          Boolean(currentReusePlaceKey) &&
          Boolean(originKey) &&
          currentReusePlaceKey === originKey;
        return [url, isOrigin ? "origin" : "reuse"] as const;
      })
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, "origin" | "reuse" | "none"> = {};
      for (const [url, role] of pairs) next[url] = role;
      setUrlReuseRoles(next);
    });
    const onReuse = () => {
      // Roles refresh on reuse events (same deps as primary meta).
      void Promise.all(
        unique.map(async (url) => {
          const meta = await resolveAttachmentReuseUiMeta(companyId, url);
          const listHint = lookupVoucherListReuseHint(url, currentReusePlaceKey || null);
          const count = Math.max(meta.count, listHint.count);
          const shared = count >= 2 || meta.originDetached;
          if (!shared) return [url, "none"] as const;
          const originKey = meta.originPlaceKey || (meta.originDetached ? null : listHint.originPlaceKey);
          const isOrigin =
            !meta.originDetached &&
            Boolean(currentReusePlaceKey) &&
            Boolean(originKey) &&
            currentReusePlaceKey === originKey;
          return [url, isOrigin ? "origin" : "reuse"] as const;
        })
      ).then((pairs) => {
        if (cancelled) return;
        const next: Record<string, "origin" | "reuse" | "none"> = {};
        for (const [url, role] of pairs) next[url] = role;
        setUrlReuseRoles(next);
      });
    };
    window.addEventListener(ATTACHMENT_REUSE_COUNT_EVENT, onReuse as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(ATTACHMENT_REUSE_COUNT_EVENT, onReuse as EventListener);
    };
  }, [wantsPreview, companyId, urlsKey, currentReusePlaceKey]);

  const [reuseCount, setReuseCount] = React.useState(0);
  const [reuseOriginPlaceKey, setReuseOriginPlaceKey] = React.useState<string | null>(null);
  const [reuseOriginDetached, setReuseOriginDetached] = React.useState(false);
  const listReuseHint = useVoucherListReuseHint(primaryUrl, currentReusePlaceKey || null);
  React.useEffect(() => {
    if (!wantsPreview || !companyId || !primaryUrl) {
      setReuseCount(0);
      setReuseOriginPlaceKey(null);
      setReuseOriginDetached(false);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void resolveAttachmentReuseUiMeta(companyId, primaryUrl).then((meta) => {
        if (cancelled) return;
        setReuseCount(meta.count);
        setReuseOriginPlaceKey(meta.originPlaceKey);
        setReuseOriginDetached(Boolean(meta.originDetached));
      });
    };
    refresh();
    const onReuse = (ev: Event) => {
      const detail = (ev as CustomEvent<{ companyId?: string; url?: string; count?: number }>).detail;
      if (!detail) return;
      const detailUrl = String(detail.url || "").trim();
      if (!detailUrl || !attachmentPersistableRefsMatch(detailUrl, primaryUrl)) return;
      const hinted = Number(detail.count);
      if (Number.isFinite(hinted) && hinted > 0) {
        setReuseCount((prev) => Math.max(prev, hinted));
      }
      refresh();
    };
    window.addEventListener(ATTACHMENT_REUSE_COUNT_EVENT, onReuse as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(ATTACHMENT_REUSE_COUNT_EVENT, onReuse as EventListener);
    };
  }, [wantsPreview, companyId, primaryUrl]);

  const effectiveReuseCount = Math.max(reuseCount, listReuseHint.count);
  const effectiveOriginPlaceKey =
    reuseOriginPlaceKey || (reuseOriginDetached ? null : listReuseHint.originPlaceKey) || null;
  const isSharedAcrossPlaces =
    (effectiveReuseCount >= 2 || reuseOriginDetached) && Boolean(primaryUrl);
  const isReuseOriginPlace =
    !reuseOriginDetached &&
    Boolean(currentReusePlaceKey) &&
    Boolean(effectiveOriginPlaceKey) &&
    currentReusePlaceKey === effectiveOriginPlaceKey;

  const multiHasOrigin = trimmedUrls.some((u) => urlReuseRoles[u] === "origin");
  const multiHasReuse = trimmedUrls.some((u) => urlReuseRoles[u] === "reuse");
  /** Show-all OFF (multi urls in one indicator): source+reuse → horizontal 50/50; else solid. */
  const reuseFrameBackground: string | null = (() => {
    if (!wantsPreview) return null;
    if (trimmedUrls.length > 1) {
      if (multiHasOrigin && multiHasReuse) {
        return `linear-gradient(to right, ${REUSE_ORIGIN_FRAME} 50%, ${REUSE_COPY_FRAME} 50%)`;
      }
      if (multiHasOrigin) return REUSE_ORIGIN_FRAME;
      if (multiHasReuse) return REUSE_COPY_FRAME;
      // Fall through to primary-url role while multi roles still loading.
    }
    if (!isSharedAcrossPlaces) return null;
    return isReuseOriginPlace ? REUSE_ORIGIN_FRAME : REUSE_COPY_FRAME;
  })();

  const reuseTitle =
    trimmedUrls.length > 1 && multiHasOrigin && multiHasReuse
      ? "Mixed attachments — green = source, blue = reused (50/50)"
      : isSharedAcrossPlaces && isReuseOriginPlace
        ? `Original source — also used in ${effectiveReuseCount} places`
        : isSharedAcrossPlaces && reuseOriginDetached
          ? `Reused file — original source removed; file still linked here`
          : isSharedAcrossPlaces
            ? `Reused file — used in ${effectiveReuseCount} places`
            : undefined;

  const fileCount = urls.map((u) => String(u || "").trim()).filter(Boolean).length;
  if (fileCount === 0) return null;
  const isReady =
    displayMode === "tick"
      ? filesNetworkAllowed
        ? readyState === "ready"
        : fileCount > 0
      : readyState === "ready";
  const iconClass = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const thumbClass = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const countBadgeClass =
    size === "sm"
      ? "absolute -bottom-0.5 -right-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full border border-background bg-primary px-0.5 text-[8px] font-bold leading-none tabular-nums text-primary-foreground"
      : "absolute -bottom-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full border border-background bg-primary px-0.5 text-[9px] font-bold leading-none tabular-nums text-primary-foreground";

  const countBadge =
    fileCount > 1 ? (
      <span className={countBadgeClass} aria-hidden="true">
        {fileCount}
      </span>
    ) : null;

  if (noFile) {
    return (
      <span
        ref={setRootEl}
        className={cn(
          "inline-flex shrink-0",
          // Preview mode: same box as the file thumbnail (size / border / radius / shadow / empty-thumb bg), eye centered.
          wantsPreview &&
            cn(
              "relative box-border items-center justify-center rounded-[4px] border border-slate-300 bg-slate-50 shadow-sm",
              thumbClass
            ),
          className
        )}
      >
        <AttachmentNoFileEye size={size} />
      </span>
    );
  }

  if (wantsPreview) {
    const canShowThumb =
      !!thumbUrl &&
      thumbRetryKey < 4 &&
      (filesNetworkAllowed
        ? isReady || shouldUseAttachmentLazyLoad(company)
        : true);

    const thumbInner = canShowThumb ? (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- warmed blob / pdf raster */}
        <img
          key={`${thumbUrl}:${thumbRetryKey}`}
          src={thumbUrl!}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => {
            invalidateAttachmentThumbDisplayUrl(currentDocUrlOverride ?? primaryUrl, thumbUrl);
            setThumbRetryKey((n) => n + 1);
            if (!currentDocUrlOverride && primaryUrl && /^https?:\/\//i.test(primaryUrl)) {
              void resolveCurrentAttachmentUrlAfterLoadError({
                companyId,
                placeKey: currentReusePlaceKey || null,
                badUrl: primaryUrl,
                siblingUrls: urls.map((u) => String(u || "").trim()).filter(Boolean),
                index: 0,
              }).then((next) => {
                if (next) setCurrentDocUrlOverride(next);
              });
            }
          }}
        />
        {countBadge}
      </>
    ) : (
      countBadge
    );

    return (
      <span
        ref={setRootEl}
        data-pl-txn-file-thumb=""
        className={cn(
          "relative inline-flex box-border shrink-0 rounded-[4px]",
          thumbClass,
          className,
          !reuseFrameBackground && "border border-slate-300 bg-white shadow-sm"
        )}
        style={
          reuseFrameBackground
            ? { padding: 2, background: reuseFrameBackground }
            : undefined
        }
        title={reuseTitle}
        aria-label={fileCount > 1 ? `${ariaLabel} preview (${fileCount} files)` : `${ariaLabel} preview`}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn(
            "relative flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] bg-white",
            !canShowThumb && "bg-slate-50"
          )}
        >
          {thumbInner}
        </span>
      </span>
    );
  }

  return (
    <span
      ref={setRootEl}
      className={cn("relative inline-flex", className)}
      aria-label={
        fileCount > 1
          ? `${ariaLabel} ${isReady ? "ready" : "URL only"} (${fileCount} files)`
          : `${ariaLabel} ${isReady ? "ready" : "URL only"}`
      }
    >
      <CheckCircle className={cn(iconClass, isReady ? "text-green-600" : "text-red-600")} />
      {countBadge}
    </span>
  );
}
