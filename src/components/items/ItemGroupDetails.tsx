
'use client';

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import * as React from "react";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { resolveGroupBooksOpeningBalance } from "@/lib/ledgerOpeningBalanceDisplay";
import type { Item, ItemGroup } from "@/components/items/types";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import { ITEM_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { isMasterEntitySystemGroupId, resolveItemListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Edit,
  Printer,
  Users,
  Calendar as CalendarIcon,
  FilePlus,
  XCircle,
  MoreVertical,
  ArrowLeft,
  Scroll,
  DollarSign,
  ChevronDown,
  Columns3,
  Pencil,
  Package,
} from "lucide-react";
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
import { LedgerHeaderReminderButton } from "@/components/vouchers/LedgerHeaderReminderButton";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
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
import { formatVoucherEntryTimeLocal } from "@/lib/voucherDateNormalize";
import AdCalendar from "../ui/ad-calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
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
import { mdc, mdcMobileTxnBalanceRowData } from "@/lib/mobileDetailChrome";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { EditItemGroupDialog } from "./EditItemGroupDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { Checkbox } from "../ui/checkbox";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { useTransactions } from "@/hooks/use-transactions";
import { useVouchers } from "@/hooks/useVouchers";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import usePermissions from "@/hooks/usePermissions";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { PartyFilterDropdown } from "@/components/party/PartyFilterDropdown";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Input } from "../ui/input";
import { GroupDetailNestedNameHeader } from "@/components/entity/GroupDetailNestedNameHeader";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { EditItemDialog } from "./EditItemDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "@/components/ui/combobox";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
  DrawerTrigger,
} from "@/components/ui/drawer";
import NepaliCalendar from "@/components/ui/nepali-calendar";
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

