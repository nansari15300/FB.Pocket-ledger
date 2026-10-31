
"use client";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useCompany } from "@/hooks/useCompany";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Info, XCircle, Calendar as CalendarIcon, Printer, Expand, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Account } from "@/components/bank-cash/types";
import type { Item } from "@/components/items/types";
import type { DateRange } from "@/components/ui/ad-calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isSameDay, format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { collectVoucherCalendarDates } from "@/lib/voucherDateNormalize";
import { useDate } from "@/hooks/useDate";
import { openPrintDirect } from "@/lib/printDirect";
import usePermissions from "@/hooks/usePermissions";
import { Checkbox } from "@/components/ui/checkbox";
import { ItemFilterDropdown } from "../items/ItemFilterDropdown";
import { collection, query, doc, where } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { VoucherTypeFilter } from "../vouchers/VoucherTypeFilter";
import { Badge } from "@/components/ui/badge";
import { Input } from "../ui/input";
import { TransactionsTable } from "../vouchers/TransactionsTable";
import { NarrationNoteSearchInput } from "../vouchers/NarrationNoteSearchInput";
import { useVouchers } from "@/hooks/useVouchers";
import { Skeleton } from "../ui/skeleton";
import { useTransactions } from "@/hooks/use-transactions";
import { useRouter } from "next/navigation";

type Voucher = {
    id: string;
    type: string;
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
};

// 💡 Utility to compute debit, credit, and balance impact
function getTransactionAmounts(transaction: any) {
    const t = transaction;
    const amount = t.total || t.amount || 0;
    let debit = 0;
    let credit = 0;
  
    switch (t.type) {
      case "sale":
      case "direct_income":
      case "payment_in":
        credit = amount;
        break;
      case "purchase":
      case "direct_expense":
      case "payment_out":
        debit = amount;
        break;
      case "contra":
        debit = amount;
        credit = amount;
        break;
      case "journal":
        if (t.entries && Array.isArray(t.entries)) {
          debit = t.entries.reduce((sum: number, e: any) => sum + (Number(e.debit) || 0), 0);
          credit = t.entries.reduce((sum: number, e: any) => sum + (Number(e.credit) || 0), 0);
        }
        break;
    }
  
    return { debit, credit };
  }
  
const getParticularsString = (t: any, names: Record<string, string> = {}) => {
    let particulars: string[] = [];
    if (t.type === 'sale') particulars.push(`To: ${names?.[t.partyId] || t.partyId || 'N/A'}`);
    else if (t.type === 'purchase') particulars.push(`From: ${names?.[t.partyId] || t.partyId || 'N/A'}`);
    else if (t.type === 'payment_in') particulars.push(`From: ${names?.[t.partyId] || names?.[t.staffId] || names?.[t.taxAccountId] || names?.[t.incomeAccountId] || t.payeeName || 'N/A'}`);
    else if (t.type === 'payment_out') particulars.push(`To: ${names?.[t.partyId] || names?.[t.staffId] || names?.[t.taxAccountId] || names?.[t.expenseAccountId] || t.payeeName || 'N/A'}`);
    else if (t.type === 'contra') particulars.push(`${names?.[t.fromAccountId] || t.fromAccountId || 'N/A'} to ${names?.[t.toAccountId] || t.toAccountId || 'N/A'}`);
    else if (t.type === 'direct_income') particulars.push(`By: ${names?.[t.incomeAccountId] || t.payeeName || 'N/A'}`);
    else if (t.type === 'direct_expense') particulars.push(`To: ${names?.[t.toAccountId || t.expenseAccountId] || t.payeeName || 'N/A'}`);
    else if (t.type === 'journal') {
        if (t.entries && Array.isArray(t.entries)) {
            const dr = t.entries.filter((e: any) => e.debit > 0).map((e: any) => `Dr: ${names[e.accountId] || e.accountId ||'N/A'}`);
            const cr = t.entries.filter((e: any) => e.credit > 0).map((e: any) => `Cr: ${names[e.accountId] || e.accountId || 'N/A'}`);
            particulars.push(...dr, ...cr);
        }
    }
    else if (t.type === 'note') {
        particulars.push(`Note for: ${names?.[t.entityId] || t.entityId || 'N/A'}`);
    }
    return particulars.join(', ');
};

