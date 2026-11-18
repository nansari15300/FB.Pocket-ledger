"use client";
/**
 * OCR engine.
 * Online (optional): Google Cloud Vision or Azure Image Analysis Read through the Pocket Ledger Server (`./cloud/ocrCloudClient`), only when the
 *   user's engine pref is "auto" or "online", the device is online, the file is an image/PDF page, and the server status says
 *   `canUse` (server OCR on + company enabled + user allowed + key saved). "online" runs ONLY the picked Google/Azure and reports its
 *   failure. Auto also requires a configured online provider.
 * - AI (engine pref "ai"): Gemini reads the bill into our voucher JSON through the server (`./ai/aiClient`). It runs ALONE: on a miss
 *   (not allowed / no key / error / timeout) the reason is thrown to the UI so the user sees why (no silent engine switch).
 */
import type { OcrRawResult } from "./types";
import { fileToOcrCanvasInfo } from "./preprocess";
import { getOcrCloudStatusCached, ocrCloud, ocrCloudErrorCode } from "./cloud/ocrCloudClient";
import { rawFromCloudText } from "./cloud/cloudRaw";
import { getOcrPrefs, type OcrEnginePref } from "./prefs";
import { getOcrAiStatusCached, OcrAiError, ocrAiErrorCode, ocrAiErrorText, ocrAiRead, type OcrAiReadInput } from "./ai/aiClient";
import { isOcrCloudError } from "@/lib/ocrCloudApi";
import { aiFallbackText } from "./ai/aiVoucher";
import { recordOcrUsage, type OcrUsageEngine } from "./ocrUsage";

export type RunOcrOptions = {
  /** Active company (server checks the user's online OCR permission for it). */
  companyId?: string | null;
  /** "auto" uses the configured online provider; "online" uses the selected cloud provider only. */
  enginePref?: OcrEnginePref;
  /** Auto post can pin Google vs Azure without changing this device's interactive OCR preference. */
  cloudProvider?: "google" | "azure";
  /** Our company (name + PAN) so the AI knows whether we are buyer or seller. */
  ownCompany?: { name?: string | null; pan?: string | null };
  /** Our own Bank/Cash ledgers — the server matches full account numbers to prove a contra transfer. */
  ownAccounts?: OcrAiReadInput["ownAccounts"];
  /** Called as each engine starts (Gemini / Google / Azure) so the "reading…" toast can name the real engine. */
  onEngine?: (name: string) => void;
  /** Abort the in-flight AI/cloud request (voucher closed, or the user pressed Stop on the toast). */
  signal?: AbortSignal;
  /** AI engine: document type whose taught rules the server adds (aiDocTypeForVoucher). */
  aiDocType?: string;
  /** AI engine: Gemini model for this scan only (fail popup "Read with this model"); empty = company model. */
  aiModel?: string;
  /** Called with the Gemini model being requested (override, else company active model) for the progress toast. */
  onAiModel?: (model: string) => void;
};

const CLOUD_MAX_BYTES = 3.8 * 1024 * 1024;
const CLOUD_TIMEOUT_MS = 30000;
/** Gemini reads the whole bill and writes JSON (12 items ~ 10-40 s). Server waits up to 80 s. */
const AI_TIMEOUT_MS = 90000;

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result ?? "").replace(/^data:[^;,]*;base64,/, ""));
    r.onerror = () => rej(r.error ?? new Error("read failed"));
    r.readAsDataURL(b);
  });
}

/** Preprocessed (standard grayscale stretch; PDFs -> first page) JPEG, capped below ~3.8 MB for Vision. */
/** AI chat "Attach this bill": same JPEG the AI scan sends (size-capped). */
export async function aiChatJpeg(file: Blob, mime: string): Promise<{ b64: string }> {
  const j = await cloudJpeg(file, mime);
  return { b64: j.b64 };
}

async function cloudJpeg(file: Blob, mime: string): Promise<{ b64: string; w: number; h: number; kb: number }> {
  for (const [side, q] of [[2400, 0.85], [2000, 0.8], [1600, 0.72], [1280, 0.65]] as const) {
    const { canvas } = await fileToOcrCanvasInfo(file, mime, side);
    const jpg = await canvasToJpeg(canvas, q);
    if (jpg && jpg.size <= CLOUD_MAX_BYTES) return { b64: await blobToBase64(jpg), w: canvas.width, h: canvas.height, kb: Math.round(jpg.size / 1024) };
  }
  throw new Error("image too large for online OCR");
}

/** Online OCR attempt (Google or Azure). Returns null with a reason when unavailable or failed. */
type EngineTry = { raw: OcrRawResult | null; note: string; /** The provider / server error behind a failed read. */ cause?: unknown; /** Cloud provider that was tried (Auto mode names the real one). */ provider?: "google" | "azure" };

