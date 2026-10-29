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
import { getSpendWiseInflowPartyLabel } from "@/lib/paymentInAllocation";

const safeToDate = (date: unknown): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof (date as { toDate?: () => Date })?.toDate === "function")
    return (date as { toDate: () => Date }).toDate();
  const parsed = new Date(date as string | number);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const getContraVoucherNumberForInAccount = (v: any, accountId: string): string => {
  // Show the correct contra leg number for the account context (In account should see CNTR In).
  if (v?.type !== "contra") return v?.voucherNumber ?? "—";
  if ((v.toAccountId ?? v.accountId) === accountId) return v.voucherNumberIn ?? v.voucherNumber ?? "—";
  if (v.fromAccountId === accountId) return v.voucherNumberOut ?? v.voucherNumber ?? "—";
  return v.voucherNumber ?? "—";
};

export interface LinkPaymentInToPaymentOutDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  /** All vouchers (payment_in for this account will be filtered inside). */
  vouchers: any[];
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  /** Names for party/staff/tax/income for particulars. */
  names?: Record<string, string>;
  /** Required amount (Payment amount). When set, shows "Choose more" if selected total < this. */
  requiredAmount?: number;
  /** When editing, exclude this Payment from "already linked" sum so we don't double-count. */
  currentVoucherId?: string | null;
  /** When editing, amount already linked by this voucher to each Payment In id (so Linked column shows total including current). */
  currentVoucherLinkedAmounts?: Record<string, number>;
  /** When set, show only this voucher in the list (e.g. current voucher only). */
  filterToVoucherId?: string | null;
  /** When true, show list as read-only (no selection, only Close). */
  displayOnly?: boolean;
  /** Account name to show in title so user knows which account the link is for. */
  accountName?: string | null;
  /** When displayOnly is true: show "in voucher" or "payment out" in title. */
  displayOnlyVariant?: 'in' | 'out';
  /** When provided (e.g. from Payment form), show current voucher (Payment) at top — "To Voucher (current voucher)". */
  currentVoucherSummary?: { voucherNumber: string; date: Date | null; from: string; amount: number; linkedTotal: number };
  /** When true, show all account vouchers in table (even if linkable is 0) for visibility/debug clarity. */
  showAllRows?: boolean;
  /** Account opening balance used to include Opening Balance as spend-wise row. */
  accountOpeningBalance?: number;
}

