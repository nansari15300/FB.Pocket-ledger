
"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useVouchers } from "@/hooks/useVouchers";
import { useMasterEntityLivePatch } from "@/hooks/useMasterEntityLivePatch";
import { TransactionsTable, type TransactionColumnKey } from "@/components/vouchers/TransactionsTable";
import { TransactionTableSortDropdown, type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";

import { useTransactionVisibleColumns, COLUMN_LABELS, useShowNotes } from "@/components/vouchers/transactionColumnVisibility";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { 
  FilePenLine, 
  Package, 
  Printer, 
  ArrowLeft, 
  Search, 
  XCircle, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight, 
  Calendar as CalendarIcon,
  FilePlus,
  Columns3,
  ChevronDown,
  Edit,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  patchMasterDetailUrlAfterModalClose,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import type { Item } from "./types";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { useDate } from "@/hooks/useDate";
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
import { ReportHeaderSummaryCards, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AdCalendar from "@/components/ui/ad-calendar";
import { format, startOfDay } from "date-fns";
import { formatVoucherEntryTimeLocal } from "@/lib/voucherDateNormalize";
import type { DateRange } from "@/components/ui/ad-calendar";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useDateRangeTimestamps } from "@/hooks/useLedgerDetailDateRange";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogDescription } from "@/components/ui/dialog";
import { CreateNoteForm } from "@/components/vouchers/CreateNoteForm";
import { EditItemDialog } from "./EditItemDialog";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, usePathname } from "next/navigation";
import { useLocationSearchParams } from "@/hooks/useLocationSearchParams";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "@/components/ui/combobox";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import { useEnsureEntityMinTxnsInScope } from "@/hooks/useEnsureEntityMinTxnsInScope";
import { ledgerMasterDateRangeLabel } from "@/lib/ledgerMasterDefaultView";
import type { BSDate } from "@/lib/bs-date";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useTransactions } from "@/hooks/use-transactions";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import usePermissions from "@/hooks/usePermissions";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle, 
  DrawerFooter, 
  DrawerClose, 
  DrawerTrigger 
} from "@/components/ui/drawer";
import { endOfDay } from "date-fns"; 

const MobileDialogDescription = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

export type StockView = 'qty' | 'amount';

// --- Helper for Unit Conversion ---
const getConversionFactor = (item: Item | undefined, displayUnit: string | undefined): number => {
    if (!item || !displayUnit) return 1;
    
    const conversions = (item.unitConversions || []) as any[];
    if (conversions.length === 0) return 1;

    const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');
    
    if (displayUnit === smallestUnit) return 1;

    let factor = 1;
    let currentUnit = displayUnit;
    let attempts = 0;
    
    while (currentUnit !== smallestUnit && currentUnit && attempts < 10) {
        const conv = conversions.find((c: any) => c.fromUnit === currentUnit);
        if (!conv) { return 1; }
        factor *= Number(conv.conversionFactor) || 1;
        currentUnit = conv.toUnit;
        attempts++;
    }
    return factor > 0 ? factor : 1;
};

/** Master book opening - party `openingBalance` jaisa; date filter / pagination se independent. */
const getItemMasterBooksOpening = (item: Item | undefined, view: StockView): number => {
  if (!item) return 0;
  if (view === "amount") {
    const obQty = Number((item as any).openingBalance) || 0;
    const obRate = Number((item as any).openingBalanceRate) || 0;
    return obQty * obRate;
  }
  const conversions = (item.unitConversions || []) as any[];
  const smallestUnit =
    conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || "");
  const factorFromUnit = (unit: string) => {
    if (!unit || conversions.length === 0) return 1;
    if (unit === smallestUnit) return 1;
    let factor = 1;
    let currentUnit = unit;
    for (let i = 0; i < 10; i++) {
      const conv = conversions.find((c: any) => c.fromUnit === currentUnit);
      if (!conv) return 0;
      factor *= Number(conv.conversionFactor) || 1;
      currentUnit = conv.toUnit;
      if (currentUnit === smallestUnit) break;
    }
    return factor;
  };
  const openingUnit = (item as any).openingBalanceUnit || "";
  return (Number((item as any).openingBalance) || 0) * factorFromUnit(openingUnit);
};

