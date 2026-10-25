
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Edit,
  FilePlus,
  Printer,
  ArrowLeft,
  Search,
} from "lucide-react";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import {
  type TransactionSortBy,
  type TransactionSortOrder,
} from "@/components/vouchers/TransactionTableSortDropdown";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { ReportMobileLedgerFooter } from "@/components/reports/ReportMobileLedgerFooter";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
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
import { useIsMobile } from "@/hooks/use-mobile";
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
}: {
  entity: any;
  transactions: any[];
  userNames?: Record<string, string>;
  onShowAll?: () => void;
  isAllVouchersView?: boolean;
  onBack?: () => void;
  mobileFooterVariant?: "ledger" | "report";
  mobileReportStickyTitle?: string;
}) {
  const { formatDate, formatDateBS, dateSystem } = useDate();
  const { company, companyId } = useCompany();
  const isMobile = useIsMobile();
  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
  const [selectedVoucher, setSelectedVoucher] = React.useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = React.useState(false);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = React.useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [showNarration, setShowNarration] = useState(true);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");

  // Account / "All Vouchers" switch par purana page index mat rakho — nahi to nayi list pe galat slice dikhti hai.
  useEffect(() => {
    setCurrentPage(1);
  }, [entity?.id, entity?.type, isAllVouchersView]);

  useEffect(() => {
    setCurrentPage(1);
  }, [mobileSearchTerm]);

  const handleEditVoucher = (voucher: any) => {
    setSelectedVoucher(voucher);
    setIsVoucherDialogOpen(true);
  };

  const currentTransactions = useMemo(() => {
    let baseTransactions = transactions;

    if (!isAllVouchersView && entity) {
      baseTransactions = transactions.filter(
        (v) => v.entityId === entity.id && v.context === entity.type
      );
    }

    if (Object.values(filters).some((v) => v)) {
      return baseTransactions.filter((t: any) => {
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

    return baseTransactions;
  }, [transactions, filters, isAllVouchersView, entity, formatDate, formatDateBS]);

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const handlePrint = () => {
    if (!company) return;

    const title = isAllVouchersView ? "All Notes" : `Notes: ${entity.name}`;

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
        dateRangeText: "All Time",
        vouchersCount: currentTransactions.length,
        openingBalance: 0,
        transactions: currentTransactions,
        showNarration: showNarration,
        userNames: userNames,
      },
      true
    );
  };

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
                {searchFilteredTransactions.length} note(s) · All Time
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
      <Card className="h-full flex flex-col">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>{entity.name}</CardTitle>
              {entity.id !== "all" && <CardDescription>Notes related to this entity.</CardDescription>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsNoteDialogOpen(true)}>
                <FilePlus className="mr-2 h-4 w-4" /> Add Note
              </Button>
              {onShowAll && (
                <Button
                  variant={isAllVouchersView ? "default" : "outline"}
                  size="sm"
                  onClick={onShowAll}
                  className={isAllVouchersView ? "bg-primary text-primary-foreground" : ""}
                >
                  All Vouchers
                </Button>
              )}
              <Button variant="outline" size="icon" onClick={handlePrint}>
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 flex flex-col min-h-0">
          <ScrollArea txnChrome className="flex-1">
            <div className="p-4">
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
                visibleColumns={visibleColumns}
                {...statementCheck.tableProps}
              />
              {transactions.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">No notes found for this entity.</div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
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
      </Card>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={setIsVoucherDialogOpen}
        voucher={selectedVoucher}
        onVoucherCreated={() => setSelectedVoucher(null)}
      />
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
