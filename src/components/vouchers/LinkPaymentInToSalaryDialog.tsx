"use client";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Link2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";
import { getAllocationTotal, getPaymentOutRemaining, OPENING_BALANCE_VOUCHER_ID } from "@/lib/payment-allocation-utils";
import type { Allocation } from "@/lib/payment-allocation-utils";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";

export interface LinkPaymentInToSalaryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string | null;
  staffName: string;
  paymentInId: string | null;
  amountReceived: number;
  existingAllocations: Allocation[];
  /** Staff opening balance, signed: Dr > 0 and Cr < 0. Payment In can only settle debit-side OB here. */
  staffOpeningBalance?: number;
  paymentInVoucherNumber?: string | null;
  paymentInDate?: unknown;
  onDone: (allocations: Allocation[]) => void;
}

export function LinkPaymentInToSalaryDialog({
  isOpen,
  onOpenChange,
  staffId,
  staffName,
  paymentInId,
  amountReceived,
  existingAllocations,
  staffOpeningBalance = 0,
  paymentInVoucherNumber,
  paymentInDate,
  onDone,
}: LinkPaymentInToSalaryDialogProps) {
  const { vouchers } = useVouchers();
  const { formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint, dateSystem } = useDate();
  const isMobile = useIsMobile();
  const [linkedAmounts, setLinkedAmounts] = useState<Record<string, number>>({});

  // Payment In is credit-side, so only debit-side opening balance belongs in this dialog.
  const staffOB = Number(staffOpeningBalance) || 0;
  const showOBRow = staffOB > 0;
  const obAmount = Math.max(0, staffOB);
  const totalAllocatedToOB = useMemo(() => {
    if (!staffId || !vouchers?.length) return 0;
    let sum = 0;
    (vouchers as any[]).forEach((v) => {
      if ((v.type !== "payment_in" && v.type !== "direct_income") || v.staffId !== staffId) return;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      allocs.forEach((a) => {
        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) sum += getAllocationTotal(a);
      });
    });
    return sum;
  }, [staffId, vouchers]);
  const obAllocatedToCurrent = useMemo(() => {
    const a = existingAllocations.find((x) => x.voucherId === OPENING_BALANCE_VOUCHER_ID);
    return a ? getAllocationTotal(a) : 0;
  }, [existingAllocations]);
  const obOutstanding = Math.max(0, obAmount - totalAllocatedToOB);

  const sourceRows = useMemo(() => {
    if (!staffId || !vouchers?.length) return [];
    const currentAllocMap = new Map<string, number>();
    existingAllocations.forEach((a) => {
      if (!a.voucherId) return;
      currentAllocMap.set(a.voucherId, (currentAllocMap.get(a.voucherId) ?? 0) + getAllocationTotal(a));
    });

    const paymentOutRows = (vouchers as any[])
      .filter((v: any) => (v.type === "payment_out" || v.type === "direct_expense") && v.staffId === staffId)
      .map((v: any) => {
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        const currentAllocated = currentAllocMap.get(v.id) ?? 0;
        const allocatedToOthers = paymentInId
          ? allocations.filter((a) => a.voucherId !== paymentInId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
        const remaining = getPaymentOutRemaining(v);
        return {
          id: v.id,
          voucherNumber: v.voucherNumber ?? "—",
          date: v.date,
          amount: Number(v.amount ?? v.total ?? 0) || 0,
          otherLinked: allocatedToOthers,
          linkable: remaining + currentAllocated,
          sourceType: "payment_out" as const,
        };
      })
      .filter((row) => row.linkable > 0)
      .sort((a, b) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dB - dA;
      });

    // Journal Cr / Payment In → Dr IC vouchers (same staff).
    const icDrRows = (vouchers as any[])
      .filter((v: any) => v.type === "inter_company")
      .map((v: any) => {
        const staffAmount = getInterCompanyEntityBillWiseAmount(v, String(staffId), "staff");
        if (!staffAmount || staffAmount.debit <= 0) return null;
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        const currentAllocated = currentAllocMap.get(v.id) ?? 0;
        const allocatedToOthers = paymentInId
          ? allocations.filter((a) => a.voucherId !== paymentInId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
        const remaining = Math.max(0, staffAmount.total - allocatedToOthers - currentAllocated);
        return {
          id: v.id,
          voucherNumber: v.voucherNumber ?? "—",
          date: v.date,
          amount: staffAmount.total,
          otherLinked: allocatedToOthers,
          linkable: remaining + currentAllocated,
          sourceType: "inter_company" as const,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row && row.linkable > 0)
      .sort((a, b) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dB - dA;
      });

    const obRow = ((showOBRow && obOutstanding > 0) || obAllocatedToCurrent > 0) ? [{
      id: OPENING_BALANCE_VOUCHER_ID,
      voucherNumber: "—",
      date: null,
      amount: obAmount,
      otherLinked: Math.max(0, totalAllocatedToOB - obAllocatedToCurrent),
      linkable: obOutstanding + obAllocatedToCurrent,
      sourceType: "opening_balance" as const,
    }] : [];

    return [...obRow, ...paymentOutRows, ...icDrRows];
  }, [staffId, vouchers, existingAllocations, paymentInId, showOBRow, obAmount, obOutstanding, obAllocatedToCurrent, totalAllocatedToOB]);

  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<string, number> = {};
    for (const a of existingAllocations) {
      if (a.voucherId && getAllocationTotal(a) > 0) initial[a.voucherId] = getAllocationTotal(a);
    }
    setLinkedAmounts(initial);
  }, [isOpen, existingAllocations]);

  const totalLinked = useMemo(
    () => Object.values(linkedAmounts).reduce((s, a) => s + Number(a || 0), 0),
    [linkedAmounts]
  );
  const remainingToLink = Math.max(0, amountReceived - totalLinked);

  const handleAutoLink = () => {
    let toAllocate = amountReceived;
    const next: Record<string, number> = {};
    for (const row of sourceRows) {
      if (toAllocate <= 0) break;
      const allocate = Math.min(row.linkable, toAllocate);
      if (allocate > 0) {
        next[row.id] = allocate;
        toAllocate -= allocate;
      }
    }
    setLinkedAmounts(next);
    toast.success("Auto link amounts filled. Review and DONE.");
  };

  const handleDone = () => {
    for (const row of sourceRows) {
      const amt = Number(linkedAmounts[row.id] ?? 0);
      if (amt > row.linkable) {
        toast.error(`Link amount for ${row.sourceType === "opening_balance" ? "Opening Balance" : (row.voucherNumber ?? "Payment")} cannot exceed linkable.`);
        return;
      }
    }
    const allocations: Allocation[] = Object.entries(linkedAmounts)
      .filter(([, amt]) => Number(amt) > 0)
      .map(([voucherId, amount]) => ({ voucherId, amount: Number(amount) }));
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    if (total > amountReceived) {
      toast.error("Total linked cannot exceed amount received.");
      return;
    }
    onDone(allocations);
    onOpenChange(false);
  };

  const targetVoucherDate = paymentInDate
    ? (typeof (paymentInDate as any)?.toDate === "function" ? (paymentInDate as any).toDate() : new Date(paymentInDate as string | number))
    : null;

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
          <p className="text-xs text-muted-foreground leading-tight">Link for salary</p>
          <DialogTitle className="text-xl leading-tight">Link payment to salary</DialogTitle>
          {amountReceived > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-sm pt-1 px-1">
              <span className="text-muted-foreground">Required: <strong className="text-foreground">{formatCurrency(amountReceived)}</strong></span>
              <span className="text-muted-foreground">Selected: <strong className="text-foreground">{formatCurrency(totalLinked)}</strong></span>
              <span className="text-muted-foreground">
                Balance: {remainingToLink === 0 ? <strong className="text-green-600">Settled</strong> : <strong className="text-foreground">{formatCurrency(remainingToLink)}</strong>}
              </span>
            </div>
          )}
        </DialogHeader>
        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
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
                  <td className="p-2 text-muted-foreground whitespace-nowrap">{targetVoucherDate ? (dateSystem === "AD" ? formatDate(targetVoucherDate) : dateSystem === "BS" ? formatDateBS(targetVoucherDate) : `${formatDateBS(targetVoucherDate)} (${formatDate(targetVoucherDate)})`) : "—"}</td>
                  <td className="p-2 font-medium whitespace-nowrap">{paymentInVoucherNumber ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap">{staffName || STAFF_ENTITY_LABEL}</td>
                  <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(amountReceived, { noSuffix: true })}</td>
                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(totalLinked, { noSuffix: true })}</td>
                  <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(remainingToLink, { noSuffix: true })}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm font-medium text-muted-foreground shrink-0 pt-1 text-center">From Voucher</p>
          <p className="text-sm text-muted-foreground shrink-0 -mt-0.5 hidden md:block text-center">Debit-side vouchers for same staff (Payment, Opening Balance)</p>
          <div className="flex-1 min-h-0 border rounded-md overflow-auto scrollbar-slim-dim">
            {sourceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No debit-side staff vouchers available to link.</p>
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
                    {sourceRows.map((row) => {
                      const d = row.date ? (typeof (row.date as any)?.toDate === "function" ? (row.date as any).toDate() : new Date(row.date as string | number)) : null;
                      const dateStr = d && !isNaN(d.getTime()) ? (dateSystem === "AD" ? formatDate(d) : dateSystem === "BS" ? formatDateBS(d) : `${formatDateBS(d)} (${formatDate(d)})`) : "—";
                      const linked = Number(linkedAmounts[row.id] ?? 0) || 0;
                      const maxAllowed = Math.min(row.linkable, remainingToLink + linked);
                      const cannotAddMore = remainingToLink <= 0 && linked === 0;
                      return (
                        <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="p-2 w-10 whitespace-nowrap align-middle">
                            <Checkbox
                              checked={linked > 0}
                              disabled={cannotAddMore}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const initial = maxAllowed > 0 ? maxAllowed : row.linkable;
                                  if (initial > 0) setLinkedAmounts((prev) => ({ ...prev, [row.id]: initial }));
                                } else {
                                  setLinkedAmounts((prev) => ({ ...prev, [row.id]: 0 }));
                                }
                              }}
                            />
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap align-middle">{dateStr}</td>
                          <td className="p-2 font-medium whitespace-nowrap align-middle">{row.voucherNumber ?? "—"}</td>
                          <td className="p-2 whitespace-nowrap align-middle">{row.sourceType === "opening_balance" ? "Opening Balance" : "Payment"}</td>
                          <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(row.amount, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(row.otherLinked, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(linked, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right font-medium whitespace-nowrap align-middle tabular-nums">{formatCurrencyForPrint(Math.max(0, row.linkable - linked), { noSuffix: true })} Dr</td>
                        </tr>
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
              <Button type="button" size="sm" onClick={handleAutoLink} disabled={amountReceived <= 0 || sourceRows.length === 0} className="h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-0">
                <Link2 className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Auto Link
              </Button>
              <Button type="button" size="sm" onClick={() => { setLinkedAmounts({}); toast.info("Allocations cleared."); }} className="h-9 rounded-full bg-violet-600 hover:bg-violet-700 text-white border-0">
                <RotateCcw className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Reset
              </Button>
              <Button type="button" onClick={handleDone} disabled={sourceRows.length === 0 || totalLinked > amountReceived} className="h-9 rounded-full bg-green-600 hover:bg-green-700 text-white border-0">
                DONE
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
