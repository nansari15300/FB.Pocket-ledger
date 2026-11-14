"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX,
  SWITCH_ANIM_MS,
  SWITCH_KNOB_LEFT_MID,
  SWITCH_KNOB_LEFT_OFF,
  SWITCH_KNOB_LEFT_ON,
  SWITCH_KNOB_W_PX,
  filePreviewModeTransitionMotion,
  switchKnobMotionClass,
  type SwitchKnobMotion,
} from "@/lib/switchMotion";

export type AutoPostMode = "manual" | "semi" | "full";

const MODE_INDEX: Record<AutoPostMode, number> = { manual: 0, semi: 1, full: 2 };
const PREVIEW_MODE: Record<AutoPostMode, "off" | "hover" | "click"> = { manual: "off", semi: "hover", full: "click" };
const MODE_LABEL: Record<AutoPostMode, string> = { manual: "Manual", semi: "Semi automatic", full: "Full automatic" };
const TRACK_HEIGHT = HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX;
const TRACK_WIDTH_CLASS = "w-[12.5rem] min-w-[12.5rem]";

function knobLeft(mode: AutoPostMode) {
  if (mode === "manual") return SWITCH_KNOB_LEFT_OFF;
  if (mode === "semi") return SWITCH_KNOB_LEFT_MID;
  return SWITCH_KNOB_LEFT_ON;
}

/** Three-position Auto post switch; shares the header preview switch keyframes and track treatment. */
export function AutoPostModeSwitch({
  mode,
  onModeChange,
  disabled = false,
  className,
  showLabels = true,
}: {
  mode: AutoPostMode;
  onModeChange: (mode: AutoPostMode) => void;
  disabled?: boolean;
  className?: string;
  showLabels?: boolean;
}) {
  const [knobMotion, setKnobMotion] = React.useState<SwitchKnobMotion | null>(null);
  const [hoveredMode, setHoveredMode] = React.useState<AutoPostMode | null>(null);
  const motionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousIndexRef = React.useRef(MODE_INDEX[mode]);

  React.useEffect(() => {
    const nextIndex = MODE_INDEX[mode];
    const previousIndex = previousIndexRef.current;
    previousIndexRef.current = nextIndex;
    if (nextIndex === previousIndex) return;
    const motion = filePreviewModeTransitionMotion(previousIndex, nextIndex);
    setKnobMotion(motion);
    if (motionTimerRef.current != null) clearTimeout(motionTimerRef.current);
    motionTimerRef.current = setTimeout(() => {
      setKnobMotion(null);
      motionTimerRef.current = null;
    }, SWITCH_ANIM_MS);
  }, [mode]);

  React.useEffect(() => () => {
    if (motionTimerRef.current != null) clearTimeout(motionTimerRef.current);
  }, []);

  const chooseFromTrack = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.min(2, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * 3)));
    const next = (Object.keys(MODE_INDEX) as AutoPostMode[]).find((key) => MODE_INDEX[key] === index);
    if (next && next !== mode) onModeChange(next);
  };

  const updateHoveredMode = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.min(2, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * 3)));
    setHoveredMode((Object.keys(MODE_INDEX) as AutoPostMode[]).find((key) => MODE_INDEX[key] === index) ?? null);
  };

  const activeDirection = knobMotion !== null && knobMotion !== "file-hover-switch-off" && knobMotion !== "file-hover-switch-to-off-from-mid";
  const previewMode = PREVIEW_MODE[mode];

  return (
    <div className={cn("relative inline-flex shrink-0 items-center", className)}>
      <button
        type="button"
        role="radiogroup"
        aria-label="Auto post mode: Manual, Semi, Full auto"
        aria-disabled={disabled}
        onClick={chooseFromTrack}
        onPointerMove={updateHoveredMode}
        onPointerLeave={() => setHoveredMode(null)}
        data-pl-header-preview-switch
        data-preview-mode={previewMode}
        className={cn(
          "relative block h-full cursor-pointer rounded-full border shadow-sm outline-none transition-colors",
          "border-blue-300 bg-green-50",
          mode !== "manual" && "border-blue-400 bg-green-100",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "dark:border-blue-500 dark:bg-green-950/35",
          mode !== "manual" && "dark:border-blue-400 dark:bg-green-900/45",
          disabled && "cursor-not-allowed opacity-60",
          TRACK_WIDTH_CLASS
        )}
        style={{ height: TRACK_HEIGHT }}
      >
        {(["manual", "semi", "full"] as const).map((value) => (
          <span key={value} className="sr-only" role="radio" aria-checked={mode === value} aria-label={MODE_LABEL[value]} />
        ))}
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-[1] h-[calc(100%-6px)] -translate-y-1/2 rounded-full shadow-sm",
            knobMotion === null && mode === "manual" && "bg-neutral-500 dark:bg-neutral-400",
            knobMotion === null && mode !== "manual" && "bg-green-400",
            knobMotion !== null && (activeDirection ? "bg-green-400" : "bg-neutral-500 dark:bg-neutral-400"),
            switchKnobMotionClass(knobMotion)
          )}
          style={knobMotion === null ? { left: knobLeft(mode), width: SWITCH_KNOB_W_PX } : undefined}
          aria-hidden
        />
        <span className="pointer-events-none absolute inset-y-1 left-1/3 w-px bg-black/10" aria-hidden />
        <span className="pointer-events-none absolute inset-y-1 left-2/3 w-px bg-black/10" aria-hidden />
      </button>
      {showLabels && hoveredMode ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-blue-300 bg-white px-2 py-1 text-[10px] font-semibold leading-none text-blue-900 shadow-md"
          style={{ left: `${((MODE_INDEX[hoveredMode] + 0.5) / 3) * 100}%`, top: "calc(50% - 14px)" }}
        >
          {MODE_LABEL[hoveredMode]}
        </span>
      ) : null}
    </div>
  );
}
