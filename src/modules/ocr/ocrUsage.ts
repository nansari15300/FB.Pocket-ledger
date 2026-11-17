"use client";

export type OcrUsageEngine = "gemini" | "google" | "azure" | "auto";
export type OcrUsageMonth = {
  month: string;
  engine: OcrUsageEngine;
  calls: number;
  replies: number;
  failed: number;
  promptTokens: number;
  outputTokens: number;
};

const PREFIX = "pl.ocrUsage.v1.";
const validEngine = (value: unknown): value is OcrUsageEngine => ["gemini", "google", "azure", "auto"].includes(String(value));
const localMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

function rowsFor(companyId: string): OcrUsageMonth[] {
  if (typeof window === "undefined" || !companyId) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${PREFIX}${companyId}`) || "[]");
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter((row): row is OcrUsageMonth => row && /^\d{4}-\d{2}$/.test(row.month) && validEngine(row.engine))
      .map((row) => ({
        month: row.month,
        engine: row.engine,
        calls: Number(row.calls) || 0,
        replies: Number(row.replies) || 0,
        failed: Number(row.failed) || 0,
        promptTokens: Number(row.promptTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
      }));
    if (clean.length !== parsed.length) window.localStorage.setItem(`${PREFIX}${companyId}`, JSON.stringify(clean));
    return clean;
  } catch { return []; }
}

export function getOcrUsage(companyId: string, month: string, engine: OcrUsageEngine): OcrUsageMonth {
  return rowsFor(companyId).find((row) => row.month === month && row.engine === engine) ?? {
    month, engine, calls: 0, replies: 0, failed: 0, promptTokens: 0, outputTokens: 0,
  };
}

export function recordOcrUsage(
  companyId: string | null | undefined,
  engine: OcrUsageEngine,
  outcome: "call" | "reply" | "failed",
  tokens?: { prompt?: number; output?: number },
  at = Date.now(),
) {
  if (typeof window === "undefined" || !companyId) return;
  const month = localMonthKey(new Date(at));
  const rows = rowsFor(companyId);
  const row = rows.find((entry) => entry.month === month && entry.engine === engine) ?? {
    month, engine, calls: 0, replies: 0, failed: 0, promptTokens: 0, outputTokens: 0,
  };
  if (outcome === "call") row.calls += 1;
  if (outcome === "reply") row.replies += 1;
  if (outcome === "failed") row.failed += 1;
  row.promptTokens += Math.max(0, Math.round(Number(tokens?.prompt) || 0));
  row.outputTokens += Math.max(0, Math.round(Number(tokens?.output) || 0));
  const next = rows.filter((entry) => entry !== row && !(entry.month === month && entry.engine === engine));
  next.unshift(row);
  const cutoff = new Date(at);
  cutoff.setMonth(cutoff.getMonth() - 35);
  const oldest = localMonthKey(cutoff);
  try { window.localStorage.setItem(`${PREFIX}${companyId}`, JSON.stringify(next.filter((entry) => entry.month >= oldest))); } catch { /* best effort local ledger */ }
  window.dispatchEvent(new CustomEvent("pl:ocr-usage-updated", { detail: { companyId, month, engine } }));
}
