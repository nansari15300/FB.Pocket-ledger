
"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Search, Pencil } from "lucide-react";
import { EditStaffDialog } from "@/components/staff/EditStaffDialog";
import { EditStaffGroupDialog } from "@/components/staff/EditStaffGroupDialog";
import { LEDGER_HEADER_AVATAR_PEN_CN } from "@/lib/ledgerHeaderChrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDate } from "@/hooks/useDate";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StaffList } from "@/components/staff/StaffList";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { StaffLiabilityGroupList } from "@/components/staff/StaffLiabilityGroupList";
import { StaffGroupDetails } from "@/components/staff/StaffGroupDetails";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { CreateStaffGroupDialog } from "@/components/staff/CreateStaffGroupDialog";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import { useVouchers } from "@/hooks/useVouchers";
import { useLiveMasterSelection } from "@/hooks/useLiveMasterSelection";
import usePermissions from "@/hooks/usePermissions";
import type { DateRange } from "@/components/ui/ad-calendar";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { MobileMasterDetailNestedName } from "@/components/entity/MobileMasterDetailNestedName";
import type { Staff, StaffGroup } from "@/components/staff/types";
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
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoanStaffNavTitle } from "@/components/layout/LoanStaffNavTitle";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mlc } from "@/lib/mobileListChrome";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { type EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";

// Custom Hook
import { usePageMemory } from "@/hooks/usePageMemory";
import { isSystemParentGroup } from "@/lib/system-groups";
import { shouldReplaceWithMasterDetailCanonical } from "@/lib/maybeReplaceMasterDetailUrl";
import { collectStaffIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesStaffLedger";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { StaffEntityNavIcon } from "@/components/entity/StaffEntityIcon";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { MobileMasterDetailHeaderAvatar } from "@/components/entity/MobileMasterDetailHeaderAvatar";
import { MobileMasterDetailHeaderDateSecondary } from "@/components/entity/MobileMasterDetailHeaderDateSecondary";
import { mobileEntityDetailShellTitle } from "@/lib/mobileDetailChrome";
import {
  STAFF_ENTITY_ADD_BUTTON,
  STAFF_ENTITY_LABEL,
  STAFF_ENTITY_SEARCH_PLACEHOLDER,
} from "@/lib/staffEntityDisplayName";
import { isLoanLiabilityStaff } from "@/modules/loans/utils/loanLiabilityStaff";
import { LOAN_LIABILITY_GROUP_ID } from "@/modules/loans/constants/loanConstants";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import {
  buildStaffPageLiabilityGroupTree,
  staffMembersForGroupSelection,
} from "@/lib/staffPageLiabilityGroupTree";
import { masterEntityTextMatchesSearch } from "@/lib/filterMasterEntityListRows";
import { createMasterEntityGroupMoveHandler } from "@/lib/createMasterEntityGroupMoveHandler";
import { createMasterEntityGroupTreeMoveHandler } from "@/lib/createMasterEntityGroupTreeMoveHandler";
import { STAFF_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { computeMasterGroupListSearchVisibleCount } from "@/lib/masterGroupListTree";
import { staffGroupTreeMove } from "@/lib/masterEntityGroupTreeMoveHelpers";
import { staffGroupAccountMove } from "@/lib/masterEntityGroupAccountMove";
import { STAFF_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import {
  appendMasterEntitySystemBranchGroups,
  isMasterEntitySystemGroupId,
  resolveMasterEntityGroupForSelection,
  resolveStaffListGroupBucketId,
} from "@/lib/masterEntitySystemGroups";
import { StaffPayEmiFlow } from "@/modules/loans/components/StaffPayEmiFlow";
import { useStaffPayEmiButtonState } from "@/modules/loans/hooks/useStaffPayEmiButtonState";
import { payEmiButtonClassName, payEmiButtonVariant } from "@/modules/loans/utils/payEmiButtonStyle";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";

function StaffPageContent() {
  const { user } = useAuth();
  const { company, companyId, effectiveNotificationSettings } = useCompany();
  const { formatCurrency, formatRunning } = useDate();
  const { vouchers, loading: vouchersLoading, processedStaff, processedStaffGroups: initialProcessedStaffGroups, userNames } = useVouchers();
  const { can } = usePermissions();
  const showApproveOnList =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false;
  const pendingApprovalByStaffId = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedStaff?.length) return {} as Record<string, number>;
    const staffIdSet = new Set(processedStaff.map((s: Staff) => s.id));
    const map: Record<string, number> = {};
    vouchers.forEach((v: any) => {
      const touched = collectStaffIdsTouchedByUnapprovedVoucher(v, staffIdSet);
      touched.forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }, [vouchers, showApproveOnList, processedStaff]);
  const pendingApprovalByStaffGroupId = useMemo(() => {
    if (!showApproveOnList) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    processedStaff.forEach((s: any) => {
      const n = pendingApprovalByStaffId[s.id] || 0;
      if (!n) return;
      const gid = resolveStaffListGroupBucketId(s);
      map[gid] = (map[gid] || 0) + n;
    });
    return map;
  }, [processedStaff, pendingApprovalByStaffId, showApproveOnList]);
  const totalPendingApprovalVoucherCount = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedStaff?.length) return 0;
    const staffIdSet = new Set(processedStaff.map((s: Staff) => s.id));
    let n = 0;
    for (const v of vouchers as any[]) {
      if (v?.isApproved === true) continue;
      if (collectStaffIdsTouchedByUnapprovedVoucher(v, staffIdSet).size > 0) n += 1;
    }
    return n;
  }, [vouchers, showApproveOnList, processedStaff]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIdFromUrl = searchParams.get("selected");
  const viewFromUrl = searchParams.get("view");
  const isInitialMount = useRef(true);
  
  const [activeView, setActiveView] = useState("staff");
  const { isMobile, selected, setSelected } = useResponsiveListLayout<Staff | StaffGroup>(`staff_view_${activeView}`);

  const useQueryNav = useMasterDetailQueryNav();
  const pendingStaffSelectIdRef = useRef<string | null>(null);
  const onBackToList = useCallback(() => {
    pendingStaffSelectIdRef.current = null;
    // Pehle URL clear — warna sync effect purani ?selected= se detail wapas kholta hai
    const href = applyMasterDetailBackToListUrl("staff");
    setSelected(null);
    router.replace(href, { scroll: false });
  }, [setSelected, router]);
  useRegisterMasterDetailHardwareBack("staff", onBackToList);

  const [searchTerm, setSearchTerm] = useState("");
  const [staffListQuickFilter, setStaffListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const {
    showOnlyEntities: showOnlyStaffWithPendingApproval,
    setShowOnlyEntities: setShowOnlyStaffWithPendingApproval,
    showOnlyGroups: showOnlyStaffGroupsWithPendingApproval,
    setShowOnlyGroups: setShowOnlyStaffGroupsWithPendingApproval,
  } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [groupMemberFilterId, setGroupMemberFilterId] = useState<string | null>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [payEmiOpen, setPayEmiOpen] = useState(false);
  const [payEmiPreferredAccountId, setPayEmiPreferredAccountId] = useState<string | null>(null);
  const [voucherDefaultTab, setVoucherDefaultTab] = useState<'add_salary' | 'payment_out'>('add_salary');

  const selectedStaffRaw = activeView === 'staff' ? selected as Staff : null;
  const selectedStaff = useLiveMasterSelection<Staff>(selectedStaffRaw, setSelected, processedStaff);
  const payEmiSelectedAccountId =
    selectedStaff && isLoanLiabilityStaff(selectedStaff) ? selectedStaff.id : null;
  const { show: showPayEmiButton, emiDue: payEmiDue } = useStaffPayEmiButtonState({
    companyId,
    processedStaff,
    selectedAccountId: payEmiSelectedAccountId,
  });
  const selectedGroupRaw = activeView === 'groups' ? selected as StaffGroup : null;
  const handleStaffUpdated = useCallback((patch?: Partial<Staff>) => {
    if (!patch?.id || !selectedStaffRaw || selectedStaffRaw.id !== patch.id) return;
    setSelected({ ...selectedStaffRaw, ...patch });
  }, [setSelected, selectedStaffRaw]);
  const handleStaffGroupUpdated = useCallback((patch?: Partial<StaffGroup>) => {
    if (!patch?.id || !selectedGroupRaw || selectedGroupRaw.id !== patch.id) return;
    setSelected({ ...selectedGroupRaw, ...patch });
  }, [setSelected, selectedGroupRaw]);
  const mobileStaffSelectionLabelClassName = useMemo(() => {
    if (!selected) return undefined;
    return masterDetailBalanceToneClass((selected as Staff | StaffGroup).balance);
  }, [selected]);
  const mobileStaffSelectionLabel = useMemo((): ReactNode => {
    if (!selected) return null;
    if (activeView !== "groups") {
      const name = selectedStaff?.name ?? (selected as Staff).name;
      return name && String(name).trim() ? String(name).trim() : null;
    }
    const group = selected as StaffGroup;
    if (groupMemberFilterId) {
      const member = processedStaff.find((staff) => staff.id === groupMemberFilterId);
      return (
        <MobileMasterDetailNestedName
          groupName={group.name}
          memberName={member?.name ?? null}
          toneClassName={mobileStaffSelectionLabelClassName}
        />
      );
    }
    const name = group.name;
    return name && String(name).trim() ? String(name).trim() : null;
  }, [selected, selectedStaff, activeView, groupMemberFilterId, processedStaff, mobileStaffSelectionLabelClassName]);
  const [staffLedgerSplitMode, setStaffLedgerSplitMode] = useState<"tax" | "salary">("salary");
  const staffDateRangeClearRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    setStaffLedgerSplitMode("salary");
  }, [selected?.id]);
  const staffDetailShellLabel =
    staffLedgerSplitMode === "tax" ? "Staff tax details" : "Staff salary details";
  const staffShellTitle = useMemo(
    () => mobileEntityDetailShellTitle(isMobile, Boolean(selected), "Staff", staffDetailShellLabel),
    [isMobile, selected, staffDetailShellLabel]
  );
  const mobileStaffHeaderSecondary = useMemo((): ReactNode | undefined => {
    if (!isMobile || !selected) return undefined;
    return (
      <MobileMasterDetailHeaderDateSecondary
        dateRange={dateRange}
        onClear={() => {
          // StaffDetails local search + date sync (top X = search clear)
          if (staffDateRangeClearRef.current) staffDateRangeClearRef.current();
          else setDateRange(undefined);
        }}
      />
    );
  }, [isMobile, selected, dateRange]);
  useSyncMasterDetailHeaderId("staff", selectedStaff?.id ?? selectedGroupRaw?.id ?? null);

  const processedStaffGroups = useMemo(() => {
    const userGroups = initialProcessedStaffGroups.filter((g) => {
      const anyG = g as any;
      if (anyG.isAutoUngrouped === true) return false;
      if (anyG.isReportOnly === true || anyG.isSystemReserved === true) return false;
      if (isSystemParentGroup("staff_groups", anyG.id)) return false;
      return true;
    });
    return appendMasterEntitySystemBranchGroups(
      userGroups,
      STAFF_ENTITY_GROUP_PRESET,
      companyId || ""
    );
  }, [initialProcessedStaffGroups, companyId]);

  useLiveMasterSelection(selectedGroupRaw, setSelected, processedStaffGroups);
  const selectedGroup = useMemo(
    () =>
      selectedGroupRaw
        ? (resolveMasterEntityGroupForSelection(
            selectedGroupRaw.id,
            processedStaffGroups,
            STAFF_ENTITY_GROUP_PRESET,
            companyId || ""
          ) as StaffGroup | null)
        : null,
    [selectedGroupRaw, processedStaffGroups, companyId]
  );

  const mobileStaffDetailHeaderAvatar = useMemo(() => {
    if (!isMobile || !selected) return null;

    if (activeView === "staff" && selectedStaff) {
      const staff = selectedStaff;
      const name = staff.name || STAFF_ENTITY_LABEL;
      const attachmentUrl = trimEntityFileUrlForPreview((staff as any).fileUrl);
      const hasTransactions = (staff.debit ?? 0) !== 0 || (staff.credit ?? 0) !== 0;
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            <EditStaffDialog
              staff={staff}
              allGroups={processedStaffGroups}
              onStaffUpdated={handleStaffUpdated}
              onStaffDeleted={() => setSelected(null)}
              hasTransactions={hasTransactions}
            >
              <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit staff">
                <Pencil className="h-2.5 w-2.5" aria-hidden />
              </button>
            </EditStaffDialog>
          }
        />
      );
    }

    if (activeView === "groups" && selectedGroup) {
      const group = selectedGroup;
      const name = group.name || STAFF_ENTITY_LABEL;
      const attachmentUrl = trimEntityFileUrlForPreview((group as any).fileUrl);
      const isSystemBranchGroup = isMasterEntitySystemGroupId(STAFF_ENTITY_GROUP_PRESET, group.id);
      const hasAccounts =
        processedStaff.some((s) => s.groupId === group.id) ||
        processedStaffGroups.some((g) => g.parentId === group.id);
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            !isSystemBranchGroup ? (
              <EditStaffGroupDialog
                group={group}
                allGroups={processedStaffGroups}
                onGroupUpdated={handleStaffGroupUpdated}
                onGroupDeleted={() => setSelected(null)}
                hasAccounts={hasAccounts}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit group">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditStaffGroupDialog>
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
    selectedStaff,
    selectedGroup,
    processedStaff,
    processedStaffGroups,
    handleStaffUpdated,
    handleStaffGroupUpdated,
    setSelected,
  ]);

  const processedStaffGroupsForList = useMemo(() => {
    if (!showOnlyStaffGroupsWithPendingApproval || !showApproveOnList) return processedStaffGroups;
    return processedStaffGroups.filter((g) => (pendingApprovalByStaffGroupId[g.id] ?? 0) > 0);
  }, [
    processedStaffGroups,
    showOnlyStaffGroupsWithPendingApproval,
    showApproveOnList,
    pendingApprovalByStaffGroupId,
  ]);

  const staffLiabilityGroupTree = useMemo(
    () =>
      buildStaffPageLiabilityGroupTree({
        processedStaff,
        salaryGroups: processedStaffGroupsForList,
        staffGroupsMeta: initialProcessedStaffGroups,
        companyId: companyId || "",
      }),
    [processedStaff, processedStaffGroupsForList, initialProcessedStaffGroups, companyId]
  );

  const pendingApprovalByStaffGroupIdWithParent = useMemo(() => {
    let loanMemberPending = 0;
    let staffMemberPending = 0;
    for (const [staffId, count] of Object.entries(pendingApprovalByStaffId)) {
      const row = processedStaff.find((s) => s.id === staffId);
      if (!row || count <= 0) continue;
      if (isLoanLiabilityStaff(row)) loanMemberPending += count;
      else staffMemberPending += count;
    }
    return {
      ...pendingApprovalByStaffGroupId,
      [LOAN_LIABILITY_GROUP_ID]:
        (pendingApprovalByStaffGroupId[LOAN_LIABILITY_GROUP_ID] ?? 0) + loanMemberPending,
      [STAFF_SYSTEM_GROUP_ID]:
        (pendingApprovalByStaffGroupId[STAFF_SYSTEM_GROUP_ID] ?? 0) + staffMemberPending,
    };
  }, [pendingApprovalByStaffGroupId, pendingApprovalByStaffId, processedStaff]);

  /** Party-style tab switch — EXE/APK stale ?selected= snap-back band. */
  const handleStaffTabChange = useCallback(
    (value: string) => {
      const tab = value === "groups" ? "groups" : "staff";
      const items =
        (tab === "groups" ? staffLiabilityGroupTree.allGroups : processedStaff) as ReadonlyArray<{ id: string }>;
      const nextSelected = tabSwitchSelection(
        isMobile,
        pickRememberedListSelection("staffPageState", tab, items)
      );
      pendingStaffSelectIdRef.current = nextSelected?.id ?? null;
      setActiveView(tab);
      setSelected(nextSelected as (typeof processedStaff)[number] | (typeof processedStaffGroups)[number] | null);
      const href = isMobile
        ? masterDetailTabHref("staff", { tab, defaultTab: "staff", listOnly: true })
        : masterDetailCanonicalHref("staff", {
            tab,
            defaultTab: "staff",
            selectedId: nextSelected?.id ?? null,
          });
      replaceMasterDetailTabUrl(href, router, useQueryNav);
      writeMasterDetailPageState("staffPageState", tab, nextSelected?.id);
    },
    [isMobile, useQueryNav, processedStaff, staffLiabilityGroupTree.allGroups, setActiveView, setSelected, router]
  );

  // ========== MEMORY LOGIC ==========
  usePageMemory(
    "staffPageState", 
    activeView,               
    setActiveView,            
    selected,                 
    setSelected,              
    activeView === 'staff' ? processedStaff : staffLiabilityGroupTree.allGroups, 
    vouchersLoading,
    isMobile,
    selectedIdFromUrl
  );
  // ==================================

  // Clear search and selected staff when company changes
  useEffect(() => {
    setSearchTerm("");
    setSelected(null);
  }, [companyId, setSelected]);
  useEffect(() => {
    setShowOnlyStaffWithPendingApproval(false);
    setShowOnlyStaffGroupsWithPendingApproval(false);
  }, [companyId]);
  useEffect(() => {
    if (activeView !== "staff") setShowOnlyStaffWithPendingApproval(false);
    if (activeView !== "groups") setShowOnlyStaffGroupsWithPendingApproval(false);
  }, [activeView]);

  const staffForStaffList = useMemo(() => {
    if (!showOnlyStaffWithPendingApproval || !showApproveOnList) return processedStaff;
    return processedStaff.filter((s) => (pendingApprovalByStaffId[s.id] ?? 0) > 0);
  }, [processedStaff, showOnlyStaffWithPendingApproval, showApproveOnList, pendingApprovalByStaffId]);
  const filteredStaffListCount = useMemo(() => {
    const searchLower = (searchTerm || "").toLowerCase();
    return staffForStaffList.filter((s) => (s.name && s.name.toLowerCase().includes(searchLower)) || String((s as { aliasName?: string }).aliasName || "").toLowerCase().includes(searchLower || "\u0000")).length;
  }, [staffForStaffList, searchTerm]);

  const processedStaffRef = useRef(processedStaff);
  const processedStaffGroupsRef = useRef(processedStaffGroups);
  const staffLiabilityGroupsRef = useRef(staffLiabilityGroupTree.allGroups);
  const selectedStaffPageRef = useRef(selected);
  const activeStaffViewRef = useRef(activeView);
  processedStaffRef.current = processedStaff;
  processedStaffGroupsRef.current = processedStaffGroups;
  staffLiabilityGroupsRef.current = staffLiabilityGroupTree.allGroups;
  selectedStaffPageRef.current = selected;
  activeStaffViewRef.current = activeView;
  const staffListLen = processedStaff.length;
  const staffGroupListLen = processedStaffGroups.length;
  const staffLiabilityGroupLen = staffLiabilityGroupTree.allGroups.length;

  // Location-first URL sync (Party jaisa) — id-guard; skip aggregate identity deps (refresh hang).
  useEffect(() => {
    if (vouchersLoading) return;
    const { view, selectedId } = readMasterDetailLocationQuery();
    const currentSelectedId = selectedStaffPageRef.current?.id ?? null;
    const currentActiveView = activeStaffViewRef.current;
    const pendingId = pendingStaffSelectIdRef.current;
    if (pendingId) {
      if (selectedId === pendingId) pendingStaffSelectIdRef.current = null;
      else if (currentSelectedId === pendingId) return;
    }
    if (!selectedId) {
      if (view === "groups") {
        if (currentActiveView !== "groups") setActiveView("groups");
      } else if (currentActiveView !== "staff") {
        setActiveView("staff");
      }
      return;
    }
    const groupItem =
      staffLiabilityGroupsRef.current.find((i) => i.id === selectedId) ||
      processedStaffGroupsRef.current.find((i) => i.id === selectedId);
    const staffItem = processedStaffRef.current.find((i) => i.id === selectedId);
    if (view === "groups" && groupItem && currentActiveView !== "groups") setActiveView("groups");
    else if (view === "staff" && staffItem && currentActiveView !== "staff") setActiveView("staff");
    const item =
      groupItem && staffItem
        ? view === "groups"
          ? groupItem
          : staffItem
        : groupItem || staffItem;
    if (item && item.id !== currentSelectedId) setSelected(item);
    const canonical =
      view === "groups"
        ? `/staff?view=groups&selected=${encodeURIComponent(selectedId)}`
        : `/staff?selected=${encodeURIComponent(selectedId)}`;
    if (shouldReplaceWithMasterDetailCanonical(canonical)) {
      router.replace(canonical, { scroll: false });
    }
  }, [
    selectedIdFromUrl,
    viewFromUrl,
    vouchersLoading,
    staffListLen,
    staffGroupListLen,
    staffLiabilityGroupLen,
    setSelected,
    setActiveView,
    router,
  ]);

  const openPayEmi = () => {
    const staff = selectedStaff as Staff | undefined;
    setPayEmiPreferredAccountId(staff?.id && isLoanLiabilityStaff(staff) ? staff.id : null);
    setPayEmiOpen(true);
  };

  const openVoucherDialog = (mode: 'add_salary' | 'payment_out') => {
    setVoucherDefaultTab(mode);
    setIsVoucherDialogOpen(true);
  }

  // Initial Mount Safety
  useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
    }
  }, []);

  const totalBalance = useMemo(() => {
    if (activeView === 'staff') {
      return processedStaff.reduce((acc, staff) => acc + staff.balance, 0);
    }
    return processedStaff.reduce((acc, staff) => acc + staff.balance, 0);
  }, [activeView, processedStaff]);

  const filteredStaffGroupCount = useMemo(() => {
    return computeMasterGroupListSearchVisibleCount({
      groups: staffLiabilityGroupTree.childGroups,
      config: STAFF_GROUP_LIST_CONFIG,
      searchTerm,
      quickFilter: groupListQuickFilter,
      groupMembersByGroupId: staffLiabilityGroupTree.groupMembersByGroupId,
      visibleGroupFilter: (g) => !!g?.name && !!g.id,
    });
  }, [staffLiabilityGroupTree.childGroups, staffLiabilityGroupTree.groupMembersByGroupId, searchTerm, groupListQuickFilter]);

  const handleSelect = useCallback((item: Staff | StaffGroup, options?: GroupListSelectOptions) => {
    // Staff rows have `groupId`; staff *groups* have `ownerId` too — `"ownerId" in item` breaks child pick.
    const isStaffMember = "groupId" in item;
    pendingStaffSelectIdRef.current = item.id;
    if (isStaffMember) {
      setGroupMemberFilterId(null);
      if (activeView !== "staff") setActiveView("staff");
    } else {
      setGroupMemberFilterId(options?.memberId ?? null);
      setActiveView("groups");
    }
    setSelected(item);
    const path = isStaffMember
      ? `/staff?selected=${encodeURIComponent(item.id)}`
      : `/staff?view=groups&selected=${encodeURIComponent(item.id)}`;
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", browserHistoryHref(path));
      } catch {
        /* ignore */
      }
    }
    if (useQueryNav) {
      router.replace(path, { scroll: false });
    }
  }, [router, setSelected, useQueryNav, setActiveView, activeView]);
  
  const staffForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    return staffMembersForGroupSelection(selectedGroup.id, processedStaff, staffLiabilityGroupTree);
  }, [selectedGroup, processedStaff, staffLiabilityGroupTree]);

  const staffForGroupDetails = useMemo(() => {
    if (!groupMemberFilterId) return staffForSelectedGroup;
    return staffForSelectedGroup.filter((s) => s.id === groupMemberFilterId);
  }, [staffForSelectedGroup, groupMemberFilterId]);

  const staffGroupMembersByGroupId = staffLiabilityGroupTree.groupMembersByGroupId;

  const handleMoveStaffToGroup = useCallback(
    (staff: Staff, targetGroupId: string) =>
      createMasterEntityGroupMoveHandler({
        companyId,
        company,
        groupsForName: staffLiabilityGroupTree.allGroups,
        moveHelpers: staffGroupAccountMove,
        entityLabel: "Staff",
      })(staff, targetGroupId),
    [companyId, company, staffLiabilityGroupTree.allGroups]
  );

  const handleMoveStaffGroupToGroup = useCallback(
    (sourceGroupId: string, targetGroupId: string) =>
      createMasterEntityGroupTreeMoveHandler({
        companyId,
        company,
        groupsForName: staffLiabilityGroupTree.allGroups,
        allGroups: initialProcessedStaffGroups,
        config: STAFF_GROUP_LIST_CONFIG,
        moveHelpers: staffGroupTreeMove,
      })(sourceGroupId, targetGroupId),
    [companyId, company, staffLiabilityGroupTree.allGroups, initialProcessedStaffGroups]
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
                        Please select a company to view staff data.
                    </CardDescription>
                </CardHeader>
            </Card>
        </div>
    );
 }

 const staffTabsEl = (
    <Tabs value={activeView} onValueChange={handleStaffTabChange} className="w-full">
      <TabsList listChrome>
        <TabsTrigger listChrome value="staff" className="flex-1">{STAFF_ENTITY_LABEL}</TabsTrigger>
        <TabsTrigger listChrome value="groups" className="flex-1">Groups</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const staffSearchRowEl = (
    <div className={mlc.searchRow}>
      <div className={mlc.searchWrap}>
        <Search className={mlc.searchIcon} />
        <Input
          placeholder={activeView === 'staff' ? STAFF_ENTITY_SEARCH_PLACEHOLDER : 'Search groups/staff'}
          listChrome
          listChromeSearch
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {activeView === "staff" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyStaffWithPendingApproval}
          onToggle={() => setShowOnlyStaffWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only staff with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all staff (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all staff"
        />
      ) : null}
      {activeView === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyStaffGroupsWithPendingApproval}
          onToggle={() => setShowOnlyStaffGroupsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only groups with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all groups (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all groups"
        />
      ) : null}
      {activeView === "staff" ? (
        <CreateStaffDialog onStaffCreated={() => {}} groups={processedStaffGroups} isOpen={isCreateStaffOpen} onOpenChange={setIsCreateStaffOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateStaffOpen(true)}>
            {STAFF_ENTITY_ADD_BUTTON}
          </PermissionButton>
        </CreateStaffDialog>
      ) : (
        <CreateStaffGroupDialog onGroupCreated={() => {}} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} groups={processedStaffGroups}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
            + Add Group
          </PermissionButton>
        </CreateStaffGroupDialog>
      )}
    </div>
  );

  const staffActionRowEl = (
    <div className={mlc.actionRow}>
      <div className={cn("grid gap-1", showPayEmiButton ? "grid-cols-3" : "grid-cols-2")}>
        <PermissionButton permission="create_records" variant="outline" size="list" className="w-full" onClick={() => openVoucherDialog("add_salary")}>
          Add Salary
        </PermissionButton>
        {showPayEmiButton ? (
          <PermissionButton
            permission="create_records"
            variant={payEmiButtonVariant(payEmiDue)}
            size="list"
            className={payEmiButtonClassName(payEmiDue, "w-full")}
            onClick={openPayEmi}
          >
            Pay EMI
          </PermissionButton>
        ) : null}
        <PermissionButton permission="create_records" variant="chromePill" size="list" className="w-full" onClick={() => openVoucherDialog("payment_out")}>
          Pay Salary
        </PermissionButton>
      </div>
    </div>
  );

  const staffSectionLabelEl = (
    <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
      <StaffEntityNavIcon className={mlc.sectionIcon} />
      <span>
        {activeView === "staff"
          ? `${STAFF_ENTITY_LABEL} (${filteredStaffListCount})`
          : `Groups (${filteredStaffGroupCount})`}
      </span>
    </div>
  );

 const listView = (
    <MasterListViewShell
      isMobile={isMobile}
      searchRow={staffSearchRowEl}
      sectionLabel={staffSectionLabelEl}
      actionRow={staffActionRowEl}
      tabs={staffTabsEl}
      quickFilter={activeView === "staff" ? staffListQuickFilter : groupListQuickFilter}
      onQuickFilterChange={activeView === "staff" ? setStaffListQuickFilter : setGroupListQuickFilter}
    >
      {activeView === "staff" ? (
        <StaffList
          staff={staffForStaffList}
          onSelectStaff={handleSelect as any}
          selectedStaff={selectedStaff}
          searchTerm={searchTerm}
          pendingApprovalByStaffId={pendingApprovalByStaffId}
          getItemHref={useQueryNav ? (s) => `/staff?selected=${s.id}` : undefined}
          quickFilter={staffListQuickFilter}
          onQuickFilterChange={setStaffListQuickFilter}
          hideQuickFilterBar
        />
      ) : (
        <StaffLiabilityGroupList
          systemGroup={staffLiabilityGroupTree.systemGroup}
          childGroups={staffLiabilityGroupTree.childGroups}
          groupMembersByGroupId={staffGroupMembersByGroupId}
          onSelectGroup={handleSelect}
          selectedGroup={selectedGroup}
          searchTerm={searchTerm}
          pendingApprovalByGroupId={pendingApprovalByStaffGroupIdWithParent}
          pendingApprovalByMemberId={pendingApprovalByStaffId}
          selectedGroupMemberFilterId={groupMemberFilterId}
          getItemHref={useQueryNav ? (g) => `/staff?view=groups&selected=${g.id}` : undefined}
          quickFilter={groupListQuickFilter}
          onQuickFilterChange={setGroupListQuickFilter}
          hideQuickFilterBar
          moveAccountsEnabled={!!companyId}
          onMoveAccountToGroup={handleMoveStaffToGroup}
          canMoveMember={staffGroupAccountMove.canMoveAccount}
          onMoveGroupToGroup={handleMoveStaffGroupToGroup}
          canMoveGroup={staffGroupTreeMove.canMoveGroup}
          allGroupsForMove={initialProcessedStaffGroups}
        />
      )}
    </MasterListViewShell>
);

