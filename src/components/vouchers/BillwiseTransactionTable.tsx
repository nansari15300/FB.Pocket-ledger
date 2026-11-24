"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { useDate } from "@/hooks/useDate";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";
import { cn } from "@/lib/utils";
import type { StockView, Item } from "@/components/items/types";
import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { TxnRowMenuGrip } from "@/components/vouchers/TxnRowMenuGrip";
import { txnTableIconBtnCn } from "@/lib/listSelectionChrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { VoucherTypeFilter } from "@/components/vouchers/VoucherTypeFilter";
import {
  TransactionRow,
  getConversionFactor,
  formatQuantity,
  BillWiseLinkedDetailCells,
  type Transaction,
  type Context,
} from "./transactionTableShared";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/hooks/useCompany";
import {
  buildFiscalMergePartitionEntriesFromCompany,
  insertFiscalPartitionRowsMulti,
  FISCAL_YEAR_PARTITION_ROW_TYPE,
} from "@/lib/fiscalPartitionRows";

export type BillwiseTransactionTableProps = {
  transactions: Transaction[];
  context: Context;
  contextId?: string;
  openingBalance?: number;
  /** Bill-wise: outstanding for OB row (OB amount - linked). When set, OB row Net Balance and status use this. */
  openingBalanceOutstanding?: number;
  /** Bill-wise: voucher numbers that have allocated to OB (for status detail "to PYMT-9"). */
  openingBalanceLinkedVoucherNos?: string[];
  showNarration?: boolean;
  stockView?: StockView;
  item?: Item;
  displayUnit?: string;
  setDisplayUnit?: (unit: string) => void;
  journalAccountNames?: Record<string, string>;
  userNames?: Record<string, string>;
  filters?: Record<string, string>;
  setFilters?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  activeFilter?: string | null;
  setActiveFilter?: React.Dispatch<React.SetStateAction<string | null>>;
  onRowClick?: (transaction: any) => void;
  onDeleteVoucher?: (transaction: any) => void;
  onHistoryVoucher?: (transaction: any) => void;
  onAddLink?: (transaction: any) => void;
  onApproveVoucher?: (transaction: any) => void;
  periodDr?: number;
  periodCr?: number;
  closingBalance?: number;
  isTaxContext?: boolean;
  hideDebitColumn?: boolean;
  hideCreditColumn?: boolean;
  hideBalanceColumn?: boolean;
  hideFooter?: boolean;
  getDisplayValue?: (value: number) => string;
  voucherTypes?: string[];
  onVoucherTypeChange?: (types: string[]) => void;
  isBalanceMasked?: boolean;
  visibleColumns?: Record<string, boolean>;
  openingBalanceActions?: React.ReactNode;
  scrollOnlyTransactions?: boolean;
  statusFilter?: { paid: boolean; unpaid: boolean; partial: boolean; overdue: boolean };
  statusFilterAllChecked?: boolean;
  onStatusFilterAll?: () => void;
  onStatusFilterChange?: (key: "paid" | "unpaid" | "partial" | "overdue", checked: boolean) => void;
  statusFilterIdPrefix?: string;
  /** `isApproved` !== true → pink row (party/bank/report jaisa hi bill-wise table me) */
  highlightPendingApproval?: boolean;
};

