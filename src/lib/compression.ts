"use client";

import { throwIfAttachmentCompressionAborted, isAttachmentCompressionCancelledError } from "@/lib/attachmentCompressionUi";
import { importPdfJsDist } from "@/lib/importPdfJsDist";
import {
  ensurePdfJsWorker,
  PDFJS_WORKER_VERSION_FALLBACK,
} from "@/lib/pdfjsWorkerSrc";

/**
 * Images: A4 @150 DPI max, JPEG out; progressive re-compress until ≤ maxKB.
 * Defaults: Online band max 100KB / soft floor 50KB (callers pass 150KB for Local/PL/Drive).
 * PDFs: pdf-lib shrink, zarurat par pdf.js → JPEG → pdf-lib embed (~0.5MB).
 * Mobile: bade image par createImageBitmap se max side 4096.
 */

const MAX_KB_DEFAULT = 100;
const MIN_KB_DEFAULT = 50;

/** Admin/custom caps ≤80KB: output ~90–100% of target (not ~50%). Default 100/150 keep ~50KB soft floor. */
function imageSoftMinKbForMax(maxKB: number): number {
  if (maxKB <= 80) {
    return Math.max(8, Math.floor(maxKB * 0.9));
  }
  return Math.min(MIN_KB_DEFAULT, Math.floor(maxKB * 0.5));
}

/** Default post-compress ceiling — voucher PDF / Drive PDF band */
const DEFAULT_MAX_PDF_BYTES_AFTER = 512 * 1024;

const A4_PORTRAIT = { w: 1240, h: 1754 };
const A4_LANDSCAPE = { w: 1754, h: 1240 };

const MAX_DECODE_DIMENSION = 4096;
const QUALITY_FLOOR = 0.26;
const MIN_SCALE = 0.03;
const MAX_IMAGE_PASSES = 40;
/** Band search: 18 redraw+encode EXE/APK par 20s+; draw-once + 6 JPEG encodes enough for From–To KB. */
const QUALITY_BAND_ITERS = 6;
const QUALITY_UNDER_CAP_ITERS = 4;

/** Bahut zyada pages par raster skip (reference: 50) */
const MAX_PDF_PAGES_FOR_RASTER = 50;

function isPdfLike(file: File): boolean {
  return (
    (file.type || "").toLowerCase() === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

/**
 * Pass size cut: ~101KB → ~10%; ~10000KB → ~50%; mid sizes lerp.
 * Matches: just-over = light; huge = half then re-compress until under max.
 */
function passSizeKeepFactor(currentKb: number, maxKb: number): number {
  if (currentKb <= maxKb * 1.2 || currentKb <= 200) return 0.88;
  if (currentKb >= 10_000) return 0.5;
  const t = Math.min(1, Math.max(0, (currentKb - 200) / (10_000 - 200)));
  return 0.88 - t * 0.38;
}

function paintSourceToCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number
): void {
  canvas.width = width;
  canvas.height = height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
}

async function encodeJpegFromPaintedCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return canvasToBlob(canvas, "image/jpeg", quality);
}

async function encodeJpegAt(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  paintSourceToCanvas(canvas, ctx, source, width, height);
  return encodeJpegFromPaintedCanvas(canvas, quality);
}

/**
 * Ek scale par quality binary-search: output [minBytes, maxBytes] band me, max ke paas.
 * Chhoti image / chhota scale par null → caller scale badhayega.
 * Draw once — quality loop sirf JPEG encode (EXE/APK pe purana path har pass full redraw).
 */
async function encodeJpegInBandAtSize(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  minBytes: number,
  maxBytes: number
): Promise<Blob | null> {
  paintSourceToCanvas(canvas, ctx, source, width, height);
  const atMaxQ = await encodeJpegFromPaintedCanvas(canvas, 0.98);
  if (atMaxQ.size < minBytes) return null;
  if (atMaxQ.size <= maxBytes) return atMaxQ;

  const atMinQ = await encodeJpegFromPaintedCanvas(canvas, QUALITY_FLOOR);
  if (atMinQ.size > maxBytes) return null;

  let lo = QUALITY_FLOOR;
  let hi = 0.98;
  let bestInBand: Blob | null = null;
  for (let i = 0; i < QUALITY_BAND_ITERS; i++) {
    const q = (lo + hi) / 2;
    const blob = await encodeJpegFromPaintedCanvas(canvas, q);
    if (blob.size <= maxBytes) {
      if (blob.size >= minBytes && (!bestInBand || blob.size > bestInBand.size)) {
        bestInBand = blob;
      }
      lo = q;
    } else {
      hi = q;
    }
  }
  return bestInBand;
}

