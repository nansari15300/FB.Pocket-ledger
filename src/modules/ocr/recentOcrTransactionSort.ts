/**
 * Recent OCR Trxn table sort. "By Date" means posted date+time (createdAt),
 * never the voucher's bill date. Default is newest posted first.
 */
import type { TransactionSortBy, TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { getRecentOcrPostedDate } from "@/modules/ocr/recentOcrPostedDate";

export const DEFAULT_RECENT_OCR_SORT_BY: TransactionSortBy = "date";
export const DEFAULT_RECENT_OCR_SORT_ORDER: TransactionSortOrder = "desc";

export type RecentOcrSortRow = {
  id?: unknown;
  createdAt?: unknown;
  date?: unknown;
  debit?: unknown;
  credit?: unknown;
  amount?: unknown;
  total?: unknown;
  voucherNumber?: unknown;
  voucherNo?: unknown;
};

function postedMs(
  row: RecentOcrSortRow | null | undefined,
  voucherById?: Map<string, { createdAt?: unknown }>,
): number {
  const voucher = voucherById?.get(String(row?.id || ""));
  return getRecentOcrPostedDate(row, voucher)?.getTime() ?? 0;
}

/** Same amount rule as `sortTransactions` in transactionSort.ts. */
function getAmount(row: RecentOcrSortRow | null | undefined): number {
  const debit = Number(row?.debit) || 0;
  const credit = Number(row?.credit) || 0;
  const amt = Number(row?.amount ?? row?.total) || 0;
  if (debit > 0 || credit > 0) return Math.max(debit, credit);
  return amt;
}

function getVoucherNo(row: RecentOcrSortRow | null | undefined): string {
  return String(row?.voucherNumber ?? row?.voucherNo ?? "");
}

/**
 * Returns a new array. Sorts the full list (call before pagination).
 * Amount / voucher-no ties break by posted date, newest first, then id.
 */
export function sortRecentOcrTransactions<T extends RecentOcrSortRow>(
  list: T[],
  sortBy: TransactionSortBy = DEFAULT_RECENT_OCR_SORT_BY,
  sortOrder: TransactionSortOrder = DEFAULT_RECENT_OCR_SORT_ORDER,
  voucherById?: Map<string, { createdAt?: unknown }>,
): T[] {
  if (!list.length) return list;
  const mult = sortOrder === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let primary = 0;
    switch (sortBy) {
      case "date":
        primary = mult * (postedMs(a, voucherById) - postedMs(b, voucherById));
        break;
      case "amount":
        primary = mult * (getAmount(a) - getAmount(b));
        break;
      case "voucherNo":
        primary = mult * getVoucherNo(a).localeCompare(getVoucherNo(b));
        break;
      default:
        primary = 0;
    }
    if (primary !== 0) return primary;
    const postedTie = postedMs(b, voucherById) - postedMs(a, voucherById);
    if (postedTie !== 0) return postedTie;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}
