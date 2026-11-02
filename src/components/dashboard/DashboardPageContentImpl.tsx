'use client';
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCompany } from "@/hooks/useCompany";
import { sortRecentTransactionsDesc } from "@/lib/recentTransactionsSort";
import { getActiveGate } from "@/lib/gates/gateStore";
import { isServerGateCompany } from "@/lib/companyStorageKind";
import { voucherIdFingerprint } from "@/lib/plServerLiveChangeTrace";
import { firestore } from "@/lib/firebase";
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import { applyPaymentBillWiseLinkAllocations } from '@/lib/voucherActionsClient';
import * as React from 'react';
import { useEffect, useLayoutEffect, useState, useMemo, useRef, useCallback, startTransition } from 'react';
import { engageClientHealthEmergencyBrake } from "@/lib/clientHealthMonitor";
import {
  BookText,
  Landmark,
  Package,
  ShoppingBag,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  History,
  Receipt,
  X,
  Calendar as CalendarIcon,
  Printer,
  FileDigit,
  FileText as FileTextIcon,
  Filter,
  ArrowDownCircle,
  ArrowUpCircle,
  StickyNote,
  Factory,
  HandCoins,
  BarChart3,
  LineChart,
  Search,
} from 'lucide-react';
import { MasterListChromeChevronToggle } from "@/components/layout/MasterListChromeChevronToggle";
import { cn } from '@/lib/utils';
import { proDashboardRibbonClass } from '@/lib/proTheme';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableFooter,
} from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { DateRange } from "@/components/ui/ad-calendar";
import BsDatePicker from '@/components/ui/BsDatePicker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format, startOfDay, endOfDay, isSameDay, startOfMonth, endOfMonth, differenceInDays, getYear, getMonth } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDate } from '@/hooks/useDate';
import { useIsMobile, useCalendarMonths, useMobileView } from '@/hooks/use-mobile';
import { openPrintDirect } from "@/lib/printDirect";
import usePermissions from '@/hooks/usePermissions';
import { Checkbox } from '@/components/ui/checkbox';
import dynamic from 'next/dynamic';

const DaybookReport = dynamic(
  () => import('@/components/reports/DaybookReport').then((m) => m.DaybookReport),
  { ssr: false, loading: () => null }
);
import {
  DaybookAccountDayPeekDialog,
  daybookSummaryAccountRowCn,
} from '@/components/reports/DaybookAccountDayPeekDialog';
import type { Account } from '@/components/bank-cash/types';
import { useFyScopedVouchers } from '@/hooks/useFyScopedVouchers';
import { useFyVoucherScope } from '@/contexts/FyVoucherScopeContext';
import { widenFyScopeUntilRecentMinTxns } from '@/lib/fyPagination/entityMinTxnScope';
import { companyUsesFiscalMergeDividers } from '@/lib/fyPagination/fiscalMergeFullVoucherScope';
import { useFyLoadOnDateRangeChange } from '@/hooks/useFyLoadOnDateRangeChange';
import { useVouchers } from '@/hooks/useVouchers';
import { getTransactionAmounts as getLedgerTransactionAmounts } from '@/hooks/use-transactions';
import { computeAccountLedgerDaySummary } from '@/lib/accountLedgerDaySummary';
import { getOnlineCompanySyncStatusRibbon } from '@/lib/onlineCompanySelectorSyncPolicy';
import { FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT } from '@/lib/firebaseLedgerCompanySyncPrefs';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { TransactionColumnKey } from '@/components/vouchers/TransactionsTable';

const TransactionsTable = dynamic(
  () =>
    import('@/components/vouchers/TransactionsTable').then((m) => m.TransactionsTable),
  { ssr: false, loading: () => null }
);
const LedgerDesktopFooter = dynamic(
  () =>
    import('@/components/vouchers/LedgerDesktopFooter').then((m) => m.LedgerDesktopFooter),
  { ssr: false, loading: () => null }
);
import { LedgerFooterCheckboxPill } from '@/components/vouchers/ledgerFooterChrome';
import { MobileTransactionsPager } from '@/components/vouchers/MobileTransactionsPager';
import type {
  TransactionSortBy,
  TransactionSortOrder,
} from '@/components/vouchers/TransactionTableSortDropdown';
import { sortTransactions } from '@/lib/transactionSort';
import { useRowsPerPage } from '@/hooks/useRowsPerPage';
import { useRowsPerPageSelectControl } from '@/hooks/useRowsPerPageSelect';
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from '@/lib/rowsPerPageSelect';
import {
  COLUMN_LABELS,
  useShowNotes,
  useTransactionVisibleColumns,
} from '@/components/vouchers/transactionColumnVisibility';
import { LedgerFooterColumnsMenu } from '@/components/vouchers/LedgerFooterColumnsMenu';
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  getOppositeAccountLabel,
  getTransactionQuickSearchHaystack,
} from "@/components/vouchers/transactionTableShared";
import { useDashboard } from '@/hooks/useDashboard';
import AdCalendar from "@/components/ui/ad-calendar";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { useAuth } from '@/hooks/useAuth';
import { adToBs, bsToAd, getBSMonthDays } from "@/lib/bs-date";
import { motion, AnimatePresence } from 'framer-motion';
import { AddVoucherDialog } from '@/components/vouchers/AddVoucherDialog';
import { useInterCompanyLedgerChangeDetectDialog } from '@/hooks/useInterCompanyLedgerChangeDetectDialog';
import { HistoryDialog } from '@/components/vouchers/HistoryDialog';
import { LinkAdvancesToVoucherDialog } from '@/components/vouchers/LinkAdvancesToVoucherDialog';
import { LinkPaymentToTxnsDialog } from '@/components/vouchers/LinkPaymentToTxnsDialog';
import { toast } from 'sonner';
import { getCompanyDocFromBrowserDb } from '@/lib/localCompanyDocMirror';
import {
  useTransactions,
  DAYBOOK_TRANSACTIONS_ENTITY,
  EMPTY_TRANSACTIONS_LIST,
} from '@/hooks/use-transactions';
import { useFeatureAccess } from '@/hooks/use-feature-access';
import { FinancialSummaryCards } from '@/components/reports/FinancialSummaryCards';
import { shouldReplaceWithMasterDetailCanonical } from "@/lib/maybeReplaceMasterDetailUrl";
import { isDashboardRedirectGuardActive } from "@/lib/protectFromUnwantedDashboardRedirect";
import { orderedCashFlowCategories } from "@/lib/cashFlowCategoryOrder";
import {
  voucherCountsAsDashboardPaySalary,
  voucherCountsAsDashboardPaymentOutExcludingPaySalary,
} from "@/lib/dashboardPaySalaryStat";
import { computeReceivablesPayablesFinancialSummary } from "@/lib/receivablesPayablesFinancialSummary";
import {
  buildRpDialogSections,
  countRpDialogSide,
  normalizeReceivablesPayablesSummary,
  RP_DIALOG_FILTER_OPTIONS,
  sumRpDialogSide,
  type RpCategoryFilter,
} from "@/lib/receivablesPayablesDialogUi";
import { useServerReceivablesPayablesSummary } from "@/hooks/useServerReceivablesPayablesSummary";
import { RecurringAutoSummaryCard } from "@/components/dashboard/RecurringAutoSummaryCard";
import { pbSessionUserName, logUserNameLookupError } from "@/lib/pocketbaseData/userDisplayNameSession";
import {
  DashboardWelcomeFooterBanner,
  dashboardWelcomeFooterReservePx,
} from "@/components/dashboard/DashboardWelcomeFooterBanner";
import {
  getCurrentMonthDateRange,
  MonthYearFilter as DashboardMonthYearFilter,
} from "@/components/dashboard/MonthYearFilter";
import {
  dashboardTabLoadsRecentTransactionPipeline,
  dashboardTabLoadsSummaryStockStats,
  dashboardTabShouldKeepAlivePanel,
  readDashboardVisibleCardFromStorage,
  readDashboardSummaryChartKindFromStorage,
  readDashboardSummaryChartsFromStorage,
  syncDashboardSummaryChartKindToSession,
  syncDashboardSummaryChartsToSession,
} from "@/lib/dashboardTabPanels";

/** Desktop Recent scrollport: ~1 table row clearance above merged footer ribbon. */
const RECENT_DESKTOP_FOOTER_SCROLL_ROW_SLACK_PX = 58;
/** Menu vertical line ↔ txn/footer containers; txn card ↔ footer container. */
const RECENT_DESKTOP_EDGE_GAP_PX = 2;
/** Desktop Recent: header + table + footer ek saath — is se chhoti width par H-scroll. */
const RECENT_DESKTOP_MIN_WIDTH_IN = 11.5;

/** Recent footer sort: sirf current page rows — paging window poori list par fixed rehti hai. */
function sortRecentDashboardPageRows<T extends Record<string, unknown>>(
  pageRows: T[],
  sortBy: TransactionSortBy,
  sortOrder: TransactionSortOrder
): T[] {
  if (!pageRows.length) return pageRows;
  if (sortBy === "date") {
    let sorted = sortRecentTransactionsDesc(pageRows);
    if (sortOrder === "asc") sorted = [...sorted].reverse();
    return sorted;
  }
  return sortTransactions(pageRows, sortBy, sortOrder, { tieBreakCreatedAtDesc: true });
}

// Type definitions
type Voucher = {
  id: string;
  type: string;
  subType?: string;
  total?: number;
  amount?: number;
  partyId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  staffId?: string;
  date: any;
  voucherNumber?: string;
  invoiceNumber?: string;
  narration?: string;
  title?: string;
  entries?: any[];
  lineItems?: any[];
  userId?: string;
  taxAccountId?: string;
  incomeAccountId?: string;
  expenseAccountId?: string;
};

function resolveDashboardRecentDateRange(
  recentDateRange: DateRange | undefined,
  dateSystem: string
): DateRange {
  return recentDateRange ?? getCurrentMonthDateRange(dateSystem);
}

// Helper: Safe Date Converter
const safeToDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (typeof date.toDate === 'function') return date.toDate();
    if (date instanceof Date) return date;
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch (e) {
    return null;
  }
};

// Helper: Calculate Debit/Credit for Journal/Contra
function getTransactionAmounts(transaction: any) {
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
    case 'adjustment':
      if (t.entries && Array.isArray(t.entries)) {
        debit = t.entries.reduce((sum: number, e: any) => sum + Number(e.debit || 0), 0);
        credit = t.entries.reduce((sum: number, e: any) => sum + Number(e.credit || 0), 0);
      }
      break;
  }
  return { debit, credit };
}

/** Recent search: is se zyada lagne par UI health emergency overlay. */
const RECENT_SEARCH_SLOW_MS = 5_000;

type RecentSearchHaystackRow = {
  tx: Record<string, unknown>;
  hay: string;
  numericFields: number[];
};

function buildRecentTransactionSearchHaystackRow(
  tx: Record<string, unknown>,
  journalAccountNames: Record<string, string>,
  userNames: Record<string, string>,
): RecentSearchHaystackRow {
  const names = { ...journalAccountNames, ...userNames };
  const pieces: string[] = [];

  pieces.push(getTransactionQuickSearchHaystack(tx, names));
  pieces.push(getOppositeAccountLabel(tx, names, "daybook", undefined, undefined) || "");
  if (typeof tx?.title === "string" && tx.type === "note") pieces.push(tx.title);

  const uid = tx?.userId;
  if (typeof uid === "string" && userNames[uid]) pieces.push(userNames[uid]);

  for (const key of ["debit", "credit", "total", "amount", "balance", "runningBalance", "outstanding"] as const) {
    const v = tx[key];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) {
      pieces.push(String(n), n.toFixed(2), n.toLocaleString("en-IN"));
      pieces.push(n.toLocaleString());
    }
  }

  const d =
    tx?.date && (typeof (tx.date as { toDate?: () => Date }).toDate === "function"
      ? (tx.date as { toDate: () => Date }).toDate()
      : new Date(tx.date as string | number | Date));
  if (d && !isNaN(d.getTime())) {
    pieces.push(d.toISOString(), d.toLocaleDateString(), d.toLocaleString());
  }

  const hay = pieces.join(" ").toLowerCase().replace(/,/g, " ");
  const numericFields = ["debit", "credit", "total", "amount", "balance", "runningBalance", "outstanding"].map((k) =>
    Number(tx[k]),
  );

  return { tx, hay, numericFields };
}

