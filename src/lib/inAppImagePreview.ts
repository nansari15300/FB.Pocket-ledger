"use client";

/**
 * Full-screen image overlay — gallery jaisa: layer/back stack, Close = pointerup (touch reliable),
 * Browser = native APK par `Browser.open`, warna programmatic `<a target=_blank>`; zoom ± / Fit + pinch.
 */
import { Capacitor } from "@capacitor/core";
import {
  attachPreviewCloseInteraction,
  pushInAppAttachmentPreviewLayer,
  scheduleInAppAttachmentPreviewRootRemoval,
  setAttachmentPreviewHardwareBackHandler,
} from "@/lib/inAppAttachmentPreviewOpen";
import { mountGalleryImageZoom, type GalleryImageZoomApi } from "@/lib/inAppGalleryImageZoom";
import { shareAttachmentFromPreviewSrc } from "@/lib/shareAttachmentBlob";

export function showInAppImagePreview(
  imageSrc: string,
  onDispose: () => void,
  options?: { title?: string; /** Multi-page PDF raster: fit 1 page height, scroll for baaki */ pdfOnePageHeightPx?: number }
): void {
  if (typeof document === "undefined") return;

  const title = options?.title ?? "Image preview";

  const root = document.createElement("div");
  root.setAttribute("data-in-app-image-preview", "1");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", title);
  root.tabIndex = -1;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui,-apple-system,sans-serif",
    pointerEvents: "auto",
    touchAction: "manipulation",
  } as CSSStyleDeclaration);

  let closed = false;
  let imageZoomApi: GalleryImageZoomApi | null = null;

  const safeClose = () => {
    if (closed) return;
    closed = true;
    imageZoomApi?.dispose();
    imageZoomApi = null;
    scheduleInAppAttachmentPreviewRootRemoval(root, () => {
      setAttachmentPreviewHardwareBackHandler(null);
      try {
        onDispose();
      } catch {
        /* ignore */
      }
    });
  };

  const mkBtn = (label: string, primary?: boolean) => {
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
  };

  const scrollHost = document.createElement("div");
  scrollHost.style.cssText =
    "flex:1;min-height:0;overflow:hidden;background:#2a2a2a;display:flex;flex-direction:column;touch-action:pan-y";

  const img = document.createElement("img");
  img.alt = "";
  img.src = imageSrc;

  const err = document.createElement("p");
  err.style.cssText = "color:#e5e5e5;text-align:center;padding:24px;display:none;margin:0";
  err.textContent = "Image load failed — try opening in browser from attachment link.";

  const zoomOutBtn = mkBtn("−");
  zoomOutBtn.setAttribute("aria-label", "Zoom out");
  zoomOutBtn.style.minWidth = "44px";
  const zoomInBtn = mkBtn("+");
  zoomInBtn.setAttribute("aria-label", "Zoom in");
  zoomInBtn.style.minWidth = "44px";
  const fitWidthBtn = mkBtn("Width", true);
  fitWidthBtn.setAttribute("aria-label", "Fit to width");
  const fitHeightBtn = mkBtn("Height");
  fitHeightBtn.setAttribute("aria-label", "Fit to height — full image in view");

  /** Width/Height — active blue, inactive gray (AttachmentHoverPortal jaisa) */
  const fitBtnBase =
    "padding:10px 16px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;min-height:44px;";
  const styleFitButtons = (widthActive: boolean) => {
    fitWidthBtn.style.cssText =
      fitBtnBase + (widthActive ? "background:#2563eb;color:#fff;" : "background:#52525b;color:#d4d4d8;");
    fitHeightBtn.style.cssText =
      fitBtnBase + (!widthActive ? "background:#2563eb;color:#fff;" : "background:#52525b;color:#d4d4d8;");
  };

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

  const showZoomBar = (ok: boolean) => {
    const d = ok ? "" : "none";
    zoomOutBtn.style.display = d;
    zoomInBtn.style.display = d;
    fitWidthBtn.style.display = d;
    fitHeightBtn.style.display = d;
  };
  showZoomBar(true);

  img.onerror = () => {
    imageZoomApi?.dispose();
    imageZoomApi = null;
    scrollHost.replaceChildren(err);
    err.style.display = "block";
    showZoomBar(false);
  };

  imageZoomApi = mountGalleryImageZoom(scrollHost, img, () => {}, {
    onePageHeightPx: options?.pdfOnePageHeightPx,
  });

  /** Default fit = height (poora image screen me) — button rang sync */
  const syncFitButtonsToHeight = () => styleFitButtons(false);
  if (img.complete && img.naturalWidth > 1) syncFitButtonsToHeight();
  else img.addEventListener("load", syncFitButtonsToHeight, { once: true });

  const bar = document.createElement("div");
  bar.setAttribute("role", "toolbar");
  bar.style.cssText =
    "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-start;padding:12px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom,0px));background:#1a1a1a;color:#fff;flex-shrink:0;box-shadow:0 -2px 10px rgba(0,0,0,0.35);border-top:1px solid #333";

  const titleEl = document.createElement("span");
  titleEl.textContent = title;
  titleEl.style.cssText =
    "flex:1;min-width:120px;font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:auto";

  const closeBtn = mkBtn("Close");
  attachPreviewCloseInteraction(closeBtn, safeClose);

  const openBtn = mkBtn("Browser");
  /** APK: real device browser (not the in-app Custom Tab that had no way to close). */
  const openInSystemBrowser = () => {
    const href = String(imageSrc || "").trim();
    if (!href) return;
    void (async () => {
      if (/^https?:\/\//i.test(href)) {
        const { openInDeviceBrowser } = await import("@/lib/openInDeviceBrowser");
        if (await openInDeviceBrowser(href)) return;
      }
      // blob:/data: cannot be handed to another app — fall back to a new tab/anchor.
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
    })();
  };
  openBtn.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      openInSystemBrowser();
    },
    { passive: false }
  );
  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  /** APK / browser — file ko WhatsApp, Gmail, Drive wagaira me share */
  const shareBtn = mkBtn("Share");
  const runShare = () => {
    shareBtn.disabled = true;
    void shareAttachmentFromPreviewSrc(imageSrc, title, { dialogTitle: "Share file" })
      .catch((e) => {
        const name = (e as Error)?.name;
        if (name === "AbortError") return;
        console.warn("[inAppImagePreview] share failed", e);
        if (typeof window !== "undefined") {
          window.alert("Could not share this file. Try Browser to open it in another app.");
        }
      })
      .finally(() => {
        shareBtn.disabled = false;
      });
  };
  shareBtn.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      runShare();
    },
    { passive: false }
  );
  shareBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  /** Single-click = pan (gallery); double-click = browser / tab */
  img.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInSystemBrowser();
  });

  bar.append(titleEl, openBtn, shareBtn, zoomOutBtn, zoomInBtn, fitWidthBtn, fitHeightBtn, closeBtn);
  root.append(scrollHost, bar);

  root.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        safeClose();
      }
    },
    true
  );

  document.body.appendChild(root);
  pushInAppAttachmentPreviewLayer(root);
  setAttachmentPreviewHardwareBackHandler(safeClose);

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
