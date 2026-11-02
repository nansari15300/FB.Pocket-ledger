
'use client';

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import * as React from "react";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { resolveGroupBooksOpeningBalance } from "@/lib/ledgerOpeningBalanceDisplay";
import type { ExpenseAccount, ExpenseGroup } from "@/components/expenses/types";
import { collectExpenseGroupScopeAccounts, collectExpenseGroupScopeGroupIds } from "@/lib/expenseGroupTree";
import { EXPENSE_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { isMasterEntitySystemGroupId } from "@/lib/masterEntitySystemGroups";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Edit, Printer, Users, Calendar as CalendarIcon, FilePlus, XCircle, MoreVertical, ArrowLeft, Scroll, DollarSign, ChevronDown, Columns3, Search, Pencil, Lock } from "lucide-react";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
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
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "@/lib/utils";
import { mdc, mdcMobileTxnBalanceRowData } from "@/lib/mobileDetailChrome";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  patchMasterDetailUrlAfterModalClose,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import { startOfDay, endOfDay, format } from "date-fns";
import AdCalendar from "../ui/ad-calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_BOX_CN,
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
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { EditExpenseGroupDialog } from "@/components/expenses/EditExpenseGroupDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { Checkbox } from "../ui/checkbox";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { useTransactions, getTransactionAmounts } from "@/hooks/use-transactions";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { useVouchers } from "@/hooks/useVouchers";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import usePermissions from "@/hooks/usePermissions";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Input } from "../ui/input";
import { GroupDetailNestedNameHeader } from "@/components/entity/GroupDetailNestedNameHeader";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { EditExpenseAccountDialog } from "./EditExpenseAccountDialog";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import { useGroupMemberAccountLedgerChrome } from "@/hooks/useGroupMemberAccountLedgerChrome";
import { EXPENSE_FREEZE_COLLECTION } from "@/lib/masterAccountFreeze/freezeAdapter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { pushIncomeExpenseGroupSwitch } from "@/lib/incomeExpenseDetailNav";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "../ui/combobox";
import NepaliCalendar from "../ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import type { BSDate } from "@/lib/bs-date";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription as MobileDialogDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";


const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
};


