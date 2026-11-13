"use client";
/**
 * AI chat / teaching (OCR-owned, ai-plan.md Phase 1 + 3).
 */
import React, { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bot, Info, Loader2, MessageSquare, Paperclip, Plus, Save, Send, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePersistedResizableDialogSize } from "@/lib/usePersistedResizableDialogSize";
import { aiChatJpeg } from "../engine";
import { OcrAiError, getOcrAiStatus, getOcrAiStatusCached, invalidateOcrAiStatus, listOcrAiRules, ocrAiChat, ocrAiErrorText, removeOcrAiRule, saveOcrAiRule, setOcrAiModel, type OcrAiLimits, type OcrAiMasterLists, type OcrAiMasterProposal, type OcrAiMissingMaster, type OcrAiModelOption, type OcrAiVoucherPatch } from "./aiClient";
import { AiChatUsageChips } from "./AiChatUsageChips";
import { AiModelPicker } from "./AiModelPicker";
import { clearUsage, loadUsage, recordUsage, type AiChatUsageState } from "./aiChatUsage";
import { useAiChatStrings, type AiChatStrings } from "./aiChatStrings";
import {
  OCR_AI_DOC_TYPES,
  AI_CHAT_SEND_LAST,
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
/* The voucher dialog keeps its own stacking (z-[81]); we never touch it. The chat hops around it:
 * click the chat   → z-82 (above the voucher shell AND its portals)
 * click the voucher → z-79 (under the voucher and under its master dialogs) */
const COPILOT_Z = 79;
const COPILOT_Z_FOCUSED = 82;
const COPILOT_STORAGE_KEY = "pl.ocr.copilot.window.v4";
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
  /**
   * Copilot mode (OCR Settings → AI Copilot): the SAME window renders as a floating, draggable,
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

/** Left sidebar */
function ChatHistorySidebar({ sessions, activeId, onSelect, onDelete, onNew }: {
  sessions: OcrAiChatSession[];
  activeId: string | null;
  onSelect: (s: OcrAiChatSession) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <aside
      className="flex w-48 shrink-0 flex-col border-r border-black/5"
      style={{ background: SIDEBAR_BG }}
    >
      {/* Header */}
      <div className="shrink-0 px-3 pb-2 pt-4">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">Chats</p>
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

export function AiChatDialog({ open, onOpenChange, companyId, docType, getBill, getVoucherJson, getOwnCompany, copilot }: AiChatDialogProps) {
  const t = useAiChatStrings();
  const [copilotZIndex, setCopilotZIndex] = useState(COPILOT_Z_FOCUSED);
  const [tab, setTab] = useState<"chat" | "rules">("chat");
  const [turns, setTurns] = useState<OcrAiChatTurn[]>(() => loadChatSession(companyId));
  const [input, setInput] = useState("");
  const [attachBill, setAttachBill] = useState(false);
  const [attachJson, setAttachJson] = useState(false);
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
  const [newText, setNewText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
      const next = existing >= 0 ? prev.map((s) => (s.id === id ? updated : s)) : [updated, ...prev];
      saveChatHistory(companyId, next);
      return next;
    });
    return id;
  };

  const startNewChat = () => {
    if (turns.length) { flushToHistory(turns, activeSessionId); setActiveSessionId(null); }
    setTurns([]); setAttachBill(false); setAttachJson(false);
    saveChatSession(companyId, []);
  };

  const loadSession = (s: OcrAiChatSession) => {
    if (turns.length && activeSessionId !== s.id) flushToHistory(turns, activeSessionId);
    setTurns(s.turns); setActiveSessionId(s.id);
    saveChatSession(companyId, s.turns);
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

  const send = async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || sending) return;
    const userTurn: OcrAiChatTurn = { id: newTurnId(), role: "user", text: text || "📎", at: Date.now(), hadImage: (attachBill && !!getBill) || !!attachedFile, hadJson: attachJson && !!getVoucherJson };
    const next = [...turns, userTurn];
    setTurns(next); setInput(""); setSending(true);
    const wantBill = attachBill, wantJson = attachJson, fileToSend = attachedFile;
    setAttachBill(false); setAttachJson(false); clearAttachedFile();
    const ac = new AbortController(); abortRef.current = ac;
    const hadImage = !!(fileToSend || (wantBill && getBill));
    try {
      let imageBase64: string | undefined, mimeType: string | undefined;
      if (fileToSend) { const r = await aiChatJpeg(fileToSend.file, fileToSend.file.type); imageBase64 = r.b64; mimeType = "image/jpeg"; }
      else if (wantBill && getBill) { const b = await getBill(); if (!b) throw new Error(t.noBill); imageBase64 = (await aiChatJpeg(b.blob, b.mime)).b64; mimeType = "image/jpeg"; }
      const voucherJson = wantJson && getVoucherJson ? getVoucherJson() ?? undefined : undefined;
      const r = await ocrAiChat({ companyId, messages: chatPayload(next), docType, imageBase64, mimeType, voucherJson, ownCompany: getOwnCompany?.(), copilot: !!copilot, masters: copilot ? copilot.getMasters() : undefined, signal: ac.signal });
      setUsage(recordUsage(companyId, { ok: true, promptTokens: r.usage.promptTokens, outputTokens: r.usage.outputTokens, totalTokens: r.usage.totalTokens, hadImage }));
      /* Copilot: the patch goes into the LIVE form first, so the chips describe what really changed. */
      const applied = copilot && r.voucherPatch ? copilot.onPatch(r.voucherPatch) : [];
      if (copilot && r.missingMasters.length) copilot.onMissingMasters?.(r.missingMasters);
      const finalTurns = [...next, { id: newTurnId(), role: "model" as const, text: r.reply === "(no answer)" ? t.noAnswer : r.reply, at: Date.now(), proposedRule: r.proposedRule, tokens: r.usage.totalTokens, applied: applied.length ? applied : undefined, proposal: copilot ? r.masterCreate ?? undefined : undefined }];
      setTurns(finalTurns);
      const sid = flushToHistory(finalTurns, activeSessionId);
      if (!activeSessionId) setActiveSessionId(sid);
    } catch (e) {
      setUsage(recordUsage(companyId, { ok: false }));
      setTurns((cur) => [...cur, { id: newTurnId(), role: "model", text: chatErrorText(e, t), at: Date.now(), error: true }]);
    } finally { abortRef.current = null; setSending(false); }
  };

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

  /* Copilot mode: the SAME chat shell, but as a floating resizable window — no overlay, no focus trap,
   * so the voucher form stays visible AND editable beside it. Modal mode is untouched. */
  const copilotResizable = usePersistedResizableDialogSize(!!copilot && open, !!copilot && open, COPILOT_STORAGE_KEY, {
    minW: 320,
    minH: 280,
    defaultW: (vw) => Math.round(Math.min(460, vw * 0.32)),
    defaultH: (vh) => Math.round(vh * 0.7),
    /* Open against the right edge so the chat never covers the voucher dialog (which stays at
     * z-[81]); the user can drag it anywhere afterwards. */
    defaultPosition: (vw, vh, w, h) => ({
      x: Math.max(0, vw - w - 12),
      y: Math.max(0, Math.round((vh - h) / 2)),
    }),
  });

  /* Clicking the voucher dialog (or anywhere outside) must NOT dismiss the chat. Only the X (or the
   * header pill toggle) closes it. */
  /* Keep the voucher's stacking untouched. Drive the chat's stacking through React state so later
   * renders (including resize commits) preserve whichever window the user clicked most recently. */
  React.useEffect(() => {
    if (!copilot || !open) return;
    setCopilotZIndex(COPILOT_Z_FOCUSED);
    const onWindowPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-pl-ocr-ai-chat]")) {
        setCopilotZIndex(COPILOT_Z_FOCUSED);
      } else if (target.closest("[data-voucher-frame]")) {
        setCopilotZIndex(COPILOT_Z);
      }
    };
    const onWindowMouseDown = (event: MouseEvent) => onWindowPointerDown(event);
    document.addEventListener("pointerdown", onWindowPointerDown, true);
    document.addEventListener("mousedown", onWindowMouseDown, true);
    return () => {
      document.removeEventListener("pointerdown", onWindowPointerDown, true);
      document.removeEventListener("mousedown", onWindowMouseDown, true);
    };
  }, [copilot, open]);
  /* A master dialog opened from the voucher (Create Party, Bank, Items…) must sit above the chat even
   * while the chat is focused. Watch only NEW dialogs appearing: a plain "any other role=dialog exists"
   * check also matched the chat's own (inert/closed) shells and cancelled every focus raise. */
  React.useEffect(() => {
    if (!copilot || !open) return;
    const isForeignDialog = (node: Node) => {
      if (!(node instanceof HTMLElement)) return false;
      const dlg = node.matches('[role="dialog"]') ? node : node.querySelector<HTMLElement>('[role="dialog"]');
      return !!dlg && !dlg.hasAttribute("data-pl-ocr-ai-chat");
    };
    const obs = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of Array.from(rec.addedNodes)) {
          if (isForeignDialog(node)) {
            /* Master dialogs (Create Party, Bank, Items…) must sit above the chat. They are portaled to
             * body with their own z-80/81, so keep the chat under them just while one is open. */
            setCopilotZIndex(COPILOT_Z);
            return;
          }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [copilot, open]);
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
                left: copilotResizable.position.x,
                top: copilotResizable.position.y,
                zIndex: copilotZIndex,
                width: copilotResizable.size.w,
                height: copilotResizable.size.h,
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
                onMouseDown={(e) => copilotResizable.handleResizeStart(e, h)}
                className={cn(
                  "absolute z-30",
                  h === "n" && "left-2 right-2 top-0 h-1.5 cursor-ns-resize",
                  h === "s" && "left-2 right-2 bottom-0 h-1.5 cursor-ns-resize",
                  h === "w" && "top-2 bottom-2 left-0 w-1.5 cursor-ew-resize",
                  h === "e" && "top-2 bottom-2 right-0 w-1.5 cursor-ew-resize",
                  h === "nw" && "left-0 top-0 h-3 w-3 cursor-nwse-resize",
                  h === "ne" && "right-0 top-0 h-3 w-3 cursor-nesw-resize",
                  h === "sw" && "left-0 bottom-0 h-3 w-3 cursor-nesw-resize",
                  h === "se" && "right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
                )}
                aria-hidden
              />
            ))}
            {/* Header itself is the drag handle (see DialogHeader onMouseDown); its buttons are
                pointer-events-auto so they never start a drag. */}
          </>
        ) : null}
        {/* ── Header (WhatsApp green) ── */}
        <DialogHeader
          className={cn("relative shrink-0 px-4 pb-2.5 pt-3 text-left", copilot && "cursor-move select-none")}
          style={{ background: ACCENT }}
          onMouseDown={copilot ? copilotResizable.handleDragStart : undefined}
        >
          <div className="relative z-30 flex items-center justify-between gap-2">
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
          {/* Left sidebar */}
          <ChatHistorySidebar
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={loadSession}
            onDelete={deleteSession}
            onNew={startNewChat}
          />

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

                    {/* Textarea field — thumbnail sits INSIDE it */}
                    <div data-pl-ai-composer-field className="relative flex min-h-0 flex-1 flex-col gap-1 rounded-2xl border border-black/10 bg-white px-1 py-1 shadow-sm">
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

                      {/* Textarea + actions */}
                      <div className="flex min-h-0 flex-1 items-end gap-1">
                        <textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                          rows={1}
                          placeholder={t.placeholder}
                          style={{ minHeight: "2rem", resize: "none" }}
                          className="h-full flex-1 self-stretch bg-transparent py-1.5 pl-2 pr-10 text-[13px] text-slate-700 placeholder-slate-400 focus:outline-none"
                        />
                        {/* Model pill — same bottom row as Send, 40px to its left */}
                        <div className="flex shrink-0 items-end self-stretch pr-[40px]">
                          <div className="ml-auto flex items-center">
                            <AiModelPicker
                              current={activeModel}
                              models={models}
                              canChange={canPickModel}
                              busy={modelBusy}
                              error={modelErr}
                              onPick={(id) => void switchModel(id)}
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={(!input.trim() && !attachedFile) || sending}
                          onClick={() => void send()}
                          className="mb-0 flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-full p-3 text-white transition hover:brightness-110 disabled:opacity-40"
                          style={{ background: ACCENT, boxSizing: "border-box" }}
                        >
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
                      const g = rules.types[dt];
                      if (!g.rules.length && !g.error) return null;
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
                    {!rulesCount(rules) ? <p className="text-xs text-slate-400">{t.noRules}</p> : null}
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
      title={on ? "Hide AI Copilot" : "Open AI Copilot beside the form"}
      data-pl-ocr-ai-copilot-toggle=""
    >
      <Bot className="h-3.5 w-3.5" /> {label ?? (on ? "Hide AI" : "AI Copilot")}
      <span className="sr-only">{t.buttonTitle}</span>
    </Button>
  );
}
