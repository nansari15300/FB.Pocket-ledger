"use client";

import { useMemo } from "react";
import {
  getAllocatedByVoucherId,
  getAllocatedByVoucherIdFromPaymentOuts,
  getPaymentInRemaining,
  getPaymentOutRemaining,
  getPaymentOutPartyLinkAmount,
  getJournalPartyBillWiseAmountFromEntries,
  getJournalTaxDrAmount,
  getJournalRemainingForTax,
  getTaxFromAllocation,
  getNetFromAllocation,
  getVoucherRemaining,
  getOutstanding,
  getAllocationTotal,
  OPENING_BALANCE_VOUCHER_ID,
  type Allocation,
} from "@/lib/payment-allocation-utils";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";

export type PaymentInWithRemaining = {
  id: string;
  amount: number;
  allocatedTotal: number;
  /** Amount from this receipt linked to other vouchers (not current target). Used for "Other" column so it does not drop when adding link to current sale. */
  allocatedToOthers: number;
  remaining: number;
  date?: unknown;
  voucherNumber?: string;
  type: string;
};

export type PaymentOutWithRemaining = {
  id: string;
  amount: number;
  allocatedTotal: number;
  /** Amount from this voucher linked to other vouchers (not current target). Used for "Other" column. */
  allocatedToOthers: number;
  remaining: number;
  date?: unknown;
  voucherNumber?: string;
  type: string;
};

/** Cr voucher types for party (Payment In, Purchase, Journal Cr) — used to settle Sale (Dr). */
const CR_TYPES = ["payment_in", "direct_income", "purchase", "purchase_service"] as const;

/** Dr voucher types for party (Payment, Sale, Journal Dr) — used to settle Purchase (Cr). */
const DR_TYPES = ["payment_out", "direct_expense", "sale", "sale_service"] as const;

const getJournalPartyAmount = (voucher: any, partyId: string) =>
  getJournalPartyBillWiseAmountFromEntries(voucher, partyId);


/**
 * For "Link advances TO this sale": all Cr vouchers for party (payment_in, purchase, etc.).
 * Show if linkable balance > 0 OR already linked to current sale.
 */
