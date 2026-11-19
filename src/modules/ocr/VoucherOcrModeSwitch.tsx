"use client";

/**
 * New Trxn header OCR mode control.
 * - OCR off: a small on/off switch only (other positions hidden).
 * - OCR on: one pill with a 4-position slider — Off, Manual, Semi, Full Auto.
 * Visual treatment follows the gallery Auto post ribbon slider.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX,
  SWITCH_ANIM_MS,
  SWITCH_KNOB_PAD_PX,
  SWITCH_KNOB_W_PX,
} from "@/lib/switchMotion";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import {
  VOUCHER_OCR_DIALOG_MODE_INDEX,
  VOUCHER_OCR_DIALOG_MODES,
  voucherOcrHoverLabelPosition,
  type AutoPostMode,
  type VoucherOcrDialogMode,
} from "./voucherOcrDialogMode";
import {
  voucherOcrModeFull,
  voucherOcrModeOffPill,
  voucherOcrModeOffTitle,
  voucherOcrModeOnTitle,
  voucherOcrModeShort,
  voucherOcrModeSliderAria,
} from "./voucherOcrDialogModeIntro";
import { manualOcrRunnerGateAdmin } from "./manualOcrRunnerGateIntro";

const TRACK_HEIGHT = HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX;
/** Mobile keeps 16.5rem; PC/desktop (md+) is 25% longer: 16.5 * 1.25 = 20.625rem. */
const TRACK_WIDTH_CLASS = "w-[16.5rem] min-w-[16.5rem] md:w-[20.625rem] md:min-w-[20.625rem]";
const MODE_COUNT = VOUCHER_OCR_DIALOG_MODES.length;

function knobLeft(mode: VoucherOcrDialogMode): string {
  const index = VOUCHER_OCR_DIALOG_MODE_INDEX[mode];
  if (index === 0) return `${SWITCH_KNOB_PAD_PX}px`;
  if (index === MODE_COUNT - 1) return `calc(100% - ${SWITCH_KNOB_W_PX + SWITCH_KNOB_PAD_PX}px)`;
  return `calc(${((index + 0.5) / MODE_COUNT) * 100}% - ${SWITCH_KNOB_W_PX / 2}px)`;
}

function modeAtTrackIndex(index: number): VoucherOcrDialogMode {
  return VOUCHER_OCR_DIALOG_MODES[Math.min(MODE_COUNT - 1, Math.max(0, index))] ?? "off";
}

