
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  FilePlus,
  Pencil,
  Printer,
  ArrowLeft,
  Search,
  Calendar as CalendarIcon,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "@/components/ui/ad-calendar";
import AdCalendar from "@/components/ui/ad-calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import {
  type TransactionSortBy,
  type TransactionSortOrder,
} from "@/components/vouchers/TransactionTableSortDropdown";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { ReportMobileLedgerFooter } from "@/components/reports/ReportMobileLedgerFooter";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import {
  COLUMN_LABELS,
  useTransactionVisibleColumns,
} from "@/components/vouchers/transactionColumnVisibility";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useStatementCheckMode } from "@/hooks/useStatementCheckMode";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";

import {
  sortTransactionsWithFiscalMergeForCompany,
  sortTransactions,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import { applyStatementCheckModeHiddenToLedgerList } from "@/lib/statementCheckModeLedger";
import { useDate } from "@/hooks/useDate";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";
import { LedgerHeaderReminderButton, type LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { ScrollArea } from "../ui/scroll-area";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { openPrintDirect } from "@/lib/printDirect";
import { useCompany } from "@/hooks/useCompany";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { cn } from "@/lib/utils";
import {
  LEDGER_DATE_RANGE_PILL_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_IMAGE_CN,
  LEDGER_HEADER_AVATAR_PEN_CN,
  LEDGER_HEADER_NAME_CARD_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_TITLE_CN,
} from "@/lib/ledgerHeaderChrome";
import { LedgerHeaderPillRow } from "@/components/vouchers/LedgerHeaderPillRow";
import { mdc, mobileTxnScrollBodyClass } from "@/lib/mobileDetailChrome";
import * as XLSX from "xlsx";

const NOTE_TABLE_COLUMN_KEYS: TransactionColumnKey[] = ["syncStatus", "date", "type", "voucherNo", "file"];

export function NoteDetails({
  entity,
  transactions,
  userNames,
  onShowAll,
  isAllVouchersView,
  onBack,
  mobileFooterVariant = "ledger",
  mobileReportStickyTitle,
  transactionsAlreadyFiltered = false,
}: {
  entity: any;
  transactions: any[];
  userNames?: Record<string, string>;
  onShowAll?: () => void;
  isAllVouchersView?: boolean;
  onBack?: () => void;
  mobileFooterVariant?: "ledger" | "report";
  mobileReportStickyTitle?: string;
  /** Report details pass an already entity-filtered voucher list. */
  transactionsAlreadyFiltered?: boolean;
}) {
  const { formatDate, formatDateBS, dateSystem } = useDate();
  const { company, companyId } = useCompany();
  const isMobile = useIsMobile();
  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
  const [selectedVoucher, setSelectedVoucher] = React.useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = React.useState(false);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = React.useState(false);
  const [isReminderOpen, setIsReminderOpen] = React.useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [showNarration, setShowNarration] = useState(true);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const calendarMonths = useCalendarMonths();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [isAdCalendarOpen, setIsAdCalendarOpen] = useState(false);
  const {
    unapprovedOnly,
    toggleUnapprovedOnly,
    onDateRangeChangeWithUnapprovedReset,
  } = useLedgerUnapprovedOnlyFilter({
    onDateRangeChange: setDateRange,
    setCurrentPage,
    setFilters,
    setActiveFilter,
  });

  // Account / "All Vouchers" switch par purana page index mat rakho — nahi to nayi list pe galat slice dikhti hai.
  useEffect(() => {
    setCurrentPage(1);
  }, [entity?.id, entity?.type, isAllVouchersView]);

  useEffect(() => {
    setCurrentPage(1);
  }, [mobileSearchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange?.from?.getTime(), dateRange?.to?.getTime(), unapprovedOnly]);

  const handleEditVoucher = (voucher: any) => {
    setSelectedVoucher(voucher);
    setIsVoucherDialogOpen(true);
  };

  const currentTransactions = useMemo(() => {
    let baseTransactions = transactions;

    if (!isAllVouchersView && entity && !transactionsAlreadyFiltered) {
      baseTransactions = transactions.filter(
        (v) => v.entityId === entity.id && v.context === entity.type
      );
    }

    let filteredTransactions = baseTransactions;
    if (dateRange?.from || dateRange?.to) {
      const fromMs = dateRange.from ? startOfDay(dateRange.from).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = dateRange.to ? endOfDay(dateRange.to).getTime() : Number.POSITIVE_INFINITY;
      filteredTransactions = filteredTransactions.filter((t: any) => {
        const rawDate = t?.date?.toDate ? t.date.toDate() : t?.date;
        const dateMs = rawDate instanceof Date ? rawDate.getTime() : new Date(rawDate ?? "").getTime();
        return Number.isFinite(dateMs) && dateMs >= fromMs && dateMs <= toMs;
      });
    }
    if (unapprovedOnly) {
      filteredTransactions = filteredTransactions.filter((t: any) => t?.isApproved !== true);
    }
    if (Object.values(filters).some((v) => v)) {
      return filteredTransactions.filter((t: any) => {
        return Object.entries(filters).every(([key, value]) => {
          if (!value) return true;
          const lowerCaseValue = value.toLowerCase();

          let cellValue = "";
          switch (key) {
            case "voucherNumber":
              cellValue = t.voucherNumber || "";
              break;
            case "title":
              cellValue = t.title || "";
              break;
            case "date_bs": {
              const d_bs = t.date?.toDate ? t.date.toDate() : new Date(t.date);
              cellValue = d_bs ? formatDateBS(d_bs) : "";
              break;
            }
            case "date_ad": {
              const d_ad = t.date?.toDate ? t.date.toDate() : new Date(t.date);
              cellValue = d_ad ? formatDate(d_ad) : "";
              break;
            }
            case "type":
              cellValue = t.type ? voucherTypeDisplayText(t.type) : "";
              break;
            default:
              return true;
          }
          return cellValue.toLowerCase().includes(lowerCaseValue);
        });
      });
    }

    return filteredTransactions;
  }, [transactions, filters, isAllVouchersView, entity, transactionsAlreadyFiltered, formatDate, formatDateBS, dateRange, unapprovedOnly]);

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const handleAdDateSelect = useCallback((date: Date) => {
    const current = dateRange;
    let nextRange: DateRange;
    if (!current?.from || current.to) {
      nextRange = { from: date };
    } else if (date < current.from) {
      nextRange = { from: date, to: current.from };
    } else {
      nextRange = { from: current.from, to: date };
    }
    onDateRangeChangeWithUnapprovedReset(nextRange);
    if (nextRange.to) setIsAdCalendarOpen(false);
  }, [dateRange, onDateRangeChangeWithUnapprovedReset]);

  const dateFilterControls = (
    <>
      {(dateSystem === "BS" || dateSystem === "Both") ? (
        <BsDatePicker
          isRange
          valueAD={dateRange}
          onChangeAD={onDateRangeChangeWithUnapprovedReset}
          className={LEDGER_DATE_RANGE_PILL_CN}
        />
      ) : null}
      {(dateSystem === "AD" || dateSystem === "Both") ? (
        <Popover open={isAdCalendarOpen} onOpenChange={setIsAdCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(LEDGER_DATE_RANGE_PILL_CN, "justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
              data-theme-detail="date-range"
            >
              <CalendarIcon className={cn("mr-1.5", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
              {dateRange?.from ? (
                dateRange.to
                  ? `${format(dateRange.from, "LLL dd, y")} - ${format(dateRange.to, "LLL dd, y")}`
                  : format(dateRange.from, "LLL dd, y")
              ) : "Pick a date range"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <AdCalendar valueAD={dateRange} isRange numberOfMonths={calendarMonths} onSelect={handleAdDateSelect} />
          </PopoverContent>
        </Popover>
      ) : null}
      {dateRange ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={LEDGER_HEADER_PILL_ICON_CN}
          onClick={() => onDateRangeChangeWithUnapprovedReset(undefined)}
          aria-label="Clear date filter"
        >
          <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
        </Button>
      ) : null}
    </>
  );

  const handlePrint = () => {
    if (!company) return;

    const title = isAllVouchersView ? "All Notes" : `Notes: ${entity.name}`;
    const dateRangeText = dateRange?.from
      ? `${dateSystem === "BS" ? formatDateBS(dateRange.from) : formatDate(dateRange.from)} to ${dateRange.to ? (dateSystem === "BS" ? formatDateBS(dateRange.to) : formatDate(dateRange.to)) : "…"}`
      : "All Time";

    openPrintDirect(
      {
        company: {
          name: company.name,
          pan: company.pan,
          phone: company.phone,
          address: company.address,
          decimalPlaces: company.decimalPlaces,
          showDrCr: company.showDrCr,
          showCurrencySymbol: company.showCurrencySymbol,
          logoUrl: company.logoUrl,
        },
        title: title,
        context: "note",
        contextId: entity.id,
        dateSystem: dateSystem,
        dateRangeText,
        vouchersCount: currentTransactions.length,
        openingBalance: 0,
        transactions: currentTransactions,
        showNarration: showNarration,
        userNames: userNames,
      },
      true
    );
  };

  const reminderDialog = (
    <LedgerReminderDialog
      open={isReminderOpen}
      onOpenChange={setIsReminderOpen}
      context={entity?.id === "all" ? undefined : entity?.type as LedgerReminderContext | undefined}
      entityId={entity?.id === "all" ? undefined : entity?.id}
      title={entity?.id === "all" ? "All Notes" : entity?.name}
    />
  );

  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const sortedTransactions = useMemo(
    () => sortTransactionsWithFiscalMergeForCompany(currentTransactions, "date", DEFAULT_TRANSACTION_SORT_ORDER, undefined, company),
    [currentTransactions, company]
  );

  const searchFilteredTransactions = useMemo(() => {
    if (!mobileSearchTerm.trim()) return sortedTransactions;
    const q = mobileSearchTerm.toLowerCase();
    return sortedTransactions.filter((t: any) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return (
        String(t.voucherNumber || "")
          .toLowerCase()
          .includes(q) ||
        String(t.title || "")
          .toLowerCase()
          .includes(q) ||
        String(t.narration || "")
          .toLowerCase()
          .includes(q) ||
        formatDate(d).toLowerCase().includes(q) ||
        formatDateBS(d).toLowerCase().includes(q)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, formatDate, formatDateBS]);

  const [keyboardNavList, setKeyboardNavList] = useState<ReadonlyArray<{ id?: string; _rowKey?: string }>>([]);

  const statementCheck = useStatementCheckMode({
    companyId,
    context: "note",
    contextId: entity?.id,
    viewMode: "statement",
    orderedTransactions: searchFilteredTransactions,
    keyboardNavTransactions: keyboardNavList,
  });

  const transactionsForPaging = useMemo(
    () =>
      applyStatementCheckModeHiddenToLedgerList(searchFilteredTransactions, {
        checkModeActive: statementCheck.checkModeActive,
        hiddenIds: statementCheck.hiddenIds,
        openingBalance: 0,
      }),
    [
      searchFilteredTransactions,
      statementCheck.checkModeActive,
      statementCheck.hiddenIds,
    ]
  );

  // All Notes: page 1 = latest batch (party tail jaisa); single account = page 1 = oldest (head).
  const useTailPaging = Boolean(isAllVouchersView);

  const notePagingWindow = useMemo(() => {
    const list = transactionsForPaging;
    const total = list.length;
    const totalPagesLocal = rowsPerPage > 0 ? Math.max(1, Math.ceil(total / rowsPerPage)) : 1;
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    if (rowsPerPage <= 0) {
      return {
        totalPages: 1,
        pageTransactions: sortTransactionsWithFiscalMergeForCompany(list, sortBy, sortOrder, undefined, company),
        before: 0,
        after: 0,
      };
    }
    if (useTailPaging) {
      const end = total - (safePage - 1) * rowsPerPage;
      const start = Math.max(0, end - rowsPerPage);
      const pageSlice = list.slice(start, end);
      return {
        totalPages: totalPagesLocal,
        pageTransactions: sortTransactionsWithFiscalMergeForCompany(pageSlice, sortBy, sortOrder, undefined, company),
        before: start,
        after: Math.max(0, total - end),
      };
    }
    const start = (safePage - 1) * rowsPerPage;
    const end = Math.min(start + rowsPerPage, total);
    const pageSlice = list.slice(start, end);
    return {
      totalPages: totalPagesLocal,
      pageTransactions: sortTransactionsWithFiscalMergeForCompany(pageSlice, sortBy, sortOrder, undefined, company),
      before: start,
      after: Math.max(0, total - end),
    };
  }, [transactionsForPaging, currentPage, rowsPerPage, useTailPaging, sortBy, sortOrder, company]);

  const paginatedTransactions = notePagingWindow.pageTransactions;
  const totalPages = notePagingWindow.totalPages;
  const mobilePagerEdgeCounts = { before: notePagingWindow.before, after: notePagingWindow.after };
  const noteBeforeCount = notePagingWindow.before;
  const noteAfterCount = notePagingWindow.after;

  useEffect(() => {
    setKeyboardNavList(paginatedTransactions);
  }, [paginatedTransactions]);

  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "20");

  // List size / page-size change par page valid range me rakho (tail: 1 = latest).
  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  const reportStickyTitle = mobileReportStickyTitle ?? "Notes";
  const reportHeaderTitleOnly = isAllVouchersView || entity?.id === "all";

  const handleExcelLedger = useCallback(() => {
    const rows = searchFilteredTransactions.map((t: Record<string, unknown>) => {
      const dRaw = (t as { date?: { toDate?: () => Date } }).date;
      const d = dRaw?.toDate ? dRaw.toDate() : new Date((t as { date?: unknown }).date as string | number | Date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": (t as { voucherNumber?: string }).voucherNumber,
        Title: String((t as { title?: string }).title || ""),
        Narration: String((t as { narration?: string }).narration || ""),
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Notes");
    const safeName = (isAllVouchersView ? "All_Notes" : entity?.name || "notes").replace(/[/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeName}.xlsx`);
  }, [searchFilteredTransactions, formatDate, formatDateBS, isAllVouchersView, entity?.name]);

  if (isMobile) {
    const isReportMobileChrome = mobileFooterVariant === "report";

    return (
      <>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
          {onBack ? (
            <header className="sticky top-0 z-10 flex-shrink-0 border-b bg-white p-3 dark:bg-card">
              <div className="flex min-w-0 items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onBack} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {reportHeaderTitleOnly ? (
                  <h1 className="min-w-0 flex-1 text-base font-bold text-muted-foreground">
                    {isReportMobileChrome ? reportStickyTitle : entity.name}
                  </h1>
                ) : (
                  <h1 className="min-w-0 flex-1 truncate text-base font-bold text-muted-foreground">{entity.name}</h1>
                )}
              </div>
            </header>
          ) : (
            <div className="flex-shrink-0 border-b px-3 py-2">
              <h1 className="text-base font-bold text-muted-foreground">{entity.name}</h1>
            </div>
          )}
          <MobileDetailSummaryCollapsible>
            <div className="flex flex-shrink-0 items-center justify-center gap-1 border-b px-2 py-1">
              <span className="text-xs font-medium text-muted-foreground">
                {searchFilteredTransactions.length} note(s) · {dateRange?.from
                  ? dateRange.to
                    ? `${formatDate(dateRange.from)} - ${formatDate(dateRange.to)}`
                    : formatDate(dateRange.from)
                  : "All Time"}
              </span>
            </div>
            <div className="flex-shrink-0 border-b p-2 space-y-2">
              <div className="flex items-stretch gap-2">
                <div className="relative min-w-0 flex-1 h-9">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
                  <Input
                    placeholder="Search notes"
                    className="h-9 w-full pl-8 text-sm"
                    value={mobileSearchTerm}
                    onChange={(e) => setMobileSearchTerm(e.target.value)}
                  />
                </div>
                {onShowAll ? (
                  <Button
                    variant={isAllVouchersView ? "default" : "outline"}
                    size="sm"
                    className="h-9 shrink-0 text-xs"
                    onClick={onShowAll}
                  >
                    All Vouchers
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
                {dateFilterControls}
                <LedgerHeaderReminderButton onClick={() => setIsReminderOpen(true)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-title-note-mobile"
                  checked={showNarration}
                  onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                />
                <label htmlFor="show-title-note-mobile" className="text-xs font-medium leading-none">
                  Show Narration
                </label>
              </div>
            </div>
          </MobileDetailSummaryCollapsible>
          <div
            className={mobileTxnScrollBodyClass(isReportMobileChrome)}
          >
            <div className="pb-2 px-0.5">
              {paginatedTransactions.length > 0 ? (
                <TransactionsTable
                  transactions={paginatedTransactions}
                  context="note"
                  userNames={userNames}
                  onRowClick={handleEditVoucher}
                  filters={filters}
                  setFilters={setFilters}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  showNarration={showNarration}
                  scrollOnlyTransactions
                hideDebitColumn
                hideCreditColumn
                hideBalanceColumn
                hideFooter
                  transactionCardSearchHighlight={mobileSearchTerm}
                  visibleColumns={visibleColumns}
                  {...statementCheck.tableProps}
                />
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">No notes found.</div>
              )}
            </div>
          </div>
          {isReportMobileChrome ? (
            <MobileTransactionsPager
              className={mdc.reportTxnPagerOutside}
              currentPage={currentPage}
              totalItems={searchFilteredTransactions.length}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(nextRows) => {
                setRowsPerPage(nextRows);
                setCurrentPage(1);
              }}
              onPageChange={setCurrentPage}
              edgeCounts={rowsPerPage > 0 ? mobilePagerEdgeCounts : undefined}
              pagingMode={useTailPaging ? "newest-first" : "oldest-first"}
            />
          ) : null}
          {!isReportMobileChrome ? (
            <MobileTransactionsPager
              className={mdc.ledgerTxnPagerOutside}
              currentPage={currentPage}
              totalItems={searchFilteredTransactions.length}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(nextRows) => {
                setRowsPerPage(nextRows);
                setCurrentPage(1);
              }}
              onPageChange={setCurrentPage}
              edgeCounts={rowsPerPage > 0 ? mobilePagerEdgeCounts : undefined}
              pagingMode={useTailPaging ? "newest-first" : "oldest-first"}
            />
          ) : null}
        </div>
        {isReportMobileChrome ? (
          <ReportMobileLedgerFooter
            onPrint={handlePrint}
            onExcel={handleExcelLedger}
            onDateOpen={() => setIsNoteDialogOpen(true)}
            showBillWise={false}
            showChart={false}
          />
        ) : (
          <div className="fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around gap-1 border-t bg-background/95 p-1.5 backdrop-blur">
            <Button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-md bg-green-600 py-1 text-xs text-white hover:bg-green-700"
              onClick={handlePrint}
            >
              <Printer className="mb-0 h-4 w-4" />
              <span className="text-[10px] leading-tight">Print</span>
            </Button>
            <Button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-md bg-blue-600 py-1 text-xs text-white hover:bg-blue-700"
              onClick={() => setIsNoteDialogOpen(true)}
            >
              <FilePlus className="mb-0 h-4 w-4" />
              <span className="text-[10px] leading-tight">Add Note</span>
            </Button>
          </div>
        )}
        <AddVoucherDialog
          isOpen={isVoucherDialogOpen}
          onOpenChange={setIsVoucherDialogOpen}
          voucher={selectedVoucher}
          onVoucherCreated={() => setSelectedVoucher(null)}
        />
        {reminderDialog}
        <Dialog open={isNoteDialogOpen} onOpenChange={setIsNoteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Note</DialogTitle>
              <DialogDescription>
                Create a new note for {entity.id === "all" ? "any entity" : entity.name}.
              </DialogDescription>
            </DialogHeader>
            <CreateNoteForm
              initialEntityId={entity.id === "all" ? undefined : entity.id}
              initialContext={entity.id === "all" ? undefined : entity.type}
              onVoucherAction={() => {
                setIsNoteDialogOpen(false);
              }}
              compactFooter
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <LedgerTxnScrollColumn
        header={
          <div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
            <div className={LEDGER_HEADER_OUTER_ROW_CN}>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className={LEDGER_HEADER_AVATAR_CN}>
                  <Avatar className={LEDGER_HEADER_AVATAR_IMAGE_CN}>
                    <AvatarFallback className="rounded-none bg-muted p-0 text-muted-foreground">
                      <FilePlus className="h-6 w-6" aria-hidden />
                    </AvatarFallback>
                  </Avatar>
                  <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                <div className={LEDGER_HEADER_NAME_CARD_CN}>
                  <h2 className={LEDGER_HEADER_TITLE_CN} title={entity.name}>{entity.name}</h2>
                </div>
              </div>
              <LedgerHeaderPillRow>
                <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
                {dateFilterControls}
                {onShowAll && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onShowAll}
                    className={cn(LEDGER_HEADER_PILL_CN, isAllVouchersView && "font-semibold text-blue-900")}
                  >
                    All Vouchers
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setIsNoteDialogOpen(true)} className={LEDGER_HEADER_PILL_CN}>
                  <FilePlus className={cn("mr-1.5", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
                </Button>
                <Button variant="outline" size="icon" onClick={handlePrint} className={LEDGER_HEADER_PILL_ICON_CN} aria-label="Print notes">
                  <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
                </Button>
                <LedgerHeaderReminderButton onClick={() => setIsReminderOpen(true)} />
              </LedgerHeaderPillRow>
            </div>
          </div>
        }
        table={
          <div className="pl-notes-detail-pane flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <TransactionsTable
              transactions={paginatedTransactions}
              context="note"
              userNames={userNames}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              showNarration={showNarration}
              scrollOnlyTransactions
              hideDebitColumn
              hideCreditColumn
              hideBalanceColumn
              hideFooter
              visibleColumns={visibleColumns}
              {...statementCheck.tableProps}
            />
            {currentTransactions.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">No notes found for this entity.</div>
            ) : null}
          </div>
        }
        footer={
          <LedgerDesktopFooter
          left={
            <>
              <LedgerFooterCheckboxPill
                id="show-narration-note"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
              <LedgerFooterColumnsMenu>
                <DropdownMenuContent align="start" className="w-52 p-2">
                  {NOTE_TABLE_COLUMN_KEYS.map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={(e) => e.preventDefault()}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <Checkbox
                        id={`col-${key}-note-report`}
                        checked={visibleColumns[key] !== false}
                        onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                      />
                      <label htmlFor={`col-${key}-note-report`} className="flex-1 cursor-pointer text-sm font-medium">
                        {COLUMN_LABELS[key]}
                      </label>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <StatementCheckModeFooterControls
                idPrefix="note-report"
                enabled={statementCheck.checkModeEnabled}
                onEnabledChange={statementCheck.setCheckModeEnabled}
                viewMode="statement"
                hiddenCount={statementCheck.hiddenCount}
              />
            </>
          }
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={(by, order) => {
            setSortBy(by);
            setSortOrder(order);
          }}
          viewMode="statement"
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
          rowsPerPageSelectValue={rowsPerPageSelectValue}
          onRowsPerPageChange={handleRowsPerPageChange}
          beforeCount={noteBeforeCount}
          afterCount={noteAfterCount}
          totalCount={transactionsForPaging.length}
        />
        }
      />
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={setIsVoucherDialogOpen}
        voucher={selectedVoucher}
        onVoucherCreated={() => setSelectedVoucher(null)}
      />
      {reminderDialog}
      <Dialog open={isNoteDialogOpen} onOpenChange={setIsNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>
              Create a new note for {entity.id === "all" ? "any entity" : entity.name}.
            </DialogDescription>
          </DialogHeader>
          <CreateNoteForm
            initialEntityId={entity.id === "all" ? undefined : entity.id}
            initialContext={entity.id === "all" ? undefined : entity.type}
            onVoucherAction={() => {
              setIsNoteDialogOpen(false);
            }}
            compactFooter
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
