"use client";

import { format, startOfDay, differenceInCalendarDays } from "date-fns";
import { Timestamp } from "@/lib/pbCompat/firestore";
import { PL_CLIENT_OFFLINE_FIRST_PERSIST_MS } from "@/lib/localMirrorServerMeta";
import { bsToAd } from "@/lib/bs-date";

/**
 * Firestore Timestamp / JSON `{ seconds, nanoseconds }` / ISO / `Date` → JS `Date` (form default + sale edit)
 * — `new Date(plainObject)` Invalid Date deta tha; online list/cache se aaya hua `date` kabhi plain object hota hai.
 */
export function parseFirestoreDateFieldToJsDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (raw instanceof Timestamp) {
    try {
      const d = raw.toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown> & {
      __fsTs?: boolean;
      seconds?: unknown;
      _seconds?: unknown;
      nanoseconds?: unknown;
      _nanoseconds?: unknown;
      toDate?: () => Date;
    };
    const sec =
      typeof o.seconds === "number" && Number.isFinite(o.seconds)
        ? o.seconds
        : typeof o._seconds === "number" && Number.isFinite(o._seconds)
          ? o._seconds
          : null;
    const nsRaw =
      typeof o.nanoseconds === "number" && Number.isFinite(o.nanoseconds)
        ? o.nanoseconds
        : typeof o._nanoseconds === "number" && Number.isFinite(o._nanoseconds)
          ? o._nanoseconds
          : 0;
    if (o.__fsTs === true && sec !== null) {
      // Legacy mirror timestamps may use underscored keys; normalize both to stable Date.
      const d = new Timestamp(sec, nsRaw as number).toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    if (sec !== null) {
      // Plain JSON timestamp objects without `toDate` should still parse correctly.
      const d = new Timestamp(sec, nsRaw as number).toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof o.toDate === "function") {
      try {
        const d = o.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** BS calendar string (`2082-05-24`) — PL server SQLite kabhi AD ki jagah BS store karta hai. */
export function parseLikelyBsVoucherDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 2070 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 32) return null;
  try {
    const ad = bsToAd({ y, m, d });
    return ad instanceof Date && !isNaN(ad.getTime()) ? ad : null;
  } catch {
    return null;
  }
}

/**
 * Voucher `date` field → AD for backdate permission check.
 * PL server / SQLite: BS `2082-xx-xx` ko `new Date()` AD 2082 bana deta hai → future date → permission deny.
 */
export function resolveVoucherDateForBackdateCheck(raw: unknown): Date | null {
  const now = new Date();
  const futureGuardMs = now.getTime() + 36 * 60 * 60 * 1000;
  const parsed = parseFirestoreDateFieldToJsDate(raw);
  if (parsed && parsed.getTime() <= futureGuardMs) {
    return normalizeVoucherDateForBackdateCheck(parsed);
  }

  const bsFromString = parseLikelyBsVoucherDate(raw);
  if (bsFromString) return bsFromString;

  if (parsed) {
    const normalized = normalizeVoucherDateForBackdateCheck(parsed);
    if (normalized.getTime() <= futureGuardMs) return normalized;
  }

  return null;
}

/**
 * Date object jisme BS year (2082) AD samajh liya gaya ho — components ko BS maan kar AD me convert.
 */
export function normalizeVoucherDateForBackdateCheck(recordDate: Date): Date {
  if (!(recordDate instanceof Date) || isNaN(recordDate.getTime())) return recordDate;
  const today = startOfDay(new Date());
  const day = startOfDay(recordDate);
  const ageInDays = differenceInCalendarDays(today, day);
  if (ageInDays >= 0) return recordDate;

  const y = recordDate.getFullYear();
  if (y >= 2070 && y <= 2200) {
    try {
      const fixed = bsToAd({ y, m: recordDate.getMonth() + 1, d: recordDate.getDate() });
      if (fixed instanceof Date && !isNaN(fixed.getTime())) {
        const fixedAge = differenceInCalendarDays(today, startOfDay(fixed));
        if (fixedAge >= 0) return fixed;
      }
    } catch {
      /* keep original */
    }
  }
  return recordDate;
}

/**
 * Master opening "As on" (party/bank/tax/staff): SQLite/cache se kabhi sirf `{ seconds, nanoseconds }` aata hai —
 * `new Date(obj)` Invalid hota; `parseFirestoreDateFieldToJsDate` se sahi `Date`.
 * Local din par noon (12:00) — BsDatePicker / `nepali-date-converter` ke saath UTC-midnight drift se BS display khali/AD fallback na ho.
 */
export function parseOpeningBalanceDateToLocalNoon(raw: unknown): Date | null {
  const d = parseFirestoreDateFieldToJsDate(raw);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/**
 * List / mobile card ke "• time" line ke liye: pehle `createdAt`, phir `lastEditedAt` / `updatedAt`, ant mein voucher `date`.
 * `Date` + `date-fns/format` device ki **local** timezone mein dikhte hain.
 */
export function getVoucherEntryTimeSourceDate(transaction: Record<string, unknown> | null | undefined): Date | null {
  if (transaction == null || typeof transaction !== "object") return null;
  const fromCreated = parseFirestoreDateFieldToJsDate(transaction["createdAt"]);
  if (fromCreated) return fromCreated;
  const fromEdited = parseFirestoreDateFieldToJsDate(transaction["lastEditedAt"]);
  if (fromEdited) return fromEdited;
  const fromUpdated = parseFirestoreDateFieldToJsDate(transaction["updatedAt"]);
  if (fromUpdated) return fromUpdated;
  const offlineMs = transaction[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
  if (typeof offlineMs === "number" && Number.isFinite(offlineMs)) {
    return new Date(offlineMs);
  }
  const fallbackDate = parseFirestoreDateFieldToJsDate(transaction["date"]);
  if (!fallbackDate) return null;
  // Sirf calendar date (picker midnight) — asli entry clock nahi; "12:00 AM" misleading hide karo.
  if (
    fallbackDate.getHours() === 0 &&
    fallbackDate.getMinutes() === 0 &&
    fallbackDate.getSeconds() === 0 &&
    fallbackDate.getMilliseconds() === 0
  ) {
    return null;
  }
  return fallbackDate;
}

/** New voucher save: user-picked calendar day + abhi ka local clock — `date` fallback par 12:00 AM na dikhe. */
export function mergeVoucherCalendarDateWithSaveClock(calendarDate: Date): Date {
  const d =
    calendarDate instanceof Date && !isNaN(calendarDate.getTime()) ? calendarDate : new Date();
  const now = new Date();
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
}

export function formatVoucherEntryTimeLocal(
  transaction: Record<string, unknown> | null | undefined,
  timePattern = "h:mm a"
): string {
  const dt = getVoucherEntryTimeSourceDate(transaction);
  if (!dt) return "";
  return format(dt, timePattern);
}

/**
 * Voucher `date` ko hamesha Firestore-compatible `Timestamp` banata hai.
 * Local outbox JSON + SQLite round-trip mein `Date` / plain `__fsTs` / string mix se "date gayab" (statement khali) avoid.
 */
export function coerceVoucherDocumentDate(data: Record<string, unknown> | null | undefined): void {
  if (data == null || typeof data !== "object") return;
  const raw = data["date"];

  if (raw === undefined || raw === null || raw === "") {
    data["date"] = Timestamp.now();
    return;
  }
  if (raw instanceof Timestamp) return;

  if (raw instanceof Date) {
    data["date"] = isNaN(raw.getTime()) ? Timestamp.now() : Timestamp.fromDate(raw);
    return;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const d = new Date(raw);
    data["date"] = isNaN(d.getTime()) ? Timestamp.now() : Timestamp.fromDate(d);
    return;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown> & {
      __fsTs?: boolean;
      seconds?: unknown;
      _seconds?: unknown;
      nanoseconds?: unknown;
      _nanoseconds?: unknown;
      toDate?: () => Date;
    };
    const sec =
      typeof o.seconds === "number" && Number.isFinite(o.seconds)
        ? o.seconds
        : typeof o._seconds === "number" && Number.isFinite(o._seconds)
          ? o._seconds
          : null;
    const nsRaw =
      typeof o.nanoseconds === "number" && Number.isFinite(o.nanoseconds)
        ? o.nanoseconds
        : typeof o._nanoseconds === "number" && Number.isFinite(o._nanoseconds)
          ? o._nanoseconds
          : 0;
    if (o.__fsTs === true && sec !== null) {
      // Accept both canonical and underscored timestamp keys while coercing voucher date.
      data["date"] = new Timestamp(sec, nsRaw as number);
      return;
    }
    // JSON / cache se sirf `{ seconds, nanoseconds }` — `toDate` nahi; pehle yahan gir kar `Timestamp.now()` ho jata tha
    if (sec !== null) {
      // Underscored keys (`_seconds`) from serialized snapshots should not become "today" by mistake.
      data["date"] = new Timestamp(sec, nsRaw as number);
      return;
    }
    if (typeof o.toDate === "function") {
      try {
        const d = o.toDate();
        data["date"] = d instanceof Date && !isNaN(d.getTime()) ? Timestamp.fromDate(d) : Timestamp.now();
      } catch {
        data["date"] = Timestamp.now();
      }
      return;
    }
  }
  data["date"] = Timestamp.now();
}

/**
 * Calendar orange dots: voucher `date` → unique local start-of-day Dates.
 * Uses `parseFirestoreDateFieldToJsDate` so plserver wire `{seconds,nanoseconds}` (no `toDate`) still marks days.
 */
export function collectVoucherCalendarDates(vouchers: Array<{ date?: unknown } | null | undefined>): Date[] {
  const dates = new Set<number>();
  for (const v of vouchers) {
    if (!v) continue;
    const dateValue = parseFirestoreDateFieldToJsDate(v.date);
    if (dateValue) dates.add(startOfDay(dateValue).getTime());
  }
  return Array.from(dates, (ms) => new Date(ms));
}
