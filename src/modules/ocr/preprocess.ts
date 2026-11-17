"use client";
/** Source → raster preprocessing: EXIF orientation, PDF page 1 @300DPI, upscale, grayscale, contrast stretch. */
import { importPdfJsDist } from "@/lib/importPdfJsDist";
import { ensurePdfJsWorker, PDFJS_WORKER_VERSION_FALLBACK } from "@/lib/pdfjsWorkerSrc";

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

/** Grayscale + 1–99 percentile contrast stretch for online OCR providers. */
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

export async function fileToOcrCanvas(file: Blob, mime: string, maxSide: number): Promise<HTMLCanvasElement> {
  return (await fileToOcrCanvasInfo(file, mime, maxSide)).canvas;
}

export async function fileToOcrCanvasInfo(
  file: Blob,
  mime: string,
  maxSide: number,
): Promise<{ canvas: HTMLCanvasElement }> {
  const isPdf = /pdf/i.test(mime || file.type);
  const c = isPdf ? await pdfToCanvas(file, maxSide) : await imageToCanvas(file, maxSide);
  grayscaleStretch(c);
  return { canvas: c };
}
