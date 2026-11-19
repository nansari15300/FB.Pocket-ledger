"use client";

import { useEffect, useState } from "react";
import { Timestamp } from "@/lib/pbCompat/firestore";
import {
  flushGalleryOfflinePendingUploads,
  GALLERY_OFFLINE_PENDING_CHANGED_EVENT,
  listGalleryOfflinePending,
  type GalleryOfflinePendingRecord,
} from "@/modules/ocr/galleryOfflinePendingStore";

export type GalleryOfflinePendingListItem = GalleryOfflinePendingRecord & {
  url: string;
  path: string;
  uploadedAt: Timestamp;
};

function toListItem(row: GalleryOfflinePendingRecord): GalleryOfflinePendingListItem {
  return {
    ...row,
    url: row.localRef,
    path: "",
    uploadedAt: Timestamp.fromMillis(row.uploadedAtMs || Date.now()),
  };
}

export function useGalleryOfflinePending(companyId: string): GalleryOfflinePendingListItem[] {
  const cid = String(companyId || "").trim();
  const [rows, setRows] = useState<GalleryOfflinePendingListItem[]>(() =>
    cid ? listGalleryOfflinePending(cid).map(toListItem) : []
  );

  useEffect(() => {
    if (!cid || typeof window === "undefined") {
      setRows([]);
      return;
    }
    const refresh = () => setRows(listGalleryOfflinePending(cid).map(toListItem));
    refresh();
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (detail?.companyId && detail.companyId !== cid) return;
      refresh();
    };
    window.addEventListener(GALLERY_OFFLINE_PENDING_CHANGED_EVENT, onChange);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(GALLERY_OFFLINE_PENDING_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", refresh);
    };
  }, [cid]);

  useEffect(() => {
    if (!cid || typeof window === "undefined") return;
    const run = () => {
      void flushGalleryOfflinePendingUploads({ companyId: cid }).catch(() => undefined);
    };
    const onOnline = () => run();
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(run, 30_000);
    if (typeof navigator === "undefined" || navigator.onLine !== false) run();
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [cid]);

  return rows;
}