export function BillwiseTransactionTable({
  transactions,
  context,
  openingBalance = 0,
  openingBalanceOutstanding,
  openingBalanceLinkedVoucherNos = [],
  showNarration = false,
  stockView = "amount",
  item,
  displayUnit,
  journalAccountNames,
  userNames,
  filters,
  setFilters,
  activeFilter,
  setActiveFilter,
  onRowClick,
  periodDr = 0,
  periodCr = 0,
  closingBalance = 0,
  isTaxContext,
  hideDebitColumn,
  hideCreditColumn,
  hideBalanceColumn,
  hideFooter,
  getDisplayValue: getDisplayValueProp,
  voucherTypes,
  onVoucherTypeChange,
  isBalanceMasked,
  openingBalanceActions,
  statusFilter,
  statusFilterAllChecked,
  onStatusFilterAll,
  onStatusFilterChange,
  statusFilterIdPrefix = "status",
  visibleColumns,
  onDeleteVoucher,
  onHistoryVoucher,
  onAddLink,
  onApproveVoucher,
  highlightPendingApproval = true,
}: BillwiseTransactionTableProps) {
  const showCol = (key: string) => visibleColumns == null || visibleColumns[key] !== false;
  const { company } = useCompany();
  // FY merge divider — company par local fiscal already merged (`useCompany`).
  const fiscalMergePartitions = useMemo(
    () => buildFiscalMergePartitionEntriesFromCompany(company),
    [company?.fiscalSplitMode, company?.fiscalMergePartitionAt, company?.fiscalMergePartitionAtIsos, company?.fiscalPartitionLabel, company?.country, company?.fiscalYearStart]
  );
  const displayTransactions = useMemo(
    () =>
      fiscalMergePartitions.length
        ? insertFiscalPartitionRowsMulti(transactions as any[], fiscalMergePartitions)
        : transactions,
    [transactions, fiscalMergePartitions]
  );
  const { formatDate, formatDateBS, formatCurrency, dateSystem } = useDate();
  const { settings: animationSettings } = useAnimationSettings();
  const isRowAnimationEnabled = animationSettings?.rows?.enabled === true;
  const rowAnimationDuration = isRowAnimationEnabled ? animationSettings.rows.duration : 0;
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Party/Staff/Group billwise: status shows only bill-wise link voucher no, not spend-wise (RCPT/PYMT/Contra).
  const statusBillWiseOnly = context === "party" || context === "staff" || context === "group";

  useEffect(() => {
    if (selectedId && !displayTransactions.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [displayTransactions, selectedId]);

  // Unselect when user clicks anywhere in the app outside the table (empty area, sidebar, etc.)
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const el = tableContainerRef.current;
      if (!el || !selectedId) return;
      if (!el.contains(e.target as Node)) setSelectedId(null);
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [selectedId]);

  const conversionFactor = useMemo(() => {
    if (context === "item" && stockView === "qty" && item) {
      return getConversionFactor(item, displayUnit);
    }
    return 1;
  }, [context, stockView, item, displayUnit]);

  const getDisplayValue = useCallback(
    (val: number) => {
      if (getDisplayValueProp) return getDisplayValueProp(val);
      const abs = Math.abs(val);
      return formatCurrency(abs, { noSuffix: true, context: "transaction" });
    },
    [getDisplayValueProp, formatCurrency]
  );

  const safeOpeningBalance = openingBalance ?? 0;
  const displayOpeningBalance = safeOpeningBalance / conversionFactor;
  const displayOpeningBalanceDr = displayOpeningBalance > 0 ? displayOpeningBalance : 0;
  const displayOpeningBalanceCr = displayOpeningBalance < 0 ? Math.abs(displayOpeningBalance) : 0;
  const obAmount = Math.abs(safeOpeningBalance) / conversionFactor;
  const obOutstandingDisplay = openingBalanceOutstanding != null ? openingBalanceOutstanding / conversionFactor : null;
  const obStatusLabel = obOutstandingDisplay != null
    ? (obOutstandingDisplay <= 0 ? "Paid" : obOutstandingDisplay >= obAmount ? "Unpaid" : "Partial")
    : null;
  const displayPeriodDr = periodDr / conversionFactor;
  const displayPeriodCr = periodCr / conversionFactor;
  const displayClosingBalance = closingBalance / conversionFactor;
  
  // Total includes opening balance: Dr opening balance adds to Debit total, Cr opening balance adds to Credit total
  const displayTotalDr = (displayPeriodDr || 0) + displayOpeningBalanceDr;
  const displayTotalCr = (displayPeriodCr || 0) + displayOpeningBalanceCr;

  const formatFooterBalance = (value: number) => {
    if (isBalanceMasked) return "*****";
    const isItemQty = context === "item" && stockView === "qty";
    if (isItemQty) return `${formatQuantity(value)} ${displayUnit || ""}`;
    const absValue = Math.abs(value);
    const suffix = value >= 0 ? "Dr" : "Cr";
    return (
      <span className={cn("font-bold", value >= 0 ? "text-green-700" : "text-red-700")}>
        {formatCurrency(absValue, { noSuffix: true, context: "transaction" })} {suffix}
      </span>
    );
  };

  const formatFooterAmount = (val: number) => {
    if (context === "item" && stockView === "qty") {
      return `${formatQuantity(val)} ${displayUnit || ""}`;
    }
    return getDisplayValue(val);
  };

  const ensureMinGaps = true;

  const dateCols = dateSystem === "Both" ? 2 : 1;
  const visibleLabelCols =
    (showCol("date") ? dateCols : 0) +
    (showCol("type") ? 1 : 0) +
    (showCol("voucherNo") ? 1 : 0) +
    (context === "daybook" ? 1 : 0) +
    (showCol("user") && context !== "note" ? 1 : 0);
  const openingBalanceColSpan = visibleLabelCols;
  const totalColSpan = visibleLabelCols;
  // Partition banner row: nested table ke saath bhi colspan = visible columns + actions.
  const fullRowColSpan =
    openingBalanceColSpan +
    (showCol("dr") && !hideDebitColumn ? 1 : 0) +
    (showCol("cr") && !hideCreditColumn ? 1 : 0) +
    (showCol("status") ? 1 : 0) +
    (showCol("runningBalance") && !hideBalanceColumn ? 1 : 0) +
    1;
  const showOpeningBalance = ["party", "account", "staff", "tax", "item", "expense", "group"].includes(context);
  /** Cols before Status — linked-voucher sub-row ke liye empty left span */
  const openingBalanceLinkedLeftColSpan =
    openingBalanceColSpan +
    (showCol("dr") && !hideDebitColumn ? 1 : 0) +
    (showCol("cr") && !hideCreditColumn ? 1 : 0);
  const hasObLinkedVoucherDetail = showNarration && (openingBalanceLinkedVoucherNos?.length ?? 0) > 0;

  const renderHeaderWithFilter = (key: string, label: string, isNumeric: boolean = false, minWidthPx?: number) => {
    const isFiltered = !!(filters && filters[key]) || (key === "type" && voucherTypes && voucherTypes.length > 0 && !voucherTypes.includes("all"));
    const innerPadding = ensureMinGaps ? "px-[10px]" : "px-2";
    return (
      <TableHead key={key} className={cn("p-0", isNumeric && "text-right")} style={ensureMinGaps && minWidthPx != null ? { minWidth: `${minWidthPx}px` } : undefined}>
        <div
          className={cn(
            "flex items-center gap-1 font-bold py-3 text-black whitespace-nowrap",
            innerPadding,
            isFiltered ? "text-red-600" : "text-black",
            isNumeric ? "justify-end" : "justify-start"
          )}
        >
          <div className="flex items-center">
            <span>{label}</span>
            {/* modal: filter input pe pehla click popover band na kare — match TransactionsTable header filters */}
            {(setFilters || (key === "type" && onVoucherTypeChange)) && (
              <Popover
                modal
                open={activeFilter === key}
                onOpenChange={(open) => setActiveFilter && setActiveFilter(open ? key : null)}
              >
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" data-pl-txn-icon-btn="" className={cn(txnTableIconBtnCn, "h-6 w-6", isNumeric ? "ml-1" : "ml-0")}>
                    <Filter className={cn("h-4 w-4", isFiltered && "text-red-600")} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-1 w-48"
                  onCloseAutoFocus={(e: Event) => e.preventDefault()}
                >
                  {key === "type" && onVoucherTypeChange ? (
                    <VoucherTypeFilter
                      selectedTypes={voucherTypes || ["all"]}
                      onSelectionChange={onVoucherTypeChange}
                    />
                  ) : setFilters ? (
                    <Input
                      placeholder={`Filter ${label}...`}
                      value={filters ? filters[key] || "" : ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const newValue = e.target.value;
                        setFilters((prev: Record<string, string>) => ({ ...prev, [key]: newValue }));
                      }}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter" && setActiveFilter) setActiveFilter(null);
                      }}
                      autoFocus
                    />
                  ) : null}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </TableHead>
    );
  };

  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (displayTransactions.length === 0) return;
      const idx = displayTransactions.findIndex((t) => t.id === selectedId);
      const currentIndex = idx >= 0 ? idx : -1;
      if (e.key === "ArrowDown" && currentIndex < displayTransactions.length - 1) {
        e.preventDefault();
        setSelectedId(displayTransactions[currentIndex + 1].id);
      } else if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault();
        setSelectedId(displayTransactions[currentIndex - 1].id);
      } else if (e.key === "Enter" && currentIndex >= 0) {
        e.preventDefault();
        const row = displayTransactions[currentIndex];
        if ((row as any)?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE) onRowClick?.(row);
      }
    },
    [displayTransactions, selectedId, onRowClick]
  );

  return (
    <div
      ref={tableContainerRef}
      tabIndex={0}
      role="grid"
      aria-label="Transactions"
      data-theme-table="transactions"
      className="w-full min-w-0 overflow-x-auto scrollbar-slim-dim outline-none focus:outline-none"
      onKeyDown={handleTableKeyDown}
      onClick={() => tableContainerRef.current?.focus()}
    >
      <Table className={ensureMinGaps ? "table-auto w-full" : "table-fixed w-full min-w-[750px]"} scrollContainer={false}>
        <TableHeader>
          <TableRow className="border-b-4 border-black hover:bg-transparent">
            {showCol("date") &&
              (dateSystem === "Both" ? (
                <>
                  {renderHeaderWithFilter("date_bs", "Date (BS)", false, ensureMinGaps ? 95 : undefined)}
                  {renderHeaderWithFilter("date_ad", "Date (AD)", false, ensureMinGaps ? 95 : undefined)}
                </>
              ) : (
                renderHeaderWithFilter("date", "Date", false, ensureMinGaps ? 95 : undefined)
              ))}
            {showCol("type") && renderHeaderWithFilter("type", "Type", false, ensureMinGaps ? 75 : undefined)}
            {showCol("voucherNo") && renderHeaderWithFilter("voucherNumber", "Voucher No.", false, ensureMinGaps ? 105 : undefined)}
            {context === "daybook" && renderHeaderWithFilter("accounts", "Accounts", false, ensureMinGaps ? 120 : undefined)}
            {showCol("user") && context !== "note" && renderHeaderWithFilter("user", "User", false, ensureMinGaps ? 148 : undefined)}
            {showCol("dr") && !hideDebitColumn && renderHeaderWithFilter("debit", stockView === "amount" ? "Debit" : "In", true, ensureMinGaps ? 100 : undefined)}
            {showCol("cr") && !hideCreditColumn && renderHeaderWithFilter("credit", stockView === "amount" ? "Credit" : "Out", true, ensureMinGaps ? 100 : undefined)}
            {showCol("status") && (
              <TableHead className="p-0" style={ensureMinGaps ? { minWidth: "95px" } : undefined}>
                <div className={cn("flex items-center gap-1 font-bold py-3 text-black whitespace-nowrap justify-center", ensureMinGaps ? "px-[10px]" : "px-2")}>
                  <span>Status</span>
                  {statusFilter != null && onStatusFilterAll != null && onStatusFilterChange != null ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-pl-txn-icon-btn=""
                          className={cn(txnTableIconBtnCn, "h-6 w-6 ml-1", statusFilterAllChecked === false && "text-red-600")}
                        >
                          <Filter className={cn("h-4 w-4", statusFilterAllChecked === false && "text-red-600")} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" className="w-52 p-2">
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="flex items-center gap-2 cursor-pointer font-medium border-b pb-2 mb-1">
                          <Checkbox id={`${statusFilterIdPrefix}-all`} checked={!!statusFilterAllChecked} onCheckedChange={() => onStatusFilterAll()} />
                          <label htmlFor={`${statusFilterIdPrefix}-all`} className="text-sm font-medium cursor-pointer flex-1">All</label>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox id={`${statusFilterIdPrefix}-paid`} checked={statusFilter.paid} onCheckedChange={(c) => onStatusFilterChange("paid", Boolean(c))} />
                          <label htmlFor={`${statusFilterIdPrefix}-paid`} className="text-sm font-medium cursor-pointer flex-1">Paid</label>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox id={`${statusFilterIdPrefix}-unpaid`} checked={statusFilter.unpaid} onCheckedChange={(c) => onStatusFilterChange("unpaid", Boolean(c))} />
                          <label htmlFor={`${statusFilterIdPrefix}-unpaid`} className="text-sm font-medium cursor-pointer flex-1">Unpaid</label>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox id={`${statusFilterIdPrefix}-partial`} checked={statusFilter.partial} onCheckedChange={(c) => onStatusFilterChange("partial", Boolean(c))} />
                          <label htmlFor={`${statusFilterIdPrefix}-partial`} className="text-sm font-medium cursor-pointer flex-1">Partial</label>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox id={`${statusFilterIdPrefix}-overdue`} checked={statusFilter.overdue} onCheckedChange={(c) => onStatusFilterChange("overdue", Boolean(c))} />
                          <label htmlFor={`${statusFilterIdPrefix}-overdue`} className="text-sm font-medium cursor-pointer flex-1">Overdue</label>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="w-6 ml-1" />
                  )}
                </div>
              </TableHead>
            )}
            {showCol("runningBalance") && !hideBalanceColumn && renderHeaderWithFilter("balance", stockView === "amount" ? "Net Balance" : "Stock", true, ensureMinGaps ? 115 : undefined)}
            <TableHead className="w-10 p-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence mode="popLayout">
            {showOpeningBalance && (
              <motion.tr
                key="opening-balance-row"
                data-row="opening-balance"
                layout="position"
                initial={false}
                exit={{ transition: { duration: 0 } }}
                transition={
                  isRowAnimationEnabled
                    ? { duration: rowAnimationDuration, ease: "easeInOut" }
                    : { duration: 0 }
                }
              >
                <TableCell colSpan={openingBalanceColSpan} className="font-semibold">
                  Opening Balance
                </TableCell>
                {showCol("dr") && !hideDebitColumn && (
                  <TableCell className={cn("text-right text-green-700 font-semibold", ensureMinGaps && "min-w-[100px] px-[5px]")}>
                    {displayOpeningBalanceDr > 0 ? formatFooterAmount(displayOpeningBalanceDr) : "-"}
                  </TableCell>
                )}
                {showCol("cr") && !hideCreditColumn && (
                  <TableCell className={cn("text-right text-red-700 font-semibold", ensureMinGaps && "min-w-[100px] px-[5px]")}>
                    {displayOpeningBalanceCr > 0 ? formatFooterAmount(displayOpeningBalanceCr) : "-"}
                  </TableCell>
                )}
                {/* Keep opening-balance status vertically centered with amount columns. */}
                {showCol("status") && (
                  <TableCell className={cn("text-center align-middle", ensureMinGaps && "min-w-[95px] px-[5px]")}>
                    {obStatusLabel != null ? (
                      <div className="flex flex-col items-center gap-[1px] leading-tight">
                        <Badge
                          variant="outline"
                          className={cn(
                            // Match Type/Status badge dimensions for consistent row alignment.
                            "inline-flex h-6 items-center rounded-xl px-2.5 font-medium leading-none shrink-0",
                            obStatusLabel === "Paid" ? "text-green-600 border-green-600/50" : "text-red-600 border-red-600/50"
                          )}
                        >
                          {obStatusLabel}
                        </Badge>
                      </div>
                    ) : (
                      <span className="font-semibold">-</span>
                    )}
                  </TableCell>
                )}
                {showCol("runningBalance") && !hideBalanceColumn && (
                  <TableCell className={cn("text-right font-semibold", (obOutstandingDisplay != null ? (safeOpeningBalance >= 0 ? obOutstandingDisplay : -obOutstandingDisplay) : displayOpeningBalance) >= 0 ? "text-green-600" : "text-red-600", ensureMinGaps && "min-w-[115px] px-[5px]")}>
                    {obOutstandingDisplay != null
                      ? formatFooterBalance(safeOpeningBalance >= 0 ? obOutstandingDisplay : -obOutstandingDisplay)
                      : formatFooterBalance(displayOpeningBalance)}
                  </TableCell>
                )}
                <TableCell className="w-10 p-1 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                  {openingBalanceActions != null ? (
                    openingBalanceActions
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-pl-txn-icon-btn="" className={cn(txnTableIconBtnCn, "h-8 w-8 shrink-0")}>
                          <TxnRowMenuGrip />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40" />
                    </DropdownMenu>
                  )}
                </TableCell>
              </motion.tr>
            )}
            {showOpeningBalance && hasObLinkedVoucherDetail && (
              <tr data-row="opening-balance-linked" className="narration-row border-b [&>td]:!pt-0 [&>td]:!pb-0">
                <TableCell colSpan={openingBalanceLinkedLeftColSpan} className="py-0" />
                <BillWiseLinkedDetailCells
                  vouchers={openingBalanceLinkedVoucherNos ?? []}
                  billWisePink
                  showStatus={showCol("status")}
                  showBalance={showCol("runningBalance")}
                  hideBalanceColumn={hideBalanceColumn}
                  ensureMinGaps={ensureMinGaps}
                />
                <TableCell className="w-10 p-0" />
              </tr>
            )}
            {displayTransactions.length > 0 ? (
              displayTransactions.map((t: any, rowIndex: number) => (
                <TransactionRow
                  key={t.id}
                  txnStripeIndex={rowIndex}
                  transaction={t}
                  fullRowColSpan={fullRowColSpan}
                  animateLayout={true}
                  showNarration={showNarration}
                  userNames={userNames}
                  journalAccountNames={journalAccountNames}
                  context={context}
                  stockView={stockView}
                  displayUnit={displayUnit}
                  item={item}
                  onRowClick={onRowClick}
                  onAddLink={onAddLink}
                  onDeleteVoucher={onDeleteVoucher}
                  onHistoryVoucher={onHistoryVoucher}
                  onApproveVoucher={onApproveVoucher}
                  onRowSelect={(tx: { id: string }) => setSelectedId(tx.id)}
                  isSelected={selectedId === t.id}
                  getDisplayValue={getDisplayValue}
                  isTaxContext={isTaxContext}
                  isBalanceMasked={isBalanceMasked}
                  hideBalanceColumn={hideBalanceColumn}
                  visibleColumns={visibleColumns}
                  useOutstandingForBalance={context === "party" || context === "staff"}
                  isBillWise={true}
                  ensureMinGaps={ensureMinGaps}
                  statusBillWiseOnly={statusBillWiseOnly}
                  highlightPendingApproval={highlightPendingApproval}
                />
              ))
            ) : (
              <tr key="no-records-row">
                <TableCell
                  colSpan={(dateSystem === "Both" ? 5 : 4) + (context === "daybook" ? 1 : 0) + (context === "note" ? -1 : 0) + 2}
                  className="text-center text-gray-500 py-2"
                >
                  No matching records found
                </TableCell>
              </tr>
            )}
          </AnimatePresence>
        </TableBody>
        {!hideFooter && (
          <TableFooter className="bg-white shadow-inner border-t">
            <TableRow>
              <TableCell colSpan={totalColSpan} className="text-right font-semibold">
                Total
              </TableCell>
              {showCol("dr") && !hideDebitColumn && (
                <TableCell className={cn("text-right text-green-700 font-semibold", ensureMinGaps && "min-w-[100px] px-[5px]")}>{formatFooterAmount(displayTotalDr)}</TableCell>
              )}
              {showCol("cr") && !hideCreditColumn && (
                <TableCell className={cn("text-right text-red-700 font-semibold", ensureMinGaps && "min-w-[100px] px-[5px]")}>{formatFooterAmount(displayTotalCr)}</TableCell>
              )}
              {showCol("status") && <TableCell className={cn("text-center font-semibold", ensureMinGaps && "min-w-[95px] px-[5px]")}>-</TableCell>}
              {showCol("runningBalance") && !hideBalanceColumn && <TableCell className={cn("text-right font-semibold", ensureMinGaps && "min-w-[115px] px-[5px]")}>-</TableCell>}
              <TableCell className="w-10 p-0" />
            </TableRow>
            <TableRow className="border-t-2 border-black font-bold text-base bg-muted/30">
              <TableCell
                colSpan={totalColSpan + (showCol("dr") && !hideDebitColumn ? 1 : 0) + (showCol("cr") && !hideCreditColumn ? 1 : 0) + (showCol("status") ? 1 : 0)}
                className="text-right"
              >
                Closing Balance
              </TableCell>
              {showCol("runningBalance") && !hideBalanceColumn && (
                <TableCell className={cn("text-right font-bold", closingBalance >= 0 ? "text-green-700" : "text-red-700", ensureMinGaps && "min-w-[115px] px-[5px]")}>
                  {formatFooterBalance(displayClosingBalance)}
                </TableCell>
              )}
              <TableCell className="w-10 p-0" />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
