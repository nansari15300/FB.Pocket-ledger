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
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";
import { getTaxNetAllocatedByVoucherIdFromPaymentOuts, getAllocationTotal, getPaymentInRemaining, buildBillWiseEntityTxnId, allocationEntityTxnId, parseBillWiseEntityTxnId, OPENING_BALANCE_VOUCHER_ID } from "@/lib/payment-allocation-utils";
import type { Allocation } from "@/lib/payment-allocation-utils";
import { getInterCompanyEntityBillWiseAmount } from "@/lib/interCompany/interCompanyLedgerAmounts";
import { Link2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";

function getAddSalaryNetTotal(v: any): number {
  if (!Array.isArray(v.entries) || v.entries.length === 0) return Number(v.total ?? v.amount ?? 0) || 0;
  return v.entries
    .filter((e: any) => (Number(e.credit) || 0) > 0 && !String(e.narration || "").includes("(Staff ID:"))
    .reduce((s: number, e: any) => s + (Number(e.credit) || 0), 0);
}

export interface LinkPaymentOutToSalaryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string | null;
  staffName: string;
  paymentOutId: string | null;
  amountPaid: number;
  existingAllocations: Allocation[];
  /** Staff opening balance, signed: Dr > 0 and Cr < 0. Payment Out can only settle credit-side OB here. */
  staffOpeningBalance?: number;
  /** For "To Voucher" row (same layout as Link payment to this salary). */
  paymentOutVoucherNumber?: string | null;
  paymentOutDate?: unknown;
  onDone: (allocations: Allocation[]) => void;
}