/** Recent Search: voucher/narration/accounts/user/amounts — kahin se bhi token match. */
function recentSearchHaystackRowMatchesQuery(row: RecentSearchHaystackRow, qLower: string): boolean {
  if (!qLower) return true;
  const tokens = qLower
    .split(/\s+/)
    .map((t) => t.replace(/,/g, "").trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  for (const tok of tokens) {
    if (!tok) continue;
    if (row.hay.includes(tok)) continue;
    const qNum = Number(tok.replace(/,/g, ""));
    if (
      Number.isFinite(qNum) &&
      row.numericFields.some((n) => Number.isFinite(n) && Math.abs(n - qNum) < 0.000001)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

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

// --- REUSABLE DATE FILTER COMPONENT ---
const MonthYearFilter = ({ 
  dateRange, 
  setDateRange, 
  dateSystem 
}: { 
  dateRange: DateRange | undefined, 
  setDateRange: (range: DateRange | undefined) => void, 
  dateSystem: string 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  // NEW (MonthYearFilter)
const [mode, setMode] = useState<'all' | 'custom'>('all');
  
  // Current Date Infos
  const today = new Date();
  const currentBs = adToBs(today);
  
  // Selection State
  const [selectedBsYear, setSelectedBsYear] = useState(currentBs.y);
  const [selectedBsMonth, setSelectedBsMonth] = useState(currentBs.m);
  const [selectedAdYear, setSelectedAdYear] = useState(getYear(today));
  const [selectedAdMonth, setSelectedAdMonth] = useState(getMonth(today)); // 0-11

  const bsYears = Array.from({length: 10}, (_, i) => currentBs.y - 5 + i);
  const bsMonths = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
  
  const adYears = Array.from({length: 10}, (_, i) => getYear(today) - 5 + i);
  const adMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const applyFilter = () => {
    if (mode === 'all') {
      setDateRange(undefined);
    } else {
      if (dateSystem === 'BS') {
        const startAd = bsToAd({ y: selectedBsYear, m: selectedBsMonth, d: 1 });
        const daysInMonth = getBSMonthDays(selectedBsYear)[selectedBsMonth - 1];
        const endAd = bsToAd({ y: selectedBsYear, m: selectedBsMonth, d: daysInMonth });
        setDateRange({ from: startAd, to: endAd });
      } else {
        const start = new Date(selectedAdYear, selectedAdMonth, 1);
        const end = endOfMonth(start);
        setDateRange({ from: start, to: end });
      }
    }
    setIsOpen(false);
  };

  const displayText = useMemo(() => {
    if (!dateRange?.from) return "All Time";
    if (dateSystem === 'BS') {
       const bs = adToBs(dateRange.from);
       return `${bsMonths[bs.m - 1]} ${bs.y}`;
    }
    return format(dateRange.from, 'MMM yyyy');
  }, [dateRange, dateSystem]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
            variant="outline" 
            size="sm" 
            className="h-7 px-2 text-xs font-normal"
            onClick={(e) => {
                e.stopPropagation(); // Prevents clicking the card background
                setIsOpen(true);
            }}
        >
          <CalendarIcon className="mr-1 h-3 w-3" />
          {displayText}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 z-50" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Select Month/Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              {dateSystem === 'BS' ? (
                <>
                  <Select value={selectedBsYear.toString()} onValueChange={(v) => setSelectedBsYear(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>
                      {bsYears.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={selectedBsMonth.toString()} onValueChange={(v) => setSelectedBsMonth(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                    <SelectContent>
                      {bsMonths.map((m, i) => <SelectItem key={i} value={(i+1).toString()}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <>
                  <Select value={selectedAdYear.toString()} onValueChange={(v) => setSelectedAdYear(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>
                      {adYears.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={selectedAdMonth.toString()} onValueChange={(v) => setSelectedAdMonth(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                    <SelectContent>
                      {adMonths.map((m, i) => <SelectItem key={i} value={i.toString()}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          )}

          <Button className="w-full" onClick={applyFilter}>Ok</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
// ------------------------------------

const BankCashSummary = () => {
    const { processedAccounts, processedTaxes, vouchers: periodVouchers } = useFyScopedVouchers();
    const { vouchers: ledgerVouchers } = useVouchers();
    const { dateSystem, formatCurrency } = useDate();
    const [selectedSummaryRowId, setSelectedSummaryRowId] = React.useState<string | null>(null);
    const [accountDayPeek, setAccountDayPeek] = React.useState<{
      account: Account;
      dateRange: DateRange | undefined;
    } | null>(null);
    const [bankCashDateRange, setBankCashDateRange] = React.useState<DateRange | undefined>(() =>
      getCurrentMonthDateRange(dateSystem)
    );

    const openAccountDayPeek = (accountId: string, rowKey: string) => {
      const account = (processedAccounts || []).find((item) => String(item.id) === String(accountId));
      if (!account) return;
      setSelectedSummaryRowId(rowKey);
      setAccountDayPeek({ account: account as Account, dateRange: bankCashDateRange });
    };

    useEffect(() => {
      setBankCashDateRange((range) => (range?.from ? getCurrentMonthDateRange(dateSystem) : range));
    }, [dateSystem]);


    const bankCashSummary = React.useMemo(() => {
        if (!processedAccounts || !periodVouchers || !ledgerVouchers) return { cashAccounts: [], bankAccounts: [], totalBankInflow: 0, totalBankOutflow: 0, totalCashInflow: 0, totalCashOutflow: 0, totalClosingBalance: 0 };
    
        const fromDate = bankCashDateRange?.from ? startOfDay(bankCashDateRange.from) : null;
        const toDate = bankCashDateRange?.to ? endOfDay(bankCashDateRange.to) : fromDate ? endOfDay(fromDate) : null;
        const today = new Date();
    
        const summaryAccounts = processedAccounts.map((acc) => {
          const newAcc = { ...acc, inflow: 0, outflow: 0, balance: 0 };
          const ledgerClosing = computeAccountLedgerDaySummary(
            acc,
            ledgerVouchers,
            today,
            null,
            (voucher) => {
              const { debit, credit } = getLedgerTransactionAmounts(
                voucher,
                "account",
                acc,
                "amount",
                processedAccounts,
                processedTaxes
              );
              return { debit: Number(debit) || 0, credit: Number(credit) || 0 };
            }
          ).closing;

          periodVouchers.forEach((voucher) => {
            const txDate = safeToDate(voucher.date);
            if (fromDate && toDate && !(txDate && txDate >= fromDate && txDate <= toDate)) return;

            const { debit, credit } = getLedgerTransactionAmounts(
              voucher,
              "account",
              acc,
              "amount",
              processedAccounts,
              processedTaxes
            );
            newAcc.inflow += Number(debit || 0);
            newAcc.outflow += Number(credit || 0);
          });

          newAcc.balance = ledgerClosing;
          return newAcc;
        }).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    
        const cashAccounts = summaryAccounts.filter((acc) => acc.accountType === 'Cash');
        const bankAccounts = summaryAccounts.filter((acc) => acc.accountType === 'Bank');
    
        const totalBankInflow = bankAccounts.reduce((sum, acc) => sum + acc.inflow, 0);
        const totalBankOutflow = bankAccounts.reduce((sum, acc) => sum + acc.outflow, 0);
        const totalCashInflow = cashAccounts.reduce((sum, acc) => sum + acc.inflow, 0);
        const totalCashOutflow = cashAccounts.reduce((sum, acc) => sum + acc.outflow, 0);
        // Combined Bank + Cash closing balance for quick dashboard visibility.
        const totalClosingBalance = [...bankAccounts, ...cashAccounts].reduce((sum, acc) => sum + acc.balance, 0);

        return { cashAccounts, bankAccounts, totalBankInflow, totalBankOutflow, totalCashInflow, totalCashOutflow, totalClosingBalance };
      }, [processedAccounts, processedTaxes, periodVouchers, ledgerVouchers, bankCashDateRange]);

    return (
      <>
        <Card
            id="bank-cash-summary-area"
            // Dashboard top cards: give each card a different soft ribbon tone.
            // Bold border requested for dashboard cards while preserving ribbon tint.
            // APK WebView compatibility: force same top ribbon class used by header/sidebar so stripe is always visible.
            className={cn(
              "app-chrome-top-ribbon flex-1 flex flex-col min-h-0",
              proDashboardRibbonClass(1),
            )}
        >
            <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <CardTitle className="text-sm font-medium">Bank/Cash Summary</CardTitle>
                      {/* Show combined closing balance (Bank + Cash) beside summary title. */}
                      <span className={cn("text-xs sm:text-sm font-semibold whitespace-nowrap", bankCashSummary.totalClosingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                        Closing: {formatCurrency(bankCashSummary.totalClosingBalance, { showDrCr: true })}
                      </span>
                    </div>
                    <DashboardMonthYearFilter dateRange={bankCashDateRange} setDateRange={setBankCashDateRange} dateSystem={dateSystem} />
                </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 p-0">
                <ScrollArea className="flex-1 w-full">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Total In</TableHead>
                        <TableHead className="text-right">Total Out</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                        {bankCashSummary.bankAccounts.map(acc => {
                          const rowKey = `bank:${acc.id}`;
                          const selected = selectedSummaryRowId === rowKey;
                          return (
                                <TableRow
                                  key={rowKey}
                                  aria-selected={selected}
                                  data-pl-daybook-summary-selected={selected ? "" : undefined}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedSummaryRowId(rowKey);
                                  }}
                                  onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    openAccountDayPeek(String(acc.id), rowKey);
                                  }}
                                  className={cn(daybookSummaryAccountRowCn(selected), "pl-daybook-summary-row", selected && "pl-daybook-summary-row-selected", "border-b")}
                                >
                                    <TableCell>{acc.accountName}</TableCell>
                                    <TableCell>{acc.accountType}</TableCell>
                                    <TableCell className="text-right text-green-600">{acc.inflow > 0 ? formatCurrency(acc.inflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className="text-right text-red-600">{acc.outflow > 0 ? formatCurrency(acc.outflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className={cn("text-right font-semibold", acc.balance >= 0 ? "text-green-600" : "text-red-600")}>
                                      {acc.balance !== 0 ? formatCurrency(acc.balance, { showDrCr: true, duration: 2 }) : 'Rs. 0.00 Dr'}
                                    </TableCell>
                                </TableRow>
                          );
                        })}
                         <TableRow className="font-bold bg-muted/50 border-b-2 border-foreground">
                            <TableCell colSpan={2}>Bank Total</TableCell>
                            <TableCell className="text-right text-green-600">{formatCurrency(bankCashSummary.totalBankInflow, {noSuffix: true, duration: 2})}</TableCell>
                            <TableCell className="text-right text-red-600">{formatCurrency(bankCashSummary.totalBankOutflow, {noSuffix: true, duration: 2})}</TableCell>
                            <TableCell className={cn("text-right", (bankCashSummary.totalBankInflow-bankCashSummary.totalBankOutflow) >= 0 ? "text-green-600" : "text-red-600")}>
                                {formatCurrency(bankCashSummary.bankAccounts.reduce((sum, a) => sum + a.balance, 0), { showDrCr: true, duration: 2 })}
                            </TableCell>
                        </TableRow>
                          {bankCashSummary.cashAccounts.map(acc => {
                            const rowKey = `cash:${acc.id}`;
                            const selected = selectedSummaryRowId === rowKey;
                            return (
                               <TableRow
                                  key={rowKey}
                                  aria-selected={selected}
                                  data-pl-daybook-summary-selected={selected ? "" : undefined}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedSummaryRowId(rowKey);
                                  }}
                                  onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    openAccountDayPeek(String(acc.id), rowKey);
                                  }}
                                  className={cn(daybookSummaryAccountRowCn(selected), "pl-daybook-summary-row", selected && "pl-daybook-summary-row-selected", "border-b")}
                                >
                                    <TableCell>{acc.accountName}</TableCell>
                                    <TableCell>{acc.accountType}</TableCell>
                                    <TableCell className="text-right text-green-600">{acc.inflow > 0 ? formatCurrency(acc.inflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className="text-right text-red-600">{acc.outflow > 0 ? formatCurrency(acc.outflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className={cn("text-right font-semibold", acc.balance >= 0 ? "text-green-600" : "text-red-600")}>
                                      {acc.balance !== 0 ? formatCurrency(acc.balance, { showDrCr: true, duration: 2 }) : 'Rs. 0.00 Dr'}
                                    </TableCell>
                                </TableRow>
                            );
                          })}
                         <TableRow className="font-bold bg-muted/50 border-b-2 border-foreground">
                            <TableCell colSpan={2}>Cash Total</TableCell>
                            <TableCell className="text-right text-green-600">{formatCurrency(bankCashSummary.totalCashInflow, {noSuffix: true, duration: 2})}</TableCell>
                            <TableCell className="text-right text-red-600">{formatCurrency(bankCashSummary.totalCashOutflow, {noSuffix: true, duration: 2})}</TableCell>
                            <TableCell className={cn("text-right", (bankCashSummary.totalCashInflow - bankCashSummary.totalCashOutflow) >= 0 ? "text-green-600" : "text-red-600")}>
                                {formatCurrency(bankCashSummary.cashAccounts.reduce((sum, a) => sum + a.balance, 0), { showDrCr: true, duration: 2 })}
                            </TableCell>
                        </TableRow>
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </CardContent>
        </Card>
        <DaybookAccountDayPeekDialog
          open={!!accountDayPeek}
          onOpenChange={(open) => {
            if (!open) setAccountDayPeek(null);
          }}
          account={accountDayPeek?.account ?? null}
          daybookDate={undefined}
          initialDateRange={accountDayPeek?.dateRange}
        />
      </>
    )
};

export function DashboardPageContentImpl() {
  /** Mobile Recent Transactions footer: chevron se buttons row show/hide (localStorage persist). */
  const [recentFooterButtonsHidden, setRecentFooterButtonsHidden] = useState(false);
  useEffect(() => {
    try { if (window.localStorage.getItem("pl_mobile_recent_footer_hidden") === "1") setRecentFooterButtonsHidden(true); } catch {}
  }, []);
  const toggleRecentFooterButtonsHidden = useCallback(() => {
    setRecentFooterButtonsHidden((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("pl_mobile_recent_footer_hidden", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);
  /** Mobile Daybook footer: chevron se pager row (+ bottom tabs) show/hide (alag localStorage key). */
  const [daybookFooterHidden, setDaybookFooterHidden] = useState(false);
  useEffect(() => {
    try { if (window.localStorage.getItem("pl_mobile_daybook_footer_hidden") === "1") setDaybookFooterHidden(true); } catch {}
  }, []);
  const toggleDaybookFooterHidden = useCallback(() => {
    setDaybookFooterHidden((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("pl_mobile_daybook_footer_hidden", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);
  const { company, companyId, setCompanyId } = useCompany();
  const { visibleCard, setVisibleCard } = useDashboard();
  const dashboardRecentPipelineActive = dashboardTabLoadsRecentTransactionPipeline(visibleCard);
  const dashboardSummaryStockActive = dashboardTabLoadsSummaryStockStats(visibleCard);
  /** Daybook: first open ke baad DOM me rakho — tab switch par TransactionsTable dubara mount na ho. */
  const [dashboardKeepAliveDaybook, setDashboardKeepAliveDaybook] = useState(() => {
    const initial = readDashboardVisibleCardFromStorage();
    return dashboardTabShouldKeepAlivePanel(initial);
  });
  useEffect(() => {
    if (dashboardTabShouldKeepAlivePanel(visibleCard)) {
      setDashboardKeepAliveDaybook(true);
    }
  }, [visibleCard]);
  const [onlineSyncPrefsEpoch, setOnlineSyncPrefsEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setOnlineSyncPrefsEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bump);
  }, []);
  const onlineSyncStatusRibbon = useMemo(() => {
    void onlineSyncPrefsEpoch;
    if (!companyId) return { show: false, message: "" };
    return getOnlineCompanySyncStatusRibbon(companyId, company);
  }, [company, companyId, onlineSyncPrefsEpoch]);
  /** Dashboard-only: company / Files-Data switch pe 2s popup (permanent ribbon nahi). */
  const [onlineSyncStatusPopup, setOnlineSyncStatusPopup] = useState<string | null>(null);
  const onlineSyncPopupKeyRef = useRef("");
  useEffect(() => {
    if (!onlineSyncStatusRibbon.show || !onlineSyncStatusRibbon.message) {
      setOnlineSyncStatusPopup(null);
      onlineSyncPopupKeyRef.current = "";
      return;
    }
    const key = `${String(companyId || "").trim()}|${onlineSyncStatusRibbon.message}|${onlineSyncPrefsEpoch}`;
    if (key === onlineSyncPopupKeyRef.current) return;
    onlineSyncPopupKeyRef.current = key;
    setOnlineSyncStatusPopup(onlineSyncStatusRibbon.message);
    const t = window.setTimeout(() => setOnlineSyncStatusPopup(null), 2000);
    return () => window.clearTimeout(t);
  }, [companyId, onlineSyncStatusRibbon.show, onlineSyncStatusRibbon.message, onlineSyncPrefsEpoch]);
  const { can } = usePermissions();
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { vouchers, loading: vouchersLoading, processedItems, processedParties, processedStaff, processedTaxes, processedAccounts, expenseAccounts, journalAccountNames: voucherJournalAccountNames } = useFyScopedVouchers();
  const fy = useFyVoucherScope();
  const pendingEditVoucherRef = useRef<{ companyId: string; voucherId: string } | null>(null);
  const showFabState = useState(true);
  const showFab = showFabState[0];
  const setShowFab = showFabState[1];
  const lastScrollY = useRef(0);
  const hideFabTimeout = useRef<NodeJS.Timeout | null>(null);
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } = useDate();
  const isMobile = useIsMobile();
  /** Phone detect: APK/WebView me PC mode + width≥768 par `isMobile` false ho jata hai — Recent header phir bhi compact hona chahiye. */
  const { isRealMobile } = useMobileView();
  const recentTransactionsCompact = isMobile || isRealMobile;
  const calendarMonths = useCalendarMonths();
  
  const [loading, setLoading] = React.useState(true);
  /*
   * FREEZE: Dashboard boot — no full-page skeleton; background voucher merge must not re-block UI.
   * See AGENTS.md "Freeze: Dashboard boot — SQLite-first, no UI freeze".
   */
  const [initialVoucherBootSettled, setInitialVoucherBootSettled] = React.useState(false);
  
  const [userNames, setUserNames] = React.useState<Record<string, string>>({});
  
  const [receivablesPayablesOpen, setReceivablesPayablesOpen] = React.useState(false);
  const [taxSummaryOpen, setTaxSummaryOpen] = useState(false);
  
  // Filter for Receivables & Payables Dialog
  const [receivablePayableFilter, setReceivablePayableFilter] = useState<RpCategoryFilter>("all");
  const [cashFlowFilter, setCashFlowFilter] = useState<'all' | 'inflow' | 'outflow'>('all');
  const [cashFlowCategoryFilter, setCashFlowCategoryFilter] = useState<'all' | 'party' | 'staff' | 'tax' | 'income_expense' | 'other'>('all');
  const [receivablesDateRange, setReceivablesDateRange] = useState<DateRange | undefined>(undefined);

  /** Print / page-level R/P: same server aggregation as FinancialSummaryCards (duplicate API — range alag ho sakta hai). */
  const {
    summary: pageServerRpSummary,
    loading: pageServerRpLoading,
    useClientFallback: pageServerRpClientFb,
    preferServer: pagePreferServerRp,
  } = useServerReceivablesPayablesSummary({
    companyId: company?.id,
    storageOption: company?.storageOption,
    receivablesDateRange,
    enabled: dashboardSummaryStockActive,
  });

  const [cashFlowDateRange, setCashFlowDateRange] = useState<DateRange | undefined>(undefined);
  const [taxDateRange, setTaxDateRange] = useState<DateRange | undefined>(undefined);
  const [stockDateRange, setStockDateRange] = useState<DateRange | undefined>(undefined);
  const [taxFilter, setTaxFilter] = useState<'all' | 'input' | 'output'>('all');
  const [selectedTaxId, setSelectedTaxId] = useState<string | null>(null);

    // State for new dialogs and date pickers
    const [stockSummaryOpen, setStockSummaryOpen] = useState(false);
    const [cashFlowOpen, setCashFlowOpen] = useState(false);

    const [showRecentNarration, setShowRecentNarration] = useState(true);
    /** Desktop Daybook tab: slot under the Welcome row for the Daybook pagination footer (portal target). */
    const [daybookFooterSlot, setDaybookFooterSlot] = useState<HTMLElement | null>(null);
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  
  const [recentRowsPerPage, setRecentRowsPerPage] = useRowsPerPage(10, "app-recent-rows-per-page");
  const [recentCurrentPage, setRecentCurrentPage] = React.useState(1);
  const [recentSortBy, setRecentSortBy] = React.useState<TransactionSortBy>("date");
  const [recentSortOrder, setRecentSortOrder] = React.useState<TransactionSortOrder>('desc');
  const {
    selectValue: recentRowsPerPageSelectValue,
    onSelectValueChange: handleRecentRowsPerPageChange,
  } = useRowsPerPageSelectControl(
    recentRowsPerPage,
    setRecentRowsPerPage,
    setRecentCurrentPage,
    ROWS_PER_PAGE_OPTIONS_DEFAULT,
    '10'
  );
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = React.useState(false);
  const [selectedVoucher, setSelectedVoucher] = React.useState<any>(null);
  /** Auto recurring Dr/Cr popup: row → template source body voucher (Recent table jaisa) */
  const openRecurringBodyVoucher = React.useCallback(
    (bodyVoucherId: string) => {
      const vid = String(bodyVoucherId || "").trim();
      if (!vid) return;
      const v = vouchers.find((x) => String((x as { id?: string }).id) === vid);
      if (v) {
        setSelectedVoucher(v);
        setIsVoucherDialogOpen(true);
      } else {
        toast.info("Voucher not loaded", {
          description: "This voucher may be outside the current list. Open it from Daybook or refresh.",
        });
      }
    },
    [vouchers],
  );
  const [historyVoucher, setHistoryVoucher] = React.useState<any>(null);
  const [linkAdvancesVoucher, setLinkAdvancesVoucher] = React.useState<any>(null);
  const [linkPaymentVoucher, setLinkPaymentVoucher] = React.useState<any>(null);
  const { handleInterCompanyChangeDetectedClick, interCompanyChangeDetectDialog } =
    useInterCompanyLedgerChangeDetectDialog();
  const footerRibbonRef = useRef<HTMLDivElement>(null);
  const [footerRibbonHeightPx, setFooterRibbonHeightPx] = useState(168);
  /** Summary footer ke bagal Chart — same screen, figures vs mini charts. */
  const [summaryChartsPane, setSummaryChartsPane] = useState(() =>
    readDashboardSummaryChartsFromStorage(),
  );
  const [summaryChartKind, setSummaryChartKind] = useState(() =>
    readDashboardSummaryChartKindFromStorage(),
  );
  const [summaryChartPaneMounted, setSummaryChartPaneMounted] = useState(false);
  const summaryChartMountIdleRef = useRef<number | null>(null);
  /** Summary/Chart: dubara mount na ho; doosre footer tab par voucher scan band. */
  const [dashboardKeepAliveSummary, setDashboardKeepAliveSummary] = useState(() => {
    const tab = readDashboardVisibleCardFromStorage();
    return tab === "financial-summaries" || readDashboardSummaryChartsFromStorage();
  });
  useEffect(() => {
    if (visibleCard === "financial-summaries") setDashboardKeepAliveSummary(true);
  }, [visibleCard]);
  const scheduleSummaryChartPaneMount = useCallback(() => {
    if (summaryChartPaneMounted) return;
    if (summaryChartMountIdleRef.current != null) return;
    const mount = () => {
      summaryChartMountIdleRef.current = null;
      startTransition(() => setSummaryChartPaneMounted(true));
    };
    if (typeof requestIdleCallback !== "undefined") {
      summaryChartMountIdleRef.current = requestIdleCallback(mount, { timeout: 2500 });
    } else {
      summaryChartMountIdleRef.current = window.setTimeout(mount, 16) as unknown as number;
    }
  }, [summaryChartPaneMounted]);
  useEffect(() => {
    if (!summaryChartsPane) return;
    scheduleSummaryChartPaneMount();
  }, [summaryChartsPane, scheduleSummaryChartPaneMount]);
  useEffect(
    () => () => {
      if (summaryChartMountIdleRef.current == null) return;
      if (typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(summaryChartMountIdleRef.current);
      } else {
        window.clearTimeout(summaryChartMountIdleRef.current);
      }
      summaryChartMountIdleRef.current = null;
    },
    [],
  );
  const applySummaryChartsPane = useCallback(
    (chart: boolean, kind?: "bar" | "line") => {
      startTransition(() => {
        setSummaryChartsPane(chart);
        syncDashboardSummaryChartsToSession(chart);
        if (kind) {
          setSummaryChartKind(kind);
          syncDashboardSummaryChartKindToSession(kind);
        }
        if (chart) scheduleSummaryChartPaneMount();
      });
    },
    [scheduleSummaryChartPaneMount],
  );
  const summaryTabVisible = visibleCard === "financial-summaries";
  const [greeting, setGreeting] = useState('');
  
  const [recentDateRange, setRecentDateRange] = React.useState<DateRange | undefined>();
  useFyLoadOnDateRangeChange(recentDateRange);
  const [isRecentCalendarOpen, setIsRecentCalendarOpen] = React.useState(false);
  const [tempRecentDateRange, setTempRecentDateRange] = React.useState<DateRange | undefined>(undefined);
  const [recentFilters, setRecentFilters] = useState<Record<string, string>>({});
  /** Recent search: live filter; sirf sync filter ≥5s ho to health popup. */
  const [recentQuickSearchInput, setRecentQuickSearchInput] = useState("");
  const recentSearchLastFilterMsRef = useRef(0);
  const recentSearchSlowBrakeAtRef = useRef(0);
  /** Recent card quick chip: click -> all-time unapproved only (date/type/column filters ignore). */
  const [recentUnapprovedOnly, setRecentUnapprovedOnly] = useState(false);
  const [activeRecentFilter, setActiveRecentFilter] = useState<string | null>(null);
  const [isDateChange, setIsDateChange] = useState(false);
  const isReportsEnabled = useFeatureAccess('reports');

  const transactionDates = useMemo(() => {
    if (!dashboardRecentPipelineActive) return [];
    const range = resolveDashboardRecentDateRange(recentDateRange, dateSystem);
    let pool = vouchers;
    if (range.from) {
      const fromDate = startOfDay(range.from);
      const toDate = range.to ? endOfDay(range.to) : endOfDay(fromDate);
      pool = vouchers.filter((v) => {
        const d = safeToDate(v.date);
        return d != null && d >= fromDate && d <= toDate;
      });
    }
    return pool.map((v) => safeToDate(v.date)).filter(Boolean) as Date[];
  }, [vouchers, dashboardRecentPipelineActive, recentDateRange, dateSystem]);

  // Open voucher in edit mode when navigating from alert link (dashboard?editVoucher=id&companyId=cid)
  useEffect(() => {
    const editVoucherId = searchParams.get('editVoucher');
    const urlCompanyId = searchParams.get('companyId');
    if (editVoucherId && urlCompanyId) {
      pendingEditVoucherRef.current = { companyId: urlCompanyId, voucherId: editVoucherId };
      setCompanyId(urlCompanyId);
    }
  }, [searchParams, setCompanyId]);

  useEffect(() => {
    const pending = pendingEditVoucherRef.current;
    if (!pending || companyId !== pending.companyId || !pending.voucherId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, `companies/${pending.companyId}/vouchers`, pending.voucherId));
        const fromFirestore = snap.exists()
          ? (() => {
              const d = snap.data();
              const dateVal = d.date;
              return {
                id: snap.id,
                ...d,
                date: dateVal?.toDate ? dateVal.toDate() : dateVal,
              };
            })()
          : null;
        const fromLocal =
          fromFirestore ??
          ((await getCompanyDocFromBrowserDb(pending.companyId, "vouchers", pending.voucherId)) as Record<
            string,
            unknown
          > | null);
        if (fromLocal) {
          const dateVal = (fromLocal as { date?: { toDate?: () => Date } | Date }).date;
          const voucher = {
            ...fromLocal,
            id: String(fromLocal.id ?? pending.voucherId),
            date: dateVal && typeof dateVal === "object" && "toDate" in dateVal && typeof dateVal.toDate === "function"
              ? dateVal.toDate()
              : dateVal,
          };
          if (!fromFirestore) {
            toast.warning('Opened from offline copy', {
              description: 'This voucher is not on the server yet. Save will upload it; delete will mark it removed.',
            });
          }
          setSelectedVoucher(voucher);
          setIsVoucherDialogOpen(true);
        } else {
          toast.info('Voucher not found', { description: 'It may have been deleted.' });
        }
      } catch (e) {
        console.error('Failed to open voucher from alert link', e);
        toast.error('Failed to open voucher');
      } finally {
        pendingEditVoucherRef.current = null;
        // companyId / searchParams deps se effect dubara — URL pehle hi /dashboard ho to replace mat chalao
        // APK mobile approve guard active ho to bhi /dashboard push mat karo (user ko original page par rakho).
        if (
          !isDashboardRedirectGuardActive() &&
          shouldReplaceWithMasterDetailCanonical("/dashboard")
        ) {
          router.replace("/dashboard");
        }
      }
    })();
  }, [companyId, router]);

  useEffect(() => {
  setReceivablesDateRange(undefined);
  setCashFlowDateRange(undefined);
  setTaxDateRange(undefined);
  setStockDateRange(undefined);
}, [dateSystem]);


  const newYearInfo = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const currentAdYear = today.getFullYear();
    const currentBsDate = adToBs(today);
    const currentBsYear = currentBsDate.y;

    const nextAdNY = new Date(currentAdYear + 1, 0, 1);
    const daysToAdNY = differenceInDays(nextAdNY, today);
    const isAdNY = today.getMonth() === 0 && today.getDate() === 1;

    const nextBsNYAdDate = bsToAd({ y: currentBsYear + 1, m: 1, d: 1});
    const daysToBsNY = differenceInDays(startOfDay(nextBsNYAdDate), today);
    const isBsNY = currentBsDate.m === 1 && currentBsDate.d === 1;

    if (isAdNY) return { event: "Happy New Year!", isNewYear: true, daysLeft: 0, year: currentAdYear };
    if (isBsNY) return { event: `Happy New Year ${currentBsYear+1} B.S.!`, isNewYear: true, daysLeft: 0, year: currentBsYear + 1 };
    
    if (daysToAdNY >= 0 && daysToAdNY <= 10) return { event: "New Year Countdown", isNewYear: false, daysLeft: daysToAdNY, year: currentAdYear + 1 };
    if (daysToBsNY >= 0 && daysToBsNY <= 10) return { event: "Nepali New Year Countdown", isNewYear: false, daysLeft: daysToBsNY, year: currentBsYear + 1 };

    return null;
  }, []);

  useLayoutEffect(() => {
    let cancelled = false;
    const sync = () => {
      const el = footerRibbonRef.current;
      if (!el || cancelled) return;
      setFooterRibbonHeightPx(Math.ceil(el.getBoundingClientRect().height));
    };
    sync();
    requestAnimationFrame(sync);
    const el = footerRibbonRef.current;
    if (!el) return () => { cancelled = true; };
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [visibleCard, recentTransactionsCompact, newYearInfo?.isNewYear, isMobile, greeting]);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good Morning');
    else if (hour < 18) setGreeting('Good Afternoon');
    else setGreeting('Good Evening');
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        setShowFab(false);
      } else {
        setShowFab(true);
      }
      lastScrollY.current = currentScrollY;

      if (hideFabTimeout.current) clearTimeout(hideFabTimeout.current);
      hideFabTimeout.current = setTimeout(() => setShowFab(false), 3000); 
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (hideFabTimeout.current) clearTimeout(hideFabTimeout.current);
    };
  }, []);

  const journalAccountNames = voucherJournalAccountNames;

  const userNamesRef = useRef(userNames);
  userNamesRef.current = userNames;
  const fetchUserName = React.useCallback(async (userId: string): Promise<string> => {
    if (!userId) return "N/A";
    const cached = userNamesRef.current[userId];
    if (cached && cached !== "Unknown") return cached;
    const pbName = pbSessionUserName(userId, "N/A");
    if (pbName !== undefined) return pbName;
    try {
      // User doc ID may be name_uid format, so query by uid field first
      const q = query(collection(firestore, "users"), where("uid", "==", userId));
      const snap = await getDocs(q);
      let data = snap.docs[0]?.data();

      if (!data) {
        // Fallback: doc ID might be uid (legacy)
        const userDoc = await getDoc(doc(firestore, "users", userId));
        if (userDoc.exists()) {
          data = userDoc.data();
        }
      }

      if (data) {
        // Get displayName from user document - this is the primary field
        const displayName = data.displayName || data.name || data.email || null;
        if (displayName && displayName !== userId && !displayName.match(/^[a-zA-Z0-9_-]{20,}$/)) {
          setUserNames((prev) =>
            prev[userId] === displayName ? prev : { ...prev, [userId]: displayName }
          );
          return displayName;
        }
      }
    } catch (e) {
      logUserNameLookupError("Dashboard", userId, e);
    }
    return "N/A"; // Return N/A instead of Unknown
  }, []);
  
  React.useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    // FREEZE: pehli SQLite paint ke baad background merge par loading mat chalao (AGENTS.md).
    if (!initialVoucherBootSettled) {
      setLoading(vouchersLoading);
    } else if (!vouchersLoading) {
      setLoading(false);
    }
  }, [companyId, vouchersLoading, initialVoucherBootSettled]);

  React.useEffect(() => {
    if (!vouchersLoading) {
      setInitialVoucherBootSettled(true);
    }
  }, [vouchersLoading]);

  React.useEffect(() => {
    if (vouchers.length === 0) return;
    const uidsToFetch = new Set(
      vouchers.map((v) => v.userId).filter(Boolean) as string[]
    );
    uidsToFetch.forEach((uid) => {
      if (!userNamesRef.current[uid]) {
        void fetchUserName(uid);
      }
    });
  }, [vouchers, fetchUserName]);

  // ---------- FINANCIAL SUMMARY CALCULATION (Grouped) — shared + optional server aggregate ----------
  const needPageClientRp =
    !pagePreferServerRp ||
    pageServerRpClientFb ||
    (!pageServerRpSummary && !pageServerRpLoading);

  const pageClientFinancialSummary = React.useMemo(() => {
    if (!dashboardSummaryStockActive) {
      return computeReceivablesPayablesFinancialSummary({
        vouchers: [],
        processedParties,
        processedStaff,
        processedTaxes,
        processedAccounts,
        processedExpenseAccounts: expenseAccounts,
        receivablesDateRange,
        loading: false,
      });
    }
    if (!needPageClientRp) {
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
    dashboardSummaryStockActive,
    needPageClientRp,
    loading,
    vouchers,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
    receivablesDateRange,
  ]);

  const financialSummary = React.useMemo(() => {
    let raw;
    if (pagePreferServerRp && !pageServerRpClientFb && pageServerRpSummary) {
      raw = pageServerRpSummary;
    } else if (pagePreferServerRp && !pageServerRpClientFb && pageServerRpLoading) {
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
      raw = pageClientFinancialSummary;
    }
    return normalizeReceivablesPayablesSummary(raw);
  }, [
    pagePreferServerRp,
    pageServerRpClientFb,
    pageServerRpSummary,
    pageServerRpLoading,
    pageClientFinancialSummary,
    vouchers,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
    receivablesDateRange,
  ]);

  const netBalance = financialSummary.totalReceivable + financialSummary.totalPayable;

  // --- CASH FLOW CALCULATION ---
  const cashFlowDetails = React.useMemo(() => {
    if (!dashboardSummaryStockActive) {
      return {
        categorizedInflow: {},
        categorizedOutflow: {},
        totalInflow: 0,
        totalOutflow: 0,
      };
    }
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

    const getEntityType = (v: Voucher): string => {
        if(v.partyId) return 'Party';
        if(v.staffId) return STAFF_ENTITY_LABEL;
        if(v.taxAccountId) return 'Tax';
        if(v.incomeAccountId || v.expenseAccountId) return 'Income/Expense';
        return 'Other';
    }

    const getEntityInfo = (v: Voucher): {id: string, name: string} => {
        if(v.partyId) return {id: v.partyId, name: processedParties.find(p=>p.id === v.partyId)?.name || 'Unknown Party'};
        if(v.staffId) return {id: v.staffId, name: processedStaff.find(s=>s.id === v.staffId)?.name || 'Unknown Staff'};
        if(v.taxAccountId) return {id: v.taxAccountId, name: processedTaxes.find(t=>t.id === v.taxAccountId)?.name || 'Unknown Tax'};
        if(v.incomeAccountId) return {id: v.incomeAccountId, name: expenseAccounts.find(e=>e.id === v.incomeAccountId)?.name || 'Unknown Income'};
        if(v.expenseAccountId) return {id: v.expenseAccountId, name: expenseAccounts.find(e=>e.id === v.expenseAccountId)?.name || 'Unknown Expense'};
        return {id: (v as any).payeeName || 'other', name: (v as any).payeeName || 'Other'};
    }

    const aggregate = (map: Map<string, FlowItem>, v: Voucher, type: string, amount: number) => {
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
  }, [
    dashboardSummaryStockActive,
    vouchers,
    cashFlowDateRange,
    processedParties,
    processedStaff,
    processedTaxes,
    expenseAccounts,
  ]);

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

  // 3. STOCK SUMMARY DETAILS
  const overallStockSummary = useMemo(() => {
    if (!dashboardSummaryStockActive) {
      return { items: [], totalStockValue: 0, topSaleItems: [], topPurchaseItems: [] };
    }
    let filteredVouchers = vouchers;
    if (stockDateRange?.from) {
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
    const itemsWithSales = processedItems.map(item => {
        const conversions = (item.unitConversions || []) as any[];
        const smallestUnit = conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || '');
        
        const getFactorToSmallest = (unit: string): number => {
            if (!unit || conversions.length === 0 || unit === smallestUnit) return 1;
            
            let factor = 1;
            let current = unit;
            for (let i = 0; i < 10; i++) { // safety break
                const conv = conversions.find(c => c.fromUnit === current);
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

        let salesQty = 0;
        let salesValue = 0;
        let purchaseQty = 0;
        let purchaseValue = 0;

        filteredVouchers.forEach(v => {
            if (v.lineItems?.some((li: any) => li.itemId === item.id)) {
                const lineItem = v.lineItems.find((li: any) => li.itemId === item.id);
                if (lineItem) {
                    const qty = Number(lineItem.quantity) || 0;
                    const lineValue = (qty * Number(lineItem.rate)) || 0;
                    const standardizedQty = qty * getFactorToSmallest(lineItem.unit);

                    if (v.type === 'sale') {
                        salesQty += standardizedQty;
                        salesValue += lineValue;
                    } else if (v.type === 'purchase') {
                        purchaseQty += standardizedQty;
                        purchaseValue += lineValue;
                    }
                }
            }
        });

        return {
            ...item,
            qty: item.stockQty || 0,
            unit: smallestUnit,
            rate: item.purchasePrice || 0,
            value: value,
            salesQty,
            salesValue,
            purchaseQty,
            purchaseValue,
            smallestUnit,
        };
        });

    // Filter items to only show those with transactions in the selected date range
    // If date range is selected, only show items that have sales or purchases in that period
    let filteredItems = itemsWithSales;
    if (stockDateRange?.from) {
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
}, [processedItems, vouchers, stockDateRange, dashboardSummaryStockActive]);

  const stats = React.useMemo(() => {
    if (!dashboardSummaryStockActive || !vouchers) {
      return { otherStats: statCardData.map((s) => ({ ...s, total: 0, count: 0 })) };
    }

    const otherStats = statCardData.map((card) => {
      const filteredVouchers = vouchers.filter((v) => {
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
  }, [vouchers, dashboardSummaryStockActive]);
  
  // Unapproved quick filter: force all-time + all types + clear table column filters.
  // When no date range is explicitly picked, do not restrict Recent Transactions to current month;
  // let it show the most recent transactions across months to fulfill the selected page size (10, 20, 50).
  const effectiveRecentDateRange = recentUnapprovedOnly
    ? undefined
    : (recentDateRange?.from ? recentDateRange : undefined);
  const effectiveRecentFilters = recentUnapprovedOnly ? {} : recentFilters;
  const vouchersForRecentPipeline = useMemo(() => {
    if (!dashboardRecentPipelineActive || !vouchers) return EMPTY_TRANSACTIONS_LIST;
    if (recentDateRange?.from || recentUnapprovedOnly || recentQuickSearchInput.trim()) {
      return vouchers;
    }
    const pageSize = Math.max(10, recentRowsPerPage || 10);
    const needed = Math.max(1, recentCurrentPage || 1) * pageSize + 15;
    if (vouchers.length <= needed) return vouchers;
    const sorted = [...vouchers].sort((a, b) => {
      const msA = a?.date ? (typeof a.date === 'object' && 'toDate' in a.date ? (a.date as any).toDate().getTime() : new Date(a.date).getTime()) : 0;
      const msB = b?.date ? (typeof b.date === 'object' && 'toDate' in b.date ? (b.date as any).toDate().getTime() : new Date(b.date).getTime()) : 0;
      return msB - msA;
    });
    return sorted.slice(0, needed);
  }, [
    dashboardRecentPipelineActive,
    vouchers,
    recentDateRange?.from,
    recentUnapprovedOnly,
    recentQuickSearchInput,
    recentRowsPerPage,
    recentCurrentPage,
  ]);
  const { daybookTransactions: allRecentTransactions } = useTransactions(
    DAYBOOK_TRANSACTIONS_ENTITY,
    'daybook',
    effectiveRecentDateRange,
    undefined,
    processedAccounts,
    vouchersForRecentPipeline,
    undefined,
    effectiveRecentFilters,
    undefined,
    journalAccountNames,
    userNames,
    undefined,
    undefined,
    true,
    dashboardRecentPipelineActive
  );

  const recentWideningRef = useRef(false);
  const recentWidenFinishedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    recentWidenFinishedKeyRef.current = null;
  }, [companyId, recentRowsPerPage]);

  useEffect(() => {
    if (!dashboardRecentPipelineActive) return;
    if (recentDateRange?.from) return;
    if (companyUsesFiscalMergeDividers(company)) return;
    if (!fy.enabled || !fy.activeScope) return;
    const targetCount = Math.max(10, recentRowsPerPage || 10);
    if ((allRecentTransactions?.length ?? 0) >= targetCount) return;
    if (recentWideningRef.current) return;

    const widenKey = `${companyId}:${targetCount}`;
    if (recentWidenFinishedKeyRef.current === widenKey) return;

    recentWideningRef.current = true;
    void widenFyScopeUntilRecentMinTxns({
      company,
      fy,
      targetTxnCount: targetCount,
    })
      .catch((err) => {
        console.warn("[DashboardRecent] widen scope failed", err);
      })
      .finally(() => {
        recentWideningRef.current = false;
        recentWidenFinishedKeyRef.current = widenKey;
      });
  }, [
    dashboardRecentPipelineActive,
    recentDateRange?.from,
    allRecentTransactions?.length,
    recentRowsPerPage,
    company,
    companyId,
    fy,
  ]);

  const recentSortedBase = useMemo(() => {
    if (!dashboardRecentPipelineActive || !allRecentTransactions) return [];
    let sorted = sortRecentTransactionsDesc(allRecentTransactions as Record<string, unknown>[]);
    if (recentUnapprovedOnly) {
      sorted = sorted.filter((tx) => (tx as any).isApproved !== true);
    }
    if (!includeNotesInTable) {
      sorted = sorted.filter((tx) => (tx as any).type !== 'note');
    }
    return sorted;
  }, [allRecentTransactions, recentUnapprovedOnly, includeNotesInTable, dashboardRecentPipelineActive]);

  /** Mobile Recent footer count box: same predicate as Unapproved filter above (isApproved !== true, notes per toggle). Display only. */
  const recentUnapprovedCount = useMemo(() => {
    if (!dashboardRecentPipelineActive || !allRecentTransactions) return 0;
    let n = 0;
    for (const tx of allRecentTransactions as any[]) {
      if (tx?.isApproved === true) continue;
      if (!includeNotesInTable && tx?.type === 'note') continue;
      n += 1;
    }
    return n;
  }, [allRecentTransactions, includeNotesInTable, dashboardRecentPipelineActive]);

  const recentPoolBeforeLimit = useMemo(() => {
    const q = recentQuickSearchInput.trim().toLowerCase();
    if (!q) {
      recentSearchLastFilterMsRef.current = 0;
      return recentSortedBase;
    }
    if (!dashboardRecentPipelineActive || recentSortedBase.length === 0) {
      recentSearchLastFilterMsRef.current = 0;
      return [] as typeof recentSortedBase;
    }
    const t0 = performance.now();
    const filtered = recentSortedBase.filter((tx) => {
      const row = buildRecentTransactionSearchHaystackRow(
        tx as Record<string, unknown>,
        journalAccountNames,
        userNames,
      );
      return recentSearchHaystackRowMatchesQuery(row, q);
    });
    recentSearchLastFilterMsRef.current = performance.now() - t0;
    return filtered;
  }, [
    recentSortedBase,
    recentQuickSearchInput,
    journalAccountNames,
    userNames,
    dashboardRecentPipelineActive,
  ]);

  useEffect(() => {
    const q = recentQuickSearchInput.trim();
    if (!q) return;
    const elapsed = recentSearchLastFilterMsRef.current;
    if (elapsed < RECENT_SEARCH_SLOW_MS) return;
    const now = Date.now();
    if (now - recentSearchSlowBrakeAtRef.current < 30_000) return;
    recentSearchSlowBrakeAtRef.current = now;
    engageClientHealthEmergencyBrake(
      `Recent search filter took ${(elapsed / 1000).toFixed(1)}s (threshold 5s). Copy log if needed, then Resume.`,
      { detectedStallMs: elapsed }
    );
  }, [recentPoolBeforeLimit, recentQuickSearchInput]);

  const recentListTotal = recentPoolBeforeLimit.length;
  const recentEffectiveRowsPerPage = Math.max(10, recentRowsPerPage || 50);
  const recentTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(recentListTotal / recentEffectiveRowsPerPage));
  }, [recentListTotal, recentEffectiveRowsPerPage]);
  const recentSafePage = Math.min(Math.max(1, recentCurrentPage), recentTotalPages);
  const recentPaginationSlice = useMemo(() => {
    const total = recentListTotal;
    const pageSize = recentEffectiveRowsPerPage;
    if (total === 0) {
      return { rows: recentPoolBeforeLimit, beforeCount: 0, afterCount: 0 };
    }
    const start = (recentSafePage - 1) * pageSize;
    const end = Math.min(total, start + pageSize);
    const pageRows = recentPoolBeforeLimit.slice(start, end) as Record<string, unknown>[];
    return {
      rows: sortRecentDashboardPageRows(pageRows, recentSortBy, recentSortOrder),
      beforeCount: total - end,
      afterCount: start,
    };
  }, [
    recentPoolBeforeLimit,
    recentEffectiveRowsPerPage,
    recentSafePage,
    recentListTotal,
    recentSortBy,
    recentSortOrder,
  ]);
  const recentTransactions = recentPaginationSlice.rows;
  const recentPagerEdgeCounts = useMemo(
    () => ({
      before: recentPaginationSlice.beforeCount,
      after: recentPaginationSlice.afterCount,
    }),
    [recentPaginationSlice.afterCount, recentPaginationSlice.beforeCount]
  );

  React.useEffect(() => {
    if (recentRowsPerPage <= 0) setRecentRowsPerPage(10);
  }, [recentRowsPerPage, setRecentRowsPerPage]);

  React.useEffect(() => {
    setRecentCurrentPage(1);
  }, [recentQuickSearchInput, recentDateRange, recentFilters, recentUnapprovedOnly, includeNotesInTable]);
  React.useEffect(() => {
    setRecentCurrentPage((p) => Math.min(Math.max(1, p), recentTotalPages));
  }, [recentTotalPages]);

  /**
   * Idle blink tracker (no behavior change): PL-gate company pe Recent Transactions
   * list kab / kitni baar swap hoti hai — filter console: `[DashRecentIdle]`
   */
  const dashRecentIdlePrevRef = useRef<{
    fp: string;
    vouchersFp: string;
    count: number;
    vouchersCount: number;
    recentIds: string[];
    atMs: number;
  } | null>(null);
  useEffect(() => {
    if (!companyId) return;
    const gate = getActiveGate();
    const isPlRow =
      isServerGateCompany(company) ||
      (company as { plServerShared?: boolean } | null)?.plServerShared === true ||
      gate.type === "local_server";
    if (!isPlRow) return;

    const recentFp = voucherIdFingerprint(recentTransactions as unknown[]);
    const vouchersFp = voucherIdFingerprint(vouchers as unknown[]);
    const now = Date.now();
    const prev = dashRecentIdlePrevRef.current;
    const recentChanged = !prev || prev.fp !== recentFp || prev.count !== recentTransactions.length;
    const vouchersChanged = !prev || prev.vouchersFp !== vouchersFp || prev.vouchersCount !== vouchers.length;
    if (!recentChanged && !vouchersChanged) return;

    const currIds = (recentTransactions as Array<{ id?: string }>)
      .map((t) => String(t?.id || "").trim())
      .filter(Boolean);
    const prevIdSet = new Set(prev?.recentIds ?? []);
    const currIdSet = new Set(currIds);
    const addedIds = currIds.filter((id) => !prevIdSet.has(id)).slice(0, 12);
    const removedIds = (prev?.recentIds ?? []).filter((id) => !currIdSet.has(id)).slice(0, 12);

    console.log(
      `[DashRecentIdle] ${
        (company as { plServerShared?: boolean } | null)?.plServerShared === true
          ? "pl_server"
          : String(company?.storageOption || "").toLowerCase() === "firebase" ||
              (company as { syncedFromCloud?: boolean } | null)?.syncedFromCloud === true
            ? "online_firebase"
            : "local_or_other"
      } vouchers=${vouchers.length}←${prev?.vouchersCount ?? "?"} recent=${recentTransactions.length}←${prev?.count ?? "?"} ms=${prev ? now - prev.atMs : "-"}`,
      {
      at: new Date(now).toISOString(),
      companyId,
      companyName: company?.name || null,
      gateType: gate.type,
      gateId: gate.id,
      plServerShared: (company as { plServerShared?: boolean } | null)?.plServerShared === true,
      storageOption: company?.storageOption ?? null,
      syncedFromCloud: (company as { syncedFromCloud?: boolean } | null)?.syncedFromCloud === true,
      enableCrossCompanyLedgerCopy:
        (company as { enableCrossCompanyLedgerCopy?: boolean } | null)?.enableCrossCompanyLedgerCopy === true,
      enableShareForReconciliation:
        (company as { enableShareForReconciliation?: boolean } | null)?.enableShareForReconciliation === true,
      companyKindHint:
        (company as { plServerShared?: boolean } | null)?.plServerShared === true
          ? "pl_server"
          : String(company?.storageOption || "").toLowerCase() === "firebase" ||
              (company as { syncedFromCloud?: boolean } | null)?.syncedFromCloud === true
            ? "online_firebase"
            : "local_or_other",
      documentHidden: typeof document !== "undefined" ? document.hidden : null,
      idleMsSincePrevChange: prev ? now - prev.atMs : null,
      recentCount: recentTransactions.length,
      recentCountPrev: prev?.count ?? null,
      recentFp,
      recentFpPrev: prev?.fp ?? null,
      vouchersCount: vouchers.length,
      vouchersCountPrev: prev?.vouchersCount ?? null,
      vouchersFp,
      vouchersFpPrev: prev?.vouchersFp ?? null,
      recentChanged,
      vouchersChanged,
      addedIds,
      removedIds,
      sampleRecentIds: currIds.slice(0, 8),
    });

    dashRecentIdlePrevRef.current = {
      fp: recentFp,
      vouchersFp,
      count: recentTransactions.length,
      vouchersCount: vouchers.length,
      recentIds: currIds,
      atMs: now,
    };
  }, [company, companyId, recentTransactions, vouchers]);
  
  const handlePrint = () => {
    const filterLabel =
      RP_DIALOG_FILTER_OPTIONS.find((o) => o.id === receivablePayableFilter)?.label ??
      receivablePayableFilter;
    const printTotalReceivable = sumRpDialogSide("receivables", financialSummary, receivablePayableFilter);
    const printTotalPayable = sumRpDialogSide("payables", financialSummary, receivablePayableFilter);
    const buildTableBody = (side: "receivables" | "payables") => {
      const sections = buildRpDialogSections(side, financialSummary, receivablePayableFilter);
      const body: any[] = [["Account", { text: "Amount", alignment: "right" }]];
      for (const section of sections) {
        if (section.rows.length === 0) continue;
        body.push([
          { text: `${section.label} (${section.rows.length})`, bold: true, color: "#64748b" },
          "",
        ]);
        for (const item of section.rows) {
          body.push([
            item.party,
            {
              text: formatCurrencyForPrint(Math.abs(item.balance), { noSuffix: true, noAnimation: true }),
              alignment: "right",
            },
          ]);
        }
      }
      return body;
    };
    const receivablesBody = buildTableBody("receivables");
    const payablesBody = buildTableBody("payables");
    receivablesBody.push([
      { text: "Total Receivable", bold: true, alignment: "right" },
      {
        text: formatCurrencyForPrint(printTotalReceivable, { noSuffix: true, noAnimation: true }),
        bold: true,
        alignment: "right",
        color: "#059669",
      },
    ]);
    payablesBody.push([
      { text: "Total Payable", bold: true, alignment: "right" },
      {
        text: formatCurrencyForPrint(printTotalPayable, { noSuffix: true, noAnimation: true }),
        bold: true,
        alignment: "right",
        color: "#DC2626",
      },
    ]);
    const printRecCount = countRpDialogSide("receivables", financialSummary, receivablePayableFilter);
    const printPayCount = countRpDialogSide("payables", financialSummary, receivablePayableFilter);

    const asOfDate = dateSystem === "BS" ? formatDateBS(new Date()) : formatDate(new Date());

    openPrintDirect({
        company: { name: company?.name || '', pan: company?.pan, phone: company?.phone, address: company?.address, decimalPlaces: company?.decimalPlaces, showDrCr: company?.showDrCr, showCurrencySymbol: company?.showCurrencySymbol, logoUrl: company?.logoUrl },
        dateSystem: dateSystem,
        title: `Receivables & Payables (${filterLabel})`,
        context: "daybook",
        dateRangeText: `As of ${asOfDate}`,
        vouchersCount: printRecCount + printPayCount,
        openingBalance: 0,
        transactions: [],
        showNarration: false,
        customContent: [
          {
            columns: [
              {
                width: '*',
                stack: [
                  { text: 'Receivables', style: 'subheader', color: '#059669' },
                  {
                    table: {
                      headerRows: 1,
                      widths: ['*', 'auto'],
                      body: receivablesBody
                    },
                    layout: 'lightHorizontalLines',
                    margin: [0, 5, 0, 15]
                  },
                ]
              },
              {
                width: '*',
                stack: [
                  { text: 'Payables', style: 'subheader', color: '#DC2626' },
                  {
                    table: {
                      headerRows: 1,
                      widths: ['*', 'auto'],
                      body: payablesBody
                    },
                      layout: 'lightHorizontalLines'
                  }
                ]
              }
            ],
            columnGap: 20
          }
        ]
    }, true);
  }

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
          // Normalize categories for comparison: remove spaces, lowercase
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
            // Normalize categories for comparison
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
        company: { name: company?.name || '', address: company?.address, phone: company?.phone, pan: company?.pan, logoUrl: company?.logoUrl },
        dateSystem, 
        title: `Cash Flow (${cashFlowFilter.toUpperCase()} - ${cashFlowCategoryFilter.toUpperCase().replace('_', ' / ')})`, 
        dateRangeText,
        context: 'daybook', vouchersCount: 0, openingBalance: 0, transactions: [],
        customContent: [{ columns: [
            showIn ? { width: '*', stack: [{ text: 'Inflow', style: 'subheader', color: '#059669' }, { table: { widths: ['*', 'auto'], body: inBody }, layout: 'lightHorizontalLines' }] } : {width: 0, text: ''}, 
            showOut ? { width: '*', stack: [{ text: 'Outflow', style: 'subheader', color: '#DC2626' }, { table: { widths: ['*', 'auto'], body: outBody }, layout: 'lightHorizontalLines' }] } : {width: 0, text: ''}
        ], columnGap: 20 }]
    }, true);
  }

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

      const body: any[] = [['Tax Account', 
          ...(showInput ? [{ text: 'Input (Paid)', alignment: 'right' }] : []), 
          ...(showOutput ? [{ text: 'Output (Collected)', alignment: 'right' }] : []), 
          { text: 'Net', alignment: 'right' }]];
          
      taxSummary.details.forEach(t => {
          body.push([t.name, 
            ...(showInput ? [{ text: formatCurrencyForPrint(t.input, {noSuffix: true, noAnimation: true}), alignment: 'right', color: '#059669' }] : []), 
            ...(showOutput ? [{ text: formatCurrencyForPrint(t.output, {noSuffix: true, noAnimation: true}), alignment: 'right', color: '#DC2626' }] : []),
            { text: formatCurrencyForPrint(Math.abs(t.balance), {noSuffix: true, noAnimation: true}) + (t.balance >= 0 ? ' Dr' : ' Cr'), alignment: 'right', bold: true }
          ]);
      });
      openPrintDirect({
        company: { name: company?.name || '', address: company?.address, phone: company?.phone, pan: company?.pan, logoUrl: company?.logoUrl },
        dateSystem, 
        title: `Tax Summary (${taxFilter.toUpperCase()})`, 
        dateRangeText: dateRangeText,
        context: 'daybook', vouchersCount: 0, openingBalance: 0, transactions: [],
        customContent: [{ table: { widths: ['*', ...(showInput ? ['auto'] : []), ...(showOutput ? ['auto'] : []), 'auto'], body }, layout: 'lightHorizontalLines' }]
    }, true);
  }

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
  }

  const isRecentFilterActive = useMemo(
    () =>
      recentDateRange !== undefined ||
      Object.values(recentFilters).some(v => v) ||
      recentUnapprovedOnly ||
      recentQuickSearchInput.trim() !== "",
    [recentDateRange, recentFilters, recentUnapprovedOnly, recentQuickSearchInput]
  );
  const clearRecentFilters = () => {
    setRecentDateRange(undefined);
    setRecentFilters({});
    setRecentUnapprovedOnly(false);
    setRecentQuickSearchInput("");
  };
  const applyRecentUnapprovedFilter = () => {
    // User request: button click = all-time unapproved vouchers only.
    setRecentUnapprovedOnly(true);
    setRecentDateRange(undefined);
    setRecentFilters({});
    setRecentQuickSearchInput("");
    setActiveRecentFilter(null);
  };
  
  const taxBreakdownData = useMemo(() => {
    if (!selectedTaxId) return { inputs: [], outputs: [] };
    const tax = processedTaxes.find(t => t.id === selectedTaxId);
    if (!tax) return { inputs: [], outputs: [] };

    const inputs: any[] = [];
    const outputs: any[] = [];

    vouchers.forEach(v => {
      let taxAmount = 0;
      let partyName = "";
      
      // Direct Tax Payment
      if (v.taxAccountId === selectedTaxId) {
          if (v.type === 'payment_out') { // Tax Paid
              inputs.push({ voucherType: v.type, voucherNumber: v.voucherNumber, account: "Bank/Cash", taxAmount: v.amount, date: v.date });
          } else if (v.type === 'payment_in') { // Tax Refund
              outputs.push({ voucherType: v.type, voucherNumber: v.voucherNumber, account: "Bank/Cash", taxAmount: v.amount, date: v.date });
          }
      }

      // Tax from Line Items
      if (v.lineItems) {
        v.lineItems.forEach((line: any) => {
          if (line.taxAccountId === selectedTaxId && line.taxAmount) {
            taxAmount = line.taxAmount;
            const party = processedParties.find(p => p.id === v.partyId);
            partyName = party?.name || "N/A";
            
            if (v.type === 'purchase') {
              inputs.push({ voucherType: v.type, voucherNumber: v.voucherNumber, account: partyName, taxAmount, date: v.date });
            } else if (v.type === 'sale') {
              outputs.push({ voucherType: v.type, voucherNumber: v.voucherNumber, account: partyName, taxAmount, date: v.date });
            }
          }
        });
      }
      
      // Tax from Journal Entries (for TDS etc.)
      if (v.type === 'journal' && v.entries) {
        const taxEntry = v.entries.find((e: any) => e.accountId === selectedTaxId);

        if (taxEntry) {
          // Find the other side of the entry to use as the 'Account' name
          const otherEntry = v.entries.find((e: any) => e.accountId !== selectedTaxId);
          const accountName = journalAccountNames[otherEntry?.accountId] || 'Journal Entry';

          if (taxEntry.debit > 0) { // Tax Paid (Input)
            inputs.push({
              voucherType: v.type,
              voucherNumber: v.voucherNumber,
              account: accountName,
              taxAmount: taxEntry.debit,
              date: v.date
            });
          } else if (taxEntry.credit > 0) { // Tax Liability Created (Output)
            outputs.push({
              voucherType: v.type,
              voucherNumber: v.voucherNumber,
              account: accountName,
              taxAmount: taxEntry.credit,
              date: v.date
            });
          }
        }
      }
    });

    return { inputs, outputs };
  }, [selectedTaxId, vouchers, processedTaxes, processedParties, journalAccountNames]);

  const displayTransactionDate = (date: any) => {
    const d = safeToDate(date);
    if (!d) return "Invalid Date";
    return dateSystem === 'AD' ? formatDate(d) : formatDateBS(d);
  };

  /** Mobile: poori range date-trigger button mein mat dikhao — title ke neeche ek line; strip/control row ki height stable. */
  const recentTransactionsMobileRangeLine = useMemo(() => {
    if (!recentDateRange?.from) return null;
    const from = recentDateRange.from;
    const to = recentDateRange.to;
    const adPart = to ? `${formatDate(from)} – ${formatDate(to)}` : formatDate(from);
    const bsPart = to ? `${formatDateBS(from)} – ${formatDateBS(to)}` : formatDateBS(from);
    if (dateSystem === 'AD') return adPart;
    if (dateSystem === 'BS') return bsPart;
    return `${adPart} · ${bsPart}`;
  }, [recentDateRange, dateSystem, formatDate, formatDateBS]);

  const recurringSummarySlot = React.useMemo(
    () =>
      visibleCard === "financial-summaries" ? (
        <RecurringAutoSummaryCard
          layout="gridCell"
          placement="summary"
          onOpenBodyVoucher={openRecurringBodyVoucher}
        />
      ) : null,
    [visibleCard, openRecurringBodyVoucher],
  );

  const renderFinancialSummaries = (
    reportsEnabled: boolean,
    showVoucherDateCharts = false,
    paneComputationActive = true,
  ) => {
    const summaryVouchers = summaryTabVisible && paneComputationActive ? vouchers : [];
    return (
      <FinancialSummaryCards
        vouchers={summaryVouchers}
        processedParties={processedParties}
        processedStaff={processedStaff}
        processedTaxes={processedTaxes}
        processedAccounts={processedAccounts}
        processedItems={processedItems}
        expenseAccounts={expenseAccounts}
        loading={loading}
        showDetails={reportsEnabled}
        compact={false}
        showVoucherDateCharts={showVoucherDateCharts}
        voucherDateChartKind={summaryChartKind}
        recurringSummarySlot={
          !showVoucherDateCharts && visibleCard === "financial-summaries"
            ? recurringSummarySlot
            : undefined
        }
      />
    );
  };
  
  const recentDesktopLedgerFooter = useMemo(
    () => (
      <LedgerDesktopFooter
        shellClassName="mt-0 rounded-none border-0 border-t border-blue-300 bg-blue-100 py-1.5 px-2 shadow-none overflow-x-hidden overflow-y-hidden dark:border-blue-800 dark:bg-blue-950"
        left={
          <>
            <LedgerFooterCheckboxPill
              id="show-narration-recent"
              checked={showRecentNarration}
              onCheckedChange={(checked) => setShowRecentNarration(Boolean(checked))}
              label="Show Narration"
            />
            <LedgerFooterColumnsMenu>
              <DropdownMenuContent align="start" className="w-52 p-2">
                {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[]).filter(ledgerColumnMenuNoTdsFilter)
                  .filter((key) => key !== 'runningBalance' && key !== 'status')
                  .map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={(e) => e.preventDefault()}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        id={`col-${key}-recent`}
                        checked={visibleColumns[key] !== false}
                        onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                      />
                      <label
                        htmlFor={`col-${key}-recent`}
                        className="text-sm font-medium flex-1 cursor-pointer"
                      >
                        {COLUMN_LABELS[key]}
                      </label>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </LedgerFooterColumnsMenu>
            <LedgerFooterCheckboxPill
              id="show-notes-recent"
              checked={includeNotesInTable}
              disabled={notesPreferenceLockedOnMobile}
              onCheckedChange={(c) => setShowNotes(Boolean(c))}
              label="Note"
            />
          </>
        }
        sortBy={recentSortBy}
        sortOrder={recentSortOrder}
        onSortChange={(by, order) => {
          setRecentSortBy(by);
          setRecentSortOrder(order);
        }}
        viewMode="statement"
        currentPage={recentSafePage}
        totalPages={recentTotalPages}
        setCurrentPage={setRecentCurrentPage}
        rowsPerPageSelectValue={recentRowsPerPageSelectValue}
        onRowsPerPageChange={(value) => {
          const n = Math.max(10, Number(value) || 50);
          setRecentRowsPerPage(n);
          setRecentCurrentPage(1);
        }}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS_DEFAULT}
        beforeCount={recentPaginationSlice.beforeCount}
        afterCount={recentPaginationSlice.afterCount}
        totalCount={recentListTotal}
        includeAllOption={false}
      />
    ),
    [
      showRecentNarration,
      visibleColumns,
      includeNotesInTable,
      notesPreferenceLockedOnMobile,
      recentSortBy,
      recentSortOrder,
      recentSafePage,
      recentTotalPages,
      recentRowsPerPageSelectValue,
      setRecentRowsPerPage,
      recentPaginationSlice.beforeCount,
      recentPaginationSlice.afterCount,
      recentListTotal,
      handleColumnVisibilityChange,
      setShowNotes,
    ]
  );

  const recentTabActive = visibleCard === "recent-transactions";
  const recentFooterRibbonAligned = recentTabActive && !recentTransactionsCompact;

  const renderRecentTransactions = () => (
    <Card
      data-pl-dashboard-recent-shell={recentFooterRibbonAligned ? "" : undefined}
      data-pl-dashboard-recent-line-sections={recentFooterRibbonAligned ? "" : undefined}
      className={cn(
        "box-border w-full max-w-none",
        recentFooterRibbonAligned ? "min-w-full" : "min-w-0",
        recentTabActive
          ? cn(
              recentFooterRibbonAligned
                ? "rounded-none border-0 bg-background shadow-none"
                : "rounded-b-none rounded-t-md border border-emerald-700/50 border-b-0 bg-card shadow-none dark:border-emerald-800/60",
              recentTransactionsCompact && "px-0"
            )
          : cn(proDashboardRibbonClass(2), recentTransactionsCompact && "px-0"),
        recentFooterRibbonAligned &&
          "flex h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden pb-0",
      )}
    >
      {/* Compact: CardHeader default `p-6` hata kar chhoti strip — sirf text jitni height */}
      <CardHeader
        data-pl-dashboard-recent-chrome={recentFooterRibbonAligned ? "" : undefined}
        className={cn(
          recentTransactionsCompact && "space-y-1 px-2 py-1.5 sm:px-4",
          !recentTransactionsCompact &&
            cn(
              "space-y-0 p-0 py-1",
              recentFooterRibbonAligned
                ? "border-b border-blue-300 bg-blue-100 px-2 sm:px-3 dark:border-blue-800 dark:bg-blue-950"
                : "border-b border-blue-300 bg-blue-100 dark:border-blue-800 dark:bg-blue-950 px-2 sm:px-4",
            ),
          // Recent tab + mobile: `main` scroll par title/date upar chipke rahein — `sticky` ka scrollport wahi `<main>` hai (layout).
          recentTransactionsCompact &&
            visibleCard === "recent-transactions" &&
            "sticky top-0 z-20 border-b border-blue-300 bg-blue-100 py-2 shadow-sm dark:border-blue-800 dark:bg-blue-950"
        )}
      >
        <div className={cn("flex flex-col", recentTransactionsCompact ? "gap-1" : "gap-0")}>
          {recentTransactionsCompact ? (
            <>
              <CardTitle
                className={cn(
                  "w-full text-left",
                  recentDateRange?.from ? "text-sm font-semibold leading-none" : "text-base font-semibold leading-none"
                )}
              >
                Recent Transactions
              </CardTitle>
              <p
                className="w-full max-w-full truncate px-0 text-left text-[11px] font-bold leading-tight text-foreground"
                title={recentTransactionsMobileRangeLine ?? "Date range"}
              >
                {recentTransactionsMobileRangeLine ?? "Date range"}
              </p>
            </>
          ) : null}
          {/* Compact mobile me controls niche fixed panel me jayenge; yahan desktop/non-compact controls hi rakho. */}
          {!recentTransactionsCompact && (
          <>
          <div
            data-pl-recent-txn-toolbar-scroll=""
            className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden pl-dashboard-recent-hide-hscroll [scrollbar-gutter:stable]"
          >
          <div
            data-pl-recent-txn-toolbar=""
            className="grid w-full min-w-full min-h-9 grid-cols-[minmax(0,auto)_minmax(2in,1fr)_auto] items-center gap-x-2 gap-y-1.5 md:gap-x-3"
          >
            <CardTitle className="max-w-[min(42vw,11rem)] shrink-0 truncate text-left text-base font-semibold leading-none sm:max-w-none sm:text-lg">
              Recent Transactions
            </CardTitle>
            <div className="flex min-w-0 justify-center px-1 sm:px-2">
              <div className="relative h-9 w-full min-w-[2in] max-w-[28rem]">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                enterKeyHint="search"
                listChrome
                listChromeSearch
                placeholder="Search"
                value={recentQuickSearchInput}
                onChange={(e) => setRecentQuickSearchInput(e.target.value)}
                className="h-9 min-h-9 max-h-9 w-full min-w-[2in] bg-white py-1 pl-8 pr-2 text-sm dark:bg-white"
                aria-label="Search recent vouchers"
              />
              </div>
            </div>
            <div className="flex h-9 shrink-0 items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant={recentUnapprovedOnly ? "default" : "outline"}
              className="h-9 whitespace-nowrap"
              onClick={() => {
                if (recentUnapprovedOnly) setRecentUnapprovedOnly(false);
                else applyRecentUnapprovedFilter();
              }}
            >
              Unapproved
            </Button>
            {(isRecentFilterActive || recentUnapprovedOnly) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={clearRecentFilters}
                aria-label="Clear Filters"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {(dateSystem === 'BS' || dateSystem === 'Both') && (
                <BsDatePicker
                  isRange
                  valueAD={recentDateRange}
                  onChangeAD={(range) => setRecentDateRange(range as DateRange | undefined)}
                  transactionDates={transactionDates}
                  className="h-9 max-w-[min(100%,9rem)] sm:max-w-none"
                  hideTriggerIcon={recentTransactionsCompact}
                  rangeEmptyLabel={recentTransactionsCompact ? "Change date" : undefined}
                  children={
                    recentTransactionsCompact ? (
                      <span className="min-w-0 truncate">Change date</span>
                    ) : undefined
                  }
                />
            )}
            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                <Popover open={isRecentCalendarOpen} onOpenChange={(open) => {
                  setIsRecentCalendarOpen(open);
                  if (open) setTempRecentDateRange(recentDateRange);
                  else setTempRecentDateRange(undefined);
                }}>
                    <PopoverTrigger asChild>
                    <Button
                      id="recent-date"
                      variant={"outline"}
                      className={cn(
                        "h-9 justify-start text-left font-normal",
                        recentTransactionsCompact ? "w-auto max-w-[min(100%,9rem)] min-w-0 shrink-0" : "w-auto",
                        !recentDateRange && "text-muted-foreground"
                      )}
                    >
                        {!recentTransactionsCompact && <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />}
                        {/* Mobile: trigger par lambi range mat — range title ke neeche */}
                        {recentTransactionsCompact ? (
                          <span className="min-w-0 truncate">Change date</span>
                        ) : recentDateRange?.from ? (
                          recentDateRange.to ? (
                            <>
                              {formatDate(recentDateRange.from)} - {formatDate(recentDateRange.to)}
                            </>
                          ) : (
                            formatDate(recentDateRange.from)
                          )
                        ) : (
                          <span>Date range</span>
                        )}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                    <AdCalendar
                      rangePresetSlot={
                        <DateRangePresetRow
                          country={company?.country}
                          onApply={(r) => {
                            setTempRecentDateRange(r);
                            setRecentDateRange(r);
                            setIsRecentCalendarOpen(false);
                          }}
                        />
                      }
                      valueAD={tempRecentDateRange ?? recentDateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = tempRecentDateRange ?? recentDateRange;
                        if (!range?.from || (range.from && range.to)) {
                          setTempRecentDateRange({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          const next = { from: adDate, to: range.from };
                          setTempRecentDateRange(next);
                          setRecentDateRange(next);
                          setIsRecentCalendarOpen(false);
                        } else {
                          const next = { from: range.from, to: adDate };
                          setTempRecentDateRange(next);
                          setRecentDateRange(next);
                          setIsRecentCalendarOpen(false);
                        }
                      }}
                    />
                    </PopoverContent>
                </Popover>
            )}
            </div>
          </div>
          </div>
          </>
          )}
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "px-0",
          recentTransactionsCompact
            ? "pb-2"
            : "flex min-h-0 flex-1 flex-col overflow-hidden pb-0",
        )}
        {...(recentTransactionsCompact ? { "data-pl-mobile-txn-host": "" } : {})}
      >
        {/* Mobile Recent: party-parity txn cards (all card themes); list inset handled in TransactionsTable */}
        <div
          className={cn(
            "w-full",
            recentTransactionsCompact
              ? "overflow-x-auto px-0"
              : "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pb-0",
          )}
          {...(!recentTransactionsCompact && recentFooterRibbonAligned
            ? { "data-pl-dashboard-recent-scroll": "" }
            : {})}
        >
        <TransactionsTable
          transactions={recentTransactions}
          context="daybook"
          daybookDesktopUnifiedScroll={!recentTransactionsCompact}
          mobileCardLayoutLikeParty
          onRowClick={(v) => {
            setSelectedVoucher(v);
            setIsVoucherDialogOpen(true);
          }}
          onInterCompanyChangeDetectedClick={handleInterCompanyChangeDetectedClick}
          onHistoryVoucher={(v) => setHistoryVoucher(v)}
          onAddLink={(v) => {
            const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(v?.type);
            if (isPaymentType) setLinkPaymentVoucher(v);
            else setLinkAdvancesVoucher(v);
          }}
          journalAccountNames={journalAccountNames}
          userNames={userNames}
          isDateChange={isDateChange}
          filters={recentFilters}
          setFilters={setRecentFilters}
          activeFilter={activeRecentFilter}
          setActiveFilter={setActiveRecentFilter}
          hideFooter={true}
          hideBalanceColumn={true}
          showNarration={showRecentNarration}
          visibleColumns={visibleColumns}
          transactionCardSearchHighlight={recentQuickSearchInput}
        />
        </div>
      </CardContent>
    </Card>
  );

  const renderDashboardContent = () => {
    const recentDesktopContained =
      !recentTransactionsCompact && visibleCard === "recent-transactions";
    const dashboardSingleTabFill =
      !recentTransactionsCompact && visibleCard !== "financial-summaries";
    return (
    <div
      className={cn(
        "space-y-[5px]",
        recentDesktopContained && "flex min-h-0 flex-1 flex-col overflow-hidden space-y-0",
        dashboardSingleTabFill && "flex min-h-0 flex-1 flex-col overflow-hidden",
      )}
    >
      {dashboardKeepAliveSummary && (
        <div
          aria-hidden={!summaryTabVisible}
          style={{ display: summaryTabVisible ? "block" : "none" }}
          className="min-w-0"
          data-pl-dashboard-home=""
        >
          <div className="lg:min-w-[1260px]" style={{ display: summaryChartsPane ? "none" : "block" }}>
            {renderFinancialSummaries(isReportsEnabled, false, !summaryChartsPane)}
          </div>
          {summaryChartsPane && !summaryChartPaneMounted ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading charts…</div>
          ) : null}
          {summaryChartPaneMounted ? (
            <div style={{ display: summaryChartsPane ? "block" : "none" }}>
              {renderFinancialSummaries(isReportsEnabled, true, summaryChartsPane)}
            </div>
          ) : null}
        </div>
      )}
      {visibleCard === "bank-cash-summary" && can("view_bank_cash_summary") && (
        <div className="px-0.5">
          <BankCashSummary />
        </div>
      )}
      {dashboardKeepAliveDaybook && can("view_daybook") && (
        <div
          aria-hidden={visibleCard !== "daybook"}
          style={{ display: visibleCard === "daybook" ? "flex" : "none" }}
          className={cn(
            !recentTransactionsCompact
              ? "min-h-0 flex-1 flex-col overflow-hidden"
              : "w-full min-w-0 max-w-full flex-col px-0.5",
          )}
        >
          <DaybookReport
            isPanelVisible={visibleCard === "daybook"}
            welcomeRibbonDateNav={!isMobile}
            dashboardEmbedded
            footerPortalTarget={daybookFooterSlot}
          />
        </div>
      )}
      {visibleCard === "recent-transactions" && can("view_recent_transactions") && (
        <div
          className={cn(
            recentFooterRibbonAligned && "flex h-full min-h-0 w-full flex-1 flex-col",
          )}
        >
          {renderRecentTransactions()}
        </div>
      )}
    </div>
  );
  }
  
  const dashboardCards = [
    { id: "financial-summaries", title: "Summary" },
    { id: "dashboard-charts", title: "Chart" },
    { id: "dashboard-line-charts", title: "Line" },
    { id: "bank-cash-summary", title: "Bank" },
    { id: "daybook", title: "Daybook" },
    { id: "recent-transactions", title: "Recent" },
  ];
  /** User request: footer buttons solid, high-contrast alag-alag colors me dikhe */
  const footerToneClassByCard: Record<string, string> = {
    "financial-summaries":
      "border-pink-500 bg-pink-300 text-pink-950 dark:border-pink-400 dark:bg-pink-700 dark:text-pink-50",
    "bank-cash-summary": "border-emerald-500 bg-emerald-300 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-700 dark:text-emerald-50",
    daybook: "border-sky-500 bg-sky-300 text-sky-950 dark:border-sky-400 dark:bg-sky-700 dark:text-sky-50",
    "recent-transactions": "border-violet-500 bg-violet-300 text-violet-950 dark:border-violet-400 dark:bg-violet-700 dark:text-violet-50",
    "dashboard-charts":
      "border-pink-500 bg-pink-300 text-pink-950 dark:border-pink-400 dark:bg-pink-700 dark:text-pink-50",
    "dashboard-line-charts":
      "border-pink-500 bg-pink-300 text-pink-950 dark:border-pink-400 dark:bg-pink-700 dark:text-pink-50",
  };

  const renderDashboardFooterTab = (
    card: { id: string; title: string },
    shellClassName?: string,
    summaryChartSegment?: "left" | "mid" | "right",
  ) => {
    const Icon =
      card.id === "financial-summaries"
        ? TrendingUp
        : card.id === "daybook"
          ? FileTextIcon
          : card.id === "bank-cash-summary"
            ? Landmark
            : card.id === "dashboard-charts"
              ? BarChart3
              : card.id === "dashboard-line-charts"
                ? LineChart
                : History;
    const footerTabActive =
      card.id === "dashboard-charts"
        ? visibleCard === "financial-summaries" && summaryChartsPane && summaryChartKind !== "line"
        : card.id === "dashboard-line-charts"
          ? visibleCard === "financial-summaries" && summaryChartsPane && summaryChartKind === "line"
          : card.id === "financial-summaries"
            ? visibleCard === "financial-summaries" && !summaryChartsPane
            : visibleCard === card.id;
    const isSummaryChartPair = Boolean(summaryChartSegment);
    return (
      <Button
        key={card.id}
        variant="ghost"
        className={cn(
          "pl-dashboard-footer-tab h-full min-h-0 min-w-0 px-1 py-0.5 text-muted-foreground",
          isSummaryChartPair
            ? "rounded-none border-0 bg-transparent shadow-none"
            : cn("rounded-md border-2", footerToneClassByCard[card.id]),
          shellClassName ?? "w-full flex-1",
          !isSummaryChartPair &&
            (footerToneClassByCard[card.id] ??
              "border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900"),
          isMobile ? "justify-center text-center" : "justify-center flex-row items-center gap-1.5",
          footerTabActive &&
            (isSummaryChartPair
              ? "bg-pink-200/90 saturate-125 dark:bg-pink-900/70"
              : "ring-2 ring-primary/70 shadow-md saturate-125"),
          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
        )}
        data-pl-footer-tab={card.id}
        data-pl-footer-tab-active={footerTabActive ? "" : undefined}
        {...(isSummaryChartPair ? { "data-pl-footer-summary-chart-segment": summaryChartSegment } : {})}
        onClick={() => {
          if (card.id === "dashboard-charts") {
            applySummaryChartsPane(true, "bar");
            setVisibleCard("financial-summaries");
            return;
          }
          if (card.id === "dashboard-line-charts") {
            applySummaryChartsPane(true, "line");
            setVisibleCard("financial-summaries");
            return;
          }
          if (card.id === "financial-summaries") {
            applySummaryChartsPane(false);
            setVisibleCard("financial-summaries");
            return;
          }
          setVisibleCard(card.id);
        }}
      >
        {!isMobile && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span
          className={cn(
            "font-medium leading-tight",
            isSummaryChartPair && (isMobile || isRealMobile) ? "text-[13px]" : "text-[9px] sm:text-[10px]",
          )}
        >
          {card.title}
        </span>
      </Button>
    );
  };

  const showRecentDesktopFixedLedgerFooter =
    !recentTransactionsCompact && visibleCard === "recent-transactions";
  const showRecentCompactBottomControls =
    recentTransactionsCompact && visibleCard === "recent-transactions";
  /** Mobile Daybook: pager row footer me (welcome ke neeche, tabs ke upar) + floating chevron. */
  const showDaybookMobileFooter = isMobile && visibleCard === "daybook";
  const welcomeDisplayName = user?.displayName || user?.email || "";
  const recentDesktopScrollContained =
    !recentTransactionsCompact && visibleCard === "recent-transactions";
  const dashboardFooterLockedDesktop =
    !recentDesktopScrollContained && !isMobile;

  return (
    <div
      data-pl-dashboard-recent-full-bleed={recentDesktopScrollContained ? "" : undefined}
      data-pl-daybook-unified-scroll={recentDesktopScrollContained ? "" : undefined}
      data-pl-dashboard-page-root={dashboardFooterLockedDesktop ? "" : undefined}
      className={cn(
        recentDesktopScrollContained
          ? "flex min-h-0 w-full min-w-0 flex-1 basis-0 flex-col overflow-x-auto overflow-y-hidden p-0"
          : cn(
              isMobile ? "px-0.5 pt-0.5" : "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pt-0.5",
            ),
      )}
      style={
        {
          paddingBottom: recentDesktopScrollContained ? 0 : isMobile ? footerRibbonHeightPx + 6 : 0,
          ...(recentDesktopScrollContained
            ? {
                paddingTop: RECENT_DESKTOP_EDGE_GAP_PX,
                paddingLeft: RECENT_DESKTOP_EDGE_GAP_PX,
                paddingRight: 0,
              }
            : {}),
          ["--pl-dashboard-recent-edge-gap"]: `${RECENT_DESKTOP_EDGE_GAP_PX}px`,
          ["--pl-dashboard-recent-min-width"]: `${RECENT_DESKTOP_MIN_WIDTH_IN}in`,
          ["--pl-dashboard-footer-ribbon-h"]: `${
            footerRibbonHeightPx + RECENT_DESKTOP_FOOTER_SCROLL_ROW_SLACK_PX + RECENT_DESKTOP_EDGE_GAP_PX
          }px`,
        } as React.CSSProperties
      }
    >
      {onlineSyncStatusPopup ? (
        <div
          className="pointer-events-none fixed left-1/2 top-16 z-[200] w-[min(92vw,28rem)] -translate-x-1/2 rounded-md border border-amber-300/90 bg-amber-50 px-4 py-2.5 text-center text-xs text-amber-950 shadow-md sm:text-sm"
          role="status"
          aria-live="polite"
        >
          {onlineSyncStatusPopup}
        </div>
      ) : null}
      <div
        data-pl-dashboard-recent-min-column={recentDesktopScrollContained ? "" : undefined}
        style={
          recentDesktopScrollContained
            ? {
                minWidth:
                  "max(var(--pl-dashboard-recent-min-width, 11.5in), calc(var(--pl-daybook-txn-table-min-px, 0) * 1px + 36px))",
              }
            : undefined
        }
        className={cn(
          recentDesktopScrollContained &&
            "flex min-h-0 w-full min-w-[max(var(--pl-dashboard-recent-min-width,11.5in),calc(var(--pl-daybook-txn-table-min-px,0)*1px+36px))] max-w-none flex-1 basis-0 flex-col gap-[var(--pl-dashboard-recent-edge-gap,2px)]",
          dashboardFooterLockedDesktop &&
            "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
        )}
      >
      <div
        {...(summaryChartsPane && visibleCard === "financial-summaries"
          ? { "data-pl-dashboard-summary-chart-scroll": "" }
          : {})}
        className={cn(
          "min-h-0 p-0",
          recentDesktopScrollContained && "flex min-h-0 flex-1 flex-col overflow-hidden",
          dashboardFooterLockedDesktop &&
            cn(
              "flex min-h-0 flex-1 flex-col min-w-0",
              visibleCard === "financial-summaries"
                ? "min-w-0 overflow-x-auto overflow-y-auto overscroll-contain scrollbar-slim-dim [scrollbar-gutter:stable]"
                : "overflow-hidden",
            ),
        )}
      >
        {renderDashboardContent()}
      </div>

      {/* Merged footer ribbon: welcome + (recent controls) + tabs — hamesha neeche (desktop flex foot). */}
      <div
        className={cn(
          "box-border pb-0",
          showRecentDesktopFixedLedgerFooter || dashboardFooterLockedDesktop
            ? "w-full shrink-0"
            : isMobile
              ? "fixed bottom-0 z-40 left-0 right-0 box-border"
              : "w-full shrink-0",
        )}
      >
        <div
          ref={footerRibbonRef}
          data-pl-dashboard-footer-ribbon=""
          {...(showRecentDesktopFixedLedgerFooter
            ? { "data-pl-dashboard-recent-footer-ribbon": "" }
            : {})}
          className={cn(
            "box-border flex w-full max-w-full flex-col gap-0 overflow-hidden bg-background shadow-none",
            "min-w-full w-full max-w-none",
            "divide-y divide-border border-t border-border",
            /* Mobile Recent: floating footer chevron toolbar ke upar dikhe (clip na ho). */
            (showRecentCompactBottomControls || showDaybookMobileFooter) && "relative overflow-visible",
          )}
        >
          <DashboardWelcomeFooterBanner
            embedded
            lineSections
            showDaybookDateNav={!isMobile && visibleCard === "daybook"}
            greeting={greeting}
            displayName={welcomeDisplayName}
            newYearInfo={newYearInfo}
          />

          {!isMobile && visibleCard === "daybook" ? (
            <div ref={setDaybookFooterSlot} data-pl-daybook-footer-slot="" className="w-full min-w-0 shrink-0 overflow-hidden empty:hidden" />
          ) : null}

          {showDaybookMobileFooter ? (
            <div
              data-pl-daybook-mobile-footer=""
              className={cn(
                "w-full max-w-full box-border overflow-visible border-0 bg-gray-200 px-1 py-0 dark:bg-gray-800",
                daybookFooterHidden ? "h-0" : "border-t border-gray-300 dark:border-gray-600",
              )}
            >
              {/* Mobile Daybook footer: floating chevron (right, ribbon ke upar) -> DaybookReport ka pager (portal). Hidden => pager + bottom tabs hide. */}
              <MasterListChromeChevronToggle
                expanded={!daybookFooterHidden}
                onClick={toggleDaybookFooterHidden}
                variant="inline"
                className="pl-mobile-ledger-footer-fab absolute bottom-[calc(100%+2px)] right-2 z-[45] mb-0 shrink-0 rounded-full shadow-md"
                ariaLabelWhenExpanded="Hide footer controls"
                ariaLabelWhenCollapsed="Show footer controls"
              />
              <div
                ref={setDaybookFooterSlot}
                data-pl-daybook-mobile-footer-slot=""
                className={cn("flex w-full min-w-0 justify-center", daybookFooterHidden && "[&_[data-pl-daybook-mobile-footer-pager]]:hidden")}
              />
            </div>
          ) : null}

          {showRecentCompactBottomControls ? (
            !recentFooterButtonsHidden ? (
          <div data-pl-recent-txn-toolbar="" data-pl-recent-mobile-footer="" className="w-full max-w-full box-border space-y-0 overflow-visible border-0 border-t border-gray-300 bg-gray-200 px-1 py-0 dark:border-gray-600 dark:bg-gray-800">
            {/* Mobile Recent footer (welcome ke neeche): floating chevron (right, pure footer ribbon ke upar; ribbon relative) -> Pager -> [clear X + Unapproved + Search]. Change date bottom tab bar me; Note mobile par hidden. Rows flush. */}
                <MasterListChromeChevronToggle
                  expanded={!recentFooterButtonsHidden}
                  onClick={toggleRecentFooterButtonsHidden}
                  variant="inline"
                  className="pl-mobile-ledger-footer-fab absolute bottom-[calc(100%+2px)] right-2 z-[45] mb-0 shrink-0 rounded-full shadow-md"
                  ariaLabelWhenExpanded="Hide footer controls"
                  ariaLabelWhenCollapsed="Show footer controls"
                />
          <MobileTransactionsPager
            className="px-0 pt-0"
            currentPage={recentSafePage}
            totalItems={recentListTotal}
            rowsPerPage={recentEffectiveRowsPerPage}
            onRowsPerPageChange={(nextRows) => {
              const n = Math.max(10, nextRows || 50);
              setRecentRowsPerPage(n);
              setRecentCurrentPage(1);
            }}
            onPageChange={setRecentCurrentPage}
            edgeCounts={recentPagerEdgeCounts}
            pagingMode="newest-first"
            trimSummary
            includeAllOption={false}
          />
            <div className="flex h-[38px] w-full min-w-0 items-center gap-1" data-pl-recent-mobile-search-row="">
              <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={recentUnapprovedOnly ? "default" : "outline"}
                  className="h-[38px] min-h-[38px] min-w-0 flex-1 whitespace-nowrap" data-pl-recent-mobile-unapproved=""
                  disabled={recentUnapprovedCount === 0 && !recentUnapprovedOnly}
                  onClick={() => {
                    if (recentUnapprovedOnly) setRecentUnapprovedOnly(false);
                    else applyRecentUnapprovedFilter();
                  }}
                >
                  Unapproved
                </Button>
                {(isRecentFilterActive || recentUnapprovedOnly) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-[38px] w-8 shrink-0"
                    onClick={clearRecentFilters}
                    aria-label="Clear Filters"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <button
                type="button"
                data-pl-recent-mobile-unapproved-count=""
                className={cn(
                  "h-[38px] min-h-[38px] w-[calc(5ch+1rem)] shrink-0 rounded-md border px-2 text-center text-sm font-bold tabular-nums",
                  /* Same pink pending/unapproved style as PendingApprovalListFilterBadge (party/master lists). */
                  recentUnapprovedOnly
                    ? "border-pink-600 bg-pink-600 text-white shadow-sm"
                    : "border-pink-200 bg-pink-100 text-pink-900 hover:bg-pink-200/90 dark:border-pink-800 dark:bg-pink-950/60 dark:text-pink-100 dark:hover:bg-pink-900/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                disabled={recentUnapprovedCount === 0 && !recentUnapprovedOnly}
                aria-label={`Unapproved vouchers: ${recentUnapprovedCount}`}
                onClick={() => {
                  if (recentUnapprovedOnly) setRecentUnapprovedOnly(false);
                  else applyRecentUnapprovedFilter();
                }}
              >
                {recentUnapprovedCount}
              </button>
              <div className="relative h-[38px] min-w-0 flex-1 basis-0">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  enterKeyHint="search"
                  listChrome
                  listChromeSearch
                  placeholder="Search"
                  value={recentQuickSearchInput}
                  onChange={(e) => setRecentQuickSearchInput(e.target.value)}
                  className="h-[38px] min-h-[38px] max-h-[38px] py-1 pl-8 pr-2 text-sm"
                  aria-label="Search recent vouchers"
                />
              </div>
            </div>
          </div>
            ) : (
          <div
            className="h-0 w-full border-0"
            data-pl-recent-footer-chevron-fab=""
          >
                <MasterListChromeChevronToggle
                  expanded={!recentFooterButtonsHidden}
                  onClick={toggleRecentFooterButtonsHidden}
                  variant="inline"
                  className="pl-mobile-ledger-footer-fab absolute bottom-[calc(100%+2px)] right-2 z-[45] mb-0 shrink-0 rounded-full shadow-md"
                  ariaLabelWhenExpanded="Hide footer controls"
                  ariaLabelWhenCollapsed="Show footer controls"
                />
          </div>
            )
          ) : null}

          {showRecentDesktopFixedLedgerFooter ? (
            <div data-pl-recent-ledger-footer-fixed="" className="w-full min-w-0 shrink-0 overflow-hidden">
              {recentDesktopLedgerFooter}
            </div>
          ) : null}

        <div
          data-pl-dashboard-footer-tabs=""
          className={cn(
            "grid w-full min-w-0 shrink-0 grid-flow-col items-stretch gap-0.5 overflow-hidden border-0 bg-background px-0",
            showRecentCompactBottomControls ? "grid-cols-5" : "grid-cols-4",
            isMobile ? "h-8" : "h-[38px]",
            /* Mobile Recent: footer chevron hidden => bottom tabs bhi hide (sirf up-chevron dikhe). */
            showRecentCompactBottomControls && recentFooterButtonsHidden && "hidden",
            /* Mobile Daybook: same behaviour (alag key). */
            showDaybookMobileFooter && daybookFooterHidden && "hidden",
          )}
          style={
            isMobile || isRealMobile
              ? {
                  gridTemplateColumns: showRecentCompactBottomControls
                    ? "1.44fr 1fr 1fr 1fr 1fr"
                    : "1.44fr 1fr 1fr 1fr",
                }
              : undefined
          }
        >
          <div
            data-pl-dashboard-footer-summary-chart-pair=""
            className="col-span-1 flex min-h-0 min-w-0 overflow-hidden rounded-md border-2 border-pink-500 bg-pink-300 text-pink-950 dark:border-pink-400 dark:bg-pink-800 dark:text-pink-50"
          >
            {renderDashboardFooterTab(dashboardCards[0], "h-full min-w-0 flex-1", "left")}
            {renderDashboardFooterTab(dashboardCards[1], "h-full min-w-0 flex-1", "mid")}
            {renderDashboardFooterTab(dashboardCards[2], "h-full min-w-0 flex-1", "right")}
          </div>
          {renderDashboardFooterTab(dashboardCards[3])}
          {renderDashboardFooterTab(dashboardCards[4])}
          {renderDashboardFooterTab(dashboardCards[5])}
          {/* Mobile Recent: Change date tab (right end), existing BS/AD pickers reuse. */}
          {showRecentCompactBottomControls ? (
          <div data-pl-footer-tab="recent-change-date" className="col-span-1 flex min-h-0 min-w-0 overflow-hidden rounded-md border-2 border-violet-400 bg-violet-100 text-violet-950 dark:border-violet-600 dark:bg-violet-900 dark:text-violet-50">
                {(dateSystem === 'BS' || dateSystem === 'Both') && (
                  <BsDatePicker
                    isRange
                    valueAD={recentDateRange}
                    onChangeAD={(range) => setRecentDateRange(range as DateRange | undefined)}
                    transactionDates={transactionDates}
                    className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0.5 text-[9px] font-medium"
                    hideTriggerIcon={true}
                    rangeEmptyLabel={"Change date"}
                    children={<span className="min-w-0 truncate text-[9px] font-medium leading-tight">Change date</span>}
                  />
                )}
                {(dateSystem === 'AD' || dateSystem === 'Both') && (
                  <Popover open={isRecentCalendarOpen} onOpenChange={(open) => {
                    setIsRecentCalendarOpen(open);
                    if (open) setTempRecentDateRange(recentDateRange);
                    else setTempRecentDateRange(undefined);
                  }}>
                    <PopoverTrigger asChild>
                      <Button
                        id="recent-date-bottom"
                        variant={"outline"}
                        className="h-full min-w-0 flex-1 justify-center rounded-none border-0 bg-transparent px-0.5 text-[9px] font-medium leading-tight shadow-none hover:bg-violet-200/70"
                      >
                        <span className="min-w-0 truncate text-[9px] font-medium leading-tight">Change date</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <AdCalendar
                        rangePresetSlot={
                          <DateRangePresetRow
                            country={company?.country}
                            onApply={(r) => {
                              setTempRecentDateRange(r);
                              setRecentDateRange(r);
                              setIsRecentCalendarOpen(false);
                            }}
                          />
                        }
                        valueAD={tempRecentDateRange ?? recentDateRange}
                        isRange
                        numberOfMonths={calendarMonths}
                        transactionDates={transactionDates}
                        onSelect={(adDate) => {
                          const range = tempRecentDateRange ?? recentDateRange;
                          if (!range?.from || (range.from && range.to)) {
                            setTempRecentDateRange({ from: adDate, to: undefined });
                          } else if (adDate < range.from) {
                            const next = { from: adDate, to: range.from };
                            setTempRecentDateRange(next);
                            setRecentDateRange(next);
                            setIsRecentCalendarOpen(false);
                          } else {
                            const next = { from: range.from, to: adDate };
                            setTempRecentDateRange(next);
                            setRecentDateRange(next);
                            setIsRecentCalendarOpen(false);
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </div>
          ) : null}
        </div>
        </div>
      </div>
      </div>
       <AddVoucherDialog 
          isOpen={isVoucherDialogOpen}
          onOpenChange={setIsVoucherDialogOpen}
          voucher={selectedVoucher}
          onVoucherAction={() => setSelectedVoucher(null)}
       />
       {interCompanyChangeDetectDialog}
       <HistoryDialog voucher={historyVoucher} isOpen={!!historyVoucher} onOpenChange={(open) => !open && setHistoryVoucher(null)} onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)} />
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

