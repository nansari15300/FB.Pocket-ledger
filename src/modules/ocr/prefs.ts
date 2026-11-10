"use client";
/** Device-local OCR toggles (Add Voucher header). */
import { useSyncExternalStore } from "react";

export type OcrConnectorStyle = "tail" | "line";
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
};
export const AUTO_POST_SECONDS_MIN = 1;
export const AUTO_POST_SECONDS_MAX = 60;
export function clampAutoPostSeconds(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(AUTO_POST_SECONDS_MAX, Math.max(AUTO_POST_SECONDS_MIN, n)) : 10;
}
const KEY = "pl.ocr.prefs.v1";
const DEFAULTS: OcrPrefs = { enabled: true, autoPost: false, overwriteEdited: false, autoPostSeconds: 10, autoSwitchVoucher: true, autoSwitchSeconds: 10, connectorStyle: "tail" };
const subs = new Set<() => void>();
let cache: OcrPrefs | null = null;

function normalize(raw: Partial<OcrPrefs> | null | undefined): OcrPrefs {
  return {
    ...DEFAULTS,
    ...(raw ?? {}),
    connectorStyle: raw?.connectorStyle === "line" ? "line" : "tail",
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
