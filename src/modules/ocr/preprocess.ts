"use client";
/** Source → raster → preprocessing (spec §2): EXIF orientation, PDF page 1 @300DPI, upscale, grayscale, contrast stretch.
 *  "enhanced" variant (retry pass): flat-field + stretch + deskew, see preprocessOps.ts. */
import { importPdfJsDist } from "@/lib/importPdfJsDist";
import { ensurePdfJsWorker, PDFJS_WORKER_VERSION_FALLBACK } from "@/lib/pdfjsWorkerSrc";
import { enhanceForOcr, rgbToGray } from "./preprocessOps";

async function pdfToCanvas(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const { pdfjsLib, pdfjs } = await importPdfJsDist();
  await ensurePdfJsWorker(pdfjs as never, (pdfjsLib as { version?: string }).version ?? PDFJS_WORKER_VERSION_FALLBACK);
  const doc = await (pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }) as any).promise;
  try {
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = Math.min(300 / 72, maxSide / Math.max(vp0.width, vp0.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as any).promise;
    return c;
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function imageToCanvas(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const longSide = Math.max(bmp.width, bmp.height);
  let scale = longSide < 1500 ? 2 : 1;
  scale = Math.min(scale, maxSide / longSide);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Grayscale + 1–99 percentile contrast stretch (tesseract does its own binarization). */
function grayscaleStretch(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = g;
    hist[g]++;
  }
  const n = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

export type OcrPreprocessVariant = "standard" | "enhanced";

/**
 * Enhanced variant (retry pass for over-lit / glare / tilted photos): flat-field background removal + stretch
 * (preprocessOps), then deskew by rotating onto a white canvas.
 */
function enhanceCanvas(c: HTMLCanvasElement): { canvas: HTMLCanvasElement; skewDeg: number } {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const { gray, skewDeg } = enhanceForOcr(rgbToGray(img.data, c.width, c.height, 4));
  const d = img.data;
  for (let i = 0, j = 0; i < gray.data.length; i++, j += 4) d[j] = d[j + 1] = d[j + 2] = gray.data[i];
  ctx.putImageData(img, 0, 0);
  if (!skewDeg) return { canvas: c, skewDeg: 0 };
  const t = (skewDeg * Math.PI) / 180;
  const w = Math.round(Math.abs(c.width * Math.cos(t)) + Math.abs(c.height * Math.sin(t)));
  const h = Math.round(Math.abs(c.width * Math.sin(t)) + Math.abs(c.height * Math.cos(t)));
  const r = document.createElement("canvas");
  r.width = w;
  r.height = h;
  const rc = r.getContext("2d")!;
  rc.fillStyle = "#fff";
  rc.fillRect(0, 0, w, h);
  rc.imageSmoothingQuality = "high";
  rc.translate(w / 2, h / 2);
  rc.rotate(t);
  rc.drawImage(c, -c.width / 2, -c.height / 2);
  return { canvas: r, skewDeg };
}

export async function fileToOcrCanvas(file: Blob, mime: string, maxSide: number, variant: OcrPreprocessVariant = "standard"): Promise<HTMLCanvasElement> {
  return (await fileToOcrCanvasInfo(file, mime, maxSide, variant)).canvas;
}

export async function fileToOcrCanvasInfo(
  file: Blob,
  mime: string,
  maxSide: number,
  variant: OcrPreprocessVariant = "standard"
): Promise<{ canvas: HTMLCanvasElement; skewDeg: number }> {
  const isPdf = /pdf/i.test(mime || file.type);
  const c = isPdf ? await pdfToCanvas(file, maxSide) : await imageToCanvas(file, maxSide);
  if (variant === "enhanced") return enhanceCanvas(c);
  grayscaleStretch(c);
  return { canvas: c, skewDeg: 0 };
}
