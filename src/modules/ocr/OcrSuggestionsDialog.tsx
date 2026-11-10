"use client";
/** Post-scan checklist: everything on the bill that was NOT applied (all unticked by default). */
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
/* Same stacking as Add New master from a voucher: above AddVoucherDialog (overlay z-80 / content z-81). */
import { NESTED_VOUCHER_MASTER_CREATE_CONTENT_CN, NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN } from "@/lib/dialogShellChrome";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type OcrSuggestion = {
  id: string;
  label: string;
  value: string;
  confidence?: number;
  reason?: string;
  /** Set = cannot be applied automatically (shown for information). */
  blocked?: string;
  /** Runs last (opens a dialog / switches voucher). */
  deferred?: boolean;
  apply: (ctx?: { selectedIds: string[]; mode?: "auto" | "manual" }) => void | Promise<void>;
};

export function OcrSuggestionsDialog({
  open,
  onOpenChange,
  suggestions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  suggestions: OcrSuggestion[];
}) {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (open) setSel({});
  }, [open, suggestions]);
  const chosen = suggestions.filter((s) => sel[s.id] && !s.blocked);

  const applySelected = async () => {
    // Switch voucher: carry the other ticked suggestions to the new form (applied there, no re-OCR)
    const sw = chosen.find((s) => s.id === "switch");
    if (sw) {
      onOpenChange(false);
      await sw.apply({ selectedIds: chosen.filter((s) => s.id !== "switch").map((s) => s.id) });
      return;
    }
    const now = chosen.filter((s) => !s.deferred);
    const later = chosen.filter((s) => s.deferred);
    for (const s of now) await s.apply();
    onOpenChange(false);
    for (const s of later) await s.apply();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
            overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
            className={`${NESTED_VOUCHER_MASTER_CREATE_CONTENT_CN} max-h-[90vh] max-w-xl overflow-y-auto`}
            onFocusOutside={(e) => e.preventDefault()}
          >
        <DialogHeader>
          <DialogTitle>OCR suggestions</DialogTitle>
          <DialogDescription>Not applied automatically. Tick what you want, then Apply selected.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5">
          {suggestions.map((s) => (
            <li key={s.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <Checkbox
                id={`ocr-sg-${s.id}`}
                checked={!!sel[s.id]}
                disabled={!!s.blocked}
                onCheckedChange={(v) => setSel((p) => ({ ...p, [s.id]: v === true }))}
                className="mt-0.5"
              />
              <label htmlFor={`ocr-sg-${s.id}`} className="min-w-0 flex-1 cursor-pointer">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{s.label}</span>
                  <span className="break-all text-xs text-muted-foreground">{s.value}</span>
                  {s.confidence != null ? (
                    <span className={`text-[11px] ${s.confidence >= 0.9 ? "text-emerald-600" : s.confidence >= 0.6 ? "text-amber-600" : "text-red-600"}`}>
                      {Math.round(s.confidence * 100)}%
                    </span>
                  ) : null}
                </div>
                {s.reason ? <p className="text-[11px] text-muted-foreground">{s.reason}</p> : null}
                {s.blocked ? <p className="text-[11px] text-amber-700">{s.blocked}</p> : null}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" size="sm" disabled={!chosen.length} onClick={() => void applySelected()}>
            Apply selected ({chosen.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
