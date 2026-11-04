import type { LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";
import type { BalanceSheetRow } from "@/lib/reports/balanceSheetAccounting";
import type {
  ReceivablesPayablesFinancialSummary,
  RpEntityRow,
} from "@/lib/receivablesPayablesFinancialSummary";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import {
  isInterCompanyAccountClearingPartyName,
  readInterCompanyClearingMode,
} from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import {
  icPeerCompanyGroupId,
  icPeerCompanyGroupSecondaryLabel,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";

export type RpCategoryFilter =
  | "all"
  | "party"
  | "bank"
  | "staff"
  | "tax";

export type RpEntityKind = "party" | "bank" | "staff" | "tax" | "income" | "expense";

export type RpDialogRow = {
  party: string;
  balance: number;
  fileUrl?: string;
  kind: RpEntityKind;
  entityId: string;
  /** IC peer company group — nested IC Account rows (party list jaisa). */
  isIcPeerCompanyGroup?: boolean;
  secondaryLabel?: string;
  icChildren?: RpDialogRow[];
  interCompanyPeerCompanyId?: string;
  interCompanyPeerCompanyName?: string;
  interCompanyPeerEntityLabel?: string;
};

export type RpDialogSection = {
  kind: RpEntityKind;
  label: string;
  rows: RpDialogRow[];
  /** Leaf account count — IC tree me company group ke andar ke accounts bhi ginne hain. */
  rowCount: number;
};

export const RP_DIALOG_FILTER_OPTIONS: { id: RpCategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "party", label: "Party" },
  { id: "bank", label: "Bank/Cash" },
  { id: "staff", label: STAFF_ENTITY_LABEL },
  { id: "tax", label: "Tax" },
];

/** Outstanding dialog — Party / Bank / Staff / Tax only (Income/Expense P&L heads, len-den nahi). */
const CATEGORY_META: { kind: RpEntityKind; label: string; filter: RpCategoryFilter }[] = [
  { kind: "party", label: "Party", filter: "party" },
  { kind: "bank", label: "Bank / Cash", filter: "bank" },
  { kind: "staff", label: STAFF_ENTITY_LABEL, filter: "staff" },
  { kind: "tax", label: "Tax", filter: "tax" },
];

const notOB = (p: { party: string }) => p.party !== "Opening Balance";

function isIcAccountClearingPartyRow(row: {
  party: string;
  entityId?: string;
  interCompanyClearingMode?: string;
}): boolean {
  if (
    readInterCompanyClearingMode({
      id: row.entityId,
      name: row.party,
      interCompanyClearingMode: row.interCompanyClearingMode,
    }) === "account"
  ) {
    return true;
  }
  return isInterCompanyAccountClearingPartyName(row.party);
}

function toRpDialogRow(row: RpEntityRow, kind: RpEntityKind): RpDialogRow {
  return {
    party: row.party,
    balance: row.balance,
    fileUrl: row.fileUrl,
    kind,
    entityId: row.entityId,
    interCompanyPeerCompanyId: row.interCompanyPeerCompanyId,
    interCompanyPeerCompanyName: row.interCompanyPeerCompanyName,
    interCompanyPeerEntityLabel: row.interCompanyPeerEntityLabel,
  };
}

/** IC Account clearing parties → peer company tree (company name → account names). */
function groupIcAccountPartyRowsForRpDialog(rows: RpDialogRow[]): RpDialogRow[] {
  const regular: RpDialogRow[] = [];
  const icAccounts: RpDialogRow[] = [];
  for (const row of rows) {
    if (isIcAccountClearingPartyRow(row)) icAccounts.push(row);
    else regular.push(row);
  }
  if (icAccounts.length === 0) return rows;

  const buckets = new Map<
    string,
    { peerCompanyId: string; peerCompanyName: string; members: RpDialogRow[] }
  >();
  for (const row of icAccounts) {
    const peerCompanyId = String(row.interCompanyPeerCompanyId || "").trim();
    const peerCompanyName = String(row.interCompanyPeerCompanyName || "").trim() || "Company";
    const bucketKey = peerCompanyId || peerCompanyName.toLowerCase();
    const prev = buckets.get(bucketKey);
    if (prev) prev.members.push(row);
    else buckets.set(bucketKey, { peerCompanyId, peerCompanyName, members: [row] });
  }

  const icGroups: RpDialogRow[] = [];
  for (const bucket of buckets.values()) {
    const children = bucket.members
      .map((member) => ({
        ...member,
        party: interCompanyClearingAccountDisplayName({
          name: member.party,
          interCompanyPeerEntityLabel: member.interCompanyPeerEntityLabel,
        } as Parameters<typeof interCompanyClearingAccountDisplayName>[0]),
      }))
      .sort((a, b) => Math.abs(Number(b.balance) || 0) - Math.abs(Number(a.balance) || 0));
    const balance = children.reduce((sum, child) => sum + (Number(child.balance) || 0), 0);
    icGroups.push({
      party: bucket.peerCompanyName,
      balance,
      kind: "party",
      entityId: icPeerCompanyGroupId(bucket.peerCompanyId, bucket.peerCompanyName),
      isIcPeerCompanyGroup: true,
      secondaryLabel: icPeerCompanyGroupSecondaryLabel(children.length),
      interCompanyPeerCompanyId: bucket.peerCompanyId,
      interCompanyPeerCompanyName: bucket.peerCompanyName,
      icChildren: children,
    });
  }

  return [...regular, ...icGroups].sort(
    (a, b) => Math.abs(Number(b.balance) || 0) - Math.abs(Number(a.balance) || 0)
  );
}

function flattenRpDialogRows(rows: RpDialogRow[]): RpDialogRow[] {
  const out: RpDialogRow[] = [];
  for (const row of rows) {
    if (row.isIcPeerCompanyGroup && row.icChildren?.length) out.push(...row.icChildren);
    else out.push(row);
  }
  return out;
}

function rpDialogLeafCount(rows: RpDialogRow[]): number {
  return flattenRpDialogRows(rows).length;
}

function includeCategory(filter: RpCategoryFilter, kind: RpEntityKind): boolean {
  if (filter === "all") return true;
  return filter === kind;
}

function rowsForKind(
  side: "receivables" | "payables",
  summary: ReceivablesPayablesFinancialSummary,
  kind: RpEntityKind
): RpDialogRow[] {
  const bucket = summary[side];
  const raw =
    kind === "party"
      ? bucket.parties
      : kind === "bank"
        ? bucket.accounts
        : kind === "staff"
          ? bucket.staff
          : kind === "tax"
            ? bucket.taxes
            : kind === "income"
              ? bucket.income
              : bucket.expenses;
  const mapped = raw.filter(notOB).map((p) => toRpDialogRow(p, kind));
  const sorted = mapped.sort(
    (a, b) => Math.abs(Number(b.balance) || 0) - Math.abs(Number(a.balance) || 0)
  );
  if (kind === "party") return groupIcAccountPartyRowsForRpDialog(sorted);
  return sorted;
}

/** Receivables / Payables dialog: category headers + sorted rows. */
export function buildRpDialogSections(
  side: "receivables" | "payables",
  summary: ReceivablesPayablesFinancialSummary,
  filter: RpCategoryFilter
): RpDialogSection[] {
  return CATEGORY_META.filter((c) => includeCategory(filter, c.kind)).map(({ kind, label }) => {
    const rows = rowsForKind(side, summary, kind);
    return {
      kind,
      label,
      rows,
      rowCount: rpDialogLeafCount(rows),
    };
  });
}

/** Flat rows (print / legacy) — category order preserved, amount desc within each group. */
export function buildRpDialogRowsFlat(
  side: "receivables" | "payables",
  summary: ReceivablesPayablesFinancialSummary,
  filter: RpCategoryFilter
): RpDialogRow[] {
  return flattenRpDialogRows(buildRpDialogSections(side, summary, filter).flatMap((s) => s.rows));
}

export function sumRpDialogSide(
  side: "receivables" | "payables",
  summary: ReceivablesPayablesFinancialSummary,
  filter: RpCategoryFilter
): number {
  const rows = buildRpDialogRowsFlat(side, summary, filter);
  if (side === "receivables") {
    return rows.reduce((s, p) => s + (Number(p.balance) || 0), 0);
  }
  return rows.reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0);
}

