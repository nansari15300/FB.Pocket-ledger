

"use client";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useCompany } from "@/hooks/useCompany";
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Info, X, Calendar as CalendarIcon, Expand, Filter, RotateCw, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DaybookTxnScrollColumn } from "@/components/reports/DaybookTxnScrollColumn";
import { DAYBOOK_SHIFT_DATE_EVENT } from "@/components/dashboard/DashboardWelcomeFooterBanner";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import type { Account } from "@/components/bank-cash/types";
import type { DateRange } from "@/components/ui/ad-calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startOfDay, endOfDay, isSameDay, addDays, subDays } from "date-fns";
import { DASHBOARD_EMBEDDED_DAYBOOK_VOUCHER_LOOKBACK_DAYS } from "@/lib/dashboardTabPanels";
import { listVouchersFromBrowserDbByDateRange } from "@/lib/fyPagination/voucherQueries";
import { buildDaybookDailySummary } from "@/lib/accountLedgerDaySummary";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AdCalendar from "@/components/ui/ad-calendar";
import { collectVoucherCalendarDates } from "@/lib/voucherDateNormalize";
import { useDate } from "@/hooks/useDate";
import { useCalendarMonths } from "@/hooks/use-mobile";
import usePermissions from "@/hooks/usePermissions";
import { Checkbox } from "@/components/ui/checkbox";
import { applyPaymentBillWiseLinkAllocations } from "@/lib/voucherActionsClient";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { useInterCompanyLedgerChangeDetectDialog } from "@/hooks/useInterCompanyLedgerChangeDetectDialog";
import { HistoryDialog } from "../vouchers/HistoryDialog";
import { LinkAdvancesToVoucherDialog } from "../vouchers/LinkAdvancesToVoucherDialog";
import { LinkPaymentToTxnsDialog } from "../vouchers/LinkPaymentToTxnsDialog";
import { VoucherTypeFilter } from "../vouchers/VoucherTypeFilter";
import { Badge } from "@/components/ui/badge";
import { Input } from "../ui/input";
import { TransactionsTable } from "../vouchers/TransactionsTable";
import { NarrationNoteSearchInput } from "../vouchers/NarrationNoteSearchInput";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useTransactions } from "@/hooks/use-transactions";
import { useServerDaybookDailySummary } from "@/hooks/useServerDaybookDailySummary";
import type { DaybookDailySummary } from "@/lib/accountLedgerDaySummary";
import {
  DaybookAccountDayPeekDialog,
  daybookSummaryAccountRowCn,
} from "@/components/reports/DaybookAccountDayPeekDialog";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import type { TransactionSortBy, TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import type { TransactionColumnKey } from "@/components/vouchers/TransactionsTable";
import { sortTransactions } from "@/lib/transactionSort";
import { sortRecentTransactionsDesc } from "@/lib/recentTransactionsSort";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
import { COLUMN_LABELS, useShowNotes, useTransactionVisibleColumns } from "@/components/vouchers/transactionColumnVisibility";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const daybookToolbarSelectTriggerCn = cn(
  chromeProPillCn,
  "h-9 min-h-9 max-h-9 rounded-full px-3 py-0 shadow-none focus:ring-0 focus-visible:ring-0",
);

interface DaybookReportProps {
  onFullScreenToggle?: () => void;
  /** Dashboard keep-alive: intro/swipe jab panel visible ho tab hi (default: always visible). */
  isPanelVisible?: boolean;
  /** Dashboard footer ribbon: desktop ←/→ yahan; toolbar/bottom strip hide. */
  welcomeRibbonDateNav?: boolean;
  /** Dashboard Daybook tab (not full /reports route). */
  dashboardEmbedded?: boolean;
  /** Desktop dashboard: element under the Welcome row where the pagination footer is portaled (Recent parity). */
  footerPortalTarget?: HTMLElement | null;
}

function voucherToJsDate(raw: unknown): Date | null {
  if (!raw) return null;
  try {
    const d = raw as { toDate?: () => Date };
    if (typeof d.toDate === "function") return d.toDate();
    if (raw instanceof Date) return raw;
    const parsed = new Date(raw as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

export function DaybookReport({
  onFullScreenToggle,
  isPanelVisible = true,
  welcomeRibbonDateNav = false,
  dashboardEmbedded = false,
  footerPortalTarget = null,
}: DaybookReportProps) {
    const {
      vouchers,
      processedAccounts: accounts,
      processedParties,
      journalAccountNames: voucherJournalAccountNames,
      userNames: vouchersUserNames,
      fyScopeEnabled,
      fyActiveScope,
      requestFyLoadTransientRange,
      evictFyTransientRange,
    } = useFyScopedVouchers();
    const { company, companyId } = useCompany();
    const { dateSystem, formatDate, formatDateBS, formatCurrencyForPrint } = useDate();
    const { can } = usePermissions();
    const router = useRouter();
    const [daybookDate, setDaybookDate] = useState<Date | undefined>(undefined);
    const [daybookRowsPerPage, setDaybookRowsPerPage] = useState('all');
    const [daybookVoucherTypes, setDaybookVoucherTypes] = useState<string[]>(['all']);
    const [showDaybookNarration, setShowDaybookNarration] = useState(true);
    // Dashboard Daybook footer (same controls/components as Recent): columns, notes, rows per page, page, sort.
    const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
    const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
    const [footerRowsPerPage, setFooterRowsPerPage] = useRowsPerPage(50);
    const [daybookCurrentPage, setDaybookCurrentPage] = useState(1);
    const [daybookSortBy, setDaybookSortBy] = useState<TransactionSortBy>("date");
    const [daybookSortOrder, setDaybookSortOrder] = useState<TransactionSortOrder>("desc");
    const [daybookSortTouched, setDaybookSortTouched] = useState(false);
    const { selectValue: footerRowsSelectValue } = useRowsPerPageSelectControl(
        footerRowsPerPage,
        setFooterRowsPerPage,
        setDaybookCurrentPage,
        ROWS_PER_PAGE_OPTIONS_DEFAULT,
        "50"
    );
    const [daybookNarrationNoteSearch, setDaybookNarrationNoteSearch] = useState("");
    const [isVoucherDialogOpen, setIsVoucherDialogOpen] = React.useState(false);
    const [selectedVoucher, setSelectedVoucher] = React.useState<any>(null);
    const [historyVoucher, setHistoryVoucher] = React.useState<any>(null);
    const [linkAdvancesVoucher, setLinkAdvancesVoucher] = React.useState<any>(null);
    const [linkPaymentVoucher, setLinkPaymentVoucher] = React.useState<any>(null);
    const [daybookFilters, setDaybookFilters] = useState<Record<string, string>>({});
    const [activeDaybookFilter, setActiveDaybookFilter] = useState<string | null>(null);
    const [isDateChange, setIsDateChange] = useState(false);
    const [daybookRotated, setDaybookRotated] = useState(false);
    const [isDaybookCalendarOpen, setIsDaybookCalendarOpen] = useState(false);
    /** Daybook summary + table: null = sab users; warna sirf is Firebase uid ke vouchers */
    const [daybookUserFilter, setDaybookUserFilter] = useState<string | null>(null);
    const [daybookBankExpanded, setDaybookBankExpanded] = useState(false);
    const [daybookCashExpanded, setDaybookCashExpanded] = useState(false);
    const [selectedDaybookSummaryRowId, setSelectedDaybookSummaryRowId] = useState<string | null>(null);
    /** Daily Summary bank/cash list filter — transaction table par effect nahi */
    const [daybookSummaryAccountSearch, setDaybookSummaryAccountSearch] = useState("");
    /** Double-click Daily Summary account → day ledger peek */
    const [daybookAccountPeek, setDaybookAccountPeek] = useState<{
      account: Account;
      opening: number;
      in: number;
      out: number;
      closing: number;
    } | null>(null);
    const isMobile = useIsMobile();
    const calendarMonths = useCalendarMonths();
    const [showSwipeDateIntro, setShowSwipeDateIntro] = useState(false);
    const daybookSwipeStart = React.useRef<{ x: number; y: number } | null>(null);

    const handleEditVoucher = (voucher: any) => {
        setSelectedVoucher(voucher);
        setIsVoucherDialogOpen(true);
    };

    const { handleInterCompanyChangeDetectedClick, interCompanyChangeDetectDialog } =
      useInterCompanyLedgerChangeDetectDialog();

    const handleHistoryVoucher = (voucher: any) => setHistoryVoucher(voucher);
    const handleAddLink = (voucher: any) => {
        const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
        if (isPaymentType) setLinkPaymentVoucher(voucher);
        else setLinkAdvancesVoucher(voucher);
    };

    useEffect(() => {
      setDaybookDate(new Date());
    }, []);

    const shiftDaybookDateBy = useCallback((deltaDays: number) => {
        setDaybookDate((prev) => startOfDay(addDays(prev ?? new Date(), deltaDays)));
    }, []);

    useEffect(() => {
      if (isMobile) return;
      const onShift = (event: Event) => {
        const delta = (event as CustomEvent<number>).detail;
        if (delta === -1 || delta === 1) shiftDaybookDateBy(delta);
      };
      window.addEventListener(DAYBOOK_SHIFT_DATE_EVENT, onShift);
      return () => window.removeEventListener(DAYBOOK_SHIFT_DATE_EVENT, onShift);
    }, [isMobile, shiftDaybookDateBy]);

    useEffect(() => {
        if (!isMobile || !isPanelVisible) {
            setShowSwipeDateIntro(false);
            return;
        }
        setShowSwipeDateIntro(true);
        const timer = window.setTimeout(() => setShowSwipeDateIntro(false), 1500);
        return () => window.clearTimeout(timer);
    }, [isMobile, isPanelVisible]);

    const handleDaybookTouchStart = useCallback(
        (event: React.TouchEvent) => {
            if (!isMobile) return;
            const touch = event.touches[0];
            if (!touch) return;
            daybookSwipeStart.current = { x: touch.clientX, y: touch.clientY };
        },
        [isMobile]
    );

    const handleDaybookTouchEnd = useCallback(
        (event: React.TouchEvent) => {
            if (!isMobile) return;
            const start = daybookSwipeStart.current;
            daybookSwipeStart.current = null;
            const touch = event.changedTouches[0];
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
            shiftDaybookDateBy(dx < 0 ? 1 : -1);
        },
        [isMobile, shiftDaybookDateBy]
    );

    useEffect(() => {
        if (isMobile) return;
        const onKeyDown = (e: KeyboardEvent) => {
            const isMinus = e.key === "-" || e.code === "Minus" || e.code === "NumpadSubtract";
            const isEqual = e.key === "=" || e.code === "Equal";
            if (!isMinus && !isEqual) return;
            const el = e.target as HTMLElement | null;
            if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
            if (el?.closest('[role="combobox"]')) return;
            if (el?.closest('[role="dialog"]')) return;
            e.preventDefault();
            shiftDaybookDateBy(isMinus ? -1 : 1);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isMobile, shiftDaybookDateBy]);
    
    const isDaybookFilterActive = useMemo(() => {
        const isTypeFiltered = daybookVoucherTypes.length > 0 && !daybookVoucherTypes.includes('all');
        const isDateFiltered = daybookDate !== undefined && !isSameDay(daybookDate, new Date());
        const isColumnFiltered = Object.values(daybookFilters).some(v => v);
        const isUserFiltered = !!daybookUserFilter;
        return isTypeFiltered || isDateFiltered || isColumnFiltered || isUserFiltered;
    }, [daybookVoucherTypes, daybookDate, daybookFilters, daybookUserFilter]);
    
    const clearDaybookFilters = () => {
        setDaybookDate(new Date());
        setDaybookVoucherTypes(['all']);
        setDaybookFilters({});
        setDaybookUserFilter(null);
    };
    
    const handleDaybookFilterChange = (key: string, value: string) => {
        setDaybookFilters(prev => ({...prev, [key]: value}));
    }

    const daybookMonthCutoff = useMemo(() => {
      if (!dashboardEmbedded) return null;
      const cutoff = startOfDay(subDays(new Date(), DASHBOARD_EMBEDDED_DAYBOOK_VOUCHER_LOOKBACK_DAYS));
      // Window must be fully in memory: never start before the in-memory FY scope (first whole day of it).
      if (fyScopeEnabled && fyActiveScope && fyActiveScope.policy !== "full") {
        const scopeFrom = fyActiveScope.range.fromMs;
        const scopeDay = startOfDay(new Date(scopeFrom));
        const firstWholeDay = scopeDay.getTime() === scopeFrom ? scopeDay : addDays(scopeDay, 1);
        if (firstWholeDay.getTime() > cutoff.getTime()) return firstWholeDay;
      }
      return cutoff;
    }, [dashboardEmbedded, fyScopeEnabled, fyActiveScope?.policy, fyActiveScope?.range?.fromMs]);

    /** Dashboard keep-alive: hidden tab par voucher filter / calendar mat chalao. */
    const daybookPipelineActive = !dashboardEmbedded || isPanelVisible;

    const vouchersForDaybookPipelineRef = useRef<typeof vouchers>(vouchers);
    /** Account day popup open: freeze the dashboard Daybook input so nothing behind the popup recomputes. */
    const daybookFrozenForPeek = !!daybookAccountPeek;
    const vouchersForDaybookPipeline = useMemo(() => {
      if ((dashboardEmbedded && !isPanelVisible) || daybookFrozenForPeek) {
        return vouchersForDaybookPipelineRef.current;
      }
      const next =
        !dashboardEmbedded || !daybookMonthCutoff
          ? vouchers
          : vouchers.filter((v) => {
              const d = voucherToJsDate(v?.date);
              if (!d) return false;
              // Default window (last 32 days) UNION the selected day (older days are loaded on demand below).
              return startOfDay(d) >= daybookMonthCutoff || (daybookDate ? isSameDay(d, daybookDate) : false);
            });
      vouchersForDaybookPipelineRef.current = next;
      return next;
    }, [vouchers, dashboardEmbedded, daybookMonthCutoff, isPanelVisible, daybookDate, daybookFrozenForPeek]);

    // Selected day outside the in-memory FY/month scope: load just that day from local SQLite; evict it when the day changes.
    useEffect(() => {
      if (!dashboardEmbedded || !isPanelVisible || !daybookDate || !fyScopeEnabled || !fyActiveScope) return;
      if (fyActiveScope.policy === "full") return;
      const dayStart = startOfDay(daybookDate).getTime();
      const dayEnd = endOfDay(daybookDate).getTime();
      const sc = fyActiveScope.range;
      if (dayStart >= sc.fromMs && dayEnd <= sc.toMs) return;
      const range = { fromMs: dayStart, toMs: dayEnd };
      let cancelled = false;
      void requestFyLoadTransientRange(range)
        .then(() => {
          if (cancelled) evictFyTransientRange(range);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        evictFyTransientRange(range);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dashboardEmbedded, isPanelVisible, daybookDate, fyScopeEnabled, fyActiveScope?.policy, fyActiveScope?.range?.fromMs, fyActiveScope?.range?.toMs]);

    // plserver/APK: dates often plain `{seconds,nanoseconds}` after JSON wire — not `toDate()` / `new Date(obj)`.
    const transactionDates = useMemo(() => {
      if (!daybookPipelineActive) return [];
      return collectVoucherCalendarDates(vouchersForDaybookPipeline);
    }, [vouchersForDaybookPipeline, daybookPipelineActive]);

    // User filter: sirf company owner + sharedWith — reconciliation / voucher ke extra userId mat dikhao
    const { daybookUserFilterIds, daybookUserLabelHints } = useMemo(() => {
        const idSet = new Set<string>();
        const labelHints: Record<string, string> = {};
        if (company?.ownerId) {
            const oid = String(company.ownerId);
            idSet.add(oid);
            labelHints[oid] = (company.ownerEmail && String(company.ownerEmail).trim()) || "Owner";
        }
        (company?.sharedWith || []).forEach((u: any) => {
            if (!u?.uid) return;
            const id = String(u.uid);
            idSet.add(id);
            if (!labelHints[id]) labelHints[id] = (u.name && String(u.name).trim()) || u.email || id;
        });
        const sorted = Array.from(idSet).sort((a, b) => {
            const la = labelHints[a] || a;
            const lb = labelHints[b] || b;
            return la.localeCompare(lb, undefined, { sensitivity: "base" });
        });
        return { daybookUserFilterIds: sorted, daybookUserLabelHints: labelHints };
    }, [company]);

    // Company share list se user hata diya ho to stale filter clear
    useEffect(() => {
        if (daybookUserFilter && !daybookUserFilterIds.includes(daybookUserFilter)) {
            setDaybookUserFilter(null);
        }
    }, [daybookUserFilterIds, daybookUserFilter]);

    const daybookEntity = useMemo(() => ({ id: "daybook", items: [] }), []);
    const daybookDateRange = useMemo(
        () => (daybookDate ? { from: daybookDate, to: daybookDate } : undefined),
        [daybookDate]
    );

    const { daybookTransactions: hookDaybookTransactions, daybookSummary: clientDaybookSummaryRaw } = useTransactions(
        daybookEntity,
        'daybook', 
        daybookDateRange, 
        undefined, 
        accounts,
        vouchersForDaybookPipeline,
        undefined, 
        daybookFilters, 
        daybookVoucherTypes, 
        voucherJournalAccountNames, 
        vouchersUserNames,
        undefined,
        daybookUserFilter,
        dashboardEmbedded,
        daybookPipelineActive
      );

    const hookDaybookTransactionsRef = useRef<any[]>([]);
    if (daybookPipelineActive && Array.isArray(hookDaybookTransactions)) {
      hookDaybookTransactionsRef.current = hookDaybookTransactions;
    }
    const daybookTransactions = daybookPipelineActive
      ? hookDaybookTransactions
      : hookDaybookTransactionsRef.current;

    // Pagination applies only to the dashboard Daybook tab; /reports Daybook keeps the full list.
    const daybookListTotal = daybookTransactions ? daybookTransactions.length : 0;
    const daybookPageSize = Math.max(10, footerRowsPerPage || 50);
    const daybookTotalPages = Math.max(1, Math.ceil(daybookListTotal / daybookPageSize));
    const daybookSafePage = Math.min(Math.max(1, daybookCurrentPage), daybookTotalPages);
    const daybookPageStart = (daybookSafePage - 1) * daybookPageSize;
    const daybookPageEnd = Math.min(daybookListTotal, daybookPageStart + daybookPageSize);
    const daybookPagedTransactions = useMemo(() => {
        if (!dashboardEmbedded || !daybookTransactions) return daybookTransactions;
        const pageRows = daybookTransactions.slice(daybookPageStart, daybookPageEnd) as Record<string, unknown>[];
        if (!daybookSortTouched || pageRows.length === 0) return pageRows;
        if (daybookSortBy === "date") {
            const sorted = sortRecentTransactionsDesc(pageRows);
            return daybookSortOrder === "asc" ? [...sorted].reverse() : sorted;
        }
        return sortTransactions(pageRows, daybookSortBy, daybookSortOrder, { tieBreakCreatedAtDesc: true });
    }, [dashboardEmbedded, daybookTransactions, daybookPageStart, daybookPageEnd, daybookSortTouched, daybookSortBy, daybookSortOrder]);
    useEffect(() => {
        setDaybookCurrentPage(1);
    }, [daybookDate, daybookFilters, daybookVoucherTypes, daybookUserFilter]);

    // Daily Summary opening fix: the in-memory window only holds vouchers from `daybookMonthCutoff` on, so add each
    // bank/cash account's balance BEFORE the window (computed once per boundary from local SQLite, bank/cash only).
    const summaryBaseBeforeMs = useMemo(() => {
      if (!dashboardEmbedded || !daybookMonthCutoff) return null;
      const cutoffMs = daybookMonthCutoff.getTime();
      const dayMs = daybookDate ? startOfDay(daybookDate).getTime() : null;
      return dayMs != null && dayMs < cutoffMs ? dayMs : cutoffMs;
    }, [dashboardEmbedded, daybookMonthCutoff, daybookDate]);
    const summaryBaseKey = companyId && summaryBaseBeforeMs != null ? `${companyId}:${summaryBaseBeforeMs}` : "";
    const summaryBaseCacheRef = useRef(new Map<string, Record<string, number>>());
    const [summaryBaseVersion, setSummaryBaseVersion] = useState(0);
    useEffect(() => {
      summaryBaseCacheRef.current = new Map();
    }, [companyId]);
    useEffect(() => {
      if (!summaryBaseKey || summaryBaseBeforeMs == null || !companyId) return;
      if (!isPanelVisible || daybookFrozenForPeek) return;
      if (summaryBaseCacheRef.current.has(summaryBaseKey)) return;
      let cancelled = false;
      const key = summaryBaseKey;
      const beforeMs = summaryBaseBeforeMs;
      void listVouchersFromBrowserDbByDateRange(companyId, { fromMs: 0, toMs: beforeMs - 1 })
        .then((rows) => {
          if (cancelled) return;
          const pre = buildDaybookDailySummary({
            accounts: (accounts || []) as any[],
            vouchers: rows,
            selectedDay: new Date(beforeMs),
          });
          const balances: Record<string, number> = {};
          for (const r of [...pre.bankAccounts, ...pre.cashAccounts]) balances[r.id] = r.yesterday;
          summaryBaseCacheRef.current.set(key, balances);
          setSummaryBaseVersion((n) => n + 1);
        })
        .catch((err) => console.warn("[DaybookReport] summary base", err));
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summaryBaseKey, isPanelVisible, daybookFrozenForPeek]);
    const clientDaybookSummary = useMemo(() => {
      const raw = clientDaybookSummaryRaw as DaybookDailySummary | null;
      void summaryBaseVersion;
      // Per-user summary is per-user money flow; base is all users -> leave it as is.
      if (!raw || !summaryBaseKey || daybookUserFilter) return raw;
      const base = summaryBaseCacheRef.current.get(summaryBaseKey);
      if (!base) return raw;
      const toNum = (v: unknown) => {
        const n = Number(typeof v === "string" ? v.replace(/,/g, "").trim() : v);
        return Number.isFinite(n) ? n : 0;
      };
      const obById = new Map((accounts || []).map((a: any) => [String(a.id), toNum(a.openingBalance)]));
      const fix = (rows: DaybookDailySummary["bankAccounts"]) =>
        rows.map((r) => {
          const b = base[r.id];
          if (typeof b !== "number" || !Number.isFinite(b)) return r;
          // raw opening = book OB + window vouchers before the day; true = balance before window + same window vouchers.
          const delta = b - (obById.get(r.id) ?? 0);
          return Math.abs(delta) < 1e-9 ? r : { ...r, yesterday: r.yesterday + delta, today: r.today + delta };
        });
      const bankAccounts = fix(raw.bankAccounts || []);
      const cashAccounts = fix(raw.cashAccounts || []);
      const sum = (rows: DaybookDailySummary["bankAccounts"], k: "yesterday" | "today") =>
        rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
      const bank = { ...raw.bank, yesterday: sum(bankAccounts, "yesterday"), today: sum(bankAccounts, "today") };
      const cash = { ...raw.cash, yesterday: sum(cashAccounts, "yesterday"), today: sum(cashAccounts, "today") };
      const total = { ...raw.total, yesterday: bank.yesterday + cash.yesterday, today: bank.today + cash.today };
      return { ...raw, bank, cash, total, bankAccounts, cashAccounts };
    }, [clientDaybookSummaryRaw, summaryBaseKey, summaryBaseVersion, daybookUserFilter, accounts]);

    const daybookSummaryRef = useRef<DaybookDailySummary | null>(null);
    useEffect(() => {
      daybookSummaryRef.current = null;
    }, [companyId, daybookDate, daybookUserFilter]);

    // Server only jab client voucher cache khali/incomplete ho — warna ledger jaisi client math (Aftab Settled vs -5000 bug).
    const {
      summary: serverDaybookSummary,
    } = useServerDaybookDailySummary({
      companyId: companyId || undefined,
      storageOption: (company as any)?.storageOption,
      selectedDay: daybookDate,
      userIdFilter: daybookUserFilter,
      enabled: !(vouchers && vouchers.length > 0),
    });
    const daybookSummaryNext =
      clientDaybookSummary ||
      serverDaybookSummary ||
      null;
    if (daybookSummaryNext) {
      daybookSummaryRef.current = daybookSummaryNext;
    }
    const daybookSummary = daybookSummaryNext ?? daybookSummaryRef.current;

    // Daily Summary account search — sirf bank/cash rows; trxn table alag (column filter / daybookFilters)
    const daybookAccountSearchTerm = daybookSummaryAccountSearch.trim().toLowerCase();
    const displayDaybookSummary = useMemo(() => {
        if (!daybookSummary) return null;
        if (!daybookAccountSearchTerm) return daybookSummary;
        const nameMatches = (name: string) => (name || "").toLowerCase().includes(daybookAccountSearchTerm);
        const bankAccounts = ((daybookSummary as any).bankAccounts || []).filter((row: { name: string }) => nameMatches(row.name));
        const cashAccounts = ((daybookSummary as any).cashAccounts || []).filter((row: { name: string }) => nameMatches(row.name));
        const sumField = (rows: { yesterday: number; in: number; out: number; today: number }[], key: "yesterday" | "in" | "out" | "today") =>
            rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
        const bank = {
            yesterday: sumField(bankAccounts, "yesterday"),
            in: sumField(bankAccounts, "in"),
            out: sumField(bankAccounts, "out"),
            today: sumField(bankAccounts, "today"),
        };
        const cash = {
            yesterday: sumField(cashAccounts, "yesterday"),
            in: sumField(cashAccounts, "in"),
            out: sumField(cashAccounts, "out"),
            today: sumField(cashAccounts, "today"),
        };
        const total = {
            yesterday: bank.yesterday + cash.yesterday,
            in: bank.in + cash.in,
            out: bank.out + cash.out,
            today: bank.today + cash.today,
        };
        return { bank, cash, total, bankAccounts, cashAccounts };
    }, [daybookSummary, daybookAccountSearchTerm]);

    // Account search par matching group auto-expand
    useEffect(() => {
        if (!daybookAccountSearchTerm || !daybookSummary) return;
        const bankHas = ((daybookSummary as any).bankAccounts || []).some((r: { name: string }) =>
            (r.name || "").toLowerCase().includes(daybookAccountSearchTerm)
        );
        const cashHas = ((daybookSummary as any).cashAccounts || []).some((r: { name: string }) =>
            (r.name || "").toLowerCase().includes(daybookAccountSearchTerm)
        );
        if (bankHas) setDaybookBankExpanded(true);
        if (cashHas) setDaybookCashExpanded(true);
    }, [daybookAccountSearchTerm, daybookSummary]);
    
    const isFullScreen = !!onFullScreenToggle;
    // Dashboard Daybook: hide title + Daily Summary so the table gets the height on small screens (remembered).
    const DAYBOOK_TOP_COLLAPSED_KEY = "pl_daybook_top_collapsed_v1";
    const [daybookTopCollapsed, setDaybookTopCollapsed] = useState(false);
    useEffect(() => {
      try {
        setDaybookTopCollapsed(window.localStorage.getItem(DAYBOOK_TOP_COLLAPSED_KEY) === "1");
      } catch {
        /* ignore */
      }
    }, []);
    const toggleDaybookTopCollapsed = useCallback(() => {
      setDaybookTopCollapsed((prev) => {
        const next = !prev;
        try {
          window.localStorage.setItem(DAYBOOK_TOP_COLLAPSED_KEY, next ? "1" : "0");
        } catch {
          /* ignore */
        }
        return next;
      });
    }, []);
    const hideDaybookTop = dashboardEmbedded && daybookTopCollapsed;

    return (
      <div id="daybook-area" className={cn("printable-area flex flex-col min-h-0 h-full", isMobile && "w-full min-w-0 max-w-full")}>
        <Card
            data-pl-daybook-blue-border="" data-pl-daybook-outer-card=""
            className={cn(
            "relative flex-1 flex flex-col min-h-0 overflow-hidden border-2 border-blue-300 transition-all duration-300",
            isFullScreen && "h-full",
            isMobile && "w-full min-w-0 max-w-full px-0",
            isMobile && daybookRotated && "max-w-[90vh] w-[90vh] h-[100vw] fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 z-50"
        )}
        >
            <CardHeader className={cn("print:hidden flex-shrink-0", isMobile && "w-full min-w-0 max-w-full px-0.5")}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className={cn(hideDaybookTop && "hidden")}>
                        <CardTitle>Daybook</CardTitle>
                        <CardDescription>All transactions for the selected date.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                            {/* Mobile: summary collapsed => show button yahan (Daily Summary header hidden hota hai) */}                             {isMobile && dashboardEmbedded && daybookTopCollapsed ? (                                 <Button type="button" variant="outline" size="sm" data-pl-daybook-top-toggle-mobile="" aria-label="Show Daybook summary" title="Show summary" aria-expanded={false} onClick={toggleDaybookTopCollapsed} className="h-9 min-h-9 max-h-9 shrink-0 px-2.5">                                     <ChevronDown className="h-[18px] w-[18px]" />                                 </Button>                             ) : null}
                        {isMobile && daybookRowsPerPage !== 'all' && (
                            <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-9 w-9"
                                onClick={() => setDaybookRotated(!daybookRotated)}
                            >
                                <RotateCw className="h-4 w-4" />
                            </Button>
                        )}
                        {onFullScreenToggle && (
                            <Button variant="ghost" size="icon" onClick={onFullScreenToggle}>
                               <Expand className="h-5 w-5" />
                            </Button>
                        )}
                    </div>
                </div>
                 {displayDaybookSummary && !hideDaybookTop && (
                    <Card data-pl-daybook-blue-border="" data-pl-daybook-summary-card="" className={cn("mt-4 bg-blue-50 border-blue-300 text-blue-800", isMobile && "min-w-0 max-w-full rounded-lg mx-[2px]")}>
                        <CardHeader className={cn("pb-2 pt-4 space-y-3", isMobile ? "px-2" : "px-4")}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex min-w-0 items-center justify-between gap-2">                                     <CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4 shrink-0" />Daily Summary</CardTitle>                                     {/* Mobile: Daily Summary hide (same state/key as PC toolbar toggle) - title row ke right */}                                     {isMobile && dashboardEmbedded ? (                                       <Button type="button" variant="outline" size="sm" data-pl-daybook-top-toggle-mobile="" aria-label="Hide Daybook summary" title="Hide summary" aria-expanded={!daybookTopCollapsed} onClick={toggleDaybookTopCollapsed} className="h-8 min-h-8 max-h-8 shrink-0 px-2">                                         <ChevronUp className="h-[18px] w-[18px]" />                                       </Button>                                     ) : null}                                     </div>
                                    {/* PC: account search yahi (pehle user dropdown tha); user filter neeche transaction row me */}
                                    <CardDescription className="text-blue-700">Only showing bank and cash summary.</CardDescription>
                                </div>
                                {/* Mobile: User filter; PC: account search — Daily Summary header right */}
                                {isMobile ? (
                                <div className="flex w-full flex-col gap-1 sm:w-[min(100%,220px)] shrink-0">
                                    {/* Mobile: User dropdown (baki jagah, shrink) + account search (right) ek hi row me */}
                                    <div className="flex w-full min-w-0 items-center gap-1" data-pl-daybook-mobile-user-search-row="">
                                    <div className="min-w-0 flex-1">
                                    <Select
                                        value={daybookUserFilter ?? "__all__"}
                                        onValueChange={(v) => setDaybookUserFilter(v === "__all__" ? null : v)}
                                    >
                                        <SelectTrigger
                                            data-pl-toolbar-field=""
                                            aria-label="User"
                                            className={cn(daybookToolbarSelectTriggerCn, "w-full")}
                                        >
                                            <SelectValue placeholder="All users" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__all__">All users</SelectItem>
                                            {daybookUserFilterIds.map((uid) => (
                                                <SelectItem key={uid} value={uid}>
                                                    {daybookUserLabelHints[uid] || vouchersUserNames[uid] || uid}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    </div>
                                    {/* Mobile: account search - Recent Search jaisa white; width min(50vw, 2.5in), User row me right side */}
                                        <div className="relative h-[38px] w-[50vw] max-w-[240px] shrink-0">
                                            <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                            <Input
                                                id="daybook-account-search-mobile"
                                                type="search"
                                                enterKeyHint="search"
                                                listChrome
                                                listChromeSearch
                                                value={daybookSummaryAccountSearch}
                                                onChange={(e) => setDaybookSummaryAccountSearch(e.target.value)}
                                                placeholder="Search"
                                                className="h-[38px] min-h-[38px] max-h-[38px] w-full bg-white py-1 pl-8 pr-2 text-sm dark:bg-white"
                                                autoComplete="off"
                                                aria-label="Search account"
                                            />
                                        </div>
                                    </div>
                                </div>
                                ) : (
                                <div className="relative w-full sm:w-[min(100%,220px)] shrink-0">
                                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                                    <Input
                                        id="daybook-account-search"
                                        type="search"
                                        enterKeyHint="search"
                                        listChrome
                                        listChromeSearch
                                        value={daybookSummaryAccountSearch}
                                        onChange={(e) => setDaybookSummaryAccountSearch(e.target.value)}
                                        placeholder="Search account"
                                        className="h-9 min-h-9 max-h-9 w-full bg-white py-1 pl-8 pr-2 text-sm dark:bg-white"
                                        autoComplete="off"
                                        aria-label="Search account"
                                    />
                                </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className={cn("pb-4", isMobile ? "px-2" : "px-4")}>
                          {/* Summary borders: Bank/Cash/Total dono side moti; child account rows ~50% patli */}
                          <div
                            onClick={() => setSelectedDaybookSummaryRowId(null)}
                            className={cn(
                              isMobile
                                ? "min-w-0 max-w-full [&_thead_tr]:!border-b [&_tbody_tr]:!border-b-[1.2px] [&_tbody_tr.daybook-summary-group-row]:!border-t [&_tbody_tr.daybook-summary-group-row]:!border-b"
                                : "[&_thead_tr]:!border-b [&_tbody_tr]:!border-b-[1.5px] [&_tbody_tr.daybook-summary-group-row]:!border-t [&_tbody_tr.daybook-summary-group-row]:!border-b",
                              "[&_thead_tr]:!border-foreground [&_tbody_tr]:!border-foreground/85 [&_tbody_tr.daybook-summary-group-row]:cursor-pointer [&_tbody_tr.daybook-summary-group-row]:transition-colors [&_tbody_tr.daybook-summary-group-row:hover]:bg-blue-100/40"
                            )}
                          >
                           <Table>
                            <TableHeader><TableRow><TableHead className="font-bold">Account</TableHead><TableHead className="text-right font-bold">Opening Balance</TableHead><TableHead className="text-right font-bold text-green-600">Today In</TableHead><TableHead className="text-right font-bold text-red-600">Today Out</TableHead><TableHead className="text-right font-bold">Today Balance</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {/* Bank group — search par sirf tab dikhao jab match ho */}
                                {(!daybookAccountSearchTerm || (displayDaybookSummary as any).bankAccounts?.length > 0) && (
                                <>
                                <TableRow
                                    aria-selected={selectedDaybookSummaryRowId === "bank:group"}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedDaybookSummaryRowId("bank:group");
                                    }}
                                    data-pl-daybook-summary-gray-row="" className={cn("daybook-summary-group-row font-bold text-base [&>td]:text-base [&>td]:font-bold", selectedDaybookSummaryRowId === "bank:group" && "!bg-blue-200/70 hover:!bg-blue-200/70")}
                                >
                                    <TableCell className="font-medium">
                                        <button
                                            type="button"
                                            className="flex items-center gap-1 text-left"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setDaybookBankExpanded((e) => !e);
                                            }}
                                            aria-expanded={daybookBankExpanded}
                                        >
                                            {daybookBankExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                            Bank
                                        </button>
                                    </TableCell>
                                    <TableCell className={cn("text-right", displayDaybookSummary.bank.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(displayDaybookSummary.bank.yesterday)}</TableCell>
                                    <TableCell className="text-right text-green-600">{formatCurrencyForPrint(displayDaybookSummary.bank.in, {noSuffix: true})}</TableCell>
                                    <TableCell className="text-right text-red-600">{formatCurrencyForPrint(displayDaybookSummary.bank.out, {noSuffix: true})}</TableCell>
                                    <TableCell className={cn("text-right", displayDaybookSummary.bank.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(displayDaybookSummary.bank.today)}</TableCell>
                                </TableRow>
                                {daybookBankExpanded && (displayDaybookSummary as any).bankAccounts?.map((row: { id: string; name: string; yesterday: number; in: number; out: number; today: number }) => {
                                    const rowKey = `bank:${row.id}`;
                                    const selected = selectedDaybookSummaryRowId === rowKey;
                                    return (
                                    <TableRow
                                        key={rowKey}
                                        aria-selected={selected}
                                        data-pl-daybook-summary-selected={selected ? "" : undefined}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setSelectedDaybookSummaryRowId(rowKey);
                                        }}
                                        onDoubleClick={(event) => {
                                            event.stopPropagation();
                                            const acc = (accounts || []).find((a) => String(a.id) === String(row.id));
                                            if (!acc) return;
                                            setSelectedDaybookSummaryRowId(rowKey);
                                            setDaybookAccountPeek({
                                              account: acc as Account,
                                              opening: row.yesterday,
                                              in: row.in,
                                              out: row.out,
                                              closing: row.today,
                                            });
                                        }}
                                        className={cn(daybookSummaryAccountRowCn(selected), "pl-daybook-summary-row", selected && "pl-daybook-summary-row-selected")}
                                    >
                                        <TableCell className="pl-9 text-muted-foreground">{row.name}</TableCell>
                                        <TableCell className={cn("text-right", row.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(row.yesterday)}</TableCell>
                                        <TableCell className="text-right text-green-600">{formatCurrencyForPrint(row.in, { noSuffix: true })}</TableCell>
                                        <TableCell className="text-right text-red-600">{formatCurrencyForPrint(row.out, { noSuffix: true })}</TableCell>
                                        <TableCell className={cn("text-right", row.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(row.today)}</TableCell>
                                    </TableRow>
                                    );
                                })}
                                </>
                                )}
                                {(!daybookAccountSearchTerm || (displayDaybookSummary as any).cashAccounts?.length > 0) && (
                                <>
                                <TableRow
                                    aria-selected={selectedDaybookSummaryRowId === "cash:group"}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedDaybookSummaryRowId("cash:group");
                                    }}
                                    data-pl-daybook-summary-gray-row="" className={cn("daybook-summary-group-row font-bold text-base [&>td]:text-base [&>td]:font-bold", selectedDaybookSummaryRowId === "cash:group" && "!bg-blue-200/70 hover:!bg-blue-200/70")}
                                >
                                    <TableCell className="font-medium">
                                        <button
                                            type="button"
                                            className="flex items-center gap-1 text-left"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setDaybookCashExpanded((e) => !e);
                                            }}
                                            aria-expanded={daybookCashExpanded}
                                        >
                                            {daybookCashExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                            Cash
                                        </button>
                                    </TableCell>
                                    <TableCell className={cn("text-right", displayDaybookSummary.cash.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(displayDaybookSummary.cash.yesterday)}</TableCell>
                                    <TableCell className="text-right text-green-600">{formatCurrencyForPrint(displayDaybookSummary.cash.in, {noSuffix: true})}</TableCell>
                                    <TableCell className="text-right text-red-600">{formatCurrencyForPrint(displayDaybookSummary.cash.out, {noSuffix: true})}</TableCell>
                                    <TableCell className={cn("text-right", displayDaybookSummary.cash.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(displayDaybookSummary.cash.today)}</TableCell>
                                </TableRow>
                                {daybookCashExpanded && (displayDaybookSummary as any).cashAccounts?.map((row: { id: string; name: string; yesterday: number; in: number; out: number; today: number }) => {
                                    const rowKey = `cash:${row.id}`;
                                    const selected = selectedDaybookSummaryRowId === rowKey;
                                    return (
                                    <TableRow
                                        key={rowKey}
                                        aria-selected={selected}
                                        data-pl-daybook-summary-selected={selected ? "" : undefined}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setSelectedDaybookSummaryRowId(rowKey);
                                        }}
                                        onDoubleClick={(event) => {
                                            event.stopPropagation();
                                            const acc = (accounts || []).find((a) => String(a.id) === String(row.id));
                                            if (!acc) return;
                                            setSelectedDaybookSummaryRowId(rowKey);
                                            setDaybookAccountPeek({
                                              account: acc as Account,
                                              opening: row.yesterday,
                                              in: row.in,
                                              out: row.out,
                                              closing: row.today,
                                            });
                                        }}
                                        className={cn(daybookSummaryAccountRowCn(selected), "pl-daybook-summary-row", selected && "pl-daybook-summary-row-selected")}
                                    >
                                        <TableCell className="pl-9 text-muted-foreground">{row.name}</TableCell>
                                        <TableCell className={cn("text-right", row.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(row.yesterday)}</TableCell>
                                        <TableCell className="text-right text-green-600">{formatCurrencyForPrint(row.in, { noSuffix: true })}</TableCell>
                                        <TableCell className="text-right text-red-600">{formatCurrencyForPrint(row.out, { noSuffix: true })}</TableCell>
                                        <TableCell className={cn("text-right", row.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(row.today)}</TableCell>
                                    </TableRow>
                                    );
                                })}
                                </>
                                )}
                                <TableRow
                                  data-pl-daybook-summary-gray-row=""
                                  aria-selected={selectedDaybookSummaryRowId === "total"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedDaybookSummaryRowId("total");
                                  }}
                                  className={cn(
                                    "font-bold text-base [&>td]:text-base [&>td]:font-bold border-foreground daybook-summary-group-row",
                                    selectedDaybookSummaryRowId === "total" && "!bg-blue-200/70 hover:!bg-blue-200/70"
                                  )}
                                >
                                  <TableCell>Total</TableCell>
                                  <TableCell className={cn("text-right", displayDaybookSummary.total.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(displayDaybookSummary.total.yesterday)}</TableCell>
                                  <TableCell className="text-right text-green-600">{formatCurrencyForPrint(displayDaybookSummary.total.in, {noSuffix: true})}</TableCell>
                                  <TableCell className="text-right text-red-600">{formatCurrencyForPrint(displayDaybookSummary.total.out, {noSuffix: true})}</TableCell>
                                  <TableCell className={cn("text-right", displayDaybookSummary.total.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrencyForPrint(displayDaybookSummary.total.today)}</TableCell>
                                </TableRow>
                            </TableBody>
                           </Table>
                          </div>
                        </CardContent>
                    </Card>
                )}
                 <div className="flex flex-col gap-2 mt-4 print:hidden">
                    <div
                      data-pl-daybook-toolbar=""
                      className="flex flex-wrap items-center justify-between gap-4"
                    >
                        <div className="flex min-h-9 flex-wrap items-center gap-2">
                            {/* Daybook only: single date system – show either BS or AD calendar, not both. Date select par calendar auto-close. */}
                            {dateSystem === 'BS' && (
                                <BsDatePicker
                                  valueAD={daybookDate}
                                  onChangeAD={(date) => setDaybookDate(date as Date)}
                                  isRange={false}
                                  transactionDates={transactionDates}
                                  className="h-9 min-h-9 max-h-9"
                                />
                            )}
                            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                                <Popover open={isDaybookCalendarOpen} onOpenChange={setIsDaybookCalendarOpen}>
                                    <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn("h-9 min-h-9 max-h-9 w-auto justify-start text-left font-normal", !daybookDate && "text-muted-foreground")}
                                    >
                                        {!isMobile && <CalendarIcon className="mr-2 h-4 w-4" />}
                                        {daybookDate ? formatDate(daybookDate) : <span>Pick a date</span>}
                                    </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <AdCalendar
                                            valueAD={daybookDate}
                                            isRange={false}
                                            numberOfMonths={calendarMonths}
                                            transactionDates={transactionDates}
                                            onSelect={(adDate) => {
                                                setDaybookDate(adDate);
                                                setIsDaybookCalendarOpen(false);
                                            }}
                                        />
                                    </PopoverContent>
                                </Popover>
                            )}
                            {/* PC: date ↔ Today ke beech prev/next din; mobile par hide */}
                            {!isMobile && !welcomeRibbonDateNav && (
                                <>
                                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Previous day" onClick={() => shiftDaybookDateBy(-1)}>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Next day" onClick={() => shiftDaybookDateBy(1)}>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 min-h-9 max-h-9"
                              onClick={() => setDaybookDate(new Date())}
                            >
                              Today
                            </Button>
                            {dashboardEmbedded && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-pl-daybook-top-toggle=""
                                aria-label={daybookTopCollapsed ? "Show Daybook summary" : "Hide Daybook summary"}
                                title={daybookTopCollapsed ? "Show summary" : "Hide summary"}
                                aria-expanded={!daybookTopCollapsed}
                                onClick={toggleDaybookTopCollapsed}
                                // Same Button variant/size/height classes as the Today button next to it.
                                className="h-9 min-h-9 max-h-9 shrink-0 px-2.5"
                              >
                                {daybookTopCollapsed ? <ChevronDown className="h-[18px] w-[18px]" /> : <ChevronUp className="h-[18px] w-[18px]" />}
                              </Button>
                            )}
                             {isDaybookFilterActive && (
                                <Button variant="ghost" size="icon" className="h-9 w-9 min-h-9 max-h-9 shrink-0" onClick={clearDaybookFilters} aria-label="Clear Filters"><X className="h-4 w-4" /></Button>
                            )}
                            {!isMobile && (
                            <>
                            <div className="flex h-9 min-h-9 items-center space-x-2 flex-shrink-0">
                                <Checkbox
                                    id="daybook-show-narration"
                                    checked={showDaybookNarration}
                                    onCheckedChange={(c) => setShowDaybookNarration(Boolean(c))}
                                />
                                <label htmlFor="daybook-show-narration" className="text-sm font-medium leading-none whitespace-nowrap cursor-pointer">Show Narration</label>
                            </div>
                            <NarrationNoteSearchInput
                              id="narration-search-report-daybook"
                              value={daybookNarrationNoteSearch}
                              onChange={setDaybookNarrationNoteSearch}
                              toolbarChrome
                            />
                            </>
                            )}
                        </div>
                        <div className="flex min-h-9 flex-wrap items-center space-x-2 justify-end">
                            {/* PC: User filter — Rows dropdown ke left; account search Daily Summary me */}
                            {!isMobile && (
                            <>
                            <span className="text-sm font-medium leading-none">User:</span>
                            <Select
                                value={daybookUserFilter ?? "__all__"}
                                onValueChange={(v) => setDaybookUserFilter(v === "__all__" ? null : v)}
                            >
                                <SelectTrigger
                                  data-pl-toolbar-field=""
                                  className={cn(daybookToolbarSelectTriggerCn, "w-[min(180px,18vw)]")}
                                >
                                    <SelectValue placeholder="All users" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All users</SelectItem>
                                    {daybookUserFilterIds.map((uid) => (
                                        <SelectItem key={uid} value={uid}>
                                            {daybookUserLabelHints[uid] || vouchersUserNames[uid] || uid}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            </>
                            )}
                            {/* Dashboard Daybook uses the footer Rows control (Recent parity); keep this one for /reports only. */}
{!dashboardEmbedded && (
<>
{!isMobile && <span className="text-sm font-medium leading-none">Rows:</span>}
                            <Select value={daybookRowsPerPage} onValueChange={(v) => setDaybookRowsPerPage(v)}>
                                <SelectTrigger
                                  data-pl-toolbar-field=""
                                  className={cn(daybookToolbarSelectTriggerCn, "w-[80px]")}
                                >
                                    <SelectValue placeholder={`${daybookRowsPerPage}`} />
                                </SelectTrigger>
                                <SelectContent>
                                    {['15', '30', '50', 'all'].map(size => <SelectItem key={size} value={size}>{size}</SelectItem>)}
                                </SelectContent>
                            </Select>
</>
)}
                        </div>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground w-full block">Total Vouchers: {daybookTransactions ? daybookTransactions.length : 0}</span>
                </div>
            </CardHeader>
            <CardContent className={cn(
                "flex-1 min-h-0 overflow-hidden flex flex-col relative px-0",
                isMobile ? "w-full min-w-0 max-w-full" : "min-w-full",
                (!daybookTransactions || daybookTransactions.length === 0) && "min-h-[420px]"
            )}>
                 {daybookTransactions && daybookTransactions.length > 0 ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-full w-full">
                    {isMobile ? (
                      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto min-w-full w-full">
                        <div className={cn("w-full min-w-full overflow-hidden px-[2px]")}>
                          <TransactionsTable
                                transactions={daybookPagedTransactions || []}
                                context="daybook"
                                disableLayoutAnimation
                                showNarration={showDaybookNarration}
                                visibleColumns={dashboardEmbedded ? visibleColumns : undefined}
                                narrationNoteSearch={daybookNarrationNoteSearch}
                                journalAccountNames={voucherJournalAccountNames}
                                userNames={vouchersUserNames}
                                onRowClick={handleEditVoucher}
                                onInterCompanyChangeDetectedClick={handleInterCompanyChangeDetectedClick}
                                onHistoryVoucher={handleHistoryVoucher}
                                onAddLink={handleAddLink}
                                openingBalance={daybookSummary?.total.yesterday}
                                filters={daybookFilters}
                                setFilters={setDaybookFilters}
                                activeFilter={activeDaybookFilter}
                                setActiveFilter={setActiveDaybookFilter}
                                voucherTypes={daybookVoucherTypes}
                                onVoucherTypeChange={setDaybookVoucherTypes}
                                isDateChange={isDateChange}
                                hideFooter={true}
                          />
                        </div>
                      </div>
                    ) : (
                      <DaybookTxnScrollColumn className="flex-1 min-h-0">
                        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
                          <TransactionsTable
                                transactions={daybookPagedTransactions || []}
                                context="daybook"
                                disableLayoutAnimation
                                showNarration={showDaybookNarration}
                                visibleColumns={dashboardEmbedded ? visibleColumns : undefined}
                                narrationNoteSearch={daybookNarrationNoteSearch}
                                journalAccountNames={voucherJournalAccountNames}
                                userNames={vouchersUserNames}
                                onRowClick={handleEditVoucher}
                                onInterCompanyChangeDetectedClick={handleInterCompanyChangeDetectedClick}
                                onHistoryVoucher={handleHistoryVoucher}
                                onAddLink={handleAddLink}
                                openingBalance={daybookSummary?.total.yesterday}
                                filters={daybookFilters}
                                setFilters={setDaybookFilters}
                                activeFilter={activeDaybookFilter}
                                setActiveFilter={setActiveDaybookFilter}
                                voucherTypes={daybookVoucherTypes}
                                onVoucherTypeChange={setDaybookVoucherTypes}
                                isDateChange={isDateChange}
                                hideFooter={true}
                                daybookDesktopUnifiedScroll
                          />
                        </div>
                      </DaybookTxnScrollColumn>
                    )}
                </div>
              ) : (
                <div className="relative flex-1 min-h-0 flex items-center justify-center pointer-events-none overflow-hidden rounded-b-lg">
                    <div className="absolute top-6 left-6 text-5xl md:text-6xl font-bold text-muted-foreground/15 transform -rotate-12 select-none">
                        Daybook
                    </div>
                    <p className="text-2xl md:text-3xl font-bold text-muted-foreground/25 transform -rotate-12 whitespace-nowrap select-none">
                        No Transactions Found
                    </p>
                    <div className="absolute bottom-6 right-6 text-5xl md:text-6xl font-bold text-muted-foreground/15 transform -rotate-12 select-none">
                        Report
                    </div>
                </div>
              )}
              {/* Floating day stepper (same as the account day popup) - PC dashboard Daybook (list ke bottom); mobile dashboard: footer ribbon ke upar center (portal). */}
              {dashboardEmbedded && (!isMobile || footerPortalTarget) ? (
                (() => {
                /* Mobile dashboard: same stepper portaled into fixed footer, footer chevron ki row me (welcome ke 2px upar), center. */
                const daybookDayStepper = (
                <div
                  data-pl-day-stepper-float=""
                  className={cn("pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center print:hidden", isMobile ? "bottom-[calc(100%+2px)] z-[45] gap-[40px]" : "bottom-3 z-30 gap-2")}
                >
                  <button
                    type="button"
                    aria-label="Previous day"
                    title="Previous day"
                    onClick={() => shiftDaybookDateBy(-1)}
                    className={cn(chromeProPillCn, "pointer-events-auto rounded-full px-0 inline-flex items-center justify-center shadow-lg disabled:opacity-40 disabled:pointer-events-none", isMobile ? "h-[var(--pl-mobile-txn-footer-row-h,2.625rem)] min-h-[var(--pl-mobile-txn-footer-row-h,2.625rem)] w-[calc(var(--pl-mobile-txn-footer-row-h,2.625rem)*1.5)]" : "h-8 w-10")}
                  >
                    <ChevronLeft className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next day"
                    title="Next day"
                    disabled={!daybookDate || startOfDay(daybookDate).getTime() >= startOfDay(new Date()).getTime()}
                    onClick={() => shiftDaybookDateBy(1)}
                    className={cn(chromeProPillCn, "pointer-events-auto rounded-full px-0 inline-flex items-center justify-center shadow-lg disabled:opacity-40 disabled:pointer-events-none", isMobile ? "h-[var(--pl-mobile-txn-footer-row-h,2.625rem)] min-h-[var(--pl-mobile-txn-footer-row-h,2.625rem)] w-[calc(var(--pl-mobile-txn-footer-row-h,2.625rem)*1.5)]" : "h-8 w-10")}
                  >
                    <ChevronRight className="h-[18px] w-[18px]" />
                  </button>
                </div>
                );
                return isMobile && footerPortalTarget ? createPortal(daybookDayStepper, footerPortalTarget) : daybookDayStepper;
                })()
              ) : null}
              {dashboardEmbedded ? (
                isMobile ? (
                  (() => {
                  const daybookMobilePager = (
                  <MobileTransactionsPager
                    className={footerPortalTarget ? "px-0 pt-0" : "px-2 pt-2"}
                    currentPage={daybookSafePage}
                    totalItems={daybookListTotal}
                    rowsPerPage={daybookPageSize}
                    onRowsPerPageChange={(nextRows) => {
                      setFooterRowsPerPage(Math.max(10, nextRows || 50));
                      setDaybookCurrentPage(1);
                    }}
                    onPageChange={setDaybookCurrentPage}
                    edgeCounts={{ before: daybookPageStart, after: daybookListTotal - daybookPageEnd }}
                    pagingMode="newest-first"
                    trimSummary
                    includeAllOption={false}
                  />
                  );
                  /* Mobile dashboard: pager fixed footer me portal (welcome ke neeche, tabs ke upar); scroll area me duplicate nahi. */
                  return footerPortalTarget
                    ? createPortal(
                        <div data-pl-daybook-mobile-footer-pager="" className="w-full min-w-0 print:hidden">
                          {daybookMobilePager}
                        </div>,
                        footerPortalTarget,
                      )
                    : daybookMobilePager;
                  })()
                ) : footerPortalTarget ? (
                  createPortal(
                  <div data-pl-daybook-ledger-footer="" className="w-full min-w-0 shrink-0 overflow-hidden print:hidden">
                    <LedgerDesktopFooter
                      shellClassName="mt-0 rounded-none border-0 border-t border-blue-300 bg-blue-100 py-1.5 px-2 shadow-none overflow-x-hidden overflow-y-hidden dark:border-blue-800 dark:bg-blue-950"
                      left={
                        <>
                          <LedgerFooterCheckboxPill
                            id="show-narration-daybook-footer"
                            checked={showDaybookNarration}
                            onCheckedChange={(checked) => setShowDaybookNarration(Boolean(checked))}
                            label="Show Narration"
                          />
                          <LedgerFooterColumnsMenu>
                            <DropdownMenuContent align="start" className="w-52 p-2">
                              {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[])
                                .filter((key) => key !== "runningBalance" && key !== "status")
                                .map((key) => (
                                  <DropdownMenuItem
                                    key={key}
                                    onSelect={(e) => e.preventDefault()}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <Checkbox
                                      id={`col-${key}-daybook`}
                                      checked={visibleColumns[key] !== false}
                                      onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                                    />
                                    <label htmlFor={`col-${key}-daybook`} className="text-sm font-medium flex-1 cursor-pointer">
                                      {COLUMN_LABELS[key]}
                                    </label>
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </LedgerFooterColumnsMenu>
                          <LedgerFooterCheckboxPill
                            id="show-notes-daybook-footer"
                            checked={includeNotesInTable}
                            disabled={notesPreferenceLockedOnMobile}
                            onCheckedChange={(c) => setShowNotes(Boolean(c))}
                            label="Note"
                          />
                        </>
                      }
                      sortBy={daybookSortBy}
                      sortOrder={daybookSortOrder}
                      onSortChange={(by, order) => {
                        setDaybookSortBy(by);
                        setDaybookSortOrder(order);
                        setDaybookSortTouched(true);
                      }}
                      viewMode="statement"
                      currentPage={daybookSafePage}
                      totalPages={daybookTotalPages}
                      setCurrentPage={setDaybookCurrentPage}
                      rowsPerPageSelectValue={footerRowsSelectValue}
                      onRowsPerPageChange={(value) => {
                        setFooterRowsPerPage(Math.max(10, Number(value) || 50));
                        setDaybookCurrentPage(1);
                      }}
                      rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS_DEFAULT}
                      beforeCount={daybookPageStart}
                      afterCount={daybookListTotal - daybookPageEnd}
                      totalCount={daybookListTotal}
                      includeAllOption={false}
                    />
                  </div>,
                  footerPortalTarget
                  )
                ) : null
              ) : null}
            </CardContent>
        </Card>
        {isMobile && showSwipeDateIntro && isPanelVisible ? (
            <div className="pointer-events-none fixed left-1/2 bottom-20 z-[120] w-[min(92vw,20rem)] -translate-x-1/2 print:hidden">
                <div className="rounded-lg bg-black/80 px-3 py-2 text-center text-xs font-medium text-white shadow-lg">
                    Swipe ← → arrows at bottom to change date
                </div>
            </div>
        ) : null}
        <AddVoucherDialog isOpen={isVoucherDialogOpen} onOpenChange={setIsVoucherDialogOpen} voucher={selectedVoucher} onVoucherCreated={() => setSelectedVoucher(null)} />
        {interCompanyChangeDetectDialog}
        <HistoryDialog voucher={historyVoucher} isOpen={!!historyVoucher} onOpenChange={(open) => !open && setHistoryVoucher(null)} onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)} />
        <DaybookAccountDayPeekDialog
          open={!!daybookAccountPeek}
          onOpenChange={(open) => {
            if (!open) setDaybookAccountPeek(null);
          }}
          account={daybookAccountPeek?.account ?? null}
          daybookDate={daybookDate}
          summaryOpening={daybookAccountPeek?.opening}
          summaryIn={daybookAccountPeek?.in}
          summaryOut={daybookAccountPeek?.out}
          summaryClosing={daybookAccountPeek?.closing}
        />
        {linkAdvancesVoucher && (
          <LinkAdvancesToVoucherDialog
            isOpen={!!linkAdvancesVoucher}
            onOpenChange={(open: boolean) => !open && setLinkAdvancesVoucher(null)}
            mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
            targetVoucherId={linkAdvancesVoucher.id}
            targetPartyId={linkAdvancesVoucher.partyId ?? ""}
            targetPartyName={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.name ?? "Party"}
            partyOpeningBalance={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.openingBalance ?? 0}
            balanceKind="all"
            onDone={() => setLinkAdvancesVoucher(null)}
          />
        )}
        {linkPaymentVoucher && (
          <LinkPaymentToTxnsDialog
            isOpen={!!linkPaymentVoucher}
            onOpenChange={(open: boolean) => !open && setLinkPaymentVoucher(null)}
            variant={linkPaymentVoucher.type === "payment_out" || linkPaymentVoucher.type === "direct_expense" ? "payment_out" : "payment_in"}
            partyId={linkPaymentVoucher.partyId ?? null}
            partyName={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.name ?? "Party"}
            receivedAmount={Number(linkPaymentVoucher.amount ?? linkPaymentVoucher.total ?? 0)}
            existingAllocations={Array.isArray(linkPaymentVoucher.allocations) ? linkPaymentVoucher.allocations : []}
            paymentInId={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
            paymentOutId={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
            paymentInVoucherNumber={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
            paymentInDate={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
            paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
            paymentOutDate={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
            partyOpeningBalance={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.openingBalance ?? 0}
            onDone={async (allocations, _amount) => {
              if (!companyId || !linkPaymentVoucher?.id) return;
              const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
              const result = await runWithVoucherLinkSaveProgress(async () => {
                await applyPaymentBillWiseLinkAllocations(companyId, linkPaymentVoucher, allocations);
                setLinkPaymentVoucher(null);
              }, { successTitle: "Allocations updated" });
              if (!result.ok) {
                toast.error(
                  result.error instanceof Error
                    ? result.error.message
                    : "Failed to update allocations."
                );
              }
            }}
          />
        )}
      </div>
    );
}
