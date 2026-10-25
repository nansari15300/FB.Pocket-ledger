
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search } from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useCompany } from "@/hooks/useCompany";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { PayeeList, filterPayeeListRows } from "@/components/payee/PayeeList";
import type { UnifiedPayee } from "@/components/payee/PayeeList";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { useVouchers } from "@/hooks/useVouchers";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";

import { PartyDetails } from "@/components/party/PartyDetails";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { ExpenseAccountDetails } from "@/components/expenses/ExpenseAccountDetails";

// ✅ Custom Hook Import
import { usePageMemory } from "@/hooks/usePageMemory";

export default function PaymentOutPage() {
    const { companyId } = useCompany();
    const { user } = useAuth();
    const router = useRouter();
    const { formatCurrency } = useDate();
    const { vouchers: allVouchers, loading: vouchersLoading, processedParties, processedStaff, processedTaxes, expenseAccounts: unprocessedExpenseAccounts } = useVouchers();
    const lastVoucherMsById = useLastVoucherMsByEntityId();
    const { hideSettled } = useEntityListHideSettled();
    
    const [loading, setLoading] = useState(true);
    const [selectedPayee, setSelectedPayee] = useState<UnifiedPayee | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [listQuickFilter, setListQuickFilter] = useState<EntityListQuickFilter>("latest");
    const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
    const [isVoucherOpen, setIsVoucherOpen] = useState(false);
    const [defaultTab, setDefaultTab] = useState<'payment_out' | 'direct_expense'>('payment_out');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [userNames, setUserNames] = useState<Record<string, string>>({});

    const paymentOutVouchers = useMemo(() => allVouchers.filter(v => ['payment_out', 'direct_expense'].includes(v.type)), [allVouchers]);

    useEffect(() => {
        setLoading(vouchersLoading);
    }, [vouchersLoading]);

    // Clear search when company changes (prevent email/other data from carrying over)
    useEffect(() => {
        setSearchTerm("");
    }, [companyId]);

    const expenseAccounts = unprocessedExpenseAccounts;

    const fetchUserName = useCallback(async (userId: string): Promise<string> => {
        if (userNames[userId]) return userNames[userId];
        try {
            const userDoc = await getDoc(doc(firestore, 'users', userId));
            if (userDoc.exists()) {
                return userDoc.data().displayName || userDoc.data().email || "Unknown";
            }
        } catch (e) {}
        return "Unknown";
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

    const payeesWithPayments = useMemo(() => {
        if (loading || paymentOutVouchers.length === 0) return [];
        
        const payeeMap = new Map<string, UnifiedPayee>();
        
        const allEntities = [
            ...processedParties.map(p => ({ ...p, type: 'Party' as const })),
            ...processedStaff.map(s => ({ ...s, type: 'Staff' as const })),
            ...processedTaxes.map(t => ({ ...t, type: 'Tax' as const })),
            ...expenseAccounts.map(e => ({ ...e, type: 'Expense' as const, name: e.name || e.id })),
        ];

        const involvedIds = new Set<string>();
        paymentOutVouchers.forEach(v => {
            if (v.partyId) involvedIds.add(`Party-${v.partyId}`);
            if (v.staffId) involvedIds.add(`Staff-${v.staffId}`);
            if (v.taxAccountId) involvedIds.add(`Tax-${v.taxAccountId}`);
            if (v.expenseAccountId) involvedIds.add(`Expense-${v.expenseAccountId}`);
            if (v.toAccountId) involvedIds.add(`Expense-${v.toAccountId}`);
        });

        allEntities.forEach(entity => {
            const key = `${entity.type}-${entity.id}`;
            if (involvedIds.has(key)) {
                 payeeMap.set(key, { 
                    id: entity.id, 
                    name: (entity as any).name || (entity as any).accountName, 
                    type: entity.type, 
                    entity: entity, 
                    balance: entity.balance || 0
                });
            }
        });
        
        paymentOutVouchers.forEach(v => {
             if (v.payeeName && !payeeMap.has(`Other-${v.payeeName}`)) {
                const otherAmount = paymentOutVouchers
                   .filter(tx => tx.payeeName === v.payeeName)
                   .reduce((sum, tx) => sum + (tx.total || tx.amount || 0), 0);
                payeeMap.set(`Other-${v.payeeName}`, { 
                    id: v.payeeName, 
                    name: v.payeeName, 
                    type: 'Other', 
                    entity: { id: v.payeeName, name: v.payeeName, balance: -otherAmount }, 
                    balance: -otherAmount 
                });
             }
        });

        return Array.from(payeeMap.values());
    }, [paymentOutVouchers, processedParties, processedStaff, processedTaxes, expenseAccounts, loading]);

    // ========== MEMORY LOGIC ==========
    usePageMemory(
        "paymentOutPageState", 
        "payees", // Static View Name
        () => {},  // No-op setter
        selectedPayee,                 
        (payee) => setSelectedPayee(payee),              
        payeesWithPayments, 
        vouchersLoading           
    );
    // ==================================

    const filteredPayees = useMemo(() => {
        return filterPayeeListRows(payeesWithPayments, searchTerm, listQuickFilter, lastVoucherMsById, hideSettled);
    }, [payeesWithPayments, searchTerm, listQuickFilter, lastVoucherMsById, hideSettled]);
    
    const payeeTransactions = useMemo(() => {
        if (!selectedPayee) return [];
        return paymentOutVouchers.filter(v => {
            return (
                (v.partyId === selectedPayee.id) ||
                (v.staffId === selectedPayee.id) ||
                (v.taxAccountId === selectedPayee.id) ||
                (v.expenseAccountId === selectedPayee.id) ||
                (v.toAccountId === selectedPayee.id) ||
                (v.payeeName === selectedPayee.id)
            );
        });
    }, [paymentOutVouchers, selectedPayee]);

    const allPaymentsEntity = useMemo(() => {
        if (!showAllCompanyVouchers) return null;
        const totalAmount = paymentOutVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0);
        return {
            id: 'all',
            name: 'All Payments',
            type: 'Other',
            balance: totalAmount,
            entity: { id: 'all', name: 'All Payments', balance: totalAmount, openingBalance: 0 }
        };
    }, [showAllCompanyVouchers, paymentOutVouchers]);
    
    const totalPayments = useMemo(() => paymentOutVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0), [paymentOutVouchers]);

    const currentEntity = showAllCompanyVouchers ? allPaymentsEntity : selectedPayee;
    const currentTransactions = showAllCompanyVouchers ? paymentOutVouchers : payeeTransactions;

    const openVoucherDialog = (type: 'payment_out' | 'direct_expense') => {
        setDefaultTab(type);
        setIsVoucherOpen(true);
    };

    const handleSelectPayee = useCallback((payee: UnifiedPayee) => {
        setShowAllCompanyVouchers(false);
        setSelectedPayee(payee);
    }, []);

    const renderDetailsView = () => {
        if (!currentEntity) {
            return (
                <div className="flex flex-col items-center justify-center min-h-0 w-full h-full overflow-hidden bg-muted/20">
                     <div className="text-center">
                        <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-medium">Select a Payee</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Select a payee from the list to view their detailed transaction history.
                        </p>
                    </div>
                </div>
            )
        }

        // Handle "All Payments" view
        if (showAllCompanyVouchers && allPaymentsEntity) {
            return (
                <div className="w-full overflow-x-auto flex-1 flex flex-col">
                    <PartyDetails
                        party={allPaymentsEntity as any}
                        transactions={currentTransactions}
                        onPartyUpdated={() => {}}
                        onPartyDeleted={() => setSelectedPayee(null)}
                        onShowAll={() => setShowAllCompanyVouchers(true)}
                        dateRange={dateRange}
                        onDateRangeChange={setDateRange}
                        isAllVouchersView={showAllCompanyVouchers}
                        userNames={userNames}
                        context="payment-out"
                    />
                </div>
            );
        }

        // Handle individual payee views
        if (!selectedPayee) return null;

        switch (selectedPayee.type) {
            case 'Party':
                return <PartyDetails 
                            party={selectedPayee.entity} 
                            allParties={processedParties}
                            transactions={currentTransactions}
                            onPartyUpdated={() => {}} 
                            onPartyDeleted={() => setSelectedPayee(null)} 
                            onShowAll={() => setShowAllCompanyVouchers(true)}
                            dateRange={dateRange}
                            onDateRangeChange={setDateRange}
                            isAllVouchersView={showAllCompanyVouchers}
                            context="payment-out"
                            userNames={userNames}
                        />;
            case 'Staff':
                 return <StaffDetails 
                            staff={selectedPayee.entity} 
                            transactions={currentTransactions}
                            onStaffUpdated={() => {}} 
                            onStaffDeleted={() => setSelectedPayee(null)} 
                            onShowAll={() => setShowAllCompanyVouchers(true)}
                            dateRange={dateRange}
                            onDateRangeChange={setDateRange}
                            isAllVouchersView={showAllCompanyVouchers}
                            context="payment-out"
                            userNames={userNames}
                        />;
            case 'Tax':
                return <TaxDetails 
                            tax={selectedPayee.entity} 
                            allTaxes={processedTaxes}
                            transactions={currentTransactions}
                            onTaxUpdated={() => {}} 
                            onTaxDeleted={() => setSelectedPayee(null)} 
                            onShowAll={() => setShowAllCompanyVouchers(true)}
                            dateRange={dateRange}
                            onDateRangeChange={setDateRange}
                            context="payment-out"
                            userNames={userNames}
                        />;
            case 'Expense':
                return <ExpenseAccountDetails 
                            account={selectedPayee.entity}
                            transactions={currentTransactions}
                            onAccountUpdated={() => {}} 
                            onAccountDeleted={() => setSelectedPayee(null)} 
                            onShowAll={() => setShowAllCompanyVouchers(true)}
                            dateRange={dateRange}
                            onDateRangeChange={setDateRange}
                            isAllVouchersView={showAllCompanyVouchers}
                            context="payment-out"
                            userNames={userNames}
                        />;
            default: // Other
                return <ExpenseAccountDetails 
                            account={{ ...selectedPayee.entity, name: selectedPayee.name, balance: selectedPayee.balance }}
                            transactions={currentTransactions}
                            onAccountUpdated={() => {}} 
                            onAccountDeleted={() => setSelectedPayee(null)} 
                            onShowAll={() => setShowAllCompanyVouchers(true)}
                            dateRange={dateRange}
                            onDateRangeChange={setDateRange}
                            isAllVouchersView={showAllCompanyVouchers}
                            context="payment-out"
                            userNames={userNames}
                        />;
        }
    }


    if (loading) {
        return (
          <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4 p-4 h-full">
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-full w-full" />
            </div>
            <div className="space-y-2">
               <Skeleton className="h-full w-full" />
            </div>
          </div>
        );
      }

    return (
        <>
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] h-full">
            <div className="flex flex-col min-h-0 border-r">
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold font-headline">Payments Out</h1>
                    <p className="text-sm text-muted-foreground">Manage your outgoing payments.</p>
                </div>
                <div className="p-4 border-b space-y-4">
                     <div className="grid grid-cols-2 gap-2">
                        <PermissionButton permission="create_records" className="w-full" onClick={() => openVoucherDialog("payment_out")}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Payment Out
                        </PermissionButton>
                        <PermissionButton permission="create_records" className="w-full" variant="outline" onClick={() => openVoucherDialog("direct_expense")}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Direct Expense
                        </PermissionButton>
                    </div>
                    <Card className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Paid</p>
                        <p className="text-2xl font-bold text-red-600">{formatCurrency(totalPayments, { noSuffix: true })}</p>
                    </Card>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search payee..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
                    </div>
                </div>
                <div className="px-4 pt-2 pb-1 border-b flex-shrink-0">
                    <h3 className="text-sm font-semibold">Paid To ({filteredPayees.length})</h3>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                <PayeeList
                  payees={payeesWithPayments}
                  onSelectPayee={handleSelectPayee}
                  selectedPayee={selectedPayee}
                  searchTerm={searchTerm}
                  quickFilter={listQuickFilter}
                  onQuickFilterChange={setListQuickFilter}
                />
                </div>
            </div>

            <div className="flex flex-col min-h-0 w-full overflow-x-auto">
                {renderDetailsView()}
            </div>
        </div>
        <AddVoucherDialog isOpen={isVoucherOpen} onOpenChange={setIsVoucherOpen} onVoucherCreated={() => {}} defaultTab={defaultTab} />
        </>
    );
}
