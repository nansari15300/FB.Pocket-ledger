
"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableCaption,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportPageExpandButton } from "@/components/reports/ReportPageExpandButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpDown, Search, Loader2, ChevronDown, ChevronRight, ChevronUp, Printer, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { TransactionsTable } from "../vouchers/TransactionsTable";
import { useCompany } from "@/hooks/useCompany";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useDate } from "@/hooks/useDate";
import { openPrintDirect } from "@/lib/printDirect";
import { cn } from "@/lib/utils";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import AdCalendar from "@/components/ui/ad-calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "@/components/ui/ad-calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { startOfDay, endOfDay } from "date-fns";
import { useTransactions } from "@/hooks/use-transactions";
import { getFiscalRangeForCountry } from "@/lib/fiscalRange";
import { useReportPage } from "@/contexts/ReportPageContext";
import { useRouter } from "next/navigation";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";

/**
 * TYPES
 */
type ProfitLossRow = {
  id: string;
  name: string;
  category: "Income" | "Expense";
  amount: number;
  isGroup: boolean;
  parentId?: string;
  subRows: ProfitLossRow[];
  level?: number;
  parentGroupName?: string;
  subGroupName?: string;
  accountId?: string;
  transactions?: any[];
  /** Column value: debit side amount for variant-wise table rendering. */
  debit?: number;
  /** Column value: credit side amount for variant-wise table rendering. */
  credit?: number;
  /** Column value: signed P&L amount (credit - debit) for row. */
  plAmount?: number;
  /** Detail dialog context for non-ledger variants (party-wise / bill-wise). */
  detailContext?: "expense" | "party" | "daybook";
  /** Detail dialog context id matching detailContext when available. */
  detailContextId?: string;
  /** Detail dialog rows for variant-based reports that don't use account ledger hook. */
  detailTransactions?: any[];
};

type ReportVariant = "income-exp" | "party-wise" | "bill-wise";
type ProfitLossMobileFilter =
  | "default"
  | "name"
  | "date"
  | "by_bill_no"
  | "high_to_low"
  | "low_to_high";

/**
 * HELPERS
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNepaliCurrency = (n: number) =>
  n === 0
    ? "-"
    : new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);

/**
 * GROUP ROW COMPONENT
 */