/** Oversized voucher photo: kam scales, pehle hit par return. */
const SHRINK_ONLY_SCALES = [1, 0.82, 0.64, 0.5];

/** From–To KB band: scale + quality se output ko [min, max] ke andar lao (30–35 na ki 16). */
async function fitJpegToTargetBand(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  baseW: number,
  baseH: number,
  minBytes: number,
  maxBytes: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  shrinkOnly = false
): Promise<Blob | null> {
  let bestInBand: Blob | null = null;
  let bestUnderCap: Blob | null = null;

  const pickBest = (inBand: Blob | null, under: Blob | null): boolean => {
    if (inBand && (!bestInBand || inBand.size > bestInBand.size)) bestInBand = inBand;
    if (under && (!bestUnderCap || under.size > bestUnderCap.size)) bestUnderCap = under;
    if (bestInBand) return true;
    if (bestUnderCap && bestUnderCap.size >= minBytes) {
      bestInBand = bestUnderCap;
      return true;
    }
    return false;
  };

  const tryScale = async (scale: number): Promise<boolean> => {
    throwIfAttachmentCompressionAborted(signal);
    const w = Math.max(1, Math.round(baseW * scale));
    const h = Math.max(1, Math.round(baseH * scale));
    const inBand = await encodeJpegInBandAtSize(canvas, ctx, source, w, h, minBytes, maxBytes);
    if (inBand) return pickBest(inBand, null);
    // Canvas is already painted at this scale from encodeJpegInBandAtSize.
    let lo = QUALITY_FLOOR;
    let hi = 0.98;
    let under: Blob | null = null;
    for (let i = 0; i < QUALITY_UNDER_CAP_ITERS; i++) {
      const q = (lo + hi) / 2;
      const blob = await encodeJpegFromPaintedCanvas(canvas, q);
      if (blob.size <= maxBytes) {
        if (!under || blob.size > under.size) under = blob;
        lo = q;
      } else {
        hi = q;
      }
    }
    return pickBest(null, under);
  };

  if (shrinkOnly) {
    let step = 0;
    const total = SHRINK_ONLY_SCALES.length;
    for (const scale of SHRINK_ONLY_SCALES) {
      throwIfAttachmentCompressionAborted(signal);
      step += 1;
      onProgress?.(Math.min(95, Math.round((step / total) * 100)));
      if (await tryScale(scale)) {
        onProgress?.(100);
        return bestInBand;
      }
    }
    onProgress?.(100);
    return bestInBand ?? bestUnderCap;
  }

  const scaleUpSteps = 17;
  let step = 0;
  const bump = () => {
    step += 1;
    onProgress?.(Math.min(95, Math.round((step / (scaleUpSteps + 20)) * 100)));
  };

  // Pehle scale up (chhoti photo ko 30KB+ lane ke liye), phir full, phir thoda down.
  for (let scale = 0.85; scale <= 1.65; scale += 0.05) {
    throwIfAttachmentCompressionAborted(signal);
    if (await tryScale(scale)) {
      onProgress?.(100);
      return bestInBand;
    }
    bump();
  }
  for (let si = 1; si <= 20; si++) {
    throwIfAttachmentCompressionAborted(signal);
    const scale = Math.max(MIN_SCALE, 1 - (si / 20) * (1 - MIN_SCALE));
    if (await tryScale(scale)) {
      onProgress?.(100);
      return bestInBand;
    }
    bump();
  }

  onProgress?.(100);
  return bestInBand ?? bestUnderCap;
}

/**
 * Android WebView / Capacitor pickers often hand over a File with EMPTY `type` (content:// uri). Every image path
 * gated on `type.startsWith("image/")` then returned the original untouched (progress still went to 100%).
 * Infer the MIME from the extension so the real compress path runs.
 */
