"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, usePathname } from "next/navigation";
import { useLocationSearchParams } from "@/hooks/useLocationSearchParams";
import { Button } from "@/components/ui/button";
import { PermissionButton } from "@/components/permission";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Calendar as CalendarIcon, File, Printer, Share2, BarChart2, DollarSign, Users, X } from "lucide-react";
import { collectExpenseGroupScopeAccounts, collectExpenseGroupScopeGroupIds } from "@/lib/expenseGroupTree";
import type { ExpenseAccount, ExpenseGroup } from "@/components/expenses/types";
import { ExpenseAccountList } from "@/components/expenses/ExpenseAccountList";
import { ExpenseGroupList } from "@/components/expenses/ExpenseGroupList";
import { ExpenseAccountDetails } from "@/components/expenses/ExpenseAccountDetails";
import { ExpenseGroupDetails } from "@/components/expenses/ExpenseGroupDetails";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import { mlc } from "@/lib/mobileListChrome";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import type { DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import AdCalendar from "@/components/ui/ad-calendar";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { ReportStatementHeaderAvatar } from "@/components/reports/ReportStatementHeaderAvatar";
import { ReportEntityMobileHeader } from "@/components/reports/ReportEntityMobileHeader";
import { useStatementReportMobilePaging } from "@/hooks/useStatementReportMobilePaging";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { computeFilteredCardOpeningAndRows } from "@/lib/reportFilteredCardBalance";
import { buildReportVoucherTypeCards, getReportVoucherTypeKey, makeMobileReportSummaryCards, reportVoucherMatchesSummaryCard, ReportStatementSummaryCardsRow } from "@/components/reports/ReportStatementSummaryCards";

import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { mdc } from "@/lib/mobileDetailChrome";
import { Search } from "lucide-react";
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
import { resolveExpenseListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { CreateExpenseAccountDialog } from "@/components/expenses/CreateExpenseAccountDialog";
import { CreateExpenseGroupDialog } from "@/components/expenses/CreateExpenseGroupDialog";
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
import * as XLSX from "xlsx";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";

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
    <div className="px-2 py-1.5 w-fit flex-shrink-0 border rounded-lg overflow-hidden bg-card">
      <div className="flex flex-col">
        <p className="text-xs text-muted-foreground whitespace-nowrap">{title}</p>
        <p className={cn("text-sm sm:text-base font-bold whitespace-nowrap tabular-nums", color)} title={titleStr}>
          {formatted}
        </p>
      </div>
    </div>
  );
}, (prev, next) => prev.title === next.title && prev.amount === next.amount && prev.color === next.color);

