"use client";

import * as React from "react";
import type { Staff, StaffGroup } from "@/components/staff/types";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import { LOAN_LIABILITY_GROUP_ID } from "@/modules/loans/constants/loanConstants";
import { STAFF_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { isMasterEntitySystemGroupId, resolveStaffListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import { isLoanLiabilityStaff } from "@/modules/loans/utils/loanLiabilityStaff";
import { Button } from "@/components/ui/button";
import { LedgerViewModePills } from "@/components/ui/LedgerViewModePills";
import { Edit, Printer, Calendar as CalendarIcon, FilePlus, XCircle, MoreVertical, ArrowLeft, ChevronDown, Columns3, Search, Pencil } from "lucide-react";
import { StaffAccountFallbackIcon } from "@/components/entity/StaffEntityIcon";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
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
import { type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";

import { useTransactionVisibleColumns, COLUMN_LABELS, useShowNotes } from "../vouchers/transactionColumnVisibility";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "@/lib/utils";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  patchMasterDetailUrlAfterModalClose,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import { mdc, mdcMobileTxnBalanceRowData, mdcNoEdgeSwipeCapture } from "@/lib/mobileDetailChrome";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
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
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { EditStaffGroupDialog } from "@/components/staff/EditStaffGroupDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { Checkbox } from "../ui/checkbox";
import { toast } from "sonner";
import { openPrintDirect, companyFiscalFieldsForPrint } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { resolveGroupBooksOpeningBalance } from "@/lib/ledgerOpeningBalanceDisplay";
import { useTransactions } from "@/hooks/use-transactions";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { useVouchers } from "@/hooks/useVouchers";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { GroupDetailNestedNameHeader } from "@/components/entity/GroupDetailNestedNameHeader";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { EditStaffDialog } from "./EditStaffDialog";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import { useGroupMemberAccountLedgerChrome } from "@/hooks/useGroupMemberAccountLedgerChrome";
import { STAFF_FREEZE_COLLECTION } from "@/lib/masterAccountFreeze/freezeAdapter";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useSyncTempDateRangeFromProp, useDateRangeTimestamps } from "@/hooks/useLedgerDetailDateRange";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "../ui/combobox";
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
import NepaliCalendar from "../ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import type { BSDate } from "@/lib/bs-date";

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
};

export function StaffGroupDetails({
  group,
  allGroups,
  staff,
  onGroupUpdated,
  onGroupDeleted,
  onStaffUpdated,
  dateRange,
  onDateRangeChange,
  onBack,
  userNames,
  groupMemberFilterId = null,
  hideMobilePeriodLabelRow = false,
}: {
  group: StaffGroup;
  allGroups: StaffGroup[];
  staff: Staff[];
  onGroupUpdated: () => void;
  onGroupDeleted: () => void;
  onStaffUpdated: () => void;
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
  const { processedStaff, processedParties, processedAccounts, processedTaxes, processedExpenseAccounts, journalAccountNames, vouchers } = useVouchers();
  const { balanceMode, setBalanceMode } = useBalanceMode();
  const isSystemBranchGroup = isMasterEntitySystemGroupId(STAFF_ENTITY_GROUP_PRESET, group.id);
  const staffInGroup = useMemo(() => {
    if (staff.length > 0) return staff;
    const gid = group.id;
    if (gid === LOAN_LIABILITY_GROUP_ID) {
      return processedStaff.filter((row) => isLoanLiabilityStaff(row));
    }
    if (gid === STAFF_SYSTEM_GROUP_ID) {
      return processedStaff.filter((row) => !isLoanLiabilityStaff(row));
    }
    return filterMembersByMasterGroupScope<Staff>(
      gid,
      processedStaff,
      allGroups,
      resolveStaffListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(STAFF_ENTITY_GROUP_PRESET, id) || id === LOAN_LIABILITY_GROUP_ID
    );
  }, [staff, group.id, allGroups, processedStaff]);
  const childGroups = useMemo(() => allGroups.filter((g) => g.parentId === group.id), [allGroups, group.id]);

  const selectedMemberStaff = useMemo(() => {
    if (!groupMemberFilterId) return null;
    return processedStaff.find((member) => member.id === groupMemberFilterId) ?? null;
  }, [groupMemberFilterId, processedStaff]);

  const selectedMemberAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(selectedMemberStaff?.fileUrl),
    [selectedMemberStaff?.fileUrl, selectedMemberStaff?.id]
  );

  const {
    memberFreezeOverlay,
    memberClosingBalanceRowActions,
    memberClosingBalanceActions,
  } = useGroupMemberAccountLedgerChrome({
    companyId,
    collection: STAFF_FREEZE_COLLECTION,
    patchCollection: "staff",
    selectedMember: selectedMemberStaff,
    adjustmentEntityType: "staff",
    onMemberUpdated: onStaffUpdated,
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
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "payment_in" | "payment_out" | "add_salary">(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const openingModalRef = useRef(false);

  useSyncTempDateRangeFromProp(dateRange, setTempDateRange);
  const { fromMs: dateRangeFromMs, toMs: dateRangeToMs } = useDateRangeTimestamps(dateRange);
  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "10");
  const handleBsDateRangeChange = useCallback(
    (range?: DateRange) => {
      onDateRangeChange(range);
    },
    [onDateRangeChange]
  );
  const handleGroupComboboxChange = useCallback(
    (value: string) => {
      if (value && value !== group.id) router.push(`/staff?view=groups&selected=${value}`);
    },
    [group.id, router]
  );

  const groupTransactionEntity = useMemo(() => ({ ...group, items: staff }), [group, staff]);

  let { openingBalanceForPeriod, processedTransactions, periodDr, periodCr, closingBalance, openingBalanceOutstanding, openingBalanceLinkedVoucherNos } = useTransactions(
    groupTransactionEntity,
    "group",
    dateRange,
    undefined,
    processedStaff,
    undefined,
    undefined,
    filters,
    undefined,
    undefined,
    userNames
  );

  const transactionDates = useMemo(() => {
    const dates = new Set<number>();
    processedTransactions.forEach((v: any) => {
      const dateValue = v.date?.toDate ? v.date.toDate() : new Date(v.date);
      if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        dates.add(startOfDay(dateValue).getTime());
      }
    });
    return Array.from(dates).map((d) => new Date(d));
  }, [processedTransactions]);

  const isFilterActive = dateRange !== undefined || Object.values(filters).some((v) => v);

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

  const handleEditVoucher = (voucher: any) => {
    openingModalRef.current = true;
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    openModalInUrl();
    setIsVoucherDialogOpen(true);
  };

  // One click / one Enter opens edit (same as Staff details and mobile). No 2-click on desktop.
  const handleTransactionOpen = useCallback((voucher: any) => {
    handleEditVoucher(voucher);
  }, []);

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const anyMobilePopupOpen = isMobile && (!!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen || isNoteOpen);

  const openModalInUrl = useCallback(() => {
    if (!isMobile || !pathname) return;
    persistPlModalParentQuery(searchParams.toString());
    const params = new URLSearchParams(searchParamsStringForModalClose(searchParams.toString()));
    params.set("modal", "1");
    params.set("modalts", String(Date.now()));
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
    setIsNoteOpen(false);
    setNoteEntityId(null);
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

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const buildDateRangeText = () => {
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

  const groupDropdownOptions = useMemo(
    () => allGroups.map((g) => ({ value: g.id, label: g.name })),
    [allGroups]
  );

  const accountNamesMap = useMemo(
    () => ({
      ...Object.fromEntries((processedAccounts || []).map((a) => [a.id, a.accountName])),
      ...Object.fromEntries((processedParties || []).map((p) => [p.id, p.name])),
      ...Object.fromEntries((processedStaff || []).map((s) => [s.id, s.name])),
      ...Object.fromEntries((processedTaxes || []).map((t) => [t.id, t.name])),
      ...Object.fromEntries((processedExpenseAccounts || []).map((e) => [e.id, e.name])),
    }),
    [processedAccounts, processedParties, processedStaff, processedTaxes, processedExpenseAccounts]
  );
  const mobileSearchNames = useMemo(
    () => ({ ...accountNamesMap, ...journalAccountNames, ...(userNames || {}) }),
    [accountNamesMap, journalAccountNames, userNames]
  );

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
    if (isNoteOpen) {
      setIsNoteOpen(false);
      setNoteEntityId(null);
      closeModalInUrl();
      return;
    }
    onBack?.();
  }, [mobileFooterDialogOpen, isCalendarOpen, isVoucherDialogOpen, isNoteOpen, closeModalInUrl, onBack]);

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

  const filteredMobileTransactions = useMemo(() => {
    if (!mobileSearchTerm) return sortedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();
    return sortedTransactions.filter((t: any) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "group", group.id, "staff").includes(lowerCaseSearch) ||
        formatDate(d).toLowerCase().includes(lowerCaseSearch) ||
        formatDateBS(d).toLowerCase().includes(lowerCaseSearch) ||
        String(t.total || t.amount || 0).toLowerCase().includes(lowerCaseSearch) ||
        String(t.debit).toLowerCase().includes(lowerCaseSearch) ||
        String(t.credit).toLowerCase().includes(lowerCaseSearch) ||
        String(debitCreditAmount).toLowerCase().includes(lowerCaseSearch) ||
        String(t.balance).toLowerCase().includes(lowerCaseSearch)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, formatDate, formatDateBS, mobileSearchNames, group.id]);

  const mobileTransactionsToShow = useMemo(() => {
    const list = filteredMobileTransactions;
    if (rowsPerPage <= 0) return list;
    const total = list.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return list.slice(start, Math.max(start, end));
  }, [filteredMobileTransactions, currentPage, rowsPerPage]);
  const mobilePagerEdgeCounts = useMemo(() => {
    const total = filteredMobileTransactions.length;
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return { before: start, after: Math.max(0, total - end) };
  }, [filteredMobileTransactions.length, currentPage, rowsPerPage]);

  useEffect(() => {
    const total = rowsPerPage > 0 ? Math.ceil(filteredMobileTransactions.length / rowsPerPage) : 1;
    const safeTotal = Math.max(1, total);
    setCurrentPage((prev) => {
      const next = Math.min(Math.max(1, prev), safeTotal);
      return next === prev ? prev : next;
    });
  }, [dateRangeFromMs, dateRangeToMs, filteredMobileTransactions.length, rowsPerPage]);

  const dateRangeLabel = buildDateRangeText();

  // Statement check mode + desktop tail paging (PartyDetails jaisa)
  const {
    statementCheck,
    desktopPaginationMeta: desktopPageLedgerStats,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId: companyId ?? undefined,
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

  const handleOpenNoteDialog = (staffId?: string) => {
    if (staff.length === 1) {
      setNoteEntityId(staff[0].id);
    } else if (staffId) {
      setNoteEntityId(staffId);
    }
    setIsNoteOpen(true);
  };

  const handlePrint = async () => {
    if (!company) return;
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;

      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    try {
      // Keep print columns and note visibility aligned with current table controls.
      const printVisibleColumns = balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns;
      await openPrintDirect(
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
              ...companyFiscalFieldsForPrint(company as Record<string, unknown>),
            },
            title: `Staff Group Statement: ${group.name}`,
            context: "group",
            contextId: group.id,
            dateSystem: dateSystem,
            dateRangeText: dateRangeText,
            vouchersCount: paginatedTransactions.length,
            openingBalance: desktopPageLedgerStats.openingForPage,
            openingBalanceDate: (group as any).openingBalanceDate,
            openingBalanceNarration: (group as any).openingBalanceNarration ?? null,
            transactions: paginatedTransactions,
            showNarration: showNarration,
            includeNotes: includeNotesInTable,
            visibleColumns: printVisibleColumns,
            userNames: userNames,
            billWise: balanceMode === "bill_wise",
            ...(balanceMode === "bill_wise" && { openingBalanceOutstanding, openingBalanceLinkedVoucherNos }),
          },
          {
            paginatedTransactions,
            openingForPage: desktopPageLedgerStats.openingForPage,
            periodDrForPage: desktopPageLedgerStats.periodDrForPage,
            periodCrForPage: desktopPageLedgerStats.periodCrForPage,
            closingForPage: desktopPageLedgerStats.closingForPage,
            booksOpeningBalance: resolveGroupBooksOpeningBalance(group, staff),
            ledgerShowBookOpeningRow: currentPage === 1,
            ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
            openingBalancePeriodStartDate: dateRange?.from,
            masterOpeningBalanceDate: (group as any).openingBalanceDate,
            dateRange,
          }
        ),
        true
      );
    } catch (e) {
      console.error("Print failed:", e);
      toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
    }
  };

  // Staff balance: Cr (Payable) = Red, Dr (Advance) = Green
  const balanceColorClass = closingBalance >= 0 ? "text-green-600" : "text-red-600";

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={groupDropdownOptions}
          value={group?.id || ""}
          onChange={handleGroupComboboxChange}
          placeholder="Select group"
        />
      </MobileEntityTxnToolbarPicker>
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
          {onBack ? (
            <div className="flex flex-shrink-0 items-center gap-1 border-b px-2 py-0.5" {...mdcNoEdgeSwipeCapture}>
              <Button variant="ghost" size="icon" onClick={handleMobileBack} className="h-6 w-6 flex-shrink-0" aria-label="Back">
                <ArrowLeft className="h-3 w-3" />
              </Button>
              <h1 className="shrink-0 text-sm font-bold text-muted-foreground">Staff group details</h1>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={group.name}>
                {group.name}
              </span>
            </div>
          ) : null}
          <MobileDetailSummaryCollapsible>
          {!hideMobilePeriodLabelRow ? (
            <div className="flex flex-shrink-0 items-center justify-center gap-1 border-b px-2 py-0.5">
              <span className="text-[11px] font-medium leading-tight text-muted-foreground">
                {!dateRange || (dateRange.from == null && dateRange.to == null)
                  ? rowsPerPage > 0
                    ? `Last ${rowsPerPage} Txns`
                    : "All Txns"
                  : dateRangeLabel}
              </span>
              {dateRange != null && (dateRange.from != null || dateRange.to != null) && (
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
            <p className={cn(mdc.mobileTxnBalanceTextLgFlex, balanceColorClass)}>
              <span>{formatCurrency(Math.abs(closingBalance), { showDrCr: false })}</span>
              <span className="text-lg">{closingBalance >= 0 ? "Dr" : "Cr"}</span>
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
              groupEntityType="staff"
              transactionCardSearchHighlight={mobileSearchTerm}
              openingBalance={desktopPageLedgerStats.openingForPage}
              openingBalanceOutstanding={openingBalanceOutstanding}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceDate={(group as any).openingBalanceDate}
              openingBalanceActions={undefined}
              showNarration={showNarration}
              visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
              journalAccountNames={journalAccountNames}
              accountNames={accountNamesMap}
              userNames={userNames}
              onRowClick={handleTransactionOpen}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPageLedgerStats.periodDrForPage}
              periodCr={desktopPageLedgerStats.periodCrForPage}
              closingBalance={desktopPageLedgerStats.closingForPage}
              closingBalanceRowActions={memberClosingBalanceRowActions}
              closingBalanceActions={memberClosingBalanceActions}
              scrollOnlyTransactions
              {...statementCheck.tableProps}
            />
            </MasterAccountFreezeTxnShell>
            </div>
            </div>
            <MobileTransactionsPager
              className={cn("mt-auto shrink-0", mdc.ledgerTxnPagerOutside)}
              currentPage={currentPage}
              totalItems={filteredMobileTransactions.length}
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
          {/* Mobile: header jaisa pill — active mode par green border */}
          <LedgerViewModePills
            className="flex-1 min-w-0"
            buttonClassName="h-6 flex-1 min-w-0 px-1 text-xs"
            value={balanceMode}
            onChange={setBalanceMode}
            options={[
              { value: "statement", label: "Statement" },
              { value: "bill_wise", label: "Bill wise" },
            ]}
          />
          <Button
            className="flex-1 h-6 min-w-0 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-medium"
            onClick={() => {
              openingModalRef.current = true;
              setMobileFooterDialogOpen("payment_in");
              openModalInUrl();
            }}
          >
            Receive
          </Button>
          <Button
            className="flex-1 h-6 min-w-0 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            onClick={() => {
              openingModalRef.current = true;
              setMobileFooterDialogOpen("payment_out");
              openModalInUrl();
            }}
          >
            Pay
          </Button>
          <MobileEntityLedgerFooterPrintButton onClick={() => void handlePrint()} />
          <Drawer
            open={isCalendarOpen}
            onOpenChange={(open) => {
              if (open) {
                openingModalRef.current = true;
                openModalInUrl();
              } else {
                closeModalInUrl();
              }
              setIsCalendarOpen(open);
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
                <MobileDialogDescription>Select a starting and ending date for the transaction list.</MobileDialogDescription>
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
        <AddVoucherDialog
          defaultTab={mobileFooterDialogOpen ?? "payment_out"}
          isOpen={mobileFooterDialogOpen !== null}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
        />
        <Dialog
          open={isNoteOpen}
          onOpenChange={(open) => {
            setIsNoteOpen(open);
            if (!open) {
              setNoteEntityId(null);
              closeModalInUrl();
            } else if (isMobile) {
              openingModalRef.current = true;
              openModalInUrl();
            }
          }}
        >
          <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
            <DialogHeader>
              <DialogTitle>Add a New Note for Staff in {group.name}</DialogTitle>
              <DialogDescription>
                {staff.length > 1 ? "Select which staff this note applies to." : "Record a new note for this staff."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
              {staff.length > 1 && !noteEntityId && (
                <div className="flex flex-col gap-2 p-4">
                  <p className="font-semibold">Select staff for the note:</p>
                  {staff.map((s) => (
                    <Button key={s.id} variant="outline" onClick={() => setNoteEntityId(s.id)}>
                      {s.name}
                    </Button>
                  ))}
                </div>
              )}
              {noteEntityId && (
                <CreateNoteForm
                  onVoucherAction={() => {
                    onStaffUpdated();
                    setIsNoteOpen(false);
                    setNoteEntityId(null);
                  }}
                  initialContext="Staff"
                  initialEntityId={noteEntityId}
                  compactFooter
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
        <AddVoucherDialog
          isOpen={isVoucherDialogOpen}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setIsVoucherDialogOpen(false);
              setSelectedVoucher(null);
              closeModalInUrl();
            } else {
              setIsVoucherDialogOpen(true);
            }
          }}
          voucher={selectedVoucher}
          onVoucherUpdated={() => setSelectedVoucher(null)}
        />
      </div>
    );
  }

  return (
    <>
      <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Table area: same layout as StaffDetails + scrollOnlyTransactions so table gets focus and one Enter opens edit (statement & bill wise) */}
        <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-3 w-3" />
                </Button>
              )}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                {selectedMemberStaff ? (
                  <>
                    <EntityFileAttachmentHover
                      fileUrl={selectedMemberAttachmentUrl}
                      triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
                    >
                      <ResolvedEntityAvatar
                        className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                        companyId={selectedMemberStaff.companyId}
                        src={selectedMemberAttachmentUrl ?? undefined}
                        alt={selectedMemberStaff.name}
                        fallbackSlot={<StaffAccountFallbackIcon staff={selectedMemberStaff} variant="detail" className="h-6 w-6" />}
                      />
                    </EntityFileAttachmentHover>
                    <EditStaffDialog
                      staff={selectedMemberStaff}
                      allGroups={allGroups}
                      onStaffUpdated={onStaffUpdated}
                      onStaffDeleted={onStaffUpdated}
                      hasTransactions={processedTransactions.length > 0}
                    >
                      <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                    </EditStaffDialog>
                  </>
                ) : (
                  <>
                    <Avatar className={cn(LEDGER_HEADER_AVATAR_BOX_CN, "rounded-lg text-lg")}>
                      <AvatarFallback className="bg-muted text-muted-foreground">{getInitials(group.name)}</AvatarFallback>
                    </Avatar>
                    <EditStaffGroupDialog
                      group={group}
                      allGroups={allGroups}
                      onGroupUpdated={onGroupUpdated}
                      onGroupDeleted={onGroupDeleted}
                      hasAccounts={staffInGroup.length > 0 || childGroups.length > 0}
                    >
                      <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                    </EditStaffGroupDialog>
                  </>
                )}
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <GroupDetailNestedNameHeader
                  groupName={group.name}
                  memberName={selectedMemberStaff?.name ?? null}
                />
              </div>
              <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
                <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                  <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                  <div
                    className={cn(LEDGER_HEADER_BALANCE_CN, "flex items-baseline justify-end gap-px",
                      balanceColorClass
                    )}
                  >
                    <span>{formatCurrency(Math.abs(closingBalance), { showDrCr: false })}</span>
                    <span className="text-sm">{closingBalance >= 0 ? "Dr" : "Cr"}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className={LEDGER_HEADER_PILL_ROW_CN}>
              <LedgerHeaderPrintButton variant="chromePill" onClick={handlePrint} />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <BsDatePicker
                  isRange
                  masterLedgerDatePresets
                  ledgerPaginationReset={ledgerPaginationReset}
                  valueAD={dateRange}
                  onChangeAD={handleBsDateRangeChange}
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
                      className={cn(
                        "justify-start text-left font-normal px-2 w-auto",
                        LEDGER_HEADER_PILL_CN,
                        !dateRange && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
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
                            onDateRangeChange?.(r);
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
              <LedgerViewModePills
                value={balanceMode}
                onChange={setBalanceMode}
                options={[
                  { value: "statement", label: "Statement" },
                  { value: "bill_wise", label: "Bill wise" },
                ]}
              />
              <Button variant="chromePill" size="sm" onClick={() => handleOpenNoteDialog()} className={LEDGER_HEADER_PILL_CN}>
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
              groupEntityType="staff"
              showNarration={showNarration}
              visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
              openingBalance={desktopPageLedgerStats.openingForPage}
              openingBalanceOutstanding={openingBalanceOutstanding}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceDate={(group as any).openingBalanceDate}
              openingBalanceActions={
                <EditStaffGroupDialog
                  group={group}
                  allGroups={allGroups}
                  onGroupUpdated={onGroupUpdated}
                  onGroupDeleted={onGroupDeleted}
                  hasAccounts={staffInGroup.length > 0 || childGroups.length > 0}
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </EditStaffGroupDialog>
              }
              journalAccountNames={journalAccountNames}
              accountNames={accountNamesMap}
              userNames={userNames}
              onRowClick={handleTransactionOpen}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPageLedgerStats.periodDrForPage}
              periodCr={desktopPageLedgerStats.periodCrForPage}
              closingBalance={desktopPageLedgerStats.closingForPage}
              closingBalanceRowActions={memberClosingBalanceRowActions}
              closingBalanceActions={memberClosingBalanceActions}
              scrollOnlyTransactions
              hideDebitColumn={false}
              hideCreditColumn={false}
              {...statementCheck.tableProps}
            />
            </MasterAccountFreezeTxnShell>
          </>
          }
          footer={
        <LedgerDesktopFooter
          left={
            <>
              <LedgerFooterCheckboxPill
                id="show-narration-staff-group"
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
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Checkbox
                          id={`col-${key}-staff-group`}
                          checked={isStatusInStatement ? false : isStatusInBillWise ? true : visibleColumns[key] !== false}
                          disabled={isStatusLocked}
                          onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                        />
                        <label
                          htmlFor={`col-${key}-staff-group`}
                          className={cn(
                            "text-sm font-medium flex-1",
                            isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          )}
                        >
                          {COLUMN_LABELS[key]}
                        </label>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-staff-group"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="staff-group"
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
          beforeCount={desktopPageLedgerStats.beforeCount}
          afterCount={desktopPageLedgerStats.afterCount}
          totalCount={displayTransactions.length}
        />
          }
        />
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>Add a New Note for Staff in {group.name}</DialogTitle>
            <DialogDescription>
              {staff.length > 1 ? "Select which staff this note applies to." : "Record a new note for this staff."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {staff.length > 1 && !noteEntityId && (
              <div className="flex flex-col gap-2 p-4">
                <p className="font-semibold">Select staff for the note:</p>
                {staff.map((s) => (
                  <Button key={s.id} variant="outline" onClick={() => setNoteEntityId(s.id)}>
                    {s.name}
                  </Button>
                ))}
              </div>
            )}
            {noteEntityId && (
              <CreateNoteForm
                onVoucherAction={() => {
                  onStaffUpdated();
                  setIsNoteOpen(false);
                  setNoteEntityId(null);
                }}
                initialContext="Staff"
                initialEntityId={noteEntityId}
                compactFooter
              />
            )}
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
