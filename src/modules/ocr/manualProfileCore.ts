/**
 * Manual Runner profile → settings for vouchers opened by hand (Decision 2, 2026-11-18).
 * Pure (no Firebase / PocketBase imports) so tests/ocr can run it directly.
 * Source: companies/{fsId}/auto_ocr_settings/server_auto_ocr → runnerProfiles.manual (falls back to top level
 * fields written before runner profiles existed).
 */
import type { OcrEnginePref, OcrOnlineProvider } from "./prefs";

export type ManualScanEngine = "gemini" | "google" | "azure" | "auto";
export type ManualRuleAction = "fail-and-continue" | "pause-and-hold" | "save-without";

export type ManualOcrProfile = {
  scanEngine: ManualScanEngine;
  enginePref: OcrEnginePref;
  cloudProvider: OcrOnlineProvider;
  autoPost: boolean;
  autoPostSeconds: number;
  overwriteEdited: boolean;
  /** missingFieldRules.item of the Manual Runner profile. */
  itemRule: ManualRuleAction;
  /** true once read from the company settings doc (false = defaults). */
  loaded: boolean;
};

export const DEFAULT_MANUAL_OCR_PROFILE: ManualOcrProfile = {
  scanEngine: "auto",
  enginePref: "auto",
  cloudProvider: "",
  autoPost: false,
  autoPostSeconds: 10,
  overwriteEdited: false,
  itemRule: "save-without",
  loaded: false,
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function scanEngineToEnginePref(engine: ManualScanEngine): { enginePref: OcrEnginePref; cloudProvider: OcrOnlineProvider } {
  if (engine === "gemini") return { enginePref: "ai", cloudProvider: "" };
  if (engine === "google" || engine === "azure") return { enginePref: "online", cloudProvider: engine };
  return { enginePref: "auto", cloudProvider: "" };
}

export function parseManualOcrProfile(settingsDoc: unknown): ManualOcrProfile {
  const raw = rec(settingsDoc);
  const profiles = rec(raw.runnerProfiles);
  const hasManual = !!profiles.manual && typeof profiles.manual === "object";
  const src = hasManual ? rec(profiles.manual) : raw;
  if (!hasManual && !Object.keys(raw).length) return { ...DEFAULT_MANUAL_OCR_PROFILE };
  const engine = src.scanEngine;
  const scanEngine: ManualScanEngine = engine === "gemini" || engine === "google" || engine === "azure" ? engine : "auto";
  const seconds = Math.round(Number(src.autoSaveSeconds));
  const item = rec(src.missingFieldRules).item;
  return {
    scanEngine,
    ...scanEngineToEnginePref(scanEngine),
    // Before runner profiles existed the manual default was Auto Post off.
    autoPost: hasManual && typeof src.autoSaveEnabled === "boolean" ? src.autoSaveEnabled : false,
    autoPostSeconds: Number.isFinite(seconds) && seconds >= 1 ? Math.min(60, seconds) : DEFAULT_MANUAL_OCR_PROFILE.autoPostSeconds,
    overwriteEdited: src.overwriteEdited === true,
    itemRule: item === "pause-and-hold" || item === "fail-and-continue" || item === "save-without" ? item : "save-without",
    loaded: true,
  };
}

/**
 * Auto Post decision for a voucher OCR save.
 * - Runner job: whatever the runner handed over (its profile), possibly overridden per call.
 * - Hand-opened voucher: an explicit `false` override wins, otherwise the Manual Runner profile.
 */
export function resolveVoucherAutoPost(opts: { runnerJob: boolean; override?: boolean | null; runnerAutoPost?: boolean | null; manual: Pick<ManualOcrProfile, "autoPost"> }): boolean {
  if (opts.runnerJob) return opts.override ?? opts.runnerAutoPost ?? false;
  if (opts.override === false) return false;
  return opts.manual.autoPost === true;
}
