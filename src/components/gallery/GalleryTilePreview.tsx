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
 *   4. PDFs render their first page (pdfjs canvas → JPEG object URL); other document types
 *      fall back to the format badge + icon
 */

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAttachmentFormatLabel } from "@/lib/attachmentFormatLabel";
import { isLocalFileRef, getBlobFromLocalFileRef } from "@/lib/localPendingFiles";
import { isPbAttachmentRef, resolvePbAttachmentDisplay } from "@/lib/pocketbaseData/pbAttachments";
import { fetchAttachmentRefBlob } from "@/lib/attachmentRefBlobFetch";
import { convertPdfFirstPageToImage } from "@/lib/pdfToImage";
import { withUsableImageMime } from "@/lib/imageBlobMimeSniff";

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
  const [pdfRendered, setPdfRendered] = useState(false);
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

  /**
   * Paint a resolved blob in the tile. PDFs get their first page rasterised instead of the
   * generic document icon; when pdf.js cannot render (corrupt/encrypted/too large) the tile
   * falls back to the badge + icon.
   *
   * The blob MIME is often useless on the APK: a server file response carries whatever the
   * uploader declared (`application/octet-stream`, or a generic `binary/octet-stream`), and an
   * `<img>` pointed at a `blob:` URL with a non-image type paints nothing — the tile then shows
   * only its background (was black). So sniff the real type from the leading bytes and re-wrap
   * the blob with a usable image MIME before creating the object URL.
   */
  const paintBlob = async (rawBlob: Blob, declaredType: string) => {
    const blob = await withUsableImageMime(rawBlob);
    const sniffed = blob.type || null;
    const isPdf = sniffed === "application/pdf" || declaredType === "application/pdf";
    if (isPdf) {
      try {
        const pdfBlob = new Blob([blob], { type: "application/pdf" });
        const { thumbnailUrl } = await convertPdfFirstPageToImage(pdfBlob, 0.85, size * 2);
        if (cancelledRef.current) {
          URL.revokeObjectURL(thumbnailUrl);
          return;
        }
        objectUrlRef.current = thumbnailUrl;
        setResolvedBlobType("application/pdf");
        setPdfRendered(true);
        setSrc(thumbnailUrl);
        return;
      } catch {
        if (!cancelledRef.current) setFailed(true);
        return;
      }
    }
    // A usable image type now, otherwise assume JPEG so the browser at least attempts a decode.
    const paintType = sniffed && sniffed.startsWith("image/") ? sniffed : "image/jpeg";
    const paintBlobTyped = blob.type === paintType ? blob : new Blob([blob], { type: paintType });
    const objectUrl = URL.createObjectURL(paintBlobTyped);
    objectUrlRef.current = objectUrl;
    setResolvedBlobType(paintType);
    setSrc(objectUrl);
  };

  useEffect(() => {
    cancelledRef.current = false;
    setFailed(false);
    setResolvedBlobType(null);
    setPdfRendered(false);

    // Revoke the previous URL only when this effect re-runs (ref actually changed).
    const previous = objectUrlRef.current;
    if (previous) {
      URL.revokeObjectURL(previous);
      objectUrlRef.current = null;
    }
    setSrc(null);

    if (!cleanUrl) return;

    // Inline refs paint directly; https URLs go through the bytes resolver below (a Firebase signed
    // URL loads in a desktop tab but fails inside the Capacitor WebView).
    const direct = cleanUrl.startsWith("blob:") || cleanUrl.startsWith("data:");
    if (direct) {
      setSrc(cleanUrl);
      return;
    }

    // `pbatt:<recordId>/<fileName>` (a file uploaded from another device) and plain https/Firebase
    // URLs are NOT directly paintable in the Capacitor WebView: `pbatt:` is not a URL scheme at all,
    // and a Firebase signed URL fails offline / under sandboxed storage. Download the bytes through
    // the local-first resolver and paint the object URL instead (this is why a PC upload showed a
    // black tile on APK while the PC itself was fine).
    if (isPbAttachmentRef(cleanUrl) || /^https?:\/\//i.test(cleanUrl)) {
      void (async () => {
        try {
          const blob = isPbAttachmentRef(cleanUrl)
            ? (await resolvePbAttachmentDisplay(cleanUrl)).blob
            : await fetchAttachmentRefBlob(cleanUrl);
          if (cancelledRef.current) return;
          if (!blob || blob.size <= 0) {
            setFailed(true);
            return;
          }
          await paintBlob(blob, blob.type || "");
        } catch {
          if (!cancelledRef.current) setFailed(true);
        }
      })();

      return () => {
        cancelledRef.current = true;
      };
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
        await paintBlob(blob, blob.type || "");
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

  // A PDF whose first page was rasterised is painted like an image; the badge keeps saying PDF.
  const isImage = !failed && !!src && (!looksLikePdf || pdfRendered);
  const sizeBadge = fileSize && fileSize > 0 ? `${formatLabel} · ${formatBytes(fileSize)}` : formatLabel;

  return (
    <div
      className={cn(
        // Light tile: while the bytes resolve (and for documents that have no thumbnail) the box
        // must not look like a failed "black" preview. The dark card look was for the page shell,
        // not for the file itself.
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-200/80 dark:bg-zinc-700/60",
        className
      )}
      style={{ width: size, height: size }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob:/data: rely on the browser; Next/Image breaks blob URLs
        <img
          src={src}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover object-top"
          onError={() => setFailed(true)}
        />
      ) : (
        <FileText
          className={cn("h-6 w-6", failed ? "text-muted-foreground" : "text-muted-foreground/50")}
          aria-hidden
        />
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