export default function DesktopExpenseStatementPage() {
  const {
    processedExpenseAccounts,
    processedExpenseGroups,
    vouchers,
    loading,
    journalAccountNames,
  } = useFyScopedVouchers();
  const { company } = useCompany();
  const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
  const router = useRouter();
  const searchParams = useLocationSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const reportMobileList = useReportMobileListMode(isMobile, ["accountId","groupId"]);
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
  const [listTab, setListTab] = useState<"accounts" | "groups">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("groupId")
      ? "groups"
      : "accounts"
  );
  const [listSearchTerm, setListSearchTerm] = useState("");
  const [accountListQuickFilter, setAccountListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");

  const [selectedAccount, setSelectedAccount] = useState<ExpenseAccount | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ExpenseGroup | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUidsRef = useRef<Set<string>>(new Set());

  const pageTitle = selectedGroup ? "In/Exp Group Statement" : "In/Exp Statement";

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

  // Build group entity with items and expenseGroupIds for useTransactions
  const groupEntity = useMemo(() => {
    if (!selectedGroup) return null;
    const accountsInGroup = collectExpenseGroupScopeAccounts(
      selectedGroup.id,
      processedExpenseGroups,
      processedExpenseAccounts
    );
    const expenseGroupIds = collectExpenseGroupScopeGroupIds(selectedGroup.id, processedExpenseGroups);
    return { ...selectedGroup, items: accountsInGroup, expenseGroupIds };
  }, [selectedGroup, processedExpenseAccounts, processedExpenseGroups]);

  const activeEntity = selectedAccount || groupEntity;
  useEffect(() => {
    if (balanceCardsRowRef.current) balanceCardsRowRef.current.scrollLeft = 0;
  }, [activeEntity?.id]);
  const activeContext = selectedAccount ? "expense" : "group";

  useEffect(() => {
    const accountId = searchParams.get("accountId");
    const groupId = searchParams.get("groupId");

    if (accountId && processedExpenseAccounts.length > 0) {
      const acc = processedExpenseAccounts.find((a) => a.id === accountId);
      setSelectedAccount((prev) => (acc ? acc : prev));
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    } else if (groupId && processedExpenseGroups.length > 0) {
      const grp = processedExpenseGroups.find((g) => g.id === groupId);
      setSelectedGroup((prev) => (grp ? grp : prev));
      setSelectedAccount((prev) => (prev !== null ? null : prev));
    } else if (processedExpenseAccounts.length > 0) {
      const first = processedExpenseAccounts[0];
      setSelectedAccount((prev) => {
        if (!first) return null;
        if (prev?.id === first.id) return prev;
        if (prev && processedExpenseAccounts.some((a) => a.id === prev.id)) return prev;
        return first;
      });
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    }
  }, [searchParams, processedExpenseAccounts, processedExpenseGroups]);

  useEffect(() => {
    if (searchParams.get("groupId")) setListTab("groups");
    else if (searchParams.get("accountId")) setListTab("accounts");
  }, [searchParams]);

  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    activeEntity as any,
    activeContext,
    dateRange,
    undefined,
    processedExpenseAccounts,
    vouchers
  );
  const { closingBalance: allTimeNetBalance, processedTransactions: allTimeTransactions } = useTransactions(
    activeEntity as any,
    activeContext,
    undefined,
    undefined,
    processedExpenseAccounts,
    vouchers
  );

  const hasDateFilter = !!dateRange?.from || !!dateRange?.to;
  // Mobile: full list for MobileTransactionsPager; desktop no date = last 10.
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
              activeContext === "group" ? "expense" : undefined
            )
          : getReportVoucherTypeKey(
              t,
              activeContext,
              activeEntity?.id,
              activeContext === "group" ? "expense" : undefined
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
        ? reportVoucherMatchesSummaryCard(t, balanceCardFilter.slice(8), activeContext, activeEntity?.id, activeContext === "group" ? "expense" : undefined)
        : getReportVoucherTypeKey(t, activeContext, activeEntity?.id, activeContext === "group" ? "expense" : undefined) === balanceCardFilter);
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

  // In/Exp account ya group switch / filter / search par pager reset.
  const expenseStatementMobilePagingKey = `${activeEntity?.id ?? ""}|${hasDateFilter}|${transactionSearch.trim()}|${unapprovedOnly}|${balanceCardFilter ?? "all"}`;
  const {
    pagingMeta: expenseStatementMobilePaging,
    pagerPage: expenseReportPagerPage,
    setPagerPage: setExpenseReportPagerPage,
    rowsPerPage: expenseReportRowsPerPage,
    setRowsPerPage: setExpenseReportRowsPerPage,
  } = useStatementReportMobilePaging({
    filteredRows: filteredReportTransactions,
    isMobile,
    openingBalanceForPeriod: effectiveOpeningBalanceForPeriod,
    periodDr: effectivePeriodDr,
    periodCr: effectivePeriodCr,
    closingBalance: effectiveClosingBalance,
    resetKey: expenseStatementMobilePagingKey,
  });

  const { summaryData, chartData } = useMemo(() => {
    const emptyData = {
      summaryData: { income: 0, expense: 0 },
      chartData: { balance: [] },
    };
    if (!activeEntity) return emptyData;
    const entityVouchers = processedTransactions;

    const summary = {
      income: entityVouchers.filter((v) => v.type === "direct_income").reduce((sum, v) => sum + (v.amount || 0), 0),
      expense: entityVouchers.filter((v) => v.type === "direct_expense").reduce((sum, v) => sum + (v.amount || 0), 0),
    };

    const charts = {
      balance: entityVouchers.map((t) => ({ date: t.date?.toDate?.() ?? new Date(t.date), value: t.balance })),
    };

    return { summaryData: summary, chartData: charts };
  }, [processedTransactions, activeEntity]);

  const summaryCards = useMemo(
    () => [
      { title: "Balance", amount: closingBalance, color: closingBalance >= 0 ? "text-green-600" : "text-red-600" },
      { title: "Income", amount: summaryData.income, color: "text-green-600" },
      { title: "Expense", amount: summaryData.expense, color: "text-red-600" },
    ],
    [closingBalance, summaryData.income, summaryData.expense]
  );
  const mobileSummaryCards = useMemo(() => [
    ...summaryCards.map((card) => card.title === "Balance" ? { ...card, amount: allTimeNetBalance, color: allTimeNetBalance >= 0 ? "text-green-600" : "text-red-600" } : card),
    ...buildReportVoucherTypeCards(processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "expense" : undefined, summaryCards.map((card) => card.title)),
  ], [summaryCards, processedTransactions, activeContext, activeEntity?.id, allTimeNetBalance]);
  const clickableSummaryCards = useMemo(
    () => makeMobileReportSummaryCards(mobileSummaryCards, balanceCardFilter, setBalanceCardFilter, processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "expense" : undefined),
    [mobileSummaryCards, balanceCardFilter, processedTransactions, activeContext, activeEntity?.id]
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
        title: `Income & Expense Statement: ${activeEntity.name}`,
        context: activeContext as "expense" | "group",
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

    const dataForExport = processedTransactions.map((t) => {
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
    XLSX.utils.book_append_sheet(workbook, worksheet, "Income & Expense Statement");
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
        title: `Income & Expense Statement: ${entityName}`,
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

  const accountReportOptions = useMemo(
    () =>
      processedExpenseAccounts.map((a) => ({ value: a.id, label: a.name })),
    [processedExpenseAccounts]
  );

  const groupReportOptions = useMemo(() => {
    const exclude = ["income", "expenses"];
    const currentId = selectedGroup?.id;
    return processedExpenseGroups
      .filter(
        (g) =>
          g.id === currentId || !exclude.includes((g.id || "").toLowerCase())
      )
      .map((g) => ({ value: g.id, label: g.name }));
  }, [processedExpenseGroups, selectedGroup?.id]);

  const groupsForReportList = useMemo(() => {
    const exclude = ["income", "expenses"];
    const currentId = selectedGroup?.id;
    return processedExpenseGroups.filter(
      (g) => g.id === currentId || !exclude.includes((g.id || "").toLowerCase())
    );
  }, [processedExpenseGroups, selectedGroup?.id]);

  const handleSelectAccountFromList = useCallback((account: ExpenseAccount) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("accountId", account.id);
    newUrl.searchParams.delete("groupId");
    window.history.pushState({}, "", newUrl);
    setSelectedAccount(account);
    setSelectedGroup(null);
    setListTab("accounts");
  }, []);

  const handleSelectGroupFromList = useCallback((group: ExpenseGroup) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("groupId", group.id);
    newUrl.searchParams.delete("accountId");
    window.history.pushState({}, "", newUrl);
    setSelectedGroup(group);
    setSelectedAccount(null);
    setListTab("groups");
  }, []);

  /* ---- Main Expense list page parity: header total, pink unapproved badge, + Add ---- */
  const reportShowApproveOnList = useReportShowApproveOnList();
  const reportPending = useReportListPendingApproval({
    enabled: reportShowApproveOnList,
    vouchers,
    entities: processedExpenseAccounts as any[],
    collect: (v: any, ids: Set<string>) => {
      // Incomes/Expenses page jaisa.
      const out = new Set<string>();
      if (String(v?.type || "") === "inter_company") {
        collectInterCompanyIdsForPendingApproval(v, ids, "expense").forEach((id: string) => out.add(id));
        return out;
      }
      for (const k of ["incomeAccountId", "expenseAccountId", "accountId"]) {
        if (v?.[k] && ids.has(v[k])) out.add(v[k]);
      }
      (v?.entries || []).forEach((e: any) => { if (e?.accountId && ids.has(e.accountId)) out.add(e.accountId); });
      return out;
    },
    bucket: (e: any) => resolveExpenseListGroupBucketId(e),
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
        ? processedExpenseAccounts
        : processedExpenseAccounts.filter((e: any) => (reportPending.byId[e.id] ?? 0) > 0),
    [processedExpenseAccounts, reportOnlyPendingEntities, reportShowApproveOnList, reportPending]
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
      ? processedExpenseGroups
          .filter((g: any) => !["income", "expenses"].includes((g.id || "").toLowerCase()))
          .reduce((acc: number, g: any) => acc + (Number(g.balance) || 0), 0)
      : processedExpenseAccounts.reduce((acc: number, a: any) => acc + (Number(a.balance) || 0), 0),
    [listTab, processedExpenseAccounts, processedExpenseGroups]
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
          options={selectedGroup ? groupReportOptions : accountReportOptions}
          value={selectedGroup ? (selectedGroup?.id || "") : (selectedAccount?.id || "")}
          onChange={(value) => {
            if (selectedGroup) {
              const group = processedExpenseGroups.find((g) => g.id === value);
              if (group) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('groupId', group.id);
                newUrl.searchParams.delete('accountId');
                window.history.pushState({}, '', newUrl);
                setSelectedGroup(group);
                setSelectedAccount(null);
              }
            } else {
              const entity = processedExpenseAccounts.find((a) => a.id === value);
              if (entity) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('accountId', entity.id);
                newUrl.searchParams.delete('groupId');
                window.history.pushState({}, '', newUrl);
                setSelectedAccount(entity);
                setSelectedGroup(null);
              }
            }
          }}
          placeholder={selectedGroup ? "Select a group" : "Select account"}
        />
      </MobileEntityTxnToolbarPicker>
      <MobileEntityTxnToolbarUnapprovedBadge
        count={mobileUnapprovedTxnCount}
        pressed={unapprovedOnly}
        onToggle={() => {
          setUnapprovedOnly((prev) => !prev);
          setExpenseReportPagerPage(1);
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
            setExpenseReportPagerPage(1);
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
            entityNoun="accounts"
            addButton={
              listTab === "groups" ? (
              <CreateExpenseGroupDialog onGroupCreated={() => {}} groups={processedExpenseGroups} isOpen={isReportCreateGroupOpen} onOpenChange={setIsReportCreateGroupOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateGroupOpen(true)}>
                  + Add Group
                </PermissionButton>
              </CreateExpenseGroupDialog>
              ) : (
              <CreateExpenseAccountDialog onExpenseAccountCreated={() => {}} isOpen={isReportCreateEntityOpen} onOpenChange={setIsReportCreateEntityOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateEntityOpen(true)}>
                  + Add Account
                </PermissionButton>
              </CreateExpenseAccountDialog>
              )
            }
          />
        }
        listChromeRouteKey="incomes"
        pageTitle={pageTitle}
        listTab={listTab}
        entityTabValue="accounts"
        groupTabValue="groups"
        entityTabLabel="Accounts"
        onListTabChange={(tab) => setListTab(tab === "groups" ? "groups" : "accounts")}
        listSearchTerm={listSearchTerm}
        onListSearchChange={setListSearchTerm}
        entitySearchPlaceholder="Search accounts..."
        groupSearchPlaceholder="Search groups/account"
        entitySectionLabel={
          <div className={mlc.sectionLabelRow}>
            <DollarSign className={mlc.sectionIcon} />
            <span>Account ({reportEntitiesView.length})</span>
          </div>
        }
        groupSectionLabel={
          <div className={mlc.sectionLabelRow}>
            <Users className={mlc.sectionIcon} />
            <span>Group ({reportGroupsView.length})</span>
          </div>
        }
        entityQuickFilter={accountListQuickFilter}
        groupQuickFilter={groupListQuickFilter}
        onEntityQuickFilterChange={setAccountListQuickFilter}
        onGroupQuickFilterChange={setGroupListQuickFilter}
        summaryCards={summaryCards}
        showSummary={!!activeEntity}
        entityList={
          <ExpenseAccountList
            accounts={reportEntitiesView}
            pendingApprovalByAccountId={reportPending.byId}
            onSelectAccount={handleSelectAccountFromList}
            selectedAccount={selectedAccount}
            searchTerm={listSearchTerm}
            quickFilter={accountListQuickFilter}
            onQuickFilterChange={setAccountListQuickFilter}
            hideQuickFilterBar
          />
        }
        groupList={
          <ExpenseGroupList
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
          selectedAccount ? (
            <ExpenseAccountDetails
              account={selectedAccount}
              allAccounts={processedExpenseAccounts}
              transactions={processedTransactions}
              onAccountUpdated={() => {}}
              onAccountDeleted={() => setSelectedAccount(null)}
              userNames={userNames}
              journalAccountNames={journalAccountNames}
              context="report"
              reportSummaryCards={clickableSummaryCards}
              mobileFooterVariant="report"
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
          ) : selectedGroup ? (
            <ExpenseGroupDetails
              group={selectedGroup}
              allGroups={processedExpenseGroups}
              accounts={groupEntity?.items ?? []}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onAccountUpdated={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={userNames}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-muted/20">
              <p className="text-sm text-muted-foreground">Select an account or group</p>
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
          selectedAccount ? (
            <ReportStatementHeaderAvatar
              kind="expense"
              displayName={activeEntity.name}
              fileUrl={selectedAccount.fileUrl}
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
            <DrawerDescription>
              Select a starting and ending date for the transaction list.
            </DrawerDescription>
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
                      transactions={expenseStatementMobilePaging.pageTransactions}
                      context={activeContext}
                      contextId={activeEntity?.id}
                      openingBalance={expenseStatementMobilePaging.openingForPage}
                      booksOpeningBalance={balanceCardFilter ? undefined : (activeEntity as any)?.openingBalance != null ? Number((activeEntity as any).openingBalance) : undefined}
                      openingBalanceDate={(activeEntity as any)?.openingBalanceDate}
                      ledgerDateFilterActive={hasDateFilter || !!balanceCardFilter}
                      ledgerShowBookOpeningRow={!balanceCardFilter && (expenseReportRowsPerPage <= 0 || expenseStatementMobilePaging.edges.before === 0)}
                      ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                      fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                      openingBalancePeriodStartDate={expenseStatementMobilePaging.openingPeriodStartDate ?? dateRange?.from}
                      dateRange={dateRange}
                      userNames={userNames}
                      journalAccountNames={journalAccountNames}
                      onRowClick={handleEditVoucher}
                      openingBalanceLabel="Opening"
                      periodDr={expenseStatementMobilePaging.periodDrForPage}
                      periodCr={expenseStatementMobilePaging.periodCrForPage}
                      closingBalance={expenseStatementMobilePaging.closingForPage}
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
                  />
                )}
              </div>
              {/* Fixed footer + FAB ke upar jagah — Party report pager (~mb-12). */}
              {isMobile && view === "list" && (
                <MobileTransactionsPager
                  className={mdc.ledgerTxnPagerOutside}
                txnToolbar={mobileEntityTxnToolbar}
                  currentPage={expenseReportPagerPage}
                  totalItems={filteredReportTransactions.length}
                  rowsPerPage={expenseReportRowsPerPage}
                  onPageChange={setExpenseReportPagerPage}
                  onRowsPerPageChange={(n) => {
                    setExpenseReportRowsPerPage(n);
                    setExpenseReportPagerPage(1);
                  }}
                  edgeCounts={
                    expenseStatementMobilePaging.edges.before > 0 || expenseStatementMobilePaging.edges.after > 0
                      ? expenseStatementMobilePaging.edges
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
          <Printer className="w-4 h-4 mb-0" />{" "}
          <span className="text-[10px] leading-tight">Print</span>
        </PermissionButton>
        <PermissionButton
          permission="export_data"
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md"
          onClick={handleExcel}
        >
          <File className="w-4 h-4 mb-0" />{" "}
          <span className="text-[10px] leading-tight">Excel</span>
        </PermissionButton>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md"
          onClick={handleShare}
        >
          <Share2 className="w-4 h-4 mb-0" />{" "}
          <span className="text-[10px] leading-tight">Share</span>
        </Button>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-slate-500 hover:bg-slate-600 text-white rounded-md"
          onClick={() => {
            openingModalRef.current = true;
            setIsCalendarOpen(true);
            openModalInUrl();
          }}
        >
          <CalendarIcon className="w-4 h-4 mb-0" />{" "}
          <span className="text-[10px] leading-tight">Date</span>
        </Button>
        <Button
          className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-violet-500 hover:bg-violet-600 text-white rounded-md"
          onClick={() => setView((v) => (v === "list" ? "chart" : "list"))}
        >
          <BarChart2 className="w-4 h-4 mb-0" />{" "}
          <span className="text-[10px] leading-tight">Chart</span>
        </Button>
      </footer>
      {addVoucherDialog}
    </div>
  );
}
