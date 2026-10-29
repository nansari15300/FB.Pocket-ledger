/**
 * Payment allocation utilities for "Link Payment to Txns" feature.
 * Pure helpers: allocated amount per voucher, outstanding, validate, auto-link, payment status.
 */
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { getSalePurchaseBillWiseTargetTotal } from "@/lib/tdsVoucher";

/** Special voucherId used when allocating payment to party/staff opening balance. */
export const OPENING_BALANCE_VOUCHER_ID = "opening_balance";

/** Entity leg of a multi-account voucher (same voucherNo, separate bill-wise link identity). */
export type BillWiseEntityKind = "staff" | "tax" | "party" | "tds";

export type Allocation = {
  voucherId: string;
  amount: number;
  /** Amount allocated to gross/taxable salary portion of add_salary target */
  taxableAmount?: number;
  /** Amount allocated to tax portion of the target voucher (tax and net are separate accounts) */
  taxAmount?: number;
  /** Amount allocated to net portion of the target voucher */
  netAmount?: number;
  /** Journal bill-wise: party/staff account id for which this allocation applies */
  linkedAccountId?: string;
  /**
   * Entity-scoped link id: `${voucherId}::staff|tax|party|tds::${accountId}`.
   * Display still uses voucherNumber from voucherId; matching uses this so ADD-SAL staff vs tax stay separate.
   */
  entityTxnId?: string;
};

const ENTITY_TXN_SEP = "::";

export function buildBillWiseEntityTxnId(args: {
  voucherId: string;
  entityKind: BillWiseEntityKind;
  accountId: string;
}): string {
  const voucherId = String(args.voucherId || "").trim();
  const accountId = String(args.accountId || "").trim();
  const entityKind = args.entityKind;
  if (!voucherId || !accountId) return voucherId;
  return `${voucherId}${ENTITY_TXN_SEP}${entityKind}${ENTITY_TXN_SEP}${accountId}`;
}

export function parseBillWiseEntityTxnId(
  id: string | null | undefined
): { voucherId: string; entityKind: BillWiseEntityKind; accountId: string } | null {
  const raw = String(id || "").trim();
  if (!raw) return null;
  const parts = raw.split(ENTITY_TXN_SEP);
  if (parts.length !== 3) return null;
  const [voucherId, kind, accountId] = parts;
  if (!voucherId || !accountId) return null;
  if (kind !== "staff" && kind !== "tax" && kind !== "party" && kind !== "tds") return null;
  return { voucherId, entityKind: kind, accountId };
}

export function allocationEntityTxnId(a: Allocation | null | undefined): string {
  return String((a as { entityTxnId?: string } | null)?.entityTxnId ?? "").trim();
}

/** True when this allocation contributes to the given entity leg. */
export function allocationMatchesEntityScope(
  alloc: Allocation | null | undefined,
  _targetVoucher: any,
  scope: { entityKind: BillWiseEntityKind; accountId: string }
): boolean {
  if (!alloc?.voucherId || !scope.accountId) return false;

  const stored = allocationEntityTxnId(alloc);
  if (stored) {
    const parsed = parseBillWiseEntityTxnId(stored);
    if (!parsed) return false;
    return (
      parsed.entityKind === scope.entityKind &&
      String(parsed.accountId) === String(scope.accountId)
    );
  }

  const linked = String((alloc as { linkedAccountId?: string }).linkedAccountId ?? "").trim();
  if (linked && linked !== String(scope.accountId)) return false;

  const taxAmt = Number((alloc as { taxAmount?: number }).taxAmount) || 0;
  const netAmt = Number((alloc as { netAmount?: number }).netAmount) || 0;
  const taxableAmt = Number((alloc as { taxableAmount?: number }).taxableAmount) || 0;
  const plainAmt = Number(alloc.amount) || 0;

  if (scope.entityKind === "tax" || scope.entityKind === "tds") {
    return taxAmt > 0;
  }

  // staff / party: tax-only rows do not match
  if (taxAmt > 0 && netAmt <= 0 && taxableAmt <= 0 && (plainAmt <= 0 || plainAmt === taxAmt)) {
    return false;
  }
  return netAmt > 0 || taxableAmt > 0 || plainAmt > 0;
}

/** Portion of an allocation that counts toward a given entity leg. */
export function getAllocationAmountForEntityScope(
  alloc: Allocation,
  scope: { entityKind: BillWiseEntityKind; accountId: string },
  targetVoucher?: any
): number {
  if (!allocationMatchesEntityScope(alloc, targetVoucher, scope)) return 0;
  if (scope.entityKind === "tax" || scope.entityKind === "tds") return getTaxFromAllocation(alloc);
  return getNetFromAllocation(alloc) + getTaxableFromAllocation(alloc);
}

