"use client";

import { useMemo } from "react";
import type { Allocation } from "@/lib/payment-allocation-utils";
import {
  getAllocatedByVoucherId,
  getAllocatedByVoucherIdFromPaymentOuts,
  getOutstanding,
  getAllocationTotal,
  getPaymentOutPartyLinkAmount,
  getJournalPartyBillWiseAmountFromEntries,
  OPENING_BALANCE_VOUCHER_ID,
} from "@/lib/payment-allocation-utils";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";

function isEntryBasedBillWiseVoucher(v: any): boolean {
  return v?.type === "journal" || v?.type === "adjustment";
}

export type LinkPaymentVariant = "payment_in" | "payment_out";

/** Same list logic as LinkPaymentToTxnsDialog so form count matches popup linkable rows. */
export function useLinkPaymentToTxnsLinkableCount(
  variant: LinkPaymentVariant,
  partyId: string | null | undefined,
  vouchers: any[] | null | undefined,
  options: {
    paymentInId?: string | null;
    paymentOutId?: string | null;
    existingAllocations?: Allocation[];
    partyOpeningBalance?: number;
  }
): number {
  const { paymentInId, paymentOutId, existingAllocations = [], partyOpeningBalance = 0 } = options ?? {};

  return useMemo(() => {
    if (!partyId || !vouchers?.length) return 0;
    const isOut = variant === "payment_out";
    // Match party by explicit partyId OR by journal entry account id so journal rows are counted as linkable.
    const voucherTouchesParty = (v: any) =>
      String((v as any)?.partyId ?? "") === String(partyId) ||
      String((v as any)?.adjustmentTarget?.id ?? "") === String(partyId) ||
      (Array.isArray((v as any)?.entries) &&
        (v as any).entries.some((e: any) => String(e?.accountId ?? "") === String(partyId)));
    // Derive bill-wise amount from party-side journal entry (Dr/Cr) for consistent popup/count behavior.
    const getJournalPartyAmount = (voucher: any) =>
      getJournalPartyBillWiseAmountFromEntries(voucher, partyIdStr);

    const partyIdStr = String(partyId);
    const payType = isOut ? ["payment_out", "direct_expense"] : ["payment_in", "direct_income"];
    let fromPayments = 0;
    (vouchers as any[]).forEach((v) => {
      if (!payType.includes(v.type) || String((v as any).partyId ?? "") !== partyIdStr) return;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      allocs.forEach((a) => {
        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) fromPayments += getAllocationTotal(a);
      });
    });
    const fromBillwise = (vouchers as any[]).reduce((sum, v) => {
      if (v.type !== "sale" && v.type !== "sale_service" && v.type !== "purchase" && v.type !== "purchase_service") return sum;
      if (String((v as any).partyId ?? "") !== partyIdStr) return sum;
      return sum + (Number((v as any).openingBalanceAllocated) || 0);
    }, 0);
    const totalConsumedFromOB = fromPayments + fromBillwise;

    const partyOB = Number(partyOpeningBalance) || 0;
    const showOBInPaymentIn = partyOB > 0;
    const showOBInPaymentOut = partyOB < 0;
    const obAmount = partyOB > 0 ? partyOB : Math.abs(partyOB);
    const obOutstandingIn = Math.max(0, obAmount - totalConsumedFromOB);

    if (variant === "payment_in") {
      const paymentInVouchers = (vouchers as any[]).filter(
        (v) => (v.type === "payment_in" || v.type === "direct_income") && (paymentInId == null || v.id !== paymentInId)
      );
      const allocatedByPaymentIns = getAllocatedByVoucherId(paymentInVouchers);
      // Keep outstanding math in sync with popup by including allocations emitted from bill-wise vouchers + journals.
      const allocatedByBillWiseVouchers = (() => {
        const m = new Map<string, number>();
        for (const v of vouchers as any[]) {
          if (
            v.type !== "sale" &&
            v.type !== "sale_service" &&
            v.type !== "purchase" &&
            v.type !== "purchase_service" &&
            !isEntryBasedBillWiseVoucher(v) &&
            v.type !== "inter_company"
          ) continue;
          const allocations = (v.allocations as Allocation[] | undefined) || [];
          for (const a of allocations) {
            if (!a.voucherId) continue;
            m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
          }
        }
        return m;
      })();
      const totalAllocatedTo = (vid: string) => (allocatedByPaymentIns.get(vid) ?? 0) + (allocatedByBillWiseVouchers.get(vid) ?? 0);
      const hasExistingAlloc = (id: string) => existingAllocations.some((a) => a.voucherId === id && getAllocationTotal(a) > 0);

      const salesForParty = (vouchers as any[]).filter(
        (v) => (v.type === "sale" || v.type === "sale_service") && String((v as any).partyId ?? "") === String(partyId)
      );
      const salesFiltered = salesForParty.filter((v) => {
        const total = Number(v.total ?? v.amount ?? 0);
        const allocated = totalAllocatedTo(v.id);
        const outstanding = getOutstanding(total, allocated);
        return outstanding > 0 || hasExistingAlloc(v.id);
      });

      const paymentOutsForParty = (vouchers as any[]).filter(
        (v) =>
          (v.type === "payment_out" || v.type === "direct_expense") &&
          String((v as any).partyId ?? "") === String(partyId)
      );
      const paymentOutsFiltered = paymentOutsForParty.filter((v) => {
        const total = getPaymentOutPartyLinkAmount(v);
        const allocated = totalAllocatedTo(v.id);
        const outstanding = getOutstanding(total, allocated);
        return outstanding > 0 || hasExistingAlloc(v.id);
      });
      // Payment In links to Dr-side journals for the selected party.
      const journalsDrFiltered = (vouchers as any[]).filter((v) => {
        if (!isEntryBasedBillWiseVoucher(v) || !voucherTouchesParty(v)) return false;
        const partyAmount = getJournalPartyAmount(v);
        if (!partyAmount || partyAmount.debit <= 0) return false;
        const allocated = totalAllocatedTo(v.id);
        const outstanding = getOutstanding(partyAmount.total, allocated);
        return outstanding > 0 || hasExistingAlloc(v.id);
      });
      const icDrFiltered = (vouchers as any[]).filter((v) => {
        if (v.type !== "inter_company") return false;
        const partyAmount = getInterCompanyEntityBillWiseAmount(v, partyIdStr, "party");
        if (!partyAmount || partyAmount.debit <= 0) return false;
        const allocated = totalAllocatedTo(v.id);
        const outstanding = getOutstanding(partyAmount.total, allocated);
        return outstanding > 0 || hasExistingAlloc(v.id);
      });

      const ob = showOBInPaymentIn && (obOutstandingIn > 0 || hasExistingAlloc(OPENING_BALANCE_VOUCHER_ID)) ? 1 : 0;
      return ob + salesFiltered.length + paymentOutsFiltered.length + journalsDrFiltered.length + icDrFiltered.length;
    }

    // variant === "payment_out"
    const hasExistingAllocOut = (id: string) => existingAllocations.some((a) => a.voucherId === id && getAllocationTotal(a) > 0);
    const paymentOutVouchers = (vouchers as any[]).filter(
      (v) => (v.type === "payment_out" || v.type === "direct_expense") && (paymentOutId == null || v.id !== paymentOutId)
    );
    const allocatedByPaymentOuts = getAllocatedByVoucherIdFromPaymentOuts(paymentOutVouchers);
    // Keep outstanding math in sync with popup by including allocations emitted from bill-wise vouchers + journals.
    const allocatedByBillWiseVouchers = (() => {
      const m = new Map<string, number>();
      for (const v of vouchers as any[]) {
        if (
          v.type !== "sale" &&
          v.type !== "sale_service" &&
          v.type !== "purchase" &&
          v.type !== "purchase_service" &&
          !isEntryBasedBillWiseVoucher(v) &&
          v.type !== "inter_company"
        ) continue;
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        for (const a of allocations) {
          if (!a.voucherId) continue;
          m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    const totalAllocatedToOut = (vid: string) => (allocatedByPaymentOuts.get(vid) ?? 0) + (allocatedByBillWiseVouchers.get(vid) ?? 0);

    const purchasesForParty = (vouchers as any[]).filter(
      (v) =>
        (v.type === "purchase" || v.type === "purchase_service") &&
        String((v as any).partyId ?? "") === String(partyId)
    );
    const purchasesFiltered = purchasesForParty.filter((v) => {
      const total = Number(v.total ?? v.amount ?? 0);
      const allocated = totalAllocatedToOut(v.id);
      const outstanding = getOutstanding(total, allocated);
      return outstanding > 0 || hasExistingAllocOut(v.id);
    });

    const paymentInsForParty = (vouchers as any[]).filter(
      (v) =>
        (v.type === "payment_in" || v.type === "direct_income") &&
        String((v as any).partyId ?? "") === String(partyId)
    );
    const paymentInsFiltered = paymentInsForParty.filter((v) => {
      const total = Number((v as any).amount ?? (v as any).total ?? 0) || 0;
      const allocated = totalAllocatedToOut(v.id);
      const outstanding = getOutstanding(total, allocated);
      return outstanding > 0 || hasExistingAllocOut(v.id);
    });
    // Payment links to Cr-side journals for the selected party.
    const journalsCrFiltered = (vouchers as any[]).filter((v) => {
      if (!isEntryBasedBillWiseVoucher(v) || !voucherTouchesParty(v)) return false;
      const partyAmount = getJournalPartyAmount(v);
      if (!partyAmount || partyAmount.credit <= 0) return false;
      const allocated = totalAllocatedToOut(v.id);
      const outstanding = getOutstanding(partyAmount.total, allocated);
      return outstanding > 0 || hasExistingAllocOut(v.id);
    });
    const icCrFiltered = (vouchers as any[]).filter((v) => {
      if (v.type !== "inter_company") return false;
      const partyAmount = getInterCompanyEntityBillWiseAmount(v, partyIdStr, "party");
      if (!partyAmount || partyAmount.credit <= 0) return false;
      const allocated = totalAllocatedToOut(v.id);
      const outstanding = getOutstanding(partyAmount.total, allocated);
      return outstanding > 0 || hasExistingAllocOut(v.id);
    });

    const ob = showOBInPaymentOut && (obOutstandingIn > 0 || hasExistingAllocOut(OPENING_BALANCE_VOUCHER_ID)) ? 1 : 0;
    return ob + purchasesFiltered.length + paymentInsFiltered.length + journalsCrFiltered.length + icCrFiltered.length;
  }, [variant, partyId, vouchers, paymentInId, paymentOutId, existingAllocations, partyOpeningBalance]);
}
