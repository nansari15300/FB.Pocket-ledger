"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, usePathname } from "next/navigation";
import { useLocationSearchParams } from "@/hooks/useLocationSearchParams";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Calendar as CalendarIcon, File as FileIcon, Printer, Share2, BarChart2, Package, Layers, X } from "lucide-react";
import type { Item, ItemGroup } from "@/components/items/types";
import { ItemList } from "@/components/items/ItemList";
import { ItemGroupList } from "@/components/items/ItemGroupList";
import ItemDetails from "@/components/items/ItemDetails";
import { ItemGroupDetails } from "@/components/items/ItemGroupDetails";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import { mlc } from "@/lib/mobileListChrome";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { ReportStatementHeaderAvatar } from "@/components/reports/ReportStatementHeaderAvatar";
import { ReportEntityMobileHeader } from "@/components/reports/ReportEntityMobileHeader";
import { useStatementReportMobilePaging } from "@/hooks/useStatementReportMobilePaging";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { computeFilteredCardOpeningAndRows } from "@/lib/reportFilteredCardBalance";
import { buildReportVoucherTypeCards, filterReportCardsToExistingVouchers, getReportVoucherTypeKey, reportMobileSummaryCardTitle, reportVoucherMatchesSummaryCard, ReportNetBalanceInfoButton } from "@/components/reports/ReportStatementSummaryCards";

