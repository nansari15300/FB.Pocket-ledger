
"use client";

import { ItemList } from "@/components/items/ItemList";
import ItemDetails from "@/components/items/ItemDetails";
import { ItemGroupList } from "@/components/items/ItemGroupList";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  collection,
  query,
  where,
  orderBy,
  collectionGroup,
  doc,
} from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { Input } from "@/components/ui/input";
import { CreateItemGroupDialog } from "@/components/items/CreateItemGroupDialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ItemGroupDetails } from "@/components/items/ItemGroupDetails"; 
import { cn } from "@/lib/utils";
import usePermissions from "@/hooks/usePermissions";
import { useDate } from "@/hooks/useDate";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { StockView } from "@/components/items/ItemDetails";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Item, ItemGroup } from "@/components/items/types";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useVouchers } from "@/hooks/useVouchers";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRouter, useSearchParams } from "next/navigation";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import { ITEM_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { isMasterEntitySystemGroupId, resolveItemListGroupBucketId } from "@/lib/masterEntitySystemGroups";


type DisplayUnitState = Record<string, string>;

export default function ItemsPage() {
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { can } = usePermissions();
  const { formatCurrency } = useDate();
  const { vouchers, loading: vouchersLoading, processedItems, processedItemGroups: initialProcessedItemGroups } = useVouchers();
  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [selectedItemGroup, setSelectedItemGroup] = useState<ItemGroup | null>(null);
  const [activeView, setActiveView] = useState("items");
  const [searchTerm, setSearchTerm] = useState("");
  const isInitialMount = useRef(true);
  const [stockView, setStockView] = useState<StockView>('amount');
  const [itemDisplayUnits, setItemDisplayUnits] = useState<DisplayUnitState>({});
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  // ✅ NEW: Refs to store last selected ID for each tab
  const lastSelectedIds = useRef<{
      items: string | null;
      services: string | null;
      groups: string | null;
  }>({
      items: null,
      services: null,
      groups: null
  });
  
  const processedItemGroups = useMemo(() => {
    const ungrouped = processedItems.filter(p => !p.groupId);
    if (ungrouped.length > 0) {
      const ungroupedBalance = ungrouped.reduce((sum, p) => sum + p.balance, 0);
      const ungroupedGroup: ItemGroup = {
        id: 'ungrouped',
        name: 'Ungrouped',
        balance: ungroupedBalance,
        companyId: companyId || '',
        debit: ungrouped.reduce((sum, p) => sum + p.debit, 0),
        credit: ungrouped.reduce((sum, p) => sum + p.credit, 0),
      };
      return [...initialProcessedItemGroups, ungroupedGroup];
    }
    return initialProcessedItemGroups;
  }, [processedItems, initialProcessedItemGroups, companyId]);

  useEffect(() => {
    if (!isMobile) return;
    const hasDetails = selectedItem || selectedItemGroup;

    if (hasDetails && window.location.hash !== '#details') {
      window.history.pushState({ details: true }, '', '#details');
    }

    const handlePopState = (event: PopStateEvent) => {
      if (!event.state?.details) {
        setSelectedItem(null);
        setSelectedItemGroup(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.location.hash === '#details') {
        window.history.back();
      }
    };
  }, [selectedItem, selectedItemGroup, isMobile]);
  
  const storageKey = `itemDisplayUnits_${user?.uid}`;

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
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
    const newNames: Record<string, string> = {};
    let hasNewNames = false;
    const promises = Array.from(uids).map(async (uid) => {
      if (!userNames[uid as string]) {
        hasNewNames = true;
        newNames[uid as string] = await fetchUserName(uid as string);
      }
    });

    Promise.all(promises).then(() => {
        if(hasNewNames) {
            setUserNames((prev) => ({ ...prev, ...newNames }));
        }
    });
  }, [vouchers, userNames, fetchUserName]);
  
  useEffect(() => {
    if (user) {
      try {
        const savedUnitsRaw = localStorage.getItem(storageKey);
        if (savedUnitsRaw) {
          const savedUnits: DisplayUnitState = JSON.parse(savedUnitsRaw);
          setItemDisplayUnits(savedUnits);
        }
      } catch (error) {
        console.error("Failed to parse item display units from local storage:", error);
      }
    }
  }, [user, storageKey]);

  const handleSetItemDisplayUnit = (itemId: string, unit: string) => {
    const newUnits = {
      ...itemDisplayUnits,
      [itemId]: unit,
    };
    setItemDisplayUnits(newUnits);
    if (user) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newUnits));
      } catch (error) {
        console.error("Failed to save item display units to local storage:", error);
      }
    }
  };

  useEffect(() => {
    setLoading(vouchersLoading);
  }, [vouchersLoading]);

  const handleItemUpdated = () => {
    // onSnapshot handles updates
  };

  const handleItemDeleted = () => {
    setSelectedItem(null);
     // Also clear from ref if deleted
     if(activeView === 'items') lastSelectedIds.current.items = null;
     if(activeView === 'services') lastSelectedIds.current.services = null;
  };
  
  const physicalItems = useMemo(() => processedItems.filter(item => item.type !== 'service'), [processedItems]);
  const serviceItems = useMemo(() => processedItems.filter(item => item.type === 'service'), [processedItems]);

  useEffect(() => {
    if (loading || isMobile || !isInitialMount.current) return;

    const selectedIdParam = searchParams.get('selectedId');
    if (selectedIdParam) {
        const item = processedItems.find(p => p.id === selectedIdParam);
        if (item) {
            const newActiveView = item.type === 'service' ? 'services' : 'items';
            setActiveView(newActiveView);
            setSelectedItem(item);
            if(newActiveView === 'services') lastSelectedIds.current.services = item.id;
            else lastSelectedIds.current.items = item.id;
            isInitialMount.current = false;
            return;
        }
        const group = processedItemGroups.find(g => g.id === selectedIdParam);
        if (group) {
            setActiveView('groups');
            setSelectedItemGroup(group);
            lastSelectedIds.current.groups = group.id;
            isInitialMount.current = false;
            return;
        }
    }
  }, [loading, isMobile, searchParams, processedItems, processedItemGroups]);

  useEffect(() => {
    if (loading || isMobile) return;

    let list: (Item | ItemGroup)[];
    let key: keyof typeof lastSelectedIds.current;

    if (activeView === 'items') {
        list = physicalItems;
        key = 'items';
    } else if (activeView === 'services') {
        list = serviceItems;
        key = 'services';
    } else if (activeView === 'groups') {
        list = processedItemGroups;
        key = 'groups';
    } else {
        return;
    }

    if (list.length > 0 && (!selectedItem && !selectedItemGroup)) {
        const lastId = lastSelectedIds.current[key];
        const itemToSelect = lastId ? list.find(i => i.id === lastId) : list[0];
        
        if (key === 'groups') {
            setSelectedItemGroup(itemToSelect as ItemGroup);
            setSelectedItem(null);
        } else {
            setSelectedItem(itemToSelect as Item);
            setSelectedItemGroup(null);
        }
        if (!lastId && list.length > 0) {
           lastSelectedIds.current[key] = list[0].id;
        }
    }
}, [loading, activeView, physicalItems, serviceItems, processedItemGroups, isMobile, selectedItem, selectedItemGroup]);



  const totalBalanceItems = useMemo(() => {
    return physicalItems.reduce((acc, item) => acc + item.balance, 0);
  }, [physicalItems]);

  const totalBalanceServices = useMemo(() => {
    return serviceItems.reduce((acc, item) => acc + item.balance, 0);
  }, [serviceItems]);

  const totalBalanceGroups = useMemo(() => processedItemGroups.reduce((acc, group) => acc + group.balance, 0), [processedItemGroups]);

  const totalBalance = useMemo(() => {
    switch (activeView) {
      case 'items': return totalBalanceItems;
      case 'services': return totalBalanceServices;
      case 'groups': return totalBalanceGroups;
      default: return 0;
    }
  }, [activeView, totalBalanceItems, totalBalanceServices, totalBalanceGroups]);

  useEffect(() => {
    const savedView = localStorage.getItem("itemActiveView");
    if (savedView) setActiveView(savedView);
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
    } else {
      localStorage.setItem("itemActiveView", activeView);
    }
    setSelectedItem(null);
    setSelectedItemGroup(null);
  }, [activeView]);

  const selectedGroupItems = useMemo(() => {
    if (!selectedItemGroup) return [];
    if (selectedItemGroup.id === "ungrouped") {
      return processedItems.filter((p) => !p.groupId);
    }
    return filterMembersByMasterGroupScope<Item>(
      selectedItemGroup.id,
      processedItems,
      processedItemGroups,
      resolveItemListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(ITEM_ENTITY_GROUP_PRESET, id),
      (item, branchId) => resolveItemListGroupBucketId(item) === branchId
    );
  }, [selectedItemGroup, processedItems, processedItemGroups]);

  const NoDataFound = () => (
    <div className="flex flex-1 items-center justify-center h-full p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>No {activeView === "groups" ? "Groups" : "Items or Services"} Found</CardTitle>
          <CardDescription>
            {activeView === "groups" ? "Create your first group to categorize items." : "Create your first item or service to get started."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeView === 'groups' ? (
             <CreateItemGroupDialog onGroupCreated={() => {}} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={processedItemGroups}>
                <Button onClick={() => setIsCreateGroupOpen(true)}>Create Group</Button>
            </CreateItemGroupDialog>
          ) : (
            <CreateItemDialog onItemCreated={() => {}} isOpen={isCreateItemOpen} onOpenChange={setIsCreateItemOpen}>
              <Button onClick={() => setIsCreateItemOpen(true)}>Create Item/Service</Button>
            </CreateItemDialog>
          )}
        </CardContent>
      </Card>
    </div>
  );


  const noItems = activeView === 'groups' ? processedItemGroups.length === 0 : (processedItems || []).length === 0;

  // Render detail view with stable component types + keys so it does NOT remount when vouchers/table data updates (which would close dialogs).
  const detailView = (activeView === "items" || activeView === "services") && selectedItem ? (
    <ItemDetails
      key={`item-${selectedItem.id}`}
      item={selectedItem}
      transactions={vouchers}
      onItemUpdated={handleItemUpdated}
      onItemDeleted={handleItemDeleted}
      stockView={stockView}
      setStockView={setStockView}
      itemDisplayUnits={itemDisplayUnits}
      setItemDisplayUnit={handleSetItemDisplayUnit}
      userNames={userNames}
    />
  ) : activeView === "groups" && selectedItemGroup ? (
    <ItemGroupDetails
      key={`group-${selectedItemGroup.id}`}
      group={selectedItemGroup}
      allGroups={processedItemGroups}
      items={selectedGroupItems}
      allItems={processedItems}
      onGroupUpdated={() => {}}
      onGroupDeleted={() => setSelectedItemGroup(null)}
      onItemUpdated={() => {}}
      stockView={'amount'}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      userNames={userNames}
      transactions={vouchers}
    />
  ) : !loading && noItems ? (
    <NoDataFound />
  ) : (
    <div className="hidden md:flex flex-1 items-center justify-center h-full p-4">
      <p className="text-muted-foreground">Select an item to view details.</p>
    </div>
  );

   if (loading) {
    return (
      <div className="flex h-full w-full">
        <aside className="w-96 border-r p-4"><Skeleton className="h-full w-full" /></aside>
        <main className="flex-1 p-4"><Skeleton className="h-full w-full" /></main>
      </div>
    );
  }

  if (!companyId) {
    return <div>Select a company to view item data</div>;
  }
  
  const handleGroupSelect = (group: ItemGroup) => {
    lastSelectedIds.current.groups = group.id; 
    if (isMobile && group.id !== 'ungrouped') {
        router.push(`/items/group/${group.id}`);
    } else {
        setSelectedItemGroup(group);
        setSelectedItem(null);
    }
  };

  const handleItemSelect = (item: Item) => {
    if(item.type === 'service') lastSelectedIds.current.services = item.id;
    else lastSelectedIds.current.items = item.id;

    if (isMobile) {
      router.push(`/items/${item.id}`);
    } else {
      setSelectedItem(item);
      setSelectedItemGroup(null);
    }
  }

  const listView = (
    <>
      <div className="p-3 border-b">
        <Tabs value={activeView} onValueChange={setActiveView}>
          <TabsList className="w-full">
            <TabsTrigger value="items" className="flex-1">Items</TabsTrigger>
            <TabsTrigger value="services" className="flex-1">Services</TabsTrigger>
            <TabsTrigger value="groups" className="flex-1">Groups</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="p-3 border-b flex items-center gap-2">
        {activeView === 'items' ? (
          <CreateItemDialog onItemCreated={() => {}} isOpen={isCreateItemOpen} onOpenChange={setIsCreateItemOpen}>
            <Button className="w-full" onClick={() => setIsCreateItemOpen(true)}>+ Add Item</Button>
          </CreateItemDialog>
        ) : activeView === 'services' ? (
          <CreateItemDialog onItemCreated={() => {}} defaultType="service" isOpen={isCreateItemOpen} onOpenChange={setIsCreateItemOpen}>
            <Button className="w-full" onClick={() => setIsCreateItemOpen(true)}>+ Add Service</Button>
          </CreateItemDialog>
        ) : (
           <div className="flex items-center gap-2 w-full">
             <div className="relative flex-1">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
               <Input placeholder="Search groups..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
             </div>
             <CreateItemGroupDialog onGroupCreated={() => {}} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={processedItemGroups}>
               <Button size="sm" onClick={() => setIsCreateGroupOpen(true)}>+ Add Group</Button>
             </CreateItemGroupDialog>
           </div>
        )}
      </div>

     {activeView !== 'groups' && <div className="p-3 border-b relative flex gap-2">
       <div className="relative flex-1">
         <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
         <Input
           placeholder="Search items/services..."
           className="pl-9"
           value={searchTerm}
           onChange={(e) => setSearchTerm(e.target.value)}
           autoComplete="off"
         />
       </div>
         <Select value={stockView} onValueChange={(v) => setStockView(v as StockView)}>
           <SelectTrigger className="w-[120px]">
             <SelectValue />
           </SelectTrigger>
           <SelectContent>
             <SelectItem value="qty">Unit</SelectItem>
             <SelectItem value="amount">Amounts</SelectItem>
           </SelectContent>
         </Select>
      </div>}

      <ScrollArea className="flex-1">
        {activeView === "items" ? (
          <ItemList
            items={physicalItems}
            onSelectItem={handleItemSelect}
            selectedItem={selectedItem}
            searchTerm={searchTerm}
            stockView={stockView}
            itemDisplayUnits={itemDisplayUnits}
          />
        ) : activeView === "services" ? (
          <ItemList
            items={serviceItems}
            onSelectItem={handleItemSelect}
            selectedItem={selectedItem}
            searchTerm={searchTerm}
            stockView={stockView}
            itemDisplayUnits={itemDisplayUnits}
          />
        ) : (
          <ItemGroupList
            groups={processedItemGroups}
            onSelectGroup={handleGroupSelect}
            selectedGroup={selectedItemGroup}
            searchTerm={searchTerm}
          />
        )}
      </ScrollArea>
    </>
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <aside className={cn("border-r bg-muted/30 flex-col", isMobile ? "w-full h-full" : "w-96", (selectedItem || selectedItemGroup) && isMobile ? "hidden" : "flex")}>
        <div className="p-4 border-b">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold font-headline">Items &amp; Service</h1>
            <span
              className={cn(
                "font-semibold text-sm",
                totalBalance >= 0 ? "text-green-600" : "text-red-600"
              )}
            >
              {formatCurrency(totalBalance, { showDrCr: true })}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Manage your products and services.</p>
        </div>
         {listView}
      </aside>

      <main className={cn("flex-1 flex flex-col h-full overflow-hidden", isMobile && !(selectedItem || selectedItemGroup) ? "hidden" : "flex")}>
        {detailView}
      </main>
    </div>
  );
}
