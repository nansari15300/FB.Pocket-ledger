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
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useFyLinkMissingHints } from "@/hooks/useFyLinkMissingHints";
import { FyLinkLoadMissingPrompt } from "@/components/fyPagination/FyLinkLoadMissingPrompt";
import { useDate } from "@/hooks/useDate";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";
import { RotateCcw, Link2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { Allocation } from "@/lib/payment-allocation-utils";
import {
  validateAllocations as validateAllocationsUtil,
  autoLink as autoLinkUtil,
  getAllocatedByVoucherId,
  getAllocatedByVoucherIdFromPaymentOuts,
  getAllocationTotal,
  getTdsLegAllocatedByTargetId,
  buildBillWiseEntityTxnId,
  allocationEntityTxnId,
  getPaymentOutPartyLinkAmount,
  getJournalPartyBillWiseAmountFromEntries,
  OPENING_BALANCE_VOUCHER_ID,
} from "@/lib/payment-allocation-utils";
import { getSalePurchasePartyLinkTarget } from "@/lib/tdsVoucher";

/** Separate TDS rows are hidden: one net row (total - TDS) per Sale/Purchase. Existing TDS-leg allocations are kept untouched (see preservedTds). */
const SHOW_TDS_LEG_ROWS = false;
const isTdsLegEntityId = (id: string | null | undefined): boolean => String(id ?? "").includes("::tds::");
const isTdsLegAllocation = (a: Allocation): boolean => isTdsLegEntityId(allocationEntityTxnId(a));
const roundMoney2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";

const safeToDate = (date: unknown): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof (date as { toDate?: () => Date })?.toDate === "function")
    return (date as { toDate: () => Date }).toDate();
  const parsed = new Date(date as string | number);
  return isNaN(parsed.getTime()) ? null : parsed;
};

function isEntryBasedBillWiseVoucher(v: any): boolean {
  return v?.type === "journal" || v?.type === "adjustment";
}

function entryBasedBillWiseRowType(v: any, side: "Dr" | "Cr"): string {
  const prefix = v?.type === "adjustment" ? "Adjustment" : "Journal";
  return `${prefix} (${side})`;
}

export type LinkPaymentVariant = "payment_in" | "payment_out";

export interface LinkPaymentToTxnsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: LinkPaymentVariant;
  partyId: string | null;
  partyName: string;
  /** For payment_in: received amount; for payment_out: paid amount */
  receivedAmount: number;
  existingAllocations?: Allocation[];
  paymentInId?: string | null;
  paymentOutId?: string | null;
  /** When variant=payment_in: optionally link to Payment (same account). */
  accountId?: string | null;
  /** When variant=payment_in: show Payment In voucher details at top. */
  paymentInVoucherNumber?: string | null;
  paymentInDate?: unknown;
  /** When variant=payment_out: show Payment voucher details at top. */
  paymentOutVoucherNumber?: string | null;
  paymentOutDate?: unknown;
  /** Party opening balance, signed: Dr > 0 (show in Payment In), Cr < 0 (show in Payment). */
  partyOpeningBalance?: number;
  /** Bill-wise ledger: opening row par jo remaining linkable hai — Journal link dialog me OB row ke liye. */
  partyOpeningBalanceOutstanding?: number;
  /** Ledger books opening signed (Dr + / Cr −) — Journal link me master lookup miss par fallback. */
  ledgerBooksOpeningBalanceSigned?: number;
  /** When set (e.g. from Journal form), use this as dialog title instead of "Link Payment In/Out to Txns". */
  dialogTitle?: string;
  /** When true (Journal link dialog): Other Linked = sum from opposite-side vouchers only. Dr rows ← Cr sources; Cr rows ← Dr sources. */
  isJournalLinkDialog?: boolean;
  /** Called with allocations and the amount (received or paid). */
  /** 3rd arg: TDS-leg links the user unticked (all) and the ones that existed only as an orphan reverse mirror. */
  onDone: (
    allocations: Allocation[],
    amount: number,
    info?: { removedTdsEntityIds: string[]; orphanTdsEntityIds: string[] }
  ) => void;
}

