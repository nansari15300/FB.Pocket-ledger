"use client";
/**
 * AI Copilot — docked chat beside the voucher form (NO overlapping modal).
 *
 * OCR Settings → "AI Copilot" ON switches the whole panel on; OFF leaves the classic OCR flow
 * (fill + bubbles + popup chat) exactly as it was.
 *
 * One turn does three things in a single Gemini call:
 *   1. reply        — the answer the user reads
 *   2. voucherPatch — diff applied to the live form immediately (left panel)
 *   3. masterCreate / missingMasters — proposal to create a Party/Bank/Staff that is not in masters
 *
 * The component is deliberately dumb: it renders turns, calls `ocrAiChat`, and hands the results to
 * `onPatch` / `onCreateMaster` / `onMissingMasters`. All form logic stays in useVoucherOcr.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, Loader2, Send, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ocrAiChat,
  ocrAiErrorText,
  type OcrAiMasterProposal,
  type OcrAiMissingMaster,
  type OcrAiVoucherPatch,
} from "./aiClient";

export type CopilotTurn = {
  id: string;
  role: "user" | "model";
  text: string;
  /** Patch that was applied to the form by this turn (shown under the bubble). */
  applied?: string[];
  /** Master this turn proposed (rendered as a card with Create / Not now). */
  proposal?: OcrAiMasterProposal;
  proposalDone?: "created" | "dismissed";
  error?: boolean;
};

const ACCENT = "#0ea5e9";

