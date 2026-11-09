
"use client";

import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import * as React from "react";
import { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PermissionButton } from "@/components/permission";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Calendar as CalendarIcon, File, Printer, Share2, Layers, BarChart2 } from "lucide-react";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { startOfMonth, endOfMonth, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { useTransactions } from "@/hooks/use-transactions";
import { useCompany } from "@/hooks/useCompany";
import { openPrintDirect, getPdfBlob, type Context } from "@/lib/printDirect";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import NepaliCalendar from "@/components/ui/nepali-calendar";
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
import { Badge } from "@/components/ui/badge";
import * as XLSX from 'xlsx';
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import type { Account } from "@/components/bank-cash/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { isPbOnlySession, resolveUserDisplayName } from "@/lib/pocketbaseData/userDisplayNameSession";

function ContraReportPageContent() {
    const { vouchers, loading, processedAccounts } = useVouchers();
    const isMobile = useIsMobile();
    const { company, companyId } = useCompany();
    const { formatDateBS, formatDate, formatCurrency, dateSystem } = useDate();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [view, setView] = useState<'list' | 'chart'>('list');
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [activeFilter, setActiveFilter] = useState<string | null>(null);

    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(searchParams.get('accountId') || 'all');
    
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        if (typeof window === 'undefined') {
            const today = new Date();
            return { from: startOfMonth(today), to: endOfMonth(today) };
        }
        try {
            const storedRange = localStorage.getItem('contraReportDateRange');
            if (storedRange) {
                const { from, to } = JSON.parse(storedRange);
                return {
                    from: from ? new Date(from) : undefined,
                    to: to ? new Date(to) : undefined
                };
            }
        } catch (error) {
            console.error("Failed to parse date range from localStorage", error);
        }
        const today = new Date();
        return { from: startOfMonth(today), to: endOfMonth(today) };
    });

    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const [journalAccountNames, setJournalAccountNames] = useState<Record<string, string>>({});
    
    useEffect(() => {
        if (dateRange) {
            try {
                localStorage.setItem('contraReportDateRange', JSON.stringify({
                    from: dateRange.from?.toISOString(),
                    to: dateRange.to?.toISOString()
                }));
            } catch (error) {
                console.error("Failed to save date range to localStorage", error);
            }
        }
    }, [dateRange]);
    
    const contraVouchers = useMemo(() => vouchers.filter((v: any) => v.type === 'contra'), [vouchers]);

    const accountsInContra = useMemo(() => {
        const accountSet = new Set<string>();
        contraVouchers.forEach((v: any) => {
            if(v.fromAccountId) accountSet.add(v.fromAccountId);
            if(v.toAccountId) accountSet.add(v.toAccountId);
        });
        return processedAccounts.filter(acc => accountSet.has(acc.id));
    }, [contraVouchers, processedAccounts]);
    
    const accountOptions = useMemo(() => {
        return [
            { value: 'all', label: 'All Accounts' },
            ...accountsInContra.map(acc => ({ value: acc.id, label: acc.accountName }))
        ];
    }, [accountsInContra]);
    
     useEffect(() => {
        const urlAccountId = searchParams.get('accountId');
        if (urlAccountId) {
            setSelectedAccountId(urlAccountId);
        } else if (!selectedAccountId && accountOptions.length > 1) {
            setSelectedAccountId('all');
        }
    }, [accountOptions, selectedAccountId, searchParams]);

    const fetchAccountName = React.useCallback(async (accountId: string): Promise<string> => {
        if (!companyId || !accountId) return 'Unknown Account';
        if (journalAccountNames[accountId]) return journalAccountNames[accountId];
        // Server-only session: no Firebase user; names come from local data (journalAccountNames).
        if (isPbOnlySession()) return 'Unknown Account';

        const collectionsToSearch = ['parties', 'bank_accounts', 'staff', 'items', 'expense_accounts', 'taxes', 'users'];
        const nameFields = ['name', 'accountName', 'name', 'name', 'name', 'name', 'displayName'];

        for (let i = 0; i < collectionsToSearch.length; i++) {
            const collectionName = collectionsToSearch[i];
            const nameField = nameFields[i];
            try {
                const docRef = collectionName === 'users' ? doc(firestore, 'users', accountId) : doc(firestore, `companies/${companyId}/${collectionName}`, accountId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const name = docSnap.data()?.[nameField] || 'Unknown';
                    setJournalAccountNames(prev => ({...prev, [accountId]: name}));
                    return name;
                }
            } catch (e) {}
        }
        setJournalAccountNames(prev => ({...prev, [accountId]: 'Unknown Account'}));
        return 'Unknown Account';
    }, [companyId, journalAccountNames]);
    
    const fetchUserName = useCallback(async (userId: string): Promise<string> => {
        if (userNames[userId]) return userNames[userId];
        return resolveUserDisplayName(userId, "Unknown");
    }, [userNames]);

    useEffect(() => {
        if (!vouchers) return;
        const uids = new Set(vouchers.map((t: any) => t.userId).filter(Boolean) as string[]);
        const newNames: Record<string, string> = {};
        let hasNewNames = false;
        const promises = Array.from(uids).map(async (uid) => {
          if (!userNames[uid]) {
            hasNewNames = true;
            newNames[uid] = await fetchUserName(uid);
          }
        });

        Promise.all(promises).then(() => {
            if(hasNewNames) {
                setUserNames((prev) => ({ ...prev, ...newNames }));
            }
        });
        
        const accountIdsToFetch = new Set<string>();
        contraVouchers.forEach((v: any) => {
            if (v.fromAccountId && !journalAccountNames[v.fromAccountId]) accountIdsToFetch.add(v.fromAccountId);
            if (v.toAccountId && !journalAccountNames[v.toAccountId]) accountIdsToFetch.add(v.toAccountId);
        });
        
        if (accountIdsToFetch.size > 0) {
            Promise.all(Array.from(accountIdsToFetch).map(async id => fetchAccountName(id)));
        }
    }, [vouchers, contraVouchers, userNames, fetchUserName, fetchAccountName, journalAccountNames]);
      
    const getContext = () => {
        if (selectedAccountId === 'all') return 'daybook';
        return 'account';
    };

    const selectedAccount = useMemo(() => 
        selectedAccountId === 'all' ? undefined : processedAccounts.find(a => a.id === selectedAccountId), 
      [processedAccounts, selectedAccountId]);

    const { processedTransactions: transactionsFromHook, openingBalanceForPeriod, periodDr, periodCr, closingBalance } = useTransactions(
        selectedAccount as any,
        getContext(),
        dateRange, 
        undefined, 
        undefined, 
        contraVouchers
    );

    const finalData = useMemo(() => {
        if (selectedAccountId === 'all') {
            let filtered: any[] = contraVouchers;

            if (dateRange?.from) {
                const from = startOfMonth(dateRange.from);
                const to = dateRange.to ? endOfMonth(dateRange.to) : endOfMonth(dateRange.from);
                filtered = filtered.filter((v: any) => {
                   const d = v.date.toDate ? v.date.toDate() : new Date(v.date);
                   return d >= from && d <= to;
                });
            }

            const rows = filtered.map((v: any) => {
                return {
                    ...v,
                    debit: v.amount,  
                    credit: v.amount, 
                    balance: 0,
                    narration: v.narration || "",
                    particulars: `Dr: ${journalAccountNames[v.toAccountId] || v.toAccountId}\nCr: ${journalAccountNames[v.fromAccountId] || v.fromAccountId}`
                };
            });

            const sortedRows = rows.sort((a, b) => {
                const dateA = a.date.toDate ? a.date.toDate() : new Date(a.date);
                const dateB = b.date.toDate ? b.date.toDate() : new Date(b.date);
                return dateB.getTime() - dateA.getTime();
            });

            const totalAmount = sortedRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

            return {
                transactions: sortedRows,
                opening: 0,
                totalDr: totalAmount,
                totalCr: totalAmount,
                closing: 0
            };
        }
        
        return {
            transactions: transactionsFromHook,
            opening: openingBalanceForPeriod,
            totalDr: periodDr,
            totalCr: periodCr,
            closing: closingBalance
        };

    }, [selectedAccountId, contraVouchers, dateRange, transactionsFromHook, journalAccountNames, openingBalanceForPeriod, periodDr, periodCr, closingBalance]);
    

    const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
        const currentFrom = dateRange?.from;
        const currentTo = dateRange?.to;

        if (!currentFrom || (currentFrom && currentTo)) {
            setDateRange({ from: adDate, to: undefined });
        } 
        else {
            if (adDate < currentFrom) {
                setDateRange({ from: adDate, to: currentFrom });
            } else {
                setDateRange({ from: currentFrom, to: adDate });
            }
            setIsCalendarOpen(false);
        }
    };

    const fromPath = searchParams.get('from');

    const handleBack = () => {
        if(fromPath) {
            router.push(fromPath);
        } else {
            router.back();
        }
    }
    
    const handleEditVoucher = (voucher: any) => {
        router.push(`/add-voucher?id=${voucher.id}`);
    };
    
    const dateRangeText = useMemo(() => {
      if (!dateRange?.from) return "All Time";
      const fromBS = formatDateBS(dateRange.from);
      const fromAD = formatDate(dateRange.from);
      if (!dateRange.to || isSameDay(dateRange.from, dateRange.to)) {
          return dateSystem === 'Both' ? `${fromBS} / ${fromAD}` : (dateSystem === 'BS' ? `Miti: ${fromBS}` : fromAD);
      }
      const toBS = formatDateBS(dateRange.to);
      const toAD = formatDate(dateRange.to);
      if (dateSystem === 'Both') return `${fromBS} - ${toBS} / ${fromAD} - ${toAD}`;
      if (dateSystem === 'BS') return `Miti: ${fromBS} - ${toBS}`;
      return `${fromAD} - ${toAD}`;
    }, [dateRange, dateSystem, formatDate, formatDateBS]);
    
    const handlePrint = () => {
        if (!selectedAccountId || !company) return;
        
        let transactionsForPrint: any[] = finalData.transactions;
        if (selectedAccountId === 'all') {
             transactionsForPrint = finalData.transactions.map((t: any) => ({
                 ...t,
                 particulars: `Dr: ${journalAccountNames[t.toAccountId] || 'N/A'}\nCr: ${journalAccountNames[t.fromAccountId] || 'N/A'}`,
                 debit: t.amount,
                 credit: t.amount,
             }));
        }
        
        openPrintDirect({
            company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, decimalPlaces: company.decimalPlaces, showCurrencySymbol: company.showCurrencySymbol, showDrCr: company.showDrCr, logoUrl: company.logoUrl },
            title: `Contra Report: ${selectedAccountId === 'all' ? 'All Accounts' : (journalAccountNames[selectedAccountId] || selectedAccountId)}`,
            context: getContext(),
            contextId: selectedAccountId,
            dateSystem: dateSystem,
            dateRangeText,
            vouchersCount: transactionsForPrint.length,
            openingBalance: finalData.opening,
            transactions: transactionsForPrint,
            showNarration: true,
            journalAccountNames: journalAccountNames
        }, true);
    }

    const handleExcel = () => {
        if (!selectedAccountId) return;
    
        const dataForExport = finalData.transactions.map((t: any) => {
            const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);

            const baseRow = {
                "Date (BS)": formatDateBS(d),
                "Date (AD)": formatDate(d),
                "Voucher No.": t.voucherNumber,
                "Narration": t.narration || "",
            };

            if (selectedAccountId === 'all') {
                return {
                    ...baseRow,
                    "Dr. Account": journalAccountNames[t.toAccountId] || 'N/A',
                    "Cr. Account": journalAccountNames[t.fromAccountId] || 'N/A',
                    "Amount": t.amount,
                };
            } else {
                return {
                    ...baseRow,
                    "Particulars": t.particulars || `Dr: ${journalAccountNames[t.toAccountId] || 'N/A'} / Cr: ${journalAccountNames[t.fromAccountId] || 'N/A'}`,
                    "Debit": t.debit,
                    "Credit": t.credit,
                    "Balance": `${Math.abs(t.balance).toFixed(2)} ${t.balance >= 0 ? 'Dr' : 'Cr'}`
                };
            }
        });

        const summaryRows = selectedAccountId === 'all' 
            ? [ { "Date (BS)": "Total", "Amount": finalData.totalDr } ]
            : [
                { "Date (BS)": "Opening Balance", "Balance": `${Math.abs(finalData.opening).toFixed(2)} ${finalData.opening >= 0 ? 'Dr' : 'Cr'}` },
                { "Date (BS)": "Total", "Debit": finalData.totalDr, "Credit": finalData.totalCr },
                { "Date (BS)": "Closing Balance", "Balance": `${Math.abs(finalData.closing).toFixed(2)} ${finalData.closing >= 0 ? 'Dr' : 'Cr'}` }
            ];

        const finalExcelData = [...dataForExport, {}, ...summaryRows];

        const worksheet = XLSX.utils.json_to_sheet(finalExcelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Contra Report");
    
        XLSX.writeFile(workbook, `${journalAccountNames[selectedAccountId] || 'contra'}_report.xlsx`);
    };
    
    const handleShare = async () => {
        if (!navigator.share) {
            toast.info("Web Share not supported", { description: "Your browser does not support the Web Share API."});
            return;
        }
        if (!selectedAccountId || !company) return;
        const title = "Contra Report";
        const text = "Here is the contra report.";
        try {
            let transactionsForPrint: any[] = finalData.transactions;
            if (selectedAccountId === 'all') {
                transactionsForPrint = finalData.transactions.map((t: any) => ({
                    ...t,
                    particulars: `Dr: ${journalAccountNames[t.toAccountId] || 'N/A'}\nCr: ${journalAccountNames[t.fromAccountId] || 'N/A'}`,
                    debit: t.amount,
                    credit: t.amount,
                }));
            }
            const payload = {
                company: { name: company.name, pan: company.pan, phone: company.phone, address: company.address, decimalPlaces: company.decimalPlaces, showCurrencySymbol: company.showCurrencySymbol, showDrCr: company.showDrCr, logoUrl: company.logoUrl },
                title: `Contra Report: ${selectedAccountId === 'all' ? 'All Accounts' : (journalAccountNames[selectedAccountId] || selectedAccountId)}`,
                context: getContext() as Context,
                contextId: selectedAccountId,
                dateSystem: dateSystem,
                dateRangeText,
                vouchersCount: transactionsForPrint.length,
                openingBalance: finalData.opening,
                transactions: transactionsForPrint,
                showNarration: true,
                journalAccountNames: journalAccountNames
            };
            const blob = await getPdfBlob(payload);
            if (blob) {
                const fileName = `${(selectedAccountId === 'all' ? 'all' : journalAccountNames[selectedAccountId] || selectedAccountId).replace(/\s+/g, "_")}_contra_report.pdf`;
                const file = new (globalThis as any).File([blob], fileName, { type: "application/pdf" });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ title, text, url: window.location.href, files: [file] });
                } else {
                    await navigator.share({ title, text, url: window.location.href });
                }
            } else {
                await navigator.share({ title, text, url: window.location.href });
            }
        } catch (err) {
            if (err instanceof Error && err.name !== "AbortError") {
                toast.error("Share Failed", { description: err.message });
            }
        }
    }


    if (loading && !selectedAccountId) {
        return <LoadingSpinner />;
    }

    return (
        <div className="h-screen flex flex-col">
            <header className="flex flex-col gap-2 p-2 border-b bg-background">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={handleBack}><ArrowLeft /></Button>
                         <h2 className="font-semibold text-sm text-muted-foreground">Contra Report</h2>
                    </div>
                </div>
                 <div className="text-center text-xs text-muted-foreground">{dateRangeText}</div>
                 <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <Combobox
                            options={accountOptions}
                            value={selectedAccountId || ""}
                            onChange={(value) => {
                                const newUrl = new URL(window.location.href);
                                if (value === 'all') {
                                    newUrl.searchParams.set('accountId', 'all');
                                } else {
                                    newUrl.searchParams.set('accountId', value);
                                }
                                window.history.pushState({}, '', newUrl);
                                setSelectedAccountId(value);
                            }}
                            placeholder="Select an account"
                         />
                    </div>
                 </div>
            </header>
            {/* Mobile: no pb-20 so scroll extends to footer; inner pb-24 so last row clears fixed footer */}
            <main className={cn("p-4 space-y-4 flex-1 flex flex-col min-h-0", isMobile ? "overflow-y-auto" : "pb-20")}>
                {selectedAccountId !== 'all' && (
                <div className="grid grid-cols-3 gap-2 text-center">
                    <Card className="p-2"><CardTitle className="text-sm font-medium text-muted-foreground">Balance</CardTitle><p className={cn("font-semibold", finalData.closing >= 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(finalData.closing, {showDrCr: true})}</p></Card>
                    <Card className="p-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Debit</CardTitle><p className="font-semibold text-green-600">{formatCurrency(finalData.totalDr, { noSuffix: true })}</p></Card>
                    <Card className="p-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Credit</CardTitle><p className="font-semibold text-red-600">{formatCurrency(finalData.totalCr, { noSuffix: true })}</p></Card>
                </div>
                )}
                
                 {view === 'chart' && selectedAccountId !== 'all' ? (
                     <RunningBalanceFullChart transactions={finalData.transactions} openingBalance={finalData.opening} />
                 ) : (
                    <>
                         {selectedAccountId !== 'all' && (
                         <div className="bg-muted/30 p-3 mx-0 rounded-lg">
                            <div className="flex justify-between items-center text-sm">
                                <p className="font-semibold text-muted-foreground">Opening Balance</p>
                                <Badge variant="secondary" className={cn("font-normal", finalData.opening >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>
                                    {formatCurrency(finalData.opening, { showDrCr: true })}
                                </Badge>
                            </div>
                        </div>
                        )}
                        {isMobile ? (
                            <div className="pb-24">
                                <TransactionsTable
                                    transactions={finalData.transactions}
                                    context={getContext()}
                                    contextId={selectedAccountId || ""}
                                    onRowClick={handleEditVoucher}
                                    userNames={userNames}
                                    journalAccountNames={journalAccountNames}
                                    filters={filters}
                                    setFilters={setFilters}
                                    activeFilter={activeFilter}
                                    setActiveFilter={setActiveFilter}
                                />
                            </div>
                        ) : (
                                <TransactionsTable
                                    transactions={finalData.transactions}
                                    context={getContext()}
                                    contextId={selectedAccountId || ""}
                                    onRowClick={handleEditVoucher}
                                    userNames={userNames}
                                    journalAccountNames={journalAccountNames}
                                    filters={filters}
                                    setFilters={setFilters}
                                    activeFilter={activeFilter}
                                    setActiveFilter={setActiveFilter}
                                />
                        )}
                    </>
                 )}
            </main>
             <footer className="grid grid-cols-5 items-stretch p-2 border-t bg-white gap-2 fixed bottom-0 left-0 right-0">
                <PermissionButton permission="export_data" className="flex-1 flex flex-col h-auto bg-green-500 hover:bg-green-600 text-white" onClick={handlePrint}>
                    <Printer className="w-5 h-5 mb-1" /> <span className="text-xs">Print</span>
                </PermissionButton>
                <PermissionButton permission="export_data" className="flex-1 flex flex-col h-auto bg-yellow-500 hover:bg-yellow-600 text-white" onClick={handleExcel}>
                    <File className="w-5 h-5 mb-1" /> <span className="text-xs">Excel</span>
                </PermissionButton>
                <Button className="flex-1 flex flex-col h-auto bg-indigo-500 hover:bg-indigo-600 text-white" onClick={handleShare}> <Share2 className="w-5 h-5 mb-1" /> <span className="text-xs">Share</span></Button>
                 <Drawer open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <DrawerTrigger asChild>
                    <Button variant="outline" className="flex-1 flex flex-col h-auto bg-blue-500 hover:bg-blue-600 text-white"><CalendarIcon className="w-5 h-5 mb-1" /> <span className="text-xs">Date</span></Button>
                  </DrawerTrigger>
                  <DrawerContent>
                      <DrawerHeader className="p-4 text-left">
                          <DrawerTitle>Select Date Range</DrawerTitle>
                          <DrawerDescription>
                              Select a starting and ending date for the transaction list.
                          </DrawerDescription>
                      </DrawerHeader>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                          {(dateSystem === 'BS' || dateSystem === 'Both') && (
                          <NepaliCalendar
                              onSelect={handleNepaliSelect}
                              valueAD={dateRange}
                              isRange={true}
                              numberOfMonths={1}
                              />
                          )}
                          {(dateSystem === 'AD' || dateSystem === 'Both') && (
                          <div className="flex-1">
                              <Calendar
                              className="p-0 w-full"
                              classNames={{ table: 'w-full' }}
                              initialFocus
                              mode="range"
                              defaultMonth={dateRange?.from}
                              selected={asCalendarRange(dateRange)}
                              onSelect={(range: DateRange | undefined) => {
                                  setDateRange(range);
                                  if (range?.from && range.to) {
                                      setIsCalendarOpen(false);
                                  }
                              }}
                              numberOfMonths={1}
                              />
                          </div>
                          )}
                      </div>
                      <DrawerFooter className="p-4 pt-2">
                          <DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose>
                      </DrawerFooter>
                  </DrawerContent>
                </Drawer>
                 <Button className="flex-1 flex flex-col h-auto bg-green-500 hover:bg-green-600 text-white" variant="outline" onClick={(e) => { e.stopPropagation(); setView(v => v === 'list' ? 'chart' : 'list')}}>
                  {view === 'list' ? <BarChart2 className="w-5 h-5 mb-1" /> : <Layers className="w-5 h-5 mb-1" />}
                  <span className="text-xs">{view === 'list' ? 'Chart' : 'List'}</span>
                </Button>
            </footer>
        </div>
    );
}

export default function ContraReportPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<LoadingSpinner />}>
      <ContraReportPageContent />
    </Suspense>
  );
}

