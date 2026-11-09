"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search } from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useCompany } from "@/hooks/useCompany";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { AccountDetails } from "@/components/account/AccountDetails";
import { AccountList } from "@/components/bank-cash/AccountList";
import type { Account } from "@/components/bank-cash/types";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useRouter } from "next/navigation";
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";

// ✅ Custom Hook Import
import { usePageMemory } from "@/hooks/usePageMemory";

// Define a unified type for accounts in the journal context
type JournalAccount = {
    id: string;
    accountName: string;
    accountType: string;
    balance: number;
    openingBalance?: number;
    debit?: number;
    credit?: number;
    companyId?: string;
    ownerId?: string;
    [key: string]: any; // Allow other properties
};

export default function JournalPage() {
    const { companyId } = useCompany();
    const { user } = useAuth();
    const router = useRouter();
    const { formatCurrency } = useDate();
    const { vouchers: allVouchers, loading: vouchersLoading, processedAccounts, journalAccountNames, processedParties, processedStaff, processedTaxes, expenseAccounts: unprocessedExpenseAccounts } = useVouchers();
    
    const [loading, setLoading] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState<JournalAccount | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [userNames, setUserNames] = useState<Record<string, string>>({});

    const journalVouchers = useMemo(() => allVouchers.filter(v => v.type === 'journal' && v.subType !== 'add_salary'), [allVouchers]);

    useEffect(() => {
        setLoading(vouchersLoading);
    }, [vouchersLoading]);

    // Clear search when company changes (prevent email/other data from carrying over)
    useEffect(() => {
        setSearchTerm("");
    }, [companyId]);

    const fetchUserName = useCallback(async (userId: string): Promise<string> => {
      if (userNames[userId] && userNames[userId] !== "Unknown") return userNames[userId];
      try {
          // User doc ID may be name_uid format, so query by uid field first
          const q = query(collection(firestore, "users"), where("uid", "==", userId));
          const snap = await getDocs(q);
          let data = snap.docs[0]?.data();
          
          if (!data) {
              // Fallback: doc ID might be uid (legacy)
              const userDoc = await getDoc(doc(firestore, 'users', userId));
              if (userDoc.exists()) {
                  data = userDoc.data();
              }
          }
          
          if (data) {
              // Get displayName from user document - this is the primary field
              const displayName = data.displayName || data.name || data.email || null;
              if (displayName && displayName !== userId && !displayName.match(/^[a-zA-Z0-9_-]{20,}$/)) {
                  return displayName;
              }
          }
      } catch (e) {}
      return "N/A"; // Return N/A instead of Unknown
    }, [userNames]);

    useEffect(() => {
        const uids = new Set(allVouchers.map((t) => t.userId).filter(Boolean) as string[]);
        uids.forEach(async (uid) => {
            if (!userNames[uid]) {
                const name = await fetchUserName(uid);
                setUserNames((prev) => ({ ...prev, [uid as any]: name }));
            }
        });
    }, [allVouchers, userNames, fetchUserName]);

    const allAccounts = useMemo(() => {
        const accounts: JournalAccount[] = [];
        processedParties.forEach(p => accounts.push({ ...p, id: p.id, accountName: p.name, accountType: 'Party' }));
        processedStaff.forEach(s => accounts.push({ ...s, id: s.id, accountName: s.name, accountType: 'Staff' }));
        processedAccounts.forEach(a => accounts.push({ ...a, id: a.id, accountName: a.accountName, accountType: a.accountType }));
        processedTaxes.forEach(t => accounts.push({ ...t, id: t.id, accountName: t.name, accountType: 'Tax' }));
        unprocessedExpenseAccounts.forEach(e => accounts.push({ ...e, id: e.id, accountName: e.name, accountType: 'Expense' }));
        return accounts;
    }, [processedParties, processedStaff, processedAccounts, processedTaxes, unprocessedExpenseAccounts]);

    const accountsWithJournal = useMemo(() => {
        if (loading || journalVouchers.length === 0) return [];
        
        const accountIds = new Set<string>();
        journalVouchers.forEach(v => {
            (v.entries || []).forEach((e: any) => {
                if (e.accountId) accountIds.add(e.accountId);
            });
        });
        
        return allAccounts.filter(p => accountIds.has(p.id));
    }, [journalVouchers, allAccounts, loading]);

    // ========== MEMORY LOGIC ==========
    usePageMemory(
        "journalPageState", 
        "accounts", // Static View Name
        () => {},  // No-op setter
        selectedAccount,                 
        (account) => setSelectedAccount(account),              
        accountsWithJournal, 
        vouchersLoading           
    );
    // ==================================

    const handleSelectAccount = useCallback((account: JournalAccount) => {
        setShowAllCompanyVouchers(false);
        setSelectedAccount(account);
    }, []);
    
    // (Old Auto-Select Removed)

    const filteredAccounts = useMemo(() => {
        return accountsWithJournal.filter(p => 
            p.accountName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [accountsWithJournal, searchTerm]);
    
    const accountTransactions = useMemo(() => {
        if (!selectedAccount) return [];
        return journalVouchers.filter(v => v.entries?.some((e: any) => e.accountId === selectedAccount.id));
    }, [journalVouchers, selectedAccount]);

    const allJournalAccount = useMemo(() => {
        if (!showAllCompanyVouchers) return null;
        return {
            id: 'all',
            accountName: 'All Journal Vouchers',
            balance: 0, 
            openingBalance: 0,
            accountType: 'journal_view',
        } as unknown as JournalAccount;
    }, [showAllCompanyVouchers]);
    
    const totalJournalAmount = useMemo(() => journalVouchers.reduce((sum, v) => sum + (v.total || 0), 0), [journalVouchers]);

    const currentAccount = showAllCompanyVouchers ? allJournalAccount : selectedAccount;
    const currentTransactions = showAllCompanyVouchers ? journalVouchers : accountTransactions;

    if (loading) {
        return (
          <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4 p-4 h-full">
            <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-full w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-full w-full" /></div>
          </div>
        );
    }
    
    return (
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] h-full">
            <div className="flex flex-col min-h-0 border-r h-full">
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold font-headline">Journal Vouchers</h1>
                    <p className="text-sm text-muted-foreground">Manage your journal entries for adjustments and non-cash transactions.</p>
                </div>
                <div className="p-4 border-b space-y-4">
                    <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="journal">
                        <PermissionButton permission="create_records" className="w-full">
                            <PlusCircle className="mr-2 h-4 w-4" /> Create Journal Voucher
                        </PermissionButton>
                    </AddVoucherDialog>
                    
                    <Card className="p-4 text-center bg-background shadow-sm">
                        <p className="text-sm text-muted-foreground">Total Journal Amount</p>
                        <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalJournalAmount, { noSuffix: true })}</p>
                        <Button 
                            variant="link" 
                            size="sm" 
                            className="mt-1 h-auto p-0 text-xs" 
                            onClick={() => setShowAllCompanyVouchers(true)}
                        >
                            View All Entries
                        </Button>
                    </Card>

                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search accounts..." className="pl-9 bg-background" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
                    </div>
                </div>
                <div className="px-4 pt-2 pb-1 border-b bg-muted/30">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Accounts Involved ({filteredAccounts.length})</h3>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                     <AccountList accounts={filteredAccounts as any} onSelectAccount={handleSelectAccount as any} selectedAccount={selectedAccount as any} searchTerm={searchTerm}/>
                </div>
            </div>

            <div className="flex flex-col min-h-0">
                 {currentAccount ? (
                   <AccountDetails
                      account={currentAccount as any}
                      allAccounts={allAccounts as any}
                      transactions={currentTransactions}
                      onAccountUpdated={() => {}}
                      onAccountDeleted={() => setSelectedAccount(null)}
                      onShowAll={() => setShowAllCompanyVouchers(true)}
                      dateRange={dateRange}
                      onDateRangeChange={setDateRange}
                      userNames={userNames}
                      journalAccountNames={journalAccountNames}
                      isAllVouchersView={showAllCompanyVouchers}
                    />
                ): (
                    <div className="flex flex-1 items-center justify-center p-8 bg-muted/10">
                        <Card className="w-full max-w-md text-center shadow-lg">
                             <CardHeader>
                                <CardTitle>No Journal Vouchers Found</CardTitle>
                                <CardDescription>
                                    No journal entries have been recorded yet, or no account is selected.
                                </CardDescription>
                            </CardHeader>
                             <CardContent>
                                <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="journal">
                                    <PermissionButton permission="create_records">
                                        <PlusCircle className="mr-2 h-4 w-4" /> Create First Journal
                                    </PermissionButton>
                                </AddVoucherDialog>
                             </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}