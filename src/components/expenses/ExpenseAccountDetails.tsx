
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import type { ExpenseAccount, ExpenseGroup } from "./types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent
} from "@/components/ui/card";
import {
  Edit,
  Printer,
  Landmark,
  Calendar as CalendarIcon,
  FilePlus,
  XCircle,
  MoreVertical,
  ArrowLeft,
  Search,
  Wrench,
  DollarSign,
  Lock,
  Columns3,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { DateRange } from "@/components/ui/ad-calendar";
import { format, startOfDay, endOfDay, isSameDay } from "date-fns";
import { formatVoucherEntryTimeLocal } from "@/lib/voucherDateNormalize";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerDescription as MobileDialogDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mdc, mdcMobileTxnBalanceRowData } from "@/lib/mobileDetailChrome";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import * as XLSX from "xlsx";
import { ReportMobileLedgerFooter } from "@/components/reports/ReportMobileLedgerFooter";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  patchMasterDetailUrlAfterModalClose,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import AdCalendar from "@/components/ui/ad-calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDate } from "@/hooks/useDate";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { EditExpenseAccountDialog } from "./EditExpenseAccountDialog";
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
import { ReportHeaderSummaryCards, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { AdjustBalancePillLabel } from "@/components/vouchers/AdjustBalancePillLabel";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import { useMasterAccountFreezeDetailsChrome } from "@/hooks/useMasterAccountFreezeDetailsChrome";
import { EXPENSE_FREEZE_COLLECTION } from "@/lib/masterAccountFreeze/freezeAdapter";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
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


import { useTransactionVisibleColumns, COLUMN_LABELS, useShowNotes } from "../vouchers/transactionColumnVisibility";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useTransactions } from "@/hooks/use-transactions";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { pushIncomeExpenseAccountSwitch } from "@/lib/incomeExpenseDetailNav";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "../ui/combobox";
import NepaliCalendar from "../ui/nepali-calendar";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import { useEnsureEntityMinTxnsInScope } from "@/hooks/useEnsureEntityMinTxnsInScope";
import { ledgerMasterDateRangeLabel } from "@/lib/ledgerMasterDefaultView";
import type { BSDate } from "@/lib/bs-date";
import { Badge } from "../ui/badge";
import { useVouchers } from "@/hooks/useVouchers";
import { useMasterEntityLivePatch } from "@/hooks/useMasterEntityLivePatch";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import usePermissions from "@/hooks/usePermissions";

interface ExpenseAccountDetailsProps {
  account: ExpenseAccount & { credit?: number, balance?: number };
  allAccounts?: ExpenseAccount[];
  transactions?: any[];
  onAccountUpdated: () => void;
  onAccountDeleted: (id: string) => void;
  onShowAll?: () => void;
  isAllVouchersView?: boolean;
  userNames?: Record<string, string>;
  journalAccountNames?: Record<string, string>;
  context?: string;
  dateRange?: DateRange;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  onBack?: () => void;
  /** Reports embed: PrintÂ·ExcelÂ·Bill wiseÂ·Date footer (income/expense ledger actions hide). */
  mobileFooterVariant?: "ledger" | "report";
  mobileReportStickyTitle?: string;
  hideMobilePeriodLabelRow?: boolean;
  reportSummaryCards?: ReportStatementSummaryCardData[];
}

