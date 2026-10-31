"use client";

import { normalizeAttachmentUrlForDevicePreview } from "@/lib/attachmentHoldClipboard";
import {
  getBlobFromLocalFileRef,
  isLocalFileRef,
} from "@/lib/localPendingFiles";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { looksLikeFirebaseStorageObjectPath } from "@/lib/firebaseStorageDownloadUrl";

/** IndexedDB/native offline cache key — `PL_ATTACH` ko decode karke stable `drive:`/`local:`/https ref. */
export function offlineCacheKeyForAttachmentRef(rawUrl: string): string {
  return normalizeAttachmentUrlForDevicePreview(rawUrl);
}

export function isOfflineCacheableAttachmentRef(raw: string): boolean {
  const u = offlineCacheKeyForAttachmentRef(raw);
  if (!u) return false;
  if (/^https?:\/\//i.test(u)) return true;
  if (looksLikeFirebaseStorageObjectPath(u)) return true;
  if (isLocalFileRef(u) || isDriveFileRef(u)) return true;
  // Pocket Ledger Server file (`pbatt:<recordId>/<name>`): kept on this device (IndexedDB / native disk).
  if (u.startsWith("pbatt:")) return true;
  return false;
}

export type FetchAttachmentRefBlobOptions = {
  galleryUrls?: readonly string[];
  signal?: AbortSignal;
  /** Cloud `drive:` resolve — Google Drive folder path. */
  companyId?: string;
  /** Local company gallery: HTTPS/Firebase object-path network mat. */
  localOnly?: boolean;
};

/** Preview/hover callers — gallery me parallel `local:` match ke liye. */
export type AttachmentPreviewBlobLoadOptions = {
  galleryUrls?: readonly string[];
  companyId?: string;
  /** Local company: cache/local bytes ke baad Firebase/network mat. */
  localLedgerOnly?: boolean;
};

/**
 * Attachment bytes resolve order (local-first, cloud last):
 * 1. `local:` — IndexedDB pending / Capacitor DataDirectory
 * 2. `drive:` — gallery me paired `local:`, pending list filename match
 * 3. Offline warm cache (IndexedDB / native) — pehle open/preload ki hui copy
 * 4. Cloud — Google Drive (`downloadCloudAttachmentBlob`)
 * 5. `https://` Firebase — offline cache, phir SDK/fetch
 */
export async function fetchAttachmentRefBlob(
  rawUrl: string,
  options?: FetchAttachmentRefBlobOptions
): Promise<Blob | null> {
  const u = offlineCacheKeyForAttachmentRef(rawUrl);
  if (!u) return null;

  if (isLocalFileRef(u)) {
    const blob = await getBlobFromLocalFileRef(u, {
      context: "fetchAttachmentRefBlob",
      companyId: options?.companyId,
    });
    if (blob && blob.size > 0) return blob;
    try {
      const { tryOfflineCachedAttachmentBlobMultiKey } = await import("@/lib/offlineAttachmentUrlCache");
      const cached = await tryOfflineCachedAttachmentBlobMultiKey(String(rawUrl).trim());
      if (cached && cached.size > 0) return cached;
    } catch {
      /* offline cache optional */
    }
    if (options?.galleryUrls?.length) {
      for (const g of options.galleryUrls) {
        const gt = String(g || "").trim();
        if (!isDriveFileRef(gt)) continue;
        const driveBlob = await getBlobFromLocalFileRef(gt, {
          context: "fetchAttachmentRefBlobLocalGalleryDrive",
          companyId: options?.companyId,
        });
        if (driveBlob && driveBlob.size > 0) return driveBlob;
      }
    }
    if (options?.companyId) {
      const { fetchPlServerAttachmentBlob } = await import("@/lib/plServerAttachmentFetch");
      const remote = await fetchPlServerAttachmentBlob(options.companyId, u, options?.signal);
      if (remote && remote.size > 0) return remote;
    }
  }

  if (isDriveFileRef(u)) {
    const gallery = options?.galleryUrls;
    if (gallery?.length) {
      const rawTrim = String(rawUrl).trim();
      const idx = gallery.findIndex((g) => {
        const gt = String(g || "").trim();
        return gt === rawTrim || offlineCacheKeyForAttachmentRef(g) === u;
      });
      if (idx >= 0) {
        const peer = offlineCacheKeyForAttachmentRef(String(gallery[idx] || ""));
        if (isLocalFileRef(peer)) {
          const localBlob = await getBlobFromLocalFileRef(peer, {
            context: "fetchAttachmentRefBlob",
            companyId: options?.companyId,
          });
          if (localBlob && localBlob.size > 0) return localBlob;
        }
      }
    }
    try {
      const { getOfflineCachedAttachmentBlob } = await import("@/lib/offlineAttachmentUrlCache");
      for (const key of [String(rawUrl).trim(), u]) {
        if (!key) continue;
        const cached = await getOfflineCachedAttachmentBlob(key);
        if (cached && cached.size > 0) return cached;
      }
    } catch {
      /* offline cache optional */
    }
    const driveBlob = await getBlobFromLocalFileRef(u, {
      context: "fetchAttachmentRefBlobDrive",
      companyId: options?.companyId,
    });
    if (driveBlob && driveBlob.size > 0) return driveBlob;

    const { getAttachmentBlobForBackupEmbed, tryOfflineCachedAttachmentBlobMultiKey } = await import(
      "@/lib/offlineAttachmentUrlCache"
    );
    const cached = await tryOfflineCachedAttachmentBlobMultiKey(String(rawUrl).trim());
    if (cached && cached.size > 0) return cached;
    const embedded = await getAttachmentBlobForBackupEmbed(String(rawUrl).trim(), {
      skipDiskWrite: true,
    });
    if (embedded && embedded.size > 0) return embedded;
  }

  if (
    !options?.localOnly &&
    (/^https?:\/\//i.test(u) || looksLikeFirebaseStorageObjectPath(u))
  ) {
    const { fetchHttpsAttachmentBlobForPrefetchMiss } = await import("@/lib/offlineAttachmentUrlCache");
    const httpsBlob = await fetchHttpsAttachmentBlobForPrefetchMiss(u, options?.signal);
    if (httpsBlob && httpsBlob.size > 0) return httpsBlob;
  }

  return null;
}