const EXT_IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  bmp: "image/bmp", heic: "image/heic", heif: "image/heif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
};
export function withInferredImageMime(file: File): File {
  const t = String(file.type || "").toLowerCase();
  if (t && t !== "application/octet-stream") return file;
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name || "")?.[1] || "").toLowerCase();
  const mime = EXT_IMAGE_MIME[ext];
  if (!mime) return file;
  try {
    return new File([file], file.name || `image.${ext}`, { type: mime, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Never let a WebView decode/encode callback that never fires hang the save. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[compression] ${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function compressFile(
  file: File,
  options?: {
    maxKB?: number;
    minKB?: number;
    maxPdfBytesAfter?: number;
    onProgress?: (pct: number) => void;
    signal?: AbortSignal;
  }
): Promise<File> {
  throwIfAttachmentCompressionAborted(options?.signal);
  file = withInferredImageMime(file);
  const report = (pct: number) => options?.onProgress?.(Math.min(100, Math.max(0, Math.round(pct))));
  const MAX_KB = options?.maxKB ?? MAX_KB_DEFAULT;
  const minKbOpt = options?.minKB ?? imageSoftMinKbForMax(MAX_KB);
  const MIN_KB = Math.min(minKbOpt, Math.floor(MAX_KB * 0.98));
  const maxPdfBytes = options?.maxPdfBytesAfter ?? DEFAULT_MAX_PDF_BYTES_AFTER;
  const maxBytes = MAX_KB * 1024;
  const minBytes = MIN_KB * 1024;

  if (isPdfLike(file)) {
    return compressPdfFile(file, maxPdfBytes);
  }

  if (!file.type.startsWith("image/")) return file;

  // Already inside target band — touch mat karo.
  if (file.size <= maxBytes && file.size >= minBytes) return file;

  const bandSpanKb = MAX_KB - MIN_KB;
  const useTargetBand = bandSpanKb <= 40 || MIN_KB >= MAX_KB * 0.75;

  let imageBitmapToClose: ImageBitmap | null = null;

  try {
    throwIfAttachmentCompressionAborted(options?.signal);
    const { source, width: srcW, height: srcH } = await withTimeout(decodeImageForCanvas(file), 20_000, "decode");
    if (source instanceof ImageBitmap) {
      imageBitmapToClose = source;
    }

    const isPortrait = srcH >= srcW;
    const maxW = isPortrait ? A4_PORTRAIT.w : A4_LANDSCAPE.w;
    const maxH = isPortrait ? A4_PORTRAIT.h : A4_LANDSCAPE.h;

    let baseW = srcW;
    let baseH = srcH;
    if (baseW > maxW || baseH > maxH) {
      const ratio = Math.min(maxW / baseW, maxH / baseH);
      baseW = Math.max(1, Math.round(baseW * ratio));
      baseH = Math.max(1, Math.round(baseH * ratio));
    }

    const sizeKb = file.size / 1024;
    // Narrow admin band (30–35): base size mat chhota karo — warna 16KB par atak jata hai.
    if (!useTargetBand) {
      if (sizeKb >= 4000) {
        baseW = Math.max(1, Math.round(baseW * 0.55));
        baseH = Math.max(1, Math.round(baseH * 0.55));
      } else if (sizeKb >= 1500) {
        baseW = Math.max(1, Math.round(baseW * 0.75));
        baseH = Math.max(1, Math.round(baseH * 0.75));
      }
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    const outType = "image/jpeg";
    const newName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";

    const toOutputFile = (blob: Blob) =>
      new File([blob], newName, { type: outType, lastModified: Date.now() });

    if (useTargetBand || file.size < minBytes) {
      report(5);
      const shrinkOnly = file.size > maxBytes;
      const fitted = await fitJpegToTargetBand(
        canvas,
        ctx,
        source as CanvasImageSource,
        baseW,
        baseH,
        minBytes,
        maxBytes,
        report,
        options?.signal,
        shrinkOnly
      );
      if (fitted && fitted.size <= maxBytes) {
        if (fitted.size >= minBytes || file.size > maxBytes) {
          report(100);
          return toOutputFile(fitted);
        }
      }
    }

    let quality = sizeKb >= 10_000 ? 0.68 : sizeKb >= 1000 ? 0.8 : 0.9;
    let scale = 1;
    let bestBlob: Blob | null = null;

    for (let pass = 0; pass < MAX_IMAGE_PASSES; pass++) {
      throwIfAttachmentCompressionAborted(options?.signal);
      report(Math.min(90, Math.round((pass / MAX_IMAGE_PASSES) * 90)));
      const width = Math.max(1, Math.round(baseW * scale));
      const height = Math.max(1, Math.round(baseH * scale));
      const blob = await encodeJpegAt(canvas, ctx, source as CanvasImageSource, width, height, quality);
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;

      const kb = blob.size / 1024;
      if (kb <= MAX_KB) {
        bestBlob = blob;
        break;
      }

      const keep = passSizeKeepFactor(kb, MAX_KB);
      if (quality > QUALITY_FLOOR + 0.03) {
        quality = Math.max(QUALITY_FLOOR, quality * Math.sqrt(keep));
      } else {
        scale *= Math.sqrt(keep);
        quality = Math.min(0.72, Math.max(QUALITY_FLOOR, quality + 0.04));
      }

      if (scale < MIN_SCALE) break;
    }

    let emergency = 0;
    while (bestBlob && bestBlob.size > maxBytes && scale > 0.012 && emergency < 24) {
      throwIfAttachmentCompressionAborted(options?.signal);
      emergency += 1;
      scale *= 0.62;
      quality = Math.max(0.2, quality * 0.88);
      const width = Math.max(1, Math.round(baseW * scale));
      const height = Math.max(1, Math.round(baseH * scale));
      const blob = await encodeJpegAt(canvas, ctx, source as CanvasImageSource, width, height, quality);
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= maxBytes) {
        bestBlob = blob;
        break;
      }
    }

    if (bestBlob && bestBlob.size < minBytes) {
      throwIfAttachmentCompressionAborted(options?.signal);
      const lifted = await fitJpegToTargetBand(
        canvas,
        ctx,
        source as CanvasImageSource,
        baseW,
        baseH,
        minBytes,
        maxBytes,
        report,
        options?.signal,
        false
      );
      if (lifted && lifted.size > bestBlob.size) bestBlob = lifted;
    }

    report(100);

    if (imageBitmapToClose) {
      try {
        imageBitmapToClose.close();
      } catch {
        /* ignore */
      }
      imageBitmapToClose = null;
    }

    if (!bestBlob) return file;

    return toOutputFile(bestBlob);
  } catch {
    return file;
  } finally {
    if (imageBitmapToClose) {
      try {
        imageBitmapToClose.close();
      } catch {
        /* ignore */
      }
    }
  }
}

async function decodeImageForCanvas(
  file: File
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap !== "undefined") {
    try {
      let bm = await withTimeout(createImageBitmap(file), 15_000, "createImageBitmap");
      const w = bm.width;
      const h = bm.height;
      const maxDim = Math.max(w, h);
      if (maxDim > MAX_DECODE_DIMENSION) {
        const scale = MAX_DECODE_DIMENSION / maxDim;
        const tw = Math.max(1, Math.round(w * scale));
        const th = Math.max(1, Math.round(h * scale));
        const resized = await createImageBitmap(bm, {
          resizeWidth: tw,
          resizeHeight: th,
          resizeQuality: "medium",
        });
        bm.close();
        bm = resized;
      }
      return { source: bm, width: bm.width, height: bm.height };
    } catch {
      /* Image() fallback */
    }
  }

  const img = await loadImageWithImageElement(file);
  return {
    source: img,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
  };
}

function loadImageWithImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("[compression] image element load timed out"));
    }, 20_000);
    img.addEventListener("load", () => clearTimeout(timer));
    img.addEventListener("error", () => clearTimeout(timer));

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  // Android WebView: toBlob can return null or never call back (memory pressure) -> toDataURL fallback + timeout.
  const viaDataUrl = (): Blob | null => {
    try {
      const dataUrl = canvas.toDataURL(type, quality);
      const comma = dataUrl.indexOf(",");
      if (comma < 0) return null;
      const bin = atob(dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.length ? new Blob([bytes], { type }) : null;
    } catch {
      return null;
    }
  };
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const out = b ?? viaDataUrl();
      if (!out) return reject(new Error("Failed to compress image."));
      resolve(out);
    };
    const timer = setTimeout(() => finish(null), 12_000);
    try {
      canvas.toBlob((b) => finish(b), type, quality);
    } catch {
      finish(null);
    }
  });
}

