/**
 * AI chat / teaching (pure helpers: no React, no network) - see _handoff/ai-plan.md Phase 1 + 3.
 * - What a chat send carries: only the last AI_CHAT_SEND_LAST text turns (Gemini is stateless, every turn is
 *   re-sent, so old turns are dropped). A bill photo / voucher JSON goes ONLY with the turn it is attached to.
 * - History lives in this browser session only (sessionStorage), never on the server.
 * - How the server's rules list and Gemini's proposed rule are read.
 */
export const OCR_AI_DOC_TYPES = ["general", "purchase", "sale", "receipt", "payment", "expense", "other"] as const;
export type OcrAiDocTypeKey = (typeof OCR_AI_DOC_TYPES)[number];

/** English names (fallback); the dialog shows names in the app language from aiChatStrings. */
export const OCR_AI_DOC_TYPE_LABELS: Record<OcrAiDocTypeKey, string> = {
  general: "General (all types)",
  purchase: "Purchase",
  sale: "Sale",
  receipt: "Receipt",
  payment: "Payment",
  expense: "Expense",
  other: "Other",
};

export const AI_CHAT_SEND_LAST = 12;
export const AI_CHAT_MAX_CHARS = 4000;
export const AI_CHAT_KEEP_TURNS = 60;

export type OcrAiProposedRule = { docType: OcrAiDocTypeKey; text: string };
export type OcrAiChatTurn = {
  id: string;
  role: "user" | "model";
  text: string;
  at: number;
  /** UI only: this turn carried the bill photo / the AI voucher JSON (never stored or re-sent). */
  hadImage?: boolean;
  hadJson?: boolean;
  proposedRule?: OcrAiProposedRule | null;
  ruleSaved?: boolean;
  tokens?: number;
  /** Error notes are shown but never sent to the AI. */
  error?: boolean;
};
export type OcrAiRule = { id: string; text: string; created?: string; source?: string };
export type OcrAiRulesGroup = { rules: OcrAiRule[]; removed: number; error?: string };
export type OcrAiRulesList = { canEdit: boolean; folder?: string; types: Record<OcrAiDocTypeKey, OcrAiRulesGroup> };

export function normDocType(v: unknown): OcrAiDocTypeKey | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (OCR_AI_DOC_TYPES as readonly string[]).includes(s) ? (s as OcrAiDocTypeKey) : null;
}

/** Voucher form -> document type whose taught rules go with the AI scan / chat. */
export function aiDocTypeForVoucher(voucherType?: string | null, partySide?: string | null): OcrAiDocTypeKey {
  const v = String(voucherType ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (v.includes("purchase")) return "purchase";
  if (v.includes("sale")) return "sale";
  if (v.includes("receipt") || v.includes("paymentin") || v.includes("income")) return "receipt";
  if (v.includes("payment")) return "payment";
  if (v.includes("expense")) return "expense";
  if (v.includes("contra") || v.includes("journal")) return "other";
  return partySide === "seller" ? "purchase" : "sale";
}

/** Text turns the server gets: no error notes, last N, starting with a user turn. Photos are never in here. */
export function chatPayload(turns: readonly OcrAiChatTurn[], n = AI_CHAT_SEND_LAST): { role: "user" | "model"; text: string }[] {
  const ok = turns
    .filter((t) => !t.error && typeof t.text === "string" && t.text.trim())
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, AI_CHAT_MAX_CHARS) }));
  const tail = ok.slice(-Math.max(1, n));
  while (tail.length && tail[0].role === "model") tail.shift();
  return tail;
}

export function normalizeProposedRule(raw: unknown): OcrAiProposedRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 600);
  if (!text) return null;
  return { docType: normDocType(o.docType ?? o.doc_type) ?? "general", text };
}

function emptyGroups(): Record<OcrAiDocTypeKey, OcrAiRulesGroup> {
  const out = {} as Record<OcrAiDocTypeKey, OcrAiRulesGroup>;
  for (const t of OCR_AI_DOC_TYPES) out[t] = { rules: [], removed: 0 };
  return out;
}

