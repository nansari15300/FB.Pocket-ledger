"use client";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import React, { Fragment, useCallback, useDeferredValue, useMemo, useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { proDashboardRibbonClass } from "@/lib/proTheme";
import { DASHBOARD_VIEW_DETAILS_TABLE_CN } from "@/lib/dashboardViewDetailsTableClass";
import { financialSummaryHairlineRowClass } from "@/components/reports/FinancialSummary/financialSummaryCardStyles";
import {
    LEDGER_HEADER_PILL_CN,
    LEDGER_HEADER_PILL_ICON_SIZE_CN,
} from "@/lib/ledgerHeaderChrome";
import { useDate } from "@/hooks/useDate";
import usePermissions from "@/hooks/usePermissions";
import { useCompany } from "@/hooks/useCompany";
import { useIsMobile } from '@/hooks/use-mobile';
import { Printer, RotateCw, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import {
    startOfDay,
    endOfDay,
    isSameDay,
    format,
    addDays,
    addMonths,
    subMonths,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    parseISO,
} from "date-fns";
import { adToBs, bsToAd, getBSMonthDays, NEPALI_MONTHS, addBsMonths } from "@/lib/bs-date";
import type { DateRange } from "@/components/ui/ad-calendar";
import {
    formatMonthYearRangeLabel,
    getCurrentMonthDateRange,
    isCurrentMonthDateRange,
    MonthYearFilter,
    type MonthYearFilterMode,
} from "@/components/dashboard/MonthYearFilter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { openPrintDirect } from "@/lib/printDirect";
import { orderedCashFlowCategories } from "@/lib/cashFlowCategoryOrder";
import {
    voucherCountsAsDashboardPaySalary,
    voucherCountsAsDashboardPaymentOutExcludingPaySalary,
} from "@/lib/dashboardPaySalaryStat";
import { getTransactionAmounts as getLedgerTransactionAmounts } from "@/hooks/use-transactions";
import { dashboardStatCardReportHref } from "@/lib/dashboardStatCardReportHref";
import {
    formatAnusuchi13FyRangeLabel,
    getAnusuchi13FyKey,
    getFiscalRangeForFyKey,
} from "@/lib/reports/anusuchi13Confirmation";
import { resolveCompanyFiscalYearDates } from "@/lib/companyFyVoucherSuggestion";
import {
    buildDashboardScopeFromApply,
    dashboardScopeToFilterMode,
    defaultDashboardSummaryCardScope,
    entityMasterDateInDashboardScope,
    filterVouchersByDashboardScope,
    formatDashboardScopeHint,
    migrateDashboardScopeOnDateSystemChange,
    type DashboardScopeApplyPayload,
    type DashboardSummaryCardScope,
} from "@/lib/dashboardSummaryCardScope";
import {
    computeReceivablesPayablesFinancialSummary,
} from "@/lib/receivablesPayablesFinancialSummary";
import { computeRpReceivePayAtDayEnds, type RpSeriesEntity } from "@/lib/receivablesPayablesLedgerAmounts";
import {
    buildRpDialogSections,
    countRpDeadlineDueAccounts,
    countRpDialogSide,
    filterRpDialogSectionsForDeadlineDue,
    normalizeReceivablesPayablesSummary,
    readRpDeadlinesFromStorage,
    rpDialogRowSelectionKey,
    RP_DIALOG_FILTER_OPTIONS,
    sumRpDialogSide,
    writeRpDeadlinesToStorage,
    type RpCategoryFilter,
    type RpDeadlinesMap,
    type RpDialogRow,
} from "@/lib/receivablesPayablesDialogUi";
import { ReceivablesPayablesDialogFooter } from "@/components/reports/ReceivablesPayablesDialogFooter";
import {
    ReceivablesPayablesMobileSidePills,
    type ReceivablesPayablesSideTab,
} from "@/components/reports/ReceivablesPayablesMobileSidePills";
import {
    ReceivablesPayablesDialogEntityList,
    rpDialogListScrollHandlers,
    rpDialogPreventDismissForNestedPopover,
    RP_DIALOG_SHELL_ATTR,
    RP_DIALOG_HEADER_DIVIDER_CN,
} from "@/components/reports/ReceivablesPayablesDialogEntityList";
import { useReceivablesPayablesLedgerPopup } from "@/components/reports/ReceivablesPayablesLedgerPopup";
import {
    DaybookAccountDayPeekDialog,
    daybookSummaryAccountRowCn,
} from "@/components/reports/DaybookAccountDayPeekDialog";
import { useReceivablesPayablesEntityVisibility } from "@/hooks/useReceivablesPayablesEntityVisibility";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { RP_DIALOG_SCROLL_CN } from "@/lib/receivablesPayablesEntityKeys";
import { useServerReceivablesPayablesSummary } from "@/hooks/useServerReceivablesPayablesSummary";
import { useRpOutstandingDialog } from "@/contexts/RpOutstandingDialogContext";
import Link from "next/link";
import {
    ShoppingBag,
    ShoppingCart,
    BookText,
    FileDigit,
    Landmark,
    TrendingUp,
    TrendingDown,
    ArrowDownCircle,
    ArrowUpCircle,
    StickyNote,
    Factory,
    HandCoins,
} from "lucide-react";

// Helper function to safely convert date
const safeToDate = (date: any): Date | null => {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (date.toDate instanceof Function) return date.toDate();
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? null : parsed;
};

/** Party/Staff/Tax/Item/Bank master: `createdAt` field se "kab add hua" chart. */
function pickEntityCreatedAt(entity: any): Date | null {
    if (!entity) return null;
    return safeToDate(
        entity.createdAt ??
            entity.created_at ??
            entity.dateCreated ??
            entity.addedAt ??
            (entity as any)._createdAt
    );
}

const DASHBOARD_CHART_EXCLUDE_PARTY_IDS = new Set([
    "sales_account",
    "purchase_account",
    "opening_balance_ledger",
]);

/** Popup range filter: poori series `yyyy-MM-dd` par (mini chart ab bhi slice se). */
export type ChartDayPoint = { dayKey: string; amount: number };

export type ChartRangePreset = "month" | "3m" | "6m" | "year" | "all";

/** Full-screen: Month = calendar month me har din column; 3/6/12 = months; All = saare months. */
export const CHART_FULL_RANGE_OPTIONS: { id: ChartRangePreset; label: string }[] = [
    { id: "month", label: "Month" },
    { id: "3m", label: "3 Mo" },
    { id: "6m", label: "6 Mo" },
    { id: "year", label: "Year" },
    { id: "all", label: "All" },
];

/** Ek calendar month ke andar saare dinon ka amount jodna. */
function sumAmountForCalendarMonth(dayMap: Map<string, number>, monthStart: Date): number {
    const start = startOfMonth(monthStart);
    const end = endOfMonth(monthStart);
    const days = eachDayOfInterval({ start, end });
    let s = 0;
    for (const d of days) {
        s += dayMap.get(format(d, "yyyy-MM-dd")) || 0;
    }
    return s;
}

/** BS ek mahine ke AD dinon par series jodna — Nepali month buckets. */
function sumAmountForBsMonth(dayMap: Map<string, number>, bsYear: number, bsMonth: number): number {
    const dims = getBSMonthDays(bsYear);
    const daysInMonth = dims[bsMonth - 1];
    if (!daysInMonth || daysInMonth < 1) return 0;
    const start = bsToAd({ y: bsYear, m: bsMonth, d: 1 });
    const end = bsToAd({ y: bsYear, m: bsMonth, d: daysInMonth });
    let s = 0;
    for (const d of eachDayOfInterval({ start, end })) {
        s += dayMap.get(format(d, "yyyy-MM-dd")) || 0;
    }
    return s;
}

/** Full chart X-axis: Nepali naam + BS year (numeric date ki jagah). */
function labelNepaliMonthChart(bsYear: number, bsMonth: number): string {
    const label = NEPALI_MONTHS[bsMonth - 1] ?? "";
    return `${label} ${bsYear}`;
}

/** Chevron clamping: ek hi seed par BS months compare karna. */
function bsMonthIndexFromAnchorDate(d: Date): number {
    const b = adToBs(d);
    return b.y * 12 + b.m - 1;
}

/** BS mode: sabse chhota allowed anchor (window ka pehla month data ke baahar na jaye). */
function minAnchorDateBs(dataMinMonthStart: Date, preset: ChartRangePreset): Date {
    const bs = adToBs(dataMinMonthStart);
    const extra =
        preset === "month" ? 0 : preset === "3m" ? 2 : preset === "6m" ? 5 : preset === "year" ? 11 : 0;
    const n = addBsMonths(bs.y, bs.m, extra);
    return bsToAd({ y: n.y, m: n.m, d: 1 });
}

/** Rightmost month column — is month se 3M/6M/Year window end hota hai. */
function minAnchorMonthForPreset(dataMinMonth: Date, preset: ChartRangePreset): Date {
    const sm = startOfMonth(dataMinMonth);
    switch (preset) {
        case "month":
            return sm;
        case "3m":
            return addMonths(sm, 2);
        case "6m":
            return addMonths(sm, 5);
        case "year":
            return addMonths(sm, 11);
        default:
            return sm;
    }
}

/**
 * Popup chart columns: Month = us mahine jitne din utne bars; 3/6/12 month name columns;
 * All = har distinct month (20 mahene → 20 columns).
 * BS mode: buckets Nepali mahine + labels Baisakh 2082; chevron bhi BS mahina slide.
 */
function buildFullViewChartData(
    pointsByDay: ChartDayPoint[],
    preset: ChartRangePreset,
    anchorMonthStart: Date,
    dateSystem: string,
    formatDate: (d: Date) => string,
    formatDateBS: (d: Date) => string
): { name: string; amount: number }[] {
    const sorted = [...pointsByDay].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    if (!sorted.length) return [];
    const dayMap = new Map(sorted.map((p) => [p.dayKey, p.amount]));
    const dataMin = parseISO(sorted[0].dayKey);
    const dataMax = parseISO(sorted[sorted.length - 1].dayKey);

    // -------- Bikram Sambat: har column = ek Nepali mahina (Gregorian month split nahi). --------
    if (dateSystem === "BS") {
        const minBs = adToBs(dataMin);
        const maxBs = adToBs(dataMax);
        if (preset === "all") {
            const out: { name: string; amount: number }[] = [];
            let cy = minBs.y;
            let cm = minBs.m;
            const endIdx = maxBs.y * 12 + maxBs.m - 1;
            while (true) {
                const idx = cy * 12 + cm - 1;
                if (idx > endIdx) break;
                out.push({
                    name: labelNepaliMonthChart(cy, cm),
                    amount: sumAmountForBsMonth(dayMap, cy, cm),
                });
                const n = addBsMonths(cy, cm, 1);
                cy = n.y;
                cm = n.m;
            }
            return out;
        }

        const anchorBs = adToBs(anchorMonthStart);
        const ay = anchorBs.y;
        const am = anchorBs.m;

        if (preset === "month") {
            const dim = getBSMonthDays(ay)[am - 1];
            if (!dim) return [];
            const bsMonthStart = bsToAd({ y: ay, m: am, d: 1 });
            const bsMonthEnd = bsToAd({ y: ay, m: am, d: dim });
            const clipStart = bsMonthStart < startOfDay(dataMin) ? startOfDay(dataMin) : bsMonthStart;
            const clipEnd = bsMonthEnd > startOfDay(dataMax) ? startOfDay(dataMax) : bsMonthEnd;
            if (clipStart > clipEnd) return [];
            const days = eachDayOfInterval({ start: clipStart, end: clipEnd });
            return days.map((d) => ({
                name: formatDateBS(d),
                amount: dayMap.get(format(d, "yyyy-MM-dd")) || 0,
            }));
        }

        if (preset === "3m") {
            const m0 = addBsMonths(ay, am, -2);
            const m1 = addBsMonths(ay, am, -1);
            return [
                { y: m0.y, m: m0.m },
                { y: m1.y, m: m1.m },
                { y: ay, m: am },
            ].map(({ y, m }) => ({
                name: labelNepaliMonthChart(y, m),
                amount: sumAmountForBsMonth(dayMap, y, m),
            }));
        }

        if (preset === "6m") {
            return Array.from({ length: 6 }, (_, i) => addBsMonths(ay, am, -(5 - i))).map(({ y, m }) => ({
                name: labelNepaliMonthChart(y, m),
                amount: sumAmountForBsMonth(dayMap, y, m),
            }));
        }

        if (preset === "year") {
            return Array.from({ length: 12 }, (_, i) => addBsMonths(ay, am, -(11 - i))).map(({ y, m }) => ({
                name: labelNepaliMonthChart(y, m),
                amount: sumAmountForBsMonth(dayMap, y, m),
            }));
        }

        return [];
    }

    // -------- AD calendar (Gregorian months). --------
    const labelDay = (d: Date) => formatDate(d);
    const labelMonth = (d: Date) => format(startOfMonth(d), "MMM yyyy");

    if (preset === "all") {
        const out: { name: string; amount: number }[] = [];
        let cur = startOfMonth(dataMin);
        const endM = startOfMonth(dataMax);
        while (cur <= endM) {
            out.push({ name: labelMonth(cur), amount: sumAmountForCalendarMonth(dayMap, cur) });
            cur = addMonths(cur, 1);
        }
        return out;
    }

    const anchor = startOfMonth(anchorMonthStart);

    if (preset === "month") {
        const mStart = startOfMonth(anchor);
        const mEnd = endOfMonth(anchor);
        if (mStart > endOfMonth(dataMax) || mEnd < startOfMonth(dataMin)) return [];
        const clipStart = mStart < startOfMonth(dataMin) ? startOfMonth(dataMin) : mStart;
        const clipEnd = mEnd > endOfMonth(dataMax) ? endOfMonth(dataMax) : mEnd;
        const days = eachDayOfInterval({ start: clipStart, end: clipEnd });
        return days.map((d) => ({
            name: labelDay(d),
            amount: dayMap.get(format(d, "yyyy-MM-dd")) || 0,
        }));
    }

    if (preset === "3m") {
        const m0 = subMonths(anchor, 2);
        const m1 = subMonths(anchor, 1);
        const m2 = anchor;
        return [m0, m1, m2].map((ms) => ({
            name: labelMonth(ms),
            amount: sumAmountForCalendarMonth(dayMap, ms),
        }));
    }

    if (preset === "6m") {
        return Array.from({ length: 6 }, (_, i) => subMonths(anchor, 5 - i)).map((ms) => ({
            name: labelMonth(ms),
            amount: sumAmountForCalendarMonth(dayMap, ms),
        }));
    }

    if (preset === "year") {
        return Array.from({ length: 12 }, (_, i) => subMonths(anchor, 11 - i)).map((ms) => ({
            name: labelMonth(ms),
            amount: sumAmountForCalendarMonth(dayMap, ms),
        }));
    }

    return [];
}

/** Din ke hisaab se count — poori list (popup filter); mini chart ke liye `slice(-cap)`. */
function buildDailyCountPointsByDay(dates: (Date | null)[]): ChartDayPoint[] {
    const dayMap = new Map<string, number>();
    for (const d of dates) {
        if (!d || isNaN(d.getTime())) continue;
        const dayKey = format(startOfDay(d), "yyyy-MM-dd");
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);
    }
    return Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dayKey, amount]) => ({ dayKey, amount }));
}

/** Din ke hisaab se count series (nayi entities kitni add hui). */
function buildDailyCountChart(
    dates: (Date | null)[],
    dateSystem: string,
    formatDate: (d: Date) => string,
    formatDateBS: (d: Date) => string,
    cap = 40
): { name: string; amount: number }[] {
    const full = buildDailyCountPointsByDay(dates);
    const capped = full.slice(-cap);
    return capped.map(({ dayKey, amount }) => {
        const ad = new Date(`${dayKey}T12:00:00`);
        return { name: dateSystem === "BS" ? formatDateBS(ad) : formatDate(ad), amount };
    });
}

/** `financialSummary` / Outstanding card — shared R/P compute (party + bank + staff + tax/inc-exp). */
function computeOutstandingSnapshot(
    filteredVouchers: any[],
    processedParties: any[],
    processedStaff: any[],
    processedTaxes: any[],
    processedAccounts: any[] = [],
    processedExpenseAccounts: any[] = []
): { receivableSum: number; payableSum: number } {
    const snap = computeReceivablesPayablesFinancialSummary({
        vouchers: filteredVouchers,
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        processedExpenseAccounts,
        receivablesDateRange: undefined,
    });
    const notOB = (p: { party: string }) => p.party !== "Opening Balance";
    const receivableSum =
        snap.receivables.parties.filter(notOB).reduce((s, p) => s + (Number(p.balance) || 0), 0) +
        snap.receivables.accounts.filter(notOB).reduce((s, p) => s + (Number(p.balance) || 0), 0) +
        snap.receivables.staff.filter(notOB).reduce((s, p) => s + (Number(p.balance) || 0), 0) +
        snap.receivables.taxes.filter(notOB).reduce((s, p) => s + (Number(p.balance) || 0), 0) +
        snap.receivables.income.filter(notOB).reduce((s, p) => s + (Number(p.balance) || 0), 0) +
        snap.receivables.expenses.filter(notOB).reduce((s, p) => s + (Number(p.balance) || 0), 0);
    const payableSum =
        snap.payables.parties.filter(notOB).reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0) +
        snap.payables.accounts.filter(notOB).reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0) +
        snap.payables.staff.filter(notOB).reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0) +
        snap.payables.taxes.filter(notOB).reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0) +
        snap.payables.income.filter(notOB).reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0) +
        snap.payables.expenses.filter(notOB).reduce((s, p) => s + Math.abs(Number(p.balance) || 0), 0);
    return { receivableSum, payableSum };
}

type FinancialSummaryCardsProps = {
    vouchers: any[];
    processedParties: any[];
    processedStaff: any[];
    processedTaxes: any[];
    processedAccounts: any[];
    processedItems: any[];
    expenseAccounts: any[];
    loading?: boolean;
    showDetails?: boolean; // Show "View Details" buttons
    compact?: boolean; // Compact layout for report page
    /** Dashboard "Chart" tab: har voucher summary card ke niche din ke hisaab se amount sparkline/bar. */
    showVoucherDateCharts?: boolean;
    /** Dashboard Chart vs Line footer tab. */
    voucherDateChartKind?: "bar" | "line";
    /** Dashboard: Outstanding jaisa `col-span-1` cell — Auto recurring card (optional) */
    recurringSummarySlot?: React.ReactNode;
    /**
     * Tab active hai? `false` → Summary ke server calls (receivables/payables aggregation) nahi chalte.
     * Dashboard Summary tab hi `true` bhejta hai.
     */
    active?: boolean;
};

/** Dashboard Chart tab: avoid Recharts ResponsiveContainer resize storms while scrolling. */
const DASHBOARD_CHART_RESIZE_DEBOUNCE_MS = 400;
const DASHBOARD_CHART_LAZY_ROOT_MARGIN = "160px";

function DashboardScrollFriendlyChartHost({
    className,
    minHeight = 88,
    lazyNearViewport = false,
    children,
}: {
    className?: string;
    minHeight?: number;
    lazyNearViewport?: boolean;
    children: (size: { width: number; height: number }) => React.ReactNode;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [lazyVisible, setLazyVisible] = useState(!lazyNearViewport);
    const [size, setSize] = useState({ width: 0, height: minHeight });

    useEffect(() => {
        if (!lazyNearViewport || lazyVisible) return;
        const el = hostRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) setLazyVisible(true);
            },
            { root: null, rootMargin: DASHBOARD_CHART_LAZY_ROOT_MARGIN, threshold: 0.01 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [lazyNearViewport, lazyVisible]);

    useEffect(() => {
        if (!lazyVisible) return;
        const el = hostRef.current;
        if (!el) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const apply = () => {
            const width = Math.max(0, Math.floor(el.clientWidth));
            const height = Math.max(minHeight, Math.floor(el.clientHeight) || minHeight);
            setSize((prev) =>
                prev.width === width && prev.height === height ? prev : { width, height },
            );
        };
        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(apply, DASHBOARD_CHART_RESIZE_DEBOUNCE_MS);
        };
        apply();
        const ro = new ResizeObserver(schedule);
        ro.observe(el);
        return () => {
            ro.disconnect();
            if (timer) clearTimeout(timer);
        };
    }, [lazyVisible, minHeight]);

    return (
        <div ref={hostRef} className={cn("w-full", className)} style={{ minHeight }}>
            {lazyVisible && size.width > 0 ? children(size) : null}
        </div>
    );
}

// Custom MonthYearFilter wrapper for report page with overflow handling
const ReportMonthYearFilter = ({ dateRange, setDateRange, dateSystem }: { dateRange: DateRange | undefined, setDateRange: (range: DateRange | undefined) => void, dateSystem: string }) => {
    return (
        <div className="flex-shrink-0 min-w-0 max-w-[110px]">
            <div className="[&_button]:h-7 [&_button]:px-2 [&_button]:text-xs [&_button]:font-normal [&_button]:whitespace-nowrap [&_button]:overflow-hidden [&_button]:max-w-full [&_button]:flex [&_button]:items-center [&_button]:gap-1 [&_button_svg]:h-3 [&_button_svg]:w-3 [&_button_svg]:flex-shrink-0 [&_button>*:not(svg)]:truncate [&_button>*:not(svg)]:max-w-[60px]">
                <MonthYearFilter dateRange={dateRange} setDateRange={setDateRange} dateSystem={dateSystem} />
            </div>
        </div>
    );
};

/** Module scope — inline wrapper har parent render par remount karta tha (Auto recurring card flicker). */
const DASHBOARD_SUMMARY_BLUE_PILL_CN =
    "h-7 max-w-[7.5rem] shrink-0 truncate rounded-full border-blue-500/80 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 shadow-none hover:bg-blue-100 focus-visible:ring-blue-400 dark:border-blue-600 dark:bg-blue-950/45 dark:text-blue-200 dark:hover:bg-blue-950/60 [&_svg]:text-blue-600";

function TopSummaryRowWrap({
    compact,
    className,
    chartRowLayout,
    children,
}: {
    compact: boolean;
    className: string;
    /** Chart tab: 4 KPI cards full-width row (Stock niche alag row). */
    chartRowLayout?: boolean;
    children: React.ReactNode;
}) {
    if (compact) {
        return className ? <div className={className}>{children}</div> : <>{children}</>;
    }
    return (
        <div
            data-pl-dashboard-top-summary-row=""
            className={cn(
                "grid w-full min-w-0 max-w-full items-stretch gap-[5px] [&>*]:h-full [&>*]:min-h-[12rem] [&>*]:min-w-0",
                chartRowLayout
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
                    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(250px,1fr))]",
                className,
            )}
        >
            {children}
        </div>
    );
}

