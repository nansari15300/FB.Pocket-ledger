/** Voucher-type switch: carry attachments + the already-read OCR result to the newly opened form (in-memory, one shot). */
import type { OcrRawResult } from "./types";

export const OCR_SWITCH_EVENT = "pl-ocr-switch-voucher-type";

export type OcrHandoff = {
  files: (File | string)[];
  /** OCR output from the previous form: the new form re-parses it for its own type, no second OCR. */
  raw?: OcrRawResult;
  /** Original (uncompressed) first file, kept for a later manual Refresh. */
  original?: File | null;
  /** Suggestions ticked together with the switch (applied in the new form). */
  selectedIds?: string[];
};
let pending: (OcrHandoff & { at: number }) | null = null;

export function requestOcrVoucherSwitch(type: string, files: readonly (File | string)[], extra?: Omit<OcrHandoff, "files">) {
  pending = { files: [...files], ...extra, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OCR_SWITCH_EVENT, { detail: { type } }));
}

export function takeOcrHandoff(): OcrHandoff | null {
  const p = pending;
  pending = null;
  return p && Date.now() - p.at < 15000 ? p : null;
}

/** Same bucket = no mismatch (Payment In ≈ Direct Income, Payment ≈ Direct Expense). */
export function sameVoucherBucket(current: string, detected: string) {
  const b = (t: string) => (t === "direct_income" ? "payment_in" : t === "direct_expense" ? "payment_out" : t);
  return b(current) === b(detected);
}
