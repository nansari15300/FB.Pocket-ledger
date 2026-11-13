"use client";
/**
 * AI chat / teaching (OCR-owned, ai-plan.md Phase 1 + 3).
 */
import React, { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bot, Info, Loader2, MessageSquare, PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Save, Send, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { aiChatJpeg } from "../engine";
import { OcrAiError, getOcrAiStatus, getOcrAiStatusCached, invalidateOcrAiStatus, listOcrAiRules, ocrAiChat, ocrAiErrorText, removeOcrAiRule, saveOcrAiRule, setOcrAiModel, type OcrAiLimits, type OcrAiMasterLists, type OcrAiMasterProposal, type OcrAiMissingMaster, type OcrAiModelOption, type OcrAiVoucherPatch } from "./aiClient";
import { AiChatUsageChips } from "./AiChatUsageChips";
import { AiModelPicker } from "./AiModelPicker";
import { clearUsage, loadUsage, recordUsage, type AiChatUsageState } from "./aiChatUsage";
import { useAiChatStrings, type AiChatStrings } from "./aiChatStrings";
import {
  OCR_AI_DOC_TYPES,
  AI_CHAT_SEND_LAST,
  AI_CHAT_MAX_SESSIONS,
  chatPayload,
  loadChatSession,
  newTurnId,
  rulesCount,
  saveChatSession,
  type OcrAiChatTurn,
  type OcrAiDocTypeKey,
  type OcrAiProposedRule,
  type OcrAiRulesList,
  type OcrAiChatSession,
  loadChatHistory,
  saveChatHistory,
  newChatSessionId,
  deriveChatTitle,
} from "./aiChatModel";

const CHAT_Z = 2147483002;
/* The voucher backdrop is z-80 and its frame is z-81. Keep the chat at z-82 so both stay crisp
 * above the same blurred page backdrop. Nested master dialogs have their own higher layers. */
const COPILOT_Z = 82;
const COPILOT_Z_FOCUSED = 82;
const COPILOT_STORAGE_KEY = "pl.ocr.copilot.window.v5";
const COPILOT_MIN_W = 320;
const COPILOT_MIN_H = 280;
type CopilotBounds = { x: number; y: number; w: number; h: number };
const CHAT_CONTENT_STYLE: React.CSSProperties = {
  zIndex: CHAT_Z,
  height: "88vh",
  maxHeight: "88vh",
  width: "min(860px, calc(100vw - 1rem))",
  maxWidth: "min(860px, calc(100vw - 1rem))",
  borderRadius: "1rem",
  overflow: "hidden",
  padding: 0,
  border: "none",
  boxShadow: "0 18px 40px -12px rgba(15,23,42,0.22), 0 6px 16px -6px rgba(15,23,42,0.12)",
};

/** WhatsApp-style chat canvas (neutral beige) — kept subtle so bubbles pop. */
const CHAT_CANVAS_BG = "#efeae2";
/** Left chat-list panel — light gray. */
const SIDEBAR_BG = "#eceff3";
/** Sky-blue accent (header, send button, active states). */
const ACCENT = "#0ea5e9";
const BUBBLE_OUT = "#dff3fd";
const BUBBLE_IN = "#ffffff";

/** Input box height: 3x of 10% then reduced 40% → ~18% of the popup height. */
const CHAT_INPUT_H = "max(88px, 18%)";
/** Input area strip — same light gray family as the sidebar. */
const INPUT_BG = "#f0f2f5";

/** Fallback list when /ai-status has not answered yet (server adds its own list on top). */
const FALLBACK_MODELS: OcrAiModelOption[] = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", note: "fastest · cheapest · default" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "balanced" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "legacy · being retired" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "most accurate · slowest" },
];

export type AiChatDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  docType?: OcrAiDocTypeKey;
  getBill?: () => Promise<{ blob: Blob; mime: string } | null>;
  getVoucherJson?: () => unknown;
  getOwnCompany?: () => { name?: string | null; pan?: string | null };
  /** New OCR run id; Copilot sends one initial review request once the window opens. */
  autoStartKey?: string;
  /**
   * Copilot mode (OCR Settings → Pocket AI): the SAME window renders as a floating, draggable,
   * resizable panel beside the voucher instead of a centred modal, and each turn may return a voucher
   * patch / master proposal that these callbacks receive. Nothing is duplicated — one chat, two modes.
   */
  copilot?: CopilotBridge;
};

/** What the copilot mode needs from the voucher form (all from useVoucherOcr). */
export type CopilotBridge = {
  /** Master name lists so Gemini can tell a real miss from a spelling variant. */
  getMasters: () => OcrAiMasterLists;
  /** Apply a patch to the live form; returns the labels actually written. */
  onPatch: (patch: OcrAiVoucherPatch) => string[];
  /** User pressed "Create & link" on a proposal. */
  onCreateMaster: (m: OcrAiMasterProposal) => void;
  /** Printed names with no master record (amber chips). */
  onMissingMasters?: (list: OcrAiMissingMaster[]) => void;
  /** Receipt thumbnail + status line for the header. */
  thumbUrl?: string | null;
  statusLine?: string | null;
  missingFields?: string[];
};

function chatErrorText(e: unknown, t: AiChatStrings): string {
  if (e instanceof OcrAiError && e.status === 404) return t.chatNotInstalled;
  return ocrAiErrorText(e);
}

function partyNameFromVoucherJson(value: unknown): string | undefined {
  try {
    const root = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown> | null;
    if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
    const ocr = (root.ocr_result && typeof root.ocr_result === "object" ? root.ocr_result : root) as Record<string, unknown>;
    const name = String(ocr.party_name ?? ocr.beneficiary_name ?? "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function DocTypeSelect({ value, onChange, disabled, t }: { value: OcrAiDocTypeKey; onChange: (v: OcrAiDocTypeKey) => void; disabled?: boolean; t: AiChatStrings }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as OcrAiDocTypeKey)}
      className="h-7 rounded-md border border-black/10 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
    >
      {OCR_AI_DOC_TYPES.map((k) => <option key={k} value={k}>{t.docTypes[k]}</option>)}
    </select>
  );
}

/** Info (ℹ) icon — hover on desktop (with delay so gap doesn't close it), tap on mobile */
function InfoPopup({ intro }: { intro: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  // Close on outside click/touch (mobile)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative ml-1 inline-flex shrink-0"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        aria-label="About this chat"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-0.5 text-white/60 transition hover:text-white/95 focus:outline-none"
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <span
          onMouseEnter={show}
          onMouseLeave={hide}
          className="absolute left-0 top-7 z-[9999] w-72 rounded-lg border border-black/10 bg-white p-3.5"
          style={{ boxShadow: "0 10px 30px -8px rgba(15,23,42,0.18), 0 4px 12px -4px rgba(15,23,42,0.10)" }}
        >
          {/* Arrow */}
          <span className="absolute -top-1.5 left-3 h-3 w-3 rotate-45 border-l border-t border-black/10 bg-white" />
          <span className="relative mb-1.5 block text-[12px] font-medium text-slate-700">About this chat</span>
          <span className="block text-[12px] leading-[1.65] text-slate-600">{intro}</span>
        </span>
      )}
    </span>
  );
}

