import { adToBs, NEPALI_MONTHS } from "@/lib/bs-date";

export type RecurringIncreaseDateSystem = "AD" | "BS" | "Both";

function dayAtNoon(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); }
function bsName(month: number): string { return NEPALI_MONTHS[month - 1] || "Baisakh"; }
function adIso(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function formatRecurringIncreaseDateLabel(date: Date, system: RecurringIncreaseDateSystem): string {
  const bs = adToBs(dayAtNoon(date));
  const adStart = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const bsLabel = `${bs.y}-${String(bs.m).padStart(2, "0")}-${bs.d} ${bsName(bs.m)}`;
  const adLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${adStart.toLocaleString("en-US", { month: "long" })}`;
  if (system === "AD") return adLabel;
  if (system === "Both") return `${bsLabel} (${adIso(date)} ${adStart.toLocaleString("en-US", { month: "long" })})`;
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
