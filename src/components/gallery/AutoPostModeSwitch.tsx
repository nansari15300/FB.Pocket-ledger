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
import { AUTO_POST_MODE_INDEX, AUTO_POST_MODES, type AutoPostMode } from "@/components/gallery/autoPostMode";
import { AUTO_POST_UI, useAutoPostUiCopy } from "@/components/gallery/autoPostUiCopy";

export type { AutoPostMode };

const PREVIEW_MODE: Record<AutoPostMode, "off" | "hover" | "click"> = { manual: "off", semi: "hover", full: "click" };
const TRACK_HEIGHT = HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX;
const TRACK_WIDTH_CLASS = "w-[12.5rem] min-w-[12.5rem]";

function knobLeft(mode: AutoPostMode) {
  if (mode === "manual") return SWITCH_KNOB_LEFT_OFF;
  if (mode === "semi") return SWITCH_KNOB_LEFT_MID;
  return SWITCH_KNOB_LEFT_ON;
}

function modeAtTrackIndex(index: number): AutoPostMode {
  return AUTO_POST_MODES[Math.min(2, Math.max(0, index))] ?? "manual";
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
  const { t } = useAutoPostUiCopy();
  const shortLabel: Record<AutoPostMode, string> = {
    manual: t(AUTO_POST_UI.modeManual),
    semi: t(AUTO_POST_UI.modeSemi),
    full: t(AUTO_POST_UI.modeFull),
  };
  const fullLabel: Record<AutoPostMode, string> = {
    manual: t(AUTO_POST_UI.modeManualRunner),
    semi: t(AUTO_POST_UI.modeSemiAutomatic),
    full: t(AUTO_POST_UI.modeFullAutoPost),
  };
  const [knobMotion, setKnobMotion] = React.useState<SwitchKnobMotion | null>(null);
  const [hoveredMode, setHoveredMode] = React.useState<AutoPostMode | null>(null);
  const motionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousIndexRef = React.useRef(AUTO_POST_MODE_INDEX[mode]);

  React.useEffect(() => {
    const nextIndex = AUTO_POST_MODE_INDEX[mode];
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
    const next = modeAtTrackIndex(Math.floor(((event.clientX - rect.left) / rect.width) * 3));
    if (next !== mode) onModeChange(next);
  };

  const updateHoveredMode = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredMode(modeAtTrackIndex(Math.floor(((event.clientX - rect.left) / rect.width) * 3)));
  };

  const activeDirection = knobMotion !== null && knobMotion !== "file-hover-switch-off" && knobMotion !== "file-hover-switch-to-off-from-mid";
  const previewMode = PREVIEW_MODE[mode];

  return (
    <div className={cn("relative inline-flex shrink-0 flex-col items-stretch", className)}>
      <button
        type="button"
        role="radiogroup"
        aria-label={t(AUTO_POST_UI.modeSliderAria)}
        title={t(AUTO_POST_UI.modeSliderAria)}
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
        {AUTO_POST_MODES.map((value) => (
          <span key={value} className="sr-only" role="radio" aria-checked={mode === value} aria-label={fullLabel[value]} />
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
      {showLabels ? (
        <div className={cn("mt-0.5 grid grid-cols-3", TRACK_WIDTH_CLASS)} aria-hidden={false}>
          {AUTO_POST_MODES.map((value) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              title={fullLabel[value]}
              aria-label={fullLabel[value]}
              aria-pressed={mode === value}
              onClick={() => { if (!disabled && value !== mode) onModeChange(value); }}
              className={cn(
                "truncate px-0.5 text-center text-[9px] leading-tight text-blue-900 dark:text-blue-100",
                mode === value ? "font-semibold" : "font-medium opacity-60",
                disabled && "cursor-not-allowed"
              )}
            >
              {shortLabel[value]}
            </button>
          ))}
        </div>
      ) : null}
      {showLabels && hoveredMode ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-blue-300 bg-white px-2 py-1 text-[10px] font-semibold leading-none text-blue-900 shadow-md"
          style={{ left: `${((AUTO_POST_MODE_INDEX[hoveredMode] + 0.5) / 3) * 100}%`, top: "-1.15rem" }}
        >
          {fullLabel[hoveredMode]}
        </span>
      ) : null}
    </div>
  );
}
