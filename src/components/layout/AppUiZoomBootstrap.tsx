"use client";

import { useEffect } from "react";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import {
  bootstrapAppUiZoomFromStorage,
  isAppUiZoomAvailable,
  readStoredAppUiZoom,
  applyAppUiZoom,
} from "@/lib/appUiZoom";

/** Saved zoom restore on cold start (all platforms); Capacitor native: orientation/resize par viewport dubara sync. */
export function AppUiZoomBootstrap() {
  useEffect(() => {
    if (!isAppUiZoomAvailable()) return;
    bootstrapAppUiZoomFromStorage();
    // Web / EXE: zoom uses CSS vw/dvh calc, so no resize re-apply is needed.
    if (!isCapacitorNativeApp()) return;

    const reapply = () => {
      applyAppUiZoom(readStoredAppUiZoom());
    };
    window.addEventListener("orientationchange", reapply);
    window.visualViewport?.addEventListener("resize", reapply);
    return () => {
      window.removeEventListener("orientationchange", reapply);
      window.visualViewport?.removeEventListener("resize", reapply);
    };
  }, []);
  return null;
}
