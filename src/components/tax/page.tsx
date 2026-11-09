
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams } from "next/navigation";
import { TaxList } from "@/components/tax/TaxList";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { TaxGroupList } from "@/components/tax/TaxGroupList";
import { TaxGroupDetails } from "@/components/tax/TaxGroupDetails";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { CreateTaxGroupDialog } from "@/components/tax/CreateTaxGroupDialog";
import { useVouchers } from "@/hooks/useVouchers";
import type { Tax, TaxGroup } from "@/components/tax/types";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DateRange } from "@/components/ui/ad-calendar";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import { TAX_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { isMasterEntitySystemGroupId, resolveTaxListGroupBucketId } from "@/lib/masterEntitySystemGroups";

export default function TaxPage() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { formatCurrency, formatRunning } = useDate();
  const { vouchers, loading: vouchersLoading, processedTaxes, processedTaxGroups: initialProcessedTaxGroups } = useVouchers();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  
  const [activeView, setActiveView] = useState("taxes");
  const { selected, setSelected } = useResponsiveListLayout<Tax | TaxGroup>(`tax_view_${activeView}`);
  const isInitialMount = useRef(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const selectedTax = activeView === 'taxes' ? selected as Tax : null;
  const selectedGroup = activeView === 'groups' ? selected as TaxGroup : null;
  
  const lastSelectedIds = useRef<{
    taxes: string | null;
    groups: string | null;
  }>({ taxes: null, groups: null });
  
  const processedTaxGroups = useMemo(() => {
    // Treat both blank groupId and storage ungrouped id as Ungrouped bucket.
    const ungrouped = processedTaxes.filter(p => !p.groupId || p.groupId === "ungrouped_tax");
    if (ungrouped.length > 0) {
      const ungroupedBalance = ungrouped.reduce((sum, p) => sum + p.balance, 0);
      const ungroupedGroup: TaxGroup = {
        id: 'ungrouped',
        name: 'Ungrouped',
        balance: ungroupedBalance,
        companyId: companyId || '',
        debit: ungrouped.reduce((sum, p) => sum + p.debit, 0),
        credit: ungrouped.reduce((sum, p) => sum + p.credit, 0),
      };
      return [...initialProcessedTaxGroups, ungroupedGroup];
    }
    return initialProcessedTaxGroups;
  }, [processedTaxes, initialProcessedTaxGroups, companyId]);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId]) return userNames[userId];
    const plLocalLedger =
      (company as { plServerShared?: boolean } | null)?.plServerShared === true ||
      ((company as { storageOption?: string } | null)?.storageOption || "").toLowerCase() === "local";
    if (plLocalLedger) return "N/A";
    try {
        const userDoc = await getDoc(doc(firestore, 'users', userId));
        if (userDoc.exists()) {
            return userDoc.data().displayName || userDoc.data().email || "Unknown";
        }
    } catch (e) {}
    return "Unknown";
  }, [userNames, company]);

  useEffect(() => {
    const plLocalLedger =
      (company as { plServerShared?: boolean } | null)?.plServerShared === true ||
      ((company as { storageOption?: string } | null)?.storageOption || "").toLowerCase() === "local";
    if (plLocalLedger) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
    uids.forEach(async (uid) => {
        if (!userNames[uid as any]) {
            const name = await fetchUserName(uid as any);
            setUserNames((prev) => ({ ...prev, [uid as any]: name }));
        }
    });
  }, [vouchers, userNames, fetchUserName, company]);

  useEffect(() => {
    const savedView = localStorage.getItem("taxActiveView");
    if (savedView) setActiveView(savedView);
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
    } else {
        localStorage.setItem("taxActiveView", activeView);
    }
    setSelected(null);
  }, [activeView, setSelected]);

  useEffect(() => {
    if (vouchersLoading || isMobile) return;

    if (activeView === 'taxes') {
        const lastId = lastSelectedIds.current.taxes;
        const itemToSelect = lastId ? processedTaxes.find(i => i.id === lastId) : null;
        if (itemToSelect) {
            setSelected(itemToSelect);
        } else if (processedTaxes.length > 0) {
            setSelected(processedTaxes[0]);
            lastSelectedIds.current.taxes = processedTaxes[0].id;
        } else {
            setSelected(null);
        }
    } else if (activeView === 'groups') {
        const lastId = lastSelectedIds.current.groups;
        const itemToSelect = lastId ? processedTaxGroups.find(i => i.id === lastId) : null;
        if (itemToSelect) {
            setSelected(itemToSelect);
        } else if (processedTaxGroups.length > 0) {
            setSelected(processedTaxGroups[0]);
            lastSelectedIds.current.groups = processedTaxGroups[0].id;
        } else {
            setSelected(null);
        }
    }
  }, [vouchersLoading, processedTaxes, processedTaxGroups, activeView, isMobile, setSelected]);


  const totalBalance = useMemo(() => {
    return activeView === 'taxes'
      ? processedTaxes.reduce((acc, tax) => acc + tax.balance, 0)
      : processedTaxGroups.reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, processedTaxes, processedTaxGroups]);

  const handleSelect = (item: Tax | TaxGroup) => {
    if ('rate' in item) { // Tax
        lastSelectedIds.current.taxes = item.id;
        if (isMobile) router.push(`/tax/${item.id}`);
    } else { // Group
        lastSelectedIds.current.groups = item.id;
        if (isMobile && item.id !== 'ungrouped') router.push(`/tax/group/${item.id}`);
    }

    if (!isMobile) {
        setSelected(item);
    }
  };


  const taxesForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    if (selectedGroup.id === 'ungrouped') {
      return processedTaxes.filter(p => !p.groupId || p.groupId === "ungrouped_tax");
    }
    return filterMembersByMasterGroupScope<Tax>(
      selectedGroup.id,
      processedTaxes,
      processedTaxGroups,
      resolveTaxListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(TAX_ENTITY_GROUP_PRESET, id),
      (tax, branchId) => resolveTaxListGroupBucketId(tax) === branchId
    );
  }, [selectedGroup, processedTaxes, processedTaxGroups]);


  if (vouchersLoading) {
    return <LoadingSpinner />;
  }
  
  if (!companyId) {
    return (
         <div className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8 h-full">
            <Card className="w-full max-w-md text-center">
                <CardHeader>
                    <CardTitle>No Company Selected</CardTitle>
                    <CardDescription>
                        Please select a company to view tax data.
                    </CardDescription>
                </CardHeader>
            </Card>
        </div>
    );
  }
  
  const listView = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={activeView === 'taxes' ? 'Search taxes...' : 'Search groups...'} className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
        </div>
        {activeView === 'taxes' ? (
          <CreateTaxDialog onTaxCreated={() => {}} isOpen={isCreateTaxOpen} onOpenChange={setIsCreateTaxOpen}>
            <Button size="sm" onClick={() => setIsCreateTaxOpen(true)}>+ Add Tax</Button>
          </CreateTaxDialog>
        ) : (
          <CreateTaxGroupDialog onGroupCreated={() => {}} groups={processedTaxGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
            <Button size="sm" onClick={() => setIsCreateGroupOpen(true)}>+ Add Group</Button>
          </CreateTaxGroupDialog>
        )}
      </div>
       {activeView === 'taxes' ? (
            <TaxList taxes={processedTaxes} onSelectTax={handleSelect as any} selectedTax={selectedTax} searchTerm={searchTerm} />
        ) : (
            <TaxGroupList groups={processedTaxGroups} onSelectGroup={handleSelect} selectedGroup={selectedGroup} searchTerm={searchTerm} />
        )}
    </div>
  );

  const detailView = (
    <>
      {activeView === 'taxes' && selectedTax && (
        <TaxDetails tax={selectedTax} allTaxes={processedTaxes} onTaxUpdated={() => {}} onTaxDeleted={() => setSelected(null)} dateRange={dateRange} onDateRangeChange={setDateRange} userNames={userNames} />
      )}
      {activeView === 'groups' && selectedGroup && (
        <TaxGroupDetails group={selectedGroup} allGroups={processedTaxGroups} taxes={taxesForSelectedGroup} onGroupUpdated={() => {}} onGroupDeleted={() => setSelected(null)} onTaxUpdated={() => {}} dateRange={dateRange} onDateRangeChange={setDateRange} userNames={userNames} />
      )}
      {!selected && <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>}
    </>
  );

  return (
    <ResponsiveMasterDetail
      title="Tax Accounts"
      balance={
        <span className={cn(
            "font-semibold",
            // >= 0 (Debit/Receivable) Green, < 0 (Credit/Payable) Red
            totalBalance >= 0 ? "text-green-600" : "text-red-600"
        )}>
            {formatRunning(totalBalance)}
        </span>
      }
      tabs={
        <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="taxes" className="flex-1">Taxes</TabsTrigger>
            <TabsTrigger value="groups" className="flex-1">Groups</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      listView={listView}
      detailView={detailView}
      isMobile={isMobile}
    />
  );
}
