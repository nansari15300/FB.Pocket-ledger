"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getOcrUsage, type OcrUsageEngine } from "./ocrUsage";

const ENGINES: { id: OcrUsageEngine; label: string }[] = [
  { id: "gemini", label: "Gemini AI" },
  { id: "google", label: "Google OCR" },
  { id: "azure", label: "Azure OCR" },
  { id: "auto", label: "Auto OCR" },
];

const monthNow = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

export function OcrEngineUsage({ companyId, selectedEngine }: { companyId: string; selectedEngine: OcrUsageEngine }) {
  const [engine, setEngine] = useState<OcrUsageEngine>(selectedEngine);
  const [month, setMonth] = useState(monthNow);
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => setEngine(selectedEngine), [selectedEngine]);
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (!detail?.companyId || detail.companyId === companyId) setRefresh((value) => value + 1);
    };
    window.addEventListener("pl:ocr-usage-updated", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("pl:ocr-usage-updated", update);
      window.removeEventListener("storage", update);
    };
  }, [companyId]);
  const usage = useMemo(() => getOcrUsage(companyId, month, engine), [companyId, month, engine, refresh]);
  const currentMonth = monthNow();

  return <>
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ENGINES.map((item) => <button key={item.id} type="button" aria-pressed={engine === item.id} onClick={() => setEngine(item.id)} className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${engine === item.id ? "border-sky-400 bg-sky-100 text-sky-950" : "bg-background hover:bg-sky-50"}`}>{item.label}</button>)}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Selected engine: {ENGINES.find((item) => item.id === engine)?.label}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>View usage</Button>
      </div>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{ENGINES.find((item) => item.id === engine)?.label} OCR Usage</DialogTitle>
          <DialogDescription>Monthly counts from this device. Gemini token totals are shown when the server returns them.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
          <label className="text-sm font-medium" htmlFor="ocr-usage-month">Month</label>
          <input id="ocr-usage-month" type="month" value={month} max={currentMonth} onChange={(event) => setMonth(event.target.value || currentMonth)} className="h-9 rounded-md border bg-background px-3 text-sm" />
          <span className="text-xs text-muted-foreground">{monthLabel(month)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[["Calls", usage.calls], ["Replies", usage.replies], ["Failed", usage.failed]].map(([label, value]) => <div key={String(label)} className="rounded-lg border bg-background p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div></div>)}
        </div>
        {engine === "gemini" && <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-background p-3"><div className="text-xs text-muted-foreground">Prompt tokens</div><div className="mt-1 font-semibold tabular-nums">{usage.promptTokens.toLocaleString()}</div></div>
          <div className="rounded-lg border bg-background p-3"><div className="text-xs text-muted-foreground">Reply tokens</div><div className="mt-1 font-semibold tabular-nums">{usage.outputTokens.toLocaleString()}</div></div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
