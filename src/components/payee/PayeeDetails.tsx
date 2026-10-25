
"use client";

import * as React from "react";
import { toast } from "sonner";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import type { Party } from "@/components/party/types";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Edit,
  Printer,
  Calendar as CalendarIcon,
  FilePlus,
  FileText,
  Search,
  Filter,
  XCircle,
  ArrowLeft,
  MoreVertical,
  Phone,
  MessageSquare,
  Gift,
  User,
  Receipt,
  Landmark,
  Wallet,
  Columns3,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { StaffAccountFallbackIcon } from "@/components/entity/StaffEntityIcon";
import { useState, useEffect, useMemo, useCallback } from "react";
import type { DateRange } from "@/components/ui/ad-calendar";
import { addDays, format, startOfDay, endOfDay, isSameDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import AdCalendar from "@/components/ui/ad-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDate } from "@/hooks/useDate";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_TRIGGER_CN,
  LEDGER_HEADER_AVATAR_IMAGE_CN,
  LEDGER_HEADER_AVATAR_PEN_CN,
  LEDGER_HEADER_NAME_CARD_CN,
  LEDGER_HEADER_BALANCE_CARD_CN,
  LEDGER_HEADER_BALANCE_STACK_CN,
  LEDGER_HEADER_BALANCE_LABEL_CN,
  LEDGER_HEADER_TITLE_CN,
  LEDGER_HEADER_BALANCE_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_PILL_ROW_CN,
  LEDGER_TXN_PAGE_ROOT_CN,
} from "@/lib/ledgerHeaderChrome";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { useCompany } from "@/hooks/useCompany";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { EditPartyDialog } from "@/components/party/EditPartyDialog";
import { useVouchers } from "@/hooks/useVouchers";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { TransactionsTable, type VisibleColumns, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { useStatementLedgerCheckModePaging } from "@/hooks/useStatementLedgerCheckModePaging";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { useLedgerDetailSessionMemory } from "@/hooks/useLedgerDetailSessionMemory";
import {
  ledgerDetailSessionStorageKey,
  writeLedgerDetailSessionSnapshot,
  type LedgerDetailViewMode,
} from "@/lib/ledgerDetailSessionMemory";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";


import { COLUMN_LABELS, useShowNotes, useTransactionVisibleColumns } from "../vouchers/transactionColumnVisibility";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { useTransactions } from "@/hooks/use-transactions";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import NepaliCalendar from "../ui/nepali-calendar";
import type { BSDate } from "@/lib/bs-date";
import { Combobox } from "../ui/combobox";
import { useRouter, useSearchParams } from "next/navigation";
import AnimatedNumber from "../ui/AnimatedNumber";

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
};

const getEntityIcon = (type: string, entity?: { groupId?: string | null; isLoanAccount?: boolean | null }) => {
    if (type === "Staff") return <StaffAccountFallbackIcon staff={entity} variant="detail" className="h-6 w-6" />;
    if (type === 'Tax') return <Receipt className="h-6 w-6" />;
    if (type === 'Income' || type === 'Expense') return <Wallet className="h-6 w-6" />;
    return <User className="h-6 w-6" />; // Default Party
};


