"use client";

import { useEffect, useState } from "react";
import {
  BROWSER_DB_COLLECTION_BUMP,
  type BrowserDbCollectionBumpDetail,
} from "@/lib/localCompanyDocMirror";
import { fetchCompanyFileCount, isGalleryServerApiUnavailable } from "@/modules/ocr/plGalleryServerApi";

/**
 * Company Doc badge count: prefer the server hook (all alive voucher files, all FYs).
 * Falls back to the local count when the route is not deployed or the request fails.
 * Refreshes on voucher store changes and when the window is focused, not on every render.
 */
export function useCompanyFileCount(companyId: string, localFallback: number): number {
  const cid = String(companyId || "").trim();
  const [serverCount, setServerCount] = useState<number | null>(null);
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
      if (detail?.collection && detail.collection !== "vouchers") return;
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
      setServerCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const count = await fetchCompanyFileCount(cid);
        if (!cancelled) setServerCount(count);
      } catch (error) {
        if (cancelled) return;
        if (!isGalleryServerApiUnavailable(error)) {
          console.warn("[Gallery Company Doc] server file count failed", error);
        }
        setServerCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, bump]);

  return serverCount != null ? serverCount : localFallback;
}
