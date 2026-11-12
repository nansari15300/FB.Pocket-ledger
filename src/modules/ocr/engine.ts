"use client";
/**
 * OCR engine.
 * - Online (optional): Google Cloud Vision or Azure Image Analysis Read through the Pocket Ledger Server (`./cloud/ocrCloudClient`), only when the
 *   user's engine pref is "auto" or "online", the device is online, the file is an image/PDF page, and the server status says
 *   `canUse` (server OCR on + company enabled + user allowed + key saved). "online" never falls back to tesseract (throws instead). Any error / timeout in "auto" -> offline path.
 * - AI (engine pref "ai"): Gemini reads the bill into our voucher JSON through the server (`./ai/aiClient`). Any miss
 *   (not allowed / no key / error / timeout) falls back to online OCR (Google / Azure), then tesseract; the reason is kept
 *   in `engineNote` (tooltip on the "Read by" badge + debug dump).
 * - Offline (default fallback): tesseract.js (own Web Worker) + locally bundled assets under `public/ocr/`
 *   (worker, wasm core, eng+nep traineddata). No CDN calls.
 */
import type { OcrRawResult } from "./types";
import { fileToOcrCanvasInfo, type OcrPreprocessVariant } from "./preprocess";
import { betterPass, needsEnhancedPass, ocrKeyFieldScore } from "./ocrQuality";
import { linesFromTesseractData } from "./layout";
import { publicAssetUrl } from "@/lib/webAppBasePath";
import { resolvePdfJsWorkerHref } from "@/lib/pdfjsWorkerSrc";
import { getOcrCloudStatusCached, ocrCloud, ocrCloudErrorCode } from "./cloud/ocrCloudClient";
import { rawFromCloudText } from "./cloud/cloudRaw";
import { getOcrPrefs, type OcrEnginePref } from "./prefs";
import { getOcrAiStatusCached, ocrAiErrorCode, ocrAiErrorText, ocrAiRead, type OcrAiReadInput } from "./ai/aiClient";
import { aiFallbackText } from "./ai/aiVoucher";