export function PayeeDetails({
  party: initialParty,
  allParties,
  transactions: passedTransactions,
  onPartyUpdated,
  onPartyDeleted,
  onShowAll,
  dateRange,
  onDateRangeChange,
  isAllVouchersView,
  journalAccountNames,
  userNames,
  onBack,
  context,
}: {
  party: any; 
  allParties?: Party[];
  transactions?: any[];
  onPartyUpdated: () => void;
  onPartyDeleted: (deletedId: string) => void;
  onShowAll?: () => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  isAllVouchersView?: boolean;
  journalAccountNames?: Record<string, string>;
  userNames?: Record<string, string>;
  onBack?: () => void;
  context?: string;
}) {
  const { company, companyId } = useCompany();
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } =
    useDate();
  const { vouchers, processedParties } = useVouchers();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const searchParams = useSearchParams();

  const party = useMemo(() => {
    if (!processedParties || !initialParty) return initialParty;
    const fromStore = processedParties.find(p => p.id === initialParty.id);
    return fromStore ? { ...fromStore, type: initialParty.type } : initialParty;
  }, [processedParties, initialParty]);

  const entityType = useMemo(() => {
      const type = party.type || 'Party'; 
      if (type === 'Staff') return 'staff';
      if (type === 'Tax') return 'tax';
      if (type === 'Income' || type === 'Expense') return 'expense';
      if (type === 'Other') return 'other';
      return 'party'; 
  }, [party]);

  const transactionDates = useMemo(() => {
    if (!party || !passedTransactions) return [];
    return passedTransactions.map((t: any) => {
      if (t.date) {
        const d = typeof t.date === 'string' ? new Date(t.date) : t.date.toDate();
        return startOfDay(d);
      }
      return null;
    }).filter(Boolean) as Date[];
  }, [party, passedTransactions]);

  const { balanceMode } = useBalanceMode();

  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(20);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceMode === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && party?.id
        ? ledgerDetailSessionStorageKey(companyId, "payee", party.id, ledgerViewMode)
        : null,
    [companyId, party?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  useEffect(() => {
    setCurrentPage(1);
  }, [isAllVouchersView]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  
  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  useEffect(() => {
    setTempDateRange(dateRange);
  }, [dateRange]);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance, openingBalanceOutstanding, openingBalanceLinkedVoucherNos } = 
    useTransactions(party, entityType, dateRange, undefined, allParties, passedTransactions, context, filters, undefined, undefined, userNames);

  const handleEditVoucher = (voucher: any) => {
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    setIsVoucherDialogOpen(true);
  };

  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v);

  const clearFilters = () => {
    onDateRangeChange(undefined);
    setFilters({});
  };

  const {
    unapprovedOnly,
    toggleUnapprovedOnly,
    filterByUnapprovedOnly,
    onDateRangeChangeWithUnapprovedReset,
  } = useLedgerUnapprovedOnlyFilter({
    onDateRangeChange,
    setCurrentPage,
    setFilters,
    setActiveFilter,
  });

  const displayTransactions = useMemo(
    () => (includeNotesInTable ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note")),
    [processedTransactions, includeNotesInTable]
  );

  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const sortedTransactions = useMemo(
    () =>
      recomputeRunningBalanceTopToBottom(
        sortTransactionsWithFiscalMergeForCompany(
          filterByUnapprovedOnly(displayTransactions), "date", DEFAULT_TRANSACTION_SORT_ORDER, undefined, company),
        openingBalanceForPeriod
      ),
    [displayTransactions, filterByUnapprovedOnly, openingBalanceForPeriod, company]
  );

  // Statement check + tail paging (LedgerDesktopFooter ke saath align)
  const {
    statementCheck,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "payee",
    contextId: party?.id,
    viewMode: balanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions: sortedTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning: openingBalanceForPeriod,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "payee",
    contextId: party?.id,
    viewMode: ledgerViewMode,
    totalPages,
    currentPage,
    setCurrentPage,
    vouchers,
    selectedVoucherId: selectedVoucher?.id ?? null,
    isVoucherDialogOpen,
    setSelectedVoucher,
    setIsVoucherDialogOpen,
  });

  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "20");
  const buildDateRangeText = () => {
    if (!dateRange?.from) return "All Time";
    const from = dateRange.from;
    const to = dateRange.to || dateRange.from;
    const fromAD = formatDate(from);
    const toAD = formatDate(to);
    const fromBS = formatDateBS(from);
    const toBS = formatDateBS(to);
    if (dateSystem === 'AD') return `AD: ${fromAD} to ${toAD}`;
    else if (dateSystem === 'BS') return `BS: ${fromBS} to ${toBS}`;
    else return `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
  };

  const handlePrintStatement = (billWise: boolean = false) => {
    if (!company) return Promise.resolve();
    return openPrintDirect(
      applyLedgerPageToPrintPayload(
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
          title: `${party.type || "Party"} Statement: ${party.name}`,
          context: entityType,
          contextId: party.id,
          dateSystem: dateSystem,
          dateRangeText: buildDateRangeText(),
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          journalAccountNames: journalAccountNames,
          billWise: billWise,
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          ledgerShowBookOpeningRow: currentPage === 1,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: dateRange?.from,
          dateRange,
        }
      ),
      true
    );
  };

  const handlePrint = () => {
    setTimeout(async () => {
      try {
        await handlePrintStatement(balanceMode === "bill_wise");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
      }
    }, 200);
  };
  
  if(!party) return null;

  return (
    <>
      <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Header: identity + pills — Party-style single row */}
        <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {isMobile && onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                <EntityFileAttachmentHover
                  fileUrl={trimEntityFileUrlForPreview(party.fileUrl)}
                triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
              >
                <ResolvedEntityAvatar
                  className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                    src={trimEntityFileUrlForPreview(party.fileUrl) ?? undefined}
                    alt={party.name}
                    fallbackSlot={<span className="text-muted-foreground">{getEntityIcon(party.type, party)}</span>}
                  />
                </EntityFileAttachmentHover>
                {party.type === 'Party' && party.id !== 'all' && (
                  <EditPartyDialog
                    party={party}
                    onPartyUpdated={onPartyUpdated}
                    onPartyDeleted={() => onPartyDeleted(party.id)}
                    hasTransactions={processedTransactions.length > 0}
                  >
                    <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </EditPartyDialog>
                )}
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <h2 className={LEDGER_HEADER_TITLE_CN} title={party.name}>{party.name}</h2>
              </div>
              <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
                <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                  <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                  <div className={cn(LEDGER_HEADER_BALANCE_CN, closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(closingBalance, { showDrCr: true })}
                  </div>
                </div>
              </div>
            </div>
            <div className={LEDGER_HEADER_PILL_ROW_CN}>
              <LedgerHeaderPrintButton variant="outline" onClick={handlePrint} />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
              {(dateSystem === 'BS' || dateSystem === 'Both') && (
                <BsDatePicker
                  isRange
                  valueAD={dateRange}
                  onChangeAD={(range) => onDateRangeChangeWithUnapprovedReset(range as DateRange | undefined)}
                  transactionDates={transactionDates}
                  className={cn("w-auto", LEDGER_HEADER_PILL_CN)}
                />
              )}
              {(dateSystem === 'AD' || dateSystem === 'Both') && (
                <Popover open={isDesktopCalendarOpen} onOpenChange={setIsDesktopCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant={"outline"}
                      className={cn("justify-start text-left font-normal px-2 w-auto", LEDGER_HEADER_PILL_CN, !dateRange && "text-muted-foreground")}
                    >
                      <CalendarIcon className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <AdCalendar
                      rangePresetSlot={
                        <DateRangePresetRow
                          country={company?.country}
                          onApply={(r) => {
                            setTempDateRange(r);
                            onDateRangeChange(r);
                            setIsDesktopCalendarOpen(false);
                          }}
                        />
                      }
                      valueAD={tempDateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = tempDateRange;
                        if (!range?.from || (range.from && range.to)) {
                          setTempDateRange({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          const next = { from: adDate, to: range.from };
                          setTempDateRange(next);
                          onDateRangeChange(next);
                          setIsDesktopCalendarOpen(false);
                        } else {
                          const next = { from: range.from, to: adDate };
                          setTempDateRange(next);
                          onDateRangeChange(next);
                          setIsDesktopCalendarOpen(false);
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {isFilterActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className={LEDGER_HEADER_PILL_CN}>
                  <XCircle className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />Clear Filters
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setIsNoteOpen(true)} className={LEDGER_HEADER_PILL_CN}>
                <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
              </Button>
              {onShowAll && (
                <Button variant="outline" size="sm" onClick={onShowAll} className={LEDGER_HEADER_PILL_CN}>
                  All Vouchers
                </Button>
              )}
              
            </div>
          </div>
        </div>
          }
          table={
             <TransactionsTable
              transactions={paginatedTransactions}
              context={entityType}
              contextId={party.id}
              {...statementCheck.tableProps}
              openingBalance={openingBalanceForPeriod}
              openingBalanceOutstanding={openingBalanceOutstanding}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              showNarration={showNarration}
              journalAccountNames={journalAccountNames}
              userNames={userNames}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={periodDr}
              periodCr={periodCr}
              closingBalance={closingBalance}
              isAllVouchersView={isAllVouchersView}
              visibleColumns={entityType === 'staff' ? { ...visibleColumns, status: true } : visibleColumns}
            />
          }
          footer={
        <LedgerDesktopFooter
          left={
            <>
            <LedgerFooterCheckboxPill
              id="show-narration-payee"
              checked={showNarration}
              onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
              label="Show Narration"
            />
            <LedgerFooterColumnsMenu>
                <DropdownMenuContent align="start" className="w-52 p-2">
                {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[])
                  .filter((key) => key !== "status" || balanceMode === "bill_wise")
                  .map((key) => {
                  return (
                    <DropdownMenuItem
                      key={key}
                      onSelect={(e) => e.preventDefault()}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        id={`col-${key}-payee`}
                        checked={visibleColumns[key] !== false}
                        onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                      />
                      <label htmlFor={`col-${key}-payee`} className="text-sm font-medium flex-1 cursor-pointer">
                        {COLUMN_LABELS[key]}
                      </label>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-payee"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="payee"
                enabled={statementCheck.checkModeEnabled}
                onEnabledChange={statementCheck.setCheckModeEnabled}
                viewMode={balanceMode === "bill_wise" ? "bill_wise" : "statement"}
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
          viewMode={balanceMode === "bill_wise" ? "bill_wise" : "statement"}
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
          rowsPerPageSelectValue={rowsPerPageSelectValue}
          onRowsPerPageChange={handleRowsPerPageChange}
          beforeCount={desktopPaginationMeta.beforeCount}
          afterCount={desktopPaginationMeta.afterCount}
          totalCount={displayTransactions.length}
        />
          }
        />
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>Add a New Note for {party.name}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this party.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onPartyUpdated();
                setIsNoteOpen(false);
              }}
              initialContext="Party"
              initialEntityId={party.id}
              compactFooter
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog isOpen={isVoucherDialogOpen} onOpenChange={setIsVoucherDialogOpen} voucher={selectedVoucher} onVoucherAction={() => setSelectedVoucher(null)} />
    </>
  );
}
