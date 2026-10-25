import type { Party } from "@/components/party/types";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { interCompanyClearingAccountDisplayName } from "@/lib/interCompany/icPeerCompanyGroups";
import { compareEntityListQuickFilterSort } from "@/lib/filterMasterEntityListRows";

export function comparePartyListRows(
  a: Party,
  b: Party,
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null
): number {
  return compareEntityListQuickFilterSort(a, b, quickFilter, undefined, lastVoucherMsById);
}

export function sortPartyListRows(
  rows: Party[],
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null
): Party[] {
  return [...rows].sort((a, b) => comparePartyListRows(a, b, quickFilter, lastVoucherMsById));
}

export function compareIcMemberRows(
  a: Party,
  b: Party,
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null
): number {
  if (quickFilter === "name") {
    return interCompanyClearingAccountDisplayName(a).localeCompare(
      interCompanyClearingAccountDisplayName(b)
    );
  }
  return comparePartyListRows(a, b, quickFilter, lastVoucherMsById);
}

export function sortIcMemberParties(
  rows: Party[],
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null
): Party[] {
  return [...rows].sort((a, b) => compareIcMemberRows(a, b, quickFilter, lastVoucherMsById));
}