/** For backward compatibility: total allocated = amount. If taxable/tax/net set, amount should equal their sum. */
export function getAllocationTotal(a: Allocation | { voucherId?: string; amount?: number; taxableAmount?: number; taxAmount?: number; netAmount?: number; linkedAccountId?: string }): number {
  const taxable = Number((a as any).taxableAmount) || 0;
  const tax = Number((a as any).taxAmount) || 0;
  const net = Number((a as any).netAmount) || 0;
  if (taxable > 0 || tax > 0 || net > 0) return taxable + tax + net;
  return Number(a.amount) || 0;
}

function billWiseAllocationSyncFingerprint(arr: readonly Allocation[] | null | undefined): string {
  return JSON.stringify(
    (arr ?? [])
      .filter((a) => {
        const id = String(a?.voucherId || "").trim();
        return id && id !== OPENING_BALANCE_VOUCHER_ID && getAllocationTotal(a) > 0;
      })
      .map((a) => ({
        voucherId: a.voucherId,
        amount: getAllocationTotal(a),
        taxableAmount: (a as { taxableAmount?: number }).taxableAmount ?? null,
        taxAmount: (a as { taxAmount?: number }).taxAmount ?? null,
        netAmount: (a as { netAmount?: number }).netAmount ?? null,
        linkedAccountId: (a as { linkedAccountId?: string }).linkedAccountId ?? null,
        entityTxnId: (a as { entityTxnId?: string }).entityTxnId ?? null,
      }))
      .sort((x, y) =>
        x.voucherId.localeCompare(y.voucherId) || String(x.entityTxnId ?? "").localeCompare(String(y.entityTxnId ?? ""))
      )
  );
}

/** Khali `allocations: []` par background bill-wise sync / "Saving links…" mat chalao. */
export function hasBillWiseAllocationSyncWork(
  newAllocations: readonly Allocation[] | null | undefined,
  previousAllocations: readonly Allocation[] | null | undefined
): boolean {
  return (
    billWiseAllocationSyncFingerprint(newAllocations) !==
    billWiseAllocationSyncFingerprint(previousAllocations)
  );
}

export function getTaxableFromAllocation(a: Allocation): number {
  return Number((a as any).taxableAmount) || 0;
}

export function getTaxFromAllocation(a: Allocation): number {
  return Number((a as any).taxAmount) || 0;
}

export function getNetFromAllocation(a: Allocation): number {
  const tax = getTaxFromAllocation(a);
  const net = Number((a as any).netAmount) || 0;
  if (tax > 0 || net > 0) return net;
  return Number(a.amount) || 0;
}

/** Staff Dr amount on a manual journal (excludes add_salary journals). */
export function getJournalStaffDrAmount(voucher: any, staffId: string): number | null {
  if (voucher?.type !== "journal" || voucher?.subType === "add_salary" || !Array.isArray(voucher?.entries)) return null;
  const entry = voucher.entries.find((e: any) => String(e?.accountId ?? "") === String(staffId));
  if (!entry) return null;
  const debit = Number(entry.debit) || 0;
  return debit > 0 ? debit : null;
}

/** Tax account Dr amount on a manual journal (excludes add_salary journals). */
export function getJournalTaxDrAmount(voucher: any, taxAccountId: string): number | null {
  if (voucher?.type !== "journal" || voucher?.subType === "add_salary" || !Array.isArray(voucher?.entries)) {
    return null;
  }
  const entry = voucher.entries.find((e: any) => String(e?.accountId ?? "") === String(taxAccountId));
  if (!entry) return null;
  const debit = Number(entry.debit) || 0;
  return debit > 0 ? debit : null;
}

/** Remaining linkable amount on a journal row for one tax Dr line. */
export function getJournalRemainingForTax(voucher: any, taxAccountId: string): number {
  const total = getJournalTaxDrAmount(voucher, taxAccountId);
  if (total == null) return 0;
  const allocations = ((voucher.allocations as Allocation[] | undefined) || []).filter((a) => {
    const lid = String((a as any).linkedAccountId ?? "");
    const et = String((a as any).entityTxnId ?? "");
    if (et.includes("::tax::") && !et.endsWith(`::${taxAccountId}`)) return false;
    return !lid || lid === String(taxAccountId);
  });
  const allocated = allocations.reduce((s, a) => {
    const tax = getTaxFromAllocation(a);
    if (tax > 0) return s + tax;
    if (getNetFromAllocation(a) > 0 || getTaxableFromAllocation(a) > 0) return s;
    return s + getAllocationTotal(a);
  }, 0);
  return Math.max(0, total - allocated);
}

export function isSalaryBillWiseSourceVoucher(v: any): boolean {
  const t = String(v?.type ?? "");
  return t === "payment_out" || t === "direct_expense" || (t === "journal" && v?.subType !== "add_salary");
}

export type TaxNetTaxableAllocated = { tax: number; net: number; taxable: number };

/** Allocations from payment outs / journals → add_salary voucherId, split by taxable/tax/net. */
export function getTaxNetTaxableAllocatedByVoucherIdFromSalarySources(vouchers: any[]): Map<string, TaxNetTaxableAllocated> {
  const map = new Map<string, TaxNetTaxableAllocated>();
  for (const v of vouchers) {
    if (!isSalaryBillWiseSourceVoucher(v)) continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      const cur = map.get(a.voucherId) ?? { tax: 0, net: 0, taxable: 0 };
      cur.tax += getTaxFromAllocation(a);
      cur.net += getNetFromAllocation(a);
      cur.taxable += getTaxableFromAllocation(a);
      map.set(a.voucherId, cur);
    }
  }
  return map;
}

