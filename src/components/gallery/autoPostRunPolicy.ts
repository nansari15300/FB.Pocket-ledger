/** Pure Auto post / scan-run policy helpers (no React). */

export type ExclusiveScanTriggers = {
  runOnUpload: boolean;
  runOnSchedule: boolean;
};

export type ScanTriggerChoice = "upload" | "schedule" | "manual";

/** Derived: Start-only mode is just arrive=false and schedule=false. No extra stored field. */
export function isManualStartTrigger(settings: ExclusiveScanTriggers): boolean {
  return !settings.runOnUpload && !settings.runOnSchedule;
}

export function scanTriggerChoice(settings: ExclusiveScanTriggers): ScanTriggerChoice {
  if (settings.runOnSchedule) return "schedule";
  if (settings.runOnUpload) return "upload";
  return "manual";
}

/** Turning one trigger on turns the others off. Manual cannot be turned off except by choosing another. */
export function exclusiveScanTriggers(
  next: { runOnUpload?: boolean; runOnSchedule?: boolean; runOnManualStart?: boolean },
  current: ExclusiveScanTriggers,
): ExclusiveScanTriggers {
  if (next.runOnManualStart === true) return { runOnUpload: false, runOnSchedule: false };
  if (next.runOnUpload === true) return { runOnUpload: true, runOnSchedule: false };
  if (next.runOnSchedule === true) return { runOnUpload: false, runOnSchedule: true };
  if (next.runOnManualStart === false && isManualStartTrigger(current)) {
    return { runOnUpload: false, runOnSchedule: false };
  }
  return {
    runOnUpload: next.runOnUpload ?? current.runOnUpload,
    runOnSchedule: next.runOnSchedule ?? current.runOnSchedule,
  };
}

/** Saved settings must not keep both arrive and schedule on. Prefer upload when both are true. Both off is Start-only. */
export function normalizeExclusiveTriggers(runOnUpload: boolean, runOnSchedule: boolean): ExclusiveScanTriggers {
  if (runOnUpload && runOnSchedule) return { runOnUpload: true, runOnSchedule: false };
  return { runOnUpload, runOnSchedule };
}

export type BudgetStartReason = "reset" | "idle-start" | "idle-schedule" | "resume" | "active-schedule";

export function shouldBeginNewBudget(reason: BudgetStartReason): boolean {
  return reason === "reset" || reason === "idle-start" || reason === "idle-schedule";
}

export function isIdleRunState(opts: { busy: boolean; draining: boolean; remaining: number | null }): boolean {
  if (opts.busy) return false;
  if (opts.draining && opts.remaining !== 0) return false;
  return true;
}

/** Skip a schedule tick (and do not reset the budget) while a run is in progress. */
export function shouldSkipScheduleTick(opts: { busy: boolean; draining: boolean; remaining: number | null; held?: boolean }): boolean {
  if (opts.held) return true;
  return !isIdleRunState(opts);
}

export function startBudgetReason(opts: { busy: boolean; draining: boolean; remaining: number | null }): BudgetStartReason {
  return isIdleRunState(opts) ? "idle-start" : "resume";
}

export function normalizeRunLocation(value: unknown): "local-pc" {
  return "local-pc";
}

export function isServerRunLocation(value: unknown): boolean {
  return value === "server";
}

export type MissingFieldRuleKey = "debitMaster" | "creditMaster" | "item" | "date" | "tax" | "other";

export const NO_LINE_ITEMS_ERROR = "Invoice has no line items.";
export const LINE_AMOUNT_MISMATCH_ERROR = "Invoice line item amounts do not match the bill total.";

export function isAmountMismatchField(value: string): boolean {
  const text = value.toLowerCase();
  return /item row amount does not match|item amount mismatch|amounts? do not match|did not reconcile|totals? (check|mismatch)|line items did not pass/.test(text);
}

export function isNoLineItemsField(value: string): boolean {
  const text = value.toLowerCase();
  if (isAmountMismatchField(value)) return false;
  return /no line items|line items (are )?missing|^line items$|invoice has no line items|line items are empty/.test(text);
}

export function isItemRowCountMismatchField(value: string): boolean {
  return /item row count mismatch/.test(value.toLowerCase());
}

/** Only an unresolved item/service master may use the "save without item" rule. */
export function isMissingItemMasterField(value: string): boolean {
  const text = value.toLowerCase();
  return /\bitem(?: master)?\s+(?:on\s+line\s+\d+|is\s+missing|missing|required|not selected|not found)\b/.test(text) ||
    /\bservice\s+(?:on\s+line\s+\d+|is\s+missing|missing|required|not selected|not found)\b/.test(text) ||
    /\b(item|service)(?:id|_id)\b/.test(text);
}

