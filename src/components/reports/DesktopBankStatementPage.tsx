"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PermissionButton } from "@/components/permission";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { getDisplayType } from "@/components/vouchers/transactionTableShared";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Calendar as CalendarIcon, File, Printer, BarChart2, X, PanelRight, Search, Landmark, Wallet } from "lucide-react";
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mergePaymentAndLedgerJournalContraFlows } from "@/lib/reportStatementMoneyInOutExtras";
import { ReportStatementHeaderAvatar } from "@/components/reports/ReportStatementHeaderAvatar";
import { ReportEntityMobileHeader } from "@/components/reports/ReportEntityMobileHeader";
import { useStatementReportMobilePaging } from "@/hooks/useStatementReportMobilePaging";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { ReportNetBalanceInfoButton, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { computeFilteredCardOpeningAndRows } from "@/lib/reportFilteredCardBalance";

import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { mdc } from "@/lib/mobileDetailChrome";
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
import { openPrintDirect } from "@/lib/printDirect";
import { resolveLedgerRowToVoucherId } from "@/lib/resolveLedgerVoucherId";
import { getFiscalMergePartitionDateFromCompany } from "@/lib/fiscalPartitionRows";
import { buildBankAccountSpendWiseRows } from "@/lib/buildBankAccountSpendWiseRows";
import { useBankLedgerDrCrPerspective } from "@/hooks/useBankLedgerDrCrPerspective";
import { useBankSpendWiseView } from "@/hooks/useBankSpendWiseView";
import {
  applyBankDrCrPerspectiveToTxnRows,
  bankLedgerDepositWithdrawColumnLabels,
  bankLedgerTxnColumnLabels,
  flipLedgerDrCr,
  flipLedgerSignedBalance,
} from "@/lib/bankLedgerDrCrPerspective";
import { useSpendWiseBlinkMode } from "@/components/vouchers/transactionColumnVisibility";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useReportMobileListMode } from "@/hooks/useReportMobileListMode";
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
import * as XLSX from "xlsx";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import usePermissions from "@/hooks/usePermissions";
import { useReportList } from "@/contexts/ReportListContext";
import { buildBankGroupReportEntity } from "@/lib/reportStatementGroupEntity";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import { AccountList } from "@/components/bank-cash/AccountList";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { CreateAccountGroupDialog } from "@/components/bank-cash/CreateAccountGroupDialog";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { collectBankAccountIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesBankLedger";
import { resolveBankListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { isSystemParentGroup } from "@/lib/system-groups";
import { AccountGroupList } from "@/components/bank-cash/AccountGroupList";
import { AccountDetails } from "@/components/bank-cash/AccountDetails";
import { AccountGroupDetails } from "@/components/bank-cash/AccountGroupDetails";
import { mlc } from "@/lib/mobileListChrome";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";

const ReportSummaryCard = React.memo(function ReportSummaryCard({
  title,
  amount,
  color,
  selected,
  onClick,
}: {
  title: string;
  amount: number;
  color: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const showDrCr = title.toLowerCase().includes("balance");
  const formatted = formatCurrency(amount, { showDrCr });
  const titleStr = formatCurrencyForPrint(amount, { showDrCr });
    return (
    <button type="button" aria-pressed={selected ?? false} data-pl-bank-report-balance-card="" onClick={onClick} className="flex h-12 w-max min-w-[100px] shrink-0 items-stretch rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card data-pl-bank-report-balance-card-surface="" data-pl-report-balance-card-surface="" data-pl-report-balance-card-selected={selected ? "true" : undefined} className={cn(
        "pl-dashboard-tone-card h-12 min-h-12 w-max min-w-[100px] px-2 py-1.5 border rounded-lg overflow-visible",
        selected ? "pl-dashboard-ribbon-sky border-blue-500" : "pl-dashboard-ribbon-emerald border-emerald-500"
      )}>
        <div className={cn("flex w-max min-w-full flex-col", title === "Net Balance" && "pr-4")}>
          <p className="text-xs text-muted-foreground whitespace-nowrap">{title}</p>
          <p className={cn("text-sm sm:text-base font-bold whitespace-nowrap tabular-nums", color)} title={titleStr}>
            {formatted}
          </p>
        </div>
      </Card>
    </button>
  );
}, (prev, next) =>
  prev.title === next.title &&
  prev.amount === next.amount &&
  prev.color === next.color &&
  prev.selected === next.selected &&
  prev.onClick === next.onClick
);

function bankReportVoucherTypeLabel(transaction: any, context: string, contextId?: string) {
  return getDisplayType(transaction, { context, contextId }).trim();
}

function bankReportVoucherAmount(transaction: any) {
  const value = Number(transaction?.debit) || Number(transaction?.credit) || Number(transaction?.amount) || Number(transaction?.total) || 0;
  return Math.abs(value);
}

export default function DesktopBankStatementPage() {
  const { processedAccounts, processedAccountGroups, vouchers, loading, journalAccountNames } = useFyScopedVouchers();
  const { company, effectiveNotificationSettings } = useCompany();
  const { can } = usePermissions();
  const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const reportMobileList = useReportMobileListMode(isMobile, ["accountId","groupId"]);
  const { setReportListOpen } = useReportList();
  const reportsPathNorm = pathname?.replace(/\/+$/, "") ?? "";
  /** `/reports` hub: report list Sheet trigger header me — FAB footer/pager se alag clash na ho */
  const isReportsHubMobile = isMobile && reportsPathNorm === "/reports";
  const calendarMonths = useCalendarMonths();
  const openingModalRef = useRef(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [balanceCardFilter, setBalanceCardFilter] = useState<string | null>(null);
  const balanceCardsRowRef = useRef<HTMLDivElement | null>(null);
  const [unapprovedOnly, setUnapprovedOnly] = useState(false);
  const [view, setView] = useState<"list" | "chart">("list");
  const { spendWiseView, setSpendWiseView } = useBankSpendWiseView();
  const { spendWiseBlinkMode } = useSpendWiseBlinkMode();
  const { perspective: bankDrCrPerspective } = useBankLedgerDrCrPerspective();

  const [listTab, setListTab] = useState<"accounts" | "groups" | "clearing">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("groupId")
      ? "groups"
      : "accounts"
  );
  const [listSearchTerm, setListSearchTerm] = useState("");
  const [accountListQuickFilter, setAccountListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<AccountGroup | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUidsRef = useRef<Set<string>>(new Set());

  const pageTitle = selectedGroup ? "Bank Group Statement" : "Bank Account Statement";

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
      const resolvedId = resolveLedgerRowToVoucherId(voucher);
      if (voucher?.type === "opening_balance" || !resolvedId) {
        return;
      }
      openingModalRef.current = true;
      setSelectedVoucher({ ...voucher, id: resolvedId });
      openModalInUrl();
      setIsVoucherDialogOpen(true);
    },
    [openModalInUrl]
  );

  useEffect(() => {
    const accountId = searchParams.get("accountId");
    const groupId = searchParams.get("groupId");

    if (accountId && processedAccounts.length > 0) {
      const account = processedAccounts.find((a) => a.id === accountId);
      setSelectedAccount((prev) => (account ? account : prev));
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    } else if (groupId && processedAccountGroups.length > 0) {
      const group = processedAccountGroups.find((g) => g.id === groupId);
      setSelectedGroup((prev) => (group ? group : prev));
      setSelectedAccount((prev) => (prev !== null ? null : prev));
    } else if (processedAccounts.length > 0) {
      const first = processedAccounts[0];
      setSelectedAccount((prev) => {
        if (!first) return null;
        if (prev?.id === first.id) return prev;
        if (prev && processedAccounts.some((a) => a.id === prev.id)) return prev;
        return first;
      });
      setSelectedGroup((prev) => (prev !== null ? null : prev));
    }
  }, [searchParams, processedAccounts, processedAccountGroups]);

  useEffect(() => {
    if (searchParams.get("groupId")) setListTab("groups");
    else if (searchParams.get("accountId")) setListTab("accounts");
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
    return buildBankGroupReportEntity(selectedGroup, processedAccounts, processedAccountGroups);
  }, [selectedGroup, processedAccounts, processedAccountGroups]);

  const activeEntity = selectedAccount || groupReportEntity;
  const activeContext = selectedAccount ? "account" : "group";

  useEffect(() => {
    setBalanceCardFilter(null);
    if (balanceCardsRowRef.current) balanceCardsRowRef.current.scrollLeft = 0;
  }, [activeEntity?.id]);

  const {
    processedTransactions,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    openingBalanceOutstanding,
    openingBalanceLinkedVoucherNos,
  } = useTransactions(activeEntity as any, activeContext, dateRange, undefined, processedAccounts, undefined, undefined, undefined, undefined, undefined, userNames);
  const { processedTransactions: allTimeTransactions, closingBalance: allTimeNetBalance } = useTransactions(activeEntity as any, activeContext, undefined, undefined, processedAccounts, undefined, undefined, undefined, undefined, undefined, userNames);

  // Desktop AccountDetails exposes the Spend wise toggle for a selected account
  // without checking the company setting; keep the mobile report consistent.
  const spendWiseCanApply = !!selectedAccount;
  // Group report par hamesha statement; toggle sirf single account par available hai.
  const spendWiseActive = spendWiseCanApply && spendWiseView;

  const hasDateFilter = !!dateRange?.from || !!dateRange?.to;
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
        bankReportVoucherTypeLabel(t, activeContext, activeEntity?.id) === balanceCardFilter,
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
      list = list.filter(
        (transaction: any) =>
          bankReportVoucherTypeLabel(transaction, activeContext, activeEntity?.id) === balanceCardFilter
      );
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

  const baseTransactionsNoNotes = useMemo(
    () => filteredReportTransactions.filter((t: any) => t.type !== "note"),
    [filteredReportTransactions]
  );

  const spendWiseBuiltRows = useMemo(() => {
    if (!spendWiseActive || !vouchers?.length || !selectedAccount) return null;
    return buildBankAccountSpendWiseRows({
      accountId: selectedAccount.id,
      openingBalanceForPeriod,
      baseTransactions: baseTransactionsNoNotes,
      vouchers,
    });
  }, [spendWiseActive, vouchers, selectedAccount, openingBalanceForPeriod, baseTransactionsNoNotes]);

  const tableTransactions = useMemo(() => {
    if (spendWiseBuiltRows !== null) return spendWiseBuiltRows;
    return filteredReportTransactions;
  }, [spendWiseBuiltRows, filteredReportTransactions]);

  // Spend-wise rows par search alag se (spacer rows hamesha rakho ta layout toote na).
  const displayTableRows = useMemo(() => {
    if (!transactionSearch.trim()) return tableTransactions;
    if (spendWiseBuiltRows === null) return tableTransactions;
    const q = transactionSearch.trim().toLowerCase();
    return tableTransactions.filter((t: any) => {
      if ((t as any)._spendWiseSpacer) return true;
      const vno = (t.voucherNumber || "").toLowerCase();
      const narr = (t.narration || "").toLowerCase();
      const type = voucherTypeSearchText(t.type);
      const amount = String(t.debit ?? t.credit ?? t.total ?? "").toLowerCase();
      return vno.includes(q) || narr.includes(q) || type.includes(q) || amount.includes(q);
    });
  }, [tableTransactions, spendWiseBuiltRows, transactionSearch]);

  const bankDrCrApplies = !!selectedAccount;
  const activeBankDrCrPerspective = bankDrCrApplies ? bankDrCrPerspective : "company";
  const displayTableRowsForPerspective = useMemo(
    () => applyBankDrCrPerspectiveToTxnRows(displayTableRows as any[], activeBankDrCrPerspective),
    [displayTableRows, activeBankDrCrPerspective]
  );
  const displayOpeningBalanceForPeriod = flipLedgerSignedBalance(
    effectiveOpeningBalanceForPeriod,
    activeBankDrCrPerspective
  );
  const displayPeriodTotals = flipLedgerDrCr(effectivePeriodDr, effectivePeriodCr, activeBankDrCrPerspective);
  const displayClosingBalance = flipLedgerSignedBalance(effectiveClosingBalance, activeBankDrCrPerspective);

  const bankDepositWithdrawColumnLabels = useMemo(
    () =>
      selectedAccount
        ? bankLedgerTxnColumnLabels(selectedAccount.accountType, activeBankDrCrPerspective)
        : bankLedgerDepositWithdrawColumnLabels(activeBankDrCrPerspective),
    [selectedAccount, activeBankDrCrPerspective]
  );

  const bankStatementMobilePagingKey = `${activeEntity?.id ?? ""}|${hasDateFilter}|${transactionSearch.trim()}|${unapprovedOnly}|${balanceCardFilter ?? "all"}|${spendWiseActive ? "sw" : "st"}|${activeBankDrCrPerspective}`;
  const {
    pagingMeta: bankStatementMobilePaging,
    pagerPage: bankReportPagerPage,
    setPagerPage: setBankReportPagerPage,
    rowsPerPage: bankReportRowsPerPage,
    setRowsPerPage: setBankReportRowsPerPage,
  } = useStatementReportMobilePaging({
    filteredRows: displayTableRows,
    isMobile,
    openingBalanceForPeriod: effectiveOpeningBalanceForPeriod,
    periodDr: effectivePeriodDr,
    periodCr: effectivePeriodCr,
    closingBalance: effectiveClosingBalance,
    resetKey: bankStatementMobilePagingKey,
  });

  const displayMobilePageTransactions = useMemo(
    () =>
      applyBankDrCrPerspectiveToTxnRows(
        (bankStatementMobilePaging.pageTransactions || []) as any[],
        activeBankDrCrPerspective
      ),
    [bankStatementMobilePaging.pageTransactions, activeBankDrCrPerspective]
  );
  const displayMobilePageOpening = flipLedgerSignedBalance(
    bankStatementMobilePaging.openingForPage,
    activeBankDrCrPerspective
  );
  const displayMobilePagePeriod = flipLedgerDrCr(
    bankStatementMobilePaging.periodDrForPage,
    bankStatementMobilePaging.periodCrForPage,
    activeBankDrCrPerspective
  );
  const displayMobilePageClosing = flipLedgerSignedBalance(
    bankStatementMobilePaging.closingForPage,
    activeBankDrCrPerspective
  );
  const bankMobileOpeningPeriodStartDate = useMemo(() => {
    const before = bankStatementMobilePaging.edges.before;
    if (before > 0) {
      const previous = displayTableRows[before - 1] as any;
      const value = previous?.date?.toDate ? previous.date.toDate() : previous?.date;
      const parsed = value ? new Date(value) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
    }
    return hasDateFilter ? dateRange?.from : undefined;
  }, [bankStatementMobilePaging.edges.before, displayTableRows, hasDateFilter, dateRange?.from]);

  const summaryData = useMemo(() => {
    if (!activeEntity) return { sales: 0, purchases: 0, moneyIn: 0, moneyOut: 0 };
    const entityVouchers = processedTransactions;
    const pin = entityVouchers.filter((v: any) => v.type === "payment_in").reduce((sum: number, v: any) => sum + (v.amount || 0), 0);
    const pout = entityVouchers.filter((v: any) => v.type === "payment_out").reduce((sum: number, v: any) => sum + (v.amount || 0), 0);
    const { moneyIn, moneyOut } = mergePaymentAndLedgerJournalContraFlows(pin, pout, entityVouchers);
    return {
      sales: entityVouchers.filter((v: any) => v.type === "sale").reduce((sum: number, v: any) => sum + (v.total || 0), 0),
      purchases: entityVouchers.filter((v: any) => v.type === "purchase").reduce((sum: number, v: any) => sum + (v.total || 0), 0),
      moneyIn,
      moneyOut,
    };
  }, [processedTransactions, activeEntity]);

  const summaryCards = useMemo(
    () => {
      const balance = selectedAccount
        ? flipLedgerSignedBalance(closingBalance, bankDrCrPerspective)
        : closingBalance;
      return [
        { title: "Balance", amount: balance, color: balance >= 0 ? "text-green-600" : "text-red-600" },
        { title: "Sales", amount: summaryData.sales, color: "text-green-600" },
        { title: "Purchases", amount: summaryData.purchases, color: "text-red-600" },
        { title: "Money In", amount: summaryData.moneyIn, color: "text-green-600" },
        { title: "Money Out", amount: summaryData.moneyOut, color: "text-red-600" },
      ];
    },
    [closingBalance, selectedAccount, bankDrCrPerspective, summaryData]
  );

  const mobileBalanceCards = useMemo(
    () => {
      const accountBalance = selectedAccount
        ? flipLedgerSignedBalance(allTimeNetBalance, bankDrCrPerspective)
        : allTimeNetBalance;
      const voucherTypeTotals = new Map<string, number>();
      for (const transaction of processedTransactions || []) {
        const rawType = String((transaction as any)?.type ?? "").trim().toLowerCase();
        if (!rawType || rawType === "opening_balance" || (transaction as any)?._ledgerOpeningPillLabel) continue;
        const label = bankReportVoucherTypeLabel(transaction, activeContext, activeEntity?.id);
        if (!label) continue;
        voucherTypeTotals.set(label, (voucherTypeTotals.get(label) ?? 0) + bankReportVoucherAmount(transaction));
      }
      const voucherCards = [...voucherTypeTotals.entries()].map(([label, amount]) => {
        const normalized = label.toLowerCase();
        const color = /(purchase|payment out|payment|money out|expense|salary|withdraw|tds purchase)/.test(normalized)
          ? "text-red-600"
          : "text-green-600";
        const isTax = /(^|[^a-z])(tds|vat)([^a-z]|$)/.test(normalized);
        return {
          title: isTax ? `${label} Balance` : label,
          amount,
          color,
          filterKey: label,
          isTax,
        };
      });
      const balanceCard = {
        title: "Net Balance",
        amount: accountBalance,
        color: accountBalance >= 0 ? "text-green-600" : "text-red-600",
        filterKey: null,
      };
      return [
        balanceCard,
        ...voucherCards.filter((card) => card.isTax),
        ...voucherCards.filter((card) => !card.isTax),
      ];
    },
    [
      closingBalance,
      allTimeNetBalance,
      selectedAccount,
      bankDrCrPerspective,
      processedTransactions,
      activeContext,
      activeEntity?.id,
    ]
  );
  const clickableSummaryCards = useMemo<ReportStatementSummaryCardData[]>(
    () =>
      mobileBalanceCards.map((card) => ({
        title: card.title,
        amount: card.amount,
        color: card.color,
        filterKey: card.filterKey,
        selected: card.filterKey === null ? !balanceCardFilter : balanceCardFilter === card.filterKey,
        onClick: () => {
          setBalanceCardFilter(card.filterKey === null || balanceCardFilter === card.filterKey ? null : card.filterKey);
        },
      })),
    [mobileBalanceCards, balanceCardFilter]
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
    const entityName = selectedAccount ? selectedAccount.accountName : selectedGroup?.name || "";
    const printRows = displayTableRowsForPerspective.filter((t: any) => !(t as any)._spendWiseSpacer);
    const printDrCrLabels = selectedAccount
      ? bankLedgerTxnColumnLabels(selectedAccount.accountType, activeBankDrCrPerspective)
      : bankLedgerDepositWithdrawColumnLabels(activeBankDrCrPerspective);
    openPrintDirect(
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
          country: company.country,
          fiscalYearStart: company.fiscalYearStart,
        },
        title: spendWiseActive
          ? `Spend Wise ${selectedAccount ? "Account" : "Group"} Statement: ${entityName}`
          : `${selectedAccount ? "Account" : "Group"} Statement: ${entityName}`,
        context: activeContext,
        contextId: activeEntity.id,
        dateSystem: dateSystem,
        dateRangeText,
        vouchersCount: printRows.length,
        openingBalance: displayOpeningBalanceForPeriod,
        transactions: printRows,
        showNarration: true,
        userNames: userNames,
        preserveOrder: spendWiseActive,
        spendWise: spendWiseActive,
        billWise: false,
        fiscalMergePartitionAt: getFiscalMergePartitionDateFromCompany(company) ?? undefined,
        fiscalPartitionLabel: company.fiscalPartitionLabel || undefined,
        ...printDrCrLabels,
      },
      true
    );
  };

  const handleExcel = () => {
    if (!activeEntity) return;
    const entityName = selectedAccount ? selectedAccount.accountName : selectedGroup?.name || "";
    const rowsForExport = displayTableRows.filter((t: any) => !(t as any)._spendWiseSpacer);
    const dataForExport = rowsForExport.map((t: any) => {
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
      { "Date (BS)": "Opening Balance", Balance: `${Math.abs(openingBalanceForPeriod).toFixed(2)} ${openingBalanceForPeriod >= 0 ? "Dr" : "Cr"}` },
      { "Date (BS)": "Total", Debit: periodDr, Credit: periodCr },
      { "Date (BS)": "Closing Balance", Balance: `${Math.abs(closingBalance).toFixed(2)} ${closingBalance >= 0 ? "Dr" : "Cr"}` },
    ];
    const finalData = [...dataForExport, {}, ...summaryRows];
    const worksheet = XLSX.utils.json_to_sheet(finalData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Bank Statement");
    XLSX.writeFile(workbook, `${entityName}_statement.xlsx`);
  };

  const dateRangeLabel = useMemo(() => {
    // Party statement jaisa: bina range = "All Time" (UI); data ab bhi last-10 slice desktop par.
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

  const canViewSpecial = can("view_special_bank_accounts");
  const accountReportOptions = useMemo(() => {
    const currentId = selectedAccount?.id;
    return processedAccounts
      .filter((a) => {
        if (a.id === currentId) return true;
        if (a.isSpecial && !canViewSpecial) return false;
        return true;
      })
      .map((a) => ({ value: a.id, label: a.accountName }));
  }, [processedAccounts, selectedAccount?.id, canViewSpecial]);

  const groupReportOptions = useMemo(() => {
    const exclude = ["assets", "equity", "expenses", "income", "liabilities", "liability"];
    const currentId = selectedGroup?.id;
    return processedAccountGroups
      .filter((g) => g.id === currentId || !exclude.includes((g.name || "").trim().toLowerCase()))
      .map((g) => ({ value: g.id, label: g.name }));
  }, [processedAccountGroups, selectedGroup?.id]);

  const accountsForReportList = useMemo(() => {
    const currentId = selectedAccount?.id;
    return processedAccounts.filter((a) => {
      if (a.id === currentId) return true;
      if (a.isSpecial && !canViewSpecial) return false;
      return true;
    });
  }, [processedAccounts, selectedAccount?.id, canViewSpecial]);

  const groupsForReportList = useMemo(() => {
    const exclude = ["assets", "equity", "expenses", "income", "liabilities", "liability"];
    const currentId = selectedGroup?.id;
    return processedAccountGroups.filter(
      (g) => g.id === currentId || !exclude.includes((g.name || "").trim().toLowerCase())
    );
  }, [processedAccountGroups, selectedGroup?.id]);

  /* ---- Main Bank & Cash page parity: pink unapproved badge, Clearing A/c tab, total balance, + Add ---- */
  const showApproveOnList =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false;
  const pendingApprovalByAccountId = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedAccounts?.length) return {} as Record<string, number>;
    const accountIdSet = new Set(processedAccounts.map((a: Account) => a.id));
    const map: Record<string, number> = {};
    vouchers.forEach((v: any) => {
      collectBankAccountIdsTouchedByUnapprovedVoucher(v, accountIdSet).forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }, [vouchers, showApproveOnList, processedAccounts]);
  const pendingApprovalByAccountGroupId = useMemo(() => {
    if (!showApproveOnList) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    processedAccounts.forEach((a: any) => {
      const n = pendingApprovalByAccountId[a.id] || 0;
      if (!n) return;
      const gid = resolveBankListGroupBucketId(a);
      map[gid] = (map[gid] || 0) + n;
    });
    return map;
  }, [processedAccounts, pendingApprovalByAccountId, showApproveOnList]);
  const totalPendingApprovalVoucherCount = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedAccounts?.length) return 0;
    const accountIdSet = new Set(processedAccounts.map((a: Account) => a.id));
    let n = 0;
    for (const v of vouchers as any[]) {
      if (v?.isApproved === true) continue;
      if (collectBankAccountIdsTouchedByUnapprovedVoucher(v, accountIdSet).size > 0) n += 1;
    }
    return n;
  }, [vouchers, showApproveOnList, processedAccounts]);
  const {
    showOnlyEntities: showOnlyAccountsWithPendingApproval,
    setShowOnlyEntities: setShowOnlyAccountsWithPendingApproval,
    showOnlyGroups: showOnlyGroupsWithPendingApproval,
    setShowOnlyGroups: setShowOnlyGroupsWithPendingApproval,
  } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  /** Accounts tab: clearing accounts sirf "Clearing A/c" tab me (main page jaisa). */
  const accountsForReportListView = useMemo(() => {
    const nonClearing = accountsForReportList.filter((a) => a.isClearing !== true || a.id === selectedAccount?.id);
    if (!showOnlyAccountsWithPendingApproval || !showApproveOnList) return nonClearing;
    return nonClearing.filter((a) => (pendingApprovalByAccountId[a.id] ?? 0) > 0 || a.id === selectedAccount?.id);
  }, [accountsForReportList, showOnlyAccountsWithPendingApproval, showApproveOnList, pendingApprovalByAccountId, selectedAccount?.id]);
  const clearingAccountsForReportList = useMemo(
    () => accountsForReportList.filter((a) => a.isClearing === true),
    [accountsForReportList]
  );
  const groupsForReportListView = useMemo(() => {
    if (!showOnlyGroupsWithPendingApproval || !showApproveOnList) return groupsForReportList;
    return groupsForReportList.filter((g) => (pendingApprovalByAccountGroupId[g.id] ?? 0) > 0 || g.id === selectedGroup?.id);
  }, [groupsForReportList, showOnlyGroupsWithPendingApproval, showApproveOnList, pendingApprovalByAccountGroupId, selectedGroup?.id]);
  const reportListDisplayTotalBalance = useMemo(() => {
    if (listTab === "groups") {
      return processedAccountGroups
        .filter((g) => {
          const anyG = g as AccountGroup & { isSystemReserved?: boolean; balanceMasked?: boolean };
          const isSystemParent = anyG.isSystemReserved === true || isSystemParentGroup("account_groups", anyG.id);
          return !anyG.balanceMasked && !isSystemParent;
        })
        .reduce((acc, g) => acc + (Number(g.balance) || 0), 0);
    }
    const sum = processedAccounts
      .filter((a) => !a.isSpecial || canViewSpecial)
      .reduce((acc, a) => acc + (Number(a.balance) || 0), 0);
    return flipLedgerSignedBalance(sum, bankDrCrPerspective);
  }, [listTab, processedAccountGroups, processedAccounts, canViewSpecial, bankDrCrPerspective]);

  const handleSelectAccountFromList = useCallback((account: Account) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("accountId", account.id);
    newUrl.searchParams.delete("groupId");
    window.history.pushState({}, "", newUrl);
    setSelectedAccount(account);
    setSelectedGroup(null);
    setListTab((prev) => (prev === "clearing" && account.isClearing === true ? "clearing" : "accounts"));
  }, []);

  const handleSelectGroupFromList = useCallback((group: AccountGroup) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("groupId", group.id);
    newUrl.searchParams.delete("accountId");
    window.history.pushState({}, "", newUrl);
    setSelectedGroup(group);
    setSelectedAccount(null);
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

  if (loading && !activeEntity) {
    return <LoadingSpinner />;
  }

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={selectedGroup ? groupReportOptions : accountReportOptions}
          value={selectedGroup ? (selectedGroup?.id || "") : (selectedAccount?.id || "")}
          onChange={(value) => {
            if (selectedGroup) {
              const group = processedAccountGroups.find((g) => g.id === value);
              if (group) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('groupId', group.id);
                newUrl.searchParams.delete('accountId');
                window.history.pushState({}, '', newUrl);
                setSelectedGroup(group);
                setSelectedAccount(null);
              }
            } else {
              const entity = processedAccounts.find((a) => a.id === value);
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
          placeholder={selectedGroup ? "Select a group" : "Select an account"}
        />
      </MobileEntityTxnToolbarPicker>
      <MobileEntityTxnToolbarUnapprovedBadge
        count={mobileUnapprovedTxnCount}
        pressed={unapprovedOnly}
        onToggle={() => {
          setUnapprovedOnly((prev) => !prev);
          setBankReportPagerPage(1);
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
            setBankReportPagerPage(1);
          }}
        />
      </MobileEntityTxnToolbarSearch>
    </MobileEntityTxnToolbarRow>
  );

  if (!isMobile || reportMobileList.showList) {
    const reportDetailView = selectedAccount ? (
      <AccountDetails
        account={selectedAccount}
        allAccounts={processedAccounts}
        transactions={processedTransactions}
        onAccountUpdated={() => {}}
        onAccountDeleted={() => setSelectedAccount(null)}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        userNames={userNames}
        reportSummaryCards={clickableSummaryCards}
      />
    ) : selectedGroup ? (
      <AccountGroupDetails
        group={selectedGroup}
        allGroups={processedAccountGroups}
        accounts={groupReportEntity?.items ?? []}
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
    );

    return (
      <ReportStatementDesktopShell
        isMobile={isMobile}
        listChromeRouteKey="bank-cash"
        pageTitle={pageTitle}
        listTab={listTab}
        entityTabValue="accounts"
        groupTabValue="groups"
        entityTabLabel="Accounts"
        onListTabChange={(tab) => setListTab(tab === "groups" ? "groups" : tab === "clearing" ? "clearing" : "accounts")}
        balance={
          <span className={cn("font-semibold", reportListDisplayTotalBalance >= 0 ? "text-green-600" : "text-red-600")}>
            {formatCurrency(reportListDisplayTotalBalance, { showDrCr: true })}
          </span>
        }
        searchRowExtras={
          <>
            {listTab === "accounts" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
              <PendingApprovalListFilterBadge
                compact
                count={totalPendingApprovalVoucherCount}
                pressed={showOnlyAccountsWithPendingApproval}
                onToggle={() => setShowOnlyAccountsWithPendingApproval((v) => !v)}
                tooltipFilterHint={`Only accounts with pending approval - ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
                tooltipShowAllHint="Show all accounts (click)"
                ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
                ariaLabelShowAll="Show all accounts"
              />
            ) : null}
            {listTab === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
              <PendingApprovalListFilterBadge
                compact
                count={totalPendingApprovalVoucherCount}
                pressed={showOnlyGroupsWithPendingApproval}
                onToggle={() => setShowOnlyGroupsWithPendingApproval((v) => !v)}
                tooltipFilterHint={`Only groups with pending approval - ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
                tooltipShowAllHint="Show all groups (click)"
                ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
                ariaLabelShowAll="Show all groups"
              />
            ) : null}
            {listTab === "groups" ? (
              <CreateAccountGroupDialog onGroupCreated={() => {}} groups={processedAccountGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
                  + Add Group
                </PermissionButton>
              </CreateAccountGroupDialog>
            ) : (
              <CreateBankAccountDialog onAccountCreated={() => {}} isOpen={isCreateAccountOpen} onOpenChange={setIsCreateAccountOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateAccountOpen(true)}>
                  + Add Account
                </PermissionButton>
              </CreateBankAccountDialog>
            )}
          </>
        }
        extraTabs={[
          {
            value: "clearing",
            label: "Clearing A/c",
            searchPlaceholder: "Search accounts...",
            sectionLabel: (
              <div className={mlc.sectionLabelRow}>
                <Landmark className={mlc.sectionIcon} />
                <span>Clearing A/c ({clearingAccountsForReportList.length})</span>
              </div>
            ),
            list: (
              <AccountList
                accounts={clearingAccountsForReportList}
                onSelectAccount={handleSelectAccountFromList}
                selectedAccount={selectedAccount}
                searchTerm={listSearchTerm}
                pendingApprovalByAccountId={pendingApprovalByAccountId}
                quickFilter={accountListQuickFilter}
                onQuickFilterChange={setAccountListQuickFilter}
                hideQuickFilterBar
              />
            ),
          },
        ]}
        listSearchTerm={listSearchTerm}
        onListSearchChange={setListSearchTerm}
        entitySearchPlaceholder="Search accounts..."
        groupSearchPlaceholder="Search groups..."
        entitySectionLabel={
          <div className={mlc.sectionLabelRow}>
            <Landmark className={mlc.sectionIcon} />
            <span>Accounts ({accountsForReportListView.length})</span>
          </div>
        }
        groupSectionLabel={
          <div className={mlc.sectionLabelRow}>
            <Wallet className={mlc.sectionIcon} />
            <span>Account group ({groupsForReportListView.length})</span>
          </div>
        }
        entityQuickFilter={accountListQuickFilter}
        groupQuickFilter={groupListQuickFilter}
        onEntityQuickFilterChange={setAccountListQuickFilter}
        onGroupQuickFilterChange={setGroupListQuickFilter}
        summaryCards={summaryCards}
        showSummary={!!activeEntity}
        entityList={
          <AccountList
            accounts={accountsForReportListView}
            onSelectAccount={handleSelectAccountFromList}
            selectedAccount={selectedAccount}
            searchTerm={listSearchTerm}
            pendingApprovalByAccountId={pendingApprovalByAccountId}
            quickFilter={accountListQuickFilter}
            onQuickFilterChange={setAccountListQuickFilter}
            hideQuickFilterBar
          />
        }
        groupList={
          <AccountGroupList
            groups={groupsForReportListView}
            onSelectGroup={handleSelectGroupFromList}
            selectedGroup={selectedGroup}
            searchTerm={listSearchTerm}
            pendingApprovalByGroupId={pendingApprovalByAccountGroupId}
            pendingApprovalByMemberId={pendingApprovalByAccountId}
            quickFilter={groupListQuickFilter}
            onQuickFilterChange={setGroupListQuickFilter}
            hideQuickFilterBar
          />
        }
        detailView={reportDetailView}
        footer={addVoucherDialog}
      />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-50 overflow-hidden">
            <ReportEntityMobileHeader
        title={pageTitle}
        entityName={activeEntity ? String((activeEntity as any).accountName ?? (activeEntity as any).name ?? "") : undefined}
        closingBalance={closingBalance}
        dateRangeLabel={dateRangeLabel}
        hasDateFilter={hasDateFilter}
        onBack={handleReportBack}
        onClearDate={() => setDateRange(undefined)}
        action={isReportsHubMobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => setReportListOpen(true)}
            aria-label="Open report list"
            title="Report list"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        ) : undefined}
        avatar={activeEntity ? (
          selectedAccount ? (
            <ReportStatementHeaderAvatar
              kind="bank"
              displayName={String((activeEntity as any).accountName ?? (activeEntity as any).name ?? "")}
              fileUrl={selectedAccount.fileUrl}
              bankIsSpecial={!!selectedAccount.isSpecial}
            />
          ) : (
            <ReportStatementHeaderAvatar
              kind="group"
              displayName={String((activeEntity as any).name ?? "")}
            />
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

      {/* Mobile: no pb-20 on main so scroll extends to footer; inner pb-24 so last row clears fixed footer */}
      <main className={cn("flex-1 flex flex-col min-h-0 px-4 pt-0.5", !isMobile && "pb-20")}>
        {view === "chart" ? (
          <div className="-mx-4 w-[calc(100%+2rem)] max-w-none flex-shrink-0">
            <RunningBalanceFullChart transactions={reportDisplayTransactions} openingBalance={openingBalanceForPeriod} />
          </div>
        ) : (
          <>
            <MobileDetailSummaryCollapsible className="w-[calc(100%+2rem)] min-w-0 -mx-4">
            <div key={activeEntity?.id ?? "no-entity"} ref={balanceCardsRowRef} data-pl-mobile-txn-balance-row="" data-pl-bank-report-balance-row="" className="box-border flex w-full min-w-0 flex-nowrap justify-start gap-2 px-2 pt-0.5 pb-3 overflow-x-auto scrollbar-slim-dim flex-shrink-0">
              {mobileBalanceCards.map((card) => (
                <div key={`${card.filterKey ?? "account-balance"}-${card.title}`} className="relative flex h-12 w-max min-w-[100px] shrink-0 items-stretch">
                  <ReportSummaryCard
                    title={card.title}
                    amount={card.amount}
                    color={card.color}
                    selected={card.filterKey === null ? !balanceCardFilter : balanceCardFilter === card.filterKey}
                    onClick={() => {
                      setBalanceCardFilter(
                        card.filterKey === null || balanceCardFilter === card.filterKey ? null : card.filterKey
                      );
                      setBankReportPagerPage(1);
                    }}
                  />
                  {card.filterKey === null ? <ReportNetBalanceInfoButton /> : null}
                </div>
              ))}
            </div>
            </MobileDetailSummaryCollapsible>

            <div className="flex flex-1 min-h-0 flex-col -mx-4 md:mx-0">
            <div className="flex-1 min-h-0 overflow-y-auto px-0.5 md:mx-0 md:px-0 pl-mobile-ledger-txn-scroll-pad" data-floating-button-scroll>
              {isMobile ? (
                <div className="pb-4">
                  <TransactionsTable
                    key={`bank-report-${activeEntity?.id ?? "none"}-${spendWiseActive ? "sw" : "st"}-${activeBankDrCrPerspective}`}
                    transactions={displayMobilePageTransactions}
                    context={activeContext}
                    contextId={activeEntity?.id}
                    forceBalanceMode="statement"
                    openingBalance={displayMobilePageOpening}
                    booksOpeningBalance={
                      balanceCardFilter
                        ? undefined
                        : selectedAccount
                        ? flipLedgerSignedBalance(Number(selectedAccount.openingBalance) || 0, activeBankDrCrPerspective)
                        : undefined
                    }
                    ledgerDateFilterActive={!spendWiseActive && (hasDateFilter || !!balanceCardFilter)}
                    ledgerShowBookOpeningRow={
                      !balanceCardFilter &&
                      (bankReportRowsPerPage <= 0 || bankStatementMobilePaging.edges.before === 0)
                    }
                    ledgerTransactionsForFyOpening={balanceCardFilter ? displayTableRowsForPerspective : undefined}
                    fyLedgerScopeOpeningBalance={balanceCardFilter ? displayOpeningBalanceForPeriod : undefined}
                    openingBalancePeriodStartDate={bankMobileOpeningPeriodStartDate}
                    dateRange={dateRange}
                    openingBalanceOutstanding={selectedAccount ? openingBalanceOutstanding : undefined}
                    openingBalanceLinkedVoucherNos={selectedAccount ? openingBalanceLinkedVoucherNos : undefined}
                    openingBalanceNarration={selectedAccount?.openingBalanceNarration}
                    openingBalanceAttachmentUrls={selectedAccount?.documentFileUrls}
                    openingBalanceDate={selectedAccount?.openingBalanceDate}
                    blinkMode={spendWiseActive ? spendWiseBlinkMode : undefined}
                    userNames={userNames}
                    journalAccountNames={journalAccountNames}
                    onRowClick={handleEditVoucher}
                    openingBalanceLabel="Opening"
                    periodDr={displayMobilePagePeriod.debit}
                    periodCr={displayMobilePagePeriod.credit}
                    closingBalance={displayMobilePageClosing}
                    {...bankDepositWithdrawColumnLabels}
                  />
                </div>
              ) : (
                <TransactionsTable
                  key={`bank-report-${activeEntity?.id ?? "none"}-${spendWiseActive ? "sw" : "st"}-${activeBankDrCrPerspective}`}
                  transactions={displayTableRowsForPerspective}
                  context={activeContext}
                  contextId={activeEntity?.id}
                  forceBalanceMode="statement"
                  openingBalance={displayOpeningBalanceForPeriod}
                  booksOpeningBalance={
                    balanceCardFilter
                      ? undefined
                      : selectedAccount
                      ? flipLedgerSignedBalance(Number(selectedAccount.openingBalance) || 0, activeBankDrCrPerspective)
                      : undefined
                  }
                  openingBalanceDate={selectedAccount?.openingBalanceDate}
                  ledgerDateFilterActive={!spendWiseActive && (hasDateFilter || !!balanceCardFilter)}
                  ledgerShowBookOpeningRow={!balanceCardFilter}
                  ledgerTransactionsForFyOpening={balanceCardFilter ? displayTableRowsForPerspective : undefined}
                  fyLedgerScopeOpeningBalance={balanceCardFilter ? displayOpeningBalanceForPeriod : undefined}
                  openingBalancePeriodStartDate={hasDateFilter ? dateRange?.from : undefined}
                  dateRange={dateRange}
                  openingBalanceOutstanding={selectedAccount ? openingBalanceOutstanding : undefined}
                  openingBalanceLinkedVoucherNos={selectedAccount ? openingBalanceLinkedVoucherNos : undefined}
                  blinkMode={spendWiseActive ? spendWiseBlinkMode : undefined}
                  userNames={userNames}
                  journalAccountNames={journalAccountNames}
                  onRowClick={handleEditVoucher}
                  openingBalanceLabel="Opening"
                  periodDr={displayPeriodTotals.debit}
                  periodCr={displayPeriodTotals.credit}
                  closingBalance={displayClosingBalance}
                  openingBalanceSearch={
                    <Input
                      placeholder="Search..."
                      value={transactionSearch}
                      onChange={(e) => setTransactionSearch(e.target.value)}
                      className="h-8 w-32 max-w-[140px] text-sm"
                    />
                  }
                  {...bankDepositWithdrawColumnLabels}
                />
              )}
            </div>
            {isMobile && view === "list" && (
              <MobileTransactionsPager
                // Party report footer pager; bank: Showing/Trxn Of line hatayi (`trimSummary`)
                className={mdc.ledgerTxnPagerOutside}
                txnToolbar={mobileEntityTxnToolbar}
                currentPage={bankReportPagerPage}
                totalItems={displayTableRows.length}
                rowsPerPage={bankReportRowsPerPage}
                onPageChange={setBankReportPagerPage}
                onRowsPerPageChange={(n) => {
                  setBankReportRowsPerPage(n);
                  setBankReportPagerPage(1);
                }}
                edgeCounts={
                  bankStatementMobilePaging.edges.before > 0 || bankStatementMobilePaging.edges.after > 0
                    ? bankStatementMobilePaging.edges
                    : undefined
                }
                trimSummary
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
          <File className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Excel</span>
        </PermissionButton>
        {/* Party report jaisa: Share hata kar Statement / Spend wise toggle (Account Details ke saath preference sync) */}
        <Button
          type="button"
          disabled={!spendWiseCanApply}
          title={
            selectedGroup ? "Group report: sirf statement" : undefined
          }
          className={cn(
            "flex-1 flex flex-col items-center justify-center py-1 min-w-0 rounded-md",
            !spendWiseCanApply && "bg-slate-300 text-slate-600 cursor-not-allowed hover:bg-slate-300",
            spendWiseCanApply && spendWiseActive && "bg-orange-500 hover:bg-orange-600 text-white",
            spendWiseCanApply && !spendWiseActive && "bg-violet-500 hover:bg-violet-600 text-white"
          )}
          onClick={() => {
            if (!spendWiseCanApply) return;
            setSpendWiseView((v) => !v);
          }}
        >
          <span className="text-[10px] leading-tight text-center px-0.5">{spendWiseActive ? "Statement" : "Spend wise"}</span>
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
        <Button className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-violet-500 hover:bg-violet-600 text-white rounded-md" onClick={() => setView((v) => (v === "list" ? "chart" : "list"))}>
          <BarChart2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Chart</span>
        </Button>
      </footer>
      {addVoucherDialog}
    </div>
  );
}