export function ItemGroupDetails({
  group,
  allGroups,
  items,
  allItems,
  onGroupUpdated,
  onGroupDeleted,
  onItemUpdated,
  stockView,
  onBack,
  dateRange,
  onDateRangeChange,
  userNames,
  transactions,
  groupMemberFilterId = null,
  hideMobilePeriodLabelRow = false,
}: {
  group: ItemGroup;
  allGroups: ItemGroup[];
  items: Item[];
  allItems: Item[];
  onGroupUpdated: () => void;
  onGroupDeleted: () => void;
  onItemUpdated: () => void;
  stockView: "qty" | "amount";
  onBack?: () => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  userNames: Record<string, string>;
  transactions: any[];
  groupMemberFilterId?: string | null;
  hideMobilePeriodLabelRow?: boolean;
}) {
  useFyLoadOnDateRangeChange(dateRange);
  const { dateSystem, formatDateBS, formatDate, formatCurrency } = useDate();
  const { company, companyId } = useCompany();
  const { processedItems, processedAccounts, processedParties, journalAccountNames, vouchers } = useVouchers();
  const isSystemBranchGroup = isMasterEntitySystemGroupId(ITEM_ENTITY_GROUP_PRESET, group.id);
  const itemsInGroup = useMemo(() => {
    if (groupMemberFilterId) {
      const fromProp = items.filter((i) => i.id === groupMemberFilterId);
      if (fromProp.length > 0) return fromProp;
      const fromProcessed = processedItems.filter((i) => i.id === groupMemberFilterId);
      if (fromProcessed.length > 0) return fromProcessed;
    }
    if (items.length > 0) return items;
    return filterMembersByMasterGroupScope<Item>(
      group.id,
      processedItems,
      allGroups,
      resolveItemListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(ITEM_ENTITY_GROUP_PRESET, id),
      (item, branchId) => resolveItemListGroupBucketId(item) === branchId
    );
  }, [items, group.id, groupMemberFilterId, processedItems, allGroups]);
  const childGroups = useMemo(() => allGroups.filter((g) => (g as any).parentId === group.id), [allGroups, group.id]);

  const selectedMemberItem = useMemo(() => {
    if (!groupMemberFilterId) return null;
    return processedItems.find((item) => item.id === groupMemberFilterId) ?? null;
  }, [groupMemberFilterId, processedItems]);

  const selectedMemberAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(selectedMemberItem?.fileUrls?.[0]),
    [selectedMemberItem?.fileUrls, selectedMemberItem?.id]
  );

  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const [reminderOpen, setReminderOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openingModalRef = useRef(false);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const { balanceMode } = useBalanceMode();
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
  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
  const { showNotes, setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const { can } = usePermissions();
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<"sale" | "purchase" | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  // Item group page: persist Party column visibility for Columns dropdown show/hide.
  const [showPartyColumn, setShowPartyColumn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem("itemPartyColumnVisible") !== "false";
  });
  const [selectedPartyIds, setSelectedPartyIds] = useState<string[]>(['all']);

  useEffect(() => {
    setTempDateRange(dateRange);
  }, [dateRange]);

  const {
    openingBalanceForPeriod,
    processedTransactions: allProcessedTransactions,
    periodDr: allPeriodDr,
    periodCr: allPeriodCr,
    closingBalance: allClosingBalance,
  } = useTransactions(
    { ...group, items: itemsInGroup },
    "group",
    dateRange,
    stockView,
    allItems,
    transactions,
    undefined,
    filters,
    undefined,
    undefined,
    userNames
  );

  // Filter parties to show only those with transactions involving items in this group
  const partiesWithTransactions = useMemo(() => {
    if (!itemsInGroup.length || !processedParties || !allProcessedTransactions) return [];

    const groupItemIds = new Set(itemsInGroup.map((item) => item.id));
    
    // Get unique party IDs that have transactions with items in this group
    const partyIdsWithTransactions = new Set<string>();
    
    allProcessedTransactions.forEach((t: any) => {
      if ((t.type === 'sale' || t.type === 'purchase') && t.partyId) {
        // Check if this transaction involves any item in this group
        const hasGroupItem = t.lineItems?.some((li: any) => groupItemIds.has(li.itemId)) ||
                            t.items?.some((li: any) => groupItemIds.has(li.itemId));
        if (hasGroupItem) {
          partyIdsWithTransactions.add(t.partyId);
        }
      }
    });
    
    // Return only parties that have transactions with items in this group
    return processedParties.filter(party => partyIdsWithTransactions.has(party.id));
  }, [itemsInGroup, processedParties, allProcessedTransactions]);
  // Provide party-id -> party-name map so Item Group "Party" column can resolve names.
  const partyNamesMap = useMemo(
    () => Object.fromEntries((processedParties || []).map((p: any) => [p.id, p.name])),
    [processedParties]
  );
  const mobileSearchNames = useMemo(
    () => ({
      ...partyNamesMap,
      ...journalAccountNames,
      ...Object.fromEntries((processedAccounts || []).map((a: any) => [a.id, a.accountName])),
      ...userNames,
    }),
    [partyNamesMap, journalAccountNames, processedAccounts, userNames]
  );

  // Filter transactions: show Sale, Purchase, and Notes linked to items in this group
  const filteredTransactions = useMemo(() => {
    let transactions = allProcessedTransactions.filter(t =>
      t.type === 'sale' || t.type === 'purchase' || t.type === 'note'
    );

    if (!selectedPartyIds.includes('all') && selectedPartyIds.length > 0) {
      transactions = transactions.filter(t => {
        if (t.type === 'note') return true; // Notes: no party filter, always show
        if (t.type === 'sale' || t.type === 'purchase') {
          return selectedPartyIds.includes(t.partyId);
        }
        return false;
      });
    }
    return transactions;
  }, [allProcessedTransactions, selectedPartyIds]);

  // Recalculate totals for filtered transactions
  const { processedTransactions, periodDr, periodCr, closingBalance } = useMemo(() => {
    const dr = filteredTransactions.reduce((sum, t) => sum + (t.debit || 0), 0);
    const cr = filteredTransactions.reduce((sum, t) => sum + (t.credit || 0), 0);
    const balance = openingBalanceForPeriod + dr - cr;
    return {
      processedTransactions: filteredTransactions,
      periodDr: dr,
      periodCr: cr,
      closingBalance: balance
    };
  }, [filteredTransactions, openingBalanceForPeriod]);
  
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

  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v) || (!selectedPartyIds.includes('all') && selectedPartyIds.length > 0);

  const clearFilters = () => {
    onDateRangeChange(undefined);
    setTempDateRange(undefined);
    setFilters({});
    setSelectedPartyIds(['all']);
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

  const anyMobilePopupOpen = isMobile && (!!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen || isNoteOpen);

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

  const handleEditVoucher = (voucher: any) => {
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    openingModalRef.current = true;
    openModalInUrl();
    setIsVoucherDialogOpen(true);
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
  }, [mobileFooterDialogOpen, isCalendarOpen, isVoucherDialogOpen, isNoteOpen, onBack, closeModalInUrl]);

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
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

  const filteredMobileTransactions = useMemo(() => {
    if (!mobileSearchTerm) return sortedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();
    return sortedTransactions.filter((t: any) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "group", group.id, "item").includes(lowerCaseSearch) ||
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

  const ledgerPagingTransactions = useMemo(
    () => (isMobile ? filteredMobileTransactions : sortedTransactions),
    [isMobile, filteredMobileTransactions, sortedTransactions]
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
    viewMode: "statement",
    searchFilteredTransactions: ledgerPagingTransactions,
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

  const handleOpenNoteDialog = (itemId?: string) => {
    if (itemsInGroup.length === 1) {
      setNoteEntityId(itemsInGroup[0].id);
    } else if (itemId) {
      setNoteEntityId(itemId);
    }
    openingModalRef.current = true;
    openModalInUrl();
    setIsNoteOpen(true);
  };

  const dateRangeLabel = useMemo(() => {
    if (!dateRange || (dateRange.from == null && dateRange.to == null)) {
      return rowsPerPage > 0 ? `Last ${rowsPerPage} Txns` : "All Txns";
    }
    const from = dateRange.from!;
    const to = dateRange.to || from;
    const fromBS = formatDateBS(from);
    const toBS = to ? formatDateBS(to) : fromBS;
    const fromAD = format(from, "LLL dd, y");
    const toAD = to ? format(to, "LLL dd, y") : fromAD;
    if (dateSystem === "AD") return `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
    if (dateSystem === "BS") return `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
    return `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
  }, [dateRange, dateSystem, formatDateBS, rowsPerPage]);

  const mobilePagerEdgeCounts = useMemo(() => {
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    return {
      before: desktopPaginationMeta.beforeCount ?? 0,
      after: desktopPaginationMeta.afterCount ?? 0,
    };
  }, [rowsPerPage, desktopPaginationMeta.beforeCount, desktopPaginationMeta.afterCount]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [ledgerPagingTransactions.length, totalPages, dateRange, rowsPerPage]);

  const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
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
  };

  const groupReportOptions = useMemo(
    () => allGroups.map((g) => ({ value: g.id, label: g.name })),
    [allGroups]
  );

  const itemGroupTransactionsTableProps = {
    transactions: paginatedTransactions,
    context: "group" as const,
    groupEntityType: "item" as const,
    contextId: group.id,
    showItemPartyColumn: showPartyColumn,
    showNarration,
    visibleColumns: { ...visibleColumns, status: false },
    openingBalance: desktopPaginationMeta.openingForPage,
    openingBalanceDate: (group as any).openingBalanceDate,
    userNames,
    accountNames: partyNamesMap,
    onRowClick: handleEditVoucher,
    filters,
    setFilters,
    activeFilter,
    setActiveFilter,
    periodDr: desktopPaginationMeta.periodDrForPage,
    periodCr: desktopPaginationMeta.periodCrForPage,
    closingBalance: desktopPaginationMeta.closingForPage,
    highlightPendingApproval: true,
    ...statementCheck.tableProps,
  };

  const handlePrint = () => {
    if (!company) return;
    // Keep item-group print headers aligned with selected table columns.
    const printVisibleColumns = { ...visibleColumns, status: false };
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;

      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === "BS")
        dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else
        dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
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
          title: `Item Group Statement: ${group.name}`,
          context: "group",
          contextId: group.id,
          dateSystem: dateSystem,
          dateRangeText: dateRangeText,
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (group as any).openingBalanceDate,
          openingBalanceNarration: (group as any).openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: showNotes,
          visibleColumns: printVisibleColumns,
          userNames: userNames,
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: resolveGroupBooksOpeningBalance(group, itemsInGroup, stockView),
          ledgerShowBookOpeningRow: desktopPaginationMeta.sliceStart === 0,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: dateRange?.from,
          masterOpeningBalanceDate: (group as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };
  const handlePartyColumnToggle = (checked: boolean) => {
    // Keep Party column preference sticky within the current browser session.
    setShowPartyColumn(checked);
    if (typeof window !== "undefined") sessionStorage.setItem("itemPartyColumnVisible", checked ? "true" : "false");
  };

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={groupReportOptions}
          value={group.id}
          onChange={(value) => {
            const g = allGroups.find((gr) => gr.id === value);
            if (g && value !== group.id) router.push(`/items/group/${value}`);
          }}
          placeholder="Select a group"
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
          {/* Mobile: date/balance/search — footer chevron se collapse */}
          <MobileDetailSummaryCollapsible>
          <div className="flex flex-col flex-shrink-0 border-b bg-background">
            {!hideMobilePeriodLabelRow ? (
              <div className="px-2 py-1 border-b flex justify-center items-center gap-1.5 flex-shrink-0 bg-background">
                <span className="text-xs font-medium text-muted-foreground">{dateRangeLabel}</span>
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
            <div
              className={cn(mdc.mobileTxnBalanceRow, "flex items-center justify-between gap-2")}
              {...mdcMobileTxnBalanceRowData}
            >
              <span className="m-0 flex-1 text-sm font-medium leading-tight text-muted-foreground">
                {closingBalance >= 0 ? "Asset" : "Liability"}
              </span>
              <span className={cn("m-0 text-2xl font-bold leading-tight", closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(Math.abs(closingBalance), { noSuffix: true })}
              </span>
            </div>
          </div>
          </MobileDetailSummaryCollapsible>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto scroll-touch">
              <div className="pb-2">
                <TransactionsTable {...itemGroupTransactionsTableProps} scrollOnlyTransactions />
              </div>
            </div>
            <MobileTransactionsPager
              className={mdc.ledgerTxnPagerOutside}
              currentPage={currentPage}
              totalItems={ledgerPagingTransactions.length}
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
          <Button className="flex-1 h-6 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium" onClick={() => { openingModalRef.current = true; setMobileFooterDialogOpen("sale"); openModalInUrl(); }}>
            New Sale
          </Button>
          <MobileEntityLedgerFooterPrintButton onClick={handlePrint} />
          <AddVoucherDialog
            isOpen={!!mobileFooterDialogOpen}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setMobileFooterDialogOpen(null);
                closeModalInUrl();
              }
            }}
            defaultTab={mobileFooterDialogOpen || "sale"}
          />
          <Drawer open={isCalendarOpen} onOpenChange={(open: boolean) => {
            if (open) {
              openingModalRef.current = true;
              openModalInUrl();
            }
            setIsCalendarOpen(open);
            if (!open) closeModalInUrl();
          }}>
            <DrawerTrigger asChild>
              <Button className="flex-1 h-6 min-w-0 rounded-md text-xs font-medium px-1 bg-pink-600 hover:bg-pink-700 text-white">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader className="p-4 text-left">
                <DrawerTitle>Select Date Range</DrawerTitle>
                <DrawerDescription>Select a starting and ending date for the transaction list.</DrawerDescription>
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
                  <div className="flex-1 w-full min-w-0">
                    <AdCalendar
                      rangePresetSlot={
                        <DateRangePresetRow
                          country={company?.country}
                          onApply={(r) => {
                            onDateRangeChange(r);
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
                <DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </div>
        <Dialog open={isNoteOpen} onOpenChange={(open: boolean) => {
          if (open) {
            openingModalRef.current = true;
            openModalInUrl();
          }
          setIsNoteOpen(open);
          if (!open) closeModalInUrl();
        }}>
          <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
            <DialogHeader>
              <DialogTitle>Add a New Note for an Item in {group.name}</DialogTitle>
              <DialogDescription>
                {itemsInGroup.length > 1 ? "Select which item this note applies to." : "Record a new note for this item."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
              {itemsInGroup.length > 1 && !noteEntityId && (
                <div className="flex flex-col gap-2 p-4">
                  <p className="font-semibold">Select an item for the note:</p>
                  {itemsInGroup.map((item) => (
                    <Button key={item.id} variant="outline" onClick={() => setNoteEntityId(item.id)}>
                      {item.name}
                    </Button>
                  ))}
                </div>
              )}
              {noteEntityId && (
                <CreateNoteForm
                  onVoucherAction={() => {
                    onItemUpdated();
                    setIsNoteOpen(false);
                    setNoteEntityId(null);
                  }}
                  initialContext="Items"
                  initialEntityId={noteEntityId}
                  showSaveAndApproveOnCreate={can("approve_transactions")}
                  showApproveButton={can("approve_transactions")}
                  compactFooter
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
        <AddVoucherDialog
          isOpen={isVoucherDialogOpen}
          onOpenChange={(open: boolean) => {
            setIsVoucherDialogOpen(!!open);
            if (!open) {
              setSelectedVoucher(null);
              if (isMobile) closeModalInUrl();
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
      <div className="h-full">
        <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Header: Part 1 (name→balance) and Part 2 (date→print) side by side; Part 2 wraps to bottom on small; parts never wrap internally; scroll if needed */}
        <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {onBack && (
                <Button variant="ghost" size="icon" onClick={handleMobileBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                {selectedMemberItem ? (
                  <>
                    <EntityFileAttachmentHover
                      fileUrl={selectedMemberAttachmentUrl}
                      triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
                    >
                      <ResolvedEntityAvatar
                        className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                        companyId={selectedMemberItem.companyId}
                        src={selectedMemberAttachmentUrl ?? undefined}
                        alt={selectedMemberItem.name}
                        fallbackSlot={<Package className="h-6 w-6 text-muted-foreground" />}
                      />
                    </EntityFileAttachmentHover>
                    <EditItemDialog
                      item={selectedMemberItem}
                      onItemUpdated={onItemUpdated}
                      onItemDeleted={onItemUpdated}
                      hasTransactions={processedTransactions.length > 0}
                    >
                      <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                    </EditItemDialog>
                  </>
                ) : (
                  <>
                    <Avatar className={cn(LEDGER_HEADER_AVATAR_BOX_CN, "rounded-lg text-lg")}>
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        {getInitials(group.name)}
                      </AvatarFallback>
                    </Avatar>
                    {!isSystemBranchGroup && (
                      <EditItemGroupDialog
                        group={group}
                        allGroups={allGroups}
                        onGroupUpdated={onGroupUpdated}
                        onGroupDeleted={onGroupDeleted}
                        hasAccounts={itemsInGroup.length > 0 || childGroups.length > 0}
                      >
                        <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                          <Pencil className="h-3 w-3" />
                        </button>
                      </EditItemGroupDialog>
                    )}
                  </>
                )}
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <GroupDetailNestedNameHeader
                  groupName={group.name}
                  memberName={selectedMemberItem?.name ?? null}
                />
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
              <LedgerHeaderReminderButton
                variant="outline"
                onClick={() => setReminderOpen(true)}
              />
              <LedgerReminderDialog
                open={reminderOpen}
                onOpenChange={setReminderOpen}
                context="Items"
                title={group.name}
              />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
              {(dateSystem === "BS" || dateSystem === "Both") && (
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
              {partiesWithTransactions && partiesWithTransactions.length > 0 && (
                <PartyFilterDropdown
                  parties={partiesWithTransactions}
                  selectedPartyIds={selectedPartyIds}
                  onSelectionChange={setSelectedPartyIds}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenNoteDialog()}
                className={LEDGER_HEADER_PILL_CN}
              >
                <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
              </Button>
              
            </div>
          </div>
        </div>
          }
          table={
          <>
          
            <TransactionsTable
              transactions={paginatedTransactions}
              context="group"
              // Mark this group table as item-group so Party column/header can render.
              groupEntityType="item"
              contextId={group.id}
              showItemPartyColumn={showPartyColumn}
              showNarration={showNarration}
              visibleColumns={{ ...visibleColumns, status: false }}
              openingBalance={desktopPaginationMeta.openingForPage}
              openingBalanceDate={(group as any).openingBalanceDate}
              userNames={userNames}
              // Reuse generic names resolver in table to show party names for item group rows.
              accountNames={partyNamesMap}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={desktopPaginationMeta.closingForPage}
            
              {...statementCheck.tableProps}/>
          </>
          }
          footer={
        <LedgerDesktopFooter
          left={
            <>
              <LedgerFooterCheckboxPill
                id="show-narration-item-group"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
              <LedgerFooterColumnsMenu>
                <DropdownMenuContent align="start" className="w-52 p-2">
                  {(["date", "type", "voucherNo", "party", "user", "file", "dr", "cr", "runningBalance", "status"] as Array<TransactionColumnKey | "party">)
                    .filter((key) => key !== "status" || balanceMode === "bill_wise")
                    .map((key) => {
                    if (key === "party") {
                      return (
                        <DropdownMenuItem
                          key="party"
                          onSelect={(e) => e.preventDefault()}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Checkbox
                            id="col-party-item-group"
                            checked={showPartyColumn}
                            onCheckedChange={(c) => handlePartyColumnToggle(Boolean(c))}
                          />
                          <label htmlFor="col-party-item-group" className="text-sm font-medium flex-1 cursor-pointer">
                            Party
                          </label>
                        </DropdownMenuItem>
                      );
                    }
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
                          id={`col-${key}-item-group`}
                          checked={isStatusInStatement ? false : (isStatusInBillWise ? true : visibleColumns[key] !== false)}
                          disabled={isStatusLocked}
                          onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                        />
                        <label htmlFor={`col-${key}-item-group`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                          {COLUMN_LABELS[key]}
                        </label>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-item-group"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="item-group"
                enabled={statementCheck.checkModeEnabled}
                onEnabledChange={statementCheck.setCheckModeEnabled}
                viewMode={"statement"}
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
          includeAllOption={false}
          beforeCount={desktopPaginationMeta.beforeCount}
          afterCount={desktopPaginationMeta.afterCount}
          totalCount={displayTransactions.length}
        />
          }
        />
      </div>
      </div>
      <Dialog open={isNoteOpen} onOpenChange={(open: boolean) => {
        if (open) {
          openingModalRef.current = true;
          openModalInUrl();
        }
        setIsNoteOpen(open);
        if (!open) closeModalInUrl();
      }}>
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Add a New Note for an Item in {group.name}
            </DialogTitle>
            <DialogDescription>
              {itemsInGroup.length > 1
                ? "Select which item this note applies to."
                : "Record a new note for this item."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {itemsInGroup.length > 1 && !noteEntityId && (
              <div className="flex flex-col gap-2 p-4">
                <p className="font-semibold">Select an item for the note:</p>
                {itemsInGroup.map((item) => (
                  <Button
                    key={item.id}
                    variant="outline"
                    onClick={() => setNoteEntityId(item.id)}
                  >
                    {item.name}
                  </Button>
                ))}
              </div>
            )}
            {noteEntityId && (
              <CreateNoteForm
                onVoucherAction={() => {
                  onItemUpdated();
                  setIsNoteOpen(false);
                  setNoteEntityId(null);
                }}
                initialContext="Items"
                initialEntityId={noteEntityId}
                showSaveAndApproveOnCreate={can("approve_transactions")}
                showApproveButton={can("approve_transactions")}
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