export function LinkPaymentToTxnsDialog({
  isOpen,
  onOpenChange,
  variant = "payment_in",
  partyId,
  partyName,
  receivedAmount,
  existingAllocations = [],
  paymentInId,
  paymentOutId,
  accountId,
  paymentInVoucherNumber,
  paymentInDate,
  paymentOutVoucherNumber,
  paymentOutDate,
  partyOpeningBalance = 0,
  partyOpeningBalanceOutstanding,
  ledgerBooksOpeningBalanceSigned,
  dialogTitle: dialogTitleOverride,
  isJournalLinkDialog = false,
  onDone,
}: LinkPaymentToTxnsDialogProps) {
  const { vouchers, vouchersAll, processedPartiesForSelection, processedParties, processedStaff } = useFyScopedVouchers();
  const vouchersForAllocations = (vouchersAll && vouchersAll.length > 0) ? vouchersAll : (vouchers || []);
  const {
    hints: fyLinkHints,
    loading: fyLinkLoading,
    scanForParty: scanFyLinkMissing,
    loadHintFy: loadFyLinkHint,
    clearHints: clearFyLinkHints,
  } = useFyLinkMissingHints();
  const [fyPromptOpen, setFyPromptOpen] = React.useState(false);
  const fyLinkScannedRef = React.useRef(false);
  const { formatDate, formatDateBS, formatCurrency, dateSystem } = useDate();
  const isMobile = useIsMobile();
  const effectiveAccountId = accountId ?? null;
  const accountIdStr = effectiveAccountId ? String(effectiveAccountId) : "";


  const isOut = variant === "payment_out";
  // Prevent self-link: when Journal opens this dialog, same voucher must never appear in From list.
  const currentVoucherIdStr = String(paymentInId ?? paymentOutId ?? "");

  // Journal link: partyId = jis account ki line link ho rahi — usi ka books opening (Dr + / Cr −) master se dhoondo.
  const accountBooksOpeningSigned = useMemo(() => {
    if (!partyId) return 0;
    const id = String(partyId);
    const asNum = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const ledger = asNum(ledgerBooksOpeningBalanceSigned);
    if (Math.abs(ledger) > 1e-6) return ledger;
    const prop = asNum(partyOpeningBalance);
    if (Math.abs(prop) > 1e-6) return prop;
    const party =
      (processedPartiesForSelection || []).find((p) => String(p.id) === id) ||
      (processedParties || []).find((p) => String(p.id) === id);
    if (party) return asNum(party.openingBalance);
    const staffRow = (processedStaff || []).find((s) => String(s.id) === id);
    if (staffRow) return asNum(staffRow.openingBalance);
    return 0;
  }, [
    partyId,
    ledgerBooksOpeningBalanceSigned,
    partyOpeningBalance,
    processedPartiesForSelection,
    processedParties,
    processedStaff,
  ]);

  const partyOB = isJournalLinkDialog
    ? accountBooksOpeningSigned
    : Number.isFinite(Number(partyOpeningBalance))
      ? Number(partyOpeningBalance)
      : 0;

  // Total consumed from Opening Balance: (1) Payment In/Out + (2) Sale/Purchase openingBalanceAllocated + (3) Journal allocations to OB (same party). Use vouchersForAllocations so OB Dr/Cr both track correctly.
  const totalConsumedFromOB = useMemo(() => {
    if (!partyId || !vouchersForAllocations?.length) return 0;
    const partyIdStr = String(partyId);
    const voucherTouchesParty = (v: any) =>
      String((v as any)?.partyId ?? "") === partyIdStr ||
      (Array.isArray((v as any)?.entries) && (v as any).entries.some((e: any) => String(e?.accountId ?? "") === partyIdStr));
    let fromPayments = 0;
    // Journal link: Dr OB ← payment_in; Cr OB ← payment_out (variant se independent, Dr→Cr jaisa mirror).
    const payType = isJournalLinkDialog
      ? partyOB > 0
        ? ["payment_in", "direct_income"]
        : partyOB < 0
          ? ["payment_out", "direct_expense"]
          : isOut
            ? ["payment_out", "direct_expense"]
            : ["payment_in", "direct_income"]
      : isOut
        ? ["payment_out", "direct_expense"]
        : ["payment_in", "direct_income"];
    (vouchersForAllocations as any[]).forEach((v) => {
      if (!payType.includes(v.type) || String((v as any).partyId ?? "") !== partyIdStr) return;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      allocs.forEach((a) => {
        if (String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID) fromPayments += getAllocationTotal(a);
      });
    });
    const fromBillwise = (vouchersForAllocations as any[]).reduce((sum, v) => {
      if (v.type !== "sale" && v.type !== "sale_service" && v.type !== "purchase" && v.type !== "purchase_service") return sum;
      if (String((v as any).partyId ?? "") !== partyIdStr) return sum;
      return sum + (Number((v as any).openingBalanceAllocated) || 0);
    }, 0);
    const fromJournals = (vouchersForAllocations as any[]).reduce((sum, v) => {
      if (!isEntryBasedBillWiseVoucher(v) || !voucherTouchesParty(v)) return sum;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      return sum + allocs
        .filter((a) => String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID && (!(a as any).linkedAccountId || String((a as any).linkedAccountId) === partyIdStr))
        .reduce((s, a) => s + getAllocationTotal(a), 0);
    }, 0);
    return fromPayments + fromBillwise + fromJournals;
  }, [partyId, isOut, vouchersForAllocations, isJournalLinkDialog, partyOB]);

  const showOBInPaymentIn = partyOB > 0;
  const showOBInPaymentOut = partyOB < 0;
  const obAmount = partyOB > 0 ? partyOB : Math.abs(partyOB);
  const obOutstandingIn = Math.max(0, obAmount - totalConsumedFromOB);
  const obOutstanding = isOut ? (showOBInPaymentOut ? obOutstandingIn : 0) : (showOBInPaymentIn ? obOutstandingIn : 0);
  // Current voucher's allocation to OB — exclude from "Other Linked" so edit mode doesn't double-count.
  const currentVoucherAllocToOB = useMemo(() => {
    if (!currentVoucherIdStr || !vouchers?.length) return 0;
    const v = (vouchers as any[]).find((x: any) => String(x?.id ?? "") === currentVoucherIdStr);
    if (!v) return 0;
    const allocs = (v.allocations as Allocation[] | undefined) || [];
    return allocs
      .filter((a) => a.voucherId === OPENING_BALANCE_VOUCHER_ID)
      .reduce((s, a) => s + getAllocationTotal(a), 0);
  }, [currentVoucherIdStr, vouchers]);
  const obAllocatedToOthers = Math.max(0, totalConsumedFromOB - currentVoucherAllocToOB);
  // Remaining linkable: bill-wise prop > 0 ho to wahi, warna isi account ke consumed se calc.
  const effectiveObRemaining =
    typeof partyOpeningBalanceOutstanding === "number" && partyOpeningBalanceOutstanding > 0
      ? partyOpeningBalanceOutstanding
      : obOutstandingIn;
  const billWiseObRemaining =
    effectiveObRemaining > 0 ? effectiveObRemaining : null;
  const openingBalanceRowOutstanding = (_side: "payment_in" | "payment_out") => {
    if (effectiveObRemaining > 0) {
      return Math.max(0, effectiveObRemaining + currentVoucherAllocToOB);
    }
    return Math.max(0, obAmount - obAllocatedToOthers);
  };
  /**
   * Book Opening / OB: sirf jab linkable > 0, ya current voucher pe pehle se link ho
   * (edit me unlink ke liye). Linkable 0 + koi current link nahi → list me mat dikhao.
   */
  const shouldIncludeOpeningBalanceRow = (
    side: "payment_in" | "payment_out",
    hasExisting: (id: string) => boolean
  ) => {
    if (hasExisting(OPENING_BALANCE_VOUCHER_ID)) return true;
    if (openingBalanceRowOutstanding(side) <= 0) return false;
    if (isJournalLinkDialog) {
      // Cr OB → Cr list (payment_out); Dr OB → Dr list (payment_in)
      if (side === "payment_out") return partyOB < 0 || partyOB === 0;
      return partyOB > 0 || partyOB === 0;
    }
    const showSide = side === "payment_out" ? showOBInPaymentOut : showOBInPaymentIn;
    return showSide;
  };
  // Amount column: books opening gross; linkable alag column.
  const openingBalanceGrossTotal = (_side: "payment_in" | "payment_out") => {
    if (obAmount > 0) return obAmount;
    const outstanding = openingBalanceRowOutstanding(_side);
    return Math.max(obAmount, outstanding + obAllocatedToOthers, outstanding);
  };
  const openingBalanceRowLabel = isJournalLinkDialog ? ("Book Opening" as const) : ("Opening Balance" as const);

  // TDS-leg allocations by other sources (entityTxnId = voucherId::tds::accountId); current voucher excluded.
  const tdsLegOthers = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of (vouchersForAllocations as any[]) || []) {
      if (!x?.id || String(x.id) === currentVoucherIdStr) continue;
      for (const a of (Array.isArray(x.allocations) ? x.allocations : []) as Allocation[]) {
        const et = allocationEntityTxnId(a);
        if (!isTdsLegEntityId(et)) continue;
        // Reverse mirror on the Sale/Purchase itself (entity belongs to x.id, voucherId = source) is not an "other" link.
        if (et.startsWith(`${String(x.id)}::`)) continue;
        const amt = getAllocationTotal(a);
        if (amt > 0) m.set(et, (m.get(et) ?? 0) + amt);
      }
    }
    return m;
  }, [vouchersForAllocations, currentVoucherIdStr]);

  // Voucher numbers of the other sources holding each TDS leg (shown as "Linked by ..." on the TDS row).
  const tdsLegOtherNos = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const x of (vouchersForAllocations as any[]) || []) {
      if (!x?.id || String(x.id) === currentVoucherIdStr) continue;
      for (const a of (Array.isArray(x.allocations) ? x.allocations : []) as Allocation[]) {
        const et = allocationEntityTxnId(a);
        if (!isTdsLegEntityId(et) || et.startsWith(`${String(x.id)}::`) || getAllocationTotal(a) <= 0) continue;
        const no = String(x.voucherNumber ?? x.voucher_number ?? x.id);
        const list = m.get(et) ?? [];
        if (!list.includes(no)) list.push(no);
        m.set(et, list);
      }
    }
    return m;
  }, [vouchersForAllocations, currentVoucherIdStr]);

  /** One linkable row per TDS account of a Sale/Purchase (same voucher no.; id = TDS-leg entityTxnId). */
  const buildTdsLegRows = (v: any, label: "Sale TDS" | "Purchase TDS") => {
    if (!SHOW_TDS_LEG_ROWS) return [];
    const byAcct = new Map<string, number>();
    for (const li of (Array.isArray(v?.lineItems) ? v.lineItems : []) as any[]) {
      const acct = String(li?.tdsAccountId ?? "").trim();
      const amt = roundMoney2(Number(li?.tdsAmount) || 0);
      if (acct && amt > 0) byAcct.set(acct, roundMoney2((byAcct.get(acct) ?? 0) + amt));
    }
    return Array.from(byAcct.entries()).map(([acct, amt]) => {
      const id = buildBillWiseEntityTxnId({ voucherId: String(v.id), entityKind: "tds", accountId: acct });
      const others = tdsLegOthers.get(id) ?? 0;
      return {
        id,
        date: v.date,
        type: label,
        refNo: v.invoiceNumber ?? v.voucherNumber ?? "",
        total: amt,
        outstanding: Math.max(0, amt - others),
        allocatedToOthers: others,
        isTdsLeg: true as const,
        linkedByNos: tdsLegOtherNos.get(id) ?? [],
        refVoucherId: String(v.id),
        tdsAccountId: acct,
      };
    });
  };

  // Payment In links to Sales (same party) and Payments (contra). Show Opening Balance when OB is Dr (> 0).
  const combinedInList = useMemo(() => {
    if (variant !== "payment_in" || !vouchers?.length || !partyId) return [];
    // Match party by explicit partyId OR by journal entry account id so manual journals become linkable.
    const voucherTouchesParty = (v: any) =>
      String((v as any)?.partyId ?? "") === String(partyId) ||
      (Array.isArray((v as any)?.entries) &&
        (v as any).entries.some((e: any) => String(e?.accountId ?? "") === String(partyId)));
    // Reusable guard so current voucher (edit context) never becomes a source row for itself.
    const isCurrentVoucher = (v: any) => currentVoucherIdStr && String((v as any)?.id ?? "") === currentVoucherIdStr;
    const paymentInVouchers = (vouchersForAllocations as any[]).filter(
      (v) => (v.type === "payment_in" || v.type === "direct_income") && !isCurrentVoucher(v)
    );
    const allocatedByPaymentIns = getAllocatedByVoucherId(paymentInVouchers);
    const allocatedByBillWiseVouchers = (() => {
      const m = new Map<string, number>();
      for (const v of vouchersForAllocations as any[]) {
        if (isCurrentVoucher(v)) continue;
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
          const key = String(a.voucherId ?? "");
          if (!key) continue;
          m.set(key, (m.get(key) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    // Party leg link target = total - TDS; TDS-leg links are settled separately and must not consume the party leg.
    const tdsLegAllocatedTo = getTdsLegAllocatedByTargetId(
      (vouchersForAllocations as any[]).filter((x: any) => String(x?.id ?? "") !== currentVoucherIdStr)
    );
    const totalAllocatedTo = (vid: string) =>
      Math.max(
        0,
        (allocatedByPaymentIns.get(String(vid)) ?? 0) +
          (allocatedByBillWiseVouchers.get(String(vid)) ?? 0) -
          (tdsLegAllocatedTo.get(String(vid)) ?? 0)
      );
    const getFreshTarget = (v: any) => (vouchersForAllocations as any[]).find((x: any) => String(x?.id ?? "") === String(v?.id ?? "")) ?? v;
    // Other Linked = target ke allocations ka sum (OB, JRNL, Sale, Pur, etc. sab) — multi-linked amount sahi aaye.
    const getAllocatedToOthersFromTarget = (targetVoucher: any, vid: string): number => {
      const fromTarget = (targetVoucher?.allocations as Allocation[] | undefined) || [];
      const targetSum = fromTarget.reduce((sum, a) => {
        const srcId = String(a.voucherId ?? "");
        if (!srcId || srcId === currentVoucherIdStr) return sum;
        if (isTdsLegAllocation(a)) return sum;
        if (partyId && (a as any).linkedAccountId && String((a as any).linkedAccountId) !== String(partyId)) return sum;
        return sum + getAllocationTotal(a);
      }, 0);
      const sourceSum = totalAllocatedTo(vid);
      const obInAllocations = fromTarget
        .filter((a) => String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID)
        .reduce((s, a) => s + getAllocationTotal(a), 0);
      const targetObAlloc = Math.max(0, (Number(targetVoucher?.openingBalanceAllocated) || 0) - obInAllocations);
      return Math.max(targetSum, sourceSum) + targetObAlloc;
    };
    const hasExistingAlloc = (id: string) =>
      existingAllocations.some((a) =>
        getAllocationTotal(a) > 0 &&
        (isTdsLegEntityId(id) ? allocationEntityTxnId(a) === id : a.voucherId === id && !isTdsLegAllocation(a))
      );
    const salesForParty = (vouchers as any[]).filter(
      (v) =>
        !isCurrentVoucher(v) &&
        (v.type === "sale" || v.type === "sale_service") &&
        String((v as any).partyId ?? "") === String(partyId)
    );
    const sales = salesForParty.flatMap((v) => {
      // Main row = taxable + tax (total - TDS); TDS (if any) is a separate grouped row.
      const total = getSalePurchasePartyLinkTarget(v);
      const allocatedToOthers = getAllocatedToOthersFromTarget(getFreshTarget(v), v.id);
      // Linkable = Amount - Other Linked; table shows (outstanding - linked) where linked includes Current Link
      const outstanding = Math.max(0, total - allocatedToOthers);
      const tdsRows = buildTdsLegRows(v, "Sale TDS");
      const mainRow = {
        id: v.id,
        date: v.date,
        type: "Sale" as const,
        refNo: v.invoiceNumber ?? v.voucherNumber ?? "—",
        total,
        outstanding,
        allocatedToOthers,
        groupHasTds: tdsRows.length > 0,
      };
      return [mainRow, ...tdsRows];
    });
    // Show only linkable (outstanding > 0) or already selected rows.
    // Vouchers with TDS always show both rows (main + TDS) so linked-elsewhere rows can be re-linked; others only if linkable/selected.
    const salesFiltered = sales.filter(
      (s) => s.outstanding > 0 || hasExistingAlloc(s.id) || (s as any).isTdsLeg === true || (s as any).groupHasTds === true
    );
    const paymentOutsForParty = (vouchers as any[]).filter(
      (v) =>
        !isCurrentVoucher(v) &&
        (v.type === "payment_out" || v.type === "direct_expense") &&
        String((v as any).partyId ?? "") === String(partyId)
    );
    const paymentOuts = paymentOutsForParty.map((v) => {
      const total = getPaymentOutPartyLinkAmount(v);
      const allocatedToOthers = getAllocatedToOthersFromTarget(getFreshTarget(v), v.id);
      const outstanding = Math.max(0, total - allocatedToOthers);
      return {
        id: v.id,
        date: v.date,
        type: "Payment" as const,
        refNo: (v as any).voucherNumber ?? "—",
        total,
        outstanding,
        allocatedToOthers,
      };
    });
    const paymentOutsFiltered = paymentOuts.filter((p) => p.outstanding > 0 || hasExistingAlloc(p.id));
    // Payment In should link against Dr-side journals for the same party.
    const journalDrRows = (vouchers as any[])
      .filter((v) => {
        if (isCurrentVoucher(v) || !isEntryBasedBillWiseVoucher(v)) return false;
        if (!isJournalLinkDialog) return voucherTouchesParty(v);
        // Journal bill-wise: sirf jahan is party ki Dr entry ho — Cr-only ya counterparty lines exclude.
        const partyAmount = getJournalPartyBillWiseAmountFromEntries(v, String(partyId));
        return !!partyAmount && partyAmount.debit > 0;
      })
      .map((v) => {
        const partyAmount = getJournalPartyBillWiseAmountFromEntries(v, String(partyId));
        if (!partyAmount || partyAmount.debit <= 0) return null;
        const allocatedToOthers = getAllocatedToOthersFromTarget(getFreshTarget(v), v.id);
        const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
        return {
          id: v.id,
          date: v.date,
          type: entryBasedBillWiseRowType(v, "Dr") as "Journal (Dr)",
          refNo: (v as any).voucherNumber ?? "—",
          total: partyAmount.total,
          outstanding,
          allocatedToOthers,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);
    const journalsDrFiltered = journalDrRows.filter((j) => j.outstanding > 0 || hasExistingAlloc(j.id));
    // Cr source (Payment In / Journal Cr) → Dr IC vouchers same party.
    const icDrRows = (vouchers as any[])
      .filter((v) => !isCurrentVoucher(v) && v.type === "inter_company")
      .map((v) => {
        const partyAmount = getInterCompanyEntityBillWiseAmount(v, String(partyId), "party");
        if (!partyAmount || partyAmount.debit <= 0) return null;
        const allocatedToOthers = getAllocatedToOthersFromTarget(getFreshTarget(v), v.id);
        const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
        return {
          id: v.id,
          date: v.date,
          type: "Inter Company (Dr)" as const,
          refNo: (v as any).voucherNumber ?? "—",
          total: partyAmount.total,
          outstanding,
          allocatedToOthers,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);
    const icDrFiltered = icDrRows.filter((j) => j.outstanding > 0 || hasExistingAlloc(j.id));
    const byDate = (a: { date: unknown }, b: { date: unknown }) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    };
    salesFiltered.sort(byDate);
    paymentOutsFiltered.sort(byDate);
    const ob = shouldIncludeOpeningBalanceRow("payment_in", hasExistingAlloc) ? [{
      id: OPENING_BALANCE_VOUCHER_ID,
      date: null,
      type: openingBalanceRowLabel,
      refNo: "—",
      total: openingBalanceGrossTotal("payment_in"),
      outstanding: openingBalanceRowOutstanding("payment_in"),
      allocatedToOthers: obAllocatedToOthers,
    }] : [];
    const combined = [...ob, ...salesFiltered, ...paymentOutsFiltered, ...journalsDrFiltered, ...icDrFiltered];
    combined.sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });
    return combined;
  }, [variant, effectiveAccountId, accountIdStr, partyId, vouchers, vouchersForAllocations, partyOB, showOBInPaymentIn, obOutstandingIn, totalConsumedFromOB, obAllocatedToOthers, obAmount, existingAllocations, currentVoucherIdStr, isJournalLinkDialog, partyOpeningBalanceOutstanding, currentVoucherAllocToOB, billWiseObRemaining]);

  // Payment links to Purchases (same party) and Payment Ins (contra). Show Opening Balance when OB is Cr (< 0).
  const combinedOutList = useMemo(() => {
    if (variant !== "payment_out" || !vouchers?.length || !partyId) return [];
    // Match party by explicit partyId OR by journal entry account id so manual journals become linkable.
    const voucherTouchesParty = (v: any) =>
      String((v as any)?.partyId ?? "") === String(partyId) ||
      (Array.isArray((v as any)?.entries) &&
        (v as any).entries.some((e: any) => String(e?.accountId ?? "") === String(partyId)));
    // Reusable guard so current voucher (edit context) never becomes a source row for itself.
    const isCurrentVoucher = (v: any) => currentVoucherIdStr && String((v as any)?.id ?? "") === currentVoucherIdStr;
    const hasExistingAllocOut = (id: string) =>
      existingAllocations.some((a) =>
        getAllocationTotal(a) > 0 &&
        (isTdsLegEntityId(id) ? allocationEntityTxnId(a) === id : a.voucherId === id && !isTdsLegAllocation(a))
      );
    const paymentOutVouchers = (vouchersForAllocations as any[]).filter(
      (v) => (v.type === "payment_out" || v.type === "direct_expense") && !isCurrentVoucher(v)
    );
    const paymentInVouchersOut = (vouchersForAllocations as any[]).filter(
      (v) => (v.type === "payment_in" || v.type === "direct_income") && !isCurrentVoucher(v)
    );
    const allocatedByPaymentOuts = getAllocatedByVoucherIdFromPaymentOuts(paymentOutVouchers);
    const allocatedByPaymentInsOut = getAllocatedByVoucherId(paymentInVouchersOut);
    const allocatedByBillWiseVouchers = (() => {
      const m = new Map<string, number>();
      for (const v of vouchersForAllocations as any[]) {
        if (isCurrentVoucher(v)) continue;
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
          const key = String(a.voucherId ?? "");
          if (!key) continue;
          m.set(key, (m.get(key) ?? 0) + getAllocationTotal(a));
        }
      }
      return m;
    })();
    const tdsLegAllocatedToOut = getTdsLegAllocatedByTargetId(
      (vouchersForAllocations as any[]).filter((x: any) => String(x?.id ?? "") !== currentVoucherIdStr)
    );
    const totalAllocatedToOut = (vid: string) =>
      Math.max(
        0,
        (allocatedByPaymentOuts.get(String(vid)) ?? 0) +
          (allocatedByPaymentInsOut.get(String(vid)) ?? 0) +
          (allocatedByBillWiseVouchers.get(String(vid)) ?? 0) -
          (tdsLegAllocatedToOut.get(String(vid)) ?? 0)
      );
    const getFreshTargetOut = (v: any) => (vouchersForAllocations as any[]).find((x: any) => String(x?.id ?? "") === String(v?.id ?? "")) ?? v;
    // Other Linked = target ke allocations ka sum (OB, JRNL, Sale, Pur, etc. sab) — multi-linked amount sahi aaye.
    const getAllocatedToOthersFromTargetOut = (targetVoucher: any, vid: string): number => {
      const fromTarget = (targetVoucher?.allocations as Allocation[] | undefined) || [];
      const targetSum = fromTarget.reduce((sum, a) => {
        const srcId = String(a.voucherId ?? "");
        if (!srcId || srcId === currentVoucherIdStr) return sum;
        if (isTdsLegAllocation(a)) return sum;
        if (partyId && (a as any).linkedAccountId && String((a as any).linkedAccountId) !== String(partyId)) return sum;
        return sum + getAllocationTotal(a);
      }, 0);
      const sourceSum = totalAllocatedToOut(vid);
      const obInAllocations = fromTarget
        .filter((a) => String(a?.voucherId ?? "") === OPENING_BALANCE_VOUCHER_ID)
        .reduce((s, a) => s + getAllocationTotal(a), 0);
      const targetObAlloc = Math.max(0, (Number(targetVoucher?.openingBalanceAllocated) || 0) - obInAllocations);
      return Math.max(targetSum, sourceSum) + targetObAlloc;
    };
    const purchasesForParty = (vouchers as any[]).filter(
      (v) =>
        !isCurrentVoucher(v) &&
        (v.type === "purchase" || v.type === "purchase_service") &&
        String((v as any).partyId ?? "") === String(partyId)
    );
    const purchases = purchasesForParty.flatMap((v) => {
      // Main row = taxable + tax (total - TDS); TDS (if any) is a separate grouped row.
      const total = getSalePurchasePartyLinkTarget(v);
      const allocatedToOthers = getAllocatedToOthersFromTargetOut(getFreshTargetOut(v), v.id);
      const outstanding = Math.max(0, total - allocatedToOthers);
      const tdsRows = buildTdsLegRows(v, "Purchase TDS");
      const mainRow = {
        id: v.id,
        date: v.date,
        type: "Purchase" as const,
        refNo: (v as any).invoiceNumber ?? v.voucherNumber ?? "—",
        total,
        outstanding,
        allocatedToOthers,
        groupHasTds: tdsRows.length > 0,
      };
      return [mainRow, ...tdsRows];
    });
    // Show only linkable (outstanding > 0) or already selected rows.
    const purchasesFiltered = purchases.filter(
      (p) => p.outstanding > 0 || hasExistingAllocOut(p.id) || (p as any).isTdsLeg === true || (p as any).groupHasTds === true
    );
    const paymentInsForParty = (vouchers as any[]).filter(
      (v) =>
        !isCurrentVoucher(v) &&
        (v.type === "payment_in" || v.type === "direct_income") &&
        String((v as any).partyId ?? "") === String(partyId)
    );
    const paymentIns = paymentInsForParty.map((v) => {
      const total = Number((v as any).amount ?? (v as any).total ?? 0) || 0;
      const allocatedToOthers = getAllocatedToOthersFromTargetOut(getFreshTargetOut(v), v.id);
      const outstanding = Math.max(0, total - allocatedToOthers);
      return {
        id: v.id,
        date: v.date,
        type: "Receipt" as const,
        refNo: (v as any).voucherNumber ?? "—",
        total,
        outstanding,
        allocatedToOthers,
      };
    });
    const paymentInsFiltered = paymentIns.filter((p) => p.outstanding > 0 || hasExistingAllocOut(p.id));
    // Payment should link against Cr-side journals for the same party.
    const journalCrRows = (vouchers as any[])
      .filter((v) => {
        if (isCurrentVoucher(v) || !isEntryBasedBillWiseVoucher(v)) return false;
        if (!isJournalLinkDialog) return voucherTouchesParty(v);
        // Journal bill-wise: sirf jahan is party ki Cr entry ho — Dr-only ya counterparty lines exclude.
        const partyAmount = getJournalPartyBillWiseAmountFromEntries(v, String(partyId));
        return !!partyAmount && partyAmount.credit > 0;
      })
      .map((v) => {
        const partyAmount = getJournalPartyBillWiseAmountFromEntries(v, String(partyId));
        if (!partyAmount || partyAmount.credit <= 0) return null;
        const allocatedToOthers = getAllocatedToOthersFromTargetOut(getFreshTargetOut(v), v.id);
        const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
        return {
          id: v.id,
          date: v.date,
          type: entryBasedBillWiseRowType(v, "Cr") as "Journal (Cr)",
          refNo: (v as any).voucherNumber ?? "—",
          total: partyAmount.total,
          outstanding,
          allocatedToOthers,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);
    const journalsCrFiltered = journalCrRows.filter((j) => j.outstanding > 0 || hasExistingAllocOut(j.id));
    // Dr source (Payment / Journal Dr) → Cr IC vouchers same party.
    const icCrRows = (vouchers as any[])
      .filter((v) => !isCurrentVoucher(v) && v.type === "inter_company")
      .map((v) => {
        const partyAmount = getInterCompanyEntityBillWiseAmount(v, String(partyId), "party");
        if (!partyAmount || partyAmount.credit <= 0) return null;
        const allocatedToOthers = getAllocatedToOthersFromTargetOut(getFreshTargetOut(v), v.id);
        const outstanding = Math.max(0, partyAmount.total - allocatedToOthers);
        return {
          id: v.id,
          date: v.date,
          type: "Inter Company (Cr)" as const,
          refNo: (v as any).voucherNumber ?? "—",
          total: partyAmount.total,
          outstanding,
          allocatedToOthers,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);
    const icCrFiltered = icCrRows.filter((j) => j.outstanding > 0 || hasExistingAllocOut(j.id));
    const byDate = (a: { date: unknown }, b: { date: unknown }) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    };
    purchasesFiltered.sort(byDate);
    paymentInsFiltered.sort(byDate);
    const ob = shouldIncludeOpeningBalanceRow("payment_out", hasExistingAllocOut) ? [{
      id: OPENING_BALANCE_VOUCHER_ID,
      date: null,
      type: openingBalanceRowLabel,
      refNo: "—",
      total: openingBalanceGrossTotal("payment_out"),
      outstanding: openingBalanceRowOutstanding("payment_out"),
      allocatedToOthers: obAllocatedToOthers,
    }] : [];
    const combined = [...ob, ...purchasesFiltered, ...paymentInsFiltered, ...journalsCrFiltered, ...icCrFiltered];
    combined.sort((a, b) => {
      const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
      const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
      return dA - dB;
    });
    return combined;
  }, [variant, partyId, vouchers, vouchersForAllocations, partyOB, showOBInPaymentOut, obOutstandingIn, totalConsumedFromOB, obAllocatedToOthers, obAmount, existingAllocations, currentVoucherIdStr, isJournalLinkDialog, partyOpeningBalanceOutstanding, currentVoucherAllocToOB, billWiseObRemaining]);

  const targetList = isOut ? combinedOutList : combinedInList;

  const autoLink = useMemo(() => {
    const currentList = isOut ? combinedOutList : combinedInList;
    return (amount: number) => {
      // Auto Link fills main rows only; TDS rows are linked only when explicitly ticked/typed.
      const forAutoLink = currentList.filter((r: any) => !r.isTdsLeg).map((r) => ({
        id: r.id,
        total: r.total,
        allocated: r.total - r.outstanding,
      }));
      return autoLinkUtil(amount, forAutoLink);
    };
  }, [isOut, combinedOutList, combinedInList]);

  const validate = useMemo(() => {
    const currentList = isOut ? combinedOutList : combinedInList;
    return (allocations: Allocation[], amount: number) => {
      const outstandingMap = new Map<string, number>();
      currentList.forEach((r) => outstandingMap.set(r.id, r.outstanding));
      return validateAllocationsUtil(allocations, amount, outstandingMap);
    };
  }, [isOut, combinedOutList, combinedInList]);
  const paymentInDateFormatted = useMemo(() => {
    if (!paymentInDate) return "—";
    const d = safeToDate(paymentInDate);
    if (!d) return "—";
    if (dateSystem === "Both") return `${formatDateBS(d)} (${formatDate(d)})`;
    return dateSystem === "BS" ? formatDateBS(d) : formatDate(d);
  }, [paymentInDate, dateSystem, formatDate, formatDateBS]);
  const paymentOutDateFormatted = useMemo(() => {
    if (!paymentOutDate) return "—";
    const d = safeToDate(paymentOutDate);
    if (!d) return "—";
    if (dateSystem === "Both") return `${formatDateBS(d)} (${formatDate(d)})`;
    return dateSystem === "BS" ? formatDateBS(d) : formatDate(d);
  }, [paymentOutDate, dateSystem, formatDate, formatDateBS]);

  const [received, setReceived] = useState(receivedAmount);
  const [linkedAmounts, setLinkedAmounts] = useState<Record<string, number>>({});
  /** Existing TDS-leg allocations (entityTxnId ::tds::) are not shown; they are passed through unchanged on Done. */
  const [preservedTds, setPreservedTds] = useState<Allocation[]>([]);
  const vouchersRef = React.useRef<any[]>([]);
  const initialTdsKeysRef = React.useRef<Set<string>>(new Set());
  const orphanTdsKeysRef = React.useRef<Set<string>>(new Set());
  vouchersRef.current = (vouchersForAllocations as any[]) || [];

  useEffect(() => {
    setReceived(receivedAmount);
  }, [receivedAmount, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<string, number> = {};
    const preserved: Allocation[] = [];
    orphanTdsKeysRef.current = new Set();
    for (const a of existingAllocations) {
      if (!a.voucherId) continue;
      const total = getAllocationTotal(a);
      if (total <= 0) continue;
      const et = allocationEntityTxnId(a);
      // TDS-leg allocation -> its own grouped row; everything else -> main row (as before).
      if (isTdsLegEntityId(et) && !SHOW_TDS_LEG_ROWS) {
        preserved.push(a);
        continue;
      }
      if (isTdsLegEntityId(et)) {
        initial[et] = total;
        continue;
      }
      // Fallback for older/stripped data: no entityTxnId, but the target's only reverse link from this voucher is a TDS leg -> TDS row.
      let key = a.voucherId;
      if (SHOW_TDS_LEG_ROWS && !allocationEntityTxnId(a) && currentVoucherIdStr) {
        const tgt = (vouchersRef.current as any[]).find((x: any) => String(x?.id ?? "") === String(a.voucherId));
        const rev = ((tgt?.allocations as Allocation[] | undefined) || []).filter(
          (x) => String(x?.voucherId ?? "") === currentVoucherIdStr && getAllocationTotal(x) > 0
        );
        const tdsLegs = rev.filter(isTdsLegAllocation);
        if (rev.length > 0 && tdsLegs.length === rev.length) {
          const hit = tdsLegs.find((x) => Math.abs(getAllocationTotal(x) - total) < 0.005) ?? (tdsLegs.length === 1 ? tdsLegs[0] : undefined);
          if (hit) key = allocationEntityTxnId(hit);
        }
      }
      initial[key] = total;
    }
    // Orphan reverse TDS-leg mirrors of THIS voucher on a target (journal/payment lost its own allocation):
    // show them as this voucher's current link so the user can untick and Done removes them everywhere.
    if (SHOW_TDS_LEG_ROWS && currentVoucherIdStr) {
      for (const tgt of vouchersRef.current as any[]) {
        if (!tgt?.id || String(tgt.id) === currentVoucherIdStr) continue;
        for (const x of (Array.isArray(tgt.allocations) ? tgt.allocations : []) as Allocation[]) {
          if (String(x?.voucherId ?? "") !== currentVoucherIdStr) continue;
          const et = allocationEntityTxnId(x);
          if (!isTdsLegEntityId(et) || !et.startsWith(`${String(tgt.id)}::`)) continue;
          const amt = getAllocationTotal(x);
          if (amt > 0 && initial[et] === undefined) {
            initial[et] = amt;
            orphanTdsKeysRef.current.add(et);
          }
        }
      }
    }
    initialTdsKeysRef.current = new Set(Object.keys(initial).filter(isTdsLegEntityId));
    setPreservedTds(preserved);
    setLinkedAmounts(initial);
  }, [isOpen, existingAllocations]);

  useEffect(() => {
    if (!isOpen || !partyId) {
      clearFyLinkHints();
      setFyPromptOpen(false);
      fyLinkScannedRef.current = false;
      return;
    }
    if (fyLinkScannedRef.current) return;
    fyLinkScannedRef.current = true;
    const inMemory = new Set(
      (vouchersForAllocations as any[]).map((v) => String(v?.id ?? "")).filter(Boolean)
    );
    void scanFyLinkMissing(partyId, inMemory).then((found) => {
      if (found.length > 0) setFyPromptOpen(true);
    });
  }, [isOpen, partyId, scanFyLinkMissing, clearFyLinkHints, vouchersForAllocations]);

  const handleFyLoadYes = async (hint: import("@/lib/fyPagination/types").FyUnloadedLinkHint) => {
    await loadFyLinkHint(hint);
    setFyPromptOpen(false);
    toast.success(`Loaded vouchers from FY ${hint.fyKey.replace(/-/g, "–")}.`);
  };

  const totalLinked = useMemo(
    () =>
      Object.values(linkedAmounts).reduce((s, n) => s + Number(n) || 0, 0) +
      preservedTds.reduce((s, a) => s + getAllocationTotal(a), 0),
    [linkedAmounts, preservedTds]
  );
  const remaining = Math.max(0, received - totalLinked);

  const handleAutoLink = () => {
    const allocations = autoLink(received);
    const next: Record<string, number> = {};
    for (const a of allocations) next[a.voucherId] = a.amount;
    setLinkedAmounts(next);
    toast.success(isOut ? "Amount allocated to outstanding purchases." : "Amount allocated to outstanding transactions.");
  };

  const handleReset = () => {
    setLinkedAmounts({});
    toast.info("Allocations cleared.");
  };

  const handleDone = () => {
    const keyedAllocations: Allocation[] = Object.entries(linkedAmounts)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([voucherId, amount]) => ({ voucherId, amount: Number(amount) }));
    // TDS rows are saved against the TDS leg (entityTxnId) so _tdsSettled / TDS Paid counts them.
    const tdsRowById = new Map<string, any>();
    for (const r of targetList as any[]) if (r?.isTdsLeg) tdsRowById.set(String(r.id), r);
    const allocations: Allocation[] = keyedAllocations.map((a) => {
      const r = tdsRowById.get(String(a.voucherId));
      if (!r) return a;
      return {
        voucherId: r.refVoucherId,
        amount: a.amount,
        taxAmount: a.amount,
        // Keep the party as linkedAccountId (like main links) so journal side-split / payment filters keep it; entityTxnId marks the TDS leg.
        linkedAccountId: partyId ? String(partyId) : r.tdsAccountId,
        entityTxnId: r.id,
      } as Allocation;
    });
    // Keep hidden TDS-leg allocations exactly as saved (not shown, not deleted).
    allocations.push(...preservedTds);
    const cap = Number(receivedAmount) || 0;
    if (totalLinked > cap) {
      toast.error("Total linked amount cannot exceed " + (isOut ? "paid" : "received") + " amount.");
      return;
    }
    const result = validate(keyedAllocations, cap);
    if (!result.valid) {
      toast.error(result.error ?? "Invalid allocations.");
      return;
    }
    const removedTdsEntityIds = [...initialTdsKeysRef.current].filter((k) => !(Number(linkedAmounts[k]) > 0));
    onDone(allocations, cap, {
      removedTdsEntityIds,
      orphanTdsEntityIds: removedTdsEntityIds.filter((k) => orphanTdsKeysRef.current.has(k)),
    });
    onOpenChange(false);
  };

  const setLinkedForVoucher = (voucherId: string, value: string, cap?: number) => {
    let num = parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
    if (cap != null && cap >= 0) num = Math.min(num, cap);
    setLinkedAmounts((prev) => {
      if (num === 0) {
        const { [voucherId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [voucherId]: num };
    });
  };

  return (
    <>
    <FyLinkLoadMissingPrompt
      open={fyPromptOpen && fyLinkHints.length > 0}
      onOpenChange={setFyPromptOpen}
      hints={fyLinkHints}
      loading={fyLinkLoading}
      onYes={handleFyLoadYes}
      onNo={() => {
        setFyPromptOpen(false);
        clearFyLinkHints();
      }}
    />
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
          <p className="text-xs text-muted-foreground leading-tight">Link for bill wise (1)</p>
          <DialogTitle className="text-xl leading-tight">
            {dialogTitleOverride ?? (isOut ? "Link Payment to Linkable Cr Txns" : "Link Receipt to Linkable Dr Txns")}
          </DialogTitle>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm pt-1 hidden md:flex">
            <span className="text-muted-foreground">{isOut ? "Paid" : "Received"}: <strong className="text-foreground">{formatCurrency(received, { noSuffix: true })}</strong></span>
            <span className="text-muted-foreground">Total linked: <strong className="text-foreground">{formatCurrency(totalLinked, { noSuffix: true })}</strong></span>
            <span className="text-muted-foreground">Balance: <strong className="text-foreground">{formatCurrency(remaining, { noSuffix: true })}</strong></span>
          </div>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          {/* To Voucher: payment details — same table style as LinkAdvances */}
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
                  <td className="p-2 text-muted-foreground whitespace-nowrap">{isOut ? paymentOutDateFormatted : paymentInDateFormatted}</td>
                  <td className="p-2 font-medium whitespace-nowrap">{isOut ? (paymentOutVoucherNumber || "—") : (paymentInVoucherNumber || "—")}</td>
                  <td className="p-2 whitespace-nowrap">{partyName || "—"}</td>
                  <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(received, { noSuffix: true })}</td>
                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(totalLinked, { noSuffix: true })}</td>
                  <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(remaining, { noSuffix: true })}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-sm font-medium text-muted-foreground shrink-0 pt-1 text-center">From Voucher</p>
          <p className="text-sm text-muted-foreground shrink-0 -mt-0.5 hidden md:block text-center">
            {isOut ? "Cr transactions (same party) (only linkable or already selected)" : "Dr transactions (same party) (only linkable or already selected)"}
          </p>
          <div className="flex-1 min-h-0 border rounded-md overflow-auto scrollbar-slim-dim">
            {targetList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {isOut ? "No purchases or receipts for this party." : "No sales or payment for this party."}
              </p>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <table className="table-row-stripe-7 w-full text-sm border-separate border-spacing-0 min-w-[600px]">
                  <thead>
                    <tr className="border-b bg-muted/50 [&>th]:border-b [&>th]:border-border">
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
                    {targetList.map((row: any) => {
                      const d = safeToDate(row.date);
                      const linked = linkedAmounts[row.id] ?? 0;
                      const otherLinked = row.allocatedToOthers ?? 0;
                      const rowMax = row.outstanding ?? 0;
                      const maxAllowed = Math.min(rowMax, remaining + linked);
                      const fullyLinkedElsewhere = rowMax <= 0 && linked === 0;
                      const cannotAddMore = fullyLinkedElsewhere; // over-selection allowed; Done is disabled while total > received amount
                      const rowType =
                        row.type === "Book Opening" || row.type === "Opening Balance"
                          ? row.type
                          : (row.type ?? (isOut ? "Purchase" : "Sale")).toLowerCase();
                      const amountSuffix = isOut ? " Cr" : " Dr";
                      const idx = targetList.indexOf(row);
                      const nextRow: any = idx >= 0 ? (targetList as any[])[idx + 1] : undefined;
                      const prevRow: any = idx > 0 ? (targetList as any[])[idx - 1] : undefined;
                      const isTdsLegRow = row.isTdsLeg === true;
                      // Group: main row + its TDS row share the voucher (refVoucherId / id).
                      const groupedWithNext = !!nextRow?.isTdsLeg && String(nextRow.refVoucherId) === String(row.id);
                      const groupedWithPrev = isTdsLegRow && !!prevRow && String(prevRow.id) === String(row.refVoucherId);
                      // Box around main + TDS row (a TDS row without a visible main row is a one-row box).
                      const boxTop = groupedWithNext || (isTdsLegRow && !groupedWithPrev);
                      const boxBottom = groupedWithPrev || (isTdsLegRow && !groupedWithPrev);
                      const inBox = boxTop || boxBottom;
                      const spacerRow = (k: string) => (
                        <tr key={k} aria-hidden="true" className="!bg-transparent hover:!bg-transparent">
                          <td colSpan={8} className="h-1.5 p-0" />
                        </tr>
                      );
                      return (
                        <React.Fragment key={row.id}>
                        {boxTop && spacerRow(`${row.id}-sp-t`)}
                        <tr
                          className={cn(
                            "hover:bg-muted/30",
                            fullyLinkedElsewhere && "opacity-60",
                            !inBox && "[&>td]:border-b [&>td]:border-border",
                            inBox &&
                              "[&>td]:border-emerald-500 [&>td]:bg-emerald-50/70 dark:[&>td]:border-emerald-400/70 dark:[&>td]:bg-emerald-950/40 [&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2",
                            boxTop && "[&>td]:border-t-2 [&>td:first-child]:rounded-tl-md [&>td:last-child]:rounded-tr-md",
                            boxBottom && "[&>td]:border-b-2 [&>td:first-child]:rounded-bl-md [&>td:last-child]:rounded-br-md"
                          )}
                        >
                          <td className="p-2 w-10 whitespace-nowrap align-middle">
                            <Checkbox
                              checked={linked > 0}
                              disabled={cannotAddMore}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const cap = maxAllowed > 0 ? maxAllowed : rowMax;
                                  const initial = cap > 0 ? (maxAllowed > 0 ? maxAllowed : rowMax) : 0;
                                  if (initial > 0) setLinkedForVoucher(row.id, String(initial), cap);
                                } else {
                                  setLinkedForVoucher(row.id, "0");
                                }
                              }}
                              title={fullyLinkedElsewhere ? "Already fully linked by other vouchers" : cannotAddMore ? "Required amount already linked" : linked > 0 ? "Clear this row" : "Include this row"}
                            />
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap align-middle">
                            {d ? (dateSystem === "AD" ? formatDate(d) : dateSystem === "BS" ? formatDateBS(d) : <span className="whitespace-nowrap">{formatDateBS(d)} ({formatDate(d)})</span>) : "—"}
                          </td>
                          <td className="p-2 font-medium whitespace-nowrap align-middle">{row.id === OPENING_BALANCE_VOUCHER_ID ? "—" : (row.refNo ?? "—")}</td>
                          <td className={cn("p-2 whitespace-nowrap align-middle", isTdsLegRow && "pl-5 text-xs font-medium text-emerald-700 dark:text-emerald-300")}>{isTdsLegRow ? `↳ ${rowType}` : rowType}
                            {isTdsLegRow && otherLinked > 0 && (row.linkedByNos?.length ?? 0) > 0 && (
                              <span className="block text-[10px] font-normal text-muted-foreground">Linked by {(row.linkedByNos as string[]).join(", ")}</span>
                            )}</td>
                          <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap align-middle tabular-nums">{formatCurrency(row.total ?? 0, { noSuffix: true })}{amountSuffix}</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrency(otherLinked, { noSuffix: true })}{amountSuffix}</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrency(linked, { noSuffix: true })}{amountSuffix}</td>
                          <td className="p-2 text-right font-medium whitespace-nowrap align-middle tabular-nums">{formatCurrency(Math.max(0, rowMax - linked), { noSuffix: true })}{amountSuffix}</td>
                        </tr>
                        {boxBottom && spacerRow(`${row.id}-sp-b`)}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2 pt-2 border-t flex-wrap justify-between">
            <Button type="button" size="sm" onClick={() => onOpenChange(false)} className="h-9 rounded-full shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
              Cancel
            </Button>
            <div className="flex flex-row flex-wrap items-center gap-2 shrink-0">
              <Button type="button" size="sm" onClick={handleAutoLink} className="h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-0">
                <Link2 className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Auto Link
              </Button>
              <Button type="button" size="sm" onClick={handleReset} className="h-9 rounded-full bg-violet-600 hover:bg-violet-700 text-white border-0">
                <RotateCcw className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Reset
              </Button>
              <Button
                type="button"
                onClick={handleDone}
                disabled={totalLinked > (Number(receivedAmount) || 0)}
                className="h-9 rounded-full bg-green-600 hover:bg-green-700 text-white border-0"
              >
                DONE
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
