
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
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useRouter } from "next/navigation";

// ✅ Custom Hook Import
import { usePageMemory } from "@/hooks/usePageMemory";

export default function ContraPage() {
    const { companyId } = useCompany();
    const { user } = useAuth();
    const router = useRouter();
    const { formatCurrency } = useDate();
    const { vouchers: allVouchers, loading: vouchersLoading, processedAccounts, userNames } = useVouchers();
    
    const [loading, setLoading] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
    const [isVoucherOpen, setIsVoucherOpen] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    const contraVouchers = useMemo(() => allVouchers.filter(v => v.type === 'contra'), [allVouchers]);

    useEffect(() => {
        setLoading(vouchersLoading);
    }, [vouchersLoading]);

    // Clear search when company changes (prevent email/other data from carrying over)
    useEffect(() => {
        setSearchTerm("");
    }, [companyId]);
    
    const accountsWithContra = useMemo(() => {
        if (loading) return [];
        const accountIds = new Set<string>();
        contraVouchers.forEach(v => {
            if(v.fromAccountId) accountIds.add(v.fromAccountId);
            if(v.toAccountId) accountIds.add(v.toAccountId);
        });
        // Return all accounts that have contra vouchers, with their real balances from processedAccounts
        // processedAccounts already has correct balances including contra transactions
        return processedAccounts.filter(p => accountIds.has(p.id));
    }, [contraVouchers, processedAccounts, loading]);

    // ========== MEMORY LOGIC ==========
    usePageMemory(
        "contraPageState", 
        "accounts", // Static View Name
        () => {},  // No-op setter
        selectedAccount,                 
        (account) => setSelectedAccount(account),              
        accountsWithContra, 
        vouchersLoading           
    );
    // ==================================

    const handleSelectAccount = useCallback((account: Account) => {
        setShowAllCompanyVouchers(false);
        setSelectedAccount(account);
    }, []);
    
    const filteredAccounts = useMemo(() => {
        return accountsWithContra.filter(p => 
            p.accountName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [accountsWithContra, searchTerm]);
    
    const accountTransactions = useMemo(() => {
        if (!selectedAccount) return [];
        return contraVouchers.filter(v => v.fromAccountId === selectedAccount.id || v.toAccountId === selectedAccount.id);
    }, [contraVouchers, selectedAccount]);

    const allContraAccount = useMemo(() => {
        if (!showAllCompanyVouchers) return null;
        const totalAmount = contraVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0);
        return {
            id: 'all',
            accountName: 'All Contra Vouchers',
            balance: 0,
            openingBalance: 0,
        };
    }, [showAllCompanyVouchers, contraVouchers]);
    
    const totalContra = useMemo(() => contraVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0), [contraVouchers]);

    const currentAccount = showAllCompanyVouchers ? allContraAccount : selectedAccount;
    const currentTransactions = showAllCompanyVouchers ? contraVouchers : accountTransactions;

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
            <div className="flex flex-col min-h-0 border-r">
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold font-headline">Contra</h1>
                    <p className="text-sm text-muted-foreground">Manage transfers between your bank and cash accounts.</p>
                </div>
                <div className="p-4 border-b">
                    <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="contra">
                        <PermissionButton permission="create_records" className="w-full">
                            <PlusCircle className="mr-2 h-4 w-4" /> Create Contra Entry
                        </PermissionButton>
                    </AddVoucherDialog>
                    <Card className="mt-4 p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Transferred</p>
                        <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalContra, { noSuffix: true })}</p>
                         <Button 
                            variant="link" 
                            size="sm" 
                            className="mt-1 h-auto p-0 text-xs" 
                            onClick={() => setShowAllCompanyVouchers(true)}
                        >
                            View All Entries
                        </Button>
                    </Card>
                    <div className="relative mt-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search accounts..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
                    </div>
                </div>
                <div className="px-4 pt-2 pb-1 border-b">
                    <h3 className="text-sm font-semibold">Accounts ({filteredAccounts.length})</h3>
                </div>
                <AccountList accounts={filteredAccounts} onSelectAccount={handleSelectAccount} selectedAccount={selectedAccount} searchTerm={searchTerm}/>
            </div>

             <div className="flex flex-col min-h-0 w-full overflow-x-auto">
                 {currentAccount ? (
                   <AccountDetails
                      account={currentAccount as any}
                      allAccounts={processedAccounts}
                      transactions={currentTransactions}
                      onAccountUpdated={() => {}}
                      onAccountDeleted={() => setSelectedAccount(null)}
                      onShowAll={() => setShowAllCompanyVouchers(true)}
                      dateRange={dateRange}
                      onDateRangeChange={setDateRange}
                      isAllVouchersView={showAllCompanyVouchers}
                      userNames={userNames}
                    />
                ): (
                    <div className="flex flex-1 items-center justify-center">
                        <Card className="w-full max-w-md text-center">
                             <CardHeader>
                                <CardTitle>No Contra Entries</CardTitle>
                                <CardDescription>Create your first contra entry to see account details here.</CardDescription>
                            </CardHeader>
                             <CardContent>
                                <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="contra">
                                    <PermissionButton permission="create_records">
                                        <PlusCircle className="mr-2 h-4 w-4" /> Create Contra
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

    