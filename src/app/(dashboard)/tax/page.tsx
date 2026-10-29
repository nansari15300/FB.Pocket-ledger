"use client";

import { Suspense, useState, useEffect, useCallback, useRef, useMemo, startTransition, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Receipt, Users, Pencil } from "lucide-react";
import { EditTaxDialog } from "@/components/tax/EditTaxDialog";
import { EditTaxGroupDialog } from "@/components/tax/EditTaxGroupDialog";
import { LEDGER_HEADER_AVATAR_PEN_CN } from "@/lib/ledgerHeaderChrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { MobileMasterDetailNestedName } from "@/components/entity/MobileMasterDetailNestedName";
import { mlc } from "@/lib/mobileListChrome";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { type EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams } from "next/navigation";
import { TaxList } from "@/components/tax/TaxList";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { TaxGroupList } from "@/components/tax/TaxGroupList";
import { TaxGroupDetails } from "@/components/tax/TaxGroupDetails";
import { CreateTaxDialog } from "@/components/tax/CreateTaxDialog";
import { CreateTaxGroupDialog } from "@/components/tax/CreateTaxGroupDialog";
import { PermissionButton } from "@/components/permission";
import { useVouchers } from "@/hooks/useVouchers";
import { useLiveMasterSelection } from "@/hooks/useLiveMasterSelection";
import usePermissions from "@/hooks/usePermissions";
import type { Tax, TaxGroup } from "@/components/tax/types";
import { collectInterCompanyIdsForPendingApproval } from "@/lib/interCompany/interCompanyVoucherHydrate";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { doc, collection, query, where } from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
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
import type { DateRange } from "@/components/ui/ad-calendar";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { isSystemParentGroup } from "@/lib/system-groups";
import { createMasterEntityGroupMoveHandler } from "@/lib/createMasterEntityGroupMoveHandler";
import { createMasterEntityGroupTreeMoveHandler } from "@/lib/createMasterEntityGroupTreeMoveHandler";
import { TAX_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { computeMasterGroupListSearchVisibleCount } from "@/lib/masterGroupListTree";
import { taxGroupTreeMove } from "@/lib/masterEntityGroupTreeMoveHelpers";
import { taxGroupAccountMove } from "@/lib/masterEntityGroupAccountMove";
import { TAX_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import {
  appendMasterEntitySystemBranchGroups,
  isMasterEntitySystemGroupId,
  resolveMasterEntityGroupForSelection,
  resolveTaxListGroupBucketId,
} from "@/lib/masterEntitySystemGroups";

// Custom Hook
import { usePageMemory } from "@/hooks/usePageMemory";
import { shouldReplaceWithMasterDetailCanonical } from "@/lib/maybeReplaceMasterDetailUrl";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { MobileMasterDetailHeaderAvatar } from "@/components/entity/MobileMasterDetailHeaderAvatar";
import { MobileMasterDetailHeaderDateSecondary } from "@/components/entity/MobileMasterDetailHeaderDateSecondary";
import { mobileEntityDetailShellTitle } from "@/lib/mobileDetailChrome";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";

function TaxPageContent() {
  const { user } = useAuth();
  const { company, companyId, effectiveNotificationSettings } = useCompany();
  const { formatCurrency } = useDate();
  const { vouchers, loading: vouchersLoading, processedTaxes, processedTaxGroups: initialProcessedTaxGroups, userNames: vouchersUserNames } = useVouchers();
  const { can } = usePermissions();
  const showApproveOnList =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false;
  const pendingApprovalByTaxId = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    const taxIdSet = new Set((processedTaxes || []).map((t: any) => t.id));
    vouchers.forEach((v: any) => {
      if (v.isApproved === true) return;
      const ids = new Set<string>();
      if (String(v.type || "") === "inter_company") {
        collectInterCompanyIdsForPendingApproval(v, taxIdSet, "tax").forEach((id) => ids.add(id));
      } else {
        if (v.taxAccountId && taxIdSet.has(v.taxAccountId)) ids.add(v.taxAccountId);
        (v.lineItems || []).forEach((line: any) => {
          if (line.taxAccountId && taxIdSet.has(line.taxAccountId)) ids.add(line.taxAccountId);
        });
        (v.entries || []).forEach((entry: any) => {
          if (entry.accountId && taxIdSet.has(entry.accountId)) ids.add(entry.accountId);
        });
      }
      ids.forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }, [vouchers, processedTaxes, showApproveOnList]);
  const pendingApprovalByTaxGroupId = useMemo(() => {
    if (!showApproveOnList) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    processedTaxes.forEach((tax: any) => {
      const n = pendingApprovalByTaxId[tax.id] || 0;
      if (!n) return;
      const gid = resolveTaxListGroupBucketId(tax);
      map[gid] = (map[gid] || 0) + n;
    });
    return map;
  }, [processedTaxes, pendingApprovalByTaxId, showApproveOnList]);
  const totalPendingApprovalVoucherCount = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !(processedTaxes || []).length) return 0;
    const taxIdSet = new Set(processedTaxes.map((t: Tax) => t.id));
    let n = 0;
    for (const v of vouchers as any[]) {
      if (v?.isApproved === true) continue;
      let hit = false;
      if (v.taxAccountId && taxIdSet.has(v.taxAccountId)) hit = true;
      if (!hit && Array.isArray(v.lineItems)) {
        hit = v.lineItems.some((line: any) => line.taxAccountId && taxIdSet.has(line.taxAccountId));
      }
      if (!hit && Array.isArray(v.entries)) {
        hit = v.entries.some((e: any) => e.accountId && taxIdSet.has(e.accountId));
      }
      if (hit) n += 1;
    }
    return n;
  }, [vouchers, processedTaxes, showApproveOnList]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIdFromUrl = searchParams.get("selected");
  const viewFromUrl = searchParams.get("view");
  const isMobile = useIsMobile();
  const useQueryNav = useMasterDetailQueryNav();

  const [activeView, setActiveView] = useState("taxes");
  const { selected, setSelected } = useResponsiveListLayout<Tax | TaxGroup>(`tax_view_${activeView}`);
  const isInitialMount = useRef(true);
  /** URL sync must not depend on processedTaxes identity — refresh pe har aggregate bump setSelected loop + TaxDetails hang. */
  const processedTaxesRef = useRef(processedTaxes);
  const processedTaxGroupsRef = useRef(initialProcessedTaxGroups);
  const selectedRef = useRef(selected);
  const activeViewRef = useRef(activeView);
  processedTaxesRef.current = processedTaxes;
  selectedRef.current = selected;
  activeViewRef.current = activeView;

  const pendingTaxSelectIdRef = useRef<string | null>(null);
  const onBackToList = useCallback(() => {
    pendingTaxSelectIdRef.current = null;
    // Pehle URL clear — warna sync effect purani ?selected= se detail wapas kholta hai
    const href = applyMasterDetailBackToListUrl("tax");
    setSelected(null);
    router.replace(href, { scroll: false });
  }, [setSelected, router]);
  useRegisterMasterDetailHardwareBack("tax", onBackToList);

  const [searchTerm, setSearchTerm] = useState("");
  const [taxListQuickFilter, setTaxListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const {
    showOnlyEntities: showOnlyTaxesWithPendingApproval,
    setShowOnlyEntities: setShowOnlyTaxesWithPendingApproval,
    showOnlyGroups: showOnlyTaxGroupsWithPendingApproval,
    setShowOnlyGroups: setShowOnlyTaxGroupsWithPendingApproval,
  } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateTaxOpen, setIsCreateTaxOpen] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [taxDetailsDateRange, setTaxDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupDetailsDateRange, setGroupDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupMemberFilterId, setGroupMemberFilterId] = useState<string | null>(null);

  const selectedTaxRaw = activeView === 'taxes' ? selected as Tax : null;
  const selectedTax = useLiveMasterSelection(selectedTaxRaw, setSelected, processedTaxes);
  const selectedGroupRaw = activeView === 'groups' ? selected as TaxGroup : null;
  const handleTaxUpdated = useCallback((patch?: Partial<Tax>) => {
    if (!patch?.id || !selectedTaxRaw || selectedTaxRaw.id !== patch.id) return;
    setSelected({ ...selectedTaxRaw, ...patch });
  }, [setSelected, selectedTaxRaw]);
  const handleTaxGroupUpdated = useCallback((patch?: Partial<TaxGroup>) => {
    if (!patch?.id || !selectedGroupRaw || selectedGroupRaw.id !== patch.id) return;
    setSelected({ ...selectedGroupRaw, ...patch });
  }, [setSelected, selectedGroupRaw]);
  const mobileTaxSelectionLabelClassName = useMemo(() => {
    if (!selected) return undefined;
    return masterDetailBalanceToneClass((selected as Tax | TaxGroup).balance);
  }, [selected]);
  const mobileTaxSelectionLabel = useMemo((): ReactNode => {
    if (!selected) return null;
    if (activeView !== "groups") {
      const name = selectedTax?.name ?? (selected as Tax).name;
      return name && String(name).trim() ? String(name).trim() : null;
    }
    const group = selected as TaxGroup;
    if (groupMemberFilterId) {
      const member = processedTaxes.find((tax) => tax.id === groupMemberFilterId);
      return (
        <MobileMasterDetailNestedName
          groupName={group.name}
          memberName={member?.name ?? null}
          toneClassName={mobileTaxSelectionLabelClassName}
        />
      );
    }
    const name = group.name;
    return name && String(name).trim() ? String(name).trim() : null;
  }, [selected, selectedTax, activeView, groupMemberFilterId, processedTaxes, mobileTaxSelectionLabelClassName]);
  const taxMasterDetailTitle = activeView === "groups" ? "Tax Group" : "Tax";
  const taxShellTitle = useMemo(
    () => mobileEntityDetailShellTitle(isMobile, Boolean(selected), taxMasterDetailTitle, "Tax details"),
    [isMobile, selected, taxMasterDetailTitle]
  );
  const mobileTaxHeaderSecondary = useMemo((): ReactNode | undefined => {
    if (!isMobile || !selected) return undefined;
    const range = activeView === "groups" ? groupDetailsDateRange : taxDetailsDateRange;
    const onClear =
      activeView === "groups" ? () => setGroupDetailsDateRange(undefined) : () => setTaxDetailsDateRange(undefined);
    return <MobileMasterDetailHeaderDateSecondary dateRange={range} onClear={onClear} />;
  }, [isMobile, selected, activeView, taxDetailsDateRange, groupDetailsDateRange]);
  useSyncMasterDetailHeaderId("tax", selectedTax?.id ?? selectedGroupRaw?.id ?? null);
  
  const processedTaxGroups = useMemo(() => {
    const userGroups = initialProcessedTaxGroups.filter((g) => {
      const anyG = g as any;
      if (anyG.isAutoUngrouped === true) return false;
      if (anyG.isReportOnly === true || anyG.isSystemReserved === true) return false;
      if (isSystemParentGroup("tax_groups", anyG.id)) return false;
      return true;
    });
    return appendMasterEntitySystemBranchGroups(
      userGroups,
      TAX_ENTITY_GROUP_PRESET,
      companyId || ""
    );
  }, [initialProcessedTaxGroups, companyId]);
  processedTaxGroupsRef.current = processedTaxGroups;

  useLiveMasterSelection(selectedGroupRaw, setSelected, processedTaxGroups);
  const selectedGroup = useMemo(
    () =>
      selectedGroupRaw
        ? (resolveMasterEntityGroupForSelection(
            selectedGroupRaw.id,
            processedTaxGroups,
            TAX_ENTITY_GROUP_PRESET,
            companyId || ""
          ) as TaxGroup | null)
        : null,
    [selectedGroupRaw, processedTaxGroups, companyId]
  );

  const mobileTaxDetailHeaderAvatar = useMemo(() => {
    if (!isMobile || !selected) return null;

    if (activeView !== "groups" && selectedTax) {
      const tax = selectedTax;
      const name = tax.name || "Tax";
      const attachmentUrl = trimEntityFileUrlForPreview((tax as any).fileUrl);
      const hasTransactions = (tax.debit ?? 0) !== 0 || (tax.credit ?? 0) !== 0;
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            <EditTaxDialog
              tax={tax}
              allTaxes={processedTaxes}
              onTaxUpdated={handleTaxUpdated}
              onTaxDeleted={() => setSelected(null)}
              hasTransactions={hasTransactions}
            >
              <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit tax">
                <Pencil className="h-2.5 w-2.5" aria-hidden />
              </button>
            </EditTaxDialog>
          }
        />
      );
    }

    if (activeView === "groups" && selectedGroup) {
      const group = selectedGroup;
      const name = group.name || "Tax";
      const attachmentUrl = trimEntityFileUrlForPreview((group as any).fileUrl);
      const isSystemBranchGroup = isMasterEntitySystemGroupId(TAX_ENTITY_GROUP_PRESET, group.id);
      const hasAccounts =
        processedTaxes.some((t) => t.groupId === group.id) ||
        processedTaxGroups.some((g) => g.parentId === group.id);
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            !isSystemBranchGroup ? (
              <EditTaxGroupDialog
                group={group}
                allGroups={processedTaxGroups}
                onGroupUpdated={handleTaxGroupUpdated}
                onGroupDeleted={() => setSelected(null)}
                hasAccounts={hasAccounts}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit group">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditTaxGroupDialog>
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
    selectedTax,
    selectedGroup,
    processedTaxes,
    processedTaxGroups,
    handleTaxUpdated,
    handleTaxGroupUpdated,
    setSelected,
  ]);

  const handleTaxTabChange = useCallback(
    (value: string) => {
      const tab = value === "groups" ? "groups" : "taxes";
      const items =
        (tab === "groups" ? processedTaxGroups : processedTaxes) as ReadonlyArray<{ id: string }>;
      const nextSelected = tabSwitchSelection(
        isMobile,
        pickRememberedListSelection("taxPageState", tab, items)
      );
      pendingTaxSelectIdRef.current = nextSelected?.id ?? null;
      setActiveView(tab);
      setSelected(nextSelected as (typeof processedTaxes)[number] | (typeof processedTaxGroups)[number] | null);
      const href = isMobile
        ? masterDetailTabHref("tax", { tab, defaultTab: "taxes", listOnly: true })
        : masterDetailCanonicalHref("tax", {
            tab,
            defaultTab: "taxes",
            selectedId: nextSelected?.id ?? null,
          });
      replaceMasterDetailTabUrl(href, router, useQueryNav);
      writeMasterDetailPageState("taxPageState", tab, nextSelected?.id);
    },
    [isMobile, useQueryNav, processedTaxes, processedTaxGroups, setActiveView, setSelected, router]
  );

  // ========== MEMORY LOGIC ==========
  usePageMemory(
    "taxPageState", 
    activeView,               
    setActiveView,            
    selected,                 
    setSelected,              
    activeView === 'taxes' ? processedTaxes : processedTaxGroups, 
    vouchersLoading,
    isMobile,
    selectedIdFromUrl
  );
  // ==================================

  // Clear search when company changes (prevent email/other data from carrying over)
  useEffect(() => {
    setSearchTerm("");
  }, [companyId]);
  useEffect(() => {
    setShowOnlyTaxesWithPendingApproval(false);
    setShowOnlyTaxGroupsWithPendingApproval(false);
  }, [companyId]);
  useEffect(() => {
    if (activeView !== "taxes") setShowOnlyTaxesWithPendingApproval(false);
    if (activeView !== "groups") setShowOnlyTaxGroupsWithPendingApproval(false);
  }, [activeView]);

  const taxesForTaxList = useMemo(() => {
    if (!showOnlyTaxesWithPendingApproval || !showApproveOnList) return processedTaxes;
    return processedTaxes.filter((t) => (pendingApprovalByTaxId[t.id] ?? 0) > 0);
  }, [processedTaxes, showOnlyTaxesWithPendingApproval, showApproveOnList, pendingApprovalByTaxId]);
  const filteredTaxListCount = useMemo(() => {
    const searchLower = (searchTerm || "").toLowerCase();
    return taxesForTaxList.filter((t) => (t.name && t.name.toLowerCase().includes(searchLower)) || String((t as { aliasName?: string }).aliasName || "").toLowerCase().includes(searchLower || "\u0000")).length;
  }, [taxesForTaxList, searchTerm]);
  
  const userNamesRef = useRef(userNames);
  userNamesRef.current = userNames;

  // useVouchers names — merge only when values change (identity churn must not re-render TaxDetails).
  useEffect(() => {
    if (!vouchersUserNames || Object.keys(vouchersUserNames).length === 0) return;
    setUserNames((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [uid, name] of Object.entries(vouchersUserNames)) {
        if (!name || name === "Unknown" || name === "N/A") continue;
        if (next[uid] !== name) {
          next[uid] = name;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [vouchersUserNames]);

  // Firestore fallback for missing names — never depend on fetchUserName/userNames (setState loop → LONGTASK cascade).
  useEffect(() => {
    if (!vouchers || vouchers.length === 0) return;
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean) as string[]);
    const local = userNamesRef.current;
    const uidsToFetch = Array.from(uids).filter((uid) => {
      const have = local[uid];
      if (have && have !== "Unknown" && have !== "N/A") return false;
      const vouchersName = vouchersUserNames?.[uid];
      return !vouchersName || vouchersName === "Unknown" || vouchersName === "N/A";
    });
    if (uidsToFetch.length === 0) return;

    let cancelled = false;
    void Promise.all(
      uidsToFetch.map(async (uid) => {
        try {
          const q = query(collection(firestore, "users"), where("uid", "==", uid));
          const snap = await getDocs(q);
          let data = snap.docs[0]?.data();
          if (!data) {
            const userDoc = await getDoc(doc(firestore, "users", uid));
            if (userDoc.exists()) data = userDoc.data();
          }
          if (data) {
            const displayName = data.displayName || data.name || data.email || null;
            if (
              displayName &&
              displayName !== uid &&
              !String(displayName).match(/^[a-zA-Z0-9_-]{20,}$/)
            ) {
              return { uid, name: String(displayName) };
            }
          }
        } catch {
          /* ignore */
        }
        return { uid, name: "N/A" };
      })
    ).then((results) => {
      if (cancelled) return;
      setUserNames((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const { uid, name } of results) {
          if (!name || name === "Unknown" || name === "N/A") continue;
          if (next[uid] !== name) {
            next[uid] = name;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vouchers, vouchersUserNames]);

  // Initial Mount Safety
  useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
    }
  }, []);

  const totalBalance = useMemo(() => {
    return activeView === 'taxes'
      ? processedTaxes.reduce((acc, tax) => acc + tax.balance, 0)
      : processedTaxGroups.reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, processedTaxes, processedTaxGroups]);

  const handleSelect = useCallback((item: Tax | TaxGroup, options?: GroupListSelectOptions) => {
    const isTax = "rate" in item;
    pendingTaxSelectIdRef.current = item.id;
    // Heavy TaxDetails mount off the click stack — keeps UI responsive.
    startTransition(() => {
      setSelected(item);
    });
    if (isTax) {
      setGroupMemberFilterId(null);
    } else {
      setGroupMemberFilterId(options?.memberId ?? null);
      setActiveView("groups");
    }
    if (isTax && activeView !== "taxes") setActiveView("taxes");
    const path = isTax
      ? `/tax?selected=${encodeURIComponent(item.id)}`
      : `/tax?view=groups&selected=${encodeURIComponent(item.id)}`;
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", browserHistoryHref(path));
      } catch {
        /* ignore */
      }
    }
    if (useQueryNav && shouldReplaceWithMasterDetailCanonical(path)) {
      router.replace(path, { scroll: false });
    }
  }, [useQueryNav, router, setSelected, activeView, setActiveView]);

  // Length-only (not array identity): first hydrate restores URL selection once;
  // later balance/aggregate bumps must not re-setSelected (refresh click hang).
  const taxListLen = processedTaxes.length;
  const taxGroupListLen = processedTaxGroups.length;

  // Location-first URL sync (Party jaisa) — refs + id-guard so voucher aggregate
  // updates do not re-setSelected and freeze TaxDetails after refresh.
  useEffect(() => {
    if (vouchersLoading) return;
    const { view, selectedId } = readMasterDetailLocationQuery();
    const currentSelectedId = selectedRef.current?.id ?? null;
    const currentActiveView = activeViewRef.current;
    const pendingId = pendingTaxSelectIdRef.current;
    if (pendingId) {
      if (selectedId === pendingId) pendingTaxSelectIdRef.current = null;
      else if (currentSelectedId === pendingId) return;
    }
    if (!selectedId) {
      if (view === "groups") {
        if (currentActiveView !== "groups") setActiveView("groups");
      } else if (currentActiveView !== "taxes") {
        setActiveView("taxes");
      }
      return;
    }
    const groupItem = processedTaxGroupsRef.current.find((i) => i.id === selectedId);
    const taxItem = processedTaxesRef.current.find((i) => i.id === selectedId);
    let targetView = currentActiveView;
    if (groupItem && taxItem) {
      targetView = view === "groups" ? "groups" : "taxes";
    } else if (view === "groups" && groupItem) targetView = "groups";
    else if (view === "taxes" && taxItem) targetView = "taxes";
    if (targetView !== currentActiveView) setActiveView(targetView);
    const item =
      groupItem && taxItem
        ? view === "groups"
          ? groupItem
          : taxItem
        : groupItem || taxItem;
    // Deep links mount TaxDetails (expensive) — same non-urgent path as list click.
    if (item && item.id !== currentSelectedId) {
      startTransition(() => {
        setSelected(item);
      });
    }
    const canonical =
      view === "groups"
        ? `/tax?view=groups&selected=${encodeURIComponent(selectedId)}`
        : `/tax?selected=${encodeURIComponent(selectedId)}`;
    if (shouldReplaceWithMasterDetailCanonical(canonical)) {
      router.replace(canonical, { scroll: false });
    }
  }, [
    selectedIdFromUrl,
    viewFromUrl,
    vouchersLoading,
    taxListLen,
    taxGroupListLen,
    setSelected,
    setActiveView,
    router,
  ]);

  const taxesForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    return filterMembersByMasterGroupScope<Tax>(
      selectedGroup.id,
      processedTaxes,
      processedTaxGroups,
      resolveTaxListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(TAX_ENTITY_GROUP_PRESET, id),
      (tax, branchId) => resolveTaxListGroupBucketId(tax) === branchId
    );
  }, [selectedGroup, processedTaxes, processedTaxGroups]);

  const processedTaxGroupsForList = useMemo(() => {
    if (!showOnlyTaxGroupsWithPendingApproval || !showApproveOnList) return processedTaxGroups;
    return processedTaxGroups.filter((g) => (pendingApprovalByTaxGroupId[g.id] ?? 0) > 0);
  }, [
    processedTaxGroups,
    showOnlyTaxGroupsWithPendingApproval,
    showApproveOnList,
    pendingApprovalByTaxGroupId,
  ]);

  const taxesForGroupDetails = useMemo(() => {
    if (!groupMemberFilterId) return taxesForSelectedGroup;
    return taxesForSelectedGroup.filter((t) => t.id === groupMemberFilterId);
  }, [taxesForSelectedGroup, groupMemberFilterId]);

  const taxGroupMembersByGroupId = useMemo(() => {
    const map: Record<string, Tax[]> = {};
    for (const tax of processedTaxes) {
      const bucket = resolveTaxListGroupBucketId(tax);
      if (!map[bucket]) map[bucket] = [];
      map[bucket].push(tax);
    }
    return map;
  }, [processedTaxes]);

  const filteredGroupCount = useMemo(() => {
    return computeMasterGroupListSearchVisibleCount({
      groups: processedTaxGroupsForList || [],
      config: TAX_GROUP_LIST_CONFIG,
      searchTerm,
      quickFilter: groupListQuickFilter,
      groupMembersByGroupId: taxGroupMembersByGroupId,
      visibleGroupFilter: (g) => {
        const anyG = g as { isReportOnly?: boolean; isSystemReserved?: boolean };
        if (anyG.isReportOnly === true) return false;
        if (anyG.isSystemReserved === true || isSystemParentGroup("tax_groups", g.id)) return false;
        return !!g.name;
      },
    });
  }, [processedTaxGroupsForList, searchTerm, groupListQuickFilter, taxGroupMembersByGroupId]);

  const handleMoveTaxToGroup = useCallback(
    (tax: Tax, targetGroupId: string) =>
      createMasterEntityGroupMoveHandler({
        companyId,
        company,
        groupsForName: processedTaxGroups,
        moveHelpers: taxGroupAccountMove,
        entityLabel: "Tax",
      })(tax, targetGroupId),
    [companyId, company, processedTaxGroups]
  );

  const handleMoveTaxGroupToGroup = useCallback(
    (sourceGroupId: string, targetGroupId: string) =>
      createMasterEntityGroupTreeMoveHandler({
        companyId,
        company,
        groupsForName: processedTaxGroups,
        allGroups: initialProcessedTaxGroups,
        config: TAX_GROUP_LIST_CONFIG,
        moveHelpers: taxGroupTreeMove,
      })(sourceGroupId, targetGroupId),
    [companyId, company, processedTaxGroups, initialProcessedTaxGroups]
  );

  // Stable ref for TaxDetails — inline `{...}` every render re-ran useTransactions (main-thread hang).
  const taxDetailUserNames = useMemo(
    () => ({ ...vouchersUserNames, ...userNames }),
    [vouchersUserNames, userNames]
  );

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
  
  const taxTabsEl = (
    <Tabs value={activeView} onValueChange={handleTaxTabChange} className="w-full">
      <TabsList listChrome>
        <TabsTrigger listChrome value="taxes" className="flex-1">Taxes</TabsTrigger>
        <TabsTrigger listChrome value="groups" className="flex-1">Groups</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const taxSearchRowEl = (
    <div className={mlc.searchRow}>
      <div className={mlc.searchWrap}>
        <Search className={mlc.searchIcon} />
        <Input placeholder={activeView === 'taxes' ? 'Search taxes...' : 'Search groups/tax'} listChrome listChromeSearch value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
      </div>
      {activeView === "taxes" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyTaxesWithPendingApproval}
          onToggle={() => setShowOnlyTaxesWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only taxes with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all taxes (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all taxes"
        />
      ) : null}
      {activeView === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyTaxGroupsWithPendingApproval}
          onToggle={() => setShowOnlyTaxGroupsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only groups with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all groups (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all groups"
        />
      ) : null}
      {activeView === "taxes" ? (
        <CreateTaxDialog onTaxCreated={() => {}} isOpen={isCreateTaxOpen} onOpenChange={setIsCreateTaxOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateTaxOpen(true)}>
            + Add Tax
          </PermissionButton>
        </CreateTaxDialog>
      ) : (
        <CreateTaxGroupDialog onGroupCreated={() => {}} groups={processedTaxGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
            + Add Group
          </PermissionButton>
        </CreateTaxGroupDialog>
      )}
    </div>
  );

  const taxSectionLabelEl =
    activeView === "taxes" ? (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <Receipt className={mlc.sectionIcon} />
        <span>Tax ({filteredTaxListCount})</span>
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
      searchRow={taxSearchRowEl}
      sectionLabel={taxSectionLabelEl}
      tabs={taxTabsEl}
      quickFilter={activeView === "taxes" ? taxListQuickFilter : groupListQuickFilter}
      onQuickFilterChange={activeView === "taxes" ? setTaxListQuickFilter : setGroupListQuickFilter}
    >
      {activeView === "taxes" ? (
        <TaxList
          taxes={taxesForTaxList}
          onSelectTax={handleSelect as any}
          selectedTax={selectedTax}
          searchTerm={searchTerm}
          pendingApprovalByTaxId={pendingApprovalByTaxId}
          getItemHref={useQueryNav ? (t) => `/tax?selected=${t.id}` : undefined}
          quickFilter={taxListQuickFilter}
          onQuickFilterChange={setTaxListQuickFilter}
          hideQuickFilterBar
        />
      ) : (
        <TaxGroupList
          groups={processedTaxGroupsForList}
          onSelectGroup={handleSelect}
          selectedGroup={selectedGroup}
          searchTerm={searchTerm}
          pendingApprovalByGroupId={pendingApprovalByTaxGroupId}
          pendingApprovalByMemberId={pendingApprovalByTaxId}
          groupMembersByGroupId={taxGroupMembersByGroupId}
          selectedGroupMemberFilterId={groupMemberFilterId}
          getItemHref={useQueryNav ? (g) => `/tax?view=groups&selected=${g.id}` : undefined}
          quickFilter={groupListQuickFilter}
          onQuickFilterChange={setGroupListQuickFilter}
          hideQuickFilterBar
          moveAccountsEnabled={!!companyId}
          onMoveAccountToGroup={handleMoveTaxToGroup}
          canMoveMember={taxGroupAccountMove.canMoveAccount}
          onMoveGroupToGroup={handleMoveTaxGroupToGroup}
          canMoveGroup={taxGroupTreeMove.canMoveGroup}
          allGroupsForMove={initialProcessedTaxGroups}
        />
      )}
    </MasterListViewShell>
  );

  const detailView = (
    <>
      {activeView === 'taxes' && selectedTax && (
        <TaxDetails tax={selectedTax} allTaxes={processedTaxes} onTaxUpdated={handleTaxUpdated} onTaxDeleted={() => setSelected(null)} dateRange={taxDetailsDateRange} onDateRangeChange={setTaxDetailsDateRange} userNames={taxDetailUserNames} hideMobilePeriodLabelRow={isMobile} />
      )}
      {activeView === 'groups' && selectedGroup && (
        <TaxGroupDetails key={`${selectedGroup.id}:${groupMemberFilterId ?? "all"}`} group={selectedGroup} allGroups={processedTaxGroups} taxes={taxesForGroupDetails} groupMemberFilterId={groupMemberFilterId} onGroupUpdated={() => {}} onGroupDeleted={() => setSelected(null)} onTaxUpdated={handleTaxUpdated} dateRange={groupDetailsDateRange} onDateRangeChange={setGroupDetailsDateRange} userNames={taxDetailUserNames} hideMobilePeriodLabelRow={isMobile} />
      )}
      {!selected && <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>}
    </>
  );

  return (
    <ResponsiveMasterDetail
      title={taxShellTitle}
      mobileSelectionLabel={mobileTaxSelectionLabel}
      mobileSelectionLabelClassName={mobileTaxSelectionLabelClassName}
      mobileDetailHeaderEnd={mobileTaxDetailHeaderAvatar}
      mobileDetailHeaderSecondary={mobileTaxHeaderSecondary}
      balance={
        <span className={cn(
            "font-semibold",
            totalBalance >= 0 ? "text-green-600" : "text-red-600"
        )}>
            {formatCurrency(totalBalance, { showDrCr: true })}
        </span>
      }
      tabs={isMobile ? undefined : taxTabsEl}
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

export default function TaxPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<LoadingSpinner />}>
      <TaxPageContent />
    </Suspense>
  );
}
