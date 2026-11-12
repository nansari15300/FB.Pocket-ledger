"use client";
/**
 * AI chat / teaching (OCR-owned, ai-plan.md Phase 1 + 3).
 */
import React, { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bot, Info, Loader2, MessageSquare, Paperclip, Plus, Save, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { aiChatJpeg } from "../engine";
import { OcrAiError, listOcrAiRules, ocrAiChat, ocrAiErrorText, removeOcrAiRule, saveOcrAiRule } from "./aiClient";
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
  boxShadow: "0 25px 60px -10px rgba(0,0,0,0.35), 0 10px 25px -5px rgba(0,0,0,0.2)",
};

export type AiChatDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  docType?: OcrAiDocTypeKey;
  getBill?: () => Promise<{ blob: Blob; mime: string } | null>;
  getVoucherJson?: () => unknown;
  getOwnCompany?: () => { name?: string | null; pan?: string | null };
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
      className="h-7 rounded-lg border border-violet-200 bg-violet-50 px-2 text-xs text-violet-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
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
          className="absolute left-0 top-7 z-[9999] w-72 rounded-2xl border border-slate-100 bg-white p-4 shadow-2xl"
          style={{ boxShadow: "0 16px 48px -8px rgba(109,40,217,0.2), 0 6px 16px -4px rgba(0,0,0,0.12)" }}
        >
          {/* Arrow */}
          <span className="absolute -top-1.5 left-3 h-3 w-3 rotate-45 border-l border-t border-slate-100 bg-white" />
          <span className="relative mb-1.5 block text-[13px] font-semibold text-violet-700">About this chat</span>
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
      className="flex w-48 shrink-0 flex-col"
      style={{ background: "linear-gradient(180deg, #1e1b4b 0%, #312e81 60%, #4c1d95 100%)" }}
    >
      {/* Header */}
      <div className="shrink-0 px-3 pb-2 pt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-violet-300">Chats</p>
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-violet-500/40 bg-white/10 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
      </div>

      {/* Session list */}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-violet-500/40">
        {sessions.length === 0 && (
          <li className="px-2 py-6 text-center text-[11px] text-violet-400">No history yet</li>
        )}
        {sessions.map((s) => (
          <li
            key={s.id}
            className={cn(
              "group relative flex cursor-pointer items-start gap-1.5 rounded-xl px-2.5 py-2 text-[11px] transition",
              activeId === s.id
                ? "bg-white/20 font-semibold text-white"
                : "text-violet-200 hover:bg-white/10 hover:text-white"
            )}
          >
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(s)}>
              <span className="flex items-center gap-1.5 leading-snug">
                <MessageSquare className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">{s.title}</span>
              </span>
              <span className="ml-4.5 mt-0.5 block text-[10px] opacity-50">
                {new Date(s.createdAt).toLocaleDateString()}
              </span>
            </button>
            {confirmId === s.id ? (
              <span className="flex shrink-0 flex-col gap-0.5">
                <button type="button" onClick={() => { onDelete(s.id); setConfirmId(null); }}
                  className="rounded-lg bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-red-600">
                  Del
                </button>
                <button type="button" onClick={() => setConfirmId(null)}
                  className="rounded-lg border border-violet-400/50 px-1.5 py-0.5 text-[10px] text-violet-200 hover:bg-white/10">
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(s.id)}
                className="shrink-0 rounded-lg p-0.5 text-violet-400/70 transition hover:bg-red-500/20 hover:text-red-400"
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

export function AiChatDialog({ open, onOpenChange, companyId, docType, getBill, getVoucherJson, getOwnCompany }: AiChatDialogProps) {
  const t = useAiChatStrings();
  const [tab, setTab] = useState<"chat" | "rules">("chat");
  const [turns, setTurns] = useState<OcrAiChatTurn[]>(() => loadChatSession(companyId));
  const [input, setInput] = useState("");
  const [attachBill, setAttachBill] = useState(false);
  const [attachJson, setAttachJson] = useState(false);
  const [sending, setSending] = useState(false);
  const [rules, setRules] = useState<OcrAiRulesList | null>(null);
  const [rulesBusy, setRulesBusy] = useState<string | null>(null);
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
    try {
      let imageBase64: string | undefined, mimeType: string | undefined;
      if (fileToSend) { const r = await aiChatJpeg(fileToSend.file, fileToSend.file.type); imageBase64 = r.b64; mimeType = "image/jpeg"; }
      else if (wantBill && getBill) { const b = await getBill(); if (!b) throw new Error(t.noBill); imageBase64 = (await aiChatJpeg(b.blob, b.mime)).b64; mimeType = "image/jpeg"; }
      const voucherJson = wantJson && getVoucherJson ? getVoucherJson() ?? undefined : undefined;
      const r = await ocrAiChat({ companyId, messages: chatPayload(next), docType, imageBase64, mimeType, voucherJson, ownCompany: getOwnCompany?.(), signal: ac.signal });
      const finalTurns = [...next, { id: newTurnId(), role: "model" as const, text: r.reply === "(no answer)" ? t.noAnswer : r.reply, at: Date.now(), proposedRule: r.proposedRule, tokens: r.usage.totalTokens }];
      setTurns(finalTurns);
      const sid = flushToHistory(finalTurns, activeSessionId);
      if (!activeSessionId) setActiveSessionId(sid);
    } catch (e) {
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
        "rounded-full px-4 py-1 text-xs font-semibold transition-all",
        tab === k
          ? "bg-white text-violet-700 shadow-md"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      )}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <div aria-hidden className="fixed inset-0 bg-black/60 backdrop-blur-md" style={{ zIndex: CHAT_Z - 1 }} />
      </DialogPrimitive.Portal>
      <DialogContent
        overlayClassName="hidden"
        style={CHAT_CONTENT_STYLE}
        className="flex flex-col gap-0 overflow-hidden p-0"
        onFocusOutside={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        data-pl-ocr-ai-chat=""
      >
        {/* ── Gradient Header ── */}
        <DialogHeader
          className="shrink-0 px-5 pb-3 pt-4 text-left"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #9333ea 100%)" }}
        >
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-white">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Bot className="h-4 w-4 text-white" />
              </div>
              {t.title}
              {/* Info popup — hover (desktop) + click/touch (mobile) */}
              <InfoPopup intro={t.intro.replace("{n}", String(AI_CHAT_SEND_LAST))} />
            </DialogTitle>
            {/* Close button */}
            <DialogPrimitive.Close className="rounded-full p-1.5 text-white/70 transition hover:bg-white/20 hover:text-white">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {/* Tabs */}
          <div className="mt-2.5 flex items-center gap-1 rounded-full bg-white/10 p-0.5 backdrop-blur-sm" style={{ width: "fit-content" }}>
            {tabBtn("chat", t.tabChat)}
            {tabBtn("rules", `${t.tabRules}${rules ? ` (${rulesCount(rules)})` : ""}`)}
          </div>
        </DialogHeader>

        {/* ── Body ── */}
        <div className="flex min-h-0 flex-1 overflow-hidden" style={{ background: "#f8f7ff" }}>
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
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-violet-200"
                  style={{ background: "linear-gradient(180deg, #f8f7ff 0%, #faf5ff 100%)" }}
                >
                  {!turns.length ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-200">
                        <Sparkles className="h-7 w-7 text-white" />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-500" style={{ maxWidth: "280px" }}>
                        {t.emptyExample}
                      </p>
                    </div>
                  ) : null}

                  {turns.map((turn) => (
                    <div key={turn.id} className={cn("flex gap-2", turn.role === "user" ? "justify-end" : "justify-start")}>
                      {turn.role === "model" && (
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
                          <Bot className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                      <div
                        style={{ maxWidth: "78%" }}
                        className={cn(
                          "space-y-1.5 rounded-2xl px-3.5 py-2.5 text-xs shadow-sm",
                          turn.role === "user"
                            ? "rounded-tr-sm bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-600 text-white shadow-violet-200"
                            : turn.error
                            ? "rounded-tl-sm border border-red-100 bg-red-50 text-red-800"
                            : "rounded-tl-sm border border-violet-100 bg-white text-slate-700 shadow-violet-100"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{turn.text}</p>
                        {turn.hadImage || turn.hadJson ? (
                          <p className="text-[10px] opacity-70">
                            {[turn.hadImage && "📎 " + t.billSent, turn.hadJson && "📊 " + t.jsonSent].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {turn.tokens ? (
                          <p className={cn("text-[10px]", turn.role === "user" ? "text-white/60" : "text-violet-400")}>
                            {t.tokens} {turn.tokens}
                          </p>
                        ) : null}
                        {turn.proposedRule ? (
                          <div className="mt-2 space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-2.5">
                            <p className="text-[11px] font-bold text-violet-700">{t.proposedRule}</p>
                            <DocTypeSelect value={turn.proposedRule.docType} disabled={turn.ruleSaved} onChange={(v) => editRule(turn.id, { ...turn.proposedRule!, docType: v })} t={t} />
                            <textarea
                              value={turn.proposedRule.text}
                              disabled={turn.ruleSaved}
                              onChange={(e) => editRule(turn.id, { ...turn.proposedRule!, text: e.target.value })}
                              rows={3}
                              className="w-full rounded-xl border border-violet-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
                            />
                            {turn.ruleSaved ? (
                              <p className="text-[11px] font-semibold text-emerald-600">✓ {t.saved}</p>
                            ) : (
                              <button
                                type="button"
                                disabled={!turn.proposedRule.text.trim() || rulesBusy === `save:${turn.id}`}
                                onClick={() => void saveProposed(turn)}
                                className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm disabled:opacity-50"
                              >
                                {rulesBusy === `save:${turn.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t.saveRule}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {turn.role === "user" && (
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-[10px] font-bold text-white shadow-sm">
                          U
                        </div>
                      )}
                    </div>
                  ))}

                  {sending && (
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600">
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="flex gap-1 rounded-2xl rounded-tl-sm border border-violet-100 bg-white px-3 py-2.5 shadow-sm">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Input area */}
                <div className="shrink-0 border-t border-violet-100 bg-white px-4 py-3">
                  {/* Chips row */}
                  {(getBill || getVoucherJson || docType) && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                      {getBill && (
                        <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-700 transition hover:bg-violet-100">
                          <input type="checkbox" checked={attachBill} onChange={(e) => setAttachBill(e.target.checked)} className="accent-violet-600" /> {t.attachBill}
                        </label>
                      )}
                      {getVoucherJson && (
                        <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-700 transition hover:bg-violet-100" title={t.sendJsonTitle}>
                          <input type="checkbox" checked={attachJson} onChange={(e) => setAttachJson(e.target.checked)} className="accent-violet-600" /> {t.sendJson}
                        </label>
                      )}
                      {docType && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-500">
                          {t.typeLabel}: {t.docTypes[docType]}
                        </span>
                      )}
                    </div>
                  )}

                  {/* File preview */}
                  {attachedFile && (
                    <div className="mb-2 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs">
                      {attachedFile.preview
                        ? <img src={attachedFile.preview} alt="preview" className="h-9 w-9 rounded-lg object-cover shadow" />
                        : <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-200"><Paperclip className="h-4 w-4 text-violet-600" /></div>
                      }
                      <span className="min-w-0 flex-1 truncate font-medium text-violet-700">{attachedFile.file.name}</span>
                      <button type="button" onClick={clearAttachedFile} className="rounded-full p-0.5 text-violet-400 hover:bg-violet-200 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFileChange} />

                  {/* Textarea row */}
                  <div className="flex items-end gap-2 rounded-2xl border border-violet-200 bg-violet-50/50 px-1 py-1 shadow-sm focus-within:border-violet-400 focus-within:shadow-md focus-within:shadow-violet-100 transition-all">
                    <button
                      type="button"
                      onClick={pickFile}
                      disabled={sending}
                      title="Attach image or PDF"
                      className="shrink-0 rounded-xl p-2 text-violet-400 transition hover:bg-violet-100 hover:text-violet-600 disabled:opacity-40"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                      rows={1}
                      placeholder={t.placeholder}
                      style={{ minHeight: "2.5rem", maxHeight: "10vh", resize: "none" }}
                      className="flex-1 bg-transparent py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={(!input.trim() && !attachedFile) || sending}
                      onClick={() => void send()}
                      className="shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-600 p-2.5 text-white shadow-md shadow-violet-300 transition hover:shadow-lg hover:shadow-violet-300 disabled:opacity-40"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* ── Rules Tab ── */
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ background: "linear-gradient(180deg, #f8f7ff 0%, #faf5ff 100%)" }}>
                {rulesBusy === "load" && !rules ? (
                  <div className="flex items-center gap-2 text-xs text-violet-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.loadingRules}</div>
                ) : null}
                {rulesMsg ? (
                  <div className={cn("rounded-xl px-3 py-2.5 text-xs font-medium", rulesMsg.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-red-50 text-red-800 border border-red-100")}>
                    {rulesMsg.text}
                  </div>
                ) : null}
                {rules ? (
                  <>
                    {rules.folder ? <p className="break-all text-[11px] text-violet-400">{t.serverFolder}: <span className="font-mono">{rules.folder}</span></p> : null}
                    {rules.canEdit ? (
                      <div className="rounded-2xl border border-violet-100 bg-white p-3 shadow-sm">
                        <p className="mb-2 text-xs font-semibold text-violet-700">{t.addRule}</p>
                        <DocTypeSelect value={newType} onChange={setNewType} t={t} />
                        <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={2} placeholder={t.addRulePlaceholder}
                          className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400" />
                        <button type="button" disabled={!newText.trim() || !!rulesBusy} onClick={() => void addManual()}
                          className="mt-2 flex items-center gap-1 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                          {rulesBusy === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t.saveRule}
                        </button>
                      </div>
                    ) : <p className="text-[11px] text-slate-400">{t.onlyAdmin}</p>}
                    {OCR_AI_DOC_TYPES.map((dt) => {
                      const g = rules.types[dt];
                      if (!g.rules.length && !g.error) return null;
                      return (
                        <div key={dt} className="space-y-1">
                          <p className="text-xs font-bold text-violet-700">{t.docTypes[dt]} <span className="font-normal text-violet-400">({g.rules.length}{g.removed ? `, ${g.removed} ${t.removed}` : ""})</span></p>
                          {g.error ? <p className="text-[11px] text-red-500">{g.error}</p> : null}
                          <ul className="overflow-hidden rounded-xl border border-violet-100 bg-white shadow-sm">
                            {g.rules.map((r) => (
                              <li key={r.id} className="flex items-start gap-2 border-b border-violet-50 px-3 py-2 text-xs last:border-b-0">
                                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-600">{r.text}</span>
                                {rules.canEdit ? (
                                  confirmRemove === r.id ? (
                                    <span className="flex shrink-0 gap-1">
                                      <button type="button" disabled={!!rulesBusy} onClick={() => void remove(dt, r.id)} className="rounded-lg bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50">{t.remove}</button>
                                      <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-lg border px-2 py-0.5 text-[10px]">{t.cancel}</button>
                                    </span>
                                  ) : (
                                    <button type="button" title={t.removeTitle} onClick={() => setConfirmRemove(r.id)} className="shrink-0 text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
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
                    className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-xs font-medium text-violet-600 shadow-sm hover:bg-violet-50">
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
