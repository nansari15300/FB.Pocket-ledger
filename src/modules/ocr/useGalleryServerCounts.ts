"use client";

import { useEffect, useState } from "react";
import {
  BROWSER_DB_COLLECTION_BUMP,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import { fetchGalleryServerCounts, isGalleryServerApiUnavailable } from "@/modules/ocr/plGalleryServerApi";
import type { GalleryBadgeCounts } from "@/modules/ocr/galleryDocVisibility";

const COUNT_COLLECTIONS = new Set(["vouchers", "unassigned_documents", "duplicate_documents"]);

/**
 * All four Gallery badges: prefer the server hook. Falls back to local counts
 * when the route is missing or the request fails. Refreshes on relevant local
 * mirror bumps and window focus, not on every render.
 */
export function useGalleryServerCounts(companyId: string, localFallback: GalleryBadgeCounts): GalleryBadgeCounts {
  const cid = String(companyId || "").trim();
  const [serverCounts, setServerCounts] = useState<GalleryBadgeCounts | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setBump((n) => n + 1), 400);
    };
    const onBump = (event: Event) => {
      const detail = (event as CustomEvent<BrowserDbCollectionBumpDetail>).detail;
      if (detail?.collection && !COUNT_COLLECTIONS.has(detail.collection)) return;
      if (detail?.companyId && cid && detail.companyId !== cid) return;
      schedule();
    };
    const onFocus = () => schedule();
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [cid]);

  useEffect(() => {
    if (!cid) {
      setServerCounts(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const counts = await fetchGalleryServerCounts(cid);
        if (!cancelled) setServerCounts(counts);
      } catch (error) {
        if (cancelled) return;
        if (!isGalleryServerApiUnavailable(error)) {
          console.warn("[Gallery] server badge counts failed", error);
        }
        setServerCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, bump]);

  return serverCounts != null ? serverCounts : localFallback;
}