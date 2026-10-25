import { adToBs, bsToAd, getBSMonthDays } from "@/lib/bs-date";
import {
  type CompanyFiscalYearDates,
  fiscalTemplateFromCompanyDates,
  getFiscalRangeForCompany,
  getFiscalRangeForCountry,
} from "@/lib/fiscalRange";
import type { Party } from "@/components/party/types";
import { getTransactionAmounts } from "@/hooks/use-transactions";

export const ANUSUCHI13_ONE_LAC = 100_000;

export type Anusuchi13ConfirmationFilter =
  | "all"
  | "sent"
  | "unsent"
  | "completed"
  | "uncompleted";

export type Anusuchi13ConfirmationFyRecord = {
  sent?: boolean;
  completed?: boolean;
  statementSent?: boolean;
  sentViaEmail?: boolean;
  sentViaPhone?: boolean;
  statementSentViaEmail?: boolean;
  statementSentViaPhone?: boolean;
};

export type Anusuchi13ReportMemory = {
  partyId?: string;
  confirmationRunning?: boolean;
  confirmationFilter?: Anusuchi13ConfirmationFilter;
  selectedFyKey?: string;
};

function parseVoucherDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Running FY key — Nepal BS years e.g. `2081-2082`. */
export function getAnusuchi13FyKey(
  country?: string,
  baseDate: Date = new Date(),
  companyDates?: CompanyFiscalYearDates | null
): string {
  const { start, end } = getFiscalRangeForCompany(country, baseDate, companyDates);
  const normalized = (country || "").trim().toLowerCase();
  if (normalized === "nepal") {
    const startBs = adToBs(start);
    const endBs = adToBs(end);
    return `${startBs.y}-${endBs.y}`;
  }
  return `${start.getFullYear()}-${end.getFullYear()}`;
}

function getFiscalTemplateForCountry(country?: string) {
  const normalized = (country || "").trim().toLowerCase();
  if (normalized === "india") return { startMonth: 3, startDay: 1, endMonth: 2, endDay: 31 };
  if (
    normalized === "bangladesh" ||
    normalized === "pakistan" ||
    normalized === "australia" ||
    normalized === "new zealand"
  ) {
    return { startMonth: 6, startDay: 1, endMonth: 5, endDay: 30 };
  }
  return { startMonth: 0, startDay: 1, endMonth: 11, endDay: 31 };
}

/** FY dropdown selection → AD date range for that fiscal year. */
export function getFiscalRangeForFyKey(
  country: string | undefined,
  fyKey: string,
  companyDates?: CompanyFiscalYearDates | null
): { start: Date; end: Date } {
  const parts = fyKey.split("-").map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    return getFiscalRangeForCompany(country, new Date(), companyDates);
  }
  const [startY, endY] = parts;
  const normalized = (country || "").trim().toLowerCase();

  // Nepal FY keys are BS years (e.g. 2082-2083). Never feed those into `new Date(y, m, d)` —
  // that treats BS years as Gregorian and yields ~2139 AD after adToBs.
  if (normalized === "nepal") {
    let startM = 4;
    let startD = 1;
    let endM = 3;
    let endD = getBSMonthDays(endY)[2] || 32;
    if (
      companyDates?.fiscalYearStart instanceof Date &&
      !Number.isNaN(companyDates.fiscalYearStart.getTime()) &&
      companyDates?.fiscalYearEnd instanceof Date &&
      !Number.isNaN(companyDates.fiscalYearEnd.getTime())
    ) {
      const startBs = adToBs(companyDates.fiscalYearStart);
      const endBs = adToBs(companyDates.fiscalYearEnd);
      startM = startBs.m;
      startD = startBs.d;
      endM = endBs.m;
      endD = endBs.d;
    }
    return {
      start: bsToAd({ y: startY, m: startM, d: startD }),
      end: bsToAd({ y: endY, m: endM, d: endD }),
    };
  }

  const companyTemplate = fiscalTemplateFromCompanyDates(
    companyDates?.fiscalYearStart,
    companyDates?.fiscalYearEnd
  );
  if (companyTemplate) {
    const isCrossYear =
      companyTemplate.endMonth < companyTemplate.startMonth ||
      (companyTemplate.endMonth === companyTemplate.startMonth &&
        companyTemplate.endDay < companyTemplate.startDay);
    return {
      start: new Date(startY, companyTemplate.startMonth, companyTemplate.startDay),
      end: new Date(isCrossYear ? endY : startY, companyTemplate.endMonth, companyTemplate.endDay),
    };
  }
  const template = getFiscalTemplateForCountry(country);
  const isCrossYear =
    template.endMonth < template.startMonth ||
    (template.endMonth === template.startMonth && template.endDay < template.startDay);
  return {
    start: new Date(startY, template.startMonth, template.startDay),
    end: new Date(isCrossYear ? endY : startY, template.endMonth, template.endDay),
  };
}

