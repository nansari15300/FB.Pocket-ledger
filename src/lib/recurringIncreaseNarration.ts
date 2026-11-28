import { adToBs, bsToAd, getBSMonthDays, NEPALI_MONTHS } from "@/lib/bs-date";

export type RecurringIncreaseDateSystem = "AD" | "BS" | "Both";

function dayAtNoon(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); }
function bsName(month: number): string { return NEPALI_MONTHS[month - 1] || "Baisakh"; }
function adIso(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function bsMonthStartAd(year: number, month: number): Date { return bsToAd({ y: year, m: month, d: 1 }); }
function bsMonthEndAd(year: number, month: number): Date { return bsToAd({ y: year, m: month, d: getBSMonthDays(year)[month - 1] || 30 }); }
function adMonthRange(start: Date, end: Date): string[] {
  const values: string[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
  const last = new Date(end.getFullYear(), end.getMonth(), 1, 12);
  for (let i = 0; i < 3; i++) { values.push(cursor.toLocaleString("en-US", { month: "long" })); if (cursor.getFullYear() === last.getFullYear() && cursor.getMonth() === last.getMonth()) break; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12); }
  return [...new Set(values)];
}
function bsMonthRange(start: Date, end: Date): string[] {
  const first = adToBs(dayAtNoon(start)); const last = adToBs(dayAtNoon(end)); const values: string[] = []; let y = first.y; let m = first.m;
  for (let i = 0; i < 3; i++) { values.push(bsName(m)); if (y === last.y && m === last.m) break; if (++m > 12) { m = 1; y++; } }
  return [...new Set(values)];
}

export function formatRecurringIncreaseDateLabel(date: Date, system: RecurringIncreaseDateSystem): string {
  const bs = adToBs(dayAtNoon(date)); const bsStart = bsMonthStartAd(bs.y, bs.m); const bsEnd = bsMonthEndAd(bs.y, bs.m);
  const adStart = new Date(date.getFullYear(), date.getMonth(), 1, 12); const adEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  const bsLabel = `${bs.y}-${String(bs.m).padStart(2, "0")}-${bs.d} ${bsName(bs.m)}`;
  const adLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${adStart.toLocaleString("en-US", { month: "long" })}`;
  const adMonths = adMonthRange(bsStart, bsEnd).join("/"); const bsMonths = bsMonthRange(adStart, adEnd).join("/");
  const bsDate = `${bs.y}-${String(bs.m).padStart(2, "0")}-${bs.d}`;
  if (system === "AD") return adLabel;
  if (system === "Both") return `${bsLabel} (${adMonths}; ${adIso(date)}) / ${adLabel} (${bsMonths}; BS ${bsDate})`;
  return bsLabel;
}

export function recurringIncreaseNarrationParts(narration: string, meta: unknown, voucherDate: Date | null | undefined, system: RecurringIncreaseDateSystem): { before: string; label: string; after: string } | null {
  if (!meta || typeof meta !== "object" || !voucherDate || Number.isNaN(voucherDate.getTime())) return null;
  const metadata = meta as Record<string, unknown>; const marker = String(metadata.increaseNarrationSuffix || "").trim(); if (!marker) return null;
  const text = String(narration || ""); const index = text.lastIndexOf(marker); if (index < 0) return null;
  const after = text.slice(index + marker.length); if (after.trim() && !/^\s*\|\s*Id\b/i.test(after)) return null;
  const topic = String(metadata.increaseNarrationTopic || marker.split(/\s+Increased from\s+/i)[0] || "").trim(); if (!topic) return null;
  const effectiveFrom = typeof metadata.increaseNarrationEffectiveFrom === "string"
    ? new Date(metadata.increaseNarrationEffectiveFrom)
    : voucherDate;
  const labelDate = effectiveFrom && !Number.isNaN(effectiveFrom.getTime()) ? effectiveFrom : voucherDate;
  return { before: text.slice(0, index).trimEnd(), label: `${topic} Increased from ${formatRecurringIncreaseDateLabel(labelDate, system)}`, after };
}