export function useAdvancesForSale(
  partyId: string | null | undefined,
  targetSaleId: string | null | undefined,
  vouchers: any[]
) {
  return useMemo(() => {
    if (!partyId || !vouchers?.length) {
      return { paymentInsWithRemaining: [] as PaymentInWithRemaining[], saleOutstanding: 0 };
    }

    const partyIdStr = String(partyId);
    const crVouchers = (vouchers as any[]).filter(
      (v) => (CR_TYPES as readonly string[]).includes((v.type || "").toLowerCase()) && String((v as any).partyId ?? "") === partyIdStr
    );
    const journalCrVouchers = (vouchers as any[]).filter(
      (v) => v.type === "journal" && v.subType !== "add_salary" && getJournalPartyAmount(v, partyIdStr) != null && (getJournalPartyAmount(v, partyIdStr)?.credit ?? 0) > 0
    );
    const allocatedToSales = getAllocatedByVoucherId(
      crVouchers.filter((v) => v.type === "payment_in" || v.type === "direct_income")
    );
    const allocatedFromPurchases = (() => {
      const m = new Map<string, number>();
      for (const v of crVouchers) {
        if (v.type !== "purchase" && v.type !== "purchase_service") continue;
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        for (const a of allocations) {
          if (!a.voucherId) continue;
          m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    const allocatedFromJournalCr = (() => {
      const m = new Map<string, number>();
      for (const v of journalCrVouchers) {
        const allocations = (v.allocations as { voucherId?: string; amount?: number; linkedAccountId?: string }[] | undefined) || [];
        const forParty = allocations.filter((a: any) => !a.voucherId ? false : String(a?.linkedAccountId ?? "") === partyIdStr || (!a.linkedAccountId && (getJournalPartyAmount(v, partyIdStr)?.credit ?? 0) > 0));
        for (const a of forParty) {
          if (!a.voucherId) continue;
          m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    const totalAllocatedToSale = (vid: string) =>
      (allocatedToSales.get(vid) ?? 0) + (allocatedFromPurchases.get(vid) ?? 0) + (allocatedFromJournalCr.get(vid) ?? 0);

    const saleOutstanding = (() => {
      if (!targetSaleId) return 0;
      const sale = vouchers.find((v) => v.id === targetSaleId && (v.type === "sale" || v.type === "sale_service"));
      if (!sale) return 0;
      const total = Number(sale.total ?? sale.amount ?? 0);
      const allocated = totalAllocatedToSale(targetSaleId);
      return getOutstanding(total, allocated);
    })();

    // Sale/Purchase use total; Payment In uses amount. Prefer total for purchase (Cr), amount for payment_in.
    const paymentInsWithRemaining: PaymentInWithRemaining[] = crVouchers.map((v) => {
      const t = (v.type || "").toLowerCase();
      const amount = (t === "purchase" || t === "purchase_service")
        ? Number(v.total ?? v.amount ?? 0)
        : Number(v.amount ?? v.total ?? 0);
      const remaining = v.type === "payment_in" || v.type === "direct_income"
        ? getPaymentInRemaining(v)
        : getVoucherRemaining(v);
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const allocatedTotal = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      const allocatedToOthers = (targetSaleId
        ? allocations.filter((a) => a.voucherId !== targetSaleId).reduce((s, a) => s + getAllocationTotal(a), 0)
        : allocatedTotal);
      return {
        id: v.id,
        amount,
        allocatedTotal,
        allocatedToOthers,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber,
        type: v.type,
      };
    });

    const journalCrRows: PaymentInWithRemaining[] = journalCrVouchers.map((v) => {
      const partyAmount = getJournalPartyAmount(v, partyIdStr)!;
      const allocations = (v.allocations as { voucherId?: string; amount?: number; linkedAccountId?: string }[] | undefined) || [];
      const forParty = allocations.filter((a: any) => String(a?.linkedAccountId ?? "") === partyIdStr || (!a.linkedAccountId && partyAmount.credit > 0));
      const allocatedTotal = forParty.reduce((s, a) => s + getAllocationTotal(a), 0);
      const allocatedToOthers = (targetSaleId
        ? forParty.filter((a) => a.voucherId !== targetSaleId).reduce((s, a) => s + getAllocationTotal(a), 0)
        : allocatedTotal);
      const remaining = Math.max(0, partyAmount.total - allocatedTotal);
      return {
        id: v.id,
        amount: partyAmount.total,
        allocatedTotal,
        allocatedToOthers,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber ?? (v as any).voucher_number,
        type: "journal",
      };
    });

    const icCrVouchers = (vouchers as any[]).filter((v) => {
      if (v.type !== "inter_company") return false;
      const amt = getInterCompanyEntityBillWiseAmount(v, partyIdStr, "party");
      return !!amt && amt.credit > 0;
    });
    const icCrRows: PaymentInWithRemaining[] = icCrVouchers.map((v) => {
      const partyAmount = getInterCompanyEntityBillWiseAmount(v, partyIdStr, "party")!;
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const allocatedTotal = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      const allocatedToOthers = targetSaleId
        ? allocations.filter((a) => a.voucherId !== targetSaleId).reduce((s, a) => s + getAllocationTotal(a), 0)
        : allocatedTotal;
      const remaining = Math.max(0, partyAmount.total - allocatedTotal);
      return {
        id: v.id,
        amount: partyAmount.total,
        allocatedTotal,
        allocatedToOthers,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber ?? (v as any).voucher_number,
        type: "inter_company",
      };
    });

    const allCrRows = [...paymentInsWithRemaining, ...journalCrRows, ...icCrRows];

    // Show only if linkable (remaining > 0) OR already linked to this sale (so user can unlink)
    const filtered = allCrRows.filter((row) => {
      if (row.remaining > 0) return true;
      if (!targetSaleId) return true;
      const v = [...crVouchers, ...journalCrVouchers, ...icCrVouchers].find((x) => x.id === row.id);
      if (!v) return false;
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const toCurrent = allocations.find((a) => a.voucherId === targetSaleId);
      return toCurrent != null && getAllocationTotal(toCurrent) > 0;
    });

    filtered.sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });

    return { paymentInsWithRemaining: filtered, saleOutstanding };
  }, [partyId, targetSaleId, vouchers]);
}

/**
 * For "Link advances TO this purchase": all Dr vouchers for party (payment_out, sale, etc.).
 * Show if linkable balance > 0 OR already linked to current purchase.
 */
export function useAdvancesForPurchase(
  partyId: string | null | undefined,
  targetPurchaseId: string | null | undefined,
  vouchers: any[]
) {
  return useMemo(() => {
    if (!partyId || !vouchers?.length) {
      return { paymentOutsWithRemaining: [] as PaymentOutWithRemaining[], purchaseOutstanding: 0 };
    }

    const partyIdStr = String(partyId);
    const drVouchers = (vouchers as any[]).filter(
      (v) => (DR_TYPES as readonly string[]).includes((v.type || "").toLowerCase()) && String((v as any).partyId ?? "") === partyIdStr
    );
    const journalDrVouchers = (vouchers as any[]).filter(
      (v) => v.type === "journal" && v.subType !== "add_salary" && getJournalPartyAmount(v, partyIdStr) != null && (getJournalPartyAmount(v, partyIdStr)?.debit ?? 0) > 0
    );
    const allocatedToPurchases = getAllocatedByVoucherIdFromPaymentOuts(
      drVouchers.filter((v) => v.type === "payment_out" || v.type === "direct_expense")
    );
    const allocatedFromSales = (() => {
      const m = new Map<string, number>();
      for (const v of drVouchers) {
        if (v.type !== "sale" && v.type !== "sale_service") continue;
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        for (const a of allocations) {
          if (!a.voucherId) continue;
          m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    const allocatedFromJournalDr = (() => {
      const m = new Map<string, number>();
      for (const v of journalDrVouchers) {
        const allocations = (v.allocations as { voucherId?: string; amount?: number; linkedAccountId?: string }[] | undefined) || [];
        const forParty = allocations.filter((a: any) => !a.voucherId ? false : String(a?.linkedAccountId ?? "") === partyIdStr || (!a.linkedAccountId && (getJournalPartyAmount(v, partyIdStr)?.debit ?? 0) > 0));
        for (const a of forParty) {
          if (!a.voucherId) continue;
          m.set(a.voucherId, (m.get(a.voucherId) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    const totalAllocatedToPurchase = (vid: string) =>
      (allocatedToPurchases.get(vid) ?? 0) + (allocatedFromSales.get(vid) ?? 0) + (allocatedFromJournalDr.get(vid) ?? 0);

    const purchaseOutstanding = (() => {
      if (!targetPurchaseId) return 0;
      const purchase = vouchers.find((v) => v.id === targetPurchaseId && (v.type === "purchase" || v.type === "purchase_service"));
      if (!purchase) return 0;
      const total = Number(purchase.total ?? purchase.amount ?? 0);
      const allocated = totalAllocatedToPurchase(targetPurchaseId);
      return getOutstanding(total, allocated);
    })();

    // Sale/Purchase use total; Payment uses amount. Prefer total for sale (Dr), amount for payment_out.
    const paymentOutsWithRemaining: PaymentOutWithRemaining[] = drVouchers.map((v) => {
      const t = (v.type || "").toLowerCase();
      const amount = (t === "sale" || t === "sale_service")
        ? Number(v.total ?? v.amount ?? 0)
        : v.type === "payment_out"
          ? getPaymentOutPartyLinkAmount(v)
          : Number(v.amount ?? v.total ?? 0);
      const remaining = v.type === "payment_out" || v.type === "direct_expense"
        ? getPaymentOutRemaining(v)
        : getVoucherRemaining(v);
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const allocatedTotal = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      const allocatedToOthers = (targetPurchaseId
        ? allocations.filter((a) => a.voucherId !== targetPurchaseId).reduce((s, a) => s + getAllocationTotal(a), 0)
        : allocatedTotal);
      return {
        id: v.id,
        amount,
        allocatedTotal,
        allocatedToOthers,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber,
        type: v.type,
      };
    });

    const journalDrRows: PaymentOutWithRemaining[] = journalDrVouchers.map((v) => {
      const partyAmount = getJournalPartyAmount(v, partyIdStr)!;
      const allocations = (v.allocations as { voucherId?: string; amount?: number; linkedAccountId?: string }[] | undefined) || [];
      const forParty = allocations.filter((a: any) => String(a?.linkedAccountId ?? "") === partyIdStr || (!a.linkedAccountId && partyAmount.debit > 0));
      const allocatedTotal = forParty.reduce((s, a) => s + getAllocationTotal(a), 0);
      const allocatedToOthers = (targetPurchaseId
        ? forParty.filter((a) => a.voucherId !== targetPurchaseId).reduce((s, a) => s + getAllocationTotal(a), 0)
        : allocatedTotal);
      const remaining = Math.max(0, partyAmount.total - allocatedTotal);
      return {
        id: v.id,
        amount: partyAmount.total,
        allocatedTotal,
        allocatedToOthers,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber ?? (v as any).voucher_number,
        type: "journal",
      };
    });

    const icDrVouchers = (vouchers as any[]).filter((v) => {
      if (v.type !== "inter_company") return false;
      const amt = getInterCompanyEntityBillWiseAmount(v, partyIdStr, "party");
      return !!amt && amt.debit > 0;
    });
    const icDrRows: PaymentOutWithRemaining[] = icDrVouchers.map((v) => {
      const partyAmount = getInterCompanyEntityBillWiseAmount(v, partyIdStr, "party")!;
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const allocatedTotal = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      const allocatedToOthers = targetPurchaseId
        ? allocations.filter((a) => a.voucherId !== targetPurchaseId).reduce((s, a) => s + getAllocationTotal(a), 0)
        : allocatedTotal;
      const remaining = Math.max(0, partyAmount.total - allocatedTotal);
      return {
        id: v.id,
        amount: partyAmount.total,
        allocatedTotal,
        allocatedToOthers,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber ?? (v as any).voucher_number,
        type: "inter_company",
      };
    });

    const allDrRows = [...paymentOutsWithRemaining, ...journalDrRows, ...icDrRows];

    // Show only if linkable (remaining > 0) OR already linked to this purchase (so user can unlink)
    const filtered = allDrRows.filter((row) => {
      if (row.remaining > 0) return true;
      if (!targetPurchaseId) return true;
      const v = [...drVouchers, ...journalDrVouchers, ...icDrVouchers].find((x) => x.id === row.id);
      if (!v) return false;
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const toCurrent = allocations.find((a) => a.voucherId === targetPurchaseId);
      return toCurrent != null && getAllocationTotal(toCurrent) > 0;
    });

    filtered.sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });

    return { paymentOutsWithRemaining: filtered, purchaseOutstanding };
  }, [partyId, targetPurchaseId, vouchers]);
}

/** Mode for LinkAdvancesToVoucherDialog: sale = Link to Cr, purchase = Link to Dr. */
export type AdvancesLinkableMode = "sale" | "purchase";

/**
 * Count of rows shown in LinkAdvancesToVoucherDialog (OB row + base list). Use in Sale/Purchase forms so displayed count matches popup.
 */
export function useAdvancesLinkableCount(
  mode: AdvancesLinkableMode,
  partyId: string | null | undefined,
  targetVoucherId: string | null | undefined,
  vouchers: any[],
  partyOpeningBalance: number
): number {
  const sale = useAdvancesForSale(mode === "sale" ? partyId : null, mode === "sale" ? targetVoucherId : null, vouchers);
  const purchase = useAdvancesForPurchase(mode === "purchase" ? partyId : null, mode === "purchase" ? targetVoucherId : null, vouchers);
  const baseList = mode === "sale" ? sale.paymentInsWithRemaining : purchase.paymentOutsWithRemaining;

  const obCount = useMemo(() => {
    const partyOB = Number(partyOpeningBalance) || 0;
    const showOBInSale = partyOB < 0;
    const showOBInPurchase = partyOB > 0;
    const obAmount = Math.abs(partyOB);
    const targetPartyIdStr = String(partyId ?? "");
    const totalConsumedFromOBByBillwise = (vouchers as any[]).reduce((sum, v) => {
      if (v.type !== "sale" && v.type !== "sale_service" && v.type !== "purchase" && v.type !== "purchase_service") return sum;
      if (String((v as any).partyId ?? "") !== targetPartyIdStr) return sum;
      return sum + (Number((v as any).openingBalanceAllocated) || 0);
    }, 0);
    // Dr OB consumed by Payment In; Cr OB by Payment.
    const payTypesOB = partyOB > 0 ? ["payment_in", "direct_income"] : ["payment_out", "direct_expense"];
    const totalConsumedFromOBByPayments = (vouchers as any[]).reduce((sum, v) => {
      if (!payTypesOB.includes(v.type) || String((v as any).partyId ?? "") !== targetPartyIdStr) return sum;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      const toOB = allocs.filter((a) => a.voucherId === OPENING_BALANCE_VOUCHER_ID).reduce((s, a) => s + getAllocationTotal(a), 0);
      return sum + toOB;
    }, 0);
    const totalConsumedFromOB = totalConsumedFromOBByBillwise + totalConsumedFromOBByPayments;
    const obOutstanding = Math.max(0, obAmount - totalConsumedFromOB);
    const targetVoucher = (vouchers as any[]).find((v) => v.id === targetVoucherId);
    const obAllocatedToTarget = Number(targetVoucher?.openingBalanceAllocated) || 0;
    const showOBRow = (mode === "sale" && showOBInSale) || (mode === "purchase" && showOBInPurchase);
    return showOBRow && obAmount > 0 && (obOutstanding > 0 || obAllocatedToTarget > 0) ? 1 : 0;
  }, [mode, partyId, targetVoucherId, vouchers, partyOpeningBalance]);

  return obCount + (baseList?.length ?? 0);
}

/**
 * Count of From rows for tax/TDS legs in LinkAdvancesToVoucherDialog
 * (payment/journal with that taxAccountId and linkable remaining).
 */
export function countTaxAccountLinkableSources(
  vouchers: any[] | null | undefined,
  taxAccountId: string | null | undefined,
  targetVoucherId?: string | null
): number {
  const id = String(taxAccountId ?? "").trim();
  if (!id || !vouchers?.length) return 0;
  const targetId = String(targetVoucherId ?? "");
  let count = 0;
  for (const v of vouchers as any[]) {
    if (
      v.type === "payment_out" ||
      v.type === "direct_expense" ||
      v.type === "payment_in" ||
      v.type === "direct_income"
    ) {
      if (String(v.taxAccountId ?? "") !== id) continue;
      const remaining =
        v.type === "payment_out" || v.type === "direct_expense"
          ? getPaymentOutRemaining(v)
          : getPaymentInRemaining(v);
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const toTarget = allocations
        .filter((a) => String(a.voucherId) === targetId)
        .reduce((s, a) => s + getTaxFromAllocation(a) + getNetFromAllocation(a), 0);
      if (remaining + toTarget <= 0 && toTarget <= 0) continue;
      count += 1;
      continue;
    }
    if (v.type === "journal" && v.subType !== "add_salary") {
      const dr = getJournalTaxDrAmount(v, id);
      if (dr == null) continue;
      const remaining = getJournalRemainingForTax(v, id);
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const toTarget = allocations
        .filter((a) => String(a.voucherId) === targetId)
        .reduce((s, a) => s + getTaxFromAllocation(a) + getNetFromAllocation(a), 0);
      if (remaining + toTarget <= 0 && toTarget <= 0) continue;
      count += 1;
    }
  }
  return count;
}

/** Tax / TDS link-tab count — matches Link payment to tax/TDS popup From list. */
export function useTaxAccountLinkableCount(
  taxAccountId: string | null | undefined,
  targetVoucherId: string | null | undefined,
  vouchers: any[]
): number {
  return useMemo(
    () => countTaxAccountLinkableSources(vouchers, taxAccountId, targetVoucherId),
    [vouchers, taxAccountId, targetVoucherId]
  );
}

/**
 * Payment_outs for same accountId (for Payment In linking to Payment - e.g. refunds).
 */
export function usePaymentOutsByAccount(
  accountId: string | null | undefined,
  vouchers: any[]
) {
  return useMemo(() => {
    if (!accountId || !vouchers?.length) {
      return [] as PaymentOutWithRemaining[];
    }

    const accountIdStr = String(accountId);
    const paymentOutVouchers = vouchers.filter(
      (v) => (v.type === "payment_out" || v.type === "direct_expense") && String(v.accountId ?? "") === accountIdStr
    );

    return paymentOutVouchers.map((v) => {
      const amount = getPaymentOutPartyLinkAmount(v);
      const remaining = getPaymentOutRemaining(v);
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const allocatedTotal = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      return {
        id: v.id,
        amount,
        allocatedTotal,
        allocatedToOthers: allocatedTotal,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber,
        type: v.type,
      };
    }).sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });
  }, [accountId, vouchers]);
}

/**
 * Payment_ins for same accountId (for Payment linking to Payment In - within same account).
 */
export function usePaymentInsByAccount(
  accountId: string | null | undefined,
  partyId: string | null | undefined,
  currentPaymentOutId: string | null | undefined,
  vouchers: any[]
) {
  return useMemo(() => {
    if (!accountId || !vouchers?.length) {
      return [] as PaymentInWithRemaining[];
    }

    const accountIdStr = String(accountId);
    const paymentInVouchers = vouchers.filter(
      (v) =>
        (v.type === "payment_in" || v.type === "direct_income") &&
        String(v.accountId ?? "") === accountIdStr &&
        (currentPaymentOutId == null || v.id !== currentPaymentOutId)
    );

    return paymentInVouchers.map((v) => {
      const amount = Number(v.amount ?? v.total ?? 0);
      const remaining = getPaymentInRemaining(v);
      const allocations = (v.allocations as Allocation[] | undefined) || [];
      const allocatedTotal = allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
      return {
        id: v.id,
        amount,
        allocatedTotal,
        allocatedToOthers: allocatedTotal,
        remaining,
        date: v.date,
        voucherNumber: v.voucherNumber,
        type: v.type,
      };
    }).filter((p) => p.remaining > 0).sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });
  }, [accountId, partyId, currentPaymentOutId, vouchers]);
}
