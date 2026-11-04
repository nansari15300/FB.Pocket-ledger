"use client";

import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";

export const APP_UI_ZOOM_STORAGE_KEY = "pl_app_ui_zoom_v1";
export const APP_UI_ZOOM_CHANGED_EVENT = "pl-app-ui-zoom-changed";

/** Browser Ctrl +/- jaisa step — 10% */
export const APP_UI_ZOOM_STEP = 0.1;
export const APP_UI_ZOOM_MIN = 0.5;
export const APP_UI_ZOOM_MAX = 1.6;
export const APP_UI_ZOOM_DEFAULT = 1;

export function clampAppUiZoom(scale: number): number {
  if (!Number.isFinite(scale)) return APP_UI_ZOOM_DEFAULT;
  const rounded = Math.round(scale * 100) / 100;
  return Math.min(APP_UI_ZOOM_MAX, Math.max(APP_UI_ZOOM_MIN, rounded));
}

export function readStoredAppUiZoom(): number {
  if (typeof window === "undefined") return APP_UI_ZOOM_DEFAULT;
  try {
    const raw = localStorage.getItem(APP_UI_ZOOM_STORAGE_KEY);
    if (!raw) return APP_UI_ZOOM_DEFAULT;
    return clampAppUiZoom(parseFloat(raw));
  } catch {
    return APP_UI_ZOOM_DEFAULT;
  }
}

function isIosCapacitorShell(): boolean {
  if (typeof window === "undefined" || !isCapacitorNativeApp()) return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

function syncAndroidZoomViewportCompensation(scale: number): void {
  const root = document.documentElement;
  const body = document.body;
  if (!body) return;

  if (scale === 1) {
    root.removeAttribute("data-pl-app-ui-zoom-shell");
    root.style.removeProperty("--pl-screen-h");
    root.style.removeProperty("--pl-screen-w");
    return;
  }

  // Zoom only the dashboard shell. Dialog/popover portals mount under <body>,
  // so their size and viewport-centred position stay at the device default.
  root.dataset.plAppUiZoomShell = "android-zoom";
  root.style.setProperty("--pl-screen-h", `calc(100dvh / ${scale})`);
  root.style.setProperty("--pl-screen-w", `calc(100vw / ${scale})`);
}

/** All platforms (web / EXE / APK / iOS shell): poori UI zoom — Android `zoom`, iOS base `font-size` (rem scale). */
export function applyAppUiZoom(scale: number): number {
  const clamped = clampAppUiZoom(scale);
  if (typeof document === "undefined") return clamped;

  const root = document.documentElement;
  root.dataset.plAppUiZoom = String(clamped);
  root.style.setProperty("--pl-app-ui-zoom", String(clamped));

  if (isIosCapacitorShell()) {
    root.style.zoom = "";
    root.removeAttribute("data-pl-app-ui-zoom-shell");
    root.style.fontSize = `${16 * clamped}px`;
    syncAndroidZoomViewportCompensation(1);
  } else {
    // Android APK, web browser and desktop EXE (Electron/Tauri): zoom #app-container only.
    root.style.fontSize = "";
    root.style.zoom = "";
    syncAndroidZoomViewportCompensation(clamped);
  }

  try {
    localStorage.setItem(APP_UI_ZOOM_STORAGE_KEY, String(clamped));
  } catch {
    /* ignore */
  }

  window.dispatchEvent(
    new CustomEvent(APP_UI_ZOOM_CHANGED_EVENT, { detail: { scale: clamped } })
  );
  return clamped;
}

export function stepAppUiZoom(delta: number): number {
  const next = clampAppUiZoom(readStoredAppUiZoom() + delta);
  return applyAppUiZoom(next);
}

export function appUiZoomIn(): number {
  return stepAppUiZoom(APP_UI_ZOOM_STEP);
}

export function appUiZoomOut(): number {
  return stepAppUiZoom(-APP_UI_ZOOM_STEP);
}

export function bootstrapAppUiZoomFromStorage(): number {
  return applyAppUiZoom(readStoredAppUiZoom());
}

/** UI zoom is available on every platform (web, desktop EXE, APK / iOS shell). */
export function isAppUiZoomAvailable(): boolean {
  return typeof window !== "undefined";
}
