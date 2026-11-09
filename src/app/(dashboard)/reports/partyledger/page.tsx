"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PartyDetails } from "@/components/party/PartyDetails";
import { PartyList } from "@/components/party/PartyList";
import type { Party } from "@/components/party/types";
import { useVouchers } from "@/hooks/useVouchers";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { cn } from "@/lib/utils";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";

export default function PartyLedgerPage() {
  const { formatCurrency } = useDate();
  const { companyId } = useCompany();
  const { vouchers: allVouchers, loading: vouchersLoading, processedParties, journalAccountNames, userNames: vouchersUserNames } = useVouchers();
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const hasAutoSelected = useRef(false);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    try {
      const userDoc = await getDoc(doc(firestore, "users", userId));
      if (userDoc.exists()) {
        return userDoc.data().displayName || userDoc.data().email || "Unknown";
      }
    } catch (_) {}
    return "Unknown";
  }, []);

  useEffect(() => {
    const uids = new Set(allVouchers.map((t) => t.userId).filter(Boolean) as string[]);
    uids.forEach(async (uid) => {
      if (!userNames[uid]) {
        const name = await fetchUserName(uid);
        setUserNames((prev) => ({ ...prev, [uid]: name }));
      }
    });
  }, [allVouchers, userNames, fetchUserName]);

  // Filter to show only parties (not groups) - processedParties already excludes groups
  const allParties = useMemo(() => {
    return processedParties.filter((p) => !(p as any).isSystemAccount);
  }, [processedParties]);

  const totalBalance = useMemo(
    () => allParties.reduce((sum, p) => sum + (p.balance || 0), 0),
    [allParties]
  );

  const partyTransactions = useMemo(() => {
    if (!selectedParty) return [];
    return allVouchers.filter((v) => v.partyId === selectedParty.id);
  }, [allVouchers, selectedParty]);

  const allPartiesParty = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    return {
      id: "all",
      name: "All Party Vouchers",
      debit: 0,
      credit: 0,
      balance: totalBalance,
      openingBalance: 0,
      companyId: companyId || "",
    };
  }, [showAllCompanyVouchers, totalBalance, companyId]);

  const currentParty = showAllCompanyVouchers ? allPartiesParty : selectedParty;
  const currentTransactions = showAllCompanyVouchers ? allVouchers.filter((v) => v.partyId) : partyTransactions;

  const filteredParties = useMemo(() => {
    return allParties.filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allParties, searchTerm]);

  const REPORT_MEMORY_KEY = "reportPartyledgerState";

  useEffect(() => {
    if (allParties.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { partyId?: string }) : null;
      const partyId = saved?.partyId;
      if (partyId) {
        const found = allParties.find((p) => p.id === partyId);
        if (found) {
          setSelectedParty(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedParty(allParties[0]);
  }, [allParties]);

  const handleSelectParty = useCallback((party: Party) => {
    setShowAllCompanyVouchers(false);
    setSelectedParty(party);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ partyId: party.id }));
    } catch (_) {}
  }, []);

  // Merge vouchersUserNames with fetched userNames
  const mergedUserNames = useMemo(() => {
    return { ...vouchersUserNames, ...userNames };
  }, [vouchersUserNames, userNames]);

  if (vouchersLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(280px,max-content)_minmax(0,1fr)] min-h-0 overflow-hidden">
        <div className="flex flex-col min-h-0 border-r overflow-hidden bg-muted/30">
          <div className="p-4 border-b space-y-3 flex-shrink-0">
            <ReportRegisterListHeading>Party Ledger</ReportRegisterListHeading>
            <Card className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Balance</p>
              <p className={cn(
                "text-xl font-bold",
                totalBalance >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {formatCurrency(totalBalance, { showDrCr: true, noSuffix: true })}
              </p>
            </Card>
          </div>
          <div className="p-3 border-b flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search parties..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
            <h3 className="text-sm font-semibold">Parties ({filteredParties.length})</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <PartyList
              parties={filteredParties}
              onSelectParty={handleSelectParty}
              selectedParty={selectedParty}
              searchTerm={searchTerm}
            />
          </div>
        </div>

        <div className="flex flex-col min-h-0 overflow-hidden">
          {currentParty ? (
            <PartyDetails
              party={currentParty}
              allParties={allParties}
              transactions={currentTransactions}
              onPartyUpdated={() => {}}
              onPartyDeleted={() => setSelectedParty(null)}
              onShowAll={() => setShowAllCompanyVouchers(true)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              isAllVouchersView={showAllCompanyVouchers}
              userNames={mergedUserNames}
              journalAccountNames={journalAccountNames}
              context="party-ledger"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <Card className="w-full max-w-md text-center">
                <CardHeader>
                  <CardTitle>Select a party</CardTitle>
                  <CardDescription>
                    Choose a party from the list to view transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {allParties.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No parties found. Create a party to see it here.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