{/* Render detail view with stable component types + keys so it does NOT remount when vouchers/table data updates (which would close Add Voucher dialog). */}
  const detailView = activeView === "staff" && selectedStaff ? (
    <StaffDetails
      key={`staff-${selectedStaff.id}`}
      staff={selectedStaff}
      allStaff={processedStaff}
      allGroups={processedStaffGroups}
      onStaffUpdated={handleStaffUpdated}
      onStaffDeleted={() => setSelected(null)}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      userNames={userNames}
      hideMobilePeriodLabelRow={isMobile}
      onLedgerSplitModeChange={setStaffLedgerSplitMode}
      onRegisterClearDateRange={(fn) => {
        staffDateRangeClearRef.current = fn;
      }}
    />
  ) : activeView === "groups" && selectedGroup ? (
    <StaffGroupDetails
      key={`group-${selectedGroup.id}:${groupMemberFilterId ?? "all"}`}
      group={selectedGroup}
      allGroups={processedStaffGroups}
      staff={staffForGroupDetails}
      groupMemberFilterId={groupMemberFilterId}
      onGroupUpdated={() => {}}
      onGroupDeleted={() => setSelected(null)}
      onStaffUpdated={handleStaffUpdated}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      userNames={userNames}
      hideMobilePeriodLabelRow={isMobile}
    />
  ) : (
    <div className="p-6 text-center text-muted-foreground">Select an item to view details</div>
  );

  return (
    <>
    <ResponsiveMasterDetail
      title={
        isMobile && selected ? staffShellTitle : <LoanStaffNavTitle active="staff" />
      }
      mobileSelectionLabel={mobileStaffSelectionLabel}
      mobileSelectionLabelClassName={mobileStaffSelectionLabelClassName}
      mobileDetailHeaderEnd={mobileStaffDetailHeaderAvatar}
      mobileDetailHeaderSecondary={mobileStaffHeaderSecondary}
      balance={
        <span className={cn(
            "font-semibold",
            // >= 0 (Payable/Salaries) Red, < 0 (Advance/Receivable) Green (Staff Logic Might Differ)
            // Typically: Cr (Payable) = Red, Dr (Advance) = Green
            totalBalance >= 0 ? "text-green-600" : "text-red-600"
        )}>
            {formatCurrency(totalBalance, { showDrCr: true })}
        </span>
      }
      tabs={isMobile ? undefined : staffTabsEl}
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
    <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={setIsVoucherDialogOpen}
        onVoucherCreated={() => {}}
        defaultTab={voucherDefaultTab}
        defaultVoucherData={voucherDefaultTab === 'payment_out' ? { payeeType: 'staff', ...(selectedStaff ? { staffId: selectedStaff.id } : {}) } : undefined}
     />
    <StaffPayEmiFlow
      open={payEmiOpen}
      onOpenChange={setPayEmiOpen}
      preferredAccountId={payEmiPreferredAccountId}
    />
    </>
  );
}

export default function StaffPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<LoadingSpinner />}>
      <StaffPageContent />
    </Suspense>
  );
}

