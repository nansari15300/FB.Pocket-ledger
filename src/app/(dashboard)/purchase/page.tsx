"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search } from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useCompany } from "@/hooks/useCompany";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { PartyDetails } from "@/components/party/PartyDetails";
import { PartyList } from "@/components/party/PartyList";
import type { Party } from "@/components/party/types";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";

// ✅ Custom Hook Import
import { usePageMemory } from "@/hooks/usePageMemory";

export default function PurchasePage() {
    const { companyId } = useCompany();
    const { user } = useAuth();
    const { formatCurrency } = useDate();
    const { vouchers: allVouchers, loading: vouchersLoading, processedParties } = useVouchers();
    const router = useRouter();
    const isMobile = useIsMobile();
    
    const [loading, setLoading] = useState(true);
    const [selectedParty, setSelectedParty] = useState<any | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [userNames, setUserNames] = useState<Record<string, string>>({});

    const purchaseVouchers = useMemo(() => allVouchers.filter(v => v.type === 'purchase'), [allVouchers]);

    useEffect(() => {
        setLoading(vouchersLoading);
    }, [vouchersLoading]);

    // Clear search when company changes (prevent email/other data from carrying over)
    useEffect(() => {
        setSearchTerm("");
    }, [companyId]);
    
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
    
    const partiesWithPurchases = useMemo(() => {
        if (loading || purchaseVouchers.length === 0) return [];
        const partyIdsWithPurchases = new Set(purchaseVouchers.map(v => v.partyId));
        return processedParties
            .filter(p => partyIdsWithPurchases.has(p.id))
            .map(p => {
                 const purchaseTotal = purchaseVouchers
                    .filter(v => v.partyId === p.id)
                    .reduce((sum, v) => sum + (v.total || 0), 0);
                return { ...p, purchaseTotal };
            });
    }, [purchaseVouchers, processedParties, loading]);

    // ========== MEMORY LOGIC ==========
    usePageMemory(
        "purchasePageState", 
        "parties", // Static Active View
        () => {},  // No-op setter
        selectedParty,                 
        setSelectedParty,              
        partiesWithPurchases, 
        vouchersLoading           
    );
    // ==================================

    const handleSelectParty = (party: Party) => {
        setShowAllCompanyVouchers(false);
        setSelectedParty(party);
        // Note: Mobile navigation logic matches SalePage pattern if needed
    };
    
    const filteredParties = useMemo(() => {
        return partiesWithPurchases.filter(p => 
            p.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [partiesWithPurchases, searchTerm]);
    
    const partyTransactions = useMemo(() => {
        if (!selectedParty) return [];
        return purchaseVouchers.filter(v => v.partyId === selectedParty.id);
    }, [purchaseVouchers, selectedParty]);

     const allPurchasesParty = useMemo(() => {
        if (!showAllCompanyVouchers) return null;
        
        const totalAmount = purchaseVouchers.reduce((sum, v) => sum + (v.total || 0), 0);

        return {
            id: 'all',
            name: 'All Purchase Vouchers',
            debit: 0,
            credit: totalAmount,
            balance: -totalAmount,
            openingBalance: 0,
            purchaseTotal: totalAmount
        };
    }, [showAllCompanyVouchers, purchaseVouchers]);
    
    const totalPurchase = useMemo(() => purchaseVouchers.reduce((sum, v) => sum + (v.total || 0), 0), [purchaseVouchers]);

    const currentParty = showAllCompanyVouchers ? allPurchasesParty : selectedParty;
    const currentTransactions = showAllCompanyVouchers ? purchaseVouchers : partyTransactions;


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
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] h-full w-full overflow-x-hidden">
            <div className={`flex flex-col min-h-0 border-r ${isMobile && currentParty ? 'hidden' : 'flex'}`}>
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold font-headline">Purchases</h1>
                    <p className="text-sm text-muted-foreground">Manage your purchase bills.</p>
                </div>
                <div className="p-4 border-b">
                    <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="purchase">
                        <PermissionButton permission="create_records" className="w-full">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Create Purchase Bill
                        </PermissionButton>
                    </AddVoucherDialog>
                    <Card className="mt-4 p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Purchases</p>
                        <p className="text-2xl font-bold text-red-600">{formatCurrency(totalPurchase, { noSuffix: true })}</p>
                    </Card>
                    <div className="relative mt-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search parties..."
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoComplete="off"
                        />
                    </div>
                </div>
                <div className="px-4 pt-2 pb-1 border-b">
                    <h3 className="text-sm font-semibold">Parties ({filteredParties.length})</h3>
                </div>
                <PartyList parties={filteredParties} onSelectParty={handleSelectParty} selectedParty={selectedParty} searchTerm={searchTerm}/>
            </div>

             <div className={`flex flex-col min-h-0 w-full overflow-x-hidden ${isMobile && !currentParty ? 'hidden' : 'flex'}`}>
                 {currentParty ? (
                    <div className="w-full overflow-x-auto flex-1 flex flex-col">
                        {isMobile && (
                             <div className="p-2 border-b">
                                <Button variant="ghost" onClick={() => setSelectedParty(null)}>← Back</Button>
                             </div>
                        )}
                        <PartyDetails
                          party={currentParty}
                          transactions={currentTransactions}
                          onPartyUpdated={() => {}}
                          onPartyDeleted={() => setSelectedParty(null)}
                          onShowAll={() => setShowAllCompanyVouchers(true)}
                          dateRange={dateRange}
                          onDateRangeChange={setDateRange}
                          isAllVouchersView={showAllCompanyVouchers}
                          userNames={userNames}
                          context="purchase"
                        />
                    </div>
                ): (
                    <div className="flex flex-1 items-center justify-center">
                        <Card className="w-full max-w-md text-center">
                             <CardHeader>
                                <CardTitle>No Purchases Recorded</CardTitle>
                                <CardDescription>Create your first purchase bill to see party details here.</CardDescription>
                            </CardHeader>
                             <CardContent>
                                <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="purchase">
                                    <PermissionButton permission="create_records">
                                        <PlusCircle className="mr-2 h-4 w-4" /> Create Purchase
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