function GroupRow({
  row,
  level = 0,
  expandedGroups,
  toggleGroup,
  onRowClick,
  parentGroupName,
  subGroupName,
  reportVariant,
}: {
  row: ProfitLossRow;
  level?: number;
  expandedGroups: Set<string>;
  toggleGroup: (id: string) => void;
  onRowClick: (row: ProfitLossRow) => void;
  parentGroupName?: string;
  subGroupName?: string;
  reportVariant: ReportVariant;
}) {
  const isExpanded = expandedGroups.has(row.id);
  const hasSubRows = row.subRows.length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasSubRows) {
      toggleGroup(row.id);
    }
  };

  const handleRowClick = () => {
    if (row.isGroup && hasSubRows) {
      toggleGroup(row.id);
    } else {
      onRowClick(row);
    }
  };

  // One place for row-level amount semantics across income-exp / party / bill views.
  const rowDebit = Number(row.debit ?? (row.category === "Expense" ? row.amount : 0)) || 0;
  const rowCredit = Number(row.credit ?? (row.category === "Income" ? row.amount : 0)) || 0;
  const rowPL =
    Number(row.plAmount ?? (row.category === "Income" ? row.amount : -row.amount)) || 0;
  const rowPLClass = rowPL >= 0 ? "text-green-600" : "text-red-600";
  const hideGroupAmountsWhenExpanded =
    reportVariant === "income-exp" && row.isGroup && isExpanded;

  return (
    <>
      <TableRow
        className={cn(
          // Zebra-style light tint for all rows so report grid feels softer and easier to scan.
          "cursor-pointer transition-colors odd:bg-slate-50/70 even:bg-blue-50/40 dark:odd:bg-slate-900/30 dark:even:bg-blue-950/20",
          "hover:bg-muted/60",
          level > 0 && "bg-muted/30"
        )}
        onClick={handleRowClick}
      >
        {reportVariant === "bill-wise" ? (
          <>
            <TableCell className="font-medium w-[46%] max-w-0">
              <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 20}px` }}>
                {/* Full text accessibility: desktop hover + mobile long-press via native title tooltip. */}
                <span className="truncate" title={row.name}>{row.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-sm text-green-600">
              {rowDebit > 0 ? toNepaliCurrency(rowDebit) : "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-sm text-red-600">
              {rowCredit > 0 ? toNepaliCurrency(rowCredit) : "-"}
            </TableCell>
            <TableCell className={cn("text-right tabular-nums font-semibold whitespace-nowrap text-xs sm:text-sm", rowPLClass)}>
              {toNepaliCurrency(Math.abs(rowPL))}
            </TableCell>
          </>
        ) : reportVariant === "party-wise" ? (
          <>
            <TableCell className="font-medium w-[46%] max-w-0">
              <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 20}px` }}>
                {/* Full text accessibility: desktop hover + mobile long-press via native title tooltip. */}
                <span className="truncate" title={row.name}>{row.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-sm text-green-600">{rowDebit > 0 ? toNepaliCurrency(rowDebit) : "-"}</TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-sm text-red-600">{rowCredit > 0 ? toNepaliCurrency(rowCredit) : "-"}</TableCell>
            <TableCell className={cn("text-right tabular-nums font-semibold whitespace-nowrap text-[11px] sm:text-sm", rowPLClass)}>
              {toNepaliCurrency(Math.abs(rowPL))}
            </TableCell>
          </>
        ) : (
          <>
            <TableCell className="font-medium w-[66%] max-w-0">
              <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 20}px` }}>
                {row.isGroup && hasSubRows && (
                  <button
                    onClick={handleToggle}
                    className="p-0.5 hover:bg-muted rounded"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                )}
                {row.isGroup && !hasSubRows && <div className="w-5" />}
                {/* Expanded accounts render in same first column with small text + 10px indent. */}
                <span
                  className={cn(
                    "block pr-[10px]",
                    row.isGroup
                      ? "text-sm font-medium text-foreground"
                      : "pl-0 text-xs font-normal text-muted-foreground text-left truncate"
                  )}
                  title={row.name}
                >
                  {row.name}
                </span>
              </div>
            </TableCell>
            {/* Expanded group rows: hide amount cells so only child account rows show amounts. */}
            <TableCell className="text-right tabular-nums text-green-600 whitespace-nowrap text-[11px] sm:text-sm">{hideGroupAmountsWhenExpanded ? "-" : (rowDebit > 0 ? toNepaliCurrency(rowDebit) : "-")}</TableCell>
            <TableCell className="text-right tabular-nums text-red-600 whitespace-nowrap text-[11px] sm:text-sm">{hideGroupAmountsWhenExpanded ? "-" : (rowCredit > 0 ? toNepaliCurrency(rowCredit) : "-")}</TableCell>
            <TableCell className={cn("text-right tabular-nums font-semibold whitespace-nowrap text-[11px] sm:text-sm", rowPLClass)}>
              {hideGroupAmountsWhenExpanded ? "-" : toNepaliCurrency(Math.abs(rowPL))}
            </TableCell>
          </>
        )}
      </TableRow>
      {row.isGroup && isExpanded && hasSubRows && (
        <>
          {row.subRows.map((subRow) => (
            <GroupRow
              key={subRow.id}
              row={subRow}
              level={level + 1}
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
              onRowClick={onRowClick}
              parentGroupName={parentGroupName}
              subGroupName={subGroupName}
              reportVariant={reportVariant}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * MAIN PROFIT & LOSS PAGE COMPONENT
 */
export function ProfitAndLossPage({
  reportLabel,
  reportVariant = "income-exp",
}: {
  reportLabel?: string;
  reportVariant?: ReportVariant;
} = {}) {
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const {
    vouchers,
    loading,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedParties,
    processedItems,
    userNames,
  } = useFyScopedVouchers();
  const { companyId, company } = useCompany();

  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const [entityFilter, setEntityFilter] = useState<"all" | "Income" | "Expense">("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [activeRow, setActiveRow] = useState<ProfitLossRow | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [mobileFilter, setMobileFilter] = useState<ProfitLossMobileFilter>("default");
  const [isFooterCalendarOpen, setIsFooterCalendarOpen] = useState(false);
  /** Mobile main table: party-report jaisa pager — detail dialog `rowsPerPage` se alag taaki dono conflict na karein. */
  const [plMobileMainPage, setPlMobileMainPage] = useState(1);
  const [plMobileMainRowsPerPage, setPlMobileMainRowsPerPage] = useState(20);

  const router = useRouter();
  const { onBackToReportList } = useReportPage();

  React.useEffect(() => {
    /* `ReportDetails` ab key se remount karta hai; yeh company/variant switch defence (same report id edge) */
    setQuery("");
  }, [reportVariant, companyId]);

  const { dateSystem, formatDate, formatDateBS } = useDate();
  const activeRangeLabel = useMemo(() => {
    // Date label should follow selected system: AD / BS / Both.
    if (!dateRange?.from || !dateRange?.to) return "Current FY";
    if (dateSystem === "BS") return `${formatDateBS(dateRange.from)} - ${formatDateBS(dateRange.to)}`;
    if (dateSystem === "Both") {
      return `${formatDate(dateRange.from)} - ${formatDate(dateRange.to)} | ${formatDateBS(dateRange.from)} - ${formatDateBS(dateRange.to)}`;
    }
    return `${formatDate(dateRange.from)} - ${formatDate(dateRange.to)}`;
  }, [dateRange, dateSystem, formatDate, formatDateBS]);
  React.useEffect(() => {
    // Bill-wise should default to bill-number ordering; others keep normal default mode.
    setMobileFilter(reportVariant === "bill-wise" ? "by_bill_no" : "default");
  }, [reportVariant]);
  React.useEffect(() => {
    // Default date range should be current FY for selected company country.
    const { start, end } = getFiscalRangeForCountry(company?.country || "Nepal");
    setDateRange({ from: startOfDay(start), to: endOfDay(end) });
  }, [company?.country, reportVariant]);

  const filteredVouchers = useMemo(() => {
    // Keep date filter behavior consistent across income-exp, party-wise, and bill-wise variants.
    const inDateRange = (tx: any) => {
      const txDateRaw = tx?.date;
      const txDate =
        txDateRaw && typeof txDateRaw.toDate === "function"
          ? txDateRaw.toDate()
          : txDateRaw
            ? new Date(txDateRaw)
            : null;
      if (!txDate || Number.isNaN(txDate.getTime())) return false;
      if (!dateRange?.from) return true;
      const from = startOfDay(dateRange.from);
      const to = endOfDay(dateRange.to || dateRange.from);
      return txDate >= from && txDate <= to;
    };
    return vouchers.filter(inDateRange);
  }, [vouchers, dateRange]);

  // Build report rows by selected report variant while preserving the same table/dialog UI shell.
  const profitLossData = useMemo((): ProfitLossRow[] => {
    if (reportVariant === "party-wise") {
      const partyNameById = new Map(processedParties.map((p) => [p.id, p.name]));
      const itemPurchaseRateById = new Map<string, number>(
        processedItems.map((it: any) => [
          String(it.id),
          Number(it.purchasePrice ?? it.openingBalanceRate ?? 0) || 0,
        ])
      );
      const map = new Map<
        string,
        { id: string; name: string; debit: number; credit: number; tx: any[] }
      >();
      filteredVouchers.forEach((v) => {
        // Party-wise real P&L: only sale vouchers; exclude payment/opening flows.
        if (String(v.type || "").toLowerCase() !== "sale") return;
        const partyId = String(v.partyId || "unknown-party");
        const upsertParty = (id: string, displayName?: string) =>
          map.get(id) || {
            id,
            name: String(displayName || partyNameById.get(id) || "Unknown Party"),
            debit: 0,
            credit: 0,
            tx: [],
          };
        if (!partyId || partyId === "unknown-party") return;
        const current = upsertParty(partyId, v.partyName);
        const saleAmount = Number(v.total ?? v.amount ?? 0) || 0;
        const purchaseCost = Array.isArray(v.lineItems)
          ? v.lineItems.reduce((sum: number, li: any) => {
              const qty = Number(li?.quantity ?? 0) || 0;
              const directAmount = Number(li?.purchaseAmount ?? li?.costAmount ?? 0) || 0;
              if (directAmount > 0) return sum + directAmount;
              const fallbackRate =
                Number(li?.purchaseRate ?? li?.costPrice ?? 0) ||
                itemPurchaseRateById.get(String(li?.itemId || "")) ||
                0;
              return sum + qty * fallbackRate;
            }, 0)
          : 0;
        // Party-wise requested columns: Dr=sales, Cr=underlying purchase/production item cost.
        current.debit += round2(saleAmount);
        current.credit += round2(purchaseCost);
        current.tx.push(v);
        map.set(partyId, current);
      });
      return Array.from(map.values()).map((entry) => {
        // Party-wise P&L convention: Dr (sale) - Cr (purchase/production cost).
        const net = entry.debit - entry.credit;
        return {
          id: `party-${entry.id}`,
          name: entry.name,
          category: net >= 0 ? "Income" : "Expense",
          amount: Math.abs(net),
          // Party-wise columns: Dr = sales side, Cr = purchase/production cost, P&L = Dr - Cr.
          debit: round2(entry.debit),
          credit: round2(entry.credit),
          plAmount: round2(net),
          isGroup: false,
          subRows: [],
          detailContext: "party",
          detailContextId: entry.id,
          detailTransactions: entry.tx,
        } as ProfitLossRow;
      });
    }
    if (reportVariant === "bill-wise") {
      const itemPurchaseRateById = new Map<string, number>(
        processedItems.map((it: any) => [
          String(it.id),
          Number(it.purchasePrice ?? it.openingBalanceRate ?? 0) || 0,
        ])
      );
      return filteredVouchers
        // Bill-wise request: keep only sale-side bills; guard against purchase-like rows.
        .filter((v) => {
          const type = String(v.type || "").toLowerCase();
          const voucherNo = String(v.voucherNumber || v.billNumber || "").toUpperCase();
          const isSaleType = type === "sale" || type.includes("sale");
          const looksPurchaseVoucher = voucherNo.startsWith("PUR");
          return isSaleType && !type.includes("purchase") && !looksPurchaseVoucher;
        })
        .map((v) => {
          const voucherNo = String(v.voucherNumber || v.billNumber || v.type || "Bill");
          const saleAmount = Number(v.total ?? v.amount ?? 0) || 0;
          // Cost side (Cr): line-item purchase/production cost used for bill P&L view.
          const purchaseCost = Array.isArray(v.lineItems)
            ? v.lineItems.reduce((sum: number, li: any) => {
                const qty = Number(li?.quantity ?? 0) || 0;
                const directAmount = Number(li?.purchaseAmount ?? li?.costAmount ?? 0) || 0;
                if (directAmount > 0) return sum + directAmount;
                const fallbackRate =
                  Number(li?.purchaseRate ?? li?.costPrice ?? 0) ||
                  itemPurchaseRateById.get(String(li?.itemId || "")) ||
                  0;
                return sum + qty * fallbackRate;
              }, 0)
            : 0;
          const drAmount = round2(saleAmount);
          const crAmount = round2(purchaseCost);
          const net = drAmount - crAmount;
          return {
            id: `bill-${String(v.id || v.voucherNo || voucherNo)}`,
            // Bill-wise first column should remain bill-centric.
            name: voucherNo,
            category: net >= 0 ? "Income" : "Expense",
            amount: Math.abs(net),
            // Bill-wise accounting columns requested: Dr=sale amount, Cr=item purchase/production cost.
            debit: drAmount,
            credit: crAmount,
            plAmount: round2(net),
            isGroup: false,
            subRows: [],
            detailContext: "daybook",
            detailContextId: undefined,
            detailTransactions: [v],
          } as ProfitLossRow;
        });
    }

    // Income-exp mode: original account/group hierarchy remains unchanged.
    // 1. Gather all individual accounts
    // Note: processedExpenseAccounts.balance already includes openingBalance: balance = openingBalance + debit - credit
    const allAccounts: ProfitLossRow[] = processedExpenseAccounts
      .map(acc => {
        // Use balance which already includes openingBalance
        // For Income accounts: balance = openingBalance + credit - debit (positive = income)
        // For Expense accounts: balance = openingBalance + debit - credit (positive = expense)
        const balance = acc.balance || 0;
        const amount = Math.abs(balance);
        
        // Include accounts with non-zero balance OR non-zero opening balance
        const openingBalance = Number((acc as any).openingBalance) || 0;
        if (amount <= 0.01 && Math.abs(openingBalance) <= 0.01) return null;
        
        // Determine category based on balance sign
        // Positive balance for income accounts (credit > debit), negative for expense accounts (debit > credit)
        // But we need to check the account type or group to determine if it's income or expense
        const isIncomeAccount = acc.id === 'sales_account' || 
          (acc.groupId && processedExpenseGroups.some(g => 
            g.id === acc.groupId && ((g as any).type === 'Income' || g.id === 'direct_income' || g.id === 'indirect_income')
          ));
        
        return {
          id: acc.id,
          name: acc.name,
          category: isIncomeAccount ? 'Income' : 'Expense',
          amount: amount,
          // Income/expense columns: expense as Dr, income as Cr, and signed P&L.
          debit: isIncomeAccount ? 0 : amount,
          credit: isIncomeAccount ? amount : 0,
          plAmount: isIncomeAccount ? amount : -amount,
          isGroup: false,
          parentId: acc.groupId,
          subRows: [],
          accountId: acc.id,
        } as ProfitLossRow;
      })
      .filter((acc): acc is ProfitLossRow => acc !== null);

    // 2. Gather all groups
    const allGroups: ProfitLossRow[] = processedExpenseGroups.map(g => ({
      id: g.id,
      name: g.name,
      category: (g as any).type === 'Income' ? 'Income' : 'Expense',
      amount: 0, // Will be calculated
      debit: 0,
      credit: 0,
      plAmount: 0,
      isGroup: true,
      parentId: g.parentId,
      subRows: [],
    }));

    // 3. Build the tree
    const itemsMap = new Map<string, ProfitLossRow>();
    allGroups.forEach(g => itemsMap.set(g.id, { ...g, subRows: [] }));
    allAccounts.forEach(a => itemsMap.set(a.id, { ...a, subRows: [] }));

    const rootItems: ProfitLossRow[] = [];
    itemsMap.forEach(item => {
      const parentId = item.parentId;
      if (parentId && itemsMap.has(parentId)) {
        itemsMap.get(parentId)!.subRows.push(item);
      } else {
        rootItems.push(item);
      }
    });

    // 4. Calculate group totals recursively
    const calculateTotals = (item: ProfitLossRow): number => {
      if (!item.isGroup) {
        return Number(item.plAmount ?? 0);
      }

      let totalPL = 0;
      let totalDebit = 0;
      let totalCredit = 0;
      item.subRows.forEach(subItem => {
        totalPL += calculateTotals(subItem);
        totalDebit += Number(subItem.debit ?? 0);
        totalCredit += Number(subItem.credit ?? 0);
      });

      // Group row should show grouped amount even after expand (requested behavior).
      item.debit = round2(totalDebit);
      item.credit = round2(totalCredit);
      item.plAmount = round2(totalPL);
      item.amount = round2(Math.abs(totalPL));
      return totalPL;
    };
    
    rootItems.forEach(calculateTotals);

    // 5. Filter out empty groups
    const processHierarchy = (items: ProfitLossRow[]): ProfitLossRow[] => {
      return items.map(item => {
        if (item.isGroup) {
          item.subRows = processHierarchy(item.subRows);
        }
        return item;
      }).filter(item => {
        return !item.isGroup || item.subRows.length > 0 || item.amount > 0.01;
      });
    };

    const finalHierarchy = processHierarchy(rootItems);
    
    // Sort children within each group alphabetically
    const sortRows = (rows: ProfitLossRow[]) => {
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      rows.forEach(row => { if (row.isGroup) sortRows(row.subRows); });
    };
    sortRows(finalHierarchy);
    
    return finalHierarchy;
  }, [reportVariant, filteredVouchers, processedExpenseAccounts, processedExpenseGroups, processedParties, processedItems]);

  // Filter and sort
  const filtered = useMemo(() => {
    let filteredData = [...profitLossData];

    // Apply entity filter
    if (entityFilter !== "all") {
      const filterByCategory = (items: ProfitLossRow[]): ProfitLossRow[] => {
        return items
          .map(item => {
            if (item.isGroup) {
              const filteredSubRows = filterByCategory(item.subRows);
              if (filteredSubRows.length === 0 && item.category !== entityFilter) {
                return null;
              }
              return { ...item, subRows: filteredSubRows };
    } else {
              return item.category === entityFilter ? item : null;
            }
          })
          .filter((item): item is ProfitLossRow => item !== null);
      };
      filteredData = filterByCategory(filteredData);
    }

    // Apply search query
    if (query) {
      const searchInItems = (items: ProfitLossRow[]): ProfitLossRow[] => {
        return items
          .map(item => {
            const matchesQuery = 
              item.name.toLowerCase().includes(query.toLowerCase()) ||
              item.category.toLowerCase().includes(query.toLowerCase());
            
            if (item.isGroup) {
              const filteredSubRows = searchInItems(item.subRows);
              if (filteredSubRows.length > 0 || matchesQuery) {
                return { ...item, subRows: filteredSubRows };
              }
              return null;
            } else {
              return matchesQuery ? item : null;
            }
          })
          .filter((item): item is ProfitLossRow => item !== null);
      };
      filteredData = searchInItems(filteredData);
    }

    const rowDateMs = (row: ProfitLossRow) => {
      const tx = row.detailTransactions?.[0];
      const d = tx?.date;
      const jsDate = d && typeof d.toDate === "function" ? d.toDate() : d ? new Date(d) : null;
      return jsDate && !Number.isNaN(jsDate.getTime()) ? jsDate.getTime() : 0;
    };

    // Sort (desktop + mobile footer filter aware)
    const sortItems = (items: ProfitLossRow[]): ProfitLossRow[] => {
      const sorted = [...items];
      sorted.sort((a, b) => {
        if (isMobile) {
          if (reportVariant === "bill-wise") {
            if (mobileFilter === "by_bill_no") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
            if (mobileFilter === "date") return rowDateMs(b) - rowDateMs(a);
            if (mobileFilter === "high_to_low") return (Math.abs(b.plAmount ?? 0) - Math.abs(a.plAmount ?? 0));
            if (mobileFilter === "low_to_high") return (Math.abs(a.plAmount ?? 0) - Math.abs(b.plAmount ?? 0));
          } else {
            if (mobileFilter === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            if (mobileFilter === "date") return rowDateMs(b) - rowDateMs(a);
            if (mobileFilter === "high_to_low") return (Math.abs(b.plAmount ?? 0) - Math.abs(a.plAmount ?? 0));
            if (mobileFilter === "low_to_high") return (Math.abs(a.plAmount ?? 0) - Math.abs(b.plAmount ?? 0));
          }
        }
        return sortDesc ? b.amount - a.amount : a.amount - b.amount;
      });
      return sorted.map(item => {
        if (item.isGroup) {
          return { ...item, subRows: sortItems(item.subRows) };
        }
        return item;
      });
    };
    
    return sortItems(filteredData);
  }, [profitLossData, query, sortDesc, entityFilter, isMobile, mobileFilter, reportVariant]);

  /** Party pager semantics: slice list ke tail se taaki MobileTransactionsPager Prev/Next Party Report jaisa lagein. */
  const filteredMainPaged = useMemo(() => {
    const total = filtered.length;
    if (!isMobile || plMobileMainRowsPerPage <= 0) return filtered;
    const totalPagesLocal = Math.max(1, Math.ceil(total / plMobileMainRowsPerPage));
    const safePage = Math.min(Math.max(1, plMobileMainPage), totalPagesLocal);
    const end = total - (safePage - 1) * plMobileMainRowsPerPage;
    const start = Math.max(0, end - plMobileMainRowsPerPage);
    return filtered.slice(start, Math.max(start, end));
  }, [filtered, isMobile, plMobileMainPage, plMobileMainRowsPerPage]);

  const plMobilePagerEdges = useMemo(() => {
    const total = filtered.length;
    if (!isMobile || plMobileMainRowsPerPage <= 0) return { before: 0, after: 0 };
    const totalPagesLocal = Math.max(1, Math.ceil(total / plMobileMainRowsPerPage));
    const safePage = Math.min(Math.max(1, plMobileMainPage), totalPagesLocal);
    const end = total - (safePage - 1) * plMobileMainRowsPerPage;
    const start = Math.max(0, end - plMobileMainRowsPerPage);
    return { before: start, after: total - end };
  }, [filtered.length, isMobile, plMobileMainPage, plMobileMainRowsPerPage]);

  React.useEffect(() => {
    setPlMobileMainPage(1);
  }, [query, entityFilter, mobileFilter, dateRange?.from?.getTime(), dateRange?.to?.getTime(), reportVariant]);

  React.useEffect(() => {
    const tp = Math.max(1, plMobileMainRowsPerPage <= 0 ? 1 : Math.ceil(filtered.length / plMobileMainRowsPerPage));
    if (plMobileMainPage > tp) setPlMobileMainPage(tp);
  }, [filtered.length, plMobileMainRowsPerPage, plMobileMainPage]);
  
  // Calculate totals from filtered data (variant-aware for Dr/Cr/P&L summaries).
  const totals = useMemo(() => {
    const calculateTotals = (items: ProfitLossRow[]): { income: number; expense: number; debit: number; credit: number; pl: number } => {
      let income = 0;
      let expense = 0;
      let debit = 0;
      let credit = 0;
      let pl = 0;
      
      items.forEach(item => {
        if (item.isGroup) {
          const subTotals = calculateTotals(item.subRows);
          income += subTotals.income;
          expense += subTotals.expense;
          debit += subTotals.debit;
          credit += subTotals.credit;
          pl += subTotals.pl;
        } else {
          debit += Number(item.debit ?? 0);
          credit += Number(item.credit ?? 0);
          pl += Number(item.plAmount ?? 0);
          if (item.category === 'Income') {
            income += item.amount;
          } else {
            expense += item.amount;
          }
        }
      });
      
      return { income, expense, debit, credit, pl };
    };
    
    const { income, expense, debit, credit, pl } = calculateTotals(filtered);
    const net = income - expense;
    return {
      income: round2(income),
      expense: round2(expense),
      net: round2(net),
      debit: round2(debit),
      credit: round2(credit),
      pl: round2(pl),
    };
  }, [filtered]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const getAllGroupIds = (items: ProfitLossRow[]): string[] => {
      const ids: string[] = [];
      items.forEach(item => {
        if (item.isGroup && item.subRows.length > 0) {
          ids.push(item.id);
          ids.push(...getAllGroupIds(item.subRows));
        }
      });
      return ids;
    };
    setExpandedGroups(new Set(getAllGroupIds(filtered)));
  }, [filtered]);

  const collapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  const isAllExpanded = useMemo(() => {
    const getAllGroupIds = (items: ProfitLossRow[]): string[] => {
      const ids: string[] = [];
      items.forEach(item => {
        if (item.isGroup && item.subRows.length > 0) {
          ids.push(item.id);
          ids.push(...getAllGroupIds(item.subRows));
        }
      });
      return ids;
    };
    const allGroupIds = getAllGroupIds(filtered);
    return allGroupIds.length > 0 && allGroupIds.every(id => expandedGroups.has(id));
  }, [filtered, expandedGroups]);

  // Get account entity for useTransactions
  const accountEntity = useMemo(() => {
    if (reportVariant !== "income-exp") return null;
    if (!activeRow || activeRow.isGroup) return null;
    const account = processedExpenseAccounts.find(acc => acc.id === activeRow.accountId);
    if (!account) return null;
    
    // Get opening balance - processedExpenseAccounts spreads ...e so openingBalance should be preserved
    // But if not, calculate it: balance = openingBalance + debit - credit
    const openingBalanceFromAccount = Number((account as any).openingBalance);
    const calculatedOpeningBalance = openingBalanceFromAccount || ((account.balance || 0) - (account.debit || 0) + (account.credit || 0));
    
    // Ensure openingBalance is included in the entity
    return {
      ...account,
      openingBalance: calculatedOpeningBalance,
    };
  }, [reportVariant, activeRow, processedExpenseAccounts]);

  // Use useTransactions hook to get processed transactions with debit, credit, and running balance
  const { processedTransactions, openingBalanceForPeriod: openingBalanceForAccount, periodDr, periodCr, closingBalance: calculatedClosingBalance } = useTransactions(
    accountEntity,
    "expense",
    dateRange,
    "amount",
    processedExpenseAccounts,
    undefined, // passedTransactions
    undefined, // transactionContext
    undefined, // filters
    undefined, // voucherTypes
    undefined, // journalAccountNames
    userNames
  );

  const detailTransactions = useMemo(() => {
    // Variant-aware details: account-ledger uses hook output, party/bill variants use row-bound transactions.
    if (!activeRow) return [];
    if (reportVariant === "income-exp") return processedTransactions || [];
    return activeRow.detailTransactions || [];
  }, [activeRow, reportVariant, processedTransactions]);

  const openDetail = (row: ProfitLossRow) => {
    if (row.isGroup) return;
    setActiveRow(row);
    setCurrentPage(1); // Reset to first page when opening new account
  };
  
  const closeDrawer = () => setActiveRow(null);

  const handlePrintDetail = () => {
    if (!company || !activeRow) return;
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;
      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    const detailContext = reportVariant === "income-exp" ? "expense" : (activeRow.detailContext || "daybook");
    const detailContextId = reportVariant === "income-exp" ? activeRow.accountId : activeRow.detailContextId;
    openPrintDirect({
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
      title: `${activeRow.name}${activeRow.category ? ` · ${activeRow.category}` : ""}`,
      context: detailContext,
      contextId: detailContextId,
      dateSystem: dateSystem,
      dateRangeText: dateRangeText,
      vouchersCount: detailTransactions.length ?? 0,
      openingBalance: reportVariant === "income-exp" ? (openingBalanceForAccount ?? 0) : 0,
      transactions: detailTransactions,
      userNames: userNames,
    }, true);
  };

  const mobileChromeTitle =
    reportVariant === "party-wise" ? "Party Report" : reportVariant === "bill-wise" ? "Bill Report" : "Profit & Loss";

  /** Reports list (`ReportPageProvider`) par back = list pe; standalone route par router.back(). */
  const handlePlMobileBack = () => {
    if (onBackToReportList) onBackToReportList();
    else router.back();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div
      className={cn(
        "w-full h-full overflow-hidden flex flex-col",
        isMobile ? "min-h-0 pb-0" : "pb-[72px]"
      )}
    >
      <div className="p-0 min-h-0 flex-1 flex flex-col gap-[5px]">
        {isMobile ? (
          <>
            {/* Party Report jaisa mobile chrome — list se Reports pe wapas + title + subtitle count. */}
            <div className="flex-shrink-0 border-b bg-background px-2 py-1.5 space-y-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handlePlMobileBack}
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="shrink-0 text-base font-bold text-muted-foreground">{mobileChromeTitle}</h1>
                <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-foreground" title={reportLabel}>
                  {reportLabel ?? " "}
                </span>
              </div>
              <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                Showing {filteredMainPaged.length} of {filtered.length}{" "}
                {reportVariant === "bill-wise" ? "bill(s)" : reportVariant === "party-wise" ? "party row(s)" : "row(s)"}
              </div>
              <div className="flex items-center justify-center gap-2 px-1">
                <span className="text-xs font-medium text-muted-foreground truncate text-center">{activeRangeLabel}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[10px] font-semibold"
                  onClick={() => {
                    const { start, end } = getFiscalRangeForCountry(company?.country || "Nepal");
                    setDateRange({ from: startOfDay(start), to: endOfDay(end) });
                  }}
                >
                  FY
                </Button>
              </div>
              <div className="flex items-stretch gap-2">
                {reportVariant === "income-exp" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 px-2 text-xs"
                    onClick={isAllExpanded ? collapseAll : expandAll}
                  >
                    {isAllExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                      </>
                    )}
                  </Button>
                )}
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
                  <Input
                    placeholder={
                      reportVariant === "party-wise"
                        ? "Search party..."
                        : reportVariant === "bill-wise"
                          ? "Search bill no..."
                          : "Search account or group..."
                    }
                    className="h-9 pl-8 text-sm w-full min-w-0"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
        <div className="w-full min-w-0 pt-1">
          {/* Plain title row (no ribbon/gradient): heading + variant badge + fullscreen control */}
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="min-w-0 truncate text-[1.22rem] font-semibold sm:text-[1.96rem]">Profit &amp; Loss Statement</h1>
            {reportLabel ? (
              <span className="rounded-full border border-orange-400/70 bg-gradient-to-r from-orange-50 to-amber-100 px-2 py-0.5 text-[11px] sm:text-xs font-semibold text-orange-700 whitespace-nowrap shrink-0 dark:from-orange-950/30 dark:to-amber-900/30">
                {reportLabel}
              </span>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center">
              <ReportPageExpandButton />
            </div>
          </div>
        </div>
        )}
        {/* Summary area is full-width now that the outer card shell is gone. */}
        <div className="w-full min-w-0 space-y-[5px]">
          <div className="grid grid-cols-2 gap-[5px]">
            <Card className="min-w-0 border-2 border-emerald-300/70 bg-gradient-to-r from-emerald-50 via-white to-emerald-100/70 dark:from-emerald-950/30 dark:via-card dark:to-emerald-900/20">
              <CardContent className="px-3 py-1 sm:px-4 sm:py-1.5">
                <div className="flex flex-col items-start gap-0.5 min-w-0">
                  {/* Requested copy update: show only "Income" label and put amount on next line. */}
                  {/* Compact card density: reduce vertical footprint while keeping number readable. */}
                  {/* Extra-tight line gap: keep about ~2px visual spacing around text block. */}
                  <CardTitle className="text-[13px] sm:text-sm font-medium leading-none">
                    {reportVariant === "party-wise" ? "Total Dr" : "Income"}
                  </CardTitle>
                  <span className="text-base sm:text-xl font-bold text-green-600 tabular-nums leading-none break-all">
                    {toNepaliCurrency(reportVariant === "party-wise" ? totals.debit : totals.income)}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="min-w-0 border-2 border-rose-300/70 bg-gradient-to-r from-rose-50 via-white to-orange-100/70 dark:from-rose-950/30 dark:via-card dark:to-orange-900/20">
              <CardContent className="px-3 py-1 sm:px-4 sm:py-1.5">
                <div className="flex flex-col items-start gap-0.5 min-w-0">
                  {/* Requested copy update: show only "Expense" label and put amount on next line. */}
                  {/* Compact card density: reduce vertical footprint while keeping number readable. */}
                  {/* Extra-tight line gap: keep about ~2px visual spacing around text block. */}
                  <CardTitle className="text-[13px] sm:text-sm font-medium leading-none">
                    {reportVariant === "party-wise" ? "Total Cr" : "Expense"}
                  </CardTitle>
                  <span className="text-base sm:text-xl font-bold text-red-600 tabular-nums leading-none break-all">
                    {toNepaliCurrency(reportVariant === "party-wise" ? totals.credit : totals.expense)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
          {/* Net summary also uses ribbon style so it visually matches income/expense cards. */}
          <Card className={cn(
            "min-w-0 border-2",
            totals.net >= 0
              ? "border-emerald-300/70 bg-gradient-to-r from-emerald-50 via-white to-teal-100/70 dark:from-emerald-950/30 dark:via-card dark:to-teal-900/20"
              : "border-rose-300/70 bg-gradient-to-r from-rose-50 via-white to-orange-100/70 dark:from-rose-950/30 dark:via-card dark:to-orange-900/20"
          )}>
            <CardContent className="px-3 py-1 sm:px-4 sm:py-1.5">
              <div className="flex items-center justify-between gap-2 min-w-0">
                {/* Net card also follows same compact-height style as top two cards. */}
                {/* Extra-tight typography so label/value sit with minimal top/bottom breathing room. */}
                <CardTitle className="text-[13px] sm:text-sm font-medium whitespace-nowrap shrink-0 leading-none">
                  {reportVariant === "party-wise" ? "P&L (FY)" : "Net Profit / Loss"}
                </CardTitle>
                <span className={`text-base sm:text-xl font-bold whitespace-nowrap tabular-nums leading-none ${(reportVariant === "party-wise" ? totals.pl : totals.net) >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {(reportVariant === "party-wise" ? totals.pl : totals.net) >= 0
                    ? `${toNepaliCurrency(reportVariant === "party-wise" ? totals.pl : totals.net)} (Profit)`
                    : `${toNepaliCurrency(Math.abs(reportVariant === "party-wise" ? totals.pl : totals.net))} (Loss)`}
                </span>
              </div>
            </CardContent>
          </Card>
          </div>

        {/* Remove extra outer card shell; keep only inner content panel for wider list area. */}
        <div className="flex-1 min-h-0 flex flex-col">
            {!isMobile &&
              (reportVariant === "income-exp" ? (
              // Party-wise / Bill-wise request: hide filter-toolbar; keep it only on income-exp view.
              <div className={cn("flex items-center gap-2 py-3 px-4")}>
                <div className={cn("flex items-center gap-2 w-full min-w-0")}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={isAllExpanded ? collapseAll : expandAll}
                >
                  {isAllExpanded ? (
                    <>
                      <ChevronUp className="mr-2 h-4 w-4" /> Collapse All
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-2 h-4 w-4" /> Expand All
                    </>
                  )}
                </Button>
                {/* Requested: remove "All" and "Sort" boxes from income-exp toolbar. */}
                <div className="relative w-full max-w-sm ml-auto">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
                  <Input
                    placeholder="Search account or group..."
                    className="pl-8"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 py-2 px-4">
                {/* Show active date range at left of search for party/bill views. */}
                <div className="h-9 flex items-center text-[11px] sm:text-xs text-muted-foreground whitespace-nowrap rounded-md border px-2">
                  {activeRangeLabel}
                </div>
                <div className="relative w-full max-w-sm ml-auto">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
                  <Input
                    placeholder={reportVariant === "party-wise" ? "Search party..." : "Search bill no..."}
                    className="h-9 pl-8"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            ))}
            {/* `!isMobile && (` ke liye dubara `)` — warna JSX parse "Expected '</', got '}'". */}

            {/* Wider inner panel: reduce side margins so table area uses more horizontal space. */}
            <div className={cn("rounded-lg border flex-1 flex flex-col min-h-0 mx-2", isMobile && "overflow-x-hidden")}>
              <div className={cn("flex-1 flex flex-col min-h-0")}>
              <div className="flex-1 overflow-y-auto min-h-0">
                <Table
                  className={cn(
                    // Mobile fit: keep all variants table-fixed to avoid horizontal cut/scroll.
                    isMobile && "w-full table-fixed"
                  )}
                >
                  <TableCaption>Click a row to view details.</TableCaption>
                  <TableHeader className="sticky top-0 z-30 bg-background [&_tr]:bg-background [&_th]:bg-background">
                    <TableRow>
                      {reportVariant === "bill-wise" ? (
                        <>
                          <TableHead className="sticky top-0 z-40 bg-background">Bill No</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Dr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Cr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">P&amp;L</TableHead>
                        </>
                      ) : reportVariant === "party-wise" ? (
                        <>
                          <TableHead className="sticky top-0 z-40 bg-background">Party Name</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Dr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Cr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">P&amp;L</TableHead>
                        </>
                      ) : expandedGroups.size > 0 ? (
                        <>
                          {/* Expanded header requested: show Group/Account without spaces around slash. */}
                          <TableHead className="sticky top-0 z-40 bg-background">Group/Account</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Dr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Cr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">P&amp;L</TableHead>
                        </>
                      ) : (
                        <>
                          {/* Collapsed view: header shows only Group side (requested). */}
                          <TableHead className="sticky top-0 z-40 bg-background">Group</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Dr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">Cr</TableHead>
                          <TableHead className="sticky top-0 z-40 bg-background text-right">P&amp;L</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(isMobile ? filteredMainPaged : filtered).map((row) => (
                      <GroupRow
                        key={row.id}
                        row={row}
                        level={0}
                        expandedGroups={expandedGroups}
                        toggleGroup={toggleGroup}
                        onRowClick={openDetail}
                        reportVariant={reportVariant}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={
                            reportVariant === "bill-wise"
                              ? 4
                              : reportVariant === "party-wise"
                                ? 4
                                : expandedGroups.size > 0
                                  ? 4
                                  : 4
                          }
                          className="text-center py-8 text-muted-foreground"
                        >
                          No matching records found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {isMobile && (
                <MobileTransactionsPager
                  className="flex-shrink-0 border-t bg-background"
                  currentPage={plMobileMainPage}
                  totalItems={filtered.length}
                  rowsPerPage={plMobileMainRowsPerPage}
                  onPageChange={setPlMobileMainPage}
                  onRowsPerPageChange={(n) => {
                    setPlMobileMainRowsPerPage(n);
                    setPlMobileMainPage(1);
                  }}
                  edgeCounts={plMobilePagerEdges.before > 0 || plMobilePagerEdges.after > 0 ? plMobilePagerEdges : undefined}
                />
              )}
              </div>
            </div>

            <div className={cn("mt-auto", isMobile && "pb-28")}>
              {isMobile ? (
              <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-2 py-1.5">
                {/* Mobile footer filters: align with account-list style across all 3 variants. */}
                <div className="overflow-x-auto">
                  <div className="flex w-max items-center gap-1">
                    {(reportVariant === "bill-wise"
                      ? [
                          { key: "by_bill_no", label: "By Bill No" },
                          { key: "date", label: "By Date" },
                          { key: "high_to_low", label: "High to Low" },
                          { key: "low_to_high", label: "Low to High" },
                        ]
                      : [
                          { key: "name", label: "By Name" },
                          { key: "date", label: "By Date" },
                          { key: "low_to_high", label: "Low to High" },
                          { key: "high_to_low", label: "High to Low" },
                        ]).map((f) => (
                      <Button
                        key={f.key}
                        type="button"
                        size="sm"
                        variant={mobileFilter === (f.key as ProfitLossMobileFilter) ? "default" : "outline"}
                        className="h-7 whitespace-nowrap px-2 text-[11px]"
                        onClick={() => setMobileFilter(f.key as ProfitLossMobileFilter)}
                      >
                        {f.label}
                      </Button>
                    ))}
                    {/* Calendar moved to right of filter buttons (after High to Low). */}
                    <Popover open={isFooterCalendarOpen} onOpenChange={setIsFooterCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" aria-label="Select date range">
                          <CalendarIcon className="h-3.5 w-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <AdCalendar
                          rangePresetSlot={
                            <DateRangePresetRow
                              country={company?.country}
                              onApply={(r) => {
                                const normalizedRange: DateRange = {
                                  from: startOfDay(r.from),
                                  to: endOfDay(r.to),
                                };
                                setDateRange(normalizedRange);
                                setIsFooterCalendarOpen(false);
                              }}
                            />
                          }
                          valueAD={dateRange}
                          isRange
                          numberOfMonths={calendarMonths}
                          onSelect={(adDate) => {
                            const range = dateRange;
                            if (!range?.from || (range.from && range.to)) {
                              setDateRange({ from: startOfDay(adDate), to: undefined });
                            } else if (adDate < range.from) {
                              setDateRange({ from: startOfDay(adDate), to: endOfDay(range.from) });
                              setIsFooterCalendarOpen(false);
                            } else {
                              setDateRange({ from: range.from, to: endOfDay(adDate) });
                              setIsFooterCalendarOpen(false);
                            }
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => {
                        const { start, end } = getFiscalRangeForCountry(company?.country || "Nepal");
                        setDateRange({ from: startOfDay(start), to: endOfDay(end) });
                      }}
                    >
                      FY
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            </div>
        </div>
      </div>

      {/* DETAIL DIALOG - height 90% screen, width data anusar */}
      <Dialog open={!!activeRow} onOpenChange={(open) => !open && closeDrawer()}>
        <DialogContent
          className={cn(
            // Requested sizing: near full-width dialog on both desktop and mobile (98% container).
            "h-[90vh] max-h-[90vh] flex flex-col gap-0 overflow-hidden p-2 sm:p-4",
            "w-[98vw] max-w-[98vw] min-w-0 rounded-2xl"
          )}
        >
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="pr-8 truncate">
              {activeRow?.name} {activeRow?.category ? `· ${activeRow.category}` : ""}
            </DialogTitle>
          </DialogHeader>
          
          {/* Date Filter and Pagination Controls */}
          <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b">
            <div className="flex items-center gap-2">
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <BsDatePicker
                  isRange
                  valueAD={dateRange}
                  onChangeAD={(range) => {
                    if (range) {
                      const normalizedRange: DateRange = {
                        from: range.from ? startOfDay(range.from) : undefined,
                        to: range.to ? endOfDay(range.to) : undefined,
                      };
                      setDateRange(normalizedRange);
                      if (activeRow) {
                        openDetail(activeRow);
                      }
                    } else {
                      setDateRange(undefined);
                      if (activeRow) {
                        openDetail(activeRow);
                      }
                    }
                  }}
                  className="w-auto"
                />
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`w-[240px] justify-start text-left font-normal ${
                        !dateRange && "text-muted-foreground"
                      }`}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <AdCalendar
                      rangePresetSlot={
                        <DateRangePresetRow
                          country={company?.country}
                          onApply={(r) => {
                            if (!r.from || !r.to) return;
                            const normalizedRange: DateRange = {
                              from: startOfDay(r.from),
                              to: endOfDay(r.to),
                            };
                            setDateRange(normalizedRange);
                            setIsCalendarOpen(false);
                            if (activeRow) openDetail(activeRow);
                          }}
                        />
                      }
                      valueAD={dateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      onSelect={(adDate) => {
                        const range = dateRange;
                        if (!range?.from || (range.from && range.to)) {
                          setDateRange({ from: startOfDay(adDate), to: undefined });
                        } else if (adDate < range.from) {
                          setDateRange({ from: startOfDay(adDate), to: endOfDay(range.from) });
                          setIsCalendarOpen(false);
                          if (activeRow) openDetail(activeRow);
                        } else {
                          setDateRange({ from: range.from, to: endOfDay(adDate) });
                          setIsCalendarOpen(false);
                          if (activeRow) openDetail(activeRow);
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {dateRange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateRange(undefined);
                    if (activeRow) {
                      openDetail(activeRow);
                    }
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            
            {!isMobile && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Per page:</span>
              <Select
                value={`${rowsPerPage}`}
                onValueChange={(value) => {
                  setRowsPerPage(Number(value));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[80px] h-8">
                  <SelectValue placeholder={`${rowsPerPage}`} />
                </SelectTrigger>
                <SelectContent>
                  {[20, 30, 40, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}
          </div>
          
          <div className={cn("flex-1 min-h-0 overflow-y-auto", isMobile ? "overflow-x-hidden px-0.5" : "overflow-x-auto px-1")}>
            {activeRow && (() => {
              const list = detailTransactions || [];
              const totalPages = rowsPerPage > 0 ? Math.ceil(list.length / rowsPerPage) : 1;
              /** Desktop: classical forward slice. Mobile dialog: Party Report jaisa tail-side window + pager Prev/Next. */
              let paginatedTransactions = list;
              let pageOpeningBalance = reportVariant === "income-exp" ? openingBalanceForAccount ?? 0 : 0;
              if (rowsPerPage > 0) {
                if (isMobile) {
                  const totalPagesLoc = Math.max(1, Math.ceil(list.length / rowsPerPage));
                  const safePage = Math.min(Math.max(1, currentPage), totalPagesLoc);
                  const end = list.length - (safePage - 1) * rowsPerPage;
                  const start = Math.max(0, end - rowsPerPage);
                  paginatedTransactions = list.slice(start, Math.max(start, end));
                  const prevTx = start > 0 ? list[start - 1] : null;
                  const prevBalRaw =
                    prevTx != null
                      ? (typeof prevTx.balance === "number"
                          ? prevTx.balance
                          : typeof prevTx.runningBalance === "number"
                            ? prevTx.runningBalance
                            : undefined)
                      : undefined;
                  if (typeof prevBalRaw === "number" && !Number.isNaN(prevBalRaw)) {
                    pageOpeningBalance = prevBalRaw;
                  }
                } else {
                  paginatedTransactions = list.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
                }
              }

              const pageDr = paginatedTransactions.reduce((sum: number, t: any) => sum + (Number(t?.debit) || 0), 0);
              const pageCr = paginatedTransactions.reduce((sum: number, t: any) => sum + (Number(t?.credit) || 0), 0);

              const detailContext = reportVariant === "income-exp" ? "expense" : (activeRow.detailContext || "daybook");
              const detailContextId = reportVariant === "income-exp" ? activeRow.accountId : activeRow.detailContextId;
              
              return (
                <>
                  {/* Mobile fit: avoid intrinsic table width expansion that pushed dialog beyond screen. */}
                  <div className={cn("min-w-0 w-full overflow-x-hidden", isMobile ? "-mx-0.5" : "")}>
                    {/* Desktop expense = hook totals; mobile = per-page slice (Party pager semantics). */}
                    <TransactionsTable 
                      context={detailContext}
                      contextId={detailContextId}
                      transactions={paginatedTransactions}
                      userNames={userNames}
                      openingBalance={
                        reportVariant === "income-exp"
                          ? isMobile
                            ? pageOpeningBalance
                            : openingBalanceForAccount ?? 0
                          : 0
                      }
                      periodDr={reportVariant === "income-exp" ? (isMobile ? pageDr : periodDr) : 0}
                      periodCr={reportVariant === "income-exp" ? (isMobile ? pageCr : periodCr) : 0}
                      closingBalance={
                        reportVariant === "income-exp"
                          ? isMobile
                            ? pageOpeningBalance + pageDr - pageCr
                            : calculatedClosingBalance
                          : 0
                      }
                    />
                  </div>
                  <div className="flex-shrink-0">
                    {isMobile ? (
                      <MobileTransactionsPager
                        currentPage={currentPage}
                        totalItems={detailTransactions?.length ?? 0}
                        rowsPerPage={rowsPerPage}
                        onPageChange={setCurrentPage}
                        onRowsPerPageChange={(n) => {
                          setRowsPerPage(n);
                          setCurrentPage(1);
                        }}
                        edgeCounts={(() => {
                          const total = detailTransactions?.length ?? 0;
                          if (rowsPerPage <= 0) return undefined;
                          const totalPagesLoc = Math.max(1, Math.ceil(total / rowsPerPage));
                          const safePg = Math.min(Math.max(1, currentPage), totalPagesLoc);
                          const end = total - (safePg - 1) * rowsPerPage;
                          const start = Math.max(0, end - rowsPerPage);
                          const before = start;
                          const after = Math.max(0, total - end);
                          return before > 0 || after > 0 ? { before, after } : undefined;
                        })()}
                      />
                    ) : (
                  <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 flex-shrink-0">
                    <div className="text-sm text-muted-foreground">
                      Showing {(currentPage - 1) * rowsPerPage + 1} to {Math.min(currentPage * rowsPerPage, detailTransactions?.length || 0)} of {detailTransactions?.length || 0} transactions
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-sm font-medium">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                    )}
                  </div>
                </>
              );
            })()}
            {activeRow && (!detailTransactions || detailTransactions.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                No transactions found for this record{dateRange ? ' in the selected date range' : ''}.
              </div>
            )}
          </div>
          <DialogFooter className="flex-row items-center justify-end gap-2 [&>*]:mt-0">
            {/* Footer actions: one row with blue close and green print for mobile clarity. */}
            <Button
              variant="outline"
              onClick={closeDrawer}
              className="rounded-full border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:text-white"
            >
              Close
            </Button>
            <Button
              variant="outline"
              onClick={handlePrintDetail}
              className="gap-2 rounded-full border border-green-600 bg-green-600 text-white hover:bg-green-700 hover:text-white"
              disabled={!activeRow}
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