let seq = 0;
const newId = () => `cop-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Human label for a patch row ("date" → "Date"), shown as "applied" chips. */
const PATCH_LABELS: Record<string, string> = {
  date: "Date",
  narration: "Narration",
  amount: "Amount",
  voucher_number: "Voucher No.",
  reference: "Ref",
  party_name: "Party",
  account_name: "Account",
  notes: "Notes",
};

const KIND_LABEL: Record<string, string> = {
  party: "Party",
  bank: "Bank account",
  staff: "Staff",
  expense: "Expense ledger",
  income: "Income ledger",
};

export type VoucherAiCopilotProps = {
  companyId: string;
  docType?: string;
  /** Receipt preview for the header thumbnail (object URL). */
  thumbUrl?: string | null;
  /** What the OCR read, for the status line ("Payment · 92%"). */
  statusLine?: string | null;
  /** Fields the OCR could not fill — flagged amber in the header summary. */
  missingFields?: string[];
  getBill: () => Promise<{ blob: Blob; mime: string } | null>;
  getVoucherJson: () => unknown;
  getOwnCompany: () => { name?: string | null; pan?: string | null };
  /** Master name lists (party/bank/staff/expense/income) so Gemini knows what already exists. */
  getMasters: () => { parties?: string[]; banks?: string[]; staff?: string[]; expenses?: string[]; incomes?: string[] };
  /** Apply a chat patch to the live form. Return the labels actually written. */
  onPatch: (patch: OcrAiVoucherPatch) => string[];
  /** User pressed "Create" on a proposal: the app opens its master form prefilled. */
  onCreateMaster: (m: OcrAiMasterProposal) => void;
  onMissingMasters?: (list: OcrAiMissingMaster[]) => void;
  /** Panel width toggle (the parent keeps the form flexible). */
  onCollapse: () => void;
};

export function VoucherAiCopilot(props: VoucherAiCopilotProps) {
  const { companyId, docType, thumbUrl, statusLine, missingFields, getVoucherJson, getOwnCompany, getMasters, onPatch, onCreateMaster, onMissingMasters, onCollapse } = props;
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);
  useEffect(() => () => abortRef.current?.abort(), []);

  /** One chat turn. `auto` = the OCR just filled the form, so this is the opening question. */
  const runTurn = useCallback(
    async (text: string, opts: { auto?: boolean } = {}) => {
      const clean = text.trim();
      if (!clean || sending) return;
      const userTurn: CopilotTurn = { id: newId(), role: "user", text: clean };
      const next = [...turns, userTurn];
      setTurns(next);
      if (!opts.auto) setInput("");
      setSending(true);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const r = await ocrAiChat({
          companyId,
          docType,
          messages: next.map((t) => ({ role: t.role, text: t.text })),
          voucherJson: getVoucherJson() ?? undefined,
          ownCompany: getOwnCompany(),
          copilot: true,
          masters: getMasters(),
          signal: ac.signal,
        });
        /* Patch the live form FIRST so the chips on the bubble describe what really changed. */
        const applied = r.voucherPatch ? onPatch(r.voucherPatch) : [];
        if (r.missingMasters.length) onMissingMasters?.(r.missingMasters);
        setTurns((cur) => [
          ...cur,
          {
            id: newId(),
            role: "model",
            text: r.reply,
            applied: applied.length ? applied : undefined,
            proposal: r.masterCreate ?? undefined,
          },
        ]);
      } catch (e) {
        setTurns((cur) => [...cur, { id: newId(), role: "model", text: ocrAiErrorText(e), error: true }]);
      } finally {
        abortRef.current = null;
        setSending(false);
      }
    },
    [companyId, docType, sending, turns, getVoucherJson, getOwnCompany, getMasters, onPatch, onMissingMasters]
  );

  /* Opening turn: the form is already filled by OCR, so ask Gemini what it read and what is missing.
   * Runs once per mount (a fresh mount = a fresh scan), never on every render. */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !companyId) return;
    opened.current = true;
    void runTurn("Ye bill OCR se padha gaya hai. Batao kya kya fill hua aur kya missing hai — agar koi Party/Bank/Staff master me nahi hai to batao.", { auto: true });
  }, [companyId, runTurn]);

  return (
    <aside
      className="flex h-full min-h-0 w-[min(400px,42vw)] shrink-0 flex-col border-l border-black/10 bg-white"
      data-pl-ai-copilot=""
    >
      {/* ── Header: receipt thumb + status ── */}
      <div className="flex shrink-0 items-start gap-2 border-b border-black/5 px-3 py-2" style={{ background: "#f8fafc" }}>
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="receipt" className="h-10 w-10 shrink-0 rounded-md border border-black/10 object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-black/10 bg-white">
            <Bot className="h-5 w-5 text-slate-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[12px] font-semibold text-slate-700">
            <Sparkles className="h-3.5 w-3.5" style={{ color: ACCENT }} /> AI Copilot
          </p>
          {statusLine ? <p className="truncate text-[10px] text-slate-500">{statusLine}</p> : null}
          {missingFields?.length ? (
            <p className="truncate text-[10px] text-amber-700" title={missingFields.join(", ")}>
              Missing: {missingFields.slice(0, 3).join(", ")}{missingFields.length > 3 ? ` +${missingFields.length - 3}` : ""}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onCollapse} title="Hide AI panel" className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── Turns ── */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/15">
        {turns.map((t) => (
          <div key={t.id} className={cn("flex gap-1.5", t.role === "user" ? "justify-end" : "justify-start")}>
            {t.role === "model" ? (
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: ACCENT }}>
                <Bot className="h-3 w-3 text-white" />
              </div>
            ) : null}
            <div
              className={cn(
                "max-w-[85%] space-y-1.5 rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
                t.role === "user"
                  ? "rounded-tr-none bg-[#dff3fd] text-slate-800"
                  : t.error
                  ? "rounded-tl-none border border-red-200 bg-red-50 text-red-800"
                  : "rounded-tl-none bg-white text-slate-800 ring-1 ring-black/5"
              )}
            >
              <p className="whitespace-pre-wrap break-words">{t.text}</p>

              {t.applied?.length ? (
                <p className="flex flex-wrap gap-1">
                  {t.applied.map((a) => (
                    <span key={a} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                      ✓ {a}
                    </span>
                  ))}
                </p>
              ) : null}

              {t.proposal && !t.proposalDone ? (
                <div className="mt-1 space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
                  <p className="text-[11px] font-medium text-amber-900">
                    Create {KIND_LABEL[t.proposal.kind] ?? t.proposal.kind}: <b>{t.proposal.name}</b>?
                  </p>
                  <div className="space-y-0.5 text-[10px] text-amber-800">
                    {t.proposal.pan ? <p>PAN: {t.proposal.pan}</p> : null}
                    {t.proposal.phone ? <p>Phone: {t.proposal.phone}</p> : null}
                    {t.proposal.account_no ? (
                      <p>
                        A/c: {t.proposal.account_no}
                        {t.proposal.bank_name ? ` (${t.proposal.bank_name})` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px]"
                      onClick={() => {
                        onCreateMaster(t.proposal!);
                        setTurns((cur) => cur.map((x) => (x.id === t.id ? { ...x, proposalDone: "created" } : x)));
                      }}
                    >
                      <UserPlus className="h-3 w-3" /> Create &amp; link
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setTurns((cur) => cur.map((x) => (x.id === t.id ? { ...x, proposalDone: "dismissed" } : x)))}
                    >
                      Not now
                    </Button>
                  </div>
                </div>
              ) : null}
              {t.proposalDone === "created" ? (
                <p className="text-[10px] text-emerald-700">✓ Opened Create {KIND_LABEL[t.proposal?.kind ?? "party"]}</p>
              ) : null}
              {t.proposalDone === "dismissed" ? <p className="text-[10px] text-slate-400">Not created</p> : null}
            </div>
          </div>
        ))}

        {sending ? (
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: ACCENT }}>
              <Bot className="h-3 w-3 text-white" />
            </div>
            <div className="flex gap-1 rounded-lg rounded-tl-none bg-white px-2.5 py-2 ring-1 ring-black/5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-black/10 bg-[#f0f2f5] px-2 py-2">
        <div className="flex items-end gap-1.5 rounded-xl border border-black/10 bg-white px-2 py-1.5 shadow-sm">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void runTurn(input);
              }
            }}
            rows={1}
            placeholder="e.g. narration badlo, date kal ki karo, 1000 tea + 7000 supplier…"
            style={{ minHeight: "1.75rem", resize: "none", maxHeight: "7rem" }}
            className="flex-1 bg-transparent py-1 text-[12px] text-slate-700 placeholder-slate-400 focus:outline-none"
          />
          <button
            type="button"
            disabled={!input.trim() || sending}
            onClick={() => void runTurn(input)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white transition hover:brightness-110 disabled:opacity-40"
            style={{ background: ACCENT }}
            title="Send"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Collapsed strip: keeps the form full width with one click back into the panel. */
export function VoucherAiCopilotHandle({ onOpen, busy }: { onOpen: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-8 shrink-0 flex-col items-center gap-1 border-l border-black/10 bg-slate-50 py-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      title="Open AI Copilot"
      data-pl-ai-copilot-handle=""
    >
      <ChevronRight className="h-4 w-4 rotate-180" />
      <Sparkles className={cn("h-3.5 w-3.5", busy && "animate-pulse")} />
      <span className="mt-1 text-[9px] font-medium [writing-mode:vertical-rl]">AI</span>
    </button>
  );
}

export { PATCH_LABELS };
