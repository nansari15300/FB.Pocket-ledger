/**
 * When Select Runner is not Manual, a user-started OCR run on a hand-opened
 * voucher is gated until the user switches to Manual Runner.
 *
 * A voucher opened by the Gallery Semi Automatic / Full Auto Post runner
 * (paused or in review) is never gated: Resume, Stop, Skip and Refresh OCR
 * keep working.
 */
import {
  activeRunnerFromSettings,
  runnerModePersistFields,
  withExclusiveRunnerProfiles,
  type AutoPostMode,
} from "@/components/gallery/autoPostMode";

export type { AutoPostMode };

export type ManualOcrGateMode = "semi" | "full";

/** Semi Automatic or Full Auto Post — the modes that gate a manual OCR run. */
export function isNonManualRunnerMode(value: unknown): value is ManualOcrGateMode {
  return value === "semi" || value === "full";
}

/**
 * Gate Refresh OCR (and any other manual OCR-run action) only when:
 * - the selected runner is Semi Automatic or Full Auto Post, and
 * - this voucher was not opened by that runner (`runnerJob`).
 *
 * Unknown / missing modes are treated as Manual (do not block).
 */
export function shouldGateManualOcrAction(opts: {
  runnerMode: unknown;
  runnerOpenedVoucher: boolean;
}): boolean {
  if (opts.runnerOpenedVoucher) return false;
  return isNonManualRunnerMode(opts.runnerMode);
}

/** Resolve a stored settings snapshot (or a bare mode string) to the active runner. */
export function runnerModeFromSettings(raw: unknown): AutoPostMode {
  if (raw === "manual" || raw === "semi" || raw === "full") return raw;
  return activeRunnerFromSettings(raw);
}

/**
 * Patch written to companies/{id}/auto_ocr_settings/server_auto_ocr so Select Runner
 * and the gallery ribbon stay exclusive: only Manual Runner is on.
 */
export function buildSwitchToManualPatch(savedSettings: unknown): Record<string, unknown> {
  const value = savedSettings && typeof savedSettings === "object" ? savedSettings as Record<string, unknown> : {};
  const profiles = value.runnerProfiles && typeof value.runnerProfiles === "object"
    ? value.runnerProfiles as Record<string, unknown>
    : {};
  const profile = profiles.manual && typeof profiles.manual === "object"
    ? profiles.manual as Record<string, unknown>
    : value;
  return {
    ...profile,
    ...runnerModePersistFields("manual"),
    runnerProfiles: withExclusiveRunnerProfiles(profiles, "manual"),
  };
}
