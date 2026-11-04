import { FISCAL_YEAR_PARTITION_ROW_TYPE } from "@/lib/fiscalPartitionRows";
import { FY_OPENING_ROW_TYPE } from "@/lib/fyPagination/fyOpeningRows";

export type FiscalPartitionClosingSummary = {
  totalDr: number;
  totalCr: number;
  /** Signed ledger balance (Dr positive). */
  closingBalance: number;
};

function ledgerAmount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isClosingSummaryRow(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const row = t as { type?: string; _spendWiseSpacer?: boolean };
  if (row._spendWiseSpacer) return false;
  if (row.type === FISCAL_YEAR_PARTITION_ROW_TYPE) return false;
  if (row.type === FY_OPENING_ROW_TYPE) return false;
  return true;
}

function rowClosingBalance(t: Record<string, unknown>): number | null {
  if (typeof t._spendWiseLedgerRunningBalance === "number") return ledgerAmount(t._spendWiseLedgerRunningBalance);
  if (typeof t._spendWiseRunningBalance === "number") return ledgerAmount(t._spendWiseRunningBalance);
  if (typeof t.balance === "number") return ledgerAmount(t.balance);
  if (typeof t.runningBalance === "number") return ledgerAmount(t.runningBalance);
  return null;
}

export type FiscalPartitionBooksDrCr = (tx: unknown) => { debit: number; credit: number };

/** Signed opening (Dr positive) -> Dr/Cr side. Ledger FY Total row me opening carry jodne ke liye. */
export function signedOpeningToDrCr(signed: number): { dr: number; cr: number } {
  const v = Math.round((Number(signed) || 0) * 100) / 100;
  return { dr: v > 0.005 ? v : 0, cr: v < -0.005 ? -v : 0 };
}

/** FY merge divider se pehle wale segment ka Total Dr/Cr + closing balance. */
export function computeClosingSummaryBeforePartition(
  rowsInDisplayOrder: unknown[],
  partitionIndex: number,
  booksDrCrForRow?: FiscalPartitionBooksDrCr
): FiscalPartitionClosingSummary | null {
  if (!Array.isArray(rowsInDisplayOrder) || partitionIndex < 0 || partitionIndex >= rowsInDisplayOrder.length) {
    return null;
  }
  const partition = rowsInDisplayOrder[partitionIndex] as { type?: string };
  if (partition?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE) return null;

  let start = 0;
  for (let i = partitionIndex - 1; i >= 0; i--) {
    const prev = rowsInDisplayOrder[i] as { type?: string };
    if (prev?.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
      start = i + 1;
      break;
    }
  }

  let totalDr = 0;
  let totalCr = 0;
  let closingBalance = 0;
  let sawBalance = false;
  let sawSpendWiseBalance = false;

  for (let i = start; i < partitionIndex; i++) {
    const t = rowsInDisplayOrder[i] as Record<string, unknown>;
    if (!isClosingSummaryRow(t)) continue;
    if (typeof t._spendWiseLedgerRunningBalance === "number" || typeof t._spendWiseRunningBalance === "number") {
      sawSpendWiseBalance = true;
    }
    if (booksDrCrForRow) {
      const books = booksDrCrForRow(t);
      totalDr += ledgerAmount(books.debit);
      totalCr += ledgerAmount(books.credit);
    } else {
      totalDr += ledgerAmount(t.debit);
      totalCr += ledgerAmount(t.credit);
    }
    const bal = rowClosingBalance(t);
    if (bal != null) {
      closingBalance = bal;
      sawBalance = true;
    }
  }

  if (!sawBalance && totalDr === 0 && totalCr === 0) return null;

  // Opening carry (Dated Opening / FY Opening) list me row nahi hoti: opening = closing - (Dr - Cr).
  // Spend-wise me group-wise balance restart hota hai, isliye wahan purana behaviour.
  if (sawBalance && !sawSpendWiseBalance) {
    const opening = signedOpeningToDrCr(closingBalance - (totalDr - totalCr));
    totalDr += opening.dr;
    totalCr += opening.cr;
  }

  return { totalDr, totalCr, closingBalance };
}

export function buildPartitionClosingSummaryMap(
  rowsInDisplayOrder: unknown[],
  booksDrCrForRow?: FiscalPartitionBooksDrCr
): Map<string, FiscalPartitionClosingSummary> {
  const map = new Map<string, FiscalPartitionClosingSummary>();
  if (!Array.isArray(rowsInDisplayOrder)) return map;
  for (let i = 0; i < rowsInDisplayOrder.length; i++) {
    const row = rowsInDisplayOrder[i] as { type?: string; id?: string };
    if (row?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE) continue;
    const summary = computeClosingSummaryBeforePartition(rowsInDisplayOrder, i, booksDrCrForRow);
    if (!summary) continue;
    const key = String(row.id || `__fiscal_partition_idx_${i}`);
    map.set(key, summary);
  }
  return map;
}
