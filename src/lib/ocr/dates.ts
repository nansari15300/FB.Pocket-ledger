/** Shared document date parser: AD + BS (YMD and DMY), plus month-name dates used on bank slips. */
import { adToBs, bsToAd, getBSMonthDays } from "@/lib/bs-date";

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

/**
 * Same as parseSingleDocDate, but also resolves DD/MM-vs-MM/DD ambiguity instead of returning null.
 * Nepali slips write day-first (06/08/2026 = 6 Aug). The voucher window disambiguates when only one
 * reading is plausible; otherwise day-first wins. Without this a connectIPS slip printing only
 * "INVOICE DATE: 06/08/2026" left the Date field empty.
 */
export function parseSingleDocDateLoose(text?: string, opts?: DateParseOpts): Date | null {
  const t = String(text ?? "");
  const strict = parseSingleDocDate(t, opts);
  if (strict) return strict;
  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(t);
  if (!dmy) return null;
  const a = +dmy[1], b = +dmy[2], y = +dmy[3];
  if (y < 2010 || y > 2045 || a > 12 || b > 12 || a === b) return null;
  const dmyDate = ad(y, b, a);
  const mdyDate = ad(y, a, b);
  const dmyOk = !!dmyDate && inRange(dmyDate, opts);
  const mdyOk = !!mdyDate && inRange(mdyDate, opts);
  if (dmyOk && !mdyOk) return dmyDate;
  if (mdyOk && !dmyOk) return mdyDate;
  return dmyDate ?? mdyDate;
}

/** Default voucher window: last ~400 days through +7 days from today. */
export function defaultVoucherDateWindow(now = new Date()): DateParseOpts {
  return { min: new Date(now.getTime() - 400 * 864e5), max: new Date(now.getTime() + 7 * 864e5) };
}

/* ---------------------- Bill date resolve (AD + BS) ---------------------- */

export type BillDateCalendar = "AD" | "BS";
export type BillDateVia = "ad+bs-agree" | "bs-only" | "ad-only" | "unlabeled" | "ambiguous";

export type ResolvedBillDate = {
  date: Date;
  status: "fill" | "flag";
  confidence: number;
  note?: string;
  via: BillDateVia;
  adSource?: string;
  bsSource?: string;
};

type Interp = {
  date: Date;
  calendar: BillDateCalendar;
  y: number;
  m: number;
  d: number;
  dayFirst: boolean;
  source: string;
  label: string;
  labeled: boolean;
};

