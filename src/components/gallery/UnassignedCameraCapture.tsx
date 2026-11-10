"use client";

/**
 * Mobile / APK: floating camera button in the Unassigned tab.
 *
 * Flow: camera (getUserMedia, rear lens) -> shutter -> editor (mode + crop + brightness /
 * contrast / sharpness) -> Save. Save emits a File through the same pipeline as drag &
 * drop, so the photo lands in the Unassigned list under the signed-in user.
 *
 * Editor modes (same as hardware document-scanner apps):
 *   - Color : original photo (only lightness/contrast/sharpness tweaks)
 *   - Scan  : boosted contrast white-paper look, still gray-ish
 *   - B&W   : hard binary black/white (document scan)
 *
 * Fallback: when getUserMedia is unavailable (insecure origin, permission denied, no
 * camera — e.g. some WebViews) we fall back to the native camera capture input.
 *
 * APK note: the preview <img> uses a blob: URL. The Capacitor WebView serves the app from
 * `https://localhost`, where revoking the object URL as soon as a re-render happens made
 * the review image blank. The object URL is now kept alive for the whole review stage and
 * the encoded bytes are also kept in a ref, so re-renders never drop the preview.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Check, X, Loader2, ScanText, Sun, Contrast, Sparkles, Maximize2, ChevronLeft, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { publicAssetUrl } from "@/lib/webAppBasePath";
import {
  type CropQuad,
  type CropHandle,
  type CropCorner,
  type CropEdge,
  DEFAULT_CROP_QUAD,
  CROP_CORNERS,
  CROP_EDGES,
  rectToCropQuad,
  cloneCropQuad,
  cropQuadsEqual,
  isFullCropQuad,
  edgeMidpoint,
  cornerArrowAngle,
  edgeArrowAngle,
  resizeCursorForAngle,
  applyCropDrag,
  warpCropQuadToCanvas,
} from "@/lib/perspectiveWarp";

/**
 * App ke andar ka camera trigger icon (dashboard FAB + gallery tabs) — user ki di hui
 * camera-lens image, bilkul waisi hi. Home-screen / APK launcher icon isse alag hai.
 */
function CameraScanIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- chhota static public icon
    <img
      src={publicAssetUrl("/icons/camera-lens.png")}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("select-none object-contain", className)}
    />
  );
}

type Stage = "idle" | "starting" | "live" | "review";
type ColorMode = "color" | "scan" | "bw";

/** Crop quads are normalized 0..1 relative to the source bitmap (free 4-corner). */
const DEFAULT_CROP = DEFAULT_CROP_QUAD;

const CORNER_LABELS: Record<CropCorner, string> = {
  nw: "Top-left corner",
  ne: "Top-right corner",
  se: "Bottom-right corner",
  sw: "Bottom-left corner",
};
const EDGE_LABELS: Record<CropEdge, string> = {
  n: "Top edge",
  e: "Right edge",
  s: "Bottom edge",
  w: "Left edge",
};

