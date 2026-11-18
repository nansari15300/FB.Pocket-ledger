"use client";
/**
 * Gemini models that answered "model not available for this key" (server reason "model"), remembered per company
 * in localStorage for a day so the OCR fail popup does not offer them again. A later successful read clears it.
 */
const KEY_PREFIX = "pl.ocr.ai.unavailable-models.v1:";
const TTL_MS = 24 * 60 * 60 * 1000;

function read(companyId: string): Record<string, number> {
  if (!companyId || typeof window === "undefined") return {};
  try {
    const o = JSON.parse(window.localStorage.getItem(KEY_PREFIX + companyId) || "{}") as Record<string, unknown>;
    const out: Record<string, number> = {};
    const now = Date.now();
    for (const k of Object.keys(o)) {
      const at = Number(o[k]);
      if (Number.isFinite(at) && now - at < TTL_MS) out[k] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function write(companyId: string, map: Record<string, number>): void {
  if (!companyId || typeof window === "undefined") return;
  try {
    if (Object.keys(map).length) window.localStorage.setItem(KEY_PREFIX + companyId, JSON.stringify(map));
    else window.localStorage.removeItem(KEY_PREFIX + companyId);
  } catch { /* best-effort */ }
}

export function unavailableAiModels(companyId: string | null | undefined): Set<string> {
  return new Set(Object.keys(read(String(companyId || ""))));
}

export function markAiModelUnavailable(companyId: string | null | undefined, model: string | null | undefined): void {
  const c = String(companyId || "");
  const m = String(model || "").trim();
  if (!c || !m) return;
  write(c, { ...read(c), [m]: Date.now() });
}

export function markAiModelAvailable(companyId: string | null | undefined, model: string | null | undefined): void {
  const c = String(companyId || "");
  const m = String(model || "").trim();
  if (!c || !m) return;
  const map = read(c);
  if (!(m in map)) return;
  delete map[m];
  write(c, map);
}