export function normalizeRulesList(raw: unknown): OcrAiRulesList {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const types = emptyGroups();
  const src = (o.types && typeof o.types === "object" ? o.types : {}) as Record<string, unknown>;
  for (const t of OCR_AI_DOC_TYPES) {
    const g = (src[t] && typeof src[t] === "object" ? src[t] : {}) as Record<string, unknown>;
    const rules = Array.isArray(g.rules) ? g.rules : [];
    types[t] = {
      rules: rules
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({ id: String(r.id ?? ""), text: String(r.text ?? ""), created: typeof r.created === "string" ? r.created : undefined, source: typeof r.source === "string" ? r.source : undefined }))
        .filter((r) => r.id && r.text),
      removed: Number.isFinite(Number(g.removed)) ? Math.max(0, Math.trunc(Number(g.removed))) : 0,
      ...(typeof g.error === "string" && g.error ? { error: g.error } : {}),
    };
  }
  return { canEdit: o.canEdit === true, ...(typeof o.folder === "string" && o.folder ? { folder: o.folder } : {}), types };
}

export function rulesCount(list: OcrAiRulesList | null | undefined): number {
  if (!list) return 0;
  return OCR_AI_DOC_TYPES.reduce((a, t) => a + list.types[t].rules.length, 0);
}

export function newTurnId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const sessionKey = (companyId: string) => `pocket-ledger:ocr-ai-chat:${companyId}`;

/** Session-only chat history (text turns, no photos). */
export function loadChatSession(companyId: string): OcrAiChatTurn[] {
  try {
    if (typeof sessionStorage === "undefined" || !companyId) return [];
    const raw: unknown = JSON.parse(sessionStorage.getItem(sessionKey(companyId)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is OcrAiChatTurn => !!t && typeof t === "object" && ((t as OcrAiChatTurn).role === "user" || (t as OcrAiChatTurn).role === "model") && typeof (t as OcrAiChatTurn).text === "string")
      .slice(-AI_CHAT_KEEP_TURNS);
  } catch {
    return [];
  }
}

export function saveChatSession(companyId: string, turns: readonly OcrAiChatTurn[]): void {
  try {
    if (typeof sessionStorage === "undefined" || !companyId) return;
    if (!turns.length) sessionStorage.removeItem(sessionKey(companyId));
    else sessionStorage.setItem(sessionKey(companyId), JSON.stringify(turns.slice(-AI_CHAT_KEEP_TURNS)));
  } catch {
    /* storage full / blocked: chat still works for this page */
  }
}

// ── Persistent multi-session chat history (localStorage) ─────────────────────

export type OcrAiChatSession = {
  id: string;
  title: string;
  createdAt: number;
  turns: OcrAiChatTurn[];
};

const historyKey = (companyId: string) => `pocket-ledger:ocr-ai-chat-history:${companyId}`;
export const AI_CHAT_MAX_SESSIONS = 50;

export function loadChatHistory(companyId: string): OcrAiChatSession[] {
  try {
    if (typeof localStorage === "undefined" || !companyId) return [];
    const raw: unknown = JSON.parse(localStorage.getItem(historyKey(companyId)) || "[]");
    if (!Array.isArray(raw)) return [];
    return (raw as OcrAiChatSession[])
      .filter((s) => s && s.id && Array.isArray(s.turns))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function saveChatHistory(companyId: string, sessions: OcrAiChatSession[]): void {
  try {
    if (typeof localStorage === "undefined" || !companyId) return;
    localStorage.setItem(historyKey(companyId), JSON.stringify(sessions.slice(0, AI_CHAT_MAX_SESSIONS)));
  } catch { /* storage full */ }
}

export function newChatSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Derive a short title from the first user message. */
export function deriveChatTitle(turns: readonly OcrAiChatTurn[]): string {
  const first = turns.find((t) => t.role === "user");
  if (!first) return "New chat";
  return first.text.trim().slice(0, 40) + (first.text.length > 40 ? "…" : "");
}