// --- Helper for formatting Quantity only (No Rs.) ---
const formatQtyValue = (val: number) => {
    return Math.abs(val).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

export default function ItemDetails({
  item: initialItem,
  onItemUpdated,
  onItemDeleted,
  stockView = 'amount',
  setStockView, 
  itemDisplayUnits,
  setItemDisplayUnit,
  onBack,
  userNames,
  onShowAll,
  transactions,
  dateRange: dateRangeProp,
  onDateRangeChange,
  hideMobilePeriodLabelRow = false,
  reportSummaryCards,
}: {
  item?: Item;
  onItemUpdated: (updated?: Partial<Item>) => void;
  onItemDeleted: (id: string) => void;
  onShowAll?: () => void;
  stockView?: StockView;
  setStockView?: (view: StockView) => void;
  itemDisplayUnits?: Record<string, string>;
  setItemDisplayUnit?: (itemId: string, unit: string) => void;
  onBack?: () => void;
  userNames?: Record<string, string>;
  transactions: any[];
  dateRange?: DateRange;
  onDateRangeChange?: (dateRange: DateRange | undefined) => void;
  hideMobilePeriodLabelRow?: boolean;
  reportSummaryCards?: ReportStatementSummaryCardData[];
}) {
  const { formatDate, formatDateBS, formatCurrency: formatMoney, dateSystem, formatCurrencyForPrint } = useDate();
  const { company, companyId } = useCompany(); 
  const router = useRouter();
  const [reminderOpen, setReminderOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useLocationSearchParams();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const openingModalRef = useRef(false);
  const { processedItems, vouchers, processedAccounts, processedParties, journalAccountNames, userNames: userNamesFromHook } = useVouchers();
  const effectiveUserNames = userNames ?? userNamesFromHook ?? {};
  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const { balanceMode } = useBalanceMode();
  const { can } = usePermissions();

  const [internalDateRange, setInternalDateRange] = useState<DateRange | undefined>(undefined);
  const dateRangeControlled = onDateRangeChange != null;
  const dateRange = dateRangeControlled ? dateRangeProp : internalDateRange;
  const setDateRange = dateRangeControlled ? onDateRangeChange! : setInternalDateRange;
  useFyLoadOnDateRangeChange(dateRange);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceMode === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && initialItem?.id
        ? ledgerDetailSessionStorageKey(companyId, "item", initialItem.id, ledgerViewMode)
        : null,
    [companyId, initialItem?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<"sale" | "purchase" | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [isDateSearchMode, setIsDateSearchMode] = useState(false);
  const [isDateChange, setIsDateChange] = useState(false);
  // Item page: persist Party column visibility for Columns dropdown show/hide.
  const [showPartyColumn, setShowPartyColumn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem("itemPartyColumnVisible") !== "false";
  });
  const [selectedPartyIds, setSelectedPartyIds] = useState<string[]>(['all']);

  const { fromMs: dateRangeFromMs, toMs: dateRangeToMs } = useDateRangeTimestamps(dateRange);
  useEffect(() => {
    setTempDateRange((prev) => {
      if (prev?.from?.getTime() === dateRangeFromMs && prev?.to?.getTime() === dateRangeToMs) return prev;
      return dateRange;
    });
  }, [dateRangeFromMs, dateRangeToMs, dateRange]);
  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "10");

  const {
    unapprovedOnly,
    toggleUnapprovedOnly,
    filterByUnapprovedOnly,
    onDateRangeChangeWithUnapprovedReset,
  } = useLedgerUnapprovedOnlyFilter({
    onDateRangeChange: setDateRange,
    setCurrentPage,
    setFilters,
    setActiveFilter,
  });

  const handleBsDateRangeChange = useCallback((range?: DateRange) => {
    onDateRangeChangeWithUnapprovedReset(range);
  }, [onDateRangeChangeWithUnapprovedReset]);

  // FIX: Robust item merging to ensure unitConversions are never lost
  // Use ref to track previous item to prevent unnecessary recalculations
  const previousItemRef = useRef<Item | undefined>(undefined);
  const currentItem = useMemo(() => {
    if (!initialItem) return undefined;
    const found = processedItems.find(p => p.id === initialItem.id);
    
    if (found) {
        const merged = {
            ...initialItem, 
            ...found,       
            unitConversions: found.unitConversions?.length ? found.unitConversions : (initialItem.unitConversions || []),
            // Explicitly preserve opening stock fields (use found if present, else initialItem)
            openingBalance: (found as any).openingBalance !== undefined ? (found as any).openingBalance : initialItem.openingBalance,
            openingBalanceUnit: (found as any).openingBalanceUnit !== undefined ? (found as any).openingBalanceUnit : (initialItem as any).openingBalanceUnit,
            openingBalanceRate: (found as any).openingBalanceRate !== undefined ? (found as any).openingBalanceRate : (initialItem as any).openingBalanceRate,
            openingBalanceDate: (found as any).openingBalanceDate !== undefined ? (found as any).openingBalanceDate : (initialItem as any).openingBalanceDate
        };
        
        // Only update if the item actually changed (compare relevant fields)
        const prev = previousItemRef.current;
        if (prev && prev.id === merged.id) {
            // Check if relevant fields changed
            const relevantFieldsChanged = 
                prev.name !== merged.name ||
                prev.type !== merged.type ||
                prev.groupId !== merged.groupId ||
                prev.openingBalance !== merged.openingBalance ||
                ((prev as any).openingBalanceRate || 0) !== ((merged as any).openingBalanceRate || 0) ||
                JSON.stringify(prev.unitConversions) !== JSON.stringify(merged.unitConversions);
            
            if (!relevantFieldsChanged) {
                // Return previous item to prevent unnecessary re-renders
                return prev;
            }
        }
        
        previousItemRef.current = merged;
        return merged;
    }
    
    // Only update if initialItem actually changed
    if (previousItemRef.current?.id === initialItem.id) {
        const relevantFieldsChanged = 
            previousItemRef.current.name !== initialItem.name ||
            previousItemRef.current.type !== initialItem.type ||
            previousItemRef.current.groupId !== initialItem.groupId ||
            previousItemRef.current.openingBalance !== initialItem.openingBalance;
        
        if (!relevantFieldsChanged) {
            return previousItemRef.current;
        }
    }
    
    previousItemRef.current = initialItem;
    return initialItem;
  }, [processedItems, initialItem]);

  const handleItemUpdated = useMasterEntityLivePatch<Item>({
    collection: "items",
    entityId: initialItem.id,
    onUpdated: onItemUpdated,
  });

  const mobileSearchNames = useMemo(
    () => ({
      ...journalAccountNames,
      ...effectiveUserNames,
      ...Object.fromEntries((processedAccounts || []).map((a: any) => [a.id, a.accountName])),
      ...Object.fromEntries((processedParties || []).map((p: any) => [p.id, p.name])),
    }),
    [journalAccountNames, effectiveUserNames, processedAccounts, processedParties]
  );

  const {
    processedTransactions: allProcessedTransactions,
    openingBalanceForPeriod,
    periodDr: allPeriodDr,
    periodCr: allPeriodCr,
    closingBalance: allClosingBalance, 
  } = useTransactions(
    currentItem,
    'item',
    dateRange,
    stockView,
    processedItems,
    transactions,
    undefined,
    filters,
    undefined,
    undefined,
    effectiveUserNames
  );

  // Filter parties to show only those with transactions involving the current item
  const partiesWithTransactions = useMemo(() => {
    if (!currentItem || !processedParties || !allProcessedTransactions) return [];
    
    // Get unique party IDs that have transactions with this item
    const partyIdsWithTransactions = new Set<string>();
    
    allProcessedTransactions.forEach((t: any) => {
      if ((t.type === 'sale' || t.type === 'purchase') && t.partyId) {
        // Check if this transaction involves the current item
        const hasItem = t.lineItems?.some((li: any) => li.itemId === currentItem.id) ||
                       t.items?.some((li: any) => li.itemId === currentItem.id);
        if (hasItem) {
          partyIdsWithTransactions.add(t.partyId);
        }
      }
    });
    
    // Return only parties that have transactions with this item
    return processedParties.filter(party => partyIdsWithTransactions.has(party.id));
  }, [currentItem, processedParties, allProcessedTransactions]);

  // Filter transactions: show Sale, Purchase, and Notes linked to this item
  const filteredTransactions = useMemo(() => {
    // Include Sale, Purchase, and Note (notes have no partyId; show all notes for this item)
    let transactions = allProcessedTransactions.filter(t =>
      t.type === 'sale' || t.type === 'purchase' || t.type === 'note'
    );

    // Filter by selected parties when not "all" (notes have no partyId so they stay when party filter is applied)
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
    if (!currentItem) return [];
    const dates = new Set<number>();
    vouchers.forEach((v) => {
        if (v.lineItems?.some((li: any) => li.itemId === currentItem.id)) {
            const dateValue = v.date?.toDate ? v.date.toDate() : new Date(v.date);
            if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
                dates.add(startOfDay(dateValue).getTime());
            }
        }
    });
    return Array.from(dates).map((d) => new Date(d));
  }, [vouchers, currentItem]);

  const unitOptions = useMemo(() => {
      if (!currentItem) return [];
      const units = new Set<string>();
      if ((currentItem as any).openingBalanceUnit) units.add((currentItem as any).openingBalanceUnit);
      if (currentItem.unitConversions) {
          currentItem.unitConversions.forEach((c: any) => {
              if (c.fromUnit) units.add(c.fromUnit);
              if (c.toUnit) units.add(c.toUnit);
          });
      }
      return Array.from(units);
  }, [currentItem]);

  const conversions = (currentItem?.unitConversions || []) as any[];
  const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((currentItem as any).openingBalanceUnit || '');
  const displayUnit = itemDisplayUnits && currentItem ? itemDisplayUnits[currentItem.id] || smallestUnit : smallestUnit;
  // Unit Select: value list me honi chahiye — warna Radix setRef loop (ScrollArea ke saath dikhta hai).
  const displayUnitSelectValue = useMemo(() => {
    if (!displayUnit) return unitOptions[0] ?? "";
    if (unitOptions.includes(displayUnit)) return displayUnit;
    return unitOptions[0] ?? displayUnit;
  }, [displayUnit, unitOptions]);

  const isFilterActive = dateRange !== undefined || Object.values(filters).some((v) => v) || (!selectedPartyIds.includes('all') && selectedPartyIds.length > 0);

  const clearFilters = () => {
    setDateRange(undefined);
    setFilters({});
    setSelectedPartyIds(['all']);
  };

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

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
    patchMasterDetailUrlAfterModalClose(params, { entityId: currentItem?.id ?? "" });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, currentItem?.id]);

  const modalParam = searchParams.get("modal");
  const urlModalOpen = isMobile && modalParam === "1" && anyMobilePopupOpen;
  const closeUrlModal = useCallback(() => {
    setMobileFooterDialogOpen(null);
    setIsCalendarOpen(false);
    setIsVoucherDialogOpen(false);
    setSelectedVoucher(null);
    setIsNoteOpen(false);
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
      closeModalInUrl();
      return;
    }
    onBack?.();
  }, [mobileFooterDialogOpen, isCalendarOpen, isVoucherDialogOpen, isNoteOpen, onBack, closeModalInUrl]);

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
    entityId: currentItem?.id,
    entityKind: "item",
    entityTxnCount: sortedTransactions.length,
    enabled: Boolean(currentItem?.id),
  });

  const filteredMobileTransactions = useMemo(() => {
    if (!mobileSearchTerm) return sortedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();

    return sortedTransactions.filter((t: any) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      const entryClock = formatVoucherEntryTimeLocal(t as Record<string, unknown>).toLowerCase();
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, currentItem ? "item" : undefined, currentItem?.id).includes(lowerCaseSearch) ||
        formatDate(d).toLowerCase().includes(lowerCaseSearch) ||
        formatDateBS(d).toLowerCase().includes(lowerCaseSearch) ||
        entryClock.includes(lowerCaseSearch) ||
        String(t.total || t.amount || 0).toLowerCase().includes(lowerCaseSearch) ||
        String(t.debit).toLowerCase().includes(lowerCaseSearch) ||
        String(t.credit).toLowerCase().includes(lowerCaseSearch) ||
        String(debitCreditAmount).toLowerCase().includes(lowerCaseSearch) ||
        String(t.balance).toLowerCase().includes(lowerCaseSearch)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, formatDate, formatDateBS, mobileSearchNames, currentItem?.id]);

  /** Party jaisa: master book OB + period carry running balance */
  const masterItemBooksOpening = useMemo(
    () => getItemMasterBooksOpening(currentItem, stockView),
    [currentItem, stockView]
  );
  const ledgerOpeningForRunning = useMemo(() => {
    if (Math.abs(openingBalanceForPeriod) < 1e-6 && Math.abs(masterItemBooksOpening) > 1e-6) {
      return masterItemBooksOpening;
    }
    return openingBalanceForPeriod;
  }, [openingBalanceForPeriod, masterItemBooksOpening]);

  const ledgerPagingTransactions = useMemo(
    () => (isMobile ? filteredMobileTransactions : sortedTransactions),
    [isMobile, filteredMobileTransactions, sortedTransactions]
  );

  // Statement check mode + desktop tail paging (PartyDetails jaisa)
  const {
    statementCheck,
    desktopPaginationMeta: desktopPageLedgerStats,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId: companyId ?? undefined,
    context: "item",
    contextId: currentItem?.id,
    viewMode: balanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions: ledgerPagingTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "item",
    contextId: currentItem?.id,
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

  /** Book OB row: slice list ke shuru par; Dated OB = slice se pehle txn ki date (party jaisa). */
  const ledgerOpeningPeriodStartDate = useMemo(() => {
    const list = ledgerPagingTransactions as any[];
    const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);
    const start = desktopPageLedgerStats.sliceStart;
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
  }, [ledgerPagingTransactions, rowsPerPage, desktopPageLedgerStats.sliceStart, dateRange?.from, dateRange?.to]);

  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);

  const mobilePagerEdgeCounts = useMemo(() => {
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    return {
      before: desktopPageLedgerStats.beforeCount ?? 0,
      after: desktopPageLedgerStats.afterCount ?? 0,
    };
  }, [rowsPerPage, desktopPageLedgerStats.beforeCount, desktopPageLedgerStats.afterCount]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [ledgerPagingTransactions.length, totalPages, dateRangeFromMs, dateRangeToMs, rowsPerPage]);

  const handlePrint = () => {
    if (!company || !currentItem) return;
    const printVisibleColumns = { ...visibleColumns, status: false };
    const printItemPayload = {
      ...currentItem,
      unitConversions: currentItem.unitConversions || [],
    };

    openPrintDirect(
      applyLedgerPageToPrintPayload(
        {
          company: {
            name: company.name,
            pan: company.pan,
            phone: company.phone,
            address: company.address,
            logoUrl: company.logoUrl,
          },
          dateSystem,
          title: `Item Ledger: ${currentItem?.name}`,
          context: "item",
          contextId: currentItem.id,
          dateRangeText: dateRange?.from
            ? `${formatDate(dateRange.from)} - ${dateRange.to ? formatDate(dateRange.to) : ""}`
            : "All Time",
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPageLedgerStats.openingForPage,
          openingBalanceDate: (currentItem as any).openingBalanceDate,
          openingBalanceNarration: currentItem.openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          stockView: stockView,
          displayUnit: displayUnit,
          itemsData: [printItemPayload],
        },
        {
          paginatedTransactions,
          openingForPage: desktopPageLedgerStats.openingForPage,
          periodDrForPage: desktopPageLedgerStats.periodDrForPage,
          periodCrForPage: desktopPageLedgerStats.periodCrForPage,
          closingForPage: desktopPageLedgerStats.closingForPage,
          booksOpeningBalance: masterItemBooksOpening,
          ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPageLedgerStats.sliceStart === 0,
          ledgerDateFilterActive: hasLedgerDateFilter,
          openingBalancePeriodStartDate: ledgerOpeningPeriodStartDate,
          masterOpeningBalanceDate: (currentItem as any).openingBalanceDate,
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
  
  const balanceText = useMemo(() => {
    if (closingBalance === 0) return "No Stock";
    return stockView === 'amount' ? (closingBalance >= 0 ? "Asset" : "Liability") : "Available";
  }, [closingBalance, stockView]);

  const buildDateRangeText = () => {
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
    return dateRangeText;
  };

  const dateRangeLabel = useMemo(
    () => ledgerMasterDateRangeLabel(dateRange, buildDateRangeText()),
    [dateRange, dateSystem, formatDateBS, formatDate]
  );

  useEffect(() => {
    if (isMobile && dateRange?.from) {
      const from = formatDate(dateRange.from);
      const to = dateRange.to ? formatDate(dateRange.to) : from;
      setMobileSearchTerm(from === to ? from : `${from} to ${to}`);
      setIsDateSearchMode(true);
    }
  }, [dateRange, formatDate, isMobile]);
  
  const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
    const range = dateRange;
    if (!range?.from || (range.from && range.to)) {
      setDateRange({ from: adDate, to: undefined });
    } else if (adDate < range.from) {
      setDateRange({ from: adDate, to: range.from });
      setIsCalendarOpen(false);
    } else {
      setDateRange({ from: range.from, to: adDate });
      setIsCalendarOpen(false);
    }
  };
  
  const headerStockValue = useMemo(() => {
    if (!currentItem) return 0;
    const factor = getConversionFactor(currentItem, displayUnit);
    return (closingBalance || 0) / factor;
  }, [closingBalance, currentItem, displayUnit]);

  if(!currentItem) return null;
  
  const handleUnitChange = (unit: string) => {
    if (setItemDisplayUnit && currentItem.id) {
        setItemDisplayUnit(currentItem.id, unit);
    }
  };

  const itemTransactionsTableProps = {
    transactions: paginatedTransactions,
    context: "item" as const,
    contextId: currentItem.id,
    showItemPartyColumn: showPartyColumn,
    stockView,
    item: currentItem,
    displayUnit,
    setDisplayUnit: setItemDisplayUnit ? handleUnitChange : undefined,
    openingBalance: desktopPageLedgerStats.openingForPage,
    booksOpeningBalance: masterItemBooksOpening,
    openingBalanceNarration: currentItem.openingBalanceNarration,
    openingBalanceAttachmentUrls: currentItem.fileUrls,
    openingBalanceDate: (currentItem as any).openingBalanceDate,
    ledgerDateFilterActive: hasLedgerDateFilter,
    ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPageLedgerStats.sliceStart === 0,
    openingBalancePeriodStartDate: ledgerOpeningPeriodStartDate,
    dateRange,
    periodDr: desktopPageLedgerStats.periodDrForPage,
    periodCr: desktopPageLedgerStats.periodCrForPage,
    closingBalance: desktopPageLedgerStats.closingForPage,
    filters,
    setFilters,
    activeFilter,
    setActiveFilter,
    showNarration,
    visibleColumns: { ...visibleColumns, status: false },
    userNames: effectiveUserNames,
    journalAccountNames,
    accountNames: {},
    onRowClick: handleEditVoucher,
    isDateChange,
    highlightPendingApproval: true,
    ...statementCheck.tableProps,
  };

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={processedItems?.map(p => ({ value: p.id, label: p.name })) ?? []}
          value={currentItem?.id || ""}
          onChange={(value) => {
            if (value && value !== currentItem.id) {
              router.push(`/items/${value}`);
            }
          }}
          placeholder="Select an item"
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

  const renderMobileView = () => (
    <>
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
      {/* Mobile: scroll area extends to footer; inner pb-24 so last row clears fixed footer */}
      <div className="flex flex-col flex-shrink-0 border-b bg-background">
        <MobileDetailSummaryCollapsible>
        {!hideMobilePeriodLabelRow ? (
          <div className="flex flex-shrink-0 items-center justify-center gap-1 border-b px-2 py-0.5 bg-background">
            <span className="text-[11px] font-medium leading-tight text-muted-foreground">{dateRangeLabel}</span>
            {dateRange != null && (dateRange.from != null || dateRange.to != null) && (
              <button
                type="button"
                onClick={() => setDateRange(undefined)}
                className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                aria-label="Clear date filter"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : null}
        {/* Balance — party jaisa center line (unit dropdown same row, h-8) */}
        <div className={mdc.mobileTxnBalanceRowInline} {...mdcMobileTxnBalanceRowData}>
          <p className={cn(mdc.mobileTxnBalanceTextLg, headerStockValue >= 0 ? "text-green-600" : "text-red-600")}>
            {balanceText}{" "}
            {stockView === "qty" ? formatQtyValue(headerStockValue) : formatMoney(Math.abs(headerStockValue), { noSuffix: true })}
          </p>
          {stockView === "qty" && unitOptions.length > 0 && setItemDisplayUnit ? (
            <Select value={displayUnitSelectValue} onValueChange={handleUnitChange}>
              <SelectTrigger className="h-8 w-fit gap-1 border border-transparent bg-muted/50 px-2 text-xs focus:ring-1 focus:ring-inset focus:ring-ring focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unitOptions.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        </MobileDetailSummaryCollapsible>
      </div>

      {/* Transaction list - extends to footer line */}
      {/* scroll-touch + inline style for APK/WebView touch scroll */}
      <div
        className="flex-1 min-h-0 overflow-auto scroll-touch"
      >
        <div className="pb-2">
          <TransactionsTable adaptiveClosingLabel {...itemTransactionsTableProps} scrollOnlyTransactions />
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
    {/* Fixed bottom: New Sale, New Purchase, Calendar - same as Party footer style */}
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
                    <MobileDialogDescription>
                        Select a starting and ending date for the transaction list.
                    </MobileDialogDescription>
                </DrawerHeader>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                    {(dateSystem === 'BS' || dateSystem === 'Both') && (
                       <NepaliCalendar
                          rangePresetSlot={
                            <MasterLedgerDateRangePresetRow
                              ledgerPaginationReset={ledgerPaginationReset}
                              country={company?.country}
                              onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                              onApply={(r) => {
                                onDateRangeChangeWithUnapprovedReset(r);
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
                    {(dateSystem === 'AD' || dateSystem === 'Both') && (
                      <div className="flex-1 w-full min-w-0">
                        <AdCalendar
                          rangePresetSlot={
                            <MasterLedgerDateRangePresetRow
                              ledgerPaginationReset={ledgerPaginationReset}
                              country={company?.country}
                              onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                              onApply={(r) => {
                                onDateRangeChangeWithUnapprovedReset(r);
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
                              setDateRange({ from: adDate, to: undefined });
                            } else if (adDate < range.from) {
                              setDateRange({ from: adDate, to: range.from });
                              setIsCalendarOpen(false);
                            } else {
                              setDateRange({ from: range.from, to: adDate });
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
    </>
  );

  const renderDesktopView = () => (
     <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
      {/* Header: identity + pills — Party-style single row */}
      <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
        <div className={LEDGER_HEADER_OUTER_ROW_CN}>
          <div className={LEDGER_HEADER_IDENTITY_CN}>
            <div className={LEDGER_HEADER_AVATAR_CN}>
              {/* Item photo = fileUrls[0] (live via currentItem), same square chrome as Party */}
              <EntityFileAttachmentHover
                fileUrl={trimEntityFileUrlForPreview(currentItem.fileUrls?.[0])}
                triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
              >
                <ResolvedEntityAvatar
                  className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                  companyId={(currentItem as { companyId?: string }).companyId}
                  src={trimEntityFileUrlForPreview(currentItem.fileUrls?.[0]) ?? undefined}
                  alt={currentItem.name}
                  fallbackClassName="border border-blue-300 bg-blue-100/80"
                  fallbackSlot={<Package className="h-6 w-6 text-muted-foreground" />}
                />
              </EntityFileAttachmentHover>
              {currentItem.id !== 'all' && (
                <EditItemDialog
                  item={currentItem}
                  onItemUpdated={handleItemUpdated}
                  onItemDeleted={() => onItemDeleted(currentItem.id)}
                  hasTransactions={processedTransactions.length > 0}
                >
                  <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                    <Pencil className="h-3 w-3" />
                  </button>
                </EditItemDialog>
              )}
            </div>
            <div className={LEDGER_HEADER_NAME_CARD_CN}>
              <h1 className={LEDGER_HEADER_TITLE_CN} title={currentItem.name}>{currentItem.name}</h1>
            </div>
            {reportSummaryCards?.length ? (
              <ReportHeaderSummaryCards cards={reportSummaryCards} />
            ) : (
            <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
              <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                <span className={cn(LEDGER_HEADER_BALANCE_CN, headerStockValue >= 0 ? "text-green-600" : "text-red-600")}>
                  {stockView === 'qty' ? formatQtyValue(headerStockValue) : formatMoney(Math.abs(headerStockValue), { noSuffix: true, noAnimation: true })}
                </span>
              </div>
            </div>
            )}
            {stockView === 'qty' && unitOptions.length > 0 && setItemDisplayUnit && (
              <Select value={displayUnitSelectValue} onValueChange={handleUnitChange}>
                <SelectTrigger className="h-8 px-2 w-fit gap-1 text-xs bg-muted/50 border border-transparent flex-shrink-0 focus:ring-1 focus:ring-inset focus:ring-ring focus:ring-offset-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className={LEDGER_HEADER_PILL_ROW_CN}>
            <LedgerHeaderPrintButton variant="outline" onClick={handlePrint} />
            <LedgerHeaderReminderButton
              variant="outline"
              disabled={!currentItem?.id || currentItem.id === "all"}
              onClick={() => setReminderOpen(true)}
            />
            <LedgerReminderDialog
              open={reminderOpen}
              onOpenChange={setReminderOpen}
              context="Items"
              entityId={currentItem?.id}
              title={currentItem?.name}
            />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
            {(dateSystem === 'BS' || dateSystem === 'Both') && (
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
            {(dateSystem === 'AD' || dateSystem === 'Both') && (
              <Popover open={isDesktopCalendarOpen} onOpenChange={setIsDesktopCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn("justify-start text-left font-normal px-2 w-auto", LEDGER_HEADER_PILL_CN, !dateRange && "text-muted-foreground")}
                  >
                    <CalendarIcon className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
                    {dateRange?.from ? (
                      dateRange.to ? <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</> : format(dateRange.from, "LLL dd, y")
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
                          onDateRangeChangeWithUnapprovedReset(r);
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
                        setDateRange(next);
                        setIsDesktopCalendarOpen(false);
                      } else {
                        const next = { from: range.from, to: adDate };
                        setTempDateRange(next);
                        setDateRange(next);
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => { openingModalRef.current = true; openModalInUrl(); setIsNoteOpen(true); }}
              className={LEDGER_HEADER_PILL_CN}
            >
              <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
            </Button>
            {onShowAll && (
              <Button
                variant="outline"
                size="sm"
                onClick={onShowAll}
                className={LEDGER_HEADER_PILL_CN}
              >
                All Vouchers
              </Button>
            )}
            
          </div>
        </div>
      </div>
          }
          table={<TransactionsTable adaptiveClosingLabel {...itemTransactionsTableProps} />}
        footer={
         <LedgerDesktopFooter
           left={
             <>
              <LedgerFooterCheckboxPill
                id="show-narration-item"
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
                            id="col-party-item"
                            checked={showPartyColumn}
                            onCheckedChange={(c) => handlePartyColumnToggle(Boolean(c))}
                          />
                          <label htmlFor="col-party-item" className="text-sm font-medium flex-1 cursor-pointer">
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
                           id={`col-${key}-item`}
                          checked={isStatusInStatement ? false : (isStatusInBillWise ? true : visibleColumns[key] !== false)}
                           disabled={isStatusLocked}
                           onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                         />
                         <label htmlFor={`col-${key}-item`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                           {COLUMN_LABELS[key]}
                         </label>
                       </DropdownMenuItem>
                     );
                   })}
                 </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-item"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
               <StatementCheckModeFooterControls
                 idPrefix="item"
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
  );

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isMobile ? renderMobileView() : renderDesktopView()}
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
            <DialogTitle>Add a New Note for {initialItem?.name}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this item.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onItemUpdated();
                setIsNoteOpen(false);
              }}
              initialContext={"Items"}
              initialEntityId={initialItem?.id || ''}
              showSaveAndApproveOnCreate={can("approve_transactions")}
              showApproveButton={can("approve_transactions")}
              compactFooter
            />
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
        onVoucherAction={() => setSelectedVoucher(null)}
      />
    </>
  );
}
