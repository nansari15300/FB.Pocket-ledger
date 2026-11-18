/** English / Hindi / Nepali note for the Recent OCR Today-pill info icon. */
export const RECENT_OCR_DATE_FILTER_INTRO = {
  en: "Recent OCR Trxn date filter uses the posted date, not the voucher date.",
  hi: "Recent OCR Trxn के डेट फ़िल्टर में वाउचर डेट नहीं, पोस्टेड डेट दिखती है।",
  ne: "Recent OCR Trxn को मिति फिल्टरमा भाउचर मिति होइन, पोस्ट गरिएको मिति देखिन्छ।",
} as const;

export function recentOcrDateFilterIntro(introLang?: string | null): string {
  if (introLang === "ne") return RECENT_OCR_DATE_FILTER_INTRO.ne;
  if (introLang === "hi") return RECENT_OCR_DATE_FILTER_INTRO.hi;
  return RECENT_OCR_DATE_FILTER_INTRO.en;
}

/** Local calendar day, same rule as date-fns startOfDay. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Posted / created time from a raw field (Date, ms, ISO, Timestamp-like). */
export function parseRecentOcrPostedAt(raw: unknown): Date | null {
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

/** Prefer the row's createdAt, then the voucher's createdAt. Never uses voucher date. */
export function getRecentOcrPostedDate(
  row?: { createdAt?: unknown; date?: unknown } | null,
  voucher?: { createdAt?: unknown; date?: unknown } | null,
): Date | null {
  return parseRecentOcrPostedAt(row?.createdAt) ?? parseRecentOcrPostedAt(voucher?.createdAt) ?? null;
}

export function isRecentOcrPostedOnDay(postedAt: Date | null | undefined, day: Date): boolean {
  if (!postedAt) return false;
  return startOfLocalDay(postedAt).getTime() === startOfLocalDay(day).getTime();
}

export function filterRecentOcrByPostedDay<T extends { createdAt?: unknown; id?: unknown }>(
  rows: T[],
  day: Date,
  voucherById?: Map<string, { createdAt?: unknown }>,
): T[] {
  return rows.filter((row) =>
    isRecentOcrPostedOnDay(
      getRecentOcrPostedDate(row, voucherById?.get(String(row.id || ""))),
      day,
    ),
  );
}

export function collectRecentOcrPostedCalendarDates(
  vouchers: Array<{ createdAt?: unknown; date?: unknown } | null | undefined>,
): Date[] {
  const days = new Set<number>();
  for (const voucher of vouchers) {
    const posted = getRecentOcrPostedDate(voucher);
    if (posted) days.add(startOfLocalDay(posted).getTime());
  }
  return Array.from(days, (ms) => new Date(ms));
}
