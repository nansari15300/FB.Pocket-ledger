import { startOfDay, startOfMonth } from "date-fns";

/**
 * Pure helpers for the ledger "load older vouchers" widen (party / staff / account ledgers).
 *
 * Old walk went back one month at a time and gave up after 6 months with no new voucher for
 * the entity, so a party whose previous bill was years back (e.g. a 2080 bill while the
 * scope sits in 2083) never showed it. The widen now jumps straight to the month of the
 * entity's oldest voucher in the local mirror.
 */

/** Voucher `date` (Date / Timestamp-like / {seconds} / {__fsTs} / ISO / epoch) to epoch ms. */
export function voucherDateToMs(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === "object") {
    const o = raw as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown };
    if (typeof o.toDate === "function") {
      try {
        const ms = o.toDate().getTime();
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    }
    const sec = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : null;
    if (sec != null) {
      const ns = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
      const ms = sec * 1000 + Math.floor(ns / 1e6);
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

export type EntityVoucherStats = { count: number; oldestMs: number | null };

/** Count + oldest date of the (non-deleted) vouchers that touch an entity. */
export function entityVoucherStats<T>(
  vouchers: readonly T[],
  touches: (voucher: T) => boolean
): EntityVoucherStats {
  let count = 0;
  let oldestMs: number | null = null;
  for (const v of vouchers) {
    if (!v || (v as { isDeleted?: unknown }).isDeleted === true) continue;
    if (!touches(v)) continue;
    count++;
    const ms = voucherDateToMs((v as { date?: unknown }).date);
    if (ms != null && (oldestMs == null || ms < oldestMs)) oldestMs = ms;
  }
  return { count, oldestMs };
}

/**
 * New scope start (start of the oldest voucher's month) when the entity has vouchers older
 * than the loaded scope; null when nothing older is known. `floorMs` clamps to the calendar floor.
 */
export function planEntityWidenFromMs(params: {
  scopeFromMs: number;
  oldestEntityMs: number | null;
  floorMs?: number | null;
}): number | null {
  const { scopeFromMs, oldestEntityMs, floorMs } = params;
  if (oldestEntityMs == null || !Number.isFinite(oldestEntityMs)) return null;
  if (!Number.isFinite(scopeFromMs) || oldestEntityMs >= scopeFromMs) return null;
  let fromMs = startOfDay(startOfMonth(new Date(oldestEntityMs))).getTime();
  if (floorMs != null && Number.isFinite(floorMs) && fromMs < floorMs) fromMs = floorMs;
  return fromMs < scopeFromMs ? fromMs : null;
}

/** What the widen should do with the local-mirror stats. */
export function entityWidenAction(params: {
  scopeFromMs: number;
  stats: EntityVoucherStats | null;
  floorMs?: number | null;
}): { kind: "done" } | { kind: "jump"; fromMs: number } | { kind: "walk" } {
  const { scopeFromMs, stats, floorMs } = params;
  // Unknown / nothing local (e.g. Firebase company with a partial mirror): keep the old month walk,
  // which also asks the server for each month.
  if (!stats || stats.count === 0 || stats.oldestMs == null) return { kind: "walk" };
  const fromMs = planEntityWidenFromMs({ scopeFromMs, oldestEntityMs: stats.oldestMs, floorMs });
  if (fromMs != null) return { kind: "jump", fromMs };
  return { kind: "done" };
}
