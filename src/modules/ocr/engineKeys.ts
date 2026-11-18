/**
 * Which OCR engines have a saved key (Decisions 6 + 7, 2026-11-18). Pure — used by the OCR engine ("auto"),
 * the Gallery mode slider and tests. Offline OCR no longer exists, so "auto" only ever means a keyed engine.
 */
export type KeyedEngineOptions = { geminiModels: readonly unknown[]; google: boolean; azure: boolean };
export type RunnerScanEngine = "gemini" | "google" | "azure" | "auto";

/** First keyed engine in the order Gemini → Google → Azure; null when no engine has a key. */
export function pickAutoEngine(opts: KeyedEngineOptions): { enginePref: "ai"; cloudProvider: "" } | { enginePref: "online"; cloudProvider: "google" | "azure" } | null {
  if (opts.geminiModels.length > 0) return { enginePref: "ai", cloudProvider: "" };
  if (opts.google) return { enginePref: "online", cloudProvider: "google" };
  if (opts.azure) return { enginePref: "online", cloudProvider: "azure" };
  return null;
}

export function scanEngineHasKey(engine: unknown, opts: KeyedEngineOptions): boolean {
  if (engine === "gemini") return opts.geminiModels.length > 0;
  if (engine === "google") return opts.google;
  if (engine === "azure") return opts.azure;
  return pickAutoEngine(opts) != null;
}

export const ENGINE_NO_KEY_COPY = {
  en: "This engine has no saved key. Choose another engine in settings.",
  hi: "इस engine की key नहीं है, settings में दूसरा engine चुनें",
  ne: "यो engine को key छैन, settings मा अर्को engine छान्नुहोस्",
} as const;
