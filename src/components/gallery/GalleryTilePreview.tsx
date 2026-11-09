"use client";

/**
 * Gallery tile preview — Unassigned Documents grid.
 *
 * Why not `FilePreview` here: that component resolves `local:` refs through IndexedDB /
 * offline caches and creates + revokes several blob URLs during its lifecycle. Inside the
 * Capacitor WebView (served from `https://localhost`) the revoke races the WebView paint,
 * so a freshly captured photo showed a blank tile on APK while working fine on desktop.
 *
 * This component keeps it deliberately simple and paint-stable:
 *   1. resolve the ref to a blob object URL **once**
 *   2. keep that URL alive for the whole mounted lifetime (revoke only on unmount/ref change)
 *   3. plain <img> with no animation, no hover re-render dependency
 *   4. PDFs / unknown types fall back to the format badge + icon
 */

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAttachmentFormatLabel } from "@/lib/attachmentFormatLabel";
import { isLocalFileRef, getBlobFromLocalFileRef } from "@/lib/localPendingFiles";

type Props = {
  /** Attachment URL: `local:uuid`, https URL, blob:, or data: */
  url: string;
  /** Storage path (unused for local refs, kept for signature parity with FilePreview) */
  storagePath?: string;
  /** Known file size in bytes, for the badge */
  fileSize?: number;
  size: number;
  className?: string;
};

export function GalleryTilePreview({ url, fileSize, size, className }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [resolvedBlobType, setResolvedBlobType] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const cleanUrl = String(url || "").trim();
  const urlLabel = getAttachmentFormatLabel(cleanUrl);
  // `local:uuid` and `blob:` URLs carry no extension → label is "FILE"; the real kind comes
  // from the blob MIME once it resolves.
  const looksLikePdf = resolvedBlobType
    ? resolvedBlobType === "application/pdf"
    : urlLabel === "PDF";
  const formatLabel =
    resolvedBlobType && resolvedBlobType.startsWith("image/")
      ? resolvedBlobType.split("/")[1]?.toUpperCase() === "JPEG"
        ? "JPG"
        : (resolvedBlobType.split("/")[1] || "IMG").slice(0, 4).toUpperCase()
      : urlLabel;

  useEffect(() => {
    cancelledRef.current = false;
    setFailed(false);
    setResolvedBlobType(null);

    // Revoke the previous URL only when this effect re-runs (ref actually changed).
    const previous = objectUrlRef.current;
    if (previous) {
      URL.revokeObjectURL(previous);
      objectUrlRef.current = null;
    }
    setSrc(null);

    if (!cleanUrl) return;

    const direct = cleanUrl.startsWith("blob:") || cleanUrl.startsWith("data:") || /^https?:\/\//i.test(cleanUrl);
    if (direct) {
      setSrc(cleanUrl);
      return;
    }

    if (!isLocalFileRef(cleanUrl)) {
      // Unknown ref shape — let <img> try it directly rather than showing nothing.
      setSrc(cleanUrl);
      return;
    }

    void (async () => {
      try {
        const blob = await getBlobFromLocalFileRef(cleanUrl);
        if (cancelledRef.current) return;
        if (!blob || blob.size <= 0) {
          setFailed(true);
          return;
        }
        // `local:` refs have no extension, so the URL never tells us "PDF". Trust the blob
        // MIME + magic bytes — otherwise every locally captured photo fell through to the
        // FILE icon even though it was a perfectly good JPEG.
        if (blob.type === "application/pdf") {
          setFailed(true);
          return;
        }
        if (!blob.type || blob.type.includes("octet-stream")) {
          const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
          const isPdfMagic = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
          if (isPdfMagic) {
            setFailed(true);
            return;
          }
        }
        if (cancelledRef.current) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setResolvedBlobType(blob.type || "image/jpeg");
        setSrc(objectUrl);
      } catch {
        if (!cancelledRef.current) setFailed(true);
      }
    })();

    return () => {
      cancelledRef.current = true;
      // NOTE: do NOT revoke here — StrictMode double-invokes effects in dev, and revoking
      // too early is exactly the APK blank-preview bug. Revoke happens on the next run.
    };
  }, [cleanUrl]);

  // Single cleanup when the component truly unmounts.
  useEffect(
    () => () => {
      const pending = objectUrlRef.current;
      if (pending) {
        URL.revokeObjectURL(pending);
        objectUrlRef.current = null;
      }
    },
    []
  );

  const isImage = !failed && !looksLikePdf && !!src;
  const sizeBadge = fileSize && fileSize > 0 ? `${formatLabel} · ${formatBytes(fileSize)}` : formatLabel;

  return (
    <div
      className={cn("relative flex h-full w-full items-center justify-center bg-muted/30", className)}
      style={{ width: size, height: size }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob:/data: rely on the browser; Next/Image breaks blob URLs
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
      )}
      <span className="absolute bottom-0 left-0 rounded-tr-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold leading-tight text-white">
        {sizeBadge}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