/**
 * Map a missing-field label to the Common Setting rule.
 * Contra: "To" → debit, "From" → credit.
 * Journal: each line's Dr/Cr side selects the debit/credit rule.
 */
export function missingFieldRuleKey(value: string, voucherType?: string): MissingFieldRuleKey {
  const text = value.toLowerCase();
  if (isMissingItemMasterField(value) || isNoLineItemsField(value)) {
    return "item";
  }
  if (/date/.test(text)) return "date";
  if (/tax|vat|tds/.test(text)) return "tax";
  const type = String(voucherType || "").toLowerCase().replace(/[\s-]/g, "_");
  const partyLike = /party|customer|supplier|payee|staff/.test(text);
  const accountLike = /bank|cash|ledger|purchase account|sales account|account/.test(text);
  if (type === "contra") {
    if (/\bto\b/.test(text) || (/debit|\bdr\b/.test(text) && !/\bfrom\b/.test(text))) return "debitMaster";
    if (/\bfrom\b/.test(text) || /credit|\bcr\b/.test(text)) return "creditMaster";
    if (partyLike || accountLike) return "debitMaster";
  }
  if (type === "journal") {
    const hasCredit = /credit|\bcr\b/.test(text);
    const hasDebit = /debit|\bdr\b/.test(text);
    if (hasCredit && !hasDebit) return "creditMaster";
    if (hasDebit) return "debitMaster";
    if (partyLike || accountLike) return "debitMaster";
  }
  if (partyLike || accountLike) {
    if (partyLike && (type === "sale" || type === "payment_out" || type === "direct_expense")) return "debitMaster";
    if (partyLike && (type === "purchase" || type === "payment_in" || type === "direct_income")) return "creditMaster";
    if (accountLike && (type === "sale" || type === "payment_out" || type === "direct_expense")) return "creditMaster";
    if (accountLike && (type === "purchase" || type === "payment_in" || type === "direct_income")) return "debitMaster";
    if (/credit|\bcr\b|supplier|payee/.test(text)) return "creditMaster";
    return "debitMaster";
  }
  return "other";
}

export const DEFAULT_DUE_DAYS_MIN = 0;
export const DEFAULT_DUE_DAYS_MAX = 365;

/** Blank / invalid → null. A finite value is clamped to 0–365. */
export function normalizeDefaultDueDayValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(DEFAULT_DUE_DAYS_MIN, Math.min(DEFAULT_DUE_DAYS_MAX, Math.round(n)));
}

export function ocrHandoffDefaultDueDays(settings: { defaultDueDaysSale?: number | null; defaultDueDaysPurchase?: number | null }): { sale: number | null; purchase: number | null } {
  return {
    sale: normalizeDefaultDueDayValue(settings.defaultDueDaysSale),
    purchase: normalizeDefaultDueDayValue(settings.defaultDueDaysPurchase),
  };
}

export type OcrScanFailedCode =
  | "quota"
  | "network"
  | "timeout"
  | "no_key"
  | "forbidden"
  | "disabled"
  | "not_signed_in"
  | "region_unsupported"
  | "unknown"
  | "unreadable"
  | "unavailable";

export type OcrFailureKind = "retryable" | "unreadable" | "fatal-auth" | "other";

