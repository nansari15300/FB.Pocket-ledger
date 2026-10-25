/**
 * Short file-type label for thumbnails and tooltips (PDF, JPG, JPEG, PNG, …).
 * Works with Firebase URLs, data URLs, and File (name + MIME).
 */

const MIME_TO_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/jpg": "JPG",
  "image/jfif": "JPEG",
  "image/pjpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/gif": "GIF",
  "image/bmp": "BMP",
  "image/svg+xml": "SVG",
};

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jpg: "image/jpeg",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function extensionFromPath(path: string): string {
  const base = path.split("?")[0].split("/").pop() || "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function normalizeExt(ext: string): string {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (!e) return "FILE";
  const map: Record<string, string> = {
    jpeg: "JPEG",
    jpe: "JPEG",
    jpg: "JPG",
    jfif: "JPEG",
    pjpeg: "JPEG",
    pdf: "PDF",
    png: "PNG",
    gif: "GIF",
    webp: "WEBP",
    bmp: "BMP",
    svg: "SVG",
    heic: "HEIC",
    heif: "HEIF",
    avif: "AVIF",
    tif: "TIFF",
    tiff: "TIFF",
    doc: "DOC",
    docx: "DOCX",
    xls: "XLS",
    xlsx: "XLSX",
  };
  return map[e] ?? e.toUpperCase();
}

export function inferAttachmentContentTypeFromName(
  fileName?: string | null,
  contentType?: string | null
): string {
  const ct = String(contentType || "").trim().toLowerCase();
  if (ct && ct !== "application/octet-stream" && ct !== "binary/octet-stream") return ct;
  const ext = extensionFromPath(String(fileName || ""));
  return EXT_TO_MIME[ext] || ct || "application/octet-stream";
}

export function getAttachmentPreviewKindFromHints(
  fileName?: string | null,
  contentType?: string | null
): "image" | "pdf" | "other" | null {
  const normalized = inferAttachmentContentTypeFromName(fileName, contentType);
  if (normalized === "application/pdf" || normalized.includes("pdf")) return "pdf";
  if (normalized.startsWith("image/")) return "image";
  const label = getAttachmentFormatLabelFromHints(fileName, normalized);
  if (label === "PDF") return "pdf";
  if (label && ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF", "AVIF", "TIFF"].includes(label)) {
    return "image";
  }
  return label ? "other" : null;
}

export function getAttachmentFormatLabel(source: string | File): string {
  if (typeof source !== "string") {
    if (source.type) {
      const label = MIME_TO_LABEL[source.type];
      if (label) return label;
      if (source.type.startsWith("image/")) {
        const sub = source.type.split("/")[1]?.toUpperCase();
        return sub && sub.length <= 8 ? sub : "IMAGE";
      }
    }
    const ext = extensionFromPath(source.name);
    if (ext) return normalizeExt(ext);
    return "FILE";
  }
  const s = source;
  if (s.startsWith("data:")) {
    const rest = s.slice(5);
    const semi = rest.indexOf(";");
    const comma = rest.indexOf(",");
    const end = semi > 0 && (comma < 0 || semi < comma) ? semi : comma > 0 ? comma : rest.length;
    const mime = rest.slice(0, end).trim().toLowerCase();
    if (MIME_TO_LABEL[mime]) return MIME_TO_LABEL[mime];
    if (mime.startsWith("image/")) return mime.split("/")[1]?.toUpperCase() || "IMAGE";
    if (mime === "application/pdf") return "PDF";
    return "FILE";
  }
  let ext = extensionFromPath(s);
  /* Firebase / CDN: last segment `foo%2Fdoc.pdf` — bina decode ke extension miss ho jata tha */
  if (!ext) {
    try {
      const seg = s.split("?")[0].split("/").pop() || "";
      const decoded = decodeURIComponent(seg);
      ext = extensionFromPath(decoded);
    } catch {
      /* ignore */
    }
  }
  if (ext) return normalizeExt(ext);
  const lower = s.split("?")[0].toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  return "FILE";
}

