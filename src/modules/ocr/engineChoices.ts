"use client";
/**
 * Engines the OCR fail popup may offer for ONE more scan: Gemini models (AI status) and Azure / Google Vision
 * (cloud status), only when usable for this company and user. Same availability rules as engine.ts
 * (tryAiOcr / tryCloudOcr). Never returns key data; never changes saved prefs or the saved model.
 */
import { getOcrCloudStatusCached } from "./cloud/ocrCloudClient";
import { getOcrAiStatusCached, type OcrAiModelOption } from "./ai/aiClient";
import { unavailableAiModels } from "./ai/aiModelAvailability";

export type OcrEngineOptions = {
  /** Gemini models usable now (models this key cannot use are dropped). Empty = Gemini not usable. */
  geminiModels: OcrAiModelOption[];
  geminiActive: string;
  google: boolean;
  azure: boolean;
};

export async function loadOcrEngineOptions(companyId: string | null | undefined): Promise<OcrEngineOptions> {
  const out: OcrEngineOptions = { geminiModels: [], geminiActive: "", google: false, azure: false };
  const id = String(companyId || "");
  if (!id) return out;
  const [ai, cloud] = await Promise.all([
    getOcrAiStatusCached(id).catch(() => null),
    getOcrCloudStatusCached(id).catch(() => null),
  ]);
  if (ai) out.geminiActive = ai.modelActive || "";
  if (ai && ai.aiReady && ai.serverOcrEnabled && ai.canUse) {
    const blocked = unavailableAiModels(id);
    const list = ai.models?.length ? ai.models : out.geminiActive ? [{ id: out.geminiActive, label: out.geminiActive }] : [];
    out.geminiModels = list.filter((m) => !blocked.has(m.id));
  }
  if (cloud && cloud.serverOcrEnabled && cloud.canUse) {
    const has = (p: "google" | "azure") => cloud.isAdmin
      ? cloud.keys ? !!cloud.keys[p] : !!cloud.hasKey && cloud.provider === p
      : cloud.providers ? cloud.providers.includes(p) : cloud.provider === p;
    out.google = has("google");
    out.azure = has("azure");
  }
  return out;
}
