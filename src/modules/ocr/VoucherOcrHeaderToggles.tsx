"use client";
/** Add Voucher header: OCR / Auto Post / Overwrite pills + one OCR-settings gear (when OCR is on). */
import React, { useState } from "react";
import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AUTO_POST_SECONDS_MAX, AUTO_POST_SECONDS_MIN, clampAutoPostSeconds, setOcrPrefs, useOcrPrefs, type OcrConnectorStyle } from "./prefs";
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

function OcrSettingsGear({
  connectorStyle, autoPost, overwriteEdited, seconds, switchOn, switchSeconds,
}: {
  connectorStyle: OcrConnectorStyle;
  autoPost: boolean;
  overwriteEdited: boolean;
  seconds: number;
  switchOn: boolean;
  switchSeconds: number;
}) {
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
          title="OCR settings"
          aria-label="OCR settings"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-400/50 bg-white/70 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold">OCR settings</p>
        <div>
          <p className="mb-1.5 text-xs font-medium">Field popup connector</p>
          <div className="flex flex-col gap-1.5">
            {([["tail", "Speech-bubble tail"], ["line", "Straight arrow line"]] as const).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="pl-ocr-connector"
                  checked={connectorStyle === value}
                  onChange={() => setOcrPrefs({ connectorStyle: value })}
                  className="accent-emerald-600"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="pl-ocr-settings-autopost" className="text-xs font-medium">Auto Post</label>
            <Switch id="pl-ocr-settings-autopost" checked={autoPost} onCheckedChange={(v) => setOcrPrefs({ autoPost: v === true })} className="scale-75" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="pl-ocr-settings-overwrite" className="text-xs font-medium">Overwrite edited</label>
            <Switch id="pl-ocr-settings-overwrite" checked={overwriteEdited} onCheckedChange={(v) => setOcrPrefs({ overwriteEdited: v === true })} className="scale-75" />
          </div>
          <SecondsRow id="pl-ocr-autopost-secs" label="Auto save countdown (seconds)" draft={draft} setDraft={setDraft} onCommit={commit} onOk={() => { commit(); setOpen(false); }} />
          <p className="text-[11px] text-muted-foreground">{AUTO_POST_SECONDS_MIN}-{AUTO_POST_SECONDS_MAX}s. Saves after OCR unless cancelled.</p>
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
  const style: OcrConnectorStyle = p.connectorStyle === "line" ? "line" : "tail";
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
          <OcrSettingsGear
            connectorStyle={style}
            autoPost={p.autoPost}
            overwriteEdited={p.overwriteEdited}
            seconds={clampAutoPostSeconds(p.autoPostSeconds)}
            switchOn={p.autoSwitchVoucher !== false}
            switchSeconds={clampAutoPostSeconds(p.autoSwitchSeconds)}
          />
          <Pill
            id="pl-ocr-autopost"
            label="Auto Post"
            checked={p.autoPost}
            onChange={(v) => setOcrPrefs({ autoPost: v })}
            title="Save automatically after OCR (always UNAPPROVED)"
          />
          <Pill id="pl-ocr-overwrite" label="Overwrite edited" checked={p.overwriteEdited} onChange={(v) => setOcrPrefs({ overwriteEdited: v })} title="Refresh re-fills fields you edited by hand too" />
        </>
      ) : null}
    </div>
  );
}
