"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search, Link2 } from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useCompany } from "@/hooks/useCompany";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { PartyDetails } from "@/components/party/PartyDetails";
import { UnifiedPayeeList } from "@/components/party/UnifiedPayeeList";
import type { UnifiedPayee } from "@/components/party/UnifiedPayeeList";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useRouter } from "next/navigation";

// ✅ Custom Hook Import
import { usePageMemory } from "@/hooks/usePageMemory";

export default function PaymentInPage() {
    const { companyId, company } = useCompany();
    const { user } = useAuth();
    const router = useRouter();
    const { formatCurrency } = useDate();
    const { vouchers: allVouchers, loading: vouchersLoading, processedParties, processedStaff, processedTaxes, expenseAccounts: unprocessedExpenseAccounts } = useVouchers();
    
    const [loading, setLoading] = useState(true);
    const [selectedPayee, setSelectedPayee] = useState<UnifiedPayee | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
    const [isVoucherOpen, setIsVoucherOpen] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const [defaultTab, setDefaultTab] = useState<'payment_in' | 'direct_income'>('payment_in');
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
    const [defaultVoucherDataForNew, setDefaultVoucherDataForNew] = useState<{ partyId: string; amount: number; allocations: { voucherId: string; amount: number }[] } | null>(null);

    const paymentInVouchers = useMemo(() => allVouchers.filter(v => ['payment_in', 'direct_income'].includes(v.type)), [allVouchers]);

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

    const payeesWithReceipts = useMemo(() => {
        if (loading || paymentInVouchers.length === 0) return [];
        
        const payeeMap = new Map<string, UnifiedPayee>();

        const addOrUpdatePayee = (id: string, name: string, type: UnifiedPayee['type'], entity: any, amount: number) => {
            if (!payeeMap.has(id)) {
                payeeMap.set(id, { id, name, type, entity, balance: 0 });
            }
            const payee = payeeMap.get(id)!;
            payee.balance += amount;
        };
        
        paymentInVouchers.forEach(v => {
            const amount = v.amount || v.total || 0;
            if (v.partyId) {
                const party = processedParties.find(p => p.id === v.partyId);
                if (party) addOrUpdatePayee(party.id, party.name, 'Party', party, amount);
            } else if (v.staffId) {
                const staff = processedStaff.find(s => s.id === v.staffId);
                if (staff) addOrUpdatePayee(staff.id, staff.name, 'Staff', staff, amount);
            } else if (v.taxAccountId) {
                const tax = processedTaxes.find(t => t.id === v.taxAccountId);
                if (tax) addOrUpdatePayee(tax.id, tax.name, 'Tax', tax, amount);
            } else if (v.incomeAccountId) {
                const incomeAcc = expenseAccounts.find(e => e.id === v.incomeAccountId);
                if (incomeAcc) addOrUpdatePayee(incomeAcc.id, incomeAcc.name, 'Income', incomeAcc, amount);
            } else if (v.payeeName) {
                addOrUpdatePayee(v.payeeName, v.payeeName, 'Other', { id: v.payeeName, name: v.payeeName }, amount);
            }
        });

        return Array.from(payeeMap.values());
    }, [paymentInVouchers, processedParties, processedStaff, processedTaxes, expenseAccounts, loading]);

    // ========== MEMORY LOGIC ==========
    usePageMemory(
        "paymentInPageState", 
        "payees", // Static View Name
        () => {},  // No-op setter
        selectedPayee,                 
        (payee) => setSelectedPayee(payee),              
        payeesWithReceipts, 
        vouchersLoading           
    );
    // ==================================

    const handleSelectPayee = useCallback((payee: UnifiedPayee) => {
        setShowAllCompanyVouchers(false);
        setSelectedPayee(payee);
    }, []);
    
    // (Old Auto-Select Removed)

    const filteredPayees = useMemo(() => {
        return payeesWithReceipts.filter(p => 
            p.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [payeesWithReceipts, searchTerm]);
    
    const payeeTransactions = useMemo(() => {
        if (!selectedPayee) return [];
        return paymentInVouchers.filter(v => {
            // Match by partyId, staffId, taxAccountId, incomeAccountId, or payeeName
            // Also check if the entity matches the selected payee
            const matchesId = (
                (v.partyId === selectedPayee.id) ||
                (v.staffId === selectedPayee.id) ||
                (v.taxAccountId === selectedPayee.id) ||
                (v.incomeAccountId === selectedPayee.id) ||
                (v.payeeName === selectedPayee.id)
            );
            
            // Also check if the entity object matches
            const matchesEntity = selectedPayee.entity && (
                (v.partyId === selectedPayee.entity.id) ||
                (v.staffId === selectedPayee.entity.id) ||
                (v.taxAccountId === selectedPayee.entity.id) ||
                (v.incomeAccountId === selectedPayee.entity.id)
            );
            
            return matchesId || matchesEntity;
        });
    }, [paymentInVouchers, selectedPayee]);

    const allPaymentsEntity = useMemo(() => {
        if (!showAllCompanyVouchers) return null;
        const totalAmount = paymentInVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0);
        return {
            id: 'all',
            name: 'All Receipts',
            type: 'Other',
            balance: totalAmount,
            entity: { id: 'all', name: 'All Receipts', balance: totalAmount, openingBalance: 0 }
        };
    }, [showAllCompanyVouchers, paymentInVouchers]);
    
    const totalPayments = useMemo(() => paymentInVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0), [paymentInVouchers]);

    const currentEntity = showAllCompanyVouchers ? allPaymentsEntity : selectedPayee;
    const currentTransactions = showAllCompanyVouchers ? paymentInVouchers : payeeTransactions;

    const openVoucherDialog = (type: 'payment_in' | 'direct_income') => {
        setDefaultTab(type);
        setIsVoucherOpen(true);
    };

    const enableLinkPaymentToTxns = company?.enableLinkPaymentToTxns === true;
    const isPartySelected = selectedPayee?.type === "Party" && selectedPayee?.id;

    const handleLinkDialogDone = (allocations: { voucherId: string; amount: number }[], receivedAmount: number) => {
        if (!selectedPayee || selectedPayee.type !== "Party") return;
        setDefaultVoucherDataForNew({
            partyId: selectedPayee.id,
            amount: receivedAmount,
            allocations,
        });
        setIsLinkDialogOpen(false);
        setDefaultTab("payment_in");
        setIsVoucherOpen(true);
    };

    const handleVoucherDialogOpenChange = (open: boolean) => {
        setIsVoucherOpen(open);
        if (!open) setDefaultVoucherDataForNew(null);
    };

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
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] h-full w-full overflow-x-hidden">
            <div className="flex flex-col min-h-0 border-r">
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold font-headline">Payments In / Receipts</h1>
                    <p className="text-sm text-muted-foreground">Manage your incoming payments.</p>
                </div>
                <div className="p-4 border-b space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                        <PermissionButton permission="create_records" className="w-full" onClick={() => openVoucherDialog("payment_in")}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Receipt
                        </PermissionButton>
                        <PermissionButton permission="create_records" className="w-full" variant="outline" onClick={() => openVoucherDialog("direct_income")}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Direct Income
                        </PermissionButton>
                    </div>
                    {enableLinkPaymentToTxns && isPartySelected && (
                        <PermissionButton permission="add_link" variant="secondary" className="w-full" onClick={() => setIsLinkDialogOpen(true)}>
                            <Link2 className="mr-2 h-4 w-4" /> Link Payment to Txns
                        </PermissionButton>
                    )}
                    <Card className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Received</p>
                        <p className="text-2xl font-bold text-green-600">{formatCurrency(totalPayments, { noSuffix: true })}</p>
                    </Card>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search payee..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
                    </div>
                </div>
                <div className="px-4 pt-2 pb-1 border-b">
                    <h3 className="text-sm font-semibold">Received From ({filteredPayees.length})</h3>
                </div>
                <UnifiedPayeeList payees={filteredPayees} onSelectPayee={handleSelectPayee} selectedPayee={selectedPayee} searchTerm={searchTerm}/>
            </div>

             <div className="flex flex-col min-h-0 w-full overflow-x-hidden">
                 {currentEntity ? (
                    <div className="w-full overflow-x-auto flex-1 flex flex-col">
                        <PartyDetails
                          party={currentEntity as any}
                          transactions={currentTransactions}
                          onPartyUpdated={() => {}}
                          onPartyDeleted={() => setSelectedPayee(null)}
                          onShowAll={() => setShowAllCompanyVouchers(true)}
                          dateRange={dateRange}
                          onDateRangeChange={setDateRange}
                          isAllVouchersView={showAllCompanyVouchers}
                          userNames={userNames}
                          context="payment-in"
                          mobileFooterVariant="report"
                          mobileReportStickyTitle={showAllCompanyVouchers ? "All Receipts" : "Receipt"}
                        />
                    </div>
                ): (
                    <div className="flex flex-1 items-center justify-center">
                        <Card className="w-full max-w-md text-center">
                             <CardHeader>
                                <CardTitle>No Receipts Recorded</CardTitle>
                                <CardDescription>Create your first payment voucher to see details here.</CardDescription>
                            </CardHeader>
                             <CardContent>
                                <PermissionButton permission="create_records" onClick={() => openVoucherDialog("payment_in")}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Record Receipt
                            </PermissionButton>
                             </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
        <AddVoucherDialog isOpen={isVoucherOpen} onOpenChange={handleVoucherDialogOpenChange} onVoucherCreated={() => {}} defaultTab={defaultTab} defaultVoucherData={defaultVoucherDataForNew ?? undefined} voucher={undefined} />
        {isPartySelected && (
            <LinkPaymentToTxnsDialog
                isOpen={isLinkDialogOpen}
                onOpenChange={setIsLinkDialogOpen}
                partyId={selectedPayee!.id}
                partyName={selectedPayee!.name}
                receivedAmount={0}
                partyOpeningBalance={(selectedPayee as any)?.openingBalance ?? 0}
                onDone={handleLinkDialogDone}
            />
        )}
        </>
    );
}