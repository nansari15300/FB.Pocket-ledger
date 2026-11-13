"use client";
/** Device-local OCR toggles (Add Voucher header). */
import { useSyncExternalStore } from "react";

export type OcrConnectorStyle = "tail" | "line";
export type OcrNarrationStyle = "full" | "short";
/**
 * auto = online OCR when allowed, else tesseract (the ONLY setting that falls back);
 * offline = tesseract only; online = the picked cloud engine only; ai = Gemini only.
 * A single picked engine never silently switches to another one — its failure is shown as a reason dialog.
 */
export type OcrEnginePref = "auto" | "offline" | "online" | "ai";
export type OcrPrefs = {
  enabled: boolean;
  autoPost: boolean;
  overwriteEdited: boolean;
  /** Auto Post countdown (seconds) before saving. */
  autoPostSeconds: number;
  /** Auto voucher-type change countdown on/off + seconds. */
  autoSwitchVoucher: boolean;
  autoSwitchSeconds: number;
  /** Field-popup connector: speech-bubble tail (default) or straight arrow line. */
  connectorStyle: OcrConnectorStyle;
  /** Full narration includes item names; short is "Bill No … Pur from … on …". */
  narrationStyle: OcrNarrationStyle;
  /** OCR engine preference (default auto). */
  engine: OcrEnginePref;
  /** Last online provider picked in Switch Engine (Google / Azure each have their own key). "" = whichever key the server has. */
  onlineProvider: OcrOnlineProvider;
  /**
   * Bill ka script: auto (jaisa slip hai waisa padho), eng (sirf English — Devanagari pass band),
   * local (Devanagari/Nepali pass pehle). Language-mismatch bubble ka "Set as default" isi ko set karta hai.
   */
  scriptPref: OcrScriptPref;
  /**
   * Gemini/OCR ne local-language (Nepali/Hindi/Devanagari ya koi bhi non-English) text diya to use
   * English me translate karwao. Bubble ka "Translate to English" + "Set as default" isi ko on karta hai —
   * phir har slip ka item/party/narration English me aata hai.
   */
  translateToEnglish: boolean;
  /**
   * Live Pocket AI (split-view chat beside the voucher form).
   * OFF (default) = the existing OCR pipeline: read → detect → detect type → fill → bubbles.
   * ON = the OCR panel opens a docked chat next to the form. Gemini answers in chat with a JSON patch,
   * which is applied to the live form immediately, and can propose master creation for unmatched names.
   */
  aiCopilot: boolean;
};
export type OcrOnlineProvider = "google" | "azure" | "";
/** auto = detect per slip (default) | eng = force English | local = force Devanagari/Nepali. */
export type OcrScriptPref = "auto" | "eng" | "local";
export const AUTO_POST_SECONDS_MIN = 1;
export const AUTO_POST_SECONDS_MAX = 60;
export function clampAutoPostSeconds(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(AUTO_POST_SECONDS_MAX, Math.max(AUTO_POST_SECONDS_MIN, n)) : 10;
}
/**
 * Field bubbles / countdown pill layer. Above the voucher shell (z-81) and the nested dialogs
 * (z-90 … z-100) opened from it, but BELOW the OCR settings gear dialog (2147483000), so the
 * settings popup is never covered by a bubble or its tail line.
 */
export const OCR_LAYER_Z = 100;

const KEY = "pl.ocr.prefs.v1";
const DEFAULTS: OcrPrefs = { enabled: true, autoPost: false, overwriteEdited: false, autoPostSeconds: 10, autoSwitchVoucher: true, autoSwitchSeconds: 10, connectorStyle: "tail", narrationStyle: "full", engine: "auto", onlineProvider: "", scriptPref: "auto", translateToEnglish: false, aiCopilot: false };
const subs = new Set<() => void>();
let cache: OcrPrefs | null = null;

function normalize(raw: Partial<OcrPrefs> | null | undefined): OcrPrefs {
  return {
    ...DEFAULTS,
    ...(raw ?? {}),
    connectorStyle: raw?.connectorStyle === "line" ? "line" : "tail",
    narrationStyle: raw?.narrationStyle === "short" ? "short" : "full",
    engine: raw?.engine === "offline" || raw?.engine === "online" || raw?.engine === "ai" ? raw.engine : "auto",
    onlineProvider: raw?.onlineProvider === "google" || raw?.onlineProvider === "azure" ? raw.onlineProvider : "",
    scriptPref: raw?.scriptPref === "eng" || raw?.scriptPref === "local" ? raw.scriptPref : "auto",
    translateToEnglish: raw?.translateToEnglish === true,
    aiCopilot: raw?.aiCopilot === true,
  };
}

function load(): OcrPrefs {
  if (cache) return cache;
  try {
    cache = normalize(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<OcrPrefs>);
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function getOcrPrefs(): OcrPrefs {
  return typeof window === "undefined" ? DEFAULTS : load();
}

export function setOcrPrefs(patch: Partial<OcrPrefs>) {
  cache = normalize({ ...load(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export function useOcrPrefs(): OcrPrefs {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getOcrPrefs,
    () => DEFAULTS
  );
}

/**
 * "Reset" in OCR settings: script + translate preference ko default par wapas, baaki device prefs
 * untouched — warna user ka narration style, countdown, auto-post sab ek click me ud jata.
 * Returns the fresh prefs so callers can sync their local drafts.
 */
export function resetOcrLanguagePref(): OcrPrefs {
  setOcrPrefs({ scriptPref: "auto", translateToEnglish: false });
  return getOcrPrefs();
}

/** True when scriptPref explicitly forces a script (reset button is meaningful only then). */
export function isOcrScriptForced(prefs: OcrPrefs = getOcrPrefs()): boolean {
  return prefs.scriptPref === "eng" || prefs.scriptPref === "local";
}

/** True when the language prefs are anything but their defaults (Reset button enabled). */
export function isOcrLanguageCustomized(prefs: OcrPrefs = getOcrPrefs()): boolean {
  return prefs.scriptPref !== "auto" || prefs.translateToEnglish === true;
}
