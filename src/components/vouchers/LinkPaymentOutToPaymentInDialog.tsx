"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDate } from "@/hooks/useDate";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
  NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN,
} from "@/lib/dialogShellChrome";
import { Link2, RotateCcw } from "lucide-react";
import { getOpeningBalanceBaseAmount, getOpeningBalanceVoucherLabel, SPEND_WISE_OPENING_BALANCE_ID } from "@/lib/spendWiseOpeningBalance";
import { getSpendWiseOutflowPartyLabel } from "@/lib/paymentInAllocation";

const safeToDate = (date: unknown): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof (date as { toDate?: () => Date })?.toDate === "function")
    return (date as { toDate: () => Date }).toDate();
  const parsed = new Date(date as string | number);
  return isNaN(parsed.getTime()) ? null : parsed;
};

export interface LinkPaymentOutToPaymentInDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  /** Current Payment In voucher id (the one we're linking to). */
  currentPaymentInId: string;
  /** All vouchers; outflow vouchers for this account will be filtered inside. */
  vouchers: any[];
  /** Outflow voucher ids that currently link to this Payment In (pre-selected). */
  selectedIds: string[];
  /** Names for party/staff/account/expense for "To" column. */
  names?: Record<string, string>;
  /** Amount received on this Payment In — distributed across selected outflow vouchers. */
  requiredAmount?: number;
  /** Called with selected outflow ids and amount to link from this Payment In to each (poId -> amount). */
  onConfirm: (ids: string[], amountsByVoucherId: Record<string, number>) => void;
  /** Account name to show in title so user knows which account the link is for. */
  accountName?: string | null;
  /** When editing: amount this voucher has already linked to each outflow id (so Selected total and allocation show correctly). */
  currentVoucherLinkedAmounts?: Record<string, number>;
  /** When provided, show "From Voucher (current voucher)" section with only this voucher — the one we're working on. */
  currentVoucherSummary?: { voucherNumber: string; date: Date | null; from: string; amount: number; linkedTotal: number };
  /** Account opening balance used to include Opening Balance as spend-wise row. */
  accountOpeningBalance?: number;
}

/** Out-flow vouchers for this account: Payment, Direct Expense, Contra (from this account). */
function isOutVoucherForAccount(v: any, accountId: string): boolean {
  return (
    (v.type === "payment_out" && v.accountId === accountId) ||
    (v.type === "direct_expense" && v.accountId === accountId) ||
    (v.type === "contra" && v.fromAccountId === accountId)
  );
}

