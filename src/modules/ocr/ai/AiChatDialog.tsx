"use client";
/**
 * AI chat / teaching (OCR-owned, ai-plan.md Phase 1 + 3). The admin explains in chat how a bill must be read; Gemini
 * answers and may propose ONE rule; "Save rule" stores it on the server in the visible training folder (outside
 * pb_data) and every later AI scan of that document type gets it. History stays in this browser session only; each
 * send carries the last 12 text turns, and the bill photo / AI JSON only with the turn where it is attached.
 */
import React, { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bot, Loader2, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
} from "./aiChatModel";

/*
 * Stacking: above every voucher dialog (New / Edit Trxn z-80/81, nested 90-102) and the OCR settings dialog
 * (overlay 2147482998 / content 2147483000). INLINE z-index on purpose: tailwind.config does not scan
 * src/modules/**, so an arbitrary class like z-[2147483002] written here is never generated (the chat then
 * fell back to z-50 and opened BEHIND the voucher dialog). Radix portals both layers to document.body.
 */
const CHAT_Z = 2147483002;
const CHAT_CONTENT_STYLE: React.CSSProperties = {
  zIndex: CHAT_Z,
  height: "85vh",
  maxHeight: "85vh",
  width: "min(720px, calc(100vw - 1.5rem))",
  maxWidth: "min(720px, calc(100vw - 1.5rem))",
};

export type AiChatDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  /** Document type of the open voucher form (rules in focus). */
  docType?: OcrAiDocTypeKey;
  /** Current bill (first attachment) for "Attach this bill". */
  getBill?: () => Promise<{ blob: Blob; mime: string } | null>;
  /** Current AI voucher JSON (last AI scan) for "Send AI result". */
  getVoucherJson?: () => unknown;
  getOwnCompany?: () => { name?: string | null; pan?: string | null };
};

/** 404 on a chat / rules call = the server hooks are older than this app. */
function chatErrorText(e: unknown, t: AiChatStrings): string {
  if (e instanceof OcrAiError && e.status === 404) return t.chatNotInstalled;
  return ocrAiErrorText(e);
}

