"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useVouchers } from "@/hooks/useVouchers";
import { useAdvancesForSale, useAdvancesForPurchase } from "@/hooks/useAdvancesForVoucher";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { doc, updateDoc, Timestamp } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";
import { Link2, RotateCcw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  getTaxFromAllocation,
  getNetFromAllocation,
  getAllocationTotal,
  autoLink as autoLinkUtil,
  buildBillWiseEntityTxnId,
  allocationEntityTxnId,
  getJournalTaxDrAmount,
  getJournalRemainingForTax,
  getPaymentOutRemaining,
  getPaymentInRemaining,
  OPENING_BALANCE_VOUCHER_ID,
  type BillWiseEntityKind,
  type Allocation,
} from "@/lib/payment-allocation-utils";
import type { SalePurchaseBillWiseLegKind } from "@/lib/salePurchaseBillWiseLinkLegs";
import {
  salePurchaseLinkDialogEyebrow,
  salePurchaseLinkDialogTitle,
} from "@/lib/salePurchaseBillWiseLinkLegs";
import { patchVoucherFields, reconcileTdsLegLinks } from "@/lib/voucherActionsClient";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isAdminPanelCompanyLocalId } from "@/lib/adminPanelCompany/ledgerMode";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";
import { dispatchVoucherLivePatch } from "@/lib/voucherFormAttachmentSave";
import { markLedgerVouchersLocalBillWiseLinked } from "@/lib/ledgerPendingBillWiseLinks";
import { scheduleVoucherLinkOutboxFlush } from "@/lib/localVoucherOutbox";
import {
  collectSalePurchaseTaxAndTdsAccountIds,
  getSalePurchaseLinkAllocation,
} from "@/lib/linkAllocationSettings";

const safeToDate = (date: unknown): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof (date as { toDate?: () => Date })?.toDate === "function")
    return (date as { toDate: () => Date }).toDate();
  const parsed = new Date(date as string | number);
  return isNaN(parsed.getTime()) ? null : parsed;
};