/**
 * PDF: (1) pdf-lib copy+save, (2) zarurat par pdf.js → JPEG per page → pdf-lib embed.
 * Reference Other App logic — smallest candidate return.
 */
export async function compressPdfFile(
  file: File,
  maxBytes: number = DEFAULT_MAX_PDF_BYTES_AFTER,
  opts?: { forceOptimizeChunkyUnderCap?: boolean }
): Promise<File> {
  if (!isPdfLike(file) || typeof window === "undefined") return file;

  const SOFT_FLOOR = 220 * 1024;
  const chunkyUnderCap =
    opts?.forceOptimizeChunkyUnderCap === true &&
    file.size <= maxBytes &&
    file.size >= SOFT_FLOOR;

  if (file.size <= maxBytes && !chunkyUnderCap) return file;

  const candidates: File[] = [file];

  const shrunk = await tryPdfLibShrink(file);
  if (shrunk) candidates.push(shrunk);

  let bestAfterShrink = shrunk ?? file;
  if (bestAfterShrink.size <= maxBytes && !chunkyUnderCap) return bestAfterShrink;

  const raster = await tryRasterizePdfToSmaller(file, maxBytes);
  candidates.push(raster);

  return candidates.reduce((a, b) => (a.size <= b.size ? a : b));
}

