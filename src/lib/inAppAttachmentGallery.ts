"use client";

/**
 * Multi-attachment full-screen viewer: PC par ← → arrows + keyboard; mobile par horizontal swipe.
 * Image slides: zoom ± / Fit + pan/pinch (`inAppImagePreview` jaisa).
 */
import { isPbAttachmentRef, resolvePbAttachmentDisplay } from "@/lib/pocketbaseData/pbAttachments";
import { isLocalFileRef, getBlobFromLocalFileRef } from "@/lib/localPendingFiles";
import { tryGetBlobFromFirebaseStorageDownloadUrl } from "@/lib/storageGetBlobFromDownloadUrl";
import {
  getOfflineCachedAttachmentBlob,
  getRemoteAttachmentBlobPreferOfflineCache,
} from "@/lib/offlineAttachmentUrlCache";
import { sniffBlobKindForPreview } from "@/lib/attachmentFormatLabel";
import {
  attachPreviewCloseInteraction,
  pushInAppAttachmentPreviewLayer,
  scheduleInAppAttachmentPreviewRootRemoval,
  setAttachmentPreviewHardwareBackHandler,
} from "@/lib/inAppAttachmentPreviewOpen";
import type { AttachmentKindHint } from "@/lib/openAttachmentInApp";
import { mountGalleryImageZoom, type GalleryImageZoomApi } from "@/lib/inAppGalleryImageZoom";
import { dismissOpenInAppPdfPreviewIfPresent, showInAppPdfPreview } from "@/lib/inAppPdfPreview";
import { shareAttachmentFromPreviewSrc } from "@/lib/shareAttachmentBlob";
import { resolveStaticAttachmentDisplay } from "@/lib/staticAttachmentDisplayUrl";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import type { CompanyAttachmentMode } from "@/lib/companyAttachmentStrategies/types";

function pathLooksImage(pathLower: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/.test(pathLower);
}

function pathLooksPdf(pathLower: string): boolean {
  if (pathLower.endsWith(".pdf")) return true;
  if (pathLower.includes(".pdf")) return true;
  try {
    const dec = decodeURIComponent(pathLower);
    return dec.endsWith(".pdf") || /\.pdf(\?|$)/i.test(dec);
  } catch {
    return false;
  }
}

type ResolvedSlide =
  | { kind: "image"; src: string; revoke: () => void }
  | { kind: "pdf"; src: string; revoke: () => void }
  | { kind: "other"; href: string; revoke: () => void };

