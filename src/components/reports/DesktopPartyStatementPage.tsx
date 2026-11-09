
"use client";

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { computeFilteredCardOpeningAndRows } from "@/lib/reportFilteredCardBalance";
import { ReportStatementSummaryCardsRow, buildPartyTdsReportSummaryCards, buildReportVoucherTypeCards, getReportVoucherTypeKey, insertReportCardsAfterNetBalance, makeMobileReportSummaryCards, reportTdsFilterSide, reportVoucherMatchesSummaryCard } from "@/components/reports/ReportStatementSummaryCards";
import { buildTaxNameById, expandPartyLedgerTdsRows, mergeLedgerTdsVisibleColumnsWithPrefs, summarizePartyTdsBalances } from "@/lib/partyLedgerTdsView";
import { Button } from "@/components/ui/button";
import { PermissionButton } from "@/components/permission";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AdCalendar from "@/components/ui/ad-calendar";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { Combobox } from "@/components/ui/combobox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, ArrowLeft, Calendar as CalendarIcon, ChevronDown, File, Printer, BarChart2, Search, User, Users, X } from "lucide-react";
import { PartyList } from "@/components/party/PartyList";
import { PartyGroupList } from "@/components/party/PartyGroupList";
import { ReportShowListButton } from "@/components/reports/ReportShowListButton";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { mlc } from "@/lib/mobileListChrome";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import type { Party, Group } from "@/components/party/types";
import { ReportStatementHeaderAvatar } from "@/components/reports/ReportStatementHeaderAvatar";
import { ReportEntityMobileHeader } from "@/components/reports/ReportEntityMobileHeader";
import { ReportLedgerTxnDetailPane } from "@/components/reports/ReportLedgerTxnDetailPane";
import type { DateRange } from "@/components/ui/ad-calendar";
import { startOfMonth, endOfMonth, format, isSameDay } from "date-fns";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mergePaymentAndLedgerJournalContraFlows } from "@/lib/reportStatementMoneyInOutExtras";
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
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useReportMobileListMode } from "@/hooks/useReportMobileListMode";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import type { BSDate } from "@/lib/bs-date";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import * as XLSX from 'xlsx';
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PartyDetails } from "@/components/party/PartyDetails";
import { useLiveMasterSelection } from "@/hooks/useLiveMasterSelection";
import { OverdueAccountView, type OverdueTransactionRow } from "@/components/party/OverdueAccountView";
import { HistoryDialog } from "@/components/vouchers/HistoryDialog";
import { LinkAdvancesToVoucherDialog } from "@/components/vouchers/LinkAdvancesToVoucherDialog";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";
import { applyPaymentBillWiseLinkAllocations } from "@/lib/voucherActionsClient";
import { toast } from "sonner";
import { GroupDetails } from "@/components/party/GroupDetails";
import { useStatementReportMobilePaging } from "@/hooks/useStatementReportMobilePaging";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { mdc } from "@/lib/mobileDetailChrome";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { buildPartyGroupReportEntity } from "@/lib/reportStatementGroupEntity";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateGroupDialog } from "@/components/party/CreateGroupDialog";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { collectPartyIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesPartyLedger";
import usePermissions from "@/hooks/usePermissions";
import {
  dedupeInterCompanyClearingParties,
  isInterCompanyPartyListAccount,
} from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import { buildIcPeerCompanyGroupRows, IC_COMPANY_PARTY_GROUP_ID } from "@/lib/interCompany/icPeerCompanyGroups";
import { resolvePartyListGroupBucketId } from "@/lib/partySystemGroups";
import type { PartyListSelectOptions } from "@/components/party/PartyList";
import { resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";

/** Main Parties page (`/party`) ka Overdue virtual account id. */
const PARTY_PAGE_OVERDUE_ACCOUNT_ID = "__overdue__";

export default function DesktopPartyStatementPage() {
    const {
        processedParties,
        processedPartiesForSelection,
        processedGroups,
        processedAccounts,
        processedExpenseAccounts,
        processedAccountGroups,
        processedExpenseGroups,
        processedTaxGroups,
        processedStaffGroups,
        processedTaxes,
        processedStaff,
        vouchers,
        vouchersAll,
        loading,
        journalAccountNames,
        overdueTransactions,
        hasOverdueTransactions,
    } = useFyScopedVouchers();
    const { company, effectiveNotificationSettings } = useCompany();
    const { can } = usePermissions();
    const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const reportMobileList = useReportMobileListMode(isMobile, ["partyId","groupId"]);
    /** Main Parties page jaisa "Overdue Vouchers" view - report ke andar hi (list ke right / mobile detail). */
    const [showReportOverdue, setShowReportOverdue] = useState(false);
    /** Overdue view actions (Parties page parity): history + link (Receive/Pay/New Sale = existing report FAB). */
    const [overdueHistoryVoucher, setOverdueHistoryVoucher] = useState<any>(null);
    const [overdueLinkAdvancesVoucher, setOverdueLinkAdvancesVoucher] = useState<any>(null);
    const [overdueLinkPaymentVoucher, setOverdueLinkPaymentVoucher] = useState<any>(null);
    const calendarMonths = useCalendarMonths();
    const openingModalRef = useRef(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
    const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
    const [transactionSearch, setTransactionSearch] = useState("");
    const [unapprovedOnly, setUnapprovedOnly] = useState(false);
    const [balanceCardFilter, setBalanceCardFilter] = useState<string | null>(null);
    const balanceCardsRowRef = useRef<HTMLDivElement | null>(null);
    const [mobileSearchTerm, setMobileSearchTerm] = useState("");
    const [isDateSearchMode, setIsDateSearchMode] = useState(false);
    const [view, setView] = useState<'list' | 'chart'>('list');
    const [listTab, setListTab] = useState<"parties" | "groups" | "ic_ac">(() =>
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("groupId")
            ? "groups"
            : "parties"
    );
    const [listSearchTerm, setListSearchTerm] = useState("");
    const [partyListQuickFilter, setPartyListQuickFilter] = useState<EntityListQuickFilter>("latest");
    const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
    // Same preference as Party Details: Statement vs Bill wise (running balance vs per-voucher status).
    const { balanceMode, setBalanceMode } = useBalanceMode();

    const [selectedPartyRaw, setSelectedParty] = useState<Party | null>(null);
    const selectedParty = useLiveMasterSelection<Party>(selectedPartyRaw, setSelectedParty, processedParties);
    const [selectedGroupRaw, setSelectedGroup] = useState<Group | null>(null);
    const selectedGroup = useLiveMasterSelection<Group>(selectedGroupRaw, setSelectedGroup, processedGroups);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const fetchedUidsRef = useRef<Set<string>>(new Set());

    const pageTitle = selectedGroup ? 'Party Group Statement' : 'Party Statement';

    const fetchUserName = useCallback(async (userId: string): Promise<string> => {
        return resolveUserDisplayName(userId, "Unknown");
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

    const handleEditVoucher = useCallback((voucher: any) => {
        openingModalRef.current = true;
        setSelectedVoucher(voucher);
        openModalInUrl();
        setIsVoucherDialogOpen(true);
    }, [openModalInUrl]);

    useEffect(() => {
        const partyId = searchParams.get('partyId');
        const groupId = searchParams.get('groupId');

        if (partyId && processedParties.length > 0) {
            const party = processedParties.find(p => p.id === partyId);
            setSelectedParty((prev) => (party ? party : prev));
            setSelectedGroup((prev) => (prev !== null ? null : prev));
        } else if (groupId && processedGroups.length > 0) {
            const group = processedGroups.find(g => g.id === groupId);
            setSelectedGroup((prev) => (group ? group : prev));
            setSelectedParty((prev) => (prev !== null ? null : prev));
        } else if (processedPartiesForSelection.length > 0) {
            const first = processedPartiesForSelection[0];
            setSelectedParty((prev) => {
                if (!first) return null;
                if (prev?.id === first.id) return prev;
                if (prev && processedPartiesForSelection.some((p) => p.id === prev.id)) return prev;
                return first;
            });
            setSelectedGroup((prev) => (prev !== null ? null : prev));
        }
    }, [searchParams, processedParties, processedPartiesForSelection, processedGroups]);

    useEffect(() => {
        if (searchParams.get("groupId")) setListTab("groups");
        else if (searchParams.get("partyId")) setListTab("parties");
    }, [searchParams]);
    
      useEffect(() => {
        if (isMobile && dateRange?.from) {
          const from = formatDate(dateRange.from);
          const to = dateRange.to ? formatDate(dateRange.to) : from;
          setMobileSearchTerm(from === to ? from + " to " + to : from);
          setIsDateSearchMode(true);
        }
      }, [dateRange, isMobile, formatDate]);
      
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
        return buildPartyGroupReportEntity(selectedGroup, {
            allParties: processedParties,
            allGroups: processedGroups,
            processedAccounts,
            processedExpenseAccounts,
            processedAccountGroups,
            processedExpenseGroups,
            processedTaxGroups,
            processedStaffGroups,
            processedTaxes,
            processedStaff,
        });
    }, [
        selectedGroup,
        processedParties,
        processedGroups,
        processedAccounts,
        processedExpenseAccounts,
        processedAccountGroups,
        processedExpenseGroups,
        processedTaxGroups,
        processedStaffGroups,
        processedTaxes,
        processedStaff,
    ]);

    const activeEntity = selectedParty || groupReportEntity;
    useEffect(() => {
      if (balanceCardsRowRef.current) balanceCardsRowRef.current.scrollLeft = 0;
    }, [activeEntity?.id]);
    const activeContext = selectedParty ? 'party' : 'group';

    const {
        processedTransactions,
        openingBalanceForPeriod,
        periodDr,
        periodCr,
        closingBalance,
        openingBalanceOutstanding,
        openingBalanceLinkedVoucherNos,
    } = useTransactions(activeEntity as any, activeContext, dateRange);
    const { closingBalance: allTimeNetBalance, processedTransactions: allTimeTransactions } = useTransactions(activeEntity as any, activeContext, undefined);
    const taxNameById = useMemo(() => buildTaxNameById(processedTaxes), [processedTaxes]);
    const voucherByIdForTds = useMemo(() => {
      const src = (vouchersAll?.length ? vouchersAll : vouchers) || [];
      return new Map(src.map((v: { id?: string }) => [String(v.id ?? ""), v as Record<string, unknown>]));
    }, [vouchers, vouchersAll]);
    const partyTdsBalanceSummary = useMemo(
      () =>
        summarizePartyTdsBalances((allTimeTransactions || []) as Record<string, unknown>[], taxNameById, {
          partyId: selectedParty?.id,
          voucherById: voucherByIdForTds,
        }),
      [allTimeTransactions, taxNameById, selectedParty?.id, voucherByIdForTds]
    );
    const tdsFilterSide = reportTdsFilterSide(balanceCardFilter);

    // Desktop: no date filter par last 10. Mobile + pager: pura processed list taaki Showing / Trxn Of sahi ho.
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
      const expandTds = (rows: any[]) => {
        const expanded = expandPartyLedgerTdsRows(rows as Record<string, unknown>[], taxNameById, {
          partyId: selectedParty?.id,
          voucherById: voucherByIdForTds,
        });
        if (!tdsFilterSide) return expanded;
        return expanded.filter(
          (row) => String((row as { _ledgerTdsSide?: unknown })._ledgerTdsSide ?? "").toLowerCase() === tdsFilterSide
        );
      };
      return computeFilteredCardOpeningAndRows({
        allTimeTransactions: tdsFilterSide ? expandTds(allTimeTransactions || []) : allTimeTransactions,
        periodTransactions: tdsFilterSide ? expandTds(reportDisplayTransactions) : reportDisplayTransactions,
        fromDate: hasDateFilter ? dateRange?.from : undefined,
        filterKey: balanceCardFilter,
        matchesFilter: (t: any) =>
          tdsFilterSide
            ? true
            : balanceCardFilter.startsWith("summary:")
              ? reportVoucherMatchesSummaryCard(
                  t,
                  balanceCardFilter.slice(8),
                  activeContext,
                  activeEntity?.id,
                  activeContext === "group" ? "party" : undefined
                )
              : getReportVoucherTypeKey(
                  t,
                  activeContext,
                  activeEntity?.id,
                  activeContext === "group" ? "party" : undefined
                ) === balanceCardFilter,
      });
    }, [
      balanceCardFilter,
      tdsFilterSide,
      taxNameById,
      selectedParty?.id,
      voucherByIdForTds,
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
            ? reportVoucherMatchesSummaryCard(t, balanceCardFilter.slice(8), activeContext, activeEntity?.id, activeContext === "group" ? "party" : undefined)
            : getReportVoucherTypeKey(t, activeContext, activeEntity?.id, activeContext === "group" ? "party" : undefined) === balanceCardFilter);
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

    const partyStatementMobilePagingKey = `${activeEntity?.id ?? ""}|${hasDateFilter}|${transactionSearch.trim()}|${unapprovedOnly}|${balanceMode}|${balanceCardFilter ?? "all"}`;
    const {
        pagingMeta: partyStatementMobilePaging,
        pagerPage: partyReportPagerPage,
        setPagerPage: setPartyReportPagerPage,
        rowsPerPage: partyReportRowsPerPage,
        setRowsPerPage: setPartyReportRowsPerPage,
    } = useStatementReportMobilePaging({
        filteredRows: filteredReportTransactions,
        isMobile,
        openingBalanceForPeriod: effectiveOpeningBalanceForPeriod,
        periodDr: effectivePeriodDr,
        periodCr: effectivePeriodCr,
        closingBalance: effectiveClosingBalance,
        resetKey: partyStatementMobilePagingKey,
    });

    const { summaryData, chartData } = useMemo(() => {
        const emptyData = {
          summaryData: { sales: 0, purchases: 0, moneyIn: 0, moneyOut: 0 },
          chartData: { balance: [], sales: [], purchases: [], moneyIn: [], moneyOut: [] }
        };
        if (!activeEntity) return emptyData;
        const entityVouchers = processedTransactions;

        const payIn = entityVouchers.filter((v) => v.type === "payment_in").reduce((sum, v) => sum + (v.amount || 0), 0);
        const payOut = entityVouchers.filter((v) => v.type === "payment_out").reduce((sum, v) => sum + (v.amount || 0), 0);
        // JRNL/Contra: table row debit/credit (party account hisaab se) Money In→Cr, Money Out→Dr.
        const { moneyIn: moneyInMerged, moneyOut: moneyOutMerged } = mergePaymentAndLedgerJournalContraFlows(
          payIn,
          payOut,
          entityVouchers
        );
        const summary = {
            sales: entityVouchers.filter(v => v.type === 'sale').reduce((sum, v) => sum + (v.total || 0), 0),
            purchases: entityVouchers.filter(v => v.type === 'purchase').reduce((sum, v) => sum + (v.total || 0), 0),
            moneyIn: moneyInMerged,
            moneyOut: moneyOutMerged,
        }
        
        const generateChartData = (type: 'sale' | 'purchase' | 'payment_in' | 'payment_out') => {
            let cumulative = 0;
            return entityVouchers.map(v => {
                if (v.type === type) {
                    cumulative += v.total || v.amount || 0;
                }
                return { date: v.date.toDate(), value: cumulative };
            });
        };

        const charts = {
            balance: entityVouchers.map(t => ({ date: t.date.toDate(), value: t.balance })),
            sales: generateChartData('sale'),
            purchases: generateChartData('purchase'),
            moneyIn: generateChartData('payment_in'),
            moneyOut: generateChartData('payment_out'),
        };

        return { summaryData: summary, chartData: charts };
    }, [processedTransactions, activeEntity]);

    // Only recompute when numeric data changes; stable so cards don't re-render on unrelated state (e.g. userNames)
    const summaryCards = useMemo(() => [
        { title: "Balance", amount: closingBalance, color: closingBalance >= 0 ? "text-green-600" : "text-red-600" },
        { title: "Sales", amount: summaryData.sales, color: "text-green-600" },
        { title: "Purchases", amount: summaryData.purchases, color: "text-red-600" },
        { title: "Money In", amount: summaryData.moneyIn, color: "text-green-600" },
        { title: "Money Out", amount: summaryData.moneyOut, color: "text-red-600" },
    ], [closingBalance, summaryData.sales, summaryData.purchases, summaryData.moneyIn, summaryData.moneyOut]);
    const mobileSummaryCards = useMemo(() => insertReportCardsAfterNetBalance([
      ...summaryCards.map((card) => card.title === "Balance" ? { ...card, amount: allTimeNetBalance, color: allTimeNetBalance >= 0 ? "text-green-600" : "text-red-600" } : card),
      ...buildReportVoucherTypeCards(processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "party" : undefined, summaryCards.map((card) => card.title)),
    ], buildPartyTdsReportSummaryCards(partyTdsBalanceSummary)), [summaryCards, processedTransactions, activeContext, activeEntity?.id, allTimeNetBalance, partyTdsBalanceSummary]);
    const clickableSummaryCards = useMemo(
      () => makeMobileReportSummaryCards(mobileSummaryCards, balanceCardFilter, setBalanceCardFilter, processedTransactions, activeContext, activeEntity?.id, activeContext === "group" ? "party" : undefined),
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

        const isBillWise = balanceMode === "bill_wise";
        const baseTitle = `${selectedParty ? "Party" : "Group"} Statement: ${activeEntity.name}`;
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
                },
                title: isBillWise ? `Bill Wise ${baseTitle}` : baseTitle,
                context: activeContext,
                contextId: activeEntity.id,
                dateSystem: dateSystem,
                dateRangeText,
                vouchersCount: processedTransactions.length,
                openingBalance: openingBalanceForPeriod,
                transactions: processedTransactions.map((t: any) => ({ ...t, dueDate: t.dueDate ?? t.due_date })),
                showNarration: true,
                visibleColumns: isBillWise ? { status: true } : undefined,
                billWise: isBillWise,
                ...(isBillWise && {
                    openingBalanceOutstanding,
                    openingBalanceLinkedVoucherNos,
                    vouchers,
                }),
            },
            true
        );
    };
    
    const handleExcel = () => {
        if (!activeEntity) return;
    
        const dataForExport = processedTransactions.map(t => {
            const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
            return {
                "Date (BS)": formatDateBS(d),
                "Date (AD)": formatDate(d),
                "Voucher No.": t.voucherNumber,
                "Type": voucherTypeDisplayText(t.type),
                "Narration": t.narration || "",
                "Debit": t.debit,
                "Credit": t.credit,
                "Balance": `${Math.abs(t.balance).toFixed(2)} ${t.balance >= 0 ? 'Dr' : 'Cr'}`
            };
        });

        // Add summary rows
        const summaryRows = [
            { "Date (BS)": "Opening Balance", "Balance": `${Math.abs(openingBalanceForPeriod).toFixed(2)} ${openingBalanceForPeriod >= 0 ? 'Dr' : 'Cr'}` },
            { "Date (BS)": "Total", "Debit": periodDr, "Credit": periodCr },
            { "Date (BS)": "Closing Balance", "Balance": `${Math.abs(closingBalance).toFixed(2)} ${closingBalance >= 0 ? 'Dr' : 'Cr'}` }
        ];

        const finalData = [...dataForExport, {}, ...summaryRows];

        const worksheet = XLSX.utils.json_to_sheet(finalData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Party Statement");
    
        XLSX.writeFile(workbook, `${activeEntity.name}_statement.xlsx`);
    };
    

    const dateRangeLabel = useMemo(() => {
        // Party Details mobile row-2 uses the default last-10 transaction window label.
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

    // Party dropdown: report-only (Opening Balance, Owner's Capital) excluded; keep current if selected via URL
    const partyReportOptions = useMemo(() => {
        const options = processedPartiesForSelection.map((p) => ({ value: p.id, label: p.name }));
        if (selectedParty?.id && !options.some((o) => o.value === selectedParty.id)) {
            options.push({ value: selectedParty.id, label: selectedParty.name || selectedParty.id });
        }
        return options;
    }, [processedPartiesForSelection, selectedParty?.id, selectedParty?.name]);

    // Group dropdown: hide Assets, Equity, Expenses, Income, Liabilities (same as Group Details)
    const groupReportOptions = useMemo(() => {
        const exclude = ["assets", "equity", "expenses", "income", "liabilities", "liability"];
        const currentId = selectedGroup?.id;
        return processedGroups
            .filter((g) => g.id === currentId || !exclude.includes((g.name || "").trim().toLowerCase()))
            .map((g) => ({ value: g.id, label: g.name }));
    }, [processedGroups, selectedGroup?.id]);

    const partiesForReportList = useMemo(() => {
        const list = [...processedPartiesForSelection];
        if (selectedParty?.id && !list.some((p) => p.id === selectedParty.id)) {
            list.push(selectedParty);
        }
        return list;
    }, [processedPartiesForSelection, selectedParty]);

    const groupsForReportList = useMemo(() => {
        const exclude = ["assets", "equity", "expenses", "income", "liabilities", "liability"];
        const currentId = selectedGroup?.id;
        return processedGroups.filter(
            (g) => g.id === currentId || !exclude.includes((g.name || "").trim().toLowerCase())
        );
    }, [processedGroups, selectedGroup?.id]);

    /* ---- Main Parties page parity: pending-approval badge, IC / Ac tab, total balance ---- */
    const showApproveOnList =
        can("approve_transactions") &&
        effectiveNotificationSettings?.approve?.on !== false &&
        effectiveNotificationSettings?.approve?.onList !== false;
    const pendingApprovalByPartyId = useMemo(() => {
        if (!showApproveOnList || !vouchers?.length || !processedParties?.length) return {} as Record<string, number>;
        const partyIdSet = new Set(processedParties.map((p: Party) => p.id));
        const map: Record<string, number> = {};
        vouchers.forEach((v: any) => {
            collectPartyIdsTouchedByUnapprovedVoucher(v, partyIdSet).forEach((id) => {
                map[id] = (map[id] || 0) + 1;
            });
        });
        return map;
    }, [vouchers, showApproveOnList, processedParties]);
    const pendingApprovalByGroupId = useMemo(() => {
        if (!showApproveOnList || !processedParties?.length) return {} as Record<string, number>;
        const byGroup: Record<string, number> = {};
        processedParties.forEach((p: Party) => {
            const n = pendingApprovalByPartyId[p.id] || 0;
            if (!n) return;
            const gid = isInterCompanyPartyListAccount(p) ? IC_COMPANY_PARTY_GROUP_ID : resolvePartyListGroupBucketId(p);
            byGroup[gid] = (byGroup[gid] || 0) + n;
        });
        return byGroup;
    }, [processedParties, showApproveOnList, pendingApprovalByPartyId]);
    const totalPendingApprovalVoucherCount = useMemo(() => {
        if (!showApproveOnList || !vouchers?.length || !processedParties?.length) return 0;
        const partyIdSet = new Set(processedParties.map((p: Party) => p.id));
        let n = 0;
        for (const v of vouchers as any[]) {
            if (v?.isApproved === true) continue;
            if (collectPartyIdsTouchedByUnapprovedVoucher(v, partyIdSet).size > 0) n += 1;
        }
        return n;
    }, [vouchers, showApproveOnList, processedParties]);
    const {
        showOnlyEntities: showOnlyPartiesWithPendingApproval,
        setShowOnlyEntities: setShowOnlyPartiesWithPendingApproval,
        showOnlyGroups: showOnlyPartyGroupsWithPendingApproval,
        setShowOnlyGroups: setShowOnlyPartyGroupsWithPendingApproval,
    } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
    const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
    const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

    const partiesForReportListView = useMemo(() => {
        const base =
            showOnlyPartiesWithPendingApproval && showApproveOnList
                ? partiesForReportList.filter((p) => (pendingApprovalByPartyId[p.id] ?? 0) > 0 || p.id === selectedParty?.id)
                : partiesForReportList;
        const regular = base.filter((p) => !isInterCompanyPartyListAccount(p));
        const icFlat = dedupeInterCompanyClearingParties(base.filter((p) => isInterCompanyPartyListAccount(p)));
        return [...regular, ...icFlat];
    }, [partiesForReportList, showOnlyPartiesWithPendingApproval, showApproveOnList, pendingApprovalByPartyId, selectedParty?.id]);
    const groupsForReportListView = useMemo(() => {
        if (!showOnlyPartyGroupsWithPendingApproval || !showApproveOnList) return groupsForReportList;
        return groupsForReportList.filter((g) => (pendingApprovalByGroupId[g.id] ?? 0) > 0 || g.id === selectedGroup?.id);
    }, [groupsForReportList, showOnlyPartyGroupsWithPendingApproval, showApproveOnList, pendingApprovalByGroupId, selectedGroup?.id]);
    const icListRowsForReport = useMemo(() => {
        let ic = dedupeInterCompanyClearingParties(
            processedPartiesForSelection.filter((p) => isInterCompanyPartyListAccount(p))
        );
        if (showOnlyPartiesWithPendingApproval && showApproveOnList) {
            ic = ic.filter((p) => (pendingApprovalByPartyId[p.id] ?? 0) > 0);
        }
        return buildIcPeerCompanyGroupRows(ic);
    }, [processedPartiesForSelection, showOnlyPartiesWithPendingApproval, showApproveOnList, pendingApprovalByPartyId]);
    const reportListTotalBalance = useMemo(() => {
        if (listTab === "parties") {
            return partiesForReportListView
                .filter((p) => !(p as any).isSystemAccount)
                .reduce((acc, p) => acc + (Number(p.balance) || 0), 0);
        }
        if (listTab === "ic_ac") {
            return (icListRowsForReport || []).reduce((acc, p: any) => acc + (Number(p.balance) || 0), 0);
        }
        return processedGroups.reduce((acc, g) => acc + (Number(g.balance) || 0), 0);
    }, [listTab, partiesForReportListView, icListRowsForReport, processedGroups]);

    const handleEmbeddedPartyChange = useCallback((partyId: string) => {
        setShowReportOverdue(false);
        const party =
            processedPartiesForSelection.find((p) => p.id === partyId) ||
            processedParties.find((p) => p.id === partyId);
        if (!party) return;
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("partyId", party.id);
        newUrl.searchParams.delete("groupId");
        window.history.pushState({}, "", newUrl);
        setSelectedParty(party);
        setSelectedGroup(null);
        setListTab("parties");
    }, [processedParties, processedPartiesForSelection]);

    const handleSelectPartyFromList = useCallback(
        (party: Party) => {
            handleEmbeddedPartyChange(party.id);
        },
        [handleEmbeddedPartyChange]
    );

    const handleSelectGroupFromList = useCallback((group: Group) => {
        setShowReportOverdue(false);
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("groupId", group.id);
        newUrl.searchParams.delete("partyId");
        window.history.pushState({}, "", newUrl);
        setSelectedGroup(group);
        setSelectedParty(null);
        setListTab("groups");
    }, []);

    const handleSelectIcFromList = useCallback(
        (party: Party, options?: PartyListSelectOptions) => {
            setShowReportOverdue(false);
            const memberId = options?.icMemberAccountId || party.id;
            const real =
                processedPartiesForSelection.find((p) => p.id === memberId) ||
                processedParties.find((p) => p.id === memberId);
            const target = real ?? party;
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set("partyId", target.id);
            newUrl.searchParams.delete("groupId");
            window.history.pushState({}, "", newUrl);
            setSelectedParty(target);
            setSelectedGroup(null);
        },
        [processedParties, processedPartiesForSelection]
    );

    const groupMemberParties = processedParties;

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

    const findOverdueVoucher = (row: OverdueTransactionRow) => {
        const src = ((vouchersAll?.length ? vouchersAll : vouchers) || []) as any[];
        return src.find((v) => v.id === row.id);
    };
    const overduePartyById = (id?: string | null) =>
        id ? (processedParties || []).find((p) => p.id === id) : undefined;

    /** Parties page Overdue view jaisa: History + Link dialogs. */
    const overdueActionDialogs = (
        <>
            <HistoryDialog
                voucher={overdueHistoryVoucher}
                isOpen={!!overdueHistoryVoucher}
                onOpenChange={(open) => !open && setOverdueHistoryVoucher(null)}
                onHistoryReset={() => setOverdueHistoryVoucher((prev: any) => (prev ? { ...prev, history: [] } : null))}
            />
            {overdueLinkAdvancesVoucher && (
                <LinkAdvancesToVoucherDialog
                    isOpen={!!overdueLinkAdvancesVoucher}
                    onOpenChange={(open) => !open && setOverdueLinkAdvancesVoucher(null)}
                    mode={overdueLinkAdvancesVoucher.type === "purchase" || overdueLinkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
                    targetVoucherId={overdueLinkAdvancesVoucher.id}
                    targetPartyId={overdueLinkAdvancesVoucher.partyId ?? ""}
                    targetPartyName={overduePartyById(overdueLinkAdvancesVoucher.partyId)?.name ?? "Party"}
                    partyOpeningBalance={overduePartyById(overdueLinkAdvancesVoucher.partyId)?.openingBalance ?? 0}
                    balanceKind="all"
                    onDone={() => setOverdueLinkAdvancesVoucher(null)}
                />
            )}
            {overdueLinkPaymentVoucher && (
                <LinkPaymentToTxnsDialog
                    isOpen={!!overdueLinkPaymentVoucher}
                    onOpenChange={(open) => !open && setOverdueLinkPaymentVoucher(null)}
                    variant={overdueLinkPaymentVoucher.type === "payment_out" || overdueLinkPaymentVoucher.type === "direct_expense" ? "payment_out" : "payment_in"}
                    partyId={overdueLinkPaymentVoucher.partyId ?? null}
                    partyName={overduePartyById(overdueLinkPaymentVoucher.partyId)?.name ?? "Party"}
                    receivedAmount={Number(overdueLinkPaymentVoucher.amount ?? overdueLinkPaymentVoucher.total ?? 0)}
                    existingAllocations={Array.isArray(overdueLinkPaymentVoucher.allocations) ? overdueLinkPaymentVoucher.allocations : []}
                    paymentInId={["payment_in", "direct_income"].includes(overdueLinkPaymentVoucher.type) ? overdueLinkPaymentVoucher.id : undefined}
                    paymentOutId={["payment_out", "direct_expense"].includes(overdueLinkPaymentVoucher.type) ? overdueLinkPaymentVoucher.id : undefined}
                    paymentInVoucherNumber={["payment_in", "direct_income"].includes(overdueLinkPaymentVoucher.type) ? overdueLinkPaymentVoucher.voucherNumber : undefined}
                    paymentInDate={["payment_in", "direct_income"].includes(overdueLinkPaymentVoucher.type) ? overdueLinkPaymentVoucher.date : undefined}
                    paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(overdueLinkPaymentVoucher.type) ? overdueLinkPaymentVoucher.voucherNumber : undefined}
                    paymentOutDate={["payment_out", "direct_expense"].includes(overdueLinkPaymentVoucher.type) ? overdueLinkPaymentVoucher.date : undefined}
                    partyOpeningBalance={overduePartyById(overdueLinkPaymentVoucher.partyId)?.openingBalance ?? 0}
                    onDone={async (allocations, _amount) => {
                        const cid = (company as any)?.id;
                        if (!cid || !overdueLinkPaymentVoucher?.id) return;
                        const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
                        const result = await runWithVoucherLinkSaveProgress(async () => {
                            await applyPaymentBillWiseLinkAllocations(cid, overdueLinkPaymentVoucher, allocations);
                            setOverdueLinkPaymentVoucher(null);
                        }, { successTitle: "Allocations updated" });
                        if (!result.ok) {
                            toast.error(result.error instanceof Error ? result.error.message : "Failed to update allocations.");
                        }
                    }}
                />
            )}
        </>
    );

    if (loading && !activeEntity) {
        return <LoadingSpinner />;
    }

    /** PC: party page jaisa — Parties/Groups tabs + account list + ledger detail. */
    const mobileEntityTxnToolbar = (
      <MobileEntityTxnToolbarRow placement="belowPager">
        <MobileEntityTxnToolbarPicker>
          <Combobox
            options={selectedGroup ? groupReportOptions : partyReportOptions}
            value={selectedGroup ? selectedGroup.id : (selectedParty?.id || "")}
            onChange={(value) => {
              if (selectedGroup) {
                const group = processedGroups.find(g => g.id === value);
                if (group) {
                  const newUrl = new URL(window.location.href);
                  newUrl.searchParams.set('groupId', group.id);
                  newUrl.searchParams.delete('partyId');
                  window.history.pushState({}, '', newUrl);
                  setSelectedGroup(group);
                  setSelectedParty(null);
                }
              } else {
                const party = processedParties.find(p => p.id === value);
                if (party) {
                  const newUrl = new URL(window.location.href);
                  newUrl.searchParams.set('partyId', party.id);
                  newUrl.searchParams.delete('groupId');
                  window.history.pushState({}, '', newUrl);
                  setSelectedParty(party);
                  setSelectedGroup(null);
                }
              }
            }}
            placeholder={selectedGroup ? "Select a group" : "Select a party"}
          />
        </MobileEntityTxnToolbarPicker>
        <MobileEntityTxnToolbarUnapprovedBadge
          count={mobileUnapprovedTxnCount}
          pressed={unapprovedOnly}
          onToggle={() => {
            setUnapprovedOnly((prev) => !prev);
            setPartyReportPagerPage(1);
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
              setPartyReportPagerPage(1);
            }}
          />
        </MobileEntityTxnToolbarSearch>
      </MobileEntityTxnToolbarRow>
    );

    if (!isMobile || reportMobileList.showList || showReportOverdue) {
        const reportListTabs = (
            <Tabs
                value={listTab}
                onValueChange={(value) => setListTab(value === "groups" ? "groups" : value === "ic_ac" ? "ic_ac" : "parties")}
                className="w-full"
            >
                <TabsList listChrome>
                    <TabsTrigger listChrome value="parties" className="flex-1">
                        Parties
                    </TabsTrigger>
                    <TabsTrigger listChrome value="groups" className="flex-1">
                        Groups
                    </TabsTrigger>
                    <TabsTrigger listChrome value="ic_ac" className="flex-1">
                        IC / Ac
                    </TabsTrigger>
                </TabsList>
            </Tabs>
        );

        const reportSearchRow = (
            <div className={mlc.searchRow}>
                <div className={mlc.searchWrap}>
                    <Search className={mlc.searchIcon} />
                    <Input
                        placeholder={listTab === "parties" ? "Search parties..." : listTab === "ic_ac" ? "Search companies..." : "Search groups/party"}
                        listChrome
                        listChromeSearch
                        value={listSearchTerm}
                        onChange={(e) => setListSearchTerm(e.target.value)}
                        autoComplete="off"
                    />
                </div>
                {(listTab === "parties" || listTab === "ic_ac") && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
                    <PendingApprovalListFilterBadge
                        compact
                        count={totalPendingApprovalVoucherCount}
                        pressed={showOnlyPartiesWithPendingApproval}
                        onToggle={() => setShowOnlyPartiesWithPendingApproval((v) => !v)}
                        tooltipFilterHint={`Only parties with pending approval - ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
                        tooltipShowAllHint="Show all parties (click)"
                        ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
                        ariaLabelShowAll="Show all parties"
                    />
                ) : null}
                {listTab === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
                    <PendingApprovalListFilterBadge
                        compact
                        count={totalPendingApprovalVoucherCount}
                        pressed={showOnlyPartyGroupsWithPendingApproval}
                        onToggle={() => setShowOnlyPartyGroupsWithPendingApproval((v) => !v)}
                        tooltipFilterHint={`Only groups with pending approval - ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
                        tooltipShowAllHint="Show all groups (click)"
                        ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
                        ariaLabelShowAll="Show all groups"
                    />
                ) : null}
                {listTab === "parties" ? (
                    <CreatePartyDialog onPartyCreated={() => {}} isOpen={isCreatePartyOpen} onOpenChange={setIsCreatePartyOpen}>
                        <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreatePartyOpen(true)}>
                            + Add Party
                        </PermissionButton>
                    </CreatePartyDialog>
                ) : listTab === "groups" ? (
                    <CreateGroupDialog onGroupCreated={() => {}} groups={processedGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
                        <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
                            + Add Group
                        </PermissionButton>
                    </CreateGroupDialog>
                ) : null}
            </div>
        );

        const reportSectionLabel =
            listTab === "parties" ? (
                <div className={cn(mlc.sectionLabelRow, "justify-between")}>
                    <div className="flex items-center gap-2">
                        <User className={mlc.sectionIcon} />
                        <span>Party ({partiesForReportListView.filter((p) => !(p as any).isSystemAccount).length})</span>
                    </div>
                    {hasOverdueTransactions && (overdueTransactions?.length ?? 0) > 0 ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-[35px] max-h-[35px] self-center px-2 text-xs font-medium border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
                            onClick={() => setShowReportOverdue(true)}
                        >
                            <AlertCircle className="h-3.5 w-3 mr-1 shrink-0" />
                            Overdue Vouchers ({overdueTransactions.length})
                        </Button>
                    ) : null}
                </div>
            ) : listTab === "ic_ac" ? (
                <div className={mlc.sectionLabelRow}>
                    <User className={mlc.sectionIcon} />
                    <span>IC / Ac ({icListRowsForReport.length})</span>
                </div>
            ) : (
                <div className={mlc.sectionLabelRow}>
                    <Users className={mlc.sectionIcon} />
                    <span>Party group ({groupsForReportListView.length})</span>
                </div>
            );

        /** Search row jaisa vertical inset — cards/tabs dono par same band chrome. */
        const reportListBandChrome = cn(mlc.searchRow, "box-border !gap-0");

        const reportListTabsRow = <div className={reportListBandChrome}>{reportListTabs}</div>;

        const reportListView = (
            <MasterListViewShell
                isMobile={isMobile}
                tabs={isMobile ? reportListTabs : undefined}
                searchRow={reportSearchRow}
                sectionLabel={reportSectionLabel}
                quickFilter={listTab === "groups" ? groupListQuickFilter : partyListQuickFilter}
                onQuickFilterChange={listTab === "groups" ? setGroupListQuickFilter : setPartyListQuickFilter}
            >
                <div className="relative h-full min-h-0 w-full overflow-hidden">
                    <div
                        className={cn(
                            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
                            listTab !== "parties" && "pointer-events-none hidden"
                        )}
                        aria-hidden={listTab !== "parties"}
                    >
                        <PartyList
                            parties={partiesForReportListView}
                            onSelectParty={handleSelectPartyFromList}
                            selectedParty={selectedParty}
                            searchTerm={listSearchTerm}
                            pendingApprovalByPartyId={pendingApprovalByPartyId}
                            quickFilter={partyListQuickFilter}
                            onQuickFilterChange={setPartyListQuickFilter}
                            hideQuickFilterBar
                        />
                    </div>
                    <div
                        className={cn(
                            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
                            listTab !== "groups" && "pointer-events-none hidden"
                        )}
                        aria-hidden={listTab !== "groups"}
                    >
                        <PartyGroupList
                            groups={groupsForReportListView}
                            onSelectGroup={handleSelectGroupFromList}
                            selectedGroup={selectedGroup}
                            searchTerm={listSearchTerm}
                            pendingApprovalByGroupId={pendingApprovalByGroupId}
                            pendingApprovalByPartyId={pendingApprovalByPartyId}
                            collapsible={false}
                            quickFilter={groupListQuickFilter}
                            onQuickFilterChange={setGroupListQuickFilter}
                            hideQuickFilterBar
                            hideCategoryHeaders
                        />
                    </div>
                    <div
                        className={cn(
                            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
                            listTab !== "ic_ac" && "pointer-events-none hidden"
                        )}
                        aria-hidden={listTab !== "ic_ac"}
                    >
                        <PartyList
                            parties={icListRowsForReport}
                            onSelectParty={handleSelectIcFromList}
                            selectedParty={selectedParty}
                            searchTerm={listSearchTerm}
                            pendingApprovalByPartyId={pendingApprovalByPartyId}
                            quickFilter={partyListQuickFilter}
                            onQuickFilterChange={setPartyListQuickFilter}
                            hideQuickFilterBar
                        />
                    </div>
                </div>
            </MasterListViewShell>
        );

        const reportOverdueView = (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-hidden">
                    <OverdueAccountView
                        overdueTransactions={(overdueTransactions || []) as OverdueTransactionRow[]}
                        userNames={userNames}
                        onEditVoucher={(row: OverdueTransactionRow) => {
                            const voucher = findOverdueVoucher(row);
                            if (voucher) handleEditVoucher(voucher);
                        }}
                        onHistoryVoucher={(row: OverdueTransactionRow) => {
                            const voucher = findOverdueVoucher(row);
                            if (voucher) setOverdueHistoryVoucher(voucher);
                        }}
                        onAddLink={(row: OverdueTransactionRow) => {
                            const voucher = findOverdueVoucher(row);
                            if (!voucher) return;
                            const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
                            if (isPaymentType) setOverdueLinkPaymentVoucher(voucher);
                            else setOverdueLinkAdvancesVoucher(voucher);
                        }}
                    />
                </div>
            </div>
        );

        const reportDetailView = showReportOverdue ? reportOverdueView : selectedParty ? (
            <PartyDetails
                party={selectedParty}
                allParties={processedParties}
                transactions={processedTransactions}
                onPartyUpdated={() => {}}
                onPartyDeleted={() => setSelectedParty(null)}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                userNames={userNames}
                journalAccountNames={journalAccountNames}
                context="report"
                reportCardFilter={balanceCardFilter}
                reportSummaryCards={clickableSummaryCards}
                onEmbeddedPartyChange={handleEmbeddedPartyChange}
            />
        ) : selectedGroup ? (
            <GroupDetails
                group={selectedGroup}
                allGroups={processedGroups}
                allParties={groupMemberParties}
                onGroupUpdated={() => {}}
                onGroupDeleted={() => setSelectedGroup(null)}
                onPartyUpdated={() => {}}
                reportSummaryCards={clickableSummaryCards}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                userNames={userNames}
            />
        ) : (
            <div className="flex h-full flex-col items-center justify-center bg-muted/20">
                <p className="text-sm text-muted-foreground">Select a party or group</p>
            </div>
        );




    return (
            <>
                <ResponsiveMasterDetail
                    listChromeRouteKey="party"
                    title={pageTitle}
                    balance={
                        <span className={cn("font-semibold", reportListTotalBalance >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(reportListTotalBalance, { showDrCr: true })}
                        </span>
                    }
                    listHeaderLeading={<ReportShowListButton />}
                    tabsRowClassName="!min-h-0 !border-b-0 !p-0"
                    tabs={isMobile ? undefined : reportListTabsRow}
                    listView={reportListView}
                    detailView={
                      <ReportLedgerTxnDetailPane>{reportDetailView}</ReportLedgerTxnDetailPane>
                    }
                    isMobile={isMobile}
                    mobileListOnly={isMobile}
                    mobileTabsDocked={isMobile}
                    hasSelectedItem={isMobile && showReportOverdue}
                    onBackToList={() => setShowReportOverdue(false)}
                />
                {addVoucherDialog}
                {overdueActionDialogs}
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
          <ReportStatementHeaderAvatar
            kind={selectedParty ? "party" : "group"}
            displayName={activeEntity.name}
            fileUrl={selectedParty?.fileUrl}
            isSystemEntity={Boolean(
              selectedParty && (selectedParty as Party & { isSystemAccount?: boolean }).isSystemAccount
            )}
          />
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
                        {(dateSystem === 'BS' || dateSystem === 'Both') && (
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
                        {(dateSystem === 'AD' || dateSystem === 'Both') && (
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
                        <DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            {/* Mobile: no pb-20 so scroll extends to footer; inner pb-24 so last row clears fixed footer */}
            <main className={cn("flex-1 flex flex-col min-h-0 px-4 pt-0.5", !isMobile && "pb-20")}>
                 {view === 'chart' ? (
                     <div className="-mx-4 w-[calc(100%+2rem)] max-w-none flex-shrink-0">
                         <RunningBalanceFullChart transactions={reportDisplayTransactions} openingBalance={openingBalanceForPeriod} />
                     </div>
                 ) : (
                    <>
                        <MobileDetailSummaryCollapsible className="w-[calc(100%+2rem)] min-w-0 -mx-4">
                        <div key={activeEntity?.id ?? "no-entity"} ref={balanceCardsRowRef} data-pl-mobile-txn-balance-row="" data-pl-bank-report-balance-row="" className="box-border flex w-full min-w-0 flex-nowrap justify-start gap-2 px-2 pt-0.5 pb-3 overflow-x-auto scrollbar-slim-dim flex-shrink-0">
                        <ReportStatementSummaryCardsRow cards={clickableSummaryCards} className="w-max min-w-0 flex-shrink-0 pt-0.5 pb-0 overflow-visible" />
                        </div>
                        </MobileDetailSummaryCollapsible>

                        <div className="flex flex-1 min-h-0 flex-col -mx-4 md:mx-0">
                        <div className="flex-1 min-h-0 overflow-y-auto px-0.5 md:px-0 pl-mobile-ledger-txn-scroll-pad" data-floating-button-scroll>
                            {isMobile ? (
                                <div className="pb-4">
                                    <TransactionsTable
                                        transactions={partyStatementMobilePaging.pageTransactions}
                                        context={activeContext}
                                        contextId={activeEntity?.id}
                                        openingBalance={partyStatementMobilePaging.openingForPage}
                                        booksOpeningBalance={balanceCardFilter ? undefined : (activeEntity as any)?.openingBalance != null ? Number((activeEntity as any).openingBalance) : undefined}
                                        openingBalanceDate={(activeEntity as any)?.openingBalanceDate}
                                        ledgerDateFilterActive={hasDateFilter || !!balanceCardFilter}
                                        ledgerShowBookOpeningRow={!balanceCardFilter && !tdsFilterSide && (partyReportRowsPerPage <= 0 || partyStatementMobilePaging.edges.before === 0)}
                                        hideLedgerOpeningRows={!!tdsFilterSide}
                                        ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                                        fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                                        openingBalancePeriodStartDate={partyStatementMobilePaging.openingPeriodStartDate ?? dateRange?.from}
                                        dateRange={dateRange}
                                        openingBalanceOutstanding={openingBalanceOutstanding}
                                        openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
                                        userNames={userNames}
                                        journalAccountNames={journalAccountNames}
                                        onRowClick={handleEditVoucher}
                                        openingBalanceLabel="Opening"
                                        forceBalanceMode={tdsFilterSide ? "statement" : balanceMode === "bill_wise" ? "bill_wise" : "statement"}
                                        groupEntityType={activeContext === "group" ? "party" : undefined}
                                        visibleColumns={tdsFilterSide ? mergeLedgerTdsVisibleColumnsWithPrefs({}, false) : balanceMode === "bill_wise" ? { status: true } : undefined}
                                        periodDr={partyStatementMobilePaging.periodDrForPage}
                                        periodCr={partyStatementMobilePaging.periodCrForPage}
                                        closingBalance={partyStatementMobilePaging.closingForPage}

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
                                    ledgerShowBookOpeningRow={!balanceCardFilter && !tdsFilterSide}
                                    hideLedgerOpeningRows={!!tdsFilterSide}
                                    ledgerTransactionsForFyOpening={balanceCardFilter ? filteredReportTransactions : undefined}
                                    fyLedgerScopeOpeningBalance={balanceCardFilter ? effectiveOpeningBalanceForPeriod : undefined}
                                    periodDr={effectivePeriodDr}
                                    periodCr={effectivePeriodCr}
                                    closingBalance={effectiveClosingBalance}
                                    openingBalancePeriodStartDate={dateRange?.from}
                                    dateRange={dateRange}
                                    openingBalanceOutstanding={openingBalanceOutstanding}
                                    openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
                                    userNames={userNames}
                                    journalAccountNames={journalAccountNames}
                                    onRowClick={handleEditVoucher}
                                    openingBalanceLabel="Opening"
                                    forceBalanceMode={tdsFilterSide ? "statement" : balanceMode === "bill_wise" ? "bill_wise" : "statement"}
                                    groupEntityType={activeContext === "group" ? "party" : undefined}
                                    visibleColumns={tdsFilterSide ? mergeLedgerTdsVisibleColumnsWithPrefs({}, false) : balanceMode === "bill_wise" ? { status: true } : undefined}
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
                                    currentPage={partyReportPagerPage}
                                    totalItems={filteredReportTransactions.length}
                                    rowsPerPage={partyReportRowsPerPage}
                                    onPageChange={setPartyReportPagerPage}
                                    onRowsPerPageChange={(n) => {
                                        setPartyReportRowsPerPage(n);
                                        setPartyReportPagerPage(1);
                                    }}
                                    edgeCounts={
                                        partyStatementMobilePaging.edges.before > 0 ||
                                        partyStatementMobilePaging.edges.after > 0
                                          ? partyStatementMobilePaging.edges
                                          : undefined
                                    }
                                />
                            )}
                        </div>
                    </>
                 )}
            </main>

            <footer className="flex items-stretch justify-around p-1.5 border-t bg-white gap-1 fixed bottom-0 left-0 right-0" data-pl-mobile-ledger-action-footer="">
                <PermissionButton permission="export_data" className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-green-500 hover:bg-green-600 text-white rounded-md" onClick={handlePrint}>
                    <Printer className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Print</span>
                </PermissionButton>
                <PermissionButton permission="export_data" className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md" onClick={handleExcel}>
                    <File className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Excel</span>
                </PermissionButton>
                {/* Bill wise / Statement: same UX as Party Details & Bank Statement/Spend wise toggle position */}
                <Button
                    type="button"
                    className={cn(
                        "flex-1 flex flex-col items-center justify-center py-1 min-w-0 rounded-md text-white",
                        balanceMode === "bill_wise" ? "bg-orange-500 hover:bg-orange-600" : "bg-violet-500 hover:bg-violet-600"
                    )}
                    onClick={() => setBalanceMode(balanceMode === "bill_wise" ? "statement" : "bill_wise")}
                >
                    <span className="text-[10px] leading-tight text-center px-0.5">{balanceMode === "bill_wise" ? "Statement" : "Bill wise"}</span>
                </Button>
                <Button className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-slate-500 hover:bg-slate-600 text-white rounded-md" onClick={() => { openingModalRef.current = true; setIsCalendarOpen(true); openModalInUrl(); }}>
                    <CalendarIcon className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Date</span>
                </Button>
                <Button className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-violet-500 hover:bg-violet-600 text-white rounded-md" onClick={() => setView(v => v === 'list' ? 'chart' : 'list')}>
                    <BarChart2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Chart</span>
                </Button>
            </footer>
            {addVoucherDialog}
        </div>
    );
}
