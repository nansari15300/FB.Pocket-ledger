
"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { useLedgerDetailSessionMemory } from "@/hooks/useLedgerDetailSessionMemory";
import { useLedgerRowMotionGate } from "@/hooks/useLedgerRowMotionGate";
import {
  ledgerDetailSessionStorageKey,
  writeLedgerDetailSessionSnapshot,
} from "@/lib/ledgerDetailSessionMemory";
import type { Account } from "@/components/bank-cash/types";
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
  X,
  MoreVertical,
  ArrowLeft,
  Search,
  Wrench,
  Columns3,
  ChevronDown,
  File,
  Pencil,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
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
  DrawerDescription as MobileDialogDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mdc } from "@/lib/mobileDetailChrome";
import { Calendar } from "@/components/ui/calendar";
import { useDate } from "@/hooks/useDate";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerHeaderReminderButton, type LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";

import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { EditAccountDialog } from "../bank-cash/EditAccountDialog";
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
} from "@/lib/ledgerHeaderChrome";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { useCompany } from "@/hooks/useCompany";
import { Input } from "../ui/input";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { AdjustBalancePillLabel } from "../vouchers/AdjustBalancePillLabel";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { useStatementLedgerCheckModePaging } from "@/hooks/useStatementLedgerCheckModePaging";
import type {
  TransactionSortBy,
  TransactionSortOrder,
} from "@/components/vouchers/TransactionTableSortDropdown";
import { DEFAULT_TRANSACTION_SORT_ORDER } from "@/lib/transactionSort";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT, rowsPerPageSelectValue } from "@/lib/rowsPerPageSelect";

import { useTransactionVisibleColumns, useShowNotes, COLUMN_LABELS } from "../vouchers/transactionColumnVisibility";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { Checkbox } from "../ui/checkbox";
import { useTransactions } from "@/hooks/use-transactions";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter } from "next/navigation";
import { Combobox } from "../ui/combobox";
import NepaliCalendar from "../ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { calendarPanelClassName } from "@/lib/calendarChrome";
import type { BSDate } from "@/lib/bs-date";
import { Badge } from "../ui/badge";
import { useVouchers } from "@/hooks/useVouchers";
import { PermissionButton } from "@/components/permission";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { ReportMobileLedgerFooter } from "@/components/reports/ReportMobileLedgerFooter";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";

interface AccountDetailsProps {
  account: Account;
  onAccountUpdated: (updatedAccount: Partial<Account>) => void;
  onAccountDeleted: (deletedId: string) => void;
  dateRange?: DateRange | undefined;
  onDateRangeChange: React.Dispatch<React.SetStateAction<DateRange | undefined>>;
  onBack?: () => void;
  allAccounts?: any[];
  userNames?: Record<string, string>;
  transactions?: any[];
  journalAccountNames?: Record<string, string>;
  onShowAll?: () => void;
  isAllVouchersView?: boolean;
  /** Bank-cash mobile: Receive/Pay row. Reports Contra/Journal: Party-style Print/Excel/Date footer. */
  mobileFooterVariant?: "ledger" | "report";
  /** Sticky title with `mobileFooterVariant="report"` (e.g. Contra / Journal register detail). */
  mobileReportStickyTitle?: string;
}

