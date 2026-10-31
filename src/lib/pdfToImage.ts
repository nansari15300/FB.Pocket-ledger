/**
 * PDF first-page to image thumbnail (client-side).
 *
 * ## Approach: client-side
 * - No server round-trip; works offline after load. No CORS for same-origin or
 *   Firebase Storage (use getBlob with storage path when available).
 * - pdfjs-dist runs in a web worker; main thread stays responsive for multiple PDFs.
 * - No extra backend or file storage for thumbnails required.
 *
 * ## Library
 * - pdfjs-dist (Mozilla): industry standard, worker-based, no eval, good for
 *   security and large files. Use GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs".
 *
 * ## Security
 * - Only first page is rendered to canvas; no scripts executed.
 * - We validate PDF magic bytes (%PDF-) before parsing.
 * - Worker runs in a separate context; no direct DOM access.
 *
 * ## Performance
 * - Dynamic import so pdfjs is loaded only when a PDF is previewed.
 * - maxWidth/quality caps keep canvas size and memory bounded.
 * - For large files, we use a lower scale to avoid OOM; optional maxSizeBytes
 *   can skip thumbnail and show fallback.
 *
 * ## Cross-browser
 * - Works in Chrome, Firefox, Safari, Edge. Requires canvas and web worker support.
 * - Worker file must be served from same origin (e.g. public/pdf.worker.mjs).
 */

import { importPdfJsDist } from "@/lib/importPdfJsDist";
import { Capacitor } from "@capacitor/core";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import {
  attachmentFileExistsInDataDir,
  getAttachmentFileUriFromDataDir,
  writeAttachmentBlobToDataDir,
} from "@/lib/capacitorAttachmentFs";

export interface PdfThumbnailResult {
  thumbnailUrl: string;
  thumbnailBlob: Blob;
}

