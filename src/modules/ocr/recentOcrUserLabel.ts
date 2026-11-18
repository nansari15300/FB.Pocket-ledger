/**
 * Gallery "Recent OCR Trxn" User column label (Ansari Ji, 2026-11-18):
 * - full   -> engine only: "OCR Gemini"
 * - semi   -> user + engine: "nansari15300, OCR Gemini" (no "OCR " before the user name)
 * - manual -> user only: "nansari15300" (same name the Dashboard Recent shows)
 * The mode is the runner mode stored on the gallery row at post time (`autoOcrRunnerMode`).
 * Older rows have no stored mode; every row in this table is a runner job, so they fall back to "semi".
 */
export type RecentOcrRunnerMode = "manual" | "semi" | "full";

export function normalizeRecentOcrRunnerMode(value: unknown): RecentOcrRunnerMode | null {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "manual" || v === "semi" || v === "full" ? v : null;
}

export function ocrEngineLabel(provider: unknown): string {
  const p = String(provider ?? "").trim();
  return `OCR${p ? ` ${p.replace(/^./, (letter) => letter.toUpperCase())}` : ""}`;
}

export function recentOcrUserLabel(input: {
  mode: unknown;
  provider: unknown;
  userName: unknown;
}): { label: string; mode: RecentOcrRunnerMode; modeStored: boolean } {
  const stored = normalizeRecentOcrRunnerMode(input.mode);
  const mode: RecentOcrRunnerMode = stored ?? "semi";
  const engine = ocrEngineLabel(input.provider);
  const user = String(input.userName ?? "").trim();
  if (mode === "full") return { label: engine, mode, modeStored: !!stored };
  if (mode === "manual") return { label: user || engine, mode, modeStored: !!stored };
  return { label: user ? `${user}, ${engine}` : engine, mode, modeStored: !!stored };
}

/**
 * Same rule split for a narrow cell: Semi shows "<user>" on line 1 and the engine
 * ("OCR Gemini") as a smaller line 2, so the text never runs under the File column.
 */
export function recentOcrUserLines(input: {
  mode: unknown;
  provider: unknown;
  userName: unknown;
}): { line1: string; line2: string; label: string } {
  const { label, mode } = recentOcrUserLabel(input);
  const user = String(input.userName ?? "").trim();
  if (mode === "semi" && user) return { line1: user, line2: ocrEngineLabel(input.provider), label };
  return { line1: label, line2: "", label };
}
