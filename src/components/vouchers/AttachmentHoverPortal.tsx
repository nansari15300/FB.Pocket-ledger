"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getAttachmentFormatLabel } from "@/lib/attachmentFormatLabel";
import { peekHoverCachedBlobUrl } from "@/lib/attachmentHoverBlobCache";
import { shareAttachmentFromPreviewSrc, sanitizeAttachmentShareFileName } from "@/lib/shareAttachmentBlob";
import { useFileHoverPreview } from "@/contexts/FileHoverPreviewContext";
import { AttachmentPreviewGalleryContext } from "@/components/vouchers/attachmentPreviewGalleryContext";
import { registerImperativeDialogBack } from "@/contexts/DialogBackHandlerContext";
import { markInAppAttachmentPreviewClosing } from "@/lib/inAppAttachmentPreviewOpen";

/** Tooltip se zyada: fixed portal + solid bg taaki table/parent overflow ya blend se file transparent na dikhe */
const HOVER_CLOSE_MS = 280;
const PANEL_Z = 400000;
const BACKDROP_Z = PANEL_Z - 1;
const PANEL_MAX_W = 1100;
const PANEL_MIN_W = 200;
const PANEL_MIN_H = 220;
const PANEL_CHROME_H = 92;
const PANEL_CONTENT_PAD_W = 22;
const PANEL_CONTENT_PAD_H = 12;
const PANEL_GALLERY_EXTRA_H = 22;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
/** Fit Width/Height: natural-size layout × scale — chhoti scale allowed (lamba stitched JPG) */
const FIT_ZOOM_MIN = 0.02;
/**
 * Fit-window safety: scrollbar (≈12–17px) client box chhota karti hai → tall files pe
 * zoom up/down vibrate. Viewport-max se thoda chhota scale = scrollbar trigger nahi.
 */
const FIT_WINDOW_SAFETY = 0.96;
/** Portal photo fit window: auto-zoom 40%–100% (beech me calculated fit) */
const PORTAL_PHOTO_MIN_FIT_ZOOM = 0.4;
const PORTAL_PHOTO_MAX_FIT_ZOOM = 1;
const ZOOM_EQ_EPS = 0.008;

function nearlyEqualZoom(a: number, b: number): boolean {
  return Math.abs(a - b) < ZOOM_EQ_EPS;
}

function clampPortalPhotoFitZoom(z: number): number {
  return Math.min(PORTAL_PHOTO_MAX_FIT_ZOOM, Math.max(PORTAL_PHOTO_MIN_FIT_ZOOM, z));
}

function clampPortalZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(FIT_ZOOM_MIN, z));
}

function parseZoomPercentInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "");
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampPortalZoom(n / 100);
}

function getPreviewViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1024, height: 720 };
  const vv = window.visualViewport;
  const width = Math.floor(vv?.width || window.innerWidth || 1024);
  const height = Math.floor(vv?.height || window.innerHeight || 720);
  return {
    width: Math.max(width, 240),
    height: Math.max(height, 260),
  };
}

function getViewportFitBox(galleryActive: boolean): {
  maxW: number;
  maxH: number;
  maxContentW: number;
  maxContentH: number;
} {
  const viewport = getPreviewViewportSize();
  const maxW = Math.min(PANEL_MAX_W, Math.max(viewport.width - 20, PANEL_MIN_W));
  const maxH = Math.min(Math.floor(viewport.height * 0.88), Math.max(viewport.height - 16, PANEL_MIN_H));
  const galleryExtraH = galleryActive ? PANEL_GALLERY_EXTRA_H : 0;
  return {
    maxW,
    maxH,
    maxContentW: Math.max(maxW - PANEL_CONTENT_PAD_W, 1),
    maxContentH: Math.max(maxH - PANEL_CHROME_H - galleryExtraH, 1),
  };
}

/** 16:9 landscape — is aspect se zyada height (portrait/tall) par width-fit + scroll */
const PORTAL_LANDSCAPE_W_OVER_H = 16 / 9;

type PortalFitNatural = {
  width: number;
  height: number;
  isMultiPageStitch: boolean;
};

function isTallPortalPhoto(fullNatural: { width: number; height: number }): boolean {
  if (fullNatural.width < 2 || fullNatural.height < 2) return false;
  return fullNatural.width / fullNatural.height < PORTAL_LANDSCAPE_W_OVER_H;
}

/** Fit window: natural size × stable viewport box (clientWidth mat use — scrollbar loop) */
function computeFitWindowZoomFromNatural(
  natural: { width: number; height: number },
  maxContentW: number,
  maxContentH: number
): number {
  const zw = maxContentW / Math.max(natural.width, 1);
  const zh = maxContentH / Math.max(natural.height, 1);
  const z = Math.min(zw, zh) * FIT_WINDOW_SAFETY;
  return Math.min(ZOOM_MAX, Math.max(FIT_ZOOM_MIN, z));
}

/** Photo: auto fit clamped 40–100%; tall + overflow ho to width-fit + scroll */
function computePortalPhotoFitWindow(
  natural: { width: number; height: number },
  maxContentW: number,
  maxContentH: number
): { zoom: number; widthFitScroll: boolean } {
  const zw = (maxContentW / Math.max(natural.width, 1)) * FIT_WINDOW_SAFETY;
  const zh = (maxContentH / Math.max(natural.height, 1)) * FIT_WINDOW_SAFETY;
  const autoFit = clampPortalPhotoFitZoom(Math.min(zw, zh));

  if (isTallPortalPhoto(natural) && natural.height * autoFit > maxContentH + 2) {
    return { zoom: clampPortalPhotoFitZoom(zw), widthFitScroll: true };
  }
  return { zoom: autoFit, widthFitScroll: false };
}

function resolvePortalFitWindowScale(
  natural: PortalFitNatural,
  maxContentW: number,
  maxContentH: number
): { scale: number; widthFitScroll: boolean } {
  if (natural.isMultiPageStitch) {
    return {
      scale: computeFitWindowZoomFromNatural(natural, maxContentW, maxContentH),
      widthFitScroll: true,
    };
  }
  const photoFit = computePortalPhotoFitWindow(natural, maxContentW, maxContentH);
  return { scale: photoFit.zoom, widthFitScroll: photoFit.widthFitScroll };
}

function clampPanelSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.ceil(value)));
}

function getImageStackNaturalSize(root: HTMLElement): { width: number; height: number } | null {
  const imgs = [...root.querySelectorAll("img")].filter(
    (n): n is HTMLImageElement =>
      n instanceof HTMLImageElement && n.naturalWidth >= 2 && n.naturalHeight >= 1
  );
  if (imgs.length === 0) return null;
  let width = 0;
  let height = 0;
  for (const img of imgs) {
    width = Math.max(width, img.naturalWidth);
    height += img.naturalHeight;
  }
  return { width, height };
}

/** Multi-page portal PDF stitch: fit/zoom uses 1 page height, scroll for baaki pages. */
function inferPortalPdfOnePageFromStack(
  fullNatural: { width: number; height: number },
  minPageRatio = 1.85
): { width: number; height: number; isMultiPageStitch: boolean } | null {
  if (fullNatural.width < 2 || fullNatural.height < 2) return null;
  const estSinglePageH = fullNatural.width * (297 / 210);
  const pageRatio = fullNatural.height / estSinglePageH;
  if (pageRatio < minPageRatio) return null;
  const pages = Math.max(2, Math.round(pageRatio));
  const onePageH = fullNatural.height / pages;
  return { width: fullNatural.width, height: onePageH, isMultiPageStitch: true };
}

function getPortalPdfFitNatural(root: HTMLElement, fullNatural: { width: number; height: number }): PortalFitNatural {
  const img = root.querySelector("img[data-pdf-portal-page], img[data-pdf-portal-pages]");
  /** Normal photo/image — poora frame fit window; PDF multi-page infer mat */
  if (!(img instanceof HTMLImageElement)) {
    return {
      width: fullNatural.width,
      height: fullNatural.height,
      isMultiPageStitch: false,
    };
  }
  let pages = Number.parseInt(img.dataset.pdfPortalPages || "1", 10);
  let onePageH = Number.parseFloat(img.dataset.pdfPortalOnePageH || "0");

  if (pages > 1 && onePageH <= 1 && fullNatural.height > 1) {
    onePageH = fullNatural.height / pages;
  }

  if (pages > 1 && onePageH > 1) {
    return { width: fullNatural.width, height: onePageH, isMultiPageStitch: true };
  }

  /** Portal PDF raster, meta missing: stitched JPEG — photos se alag (lower ratio) */
  if (pages <= 1 && img.hasAttribute("data-pdf-portal-page")) {
    const inferred = inferPortalPdfOnePageFromStack(fullNatural, 1.32);
    if (inferred) {
      return { width: inferred.width, height: inferred.height, isMultiPageStitch: inferred.isMultiPageStitch };
    }
    return { width: fullNatural.width, height: fullNatural.height, isMultiPageStitch: false };
  }

  return { width: fullNatural.width, height: fullNatural.height, isMultiPageStitch: false };
}

function getFitNaturalSize(root: HTMLElement): PortalFitNatural | null {
  const full = getImageStackNaturalSize(root);
  if (!full) return null;
  return getPortalPdfFitNatural(root, full);
}

function isPortalVerticalScrollRoot(root: HTMLElement | null): boolean {
  if (!root) return false;
  const natural = getFitNaturalSize(root);
  if (natural?.isMultiPageStitch) return true;
  return root.dataset.portalWidthFitScroll === "1";
}

type PanSession = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
};

function galleryIndexFromPointerTarget(target: EventTarget | null): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const node = target.closest("[data-attachment-index]") as HTMLElement | null;
  const raw = node?.dataset?.attachmentIndex;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/** Hydration-safe nahi: useLayoutEffect se pehle paint tak false — coarse pointer / touch par tap-toggle (hover enter/leave mobile par turant band ho jata tha) */
function detectTapInteractionMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    ("ontouchstart" in window && navigator.maxTouchPoints > 0)
  );
}

export function useTapInteractionMode(): boolean {
  /* Pehle render par hi sahi mode — warna mobile par 2s hold + chip hide ho sakta tha */
  const [tap, setTap] = React.useState(detectTapInteractionMode);
  React.useLayoutEffect(() => {
    setTap(detectTapInteractionMode());
  }, []);
  return tap;
}

/** Default `window` = poora image scroll viewport ke andar fit (zoom change se chhota panel + mouse leave wala bug kam) */
type FitMode = "window" | "width" | "height" | "free";

type AttachmentHoverPortalProps = {
  /** Hover trigger (icon / thumbnail) */
  children: React.ReactNode;
  /** Preview content — panel ke andar solid background par */
  preview: React.ReactNode;
  disabled?: boolean;
  /** false: hover/click se trigger par panel nahi — FilePreview jaisa Preview button + `onRegisterOpen` */
  openOnHover?: boolean;
  /** `openOnHover={false}` par Preview button se `handleOpen` yahan register karo */
  onRegisterOpen?: (open: (() => void) | null) => void;
  /** Trigger wrapper class — table icon vs bile FilePreview tile ke liye */
  triggerClassName?: string;
  /** PDF: nested FilePreview ke canvas par dblclick kabhi img tak nahi — scroll area se open in browser */
  onPreviewDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Entity list avatar: click se preview modal — row Link navigate na ho; hover mode par bhi click preview */
  clickOpensPreview?: boolean;
  /** Multi-file: PC modal ke left/right arrows se file badle (preview body context se index leta hai) */
  galleryUrls?: readonly string[];
  /** Kis thumb se portal khula — gallery index (alag FilePreview tiles par 0 na atke) */
  galleryStartIndex?: number;
  /** Single-file portal (no multi gallery): canonical attachment ref for Share */
  shareAttachmentUrl?: string;
  /** Optional display name — Share filename */
  shareFileName?: string;
};