type TWorker = {
  recognize: (img: unknown, opts?: unknown, output?: unknown) => Promise<{ data: any }>;
  setParameters: (p: Record<string, unknown>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

const workers = new Map<string, Promise<TWorker>>();

/**
 * Public asset base for OCR files. Web app runs under a basePath (dev gateway / prod: `/app`), so
 * `/ocr/` must go through `publicAssetUrl` (same as pdf.worker). file:// (packaged Electron): next to
 * the export root, found the same way as the pdf.js worker.
 */
export function ocrAssetBase(): string {
  if (typeof window === "undefined") return publicAssetUrl("/ocr/");
  if (window.location.protocol === "file:") {
    const pdfWorker = resolvePdfJsWorkerHref();
    return new URL("ocr/", pdfWorker).href;
  }
  return new URL(publicAssetUrl("/ocr/"), window.location.origin).href;
}

/** One worker per language set. English first: mixed eng+nep on English bills hurt accuracy (PAN read as Devanagari). */
function getWorker(langs: "eng" | "nep" = "eng"): Promise<TWorker> {
  let p = workers.get(langs);
  if (!p) {
    p = (async () => {
      const { createWorker } = await import("tesseract.js");
      const base = ocrAssetBase();
      const w = await createWorker(langs === "nep" ? ["nep", "eng"] : ["eng"], 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: `${base}tessdata`,
        gzip: true,
      } as never);
      return w as unknown as TWorker;
    })().catch((e) => {
      workers.delete(langs);
      throw e;
    });
    workers.set(langs, p);
  }
  return p;
}

export async function terminateOcrWorker() {
  const all = [...workers.values()];
  workers.clear();
  for (const p of all) (await p.catch(() => null))?.terminate();
}

function isAndroidWebView() {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export type RunOcrOptions = {
  /** Active company (server checks the user's online OCR permission for it). */
  companyId?: string | null;
  /** "auto" (default) tries the saved online provider first when allowed; "offline" = tesseract only; "online" = cloud only, no tesseract fallback. */
  enginePref?: OcrEnginePref;
  /** Our company (name + PAN) so the AI knows whether we are buyer or seller. */
  ownCompany?: { name?: string | null; pan?: string | null };
  /** Our own Bank/Cash ledgers — the server matches full account numbers to prove a contra transfer. */
  ownAccounts?: OcrAiReadInput["ownAccounts"];
  /** AI engine: document type whose taught rules the server adds (aiDocTypeForVoucher). */
  aiDocType?: string;
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
    const { canvas } = await fileToOcrCanvasInfo(file, mime, side, "standard");
    const jpg = await canvasToJpeg(canvas, q);
    if (jpg && jpg.size <= CLOUD_MAX_BYTES) return { b64: await blobToBase64(jpg), w: canvas.width, h: canvas.height, kb: Math.round(jpg.size / 1024) };
  }
  throw new Error("image too large for online OCR");
}

/** Online OCR attempt (Google or Azure). Returns null (with the reason) when not allowed / failed, so the caller runs tesseract. */
async function tryCloudOcr(file: Blob, mime: string, opts: RunOcrOptions): Promise<{ raw: OcrRawResult | null; note: string }> {
  if ((opts.enginePref ?? "auto") === "offline") return { raw: null, note: "offline only (OCR settings)" };
  if (!opts.companyId) return { raw: null, note: "no company" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { raw: null, note: "device offline" };
  let status;
  try {
    status = await getOcrCloudStatusCached(opts.companyId);
  } catch (e) {
    return { raw: null, note: `Online OCR status unavailable (${ocrCloudErrorCode(e)})` };
  }
  if (!status.serverOcrEnabled) return { raw: null, note: "Online OCR off on server" };
  if (!status.canUse) return { raw: null, note: !status.companyEnabled ? "Online OCR off for this company" : !status.hasKey ? "no online OCR key" : "Online OCR not allowed for this user" };
  const ac = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const img = await cloudJpeg(file, mime);
    const res = await Promise.race([
      // provider: Google / Azure picked in Switch Engine (also used by Auto and the AI fallback); "" = server's latest key
      ocrCloud.vision(opts.companyId, img.b64, { signal: ac.signal, languageHints: ["ne", "hi", "en"], provider: getOcrPrefs().onlineProvider || undefined }),
      new Promise<never>((_, rej) => { t = setTimeout(() => { ac.abort(); rej(new Error("Online OCR timed out")); }, CLOUD_TIMEOUT_MS); }),
    ]);
    const text = String(res?.text ?? "");
    if (text.replace(/\s+/g, "").length < 8) return { raw: null, note: "Online OCR returned no text" };
    const fromVision = res && typeof res === "object" && "provider" in (res as object) ? (res as { provider?: unknown }).provider : undefined;
    const provider = fromVision === "azure" || fromVision === "google" ? fromVision : status.provider === "azure" ? "azure" as const : "google" as const;
    return { raw: rawFromCloudText(text, { engine: provider, note: `JPEG ${img.w}x${img.h} ${img.kb} KB`, pageWidth: img.w, pageHeight: img.h, pages: res?.pages }), note: "" };
  } catch (e) {
    const code = ocrCloudErrorCode(e);
    if (process.env.NODE_ENV !== "production") console.warn("[OCR] Online OCR failed, using offline OCR", code, e);
    return { raw: null, note: `Online OCR failed (${code})` };
  } finally {
    if (t) clearTimeout(t);
  }
}

/** AI OCR attempt (Gemini via server). Returns null (with the reason) when not allowed / failed, so the caller falls back. */
async function tryAiOcr(file: Blob, mime: string, opts: RunOcrOptions): Promise<{ raw: OcrRawResult | null; note: string }> {
  if (!opts.companyId) return { raw: null, note: "AI: no company" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { raw: null, note: "AI: device offline" };
  let status;
  try {
    status = await getOcrAiStatusCached(opts.companyId);
  } catch (e) {
    return { raw: null, note: `AI status unavailable (${ocrAiErrorText(e)})` };
  }
  if (!status.aiReady) return { raw: null, note: "AI OCR not installed on the server yet" };
  if (!status.serverOcrEnabled) return { raw: null, note: "AI OCR off on server" };
  if (!status.canUse) return { raw: null, note: !status.companyEnabled ? "AI: online OCR off for this company" : status.isAdmin && status.companyHasKey === false ? "AI: no Gemini key saved" : "AI: not allowed for this user or no Gemini key" };
  const ac = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const img = await cloudJpeg(file, mime);
    const res = await Promise.race([
      ocrAiRead({ companyId: opts.companyId, imageBase64: img.b64, mimeType: "image/jpeg", ownCompany: opts.ownCompany, ownAccounts: opts.ownAccounts, docType: opts.aiDocType, signal: ac.signal }),
      new Promise<never>((_, rej) => { t = setTimeout(() => { ac.abort(); rej(new Error("AI OCR timed out")); }, AI_TIMEOUT_MS); }),
    ]);
    const d = res.data;
    // Gemini returns only the voucher JSON (no transcription); parser + "Show OCR text" get a compact summary of it
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
      },
      note: "",
    };
  } catch (e) {
    const code = e instanceof Error && /timed out/i.test(e.message) ? "timeout" : ocrAiErrorCode(e);
    if (process.env.NODE_ENV !== "production") console.warn("[OCR] AI OCR failed, falling back", code);
    return { raw: null, note: `AI failed (${code === "timeout" ? "timed out" : ocrAiErrorText(e)})` };
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Online OCR when allowed (see `tryCloudOcr`). "auto" falls back to tesseract on any miss; "online" never calls tesseract and throws instead.
 * "ai": Gemini first; on a miss online OCR (as "auto"), then tesseract, with the AI reason kept in `engineNote`.
 */
export async function runOcrOnFile(file: Blob, mime: string, opts: RunOcrOptions = {}): Promise<OcrRawResult> {
  const pref = opts.enginePref ?? "auto";
  if (pref === "ai") {
    const ai = await tryAiOcr(file, mime, opts).catch((e) => ({ raw: null, note: `AI failed (${ocrAiErrorText(e)})` }));
    if (ai.raw) return ai.raw;
    const cloud = await tryCloudOcr(file, mime, { ...opts, enginePref: "auto" }).catch((e) => ({ raw: null, note: `Online OCR failed (${ocrCloudErrorCode(e)})` }));
    if (cloud.raw) return { ...cloud.raw, engineNote: [ai.note, cloud.raw.engineNote].filter(Boolean).join(" -> ") };
    const raw = await runTesseractOnFile(file, mime);
    return { ...raw, engine: "tesseract", engineNote: [ai.note, cloud.note].filter(Boolean).join("; ") || undefined };
  }
  const cloud = await tryCloudOcr(file, mime, opts).catch((e) => ({ raw: null, note: `Online OCR failed (${ocrCloudErrorCode(e)})` }));
  if (cloud.raw) return cloud.raw;
  if (pref === "online") throw new Error(cloud.note || "Online OCR failed");
  const raw = await runTesseractOnFile(file, mime);
  return { ...raw, engine: "tesseract", engineNote: cloud.note || undefined };
}

/** Offline tesseract multi-pass (unchanged behaviour). */
export async function runTesseractOnFile(file: Blob, mime: string): Promise<OcrRawResult> {
  // standard pass + (only when key fields are missing / low confidence) one enhanced retry pass
  const timeoutMs = isAndroidWebView() ? 75000 : 50000;
  const maxSide = isAndroidWebView() ? 2500 : 3500;
  const isPdf = /pdf/i.test(mime || file.type);
  const job = (async () => {
    const recognizePass = async (variant: OcrPreprocessVariant) => {
      const { canvas, skewDeg } = await fileToOcrCanvasInfo(file, mime, maxSide, variant);
      if (process.env.NODE_ENV !== "production") {
        console.info(`[OCR] engine input ${mime} ${(file.size / 1024).toFixed(0)} KB -> canvas ${canvas.width}x${canvas.height}px (${variant}${skewDeg ? `, deskew ${skewDeg} deg` : ""})`);
      }
      const worker = await getWorker("eng");
      // Pass A (layout + words): PSM 6 single block - PSM 3 split the bill table into column blocks (no header/lines/VAT)
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      let { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      // Devanagari bill? (few Latin letters) -> nep+eng pass replaces A
      const txt = String(data?.text ?? "");
      const latin = (txt.match(/[A-Za-z]/g) ?? []).length;
      const deva = (txt.match(/[\u0900-\u097F]/g) ?? []).length;
      const nepali = latin < 40 || deva > latin;
      if (nepali) {
        const nep = await getWorker("nep");
        data = (await nep.recognize(canvas, {}, { blocks: true, text: true })).data;
      }
      // Pass B (sparse text): only used to CONFIRM numbers pass A missed (e.g. bold boxed grand total)
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      const alt = (await worker.recognize(canvas, {}, { text: true })).data;
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const text = String(data?.text ?? "");
      const meanConfidence = Number(data?.confidence ?? 0);
      return {
        nepali,
        quality: ocrKeyFieldScore(text),
        meanConfidence,
        result: {
          text,
          lines: linesFromTesseractData(data),
          meanConfidence,
          pageHeight: canvas.height,
          pageWidth: canvas.width,
          altText: String(alt?.text ?? ""),
          preprocess: variant === "enhanced" ? `enhanced${skewDeg ? ` (deskew ${skewDeg} deg)` : ""}` : "standard",
        } satisfies OcrRawResult,
      };
    };
    const first = await recognizePass("standard");
    // Over-lit / glare / tilted photo: key fields missing -> retry with flat-field + deskew, keep the better pass
    if (isPdf || first.nepali || !needsEnhancedPass(first.quality, first.meanConfidence, first.result.text)) return first.result;
    let second: Awaited<ReturnType<typeof recognizePass>> | null = null;
    try {
      second = await recognizePass("enhanced");
    } catch (e) {
      console.warn("[OCR] enhanced pass failed", e);
    }
    if (!second) return first.result;
    const pick = betterPass(first, second);
    if (process.env.NODE_ENV !== "production") {
      console.info(`[OCR] standard ${first.quality.score}/5 (${Math.round(first.meanConfidence)}%) vs enhanced ${second.quality.score}/5 (${Math.round(second.meanConfidence)}%) -> ${pick === second ? "enhanced" : "standard"}`);
    }
    return {
      ...pick.result,
      // both sparse passes confirm numbers (grand total seen twice etc.)
      altText: `${pick.result.altText ?? ""}\n${(pick === second ? first : second).result.altText ?? ""}`,
      passNote: `standard ${first.quality.score}/5 ${Math.round(first.meanConfidence)}% (missing: ${first.quality.missing.join(", ") || "-"}); enhanced ${second.quality.score}/5 ${Math.round(second.meanConfidence)}% (missing: ${second.quality.missing.join(", ") || "-"}); used ${pick === second ? "enhanced" : "standard"}`,
    };
  })();
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error("OCR timed out")), timeoutMs);
  });
  try {
    return await Promise.race([job, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}