function sortFyKeysDesc(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aStart = Number(a.split("-")[0]) || 0;
    const bStart = Number(b.split("-")[0]) || 0;
    return bStart - aStart;
  });
}

/** All FY keys in voucher dates + party confirmation records + running FY. */
export function listAvailableAnusuchi13FyKeys(
  parties: Party[],
  vouchers: any[],
  country?: string
): string[] {
  const keys = new Set<string>();
  keys.add(getAnusuchi13FyKey(country, new Date()));
  for (const v of vouchers) {
    const d = parseVoucherDate(v?.date);
    if (d) keys.add(getAnusuchi13FyKey(country, d));
  }
  for (const p of parties) {
    for (const k of Object.keys(p.anusuchi13ConfirmationByFy ?? {})) {
      if (k.trim()) keys.add(k);
    }
  }
  const withData = [...keys].filter((fyKey) => {
    const { start, end } = getFiscalRangeForFyKey(country, fyKey);
    const eligible = listAnusuchi13EligibleParties(parties, vouchers, start, end);
    if (eligible.length > 0) return true;
    return parties.some((p) => Boolean(p.anusuchi13ConfirmationByFy?.[fyKey]));
  });
  return sortFyKeysDesc(withData.length > 0 ? withData : [...keys]);
}

export function getMasterAnusuchi13Confirmation(
  entity: { anusuchi13ConfirmationByFy?: Record<string, Anusuchi13ConfirmationFyRecord> },
  fyKey: string
): Anusuchi13ConfirmationFyRecord {
  const map = entity.anusuchi13ConfirmationByFy ?? {};
  return map[fyKey] ?? {};
}

/** @deprecated use getMasterAnusuchi13Confirmation */
export function getPartyAnusuchi13Confirmation(
  party: Party,
  fyKey: string
): Anusuchi13ConfirmationFyRecord {
  return getMasterAnusuchi13Confirmation(party, fyKey);
}

export function isAnusuchi13ConfirmationSent(
  entity: { anusuchi13ConfirmationByFy?: Record<string, Anusuchi13ConfirmationFyRecord> },
  fyKey: string
): boolean {
  return Boolean(getMasterAnusuchi13Confirmation(entity, fyKey).sent);
}

export function isAnusuchi13StatementSent(
  entity: { anusuchi13ConfirmationByFy?: Record<string, Anusuchi13ConfirmationFyRecord> },
  fyKey: string
): boolean {
  return Boolean(getMasterAnusuchi13Confirmation(entity, fyKey).statementSent);
}

export function isAnusuchi13ConfirmationCompleted(
  entity: { anusuchi13ConfirmationByFy?: Record<string, Anusuchi13ConfirmationFyRecord> },
  fyKey: string
): boolean {
  return Boolean(getMasterAnusuchi13Confirmation(entity, fyKey).completed);
}

export function matchesAnusuchi13ConfirmationFilter(
  party: Party,
  fyKey: string,
  filter: Anusuchi13ConfirmationFilter
): boolean {
  if (filter === "all") return true;
  const sent = isAnusuchi13ConfirmationSent(party, fyKey);
  const completed = isAnusuchi13ConfirmationCompleted(party, fyKey);
  if (filter === "sent") return sent;
  if (filter === "unsent") return !sent;
  if (filter === "completed") return completed;
  return sent && !completed;
}

export function countAnusuchi13ConfirmationFilter(
  parties: Party[],
  fyKey: string,
  filter: Anusuchi13ConfirmationFilter
): number {
  return parties.filter((p) => matchesAnusuchi13ConfirmationFilter(p, fyKey, filter)).length;
}

export function filterVouchersInFy(vouchers: any[], fyStart: Date, fyEnd: Date): any[] {
  const start = new Date(fyStart);
  const end = new Date(fyEnd);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return vouchers.filter((v) => {
    const d = parseVoucherDate(v?.date);
    if (!d) return false;
    const ms = d.getTime();
    return ms >= startMs && ms <= endMs;
  });
}

