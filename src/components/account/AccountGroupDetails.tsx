

"use client";

import * as React from "react";
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Edit, Printer, Users, Calendar as CalendarIcon, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, FilePlus, XCircle, MoreVertical, ArrowLeft, Search, ChevronDown, Columns3 } from "lucide-react";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { useStatementCheckMode } from "@/hooks/useStatementCheckMode";
import { recomputeRunningBalanceTopToBottom } from "@/lib/transactionSort";

import { LedgerFooterTextPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { useTransactionVisibleColumns, COLUMN_LABELS } from "../vouchers/transactionColumnVisibility";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect, useMemo } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "@/lib/utils";
import { startOfDay, endOfDay, format } from "date-fns";
import { Calendar } from "../ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_TITLE_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_PILL_ROW_CN,
} from "@/lib/ledgerHeaderChrome";
import { ScrollArea } from "../ui/scroll-area";
import { useCompany } from "@/hooks/useCompany";
import { EditAccountGroupDialog } from "@/components/bank-cash/EditAccountGroupDialog";
import { AccountFilterDropdown } from "@/components/bank-cash/AccountFilterDropdown";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { Checkbox } from "../ui/checkbox";
import { openPrintDirect } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { useCalendarMonths } from "@/hooks/use-mobile";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";

