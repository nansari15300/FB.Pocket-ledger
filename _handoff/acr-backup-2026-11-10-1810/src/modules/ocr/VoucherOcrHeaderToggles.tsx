"use client";
/** Add Voucher header: OCR Enabled/Disabled + Auto Post (+ gear: countdown seconds) + Overwrite edited (device-local). Hidden when plan disallows. */
import React, { useState } from "react";
import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AUTO_POST_SECONDS_MAX, AUTO_POST_SECONDS_MIN, clampAutoPostSeconds, setOcrPrefs, useOcrPrefs } from "./prefs";
import { useOcrPlanAllowed } from "./gate";

function Pill({ id, label, checked, onChange, title, extra }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; title: string; extra?: React.ReactNode }) {
  return (
    <label htmlFor={id} title={title} className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-400/50 bg-white/70 px-2 text-xs font-medium text-slate-800 dark:bg-slate-900/60 dark:text-slate-100">
      <span className="whitespace-nowrap">{label}</span>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="scale-75" />
      {extra}
    </label>
  );
}

function SecondsRow({ id, label, draft, setDraft, onCommit, onOk, disabled }: { id: string; label: string; draft: string; setDraft: (v: string) => void; onCommit: () => void; onOk: () => void; disabled?: boolean }) {
  return (
    <>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          min={AUTO_POST_SECONDS_MIN}
          max={AUTO_POST_SECONDS_MAX}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOk(); } }}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-sm disabled:opacity-50 dark:border-slate-600"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOk(); }}
          className="h-8 shrink-0 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          OK
        </button>
      </div>
    </>
  );
}

function AutoPostSecondsGear({ seconds, switchOn, switchSeconds }: { seconds: number; switchOn: boolean; switchSeconds: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(seconds));
  const [swDraft, setSwDraft] = useState(String(switchSeconds));
  const commit = () => { const v = clampAutoPostSeconds(draft); setOcrPrefs({ autoPostSeconds: v }); setDraft(String(v)); };
  const commitSw = () => { const v = clampAutoPostSeconds(swDraft); setOcrPrefs({ autoSwitchSeconds: v }); setSwDraft(String(v)); };
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) { setDraft(String(seconds)); setSwDraft(String(switchSeconds)); } else { commit(); commitSw(); } }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Auto Post countdown: ${seconds}s`}
          aria-label="Auto Post countdown settings"
          onClick={(e) => e.stopPropagation()}
          className="-ml-1 rounded-full p-0.5 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 space-y-3 p-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <SecondsRow id="pl-ocr-autopost-secs" label="Auto save countdown (seconds)" draft={draft} setDraft={setDraft} onCommit={commit} onOk={() => { commit(); setOpen(false); }} />
          <p className="mt-1 text-[11px] text-muted-foreground">{AUTO_POST_SECONDS_MIN}-{AUTO_POST_SECONDS_MAX}s. Saves after OCR unless cancelled.</p>
        </div>
        <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="pl-ocr-autoswitch" className="text-xs font-medium">Auto voucher change</label>
            <Switch id="pl-ocr-autoswitch" checked={switchOn} onCheckedChange={(v) => setOcrPrefs({ autoSwitchVoucher: v === true })} className="scale-75" />
          </div>
          <SecondsRow id="pl-ocr-autoswitch-secs" label="Switch countdown (seconds)" draft={swDraft} setDraft={setSwDraft} onCommit={commitSw} onOk={() => { commitSw(); setOpen(false); }} disabled={!switchOn} />
          <p className="mt-1 text-[11px] text-muted-foreground">{switchOn ? "Wrong voucher type: switches automatically after the countdown." : "Off: shows a plain Switch button, no auto change."}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
export function VoucherOcrHeaderToggles({ className }: { className?: string }) {
  const allowed = useOcrPlanAllowed();
  const p = useOcrPrefs();
  if (!allowed) return null;
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)} data-pl-ocr-header-toggles="">
      <Pill
        id="pl-ocr-enabled"
        label={p.enabled ? "OCR" : "OCR Off"}
        checked={p.enabled}
        onChange={(v) => setOcrPrefs({ enabled: v })}
        title={p.enabled ? "OCR Enabled - bill is read when the first file is attached" : "OCR Disabled"}
      />
      {p.enabled ? (
        <>
          <Pill
            id="pl-ocr-autopost"
            label="Auto Post"
            checked={p.autoPost}
            onChange={(v) => setOcrPrefs({ autoPost: v })}
            title="Save automatically after OCR (always UNAPPROVED)"
            extra={p.autoPost ? <AutoPostSecondsGear seconds={clampAutoPostSeconds(p.autoPostSeconds)} switchOn={p.autoSwitchVoucher !== false} switchSeconds={clampAutoPostSeconds(p.autoSwitchSeconds)} /> : null}
          />
          <Pill id="pl-ocr-overwrite" label="Overwrite edited" checked={p.overwriteEdited} onChange={(v) => setOcrPrefs({ overwriteEdited: v })} title="Refresh re-fills fields you edited by hand too" />
        </>
      ) : null}
    </div>
  );
}