export function LinkPaymentOutToPaymentInDialog({
  isOpen,
  onOpenChange,
  accountId,
  currentPaymentInId,
  vouchers,
  selectedIds,
  names = {},
  requiredAmount = 0,
  onConfirm,
  accountName,
  currentVoucherLinkedAmounts = {},
  currentVoucherSummary,
  accountOpeningBalance = 0,
}: LinkPaymentOutToPaymentInDialogProps) {
  const { formatDateBySystem, formatCurrency, formatCurrencyForPrint } = useDate();
  const isMobile = useIsMobile();
  const [checked, setChecked] = React.useState<Set<string>>(new Set(selectedIds));
  const [selectedOrder, setSelectedOrder] = React.useState<string[]>(selectedIds?.length ? [...selectedIds] : []);

  const openingBalanceLinkedByOthers = React.useMemo(() => {
    return vouchers
      .filter((v: any) => {
        const isInVoucherForAccount =
          ((v.type === "payment_in" || v.type === "direct_income") && (v.accountId ?? v.toAccountId ?? v.bankAccountId) === accountId) ||
          (v.type === "contra" && (v.toAccountId ?? v.accountId) === accountId);
        return isInVoucherForAccount && v.id !== currentPaymentInId && !v.isDeleted;
      })
      .reduce((sum: number, v: any) => {
        if ((v.linkedOpeningBalanceAccountId ?? "") !== accountId) return sum;
        return sum + (Number(v.linkedOpeningBalanceAmount) || 0);
      }, 0);
  }, [vouchers, accountId, currentPaymentInId]);

  /** List of outflow vouchers for this account with linkable amount. Edit mode: free current voucher's amount so it can be re-allocated. */
  const paymentOutList = React.useMemo(() => {
    const rows = vouchers
      .filter((v) => isOutVoucherForAccount(v, accountId) && !v.isDeleted)
      .map((v) => {
        const date = safeToDate(v.date);
        const amount = Number(v.total ?? v.amount ?? 0) || 0;
        const amounts = v.linkedPaymentInAmounts && typeof v.linkedPaymentInAmounts === "object" ? v.linkedPaymentInAmounts : {};
        const alreadyLinked = Object.values(amounts).reduce<number>((s, val) => s + (Number(val) || 0), 0);
        const currentLinked: number = Number(currentVoucherLinkedAmounts?.[v.id] ?? 0) || 0;
        const linkable = Math.max(0, amount - alreadyLinked + currentLinked);
        const to = getSpendWiseOutflowPartyLabel(v, names);
        return { id: v.id, voucherNumber: v.voucherNumber ?? "—", date, amount, alreadyLinked, linkable, to, currentLinked };
      });
    const openingBase = getOpeningBalanceBaseAmount(accountOpeningBalance, "cr");
    if (openingBase > 0) {
      const currentLinked = Number(currentVoucherLinkedAmounts[SPEND_WISE_OPENING_BALANCE_ID]) || 0;
      const alreadyLinked = openingBalanceLinkedByOthers + currentLinked;
      const linkable = Math.max(0, openingBase - alreadyLinked + currentLinked);
      // Treat opening balance like a normal spend-wise target row for Cr side linking.
      rows.push({
        id: SPEND_WISE_OPENING_BALANCE_ID,
        voucherNumber: getOpeningBalanceVoucherLabel("cr"),
        date: null,
        amount: openingBase,
        alreadyLinked,
        linkable,
        to: "Opening Balance",
        currentLinked,
      });
    }
    return rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }, [vouchers, accountId, names, currentVoucherLinkedAmounts, accountOpeningBalance, openingBalanceLinkedByOthers]);

  const prevOpenRef = React.useRef(false);
  React.useEffect(() => {
    const ids = Array.isArray(selectedIds) ? selectedIds : [];
    const deduped = [...new Set(ids)];
    const justOpened = isOpen && !prevOpenRef.current;
    prevOpenRef.current = isOpen;
    if (!isOpen) return;
    if (justOpened) {
      setChecked(new Set(deduped));
      setSelectedOrder(deduped.length ? [...deduped] : []);
    }
  }, [selectedIds, isOpen]);

  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const displayList = React.useMemo(() => {
    return paymentOutList.filter((r) => r.linkable > 0 || selectedSet.has(r.id));
  }, [paymentOutList, selectedIds]);

  /** Tentative allocation: use only linkable per row (never full amount). Start with current voucher's amounts capped by linkable, then distribute remaining in selection order. */
  const tentativeLinkedByRowId = React.useMemo(() => {
    const out: Record<string, number> = {};
    const byId = new Map(paymentOutList.map((r) => [r.id, r]));
    const ordered = selectedOrder.filter((id) => checked.has(id)).map((id) => byId.get(id)).filter(Boolean) as typeof paymentOutList;
    let allocated = 0;
    for (const row of ordered) {
      const currentAmt = Number(currentVoucherLinkedAmounts[row.id]) || 0;
      if (currentAmt > 0) {
        const capped = Math.min(currentAmt, row.linkable);
        out[row.id] = capped;
        allocated += capped;
      }
    }
    let remaining = Math.max(0, requiredAmount - allocated);
    for (const row of ordered) {
      if (remaining <= 0) break;
      const already = out[row.id] ?? 0;
      const take = Math.min(row.linkable - already, remaining);
      if (take > 0) {
        out[row.id] = already + take;
        remaining -= take;
      }
    }
    return out;
  }, [paymentOutList, checked, requiredAmount, selectedOrder, currentVoucherLinkedAmounts]);

  const selectedTotal = Object.values(tentativeLinkedByRowId).reduce((s, v) => s + v, 0);
  const needsMore = requiredAmount > 0 && selectedTotal < requiredAmount;
  /** When selected total >= required amount, disable unchecked rows (like Contra / Payment link dialog). */
  const selectionFull = requiredAmount > 0 && selectedTotal >= requiredAmount;
  // Show live RCPT status in the current-voucher summary while user selects linked payments.
  const currentVoucherStatus = React.useMemo(() => {
    if (!currentVoucherSummary) return null;
    if (selectedTotal <= 0) return { label: "Unpaid", className: "text-red-600 border-red-300 bg-red-50" };
    if (selectedTotal >= currentVoucherSummary.amount && currentVoucherSummary.amount > 0) {
      return { label: "Paid", className: "text-green-600 border-green-300 bg-green-50" };
    }
    return { label: "Partial", className: "text-amber-600 border-amber-300 bg-amber-50" };
  }, [currentVoucherSummary, selectedTotal]);

  const handleToggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectedOrder((order) => order.filter((x) => x !== id));
      } else {
        if (selectionFull) return prev;
        next.add(id);
        setSelectedOrder((order) => (order.includes(id) ? order : [...order, id]));
      }
      return next;
    });
  };

  const handleAutoLink = () => {
    const byDateAsc = [...paymentOutList].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    let sum = 0;
    const ids: string[] = [];
    for (const row of byDateAsc) {
      if (sum >= requiredAmount) break;
      if (row.linkable <= 0) continue;
      ids.push(row.id);
      sum += row.linkable;
    }
    setChecked(new Set(ids));
    setSelectedOrder(ids);
  };

  const handleReset = () => {
    setChecked(new Set());
    setSelectedOrder([]);
  };

  const handleConfirm = () => {
    const ids = selectedOrder.filter((id) => checked.has(id));
    const byId = new Map(paymentOutList.map((r) => [r.id, r]));
    const amountsByVoucherId: Record<string, number> = {};
    ids.forEach((id) => {
      const amt = tentativeLinkedByRowId[id] ?? 0;
      const row = byId.get(id);
      const cap = row ? row.linkable : amt;
      const toSave = amt > 0 ? Math.min(amt, cap) : 0;
      if (toSave > 0) amountsByVoucherId[id] = toSave;
    });
    onConfirm([...new Set(ids)], amountsByVoucherId);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN}
        className={cn(
          NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
          "max-w-2xl md:max-w-[54.6rem] max-h-[85vh] flex flex-col overflow-hidden rounded-lg pt-3 px-[3px]",
          isMobile && "left-[2px] right-[2px] translate-x-0 w-auto max-w-none h-[85vh] max-h-[85vh] pt-2"
        )}
      >
        <DialogHeader className="shrink-0 space-y-0.5">
          {/* Keep spend-wise popup header consistent across all link dialogs. */}
          <p className="text-xs text-muted-foreground leading-tight">Link for spend wise</p>
          <DialogTitle>Select Payment / Direct Expense / Contra (out){accountName ? ` from ${accountName}` : ""}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Tick which Payment, Direct Expense or Contra (out) vouchers this receipt is paying. Amount will be linked to selected vouchers.
          </p>
          {requiredAmount > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
              <span className="text-muted-foreground">Amount received: <strong className="text-foreground">{formatCurrency(requiredAmount)}</strong></span>
              <span className="text-muted-foreground">Selected: <strong className="text-foreground">{formatCurrency(selectedTotal)}</strong></span>
              {needsMore && <span className="text-amber-600 font-medium">Choose more</span>}
            </div>
          )}
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-slim-dim flex flex-col gap-2">
        {/* From Voucher (current voucher): only the voucher we're working on */}
        {currentVoucherSummary && (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 shrink-0">
            <p className="text-sm font-medium text-muted-foreground">
              {/* Show account in section title so user can verify current voucher's account context. */}
              From Voucher (current voucher){accountName ? ` - Account: ${accountName}` : ""}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[400px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">From</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Linked on current</th>
                    <th className="text-center p-2 font-medium whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b last:border-b-0">
                    <td className="p-2 text-muted-foreground whitespace-nowrap">{currentVoucherSummary.date ? formatDateBySystem(currentVoucherSummary.date) : "—"}</td>
                    <td className="p-2 font-medium whitespace-nowrap">{currentVoucherSummary.voucherNumber}</td>
                    <td className="p-2 whitespace-nowrap">{currentVoucherSummary.from}</td>
                    <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(currentVoucherSummary.amount)} Dr</td>
                    <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(selectedTotal)} Dr</td>
                    <td className="p-2 text-center whitespace-nowrap">
                      {currentVoucherStatus && (
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", currentVoucherStatus.className)}>
                          {currentVoucherStatus.label}
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-sm font-medium text-muted-foreground shrink-0">
          {/* Show account in section title so user can identify which account's vouchers are listed. */}
          To Voucher{accountName ? ` - Account: ${accountName}` : ""} — Payment / Direct Expense / Contra (out) of this account (only linkable or already selected)
        </p>
        <div className="min-h-0 border rounded-md overflow-x-auto">
          {displayList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {paymentOutList.length === 0
                  ? "No Payment, Direct Expense or Contra (out) found for this account."
                  : "No linkable amount remaining."}
              </p>
            ) : (
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 w-10 whitespace-nowrap"></th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">Date</th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">Voucher No.</th>
                    <th className="text-left p-2 font-medium whitespace-nowrap">To</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Amount</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Linked</th>
                    <th className="text-right p-2 font-medium whitespace-nowrap">Linkable</th>
                  </tr>
                </thead>
                <tbody>
                  {displayList.map((row) => (
                    <tr
                      key={row.id}
                      role="button"
                      onClick={() => !(selectionFull && !checked.has(row.id)) && handleToggle(row.id)}
                      className={cn(
                        "border-b last:border-b-0 hover:bg-muted/50 cursor-pointer",
                        checked.has(row.id) && "bg-muted/30",
                        selectionFull && !checked.has(row.id) && "cursor-not-allowed opacity-70"
                      )}
                    >
                      <td className="p-2 w-10 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked.has(row.id)}
                          onCheckedChange={() => handleToggle(row.id)}
                          disabled={!checked.has(row.id) && selectionFull}
                        />
                      </td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{row.date ? formatDateBySystem(row.date) : "—"}</td>
                      <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber}</td>
                      <td className="p-2 whitespace-nowrap">{row.to}</td>
                      <td className="p-2 text-right font-medium text-red-600 whitespace-nowrap">
                        {/* Outflow voucher amounts are credit-side in this popup. */}
                        {formatCurrencyForPrint(row.amount, { noSuffix: true })} Cr
                      </td>
                      <td className="p-2 text-right text-red-600 whitespace-nowrap">
                        {/* Linked: effective total after this dialog (other receipts + this receipt's tentative). Avoid double-counting current voucher. */}
                        {(() => {
                          const otherLinked = Number(row.alreadyLinked ?? 0) - Number(row.currentLinked ?? 0);
                          const tentative = tentativeLinkedByRowId[row.id] ?? 0;
                          const effectiveTotalLinked = otherLinked + tentative;
                          if (effectiveTotalLinked <= row.amount) return `${formatCurrencyForPrint(effectiveTotalLinked, { noSuffix: true })} Cr`;
                          return (
                            <span title={`Total linked: ${formatCurrencyForPrint(effectiveTotalLinked, { noSuffix: true })} Cr (exceeds voucher amount ${formatCurrencyForPrint(row.amount, { noSuffix: true })} Cr)`}>
                              {formatCurrencyForPrint(row.amount, { noSuffix: true })} Cr <span className="text-amber-600 text-xs">(+{formatCurrencyForPrint(effectiveTotalLinked - row.amount, { noSuffix: true })} Cr over)</span>
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-2 text-right font-medium text-red-600 whitespace-nowrap">
                        {/* Linkable balance here is remaining credit-side amount on outflow rows. */}
                        {formatCurrencyForPrint(Math.max(0, row.linkable - (tentativeLinkedByRowId[row.id] ?? 0)), { noSuffix: true })} Cr
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        </div>
        {needsMore && (
          <p className="text-sm text-amber-600 font-medium px-1 shrink-0">Selected total is less than amount received. Choose more vouchers to cover the amount.</p>
        )}
        <DialogFooter className="shrink-0 !flex-row flex flex-wrap items-center gap-2 w-full justify-between sm:justify-between">
          <Button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-full shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
            Cancel
          </Button>
          <div className="flex flex-row flex-wrap items-center gap-2 shrink-0">
            <Button type="button" size="sm" onClick={handleReset} className="h-9 rounded-full bg-violet-600 hover:bg-violet-700 text-white border-0">
              <RotateCcw className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
              Reset
            </Button>
            {requiredAmount > 0 && (
              <Button type="button" size="sm" onClick={handleAutoLink} className="h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white border-0">
                <Link2 className="h-4 w-4 hidden md:inline-block md:mr-1.5" />
                Auto Link
              </Button>
            )}
            <Button type="button" onClick={handleConfirm} className="h-9 rounded-full bg-green-600 hover:bg-green-700 text-white border-0">Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