const DATE_TOKEN = /\b(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b|\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\b/g;

/** "Invoice Date" / "Invoice Miti" / "Dat3" / "Mit1" and similar OCR variants. */
const LABEL_RE = /((?:invoice|bill|[il1]nvo[il1]ce)\s*(?:dat[e3]|m[il1]t[il1])|nepali\s*dat[e3]|m[il1]t[il1]|dated|dat[e3])\b/gi;
const SKIP_LABEL_RE = /\b(due\s*dat[e3]|print(?:ed)?\s*(?:time|date))\b/i;

function kindOfLabel(label: string): "miti" | "date" | "skip" | "" {
  const s = label.toLowerCase().replace(/[il1]/g, (ch) => (ch === "1" || ch === "l" ? "i" : ch));
  if (SKIP_LABEL_RE.test(s)) return "skip";
  if (/\bmiti\b|\bnepali\s*date\b/.test(s)) return "miti";
  if (/\b(invoice|bill)?\s*date\b|\bdated\b|\bdat[e3]\b/.test(s)) return "date";
  return "";
}

function labelBefore(text: string, index: number): string {
  const from = Math.max(0, index - 48);
  const before = text.slice(from, index);
  // Ignore a date that sits on a Due / Printed line.
  if (SKIP_LABEL_RE.test(before.split(/\n/).pop() ?? before)) return "due";
  LABEL_RE.lastIndex = 0;
  let last = "";
  let m: RegExpExecArray | null;
  const re = new RegExp(LABEL_RE.source, "gi");
  while ((m = re.exec(before))) {
    const between = before.slice(m.index + m[0].length);
    // Label is "near" if only punctuation / spaces remain before the date.
    if (/^[\s:.\-#]*$/.test(between)) last = m[1] || m[0];
  }
  return last;
}

function sameCivilDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function agreesAdBs(adDate: Date, bs: { y: number; m: number; d: number }): boolean {
  try {
    const conv = bsToAd(bs);
    if (sameCivilDay(conv, adDate)) return true;
  } catch { /* ignore */ }
  try {
    const back = adToBs(adDate);
    if (back.y === bs.y && back.m === bs.m && back.d === bs.d) return true;
  } catch { /* ignore */ }
  return false;
}

function interpretations(source: string, a1: number, a2: number, a3: number, ymd: boolean, label: string, labeled: boolean): Interp[] {
  const out: Interp[] = [];
  const pushI = (calendar: BillDateCalendar, y: number, m: number, d: number, dayFirst: boolean, date: Date | null) => {
    if (!date || Number.isNaN(date.getTime())) return;
    out.push({ date, calendar, y, m, d, dayFirst, source, label, labeled });
  };
  if (ymd) {
    const y = a1, mo = a2, d = a3;
    if (y >= 2070 && y <= 2099) pushI("BS", y, mo, d, false, fromBs(y, mo, d));
    else if (y >= 2010 && y <= 2045) pushI("AD", y, mo, d, false, ad(y, mo, d));
    return out;
  }
  const p = a1, q = a2, y = a3;
  const yearBs = y >= 2070 && y <= 2099;
  const yearAd = y >= 2010 && y <= 2045;
  // Year decides the calendar; a "Miti" label only confirms BS, "Invoice Date" confirms AD when the year agrees.
  const lab = kindOfLabel(label);
  if (lab === "skip") return out;
  if (yearBs) {
    const amb = p <= 12 && q <= 12 && p !== q;
    if (amb) {
      pushI("BS", y, q, p, true, fromBs(y, q, p));
      pushI("BS", y, p, q, false, fromBs(y, p, q));
    } else if (q <= 12) {
      pushI("BS", y, q, p, true, fromBs(y, q, p));
    } else if (p <= 12) {
      pushI("BS", y, p, q, false, fromBs(y, p, q));
    }
    return out;
  }
  if (!yearAd) return out;
  const amb = p <= 12 && q <= 12 && p !== q;
  if (amb) {
    // Keep both MDY and DMY; the BS cross-check (or the voucher window) picks one.
    pushI("AD", y, p, q, false, ad(y, p, q)); // MM/DD
    pushI("AD", y, q, p, true, ad(y, q, p)); // DD/MM
  } else if (q <= 12) {
    pushI("AD", y, q, p, true, ad(y, q, p));
  } else if (p <= 12) {
    pushI("AD", y, p, q, false, ad(y, p, q));
  }
  return out;
}

function collectInterps(text: string): Interp[] {
  const t = String(text ?? "");
  const out: Interp[] = [];
  const re = new RegExp(DATE_TOKEN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const label = labelBefore(t, m.index);
    if (kindOfLabel(label) === "skip" || label === "due") continue;
    const labeled = !!label && kindOfLabel(label) !== "";
    if (m[1]) out.push(...interpretations(m[0], +m[1], +m[2], +m[3], true, label, labeled));
    else out.push(...interpretations(m[0], +m[4], +m[5], +m[6], false, label, labeled));
  }
  return out;
}

function uniqueDates(list: Interp[]): Date[] {
  const seen = new Set<number>();
  const dates: Date[] = [];
  for (const i of list) {
    const k = +new Date(i.date.getFullYear(), i.date.getMonth(), i.date.getDate());
    if (seen.has(k)) continue;
    seen.add(k);
    dates.push(i.date);
  }
  return dates;
}

/**
 * Pick the voucher date from a bill that may print both Invoice Date (AD) and Invoice Miti (BS).
 * Year 20xx vs 207x/208x selects the calendar. DD/MM vs MM/DD is resolved by BS<->AD conversion
 * when both calendars are present; a lone date is converted or used as-is.
 */
export function resolveBillDate(text: string, opts?: DateParseOpts): ResolvedBillDate | null {
  const all = collectInterps(text);
  if (!all.length) return null;

  const labeled = all.filter((i) => i.labeled);
  // Prefer labeled tokens, but keep the other calendar's unlabeled dates for the AD<->BS cross-check.
  let pool = labeled.length ? labeled.slice() : all;
  if (labeled.length) {
    if (!labeled.some((i) => i.calendar === "AD")) pool = pool.concat(all.filter((i) => i.calendar === "AD"));
    if (!labeled.some((i) => i.calendar === "BS")) pool = pool.concat(all.filter((i) => i.calendar === "BS"));
  }
  const adHits = pool.filter((i) => i.calendar === "AD");
  const bsHits = pool.filter((i) => i.calendar === "BS");

  const agreeing: { date: Date; ad?: Interp; bs?: Interp }[] = [];
  for (const bs of bsHits) {
    for (const adHit of adHits) {
      if (agreesAdBs(adHit.date, { y: bs.y, m: bs.m, d: bs.d }) || sameCivilDay(adHit.date, bs.date)) {
        agreeing.push({ date: adHit.date, ad: adHit, bs });
      }
    }
  }

  const uniqAgree = uniqueDates(agreeing.map((a) => ({ date: a.date } as Interp)));
  if (uniqAgree.length === 1) {
    const hit = agreeing.find((a) => sameCivilDay(a.date, uniqAgree[0]))!;
    return {
      date: uniqAgree[0],
      status: "fill",
      confidence: 0.98,
      via: "ad+bs-agree",
      adSource: hit.ad?.source,
      bsSource: hit.bs?.source,
      note: `Invoice Date ${hit.ad?.source ?? ""} agrees with Miti ${hit.bs?.source ?? ""}`.trim(),
    };
  }
  if (uniqAgree.length > 1) {
    return {
      date: uniqAgree[0],
      status: "flag",
      confidence: 0.5,
      via: "ambiguous",
      note: "Several AD/BS date pairs disagree",
    };
  }

  // Only one calendar (or the two did not agree).
  if (bsHits.length && !adHits.length) {
    const uniq = uniqueDates(bsHits);
    if (uniq.length === 1) {
      return { date: uniq[0], status: "fill", confidence: 0.95, via: "bs-only", bsSource: bsHits[0].source, note: `Miti ${bsHits[0].source}` };
    }
    return { date: uniq[0], status: "flag", confidence: 0.5, via: "ambiguous", note: "Several BS dates without a matching AD date", bsSource: bsHits[0].source };
  }

  if (adHits.length && !bsHits.length) {
    const uniq = uniqueDates(adHits);
    if (uniq.length === 1) {
      return { date: uniq[0], status: "fill", confidence: adHits.every((h) => !adHits.some((o) => o.source === h.source && !sameCivilDay(o.date, h.date))) ? 0.95 : 0.9, via: "ad-only", adSource: adHits[0].source };
    }
    const inWin = uniq.filter((d) => inRange(d, opts));
    if (inWin.length === 1) {
      return { date: inWin[0], status: "fill", confidence: 0.85, via: "ad-only", adSource: adHits.find((h) => sameCivilDay(h.date, inWin[0]))?.source, note: "Ambiguous AD date; only one interpretation is in range" };
    }
    return { date: uniq[0], status: "flag", confidence: 0.5, via: "ambiguous", note: "Ambiguous AD date (DD/MM vs MM/DD)", adSource: adHits[0].source };
  }

  // Both calendars present but no agreeing pair: prefer a unique BS miti as a flag? Keep it suggestion-only.
  if (bsHits.length) {
    const uniq = uniqueDates(bsHits);
    if (uniq.length === 1) {
      return { date: uniq[0], status: "flag", confidence: 0.55, via: "ambiguous", bsSource: bsHits[0].source, adSource: adHits[0]?.source, note: "Invoice Date and Miti do not agree" };
    }
  }
  if (adHits.length) {
    const uniq = uniqueDates(adHits);
    return { date: uniq[0], status: "flag", confidence: 0.5, via: "ambiguous", adSource: adHits[0].source, note: "AD and BS dates did not agree" };
  }

  const fallback = uniqueDates(pool);
  if (!fallback.length) return null;
  if (fallback.length === 1 && !labeled.length) {
    return { date: fallback[0], status: "fill", confidence: 0.9, via: "unlabeled" };
  }
  return { date: fallback[0], status: "flag", confidence: 0.5, via: "ambiguous", note: "Several dates without a consistent label" };
}

/** Local calendar YYYY-MM-DD for tests and debug lines. */
export function localYmd(d?: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
