"use client";
/**
 * Blue-ribbon usage strip for the AI chat (matches the dim sky-blue header).
 * Chips: requests / tokens / reset — hover (or tap on touch) expands a detail table with the last days.
 * Data: aiChatUsage.ts (device ledger) + /ai-status limits (server budget, daily reset 00:00 UTC).
 */
import React, { useEffect, useRef, useState } from "react";
import { BarChart3, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OcrAiLimits } from "./aiClient";
import {
  clearUsage,
  formatResetIn,
  formatTokens,
  nextUtcMidnight,
  todayUsage,
  type AiChatUsageState,
} from "./aiChatUsage";

const DEFAULT_LIMITS: OcrAiLimits = {
  requestsPerDay: 200,
  tokensPerDay: 1_000_000,
  ratePerMinUser: 10,
  ratePerMinCompany: 15,
  resetAtUtc: new Date(nextUtcMidnight()).toISOString(),
};

function pct(used: number, limit: number): number {
  if (!limit) return 0;
  return Math.min(100, (used / limit) * 100);
}

function barColor(p: number): string {
  if (p >= 90) return "#f87171";
  if (p >= 70) return "#fbbf24";
  return "#ffffff";
}

function Chip({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "flex items-baseline gap-1.5 rounded-md px-2 py-[3px] text-[10px] leading-none",
        warn ? "bg-red-500/25 ring-1 ring-red-300/50" : "bg-white/15"
      )}
    >
      <span className="text-white/70">{label}</span>
      <span className="font-semibold tabular-nums text-white">{value}</span>
      {sub ? <span className="text-[9px] text-white/55 tabular-nums">{sub}</span> : null}
    </span>
  );
}

function Progress({ used, limit }: { used: number; limit: number }) {
  const p = pct(used, limit);
  return (
    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-white/20">
      <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${p}%`, background: barColor(p) }} />
    </span>
  );
}

export function AiChatUsageChips({
  state,
  limits,
  onClear,
}: {
  state: AiChatUsageState;
  limits?: OcrAiLimits;
  onClear: () => void;
}) {
  const lim = limits ?? DEFAULT_LIMITS;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ticking clock for "reset in" (cheap: 30 s).
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setPinned(false); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  const today = todayUsage(state, now);
  const resetAt = Date.parse(lim.resetAtUtc) || nextUtcMidnight(now);
  const reqPct = pct(today.requests, lim.requestsPerDay);
  const tokPct = pct(today.totalTokens, lim.tokensPerDay);
  const warn = reqPct >= 90 || tokPct >= 90;

  return (
    <span ref={boxRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => { setPinned((v) => !v); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label="AI usage"
        className="flex items-center gap-1 rounded-lg bg-white/10 px-1.5 py-1 transition hover:bg-white/20"
      >
        <BarChart3 className="h-3 w-3 text-white/80" />
        <Chip label="Req" value={`${today.requests}/${lim.requestsPerDay}`} warn={reqPct >= 90} />
        <Chip label="tok" value={`${formatTokens(today.totalTokens)}/${formatTokens(lim.tokensPerDay)}`} warn={tokPct >= 90} />
        <Chip label="reset" value={formatResetIn(resetAt, now)} warn={warn} />
      </button>

      {open && (
        <span
          role="dialog"
          aria-label="AI usage details"
          className="absolute right-0 top-8 z-[9999] block w-[330px] rounded-xl border border-black/10 bg-white p-3 text-slate-700 shadow-xl"
        >
          <span className="absolute -top-1 right-6 block h-2.5 w-2.5 rotate-45 border-l border-t border-black/10 bg-white" />

          <span className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-800">Gemini usage — today</span>
            <span className="text-[9px] text-slate-400">resets {formatResetIn(resetAt, now)} · 00:00 UTC</span>
          </span>

          <span className="mb-2.5 grid grid-cols-2 gap-2">
            <span className="rounded-lg border border-black/10 bg-slate-50 px-2 py-1.5">
              <span className="block text-[9px] uppercase tracking-wide text-slate-400">Requests</span>
              <span className="block text-[13px] font-semibold tabular-nums text-slate-800">
                {today.requests} <span className="text-[10px] font-normal text-slate-400">/ {lim.requestsPerDay}</span>
              </span>
              <span className="block text-[9px] text-slate-400">{Math.max(0, lim.requestsPerDay - today.requests)} left{today.failed ? ` · ${today.failed} failed` : ""}</span>
              <Progress used={today.requests} limit={lim.requestsPerDay} />
            </span>
            <span className="rounded-lg border border-black/10 bg-slate-50 px-2 py-1.5">
              <span className="block text-[9px] uppercase tracking-wide text-slate-400">Tokens</span>
              <span className="block text-[13px] font-semibold tabular-nums text-slate-800">
                {formatTokens(today.totalTokens)} <span className="text-[10px] font-normal text-slate-400">/ {formatTokens(lim.tokensPerDay)}</span>
              </span>
              <span className="block text-[9px] text-slate-400">{formatTokens(Math.max(0, lim.tokensPerDay - today.totalTokens))} left</span>
              <Progress used={today.totalTokens} limit={lim.tokensPerDay} />
            </span>
          </span>

          <span className="mb-2 grid grid-cols-3 gap-1.5 text-center">
            {[
              { k: "Prompt", v: formatTokens(today.promptTokens) },
              { k: "Output", v: formatTokens(today.outputTokens) },
              { k: "With image", v: String(today.imageRequests) },
            ].map((c) => (
              <span key={c.k} className="rounded-md bg-slate-50 px-1 py-1 ring-1 ring-black/5">
                <span className="block text-[8.5px] uppercase tracking-wide text-slate-400">{c.k}</span>
                <span className="block text-[11px] font-medium tabular-nums text-slate-700">{c.v}</span>
              </span>
            ))}
          </span>

          {/* Recent days */}
          <span className="mb-1 block text-[9px] uppercase tracking-wide text-slate-400">Last days (this device)</span>
          <span className="block max-h-[132px] overflow-y-auto rounded-lg border border-black/10">
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="px-1.5 py-1 text-left font-medium">Day</th>
                  <th className="px-1.5 py-1 text-right font-medium">Req</th>
                  <th className="px-1.5 py-1 text-right font-medium">Tokens</th>
                  <th className="px-1.5 py-1 text-right font-medium">Img</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {state.days.length === 0 ? (
                  <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-400">No AI chat sent yet</td></tr>
                ) : state.days.map((d) => (
                  <tr key={d.day} className={cn("border-t border-black/5", d.day === today.day && "bg-[#e0f2fe]/60 font-medium")}>
                    <td className="px-1.5 py-1 text-left text-slate-600">{d.day}{d.day === today.day ? " · today" : ""}</td>
                    <td className="px-1.5 py-1 text-right text-slate-700">{d.requests}{d.failed ? <span className="text-red-500"> ({d.failed}✕)</span> : null}</td>
                    <td className="px-1.5 py-1 text-right text-slate-700">{formatTokens(d.totalTokens)}</td>
                    <td className="px-1.5 py-1 text-right text-slate-500">{d.imageRequests || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </span>

          <span className="mt-2 flex items-center justify-between text-[9px] text-slate-400">
            <span className="flex items-center gap-1"><RotateCcw className="h-2.5 w-2.5" /> rate {lim.ratePerMinUser}/min user · {lim.ratePerMinCompany}/min company</span>
            <button
              type="button"
              onClick={() => { onClear(); setOpen(false); setPinned(false); }}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
              title="Clear this device's counter"
            >
              <Trash2 className="h-2.5 w-2.5" /> clear
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

export { clearUsage };