export function AccountDetails({
  account: initialAccount,
  onAccountUpdated,
  onAccountDeleted,
  dateRange,
  onDateRangeChange,
  onBack,
  allAccounts,
  userNames,
  transactions,
  journalAccountNames,
  onShowAll,
  isAllVouchersView,
  mobileFooterVariant = "ledger",
  mobileReportStickyTitle,
}: AccountDetailsProps) {
  const { company, companyId } = useCompany();
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatRunning } =
    useDate();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const [reminderOpen, setReminderOpen] = useState(false);
  const { vouchers } = useVouchers();

  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [mobileReportView, setMobileReportView] = useState<"list" | "chart">("list");
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
    return allAccounts.find(p => p.id === initialAccount.id) || initialAccount;
  }, [allAccounts, initialAccount]);

  /** Reminder button: map Journal/Contra row accountType to Messages → Reminder "Link to" option. */
  const accountReminderContext: LedgerReminderContext | null = (() => {
    const t = String((account as any)?.accountType ?? "");
    if (t === "journal_view") return null;
    if (t === "Party") return "Party";
    if (t === "Staff") return "Staff";
    if (t === "Tax") return "Tax";
    if (t === "Expense" || t === "Income") return "Income/Expense";
    return "Bank/Cash";
  })();

  const ledgerSessionKey = React.useMemo(
    () =>
      companyId && account?.id
        ? ledgerDetailSessionStorageKey(companyId, "account", account.id, "statement")
        : null,
    [companyId, account?.id]
  );

  // All Journal / All Contra: page 1 = latest (party tail jaisa); single account = page 1 = oldest.
  const isContraAllView = Boolean(
    isAllVouchersView && account?.id === "all" && account.accountName?.includes("Contra")
  );
  const isJournalAllView = Boolean(
    isAllVouchersView &&
      account?.id === "all" &&
      (account.accountName?.includes("Journal") || account.accountType === "journal_view")
  );
  const useTailPaging = isJournalAllView || isContraAllView;

  useEffect(() => {
    setCurrentPage(1);
  }, [isAllVouchersView]);

  // Fix: "All Vouchers" view should still filter to the specific account, not all accounts
  // It should show all transaction types for this account, not all transactions for all accounts
  // Column header filters (Voucher No., User, …) — `useTransactions` mein `filteredByColumn` tabhi chale jab yahan `filters` pass ho
  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    account,
    "account",
    dateRange,
    undefined,
    allAccounts,
    transactions,
    undefined,
    filters,
    undefined,
    journalAccountNames,
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

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };


  const handleEditVoucher = (voucher: any) => {
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    setSelectedVoucher(voucher);
    setIsVoucherDialogOpen(true);
  };
  

  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v);

  const clearFilters = () => {
    if(onDateRangeChange) {
      onDateRangeChange(undefined);
    }
    setFilters({});
  };

  const searchFilteredTransactions = useMemo(
    () =>
      includeNotesInTable
        ? processedTransactions
        : processedTransactions.filter((t: any) => t.type !== "note"),
    [processedTransactions, includeNotesInTable]
  );

  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);

  const {
    statementCheck,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "account",
    contextId: account?.id,
    viewMode: "statement",
    searchFilteredTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning: openingBalanceForPeriod,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  const ledgerPageStats = {
    openingForPage: desktopPaginationMeta.openingForPage,
    periodDrForPage: desktopPaginationMeta.periodDrForPage,
    periodCrForPage: desktopPaginationMeta.periodCrForPage,
    closingForPage: desktopPaginationMeta.closingForPage,
  };

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "account",
    contextId: account?.id,
    viewMode: "statement",
    totalPages: Math.max(1, totalPages),
    currentPage,
    setCurrentPage,
    vouchers,
    selectedVoucherId: selectedVoucher?.id ?? null,
    isVoucherDialogOpen,
    setSelectedVoucher,
    setIsVoucherDialogOpen,
  });

  /** Page2+ Dated date = pichle page ki last txn; page1+filter = range-from. */
  const ledgerOpeningPeriodStartDate = useMemo(() => {
    const list = searchFilteredTransactions as any[];
    const start = desktopPaginationMeta.sliceStart;
    if (rowsPerPage <= 0) {
      if (hasLedgerDateFilter) return dateRange?.from;
      return undefined;
    }
    if (start === 0) {
      if (hasLedgerDateFilter) return dateRange?.from;
      return undefined;
    }
    const t = list[start - 1] as any;
    if (!t) return undefined;
    const raw = t.date?.toDate ? t.date.toDate() : t.date ? new Date(t.date) : undefined;
    return raw instanceof Date && !isNaN(raw.getTime()) ? raw : undefined;
  }, [
    searchFilteredTransactions,
    rowsPerPage,
    desktopPaginationMeta.sliceStart,
    hasLedgerDateFilter,
    dateRange?.from,
  ]);

  /** Master books OB — Book Opening pill / stacked card (form se). */
  const masterAccountOpening = Number(account.openingBalance) || 0;

  const buildDateRangeText = () => {
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;

      if (dateSystem === "AD")
        dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === "BS")
        dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else
        dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    return dateRangeText;
  };

  const handlePrintStatement = () => {
    if (!company) return;
    // Keep print columns aligned with visible table columns.
    const printVisibleColumns = visibleColumns;
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
          title: `Account Statement: ${account.accountName}`,
          context: "account",
          contextId: account.id,
          dateSystem: dateSystem,
          dateRangeText: buildDateRangeText(),
          vouchersCount: processedTransactions.length,
          openingBalance: openingBalanceForPeriod,
          openingBalanceDate: (account as any).openingBalanceDate,
          openingBalanceNarration: (account as any).openingBalanceNarration ?? null,
          transactions: processedTransactions,
          showNarration: showNarration,
          visibleColumns: printVisibleColumns,
          userNames: userNames,
          billWise: false,
        },
        {
          paginatedTransactions,
          openingForPage: ledgerPageStats.openingForPage,
          periodDrForPage: ledgerPageStats.periodDrForPage,
          periodCrForPage: ledgerPageStats.periodCrForPage,
          closingForPage: ledgerPageStats.closingForPage,
          booksOpeningBalance: masterAccountOpening,
          ledgerShowBookOpeningRow: rowsPerPage <= 0 || currentPage === 1,
          ledgerDateFilterActive: hasLedgerDateFilter,
          openingBalancePeriodStartDate: ledgerOpeningPeriodStartDate,
          masterOpeningBalanceDate: (account as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  const handlePrintBillWise = () => {
    if (!company) return;
    // Bill-wise print keeps Status column visible by design.
    const printVisibleColumns = { ...visibleColumns, status: true };
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
          title: `Bill Wise Account Statement: ${account.accountName}`,
          context: "account",
          contextId: account.id,
          dateSystem: dateSystem,
          dateRangeText: buildDateRangeText(),
          vouchersCount: processedTransactions.length,
          openingBalance: openingBalanceForPeriod,
          openingBalanceDate: (account as any).openingBalanceDate,
          openingBalanceNarration: (account as any).openingBalanceNarration ?? null,
          transactions: processedTransactions,
          showNarration: showNarration,
          visibleColumns: printVisibleColumns,
          userNames: userNames,
          billWise: true,
        },
        {
          paginatedTransactions,
          openingForPage: ledgerPageStats.openingForPage,
          periodDrForPage: ledgerPageStats.periodDrForPage,
          periodCrForPage: ledgerPageStats.periodCrForPage,
          closingForPage: ledgerPageStats.closingForPage,
          booksOpeningBalance: masterAccountOpening,
          ledgerShowBookOpeningRow: rowsPerPage <= 0 || currentPage === 1,
          ledgerDateFilterActive: hasLedgerDateFilter,
          openingBalancePeriodStartDate: ledgerOpeningPeriodStartDate,
          masterOpeningBalanceDate: (account as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  // Reports hub: Excel export mirrors bank statement column shape (opening / totals footer rows).
  const handleExcelLedger = useCallback(() => {
    const dataForExport = processedTransactions.map((t: Record<string, unknown>) => {
      const dRaw = (t as { date?: { toDate?: () => Date } }).date;
      const d = dRaw?.toDate ? dRaw.toDate() : new Date((t as { date?: unknown }).date as string | number | Date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": (t as { voucherNumber?: string }).voucherNumber,
        Type:
          typeof (t as { type?: string }).type === "string"
            ? voucherTypeDisplayText((t as { type: string }).type)
            : String((t as { type?: unknown }).type ?? ""),
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
    const finalData = [...dataForExport, {}, ...summaryRows] as Record<string, unknown>[];
    const worksheet = XLSX.utils.json_to_sheet(finalData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger");
    const safeName = (account.accountName || "account").replace(/[/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeName}_ledger.xlsx`);
  }, [
    processedTransactions,
    formatDateBS,
    formatDate,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    account.accountName,
  ]);

  const balanceText = useMemo(() => {
    if (closingBalance === 0) return "Settled Up";
    return closingBalance >= 0 ? "Receivable" : "Payable";
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
  
  const filteredMobileTransactions = useMemo(() => {
    if (!mobileSearchTerm) return processedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();
    return processedTransactions.filter(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      return (
        t.voucherNumber?.toLowerCase().includes(lowerCaseSearch) ||
        voucherTypeSearchText(t.type).includes(lowerCaseSearch) ||
        t.narration?.toLowerCase().includes(lowerCaseSearch) ||
        formatDate(d).toLowerCase().includes(lowerCaseSearch) ||
        formatDateBS(d).toLowerCase().includes(lowerCaseSearch) ||
        String(t.total || t.amount || 0).toLowerCase().includes(lowerCaseSearch) ||
        String(t.debit).toLowerCase().includes(lowerCaseSearch) ||
        String(t.credit).toLowerCase().includes(lowerCaseSearch) ||
        String(debitCreditAmount).toLowerCase().includes(lowerCaseSearch) ||
        String(t.balance).toLowerCase().includes(lowerCaseSearch)
      );
    });
  }, [processedTransactions, mobileSearchTerm, formatDate, formatDateBS]);

  /** Reports mobile (Journal/Contra all-vouchers): tail/head slice + pager edge counts */
  const mobileReportPagingWindow = useMemo(() => {
    const list = filteredMobileTransactions;
    const total = list.length;
    const totalPagesLocal = rowsPerPage > 0 ? Math.max(1, Math.ceil(total / rowsPerPage)) : 1;
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    if (rowsPerPage <= 0) {
      return { pageTransactions: list, before: 0, after: 0 };
    }
    if (useTailPaging) {
      const end = total - (safePage - 1) * rowsPerPage;
      const start = Math.max(0, end - rowsPerPage);
      return {
        pageTransactions: list.slice(start, end),
        before: start,
        after: Math.max(0, total - end),
      };
    }
    const start = (safePage - 1) * rowsPerPage;
    const end = Math.min(start + rowsPerPage, total);
    return {
      pageTransactions: list.slice(start, end),
      before: start,
      after: Math.max(0, total - end),
    };
  }, [filteredMobileTransactions, rowsPerPage, currentPage, useTailPaging]);

  const mobileReportPaginatedTransactions = mobileReportPagingWindow.pageTransactions;
  /** Page / rows-per-page change par row slide off; sort + add/edit par FLIP chalu. */
  const ledgerRowGate = useLedgerRowMotionGate({
    pageKey: `${currentPage}|${rowsPerPage}`,
    rowSignals: [paginatedTransactions, mobileReportPaginatedTransactions],
  });
  const mobileReportPagerEdgeCounts = {
    before: mobileReportPagingWindow.before,
    after: mobileReportPagingWindow.after,
  };

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
                      <p className={cn("font-bold text-sm whitespace-nowrap", transaction.debit > 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(transaction.debit > 0 ? transaction.debit : transaction.credit)}</p>
                      <div className="flex flex-col items-end">
                          <Badge variant="secondary" className={cn("font-normal text-xs px-1.5 py-0.5", transaction.balance >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>Bal: {formatCurrency(transaction.balance)}</Badge>
                          {/* Mobile card: user naam ek line — wrap na ho */}
                          <p className="text-xs text-muted-foreground font-medium mt-1 whitespace-nowrap truncate max-w-[min(42vw,9rem)]">
                            User: {userNames?.[transaction.userId] || "N/A"}
                          </p>
                      </div>
                </div>
            </div>
            <div className="flex justify-between items-center mt-1">
                <p className="text-xs text-muted-foreground">
                  {displayDate()} • {formatVoucherEntryTimeLocal(transaction as Record<string, unknown>)}
                </p>
            </div>
        </Card>
    );
  });
  TransactionRow.displayName = 'TransactionRow';


  const renderMobileView = () => {
    // `report`: Reports hub Contra/Journal — Party header + Print/Excel/Date; `ledger`: bank-cash quick voucher row.
    const isReportChrome = mobileFooterVariant === "report";
    const reportTitle = mobileReportStickyTitle ?? "Report";
    // All Journal / All Contra: sirf ek title — "All Journal · All Journal Vouchers" duplicate na ho.
    const reportHeaderTitleOnly = isReportChrome && useTailPaging;
    const dateLineLabel = buildDateRangeText();
    const hasDateFilterMobile = !!(dateRange?.from || dateRange?.to);

    const mobileCalendarDrawer = (
      <Drawer open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <DrawerContent>
          <DrawerHeader className="p-4 text-left">
            <DrawerTitle>Select Date Range</DrawerTitle>
            <MobileDialogDescription>Select a starting and ending date for the transaction list.</MobileDialogDescription>
          </DrawerHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
            {(dateSystem === "BS" || dateSystem === "Both") && (
              <NepaliCalendar
                rangePresetSlot={
                  <DateRangePresetRow
                    country={company?.country}
                    onApply={(r) => {
                      onDateRangeChange(r);
                      setIsCalendarOpen(false);
                    }}
                  />
                }
                onSelect={handleNepaliSelect}
                valueAD={dateRange}
                isRange={true}
                numberOfMonths={calendarMonths}
              />
            )}
            {(dateSystem === "AD" || dateSystem === "Both") && (
              <div className="flex-1">
                <div
                  className={cn(
                    calendarPanelClassName,
                    "max-h-[min(90dvh,720px)] overflow-y-auto overscroll-contain"
                  )}
                >
                  <div
                    className={cn(
                      "w-full border-b border-border pb-2 mb-2 -mt-0.5 shrink-0",
                      "sticky top-0 z-10 -mx-1 px-1 bg-white dark:bg-card shadow-[0_4px_6px_-4px_rgba(0,0,0,0.12)]"
                    )}
                  >
                    <div className="flex flex-wrap gap-1 sm:gap-1.5 justify-center sm:justify-start">
                      <DateRangePresetRow
                        country={company?.country}
                        onApply={(r) => {
                          onDateRangeChange(r);
                          setIsCalendarOpen(false);
                        }}
                      />
                    </div>
                  </div>
                  <Calendar
                    className="p-0 w-full"
                    classNames={{ table: "w-full" }}
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={asCalendarRange(dateRange)}
                    onSelect={(range) => {
                      if (onDateRangeChange) onDateRangeChange(range as DateRange | undefined);
                      if (range?.from && range.to) setIsCalendarOpen(false);
                    }}
                    numberOfMonths={calendarMonths}
                  />
                </div>
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
    );

    // Reports drill-down (dashboard txn count → Journal/Contra): Party ledger mobile — collapsible summary + scroll + pager
    if (isReportChrome) {
      return (
        <>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
          <header className="sticky top-0 z-10 flex-shrink-0 border-b bg-white p-3 dark:bg-card">
            <div className="flex min-w-0 items-center gap-2">
              {onBack ? (
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onBack}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : null}
              {reportHeaderTitleOnly ? (
                <h1 className="min-w-0 flex-1 text-base font-bold text-muted-foreground">{reportTitle}</h1>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <h1 className="shrink-0 text-base font-bold text-muted-foreground">{reportTitle}</h1>
                    <span className="shrink-0 select-none text-muted-foreground/55" aria-hidden>
                      ·
                    </span>
                    <span
                      className={cn("min-w-0 truncate text-sm font-medium", masterDetailBalanceToneClass(closingBalance))}
                      title={account.accountName}
                    >
                      {account.accountName}
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
                </>
              )}
            </div>
          </header>

          <MobileDetailSummaryCollapsible>
            <div className="flex flex-shrink-0 items-center justify-center gap-2 border-b px-2 py-1">
              <span className="text-xs font-medium text-muted-foreground">{dateLineLabel}</span>
              {hasDateFilterMobile ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  title="Clear date filter"
                  onClick={() => onDateRangeChange(undefined)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
            <div className="relative flex-shrink-0 border-b p-2">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="search transactions"
                className="w-full pl-9"
                value={mobileSearchTerm}
                onChange={(e) => {
                  setMobileSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
          </MobileDetailSummaryCollapsible>

          <div
            className={mdc.reportTxnScrollBody}
          >
            <div className="pb-2">
              {mobileReportView === "chart" ? (
                <RunningBalanceFullChart
                  transactions={filteredMobileTransactions}
                  openingBalance={openingBalanceForPeriod}
                />
              ) : (
              <TransactionsTable adaptiveClosingLabel
                transactions={mobileReportPaginatedTransactions}
                context="account"
                contextId={account.id}
                dateRange={dateRange}
                openingBalance={ledgerPageStats.openingForPage}
                booksOpeningBalance={masterAccountOpening}
                openingBalanceDate={(account as { openingBalanceDate?: unknown }).openingBalanceDate}
                ledgerDateFilterActive={hasLedgerDateFilter}
                ledgerShowBookOpeningRow={rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0}
                openingBalancePeriodStartDate={ledgerOpeningPeriodStartDate}
                showNarration={showNarration}
                visibleColumns={visibleColumns}
                userNames={userNames}
                journalAccountNames={journalAccountNames}
                onRowClick={handleEditVoucher}
                filters={filters}
                setFilters={setFilters}
                activeFilter={activeFilter}
                setActiveFilter={setActiveFilter}
                periodDr={ledgerPageStats.periodDrForPage}
                periodCr={ledgerPageStats.periodCrForPage}
                closingBalance={ledgerPageStats.closingForPage}
                scrollOnlyTransactions
                closingBalanceRowActions={
                  account.id !== "all" ? (
                    <AddVoucherDialog
                      defaultTab="adjustment"
                      allowedTabs={["adjustment"]}
                      defaultVoucherData={{
                        defaultTab: "adjustment",
                        adjustmentTarget: { id: account.id, entityType: "account", name: account.accountName },
                      }}
                    >
                      <Button variant="outline" size="sm" className={cn(LEDGER_HEADER_PILL_CN, "!h-7 min-h-7 text-xs")} title="Adjust Balance">
                        <AdjustBalancePillLabel />
                      </Button>
                    </AddVoucherDialog>
                  ) : null
                }
                transactionCardSearchHighlight={mobileSearchTerm}
                disableLayoutAnimation={ledgerRowGate.suppress}
                {...statementCheck.tableProps}
              />
              )}
            </div>
          </div>
          {mobileReportView === "list" ? (
            <MobileTransactionsPager
              className={mdc.reportTxnPagerOutside}
              currentPage={currentPage}
              totalItems={filteredMobileTransactions.length}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(nextRows) => {
                setRowsPerPage(nextRows);
                setCurrentPage(1);
              }}
              onPageChange={setCurrentPage}
              edgeCounts={rowsPerPage > 0 && useTailPaging ? mobileReportPagerEdgeCounts : undefined}
              pagingMode={useTailPaging ? "newest-first" : "oldest-first"}
            />
          ) : null}

          {mobileCalendarDrawer}
        </div>
        <ReportMobileLedgerFooter
          onPrint={handlePrintStatement}
          onExcel={handleExcelLedger}
          onDateOpen={() => setIsCalendarOpen(true)}
          showBillWise={false}
          mobileView={mobileReportView}
          onViewToggle={() => setMobileReportView((v) => (v === "list" ? "chart" : "list"))}
        />
        </>
      );
    }

    return (
      <div className="relative flex w-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="sticky top-0 z-10 flex-shrink-0 space-y-3 border-b bg-background p-2">
            <div className="bg-card flex items-center justify-between gap-2 rounded-lg p-3">
              {onBack && (
                <Button variant="ghost" size="icon" className="mr-2" onClick={onBack}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <span className="flex-1 text-sm font-medium text-muted-foreground">{balanceText}</span>
              <span className={cn("text-2xl font-bold", closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(Math.abs(closingBalance), { noSuffix: true })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                {/* Mobile: list 80vw + single-line names; green border; scroll pe select nahi (combobox gesture guard). */}
                <Combobox
                  options={allAccounts?.map((p) => ({ value: p.id, label: p.accountName })) ?? []}
                  value={account?.id || ""}
                  onChange={(value) => {
                    if (value && value !== account.id) {
                      router.push(`/bank-cash/${value}`);
                    }
                  }}
                  placeholder="Select an account"
                  noWrapOptions
                  showFullOptionText
                  contentWidthMode="auto"
                  popoverContentClassName="w-[80vw] max-w-[80vw] sm:min-w-[var(--radix-popover-trigger-width)] sm:w-auto sm:max-w-md"
                  triggerClassName="w-full min-w-0 border-2 border-green-600 focus-visible:ring-2 focus-visible:ring-green-600/35"
                />
              </div>
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="search transactions"
                  className="w-full pl-9"
                  value={mobileSearchTerm}
                  onChange={(e) => setMobileSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

        {openingBalanceForPeriod !== 0 && (
          <div className="bg-muted/30 m-4 rounded-lg p-3">
            <div className="flex items-center justify-between text-sm">
              <p className="font-semibold text-muted-foreground">Opening Balance</p>
              <Badge variant="secondary" className={cn("font-normal", openingBalanceForPeriod >= 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
                {formatCurrency(openingBalanceForPeriod, { showDrCr: true })}
              </Badge>
            </div>
          </div>
        )}

        <ScrollArea txnChrome className="min-h-0 flex-1">
          <div className="pb-2">
            {filteredMobileTransactions.map((t: any) => (
              <TransactionRow key={t.id} transaction={t} />
            ))}
          </div>
        </ScrollArea>

        {mobileCalendarDrawer}

        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around gap-2 border-t bg-background/80 p-2 backdrop-blur-sm">
            <AddVoucherDialog defaultTab="payment_in">
              <Button className="h-12 flex-1 rounded-lg bg-green-500 hover:bg-green-600">Receive</Button>
            </AddVoucherDialog>
            <AddVoucherDialog defaultTab="payment_out">
              <Button className="h-12 flex-1 rounded-lg bg-red-500 hover:bg-red-600">Pay</Button>
            </AddVoucherDialog>
            <AddVoucherDialog defaultTab="contra">
              <Button className="h-12 flex-1 rounded-lg bg-blue-500 hover:bg-blue-600">Contra</Button>
            </AddVoucherDialog>
            <Button variant="outline" size="icon" className="h-12 w-12 rounded-lg" onClick={() => setIsCalendarOpen(true)}>
              <CalendarIcon />
            </Button>
          </div>
      </div>
    );
  };

  const renderDesktopView = () => {
    // Show "Under Development" only if it's all vouchers view AND it's NOT contra/journal all view
    if (isAllVouchersView && !isContraAllView && !isJournalAllView && (account.accountType === "journal_view" || account.id === 'all')) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center p-8">
                     <Wrench className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-xl font-semibold">Under Development</h3>
                    <p className="text-muted-foreground mt-2">
                        This aggregated view for all {account.accountName.replace(' Vouchers', '')} transactions is currently being built.
                    </p>
                </CardContent>
            </Card>
        )
    }

    return (
     <div className="h-full flex flex-col">
        {/* Header: identity + pills — Party-style single row */}
        <div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              <div className={LEDGER_HEADER_AVATAR_CN}>
                <EntityFileAttachmentHover
                  fileUrl={trimEntityFileUrlForPreview(account.fileUrl)}
                  triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
                >
                  <ResolvedEntityAvatar
                    className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                    src={trimEntityFileUrlForPreview(account.fileUrl) ?? undefined}
                    alt={account.accountName}
                    fallbackSlot={
                      <Landmark className="h-6 w-6 text-muted-foreground" />
                    }
                  />
                </EntityFileAttachmentHover>
                {account.id !== 'all' && (
                  <EditAccountDialog
                    account={account}
                    allAccounts={allAccounts}
                    onAccountUpdated={onAccountUpdated}
                    onAccountDeleted={onAccountDeleted}
                    hasTransactions={processedTransactions.length > 0}
                  >
                    <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </EditAccountDialog>
                )}
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <h2 className={LEDGER_HEADER_TITLE_CN} title={account.accountName}>{account.accountName}</h2>
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
              <LedgerHeaderPrintButton variant="outline" onClick={handlePrintStatement} />
              <LedgerHeaderReminderButton
                variant="outline"
                disabled={account.id === "all"}
                onClick={() => setReminderOpen(true)}
              />
              <LedgerReminderDialog
                open={reminderOpen}
                onOpenChange={setReminderOpen}
                context={accountReminderContext}
                entityId={account.id}
                title={account.accountName}
              />
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <BsDatePicker
                  isRange
                  valueAD={dateRange}
                  onChangeAD={onDateRangeChange}
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
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={asCalendarRange(tempDateRange)}
                      onSelect={(range) => {
                        if (range?.from) range.from.setHours(12, 0, 0, 0);
                        if (range?.to) range.to.setHours(12, 0, 0, 0);
                        setTempDateRange(range);
                        if (range?.from && range.to) {
                          onDateRangeChange(range);
                          setIsDesktopCalendarOpen(false);
                        } else if (!range) {
                          onDateRangeChange(undefined);
                        }
                      }}
                      numberOfMonths={calendarMonths}
                      modifiers={{ hasTransactions: transactionDates }}
                      modifiersClassNames={{ hasTransactions: 'has-transactions' }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {isFilterActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className={LEDGER_HEADER_PILL_CN}>
                  <XCircle className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
                  Clear Filters
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

        {/* TABLE: page1=oldest block (1–10); Book OB; p2+ Dated w/ date=prev page last txn */}
        <ScrollArea txnChrome className="flex-1">
          <div className="p-4">
            <TransactionsTable adaptiveClosingLabel
              transactions={paginatedTransactions}
              context="account"
              contextId={account.id}
              dateRange={dateRange}
              openingBalance={ledgerPageStats.openingForPage}
              booksOpeningBalance={masterAccountOpening}
              openingBalanceDate={(account as any).openingBalanceDate}
              ledgerDateFilterActive={hasLedgerDateFilter}
              ledgerShowBookOpeningRow={rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0}
              openingBalancePeriodStartDate={ledgerOpeningPeriodStartDate}
              showNarration={showNarration}
              visibleColumns={visibleColumns}
              userNames={userNames}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={ledgerPageStats.periodDrForPage}
              periodCr={ledgerPageStats.periodCrForPage}
              closingBalance={ledgerPageStats.closingForPage}
              closingBalanceRowActions={
                account.id !== "all" ? (
                  <AddVoucherDialog
                    defaultTab="adjustment"
                    allowedTabs={["adjustment"]}
                    defaultVoucherData={{
                      defaultTab: "adjustment",
                      adjustmentTarget: { id: account.id, entityType: "account", name: account.accountName },
                    }}
                  >
                    <Button variant="outline" size="sm" className={cn(LEDGER_HEADER_PILL_CN, "!h-7 min-h-7 text-xs")} title="Adjust Balance">
                      <AdjustBalancePillLabel />
                    </Button>
                  </AddVoucherDialog>
                ) : null
              }
            
              disableLayoutAnimation={ledgerRowGate.suppress}
              {...statementCheck.tableProps}/>
          </div>
          <ScrollBar orientation="horizontal" txnChrome />
        </ScrollArea>
        {/* Footer — masters-style compact LedgerDesktopFooter */}
        <LedgerDesktopFooter
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
                  {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[]).filter(ledgerColumnMenuNoTdsFilter).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={(e) => e.preventDefault()}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        id={`col-${key}-account-ledger`}
                        checked={visibleColumns[key] !== false}
                        onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                      />
                      <label htmlFor={`col-${key}-account-ledger`} className="text-sm font-medium cursor-pointer flex-1">
                        {COLUMN_LABELS[key]}
                      </label>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-account"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="income-expense-account"
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
          rowsPerPageSelectValue={rowsPerPageSelectValue(
            rowsPerPage,
            ROWS_PER_PAGE_OPTIONS_DEFAULT,
            "10"
          )}
          onRowsPerPageChange={(value) => {
            setRowsPerPage(Number(value) || 0);
            setCurrentPage(1);
          }}
          beforeCount={desktopPaginationMeta.beforeCount}
          afterCount={desktopPaginationMeta.afterCount}
          totalCount={searchFilteredTransactions.length}
        />
      </div>
  );
  }

  return (
    <>
      <div className={cn("h-full", isMobile && mobileFooterVariant === "report" && "flex min-h-0 flex-1 flex-col")}>
        {isMobile ? renderMobileView() : renderDesktopView()}
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>Add a New Note for {account.accountName}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onAccountUpdated(account);
                setIsNoteOpen(false);
              }}
              initialContext="Bank/Cash"
              initialEntityId={account.id}
              compactFooter
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={setIsVoucherDialogOpen}
        voucher={selectedVoucher}
        onVoucherUpdated={() => setSelectedVoucher(null)}
      />
    </>
  );
}