function DocTypeSelect({ value, onChange, disabled, id, t }: { value: OcrAiDocTypeKey; onChange: (v: OcrAiDocTypeKey) => void; disabled?: boolean; id?: string; t: AiChatStrings }) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as OcrAiDocTypeKey)}
      className="h-8 rounded-md border border-slate-300 bg-transparent px-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
    >
      {OCR_AI_DOC_TYPES.map((k) => <option key={k} value={k}>{t.docTypes[k]}</option>)}
    </select>
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

  useEffect(() => { saveChatSession(companyId, turns); }, [companyId, turns]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const loadRules = async () => {
    setRulesBusy("load");
    setRulesMsg(null);
    try {
      setRules(await listOcrAiRules(companyId));
    } catch (e) {
      setRulesMsg({ ok: false, text: chatErrorText(e, t) });
    } finally {
      setRulesBusy(null);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userTurn: OcrAiChatTurn = { id: newTurnId(), role: "user", text, at: Date.now(), hadImage: attachBill && !!getBill, hadJson: attachJson && !!getVoucherJson };
    const next = [...turns, userTurn];
    setTurns(next);
    setInput("");
    setSending(true);
    const wantBill = attachBill;
    const wantJson = attachJson;
    // A photo / JSON goes only with THIS turn (never re-sent with later messages)
    setAttachBill(false);
    setAttachJson(false);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let imageBase64: string | undefined;
      if (wantBill && getBill) {
        const b = await getBill();
        if (!b) throw new Error(t.noBill);
        imageBase64 = (await aiChatJpeg(b.blob, b.mime)).b64;
      }
      const voucherJson = wantJson && getVoucherJson ? getVoucherJson() ?? undefined : undefined;
      const r = await ocrAiChat({
        companyId,
        messages: chatPayload(next),
        docType,
        imageBase64,
        mimeType: imageBase64 ? "image/jpeg" : undefined,
        voucherJson,
        ownCompany: getOwnCompany?.(),
        signal: ac.signal,
      });
      setTurns((cur) => [...cur, { id: newTurnId(), role: "model", text: r.reply === "(no answer)" ? t.noAnswer : r.reply, at: Date.now(), proposedRule: r.proposedRule, tokens: r.usage.totalTokens }]);
    } catch (e) {
      setTurns((cur) => [...cur, { id: newTurnId(), role: "model", text: chatErrorText(e, t), at: Date.now(), error: true }]);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const editRule = (id: string, rule: OcrAiProposedRule) => setTurns((cur) => cur.map((x) => (x.id === id ? { ...x, proposedRule: rule } : x)));

  const saveProposed = async (turn: OcrAiChatTurn) => {
    if (!turn.proposedRule) return;
    setRulesBusy(`save:${turn.id}`);
    try {
      await saveOcrAiRule(companyId, turn.proposedRule, "chat");
      setTurns((cur) => cur.map((x) => (x.id === turn.id ? { ...x, ruleSaved: true } : x)));
      setRules(null);
    } catch (e) {
      setTurns((cur) => [...cur, { id: newTurnId(), role: "model", text: `${t.ruleNotSaved}: ${chatErrorText(e, t)}`, at: Date.now(), error: true }]);
    } finally {
      setRulesBusy(null);
    }
  };

  const addManual = async () => {
    const text = newText.trim();
    if (!text) return;
    setRulesBusy("add");
    setRulesMsg(null);
    try {
      await saveOcrAiRule(companyId, { docType: newType, text }, "manual");
      setNewText("");
      setRules(await listOcrAiRules(companyId));
      setRulesMsg({ ok: true, text: t.ruleSavedMsg });
    } catch (e) {
      setRulesMsg({ ok: false, text: chatErrorText(e, t) });
    } finally {
      setRulesBusy(null);
    }
  };

  const remove = async (type: OcrAiDocTypeKey, id: string) => {
    setRulesBusy(`rm:${id}`);
    setRulesMsg(null);
    try {
      await removeOcrAiRule(companyId, type, id);
      setConfirmRemove(null);
      setRules(await listOcrAiRules(companyId));
      setRulesMsg({ ok: true, text: t.ruleRemovedMsg });
    } catch (e) {
      setRulesMsg({ ok: false, text: chatErrorText(e, t) });
    } finally {
      setRulesBusy(null);
    }
  };

  const tabBtn = (k: "chat" | "rules", label: string) => (
    <button
      type="button"
      onClick={() => { setTab(k); if (k === "rules" && !rules && !rulesBusy) void loadRules(); }}
      className={cn("rounded-md px-2.5 py-1 text-xs font-medium", tab === k ? "bg-emerald-600 text-white" : "border border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800")}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Own dim layer (inline z-index); the built-in overlay is hidden because its z class cannot be set from here. */}
      <DialogPrimitive.Portal>
        <div aria-hidden className="fixed inset-0 bg-black/45 backdrop-blur-sm" style={{ zIndex: CHAT_Z - 1 }} data-pl-ocr-ai-chat-overlay="" />
      </DialogPrimitive.Portal>
      <DialogContent
        overlayClassName="hidden"
        style={CHAT_CONTENT_STYLE}
        className="flex flex-col gap-0 overflow-hidden p-0"
        onFocusOutside={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        data-pl-ocr-ai-chat=""
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200 px-4 py-3 text-left dark:border-slate-700">
          <DialogTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> {t.title}</DialogTitle>
          <DialogDescription className="text-[11px] leading-snug">
            {t.intro.replace("{n}", String(AI_CHAT_SEND_LAST))}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {tabBtn("chat", t.tabChat)}
            {tabBtn("rules", `${t.tabRules}${rules ? ` (${rulesCount(rules)})` : ""}`)}
            {tab === "chat" ? (
              <button
                type="button"
                disabled={sending || !turns.length}
                onClick={() => { setTurns([]); setAttachBill(false); setAttachJson(false); }}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                title={t.newChatTitle}
              >
                <Plus className="h-3.5 w-3.5" /> {t.newChat}
              </button>
            ) : null}
          </div>
        </DialogHeader>

        {tab === "chat" ? (
          <>
            <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3 dark:bg-slate-950/40">
              {!turns.length ? (
                <p className="rounded-md bg-white px-3 py-2 text-xs text-muted-foreground dark:bg-slate-900">
                  {t.emptyExample}
                </p>
              ) : null}
              {turns.map((turn) => (
                <div key={turn.id} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    style={{ maxWidth: "85%" }}
                    className={cn(
                      "space-y-1.5 rounded-lg px-3 py-2 text-xs shadow-sm",
                      turn.role === "user" ? "bg-emerald-600 text-white" : turn.error ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{turn.text}</p>
                    {turn.hadImage || turn.hadJson ? <p className="text-[10px] opacity-80">{[turn.hadImage && t.billSent, turn.hadJson && t.jsonSent].filter(Boolean).join(" · ")}</p> : null}
                    {turn.tokens ? <p className="text-[10px] text-muted-foreground">{t.tokens} {turn.tokens}</p> : null}
                    {turn.proposedRule ? (
                      <div className="space-y-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-slate-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-slate-100">
                        <p className="text-[11px] font-semibold">{t.proposedRule}</p>
                        <DocTypeSelect value={turn.proposedRule.docType} disabled={turn.ruleSaved} onChange={(v) => editRule(turn.id, { ...turn.proposedRule!, docType: v })} t={t} />
                        <textarea
                          value={turn.proposedRule.text}
                          disabled={turn.ruleSaved}
                          onChange={(e) => editRule(turn.id, { ...turn.proposedRule!, text: e.target.value })}
                          rows={3}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                        />
                        {turn.ruleSaved ? (
                          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{t.saved}</p>
                        ) : (
                          <Button type="button" size="sm" className="h-7 gap-1 text-xs" disabled={!turn.proposedRule.text.trim() || rulesBusy === `save:${turn.id}`} onClick={() => void saveProposed(turn)}>
                            {rulesBusy === `save:${turn.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t.saveRule}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {sending ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.thinking}</p> : null}
            </div>
            <div className="shrink-0 space-y-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                {getBill ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" checked={attachBill} onChange={(e) => setAttachBill(e.target.checked)} className="accent-emerald-600" /> {t.attachBill}
                  </label>
                ) : null}
                {getVoucherJson ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5" title={t.sendJsonTitle}>
                    <input type="checkbox" checked={attachJson} onChange={(e) => setAttachJson(e.target.checked)} className="accent-emerald-600" /> {t.sendJson}
                  </label>
                ) : null}
                {docType ? <span className="text-muted-foreground">{t.typeLabel}: {t.docTypes[docType]}</span> : null}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  rows={2}
                  placeholder={t.placeholder}
                  style={{ minHeight: "2.5rem" }}
                  className="flex-1 resize-y rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-600"
                />
                <Button type="button" className="h-9 gap-1" disabled={!input.trim() || sending} onClick={() => void send()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t.send}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3 dark:bg-slate-950/40">
            {rulesBusy === "load" && !rules ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.loadingRules}</p> : null}
            {rulesMsg ? <p className={cn("rounded-md px-3 py-2 text-xs", rulesMsg.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")}>{rulesMsg.text}</p> : null}
            {rules ? (
              <>
                {rules.folder ? <p className="break-all text-[11px] text-muted-foreground">{t.serverFolder}: <span className="font-mono">{rules.folder}</span></p> : null}
                {rules.canEdit ? (
                  <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
                    <p className="text-xs font-medium">{t.addRule}</p>
                    <DocTypeSelect value={newType} onChange={setNewType} t={t} />
                    <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={2} placeholder={t.addRulePlaceholder} className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-600" />
                    <Button type="button" size="sm" className="h-7 gap-1 text-xs" disabled={!newText.trim() || !!rulesBusy} onClick={() => void addManual()}>
                      {rulesBusy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t.saveRule}
                    </Button>
                  </div>
                ) : <p className="text-[11px] text-muted-foreground">{t.onlyAdmin}</p>}
                {OCR_AI_DOC_TYPES.map((dt) => {
                  const g = rules.types[dt];
                  if (!g.rules.length && !g.error) return null;
                  return (
                    <div key={dt} className="space-y-1">
                      <p className="text-xs font-semibold">{t.docTypes[dt]} <span className="font-normal text-muted-foreground">({g.rules.length}{g.removed ? `, ${g.removed} ${t.removed}` : ""})</span></p>
                      {g.error ? <p className="text-[11px] text-red-600">{g.error}</p> : null}
                      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                        {g.rules.map((r) => (
                          <li key={r.id} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{r.text}</span>
                            {rules.canEdit ? (
                              confirmRemove === r.id ? (
                                <span className="flex shrink-0 gap-1">
                                  <button type="button" disabled={!!rulesBusy} onClick={() => void remove(dt, r.id)} className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50">{t.remove}</button>
                                  <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-md border px-2 py-0.5 text-[11px]">{t.cancel}</button>
                                </span>
                              ) : (
                                <button type="button" title={t.removeTitle} onClick={() => setConfirmRemove(r.id)} className="shrink-0 text-red-600 hover:text-red-700 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                              )
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {!rulesCount(rules) ? <p className="text-xs text-muted-foreground">{t.noRules}</p> : null}
              </>
            ) : null}
            {!rules && rulesBusy !== "load" ? <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadRules()}>{t.loadRules}</Button> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "AI chat" button (OCR bar / OCR settings). The dialog mounts only while open, so each open re-reads the session. */
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
