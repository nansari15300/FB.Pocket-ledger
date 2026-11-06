/**
 * Sort transaction list by common fields (Statement / Bill wise / Spend wise).
 * Used by table footer sort dropdown across party, staff, account, etc.
 */

import { startOfDay } from "date-fns";
import type { TransactionSortBy, TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import {
  getFiscalMergePartitionsFromCompany,
  FISCAL_YEAR_PARTITION_ROW_TYPE,
} from "@/lib/fiscalPartitionRows";
import { getVoucherEntryTimeSourceDate, parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";

/** Party/Bank/Staff/… statement footer: default `sortBy === "date"` ke saath ascending = purani date upar, nayi neeche. */
export const DEFAULT_TRANSACTION_SORT_ORDER: TransactionSortOrder = "asc";

function getDate(t: any): number {
  const d = parseFirestoreDateFieldToJsDate(t?.date);
  if (!d) return 0;
  // Calendar day only - time of day is compared via getEntryTimeMs (same clock the row shows).
  return startOfDay(d).getTime();
}

function getAmount(t: any): number {
  const debit = Number(t?.debit) || 0;
  const credit = Number(t?.credit) || 0;
  const amt = Number(t?.amount ?? t?.total) ?? 0;
  if (debit > 0 || credit > 0) return Math.max(debit, credit);
  return amt;
}

/** Outstanding for bill-wise (0 = settled). Lower first = settled first when asc. */
function getOutstanding(t: any): number {
  const out = Number(t?.outstanding) ?? NaN;
  if (!Number.isNaN(out)) return out;
  return Number(t?.balance ?? t?.runningBalance) ?? 0;
}

function getOverdueDays(t: any): number {
  return Number(t?.overdueDays) ?? 0;
}

/** 1 = partial, 0 = paid/settled, -1 = unpaid (for ordering). */
function getStatusOrder(t: any): number {
  const out = getOutstanding(t);
  const amt = getAmount(t);
  if (Math.abs(out) < 1e-6) return 0; // settled
  if (amt > 0 && out < amt) return 1; // partial
  return -1; // unpaid
}

function getCreatedAtTime(t: any): number {
  return parseFirestoreDateFieldToJsDate(t?.createdAt)?.getTime() ?? 0;
}

/** Same clock the Details row shows (`formatVoucherEntryTimeLocal`) - same-date secondary sort. */
function getEntryTimeMs(t: any): number {
  return getVoucherEntryTimeSourceDate(t as Record<string, unknown>)?.getTime() ?? 0;
}

/** Optional: Recent / daybook jahan same date par naya voucher upar chahiye. */
export type SortTransactionsOptions = {
  tieBreakCreatedAtDesc?: boolean;
};

export function sortTransactions<T = any>(
  list: T[],
  sortBy: TransactionSortBy,
  sortOrder: TransactionSortOrder,
  options?: SortTransactionsOptions
): T[] {
  if (!list.length) return list;
  const mult = sortOrder === "asc" ? 1 : -1;

  const compare = (a: T, b: T): number => {
    const ta = a as any;
    const tb = b as any;
    let primary = 0;
    switch (sortBy) {
      case "date": {
        const da = getDate(ta);
        const db = getDate(tb);
        primary = mult * (da - db);
        // Same calendar day: order by the same entry clock the row displays (asc = earlier first).
        if (primary === 0) {
          const ea = getEntryTimeMs(ta);
          const eb = getEntryTimeMs(tb);
          primary = mult * (ea - eb);
        }
        break;
      }
      case "amount": {
        const aa = getAmount(ta);
        const ab = getAmount(tb);
        primary = mult * (aa - ab);
        break;
      }
      case "voucherNo": {
        const va = (ta?.voucherNumber ?? "").toString();
        const vb = (tb?.voucherNumber ?? "").toString();
        primary = mult * va.localeCompare(vb);
        break;
      }
      case "settled": {
        const oa = getOutstanding(ta);
        const ob = getOutstanding(tb);
        primary = mult * (oa - ob);
        break;
      }
      case "overdue": {
        const oa = getOverdueDays(ta);
        const ob = getOverdueDays(tb);
        primary = mult * (ob - oa); // overdue first when desc
        break;
      }
      case "partial": {
        const sa = getStatusOrder(ta);
        const sb = getStatusOrder(tb);
        primary = mult * (sa - sb);
        break;
      }
      default:
        primary = 0;
    }
    if (primary !== 0) return primary;
    if (options?.tieBreakCreatedAtDesc) return getCreatedAtTime(tb) - getCreatedAtTime(ta);
    return 0;
  };

  return [...list].sort(compare);
}

export type RecomputeRunningBalanceOptions = {
  /** When set, use these Dr/Cr for the running chain (e.g. tax Unverified TDS → 0). */
  booksDrCrForRow?: (tx: any) => { debit: number; credit: number };
};

/**
 * Sirf current page ki rows par sort — poori list ka paging window same rahe (tail page 46–55 wahi rahe).
 * Running balance page opening se dubara compute hota hai display order me.
 */
export function sortAndRebalancePageTransactions<T = any>(
  pageRows: T[],
  openingForPage: number,
  sortBy: TransactionSortBy,
  sortOrder: TransactionSortOrder,
  fiscalPartitionAts?: Date[],
  rebalanceOptions?: RecomputeRunningBalanceOptions
): T[] {
  if (!pageRows?.length) return pageRows ?? [];
  const sorted =
    fiscalPartitionAts?.length
      ? sortTransactionsWithFiscalSegments(pageRows, sortBy, sortOrder, undefined, fiscalPartitionAts)
      : sortTransactions(pageRows, sortBy, sortOrder);
  return recomputeRunningBalanceTopToBottom(sorted, openingForPage, rebalanceOptions);
}

/** Merge divider ke liye din — fiscalPartitionRows.rowSortTime jaisa (segment split). */
function transactionDayStartMs(t: any): number | null {
  if (!t || t.type === "opening_balance") return null;
  if (t.type === FISCAL_YEAR_PARTITION_ROW_TYPE) return null;
  const raw = t?.date;
  if (!raw) return null;
  const d = parseFirestoreDateFieldToJsDate(raw);
  if (!d || isNaN(d.getTime())) return null;
  return startOfDay(d).getTime();
}

/**
 * Non-date sorts: reorder within each fiscal segment only (partition boundaries fixed).
 * Merge mode + amount/voucher/bill-wise: rows FY divider cross nahi karte.
 * `date` sort pura list par hi (timeline).
 */
export function sortTransactionsWithFiscalSegments<T = any>(
  list: T[],
  sortBy: TransactionSortBy,
  sortOrder: TransactionSortOrder,
  options: SortTransactionsOptions | undefined,
  partitionAts: Date[]
): T[] {
  if (!list.length) return list;
  if (sortBy === "date" || !partitionAts.length) {
    return sortTransactions(list, sortBy, sortOrder, options);
  }
  const boundaries = partitionAts
    .map((d) => startOfDay(d).getTime())
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (!boundaries.length) {
    return sortTransactions(list, sortBy, sortOrder, options);
  }

  const segmentCount = boundaries.length + 1;
  const segments: T[][] = Array.from({ length: segmentCount }, () => []);
  const noDay: T[] = [];

  for (const row of list) {
    const t = row as any;
    if (t?.type === FISCAL_YEAR_PARTITION_ROW_TYPE) continue;
    const day = transactionDayStartMs(t);
    if (day == null) {
      noDay.push(row);
      continue;
    }
    let seg = boundaries.length;
    for (let i = 0; i < boundaries.length; i++) {
      if (day < boundaries[i]) {
        seg = i;
        break;
      }
    }
    segments[seg].push(row);
  }

  const sortSeg = (seg: T[]) => sortTransactions(seg, sortBy, sortOrder, options);
  return [...noDay, ...segments.flatMap(sortSeg)];
}

export function sortTransactionsWithFiscalMerge<T = any>(
  list: T[],
  sortBy: TransactionSortBy,
  sortOrder: TransactionSortOrder,
  options: SortTransactionsOptions | undefined,
  partitionAt: Date | null | undefined
): T[] {
  if (!list.length) return list;
  if (!partitionAt || isNaN(partitionAt.getTime())) {
    return sortTransactions(list, sortBy, sortOrder, options);
  }
  return sortTransactionsWithFiscalSegments(list, sortBy, sortOrder, options, [partitionAt]);
}

type FiscalCompanyLike = {
  fiscalSplitMode?: string;
  fiscalMergePartitionAt?: { toDate?: () => Date } | unknown;
};

/** Company merge partition nikaal kar `sortTransactionsWithFiscalMerge` — callers ko At pass na karna pade. */
export function sortTransactionsWithFiscalMergeForCompany<T = any>(
  list: T[],
  sortBy: TransactionSortBy,
  sortOrder: TransactionSortOrder,
  options: SortTransactionsOptions | undefined,
  company: FiscalCompanyLike | null | undefined
): T[] {
  const parts = getFiscalMergePartitionsFromCompany(company);
  return sortTransactionsWithFiscalSegments(list, sortBy, sortOrder, options, parts);
}

/** Preserve books running balance when UI filters/sorts rows — match by voucher id (incl. contra `-out`/`-in` legs). */
export function stampRunningBalanceFromFullLedger<T extends { id?: string; balance?: number; runningBalance?: number }>(
  displayRows: readonly T[],
  fullLedgerRows: readonly T[]
): T[] {
  if (!displayRows.length || !fullLedgerRows.length) return [...displayRows];
  const byId = new Map<string, T>();
  for (const row of fullLedgerRows) {
    const id = String(row?.id ?? "").trim();
    if (id) byId.set(id, row);
  }
  return displayRows.map((row) => {
    const id = String(row?.id ?? "").trim();
    const source = id ? byId.get(id) : undefined;
    if (!source) return row;
    const bal =
      typeof source.balance === "number"
        ? source.balance
        : typeof source.runningBalance === "number"
          ? source.runningBalance
          : undefined;
    if (bal == null || !Number.isFinite(bal)) return row;
    return { ...row, balance: bal, runningBalance: bal };
  });
}

/** Recompute running balance in current visible order (top to bottom), used after custom sorting in statement view. */
export function recomputeRunningBalanceTopToBottom<T = any>(
  list: T[],
  openingBalance: number,
  options?: RecomputeRunningBalanceOptions
): T[] {
  let running = Number(openingBalance) || 0;
  return (list || []).map((tx: any) => {
    if (tx?.type === "opening_balance") {
      const explicit = typeof tx?.runningBalance === "number" ? Number(tx.runningBalance) : running;
      running = explicit;
      return { ...tx, runningBalance: explicit, balance: explicit } as T;
    }
    // Fiscal divider row: balance carry forward — na dr/cr change
    if (tx?.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
      return { ...tx, runningBalance: running, balance: running } as T;
    }
    const books = options?.booksDrCrForRow
      ? options.booksDrCrForRow(tx)
      : { debit: Number(tx?.debit) || 0, credit: Number(tx?.credit) || 0 };
    running += (Number(books.debit) || 0) - (Number(books.credit) || 0);
    return { ...tx, runningBalance: running, balance: running } as T;
  });
}