function CropHandleArrow({ angleRad }: { angleRad: number }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden
      style={{
        display: "block",
        transform: `rotate(${(angleRad * 180) / Math.PI}deg)`,
        filter: "drop-shadow(0 0 1px rgba(0,0,0,0.85))",
      }}
    >
      <path
        d="M2.2 8h11.6M2.2 8l3.1-3.1M2.2 8l3.1 3.1M13.8 8l-3.1-3.1M13.8 8l-3.1 3.1"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CropDragHandle({
  x,
  y,
  angle,
  cursor,
  label,
  zIndex,
  onPointerDown,
}: {
  x: number;
  y: number;
  angle: number;
  cursor: string;
  label: string;
  zIndex: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      role="slider"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: 44,
        height: 44,
        transform: "translate(-50%, -50%)",
        pointerEvents: "auto",
        touchAction: "none",
        cursor,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "#2563eb",
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CropHandleArrow angleRad={angle} />
      </div>
    </div>
  );
}

/**
 * Header ka "Camera demo" button isi window event ko dispatch karta hai; camera FAB
 * listener laga kar sample photo ke saath editor khol deta hai — bina asli camera ke,
 * taaki phone par crop / adjust / mode turant test ho sake.
 */
export const PL_CAMERA_DEMO_EVENT = "pl:camera:open-demo";

/** A synthetic "photo" so the editor can be exercised without a camera. */
function makeDemoSourceCanvas(): HTMLCanvasElement {
  const w = 900;
  const h = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  // Paper-ish tint with a gradient so brightness/contrast sliders are visible.
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#f4efe4");
  grad.addColorStop(1, "#ddd6c6");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Border box like a document sheet
  ctx.strokeStyle = "#8a8378";
  ctx.lineWidth = 6;
  ctx.strokeRect(60, 60, w - 120, h - 120);

  ctx.fillStyle = "#2c2a26";
  ctx.font = "bold 54px system-ui, sans-serif";
  ctx.fillText("INVOICE", 110, 190);

  ctx.font = "30px system-ui, sans-serif";
  const lines = [
    "Demo document for camera editor",
    "",
    "Bill No:  DEMO-2026-0091",
    "Date:    2083-07-23 BS",
    "Party:   Ritita Home Making",
    "",
    "Item                     Qty     Amount",
    "--------------------------------------",
    "Cement Bag                12      9,600",
    "Paint White               4       2,400",
    "Labour                    1       1,800",
    "--------------------------------------",
    "Total                            13,800",
  ];
  lines.forEach((line, i) => ctx.fillText(line, 110, 280 + i * 54));

  // A few colored marks — makes the "Color" mode visibly different from B&W.
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(110, h - 300, 260, 26);
  ctx.fillStyle = "#1e6feb";
  ctx.fillRect(110, h - 250, 180, 26);
  return canvas;
}

export type UnassignedCameraCaptureProps = {
  /** Receives the "scanned" photo as a File; the gallery uploads it like a dropped file. */
  onCapture: (file: File) => void | Promise<void>;
  /** Pixel offset from the bottom, so hosts can stack the button above their own FAB. */
  bottomClass?: string;
  /** Optional extra classes for the floating trigger. */
  className?: string;
  /** Optional inline style for the floating trigger (dashboard: Add New ke saath same row). */
  wrapperStyle?: React.CSSProperties;
  /** Demo-only host (PC header): editor रेंडर होता है, floating FAB छुपा रहता है. */
  demoHostOnly?: boolean;
  /**
   * Existing image ko editor me kholna (3-dot → Edit file). Jab bhi ye `openRequest.key`
   * badalta hai, editor us URL/Blob ko source bana kar review stage khol deta hai.
   */
  openRequest?: { key: number; urlOrBlob: string | Blob } | null;
  /** Existing file edit ke liye — save par naya Scan_… naam nahi, yahi naam rakho. */
  preserveName?: string | null;
};

/** Grab a frame from the <video> into a canvas (capped at 1600px long edge). */
function drawVideoToCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1440;
  const MAX_EDGE = 1600;
  const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Box-blur (two-pass separable) on an ImageData copy — used as the shadow for unsharp. */
function blurredCopy(src: ImageData, radius: number): ImageData {
  const { width: w, height: h } = src;
  const tmp = new Uint8ClampedArray(src.data.length);
  const out = new Uint8ClampedArray(src.data.length);
  const r = Math.max(1, Math.round(radius));
  const d = src.data;

  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
        const i = rowOff + xx * 4;
        sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
      }
      const o = rowOff + x * 4;
      tmp[o] = sr / n; tmp[o + 1] = sg / n; tmp[o + 2] = sb / n; tmp[o + 3] = d[o + 3];
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        const i = (yy * w + x) * 4;
        sr += tmp[i]; sg += tmp[i + 1]; sb += tmp[i + 2]; n++;
      }
      const o = (y * w + x) * 4;
      out[o] = sr / n; out[o + 1] = sg / n; out[o + 2] = sb / n; out[o + 3] = tmp[o + 3];
    }
  }
  return new ImageData(out, w, h);
}

/**
 * Apply the editor settings to a canvas in place.
 *   mode        color | scan | bw
 *   brightness  0..100  (50 = neutral, lightness)
 *   contrast    0..100  (50 = neutral, extra contrast on top of mode baseline)
 *   sharpness   0..100  (50 = neutral, unsharp mask; chhota = soft, bada = sharp)
 */
function applyEdits(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { mode: ColorMode; brightness: number; contrast: number; sharpness: number }
) {
  if (!w || !h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Sliders 0..100 aate hain; 50 = neutral (koi effect nahi).
  const bSigned = (opts.brightness - 50) / 50; // -1 .. +1
  const cSigned = (opts.contrast - 50) / 50;   // -1 .. +1
  const sNorm = opts.sharpness / 50;           // 0 (50) .. 2 (100) .. 1 (50)

  const bright = bSigned * 55;
  const modeContrast = opts.mode === "color" ? 1.0 : opts.mode === "scan" ? 1.35 : 2.6;
  const userContrast = Math.pow(1.6, cSigned);
  const C = modeContrast * userContrast;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];

    if (opts.mode !== "color") {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }

    r = (r - 128) * C + 128 + bright;
    g = (g - 128) * C + 128 + bright;
    b = (b - 128) * C + 128 + bright;

    if (opts.mode === "bw") {
      const v = r > 150 ? 255 : 0;
      r = g = b = v;
    }

    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);

  // Unsharp mask: result = original + amount * (original - blur).
  // 50 = neutral baseline (subtle sharpening), 0 = soft, 100 = maximum.
  {
    const amount = (opts.sharpness / 100) * 1.6;
    if (amount > 0.02) {
      const orig = ctx.getImageData(0, 0, w, h);
      const blur = blurredCopy(orig, 1);
      for (let i = 0; i < orig.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const o = orig.data[i + c];
          const b = blur.data[i + c];
          const v = o + (o - b) * amount;
          orig.data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
      ctx.putImageData(orig, 0, 0);
    }
  }
}

const MAX_CROP_HISTORY = 10;

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(src, 0, 0);
  return c;
}

function revokeBlobUrl(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
}

type CropHistoryEntry = {
  canvas: HTMLCanvasElement;
  crop: CropQuad;
  blobUrl?: string;
};

function revokeHistoryEntry(entry: CropHistoryEntry | null | undefined) {
  if (!entry) return;
  revokeBlobUrl(entry.blobUrl);
  entry.blobUrl = undefined;
}

/** Encode a canvas as a File with a scan-looking name. */
async function canvasToScanFile(canvas: HTMLCanvasElement, quality = 0.85, fileName?: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob) throw new Error("encode_failed");
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = fileName
    ? fileName
    : `Scan_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(
    stamp.getHours()
  )}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.jpg`;
  return new File([blob], name, { type: "image/jpeg", lastModified: stamp.getTime() });
}