export function ExpenseAccountDetails({
  account: initialAccount,
  allAccounts,
  transactions,
  onAccountUpdated,
  onAccountDeleted,
  onShowAll,
  isAllVouchersView,
  userNames,
  journalAccountNames,
  context,
  dateRange,
  onDateRangeChange,
  onBack,
  mobileFooterVariant = "ledger",
  mobileReportStickyTitle,
  hideMobilePeriodLabelRow = false,
  reportSummaryCards,
}: ExpenseAccountDetailsProps) {
  useFyLoadOnDateRangeChange(dateRange);
  const { company, companyId } = useCompany();
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatRunning } =
    useDate();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { vouchers, journalAccountNames: journalAccountNamesFromHook } = useVouchers();
  const resolvedJournalAccountNames = journalAccountNames ?? journalAccountNamesFromHook ?? {};
  const mobileSearchNames = useMemo(
    () => ({ ...resolvedJournalAccountNames, ...(userNames ?? {}) }),
    [resolvedJournalAccountNames, userNames]
  );

  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const { balanceMode, setBalanceMode } = useBalanceMode();
  const { can } = usePermissions();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "add_expense" | "add_income">(null);
  const openingModalRef = useRef(false);
  const [isDateSearchMode, setIsDateSearchMode] = useState(false);

  // Desktop Calendar State
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  
  // Local State for Calendar Buffer
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);

  // Sync tempDateRange when prop changes
  useEffect(() => {
    setTempDateRange(dateRange);
  }, [dateRange]);

  const account = useMemo(() => {
    if (!allAccounts) return initialAccount;
    return allAccounts.find(a => a.id === initialAccount.id) || initialAccount;
  }, [allAccounts, initialAccount]);

  const handleAccountUpdated = useMasterEntityLivePatch<ExpenseAccount>({
    collection: "expense_accounts",
    entityId: initialAccount.id,
    onUpdated: () => onAccountUpdated(),
  });

  const expenseFreezeEligible =
    account.id !== "all" &&
    account.id !== "sales_account" &&
    account.id !== "purchase_account";

  const expenseAdjustBalanceActions = expenseFreezeEligible ? (
    <AddVoucherDialog
      defaultTab="adjustment"
      allowedTabs={["adjustment"]}
      defaultVoucherData={{
        defaultTab: "adjustment",
        adjustmentTarget: { id: account.id, entityType: "expense", name: account.name },
      }}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={readMasterAccountFrozen(account)}
        className={cn(LEDGER_HEADER_PILL_CN, "!h-7 min-h-7 text-xs")}
        title="Adjust Balance"
      >
        <AdjustBalancePillLabel />
      </Button>
    </AddVoucherDialog>
  ) : null;

  const {
    freezeOverlay: expenseFreezeOverlay,
    closingBalanceRowActions: expenseClosingBalanceRowActions,
    closingBalanceActions: expenseClosingBalanceActions,
  } = useMasterAccountFreezeDetailsChrome({
    companyId,
    collection: EXPENSE_FREEZE_COLLECTION,
    entityId: account.id,
    entity: account,
    entityEligible: expenseFreezeEligible,
    onEntityUpdated: handleAccountUpdated,
    adjustBalanceActions: expenseAdjustBalanceActions,
  });

  const accountHeaderAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(account.fileUrl),
    [account.fileUrl, account.id]
  );

  const ledgerViewMode: LedgerDetailViewMode =
    balanceMode === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && account?.id
        ? ledgerDetailSessionStorageKey(companyId, "expense", account.id, ledgerViewMode)
        : null,
    [companyId, account?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  useEffect(() => {
    setCurrentPage(1);
  }, [isAllVouchersView]);

  // Fix: "All Vouchers" view should still filter to the specific account, not all accounts
  // It should show all transaction types for this account, not all transactions for all accounts
  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    account, 
    'expense', 
    dateRange, 
    undefined, 
    allAccounts, 
    transactions, 
    context, 
    filters,
    undefined,
    undefined,
    userNames
);

  const transactionDates = useMemo(() => {
    const dates = new Set<number>();
    processedTransactions.forEach((v:any) => {
        const dateValue = v.date?.toDate ? v.date.toDate() : new Date(v.date);
        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            dates.add(startOfDay(dateValue).getTime());
        }
    });
    return Array.from(dates).map(d => new Date(d));
  }, [processedTransactions]);

  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v);
  // Books opening + (date par filter) view-start: ledger table ke first row se match
  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);
  const masterExpenseOpening = Number(account.openingBalance) || 0;

  const clearFilters = () => {
    if(onDateRangeChange) {
      onDateRangeChange(undefined);
    }
    setTempDateRange(undefined);
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

  const anyMobilePopupOpen = isMobile && (
    !!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen
  );

  const openModalInUrl = useCallback(() => {
    if (!isMobile || !pathname) return;
    persistPlModalParentQuery(searchParams.toString());
    const params = new URLSearchParams(searchParamsStringForModalClose(searchParams.toString()));
    params.set("modal", "1");
    router.push(`${pathname}?${params.toString()}`);
  }, [isMobile, pathname, searchParams, router]);

  const closeModalInUrl = useCallback(() => {
    if (!pathname) return;
    const raw = searchParamsStringAfterClosingModal(searchParams.toString());
    const params = new URLSearchParams(raw);
    params.delete("modal");
    params.delete("modalts");
    patchMasterDetailUrlAfterModalClose(params, { entityId: account.id });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, account.id]);

  const modalParam = searchParams.get("modal");
  const urlModalOpen = isMobile && modalParam === "1" && anyMobilePopupOpen;
  const closeUrlModal = useCallback(() => {
    setMobileFooterDialogOpen(null);
    setIsCalendarOpen(false);
    setIsVoucherDialogOpen(false);
    setSelectedVoucher(null);
    setIsPrintDialogOpen(false);
    closeModalInUrl();
  }, [closeModalInUrl]);
  useUrlModalBack(urlModalOpen, closeUrlModal);

  useMobileLedgerModalUrlGuard({
    isMobile,
    modalParam,
    anyPopupOpen: anyMobilePopupOpen,
    openingModalRef,
    pathname,
    searchParams,
    router,
  });

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };


  const handleEditVoucher = (voucher: any) => {
    if (isMobile) openingModalRef.current = true;
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    if (isMobile) openModalInUrl();
    setIsVoucherDialogOpen(true);
  };

  // PC: preference; mobile: hamesha notes (includeNotesInTable)
  const displayTransactions = useMemo(
    () => (includeNotesInTable ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note")),
    [processedTransactions, includeNotesInTable]
  );
  const mobileUnapprovedTxnCount = useMemo(
    () => countLedgerUnapprovedTransactions(displayTransactions),
    [displayTransactions]
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

  useEnsureEntityMinTxnsInScope({
    dateRange,
    entityId: account?.id,
    entityKind: "expense",
    entityTxnCount: sortedTransactions.length,
    enabled: Boolean(account?.id),
  });


  const balanceText = useMemo(() => {
    if (closingBalance === 0) return "Settled Up";
    return closingBalance < 0 ? "Income" : "Expense";
  }, [closingBalance]);
  
  const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
    const range = dateRange;
    if (!onDateRangeChange) return;
    if (!range?.from || (range.from && range.to)) {
      if (onDateRangeChange) onDateRangeChange({ from: adDate, to: undefined });
    } else if (adDate < range.from) {
      if (onDateRangeChange) onDateRangeChange({ from: adDate, to: range.from });
      setIsCalendarOpen(false);
    } else {
      if (onDateRangeChange) onDateRangeChange({ from: range.from, to: adDate });
      setIsCalendarOpen(false);
    }
  };
  
  const searchFilteredTransactions = useMemo(() => {
    if (!mobileSearchTerm) return sortedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();
    return sortedTransactions.filter(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "expense", account.id).includes(lowerCaseSearch) ||
        formatDate(d).toLowerCase().includes(lowerCaseSearch) ||
        formatDateBS(d).toLowerCase().includes(lowerCaseSearch) ||
        String(t.total || t.amount || 0).toLowerCase().includes(lowerCaseSearch) ||
        String(t.debit).toLowerCase().includes(lowerCaseSearch) ||
        String(t.credit).toLowerCase().includes(lowerCaseSearch) ||
        String(debitCreditAmount).toLowerCase().includes(lowerCaseSearch) ||
        String(t.balance).toLowerCase().includes(lowerCaseSearch)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, formatDate, formatDateBS, mobileSearchNames, account.id]);

  const mobileTransactions = useMemo(() => {
    const list = searchFilteredTransactions;
    if (rowsPerPage <= 0) return list;
    const total = list.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return list.slice(start, Math.max(start, end));
  }, [searchFilteredTransactions, currentPage, rowsPerPage]);
  const mobilePagerEdgeCounts = useMemo(() => {
    const total = searchFilteredTransactions.length;
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return { before: start, after: Math.max(0, total - end) };
  }, [searchFilteredTransactions.length, currentPage, rowsPerPage]);
  const mobilePageLedgerStats = useMemo(() => {
    const list = searchFilteredTransactions as any[];
    if (rowsPerPage <= 0) {
      const pageDr = list.reduce((sum, t: any) => sum + (Number(t?.debit) || 0), 0);
      const pageCr = list.reduce((sum, t: any) => sum + (Number(t?.credit) || 0), 0);
      return {
        openingForPage: openingBalanceForPeriod,
        periodDrForPage: pageDr,
        periodCrForPage: pageCr,
        closingForPage: openingBalanceForPeriod + pageDr - pageCr,
      };
    }
    const total = list.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    const pageTransactions = list.slice(start, Math.max(start, end));
    const previousTx = start > 0 ? list[start - 1] : null;
    const previousRunningBalance =
      previousTx != null
        ? (typeof previousTx.balance === "number"
            ? previousTx.balance
            : typeof previousTx.runningBalance === "number"
              ? previousTx.runningBalance
              : undefined)
        : undefined;
    const openingForPage =
      typeof previousRunningBalance === "number" && !Number.isNaN(previousRunningBalance)
        ? previousRunningBalance
        : openingBalanceForPeriod;
    const periodDrForPage = pageTransactions.reduce((sum, t: any) => sum + (Number(t?.debit) || 0), 0);
    const periodCrForPage = pageTransactions.reduce((sum, t: any) => sum + (Number(t?.credit) || 0), 0);
    return {
      openingForPage,
      periodDrForPage,
      periodCrForPage,
      closingForPage: openingForPage + periodDrForPage - periodCrForPage,
    };
  }, [searchFilteredTransactions, rowsPerPage, currentPage, openingBalanceForPeriod]);

  // Statement check mode + desktop tail paging (PC footer Check mode pill)
  const {
    statementCheck,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "expense",
    contextId: account.id,
    viewMode: balanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions: searchFilteredTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning: openingBalanceForPeriod,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "expense",
    contextId: account?.id,
    viewMode: ledgerViewMode,
    totalPages,
    currentPage,
    setCurrentPage,
    vouchers,
    selectedVoucherId: selectedVoucher?.id ?? null,
    isVoucherDialogOpen,
    setSelectedVoucher,
    setIsVoucherDialogOpen,
    onRestoreVoucherDialog: isMobile ? openModalInUrl : undefined,
  });

  // Radix rows Select â€” value list me honi chahiye (LedgerDesktopFooter pagination)
  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "10");

  useEffect(() => {
    const total = rowsPerPage > 0 ? Math.ceil(searchFilteredTransactions.length / rowsPerPage) : 1;
    const safeTotal = Math.max(1, total);
    setCurrentPage((prev) => Math.min(Math.max(1, prev), safeTotal));
  }, [dateRange, searchFilteredTransactions.length, rowsPerPage]);

  const buildDateRangeText = () => {
    if (!company) return "All Time";
    const from = dateRange?.from;
    const to = dateRange?.to;
    if (!from) return "All Time";
    const fromBS = formatDateBS(from);
    const toBS = to ? formatDateBS(to) : fromBS;
    const fromAD = formatDate(from);
    const toAD = to ? formatDate(to) : fromAD;
    if (dateSystem === "AD") return `AD: ${fromAD} to ${toAD}`;
    if (dateSystem === "BS") return `BS: ${fromBS} to ${toBS}`;
    return `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
  };

  const dateRangeLabel = useMemo(
    () => ledgerMasterDateRangeLabel(dateRange, buildDateRangeText()),
    [dateRange, dateSystem, formatDateBS, formatDate]
  );

  const handlePrint = () => {
    if (!company) return;
    const dateRangeText = buildDateRangeText();
    const printVisibleColumns = balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns;
    openPrintDirect(
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
          title: `Account Statement: ${account.name}`,
          context: "expense",
          contextId: account.id,
          dateSystem: dateSystem,
          dateRangeText: dateRangeText,
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (account as any).openingBalanceDate,
          openingBalanceNarration: account.openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          billWise: balanceMode === "bill_wise",
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: masterExpenseOpening,
          ledgerShowBookOpeningRow: currentPage === 1,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: dateRange?.from,
          masterOpeningBalanceDate: (account as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  const handleMobileBack = useCallback(() => {
    if (mobileFooterDialogOpen) {
      setMobileFooterDialogOpen(null);
      closeModalInUrl();
      return;
    }
    if (isCalendarOpen) {
      setIsCalendarOpen(false);
      closeModalInUrl();
      return;
    }
    if (isVoucherDialogOpen) {
      setIsVoucherDialogOpen(false);
      setSelectedVoucher(null);
      closeModalInUrl();
      return;
    }
    onBack?.();
  }, [mobileFooterDialogOpen, isCalendarOpen, isVoucherDialogOpen, closeModalInUrl, onBack]);

  const accountDropdownOptions = useMemo(() => {
    return (allAccounts || []).map((a) => ({ value: a.id, label: a.name }));
  }, [allAccounts]);

  const TransactionRow = React.memo(({ transaction }: { transaction: any }) => {
    const { dateSystem, formatDate, formatDateBS, formatCurrency } = useDate();
    
    const d = transaction.date?.toDate ? transaction.date.toDate() : (transaction.date ? new Date(transaction.date) : null);
    
    if (!d) {
        return <Card className="p-2 m-2 mb-0"><p className="text-red-500">Invalid date found</p></Card>;
    }
    
    const displayDate = () => {
        switch (dateSystem) {
            case 'AD': return formatDate(d);
            case 'BS': return formatDateBS(d);
            case 'Both': return `${formatDateBS(d)} (${formatDate(d)})`;
            default: return formatDateBS(d);
        }
    };
    
    return (
      <Card className="p-2 m-2 mb-0 rounded-lg shadow-sm border overflow-hidden" onClick={() => handleEditVoucher(transaction)}>
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-semibold text-xs">{transaction.voucherNumber} - {transaction.type ? voucherTypeDisplayText(transaction.type) : 'N/A'}</p>
                    <p className="text-xs text-muted-foreground">{transaction.narration || "No narration"}</p>
                </div>
                <div className="text-right flex flex-col items-end gap-1">
                      <p className={cn("font-bold text-sm whitespace-nowrap", transaction.debit > 0 ? "text-red-600" : "text-green-600")}>{formatCurrency(transaction.debit > 0 ? transaction.debit : transaction.credit)}</p>
                      <div className="flex flex-col items-end">
                          <Badge variant="secondary" className={cn("font-normal text-xs px-1.5 py-0.5", transaction.balance < 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>Bal: {formatCurrency(transaction.balance)}</Badge>
                          <p className="text-xs text-muted-foreground font-medium mt-1">User: {userNames?.[transaction.userId] || 'N/A'}</p>
                      </div>
                </div>
            </div>
            <div className="flex justify-between items-center mt-1">
                <p className="text-xs text-muted-foreground">
                  {displayDate()} â€¢ {formatVoucherEntryTimeLocal(transaction as Record<string, unknown>)}
                </p>
            </div>
        </Card>
    );
  });
  TransactionRow.displayName = 'TransactionRow';


  const renderDesktopView = () => {
    if (isAllVouchersView && (account.id === 'all')) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center p-8">
                     <Wrench className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-xl font-semibold">Under Development</h3>
                    <p className="text-muted-foreground mt-2">
                        This aggregated view for all {account.name.replace(' Vouchers', '')} transactions is currently being built.
                    </p>
                </CardContent>
            </Card>
        )
    }

    return (
     <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Header: identity + pills â€” Party-style single row */}
        {/* TABLE AREA â€” min-h-0: flex-1 ScrollArea shrink ho kar vertical scroll */}
        <LedgerTxnScrollColumn
          header={
<div className={cn("flex-shrink-0", LEDGER_HEADER_RIBBON_WRAP_CN)}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {isMobile && onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              {/* `fileUrl` pehle kabhi render hi nahi hota tha; local IndexedDB refs ke liye ResolvedEntityAvatar */}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                <EntityFileAttachmentHover
                  fileUrl={accountHeaderAttachmentUrl}
                triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
              >
                <ResolvedEntityAvatar
                  className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                    src={accountHeaderAttachmentUrl ?? undefined}
                    alt={account.name}
                    fallbackSlot={
                      (account as any).isSystemReserved ? (
                        <Lock className="h-6 w-6 text-muted-foreground" />
                      ) : (
                        <DollarSign className="h-6 w-6 text-muted-foreground" />
                      )
                    }
                  />
                </EntityFileAttachmentHover>
                {account.id !== 'all' && account.id !== 'sales_account' && account.id !== 'purchase_account' && (
                  <EditExpenseAccountDialog
                    account={account}
                    onAccountUpdated={handleAccountUpdated}
                    onAccountDeleted={() => onAccountDeleted(account.id)}
                    hasTransactions={processedTransactions.length > 0}
                  >
                    <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </EditExpenseAccountDialog>
                )}
              </div>
              {(account as any).isSystemReserved && <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0 self-center" />}
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <h2 className={LEDGER_HEADER_TITLE_CN} title={account.name}>{account.name}</h2>
              </div>
              {reportSummaryCards?.length ? (
                <ReportHeaderSummaryCards cards={reportSummaryCards} />
              ) : (
              <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
                <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                  <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                  <div className={cn(LEDGER_HEADER_BALANCE_CN, closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(closingBalance, { showDrCr: true })}
                  </div>
                </div>
              </div>
              )}
            </div>
            <div className={LEDGER_HEADER_PILL_ROW_CN}>
              <LedgerHeaderPrintButton variant="outline" onClick={handlePrint} />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <BsDatePicker
                  isRange
                  masterLedgerDatePresets
                  ledgerPaginationReset={ledgerPaginationReset}
                  valueAD={dateRange}
                  onChangeAD={onDateRangeChange || (() => {})}
                  transactionDates={transactionDates}
                  className={cn("w-auto", LEDGER_HEADER_PILL_CN)}
                />
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
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
                        <MasterLedgerDateRangePresetRow
                          ledgerPaginationReset={ledgerPaginationReset}
                          country={company?.country}
                          onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                          onApply={(r) => {
                            setTempDateRange(r);
                            onDateRangeChange?.(r);
                            setIsDesktopCalendarOpen(false);
                          }}
                          onAfterDefault={() => {
                            setTempDateRange(undefined);
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
                          onDateRangeChange?.(next);
                          setIsDesktopCalendarOpen(false);
                        } else {
                          const next = { from: range.from, to: adDate };
                          setTempDateRange(next);
                          onDateRangeChange?.(next);
                          setIsDesktopCalendarOpen(false);
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {isFilterActive && (
                <Button variant="ghost" size="icon" onClick={clearFilters} className={cn(LEDGER_HEADER_PILL_ICON_CN, "text-muted-foreground hover:text-foreground")} aria-label="Clear date filter">
                  <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
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
          <>
          
            <MasterAccountFreezeTxnShell
              overlay={expenseFreezeOverlay}
            >
            <TransactionsTable
              transactions={paginatedTransactions}
              context="expense"
              contextId={account.id}
              openingBalance={desktopPaginationMeta.openingForPage}
              booksOpeningBalance={masterExpenseOpening}
              ledgerDateFilterActive={hasLedgerDateFilter}
              ledgerShowBookOpeningRow={currentPage === 1}
              openingBalancePeriodStartDate={dateRange?.from}
              dateRange={dateRange}
              openingBalanceNarration={account.openingBalanceNarration}
              openingBalanceAttachmentUrls={account.documentFileUrls}
              openingBalanceDate={(account as any).openingBalanceDate}
              showNarration={showNarration}
              visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
              userNames={userNames}
              journalAccountNames={journalAccountNames}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={desktopPaginationMeta.closingForPage}
              closingBalanceRowActions={expenseClosingBalanceRowActions}
              closingBalanceActions={expenseClosingBalanceActions}
              {...statementCheck.tableProps}
            />
            </MasterAccountFreezeTxnShell>
          </>

                  }

                  footer={
        <LedgerDesktopFooter
          shellClassName="flex-shrink-0"
          left={
            <>
              <LedgerFooterCheckboxPill
                id="show-narration-account"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
              <LedgerFooterColumnsMenu>
                <DropdownMenuContent align="start" className="w-52 p-2">
                  {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[])
                    .filter(ledgerColumnMenuNoTdsFilter).filter((key) => key !== "status" || balanceMode === "bill_wise")
                    .map((key) => {
                    const isStatusInStatement = key === "status" && balanceMode === "statement";
                    const isStatusInBillWise = key === "status" && balanceMode === "bill_wise";
                    const isStatusLocked = isStatusInStatement || isStatusInBillWise;
                    return (
                      <DropdownMenuItem
                        key={key}
                        onSelect={(e) => e.preventDefault()}
                        className={cn("flex items-center gap-2", isStatusLocked ? "cursor-not-allowed" : "cursor-pointer")}
                      >
                        <Checkbox
                          id={`col-${key}-expense-account`}
                          checked={isStatusInStatement ? false : (isStatusInBillWise ? true : visibleColumns[key] !== false)}
                          disabled={isStatusLocked}
                          onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                        />
                        <label htmlFor={`col-${key}-expense-account`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                          {COLUMN_LABELS[key]}
                        </label>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-expense-account"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="expense-account"
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
          viewMode="statement"
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
  );
  }

  const reportStickyTitle = mobileReportStickyTitle ?? (context === "payment-out" ? "Payment" : "Report");

  const handleExcelLedger = useCallback(() => {
    const rows = searchFilteredTransactions.map((t: Record<string, unknown>) => {
      const dRaw = (t as { date?: { toDate?: () => Date } }).date;
      const d = dRaw?.toDate ? dRaw.toDate() : new Date((t as { date?: unknown }).date as string | number | Date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": (t as { voucherNumber?: string }).voucherNumber,
        Narration: String((t as { narration?: string }).narration || ""),
        Debit: Number((t as { debit?: number }).debit) || 0,
        Credit: Number((t as { credit?: number }).credit) || 0,
        Balance: `${Math.abs(Number((t as { balance?: number }).balance) || 0).toFixed(2)} ${((t as { balance?: number }).balance ?? 0) >= 0 ? "Dr" : "Cr"}`,
      };
    });
    const summaryRows = [
      {
        "Date (BS)": "Opening Balance",
        Balance: `${Math.abs(openingBalanceForPeriod).toFixed(2)} ${openingBalanceForPeriod >= 0 ? "Dr" : "Cr"}`,
      },
      { "Date (BS)": "Total", Debit: periodDr, Credit: periodCr },
      {
        "Date (BS)": "Closing Balance",
        Balance: `${Math.abs(closingBalance).toFixed(2)} ${closingBalance >= 0 ? "Dr" : "Cr"}`,
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet([...rows, {}, ...summaryRows] as Record<string, unknown>[]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger");
    const safeName = (account.name || "account").replace(/[/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeName}_ledger.xlsx`);
  }, [
    searchFilteredTransactions,
    formatDate,
    formatDateBS,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    account.name,
  ]);

  if (isMobile) {
    const isReportMobileChrome = mobileFooterVariant === "report";
    // Report all-vouchers: account picker hide â€” sirf search + filters.
    const hideReportAccountPicker = isReportMobileChrome && (isAllVouchersView || account.id === "all");

    const mobileEntityTxnToolbar = (
      <MobileEntityTxnToolbarRow placement="belowPager">
        {!hideReportAccountPicker && allAccounts && allAccounts.length > 0 && (
          <MobileEntityTxnToolbarPicker>
            <Combobox
              options={accountDropdownOptions}
              value={account.id}
              onChange={(value) => {
                if (value && value !== account.id) pushIncomeExpenseAccountSwitch(router, pathname || "", value);
              }}
              placeholder="Select account"
            />
          </MobileEntityTxnToolbarPicker>
        )}
        <MobileEntityTxnToolbarUnapprovedBadge
          count={mobileUnapprovedTxnCount}
          pressed={unapprovedOnly}
          onToggle={toggleUnapprovedOnly}
        />
        <MobileEntityTxnToolbarSearch>
          <Search className={mdc.mobileTxnToolbarSearchIcon} />
          <Input
            placeholder="Search transactions"
            className={mdc.mobileTxnToolbarSearchInput}
            value={mobileSearchTerm}
            onChange={(e) => {
              setMobileSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </MobileEntityTxnToolbarSearch>
      </MobileEntityTxnToolbarRow>
    );

    return (
      <>
      <div className="flex h-full flex-col flex-1 min-h-0 overflow-hidden w-full">
          {isReportMobileChrome && onBack ? (
            <header className="sticky top-0 z-10 flex-shrink-0 border-b bg-white p-3 dark:bg-card">
              <div className="flex min-w-0 items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleMobileBack} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <h1 className="shrink-0 text-base font-bold text-muted-foreground">{reportStickyTitle}</h1>
                  <span className="shrink-0 select-none text-muted-foreground/55" aria-hidden>Â·</span>
                  <span
                    className={cn("min-w-0 truncate text-sm font-medium", masterDetailBalanceToneClass(closingBalance))}
                    title={account.name}
                  >
                    {account.name}
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm font-bold whitespace-nowrap",
                    closingBalance >= 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  {formatCurrency(closingBalance, { showDrCr: true })}
                </span>
              </div>
            </header>
          ) : null}
          {/* Mobile: date/balance/search â€” footer chevron se collapse (group pages jaisa) */}
          <MobileDetailSummaryCollapsible>
          {!hideMobilePeriodLabelRow ? (
            <div className="px-2 py-1 border-b flex justify-center items-center gap-1.5 flex-shrink-0">
              <span className="text-xs font-medium text-muted-foreground">
                {dateRangeLabel}
              </span>
              {dateRange != null && (dateRange.from != null || dateRange.to != null) && onDateRangeChange && (
                <button
                  type="button"
                  onClick={() => onDateRangeChange(undefined)}
                  className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                  aria-label="Clear date filter"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : null}
          {/* Balance + books / view-start hints (ek account par hi; "all" aggregate nahi) */}
          <div className={mdc.mobileTxnBalanceRow} {...mdcMobileTxnBalanceRowData}>
            <p className={cn(mdc.mobileTxnBalanceText2xl, closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
              {balanceText} {formatCurrency(Math.abs(closingBalance), { noSuffix: true })}
            </p>
          </div>
          </MobileDetailSummaryCollapsible>
          {isReportMobileChrome ? (
            <>
            <div
              className={mdc.reportTxnScrollBody}
            >
              <div className="pb-2">
                <MasterAccountFreezeTxnShell
                  overlay={expenseFreezeOverlay}
                >
                <TransactionsTable
                  transactions={mobileTransactions}
                  context="expense"
                  contextId={account.id}
                  transactionCardSearchHighlight={mobileSearchTerm}
                  openingBalance={mobilePageLedgerStats.openingForPage}
                  booksOpeningBalance={masterExpenseOpening}
                  ledgerDateFilterActive={hasLedgerDateFilter}
                  ledgerShowBookOpeningRow={rowsPerPage <= 0 || currentPage === 1}
                  openingBalancePeriodStartDate={dateRange?.from}
              dateRange={dateRange}
                  openingBalanceNarration={account.openingBalanceNarration}
                  openingBalanceAttachmentUrls={account.documentFileUrls}
                  openingBalanceDate={(account as any).openingBalanceDate}
                  showNarration={showNarration}
                  visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
                  userNames={userNames}
                  journalAccountNames={journalAccountNames}
                  onRowClick={handleEditVoucher}
                  filters={filters}
                  setFilters={setFilters}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  periodDr={mobilePageLedgerStats.periodDrForPage}
                  periodCr={mobilePageLedgerStats.periodCrForPage}
                  closingBalance={mobilePageLedgerStats.closingForPage}
                  scrollOnlyTransactions
                  closingBalanceRowActions={expenseClosingBalanceRowActions}
              closingBalanceActions={expenseClosingBalanceActions}
                  {...statementCheck.tableProps}
                />
                </MasterAccountFreezeTxnShell>
              </div>
            </div>
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
              txnToolbar={mobileEntityTxnToolbar}
            />
            </>
          ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-touch touch-pan-y pl-ledger-txn-scroll-native",
                mdc.mobileLedgerTxnScrollPad
              )}
              style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
            >
              <div className="pb-2">
                <MasterAccountFreezeTxnShell
                  overlay={expenseFreezeOverlay}
                >
                <TransactionsTable
                  transactions={mobileTransactions}
                  context="expense"
                  contextId={account.id}
                  transactionCardSearchHighlight={mobileSearchTerm}
                  openingBalance={mobilePageLedgerStats.openingForPage}
                  booksOpeningBalance={masterExpenseOpening}
                  ledgerDateFilterActive={hasLedgerDateFilter}
                  ledgerShowBookOpeningRow={rowsPerPage <= 0 || currentPage === 1}
                  openingBalancePeriodStartDate={dateRange?.from}
              dateRange={dateRange}
                  openingBalanceNarration={account.openingBalanceNarration}
                  openingBalanceAttachmentUrls={account.documentFileUrls}
                  openingBalanceDate={(account as any).openingBalanceDate}
                  showNarration={showNarration}
                  visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
                  userNames={userNames}
                  journalAccountNames={journalAccountNames}
                  onRowClick={handleEditVoucher}
                  filters={filters}
                  setFilters={setFilters}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  periodDr={mobilePageLedgerStats.periodDrForPage}
                  periodCr={mobilePageLedgerStats.periodCrForPage}
                  closingBalance={mobilePageLedgerStats.closingForPage}
                  scrollOnlyTransactions
                  closingBalanceRowActions={expenseClosingBalanceRowActions}
              closingBalanceActions={expenseClosingBalanceActions}
                  {...statementCheck.tableProps}
                />
                </MasterAccountFreezeTxnShell>
              </div>
            </div>
            <MobileTransactionsPager
              className={cn("mt-auto shrink-0", mdc.ledgerTxnPagerOutside)}
              currentPage={currentPage}
              totalItems={searchFilteredTransactions.length}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(nextRows) => {
                setRowsPerPage(nextRows);
                setCurrentPage(1);
              }}
              onPageChange={setCurrentPage}
              edgeCounts={rowsPerPage > 0 ? mobilePagerEdgeCounts : undefined}
              txnToolbar={mobileEntityTxnToolbar}
            />
          </div>
          )}
      </div>
      {isReportMobileChrome ? (
        <>
        <ReportMobileLedgerFooter
          onPrint={handlePrint}
          onExcel={handleExcelLedger}
          onDateOpen={() => {
            openingModalRef.current = true;
            setIsCalendarOpen(true);
            openModalInUrl();
          }}
          balanceMode={balanceMode}
          onBalanceModeToggle={() => setBalanceMode(balanceMode === "bill_wise" ? "statement" : "bill_wise")}
          showChart={false}
        />
        <Drawer
          open={isCalendarOpen}
          onOpenChange={(open: boolean) => {
            if (open) {
              openingModalRef.current = true;
              openModalInUrl();
            }
            setIsCalendarOpen(open);
            if (!open) closeModalInUrl();
          }}
        >
          <DrawerContent>
            <DrawerHeader className="p-4 text-left">
              <DrawerTitle>Select Date Range</DrawerTitle>
              <MobileDialogDescription>Select a date range for the transaction list.</MobileDialogDescription>
            </DrawerHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <NepaliCalendar
                  rangePresetSlot={
                    <MasterLedgerDateRangePresetRow
                      ledgerPaginationReset={ledgerPaginationReset}
                      country={company?.country}
                      onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                      onApply={(r) => {
                        onDateRangeChange?.(r);
                        setIsCalendarOpen(false);
                      }}
                      onAfterDefault={() => setIsCalendarOpen(false)}
                    />
                  }
                  onSelect={handleNepaliSelect}
                  valueAD={dateRange}
                  isRange={true}
                  numberOfMonths={calendarMonths}
                />
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
                <div className="flex-1 w-full min-w-0">
                  <AdCalendar
                    rangePresetSlot={
                      <MasterLedgerDateRangePresetRow
                        ledgerPaginationReset={ledgerPaginationReset}
                        country={company?.country}
                        onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                        onApply={(r) => {
                          onDateRangeChange?.(r);
                          setIsCalendarOpen(false);
                        }}
                        onAfterDefault={() => setIsCalendarOpen(false)}
                      />
                    }
                    valueAD={dateRange}
                    isRange
                    numberOfMonths={calendarMonths}
                    transactionDates={transactionDates}
                    onSelect={(adDate) => {
                      const range = dateRange;
                      if (!range?.from || (range.from && range.to)) {
                        onDateRangeChange?.({ from: adDate, to: undefined });
                      } else if (adDate < range.from) {
                        onDateRangeChange?.({ from: adDate, to: range.from });
                        setIsCalendarOpen(false);
                      } else {
                        onDateRangeChange?.({ from: range.from, to: adDate });
                        setIsCalendarOpen(false);
                      }
                    }}
                  />
                </div>
              )}
            </div>
            <DrawerFooter className="p-4 pt-2">
              <DrawerClose asChild>
                <Button variant="outline">Close</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        </>
      ) : (
        <div
          className="fixed bottom-0 left-0 right-0 p-1.5 border-t bg-background/95 backdrop-blur z-50 flex items-center justify-around gap-1.5"
          data-pl-mobile-ledger-action-footer=""
        >
          <Button
            className="flex-1 h-6 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            onClick={() => {
              openingModalRef.current = true;
              setMobileFooterDialogOpen("add_expense");
              openModalInUrl();
            }}
          >
            Add Expense
          </Button>
          <MobileEntityLedgerFooterPrintButton onClick={handlePrint} />
          <Drawer
            open={isCalendarOpen}
            onOpenChange={(open: boolean) => {
              if (open) {
                openingModalRef.current = true;
                openModalInUrl();
              }
              setIsCalendarOpen(open);
              if (!open) closeModalInUrl();
            }}
          >
            <DrawerTrigger asChild>
              <Button className="flex-1 h-6 min-w-0 rounded-md text-xs font-medium px-1 bg-pink-600 hover:bg-pink-700 text-white">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader className="p-4 text-left">
                <DrawerTitle>Select Date Range</DrawerTitle>
                <MobileDialogDescription>Select a date range for the transaction list.</MobileDialogDescription>
              </DrawerHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                {(dateSystem === "BS" || dateSystem === "Both") && (
                  <NepaliCalendar
                    rangePresetSlot={
                      <MasterLedgerDateRangePresetRow
                        ledgerPaginationReset={ledgerPaginationReset}
                        country={company?.country}
                        onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                        onApply={(r) => {
                          onDateRangeChange?.(r);
                          setIsCalendarOpen(false);
                        }}
                        onAfterDefault={() => setIsCalendarOpen(false)}
                      />
                    }
                    onSelect={handleNepaliSelect}
                    valueAD={dateRange}
                    isRange={true}
                    numberOfMonths={calendarMonths}
                  />
                )}
                {(dateSystem === "AD" || dateSystem === "Both") && (
                  <div className="flex-1 w-full min-w-0">
                    <AdCalendar
                      rangePresetSlot={
                        <MasterLedgerDateRangePresetRow
                          ledgerPaginationReset={ledgerPaginationReset}
                          country={company?.country}
                          onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                          onApply={(r) => {
                            onDateRangeChange?.(r);
                            setIsCalendarOpen(false);
                          }}
                          onAfterDefault={() => setIsCalendarOpen(false)}
                        />
                      }
                      valueAD={dateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = dateRange;
                        if (!range?.from || (range.from && range.to)) {
                          onDateRangeChange?.({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          onDateRangeChange?.({ from: adDate, to: range.from });
                          setIsCalendarOpen(false);
                        } else {
                          onDateRangeChange?.({ from: range.from, to: adDate });
                          setIsCalendarOpen(false);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <DrawerFooter className="p-4 pt-2">
                <DrawerClose asChild>
                  <Button variant="outline">Close</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </div>
      )}
        <AddVoucherDialog
          isOpen={!!mobileFooterDialogOpen && mobileFooterDialogOpen === "add_expense"}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
          defaultTab="direct_expense"
          defaultVoucherData={{ toAccountId: account.id }}
          onVoucherAction={() => onAccountUpdated()}
        />
        <AddVoucherDialog
          isOpen={!!mobileFooterDialogOpen && mobileFooterDialogOpen === "add_income"}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
          defaultTab="direct_income"
          defaultVoucherData={{ incomeAccountId: account.id }}
          onVoucherAction={() => onAccountUpdated()}
        />
        <AddVoucherDialog
          isOpen={isVoucherDialogOpen}
          onOpenChange={(open: boolean) => {
            if (!open) closeModalInUrl();
            setIsVoucherDialogOpen(open);
          }}
          voucher={selectedVoucher}
          onVoucherAction={() => setSelectedVoucher(null)}
        />
      </>
    );
  }

  return (
    <>
      <div className="h-full">
        {renderDesktopView()}
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>Add a New Note for {account.name}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onAccountUpdated();
                setIsNoteOpen(false);
              }}
              initialContext={(account as any).type === "Income" ? "Income" : "Expense"}
              initialEntityId={account.id}
              showSaveAndApproveOnCreate={can("approve_transactions")}
              showApproveButton={can("approve_transactions")}
              compactFooter
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open) => {
          setIsVoucherDialogOpen(!!open);
          if (!open) {
            setSelectedVoucher(null);
            if (isMobile) closeModalInUrl();
          }
        }}
        voucher={selectedVoucher}
        onVoucherAction={() => setSelectedVoucher(null)}
      />
    </>
  );
}