async function readVoucherDoc(companyId: string, voucherId: string): Promise<any | null> {
  // Admin Panel Company + local-only: vouchers live in SQLite mirror, not `companies/{id}` Firestore.
  if (isLocalOnlyMode() || isAdminPanelCompanyLocalId(companyId)) {
    return await getCompanyDocFromBrowserDb(companyId, "vouchers", voucherId);
  }
  const snap = await getDoc(doc(firestore, `companies/${companyId}/vouchers`, voucherId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export type LinkAdvancesMode = "sale" | "purchase";

/** Params for applying bill-wise allocations to server (used by voucher form on Save when saveMode is 'local'). */
export type ApplyAdvancesAllocationsParams = {
  companyId: string;
  mode: LinkAdvancesMode;
  targetVoucherId: string;
  targetPartyId: string;
  balanceKind?: "tax" | "net" | "all";
  /** Entity-scoped leg (party / tax / tds) — only this leg is updated; other legs preserved. */
  linkEntityKind?: BillWiseEntityKind;
  linkAccountId?: string;
  /**
   * Party-leg cross-entity (Settings → Link allocation): tax / TDS account ids on this
   * sale/purchase whose payments may also settle the party / taxable amount.
   */
  linkCrossEntityTaxAccountIds?: string[];
  linkCrossEntityTdsAccountIds?: string[];
  linkedAmounts: Record<string, number>;
  vouchers: any[];
  showOBRow: boolean;
};

function allocationMatchesApplyLeg(
  a: Allocation,
  targetVoucherId: string,
  entityTxnId: string | undefined,
  linkEntityKind: BillWiseEntityKind | undefined
): boolean {
  if (String(a.voucherId) !== String(targetVoucherId)) return false;
  if (entityTxnId) {
    const et = allocationEntityTxnId(a);
    if (et) return et === entityTxnId;
  }
  if (linkEntityKind === "tax" || linkEntityKind === "tds") {
    return getTaxFromAllocation(a) > 0;
  }
  if (linkEntityKind === "party" || linkEntityKind === "staff") {
    if (getTaxFromAllocation(a) > 0 && getNetFromAllocation(a) <= 0) return false;
    return getAllocationTotal(a) > 0;
  }
  return true;
}

/** Persist bill-wise link allocations to Firestore. Call from voucher form after saving the voucher when using local-only link dialog. */
export async function applyAdvancesAllocationsToServer(params: ApplyAdvancesAllocationsParams): Promise<void> {
  const {
    companyId,
    mode,
    targetVoucherId,
    targetPartyId,
    balanceKind = "net",
    linkEntityKind,
    linkAccountId,
    linkCrossEntityTaxAccountIds,
    linkCrossEntityTdsAccountIds,
    linkedAmounts,
    vouchers,
    showOBRow,
  } = params;
  const updates = Object.entries(linkedAmounts).filter(([, amt]) => Number(amt) > 0);
  const obAmountToSave = Number(linkedAmounts[OPENING_BALANCE_VOUCHER_ID]) || 0;
  const accountIdForLeg = String(linkAccountId || targetPartyId || "").trim();
  const entityKind: BillWiseEntityKind =
    linkEntityKind ||
    (balanceKind === "tax" ? "tax" : "party");
  const entityTxnId =
    accountIdForLeg
      ? buildBillWiseEntityTxnId({
          voucherId: targetVoucherId,
          entityKind,
          accountId: accountIdForLeg,
        })
      : undefined;
  const isTaxishLeg = entityKind === "tax" || entityKind === "tds";
  const crossTaxIds = new Set(
    [...(linkCrossEntityTaxAccountIds || []), ...(linkCrossEntityTdsAccountIds || [])]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  const targetDoc = await readVoucherDoc(companyId, targetVoucherId);

  // Sources that currently have THIS leg to target but are not in the new linkedAmounts → remove only that leg
  const candidateSources = (() => {
    const crTypes = ["payment_in", "direct_income", "purchase", "purchase_service", "journal", "inter_company"];
    const drTypes = ["payment_out", "direct_expense", "sale", "sale_service", "journal", "inter_company"];
    const taxTypes = ["payment_out", "direct_expense", "journal", "payment_in", "direct_income"];
    const sourceTypes = isTaxishLeg ? taxTypes : mode === "sale" ? crTypes : drTypes;
    const partyMatches = (vouchers as any[]).filter((v) => {
      if (!sourceTypes.includes(v.type)) return false;
      if (isTaxishLeg) {
        if (v.type === "journal") return getJournalTaxDrAmount(v, accountIdForLeg) != null;
        return String(v.taxAccountId ?? "") === accountIdForLeg;
      }
      if (v.type === "journal") {
        return (v.entries as any[] || []).some((e: any) => String(e?.accountId ?? "") === String(targetPartyId));
      }
      if (v.type === "inter_company") {
        const side = mode === "sale" ? "credit" : "debit";
        const amt = getInterCompanyEntityBillWiseAmount(v, String(targetPartyId), "party");
        return !!amt && (side === "credit" ? amt.credit > 0 : amt.debit > 0);
      }
      return String((v as any).partyId ?? "") === String(targetPartyId);
    });
    if (isTaxishLeg || crossTaxIds.size === 0) return partyMatches;
    // Party leg + Settings allow tax/TDS sources: include those payment/journal rows too (unlink + preserve).
    const crossMatches = (vouchers as any[]).filter((v) => {
      if (!taxTypes.includes(v.type)) return false;
      if (v.type === "journal") {
        for (const taxId of crossTaxIds) {
          if (getJournalTaxDrAmount(v, taxId) != null) return true;
        }
        return false;
      }
      return crossTaxIds.has(String(v.taxAccountId ?? ""));
    });
    const byId = new Map<string, any>();
    for (const v of [...partyMatches, ...crossMatches]) byId.set(String(v.id), v);
    return [...byId.values()];
  })();

  const toRemove = candidateSources
    .filter((v) =>
      ((v.allocations as Allocation[] | undefined) || []).some((a) =>
        allocationMatchesApplyLeg(a, targetVoucherId, entityTxnId, entityKind)
      )
    )
    .filter((v) => !(Number(linkedAmounts[v.id]) > 0))
    .map((v) => String(v.id));

  if (updates.length === 0 && toRemove.length === 0 && !showOBRow) return;
  // Party leg may update OB; tax/tds legs never touch staff/party opening balance.
  if (!isTaxishLeg && (showOBRow || obAmountToSave > 0 || linkedAmounts[OPENING_BALANCE_VOUCHER_ID] !== undefined)) {
    await patchVoucherFields(companyId, targetVoucherId, { openingBalanceAllocated: obAmountToSave }, { forceSqliteFirst: true });
  }

  for (const sourceVoucherId of toRemove) {
    const data = await readVoucherDoc(companyId, sourceVoucherId);
    if (!data) continue;
    const allocations: Allocation[] = Array.isArray(data?.allocations) ? [...data.allocations] : [];
    const filtered = allocations.filter(
      (a) => !allocationMatchesApplyLeg(a, targetVoucherId, entityTxnId, entityKind)
    );
    if (filtered.length !== allocations.length) {
      await patchVoucherFields(companyId, sourceVoucherId, { allocations: filtered }, { forceSqliteFirst: true });
    }
  }

  if (toRemove.length > 0 && targetDoc) {
    const currentTargetAllocations: Allocation[] = Array.isArray((targetDoc as any)?.allocations)
      ? [...(targetDoc as any).allocations]
      : [];
    const toRemoveSet = new Set(toRemove);
    const filteredTarget = currentTargetAllocations.filter((a) => {
      if (!toRemoveSet.has(String(a.voucherId))) return true;
      // Only drop reverse rows for this entity leg
      return !allocationMatchesApplyLeg(
        { ...a, voucherId: targetVoucherId },
        targetVoucherId,
        entityTxnId
          ? buildBillWiseEntityTxnId({
              voucherId: String(a.voucherId),
              entityKind,
              accountId: accountIdForLeg,
            })
          : undefined,
        entityKind
      );
    });
    // Simpler reverse cleanup: drop reverse entries from sources in toRemove that match this leg's entityTxnId on target
    const filteredTarget2 = currentTargetAllocations.filter((a) => {
      if (!toRemoveSet.has(String(a.voucherId))) return true;
      const et = allocationEntityTxnId(a);
      if (entityTxnId && et) {
        // reverse stores source id as voucherId; entityTxnId may still point at target leg
        return !et.includes(`::${entityKind}::${accountIdForLeg}`);
      }
      if (isTaxishLeg) return getTaxFromAllocation(a) <= 0;
      return false; // party leg remove
    });
    if (filteredTarget2.length !== currentTargetAllocations.length) {
      await patchVoucherFields(companyId, targetVoucherId, { allocations: filteredTarget2 }, { forceSqliteFirst: true });
    }
    void filteredTarget;
  }

  for (const [sourceVoucherId, amount] of updates) {
    if (sourceVoucherId === OPENING_BALANCE_VOUCHER_ID) continue;
    const data = await readVoucherDoc(companyId, sourceVoucherId);
    if (!data) continue;
    let allocations: Allocation[] = Array.isArray(data?.allocations) ? [...data.allocations] : [];
    // Drop prior row for this leg only, then write fresh amount (dialog sends absolute amounts).
    allocations = allocations.filter(
      (a) => !allocationMatchesApplyLeg(a, targetVoucherId, entityTxnId, entityKind)
    );
    const amt = Number(amount) || 0;
    if (amt <= 0) {
      await patchVoucherFields(companyId, sourceVoucherId, { allocations }, { forceSqliteFirst: true });
      continue;
    }
    const newEntry: Allocation = isTaxishLeg
      ? {
          voucherId: targetVoucherId,
          amount: amt,
          taxAmount: amt,
          linkedAccountId: accountIdForLeg,
          ...(entityTxnId ? { entityTxnId } : {}),
        }
      : {
          voucherId: targetVoucherId,
          amount: amt,
          netAmount: amt,
          linkedAccountId: accountIdForLeg || String(targetPartyId),
          ...(entityTxnId
            ? { entityTxnId }
            : accountIdForLeg
              ? {
                  entityTxnId: buildBillWiseEntityTxnId({
                    voucherId: targetVoucherId,
                    entityKind: "party",
                    accountId: accountIdForLeg,
                  }),
                }
              : {}),
        };
    allocations.push(newEntry);
    await patchVoucherFields(companyId, sourceVoucherId, { allocations }, { forceSqliteFirst: true });
  }

  // Shared TDS-leg consistency pass (mirror recreate / orphan mirror delete) so unlink here is pruned too.
  await reconcileTdsLegLinks(companyId, targetVoucherId).catch((e) =>
    console.warn("[applyAdvancesAllocationsToServer] reconcileTdsLegLinks", e)
  );
  const affectedIds = new Set<string>([targetVoucherId, ...toRemove, ...updates.map(([id]) => id)]);
  affectedIds.delete(OPENING_BALANCE_VOUCHER_ID);
  const nowTs = Timestamp.now();
  const liveEntries: { id: string; allocations: Allocation[] }[] = [];
  for (const vid of affectedIds) {
    if (!vid || vid === OPENING_BALANCE_VOUCHER_ID) continue;
    const data = await getCompanyDocFromBrowserDb(companyId, "vouchers", vid).catch(() => null);
    if (!data) continue;
    const allocations = Array.isArray((data as { allocations?: Allocation[] }).allocations)
      ? ([...((data as { allocations: Allocation[] }).allocations)] as Allocation[])
      : [];
    liveEntries.push({ id: vid, allocations });
    dispatchVoucherLivePatch(companyId, vid, {
      allocations,
      updatedAt: nowTs,
      lastEditedAt: nowTs,
    });
  }
  if (liveEntries.length) {
    markLedgerVouchersLocalBillWiseLinked(liveEntries);
    scheduleVoucherLinkOutboxFlush(
      companyId,
      liveEntries.map((e) => e.id)
    );
  }
}

export interface LinkAdvancesToVoucherDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  mode: LinkAdvancesMode;
  /** The sale or purchase voucher we're linking advances TO */
  targetVoucherId: string;
  targetPartyId: string;
  targetPartyName: string;
  targetLabel?: string;
  /** When set: 'tax'|'net' = link to that portion; 'all' = link to combined (tax+net) for sale/purchase. Default 'net'. */
  balanceKind?: "tax" | "net" | "all";
  /** Entity-scoped tab: party | tax | tds (expense excluded). */
  linkLegKind?: SalePurchaseBillWiseLegKind;
  linkAccountId?: string;
  linkAccountLabel?: string;
  /** When balanceKind is set, pass outstanding for that kind (total tax/net - linked for that kind). */
  targetOutstandingOverride?: number;
  /** When using onConfirm: pass sale/purchase total so dialog can cap linking correctly after user unticks (like spend wise requiredAmount). */
  targetTotalAmount?: number;
  /** Party opening balance (for "Opening Balance" linkable row). When > 0, row is shown. */
  partyOpeningBalance?: number;
  /** Called after successfully updating voucher(s) when saveMode is 'server'. */
  onDone?: () => void;
  /** When provided: DONE only passes allocations to parent (no server save). Server save when user clicks Save on voucher form. */
  onConfirm?: (payload: { linkedAmounts: Record<string, number> }) => void;
  /** When using onConfirm: optional initial state (e.g. pending allocations from form). */
  initialLinkedAmounts?: Record<string, number>;
  /** Optional: pass vouchers from form to ensure full list (Sale/Pur/Payment In/Out) for bill-wise link. */
  vouchersOverride?: any[];
}

export function LinkAdvancesToVoucherDialog({
  isOpen,
  onOpenChange,
  mode,
  targetVoucherId,
  targetPartyId,
  targetPartyName,
  targetLabel,
  balanceKind = "net",
  linkLegKind = "party",
  linkAccountId,
  linkAccountLabel,
  targetOutstandingOverride,
  targetTotalAmount,
  partyOpeningBalance = 0,
  onDone,
  onConfirm,
  initialLinkedAmounts,
  vouchersOverride,
}: LinkAdvancesToVoucherDialogProps) {
  const { companyId, company } = useCompany();
  const { vouchers: vouchersFromContext } = useVouchers();
  const vouchers = vouchersOverride && vouchersOverride.length > 0 ? vouchersOverride : vouchersFromContext;
  const { formatDate, formatDateBS, formatCurrency, dateSystem } = useDate();
  const isTaxishLeg = linkLegKind === "tax" || linkLegKind === "tds";
  const taxAccountIdForLeg = String(linkAccountId || "").trim();
  const salePurchaseLinkPrefs = getSalePurchaseLinkAllocation(company, mode);
  const crossEntityAccountIds = useMemo(() => {
    if (isTaxishLeg) return { taxAccountIds: [] as string[], tdsAccountIds: [] as string[] };
    const targetV = (vouchers as any[])?.find((v) => String(v.id) === String(targetVoucherId));
    const fromLines = collectSalePurchaseTaxAndTdsAccountIds(targetV?.lineItems);
    return {
      taxAccountIds: salePurchaseLinkPrefs.allowTaxOnPartyAmount ? fromLines.taxAccountIds : [],
      tdsAccountIds: [] as string[], // party leg target excludes TDS; TDS is linked via its own TDS leg (no double settle)
    };
  }, [
    isTaxishLeg,
    vouchers,
    targetVoucherId,
    salePurchaseLinkPrefs.allowTaxOnPartyAmount,
    salePurchaseLinkPrefs.allowTdsOnPartyAmount,
  ]);
  const crossEntityTaxIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const id of crossEntityAccountIds.taxAccountIds) s.add(id);
    for (const id of crossEntityAccountIds.tdsAccountIds) s.add(id);
    return s;
  }, [crossEntityAccountIds]);

  const { paymentInsWithRemaining, saleOutstanding } = useAdvancesForSale(
    mode === "sale" && !isTaxishLeg ? targetPartyId : null,
    mode === "sale" && !isTaxishLeg ? targetVoucherId : null,
    vouchers
  );
  const { paymentOutsWithRemaining, purchaseOutstanding } = useAdvancesForPurchase(
    mode === "purchase" && !isTaxishLeg ? targetPartyId : null,
    mode === "purchase" && !isTaxishLeg ? targetVoucherId : null,
    vouchers
  );

  type AdvanceSourceRow = {
    id: string;
    amount: number;
    allocatedTotal: number;
    allocatedToOthers: number;
    remaining: number;
    date?: unknown;
    voucherNumber?: string;
    type: string;
  };

  const buildTaxAccountSourceRows = React.useCallback(
    (accountIds: string[]): AdvanceSourceRow[] => {
      if (!accountIds.length || !vouchers?.length) return [];
      const idSet = new Set(accountIds.map(String));
      const rows: AdvanceSourceRow[] = [];
      for (const v of vouchers as any[]) {
        if (v.type === "payment_out" || v.type === "direct_expense" || v.type === "payment_in" || v.type === "direct_income") {
          if (!idSet.has(String(v.taxAccountId ?? ""))) continue;
          const amount = Number(v.amount ?? v.total ?? 0) || 0;
          const remaining =
            v.type === "payment_out" || v.type === "direct_expense"
              ? getPaymentOutRemaining(v)
              : getPaymentInRemaining(v);
          const allocations = (v.allocations as Allocation[] | undefined) || [];
          const toTarget = allocations
            .filter((a) => String(a.voucherId) === String(targetVoucherId))
            .reduce((s, a) => s + getTaxFromAllocation(a) + getNetFromAllocation(a), 0);
          const linkable = remaining + toTarget;
          if (linkable <= 0 && toTarget <= 0) continue;
          rows.push({
            id: v.id,
            amount,
            allocatedTotal: amount - remaining,
            allocatedToOthers: Math.max(0, amount - remaining - toTarget),
            remaining: linkable,
            date: v.date,
            voucherNumber: v.voucherNumber,
            type: v.type,
          });
          continue;
        }
        if (v.type === "journal" && v.subType !== "add_salary") {
          for (const taxId of idSet) {
            const dr = getJournalTaxDrAmount(v, taxId);
            if (dr == null) continue;
            const remaining = getJournalRemainingForTax(v, taxId);
            const allocations = (v.allocations as Allocation[] | undefined) || [];
            const toTarget = allocations
              .filter((a) => String(a.voucherId) === String(targetVoucherId))
              .reduce((s, a) => s + getTaxFromAllocation(a) + getNetFromAllocation(a), 0);
            const linkable = remaining + toTarget;
            if (linkable <= 0 && toTarget <= 0) continue;
            rows.push({
              id: v.id,
              amount: dr,
              allocatedTotal: dr - remaining,
              allocatedToOthers: Math.max(0, dr - remaining - toTarget),
              remaining: linkable,
              date: v.date,
              voucherNumber: v.voucherNumber,
              type: "journal",
            });
            break;
          }
        }
      }
      return rows.sort((a, b) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dA - dB;
      });
    },
    [vouchers, targetVoucherId]
  );

  const taxEntitySourceList = useMemo(
    () => (isTaxishLeg && taxAccountIdForLeg ? buildTaxAccountSourceRows([taxAccountIdForLeg]) : []),
    [isTaxishLeg, taxAccountIdForLeg, buildTaxAccountSourceRows]
  );

  const partyCrossEntitySourceList = useMemo(() => {
    if (isTaxishLeg || crossEntityTaxIdSet.size === 0) return [] as AdvanceSourceRow[];
    return buildTaxAccountSourceRows([...crossEntityTaxIdSet]);
  }, [isTaxishLeg, crossEntityTaxIdSet, buildTaxAccountSourceRows]);

  const baseSourceList = useMemo(() => {
    if (isTaxishLeg) return taxEntitySourceList;
    const partyList = mode === "sale" ? paymentInsWithRemaining : paymentOutsWithRemaining;
    if (!partyCrossEntitySourceList.length) return partyList;
    const byId = new Map<string, AdvanceSourceRow>();
    for (const r of partyList as AdvanceSourceRow[]) byId.set(String(r.id), r);
    for (const r of partyCrossEntitySourceList) {
      if (!byId.has(String(r.id))) byId.set(String(r.id), r);
    }
    return [...byId.values()];
  }, [
    isTaxishLeg,
    taxEntitySourceList,
    mode,
    paymentInsWithRemaining,
    paymentOutsWithRemaining,
    partyCrossEntitySourceList,
  ]);

  const partyOB = Number(partyOpeningBalance) || 0;
  const showOBInSale = !isTaxishLeg && partyOB < 0;
  const showOBInPurchase = !isTaxishLeg && partyOB > 0;
  const obAmount = Math.abs(partyOB);
  // Consumed by sale/purchase: openingBalanceAllocated on their vouchers
  const totalConsumedFromOBByBillwise = (vouchers as any[]).reduce((sum, v) => {
    if (v.type !== "sale" && v.type !== "sale_service" && v.type !== "purchase" && v.type !== "purchase_service") return sum;
    if (String((v as any).partyId ?? "") !== String(targetPartyId)) return sum;
    return sum + (Number((v as any).openingBalanceAllocated) || 0);
  }, 0);
  // Dr OB (partyOB > 0) is consumed when Payment In links to it; Cr OB when Payment links. So count correct payment type.
  const payTypesOB = partyOB > 0 ? ["payment_in", "direct_income"] : ["payment_out", "direct_expense"];
  const totalConsumedFromOBByPayments = (vouchers as any[]).reduce((sum, v) => {
    if (!payTypesOB.includes(v.type) || String((v as any).partyId ?? "") !== String(targetPartyId)) return sum;
    const allocs = (v.allocations as Allocation[] | undefined) || [];
    const toOB = allocs.filter((a) => a.voucherId === OPENING_BALANCE_VOUCHER_ID).reduce((s, a) => s + getAllocationTotal(a), 0);
    return sum + toOB;
  }, 0);
  const totalConsumedFromOB = totalConsumedFromOBByBillwise + totalConsumedFromOBByPayments;
  const obOutstanding = Math.max(0, obAmount - totalConsumedFromOB);
  const targetVoucher = (vouchers as any[]).find((v) => v.id === targetVoucherId);
  const obAllocatedToTarget = Number(targetVoucher?.openingBalanceAllocated) || 0;
  const showOBRow = (mode === "sale" && showOBInSale) || (mode === "purchase" && showOBInPurchase);
  // Other Linked for OB = amount linked to other vouchers (not current); Current Link = obAllocatedToTarget; Linkable = obOutstanding. Hide row when linkable 0 and no current link.
  const obAllocatedToOthers = Math.max(0, totalConsumedFromOB - obAllocatedToTarget);
  const obRow = showOBRow && obAmount > 0 && (obOutstanding > 0 || obAllocatedToTarget > 0) ? [{
    id: OPENING_BALANCE_VOUCHER_ID,
    amount: obAmount,
    allocatedTotal: totalConsumedFromOB,
    remaining: obOutstanding,
    allocatedToOthers: obAllocatedToOthers,
    date: null,
    voucherNumber: "Opening Balance",
    type: "opening_balance",
  }] : [];
  const sourceList = [...obRow, ...baseSourceList];

  const targetOutstandingFromParent = targetOutstandingOverride ?? (mode === "sale" ? saleOutstanding : purchaseOutstanding);
  const targetOutstanding = onConfirm && targetTotalAmount != null
    ? Math.max(0, targetTotalAmount)
    : targetOutstandingFromParent;

  const [linkedAmounts, setLinkedAmounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // When onConfirm is set: DONE keeps data local (no server write); parent saves on voucher Save. Otherwise DONE runs handleSave.
  useEffect(() => {
    if (!isOpen) setLinkedAmounts({});
  }, [isOpen]);

  // Load existing allocations when dialog opens: use initialLinkedAmounts if provided (from form's effective view or pending), else from vouchers.
  // Form passes effective linked amounts so edit link page shows correct tick even when vouchers are stale.
  useEffect(() => {
    if (!isOpen) return;
    if (initialLinkedAmounts !== undefined && initialLinkedAmounts !== null) {
      setLinkedAmounts(initialLinkedAmounts);
      return;
    }
    if (!targetVoucherId) {
      setLinkedAmounts({});
      return;
    }
    if (!vouchers?.length) return;
    const initial: Record<string, number> = {};
    const targetVoucher = (vouchers as any[]).find((v) => v.id === targetVoucherId);
    const obAllocated = Number(targetVoucher?.openingBalanceAllocated) || 0;
    if (obAllocated > 0) initial[OPENING_BALANCE_VOUCHER_ID] = obAllocated;
    const crTypes = ["payment_in", "direct_income", "purchase", "purchase_service", "journal", "inter_company"];
    const drTypes = ["payment_out", "direct_expense", "sale", "sale_service", "journal", "inter_company"];
    const taxTypes = ["payment_out", "direct_expense", "payment_in", "direct_income", "journal"];
    const srcTypes = isTaxishLeg ? taxTypes : mode === "sale" ? crTypes : drTypes;
    const partyLegEntityTxnId = buildBillWiseEntityTxnId({
      voucherId: targetVoucherId,
      entityKind: "party",
      accountId: targetPartyId,
    });
    const legEntityTxnId = isTaxishLeg
      ? taxAccountIdForLeg
        ? buildBillWiseEntityTxnId({
            voucherId: targetVoucherId,
            entityKind: linkLegKind === "tds" ? "tds" : "tax",
            accountId: taxAccountIdForLeg,
          })
        : ""
      : partyLegEntityTxnId;
    const matchesSourceFilter = (v: any): boolean => {
      if (isTaxishLeg) {
        if (!taxTypes.includes(v.type)) return false;
        if (v.type === "journal") return getJournalTaxDrAmount(v, taxAccountIdForLeg) != null;
        return String(v.taxAccountId ?? "") === taxAccountIdForLeg;
      }
      if (srcTypes.includes(v.type)) {
        if (v.type === "journal") {
          return (v.entries as any[] || []).some((e: any) => String(e?.accountId ?? "") === String(targetPartyId));
        }
        if (v.type === "inter_company") {
          const amt = getInterCompanyEntityBillWiseAmount(v, String(targetPartyId), "party");
          return !!amt && (mode === "sale" ? amt.credit > 0 : amt.debit > 0);
        }
        if (String((v as any).partyId ?? "") === String(targetPartyId)) return true;
      }
      // Party leg + Link allocation: also hydrate tax/TDS payments already linked to party amount.
      if (crossEntityTaxIdSet.size > 0 && taxTypes.includes(v.type)) {
        if (v.type === "journal") {
          for (const taxId of crossEntityTaxIdSet) {
            if (getJournalTaxDrAmount(v, taxId) != null) return true;
          }
          return false;
        }
        return crossEntityTaxIdSet.has(String(v.taxAccountId ?? ""));
      }
      return false;
    };
    (vouchers as any[])
      .filter(matchesSourceFilter)
      .forEach((v) => {
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        const entry = allocations.find((a) => {
          if (String(a.voucherId) !== String(targetVoucherId)) return false;
          if (legEntityTxnId) {
            const et = allocationEntityTxnId(a);
            if (et) return et === legEntityTxnId;
          }
          if (isTaxishLeg) return getTaxFromAllocation(a) > 0;
          return true;
        });
        if (!entry) return;
        const amt = isTaxishLeg
          ? getTaxFromAllocation(entry)
          : balanceKind === "all"
            ? getAllocationTotal(entry)
            : balanceKind === "tax"
              ? getTaxFromAllocation(entry)
              : getNetFromAllocation(entry);
        if (amt > 0) initial[v.id] = amt;
      });
    setLinkedAmounts(initial);
  }, [
    isOpen,
    targetVoucherId,
    targetPartyId,
    mode,
    vouchers,
    balanceKind,
    initialLinkedAmounts,
    isTaxishLeg,
    taxAccountIdForLeg,
    linkLegKind,
    crossEntityTaxIdSet,
  ]);

  const totalLinked = Object.values(linkedAmounts).reduce((s, n) => s + Number(n) || 0, 0);
  const valid = totalLinked <= targetOutstanding && totalLinked >= 0;

  const setLinkedFor = (sourceId: string, value: string, cap?: number) => {
    let num = parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
    if (cap != null && cap >= 0) num = Math.min(num, cap);
    setLinkedAmounts((prev) => {
      if (num === 0) {
        const { [sourceId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [sourceId]: num };
    });
  };

  const handleAutoLink = () => {
    const forAutoLink = sourceList.map((r) => ({
      id: r.id,
      total: r.amount,
      allocated: r.amount - r.remaining,
    }));
    const allocations = autoLinkUtil(targetOutstanding, forAutoLink);
    const next: Record<string, number> = {};
    for (const a of allocations) next[a.voucherId] = a.amount;
    setLinkedAmounts(next);
    toast.success(mode === "sale" ? "Amount allocated to receipts (oldest first)." : "Amount allocated to payments (oldest first).");
  };

  const handleReset = () => {
    // Reset is immediate by request; clear local draft allocations directly.
    setLinkedAmounts({});
    toast.info("Allocations cleared.");
  };

  const handleDone = () => {
    if (onConfirm) {
      onConfirm({ linkedAmounts });
      onOpenChange(false);
    } else {
      handleSave();
    }
  };

  const handleSave = async () => {
    if (!companyId || !valid) return;
    const updates = Object.entries(linkedAmounts).filter(([, amt]) => Number(amt) > 0);
    const voucherPath = `companies/${companyId}/vouchers`;

    // Source voucher IDs that currently have an allocation to this target — same types as dialog (sale: Cr incl. purchase, journal, IC; purchase: Dr incl. sale, journal, IC)
    const crTypes = ["payment_in", "direct_income", "purchase", "purchase_service", "journal", "inter_company"];
    const drTypes = ["payment_out", "direct_expense", "sale", "sale_service", "journal", "inter_company"];
    const sourceTypes = mode === "sale" ? crTypes : drTypes;
    const sourceVoucherIds = (vouchers as any[])
      .filter((v) => {
        if (!sourceTypes.includes(v.type)) return false;
        if (v.type === "journal") return (v.entries as any[] || []).some((e: any) => String(e?.accountId ?? "") === String(targetPartyId));
        if (v.type === "inter_company") {
          const amt = getInterCompanyEntityBillWiseAmount(v, String(targetPartyId), "party");
          return !!amt && (mode === "sale" ? amt.credit > 0 : amt.debit > 0);
        }
        return String((v as any).partyId ?? "") === String(targetPartyId);
      })
      .filter((v) => ((v.allocations as Allocation[] | undefined) || []).some((a) => a.voucherId === targetVoucherId))
      .map((v) => v.id);

    const toRemove = sourceVoucherIds.filter((id) => !(Number(linkedAmounts[id]) > 0));
    const obAmountToSave = Number(linkedAmounts[OPENING_BALANCE_VOUCHER_ID]) || 0;
    if (updates.length === 0 && toRemove.length === 0 && !showOBRow) {
      toast.info("No amount to link.");
      return;
    }
    setSaving(true);
    const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
    const result = await runWithVoucherLinkSaveProgress(async () => {
      // Always persist opening balance allocation when user entered an amount (target is sale/purchase)
      if (showOBRow || obAmountToSave > 0) {
        await patchVoucherFields(companyId, targetVoucherId, { openingBalanceAllocated: obAmountToSave });
      }
      // Unlink from source vouchers (remove their allocation to this target)
      for (const sourceVoucherId of toRemove) {
        const data = await readVoucherDoc(companyId, sourceVoucherId);
        if (!data) continue;
        const allocations: Allocation[] = Array.isArray(data?.allocations) ? [...data.allocations] : [];
        const filtered = allocations.filter((a) => a.voucherId !== targetVoucherId);
        await patchVoucherFields(companyId, sourceVoucherId, { allocations: filtered });
      }
      // Bilateral unlink: also remove from TARGET voucher’s allocations any entry pointing to removed sources (so other voucher’s “Link for bill wise” view updates)
      if (toRemove.length > 0) {
        const targetData = await readVoucherDoc(companyId, targetVoucherId);
        if (targetData) {
          const targetAllocations: Allocation[] = Array.isArray(targetData?.allocations) ? [...targetData.allocations] : [];
          const toRemoveSet = new Set(toRemove);
          const filteredTarget = targetAllocations.filter((a) => !toRemoveSet.has(a.voucherId));
          if (filteredTarget.length !== targetAllocations.length) {
            await patchVoucherFields(companyId, targetVoucherId, { allocations: filteredTarget });
          }
        }
      }
      for (const [sourceVoucherId, amount] of updates) {
        if (sourceVoucherId === OPENING_BALANCE_VOUCHER_ID) continue;
        const data = await readVoucherDoc(companyId, sourceVoucherId);
        if (!data) continue;
        const allocations: Allocation[] = Array.isArray(data?.allocations) ? [...data.allocations] : [];
        const idx = allocations.findIndex((a) => a.voucherId === targetVoucherId);
        const existing = idx >= 0 ? allocations[idx] : null;
        const addAmt = Number(amount);
        const prevTax = existing ? getTaxFromAllocation(existing) : 0;
        const prevNet = existing ? getNetFromAllocation(existing) : 0;
        const newTax = balanceKind === "tax" ? prevTax + addAmt : prevTax;
        const newNet = balanceKind === "net" || balanceKind === "all" ? prevNet + addAmt : prevNet;
        const accountIdForLeg = String(targetPartyId || "").trim();
        const newEntry: Allocation = {
          voucherId: targetVoucherId,
          amount: newTax + newNet,
          taxAmount: newTax,
          netAmount: newNet,
          ...(accountIdForLeg && balanceKind !== "tax"
            ? {
                linkedAccountId: accountIdForLeg,
                entityTxnId: buildBillWiseEntityTxnId({
                  voucherId: targetVoucherId,
                  entityKind: "party",
                  accountId: accountIdForLeg,
                }),
              }
            : accountIdForLeg
              ? { linkedAccountId: accountIdForLeg }
              : {}),
        };
        if (idx >= 0) allocations[idx] = newEntry;
        else allocations.push(newEntry);
        await patchVoucherFields(companyId, sourceVoucherId, { allocations });
      }
      onDone?.();
      onOpenChange(false);
    }, { successTitle: "Advances linked successfully" });
    if (!result.ok) {
      toast.error("Failed to link advances.");
    }
    setSaving(false);
  };

  const title = salePurchaseLinkDialogTitle(linkLegKind);
  const subLabel = targetLabel || (mode === "sale" ? "Sale" : "Purchase");
  const remainingToLink = Math.max(0, targetOutstanding - totalLinked);
  const taxLabel = linkAccountLabel || taxAccountIdForLeg || "Tax";
  const sectionTitle = isTaxishLeg
    ? `Payment / journal vouchers (same ${linkLegKind === "tds" ? "TDS" : "tax"} · ${taxLabel})`
    : crossEntityTaxIdSet.size > 0
      ? `Party + allowed tax/TDS payments (Link allocation)`
      : mode === "sale"
        ? "Cr transactions (same party)"
        : "Dr transactions (same party)";
  const toAccountLabel = isTaxishLeg ? taxLabel : targetPartyName || "—";
  const isMobile = useIsMobile();
  const targetVoucherDate = safeToDate((targetVoucher as any)?.date);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN}
        className={cn(
          NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
          "max-w-4xl max-h-[85vh] flex flex-col rounded-lg pt-3 px-[3px]",
          isMobile && "left-[2px] right-[2px] translate-x-0 w-auto max-w-none h-[85vh] max-h-[85vh] pt-2"
        )}
        hideCloseButton
      >
        <DialogHeader className="flex-shrink-0 space-y-0.5 text-center sm:text-center">
          {/* Code (2) = Link payment to this Sale/Purchase popup — so user can say which popup when reporting */}
          <p className="text-xs text-muted-foreground leading-tight">
            {salePurchaseLinkDialogEyebrow(linkLegKind)} (2)
          </p>
          <DialogTitle className="text-xl leading-tight">{title}</DialogTitle>
          {targetOutstanding > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-4 text-sm pt-1 hidden md:flex">
              <span className="text-muted-foreground">Required: <strong className="text-foreground">{formatCurrency(targetOutstanding)}</strong></span>
              <span className="text-muted-foreground">Selected: <strong className="text-foreground">{formatCurrency(totalLinked)}</strong></span>
              <span className="text-muted-foreground">
                Balance: {remainingToLink === 0 ? <strong className="text-green-600">Settled</strong> : <strong className="text-foreground">{formatCurrency(remainingToLink)}</strong>}
              </span>
              {totalLinked > targetOutstanding && (
            <p className="text-sm text-red-600 font-medium px-1">Selected total ({formatCurrency(totalLinked)}) is more than required ({formatCurrency(targetOutstanding)}). Untick or reduce a row to continue.</p>
          )}
          {totalLinked < targetOutstanding && totalLinked > 0 && (
                <span className="text-amber-600 font-medium">Choose more</span>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          {/* To Voucher: same header as From Voucher; Linkable column shown as Balance */}
          <p className="text-sm font-medium text-muted-foreground shrink-0 text-center">To Voucher</p>
          <div className="rounded-md border flex-shrink-0 overflow-x-auto">
            <table className="table-row-stripe-7 w-full text-sm border-collapse min-w-[400px]">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                  <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                  <th className="text-left p-2 font-medium whitespace-nowrap">To</th>
                  <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                  <th className="text-right p-2 font-medium whitespace-nowrap">Linked</th>
                  <th className="text-right p-2 font-medium whitespace-nowrap">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b last:border-b-0">
                  <td className="p-2 text-muted-foreground whitespace-nowrap">{targetVoucherDate ? formatDate(targetVoucherDate) : "—"}</td>
                  <td className="p-2 font-medium whitespace-nowrap">{(targetVoucher as any)?.voucherNumber ?? subLabel ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap">{toAccountLabel}</td>
                  <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(targetOutstanding, { noSuffix: true })}</td>
                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(totalLinked, { noSuffix: true })}</td>
                  <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(remainingToLink, { noSuffix: true })}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-sm font-medium text-muted-foreground shrink-0 pt-1 text-center">From Voucher</p>
          <p className="text-sm text-muted-foreground shrink-0 -mt-0.5 hidden md:block text-center">{sectionTitle} (only linkable or already selected)</p>
          {/* Same scroll container as spend wise: horizontal + vertical, thin dim scrollbar */}
          <div className="flex-1 min-h-0 border rounded-md overflow-auto scrollbar-slim-dim">
            {sourceList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No advances (same party) to link.</p>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <table className="table-row-stripe-7 w-full text-sm border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 w-10 whitespace-nowrap"></th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                      <th className="text-left p-2 font-medium whitespace-nowrap">From</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Other Linked</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Current Link</th>
                      <th className="text-right p-2 font-medium whitespace-nowrap">Linkable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceList.filter((row) => {
                      const linked = linkedAmounts[row.id] ?? 0;
                      const linkable = Math.max(0, row.remaining - linked);
                      return linkable > 0 || linked > 0;
                    }).map((row) => {
                      const d = safeToDate(row.date);
                      const linked = linkedAmounts[row.id] ?? 0;
                      const allocatedToOthers = (row as { allocatedToOthers?: number }).allocatedToOthers ?? 0;
                      const otherLinked = allocatedToOthers;
                      const rowType = row.id === OPENING_BALANCE_VOUCHER_ID || row.type === "opening_balance" ? "Opening Balance" : row.type === "payment_in" || row.type === "direct_income" ? "receipt" : row.type === "payment_out" || row.type === "direct_expense" ? "payment" : row.type === "purchase" || row.type === "purchase_service" ? "purchase" : row.type === "sale" || row.type === "sale_service" ? "sale" : row.type;
                      const isOBRow = row.id === OPENING_BALANCE_VOUCHER_ID;
                      // Cap by linkable amount (remaining), not full amount — OB row bhi linkable se cap hona chahiye.
                      const rowMax = row.remaining;
                      const maxAllowed = Math.min(rowMax, remainingToLink + linked);
                      // When required amount is already met, disable tick for rows not yet selected (only already-linked rows can be unticked)
                      const cannotAddMore = false; // never block ticking; over-selection is flagged by the warning and Done stays disabled until total <= required
                      return (
                        <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="p-2 w-10 whitespace-nowrap align-middle">
                            <Checkbox
                              checked={linked > 0}
                              disabled={cannotAddMore}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const cap = maxAllowed > 0 ? maxAllowed : rowMax;
                                  const initial = cap > 0 ? (maxAllowed > 0 ? maxAllowed : rowMax) : 0;
                                  if (initial > 0) setLinkedFor(row.id, String(initial), cap);
                                } else {
                                  setLinkedFor(row.id, "0");
                                }
                              }}
                              title={cannotAddMore ? "Required amount already linked" : linked > 0 ? "Clear this row" : "Include this row"}
                            />
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap align-middle">
                            {d ? (dateSystem === "AD" ? formatDate(d) : dateSystem === "BS" ? formatDateBS(d) : <span className="whitespace-nowrap">{formatDateBS(d)} ({formatDate(d)})</span>) : "—"}
                          </td>
                          <td className="p-2 font-medium whitespace-nowrap align-middle">{isOBRow ? "—" : (row.voucherNumber ?? "—")}</td>
                          <td className="p-2 whitespace-nowrap align-middle">{rowType}</td>
                          <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap align-middle tabular-nums">{formatCurrency(row.amount, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrency(otherLinked, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrency(linked, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right font-medium whitespace-nowrap align-middle tabular-nums">{formatCurrency(Math.max(0, row.remaining - linked), { noSuffix: true })} Dr</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {totalLinked > targetOutstanding && (
            <p className="text-sm text-red-600 font-medium px-1">Selected total ({formatCurrency(totalLinked)}) is more than required ({formatCurrency(targetOutstanding)}). Untick or reduce a row to continue.</p>
          )}
          {totalLinked < targetOutstanding && totalLinked > 0 && (
            <p className="text-sm text-amber-600 font-medium px-1">Selected total is less than required. Choose more vouchers to cover the amount.</p>
          )}
          <div className="flex flex-shrink-0 items-center gap-2 pt-2 border-t flex-wrap justify-between">
            <Button type="button" size="sm" onClick={() => onOpenChange(false)} className="h-9 rounded-full shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
              Cancel
            </Button>
            <div className="flex flex-row flex-wrap items-center gap-2 shrink-0">
              <Button type="button" size="sm" onClick={handleAutoLink} disabled={targetOutstanding <= 0 || sourceList.length === 0} className="h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-0">
                <Link2 className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Auto Link
              </Button>
              <Button type="button" size="sm" onClick={handleReset} className="h-9 rounded-full bg-violet-600 hover:bg-violet-700 text-white border-0">
                <RotateCcw className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Reset
              </Button>
              <Button type="button" onClick={handleDone} disabled={saving || !valid} className="h-9 rounded-full bg-green-600 hover:bg-green-700 text-white border-0">
                {saving ? "Saving..." : "DONE"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
