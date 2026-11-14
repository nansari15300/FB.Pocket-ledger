/** Voucher-type switch: carry attachments + the already-read OCR result to the newly opened form (in-memory, one shot). */
import type { OcrRawResult } from "./types";
import type { OcrEnginePref } from "./prefs";

export const OCR_SWITCH_EVENT = "pl-ocr-switch-voucher-type";

export type OcrHandoff = {
  files: (File | string)[];
  /** OCR output from the previous form: the new form re-parses it for its own type, no second OCR. */
  raw?: OcrRawResult;
  /** Original (uncompressed) first file, kept for a later manual Refresh. */
  original?: File | null;
  /** Suggestions ticked together with the switch (applied in the new form). */
  selectedIds?: string[];
  /** Gallery local Auto post: use the voucher form's normal guarded save after OCR autofill. */
  autoPost?: boolean;
  /** Allow the regular voucher form to save free-form line rows when OCR cannot match item masters. */
  allowSaveWithoutItems?: boolean;
  /** Local Gallery Auto post can keep the company-selected OCR engine in the voucher review form. */
  enginePref?: OcrEnginePref;
  cloudProvider?: "google" | "azure";
};

/**
 * How long a switch hand-off waits for the target form. The target forms are lazy chunks (next/dynamic):
 * the first switch in a session (dev compile / slow device) can take far longer than the old 15 s window,
 * after which the new form opened with no bill and no suggestions.
 */
export const OCR_HANDOFF_TTL_MS = 60_000;
/** A form that unmounts and mounts again (same voucher type) within this window gets its bill + OCR result back. */
export const OCR_REMOUNT_RESUME_MS = 1_000;

type Pending = OcrHandoff & { at: number; type: string; token: number };
let pending: Pending | null = null;
let seq = 0;

/** Same bucket = no mismatch (Payment In ≈ Direct Income, Payment ≈ Direct Expense). */
export function sameVoucherBucket(current: string, detected: string) {
  const b = (t: string) => (t === "direct_income" ? "payment_in" : t === "direct_expense" ? "payment_out" : t);
  return b(current) === b(detected);
}
const forType = (formType: string | undefined, target: string) => !formType || formType === target || sameVoucherBucket(formType, target);

/** Park the bill for the target form and ask the dialog to switch. Returns a token for cancelOcrHandoff. */
export function requestOcrVoucherSwitch(type: string, files: readonly (File | string)[], extra?: Omit<OcrHandoff, "files">): number {
  const token = queueOcrHandoff(type, files, extra);
  window.dispatchEvent(new CustomEvent(OCR_SWITCH_EVENT, { detail: { type } }));
  return token;
}

/** Park OCR data for a form that is opened directly by its owner (without switching every open voucher dialog). */
export function queueOcrHandoff(type: string, files: readonly (File | string)[], extra?: Omit<OcrHandoff, "files">): number {
  const token = ++seq;
  pending = { files: [...files], ...extra, at: Date.now(), type, token };
  return token;
}

/** Switch did not happen (dialog refused / requester still mounted): drop the parked hand-off. */
export function cancelOcrHandoff(token: number) {
  if (pending?.token === token) pending = null;
}

/**
 * Take the hand-off for a form of `formType` (only a form of the target type may take it; others leave it parked).
 * Without formType any form takes it (legacy behaviour).
 */
export function takeOcrHandoff(formType?: string, now = Date.now()): OcrHandoff | null {
  const p = pending;
  if (!p) return null;
  if (now - p.at >= OCR_HANDOFF_TTL_MS) { pending = null; return null; }
  if (!forType(formType, p.type)) return null;
  pending = null;
  const { at: _a, type: _t, token: _k, ...h } = p;
  return h;
}

/* ---- Remount survival: the dialog / parent can remount the open form (key change); keep its OCR session briefly ---- */
type Parked = { type: string; h: OcrHandoff; at: number };
let parked: Parked | null = null;

/** Called when a form with an OCR result unmounts (not after a save). */
export function parkOcrSession(type: string, h: OcrHandoff, now = Date.now()) {
  if (!h.files.length || !h.raw) return;
  parked = { type, h: { ...h, files: [...h.files] }, at: now };
}

/** Same-type form mounting right after an unmount (remount) gets the parked session back once. */
export function resumeOcrSession(formType: string, now = Date.now()): OcrHandoff | null {
  const p = parked;
  if (!p) return null;
  if (now - p.at > OCR_REMOUNT_RESUME_MS) { parked = null; return null; }
  if (p.type !== formType) return null;
  parked = null;
  return p.h;
}

export function clearOcrSession() {
  parked = null;
}