/**
 * Single-engine failure with machine-readable detail for the Gallery runner (pl:gallery:auto-post-scan-failed):
 *  code   - provider / server code: quota | network | timeout | no_key | forbidden | disabled | not_signed_in |
 *           region_unsupported | unknown, or "unreadable" (engine answered but found nothing usable: a file problem)
 *           or "unavailable" (engine not set up / not allowed for this company or user).
 *  status - HTTP status from Pocket Ledger Server (429 = rate limit / quota, 403 = forbidden ...; 0 = none).
 *  retryAfter - server retry hint in seconds (0 = none).
 * The message stays the user-facing reason the dialog already shows.
 */
export class OcrRunError extends Error {
  code: string;
  status: number;
  retryAfter: number;
  engine: "gemini" | "google" | "azure" | "online";
  /** Server failure reason from Gemini (OcrAiError.reason); "" = none. */
  reason: string;
  /** Gemini model that failed / second model the server tried ("" = unknown). */
  model = "";
  fallbackModel = "";
  constructor(message: string, code: string, status: number, retryAfter: number, engine: OcrRunError["engine"], reason = "") {
    super(message);
    this.name = "OcrRunError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.engine = engine;
    this.reason = reason;
  }
}

const UNREADABLE_RX = /returned no text|returned nothing readable|could not read/i;
function runErrorOf(t: EngineTry, fallback: string, engine: OcrRunError["engine"]): OcrRunError {
  const msg = t.note || fallback;
  const c = t.cause;
  if (c instanceof OcrAiError) {
    const r = new OcrRunError(msg, c.code, c.status, c.retryAfter, engine, c.reason);
    r.model = c.model;
    r.fallbackModel = c.fallbackModel;
    return r;
  }
  if (isOcrCloudError(c)) {
    const retry = Number((c as { retryAfter?: unknown }).retryAfter);
    return new OcrRunError(msg, c.code, c.status, Number.isFinite(retry) && retry > 0 ? Math.round(retry) : 0, engine);
  }
  if (c instanceof Error && /timed? ?out|timeout/i.test(c.message)) return new OcrRunError(msg, "timeout", 0, 0, engine);
  if (c) return new OcrRunError(msg, ocrAiErrorCode(c), 0, 0, engine);
  const n = t.note;
  const code = !n || UNREADABLE_RX.test(n) ? "unreadable"
    : /offline/i.test(n) ? "network"
    : /no .*key|no gemini key/i.test(n) ? "no_key"
    : /not allowed/i.test(n) ? "forbidden"
    : /\boff\b/i.test(n) ? "disabled"
    : "unavailable";
  return new OcrRunError(msg, code, 0, 0, engine);
}

