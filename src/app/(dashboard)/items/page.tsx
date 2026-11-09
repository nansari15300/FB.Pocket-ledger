"use client";

import { ItemList } from "@/components/items/ItemList";
import ItemDetails from "@/components/items/ItemDetails";
import { ItemGroupList } from "@/components/items/ItemGroupList";
import { Suspense, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, Package, Users, Pencil } from "lucide-react";
import { EditItemDialog } from "@/components/items/EditItemDialog";
import { EditItemGroupDialog } from "@/components/items/EditItemGroupDialog";
import { LEDGER_HEADER_AVATAR_PEN_CN } from "@/lib/ledgerHeaderChrome";
import { CreateItemDialog } from "@/components/items/CreateItemDialog";
import { Input } from "@/components/ui/input";
import { CreateItemGroupDialog } from "@/components/items/CreateItemGroupDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ItemGroupDetails } from "@/components/items/ItemGroupDetails";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { MobileMasterDetailNestedName } from "@/components/entity/MobileMasterDetailNestedName";
import { mlc } from "@/lib/mobileListChrome";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { type EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { PermissionButton } from "@/components/permission";
import { useDate } from "@/hooks/useDate";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { StockView } from "@/components/items/types";
import type { Item, ItemGroup } from "@/components/items/types";
import type { DateRange } from "@/components/ui/ad-calendar";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { useVouchers } from "@/hooks/useVouchers";
import { useLiveMasterSelection } from "@/hooks/useLiveMasterSelection";
import usePermissions from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMasterDetailQueryNav } from "@/hooks/useMasterDetailQueryNav";
import { useRegisterMasterDetailHardwareBack } from "@/hooks/useRegisterMasterDetailHardwareBack";
import { useSyncMasterDetailHeaderId } from "@/hooks/useSyncMasterDetailHeaderId";
import { applyMasterDetailBackToListUrl, masterDetailListHref } from "@/lib/masterDetailListPath";
import { browserHistoryHref } from "@/lib/webAppBasePath";
import {
  masterDetailTabHref,
  masterDetailCanonicalHref,
  replaceMasterDetailTabUrl,
  tabSwitchSelection,
  pickRememberedListSelection,
  writeMasterDetailPageState,
  readMasterDetailLocationQuery,
} from "@/lib/masterDetailTabChange";
import { useRouter, useSearchParams } from "next/navigation";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { usePageMemory } from "@/hooks/usePageMemory";
import { isSystemParentGroup } from "@/lib/system-groups";
import { createMasterEntityGroupMoveHandler } from "@/lib/createMasterEntityGroupMoveHandler";
import { createMasterEntityGroupTreeMoveHandler } from "@/lib/createMasterEntityGroupTreeMoveHandler";
import { isAdminPanelCompanyLocalId } from "@/lib/adminPanelCompany/ledgerMode";
import { resolveItemGroupListConfigForCompany } from "@/lib/adminPanelCompany/resolveItemGroupListConfig";
import { computeMasterGroupListSearchVisibleCount } from "@/lib/masterGroupListTree";
import { itemGroupTreeMove } from "@/lib/masterEntityGroupTreeMoveHelpers";
import { itemGroupAccountMove } from "@/lib/masterEntityGroupAccountMove";
import { ITEM_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import {
  appendMasterEntitySystemBranchGroups,
  isMasterEntitySystemGroupId,
  resolveMasterEntityGroupForSelection,
  resolveItemListGroupBucketId,
} from "@/lib/masterEntitySystemGroups";
import { isLocalOnlyMode } from "@/lib/localMode";
import { shouldReplaceWithMasterDetailCanonical } from "@/lib/maybeReplaceMasterDetailUrl";
import { collectItemIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesItemLedger";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { MobileMasterDetailHeaderAvatar } from "@/components/entity/MobileMasterDetailHeaderAvatar";
import { MobileMasterDetailHeaderDateSecondary } from "@/components/entity/MobileMasterDetailHeaderDateSecondary";
import { mobileEntityDetailShellTitle } from "@/lib/mobileDetailChrome";

type DisplayUnitState = Record<string, string>;

function ItemsPageContent() {
  const { user } = useAuth();
  const { company, companyId, effectiveNotificationSettings } = useCompany();
  const { formatCurrency } = useDate();
  const { vouchers, loading: vouchersLoading, processedItems, processedItemGroups: initialProcessedItemGroups, userNames: vouchersUserNames } = useVouchers();
  const { can } = usePermissions();
  const showApproveOnList =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false;
  const pendingApprovalByItemId = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedItems?.length) return {} as Record<string, number>;
    const itemIdSet = new Set(processedItems.map((i: Item) => i.id));
    const map: Record<string, number> = {};
    vouchers.forEach((v: any) => {
      const touched = collectItemIdsTouchedByUnapprovedVoucher(v, itemIdSet);
      touched.forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }, [vouchers, showApproveOnList, processedItems]);
  const pendingApprovalByItemGroupId = useMemo(() => {
    if (!showApproveOnList) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    processedItems.forEach((item: any) => {
      const n = pendingApprovalByItemId[item.id] || 0;
      if (!n) return;
      const gid = resolveItemListGroupBucketId(item);
      map[gid] = (map[gid] || 0) + n;
    });
    return map;
  }, [processedItems, pendingApprovalByItemId, showApproveOnList]);
  const totalPendingApprovalVoucherCount = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedItems?.length) return 0;
    const itemIdSet = new Set(processedItems.map((i: Item) => i.id));
    let n = 0;
    for (const v of vouchers as any[]) {
      if (v?.isApproved === true) continue;
      if (collectItemIdsTouchedByUnapprovedVoucher(v, itemIdSet).size > 0) n += 1;
    }
    return n;
  }, [vouchers, showApproveOnList, processedItems]);
  const isMobile = useIsMobile();
  const useQueryNav = useMasterDetailQueryNav();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIdFromUrl = searchParams.get("selected");
  const viewFromUrl = searchParams.get("view");

  const [activeView, setActiveView] = useState("items");
  const { selected, setSelected } = useResponsiveListLayout<Item | ItemGroup>(`items_view_${activeView}`);

  const pendingItemsSelectIdRef = useRef<string | null>(null);
  const onBackToList = useCallback(() => {
    pendingItemsSelectIdRef.current = null;
    const href = applyMasterDetailBackToListUrl("items");
    setSelected(null);
    router.replace(href, { scroll: false });
  }, [setSelected, router]);
  useRegisterMasterDetailHardwareBack("items", onBackToList);

  const [searchTerm, setSearchTerm] = useState("");
  const [itemListQuickFilter, setItemListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const {
    showOnlyEntities: showOnlyItemsWithPendingApproval,
    setShowOnlyEntities: setShowOnlyItemsWithPendingApproval,
    showOnlyGroups: showOnlyItemGroupsWithPendingApproval,
    setShowOnlyGroups: setShowOnlyItemGroupsWithPendingApproval,
  } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
  const [stockView, setStockView] = useState<StockView>("amount");
  const [itemDisplayUnits, setItemDisplayUnits] = useState<DisplayUnitState>({});
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [itemDetailsDateRange, setItemDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupDetailsDateRange, setGroupDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupMemberFilterId, setGroupMemberFilterId] = useState<string | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>(vouchersUserNames || {});
  
  // Use vouchersUserNames from useVouchers hook as primary source - always sync
  useEffect(() => {
    if (vouchersUserNames) {
      setUserNames(prev => {
        // Merge to keep any locally fetched names
        return { ...vouchersUserNames, ...prev };
      });
    }
  }, [vouchersUserNames]);

  const selectedItemRaw = activeView === "items" ? (selected as Item) : null;
  const selectedItem = useLiveMasterSelection<Item>(selectedItemRaw, setSelected, processedItems);
  const selectedItemGroupRaw = activeView === "groups" ? (selected as ItemGroup) : null;
  const mobileItemsSelectionLabelClassName = useMemo(() => {
    if (!selected) return undefined;
    return masterDetailBalanceToneClass((selected as Item | ItemGroup).balance);
  }, [selected]);
  const mobileItemsSelectionLabel = useMemo((): ReactNode => {
    if (!selected) return null;
    if (activeView !== "groups") {
      const name = selectedItem?.name ?? (selected as Item).name;
      return name && String(name).trim() ? String(name).trim() : null;
    }
    const group = selected as ItemGroup;
    if (groupMemberFilterId) {
      const member = processedItems.find((item) => item.id === groupMemberFilterId);
      return (
        <MobileMasterDetailNestedName
          groupName={group.name}
          memberName={member?.name ?? null}
          toneClassName={mobileItemsSelectionLabelClassName}
        />
      );
    }
    const name = group.name;
    return name && String(name).trim() ? String(name).trim() : null;
  }, [selected, selectedItem, activeView, groupMemberFilterId, processedItems, mobileItemsSelectionLabelClassName]);
  const itemsMasterDetailTitle = activeView === "groups" ? "Item Groups" : "Items";
  const itemsShellTitle = useMemo(
    () => mobileEntityDetailShellTitle(isMobile, Boolean(selected), itemsMasterDetailTitle, "Item details"),
    [isMobile, selected, itemsMasterDetailTitle]
  );
  const mobileItemsHeaderSecondary = useMemo((): ReactNode | undefined => {
    if (!isMobile || !selected) return undefined;
    const range = activeView === "groups" ? groupDetailsDateRange : itemDetailsDateRange;
    const onClear =
      activeView === "groups"
        ? () => setGroupDetailsDateRange(undefined)
        : () => setItemDetailsDateRange(undefined);
    return <MobileMasterDetailHeaderDateSecondary dateRange={range} onClear={onClear} />;
  }, [isMobile, selected, activeView, itemDetailsDateRange, groupDetailsDateRange]);
  useSyncMasterDetailHeaderId("items", selectedItem?.id ?? selectedItemGroupRaw?.id ?? null);

  const itemGroupListConfig = useMemo(
    () => resolveItemGroupListConfigForCompany(companyId),
    [companyId]
  );

  const processedItemGroups = useMemo(() => {
    const userGroups = initialProcessedItemGroups.filter((g) => {
      const anyG = g as any;
      if (anyG.isAutoUngrouped === true) return false;
      if (anyG.isReportOnly === true || anyG.isSystemReserved === true) return false;
      if (isSystemParentGroup("item_groups", anyG.id)) return false;
      return true;
    });
    if (isAdminPanelCompanyLocalId(companyId)) {
      return userGroups;
    }
    return appendMasterEntitySystemBranchGroups(
      userGroups,
      ITEM_ENTITY_GROUP_PRESET,
      companyId || ""
    );
  }, [initialProcessedItemGroups, companyId]);

  useLiveMasterSelection(selectedItemGroupRaw, setSelected, processedItemGroups);
  const selectedItemGroup = useMemo(
    () =>
      selectedItemGroupRaw
        ? (resolveMasterEntityGroupForSelection(
            selectedItemGroupRaw.id,
            processedItemGroups,
            ITEM_ENTITY_GROUP_PRESET,
            companyId || ""
          ) as ItemGroup | null)
        : null,
    [selectedItemGroupRaw, processedItemGroups, companyId]
  );

  const mobileItemsDetailHeaderAvatar = useMemo(() => {
    if (!isMobile || !selected) return null;

    if (activeView === "items" && selectedItem) {
      const item = selectedItem;
      const name = item.name || "Item";
      const attachmentUrl = trimEntityFileUrlForPreview(item.fileUrls?.[0] ?? (item as any).fileUrl);
      const hasTransactions = (item.debit ?? 0) !== 0 || (item.credit ?? 0) !== 0;
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            item.id !== "all" ? (
              <EditItemDialog
                item={item}
                onItemUpdated={() => {}}
                onItemDeleted={() => setSelected(null)}
                hasTransactions={hasTransactions}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit item">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditItemDialog>
            ) : undefined
          }
        />
      );
    }

    if (activeView === "groups" && selectedItemGroup) {
      const group = selectedItemGroup;
      const name = group.name || "Item";
      const attachmentUrl = trimEntityFileUrlForPreview((group as any).fileUrl);
      const isSystemBranchGroup = isMasterEntitySystemGroupId(ITEM_ENTITY_GROUP_PRESET, group.id);
      const hasAccounts =
        processedItems.some((i) => i.groupId === group.id) ||
        processedItemGroups.some((g) => g.parentId === group.id);
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            !isSystemBranchGroup ? (
              <EditItemGroupDialog
                group={group}
                allGroups={processedItemGroups}
                onGroupUpdated={() => {}}
                onGroupDeleted={() => setSelected(null)}
                hasAccounts={hasAccounts}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit group">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditItemGroupDialog>
            ) : undefined
          }
        />
      );
    }

    return null;
  }, [
    isMobile,
    selected,
    activeView,
    selectedItem,
    selectedItemGroup,
    processedItems,
    processedItemGroups,
    setSelected,
  ]);

  const allItems = useMemo(
    () => processedItems.filter((i) => i.type === "item" || i.type === "service" || i.type === "finished_good" || !i.type),
    [processedItems]
  );
  const itemsForItemList = useMemo(() => {
    if (!showOnlyItemsWithPendingApproval || !showApproveOnList) return allItems;
    return allItems.filter((i) => (pendingApprovalByItemId[i.id] ?? 0) > 0);
  }, [allItems, showOnlyItemsWithPendingApproval, showApproveOnList, pendingApprovalByItemId]);
  const filteredItemListCount = useMemo(() => {
    const searchLower = (searchTerm || "").toLowerCase();
    return itemsForItemList.filter((i) => (i.name && i.name.toLowerCase().includes(searchLower)) || String((i as { aliasName?: string }).aliasName || "").toLowerCase().includes(searchLower || "\u0000")).length;
  }, [itemsForItemList, searchTerm]);

  const handleItemsTabChange = useCallback(
    (value: string) => {
      const tab = value === "groups" ? "groups" : "items";
      const items =
        (tab === "groups" ? processedItemGroups : allItems) as ReadonlyArray<{ id: string }>;
      const nextSelected = tabSwitchSelection(
        isMobile,
        pickRememberedListSelection("itemsPageState", tab, items)
      );
      pendingItemsSelectIdRef.current = nextSelected?.id ?? null;
      setActiveView(tab);
      setSelected(nextSelected as (typeof allItems)[number] | (typeof processedItemGroups)[number] | null);
      const href = isMobile
        ? masterDetailTabHref("items", { tab, defaultTab: "items", listOnly: true })
        : masterDetailCanonicalHref("items", {
            tab,
            defaultTab: "items",
            selectedId: nextSelected?.id ?? null,
          });
      replaceMasterDetailTabUrl(href, router, useQueryNav);
      writeMasterDetailPageState("itemsPageState", tab, nextSelected?.id);
    },
    [isMobile, useQueryNav, processedItemGroups, allItems, setActiveView, setSelected, router]
  );

  usePageMemory(
    "itemsPageState",
    activeView,
    setActiveView,
    selected,
    setSelected,
    activeView === "items" ? allItems : processedItemGroups,
    vouchersLoading,
    isMobile,
    selectedIdFromUrl
  );

  // Clear search when company changes (prevent email/other data from carrying over)
  useEffect(() => {
    setSearchTerm("");
  }, [companyId]);
  useEffect(() => {
    setShowOnlyItemsWithPendingApproval(false);
    setShowOnlyItemGroupsWithPendingApproval(false);
  }, [companyId]);
  useEffect(() => {
    if (activeView !== "items") setShowOnlyItemsWithPendingApproval(false);
    if (activeView !== "groups") setShowOnlyItemGroupsWithPendingApproval(false);
  }, [activeView]);

  // Location-first URL sync (Party jaisa).
  useEffect(() => {
    if (vouchersLoading) return;
    const { view, selectedId } = readMasterDetailLocationQuery();
    const pendingId = pendingItemsSelectIdRef.current;
    if (pendingId) {
      if (selectedId === pendingId) pendingItemsSelectIdRef.current = null;
      else if (selected?.id === pendingId) return;
    }
    if (!selectedId) {
      if (view === "groups") {
        if (activeView !== "groups") setActiveView("groups");
      } else if (activeView !== "items") {
        setActiveView("items");
      }
      return;
    }
    const groupItem = processedItemGroups.find((i) => i.id === selectedId);
    const itemFromList = allItems.find((i) => i.id === selectedId);
    if (view === "groups" && groupItem) setActiveView("groups");
    else if (view === "items" && itemFromList) setActiveView("items");
    const item =
      groupItem && itemFromList
        ? view === "groups"
          ? groupItem
          : itemFromList
        : groupItem || itemFromList;
    if (item) setSelected(item);
    const canonical =
      view === "groups"
        ? `/items?view=groups&selected=${encodeURIComponent(selectedId)}`
        : `/items?selected=${encodeURIComponent(selectedId)}`;
    if (shouldReplaceWithMasterDetailCanonical(canonical)) {
      router.replace(canonical, { scroll: false });
    }
  }, [selectedIdFromUrl, viewFromUrl, vouchersLoading, allItems, processedItemGroups, selected?.id, activeView, setSelected, setActiveView, router]);

  const storageKey = `itemDisplayUnits_${user?.uid}`;

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId] && userNames[userId] !== "Unknown") return userNames[userId];
    // Local-only mode me user-name lookup local cache se handle hota hai.
    if (isLocalOnlyMode()) return "N/A";
    try {
      // User doc ID may be name_uid format, so query by uid field first
      const q = query(collection(firestore, "users"), where("uid", "==", userId));
      const snap = await getDocs(q);
      let data = snap.docs[0]?.data();
      
      if (!data) {
        // Fallback: doc ID might be uid (legacy)
        const userDoc = await getDoc(doc(firestore, "users", userId));
        if (userDoc.exists()) {
          data = userDoc.data();
        }
      }
      
      if (data) {
        // Get displayName from user document - this is the primary field
        const displayName = data.displayName || data.name || data.email || null;
        if (displayName && displayName !== userId && !displayName.match(/^[a-zA-Z0-9_-]{20,}$/)) {
          return displayName;
        }
      }
    } catch (_) {}
    return "N/A"; // Return N/A instead of Unknown
  }, [userNames]);

  // Only fetch locally if not in vouchersUserNames
  useEffect(() => {
    if (!vouchers || vouchers.length === 0) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean) as string[]);
    // Only fetch if not in vouchersUserNames or if it's "Unknown"/"N/A"
    const uidsToFetch = Array.from(uids).filter(uid => {
      const vouchersName = vouchersUserNames?.[uid];
      return !vouchersName || vouchersName === "Unknown" || vouchersName === "N/A";
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
        if (name && name !== "Unknown" && name !== "N/A") {
          newUserNames[uid] = name;
        }
      });
      if (Object.keys(newUserNames).length > 0) {
        setUserNames((prev) => ({ ...prev, ...newUserNames }));
      }
    });
  }, [vouchers, fetchUserName, vouchersUserNames]);

  useEffect(() => {
    if (user) {
      try {
        const savedUnitsRaw = localStorage.getItem(storageKey);
        if (savedUnitsRaw) {
          const savedUnits: DisplayUnitState = JSON.parse(savedUnitsRaw);
          setItemDisplayUnits(savedUnits);
        }
      } catch (_) {}
    }
  }, [user, storageKey]);

  const handleSetItemDisplayUnit = (itemId: string, unit: string) => {
    const newUnits = { ...itemDisplayUnits, [itemId]: unit };
    setItemDisplayUnits(newUnits);
    if (user) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newUnits));
      } catch (_) {}
    }
  };

  const totalBalance = useMemo(() => {
    if (activeView === "items") {
      return allItems.reduce((acc, item) => acc + item.balance, 0);
    }
    return processedItemGroups.reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, allItems, processedItemGroups]);

  const selectedGroupItems = useMemo(() => {
    if (!selectedItemGroup) return [];
    return filterMembersByMasterGroupScope<Item>(
      selectedItemGroup.id,
      processedItems,
      processedItemGroups,
      resolveItemListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(ITEM_ENTITY_GROUP_PRESET, id),
      (item, branchId) => resolveItemListGroupBucketId(item) === branchId
    );
  }, [selectedItemGroup, processedItems, processedItemGroups]);

  const processedItemGroupsForList = useMemo(() => {
    if (!showOnlyItemGroupsWithPendingApproval || !showApproveOnList) return processedItemGroups;
    return processedItemGroups.filter((g) => (pendingApprovalByItemGroupId[g.id] ?? 0) > 0);
  }, [
    processedItemGroups,
    showOnlyItemGroupsWithPendingApproval,
    showApproveOnList,
    pendingApprovalByItemGroupId,
  ]);

  const itemGroupMembersByGroupId = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const item of processedItems) {
      const bucket = resolveItemListGroupBucketId(item);
      if (!map[bucket]) map[bucket] = [];
      map[bucket].push(item);
    }
    return map;
  }, [processedItems]);

  const filteredGroupCount = useMemo(() => {
    return computeMasterGroupListSearchVisibleCount({
      groups: processedItemGroupsForList || [],
      config: itemGroupListConfig,
      searchTerm,
      quickFilter: groupListQuickFilter,
      groupMembersByGroupId: itemGroupMembersByGroupId,
      visibleGroupFilter: (g) => {
        const anyG = g as { isReportOnly?: boolean; isSystemReserved?: boolean };
        if (anyG.isReportOnly === true) return false;
        if (anyG.isSystemReserved === true || isSystemParentGroup("item_groups", g.id)) return false;
        return !!g.name;
      },
    });
  }, [
    processedItemGroupsForList,
    searchTerm,
    groupListQuickFilter,
    itemGroupMembersByGroupId,
    itemGroupListConfig,
  ]);

  const handleSelect = useCallback((item: Item | ItemGroup, options?: GroupListSelectOptions) => {
    pendingItemsSelectIdRef.current = item.id;
    setSelected(item);
    const isItem = "type" in item;
    if (isItem) {
      setGroupMemberFilterId(null);
      if (activeView !== "items") setActiveView("items");
    } else {
      setGroupMemberFilterId(options?.memberId ?? null);
      setActiveView("groups");
    }
    const href = isItem
      ? `/items?selected=${encodeURIComponent(item.id)}`
      : `/items?view=groups&selected=${encodeURIComponent(item.id)}`;
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", browserHistoryHref(href));
      } catch {
        /* ignore */
      }
    }
    if (useQueryNav && shouldReplaceWithMasterDetailCanonical(href)) {
      router.replace(href, { scroll: false });
    }
  }, [useQueryNav, router, setSelected, activeView, setActiveView]);

  const selectedGroupItemsForDetails = useMemo(() => {
    if (!groupMemberFilterId) return selectedGroupItems;
    return selectedGroupItems.filter((i) => i.id === groupMemberFilterId);
  }, [selectedGroupItems, groupMemberFilterId]);

  const handleMoveItemToGroup = useCallback(
    (item: Item, targetGroupId: string) =>
      createMasterEntityGroupMoveHandler({
        companyId,
        company,
        groupsForName: processedItemGroups,
        moveHelpers: itemGroupAccountMove,
        entityLabel: "Item",
      })(item, targetGroupId),
    [companyId, company, processedItemGroups]
  );

  const handleMoveItemGroupToGroup = useCallback(
    (sourceGroupId: string, targetGroupId: string) =>
      createMasterEntityGroupTreeMoveHandler({
        companyId,
        company,
        groupsForName: processedItemGroups,
        allGroups: initialProcessedItemGroups,
        config: itemGroupListConfig,
        moveHelpers: itemGroupTreeMove,
      })(sourceGroupId, targetGroupId),
    [companyId, company, processedItemGroups, initialProcessedItemGroups, itemGroupListConfig]
  );

  if (!companyId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8 h-full">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>No Company Selected</CardTitle>
            <CardDescription>Please select a company to view item data.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const itemsTabsEl = (
    <Tabs value={activeView} onValueChange={handleItemsTabChange} className="w-full">
      <TabsList listChrome>
        <TabsTrigger listChrome value="items" className="flex-1">Items</TabsTrigger>
        <TabsTrigger listChrome value="groups" className="flex-1">Groups</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const itemsSearchRowEl = (
    <div className={mlc.searchRow}>
      <div className={mlc.searchWrap}>
        <Search className={mlc.searchIcon} />
        <Input
          placeholder={activeView === "items" ? "Search items..." : "Search groups/item"}
          listChrome
          listChromeSearch
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {activeView === "items" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyItemsWithPendingApproval}
          onToggle={() => setShowOnlyItemsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only items with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all items (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all items"
        />
      ) : null}
      {activeView === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyItemGroupsWithPendingApproval}
          onToggle={() => setShowOnlyItemGroupsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only groups with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all groups (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all groups"
        />
      ) : null}
      {activeView === "items" ? (
        <CreateItemDialog onItemCreated={() => {}} isOpen={isCreateItemOpen} onOpenChange={setIsCreateItemOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateItemOpen(true)}>
            + Add Item
          </PermissionButton>
        </CreateItemDialog>
      ) : (
        <CreateItemGroupDialog
          onGroupCreated={() => {}}
          isOpen={isCreateGroupOpen}
          onOpenChange={setIsCreateGroupOpen}
          groups={processedItemGroups}
        >
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
            + Add Group
          </PermissionButton>
        </CreateItemGroupDialog>
      )}
    </div>
  );

  const itemsSectionLabelEl =
    activeView === "items" ? (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <Package className={mlc.sectionIcon} />
        <span>Item ({filteredItemListCount})</span>
        <Select value={stockView} onValueChange={(v) => setStockView(v as StockView)}>
          <SelectTrigger
            data-pl-item-stock-view-select=""
            className={cn(
              "ml-auto h-7 min-h-7 max-h-7 w-auto min-w-[5.5rem] max-w-[7.5rem] shrink-0 rounded-full px-2.5 text-xs font-medium shadow-none ring-0 focus:ring-0 focus-visible:ring-0",
              chromeProPillCn,
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="qty">Unit</SelectItem>
            <SelectItem value="amount">Amounts</SelectItem>
          </SelectContent>
        </Select>
      </div>
    ) : (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <Users className={mlc.sectionIcon} />
        <span>Groups ({filteredGroupCount})</span>
      </div>
    );

  const listView = (
    <MasterListViewShell
      isMobile={isMobile}
      searchRow={itemsSearchRowEl}
      sectionLabel={itemsSectionLabelEl}
      tabs={itemsTabsEl}
      quickFilter={activeView === "items" ? itemListQuickFilter : groupListQuickFilter}
      onQuickFilterChange={activeView === "items" ? setItemListQuickFilter : setGroupListQuickFilter}
    >
      {vouchersLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <LoadingSpinner />
        </div>
      ) : activeView === "items" ? (
        <ItemList
          items={itemsForItemList}
          onSelectItem={(i) => handleSelect(i)}
          selectedItem={selectedItem}
          searchTerm={searchTerm}
          stockView={stockView}
          itemDisplayUnits={itemDisplayUnits}
          pendingApprovalByItemId={pendingApprovalByItemId}
          getItemHref={useQueryNav ? (i) => `/items?selected=${i.id}` : undefined}
          quickFilter={itemListQuickFilter}
          onQuickFilterChange={setItemListQuickFilter}
          hideQuickFilterBar
        />
      ) : (
        <ItemGroupList
          groups={processedItemGroupsForList}
          onSelectGroup={handleSelect}
          selectedGroup={selectedItemGroup}
          searchTerm={searchTerm}
          pendingApprovalByGroupId={pendingApprovalByItemGroupId}
          pendingApprovalByMemberId={pendingApprovalByItemId}
          groupMembersByGroupId={itemGroupMembersByGroupId}
          selectedGroupMemberFilterId={groupMemberFilterId}
          getItemHref={useQueryNav ? (g) => `/items?view=groups&selected=${g.id}` : undefined}
          quickFilter={groupListQuickFilter}
          onQuickFilterChange={setGroupListQuickFilter}
          hideQuickFilterBar
          moveAccountsEnabled={!!companyId}
          onMoveAccountToGroup={handleMoveItemToGroup}
          canMoveMember={itemGroupAccountMove.canMoveAccount}
          onMoveGroupToGroup={handleMoveItemGroupToGroup}
          canMoveGroup={itemGroupTreeMove.canMoveGroup}
          allGroupsForMove={initialProcessedItemGroups}
        />
      )}
    </MasterListViewShell>
  );

  const detailView = (
    <>
      {activeView === "items" && selectedItem && (
        <ItemDetails
          key={`item-${selectedItem.id}`}
          item={selectedItem}
          transactions={vouchers}
          onItemUpdated={() => {}}
          onItemDeleted={() => setSelected(null)}
          stockView={stockView}
          setStockView={setStockView}
          itemDisplayUnits={itemDisplayUnits}
          setItemDisplayUnit={handleSetItemDisplayUnit}
          userNames={{ ...vouchersUserNames, ...userNames }}
          dateRange={itemDetailsDateRange}
          onDateRangeChange={setItemDetailsDateRange}
          hideMobilePeriodLabelRow={isMobile}
        />
      )}
      {activeView === "groups" && selectedItemGroup && (
        <ItemGroupDetails
          key={`group-${selectedItemGroup.id}:${groupMemberFilterId ?? "all"}`}
          group={selectedItemGroup}
          allGroups={processedItemGroups}
          items={selectedGroupItemsForDetails}
          allItems={processedItems}
          groupMemberFilterId={groupMemberFilterId}
          onGroupUpdated={() => {}}
          onGroupDeleted={() => setSelected(null)}
          onItemUpdated={() => {}}
          stockView="amount"
          dateRange={groupDetailsDateRange}
          onDateRangeChange={setGroupDetailsDateRange}
          userNames={{ ...vouchersUserNames, ...userNames }}
          transactions={vouchers}
          hideMobilePeriodLabelRow={isMobile}
        />
      )}
      {!selected && (
        <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>
      )}
    </>
  );

  return (
    <ResponsiveMasterDetail
      title={itemsShellTitle}
      mobileSelectionLabel={mobileItemsSelectionLabel}
      mobileSelectionLabelClassName={mobileItemsSelectionLabelClassName}
      mobileDetailHeaderEnd={mobileItemsDetailHeaderAvatar}
      mobileDetailHeaderSecondary={mobileItemsHeaderSecondary}
      balance={
        <span
          className={cn(
            "font-semibold",
            totalBalance >= 0 ? "text-green-600" : "text-red-600"
          )}
        >
          {formatCurrency(totalBalance, { showDrCr: true })}
        </span>
      }
      tabs={isMobile ? undefined : itemsTabsEl}
      mobileTabsDocked={isMobile}
      listView={listView}
      detailView={detailView}
      isMobile={isMobile}
      mobileListOnly={true}
      hasSelectedItem={!!selected}
      onBackToList={onBackToList}
      mobileListSelectionKey={
        selected
          ? `${selected.id}:${activeView === "groups" ? groupMemberFilterId ?? "" : ""}`
          : null
      }
    />
  );
}

export default function ItemsPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<LoadingSpinner />}>
      <ItemsPageContent />
    </Suspense>
  );
}