export function classifyOcrFailure(message: string, code?: string, status?: number, retryAfter?: number): OcrFailureKind {
  const normalized = String(code || "").trim().toLowerCase();
  const retryIn = Number(retryAfter);
  const hasRetryAfter = Number.isFinite(retryIn) && retryIn > 0;

  if (normalized === "unreadable") return "unreadable";
  if (
    normalized === "no_key"
    || normalized === "forbidden"
    || normalized === "disabled"
    || normalized === "not_signed_in"
    || normalized === "region_unsupported"
  ) {
    return "fatal-auth";
  }
  if (normalized === "quota") return hasRetryAfter ? "retryable" : "fatal-auth";
  if (normalized === "network" || normalized === "timeout" || normalized === "unavailable") return "retryable";
  if (status === 429 && hasRetryAfter) return "retryable";

  // Message fallback when the event has no usable code.
  const text = `${code || ""} ${status ?? ""} ${message}`.toLowerCase();
  if (
    /could not read (this )?document|nothing readable|empty text|image text is unclear|unreadable/.test(text)
    && !/timeout|timed out|network|429|503|overloaded|unavailable/.test(text)
  ) {
    return "unreadable";
  }
  if (
    /no_key|not_signed_in|\bforbidden\b|\bdisabled\b|region_unsupported/.test(text)
    || /rejected or has expired|do not have permission|turned off on the server|sign in to pocket ledger/.test(text)
  ) {
    return "fatal-auth";
  }
  const looksBillingQuota = /\bquota\b/.test(text) && /billing|exhausted|exceeded/.test(text)
    && !/every minute|rate limit|try again in|retry in/.test(text);
  if (looksBillingQuota && !hasRetryAfter && status !== 429) {
    return "fatal-auth";
  }
  if (
    status === 429 || status === 408 || (typeof status === "number" && status >= 500)
    || /timeout|timed out|network|offline|overloaded|unavailable|429|503|502|500|econnreset|fetch failed|\bbusy\b|rate limit|too many requests|try again/.test(text)
  ) {
    return "retryable";
  }
  return "other";
}

export const OCR_RETRY_LIMIT = 3;
export const OCR_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000] as const;

/** attempt 1..3 → 30s, 60s, 120s. */
export function retryBackoffMs(attempt: number): number {
  const index = Math.max(1, Math.min(OCR_RETRY_LIMIT, Math.round(attempt))) - 1;
  return OCR_RETRY_BACKOFF_MS[index] ?? OCR_RETRY_BACKOFF_MS[OCR_RETRY_BACKOFF_MS.length - 1];
}

/** Milliseconds to wait before the next OCR call under a per-minute cap. 0 if a call may start now. */
export function rateLimitWaitMs(callTimes: readonly number[], maxPerMinute: number, now = Date.now()): number {
  if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) return 0;
  const windowStart = now - 60_000;
  const recent = callTimes.filter((time) => time > windowStart).sort((a, b) => a - b);
  if (recent.length < maxPerMinute) return 0;
  const oldestInWindow = recent[recent.length - maxPerMinute];
  if (oldestInWindow == null) return 0;
  return Math.max(0, oldestInWindow + 60_000 - now);
}

export function recordRateLimitCall(callTimes: number[], now = Date.now()): number[] {
  const windowStart = now - 60_000;
  return [...callTimes.filter((time) => time > windowStart), now];
}

export function fatalOcrMessage(kind: OcrFailureKind, source: string): string | null {
  if (kind !== "fatal-auth") return null;
  const text = source.toLowerCase();
  if (/no_key|rejected or has expired|invalid[_\s-]?key|api[_\s-]?key/.test(text)) {
    return "The OCR API key was rejected. Check the key in OCR settings, then Start later.";
  }
  if (/forbidden|do not have permission/.test(text)) {
    return "OCR access is forbidden for this company. The runner has been stopped.";
  }
  if (/quota|billing/.test(text)) {
    return "OCR quota is exhausted. The runner has been stopped. Check billing or try later.";
  }
  if (/not_signed_in|sign in/.test(text)) {
    return "Sign in to Pocket Ledger Server first. The runner has been stopped.";
  }
  if (/disabled|turned off/.test(text)) {
    return "Online / AI OCR is turned off. The runner has been stopped.";
  }
  if (/region_unsupported|not available in this region/.test(text)) {
    return "OCR is not available in this region. The runner has been stopped.";
  }
  return "OCR is not available. The runner has been stopped.";
}

export const OCR_UNAVAILABLE_MESSAGE = "Gemini/OCR not available now, Start later";

/* ---- Gallery runner rules (2026-11-18) ---- */

/** Queue emptied: Start-only mode goes to the stopped (held) state so a reload never auto-starts it. */
export function shouldHoldWhenQueueEmpty(settings: ExclusiveScanTriggers): boolean {
  return isManualStartTrigger(settings);
}

/** Page load: resume a saved "running" state only for on-arrival / schedule modes. Start-only always waits for Start. */
export function shouldRestoreRunOnLoad(settings: ExclusiveScanTriggers, held: boolean): boolean {
  return !held && !isManualStartTrigger(settings);
}

/** Reset only refills the file counter; it never starts processing (Start does that). */
export function resetRunCounterState(
  remainingLimit: number | null,
  state: { draining: boolean },
): { remaining: number | null; scanned: number; draining: boolean; startProcessing: false } {
  return { remaining: remainingLimit, scanned: 0, draining: state.draining, startProcessing: false };
}