export function VoucherOcrModeSwitch({
  mode,
  collapsed,
  restoreMode,
  onModeChange,
  runnerPositionsDisabled = false,
  disabled = false,
  className,
}: {
  mode: VoucherOcrDialogMode;
  /** When OCR is off, hide the long slider and show a small on/off switch. */
  collapsed?: boolean;
  /** Runner to restore when the collapsed switch is turned on. */
  restoreMode?: AutoPostMode;
  onModeChange: (mode: VoucherOcrDialogMode) => void;
  /** Non-admin: Manual / Semi / Full Auto cannot be changed (Off/on still works). */
  runnerPositionsDisabled?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const i18n = usePlI18nOptional();
  const lang = introTabLang(i18n?.intro);
  const [hoveredMode, setHoveredMode] = React.useState<VoucherOcrDialogMode | null>(null);
  const [tipPos, setTipPos] = React.useState<{ left: number; top: number } | null>(null);
  const turnOnMode: AutoPostMode = restoreMode === "semi" || restoreMode === "full" ? restoreMode : "manual";

  if (collapsed || mode === "off") {
    return (
      <label
        htmlFor="pl-ocr-dialog-mode"
        title={voucherOcrModeOffTitle(lang)}
        data-pl-ocr-dialog-mode="off"
        className={cn(
          "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-400/50 bg-white/70 px-2 text-xs font-medium text-slate-800 dark:bg-slate-900/60 dark:text-slate-100",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <span className="whitespace-nowrap">{voucherOcrModeOffPill(lang)}</span>
        <Switch
          id="pl-ocr-dialog-mode"
          checked={false}
          disabled={disabled}
          onCheckedChange={(value) => { if (value === true) onModeChange(turnOnMode); }}
          className="scale-75"
        />
      </label>
    );
  }

  const choose = (next: VoucherOcrDialogMode) => {
    if (disabled || next === mode) return;
    if (runnerPositionsDisabled && next !== "off") return;
    onModeChange(next);
  };

  const chooseFromTrack = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    choose(modeAtTrackIndex(Math.floor(((event.clientX - rect.left) / rect.width) * MODE_COUNT)));
  };

  const updateHoveredMode = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = modeAtTrackIndex(Math.floor(((event.clientX - rect.left) / rect.width) * MODE_COUNT));
    setHoveredMode(next);
    setTipPos(voucherOcrHoverLabelPosition(rect, next));
  };

  const runnerLocked = runnerPositionsDisabled;
  const adminNote = runnerLocked ? manualOcrRunnerGateAdmin(lang) : "";
  const aria = voucherOcrModeSliderAria(lang);

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 flex-col items-stretch rounded-full border border-slate-400/50 bg-white/70 px-2 py-1 dark:border-slate-500/50 dark:bg-slate-900/60",
        className,
      )}
      data-pl-ocr-dialog-mode={mode}
      title={voucherOcrModeOnTitle(lang)}
    >
      <button
        type="button"
        role="radiogroup"
        aria-label={aria}
        title={runnerLocked ? `${aria}. ${adminNote}` : aria}
        aria-disabled={disabled}
        onClick={chooseFromTrack}
        onPointerMove={updateHoveredMode}
        onPointerLeave={() => { setHoveredMode(null); setTipPos(null); }}
        data-pl-ocr-dialog-mode-track=""
        className={cn(
          "relative block h-full cursor-pointer rounded-full border shadow-sm outline-none transition-colors",
          "border-blue-300 bg-green-50",
          mode !== "manual" && "border-blue-400 bg-green-100",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "dark:border-blue-500 dark:bg-green-950/35",
          mode !== "manual" && "dark:border-blue-400 dark:bg-green-900/45",
          disabled && "cursor-not-allowed opacity-60",
          TRACK_WIDTH_CLASS,
        )}
        style={{ height: TRACK_HEIGHT }}
      >
        {VOUCHER_OCR_DIALOG_MODES.map((value) => (
          <span key={value} className="sr-only" role="radio" aria-checked={mode === value} aria-label={voucherOcrModeFull(lang, value)} />
        ))}
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-[1] h-[calc(100%-6px)] -translate-y-1/2 rounded-full shadow-sm transition-[left] ease-out",
            mode === "manual" ? "bg-neutral-500 dark:bg-neutral-400" : "bg-green-400",
          )}
          style={{ left: knobLeft(mode), width: SWITCH_KNOB_W_PX, transitionDuration: `${SWITCH_ANIM_MS}ms` }}
          aria-hidden
        />
        <span className="pointer-events-none absolute inset-y-1 left-1/4 w-px bg-black/10" aria-hidden />
        <span className="pointer-events-none absolute inset-y-1 left-2/4 w-px bg-black/10" aria-hidden />
        <span className="pointer-events-none absolute inset-y-1 left-3/4 w-px bg-black/10" aria-hidden />
      </button>
      <div className={cn("mt-0.5 grid grid-cols-4", TRACK_WIDTH_CLASS)}>
        {VOUCHER_OCR_DIALOG_MODES.map((value) => {
          const locked = value !== "off" && runnerLocked;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled || locked}
              title={locked ? adminNote : voucherOcrModeFull(lang, value)}
              aria-label={voucherOcrModeFull(lang, value)}
              aria-pressed={mode === value}
              onClick={() => choose(value)}
              className={cn(
                "truncate px-0.5 text-center text-[9px] leading-tight text-blue-900 dark:text-blue-100",
                mode === value ? "font-semibold" : "font-medium opacity-60",
                (disabled || locked) && "cursor-not-allowed",
              )}
            >
              {voucherOcrModeShort(lang, value)}
            </button>
          );
        })}
      </div>
      {hoveredMode && tipPos && typeof document !== "undefined" ? createPortal(
        <span
          role="tooltip"
          data-pl-ocr-dialog-mode-tooltip=""
          className="pointer-events-none fixed z-[4000] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border border-blue-300 bg-white px-2 py-1 text-[10px] font-semibold leading-none text-blue-900 shadow-md dark:border-blue-400 dark:bg-slate-900 dark:text-blue-100"
          style={{ left: tipPos.left, top: tipPos.top }}
        >
          {runnerPositionsDisabled && hoveredMode !== "off" ? manualOcrRunnerGateAdmin(lang) : voucherOcrModeFull(lang, hoveredMode)}
        </span>,
        document.body,
      ) : null}
    </div>
  );
}
