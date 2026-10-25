import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import {
  compareEntityListQuickFilterSort,
  entityListQuickFilterShowsAllRows,
  masterEntityTextMatchesSearch,
  shouldHideEntityListSettledRow,
} from "@/lib/filterMasterEntityListRows";

const isSettledBal = (n: number) => Math.abs(Number(n || 0)) < 1e-6;

/** Master group rows: name + balance (number or masked); optional openingBalanceDate for By Date. */
export type EntityGroupRowLike = {
  id?: string;
  name?: string;
  balance?: unknown;
  openingBalanceDate?: unknown;
  lastVoucherAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastEditedAt?: unknown;
};

/**
 * Same rules as PartyList / AccountList footer: Default, Dr, Cr, By Name, By Date, Settled, Non Settled.
 * Non-numeric balance (e.g. bank group masked) counts as unsettled for settled filters; excluded from Dr/Cr.
 */
export function filterAndSortEntityGroups<T extends EntityGroupRowLike>(
  items: T[] | undefined,
  searchTerm: string,
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null,
  hideSettled?: boolean
): T[] {
  const list = (items || []).filter((row) => {
    if (!row.name) return false;
    if (!masterEntityTextMatchesSearch(row.name, searchTerm)) return false;
    if (shouldHideEntityListSettledRow(row.balance, hideSettled, quickFilter)) return false;

    const balRaw = row.balance;
    const bal = typeof balRaw === "number" && !Number.isNaN(balRaw) ? balRaw : null;

    if (entityListQuickFilterShowsAllRows(quickFilter)) return true;
    if (quickFilter === "dr") return bal !== null && bal > 0;
    if (quickFilter === "cr") return bal !== null && bal < 0;
    if (quickFilter === "settled") return bal !== null && isSettledBal(bal);
    if (quickFilter === "non_settled") return bal === null || !isSettledBal(bal);
    return true;
  });

  const sorted = [...list].sort((a, b) =>
    compareEntityListQuickFilterSort(a, b, quickFilter, undefined, lastVoucherMsById)
  );

  return sorted;
}
