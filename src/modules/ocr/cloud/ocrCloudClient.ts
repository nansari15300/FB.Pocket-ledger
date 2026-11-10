"use client";
/**
 * Thin OCR-side adapter over the server client `@/lib/ocrCloudApi` (owned by the server helpers - do not edit it here).
 * Adds: a short status cache for the engine, a React hook for the settings dialog, and friendly error text.
 * The Vision API key never reaches this module except as the admin's input to `saveKey` (sent once, not stored).
 */
import { useCallback, useEffect, useState } from "react";
import {
  deleteOcrCloudKey,
  getOcrCloudStatus,
  isOcrCloudError,
  ocrCloudVision,
  saveOcrCloudKey,
  setOcrCloudCompany,
  type OcrCloudCompanyOptions,
  type OcrCloudErrorCode,
  type OcrCloudStatus,
  type OcrCloudVisionResult,
} from "@/lib/ocrCloudApi";

export type { OcrCloudStatus, OcrCloudErrorCode, OcrCloudVisionResult };
export type { OcrCloudSharedUser } from "@/lib/ocrCloudApi";

export const OCR_CLOUD_OFF: OcrCloudStatus = { serverOcrEnabled: false, isAdmin: false, hasKey: false, companyEnabled: false, canUse: false };

const STATUS_TTL_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<OcrCloudStatus> }>();
const subs = new Set<() => void>();

export function invalidateOcrCloudStatus(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
  subs.forEach((f) => f());
}

/** Cached status (60 s). Never throws: any error = cloud OCR off (tesseract is used). */
export function getOcrCloudStatusCached(companyId: string, opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<OcrCloudStatus> {
  const hit = cache.get(companyId);
  if (!opts.fresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.p;
  const p = (async () => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        getOcrCloudStatus(companyId),
        new Promise<OcrCloudStatus>((_, rej) => { t = setTimeout(() => rej(new Error("status timeout")), opts.timeoutMs ?? 6000); }),
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
  })().catch((e) => {
    cache.delete(companyId);
    throw e;
  });
  cache.set(companyId, { at: Date.now(), p });
  return p;
}

export function ocrCloudErrorCode(e: unknown): OcrCloudErrorCode | "timeout" {
  if (isOcrCloudError(e)) return e.code;
  if (e instanceof Error && /timeout|timed out|abort/i.test(e.message)) return "timeout";
  return "unknown";
}

export function ocrCloudErrorText(e: unknown): string {
  switch (ocrCloudErrorCode(e)) {
    case "disabled": return "Online OCR is turned off on the server or for this company.";
    case "no_key": return "No Google Vision key is saved yet.";
    case "forbidden": return "You do not have permission for this.";
    case "quota": return "Google quota / billing limit reached.";
    case "network": return "Server or Google could not be reached.";
    case "not_signed_in": return "Sign in to Pocket Ledger Server first.";
    case "timeout": return "Timed out.";
    default: return e instanceof Error && e.message ? e.message : "Something went wrong.";
  }
}

export const ocrCloud = {
  vision: (companyId: string, imageBase64: string, opts?: { signal?: AbortSignal; languageHints?: string[] }) => ocrCloudVision(companyId, imageBase64, opts),
  async saveKey(key: string) { await saveOcrCloudKey(key); invalidateOcrCloudStatus(); },
  async deleteKey() { await deleteOcrCloudKey(); invalidateOcrCloudStatus(); },
  async setCompany(o: OcrCloudCompanyOptions) { await setOcrCloudCompany(o); invalidateOcrCloudStatus(o.company); },
};

/** Settings dialog: live status for one company (loading / error safe). */
export function useOcrCloudStatus(companyId: string | null | undefined, enabled = true) {
  const [status, setStatus] = useState<OcrCloudStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => { if (companyId) invalidateOcrCloudStatus(companyId); else setTick((x) => x + 1); }, [companyId]);
  useEffect(() => {
    const f = () => setTick((x) => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  useEffect(() => {
    if (!enabled || !companyId) { setStatus(null); return; }
    let alive = true;
    setLoading(true);
    getOcrCloudStatusCached(companyId, { timeoutMs: 10000 })
      .then((s) => { if (alive) { setStatus(s); setError(null); } })
      .catch((e) => { if (alive) { setStatus(null); setError(ocrCloudErrorText(e)); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [companyId, enabled, tick]);
  return { status, error, loading, reload };
}