export function countRpDialogSide(
  side: "receivables" | "payables",
  summary: ReceivablesPayablesFinancialSummary,
  filter: RpCategoryFilter
): number {
  return buildRpDialogRowsFlat(side, summary, filter).length;
}

function migrateLegacySideBuckets(raw: Record<string, unknown>) {
  const legacyTaxIncome = Array.isArray(raw.taxIncomeExpense)
    ? raw.taxIncomeExpense
    : Array.isArray(raw.taxes)
      ? raw.taxes
      : [];
  return {
    parties: Array.isArray(raw.parties) ? raw.parties : [],
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    staff: Array.isArray(raw.staff) ? raw.staff : [],
    taxes: Array.isArray(raw.taxes) ? raw.taxes : [],
    income: Array.isArray(raw.income) ? raw.income : [],
    expenses: Array.isArray(raw.expenses)
      ? raw.expenses
      : legacyTaxIncome.length > 0
        ? legacyTaxIncome
        : [],
  };
}

/** Server / purana payload migrate — `taxIncomeExpense` → `expenses` fallback. */
export function normalizeReceivablesPayablesSummary(
  raw: ReceivablesPayablesFinancialSummary | null | undefined
): ReceivablesPayablesFinancialSummary {
  if (!raw) {
    return {
      totalReceivable: 0,
      totalPayable: 0,
      receivables: { parties: [], accounts: [], staff: [], taxes: [], income: [], expenses: [] },
      payables: { parties: [], accounts: [], staff: [], taxes: [], income: [], expenses: [] },
      recCount: 0,
      payCount: 0,
    };
  }
  const receivables = migrateLegacySideBuckets(raw.receivables as Record<string, unknown>);
  const payables = migrateLegacySideBuckets(raw.payables as Record<string, unknown>);
  const recCount =
    receivables.parties.length +
    receivables.accounts.length +
    receivables.staff.length +
    receivables.taxes.length +
    receivables.income.length +
    receivables.expenses.length;
  const payCount =
    payables.parties.length +
    payables.accounts.length +
    payables.staff.length +
    payables.taxes.length +
    payables.income.length +
    payables.expenses.length;
  return {
    ...raw,
    receivables,
    payables,
    recCount,
    payCount,
  };
}

