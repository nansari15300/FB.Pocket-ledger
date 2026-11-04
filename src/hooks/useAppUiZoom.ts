"use client";

import { useCallback, useEffect, useState } from "react";
import {
  APP_UI_ZOOM_CHANGED_EVENT,
  APP_UI_ZOOM_MAX,
  APP_UI_ZOOM_MIN,
  appUiZoomIn,
  appUiZoomOut,
  applyAppUiZoom,
  readStoredAppUiZoom,
} from "@/lib/appUiZoom";

export function useAppUiZoom() {
  const [scale, setScale] = useState(() =>
    typeof window === "undefined" ? 1 : readStoredAppUiZoom()
  );

  useEffect(() => {
    setScale(readStoredAppUiZoom());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ scale?: number }>).detail;
      if (typeof detail?.scale === "number" && Number.isFinite(detail.scale)) {
        setScale(detail.scale);
      } else {
        setScale(readStoredAppUiZoom());
      }
    };
    window.addEventListener(APP_UI_ZOOM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(APP_UI_ZOOM_CHANGED_EVENT, onChange);
  }, []);

  const zoomIn = useCallback(() => {
    setScale(appUiZoomIn());
  }, []);

  const zoomOut = useCallback(() => {
    setScale(appUiZoomOut());
  }, []);

  /** Slider: apply + persist an exact scale (clamped) — same path as − / +. */
  const setZoom = useCallback((next: number) => {
    setScale(applyAppUiZoom(next));
  }, []);

  const canZoomIn = scale < APP_UI_ZOOM_MAX - 0.001;
  const canZoomOut = scale > APP_UI_ZOOM_MIN + 0.001;

  return { scale, zoomIn, zoomOut, setZoom, canZoomIn, canZoomOut };
}
