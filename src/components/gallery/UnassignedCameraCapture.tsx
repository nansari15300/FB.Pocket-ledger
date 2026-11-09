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
import { RotateCcw, Check, X, Loader2, ScanText, Sun, Contrast, Sparkles, Maximize2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { publicAssetUrl } from "@/lib/webAppBasePath";

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

/** Crop rectangles are normalized 0..1 relative to the source bitmap. */
type CropRect = { x: number; y: number; w: number; h: number };

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

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
  icon,
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
      <span className="flex w-[74px] shrink-0 items-center gap-1 text-[11px] font-medium text-foreground">
        {icon}
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="pl-range min-w-0 flex-1 cursor-pointer"
        aria-label={label}
      />
      <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground/70">{value}</span>
    </div>
  );
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
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [panelOpen, setPanelOpen] = useState(false);

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
  }, []);

  const closeAll = useCallback(() => {
    stopStream();
    fileRef.current = null;
    preserveNameRef.current = null;
    canvasRef.current = null;
    setStage("idle");
    setSaving(false);
    resetEdits();
  }, [stopStream, resetEdits]);

  // Tear the camera down if the component unmounts mid-shot.
  useEffect(() => () => { stopStream(); }, [stopStream]);

  const openNativeCamera = useCallback(() => {
    setStage("idle");
    nativeInputRef.current?.click();
  }, []);

  /** Demo route: sample document + editor, without touching the real camera. */
  const openDemoEditor = useCallback(() => {
    try {
      stopStream();
      canvasRef.current = makeDemoSourceCanvas();
      fileRef.current = null;
      resetEdits();
      setMode("color");
      setStage("review");
    } catch {
      toast.error("Demo editor could not start.");
    }
  }, [stopStream, resetEdits]);

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
        canvasRef.current = canvas;
        fileRef.current = null;
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
  }, [openRequest, preserveName, stopStream, resetEdits]);

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

  /** Draw the source canvas into the on-screen preview canvas (crop + edits). */
  const repaintPreview = useCallback(() => {
    const src = canvasRef.current;
    const dst = previewCanvasRef.current;
    if (!src || !dst) return;
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    const sx = Math.round(crop.x * src.width);
    const sy = Math.round(crop.y * src.height);
    const sw = Math.max(1, Math.round(crop.w * src.width));
    const sh = Math.max(1, Math.round(crop.h * src.height));
    dst.width = sw;
    dst.height = sh;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    applyEdits(ctx, sw, sh, { mode, brightness, contrast, sharpness });
  }, [crop, mode, brightness, contrast, sharpness]);

  // Repaint whenever an edit changes or the review stage becomes active.
  useEffect(() => {
    if (stage !== "review") return;
    // requestAnimationFrame avoids painting before the canvas is in the DOM on APK.
    const id = requestAnimationFrame(() => repaintPreview());
    return () => cancelAnimationFrame(id);
  }, [stage, repaintPreview]);

  const shoot = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      canvasRef.current = drawVideoToCanvas(v);
      fileRef.current = null;
      resetEdits();
      stopStream();
      setStage("review");
    } catch {
      toast.error("Could not capture photo. Try again.");
    }
  }, [stopStream, resetEdits]);

  const retake = useCallback(() => {
    canvasRef.current = null;
    fileRef.current = null;
    resetEdits();
    void startCamera();
  }, [startCamera, resetEdits]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const src = canvasRef.current;
      if (src) {
        // Render the cropped + edited result at full source resolution.
        const sx = Math.round(crop.x * src.width);
        const sy = Math.round(crop.y * src.height);
        const sw = Math.max(1, Math.round(crop.w * src.width));
        const sh = Math.max(1, Math.round(crop.h * src.height));
        const out = document.createElement("canvas");
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext("2d");
        if (!ctx) throw new Error("canvas_unavailable");
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
        applyEdits(ctx, sw, sh, { mode, brightness, contrast, sharpness });
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
        canvasRef.current = canvas;
        fileRef.current = null;
        resetEdits();
        setStage("review");
      } catch {
        toast.error("Could not open photo.");
        setStage("idle");
      }
    },
    [resetEdits]
  );

  const cropPresets = useMemo(
    () => [
      { key: "full", label: "Full", rect: DEFAULT_CROP },
      { key: "doc", label: "Document", rect: { x: 0.06, y: 0.06, w: 0.88, h: 0.88 } },
      { key: "tight", label: "Tight", rect: { x: 0.14, y: 0.1, w: 0.72, h: 0.8 } },
    ],
    []
  );
  const activeCropKey =
    cropPresets.find(
      (p) =>
        Math.abs(p.rect.x - crop.x) < 1e-6 &&
        Math.abs(p.rect.y - crop.y) < 1e-6 &&
        Math.abs(p.rect.w - crop.w) < 1e-6 &&
        Math.abs(p.rect.h - crop.h) < 1e-6
    )?.key ?? "full";

  return (
    <>
      {/* Thick, scrollbar-jaisa slider styling (light + fresh). */}
      <style>{`
        .pl-range {
          -webkit-appearance: none;
          appearance: none;
          height: 22px;
          background: transparent;
          outline: none;
        }
        .pl-range::-webkit-slider-runnable-track {
          height: 12px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--primary) 16%, var(--muted));
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.08);
        }
        .pl-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          height: 22px;
          width: 22px;
          margin-top: -5px;
          border-radius: 999px;
          background: var(--primary);
          border: 3px solid var(--background);
          box-shadow: 0 2px 6px rgba(0,0,0,0.22);
          transition: transform 120ms ease;
        }
        .pl-range:active::-webkit-slider-thumb { transform: scale(1.08); }
        .pl-range::-moz-range-track {
          height: 12px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--primary) 16%, var(--muted));
        }
        .pl-range::-moz-range-thumb {
          height: 22px;
          width: 22px;
          border-radius: 999px;
          background: var(--primary);
          border: 3px solid var(--background);
          box-shadow: 0 2px 6px rgba(0,0,0,0.22);
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

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted p-2">
            {stage === "starting" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={stage === "live" ? "h-full w-full object-contain" : "hidden"}
            />
            {/* APK fix: a real <canvas> preview (not blob: <img>) so the WebView always paints it. */}
            <canvas
              ref={previewCanvasRef}
              className={stage === "review" ? "block max-h-full max-w-full object-contain" : "hidden"}
              aria-label="Scanned document preview"
            />
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
                        onClick={() => setCrop(p.rect)}
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
                    {/* Crop section ka label — presets ke saath same grid box */}
                    <div className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border border-dashed border-border px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Maximize2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">Crop</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Adjust panel: brightness / contrast / sharpness */}
              {panelOpen && (
                <div className="mx-2 mt-2 space-y-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                  <EditSlider
                    icon={<Sun className="h-3 w-3 shrink-0" />}
                    label="Brightness"
                    value={brightness}
                    min={0}
                    max={100}
                    onChange={setBrightness}
                    disabled={saving}
                  />
                  <EditSlider
                    icon={<Contrast className="h-3 w-3 shrink-0" />}
                    label="Contrast"
                    value={contrast}
                    min={0}
                    max={100}
                    onChange={setContrast}
                    disabled={saving}
                  />
                  <EditSlider
                    icon={<Sparkles className="h-3 w-3 shrink-0" />}
                    label="Sharpness"
                    value={sharpness}
                    min={0}
                    max={100}
                    onChange={setSharpness}
                    disabled={saving}
                  />
                </div>
              )}

              <div className="flex items-center gap-2 px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
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
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 min-w-0 flex-1 gap-1.5 rounded-full px-3 text-sm"
                    onClick={retake}
                    disabled={saving}
                  >
                    <RotateCcw className="h-4 w-4 shrink-0" />
                    Retry
                  </Button>
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
