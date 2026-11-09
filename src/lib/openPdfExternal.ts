"use client";

import { Capacitor } from "@capacitor/core";
import { isElectronEnvironment } from "@/hooks/use-mobile";

/** Capacitor native check — dynamic import se pehle */
function isCapacitorNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Sirf Capacitor **native** (APK): system / Custom Tab / FileOpener.
 * Baaki sab (Electron, touch Windows, mobile browser, static HTTP): false — `showInAppPdfPreview` + PDF.js; touch ≠ APK.
 */
export function shouldOpenPdfInExternalViewer(): boolean {
  if (typeof window === "undefined") return false;
  // Pehle Capacitor native (APK) — Android WebView UA me `wv` ho sakta hai; `isElectronEnvironment` isse pehle na chalao
  if (isCapacitorNative()) return true;
  if (isElectronEnvironment()) return false;
  return false;
}

/** Blob → base64 data URL (Filesystem write ke liye) */
function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Remote PDF URL (server / download link) — native: the device's real browser (not a Custom Tab,
 * which had no close affordance); web: a new tab.
 */
export async function openHttpPdfInExternalBrowser(url: string): Promise<void> {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) {
    console.warn("[openPdfExternal] expected http(s) URL", u.slice(0, 64));
    return;
  }
  const { openInDeviceBrowser } = await import("@/lib/openInDeviceBrowser");
  if (await openInDeviceBrowser(u)) return;
  window.open(u, "_blank", "noopener,noreferrer");
}

/**
 * Client-generated PDF blob — native: cache + FileOpener (Chrome / default PDF app); mobile web: nayi tab me blob URL.
 */
export async function openPdfBlobInExternalViewer(blob: Blob, fileName: string): Promise<void> {
  const safeName = (fileName || "document.pdf").replace(/[^a-zA-Z0-9._-]+/g, "_") || "document.pdf";
  if (typeof window === "undefined") return;

  if (!isCapacitorNative()) {
    const bUrl = URL.createObjectURL(blob);
    window.open(bUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => {
      try {
        URL.revokeObjectURL(bUrl);
      } catch {
        /* ignore */
      }
    }, 120_000);
    return;
  }

  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const dataUrl = await blobToBase64DataUrl(blob);
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
    const path = `pdf-external-${Date.now()}-${safeName}`;
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({
      path,
      directory: Directory.Cache,
    });
    const { FileOpener } = await import("@capacitor-community/file-opener");
    await FileOpener.open({
      filePath: uri,
      contentType: "application/pdf",
      openWithDefault: true,
    });
  } catch (e) {
    console.warn("[openPdfExternal] FileOpener failed, Share fallback", e);
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const dataUrl = await blobToBase64DataUrl(blob);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
      const path = `pdf-share-${Date.now()}-${safeName}`;
      await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({ title: safeName, url: uri, dialogTitle: "Open PDF" });
    } catch (e2) {
      console.warn("[openPdfExternal] Share fallback failed", e2);
      const bUrl = URL.createObjectURL(blob);
      window.open(bUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(bUrl), 120_000);
    }
  }
}

/** Native-only: already-local file URI ko seedha FileOpener do (blob/base64 conversion bilkul nahi). */
export async function openLocalFileUriInExternalViewer(
  fileUri: string,
  contentType: string,
  fallbackTitle?: string
): Promise<void> {
  const uri = String(fileUri || "").trim();
  if (!uri) return;
  if (!isCapacitorNative()) {
    window.open(uri, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { FileOpener } = await import("@capacitor-community/file-opener");
    await FileOpener.open({
      filePath: uri,
      contentType: contentType || "application/octet-stream",
      openWithDefault: true,
    });
  } catch (e) {
    console.warn("[openPdfExternal] direct local-uri open failed", e);
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: fallbackTitle || "Open file",
        url: uri,
        dialogTitle: "Open file",
      });
    } catch {
      /* ignore */
    }
  }
}