/** Native camera / gallery picker se aayi image ko downscale + JPEG re-encode karo. */
async function compressPickedImage(file: File): Promise<File> {
  try {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    const bitmap = await createImageBitmap(file);
    const MAX_EDGE = 1600;
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const outW = Math.max(1, Math.round(bitmap.width * scale));
    const outH = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
    );
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "Scan";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    return file;
  }
}

/** Small labelled range row used in the editor panel. */
function EditSlider({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("pl-range block w-full min-w-0 cursor-pointer", disabled && "opacity-40")}
      style={{ height: 18, width: "100%", minWidth: 0, margin: 0, padding: 0, border: 0, outline: "none", background: "transparent", boxShadow: "none" }}
      aria-label={label}
    />  );
}

export function UnassignedCameraCapture({ onCapture, bottomClass, className, wrapperStyle, demoHostOnly = false, openRequest = null, preserveName = null }: UnassignedCameraCaptureProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<File | null>(null);
  /** Existing file edit mode me original naam barqarar rakhta hai (naya "Scan_…" naam nahi). */
  const preserveNameRef = useRef<string | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);

  // Editor state — sliders 0..100 hain, 50 = neutral (koi change nahi).
  const [mode, setMode] = useState<ColorMode>("scan");
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  const [sharpness, setSharpness] = useState(50);
  const [crop, setCrop] = useState<CropQuad>(DEFAULT_CROP);
  const cropRef = useRef<CropQuad>(crop);
  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);
  const [panelOpen, setPanelOpen] = useState(false);
  /** Interactive crop: true hone par preview par draggable box dikhta hai. */
  const [cropMode, setCropMode] = useState(false);
  const [previewAspect, setPreviewAspect] = useState(1);
  /** Canvas ke letterboxed painted region ka on-screen rect, overlay ke liye. */
  const [paintRect, setPaintRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);

  /** Canvas ke painted (object-contain letterboxed) area ka frame-relative rect nikaalo.
      NOTE: canvas element ka hi getBoundingClientRect use karo — parent ke padding
      (p-2) se offset na ho, warna overlay corners shift dikhte hain. */
  const measurePaintRect = useCallback(() => {
    const frame = previewFrameRef.current;
    const cv = previewCanvasRef.current;
    if (!frame || !cv || !cv.width || !cv.height) return;
    const fr = frame.getBoundingClientRect();
    const cr = cv.getBoundingClientRect();
    const cw = cr.width || 1;
    const ch = cr.height || 1;
    const ox = cr.left - fr.left;
    const oy = cr.top - fr.top;
    const iw = cv.width;
    const ih = cv.height;
    // object-contain letterboxing
    const scale = Math.min(cw / iw, ch / ih);
    const w = iw * scale;
    const h = ih * scale;
    setPaintRect({ x: ox + (cw - w) / 2, y: oy + (ch - h) / 2, w, h });
  }, []);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    start: CropQuad;
    boxW: number;
    boxH: number;
  } | null>(null);

  /** Bumped when the working bitmap changes (Apply / Undo / Redo / Retry) so the preview repaints. */
  const [sourceRev, setSourceRev] = useState(0);
  const [histCounts, setHistCounts] = useState({ undo: 0, redo: 0 });
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionKindRef = useRef<"camera" | "file">("file");
  const undoStackRef = useRef<CropHistoryEntry[]>([]);
  const redoStackRef = useRef<CropHistoryEntry[]>([]);
  const blobUrlsRef = useRef<string[]>([]);

  const trackBlobUrl = useCallback((url: string) => {
    if (url && url.startsWith("blob:")) blobUrlsRef.current.push(url);
    return url;
  }, []);

  const revokeTrackedBlobUrls = useCallback(() => {
    for (const u of blobUrlsRef.current) revokeBlobUrl(u);
    blobUrlsRef.current = [];
  }, []);

  const clearCropHistory = useCallback(() => {
    for (const e of undoStackRef.current) revokeHistoryEntry(e);
    for (const e of redoStackRef.current) revokeHistoryEntry(e);
    undoStackRef.current = [];
    redoStackRef.current = [];
    revokeTrackedBlobUrls();
    setHistCounts({ undo: 0, redo: 0 });
  }, [revokeTrackedBlobUrls]);

  const beginSession = useCallback(
    (canvas: HTMLCanvasElement, kind: "camera" | "file") => {
      clearCropHistory();
      canvasRef.current = canvas;
      originalCanvasRef.current = cloneCanvas(canvas);
      sessionKindRef.current = kind;
      fileRef.current = null;
      setSourceRev((n) => n + 1);
    },
    [clearCropHistory]
  );

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetEdits = useCallback(() => {
    setMode("scan");
    setBrightness(50);
    setContrast(50);
    setSharpness(50);
    setCrop(DEFAULT_CROP);
    setPanelOpen(false);
    setCropMode(false);
  }, []);

  /** Auto 90° crop — image me bright document ka outer bounding box dhoondho,
      usko axis-aligned rectangle me crop set karo (fast scanner apps jaisa). */
  const autoDetectDocument = useCallback(() => {
    const src = canvasRef.current;
    if (!src || !src.width || !src.height) return;
    try {
      const ctx = src.getContext("2d");
      if (!ctx) return;
      // sample grid par light-pixel scan (perf ke liye downscaled)
      const SW = Math.min(160, src.width);
      const SH = Math.min(200, src.height);
      const tmp = document.createElement("canvas");
      tmp.width = SW;
      tmp.height = SH;
      const tctx = tmp.getContext("2d");
      if (!tctx) return;
      tctx.drawImage(src, 0, 0, SW, SH);
      const data = tctx.getImageData(0, 0, SW, SH).data;
      // adaptive threshold: sample ka 65th percentile
      const lums = new Uint8Array(SW * SH);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        lums[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
      }
      const sorted = Array.from(lums).sort((a, b) => a - b);
      const pct = sorted[Math.floor(sorted.length * 0.65)] || 160;
      const thr = Math.max(110, Math.min(215, pct));
      let x0 = SW, y0 = SH, x1 = -1, y1 = -1;
      for (let y = 0; y < SH; y++) {
        for (let x = 0; x < SW; x++) {
          if (lums[y * SW + x] >= thr) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 <= x0 || y1 <= y0) {
        toast.error("Document not detected", { description: "Threshold badal ke ya manually crop karein." });
        return;
      }
      // thoda inset margin
      let nx = x0 / SW;
      let ny = y0 / SH;
      let nw = (x1 - x0 + 1) / SW;
      let nh = (y1 - y0 + 1) / SH;
      // minimum 12% — bohot chhota detect ho gaya to ignore
      if (nw < 0.12 || nh < 0.12) {
        nx = 0.06; ny = 0.06; nw = 0.88; nh = 0.88;
      }
      // Clamp aur inset 1px
      const inset = 0.005;
      nx = Math.max(0, Math.min(1 - nw, nx + inset));
      ny = Math.max(0, Math.min(1 - nh, ny + inset));
      nw = Math.min(1 - nx, Math.max(0.12, nw - inset * 2));
      nh = Math.min(1 - ny, Math.max(0.12, nh - inset * 2));
      setCrop(rectToCropQuad({ x: nx, y: ny, w: nw, h: nh }));
      toast.success("Auto 90° crop lagaya");
    } catch {
      toast.error("Auto crop failed");
    }
  }, []);

  /** Interactive crop — pointer drag updates a free quadrilateral.
      Corners move independently; side handles slide that edge along its normal;
      interior drag moves the whole quad, clamped to the image. */
  const startCropDrag = useCallback(
    (e: React.PointerEvent, handle: CropHandle) => {
      const wrap = previewWrapRef.current;
      if (!wrap) return;
      // Agar pehle se drag chal raha hai to naya drag shuru na karo (multi-touch guard)
      if (cropDragRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = wrap.getBoundingClientRect();
      // cropRef se current value lo -> callback ka `crop` dependency hat gaya,
      // isliye har re-render par naya handler nahi banta.
      cropDragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        start: cloneCropQuad(cropRef.current),
        boxW: rect.width || 1,
        boxH: rect.height || 1,
      };
      // Pointer capture yahan NAHI lagate — window-level listeners pointer ko
      // track karte hain, isliye element re-render hone se drag kabhi nahi tootta.
    },
    []
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = cropDragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / d.boxW;
      const dy = (e.clientY - d.startY) / d.boxH;
      const next = applyCropDrag(d.start, d.handle, dx, dy);
      setCrop(next);
      cropRef.current = next;
    };
    const onUp = () => {
      cropDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const closeAll = useCallback(() => {
    stopStream();
    fileRef.current = null;
    preserveNameRef.current = null;
    canvasRef.current = null;
    originalCanvasRef.current = null;
    clearCropHistory();
    setStage("idle");
    setSaving(false);
    resetEdits();
  }, [stopStream, resetEdits, clearCropHistory]);

  // Tear the camera down if the component unmounts mid-shot; revoke any leftover blob URLs.
  useEffect(
    () => () => {
      stopStream();
      clearCropHistory();
    },
    [stopStream, clearCropHistory]
  );

  const openNativeCamera = useCallback(() => {
    setStage("idle");
    nativeInputRef.current?.click();
  }, []);

  /** Demo route: sample document + editor, without touching the real camera. */
  const openDemoEditor = useCallback(() => {
    try {
      stopStream();
      beginSession(makeDemoSourceCanvas(), "file");
      resetEdits();
      setMode("color");
      setStage("review");
    } catch {
      toast.error("Demo editor could not start.");
    }
  }, [stopStream, resetEdits, beginSession]);

  // Header ka "Camera demo" button (PC + mobile) — window event se editor kholta hai.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDemo = () => openDemoEditor();
    window.addEventListener(PL_CAMERA_DEMO_EVENT, onDemo);
    return () => window.removeEventListener(PL_CAMERA_DEMO_EVENT, onDemo);
  }, [openDemoEditor]);

  /**
   * 3-dot → "Edit file": existing photo (ya URL/Blob) ko source canvas me daal kar editor
   * kholta hai. Har naye `key` par dubara chalta hai, isliye same file ko lagatar edit
   * karne par bhi editor dobara khulta hai.
   */
  const lastOpenRequestKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest) return;
    if (lastOpenRequestKeyRef.current === openRequest.key) return;
    lastOpenRequestKeyRef.current = openRequest.key;

    let cancelled = false;
    void (async () => {
      try {
        stopStream();
        const MAX_EDGE = 1600;
        let bitmap: ImageBitmap;
        const src = openRequest.urlOrBlob;
        if (src instanceof Blob) {
          bitmap = await createImageBitmap(src);
        } else if (src.startsWith("data:")) {
          const res = await fetch(src);
          bitmap = await createImageBitmap(await res.blob());
        } else {
          const res = await fetch(src);
          bitmap = await createImageBitmap(await res.blob());
        }
        if (cancelled) {
          bitmap.close?.();
          return;
        }
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas_unavailable");
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        beginSession(canvas, "file");
        preserveNameRef.current = preserveName;
        resetEdits();
        setMode("color");
        setStage("review");
      } catch {
        if (!cancelled) {
          toast.error("Could not open file for editing");
          setStage("idle");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openRequest, preserveName, stopStream, resetEdits, beginSession]);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      openNativeCamera();
      return;
    }
    setStage("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setStage("live");
    } catch {
      // Denied / no camera / insecure origin: native capture input is the fallback.
      setStage("idle");
      toast.message("Camera preview unavailable", {
        description: "Opening the device camera instead.",
      });
      openNativeCamera();
    }
  }, [openNativeCamera]);

  // Attach the stream once the <video> is mounted for the "live" stage.
  useEffect(() => {
    if (stage !== "live") return;
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [stage]);

  /** Draw the source canvas into the on-screen preview canvas.
   *  cropMode ON => poori image (taaki crop box uske upar set ho), OFF => cropped + edits. */
  const repaintPreview = useCallback(() => {
    const src = canvasRef.current;
    const dst = previewCanvasRef.current;
    if (!src || !dst) return;
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    if (cropMode) {
      dst.width = src.width;
      dst.height = src.height;
      ctx.drawImage(src, 0, 0);
      applyEdits(ctx, src.width, src.height, { mode, brightness, contrast, sharpness });
      setPreviewAspect(src.width / Math.max(1, src.height));
      return;
    }
    warpCropQuadToCanvas(src, crop, dst);
    const sw = dst.width;
    const sh = dst.height;
    applyEdits(ctx, sw, sh, { mode, brightness, contrast, sharpness });
    setPreviewAspect(sw / Math.max(1, sh));
  }, [crop, cropMode, mode, brightness, contrast, sharpness, sourceRev]);

  // Repaint whenever an edit changes or the review stage becomes active.
  // NOTE: cropMode me canvas poori image dikhata hai (crop ke bina), isliye drag ke
  // dauraan repaint/measure ki zaroorat nahi — isse layout shift nahi hoti.
  useEffect(() => {
    if (stage !== "review") return;
    const id = requestAnimationFrame(() => {
      repaintPreview();
      if (!cropMode) {
        requestAnimationFrame(() => measurePaintRect());
      }
    });
    return () => cancelAnimationFrame(id);
  }, [stage, repaintPreview, measurePaintRect, cropMode]);

  // Crop mode ON hote hi (aur image dims badalne par) ek baar measure karo.
  useEffect(() => {
    if (stage !== "review") return;
    const id = requestAnimationFrame(() => measurePaintRect());
    return () => cancelAnimationFrame(id);
  }, [stage, cropMode, previewAspect, measurePaintRect]);

  // Window/screen resize par overlay ka painted rect dobara nikaalo.
  useEffect(() => {
    if (stage !== "review") return;
    const onResize = () => measurePaintRect();
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (ro && previewFrameRef.current) ro.observe(previewFrameRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [stage, measurePaintRect]);

  const shoot = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      beginSession(drawVideoToCanvas(v), "camera");
      resetEdits();
      stopStream();
      setStage("review");
    } catch {
      toast.error("Could not capture photo. Try again.");
    }
  }, [stopStream, resetEdits, beginSession]);

  const retake = useCallback(() => {
    canvasRef.current = null;
    fileRef.current = null;
    originalCanvasRef.current = null;
    clearCropHistory();
    resetEdits();
    void startCamera();
  }, [startCamera, resetEdits, clearCropHistory]);

  const bumpSource = useCallback(() => {
    fileRef.current = null;
    setSourceRev((n) => n + 1);
  }, []);

  const applyCropToPage = useCallback(() => {
    const src = canvasRef.current;
    if (!src) return;
    if (isFullCropQuad(crop)) return;
    try {
      const snapshot: CropHistoryEntry = {
        canvas: cloneCanvas(src),
        crop: {
          nw: { ...crop.nw },
          ne: { ...crop.ne },
          se: { ...crop.se },
          sw: { ...crop.sw },
        },
      };
      const warped = warpCropQuadToCanvas(src, crop);
      const evicted: CropHistoryEntry[] = [];
      const nextUndo = [...undoStackRef.current, snapshot];
      while (nextUndo.length > MAX_CROP_HISTORY) {
        const old = nextUndo.shift();
        if (old) evicted.push(old);
      }
      for (const e of evicted) revokeHistoryEntry(e);
      for (const e of redoStackRef.current) revokeHistoryEntry(e);
      undoStackRef.current = nextUndo;
      redoStackRef.current = [];
      setHistCounts({ undo: nextUndo.length, redo: 0 });
      canvasRef.current = warped;
      setCrop(DEFAULT_CROP);
      setCropMode(false);
      bumpSource();
    } catch {
      toast.error("Could not apply crop");
    }
  }, [crop, bumpSource]);

  const undoCrop = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    const current = canvasRef.current;
    if (current) {
      redoStackRef.current.push({
        canvas: cloneCanvas(current),
        crop: {
          nw: { ...crop.nw },
          ne: { ...crop.ne },
          se: { ...crop.se },
          sw: { ...crop.sw },
        },
      });
    }
    setHistCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
    canvasRef.current = prev.canvas;
    setCrop(prev.crop);
    setCropMode(!isFullCropQuad(prev.crop));
    bumpSource();
  }, [crop, bumpSource]);

  const redoCrop = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    const current = canvasRef.current;
    if (current) {
      undoStackRef.current.push({
        canvas: cloneCanvas(current),
        crop: {
          nw: { ...crop.nw },
          ne: { ...crop.ne },
          se: { ...crop.se },
          sw: { ...crop.sw },
        },
      });
    }
    setHistCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
    canvasRef.current = next.canvas;
    setCrop(next.crop);
    setCropMode(!isFullCropQuad(next.crop));
    bumpSource();
  }, [crop, bumpSource]);

  const retryReview = useCallback(() => {
    if (sessionKindRef.current === "camera") {
      retake();
      return;
    }
    clearCropHistory();
    resetEdits();
    fileRef.current = null;
    const orig = originalCanvasRef.current;
    if (orig) canvasRef.current = cloneCanvas(orig);
    bumpSource();
  }, [retake, clearCropHistory, resetEdits, bumpSource]);

  useEffect(() => {
    if (stage !== "review") return;
    const onKey = (e: KeyboardEvent) => {
      if (saving) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redoCrop();
        else undoCrop();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redoCrop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, saving, undoCrop, redoCrop]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const src = canvasRef.current;
      if (src) {
        // Warp the (possibly skewed) quad into an upright rectangle, then apply edits.
        const out = warpCropQuadToCanvas(src, crop);
        const ctx = out.getContext("2d");
        if (!ctx) throw new Error("canvas_unavailable");
        applyEdits(ctx, out.width, out.height, { mode, brightness, contrast, sharpness });
        fileRef.current = await canvasToScanFile(
          out,
          0.85,
          preserveNameRef.current || undefined
        );
      }
      const file = fileRef.current;
      if (!file) throw new Error("no_photo");
      await onCapture(file);
      toast.success(preserveNameRef.current ? "File updated" : "Photo added", {
        description: preserveNameRef.current
          ? undefined
          : "Saved to Unassigned Documents.",
      });
      closeAll();
    } catch {
      toast.error("Save failed", { description: "Photo could not be saved. Try again." });
      setSaving(false);
    }
  }, [crop, mode, brightness, contrast, sharpness, onCapture, closeAll]);

  const onNativePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const compressed = await compressPickedImage(file);
        const bitmap = await createImageBitmap(compressed);
        const MAX_EDGE = 1600;
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas_unavailable");
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        beginSession(canvas, "file");
        resetEdits();
        setStage("review");
      } catch {
        toast.error("Could not open photo.");
        setStage("idle");
      }
    },
    [resetEdits, beginSession]
  );

  const cropPresets = useMemo(
    () => [
      { key: "full", label: "Full", quad: DEFAULT_CROP },
      { key: "doc", label: "Document", quad: rectToCropQuad({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 }) },
      { key: "tight", label: "Tight", quad: rectToCropQuad({ x: 0.14, y: 0.1, w: 0.72, h: 0.8 }) },
    ],
    []
  );
  const activeCropKey =
    cropPresets.find((p) => cropQuadsEqual(p.quad, crop))?.key ?? null;

  return (
    <>
      {/* Thick, scrollbar-jaisa slider styling (light + fresh). */}
      <style>{`
        .pl-range {
          -webkit-appearance: none;
          appearance: none;
          height: 18px;
          width: 100%;
          background: transparent;
          border: 0;
          outline: none;
          box-shadow: none;
        }
        .pl-range::-webkit-slider-runnable-track {
          width: 100%;
          height: 18px;
          border: 0;
          border-radius: 999px;
          background: #93c5fd;
        }
        .pl-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          height: 18px;
          width: 18px;
          margin-top: 0;
          border: 0;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 1px 2px rgba(0,0,0,0.18);
          transition: transform 120ms ease;
        }
        .pl-range:active::-webkit-slider-thumb { transform: scale(1.08); }
        .pl-range::-moz-range-track {
          width: 100%;
          height: 18px;
          border: 0;
          border-radius: 999px;
          background: #93c5fd;
        }
        .pl-range::-moz-range-thumb {
          height: 18px;
          width: 18px;
          border: 0;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 1px 2px rgba(0,0,0,0.18);
        }
      `}</style>
      {/* Camera viewfinder / review overlay — fullscreen, fixed. */}
      {stage !== "idle" && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background text-foreground">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold">
              {stage === "review" ? "Edit scan" : "Scan document"}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              aria-label="Close camera"
              onClick={closeAll}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted p-2">
            {stage === "starting" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={stage === "live" ? "h-full w-full object-contain" : "hidden"}
            />
            {/* Preview area — canvas letterboxed (object-contain) + overlay usi painted
                area par, aspect-Aware "fit box" ke zariye. Koi bhi screen size ho,
                image HAMESHA pooree dikhti hai aur kabhi buttons par nahi chadhti. */}
            <div
              ref={previewFrameRef}
              className={stage === "review" ? "relative h-full w-full" : "hidden"}
              style={{ touchAction: "none" }}
            >
              {/* Canvas: fill area, letterboxed image */}
              <canvas
                ref={previewCanvasRef}
                className="pointer-events-none h-full w-full object-contain"
                aria-label="Scanned document preview"
              />
              {/* Fit box: canvas ke painted (letterboxed) rect par exactly pin */}
              <div
                ref={previewWrapRef}
                className="absolute"
                style={
                  paintRect
                    ? { left: paintRect.x, top: paintRect.y, width: paintRect.w, height: paintRect.h }
                    : { left: "50%", top: "50%", width: 0, height: 0, transform: "translate(-50%,-50%)" }
                }
              >
                {/* Interactive crop overlay — cropMode active hone par */}
                {cropMode && (
                  <div className="pointer-events-none absolute inset-0">
                  {/* Top bar — Auto 90° */}
                  <div
                    className="pointer-events-auto absolute inset-x-0 top-0 flex items-center justify-end gap-1 px-1.5 py-1.5"
                    style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))", zIndex: 4 }}
                  >
                    <button
                      type="button"
                      onClick={autoDetectDocument}
                      className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-slate-900 shadow-md active:scale-95"
                    >
                      Auto 90°
                    </button>
                  </div>
                  <svg
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full"
                    style={{ zIndex: 1 }}
                    aria-hidden
                  >
                    <path
                      d={`M0,0H1V1H0Z M${crop.nw.x},${crop.nw.y}L${crop.ne.x},${crop.ne.y}L${crop.se.x},${crop.se.y}L${crop.sw.x},${crop.sw.y}Z`}
                      fill="rgba(0,0,0,0.5)"
                      fillRule="evenodd"
                      style={{ pointerEvents: "none" }}
                    />
                    {[1 / 3, 2 / 3].map((t) => {
                      const acrossA = {
                        x: crop.nw.x + (crop.ne.x - crop.nw.x) * t,
                        y: crop.nw.y + (crop.ne.y - crop.nw.y) * t,
                      };
                      const acrossB = {
                        x: crop.sw.x + (crop.se.x - crop.sw.x) * t,
                        y: crop.sw.y + (crop.se.y - crop.sw.y) * t,
                      };
                      const downA = {
                        x: crop.nw.x + (crop.sw.x - crop.nw.x) * t,
                        y: crop.nw.y + (crop.sw.y - crop.nw.y) * t,
                      };
                      const downB = {
                        x: crop.ne.x + (crop.se.x - crop.ne.x) * t,
                        y: crop.ne.y + (crop.se.y - crop.ne.y) * t,
                      };
                      return (
                        <g key={t}>
                          <line x1={acrossA.x} y1={acrossA.y} x2={acrossB.x} y2={acrossB.y} stroke="rgba(255,255,255,0.7)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                          <line x1={downA.x} y1={downA.y} x2={downB.x} y2={downB.y} stroke="rgba(255,255,255,0.7)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        </g>
                      );
                    })}
                    <polygon
                      points={`${crop.nw.x},${crop.nw.y} ${crop.ne.x},${crop.ne.y} ${crop.se.x},${crop.se.y} ${crop.sw.x},${crop.sw.y}`}
                      fill="transparent"
                      stroke="rgba(0,0,0,0.55)"
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "none" }}
                    />
                    <polygon
                      points={`${crop.nw.x},${crop.nw.y} ${crop.ne.x},${crop.ne.y} ${crop.se.x},${crop.se.y} ${crop.sw.x},${crop.sw.y}`}
                      fill="transparent"
                      stroke="rgba(255,255,255,0.95)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "auto", cursor: "move", touchAction: "none" }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startCropDrag(e, "move");
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        autoDetectDocument();
                      }}
                    />
                  </svg>
                  {CROP_EDGES.map((edge) => {
                    const mid = edgeMidpoint(crop, edge);
                    const angle = edgeArrowAngle(crop, edge);
                    return (
                      <CropDragHandle
                        key={edge}
                        x={mid.x}
                        y={mid.y}
                        angle={angle}
                        cursor={resizeCursorForAngle(angle)}
                        label={EDGE_LABELS[edge]}
                        zIndex={20}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          startCropDrag(e, edge);
                        }}
                      />
                    );
                  })}
                  {CROP_CORNERS.map((corner) => {
                    const angle = cornerArrowAngle(crop, corner);
                    return (
                      <CropDragHandle
                        key={corner}
                        x={crop[corner].x}
                        y={crop[corner].y}
                        angle={angle}
                        cursor={resizeCursorForAngle(angle)}
                        label={CORNER_LABELS[corner]}
                        zIndex={21}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          startCropDrag(e, corner);
                        }}
                      />
                    );
                  })}
                </div>
              )}
              </div>
            </div>
          </div>

          {stage === "review" && (
            <div
              data-pl-camera-editor
              className="max-h-[62dvh] shrink-0 overflow-y-auto overscroll-contain border-t border-border bg-background"
            >
              {/* Mode + crop controls — Adjust khula ho to ye dono rows chhup jaati hain */}
              {!panelOpen && (
                <div className="px-2 pt-2">
                  <div className="grid grid-cols-4 gap-1">
                    {([
                      { key: "color", label: "Color", icon: <Sun className="h-3.5 w-3.5 shrink-0" /> },
                      { key: "scan", label: "Scan", icon: <ScanText className="h-3.5 w-3.5 shrink-0" /> },
                      { key: "bw", label: "B&W", icon: <Contrast className="h-3.5 w-3.5 shrink-0" /> },
                    ] as const).map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setMode(m.key)}
                        disabled={saving}
                        className={cn(
                          "flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-[11px] font-medium transition-colors",
                          mode === m.key
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-muted/50 text-foreground hover:bg-muted"
                        )}
                      >
                        {m.icon}
                        <span className="truncate">{m.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPanelOpen(true)}
                      className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border border-primary bg-primary px-1 text-[11px] text-primary-foreground transition-colors"
                    >
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span className="truncate">Adjust</span>
                    </button>

                    {cropPresets.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setCrop(p.quad)}
                        disabled={saving}
                        className={cn(
                          "flex h-8 min-w-0 items-center justify-center rounded-lg border px-1 text-[11px] transition-colors",
                          activeCropKey === p.key
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <span className="truncate">{p.label}</span>
                      </button>
                    ))}
                    {/* Crop toggle — click se interactive crop box preview par on/off */}
                    <button
                      type="button"
                      onClick={() => {
                        setCropMode((v) => {
                          const next = !v;
                          // Pehli baar ON: Full crop ko thoda inset karo taaki
                          // chaaron corner handles screen par clearly dikhein.
                          if (next && isFullCropQuad(crop)) {
                            setCrop(rectToCropQuad({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 }));
                          }
                          return next;
                        });
                      }}
                      disabled={saving}
                      title="Crop area ko drag karke adjust karo"
                      className={cn(
                        "flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                        cropMode
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted/50 text-foreground hover:bg-muted"
                      )}
                    >
                      <Maximize2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">Crop</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Adjust panel: sliders ek grid me, beech me ek hi full-height divider */}
              {panelOpen && (
                <div className="mx-2 mt-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                  <div
                    className="grid items-center gap-x-2 gap-y-3"
                    style={{ gridTemplateColumns: "78px minmax(0, 1fr) 30px" }}
                  >
                    <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold italic text-foreground">
                      <Sun className="h-3 w-3 shrink-0" />
                      <span className="truncate">Brightness</span>
                    </span>
                    <EditSlider label="Brightness" value={brightness} min={0} max={100} onChange={setBrightness} disabled={saving} />
                    <span className="text-right text-[11px] font-semibold tabular-nums text-foreground/70">{brightness}</span>

                    <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold italic text-foreground">
                      <Contrast className="h-3 w-3 shrink-0" />
                      <span className="truncate">Contrast</span>
                    </span>
                    <EditSlider label="Contrast" value={contrast} min={0} max={100} onChange={setContrast} disabled={saving} />
                    <span className="text-right text-[11px] font-semibold tabular-nums text-foreground/70">{contrast}</span>

                    <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold italic text-foreground">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span className="truncate">Sharpness</span>
                    </span>
                    <EditSlider label="Sharpness" value={sharpness} min={0} max={100} onChange={setSharpness} disabled={saving} />
                    <span className="text-right text-[11px] font-semibold tabular-nums text-foreground/70">{sharpness}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5 px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={undoCrop}
                  disabled={saving || histCounts.undo === 0}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={redoCrop}
                  disabled={saving || histCounts.redo === 0}
                  title="Redo (Ctrl+Y)"
                  aria-label="Redo"
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
                {panelOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 min-w-0 flex-1 gap-1.5 rounded-full px-3 text-sm"
                    onClick={() => setPanelOpen(false)}
                    disabled={saving}
                    data-pl-adjust-back
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0" />
                    Back
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 min-w-0 flex-1 gap-1.5 rounded-full px-3 text-sm"
                      onClick={retryReview}
                      disabled={saving}
                    >
                      <RotateCcw className="h-4 w-4 shrink-0" />
                      Retry
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 min-w-0 flex-1 gap-1.5 rounded-full px-3 text-sm"
                      onClick={applyCropToPage}
                      disabled={saving || isFullCropQuad(crop)}
                      title="Warp the crop onto this page"
                    >
                      Apply
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  className="h-10 min-w-0 flex-1 gap-1.5 rounded-full px-3 text-sm"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 shrink-0" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          )}

          {stage === "live" && (
            <div className="flex items-center justify-center gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
              <Button
                type="button"
                onClick={() => void shoot()}
                className="h-16 w-16 rounded-full border-4 border-primary bg-primary/20 hover:bg-primary/30"
                aria-label="Take photo"
              />
            </div>
          )}
        </div>
      )}

      <input
        ref={nativeInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onNativePicked}
      />

      {/* Floating trigger. `className` lets a host pin it to its own container
          (e.g. 5px above the footer card); without it, it floats on the page.
          `demoHostOnly` (PC header) keeps the editor mounted but hides this FAB. */}
      {!demoHostOnly && (
        <Button
          type="button"
          size="icon"
          aria-label="Scan with camera"
          onClick={() => void startCamera()}
          className={
            className ??
            cn(
              // Sirf square icon dikhta hai — koi circular ring/background nahi.
              "fixed right-3 z-[59] h-12 w-12 border-0 bg-transparent p-0 shadow-none hover:bg-transparent active:bg-transparent focus-visible:ring-0",
              bottomClass ?? "bottom-[calc(9.5rem+env(safe-area-inset-bottom,0px))]"
            )
          }
          style={wrapperStyle}
        >
          <CameraScanIcon className="block !h-full !w-full shrink-0 object-contain" />
        </Button>
      )}
    </>
  );
}
