/**
 * New Trxn voucher-dialog OCR mode pill.
 *
 * Four positions (left to right): Off, Manual, Semi, Full Auto.
 * - Off = voucher-dialog OCR pref off (`setOcrPrefs({ enabled: false })`).
 *   The selected runner is not changed, so turning OCR back on restores it.
 * - Manual / Semi / Full Auto = OCR pref on, and the selected runner
 *   (same `server_auto_ocr` doc as Voucher Post Setting → Select Runner,
 *   the gallery ribbon, and the Manual OCR runner gate).
 *
 * When the dialog is Off, the UI collapses to a small on/off switch.
 * Turning that switch on restores the four-position slider at the last
 * selected runner mode.
 */
import type { AutoPostMode } from "@/components/gallery/autoPostMode";
import { runnerModeFromSettings } from "./manualOcrRunnerGate";

export type { AutoPostMode };

export const VOUCHER_OCR_DIALOG_MODES = ["off", "manual", "semi", "full"] as const;
export type VoucherOcrDialogMode = (typeof VOUCHER_OCR_DIALOG_MODES)[number];

export const VOUCHER_OCR_DIALOG_MODE_INDEX: Record<VoucherOcrDialogMode, 0 | 1 | 2 | 3> = {
  off: 0,
  manual: 1,
  semi: 2,
  full: 3,
};

export function isVoucherOcrDialogMode(value: unknown): value is VoucherOcrDialogMode {
  return value === "off" || value === "manual" || value === "semi" || value === "full";
}

/** Visible slider position from the OCR pref and the selected runner. */
export function dialogModeFromState(opts: {
  ocrEnabled: boolean;
  runnerMode: AutoPostMode;
}): VoucherOcrDialogMode {
  if (!opts.ocrEnabled) return "off";
  return opts.runnerMode;
}

/**
 * Turning the collapsed Off switch on restores this runner (unchanged).
 * The four-position slider then opens on this mode, not on Off.
 */
export function runnerModeAfterOcrOn(runnerMode: AutoPostMode): AutoPostMode {
  return runnerMode === "semi" || runnerMode === "full" ? runnerMode : "manual";
}

/** What the OCR pref and selected runner become after a pill click. */
export function applyDialogModeChoice(opts: {
  next: VoucherOcrDialogMode;
  runnerMode: AutoPostMode;
}): { ocrEnabled: boolean; runnerMode: AutoPostMode; runnerModeChanged: boolean } {
  if (opts.next === "off") {
    return { ocrEnabled: false, runnerMode: opts.runnerMode, runnerModeChanged: false };
  }
  return {
    ocrEnabled: true,
    runnerMode: opts.next,
    runnerModeChanged: opts.next !== opts.runnerMode,
  };
}

/**
 * Off (and turning OCR back on to the already-selected runner) is allowed
 * for every user who can use the voucher OCR pill. Changing Manual / Semi /
 * Full Auto requires a company admin, same as the gallery ribbon.
 */
export function canSelectDialogMode(opts: {
  next: VoucherOcrDialogMode;
  runnerMode: AutoPostMode;
  isCompanyAdmin: boolean;
}): boolean {
  if (opts.next === "off") return true;
  if (opts.next === opts.runnerMode) return true;
  return opts.isCompanyAdmin === true;
}

/** Profile row for one Select Runner mode, falling back to the top-level settings. */
export function runnerProfileForMode(savedSettings: unknown, mode: AutoPostMode): Record<string, unknown> {
  const value = savedSettings && typeof savedSettings === "object" ? savedSettings as Record<string, unknown> : {};
  const profiles = value.runnerProfiles && typeof value.runnerProfiles === "object"
    ? value.runnerProfiles as Record<string, unknown>
    : {};
  const profile = profiles[mode] && typeof profiles[mode] === "object"
    ? profiles[mode] as Record<string, unknown>
    : value;
  return profile;
}

/**
 * Semi / Full Auto Post on a Local PC runner need a selected admin device,
 * same check as the gallery ribbon slider.
 */
export function runnerNeedsLocalDevice(profile: unknown, mode: AutoPostMode): boolean {
  if (mode === "manual") return false;
  const value = profile && typeof profile === "object" ? profile as Record<string, unknown> : {};
  return value.runLocation === "local-pc" && (!value.localRunnerUid || !value.localRunnerDeviceId);
}

/** Resolve a settings snapshot (or a bare mode string) to the active runner. */
export function dialogRunnerModeFromSettings(raw: unknown): AutoPostMode {
  return runnerModeFromSettings(raw);
}
/** Viewport (fixed) position for the hover label above a track segment, so it can be portaled. */
export function voucherOcrHoverLabelPosition(
  rect: { left: number; top: number; width: number },
  mode: VoucherOcrDialogMode,
  gapPx = 8,
): { left: number; top: number } {
  const index = VOUCHER_OCR_DIALOG_MODE_INDEX[mode];
  return {
    left: rect.left + ((index + 0.5) / VOUCHER_OCR_DIALOG_MODES.length) * rect.width,
    top: rect.top - gapPx,
  };
}
