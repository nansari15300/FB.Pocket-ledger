import { startOfDay } from "date-fns";
import { buildFiscalMergePartitionBannerLabel } from "@/lib/fiscalYearLabel";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";

/** Sirf fiscal fields — `useCompany` import avoid (heavy / circular risk). */
type FiscalCompanyLike = {
  country?: string;
  fiscalYearStart?: unknown;
  fiscalSplitMode?: string;
  fiscalMergePartitionAt?: { toDate?: () => Date } | unknown;
  fiscalMergePartitionAtIsos?: string[] | null;
  fiscalPartitionLabel?: string | null;
};

export type FiscalMergePartitionEntry = {
  at: Date;
  label?: string;
};

/** Synthetic row type: ledger + print isi se divider dikhate hain (merge mode). */
export const FISCAL_YEAR_PARTITION_ROW_TYPE = "fiscal_year_partition";

function rowSortTime(t: any): number | null {
  // Synthetic divider ko sort key mat banao — warna Recent (desc) me boundary galat.
  if (!t || t.type === FISCAL_YEAR_PARTITION_ROW_TYPE || (t as any)._spendWiseSpacer) return null;
  // Opening row ke paas reliable date nahi → transition detect mat karo is se
  if (t.type === "opening_balance") return null;
  // Save/live patch ke baad `date` SQLite JSON `{__fsTs, seconds}` ho sakta hai —
  // `new Date(object)` Invalid hota, divider is row ko skip karke voucher pichle FY me dikhata tha.
  const d = parseFirestoreDateFieldToJsDate(t?.date);
  if (!d || isNaN(d.getTime())) return null;
  return startOfDay(d).getTime();
}

/**
 * Merge divider: partition date ke dono taraf list ho (asc ya desc) — boundary cross par ek hi row.
 */
export function insertFiscalPartitionRows(
  rowsInDisplayOrder: any[],
  partitionAt: Date | null | undefined,
  label?: string | null
): any[] {
  if (!partitionAt || !rowsInDisplayOrder?.length) return rowsInDisplayOrder;
  const boundary = startOfDay(partitionAt).getTime();
  const defaultLabel = (label && String(label).trim()) || "── Closing fiscal period · New fiscal period ──";
  const out: any[] = [];
  let lastKeyed: number | null = null;
  let inserted = false;
  for (let i = 0; i < rowsInDisplayOrder.length; i++) {
    const t = rowsInDisplayOrder[i];
    if (t?.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
      out.push(t);
      continue;
    }
    const key = rowSortTime(t);
    if (!inserted && lastKeyed != null && key != null) {
      const ascCross = lastKeyed < boundary && key >= boundary;
      const descCross = lastKeyed >= boundary && key < boundary;
      if (ascCross || descCross) {
        out.push({
          id: `__fiscal_partition_${boundary}_${i}`,
          type: FISCAL_YEAR_PARTITION_ROW_TYPE,
          _partitionLabel: defaultLabel,
        });
        inserted = true;
      }
    }
    out.push(t);
    if (key != null) lastKeyed = key;
  }
  return out;
}

/** Multiple merge dividers — oldest partition pehle insert. */
export function insertFiscalPartitionRowsMulti(
  rowsInDisplayOrder: any[],
  partitions: FiscalMergePartitionEntry[]
): any[] {
  if (!partitions.length || !rowsInDisplayOrder?.length) return rowsInDisplayOrder;
  const sorted = [...partitions].sort(
    (a, b) => startOfDay(a.at).getTime() - startOfDay(b.at).getTime()
  );
  let out = rowsInDisplayOrder;
  for (const part of sorted) {
    out = insertFiscalPartitionRows(out, part.at, part.label);
  }
  return out;
}

/** Timestamp / local `{ toDate }` / ISO string (localStorage merge) se Date. */
function coercePartitionDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return !isNaN(raw.getTime()) ? startOfDay(raw) : null;
  if (typeof raw === "object" && raw !== null && typeof (raw as { toDate?: () => Date }).toDate === "function") {
    const d = (raw as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? startOfDay(d) : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    return d instanceof Date && !isNaN(d.getTime()) ? startOfDay(d) : null;
  }
  return null;
}

/** Company doc (+ locally merged) se merge partition dates (AD start-of-day), oldest → newest. */
export function getFiscalMergePartitionsFromCompany(
  company: FiscalCompanyLike | null | undefined
): Date[] {
  if (!company || company.fiscalSplitMode !== "merge") return [];
  const fromList = (company.fiscalMergePartitionAtIsos ?? [])
    .map((iso) => coercePartitionDate(iso))
    .filter((d): d is Date => Boolean(d));
  if (fromList.length) return fromList;
  const single = coercePartitionDate(company.fiscalMergePartitionAt);
  return single ? [single] : [];
}

/** Company doc (+ locally merged) se merge partition date (AD start-of-day). */
export function getFiscalMergePartitionDateFromCompany(company: FiscalCompanyLike | null | undefined): Date | null {
  const parts = getFiscalMergePartitionsFromCompany(company);
  return parts[0] ?? null;
}

/** Ledger / print: partition rows + auto banner labels. */
export function buildFiscalMergePartitionEntriesFromCompany(
  company: FiscalCompanyLike | null | undefined
): FiscalMergePartitionEntry[] {
  if (!company || company.fiscalSplitMode !== "merge") return [];
  return getFiscalMergePartitionsFromCompany(company).map((at) => ({
    at,
    label: buildFiscalMergePartitionBannerLabel(company, at, company.fiscalPartitionLabel ?? null),
  }));
}
