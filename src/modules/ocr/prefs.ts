"use client";
/** Device-local OCR toggles (Add Voucher header). */
import { useSyncExternalStore } from "react";

export type OcrConnectorStyle = "tail" | "line";
export type OcrNarrationStyle = "full" | "short";
/** auto = online OCR when allowed, else tesseract; offline = tesseract only; online = cloud only (no tesseract fallback). */
export type OcrEnginePref = "auto" | "offline" | "online";
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
};
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
const DEFAULTS: OcrPrefs = { enabled: true, autoPost: false, overwriteEdited: false, autoPostSeconds: 10, autoSwitchVoucher: true, autoSwitchSeconds: 10, connectorStyle: "tail", narrationStyle: "full", engine: "auto" };
const subs = new Set<() => void>();
let cache: OcrPrefs | null = null;

function normalize(raw: Partial<OcrPrefs> | null | undefined): OcrPrefs {
  return {
    ...DEFAULTS,
    ...(raw ?? {}),
    connectorStyle: raw?.connectorStyle === "line" ? "line" : "tail",
    narrationStyle: raw?.narrationStyle === "short" ? "short" : "full",
    engine: raw?.engine === "offline" || raw?.engine === "online" ? raw.engine : "auto",
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
