"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search, ArrowLeft } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PartyDetails } from "@/components/party/PartyDetails";
import { PartyList } from "@/components/party/PartyList";
import type { Party } from "@/components/party/types";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLiveMasterSelection } from "@/hooks/useLiveMasterSelection";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportRegisterDesktopSplit } from "@/components/reports/ReportRegisterDesktopSplit";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { ReportRegisterListSearchRow } from "@/components/reports/ReportRegisterListSearchRow";
import { mdc, mdcNoEdgeSwipeCapture } from "@/lib/mobileDetailChrome";

export function SaleReportDetail() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { companyId } = useCompany();
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedParties } = useFyScopedVouchers();
  const [selectedPartyRaw, setSelectedParty] = useState<Party | null>(null);
  const selectedParty = useLiveMasterSelection(selectedPartyRaw, setSelectedParty, processedParties);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const hasAutoSelected = useRef(false);

  const saleVouchers = useMemo(() => allVouchers.filter((v) => v.type === "sale"), [allVouchers]);

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

  const partiesWithSales = useMemo(() => {
    if (vouchersLoading || saleVouchers.length === 0) return [];
    const partyIdsWithSales = new Set(saleVouchers.map((v) => v.partyId));
    return processedParties
      .filter((p) => partyIdsWithSales.has(p.id))
      .map((p) => {
        const saleTotal = saleVouchers
          .filter((v) => v.partyId === p.id)
          .reduce((sum, v) => sum + (v.total || 0), 0);
        return { ...p, saleTotal };
      });
  }, [saleVouchers, processedParties, vouchersLoading]);

  const totalSales = useMemo(
    () => saleVouchers.reduce((sum, v) => sum + (v.total || 0), 0),
    [saleVouchers]
  );

  const partyTransactions = useMemo(() => {
    if (!selectedParty) return [];
    return saleVouchers.filter((v) => v.partyId === selectedParty.id);
  }, [saleVouchers, selectedParty]);

  const allSalesParty = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    const totalAmount = saleVouchers.reduce((sum, v) => sum + (v.total || 0), 0);
    return {
      id: "all",
      name: "All Sale Vouchers",
      debit: totalAmount,
      credit: 0,
      balance: totalAmount,
      openingBalance: 0,
      saleTotal: totalAmount,
      companyId: companyId || "",
    };
  }, [showAllCompanyVouchers, saleVouchers, companyId]);

  const currentParty = showAllCompanyVouchers ? allSalesParty : selectedParty;
  const currentTransactions = showAllCompanyVouchers ? saleVouchers : partyTransactions;

  const filteredParties = useMemo(() => {
    return partiesWithSales.filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [partiesWithSales, searchTerm]);

  const REPORT_MEMORY_KEY = "reportSaleRegisterState";

  useEffect(() => {
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllCompanyVouchers(true);
        setSelectedParty(null);
      }
      return;
    }
    if (partiesWithSales.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { partyId?: string }) : null;
      const partyId = saved?.partyId;
      if (partyId) {
        const found = partiesWithSales.find((p) => p.id === partyId);
        if (found) {
          setSelectedParty(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedParty(partiesWithSales[0]);
  }, [partiesWithSales, isMobile, searchParams]);

  const handleSelectParty = useCallback((party: Party) => {
    setShowAllCompanyVouchers(false);
    setSelectedParty(party);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ partyId: party.id }));
    } catch (_) {}
  }, []);

  if (vouchersLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  // Mobile: show list first, then details when selected (like party page)
  if (isMobile) {
    if (currentParty) {
      return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PartyDetails
              party={currentParty}
              transactions={currentTransactions}
              onPartyUpdated={() => {}}
              onPartyDeleted={() => { setSelectedParty(null); setShowAllCompanyVouchers(false); }}
              onShowAll={() => setShowAllCompanyVouchers(true)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              isAllVouchersView={showAllCompanyVouchers}
              userNames={userNames}
              context="sale"
              mobileFooterVariant="report"
              mobileReportStickyTitle="Sales"
              onBack={() => { setSelectedParty(null); setShowAllCompanyVouchers(false); }}
            />
          </div>
        </div>
      );
    }
    return (
      <ReportRegisterMobileListChrome
        title="Sales"
        actionSlot={
          <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="sale">
            <PermissionButton permission="create_records" className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Sale Invoice
            </PermissionButton>
          </AddVoucherDialog>
        }
        summary={{
          label: "Total Sales",
          // Chrome summary sirf plain string (`formatCurrency` = ReactNode) — animate desktop total unchanged
          amountText: formatCurrencyForPrint(totalSales, { noSuffix: true }),
          amountClassName: "text-green-600",
        }}
        searchPlaceholder="Search accounts..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        listSectionTitle={`Sale accounts (${filteredParties.length})`}
      >
        <PartyList
          parties={filteredParties}
          onSelectParty={handleSelectParty}
          selectedParty={selectedParty}
          searchTerm={searchTerm}
        />
      </ReportRegisterMobileListChrome>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ReportRegisterDesktopSplit
        listPanel={
          <>
            <div className="p-4 border-b space-y-3 flex-shrink-0">
              <ReportRegisterListHeading>Sales</ReportRegisterListHeading>
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Sales</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(totalSales, { noSuffix: true })}
                </p>
              </Card>
            </div>
            <ReportRegisterListSearchRow
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={setSearchTerm}
            />
            <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
              <h3 className="text-sm font-semibold">Sale accounts ({filteredParties.length})</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <PartyList
                parties={filteredParties}
                onSelectParty={handleSelectParty}
                selectedParty={selectedParty}
                searchTerm={searchTerm}
              />
            </div>
          </>
        }
        detailPanel={
          currentParty ? (
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
              context="sale"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <Card className="w-full max-w-md text-center">
                <CardHeader>
                  <CardTitle>Select an account</CardTitle>
                  <CardDescription>
                    Choose a sale account from the list to view transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {partiesWithSales.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No sales recorded yet. Create a sale invoice to see accounts here.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )
        }
      />
    </div>
  );
}
