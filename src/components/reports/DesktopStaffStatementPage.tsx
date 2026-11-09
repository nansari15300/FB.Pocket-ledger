"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PermissionButton } from "@/components/permission";
import { Calendar } from "@/components/ui/calendar";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Calendar as CalendarIcon, File, Printer, Share2, BarChart2, Search, User, Users, X } from "lucide-react";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import type { Staff, StaffGroup } from "@/components/staff/types";
import { StaffList } from "@/components/staff/StaffList";
import { StaffGroupList } from "@/components/staff/StaffGroupList";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { StaffGroupDetails } from "@/components/staff/StaffGroupDetails";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import { mlc } from "@/lib/mobileListChrome";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mergePaymentAndLedgerJournalContraFlows } from "@/lib/reportStatementMoneyInOutExtras";
import { ReportStatementHeaderAvatar } from "@/components/reports/ReportStatementHeaderAvatar";
import { ReportEntityMobileHeader } from "@/components/reports/ReportEntityMobileHeader";
import { useStatementReportMobilePaging } from "@/hooks/useStatementReportMobilePaging";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { computeFilteredCardOpeningAndRows } from "@/lib/reportFilteredCardBalance";
import { buildPartyTdsReportSummaryCards, buildReportVoucherTypeCards, getReportVoucherTypeKey, insertReportCardsAfterNetBalance, makeMobileReportSummaryCards, reportVoucherMatchesSummaryCard, ReportStatementSummaryCardsRow } from "@/components/reports/ReportStatementSummaryCards";
import { buildTaxNameById } from "@/lib/partyLedgerTdsView";
import { summarizeStaffTdsBalances } from "@/lib/staffLedgerTdsView";
import { mapTransactionsForStaffTaxPageView } from "@/lib/staffTaxDetailsLedger";
import { getTaxTransactionAmounts } from "@/hooks/use-transactions";
import { getTaxOppositeAccountIdsFromVoucher } from "@/lib/taxOppositeAccountFilter";

