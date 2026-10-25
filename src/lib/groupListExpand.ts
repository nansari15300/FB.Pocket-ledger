import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import {
  compareEntityListQuickFilterSort,
  entityListQuickFilterShowsAllRows,
  masterEntityTextMatchesSearch,
  shouldHideEntityListSettledRow,
} from "@/lib/filterMasterEntityListRows";

export const GROUP_LIST_CHILD_INDENT_CLASS = "pl-[10px]";

export function getEntityListInitials(name: string): string {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export type GroupListSortableMember = {
  id?: string;
  name?: string;
  accountName?: string;
  balance?: number;
  openingBalanceDate?: unknown;
  lastVoucherAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastEditedAt?: unknown;
};

/** Master list member search — bank uses accountName, others use name. */
export function resolveGroupListMemberSearchText(
  row: { name?: unknown; accountName?: unknown } | null | undefined
): string {
  if (!row) return "";
  return String(row.accountName ?? row.name ?? "").trim();
}

const epsSettled = 1e-6;

function isGroupListAmountSettled(n: unknown): boolean {
  const v = Number(n);
  if (Number.isNaN(v)) return false;
  return Math.abs(v) < epsSettled;
}

/** Footer quick filter — hide rows that do not match Dr/Cr/Settled (same as flat account lists). */
export function filterGroupListMembersByQuickFilter<T extends GroupListSortableMember>(
  rows: T[],
  quickFilter: EntityListQuickFilter,
  hideSettled?: boolean
): T[] {
  return rows.filter((row) => {
    if (shouldHideEntityListSettledRow(row.balance, hideSettled, quickFilter)) return false;
    if (entityListQuickFilterShowsAllRows(quickFilter)) return true;
    const balRaw = row.balance;
    const bal = typeof balRaw === "number" && !Number.isNaN(balRaw) ? balRaw : null;
    if (quickFilter === "dr") return bal !== null && bal > 0;
    if (quickFilter === "cr") return bal !== null && bal < 0;
    if (quickFilter === "settled") return bal !== null && isGroupListAmountSettled(bal);
    if (quickFilter === "non_settled") return bal === null || !isGroupListAmountSettled(bal);
    return true;
  });
}

export function compareGroupListMembers<T extends GroupListSortableMember>(
  a: T,
  b: T,
  quickFilter: EntityListQuickFilter,
  nameOf?: (row: T) => string,
  lastVoucherMsById?: Map<string, number> | null
): number {
  return compareEntityListQuickFilterSort(
    a,
    b,
    quickFilter,
    nameOf ?? ((row) => String(row.accountName || row.name || "")),
    lastVoucherMsById
  );
}

export function sortGroupListMembers<T extends GroupListSortableMember>(
  rows: T[],
  quickFilter: EntityListQuickFilter,
  nameOf?: (row: T) => string,
  lastVoucherMsById?: Map<string, number> | null
): T[] {
  return [...rows].sort((a, b) => compareGroupListMembers(a, b, quickFilter, nameOf, lastVoucherMsById));
}

/** Search mode — sirf naam match wale accounts; group name match se saare accounts mat dikhao. */
export function filterGroupListMembersBySearch<T extends GroupListSortableMember>(
  rows: T[],
  searchTerm: string,
  nameOf?: (row: T) => string
): T[] {
  if (!String(searchTerm || "").trim()) return rows;
  return rows.filter((row) =>
    masterEntityTextMatchesSearch(nameOf?.(row) ?? resolveGroupListMemberSearchText(row), searchTerm)
  );
}

export function groupListMembersForDisplay<T extends GroupListSortableMember>(
  rows: T[],
  quickFilter: EntityListQuickFilter,
  searchTerm: string,
  nameOf?: (row: T) => string,
  lastVoucherMsById?: Map<string, number> | null,
  hideSettled?: boolean
): T[] {
  const labelOf = nameOf ?? ((row: T) => resolveGroupListMemberSearchText(row));
  const filtered = filterGroupListMembersByQuickFilter(rows, quickFilter, hideSettled);
  const sorted = sortGroupListMembers(filtered, quickFilter, labelOf, lastVoucherMsById);
  return filterGroupListMembersBySearch(sorted, searchTerm, labelOf);
}

export type GroupListSelectOptions = { memberId?: string | null };

/** Accordion: opening one group collapses any other expanded group in the same list. */
export function toggleGroupListAccordionExpand(
  currentExpandedId: string | null,
  targetId: string
): string | null {
  return currentExpandedId === targetId ? null : targetId;
}

export const IC_PEER_LIST_EXPAND_PREFIX = "ic-peer:";

export function icPeerListExpandKey(peerCompanyId: string): string {
  return `${IC_PEER_LIST_EXPAND_PREFIX}${peerCompanyId}`;
}

export function parseIcPeerListExpandKey(key: string | null | undefined): string | null {
  if (!key?.startsWith(IC_PEER_LIST_EXPAND_PREFIX)) return null;
  const peerId = key.slice(IC_PEER_LIST_EXPAND_PREFIX.length);
  return peerId || null;
}

export function isIcListLevel1Expanded(
  expandedListNodeId: string | null,
  icGroupId: string
): boolean {
  return (
    expandedListNodeId === icGroupId ||
    parseIcPeerListExpandKey(expandedListNodeId) != null
  );
}