async function resolveSlide(
  url: string,
  kindHint?: AttachmentKindHint,
  options?: { localLedgerOnly?: boolean; companyId?: string; companyMode?: CompanyAttachmentMode }
): Promise<ResolvedSlide> {
  const u = String(url || "").trim();
  const noop = () => {};

  // Pocket Ledger Server (PocketBase) link: server bytes -> blob URL (cached in pbAttachments).
  if (isPbAttachmentRef(u)) {
    const resolved = await resolvePbAttachmentDisplay(u);
    if (!resolved.displayUrl) return { kind: "other", href: "", revoke: noop };
    const pathOnly = u.toLowerCase();
    const ct = String(resolved.contentType || "").toLowerCase();
    const isPdf = kindHint === "pdf" || ct.includes("pdf") || pathLooksPdf(pathOnly);
    return { kind: isPdf ? "pdf" : "image", src: resolved.displayUrl, revoke: noop };
  }

  // EXE/APK: display sirf pl-attachments / blob — HTTPS transport download ke liye preload me.
  if (usesEmbeddedNativeAttachmentStorage()) {
    const resolved = await resolveStaticAttachmentDisplay(u, {
      localLedgerOnly: options?.localLedgerOnly ?? true,
      companyId: options?.companyId,
      companyMode: options?.companyMode,
    });
    if (resolved.displayUrl) {
      const pathOnly = u.split("?")[0].split("#")[0].toLowerCase();
      const slideKind: "image" | "pdf" =
        kindHint === "pdf" || pathLooksPdf(pathOnly)
          ? "pdf"
          : kindHint === "image" || pathLooksImage(pathOnly)
            ? "image"
            : String(resolved.contentType || "").toLowerCase().includes("pdf")
              ? "pdf"
              : "image";
      return { kind: slideKind, src: resolved.displayUrl, revoke: noop };
    }
    if (resolved.blob && resolved.blob.size > 0) {
      const objectUrl = URL.createObjectURL(resolved.blob);
      const revoke = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      };
      const kind = await sniffBlobKindForPreview(resolved.blob);
      if (kind === "image") return { kind: "image", src: objectUrl, revoke };
      if (kind === "pdf") return { kind: "pdf", src: objectUrl, revoke };
      revoke();
    }
    return { kind: "other", href: u, revoke: noop };
  }

  if (isLocalFileRef(u)) {
    const blob = await getBlobFromLocalFileRef(u);
    if (!blob || blob.size === 0) {
      return { kind: "other", href: u, revoke: noop };
    }
    const objectUrl = URL.createObjectURL(blob);
    const revoke = () => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    };
    const mime = (blob.type || "").toLowerCase();
    if (kindHint === "image" || mime.startsWith("image/")) {
      return { kind: "image", src: objectUrl, revoke };
    }
    if (kindHint === "pdf" || mime === "application/pdf" || mime.includes("pdf")) {
      return { kind: "pdf", src: objectUrl, revoke };
    }
    if (mime.startsWith("image/")) return { kind: "image", src: objectUrl, revoke };
    if (mime === "application/pdf" || mime.includes("pdf")) return { kind: "pdf", src: objectUrl, revoke };
    revoke();
    return { kind: "other", href: u, revoke: noop };
  }

  const pathOnly = u.split("?")[0].split("#")[0].toLowerCase();
  const isDataImage = u.startsWith("data:image/");
  const isDataPdf =
    u.startsWith("data:application/pdf") || u.toLowerCase().startsWith("data:application%2fpdf");

  // Full-screen viewer: HTTPS ko seedha `src` mat — pehle IndexedDB / gated fetch
  if (/^https?:\/\//i.test(u)) {
    const fetchOpts = {
      companyId: options?.companyId,
      explicitUserRequest: !options?.localLedgerOnly,
    };
    let hb = await getOfflineCachedAttachmentBlob(u);
    if ((!hb || hb.size === 0) && typeof navigator !== "undefined" && navigator.onLine) {
      hb =
        (await getRemoteAttachmentBlobPreferOfflineCache(u, undefined, fetchOpts)) ?? null;
    }
    if (hb && hb.size > 0) {
      const objectUrl = URL.createObjectURL(hb);
      const revoke = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      };
      const kind = await sniffBlobKindForPreview(hb);
      if (kind === "image") return { kind: "image", src: objectUrl, revoke };
      if (kind === "pdf") return { kind: "pdf", src: objectUrl, revoke };
      revoke();
    }
  }

  if (kindHint === "image" || isDataImage || pathLooksImage(pathOnly)) {
    if (!/^https?:\/\//i.test(u)) {
      return { kind: "image", src: u, revoke: noop };
    }
    const resolved = await resolveStaticAttachmentDisplay(u, {
      localLedgerOnly: options?.localLedgerOnly ?? false,
      companyId: options?.companyId,
      companyMode: options?.companyMode,
    });
    if (resolved.displayUrl) return { kind: "image", src: resolved.displayUrl, revoke: noop };
    if (resolved.blob && resolved.blob.size > 0) {
      const objectUrl = URL.createObjectURL(resolved.blob);
      const revoke = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      };
      return { kind: "image", src: objectUrl, revoke };
    }
    return { kind: "other", href: u, revoke: noop };
  }

  if (kindHint === "pdf" || isDataPdf || pathLooksPdf(pathOnly)) {
    const fetchOpts = {
      companyId: options?.companyId,
      explicitUserRequest: !options?.localLedgerOnly,
    };
    try {
      let blob: Blob | null = await tryGetBlobFromFirebaseStorageDownloadUrl(u, undefined, fetchOpts);
      if (!blob) {
        const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
        if (isRemoteAttachmentNetworkFetchAllowed(u, fetchOpts)) {
          const res = await fetch(u, { mode: "cors", credentials: "omit" });
          if (res.ok) blob = await res.blob();
        }
      }
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        return {
          kind: "pdf",
          src: objectUrl,
          revoke: () => {
            try {
              URL.revokeObjectURL(objectUrl);
            } catch {
              /* ignore */
            }
          },
        };
      }
    } catch {
      /* direct URL iframe */
    }
    return { kind: "other", href: u, revoke: noop };
  }

  const fetchOpts = {
    companyId: options?.companyId,
    explicitUserRequest: !options?.localLedgerOnly,
  };
  try {
    let blob: Blob | null = await tryGetBlobFromFirebaseStorageDownloadUrl(u, undefined, fetchOpts);
    if (!blob) {
      const { isRemoteAttachmentNetworkFetchAllowed } = await import("@/lib/attachmentNetworkGate");
      if (isRemoteAttachmentNetworkFetchAllowed(u, fetchOpts)) {
        const res = await fetch(u, { mode: "cors", credentials: "omit" });
        if (res.ok) blob = await res.blob();
      }
    }
    if (blob) {
      const mime = (blob.type || "").toLowerCase();
      const objectUrl = URL.createObjectURL(blob);
      const revoke = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      };
      if (mime.startsWith("image/")) return { kind: "image", src: objectUrl, revoke };
      if (mime === "application/pdf" || mime.includes("pdf")) return { kind: "pdf", src: objectUrl, revoke };
      revoke();
    }
  } catch {
    /* fall through */
  }

  return { kind: "other", href: u, revoke: noop };
}

