"use client";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import React from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { collection, query, orderBy, doc } from "firebase/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import { useSearchParams, useRouter } from "next/navigation";
import { StaffList } from "@/components/staff/StaffList";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { StaffGroupList } from "@/components/staff/StaffGroupList";
import { StaffGroupDetails } from "@/components/staff/StaffGroupDetails";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { CreateStaffGroupDialog } from "@/components/staff/CreateStaffGroupDialog";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { useVouchers } from "@/hooks/useVouchers";
import type { DateRange } from "@/components/ui/ad-calendar";
import type { Staff, StaffGroup } from "@/components/staff/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildStaffPageLiabilityGroupTree, staffMembersForGroupSelection } from "@/lib/staffPageLiabilityGroupTree";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { getLocalAuthUser } from "@/lib/localApiClient";
import { isLocalOnlyMode } from "@/lib/localMode";

export default function StaffPage() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { formatCurrency } = useDate();
  const { vouchers, loading: vouchersLoading, processedStaff, processedStaffGroups: initialProcessedStaffGroups } = useVouchers();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [activeView, setActiveView] = useState("staff");
  const { isMobile, selected, setSelected } = useResponsiveListLayout<Staff | StaffGroup>(`staff_view_${activeView}`);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [voucherDefaultTab, setVoucherDefaultTab] = useState<'add_salary' | 'payment_out'>('add_salary');

  const selectedStaff = activeView === 'staff' ? selected as Staff : null;
  const selectedGroup = activeView === 'groups' ? selected as StaffGroup : null;
  
  const processedStaffGroups = useMemo(() => {
    // Treat both blank groupId and storage ungrouped id as Ungrouped bucket.
    const ungrouped = processedStaff.filter(p => !p.groupId || p.groupId === "ungrouped_staff");
    if (ungrouped.length > 0) {
      const ungroupedBalance = ungrouped.reduce((sum, p) => sum + p.balance, 0);
      const ungroupedGroup: StaffGroup = {
        id: 'ungrouped',
        name: 'Ungrouped',
        balance: ungroupedBalance,
        companyId: companyId || '',
        debit: ungrouped.reduce((sum, p) => sum + p.debit, 0),
        credit: ungrouped.reduce((sum, p) => sum + p.credit, 0),
      };
      return [...initialProcessedStaffGroups, ungroupedGroup];
    }
    return initialProcessedStaffGroups;
  }, [processedStaff, initialProcessedStaffGroups, companyId]);

  const openVoucherDialog = (mode: 'add_salary' | 'payment_out') => {
    setVoucherDefaultTab(mode);
    setIsVoucherDialogOpen(true);
  }

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId]) return userNames[userId];
    if (isLocalOnlyMode() && companyId) {
      const localUser = getLocalAuthUser(companyId);
      const localDisplayName = (
        localUser?.displayName ||
        localUser?.username ||
        ((company as any)?.adminUsername as string) ||
        "Admin"
      ).trim();
      // Local mode ke common user ids ko readable local user name me resolve karo.
      if (
        userId === "local" ||
        userId === "local_guest_user" ||
        userId === localUser?.id ||
        userId === localUser?.username
      ) {
        return localDisplayName || "Admin";
      }
      return "N/A";
    }
    try {
        const userDoc = await getDoc(doc(firestore, 'users', userId));
        if (userDoc.exists()) {
            return userDoc.data().displayName || userDoc.data().email || "Unknown";
        }
    } catch (e) {}
    return "Unknown";
  }, [userNames, companyId, company]);

  useEffect(() => {
    if (!isLocalOnlyMode() || !companyId) return;
    const localUser = getLocalAuthUser(companyId);
    const localDisplayName = (
      localUser?.displayName ||
      localUser?.username ||
      ((company as any)?.adminUsername as string) ||
      "Admin"
    ).trim();
    if (!localDisplayName) return;
    setUserNames((prev) => {
      // Seed local-id keys so staff/grid pages always show local actor name.
      const next = { ...prev };
      next["local"] = localDisplayName;
      next["local_guest_user"] = localDisplayName;
      if (localUser?.id) next[String(localUser.id)] = localDisplayName;
      if (localUser?.username) next[String(localUser.username)] = localDisplayName;
      return next;
    });
  }, [companyId, company]);

  useEffect(() => {
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
    uids.forEach(async (uid) => {
      if (!userNames[uid as string]) {
        const name = await fetchUserName(uid as string);
        setUserNames((prev) => ({ ...prev, [uid as string]: name }));
      }
    });
  }, [vouchers, userNames, fetchUserName]);

  useEffect(() => {
    const savedView = localStorage.getItem("staffActiveView");
    if (savedView && ['staff', 'groups'].includes(savedView)) {
      setActiveView(savedView);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("staffActiveView", activeView);
    setSelected(null);
  }, [activeView, setSelected]);

  useEffect(() => {
    if (vouchersLoading) return;

    const timer = setTimeout(() => {
      const activeList = activeView === 'staff' ? processedStaff : processedStaffGroups;
      const savedId = localStorage.getItem(`selectedItemId_staff_view_${activeView}`);
      const currentSelectedId = selected?.id;
      const selectedId = searchParams.get('selectedId');

      // Priority 1: URL searchParams
      if (selectedId) {
        const item = activeList.find(i => i.id === selectedId);
        if (item) {
          if (activeView === 'staff' && selectedId !== currentSelectedId) {
            setActiveView('staff');
            setSelected(item);
          } else if (activeView === 'groups' && selectedId !== currentSelectedId) {
            setActiveView('groups');
            setSelected(item);
          }
          return;
        }
      }

      // Priority 2: localStorage saved selection
      if (savedId && savedId !== currentSelectedId) {
        const itemToSelect = activeList.find(i => i.id === savedId);
        if (itemToSelect) {
          setSelected(itemToSelect);
          return;
        }
      }
      
      // Priority 3: Auto-select first item if nothing selected
      if (!selected && !isMobile && activeList.length > 0) {
        setSelected(activeList[0]);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [vouchersLoading, processedStaff, processedStaffGroups, activeView, isMobile, searchParams, setSelected, selected]);

  const totalBalance = useMemo(() => {
    return activeView === 'staff'
      ? processedStaff.reduce((acc, staff) => acc + staff.balance, 0)
      : processedStaffGroups.reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, processedStaff, processedStaffGroups]);

  const handleSelect = (item: Staff | StaffGroup) => {
    if (isMobile) {
        const path = activeView === 'staff' ? `/staff/${item.id}` : `/staff/group/${item.id}`;
        router.push(path);
    } else {
        setSelected(item);
    }
  };
  
  const handleGroupSelect = (item: StaffGroup) => {
    if (isMobile && item.id !== 'ungrouped') {
        router.push(`/staff/group/${item.id}`);
    } else {
        setSelected(item);
    }
  };

  const staffLiabilityGroupTree = useMemo(
    () =>
      buildStaffPageLiabilityGroupTree({
        processedStaff,
        salaryGroups: processedStaffGroups,
        staffGroupsMeta: processedStaffGroups,
        companyId: companyId || "",
      }),
    [processedStaffGroups, processedStaff, companyId]
  );

  const staffForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    if (selectedGroup.id === "ungrouped") {
      return processedStaff.filter((p) => !p.groupId || p.groupId === "ungrouped_staff");
    }
    return staffMembersForGroupSelection(
      selectedGroup.id,
      processedStaff,
      staffLiabilityGroupTree
    );
  }, [selectedGroup, processedStaff, staffLiabilityGroupTree]);

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
                        Please select a company to view staff data.
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
                <Input
                    placeholder={activeView === 'staff' ? 'Search staff...' : 'Search groups...'}
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoComplete="off"
                />
            </div>
            {activeView === 'staff' ? (
                <CreateStaffDialog onStaffCreated={() => {}} groups={processedStaffGroups} isOpen={isCreateStaffOpen} onOpenChange={setIsCreateStaffOpen}>
                <Button size="sm" onClick={() => setIsCreateStaffOpen(true)}>{STAFF_ENTITY_ADD_BUTTON}</Button>
                </CreateStaffDialog>
            ) : (
                <CreateStaffGroupDialog onGroupCreated={() => {}} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={processedStaffGroups}>
                <Button size="sm" onClick={() => setIsCreateGroupOpen(true)}>+ Add Group</Button>
                </CreateStaffGroupDialog>
            )}
        </div>
        <div className="p-3 border-b">
            <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => openVoucherDialog("add_salary")}>Add Salary</Button>
                <Button variant="outline" onClick={() => openVoucherDialog("payment_out")}>Pay Salary</Button>
            </div>
        </div>
        {activeView === 'staff' ? (
            <StaffList staff={processedStaff} onSelectStaff={handleSelect as any} selectedStaff={selectedStaff} searchTerm={searchTerm}/>
        ) : (
            <StaffGroupList groups={processedStaffGroups} onSelectGroup={handleGroupSelect} selectedGroup={selectedGroup} searchTerm={searchTerm}/>
        )}
    </div>
);

  // Memoize callbacks to prevent re-renders
  const handleStaffUpdated = useCallback(() => {}, []);
  const handleStaffDeleted = useCallback(() => setSelected(null), [setSelected]);
  const handleGroupUpdated = useCallback(() => {}, []);
  const handleGroupDeleted = useCallback(() => setSelected(null), [setSelected]);
  const handleGroupStaffUpdated = useCallback(() => {}, []);
  
  {/* Stable keys (staff.id / group.id) prevent remount when vouchers/table data updates, so Add Voucher dialog stays open. */}
  const detailView = useMemo(() => (
    <>
      {activeView === 'staff' && selectedStaff && (
        <StaffDetails
          key={`staff-${selectedStaff.id}`}
          staff={selectedStaff}
          allStaff={processedStaff}
          allGroups={processedStaffGroups}
          onStaffUpdated={handleStaffUpdated}
          onStaffDeleted={handleStaffDeleted}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          userNames={userNames}
        />
      )}
      {activeView === 'groups' && selectedGroup && (
        <StaffGroupDetails
          key={`group-${selectedGroup.id}`}
          group={selectedGroup}
          allGroups={processedStaffGroups}
          staff={staffForSelectedGroup}
          onGroupUpdated={handleGroupUpdated}
          onGroupDeleted={handleGroupDeleted}
          onStaffUpdated={handleGroupStaffUpdated}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          userNames={userNames}
        />
      )}
      {!selected && <div className="p-6 text-center text-muted-foreground">Select an item to view details</div>}
    </>
  ), [activeView, selectedStaff, selectedGroup, processedStaff, processedStaffGroups, staffForSelectedGroup, dateRange, userNames, selected, handleStaffUpdated, handleStaffDeleted, handleGroupUpdated, handleGroupDeleted, handleGroupStaffUpdated, setDateRange]);

  return (
    <>
    <ResponsiveMasterDetail
      title={STAFF_ENTITY_LABEL}
      balance={formatCurrency(totalBalance, { showDrCr: true })}
      tabs={
        <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="staff" className="flex-1">{STAFF_ENTITY_LABEL}</TabsTrigger>
            <TabsTrigger value="groups" className="flex-1">Groups</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      listView={listView}
      detailView={detailView}
      isMobile={isMobile}
    />
    <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={setIsVoucherDialogOpen}
        onVoucherCreated={() => {}}
        defaultTab={voucherDefaultTab}
     />
    </>
  );
}