import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { mdc } from "@/lib/mobileDetailChrome";
import { buildStaffGroupReportEntity } from "@/lib/reportStatementGroupEntity";
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
import { collectStaffIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesStaffLedger";
import { resolveStaffListGroupBucketId } from "@/lib/masterEntitySystemGroups";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { CreateStaffGroupDialog } from "@/components/staff/CreateStaffGroupDialog";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { ReportListSearchExtras, ReportListTotalBalance, useReportListPendingApproval, useReportShowApproveOnList } from "@/components/reports/ReportListParityChrome";
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
import { Card } from "@/components/ui/card";
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

export default function DesktopStaffStatementPage() {
  const { processedStaff, processedStaffGroups, processedTaxes, vouchers, vouchersAll, loading, journalAccountNames } = useFyScopedVouchers();
  const { company } = useCompany();
  const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const reportMobileList = useReportMobileListMode(isMobile, ["staffId","groupId"]);
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

  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StaffGroup | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [listTab, setListTab] = useState<"staff" | "groups">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("groupId")
      ? "groups"
      : "staff"
  );
  const [listSearchTerm, setListSearchTerm] = useState("");
  const [staffListQuickFilter, setStaffListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const fetchedUidsRef = useRef<Set<string>>(new Set());

  const pageTitle = selectedGroup ? "Staff Group Statement" : "Staff Statement";

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
    const staffId = searchParams.get("staffId");
    const groupId = searchParams.get("groupId");

    if (staffId && processedStaff.length > 0) {
      const staff = processedStaff.find((p) => p.id === staffId);
      setSelectedStaff((prev) => (staff ? staff : prev));
      setSelectedGroup(prev => (prev !== null ? null : prev));
    } else if (groupId && processedStaffGroups.length > 0) {
      const group = processedStaffGroups.find((g) => g.id === groupId);
      setSelectedGroup((prev) => (group ? group : prev));
      setSelectedStaff(prev => (prev !== null ? null : prev));
    } else if (processedStaff.length > 0) {
      const first = processedStaff[0];
      setSelectedStaff(prev => {
        if (!first) return null;
        if (prev?.id === first.id) return prev;
        if (prev && processedStaff.some((p) => p.id === prev.id)) return prev;
        return first;
      });
      setSelectedGroup(prev => (prev !== null ? null : prev));
    }
  }, [searchParams, processedStaff, processedStaffGroups]);

  useEffect(() => {
    if (searchParams.get("groupId")) setListTab("groups");
    else if (searchParams.get("staffId")) setListTab("staff");
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
    return buildStaffGroupReportEntity(selectedGroup, processedStaff, processedStaffGroups);
  }, [selectedGroup, processedStaff, processedStaffGroups]);

  const activeEntity = selectedStaff || groupReportEntity;
  useEffect(() => {
    if (balanceCardsRowRef.current) balanceCardsRowRef.current.scrollLeft = 0;
  }, [activeEntity?.id]);
  const activeContext = selectedStaff ? "staff" : "group";

  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
    activeEntity as any,
    activeContext,
    dateRange
  );
  const { closingBalance: allTimeNetBalance, processedTransactions: allTimeTransactions } = useTransactions(activeEntity as any, activeContext, undefined);
  const taxNameById = useMemo(() => buildTaxNameById(processedTaxes), [processedTaxes]);
  const voucherByIdForTds = useMemo(() => {
    const src = (vouchersAll?.length ? vouchersAll : vouchers) || [];
    return new Map(src.map((v: { id?: string }) => [String(v.id ?? ""), v as Record<string, unknown>]));
  }, [vouchers, vouchersAll]);
  const staffTdsBalanceSummary = useMemo(() => {
    if (!selectedStaff?.id) return null;
    const taxPageRows = mapTransactionsForStaffTaxPageView(
      Array.from(voucherByIdForTds.values()),
      selectedStaff.id,
      processedTaxes || [],
      getTaxTransactionAmounts,
      getTaxOppositeAccountIdsFromVoucher
    );
    return summarizeStaffTdsBalances(taxPageRows, {
      staffId: selectedStaff.id,
      processedTaxes: processedTaxes || [],
      taxNameById,
      voucherById: voucherByIdForTds,
      includeSettlements: true,
    });
  }, [selectedStaff?.id, voucherByIdForTds, processedTaxes, taxNameById]);

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
        balanceCardFilter.startsWith("summary:")
          ? reportVoucherMatchesSummaryCard(
              t,
              balanceCardFilter.slice(8),
              activeContext,
              activeEntity?.id,
              activeContext === "group" ? "staff" : undefined
            )
          : getReportVoucherTypeKey(
              t,
              activeContext,
              activeEntity?.id,
              activeContext === "group" ? "staff" : undefined
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
        ? reportVoucherMatchesSummaryCard(t, balanceCardFilter.slice(8), activeContext, activeEntity?.id, activeContext === "group" ? "staff" : undefined)
        : getReportVoucherTypeKey(t, activeContext, activeEntity?.id, activeContext === "group" ? "staff" : undefined) === balanceCardFilter);
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

  const staffStatementMobilePagingKey = `${activeEntity?.id ?? ""}|${hasDateFilter}|${transactionSearch.trim()}|${unapprovedOnly}|${balanceCardFilter ?? "all"}`;
  const {
    pagingMeta: staffStatementMobilePaging,
    pagerPage: staffReportPagerPage,
    setPagerPage: setStaffReportPagerPage,
    rowsPerPage: staffReportRowsPerPage,
    setRowsPerPage: setStaffReportRowsPerPage,
  } = useStatementReportMobilePaging({
    filteredRows: filteredReportTransactions,
    isMobile,
    openingBalanceForPeriod: effectiveOpeningBalanceForPeriod,
    periodDr: effectivePeriodDr,
    periodCr: effectivePeriodCr,
    closingBalance: effectiveClosingBalance,
    resetKey: staffStatementMobilePagingKey,
  });

  const { summaryData } = useMemo(() => {
    const emptyData = {
      summaryData: { sales: 0, purchases: 0, moneyIn: 0, moneyOut: 0, addSalary: 0 },
    };
    if (!activeEntity) return emptyData;
    const entityVouchers = processedTransactions;

    const addSalary = entityVouchers
      .filter((v) => v.type === "journal" && v.subType === "add_salary")
      .reduce((sum, v) => sum + (v.total || 0), 0);

    const payIn = entityVouchers.filter((v) => v.type === "payment_in").reduce((sum, v) => sum + (v.amount || 0), 0);
    const payOut = entityVouchers.filter((v) => v.type === "payment_out").reduce((sum, v) => sum + (v.amount || 0), 0);
    // Salary journal `add_salary` Money In chip me shamil nahi (helper me skip).
    const { moneyIn, moneyOut } = mergePaymentAndLedgerJournalContraFlows(payIn, payOut, entityVouchers);

    const summary = {
      sales: entityVouchers.filter((v) => v.type === "sale").reduce((sum, v) => sum + (v.total || 0), 0),
      purchases: entityVouchers.filter((v) => v.type === "purchase").reduce((sum, v) => sum + (v.total || 0), 0),
      moneyIn,
      moneyOut,
      addSalary,
    };

    return { summaryData: summary };
  }, [processedTransactions, activeEntity]);

  const summaryCards = useMemo(
    () => [
      { title: "Balance", amount: closingBalance, color: closingBalance >= 0 ? "text-green-600" : "text-red-600" },
      { title: "Add Salary", amount: summaryData.addSalary, color: "text-red-600" },
      { title: "Money In", amount: summaryData.moneyIn, color: "text-green-600" },
      { title: "Money Out", amount: summaryData.moneyOut, color: "text-red-600" },
    ],
    [closingBalance, summaryData.addSalary, summaryData.moneyIn, summaryData.moneyOut]
  );
  const mobileSummaryCards = useMemo(() => insertReportCardsAfterNetBalance([
    ...summaryCards.map((card) => card.title === "Balance" ? { ...card, amount: allTimeNetBalance, color: allTimeNetBalance >= 0 ? "text-green-600" : "text-red-600" } : card),
    ...buildReportVoucherTypeCards(processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "staff" : undefined, summaryCards.map((card) => card.title)),
  ], buildPartyTdsReportSummaryCards(staffTdsBalanceSummary, { staffSalaryTds: true })), [summaryCards, processedTransactions, activeContext, activeEntity?.id, allTimeNetBalance, staffTdsBalanceSummary]);
  const clickableSummaryCards = useMemo(
    () => makeMobileReportSummaryCards(mobileSummaryCards, balanceCardFilter, setBalanceCardFilter, processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "staff" : undefined),
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
        title: `${selectedStaff ? STAFF_ENTITY_LABEL : "Group"} Statement: ${activeEntity.name}`,
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
    XLSX.utils.book_append_sheet(workbook, worksheet, "Staff Statement");

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
        title: `${selectedStaff ? STAFF_ENTITY_LABEL : "Group"} Statement: ${entityName}`,
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

  const staffReportOptions = useMemo(
    () => processedStaff.map((p) => ({ value: p.id, label: p.name })),
    [processedStaff]
  );

  const groupReportOptions = useMemo(
    () => processedStaffGroups.map((g) => ({ value: g.id, label: g.name })),
    [processedStaffGroups]
  );

  const handleEmbeddedStaffChange = useCallback(
    (staffId: string) => {
      const staff = processedStaff.find((p) => p.id === staffId);
      if (!staff) return;
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("staffId", staff.id);
      newUrl.searchParams.delete("groupId");
      window.history.pushState({}, "", newUrl);
      setSelectedStaff(staff);
      setSelectedGroup(null);
      setListTab("staff");
    },
    [processedStaff]
  );

  const handleSelectStaffFromList = useCallback(
    (staff: Staff) => {
      handleEmbeddedStaffChange(staff.id);
    },
    [handleEmbeddedStaffChange]
  );

  const handleSelectGroupFromList = useCallback((group: StaffGroup) => {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("groupId", group.id);
    newUrl.searchParams.delete("staffId");
    window.history.pushState({}, "", newUrl);
    setSelectedGroup(group);
    setSelectedStaff(null);
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

  /* ---- Main Staff list page parity: header total, pink unapproved badge, + Add ---- */
  const reportShowApproveOnList = useReportShowApproveOnList();
  const reportPending = useReportListPendingApproval({
    enabled: reportShowApproveOnList,
    vouchers,
    entities: processedStaff as any[],
    collect: (v, ids) => collectStaffIdsTouchedByUnapprovedVoucher(v, ids),
    bucket: (e: any) => resolveStaffListGroupBucketId(e),
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
        ? processedStaff
        : processedStaff.filter((e: any) => (reportPending.byId[e.id] ?? 0) > 0),
    [processedStaff, reportOnlyPendingEntities, reportShowApproveOnList, reportPending]
  );
  const reportGroupsView = useMemo(
    () =>
      !reportOnlyPendingGroups || !reportShowApproveOnList
        ? processedStaffGroups
        : processedStaffGroups.filter((g: any) => (reportPending.byGroupId[g.id] ?? 0) > 0),
    [processedStaffGroups, reportOnlyPendingGroups, reportShowApproveOnList, reportPending]
  );
  const reportListTotalBalance = useMemo(
    () =>
      processedStaff.reduce((acc: number, s: any) => acc + (Number(s.balance) || 0), 0),
    [processedStaff]
  );

  if (loading && !activeEntity) {
    return <LoadingSpinner />;
  }

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={selectedGroup ? groupReportOptions : staffReportOptions}
          value={selectedGroup ? (selectedGroup?.id || "") : (selectedStaff?.id || "")}
          onChange={(value) => {
            if (selectedGroup) {
              const group = processedStaffGroups.find((g) => g.id === value);
              if (group) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('groupId', group.id);
                newUrl.searchParams.delete('staffId');
                window.history.pushState({}, '', newUrl);
                setSelectedGroup(group);
                setSelectedStaff(null);
              }
            } else {
              const entity = processedStaff.find((p) => p.id === value);
              if (entity) {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('staffId', entity.id);
                newUrl.searchParams.delete('groupId');
                window.history.pushState({}, '', newUrl);
                setSelectedStaff(entity);
                setSelectedGroup(null);
              }
            }
          }}
          placeholder={selectedGroup ? "Select a group" : "Select a staff"}
        />
      </MobileEntityTxnToolbarPicker>
      <MobileEntityTxnToolbarUnapprovedBadge
        count={mobileUnapprovedTxnCount}
        pressed={unapprovedOnly}
        onToggle={() => {
          setUnapprovedOnly((prev) => !prev);
          setStaffReportPagerPage(1);
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
            setStaffReportPagerPage(1);
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
            entityNoun="staff"
            addButton={
              listTab === "groups" ? (
              <CreateStaffGroupDialog onGroupCreated={() => {}} isOpen={isReportCreateGroupOpen} onOpenChange={setIsReportCreateGroupOpen} groups={processedStaffGroups}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateGroupOpen(true)}>
                  + Add Group
                </PermissionButton>
              </CreateStaffGroupDialog>
              ) : (
              <CreateStaffDialog onStaffCreated={() => {}} groups={processedStaffGroups} isOpen={isReportCreateEntityOpen} onOpenChange={setIsReportCreateEntityOpen}>
                <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsReportCreateEntityOpen(true)}>
                  + Add {STAFF_ENTITY_LABEL}
                </PermissionButton>
              </CreateStaffDialog>
              )
            }
          />
        }
        listChromeRouteKey="staff"
        pageTitle={pageTitle}
        listTab={listTab}
        entityTabValue="staff"
        groupTabValue="groups"
        entityTabLabel={STAFF_ENTITY_LABEL}
        onListTabChange={(tab) => setListTab(tab === "groups" ? "groups" : "staff")}
        listSearchTerm={listSearchTerm}
        onListSearchChange={setListSearchTerm}
        entitySearchPlaceholder="Search staff..."
        groupSearchPlaceholder="Search groups/staff"
        entitySectionLabel={
          <div className={mlc.sectionLabelRow}>
            <User className={mlc.sectionIcon} />
            <span>{STAFF_ENTITY_LABEL} ({reportEntitiesView.length})</span>
          </div>
        }
        groupSectionLabel={
          <div className={mlc.sectionLabelRow}>
            <Users className={mlc.sectionIcon} />
            <span>Staff group ({reportGroupsView.length})</span>
          </div>
        }
        entityQuickFilter={staffListQuickFilter}
        groupQuickFilter={groupListQuickFilter}
        onEntityQuickFilterChange={setStaffListQuickFilter}
        onGroupQuickFilterChange={setGroupListQuickFilter}
        summaryCards={clickableSummaryCards}
        showSummary={!!activeEntity}
        entityList={
          <StaffList
            staff={reportEntitiesView}
            pendingApprovalByStaffId={reportPending.byId}
            onSelectStaff={handleSelectStaffFromList}
            selectedStaff={selectedStaff}
            searchTerm={listSearchTerm}
            quickFilter={staffListQuickFilter}
            onQuickFilterChange={setStaffListQuickFilter}
            hideQuickFilterBar
          />
        }
        groupList={
          <StaffGroupList
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
          selectedStaff ? (
            <StaffDetails
              staff={selectedStaff}
              allStaff={processedStaff}
              allGroups={processedStaffGroups}
              transactions={processedTransactions}
              onStaffUpdated={() => {}}
              onStaffDeleted={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={userNames}
              context="report"
              reportCardFilter={balanceCardFilter}
              reportSummaryCards={clickableSummaryCards}
              mobileFooterVariant="report"
              onSelectStaff={handleEmbeddedStaffChange}
            />
          ) : selectedGroup ? (
            <StaffGroupDetails
              group={selectedGroup}
              staff={groupReportEntity?.items ?? []}
              allGroups={processedStaffGroups}
              userNames={userNames}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => {}}
              onStaffUpdated={() => {}}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-muted/20">
              <p className="text-sm text-muted-foreground">Select a staff or group</p>
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
          selectedStaff ? (
            <ReportStatementHeaderAvatar
              kind="staff"
              displayName={activeEntity.name}
              fileUrl={selectedStaff.fileUrl}
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
                    transactions={staffStatementMobilePaging.pageTransactions}
                    context={activeContext}
                    contextId={activeEntity?.id}
                    openingBalance={staffStatementMobilePaging.openingForPage}
                    booksOpeningBalance={balanceCardFilter ? undefined : (activeEntity as any)?.openingBalance != null ? Number((activeEntity as any).openingBalance) : undefined}
                    openingBalanceDate={(activeEntity as any)?.openingBalanceDate}
                    ledgerDateFilterActive={hasDateFilter || !!balanceCardFilter}
                    ledgerShowBookOpeningRow={!balanceCardFilter && (staffReportRowsPerPage <= 0 || staffStatementMobilePaging.edges.before === 0)}
                    ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                    fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                    openingBalancePeriodStartDate={staffStatementMobilePaging.openingPeriodStartDate ?? dateRange?.from}
                    dateRange={dateRange}
                    userNames={userNames}
                    journalAccountNames={journalAccountNames}
                    onRowClick={handleEditVoucher}
                    openingBalanceLabel="Opening"
                    periodDr={staffStatementMobilePaging.periodDrForPage}
                    periodCr={staffStatementMobilePaging.periodCrForPage}
                    closingBalance={staffStatementMobilePaging.closingForPage}
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
            {isMobile && view === "list" && (
              <MobileTransactionsPager
                className={mdc.ledgerTxnPagerOutside}
                txnToolbar={mobileEntityTxnToolbar}
                currentPage={staffReportPagerPage}
                totalItems={filteredReportTransactions.length}
                rowsPerPage={staffReportRowsPerPage}
                onPageChange={setStaffReportPagerPage}
                onRowsPerPageChange={(n) => {
                  setStaffReportRowsPerPage(n);
                  setStaffReportPagerPage(1);
                }}
                edgeCounts={
                  staffStatementMobilePaging.edges.before > 0 || staffStatementMobilePaging.edges.after > 0
                    ? staffStatementMobilePaging.edges
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
