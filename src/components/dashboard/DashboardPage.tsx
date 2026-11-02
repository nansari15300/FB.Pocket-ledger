"use client";

import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCompany } from "@/hooks/useCompany";
import { sortRecentTransactionsDesc } from "@/lib/recentTransactionsSort";
import { firestore } from "@/lib/firebase";
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import * as React from 'react';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
  Home,
  XCircle,
  X,
  Calendar as CalendarIcon,
  Printer,
  FileDigit,
  FileText as FileTextIcon,
  Filter,
  Wand2,
  ArrowDownCircle,
  ArrowUpCircle,
  StickyNote,
  Factory,
  HandCoins,
  BarChart3,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
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
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
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
import { openPrintDirect } from "@/lib/printDirect";
import { computeReceivablesPayablesFinancialSummary } from "@/lib/receivablesPayablesFinancialSummary";
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
import { LEDGER_HEADER_PILL_CN, LEDGER_HEADER_PILL_ICON_SIZE_CN } from "@/lib/ledgerHeaderChrome";
import { chromeProPillCn } from "@/lib/chromePillButton";
import {
  ReceivablesPayablesDialogEntityList,
  rpDialogListScrollHandlers,
  rpDialogPreventDismissForNestedPopover,
  RP_DIALOG_SHELL_ATTR,
  RP_DIALOG_HEADER_DIVIDER_CN,
} from "@/components/reports/ReceivablesPayablesDialogEntityList";
import { useReceivablesPayablesLedgerPopup } from "@/components/reports/ReceivablesPayablesLedgerPopup";
import { useReceivablesPayablesEntityVisibility } from "@/hooks/useReceivablesPayablesEntityVisibility";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { RP_DIALOG_SCROLL_CN } from "@/lib/receivablesPayablesEntityKeys";
import { orderedCashFlowCategories } from "@/lib/cashFlowCategoryOrder";
import {
  voucherCountsAsDashboardPaySalary,
  voucherCountsAsDashboardPaymentOutExcludingPaySalary,
} from "@/lib/dashboardPaySalaryStat";
import { dashboardStatCardReportHref } from "@/lib/dashboardStatCardReportHref";
import usePermissions from '@/hooks/usePermissions';
import { Checkbox } from '@/components/ui/checkbox';
import { DaybookReport } from '@/components/reports/DaybookReport';
import { useVouchers } from '@/hooks/useVouchers';
import { DashboardStatCardTxnLink } from "@/components/dashboard/DashboardStatCardTxnLink";
import { TransactionsTable, type TransactionColumnKey } from '@/components/vouchers/TransactionsTable';
import { LedgerDesktopFooter } from '@/components/vouchers/LedgerDesktopFooter';
import { LedgerFooterCheckboxPill } from '@/components/vouchers/ledgerFooterChrome';
import { MobileTransactionsPager } from '@/components/vouchers/MobileTransactionsPager';
import type { TransactionSortOrder } from '@/components/vouchers/TransactionTableSortDropdown';
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
import { useDashboard } from '@/hooks/useDashboard';
import { Calendar } from "@/components/ui/calendar";
import { useAuth } from '@/hooks/useAuth';
import { adToBs, bsToAd, getBSMonthDays } from "@/lib/bs-date";
import { motion, AnimatePresence } from 'framer-motion';
import { AddVoucherDialog } from '@/components/vouchers/AddVoucherDialog';
import { useTransactions, DAYBOOK_TRANSACTIONS_ENTITY } from '@/hooks/use-transactions';
import { useFeatureAccess } from '@/hooks/use-feature-access';
import { useIsMobile, useCalendarMonths } from '@/hooks/use-mobile';
import { DASHBOARD_VIEW_DETAILS_TABLE_CN } from "@/lib/dashboardViewDetailsTableClass";
import { pbSessionUserName, logUserNameLookupError } from "@/lib/pocketbaseData/userDisplayNameSession";
import {
  DashboardWelcomeFooterBanner,
  dashboardWelcomeFooterReservePx,
} from "@/components/dashboard/DashboardWelcomeFooterBanner";

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
      if (t.entries && Array.isArray(t.entries)) {
        debit = t.entries.reduce((sum: number, e: any) => sum + Number(e.debit || 0), 0);
        credit = t.entries.reduce((sum: number, e: any) => sum + Number(e.credit || 0), 0);
      }
      break;
  }
  return { debit, credit };
}

// Payment card: staff Pay To wale Pay Salary bucket me — yahan party/tax/expense/other payout
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
  const [mode, setMode] = useState<'all' | 'custom'>('all');
  
  // Current Date Infos
  const today = new Date();
  const currentBs = adToBs(today);
  
  // Selection State
  const [selectedBsYear, setSelectedBsYear] = useState(currentBs.y);
  const [selectedBsMonth, setSelectedBsMonth] = useState(currentBs.m);
  const [selectedAdYear, setSelectedAdYear] = useState(getYear(today));
  const [selectedAdMonth, setSelectedAdMonth] = useState(getMonth(today)); // 0-11

  // Sync internal state with dateRange prop
  useEffect(() => {
    if (dateRange?.from) {
      setMode('custom');
      if (dateSystem === 'BS') {
        const bs = adToBs(dateRange.from);
        setSelectedBsYear(bs.y);
        setSelectedBsMonth(bs.m);
      } else {
        setSelectedAdYear(getYear(dateRange.from));
        setSelectedAdMonth(getMonth(dateRange.from));
      }
    } else {
      setMode('all');
    }
  }, [dateRange, dateSystem]);

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
    <Popover open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button 
            variant="outline" 
            size="sm" 
            type="button"
            className="h-7 px-2 text-xs font-normal"
            onClick={(e) => {
              // Allow PopoverTrigger to handle the click, but prevent Dialog from closing
              e.stopPropagation();
            }}
        >
          <CalendarIcon className="mr-1 h-3 w-3" />
          {displayText}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-4 z-[9999]" 
        align="end" 
        onClick={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          // Prevent closing when clicking inside Dialog or on Select dropdowns
          if (
            target.closest('[data-radix-dialog-content]') || 
            target.closest('[role="dialog"]') ||
            target.closest('[data-radix-select-content]')
          ) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement;
          // Prevent closing when clicking inside Dialog or on Select dropdowns
          if (
            target.closest('[data-radix-dialog-content]') || 
            target.closest('[role="dialog"]') ||
            target.closest('[data-radix-select-content]')
          ) {
            e.preventDefault();
          }
        }}
      >
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

          <Button 
            className="w-full" 
            onClick={(e) => {
              e.stopPropagation();
              applyFilter();
            }}
          >
            Ok
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
// ------------------------------------

