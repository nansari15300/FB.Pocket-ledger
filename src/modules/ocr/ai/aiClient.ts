"use client";
/**
 * AI OCR (Gemini) client for the Pocket Ledger Server hooks (pb_hooks/lib/ocr_cloud.js, OCR-owned):
 * - GET    /api/ocr-cloud/ai-status?company=
 * - POST   /api/ocr-cloud/ai-key      { provider: "gemini", key, model? }   (admin; key sent once, never stored here)
 * - DELETE /api/ocr-cloud/ai-key      { provider: "gemini" }
 * - POST   /api/ocr-cloud/ai-read     { company, provider, imageBase64, mimeType, ownCompany, hint?, docType? }
 * - POST   /api/ocr-cloud/ai-chat     { company, messages (last 12), docType?, imageBase64?, voucherJson? }  (AI chat / teaching)
 * - GET / POST / DELETE /api/ocr-cloud/ai-rules   taught rules (server folder outside pb_data; delete = soft remove)
 * Uses the signed-in PocketBase session (`pbRequest`). Does not touch `@/lib/ocrCloudApi` (owned by another bot).
 * The server never returns the key; error texts from the server never contain it.
 */
import { useCallback, useEffect, useState } from "react";
import { PocketBaseNotSignedInError, PocketBaseRequestError, pbRequest } from "@/lib/pocketbaseData/pbClient";
import { normalizeAiVoucher, type OcrAiResult } from "./aiVoucher";
import { normalizeProposedRule, normalizeRulesList, type OcrAiDocTypeKey, type OcrAiProposedRule, type OcrAiRulesList } from "./aiChatModel";

export type OcrAiProvider = "gemini";
export type OcrAiErrorCode = "disabled" | "no_key" | "forbidden" | "quota" | "network" | "not_signed_in" | "timeout" | "unknown";

export class OcrAiError extends Error {
  code: OcrAiErrorCode;
  status: number;
  /** Server's retry hint in seconds (quota window / Gemini overloaded). 0 = no hint. */
  retryAfter: number;
  constructor(code: OcrAiErrorCode, message: string, status = 0, retryAfter = 0) {
    super(message);
    this.name = "OcrAiError";
    this.code = code;
    this.status = status;
    this.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.round(retryAfter) : 0;
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
  /** Budget shown on the chat ribbon (server env; daily quota resets at 00:00 UTC). */
  limits?: OcrAiLimits;
  /** Model this company actually uses (visible to every member). */
  modelActive?: string;
  /** Models offered in the chat model picker. */
  models?: OcrAiModelOption[];
  /** Only an admin may switch the model. */
  canChangeModel?: boolean;
};

export type OcrAiModelOption = { id: string; label: string; note?: string };

export type OcrAiLimits = {
  requestsPerDay: number;
  tokensPerDay: number;
  ratePerMinUser: number;
  ratePerMinCompany: number;
  /** ISO instant of the next reset (UTC midnight). */
  resetAtUtc: string;
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
    /* Server sends retryAfter (seconds) with quota / overloaded failures. */
    const retry = readRetryAfter(e.data);
    if (c === "disabled" || c === "no_key" || c === "forbidden" || c === "quota" || c === "network") return new OcrAiError(c, e.message, e.status, retry);
    if (e.status === 401) return new OcrAiError("not_signed_in", e.message, e.status);
    if (e.status === 403) return new OcrAiError("forbidden", e.message, e.status);
    if (e.status === 429) return new OcrAiError("quota", e.message, e.status, retry);
    if (e.status === 404) return new OcrAiError("network", "AI OCR is not installed on the server yet", e.status);
    if (e.status === 0 || e.status >= 502) return new OcrAiError("network", e.message, e.status, retry);
    return new OcrAiError("unknown", e.message, e.status);
  }
  const msg = e instanceof Error ? e.message : "Request failed";
  if (/timeout|timed out|abort/i.test(msg)) return new OcrAiError("timeout", "AI OCR timed out");
  return new OcrAiError("network", msg);
}

/** `retryAfter` from the server body (top-level or under `.data`), clamped to 0..3600 s. */
function readRetryAfter(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const o = data as Record<string, unknown>;
  const direct = Number(o.retryAfter ?? (o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>).retryAfter : NaN));
  return Number.isFinite(direct) && direct > 0 ? Math.min(3600, Math.round(direct)) : 0;
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
  const lim = (o.limits && typeof o.limits === "object" ? o.limits : null) as Record<string, unknown> | null;
  if (lim) {
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
    const reset = typeof lim.resetAtUtc === "string" && !Number.isNaN(Date.parse(lim.resetAtUtc))
      ? lim.resetAtUtc
      : nextUtcMidnightIso();
    out.limits = {
      requestsPerDay: num(lim.requestsPerDay, 200),
      tokensPerDay: num(lim.tokensPerDay, 1_000_000),
      ratePerMinUser: num(lim.ratePerMinUser, 10),
      ratePerMinCompany: num(lim.ratePerMinCompany, 15),
      resetAtUtc: reset,
    };
  }
  if (typeof o.modelActive === "string" && o.modelActive) out.modelActive = o.modelActive;
  if (typeof o.canChangeModel === "boolean") out.canChangeModel = o.canChangeModel;
  if (Array.isArray(o.models)) {
    const list: OcrAiModelOption[] = [];
    for (const raw of o.models) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as Record<string, unknown>;
      if (typeof m.id !== "string" || !m.id.trim()) continue;
      list.push({
        id: m.id.trim(),
        label: typeof m.label === "string" && m.label.trim() ? m.label.trim() : m.id.trim(),
        note: typeof m.note === "string" ? m.note : undefined,
      });
    }
    if (list.length) out.models = list;
  }
  return out;
}

function nextUtcMidnightIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
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

/** Admin: switch the Gemini model on the saved key (no key re-paste). The server tests it first. */
export async function setOcrAiModel(model: string): Promise<{ model: string }> {
  const m = String(model || "").trim();
  if (!m) throw new OcrAiError("unknown", "Model is empty");
  const r = await call<{ model?: string }>("/api/ocr-cloud/ai-model", { method: "POST", body: { provider: "gemini", model: m }, timeoutMs: 40_000 });
  invalidateOcrAiStatus();
  return { model: r?.model || m };
}

export type OcrAiReadInput = {
  companyId: string;
  imageBase64: string;
  mimeType: string;
  ownCompany?: { name?: string | null; pan?: string | null };
  /** Extra per-document-type rules (phase 3: taught rules). */
  hint?: string;
  /** Document type in focus: the server adds the taught rules of this type (+ general). */
  docType?: string;
  /** OUR own bank/cash ledgers (full account numbers): the server checks them instead of asking Gemini to compare names. */
  ownAccounts?: { accountName?: string | null; accountNumber?: string | null; bankName?: string | null; accountType?: string | null }[];
  /** Ask Gemini to output item/party/narration text in English (translate any local-language/Devanagari text). */
  translateToEnglish?: boolean;
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
  if (input.docType) body.docType = input.docType;
  if (input.translateToEnglish) body.translateToEnglish = true;
  if (input.ownAccounts && input.ownAccounts.length) {
    body.ownAccounts = input.ownAccounts.slice(0, 40).map((a) => ({
      accountName: a.accountName ?? "",
      accountNumber: String(a.accountNumber ?? "").replace(/[^\d]/g, ""),
      bankName: a.bankName ?? "",
      accountType: a.accountType ?? "",
    }));
  }
  const raw = await call<Record<string, unknown>>("/api/ocr-cloud/ai-read", { method: "POST", body, timeoutMs: AI_READ_TIMEOUT_MS, signal: input.signal });
  const u = (raw?.usage && typeof raw.usage === "object" ? raw.usage : {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  if (!raw?.data || typeof raw.data !== "object") throw new OcrAiError("network", "AI answer was empty");
  return {
    provider: "gemini",
    model: typeof raw.model === "string" ? raw.model : "",
    data: normalizeAiVoucher(raw.data),
    usage: { promptTokens: n(u.promptTokens), outputTokens: n(u.outputTokens), thoughtsTokens: n(u.thoughtsTokens), totalTokens: n(u.totalTokens) },
    rulesUsed: n(raw.rulesUsed),
  };
}

/** Seconds → "45s" / "3 min" (user-facing retry hint). */
function retryInText(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  return `${min} min`;
}

export function ocrAiErrorText(e: unknown): string {
  const err = toAiError(e);
  const wait = retryInText(err.retryAfter);
  switch (err.code) {
    case "disabled": return "Online / AI OCR is turned off on the server or for this company.";
    case "forbidden": return "You do not have permission for this.";
    case "not_signed_in": return "Sign in to Pocket Ledger Server first.";
    case "timeout": return "AI OCR timed out.";
    case "quota":
      return `Gemini quota / rate limit reached${wait ? ` — try again in about ${wait}` : ""}. ` +
        "Free-tier limits reset every minute (and daily at 00:00 UTC). Check billing on the API key if this keeps happening.";
    case "no_key":
      return "The saved Gemini key was rejected or has expired. Save a valid key in OCR settings.";
    default: {
      const msg = err.message || "Something went wrong.";
      /* Gemini 503/UNAVAILABLE — server already says "temporarily overloaded"; add the retry hint. */
      if (/overloaded|unavailable|503|try again later/i.test(msg)) {
        return `${msg}${wait ? ` Retry in about ${wait}.` : ""} Google's model is briefly busy — this is not a key or quota problem.`;
      }
      return msg;
    }
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

/* ---- AI chat / teaching (ai-plan.md Phase 1 + 3) ---- */
const AI_CHAT_TIMEOUT_MS = 95_000;

export type OcrAiChatInput = {
  companyId: string;
  /** Last N text turns only (see chatPayload). */
  messages: { role: "user" | "model"; text: string }[];
  docType?: string;
  /** Only for the turn where the user attached the bill. */
  imageBase64?: string;
  mimeType?: string;
  voucherJson?: unknown;
  ownCompany?: { name?: string | null; pan?: string | null };
  signal?: AbortSignal;
};

export type OcrAiChatResult = {
  reply: string;
  proposedRule: OcrAiProposedRule | null;
  model: string;
  usage: { promptTokens: number; outputTokens: number; totalTokens: number };
  rulesUsed: number;
};

export async function ocrAiChat(input: OcrAiChatInput): Promise<OcrAiChatResult> {
  const body: Record<string, unknown> = { company: input.companyId, provider: "gemini", messages: input.messages };
  if (input.docType) body.docType = input.docType;
  if (input.imageBase64) {
    body.imageBase64 = String(input.imageBase64).replace(/^data:[^;,]*;base64,/, "");
    body.mimeType = input.mimeType || "image/jpeg";
  }
  if (input.voucherJson != null) body.voucherJson = input.voucherJson;
  if (input.ownCompany) body.ownCompany = { name: input.ownCompany.name ?? "", pan: input.ownCompany.pan ?? "" };
  const raw = await call<Record<string, unknown>>("/api/ocr-cloud/ai-chat", { method: "POST", body, timeoutMs: AI_CHAT_TIMEOUT_MS, signal: input.signal });
  const u = (raw?.usage && typeof raw.usage === "object" ? raw.usage : {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  return {
    reply: typeof raw?.reply === "string" && raw.reply.trim() ? raw.reply : "(no answer)",
    proposedRule: normalizeProposedRule(raw?.proposedRule),
    model: typeof raw?.model === "string" ? raw.model : "",
    usage: { promptTokens: n(u.promptTokens), outputTokens: n(u.outputTokens), totalTokens: n(u.totalTokens) },
    rulesUsed: n(raw?.rulesUsed),
  };
}

export async function listOcrAiRules(companyId: string): Promise<OcrAiRulesList> {
  return normalizeRulesList(await call<unknown>(`/api/ocr-cloud/ai-rules?company=${encodeURIComponent(companyId)}`, { method: "GET" }));
}

export async function saveOcrAiRule(companyId: string, rule: OcrAiProposedRule, source: "chat" | "manual" = "chat"): Promise<void> {
  await call<unknown>("/api/ocr-cloud/ai-rules", { method: "POST", body: { company: companyId, docType: rule.docType, text: rule.text.trim(), source } });
}

export async function removeOcrAiRule(companyId: string, docType: OcrAiDocTypeKey, id: string): Promise<void> {
  await call<unknown>("/api/ocr-cloud/ai-rules", { method: "DELETE", body: { company: companyId, docType, id } });
}

/* ---- Bank aliases: OUR company's account names (per company, never shared) ---- */
export type OcrAiAliasKind = "account_holder" | "beneficiary" | "account_last4";
export type OcrAiAlias = { id: string; kind: OcrAiAliasKind; text: string; note?: string };
export type OcrAiAliasesList = { ready: boolean; canEdit: boolean; aliases: OcrAiAlias[] };

function normalizeAliasesList(raw: unknown): OcrAiAliasesList {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(o.aliases) ? o.aliases : [];
  const kinds: readonly string[] = ["account_holder", "beneficiary", "account_last4"];
  const aliases: OcrAiAlias[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    const kind = String(a.kind || "");
    const text = String(a.text || "").trim();
    if (!kinds.includes(kind) || !text) continue;
    aliases.push({ id: String(a.id || ""), kind: kind as OcrAiAliasKind, text, note: typeof a.note === "string" ? a.note : undefined });
  }
  return { ready: o.ready === true, canEdit: o.canEdit === true, aliases };
}

export async function listOcrAiAliases(companyId: string): Promise<OcrAiAliasesList> {
  return normalizeAliasesList(await call<unknown>(`/api/ocr-cloud/ai-aliases?company=${encodeURIComponent(companyId)}`, { method: "GET" }));
}

export async function saveOcrAiAliases(
  companyId: string,
  input: { kind: OcrAiAliasKind; texts: string[]; note?: string }
): Promise<OcrAiAliasesList> {
  const texts = input.texts.map((t) => String(t || "").trim()).filter(Boolean);
  if (!texts.length) throw new OcrAiError("unknown", "Alias is empty");
  return normalizeAliasesList(await call<unknown>("/api/ocr-cloud/ai-aliases", { method: "POST", body: { company: companyId, kind: input.kind, text: texts[0], texts, note: input.note } }));
}

export async function removeOcrAiAlias(companyId: string, id: string): Promise<OcrAiAliasesList> {
  return normalizeAliasesList(await call<unknown>("/api/ocr-cloud/ai-aliases", { method: "DELETE", body: { company: companyId, id } }));
}
