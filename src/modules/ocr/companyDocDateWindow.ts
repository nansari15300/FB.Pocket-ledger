/**
 * Company Doc default date-window rule (Gallery grid).
 * Default view = this month. If this month has fewer than 20 files, earlier-dated
 * files (newest first, any FY) are added until 20, or until every file is shown.
 * If this month already has 20 or more, only this month is shown.
 * A user-picked custom range is kept exactly — no backfill.
 * When earlier files are added to reach 20, the date pill shows the
 * oldest-to-newest dates of the files in the grid (display only; it is
 * not treated as a user-picked custom range).
 */

import { adToBs, bsToAd, getBSMonthDays } from "@/lib/bs-date";

export const COMPANY_DOC_MIN_VISIBLE_FILES = 20;

export const COMPANY_DOC_DATE_FILTER_INTRO = {
  en: "Company Doc’s default date window is this month. If this month has fewer than 20 files, earlier files are added (newest first, including other fiscal years) until 20 are shown, or until every file is shown if the company has fewer than 20. If this month already has 20 or more files, only this month’s files are shown. A date range you pick yourself is kept exactly, with no extra files added. When earlier files are added to reach 20, the date pill shows the date range of the files in the grid, not just this month.",
  hi: "Company Doc की डिफ़ॉल्ट तारीख इस महीने की है। अगर इस महीने में 20 से कम फाइलें हैं, तो पुरानी तारीख की फाइलें (नयी पहले, दूसरे वित्तीय वर्ष भी) जोड़कर 20 तक दिखाई जाती हैं। कुल फाइलें 20 से कम हों तो सभी दिखती हैं। अगर इस महीने में 20 या उससे अधिक फाइलें हैं, तो केवल इसी महीने की सभी फाइलें दिखती हैं। आपने खुद चुनी हुई तारीख की सीमा ज्यों की त्यों रहती है, उसमें अतिरिक्त फाइलें नहीं जुड़तीं। जब 20 तक पहुँचाने के लिए पुरानी तारीख की फाइलें जोड़ी जाती हैं, तो तारीख की गोली ग्रिड में दिख रही फाइलों का तारीख-सीमा दिखाती है, सिर्फ़ इसी महीने का नहीं।",
  ne: "Company Doc को डिफल्ट मिति यो महिनाको हो। यो महिनामा २० भन्दा कम फाइल भए पुराना मितिका फाइलहरू (नयाँ पहिले, अन्य वित्तीय वर्ष पनि) थपेर २० वटा देखाइन्छ। जम्मा फाइल २० भन्दा कम भए सबै देखिन्छन्। यो महिनामा २० वा सोभन्दा बढी फाइल भए यही महिनाका सबै मात्र देखिन्छन्। तपाईंले आफैं रोजेको मिति सीमा जस्ताको तस्तै राखिन्छ, थप फाइल जोडिँदैन। २० पुर्‍याउन अघिल्ला मितिका फाइल थपिएमा, मिति बटनमा यो महिना मात्र होइन, ग्रिडमा देखिएका फाइलको मिति दायरा देखिन्छ।",
} as const;

export function companyDocDateFilterIntro(introLang?: string | null): string {
  if (introLang === "ne") return COMPANY_DOC_DATE_FILTER_INTRO.ne;
  if (introLang === "hi") return COMPANY_DOC_DATE_FILTER_INTRO.hi;
  return COMPANY_DOC_DATE_FILTER_INTRO.en;
}