function portalShareFileNameFromUrl(url: string, explicitName?: string): string {
  const explicit = String(explicitName || "").trim();
  if (explicit && !explicit.startsWith("local:")) {
    return sanitizeAttachmentShareFileName(explicit);
  }
  const href = String(url || "").trim();
  if (/^https?:\/\//i.test(href)) {
    try {
      const base = decodeURIComponent(new URL(href).pathname.split("/").pop()?.split("?")[0] || "");
      if (base) return sanitizeAttachmentShareFileName(base);
    } catch {
      /* fall through */
    }
  }
  const label = getAttachmentFormatLabel(href);
  if (label === "PDF") return "attachment.pdf";
  if (label && label !== "FILE" && label !== "OTHER") {
    const ext = label.toLowerCase().replace("jpeg", "jpg");
    return sanitizeAttachmentShareFileName(`attachment.${ext}`);
  }
  return sanitizeAttachmentShareFileName("attachment");
}

function resolvePortalSharePreviewSrc(canonicalUrl: string): string {
  const canonical = String(canonicalUrl || "").trim();
  if (!canonical) return "";
  if (getAttachmentFormatLabel(canonical) === "PDF") return canonical;
  const cached = peekHoverCachedBlobUrl(canonical);
  return cached && (cached.startsWith("blob:") || cached.startsWith("data:")) ? cached : canonical;
}

