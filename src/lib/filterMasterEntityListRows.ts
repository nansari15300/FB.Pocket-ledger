import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { lastVoucherMsForRow } from "@/lib/masterListLastVoucherMs";

/** PartyList jaisi date normalize — footer "By Date" sort. */
function toDateMs(raw: unknown): number {
  if (!raw) return 0;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? 0 : raw.getTime();
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    const d = (raw as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  const d = new Date(raw as string | number);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

const epsSettled = 1e-6;
export function isMasterListAmountSettled(n: unknown): boolean {
  const v = Number(n);
  if (!Number.isFinite(v)) return false;
  return Math.abs(v) < epsSettled;
}

/** Hide Settled: drop 0-balance rows unless the Settled filter itself is active. */
export function shouldHideEntityListSettledRow(
  balance: unknown,
  hideSettled: boolean | undefined,
  quickFilter?: EntityListQuickFilter
): boolean {
  if (!hideSettled) return false;
  if (quickFilter === "settled") return false;
  return isMasterListAmountSettled(balance);
}

/** Tax / Income–Expense accounts: same footer toggles + sort as PartyList (`EntityListQuickFilterBar`). */
export type MasterEntityListRowLike = {
  id?: string;
  name?: string;
  /** Optional Alias Name (master field) - searched like the name */
  aliasName?: unknown;
  /** Signed amount for Dr/Cr / settled / default |balance| sort */
  balance?: unknown;
  openingBalanceDate?: unknown;
  lastVoucherAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastEditedAt?: unknown;
};

export function masterEntityFieldDateMs(raw: unknown): number {
  return toDateMs(raw);
}

function absMasterBalance(row: { balance?: unknown }): number {
  const n = Number(row.balance);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/** Latest / By Amount / Default / By Name / By Date show every row (Dr/Cr/Settled still filter). */
export function entityListQuickFilterShowsAllRows(quickFilter: EntityListQuickFilter): boolean {
  return (
    quickFilter === "latest" ||
    quickFilter === "amount" ||
    quickFilter === "amount_asc" ||
    quickFilter === "default" ||
    quickFilter === "name" ||
    quickFilter === "date"
  );
}

export function compareEntityListQuickFilterSort<T extends MasterEntityListRowLike>(
  a: T,
  b: T,
  quickFilter: EntityListQuickFilter,
  nameOf?: (row: T) => string,
  lastVoucherMsById?: Map<string, number> | null
): number {
  const nameA = String(nameOf?.(a) ?? a.name ?? "");
  const nameB = String(nameOf?.(b) ?? b.name ?? "");
  if (quickFilter === "name") return nameA.localeCompare(nameB);
  if (quickFilter === "date") return toDateMs(b.openingBalanceDate) - toDateMs(a.openingBalanceDate);
  if (quickFilter === "latest") {
    const d = lastVoucherMsForRow(b, lastVoucherMsById) - lastVoucherMsForRow(a, lastVoucherMsById);
    if (d !== 0) return d;
    return nameA.localeCompare(nameB);
  }
  const ba = absMasterBalance(a);
  const bb = absMasterBalance(b);
  if (quickFilter === "amount_asc") return ba - bb || nameA.localeCompare(nameB);
  return bb - ba || nameA.localeCompare(nameB);
}

export function masterEntityTextMatchesSearch(text: unknown, searchTerm: string): boolean {
  const src = String(text || "").toLowerCase();
  const tokens = String(searchTerm || "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  if (!src) return false;
  return tokens.every((token) => src.includes(token));
}

/** Name OR optional Alias Name matches the list search. */
export function masterEntityRowMatchesSearch(row: { name?: unknown; aliasName?: unknown }, searchTerm: string): boolean {
  return masterEntityTextMatchesSearch(row.name, searchTerm) || (typeof row.aliasName === "string" && row.aliasName.trim() !== "" && masterEntityTextMatchesSearch(row.aliasName, searchTerm));
}

export function filterAndSortMasterEntityListRows<T extends MasterEntityListRowLike>(
  items: T[] | undefined,
  searchTerm: string,
  quickFilter: EntityListQuickFilter,
  options?: {
    /** Jaise Party — system rows list se hata dena */
    excludeRow?: (row: T) => boolean;
    lastVoucherMsById?: Map<string, number> | null;
    hideSettled?: boolean;
  }
): T[] {
  const exclude = options?.excludeRow;
  const hideSettled = options?.hideSettled === true;

  const list = (items || []).filter((row) => {
    if (exclude?.(row)) return false;
    if (!row.name) return false;
    if (!masterEntityRowMatchesSearch(row, searchTerm)) return false;
    if (shouldHideEntityListSettledRow(row.balance, hideSettled, quickFilter)) return false;

    const balRaw = row.balance;
    const bal = typeof balRaw === "number" && !Number.isNaN(balRaw) ? balRaw : null;

    if (entityListQuickFilterShowsAllRows(quickFilter)) return true;
    if (quickFilter === "dr") return bal !== null && bal > 0;
    if (quickFilter === "cr") return bal !== null && bal < 0;
    if (quickFilter === "settled") return bal !== null && isMasterListAmountSettled(bal);
    if (quickFilter === "non_settled") return bal === null || !isMasterListAmountSettled(bal);
    return true;
  });

  return [...list].sort((a, b) =>
    compareEntityListQuickFilterSort(a, b, quickFilter, undefined, options?.lastVoucherMsById)
  );
}

export function sumMasterEntityListDrCr<T extends { debit?: unknown; credit?: unknown }>(
  rows: T[]
): { debit: number; credit: number } {
  return rows.reduce(
    (acc, row) => ({
      debit: acc.debit + (Number(row.debit) || 0),
      credit: acc.credit + (Number(row.credit) || 0),
    }),
    { debit: 0, credit: 0 }
  );
}