export function LinkPaymentOutToSalaryDialog({
  isOpen,
  onOpenChange,
  staffId,
  staffName,
  paymentOutId,
  amountPaid,
  existingAllocations,
  staffOpeningBalance = 0,
  paymentOutVoucherNumber,
  paymentOutDate,
  onDone,
}: LinkPaymentOutToSalaryDialogProps) {
  const { vouchers } = useVouchers();
  const { formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint, dateSystem } = useDate();
  const [linkedAmounts, setLinkedAmounts] = useState<Record<string, number>>({});

  const totalAllocatedToOB = useMemo(() => {
    if (!staffId || !vouchers?.length) return 0;
    let sum = 0;
    (vouchers as any[]).forEach((v) => {
      if ((v.type !== "payment_out" && v.type !== "direct_expense") || v.staffId !== staffId) return;
      const allocs = (v.allocations as Allocation[] | undefined) || [];
      allocs.forEach((a) => {
        if (a.voucherId === OPENING_BALANCE_VOUCHER_ID) sum += getAllocationTotal(a);
      });
    });
    return sum;
  }, [staffId, vouchers]);

  const staffOB = Number(staffOpeningBalance) || 0;
  // Payment Out is debit-side, so only credit-side opening balance belongs in this dialog.
  const showOBRow = staffOB < 0;
  const obAmount = Math.abs(staffOB);
  const obOutstanding = Math.max(0, obAmount - totalAllocatedToOB);
  const obIsDr = staffOB > 0;
  /** Amount this payment out has already linked to OB (so we show OB row for edit even when obOutstanding is 0). */
  const obAllocatedToCurrent = useMemo(() => {
    const a = existingAllocations.find((x) => x.voucherId === OPENING_BALANCE_VOUCHER_ID);
    return a ? getAllocationTotal(a) : 0;
  }, [existingAllocations]);

  const salaryVouchersWithOutstanding = useMemo(() => {
    if (!staffId || !vouchers?.length) return [];
    const addSalaryVouchers = vouchers.filter(
      (v: any) => v.type === "journal" && v.subType === "add_salary" && Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === staffId && (Number(e.credit) || 0) > 0)
    );
    const otherPaymentOuts = vouchers.filter(
      (v: any) => (v.type === "payment_out" || v.type === "direct_expense") && (paymentOutId == null || v.id !== paymentOutId)
    );
    const allocatedMap = getTaxNetAllocatedByVoucherIdFromPaymentOuts(otherPaymentOuts);
    const list = addSalaryVouchers
      .map((v: any) => {
        const netTotal = getAddSalaryNetTotal(v);
        const allocated = allocatedMap.get(v.id)?.net ?? 0;
        const outstanding = Math.max(0, netTotal - allocated);
        return {
          id: v.id,
          voucherNumber: v.voucherNumber ?? "—",
          date: v.date,
          netTotal,
          allocated,
          outstanding,
        };
      })
      .filter((r: any) => r.outstanding > 0)
      .sort((a: any, b: any) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dA - dB;
      });
    const paymentInRows = (vouchers as any[])
      .filter((v: any) => (v.type === "payment_in" || v.type === "direct_income") && v.staffId === staffId)
      .map((v: any) => {
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        const allocatedToOthers = paymentOutId
          ? allocations.filter((a) => a.voucherId !== paymentOutId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
        const currentAllocated = paymentOutId
          ? allocations.filter((a) => a.voucherId === paymentOutId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : 0;
        const remaining = getPaymentInRemaining(v);
        return {
          id: v.id,
          voucherNumber: v.voucherNumber ?? "—",
          date: v.date,
          netTotal: Number(v.amount ?? v.total ?? 0) || 0,
          allocated: allocatedToOthers,
          outstanding: remaining + currentAllocated,
          sourceType: "payment_in" as const,
        };
      })
      .filter((r: any) => r.outstanding > 0)
      .sort((a: any, b: any) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dA - dB;
      });
    // Journal Dr / Payment Out → Cr IC vouchers (same staff).
    const icCrRows = (vouchers as any[])
      .filter((v: any) => v.type === "inter_company")
      .map((v: any) => {
        const staffAmount = getInterCompanyEntityBillWiseAmount(v, String(staffId), "staff");
        if (!staffAmount || staffAmount.credit <= 0) return null;
        const allocations = (v.allocations as Allocation[] | undefined) || [];
        const allocatedToOthers = paymentOutId
          ? allocations.filter((a) => a.voucherId !== paymentOutId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : allocations.reduce((s, a) => s + getAllocationTotal(a), 0);
        const currentAllocated = paymentOutId
          ? allocations.filter((a) => a.voucherId === paymentOutId).reduce((s, a) => s + getAllocationTotal(a), 0)
          : 0;
        const remaining = Math.max(0, staffAmount.total - allocatedToOthers - currentAllocated);
        return {
          id: v.id,
          voucherNumber: v.voucherNumber ?? "—",
          date: v.date,
          netTotal: staffAmount.total,
          allocated: allocatedToOthers,
          outstanding: remaining + currentAllocated,
          sourceType: "inter_company" as const,
        };
      })
      .filter((r: any) => !!r && r.outstanding > 0)
      .sort((a: any, b: any) => {
        const dA = a.date ? new Date((a.date as any)?.toDate?.() ?? a.date).getTime() : 0;
        const dB = b.date ? new Date((b.date as any)?.toDate?.() ?? b.date).getTime() : 0;
        return dA - dB;
      });
    const obRow = showOBRow && obAmount > 0 && (obOutstanding > 0 || obAllocatedToCurrent > 0) ? [{
      id: OPENING_BALANCE_VOUCHER_ID,
      voucherNumber: "—",
      date: null,
      netTotal: obAmount,
      allocated: totalAllocatedToOB,
      outstanding: obOutstanding,
      isDr: obIsDr,
      sourceType: "opening_balance" as const,
    }] : [];
    return [...obRow, ...list.map((row: any) => ({ ...row, sourceType: "add_salary" as const })), ...paymentInRows, ...icCrRows];
  }, [staffId, vouchers, paymentOutId, staffOB, showOBRow, obOutstanding, obAmount, obIsDr, totalAllocatedToOB, obAllocatedToCurrent]);

  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<string, number> = {};
    for (const a of existingAllocations) {
      if (!a.voucherId) continue;
      const stored = allocationEntityTxnId(a);
      if (stored) {
        const parsed = parseBillWiseEntityTxnId(stored);
        // Staff salary dialog: ignore tax-leg links
        if (parsed?.entityKind === "tax") continue;
      } else if ((Number((a as any).taxAmount) || 0) > 0 && !(Number((a as any).netAmount) || 0) && !(Number(a.amount) || 0)) {
        continue;
      }
      const net = Number((a as any).netAmount) || Number(a.amount) || 0;
      if (net > 0) initial[a.voucherId] = (initial[a.voucherId] ?? 0) + net;
    }
    setLinkedAmounts(initial);
  }, [isOpen, existingAllocations]);

  const totalLinked = useMemo(
    () => Object.values(linkedAmounts).reduce((s, a) => s + Number(a || 0), 0),
    [linkedAmounts]
  );
  const remaining = Math.max(0, amountPaid - totalLinked);

  const handleAutoLink = () => {
    let toAllocate = remaining;
    const next = { ...linkedAmounts };
    for (const row of salaryVouchersWithOutstanding) {
      if (toAllocate <= 0) break;
      const alloc = Math.min(row.outstanding, toAllocate);
      if (alloc > 0) {
        next[row.id] = (next[row.id] ?? 0) + alloc;
        toAllocate -= alloc;
      }
    }
    setLinkedAmounts(next);
    toast.success("Auto link amounts filled. Review and DONE.");
  };

  const handleReset = () => {
    setLinkedAmounts({});
    toast.info("Allocations cleared.");
  };

  const handleDone = () => {
    const allocations: Allocation[] = Object.entries(linkedAmounts)
      .filter(([, amt]) => Number(amt) > 0)
      .map(([voucherId, amount]) => {
        const amt = Number(amount);
        if (voucherId === OPENING_BALANCE_VOUCHER_ID) {
          return { voucherId, amount: amt, netAmount: amt } as Allocation;
        }
        const entityTxnId =
          staffId
            ? buildBillWiseEntityTxnId({ voucherId, entityKind: "staff", accountId: staffId })
            : undefined;
        return {
          voucherId,
          amount: amt,
          netAmount: amt,
          ...(staffId ? { linkedAccountId: staffId } : {}),
          ...(entityTxnId ? { entityTxnId } : {}),
        } as Allocation;
      });
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    if (total > amountPaid) {
      toast.error("Total linked cannot exceed amount paid.");
      return;
    }
    for (const row of salaryVouchersWithOutstanding) {
      const amt = Number(linkedAmounts[row.id] ?? 0);
      if (amt > row.outstanding) {
        toast.error(`Link amount for ${row.voucherNumber} cannot exceed outstanding (${formatCurrency(row.outstanding, { noSuffix: true })}).`);
        return;
      }
    }
    onDone(allocations);
    onOpenChange(false);
  };

  const safeToDate = (date: unknown): Date | null => {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (typeof (date as { toDate?: () => Date })?.toDate === "function") return (date as { toDate: () => Date }).toDate();
    const parsed = new Date(date as string | number);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const isMobile = useIsMobile();
  const targetRequired = amountPaid;
  const remainingToLink = Math.max(0, targetRequired - totalLinked);

  const setLinkedFor = (voucherId: string, value: string, cap?: number) => {
    const num = parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
    const final = cap != null && cap > 0 ? Math.min(num, cap) : num;
    setLinkedAmounts((prev) => {
      if (final <= 0) {
        const { [voucherId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [voucherId]: final };
    });
  };

  const targetVoucherDate = safeToDate(paymentOutDate);

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
          {/* Keep salary link title consistent across both salary-link flows. */}
          <DialogTitle className="text-xl leading-tight">Link payment to salary</DialogTitle>
          {targetRequired > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-sm pt-1 px-1">
              <span className="text-muted-foreground">Required: <strong className="text-foreground">{formatCurrency(targetRequired)}</strong></span>
              <span className="text-muted-foreground">Selected: <strong className="text-foreground">{formatCurrency(totalLinked)}</strong></span>
              <span className="text-muted-foreground">
                Balance: {remainingToLink === 0 ? <strong className="text-green-600">Settled</strong> : <strong className="text-foreground">{formatCurrency(remainingToLink)}</strong>}
              </span>
              {totalLinked < targetRequired && totalLinked > 0 && (
                <span className="text-amber-600 font-medium">Choose more</span>
              )}
            </div>
          )}
        </DialogHeader>
        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          {/* To Voucher: this payment out (same layout as Link payment to this salary) */}
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
                  <td className="p-2 font-medium whitespace-nowrap">{paymentOutVoucherNumber ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap">{staffName || STAFF_ENTITY_LABEL}</td>
                  <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(amountPaid, { noSuffix: true })}</td>
                  <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(totalLinked, { noSuffix: true })}</td>
                  <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(remainingToLink, { noSuffix: true })}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm font-medium text-muted-foreground shrink-0 pt-1 text-center">From Voucher</p>
          <p className="text-sm text-muted-foreground shrink-0 -mt-0.5 hidden md:block text-center">Credit-side vouchers for same staff (Add Salary, Receipt, Opening Balance)</p>
          <div className="flex-1 min-h-0 border rounded-md overflow-auto scrollbar-slim-dim">
            {salaryVouchersWithOutstanding.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No credit-side staff vouchers available to link.</p>
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
                    {salaryVouchersWithOutstanding.map((row: any) => {
                      const d = safeToDate(row.date);
                      const linked = linkedAmounts[row.id] ?? 0;
                      const linkableAfter = Math.max(0, row.outstanding - linked);
                      const dateStr = d ? (dateSystem === "AD" ? formatDate(d) : dateSystem === "BS" ? formatDateBS(d) : `${formatDateBS(d)} (${formatDate(d)})`) : "—";
                      const rowMax = row.outstanding;
                      const maxAllowed = Math.min(rowMax, remainingToLink + linked);
                      const cannotAddMore = remainingToLink <= 0 && linked === 0;
                      const fromLabel = row.id === OPENING_BALANCE_VOUCHER_ID ? "Opening Balance" : row.sourceType === "payment_in" ? "Receipt" : "Add Salary";
                      // Use print formatter inside string interpolation so Opening Balance never renders as [object Object].
                      const amountStr = row.id === OPENING_BALANCE_VOUCHER_ID
                        ? `${formatCurrencyForPrint(Number(row.netTotal ?? row.outstanding) || 0, { noSuffix: true })} ${row.isDr ? "Dr" : "Cr"}`
                        : formatCurrencyForPrint(Number(row.netTotal ?? row.outstanding) || 0, { noSuffix: true });
                      return (
                        <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="p-2 w-10 whitespace-nowrap align-middle">
                            <Checkbox
                              checked={linked > 0}
                              disabled={cannotAddMore}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const cap = maxAllowed > 0 ? maxAllowed : rowMax;
                                  const initial = cap > 0 ? (maxAllowed > 0 ? maxAllowed : Math.min(0.01, rowMax)) : 0;
                                  if (initial > 0) setLinkedFor(row.id, String(initial), cap);
                                } else {
                                  setLinkedFor(row.id, "0");
                                }
                              }}
                              title={cannotAddMore ? "Required amount already linked" : linked > 0 ? "Clear this row" : "Include this row"}
                            />
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap align-middle">{dateStr}</td>
                          <td className="p-2 font-medium whitespace-nowrap align-middle">{row.id === OPENING_BALANCE_VOUCHER_ID ? "—" : (row.voucherNumber ?? "—")}</td>
                          <td className="p-2 whitespace-nowrap align-middle">{fromLabel}</td>
                          <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap align-middle tabular-nums">{amountStr}</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrency(row.allocated ?? 0, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right text-muted-foreground whitespace-nowrap align-middle tabular-nums">{formatCurrency(linked, { noSuffix: true })} Dr</td>
                          <td className="p-2 text-right font-medium whitespace-nowrap align-middle tabular-nums">{formatCurrency(linkableAfter, { noSuffix: true })} Dr</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {totalLinked < targetRequired && totalLinked > 0 && (
            <p className="text-sm text-amber-600 font-medium px-1">Selected total is less than required. Choose more vouchers to cover the amount.</p>
          )}
          <div className="flex flex-shrink-0 items-center gap-2 pt-2 border-t flex-wrap justify-between">
            <Button type="button" size="sm" onClick={() => onOpenChange(false)} className="h-9 rounded-full shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
              Cancel
            </Button>
            <div className="flex flex-row flex-wrap items-center gap-2 shrink-0">
              <Button type="button" size="sm" onClick={handleAutoLink} disabled={targetRequired <= 0 || salaryVouchersWithOutstanding.length === 0} className="h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-0">
                <Link2 className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Auto Link
              </Button>
              <Button type="button" size="sm" onClick={handleReset} className="h-9 rounded-full bg-violet-600 hover:bg-violet-700 text-white border-0">
                <RotateCcw className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Reset
              </Button>
              <Button type="button" onClick={handleDone} disabled={totalLinked > amountPaid} className="h-9 rounded-full bg-green-600 hover:bg-green-700 text-white border-0">
                DONE
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
