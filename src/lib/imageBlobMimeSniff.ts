"use client";

/**
 * Bytes → paintable image MIME.
 *
 * A file downloaded from the Pocket Ledger Server (`/api/files/...`) arrives as whatever type the
 * uploader declared — very often `application/octet-stream`, or no type at all. A `blob:` URL
 * wrapped in a non-image MIME does not decode in `<img>`, and inside the Capacitor WebView it paints
 * nothing at all: the tile (and the full-screen preview) showed a black box even though the file
 * opened fine and the bytes were present.
 *
 * Sniff the real format from the leading bytes and re-wrap the blob with a usable type.
 */
export function sniffImageOrPdfMime(head: Uint8Array): string | null {
  if (head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    return "application/pdf"; // %PDF
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return "image/png";
  }
  // RIFF....WEBP
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    return "image/gif"; // GIF8
  }
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) {
    return "image/bmp"; // BM
  }
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return "image/heic"; // ....ftyp
  }
  return null;
}

/**
 * Returns `blob` re-typed when it carries no usable image/PDF MIME, otherwise the original.
 * Unknown bytes are returned untouched so callers keep their own fallback.
 */
export async function withUsableImageMime(blob: Blob): Promise<Blob> {
  const declared = String(blob.type || "").toLowerCase();
  const declaredUsable =
    declared.startsWith("image/") || declared === "application/pdf";
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const sniffed = sniffImageOrPdfMime(head);
  if (declaredUsable) {
    // A declared image type can still be wrong (e.g. HEIC labelled image/jpeg on WebView);
    // trust the bytes when they clearly say otherwise.
    if (!sniffed || sniffed === declared || sniffed === "image/heic") return blob;
    return new Blob([blob], { type: sniffed });
  }
  if (!sniffed) return blob;
  return new Blob([blob], { type: sniffed });
}
