/** Voucher-type switch: carry attachments + the already-read OCR result to the newly opened form (in-memory, one shot). */
import type { OcrRawResult } from "./types";
import type { OcrEnginePref } from "./prefs";

export const OCR_SWITCH_EVENT = "pl-ocr-switch-voucher-type";
/** User manually changed the voucher tab after OCR; the source form offers its cached scan to the target form. */
export const OCR_MANUAL_SWITCH_EVENT = "pl-ocr-manual-switch-voucher-type";

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
  /** Set only by the Gallery runner (Semi / Full). Hand-opened vouchers use the Manual Runner profile instead. */
  runnerJob?: boolean;
  /** Full Auto Post: save right after autofill — no voucher window countdown. */
  autoPostImmediate?: boolean;
  /** Runner-specific save countdown; overrides the device-wide OCR preference for this handoff. */
  autoPostSeconds?: number;
  /** Runner-specific overwrite behaviour; overrides the device-wide OCR preference for this handoff. */
  overwriteEdited?: boolean;
  /** A manual type change may reuse cached OCR, but must leave the form for review instead of auto-saving. */
  manualTypeSwitch?: boolean;
  /** Allow the regular voucher form to save free-form line rows when OCR cannot match item masters. */
  allowSaveWithoutItems?: boolean;
  /** Local Gallery Auto post can keep the company-selected OCR engine in the voucher review form. */
  enginePref?: OcrEnginePref;
  cloudProvider?: "google" | "azure";
  /**
   * Gallery runner: "Check for duplicate vouchers" switch. false = the opened form does no duplicate detection,
   * shows no duplicate bubble and never blocks the auto post for a duplicate (manual entry is unaffected).
   */
  checkDuplicateVouchers?: boolean;
  /** Runner copy of the Common Setting default due days (overrides the cached company value for this voucher). */
  defaultDueDays?: { sale?: number | null; purchase?: number | null };
  /**
   * Manual type change: values the user typed in the previous form, by meaning (not by path). The new form writes
   * them over the OCR re-map, so a type change never wipes what the user entered.
   */
  userValues?: OcrCarriedValues;
};

/** Field meanings that exist on several voucher forms (the new form writes only those it has). */
export type OcrCarriedValues = Partial<Record<"date" | "dueDate" | "narration" | "amount" | "party" | "account", unknown>>;

export type OcrCarryPaths = Partial<Record<keyof OcrCarriedValues, string | undefined>>;
const CARRY_KEYS: readonly (keyof OcrCarriedValues)[] = ["date", "dueDate", "narration", "amount", "party", "account"];

/**
 * Source form -> values the USER entered (not OCR fills), keyed by meaning. `userEdited(path, value)` decides
 * (dirty and not equal to what OCR wrote); empty values are skipped.
 */
export function collectOcrUserValues(paths: OcrCarryPaths, read: (path: string) => unknown, userEdited: (path: string, value: unknown) => boolean, isEmpty: (v: unknown) => boolean): OcrCarriedValues {
  const out: OcrCarriedValues = {};
  for (const k of CARRY_KEYS) {
    const path = paths[k];
    if (!path) continue;
    const v = read(path);
    if (!isEmpty(v) && userEdited(path, v)) out[k] = v;
  }
  return out;
}

/** Target form: [path, value] writes for the carried values whose meaning this form has (others are dropped). */
export function carriedValueWrites(carried: OcrCarriedValues | undefined, paths: OcrCarryPaths): [keyof OcrCarriedValues, string, unknown][] {
  if (!carried) return [];
  const out: [keyof OcrCarriedValues, string, unknown][] = [];
  for (const k of CARRY_KEYS) {
    const path = paths[k];
    if (path && carried[k] !== undefined) out.push([k, path, carried[k]]);
  }
  return out;
}

/* ---- Runner "duplicate check off" (one voucher at a time; read by the live duplicate warning hook) ---- */
let runnerDupOff = false;
const dupSubs = new Set<() => void>();
export function setRunnerDuplicateCheckOff(off: boolean) {
  if (runnerDupOff === off) return;
  runnerDupOff = off;
  dupSubs.forEach((f) => f());
}
export function isRunnerDuplicateCheckOff(): boolean {
  return runnerDupOff;
}
export function subscribeRunnerDuplicateCheckOff(cb: () => void): () => void {
  dupSubs.add(cb);
  return () => { dupSubs.delete(cb); };
}

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