import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { mdc } from "@/lib/mobileDetailChrome";
import { Search } from "lucide-react";
import { buildItemGroupReportEntity } from "@/lib/reportStatementGroupEntity";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import { useTransactions } from "@/hooks/use-transactions";
import { useCompany } from "@/hooks/useCompany";
import { openPrintDirect, getPdfBlob, type Context } from "@/lib/printDirect";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { calendarPanelClassName } from "@/lib/calendarChrome";
import type { BSDate } from "@/lib/bs-date";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import * as XLSX from "xlsx";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { getConversionFactor, formatQuantity } from "@/components/vouchers/transactionTableShared";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { collectItemIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesItemLedger";
import { resolveItemListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { CreateItemGroupDialog } from "@/components/items/CreateItemGroupDialog";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { ReportListSearchExtras, ReportListTotalBalance, useReportListPendingApproval, useReportShowApproveOnList } from "@/components/reports/ReportListParityChrome";
import { useReportMobileListMode } from "@/hooks/useReportMobileListMode";

const ReportSummaryCard = React.memo(function ReportSummaryCard({
  title,
  amount,
  color,
  customFormatted,
  selected,
}: {
  title: string;
  amount: number;
  color: string;
  customFormatted?: string;
  selected?: boolean;
}) {
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const showDrCr = title.toLowerCase().includes("balance");
  const formatted = customFormatted ?? formatCurrency(amount, { showDrCr });
  const titleStr = customFormatted ?? formatCurrencyForPrint(amount, { showDrCr });
  return (
    <div
      data-pl-bank-report-balance-card-surface=""
      data-pl-report-balance-card-surface=""
      data-pl-report-balance-card-selected={selected ? "true" : undefined}
      className={cn(
        "px-2 py-1.5 h-12 min-h-12 flex items-center justify-center w-fit flex-shrink-0 border rounded-lg overflow-hidden",
        "pl-dashboard-tone-card",
        selected ? "pl-dashboard-ribbon-sky border-blue-500" : "pl-dashboard-ribbon-emerald border-emerald-500"
      )}
    >
      <div className={cn("flex flex-col", title === "Net Balance" && "pr-4")}>
        <p className="text-xs text-muted-foreground whitespace-nowrap">{title}</p>
        <p className={cn("text-sm sm:text-base font-bold whitespace-nowrap tabular-nums", color)} title={titleStr}>
          {formatted}
        </p>
      </div>
    </div>
  );
}, (prev, next) => prev.title === next.title && prev.amount === next.amount && prev.color === next.color && prev.customFormatted === next.customFormatted && prev.selected === next.selected);

export default function DesktopItemStatementPage() {
  const { processedItems, processedItemGroups, vouchers, loading, journalAccountNames } = useFyScopedVouchers();
  const { company } = useCompany();
  const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
  const router = useRouter();
  const searchParams = useLocationSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const reportMobileList = useReportMobileListMode(isMobile, ["itemId","groupId"]);
  const calendarMonths = useCalendarMonths();
  const openingModalRef = useRef(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [unapprovedOnly, setUnapprovedOnly] = useState(false);
  const [balanceCardFilter, setBalanceCardFilter] = useState<string | null>(null);
  const balanceCardsRowRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"list" | "chart">("list");
  const [listTab, setListTab] = useState<"items" | "groups">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("groupId")
      ? "groups"
      : "items"
  );
  const [listSearchTerm, setListSearchTerm] = useState("");
  const [itemListQuickFilter, setItemListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ItemGroup | null>(null);
  const [reportStockView, setReportStockView] = useState<"amount" | "qty">("amount");
  const [reportDisplayUnit, setReportDisplayUnit] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUidsRef = useRef<Set<string>>(new Set());

  const pageTitle = selectedGroup ? "Item Group Statement" : "Item Statement";

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    try {
      const userDoc = await getDoc(doc(firestore, "users", userId));
      if (userDoc.exists()) {
        return userDoc.data().displayName || userDoc.data().email || "Unknown";
      }
    } catch (_) {}
    return "Unknown";
  }, []);

  useEffect(() => {
    if (!vouchers) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
    uids.forEach(async (uid) => {
      if (fetchedUidsRef.current.has(uid)) return;
      fetchedUidsRef.current.add(uid);
      const name = await fetchUserName(uid);
      setUserNames((prev) => (prev[uid] === name ? prev : { ...prev, [uid]: name }));
    });
  }, [vouchers, fetchUserName]);

  useEffect(() => {
    const itemId = searchParams.get("itemId");
    const groupId = searchParams.get("groupId");

    if (itemId && processedItems.length > 0) {
      const item = processedItems.find((p) => p.id === itemId);
      setSelectedItem((prev) => (prev?.id === item?.id ? prev : item || null));
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    } else if (groupId && processedItemGroups.length > 0) {
      const group = processedItemGroups.find((g) => g.id === groupId);
      setSelectedGroup((prev) => (prev?.id === group?.id ? prev : group || null));
      setSelectedItem((prev) => (prev !== null ? null : prev));
    } else if (processedItems.length > 0) {
      const first = processedItems[0];
      setSelectedItem((prev) => {
        if (!first) return null;
        if (prev?.id === first.id) return prev;
        if (prev && processedItems.some((p) => p.id === prev.id)) return prev;
        return first;
      });
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    }
  }, [searchParams, processedItems, processedItemGroups]);

  useEffect(() => {
    if (searchParams.get("groupId")) setListTab("groups");
    else if (searchParams.get("itemId")) setListTab("items");
  }, [searchParams]);

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
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router]);

  const modalParam = searchParams.get("modal");
  const anyReportPopupOpen = isVoucherDialogOpen || isCalendarOpen;
  useMobileLedgerModalUrlGuard({
    isMobile,
    modalParam,
    anyPopupOpen: anyReportPopupOpen,
    openingModalRef,
    pathname,
    searchParams,
    router,
  });

  const handleReportBack = useCallback(() => {
    if (isVoucherDialogOpen) {
      setIsVoucherDialogOpen(false);
      setSelectedVoucher(null);
      closeModalInUrl();
      return;
    }
    if (isCalendarOpen) {
      setIsCalendarOpen(false);
      closeModalInUrl();
      return;
    }
    if (reportMobileList.backToList()) return;
    router.back();
  }, [isVoucherDialogOpen, isCalendarOpen, closeModalInUrl, router, reportMobileList]);

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

  const itemReportOptions = useMemo(
    () => processedItems.map((p) => ({ value: p.id, label: p.name })),
    [processedItems]
  );

  const groupReportOptions = useMemo(
    () => processedItemGroups.map((g) => ({ value: g.id, label: g.name })),
    [processedItemGroups]
  );

  const unitOptions = useMemo(() => {
    if (!selectedItem) return [];
    const units = new Set<string>();
    if ((selectedItem as any).openingBalanceUnit) units.add((selectedItem as any).openingBalanceUnit);
    if (selectedItem.unitConversions) {
      (selectedItem.unitConversions as any[]).forEach((c: any) => {
        if (c.fromUnit) units.add(c.fromUnit);
        if (c.toUnit) units.add(c.toUnit);
      });
    }
    return Array.from(units);
  }, [selectedItem]);

  const conversions = (selectedItem?.unitConversions || []) as any[];
  const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((selectedItem as any)?.openingBalanceUnit || "");
  const effectiveDisplayUnit = reportDisplayUnit || smallestUnit;

  useEffect(() => {
    if (!selectedItem) {
      setReportStockView("amount");
      setReportDisplayUnit("");
    } else if (unitOptions.length > 0) {
      setReportDisplayUnit(smallestUnit);
    } else {
      setReportDisplayUnit("");
    }
  }, [selectedItem, unitOptions.length, smallestUnit]);

  const groupReportEntity = useMemo(() => {
    if (!selectedGroup) return null;
    return buildItemGroupReportEntity(selectedGroup, processedItems, processedItemGroups);
  }, [selectedGroup, processedItems, processedItemGroups]);

  const activeEntity = selectedItem || groupReportEntity;
  useEffect(() => {
    if (balanceCardsRowRef.current) balanceCardsRowRef.current.scrollLeft = 0;
  }, [activeEntity?.id]);
  const activeContext = selectedItem ? "item" : "group";

  const reportStockViewForTx = selectedItem ? reportStockView : "amount";
  const reportDisplayUnitForTx = selectedItem && reportStockViewForTx === "qty" ? effectiveDisplayUnit : undefined;

  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    activeEntity as any,
    activeContext,
    dateRange,
    reportStockViewForTx,
    processedItems,
    vouchers,
    undefined,
    {},
    undefined,
    undefined,
    userNames,
    reportDisplayUnitForTx
  );
  const { closingBalance: allTimeNetBalance, processedTransactions: allTimeTransactions } = useTransactions(
    activeEntity as any,
    activeContext,
    undefined,
    reportStockViewForTx,
    processedItems,
    vouchers,
    undefined,
    {},
    undefined,
    undefined,
    userNames,
    reportDisplayUnitForTx
  );

  const hasDateFilter = !!dateRange?.from || !!dateRange?.to;
  // Mobile: full tx list for tail pager; desktop all-time = last 10 rows.
  const reportDisplayTransactions = useMemo(() => {
    if (hasDateFilter || isMobile) return processedTransactions;
    if (processedTransactions.length <= 10) return processedTransactions;
    return processedTransactions.slice(-10);
  }, [processedTransactions, hasDateFilter, isMobile]);
  const mobileUnapprovedTxnCount = useMemo(
    () => countLedgerUnapprovedTransactions(reportDisplayTransactions),
    [reportDisplayTransactions]
  );

  const cardFilteredResult = useMemo(() => {
    if (!balanceCardFilter) return null;
    return computeFilteredCardOpeningAndRows({
      allTimeTransactions,
      periodTransactions: reportDisplayTransactions,
      fromDate: hasDateFilter ? dateRange?.from : undefined,
      filterKey: balanceCardFilter,
      matchesFilter: (t: any) =>
        balanceCardFilter.startsWith("summary:")
          ? reportVoucherMatchesSummaryCard(
              t,
              balanceCardFilter.slice(8),
              activeContext,
              activeEntity?.id,
              activeContext === "group" ? "item" : undefined
            )
          : getReportVoucherTypeKey(
              t,
              activeContext,
              activeEntity?.id,
              activeContext === "group" ? "item" : undefined
            ) === balanceCardFilter,
    });
  }, [
    balanceCardFilter,
    allTimeTransactions,
    reportDisplayTransactions,
    hasDateFilter,
    dateRange?.from,
    activeContext,
    activeEntity?.id,
  ]);

  const effectiveOpeningBalanceForPeriod = cardFilteredResult
    ? cardFilteredResult.filteredOpening
    : openingBalanceForPeriod;
  const effectivePeriodDr = cardFilteredResult
    ? cardFilteredResult.filteredPeriodDr
    : periodDr;
  const effectivePeriodCr = cardFilteredResult
    ? cardFilteredResult.filteredPeriodCr
    : periodCr;
  const effectiveClosingBalance = cardFilteredResult
    ? cardFilteredResult.filteredClosing
    : closingBalance;

  const filteredReportTransactions = useMemo(() => {
    let list = cardFilteredResult
      ? cardFilteredResult.recomputedRows
      : reportDisplayTransactions;
    if (!cardFilteredResult && balanceCardFilter) {
      list = list.filter((t: any) => balanceCardFilter.startsWith("summary:")
        ? reportVoucherMatchesSummaryCard(t, balanceCardFilter.slice(8), activeContext, activeEntity?.id, activeContext === "group" ? "item" : undefined)
        : getReportVoucherTypeKey(t, activeContext, activeEntity?.id, activeContext === "group" ? "item" : undefined) === balanceCardFilter);
    }
    if (unapprovedOnly) {
      list = list.filter((t: any) => !t.isApproved && t.isApproved !== true);
    }
    if (!transactionSearch.trim()) return list;
    const q = transactionSearch.trim().toLowerCase();
    return list.filter((t: any) => {
      const vno = (t.voucherNumber || "").toLowerCase();
      const narr = (t.narration || "").toLowerCase();
      const type = voucherTypeSearchText(t.type);
      const amount = String(t.debit ?? t.credit ?? t.total ?? "").toLowerCase();
      return vno.includes(q) || narr.includes(q) || type.includes(q) || amount.includes(q);
    });
  }, [cardFilteredResult, reportDisplayTransactions, transactionSearch, unapprovedOnly, balanceCardFilter, activeContext, activeEntity?.id]);

  // Qty/amount toggle ya unit badle to row shape change — pager page 1 (Party hook resetKey).
  const itemStatementMobilePagingKey = `${activeEntity?.id ?? ""}|${hasDateFilter}|${transactionSearch.trim()}|${unapprovedOnly}|${balanceCardFilter ?? "all"}|${reportStockViewForTx}|${effectiveDisplayUnit ?? ""}`;
  const {
    pagingMeta: itemStatementMobilePaging,
    pagerPage: itemReportPagerPage,
    setPagerPage: setItemReportPagerPage,
    rowsPerPage: itemReportRowsPerPage,
    setRowsPerPage: setItemReportRowsPerPage,
  } = useStatementReportMobilePaging({
    filteredRows: filteredReportTransactions,
    isMobile,
    openingBalanceForPeriod: effectiveOpeningBalanceForPeriod,
    periodDr: effectivePeriodDr,
    periodCr: effectivePeriodCr,
    closingBalance: effectiveClosingBalance,
    resetKey: itemStatementMobilePagingKey,
  });

  const summaryCards = useMemo(() => {
    const salesAmount = processedTransactions.filter((v) => v.type === "sale").reduce((s, v) => s + (v.total || 0), 0);
    const purchasesAmount = processedTransactions.filter((v) => v.type === "purchase").reduce((s, v) => s + (v.total || 0), 0);
    const salesQty = processedTransactions.filter((v) => v.type === "sale").reduce((s, v) => s + (v.credit || 0), 0);
    const purchasesQty = processedTransactions.filter((v) => v.type === "purchase").reduce((s, v) => s + (v.debit || 0), 0);
    return [
      { title: "Balance", amount: closingBalance, qty: closingBalance, color: closingBalance >= 0 ? "text-green-600" : "text-red-600" },
      { title: "Sales", amount: salesAmount, qty: salesQty, color: "text-green-600" },
      { title: "Purchases", amount: purchasesAmount, qty: purchasesQty, color: "text-red-600" },
    ];
  }, [closingBalance, processedTransactions]);
  const mobileSummaryCards = useMemo(() => filterReportCardsToExistingVouchers([
    ...summaryCards.map((card) => card.title === "Balance" ? { ...card, amount: allTimeNetBalance, qty: allTimeNetBalance, color: allTimeNetBalance >= 0 ? "text-green-600" : "text-red-600" } : card),
    ...buildReportVoucherTypeCards(processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "item" : undefined, summaryCards.map((card) => card.title)),
  ], processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "item" : undefined), [summaryCards, processedTransactions, activeContext, activeEntity?.id, allTimeNetBalance]);
  const clickableSummaryCards = useMemo(
    () => mobileSummaryCards.map((card) => {
      const isNet = ["Balance", "Account Balance", "Net Balance"].includes(card.title);
      const filterKey = isNet ? null : (card as { filterKey?: string }).filterKey ?? `summary:${card.title}`;
      return {
        title: reportMobileSummaryCardTitle(card.title),
        amount: card.amount,
        color: card.color,
        filterKey,
        selected: isNet ? !balanceCardFilter : balanceCardFilter === filterKey,
        onClick: () => setBalanceCardFilter(isNet || balanceCardFilter === filterKey ? null : filterKey),
      };
    }),
    [mobileSummaryCards, balanceCardFilter]
  );

  const desktopSummaryCards = useMemo(
    () => summaryCards.map(({ title, amount, color }) => ({ title, amount, color })),
    [summaryCards]
  );

  const itemDisplayUnits = useMemo(() => {
    if (!selectedItem?.id || !effectiveDisplayUnit) return {};
    return { [selectedItem.id]: effectiveDisplayUnit };
  }, [selectedItem?.id, effectiveDisplayUnit]);

  const setItemDisplayUnit = useCallback((itemId: string, unit: string) => {
    setReportDisplayUnit(unit);
    setReportStockView("qty");
  }, []);

  const handleSelectItemFromList = useCallback((item: Item) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("itemId", item.id);
    newUrl.searchParams.delete("groupId");
    window.history.pushState({}, "", newUrl);
    setSelectedItem(item);
    setSelectedGroup(null);
    setListTab("items");
  }, []);

  const handleSelectGroupFromList = useCallback((group: ItemGroup) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("groupId", group.id);
    newUrl.searchParams.delete("itemId");
    window.history.pushState({}, "", newUrl);
    setSelectedGroup(group);
    setSelectedItem(null);
    setListTab("groups");
  }, []);

  const dateRangeLabel = useMemo(() => {
    // Entity report header row-2 — Party statement jaisa "All Time"; last-10 desktop slice alag logic.
    if (!hasDateFilter) return "Last 10 Txns";
    const from = dateRange!.from!;
    const to = dateRange!.to || from;
    const fromAD = format(from, "LLL dd, y");
    const toAD = to ? format(to, "LLL dd, y") : fromAD;
    const fromBS = formatDateBS(from);
    const toBS = to ? formatDateBS(to) : fromBS;
    if (dateSystem === "AD") return `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
    if (dateSystem === "BS") return `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
    return `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
  }, [dateRange, dateSystem, formatDateBS, hasDateFilter]);

  const handlePrint = () => {
    if (!activeEntity || !company) return;
    let dateRangeText = "All Time";
    if (dateRange?.from) {
      const from = dateRange.from;
      const to = dateRange.to || from;
      const fromBS = formatDateBS(from);
      const toBS = formatDateBS(to);
      const fromAD = format(from, 'MMM-dd-yyyy');
      const toAD = format(to, 'MMM-dd-yyyy');
      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    openPrintDirect({
      company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, logoUrl: company.logoUrl },
      title: `${selectedItem ? "Item" : "Item Group"} Statement: ${activeEntity.name}`,
      context: activeContext as Context,
      contextId: activeEntity.id,
      dateSystem,
      dateRangeText,
      vouchersCount: processedTransactions.length,
      openingBalance: openingBalanceForPeriod,
      transactions: processedTransactions,
      showNarration: true,
    }, true);
  };

  const handleExcel = () => {
    if (!activeEntity) return;
    const dataForExport = processedTransactions.map((t) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": format(d, 'MMM-dd-yyyy'),
        "Voucher No.": t.voucherNumber,
        Type: voucherTypeDisplayText(t.type),
        Narration: t.narration || "",
        Debit: t.debit,
        Credit: t.credit,
        Balance: `${Math.abs(t.balance).toFixed(2)} ${t.balance >= 0 ? "Dr" : "Cr"}`,
      };
    });
    const summaryRows = [
      { "Date (BS)": "Opening Balance", Balance: `${Math.abs(openingBalanceForPeriod).toFixed(2)} ${openingBalanceForPeriod >= 0 ? "Dr" : "Cr"}` },
      { "Date (BS)": "Total", Debit: periodDr, Credit: periodCr },
      { "Date (BS)": "Closing Balance", Balance: `${Math.abs(closingBalance).toFixed(2)} ${closingBalance >= 0 ? "Dr" : "Cr"}` },
    ];
    const worksheet = XLSX.utils.json_to_sheet([...dataForExport, {}, ...summaryRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Item Statement");
    XLSX.writeFile(workbook, `${activeEntity.name}_statement.xlsx`);
  };

  const handleShare = async () => {
    if (!navigator.share) {
      alert("Web Share API not supported in your browser.");
      return;
    }
    if (!activeEntity || !company) return;
    const entityName = activeEntity.name;
    const title = `Statement for ${entityName}`;
    const text = `Here is the statement for ${entityName}.`;
    try {
      let dateRangeText = "All Time";
      if (dateRange?.from) {
        const from = dateRange.from;
        const to = dateRange.to || from;
        const fromBS = formatDateBS(from);
        const toBS = formatDateBS(to);
      const fromAD = format(from, 'MMM-dd-yyyy');
      const toAD = format(to, 'MMM-dd-yyyy');
        if (dateSystem === "AD") dateRangeText = `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
        else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
        else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
      }
      const payload = {
        company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, logoUrl: company.logoUrl },
        title: `${selectedItem ? "Item" : "Item Group"} Statement: ${entityName}`,
        context: activeContext as Context,
        contextId: activeEntity.id,
        dateSystem,
        dateRangeText,
        vouchersCount: processedTransactions.length,
        openingBalance: openingBalanceForPeriod,
        transactions: processedTransactions,
        showNarration: true,
        stockView: selectedItem && reportStockView === "qty" ? ("qty" as const) : undefined,
        displayUnit: selectedItem && reportStockView === "qty" ? effectiveDisplayUnit : undefined,
        itemsData: processedItems,
      };
      const blob = await getPdfBlob(payload);
      if (blob) {
        const file = new (globalThis as any).File([blob], `${entityName.replace(/\s+/g, "_")}_statement.pdf`, { type: "application/pdf" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title, text, url: window.location.href, files: [file] });
        } else {
          await navigator.share({ title, text, url: window.location.href });
        }
      } else {
        await navigator.share({ title, text, url: window.location.href });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Share failed:", err);
      }
    }
  };

  const handleEditVoucher = useCallback(
    (voucher: any) => {
      openingModalRef.current = true;
      setSelectedVoucher(voucher);
      openModalInUrl();
      setIsVoucherDialogOpen(true);
    },
    [openModalInUrl]
  );

  /* ---- Main Item list page parity: header total, pink unapproved badge, + Add ---- */
  const reportShowApproveOnList = useReportShowApproveOnList();
  const reportPending = useReportListPendingApproval({
    enabled: reportShowApproveOnList,
    vouchers,
    entities: processedItems as any[],
    collect: (v, ids) => collectItemIdsTouchedByUnapprovedVoucher(v, ids),
    bucket: (e: any) => resolveItemListGroupBucketId(e),
  });
  const {
    showOnlyEntities: reportOnlyPendingEntities,
    setShowOnlyEntities: setReportOnlyPendingEntities,
    showOnlyGroups: reportOnlyPendingGroups,
    setShowOnlyGroups: setReportOnlyPendingGroups,
  } = usePendingApprovalListFilter(reportPending.total);
  const [isReportCreateEntityOpen, setIsReportCreateEntityOpen] = useState(false);
  const [isReportCreateGroupOpen, setIsReportCreateGroupOpen] = useState(false);
  const reportEntitiesView = useMemo(
    () =>
      !reportOnlyPendingEntities || !reportShowApproveOnList
        ? processedItems
        : processedItems.filter((e: any) => (reportPending.byId[e.id] ?? 0) > 0),
    [processedItems, reportOnlyPendingEntities, reportShowApproveOnList, reportPending]
  );
  const reportGroupsView = useMemo(
    () =>
      !reportOnlyPendingGroups || !reportShowApproveOnList
        ? processedItemGroups
        : processedItemGroups.filter((g: any) => (reportPending.byGroupId[g.id] ?? 0) > 0),
    [processedItemGroups, reportOnlyPendingGroups, reportShowApproveOnList, reportPending]
  );
  const reportListTotalBalance = useMemo(
    () =>
      listTab === "groups"
      ? processedItemGroups.reduce((acc: number, g: any) => acc + (Number(g.balance) || 0), 0)
      : processedItems
          .filter((i: any) => i.type === "item" || i.type === "service" || i.type === "finished_good" || !i.type)
          .reduce((acc: number, i: any) => acc + (Number(i.balance) || 0), 0),
    [listTab, processedItems, processedItemGroups]
  );

  if (loading && !activeEntity) {
    return <LoadingSpinner />;
  }

  const addVoucherDialog = (
    <AddVoucherDialog
      isOpen={isVoucherDialogOpen}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setIsVoucherDialogOpen(false);
          setSelectedVoucher(null);
          closeModalInUrl();
        }
      }}
      voucher={selectedVoucher}
      onVoucherAction={() => setSelectedVoucher(null)}
    />
  );

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={selectedGroup ? groupReportOptions : itemReportOptions}
          value={selectedGroup ? (selectedGroup?.id || "") : (selectedItem?.id || "")}
          onChange={(value) => {
            if (selectedGroup) {
              const group = processedItemGroups.find((g) => g.id === value);
              if (group) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('groupId', group.id);
                newUrl.searchParams.delete('itemId');
                window.history.pushState({}, '', newUrl);
                setSelectedGroup(group);
                setSelectedItem(null);
              }
            } else {
              const entity = processedItems.find((p) => p.id === value);
              if (entity) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('itemId', entity.id);
                newUrl.searchParams.delete('groupId');
                window.history.pushState({}, '', newUrl);
                setSelectedItem(entity);
                setSelectedGroup(null);
              }
            }
          }}
          placeholder={selectedGroup ? "Select a group" : "Select an item"}
        />
      </MobileEntityTxnToolbarPicker>
      <MobileEntityTxnToolbarUnapprovedBadge
        count={mobileUnapprovedTxnCount}
        pressed={unapprovedOnly}
        onToggle={() => {
          setUnapprovedOnly((prev) => !prev);
          setItemReportPagerPage(1);
        }}
      />
      <MobileEntityTxnToolbarSearch>
        <Search className={mdc.mobileTxnToolbarSearchIcon} />
        <Input
          placeholder="Search transactions"
          className={mdc.mobileTxnToolbarSearchInput}
          value={transactionSearch}
          onChange={(e) => {
            setTransactionSearch(e.target.value);
            setItemReportPagerPage(1);
          }}
        />
      </MobileEntityTxnToolbarSearch>
    </MobileEntityTxnToolbarRow>
  );

  if (!isMobile || reportMobileList.showList) {
    return (
      <ReportStatementDesktopShell
        isMobile={isMobile}
        balance={<ReportListTotalBalance value={reportListTotalBalance} format={formatCurrency} />}
        searchRowExtras={
          <ReportListSearchExtras
            show={reportShowApproveOnList}
            count={reportPending.total}
            isGroupsTab={listTab === "groups"}
            entityPressed={reportOnlyPendingEntities}
            onEntityToggle={() => setReportOnlyPendingEntities((v) => !v)}
            groupPressed={reportOnlyPendingGroups}
            onGroupToggle={() => setReportOnlyPendingGroups((v) => !v)}
            entityNoun="items"
            addButton={
              listTab === "groups" ? (
              <CreateItemGroupDialog onGroupCreated={() => {}} isOpen={isReportCreateGroupOpen} onOpenChange={setIsReportCreateGroupOpen} groups={processedItemGroups}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateGroupOpen(true)}>
                  + Add Group
                </PermissionButton>
              </CreateItemGroupDialog>
              ) : (
              <CreateItemDialog onItemCreated={() => {}} isOpen={isReportCreateEntityOpen} onOpenChange={setIsReportCreateEntityOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateEntityOpen(true)}>
                  + Add Item
                </PermissionButton>
              </CreateItemDialog>
              )
            }
          />
        }
        listChromeRouteKey="items"
        pageTitle={pageTitle}
        listTab={listTab}
        entityTabValue="items"
        groupTabValue="groups"
        entityTabLabel="Items"
        onListTabChange={(tab) => setListTab(tab === "groups" ? "groups" : "items")}
        listSearchTerm={listSearchTerm}
        onListSearchChange={setListSearchTerm}
        entitySearchPlaceholder="Search items..."
        groupSearchPlaceholder="Search groups/item"
        entitySectionLabel={
          <div className={mlc.sectionLabelRow}>
            <Package className={mlc.sectionIcon} />
            <span>Item ({reportEntitiesView.length})</span>
          </div>
        }
        groupSectionLabel={
          <div className={mlc.sectionLabelRow}>
            <Layers className={mlc.sectionIcon} />
            <span>Item group ({reportGroupsView.length})</span>
          </div>
        }
        entityQuickFilter={itemListQuickFilter}
        groupQuickFilter={groupListQuickFilter}
        onEntityQuickFilterChange={setItemListQuickFilter}
        onGroupQuickFilterChange={setGroupListQuickFilter}
        summaryCards={desktopSummaryCards}
        showSummary={!!activeEntity}
        entityList={
          <ItemList
            items={reportEntitiesView}
            pendingApprovalByItemId={reportPending.byId}
            onSelectItem={handleSelectItemFromList}
            selectedItem={selectedItem}
            searchTerm={listSearchTerm}
            stockView={reportStockView}
            itemDisplayUnits={itemDisplayUnits}
            quickFilter={itemListQuickFilter}
            onQuickFilterChange={setItemListQuickFilter}
            hideQuickFilterBar
          />
        }
        groupList={
          <ItemGroupList
            groups={reportGroupsView}
            pendingApprovalByGroupId={reportPending.byGroupId}
            pendingApprovalByMemberId={reportPending.byId}
            onSelectGroup={handleSelectGroupFromList}
            selectedGroup={selectedGroup}
            searchTerm={listSearchTerm}
            quickFilter={groupListQuickFilter}
            onQuickFilterChange={setGroupListQuickFilter}
            hideQuickFilterBar
          />
        }
        detailView={
          selectedItem ? (
            <ItemDetails
              item={selectedItem}
              onItemUpdated={() => {}}
              onItemDeleted={() => setSelectedItem(null)}
              transactions={processedTransactions}
              stockView={reportStockView}
              setStockView={setReportStockView}
              itemDisplayUnits={itemDisplayUnits}
              setItemDisplayUnit={setItemDisplayUnit}
              userNames={userNames}
              reportSummaryCards={clickableSummaryCards}
            />
          ) : selectedGroup ? (
            <ItemGroupDetails
              group={selectedGroup}
              allGroups={processedItemGroups}
              items={groupReportEntity?.items ?? []}
              allItems={processedItems}
              stockView="amount"
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              transactions={processedTransactions}
              userNames={userNames}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onItemUpdated={() => {}}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-muted/20">
              <p className="text-sm text-muted-foreground">Select an item or group</p>
            </div>
          )
        }
        footer={addVoucherDialog}
      />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-50 overflow-hidden">
            <ReportEntityMobileHeader
        title={pageTitle}
        entityName={activeEntity?.name}
        closingBalance={closingBalance}
        dateRangeLabel={dateRangeLabel}
        hasDateFilter={hasDateFilter}
        onBack={handleReportBack}
        onClearDate={() => setDateRange(undefined)}
        avatar={activeEntity?.name ? (
          selectedItem ? (
            <ReportStatementHeaderAvatar
              kind="item"
              displayName={activeEntity.name}
              fileUrl={selectedItem.fileUrls?.[0]}
            />
          ) : (
            <ReportStatementHeaderAvatar kind="group" displayName={activeEntity.name} />
          )
        ) : undefined}
      />

      <Drawer
        open={isCalendarOpen}
        onOpenChange={(open: boolean) => {
          if (open) {
            openingModalRef.current = true;
            openModalInUrl();
          } else {
            closeModalInUrl();
          }
          setIsCalendarOpen(open);
        }}
      >
        <DrawerContent>
          <DrawerHeader className="p-4 text-left">
            <DrawerTitle>Select Date Range</DrawerTitle>
            <DrawerDescription>Select a starting and ending date for the transaction list.</DrawerDescription>
          </DrawerHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {(dateSystem === "BS" || dateSystem === "Both") && (
              <NepaliCalendar
                rangePresetSlot={
                  <DateRangePresetRow
                    country={company?.country}
                    onApply={(r) => {
                      setDateRange(r);
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
                          setDateRange(r);
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
                      setDateRange(range as DateRange | undefined);
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

      {/* Mobile: no pb-20 so scroll extends to footer; inner pb-24 so last row clears fixed footer */}
      <main className={cn("flex-1 flex flex-col min-h-0 px-4 pt-0.5", !isMobile && "pb-20")}>
        {view === "chart" ? (
          <div className="-mx-4 w-[calc(100%+2rem)] max-w-none flex-shrink-0">
            <RunningBalanceFullChart transactions={reportDisplayTransactions} openingBalance={openingBalanceForPeriod} />
          </div>
        ) : (
          <>
            <MobileDetailSummaryCollapsible className="w-[calc(100%+2rem)] min-w-0 -mx-4">
            <div key={activeEntity?.id ?? "no-entity"} ref={balanceCardsRowRef} data-pl-mobile-txn-balance-row="" data-pl-bank-report-balance-row="" className="box-border flex w-full min-w-0 flex-nowrap justify-start gap-2 px-2 pt-0.5 pb-3 overflow-x-auto scrollbar-slim-dim flex-shrink-0 items-center">
              {mobileSummaryCards.map((card: any) => {
                const convFactor = selectedItem && reportStockView === "qty" ? getConversionFactor(selectedItem, effectiveDisplayUnit) : 1;
                let customFormatted: string | undefined;
                if (selectedItem && reportStockView === "qty" && effectiveDisplayUnit) {
                  if (card.title === "Balance") {
                    customFormatted = `${formatQuantity(Math.abs(card.amount) / convFactor)} ${effectiveDisplayUnit}`;
                  } else if (card.title === "Sales" || card.title === "Purchases") {
                    const qtyInUnit = (card as { qty?: number }).qty != null ? (card as { qty: number }).qty / convFactor : card.amount / convFactor;
                    customFormatted = `${formatQuantity(Math.abs(qtyInUnit))} ${effectiveDisplayUnit}`;
                  }
                }
                if (card.filterKey) {
                  const selected = balanceCardFilter === card.filterKey;
                  return (
                    <button key={card.title} type="button" aria-pressed={selected} data-pl-bank-report-balance-card="" onClick={() => setBalanceCardFilter((current) => current === card.filterKey ? null : card.filterKey)} className="w-max min-w-[100px] shrink-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ReportSummaryCard title={card.title} amount={card.amount} color={card.color} customFormatted={customFormatted} selected={selected} />
                    </button>
                  );
                }
                if (card.title === "Balance") {
                  return (
                    <div key={card.title} className="flex shrink-0 items-center gap-1">
                      <div className="relative w-max min-w-[100px]">
                        <button type="button" aria-pressed={balanceCardFilter === null} data-pl-bank-report-balance-card="" onClick={() => setBalanceCardFilter(null)} className="w-max min-w-[100px] rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <ReportSummaryCard title={reportMobileSummaryCardTitle(card.title)} amount={card.amount} color={card.color} customFormatted={customFormatted} selected={balanceCardFilter === null} />
                        </button>
                        <ReportNetBalanceInfoButton />
                      </div>
                      {selectedItem && unitOptions.length > 0 && (
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={reportStockView === "amount" ? "amount" : effectiveDisplayUnit}
                            onValueChange={(v) => {
                              if (v === "amount") setReportStockView("amount");
                              else { setReportStockView("qty"); setReportDisplayUnit(v); }
                            }}
                          >
                            <SelectTrigger className="h-10 min-w-[80px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="amount">Amounts</SelectItem>
                              {unitOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                }
                if (card.title !== "Balance") {
                  const filterKey = `summary:${card.title}`;
                  const selected = balanceCardFilter === filterKey;
                  return (
                    <button key={card.title} type="button" aria-pressed={selected} data-pl-bank-report-balance-card="" onClick={() => setBalanceCardFilter((current) => current === filterKey ? null : filterKey)} className="w-max min-w-[100px] shrink-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ReportSummaryCard title={reportMobileSummaryCardTitle(card.title)} amount={card.amount} color={card.color} customFormatted={customFormatted} selected={selected} />
                    </button>
                  );
                }
                return (
                  <React.Fragment key={card.title}>
                    <ReportSummaryCard title={card.title} amount={card.amount} color={card.color} customFormatted={customFormatted} />
                    {card.title === "Balance" && selectedItem && unitOptions.length > 0 && (
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={reportStockView === "amount" ? "amount" : effectiveDisplayUnit}
                          onValueChange={(v) => {
                            if (v === "amount") {
                              setReportStockView("amount");
                            } else {
                              setReportStockView("qty");
                              setReportDisplayUnit(v);
                            }
                          }}
                        >
                          <SelectTrigger className="h-10 min-w-[80px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="amount">Amounts</SelectItem>
                            {unitOptions.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            </MobileDetailSummaryCollapsible>
            <div className="flex flex-1 min-h-0 flex-col -mx-4 md:mx-0">
            <div className="flex-1 min-h-0 overflow-y-auto px-0.5 md:mx-0 md:px-0 pl-mobile-ledger-txn-scroll-pad" data-floating-button-scroll>
              {isMobile ? (
                <div className="pb-4">
                  <TransactionsTable
                    transactions={itemStatementMobilePaging.pageTransactions}
                    context={activeContext}
                    contextId={activeEntity?.id}
                    openingBalance={itemStatementMobilePaging.openingForPage}
                    booksOpeningBalance={balanceCardFilter ? undefined : (activeEntity as any)?.openingBalance != null ? Number((activeEntity as any).openingBalance) : undefined}
                    openingBalanceDate={(activeEntity as any)?.openingBalanceDate}
                    ledgerDateFilterActive={hasDateFilter || !!balanceCardFilter}
                    ledgerShowBookOpeningRow={!balanceCardFilter && (itemReportRowsPerPage <= 0 || itemStatementMobilePaging.edges.before === 0)}
                    ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                    fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                    openingBalancePeriodStartDate={itemStatementMobilePaging.openingPeriodStartDate ?? dateRange?.from}
                    dateRange={dateRange}
                    userNames={userNames}
                    journalAccountNames={journalAccountNames}
                    accountNames={{}}
                    stockView={selectedItem ? reportStockView : "amount"}
                    displayUnit={selectedItem && reportStockView === "qty" ? effectiveDisplayUnit : undefined}
                    item={selectedItem || undefined}
                    onRowClick={handleEditVoucher}
                    openingBalanceLabel="Opening"
                    periodDr={itemStatementMobilePaging.periodDrForPage}
                    periodCr={itemStatementMobilePaging.periodCrForPage}
                    closingBalance={itemStatementMobilePaging.closingForPage}
                  />
                </div>
              ) : (
                <TransactionsTable
                  transactions={filteredReportTransactions}
                  context={activeContext}
                  contextId={activeEntity?.id}
                  openingBalance={effectiveOpeningBalanceForPeriod}
                  booksOpeningBalance={balanceCardFilter ? undefined : (activeEntity as any)?.openingBalance != null ? Number((activeEntity as any).openingBalance) : undefined}
                  openingBalanceDate={(activeEntity as any)?.openingBalanceDate}
                  ledgerDateFilterActive={hasDateFilter || !!balanceCardFilter}
                  ledgerShowBookOpeningRow={!balanceCardFilter}
                  ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                  fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                  periodDr={effectivePeriodDr}
                  periodCr={effectivePeriodCr}
                  closingBalance={effectiveClosingBalance}
                  openingBalancePeriodStartDate={dateRange?.from}
                  dateRange={dateRange}
                  userNames={userNames}
                  journalAccountNames={journalAccountNames}
                  accountNames={{}}
                  stockView={selectedItem ? reportStockView : "amount"}
                  displayUnit={selectedItem && reportStockView === "qty" ? effectiveDisplayUnit : undefined}
                  item={selectedItem || undefined}
                  onRowClick={handleEditVoucher}
                  openingBalanceLabel="Opening"
                  openingBalanceSearch={
                    <Input
                      placeholder="Search..."
                      value={transactionSearch}
                      onChange={(e) => setTransactionSearch(e.target.value)}
                      className="h-9 w-32 max-w-[140px] text-sm"
                    />
                  }
                />
              )}
            </div>
            {/* mb-12: overlap avoid with fixed footer / FAB */}
            {isMobile && view === "list" && (
              <MobileTransactionsPager
                className={mdc.ledgerTxnPagerOutside}
                txnToolbar={mobileEntityTxnToolbar}
                currentPage={itemReportPagerPage}
                totalItems={filteredReportTransactions.length}
                rowsPerPage={itemReportRowsPerPage}
                onPageChange={setItemReportPagerPage}
                onRowsPerPageChange={(n) => {
                  setItemReportRowsPerPage(n);
                  setItemReportPagerPage(1);
                }}
                edgeCounts={
                  itemStatementMobilePaging.edges.before > 0 || itemStatementMobilePaging.edges.after > 0
                    ? itemStatementMobilePaging.edges
                    : undefined
                }
              />
            )}
            </div>
          </>
        )}
      </main>

      <footer data-pl-mobile-ledger-action-footer="" className="flex items-stretch justify-around p-1.5 border-t bg-white gap-1 fixed bottom-0 left-0 right-0">
        <PermissionButton permission="export_data" className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-green-500 hover:bg-green-600 text-white rounded-md" onClick={handlePrint}>
          <Printer className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Print</span>
        </PermissionButton>
        <PermissionButton permission="export_data" className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md" onClick={handleExcel}>
          <FileIcon className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Excel</span>
        </PermissionButton>
        <Button className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md" onClick={handleShare}>
          <Share2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Share</span>
        </Button>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-slate-500 hover:bg-slate-600 text-white rounded-md"
          onClick={() => {
            openingModalRef.current = true;
            openModalInUrl();
            setIsCalendarOpen(true);
          }}
        >
          <CalendarIcon className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Date</span>
        </Button>
        <Button className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-violet-500 hover:bg-violet-600 text-white rounded-md" onClick={() => setView((v) => (v === "list" ? "chart" : "list"))}>
          <BarChart2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Chart</span>
        </Button>
      </footer>

      {addVoucherDialog}
    </div>
  );
}
