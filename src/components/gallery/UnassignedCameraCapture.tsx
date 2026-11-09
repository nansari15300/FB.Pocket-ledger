"use client";

/**
 * Mobile / APK: floating camera button in the Unassigned tab.
 *
 * Flow: camera (getUserMedia, rear lens) -> shutter -> "scanned file" preview
 * (grayscale + contrast, like a document scanner) -> Retry | Save. Save emits a
 * File through the same pipeline as drag & drop, so the photo lands in the
 * Unassigned list under the signed-in user (and the user filter picks it up).
 *
 * Fallback: when getUserMedia is unavailable (insecure origin, permission
 * denied, no camera — e.g. some WebViews) we fall back to the native camera
 * capture input, so the button still does something useful.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Check, X, Loader2 } from "lucide-react";
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

/** Build a scanner-looking image: grayscale + boosted contrast, page-ish margins cropped.
 *  Output is downscaled + JPEG-compressed so camera uploads stay light. */
async function renderScannedFile(video: HTMLVideoElement, mirrored: boolean): Promise<File> {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1440;

  // Longest edge cap — full 12MP photos are unnecessary for a document scan.
  const MAX_EDGE = 1600;
  const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  const outW = Math.max(1, Math.round(vw * scale));
  const outH = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  if (mirrored) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, outW, outH);

  // Scan look: desaturate, then stretch contrast around a bright paper mid-tone.
  const img = ctx.getImageData(0, 0, outW, outH);
  const d = img.data;
  const CONTRAST = 1.55;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (gray - 150) * CONTRAST + 175));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
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

export function UnassignedCameraCapture({ onCapture, bottomClass, className, wrapperStyle }: UnassignedCameraCaptureProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<File | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearPreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    fileRef.current = null;
  }, [previewUrl]);

  const closeAll = useCallback(() => {
    stopStream();
    clearPreview();
    setStage("idle");
    setSaving(false);
  }, [stopStream, clearPreview]);

  // Tear the camera down if the component unmounts mid-shot.
  useEffect(() => () => { stopStream(); }, [stopStream]);

  const openNativeCamera = useCallback(() => {
    setStage("idle");
    nativeInputRef.current?.click();
  }, []);

  const startCamera = useCallback(async () => {
    clearPreview();
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
  }, [clearPreview, openNativeCamera]);

  // Attach the stream once the <video> is mounted for the "live" stage.
  useEffect(() => {
    if (stage !== "live") return;
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [stage]);

  const shoot = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const file = await renderScannedFile(v, false);
      fileRef.current = file;
      setPreviewUrl(URL.createObjectURL(file));
      stopStream();
      setStage("review");
    } catch {
      toast.error("Could not capture photo. Try again.");
    }
  }, [stopStream]);

  const retake = useCallback(() => {
    clearPreview();
    void startCamera();
  }, [clearPreview, startCamera]);

  const save = useCallback(async () => {
    const file = fileRef.current;
    if (!file) return;
    setSaving(true);
    try {
      await onCapture(file);
      toast.success("Photo added", { description: "Saved to Unassigned Documents." });
      closeAll();
    } catch {
      toast.error("Save failed", { description: "Photo could not be saved. Try again." });
      setSaving(false);
    }
  }, [onCapture, closeAll]);

  const onNativePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStage("review");
    void compressPickedImage(file).then((compressed) => {
      fileRef.current = compressed;
      setPreviewUrl(URL.createObjectURL(compressed));
    });
  }, []);

  return (
    <>
      {/* Camera viewfinder / review overlay — fullscreen, fixed. */}
      {stage !== "idle" && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <span className="text-sm font-semibold">
              {stage === "review" ? "Review scan" : "Scan document"}
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

          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {stage === "starting" && <Loader2 className="h-8 w-8 animate-spin text-white" />}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={stage === "live" ? "h-full w-full object-contain" : "hidden"}
            />
            {stage === "review" && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Scanned document preview" className="h-full w-full object-contain" />
            )}
          </div>

          <div className="flex items-center justify-center gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
            {stage === "live" && (
              <Button
                type="button"
                onClick={() => void shoot()}
                className="h-16 w-16 rounded-full border-4 border-white bg-white/25 hover:bg-white/35"
                aria-label="Take photo"
              />
            )}
            {stage === "review" && (
              <>
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
              </>
            )}
          </div>
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