/** Remaining linkable amount on a journal row for one staff Dr line. */
export function getJournalRemainingForStaff(voucher: any, staffId: string): number {
  const total = getJournalStaffDrAmount(voucher, staffId);
  if (total == null) return 0;
  const allocations = ((voucher.allocations as Allocation[] | undefined) || []).filter((a) => {
    const lid = String((a as any).linkedAccountId ?? "");
    return !lid || lid === String(staffId);
  });
  const allocated = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
  return Math.max(0, total - allocated);
}

export type PaymentStatus = "paid" | "partially_paid" | "unpaid";

export type PaymentStatusResult = {
  status: PaymentStatus;
  isOverdue: boolean;
  outstanding: number;
  allocated: number;
};

const safeToDate = (d: unknown): Date | null => {
  // Overdue logic receives dueDate from Firestore, backup JSON, and SQLite mirror; use one parser for all shapes.
  return parseFirestoreDateFieldToJsDate(d);
};

/**
 * Build map: voucherId -> total amount allocated to that voucher (from all payment_in vouchers).
 */
export function getAllocatedByVoucherId(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    if (v.type !== "payment_in" && v.type !== "direct_income") continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      map.set(a.voucherId, (map.get(a.voucherId) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/**
 * Build map: voucherId -> total amount allocated to that voucher (from all payment_out vouchers).
 */
export function getAllocatedByVoucherIdFromPaymentOuts(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    if (v.type !== "payment_out" && v.type !== "direct_expense") continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      map.set(a.voucherId, (map.get(a.voucherId) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/** Allocations TO Sale from Purchase (purchase return). For bill-wise status: Sale receives from Purchase; used so Status shows Paid/Partial. */
export function getAllocatedByVoucherIdFromPurchase(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    if (v.type !== "purchase" && v.type !== "purchase_service") continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      map.set(a.voucherId, (map.get(a.voucherId) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/** Allocations TO Purchase from Sale (sale return). For bill-wise status: Purchase receives from Sale; used so Status shows Paid/Partial. */
export function getAllocatedByVoucherIdFromSale(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    if (v.type !== "sale" && v.type !== "sale_service") continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      map.set(a.voucherId, (map.get(a.voucherId) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/** Allocations TO Sale/Purchase from Journal vouchers. Journal bill-wise link reduces target's outstanding; balance update ke liye. */
export function getAllocatedByVoucherIdFromJournal(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    if (v.type !== "journal") continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      map.set(a.voucherId, (map.get(a.voucherId) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/** Sum of TDS-leg (entityTxnId `::tds::`) allocations per target voucher id (sale/purchase TDS leg links from payments/journals). */
export function getTdsLegAllocatedByTargetId(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    const allocations = (v?.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      const key = String(a?.voucherId ?? "");
      if (!key) continue;
      const parsed = parseBillWiseEntityTxnId(allocationEntityTxnId(a));
      if (parsed?.entityKind !== "tds" || parsed.voucherId !== key) continue;
      map.set(key, (map.get(key) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/** Amount this Sale/Purchase has allocated OUT to opposite type'
Rep2 'src/lib/salePurchaseBillWiseLinkLegs.ts' @'
  for (const [id, amt] of taxById) {
    legs.push({
      kind: "tax",
      accountId: id,
      label: taxDisplayName(args.taxes || [], id),
      totalAmount: amt,
    });
  }
  for (const [id, amt] of tdsById) { (reduces own outstanding). E.g. Purchase linked to Sale from Sale form → Purchase allocated to Sale → Purchase status should update. */
export function getOutgoingAllocatedToOpposite(voucher: any): number {
  const allocations = (voucher.allocations as Allocation[] | undefined) || [];
  return allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
}

function isBillWiseLinkSourceVoucherType(type: string): boolean {
  return (
    type === "sale" ||
    type === "sale_service" ||
    type === "purchase" ||
    type === "purchase_service" ||
    type === "journal"
  );
}

/** Incoming allocations from sale/purchase/journal vouchers → target voucherId (Link dialog `allocatedByBillWiseVouchers`). */
export function getAllocatedByBillWiseSourceVouchers(vouchers: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    if (!isBillWiseLinkSourceVoucherType(String(v?.type ?? ""))) continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      const key = String(a.voucherId ?? "");
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + getAllocationTotal(a));
    }
  }
  return map;
}

/** Pre-built incoming allocation indexes — one pass over vouchers, many target lookups. */
export type BillWiseIncomingAllocationMaps = {
  byPaymentIn: Map<string, number>;
  byPaymentOut: Map<string, number>;
  byBillWiseSources: Map<string, number>;
};

export function buildBillWiseIncomingAllocationMaps(vouchers: any[]): BillWiseIncomingAllocationMaps {
  return {
    byPaymentIn: getAllocatedByVoucherId(vouchers),
    byPaymentOut: getAllocatedByVoucherIdFromPaymentOuts(vouchers),
    byBillWiseSources: getAllocatedByBillWiseSourceVouchers(vouchers),
  };
}

function billWiseAllocatedToTargetFromMaps(
  targetVoucher: any,
  targetVoucherId: string,
  maps: BillWiseIncomingAllocationMaps
): number {
  const vid = String(targetVoucherId);
  const sourceInbound =
    (maps.byPaymentIn.get(vid) ?? 0) +
    (maps.byPaymentOut.get(vid) ?? 0) +
    (maps.byBillWiseSources.get(vid) ?? 0);

  const fromTarget = ((targetVoucher?.allocations as Allocation[] | undefined) || []).reduce(
    (sum, a) => sum + getAllocationTotal(a),
    0
  );

  const obInAllocations = ((targetVoucher?.allocations as Allocation[] | undefined) || [])
    .filter((a) => String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID)
    .reduce((s, a) => s + getAllocationTotal(a), 0);
  const targetObAlloc = Math.max(
    0,
    (Number(targetVoucher?.openingBalanceAllocated) || 0) - obInAllocations
  );

  return Math.max(fromTarget, sourceInbound) + targetObAlloc;
}

/**
 * Bill-wise: kitna amount target (sale/purchase) par allocate ho chuka hai.
 * Payment/In + target.allocations dono record ho sakte hain — sum se double-count na ho (Link dialog = max).
 */
export function getBillWiseAllocatedToTarget(
  targetVoucher: any,
  targetVoucherId: string,
  vouchers: any[]
): number {
  return billWiseAllocatedToTargetFromMaps(
    targetVoucher,
    targetVoucherId,
    buildBillWiseIncomingAllocationMaps(vouchers)
  );
}

/** Same as {@link getBillWiseAllocatedToTarget} but reuses pre-built maps (ledger rows / overdue scan). */
export function getBillWiseAllocatedToTargetWithMaps(
  targetVoucher: any,
  targetVoucherId: string,
  maps: BillWiseIncomingAllocationMaps
): number {
  return billWiseAllocatedToTargetFromMaps(targetVoucher, targetVoucherId, maps);
}

export function isSaleOrPurchaseBillVoucherType(type: string | undefined): boolean {
  const t = String(type ?? "");
  return t === "sale" || t === "sale_service" || t === "purchase" || t === "purchase_service";
}

export type TaxNetAllocated = { tax: number; net: number };

/**
 * Build map: voucherId -> { tax, net } allocated from payment_out vouchers.
 * Legacy allocations (only amount) are treated as net.
 */
export function getTaxNetAllocatedByVoucherIdFromPaymentOuts(vouchers: any[]): Map<string, TaxNetAllocated> {
  const map = new Map<string, TaxNetAllocated>();
  for (const v of vouchers) {
    if (v.type !== "payment_out" && v.type !== "direct_expense") continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (!a.voucherId) continue;
      const cur = map.get(a.voucherId) ?? { tax: 0, net: 0 };
      cur.tax += getTaxFromAllocation(a);
      cur.net += getNetFromAllocation(a);
      map.set(a.voucherId, cur);
    }
  }
  return map;
}

/** Outflow vouchers: main/payee leg only — other charge excluded from bill-wise linking. */
export function getOutflowBillWiseLinkAmount(v: any): number {
  const type = String(v?.type ?? "");
  if (type !== "payment_out" && type !== "direct_expense" && type !== "contra") {
    return Number(v?.amount ?? v?.total ?? 0) || 0;
  }
  const total = Number(v?.amount ?? v?.total ?? 0) || 0;
  const explicitPayee = Number(v?.payeeAmount);
  if (Number.isFinite(explicitPayee) && explicitPayee > 0) return explicitPayee;
  const charge = Number(v?.otherChargeAmount) || 0;
  return Math.max(0, total - charge);
}

/**
 * Payment party/staff bill-wise linkable amount — payee leg only.
 * Other charge (expense account) is excluded from party bill-wise linking.
 */
export function getPaymentOutPartyLinkAmount(v: any): number {
  if (v?.type === "payment_out" || v?.type === "direct_expense" || v?.type === "contra") {
    return getOutflowBillWiseLinkAmount(v);
  }
  return Number(v?.amount ?? v?.total ?? 0) || 0;
}

/** Infer party/staff account that owns journal other charge when `otherChargePartyAccountId` was not persisted. */
export function inferJournalOtherChargePartyAccountId(v: any): string {
  const saved = String(v?.otherChargePartyAccountId ?? "").trim();
  if (saved) return saved;
  const charge = Number(v?.otherChargeAmount) || 0;
  if (charge <= 0 || !Array.isArray(v?.entries)) return "";
  const debitEntry = v.entries.find((e: any) => (Number(e?.debit) || 0) > 0);
  const creditEntry = v.entries.find((e: any) => (Number(e?.credit) || 0) > 0);
  return String(debitEntry?.accountId ?? creditEntry?.accountId ?? "").trim();
}

/** Journal party/staff line bill-wise linkable amount — excludes voucher-level other charge on that account. */
export function getJournalPartyBillWiseLinkAmount(v: any, ledgerId: string, lineAmount: number): number {
  const amt = Number(lineAmount) || 0;
  if (amt <= 0) return 0;
  const charge = Number(v?.otherChargeAmount) || 0;
  if (charge <= 0) return amt;
  const chargeParty = inferJournalOtherChargePartyAccountId(v);
  if (chargeParty && chargeParty === String(ledgerId)) {
    return Math.max(0, amt - charge);
  }
  return amt;
}

/**
 * Bilateral bill-wise sync writes the same link on both vouchers — sum once per counter-voucher id.
 */
export function sumDedupedBillWiseAllocatedForVoucher(args: {
  selfVoucherId: string;
  incomingEdges: ReadonlyArray<{ src: { id?: string } | null; alloc: unknown }>;
  outgoingAllocations: ReadonlyArray<Allocation>;
  includeIncoming?: (src: { id?: string } | null, alloc: unknown) => boolean;
}): number {
  const byCounter = new Map<string, number>();
  const selfId = String(args.selfVoucherId ?? "");
  for (const { src, alloc } of args.incomingEdges) {
    const cid = String(src?.id ?? "");
    if (!cid || cid === selfId) continue;
    if (args.includeIncoming && !args.includeIncoming(src, alloc)) continue;
    byCounter.set(cid, Math.max(byCounter.get(cid) ?? 0, getAllocationTotal(alloc as Allocation)));
  }
  for (const a of args.outgoingAllocations) {
    const cid = String(a?.voucherId ?? "");
    if (!cid || cid === selfId || cid === OPENING_BALANCE_VOUCHER_ID) continue;
    byCounter.set(cid, Math.max(byCounter.get(cid) ?? 0, getAllocationTotal(a)));
  }
  let sum = 0;
  byCounter.forEach((v) => {
    sum += v;
  });
  return sum;
}

/** Cap a bill-wise allocation so it never exceeds the target voucher's linkable payee/party leg. */
export function clampBillWiseAllocationToTarget(allocation: Allocation, targetVoucher: any): Allocation {
  if (!allocation?.voucherId || !targetVoucher) return allocation;
  const amt = getAllocationTotal(allocation);
  if (amt <= 0) return allocation;
  const ttype = String(targetVoucher?.type ?? "");
  let cap = amt;
  if (ttype === "payment_out" || ttype === "direct_expense" || ttype === "contra") {
    cap = Math.min(cap, getPaymentOutPartyLinkAmount(targetVoucher));
  } else if (ttype === "journal" || ttype === "adjustment") {
    const lid = String((allocation as { linkedAccountId?: string }).linkedAccountId ?? "").trim();
    if (lid) {
      const partyAmt = getJournalPartyBillWiseAmountFromEntries(targetVoucher, lid);
      if (partyAmt?.total) cap = Math.min(cap, partyAmt.total);
    }
  } else if (isSaleOrPurchaseBillVoucherType(ttype)) {
    cap = Math.min(cap, Number(targetVoucher?.total ?? targetVoucher?.amount ?? 0) || 0);
  }
  if (cap >= amt) return allocation;
  return { ...allocation, amount: cap };
}

/** Journal or adjustment party/staff entry Dr/Cr for bill-wise — other charge excluded when charge ties to this account. */
export function getJournalPartyBillWiseAmountFromEntries(
  voucher: any,
  ledgerId: string
): { debit: number; credit: number; total: number } | null {
  if (
    (voucher?.type !== "journal" && voucher?.type !== "adjustment") ||
    !Array.isArray(voucher?.entries)
  )
    return null;
  const partyEntry = voucher.entries.find(
    (e: any) => String(e?.accountId ?? "") === String(ledgerId)
  );
  if (!partyEntry) return null;
  const rawDebit = Number((partyEntry as any)?.debit) || 0;
  const rawCredit = Number((partyEntry as any)?.credit) || 0;
  const debit =
    rawDebit > 0 ? getJournalPartyBillWiseLinkAmount(voucher, ledgerId, rawDebit) : 0;
  const credit =
    rawCredit > 0 ? getJournalPartyBillWiseLinkAmount(voucher, ledgerId, rawCredit) : 0;
  const total = debit > 0 ? debit : credit;
  if (total <= 0) return null;
  return { debit, credit, total };
}

/**
 * For a payment_in voucher: total allocated = sum(allocations). Remaining = amount - total allocated.
 */
export function getPaymentInRemaining(v: any): number {
  const amount = Number(v.amount ?? v.total ?? 0);
  const allocations = (v.allocations as Allocation[] | undefined) || [];
  const allocated = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
  return Math.max(0, amount - allocated);
}

/**
 * For a payment_out voucher: total allocated = sum(allocations). Remaining = payee amount - total allocated.
 */
export function getPaymentOutRemaining(v: any): number {
  const type = String(v?.type ?? "");
  const amount =
    type === "payment_out" || type === "direct_expense" || type === "contra"
      ? getOutflowBillWiseLinkAmount(v)
      : Number(v?.amount ?? v?.total ?? 0) || 0;
  const allocations = (v.allocations as Allocation[] | undefined) || [];
  const allocated = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
  return Math.max(0, amount - allocated);
}

/**
 * For any voucher with amount and allocations: remaining = amount - total allocated.
 * Used for purchase, sale, etc. when they act as bill-wise link sources.
 * Sale/Purchase use total; prefer total for correct remaining.
 */
export function getVoucherRemaining(v: any): number {
  const amount = getSalePurchaseBillWiseTargetTotal(v);
  const allocations = ((v.allocations as Allocation[] | undefined) || []).filter(
    (a) => !allocationEntityTxnId(a).includes("::tds::")
  );
  const allocated = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
  return Math.max(0, amount - allocated);
}

/**
 * Outstanding = total - allocated.
 */
export function getOutstanding(total: number, allocated: number): number {
  return Math.max(0, Number(total) - Number(allocated));
}

/**
 * Payment status from total and allocated.
 * Optional dueDate: if provided and today > dueDate and outstanding > 0, isOverdue = true.
 */
export function getPaymentStatus(
  total: number,
  allocated: number,
  dueDate?: unknown
): PaymentStatusResult {
  const t = Number(total) || 0;
  const a = Number(allocated) || 0;
  const outstanding = getOutstanding(t, a);

  let status: PaymentStatus = "unpaid";
  if (outstanding <= 0) status = "paid";
  else if (a > 0) status = "partially_paid";

  let isOverdue = false;
  if (outstanding > 0 && dueDate != null) {
    const due = safeToDate(dueDate);
    if (due) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueOnly = new Date(due);
      dueOnly.setHours(0, 0, 0, 0);
      if (today > dueOnly) isOverdue = true;
    }
  }

  return { status, isOverdue, outstanding, allocated: a };
}

/**
 * Validate: sum(allocations) <= receivedAmount and each amount <= that voucher's outstanding.
 */
export function validateAllocations(
  allocations: Allocation[],
  receivedAmount: number,
  outstandingByVoucherId: Map<string, number>
): { valid: boolean; error?: string } {
  const received = Number(receivedAmount) || 0;
  let sum = 0;
  for (const a of allocations) {
    const amt = getAllocationTotal(a);
    if (amt < 0) return { valid: false, error: "Invalid allocation amount." };
    sum += amt;
    const outstanding = outstandingByVoucherId.get(a.voucherId) ?? 0;
    if (a.amount > outstanding)
      return { valid: false, error: `Allocation exceeds outstanding for voucher.` };
  }
  if (sum > received) return { valid: false, error: "Total linked amount exceeds received amount." };
  return { valid: true };
}

/**
 * Auto-link: distribute receivedAmount across sales (oldest first) by outstanding.
 * Returns array of { voucherId, amount } for vouchers that get a non-zero allocation.
 */
export function autoLink(
  receivedAmount: number,
  salesWithOutstanding: Array<{ id: string; total: number; allocated: number }>
): Allocation[] {
  const received = Number(receivedAmount) || 0;
  if (received <= 0) return [];

  const result: Allocation[] = [];
  let remaining = received;

  for (const s of salesWithOutstanding) {
    if (remaining <= 0) break;
    const outstanding = getOutstanding(s.total, s.allocated);
    if (outstanding <= 0) continue;
    const allocate = Math.min(remaining, outstanding);
    if (allocate > 0) {
      result.push({ voucherId: s.id, amount: allocate });
      remaining -= allocate;
    }
  }

  return result;
}

export type LinkedAmountRow = { date: Date | null; voucherNumber: string; amount: number; paymentVoucherId?: string };

export type LinkedAmountKind = "all" | "tax" | "net";

/**
 * For a sale or purchase voucher, return payment allocations TO this voucher.
 * kind: 'tax' = only tax-linked amounts, 'net' = only net-linked amounts, 'all' = total per payment.
 */
export function getLinkedAmountsToVoucher(
  vouchers: any[],
  targetVoucherId: string | null | undefined,
  type: "sale" | "purchase",
  kind: LinkedAmountKind = "all"
): LinkedAmountRow[] {
  if (!targetVoucherId || !vouchers?.length) return [];

  const paymentTypes =
    type === "sale"
      ? ["payment_in", "direct_income", "purchase", "purchase_service", "journal", "adjustment", "inter_company"]
      : ["payment_out", "direct_expense", "sale", "sale_service", "journal", "adjustment", "inter_company"];

  const rows: LinkedAmountRow[] = [];

  const targetVoucher = vouchers.find((v) => v.id === targetVoucherId);
  const obAllocated = Number(targetVoucher?.openingBalanceAllocated) || 0;
  if (obAllocated > 0) {
    rows.push({
      date: null,
      voucherNumber: "Opening Balance",
      amount: obAllocated,
      paymentVoucherId: OPENING_BALANCE_VOUCHER_ID,
    });
  }

  for (const v of vouchers) {
    if (!paymentTypes.includes(v.type)) continue;
    const allocations = (v.allocations as Allocation[] | undefined) || [];
    for (const a of allocations) {
      if (a.voucherId !== targetVoucherId) continue;
      const taxAmt = getTaxFromAllocation(a);
      const netAmt = getNetFromAllocation(a);
      const amt = kind === "tax" ? taxAmt : kind === "net" ? netAmt : getAllocationTotal(a);
      if (amt <= 0) continue;
      const date = safeToDate(v.date);
      rows.push({
        date,
        voucherNumber: v.voucherNumber ?? v.voucher_number ?? "",
        amount: amt,
        paymentVoucherId: v.id,
      });
    }
  }

  rows.sort((a, b) => {
    const tA = a.date ? a.date.getTime() : 0;
    const tB = b.date ? b.date.getTime() : 0;
    return tA - tB;
  });

  return rows;
}

/**
 * For a sale or purchase voucher, return rows when THIS voucher has allocated TO others (outgoing links).
 * E.g. Purchase linked to Sale from Sale form → allocation on Purchase; Purchase form should show "linked to Sale".
 */
export function getOutgoingLinkedAmountRows(
  vouchers: any[],
  targetVoucherId: string | null | undefined,
  type: "sale" | "purchase",
  kind: LinkedAmountKind = "all"
): LinkedAmountRow[] {
  if (!targetVoucherId || !vouchers?.length) return [];
  const targetVoucher = vouchers.find((v) => v.id === targetVoucherId);
  if (!targetVoucher) return [];
  const allocations = (targetVoucher.allocations as Allocation[] | undefined) || [];
  const oppositeTypes = type === "sale" ? ["purchase", "purchase_service"] : ["sale", "sale_service"];
  const rows: LinkedAmountRow[] = [];
  for (const a of allocations) {
    if (!a.voucherId) continue;
    const toVoucher = vouchers.find((v) => v.id === a.voucherId);
    if (!toVoucher || !oppositeTypes.includes(toVoucher.type)) continue;
    const amt = kind === "tax" ? getTaxFromAllocation(a) : kind === "net" ? getNetFromAllocation(a) : getAllocationTotal(a);
    if (amt <= 0) continue;
    const date = safeToDate(toVoucher.date);
    rows.push({
      date,
      voucherNumber: (toVoucher.voucherNumber ?? toVoucher.voucher_number ?? "") as string,
      amount: amt,
      paymentVoucherId: toVoucher.id,
    });
  }
  rows.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return rows;
}

/**
 * Build linked-amount rows from pending allocations (e.g. after user clicks DONE in link dialog).
 * Used so the voucher form shows updated link list before Save; same shape as getLinkedAmountsToVoucher.
 * Journal bhi include – LinkAdvancesToVoucherDialog se journal select karne par PUR/Sale form pe dikhe.
 */
export function getLinkedAmountRowsFromPending(
  pending: Record<string, number>,
  vouchers: any[],
  type: "sale" | "purchase"
): LinkedAmountRow[] {
  if (!pending || !vouchers?.length) return [];
  const paymentTypes = type === "sale" ? ["payment_in", "direct_income", "purchase", "purchase_service", "journal"] : ["payment_out", "direct_expense", "sale", "sale_service", "journal"];
  const rows: LinkedAmountRow[] = [];
  const obAmt = Number(pending[OPENING_BALANCE_VOUCHER_ID]) || 0;
  if (obAmt > 0) rows.push({ date: null, voucherNumber: "Opening Balance", amount: obAmt, paymentVoucherId: OPENING_BALANCE_VOUCHER_ID });
  for (const [voucherId, amount] of Object.entries(pending)) {
    const amt = Number(amount) || 0;
    if (amt <= 0 || voucherId === OPENING_BALANCE_VOUCHER_ID) continue;
    const v = vouchers.find((x: any) => x.id === voucherId);
    if (!v || !paymentTypes.includes(v.type)) continue;
    const date = safeToDate(v.date);
    rows.push({ date, voucherNumber: (v.voucherNumber ?? v.voucher_number ?? "") as string, amount: amt, paymentVoucherId: voucherId });
  }
  rows.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return rows;
}

/** Merge incoming and outgoing linked rows, sort by date. */
export function mergeLinkedRows(incoming: LinkedAmountRow[], outgoing: LinkedAmountRow[]): LinkedAmountRow[] {
  const result = [...incoming, ...outgoing];
  result.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return result;
}

/**
 * True when some journal voucher bill-wise row allocates to this voucher (mirror of use-transactions status enrichment).
 * Needed because we intentionally ignore linkedFromVoucherNos on payment rows for edit-lock — those arrays are often UI-only.
 */
export function hasJournalBillWiseLinkToVoucherId(voucherId: string | undefined, allVouchers: any[]): boolean {
  if (!voucherId || !Array.isArray(allVouchers)) return false;
  for (const v of allVouchers) {
    if (v.isDeleted || v.type !== "journal") continue;
    const allocations = (v.allocations as Allocation[] | undefined) ?? [];
    if (allocations.some((a) => a.voucherId === voucherId && getAllocationTotal(a) > 0)) return true;
  }
  return false;
}

/**
 * Returns true if the voucher has real bill/spend link data on the document (not display-only linkedFrom/linkedTo nos from use-transactions).
 * Payment In/Out: linkedFromVoucherNos can list journals from table enrichment even when the edit dialog should follow allocations + spend ids only — that mismatch looked like "fiscal companies break edit".
 */
export function hasPaymentLinks(voucherData: any): boolean {
  if (!voucherData) return false;
  const alloc = (voucherData.allocations as any[] | undefined) ?? [];
  if (alloc.some((a) => getAllocationTotal(a) > 0)) return true;
  const type = voucherData.type;
  if (type === "payment_out" || type === "direct_expense") {
    const ids = (voucherData.linkedPaymentInIds as string[] | undefined) ?? [];
    if (ids.some(Boolean)) return true;
  }
  if (
    type === "payment_in" ||
    type === "payment_out" ||
    type === "direct_income" ||
    type === "direct_expense"
  ) {
    return false;
  }
  const from = (voucherData.linkedFromVoucherNos as string[] | undefined) ?? [];
  const to = (voucherData.linkedToVoucherNos as string[] | undefined) ?? [];
  return from.length > 0 || to.length > 0 || alloc.length > 0;
}

/**
 * Returns true if any payment_in, direct_income, payment_out, direct_expense, journal, sale, purchase,
 * or inter_company voucher has allocations targeting the given voucherId (bill-wise link).
 * Used so sale/purchase/IC edit is disabled when linked from "Link to Txns" or journal.
 */
export function hasAllocationsToVoucherId(voucherId: string, allVouchers: any[]): boolean {
  if (!voucherId || !Array.isArray(allVouchers)) return false;
  for (const v of allVouchers) {
    if (v.isDeleted) continue;
    const type = v.type;
    const isBillWiseSource = [
      "payment_in",
      "direct_income",
      "payment_out",
      "direct_expense",
      "purchase",
      "purchase_service",
      "sale",
      "sale_service",
      "journal",
      "adjustment",
      "inter_company",
    ].includes(type);
    if (!isBillWiseSource) continue;
    const allocations = (v.allocations as Allocation[] | undefined) ?? [];
    if (allocations.some((a) => a.voucherId === voucherId)) return true;
  }
  return false;
}

/** Returns true if the voucher has spend-wise links (Link for spend wise). Used with bill-wise hasPaymentLinks to disable voucher edit until both are unlinked. */
export function hasSpendWiseLinks(voucherData: any, allVouchers: any[]): boolean {
  if (!voucherData?.id || !Array.isArray(allVouchers)) return false;
  const id = voucherData.id;
  const type = voucherData.type;
  if (type === "payment_out" || type === "direct_expense") {
    const ids = (voucherData.linkedPaymentInIds as string[] | undefined) ?? [];
    return ids.some(Boolean);
  }
  if (type === "payment_in" || type === "direct_income") {
    return allVouchers.some(
      (v: any) =>
        !v.isDeleted &&
        Array.isArray(v.linkedPaymentInIds) &&
        v.linkedPaymentInIds.includes(id)
    );
  }
  if (type === "contra") {
    const fromIds = (voucherData.linkedPaymentInIds as string[] | undefined) ?? [];
    if (fromIds.length > 0) return true;
    return allVouchers.some(
      (v: any) =>
        !v.isDeleted &&
        Array.isArray(v.linkedPaymentInIds) &&
        v.linkedPaymentInIds.includes(id)
    );
  }
  return false;
}

/** Sale/purchase bill-wise status: incoming payment/allocation voucher nos + outgoing opposite-bill links. */
export function getSalePurchaseBillWiseLinkNos(
  vouchers: any[],
  bill: { id: string; type: string }
): {
  linkedFromVoucherNos: string[];
  linkedToVoucherNos: string[];
  linkedFromVoucherNosBillWise: string[];
  linkedToVoucherNosBillWise: string[];
} {
  const billType = bill.type === "sale" ? "sale" : "purchase";
  const fromRows = getLinkedAmountsToVoucher(vouchers, bill.id, billType);
  const toRows = getOutgoingLinkedAmountRows(vouchers, bill.id, billType);
  const linkedFromVoucherNos = Array.from(new Set(fromRows.map((r) => r.voucherNumber).filter(Boolean)));
  const linkedToVoucherNos = Array.from(new Set(toRows.map((r) => r.voucherNumber).filter(Boolean)));
  return {
    linkedFromVoucherNos,
    linkedToVoucherNos,
    linkedFromVoucherNosBillWise: linkedFromVoucherNos,
    linkedToVoucherNosBillWise: linkedToVoucherNos,
  };
}
