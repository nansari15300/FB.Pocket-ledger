/** Shared document date parser: AD + BS (YMD and DMY), plus month-name dates used on bank slips. */
import { bsToAd, getBSMonthDays } from "@/lib/bs-date";

export type ParsedDocDate = { date: Date; ambiguous: boolean; source: string };

const MON: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export type DateParseOpts = { min?: Date; max?: Date };

function inRange(d: Date, opts?: DateParseOpts): boolean {
  if (opts?.min && d < opts.min) return false;
  if (opts?.max && d > opts.max) return false;
  return true;
}

function ad(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

function fromBs(y: number, mo: number, d: number): Date | null {
  if (y < 2070 || y > 2099 || mo < 1 || mo > 12 || d < 1) return null;
  const days = getBSMonthDays(y)?.[mo - 1];
  if (!days || d > days) return null;
  try {
    return bsToAd({ y, m: mo, d });
  } catch {
    return null;
  }
}

function push(out: ParsedDocDate[], date: Date | null, ambiguous: boolean, source: string, opts?: DateParseOpts) {
  if (!date) {
    out.push({ date: new Date(NaN), ambiguous: true, source });
    return;
  }
  const ok = inRange(date, opts);
  out.push({ date: ok ? date : date, ambiguous: ambiguous || !ok, source });
}

/** All dates found in `text` (may include flagged/out-of-range). */
export function parseDocDates(text: string, opts?: DateParseOpts): ParsedDocDate[] {
  const out: ParsedDocDate[] = [];
  const t = String(text ?? "");
  let m: RegExpExecArray | null;

  const ymd = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = ymd.exec(t))) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y >= 2070 && y <= 2099) push(out, fromBs(y, mo, d), false, m[0], opts);
    else if (y >= 2010 && y <= 2045) push(out, ad(y, mo, d), false, m[0], opts);
  }

  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g;
  while ((m = dmy.exec(t))) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (y >= 2070 && y <= 2099) {
      // BS in DMY (15/07/2083, 19-07-2083)
      const amb = a <= 12 && b <= 12 && a !== b;
      if (amb) {
        // Prefer day-first (Nepali miti convention) but flag
        push(out, fromBs(y, b, a), true, m[0], opts);
      } else if (b <= 12) {
        push(out, fromBs(y, b, a), false, m[0], opts);
      }
      continue;
    }
    if (y < 2010 || y > 2045) continue;
    if (a <= 12 && b <= 12 && a !== b) {
      out.push({ date: new Date(NaN), ambiguous: true, source: m[0] });
      continue;
    }
    push(out, ad(y, b, a), false, m[0], opts);
  }

  const mon = /\b(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3})[a-z]*\s*[-/ ]\s*(\d{4})\b/g;
  while ((m = mon.exec(t))) {
    const month = MON[m[2].toLowerCase()];
    if (month == null) continue;
    const y = +m[3], d = +m[1];
    if (y < 2010 || y > 2045) continue;
    const dt = new Date(y, month, d, 0, 0, 0, 0);
    if (dt.getMonth() !== month || dt.getDate() !== d) continue;
    push(out, dt, false, m[0], opts);
  }

  return out;
}

/** First unambiguous in-range date, else first parsable date, else null. */
export function parseSingleDocDate(text?: string, opts?: DateParseOpts): Date | null {
  const all = parseDocDates(String(text ?? ""), opts);
  const good = all.find((x) => x.date && !Number.isNaN(x.date.getTime()) && !x.ambiguous);
  if (good) return good.date;
  const any = all.find((x) => x.date && !Number.isNaN(x.date.getTime()));
  return any ? any.date : null;
}

/** Default voucher window: last ~400 days through +7 days from today. */
export function defaultVoucherDateWindow(now = new Date()): DateParseOpts {
  return { min: new Date(now.getTime() - 400 * 864e5), max: new Date(now.getTime() + 7 * 864e5) };
}