/**
 * `local:…` par URL label "FILE" rehta hai — asli type pending row / voucher `name` + MIME se (JPEG, PDF, …).
 */
export function getAttachmentFormatLabelFromHints(
  fileName?: string | null,
  contentType?: string | null
): string | null {
  const ct = String(contentType || "").trim().toLowerCase();
  if (ct) {
    if (MIME_TO_LABEL[ct]) return MIME_TO_LABEL[ct];
    if (ct.startsWith("image/")) {
      const sub = (ct.split("/")[1] || "").toLowerCase();
      if (sub === "jpeg" || sub === "jpg" || sub === "jfif" || sub === "pjpeg") return "JPEG";
      return sub.length > 0 && sub.length <= 8 ? sub.toUpperCase() : "IMAGE";
    }
    if (ct === "application/pdf" || ct.includes("pdf")) return "PDF";
  }
  const fn = String(fileName || "").trim();
  if (fn) {
    const ext = extensionFromPath(fn);
    if (ext) return normalizeExt(ext);
  }
  return null;
}

/**
 * Jab `Blob.type` khali ya `octet-stream` ho (IndexedDB local save) — pehle bytes se PDF / chitra sniff.
 * `blob:` object URLs par `getAttachmentFormatLabel` "FILE" deta hai; preview PDF branch tak pohchna zaroori hai.
 */
/** `blob:` URL that is NOT an image (e.g. raw PDF seeded under a thumb key) - never use as <img> thumb. */
export async function isNonImageBlobObjectUrl(url: string | null | undefined): Promise<boolean> {
  const u = String(url || "").trim();
  if (!/^blob:/i.test(u)) return false;
  try {
    const b = await fetch(u).then((r) => (r.ok ? r.blob() : null));
    if (!b?.size) return false;
    if (String(b.type || "").toLowerCase().startsWith("image/")) return false;
    return (await sniffBlobKindForPreview(b)) !== "image";
  } catch {
    return false;
  }
}

export async function sniffBlobKindForPreview(blob: Blob): Promise<"pdf" | "image" | "other"> {
  const mime = String(blob.type || "").toLowerCase();
  if (mime === "application/pdf" || mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime && mime !== "application/octet-stream") return "other";
  if (blob.size < 5) return "other";
  try {
    const buf = await blob.slice(0, Math.min(blob.size, 512)).arrayBuffer();
    const head = new TextDecoder("latin1", { fatal: false }).decode(buf);
    if (head.startsWith("%PDF")) return "pdf";
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xff && u8[1] === 0xd8) return "image";
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return "image";
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return "image";
    if (u8[0] === 0x42 && u8[1] === 0x4d) return "image";
    if (
      u8[0] === 0x52 &&
      u8[1] === 0x49 &&
      u8[2] === 0x46 &&
      u8[3] === 0x46 &&
      u8[8] === 0x57 &&
      u8[9] === 0x45 &&
      u8[10] === 0x42 &&
      u8[11] === 0x50
    ) {
      return "image";
    }
    if (
      (u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2a && u8[3] === 0x00) ||
      (u8[0] === 0x4d && u8[1] === 0x4d && u8[2] === 0x00 && u8[3] === 0x2a)
    ) {
      return "image";
    }
    if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
      const brand = head.slice(8, 12).toLowerCase();
      if (["heic", "heix", "hevc", "hevx", "heif", "mif1", "msf1", "avif", "avis"].includes(brand)) {
        return "image";
      }
    }
    const textHead = head.trimStart().slice(0, 256).toLowerCase();
    if (textHead.startsWith("<svg") || (textHead.startsWith("<?xml") && textHead.includes("<svg"))) {
      return "image";
    }
  } catch {
    /* slice/fetch fail — "other" */
  }
  return "other";
}
