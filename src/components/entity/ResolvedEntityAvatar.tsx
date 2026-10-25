"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  getBlobFromLocalFileRef,
  getLocalFileRefMeta,
  getLocalFileRefMetaSync,
  isLocalFileRef,
} from "@/lib/localPendingFiles";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import {
  fetchPlServerAttachmentBlob,
  canFetchPlServerAttachmentForCompany,
  resolvePlServerStaffAttachmentPreviewBlob,
} from "@/lib/plServerAttachmentFetch";
import { getRemoteAttachmentBlobPreferOfflineCache } from "@/lib/offlineAttachmentUrlCache";
import { sniffBlobKindForPreview } from "@/lib/attachmentFormatLabel";
import { useCompany } from "@/hooks/useCompany";
import { readActiveAttachmentCompanyId } from "@/lib/firestorePermissionSuppress";
import {
  forgetHoverBlobUrl,
  peekHoverCachedBlobUrl,
  rememberHoverBlobUrl,
} from "@/lib/attachmentHoverBlobCache";
import { normalizeAttachmentUrlForDevicePreview } from "@/lib/attachmentHoldClipboard";
import { subscribeAttachmentLoadStore } from "@/lib/attachmentLoadReady";

type Props = {
  src?: string | null;
  alt?: string;
  fallbackText?: string;
  /** Bank/Cash jaisa: Crown/Landmark icon — text initials ke bajay */
  fallbackSlot?: React.ReactNode;
  className?: string;
  /** Initials fallback — e.g. Inter Company sky pill */
  fallbackClassName?: string;
  /** Drive `opening/avatars` — shared folder download ke liye */
  companyId?: string;
};

async function imageObjectUrlFromBlob(blob: Blob): Promise<string | null> {
  if (!blob?.size) return null;
  const kind = await sniffBlobKindForPreview(blob);
  if (kind !== "image") return null;
  const mime = String(blob.type || "").toLowerCase();
  const typed =
    mime.startsWith("image/") && mime !== "application/octet-stream"
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: mime.startsWith("image/") ? mime : "image/jpeg" });
  return URL.createObjectURL(typed);
}

/** Revoked / dead blob: URL.createObjectURL pehle se cache me — list flicker ka source. */
async function isUsableAvatarDisplayUrl(displayUrl: string): Promise<boolean> {
  const u = String(displayUrl || "").trim();
  if (!u) return false;
  if (u.startsWith("data:")) return true;
  if (!u.startsWith("blob:")) {
    return /^https?:\/\//i.test(u) || u.startsWith("capacitor:") || u.startsWith("file:");
  }
  try {
    const blob = await fetch(u).then((r) => r.blob());
    return Boolean(blob && blob.size > 0);
  } catch {
    return false;
  }
}

/** EXE/APK disk path — MIME khali/octet-stream par bhi avatar image ho sakta hai. */
function nativeMetaImageDisplayUrl(
  meta: { displayUrl?: string; contentType?: string; fileName?: string } | null | undefined
): string | null {
  if (!meta?.displayUrl) return null;
  const ct = String(meta.contentType || "").toLowerCase();
  if (ct.includes("pdf")) return null;
  if (ct.startsWith("image/")) return meta.displayUrl;
  const name = String(meta.fileName || "").toLowerCase();
  if (/\.(jpe?g|jfif|png|gif|webp|bmp|svg|heic|heif)(\?|$)/i.test(name)) return meta.displayUrl;
  if (!ct || ct === "application/octet-stream") return meta.displayUrl;
  return null;
}

/**
 * Master/detail avatar: `local:` + Firebase HTTPS + raw Storage path — pehle IndexedDB warm cache, phir online fetch;
 * image nahi (PDF) ya miss par fallback.
 *
 * Shared hover LRU owns blob: lifetime — unmount pe revoke mat (list ↔ detail flicker).
 */
