"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PermissionButton } from "@/components/permission";
import AdCalendar from "@/components/ui/ad-calendar";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Calendar as CalendarIcon, File, Printer, Share2, BarChart2, X, Search, Receipt, Users } from "lucide-react";
import type { Tax, TaxGroup } from "@/components/tax/types";
import type { DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mergePaymentAndLedgerJournalContraFlows } from "@/lib/reportStatementMoneyInOutExtras";
import { ReportStatementHeaderAvatar } from "@/components/reports/ReportStatementHeaderAvatar";
import { ReportEntityMobileHeader } from "@/components/reports/ReportEntityMobileHeader";
import { useStatementReportMobilePaging } from "@/hooks/useStatementReportMobilePaging";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { computeFilteredCardOpeningAndRows } from "@/lib/reportFilteredCardBalance";
import { buildReportVoucherTypeCards, getReportVoucherTypeKey, makeMobileReportSummaryCards, reportVoucherMatchesSummaryCard, ReportStatementSummaryCardsRow, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";

import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { mdc } from "@/lib/mobileDetailChrome";
import { buildTaxGroupReportEntity } from "@/lib/reportStatementGroupEntity";
import { summarizeUnverifiedTaxTdsByKind } from "@/lib/partyLedgerTdsView";
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
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { collectInterCompanyIdsForPendingApproval } from "@/lib/interCompany/interCompanyVoucherHydrate";
import { resolveTaxListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { CreateTaxGroupDialog } from "@/components/tax/CreateTaxGroupDialog";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { ReportListSearchExtras, ReportListTotalBalance, useReportListPendingApproval, useReportShowApproveOnList } from "@/components/reports/ReportListParityChrome";
import { useReportMobileListMode } from "@/hooks/useReportMobileListMode";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
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
import { Card } from "@/components/ui/card";
import * as XLSX from "xlsx";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import { TaxList } from "@/components/tax/TaxList";
import { TaxGroupList } from "@/components/tax/TaxGroupList";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { TaxGroupDetails } from "@/components/tax/TaxGroupDetails";
import { mlc } from "@/lib/mobileListChrome";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";

const ReportSummaryCard = React.memo(function ReportSummaryCard({
  title,
  amount,
  color,
}: {
  title: string;
  amount: number;
  color: string;
}) {
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const formatted = formatCurrency(amount, { showDrCr: title === "Balance" });
  const titleStr = formatCurrencyForPrint(amount, { showDrCr: title === "Balance" });
  return (
    <Card className="px-2 py-1.5 w-fit flex-shrink-0 border rounded-lg overflow-hidden">
      <div className="flex flex-col">
        <p className="text-xs text-muted-foreground whitespace-nowrap">{title}</p>
        <p className={cn("text-sm sm:text-base font-bold whitespace-nowrap tabular-nums", color)} title={titleStr}>
          {formatted}
        </p>
      </div>
    </Card>
  );
}, (prev, next) => prev.title === next.title && prev.amount === next.amount && prev.color === next.color);

export default function DesktopTaxStatementPage() {
  const { processedTaxes, processedTaxGroups, vouchers, loading, journalAccountNames } = useFyScopedVouchers();
  const { company } = useCompany();
  const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const reportMobileList = useReportMobileListMode(isMobile, ["taxId","groupId"]);
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
  const [listTab, setListTab] = useState<"taxes" | "groups">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("groupId")
      ? "groups"
      : "taxes"
  );
  const [listSearchTerm, setListSearchTerm] = useState("");
  const [taxListQuickFilter, setTaxListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");

  const [selectedTax, setSelectedTax] = useState<Tax | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<TaxGroup | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUidsRef = useRef<Set<string>>(new Set());

  const pageTitle = selectedGroup ? "Tax Group Statement" : "Tax Statement";

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    try {
      const userDoc = await getDoc(doc(firestore, "users", userId));
      if (userDoc.exists()) {
        return userDoc.data().displayName || userDoc.data().email || "Unknown";
      }
    } catch (e) {}
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

  const handleEditVoucher = useCallback(
    (voucher: any) => {
      openingModalRef.current = true;
      setSelectedVoucher(voucher);
      openModalInUrl();
      setIsVoucherDialogOpen(true);
    },
    [openModalInUrl]
  );

  useEffect(() => {
    const taxId = searchParams.get("taxId");
    const groupId = searchParams.get("groupId");

    if (taxId && processedTaxes.length > 0) {
      const tax = processedTaxes.find((p) => p.id === taxId);
      setSelectedTax((prev) => (tax ? tax : prev));
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    } else if (groupId && processedTaxGroups.length > 0) {
      const group = processedTaxGroups.find((g) => g.id === groupId);
      setSelectedGroup((prev) => (group ? group : prev));
      setSelectedTax((prev) => (prev !== null ? null : prev));
    } else if (processedTaxes.length > 0) {
      const first = processedTaxes[0];
      setSelectedTax((prev) => {
        if (!first) return null;
        if (prev?.id === first.id) return prev;
        if (prev && processedTaxes.some((p) => p.id === prev.id)) return prev;
        return first;
      });
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    }
  }, [searchParams, processedTaxes, processedTaxGroups]);

  useEffect(() => {
    if (searchParams.get("groupId")) setListTab("groups");
    else if (searchParams.get("taxId")) setListTab("taxes");
  }, [searchParams]);

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

  const groupReportEntity = useMemo(() => {
    if (!selectedGroup) return null;
    return buildTaxGroupReportEntity(selectedGroup, processedTaxes, processedTaxGroups);
  }, [selectedGroup, processedTaxes, processedTaxGroups]);

  const activeEntity = selectedTax || groupReportEntity;
  useEffect(() => {
    if (balanceCardsRowRef.current) balanceCardsRowRef.current.scrollLeft = 0;
  }, [activeEntity?.id]);
  const activeContext = selectedTax ? "tax" : "group";

  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    activeEntity as any,
    activeContext,
    dateRange
  );
  const { closingBalance: allTimeNetBalance, processedTransactions: allTimeTransactions } = useTransactions(activeEntity as any, activeContext, undefined);

  const hasDateFilter = !!dateRange?.from || !!dateRange?.to;
  // Mobile: poori list paging ke liye; desktop bina filter = last 10 (Party/Tax report pattern).
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
              activeContext === "group" ? "tax" : undefined
            )
          : getReportVoucherTypeKey(
              t,
              activeContext,
              activeEntity?.id,
              activeContext === "group" ? "tax" : undefined
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
        ? reportVoucherMatchesSummaryCard(t, balanceCardFilter.slice(8), activeContext, activeEntity?.id, activeContext === "group" ? "tax" : undefined)
        : getReportVoucherTypeKey(t, activeContext, activeEntity?.id, activeContext === "group" ? "tax" : undefined) === balanceCardFilter);
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

  // Entity / date / search badle to page 1 — tail-window pager Party report jaisa.
  const taxStatementMobilePagingKey = `${activeEntity?.id ?? ""}|${hasDateFilter}|${transactionSearch.trim()}|${unapprovedOnly}|${balanceCardFilter ?? "all"}`;
  const {
    pagingMeta: taxStatementMobilePaging,
    pagerPage: taxReportPagerPage,
    setPagerPage: setTaxReportPagerPage,
    rowsPerPage: taxReportRowsPerPage,
    setRowsPerPage: setTaxReportRowsPerPage,
  } = useStatementReportMobilePaging({
    filteredRows: filteredReportTransactions,
    isMobile,
    openingBalanceForPeriod: effectiveOpeningBalanceForPeriod,
    periodDr: effectivePeriodDr,
    periodCr: effectivePeriodCr,
    closingBalance: effectiveClosingBalance,
    resetKey: taxStatementMobilePagingKey,
  });
  const handleTaxReportCardFilter = useCallback((filter: string | null) => {
    setBalanceCardFilter(filter);
    setTaxReportPagerPage(1);
  }, [setTaxReportPagerPage]);

  const { summaryData } = useMemo(() => {
    const emptyData = {
      summaryData: { sales: 0, purchases: 0, moneyIn: 0, moneyOut: 0 },
    };
    if (!activeEntity) return emptyData;
    const entityVouchers = processedTransactions;

    const pin = entityVouchers.filter((v) => v.type === "payment_in").reduce((sum, v) => sum + (v.amount || 0), 0);
    const pout = entityVouchers.filter((v) => v.type === "payment_out").reduce((sum, v) => sum + (v.amount || 0), 0);
    const { moneyIn, moneyOut } = mergePaymentAndLedgerJournalContraFlows(pin, pout, entityVouchers);

    const summary = {
      sales: entityVouchers.filter((v) => v.type === "sale").reduce((sum, v) => sum + (v.total || 0), 0),
      purchases: entityVouchers.filter((v) => v.type === "purchase").reduce((sum, v) => sum + (v.total || 0), 0),
      moneyIn,
      moneyOut,
    };

    return { summaryData: summary };
  }, [processedTransactions, activeEntity]);

  const unverifiedTdsCardSummary = useMemo(() => {
    if (!selectedTax?.id) return null;
    const byKind = summarizeUnverifiedTaxTdsByKind(processedTransactions, selectedTax.id);
    const count = byKind.sale.count + byKind.purchase.count + byKind.salary.count;
    const net = byKind.sale.net + byKind.purchase.net + byKind.salary.net;
    return count > 0 ? { count, net } : null;
  }, [processedTransactions, selectedTax?.id]);

  const summaryCards = useMemo(
    () => {
      const cards: ReportStatementSummaryCardData[] = [
        { title: "Balance", amount: closingBalance, color: closingBalance >= 0 ? "text-green-600" : "text-red-600" },
        { title: "Sales", amount: summaryData.sales, color: "text-green-600" },
        { title: "Purchases", amount: summaryData.purchases, color: "text-red-600" },
        { title: "Money In", amount: summaryData.moneyIn, color: "text-green-600" },
        { title: "Money Out", amount: summaryData.moneyOut, color: "text-red-600" },
      ];
      if (unverifiedTdsCardSummary) {
        cards.push({
          title: "Unverified TDS",
          amount: unverifiedTdsCardSummary.net,
          color: unverifiedTdsCardSummary.net < 0 ? "text-red-600" : "text-green-600",
          filterKey: "summary:Unverified TDS",
        });
      }
      return cards;
    },
    [closingBalance, summaryData.sales, summaryData.purchases, summaryData.moneyIn, summaryData.moneyOut, unverifiedTdsCardSummary]
  );
  const mobileSummaryCards = useMemo(() => [
    ...summaryCards.map((card) => card.title === "Balance" ? { ...card, amount: allTimeNetBalance, color: allTimeNetBalance >= 0 ? "text-green-600" : "text-red-600" } : card),
    ...buildReportVoucherTypeCards(processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "tax" : undefined, summaryCards.map((card) => card.title)),
  ], [summaryCards, processedTransactions, activeContext, activeEntity?.id, allTimeNetBalance]);
  const clickableSummaryCards = useMemo(
    () => makeMobileReportSummaryCards(mobileSummaryCards, balanceCardFilter, handleTaxReportCardFilter, processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "tax" : undefined),
    [mobileSummaryCards, balanceCardFilter, handleTaxReportCardFilter, processedTransactions, activeContext, activeEntity?.id]
  );

  const handlePrint = () => {
    if (!activeEntity || !company) return;

    let dateRangeText = "All Time";
    if (dateRange?.from) {
      const from = dateRange.from;
      const to = dateRange.to || from;
      const fromBS = formatDateBS(from);
      const toBS = formatDateBS(to);
      const fromAD = formatDate(from);
      const toAD = formatDate(to);

      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }

    openPrintDirect(
      {
        company: {
          name: company.name,
          pan: company.pan,
          phone: company.phone,
          address: company.address,
          logoUrl: company.logoUrl,
        },
        title: `${selectedTax ? "Tax" : "Group"} Statement: ${activeEntity.name}`,
        context: activeContext,
        contextId: activeEntity.id,
        dateSystem: dateSystem,
        dateRangeText,
        vouchersCount: processedTransactions.length,
        openingBalance: openingBalanceForPeriod,
        transactions: processedTransactions,
        showNarration: true,
      },
      true
    );
  };

  const handleExcel = () => {
    if (!activeEntity) return;

    const dataForExport = processedTransactions.map((t: any) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": t.voucherNumber,
        Type: voucherTypeDisplayText(t.type),
        Narration: t.narration || "",
        Debit: t.debit,
        Credit: t.credit,
        Balance: `${Math.abs(t.balance).toFixed(2)} ${t.balance >= 0 ? "Dr" : "Cr"}`,
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

    const finalData = [...dataForExport, {}, ...summaryRows];

    const worksheet = XLSX.utils.json_to_sheet(finalData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tax Statement");

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
    const text = `Here is the financial statement for ${entityName}.`;
    try {
      let dateRangeText = "All Time";
      if (dateRange?.from) {
        const from = dateRange.from;
        const to = dateRange.to || from;
        const fromBS = formatDateBS(from);
        const toBS = formatDateBS(to);
        const fromAD = formatDate(from);
        const toAD = formatDate(to);
        if (dateSystem === "AD") dateRangeText = `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
        else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
        else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
      }
      const payload = {
        company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, logoUrl: company.logoUrl },
        title: `${selectedTax ? "Tax" : "Group"} Statement: ${entityName}`,
        context: activeContext as Context,
        contextId: activeEntity.id,
        dateSystem: dateSystem,
        dateRangeText,
        vouchersCount: processedTransactions.length,
        openingBalance: openingBalanceForPeriod,
        transactions: processedTransactions,
        showNarration: true,
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
      if (err instanceof Error && err.name !== "AbortError") console.error("Share failed:", err);
    }
  };

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

  const taxReportOptions = useMemo(
    () => processedTaxes.map((p) => ({ value: p.id, label: p.name })),
    [processedTaxes]
  );

  // Group dropdown: exclude report-only groups (same as Tax page list)
  const groupReportOptions = useMemo(() => {
    const isReportOnly = (g: TaxGroup) => (g as any).isReportOnly === true;
    const currentId = selectedGroup?.id;
    return processedTaxGroups
      .filter((g) => g.id === currentId || !isReportOnly(g))
      .map((g) => ({ value: g.id, label: g.name }));
  }, [processedTaxGroups, selectedGroup?.id]);

  const taxesForReportList = useMemo(() => {
    const list = [...processedTaxes];
    if (selectedTax?.id && !list.some((t) => t.id === selectedTax.id)) {
      list.push(selectedTax);
    }
    return list;
  }, [processedTaxes, selectedTax]);

  const groupsForReportList = useMemo(() => {
    const isReportOnly = (g: TaxGroup) => (g as any).isReportOnly === true;
    const currentId = selectedGroup?.id;
    return processedTaxGroups.filter((g) => g.id === currentId || !isReportOnly(g));
  }, [processedTaxGroups, selectedGroup?.id]);

  const handleSelectTaxFromList = useCallback((tax: Tax) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("taxId", tax.id);
    newUrl.searchParams.delete("groupId");
    window.history.pushState({}, "", newUrl);
    setSelectedTax(tax);
    setSelectedGroup(null);
    setListTab("taxes");
  }, []);

  const handleSelectGroupFromList = useCallback((group: TaxGroup) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("groupId", group.id);
    newUrl.searchParams.delete("taxId");
    window.history.pushState({}, "", newUrl);
    setSelectedGroup(group);
    setSelectedTax(null);
    setListTab("groups");
  }, []);

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

  /* ---- Main Tax list page parity: header total, pink unapproved badge, + Add ---- */
  const reportShowApproveOnList = useReportShowApproveOnList();
  const reportPending = useReportListPendingApproval({
    enabled: reportShowApproveOnList,
    vouchers,
    entities: processedTaxes as any[],
    collect: (v: any, ids: Set<string>) => {
      // Tax page jaisa: tax header / line items / journal entries + inter-company.
      const out = new Set<string>();
      if (String(v?.type || "") === "inter_company") {
        collectInterCompanyIdsForPendingApproval(v, ids, "tax").forEach((id: string) => out.add(id));
        return out;
      }
      if (v?.taxAccountId && ids.has(v.taxAccountId)) out.add(v.taxAccountId);
      (v?.lineItems || []).forEach((l: any) => { if (l?.taxAccountId && ids.has(l.taxAccountId)) out.add(l.taxAccountId); });
      (v?.entries || []).forEach((e: any) => { if (e?.accountId && ids.has(e.accountId)) out.add(e.accountId); });
      return out;
    },
    bucket: (e: any) => resolveTaxListGroupBucketId(e),
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
        ? taxesForReportList
        : taxesForReportList.filter((e: any) => (reportPending.byId[e.id] ?? 0) > 0),
    [taxesForReportList, reportOnlyPendingEntities, reportShowApproveOnList, reportPending]
  );
  const reportGroupsView = useMemo(
    () =>
      !reportOnlyPendingGroups || !reportShowApproveOnList
        ? groupsForReportList
        : groupsForReportList.filter((g: any) => (reportPending.byGroupId[g.id] ?? 0) > 0),
    [groupsForReportList, reportOnlyPendingGroups, reportShowApproveOnList, reportPending]
  );
  const reportListTotalBalance = useMemo(
    () =>
      listTab === "groups"
      ? processedTaxGroups.reduce((acc: number, g: any) => acc + (Number(g.balance) || 0), 0)
      : processedTaxes.reduce((acc: number, t: any) => acc + (Number(t.balance) || 0), 0),
    [listTab, processedTaxes, processedTaxGroups]
  );

  if (loading && !activeEntity) {
    return <LoadingSpinner />;
  }

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={selectedGroup ? groupReportOptions : taxReportOptions}
          value={selectedGroup ? (selectedGroup?.id || "") : (selectedTax?.id || "")}
          onChange={(value) => {
            if (selectedGroup) {
              const group = processedTaxGroups.find((g) => g.id === value);
              if (group) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('groupId', group.id);
                newUrl.searchParams.delete('taxId');
                window.history.pushState({}, '', newUrl);
                setSelectedGroup(group);
                setSelectedTax(null);
              }
            } else {
              const entity = processedTaxes.find((p) => p.id === value);
              if (entity) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('taxId', entity.id);
                newUrl.searchParams.delete('groupId');
                window.history.pushState({}, '', newUrl);
                setSelectedTax(entity);
                setSelectedGroup(null);
              }
            }
          }}
          placeholder={selectedGroup ? "Select a group" : "Select a tax"}
        />
      </MobileEntityTxnToolbarPicker>
      <MobileEntityTxnToolbarUnapprovedBadge
        count={mobileUnapprovedTxnCount}
        pressed={unapprovedOnly}
        onToggle={() => {
          setUnapprovedOnly((prev) => !prev);
          setTaxReportPagerPage(1);
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
            setTaxReportPagerPage(1);
          }}
        />
      </MobileEntityTxnToolbarSearch>
    </MobileEntityTxnToolbarRow>
  );

  if (!isMobile || reportMobileList.showList) {
    const reportDetailView = selectedTax ? (
      <TaxDetails
        tax={selectedTax}
        allTaxes={processedTaxes}
        transactions={processedTransactions}
        onTaxUpdated={() => {}}
        onTaxDeleted={() => setSelectedTax(null)}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userNames={userNames}
        journalAccountNames={journalAccountNames}
        context="report"
        reportSummaryCards={clickableSummaryCards}
        mobileFooterVariant="report"
      />
    ) : selectedGroup ? (
      <TaxGroupDetails
        group={selectedGroup}
        allGroups={processedTaxGroups}
        taxes={groupReportEntity?.items ?? []}
        onGroupUpdated={() => {}}
        onGroupDeleted={() => setSelectedGroup(null)}
        onTaxUpdated={() => {}}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userNames={userNames}
        journalAccountNames={journalAccountNames}
      />
    ) : (
      <div className="flex h-full flex-col items-center justify-center bg-muted/20">
        <p className="text-sm text-muted-foreground">Select a tax or group</p>
      </div>
    );

    return (
      <>
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
            entityNoun="taxes"
            addButton={
              listTab === "groups" ? (
              <CreateTaxGroupDialog onGroupCreated={() => {}} groups={processedTaxGroups} isOpen={isReportCreateGroupOpen} onOpenChange={setIsReportCreateGroupOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateGroupOpen(true)}>
                  + Add Group
                </PermissionButton>
              </CreateTaxGroupDialog>
              ) : (
              <CreateTaxDialog onTaxCreated={() => {}} isOpen={isReportCreateEntityOpen} onOpenChange={setIsReportCreateEntityOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateEntityOpen(true)}>
                  + Add Tax
                </PermissionButton>
              </CreateTaxDialog>
              )
            }
          />
        }
          listChromeRouteKey="tax"
          pageTitle={pageTitle}
          listTab={listTab}
          entityTabValue="taxes"
          groupTabValue="groups"
          entityTabLabel="Taxes"
          onListTabChange={(tab) => setListTab(tab === "groups" ? "groups" : "taxes")}
          listSearchTerm={listSearchTerm}
          onListSearchChange={setListSearchTerm}
          entitySearchPlaceholder="Search taxes..."
          groupSearchPlaceholder="Search groups/tax"
          entitySectionLabel={
            <div className={mlc.sectionLabelRow}>
              <Receipt className={mlc.sectionIcon} />
              <span>Tax ({reportEntitiesView.length})</span>
            </div>
          }
          groupSectionLabel={
            <div className={mlc.sectionLabelRow}>
              <Users className={mlc.sectionIcon} />
              <span>Tax group ({reportGroupsView.length})</span>
            </div>
          }
          entityQuickFilter={taxListQuickFilter}
          groupQuickFilter={groupListQuickFilter}
          onEntityQuickFilterChange={setTaxListQuickFilter}
          onGroupQuickFilterChange={setGroupListQuickFilter}
          summaryCards={summaryCards}
          showSummary={!!activeEntity}
          entityList={
            <TaxList
              taxes={reportEntitiesView}
              pendingApprovalByTaxId={reportPending.byId}
              onSelectTax={handleSelectTaxFromList}
              selectedTax={selectedTax}
              searchTerm={listSearchTerm}
              quickFilter={taxListQuickFilter}
              onQuickFilterChange={setTaxListQuickFilter}
              hideQuickFilterBar
            />
          }
          groupList={
            <TaxGroupList
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
          detailView={reportDetailView}
        />
        {addVoucherDialog}
      </>
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
          selectedTax ? (
            <ReportStatementHeaderAvatar
              kind="tax"
              displayName={activeEntity.name}
              fileUrl={selectedTax.fileUrl}
            />
          ) : (
            <ReportStatementHeaderAvatar kind="group" displayName={activeEntity.name} />
          )
        ) : undefined}
      />

      {/* Date range drawer (opened from footer Date button) */}
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
              <div className="flex-1 w-full min-w-0">
                <AdCalendar
                  rangePresetSlot={
                    <DateRangePresetRow
                      country={company?.country}
                      onApply={(r) => {
                        setDateRange(r);
                        setIsCalendarOpen(false);
                      }}
                    />
                  }
                  valueAD={dateRange}
                  isRange
                  numberOfMonths={calendarMonths}
                  transactionDates={processedTransactions?.map((t: any) => t.date?.toDate?.() ?? t.date).filter(Boolean) ?? []}
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
            <RunningBalanceFullChart
              transactions={reportDisplayTransactions}
              openingBalance={openingBalanceForPeriod}
            />
          </div>
        ) : (
          <>
            <MobileDetailSummaryCollapsible className="w-[calc(100%+2rem)] min-w-0 -mx-4">
            <div key={activeEntity?.id ?? "no-entity"} ref={balanceCardsRowRef} data-pl-mobile-txn-balance-row="" data-pl-bank-report-balance-row="" className="box-border flex w-full min-w-0 flex-nowrap justify-start gap-2 px-2 pt-0.5 pb-3 overflow-x-auto scrollbar-slim-dim flex-shrink-0">
              <ReportStatementSummaryCardsRow cards={clickableSummaryCards} className="w-max min-w-0 flex-shrink-0 pt-0.5 pb-0 overflow-visible" />
            </div>
            </MobileDetailSummaryCollapsible>

            <div className="flex flex-1 min-h-0 flex-col -mx-4 md:mx-0">
            <div className="flex-1 min-h-0 overflow-y-auto px-0.5 md:mx-0 md:px-0 pl-mobile-ledger-txn-scroll-pad" data-floating-button-scroll>
              {isMobile ? (
                <div className="pb-4">
                  <TransactionsTable
                    transactions={taxStatementMobilePaging.pageTransactions}
                    context={activeContext}
                    contextId={activeEntity?.id}
                    openingBalance={taxStatementMobilePaging.openingForPage}
                    booksOpeningBalance={balanceCardFilter ? undefined : (activeEntity as any)?.openingBalance != null ? Number((activeEntity as any).openingBalance) : undefined}
                    openingBalanceDate={(activeEntity as any)?.openingBalanceDate}
                    ledgerDateFilterActive={hasDateFilter || !!balanceCardFilter}
                    ledgerShowBookOpeningRow={!balanceCardFilter && (taxReportRowsPerPage <= 0 || taxStatementMobilePaging.edges.before === 0)}
                    ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                    fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                    openingBalancePeriodStartDate={taxStatementMobilePaging.openingPeriodStartDate ?? dateRange?.from}
                    dateRange={dateRange}
                    userNames={userNames}
                    journalAccountNames={journalAccountNames}
                    onRowClick={handleEditVoucher}
                    openingBalanceLabel="Opening"
                    periodDr={taxStatementMobilePaging.periodDrForPage}
                    periodCr={taxStatementMobilePaging.periodCrForPage}
                    closingBalance={taxStatementMobilePaging.closingForPage}
                    isTaxContext={true}
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
                  onRowClick={handleEditVoucher}
                  openingBalanceLabel="Opening"
                  openingBalanceSearch={
                    <Input
                      placeholder="Search..."
                      value={transactionSearch}
                      onChange={(e) => setTransactionSearch(e.target.value)}
                      className="h-8 w-32 max-w-[140px] text-sm"
                    />
                  }
                  isTaxContext={true}
                />
              )}
            </div>
            {/* mb-12: fixed footer + FAB overlap avoid — Party report pattern */}
            {isMobile && view === "list" && (
              <MobileTransactionsPager
                className={mdc.ledgerTxnPagerOutside}
                txnToolbar={mobileEntityTxnToolbar}
                currentPage={taxReportPagerPage}
                totalItems={filteredReportTransactions.length}
                rowsPerPage={taxReportRowsPerPage}
                onPageChange={setTaxReportPagerPage}
                onRowsPerPageChange={(n) => {
                  setTaxReportRowsPerPage(n);
                  setTaxReportPagerPage(1);
                }}
                edgeCounts={
                  taxStatementMobilePaging.edges.before > 0 || taxStatementMobilePaging.edges.after > 0
                    ? taxStatementMobilePaging.edges
                    : undefined
                }
              />
            )}
            </div>
          </>
        )}
      </main>

      <footer data-pl-mobile-ledger-action-footer="" className="flex items-stretch justify-around p-1.5 border-t bg-white gap-1 fixed bottom-0 left-0 right-0">
        <PermissionButton
          permission="export_data"
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-green-500 hover:bg-green-600 text-white rounded-md"
          onClick={handlePrint}
        >
          <Printer className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Print</span>
        </PermissionButton>
        <PermissionButton
          permission="export_data"
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md"
          onClick={handleExcel}
        >
          <File className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Excel</span>
        </PermissionButton>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md"
          onClick={handleShare}
        >
          <Share2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Share</span>
        </Button>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-slate-500 hover:bg-slate-600 text-white rounded-md"
          onClick={() => {
            openingModalRef.current = true;
            setIsCalendarOpen(true);
            openModalInUrl();
          }}
        >
          <CalendarIcon className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Date</span>
        </Button>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-violet-500 hover:bg-violet-600 text-white rounded-md"
          onClick={() => setView((v) => (v === "list" ? "chart" : "list"))}
        >
          <BarChart2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Chart</span>
        </Button>
      </footer>
      {addVoucherDialog}
    </div>
  );
}