export function AttachmentHoverPortal({
  children,
  preview,
  disabled = false,
  openOnHover = true,
  onRegisterOpen,
  triggerClassName,
  onPreviewDoubleClick,
  clickOpensPreview = false,
  galleryUrls,
  galleryStartIndex = 0,
  shareAttachmentUrl,
  shareFileName,
}: AttachmentHoverPortalProps) {
  const { mode: globalPreviewMode } = useFileHoverPreview();
  const effectiveDisabled = disabled || globalPreviewMode === "off";
  const useTapMode = useTapInteractionMode();
  const forceClickPreview = clickOpensPreview && !effectiveDisabled;
  const globalClickMode = globalPreviewMode === "click" && !effectiveDisabled && openOnHover;
  const [open, setOpen] = React.useState(false);
  const [clickPinnedOpen, setClickPinnedOpen] = React.useState(false);
  // `click`: desktop par click/tap modal; `hover`: pointer enter; touch hamesha click.
  const clickOrTapOpenMode = useTapMode || globalClickMode || clickPinnedOpen;
  const [zoom, setZoom] = React.useState(1);
  /** Neeche Window / Width / Height — `window` default; `free` = +/- manual zoom */
  const [fitMode, setFitMode] = React.useState<FitMode>("window");
  const fitModeRef = React.useRef<FitMode>(fitMode);
  fitModeRef.current = fitMode;
  /** Ek baar panel andar click → trigger/pointer-leave auto-close band + backdrop se bahar click = close */
  const [stickOpen, setStickOpen] = React.useState(false);
  const [galleryIndex, setGalleryIndex] = React.useState(0);
  const [panelWidth, setPanelWidth] = React.useState<number | null>(null);
  const [panelHeight, setPanelHeight] = React.useState<number | null>(null);
  const [scrollable, setScrollable] = React.useState(false);
  const [portalVerticalScroll, setPortalVerticalScroll] = React.useState(false);
  const [zoomInputFocused, setZoomInputFocused] = React.useState(false);
  const [zoomInputDraft, setZoomInputDraft] = React.useState("");
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const normalizedGalleryUrls = React.useMemo(
    () => (Array.isArray(galleryUrls) ? galleryUrls.map((u) => String(u || "").trim()).filter(Boolean) : []),
    [galleryUrls]
  );
  const galleryActive = normalizedGalleryUrls.length > 1;
  const activeGalleryUrl = galleryActive
    ? normalizedGalleryUrls[Math.min(Math.max(galleryIndex, 0), Math.max(normalizedGalleryUrls.length - 1, 0))]
    : "";
  const activeShareCanonicalUrl = React.useMemo(() => {
    if (galleryActive && activeGalleryUrl) return activeGalleryUrl;
    if (normalizedGalleryUrls.length === 1) return normalizedGalleryUrls[0]!;
    return String(shareAttachmentUrl || "").trim();
  }, [galleryActive, activeGalleryUrl, normalizedGalleryUrls, shareAttachmentUrl]);
  const [shareBusy, setShareBusy] = React.useState(false);
  const galleryState = React.useMemo(
    () => ({
      urls: normalizedGalleryUrls,
      index: Math.min(Math.max(galleryIndex, 0), Math.max(normalizedGalleryUrls.length - 1, 0)),
      setIndex: setGalleryIndex,
      goPrev: () => setGalleryIndex((i) => Math.max(0, i - 1)),
      goNext: () => setGalleryIndex((i) => Math.min(normalizedGalleryUrls.length - 1, i + 1)),
    }),
    [normalizedGalleryUrls, galleryIndex]
  );
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const panRef = React.useRef<PanSession>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clampGalleryIndex = React.useCallback(
    (index: number) => Math.min(Math.max(0, index), Math.max(normalizedGalleryUrls.length - 1, 0)),
    [normalizedGalleryUrls.length]
  );

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      const triggerHovered = triggerRef.current?.matches(":hover") === true;
      const panelHovered = panelRef.current?.matches(":hover") === true;
      if (triggerHovered || panelHovered) return;
      setOpen(false);
    }, HOVER_CLOSE_MS);
  }, [cancelClose]);

  const updatePosition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    const viewport = getPreviewViewportSize();
    const maxPanelW = Math.min(
      panelWidth ?? PANEL_MAX_W,
      PANEL_MAX_W,
      viewport.width - 2 * margin
    );
    let left = r.right + margin;
    if (left + maxPanelW > viewport.width - margin) {
      left = Math.max(margin, r.left - maxPanelW - margin);
    }
    let top = r.top;
    const maxH = Math.min(panelHeight ?? viewport.height * 0.88, viewport.height * 0.88);
    if (top + maxH > viewport.height - margin) {
      top = Math.max(margin, viewport.height - maxH - margin);
    }
    setPos({ top, left });
  }, [panelWidth, panelHeight]);

  /** Default preview: file ke aspect ratio ke hisaab se panel, viewport ke max size tak clamp. */
  const syncPanelWidthFromContent = React.useCallback(() => {
    const root = scrollRef.current;
    if (!root || typeof window === "undefined") return;
    const { maxW, maxH, maxContentW, maxContentH } = getViewportFitBox(galleryActive);
    const galleryExtraH = galleryActive ? PANEL_GALLERY_EXTRA_H : 0;

    const attempt = (n: number) => {
      if (n > 48) return;
      const natural = getFitNaturalSize(root);
      if (natural) {
        const { scale: fitWindowScale, widthFitScroll } = resolvePortalFitWindowScale(
          natural,
          maxContentW,
          maxContentH
        );
        root.dataset.portalWidthFitScroll = widthFitScroll ? "1" : "0";
        setPortalVerticalScroll(natural.isMultiPageStitch || widthFitScroll);
        const fitWidthScale = maxContentW / natural.width;
        const fitHeightScale = (maxContentH / Math.max(natural.height, 1)) * FIT_WINDOW_SAFETY;
        const scale =
          fitMode === "width"
            ? fitWidthScale
            : fitMode === "height"
              ? fitHeightScale
              : fitMode === "free"
                ? zoom
                : fitWindowScale;
        const safeScale = Math.min(ZOOM_MAX, Math.max(FIT_ZOOM_MIN, scale));
        /** Fit modes: panel size aur img zoom ek hi scale — warna Fit window blue + 100% zoom + scrollbar */
        if (fitMode === "window" || fitMode === "width" || fitMode === "height") {
          setZoom((prev) => (nearlyEqualZoom(prev, safeScale) ? prev : safeScale));
        }
        const desiredW = natural.width * safeScale + PANEL_CONTENT_PAD_W + (galleryActive ? 20 : 0);
        const desiredH =
          widthFitScroll && fitMode === "window"
            ? maxH
            : natural.height * safeScale + PANEL_CHROME_H + PANEL_CONTENT_PAD_H + galleryExtraH;
        const nextW = clampPanelSize(desiredW, PANEL_MIN_W, maxW);
        const nextH = clampPanelSize(desiredH, PANEL_MIN_H, maxH);
        setPanelWidth((prev) => (prev === nextW ? prev : nextW));
        setPanelHeight((prev) => (prev === nextH ? prev : nextH));
        return;
      }

      let contentW = 0;
      let contentH = 0;
      root.querySelectorAll("img, canvas, video").forEach((el) => {
        const html = el as HTMLElement;
        const w = html.offsetWidth;
        const h = html.offsetHeight;
        if (w > contentW) contentW = w;
        if (h > contentH) contentH += h;
      });
      const inner = root.firstElementChild?.firstElementChild as HTMLElement | null;
      if (inner && inner.scrollWidth > contentW) contentW = inner.scrollWidth;
      if (inner && inner.scrollHeight > contentH) contentH = inner.scrollHeight;

      if (contentW < 4 || contentH < 4) {
        requestAnimationFrame(() => attempt(n + 1));
        return;
      }

      const nextW = clampPanelSize(contentW + PANEL_CONTENT_PAD_W + (galleryActive ? 20 : 0), PANEL_MIN_W, maxW);
      const nextH = clampPanelSize(contentH + PANEL_CHROME_H + PANEL_CONTENT_PAD_H + galleryExtraH, PANEL_MIN_H, maxH);
      setPanelWidth((prev) => (prev === nextW ? prev : nextW));
      setPanelHeight((prev) => (prev === nextH ? prev : nextH));
    };
    requestAnimationFrame(() => attempt(0));
  }, [fitMode, galleryActive, zoom]);

  const setZoomIfChanged = React.useCallback((next: number) => {
    setZoom((prev) => (nearlyEqualZoom(prev, next) ? prev : next));
  }, []);

  const applyTypedZoom = React.useCallback(
    (raw: string) => {
      const next = parseZoomPercentInput(raw);
      if (next == null) return;
      fitModeRef.current = "free";
      setFitMode("free");
      setZoomIfChanged(next);
    },
    [setZoomIfChanged]
  );

  const applyFitWidth = React.useCallback(() => {
    const root = scrollRef.current;
    if (!root || typeof window === "undefined") return;
    setFitMode("width");
    fitModeRef.current = "width";
    const { maxContentW } = getViewportFitBox(galleryActive);

    const attempt = (n: number) => {
      if (n > 60 || fitModeRef.current !== "width") return;
      const natural = getFitNaturalSize(root);
      if (!natural) {
        requestAnimationFrame(() => attempt(n + 1));
        return;
      }
      const z = Math.min(ZOOM_MAX, Math.max(FIT_ZOOM_MIN, maxContentW / natural.width));
      setZoomIfChanged(z);
      requestAnimationFrame(() => {
        root.scrollTo({ left: 0, top: 0, behavior: "auto" });
      });
    };
    attempt(0);
  }, [setZoomIfChanged, galleryActive]);

  const applyFitHeight = React.useCallback(() => {
    const root = scrollRef.current;
    if (!root || typeof window === "undefined") return;
    setFitMode("height");
    fitModeRef.current = "height";
    const { maxContentW, maxContentH } = getViewportFitBox(galleryActive);

    const attempt = (n: number) => {
      if (n > 60 || fitModeRef.current !== "height") return;
      const natural = getFitNaturalSize(root);
      if (!natural) {
        requestAnimationFrame(() => attempt(n + 1));
        return;
      }
      const z = Math.min(
        ZOOM_MAX,
        Math.max(
          FIT_ZOOM_MIN,
          Math.min(maxContentW / natural.width, maxContentH / natural.height) * FIT_WINDOW_SAFETY
        )
      );
      setZoomIfChanged(z);
      requestAnimationFrame(() => {
        const sl = Math.max(0, (root.scrollWidth - root.clientWidth) / 2);
        const st = Math.max(0, (root.scrollHeight - root.clientHeight) / 2);
        root.scrollTo({ left: sl, top: st, behavior: "auto" });
      });
    };
    attempt(0);
  }, [setZoomIfChanged, galleryActive]);

  /** Poori preview — stable viewport box se zoom (client/scrollbar pe mat loop) */
  const applyFitWindow = React.useCallback(() => {
    const root = scrollRef.current;
    if (!root || typeof window === "undefined") return;
    setFitMode("window");
    fitModeRef.current = "window";
    const { maxContentW, maxContentH } = getViewportFitBox(galleryActive);

    const attempt = (n: number) => {
      if (n > 60 || fitModeRef.current !== "window") return;
      const natural = getFitNaturalSize(root);
      if (!natural) {
        /** PDF/thumb baad me aata hai — zoom 100% pe mat chhodna */
        requestAnimationFrame(() => attempt(n + 1));
        return;
      }
      const { scale: z, widthFitScroll } = resolvePortalFitWindowScale(natural, maxContentW, maxContentH);
      root.dataset.portalWidthFitScroll = widthFitScroll ? "1" : "0";
      setPortalVerticalScroll(natural.isMultiPageStitch || widthFitScroll);
      setZoomIfChanged(z);
      requestAnimationFrame(() => {
        const r = scrollRef.current;
        if (!r) return;
        r.scrollTo({ left: 0, top: 0, behavior: "auto" });
      });
    };
    attempt(0);
  }, [setZoomIfChanged, galleryActive]);

  const handleOpen = React.useCallback((initialGalleryIndex?: number | null) => {
    if (effectiveDisabled) return;
    cancelClose();
    setClickPinnedOpen(false);
    setStickOpen(false);
    if (galleryActive) {
      setGalleryIndex(
        clampGalleryIndex(
          initialGalleryIndex != null ? initialGalleryIndex : galleryStartIndex
        )
      );
    }
    updatePosition();
    setOpen(true);
  }, [effectiveDisabled, cancelClose, updatePosition, galleryActive, clampGalleryIndex, galleryStartIndex]);

  /** FilePreview: Preview button se bina hover ke panel kholna */
  React.useEffect(() => {
    onRegisterOpen?.(effectiveDisabled ? null : handleOpen);
    return () => onRegisterOpen?.(null);
  }, [onRegisterOpen, handleOpen, effectiveDisabled]);

  /** Global switch OFF: khula preview turant band (header toggle). */
  React.useEffect(() => {
    if (effectiveDisabled) {
      setOpen(false);
      setStickOpen(false);
    }
  }, [effectiveDisabled]);

  React.useEffect(() => {
    if (!open) {
      setZoom(1);
      setFitMode("window");
      setClickPinnedOpen(false);
      setStickOpen(false);
      setGalleryIndex(0);
      setPanelWidth(null);
      setPanelHeight(null);
      setPortalVerticalScroll(false);
      setZoomInputFocused(false);
      setZoomInputDraft("");
      return;
    }
    if (clickOrTapOpenMode) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.visualViewport?.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.visualViewport?.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePosition, clickOrTapOpenMode]);

  React.useEffect(() => {
    if (!galleryActive) {
      setGalleryIndex(0);
      return;
    }
    setGalleryIndex(clampGalleryIndex(galleryStartIndex));
  }, [normalizedGalleryUrls.join("\x1e"), galleryActive, galleryStartIndex, clampGalleryIndex]);

  /** Gallery file badalne par purane image ka zoom/panel size carry na ho. */
  React.useLayoutEffect(() => {
    if (!open || !galleryActive) return;
    const root = scrollRef.current;
    root?.scrollTo({ left: 0, top: 0, behavior: "auto" });
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      fitModeRef.current = "window";
      lastFitSignatureRef.current = "";
      setFitMode("window");
      setZoom(1);
      setPanelWidth(null);
      setPanelHeight(null);
      raf2 = requestAnimationFrame(() => {
        applyFitWindow();
        syncPanelWidthFromContent();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, galleryActive, galleryState.index, activeGalleryUrl, applyFitWindow, syncPanelWidthFromContent]);

  /** Default: fit to window — `preview` dep mat rakho (har render naya ref = loop) */
  React.useLayoutEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    if (!root) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) applyFitWindow();
    };
    const imgs = root.querySelectorAll("img");
    const onLoad = () => {
      if (!cancelled) run();
    };
    imgs.forEach((im) => {
      if (!im.complete) im.addEventListener("load", onLoad, { once: true });
    });
    const id = requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      imgs.forEach((im) => {
        if (!im.complete) im.removeEventListener("load", onLoad);
      });
    };
  }, [open, applyFitWindow]);

  /**
   * Har `<img>` ko `width = naturalW * zoom` — multi-file stack + PDF thumb baad me aaye to MutationObserver.
   * Fit window: ResizeObserver pe dubara fit MAT — tall files pe scrollbar↔zoom vibrate hota tha.
   */
  const lastFitSignatureRef = React.useRef("");
  React.useLayoutEffect(() => {
    if (!open) {
      setScrollable(false);
      setPortalVerticalScroll(false);
      lastFitSignatureRef.current = "";
      return;
    }
    const root = scrollRef.current;
    if (!root) return;

    const syncScrollable = () => {
      const r = scrollRef.current;
      if (!r) return;
      const verticalScroll = isPortalVerticalScrollRoot(r);
      setPortalVerticalScroll((prev) => (prev === verticalScroll ? prev : verticalScroll));
      /** Fit window/height: overflow hidden — unless tall photo / multi-page PDF (scroll) */
      if ((fitModeRef.current === "window" || fitModeRef.current === "height") && !verticalScroll) {
        setScrollable(false);
        return;
      }
      setScrollable(r.scrollWidth > r.clientWidth + 2 || r.scrollHeight > r.clientHeight + 2);
    };

    const applyLayoutAll = () => {
      root.querySelectorAll("img").forEach((img) => {
        if (!img.naturalWidth || img.naturalWidth < 2) return;
        const nw = img.naturalWidth;
        img.style.width = `${nw * zoom}px`;
        img.style.height = "auto";
        img.style.maxWidth = "none";
        img.style.display = "block";
      });
      syncScrollable();
      requestAnimationFrame(syncScrollable);
      syncPanelWidthFromContent();
    };

    const fitSignature = () => {
      const natural = getFitNaturalSize(root);
      if (!natural) return "";
      const mp = natural.isMultiPageStitch ? ":mp" : root.dataset.portalWidthFitScroll === "1" ? ":scroll" : "";
      return `${fitModeRef.current}:${natural.width}x${natural.height}${mp}`;
    };

    const refitIfNeeded = () => {
      const mode = fitModeRef.current;
      const sig = fitSignature();
      if (!sig) return;
      /** Same natural size pe dubara fit = tall-file zoom loop */
      if (sig === lastFitSignatureRef.current && (mode === "window" || mode === "height" || mode === "width")) {
        applyLayoutAll();
        return;
      }
      lastFitSignatureRef.current = sig;
      if (mode === "window") {
        applyFitWindow();
        return;
      }
      if (mode === "width") {
        applyFitWidth();
        return;
      }
      if (mode === "height") {
        applyFitHeight();
        return;
      }
      applyLayoutAll();
    };

    const forcePdfFit = () => {
      lastFitSignatureRef.current = "";
      fitModeRef.current = "window";
      setFitMode("window");
      setZoom(1);
      setPanelWidth(null);
      setPanelHeight(null);
      requestAnimationFrame(() => {
        applyFitWindow();
        syncPanelWidthFromContent();
        requestAnimationFrame(() => {
          applyFitWindow();
          syncPanelWidthFromContent();
          scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: "auto" });
        });
      });
    };

    const onImgLoad = (ev?: Event) => {
      const target = ev?.target as HTMLElement | null;
      lastFitSignatureRef.current = "";
      if (target?.hasAttribute("data-pdf-portal-page")) {
        forcePdfFit();
        return;
      }
      refitIfNeeded();
    };
    const bindImgLoads = () => {
      root.querySelectorAll("img").forEach((img) => {
        if (img.hasAttribute("data-pdf-portal-page") && img.complete && img.naturalWidth > 1) {
          if (img.dataset.pdfPortalFitApplied !== "1") {
            img.dataset.pdfPortalFitApplied = "1";
            requestAnimationFrame(() => onImgLoad({ target: img } as unknown as Event));
          }
          return;
        }
        if (!img.complete) img.addEventListener("load", onImgLoad as EventListener, { once: true });
      });
    };

    applyLayoutAll();
    bindImgLoads();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            /** Sirf layout sync — applyFitWindow yahan mat (scrollbar vibrate) */
            applyLayoutAll();
            syncScrollable();
          })
        : null;
    ro?.observe(root);

    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            bindImgLoads();
            refitIfNeeded();
          })
        : null;
    mo?.observe(root, { childList: true, subtree: true });

    const onWinResize = () => {
      lastFitSignatureRef.current = "";
      if (
        fitModeRef.current === "window" ||
        fitModeRef.current === "width" ||
        fitModeRef.current === "height"
      ) {
        refitIfNeeded();
      } else {
        syncScrollable();
      }
    };
    window.addEventListener("resize", onWinResize);
    window.visualViewport?.addEventListener("resize", onWinResize);

    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", onWinResize);
      window.visualViewport?.removeEventListener("resize", onWinResize);
    };
  }, [open, zoom, syncPanelWidthFromContent, applyFitWindow, applyFitWidth, applyFitHeight]);

  React.useEffect(() => () => cancelClose(), [cancelClose]);

  const closePanel = React.useCallback(() => {
    cancelClose();
    setOpen(false);
    setClickPinnedOpen(false);
    setStickOpen(false);
  }, [cancelClose]);

  const openRef = React.useRef(open);
  openRef.current = open;
  /** Portal band hone ke baad isi pointer gesture ka pointerup/click txn dialog tak na jaye */
  const outsideDismissGraceUntilRef = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    return registerImperativeDialogBack(closePanel);
  }, [open, closePanel]);

  /**
   * Panel ke bahar click → sirf portal band; pointerup/click swallow taaki txn popup pe action na ho.
   */
  React.useEffect(() => {
    const inDismissGrace = () => Date.now() < outsideDismissGraceUntilRef.current;

    const swallowEvent = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    };

    const onPointerDownCapture = (ev: PointerEvent) => {
      if (inDismissGrace()) {
        swallowEvent(ev);
        return;
      }
      if (ev.button !== 0) return;
      if (!openRef.current) return;
      const t = ev.target as Node;
      if (panelRef.current?.contains(t)) return;

      closePanel();
      markInAppAttachmentPreviewClosing();
      outsideDismissGraceUntilRef.current = Date.now() + 480;
      swallowEvent(ev);
    };

    const onPointerUpOrClickCapture = (ev: Event) => {
      if (!inDismissGrace()) return;
      swallowEvent(ev);
    };

    const cap = { capture: true, passive: false } as const;
    document.addEventListener("pointerdown", onPointerDownCapture, cap);
    document.addEventListener("pointerup", onPointerUpOrClickCapture, cap);
    document.addEventListener("click", onPointerUpOrClickCapture, cap);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, cap);
      document.removeEventListener("pointerup", onPointerUpOrClickCapture, cap);
      document.removeEventListener("click", onPointerUpOrClickCapture, cap);
    };
  }, [closePanel]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePanel();
        return;
      }
      if (!galleryActive) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        galleryState.goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        galleryState.goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePanel, galleryActive, galleryState]);

  /**
   * Dialog open hone par Radix / react-remove-scroll wheel ko lock karta hai; portal `body` par hai isliye
   * native scroll kabhi fire nahi hota — non-passive wheel se yahin scrollTop/Left badhao (baaki jagah bhi safe).
   */
  React.useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
      el.scrollTop += e.deltaY;
      el.scrollLeft += e.deltaX;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  /** PC: mouse left = pan (scroll area); capture hata diya — img se bubble yahi aata hai */
  const handleScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Touch/pen: native scrolling (touch-action pan-x pan-y). Custom pan only for mouse - it fought native scroll and stopped after a short drag.
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [data-gallery-nav]")) return;
    const el = scrollRef.current;
    if (!el) return;
    const canPan = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    if (!canPan) return;
    panRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  const handleScrollPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = panRef.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    el.scrollLeft = s.scrollLeft - dx;
    el.scrollTop = s.scrollTop - dy;
    e.preventDefault();
  };

  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = panRef.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    panRef.current.active = false;
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handleTriggerPointerEnter = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (effectiveDisabled || !openOnHover) return;
    if (useTapMode || globalClickMode) return;
    handleOpen(galleryIndexFromPointerTarget(e.target));
  };

  const handleTriggerPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (effectiveDisabled || !openOnHover || useTapMode || globalClickMode || !galleryActive) return;
    const targetIndex = galleryIndexFromPointerTarget(e.target);
    if (targetIndex == null) return;
    const nextIndex = clampGalleryIndex(targetIndex);
    if (nextIndex === galleryState.index) return;
    cancelClose();
    setGalleryIndex(nextIndex);
    if (!open) {
      updatePosition();
      setOpen(true);
    }
  };

  /** `openOnHover={false}` par bhi chhodne par delay-close — panel `pointerenter` se cancel (thumb→panel gap safe) */
  const handleTriggerPointerLeave = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (effectiveDisabled || stickOpen) return;
    if (useTapMode || globalClickMode) return;
    const next = e.relatedTarget;
    if (next instanceof Node && triggerRef.current?.contains(next)) return;
    scheduleClose();
  };

  /** Panel andar click: hover auto-close off — `stopPropagation` mat (toolbar / zoom buttons ko event chahiye) */
  const handlePanelPointerDownCapture = () => {
    if (stickOpen) return;
    setStickOpen(true);
    cancelClose();
  };

  /** Click/tap: toggle khula — desktop par bhi (global preview ON) taaki hover se accidental open na ho */
  const handleTriggerClick = (e: React.MouseEvent) => {
    if (effectiveDisabled) return;
    const wantClick = useTapMode || forceClickPreview || globalClickMode;
    if (!wantClick) return;
    e.preventDefault();
    e.stopPropagation();
    const targetIndex = galleryIndexFromPointerTarget(e.target);
    setOpen((prev) => {
      if (prev) {
        setClickPinnedOpen(false);
        setStickOpen(false);
        return false;
      }
      setClickPinnedOpen(true);
      setStickOpen(false);
      if (galleryActive) {
        const idx =
          targetIndex != null
            ? clampGalleryIndex(targetIndex)
            : clampGalleryIndex(galleryStartIndex);
        setGalleryIndex(idx);
      }
      updatePosition();
      return true;
    });
  };

  const previewViewport = typeof window !== "undefined" ? getPreviewViewportSize() : { width: PANEL_MAX_W, height: 720 };
  const viewportMaxPanelW = Math.min(PANEL_MAX_W, Math.max(previewViewport.width - 20, PANEL_MIN_W));
  const viewportMaxPanelH = Math.min(Math.floor(previewViewport.height * 0.88), Math.max(previewViewport.height - 16, 260));
  const effectivePanelW =
    panelWidth != null ? Math.min(panelWidth, viewportMaxPanelW) : viewportMaxPanelW;
  const effectivePanelH =
    panelHeight != null ? Math.min(panelHeight, viewportMaxPanelH) : viewportMaxPanelH;
  const measuredPanelHeight = panelHeight != null;
  const panelHeightStyle = measuredPanelHeight ? effectivePanelH : undefined;
  const portalVerticalScrollOpen =
    portalVerticalScroll ||
    (scrollRef.current ? isPortalVerticalScrollRoot(scrollRef.current) : false);
  const measuredContentFrame =
    measuredPanelHeight && (fitMode === "window" || fitMode === "height") && !portalVerticalScrollOpen;

  const portalTree =
    open &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        {/* Khula portal: hamesha backdrop — bahar click se band (click/tap centered = dim overlay) */}
        <div
          className={cn(
            "fixed inset-0",
            clickOrTapOpenMode ? "bg-black/45" : stickOpen ? "bg-black/20" : "bg-transparent"
          )}
          style={{
            zIndex: BACKDROP_Z,
            // Hover: mouse the whole txn thumb, not only the panel edge. Auto backdrop
            // sits on the cell and steals :hover → preview flashes then closes.
            pointerEvents: clickOrTapOpenMode || stickOpen ? "auto" : "none",
          }}
          data-attachment-preview-backdrop=""
          aria-hidden
        />
        <div
          ref={panelRef}
          className={cn(
            "pointer-events-auto fixed flex max-h-[min(88vh,calc(100dvh-16px))] flex-col overflow-hidden",
            // reference-other-app (pic 2): mota blue border + barah round + zoom bar same frame
            "border-[3px] border-blue-600 bg-white shadow-2xl dark:bg-zinc-950",
            "isolate [opacity:1]"
          )}
          style={
            clickOrTapOpenMode
              ? {
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: PANEL_Z,
                  borderRadius: "15mm",
                  width: effectivePanelW,
                  maxWidth: viewportMaxPanelW,
                  height: panelHeightStyle,
                  maxHeight: viewportMaxPanelH,
                }
              : {
                  top: pos.top,
                  left: pos.left,
                  zIndex: PANEL_Z,
                  borderRadius: "15mm",
                  width: effectivePanelW,
                  maxWidth: viewportMaxPanelW,
                  height: panelHeightStyle,
                  maxHeight: viewportMaxPanelH,
                }
          }
          data-attachment-preview-portal=""
          onPointerEnter={clickOrTapOpenMode ? undefined : cancelClose}
          onPointerLeave={clickOrTapOpenMode || stickOpen ? undefined : scheduleClose}
          onPointerDownCapture={clickOrTapOpenMode ? undefined : handlePanelPointerDownCapture}
          /* Bubble par hi stop — capture par mat (warna toolbar button / img tak event pahunchta hi nahi) */
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          /* Portal DOM body par hai lekin React bubble table row tak jata hai — dblclick se voucher edit na khule */
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {/* Title center — close: neeche toolbar + backdrop / Escape (user: header par X nahi) */}
          <div className="relative flex shrink-0 items-center justify-center border-b border-blue-600/25 px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Preview</span>
          </div>

          <div className={cn("relative flex min-h-0 flex-col", measuredPanelHeight ? "flex-1" : "shrink-0")}>
            {galleryActive ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  data-gallery-nav=""
                  className="absolute left-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border border-border/80 bg-background/90 shadow-md backdrop-blur-sm"
                  disabled={galleryState.index <= 0}
                  aria-label="Previous file"
                  onClick={(e) => {
                    e.stopPropagation();
                    galleryState.goPrev();
                  }}
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  data-gallery-nav=""
                  className="absolute right-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border border-border/80 bg-background/90 shadow-md backdrop-blur-sm"
                  disabled={galleryState.index >= normalizedGalleryUrls.length - 1}
                  aria-label="Next file"
                  onClick={(e) => {
                    e.stopPropagation();
                    galleryState.goNext();
                  }}
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </>
            ) : null}

            <div
              ref={scrollRef}
              className={cn(
                "min-h-0 select-none bg-white px-2 pb-2 pt-1 dark:bg-zinc-950",
                measuredPanelHeight ? "flex-1" : "shrink-0",
                /** Fit window/height: overflow hidden — tall photo / multi-page PDF scroll */
                measuredContentFrame ? "overflow-hidden" : "overflow-auto",
                scrollable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
              )}
              style={{
                touchAction: "pan-x pan-y",
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
              }}
              onPointerDown={handleScrollPointerDown}
              onPointerMove={handleScrollPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDragStart={(e) => e.preventDefault()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onPreviewDoubleClick?.(e);
              }}
            >
              <AttachmentPreviewGalleryContext.Provider value={galleryActive ? galleryState : null}>
                <div className="flex w-full min-w-max items-start py-1">
                  <div
                    key={galleryActive ? `${galleryState.index}:${activeGalleryUrl}` : "single"}
                    className="mx-auto inline-block w-max max-w-none shrink-0"
                  >
                    {preview}
                  </div>
                </div>
              </AttachmentPreviewGalleryContext.Provider>
            </div>

            {galleryActive ? (
              <p className="shrink-0 pb-1 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                {galleryState.index + 1} / {normalizedGalleryUrls.length}
              </p>
            ) : null}
          </div>

          {/* PC: zoom +/− neeche; mobile par bhi yahi bar — top se hata diya */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-blue-600/25 px-2 py-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Zoom out"
              onClick={() => {
                fitModeRef.current = "free";
                setFitMode("free");
                setZoom((z) => Math.max(FIT_ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
              }}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <label className="relative flex h-9 w-[3.75rem] shrink-0 items-center">
              <span className="sr-only">Zoom percent</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                aria-label="Zoom percent"
                title="Type zoom % and press Enter"
                className={cn(
                  "h-9 w-full rounded-md border border-input bg-background px-1 text-center text-xs font-medium tabular-nums",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
                )}
                value={zoomInputFocused ? zoomInputDraft : `${Math.round(zoom * 100)}%`}
                onFocus={(e) => {
                  setZoomInputFocused(true);
                  setZoomInputDraft(String(Math.round(zoom * 100)));
                  e.currentTarget.select();
                }}
                onChange={(e) => {
                  setZoomInputDraft(e.target.value.replace(/[^\d.%]/g, ""));
                }}
                onBlur={() => {
                  applyTypedZoom(zoomInputDraft);
                  setZoomInputFocused(false);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyTypedZoom(zoomInputDraft);
                    e.currentTarget.blur();
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setZoomInputFocused(false);
                    e.currentTarget.blur();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Zoom in"
              onClick={() => {
                fitModeRef.current = "free";
                setFitMode("free");
                setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
              }}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-9 shrink-0 border-0 px-2.5 text-xs sm:px-3",
                fitMode === "window"
                  ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
                  : "bg-muted text-muted-foreground hover:bg-muted/90 dark:bg-muted"
              )}
              onClick={applyFitWindow}
            >
              Fit window
            </Button>
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-9 shrink-0 border-0 px-2.5 text-xs sm:px-3",
                fitMode === "width"
                  ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
                  : "bg-muted text-muted-foreground hover:bg-muted/90 dark:bg-muted"
              )}
              onClick={applyFitWidth}
            >
              Width
            </Button>
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-9 shrink-0 border-0 px-2.5 text-xs sm:px-3",
                fitMode === "height"
                  ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
                  : "bg-muted text-muted-foreground hover:bg-muted/90 dark:bg-muted"
              )}
              onClick={applyFitHeight}
            >
              Height
            </Button>
            {activeShareCanonicalUrl ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5 px-2.5 text-xs sm:px-3"
                aria-label="Share file"
                disabled={shareBusy}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (shareBusy) return;
                  const src = resolvePortalSharePreviewSrc(activeShareCanonicalUrl);
                  if (!src) return;
                  const fileName = portalShareFileNameFromUrl(
                    activeShareCanonicalUrl,
                    galleryActive ? undefined : shareFileName
                  );
                  setShareBusy(true);
                  void shareAttachmentFromPreviewSrc(src, fileName, { dialogTitle: "Share file" })
                    .catch((err) => {
                      const name = (err as Error)?.name;
                      if (name === "AbortError") return;
                      console.warn("[AttachmentHoverPortal] share failed", err);
                      if (typeof window !== "undefined") {
                        window.alert(
                          "Could not share this file. Try opening the full preview or download from there."
                        );
                      }
                    })
                    .finally(() => {
                      setShareBusy(false);
                    });
                }}
              >
                <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Share
              </Button>
            ) : null}
            {/* Sirf label — header X se overlap avoid; icon hata user request */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-4 text-xs font-semibold border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-950/50 dark:text-red-100 dark:hover:bg-red-900/50"
              aria-label="Close preview"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closePanel();
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </>,
      document.body
    );

  return (
    <>
      <span
        ref={triggerRef}
        className={cn("inline-flex", triggerClassName)}
        onPointerEnter={handleTriggerPointerEnter}
        onPointerMove={handleTriggerPointerMove}
        onPointerLeave={handleTriggerPointerLeave}
        onClick={handleTriggerClick}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {children}
      </span>
      {portalTree}
    </>
  );
}