export interface ConvertPdfOptions {
  /** JPEG quality 0–1 (default 0.85). */
  quality?: number;
  /** Max thumbnail width in pixels (default 800). Lower = faster, less memory. */
  maxWidth?: number;
  /** If set and file size exceeds this (bytes), use reduced scale to stay safe. Default 50MB. */
  maxSizeBytes?: number;
  /** When aborted, the promise rejects and any loading is cancelled. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

/** Native thumbnail cache path: source key hash -> jpg file on DataDirectory. */
async function nativeThumbPathFromKey(key: string): Promise<string> {
  const k = String(key || "").trim() || "default";
  const enc = new TextEncoder().encode(k);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `attachments/pdf-thumbs/${hex}.jpg`;
}

function getSize(pdfFile: File | ArrayBuffer | Blob): number {
  if (pdfFile instanceof File) return pdfFile.size;
  if (pdfFile instanceof ArrayBuffer) return pdfFile.byteLength;
  if (pdfFile instanceof Blob) return pdfFile.size;
  return 0;
}

/** Header scan — File/Blob peek ya poora `Uint8Array` pe (buffer pool se `byteOffset` avoid) */
function pdfHeaderLooksValid(a: Uint8Array): boolean {
  let i = 0;
  const len = Math.min(a.length, 64);
  if (len < 4) return false;
  if (i + 3 <= len && a[i] === 0xef && a[i + 1] === 0xbb && a[i + 2] === 0xbf) i += 3;
  while (
    i < len &&
    (a[i] === 0x09 || a[i] === 0x0a || a[i] === 0x0d || a[i] === 0x20 || a[i] === 0x00)
  ) {
    i++;
  }
  if (i + PDF_MAGIC.length > len) return false;
  for (let j = 0; j < PDF_MAGIC.length; j++) if (a[i + j] !== PDF_MAGIC[j]) return false;
  return true;
}

/** Voucher stitched export / tests: bytes pe header check (duplicate read avoid) */
export function isPdfLikeUint8Header(bytes: Uint8Array): boolean {
  return pdfHeaderLooksValid(bytes);
}

/**
 * Converts the first page of a PDF to an image (JPEG).
 * Safe for large files (uses reduced scale when over maxSizeBytes).
 */
export async function convertPdfFirstPageToImage(
  pdfFile: File | ArrayBuffer | Blob,
  quality: number = 0.85,
  maxWidth: number = 800,
  options: ConvertPdfOptions = {}
): Promise<PdfThumbnailResult> {
  const { maxSizeBytes = DEFAULT_MAX_SIZE_BYTES, signal } = options;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const size = getSize(pdfFile);
  const useReducedScale = size > maxSizeBytes;
  const effectiveMaxWidth = useReducedScale ? Math.min(400, maxWidth) : maxWidth;
  const effectiveQuality = useReducedScale ? 0.75 : quality;

  const { pdfjsLib, pdfjs } = await importPdfJsDist();
  const { ensurePdfJsWorker, PDFJS_WORKER_VERSION_FALLBACK } = await import("@/lib/pdfjsWorkerSrc");
  const version =
    (pdfjsLib as { version?: string }).version ??
    pdfjs.version ??
    PDFJS_WORKER_VERSION_FALLBACK;
  await ensurePdfJsWorker(pdfjs, version);

  /** Copy buffer — WebKit/Electron kabhi same ArrayBuffer pdf.js ke baad detach kar deta hai */
  let pdfBytes: Uint8Array;
  if (pdfFile instanceof File) {
    pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
  } else if (pdfFile instanceof Blob) {
    pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
  } else {
    pdfBytes = new Uint8Array(pdfFile);
  }

  let pdfData: { data: Uint8Array };
  pdfData = { data: pdfBytes };

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const valid = pdfHeaderLooksValid(pdfBytes);
  if (!valid) throw new Error("Invalid PDF: missing or invalid header");

  const loadingTask = pdfjs.getDocument(pdfData);
  const abortHandler = () => loadingTask.destroy();
  signal?.addEventListener("abort", abortHandler, { once: true });

  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    pdf = await loadingTask.promise;
  } finally {
    signal?.removeEventListener("abort", abortHandler);
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  /**
   * Target raster width ≈ maxWidth CSS px.
   * Old hard cap of 2.0 left portal/gallery previews soft on HiDPI (600–1100 CSS box × 2–3 DPR).
   * Small thumbs stay ≤2×; portal/large maxWidth can go sharper.
   */
  const maxScale =
    effectiveMaxWidth >= 1600 ? 4 : effectiveMaxWidth >= 1100 ? 3.25 : effectiveMaxWidth >= 800 ? 2.75 : 2;
  const scale = Math.min(effectiveMaxWidth / viewport.width, maxScale);
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get canvas context");
  // Transparent vector PDF → JPEG: kuch engines (desktop WebView) black thumb; web jaisa safed pehle
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport: scaledViewport,
  } as any).promise;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        if (!blob) {
          reject(new Error("Failed to create blob from canvas"));
          return;
        }
        resolve({
          thumbnailUrl: URL.createObjectURL(blob),
          thumbnailBlob: blob,
        });
      },
      "image/jpeg",
      effectiveQuality
    );
  });
}

/**
 * Uploads PDF thumbnail to Firebase Storage (optional server-side cache).
 */
export async function uploadPdfThumbnail(
  thumbnailBlob: Blob,
  originalPdfPath: string,
  storage: any
): Promise<string> {
  const { ref, uploadBytes, getDownloadURL } = await import("@/lib/pocketbaseData/pbStorage");
  const thumbnailPath = originalPdfPath.replace(/\.pdf$/i, "_thumb.jpg");
  const storageRef = ref(storage, thumbnailPath);
  await uploadBytes(storageRef, thumbnailBlob);
  return await getDownloadURL(storageRef);
}

/** Native/APK: previously generated thumb exist ho to direct URL (`convertFileSrc`) return. */
export async function getNativePdfThumbnailDisplayUrl(cacheKey: string): Promise<string | null> {
  if (!isCapacitorNativeApp()) return null;
  try {
    const path = await nativeThumbPathFromKey(cacheKey);
    const exists = await attachmentFileExistsInDataDir(path);
    if (!exists) return null;
    const uri = await getAttachmentFileUriFromDataDir(path);
    if (!uri) return null;
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}

/** Native/APK: pdf thumb blob ko disk par persist karke future previews me read-avoid. */
export async function saveNativePdfThumbnail(cacheKey: string, thumbnailBlob: Blob): Promise<string | null> {
  if (!isCapacitorNativeApp()) return null;
  try {
    const path = await nativeThumbPathFromKey(cacheKey);
    const ok = await writeAttachmentBlobToDataDir(path, thumbnailBlob);
    if (!ok) return null;
    const uri = await getAttachmentFileUriFromDataDir(path);
    if (!uri) return null;
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}
