"use client";
/** Above the attachment box: Refresh (re-extract) + Find account + Show OCR text (debug). */
import React, { useState } from "react";
import { CheckCheck, FileText, ListChecks, Loader2, RefreshCw, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
/* Same stacking as Add New master from a voucher: above AddVoucherDialog (overlay z-80 / content z-81). */
import { NESTED_VOUCHER_MASTER_CREATE_CONTENT_CN, NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN } from "@/lib/dialogShellChrome";
import type { VoucherOcrApi } from "./useVoucherOcr";

/** One pill style for every OCR bar button (same as Refresh OCR). */
const OCR_BAR_PILL_CN = "h-7 gap-1 text-xs";

export function VoucherOcrRefreshBar({ ocr }: { ocr: VoucherOcrApi }) {
  const [dbgOpen, setDbgOpen] = useState(false);
  if (!ocr.visible) return null;
  const d = ocr.debugInfo;
  const rb = ocr.readBy;
  const readByLabel = rb ? (rb.engine === "gemini" ? "AI (Gemini)" : rb.engine === "google" ? "Google" : rb.engine === "azure" ? "Azure" : "Local") : null;
  // Tooltip: why the engine fell back (e.g. "AI failed (...) -> Azure"), or AI model + tokens used
  const readByNote = rb && rb.note ? rb.note : undefined;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 px-[2px]" data-pl-ocr-refresh-bar="">
      {ocr.preReading ? (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-teal-400 bg-teal-50 px-2 text-xs text-teal-800" data-ocr-pre-reading="" title="OCR reads the original first; the file is compressed and attached right after">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading… <span className="max-w-[160px] truncate font-medium">{ocr.preReading}</span> (attaches after OCR)
        </span>
      ) : null}
      <Button type="button" size="sm" variant="outline" className={OCR_BAR_PILL_CN} disabled={!ocr.hasFile || ocr.running} onClick={ocr.refresh} title="Re-run OCR on the first attached file">
        {ocr.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Refresh OCR
      </Button>
      {readByLabel && rb ? (
        <span
          className="inline-flex h-7 max-w-full items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          data-pl-ocr-read-by={rb.engine}
          title={readByNote}
        >
          Read by: {readByLabel}
        </span>
      ) : null}
      {ocr.canFindAccount ? (
        <Button type="button" size="sm" variant="outline" className={OCR_BAR_PILL_CN} onClick={ocr.openFindAccount}>
          <UserSearch className="h-3.5 w-3.5" /> Find account
        </Button>
      ) : null}
      {ocr.suggestionsCount ? (
        <Button type="button" size="sm" variant="outline" className={OCR_BAR_PILL_CN} onClick={ocr.openSuggestions}>
          <ListChecks className="h-3.5 w-3.5" /> {ocr.suggestionsShown ? "Hide" : "Show"} suggestions ({ocr.suggestionsCount})
        </Button>
      ) : null}
      {ocr.tickedCount ? (
        <Button type="button" size="sm" variant="outline" className={OCR_BAR_PILL_CN} onClick={ocr.applyTicked}>
          <CheckCheck className="h-3.5 w-3.5" /> Apply all ({ocr.tickedCount})
        </Button>
      ) : null}
      {d ? (
        <Button type="button" size="sm" variant="outline" className={OCR_BAR_PILL_CN} onClick={() => setDbgOpen(true)}>
          <FileText className="h-3.5 w-3.5" /> Show OCR text
        </Button>
      ) : null}
      {ocr.panel}
      {d ? (
        <Dialog open={dbgOpen} onOpenChange={setDbgOpen}>
          <DialogContent
            overlayClassName={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN}
            className={`${NESTED_VOUCHER_MASTER_CREATE_CONTENT_CN} max-h-[90vh] max-w-2xl overflow-y-auto`}
            onFocusOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>OCR debug</DialogTitle>
              <DialogDescription>
                Average confidence: <b className={d.meanConfidence < 55 ? "text-red-600" : d.meanConfidence < 75 ? "text-amber-600" : "text-emerald-600"}>{d.meanConfidence.toFixed(1)}%</b>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-xs">
              <p><b>Filled:</b> {d.filled.join(", ") || "-"}</p>
              <p><b>Not filled:</b> {d.missing.join(", ") || "-"}</p>
              <div>
                <p className="font-semibold">Rule log</p>
                <ul className="list-disc space-y-0.5 pl-4">{d.reasons.map((r, i) => <li key={i} className="break-words">{r}</li>)}</ul>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Raw OCR text</p>
                  <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => void navigator.clipboard?.writeText(
                      // Full report (was raw text only -> pasted dumps had no build stamp / rule log)
                      [`Average confidence: ${d.meanConfidence.toFixed(1)}%`, `Filled: ${d.filled.join(", ") || "-"}`, `Not filled: ${d.missing.join(", ") || "-"}`, "", "Rule log:", ...d.reasons, "", "Raw OCR text:", d.text].join("\n")
                    )} title="Copy everything: rule log + build stamp + raw text">Copy all</Button>
                </div>
                <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 font-mono text-[11px] leading-snug">{d.text || "(empty)"}</pre>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
