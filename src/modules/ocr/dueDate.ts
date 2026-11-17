/**
 * OCR due date for Sale / Purchase. Order (user rule):
 *   1. due date printed on the bill
 *   2. credit days printed on the bill + bill date
 *   3. party master credit days + bill date
 *   4. Common Setting "default due days" (separate for Sale and Purchase; blank = leave Due Date empty)
 * The AI never guesses a due date, and a missing due date never blocks a save (it is not a required field).
 */
import { useSyncExternalStore } from "react";

export type OcrDueSource = "printed" | "bill_credit_days" | "party_credit_days" | "default_days";
export type OcrDueResult = { date: Date; source: OcrDueSource; days?: number };

const DAY = 86_400_000;
const validDays = (n: unknown): number | null => {
  const v = typeof n === "string" ? Number(n.trim()) : Number(n);
  return n !== null && n !== "" && Number.isFinite(v) && v >= 0 && v <= 3650 ? Math.round(v) : null;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** "2026-08-12" (AD) -> local Date; anything else -> null. */
export function parseIsoDay(s: string | null | undefined): Date | null {
  const m = String(s ?? "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

export function resolveOcrDueDate(input: {
  printedDue?: string | Date | null;
  billCreditDays?: number | null;
  billDate?: Date | null;
  partyCreditDays?: number | string | null;
  defaultDays?: number | string | null;
}): OcrDueResult | null {
  const bill = input.billDate && !Number.isNaN(input.billDate.getTime()) ? input.billDate : null;
  const printed = input.printedDue instanceof Date ? input.printedDue : parseIsoDay(input.printedDue ?? null);
  /* A printed due date before the bill date is a misread, not a due date. */
  if (printed && !Number.isNaN(printed.getTime()) && (!bill || printed.getTime() >= bill.getTime() - DAY)) return { date: printed, source: "printed" };
  if (!bill) return null;
  const bc = validDays(input.billCreditDays);
  if (bc != null && bc > 0) return { date: addDays(bill, bc), source: "bill_credit_days", days: bc };
  const pc = validDays(input.partyCreditDays);
  if (pc != null && pc > 0) return { date: addDays(bill, pc), source: "party_credit_days", days: pc };
  const dd = validDays(input.defaultDays);
  if (dd != null) return { date: addDays(bill, dd), source: "default_days", days: dd };
  return null;
}

/** Party master credit days, whatever the record calls it (none of these is required). */
export function partyCreditDaysOf(p: unknown): number | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  for (const k of ["creditDays", "creditPeriod", "credit_days", "creditPeriodDays", "paymentTermsDays"]) {
    const v = validDays(o[k]);
    if (v != null && v > 0) return v;
  }
  return null;
}

/* ---------------- Common Setting: default due days (Sale / Purchase) ----------------
 * The Common Setting UI (Gallery Voucher Post settings) owns the stored value in its settings doc
 * (defaultDueDaysSale / defaultDueDaysPurchase). It pushes the value here on load and on save with
 * setOcrDefaultDueDays, so every voucher form (manual or runner) reads the same numbers. null = blank. */
export type OcrDefaultDueDays = { sale: number | null; purchase: number | null };
const KEY = (companyId: string) => `pl.ocr.defaultDueDays.${companyId}`;
const EMPTY: OcrDefaultDueDays = { sale: null, purchase: null };
const subs = new Set<() => void>();
const mem = new Map<string, OcrDefaultDueDays>();

export function normalizeDefaultDueDays(raw: unknown): OcrDefaultDueDays {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { sale: validDays(o.sale ?? o.defaultDueDaysSale), purchase: validDays(o.purchase ?? o.defaultDueDaysPurchase) };
}

export function getOcrDefaultDueDays(companyId: string | null | undefined): OcrDefaultDueDays {
  const id = String(companyId ?? "").trim();
  if (!id) return EMPTY;
  const hit = mem.get(id);
  if (hit) return hit;
  let v = EMPTY;
  try { if (typeof localStorage !== "undefined") v = normalizeDefaultDueDays(JSON.parse(localStorage.getItem(KEY(id)) || "{}")); } catch { v = EMPTY; }
  mem.set(id, v);
  return v;
}

/** Called by the Common Setting UI with its saved values ({ sale, purchase } or { defaultDueDaysSale, defaultDueDaysPurchase }). */
export function setOcrDefaultDueDays(companyId: string | null | undefined, value: Partial<OcrDefaultDueDays> | Record<string, unknown>) {
  const id = String(companyId ?? "").trim();
  if (!id) return;
  const v = normalizeDefaultDueDays(value);
  mem.set(id, v);
  try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY(id), JSON.stringify(v)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function defaultDueDaysFor(companyId: string | null | undefined, kind: "sale" | "purchase"): number | null {
  return getOcrDefaultDueDays(companyId)[kind];
}

export function useOcrDefaultDueDays(companyId: string | null | undefined): OcrDefaultDueDays {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => getOcrDefaultDueDays(companyId),
    () => EMPTY,
  );
}