async function tryPdfLibShrink(file: File): Promise<File | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const bytes = await file.arrayBuffer();
    const src = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
    const saved = await out.save({ useObjectStreams: true });
    const bytesCopy = new Uint8Array(saved);
    return new File([bytesCopy], file.name, {
      type: "application/pdf",
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

async function tryRasterizePdfToSmaller(file: File, maxBytes: number): Promise<File> {
  if (typeof document === "undefined") return file;

  try {
    const { pdfjsLib, pdfjs } = await importPdfJsDist();
    const version =
      (pdfjsLib as { version?: string }).version ??
      pdfjs.version ??
      PDFJS_WORKER_VERSION_FALLBACK;

    await ensurePdfJsWorker(pdfjs as never, version);

    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
      data,
    }) as { promise: Promise<PdfJsDocLike>; destroy?: () => void };
    const pdfSrc = await loadingTask.promise;

    if (pdfSrc.numPages > MAX_PDF_PAGES_FOR_RASTER) {
      try {
        await pdfSrc.destroy();
      } catch {
        /* ignore */
      }
      return file;
    }
    const numPages = pdfSrc.numPages;

    const passes: { maxW: number; jpegQ: number }[] = [
      { maxW: 1024, jpegQ: 0.62 },
      { maxW: 820, jpegQ: 0.52 },
      { maxW: 640, jpegQ: 0.44 },
      { maxW: 480, jpegQ: 0.38 },
    ];

    let bestFile: File = file;

    for (const pass of passes) {
      const { PDFDocument } = await import("pdf-lib");
      const outDoc = await PDFDocument.create();

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfSrc.getPage(pageNum);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(pass.maxW / base.width, 2.0);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", pass.jpegQ);
        });
        if (!blob) continue;

        const jpgBytes = await blob.arrayBuffer();
        const image = await outDoc.embedJpg(jpgBytes);
        const w = image.width;
        const h = image.height;
        const pdfPage = outDoc.addPage([w, h]);
        pdfPage.drawImage(image, {
          x: 0,
          y: 0,
          width: w,
          height: h,
        });
      }

      const saved = await outDoc.save({ useObjectStreams: true });
      const bytesCopy = new Uint8Array(saved);
      const candidate = new File([bytesCopy], file.name, {
        type: "application/pdf",
        lastModified: Date.now(),
      });

      if (candidate.size < bestFile.size) bestFile = candidate;
      if (candidate.size <= maxBytes) break;
    }

    try {
      await pdfSrc.destroy();
    } catch {
      /* ignore */
    }

    return bestFile;
  } catch {
    return file;
  }
}

type PdfJsDocLike = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: unknown) => { promise: Promise<void> };
  }>;
  destroy: () => Promise<void>;
};

