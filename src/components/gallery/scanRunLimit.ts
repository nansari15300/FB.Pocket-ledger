/** Max vouchers/files processed in one scan run. "all" = no limit (current behaviour). */

export const SCAN_RUN_LIMIT_MIN = 1;
export const SCAN_RUN_LIMIT_MAX = 500;
export const SCAN_RUN_LIMIT_DEFAULT = 10;

export type ScanRunLimit = { unlimited: true } | { unlimited: false; max: number };

export function normalizeScanRunLimit(raw: unknown): ScanRunLimit {
  if (raw == null || raw === "") return { unlimited: true };
  if (typeof raw === "string" && raw.trim().toLowerCase() === "all") return { unlimited: true };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return { unlimited: true };
  return { unlimited: false, max: Math.max(SCAN_RUN_LIMIT_MIN, Math.min(SCAN_RUN_LIMIT_MAX, Math.round(n))) };
}

function limitedMax(limit: ScanRunLimit): number | null {
  return limit.unlimited === false ? limit.max : null;
}

/** Stored settings value: "all" or a clamped 1–500 integer. */
export function scanRunLimitValue(raw: unknown): number | "all" {
  const max = limitedMax(normalizeScanRunLimit(raw));
  return max == null ? "all" : max;
}

/** How many of the pending files this run should process. */
export function scanRunBudget(limit: ScanRunLimit, pendingCount: number): number {
  const pending = Math.max(0, pendingCount);
  const max = limitedMax(limit);
  return max == null ? pending : Math.min(max, pending);
}

export function shouldContinueScanRun(processedThisRun: number, limit: ScanRunLimit): boolean {
  const max = limitedMax(limit);
  return max == null ? true : processedThisRun < max;
}

/** Remaining slots for a new run: null means unlimited. */
export function initialRunRemaining(limit: ScanRunLimit): number | null {
  return limitedMax(limit);
}