const BankCashSummary = () => {
    const { processedAccounts, vouchers } = useVouchers();
    const { dateSystem, formatCurrency } = useDate();
    const [bankCashDateRange, setBankCashDateRange] = React.useState<DateRange | undefined>(undefined);

    // NEW (BankCashSummary - default All Time)
useEffect(() => {
  setBankCashDateRange(undefined);
}, [dateSystem]);


    const bankCashSummary = React.useMemo(() => {
        if (!processedAccounts || !vouchers) return { cashAccounts: [], bankAccounts: [], totalBankInflow: 0, totalBankOutflow: 0, totalCashInflow: 0, totalCashOutflow: 0 };
    
        const fromDate = bankCashDateRange?.from ? startOfDay(bankCashDateRange.from) : null;
        const toDate = bankCashDateRange?.to ? endOfDay(bankCashDateRange.to) : fromDate ? endOfDay(fromDate) : null;
    
        const summaryAccounts = processedAccounts.map((acc) => {
          const newAcc = { ...acc, inflow: 0, outflow: 0, balance: Number(acc.openingBalance) || 0 };
          
          const prePeriodTx = vouchers.filter(v => {
            if (!fromDate) return false;
            const txDate = safeToDate(v.date);
            return txDate && txDate < fromDate;
          });
    
          let openingForPeriod = Number(acc.openingBalance) || 0;
          prePeriodTx.forEach(v => {
            const amount = v.total || v.amount || 0;
             if (['payment_in', 'direct_income', 'sale'].includes(v.type) && v.accountId === acc.id) openingForPeriod += amount;
             if (['payment_out', 'direct_expense', 'purchase'].includes(v.type) && v.accountId === acc.id) openingForPeriod -= amount;
             if (v.type === 'contra') {
                if (v.toAccountId === acc.id) openingForPeriod += amount;
                if (v.fromAccountId === acc.id) openingForPeriod -= amount;
             }
             if (v.type === "journal" && Array.isArray(v.entries)) {
              const entry = v.entries.find((e: any) => e.accountId === acc.id);
              if (entry) openingForPeriod += Number(entry.debit || 0) - Number(entry.credit || 0);
            }
          });
          newAcc.balance = openingForPeriod;
    
          const periodTx = vouchers.filter(v => {
              if (!fromDate || !toDate) return true;
              const txDate = safeToDate(v.date);
              return txDate && txDate >= fromDate && txDate <= toDate;
          });
    
          periodTx.forEach((v) => {
            const amount = v.total || v.amount || 0;
            if (['payment_in', 'direct_income', 'sale'].includes(v.type) && v.accountId === acc.id) newAcc.inflow += amount;
            if (['payment_out', 'direct_expense', 'purchase', 'salary', 'add_salary'].includes(v.type) && v.accountId === acc.id) newAcc.outflow += amount;
            if (v.type === 'contra') {
              if (v.toAccountId === acc.id) newAcc.inflow += amount;
              if (v.fromAccountId === acc.id) newAcc.outflow += amount;
            }
            if (v.type === "journal" && Array.isArray(v.entries)) {
              const entry = v.entries.find((e: any) => e.accountId === acc.id);
              if (entry) {
                newAcc.inflow += Number(entry.debit || 0);
                newAcc.outflow += Number(entry.credit || 0);
              }
            }
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
    
        const totalBankInflow = bankAccounts.reduce((sum, acc) => sum + acc.inflow, 0);
        const totalBankOutflow = bankAccounts.reduce((sum, acc) => sum + acc.outflow, 0);
        const totalCashInflow = cashAccounts.reduce((sum, acc) => sum + acc.inflow, 0);
        const totalCashOutflow = cashAccounts.reduce((sum, acc) => sum + acc.outflow, 0);

        return { cashAccounts, bankAccounts, totalBankInflow, totalBankOutflow, totalCashInflow, totalCashOutflow };
      }, [processedAccounts, vouchers, bankCashDateRange]);

    return (
        <Card id="bank-cash-summary-area" className="flex-1 flex flex-col min-h-0 border-foreground/20">
            <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Bank/Cash Summary</CardTitle>
                    <MonthYearFilter dateRange={bankCashDateRange} setDateRange={setBankCashDateRange} dateSystem={dateSystem} />
                </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 p-0">
                <ScrollArea className="flex-1 w-full">
                  {/* Patla row divider — global Table 3px black override (Bank/Cash card + summary rows). */}
                  <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}>
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
                        <AnimatePresence>
                            {bankCashSummary.bankAccounts.map(acc => (
                                <motion.tr key={acc.id} layout="position" initial={false} exit={{ transition: { duration: 0 } }} className="border-b">
                                    <TableCell>{acc.accountName}</TableCell>
                                    <TableCell>{acc.accountType}</TableCell>
                                    <TableCell className="text-right text-green-600">{acc.inflow > 0 ? formatCurrency(acc.inflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className="text-right text-red-600">{acc.outflow > 0 ? formatCurrency(acc.outflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className={cn("text-right font-semibold", acc.balance >= 0 ? "text-green-600" : "text-red-600")}>
                                      {acc.balance !== 0 ? formatCurrency(acc.balance, { showDrCr: true, duration: 2 }) : 'Rs. 0.00 Dr'}
                                    </TableCell>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                         {/* Summary separator: pehle border-b-2 tha; view details jaisa patla rakha */}
                         <TableRow className="font-bold bg-muted/50 border-b border-border/75">
                            <TableCell colSpan={2}>Bank Total</TableCell>
                            <TableCell className="text-right text-green-600">{formatCurrency(bankCashSummary.totalBankInflow, {noSuffix: true, duration: 2})}</TableCell>
                            <TableCell className="text-right text-red-600">{formatCurrency(bankCashSummary.totalBankOutflow, {noSuffix: true, duration: 2})}</TableCell>
                            <TableCell className={cn("text-right", (bankCashSummary.totalBankInflow-bankCashSummary.totalBankOutflow) >= 0 ? "text-green-600" : "text-red-600")}>
                                {formatCurrency(bankCashSummary.bankAccounts.reduce((sum, a) => sum + a.balance, 0), { showDrCr: true, duration: 2 })}
                            </TableCell>
                        </TableRow>
                          <AnimatePresence>
                            {bankCashSummary.cashAccounts.map(acc => (
                               <motion.tr key={acc.id} layout="position" initial={false} exit={{ transition: { duration: 0 } }} className="border-b">
                                    <TableCell>{acc.accountName}</TableCell>
                                    <TableCell>{acc.accountType}</TableCell>
                                    <TableCell className="text-right text-green-600">{acc.inflow > 0 ? formatCurrency(acc.inflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className="text-right text-red-600">{acc.outflow > 0 ? formatCurrency(acc.outflow, { noSuffix: true, duration: 2 }) : '-'}</TableCell>
                                    <TableCell className={cn("text-right font-semibold", acc.balance >= 0 ? "text-green-600" : "text-red-600")}>
                                      {acc.balance !== 0 ? formatCurrency(acc.balance, { showDrCr: true, duration: 2 }) : 'Rs. 0.00 Dr'}
                                    </TableCell>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                         <TableRow className="font-bold bg-muted/50 border-b border-border/75">
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
    )
};


export default function DashboardPage() {
  const { company, companyId } = useCompany();
  const { can } = usePermissions();
  const { user } = useAuth();
  const { vouchers, loading: vouchersLoading, processedItems, processedParties, processedStaff, processedTaxes, processedAccounts, expenseAccounts, journalAccountNames: voucherJournalAccountNames } = useVouchers();
  const [showFab, setShowFab] = useState(true);
  const lastScrollY = useRef(0);
  const hideFabTimeout = useRef<NodeJS.Timeout | null>(null);
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } = useDate();
  
  const [loading, setLoading] = React.useState(true);
  
  const [userNames, setUserNames] = React.useState<Record<string, string>>({});
  
  const [receivablesPayablesOpen, setReceivablesPayablesOpen] = React.useState(false);
  const [taxSummaryOpen, setTaxSummaryOpen] = useState(false);
  
  // Filter for Receivables & Payables Dialog
  const [receivablePayableFilter, setReceivablePayableFilter] = useState<RpCategoryFilter>("all");
  const [receivablesPayablesTab, setReceivablesPayablesTab] =
    useState<ReceivablesPayablesSideTab>("receivables");
  const [rpDeadlines, setRpDeadlines] = React.useState<RpDeadlinesMap>({});
  const rpDeadlineAutoOpenKeyRef = React.useRef<string | null>(null);
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const [cashFlowFilter, setCashFlowFilter] = useState<'all' | 'inflow' | 'outflow'>('all');
  const [cashFlowCategoryFilter, setCashFlowCategoryFilter] = useState<'all' | 'party' | 'staff' | 'tax' | 'income_expense' | 'other'>('all');
  const [receivablesDateRange, setReceivablesDateRange] = useState<DateRange | undefined>(undefined);
  const [cashFlowDateRange, setCashFlowDateRange] = useState<DateRange | undefined>(undefined);
  const [taxDateRange, setTaxDateRange] = useState<DateRange | undefined>(undefined);
  const [stockDateRange, setStockDateRange] = useState<DateRange | undefined>(undefined);
  const [taxFilter, setTaxFilter] = useState<'all' | 'input' | 'output'>('all');
  const [selectedTaxId, setSelectedTaxId] = useState<string | null>(null);

    // State for new dialogs and date pickers
    const [stockSummaryOpen, setStockSummaryOpen] = useState(false);
    const [cashFlowOpen, setCashFlowOpen] = useState(false);

    const [showRecentNarration, setShowRecentNarration] = useState(false);
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  
  const [recentRowsPerPage, setRecentRowsPerPage] = useRowsPerPage(10, "app-recent-rows-per-page");
  const [recentCurrentPage, setRecentCurrentPage] = React.useState(1);
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
  const { visibleCard, setVisibleCard } = useDashboard();
  // One-time: old default "financial-summaries" hid Daybook/Recent on PL Server even when role allowed them.
  useEffect(() => {
    if (!company || (company as { plServerShared?: boolean }).plServerShared !== true) return;
    const key = `pl_dash_show_all_v1_${company.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return;
    }
    if (visibleCard === "financial-summaries") setVisibleCard("all");
  }, [company, company?.id, setVisibleCard, visibleCard]);
  const [greeting, setGreeting] = useState('');
  
  const [recentDateRange, setRecentDateRange] = React.useState<DateRange | undefined>();
  const [recentFilters, setRecentFilters] = useState<Record<string, string>>({});
  /** Recent card quick chip: click -> all-time unapproved only (date/type/column filters ignore). */
  const [recentUnapprovedOnly, setRecentUnapprovedOnly] = useState(false);
  const [activeRecentFilter, setActiveRecentFilter] = useState<string | null>(null);
  const [isDateChange, setIsDateChange] = useState(false);

  const isReportsEnabled = useFeatureAccess('reports');

  const transactionDates = useMemo(() => vouchers.map(v => safeToDate(v.date)).filter(Boolean) as Date[], [vouchers]);

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

  const fetchUserName = React.useCallback(
    async (userId: string): Promise<string> => {
        if (!userId) return "N/A";
        if (userNames[userId] && userNames[userId] !== "Unknown") return userNames[userId];
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
                    setUserNames(prev => ({...prev, [userId]: displayName}));
                    return displayName;
                }
            }
        } catch(e) { logUserNameLookupError("Dashboard", userId, e) }
        return "N/A"; // Return N/A instead of Unknown
    }, [userNames]
  );
  
  React.useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(vouchersLoading);
  }, [companyId, vouchersLoading]);

  React.useEffect(() => {
    rpDeadlineAutoOpenKeyRef.current = null;
    if (!companyId) {
      setRpDeadlines({});
      return;
    }
    setRpDeadlines(readRpDeadlinesFromStorage(companyId));
  }, [companyId]);

  const handleRpDeadlineChange = React.useCallback(
    (side: "receivables" | "payables", row: RpDialogRow, ymd: string | null) => {
      if (!companyId) return;
      const key = rpDialogRowSelectionKey(side, row);
      setRpDeadlines((prev) => {
        const next = { ...prev };
        if (ymd) next[key] = ymd;
        else delete next[key];
        writeRpDeadlinesToStorage(companyId, next);
        return next;
      });
    },
    [companyId]
  );

  React.useEffect(() => {
    if (vouchers.length > 0) {
        const uidsToFetch = new Set(vouchers.map(v => v.userId).filter(Boolean));
        uidsToFetch.forEach(uid => {
            if (!userNames[uid]) {
                fetchUserName(uid);
            }
        });
    }
  }, [vouchers, fetchUserName, userNames]);

  // ---------- FINANCIAL SUMMARY CALCULATION (Grouped) ----------
  const {
    hiddenCategories: rpHiddenCategories,
    canEdit: canEditRpVisibility,
    filterSummary: filterRpSummary,
    saveHiddenCategories: saveRpHiddenCategories,
  } = useReceivablesPayablesEntityVisibility();
  const rpListMotion = useMasterListRowMotion();
  const rpListScrollHandlers = rpDialogListScrollHandlers(rpListMotion);
  const rpLedgerPopup = useReceivablesPayablesLedgerPopup();

  const rawFinancialSummary = React.useMemo(() => {
    const raw = computeReceivablesPayablesFinancialSummary({
      vouchers,
      processedParties,
      processedStaff,
      processedTaxes,
      processedAccounts,
      processedExpenseAccounts: expenseAccounts,
      receivablesDateRange,
      loading: !!loading,
    });
    return normalizeReceivablesPayablesSummary(raw);
  }, [
    loading,
    vouchers,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    expenseAccounts,
    receivablesDateRange,
  ]);

  const financialSummary = React.useMemo(
    () => filterRpSummary(rawFinancialSummary),
    [rawFinancialSummary, filterRpSummary]
  );

  /** Receivables/Payables dialog footer: list jo dikh rahi hai usi ka sum (card summary alag). */
  const receivablesPayablesDialogListTotals = React.useMemo(() => {
    const receivableSum = sumRpDialogSide("receivables", financialSummary, receivablePayableFilter);
    const payableSum = sumRpDialogSide("payables", financialSummary, receivablePayableFilter);
    return { receivableSum, payableSum };
  }, [financialSummary, receivablePayableFilter]);

  /** Dialog footer: dono total ka difference — sirf jis side ka total zyada ho wahan Balance. */
  const receivablesPayablesDialogBalance = React.useMemo(() => {
    const { receivableSum, payableSum } = receivablesPayablesDialogListTotals;
    const amount = Math.abs(receivableSum - payableSum);
    if (receivableSum > payableSum) return { amount, side: "receivable" as const };
    if (payableSum > receivableSum) return { amount, side: "payable" as const };
    return { amount: 0, side: "equal" as const };
  }, [receivablesPayablesDialogListTotals]);

  /** Outstanding dialog tables: mobile par account … truncate, Amount column poora + patla horizontal line. */
  const rpDlgTableClass = cn(DASHBOARD_VIEW_DETAILS_TABLE_CN, isMobile && "w-full table-fixed");
  const rpDlgAccountThClass = cn(isMobile && "min-w-0 w-[58%] max-w-[58%]");
  const rpDlgAmountThClass = cn("text-right", isMobile && "w-[42%] min-w-0 whitespace-nowrap");
  const rpDlgAccountTdClass = cn(isMobile && "min-w-0 max-w-0 truncate");
  const rpDlgAmountTdRecClass = cn("text-right font-medium text-green-600 dark:text-green-500", isMobile && "whitespace-nowrap tabular-nums");
  const rpDlgAmountTdPayClass = cn("text-right font-medium text-red-600 dark:text-red-500", isMobile && "whitespace-nowrap tabular-nums");

  /** Outstanding card = list-sum (All), dialog ke default totals jaisa. */
  const receivablesPayablesCardTotals = React.useMemo(() => {
    const receivableSum = sumRpDialogSide("receivables", financialSummary, "all");
    const payableSum = sumRpDialogSide("payables", financialSummary, "all");
    return { receivableSum, payableSum, net: receivableSum - payableSum };
  }, [financialSummary]);

  const receivablesDialogSections = React.useMemo(
    () => buildRpDialogSections("receivables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );

  const payablesDialogSections = React.useMemo(
    () => buildRpDialogSections("payables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );

  const receivablesDialogCount = React.useMemo(
    () => countRpDialogSide("receivables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );

  const payablesDialogCount = React.useMemo(
    () => countRpDialogSide("payables", financialSummary, receivablePayableFilter),
    [financialSummary, receivablePayableFilter]
  );

  const rpDeadlineDueCount = React.useMemo(() => {
    const today = new Date();
    return countRpDeadlineDueAccounts(
      financialSummary,
      receivablePayableFilter,
      rpDeadlines,
      today
    );
  }, [financialSummary, receivablePayableFilter, rpDeadlines]);

  const receivablesDeadlineSections = React.useMemo(() => {
    const today = new Date();
    return filterRpDialogSectionsForDeadlineDue(
      receivablesDialogSections,
      "receivables",
      rpDeadlines,
      today
    );
  }, [receivablesDialogSections, rpDeadlines]);

  const payablesDeadlineSections = React.useMemo(() => {
    const today = new Date();
    return filterRpDialogSectionsForDeadlineDue(
      payablesDialogSections,
      "payables",
      rpDeadlines,
      today
    );
  }, [payablesDialogSections, rpDeadlines]);

  const rpDeadlineRowProps = React.useMemo(
    () => ({
      deadlines: rpDeadlines,
      onDeadlineChange: handleRpDeadlineChange,
      showDeadlineControls: true,
    }),
    [rpDeadlines, handleRpDeadlineChange]
  );

  const formatRpDialogAmount = (amount: number, absAmount = false) =>
    formatCurrency(absAmount ? Math.abs(amount) : amount, {
      noSuffix: true,
      showDrCr: true,
      context: "transaction",
    });

  // --- CASH FLOW CALCULATION ---
  const cashFlowDetails = React.useMemo(() => {
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
        if(v.incomeAccountId || v.expenseAccountId || v.toAccountId) return 'Income/Expense';
        return 'Other';
    }

    const getEntityInfo = (v: Voucher): {id: string, name: string} => {
        if(v.partyId) return {id: v.partyId, name: processedParties.find(p=>p.id === v.partyId)?.name || 'Unknown Party'};
        if(v.staffId) return {id: v.staffId, name: processedStaff.find(s=>s.id === v.staffId)?.name || 'Unknown Staff'};
        if(v.taxAccountId) return {id: v.taxAccountId, name: processedTaxes.find(t=>t.id === v.taxAccountId)?.name || 'Unknown Tax'};
        if(v.incomeAccountId) return {id: v.incomeAccountId, name: expenseAccounts.find(e=>e.id === v.incomeAccountId)?.name || 'Unknown Income'};
        if(v.expenseAccountId) return {id: v.expenseAccountId, name: expenseAccounts.find(e=>e.id === v.expenseAccountId)?.name || 'Unknown Expense'};
        if(v.toAccountId) return {id: v.toAccountId, name: expenseAccounts.find(e=>e.id === v.toAccountId)?.name || 'Unknown Account'};
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

  // 3. STOCK SUMMARY DETAILS
  const overallStockSummary = useMemo(() => {
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
}, [processedItems, vouchers, stockDateRange]);

  const stats = React.useMemo(() => {
    if (!vouchers) return { otherStats: statCardData.map(s => ({ ...s, total: 0, count: 0 })) };

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
  }, [vouchers]);
  
  // Unapproved quick filter: force all-time + all types + clear table column filters.
  const effectiveRecentDateRange = recentUnapprovedOnly ? undefined : recentDateRange;
  const effectiveRecentFilters = recentUnapprovedOnly ? {} : recentFilters;
  const { daybookTransactions: allRecentTransactions } = useTransactions(
    DAYBOOK_TRANSACTIONS_ENTITY,
    'daybook',
    effectiveRecentDateRange,
    undefined,
    processedAccounts,
    vouchers,
    undefined,
    effectiveRecentFilters,
    undefined,
    journalAccountNames,
    userNames,
    undefined,
    undefined,
    true
  );

  const recentSortedBase = useMemo(() => {
    if (!allRecentTransactions) return [];
    let sorted = sortRecentTransactionsDesc(allRecentTransactions as Record<string, unknown>[]);
    if (recentSortOrder === 'asc') sorted = [...sorted].reverse();
    if (recentUnapprovedOnly) {
      sorted = sorted.filter((tx) => (tx as any).isApproved !== true);
    }
    if (!includeNotesInTable) {
      sorted = sorted.filter((tx) => (tx as any).type !== 'note');
    }
    return sorted;
  }, [allRecentTransactions, recentUnapprovedOnly, recentSortOrder, includeNotesInTable]);

  const recentListTotal = recentSortedBase.length;
  const recentEffectiveRowsPerPage = Math.max(10, recentRowsPerPage || 50);
  const recentTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(recentListTotal / recentEffectiveRowsPerPage));
  }, [recentListTotal, recentEffectiveRowsPerPage]);
  const recentSafePage = Math.min(Math.max(1, recentCurrentPage), recentTotalPages);
  const recentPaginationSlice = useMemo(() => {
    const total = recentListTotal;
    const pageSize = recentEffectiveRowsPerPage;
    if (total === 0) {
      return { rows: recentSortedBase, beforeCount: 0, afterCount: 0 };
    }
    const start = (recentSafePage - 1) * pageSize;
    const end = Math.min(total, start + pageSize);
    return {
      rows: recentSortedBase.slice(start, end),
      beforeCount: total - end,
      afterCount: start,
    };
  }, [recentSortedBase, recentEffectiveRowsPerPage, recentSafePage, recentListTotal]);
  const recentTransactions = recentPaginationSlice.rows;
  const recentPagerEdgeCounts = useMemo(
    () => ({
      before: recentPaginationSlice.beforeCount,
      after: recentPaginationSlice.afterCount,
    }),
    [recentPaginationSlice.afterCount, recentPaginationSlice.beforeCount]
  );

  React.useEffect(() => {
    if (recentRowsPerPage <= 0) setRecentRowsPerPage(50);
  }, [recentRowsPerPage, setRecentRowsPerPage]);

  React.useEffect(() => {
    setRecentCurrentPage(1);
  }, [recentDateRange, recentFilters, recentUnapprovedOnly, recentSortOrder, includeNotesInTable]);
  React.useEffect(() => {
    setRecentCurrentPage((p) => Math.min(Math.max(1, p), recentTotalPages));
  }, [recentTotalPages]);
  
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
          { text: `${section.label} (${section.rowCount ?? section.rows.length})`, bold: true, color: "#64748b" },
          "",
        ]);
        for (const item of section.rows) {
          if (item.isIcPeerCompanyGroup && item.icChildren?.length) {
            body.push([
              { text: item.party, bold: true },
              {
                text: formatCurrencyForPrint(Math.abs(item.balance), { noSuffix: true, noAnimation: true }),
                alignment: "right",
              },
            ]);
            for (const child of item.icChildren) {
              body.push([
                { text: `    ${child.party}`, color: "#64748b" },
                {
                  text: formatCurrencyForPrint(Math.abs(child.balance), { noSuffix: true, noAnimation: true }),
                  alignment: "right",
                },
              ]);
            }
            continue;
          }
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
      try {
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
      } catch (error) {
          console.error("Error printing stock summary:", error);
      }
  }

  const isRecentFilterActive = useMemo(
    () =>
      recentDateRange !== undefined ||
      Object.values(recentFilters).some(v => v) ||
      recentUnapprovedOnly,
    [recentDateRange, recentFilters, recentUnapprovedOnly]
  );
  const clearRecentFilters = () => {
    setRecentDateRange(undefined);
    setRecentFilters({});
    setRecentUnapprovedOnly(false);
  };
  const applyRecentUnapprovedFilter = () => {
    // User request: button click = all-time unapproved vouchers only.
    setRecentUnapprovedOnly(true);
    setRecentDateRange(undefined);
    setRecentFilters({});
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
    });

    return { inputs, outputs };
  }, [selectedTaxId, vouchers, processedTaxes, processedParties]);

  const displayTransactionDate = (date: any) => {
    const d = safeToDate(date);
    if (!d) return "Invalid Date";
    return dateSystem === 'AD' ? formatDate(d) : formatDateBS(d);
  };


  const renderFinancialSummaries = (reportsEnabled: boolean) => {
    return (
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-0.5 px-0.5'>
        {can("view_receivable_payable_summary") && (
            <Card className="col-span-1 transition-colors border-foreground/20">
                <CardHeader className="flex flex-row items-center justify-between p-4 space-y-0">
                    <CardTitle className="text-base whitespace-nowrap text-card-foreground">Outstanding</CardTitle>
                    <MonthYearFilter dateRange={receivablesDateRange} setDateRange={setReceivablesDateRange} dateSystem={dateSystem} />
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                    <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">To Receive</span><span className="text-base font-bold text-green-600">{formatCurrency(receivablesPayablesCardTotals.receivableSum, {noSuffix: true})} <span className="text-xs">Dr</span></span></div>
                    <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">To Pay</span><span className="text-base font-bold text-red-600">{formatCurrency(receivablesPayablesCardTotals.payableSum, {noSuffix: true})} <span className="text-xs">Cr</span></span></div>
                    <div className="flex items-baseline justify-between pt-2 mt-2 border-t"><span className="text-sm font-bold">Net</span><span className={cn('text-lg font-bold', receivablesPayablesCardTotals.net >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(receivablesPayablesCardTotals.net, { showDrCr: true })}</span></div>
                    {reportsEnabled && (
                        <div className="text-right pt-2">
                            <Dialog open={receivablesPayablesOpen} onOpenChange={(open) => {
                              setReceivablesPayablesOpen(open);
                              if (open) {
                                setReceivablePayableFilter("all");
                              }
                              if (!open) {
                                setReceivablesPayablesTab('receivables');
                                rpLedgerPopup.resetDialogInteraction();
                              }
                            }}>
                                <DialogTrigger asChild>
                                    <Button variant="link" size="sm" className="h-auto p-0">View Details</Button>
                                </DialogTrigger>
                                <DialogContent
                                  overlayClassName="bg-black/45 backdrop-blur-none"
                                  className="dashboard-financial-popup max-w-6xl gap-0 p-0 h-[90vh] rounded-lg flex flex-col overflow-hidden"
                                  onPointerDownOutside={rpDialogPreventDismissForNestedPopover}
                                  onInteractOutside={rpDialogPreventDismissForNestedPopover}
                                  {...RP_DIALOG_SHELL_ATTR}
                                >
                                    <DialogHeader className={cn("shrink-0 flex flex-col border-0", isMobile ? "gap-1 px-3 pb-1.5 pt-1.5" : "gap-2 p-4 pb-3")}>
                                        {!isMobile && (
                                            <DialogTitle className="whitespace-nowrap text-base md:text-lg">
                                                Receivables & Payables Details
                                            </DialogTitle>
                                        )}
                                        <div className={cn("flex items-start gap-2", isMobile ? "justify-between" : "flex-wrap")}>
                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                {isMobile ? (
                                                    <DialogTitle className="sr-only">Receivables & Payables Details</DialogTitle>
                                                ) : null}
                                                <ReceivablesPayablesMobileSidePills
                                                    tab={receivablesPayablesTab}
                                                    receivablesCount={receivablesDialogCount}
                                                    payablesCount={payablesDialogCount}
                                                    deadlineCount={rpDeadlineDueCount}
                                                    onSelect={setReceivablesPayablesTab}
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handlePrint();
                                                    }}
                                                    className={cn(
                                                        "data-pl-rp-side-pill pl-chrome-btn-drop shrink-0 flex items-center gap-1.5 border border-solid !border-[1px] !border-blue-300",
                                                        chromeProPillCn,
                                                        LEDGER_HEADER_PILL_CN
                                                    )}
                                                >
                                                    Print <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
                                                </Button>
                                            </div>
                                            {isMobile && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 shrink-0"
                                                    onClick={() => setReceivablesPayablesOpen(false)}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </DialogHeader>
                                    <div className={RP_DIALOG_HEADER_DIVIDER_CN} aria-hidden />
                                    <div className={cn(
                                        "flex-1 min-h-0 overflow-hidden pb-0",
                                        isMobile ? "flex flex-col px-2 pt-[3px]" : "grid grid-cols-2 gap-4 px-4 pt-[3px]"
                                    )}>
                                        {isMobile ? (
                                            <div className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-0", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                {receivablesPayablesTab === "receivables" && (
                                                        <ReceivablesPayablesDialogEntityList
                                                            sections={receivablesDialogSections}
                                                            side="receivables"
                                                            formatAmount={formatRpDialogAmount}
                                                            isMobile={isMobile}
                                                            listMotion={rpListMotion}
                                                            selectedKey={rpLedgerPopup.selectedKey}
                                                            onSelectRow={rpLedgerPopup.selectRow}
                                                            onOpenRow={rpLedgerPopup.openRowLedger}
                                                            {...rpDeadlineRowProps}
                                                        />
                                                )}
                                                {receivablesPayablesTab === "payables" && (
                                                        <ReceivablesPayablesDialogEntityList
                                                            sections={payablesDialogSections}
                                                            side="payables"
                                                            formatAmount={formatRpDialogAmount}
                                                            isMobile={isMobile}
                                                            listMotion={rpListMotion}
                                                            selectedKey={rpLedgerPopup.selectedKey}
                                                            onSelectRow={rpLedgerPopup.selectRow}
                                                            onOpenRow={rpLedgerPopup.openRowLedger}
                                                            {...rpDeadlineRowProps}
                                                        />
                                                )}
                                                {receivablesPayablesTab === "deadline" && (
                                                    <div className="flex min-h-0 flex-col gap-3">
                                                        {receivablesDeadlineSections.length > 0 ? (
                                                            <div className="min-h-0">
                                                                <h3 className="mb-2 text-base font-semibold text-green-600">Receivables</h3>
                                                                <ReceivablesPayablesDialogEntityList
                                                                    sections={receivablesDeadlineSections}
                                                                    side="receivables"
                                                                    formatAmount={formatRpDialogAmount}
                                                                    isMobile={isMobile}
                                                                    listMotion={rpListMotion}
                                                                    selectedKey={rpLedgerPopup.selectedKey}
                                                                    onSelectRow={rpLedgerPopup.selectRow}
                                                                    onOpenRow={rpLedgerPopup.openRowLedger}
                                                                    {...rpDeadlineRowProps}
                                                                />
                                                            </div>
                                                        ) : null}
                                                        {payablesDeadlineSections.length > 0 ? (
                                                            <div className="min-h-0">
                                                                <h3 className="mb-2 text-base font-semibold text-red-600">Payables</h3>
                                                                <ReceivablesPayablesDialogEntityList
                                                                    sections={payablesDeadlineSections}
                                                                    side="payables"
                                                                    formatAmount={formatRpDialogAmount}
                                                                    isMobile={isMobile}
                                                                    listMotion={rpListMotion}
                                                                    selectedKey={rpLedgerPopup.selectedKey}
                                                                    onSelectRow={rpLedgerPopup.selectRow}
                                                                    onOpenRow={rpLedgerPopup.openRowLedger}
                                                                    {...rpDeadlineRowProps}
                                                                />
                                                            </div>
                                                        ) : null}
                                                        {receivablesDeadlineSections.length === 0 &&
                                                        payablesDeadlineSections.length === 0 ? (
                                                            <p className="py-8 text-center text-sm text-muted-foreground">
                                                                No accounts due on or before today with an outstanding balance.
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </div>
                                        ) : receivablesPayablesTab === "deadline" ? (
                                            <div className={cn("col-span-2 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-0.5", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
                                                    <div className="flex min-h-0 flex-col">
                                                        <h3 className="mb-2 shrink-0 text-lg font-semibold text-green-600">Receivables</h3>
                                                        <ReceivablesPayablesDialogEntityList
                                                            sections={receivablesDeadlineSections}
                                                            side="receivables"
                                                            formatAmount={formatRpDialogAmount}
                                                            isMobile={isMobile}
                                                            listMotion={rpListMotion}
                                                            selectedKey={rpLedgerPopup.selectedKey}
                                                            onSelectRow={rpLedgerPopup.selectRow}
                                                            onOpenRow={rpLedgerPopup.openRowLedger}
                                                            {...rpDeadlineRowProps}
                                                        />
                                                    </div>
                                                    <div className="flex min-h-0 flex-col">
                                                        <h3 className="mb-2 shrink-0 text-lg font-semibold text-red-600">Payables</h3>
                                                        <ReceivablesPayablesDialogEntityList
                                                            sections={payablesDeadlineSections}
                                                            side="payables"
                                                            formatAmount={formatRpDialogAmount}
                                                            isMobile={isMobile}
                                                            listMotion={rpListMotion}
                                                            selectedKey={rpLedgerPopup.selectedKey}
                                                            onSelectRow={rpLedgerPopup.selectRow}
                                                            onOpenRow={rpLedgerPopup.openRowLedger}
                                                            {...rpDeadlineRowProps}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                        <div className="flex flex-col min-h-0 h-full">
                                                <h3 className="text-lg font-semibold mb-2 text-green-600 shrink-0">Receivables ({receivablesDialogCount})</h3>
                                                <div className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-0.5", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                    <ReceivablesPayablesDialogEntityList
                                                        sections={receivablesDialogSections}
                                                        side="receivables"
                                                        formatAmount={formatRpDialogAmount}
                                                        isMobile={isMobile}
                                                        listMotion={rpListMotion}
                                                        selectedKey={rpLedgerPopup.selectedKey}
                                                        onSelectRow={rpLedgerPopup.selectRow}
                                                        onOpenRow={rpLedgerPopup.openRowLedger}
                                                        {...rpDeadlineRowProps}
                                                    />
                                                </div>
                                            </div>
                                        <div className="flex flex-col min-h-0 h-full">
                                                <h3 className="text-lg font-semibold mb-2 text-red-600 shrink-0">Payables ({payablesDialogCount})</h3>
                                                <div className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-0.5", RP_DIALOG_SCROLL_CN)} {...rpListScrollHandlers}>
                                                    <ReceivablesPayablesDialogEntityList
                                                        sections={payablesDialogSections}
                                                        side="payables"
                                                        formatAmount={formatRpDialogAmount}
                                                        isMobile={isMobile}
                                                        listMotion={rpListMotion}
                                                        selectedKey={rpLedgerPopup.selectedKey}
                                                        onSelectRow={rpLedgerPopup.selectRow}
                                                        onOpenRow={rpLedgerPopup.openRowLedger}
                                                        {...rpDeadlineRowProps}
                                                    />
                                                </div>
                                            </div>
                                            </>
                                        )}
                                    </div>
                                    <ReceivablesPayablesDialogFooter
                                        receivableSum={receivablesPayablesDialogListTotals.receivableSum}
                                        payableSum={receivablesPayablesDialogListTotals.payableSum}
                                        balance={receivablesPayablesDialogBalance}
                                        isMobile={isMobile}
                                        formatAmount={(amount) =>
                                            formatCurrency(amount, { noSuffix: true, context: "transaction" })
                                        }
                                    />
                                </DialogContent>
                            </Dialog>
                            {rpLedgerPopup.popup}
                        </div>
                    )}
                </CardContent>
            </Card>
          )}
          
        {can("view_payment_in_out_summary") && (
            <Card className="col-span-1 transition-colors border-foreground/20">
              <CardHeader className="flex flex-row items-center justify-between p-4 space-y-0">
                <CardTitle className="text-base whitespace-nowrap">Cash Flow</CardTitle>
                <MonthYearFilter dateRange={cashFlowDateRange} setDateRange={setCashFlowDateRange} dateSystem={dateSystem} />
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Receipt</span><span className="text-base font-bold text-green-600">{formatCurrency(cashFlowDetails.totalInflow, {noSuffix: true})} <span className="text-xs">Dr</span></span></div>
                <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Payment</span><span className="text-base font-bold text-red-600">{formatCurrency(cashFlowDetails.totalOutflow, {noSuffix: true})} <span className="text-xs">Cr</span></span></div>
                <div className="flex items-baseline justify-between pt-2 mt-2 border-t"><span className="text-sm font-bold">Net Flow</span><span className={cn('text-lg font-bold', (cashFlowDetails.totalInflow - cashFlowDetails.totalOutflow) >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Math.abs(cashFlowDetails.totalInflow - cashFlowDetails.totalOutflow), { noSuffix: true, duration: 2 })} <span className="text-xs">{(cashFlowDetails.totalInflow - cashFlowDetails.totalOutflow) >= 0 ? 'Dr' : 'Cr'}</span></span></div>
                {isReportsEnabled && (
                    <div className="text-right pt-2">
                        <Dialog open={cashFlowOpen} onOpenChange={setCashFlowOpen}>
                            <DialogTrigger asChild><Button variant="link" size="sm" className="h-auto p-0">View Details</Button></DialogTrigger>
                            <DialogContent className="dashboard-financial-popup max-w-6xl p-0 h-[90vh] rounded-lg flex flex-col">
                                <DialogHeader className="p-4 border-b flex flex-row justify-between items-center">
                                    <div className="flex flex-col"><DialogTitle>Cash Flow Details</DialogTitle></div>
                                    <div className="flex items-center gap-2 mr-12">
                                        <MonthYearFilter dateRange={cashFlowDateRange} setDateRange={setCashFlowDateRange} dateSystem={dateSystem} />
                                        <div className="flex bg-muted rounded-md p-1 mr-2 space-x-1">{['all', 'inflow', 'outflow'].map((type) => (<button key={type} onClick={() => setCashFlowFilter(type as any)} className={cn("px-3 py-1 text-xs rounded-sm transition-all capitalize font-medium", cashFlowFilter === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{type}</button>))}</div>
                                        <Button variant="outline" size="sm" onClick={handlePrintCashFlow} className="flex items-center gap-2">Print <Printer className="h-4 w-4" /></Button>
                                    </div>
                                </DialogHeader>
                                <div className="flex flex-1 min-h-0">
                                    <div className="w-64 border-r p-2 space-y-1">
                                        <Button variant={cashFlowCategoryFilter === 'all' ? 'secondary' : 'ghost'} className="w-full justify-start capitalize" onClick={() => setCashFlowCategoryFilter('all')}>All</Button>
                                        <Button variant={cashFlowCategoryFilter === 'party' ? 'secondary' : 'ghost'} className="w-full justify-start capitalize" onClick={() => setCashFlowCategoryFilter('party')}>Party</Button>
                                        <Button variant={cashFlowCategoryFilter === 'staff' ? 'secondary' : 'ghost'} className="w-full justify-start capitalize" onClick={() => setCashFlowCategoryFilter('staff')}>{STAFF_ENTITY_LABEL}</Button>
                                        <Button variant={cashFlowCategoryFilter === 'tax' ? 'secondary' : 'ghost'} className="w-full justify-start capitalize" onClick={() => setCashFlowCategoryFilter('tax')}>Tax</Button>
                                        <Button variant={cashFlowCategoryFilter === 'income_expense' ? 'secondary' : 'ghost'} className="w-full justify-start capitalize" onClick={() => setCashFlowCategoryFilter('income_expense')}>Income / Expense</Button>
                                        <Button variant={cashFlowCategoryFilter === 'other' ? 'secondary' : 'ghost'} className="w-full justify-start capitalize" onClick={() => setCashFlowCategoryFilter('other')}>Other</Button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 flex-1 min-h-0">
                                        {(cashFlowFilter === 'all' || cashFlowFilter === 'inflow') && (
                                            <div className="flex flex-col min-h-0">
                                                <h3 className="text-lg font-semibold mb-2 text-green-600">Inflow</h3>
                                                <div className="flex-1 border rounded-lg flex flex-col min-h-0">
                                                    <ScrollArea className="flex-1 min-w-0">
                                                        <Table className={cn("w-full table-fixed", DASHBOARD_VIEW_DETAILS_TABLE_CN)}>
                                                            <TableBody>
                                                                {orderedCashFlowCategories(cashFlowDetails.categorizedInflow).map(([category, items]) => { 
                                                                    if(cashFlowCategoryFilter !== 'all' && cashFlowCategoryFilter.replace('_', ' / ').toLowerCase() !== category.toLowerCase()) return null; 
                                                                    return ( <React.Fragment key={`in-${category}`}><TableRow className="bg-muted/50"><TableCell colSpan={2} className="font-bold text-xs uppercase">{category.replace('_', ' / ')}</TableCell></TableRow>{items.map((i) => (
                                                                    <TableRow key={i.id}>
                                                                      <TableCell className="pl-6 w-[58%] min-w-0 max-w-[58%] truncate align-middle" title={i.name}>
                                                                        {i.name}
                                                                      </TableCell>
                                                                      <TableCell className="w-[42%] text-right text-green-600 whitespace-nowrap tabular-nums align-middle pr-3 pl-1">
                                                                        {formatCurrency(i.amount, {noSuffix: true})}
                                                                      </TableCell>
                                                                    </TableRow>
                                                                  ))}</React.Fragment> )
                                                                })}
                                                            </TableBody>
                                                        </Table>
                                                    </ScrollArea>
                                                    <div className="p-2 border-t font-bold flex justify-between"><span>Total In</span><span className="text-green-600">{formatCurrency(cashFlowDetails.totalInflow, {noSuffix: true})}</span></div>
                                                </div>
                                            </div>
                                        )}
                                        {(cashFlowFilter === 'all' || cashFlowFilter === 'outflow') && (
                                            <div className="flex flex-col min-h-0">
                                                <h3 className="text-lg font-semibold mb-2 text-red-600">Outflow</h3>
                                                <div className="flex-1 border rounded-lg flex flex-col min-h-0">
                                                    <ScrollArea className="flex-1 min-w-0">
                                                        <Table className={cn("w-full table-fixed", DASHBOARD_VIEW_DETAILS_TABLE_CN)}>
                                                            <TableBody>
                                                                {orderedCashFlowCategories(cashFlowDetails.categorizedOutflow).map(([category, items]) => { 
                                                                    if(cashFlowCategoryFilter !== 'all' && cashFlowCategoryFilter.replace('_', ' / ').toLowerCase() !== category.toLowerCase()) return null; 
                                                                    return ( <React.Fragment key={`out-${category}`}><TableRow className="bg-muted/50"><TableCell colSpan={2} className="font-bold text-xs uppercase">{category.replace('_', ' / ')}</TableCell></TableRow>{items.map((i) => (
                                                                    <TableRow key={i.id}>
                                                                      <TableCell className="pl-6 w-[58%] min-w-0 max-w-[58%] truncate align-middle" title={i.name}>
                                                                        {i.name}
                                                                      </TableCell>
                                                                      <TableCell className="w-[42%] text-right text-red-600 whitespace-nowrap tabular-nums align-middle pr-3 pl-1">
                                                                        {formatCurrency(i.amount, {noSuffix: true})}
                                                                      </TableCell>
                                                                    </TableRow>
                                                                  ))}</React.Fragment> )
                                                                })}
                                                            </TableBody>
                                                        </Table>
                                                    </ScrollArea>
                                                    <div className="p-2 border-t font-bold flex justify-between"><span>Total Out</span><span className="text-red-600">{formatCurrency(cashFlowDetails.totalOutflow, {noSuffix: true})}</span></div>
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
  
            <Card className="col-span-1 transition-colors border-foreground/20">
                <CardHeader className="flex flex-row items-center justify-between p-4 space-y-0">
                    <CardTitle className="text-base whitespace-nowrap">Tax Summary</CardTitle>
                    <MonthYearFilter dateRange={taxDateRange} setDateRange={setTaxDateRange} dateSystem={dateSystem} />
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                    <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Input Tax (Paid)</span><span className="text-sm font-bold text-green-600">{formatCurrency(taxSummary.totalInput, {noSuffix: true})} <span className="text-xs">Dr</span></span></div>
                    <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Output Tax (Liability)</span><span className="text-sm font-bold text-red-600">{formatCurrency(taxSummary.totalOutput, {noSuffix: true})} <span className="text-xs">Cr</span></span></div>
                    <div className="flex items-baseline justify-between pt-2 mt-2 border-t"><span className="text-sm font-bold">Net Balance</span><span className={cn('text-base font-bold', taxSummary.netBalance <= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(taxSummary.netBalance, {showDrCr: true})}</span></div>
                    {isReportsEnabled && (
                        <div className="text-right pt-2">
                             <Dialog open={taxSummaryOpen} onOpenChange={setTaxSummaryOpen}>
                                <DialogTrigger asChild><Button variant="link" size="sm" className="h-auto p-0">View Details</Button></DialogTrigger>
                                <DialogContent className="dashboard-financial-popup max-w-6xl p-0 h-[90vh] rounded-lg flex flex-col">
                                    <DialogHeader className="p-4 border-b flex flex-row justify-between items-center">
                                        <div className="flex flex-col"><DialogTitle>Tax Summary Details</DialogTitle></div>
                                        <div className="flex items-center gap-2 mr-12">
                                            <MonthYearFilter dateRange={taxDateRange} setDateRange={setTaxDateRange} dateSystem={dateSystem} />
                                            <div className="flex bg-muted rounded-md p-1 mr-2 space-x-1">{['all', 'input', 'output'].map((type) => (<button key={type} onClick={() => setTaxFilter(type as any)} className={cn("px-3 py-1 text-xs rounded-sm transition-all capitalize font-medium", taxFilter === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{type}</button>))}</div>
                                            <Button variant="outline" size="sm" onClick={handlePrintTax} className="flex items-center gap-2">Print <Printer className="h-4 w-4" /></Button>
                                        </div>
                                    </DialogHeader>
                                    <div className="flex flex-1 min-h-0">
                                        <div className="w-[300px] border-r flex flex-col min-h-0">
                                            <div className="p-2 font-semibold bg-muted/20 border-b">Tax Heads</div>
                                            <ScrollArea className="flex-1">
                                                {taxSummary.details.map((tax) => (
                                                    <div key={tax.id} onClick={() => setSelectedTaxId(tax.id)} className={cn("p-3 border-b cursor-pointer hover:bg-muted/50 transition-colors flex justify-between items-center", selectedTaxId === tax.id ? "bg-muted" : "")}>
                                                        <span className="font-medium">{tax.name}</span>
                                                        <span className={cn("text-xs font-bold", tax.balance >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Math.abs(tax.balance), {noSuffix: true})} {tax.balance >= 0 ? 'Dr' : 'Cr'}</span>
                                                    </div>
                                                ))}
                                            </ScrollArea>
                                            <div className="p-2 border-t bg-muted/20 text-sm font-bold flex justify-between"><span>Net Balance</span><span className={taxSummary.netBalance >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(taxSummary.netBalance, {showDrCr: true})}</span></div>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 gap-0 min-h-0 divide-x">
                                             <div className="flex flex-col min-h-0">
                                                <h3 className="text-base font-semibold p-3 text-center text-green-600 border-b bg-green-50/50">Input (Paid)</h3>
                                                <ScrollArea className="flex-1">
                                                    <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}>
                                                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Voucher</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Tax</TableHead></TableRow></TableHeader>
                                                        <TableBody>
                                                            {(taxFilter === 'all' || taxFilter === 'input') && taxBreakdownData.inputs.map((tx, i) => (
                                                                <TableRow key={`in-${i}`}>
                                                                    <TableCell className="text-xs">{displayTransactionDate(tx.date)}</TableCell>
                                                                    <TableCell>{tx.voucherNumber}</TableCell>
                                                                    <TableCell>{tx.account}</TableCell>
                                                                    <TableCell className="text-right">{formatCurrency(tx.taxAmount, {noSuffix: true})}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                        <TableFooter>
                                                          <TableRow>
                                                            <TableCell colSpan={3} className="text-right font-bold">Total Input</TableCell>
                                                            <TableCell className="text-right font-bold text-green-600">{formatCurrency(taxBreakdownData.inputs.reduce((s, t) => s + t.taxAmount, 0), {noSuffix: true})}</TableCell>
                                                          </TableRow>
                                                        </TableFooter>
                                                    </Table>
                                                </ScrollArea>
                                            </div>
                                             <div className="flex flex-col min-h-0">
                                                <h3 className="text-base font-semibold p-3 text-center text-red-600 border-b bg-red-50/50">Output (Collected)</h3>
                                                <ScrollArea className="flex-1">
                                                    <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}>
                                                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Voucher</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Tax</TableHead></TableRow></TableHeader>
                                                        <TableBody>
                                                            {(taxFilter === 'all' || taxFilter === 'output') && taxBreakdownData.outputs.map((tx, i) => (
                                                                <TableRow key={`out-${i}`}>
                                                                    <TableCell className="text-xs">{displayTransactionDate(tx.date)}</TableCell>
                                                                    <TableCell>{tx.voucherNumber}</TableCell>
                                                                    <TableCell>{tx.account}</TableCell>
                                                                    <TableCell className="text-right">{formatCurrency(tx.taxAmount, {noSuffix: true})}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                         <TableFooter>
                                                          <TableRow>
                                                            <TableCell colSpan={3} className="text-right font-bold">Total Output</TableCell>
                                                            <TableCell className="text-right font-bold text-red-600">{formatCurrency(taxBreakdownData.outputs.reduce((s, t) => s + t.taxAmount, 0), {noSuffix: true})}</TableCell>
                                                          </TableRow>
                                                        </TableFooter>
                                                    </Table>
                                                </ScrollArea>
                                            </div>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                    )}
                </CardContent>
            </Card>
  
            <Card className="col-span-1 lg:col-span-2 transition-colors border-foreground/20">
                <CardHeader className="flex flex-row items-center justify-between p-4 space-y-0">
                    <CardTitle className="text-base whitespace-nowrap">Stock Summary</CardTitle>
                    <MonthYearFilter dateRange={stockDateRange} setDateRange={setStockDateRange} dateSystem={dateSystem} />
                </CardHeader>
                <CardContent className="p-4 pt-0 flex flex-col min-h-0">
                    <ScrollArea className="flex-1 max-h-[min(55vh,380px)] pr-3 -mr-1">
                        <div className="space-y-6 pb-4">
                            <div className="text-center pt-2">
                                <p className="text-xs text-muted-foreground">Total Stock Value</p>
                                <div className="flex items-center justify-center gap-2">
                                    <p className={cn('text-2xl font-bold whitespace-nowrap', overallStockSummary.totalStockValue >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(overallStockSummary.totalStockValue, {noSuffix: true, duration: 2})}</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div>
                                    <h4 className="text-xs font-semibold mb-2 text-center">Top 5 Sale Items</h4>
                                    <div className="space-y-2">
                                        {overallStockSummary && overallStockSummary.topSaleItems.map((item, index) => (
                                        <div key={`sale-top-${item.id}-${index}`} className="flex justify-between items-center text-sm border-t pt-2 gap-2">
                                            <span className="font-semibold min-w-0 truncate">{item.name}</span>
                                            <div className="text-right shrink-0 whitespace-nowrap">
                                            <p className="font-bold text-green-600">{formatCurrency(item.salesValue, {noSuffix: true, duration: 2})}</p>
                                            <p className="text-xs text-muted-foreground">{item.salesQty.toFixed(2)} {item.smallestUnit}</p>
                                            </div>
                                        </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold mb-2 text-center">Top 5 Purchase Items</h4>
                                    <div className="space-y-2">
                                        {overallStockSummary && overallStockSummary.topPurchaseItems.map((item, index) => (
                                        <div key={`purchase-top-${item.id}-${index}`} className="flex justify-between items-center text-sm border-t pt-2 gap-2">
                                            <span className="font-semibold min-w-0 truncate">{item.name}</span>
                                            <div className="text-right shrink-0 whitespace-nowrap">
                                            <p className="font-bold text-red-600">{formatCurrency(item.purchaseValue, {noSuffix: true, duration: 2})}</p>
                                            <p className="text-xs text-muted-foreground">{item.purchaseQty.toFixed(2)} {item.smallestUnit}</p>
                                            </div>
                                        </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ScrollArea>
                    {isReportsEnabled && (
                        <div className="text-right pt-2">
                            <Dialog open={stockSummaryOpen} onOpenChange={setStockSummaryOpen}>
                                <DialogTrigger asChild><Button variant="link" size="sm" className="h-auto p-0">View Details</Button></DialogTrigger>
                                <DialogContent 
                                    className="dashboard-financial-popup max-w-4xl p-0 h-[90vh] rounded-lg flex flex-col"
                                    onInteractOutside={(e) => {
                                        const target = e.target as HTMLElement;
                                        // Prevent closing when clicking on Popover or Select dropdowns
                                        if (
                                            target.closest('[data-radix-popper-content-wrapper]') ||
                                            target.closest('[data-radix-popover-content]') ||
                                            target.closest('[role="dialog"]') ||
                                            target.closest('[data-radix-select-content]') ||
                                            target.closest('[data-radix-select-viewport]') ||
                                            document.querySelector('[data-radix-popover-content]')?.contains(target)
                                        ) {
                                            e.preventDefault();
                                        }
                                    }}
                                    onPointerDownOutside={(e) => {
                                        const target = e.target as HTMLElement;
                                        // Prevent closing when clicking on Popover or Select dropdowns
                                        if (
                                            target.closest('[data-radix-popper-content-wrapper]') ||
                                            target.closest('[data-radix-popover-content]') ||
                                            target.closest('[role="dialog"]') ||
                                            target.closest('[data-radix-select-content]') ||
                                            target.closest('[data-radix-select-viewport]') ||
                                            document.querySelector('[data-radix-popover-content]')?.contains(target)
                                        ) {
                                            e.preventDefault();
                                        }
                                    }}
                                >
                                    <DialogHeader className="p-4 border-b flex flex-row justify-between items-center">
                                        <div className="flex flex-col"><DialogTitle>Stock Summary Details</DialogTitle></div>
                                        <div 
                                            className="flex items-center gap-2 mr-12" 
                                            onClick={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                        >
                                            <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                                                <MonthYearFilter dateRange={stockDateRange} setDateRange={setStockDateRange} dateSystem={dateSystem} />
                                            </div>
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePrintStock();
                                                }} 
                                                className="flex items-center gap-2"
                                            >
                                                Print <Printer className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </DialogHeader>
                                    <div className="flex-1 p-4 flex flex-col min-h-0 min-w-0">
                                        <div className="border rounded-lg flex-1 flex flex-col min-h-0 min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain">
                                            <div className="min-w-max">
                                            <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}><TableHeader><TableRow><TableHead>Item Name</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader></Table>
                                                <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}>
                                                    <TableBody>
                                                        {overallStockSummary.items.map((item, i) => ( <TableRow key={i}><TableCell className="font-medium whitespace-nowrap">{item.name}</TableCell><TableCell className="text-right whitespace-nowrap">{item.qty.toFixed(2)} {item.unit}</TableCell><TableCell className="text-right whitespace-nowrap">{formatCurrency(item.rate, {noSuffix: true})}</TableCell><TableCell className="text-right font-bold whitespace-nowrap">{formatCurrency(item.value, {noSuffix: true})}</TableCell></TableRow> ))}
                                                    </TableBody>
                                                </Table>
                                            <Table className={DASHBOARD_VIEW_DETAILS_TABLE_CN}><TableFooter><TableRow><TableCell className="font-bold whitespace-nowrap" colSpan={3}>Total Stock Value</TableCell><TableCell className="text-right font-bold text-green-600 whitespace-nowrap">{formatCurrency(overallStockSummary.totalStockValue, {noSuffix: true})}</TableCell></TableRow></TableFooter></Table>
                                            </div>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                    )}
                </CardContent>
            </Card>
  
        {can("view_voucher_type_summaries") && stats.otherStats.map((stat) => {
            const deepHref = dashboardStatCardReportHref(stat.type);
            const canClickTxns =
              !!deepHref && (deepHref.startsWith("/reports") ? can("export_data") : true);
            return (
            <Card key={stat.type} className="hover:bg-muted/50 transition-colors border-foreground/20">
              <CardHeader className="p-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm whitespace-nowrap">{stat.title}</CardTitle>
                  <stat.icon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-3 pt-0">
                  {/* Journal-style debit total sirf journal / add_salary / contra */}
                  {stat.type === 'journal' || stat.type === 'add_salary' || stat.type === 'contra' ? (
                      <div className='text-xl font-bold text-blue-600'>{formatCurrency(stat.total, { noSuffix: true, duration: 2 })}</div>
                  ) : (
                      <div className={cn('text-xl font-bold', stat.isCredit ? 'text-green-600' : 'text-red-600')}>
                          {formatCurrency(stat.total, { noSuffix: true, duration: 2 })}
                      </div>
                  )}
                  {canClickTxns ? (
                    <DashboardStatCardTxnLink
                      href={deepHref}
                      // Dashboard quick-jump labels: blue link treatment so users can identify click target.
                      className="text-xs text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded inline-block mt-0.5 text-left"
                    >
                      {stat.count} transaction(s)
                    </DashboardStatCardTxnLink>
                  ) : (
                    <p className="text-xs text-muted-foreground">{stat.count} transaction(s)</p>
                  )}
              </CardContent>
            </Card>
          );})}
  
        {can("view_entity_counts_summary") && (
          <>
            <Card className="border-foreground/20"><CardHeader className="p-3"><CardTitle className="text-sm whitespace-nowrap">Total Parties</CardTitle></CardHeader><CardContent className="p-3 pt-0 text-2xl font-bold">{processedParties.length}</CardContent></Card>
            <Card className="border-foreground/20"><CardHeader className="p-3"><CardTitle className="text-sm whitespace-nowrap">Total Staff</CardTitle></CardHeader><CardContent className="p-3 pt-0 text-2xl font-bold">{processedStaff.length}</CardContent></Card>
            <Card className="border-foreground/20"><CardHeader className="p-3"><CardTitle className="text-sm whitespace-nowrap">Bank/Cash Acc</CardTitle></CardHeader><CardContent className="p-3 pt-0 text-2xl font-bold">{processedAccounts.length}</CardContent></Card>
            <Card className="border-foreground/20"><CardHeader className="p-3"><CardTitle className="text-sm whitespace-nowrap">Total Items</CardTitle></CardHeader><CardContent className="p-3 pt-0 text-2xl font-bold">{processedItems.length}</CardContent></Card>
            <Card className="border-foreground/20"><CardHeader className="p-3"><CardTitle className="text-sm whitespace-nowrap">Total Vouchers</CardTitle></CardHeader><CardContent className="p-3 pt-0 text-2xl font-bold">{vouchers.length}</CardContent></Card>
          </>
        )}
      </div>
    );
  }
  
  const renderRecentTransactions = () => (
    <div className={cn(isMobile && "mx-0.5")}>
    <Card className={cn("border-2 border-foreground/20", isMobile && "px-0")}>
      <CardHeader className={cn(isMobile && "px-0.5")}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 min-h-9 w-full">
            <CardTitle className="shrink-0 text-left text-lg font-semibold leading-none">
              Recent Transactions
            </CardTitle>
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
            {isRecentFilterActive && (
              <Button variant="ghost" size="sm" onClick={clearRecentFilters}>
                <XCircle className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            )}
            <div className="min-w-[0.5rem] flex-1" />
            <div className={cn("flex items-center space-x-2 shrink-0", isMobile ? "order-1" : "md:order-2")}>
            {(dateSystem === 'BS' || dateSystem === 'Both') && (
                <BsDatePicker
                  isRange
                  valueAD={recentDateRange}
                  onChangeAD={(range) => setRecentDateRange(range as DateRange | undefined)}
                  transactionDates={transactionDates}
                  hideTriggerIcon={isMobile}
                  rangeEmptyLabel={isMobile ? "Change date" : undefined}
                />
            )}
            {(dateSystem === 'AD' || dateSystem === 'Both') && (
                <Popover>
                    <PopoverTrigger asChild>
                    <Button id="recent-date" variant={"outline"} className={cn("w-auto justify-start text-left font-normal h-9", !recentDateRange && "text-muted-foreground")}>
                        {!isMobile && <CalendarIcon className="mr-2 h-4 w-4" />}
                        {recentDateRange?.from ? (recentDateRange.to ? <>{format(recentDateRange.from, "LLL dd, y")} - {format(recentDateRange.to, "LLL dd, y")}</> : format(recentDateRange.from, "LLL dd, y")) : (<span>{isMobile ? "Change date" : "Date range"}</span>)}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                    <Calendar initialFocus mode="range" defaultMonth={recentDateRange?.from} selected={asCalendarRange(recentDateRange)} onSelect={setRecentDateRange} numberOfMonths={calendarMonths} modifiers={{ hasTransactions: transactionDates }} modifiersClassNames={{ hasTransactions: 'has-transactions' }} />
                    </PopoverContent>
                </Popover>
            )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={cn(isMobile && "px-0")}
        {...(isMobile ? { "data-pl-mobile-txn-host": "" } : {})}
      >
        <div className={cn("pt-0", isMobile ? "px-0" : "p-4 sm:p-6 md:p-8")}>
        <TransactionsTable
          transactions={recentTransactions}
          context="daybook"
          mobileCardLayoutLikeParty={isMobile}
          onRowClick={(v) => {
            setSelectedVoucher(v);
            setIsVoucherDialogOpen(true);
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
        />
        {isMobile ? (
          <MobileTransactionsPager
            className="px-2 pt-2"
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
        ) : (
          <LedgerDesktopFooter
            shellClassName="border-t border-blue-300/60 bg-blue-100/80 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8"
            left={
              <>
                <LedgerFooterCheckboxPill
                  id="show-narration-recent-legacy"
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
                            id={`col-${key}-recent-legacy`}
                            checked={visibleColumns[key] !== false}
                            onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                          />
                          <label
                            htmlFor={`col-${key}-recent-legacy`}
                            className="text-sm font-medium flex-1 cursor-pointer"
                          >
                            {COLUMN_LABELS[key]}
                          </label>
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </LedgerFooterColumnsMenu>
                <LedgerFooterCheckboxPill
                  id="show-notes-recent-legacy"
                  checked={includeNotesInTable}
                  disabled={notesPreferenceLockedOnMobile}
                  onCheckedChange={(c) => setShowNotes(Boolean(c))}
                  label="Note"
                />
              </>
            }
            sortBy="date"
            sortOrder={recentSortOrder}
            onSortChange={(_by, order) => {
              setRecentSortOrder(order);
              setRecentCurrentPage(1);
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
        )}
        </div>
      </CardContent>
    </Card>
    </div>
  );

  const renderDashboardCharts = () => {
    // Dashboard chart mirrors current stat-card totals/counts so tab numbers and chart stay in sync.
    const chartData = stats.otherStats.map((s) => ({
      name: s.title,
      amount: Number(s.total || 0),
      txns: Number(s.count || 0),
    }));

    return (
      <Card className="border-foreground/20">
        <CardHeader className="p-3 pb-2">
          {/* Clear heading helps users identify this is visual summary of same dashboard cards. */}
          <CardTitle className="text-sm">Voucher Summary Chart</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={55} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number, key: string) =>
                    key === "amount"
                      ? [formatCurrency(value, { noSuffix: true, duration: 2 }), "Amount"]
                      : [String(value), "Transactions"]
                  }
                />
                <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderDashboardContent = () => {
    const shouldShow = (cardId: string) => visibleCard === 'all' || visibleCard === cardId;

    return (
    <div className="space-y-0.5">
      {shouldShow('financial-summaries') && renderFinancialSummaries(isReportsEnabled)}
      {shouldShow('dashboard-charts') && renderDashboardCharts()}
      {shouldShow('bank-cash-summary') && can('view_bank_cash_summary') && <BankCashSummary />}
      {shouldShow('daybook') && can('view_daybook') && <div className="px-0.5"><DaybookReport /></div>}
      {shouldShow('recent-transactions') && can('view_recent_transactions') && renderRecentTransactions()}
    </div>
  );
  }
  
  if (vouchersLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="w-full h-32" />
        <Skeleton className="w-full h-64" />
      </div>
    );
  }

  const dashboardCards = [
    { id: 'all', title: 'All' },
    { id: 'financial-summaries', title: 'Summary' },
    { id: 'dashboard-charts', title: 'Chart' },
    { id: 'bank-cash-summary', title: 'Bank' },
    { id: 'daybook', title: 'Daybook' },
    { id: 'recent-transactions', title: 'Recent' },
  ];

  const legacyDashboardTabFooterPx = isMobile ? 68 : 72;
  const legacyWelcomeFooterReservePx = dashboardWelcomeFooterReservePx(newYearInfo);

  return (
    <div
      className="p-0.5"
      style={{ paddingBottom: legacyDashboardTabFooterPx + legacyWelcomeFooterReservePx }}
    >
      <div className="p-0">
        {renderDashboardContent()}
      </div>

      <div
        className="fixed left-0 right-0 z-[46] box-border p-0.5 md:left-64"
        style={{ bottom: `${legacyDashboardTabFooterPx}px` }}
        data-pl-dashboard-welcome-footer=""
      >
        <DashboardWelcomeFooterBanner
          greeting={greeting}
          displayName={user?.displayName || user?.email || ""}
          newYearInfo={newYearInfo}
        />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 p-0.5 md:left-64">
        {/* User request: footer tabs ek hi green container me, row-layout labels ke saath */}
        <div className="pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald flex h-16 items-stretch justify-center gap-0.5 p-2">
          {dashboardCards.map((card) => {
            const Icon =
              card.id === "all"
                ? Home
                : card.id === "financial-summaries"
                  ? TrendingUp
                  : card.id === "dashboard-charts"
                    ? BarChart3
                  : card.id === "daybook"
                    ? FileTextIcon
                    : card.id === "bank-cash-summary"
                      ? Landmark
                      : History;
            return (
              <Button
                key={card.id}
                variant="ghost"
                className={cn(
                  // Desktop/PC: icon left + label right in same row; mobile: icon hide, text center
                  "h-full min-h-[3.25rem] min-w-0 flex-1 rounded-md border-2 border-emerald-200/65 bg-white/55 px-2 py-1 text-muted-foreground dark:border-emerald-800/45 dark:bg-background/35",
                  isMobile ? "justify-center text-center" : "justify-center flex-row items-center gap-1.5",
                  visibleCard === card.id && "border-primary/45 bg-primary/15 text-primary shadow-sm hover:bg-primary/12"
                )}
                onClick={() => setVisibleCard(card.id)}
              >
                {!isMobile && <Icon className="h-4.5 w-4.5 shrink-0" />}
                <span className="text-[10px] font-medium leading-tight sm:text-xs">{card.title}</span>
              </Button>
            );
          })}
        </div>
      </div>
       <AddVoucherDialog 
          isOpen={isVoucherDialogOpen}
          onOpenChange={setIsVoucherDialogOpen}
          voucher={selectedVoucher}
          onVoucherAction={() => setSelectedVoucher(null)}
       />
    </div>
  );
}