export function ResolvedEntityAvatar({
  src,
  alt = "",
  fallbackText = "?",
  fallbackSlot,
  className,
  fallbackClassName,
  companyId: companyIdProp,
}: Props) {
  const { companyId: shellCompanyId } = useCompany();
  const attachmentCompanyId =
    companyIdProp ?? shellCompanyId ?? readActiveAttachmentCompanyId() ?? undefined;

  const [localBlobUrl, setLocalBlobUrl] = React.useState<string | null>(null);
  /** Sirf tab jab cache me remember nahi hua — warna unmount revoke = list flicker. */
  const ownedObjectUrlRef = React.useRef<string | null>(null);
  const [remoteImgSrc, setRemoteImgSrc] = React.useState<string | undefined>(undefined);
  const remoteBlobRevokeRef = React.useRef<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);

  const revokeOwnedObjectUrl = React.useCallback(() => {
    if (ownedObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(ownedObjectUrlRef.current);
      } catch {
        /* ignore */
      }
      ownedObjectUrlRef.current = null;
    }
  }, []);

  /** Cache me daalne ke baad ownership mat rakho — LRU / forgetHoverBlobUrl manage kare. */
  const publishSharedAvatarUrl = React.useCallback(
    (rawKey: string, normalizedKey: string, objectUrl: string) => {
      rememberHoverBlobUrl(rawKey, objectUrl);
      if (normalizedKey !== rawKey) rememberHoverBlobUrl(normalizedKey, objectUrl);
      ownedObjectUrlRef.current = null;
      if (remoteBlobRevokeRef.current === objectUrl) {
        remoteBlobRevokeRef.current = null;
      }
    },
    []
  );

  React.useEffect(() => {
    let cancelled = false;
    if (!src?.trim() || !isLocalFileRef(src)) {
      revokeOwnedObjectUrl();
      setLocalBlobUrl(null);
      return;
    }

    const trimmed = src.trim();
    const normalized = normalizeAttachmentUrlForDevicePreview(trimmed);

    void (async () => {
      const warmed = peekHoverCachedBlobUrl(normalized) ?? peekHoverCachedBlobUrl(trimmed);
      if (warmed) {
        if (await isUsableAvatarDisplayUrl(warmed)) {
          if (cancelled) return;
          revokeOwnedObjectUrl();
          setLocalBlobUrl(warmed);
          return;
        }
        forgetHoverBlobUrl(normalized, warmed);
        forgetHoverBlobUrl(trimmed, warmed);
      }

      if (usesEmbeddedNativeAttachmentStorage() || isCapacitorNativeApp()) {
        const meta = getLocalFileRefMetaSync(src) ?? (await getLocalFileRefMeta(src));
        if (cancelled) return;
        const nativeUrl = nativeMetaImageDisplayUrl(meta);
        if (nativeUrl && (await isUsableAvatarDisplayUrl(nativeUrl))) {
          revokeOwnedObjectUrl();
          publishSharedAvatarUrl(trimmed, normalized, nativeUrl);
          setLocalBlobUrl(nativeUrl);
          return;
        }
      }

      let blob =
        (await getBlobFromLocalFileRef(src, {
          allowNativeRead: true,
          context: "ResolvedEntityAvatar",
          companyId: attachmentCompanyId,
        })) ?? null;

      if ((!blob || blob.size <= 0) && attachmentCompanyId) {
        try {
          if (canFetchPlServerAttachmentForCompany(attachmentCompanyId)) {
            blob =
              (await resolvePlServerStaffAttachmentPreviewBlob(src, {
                companyId: attachmentCompanyId,
              })) ??
              (await fetchPlServerAttachmentBlob(attachmentCompanyId, src)) ??
              null;
          }
        } catch {
          blob = null;
        }
      }

      if (cancelled) return;
      revokeOwnedObjectUrl();

      if (!blob?.size) {
        setLocalBlobUrl(null);
        return;
      }

      const objectUrl = await imageObjectUrlFromBlob(blob);
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (!objectUrl) {
        setLocalBlobUrl(null);
        return;
      }
      publishSharedAvatarUrl(trimmed, normalized, objectUrl);
      setLocalBlobUrl(objectUrl);
    })();

    return () => {
      cancelled = true;
      // Shared cache URL mat revoke — dusri list/detail row abhi use kar rahi ho sakti hai.
      revokeOwnedObjectUrl();
    };
  }, [src, attachmentCompanyId, revokeOwnedObjectUrl, publishSharedAvatarUrl, retryKey]);

  /** Idle prewarm / file column warm ke baad LRU se turant avatar paint. */
  React.useEffect(() => {
    if (!src?.trim()) return;
    const trimmed = src.trim();
    const normalized = normalizeAttachmentUrlForDevicePreview(trimmed);
    const applyWarmed = () => {
      const warmed = peekHoverCachedBlobUrl(normalized) ?? peekHoverCachedBlobUrl(trimmed);
      if (!warmed) return;
      void (async () => {
        if (!(await isUsableAvatarDisplayUrl(warmed))) {
          forgetHoverBlobUrl(normalized, warmed);
          forgetHoverBlobUrl(trimmed, warmed);
          setRetryKey((n) => n + 1);
          return;
        }
        if (isLocalFileRef(trimmed)) {
          revokeOwnedObjectUrl();
          setLocalBlobUrl(warmed);
        } else {
          setRemoteImgSrc((prev) => prev ?? warmed);
        }
      })();
    };
    applyWarmed();
    return subscribeAttachmentLoadStore(applyWarmed);
  }, [src, revokeOwnedObjectUrl]);

  React.useEffect(() => {
    let cancelled = false;
    const revokeRemoteOwned = () => {
      if (remoteBlobRevokeRef.current) {
        try {
          URL.revokeObjectURL(remoteBlobRevokeRef.current);
        } catch {
          /* ignore */
        }
        remoteBlobRevokeRef.current = null;
      }
    };

    if (!src?.trim() || isLocalFileRef(src)) {
      revokeRemoteOwned();
      setRemoteImgSrc(undefined);
      return;
    }

    revokeRemoteOwned();
    setRemoteImgSrc(undefined);
    const trimmed = src.trim();
    const normalized = normalizeAttachmentUrlForDevicePreview(trimmed);

    void (async () => {
      const warmed = peekHoverCachedBlobUrl(normalized) ?? peekHoverCachedBlobUrl(trimmed);
      if (warmed) {
        if (await isUsableAvatarDisplayUrl(warmed)) {
          if (!cancelled) setRemoteImgSrc(warmed);
          return;
        }
        forgetHoverBlobUrl(normalized, warmed);
        forgetHoverBlobUrl(trimmed, warmed);
      }

      try {
        const blob = await getRemoteAttachmentBlobPreferOfflineCache(trimmed, undefined, {
          companyId: attachmentCompanyId,
        });
        if (cancelled) return;
        if (blob && blob.size > 0) {
          const kind = await sniffBlobKindForPreview(blob);
          if (cancelled) return;
          if (kind === "image") {
            const ou = await imageObjectUrlFromBlob(blob);
            if (cancelled) {
              if (ou) URL.revokeObjectURL(ou);
              return;
            }
            if (ou) {
              publishSharedAvatarUrl(trimmed, normalized, ou);
              setRemoteImgSrc(ou);
            }
            return;
          }
        }
        if (
          !cancelled &&
          /^https?:\/\//i.test(trimmed) &&
          typeof navigator !== "undefined" &&
          navigator.onLine
        ) {
          setRemoteImgSrc(trimmed);
        }
      } catch {
        if (!cancelled) setRemoteImgSrc(undefined);
      }
    })();

    return () => {
      cancelled = true;
      // Shared cache URL mat revoke.
      revokeRemoteOwned();
    };
  }, [src, attachmentCompanyId, publishSharedAvatarUrl, retryKey]);

  const imageSrc = !src?.trim()
    ? undefined
    : isLocalFileRef(src)
      ? localBlobUrl ?? undefined
      : remoteImgSrc;

  const handleImageError = React.useCallback(() => {
    const trimmed = String(src || "").trim();
    if (!trimmed || !imageSrc) return;
    const normalized = normalizeAttachmentUrlForDevicePreview(trimmed);
    forgetHoverBlobUrl(normalized, imageSrc);
    forgetHoverBlobUrl(trimmed, imageSrc);
    if (isLocalFileRef(trimmed)) setLocalBlobUrl(null);
    else setRemoteImgSrc(undefined);
    setRetryKey((n) => (n >= 3 ? n : n + 1));
  }, [src, imageSrc]);

  return (
    <Avatar className={cn("rounded-none overflow-hidden", className)}>
      {imageSrc ? (
        <AvatarImage key={`${imageSrc}:${retryKey}`} src={imageSrc} alt={alt} onError={handleImageError} className="rounded-none" />
      ) : (
        <AvatarImage src={undefined} alt={alt} className="rounded-none" />
      )}
      <AvatarFallback className={cn(fallbackClassName, "rounded-none")}>{fallbackSlot ?? fallbackText}</AvatarFallback>
    </Avatar>
  );
}
