"use client";
/**
 * AI OCR (Gemini) client for the Pocket Ledger Server hooks (pb_hooks/lib/ocr_cloud.js, OCR-owned):
 * - GET    /api/ocr-cloud/ai-status?company=
 * - POST   /api/ocr-cloud/ai-key      { provider: "gemini", key, model? }   (admin; key sent once, never stored here)
 * - DELETE /api/ocr-cloud/ai-key      { provider: "gemini" }
 * - POST   /api/ocr-cloud/ai-read     { company, provider, imageBase64, mimeType, ownCompany, hint? }
 * Uses the signed-in PocketBase session (`pbRequest`). Does not touch `@/lib/ocrCloudApi` (owned by another bot).
 * The server never returns the key; error texts from the server never contain it.
 */
import { useCallback, useEffect, useState } from "react";
import { PocketBaseNotSignedInError, PocketBaseRequestError, pbRequest } from "@/lib/pocketbaseData/pbClient";
import { normalizeAiVoucher, type OcrAiResult } from "./aiVoucher";

export type OcrAiProvider = "gemini";
export type OcrAiErrorCode = "disabled" | "no_key" | "forbidden" | "quota" | "network" | "not_signed_in" | "timeout" | "unknown";

export class OcrAiError extends Error {
  code: OcrAiErrorCode;
  status: number;
  constructor(code: OcrAiErrorCode, message: string, status = 0) {
    super(message);
    this.name = "OcrAiError";
    this.code = code;
    this.status = status;
  }
}

export type OcrAiStatus = {
  provider: OcrAiProvider;
  /** Server has the user_ai_keys collection (migration 1763800000 applied). */
  aiReady: boolean;
  serverOcrEnabled: boolean;
  isAdmin: boolean;
  companyEnabled: boolean;
  /** Admin only: this admin saved a Gemini key. */
  hasKey: boolean;
  keyLast4?: string;
  model?: string;
  /** Admin only: some admin of this company has a Gemini key (the one the company uses). */
  companyHasKey?: boolean;
  canUse: boolean;
};

export const OCR_AI_OFF: OcrAiStatus = { provider: "gemini", aiReady: false, serverOcrEnabled: false, isAdmin: false, companyEnabled: false, hasKey: false, canUse: false };

const AI_READ_TIMEOUT_MS = 95_000;

function serverCode(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as { code?: unknown; data?: { code?: unknown } };
  if (typeof d.code === "string") return d.code;
  if (d.data && typeof d.data.code === "string") return d.data.code;
  return "";
}

function toAiError(e: unknown): OcrAiError {
  if (e instanceof OcrAiError) return e;
  if (e instanceof PocketBaseNotSignedInError) return new OcrAiError("not_signed_in", "Not signed in to Pocket Ledger Server", 401);
  if (e instanceof PocketBaseRequestError) {
    const c = serverCode(e.data);
    if (c === "disabled" || c === "no_key" || c === "forbidden" || c === "quota" || c === "network") return new OcrAiError(c, e.message, e.status);
    if (e.status === 401) return new OcrAiError("not_signed_in", e.message, e.status);
    if (e.status === 403) return new OcrAiError("forbidden", e.message, e.status);
    if (e.status === 429) return new OcrAiError("quota", e.message, e.status);
    if (e.status === 404) return new OcrAiError("network", "AI OCR is not installed on the server yet", e.status);
    if (e.status === 0 || e.status >= 502) return new OcrAiError("network", e.message, e.status);
    return new OcrAiError("unknown", e.message, e.status);
  }
  const msg = e instanceof Error ? e.message : "Request failed";
  if (/timeout|timed out|abort/i.test(msg)) return new OcrAiError("timeout", "AI OCR timed out");
  return new OcrAiError("network", msg);
}

async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  try {
    return (await pbRequest(path, init)) as T;
  } catch (e) {
    throw toAiError(e);
  }
}

const b = (v: unknown) => v === true;

export function normalizeAiStatus(raw: unknown): OcrAiStatus {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: OcrAiStatus = {
    provider: "gemini",
    aiReady: b(o.aiReady),
    serverOcrEnabled: b(o.serverOcrEnabled),
    isAdmin: b(o.isAdmin),
    companyEnabled: b(o.companyEnabled),
    hasKey: b(o.hasKey),
    canUse: b(o.canUse),
  };
  if (typeof o.keyLast4 === "string" && o.keyLast4) out.keyLast4 = o.keyLast4;
  if (typeof o.model === "string" && o.model) out.model = o.model;
  if (typeof o.companyHasKey === "boolean") out.companyHasKey = o.companyHasKey;
  return out;
}

export async function getOcrAiStatus(companyId: string): Promise<OcrAiStatus> {
  return normalizeAiStatus(await call<unknown>(`/api/ocr-cloud/ai-status?company=${encodeURIComponent(companyId)}`, { method: "GET" }));
}

const STATUS_TTL_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<OcrAiStatus> }>();
const subs = new Set<() => void>();

export function invalidateOcrAiStatus(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
  subs.forEach((f) => f());
}