export function computePartyFyTransactionTotal(
  party: Party,
  vouchers: any[]
): number {
  let total = 0;
  for (const t of vouchers) {
    const { debit, credit } = getTransactionAmounts(t, "party", party);
    total += (debit || 0) + (credit || 0);
  }
  return total;
}

/** Company root key — Anusuchi 13 list default minimum FY transaction (all users of the company). */
export const ANUSUCHI13_DEFAULT_THRESHOLD_KEY = "anusuchi13DefaultThreshold" as const;

/** Company-wide default threshold; missing / invalid → 1 Lac (100000). */
export function readAnusuchi13DefaultThreshold(company: unknown): number {
  const raw = (company as Record<string, unknown> | null | undefined)?.[ANUSUCHI13_DEFAULT_THRESHOLD_KEY];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : ANUSUCHI13_ONE_LAC;
}

/** Typed amount (commas allowed) → positive number, else null. */
export function parseAnusuchi13ThresholdInput(input: string): number | null {
  const cleaned = String(input ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 100000 → "1 Lac", 250000 → "2.5 Lac", 50000 → "50,000". */
export function formatAnusuchi13ThresholdLabel(amount: number): string {
  if (amount >= ANUSUCHI13_ONE_LAC) {
    const lac = amount / ANUSUCHI13_ONE_LAC;
    if (Math.round(lac * 100) === lac * 100) {
      return `${lac.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Lac`;
    }
  }
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function listAnusuchi13EligibleParties(
  parties: Party[],
  vouchers: any[],
  fyStart: Date,
  fyEnd: Date,
  minAmount: number = ANUSUCHI13_ONE_LAC
): Party[] {
  const fyVouchers = filterVouchersInFy(vouchers, fyStart, fyEnd);
  return parties
    .filter((p) => !(p as Party & { isSystemAccount?: boolean }).isSystemAccount)
    .map((party) => ({
      party,
      total: computePartyFyTransactionTotal(party, fyVouchers),
    }))
    .filter(({ total }) => total >= minAmount)
    .sort((a, b) => b.total - a.total)
    .map(({ party }) => party);
}

export function patchMasterAnusuchi13ConfirmationFields(
  existing: { anusuchi13ConfirmationByFy?: Record<string, Anusuchi13ConfirmationFyRecord> },
  fyKey: string,
  patch: Partial<Anusuchi13ConfirmationFyRecord>
): { anusuchi13ConfirmationByFy: Record<string, Anusuchi13ConfirmationFyRecord> } {
  const prev = { ...(existing.anusuchi13ConfirmationByFy ?? {}) };
  const row = { ...(prev[fyKey] ?? {}), ...patch };
  return {
    anusuchi13ConfirmationByFy: {
      ...prev,
      [fyKey]: row,
    },
  };
}

/** @deprecated use patchMasterAnusuchi13ConfirmationFields */
export function patchPartyAnusuchi13ConfirmationFields(
  existing: Party,
  fyKey: string,
  patch: Partial<Anusuchi13ConfirmationFyRecord>
): Pick<Party, "anusuchi13ConfirmationByFy"> {
  return patchMasterAnusuchi13ConfirmationFields(existing, fyKey, patch);
}

type Anusuchi13FyDateFormatter = (date: Date) => string;

/** FY dropdown — sirf `start → end` (company calendar AD / BS / Both via `formatBySystem`). */
export function formatAnusuchi13FyRangeLabel(
  country: string | undefined,
  fyKey: string,
  formatBySystem: Anusuchi13FyDateFormatter
): string {
  const { start, end } = getFiscalRangeForFyKey(country, fyKey);
  return `${formatBySystem(start)} → ${formatBySystem(end)}`;
}

/** @deprecated use formatAnusuchi13FyRangeLabel */
export function formatAnusuchi13FyDropdownLabel(
  country: string | undefined,
  fyKey: string,
  formatAd: Anusuchi13FyDateFormatter,
  formatBs: Anusuchi13FyDateFormatter,
  dateSystem: "AD" | "BS" | "Both" = "BS"
): string {
  const fmt = (d: Date) => {
    if (dateSystem === "BS") return formatBs(d);
    if (dateSystem === "Both") return `${formatBs(d)} (${formatAd(d)})`;
    return formatAd(d);
  };
  return formatAnusuchi13FyRangeLabel(country, fyKey, fmt);
}