/** Local calendar day, same rule as date-fns startOfDay. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local calendar day, same rule as date-fns endOfDay. */
export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Voucher date from Date, ms, ISO, or Timestamp-like. */
export function parseCompanyDocVoucherDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw === "string" && raw.trim()) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw === "object") {
    const value = raw as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof value.toDate === "function") {
      try {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      } catch {
        return null;
      }
    }
    const seconds =
      typeof value.seconds === "number" && Number.isFinite(value.seconds)
        ? value.seconds
        : typeof value._seconds === "number" && Number.isFinite(value._seconds)
          ? value._seconds
          : null;
    if (seconds != null) {
      const date = new Date(seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
}

export function parseCompanyDocVoucherDateMs(raw: unknown): number | null {
  const date = parseCompanyDocVoucherDate(raw);
  return date ? date.getTime() : null;
}

/**
 * Default Company Doc window: the current calendar month.
 * BS (and Both) use the current Bikram Sambat month; AD uses the Gregorian month.
 */
export function defaultCompanyDocMonthRange(
  now: Date,
  dateSystem?: string | null,
): { from: Date; to: Date } {
  const useBs = dateSystem === "BS" || dateSystem === "Both";
  if (useBs) {
    const bs = adToBs(now);
    const from = startOfLocalDay(bsToAd({ y: bs.y, m: bs.m, d: 1 }));
    const daysInMonth = getBSMonthDays(bs.y)[bs.m - 1] ?? 30;
    const to = endOfLocalDay(bsToAd({ y: bs.y, m: bs.m, d: daysInMonth }));
    return { from, to };
  }
  const from = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = endOfLocalDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { from, to };
}

export type CompanyDocDatedFile = {
  id: string;
  dateMs: number;
};

export type CompanyDocDateRuleOptions = {
  mode: "default-month" | "custom-range";
  now?: Date;
  dateSystem?: string | null;
  monthFromMs?: number;
  monthToMs?: number;
  customFromMs?: number;
  customToMs?: number;
  minCount?: number;
};

export type SelectCompanyDocFilesResult<T extends CompanyDocDatedFile> = {
  selected: T[];
  thisMonthCount: number;
  earlierFilledCount: number;
  filledFromEarlier: boolean;
};

function isValidMs(ms: number): boolean {
  return typeof ms === "number" && Number.isFinite(ms);
}

function cmpNewestFirst<T extends CompanyDocDatedFile>(a: T, b: T): number {
  const aOk = isValidMs(a.dateMs);
  const bOk = isValidMs(b.dateMs);
  if (aOk && bOk && a.dateMs !== b.dateMs) return b.dateMs - a.dateMs;
  if (aOk !== bOk) return aOk ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function monthBoundsMs(options: CompanyDocDateRuleOptions): { fromMs: number; toMs: number } {
  if (options.monthFromMs != null && options.monthToMs != null) {
    return { fromMs: options.monthFromMs, toMs: options.monthToMs };
  }
  const range = defaultCompanyDocMonthRange(options.now ?? new Date(), options.dateSystem);
  return { fromMs: range.from.getTime(), toMs: range.to.getTime() };
}

/** Count this-month vs earlier files (invalid dates skipped; later-than-this-month ignored). */
export function countCompanyDocFilesByMonthWindow(
  files: readonly CompanyDocDatedFile[],
  monthFromMs: number,
  monthToMs: number,
): { thisMonth: number; earlier: number } {
  let thisMonth = 0;
  let earlier = 0;
  for (const file of files) {
    if (!isValidMs(file.dateMs)) continue;
    if (file.dateMs >= monthFromMs && file.dateMs <= monthToMs) thisMonth += 1;
    else if (file.dateMs < monthFromMs) earlier += 1;
  }
  return { thisMonth, earlier };
}

/**
 * Pick which Company Doc files the default / custom date window should show.
 * The returned `selected` list is newest-first (then id) so the existing
 * top-left-to-right · newest-first grid order still applies.
 */
export function selectCompanyDocFilesByDateRule<T extends CompanyDocDatedFile>(
  files: readonly T[],
  options: CompanyDocDateRuleOptions,
): SelectCompanyDocFilesResult<T> {
  const minCount = options.minCount ?? COMPANY_DOC_MIN_VISIBLE_FILES;

  if (options.mode === "custom-range") {
    const fromMs = options.customFromMs;
    const toMs = options.customToMs ?? fromMs;
    const selected =
      fromMs == null || toMs == null
        ? []
        : files
            .filter((file) => isValidMs(file.dateMs) && file.dateMs >= fromMs && file.dateMs <= toMs)
            .slice()
            .sort(cmpNewestFirst);
    return { selected, thisMonthCount: 0, earlierFilledCount: 0, filledFromEarlier: false };
  }

  const bounds = monthBoundsMs(options);
  const thisMonth: T[] = [];
  const earlier: T[] = [];
  for (const file of files) {
    if (!isValidMs(file.dateMs)) continue;
    if (file.dateMs >= bounds.fromMs && file.dateMs <= bounds.toMs) thisMonth.push(file);
    else if (file.dateMs < bounds.fromMs) earlier.push(file);
  }
  thisMonth.sort(cmpNewestFirst);
  earlier.sort(cmpNewestFirst);

  if (thisMonth.length >= minCount) {
    return {
      selected: thisMonth,
      thisMonthCount: thisMonth.length,
      earlierFilledCount: 0,
      filledFromEarlier: false,
    };
  }

  const fill = earlier.slice(0, Math.max(0, minCount - thisMonth.length));
  return {
    selected: [...thisMonth, ...fill].sort(cmpNewestFirst),
    thisMonthCount: thisMonth.length,
    earlierFilledCount: fill.length,
    filledFromEarlier: fill.length > 0,
  };
}

/**
 * Date range shown on the Company Doc date pill.
 * Default month with no backfill: this month (monthFrom..monthTo).
 * Default month with backfill: oldest shown file date (start of day) through
 * newest shown file date (end of day) — the actual span of files in the grid,
 * not the whole current month. This is display-only; it does not change the
 * default-month rule or become a user-picked custom range.
 */
export function companyDocDatePillRange(
  options: {
    filledFromEarlier: boolean;
    selected: ReadonlyArray<{ dateMs: number }>;
    monthFrom: Date;
    monthTo: Date;
  },
): { from: Date; to: Date } {
  if (!options.filledFromEarlier) {
    return { from: options.monthFrom, to: options.monthTo };
  }
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const file of options.selected) {
    if (!isValidMs(file.dateMs)) continue;
    if (file.dateMs < minMs) minMs = file.dateMs;
    if (file.dateMs > maxMs) maxMs = file.dateMs;
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return { from: options.monthFrom, to: options.monthTo };
  }
  return { from: startOfLocalDay(new Date(minMs)), to: endOfLocalDay(new Date(maxMs)) };
}