/** Cached AI status (60 s). Throws on error (the engine then falls back and records why). */
export function getOcrAiStatusCached(companyId: string, opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<OcrAiStatus> {
  const hit = cache.get(companyId);
  if (!opts.fresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.p;
  const p = (async () => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        getOcrAiStatus(companyId),
        new Promise<OcrAiStatus>((_, rej) => { t = setTimeout(() => rej(new OcrAiError("timeout", "AI status timed out")), opts.timeoutMs ?? 6000); }),
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
  })().catch((e) => {
    cache.delete(companyId);
    throw toAiError(e);
  });
  cache.set(companyId, { at: Date.now(), p });
  return p;
}

/** Plausible Gemini key (only enables the Save button; the server tests the real key). Classic AIza… or new AQ.… */
export function looksLikeGeminiKeyInput(key: string): boolean {
  const k = String(key || "").trim();
  return /^AIza[0-9A-Za-z_-]{35}$/.test(k) || /^AQ\.[A-Za-z0-9_.-]{20,512}$/.test(k) || /^[A-Za-z0-9_.-]{20,512}$/.test(k);
}

export async function saveOcrAiKey(key: string, opts: { model?: string } = {}): Promise<{ last4?: string; model?: string }> {
  const k = String(key || "").trim();
  if (!k) throw new OcrAiError("no_key", "Key is empty");
  const body: Record<string, unknown> = { provider: "gemini", key: k };
  if (opts.model && opts.model.trim()) body.model = opts.model.trim();
  const r = await call<{ last4?: string; model?: string }>("/api/ocr-cloud/ai-key", { method: "POST", body, timeoutMs: 30_000 });
  invalidateOcrAiStatus();
  return { last4: r?.last4, model: r?.model };
}

export async function deleteOcrAiKey(): Promise<void> {
  await call<unknown>("/api/ocr-cloud/ai-key", { method: "DELETE", body: { provider: "gemini" } });
  invalidateOcrAiStatus();
}

export type OcrAiReadInput = {
  companyId: string;
  imageBase64: string;
  mimeType: string;
  ownCompany?: { name?: string | null; pan?: string | null };
  /** Extra per-document-type rules (phase 3: taught rules). */
  hint?: string;
  signal?: AbortSignal;
};

/** Ask the server to read the document with Gemini. Returns the normalized voucher JSON + token usage. */
export async function ocrAiRead(input: OcrAiReadInput): Promise<OcrAiResult> {
  const body: Record<string, unknown> = {
    company: input.companyId,
    provider: "gemini",
    imageBase64: String(input.imageBase64 || "").replace(/^data:[^;,]*;base64,/, ""),
    mimeType: input.mimeType,
  };
  if (input.ownCompany) body.ownCompany = { name: input.ownCompany.name ?? "", pan: input.ownCompany.pan ?? "" };
  if (input.hint) body.hint = input.hint;
  const raw = await call<Record<string, unknown>>("/api/ocr-cloud/ai-read", { method: "POST", body, timeoutMs: AI_READ_TIMEOUT_MS, signal: input.signal });
  const u = (raw?.usage && typeof raw.usage === "object" ? raw.usage : {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  if (!raw?.data || typeof raw.data !== "object") throw new OcrAiError("network", "AI answer was empty");
  return {
    provider: "gemini",
    model: typeof raw.model === "string" ? raw.model : "",
    data: normalizeAiVoucher(raw.data),
    usage: { promptTokens: n(u.promptTokens), outputTokens: n(u.outputTokens), thoughtsTokens: n(u.thoughtsTokens), totalTokens: n(u.totalTokens) },
  };
}

export function ocrAiErrorText(e: unknown): string {
  const err = toAiError(e);
  switch (err.code) {
    case "disabled": return "Online / AI OCR is turned off on the server or for this company.";
    case "forbidden": return "You do not have permission for this.";
    case "not_signed_in": return "Sign in to Pocket Ledger Server first.";
    case "timeout": return "AI OCR timed out.";
    default: return err.message || "Something went wrong.";
  }
}

export function ocrAiErrorCode(e: unknown): OcrAiErrorCode {
  return toAiError(e).code;
}

/** Settings dialog: live AI status for one company. setState only in async callbacks (react-hooks/set-state-in-effect). */
export function useOcrAiStatus(companyId: string | null | undefined, enabled = true) {
  const [state, setState] = useState<{ key: string; status: OcrAiStatus | null; error: string | null }>({ key: "", status: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => { if (companyId) invalidateOcrAiStatus(companyId); else setTick((x) => x + 1); }, [companyId]);
  useEffect(() => {
    const f = () => setTick((x) => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  useEffect(() => {
    if (!enabled || !companyId) return;
    let alive = true;
    getOcrAiStatusCached(companyId, { timeoutMs: 10000 })
      .then((s) => { if (alive) setState({ key: companyId, status: s, error: null }); })
      .catch((e) => { if (alive) setState({ key: companyId, status: null, error: ocrAiErrorText(e) }); });
    return () => { alive = false; };
  }, [companyId, enabled, tick]);
  const live = !!(enabled && companyId && state.key === companyId);
  return { status: live ? state.status : null, error: live ? state.error : null, reload };
}