interface DaybookReportProps {
  onFullScreenToggle?: () => void;
}


export function DaybookReport({ onFullScreenToggle }: DaybookReportProps) {
    const { vouchers, processedAccounts: accounts } = useVouchers();
    const { company, companyId } = useCompany();
    const { dateSystem, formatDate, formatDateBS, formatCurrency } = useDate();
    const { can } = usePermissions();
    const router = useRouter();
    const [daybookDate, setDaybookDate] = useState<Date | undefined>(undefined);
    const [daybookRowsPerPage, setDaybookRowsPerPage] = useState('all');
    const [daybookVoucherTypes, setDaybookVoucherTypes] = useState<string[]>(['all']);
    const [showDaybookNarration, setShowDaybookNarration] = useState(true);
    const [daybookNarrationNoteSearch, setDaybookNarrationNoteSearch] = useState("");
    const [items, setItems] = useState<Item[]>([]);
    const [journalAccountNames, setJournalAccountNames] = useState<Record<string, string>>({});
    const [isVoucherDialogOpen, setIsVoucherDialogOpen] = React.useState(false);
    const [selectedVoucher, setSelectedVoucher] = React.useState<any>(null);
    const [daybookFilters, setDaybookFilters] = useState<Record<string, string>>({});
    const [activeDaybookFilter, setActiveDaybookFilter] = useState<string | null>(null);
    const [userNames, setUserNames] = React.useState<Record<string, string>>({});
    const [isDateChange, setIsDateChange] = useState(false);

    const handleEditVoucher = (voucher: any) => {
        setSelectedVoucher(voucher);
        setIsVoucherDialogOpen(true);
    };

    useEffect(() => {
      setDaybookDate(new Date());
    }, []);

    const fetchAccountName = useCallback(async (accountId: string): Promise<string> => {
        if (!companyId) return 'Unknown Account';
        
        // Check cache first
        if (journalAccountNames[accountId]) {
            return journalAccountNames[accountId];
        }

        const collectionsToSearch = ['parties', 'bank_accounts', 'staff', 'items', 'expense_accounts', 'taxes', 'users'];
        const nameFields = ['name', 'accountName', 'name', 'name', 'name', 'name', 'displayName'];

        for (let i = 0; i < collectionsToSearch.length; i++) {
            const collectionName = collectionsToSearch[i];
            const nameField = nameFields[i];
            try {
                let data: any = null;
                
                if (collectionName === 'users') {
                    // User doc ID may be name_uid format, so query by uid field first
                    const q = query(collection(firestore, "users"), where("uid", "==", accountId));
                    const snap = await getDocs(q);
                    data = snap.docs[0]?.data();
                    
                    if (!data) {
                        // Fallback: doc ID might be uid (legacy)
                        const docSnap = await getDoc(doc(firestore, "users", accountId));
                        if (docSnap.exists()) {
                            data = docSnap.data();
                        }
                    }
                } else {
                    const docRef = doc(firestore, `companies/${companyId}/${collectionName}`, accountId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        data = docSnap.data();
                    }
                }
                
                if (data) {
                    const name = data[nameField] || 'Unknown';
                    // For users, store in userNames; for others, store in journalAccountNames
                    if (collectionName === 'users') {
                        setUserNames(prev => ({...prev, [accountId]: name}));
                    } else {
                        setJournalAccountNames(prev => ({...prev, [accountId]: name}));
                    }
                    return name;
                }
            } catch (error) {
            }
        }
        
        setJournalAccountNames(prev => ({...prev, [accountId]: 'Unknown Account'}));
        return 'Unknown Account';
    }, [companyId, journalAccountNames, userNames, setUserNames]);


    const loadJournalAccountNames = useCallback(async (vouchersToLoad: Voucher[]) => {
        const accountIdsToFetch = new Set<string>();
        vouchersToLoad.forEach(v => {
            const noteEntityId = (v as any).type === "note" ? (v as any).entityId : undefined;
            if (noteEntityId && !journalAccountNames[noteEntityId]) accountIdsToFetch.add(noteEntityId);
            if (v.type === 'journal' || v.type === 'contra' || v.type === 'payment_in' || v.type === 'payment_out' || v.type === 'direct_income' || v.type === 'direct_expense' || v.type === 'sale' || v.type === 'purchase') {
                (v.entries || []).forEach((entry: any) => {
                    if (entry.accountId && !journalAccountNames[entry.accountId]) accountIdsToFetch.add(entry.accountId);
                });
                if(v.fromAccountId && !journalAccountNames[v.fromAccountId]) accountIdsToFetch.add(v.fromAccountId);
                if(v.toAccountId && !journalAccountNames[v.toAccountId]) accountIdsToFetch.add(v.toAccountId);
                if(v.partyId && !journalAccountNames[v.partyId]) accountIdsToFetch.add(v.partyId);
                if(v.staffId && !journalAccountNames[v.staffId]) accountIdsToFetch.add(v.staffId);
                if(v.accountId && !journalAccountNames[v.accountId]) accountIdsToFetch.add(v.accountId);
                if((v as any).expenseAccountId && !journalAccountNames[(v as any).expenseAccountId]) accountIdsToFetch.add((v as any).expenseAccountId);
                if((v as any).incomeAccountId && !journalAccountNames[(v as any).incomeAccountId]) accountIdsToFetch.add((v as any).incomeAccountId);
                 if((v as any).userId && !userNames[(v as any).userId]) {
                    fetchAccountName((v as any).userId).then(name => setUserNames(prev => ({...prev, [(v as any).userId]: name})))
                }
            }
        });
        
        if (accountIdsToFetch.size > 0) {
            const newNames: Record<string, string> = {};
            for (const accountId of Array.from(accountIdsToFetch)) {
                newNames[accountId] = await fetchAccountName(accountId);
            }
            setJournalAccountNames(prev => ({...prev, ...newNames}));
        }
    }, [fetchAccountName, journalAccountNames, userNames]);


    useEffect(() => {
        if (vouchers.length > 0) {
            loadJournalAccountNames(vouchers as Voucher[]);
        }
    }, [vouchers, loadJournalAccountNames]);

    useEffect(() => {
        if (!companyId) return;
        const unsub = onSnapshot(query(collection(firestore, `companies/${companyId}/items`)), (snap) => {
            setItems(snap.docs.map(d => ({id: d.id, ...d.data()} as Item)))
        });
        return () => unsub();
    }, [companyId]);

    useEffect(() => {
        const savedState = sessionStorage.getItem("showNarration");
        setShowDaybookNarration(savedState !== "false");
    }, []);

    const handleShowNarrationChange = (checked: boolean) => {
        setShowDaybookNarration(checked);
        sessionStorage.setItem("showNarration", String(checked));
    };
    
    const isDaybookFilterActive = useMemo(() => {
        const isTypeFiltered = daybookVoucherTypes.length > 0 && !daybookVoucherTypes.includes('all');
        const isDateFiltered = daybookDate !== undefined && !isSameDay(daybookDate, new Date());
        const isColumnFiltered = Object.values(daybookFilters).some(v => v);
        return isTypeFiltered || isDateFiltered || isColumnFiltered;
    }, [daybookVoucherTypes, daybookDate, daybookFilters]);
    
    const clearDaybookFilters = () => {
        setDaybookDate(new Date());
        setDaybookVoucherTypes(['all']);
        setDaybookFilters({});
    };
    
    const handleDaybookFilterChange = (key: string, value: string) => {
        setDaybookFilters(prev => ({...prev, [key]: value}));
    }

    const transactionDates = useMemo(() => collectVoucherCalendarDates(vouchers), [vouchers]);

    const { daybookTransactions, daybookSummary } = useTransactions(
        {id: 'daybook', items: [] }, 
        'daybook', 
        daybookDate ? {from: daybookDate, to: daybookDate} : undefined, 
        undefined, 
        accounts, 
        vouchers, 
        undefined, 
        daybookFilters, 
        daybookVoucherTypes, 
        journalAccountNames, 
        userNames
      );
    
    const handlePrint = () => {
        if (!company || !daybookSummary) return;
        const dateRange = daybookDate ? { from: daybookDate, to: daybookDate } : undefined;
        let dateRangeText = "All Time";
        if(dateRange?.from) {
            const from = dateRange.from;
            const to = dateRange.to || from;
            const fromBS = formatDateBS(from);
            const toBS = formatDateBS(to);
            const fromAD = formatDate(from);
            const toAD = formatDate(to);
            if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD}${to !== from ? ` to ${toAD}`: ''}`;
            else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS}${to !== from ? ` to ${toBS}`: ''}`;
            else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
        }

        openPrintDirect({
            company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, decimalPlaces: company.decimalPlaces, showDrCr: company.showDrCr, showCurrencySymbol: company.showCurrencySymbol, logoUrl: company.logoUrl },
            title: "Daybook",
            context: 'daybook',
            dateSystem: dateSystem,
            dateRangeText: dateRangeText,
            vouchersCount: daybookTransactions ? daybookTransactions.length : 0,
            openingBalance: 0,
            transactions: daybookTransactions || [],
            showNarration: showDaybookNarration,
            journalAccountNames: journalAccountNames,
            daybookSummary,
        }, true);
    };
    
    const isFullScreen = !!onFullScreenToggle;

    return (
      <div id="daybook-area" className={cn("printable-area", isFullScreen && "flex flex-col h-full")}>
        <Card className={cn("flex-1 flex flex-col min-h-0 border-2 border-foreground", isFullScreen && "h-full")}>
            <CardHeader className="print:hidden">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <CardTitle>Daybook</CardTitle>
                        <CardDescription>All transactions for the selected date.</CardDescription>
                    </div>
                     {onFullScreenToggle && (
                        <Button variant="ghost" size="icon" onClick={onFullScreenToggle}>
                           <Expand className="h-5 w-5" />
                        </Button>
                    )}
                </div>
                 {daybookSummary && (
                    <Card className="mt-4 bg-blue-50 border-blue-200 text-blue-800">
                        <CardHeader className="pb-2 pt-4 px-4">
                             <CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4" />Daily Summary</CardTitle>
                             <CardDescription className="text-blue-700">Only showing bank and cash summary.</CardDescription>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                           <Table>
                            <TableHeader><TableRow><TableHead className="font-bold">Account</TableHead><TableHead className="text-right font-bold">Yesterdays Balance</TableHead><TableHead className="text-right font-bold text-green-600">Todays In</TableHead><TableHead className="text-right font-bold text-red-600">Todays Out</TableHead><TableHead className="text-right font-bold">Todays Balance</TableHead></TableRow></TableHeader>
                            <TableBody>
                                <TableRow><TableCell className="font-medium">Bank</TableCell><TableCell className={cn("text-right", daybookSummary.bank.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(daybookSummary.bank.yesterday)}</TableCell><TableCell className="text-right text-green-600">{formatCurrency(daybookSummary.bank.in, {noSuffix: true})}</TableCell><TableCell className="text-right text-red-600">{formatCurrency(daybookSummary.bank.out, {noSuffix: true})}</TableCell><TableCell className={cn("text-right", daybookSummary.bank.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(daybookSummary.bank.today)}</TableCell></TableRow>
                                <TableRow><TableCell className="font-medium">Cash</TableCell><TableCell className={cn("text-right", daybookSummary.cash.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(daybookSummary.cash.yesterday)}</TableCell><TableCell className="text-right text-green-600">{formatCurrency(daybookSummary.cash.in, {noSuffix: true})}</TableCell><TableCell className="text-right text-red-600">{formatCurrency(daybookSummary.cash.out, {noSuffix: true})}</TableCell><TableCell className={cn("text-right", daybookSummary.cash.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(daybookSummary.cash.today)}</TableCell></TableRow>
                                <TableRow className="font-bold border-t-4 border-foreground"><TableCell>Total</TableCell><TableCell className={cn("text-right", daybookSummary.total.yesterday >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(daybookSummary.total.yesterday)}</TableCell><TableCell className="text-right text-green-600">{formatCurrency(daybookSummary.total.in, {noSuffix: true})}</TableCell><TableCell className="text-right text-red-600">{formatCurrency(daybookSummary.total.out, {noSuffix: true})}</TableCell><TableCell className={cn("text-right", daybookSummary.total.today >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(daybookSummary.total.today)}</TableCell></TableRow>
                            </TableBody>
                           </Table>
                        </CardContent>
                    </Card>
                )}
                 <div className="flex flex-wrap items-center justify-between gap-4 mt-4 print:hidden">
                    <div className="flex items-center gap-2">
                        {(dateSystem === 'BS' || dateSystem === 'Both') && (
                            <BsDatePicker valueAD={daybookDate} onChangeAD={(date) => setDaybookDate(date as Date)} isRange={false} transactionDates={transactionDates} />
                        )}
                        <Button variant="outline" onClick={() => setDaybookDate(new Date())}>Today</Button>
                        {(dateSystem === 'AD' || dateSystem === 'Both') && (
                            <Popover>
                                <PopoverTrigger asChild>
                                <Button
                                    id="date"
                                    variant={"outline"}
                                    className={cn("w-auto justify-start text-left font-normal", !daybookDate && "text-muted-foreground")}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {daybookDate ? format(daybookDate, "PPP") : <span>Pick a date</span>}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        initialFocus
                                        mode="single"
                                        defaultMonth={daybookDate}
                                        selected={daybookDate}
                                        onSelect={setDaybookDate}
                                        modifiers={{ hasTransactions: transactionDates }}
                                        modifiersClassNames={{ hasTransactions: 'has-transactions' }}
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                         {isDaybookFilterActive && (
                            <Button variant="ghost" size="sm" onClick={clearDaybookFilters}><XCircle className="mr-2 h-4 w-4"/>Clear Filters</Button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center space-x-2">
                           <Checkbox id="show-narration-daybook" checked={showDaybookNarration} onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))} />
                           <label htmlFor="show-narration-daybook" className="text-sm font-medium leading-none">Show Narration</label>
                        </div>
                        <NarrationNoteSearchInput
                          id="narration-search-journal-daybook"
                          value={daybookNarrationNoteSearch}
                          onChange={setDaybookNarrationNoteSearch}
                        />
                        <Button variant="outline" size="icon" onClick={handlePrint}><Printer className="h-4 w-4" /></Button>
                        <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium">Rows:</span>
                            <Select value={daybookRowsPerPage} onValueChange={(v) => setDaybookRowsPerPage(v)}>
                                <SelectTrigger className="h-9 w-[80px]">
                                    <SelectValue placeholder={`${daybookRowsPerPage}`} />
                                </SelectTrigger>
                                <SelectContent>
                                    {['15', '30', '50', 'all'].map(size => <SelectItem key={size} value={size}>{size}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Total Vouchers: {daybookTransactions ? daybookTransactions.length : 0}</span>
                    </div>
                </div>
            </CardHeader>
            <CardContent className={cn("flex-1 min-h-0 relative", isFullScreen && "overflow-y-auto")}>
                 {daybookTransactions && daybookTransactions.length > 0 ? (
                <div className="h-full">
                    <ScrollArea className={cn(isFullScreen ? "absolute inset-0" : "h-full")}>
                        <div className="p-4 sm:p-6 md:p-8 pt-0">
                           <TransactionsTable
                                transactions={daybookTransactions} 
                                context="daybook" 
                                showNarration={showDaybookNarration}
                                narrationNoteSearch={daybookNarrationNoteSearch}
                                journalAccountNames={journalAccountNames}
                                userNames={userNames}
                                onRowClick={handleEditVoucher}
                                openingBalance={daybookSummary?.total.yesterday}
                                filters={daybookFilters}
                                setFilters={setDaybookFilters}
                                activeFilter={activeDaybookFilter}
                                setActiveFilter={setActiveDaybookFilter}
                                voucherTypes={daybookVoucherTypes}
                                onVoucherTypeChange={setDaybookVoucherTypes}
                                isDateChange={isDateChange}
                           />
                        </div>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="absolute top-16 left-16 text-8xl font-bold text-muted-foreground/10 transform -rotate-12">
                        DayBook
                    </div>
                    <p className="text-2xl md:text-4xl lg:text-5xl font-bold text-muted-foreground/20 transform -rotate-12 whitespace-nowrap">
                        No Transactions Found
                    </p>
                    <div className="absolute bottom-16 right-16 text-8xl font-bold text-muted-foreground/10 transform -rotate-12">
                        Report
                    </div>
                </div>
              )}
            </CardContent>
        </Card>
        <AddVoucherDialog isOpen={isVoucherDialogOpen} onOpenChange={setIsVoucherDialogOpen} voucher={selectedVoucher} onVoucherCreated={() => setSelectedVoucher(null)} />
      </div>
    );
}