export function rpDialogRowSelectionKey(side: "receivables" | "payables", row: RpDialogRow): string {
  return `${side}:${row.kind}:${row.entityId}`;
}

/** Per-company outstanding collection deadlines — localStorage `YYYY-MM-DD` (local calendar) keyed by `rpDialogRowSelectionKey`. */
export type RpDeadlinesMap = Record<string, string>;
export type RpDeadlineNarrationsMap = Record<string, string>;

const RP_DEADLINES_STORAGE_PREFIX = "pl_rp_collection_deadlines_v1_";
const RP_DEADLINE_NARRATIONS_STORAGE_PREFIX = "pl_rp_collection_deadline_narrations_v1_";

export function rpDeadlinesStorageKey(companyId: string): string {
  return `${RP_DEADLINES_STORAGE_PREFIX}${companyId}`;
}

export function formatRpDeadlineYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseRpDeadlineYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  return new Date(y, mo - 1, day, 12, 0, 0, 0);
}

export function readRpDeadlinesFromStorage(companyId: string): RpDeadlinesMap {
  if (!companyId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(rpDeadlinesStorageKey(companyId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: RpDeadlinesMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && parseRpDeadlineYmd(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRpDeadlinesToStorage(companyId: string, map: RpDeadlinesMap): void {
  if (!companyId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(rpDeadlinesStorageKey(companyId), JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

export function readRpDeadlineNarrationsFromStorage(companyId: string): RpDeadlineNarrationsMap {
  if (!companyId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${RP_DEADLINE_NARRATIONS_STORAGE_PREFIX}${companyId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: RpDeadlineNarrationsMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key && typeof value === "string" && value.trim()) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRpDeadlineNarrationsToStorage(
  companyId: string,
  map: RpDeadlineNarrationsMap
): void {
  if (!companyId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${RP_DEADLINE_NARRATIONS_STORAGE_PREFIX}${companyId}`,
      JSON.stringify(map)
    );
  } catch {
    /* quota / private mode */
  }
}

const RP_DEADLINE_AUTOSHOW_PREFIX = "pl_rp_deadline_autoshown_v1_";

export function wasRpDeadlineDialogAutoShownToday(companyId: string, today = new Date()): boolean {
  if (!companyId || typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(`${RP_DEADLINE_AUTOSHOW_PREFIX}${companyId}`) ===
      formatRpDeadlineYmd(today)
    );
  } catch {
    return false;
  }
}

export function markRpDeadlineDialogAutoShownToday(companyId: string, today = new Date()): void {
  if (!companyId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${RP_DEADLINE_AUTOSHOW_PREFIX}${companyId}`, formatRpDeadlineYmd(today));
  } catch {
    /* quota / private mode */
  }
}

export function rpDialogRowHasOutstandingBalance(row: RpDialogRow): boolean {
  return Math.abs(Number(row.balance) || 0) > 1e-6;
}

export function isRpDeadlineDueOnOrBefore(deadlineYmd: string, today: Date): boolean {
  return deadlineYmd <= formatRpDeadlineYmd(today);
}

function rpDialogRowMatchesDeadlineDue(
  side: "receivables" | "payables",
  row: RpDialogRow,
  deadlines: RpDeadlinesMap,
  today: Date
): boolean {
  const ymd = deadlines[rpDialogRowSelectionKey(side, row)];
  if (!ymd) return false;
  if (!rpDialogRowHasOutstandingBalance(row)) return false;
  return isRpDeadlineDueOnOrBefore(ymd, today);
}

export function filterRpDialogRowsForDeadlineDue(
  rows: RpDialogRow[],
  side: "receivables" | "payables",
  deadlines: RpDeadlinesMap,
  today: Date
): RpDialogRow[] {
  const out: RpDialogRow[] = [];
  for (const row of rows) {
    if (row.isIcPeerCompanyGroup && row.icChildren?.length) {
      const filteredChildren = row.icChildren.filter((child) =>
        rpDialogRowMatchesDeadlineDue(side, child, deadlines, today)
      );
      if (filteredChildren.length === 0) continue;
      const balance = filteredChildren.reduce((sum, child) => sum + (Number(child.balance) || 0), 0);
      out.push({
        ...row,
        icChildren: filteredChildren,
        balance,
        secondaryLabel: icPeerCompanyGroupSecondaryLabel(filteredChildren.length),
      });
    } else if (rpDialogRowMatchesDeadlineDue(side, row, deadlines, today)) {
      out.push(row);
    }
  }
  return out;
}

export function filterRpDialogSectionsForDeadlineDue(
  sections: RpDialogSection[],
  side: "receivables" | "payables",
  deadlines: RpDeadlinesMap,
  today: Date
): RpDialogSection[] {
  return sections
    .map((section) => {
      const rows = filterRpDialogRowsForDeadlineDue(section.rows, side, deadlines, today);
      return {
        ...section,
        rows,
        rowCount: rpDialogLeafCount(rows),
      };
    })
    .filter((section) => section.rows.length > 0);
}

function rpDialogRowMatchesDeadlineDate(
  side: "receivables" | "payables",
  row: RpDialogRow,
  deadlines: RpDeadlinesMap,
  dateYmd: string | null
): boolean {
  const ymd = deadlines[rpDialogRowSelectionKey(side, row)];
  if (!ymd || !rpDialogRowHasOutstandingBalance(row)) return false;
  return dateYmd === null || ymd === dateYmd;
}

export function filterRpDialogSectionsForDeadlineDate(
  sections: RpDialogSection[],
  side: "receivables" | "payables",
  deadlines: RpDeadlinesMap,
  dateYmd: string | null
): RpDialogSection[] {
  return sections
    .map((section) => {
      const rows = section.rows.flatMap((row) => {
        if (row.isIcPeerCompanyGroup && row.icChildren?.length) {
          const icChildren = row.icChildren.filter((child) =>
            rpDialogRowMatchesDeadlineDate(side, child, deadlines, dateYmd)
          );
          if (icChildren.length === 0) return [];
          return [{
            ...row,
            icChildren,
            balance: icChildren.reduce((sum, child) => sum + (Number(child.balance) || 0), 0),
            secondaryLabel: icPeerCompanyGroupSecondaryLabel(icChildren.length),
          }];
        }
        return rpDialogRowMatchesDeadlineDate(side, row, deadlines, dateYmd) ? [row] : [];
      });
      return { ...section, rows, rowCount: rpDialogLeafCount(rows) };
    })
    .filter((section) => section.rows.length > 0);
}

export function countRpDeadlineDueAccounts(
  summary: ReceivablesPayablesFinancialSummary,
  categoryFilter: RpCategoryFilter,
  deadlines: RpDeadlinesMap,
  today: Date
): number {
  let n = 0;
  for (const side of ["receivables", "payables"] as const) {
    const sections = buildRpDialogSections(side, summary, categoryFilter);
    for (const section of sections) {
      n += filterRpDialogRowsForDeadlineDue(section.rows, side, deadlines, today).reduce(
        (sum, row) => sum + rpDialogLeafCount([row]),
        0
      );
    }
  }
  return n;
}

export function countRpDeadlineAccountsForDate(
  summary: ReceivablesPayablesFinancialSummary,
  categoryFilter: RpCategoryFilter,
  deadlines: RpDeadlinesMap,
  dateYmd: string | null
): number {
  let n = 0;
  for (const side of ["receivables", "payables"] as const) {
    const sections = buildRpDialogSections(side, summary, categoryFilter);
    const filtered = filterRpDialogSectionsForDeadlineDate(sections, side, deadlines, dateYmd);
    n += filtered.reduce((sum, section) => sum + section.rowCount, 0);
  }
  return n;
}

/** Party / Bank / Staff / Tax — Balance Sheet ledger popup. IC company group is not a ledger. */
export function rpDialogRowCanOpenLedger(row: RpDialogRow): boolean {
  if (row.isIcPeerCompanyGroup) return false;
  return row.kind === "party" || row.kind === "bank" || row.kind === "staff" || row.kind === "tax";
}

export function rpDialogRowToBalanceSheetLedgerRow(row: RpDialogRow): BalanceSheetRow | null {
  if (!rpDialogRowCanOpenLedger(row)) return null;
  const entityType =
    row.kind === "bank"
      ? "account"
      : row.kind === "party"
        ? "party"
        : row.kind === "staff"
          ? "staff"
          : row.kind === "tax"
            ? "tax"
            : null;
  if (!entityType) return null;
  return {
    accountId: row.entityId,
    accountName: row.party,
    group: "",
    category: "Assets",
    ledgerClass: "Asset",
    amount: Math.abs(row.balance),
    signedBalance: row.balance,
    entityType,
  };
}

/** Default narration when a collection deadline has no custom message. */
export const RP_DEADLINE_DEFAULT_NARRATION = "Need to call the party to ask payment";

/** R/P row -> Reminder popup "Link to" context (same values as Account Details pages). */
export function rpDialogKindToReminderContext(kind: RpEntityKind): LedgerReminderContext {
  switch (kind) {
    case "party":
      return "Party";
    case "bank":
      return "Bank/Cash";
    case "staff":
      return "Staff";
    case "tax":
      return "Tax";
    default:
      return "Income/Expense";
  }
}

/** Default reminder title for an R/P row ("Collect payment - <name>"). */
export function rpDeadlineReminderTitle(name: string): string {
  return `Collect payment - ${name}`;
}