export function FinancialSummaryCards({
    vouchers: vouchersProp,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    processedItems,
    expenseAccounts,
    loading = false,
    showDetails = true,
    compact = false,
    showVoucherDateCharts = false,
    voucherDateChartKind = "bar",
    recurringSummarySlot,
    active = true,
}: FinancialSummaryCardsProps) {
    /** Live snapshot / SQLite merge nayi array de — current frame (scroll/click) pe heavy recompute mat lagao. */
    const vouchers = useDeferredValue(vouchersProp);
    const { formatCurrency, formatCurrencyForPrint, dateSystem, formatDate, formatDateBS } = useDate();
    const { can } = usePermissions();
    const { company } = useCompany();

    const {
        hiddenCategories: rpHiddenCategories,
        canEdit: canEditRpVisibility,
        filterSummary: filterRpSummary,
        saveHiddenCategories: saveRpHiddenCategories,
    } = useReceivablesPayablesEntityVisibility();

    // Helper function to truncate account names
    const truncateAccountName = (name: string, maxLength: number = 30) => {
        if (!name || name.length <= maxLength) return name;
        return name.substring(0, maxLength) + '...';
    };
    // Tax summary label override: keep requested wording only for VAT/Sales total footer row text.
    const getTaxTotalLabel = (taxName: string) =>
        taxName === "VAT / Sales Tax" ? "VAT / Sales, purchage Tax" : taxName;

    const currentDashboardMonthRange = React.useCallback(
        () => getCurrentMonthDateRange(dateSystem),
        [dateSystem]
    );

    // Dashboard cards default to current month. Opening-style cards still roll older vouchers into the range opening.
    const [receivablesDateRange, setReceivablesDateRange] = useState<DateRange | undefined>(() => currentDashboardMonthRange());

    /** Cloud: R/P totals server aggregation — vouchers par local reduce tabhi jab API use nahi ho sakti. */
    const {
        summary: serverRpSummary,
        loading: serverRpLoading,
        useClientFallback: serverRpClientFb,
        preferServer: preferServerRp,
    } = useServerReceivablesPayablesSummary({
        companyId: company?.id,
        storageOption: company?.storageOption,
        receivablesDateRange,
        enabled: active,
    });

    const [cashFlowDateRange, setCashFlowDateRange] = useState<DateRange | undefined>(() => currentDashboardMonthRange());
    const [taxDateRange, setTaxDateRange] = useState<DateRange | undefined>(() => currentDashboardMonthRange());
    const [stockDateRange, setStockDateRange] = useState<DateRange | undefined>(() => currentDashboardMonthRange());
    /**
     * Stock Summary card starts on the full period on purpose: stock is a running quantity, so a
     * month window would hide every item that did not move this month (and show Rs. 0.00 even when
     * the item ledger clearly holds stock). Explicit month picking still filters it.
     */
    const [stockSummaryScopeAll, setStockSummaryScopeAll] = useState(true);
    useEffect(() => { setStockSummaryScopeAll(true); }, [dateSystem]);
    const [dashboardCardScopes, setDashboardCardScopes] = useState<
        Record<string, DashboardSummaryCardScope>
    >({});

    const previousDateSystemRef = useRef(dateSystem);
    useEffect(() => {
        const previousDateSystem = previousDateSystemRef.current;
        if (previousDateSystem === dateSystem) return;
        const nextCurrentRange = getCurrentMonthDateRange(dateSystem);
        const keepCurrentMonthMode = (
            setRange: React.Dispatch<React.SetStateAction<DateRange | undefined>>
        ) => {
            setRange((range) =>
                isCurrentMonthDateRange(range, previousDateSystem) ? nextCurrentRange : range
            );
        };
        keepCurrentMonthMode(setReceivablesDateRange);
        keepCurrentMonthMode(setCashFlowDateRange);
        keepCurrentMonthMode(setTaxDateRange);
        keepCurrentMonthMode(setStockDateRange);
        setDashboardCardScopes((prev) => {
            const out = { ...prev };
            for (const key of Object.keys(out)) {
                out[key] = migrateDashboardScopeOnDateSystemChange(
                    out[key],
                    previousDateSystem,
                    dateSystem,
                );
            }
            return out;
        });
        previousDateSystemRef.current = dateSystem;
    }, [dateSystem]);

    // Dialog states
    const {
        open: receivablesPayablesOpen,
        setOutstandingOpen: setReceivablesPayablesOpen,
        setOutstandingTab: setReceivablesPayablesTab,
        openOutstandingDialog,
    } = useRpOutstandingDialog();
    const [cashFlowOpen, setCashFlowOpen] = useState(false);
    const [taxSummaryOpen, setTaxSummaryOpen] = useState(false);
    const [stockSummaryOpen, setStockSummaryOpen] = useState(false);
    const [bankCashSummaryOpen, setBankCashSummaryOpen] = useState(false);
    const [bankCashRotated, setBankCashRotated] = useState(false);
    const [selectedBankCashRowId, setSelectedBankCashRowId] = useState<string | null>(null);
    const [bankCashAccountPeek, setBankCashAccountPeek] = useState<{
        account: any;
        in: number;
        out: number;
        closing: number;
    } | null>(null);
    /** "View full" — `pointsByDay` se range (Day/Month/…) filter; ~90% screen. */
    const [dashboardChartFullView, setDashboardChartFullView] = useState<{
        subtitle: string;
        barColor: string;
        tooltipIsCount: boolean;
        pointsByDay: ChartDayPoint[];
    } | null>(null);
    const [chartFullRangePreset, setChartFullRangePreset] = useState<ChartRangePreset>("all");
    /** Full-view monthly anchor (rightmost month in 3M/6M/Year; Month view = yahi month ke din). */
    const [chartFullAnchorMonth, setChartFullAnchorMonth] = useState<Date>(() => startOfMonth(new Date()));

    // Filter states
    // Sirf yahi flow toggle (mobile/desktop); purana `cashFlowTab` hata — ReferenceError / duplicate UI avoid
    const [cashFlowFilter, setCashFlowFilter] = useState<'all' | 'inflow' | 'outflow'>('all');
    const [cashFlowCategoryFilter, setCashFlowCategoryFilter] = useState<'all' | 'party' | 'staff' | 'tax' | 'income_expense' | 'other'>('all');
    /** Mobile: Cash Flow dialog me row tap = poora account name (truncate ke bina); dubara tap se band — hover-tooltip jaisa */
    const [cashFlowExpandedNameKey, setCashFlowExpandedNameKey] = useState<string | null>(null);
    const [taxFilter, setTaxFilter] = useState<'all' | 'input' | 'output'>('all');
    const [selectedTaxId, setSelectedTaxId] = useState<string | null>(null);
    const [expandedTaxAccounts, setExpandedTaxAccounts] = useState<Set<string>>(new Set());
    const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
    
    const isMobile = useIsMobile();
    
    const toggleTaxAccount = (taxId: string) => {
        setExpandedTaxAccounts(prev => {
            const newSet = new Set(prev);
            if (newSet.has(taxId)) {
                newSet.delete(taxId);
            } else {
                newSet.add(taxId);
            }
            return newSet;
        });
    };
    
    const expandAllTaxAccounts = () => {
        if (transactionsByTaxAccount.length === 0) return;
        const allTaxIds = transactionsByTaxAccount.map(tg => tg.taxId);
        setExpandedTaxAccounts(new Set(allTaxIds));
    };
    
    const collapseAllTaxAccounts = () => {
        setExpandedTaxAccounts(new Set());
    };
    
    const toggleAllTaxAccounts = () => {
        if (transactionsByTaxAccount.length === 0) return;
        const allTaxIds = transactionsByTaxAccount.map(tg => tg.taxId);
        const allExpanded = allTaxIds.length > 0 && allTaxIds.every(id => expandedTaxAccounts.has(id));
        if (allExpanded) {
            collapseAllTaxAccounts();
        } else {
            expandAllTaxAccounts();
        }
    };

    // Chart full-screen: anchor = data ka latest month — BS me Nepali mahine ka pehla din (chevron ±1 BS month).
    useEffect(() => {
        if (!dashboardChartFullView?.pointsByDay?.length) return;
        const sorted = [...dashboardChartFullView.pointsByDay].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
        const maxD = parseISO(sorted[sorted.length - 1].dayKey);
        if (dateSystem === "BS") {
            const b = adToBs(maxD);
            setChartFullAnchorMonth(bsToAd({ y: b.y, m: b.m, d: 1 }));
        } else {
            setChartFullAnchorMonth(startOfMonth(maxD));
        }
    }, [dashboardChartFullView?.subtitle, dashboardChartFullView?.pointsByDay, chartFullRangePreset, dateSystem]);

    // Handle browser back button for dialogs on mobile
    useEffect(() => {
        if (!isMobile) return;
        
        // Tax Summary Dialog
        if (taxSummaryOpen && window.location.hash !== '#tax-summary') {
            window.history.pushState({ taxSummary: true }, '', '#tax-summary');
        }
        
        const handlePopState = (event: PopStateEvent) => {
            if (taxSummaryOpen && !event.state?.taxSummary) {
                setTaxSummaryOpen(false);
                setTaxFilter('all');
                setSelectedTaxId(null);
            }
            if (receivablesPayablesOpen && !event.state?.receivablesPayables) {
                setReceivablesPayablesOpen(false);
                setReceivablesPayablesTab('both');
            }
            if (cashFlowOpen && !event.state?.cashFlow) {
                setCashFlowOpen(false);
            }
            if (stockSummaryOpen && !event.state?.stockSummary) {
                setStockSummaryOpen(false);
            }
            if (bankCashSummaryOpen && !event.state?.bankCashSummary) {
                setBankCashSummaryOpen(false);
            }
        };
        
        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.location.hash === '#tax-summary' && !taxSummaryOpen) {
                window.history.back();
            }
        };
    }, [taxSummaryOpen, receivablesPayablesOpen, cashFlowOpen, stockSummaryOpen, bankCashSummaryOpen, isMobile]);

    useEffect(() => {
        if (!isMobile) return;
        if (receivablesPayablesOpen && window.location.hash !== '#receivables-payables') {
            window.history.pushState({ receivablesPayables: true }, '', '#receivables-payables');
        }
    }, [receivablesPayablesOpen, isMobile]);

    useEffect(() => {
        if (!isMobile) return;
        if (cashFlowOpen && window.location.hash !== '#cash-flow') {
            window.history.pushState({ cashFlow: true }, '', '#cash-flow');
        }
    }, [cashFlowOpen, isMobile]);

    useEffect(() => {
        setCashFlowExpandedNameKey(null);
    }, [cashFlowFilter, cashFlowCategoryFilter]);

    useEffect(() => {
        if (!isMobile) return;
        if (stockSummaryOpen && window.location.hash !== '#stock-summary') {
            window.history.pushState({ stockSummary: true }, '', '#stock-summary');
        }
    }, [stockSummaryOpen, isMobile]);

    useEffect(() => {
        if (!isMobile) return;
        if (bankCashSummaryOpen && window.location.hash !== '#bank-cash-summary') {
            window.history.pushState({ bankCashSummary: true }, '', '#bank-cash-summary');
        }
    }, [bankCashSummaryOpen, isMobile]);

    // ---------- FINANCIAL SUMMARY CALCULATION (Grouped) ----------
    const needClientRp =
        !preferServerRp ||
        serverRpClientFb ||
        (!serverRpSummary && !serverRpLoading);

    const clientFinancialSummary = useMemo(() => {
        if (!needClientRp) {
            return computeReceivablesPayablesFinancialSummary({
                vouchers,
                processedParties,
                processedStaff,
                processedTaxes,
                processedAccounts,
                processedExpenseAccounts: expenseAccounts,
                receivablesDateRange,
                loading: true,
            });
        }
        return computeReceivablesPayablesFinancialSummary({
            vouchers,
            processedParties,
            processedStaff,
            processedTaxes,
            processedAccounts,
            processedExpenseAccounts: expenseAccounts,
            receivablesDateRange,
            loading: !!loading,
        });
    }, [
        needClientRp,
        loading,
        vouchers,
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        expenseAccounts,
        receivablesDateRange,
    ]);

    const rawFinancialSummary = useMemo(() => {
        let raw;
        if (preferServerRp && !serverRpClientFb && serverRpSummary) {
            raw = serverRpSummary;
        } else if (preferServerRp && !serverRpClientFb && serverRpLoading) {
            raw = computeReceivablesPayablesFinancialSummary({
                vouchers,
                processedParties,
                processedStaff,
                processedTaxes,
                processedAccounts,
                processedExpenseAccounts: expenseAccounts,
                receivablesDateRange,
                loading: true,
            });
        } else {
            raw = clientFinancialSummary;
        }
        return normalizeReceivablesPayablesSummary(raw);
    }, [
        preferServerRp,
        serverRpClientFb,
        serverRpSummary,
        serverRpLoading,
        clientFinancialSummary,
        vouchers,
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        expenseAccounts,
        receivablesDateRange,
    ]);

    const financialSummary = useMemo(
        () => filterRpSummary(rawFinancialSummary),
        [rawFinancialSummary, filterRpSummary]
    );

    /** Outstanding card: totals same hon to display ref stable — background voucher context churn par card na hile. */
    const receivablesPayablesCardTotals = useMemo(() => {
        const receivableSum = sumRpDialogSide("receivables", financialSummary, "all");
        const payableSum = sumRpDialogSide("payables", financialSummary, "all");
        return { receivableSum, payableSum, net: receivableSum - payableSum };
    }, [financialSummary]);

    /** Outstanding card: totals same hon to display ref stable — background voucher context churn par card na hile. */
    const stableOutstandingTotalsRef = useRef(receivablesPayablesCardTotals);
    if (
        stableOutstandingTotalsRef.current.receivableSum !== receivablesPayablesCardTotals.receivableSum ||
        stableOutstandingTotalsRef.current.payableSum !== receivablesPayablesCardTotals.payableSum ||
        stableOutstandingTotalsRef.current.net !== receivablesPayablesCardTotals.net
    ) {
        stableOutstandingTotalsRef.current = receivablesPayablesCardTotals;
    }
    const outstandingCardTotals = stableOutstandingTotalsRef.current;

    // --- CASH FLOW CALCULATION ---
    const cashFlowDetails = useMemo(() => {
        let filteredVouchers = vouchers;
        if (cashFlowDateRange?.from) {
            const fromDate = startOfDay(cashFlowDateRange.from);
            const toDate = cashFlowDateRange.to ? endOfDay(cashFlowDateRange.to) : endOfDay(fromDate);
            filteredVouchers = vouchers.filter(v => {
                const txDate = safeToDate(v.date);
                return txDate && txDate >= fromDate && txDate <= toDate;
            });
        }

        type FlowItem = { id: string; name: string; amount: number; type: string };
        const inflowMap = new Map<string, FlowItem>();
        const outflowMap = new Map<string, FlowItem>();

        const getEntityType = (v: any): string => {
            if(v.partyId) return 'Party';
            if(v.staffId) return STAFF_ENTITY_LABEL;
            if(v.taxAccountId) return 'Tax';
            if(v.incomeAccountId || v.expenseAccountId || v.toAccountId) return 'Income/Expense';
            return 'Other';
        }

        const getEntityInfo = (v: any): {id: string, name: string} => {
            if(v.partyId) return {id: v.partyId, name: processedParties.find(p=>p.id === v.partyId)?.name || 'Unknown Party'};
            if(v.staffId) return {id: v.staffId, name: processedStaff.find(s=>s.id === v.staffId)?.name || 'Unknown Staff'};
            if(v.taxAccountId) return {id: v.taxAccountId, name: processedTaxes.find(t=>t.id === v.taxAccountId)?.name || 'Unknown Tax'};
            if(v.incomeAccountId) return {id: v.incomeAccountId, name: expenseAccounts.find(e=>e.id === v.incomeAccountId)?.name || 'Unknown Income'};
            if(v.expenseAccountId) return {id: v.expenseAccountId, name: expenseAccounts.find(e=>e.id === v.expenseAccountId)?.name || 'Unknown Expense'};
            if(v.toAccountId) return {id: v.toAccountId, name: expenseAccounts.find(e=>e.id === v.toAccountId)?.name || 'Unknown Account'};
            return {id: (v as any).payeeName || 'other', name: (v as any).payeeName || 'Other'};
        }

        const aggregate = (map: Map<string, FlowItem>, v: any, type: string, amount: number) => {
            const info = getEntityInfo(v);
            const key = `${getEntityType(v)}-${info.id}`;
            const existing = map.get(key);
            if (existing) {
                existing.amount += amount;
            } else {
                map.set(key, { id: info.id, name: info.name, amount: amount, type: getEntityType(v) });
            }
        };
        
        filteredVouchers.forEach(v => {
            const amt = Number(v.amount || v.total || 0);
            if (v.type === 'payment_in' || v.type === 'direct_income') aggregate(inflowMap, v, v.type, amt);
            if (v.type === 'payment_out' || v.type === 'direct_expense') aggregate(outflowMap, v, v.type, amt);
        });

        const inflow = Array.from(inflowMap.values());
        const outflow = Array.from(outflowMap.values());
        
        const totalInflow = inflow.reduce((s, i) => s + i.amount, 0);
        const totalOutflow = outflow.reduce((s, i) => s + i.amount, 0);

        const categorizedInflow = inflow.reduce((acc, item) => {
            const categoryKey = item.type.replace('/', '_').toLowerCase();
            if (!acc[categoryKey]) acc[categoryKey] = [];
            acc[categoryKey].push(item);
            return acc;
        }, {} as Record<string, FlowItem[]>);

        const categorizedOutflow = outflow.reduce((acc, item) => {
            const categoryKey = item.type.replace('/', '_').toLowerCase();
            if (!acc[categoryKey]) acc[categoryKey] = [];
            acc[categoryKey].push(item);
            return acc;
        }, {} as Record<string, FlowItem[]>);

        Object.values(categorizedInflow).forEach((arr) =>
            arr.sort((a, b) => Number(b.amount) - Number(a.amount))
        );
        Object.values(categorizedOutflow).forEach((arr) =>
            arr.sort((a, b) => Number(b.amount) - Number(a.amount))
        );

        return { categorizedInflow, categorizedOutflow, totalInflow, totalOutflow };
    }, [vouchers, cashFlowDateRange, processedParties, processedStaff, processedTaxes, expenseAccounts]);

    const taxSummary = useMemo(() => {
        if (!processedTaxes) return { totalInput: 0, totalOutput: 0, netBalance: 0, details: [] };
        const totalInput = processedTaxes.reduce((sum, tax) => sum + tax.debit, 0);
        const totalOutput = processedTaxes.reduce((sum, tax) => sum + tax.credit, 0);
        const netBalance = totalInput - totalOutput;
        const details = processedTaxes.map(tax => ({
            id: tax.id,
            name: tax.name,
            input: tax.debit,
            output: tax.credit,
            balance: tax.debit - tax.credit,
        }));
        details.sort((a, b) => Number(b.input) + Number(b.output) - (Number(a.input) + Number(a.output)));
        return {
            totalInput,
            totalOutput,
            netBalance,
            details,
        };
    }, [processedTaxes]);

    // Tax Breakdown Transactions
    const taxBreakdownTransactions = useMemo(() => {
        let filteredVouchers = vouchers;
        
        // Filter by date range
        if (taxDateRange?.from) {
            const fromDate = startOfDay(taxDateRange.from);
            const toDate = taxDateRange.to ? endOfDay(taxDateRange.to) : endOfDay(fromDate);
            filteredVouchers = vouchers.filter(v => {
                const txDate = safeToDate(v.date);
                if (!txDate) return false;
                const normalizedTxDate = startOfDay(txDate);
                return normalizedTxDate >= fromDate && normalizedTxDate <= toDate;
            });
        }

        const inputTransactions: any[] = [];
        const outputTransactions: any[] = [];
        let saleCount = 0;
        let purchaseCount = 0;
        let addSalaryCount = 0;

        filteredVouchers.forEach(v => {
            // Count transaction types
            if (v.type === 'sale') saleCount++;
            else if (v.type === 'purchase') purchaseCount++;
            else if (v.type === 'journal' && v.subType === 'add_salary') addSalaryCount++;

            // Process tax transactions
            if (v.type === 'payment_out' && v.taxAccountId) {
                const taxId = v.taxAccountId;
                if (!selectedTaxId || selectedTaxId === taxId) {
                    const tax = processedTaxes?.find(t => t.id === taxId);
                    const account = processedAccounts?.find(a => a.id === v.accountId);
                    inputTransactions.push({
                        id: v.id,
                        date: v.date,
                        voucherType: v.type,
                        voucherNumber: v.voucherNumber || v.invoiceNumber || '',
                        account: account?.accountName || account?.name || 'N/A',
                        debit: v.amount || 0,
                        credit: 0,
                        taxId: taxId,
                        taxName: tax?.name || 'N/A'
                    });
                }
            } else if (v.type === 'payment_in' && v.taxAccountId) {
                const taxId = v.taxAccountId;
                if (!selectedTaxId || selectedTaxId === taxId) {
                    const tax = processedTaxes?.find(t => t.id === taxId);
                    const account = processedAccounts?.find(a => a.id === v.accountId);
                    outputTransactions.push({
                        id: v.id,
                        date: v.date,
                        voucherType: v.type,
                        voucherNumber: v.voucherNumber || v.invoiceNumber || '',
                        account: account?.accountName || account?.name || 'N/A',
                        debit: 0,
                        credit: v.amount || 0,
                        taxId: taxId,
                        taxName: tax?.name || 'N/A'
                    });
                }
            } else if (v.lineItems && Array.isArray(v.lineItems)) {
                // lineIdx: khali line.itemId par `${v.id}--${taxId}` duplicate id + React "same key" warning
                v.lineItems.forEach((line: any, lineIdx: number) => {
                    if (line.taxAccountId) {
                        const taxId = line.taxAccountId;
                        if (!selectedTaxId || selectedTaxId === taxId) {
                            const tax = processedTaxes?.find(t => t.id === taxId);
                            const taxAmount = Number(line.taxAmount || 0);
                            if (taxAmount > 0) {
                                // Get party name for sale/purchase
                                const party = processedParties?.find(p => p.id === v.partyId);
                                const accountName = party?.name || v.partyName || 'N/A';
                                
                                if (v.type === 'sale') {
                                    outputTransactions.push({
                                        id: `${v.id}-L${lineIdx}-i${String(line.itemId ?? 'ni')}-${taxId}`,
                                        date: v.date,
                                        voucherType: v.type,
                                        voucherNumber: v.voucherNumber || v.invoiceNumber || '',
                                        account: accountName,
                                        debit: 0,
                                        credit: taxAmount,
                                        taxId: taxId,
                                        taxName: tax?.name || 'N/A'
                                    });
                                } else if (v.type === 'purchase') {
                                    inputTransactions.push({
                                        id: `${v.id}-L${lineIdx}-i${String(line.itemId ?? 'ni')}-${taxId}`,
                                        date: v.date,
                                        voucherType: v.type,
                                        voucherNumber: v.voucherNumber || v.invoiceNumber || '',
                                        account: accountName,
                                        debit: taxAmount,
                                        credit: 0,
                                        taxId: taxId,
                                        taxName: tax?.name || 'N/A'
                                    });
                                }
                            }
                        }
                    }
                });
            } else if (v.type === 'journal' && v.subType === 'add_salary' && Array.isArray(v.entries)) {
                v.entries.forEach((entry: any, entryIdx: number) => {
                    const taxId = entry.accountId;
                    if (processedTaxes?.some(t => t.id === taxId) && entry.credit > 0) {
                        if (!selectedTaxId || selectedTaxId === taxId) {
                            const tax = processedTaxes?.find(t => t.id === taxId);
                            // Extract staff ID from narration: "TDS for Staff Name (Staff ID: staffId)"
                            let staffId: string | null = null;
                            if (entry.narration) {
                                const match = entry.narration.match(/\(Staff ID:\s*([^)]+)\)/);
                                if (match && match[1]) {
                                    staffId = match[1].trim();
                                }
                            }
                            // If not found in narration, find staff entry from same voucher
                            if (!staffId) {
                                const staffEntry = v.entries.find((e: any) => 
                                    processedStaff?.some(s => s.id === e.accountId) && 
                                    e.credit > 0 &&
                                    e.narration && 
                                    e.narration.includes('Salary for')
                                );
                                staffId = staffEntry?.accountId || null;
                            }
                            // Get staff name
                            const staff = staffId ? processedStaff?.find(s => s.id === staffId) : null;
                            const accountName = staff?.name || 'N/A';
                            // Add salary tax is payable (liability), so it goes to outputTransactions (Receivable) as Credit
                            outputTransactions.push({
                                id: `${v.id}-E${entryIdx}-${entry.accountId}-${staffId || 'unknown'}`,
                                date: v.date,
                                voucherType: v.type,
                                voucherNumber: v.voucherNumber || '',
                                account: accountName,
                                debit: 0,
                                credit: entry.credit,
                                taxId: taxId,
                                taxName: tax?.name || 'N/A'
                            });
                        }
                    }
                });
            }
        });

        return {
            inputTransactions: inputTransactions.sort((a, b) => {
                const dateA = safeToDate(a.date)?.getTime() || 0;
                const dateB = safeToDate(b.date)?.getTime() || 0;
                return dateB - dateA;
            }),
            outputTransactions: outputTransactions.sort((a, b) => {
                const dateA = safeToDate(a.date)?.getTime() || 0;
                const dateB = safeToDate(b.date)?.getTime() || 0;
                return dateB - dateA;
            }),
            saleCount,
            purchaseCount,
            addSalaryCount
        };
    }, [vouchers, taxDateRange, selectedTaxId, processedTaxes, processedAccounts, processedParties, processedStaff]);

    // Group transactions by tax account
    const transactionsByTaxAccount = useMemo(() => {
        const grouped: Record<string, { 
            taxId: string; 
            taxName: string; 
            inputTransactions: any[]; 
            outputTransactions: any[] 
        }> = {};

        // Group input transactions
        taxBreakdownTransactions.inputTransactions.forEach(tx => {
            const key = tx.taxId || 'unknown';
            if (!grouped[key]) {
                grouped[key] = {
                    taxId: tx.taxId,
                    taxName: tx.taxName || 'Unknown Tax',
                    inputTransactions: [],
                    outputTransactions: []
                };
            }
            grouped[key].inputTransactions.push(tx);
        });

        // Group output transactions
        taxBreakdownTransactions.outputTransactions.forEach(tx => {
            const key = tx.taxId || 'unknown';
            if (!grouped[key]) {
                grouped[key] = {
                    taxId: tx.taxId,
                    taxName: tx.taxName || 'Unknown Tax',
                    inputTransactions: [],
                    outputTransactions: []
                };
            }
            grouped[key].outputTransactions.push(tx);
        });

        // Sort by tax name
        return Object.values(grouped).sort((a, b) =>
            a.taxName.localeCompare(b.taxName)
        );
    }, [taxBreakdownTransactions]);
    
    const areAllExpanded = useMemo(() => {
        if (transactionsByTaxAccount.length === 0) return false;
        const allTaxIds = transactionsByTaxAccount.map(tg => tg.taxId);
        return allTaxIds.length > 0 && allTaxIds.every(id => expandedTaxAccounts.has(id));
    }, [transactionsByTaxAccount, expandedTaxAccounts]);
    
    // Collect all visible transactions for keyboard navigation
    const allVisibleTransactions = useMemo(() => {
        const transactions: any[] = [];
        transactionsByTaxAccount.forEach(taxGroup => {
            if (taxFilter === 'all' || taxFilter === 'input') {
                taxGroup.inputTransactions.forEach(tx => transactions.push(tx));
            }
            if (taxFilter === 'all' || taxFilter === 'output') {
                taxGroup.outputTransactions.forEach(tx => transactions.push(tx));
            }
        });
        return transactions;
    }, [transactionsByTaxAccount, taxFilter]);
    
    // Reset selected transaction when dialog closes or filter changes
    useEffect(() => {
        if (!taxSummaryOpen) {
            setSelectedTransactionId(null);
        }
    }, [taxSummaryOpen]);
    
    useEffect(() => {
        setSelectedTransactionId(null);
    }, [taxFilter]);
    
    // Keyboard navigation handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (allVisibleTransactions.length === 0) return;
            if (!taxSummaryOpen) return;
            
            const currentIndex = allVisibleTransactions.findIndex(tx => tx.id === selectedTransactionId);
            
            if (e.key === "ArrowDown") {
                e.preventDefault();
                const nextIndex = Math.min(currentIndex + 1, allVisibleTransactions.length - 1);
                setSelectedTransactionId(allVisibleTransactions[nextIndex]?.id ?? null);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const prevIndex = Math.max(currentIndex - 1, 0);
                setSelectedTransactionId(allVisibleTransactions[prevIndex]?.id ?? null);
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [allVisibleTransactions, selectedTransactionId, taxSummaryOpen]);

    // STOCK SUMMARY DETAILS
    const overallStockSummary = useMemo(() => {
        // Default = full period (all stock). Only an explicitly picked month filters the list.
        let filteredVouchers = vouchers;
        if (!stockSummaryScopeAll && stockDateRange?.from) {
            const fromDate = startOfDay(stockDateRange.from);
            const toDate = stockDateRange.to ? endOfDay(stockDateRange.to) : endOfDay(fromDate);
            filteredVouchers = vouchers.filter(v => {
                const txDate = safeToDate(v.date);
                if (!txDate) return false;
                // Normalize transaction date to start of day for proper comparison
                const normalizedTxDate = startOfDay(txDate);
                return normalizedTxDate >= fromDate && normalizedTxDate <= toDate;
            });
        }

        let totalValue = 0;
        const itemMeta = processedItems.map((item) => {
            const conversions = (item.unitConversions || []) as any[];
            const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');

            const getFactorToSmallest = (unit: string): number => {
                if (!unit || conversions.length === 0 || unit === smallestUnit) return 1;

                let factor = 1;
                let current = unit;
                for (let i = 0; i < 10; i++) {
                    const conv = conversions.find((c) => c.fromUnit === current);
                    if (!conv) return 0;
                    factor *= Number(conv.conversionFactor) || 1;
                    current = conv.toUnit;
                    if (current === smallestUnit) break;
                }
                return factor;
            };

            const purchasePriceUnit = (item as any).purchasePriceUnit || smallestUnit;
            const purchasePriceFactor = getFactorToSmallest(purchasePriceUnit);
            const purchasePriceInSmallestUnit = purchasePriceFactor > 0 ? (item.purchasePrice || 0) / purchasePriceFactor : 0;
            const value = (item.stockQty || 0) * purchasePriceInSmallestUnit;
            totalValue += value;
            return { item, smallestUnit, getFactorToSmallest, value };
        });
        const metaById = new Map(itemMeta.map((m) => [String(m.item.id), m]));
        const movement = new Map<string, { salesQty: number; salesValue: number; purchaseQty: number; purchaseValue: number }>();
        for (const v of filteredVouchers) {
            if (v.type !== "sale" && v.type !== "purchase") continue;
            const lines = v.lineItems;
            if (!Array.isArray(lines)) continue;
            const seen = new Set<string>();
            for (const lineItem of lines) {
                const itemId = String(lineItem?.itemId || "");
                if (!itemId || seen.has(itemId)) continue;
                const meta = metaById.get(itemId);
                if (!meta) continue;
                seen.add(itemId);
                const qty = Number(lineItem.quantity) || 0;
                const lineValue = qty * (Number(lineItem.rate) || 0);
                const standardizedQty = qty * meta.getFactorToSmallest(lineItem.unit);
                const row = movement.get(itemId) || { salesQty: 0, salesValue: 0, purchaseQty: 0, purchaseValue: 0 };
                if (v.type === "sale") {
                    row.salesQty += standardizedQty;
                    row.salesValue += lineValue;
                } else {
                    row.purchaseQty += standardizedQty;
                    row.purchaseValue += lineValue;
                }
                movement.set(itemId, row);
            }
        }
        const itemsWithSales = itemMeta.map(({ item, smallestUnit, value }) => {
            const move = movement.get(String(item.id)) || {
                salesQty: 0,
                salesValue: 0,
                purchaseQty: 0,
                purchaseValue: 0,
            };
            return {
                ...item,
                qty: item.stockQty || 0,
                unit: smallestUnit,
                rate: item.purchasePrice || 0,
                value,
                salesQty: move.salesQty,
                salesValue: move.salesValue,
                purchaseQty: move.purchaseQty,
                purchaseValue: move.purchaseValue,
                smallestUnit,
            };
        });

        // Filter items to only show those with transactions in the selected date range
        // If date range is selected, only show items that have sales or purchases in that period
        let filteredItems = itemsWithSales;
        if (!stockSummaryScopeAll && stockDateRange?.from) {
            filteredItems = itemsWithSales.filter(item => 
                item.salesQty > 0 || item.purchaseQty > 0 || item.salesValue > 0 || item.purchaseValue > 0
            );
            // Recalculate totalValue based on filtered items
            totalValue = filteredItems.reduce((sum, item) => sum + item.value, 0);
        }

        filteredItems = [...filteredItems].sort((a, b) => Number(b.value) - Number(a.value));

        const topSaleItems = [...filteredItems].filter(i => i.salesQty > 0 || i.salesValue > 0).sort((a,b) => b.salesValue - a.salesValue).slice(0, 5);
        const topPurchaseItems = [...filteredItems].filter(i => i.purchaseQty > 0 || i.purchaseValue > 0).sort((a,b) => b.purchaseValue - a.purchaseValue).slice(0, 5);

        return { items: filteredItems, totalStockValue: totalValue, topSaleItems, topPurchaseItems };
    }, [processedItems, vouchers, stockDateRange, stockSummaryScopeAll]);

    // Bank & Cash Summary
    const bankCashSummary = useMemo(() => {
        if (!processedAccounts || !vouchers) return { 
            totalBankBalance: 0, 
            totalCashBalance: 0, 
            grandTotalBalance: 0,
            cashAccounts: [],
            bankAccounts: [],
            totalBankInflow: 0,
            totalBankOutflow: 0,
            totalCashInflow: 0,
            totalCashOutflow: 0
        };
        
        const todayEnd = endOfDay(new Date());
        const datedVouchers = vouchers.flatMap((v) => {
            const txDate = safeToDate(v.date);
            return txDate && txDate <= todayEnd ? [{ v, txDate }] : [];
        });

        const summaryAccounts = processedAccounts.map((acc) => {
            const newAcc = { ...acc, inflow: 0, outflow: 0, balance: Number(acc.openingBalance) || 0 };
            const accountObDate = safeToDate((acc as any).openingBalanceDate);

            const periodTx = accountObDate
                ? datedVouchers.filter((row) => row.txDate >= accountObDate)
                : datedVouchers;

            periodTx.forEach(({ v }) => {
                const { debit, credit } = getLedgerTransactionAmounts(v, "account", acc, "amount", processedItems, processedTaxes);
                newAcc.inflow += Number(debit) || 0;
                newAcc.outflow += Number(credit) || 0;
            });
            
            newAcc.balance += newAcc.inflow - newAcc.outflow;
            return newAcc;
        });

        const cashAccounts = summaryAccounts
            .filter((acc) => acc.accountType === 'Cash')
            .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
        const bankAccounts = summaryAccounts
            .filter((acc) => acc.accountType === 'Bank')
            .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
        
        const totalBankBalance = bankAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        const totalCashBalance = cashAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        const grandTotalBalance = totalBankBalance + totalCashBalance;
        
        const totalBankInflow = bankAccounts.reduce((sum, acc) => sum + acc.inflow, 0);
        const totalBankOutflow = bankAccounts.reduce((sum, acc) => sum + acc.outflow, 0);
        const totalCashInflow = cashAccounts.reduce((sum, acc) => sum + acc.inflow, 0);
        const totalCashOutflow = cashAccounts.reduce((sum, acc) => sum + acc.outflow, 0);
        
        return { 
            totalBankBalance, 
            totalCashBalance, 
            grandTotalBalance,
            cashAccounts,
            bankAccounts,
            totalBankInflow,
            totalBankOutflow,
            totalCashInflow,
            totalCashOutflow
        };
    }, [processedAccounts, vouchers, processedItems, processedTaxes]);

    // Print handlers
    const handlePrintCashFlow = () => {
        let dateRangeText = "All Time";
        if(cashFlowDateRange?.from) {
            const from = cashFlowDateRange.from;
            const to = cashFlowDateRange.to || from;
            const fromBS = formatDateBS(from);
            const toBS = formatDateBS(to);
            const fromAD = formatDate(from);
            const toAD = formatDate(to);
            if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD}${!isSameDay(from, to) ? ` to ${toAD}`: ''}`;
            else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS}${!isSameDay(from, to) ? ` to ${toBS}`: ''}`;
            else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
        }
        
        const showIn = cashFlowFilter === 'all' || cashFlowFilter === 'inflow';
        const showOut = cashFlowFilter === 'all' || cashFlowFilter === 'outflow';
        
        const inBody: any[] = [['Source', { text: 'Amount', alignment: 'right' }]];
        if(showIn) {
            orderedCashFlowCategories(cashFlowDetails.categorizedInflow).forEach(([category, items]) => {
                const catNormal = category.toLowerCase().replace(/\s+/g, '');
                const filterNormal = cashFlowCategoryFilter.toLowerCase().replace(/\s+/g, '');
                
                if (cashFlowCategoryFilter === 'all' || catNormal === filterNormal || (filterNormal === 'income_expense' && catNormal === 'income/expense') || (filterNormal === 'income_expense' && catNormal.includes('income'))) {
                    inBody.push([{text: category.replace('_', ' / ').toUpperCase(), bold: true, fillColor: '#f3f4f6', colSpan: 2}, {}]);
                    items.forEach(i => inBody.push([i.name, {text: formatCurrencyForPrint(i.amount, {noSuffix: true, noAnimation: true}), alignment: 'right'}]));
                }
            });
            inBody.push([{text: 'Total Inflow', bold: true}, {text: formatCurrencyForPrint(cashFlowDetails.totalInflow, {noSuffix: true, noAnimation: true}), bold: true, alignment: 'right', color: '#059669'}]);
        }
        
        const outBody: any[] = [['Destination', { text: 'Amount', alignment: 'right' }]];
        if(showOut) {
            orderedCashFlowCategories(cashFlowDetails.categorizedOutflow).forEach(([category, items]) => {
                const catNormal = category.toLowerCase().replace(/\s+/g, '');
                const filterNormal = cashFlowCategoryFilter.toLowerCase().replace(/\s+/g, '');
                
                if (cashFlowCategoryFilter === 'all' || catNormal === filterNormal || (filterNormal === 'income_expense' && catNormal === 'income/expense') || (filterNormal === 'income_expense' && catNormal.includes('expense'))) {
                    outBody.push([{text: category.replace('_', ' / ').toUpperCase(), bold: true, fillColor: '#f3f4f6', colSpan: 2}, {}]);
                    items.forEach(i => outBody.push([i.name, {text: formatCurrencyForPrint(i.amount, {noSuffix: true, noAnimation: true}), alignment: 'right'}]));
                }
            });
            outBody.push([{text: 'Total Outflow', bold: true}, {text: formatCurrencyForPrint(cashFlowDetails.totalOutflow, {noSuffix: true, noAnimation: true}), bold: true, alignment: 'right', color: '#DC2626'}]);
        }

        openPrintDirect({
            company: { name: company?.name || '', address: company?.address, phone: company?.phone, pan: company?.pan, decimalPlaces: company?.decimalPlaces, showDrCr: company?.showDrCr, showCurrencySymbol: company?.showCurrencySymbol, logoUrl: company?.logoUrl },
            dateSystem, 
            title: `Cash Flow (${cashFlowFilter.toUpperCase()} - ${cashFlowCategoryFilter.toUpperCase().replace('_', ' / ')})`, 
            dateRangeText,
            context: 'daybook', vouchersCount: 0, openingBalance: 0, transactions: [],
            customContent: [{ columns: [
                showIn ? { width: '*', stack: [{ text: 'Inflow', style: 'subheader', color: '#059669' }, { table: { widths: ['*', 'auto'], body: inBody }, layout: 'lightHorizontalLines' }] } : {width: 0, text: ''}, 
                showOut ? { width: '*', stack: [{ text: 'Outflow', style: 'subheader', color: '#DC2626' }, { table: { widths: ['*', 'auto'], body: outBody }, layout: 'lightHorizontalLines' }] } : {width: 0, text: ''}
            ], columnGap: 20 }]
        }, true);
    };

    const handlePrintTax = () => {
        let dateRangeText = "All Time";
        if(taxDateRange?.from) {
            const from = taxDateRange.from;
            const to = taxDateRange.to || from;
            const fromBS = formatDateBS(from);
            const toBS = formatDateBS(to);
            const fromAD = formatDate(from);
            const toAD = formatDate(to);
            if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD}${!isSameDay(from, to) ? ` to ${toAD}`: ''}`;
            else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS}${!isSameDay(from, to) ? ` to ${toBS}`: ''}`;
            else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
        }

        const showInput = taxFilter === 'all' || taxFilter === 'input';
        const showOutput = taxFilter === 'all' || taxFilter === 'output';

        // Group transactions by tax account
        const transactionsByTax: Record<string, { name: string; input: any[]; output: any[] }> = {};
        
        // Process input transactions
        if (showInput) {
            taxBreakdownTransactions.inputTransactions.forEach(tx => {
                if (!transactionsByTax[tx.taxId]) {
                    transactionsByTax[tx.taxId] = {
                        name: tx.taxName,
                        input: [],
                        output: []
                    };
                }
                transactionsByTax[tx.taxId].input.push(tx);
            });
        }
        
        // Process output transactions
        if (showOutput) {
            taxBreakdownTransactions.outputTransactions.forEach(tx => {
                if (!transactionsByTax[tx.taxId]) {
                    transactionsByTax[tx.taxId] = {
                        name: tx.taxName,
                        input: [],
                        output: []
                    };
                }
                transactionsByTax[tx.taxId].output.push(tx);
            });
        }

        // Build print content with transactions grouped by tax account and date
        const content: any[] = [];
        
        // Sort tax accounts by name
        const sortedTaxIds = Object.keys(transactionsByTax).sort((a, b) => 
            transactionsByTax[a].name.localeCompare(transactionsByTax[b].name)
        );

        sortedTaxIds.forEach(taxId => {
            const taxData = transactionsByTax[taxId];
            
            // Tax Account Header
            content.push({
                text: taxData.name,
                style: 'subheader',
                bold: true,
                fontSize: 11,
                margin: [0, 10, 0, 5]
            });

            // Group transactions by date
            const transactionsByDate: Record<string, { input: any[]; output: any[] }> = {};
            
            [...taxData.input, ...taxData.output].forEach(tx => {
                const txDate = safeToDate(tx.date);
                const dateKey = txDate ? (dateSystem === 'BS' ? formatDateBS(txDate) : dateSystem === 'AD' ? formatDate(txDate) : `${formatDateBS(txDate)} / ${formatDate(txDate)}`) : 'Unknown';
                
                if (!transactionsByDate[dateKey]) {
                    transactionsByDate[dateKey] = { input: [], output: [] };
                }
                
                if (tx.debit > 0) {
                    transactionsByDate[dateKey].input.push(tx);
                } else if (tx.credit > 0) {
                    transactionsByDate[dateKey].output.push(tx);
                }
            });

            // Sort dates descending
            const sortedDates = Object.keys(transactionsByDate).sort((a, b) => {
                // Find first transaction with this date to get actual date for sorting
                const txA = [...taxData.input, ...taxData.output].find(tx => {
                    const txDate = safeToDate(tx.date);
                    const dateKey = txDate ? (dateSystem === 'BS' ? formatDateBS(txDate) : dateSystem === 'AD' ? formatDate(txDate) : `${formatDateBS(txDate)} / ${formatDate(txDate)}`) : 'Unknown';
                    return dateKey === a;
                });
                const txB = [...taxData.input, ...taxData.output].find(tx => {
                    const txDate = safeToDate(tx.date);
                    const dateKey = txDate ? (dateSystem === 'BS' ? formatDateBS(txDate) : dateSystem === 'AD' ? formatDate(txDate) : `${formatDateBS(txDate)} / ${formatDate(txDate)}`) : 'Unknown';
                    return dateKey === b;
                });
                const dateA = safeToDate(txA?.date);
                const dateB = safeToDate(txB?.date);
                return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
            });

            // Calculate totals and voucher counts for this tax account
            const totalInput = taxData.input.reduce((sum, tx) => sum + tx.debit, 0);
            const totalOutput = taxData.output.reduce((sum, tx) => sum + tx.credit, 0);
            const netBalance = totalInput - totalOutput;
            
            // Count unique vouchers
            const inputVouchers = new Set(taxData.input.map(tx => tx.voucherNumber).filter(Boolean));
            const outputVouchers = new Set(taxData.output.map(tx => tx.voucherNumber).filter(Boolean));

            // Create table for this tax account
            const tableBody: any[] = [[
                { text: 'Date', bold: true, fontSize: 10 },
                { text: 'Voucher No', bold: true, fontSize: 10 },
                { text: 'Account', bold: true, fontSize: 10 },
                ...(showInput ? [{ text: 'Dr', bold: true, fontSize: 10, alignment: 'right' }] : []),
                ...(showOutput ? [{ text: 'Cr', bold: true, fontSize: 10, alignment: 'right' }] : [])
            ]];

            sortedDates.forEach(dateKey => {
                const dateTransactions = transactionsByDate[dateKey];
                
                // Add input transactions
                if (showInput && dateTransactions.input.length > 0) {
                    dateTransactions.input.forEach(tx => {
                        tableBody.push([
                            { text: dateKey, fontSize: 10 },
                            { text: tx.voucherNumber || '-', fontSize: 10 },
                            { text: truncateAccountName(tx.account, 25), fontSize: 10 },
                            ...(showInput ? [{ text: formatCurrencyForPrint(tx.debit, {noSuffix: true, noAnimation: true}), fontSize: 10, alignment: 'right', color: '#059669' }] : []),
                            ...(showOutput ? [{ text: '-', fontSize: 10, alignment: 'right' }] : [])
                        ]);
                    });
                }
                
                // Add output transactions
                if (showOutput && dateTransactions.output.length > 0) {
                    dateTransactions.output.forEach(tx => {
                        tableBody.push([
                            { text: dateKey, fontSize: 10 },
                            { text: tx.voucherNumber || '-', fontSize: 10 },
                            { text: truncateAccountName(tx.account, 25), fontSize: 10 },
                            ...(showInput ? [{ text: '-', fontSize: 10, alignment: 'right' }] : []),
                            ...(showOutput ? [{ text: formatCurrencyForPrint(tx.credit, {noSuffix: true, noAnimation: true}), fontSize: 10, alignment: 'right', color: '#DC2626' }] : [])
                        ]);
                    });
                }
            });

            // Add voucher count row (use { text: ' ' } for colspan placeholders - empty cells break pdfmake page breaks)
            tableBody.push([
                { text: 'Voucher Count', bold: true, fontSize: 10, colSpan: 3 },
                { text: ' ' },
                { text: ' ' },
                ...(showInput ? [{ text: String(inputVouchers.size), bold: true, fontSize: 10, alignment: 'right' }] : []),
                ...(showOutput ? [{ text: String(outputVouchers.size), bold: true, fontSize: 10, alignment: 'right' }] : [])
            ]);

            // Add total row
            tableBody.push([
                { text: 'Total', bold: true, fontSize: 10, colSpan: 3 },
                { text: ' ' },
                { text: ' ' },
                ...(showInput ? [{ text: formatCurrencyForPrint(totalInput, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 10, alignment: 'right', color: '#059669' }] : []),
                ...(showOutput ? [{ text: formatCurrencyForPrint(totalOutput, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 10, alignment: 'right', color: '#DC2626' }] : [])
            ]);

            // Add net balance row if both input and output are shown
            if (showInput && showOutput) {
                tableBody.push([
                    { text: 'Net Balance', bold: true, fontSize: 10, colSpan: 3 },
                    { text: ' ' },
                    { text: ' ' },
                    { text: formatCurrencyForPrint(Math.abs(netBalance), {noSuffix: true, noAnimation: true}) + (netBalance >= 0 ? ' Dr' : ' Cr'), bold: true, fontSize: 10, alignment: 'right', colSpan: 2 },
                    { text: ' ' }
                ]);
            }

            content.push({
                table: {
                    headerRows: 1,
                    widths: ['auto', 'auto', '*', ...(showInput ? ['auto'] : []), ...(showOutput ? ['auto'] : [])],
                    body: tableBody
                },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 15]
            });
        });
        
        // Calculate total unique vouchers across all tax accounts
        const allVouchers = new Set<string>();
        sortedTaxIds.forEach(taxId => {
            const taxData = transactionsByTax[taxId];
            taxData.input.forEach(tx => { if (tx.voucherNumber) allVouchers.add(tx.voucherNumber); });
            taxData.output.forEach(tx => { if (tx.voucherNumber) allVouchers.add(tx.voucherNumber); });
        });

        openPrintDirect({
            company: { name: company?.name || '', address: company?.address, phone: company?.phone, pan: company?.pan, decimalPlaces: company?.decimalPlaces, showDrCr: company?.showDrCr, showCurrencySymbol: company?.showCurrencySymbol, logoUrl: company?.logoUrl },
            dateSystem, 
            title: `Tax Summary (${taxFilter.toUpperCase()})`, 
            dateRangeText: dateRangeText,
            context: 'daybook', 
            vouchersCount: allVouchers.size, 
            openingBalance: 0, 
            transactions: [],
            customContent: content
        }, true);
    };

    const handlePrintStock = () => {
        let dateRangeText = "All Time";
        if(stockDateRange?.from) {
            const from = stockDateRange.from;
            const to = stockDateRange.to || from;
            const fromBS = formatDateBS(from);
            const toBS = formatDateBS(to);
            const fromAD = formatDate(from);
            const toAD = formatDate(to);
            if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD}${!isSameDay(from, to) ? ` to ${toAD}`: ''}`;
            else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS}${!isSameDay(from, to) ? ` to ${toBS}`: ''}`;
            else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
        }

        const body: any[] = [
            [
                { text: 'Item Name', bold: true, fontSize: 8 }, 
                { text: 'Qty', bold: true, fontSize: 8, alignment: 'right' }, 
                { text: 'Rate', bold: true, fontSize: 8, alignment: 'right' }, 
                { text: 'Value', bold: true, fontSize: 8, alignment: 'right' }
            ]
        ];
        overallStockSummary.items.forEach(i => {
            body.push([
                { text: i.name, fontSize: 7, noWrap: false }, 
                { text: `${i.qty.toFixed(2)} ${i.unit}`, fontSize: 7, alignment: 'right' }, 
                { text: formatCurrency(i.rate, {noSuffix: true, noAnimation: true}), fontSize: 7, alignment: 'right' }, 
                { text: formatCurrency(i.value, {noSuffix: true, noAnimation: true}), fontSize: 7, alignment: 'right' }
            ]);
        });
        body.push([
            {text: 'Total Stock Value', bold: true, fontSize: 8, colSpan: 3}, 
            {}, 
            {}, 
            {text: formatCurrency(overallStockSummary.totalStockValue, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 8, alignment: 'right'}
        ]);

        openPrintDirect({
            company: { name: company?.name || '', address: company?.address, phone: company?.phone, pan: company?.pan, logoUrl: company?.logoUrl },
            dateSystem, title: "Stock Summary", dateRangeText: dateRangeText,
            context: 'daybook', vouchersCount: 0, openingBalance: 0, transactions: [],
            customContent: [{ 
                table: { 
                    widths: ['*', 65, 65, 75], // Flexible first column, compact fixed widths for A4 paper (total ~205 + flexible)
                    body 
                }, 
                layout: {
                    hLineWidth: () => 0.5,
                    vLineWidth: () => 0,
                    paddingLeft: () => 2,
                    paddingRight: () => 2,
                    paddingTop: () => 2,
                    paddingBottom: () => 2,
                }
            }]
        }, true);
    };

    const handlePrintBankCash = () => {
        const today = new Date();
        const dateRangeText = dateSystem === "BS"
            ? `Today: ${formatDateBS(today)}`
            : dateSystem === "AD"
                ? `Today: ${formatDate(today)}`
                : `Today: ${formatDate(today)} / ${formatDateBS(today)}`;

        const body: any[] = [
            [
                { text: 'Account', bold: true, fontSize: 10 },
                { text: 'Type', bold: true, fontSize: 10 },
                { text: 'Total In', bold: true, fontSize: 10, alignment: 'right' },
                { text: 'Total Out', bold: true, fontSize: 10, alignment: 'right' },
                { text: 'Balance', bold: true, fontSize: 10, alignment: 'right' }
            ]
        ];

        // Bank accounts
        bankCashSummary.bankAccounts.forEach(acc => {
            const balance = acc.balance;
            const balanceText = balance !== 0 
                ? `${formatCurrencyForPrint(Math.abs(balance), {noSuffix: true, noAnimation: true})} ${balance >= 0 ? 'Dr' : 'Cr'}`
                : 'Rs. 0.00 Dr';
            body.push([
                { text: acc.accountName, fontSize: 9 },
                { text: acc.accountType, fontSize: 9 },
                { text: acc.inflow > 0 ? formatCurrencyForPrint(acc.inflow, {noSuffix: true, noAnimation: true}) : '-', fontSize: 9, alignment: 'right', color: '#059669' },
                { text: acc.outflow > 0 ? formatCurrencyForPrint(acc.outflow, {noSuffix: true, noAnimation: true}) : '-', fontSize: 9, alignment: 'right', color: '#DC2626' },
                { text: balanceText, fontSize: 9, alignment: 'right', bold: true, color: balance >= 0 ? '#059669' : '#DC2626' }
            ]);
        });

        // Bank Total
        const bankTotalBalance = bankCashSummary.bankAccounts.reduce((sum, a) => sum + a.balance, 0);
        const bankTotalText = `${formatCurrencyForPrint(Math.abs(bankTotalBalance), {noSuffix: true, noAnimation: true})} ${bankTotalBalance >= 0 ? 'Dr' : 'Cr'}`;
        body.push([
            { text: 'Bank Total', bold: true, fontSize: 10, colSpan: 2, fillColor: '#f3f4f6' },
            {},
            { text: formatCurrencyForPrint(bankCashSummary.totalBankInflow, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 10, alignment: 'right', color: '#059669', fillColor: '#f3f4f6' },
            { text: formatCurrencyForPrint(bankCashSummary.totalBankOutflow, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 10, alignment: 'right', color: '#DC2626', fillColor: '#f3f4f6' },
            { text: bankTotalText, bold: true, fontSize: 10, alignment: 'right', color: bankTotalBalance >= 0 ? '#059669' : '#DC2626', fillColor: '#f3f4f6' }
        ]);

        // Cash accounts
        bankCashSummary.cashAccounts.forEach(acc => {
            const balance = acc.balance;
            const balanceText = balance !== 0 
                ? `${formatCurrencyForPrint(Math.abs(balance), {noSuffix: true, noAnimation: true})} ${balance >= 0 ? 'Dr' : 'Cr'}`
                : 'Rs. 0.00 Dr';
            body.push([
                { text: acc.accountName, fontSize: 9 },
                { text: acc.accountType, fontSize: 9 },
                { text: acc.inflow > 0 ? formatCurrencyForPrint(acc.inflow, {noSuffix: true, noAnimation: true}) : '-', fontSize: 9, alignment: 'right', color: '#059669' },
                { text: acc.outflow > 0 ? formatCurrencyForPrint(acc.outflow, {noSuffix: true, noAnimation: true}) : '-', fontSize: 9, alignment: 'right', color: '#DC2626' },
                { text: balanceText, fontSize: 9, alignment: 'right', bold: true, color: balance >= 0 ? '#059669' : '#DC2626' }
            ]);
        });

        // Cash Total
        const cashTotalBalance = bankCashSummary.cashAccounts.reduce((sum, a) => sum + a.balance, 0);
        const cashTotalText = `${formatCurrencyForPrint(Math.abs(cashTotalBalance), {noSuffix: true, noAnimation: true})} ${cashTotalBalance >= 0 ? 'Dr' : 'Cr'}`;
        body.push([
            { text: 'Cash Total', bold: true, fontSize: 10, colSpan: 2, fillColor: '#f3f4f6' },
            {},
            { text: formatCurrencyForPrint(bankCashSummary.totalCashInflow, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 10, alignment: 'right', color: '#059669', fillColor: '#f3f4f6' },
            { text: formatCurrencyForPrint(bankCashSummary.totalCashOutflow, {noSuffix: true, noAnimation: true}), bold: true, fontSize: 10, alignment: 'right', color: '#DC2626', fillColor: '#f3f4f6' },
            { text: cashTotalText, bold: true, fontSize: 10, alignment: 'right', color: cashTotalBalance >= 0 ? '#059669' : '#DC2626', fillColor: '#f3f4f6' }
        ]);

        openPrintDirect({
            company: { 
                name: company?.name || '', 
                address: company?.address, 
                phone: company?.phone, 
                pan: company?.pan,
                decimalPlaces: company?.decimalPlaces,
                showDrCr: company?.showDrCr,
                showCurrencySymbol: company?.showCurrencySymbol,
                logoUrl: company?.logoUrl
            },
            dateSystem,
            title: "Bank & Cash Summary",
            dateRangeText,
            context: 'daybook',
            vouchersCount: 0,
            openingBalance: 0,
            transactions: [],
            customContent: [{
                table: {
                    widths: ['*', 'auto', 'auto', 'auto', 'auto'],
                    body
                },
                layout: 'lightHorizontalLines'
            }]
        }, true); // Pass true to open in new tab instead of print dialog
    };

    // Stats calculation for voucher type summaries
    // `payment_out_excl_pay_salary` = Payment minus staff / pay_salary payouts (unhi ka `Pay Salary` card)
    const statCardData = [
        { title: 'Sales', icon: ShoppingBag, type: 'sale', link: '/sale', isCredit: true },
        { title: 'Purchases', icon: ShoppingCart, type: 'purchase', link: '/purchase', isCredit: false },
        { title: 'Journals', icon: BookText, type: 'journal', link: '/journal', isCredit: false },
        { title: 'Add Salary', icon: FileDigit, type: 'add_salary', link: '/add-salary', isCredit: false },
        { title: 'Contra', icon: Landmark, type: 'contra', link: '/contra', isCredit: false },
        { title: 'Direct Income', icon: TrendingUp, type: 'direct_income', link: '/incomes', isCredit: true },
        { title: 'Direct Expense', icon: TrendingDown, type: 'direct_expense', link: '/incomes', isCredit: false },
        { title: 'Receipt', icon: ArrowDownCircle, type: 'payment_in', link: '/payment-in', isCredit: true },
        { title: 'Payment', icon: ArrowUpCircle, type: 'payment_out_excl_pay_salary', link: '/payment-out', isCredit: false },
        { title: 'Pay Salary', icon: HandCoins, type: 'pay_salary', link: '/add-salary', isCredit: false },
        { title: 'Notes', icon: StickyNote, type: 'note', link: '/notes', isCredit: true },
        { title: 'Production', icon: Factory, type: 'production', link: '/production', isCredit: true },
    ];

    const getTransactionAmounts = (transaction: any) => {
        const t = transaction;
        const amount = Number(t.total || t.amount || 0);
        let debit = 0;
        let credit = 0;

        switch (t.type) {
            case 'sale':
            case 'direct_income':
            case 'payment_in': 
                credit = amount;
                break;
            case 'purchase':
            case 'direct_expense':
            case 'payment_out':
                debit = amount;
                break;
            case 'contra':
                debit = amount;
                credit = amount;
                break;
            case 'journal':
                if (t.entries && Array.isArray(t.entries)) {
                    debit = t.entries.reduce((sum: number, e: any) => sum + Number(e.debit || 0), 0);
                    credit = t.entries.reduce((sum: number, e: any) => sum + Number(e.credit || 0), 0);
                }
                break;
        }
        return { debit, credit };
    };

    const companyCountry = company?.country || "Nepal";
    const companyFyDates = useMemo(() => resolveCompanyFiscalYearDates(company), [company]);
    const runningFyKey = useMemo(
        () => getAnusuchi13FyKey(companyCountry, new Date(), companyFyDates),
        [companyCountry, companyFyDates],
    );
    const entityVoucherFyKeys = useMemo(() => {
        const keys = new Set<string>();
        keys.add(runningFyKey);
        for (const v of vouchers || []) {
            const d = safeToDate(v.date);
            if (d) keys.add(getAnusuchi13FyKey(companyCountry, d, companyFyDates));
        }
        return [...keys].sort((a, b) => {
            const aStart = Number(a.split("-")[0]) || 0;
            const bStart = Number(b.split("-")[0]) || 0;
            return bStart - aStart;
        });
    }, [vouchers, companyCountry, companyFyDates, runningFyKey]);

    const defaultDashboardCardScope = useMemo(
        () => defaultDashboardSummaryCardScope(dateSystem),
        [dateSystem],
    );

    const dashboardScopeContext = useMemo(
        () => ({
            dateSystem,
            runningFyKey,
            companyCountry,
            companyFyDates,
        }),
        [dateSystem, runningFyKey, companyCountry, companyFyDates],
    );

    const allDashboardScopeCardKeys = [
        ...statCardData.map((c) => c.type),
        "entity:parties",
        "entity:staff",
        "entity:bank_cash",
        "entity:items",
        "entity:vouchers",
    ];

    const resolveDashboardCardScope = useCallback(
        (cardKey: string): DashboardSummaryCardScope =>
            dashboardCardScopes[cardKey] ?? defaultDashboardCardScope,
        [dashboardCardScopes, defaultDashboardCardScope],
    );

    const handleDashboardScopeApply = useCallback(
        (cardKey: string, payload: DashboardScopeApplyPayload) => {
            const nextScope = buildDashboardScopeFromApply(payload, dateSystem);
            setDashboardCardScopes((prev) => {
                const keys = payload.applyOnAll ? allDashboardScopeCardKeys : [cardKey];
                const out = { ...prev };
                for (const k of keys) out[k] = nextScope;
                return out;
            });
        },
        [dateSystem, statCardData],
    );

    const formatScopeHintForCard = useCallback(
        (cardKey: string) =>
            formatDashboardScopeHint(resolveDashboardCardScope(cardKey), {
                ...dashboardScopeContext,
                formatDate,
                formatDateBS,
            }),
        [resolveDashboardCardScope, dashboardScopeContext, formatDate, formatDateBS],
    );

    const entityScopedLists = useMemo(() => {
        const partiesScope = resolveDashboardCardScope("entity:parties");
        const staffScope = resolveDashboardCardScope("entity:staff");
        const bankCashScope = resolveDashboardCardScope("entity:bank_cash");
        const itemsScope = resolveDashboardCardScope("entity:items");
        const vouchersScope = resolveDashboardCardScope("entity:vouchers");
        return {
            parties: processedParties.filter(
                (p: any) =>
                    entityMasterDateInDashboardScope(
                        pickEntityCreatedAt(p),
                        partiesScope,
                        dashboardScopeContext,
                    ),
            ),
            staff: processedStaff.filter((s: any) =>
                entityMasterDateInDashboardScope(
                    pickEntityCreatedAt(s),
                    staffScope,
                    dashboardScopeContext,
                ),
            ),
            accounts: processedAccounts.filter((a: any) =>
                entityMasterDateInDashboardScope(
                    pickEntityCreatedAt(a),
                    bankCashScope,
                    dashboardScopeContext,
                ),
            ),
            items: processedItems.filter((i: any) =>
                entityMasterDateInDashboardScope(
                    pickEntityCreatedAt(i),
                    itemsScope,
                    dashboardScopeContext,
                ),
            ),
            vouchers: filterVouchersByDashboardScope(
                vouchers,
                vouchersScope,
                dashboardScopeContext,
                safeToDate,
            ),
        };
    }, [
        resolveDashboardCardScope,
        dashboardScopeContext,
        processedParties,
        processedStaff,
        processedAccounts,
        processedItems,
        vouchers,
    ]);

    /** @deprecated Per-card scope — keep aliases so chart/summary paths stay stable. */
    const entityFilteredParties = entityScopedLists.parties;
    const entityFilteredStaff = entityScopedLists.staff;
    const entityFilteredAccounts = entityScopedLists.accounts;
    const entityFilteredItems = entityScopedLists.items;
    const entityVouchersFiltered = entityScopedLists.vouchers;

    const renderDashboardSummaryScopeControls = (cardKey: string) => {
        const scope = resolveDashboardCardScope(cardKey);
        return (
            <MonthYearFilter
                dateRange={scope.dateRange}
                setDateRange={() => {}}
                dateSystem={dateSystem}
                showFullFyOption
                showDashboardFyScope
                dashboardFyPick={scope.fyPick}
                runningFyKey={runningFyKey}
                extraFyKeys={entityVoucherFyKeys}
                showApplyOnAll
                triggerClassName={DASHBOARD_SUMMARY_BLUE_PILL_CN}
                filterMode={dashboardScopeToFilterMode(scope)}
                onDashboardScopeApply={(payload) => handleDashboardScopeApply(cardKey, payload)}
            />
        );
    };

    const stats = useMemo(() => {
        if (!vouchers) return { otherStats: statCardData.map(s => ({ ...s, total: 0, count: 0 })) };

        const otherStats = statCardData.map((card) => {
            const cardScope = resolveDashboardCardScope(card.type);
            const scopedVouchers = filterVouchersByDashboardScope(
                vouchers,
                cardScope,
                dashboardScopeContext,
                safeToDate,
            );
            const filteredVouchers = scopedVouchers.filter((v) => {
                if (card.type === 'journal') return v.type === 'journal' && !v.subType;
                if (card.type === 'add_salary') return v.type === 'journal' && v.subType === 'add_salary';
                if (card.type === 'pay_salary') return voucherCountsAsDashboardPaySalary(v);
                if (card.type === 'payment_out_excl_pay_salary') return voucherCountsAsDashboardPaymentOutExcludingPaySalary(v);
                return v.type === card.type;
            });

            let total = 0;
            if (card.type === 'journal' || card.type === 'add_salary' || card.type === 'contra') {
                total = filteredVouchers.reduce((sum, v) => sum + Number(getTransactionAmounts(v).debit), 0);
            } else {
                total = filteredVouchers.reduce((sum, v) => sum + Number(v.total || v.amount || 0), 0);
            }

            return { ...card, total, count: filteredVouchers.length };
        });

        return { otherStats };
    }, [vouchers, resolveDashboardCardScope, dashboardScopeContext]);

    // Chart tab: har voucher-type card ke liye din (AD calendar day) par total amount — dashboard totals se same filter/amount rules.
    const voucherStatDateChartData = useMemo(() => {
        if (!showVoucherDateCharts || !vouchers?.length) return {} as Record<string, { name: string; amount: number }[]>;
        const matchCard = (v: any, cardType: string) => {
            if (cardType === "journal") return v.type === "journal" && !v.subType;
            if (cardType === "add_salary") return v.type === "journal" && v.subType === "add_salary";
            if (cardType === "pay_salary") return voucherCountsAsDashboardPaySalary(v);
            if (cardType === "payment_out_excl_pay_salary") return voucherCountsAsDashboardPaymentOutExcludingPaySalary(v);
            return v.type === cardType;
        };
        const rowAmount = (v: any, cardType: string) => {
            if (cardType === "journal" || cardType === "add_salary" || cardType === "contra") {
                return Number(getTransactionAmounts(v).debit) || 0;
            }
            return Number(v.total || v.amount || 0) || 0;
        };
        const out: Record<string, { name: string; amount: number }[]> = {};
        for (const card of statCardData) {
            const cardScope = resolveDashboardCardScope(card.type);
            const scopedVouchers = filterVouchersByDashboardScope(
                vouchers,
                cardScope,
                dashboardScopeContext,
                safeToDate,
            );
            const filtered = scopedVouchers.filter((v) => matchCard(v, card.type));
            const dayMap = new Map<string, number>();
            for (const v of filtered) {
                const d = safeToDate(v.date);
                if (!d) continue;
                const dayKey = format(d, "yyyy-MM-dd");
                dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + rowAmount(v, card.type));
            }
            const sorted = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));
            const capped = sorted.slice(-40);
            out[card.type] = capped.map(([dayKey, amount]) => {
                const ad = new Date(`${dayKey}T12:00:00`);
                const name = dateSystem === "BS" ? formatDateBS(ad) : formatDate(ad);
                return { name, amount };
            });
        }
        return out;
    }, [
        showVoucherDateCharts,
        vouchers,
        resolveDashboardCardScope,
        dashboardScopeContext,
        dateSystem,
        formatDate,
        formatDateBS,
    ]);

    // Chart tab: Cash Flow card — voucher date + card wala month filter; 3 mini bars (in / out / net).
    const dashboardCashFlowDailyTri = useMemo(() => {
        const empty = {
            inflow: [] as { name: string; amount: number }[],
            outflow: [] as { name: string; amount: number }[],
            net: [] as { name: string; amount: number }[],
            inflowPointsByDay: [] as ChartDayPoint[],
            outflowPointsByDay: [] as ChartDayPoint[],
            netPointsByDay: [] as ChartDayPoint[],
        };
        if (!showVoucherDateCharts) return empty;
        let filtered = vouchers || [];
        if (cashFlowDateRange?.from) {
            const fromDate = startOfDay(cashFlowDateRange.from);
            const toDate = cashFlowDateRange.to ? endOfDay(cashFlowDateRange.to) : endOfDay(fromDate);
            filtered = filtered.filter((v) => {
                const txDate = safeToDate(v.date);
                return txDate && txDate >= fromDate && txDate <= toDate;
            });
        }
        const inMap = new Map<string, number>();
        const outMap = new Map<string, number>();
        filtered.forEach((v: any) => {
            const d = safeToDate(v.date);
            if (!d) return;
            const k = format(startOfDay(d), "yyyy-MM-dd");
            const amt = Number(v.amount || v.total || 0);
            if (v.type === "payment_in" || v.type === "direct_income") inMap.set(k, (inMap.get(k) || 0) + amt);
            if (v.type === "payment_out" || v.type === "direct_expense") outMap.set(k, (outMap.get(k) || 0) + amt);
        });
        const allK = [...new Set([...inMap.keys(), ...outMap.keys()])].sort();
        const capKeys = allK.slice(-40);
        const labelFor = (dayKey: string) => {
            const ad = new Date(`${dayKey}T12:00:00`);
            return dateSystem === "BS" ? formatDateBS(ad) : formatDate(ad);
        };
        const inflowPointsByDay: ChartDayPoint[] = allK.map((k) => ({ dayKey: k, amount: inMap.get(k) || 0 }));
        const outflowPointsByDay: ChartDayPoint[] = allK.map((k) => ({ dayKey: k, amount: outMap.get(k) || 0 }));
        const netPointsByDay: ChartDayPoint[] = allK.map((k) => ({
            dayKey: k,
            amount: (inMap.get(k) || 0) - (outMap.get(k) || 0),
        }));
        const inflow = capKeys.map((k) => ({ name: labelFor(k), amount: inMap.get(k) || 0 }));
        const outflow = capKeys.map((k) => ({ name: labelFor(k), amount: outMap.get(k) || 0 }));
        const net = capKeys.map((k) => ({ name: labelFor(k), amount: (inMap.get(k) || 0) - (outMap.get(k) || 0) }));
        return { inflow, outflow, net, inflowPointsByDay, outflowPointsByDay, netPointsByDay };
    }, [showVoucherDateCharts, vouchers, cashFlowDateRange, dateSystem, formatDate, formatDateBS]);

    // Chart tab: Tax Summary — `taxBreakdownTransactions` jaisa logic, saari taxes; card ka `taxDateRange`.
    const dashboardTaxDailyTri = useMemo(() => {
        const empty = {
            input: [] as { name: string; amount: number }[],
            output: [] as { name: string; amount: number }[],
            net: [] as { name: string; amount: number }[],
            inputPointsByDay: [] as ChartDayPoint[],
            outputPointsByDay: [] as ChartDayPoint[],
            netPointsByDay: [] as ChartDayPoint[],
        };
        if (!showVoucherDateCharts) return empty;
        let filteredVouchers = vouchers || [];
        if (taxDateRange?.from) {
            const fromDate = startOfDay(taxDateRange.from);
            const toDate = taxDateRange.to ? endOfDay(taxDateRange.to) : endOfDay(fromDate);
            filteredVouchers = filteredVouchers.filter((v) => {
                const txDate = safeToDate(v.date);
                if (!txDate) return false;
                return startOfDay(txDate) >= fromDate && startOfDay(txDate) <= toDate;
            });
        }
        const inputMap = new Map<string, number>();
        const outputMap = new Map<string, number>();
        const addIn = (date: any, val: number) => {
            const d = safeToDate(date);
            if (!d || !val) return;
            const k = format(startOfDay(d), "yyyy-MM-dd");
            inputMap.set(k, (inputMap.get(k) || 0) + val);
        };
        const addOut = (date: any, val: number) => {
            const d = safeToDate(date);
            if (!d || !val) return;
            const k = format(startOfDay(d), "yyyy-MM-dd");
            outputMap.set(k, (outputMap.get(k) || 0) + val);
        };
        filteredVouchers.forEach((v: any) => {
            if (v.type === "payment_out" && v.taxAccountId) {
                addIn(v.date, Number(v.amount || 0));
            } else if (v.type === "payment_in" && v.taxAccountId) {
                addOut(v.date, Number(v.amount || 0));
            } else if (v.lineItems && Array.isArray(v.lineItems)) {
                v.lineItems.forEach((line: any) => {
                    if (!line.taxAccountId) return;
                    const taxAmt = Number(line.taxAmount || 0);
                    if (taxAmt <= 0) return;
                    if (v.type === "sale") addOut(v.date, taxAmt);
                    else if (v.type === "purchase") addIn(v.date, taxAmt);
                });
            } else if (v.type === "journal" && v.subType === "add_salary" && Array.isArray(v.entries)) {
                v.entries.forEach((entry: any) => {
                    if (!processedTaxes?.some((t: any) => t.id === entry.accountId) || !(Number(entry.credit) > 0))
                        return;
                    addOut(v.date, Number(entry.credit || 0));
                });
            }
        });
        const allK = [...new Set([...inputMap.keys(), ...outputMap.keys()])].sort();
        const capKeys = allK.slice(-40);
        const labelFor = (dayKey: string) => {
            const ad = new Date(`${dayKey}T12:00:00`);
            return dateSystem === "BS" ? formatDateBS(ad) : formatDate(ad);
        };
        const inputPointsByDay: ChartDayPoint[] = allK.map((k) => ({ dayKey: k, amount: inputMap.get(k) || 0 }));
        const outputPointsByDay: ChartDayPoint[] = allK.map((k) => ({ dayKey: k, amount: outputMap.get(k) || 0 }));
        const netPointsByDay: ChartDayPoint[] = allK.map((k) => ({
            dayKey: k,
            amount: (inputMap.get(k) || 0) - (outputMap.get(k) || 0),
        }));
        const input = capKeys.map((k) => ({ name: labelFor(k), amount: inputMap.get(k) || 0 }));
        const output = capKeys.map((k) => ({ name: labelFor(k), amount: outputMap.get(k) || 0 }));
        const net = capKeys.map((k) => ({ name: labelFor(k), amount: (inputMap.get(k) || 0) - (outputMap.get(k) || 0) }));
        return { input, output, net, inputPointsByDay, outputPointsByDay, netPointsByDay };
    }, [showVoucherDateCharts, vouchers, taxDateRange, processedTaxes, dateSystem, formatDate, formatDateBS]);

    // Chart tab: Outstanding — din ke end tak cumulative To Receive / To Pay / Net (card logic + `receivablesDateRange`).
    const dashboardOutstandingBalanceTri = useMemo(() => {
        const empty = {
            toReceive: [] as { name: string; amount: number }[],
            toPay: [] as { name: string; amount: number }[],
            net: [] as { name: string; amount: number }[],
            toReceivePointsByDay: [] as ChartDayPoint[],
            toPayPointsByDay: [] as ChartDayPoint[],
            netPointsByDay: [] as ChartDayPoint[],
        };
        if (!showVoucherDateCharts || loading) return empty;

        const labelForDay = (day: Date) => (dateSystem === "BS" ? formatDateBS(day) : formatDate(day));

        let dayBoundaries: Date[] = [];

        if (receivablesDateRange?.from) {
            const fromDate = startOfDay(receivablesDateRange.from);
            const toDate = receivablesDateRange.to ? endOfDay(receivablesDateRange.to) : endOfDay(fromDate);
            for (let d = new Date(fromDate); d <= toDate; d = addDays(d, 1)) {
                dayBoundaries.push(new Date(d));
            }
            if (dayBoundaries.length > 60) dayBoundaries = dayBoundaries.slice(-60);
        } else {
            const dates = vouchers.map((v) => safeToDate(v.date)).filter(Boolean) as Date[];
            if (dates.length === 0) {
                const now = new Date();
                const { receivableSum, payableSum } = computeOutstandingSnapshot(
                    [],
                    processedParties,
                    processedStaff,
                    processedTaxes,
                    processedAccounts,
                    expenseAccounts
                );
                const label = labelForDay(now);
                const dk = format(startOfDay(now), "yyyy-MM-dd");
                return {
                    toReceive: [{ name: label, amount: receivableSum }],
                    toPay: [{ name: label, amount: payableSum }],
                    net: [{ name: label, amount: receivableSum - payableSum }],
                    toReceivePointsByDay: [{ dayKey: dk, amount: receivableSum }],
                    toPayPointsByDay: [{ dayKey: dk, amount: payableSum }],
                    netPointsByDay: [{ dayKey: dk, amount: receivableSum - payableSum }],
                };
            }
            const maxT = Math.max(...dates.map((x) => x.getTime()));
            const minT = Math.min(...dates.map((x) => x.getTime()));
            const maxD = startOfDay(new Date(maxT));
            let startWindow = startOfDay(new Date(minT));
            const spanDays =
                Math.ceil((maxD.getTime() - startWindow.getTime()) / (86400000)) + 1;
            if (spanDays > 60) startWindow = startOfDay(addDays(maxD, -59));
            for (let d = new Date(startWindow); d <= maxD; d = addDays(d, 1)) {
                dayBoundaries.push(new Date(d));
            }
        }

        const skipOpening = (name: unknown) => String(name || "") === "Opening Balance";
        const entities: RpSeriesEntity[] = [
            ...processedParties.map((p: any) => ({
                id: String(p.id || ""),
                openingBalance: Number(p.openingBalance) || 0,
                context: "party" as const,
                skip: skipOpening(p.name) || skipOpening(p.party),
            })),
            ...processedStaff.map((s: any) => ({
                id: String(s.id || ""),
                openingBalance: Number(s.openingBalance) || 0,
                context: "staff" as const,
                skip: skipOpening(s.name),
            })),
            ...processedTaxes.map((t: any) => ({
                id: String(t.id || ""),
                openingBalance: Number(t.openingBalance) || 0,
                context: "tax" as const,
                skip: skipOpening(t.name),
            })),
            ...processedAccounts.map((a: any) => ({
                id: String(a.id || ""),
                openingBalance: Number(a.openingBalance) || 0,
                context: "account" as const,
                skip: skipOpening(a.name),
            })),
            ...expenseAccounts.map((e: any) => ({
                id: String(e.id || ""),
                openingBalance: Number(e.openingBalance) || 0,
                context: "expense" as const,
                skip: skipOpening(e.name),
            })),
        ];
        const series = computeRpReceivePayAtDayEnds({
            entities,
            vouchers,
            dayEndMs: dayBoundaries.map((day) => endOfDay(day).getTime()),
            processedTaxes,
        });

        const toReceive: { name: string; amount: number }[] = [];
        const toPay: { name: string; amount: number }[] = [];
        const net: { name: string; amount: number }[] = [];
        const toReceivePointsByDay: ChartDayPoint[] = [];
        const toPayPointsByDay: ChartDayPoint[] = [];
        const netPointsByDay: ChartDayPoint[] = [];

        dayBoundaries.forEach((day, idx) => {
            const receivableSum = series[idx]?.receivable || 0;
            const payableSum = series[idx]?.payable || 0;
            const label = labelForDay(day);
            const dk = format(startOfDay(day), "yyyy-MM-dd");
            toReceive.push({ name: label, amount: receivableSum });
            toPay.push({ name: label, amount: payableSum });
            net.push({ name: label, amount: receivableSum - payableSum });
            toReceivePointsByDay.push({ dayKey: dk, amount: receivableSum });
            toPayPointsByDay.push({ dayKey: dk, amount: payableSum });
            netPointsByDay.push({ dayKey: dk, amount: receivableSum - payableSum });
        });

        return { toReceive, toPay, net, toReceivePointsByDay, toPayPointsByDay, netPointsByDay };
    }, [
        showVoucherDateCharts,
        loading,
        vouchers,
        receivablesDateRange,
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        expenseAccounts,
        dateSystem,
        formatDate,
        formatDateBS,
    ]);

    // Chart tab: entity count cards — master `createdAt` se din-wise adds (Parties / Staff / Bank+Cash / Items).
    const entityChartPartiesDaily = useMemo(() => {
        if (!showVoucherDateCharts) return [] as { name: string; amount: number }[];
        const partyDates = entityScopedLists.parties
            .filter((p: any) => !DASHBOARD_CHART_EXCLUDE_PARTY_IDS.has(p.id) && !p.isSystemAccount)
            .map((p: any) => pickEntityCreatedAt(p));
        return buildDailyCountChart(partyDates, dateSystem, formatDate, formatDateBS);
    }, [showVoucherDateCharts, entityScopedLists.parties, dateSystem, formatDate, formatDateBS]);

    const entityChartStaffDaily = useMemo(() => {
        if (!showVoucherDateCharts) return [] as { name: string; amount: number }[];
        return buildDailyCountChart(
            entityScopedLists.staff.map((s: any) => pickEntityCreatedAt(s)),
            dateSystem,
            formatDate,
            formatDateBS
        );
    }, [showVoucherDateCharts, entityScopedLists.staff, dateSystem, formatDate, formatDateBS]);

    const entityChartBankCashDaily = useMemo(() => {
        if (!showVoucherDateCharts) return [] as { name: string; amount: number }[];
        const dates = entityScopedLists.accounts
            .filter((a: any) => a.accountType === "Bank" || a.accountType === "Cash")
            .map((a: any) => pickEntityCreatedAt(a));
        return buildDailyCountChart(dates, dateSystem, formatDate, formatDateBS);
    }, [showVoucherDateCharts, entityScopedLists.accounts, dateSystem, formatDate, formatDateBS]);

    const entityChartItemsDaily = useMemo(() => {
        if (!showVoucherDateCharts) return [] as { name: string; amount: number }[];
        return buildDailyCountChart(
            entityScopedLists.items.map((i: any) => pickEntityCreatedAt(i)),
            dateSystem,
            formatDate,
            formatDateBS
        );
    }, [showVoucherDateCharts, entityScopedLists.items, dateSystem, formatDate, formatDateBS]);

    const entityChartPartiesPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        const partyDates = entityScopedLists.parties
            .filter((p: any) => !DASHBOARD_CHART_EXCLUDE_PARTY_IDS.has(p.id) && !p.isSystemAccount)
            .map((p: any) => pickEntityCreatedAt(p));
        return buildDailyCountPointsByDay(partyDates);
    }, [showVoucherDateCharts, entityScopedLists.parties]);

    const entityChartStaffPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        return buildDailyCountPointsByDay(entityScopedLists.staff.map((s: any) => pickEntityCreatedAt(s)));
    }, [showVoucherDateCharts, entityScopedLists.staff]);

    const entityChartBankCashPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        const dates = entityScopedLists.accounts
            .filter((a: any) => a.accountType === "Bank" || a.accountType === "Cash")
            .map((a: any) => pickEntityCreatedAt(a));
        return buildDailyCountPointsByDay(dates);
    }, [showVoucherDateCharts, entityScopedLists.accounts]);

    const entityChartItemsPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        return buildDailyCountPointsByDay(entityScopedLists.items.map((i: any) => pickEntityCreatedAt(i)));
    }, [showVoucherDateCharts, entityScopedLists.items]);

    /** Total Vouchers card: voucher `date` par din-wise count (mini chart). */
    const entityChartVouchersDaily = useMemo(() => {
        if (!showVoucherDateCharts) return [] as { name: string; amount: number }[];
        const dates = entityScopedLists.vouchers.map((v: any) => safeToDate(v.date)).filter(Boolean) as Date[];
        return buildDailyCountChart(dates, dateSystem, formatDate, formatDateBS);
    }, [showVoucherDateCharts, entityScopedLists.vouchers, dateSystem, formatDate, formatDateBS]);

    const entityChartVouchersCountPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        const dates = entityScopedLists.vouchers.map((v: any) => safeToDate(v.date)).filter(Boolean) as Date[];
        return buildDailyCountPointsByDay(dates);
    }, [showVoucherDateCharts, entityScopedLists.vouchers]);

    /** View full popup: us din sab vouchers ka total amount (`total`/`amount`). */
    const voucherAmountPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        const dayMap = new Map<string, number>();
        for (const v of entityScopedLists.vouchers) {
            const d = safeToDate(v.date);
            if (!d) continue;
            const k = format(startOfDay(d), "yyyy-MM-dd");
            const amt = Number(v.total ?? v.amount ?? 0);
            dayMap.set(k, (dayMap.get(k) || 0) + amt);
        }
        return Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dayKey, amount]) => ({ dayKey, amount }));
    }, [showVoucherDateCharts, entityScopedLists.vouchers]);

    // Chart tab: Stock — item master create date se daily add count.
    const dashboardStockItemAdds = useMemo(() => {
        if (!showVoucherDateCharts) return [] as { name: string; amount: number }[];
        const dates = processedItems.map((i: any) => pickEntityCreatedAt(i));
        return buildDailyCountChart(dates, dateSystem, formatDate, formatDateBS);
    }, [showVoucherDateCharts, processedItems, dateSystem, formatDate, formatDateBS]);

    const dashboardStockItemAddsPointsByDay = useMemo(() => {
        if (!showVoucherDateCharts) return [] as ChartDayPoint[];
        return buildDailyCountPointsByDay(processedItems.map((i: any) => pickEntityCreatedAt(i)));
    }, [showVoucherDateCharts, processedItems]);

    // Chart tab: Bank & Cash — Bank vs Cash account master ke `createdAt` se daily add count.
    const dashboardBankCashDual = useMemo(() => {
        const empty = {
            bank: [] as { name: string; amount: number }[],
            cash: [] as { name: string; amount: number }[],
            bankPointsByDay: [] as ChartDayPoint[],
            cashPointsByDay: [] as ChartDayPoint[],
        };
        if (!showVoucherDateCharts) return empty;
        const bankDates = processedAccounts
            .filter((a: any) => a.accountType === "Bank")
            .map((a: any) => pickEntityCreatedAt(a));
        const cashDates = processedAccounts
            .filter((a: any) => a.accountType === "Cash")
            .map((a: any) => pickEntityCreatedAt(a));
        return {
            bank: buildDailyCountChart(bankDates, dateSystem, formatDate, formatDateBS),
            cash: buildDailyCountChart(cashDates, dateSystem, formatDate, formatDateBS),
            bankPointsByDay: buildDailyCountPointsByDay(bankDates),
            cashPointsByDay: buildDailyCountPointsByDay(cashDates),
        };
    }, [showVoucherDateCharts, processedAccounts, dateSystem, formatDate, formatDateBS]);

    /** Entity row: full-width grid — APK/tablet par horizontal scroll avoid. */
    const dashboardEntityRowClass =
        "grid w-full min-w-0 max-w-full grid-cols-1 items-stretch gap-[5px] sm:grid-cols-2 lg:grid-cols-5";
    const topSummaryRowWrapClass = "";
    const topSummaryCardShellClass = compact
        ? "h-full flex flex-col"
        : "flex h-full min-h-[12rem] min-w-0 w-full max-w-full flex-col overflow-hidden";
    const topSummaryCardBodyClass = "flex-1 flex flex-col";
    const topSummaryCardFooterClass = "mt-auto shrink-0 text-right pt-2";
    const topSummaryMetricRowCn = cn(
        "flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5",
        !compact && "sm:flex-nowrap sm:gap-x-2",
    );
    const topSummaryMetricLabelCn = cn(
        "min-w-0 max-w-[58%] text-xs text-muted-foreground break-words leading-snug",
        !compact && "sm:max-w-none sm:shrink-0 sm:whitespace-nowrap",
    );
    const topSummaryMetricValueCn = cn(
        "shrink-0 text-right tabular-nums",
        !compact && "whitespace-nowrap",
    );
    const topSummaryMetricLineValueCn = cn(
        compact ? "text-sm font-bold" : "text-sm font-bold",
        topSummaryMetricValueCn,
    );
    const topSummaryMetricNetLabelCn = cn(
        compact ? "text-xs font-bold" : "text-xs font-bold",
        !compact && "shrink-0 whitespace-nowrap",
    );
    const topSummaryMetricNetValueCn = cn(
        compact ? "text-base font-bold" : "text-base font-bold",
        topSummaryMetricValueCn,
    );
    const topSummaryMetricDrCrCn = "text-xs font-normal";
    // Dashboard request: keep exact 5px card-to-card spacing across summary grids.
    const cardSpacing = compact ? "gap-[5px] px-0.5" : "gap-[5px] px-0.5";
    // APK WebView compatibility: apply shared top ribbon strip class directly on every dashboard summary card.
    const dashboardCardRibbonClass = "app-chrome-top-ribbon";
    // Dashboard card palette — border card ke hue se match (`proTheme` + globals.css).
    const ribbonTone = (index: number) => proDashboardRibbonClass(index);
    
    // Responsive classes only for compact mode (report page)
    // Use min-width to prevent content overflow, cards will auto-adjust columns
    const cardWrapperClass = compact
        ? "flex flex-col min-w-0 w-full"
        : "h-full min-w-0 w-full max-w-full overflow-hidden";
    const headerClass = compact ? "min-w-0 gap-2 flex-shrink-0" : "";
    const titleClass = compact ? "truncate flex-shrink-0" : "";
    const topSummaryCardHeaderClass = cn(
        "flex flex-row items-center justify-between gap-2 space-y-0 p-4",
        compact ? cn(headerClass, "overflow-hidden") : "min-w-0 shrink-0 flex-nowrap overflow-hidden"
    );
    const topSummaryCardHeaderTitleClass = cn(
        "text-base whitespace-nowrap text-card-foreground",
        titleClass,
        compact ? "min-w-0" : "shrink-0"
    );
    const filterWrapperClass = compact ? "flex-shrink-0" : "";
    const contentClass = compact ? "flex-1 flex flex-col" : "flex min-h-0 flex-1 flex-col";

    /** Mini vs full popup: same series, alag margins / tick size. */
    const dashboardChartLazyMount = showVoucherDateCharts && !compact;

    const renderBarChartInner = (
        data: { name: string; amount: number }[],
        barColor: string,
        tooltipIsCount: boolean,
        variant: "mini" | "full",
        chartSize?: { width: number; height: number },
    ) => {
        if (!data.length) {
            return <p className="text-[10px] text-muted-foreground text-center pt-6">—</p>;
        }
        const xTick = variant === "mini" ? 8 : 12;
        const yTick = variant === "mini" ? 8 : 12;
        const yWidth = variant === "mini" ? 26 : 48;
        const margin =
            variant === "mini"
                ? { top: 2, right: 2, left: 0, bottom: 0 }
                : { top: 16, right: 24, left: 8, bottom: 48 };
        const axis = (
            <>
                <CartesianGrid strokeDasharray="3 3" className="opacity-35" />
                <XAxis
                    dataKey="name"
                    tick={{ fontSize: xTick }}
                    interval="preserveStartEnd"
                    angle={variant === "full" ? -32 : 0}
                    textAnchor={variant === "full" ? "end" : "middle"}
                    height={variant === "full" ? 72 : undefined}
                />
                <YAxis tick={{ fontSize: yTick }} width={yWidth} />
                <Tooltip
                    formatter={(v: number) =>
                        tooltipIsCount
                            ? [String(v), "Added"]
                            : [formatCurrency(v, { noSuffix: true, duration: 2 }), "Amount"]
                    }
                    labelFormatter={(l) => `Date: ${l}`}
                />
            </>
        );
        const chartProps = {
            data,
            margin,
            ...(chartSize ? { width: chartSize.width, height: chartSize.height } : {}),
        };
        const chart =
            voucherDateChartKind === "line" ? (
                <LineChart {...chartProps}>
                    {axis}
                    <Line
                        type="monotone"
                        dataKey="amount"
                        stroke={barColor}
                        strokeWidth={2}
                        dot={variant === "full"}
                        isAnimationActive={false}
                    />
                </LineChart>
            ) : (
                <BarChart {...chartProps}>
                    {axis}
                    <Bar
                        dataKey="amount"
                        fill={barColor}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                    />
                </BarChart>
            );
        if (chartSize) return chart;
        return (
            <ResponsiveContainer
                width="100%"
                height="100%"
                debounce={DASHBOARD_CHART_RESIZE_DEBOUNCE_MS}
            >
                {chart}
            </ResponsiveContainer>
        );
    };

    /** Chart tab: mini chart + View full; optional `fullViewOverride` = popup me alag series (e.g. vouchers count mini → amount full). */
    const renderDashboardMiniBar = (
        data: { name: string; amount: number }[],
        subtitle: string,
        barColor: string,
        tooltipIsCount: boolean,
        pointsByDay: ChartDayPoint[],
        fullViewOverride?: {
            pointsByDay: ChartDayPoint[];
            tooltipIsCount: boolean;
            subtitle?: string;
        }
    ) => {
        const popupPts = fullViewOverride?.pointsByDay ?? pointsByDay;
        return (
            <div className="min-w-0 flex flex-col rounded-md border border-border/50 bg-background/30 p-1.5">
                <div className="flex items-start justify-between gap-1.5">
                    <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2 min-w-0 flex-1">{subtitle}</p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-[10px] font-medium text-primary hover:text-primary"
                        disabled={!popupPts.length}
                        onClick={() =>
                            setDashboardChartFullView({
                                subtitle: fullViewOverride?.subtitle ?? subtitle,
                                barColor,
                                tooltipIsCount: fullViewOverride?.tooltipIsCount ?? tooltipIsCount,
                                pointsByDay: popupPts,
                            })
                        }
                    >
                        View full
                    </Button>
                </div>
                <DashboardScrollFriendlyChartHost
                    className="mt-1 h-[88px] min-h-[72px]"
                    minHeight={72}
                    lazyNearViewport={dashboardChartLazyMount}
                >
                    {(size) =>
                        renderBarChartInner(data, barColor, tooltipIsCount, "mini", size)
                    }
                </DashboardScrollFriendlyChartHost>
            </div>
        );
    };

    const chartFullViewDataBounds = useMemo(() => {
        if (!dashboardChartFullView?.pointsByDay?.length) return null;
        const sorted = [...dashboardChartFullView.pointsByDay].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
        const first = parseISO(sorted[0].dayKey);
        const last = parseISO(sorted[sorted.length - 1].dayKey);
        if (dateSystem === "BS") {
            const minB = adToBs(first);
            const maxB = adToBs(last);
            return {
                mode: "bs" as const,
                dataMinAnchor: bsToAd({ y: minB.y, m: minB.m, d: 1 }),
                dataMaxAnchor: bsToAd({ y: maxB.y, m: maxB.m, d: 1 }),
            };
        }
        return {
            mode: "ad" as const,
            dataMinAnchor: startOfMonth(first),
            dataMaxAnchor: startOfMonth(last),
        };
    }, [dashboardChartFullView?.pointsByDay, dateSystem]);

    const canShiftChartBack = useMemo(() => {
        if (!chartFullViewDataBounds || chartFullRangePreset === "all") return false;
        if (chartFullViewDataBounds.mode === "bs") {
            const minA = minAnchorDateBs(chartFullViewDataBounds.dataMinAnchor, chartFullRangePreset);
            return bsMonthIndexFromAnchorDate(chartFullAnchorMonth) > bsMonthIndexFromAnchorDate(minA);
        }
        const minA = minAnchorMonthForPreset(chartFullViewDataBounds.dataMinAnchor, chartFullRangePreset);
        return chartFullAnchorMonth.getTime() > minA.getTime();
    }, [chartFullViewDataBounds, chartFullRangePreset, chartFullAnchorMonth]);

    const canShiftChartForward = useMemo(() => {
        if (!chartFullViewDataBounds || chartFullRangePreset === "all") return false;
        if (chartFullViewDataBounds.mode === "bs") {
            return (
                bsMonthIndexFromAnchorDate(chartFullAnchorMonth) <
                bsMonthIndexFromAnchorDate(chartFullViewDataBounds.dataMaxAnchor)
            );
        }
        return chartFullAnchorMonth.getTime() < chartFullViewDataBounds.dataMaxAnchor.getTime();
    }, [chartFullViewDataBounds, chartFullRangePreset, chartFullAnchorMonth]);

    const shiftChartAnchor = (delta: -1 | 1) => {
        if (!chartFullViewDataBounds || chartFullRangePreset === "all") return;
        if (chartFullViewDataBounds.mode === "bs") {
            const bs = adToBs(chartFullAnchorMonth);
            const shifted = addBsMonths(bs.y, bs.m, delta);
            let idxNext = shifted.y * 12 + shifted.m - 1;
            const minA = minAnchorDateBs(chartFullViewDataBounds.dataMinAnchor, chartFullRangePreset);
            const idxMin = bsMonthIndexFromAnchorDate(minA);
            const idxMax = bsMonthIndexFromAnchorDate(chartFullViewDataBounds.dataMaxAnchor);
            const clamped = Math.min(Math.max(idxNext, idxMin), idxMax);
            const yy = Math.floor(clamped / 12);
            const mm = (clamped % 12) + 1;
            setChartFullAnchorMonth(bsToAd({ y: yy, m: mm, d: 1 }));
            return;
        }
        const minA = minAnchorMonthForPreset(chartFullViewDataBounds.dataMinAnchor, chartFullRangePreset);
        let next = startOfMonth(addMonths(chartFullAnchorMonth, delta));
        if (next.getTime() < minA.getTime()) next = minA;
        if (next.getTime() > chartFullViewDataBounds.dataMaxAnchor.getTime()) {
            next = chartFullViewDataBounds.dataMaxAnchor;
        }
        setChartFullAnchorMonth(next);
    };

    /** Popup: Month=daily columns in month; 3/6/12=month buckets; All=har month column. */
    const fullViewFilteredChart = useMemo(() => {
        if (!dashboardChartFullView?.pointsByDay?.length) return [] as { name: string; amount: number }[];
        return buildFullViewChartData(
            dashboardChartFullView.pointsByDay,
            chartFullRangePreset,
            chartFullAnchorMonth,
            dateSystem,
            formatDate,
            formatDateBS
        );
    }, [
        dashboardChartFullView,
        chartFullRangePreset,
        chartFullAnchorMonth,
        dateSystem,
        formatDate,
        formatDateBS,
    ]);

    const renderVoucherStatCard = (
        stat: (typeof stats.otherStats)[number],
        idx: number
    ) => {
        const deepHref = dashboardStatCardReportHref(stat.type);
        const canClickTxns =
            !!deepHref && (deepHref.startsWith("/reports") ? can("export_data") : true);
        return (
            <Card
                key={stat.type}
                className={`flex min-w-0 w-full h-full flex-col hover:bg-muted/50 transition-colors ${dashboardCardRibbonClass} ${ribbonTone(idx + 5)}`}
            >
                <CardHeader className="space-y-1 p-3 pb-1">
                    <div className="flex min-w-0 items-center justify-between gap-1">
                        <CardTitle className="min-w-0 truncate text-sm">{stat.title}</CardTitle>
                        {renderDashboardSummaryScopeControls(stat.type)}
                    </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col p-3 pt-0">
                    {stat.type === "journal" || stat.type === "add_salary" || stat.type === "contra" ? (
                        <div className="text-xl font-bold text-blue-600">
                            {formatCurrency(stat.total, { noSuffix: true, duration: 2 })}
                        </div>
                    ) : (
                        <div
                            className={cn(
                                "text-xl font-bold",
                                stat.isCredit ? "text-green-600" : "text-red-600"
                            )}
                        >
                            {formatCurrency(stat.total, { noSuffix: true, duration: 2 })}
                        </div>
                    )}
                    {canClickTxns ? (
                        <Link
                            href={deepHref}
                            className="text-xs text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded inline-block mt-0.5"
                        >
                            {stat.count} transaction(s)
                        </Link>
                    ) : (
                        <p className="text-xs text-muted-foreground">{stat.count} transaction(s)</p>
                    )}
                    {showVoucherDateCharts && (
                        <div className="mt-2 flex min-h-[104px] w-full min-w-0 flex-1 flex-col">
                            {voucherStatDateChartData[stat.type]?.length ? (
                                <DashboardScrollFriendlyChartHost
                                    className="h-[104px]"
                                    minHeight={104}
                                    lazyNearViewport={dashboardChartLazyMount}
                                >
                                    {(size) =>
                                        renderBarChartInner(
                                            voucherStatDateChartData[stat.type],
                                            "hsl(var(--primary))",
                                            false,
                                            "mini",
                                            size,
                                        )
                                    }
                                </DashboardScrollFriendlyChartHost>
                            ) : (
                                <p className="flex h-[104px] items-center justify-center text-center text-[10px] text-muted-foreground">
                                    No dated rows for chart
                                </p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    };

    return (
        <div
            {...(showVoucherDateCharts && !compact ? { "data-pl-dashboard-summary-charts": "" } : {})}
            data-pl-dashboard-summary-page-bound={
                !compact && !showVoucherDateCharts ? "" : undefined
            }
            className={cn(
                compact
                    ? cn("financial-summary-grid w-full", cardSpacing)
                    : cn("flex w-full min-w-0 max-w-full flex-col items-stretch", cardSpacing)
            )}
        >
            <Dialog
                open={!!dashboardChartFullView}
                onOpenChange={(open) => {
                    if (!open) {
                        setDashboardChartFullView(null);
                        setChartFullRangePreset("all");
                    }
                }}
            >
                <DialogContent
                    className={cn(
                        /* dashboard-financial-popup: modal ke andar horizontal dividers globals.css se patle */
                        "dashboard-financial-popup",
                        "flex w-full max-w-[100vw] flex-col gap-0 overflow-hidden rounded-lg border p-0",
                        "h-[100dvh] max-h-[100dvh] sm:h-[90vh] sm:max-h-[90vh] sm:max-w-[90vw]",
                        "pt-[env(safe-area-inset-top)]"
                    )}
                >
                    <DialogHeader className="shrink-0 space-y-2 border-b px-3 py-3 text-left sm:space-y-1 sm:px-4">
                        <DialogTitle className="pr-10 text-sm font-semibold leading-snug sm:text-base">
                            {dashboardChartFullView?.subtitle ?? "Chart"}
                        </DialogTitle>
                        {/* Month=din-wise columns; 3/6/Year=month columns; All=sare months; All par sirf forward chipka hua nahi. */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 pr-10 sm:pr-8">
                            {CHART_FULL_RANGE_OPTIONS.map((opt) => (
                                <Button
                                    key={opt.id}
                                    type="button"
                                    size="sm"
                                    variant={chartFullRangePreset === opt.id ? "default" : "outline"}
                                    className="h-8 min-w-0 shrink px-2 text-[10px] sm:text-xs"
                                    onClick={() => setChartFullRangePreset(opt.id)}
                                >
                                    {opt.label}
                                </Button>
                            ))}
                            {/* All preset: forward hidden only; rewind dikhao (All par shift band — disabled). */}
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                disabled={!canShiftChartBack}
                                onClick={() => shiftChartAnchor(-1)}
                                aria-label="Previous period"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            {chartFullRangePreset !== "all" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    disabled={!canShiftChartForward}
                                    onClick={() => shiftChartAnchor(1)}
                                    aria-label="Next period"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-4">
                        {dashboardChartFullView && fullViewFilteredChart.length > 0 ? (
                            <div
                                className={cn(
                                    "h-[min(calc(100dvh-11rem),85vh)] w-full min-h-[200px] sm:h-[min(calc(90vh-10rem),80vh)] sm:min-h-[280px]"
                                )}
                            >
                                {renderBarChartInner(
                                    fullViewFilteredChart,
                                    dashboardChartFullView.barColor,
                                    dashboardChartFullView.tooltipIsCount,
                                    "full"
                                )}
                            </div>
                        ) : (
                            <p className="text-muted-foreground flex h-48 items-center justify-center text-sm">
                                No data for this chart.
                            </p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
            <TopSummaryRowWrap
                compact={compact}
                className={topSummaryRowWrapClass}
                chartRowLayout={showVoucherDateCharts && !compact}
            >
            {/* Auto recurring — same 5-col grid width as Outstanding (`col-span-1` slot se) */}
            {recurringSummarySlot}

            {can("view_receivable_payable_summary") && (
                <Card className={`col-span-1 transition-colors ${topSummaryCardShellClass} ${dashboardCardRibbonClass} ${cardWrapperClass} ${ribbonTone(1)}`}>
                    <CardHeader className={topSummaryCardHeaderClass}>
                        <CardTitle className={topSummaryCardHeaderTitleClass}>Outstanding</CardTitle>
                        <div className="shrink-0">
                        {compact ? (
                            <ReportMonthYearFilter dateRange={receivablesDateRange} setDateRange={setReceivablesDateRange} dateSystem={dateSystem} />
                        ) : (
                            <MonthYearFilter dateRange={receivablesDateRange} setDateRange={setReceivablesDateRange} dateSystem={dateSystem} />
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className={cn("overflow-hidden p-4 pt-0 space-y-2", contentClass, topSummaryCardBodyClass)}>
                        <div className={topSummaryMetricRowCn}>
                            <span className={topSummaryMetricLabelCn}>{compact ? "Total Receivable" : "To Receive"}</span>
                            <span className={cn(topSummaryMetricLineValueCn, "text-green-600")}>
                                {formatCurrency(outstandingCardTotals.receivableSum, {noSuffix: true})}{" "}
                                <span className={topSummaryMetricDrCrCn}>Dr</span>
                            </span>
                        </div>
                        <div className={topSummaryMetricRowCn}>
                            <span className={topSummaryMetricLabelCn}>{compact ? "Total Payable" : "To Pay"}</span>
                            <span className={cn(topSummaryMetricLineValueCn, "text-red-600")}>
                                {formatCurrency(outstandingCardTotals.payableSum, {noSuffix: true})}{" "}
                                <span className={topSummaryMetricDrCrCn}>Cr</span>
                            </span>
                        </div>
                        <div className={cn(topSummaryMetricRowCn, "pt-2 mt-2 border-t")}>
                            <span className={topSummaryMetricNetLabelCn}>{compact ? "Net Balance" : "Net"}</span>
                            <span className={cn(topSummaryMetricNetValueCn, outstandingCardTotals.net >= 0 ? "text-green-600" : "text-red-600")}>
                                {formatCurrency(outstandingCardTotals.net, { showDrCr: true })}
                            </span>
                        </div>
                        {showVoucherDateCharts && !compact && (
                            <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
                                {/* Din ke end tak cumulative To Receive / To Pay / Net — card totals se same balance rules. */}
                                {renderDashboardMiniBar(
                                    dashboardOutstandingBalanceTri.toReceive,
                                    "To Receive (Dr) / day",
                                    "#16a34a",
                                    false,
                                    dashboardOutstandingBalanceTri.toReceivePointsByDay
                                )}
                                {renderDashboardMiniBar(
                                    dashboardOutstandingBalanceTri.toPay,
                                    "To Pay (Cr) / day",
                                    "#dc2626",
                                    false,
                                    dashboardOutstandingBalanceTri.toPayPointsByDay
                                )}
                                {renderDashboardMiniBar(
                                    dashboardOutstandingBalanceTri.net,
                                    "Net balance / day",
                                    "#2563eb",
                                    false,
                                    dashboardOutstandingBalanceTri.netPointsByDay
                                )}
                            </div>
                        )}
                        {showDetails && (
                            <div className={topSummaryCardFooterClass}>
                                <Button variant="link" size="sm" className="h-auto p-0" type="button" onClick={() => openOutstandingDialog("both")}>View Details</Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
            
            {can("view_payment_in_out_summary") && (
                <Card className={`col-span-1 transition-colors ${topSummaryCardShellClass} ${dashboardCardRibbonClass} ${cardWrapperClass} ${ribbonTone(2)}`}>
                    <CardHeader className={topSummaryCardHeaderClass}>
                        <CardTitle className={topSummaryCardHeaderTitleClass}>Cash Flow</CardTitle>
                        <div className="shrink-0">
                        {compact ? (
                            <ReportMonthYearFilter dateRange={cashFlowDateRange} setDateRange={setCashFlowDateRange} dateSystem={dateSystem} />
                        ) : (
                            <MonthYearFilter dateRange={cashFlowDateRange} setDateRange={setCashFlowDateRange} dateSystem={dateSystem} />
                        )}
                        </div>
                    </CardHeader>
                    <CardContent className={cn("overflow-hidden p-4 pt-0 space-y-2", contentClass, topSummaryCardBodyClass)}>
                        <div className={topSummaryMetricRowCn}>
                            <span className={topSummaryMetricLabelCn}>Receipt</span>
                            <span className={cn(topSummaryMetricLineValueCn, "text-green-600")}>
                                {formatCurrency(cashFlowDetails.totalInflow, {noSuffix: true})}{" "}
                                <span className={topSummaryMetricDrCrCn}>Dr</span>
                            </span>
                        </div>
                        <div className={topSummaryMetricRowCn}>
                            <span className={topSummaryMetricLabelCn}>Payment</span>
                            <span className={cn(topSummaryMetricLineValueCn, "text-red-600")}>
                                {formatCurrency(cashFlowDetails.totalOutflow, {noSuffix: true})}{" "}
                                <span className={topSummaryMetricDrCrCn}>Cr</span>
                            </span>
                        </div>
                        <div className={cn(topSummaryMetricRowCn, "pt-2 mt-2 border-t")}>
                            <span className={topSummaryMetricNetLabelCn}>Net Flow</span>
                            <span className={cn(topSummaryMetricNetValueCn, (cashFlowDetails.totalInflow - cashFlowDetails.totalOutflow) >= 0 ? "text-green-600" : "text-red-600")}>
                                {formatCurrency(Math.abs(cashFlowDetails.totalInflow - cashFlowDetails.totalOutflow), { noSuffix: true, duration: 2 })}{" "}
                                <span className={topSummaryMetricDrCrCn}>{(cashFlowDetails.totalInflow - cashFlowDetails.totalOutflow) >= 0 ? "Dr" : "Cr"}</span>
                            </span>
                        </div>
                        {showVoucherDateCharts && !compact && (
                            <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
                                {/* Cash Flow: 3 rows — in / out / net; har chart full-screen popup. */}
                                {renderDashboardMiniBar(
                                    dashboardCashFlowDailyTri.inflow,
                                    "Receipts / day",
                                    "#16a34a",
                                    false,
                                    dashboardCashFlowDailyTri.inflowPointsByDay
                                )}
                                {renderDashboardMiniBar(
                                    dashboardCashFlowDailyTri.outflow,
                                    "Payment / day",
                                    "#dc2626",
                                    false,
                                    dashboardCashFlowDailyTri.outflowPointsByDay
                                )}
                                {renderDashboardMiniBar(
                                    dashboardCashFlowDailyTri.net,
                                    "Net / day",
                                    "#2563eb",
                                    false,
                                    dashboardCashFlowDailyTri.netPointsByDay
                                )}
                            </div>
                        )}
                        {showDetails && (
                            <div className={topSummaryCardFooterClass}>
                                <Dialog open={cashFlowOpen} onOpenChange={(open) => {
                                    setCashFlowOpen(open);
                                    if (!open) setCashFlowExpandedNameKey(null);
                                }}>
                                    <DialogTrigger asChild>
                                        <Button variant="link" size="sm" className="h-auto p-0">View Details</Button>
                                    </DialogTrigger>
                                    <DialogContent className="dashboard-financial-popup max-w-6xl p-0 h-[90vh] rounded-lg flex flex-col">
                                        <DialogHeader className="p-4 border-b flex flex-col space-y-3">
                                            <DialogTitle className="whitespace-nowrap text-base md:text-lg">Cash Flow Details</DialogTitle>
                                            {/* First Row: Date Filter and Entity Dropdown */}
                                            <div className="flex items-center gap-2 w-full">
                                                <div className="flex-1 [&_button]:h-9">
                                                    <MonthYearFilter dateRange={cashFlowDateRange} setDateRange={setCashFlowDateRange} dateSystem={dateSystem} />
                                                </div>
                                                <Select value={cashFlowCategoryFilter} onValueChange={(v) => setCashFlowCategoryFilter(v as any)}>
                                                    <SelectTrigger className="h-9 flex-1">
                                                        <SelectValue placeholder="Select Entity" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All</SelectItem>
                                                        <SelectItem value="party">Party</SelectItem>
                                                        <SelectItem value="staff">{STAFF_ENTITY_LABEL}</SelectItem>
                                                        <SelectItem value="tax">Tax</SelectItem>
                                                        <SelectItem value="income_expense">Income / Expense</SelectItem>
                                                        <SelectItem value="other">Other</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            {/* Second Row: Flow Filter Tabs (Desktop) / Buttons (Mobile) and Print */}
                                            <div className="flex items-center gap-2 w-full">
                                                {!isMobile ? (
                                                    // Desktop: Use Tabs component
                                                    <Tabs 
                                                        value={cashFlowFilter} 
                                                        onValueChange={(v) => {
                                                            setCashFlowFilter(v as 'all' | 'inflow' | 'outflow');
                                                        }} 
                                                        className="flex-1"
                                                    >
                                                        <TabsList className="grid w-full grid-cols-3 h-9">
                                                            <TabsTrigger value="all">All</TabsTrigger>
                                                            <TabsTrigger value="inflow">Inflow</TabsTrigger>
                                                            <TabsTrigger value="outflow">Outflow</TabsTrigger>
                                                        </TabsList>
                                                    </Tabs>
                                                ) : (
                                                    // Mobile: Use buttons (original behavior)
                                                    <div className="flex bg-muted rounded-md p-1 space-x-1 flex-1 h-9">
                                                        {['all', 'inflow', 'outflow'].map((type) => (
                                                            <button 
                                                                key={type} 
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setCashFlowFilter(type as any);
                                                                }} 
                                                                className={cn("h-full px-3 text-xs rounded-sm transition-all capitalize font-medium flex items-center justify-center flex-1", cashFlowFilter === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                                                            >
                                                                {type}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handlePrintCashFlow();
                                                    }} 
                                                    className="h-9 flex items-center gap-2"
                                                >
                                                    Print <Printer className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </DialogHeader>
                                        {/* Mobile: niche Inflow/Outflow tab hata; upar all/inflow/outflow + scroll (all=dono stack) */}
                                        <div className="flex-1 px-2 pt-0 pb-4 min-h-0 min-w-0 overflow-auto">
                                            <div className={cn("grid gap-4 flex-1 min-h-0 min-w-0", !isMobile ? "grid-cols-2" : "grid-cols-1")}>
                                                {(cashFlowFilter === 'all' || cashFlowFilter === 'inflow') && (
                                                    <div className="flex flex-col min-h-0 min-w-0">
                                                        <h3 className="text-lg font-semibold mb-0.5 text-green-600 mt-0">Inflow</h3>
                                                        <div className="flex-1 border rounded-lg flex flex-col min-h-0 min-w-0 overflow-hidden">
                                                            {/* pr-2 + table-fixed: mobile par scrollbar / tight width se amount ka digit cut na ho */}
                                                            <ScrollArea className="flex-1 min-h-0 min-w-0">
                                                                <div className="min-w-0 pr-2">
                                                                    <Table className={cn("w-full table-fixed", DASHBOARD_VIEW_DETAILS_TABLE_CN)}>
                                                                        <TableBody>
                                                                            {orderedCashFlowCategories(cashFlowDetails.categorizedInflow).map(([category, items]) => {
                                                                                if(cashFlowCategoryFilter !== 'all' && cashFlowCategoryFilter.replace('_', ' / ').toLowerCase() !== category.toLowerCase()) return null;
                                                                                return ( <React.Fragment key={`in-${category}`}><TableRow className="bg-muted/50"><TableCell colSpan={2} className="font-bold text-xs uppercase">{category.replace('_', ' / ')}</TableCell></TableRow>{items.map((i, rowIdx) => {
                                                                                    /* rowIdx: same i.id do lines me ho to bhi expand sahi row par */
                                                                                    const cashFlowRowKey = `inflow:${category}:${i.id}:${rowIdx}`;
                                                                                    const nameExpanded = isMobile && cashFlowExpandedNameKey === cashFlowRowKey;
                                                                                    return (
                                                                                        <TableRow
                                                                                            key={i.id}
                                                                                            className={cn(isMobile && "cursor-pointer active:bg-muted/40")}
                                                                                            onClick={() => {
                                                                                                if (!isMobile) return;
                                                                                                setCashFlowExpandedNameKey((k) => (k === cashFlowRowKey ? null : cashFlowRowKey));
                                                                                            }}
                                                                                        >
                                                                                            <TableCell className="pl-6 pr-2 py-1.5 text-sm max-w-0 w-[38%] align-top">
                                                                                                <span className={cn("block", nameExpanded ? "whitespace-normal break-words" : "truncate")} title={!isMobile ? i.name : undefined}>{i.name}</span>
                                                                                            </TableCell>
                                                                                            <TableCell className="py-1.5 text-sm text-right text-green-600 whitespace-nowrap tabular-nums align-top pl-1 pr-1 w-[62%]">{formatCurrency(i.amount, {noSuffix: true})}</TableCell>
                                                                                        </TableRow>
                                                                                    );
                                                                                })}</React.Fragment> )
                                                                            })}
                                                                        </TableBody>
                                                                    </Table>
                                                                </div>
                                                            </ScrollArea>
                                                            <div className="p-2 border-t font-bold flex justify-between gap-2 min-w-0"><span className="min-w-0 truncate">Total In</span><span className="shrink-0 tabular-nums text-green-600">{formatCurrency(cashFlowDetails.totalInflow, {noSuffix: true})}</span></div>
                                                        </div>
                                                    </div>
                                                )}
                                                {(cashFlowFilter === 'all' || cashFlowFilter === 'outflow') && (
                                                    <div className="flex flex-col min-h-0 min-w-0">
                                                        <h3 className="text-lg font-semibold mb-0.5 text-red-600 mt-0">Outflow</h3>
                                                        <div className="flex-1 border rounded-lg flex flex-col min-h-0 min-w-0 overflow-hidden">
                                                            <ScrollArea className="flex-1 min-h-0 min-w-0">
                                                                <div className="min-w-0 pr-2">
                                                                    <Table className={cn("w-full table-fixed", DASHBOARD_VIEW_DETAILS_TABLE_CN)}>
                                                                        <TableBody>
                                                                            {orderedCashFlowCategories(cashFlowDetails.categorizedOutflow).map(([category, items]) => {
                                                                                if(cashFlowCategoryFilter !== 'all' && cashFlowCategoryFilter.replace('_', ' / ').toLowerCase() !== category.toLowerCase()) return null;
                                                                                return ( <React.Fragment key={`out-${category}`}><TableRow className="bg-muted/50"><TableCell colSpan={2} className="font-bold text-xs uppercase">{category.replace('_', ' / ')}</TableCell></TableRow>{items.map((i, rowIdx) => {
                                                                                    const cashFlowRowKey = `outflow:${category}:${i.id}:${rowIdx}`;
                                                                                    const nameExpanded = isMobile && cashFlowExpandedNameKey === cashFlowRowKey;
                                                                                    return (
                                                                                        <TableRow
                                                                                            key={i.id}
                                                                                            className={cn(isMobile && "cursor-pointer active:bg-muted/40")}
                                                                                            onClick={() => {
                                                                                                if (!isMobile) return;
                                                                                                setCashFlowExpandedNameKey((k) => (k === cashFlowRowKey ? null : cashFlowRowKey));
                                                                                            }}
                                                                                        >
                                                                                            <TableCell className="pl-6 pr-2 py-1.5 text-sm max-w-0 w-[38%] align-top">
                                                                                                <span className={cn("block", nameExpanded ? "whitespace-normal break-words" : "truncate")} title={!isMobile ? i.name : undefined}>{i.name}</span>
                                                                                            </TableCell>
                                                                                            <TableCell className="py-1.5 text-sm text-right text-red-600 whitespace-nowrap tabular-nums align-top pl-1 pr-1 w-[62%]">{formatCurrency(i.amount, {noSuffix: true})}</TableCell>
                                                                                        </TableRow>
                                                                                    );
                                                                                })}</React.Fragment> )
                                                                            })}
                                                                        </TableBody>
                                                                    </Table>
                                                                </div>
                                                            </ScrollArea>
                                                            <div className="p-2 border-t font-bold flex justify-between gap-2 min-w-0"><span className="min-w-0 truncate">Total Out</span><span className="shrink-0 tabular-nums text-red-600">{formatCurrency(cashFlowDetails.totalOutflow, {noSuffix: true})}</span></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <Card className={`col-span-1 transition-colors ${topSummaryCardShellClass} ${dashboardCardRibbonClass} ${cardWrapperClass} ${ribbonTone(3)}`}>
                <CardHeader className={topSummaryCardHeaderClass}>
                    <CardTitle className={topSummaryCardHeaderTitleClass}>Tax Summary</CardTitle>
                    <div className="shrink-0">
                    {compact ? (
                        <ReportMonthYearFilter dateRange={taxDateRange} setDateRange={setTaxDateRange} dateSystem={dateSystem} />
                    ) : (
                        <MonthYearFilter dateRange={taxDateRange} setDateRange={setTaxDateRange} dateSystem={dateSystem} />
                    )}
                    </div>
                </CardHeader>
                <CardContent className={cn("overflow-hidden p-4 pt-0 space-y-2", contentClass, topSummaryCardBodyClass)}>
                    <div className={topSummaryMetricRowCn}>
                        <span className={topSummaryMetricLabelCn}>Paid Tax</span>
                        <span className={cn(topSummaryMetricLineValueCn, "text-green-600")}>
                            {formatCurrency(taxSummary.totalInput, {noSuffix: true})}{" "}
                            <span className={topSummaryMetricDrCrCn}>Dr</span>
                        </span>
                    </div>
                    <div className={topSummaryMetricRowCn}>
                        <span className={topSummaryMetricLabelCn}>Received Tax</span>
                        <span className={cn(topSummaryMetricLineValueCn, "text-red-600")}>
                            {formatCurrency(taxSummary.totalOutput, {noSuffix: true})}{" "}
                            <span className={topSummaryMetricDrCrCn}>Cr</span>
                        </span>
                    </div>
                    <div className={cn(topSummaryMetricRowCn, "pt-2 mt-2 border-t")}>
                        <span className={topSummaryMetricNetLabelCn}>Net Balance</span>
                        <span className={cn(topSummaryMetricNetValueCn, taxSummary.netBalance >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(taxSummary.netBalance, {showDrCr: true})}
                        </span>
                    </div>
                    {showVoucherDateCharts && !compact && (
                        <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
                            {/* Tax: 3 stacked rows; voucher-level aggregate + `taxDateRange`. */}
                            {renderDashboardMiniBar(
                                dashboardTaxDailyTri.input,
                                "Paid tax (Dr) / day",
                                "#16a34a",
                                false,
                                dashboardTaxDailyTri.inputPointsByDay
                            )}
                            {renderDashboardMiniBar(
                                dashboardTaxDailyTri.output,
                                "Received tax (Cr) / day",
                                "#dc2626",
                                false,
                                dashboardTaxDailyTri.outputPointsByDay
                            )}
                            {renderDashboardMiniBar(
                                dashboardTaxDailyTri.net,
                                "Net tax / day",
                                "#7c3aed",
                                false,
                                dashboardTaxDailyTri.netPointsByDay
                            )}
                        </div>
                    )}
                    {showDetails && (
                        <div className={topSummaryCardFooterClass}>
                            <Dialog open={taxSummaryOpen} onOpenChange={(open) => {
                                setTaxSummaryOpen(open);
                                if (!open) {
                                    setTaxFilter('all');
                                    setSelectedTaxId(null);
                                }
                            }}>
                                <DialogTrigger asChild>
                                    <Button variant="link" size="sm" className="h-auto p-0">View Details</Button>
                                </DialogTrigger>
                                <DialogContent className={cn(
                                    "dashboard-financial-popup p-0 rounded-lg flex flex-col",
                                    isMobile ? "max-w-[100vw] w-[100vw] h-[90vh] m-0" : "max-w-6xl h-[90vh]"
                                )}>
                                    <DialogHeader className={cn("border-b border-black flex flex-col", isMobile ? "p-2 space-y-2" : "p-4 space-y-3")}>
                                        <DialogTitle className={cn("whitespace-nowrap", isMobile ? "text-sm" : "text-base md:text-lg")}>Tax Summary Details</DialogTitle>
                                        {/* First Row: Date Filter, Dropdown, and Print */}
                                        <div className={cn("flex items-center gap-2 w-full", isMobile ? "px-5 gap-1" : "px-5")}>
                                            <div className={cn("flex-1 border border-black rounded-full overflow-hidden cursor-pointer hover:border-green-600 transition-colors [&_button]:border-0 [&_button]:bg-transparent [&_button]:hover:bg-transparent [&_button]:hover:text-foreground [&_button]:focus:bg-transparent [&_button]:focus:text-foreground [&_button]:text-foreground [&_button[data-state=open]]:border-2 [&_button[data-state=open]]:border-green-600 [&_button[data-state=open]]:text-foreground", isMobile ? "[&_button]:h-8 [&_button]:text-xs [&_button]:rounded-full [&_button]:w-full" : "[&_button]:h-9 [&_button]:rounded-full [&_button]:w-full")} onClick={(e) => {
                                                const button = e.currentTarget.querySelector('button');
                                                if (button) button.click();
                                            }}>
                                                <MonthYearFilter dateRange={taxDateRange} setDateRange={setTaxDateRange} dateSystem={dateSystem} />
                                            </div>
                                            <Select value={selectedTaxId || 'all'} onValueChange={(v) => setSelectedTaxId(v === 'all' ? null : v)}>
                                                <SelectTrigger className={cn("flex-1 w-full border border-black rounded-full hover:border-green-600 transition-colors data-[state=open]:border-2 data-[state=open]:border-green-600", isMobile ? "h-8 text-xs" : "h-9")}>
                                                    <SelectValue placeholder="Select Tax Head" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All</SelectItem>
                                                    {taxSummary.details.map((tax) => (
                                                        <SelectItem key={tax.id} value={tax.id}>
                                                            {tax.name} ({formatCurrency(Math.abs(tax.balance), {noSuffix: true})} {tax.balance >= 0 ? 'Dr' : 'Cr'})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePrintTax();
                                                }} 
                                                className={cn(
                                                    "flex-1 flex items-center gap-2 justify-center border border-black rounded-full hover:bg-transparent hover:border-green-600 hover:text-foreground focus:bg-transparent focus:text-foreground active:bg-transparent active:text-foreground transition-colors",
                                                    isMobile ? "h-8 text-xs px-2" : "h-9"
                                                )}
                                            >
                                                {isMobile ? <Printer className="h-3 w-3" /> : <>Print <Printer className="h-4 w-4" /></>}
                                            </Button>
                                        </div>
                                        {/* Second Row: Tabs (All, Input, Output) */}
                                        <div className={cn("flex items-center gap-2 w-full", isMobile ? "px-5 gap-1" : "px-5")}>
                                            <Tabs 
                                                value={taxFilter} 
                                                onValueChange={(v) => {
                                                    setTaxFilter(v as 'all' | 'input' | 'output');
                                                }} 
                                                className="w-0 min-w-0 overflow-hidden shrink-0"
                                            >
                                                <TabsList className="hidden">
                                                    <TabsTrigger value="all">All</TabsTrigger>
                                                    <TabsTrigger value="input">Paid</TabsTrigger>
                                                    <TabsTrigger value="output">Received</TabsTrigger>
                                                </TabsList>
                                            </Tabs>
                                            <button
                                                type="button"
                                                onClick={() => setTaxFilter('all')}
                                                className={cn(
                                                    "flex-1 rounded-full flex items-center justify-center font-medium transition-colors hover:border-green-600",
                                                    isMobile ? "h-8 text-xs" : "h-9 text-sm",
                                                    taxFilter === 'all' ? "border-2 border-green-600 bg-background text-foreground" : "border border-black bg-background text-foreground"
                                                )}
                                            >
                                                All
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setTaxFilter('input')}
                                                className={cn(
                                                    "flex-1 rounded-full flex items-center justify-center font-medium transition-colors hover:border-green-600",
                                                    isMobile ? "h-8 text-xs" : "h-9 text-sm",
                                                    taxFilter === 'input' ? "border-2 border-green-600 bg-background text-foreground" : "border border-black bg-background text-foreground"
                                                )}
                                            >
                                                Paid
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setTaxFilter('output')}
                                                className={cn(
                                                    "flex-1 rounded-full flex items-center justify-center font-medium transition-colors hover:border-green-600",
                                                    isMobile ? "h-8 text-xs" : "h-9 text-sm",
                                                    taxFilter === 'output' ? "border-2 border-green-600 bg-background text-foreground" : "border border-black bg-background text-foreground"
                                                )}
                                            >
                                                Received
                                            </button>
                                            <button
                                                type="button"
                                                onClick={toggleAllTaxAccounts}
                                                className={cn(
                                                    "flex-1 rounded-full flex items-center justify-center gap-1 font-medium transition-colors border border-black hover:border-green-600 bg-background text-foreground",
                                                    isMobile ? "h-8 text-xs" : "h-9 text-sm"
                                                )}
                                            >
                                                {areAllExpanded ? (
                                                    <>
                                                        <span>Collapse</span>
                                                        <ChevronUp className={cn(isMobile ? "h-3 w-3" : "h-4 w-4")} />
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>Expand</span>
                                                        <ChevronDown className={cn(isMobile ? "h-3 w-3" : "h-4 w-4")} />
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </DialogHeader>
                                    <div className={cn("flex-1 min-h-0 flex flex-col px-0.5 pt-0")}>
                                        <div className={cn("flex-1 min-h-0 overflow-auto", isMobile ? "pb-0" : "pb-0")}>
                                        {/* Transaction Count Summary */}
                                        <div className={cn("mb-2 bg-muted/50 rounded-md", isMobile ? "p-1 text-xs" : "p-2 text-sm")}>
                                            <div className={cn("flex items-center", isMobile ? "gap-2 flex-wrap" : "gap-4")}>
                                                <span className="font-bold">Total Transactions:</span>
                                                <span>Sale: <strong>{taxBreakdownTransactions.saleCount}</strong></span>
                                                <span>Purchase: <strong>{taxBreakdownTransactions.purchaseCount}</strong></span>
                                                <span>Add Salary: <strong>{taxBreakdownTransactions.addSalaryCount}</strong></span>
                                            </div>
                                        </div>
                                        {(isMobile && taxFilter === 'all') || (!isMobile && (taxFilter === 'all' || taxFilter === 'input' || taxFilter === 'output')) ? (
                                            // Mobile: Show unified table with Dr and Cr columns
                                            <div className="space-y-4">
                                                <div className="flex flex-col min-h-0">
                                                    <div className="border border-black rounded-lg flex flex-col min-h-0 overflow-hidden">
                                                        <ScrollArea className="flex-1 w-full">
                                                            <div className="w-full">
                                                                <Table className={cn("w-full table-fixed", DASHBOARD_VIEW_DETAILS_TABLE_CN)}>
                                                                {/* 4 column: Account date ke neeche — Cash Flow jaisa text-sm */}
                                                                <TableHeader>
                                                                    <TableRow className="border-b-[0.2px] border-gray-400">
                                                                        <TableHead className={cn("font-bold text-sm", isMobile && "px-1 py-1 w-[30%]")}>Date</TableHead>
                                                                        <TableHead className={cn("font-bold text-sm", isMobile && "px-1 py-1 w-[26%]")}>Voucher No</TableHead>
                                                                        <TableHead className={cn("text-right font-bold text-sm", isMobile && "px-1 py-1 w-[22%]")}>Dr</TableHead>
                                                                        <TableHead className={cn("text-right font-bold text-sm", isMobile && "px-1 py-1 w-[22%]")}>Cr</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {transactionsByTaxAccount.length === 0 ? (
                                                                        <TableRow>
                                                                            <TableCell colSpan={4} className="text-center text-muted-foreground py-4">No transactions found</TableCell>
                                                                        </TableRow>
                                                                    ) : (() => {
                                                                        // Calculate overall totals across all visible accounts
                                                                        const overallPaid = transactionsByTaxAccount.reduce((sum, taxGroup) => {
                                                                            const hasInput = (taxFilter === 'all' || taxFilter === 'input') && taxGroup.inputTransactions.length > 0;
                                                                            if (!hasInput) return sum;
                                                                            return sum + taxGroup.inputTransactions.reduce((acc, tx) => acc + tx.debit, 0);
                                                                        }, 0);
                                                                        
                                                                        const overallReceived = transactionsByTaxAccount.reduce((sum, taxGroup) => {
                                                                            const hasOutput = (taxFilter === 'all' || taxFilter === 'output') && taxGroup.outputTransactions.length > 0;
                                                                            if (!hasOutput) return sum;
                                                                            return sum + taxGroup.outputTransactions.reduce((acc, tx) => acc + tx.credit, 0);
                                                                        }, 0);
                                                                        
                                                                        // Calculate overall net balance across all accounts
                                                                        const overallNetBalance = overallPaid - overallReceived;
                                                                        
                                                                            // Calculate overall total display for first account header
                                                                            let overallTotalDisplay = '';
                                                                            if (taxFilter === 'all') {
                                                                                // Show net balance (Dr or Cr)
                                                                                if (overallNetBalance !== 0) {
                                                                                    overallTotalDisplay = `${formatCurrency(Math.abs(overallNetBalance), {noSuffix: true, noAnimation: true})} ${overallNetBalance >= 0 ? 'Dr' : 'Cr'}`;
                                                                                }
                                                                            } else if (taxFilter === 'input') {
                                                                                overallTotalDisplay = overallPaid > 0 ? `${formatCurrency(overallPaid, {noSuffix: true, noAnimation: true})} Dr` : '';
                                                                            } else {
                                                                                overallTotalDisplay = overallReceived > 0 ? `${formatCurrency(overallReceived, {noSuffix: true, noAnimation: true})} Cr` : '';
                                                                            }
                                                                        
                                                                        return transactionsByTaxAccount.map((taxGroup, index) => {
                                                                            const hasInput = (taxFilter === 'all' || taxFilter === 'input') && taxGroup.inputTransactions.length > 0;
                                                                            const hasOutput = (taxFilter === 'all' || taxFilter === 'output') && taxGroup.outputTransactions.length > 0;
                                                                            const hasTransactions = hasInput || hasOutput;
                                                                            if (!hasTransactions) return null;
                                                                            
                                                                            // Combine and sort all transactions by date (filter based on taxFilter)
                                                                            const allTransactions = [
                                                                                ...(taxFilter === 'all' || taxFilter === 'input' ? taxGroup.inputTransactions.map(tx => ({ ...tx, isDebit: true })) : []),
                                                                                ...(taxFilter === 'all' || taxFilter === 'output' ? taxGroup.outputTransactions.map(tx => ({ ...tx, isDebit: false })) : [])
                                                                            ].sort((a, b) => {
                                                                                const dateA = safeToDate(a.date)?.getTime() || 0;
                                                                                const dateB = safeToDate(b.date)?.getTime() || 0;
                                                                                return dateB - dateA;
                                                                            });
                                                                            
                                                                            const accountPaid = taxGroup.inputTransactions.reduce((sum, tx) => sum + tx.debit, 0);
                                                                            const accountReceived = taxGroup.outputTransactions.reduce((sum, tx) => sum + tx.credit, 0);
                                                                            const accountNetBalance = accountPaid - accountReceived;
                                                                            
                                                                            const isExpanded = expandedTaxAccounts.has(taxGroup.taxId);
                                                                            
                                                                            // Show overall total only in the first account header
                                                                            const isFirstAccount = index === 0;
                                                                            
                                                                            // Calculate balance display for collapsed view
                                                                            let balanceDisplay = '';
                                                                            if (taxFilter === 'all') {
                                                                                balanceDisplay = accountNetBalance !== 0 ? `${formatCurrency(Math.abs(accountNetBalance), {noSuffix: true, noAnimation: true})} ${accountNetBalance >= 0 ? 'Dr' : 'Cr'}` : '';
                                                                            } else if (taxFilter === 'input') {
                                                                                balanceDisplay = accountPaid > 0 ? `${formatCurrency(accountPaid, {noSuffix: true, noAnimation: true})} Dr` : '';
                                                                            } else {
                                                                                balanceDisplay = accountReceived > 0 ? `${formatCurrency(accountReceived, {noSuffix: true, noAnimation: true})} Cr` : '';
                                                                            }
                                                                            
                                                                            return (
                                                                                    <React.Fragment key={taxGroup.taxId}>
                                                                                        <TableRow className="bg-muted/50 border-b-[0.2px] border-gray-400">
                                                                                            <TableCell colSpan={2} className={cn("font-semibold text-sm", isMobile ? "py-1 px-1" : "py-2")}>
                                                                                                <div className="flex items-center gap-1 cursor-pointer" onClick={() => toggleTaxAccount(taxGroup.taxId)}>
                                                                                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                                                                    <span>{taxGroup.taxName}</span>
                                                                                                </div>
                                                                                            </TableCell>
                                                                                            <TableCell className={cn(isMobile ? "py-1 px-1" : "py-2")}></TableCell>
                                                                                            <TableCell className={cn("text-right font-semibold text-sm", isMobile ? "py-1 px-1 whitespace-nowrap overflow-visible" : "py-2")}>
                                                                                                {!isExpanded && balanceDisplay && (
                                                                                                    <span className={cn(
                                                                                                        taxFilter === 'all' ? (accountNetBalance >= 0 ? "text-green-600" : "text-red-600") : taxFilter === 'input' ? "text-green-600" : "text-red-600",
                                                                                                        isMobile && "inline-block text-right"
                                                                                                    )}>
                                                                                                        {balanceDisplay}
                                                                                                    </span>
                                                                                                )}
                                                                                            </TableCell>
                                                                                        </TableRow>
                                                                                        {isExpanded && allTransactions.map((tx, txIdx) => {
                                                                                            const txDate = safeToDate(tx.date);
                                                                                            const isSelected = selectedTransactionId === tx.id;
                                                                                            const rowKey = `${taxGroup.taxId}|${tx.id}|${tx.isDebit ? 'dr' : 'cr'}|${txIdx}`;
                                                                                            return (
                                                                                                <TableRow 
                                                                                                    key={rowKey} 
                                                                                                    className={cn(
                                                                                                        "border-b-[0.2px] border-gray-400 cursor-pointer text-sm",
                                                                                                        isSelected ? "bg-muted" : "hover:bg-muted/50"
                                                                                                    )}
                                                                                                    onClick={() => setSelectedTransactionId(tx.id)}
                                                                                                >
                                                                                                    <TableCell className={cn("align-top min-w-0", isMobile && "px-1 py-1")}>
                                                                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                                                                            <span className="whitespace-nowrap">{txDate ? (dateSystem === 'BS' ? formatDateBS(txDate) : dateSystem === 'AD' ? formatDate(txDate) : `${formatDateBS(txDate)} / ${formatDate(txDate)}`) : '-'}</span>
                                                                                                            <span className="text-muted-foreground text-sm leading-snug break-words" title={tx.account}>{truncateAccountName(tx.account)}</span>
                                                                                                        </div>
                                                                                                    </TableCell>
                                                                                                    <TableCell className={cn("align-top truncate", isMobile && "px-1 py-1")} title={tx.voucherNumber}>{tx.voucherNumber || '-'}</TableCell>
                                                                                                    <TableCell className={cn("text-right text-green-600 tabular-nums align-top", isMobile && "px-1 py-1")}>{tx.isDebit && tx.debit > 0 ? formatCurrency(tx.debit, {noSuffix: true}) : '-'}</TableCell>
                                                                                                    <TableCell className={cn("text-right text-red-600 tabular-nums align-top", isMobile && "px-1 py-1")}>{!tx.isDebit && tx.credit > 0 ? formatCurrency(tx.credit, {noSuffix: true}) : '-'}</TableCell>
                                                                                                </TableRow>
                                                                                            );
                                                                                        })}
                                                                                        {isExpanded && (
                                                                                            /* Per Account Footer — 4 cols: label x2, Dr, Cr */
                                                                                            taxFilter === 'all' ? (
                                                                                                <>
                                                                                                    <TableRow className="bg-muted/30 border-t-[0.2px] border-gray-400">
                                                                                                        <TableCell colSpan={2} className={cn("font-semibold text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                            {getTaxTotalLabel(taxGroup.taxName)} - Total
                                                                                                        </TableCell>
                                                                                                        <TableCell className={cn("text-right font-semibold text-green-600 text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                            {accountPaid > 0 ? formatCurrency(accountPaid, {noSuffix: true}) : '-'}
                                                                                                        </TableCell>
                                                                                                        <TableCell className={cn("text-right font-semibold text-red-600 text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                            {accountReceived > 0 ? formatCurrency(accountReceived, {noSuffix: true}) : '-'}
                                                                                                        </TableCell>
                                                                                                    </TableRow>
                                                                                                    <TableRow className="bg-muted/30 border-b-[0.2px] border-gray-400">
                                                                                                        <TableCell colSpan={2} className={cn("font-semibold text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                            {taxGroup.taxName} - Net Balance
                                                                                                        </TableCell>
                                                                                                        <TableCell colSpan={2} className={cn("text-right font-semibold text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                            <span className={accountNetBalance >= 0 ? "text-green-600" : "text-red-600"}>
                                                                                                                {formatCurrency(Math.abs(accountNetBalance), {noSuffix: true})} {accountNetBalance >= 0 ? 'Dr' : 'Cr'}
                                                                                                            </span>
                                                                                                        </TableCell>
                                                                                                    </TableRow>
                                                                                                </>
                                                                                            ) : taxFilter === 'input' ? (
                                                                                                <TableRow className="bg-muted/30 border-t border-border/75">
                                                                                                    <TableCell colSpan={2} className={cn("font-semibold text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                        {taxGroup.taxName} - Total Paid
                                                                                                    </TableCell>
                                                                                                    <TableCell className={cn("text-right font-semibold text-green-600 text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                        {accountPaid > 0 ? formatCurrency(accountPaid, {noSuffix: true}) : '-'}
                                                                                                    </TableCell>
                                                                                                    <TableCell className={cn("text-right text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>-</TableCell>
                                                                                                </TableRow>
                                                                                            ) : (
                                                                                                <TableRow className="bg-muted/30 border-t border-border/75">
                                                                                                    <TableCell colSpan={2} className={cn("font-semibold text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                        {taxGroup.taxName} - Total Received
                                                                                                    </TableCell>
                                                                                                    <TableCell className={cn("text-right text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>-</TableCell>
                                                                                                    <TableCell className={cn("text-right font-semibold text-red-600 text-sm", isMobile ? "py-0.5 px-1" : "py-1")}>
                                                                                                        {accountReceived > 0 ? formatCurrency(accountReceived, {noSuffix: true}) : '-'}
                                                                                                    </TableCell>
                                                                                                </TableRow>
                                                                                            )
                                                                                        )}
                                                                                    </React.Fragment>
                                                                            );
                                                                        });
                                                                    })()}
                                                                </TableBody>
                                                            </Table>
                                                            </div>
                                                        </ScrollArea>
                                                    </div>
                                                </div>
                                            </div>
                                            ) : (
                                                // Desktop: Show unified table with Dr and Cr columns
                                                <div className="flex-1 min-h-0">
                                                    <div className="flex flex-col min-h-0">
                                                        <div className="flex-1 border border-black rounded-lg flex flex-col min-h-0">
                                                            <ScrollArea className="flex-1">
                                                                <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}>
                                                                    {/* 4 column + account under date — pehle branch jaisa */}
                                                                    <TableHeader>
                                                                        <TableRow className="border-b-[0.2px] border-gray-400">
                                                                            <TableHead className="font-bold text-sm">Date</TableHead>
                                                                            <TableHead className="font-bold text-sm">Voucher No</TableHead>
                                                                            <TableHead className="text-right font-bold text-sm">Dr</TableHead>
                                                                            <TableHead className="text-right font-bold text-sm">Cr</TableHead>
                                                                        </TableRow>
                                                                    </TableHeader>
                                                                    <TableBody>
                                                                        {transactionsByTaxAccount.length === 0 ? (
                                                                            <TableRow>
                                                                                <TableCell colSpan={4} className="text-center text-muted-foreground py-4">No transactions found</TableCell>
                                                                            </TableRow>
                                                                        ) : (() => {
                                                                            // Calculate overall totals across all visible accounts
                                                                            const overallPaid = transactionsByTaxAccount.reduce((sum, taxGroup) => {
                                                                                const hasInput = (taxFilter === 'all' || taxFilter === 'input') && taxGroup.inputTransactions.length > 0;
                                                                                if (!hasInput) return sum;
                                                                                return sum + taxGroup.inputTransactions.reduce((acc, tx) => acc + tx.debit, 0);
                                                                            }, 0);
                                                                            
                                                                            const overallReceived = transactionsByTaxAccount.reduce((sum, taxGroup) => {
                                                                                const hasOutput = (taxFilter === 'all' || taxFilter === 'output') && taxGroup.outputTransactions.length > 0;
                                                                                if (!hasOutput) return sum;
                                                                                return sum + taxGroup.outputTransactions.reduce((acc, tx) => acc + tx.credit, 0);
                                                                            }, 0);
                                                                            
                                                                            // Calculate overall net balance across all accounts
                                                                            const overallNetBalance = overallPaid - overallReceived;
                                                                            
                                                                            // Calculate overall total display for first account header
                                                                            let overallTotalDisplay = '';
                                                                            if (taxFilter === 'all') {
                                                                                // Show net balance (Dr or Cr)
                                                                                if (overallNetBalance !== 0) {
                                                                                    overallTotalDisplay = `${formatCurrency(Math.abs(overallNetBalance), {noSuffix: true, noAnimation: true})} ${overallNetBalance >= 0 ? 'Dr' : 'Cr'}`;
                                                                                }
                                                                            } else if (taxFilter === 'input') {
                                                                                overallTotalDisplay = overallPaid > 0 ? `${formatCurrency(overallPaid, {noSuffix: true, noAnimation: true})} Dr` : '';
                                                                            } else {
                                                                                overallTotalDisplay = overallReceived > 0 ? `${formatCurrency(overallReceived, {noSuffix: true, noAnimation: true})} Cr` : '';
                                                                            }
                                                                            
                                                                            return transactionsByTaxAccount.map((taxGroup, index) => {
                                                                                const hasInput = (taxFilter === 'all' || taxFilter === 'input') && taxGroup.inputTransactions.length > 0;
                                                                                const hasOutput = (taxFilter === 'all' || taxFilter === 'output') && taxGroup.outputTransactions.length > 0;
                                                                                const hasTransactions = hasInput || hasOutput;
                                                                                if (!hasTransactions) return null;
                                                                                
                                                                                // Combine and sort all transactions by date (filter based on taxFilter)
                                                                                const allTransactions = [
                                                                                    ...(taxFilter === 'all' || taxFilter === 'input' ? taxGroup.inputTransactions.map(tx => ({ ...tx, isDebit: true })) : []),
                                                                                    ...(taxFilter === 'all' || taxFilter === 'output' ? taxGroup.outputTransactions.map(tx => ({ ...tx, isDebit: false })) : [])
                                                                                ].sort((a, b) => {
                                                                                    const dateA = safeToDate(a.date)?.getTime() || 0;
                                                                                    const dateB = safeToDate(b.date)?.getTime() || 0;
                                                                                    return dateB - dateA;
                                                                                });
                                                                                
                                                                                const accountPaid = taxGroup.inputTransactions.reduce((sum, tx) => sum + tx.debit, 0);
                                                                                const accountReceived = taxGroup.outputTransactions.reduce((sum, tx) => sum + tx.credit, 0);
                                                                                const accountNetBalance = accountPaid - accountReceived;
                                                                                
                                                                                const isExpanded = expandedTaxAccounts.has(taxGroup.taxId);
                                                                                
                                                                                // Show overall total only in the first account header
                                                                                const isFirstAccount = index === 0;
                                                                                
                                                                                // Calculate balance display for collapsed view
                                                                                let balanceDisplay = '';
                                                                                if (taxFilter === 'all') {
                                                                                    balanceDisplay = accountNetBalance !== 0 ? `${formatCurrency(Math.abs(accountNetBalance), {noSuffix: true, noAnimation: true})} ${accountNetBalance >= 0 ? 'Dr' : 'Cr'}` : '';
                                                                                } else if (taxFilter === 'input') {
                                                                                    balanceDisplay = accountPaid > 0 ? `${formatCurrency(accountPaid, {noSuffix: true, noAnimation: true})} Dr` : '';
                                                                                } else {
                                                                                    balanceDisplay = accountReceived > 0 ? `${formatCurrency(accountReceived, {noSuffix: true, noAnimation: true})} Cr` : '';
                                                                                }
                                                                                
                                                                                return (
                                                                                    <React.Fragment key={taxGroup.taxId}>
                                                                                        <TableRow className="bg-muted/50 border-b-[0.2px] border-gray-400">
                                                                                            <TableCell colSpan={2} className="font-semibold text-sm py-2">
                                                                                                <div className="flex items-center gap-1 cursor-pointer" onClick={() => toggleTaxAccount(taxGroup.taxId)}>
                                                                                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                                                                    <span>{taxGroup.taxName}</span>
                                                                                                </div>
                                                                                            </TableCell>
                                                                                            <TableCell className="py-2"></TableCell>
                                                                                            <TableCell className="text-right font-semibold text-sm py-2">
                                                                                                {!isExpanded && balanceDisplay && (
                                                                                                    <span className={taxFilter === 'all' ? (accountNetBalance >= 0 ? "text-green-600" : "text-red-600") : taxFilter === 'input' ? "text-green-600" : "text-red-600"}>
                                                                                                        {balanceDisplay}
                                                                                                    </span>
                                                                                                )}
                                                                                            </TableCell>
                                                                                        </TableRow>
                                                                                        {isExpanded && allTransactions.map((tx, txIdx) => {
                                                                                            const txDate = safeToDate(tx.date);
                                                                                            const isSelected = selectedTransactionId === tx.id;
                                                                                            const rowKey = `${taxGroup.taxId}|${tx.id}|${tx.isDebit ? 'dr' : 'cr'}|${txIdx}`;
                                                                                            return (
                                                                                                <TableRow 
                                                                                                    key={rowKey} 
                                                                                                    className={cn(
                                                                                                        "border-b-[0.2px] border-gray-400 cursor-pointer text-sm",
                                                                                                        isSelected ? "bg-muted" : "hover:bg-muted/50"
                                                                                                    )}
                                                                                                    onClick={() => setSelectedTransactionId(tx.id)}
                                                                                                >
                                                                                                    <TableCell className="align-top min-w-0">
                                                                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                                                                            <span className="whitespace-nowrap">{txDate ? (dateSystem === 'BS' ? formatDateBS(txDate) : dateSystem === 'AD' ? formatDate(txDate) : `${formatDateBS(txDate)} / ${formatDate(txDate)}`) : '-'}</span>
                                                                                                            <span className="text-muted-foreground text-sm leading-snug break-words" title={tx.account}>{truncateAccountName(tx.account)}</span>
                                                                                                        </div>
                                                                                                    </TableCell>
                                                                                                    <TableCell className="align-top truncate" title={tx.voucherNumber}>{tx.voucherNumber || '-'}</TableCell>
                                                                                                    <TableCell className="text-right text-green-600 tabular-nums align-top">{tx.isDebit && tx.debit > 0 ? formatCurrency(tx.debit, {noSuffix: true}) : '-'}</TableCell>
                                                                                                    <TableCell className="text-right text-red-600 tabular-nums align-top">{!tx.isDebit && tx.credit > 0 ? formatCurrency(tx.credit, {noSuffix: true}) : '-'}</TableCell>
                                                                                                </TableRow>
                                                                                            );
                                                                                        })}
                                                                                        {isExpanded && (
                                                                                            taxFilter === 'all' ? (
                                                                                                <>
                                                                                                    <TableRow className="bg-muted/30 border-t-[0.2px] border-gray-400">
                                                                                                        <TableCell colSpan={2} className="text-sm font-semibold py-1">
                                                                                                            {getTaxTotalLabel(taxGroup.taxName)} - Total
                                                                                                        </TableCell>
                                                                                                        <TableCell className="text-right text-sm font-semibold text-green-600 py-1">
                                                                                                            {accountPaid > 0 ? formatCurrency(accountPaid, {noSuffix: true}) : '-'}
                                                                                                        </TableCell>
                                                                                                        <TableCell className="text-right text-sm font-semibold text-red-600 py-1">
                                                                                                            {accountReceived > 0 ? formatCurrency(accountReceived, {noSuffix: true}) : '-'}
                                                                                                        </TableCell>
                                                                                                    </TableRow>
                                                                                                    <TableRow className="bg-muted/30 border-b-[0.2px] border-gray-400">
                                                                                                        <TableCell colSpan={2} className="text-sm font-semibold py-1">
                                                                                                            {taxGroup.taxName} - Net Balance
                                                                                                        </TableCell>
                                                                                                        <TableCell colSpan={2} className="text-right text-sm font-semibold py-1">
                                                                                                            <span className={accountNetBalance >= 0 ? "text-green-600" : "text-red-600"}>
                                                                                                                {formatCurrency(Math.abs(accountNetBalance), {noSuffix: true})} {accountNetBalance >= 0 ? 'Dr' : 'Cr'}
                                                                                                            </span>
                                                                                                        </TableCell>
                                                                                                    </TableRow>
                                                                                                </>
                                                                                            ) : taxFilter === 'input' ? (
                                                                                                <TableRow className="bg-muted/30 border-t border-border/75">
                                                                                                    <TableCell colSpan={2} className="text-sm font-semibold py-1">
                                                                                                        {taxGroup.taxName} - Total Paid
                                                                                                    </TableCell>
                                                                                                    <TableCell className="text-right text-sm font-semibold text-green-600 py-1">
                                                                                                        {accountPaid > 0 ? formatCurrency(accountPaid, {noSuffix: true}) : '-'}
                                                                                                    </TableCell>
                                                                                                    <TableCell className="text-right text-sm py-1">-</TableCell>
                                                                                                </TableRow>
                                                                                            ) : (
                                                                                                <TableRow className="bg-muted/30 border-t border-border/75">
                                                                                                    <TableCell colSpan={2} className="text-sm font-semibold py-1">
                                                                                                        {taxGroup.taxName} - Total Received
                                                                                                    </TableCell>
                                                                                                    <TableCell className="text-right text-sm py-1">-</TableCell>
                                                                                                    <TableCell className="text-right text-sm font-semibold text-red-600 py-1">
                                                                                                        {accountReceived > 0 ? formatCurrency(accountReceived, {noSuffix: true}) : '-'}
                                                                                                    </TableCell>
                                                                                                </TableRow>
                                                                                            )
                                                                                        )}
                                                                                    </React.Fragment>
                                                                                );
                                                                            });
                                                                        })()}
                                                                    </TableBody>
                                                                </Table>
                                                            </ScrollArea>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {/* Fixed Footer with Totals Net Balance at bottom */}
                                    {(() => {
                                        // Calculate overall totals across all visible accounts
                                        const overallPaid = transactionsByTaxAccount.reduce((sum, taxGroup) => {
                                            const hasInput = (taxFilter === 'all' || taxFilter === 'input') && taxGroup.inputTransactions.length > 0;
                                            if (!hasInput) return sum;
                                            return sum + taxGroup.inputTransactions.reduce((acc, tx) => acc + tx.debit, 0);
                                        }, 0);
                                        
                                        const overallReceived = transactionsByTaxAccount.reduce((sum, taxGroup) => {
                                            const hasOutput = (taxFilter === 'all' || taxFilter === 'output') && taxGroup.outputTransactions.length > 0;
                                            if (!hasOutput) return sum;
                                            return sum + taxGroup.outputTransactions.reduce((acc, tx) => acc + tx.credit, 0);
                                        }, 0);
                                        
                                        const overallNetBalance = overallPaid - overallReceived;
                                        
                                        let overallTotalDisplay = '';
                                        if (taxFilter === 'all') {
                                            if (overallNetBalance !== 0) {
                                                overallTotalDisplay = `${formatCurrency(Math.abs(overallNetBalance), {noSuffix: true, noAnimation: true})} ${overallNetBalance >= 0 ? 'Dr' : 'Cr'}`;
                                            }
                                        } else if (taxFilter === 'input') {
                                            overallTotalDisplay = overallPaid > 0 ? `${formatCurrency(overallPaid, {noSuffix: true, noAnimation: true})} Dr` : '';
                                        } else {
                                            overallTotalDisplay = overallReceived > 0 ? `${formatCurrency(overallReceived, {noSuffix: true, noAnimation: true})} Cr` : '';
                                        }
                                        
                                        return overallTotalDisplay ? (
                                            <div className={cn(
                                                "bg-background border-t border-border/75 flex items-center justify-between flex-shrink-0",
                                                isMobile ? "px-0.5 py-2 text-xs" : "px-0.5 py-3 text-sm"
                                            )}>
                                                <span className="font-bold">Totals Net Balance</span>
                                                <span className={cn(
                                                    "font-semibold",
                                                    taxFilter === 'all' ? (overallNetBalance >= 0 ? "text-green-600" : "text-red-600") : taxFilter === 'input' ? "text-green-600" : "text-red-600"
                                                )}>
                                                    {overallTotalDisplay}
                                                </span>
                                            </div>
                                        ) : null;
                                    })()}
                                </DialogContent>
                            </Dialog>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className={`col-span-1 transition-colors ${topSummaryCardShellClass} ${dashboardCardRibbonClass} ${cardWrapperClass} ${ribbonTone(4)}`}>
                <CardHeader className={topSummaryCardHeaderClass}>
                    <CardTitle className={topSummaryCardHeaderTitleClass}>Bank & Cash Summary</CardTitle>
                    <div className="shrink-0">
                    <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-full px-3 whitespace-nowrap" disabled>
                        Today
                    </Button>
                    </div>
                </CardHeader>
                <CardContent className={cn("overflow-hidden p-4 pt-0 space-y-2", contentClass, topSummaryCardBodyClass)}>
                    <div className={topSummaryMetricRowCn}>
                        <span className={topSummaryMetricLabelCn}>Total Bank Balance</span>
                        <span className={cn(topSummaryMetricLineValueCn, bankCashSummary.totalBankBalance >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(bankCashSummary.totalBankBalance, {noSuffix: true})}
                        </span>
                    </div>
                    <div className={topSummaryMetricRowCn}>
                        <span className={topSummaryMetricLabelCn}>Total Cash Balance</span>
                        <span className={cn(topSummaryMetricLineValueCn, bankCashSummary.totalCashBalance >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(bankCashSummary.totalCashBalance, {noSuffix: true})}
                        </span>
                    </div>
                    <div className={cn(topSummaryMetricRowCn, "pt-2 mt-2 border-t")}>
                        <span className={topSummaryMetricNetLabelCn}>Grand Total</span>
                        <span className={cn(topSummaryMetricNetValueCn, bankCashSummary.grandTotalBalance >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(bankCashSummary.grandTotalBalance, {showDrCr: true})}
                        </span>
                    </div>
                    {showVoucherDateCharts && !compact && (
                        <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
                            {/* Bank & Cash: 2 rows (Bank phir Cash); same "View full" behaviour. */}
                            {renderDashboardMiniBar(
                                dashboardBankCashDual.bank,
                                "Bank a/c added/day",
                                "#1d4ed8",
                                true,
                                dashboardBankCashDual.bankPointsByDay
                            )}
                            {renderDashboardMiniBar(
                                dashboardBankCashDual.cash,
                                "Cash a/c added/day",
                                "#ca8a04",
                                true,
                                dashboardBankCashDual.cashPointsByDay
                            )}
                        </div>
                    )}
                    {showDetails && (
                        <div className={topSummaryCardFooterClass}>
                            <Dialog open={bankCashSummaryOpen} onOpenChange={(open) => {
                                setBankCashSummaryOpen(open);
                                if (!open) {
                                    setBankCashRotated(false);
                                    setSelectedBankCashRowId(null);
                                }
                            }}>
                                <DialogTrigger asChild>
                                    <Button variant="link" size="sm" className="h-auto p-0">View Details</Button>
                                </DialogTrigger>
                                <DialogContent className={cn(
                                    "dashboard-financial-popup p-0 rounded-xl overflow-hidden flex flex-col transition-all duration-300",
                                    isMobile && bankCashRotated ? "max-w-[90vh] w-[90vh] h-[100vw] m-0 fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90" : "",
                                    isMobile && !bankCashRotated ? "max-w-[100vw] w-[100vw] h-[90vh] m-0" : "",
                                    !isMobile ? "max-w-6xl h-[90vh]" : ""
                                )}>
                                    <DialogHeader className={cn(
                                        "border-b bg-white/95 dark:bg-card flex flex-col",
                                        isMobile ? "p-2 space-y-2" : "p-3 flex-row justify-between items-center"
                                    )}>
                                        <div className="flex flex-col">
                                            <DialogTitle className={cn("font-bold", isMobile ? "text-sm" : "text-xl")}>
                                                Bank & Cash Summary Details
                                            </DialogTitle>
                                        </div>
                                        <div className={cn("flex items-center gap-2", isMobile ? "w-full justify-between" : "mr-12")}>
                                            <Button variant="chromePill" size="sm" className={cn("rounded-full", LEDGER_HEADER_PILL_CN)} disabled>
                                                Today
                                            </Button>
                                            {isMobile && (
                                                <>
                                                    <Button 
                                                        variant="chromePill"
                                                        size="sm" 
                                                        className={cn("flex items-center gap-2", LEDGER_HEADER_PILL_CN)}
                                                        onClick={() => setBankCashRotated(!bankCashRotated)}
                                                    >
                                                        {bankCashRotated && <RotateCw className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />}
                                                        Rotate
                                                    </Button>
                                                    <div className="flex items-center gap-1 text-xs font-semibold flex-shrink-0 h-9 px-2 border rounded-md bg-muted/50">
                                                        <span className="text-muted-foreground whitespace-nowrap">Net:</span>
                                                        <span className={cn("whitespace-nowrap", bankCashSummary.grandTotalBalance >= 0 ? "text-green-600" : "text-red-600")}>
                                                            {formatCurrency(Math.abs(bankCashSummary.grandTotalBalance), {noSuffix: true})}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                            <Button 
                                                variant="chromePill"
                                                size="sm" 
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePrintBankCash();
                                                }}
                                                className={cn("flex items-center gap-2", LEDGER_HEADER_PILL_CN)}
                                            >
                                                Print {isMobile && bankCashRotated && <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />}
                                                {!isMobile && <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />}
                                            </Button>
                                        </div>
                                    </DialogHeader>
                                    <div className={cn("flex-1 flex flex-col min-h-0", isMobile ? "p-2" : "p-4")}>
                                        <div
                                            className="border rounded-lg flex-1 flex flex-col min-h-0 overflow-hidden"
                                            onClick={() => setSelectedBankCashRowId(null)}
                                        >
                                            <div className="flex-1 overflow-x-auto overflow-y-auto">
                                                <Table className={cn(
                                                    "w-full min-w-[600px]",
                                                    "[&_thead_tr]:!border-b-[3px] [&_thead_tr]:!border-foreground [&_tbody_tr]:!border-b-[1.5px] [&_tbody_tr]:!border-foreground/85",
                                                    "[&_tbody_tr.font-bold]:!border-t-[3px] [&_tbody_tr.font-bold]:!border-b-[3px] [&_tbody_tr.font-bold]:!border-foreground",
                                                    "[&_tbody_tr]:cursor-pointer [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-blue-50/60",
                                                    DASHBOARD_VIEW_DETAILS_TABLE_CN
                                                )}>
                                                    <TableHeader className="bg-gray-100 dark:bg-muted/70">
                                                        <TableRow className="border-b-[3px] border-foreground hover:bg-gray-100 dark:hover:bg-muted/70">
                                                            <TableHead className={cn("font-bold text-foreground", isMobile && "text-xs whitespace-nowrap")}>Account</TableHead>
                                                            <TableHead className={cn("font-bold text-foreground", isMobile && "text-xs whitespace-nowrap")}>Type</TableHead>
                                                            <TableHead className={cn("text-right font-bold text-foreground", isMobile && "text-xs whitespace-nowrap")}>Total In</TableHead>
                                                            <TableHead className={cn("text-right font-bold text-foreground", isMobile && "text-xs whitespace-nowrap")}>Total Out</TableHead>
                                                            <TableHead className={cn("text-right font-bold text-foreground", isMobile && "text-xs whitespace-nowrap")}>Balance</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {bankCashSummary.bankAccounts.map(acc => {
                                                            const rowKey = `bank:${acc.id}`;
                                                            const selected = selectedBankCashRowId === rowKey;
                                                            return (
                                                            <TableRow
                                                                key={rowKey}
                                                                aria-selected={selected}
                                                                data-state={selected ? "selected" : undefined}
                                                                data-pl-daybook-summary-selected={selected ? "" : undefined}
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setSelectedBankCashRowId(rowKey);
                                                                }}
                                                                onDoubleClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setSelectedBankCashRowId(rowKey);
                                                                    setBankCashAccountPeek({
                                                                        account: acc,
                                                                        in: acc.inflow,
                                                                        out: acc.outflow,
                                                                        closing: acc.balance,
                                                                    });
                                                                }}
                                                                className={cn(daybookSummaryAccountRowCn(selected), "pl-daybook-summary-row", selected && "pl-daybook-summary-row-selected")}
                                                            >
                                                                <TableCell className={cn(isMobile && "text-xs whitespace-nowrap")}>{acc.accountName}</TableCell>
                                                                <TableCell className={cn(isMobile && "text-xs whitespace-nowrap")}>{acc.accountType}</TableCell>
                                                                <TableCell className={cn("text-right text-green-600", isMobile && "text-xs whitespace-nowrap")}>{acc.inflow > 0 ? formatCurrency(acc.inflow, { noSuffix: true }) : '-'}</TableCell>
                                                                <TableCell className={cn("text-right text-red-600", isMobile && "text-xs whitespace-nowrap")}>{acc.outflow > 0 ? formatCurrency(acc.outflow, { noSuffix: true }) : '-'}</TableCell>
                                                                <TableCell className={cn("text-right font-semibold whitespace-nowrap", acc.balance >= 0 ? "text-green-600" : "text-red-600", isMobile && "text-xs")}>
                                                                    {acc.balance !== 0 ? formatCurrency(acc.balance, { showDrCr: true }) : 'Rs. 0.00 Dr'}
                                                                </TableCell>
                                                            </TableRow>
                                                            );
                                                        })}
                                                        <TableRow
                                                            aria-selected={selectedBankCashRowId === "bank:total"}
                                                            data-state={selectedBankCashRowId === "bank:total" ? "selected" : undefined}
                                                            data-pl-daybook-summary-selected={selectedBankCashRowId === "bank:total" ? "" : undefined}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                setSelectedBankCashRowId("bank:total");
                                                            }}
                                                            className={cn("font-bold pl-daybook-summary-row", selectedBankCashRowId === "bank:total" && "pl-daybook-summary-row-selected")}
                                                        >
                                                            <TableCell colSpan={2} className={cn(isMobile && "text-xs whitespace-nowrap")}>Bank Total</TableCell>
                                                            <TableCell className={cn("text-right text-green-600", isMobile && "text-xs whitespace-nowrap")}>{formatCurrency(bankCashSummary.totalBankInflow, {noSuffix: true})}</TableCell>
                                                            <TableCell className={cn("text-right text-red-600", isMobile && "text-xs whitespace-nowrap")}>{formatCurrency(bankCashSummary.totalBankOutflow, {noSuffix: true})}</TableCell>
                                                            <TableCell className={cn("text-right whitespace-nowrap", (bankCashSummary.totalBankInflow - bankCashSummary.totalBankOutflow) >= 0 ? "text-green-600" : "text-red-600", isMobile && "text-xs")}>
                                                                {formatCurrency(bankCashSummary.bankAccounts.reduce((sum, a) => sum + a.balance, 0), { showDrCr: true })}
                                                            </TableCell>
                                                        </TableRow>
                                                        {bankCashSummary.cashAccounts.map(acc => {
                                                            const rowKey = `cash:${acc.id}`;
                                                            const selected = selectedBankCashRowId === rowKey;
                                                            return (
                                                            <TableRow
                                                                key={rowKey}
                                                                aria-selected={selected}
                                                                data-state={selected ? "selected" : undefined}
                                                                data-pl-daybook-summary-selected={selected ? "" : undefined}
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setSelectedBankCashRowId(rowKey);
                                                                }}
                                                                onDoubleClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setSelectedBankCashRowId(rowKey);
                                                                    setBankCashAccountPeek({
                                                                        account: acc,
                                                                        in: acc.inflow,
                                                                        out: acc.outflow,
                                                                        closing: acc.balance,
                                                                    });
                                                                }}
                                                                className={cn(daybookSummaryAccountRowCn(selected), "pl-daybook-summary-row", selected && "pl-daybook-summary-row-selected")}
                                                            >
                                                                <TableCell className={cn(isMobile && "text-xs whitespace-nowrap")}>{acc.accountName}</TableCell>
                                                                <TableCell className={cn(isMobile && "text-xs whitespace-nowrap")}>{acc.accountType}</TableCell>
                                                                <TableCell className={cn("text-right text-green-600", isMobile && "text-xs whitespace-nowrap")}>{acc.inflow > 0 ? formatCurrency(acc.inflow, { noSuffix: true }) : '-'}</TableCell>
                                                                <TableCell className={cn("text-right text-red-600", isMobile && "text-xs whitespace-nowrap")}>{acc.outflow > 0 ? formatCurrency(acc.outflow, { noSuffix: true }) : '-'}</TableCell>
                                                                <TableCell className={cn("text-right font-semibold whitespace-nowrap", acc.balance >= 0 ? "text-green-600" : "text-red-600", isMobile && "text-xs")}>
                                                                    {acc.balance !== 0 ? formatCurrency(acc.balance, { showDrCr: true }) : 'Rs. 0.00 Dr'}
                                                                </TableCell>
                                                            </TableRow>
                                                            );
                                                        })}
                                                        <TableRow
                                                            aria-selected={selectedBankCashRowId === "cash:total"}
                                                            data-state={selectedBankCashRowId === "cash:total" ? "selected" : undefined}
                                                            data-pl-daybook-summary-selected={selectedBankCashRowId === "cash:total" ? "" : undefined}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                setSelectedBankCashRowId("cash:total");
                                                            }}
                                                            className={cn("font-bold pl-daybook-summary-row", selectedBankCashRowId === "cash:total" && "pl-daybook-summary-row-selected")}
                                                        >
                                                            <TableCell colSpan={2} className={cn(isMobile && "text-xs whitespace-nowrap")}>Cash Total</TableCell>
                                                            <TableCell className={cn("text-right text-green-600", isMobile && "text-xs whitespace-nowrap")}>{formatCurrency(bankCashSummary.totalCashInflow, {noSuffix: true})}</TableCell>
                                                            <TableCell className={cn("text-right text-red-600", isMobile && "text-xs whitespace-nowrap")}>{formatCurrency(bankCashSummary.totalCashOutflow, {noSuffix: true})}</TableCell>
                                                            <TableCell className={cn("text-right whitespace-nowrap", (bankCashSummary.totalCashInflow - bankCashSummary.totalCashOutflow) >= 0 ? "text-green-600" : "text-red-600", isMobile && "text-xs")}>
                                                                {formatCurrency(bankCashSummary.cashAccounts.reduce((sum, a) => sum + a.balance, 0), { showDrCr: true })}
                                                            </TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                            <DaybookAccountDayPeekDialog
                                open={!!bankCashAccountPeek}
                                onOpenChange={(open) => {
                                    if (!open) setBankCashAccountPeek(null);
                                }}
                                account={bankCashAccountPeek?.account ?? null}
                                daybookDate={undefined}
                                summaryIn={bankCashAccountPeek?.in}
                                summaryOut={bankCashAccountPeek?.out}
                                summaryClosing={bankCashAccountPeek?.closing}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>
            </TopSummaryRowWrap>

            {can("view_voucher_type_summaries") && !compact && (
                <div className="col-span-full grid w-full min-w-0 grid-cols-1 items-stretch gap-[5px] sm:grid-cols-2 lg:grid-cols-4">
                    {stats.otherStats.map((stat, idx) => renderVoucherStatCard(stat, idx))}
                </div>
            )}

            {can("view_entity_counts_summary") && !compact && (
                <div className={cn("w-full min-w-0 pt-1 -mt-1", dashboardEntityRowClass)}>
                    {/* Entity cards: count + Chart tab par master add-by-day (Vouchers card sirf number). */}
                    {[
                        {
                            title: "Total Parties",
                            scopeKey: "entity:parties",
                            value: entityScopedLists.parties.filter(
                                (p: any) =>
                                    !DASHBOARD_CHART_EXCLUDE_PARTY_IDS.has(p.id) && !p.isSystemAccount,
                            ).length,
                            chart: showVoucherDateCharts ? entityChartPartiesDaily : null,
                            chartLabel: "Parties added/day",
                            chartColor: "#2563eb",
                            chartPointsByDay: showVoucherDateCharts ? entityChartPartiesPointsByDay : [],
                        },
                        {
                            title: "Total Staff",
                            scopeKey: "entity:staff",
                            value: entityScopedLists.staff.length,
                            chart: showVoucherDateCharts ? entityChartStaffDaily : null,
                            chartLabel: "Staff added/day",
                            chartColor: "#059669",
                            chartPointsByDay: showVoucherDateCharts ? entityChartStaffPointsByDay : [],
                        },
                        {
                            title: "Bank/Cash Acc",
                            scopeKey: "entity:bank_cash",
                            value: entityScopedLists.accounts.filter(
                                (a: any) => a.accountType === "Bank" || a.accountType === "Cash",
                            ).length,
                            chart: showVoucherDateCharts ? entityChartBankCashDaily : null,
                            chartLabel: "Bank & Cash a/c added/day",
                            chartColor: "#1d4ed8",
                            chartPointsByDay: showVoucherDateCharts ? entityChartBankCashPointsByDay : [],
                        },
                        {
                            title: "Total Items",
                            scopeKey: "entity:items",
                            value: entityScopedLists.items.length,
                            chart: showVoucherDateCharts ? entityChartItemsDaily : null,
                            chartLabel: "Items added/day",
                            chartColor: "#0d9488",
                            chartPointsByDay: showVoucherDateCharts ? entityChartItemsPointsByDay : [],
                        },
                        {
                            title: "Total Vouchers",
                            scopeKey: "entity:vouchers",
                            value: entityScopedLists.vouchers.length,
                            chart: showVoucherDateCharts ? entityChartVouchersDaily : null,
                            chartLabel: "Vouchers added/day (count)",
                            chartColor: "#6366f1",
                            chartPointsByDay: showVoucherDateCharts ? entityChartVouchersCountPointsByDay : [],
                            fullViewOverride: showVoucherDateCharts
                                ? {
                                      pointsByDay: voucherAmountPointsByDay,
                                      tooltipIsCount: false,
                                      subtitle: "Voucher amount / day",
                                  }
                                : undefined,
                        },
                    ].map((item, idx) => {
                        const cardScopeHint = formatScopeHintForCard(item.scopeKey);
                        return (
                        <Card key={item.title} className={`min-w-0 flex-1 ${dashboardCardRibbonClass} ${ribbonTone(idx + 2)}`}>
                            <CardHeader className="space-y-1 p-3 pb-1">
                                <div className="flex min-w-0 items-center justify-between gap-1">
                                    <CardTitle className="min-w-0 shrink truncate text-sm">{item.title}</CardTitle>
                                    {renderDashboardSummaryScopeControls(item.scopeKey)}
                                </div>
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                                <div className="text-2xl font-bold">{item.value}</div>
                                {cardScopeHint ? (
                                    <p
                                        className="mt-0.5 truncate text-[10px] text-muted-foreground"
                                        title={cardScopeHint}
                                    >
                                        {cardScopeHint}
                                    </p>
                                ) : null}
                                {item.chart && (
                                    <div className="mt-2 border-t border-border/50 pt-2">
                                        {renderDashboardMiniBar(
                                            item.chart,
                                            item.chartLabel,
                                            item.chartColor,
                                            true,
                                            item.chartPointsByDay,
                                            "fullViewOverride" in item ? item.fullViewOverride : undefined
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
