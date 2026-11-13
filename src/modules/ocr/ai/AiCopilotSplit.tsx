"use client";
/**
 * Pocket AI glue — NO chat UI of its own. The chat is the existing, reusable `AiChatDialog`, which now
 * has a `copilot` mode (floating + resizable + drag). This file only:
 *   1. holds the per-form open flag (`useAiCopilotLayout`),
 *   2. builds the receipt thumbnail (`useCopilotThumb`),
 *   3. feeds the voucher form's callbacks into that same dialog.
 *
 * OFF (OCR Settings → Pocket AI) → `useAiCopilotLayout().enabled` is false and nothing renders.
 */
import React from "react";
import { AiChatDialog, type CopilotBridge } from "./AiChatDialog";
import type { VoucherOcrApi } from "../useVoucherOcr";
import { setOcrPrefs, useOcrPrefs } from "../prefs";

export type AiCopilotLayout = {
  enabled: boolean;
  autoOpenOnOcr: boolean;
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
  setAutoOpenOnOcr: (v: boolean) => void;
};

/** One line per voucher form. OFF keeps `enabled` false and nothing renders. */
export function useAiCopilotLayout(ocr: VoucherOcrApi): AiCopilotLayout {
  const [open, setOpen] = React.useState(false);
  const prefs = useOcrPrefs();
  const enabled = ocr.copilotEnabled === true;
  React.useEffect(() => {
    /* fillSeq is the primary scan signal; statusLine also covers successful OCR paths that update
     * diagnostics without incrementing the counter (for example a reused/handoff result). */
    if (enabled && prefs.autoOpenCopilot && (ocr.copilot.fillSeq > 0 || !!ocr.copilot.statusLine)) setOpen(true);
  }, [enabled, prefs.autoOpenCopilot, ocr.copilot.fillSeq, ocr.copilot.statusLine]);
  return React.useMemo(
    () => ({
      enabled,
      autoOpenOnOcr: prefs.autoOpenCopilot,
      open: enabled && open,
      toggle: () => setOpen((v) => !v),
      setOpen,
      setAutoOpenOnOcr: (v: boolean) => setOcrPrefs({ autoOpenCopilot: v }),
    }),
    [enabled, open, prefs.autoOpenCopilot]
  );
}

/** First attached image, as an object URL for the chat header thumbnail (null otherwise). */
export function useCopilotThumb(files: unknown): string | null {
  const f = Array.isArray(files) ? files[0] : null;
  const file = f instanceof File && f.type.startsWith("image/") ? f : null;
  /* Derived during render → created for that exact File and revoked when the File changes. */
  const url = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

export function VoucherOcrAiCopilot({ ocr, layout, thumbUrl }: { ocr: VoucherOcrApi; layout: AiCopilotLayout; thumbUrl?: string | null }) {
  if (!layout.enabled || !ocr.companyId) return null;

  const bridge: CopilotBridge = {
    getMasters: ocr.copilot.getMasters,
    onPatch: ocr.copilot.applyPatch,
    onCreateMaster: ocr.copilot.createMasterFromProposal,
    onMissingMasters: ocr.copilot.setCopilotMissing,
    thumbUrl,
    statusLine: ocr.copilot.statusLine,
    missingFields: ocr.copilot.missingFields,
  };

  return (
    <AiChatDialog
      /* New scan = new conversation. */
      key={`${ocr.companyId}-${ocr.copilot.fillSeq}`}
      open={layout.open}
      onOpenChange={layout.setOpen}
      companyId={ocr.companyId}
      docType={ocr.aiDocType}
      getBill={ocr.getBillForChat}
      getVoucherJson={ocr.getAiVoucherJson}
      getOwnCompany={ocr.getOwnCompany}
      autoStartKey={ocr.copilot.fillSeq > 0 ? `scan:${ocr.copilot.fillSeq}` : undefined}
      copilot={bridge}
      autoOpenOnOcr={layout.autoOpenOnOcr}
      onAutoOpenOnOcrChange={layout.setAutoOpenOnOcr}
    />
  );
}

/** Small amber chips under the OCR bar: names the copilot says have no master. */
export function CopilotMissingBar({ ocr }: { ocr: VoucherOcrApi }) {
  const list = ocr.copilot.missingMasters;
  if (!ocr.copilotEnabled || !list.length) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900" data-pl-ai-copilot-missing="">
      <span className="font-medium">No master:</span>
      {list.map((m) => (
        <span key={`${m.kind}:${m.name}`} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-amber-300" title={m.hint}>
          {m.kind}: {m.name}
        </span>
      ))}
    </div>
  );
}
