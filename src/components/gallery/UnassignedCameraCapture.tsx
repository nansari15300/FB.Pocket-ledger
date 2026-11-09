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
import { RotateCcw, Check, X, Loader2, ScanText, Sun, Contrast, Sparkles, Maximize2 } from "lucide-react";
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

export type UnassignedCameraCaptureProps = {
  /** Receives the "scanned" photo as a File; the gallery uploads it like a dropped file. */
  onCapture: (file: File) => void | Promise<void>;
  /** Pixel offset from the bottom, so hosts can stack the button above their own FAB. */
  bottomClass?: string;
  /** Optional extra classes for the floating trigger. */
  className?: string;
  /** Optional inline style for the floating trigger (dashboard: Add New ke saath same row). */
  wrapperStyle?: React.CSSProperties;
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
 *   brightness  -100..100  (lightness)
 *   contrast    -100..100  (extra contrast on top of mode baseline)
 *   sharpness   0..100     (unsharp mask)
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

  const bright = (opts.brightness / 100) * 55;
  const modeContrast = opts.mode === "color" ? 1.0 : opts.mode === "scan" ? 1.35 : 2.6;
  const userContrast = Math.pow(1.6, opts.contrast / 100);
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

  // Unsharp mask: result = original + amount * (original - blur)
  if (opts.sharpness > 0) {
    const amount = (opts.sharpness / 100) * 1.2;
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
async function canvasToScanFile(canvas: HTMLCanvasElement, quality = 0.85): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob) throw new Error("encode_failed");
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `Scan_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(
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
      <span className="flex w-[74px] shrink-0 items-center gap-1 text-[11px] font-medium text-white/85">
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
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-white"
        aria-label={label}
      />
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-white/60">{value}</span>
    </div>
  );
}

export function UnassignedCameraCapture({ onCapture, bottomClass, className, wrapperStyle }: UnassignedCameraCaptureProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [, setPreviewVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<File | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);

  // Editor state
  const [mode, setMode] = useState<ColorMode>("scan");
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [sharpness, setSharpness] = useState(35);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [panelOpen, setPanelOpen] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetEdits = useCallback(() => {
    setMode("scan");
    setBrightness(0);
    setContrast(0);
    setSharpness(35);
    setCrop(DEFAULT_CROP);
    setPanelOpen(false);
  }, []);

  const closeAll = useCallback(() => {
    stopStream();
    fileRef.current = null;
    canvasRef.current = null;
    setStage("idle");
    setSaving(false);
    resetEdits();
    setPreviewVersion((v) => v + 1);
  }, [stopStream, resetEdits]);

  // Tear the camera down if the component unmounts mid-shot.
  useEffect(() => () => { stopStream(); }, [stopStream]);

  const openNativeCamera = useCallback(() => {
    setStage("idle");
    nativeInputRef.current?.click();
  }, []);

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
      setPreviewVersion((n) => n + 1);
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
        fileRef.current = await canvasToScanFile(out);
      }
      const file = fileRef.current;
      if (!file) throw new Error("no_photo");
      await onCapture(file);
      toast.success("Photo added", { description: "Saved to Unassigned Documents." });
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
        setPreviewVersion((n) => n + 1);
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
      {/* Camera viewfinder / review overlay — fullscreen, fixed. */}
      {stage !== "idle" && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <span className="text-sm font-semibold">
              {stage === "review" ? "Edit scan" : "Scan document"}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-white hover:bg-white/15"
              aria-label="Close camera"
              onClick={closeAll}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
            {stage === "starting" && <Loader2 className="h-8 w-8 animate-spin text-white" />}
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
            <div className="shrink-0 border-t border-white/15 bg-black/85">
              {/* Mode row */}
              <div className="flex items-center justify-center gap-1.5 px-3 pt-2.5">
                {([
                  { key: "color", label: "Color", icon: <Sun className="h-3.5 w-3.5" /> },
                  { key: "scan", label: "Scan", icon: <ScanText className="h-3.5 w-3.5" /> },
                  { key: "bw", label: "B&W", icon: <Contrast className="h-3.5 w-3.5" /> },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    disabled={saving}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-xs font-medium transition-colors",
                      mode === m.key
                        ? "border-white bg-white text-black"
                        : "border-white/30 bg-white/5 text-white hover:bg-white/15"
                    )}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Crop / resize presets */}
              <div className="flex items-center justify-center gap-1.5 px-3 pt-1.5">
                <span className="flex items-center gap-1 pr-1 text-[10px] uppercase tracking-wide text-white/50">
                  <Maximize2 className="h-3 w-3" />
                  Crop
                </span>
                {cropPresets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setCrop(p.rect)}
                    disabled={saving}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                      activeCropKey === p.key
                        ? "border-white/80 bg-white/90 text-black"
                        : "border-white/25 text-white/80 hover:bg-white/15"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPanelOpen((v) => !v)}
                  className={cn(
                    "ml-auto flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    panelOpen
                      ? "border-white/80 bg-white/90 text-black"
                      : "border-white/25 text-white/80 hover:bg-white/15"
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  Adjust
                </button>
              </div>

              {/* Adjust panel: brightness / contrast / sharpness */}
              {panelOpen && (
                <div className="mt-2 space-y-2.5 rounded-t-xl border-t border-white/10 bg-white/5 px-4 pb-1 pt-3">
                  <EditSlider
                    icon={<Sun className="h-3.5 w-3.5" />}
                    label="Brightness"
                    value={brightness}
                    min={-100}
                    max={100}
                    onChange={setBrightness}
                    disabled={saving}
                  />
                  <EditSlider
                    icon={<Contrast className="h-3.5 w-3.5" />}
                    label="Contrast"
                    value={contrast}
                    min={-100}
                    max={100}
                    onChange={setContrast}
                    disabled={saving}
                  />
                  <EditSlider
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    label="Sharpness"
                    value={sharpness}
                    min={0}
                    max={100}
                    onChange={setSharpness}
                    disabled={saving}
                  />
                </div>
              )}

              <div className="flex items-center justify-center gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-2 rounded-full border-white/50 bg-transparent px-5 text-white hover:bg-white/15"
                  onClick={retake}
                  disabled={saving}
                >
                  <RotateCcw className="h-4 w-4" />
                  Retry
                </Button>
                <Button
                  type="button"
                  className="h-11 gap-2 rounded-full px-6"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
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
                className="h-16 w-16 rounded-full border-4 border-white bg-white/25 hover:bg-white/35"
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
          (e.g. 5px above the footer card); without it, it floats on the page. */}
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
    </>
  );
}