function mkBarBtn(label: string, primary?: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = [
    "padding:10px 16px",
    "border-radius:8px",
    "border:none",
    "font-size:14px",
    "font-weight:600",
    "cursor:pointer",
    "min-height:44px",
    primary ? "background:#2563eb;color:#fff" : "background:#3f3f46;color:#e4e4e7",
  ].join(";");
  return b;
}

function setZoomControlsVisible(
  zoomOutBtn: HTMLButtonElement,
  zoomInBtn: HTMLButtonElement,
  fitWidthBtn: HTMLButtonElement,
  fitHeightBtn: HTMLButtonElement,
  visible: boolean
) {
  const d = visible ? "" : "none";
  zoomOutBtn.style.display = d;
  zoomInBtn.style.display = d;
  fitWidthBtn.style.display = d;
  fitHeightBtn.style.display = d;
}

/**
 * `urls` order same as voucher / entity; `startIndex` = jis file par user ne click kiya.
 */
export function openAttachmentGalleryInApp(
  urls: readonly string[],
  startIndex: number,
  opts?: {
    title?: string;
    kinds?: readonly AttachmentKindHint[];
    localLedgerOnly?: boolean;
    companyId?: string;
    companyMode?: CompanyAttachmentMode;
  }
): void {
  if (typeof document === "undefined") return;

  const list = urls.map((u) => String(u).trim()).filter((s) => s.length > 0);
  if (list.length === 0) return;
  if (opts?.companyId && !opts?.localLedgerOnly) {
    void import("@/lib/attachmentNetworkGate").then(({ grantExplicitAttachmentNetworkFetchBatch }) => {
      grantExplicitAttachmentNetworkFetchBatch(list, opts.companyId);
    });
  }
  if (list.length === 1) {
    void import("@/lib/openAttachmentInApp").then(({ openAttachmentInApp }) =>
      openAttachmentInApp(list[0]!, {
        title: opts?.title,
        kind: opts?.kinds?.[0],
        serverFallback:
          opts?.companyId && opts?.companyMode === "server"
            ? { companyId: opts.companyId, voucherId: "" }
            : undefined,
      })
    );
    return;
  }

  let idx = Math.max(0, Math.min(startIndex, list.length - 1));
  const baseTitle = opts?.title ?? "Attachments";

  const root = document.createElement("div");
  root.setAttribute("data-in-app-attachment-gallery", "1");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", baseTitle);
  root.tabIndex = -1;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui,-apple-system,sans-serif",
    pointerEvents: "auto",
    touchAction: "manipulation",
  } as CSSStyleDeclaration);

  let closed = false;
  let currentRevoke: (() => void) | null = null;
  let loadSeq = 0;
  /** Image slide par zoom > 1 huda swipe se file change nahin — accidental slide switch roknko */
  let currentImageScale = 1;
  let imageZoomApi: GalleryImageZoomApi | null = null;

  const disposeSlideBlob = () => {
    if (currentRevoke) {
      try {
        currentRevoke();
      } catch {
        /* ignore */
      }
      currentRevoke = null;
    }
  };

  const safeClose = () => {
    if (closed) return;
    closed = true;
    imageZoomApi?.dispose();
    imageZoomApi = null;
    disposeSlideBlob();
    scheduleInAppAttachmentPreviewRootRemoval(root, () => setAttachmentPreviewHardwareBackHandler(null));
  };

  const titleEl = document.createElement("span");
  titleEl.style.cssText =
    "flex:1;min-width:120px;font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:auto;color:#fff";

  const counterEl = document.createElement("span");
  counterEl.style.cssText = "color:#bbb;font-size:13px;margin-right:8px;white-space:nowrap";

  const slideHost = document.createElement("div");
  slideHost.style.cssText =
    "flex:1;min-height:0;position:relative;overflow:hidden;background:#2a2a2a;display:flex;flex-direction:column;touch-action:pan-y";

  const stageEl = document.createElement("div");
  stageEl.style.cssText =
    "flex:1;min-height:0;width:100%;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:stretch";

  const mkNavBtn = (side: "left" | "right", label: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.textContent = side === "left" ? "‹" : "›";
    b.style.cssText = [
      "position:absolute",
      side === "left" ? "left:8px" : "right:8px",
      "top:50%",
      "transform:translateY(-50%)",
      "z-index:6",
      "width:48px",
      "height:48px",
      "border-radius:999px",
      "border:none",
      "background:rgba(0,0,0,0.55)",
      "color:#fff",
      "font-size:28px",
      "line-height:1",
      "cursor:pointer",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:0",
      "box-shadow:0 2px 8px rgba(0,0,0,0.35)",
    ].join(";");
    return b;
  };

  const prevBtn = mkNavBtn("left", "Previous file");
  const nextBtn = mkNavBtn("right", "Next file");

  slideHost.append(prevBtn, nextBtn, stageEl);

  const updateNavVisibility = () => {
    const multi = list.length > 1;
    prevBtn.style.display = multi ? "flex" : "none";
    nextBtn.style.display = multi ? "flex" : "none";
    counterEl.textContent = `${idx + 1} / ${list.length}`;
    titleEl.textContent = baseTitle;
  };

  const go = (delta: number) => {
    if (list.length <= 1 || closed) return;
    idx = (idx + delta + list.length) % list.length;
    void renderSlide();
  };

  prevBtn.onclick = () => go(-1);
  nextBtn.onclick = () => go(1);

  /** Mobile: horizontal swipe — zoomed image par band (pan vs next file) */
  let touchStartX = 0;
  let touchStartY = 0;
  let touchT0 = 0;
  slideHost.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0]!.clientX;
      touchStartY = e.touches[0]!.clientY;
      touchT0 = Date.now();
    },
    { passive: true }
  );
  slideHost.addEventListener(
    "touchend",
    (e) => {
      if (e.changedTouches.length !== 1) return;
      const scaleLive = imageZoomApi?.getScale() ?? currentImageScale;
      if (scaleLive > 1.02) return;
      const x = e.changedTouches[0]!.clientX;
      const y = e.changedTouches[0]!.clientY;
      const dx = x - touchStartX;
      const dy = y - touchStartY;
      const dt = Date.now() - touchT0;
      if (dt > 900) return;
      if (Math.abs(dx) < 72) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
      if (dx > 0) go(-1);
      else go(1);
    },
    { passive: true }
  );

  const zoomOutBtn = mkBarBtn("−");
  zoomOutBtn.setAttribute("aria-label", "Zoom out");
  zoomOutBtn.style.minWidth = "44px";

  const zoomInBtn = mkBarBtn("+");
  zoomInBtn.setAttribute("aria-label", "Zoom in");
  zoomInBtn.style.minWidth = "44px";

  const fitWidthBtn = mkBarBtn("Width", true);
  fitWidthBtn.setAttribute("aria-label", "Fit to width");
  const fitHeightBtn = mkBarBtn("Height");
  fitHeightBtn.setAttribute("aria-label", "Fit to height — full image in view");

  const fitBtnBase =
    "padding:10px 16px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;min-height:44px;";
  const styleFitButtons = (widthActive: boolean) => {
    fitWidthBtn.style.cssText =
      fitBtnBase + (widthActive ? "background:#2563eb;color:#fff;" : "background:#52525b;color:#d4d4d8;");
    fitHeightBtn.style.cssText =
      fitBtnBase + (!widthActive ? "background:#2563eb;color:#fff;" : "background:#52525b;color:#d4d4d8;");
  };

  setZoomControlsVisible(zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, false);

  zoomOutBtn.onclick = () => imageZoomApi?.zoomOut();
  zoomInBtn.onclick = () => imageZoomApi?.zoomIn();
  fitWidthBtn.onclick = () => {
    imageZoomApi?.fitWidth();
    styleFitButtons(true);
  };
  fitHeightBtn.onclick = () => {
    imageZoomApi?.fitHeight();
    styleFitButtons(false);
  };

  const renderSlide = async () => {
    const seq = ++loadSeq;
    // Pehle khula PDF overlay band — warna iframe-era jaisa blob / handler race (Electron / static)
    dismissOpenInAppPdfPreviewIfPresent();
    disposeSlideBlob();
    imageZoomApi?.dispose();
    imageZoomApi = null;
    currentImageScale = 1;
    setZoomControlsVisible(zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, false);

    stageEl.replaceChildren();
    updateNavVisibility();

    const loading = document.createElement("p");
    loading.textContent = "Loading…";
    loading.style.cssText =
      "color:#ddd;text-align:center;padding:24px;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;pointer-events:none;z-index:1";
    stageEl.appendChild(loading);

    try {
      const hint = opts?.kinds?.[idx];
      const resolved = await resolveSlide(list[idx]!, hint, {
        localLedgerOnly: opts?.localLedgerOnly,
        companyId: opts?.companyId,
        companyMode: opts?.companyMode,
      });
      if (seq !== loadSeq || closed) {
        resolved.revoke();
        return;
      }
      currentRevoke = resolved.revoke;
      loading.remove();

      if (resolved.kind === "image") {
        const scrollHost = document.createElement("div");
        stageEl.appendChild(scrollHost);

        const img = document.createElement("img");
        img.src = resolved.src;
        img.alt = "";
        img.onerror = () => {
          imageZoomApi?.dispose();
          imageZoomApi = null;
          setZoomControlsVisible(zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, false);
          scrollHost.replaceChildren();
          scrollHost.appendChild(
            Object.assign(document.createElement("p"), {
              textContent: "Image failed to load",
              style: "color:#fcc;padding:16px;text-align:center",
            })
          );
        };

        imageZoomApi = mountGalleryImageZoom(scrollHost, img, (s) => {
          currentImageScale = s;
        });
        setZoomControlsVisible(zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, true);
        const syncFitH = () => styleFitButtons(false);
        if (img.complete && img.naturalWidth > 1) syncFitH();
        else img.addEventListener("load", syncFitH, { once: true });

        img.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const href = String(resolved.src || "").trim();
          if (!href) return;
          try {
            const a = document.createElement("a");
            a.href = href;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            requestAnimationFrame(() => {
              try {
                a.remove();
              } catch {
                /* ignore */
              }
            });
          } catch {
            /* ignore */
          }
        });
      } else {
        const wrap = document.createElement("div");
        let shouldAppendWrap = true;
        wrap.style.cssText =
          "box-sizing:border-box;width:100%;height:100%;max-height:100%;overflow:auto;padding:8px 56px;display:flex;align-items:center;justify-content:center;-webkit-overflow-scrolling:touch";

        if (resolved.kind === "pdf") {
          try {
            const pdfBlob = await fetch(resolved.src).then((r) => (r.ok ? r.blob() : null));
            if (!pdfBlob?.size) throw new Error("empty_pdf");
            const { convertPdfForPortalRasterPreview } = await import("@/lib/pdfToImageExport");
            const result = await convertPdfForPortalRasterPreview(pdfBlob, {
              quality: 0.92,
              maxPageWidth: 1800,
            });
            resolved.revoke();
            currentRevoke = () => {
              try {
                URL.revokeObjectURL(result.thumbnailUrl);
              } catch {}
            };
            shouldAppendWrap = false;
            const scrollHost = document.createElement("div");
            stageEl.appendChild(scrollHost);
            const img = document.createElement("img");
            img.src = result.thumbnailUrl;
            img.alt = "";
            img.onerror = () => {
              imageZoomApi?.dispose();
              imageZoomApi = null;
              setZoomControlsVisible(zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, false);
              scrollHost.replaceChildren();
              scrollHost.appendChild(
                Object.assign(document.createElement("p"), {
                  textContent: "PDF preview failed",
                  style: "color:#fcc;padding:16px;text-align:center",
                })
              );
            };
            imageZoomApi = mountGalleryImageZoom(
              scrollHost,
              img,
              (s) => {
                currentImageScale = s;
              },
              { onePageHeightPx: result.portalMeta?.onePageHeightPx }
            );
            setZoomControlsVisible(zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, true);
            const syncFitH = () => styleFitButtons(false);
            if (img.complete && img.naturalWidth > 1) syncFitH();
            else img.addEventListener("load", syncFitH, { once: true });
          } catch {
            showInAppPdfPreview(resolved.src, resolved.revoke, {
              title: `${baseTitle} (${idx + 1}/${list.length})`,
              fileName: `attachment-${idx + 1}.pdf`,
              onAfterPreviewLayerRemoved: () => setAttachmentPreviewHardwareBackHandler(safeClose),
            });
            wrap.appendChild(
              Object.assign(document.createElement("p"), {
                textContent: "PDF opened above — close it to return here. Use ‹ › for other files.",
                style:
                  "color:#a3a3a3;text-align:center;padding:16px;font-size:13px;margin:0;line-height:1.35;max-width:min(92vw,320px)",
              })
            );
          }
        } else {
          const p = document.createElement("p");
          p.style.cssText = "color:#ddd;text-align:center;padding:16px";
          p.textContent = "Preview not available for this file.";
          const a = document.createElement("a");
          a.href = resolved.href;
          a.textContent = "Open file";
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.style.cssText = "display:inline-block;margin-top:12px;color:#7dd3fc;font-weight:600";
          const box = document.createElement("div");
          box.style.cssText = "display:flex;flex-direction:column;align-items:center";
          box.appendChild(p);
          box.appendChild(a);
          wrap.appendChild(box);
        }

        if (shouldAppendWrap) stageEl.appendChild(wrap);
      }
    } catch {
      if (seq === loadSeq && !closed) {
        loading.textContent = "Could not load file.";
      }
    }
  };

  const bar = document.createElement("div");
  bar.setAttribute("role", "toolbar");
  bar.style.cssText =
    "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-start;padding:12px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom,0px));background:#1a1a1a;color:#fff;flex-shrink:0;box-shadow:0 -2px 10px rgba(0,0,0,0.35);border-top:1px solid #333";

  const closeBtn = mkBarBtn("Close");
  attachPreviewCloseInteraction(closeBtn, safeClose);

  /** Gallery me bhi current file external app me share */
  const shareBtn = mkBarBtn("Share");
  shareBtn.onclick = () => {
    shareBtn.disabled = true;
    const url = list[idx]!;
    void shareAttachmentFromPreviewSrc(url, `${baseTitle}-${idx + 1}`, { dialogTitle: "Share attachment" })
      .catch((e) => {
        const name = (e as Error)?.name;
        if (name === "AbortError") return;
        console.warn("[inAppAttachmentGallery] share failed", e);
        if (typeof window !== "undefined") {
          window.alert("Could not share this file.");
        }
      })
      .finally(() => {
        shareBtn.disabled = false;
      });
  };

  bar.append(titleEl, counterEl, shareBtn, zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, closeBtn);
  root.append(slideHost, bar);

  root.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        safeClose();
        return;
      }
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        go(-1);
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        go(1);
      }
    },
    true
  );

  document.body.appendChild(root);
  pushInAppAttachmentPreviewLayer(root);
  setAttachmentPreviewHardwareBackHandler(safeClose);
  void renderSlide();

  requestAnimationFrame(() => {
    try {
      root.focus({ preventScroll: true });
    } catch {
      try {
        root.focus();
      } catch {
        /* ignore */
      }
    }
  });
}