export function AccountGroupDetails({ 
  group,
  allGroups,
  accounts,
  groupTransactions,
  onGroupUpdated, 
  onGroupDeleted,
  onAccountUpdated,
  dateRange,
  onDateRangeChange,
}: { 
  group: AccountGroup, 
  allGroups: AccountGroup[],
  accounts: Account[],
  groupTransactions: any[],
  onGroupUpdated: () => void, 
  onGroupDeleted: () => void,
  onAccountUpdated: () => void,
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
}) {
  const { dateSystem, formatDateBS, formatDate, formatCurrency } = useDate();
  const calendarMonths = useCalendarMonths();
  const { company, companyId } = useCompany();
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(['all']);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => {
    setCurrentPage(1);
  }, [group.id]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteEntityId, setNoteEntityId] = useState<string | null>(null);
  const [showNarration, setShowNarration] = useState(true);
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuNoTdsFilter } = useTransactionVisibleColumns();

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const filteredTransactions = useMemo(() => {
    return groupTransactions.filter(t => {
      let dateInRange = true;
      if (dateRange?.from) {
        const transactionDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        if (isNaN(transactionDate.getTime())) return false; // Invalid date
        const from = startOfDay(dateRange.from);
        const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
        dateInRange = transactionDate >= from && transactionDate <= to;
      }
      
      let accountIncluded = true;
      if (!selectedAccountIds.includes('all')) {
          if (t.type === 'journal') {
            accountIncluded = t.entries?.some((e: any) => selectedAccountIds.includes(e.accountId));
          } else if (t.type === 'note') {
            accountIncluded = selectedAccountIds.includes(t.entityId);
          } else {
            accountIncluded = selectedAccountIds.includes(t.accountId) || selectedAccountIds.includes(t.toAccountId) || selectedAccountIds.includes(t.fromAccountId);
          }
      }

      return dateInRange && accountIncluded;
    });
  }, [groupTransactions, dateRange, selectedAccountIds]);

  const processedTransactions = useMemo(() => {
    const accountIdsInGroup = accounts.map(p => p.id);
    return filteredTransactions.map(t => {
        let debit = 0;
        let credit = 0;
        const amount = t.total || t.amount || 0;
        
        if (t.type === 'journal' && t.entries) {
            t.entries.forEach((entry: any) => {
                if (accountIdsInGroup.includes(entry.accountId)) {
                    debit += entry.debit || 0;
                    credit += entry.credit || 0;
                }
            });
        } else if (t.type === 'contra') {
             if(accountIdsInGroup.includes(t.toAccountId)) debit += amount;
             if(accountIdsInGroup.includes(t.fromAccountId)) credit += amount;
        } else if (accountIdsInGroup.includes(t.accountId)) {
            if (['payment_in', 'direct_income'].includes(t.type)) debit += amount;
            if (['payment_out', 'direct_expense'].includes(t.type)) credit += amount;
        }

        return { ...t, debit, credit };
    });
  }, [filteredTransactions, accounts]);

  const [statementKeyboardNav, setStatementKeyboardNav] = useState<
    ReadonlyArray<{ id?: string; _rowKey?: string }>
  >([]);
  const statementCheck = useStatementCheckMode({
    companyId,
    context: "group",
    contextId: group?.id,
    viewMode: "statement",
    orderedTransactions: processedTransactions,
    keyboardNavTransactions: statementKeyboardNav,
  });
  const ledgerListForDisplay = useMemo(() => {
    const filtered = statementCheck.filterTransactions([...processedTransactions]);
    if (!statementCheck.checkModeActive) return filtered;
    return recomputeRunningBalanceTopToBottom(filtered, group.openingBalance || 0);
  }, [
    processedTransactions,
    statementCheck.filterTransactions,
    statementCheck.checkModeActive,
    group.openingBalance,
  ]);

  const totalPages = Math.max(1, Math.ceil(ledgerListForDisplay.length / rowsPerPage));
  const paginatedTransactions = ledgerListForDisplay.slice(
      (currentPage - 1) * rowsPerPage,
      currentPage * rowsPerPage
  );
  

  useEffect(() => {
    setStatementKeyboardNav(paginatedTransactions ?? []);
  }, [paginatedTransactions]);
  const handleOpenNoteDialog = (accountId?: string) => {
    if (accounts.length === 1) {
        setNoteEntityId(accounts[0].id);
    } else if (accountId) {
        setNoteEntityId(accountId);
    }
    setIsNoteOpen(true);
  };
  
    const filteredTotals = useMemo(() => {
    return processedTransactions.reduce(
        (acc, t) => {
            acc.debit += t.debit || 0;
            acc.credit += t.credit || 0;
            return acc;
        },
        { debit: 0, credit: 0 }
        );
    }, [processedTransactions]);

  const filteredBalance = (group.openingBalance || 0) + filteredTotals.debit - filteredTotals.credit;
  
  const handlePrint = () => {
    if (!company) return;
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
      else
        dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    openPrintDirect(
      applyLedgerPageToPrintPayload(
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
          title: `Group Statement: ${group.name}`,
          context: 'group',
          contextId: group.id,
          dateSystem: dateSystem,
          dateRangeText: dateRangeText,
          vouchersCount: paginatedTransactions.length,
          openingBalance: group.openingBalance || 0,
          transactions: paginatedTransactions,
          showNarration: showNarration,
        },
        {
          paginatedTransactions,
          openingForPage: group.openingBalance || 0,
          ledgerShowBookOpeningRow: currentPage === 1,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: dateRange?.from,
          dateRange,
        }
      ),
      true
    );
  };

  return (
    <>
    <div className="h-full flex flex-col">
      <Card className="flex-1 flex flex-col min-h-0">
           <CardHeader className="space-y-4 overflow-auto min-h-0 scrollbar-slim-dim print:hidden p-0">
              {/* Row 1: identity + note/print — same cluster/pill gap */}
              <div className={LEDGER_HEADER_OUTER_ROW_CN}>
                <div className={LEDGER_HEADER_IDENTITY_CN}>
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground flex-shrink-0">
                    <Users className="h-6 w-6" />
                  </div>
                  <h2 className={cn(LEDGER_HEADER_TITLE_CN, "text-2xl font-bold font-headline")} title={group.name}>{group.name}</h2>
                  <EditAccountGroupDialog
                    group={group}
                    allGroups={allGroups}
                    onGroupUpdated={onGroupUpdated}
                    onGroupDeleted={onGroupDeleted}
                    hasAccounts={accounts.length > 0 || allGroups.some((g) => (g as any).parentId === group.id)}
                  >
                    <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0">
                      <Edit className="h-4 w-4" />
                    </Button>
                  </EditAccountGroupDialog>
                  <div className="flex items-center gap-1.5 flex-nowrap text-sm flex-shrink-0">
                    <div className="border rounded-md p-2 whitespace-nowrap"><span className="text-muted-foreground">Opening: </span><span className="font-semibold text-blue-600">{formatCurrency(group.openingBalance || 0, { noSuffix: true })}</span></div>
                    <div className="border rounded-md p-2 whitespace-nowrap"><span className="text-muted-foreground">Debit: </span><span className="font-semibold text-green-600">{formatCurrency(filteredTotals.debit, {noSuffix: true})}</span></div>
                    <div className="border rounded-md p-2 whitespace-nowrap"><span className="text-muted-foreground">Credit: </span><span className="font-semibold text-red-600">{formatCurrency(filteredTotals.credit, {noSuffix: true})}</span></div>
                    <div className="border rounded-md p-2 whitespace-nowrap"><span className="text-muted-foreground">Balance: </span><span className={cn("font-semibold", filteredBalance >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(filteredBalance, {showDrCr: true})}</span></div>
                  </div>
                </div>
                <div className={LEDGER_HEADER_PILL_ROW_CN}>
                  <Button variant="outline" size="sm" onClick={() => handleOpenNoteDialog()} className={LEDGER_HEADER_PILL_CN}>
                    <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
                  </Button>
                  <Button variant="outline" size="icon" onClick={handlePrint} className={LEDGER_HEADER_PILL_ICON_CN}>
                    <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
                  </Button>
                </div>
              </div>
              {/* Row 2: date/filter + voucher count — same gap */}
              <div className={LEDGER_HEADER_OUTER_ROW_CN}>
                <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-slim-dim">
                  <div className="flex items-center gap-1.5 flex-nowrap flex-shrink-0">
                    {(dateSystem === 'BS' || dateSystem === 'Both') && (
                      <BsDatePicker isRange valueAD={dateRange} onChangeAD={(range) => onDateRangeChange(range as DateRange | undefined)} />
                    )}
                    {(dateSystem === 'AD' || dateSystem === 'Both') && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            id="date"
                            variant={"outline"}
                            className={cn("w-auto justify-start text-left font-normal", LEDGER_HEADER_PILL_CN, !dateRange && "text-muted-foreground", dateSystem === 'Both' && "w-[260px]")}
                          >
                            <CalendarIcon className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
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
                          <Calendar
                            initialFocus
                            mode="range"
                            defaultMonth={dateRange?.from}
                            selected={asCalendarRange(dateRange)}
                            onSelect={onDateRangeChange}
                            numberOfMonths={calendarMonths}
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <AccountFilterDropdown
                    accounts={accounts}
                    selectedAccountIds={selectedAccountIds}
                    onSelectionChange={setSelectedAccountIds}
                  />
                </div>
                <div className={LEDGER_HEADER_PILL_ROW_CN}>
                  <span className="text-sm font-medium flex-shrink-0">Vouchers: {filteredTransactions.length}</span>
                  <p className="text-sm font-medium flex-shrink-0">Rows</p>
                  <Select
                    value={`${rowsPerPage}`}
                    onValueChange={(value) => {
                      setRowsPerPage(Number(value));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[70px]">
                      <SelectValue placeholder={`${rowsPerPage}`} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {ROWS_PER_PAGE_OPTIONS_DEFAULT.map((pageSize) => (
                        <SelectItem key={pageSize} value={`${pageSize}`}>
                          {pageSize}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
              <ScrollArea txnChrome className="h-full">
                  <div className="p-4 sm:p-6 md:p-8 pt-0">
                      <TransactionsTable transactions={paginatedTransactions} context="group" contextId={group.id} {...statementCheck.tableProps} showNarration={showNarration} visibleColumns={visibleColumns} openingBalance={group.openingBalance}/>
                  </div>
              </ScrollArea>
           </CardContent>
           {/* Footer: Part 1 (count) and Part 2 (pagination) side by side; Part 2 wraps to bottom on small; parts never wrap internally; scroll if needed */}
           <div className="py-2 px-4 sm:px-6 md:px-8 border-t overflow-auto min-h-0 scrollbar-slim-dim">
             <div className={LEDGER_HEADER_OUTER_ROW_CN}>
               <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-slim-dim text-sm text-muted-foreground">
                 <LedgerFooterColumnsMenu>
                <DropdownMenuContent align="start" className="w-52 p-2">
                     {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[]).filter(ledgerColumnMenuNoTdsFilter).map((key) => (
                       <DropdownMenuItem
                         key={key}
                         onSelect={(e) => e.preventDefault()}
                         className="flex items-center gap-2 cursor-pointer"
                       >
                         <Checkbox
                           id={`col-${key}-account-group-ledger`}
                           checked={visibleColumns[key] !== false}
                           onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                         />
                         <label htmlFor={`col-${key}-account-group-ledger`} className="text-sm font-medium cursor-pointer flex-1">
                           {COLUMN_LABELS[key]}
                         </label>
                       </DropdownMenuItem>
                     ))}
                   </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <StatementCheckModeFooterControls
                idPrefix="income-expense-group"
                enabled={statementCheck.checkModeEnabled}
                onEnabledChange={statementCheck.setCheckModeEnabled}
                viewMode="statement"
                hiddenCount={statementCheck.hiddenCount}
              />
               </div>
               <div className={LEDGER_HEADER_PILL_ROW_CN}>
                 <LedgerFooterTextPill>Page {currentPage} of {totalPages}</LedgerFooterTextPill>
                 <div className="flex items-center space-x-1 flex-shrink-0">
                   <Button type="button" variant="chromePill" size="icon" className="h-8 w-8 shrink-0"
                     onClick={() => setCurrentPage(1)}
                     disabled={currentPage === 1}
                   >
                     <span className="sr-only">Go to first page</span>
                     <ChevronsLeft className="h-4 w-4" />
                   </Button>
                   <Button type="button" variant="chromePill" size="icon" className="h-8 w-8 shrink-0"
                     onClick={() => setCurrentPage(currentPage - 1)}
                     disabled={currentPage === 1}
                   >
                     <span className="sr-only">Go to previous page</span>
                     <ChevronLeft className="h-4 w-4" />
                   </Button>
                   <Button type="button" variant="chromePill" size="icon" className="h-8 w-8 shrink-0"
                     onClick={() => setCurrentPage(currentPage + 1)}
                     disabled={currentPage === totalPages}
                   >
                     <span className="sr-only">Go to next page</span>
                     <ChevronRight className="h-4 w-4" />
                   </Button>
                   <Button type="button" variant="chromePill" size="icon" className="h-8 w-8 shrink-0"
                     onClick={() => setCurrentPage(totalPages)}
                     disabled={currentPage === totalPages}
                   >
                     <span className="sr-only">Go to last page</span>
                     <ChevronsRight className="h-4 w-4" />
                   </Button>
                 </div>
                <LedgerFooterTextPill>Total Trxn {processedTransactions.length}</LedgerFooterTextPill>
               </div>
             </div>
           </div>
        </Card>
      </div>
     <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
            <DialogHeader>
                <DialogTitle>Add a New Note for an Account in {group.name}</DialogTitle>
                <DialogDescription>
                    {accounts.length > 1 ? "Select which account this note applies to." : "Record a new note for this account."}
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
                {accounts.length > 1 && !noteEntityId && (
                     <div className="flex flex-col gap-2 p-4">
                        <p className="font-semibold">Select an account for the note:</p>
                        {accounts.map(acc => (
                            <Button key={acc.id} variant="outline" onClick={() => setNoteEntityId(acc.id)}>
                                {acc.accountName}
                            </Button>
                        ))}
                    </div>
                )}
                {noteEntityId && (
                    <CreateNoteForm 
                    onVoucherAction={() => {
                            onAccountUpdated();
                            setIsNoteOpen(false);
                            setNoteEntityId(null);
                        }}
                        initialContext="Bank/Cash"
                        initialEntityId={noteEntityId}
                        compactFooter
                    />
                )}
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
