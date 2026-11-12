"use client";
/**
 * AI chat usage ledger (device-local, ai-plan.md Phase 1).
 *
 * The server returns token usage per reply but does not keep a per-company ledger, and Gemini exposes no
 * "remaining quota" API. So the chat ribbon counts what THIS device sent, bucketed by UTC day (the same day
 * the server's daily cap resets on), and shows it against the budget the server reports (/ai-status limits,
 * env PL_OCR_AI_REQ_PER_DAY / PL_OCR_AI_TOKENS_PER_DAY).
 *
 * Storage is per company and per UTC day; old days are pruned (kept for the recent-days table).
 */

export type AiChatUsageDay = {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  requests: number;
  failed: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Tokens of replies that carried an attached image (the expensive ones). */
  imageRequests: number;
  lastAt: number;
};

export type AiChatUsageState = {
  v: 1;
  days: AiChatUsageDay[];
};

const KEY_PREFIX = "pl.aiChatUsage.v1.";
const KEEP_DAYS = 14;

export function utcDayKey(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function nextUtcMidnight(at: number = Date.now()): number {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function keyFor(companyId: string) {
  return `${KEY_PREFIX}${companyId}`;
}

function emptyDay(day: string): AiChatUsageDay {
  return { day, requests: 0, failed: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, imageRequests: 0, lastAt: 0 };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function normalizeDay(raw: unknown): AiChatUsageDay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const day = typeof o.day === "string" ? o.day.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return {
    day,
    requests: num(o.requests),
    failed: num(o.failed),
    promptTokens: num(o.promptTokens),
    outputTokens: num(o.outputTokens),
    totalTokens: num(o.totalTokens),
    imageRequests: num(o.imageRequests),
    lastAt: num(o.lastAt),
  };
}

export function loadUsage(companyId: string): AiChatUsageState {
  if (typeof window === "undefined" || !companyId) return { v: 1, days: [] };
  try {
    const raw = window.localStorage.getItem(keyFor(companyId));
    if (!raw) return { v: 1, days: [] };
    const parsed = JSON.parse(raw) as { days?: unknown };
    const days = (Array.isArray(parsed?.days) ? parsed.days : [])
      .map(normalizeDay)
      .filter((d): d is AiChatUsageDay => !!d)
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, KEEP_DAYS);
    return { v: 1, days };
  } catch {
    return { v: 1, days: [] };
  }
}

function saveUsage(companyId: string, state: AiChatUsageState) {
  if (typeof window === "undefined" || !companyId) return;
  try {
    window.localStorage.setItem(keyFor(companyId), JSON.stringify(state));
  } catch {
    /* quota / private mode — the ribbon just stays at the last value */
  }
}

export type AiChatUsageDelta = {
  ok: boolean;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  hadImage?: boolean;
};

/** Record one chat turn (success or failure) and return the new state. */
export function recordUsage(companyId: string, delta: AiChatUsageDelta, at: number = Date.now()): AiChatUsageState {
  const state = loadUsage(companyId);
  const day = utcDayKey(at);
  const idx = state.days.findIndex((d) => d.day === day);
  const row: AiChatUsageDay = idx >= 0 ? { ...state.days[idx] } : emptyDay(day);
  row.requests += 1;
  row.lastAt = at;
  if (!delta.ok) row.failed += 1;
  if (delta.ok) {
    row.promptTokens += num(delta.promptTokens);
    row.outputTokens += num(delta.outputTokens);
    row.totalTokens += num(delta.totalTokens);
    if (delta.hadImage) row.imageRequests += 1;
  }
  if (idx >= 0) state.days[idx] = row;
  else state.days.unshift(row);
  state.days = state.days.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, KEEP_DAYS);
  saveUsage(companyId, state);
  return state;
}

export function clearUsage(companyId: string): AiChatUsageState {
  if (typeof window !== "undefined" && companyId) {
    try { window.localStorage.removeItem(keyFor(companyId)); } catch { /* ignore */ }
  }
  return { v: 1, days: [] };
}

export function todayUsage(state: AiChatUsageState, at: number = Date.now()): AiChatUsageDay {
  const day = utcDayKey(at);
  return state.days.find((d) => d.day === day) ?? emptyDay(day);
}

/** "48.2k", "1.3M", "812" */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return String(v);
}

/** "4h 12m" / "12m" / "45s" until the next UTC midnight. */
export function formatResetIn(resetAt: number, at: number = Date.now()): string {
  const ms = Math.max(0, resetAt - at);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(ms / 1000)}s`;
}