function SidebarToggleButton({ visible, onToggle, t }: { visible: boolean; onToggle: () => void; t: AiChatStrings }) {
  return (
    <button
      type="button"
      data-pl-no-drag="chat-list-toggle"
      aria-label={visible ? t.hideChatList : t.showChatList}
      aria-expanded={visible}
      title={visible ? t.hideChatList : t.showChatList}
      onClick={onToggle}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sky-300 bg-sky-100 text-sky-700 transition hover:bg-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
    >
      {visible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
    </button>
  );
}

/** Left sidebar */
function ChatHistorySidebar({ sessions, activeId, onSelect, onDelete, onNew, onToggle, t }: {
  sessions: OcrAiChatSession[];
  activeId: string | null;
  onSelect: (s: OcrAiChatSession) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onToggle: () => void;
  t: AiChatStrings;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <aside
      className="flex w-48 shrink-0 flex-col border-r border-black/5"
      style={{ background: SIDEBAR_BG }}
    >
      {/* Header */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Chats</p>
          <SidebarToggleButton visible onToggle={onToggle} t={t} />
        </div>
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-normal text-slate-700 transition hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
      </div>

      {/* Session list */}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
        {sessions.length === 0 && (
          <li className="px-2 py-6 text-center text-[11px] text-slate-400">No history yet</li>
        )}
        {sessions.map((s) => (
          <li
            key={s.id}
            className={cn(
              "group relative flex cursor-pointer items-start gap-1.5 rounded-lg px-2.5 py-2 text-[11px] transition",
              activeId === s.id
                ? "bg-[#e0f2fe]/80 text-slate-800"
                : "text-slate-600 hover:bg-black/5 hover:text-slate-800"
            )}
          >
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(s)}>
              <span className="flex items-center gap-1.5 leading-snug">
                <MessageSquare className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate">{s.title}</span>
              </span>
              <span className="ml-4.5 mt-0.5 block text-[10px] text-slate-400">
                {new Date(s.createdAt).toLocaleDateString()}
              </span>
            </button>
            {confirmId === s.id ? (
              <span className="flex shrink-0 flex-col gap-0.5">
                <button type="button" onClick={() => { onDelete(s.id); setConfirmId(null); }}
                  className="rounded-md bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-600">
                  Del
                </button>
                <button type="button" onClick={() => setConfirmId(null)}
                  className="rounded-md border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100">
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(s.id)}
                className="shrink-0 rounded-md p-0.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500"
                title="Delete this chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Saved-rules sidebar. Replaces the chat list while the Rules tab is open: one row per voucher type
 * (plus "All"), each showing how many rules it holds, and clicking a row filters the rules pane to it.
 */
function RulesTypeSidebar({ rules, selected, onSelect, onToggle, t }: {
  rules: OcrAiRulesList | null;
  selected: OcrAiDocTypeKey | "all";
  onSelect: (v: OcrAiDocTypeKey | "all") => void;
  onToggle: () => void;
  t: AiChatStrings;
}) {
  const total = rulesCount(rules);
  const rows: { key: OcrAiDocTypeKey | "all"; label: string; count: number; removed: number }[] = [
    { key: "all", label: t.rulesAll, count: total, removed: 0 },
    ...OCR_AI_DOC_TYPES.map((k) => ({
      key: k,
      label: t.docTypes[k],
      count: rules?.types[k]?.rules.length ?? 0,
      removed: rules?.types[k]?.removed ?? 0,
    })),
  ];
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-black/5" style={{ background: SIDEBAR_BG }}>
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{t.rulesFilter}</p>
          <SidebarToggleButton visible onToggle={onToggle} t={t} />
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
        {rows.map((r) => {
          const active = selected === r.key;
          const dim = r.count === 0 && r.key !== "all";
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onSelect(r.key)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
                  active
                    ? "bg-[#e0f2fe]/80 font-medium text-black"
                    : "text-slate-700 hover:bg-black/5 hover:text-black"
                )}
              >
                <span className="min-w-0 flex-1 truncate leading-snug">{r.label}</span>
                {r.count > 0 ? (
                  <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-black",
                    active ? "bg-[#bae6fd]/70" : "bg-black/5"
                  )}>{r.count}</span>
                ) : dim ? (
                  <span className="shrink-0 text-[12px] text-slate-400">—</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function AiChatDialog({ open, onOpenChange, companyId, docType, getBill, getVoucherJson, getOwnCompany, autoStartKey, copilot }: AiChatDialogProps) {
  const t = useAiChatStrings();
  const copilotMode = Boolean(copilot);
  const [copilotZIndex, setCopilotZIndex] = useState(COPILOT_Z_FOCUSED);
  const [chatListVisible, setChatListVisible] = useState(true);
  const [tab, setTab] = useState<"chat" | "rules">("chat");
  const [turns, setTurns] = useState<OcrAiChatTurn[]>(() => autoStartKey ? [] : loadChatSession(companyId));
  const [input, setInput] = useState("");
  /* Grow the composer with its content (2 rows → 8rem cap) so long messages stay readable instead of
   * being clipped to a single line with a scrollbar. */
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);
  const [attachBill, setAttachBill] = useState(Boolean(copilot));
  const [attachJson, setAttachJson] = useState(Boolean(copilot));
  const [sending, setSending] = useState(false);
  const [rules, setRules] = useState<OcrAiRulesList | null>(null);
  const [rulesBusy, setRulesBusy] = useState<string | null>(null);
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usage, setUsage] = useState<AiChatUsageState>(() => loadUsage(companyId));
  const [limits, setLimits] = useState<OcrAiLimits | undefined>(undefined);
  const [models, setModels] = useState<OcrAiModelOption[]>(FALLBACK_MODELS);
  const [activeModel, setActiveModel] = useState<string>("gemini-3.5-flash-lite");
  const [canChangeModel, setCanChangeModel] = useState(false);
  const [modelStatusLoaded, setModelStatusLoaded] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [newType, setNewType] = useState<OcrAiDocTypeKey>(docType ?? "general");
  /** Rules tab: which voucher type's rules are shown. `all` = every type in one list. */
  const [rulesType, setRulesType] = useState<OcrAiDocTypeKey | "all">("all");
  const [newText, setNewText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStartSentRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [attachedFile, setAttachedFile] = useState<{ file: File; preview: string | null } | null>(null);
  const pickFile = () => fileInputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedFile({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    e.target.value = "";
  };
  const clearAttachedFile = () => {
    if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
    setAttachedFile(null);
  };

  const [sessions, setSessions] = useState<OcrAiChatSession[]>(() => loadChatHistory(companyId));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const flushToHistory = (currentTurns: OcrAiChatTurn[], sessionId: string | null): string => {
    if (!currentTurns.length) return sessionId ?? newChatSessionId();
    const id = sessionId ?? newChatSessionId();
    const title = deriveChatTitle(currentTurns);
    setSessions((prev) => {
      const existing = prev.findIndex((s) => s.id === id);
      const updated: OcrAiChatSession = { id, title, createdAt: existing >= 0 ? prev[existing].createdAt : Date.now(), turns: currentTurns };
      const next = (existing >= 0 ? prev.map((s) => (s.id === id ? updated : s)) : [updated, ...prev]).slice(0, AI_CHAT_MAX_SESSIONS);
      saveChatHistory(companyId, next);
      return next;
    });
    return id;
  };

  const startNewChat = () => {
    if (turns.length) { flushToHistory(turns, activeSessionId); setActiveSessionId(null); }
    setTurns([]); setAttachBill(false); setAttachJson(Boolean(copilot));
    saveChatSession(companyId, []);
  };

  const loadSession = (s: OcrAiChatSession) => {
    if (turns.length && activeSessionId !== s.id) flushToHistory(turns, activeSessionId);
    /* Historical suggestions must never be applied to a different voucher. */
    const historicalTurns = s.turns.map(({ voucherPatch: _voucherPatch, ...turn }) => turn);
    setTurns(historicalTurns); setActiveSessionId(s.id);
    saveChatSession(companyId, historicalTurns);
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => { const next = prev.filter((s) => s.id !== id); saveChatHistory(companyId, next); return next; });
    if (activeSessionId === id) { setTurns([]); setActiveSessionId(null); saveChatSession(companyId, []); }
  };

  useEffect(() => { saveChatSession(companyId, turns); }, [companyId, turns]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [turns, sending]);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Ribbon budget + model picker: server status (defaults keep the picker usable while it loads).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getOcrAiStatusCached(companyId, { timeoutMs: 12000 })
      .then((s) => {
        if (!alive) return;
        if (s.limits) setLimits(s.limits);
        if (s.models?.length) setModels(s.models);
        setActiveModel(s.modelActive ?? s.model ?? "");
        setCanChangeModel(s.isAdmin === true || s.canChangeModel === true);
        setModelStatusLoaded(true);
      })
      .catch(() => { if (alive) setModelStatusLoaded(false); });
    return () => { alive = false; };
  }, [open, companyId]);

  // Not loaded yet: let the signed-in user try (the server still enforces admin-only).
  const canPickModel = modelStatusLoaded ? canChangeModel : true;

  const switchModel = async (id: string) => {
    if (!id || id === activeModel || modelBusy) return;
    setModelBusy(true); setModelErr(null);
    try {
      const r = await setOcrAiModel(id);
      setActiveModel(r.model);
      invalidateOcrAiStatus(companyId);
      const s = await getOcrAiStatus(companyId);
      setModels(s.models ?? []);
      setActiveModel(s.modelActive ?? r.model);
    } catch (e) {
      setModelErr(ocrAiErrorText(e));
    } finally { setModelBusy(false); }
  };

  const loadRules = async () => {
    setRulesBusy("load"); setRulesMsg(null);
    try { setRules(await listOcrAiRules(companyId)); }
    catch (e) { setRulesMsg({ ok: false, text: chatErrorText(e, t) }); }
    finally { setRulesBusy(null); }
  };

  const send = async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if ((!text && !attachedFile) || sending) return;
    const wantBill = attachBill, wantJson = attachJson, fileToSend = attachedFile;
    const voucherJson = wantJson && getVoucherJson ? getVoucherJson() ?? undefined : undefined;
    let voucherJsonText = "";
    if (voucherJson !== undefined) {
      try { voucherJsonText = typeof voucherJson === "string" ? voucherJson : JSON.stringify(voucherJson); } catch { voucherJsonText = ""; }
    }
    const keepJsonPreview = !!voucherJsonText && !turns.some((turn) => turn.voucherJsonPreview);
    const partyTitle = keepJsonPreview ? partyNameFromVoucherJson(voucherJson) : undefined;
    const userTurn: OcrAiChatTurn = {
      id: newTurnId(), role: "user", text: text || "📎", at: Date.now(),
      hadImage: (wantBill && !!getBill) || !!fileToSend,
      hadJson: voucherJson !== undefined,
      ...(keepJsonPreview ? { voucherJsonPreview: voucherJsonText.slice(0, 8000) } : {}),
      ...(partyTitle ? { chatTitle: partyTitle } : {}),
    };
    const next = [...turns, userTurn];
    setTurns(next); setInput(""); setSending(true);
    setAttachBill(false); setAttachJson(Boolean(copilot)); clearAttachedFile();
    const ac = new AbortController(); abortRef.current = ac;
    const hadImage = !!(fileToSend || (wantBill && getBill));
    try {
      let imageBase64: string | undefined, mimeType: string | undefined;
      if (fileToSend) { const r = await aiChatJpeg(fileToSend.file, fileToSend.file.type); imageBase64 = r.b64; mimeType = "image/jpeg"; }
      else if (wantBill && getBill) { const b = await getBill(); if (!b) throw new Error(t.noBill); imageBase64 = (await aiChatJpeg(b.blob, b.mime)).b64; mimeType = "image/jpeg"; }
      const r = await ocrAiChat({ companyId, messages: chatPayload(next), docType, imageBase64, mimeType, voucherJson, ownCompany: getOwnCompany?.(), copilot: !!copilot, masters: copilot ? copilot.getMasters() : undefined, signal: ac.signal });
      setUsage(recordUsage(companyId, { ok: true, promptTokens: r.usage.promptTokens, outputTokens: r.usage.outputTokens, totalTokens: r.usage.totalTokens, hadImage }));
      if (copilot && r.missingMasters.length) copilot.onMissingMasters?.(r.missingMasters);
      const finalTurns = [...next, { id: newTurnId(), role: "model" as const, text: r.reply === "(no answer)" ? t.noAnswer : r.reply, at: Date.now(), proposedRule: r.proposedRule, tokens: r.usage.totalTokens, voucherPatch: copilot ? r.voucherPatch ?? undefined : undefined, proposal: copilot ? r.masterCreate ?? undefined : undefined }];
      setTurns(finalTurns);
      const sid = flushToHistory(finalTurns, activeSessionId);
      if (!activeSessionId) setActiveSessionId(sid);
    } catch (e) {
      setUsage(recordUsage(companyId, { ok: false }));
      setTurns((cur) => [...cur, { id: newTurnId(), role: "model", text: chatErrorText(e, t), at: Date.now(), error: true }]);
    } finally { abortRef.current = null; setSending(false); }
  };

  useEffect(() => {
    if (!copilotMode || !open || !autoStartKey || autoStartSentRef.current === autoStartKey) return;
    autoStartSentRef.current = autoStartKey;
    void send("Maine voucher ka document aur OCR JSON bheja hai. Is data se voucher ke khaali sahi fields bhariye. Agar koi dikkat, mismatch ya zaroori jaankari missing ho to mujhe batayein aur ek sawal poochhein.");
  }, [open, autoStartKey, copilotMode, send]);

  const editRule = (id: string, rule: OcrAiProposedRule) => setTurns((cur) => cur.map((x) => (x.id === id ? { ...x, proposedRule: rule } : x)));

  const saveProposed = async (turn: OcrAiChatTurn) => {
    if (!turn.proposedRule) return;
    setRulesBusy(`save:${turn.id}`);
    try { await saveOcrAiRule(companyId, turn.proposedRule, "chat"); setTurns((cur) => cur.map((x) => (x.id === turn.id ? { ...x, ruleSaved: true } : x))); setRules(null); }
    catch (e) { setTurns((cur) => [...cur, { id: newTurnId(), role: "model", text: `${t.ruleNotSaved}: ${chatErrorText(e, t)}`, at: Date.now(), error: true }]); }
    finally { setRulesBusy(null); }
  };

  const addManual = async () => {
    const text = newText.trim(); if (!text) return;
    setRulesBusy("add"); setRulesMsg(null);
    try { await saveOcrAiRule(companyId, { docType: newType, text }, "manual"); setNewText(""); setRules(await listOcrAiRules(companyId)); setRulesMsg({ ok: true, text: t.ruleSavedMsg }); }
    catch (e) { setRulesMsg({ ok: false, text: chatErrorText(e, t) }); }
    finally { setRulesBusy(null); }
  };

  const remove = async (type: OcrAiDocTypeKey, id: string) => {
    setRulesBusy(`rm:${id}`); setRulesMsg(null);
    try { await removeOcrAiRule(companyId, type, id); setConfirmRemove(null); setRules(await listOcrAiRules(companyId)); setRulesMsg({ ok: true, text: t.ruleRemovedMsg }); }
    catch (e) { setRulesMsg({ ok: false, text: chatErrorText(e, t) }); }
    finally { setRulesBusy(null); }
  };

  const tabBtn = (k: "chat" | "rules", label: string) => (
    <button
      type="button"
      onClick={() => { setTab(k); if (k === "rules" && !rules && !rulesBusy) void loadRules(); }}
      className={cn(
        "rounded-full px-3 py-1 text-[11px] transition-colors",
        tab === k
          ? "bg-white/95 font-medium text-[#0ea5e9]"
          : "font-normal text-white/75 hover:bg-white/10 hover:text-white"
      )}
    >
      {label}
    </button>
  );

  /* Copilot uses the same bounds/state-driven drag and resize flow as AddVoucherDialog, kept local
   * here so the voucher implementation and its behavior stay untouched. */
  const [copilotSize, setCopilotSize] = useState({ w: 460, h: 560 });
  const [copilotPosition, setCopilotPosition] = useState({ x: 0, y: 0 });
  const copilotBoundsRef = useRef<CopilotBounds>({ x: 0, y: 0, w: 460, h: 560 });
  const copilotDragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const copilotResizeRef = useRef<{ handle: string; startX: number; startY: number; startW: number; startH: number; startLeft: number; startTop: number } | null>(null);
  const prevCopilotOpenRef = useRef(false);

  React.useEffect(() => {
    if (!copilotMode) {
      prevCopilotOpenRef.current = false;
      return;
    }

    if (open && !prevCopilotOpenRef.current && typeof window !== "undefined") {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const defaultW = Math.max(COPILOT_MIN_W, Math.min(Math.round(Math.min(460, vw * 0.32)), vw));
      const defaultH = Math.max(COPILOT_MIN_H, Math.min(Math.round(vh * 0.95), vh));
      let bounds: CopilotBounds = {
        x: Math.max(0, vw - defaultW - 12),
        y: Math.max(0, Math.round((vh - defaultH) / 2)),
        w: defaultW,
        h: defaultH,
      };
      try {
        const saved = JSON.parse(localStorage.getItem(COPILOT_STORAGE_KEY) || "null") as Partial<CopilotBounds> | null;
        if (saved && typeof saved.w === "number" && typeof saved.h === "number") {
          const w = Math.max(COPILOT_MIN_W, Math.min(saved.w, vw));
          const h = Math.max(COPILOT_MIN_H, Math.min(saved.h, vh));
          bounds = {
            x: typeof saved.x === "number" ? Math.max(0, Math.min(saved.x, vw - w)) : bounds.x,
            y: typeof saved.y === "number" ? Math.max(0, Math.min(saved.y, vh - h)) : bounds.y,
            w,
            h,
          };
        }
      } catch {
        /* Use the default bounds if saved layout is unavailable. */
      }
      copilotBoundsRef.current = bounds;
      setCopilotSize({ w: bounds.w, h: bounds.h });
      setCopilotPosition({ x: bounds.x, y: bounds.y });
    } else if (!open && prevCopilotOpenRef.current && typeof window !== "undefined") {
      try {
        localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify(copilotBoundsRef.current));
      } catch {
        /* ignore */
      }
    }
    prevCopilotOpenRef.current = open;
  }, [copilotMode, open]);

  React.useEffect(() => {
    copilotBoundsRef.current = {
      ...copilotBoundsRef.current,
      x: copilotPosition.x,
      y: copilotPosition.y,
      w: copilotSize.w,
      h: copilotSize.h,
    };
  }, [copilotPosition.x, copilotPosition.y, copilotSize.w, copilotSize.h]);

  const persistCopilotBounds = () => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify(copilotBoundsRef.current));
    } catch {
      /* ignore */
    }
  };

  const handleCopilotDragStart = (e: React.MouseEvent) => {
    if (!copilotMode) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='switch'], [role='combobox'], [role='tab'], [data-radix-select-trigger], [data-pl-no-drag]")) return;
    e.preventDefault();
    copilotDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: copilotPosition.x,
      startTop: copilotPosition.y,
    };
    const onMove = (ev: MouseEvent) => {
      if (!copilotDragRef.current) return;
      const x = Math.max(0, copilotDragRef.current.startLeft + ev.clientX - copilotDragRef.current.startX);
      const y = Math.max(0, copilotDragRef.current.startTop + ev.clientY - copilotDragRef.current.startY);
      setCopilotPosition({ x, y });
      copilotBoundsRef.current = { ...copilotBoundsRef.current, x, y };
    };
    const onUp = () => {
      copilotDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      persistCopilotBounds();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleCopilotResizeStart = (e: React.MouseEvent, handle: string) => {
    if (!copilotMode) return;
    e.preventDefault();
    e.stopPropagation();
    copilotResizeRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startW: copilotSize.w,
      startH: copilotSize.h,
      startLeft: copilotPosition.x,
      startTop: copilotPosition.y,
    };
    const onMove = (ev: MouseEvent) => {
      if (!copilotResizeRef.current) return;
      const { handle: activeHandle, startX, startY, startW, startH, startLeft, startTop } = copilotResizeRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let w = startW;
      let h = startH;
      if (activeHandle === "e" || activeHandle === "se" || activeHandle === "ne") w = Math.max(COPILOT_MIN_W, Math.min(startW + dx, vw));
      if (activeHandle === "w" || activeHandle === "sw" || activeHandle === "nw") {
        const dw = Math.min(dx, startW - COPILOT_MIN_W);
        w = Math.max(COPILOT_MIN_W, Math.min(startW - dw, vw));
      }
      if (activeHandle === "s" || activeHandle === "se" || activeHandle === "sw") h = Math.max(COPILOT_MIN_H, Math.min(startH + dy, vh));
      if (activeHandle === "n" || activeHandle === "nw" || activeHandle === "ne") {
        const dh = Math.min(dy, startH - COPILOT_MIN_H);
        h = Math.max(COPILOT_MIN_H, Math.min(startH - dh, vh));
      }
      let x = startLeft;
      let y = startTop;
      if (activeHandle === "w" || activeHandle === "sw" || activeHandle === "nw") x = startLeft + (startW - w);
      if (activeHandle === "n" || activeHandle === "nw" || activeHandle === "ne") y = startTop + (startH - h);
      setCopilotSize({ w, h });
      if (x !== startLeft || y !== startTop) setCopilotPosition({ x, y });
      copilotBoundsRef.current = { x, y, w, h };
    };
    const onUp = () => {
      copilotResizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      persistCopilotBounds();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* Clicking the voucher dialog (or anywhere outside) must NOT dismiss the chat. Only the X (or the
   * header pill toggle) closes it. */
  /* Keep the voucher's stacking untouched. The voucher's full-screen transparent shell can receive
   * clicks over the visible chat area, outside the smaller voucher frame. Detect that hit by geometry
   * and raise the chat. Depend on the mode boolean, not the bridge object (the parent recreates it on
   * every voucher render, including every resize tick). */
  React.useEffect(() => {
    if (!copilotMode || !open) return;
    setCopilotZIndex(COPILOT_Z_FOCUSED);
    const containsPoint = (el: HTMLElement, x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    const onWindowPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-pl-ocr-ai-chat]")) {
        setCopilotZIndex(COPILOT_Z_FOCUSED);
        return;
      }

      const voucherFrameAtPoint = Array.from(document.querySelectorAll<HTMLElement>("[data-voucher-frame]"))
        .some((frame) => containsPoint(frame, event.clientX, event.clientY));
      if (voucherFrameAtPoint) return; // Keep both voucher and chat clear above the backdrop.

      /* The z-81 voucher DialogContent spans the viewport; its visible frame is only a child. If a
       * click lands on that transparent shell where the chat is visible, treat it as a chat click. */
      const dialogShell = target.closest<HTMLElement>("[data-pl-dialog-shell]");
      const isVoucherShell = !!dialogShell?.querySelector("[data-voucher-frame]");
      const chat = document.querySelector<HTMLElement>("[data-pl-ocr-ai-chat]");
      if (isVoucherShell && chat && containsPoint(chat, event.clientX, event.clientY)) {
        setCopilotZIndex(COPILOT_Z_FOCUSED);
      }
    };
    const onWindowMouseDown = (event: MouseEvent) => onWindowPointerDown(event);
    document.addEventListener("pointerdown", onWindowPointerDown, true);
    document.addEventListener("mousedown", onWindowMouseDown, true);
    return () => {
      document.removeEventListener("pointerdown", onWindowPointerDown, true);
      document.removeEventListener("mousedown", onWindowMouseDown, true);
    };
  }, [copilotMode, open]);
  /* A master dialog opened from the voucher (Create Party, Bank, Items…) must sit above the chat even
   * while the chat is focused. Watch only NEW dialogs appearing: a plain "any other role=dialog exists"
   * check also matched the chat's own (inert/closed) shells and cancelled every focus raise. */
  React.useEffect(() => {
    if (!copilotMode || !open) return;
    const isForeignDialog = (node: Node) => {
      if (!(node instanceof HTMLElement)) return false;
      const dlg = node.matches('[role="dialog"]') ? node : node.querySelector<HTMLElement>('[role="dialog"]');
      return !!dlg && !dlg.hasAttribute("data-pl-ocr-ai-chat");
    };
    const obs = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of Array.from(rec.addedNodes)) {
          if (isForeignDialog(node)) {
            /* Master dialogs (Create Party, Bank, Items…) must sit above the chat. */
            setCopilotZIndex(COPILOT_Z);
            return;
          }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [copilotMode, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={!copilot}>
      {copilot ? null : (
        <DialogPrimitive.Portal>
          <div aria-hidden className="fixed inset-0 bg-black/60 backdrop-blur-md" style={{ zIndex: CHAT_Z - 1 }} />
        </DialogPrimitive.Portal>
      )}
      <DialogContent
        overlayClassName="hidden"
        hideCloseButton
        style={
          copilot
            ? {
                /* Controlled by copilotZIndex so React keeps the selected window order through renders. */
                left: copilotPosition.x,
                top: copilotPosition.y,
                zIndex: copilotZIndex,
                width: copilotSize.w,
                maxWidth: "none",
                height: copilotSize.h,
                transform: "none",
                translate: "none",
                position: "fixed",
                borderRadius: "0.75rem",
                overflow: "hidden",
                padding: 0,
                border: "1px solid rgb(203 213 225)",
                boxShadow: "0 24px 60px -16px rgba(15,23,42,0.35), 0 8px 20px -8px rgba(15,23,42,0.18)",
              }
            : CHAT_CONTENT_STYLE
        }
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          /* Copilot is a free-floating window. Do NOT add `!left-0 !top-0` here: those compile to
           * `!important` and silently beat the inline left/top that drag writes, pinning the window. */
          copilot && "animate-none duration-0"
        )}
        onFocusOutside={(e) => e.preventDefault()}
        onPointerDownOutside={copilot ? (e) => e.preventDefault() : undefined}
        onInteractOutside={copilot ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={copilot ? (e) => e.preventDefault() : undefined}
        onPointerDownCapture={copilot ? () => setCopilotZIndex(COPILOT_Z_FOCUSED) : undefined}
        onMouseDownCapture={copilot ? () => setCopilotZIndex(COPILOT_Z_FOCUSED) : undefined}
        onClick={(e) => {
          if (copilot) setCopilotZIndex(COPILOT_Z_FOCUSED);
          e.stopPropagation();
        }}
        data-pl-ocr-ai-chat=""
        data-pl-drag-surface={copilot ? "active" : undefined}
      >
        {/* Copilot: resize handles + draggable ribbon (same machinery as the voucher dialogs). */}
        {copilot ? (
          <>
            {(["n", "s", "w", "e", "nw", "ne", "sw", "se"] as const).map((h) => (
              <div
                key={h}
                onMouseDown={(e) => handleCopilotResizeStart(e, h)}
                className={cn(
                  "absolute z-[35] pointer-events-auto transition-colors hover:bg-primary/25",
                  h === "n" && "left-4 right-4 top-0 h-2 cursor-row-resize",
                  h === "s" && "left-4 right-4 bottom-0 h-2 cursor-row-resize",
                  h === "w" && "top-4 bottom-4 left-0 w-1.5 cursor-col-resize",
                  h === "e" && "top-4 bottom-4 right-0 w-1.5 cursor-col-resize",
                  h === "nw" && "left-0 top-0 h-4 w-4 cursor-nw-resize",
                  h === "ne" && "right-0 top-0 h-4 w-4 cursor-ne-resize",
                  h === "sw" && "left-0 bottom-0 h-4 w-4 cursor-sw-resize",
                  h === "se" && "right-0 bottom-0 h-4 w-4 cursor-se-resize"
                )}
                style={{
                  cursor:
                    h === "n" || h === "s" ? "row-resize" :
                    h === "w" || h === "e" ? "col-resize" : `${h}-resize`,
                }}
                aria-hidden
              />
            ))}
            {/* Header itself is the drag handle (see DialogHeader onMouseDown); its buttons are
                pointer-events-auto so they never start a drag. */}
          </>
        ) : null}
        {/* ── Header (WhatsApp green) ── */}
        <DialogHeader
          className={cn("relative shrink-0 px-4 pb-2.5 pt-3 text-left", copilot && "cursor-grab active:cursor-grabbing select-none")}
          style={{ background: ACCENT }}
          onMouseDown={copilot ? handleCopilotDragStart : undefined}
        >
          <div className="z-30 flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-white">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <Bot className="h-4 w-4 text-white" />
              </div>
              {t.title}
              {/* Info popup — hover (desktop) + click/touch (mobile) */}
              <InfoPopup intro={t.intro.replace("{n}", String(AI_CHAT_SEND_LAST))} />
            </DialogTitle>
            <div className="flex min-w-0 items-center gap-2">
              <AiChatUsageChips
                state={usage}
                limits={limits}
                onClear={() => setUsage(clearUsage(companyId))}
              />
              {/* Close button */}
              <DialogPrimitive.Close
                data-pl-no-drag="close"
                className={cn(
                  "shrink-0 p-1.5 transition",
                  copilot
                    ? "absolute right-1 top-1 z-40 rounded-sm bg-white text-slate-600 ring-1 ring-black/10 hover:bg-slate-100 hover:text-slate-900"
                    : "rounded-full text-white/80 hover:bg-white/15 hover:text-white"
                )}
                style={copilot ? { width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" } : undefined}
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>
          {/* Tabs — the pills click; the free header space beside them drags the window. */}
          <div className="relative z-30 mt-2 flex items-center gap-1" style={{ width: "fit-content" }}>
            {tabBtn("chat", t.tabChat)}
            {tabBtn("rules", `${t.tabRules}${rules ? ` (${rulesCount(rules)})` : ""}`)}
          </div>
        </DialogHeader>

        {/* ── Body ── */}
        <div className="flex min-h-0 flex-1 overflow-hidden" style={{ background: CHAT_CANVAS_BG }}>
          {/* Sidebar toggle stays in the same top-left rail position when the list is collapsed. */}
          {chatListVisible ? (
            tab === "rules" ? (
              <RulesTypeSidebar rules={rules} selected={rulesType} onSelect={setRulesType} onToggle={() => setChatListVisible(false)} t={t} />
            ) : (
              <ChatHistorySidebar
                sessions={sessions}
                activeId={activeSessionId}
                onSelect={loadSession}
                onDelete={deleteSession}
                onNew={startNewChat}
                onToggle={() => setChatListVisible(false)}
                t={t}
              />
            )
          ) : (
            <aside className="flex w-12 shrink-0 flex-col items-center border-r border-black/5 pt-3" style={{ background: SIDEBAR_BG }}>
              <SidebarToggleButton visible={false} onToggle={() => setChatListVisible(true)} t={t} />
            </aside>
          )}

          {/* Main area */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === "chat" ? (
              <>
                {/* Messages */}
                <div
                  ref={listRef}
                  className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/15"
                  style={{ background: CHAT_CANVAS_BG }}
                >
                  {!turns.length ? (
                    <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: ACCENT }}>
                        <Sparkles className="h-6 w-6 text-white" />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-500" style={{ maxWidth: "280px" }}>
                        {t.emptyExample}
                      </p>
                    </div>
                  ) : null}

                  {turns.map((turn) => (
                    <div key={turn.id} className={cn("flex gap-2", turn.role === "user" ? "justify-end" : "justify-start")}>
                      {turn.role === "model" && (
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: ACCENT }}>
                          <Bot className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                      <div
                        style={{
                          maxWidth: "78%",
                          background: turn.role === "user" ? BUBBLE_OUT : turn.error ? "#fef2f2" : BUBBLE_IN,
                        }}
                        className={cn(
                          "space-y-1.5 rounded-lg px-3 py-2 text-xs shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
                          turn.role === "user"
                            ? "rounded-tr-none text-slate-800"
                            : turn.error
                            ? "rounded-tl-none border border-red-200 text-red-800"
                            : "rounded-tl-none text-slate-800"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{turn.text}</p>
                        {turn.hadImage || turn.hadJson ? (
                          <p className="text-[10px] text-slate-500">
                            {[turn.hadImage && "📎 " + t.billSent, turn.hadJson && "📊 " + t.jsonSent].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {turn.voucherJsonPreview ? (
                          <details className="mt-1 max-w-full rounded-md border border-sky-200 bg-white/80 p-1.5">
                            <summary className="cursor-pointer select-none text-[10px] font-medium text-sky-700">{t.viewJson}</summary>
                            <pre className="mt-1 max-h-44 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-1.5 text-[9px] leading-relaxed text-slate-600">{turn.voucherJsonPreview}</pre>
                          </details>
                        ) : null}
                        {turn.tokens ? (
                          <p className="text-[10px] text-slate-400">
                            {t.tokens} {turn.tokens}
                          </p>
                        ) : null}
                        {/* Copilot: what this turn changed on the live form (left window). */}
                        {turn.applied?.length ? (
                          <p className="flex flex-wrap gap-1">
                            {turn.applied.map((a) => (
                              <span key={a} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                                ✓ {a}
                              </span>
                            ))}
                          </p>
                        ) : null}
                        {turn.voucherPatch && !turn.voucherPatchDone ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!copilot) return;
                              const applied = copilot.onPatch(turn.voucherPatch!);
                              setTurns((current) => current.map((x) => x.id === turn.id ? { ...x, voucherPatchDone: true, applied } : x));
                            }}
                            className="mt-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:brightness-95"
                            style={{ background: ACCENT }}
                          >
                            {t.fillOnVoucher}
                          </button>
                        ) : null}
                        {turn.voucherPatchDone ? (
                          <p className="text-[10px] font-medium text-emerald-700">
                            {turn.applied?.length ? `✓ ${t.voucherFilled}: ${turn.applied.join(", ")}` : t.voucherNothingToFill}
                          </p>
                        ) : null}
                        {/* Copilot: master creation proposal — the user confirms, the app opens its own form. */}
                        {turn.proposal && !turn.proposalDone ? (
                          <div className="mt-2 space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2">
                            <p className="text-[11px] font-medium text-amber-900">
                              Create {turn.proposal.kind}: <b>{turn.proposal.name}</b>?
                            </p>
                            {turn.proposal.account_no || turn.proposal.pan || turn.proposal.phone ? (
                              <p className="text-[10px] text-amber-800">
                                {[
                                  turn.proposal.pan && `PAN ${turn.proposal.pan}`,
                                  turn.proposal.phone && `Phone ${turn.proposal.phone}`,
                                  turn.proposal.account_no && `A/c ${turn.proposal.account_no}${turn.proposal.bank_name ? ` (${turn.proposal.bank_name})` : ""}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  copilot?.onCreateMaster(turn.proposal!);
                                  setTurns((c) => c.map((x) => (x.id === turn.id ? { ...x, proposalDone: "created" } : x)));
                                }}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white"
                                style={{ background: ACCENT }}
                              >
                                <UserPlus className="h-3 w-3" /> Create &amp; link
                              </button>
                              <button
                                type="button"
                                onClick={() => setTurns((c) => c.map((x) => (x.id === turn.id ? { ...x, proposalDone: "dismissed" } : x)))}
                                className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-white"
                              >
                                Not now
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {turn.proposalDone ? (
                          <p className="text-[10px] text-slate-400">{turn.proposalDone === "created" ? "✓ Create form opened — confirm Save there" : "Not created"}</p>
                        ) : null}
                        {turn.proposedRule ? (
                          <div className="mt-2 space-y-2 rounded-lg border border-black/10 bg-slate-50 p-2.5">
                            <p className="text-[11px] font-medium text-slate-700">{t.proposedRule}</p>
                            <DocTypeSelect value={turn.proposedRule.docType} disabled={turn.ruleSaved} onChange={(v) => editRule(turn.id, { ...turn.proposedRule!, docType: v })} t={t} />
                            <textarea
                              value={turn.proposedRule.text}
                              disabled={turn.ruleSaved}
                              onChange={(e) => editRule(turn.id, { ...turn.proposedRule!, text: e.target.value })}
                              rows={3}
                              className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]"
                            />
                            {turn.ruleSaved ? (
                              <p className="text-[11px] font-medium text-emerald-600">✓ {t.saved}</p>
                            ) : (
                              <button
                                type="button"
                                disabled={!turn.proposedRule.text.trim() || rulesBusy === `save:${turn.id}`}
                                onClick={() => void saveProposed(turn)}
                                className="flex items-center gap-1 rounded-lg px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                                style={{ background: ACCENT }}
                              >
                                {rulesBusy === `save:${turn.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t.saveRule}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {turn.role === "user" && (
                        <div
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none text-white ring-1 ring-black/10"
                          style={{ background: ACCENT }}
                        >
                          U
                        </div>
                      )}
                    </div>
                  ))}

                  {sending && (
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: ACCENT }}>
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="flex gap-1 rounded-lg rounded-tl-none bg-white px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Input area — grows 19% when a file is attached */}
                <div
                  className="flex shrink-0 flex-col border-t border-black/10 px-3 py-2"
                  style={{
                    background: INPUT_BG,
                    height: attachedFile ? "max(105px, 21.5%)" : CHAT_INPUT_H,
                    minHeight: attachedFile ? "max(105px, 21.5%)" : CHAT_INPUT_H,
                  }}
                >
                    {/* Chips row — attach/type chips only */}
                    {(getBill || getVoucherJson || docType) && (
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {getBill && (
                          <label className="flex cursor-pointer items-center gap-1 rounded-full border border-black/10 bg-white px-2 py-0.5 text-slate-600 transition hover:bg-slate-50">
                            <input type="checkbox" checked={attachBill} onChange={(e) => setAttachBill(e.target.checked)} className="accent-[#0ea5e9]" /> {t.attachBill}
                          </label>
                        )}
                        {getVoucherJson && (
                          <label className="flex cursor-pointer items-center gap-1 rounded-full border border-black/10 bg-white px-2 py-0.5 text-slate-600 transition hover:bg-slate-50" title={t.sendJsonTitle}>
                            <input type="checkbox" checked={attachJson} onChange={(e) => setAttachJson(e.target.checked)} className="accent-[#0ea5e9]" /> {t.sendJson}
                          </label>
                        )}
                        {docType && (
                          <span className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-slate-500">
                            {t.typeLabel}: {t.docTypes[docType]}
                          </span>
                        )}
                      </div>
                    )}

                    <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFileChange} />

                    {/* Composer: textarea on top (full width), model + send on one row below. */}
                    <div data-pl-ai-composer-field className="relative flex shrink-0 flex-col gap-1 rounded-2xl border border-black/10 bg-white px-1 py-1 shadow-sm">
                      {/* Attach button — top-right of the field */}
                      <button
                        type="button"
                        onClick={pickFile}
                        disabled={sending}
                        title="Attach image or PDF"
                        className="absolute right-1.5 top-1.5 z-10 shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>
                      {/* File preview — thumbnail only (2x), inside the textarea, click to open */}
                      {attachedFile && (
                        <div className="group relative w-fit pl-1 pt-1">
                          <button
                            type="button"
                            title="Open preview"
                            onClick={() => {
                              if (attachedFile.preview) window.open(attachedFile.preview, "_blank");
                              else window.open(URL.createObjectURL(attachedFile.file), "_blank");
                            }}
                            className="block h-12 w-12 overflow-hidden rounded-lg border border-black/10 bg-white transition group-hover:ring-2 group-hover:ring-[#0ea5e9]/50"
                          >
                            {attachedFile.preview
                              ? <img src={attachedFile.preview} alt="preview" className="h-full w-full object-cover" />
                              : <span className="flex h-full w-full items-center justify-center bg-slate-100"><Paperclip className="h-5 w-5 text-slate-500" /></span>
                            }
                          </button>
                          <button
                            type="button"
                            title="Remove attachment"
                            aria-label="Remove attachment"
                            onClick={clearAttachedFile}
                            className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-600 text-white opacity-0 shadow-md transition-opacity duration-100 hover:bg-red-700 focus:opacity-100 group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" strokeWidth={3} />
                          </button>
                        </div>
                      )}

                      {/* Textarea — full width of the field, no model pill beside it stealing space */}
                      <textarea
                        ref={composerRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={(e) => {
                          /* Some embedded/desktop shells swallow the native paste into a controlled
                           * textarea; insert the clipboard text ourselves at the caret. */
                          const text = e.clipboardData?.getData("text");
                          if (!text) return;
                          e.preventDefault();
                          const el = e.currentTarget;
                          const start = el.selectionStart ?? input.length;
                          const end = el.selectionEnd ?? input.length;
                          const next = input.slice(0, start) + text + input.slice(end);
                          setInput(next);
                          requestAnimationFrame(() => {
                            el.selectionStart = el.selectionEnd = start + text.length;
                          });
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                        rows={2}
                        placeholder={t.placeholder}
                        style={{ resize: "none", minHeight: "4rem", maxHeight: "12rem" }}
                        className="w-full resize-none bg-transparent px-2 py-1.5 pr-9 text-[13px] leading-5 text-black placeholder-slate-400 focus:outline-none"
                      />
                      {/* Bottom row: model picker left, send button right */}
                      <div className="flex shrink-0 items-center justify-between gap-1 px-1 pb-0.5">
                        <AiModelPicker
                          current={activeModel}
                          models={models}
                          canChange={canPickModel}
                          busy={modelBusy}
                          error={modelErr}
                          onPick={(id) => void switchModel(id)}
                        />
                        <button
                          type="button"
                          disabled={(!input.trim() && !attachedFile) || sending}
                          onClick={() => void send()}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-2 text-white transition hover:brightness-110 disabled:opacity-40"
                          style={{ background: ACCENT, boxSizing: "border-box" }}
                        >
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                </div>
              </>
            ) : (
              /* ── Rules Tab ── */
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ background: CHAT_CANVAS_BG }}>
                {rulesBusy === "load" && !rules ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.loadingRules}</div>
                ) : null}
                {rulesMsg ? (
                  <div className={cn("rounded-lg px-3 py-2.5 text-xs", rulesMsg.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200")}>
                    {rulesMsg.text}
                  </div>
                ) : null}
                {rules ? (
                  <>
                    {rules.folder ? <p className="break-all text-[11px] text-slate-400">{t.serverFolder}: <span className="font-mono">{rules.folder}</span></p> : null}
                    {rules.canEdit ? (
                      <div className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
                        <p className="mb-2 text-xs font-medium text-slate-700">{t.addRule}</p>
                        <DocTypeSelect value={newType} onChange={setNewType} t={t} />
                        <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={2} placeholder={t.addRulePlaceholder}
                          className="mt-2 w-full rounded-lg border border-black/10 bg-slate-50 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0ea5e9]" />
                        <button type="button" disabled={!newText.trim() || !!rulesBusy} onClick={() => void addManual()}
                          className="mt-2 flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          style={{ background: ACCENT }}>
                          {rulesBusy === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t.saveRule}
                        </button>
                      </div>
                    ) : <p className="text-[11px] text-slate-400">{t.onlyAdmin}</p>}
                    {OCR_AI_DOC_TYPES.map((dt) => {
                      if (rulesType !== "all" && dt !== rulesType) return null;
                      const g = rules.types[dt];
                      if (!g.rules.length && !g.error) {
                        return rulesType === "all" ? null : (
                          <p key={dt} className="text-xs text-slate-400">{t.noRules}</p>
                        );
                      }
                      return (
                        <div key={dt} className="space-y-1">
                          <p className="text-xs font-medium text-slate-700">{t.docTypes[dt]} <span className="font-normal text-slate-400">({g.rules.length}{g.removed ? `, ${g.removed} ${t.removed}` : ""})</span></p>
                          {g.error ? <p className="text-[11px] text-red-500">{g.error}</p> : null}
                          <ul className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
                            {g.rules.map((r) => (
                              <li key={r.id} className="flex items-start gap-2 border-b border-black/5 px-3 py-2 text-xs last:border-b-0">
                                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-600">{r.text}</span>
                                {rules.canEdit ? (
                                  confirmRemove === r.id ? (
                                    <span className="flex shrink-0 gap-1">
                                      <button type="button" disabled={!!rulesBusy} onClick={() => void remove(dt, r.id)} className="rounded-md bg-red-500 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50">{t.remove}</button>
                                      <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-md border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600">{t.cancel}</button>
                                    </span>
                                  ) : (
                                    <button type="button" title={t.removeTitle} onClick={() => setConfirmRemove(r.id)} className="shrink-0 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                                  )
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    {!rulesCount(rules) && rulesType === "all" ? <p className="text-xs text-slate-400">{t.noRules}</p> : null}
                  </>
                ) : null}
                {!rules && rulesBusy !== "load" ? (
                  <button type="button" onClick={() => void loadRules()}
                    className="rounded-lg border border-black/10 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50">
                    {t.loadRules}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AiChatButton({ label, className, ...rest }: Omit<AiChatDialogProps, "open" | "onOpenChange"> & { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const t = useAiChatStrings();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={t.buttonTitle}
        data-pl-ocr-ai-chat-button=""
      >
        <Bot className="h-3.5 w-3.5" /> {label ?? t.chatButton}
      </Button>
      {open ? <AiChatDialog key={rest.companyId} open={open} onOpenChange={setOpen} {...rest} /> : null}
    </>
  );
}

/**
 * OCR-bar AI button. In copilot mode it does NOT open the popup chat (the docked panel is the chat);
 * it just toggles that panel, so the form and the conversation stay visible together.
 */
export function AiPanelToggle({ on, onClick, className, label }: { on: boolean; onClick: () => void; className?: string; label?: string }) {
  const t = useAiChatStrings();
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "default" : "outline"}
      className={className}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={on ? "Hide Pocket AI" : "Open Pocket AI beside the form"}
      data-pl-ocr-ai-copilot-toggle=""
    >
      <Bot className="h-3.5 w-3.5" /> {label ?? (on ? "Hide AI" : "Pocket AI")}
      <span className="sr-only">{t.buttonTitle}</span>
    </Button>
  );
}
