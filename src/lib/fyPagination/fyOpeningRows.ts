import { startOfDay } from "date-fns";
import {
  FISCAL_YEAR_PARTITION_ROW_TYPE,
  type FiscalMergePartitionEntry,
} from "@/lib/fiscalPartitionRows";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { fyOpeningRowDateFromBoundaryMs } from "@/lib/fyPagination/ledgerOpeningMeta";
import type { FyPartitionOpeningStatus } from "@/lib/fyPagination/openingSnapshotStatus";
import { buildFyPartitionOpeningPillLabel } from "@/lib/fiscalYearLabel";

export const FY_OPENING_ROW_TYPE = "fy_opening";

export function isEmbeddedFyOpeningLedgerRow(t: unknown): boolean {
  const row = t as { type?: string; _fyOpeningSynthetic?: boolean } | null | undefined;
  return row?.type === FY_OPENING_ROW_TYPE || row?._fyOpeningSynthetic === true;
}

function rowSortTime(t: any): number | null {
  if (!t || t.type === FISCAL_YEAR_PARTITION_ROW_TYPE || t.type === FY_OPENING_ROW_TYPE || t?._spendWiseSpacer) {
    return null;
  }
  if (t.type === "opening_balance") return null;
  const d = parseFirestoreDateFieldToJsDate(t?.date);
  if (!d || isNaN(d.getTime())) return null;
  return startOfDay(d).getTime();
}

function parsePartitionBoundaryMs(row: any): number | null {
  const id = String(row?.id || "");
  const match = /^__fiscal_partition_(\d+)_/.exec(id);
  if (match) return Number(match[1]);
  return null;
}

/** Closing balance at each merge partition = carry into the new FY segment. */
export function computeFyOpeningBalanceByBoundary(
  rowsInDisplayOrder: any[],
  partitions: FiscalMergePartitionEntry[],
  scopeOpeningBalance: number
): Map<number, number> {
  const boundaries = partitions
    .map((p) => startOfDay(p.at).getTime())
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const result = new Map<number, number>();
  if (!boundaries.length) return result;

  const realTxns = (rowsInDisplayOrder ?? []).filter(
    (t) =>
      t &&
      t.type !== FISCAL_YEAR_PARTITION_ROW_TYPE &&
      t.type !== FY_OPENING_ROW_TYPE &&
      !t._spendWiseSpacer
  );
  const asc = [...realTxns].sort((a, b) => (rowSortTime(a) ?? 0) - (rowSortTime(b) ?? 0));

  let running = Number(scopeOpeningBalance) || 0;
  let boundaryIdx = 0;

  for (const t of asc) {
    const ms = rowSortTime(t);
    if (ms == null) continue;
    while (boundaryIdx < boundaries.length && ms >= boundaries[boundaryIdx]) {
      result.set(boundaries[boundaryIdx], running);
      boundaryIdx++;
    }
    const debit = Number(t.debit) || 0;
    const credit = Number(t.credit) || 0;
    running += debit - credit;
  }

  return result;
}

function buildFyOpeningRow(
  boundaryMs: number,
  signedBalance: number | null,
  state: "ready" | "loading" | "unavailable",
  pillLabel: string
): any {
  const rowDate = fyOpeningRowDateFromBoundaryMs(boundaryMs);
  if (state === "loading") {
    return {
      id: `__fy_opening_${boundaryMs}`,
      type: FY_OPENING_ROW_TYPE,
      isApproved: true,
      _ledgerOpeningPillLabel: pillLabel,
      _fyOpeningSynthetic: true,
      _fyOpeningPending: true,
      date: rowDate,
      voucherNumber: "-",
      user: "-",
      userName: "-",
      debit: 0,
      credit: 0,
      balance: 0,
      runningBalance: 0,
      narration: `Loading ${pillLabel}…`,
    };
  }
  if (state === "unavailable" || signedBalance == null || !Number.isFinite(signedBalance)) {
    return {
      id: `__fy_opening_${boundaryMs}`,
      type: FY_OPENING_ROW_TYPE,
      isApproved: true,
      _ledgerOpeningPillLabel: pillLabel,
      _fyOpeningSynthetic: true,
      _fyOpeningUnavailable: true,
      date: rowDate,
      voucherNumber: "-",
      user: "-",
      userName: "-",
      debit: 0,
      credit: 0,
      balance: 0,
      runningBalance: 0,
      narration: `${pillLabel} unavailable`,
    };
  }
  const abs = Math.abs(signedBalance);
  return {
    id: `__fy_opening_${boundaryMs}`,
    type: FY_OPENING_ROW_TYPE,
    isApproved: true,
    _ledgerOpeningPillLabel: pillLabel,
    _fyOpeningSynthetic: true,
    date: rowDate,
    voucherNumber: "-",
    user: "-",
    userName: "-",
    debit: signedBalance > 0 ? abs : 0,
    credit: signedBalance < 0 ? abs : 0,
    balance: signedBalance,
    runningBalance: signedBalance,
    narration: "",
  };
}

/** Insert FY Opening row immediately after each fiscal merge divider (new FY segment). */
export function insertFyOpeningRowsAfterPartitions(
  rowsInDisplayOrder: any[],
  partitions: FiscalMergePartitionEntry[],
  _scopeOpeningBalance: number,
  options?: {
    snapshotOpeningByBoundaryMs?: Map<number, number> | null;
    partitionOpeningsStatus?: FyPartitionOpeningStatus;
    company?: { country?: string; fiscalYearStart?: unknown } | null;
  }
): any[] {
  if (!partitions.length || !rowsInDisplayOrder?.length) return rowsInDisplayOrder;

  const status = options?.partitionOpeningsStatus ?? "ready";
  const balanceByBoundary = options?.snapshotOpeningByBoundaryMs ?? null;

  const out: any[] = [];
  for (const row of rowsInDisplayOrder) {
    out.push(row);
    if (row?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE) continue;
    const boundaryMs = parsePartitionBoundaryMs(row);
    if (boundaryMs == null) continue;
    const pillLabel = buildFyPartitionOpeningPillLabel(
      options?.company,
      fyOpeningRowDateFromBoundaryMs(boundaryMs)
    );

    if (status === "loading") {
      out.push(buildFyOpeningRow(boundaryMs, null, "loading", pillLabel));
      continue;
    }
    if (status === "unavailable") {
      out.push(buildFyOpeningRow(boundaryMs, null, "unavailable", pillLabel));
      continue;
    }

    const signed = balanceByBoundary?.get(boundaryMs);
    if (signed == null || !Number.isFinite(signed)) {
      out.push(buildFyOpeningRow(boundaryMs, null, "unavailable", pillLabel));
      continue;
    }
    out.push(buildFyOpeningRow(boundaryMs, signed, "ready", pillLabel));
  }
  return out;
}
