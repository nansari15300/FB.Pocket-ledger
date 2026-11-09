

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams } from "next/navigation";
import { PartyList } from "@/components/party/PartyList";
import { PartyDetails } from "@/components/party/PartyDetails";
import { PartyGroupList } from "@/components/party/PartyGroupList";
import { GroupDetails } from "@/components/party/GroupDetails";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateGroupDialog } from "@/components/party/CreateGroupDialog";
import { useVouchers } from "@/hooks/useVouchers";
import type { Party, Group } from "@/components/party/types";
import {
  isPartyDirectOnSystemBranch,
  isPartySystemGroupId,
} from "@/lib/partySystemGroups";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DateRange } from "@/components/ui/ad-calendar";
import { getLocalAuthUser } from "@/lib/localApiClient";
import { isLocalOnlyMode } from "@/lib/localMode";


export default function PartyPage() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { formatCurrency } = useDate();
  const { vouchers, loading: vouchersLoading, processedParties, processedGroups: initialProcessedGroups, userNames: vouchersUserNames } = useVouchers();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [activeView, setActiveView] = useState("parties");
  const { isMobile, selected, setSelected } = useResponsiveListLayout<Party | Group>(`party_view_${activeView}`);


  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);

  // Clear search when company changes (prevent email/other data from carrying over)
  useEffect(() => {
    setSearchTerm("");
  }, [companyId]);
  const [localUserNames, setLocalUserNames] = useState<Record<string, string>>({});
  const [partyDetailsDateRange, setPartyDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupDetailsDateRange, setGroupDetailsDateRange] = useState<DateRange | undefined>(undefined);
  
  // Merge vouchersUserNames with localUserNames - vouchersUserNames is primary source
  const userNames = useMemo(() => ({
    ...vouchersUserNames,
    ...localUserNames,
  }), [vouchersUserNames, localUserNames]);

  const selectedParty = activeView === 'parties' ? selected as Party : null;
  const selectedGroup = activeView === 'groups' ? selected as Group : null;
  
   const processedGroups = useMemo(() => {
    return initialProcessedGroups;
  }, [initialProcessedGroups]);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    // Check both vouchersUserNames and localUserNames
    const existingName = vouchersUserNames?.[userId] || localUserNames[userId];
    if (existingName && existingName !== "Unknown" && existingName !== "N/A") return existingName;
    const plLocalLedger =
      (company as { plServerShared?: boolean } | null)?.plServerShared === true ||
      (company != null &&
        ((company as { storageOption?: string }).storageOption || "").toLowerCase() === "local");
    if (isLocalOnlyMode() || plLocalLedger) {
        // Local / PL company: Firestore users skip — offline Group/Party tab crash avoid.
        const localUser = companyId ? getLocalAuthUser(companyId) : null;
        const localDisplayName = (localUser?.displayName || localUser?.username || ((company as any)?.adminUsername as string) || "Admin").trim();
        if (userId === "local" || userId === "local_guest_user" || userId === localUser?.id || userId === localUser?.username) {
          return localDisplayName || "Admin";
        }
        return "N/A";
    }
    try {
        // User doc ID may be name_uid format (e.g. manishshah46_AaCbiR708nhGe28Ltf2I7YZzpNv1), so query by uid field first
        const q = query(collection(firestore, "users"), where("uid", "==", userId));
        const snap = await getDocs(q);
        let data = snap.docs[0]?.data();
        
        if (!data) {
            // Fallback 1: doc ID might be uid (legacy)
            const userDoc = await getDoc(doc(firestore, 'users', userId));
            if (userDoc.exists()) {
                data = userDoc.data();
            }
        }
        
        if (data) {
            // Get displayName from user document - this is the primary field
            const displayName = data.displayName || data.name || data.email || null;
            if (displayName && displayName !== userId && displayName !== "Unknown" && displayName !== "N/A") {
                // Check if it's not a UID pattern (long alphanumeric string without spaces/email)
                const isUIDPattern = displayName.length > 15 && /^[a-zA-Z0-9_-]+$/.test(displayName) && !displayName.includes('@') && !displayName.includes(' ');
                if (!isUIDPattern) {
                    return displayName;
                }
            }
        }
    } catch (e) {
        console.error('[PartyPage] Error fetching userName for', userId, e);
    }
    return "N/A"; // Return N/A instead of Unknown
  }, [vouchersUserNames, localUserNames, companyId, company]);

  // Always fetch locally if not in vouchersUserNames or if vouchersUserNames is empty
  useEffect(() => {
    const plLocalLedger =
      (company as { plServerShared?: boolean } | null)?.plServerShared === true ||
      (company != null &&
        ((company as { storageOption?: string }).storageOption || "").toLowerCase() === "local");
    if (isLocalOnlyMode() || plLocalLedger) return;
    if (!vouchers || vouchers.length === 0) {
      return;
    }
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean) as string[]);
    // Fetch if not in vouchersUserNames (including if vouchersUserNames is empty/undefined)
    const uidsToFetch = Array.from(uids).filter(uid => {
      const vouchersName = vouchersUserNames?.[uid];
      // Fetch if: not in vouchersUserNames, or it's "Unknown"/"N/A", or vouchersUserNames is empty
      return !vouchersName || vouchersName === "Unknown" || vouchersName === "N/A" || !vouchersUserNames || Object.keys(vouchersUserNames).length === 0;
    });
    
    if (uidsToFetch.length === 0) return;
    
    // Fetch all user names in parallel
    Promise.all(
      uidsToFetch.map(async (uid) => {
        const name = await fetchUserName(uid);
        return { uid, name };
      })
    ).then(results => {
      const newUserNames: Record<string, string> = {};
      results.forEach(({ uid, name }) => {
        // Only store valid names (not "Unknown", not "N/A", not UID)
        if (name && name !== "Unknown" && name !== "N/A" && name !== uid && !name.match(/^[a-zA-Z0-9_-]{20,}$/)) {
          newUserNames[uid] = name;
        }
      });
      if (Object.keys(newUserNames).length > 0) {
        setLocalUserNames((prev) => ({ ...prev, ...newUserNames }));
      }
    });
  }, [vouchers, fetchUserName, vouchersUserNames, company]);

  useEffect(() => {
    const savedView = localStorage.getItem("partyActiveView");
    if (savedView && ['parties', 'groups'].includes(savedView)) {
      setActiveView(savedView);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("partyActiveView", activeView);
    setSelected(null);
  }, [activeView, setSelected]);

  useEffect(() => {
    if (vouchersLoading) return;

    const timer = setTimeout(() => {
      const activeList = activeView === 'parties' ? processedParties : processedGroups;
      const savedId = localStorage.getItem(`selectedItemId_party_view_${activeView}`);
      const currentSelectedId = selected?.id;

      if (savedId && savedId !== currentSelectedId) {
        const itemToSelect = activeList.find(i => i.id === savedId);
        if (itemToSelect) {
          setSelected(itemToSelect);
          return;
        }
      }
      
      if (!selected && !isMobile && activeList.length > 0) {
         setSelected(activeList[0]);
      }
    }, 100);

    return () => clearTimeout(timer);
}, [vouchersLoading, processedParties, processedGroups, activeView, isMobile, setSelected, selected]);



  const totalBalance = useMemo(() => {
    return activeView === 'parties'
      ? processedParties.reduce((acc, party) => acc + party.balance, 0)
      : processedGroups.reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, processedParties, processedGroups]);

  const handleSelect = (item: Party | Group) => {
    if (isMobile) {
        router.push(`/party/${item.id}`);
    } else {
        setSelected(item);
    }
  };

  const handleGroupSelect = (item: Group) => {
    if (isMobile && item.id !== 'ungrouped') {
        router.push(`/party/group/${item.id}`);
    } else {
        setSelected(item);
    }
  };

  const partiesForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    if (isPartySystemGroupId(selectedGroup.id)) {
      return processedParties.filter((p) => isPartyDirectOnSystemBranch(p, selectedGroup.id));
    }
    return processedParties.filter((p) => p.groupId === selectedGroup.id);
  }, [selectedGroup, processedParties]);


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
                        Please select a company to view party data.
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
          <Input placeholder={activeView === 'parties' ? 'Search parties...' : 'Search groups...'} className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
        </div>
        {activeView === 'parties' ? (
          <CreatePartyDialog onPartyCreated={() => {}} isOpen={isCreatePartyOpen} onOpenChange={setIsCreatePartyOpen}>
            <Button size="sm" onClick={() => setIsCreatePartyOpen(true)} data-theme-btn="add-party">+ Add Party</Button>
          </CreatePartyDialog>
        ) : (
          <CreateGroupDialog onGroupCreated={() => {}} groups={processedGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
            <Button size="sm" onClick={() => setIsCreateGroupOpen(true)} data-theme-btn="add-group">+ Add Group</Button>
          </CreateGroupDialog>
        )}
      </div>
       {activeView === 'parties' ? (
            <>
              <div className="px-3 py-1.5 border-b flex items-center gap-2 text-sm font-semibold text-muted-foreground flex-shrink-0">
                <User className="h-4 w-4" />
                <span>Party ({processedParties.length})</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <PartyList parties={processedParties} onSelectParty={handleSelect} selectedParty={selectedParty} searchTerm={searchTerm} />
              </div>
            </>
        ) : (
            <PartyGroupList groups={processedGroups} onSelectGroup={handleGroupSelect} selectedGroup={selectedGroup} searchTerm={searchTerm} collapsible={false} />
        )}
    </div>
  );

  const detailView = (
    <>
      {activeView === 'parties' && selectedParty && (
        <PartyDetails party={selectedParty} allParties={processedParties} onPartyUpdated={() => {}} onPartyDeleted={() => setSelected(null)} dateRange={partyDetailsDateRange} onDateRangeChange={setPartyDetailsDateRange} userNames={userNames} />
      )}
      {activeView === 'groups' && selectedGroup && (
        <GroupDetails group={selectedGroup} allGroups={processedGroups} allParties={partiesForSelectedGroup} onGroupUpdated={() => {}} onGroupDeleted={() => setSelected(null)} onPartyUpdated={() => {}} dateRange={groupDetailsDateRange} onDateRangeChange={setGroupDetailsDateRange} userNames={userNames} />
      )}
      {!selected && <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>}
    </>
  );

  return (
    <ResponsiveMasterDetail
      title="Parties"
      balance={formatCurrency(totalBalance, { showDrCr: true })}
      tabs={
        <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="parties" className="flex-1">Parties</TabsTrigger>
            <TabsTrigger value="groups" className="flex-1">Groups</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      listView={listView}
      detailView={detailView}
      isMobile={isMobile}
      mobileListOnly={true}
    />
  );
}