export function LinkPaymentInToPaymentOutDialog({
  isOpen,
  onOpenChange,
  accountId,
  vouchers,
  selectedIds,
  onConfirm,
  names = {},
  requiredAmount = 0,
  currentVoucherId,
  currentVoucherLinkedAmounts = {},
  filterToVoucherId,
  displayOnly = false,
  accountName,
  displayOnlyVariant = 'in',
  currentVoucherSummary,
  showAllRows = false,
  accountOpeningBalance = 0,
}: LinkPaymentInToPaymentOutDialogProps) {
  const { formatDateBySystem, formatCurrency } = useDate();
  const [checked, setChecked] = React.useState<Set<string>>(new Set(selectedIds));
  /** Order in which user ticked rows: first-ticked gets allocation first. */
  const [selectedOrder, setSelectedOrder] = React.useState<string[]>(selectedIds?.length ? [...selectedIds] : []);
  // Selection is local until user clicks Done; nothing is saved to server until then (parent saves on onConfirm).

  const prevOpenRef = React.useRef(false);
  React.useEffect(() => {
    const ids = Array.isArray(selectedIds) ? selectedIds : [];
    const deduped = [...new Set(ids)];
    const justOpened = isOpen && !prevOpenRef.current;
    prevOpenRef.current = isOpen;
    if (!isOpen) return;
    if (!justOpened) return;
    if (requiredAmount > 0 && paymentInList.length > 0 && deduped.length > 0) {
      const ordered = paymentInList.filter((r) => deduped.includes(r.id));
      let sum = 0;
      const minimal: string[] = [];
      for (const row of ordered) {
        minimal.push(row.id);
        sum += row.linkable;
        if (sum >= requiredAmount) break;
      }
      setChecked(new Set(minimal));
      setSelectedOrder(minimal);
    } else {
      setChecked(new Set(deduped));
      setSelectedOrder(deduped.length ? [...deduped] : []);
    }
  }, [selectedIds, isOpen]);

  const linkedAmountByPaymentInId = React.useMemo(() => {
    const map = new Map<string, number>();
    vouchers
      .filter(
        (v: any) => {
          const isOutForAccount =
            (v.type === "payment_out" && v.accountId === accountId) ||
            (v.type === "direct_expense" && v.accountId === accountId) ||
            (v.type === "contra" && v.fromAccountId === accountId);
          return (
            isOutForAccount &&
            Array.isArray(v.linkedPaymentInIds) &&
            v.linkedPaymentInIds.length > 0 &&
            v.id !== currentVoucherId &&
            !v.isDeleted
          );
        }
      )
      .forEach((po: any) => {
        const poAmt = Number(po.total ?? po.amount ?? 0) || 0;
        const ids = po.linkedPaymentInIds as string[];
        const amounts = po.linkedPaymentInAmounts && typeof po.linkedPaymentInAmounts === "object" ? po.linkedPaymentInAmounts : null;
        ids.forEach((piId: string) => {
          const add = amounts?.[piId] != null ? Number(amounts[piId]) : poAmt / ids.length;
          map.set(piId, (map.get(piId) ?? 0) + add);
        });
      });
    return map;
  }, [vouchers, accountId, currentVoucherId]);

  /** In-flow vouchers for this account: support both current and legacy account keys. */
  const isInVoucherForAccount = (v: any) => {
    // Legacy safety: some old vouchers can keep bank/cash account in toAccountId/bankAccountId.
    const inAccountId = v.accountId ?? v.toAccountId ?? v.bankAccountId;
    return (
      (v.type === "payment_in" && inAccountId === accountId) ||
      (v.type === "direct_income" && inAccountId === accountId) ||
      // Contra "in" is identified by destination account.
      (v.type === "contra" && (v.toAccountId ?? v.accountId) === accountId)
    );
  };

  const paymentInList = React.useMemo(() => {
    const rows = vouchers
      .filter((v) => isInVoucherForAccount(v) && !v.isDeleted)
      .map((v) => {
        const date = safeToDate(v.date);
        const amount = Number(v.total ?? v.amount ?? 0);
        const fromOthers = linkedAmountByPaymentInId.get(v.id) ?? 0;
        const fromCurrent = Number(currentVoucherLinkedAmounts[v.id]) || 0;
        const alreadyLinked = fromOthers + fromCurrent;
        const linkable = Math.max(0, amount - alreadyLinked);
        // For contra rows, render CNTR In/CNTR Out according to the current account leg.
        const voucherNumber = getContraVoucherNumberForInAccount(v, accountId);
        const from = getSpendWiseInflowPartyLabel(v, names);
        return { id: v.id, voucherNumber, date, amount, alreadyLinked, linkable, from };
      });
    const openingBase = getOpeningBalanceBaseAmount(accountOpeningBalance, "dr");
    if (openingBase > 0) {
      const fromOthers = linkedAmountByPaymentInId.get(SPEND_WISE_OPENING_BALANCE_ID) ?? 0;
      const fromCurrent = Number(currentVoucherLinkedAmounts[SPEND_WISE_OPENING_BALANCE_ID]) || 0;
      const alreadyLinked = fromOthers + fromCurrent;
      const linkable = Math.max(0, openingBase - alreadyLinked);
      // Treat opening balance like a normal spend-wise source row for Dr side linking.
      rows.push({
        id: SPEND_WISE_OPENING_BALANCE_ID,
        voucherNumber: getOpeningBalanceVoucherLabel("dr"),
        date: null,
        amount: openingBase,
        alreadyLinked,
        linkable,
        from: "Opening Balance",
      });
    }
    return rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }, [vouchers, accountId, names, linkedAmountByPaymentInId, currentVoucherLinkedAmounts, accountOpeningBalance]);

  /** When filterToVoucherId is set, show only that voucher (e.g. current voucher only). */
  const paymentInListFiltered = React.useMemo(() => {
    if (!filterToVoucherId) return paymentInList;
    return paymentInList.filter((r) => r.id === filterToVoucherId);
  }, [paymentInList, filterToVoucherId]);

  /** Add new: hide linkable 0. Edit: show linkable 0 only if already linked (in selectedIds). */
  const displayList = React.useMemo(() => {
    // Optional visibility mode: show all matched vouchers so user can inspect why linkable is zero.
    if (showAllRows) return paymentInListFiltered;
    const isEdit = currentVoucherId != null && currentVoucherId !== "";
    const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    const list = paymentInListFiltered;
    if (!isEdit) return list.filter((r) => r.linkable > 0);
    return list.filter((r) => r.linkable > 0 || selectedSet.has(r.id));
  }, [paymentInListFiltered, currentVoucherId, selectedIds, showAllRows]);

  /** Tentative allocation: include already-linked-from-current first, then distribute remaining requiredAmount in selection order. */
  const tentativeLinkedByRowId = React.useMemo(() => {
    const out: Record<string, number> = {};
    if (requiredAmount <= 0 || displayOnly) return out;
    const byId = new Map(paymentInListFiltered.map((r) => [r.id, r]));
    const ordered = selectedOrder.filter((id) => checked.has(id)).map((id) => byId.get(id)).filter(Boolean) as typeof paymentInList;
    let allocated = 0;
    for (const row of ordered) {
      const currentAmt = Number(currentVoucherLinkedAmounts[row.id]) || 0;
      if (currentAmt > 0) {
        out[row.id] = currentAmt;
        allocated += currentAmt;
      }
    }
    let remaining = Math.max(0, requiredAmount - allocated);
    for (const row of ordered) {
      if (remaining <= 0) break;
      const already = out[row.id] ?? 0;
      const take = Math.min(row.linkable, remaining);
      if (take > 0) {
        out[row.id] = already + take;
        remaining -= take;
      }
    }
    return out;
  }, [paymentInListFiltered, checked, requiredAmount, selectedOrder, displayOnly, currentVoucherLinkedAmounts]);

  /** Amount we are linking from current selection (capped by required). */
  const selectedTotal = React.useMemo(() => {
    return Object.values(tentativeLinkedByRowId).reduce((s, v) => s + v, 0);
  }, [tentativeLinkedByRowId]);

  const needsMore = requiredAmount > 0 && selectedTotal < requiredAmount;
  const selectionFull = requiredAmount > 0 && selectedTotal >= requiredAmount;

  const handleToggle = (id: string) => {
    // Never allow selecting non-linkable rows unless they are already selected (for clean uncheck flow).
    const row = paymentInListFiltered.find((r) => r.id === id);
    if (!checked.has(id) && (row?.linkable ?? 0) <= 0) return;
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
    const byDateAsc = [...paymentInList].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
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

  const handleConfirm = () => {
    const ids = selectedOrder.filter((id) => checked.has(id));
    onConfirm([...new Set(ids)]);
    onOpenChange(false);
  };

  const handleReset = () => {
    // Reset is immediate by request; keep local selection clear without extra confirmation.
    setChecked(new Set());
    setSelectedOrder([]);
  };

  const isMobile = useIsMobile();
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={NESTED_VOUCHER_LINK_DIALOG_OVERLAY_CN}
        className={cn(
          NESTED_VOUCHER_LINK_DIALOG_CONTENT_CN,
          "max-w-2xl md:max-w-[54.6rem] max-h-[85vh] flex flex-col overflow-hidden rounded-lg pt-3 px-[3px]",
          isMobile && "left-[2px] right-[2px] translate-x-0 w-auto max-w-none h-[85vh] max-h-[85vh] pt-2"
        )}
        hideCloseButton
      >
        <DialogHeader className="shrink-0 space-y-0.5">
          <p className="text-xs text-muted-foreground leading-tight">Link for spend wise</p>
          <DialogTitle className="leading-tight">{displayOnly ? `Current voucher ${displayOnlyVariant === 'out' ? 'payment' : 'in voucher'}${accountName ? ` from ${accountName}` : ""}` : `Select Receipt / Direct Income / Contra (in)${accountName ? ` from ${accountName}` : ""}`}</DialogTitle>
          {!displayOnly && (
          <p className="text-sm text-muted-foreground hidden md:block">
            Tick which Receipt, Direct Income or Contra (in) vouchers this payment is spending from. Amount will be linked from selected vouchers.
          </p>
          )}
          {!displayOnly && requiredAmount > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-sm pt-1 hidden md:flex">
              <span className="text-muted-foreground">Required: <strong className="text-foreground">{formatCurrency(requiredAmount)}</strong></span>
              <span className="text-muted-foreground">Selected: <strong className="text-foreground">{formatCurrency(selectedTotal)}</strong></span>
              {needsMore && (
                <span className="text-amber-600 font-medium">Choose more</span>
              )}
            </div>
          )}
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-slim-dim flex flex-col gap-2">
        {/* To Voucher (current voucher): the Payment we're editing — show at top like Payment In dialog. */}
        {currentVoucherSummary && !displayOnly && (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 shrink-0">
            <p className="text-sm font-medium text-muted-foreground">
              {/* Show account in section title so user can confirm which account this current voucher belongs to. */}
              To Voucher (current voucher){accountName ? ` - Account: ${accountName}` : ""}
            </p>
            <div className="overflow-x-auto">
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
                    <td className="p-2 text-muted-foreground whitespace-nowrap">{currentVoucherSummary.date ? formatDateBySystem(currentVoucherSummary.date) : "—"}</td>
                    <td className="p-2 font-medium whitespace-nowrap">{currentVoucherSummary.voucherNumber}</td>
                    <td className="p-2 whitespace-nowrap">{currentVoucherSummary.from}</td>
                    <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(currentVoucherSummary.amount)} Dr</td>
                    <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(currentVoucherSummary.linkedTotal)} Dr</td>
                    <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(Math.max(0, currentVoucherSummary.amount - currentVoucherSummary.linkedTotal))} Dr</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        {!displayOnly && (
          <p className="text-sm font-medium text-muted-foreground shrink-0 pt-1">
            {/* Show account in section title so user clearly sees which account list is being shown. */}
            From Voucher{accountName ? ` - Account: ${accountName}` : ""}
          </p>
        )}
        {currentVoucherSummary && !displayOnly && (
          <p className="text-sm text-muted-foreground shrink-0 -mt-0.5 hidden md:block">Receipt / Direct Income / Contra (in) of this account (only linkable or already selected)</p>
        )}
        {/* Single scroll container: horizontal + vertical so mobile shows full table; thin dim scrollbar */}
        <div className="min-h-0 border rounded-md overflow-x-auto">
          {displayList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {paymentInListFiltered.length === 0
                ? (filterToVoucherId ? "Current voucher not found for this account." : "No Receipt, Direct Income or Contra (in) found for this account.")
                : "No linkable amount remaining."}
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="table-row-stripe-7 w-full text-sm min-w-[600px]">
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
                  {displayList.map((row) => {
                    const currentVoucherLinked = Number(currentVoucherLinkedAmounts[row.id]) || 0;
                    const tentative = tentativeLinkedByRowId[row.id] ?? 0;
                    const otherLinked = Math.max(0, (row.alreadyLinked ?? 0) - currentVoucherLinked);
                    const currentLink = currentVoucherLinked + tentative;
                    return (
                    <tr
                      key={row.id}
                      role={displayOnly ? undefined : "button"}
                      onClick={displayOnly ? undefined : () => !(selectionFull && !checked.has(row.id)) && handleToggle(row.id)}
                      className={cn(
                        "border-b last:border-b-0",
                        !displayOnly && "hover:bg-muted/50 cursor-pointer",
                        checked.has(row.id) && "bg-muted/30",
                        !displayOnly && selectionFull && !checked.has(row.id) && "cursor-not-allowed opacity-70"
                      )}
                    >
                      <td className="p-2 w-10 whitespace-nowrap" onClick={(e) => displayOnly ? undefined : e.stopPropagation()}>
                        {/* Always show tick box: in displayOnly show checked+disabled; otherwise interactive. */}
                        <Checkbox
                          checked={displayOnly ? true : checked.has(row.id)}
                          onCheckedChange={displayOnly ? () => {} : () => handleToggle(row.id)}
                          disabled={displayOnly || (!checked.has(row.id) && (selectionFull || row.linkable <= 0))}
                        />
                      </td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{row.date ? formatDateBySystem(row.date) : "—"}</td>
                      <td className="p-2 font-medium whitespace-nowrap">{row.voucherNumber}</td>
                      <td className="p-2 whitespace-nowrap">{row.from}</td>
                      <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">{formatCurrency(row.amount)}</td>
                      <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(otherLinked)}</td>
                      <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(currentLink)}</td>
                      <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(Math.max(0, row.linkable + currentVoucherLinked - tentative))}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
        {!displayOnly && needsMore && (
          <p className="text-sm text-amber-600 font-medium px-1 shrink-0">Selected total is less than required. Choose more vouchers to cover the amount.</p>
        )}
        <DialogFooter className="shrink-0 !flex-row flex flex-wrap items-center gap-2 w-full justify-between sm:justify-between">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)} className="h-9 rounded-full shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
            {displayOnly ? "Close" : "Cancel"}
          </Button>
          {!displayOnly && (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