export function ExpenseGroupDetails({ 
  group,
  allGroups,
  accounts,
  onGroupUpdated, 
  onGroupDeleted,
  onAccountUpdated,
  dateRange,
  onDateRangeChange,
  onBack,
  userNames,
  groupMemberFilterId = null,
  hideMobilePeriodLabelRow = false,
}: { 
  group: ExpenseGroup, 
  allGroups: ExpenseGroup[],
  accounts: ExpenseAccount[],
  onGroupUpdated: () => void, 
  onGroupDeleted: () => void,
  onAccountUpdated: () => void,
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  userNames?: Record<string, string>;
  onBack?: () => void;
  groupMemberFilterId?: string | null;
  hideMobilePeriodLabelRow?: boolean;
}) {
  useFyLoadOnDateRangeChange(dateRange);
  const { dateSystem, formatDateBS, formatDate, formatCurrency } = useDate();
  const { company, companyId } = useCompany();
  const { processedExpenseAccounts, vouchers, journalAccountNames } = useVouchers();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();
  const { showNotes, setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const { balanceMode } = useBalanceMode();
  const { can } = usePermissions();
  const isSystemBranchGroup = isMasterEntitySystemGroupId(EXPENSE_ENTITY_GROUP_PRESET, group.id);
  const accountsInGroup = useMemo(() => {
    if (accounts.length > 0) return accounts;
    return collectExpenseGroupScopeAccounts(
      group.id,
      allGroups,
      processedExpenseAccounts
    );
  }, [processedExpenseAccounts, accounts, group.id, allGroups]);
  const mobileSearchNames = useMemo(
    () => ({
      ...journalAccountNames,
      ...Object.fromEntries(accountsInGroup.map((a) => [a.id, a.name])),
      ...(userNames ?? {}),
    }),
    [journalAccountNames, accountsInGroup, userNames]
  );
  const childGroups = useMemo(() => allGroups.filter((g) => (g as any).parentId === group.id), [allGroups, group.id]);

  const selectedMemberAccount = useMemo(() => {
    if (!groupMemberFilterId) return null;
    return processedExpenseAccounts.find((account) => account.id === groupMemberFilterId) ?? null;
  }, [groupMemberFilterId, processedExpenseAccounts]);

  const selectedMemberAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(selectedMemberAccount?.fileUrl),
    [selectedMemberAccount?.fileUrl, selectedMemberAccount?.id]
  );

  const {
    memberFreezeOverlay,
    memberClosingBalanceRowActions,
    memberClosingBalanceActions,
  } = useGroupMemberAccountLedgerChrome({
    companyId,
    collection: EXPENSE_FREEZE_COLLECTION,
    patchCollection: "expense_accounts",
    selectedMember: selectedMemberAccount,
    adjustmentEntityType: "expense",
    onMemberUpdated: onAccountUpdated,
  });

  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceMode === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && group?.id
        ? ledgerDetailSessionStorageKey(companyId, "group", group.id, ledgerViewMode)
        : null,
    [companyId, group?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteEntityId, setNoteEntityId] = useState<string | null>(null);
  const [showNarration, setShowNarration] = useState(true);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "add_expense" | "add_income" | "add_salary">(null);
  const openingModalRef = useRef(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);

  useEffect(() => {
    setTempDateRange(dateRange);
  }, [dateRange]);
  
  const groupEntity = useMemo(() => {
    const expenseGroupIds = collectExpenseGroupScopeGroupIds(group.id, allGroups);
    const entity = { ...group, items: accountsInGroup, expenseGroupIds };
    return entity;
  }, [group, accountsInGroup, allGroups]);

  const groupMemberTransactions = useMemo(() => {
    if (!accountsInGroup.length) return [];
    const firstMember = accountsInGroup.find(Boolean);
    if (!firstMember) return [];

    const memberIds = new Set(accountsInGroup.map((a) => a.id));
    const hasExpenseImpactForAccount = (v: any, acc: ExpenseAccount) => {
      const amounts = getTransactionAmounts(v, "expense", acc, undefined, processedExpenseAccounts);
      return Number(amounts.debit || 0) !== 0 || Number(amounts.credit || 0) !== 0;
    };

    return (vouchers || []).filter((v: any) => {
      if (v.type === "note") return memberIds.has(v.entityId);

      // Step 1: first member tracking (same account-details expense filter path)
      const firstMemberHit = hasExpenseImpactForAccount(v, firstMember);
      if (firstMemberHit) return true;

      // Step 2: then check remaining members with same filter logic
      return accountsInGroup.some((acc) => hasExpenseImpactForAccount(v, acc));
    });
  }, [accountsInGroup, vouchers, processedExpenseAccounts]);
  
  const { openingBalanceForPeriod, processedTransactions, periodDr, periodCr, closingBalance, openingBalanceOutstanding, openingBalanceLinkedVoucherNos } = useTransactions(groupEntity, "group", dateRange, undefined, processedExpenseAccounts, groupMemberTransactions, undefined, filters, undefined, undefined, userNames);

  const transactionDates = useMemo(() => {
    const dates = new Set<number>();
    processedTransactions.forEach((v: any) => {
        const dateValue = v.date?.toDate ? v.date.toDate() : new Date(v.date);
        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            dates.add(startOfDay(dateValue).getTime());
        }
    });
    return Array.from(dates).map(d => new Date(d));
  }, [processedTransactions]);

  const isFilterActive = dateRange !== undefined || Object.values(filters).some(v => v);
  
  const clearFilters = () => {
    onDateRangeChange(undefined);
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
    patchMasterDetailUrlAfterModalClose(params, { entityId: group.id, groupsTab: true });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, group.id]);

  const modalParam = searchParams.get("modal");
  const urlModalOpen = isMobile && modalParam === "1" && anyMobilePopupOpen;
  const closeUrlModal = useCallback(() => {
    setMobileFooterDialogOpen(null);
    setIsCalendarOpen(false);
    setIsVoucherDialogOpen(false);
    setSelectedVoucher(null);
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

  const searchFilteredTransactions = useMemo(() => {
    if (!mobileSearchTerm) return processedTransactions;
    const q = mobileSearchTerm.toLowerCase().trim();
    return processedTransactions.filter((t) => {
      const d = t.date?.toDate ? t.date.toDate() : t.date ? new Date(t.date) : null;
      const dateStr = d ? (dateSystem === "BS" ? formatDateBS(d) : format(d, "yyyy-MM-dd")) : "";
      const amt = t.debit > 0 ? t.debit : t.credit;
      const bal = t.balance ?? t.runningBalance ?? 0;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "group", group.id).includes(q) ||
        dateStr.toLowerCase().includes(q) ||
        String(amt || 0).toLowerCase().includes(q) ||
        String(t.debit || 0).toLowerCase().includes(q) ||
        String(t.credit || 0).toLowerCase().includes(q) ||
        String(bal).toLowerCase().includes(q)
      );
    });
  }, [processedTransactions, mobileSearchTerm, dateSystem, formatDateBS, format, mobileSearchNames, group.id]);

  const mobileTransactionsToShow = useMemo(() => {
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
  const dateRangeLabel = buildDateRangeText();

  const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
    const range = dateRange;
    if (!onDateRangeChange) return;
    if (!range?.from || (range.from && range.to)) {
      onDateRangeChange({ from: adDate, to: undefined });
    } else if (adDate < range.from) {
      onDateRangeChange({ from: adDate, to: range.from });
      setIsCalendarOpen(false);
    } else {
      onDateRangeChange({ from: range.from, to: adDate });
      setIsCalendarOpen(false);
    }
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

  const groupDropdownOptions = useMemo(() => {
    return (allGroups || []).map((g) => ({ value: g.id, label: g.name }));
  }, [allGroups]);

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

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  // When showNotes is off, hide note-type transactions (localStorage, shared across pages)
  const displayTransactions = useMemo(
    () => (showNotes ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note")),
    [processedTransactions, showNotes]
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
  // Statement check mode + desktop tail paging (PC footer Check mode pill)
  const {
    statementCheck,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "group",
    contextId: group?.id,
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
    context: "group",
    contextId: group?.id,
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

  // Radix rows Select — value list me honi chahiye (LedgerDesktopFooter pagination)
  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "10");

  const handleOpenNoteDialog = (accountId?: string) => {
    if (accountsInGroup.length === 1) {
        setNoteEntityId(accountsInGroup[0].id);
    } else if (accountId) {
        setNoteEntityId(accountId);
    }
    setIsNoteOpen(true);
  };
  
  const handlePrint = () => {
    if (!company) return;
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;

      if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else
        dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    // Keep print headers aligned with currently selected table columns.
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
          title: `Group Statement: ${group.name}`,
          context: 'group',
          contextId: group.id,
          dateSystem: dateSystem,
          dateRangeText: dateRangeText,
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (group as any).openingBalanceDate,
          openingBalanceNarration: (group as any).openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          billWise: balanceMode === "bill_wise",
          userNames: userNames,
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: resolveGroupBooksOpeningBalance(group, accountsInGroup),
          ledgerShowBookOpeningRow: currentPage === 1,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: dateRange?.from,
          masterOpeningBalanceDate: (group as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      {allGroups && allGroups.length > 0 && (
        <MobileEntityTxnToolbarPicker>
          <Combobox
            options={groupDropdownOptions}
            value={group.id}
            onChange={(value) => {
              if (value && value !== group.id) pushIncomeExpenseGroupSwitch(router, pathname || "", value);
            }}
            placeholder="Select group"
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

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden w-full">
          {/* Mobile: scroll + pager above fixed footer */}
          {/* Mobile: date/balance/search — footer chevron se collapse */}
          <MobileDetailSummaryCollapsible>
          {!hideMobilePeriodLabelRow ? (
            <div className="px-2 py-1 border-b flex justify-center items-center gap-1.5 flex-shrink-0">
              <span className="text-xs font-medium text-muted-foreground">
                {!dateRange || (dateRange.from == null && dateRange.to == null)
                  ? rowsPerPage > 0
                    ? `Last ${rowsPerPage} Txns`
                    : "All Txns"
                  : dateRangeLabel}
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
          <div className={mdc.mobileTxnBalanceRow} {...mdcMobileTxnBalanceRowData}>
            <p className={cn(mdc.mobileTxnBalanceText2xl, closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
              {formatCurrency(Math.abs(closingBalance), { noSuffix: true })}
            </p>
          </div>
          </MobileDetailSummaryCollapsible>
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-touch touch-pan-y pl-ledger-txn-scroll-native",
                mdc.mobileLedgerTxnScrollPad
              )}
              style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
            >
            <div className="pb-2">
            <MasterAccountFreezeTxnShell className="min-h-[8rem]" overlay={memberFreezeOverlay}>
            <TransactionsTable
              transactions={mobileTransactionsToShow}
              context="group"
              contextId={group.id}
              transactionCardSearchHighlight={mobileSearchTerm}
              openingBalance={desktopPaginationMeta.openingForPage}
              openingBalanceOutstanding={openingBalanceOutstanding}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceDate={(group as any).openingBalanceDate}
              showNarration={showNarration}
              visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
              userNames={userNames}
              accountNames={Object.fromEntries(accountsInGroup.map((a) => [a.id, a.name]))}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={desktopPaginationMeta.closingForPage}
              closingBalanceRowActions={memberClosingBalanceRowActions}
              closingBalanceActions={memberClosingBalanceActions}
              scrollOnlyTransactions
            
              {...statementCheck.tableProps}/>
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
        </div>
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
          <Button
            className="flex-1 h-6 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-medium"
            onClick={() => {
              openingModalRef.current = true;
              setMobileFooterDialogOpen("add_income");
              openModalInUrl();
            }}
          >
            Add Income
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
                      <DateRangePresetRow
                        country={company?.country}
                        onApply={(r) => {
                          onDateRangeChange?.(r);
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
                  <div className="flex-1 w-full min-w-0">
                    <AdCalendar
                      rangePresetSlot={
                        <DateRangePresetRow
                          country={company?.country}
                          onApply={(r) => {
                            onDateRangeChange?.(r);
                            setIsCalendarOpen(false);
                          }}
                        />
                      }
                      valueAD={dateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = dateRange;
                        if (!range?.from || (range.from && range.to)) {
                          onDateRangeChange({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          onDateRangeChange({ from: adDate, to: range.from });
                          setIsCalendarOpen(false);
                        } else {
                          onDateRangeChange({ from: range.from, to: adDate });
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
        <AddVoucherDialog
          isOpen={!!mobileFooterDialogOpen && mobileFooterDialogOpen === "add_expense"}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
          defaultTab="direct_expense"
          allowedTabs={["sale", "purchase", "direct_income", "direct_expense", "add_salary"]}
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
          allowedTabs={["sale", "purchase", "direct_income", "direct_expense", "add_salary"]}
          onVoucherAction={() => onAccountUpdated()}
        />
        <AddVoucherDialog
          isOpen={!!mobileFooterDialogOpen && mobileFooterDialogOpen === "add_salary"}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
          defaultTab="add_salary"
          allowedTabs={["sale", "purchase", "direct_income", "direct_expense", "add_salary"]}
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
      </div>
    );
  }

  return (
    <>
      {/* min-h-0 + flex-1 ScrollArea: flex item ko shrink dena zaroori — warna table height expand ho kar scroll band */}
      <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Header: Part 1 (name→balance) and Part 2 (date→print) side by side; Part 2 wraps to bottom on small; parts never wrap internally; scroll if needed */}
        <LedgerTxnScrollColumn
          header={
<div className={cn("flex-shrink-0", LEDGER_HEADER_RIBBON_WRAP_CN)}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                {selectedMemberAccount ? (
                  <>
                    <EntityFileAttachmentHover
                      fileUrl={selectedMemberAttachmentUrl}
                      triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
                    >
                      <ResolvedEntityAvatar
                        className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                        companyId={companyId ?? undefined}
                        src={selectedMemberAttachmentUrl ?? undefined}
                        alt={selectedMemberAccount.name}
                        fallbackSlot={
                          (selectedMemberAccount as any).isSystemReserved ? (
                            <Lock className="h-6 w-6 text-muted-foreground" />
                          ) : (
                            <DollarSign className="h-6 w-6 text-muted-foreground" />
                          )
                        }
                      />
                    </EntityFileAttachmentHover>
                    {selectedMemberAccount.id !== "sales_account" &&
                      selectedMemberAccount.id !== "purchase_account" && (
                        <EditExpenseAccountDialog
                          account={selectedMemberAccount}
                          onAccountUpdated={onAccountUpdated}
                          onAccountDeleted={onAccountUpdated}
                          hasTransactions={processedTransactions.length > 0}
                        >
                          <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                            <Pencil className="h-3 w-3" />
                          </button>
                        </EditExpenseAccountDialog>
                      )}
                  </>
                ) : (
                  <>
                    <Avatar className={cn(LEDGER_HEADER_AVATAR_BOX_CN, "rounded-lg text-lg")}>
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        {getInitials(group.name)}
                      </AvatarFallback>
                    </Avatar>
                    {!isSystemBranchGroup && (
                      <EditExpenseGroupDialog
                        group={group}
                        allGroups={allGroups}
                        onGroupUpdated={onGroupUpdated}
                        onGroupDeleted={onGroupDeleted}
                        hasAccounts={accountsInGroup.length > 0 || childGroups.length > 0}
                      >
                        <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                          <Pencil className="h-3 w-3" />
                        </button>
                      </EditExpenseGroupDialog>
                    )}
                  </>
                )}
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <GroupDetailNestedNameHeader
                  groupName={group.name}
                  memberName={selectedMemberAccount?.name ?? null}
                />
              </div>
              <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
                <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                  <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                  <div className={cn(LEDGER_HEADER_BALANCE_CN, closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(closingBalance, {showDrCr: true})}
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
                  masterLedgerDatePresets
                  ledgerPaginationReset={ledgerPaginationReset}
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
                <Button variant="ghost" size="icon" onClick={clearFilters} className={cn(LEDGER_HEADER_PILL_ICON_CN, "text-muted-foreground hover:text-foreground")} aria-label="Clear date filter">
                  <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => handleOpenNoteDialog()} className={LEDGER_HEADER_PILL_CN}>
                <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
              </Button>
              
            </div>
          </div>
        </div>
          }
          table={
          <>
          
            <MasterAccountFreezeTxnShell className="min-h-[8rem]" overlay={memberFreezeOverlay}>
            <TransactionsTable
              transactions={paginatedTransactions}
              context="group"
              contextId={group.id}
              showNarration={showNarration}
              visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
              openingBalance={desktopPaginationMeta.openingForPage}
              openingBalanceOutstanding={openingBalanceOutstanding}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceDate={(group as any).openingBalanceDate}
              userNames={userNames}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={desktopPaginationMeta.closingForPage}
              closingBalanceRowActions={memberClosingBalanceRowActions}
              closingBalanceActions={memberClosingBalanceActions}
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
                id="show-narration-expense-group"
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
                          id={`col-${key}-expense-group`}
                          checked={isStatusInStatement ? false : (isStatusInBillWise ? true : visibleColumns[key] !== false)}
                          disabled={isStatusLocked}
                          onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                        />
                        <label htmlFor={`col-${key}-expense-group`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                          {COLUMN_LABELS[key]}
                        </label>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-expense-group"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="expense-group"
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
          includeAllOption={false}
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
                <DialogTitle>Add a New Note for an Account in {group.name}</DialogTitle>
                <DialogDescription>
                    {accountsInGroup.length > 1 ? "Select which account this note applies to." : "Record a new note for this account."}
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
                {accountsInGroup.length > 1 && !noteEntityId && (
                     <div className="flex flex-col gap-2 p-4">
                        <p className="font-semibold">Select an account for the note:</p>
                        {accountsInGroup.map(acc => (
                            <Button key={acc.id} variant="outline" onClick={() => setNoteEntityId(acc.id)}>
                                {acc.name}
                            </Button>
                        ))}
                    </div>
                )}
                {noteEntityId && (() => {
                    const selectedAccount = accountsInGroup.find((a: any) => a.id === noteEntityId);
                    const noteContext = selectedAccount?.type === "Income" ? "Income" : "Expense";
                    return (
                    <CreateNoteForm
                        onVoucherAction={() => {
                            onAccountUpdated();
                            setIsNoteOpen(false);
                            setNoteEntityId(null);
                        }}
                        initialContext={noteContext}
                        initialEntityId={noteEntityId}
                        showSaveAndApproveOnCreate={can("approve_transactions")}
                        showApproveButton={can("approve_transactions")}
                        compactFooter
                    />
                    );
                })()}
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
