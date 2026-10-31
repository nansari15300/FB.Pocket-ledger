
"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableCaption,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search, Loader2, ChevronDown, ChevronRight, ChevronUp, Printer, Calendar as CalendarIcon, XCircle } from "lucide-react";
import { PrintOptionsDialog } from "@/components/ui/PrintOptionsDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AdCalendar from "@/components/ui/ad-calendar";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { TransactionsTable } from "../vouchers/TransactionsTable";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { useTransactions } from "@/hooks/use-transactions";
import { openPrintDirect } from "@/lib/printDirect";
import type { DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { cn } from "@/lib/utils";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import {
  computeOpeningBalanceLedgerBreakdown,
  type OpeningBalanceLedgerAccountRow,
} from "@/lib/reports/openingBalanceLedgerAccounts";
import { OpeningBalanceMasterEditHost } from "@/components/reports/OpeningBalanceMasterEditHost";
import { OpeningBalanceLedgerAccountsTable } from "@/components/reports/OpeningBalanceLedgerAccountsTable";
import { computeExpectedSystemOpeningBalance, collectMasterOpeningBalanceEntities } from "@/lib/reports/systemOpeningBalanceEquity";

/**
 * TYPES
 */
type TrialBalanceRow = {
  id: string;
  name: string;
  isGroup: boolean;
  balance: number;
  debit: number;
  credit: number;
  subRows: TrialBalanceRow[];
  transactions?: any[];
  openingBalance?: number;
  parentId?: string | null;
  parentGroupName?: string; // Parent group name (level 0)
  subGroupName?: string; // Sub group name (level 1)
};

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
 * RECURSIVE ROW COMPONENT
 */
const GroupRow = ({ group, level, onAccountClick, expandedGroups, toggleGroup, parentGroupName, subGroupName, hasAnyExpanded }: {
    group: TrialBalanceRow,
    level: number,
    onAccountClick: (account: TrialBalanceRow) => void,
    expandedGroups: Set<string>,
    toggleGroup: (groupId: string) => void,
    parentGroupName?: string,
    subGroupName?: string,
    hasAnyExpanded: boolean,
}) => {
    const isExpanded = expandedGroups.has(group.id);
    const balanceStyle = isExpanded ? "text-muted-foreground/80 font-normal" : "font-semibold";
    
    // Determine parent and sub group names based on level
    // Level 0 = Parent Group (e.g., Assets, Liabilities)
    // Level 1 = Sub Group (e.g., Bank Accounts, Cash-in-Hand)
    // Level 2+ = Account
    const currentParentGroup = level === 0 ? group.name : parentGroupName;
    const currentSubGroup = level === 1 ? group.name : subGroupName;

    return (
        <>
            <TableRow 
                className={cn(
                    "font-semibold hover:bg-muted/50 cursor-pointer",
                    isExpanded ? "bg-muted/20 text-muted-foreground/80" : "bg-muted/40"
                )} 
                onClick={() => toggleGroup(group.id)}
            >
                {hasAnyExpanded ? (
                    <>
                        <TableCell className="py-3">{level === 0 ? group.name : (parentGroupName || '')}</TableCell>
                        <TableCell className="py-3">{level === 1 ? group.name : (subGroupName || '')}</TableCell>
                        <TableCell className="py-3">
                            <div className="flex items-center gap-2">
                                {group.subRows.length > 0 && (isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                                {level > 1 ? group.name : ''}
                            </div>
                        </TableCell>
                    </>
                ) : (
                    <TableCell style={{ paddingLeft: `${level * 20 + 24}px` }} className="py-3">
                        <div className="flex items-center gap-2">
                            {group.subRows.length > 0 && (isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                            {group.name}
                        </div>
                    </TableCell>
                )}
                <TableCell className={cn("text-right tabular-nums pr-6 py-3", balanceStyle)}>
                  {isExpanded ? '-' : toNepaliCurrency(group.debit)}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums pr-6 py-3", balanceStyle)}>
                  {isExpanded ? '-' : toNepaliCurrency(group.credit)}
                </TableCell>
            </TableRow>
            {isExpanded && group.subRows.map(row => {
                if (row.isGroup) {
                    return <GroupRow 
                        key={row.id} 
                        group={row} 
                        level={level + 1} 
                        onAccountClick={onAccountClick} 
                        expandedGroups={expandedGroups} 
                        toggleGroup={toggleGroup}
                        parentGroupName={currentParentGroup}
                        subGroupName={level === 0 ? row.name : currentSubGroup}
                        hasAnyExpanded={hasAnyExpanded}
                    />
                }
                // Account row
                return (
                    <TableRow key={row.id} className="text-sm hover:bg-accent/10 cursor-pointer" onClick={() => onAccountClick(row)}>
                        {hasAnyExpanded ? (
                            <>
                                <TableCell className="py-3">{currentParentGroup || ''}</TableCell>
                                <TableCell className="py-3">{level === 1 ? group.name : (currentSubGroup || '')}</TableCell>
                                <TableCell className="py-3">{row.name}</TableCell>
                            </>
                        ) : (
                            <TableCell style={{ paddingLeft: `${(level + 1) * 20 + 44}px` }} className="py-3">{row.name}</TableCell>
                        )}
                        <TableCell className="text-right tabular-nums text-green-600 pr-6 py-3">{row.debit > 0 ? toNepaliCurrency(row.debit) : '-'}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-600 pr-6 py-3">{row.credit > 0 ? toNepaliCurrency(row.credit) : '-'}</TableCell>
                    </TableRow>
                )
            })}
        </>
    )
}

/**
 * MAIN TRIAL BALANCE PAGE COMPONENT
 */
export function TrialBalancePage() {
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const {
    vouchers,
    loading,
    processedParties,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedExpenseAccounts,
    processedGroups,
    processedStaffGroups,
    processedAccountGroups,
    processedTaxGroups,
    processedExpenseGroups,
    userNames,
  } = useFyScopedVouchers();
  
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } = useDate();
  const { company, companyId } = useCompany();
  
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const [sortBy, setSortBy] = useState<'entity' | 'balance' | 'date'>('entity');
  const [activeAccount, setActiveAccount] = useState<TrialBalanceRow | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [showDetailPrintDialog, setShowDetailPrintDialog] = useState(false);
  const [openingBalanceEditRow, setOpeningBalanceEditRow] =
    useState<OpeningBalanceLedgerAccountRow | null>(null);
  const [openingBalanceEditOpen, setOpeningBalanceEditOpen] = useState(false);

  // Reset all local state when company changes
  useEffect(() => {
    if (companyId) {
      setQuery("");
      setDateRange(undefined);
      setActiveAccount(null);
      setExpandedGroups(new Set());
      setFilters({});
      setActiveFilter(null);
      setSortDesc(false);
      setSortBy('entity');
      setIsCalendarOpen(false);
    }
  }, [companyId]);

  const trialBalanceData = useMemo((): TrialBalanceRow[] => {
    const expectedSystemOpeningBalance = computeExpectedSystemOpeningBalance(
      collectMasterOpeningBalanceEntities({
        processedParties,
        processedAccounts,
        processedStaff,
        processedTaxes,
        processedExpenseAccounts,
      })
    );

    // 1. Gather all individual ledgers with their final balances
    const allLedgers: TrialBalanceRow[] = [
      ...processedParties,
      ...processedStaff,
      ...processedAccounts.map(a => ({ ...a, name: a.accountName })),
      ...processedTaxes,
      ...processedExpenseAccounts,
    ]
      .filter(l => {
        // Always show Opening Balance ledger (even if zero) as it's the default balancing account
        if (l.id === 'opening_balance_ledger') return true;
        // Include accounts with non-zero balance or non-zero opening balance
        return Math.abs(l.balance || 0) > 0.01 || l.openingBalance !== 0;
      })
      .map(l => {
        // For Opening Balance ledger, always use openingBalance field for balance calculation
        const isOpeningBalanceLedger = l.id === 'opening_balance_ledger';
        const openingBalanceValue = isOpeningBalanceLedger
          ? expectedSystemOpeningBalance
          : Number((l as any).openingBalance) || 0;
        const effectiveBalance = isOpeningBalanceLedger
          ? openingBalanceValue
          : l.balance;
        
        return {
          id: l.id,
          name: l.name,
          balance: effectiveBalance,
          debit: effectiveBalance > 0 ? effectiveBalance : 0,
          credit: effectiveBalance < 0 ? Math.abs(effectiveBalance) : 0,
          parentId: (l as any).groupId,
          isGroup: false,
          subRows: [],
          openingBalance: openingBalanceValue
        };
      });

    // 2. Gather all groups
    const allGroups: TrialBalanceRow[] = [
      ...processedGroups,
      ...processedStaffGroups,
      ...processedAccountGroups,
      ...processedTaxGroups,
      ...processedExpenseGroups,
    ].map(g => ({
      id: g.id,
      name: g.name,
      balance: 0,
      debit: 0,
      credit: 0,
      parentId: g.parentId,
      isGroup: true,
      subRows: []
    }));

    // 3. Build the tree
    const itemsMap = new Map<string, TrialBalanceRow>();
    allGroups.forEach(g => itemsMap.set(g.id, { ...g, subRows: [] }));
    allLedgers.forEach(l => itemsMap.set(l.id, { ...l, subRows: [] }));

    const rootItems: TrialBalanceRow[] = [];
    itemsMap.forEach(item => {
      const parentId = item.parentId;
      if (parentId && itemsMap.has(parentId)) {
        itemsMap.get(parentId)!.subRows.push(item);
      } else {
        rootItems.push(item);
      }
    });

    // 4. Calculate group totals recursively
    const calculateTotals = (item: TrialBalanceRow): { debit: number, credit: number } => {
      if (!item.isGroup) {
        return { debit: item.debit, credit: item.credit };
      }

      let totalDebit = 0;
      let totalCredit = 0;

      item.subRows.forEach(subItem => {
        const subTotals = calculateTotals(subItem);
        totalDebit += subTotals.debit;
        totalCredit += subTotals.credit;
      });

      item.debit = round2(totalDebit);
      item.credit = round2(totalCredit);
      item.balance = round2(totalDebit - totalCredit);
      
      return { debit: totalDebit, credit: totalCredit };
    };
    
    rootItems.forEach(calculateTotals);
    
    // 5. Filter out empty groups for a cleaner view but keep main ones
    const defaultParentGroups = ["assets", "liabilities", "equity", "income", "expenses"];
    const processHierarchy = (items: TrialBalanceRow[]): TrialBalanceRow[] => {
      return items.map(item => {
        if (item.isGroup) {
          item.subRows = processHierarchy(item.subRows);
        }
        return item;
      }).filter(item => {
        const isDefault = defaultParentGroups.includes((item.name || "").toLowerCase());
        return isDefault || !item.isGroup || item.subRows.length > 0;
      });
    };

    const finalHierarchy = processHierarchy(rootItems);
    
    // Sort children within each group alphabetically
    const sortRows = (rows: TrialBalanceRow[]) => {
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      rows.forEach(row => { if (row.isGroup) sortRows(row.subRows); });
    };
    sortRows(finalHierarchy);
    
    // System Opening Balance ledger is reconciled deterministically from current master OBs
    // via scheduleSystemOpeningBalanceReconcile (see systemOpeningBalanceEquityClient).
    
    return finalHierarchy;

  }, [
    processedAccounts, processedParties, processedStaff, processedTaxes, 
    processedExpenseAccounts, processedGroups, processedAccountGroups, 
    processedStaffGroups, processedTaxGroups, processedExpenseGroups
  ]);

  // Filter and sort based on search query and sort options.
  // Key behavior:
  // - Collapsed view: sort groups by group totals (debit+credit) for "balance"
  // - Expanded view: sort ONLY expanded groups' children by their row totals for "balance"
  const filtered = useMemo(() => {
    let result = trialBalanceData;

    // Apply search filter
    if (query) {
      const q = query.toLowerCase();
      const filterRecursive = (rows: TrialBalanceRow[]): TrialBalanceRow[] => {
        return rows
          .map((row) => {
            if (row.isGroup) {
              const newSubRows = filterRecursive(row.subRows);
              if (row.name.toLowerCase().includes(q) || newSubRows.length > 0) {
                return { ...row, subRows: newSubRows };
              }
              return null;
            }
            return row.name.toLowerCase().includes(q) ? row : null;
          })
          .filter((r): r is TrialBalanceRow => r !== null);
      };
      result = filterRecursive(trialBalanceData);
    }

    const safeToDate = (date: any): Date | null => {
      if (!date) return null;
      if (date.toDate) return date.toDate();
      if (date instanceof Date) return date;
      try {
        const d = new Date(date);
        return isNaN(d.getTime()) ? null : d;
      } catch {
        return null;
      }
    };

    const rowMagnitude = (row: TrialBalanceRow) => {
      // magnitude used for sorting by "balance"
      // (works well for both groups and ledgers)
      return Math.abs((row.debit || 0) + (row.credit || 0));
    };

    const latestTxTimeForLedger = (ledgerId: string): number => {
      const tx = vouchers.filter((v) =>
        v.partyId === ledgerId ||
        v.staffId === ledgerId ||
        v.accountId === ledgerId ||
        v.fromAccountId === ledgerId ||
        v.toAccountId === ledgerId ||
        v.taxAccountId === ledgerId ||
        v.expenseAccountId === ledgerId ||
        v.incomeAccountId === ledgerId ||
        (v.entries || []).some((e: any) => e.accountId === ledgerId)
      );
      if (tx.length === 0) return 0;
      return Math.max(...tx.map((t) => safeToDate(t.date)?.getTime() || 0));
    };

    const latestTxTimeForRow = (row: TrialBalanceRow): number => {
      if (!row.isGroup) return latestTxTimeForLedger(row.id);
      if (!row.subRows?.length) return 0;
      return Math.max(...row.subRows.map(latestTxTimeForRow));
    };

    const compareRows = (a: TrialBalanceRow, b: TrialBalanceRow) => {
      if (sortBy === "balance") {
        const diff = rowMagnitude(a) - rowMagnitude(b);
        return sortDesc ? -diff : diff;
      }
      if (sortBy === "date") {
        const diff = latestTxTimeForRow(a) - latestTxTimeForRow(b);
        return sortDesc ? -diff : diff;
      }
      // entity/name
      return sortDesc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
    };

    const sortTopLevel = (rows: TrialBalanceRow[]) => {
      const sorted = [...rows].sort(compareRows);
      return sorted;
    };

    const sortChildrenIfExpanded = (row: TrialBalanceRow): TrialBalanceRow => {
      if (!row.isGroup) return row;

      // Only reorder subRows when THIS group is expanded; otherwise keep original order (prevents “jumping”)
      const shouldSortChildren = expandedGroups.has(row.id);
      const nextSubRows = shouldSortChildren ? [...row.subRows].sort(compareRows) : row.subRows;
      return {
        ...row,
        subRows: nextSubRows.map(sortChildrenIfExpanded),
      };
    };

    // Always sort top-level groups
    const topSorted = sortTopLevel(result);
    // Only sort children for expanded nodes
    return topSorted.map(sortChildrenIfExpanded);
  }, [trialBalanceData, query, sortDesc, sortBy, vouchers, expandedGroups]);
  
  // Calculate final totals from the top-level groups
  const totals = useMemo(() => {
    let parentGroupDebit = 0;
    let parentGroupCredit = 0;
    filtered.forEach(group => {
      parentGroupDebit += group.debit;
      parentGroupCredit += group.credit;
    })
    return { debit: round2(parentGroupDebit), credit: round2(parentGroupCredit) };
  }, [filtered]);
  
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
        const newSet = new Set(prev);
        if (newSet.has(groupId)) {
            newSet.delete(groupId);
        } else {
            newSet.add(groupId);
        }
        return newSet;
    });
  };

  // Determine context type for the active account
  const getAccountContext = (row: TrialBalanceRow): "party" | "account" | "staff" | "tax" | "expense" => {
    if (processedParties.find(p => p.id === row.id)) return "party";
    if (processedAccounts.find(a => a.id === row.id)) return "account";
    if (processedStaff.find(s => s.id === row.id)) return "staff";
    if (processedTaxes.find(t => t.id === row.id)) return "tax";
    if (processedExpenseAccounts.find(e => e.id === row.id)) return "expense";
    return "party"; // default
  };

  const openDetail = (row: TrialBalanceRow) => {
    const accountTransactions = vouchers.filter(v => 
        v.partyId === row.id || 
        v.staffId === row.id || 
        v.accountId === row.id || 
        v.fromAccountId === row.id ||
        v.toAccountId === row.id ||
        v.taxAccountId === row.id ||
        v.expenseAccountId === row.id ||
        v.incomeAccountId === row.id ||
        (v.entries || []).some((e: any) => e.accountId === row.id)
      );
    setActiveAccount({ ...row, transactions: accountTransactions });
    // Reset filters when opening new account
    setDateRange(undefined);
    setFilters({});
  };
  
  const closeDialog = () => {
    setActiveAccount(null);
    setDateRange(undefined);
    setFilters({});
  };

  // Get entity for useTransactions hook
  const activeEntity = useMemo(() => {
    if (!activeAccount) return null;
    const context = getAccountContext(activeAccount);
    if (context === "party") {
      return processedParties.find(p => p.id === activeAccount.id) || null;
    } else if (context === "account") {
      return processedAccounts.find(a => a.id === activeAccount.id) || null;
    } else if (context === "staff") {
      return processedStaff.find(s => s.id === activeAccount.id) || null;
    } else if (context === "tax") {
      return processedTaxes.find(t => t.id === activeAccount.id) || null;
    } else if (context === "expense") {
      return processedExpenseAccounts.find(e => e.id === activeAccount.id) || null;
    }
    return null;
  }, [activeAccount, processedParties, processedAccounts, processedStaff, processedTaxes, processedExpenseAccounts]);

  // Use useTransactions hook to get processed transactions (only for non-Opening Balance ledgers)
  const accountContext = activeAccount ? getAccountContext(activeAccount) : "party";
  const isOpeningBalanceLedger = activeAccount?.id === 'opening_balance_ledger';
  const { processedTransactions, openingBalanceForPeriod, periodDr, periodCr, closingBalance: normalClosingBalance } = useTransactions(
    activeEntity,
    accountContext,
    dateRange,
    undefined,
    undefined,
    activeAccount?.transactions,
    undefined,
    filters,
    undefined,
    undefined,
    userNames
  );

  const openingBalanceLedgerBreakdown = useMemo(() => {
    if (activeAccount?.id !== "opening_balance_ledger") return null;
    return computeOpeningBalanceLedgerBreakdown({
      processedParties,
      processedStaff,
      processedAccounts,
      processedTaxes,
      processedExpenseAccounts,
    });
  }, [
    activeAccount?.id,
    processedParties,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedExpenseAccounts,
  ]);

  const handleOpeningBalanceRowActivate = useCallback(
    (row: OpeningBalanceLedgerAccountRow) => {
      setOpeningBalanceEditRow(row);
      setOpeningBalanceEditOpen(true);
    },
    []
  );

  const handleOpeningBalanceEditOpenChange = useCallback((open: boolean) => {
    setOpeningBalanceEditOpen(open);
    if (!open) setOpeningBalanceEditRow(null);
  }, []);

  // For Opening Balance ledger, calculate closing balance from current master snapshot
  const openingBalanceClosingBalance = useMemo(() => {
    if (!isOpeningBalanceLedger) return normalClosingBalance;
    if (openingBalanceLedgerBreakdown) {
      return -openingBalanceLedgerBreakdown.masterTotals.netSigned;
    }
    return Number(activeAccount?.openingBalance) || 0;
  }, [
    isOpeningBalanceLedger,
    openingBalanceLedgerBreakdown,
    activeAccount,
    normalClosingBalance,
  ]);
  
  const closingBalance = isOpeningBalanceLedger ? openingBalanceClosingBalance : normalClosingBalance;

  // Get transaction dates for calendar highlighting
  const transactionDates = useMemo(() => {
    if (activeAccount?.id === 'opening_balance_ledger') {
      return [];
    }
    if (!activeAccount?.transactions) return [];
    return activeAccount.transactions
      .map(t => {
        const date = t.date?.toDate ? t.date.toDate() : (t.date instanceof Date ? t.date : new Date(t.date));
        return isNaN(date.getTime()) ? null : date;
      })
      .filter((d): d is Date => d !== null);
  }, [activeAccount]);

  // Opening Balance ledger: current snapshot only — no date-range filter
  const isFilterActive = activeAccount?.id === 'opening_balance_ledger'
    ? false
    : (dateRange !== undefined || Object.values(filters).some((v) => v));

  const clearFilters = () => {
    setDateRange(undefined);
    setFilters({});
  };

  // Flatten all groups and accounts for expanded print with parent/sub group info
  const getAllExpandedRows = useCallback((rows: TrialBalanceRow[]): Array<{name: string, parentGroup?: string, subGroup?: string, debit: number, credit: number, isGroup: boolean}> => {
    const result: Array<{name: string, parentGroup?: string, subGroup?: string, debit: number, credit: number, isGroup: boolean}> = [];
    const flatten = (items: TrialBalanceRow[], level: number = 0, parentGroup?: string, subGroup?: string) => {
      items.forEach(item => {
        const currentParentGroup = level === 0 ? item.name : parentGroup;
        const currentSubGroup = level === 1 ? item.name : subGroup;
        
        if (item.isGroup) {
          // Group row - no amounts when expanded
          result.push({
            name: item.name,
            parentGroup: level === 0 ? item.name : parentGroup,
            subGroup: level === 1 ? item.name : subGroup,
            debit: 0,
            credit: 0,
            isGroup: true
          });
          if (item.subRows.length > 0) {
            flatten(item.subRows, level + 1, currentParentGroup, currentSubGroup);
          }
        } else {
          // Account row - show amounts
          result.push({
            name: item.name,
            parentGroup: currentParentGroup,
            subGroup: currentSubGroup,
            debit: item.debit,
            credit: item.credit,
            isGroup: false
          });
        }
      });
    };
    flatten(rows);
    return result;
  }, []);

  const handlePrintTrialBalance = (expandAll: boolean) => {
    if (!company) return;
    
    const rowsToPrint = expandAll ? getAllExpandedRows(trialBalanceData) : filtered;
    
    let dateRangeText = "All Time";
    if (dateRange?.from) {
      const from = dateRange.from;
      const to = dateRange.to || from;
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;
      
      if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD}${to !== from ? ` to ${toAD}` : ''}`;
      else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS}${to !== from ? ` to ${toBS}` : ''}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }

    // Helper function to format currency without Rs. symbol (for print)
    const formatAmountForPrint = (amount: number): string => {
      if (typeof amount !== 'number' || isNaN(amount) || amount === 0) return '-';
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.abs(amount));
    };

    // Build table header based on expand mode
    const showColumns = expandAll;
    const body: any[] = [
      showColumns ? [
        { text: 'Parent Group', bold: true, fontSize: 10 },
        { text: 'Sub Group', bold: true, fontSize: 10 },
        { text: 'Account Name', bold: true, fontSize: 10 },
        { text: 'Debit', bold: true, fontSize: 10, alignment: 'right' },
        { text: 'Credit', bold: true, fontSize: 10, alignment: 'right' }
      ] : [
        { text: 'Group / Account Name', bold: true, fontSize: 10 },
        { text: 'Debit', bold: true, fontSize: 10, alignment: 'right' },
        { text: 'Credit', bold: true, fontSize: 10, alignment: 'right' }
      ]
    ];

    rowsToPrint.forEach(row => {
      if (showColumns && expandAll) {
        // Expanded mode with columns
        const rowData = row as any;
        body.push([
          { text: rowData.parentGroup || '', fontSize: rowData.isGroup ? 9 : 8, bold: rowData.isGroup },
          { text: rowData.subGroup || '', fontSize: rowData.isGroup ? 9 : 8, bold: rowData.isGroup },
          { text: rowData.name, fontSize: rowData.isGroup ? 9 : 8, bold: rowData.isGroup },
          { text: rowData.isGroup ? '-' : formatAmountForPrint(rowData.debit), fontSize: rowData.isGroup ? 9 : 8, alignment: 'right', bold: rowData.isGroup },
          { text: rowData.isGroup ? '-' : formatAmountForPrint(rowData.credit), fontSize: rowData.isGroup ? 9 : 8, alignment: 'right', bold: rowData.isGroup }
        ]);
      } else {
        // Collapsed mode - single column
        const showAmounts = !(row as any).isGroup || !expandAll;
        body.push([
          { text: (row as any).name, fontSize: (row as any).isGroup ? 9 : 8, bold: (row as any).isGroup },
          { text: showAmounts ? formatAmountForPrint((row as any).debit) : '-', fontSize: (row as any).isGroup ? 9 : 8, alignment: 'right', bold: (row as any).isGroup },
          { text: showAmounts ? formatAmountForPrint((row as any).credit) : '-', fontSize: (row as any).isGroup ? 9 : 8, alignment: 'right', bold: (row as any).isGroup }
        ]);
      }
    });

    // Add totals
    body.push([
      { text: 'TOTAL', bold: true, fontSize: 10, colSpan: showColumns ? 3 : 1 },
      ...(showColumns ? [{}, {}] : []),
      { text: formatAmountForPrint(totals.debit), bold: true, fontSize: 10, alignment: 'right' },
      { text: formatAmountForPrint(totals.credit), bold: true, fontSize: 10, alignment: 'right' }
    ]);

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
      title: "Trial Balance",
      context: "daybook",
      dateSystem: dateSystem,
      dateRangeText: dateRangeText,
      vouchersCount: 0,
      openingBalance: 0,
      transactions: [],
      customContent: [{
        table: {
          widths: showColumns ? ['*', '*', '*', 'auto', 'auto'] : ['*', 'auto', 'auto'],
          body
        },
        layout: 'lightHorizontalLines'
      }, {
        text: '\nNote: Trial Balance follows the rule: Total Debits = Total Credits',
        fontSize: 10,
        italics: true,
        margin: [0, 10, 0, 0]
      }]
    }, true);
  };

  const handlePrint = () => {
    if (!company || !activeAccount) return;
    
    // For Opening Balance ledger, create custom print data
    if (activeAccount.id === 'opening_balance_ledger') {
      const dateRangeText = "All Time";
      const rows = openingBalanceLedgerBreakdown?.masterRows ?? [];
      const printTransactions = rows.map((acc, index) => ({
        id: `ob_${acc.id}_${index}`,
        date: new Date(),
        type: 'opening_balance',
        voucherNumber: '',
        narration: acc.accountName,
        debit: Number(acc.debit) || 0,
        credit: Number(acc.credit) || 0,
        runningBalance: Number(acc.openingBalance) || 0,
        accountName: acc.accountName,
        amount: acc.openingBalance,
        total: acc.openingBalance,
      }));
      
      openPrintDirect({
        company: {
          name: company.name,
          pan: company.pan,
          phone: company.phone,
          address: company.address,
          decimalPlaces: company.decimalPlaces,
          showDrCr: company.showDrCr,
          showCurrencySymbol: company.showCurrencySymbol,
        },
        title: `Ledger: ${activeAccount.name}`,
        context: "party",
        contextId: activeAccount.id,
        dateSystem: dateSystem,
        dateRangeText: dateRangeText,
        vouchersCount: printTransactions.length,
        openingBalance: 0,
        transactions: printTransactions,
        showNarration: true,
      }, true);
    } else {
      // For other ledgers, use normal print
      const from = dateRange?.from;
      const to = dateRange?.to;
      let dateRangeText = "All Time";
      if (from) {
        const fromBS = formatDateBS(from);
        const toBS = to ? formatDateBS(to) : fromBS;
        const fromAD = formatDate(from);
        const toAD = to ? formatDate(to) : fromAD;
        
        if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD} to ${toAD}`;
        else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS} to ${toBS}`;
        else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
      }
      
      openPrintDirect({
        company: {
          name: company.name,
          pan: company.pan,
          phone: company.phone,
          address: company.address,
          decimalPlaces: company.decimalPlaces,
          showDrCr: company.showDrCr,
          showCurrencySymbol: company.showCurrencySymbol,
        },
        title: `Ledger: ${activeAccount.name}`,
        context: accountContext,
        contextId: activeAccount.id,
        dateSystem: dateSystem,
        dateRangeText: dateRangeText,
        vouchersCount: processedTransactions.length,
        openingBalance: openingBalanceForPeriod,
        transactions: processedTransactions,
        showNarration: true,
        userNames: userNames,
      }, true);
    }
  };
  
  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <Card className="border-0 shadow-none flex-1 flex flex-col min-h-0">
        <CardHeader className="p-0 px-4 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="text-2xl">Trial Balance</CardTitle>
              <CardDescription>A summary of all ledger balances, grouped by their parent group.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowPrintDialog(true)}
              className="flex-shrink-0"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 py-3 px-4">
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  // Recursively get all group IDs at all levels
                  const getAllGroupIds = (rows: TrialBalanceRow[]): string[] => {
                    const groupIds: string[] = [];
                    rows.forEach(row => {
                      if (row.isGroup && row.subRows.length > 0) {
                        groupIds.push(row.id);
                        // Recursively get nested group IDs
                        groupIds.push(...getAllGroupIds(row.subRows));
                      }
                    });
                    return groupIds;
                  };
                  
                  const allGroupIds = getAllGroupIds(trialBalanceData);
                  const allExpanded = allGroupIds.length > 0 && allGroupIds.every(id => expandedGroups.has(id));
                  
                  if (allExpanded) {
                    // Collapse all
                    setExpandedGroups(new Set());
                  } else {
                    // Expand all (including nested groups)
                    setExpandedGroups(new Set(allGroupIds));
                  }
                }}
                className="flex items-center gap-2"
              >
                {(() => {
                  // Check if all groups (including nested) are expanded
                  const getAllGroupIds = (rows: TrialBalanceRow[]): string[] => {
                    const groupIds: string[] = [];
                    rows.forEach(row => {
                      if (row.isGroup && row.subRows.length > 0) {
                        groupIds.push(row.id);
                        groupIds.push(...getAllGroupIds(row.subRows));
                      }
                    });
                    return groupIds;
                  };
                  const allGroupIds = getAllGroupIds(trialBalanceData);
                  const allExpanded = allGroupIds.length > 0 && allGroupIds.every(id => expandedGroups.has(id));
                  
                  return allExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4" /> Collapse All
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" /> Expand All
                    </>
                  );
                })()}
              </Button>
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
                <Input
                  placeholder="Search account or group…"
                  className="pl-8"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'entity' | 'balance' | 'date')}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="entity">Entity</option>
                <option value="balance">Balance</option>
                <option value="date">Date</option>
              </select>
              <Button variant="outline" size="sm" onClick={() => setSortDesc((s) => !s)}>
                <ArrowUpDown className="mr-2 h-4 w-4" /> {sortDesc ? "Desc" : "Asc"}
              </Button>
            </div>
          </div>

          <div className={cn("rounded-lg border flex-1 flex flex-col min-h-0", isMobile && "overflow-x-auto")}>
            <div className={cn("flex-1 flex flex-col min-h-0", isMobile && "min-w-[600px]")}>
            <div className="flex-1 overflow-y-auto min-h-0">
                <Table className={cn(isMobile && "min-w-[600px]")}>
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                        {expandedGroups.size > 0 ? (
                          <>
                            <TableHead className="pl-6 py-3">Parent Group</TableHead>
                            <TableHead className="py-3">Sub Group</TableHead>
                            <TableHead className="py-3">Account Name</TableHead>
                            <TableHead className="text-right pr-6 py-3">Debit</TableHead>
                            <TableHead className="text-right pr-6 py-3">Credit</TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead className="w-[50%] pl-6 py-3">Group / Account Name</TableHead>
                            <TableHead className="text-right pr-6 py-3">Debit</TableHead>
                            <TableHead className="text-right pr-6 py-3">Credit</TableHead>
                          </>
                        )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map(group => (
                          <GroupRow 
                            key={group.id} 
                            group={group} 
                            level={0} 
                            onAccountClick={openDetail} 
                            expandedGroups={expandedGroups} 
                            toggleGroup={toggleGroup}
                            hasAnyExpanded={expandedGroups.size > 0}
                          />
                        ))}
                         {filtered.length === 0 && (
                           <TableRow>
                             <TableCell colSpan={expandedGroups.size > 0 ? 5 : 3} className="text-center py-8 text-muted-foreground">
                               No matching records found.
                             </TableCell>
                           </TableRow>
                         )}
                    </TableBody>
                </Table>
            </div>
             <Table className={cn(isMobile && "min-w-[600px]")}>
                 <TableFooter>
                    <TableRow>
                        <TableCell colSpan={expandedGroups.size > 0 ? 3 : 1} className="font-bold text-lg pl-6">TOTAL</TableCell>
                        <TableCell className="text-right font-bold text-lg tabular-nums pr-6">{toNepaliCurrency(totals.debit)}</TableCell>
                        <TableCell className="text-right font-bold text-lg tabular-nums pr-6">{toNepaliCurrency(totals.credit)}</TableCell>
                    </TableRow>
                    {Math.abs(totals.debit - totals.credit) > 0.01 && (
                      <TableRow className="bg-destructive/10">
                          <TableCell colSpan={expandedGroups.size > 0 ? 3 : 1} className="font-bold text-destructive pl-6">Difference</TableCell>
                          <TableCell colSpan={2} className="text-right font-bold text-destructive tabular-nums pr-6">
                              {toNepaliCurrency(Math.abs(totals.debit - totals.credit))}
                          </TableCell>
                      </TableRow>
                    )}
                </TableFooter>
              </Table>
            </div>
          </div>
          <p className="mt-2 text-sm opacity-80 px-4">
            Note: Trial Balance follows the rule: Total Debits = Total Credits
          </p>
        </CardContent>
      </Card>

      {/* PRINT OPTIONS DIALOG */}
      <PrintOptionsDialog
        open={showPrintDialog}
        onOpenChange={setShowPrintDialog}
        onSelect={(option) => {
          if (option === 'expand') {
            handlePrintTrialBalance(true);
          } else {
            handlePrintTrialBalance(false);
          }
        }}
      />

      {/* DETAIL DIALOG */}
      <Dialog open={!!activeAccount} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent 
          className="w-[80vw] h-[95vh] max-w-none max-h-[95vh] flex flex-col p-0"
          style={{ width: '80vw', height: '95vh' }}
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-xl">Ledger: {activeAccount?.name}</DialogTitle>
            <DialogDescription>
              View transactions and balance for this ledger account
            </DialogDescription>
          </DialogHeader>
          
          {/* Filters and Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b">
            <div className="flex flex-wrap items-center gap-4">
              {/* Date Filters - Show for all ledgers including Opening Balance */}
              <div className="flex items-center gap-2">
                {(dateSystem === "BS" || dateSystem === "Both") && (
                  <BsDatePicker
                    isRange
                    valueAD={dateRange}
                    onChangeAD={(range) => setDateRange(range as DateRange | undefined)}
                    transactionDates={transactionDates}
                  />
                )}
                {(dateSystem === "AD" || dateSystem === "Both") && (
                  <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-auto justify-start text-left font-normal",
                          !dateRange && "text-muted-foreground",
                          dateSystem === "Both" && "w-[260px]"
                        )}
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
                              setDateRange({
                                from: new Date(r.from.getFullYear(), r.from.getMonth(), r.from.getDate(), 12),
                                to: new Date(r.to.getFullYear(), r.to.getMonth(), r.to.getDate(), 12),
                              });
                              setIsCalendarOpen(false);
                            }}
                          />
                        }
                        valueAD={dateRange}
                        isRange
                        numberOfMonths={calendarMonths}
                        transactionDates={transactionDates}
                        onSelect={(adDate) => {
                          const atNoon = new Date(adDate.getFullYear(), adDate.getMonth(), adDate.getDate(), 12);
                          const range = dateRange;
                          if (!range?.from || (range.from && range.to)) {
                            setDateRange({ from: atNoon, to: undefined });
                          } else if (adDate < range.from) {
                            setDateRange({ from: atNoon, to: new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate(), 12) });
                            setIsCalendarOpen(false);
                          } else {
                            setDateRange({ from: range.from, to: atNoon });
                            setIsCalendarOpen(false);
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              
              {/* Clear Filters Button */}
              {isFilterActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <XCircle className="mr-2 h-4 w-4"/>Clear Filters
                </Button>
              )}
            </div>
            
            {/* Print Button */}
            <Button onClick={() => setShowDetailPrintDialog(true)} variant="outline" size="sm">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>

          {/* Transactions Table or Opening Balance Accounts List */}
          <ScrollArea className="flex-1 px-6 pb-6 print:p-0">
            {activeAccount && (
              <div className="print:p-0">
                {activeAccount.id === 'opening_balance_ledger' ? (
                  <div className="py-4">
                    {openingBalanceLedgerBreakdown ? (
                      <OpeningBalanceLedgerAccountsTable
                        breakdown={openingBalanceLedgerBreakdown}
                        formatCurrency={formatCurrencyForPrint}
                        interactionLocked={openingBalanceEditOpen}
                        onRowActivate={handleOpeningBalanceRowActivate}
                      />
                    ) : null}
                  </div>
                ) : (
                  // Normal transactions table for other ledgers
                  <TransactionsTable 
                    context={accountContext}
                    contextId={activeAccount.id}
                    transactions={processedTransactions}
                    openingBalance={openingBalanceForPeriod}
                    periodDr={periodDr}
                    periodCr={periodCr}
                    closingBalance={closingBalance}
                    filters={filters}
                    setFilters={setFilters}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    userNames={userNames}
                  />
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* DETAIL PRINT OPTIONS DIALOG */}
      <PrintOptionsDialog
        open={showDetailPrintDialog}
        onOpenChange={setShowDetailPrintDialog}
        onSelect={(option) => {
          // For detail dialog, both options print the same (current transactions)
          handlePrint();
        }}
      />
      <OpeningBalanceMasterEditHost
        row={openingBalanceEditRow}
        open={openingBalanceEditOpen}
        onOpenChange={handleOpeningBalanceEditOpenChange}
      />
    </div>
  );
}