async function tryCloudOcr(file: Blob, mime: string, opts: RunOcrOptions): Promise<EngineTry> {
  if (!opts.companyId) return { raw: null, note: "no company" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { raw: null, note: "device offline" };
  let status;
  try {
    status = await getOcrCloudStatusCached(opts.companyId);
  } catch (e) {
    return { raw: null, note: `Online OCR status unavailable (${ocrCloudErrorCode(e)})`, cause: e };
  }
  if (!status.serverOcrEnabled) return { raw: null, note: "Online OCR off on server" };
  const requestedProvider = opts.cloudProvider || getOcrPrefs().onlineProvider || status.provider || "google";
  const providerAvailable = status.isAdmin
    ? status.keys ? !!status.keys[requestedProvider] : !!status.hasKey && status.provider === requestedProvider
    : !!status.canUse && (status.providers ? status.providers.includes(requestedProvider) : status.provider === requestedProvider);
  const triedProvider: "google" | "azure" = requestedProvider === "azure" ? "azure" : "google";
  if (!status.canUse || !providerAvailable) return { raw: null, provider: triedProvider, note: !status.companyEnabled ? "Online OCR off for this company" : !providerAvailable ? `no ${requestedProvider} OCR key or access` : "Online OCR not allowed for this user" };
  if (opts.signal?.aborted) return { raw: null, provider: triedProvider, note: "Online OCR cancelled" };
  const ac = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  const onOuterAbort = () => ac.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const img = await cloudJpeg(file, mime);
    const res = await Promise.race([
      // Provider may be pinned by Auto post; interactive OCR keeps its normal device preference.
      (async () => {
        recordOcrUsage(opts.companyId, requestedProvider, "call");
        try {
          const result = await ocrCloud.vision(opts.companyId!, img.b64, { signal: ac.signal, languageHints: ["ne", "hi", "en"], provider: requestedProvider });
          if (String(result?.text ?? "").replace(/\s+/g, "").length < 8) {
            recordOcrUsage(opts.companyId, requestedProvider, "failed");
          } else recordOcrUsage(opts.companyId, requestedProvider, "reply");
          return result;
        } catch (error) {
          recordOcrUsage(opts.companyId, requestedProvider, "failed");
          throw error;
        }
      })(),
      new Promise<never>((_, rej) => { t = setTimeout(() => { ac.abort(); rej(new Error("Online OCR timed out")); }, CLOUD_TIMEOUT_MS); }),
    ]);
    const text = String(res?.text ?? "");
    if (text.replace(/\s+/g, "").length < 8) return { raw: null, provider: triedProvider, note: "Online OCR returned no text" };
    const fromVision = res && typeof res === "object" && "provider" in (res as object) ? (res as { provider?: unknown }).provider : undefined;
    const provider = fromVision === "azure" || fromVision === "google" ? fromVision : status.provider === "azure" ? "azure" as const : "google" as const;
    return { raw: rawFromCloudText(text, { engine: provider, note: `JPEG ${img.w}x${img.h} ${img.kb} KB`, pageWidth: img.w, pageHeight: img.h, pages: res?.pages }), note: "" };
  } catch (e) {
    const code = ocrCloudErrorCode(e);
    if (process.env.NODE_ENV !== "production") console.warn("[OCR] Online OCR failed", code, e);
    return { raw: null, provider: triedProvider, note: `Online OCR failed (${code})`, cause: e };
  } finally {
    if (t) clearTimeout(t);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** AI OCR attempt (Gemini via server). Returns null with a reason when unavailable or failed. */
async function tryAiOcr(file: Blob, mime: string, opts: RunOcrOptions): Promise<EngineTry> {
  if (!opts.companyId) return { raw: null, note: "AI: no company" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { raw: null, note: "AI: device offline" };
  let status;
  try {
    status = await getOcrAiStatusCached(opts.companyId);
  } catch (e) {
    return { raw: null, note: `AI status unavailable (${ocrAiErrorText(e)})`, cause: e };
  }
  if (!status.aiReady) return { raw: null, note: "AI OCR not installed on the server yet" };
  if (!status.serverOcrEnabled) return { raw: null, note: "AI OCR off on server" };
  if (!status.canUse) return { raw: null, note: !status.companyEnabled ? "AI: online OCR off for this company" : status.isAdmin && status.companyHasKey === false ? "AI: no Gemini key saved" : "AI: not allowed for this user or no Gemini key" };
  if (opts.signal?.aborted) return { raw: null, note: "AI: cancelled" };
  const reqModel = opts.aiModel || status.modelActive || "";
  if (reqModel) { try { opts.onAiModel?.(reqModel); } catch { /* UI only */ } }
  const ac = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  /** Caller's Stop / voucher closed cancels the Gemini request too (no wasted quota). */
  const onOuterAbort = () => ac.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const img = await cloudJpeg(file, mime);
    if (ac.signal.aborted) return { raw: null, note: "AI: cancelled" };
    const res = await Promise.race([
      (async () => {
        recordOcrUsage(opts.companyId, "gemini", "call");
        try {
          const result = await ocrAiRead({ companyId: opts.companyId, imageBase64: img.b64, mimeType: "image/jpeg", ownCompany: opts.ownCompany, ownAccounts: opts.ownAccounts, docType: opts.aiDocType, translateToEnglish: getOcrPrefs().translateToEnglish || undefined, model: opts.aiModel || undefined, signal: ac.signal });
          recordOcrUsage(opts.companyId, "gemini", "reply", { prompt: result.usage.promptTokens, output: result.usage.outputTokens });
          return result;
        } catch (error) {
          recordOcrUsage(opts.companyId, "gemini", "failed");
          throw error;
        }
      })(),
      new Promise<never>((_, rej) => { t = setTimeout(() => { ac.abort(); rej(new Error("AI OCR timed out")); }, AI_TIMEOUT_MS); }),
    ]);
    const d = res.data;
    // Parser fills from a compact summary of the validated JSON; the printed transcription (raw_text) rides along
    // as printedText for "Show OCR text" and for the parser's gap fill.
    const text = aiFallbackText(d);
    if (!text.trim() && !d.items.length && d.grand_total == null) return { raw: null, note: "AI returned nothing readable" };
    const u = res.usage;
    const base = rawFromCloudText(text, { engine: "gemini", note: `JPEG ${img.w}x${img.h} ${img.kb} KB`, pageWidth: img.w, pageHeight: img.h });
    return {
      raw: {
        ...base,
        engine: "gemini",
        preprocess: "ai (gemini)",
        passNote: `model ${res.model || "-"}, tokens in ${u.promptTokens} / out ${u.outputTokens}${u.thoughtsTokens ? ` / thinking ${u.thoughtsTokens}` : ""} / total ${u.totalTokens}`,
        meanConfidence: d.uncertain_fields.length ? 80 : 95,
        engineNote: `${res.model || "Gemini"}${res.rulesUsed ? ` | taught rules ${res.rulesUsed}` : ""} | tokens ${u.totalTokens} (in ${u.promptTokens}, out ${u.outputTokens}) | JPEG ${img.w}x${img.h} ${img.kb} KB`,
        ai: res,
        ...(d.raw_text ? { printedText: d.raw_text } : {}),
      },
      note: "",
    };
  } catch (e) {
    const code = e instanceof Error && /timed out/i.test(e.message) ? "timeout" : ocrAiErrorCode(e);
    if (process.env.NODE_ENV !== "production") console.warn("[OCR] AI OCR failed", code);
    return { raw: null, note: `AI failed (${code === "timeout" ? "timed out" : ocrAiErrorText(e)})`, cause: e };
  } finally {
    if (t) clearTimeout(t);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Runs the selected online provider or Gemini. Failures are surfaced for review; there is no local OCR fallback.
 */
export async function runOcrOnFile(file: Blob, mime: string, opts: RunOcrOptions = {}): Promise<OcrRawResult> {
  const pref = opts.enginePref ?? "auto";
  const selectedEngine: OcrUsageEngine = pref === "ai" ? "gemini" : pref === "online" ? (opts.cloudProvider || getOcrPrefs().onlineProvider || "google") : "auto";
  if (selectedEngine === "auto") recordOcrUsage(opts.companyId, selectedEngine, "call");
  try {
    const result = await runOcrOnFileInternal(file, mime, opts);
    if (selectedEngine === "auto") recordOcrUsage(opts.companyId, selectedEngine, "reply");
    return result;
  } catch (error) {
    if (selectedEngine === "auto") recordOcrUsage(opts.companyId, selectedEngine, "failed");
    throw error;
  }
}

async function runOcrOnFileInternal(file: Blob, mime: string, opts: RunOcrOptions = {}): Promise<OcrRawResult> {
  const pref = opts.enginePref ?? "auto";
  /** Stop means stop: no fallback engine should start after an abort. */
  const aborted = () => !!opts.signal?.aborted;
  const engineName = (e: string) => (e === "gemini" ? "Gemini" : e === "azure" ? "Azure" : e === "google" ? "Google" : "Online OCR");
  const stage = (e: string) => { try { opts.onEngine?.(engineName(e)); } catch { /* UI only */ } };
  /** Single engine picked by the user: it runs alone, and its failure is reported (no silent fallback). */
  const onlyOne = (t: EngineTry, fallback: string, engine: OcrRunError["engine"]) => runErrorOf(t, fallback, engine);

  // ---- AI (Gemini): the only engine the user picked ----
  if (pref === "ai") {
    stage("gemini");
    const ai: EngineTry = await tryAiOcr(file, mime, opts).catch((e) => ({ raw: null, note: `AI failed (${ocrAiErrorText(e)})`, cause: e }));
    if (ai.raw) return ai.raw;
    if (aborted()) throw new DOMException("OCR cancelled", "AbortError");
    throw onlyOne(ai, "Gemini could not read this document", "gemini");
  }

  // ---- Google / Azure picked: only that cloud engine ----
  if (pref === "online") {
    const provider = opts.cloudProvider || getOcrPrefs().onlineProvider || "";
    stage(provider || "cloud");
    const cloud: EngineTry = await tryCloudOcr(file, mime, opts).catch((e) => ({ raw: null, note: `Online OCR failed (${ocrCloudErrorCode(e)})`, cause: e }));
    if (cloud.raw) return cloud.raw;
    if (aborted()) throw new DOMException("OCR cancelled", "AbortError");
    const failedProvider = provider === "google" || provider === "azure" ? provider : cloud.provider;
    throw onlyOne(cloud, `${failedProvider === "google" ? "Google" : failedProvider === "azure" ? "Azure" : "Online"} OCR could not read this document`, failedProvider ?? "online");
  }

  // ---- auto: use configured online OCR; keep an unavailable provider visible as an error ----
  stage("cloud");
  const cloud: EngineTry = await tryCloudOcr(file, mime, opts).catch((e) => ({ raw: null, note: `Online OCR failed (${ocrCloudErrorCode(e)})`, cause: e }));
  if (cloud.raw) return cloud.raw;
  if (aborted()) throw new DOMException("OCR cancelled", "AbortError");
  /* Auto mode: name the provider that really ran / failed (Azure vs Google Vision) for the fail popup and runner. */
  throw onlyOne(cloud, "Online OCR could not read this document", cloud.provider ?? "online");
}