/**
 * Voucher attachments: reference `compressPdfFile` + tiny skip + chunky-under-cap optimize (220KB+).
 */
export async function compressPdfForAttachment(file: File, maxBytes: number): Promise<File> {
  if (!isPdfLike(file) || typeof window === "undefined") return file;

  const MIN_PDF_BYTES_TO_TOUCH = 56 * 1024;
  if (file.size <= MIN_PDF_BYTES_TO_TOUCH) return file;

  const SOFT_SKIP_UNDER_CAP_BYTES = 220 * 1024;
  const chunkyUnderCap = file.size <= maxBytes && file.size >= SOFT_SKIP_UNDER_CAP_BYTES;

  if (file.size <= maxBytes && !chunkyUnderCap) return file;

  return compressPdfFile(file, maxBytes, {
    forceOptimizeChunkyUnderCap: chunkyUnderCap,
  });
}

/** Drive attachment PDF / non-image ceiling. */
export const DRIVE_ATTACHMENT_MAX_BYTES = 512 * 1024;

/** Drive / local-like image ceiling (Local / PL Server / Drive). */
export const DRIVE_IMAGE_ATTACHMENT_MAX_BYTES = 150 * 1024;

/** Blob → File → voucher-grade compress; masters / items / vouchers sab Drive par same size band. */
export async function compressAttachmentBlobForDriveUpload(
  blob: Blob,
  opts?: { fileName?: string; contentType?: string; maxBytes?: number }
): Promise<Blob> {
  const contentType = opts?.contentType || blob.type || "";
  const t = contentType.toLowerCase();
  const fileName = opts?.fileName || "file";
  const isPdf = t === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isImage = t.startsWith("image/");
  if (!isPdf && !isImage) return blob;
  const file = new File([blob], fileName, { type: contentType || "application/octet-stream" });
  const maxBytes =
    opts?.maxBytes ??
    (isImage ? DRIVE_IMAGE_ATTACHMENT_MAX_BYTES : DRIVE_ATTACHMENT_MAX_BYTES);
  return compressVoucherAttachment(file, maxBytes);
}

/** Payment / voucher attachments: image → compressFile; PDF → compressPdfForAttachment; baaki as-is. */
export async function compressVoucherAttachment(
  file: File,
  maxBytes: number,
  options?: { minKB?: number; onProgress?: (pct: number) => void; signal?: AbortSignal }
): Promise<File> {
  file = withInferredImageMime(file);
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) {
    const original = file;
    try {
      return await withTimeout(compressVoucherImageInner(file, maxBytes, options), 60_000, "image compress");
    } catch (e) {
      if (isAttachmentCompressionCancelledError(e)) throw e;
      console.warn("[compression] image compress failed/timed out - keeping original", e);
      return original;
    }
  }
  if (t === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    try {
      return await withTimeout(compressPdfForAttachment(file, maxBytes), 90_000, "pdf compress");
    } catch (e) {
      console.warn("[compression] pdf compress failed/timed out - keeping original", e);
      return file;
    }
  }
  return file;
}

async function compressVoucherImageInner(
  file: File,
  maxBytes: number,
  options?: { minKB?: number; onProgress?: (pct: number) => void; signal?: AbortSignal }
): Promise<File> {
  {
    const maxKB = Math.max(24, Math.floor(maxBytes / 1024));
    const minKB =
      options?.minKB != null && Number.isFinite(options.minKB) && options.minKB > 0
        ? Math.min(Math.floor(options.minKB), maxKB)
        : imageSoftMinKbForMax(maxKB);
    let out = await compressFile(file, {
      maxKB,
      minKB,
      maxPdfBytesAfter: maxBytes,
      onProgress: options?.onProgress,
      signal: options?.signal,
    });
    // Never leave an oversize image — second pass with a tighter ceiling.
    if (out.size > maxBytes) {
      throwIfAttachmentCompressionAborted(options?.signal);
      out = await compressFile(out.size < file.size ? out : file, {
        maxKB: Math.max(18, maxKB - 12),
        minKB: 12,
        maxPdfBytesAfter: maxBytes,
        signal: options?.signal,
      });
    }
    return out;
  }
}
