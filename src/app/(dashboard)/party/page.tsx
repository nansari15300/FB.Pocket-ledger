
"use client";

import { Suspense, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, User, Users, AlertCircle, ArrowLeft, XCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { MobileMasterDetailNestedName } from "@/components/entity/MobileMasterDetailNestedName";
import { mlc } from "@/lib/mobileListChrome";
import { mdc, mobileEntityDetailShellTitle } from "@/lib/mobileDetailChrome";
import { MobileEntityTxnToolbarRow, MobileEntityTxnToolbarSearch } from "@/components/entity/MobileEntityTxnToolbarRow";
import { MobileLedgerFooterChevronFab } from "@/components/layout/MobileLedgerFooterChevronFab";
import { MobileMasterDetailHeaderAvatar } from "@/components/entity/MobileMasterDetailHeaderAvatar";
import { EditPartyDialog } from "@/components/party/EditPartyDialog";
import { EditGroupDialog } from "@/components/party/EditGroupDialog";
import { LEDGER_HEADER_AVATAR_PEN_CN } from "@/lib/ledgerHeaderChrome";
import { MobileMasterDetailHeaderDateSecondary } from "@/components/entity/MobileMasterDetailHeaderDateSecondary";
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams } from "next/navigation";
import { PartyList } from "@/components/party/PartyList";
import { PartyDetails } from "@/components/party/PartyDetails";
import { PartyGroupList } from "@/components/party/PartyGroupList";
import { GroupDetails } from "@/components/party/GroupDetails";
import { OverdueAccountView, type OverdueTransactionRow } from "@/components/party/OverdueAccountView";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { HistoryDialog } from "@/components/vouchers/HistoryDialog";
import { LinkAdvancesToVoucherDialog } from "@/components/vouchers/LinkAdvancesToVoucherDialog";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";

export const OVERDUE_ACCOUNT_ID = "__overdue__";
import { CreatePartyDialog } from "@/components/party/CreatePartyDialog";
import { CreateGroupDialog } from "@/components/party/CreateGroupDialog";
import { PermissionButton } from "@/components/permission";
import { useVouchers } from "@/hooks/useVouchers";
import { masterEntityProfileUiFields, resolveMasterListSelection } from "@/lib/masterEntityLiveUpdate";
import usePermissions from "@/hooks/usePermissions";
import type { Party, Group } from "@/components/party/types";
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { collection, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { applyPaymentBillWiseLinkAllocations } from "@/lib/voucherActionsClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMasterDetailQueryNav } from "@/hooks/useMasterDetailQueryNav";
import { useRegisterMasterDetailHardwareBack } from "@/hooks/useRegisterMasterDetailHardwareBack";
import { useSyncMasterDetailHeaderId } from "@/hooks/useSyncMasterDetailHeaderId";
import { applyMasterDetailBackToListUrl, masterDetailListHref } from "@/lib/masterDetailListPath";
import {
  masterDetailTabHref,
  replaceMasterDetailTabUrl,
  tabSwitchSelection,
} from "@/lib/masterDetailTabChange";
import type { DateRange } from "@/components/ui/ad-calendar";
import { toast } from "sonner";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";

// Custom Hook
import { usePageMemory } from "@/hooks/usePageMemory";
import {
  buildPartySystemBranchSelectionGroup,
  isPartyDirectOnSystemBranch,
  isPartySystemGroupId,
  normalizePartyGroupIdForStorage,
  PARTY_DEFAULT_SYSTEM_GROUP_ID,
  PARTY_SYSTEM_DEBTORS_ID,
  PARTY_SYSTEM_GROUP_OPTIONS,
  resolvePartyGroupForSelection,
  resolvePartyListGroupBucketId,
} from "@/lib/partySystemGroups";
import { filterPartiesForPartyGroupScope } from "@/lib/partyGroupScope";
import { isSystemParentGroup } from "@/lib/system-groups";
import { shouldReplaceWithMasterDetailCanonical } from "@/lib/maybeReplaceMasterDetailUrl";
import { appendPreservedModalQueryToHref } from "@/lib/modalUrlSync";
import { browserHistoryHref } from "@/lib/webAppBasePath";
import { createMasterEntityGroupMoveHandler } from "@/lib/createMasterEntityGroupMoveHandler";
import { createMasterEntityGroupTreeMoveHandler } from "@/lib/createMasterEntityGroupTreeMoveHandler";
import { PARTY_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { partyGroupTreeMove } from "@/lib/masterEntityGroupTreeMoveHelpers";
import { partyGroupAccountMove } from "@/lib/masterEntityGroupAccountMove";
import { consumeMasterDetailSidebarListNav } from "@/lib/masterDetailSidebarNav";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { collectPartyIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesPartyLedger";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import {
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import {
  matchesOverdueImportanceFilter,
  readOverdueImportanceFilter,
  writeOverdueImportanceFilter,
  type OverdueImportanceFilter,
} from "@/lib/overdueImportanceFilter";
import {
  dedupeInterCompanyClearingParties,
  isInterCompanyPartyListAccount,
} from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import { mergeDuplicateInterCompanyCounterpartyParties } from "@/lib/interCompany/mergeInterCompanyCounterpartyDuplicates";
import { repairLegacyInterCompanyCompanyClearingPartyNames } from "@/lib/interCompany/repairInterCompanyCompanyClearingPartyNames";
import {
  buildIcPeerCompanyGroupRows,
  IC_COMPANY_PARTY_GROUP_ID,
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
  isIcPeerCompanyGroupId,
  resolveIcMemberPartiesForGroupSelection,
} from "@/lib/interCompany/icPeerCompanyGroups";
import { partyListRowMatchesSearch } from "@/lib/interCompany/partyListRowSearch";
import {
  defaultPartyTabForCompany,
  filterAgentParties,
  filterSubscriberParties,
  isAdminPanelPartyPage,
  parsePartyListTab,
  partyTabViewQuery,
  type PartyListTab,
} from "@/lib/adminPanelCompany/partyList";
import { subscriberPartyListTitleLines } from "@/lib/adminPanelCompany/subscriberPartyListDisplay";
import { isPocketBaseAppSessionActive, readPocketBaseAppProfile, pocketBaseSessionUid } from "@/lib/pocketbaseData/pbAppSession";
import { isPackedMyCompanyOnly } from "@/lib/plServerPackedApp";
import {
  isMyCompanyAgentParty,
  myCompanyPartyListTitleLines,
  parsePackedMyCompanyPartyTab,
} from "@/lib/myCompanyPartyList";

/** Tab `replaceState` ke baad `useSearchParams` stale reh sakta hai — address bar (location) pehle. */

function readPartyPageUrlState(viewFromUrl: string | null, selectedIdFromUrl: string | null) {
  if (typeof window === "undefined") {
    return { view: viewFromUrl, selectedId: selectedIdFromUrl };
  }
  const loc = new URLSearchParams(window.location.search);
  // `view` bhi location-only — replaceState `/party` ke baad stale searchParams.view=groups se wapas Groups mat kholo
  const view = loc.has("view") ? loc.get("view") : null;
  // URL me `selected` param nahi → stale searchParams.selected ignore (Groups tab switch fix)
  const selectedId = loc.has("selected") ? loc.get("selected") : null;
  return { view, selectedId };
}

/** partyPageState.selections — tab click par turant row pick (useEffect wait nahi). */
function readPartyPageSelectionsFromStorage(): Record<string, string> {
  try {
    const raw = localStorage.getItem("partyPageState");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { selections?: Record<string, string> };
    return parsed?.selections ?? {};
  } catch {
    return {};
  }
}

/** Active tab ki list se memory / pehli real row — Overdue default skip. */
function pickPartyTabSelection(
  tab: PartyListTab,
  parties: Party[],
  groups: Group[],
  icParties: Party[],
  adminLists?: { subscribers: Party[]; agents: Party[] }
): Party | Group | null {
  const items =
    tab === "groups"
      ? groups
      : tab === "ic_ac"
        ? icParties
        : tab === "subscribers"
          ? adminLists?.subscribers ?? []
          : tab === "agents"
            ? adminLists?.agents ?? []
            : parties;
  if (items.length === 0) return null;
  const remembered = readPartyPageSelectionsFromStorage()[tab];
  if (remembered) {
    const found = items.find((i) => i.id === remembered);
    if (found) return found;
  }
  return items.find((i) => i.id !== OVERDUE_ACCOUNT_ID) ?? items[0] ?? null;
}

function partyTabCanonicalHref(tab: PartyListTab, item: { id: string } | null): string {
  const base = masterDetailListHref("party");
  const viewQ = partyTabViewQuery(tab);
  if (!item) {
    if (viewQ) return `${base}?view=${viewQ}`;
    return base;
  }
  if (tab === "groups") {
    return `${base}?view=groups&selected=${encodeURIComponent(item.id)}`;
  }
  if (tab === "ic_ac") {
    return `${base}?view=ic_ac&selected=${encodeURIComponent(item.id)}`;
  }
  if (viewQ) {
    return `${base}?view=${viewQ}&selected=${encodeURIComponent(item.id)}`;
  }
  if (item.id === OVERDUE_ACCOUNT_ID) {
    return `${base}?selected=${encodeURIComponent(OVERDUE_ACCOUNT_ID)}`;
  }
  return `${base}?selected=${encodeURIComponent(item.id)}`;
}

function PartyPageContent() {
  const { user } = useAuth();
  // Pehle company context: warna vouchersLoading false ho kar khali list flash, phir company aate hi dubara paint (Poora page jump).
  const { company, companyId, loading: companyLoading, effectiveNotificationSettings } = useCompany();
  const adminPartyMode = isAdminPanelPartyPage(companyId);
  const packedMyCompanyMode = isPackedMyCompanyOnly();
  const { formatCurrency, formatDate, formatDateBS, dateSystem } = useDate();
  const { vouchers, loading: vouchersLoading, processedParties, processedPartiesForSelection, processedGroups: initialProcessedGroups, overdueTransactions, hasOverdueTransactions, userNames: voucherUserNames, journalAccountNames } = useVouchers();
  const waitingForCompany = Boolean(companyId && (companyLoading || !company));
  const pageColdLoading = waitingForCompany || (vouchersLoading && processedParties.length === 0);
  const pageDataLoading = waitingForCompany || vouchersLoading;
  const { can } = usePermissions();
  const showApproveOnList =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false;
  const pendingApprovalByPartyId = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedParties?.length) return {} as Record<string, number>;
    // Journal/contra `partyId` ke bina bhi — ledger jaisa touch (`voucherTouchesPartyLedger`)
    const partyIdSet = new Set(processedParties.map((p: Party) => p.id));
    const map: Record<string, number> = {};
    vouchers.forEach((v: any) => {
      const touched = collectPartyIdsTouchedByUnapprovedVoucher(v, partyIdSet);
      touched.forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }, [vouchers, showApproveOnList, processedParties]);
  const pendingApprovalByGroupId = useMemo(() => {
    if (!showApproveOnList || !processedParties?.length) return {} as Record<string, number>;
    const byGroup: Record<string, number> = {};
    processedParties.forEach((p: Party) => {
      const n = pendingApprovalByPartyId[p.id] || 0;
      if (!n) return;
      const gid = isInterCompanyPartyListAccount(p)
        ? IC_COMPANY_PARTY_GROUP_ID
        : resolvePartyListGroupBucketId(p);
      byGroup[gid] = (byGroup[gid] || 0) + n;
    });
    return byGroup;
  }, [processedParties, showApproveOnList, pendingApprovalByPartyId]);

  /** Search aur + Add Party ke beech: kitne unapproved vouchers kisi party ledger ko touch karte hain (badge total) */
  const totalPendingApprovalVoucherCount = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedParties?.length) return 0;
    const partyIdSet = new Set(processedParties.map((p: Party) => p.id));
    let n = 0;
    for (const v of vouchers as any[]) {
      if (v?.isApproved === true) continue;
      if (collectPartyIdsTouchedByUnapprovedVoucher(v, partyIdSet).size > 0) n += 1;
    }
    return n;
  }, [vouchers, showApproveOnList, processedParties]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIdFromUrl = searchParams.get("selected");
  const viewFromUrl = searchParams.get("view");
  const isInitialMount = useRef(true);
  /** List click turant select — URL effect stale ?selected= se peeche wala row na khole */
  const pendingPartySelectIdRef = useRef<string | null>(null);
  /** Mobile back → list: partyPageState / URL restore se detail dubara na khule */
  const suppressPartyListRestoreRef = useRef(false);
  const { setBalanceMode } = useBalanceMode();

  const [activeView, setActiveView] = useState<PartyListTab>(() =>
    defaultPartyTabForCompany(null)
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = new URLSearchParams(window.location.search).get("view");
    setActiveView(
      packedMyCompanyMode
        ? parsePackedMyCompanyPartyTab(v ?? "")
        : parsePartyListTab(v ?? "", adminPartyMode)
    );
  }, [adminPartyMode, packedMyCompanyMode, companyId]);
  const { isMobile, selected, setSelected } = useResponsiveListLayout<Party | Group>(`party_view_${activeView}`);
  // APK/static: mobile list-detail + hardware back — sirf `isMobile` par mat band karo (PC mode tablet)
  const useQueryNav = useMasterDetailQueryNav();
  const mobileMasterDetail = useQueryNav;

  // List farkina: replace (push jasto double history hoina) + hardware back ma pani (Capacitor) yahi logic
  const onBackToList = useCallback(() => {
    pendingPartySelectIdRef.current = null;
    suppressPartyListRestoreRef.current = true;
    const base = masterDetailListHref("party");
    // Groups / ic_ac tab se detail se wapas — URL me view rakho
    const viewQ = partyTabViewQuery(activeView);
    const listHref = viewQ ? `${base}?view=${viewQ}` : base;
    // Pehle URL + memory clear — phir selected null (sync effect purani ?selected= se detail na khole)
    const href = applyMasterDetailBackToListUrl("party", { href: listHref });
    try {
      const raw = localStorage.getItem("partyPageState");
      if (raw) {
        const parsed = JSON.parse(raw) as { selections?: Record<string, string> };
        if (parsed.selections?.[activeView]) {
          delete parsed.selections[activeView];
          localStorage.setItem("partyPageState", JSON.stringify(parsed));
        }
      }
    } catch {
      /* ignore */
    }
    setSelected(null);
    router.replace(href, { scroll: false });
  }, [setSelected, router, activeView]);
  useRegisterMasterDetailHardwareBack("party", onBackToList);

  const [searchTerm, setSearchTerm] = useState("");
  const [partyListQuickFilter, setPartyListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  /** Party list: sirf un jinke paas pending approval (count box click toggle) */
  const {
    showOnlyEntities: showOnlyPartiesWithPendingApproval,
    setShowOnlyEntities: setShowOnlyPartiesWithPendingApproval,
    showOnlyGroups: showOnlyPartyGroupsWithPendingApproval,
    setShowOnlyGroups: setShowOnlyPartyGroupsWithPendingApproval,
  } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const mergedUserNames = useMemo(
    () => ({ ...voucherUserNames, ...userNames }),
    [voucherUserNames, userNames]
  );

  const [partyDetailsDateRange, setPartyDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupDetailsDateRange, setGroupDetailsDateRange] = useState<DateRange | undefined>(undefined);
  /** Groups tab normal group: null = all members; member id = single party ledger. */
  const [groupMemberFilterId, setGroupMemberFilterId] = useState<string | null>(null);
  /** IC company sidebar: null = all accounts; member id = single account ledger. */
  const [icGroupMemberFilterId, setIcGroupMemberFilterId] = useState<string | null>(null);
  /** Groups tab IC tree: peer company row id (__ic_co__*). */
  const [icGroupPeerCompanyFilterId, setIcGroupPeerCompanyFilterId] = useState<string | null>(null);
  const [overdueVoucherToEdit, setOverdueVoucherToEdit] = useState<any>(null);
  /** Overdue se voucher dialog khula — save/cancel ke baad overdue detail par wapas */
  const editingFromOverdueRef = useRef(false);
  const [historyVoucher, setHistoryVoucher] = useState<any>(null);
  const [linkAdvancesVoucher, setLinkAdvancesVoucher] = useState<any>(null);
  const [linkPaymentVoucher, setLinkPaymentVoucher] = useState<any>(null);
  const [overdueMobileSearchTerm, setOverdueMobileSearchTerm] = useState("");
  const [overdueFilters, setOverdueFilters] = useState<Record<string, string>>({});
  const [overdueActiveFilter, setOverdueActiveFilter] = useState<string | null>(null);
  const [overdueFooterDialog, setOverdueFooterDialog] = useState<null | "payment_in" | "payment_out" | "sale">(null);
  const [overdueImportanceFilter, setOverdueImportanceFilter] = useState<OverdueImportanceFilter>(() =>
    readOverdueImportanceFilter()
  );
  const handleOverdueImportanceFilterChange = useCallback((next: OverdueImportanceFilter) => {
    setOverdueImportanceFilter(next);
    writeOverdueImportanceFilter(next);
  }, []);
  const overdueTransactionsForView = useMemo(
    () => overdueTransactions.filter((t) => matchesOverdueImportanceFilter(t, overdueImportanceFilter)),
    [overdueTransactions, overdueImportanceFilter]
  );
  const [overdueShowNarration, setOverdueShowNarration] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return sessionStorage.getItem("showNarration") !== "false";
    } catch {
      return true;
    }
  });

  const selectedPartyRaw =
    activeView === "parties" ||
    activeView === "ic_ac" ||
    activeView === "subscribers" ||
    activeView === "agents"
      ? (selected as Party)
      : null;
  const selectedGroupRaw = activeView === "groups" ? (selected as Group | null) : null;
  const handlePartyUpdated = useCallback((patch?: Partial<Party>) => {
    if (!patch?.id || !selectedPartyRaw || selectedPartyRaw.id !== patch.id) return;
    setSelected({ ...selectedPartyRaw, ...patch });
  }, [setSelected, selectedPartyRaw]);
  const handleGroupUpdated = useCallback((patch?: Partial<Group>) => {
    if (!patch?.id || !selectedGroupRaw || selectedGroupRaw.id !== patch.id) return;
    setSelected({ ...selectedGroupRaw, ...patch });
  }, [setSelected, selectedGroupRaw]);
  const mobilePartyGroupSelectionLabelClassName = useMemo(() => {
    if (!selected) return undefined;
    return masterDetailBalanceToneClass((selected as Party | Group).balance);
  }, [selected]);
  const partyMasterDetailTitle =
    activeView === "groups"
      ? "Party Groups"
      : activeView === "ic_ac"
        ? "IC / Ac"
        : activeView === "agents"
          ? "Agents"
          : "Parties";
  // Header Report: sessionStorage sync — URL ?selected= flicker / router.replace race se button stable rahe
  const overdueVirtualParty = useMemo((): Party | null => {
    if (!hasOverdueTransactions || overdueTransactions.length === 0) return null;
    const totalDebit = overdueTransactions.reduce((s, t) => s + t.debit, 0);
    const totalCredit = overdueTransactions.reduce((s, t) => s + t.credit, 0);
    return {
      id: OVERDUE_ACCOUNT_ID,
      name: "Overdue Vouchers",
      openingBalance: 0,
      debit: totalDebit,
      credit: totalCredit,
      balance: totalDebit - totalCredit,
      companyId: companyId || "",
    };
  }, [hasOverdueTransactions, overdueTransactions, companyId]);

  // Overdue mobile: map overdue rows to transaction-like for TransactionsTable (same UI as Party Details)
  const overdueAsTransactions = useMemo(() => {
    return overdueTransactionsForView.map((row) => {
      const v = vouchers.find((v) => v.id === row.id);
      const out = Number(row.outstanding) ?? 0;
      const signedOut =
        row.type === "purchase" || row.type === "payment_out" || row.type === "direct_expense" ? -out : out;
      return {
        id: row.id,
        type: row.type,
        date: row.date,
        voucherNumber: row.voucherNumber,
        partyId: row.partyId,
        debit: row.debit,
        credit: row.credit,
        total: row.total,
        outstanding: out,
        runningBalance: signedOut,
        balance: signedOut,
        paymentStatus: row.paymentStatus,
        isOverdue: row.isOverdue,
        userId: row.userId,
        userName: row.userName,
        narration: row.narration,
        createdAt: (row as any).createdAt ?? (v as any)?.createdAt,
        lastEditedAt: (row as any).lastEditedAt ?? (v as any)?.lastEditedAt,
        updatedAt: (row as any).updatedAt ?? (v as any)?.updatedAt,
        dueDate: row.dueDate,
        isApproved: v?.isApproved,
        partyName: row.partyName,
        linkedFromVoucherNos: row.linkedFromVoucherNos,
        linkedToVoucherNos: row.linkedToVoucherNos,
        linkedFromVoucherNosBillWise: row.linkedFromVoucherNosBillWise,
        linkedToVoucherNosBillWise: row.linkedToVoucherNosBillWise,
      };
    });
  }, [overdueTransactionsForView, vouchers]);

  const overduePartyNames = useMemo(() => {
    const m: Record<string, string> = {};
    overdueTransactions.forEach((r) => {
      if (r.partyId) m[r.partyId] = r.partyName || m[r.partyId] || "";
    });
    return m;
  }, [overdueTransactions]);

  const overdueMobileSearchNames = useMemo(
    () => ({ ...journalAccountNames, ...mergedUserNames, ...overduePartyNames }),
    [journalAccountNames, mergedUserNames, overduePartyNames]
  );

  const mobileFilteredOverdue = useMemo(() => {
    if (!overdueMobileSearchTerm.trim()) return overdueAsTransactions;
    const q = overdueMobileSearchTerm.toLowerCase().trim();
    return overdueAsTransactions.filter((t: any) => {
      const amt = t.debit > 0 ? t.debit : t.credit;
      return (
        getTransactionQuickSearchHaystack(t, overdueMobileSearchNames, t.partyId ? "party" : undefined, t.partyId).includes(q) ||
        String(amt || 0).toLowerCase().includes(q)
      );
    });
  }, [overdueAsTransactions, overdueMobileSearchTerm, overdueMobileSearchNames]);

  const overduePeriodDr = useMemo(
    () => mobileFilteredOverdue.reduce((s, t) => s + (t.debit ?? 0), 0),
    [mobileFilteredOverdue]
  );
  const overduePeriodCr = useMemo(
    () => mobileFilteredOverdue.reduce((s, t) => s + (t.credit ?? 0), 0),
    [mobileFilteredOverdue]
  );
  const overdueClosingBalance = useMemo(() => {
    const totalOut = mobileFilteredOverdue.reduce((s, t) => s + (Number(t.outstanding) ?? 0), 0);
    return -totalOut;
  }, [mobileFilteredOverdue]);

  const partiesForList = processedPartiesForSelection;
  const icParties = useMemo(
    () =>
      packedMyCompanyMode
        ? []
        : dedupeInterCompanyClearingParties(
            partiesForList.filter((p) => isInterCompanyPartyListAccount(p))
          ),
    [packedMyCompanyMode, partiesForList]
  );
  /** usePageMemory + URL sync — list jaisa (IC company merged rows included). */
  const partiesForPartyListView = useMemo(() => {
    const base =
      showOnlyPartiesWithPendingApproval && showApproveOnList
        ? partiesForList.filter((p) => (pendingApprovalByPartyId[p.id] ?? 0) > 0)
        : partiesForList;
    if (packedMyCompanyMode) {
      return base.filter((p) => !isInterCompanyPartyListAccount(p));
    }
    const regular = base.filter((p) => !isInterCompanyPartyListAccount(p));
    const icFlat = dedupeInterCompanyClearingParties(
      base.filter((p) => isInterCompanyPartyListAccount(p))
    );
    return [...regular, ...icFlat];
  }, [
    partiesForList,
    packedMyCompanyMode,
    showOnlyPartiesWithPendingApproval,
    showApproveOnList,
    pendingApprovalByPartyId,
  ]);
  const packedPartiesForView = useMemo(
    () =>
      packedMyCompanyMode
        ? partiesForPartyListView.filter((p) => !isMyCompanyAgentParty(p))
        : partiesForPartyListView,
    [packedMyCompanyMode, partiesForPartyListView]
  );
  const subscriberPartiesForView = useMemo(
    () => filterSubscriberParties(partiesForPartyListView.filter((p) => !isInterCompanyPartyListAccount(p))),
    [partiesForPartyListView]
  );
  const agentPartiesForView = useMemo(() => {
    const base = partiesForPartyListView.filter((p) => !isInterCompanyPartyListAccount(p));
    if (packedMyCompanyMode) return base.filter(isMyCompanyAgentParty);
    return filterAgentParties(base);
  }, [packedMyCompanyMode, partiesForPartyListView]);
  const adminPartyLists = useMemo(
    () => ({ subscribers: subscriberPartiesForView, agents: agentPartiesForView }),
    [subscriberPartiesForView, agentPartiesForView]
  );
  const partiesForPageMemory = useMemo(() => {
    if (!overdueVirtualParty) return partiesForPartyListView;
    return [overdueVirtualParty, ...partiesForPartyListView];
  }, [partiesForPartyListView, overdueVirtualParty]);
  const icPartiesForListView = useMemo(() => {
    if (!showOnlyPartiesWithPendingApproval || !showApproveOnList) return icParties;
    return icParties.filter((p) => (pendingApprovalByPartyId[p.id] ?? 0) > 0);
  }, [icParties, showOnlyPartiesWithPendingApproval, showApproveOnList, pendingApprovalByPartyId]);

  const icListRowsForView = useMemo(
    () => buildIcPeerCompanyGroupRows(icPartiesForListView),
    [icPartiesForListView]
  );

  const selectedParty = useMemo(() => {
    if (!selectedPartyRaw) return null;
    const listRows =
      activeView === "ic_ac"
        ? icListRowsForView
        : activeView === "subscribers"
          ? subscriberPartiesForView
          : activeView === "agents"
            ? agentPartiesForView
            : activeView === "parties"
              ? packedMyCompanyMode
                ? packedPartiesForView
                : partiesForPartyListView
              : processedPartiesForSelection;
    return resolveMasterListSelection(selectedPartyRaw, listRows);
  }, [
    selectedPartyRaw,
    activeView,
    icListRowsForView,
    subscriberPartiesForView,
    agentPartiesForView,
    packedMyCompanyMode,
    packedPartiesForView,
    partiesForPartyListView,
    processedPartiesForSelection,
  ]);

  /** Mobile party ledger: master row me "Parties" ki jagah context clear ("Party details" + naam). */
  const responsiveMasterDetailTitle = useMemo(
    () =>
      mobileEntityDetailShellTitle(
        isMobile,
        Boolean(selectedParty && selectedParty.id !== OVERDUE_ACCOUNT_ID),
        partyMasterDetailTitle,
        "Party details"
      ),
    [isMobile, selectedParty, partyMasterDetailTitle]
  );
  const partyMobileHeaderSecondary = useMemo((): ReactNode | undefined => {
    if (!isMobile) return undefined;
    if (activeView === "groups" && selectedGroupRaw) {
      return (
        <MobileMasterDetailHeaderDateSecondary
          dateRange={groupDetailsDateRange}
          onClear={() => setGroupDetailsDateRange(undefined)}
        />
      );
    }
    const partyDetailViews = ["parties", "ic_ac", "subscribers", "agents"] as const;
    if (!selectedParty || selectedParty.id === OVERDUE_ACCOUNT_ID) return undefined;
    if (!partyDetailViews.includes(activeView as (typeof partyDetailViews)[number])) return undefined;
    return (
      <MobileMasterDetailHeaderDateSecondary
        dateRange={partyDetailsDateRange}
        onClear={() => setPartyDetailsDateRange(undefined)}
      />
    );
  }, [isMobile, selectedParty, selectedGroupRaw, activeView, partyDetailsDateRange, groupDetailsDateRange]);

   const processedGroups = useMemo(() => {
    // Filter out report-only groups (isReportOnly: true) and system parent groups
    const userDefinedGroups = initialProcessedGroups.filter(g => {
        const anyG = g as any;
        const isReportOnly = anyG.isReportOnly === true;
        // Hide auto-created Ungrouped base doc; UI row is injected only when actually needed.
        const isAutoUngrouped = anyG.isAutoUngrouped === true;
        const isSystemParent =
          anyG.isSystemReserved === true ||
          isSystemParentGroup("groups", anyG.id);
        return !isReportOnly && !isSystemParent && !isAutoUngrouped;
    });

    const syntheticGroups: Group[] = [];

    // usePageMemory + URL ?selected= must resolve system branches (not in Firestore rows).
    for (const branch of PARTY_SYSTEM_GROUP_OPTIONS) {
      syntheticGroups.push(
        buildPartySystemBranchSelectionGroup(branch.id, companyId || "", 0) as Group
      );
    }

    if (icParties.length > 0) {
      syntheticGroups.push({
        id: IC_COMPANY_PARTY_GROUP_ID,
        name: "IC Company",
        balance: icParties.reduce((sum, p) => sum + p.balance, 0),
        companyId: companyId || "",
        debit: icParties.reduce((sum, p) => sum + p.debit, 0),
        credit: icParties.reduce((sum, p) => sum + p.credit, 0),
        parentId: PARTY_SYSTEM_DEBTORS_ID,
      });
    }

    return [...userDefinedGroups, ...syntheticGroups];
  }, [initialProcessedGroups, companyId, icParties]);

  const groupsForPartyGroupListView = useMemo(() => {
    if (!showOnlyPartyGroupsWithPendingApproval || !showApproveOnList) return processedGroups;
    return processedGroups.filter((g) => (pendingApprovalByGroupId[g.id] ?? 0) > 0);
  }, [processedGroups, showOnlyPartyGroupsWithPendingApproval, showApproveOnList, pendingApprovalByGroupId]);

  const selectedGroup = useMemo(
    () =>
      selectedGroupRaw
        ? (resolvePartyGroupForSelection(selectedGroupRaw.id, processedGroups, companyId || "") as Group | null)
        : null,
    [processedGroups, selectedGroupRaw, companyId]
  );

  // List already live-patches processed rows; write that back into `selected` so the open
  // details header / group page stay on the new name without leaving the page.
  useEffect(() => {
    if (!selected?.id) return;
    const live =
      activeView === "groups"
        ? processedGroups.find((row) => row.id === selected.id)
        : processedParties.find((row) => row.id === selected.id);
    if (!live) return;
    const prev = masterEntityProfileUiFields(selected as unknown as Record<string, unknown>);
    const next = masterEntityProfileUiFields(live as unknown as Record<string, unknown>);
    if (prev === next) return;
    setSelected({ ...selected, ...live });
  }, [selected, activeView, processedParties, processedGroups, setSelected]);

  const mobileDetailHeaderAvatar = useMemo(() => {
    if (!isMobile || !selected) return null;

    if (activeView === "groups" && selectedGroup) {
      const group = selectedGroup;
      const isAutoSyntheticPartyGroup =
        group.id === IC_COMPANY_PARTY_GROUP_ID || isPartySystemGroupId(group.id);
      const name = group.name || "Group";
      const attachmentUrl = trimEntityFileUrlForPreview((group as any).fileUrl);
      const hasAccounts =
        processedParties.some((p) => p.groupId === group.id) ||
        processedGroups.some((g) => g.parentId === group.id);
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            !isAutoSyntheticPartyGroup ? (
              <EditGroupDialog
                group={group}
                allGroups={processedGroups}
                onGroupUpdated={handleGroupUpdated}
                onGroupDeleted={() => setSelected(null)}
                hasAccounts={hasAccounts}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit group">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditGroupDialog>
            ) : undefined
          }
        />
      );
    }

    if (!selectedParty || selectedParty.id === OVERDUE_ACCOUNT_ID) return null;
    const attachmentUrl = trimEntityFileUrlForPreview((selectedParty as any).fileUrl);
    const canEdit =
      selectedParty.id !== "all" && !(selectedParty as any).isSystemAccount;
    const hasTransactions =
      (selectedParty.debit ?? 0) !== 0 || (selectedParty.credit ?? 0) !== 0;
    return (
      <MobileMasterDetailHeaderAvatar
        name={selectedParty.name || "Party"}
        attachmentUrl={attachmentUrl}
        editTrigger={
          canEdit ? (
            <EditPartyDialog
              party={selectedParty}
              onPartyUpdated={handlePartyUpdated}
              onPartyDeleted={() => setSelected(null)}
              hasTransactions={hasTransactions}
            >
              <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit party">
                <Pencil className="h-2.5 w-2.5" aria-hidden />
              </button>
            </EditPartyDialog>
          ) : undefined
        }
      />
    );
  }, [
    isMobile,
    selected,
    activeView,
    selectedGroup,
    selectedParty,
    processedParties,
    processedGroups,
    handlePartyUpdated,
    handleGroupUpdated,
    setSelected,
  ]);

  // Header Report: sessionStorage sync — URL ?selected= flicker / router.replace race se button stable rahe
  useSyncMasterDetailHeaderId("party", selectedParty?.id ?? selectedGroup?.id ?? null);

  const partyUrlState = readPartyPageUrlState(viewFromUrl, selectedIdFromUrl);

  // URL sync effect ko har voucher snapshot par re-run na karo — refs se latest lists
  const processedPartiesRef = useRef(processedParties);
  const processedGroupsRef = useRef(processedGroups);
  const partiesForPartyListViewRef = useRef(partiesForPartyListView);
  const icListRowsForViewRef = useRef(icListRowsForView);
  const selectedRef = useRef(selected);
  const activeViewRef = useRef(activeView);
  processedPartiesRef.current = processedParties;
  processedGroupsRef.current = processedGroups;
  partiesForPartyListViewRef.current = partiesForPartyListView;
  icListRowsForViewRef.current = icListRowsForView;
  selectedRef.current = selected;
  activeViewRef.current = activeView;
  const overdueVirtualPartyRef = useRef(overdueVirtualParty);
  overdueVirtualPartyRef.current = overdueVirtualParty;

  // ========== MEMORY LOGIC ==========
  usePageMemory(
    "partyPageState",
    activeView,
    (view) => {
      if (
        view === "groups" ||
        view === "ic_ac" ||
        view === "parties" ||
        view === "agents" ||
        view === "subscribers"
      ) {
        setActiveView(view);
      }
    },
    selected,
    setSelected,
    activeView === "groups"
      ? processedGroups
      : activeView === "ic_ac"
        ? icListRowsForView
        : activeView === "agents"
          ? agentPartiesForView
          : activeView === "subscribers"
            ? subscriberPartiesForView
            : packedMyCompanyMode
              ? packedPartiesForView
              : partiesForPageMemory,
    pageDataLoading,
    isMobile, // static PC: auto-select chalu — `useQueryNav` sirf URL/mobile list-first ke liye
    partyUrlState.selectedId,
    undefined,
    [OVERDUE_ACCOUNT_ID]
  );
  // ==================================

  /** Sidebar Parties click — saved detail / memory skip, sirf list kholo */
  useEffect(() => {
    if (pageDataLoading) return;
    if (!consumeMasterDetailSidebarListNav("party")) return;
    suppressPartyListRestoreRef.current = true;
    pendingPartySelectIdRef.current = null;
    const href =
      activeView === "groups"
        ? `${masterDetailListHref("party")}?view=groups`
        : activeView === "ic_ac"
          ? `${masterDetailListHref("party")}?view=ic_ac`
          : activeView === "agents"
            ? `${masterDetailListHref("party")}?view=agents`
            : masterDetailListHref("party");
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", browserHistoryHref(href));
        const raw = localStorage.getItem("partyPageState");
        if (raw) {
          const parsed = JSON.parse(raw) as { selections?: Record<string, string> };
          if (parsed.selections) {
            delete parsed.selections.parties;
            delete parsed.selections.groups;
            delete parsed.selections.ic_ac;
            localStorage.setItem("partyPageState", JSON.stringify(parsed));
          }
        }
      } catch {
        /* ignore */
      }
    }
    setSelected(null);
  }, [pageDataLoading, selectedIdFromUrl, viewFromUrl, activeView, setSelected]);

  // URL ↔ tab/selection sync (location-first — stale ?selected= se Groups tab wapas Parties mat kheecho)
  useEffect(() => {
    if (pageDataLoading) return;
    const { view, selectedId } = readPartyPageUrlState(viewFromUrl, selectedIdFromUrl);
    const currentSelectedId = selectedRef.current?.id ?? null;
    const currentActiveView = activeViewRef.current;

    // User ne abhi click kiya — router.replace / useSearchParams peeche ho to purana id mat lagao
    const pendingId = pendingPartySelectIdRef.current;
    if (pendingId) {
      if (selectedId === pendingId) {
        pendingPartySelectIdRef.current = null;
      } else if (currentSelectedId === pendingId) {
        return;
      }
    }

    if (!selectedId) {
      if (view === "groups") {
        // Sirf tab align — selection tab handler / usePageMemory; null se list flash mat karo
        if (currentActiveView !== "groups") {
          setActiveView("groups");
        }
      } else if (view === "ic_ac") {
        if (currentActiveView !== "ic_ac") {
          setActiveView("ic_ac");
        }
      } else if (view === "agents") {
        if (currentActiveView !== "agents") {
          setActiveView("agents");
        }
      } else if (view === "subscribers") {
        if (currentActiveView !== "subscribers") {
          setActiveView("subscribers");
        }
      } else if (currentActiveView !== "parties") {
        setActiveView("parties");
      }
      return;
    }

    if (selectedId === OVERDUE_ACCOUNT_ID) {
      const overdueParty = overdueVirtualPartyRef.current;
      if (!overdueParty) return;
      if (currentActiveView !== "parties") setActiveView("parties");
      if (currentSelectedId !== OVERDUE_ACCOUNT_ID) setSelected(overdueParty);
      const overdueUrl = `/party?selected=${encodeURIComponent(OVERDUE_ACCOUNT_ID)}`;
      if (shouldReplaceWithMasterDetailCanonical(overdueUrl)) {
        router.replace(overdueUrl, { scroll: false });
      }
      return;
    }
    const groupItem = resolvePartyGroupForSelection(
      selectedId,
      processedGroupsRef.current,
      companyId || ""
    );
    const icGroupItem =
      partiesForPartyListViewRef.current.find((i) => i.id === selectedId) ??
      icListRowsForViewRef.current.find((i) => i.id === selectedId);
    const partyItem =
      processedPartiesRef.current.find((i) => i.id === selectedId) ?? icGroupItem;
    let targetView = currentActiveView;
    if (groupItem && partyItem) {
      targetView =
        view === "groups"
          ? "groups"
          : view === "ic_ac"
            ? "ic_ac"
            : view === "agents"
              ? "agents"
              : view === "subscribers"
                ? "subscribers"
                : "parties";
    } else if (view === "groups" && groupItem) targetView = "groups";
    else if (view === "ic_ac" && partyItem) targetView = "ic_ac";
    else if (view === "agents" && partyItem) targetView = "agents";
    else if (view === "subscribers" && partyItem) targetView = "subscribers";
    else if (view === "parties" && partyItem) targetView = "parties";
    // No entity-type inference — stale ?selected= without view must not snap tabs on PL refresh.
    if (targetView !== currentActiveView) setActiveView(targetView);
    const item =
      groupItem && partyItem
        ? view === "groups"
          ? groupItem
          : partyItem
        : groupItem || partyItem;
    if (item && item.id !== currentSelectedId) setSelected(item as Party | Group);
    const canonical =
      view === "groups"
        ? `/party?view=groups&selected=${encodeURIComponent(selectedId)}`
        : view === "ic_ac"
          ? `/party?view=ic_ac&selected=${encodeURIComponent(selectedId)}`
          : view === "agents"
            ? `/party?view=agents&selected=${encodeURIComponent(selectedId)}`
            : view === "subscribers"
              ? `/party?view=subscribers&selected=${encodeURIComponent(selectedId)}`
              : `/party?selected=${encodeURIComponent(selectedId)}`;
    const canonicalWithModal = appendPreservedModalQueryToHref(canonical);
    if (shouldReplaceWithMasterDetailCanonical(canonicalWithModal)) {
      router.replace(canonicalWithModal, { scroll: false });
    }
  }, [
    viewFromUrl,
    selectedIdFromUrl,
    pageDataLoading,
    companyId,
    setSelected,
    setActiveView,
    router,
  ]);

  /** Refresh / bare `/party`: URL na ho to partyPageState ya selectedItemId se party restore — Overdue default na kholo */
  useEffect(() => {
    if (pageDataLoading) return;
    // Mobile list-first: back ke baad memory se detail mat kholo (static PC refresh restore chalu)
    if (isMobile) return;
    if (suppressPartyListRestoreRef.current) return;
    const { view, selectedId } = readPartyPageUrlState(viewFromUrl, selectedIdFromUrl);
    if (selectedId) return;
    if (view === "groups" || view === "ic_ac" || view === "agents" || view === "subscribers") return;
    if (activeView !== "parties") return;
    if (selected?.id && selected.id !== OVERDUE_ACCOUNT_ID) return;

    let rememberedId: string | null = null;
    try {
      const raw = localStorage.getItem("partyPageState");
      if (raw) {
        const parsed = JSON.parse(raw) as { selections?: Record<string, string> };
        rememberedId = parsed?.selections?.parties ?? null;
      }
    } catch {
      /* ignore */
    }
    if (!rememberedId && typeof window !== "undefined") {
      rememberedId = localStorage.getItem(`selectedItemId_party_view_parties`);
    }
    if (!rememberedId || rememberedId === OVERDUE_ACCOUNT_ID) return;

    const party = processedParties.find((p) => p.id === rememberedId);
    if (!party || party.id === selected?.id) return;

    setSelected(party);
    const canonical = `/party?selected=${encodeURIComponent(rememberedId)}`;
    if (shouldReplaceWithMasterDetailCanonical(canonical)) {
      router.replace(canonical, { scroll: false });
    }
  }, [
    pageDataLoading,
    selectedIdFromUrl,
    viewFromUrl,
    activeView,
    processedParties,
    selected?.id,
    setSelected,
    router,
    isMobile,
    mobileMasterDetail,
  ]);

  /** Parties / IC tab + selected id kisi group row se match ho (same id edge) to selection clear. */
  useEffect(() => {
    if (pageDataLoading) return;
    if (
      activeView !== "parties" &&
      activeView !== "ic_ac" &&
      activeView !== "subscribers" &&
      activeView !== "agents"
    ) {
      return;
    }
    const sid = selected?.id;
    if (!sid) return;
    if (!processedGroups.some((g) => g.id === sid)) return;
    setSelected(null);
  }, [pageDataLoading, activeView, selected?.id, processedGroups, setSelected]);

  /** Tab switch — turant list row select (null + useEffect = 1–7s random delay fix). */
  const handlePartyGroupsTabChange = useCallback(
    (value: string) => {
      const tab = packedMyCompanyMode
        ? parsePackedMyCompanyPartyTab(value)
        : parsePartyListTab(value, adminPartyMode);
      const nextSelected = tabSwitchSelection(
        isMobile,
        pickPartyTabSelection(
          tab,
          packedMyCompanyMode ? packedPartiesForView : partiesForPageMemory,
          processedGroups,
          packedMyCompanyMode ? [] : icListRowsForView,
          adminPartyLists
        )
      );
      suppressPartyListRestoreRef.current = false;
      pendingPartySelectIdRef.current = nextSelected?.id ?? null;
      setActiveView(tab);
      setSelected(nextSelected);
      const href = isMobile
        ? masterDetailTabHref("party", {
            tab,
            defaultTab: defaultPartyTabForCompany(companyId),
            listOnly: true,
          })
        : partyTabCanonicalHref(tab, nextSelected);
      replaceMasterDetailTabUrl(href, router, useQueryNav);
      try {
        const raw = localStorage.getItem("partyPageState");
        const parsed = raw ? JSON.parse(raw) : { selections: {} };
        parsed.activeView = tab;
        if (nextSelected?.id) {
          parsed.selections = { ...(parsed.selections ?? {}), [tab]: nextSelected.id };
        }
        localStorage.setItem("partyPageState", JSON.stringify(parsed));
      } catch {
        /* ignore */
      }
    },
    [
      adminPartyMode,
      packedMyCompanyMode,
      packedPartiesForView,
      adminPartyLists,
      partiesForPageMemory,
      processedGroups,
      icListRowsForView,
      setActiveView,
      setSelected,
      useQueryNav,
      router,
      isMobile,
    ]
  );

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId] && userNames[userId] !== "Unknown" && userNames[userId] !== "N/A") {
      return userNames[userId];
    }
    // Pocket Ledger Server session: no Firebase user, so Firestore would only fail ("client is offline").
    if (isPocketBaseAppSessionActive()) {
      const p = readPocketBaseAppProfile();
      if (p && (userId === pocketBaseSessionUid(p) || userId === p.id)) {
        const nm = p.name || p.email;
        if (nm) return nm;
      }
    } else try {
        // Primary lookup by uid because user doc IDs may be name_uid format.
        const q = query(collection(firestore, "users"), where("uid", "==", userId));
        const snap = await getDocs(q);
        let data = snap.docs[0]?.data();

        if (!data) {
            // Fallback 1: user document id is uid (legacy).
            const userDoc = await getDoc(doc(firestore, "users", userId));
            if (userDoc.exists()) {
                data = userDoc.data();
            }
        }

        if (data) {
            const displayName = data.displayName || data.name || data.email || null;
            if (displayName && displayName !== userId && displayName !== "Unknown" && displayName !== "N/A") {
                const isUIDPattern =
                  displayName.length > 15 &&
                  /^[a-zA-Z0-9_-]+$/.test(displayName) &&
                  !displayName.includes("@") &&
                  !displayName.includes(" ");
                if (!isUIDPattern) return displayName;
            }
        }
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === "unavailable") {
        console.debug("[PartyPage] userName lookup skipped (offline) for", userId);
      } else {
        console.error("[PartyPage] Error fetching userName for", userId, e);
      }
    }
    return "N/A";
  }, [userNames]);

  useEffect(() => {
    const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
    uids.forEach(async (uid) => {
        if (!userNames[uid as any]) {
            const name = await fetchUserName(uid as any);
            setUserNames((prev) => ({ ...prev, [uid as any]: name }));
        }
    });
  }, [vouchers, userNames, fetchUserName]);

  // Company switch: search + detail selection reset — purani company ki party list/detail na dikhe.
  useEffect(() => {
    setSearchTerm("");
    setSelected(null);
    pendingPartySelectIdRef.current = null;
    suppressPartyListRestoreRef.current = true;
  }, [companyId, setSelected]);
  useEffect(() => {
    setShowOnlyPartiesWithPendingApproval(false);
    setShowOnlyPartyGroupsWithPendingApproval(false);
  }, [companyId]);
  useEffect(() => {
    if (activeView !== "parties") setShowOnlyPartiesWithPendingApproval(false);
    if (activeView !== "groups") setShowOnlyPartyGroupsWithPendingApproval(false);
  }, [activeView]);

  /** Same-name / same-peer IC Company clearing duplicates → voucher remap + purge losers. */
  useEffect(() => {
    const cid = String(companyId || "").trim();
    if (!cid || pageDataLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const repaired = await repairLegacyInterCompanyCompanyClearingPartyNames(cid);
        if (!cancelled && repaired > 0) {
          toast.success(
            repaired === 1
              ? "Updated 1 IC account name from linked vouchers"
              : `Updated ${repaired} IC account names from linked vouchers`
          );
        }
        const removed = await mergeDuplicateInterCompanyCounterpartyParties(cid);
        if (!cancelled && removed > 0) {
          toast.success(
            removed === 1
              ? "Merged duplicate IC account"
              : `Merged ${removed} duplicate IC accounts`
          );
        }
      } catch (err) {
        console.warn("[IC] merge duplicate counterparty parties:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, pageDataLoading]);

  // Mobile overdue: bill-wise while overdue row open — cleanup me persist mat karo (statement preference overwrite hota tha).
  useEffect(() => {
    if (isMobile && selectedParty?.id === OVERDUE_ACCOUNT_ID) {
      setBalanceMode("bill_wise");
    }
  }, [isMobile, selectedParty?.id, setBalanceMode]);

  // Initial mount check
  useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
    }
  }, []);
  
  const totalBalance = useMemo(() => {
    if (activeView === "parties") {
      return (partiesForPartyListView || [])
        .filter((p) => !(p as any).isSystemAccount && p.id !== OVERDUE_ACCOUNT_ID)
        .reduce((acc, party) => acc + party.balance, 0);
    }
    if (activeView === "ic_ac") {
      return (icListRowsForView || []).reduce((acc, party) => acc + party.balance, 0);
    }
    // Groups view: sum only user-defined + synthetic groups (processedGroups already excludes system parents)
    return processedGroups.reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, partiesForPartyListView, processedGroups, icListRowsForView]);

  const restoreOverdueDetailAfterVoucherDialog = useCallback(() => {
    if (!editingFromOverdueRef.current || !overdueVirtualParty) return;
    editingFromOverdueRef.current = false;
    setActiveView("parties");
    setSelected(overdueVirtualParty);
    const overdueUrl = `/party?selected=${encodeURIComponent(OVERDUE_ACCOUNT_ID)}`;
    if (useQueryNav && shouldReplaceWithMasterDetailCanonical(overdueUrl)) {
      router.replace(overdueUrl, { scroll: false });
    }
  }, [overdueVirtualParty, setSelected, setActiveView, useQueryNav, router]);

  const handleSelect = useCallback((item: Party | Group, options?: { memberId?: string | null }) => {
    suppressPartyListRestoreRef.current = false;
    pendingPartySelectIdRef.current = item.id;
    setSelected(item);
    const isGroup = !("pan" in item);
    if (isGroup) {
      setGroupMemberFilterId(options?.memberId ?? null);
      setIcGroupMemberFilterId(null);
      setIcGroupPeerCompanyFilterId(null);
    } else if (!isIcPeerCompanyGroupId(item.id)) {
      setGroupMemberFilterId(null);
      setIcGroupMemberFilterId(null);
      setIcGroupPeerCompanyFilterId(null);
    }
    // Har viewport: ?selected= URL sync — refresh / wapas aane par wahi party/group khule
    const path =
      item.id === OVERDUE_ACCOUNT_ID
        ? `/party?selected=${encodeURIComponent(OVERDUE_ACCOUNT_ID)}`
        : isGroup
          ? `/party?view=groups&selected=${encodeURIComponent(item.id)}`
          : activeView === "ic_ac"
            ? `/party?view=ic_ac&selected=${encodeURIComponent(item.id)}`
            : `/party?selected=${encodeURIComponent(item.id)}`;
    const syncRouter = useQueryNav && shouldReplaceWithMasterDetailCanonical(path);
    // replaceState pehle — URL effect ko turant sahi id mile (1-click-late bug fix)
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", browserHistoryHref(path));
      } catch {
        /* ignore */
      }
    }
    if (syncRouter) {
      router.replace(path, { scroll: false });
    }
  }, [router, setSelected, useQueryNav, activeView]);

  const icPeerCompanyRowsForGroupTab = useMemo(
    () => buildIcPeerCompanyGroupRows(icParties),
    [icParties]
  );

  const partyGroupMembersByGroupId = useMemo(() => {
    const map: Record<string, Party[]> = {};
    const push = (key: string, party: Party) => {
      if (!map[key]) map[key] = [];
      map[key]!.push(party);
    };

    for (const p of processedPartiesForSelection) {
      if (isInterCompanyPartyListAccount(p)) continue;
      const gid = String(p.groupId ?? "").trim();
      if (isPartySystemGroupId(gid) || !gid || gid === "ungrouped_party" || gid === "ungrouped") {
        push(resolvePartyListGroupBucketId(p), p);
        continue;
      }
      push(gid, p);
    }
    return map;
  }, [processedPartiesForSelection]);

  const handleMovePartyToGroup = useCallback(
    (party: Party, targetGroupId: string) =>
      createMasterEntityGroupMoveHandler({
        companyId,
        company,
        groupsForName: processedGroups,
        moveHelpers: partyGroupAccountMove,
        entityLabel: "Party",
      })(party, targetGroupId),
    [companyId, company, processedGroups]
  );

  const handleMovePartyGroupToGroup = useCallback(
    (sourceGroupId: string, targetGroupId: string) =>
      createMasterEntityGroupTreeMoveHandler({
        companyId,
        company,
        groupsForName: processedGroups,
        allGroups: initialProcessedGroups,
        config: PARTY_GROUP_LIST_CONFIG,
        moveHelpers: partyGroupTreeMove,
      })(sourceGroupId, targetGroupId),
    [companyId, company, processedGroups, initialProcessedGroups]
  );

  const handleSelectIcCompanyGroup = useCallback(
    (options?: { peerCompanyId?: string | null; memberAccountId?: string | null }) => {
      const icGroup = processedGroups.find((g) => g.id === IC_COMPANY_PARTY_GROUP_ID);
      if (!icGroup) return;
      suppressPartyListRestoreRef.current = false;
      pendingPartySelectIdRef.current = icGroup.id;
      setSelected(icGroup);
      setGroupMemberFilterId(null);
      setIcGroupPeerCompanyFilterId(options?.peerCompanyId ?? null);
      setIcGroupMemberFilterId(options?.memberAccountId ?? null);
      const path = `/party?view=groups&selected=${encodeURIComponent(icGroup.id)}`;
      const syncRouter = useQueryNav && shouldReplaceWithMasterDetailCanonical(path);
      if (typeof window !== "undefined") {
        try {
          window.history.replaceState(window.history.state, "", browserHistoryHref(path));
        } catch {
          /* ignore */
        }
      }
      if (syncRouter) {
        router.replace(path, { scroll: false });
      }
    },
    [processedGroups, router, setSelected, useQueryNav]
  );

  const handleSelectParty = useCallback(
    (party: Party, options?: { icMemberAccountId?: string | null }) => {
      suppressPartyListRestoreRef.current = false;
      pendingPartySelectIdRef.current = party.id;
      setSelected(party);
      if (
        (party as Party & { isIcPeerCompanyGroup?: boolean }).isIcPeerCompanyGroup ||
        isIcPeerCompanyGroupId(party.id)
      ) {
        setIcGroupMemberFilterId(options?.icMemberAccountId ?? null);
        setIcGroupPeerCompanyFilterId(null);
      } else {
        setIcGroupMemberFilterId(null);
        setIcGroupPeerCompanyFilterId(null);
      }
      const path =
        party.id === OVERDUE_ACCOUNT_ID
          ? `/party?selected=${encodeURIComponent(OVERDUE_ACCOUNT_ID)}`
          : activeView === "ic_ac"
            ? `/party?view=ic_ac&selected=${encodeURIComponent(party.id)}`
            : activeView === "agents"
              ? `/party?view=agents&selected=${encodeURIComponent(party.id)}`
              : activeView === "subscribers"
                ? `/party?view=subscribers&selected=${encodeURIComponent(party.id)}`
                : `/party?selected=${encodeURIComponent(party.id)}`;
      const syncRouter = useQueryNav && shouldReplaceWithMasterDetailCanonical(path);
      if (typeof window !== "undefined") {
        try {
          window.history.replaceState(window.history.state, "", browserHistoryHref(path));
        } catch {
          /* ignore */
        }
      }
      if (syncRouter) {
        router.replace(path, { scroll: false });
      }
    },
    [router, setSelected, useQueryNav, activeView]
  );

  const partiesForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    if (selectedGroup.id === IC_COMPANY_PARTY_GROUP_ID) {
      return buildIcPeerCompanyGroupRows(icParties);
    }
    return filterPartiesForPartyGroupScope(
      selectedGroup.id,
      processedPartiesForSelection,
      processedGroups
    );
  }, [selectedGroup, processedPartiesForSelection, processedGroups, icParties]);

  // Filtered count for party list (matches PartyList logic: search + exclude system accounts)
  const filteredPartyCount = useMemo(() => {
    const source =
      activeView === "subscribers"
        ? subscriberPartiesForView
        : activeView === "agents"
          ? agentPartiesForView
          : packedMyCompanyMode
            ? packedPartiesForView
            : partiesForPartyListView;
    return (source || []).filter((p) => {
      const isSystemAccount = (p as any).isSystemAccount === true;
      return partyListRowMatchesSearch(p, searchTerm) && !isSystemAccount;
    }).length;
  }, [activeView, packedMyCompanyMode, packedPartiesForView, partiesForPartyListView, subscriberPartiesForView, agentPartiesForView, searchTerm]);

  const filteredIcPartyCount = useMemo(() => {
    return (icListRowsForView || []).filter((p) => partyListRowMatchesSearch(p, searchTerm)).length;
  }, [icListRowsForView, searchTerm]);

  const selectedIcGroupMemberParties = useMemo(
    () => resolveIcMemberPartiesForGroupSelection(selectedParty, icParties),
    [selectedParty, icParties]
  );

  const mobilePartyGroupSelectionLabel = useMemo((): ReactNode => {
    if (!selected) return null;
    const toneClassName = mobilePartyGroupSelectionLabelClassName;

    if (activeView === "groups" && selectedGroup) {
      if (selectedGroup.id === IC_COMPANY_PARTY_GROUP_ID) {
        const peerCompany = icGroupPeerCompanyFilterId
          ? partiesForSelectedGroup.find((row) => row.id === icGroupPeerCompanyFilterId) ?? null
          : null;
        const memberAccount =
          icGroupMemberFilterId && peerCompany?.icMemberParties
            ? peerCompany.icMemberParties.find((row) => row.id === icGroupMemberFilterId) ??
              partiesForSelectedGroup.find((row) => row.id === icGroupMemberFilterId) ??
              null
            : null;
        return (
          <MobileMasterDetailNestedName
            groupName={selectedGroup.name}
            middleName={
              peerCompany ? icPeerCompanyGroupListTitleLines(peerCompany).primary : null
            }
            memberName={
              memberAccount ? interCompanyClearingAccountDisplayName(memberAccount) : null
            }
            toneClassName={toneClassName}
          />
        );
      }
      if (groupMemberFilterId) {
        const member = partiesForSelectedGroup.find((row) => row.id === groupMemberFilterId);
        return (
          <MobileMasterDetailNestedName
            groupName={selectedGroup.name}
            memberName={member?.name ?? null}
            toneClassName={toneClassName}
          />
        );
      }
      const groupName = selectedGroup.name;
      return groupName && String(groupName).trim() ? String(groupName).trim() : null;
    }

    if (
      (activeView === "parties" ||
        activeView === "ic_ac" ||
        activeView === "subscribers" ||
        activeView === "agents") &&
      selectedParty
    ) {
      const isIcPeer =
        activeView === "ic_ac" ||
        (selectedParty as Party & { isIcPeerCompanyGroup?: boolean }).isIcPeerCompanyGroup === true ||
        isIcPeerCompanyGroupId(selectedParty.id);
      if (isIcPeer) {
        const memberAccount =
          icGroupMemberFilterId && selectedIcGroupMemberParties
            ? selectedIcGroupMemberParties.find((row) => row.id === icGroupMemberFilterId) ?? null
            : null;
        return (
          <MobileMasterDetailNestedName
            groupName={icPeerCompanyGroupListTitleLines(selectedParty).primary}
            memberName={
              memberAccount ? interCompanyClearingAccountDisplayName(memberAccount) : null
            }
            toneClassName={toneClassName}
          />
        );
      }
      const partyName = selectedParty.name;
      return partyName && String(partyName).trim() ? String(partyName).trim() : null;
    }

    const name = (selected as Party | Group).name;
    return name && String(name).trim() ? String(name).trim() : null;
  }, [
    selected,
    activeView,
    selectedGroup,
    selectedParty,
    icGroupPeerCompanyFilterId,
    icGroupMemberFilterId,
    groupMemberFilterId,
    partiesForSelectedGroup,
    selectedIcGroupMemberParties,
    mobilePartyGroupSelectionLabelClassName,
  ]);

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

  if (pageColdLoading) {
    return <LoadingSpinner />;
  }
  
  const partyTabsEl = (
    <Tabs value={activeView} onValueChange={handlePartyGroupsTabChange} className="w-full">
      <TabsList listChrome>
        {adminPartyMode ? (
          <>
            <TabsTrigger listChrome value="subscribers" className="flex-1">Subscribers</TabsTrigger>
            <TabsTrigger listChrome value="agents" className="flex-1">Agents</TabsTrigger>
          </>
        ) : (
          <TabsTrigger listChrome value="parties" className="flex-1">Parties</TabsTrigger>
        )}
        <TabsTrigger listChrome value="groups" className="flex-1">Groups</TabsTrigger>
        {adminPartyMode ? null : packedMyCompanyMode ? (
          <TabsTrigger listChrome value="agents" className="flex-1">Agents</TabsTrigger>
        ) : (
          <TabsTrigger listChrome value="ic_ac" className="flex-1">IC / Ac</TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );

  const partySearchRowEl = (
    <div className={mlc.searchRow}>
      <div className={mlc.searchWrap}>
        <Search className={mlc.searchIcon} />
        <Input
          placeholder={
            activeView === "subscribers"
              ? "Search subscribers..."
              : activeView === "agents"
                ? "Search agents..."
                : activeView === "parties"
                  ? "Search parties..."
                  : activeView === "ic_ac"
                    ? "Search companies..."
                    : packedMyCompanyMode && (activeView as PartyListTab) === "agents"
                      ? "Search agents..."
                      : "Search groups/party"
          }
          listChrome
          listChromeSearch
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {(activeView === "parties" ||
        activeView === "ic_ac" ||
        activeView === "subscribers" ||
        activeView === "agents") &&
      showApproveOnList &&
      totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge
          compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyPartiesWithPendingApproval}
          onToggle={() => setShowOnlyPartiesWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only parties with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all parties (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all parties"
        />
      ) : null}
      {activeView === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge
          compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyPartyGroupsWithPendingApproval}
          onToggle={() => setShowOnlyPartyGroupsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only groups with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all groups (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all groups"
        />
      ) : null}
      {activeView === "parties" ? (
        <CreatePartyDialog onPartyCreated={() => {}} isOpen={isCreatePartyOpen} onOpenChange={setIsCreatePartyOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreatePartyOpen(true)}>
            + Add Party
          </PermissionButton>
        </CreatePartyDialog>
      ) : activeView === "groups" ? (
        <CreateGroupDialog onGroupCreated={() => {}} groups={processedGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
            + Add Group
          </PermissionButton>
        </CreateGroupDialog>
      ) : null}
    </div>
  );

  const partyListSectionTitle =
    activeView === "subscribers"
      ? `Subscribers (${filteredPartyCount})`
      : activeView === "agents"
        ? `Agents (${filteredPartyCount})`
        : `Party (${filteredPartyCount})`;

  const partySectionLabelEl = (
    <div
      className={cn(mlc.sectionLabelRow, "justify-between", isMobile && "px-[2px]")}
      {...(hasOverdueTransactions && overdueVirtualParty ? { "data-pl-party-overdue-row": "" } : {})}
    >
      <div className="flex items-center gap-2">
        <User className={mlc.sectionIcon} />
        <span>{partyListSectionTitle}</span>
      </div>
      {hasOverdueTransactions && overdueVirtualParty ? (
        <Button
          variant="outline"
          size="sm"
          className="h-[35px] max-h-[35px] self-center px-2 text-xs font-medium border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
          onClick={() => handleSelect(overdueVirtualParty)}
        >
          <AlertCircle className="h-3.5 w-3 mr-1 shrink-0" />
          Overdue Vouchers ({overdueTransactions.length})
        </Button>
      ) : null}
    </div>
  );

  const groupSectionLabelEl = (
    <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
      <Users className={mlc.sectionIcon} />
      <span>Party group ({groupsForPartyGroupListView.length})</span>
    </div>
  );

  const icSectionLabelEl = (
    <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
      <User className={mlc.sectionIcon} />
      <span>IC / Ac ({filteredIcPartyCount})</span>
    </div>
  );

  const listView = (
    <MasterListViewShell
      isMobile={isMobile}
      searchRow={partySearchRowEl}
      sectionLabel={
        activeView === "groups"
          ? groupSectionLabelEl
          : activeView === "ic_ac"
            ? icSectionLabelEl
            : partySectionLabelEl
      }
      tabs={partyTabsEl}
      quickFilter={
        activeView === "groups" ? groupListQuickFilter : partyListQuickFilter
      }
      onQuickFilterChange={
        activeView === "groups" ? setGroupListQuickFilter : setPartyListQuickFilter
      }
    >
      <div className="relative h-full min-h-0 w-full overflow-hidden">
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            activeView !== "parties" && "hidden pointer-events-none"
          )}
          aria-hidden={activeView !== "parties"}
        >
          <PartyList
            parties={packedMyCompanyMode ? packedPartiesForView : partiesForPartyListView}
            onSelectParty={handleSelectParty}
            selectedParty={selectedParty}
            selectedIcMemberAccountId={icGroupMemberFilterId}
            searchTerm={searchTerm}
            topPartyId={hasOverdueTransactions ? OVERDUE_ACCOUNT_ID : undefined}
            overdueVoucherCount={hasOverdueTransactions ? overdueTransactions.length : undefined}
            pendingApprovalByPartyId={pendingApprovalByPartyId}
            resolvePartyTitleLines={packedMyCompanyMode ? myCompanyPartyListTitleLines : undefined}
            getItemHref={useQueryNav ? (p) => (p.id === OVERDUE_ACCOUNT_ID ? undefined : `/party?selected=${p.id}`) : undefined}
            quickFilter={partyListQuickFilter}
            onQuickFilterChange={setPartyListQuickFilter}
            hideQuickFilterBar
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            activeView !== "subscribers" && "hidden pointer-events-none"
          )}
          aria-hidden={activeView !== "subscribers"}
        >
          <PartyList
            parties={subscriberPartiesForView}
            onSelectParty={handleSelectParty}
            selectedParty={selectedParty}
            searchTerm={searchTerm}
            pendingApprovalByPartyId={pendingApprovalByPartyId}
            resolvePartyTitleLines={subscriberPartyListTitleLines}
            getItemHref={
              useQueryNav ? (p) => `/party?view=subscribers&selected=${p.id}` : undefined
            }
            quickFilter={partyListQuickFilter}
            onQuickFilterChange={setPartyListQuickFilter}
            hideQuickFilterBar
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            activeView !== "agents" && "hidden pointer-events-none"
          )}
          aria-hidden={activeView !== "agents"}
        >
          <PartyList
            parties={agentPartiesForView}
            onSelectParty={handleSelectParty}
            selectedParty={selectedParty}
            searchTerm={searchTerm}
            pendingApprovalByPartyId={pendingApprovalByPartyId}
            resolvePartyTitleLines={packedMyCompanyMode ? myCompanyPartyListTitleLines : undefined}
            getItemHref={useQueryNav ? (p) => `/party?view=agents&selected=${p.id}` : undefined}
            quickFilter={partyListQuickFilter}
            onQuickFilterChange={setPartyListQuickFilter}
            hideQuickFilterBar
            emptyLabel="No agents found."
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            activeView !== "groups" && "hidden pointer-events-none"
          )}
          aria-hidden={activeView !== "groups"}
        >
          <PartyGroupList
            groups={groupsForPartyGroupListView}
            onSelectGroup={handleSelect}
            selectedGroup={selectedGroup}
            searchTerm={searchTerm}
            collapsible={false}
            pendingApprovalByGroupId={pendingApprovalByGroupId}
            pendingApprovalByPartyId={pendingApprovalByPartyId}
            icPeerCompanyRows={packedMyCompanyMode ? [] : icPeerCompanyRowsForGroupTab}
            selectedIcPeerCompanyId={icGroupPeerCompanyFilterId}
            selectedIcMemberAccountId={icGroupMemberFilterId}
            onSelectIcCompanyGroup={handleSelectIcCompanyGroup}
            groupMembersByGroupId={partyGroupMembersByGroupId}
            selectedGroupMemberFilterId={groupMemberFilterId}
            getItemHref={useQueryNav ? (g) => `/party?view=groups&selected=${g.id}` : undefined}
            quickFilter={groupListQuickFilter}
            onQuickFilterChange={setGroupListQuickFilter}
            hideQuickFilterBar
            hideCategoryHeaders
            moveAccountsEnabled={!!companyId}
            onMoveAccountToGroup={handleMovePartyToGroup}
            canMoveMember={partyGroupAccountMove.canMoveAccount}
            onMoveGroupToGroup={handleMovePartyGroupToGroup}
            canMoveGroup={partyGroupTreeMove.canMoveGroup}
            allGroupsForMove={initialProcessedGroups}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            activeView !== "ic_ac" && "hidden pointer-events-none"
          )}
          aria-hidden={activeView !== "ic_ac"}
        >
          <PartyList
            parties={icListRowsForView}
            onSelectParty={handleSelectParty}
            selectedParty={selectedParty}
            selectedIcMemberAccountId={icGroupMemberFilterId}
            searchTerm={searchTerm}
            pendingApprovalByPartyId={pendingApprovalByPartyId}
            getItemHref={
              useQueryNav
                ? (p) => `/party?view=ic_ac&selected=${p.id}`
                : undefined
            }
            quickFilter={partyListQuickFilter}
            onQuickFilterChange={setPartyListQuickFilter}
            hideQuickFilterBar
          />
        </div>
      </div>
    </MasterListViewShell>
  );

  const detailView = (
    <>
      {activeView === 'parties' && selectedParty?.id === OVERDUE_ACCOUNT_ID && (
        <OverdueAccountView
          overdueTransactions={overdueTransactions}
          importanceFilter={overdueImportanceFilter}
          onImportanceFilterChange={handleOverdueImportanceFilterChange}
          userNames={mergedUserNames}
          onEditVoucher={(row: OverdueTransactionRow) => {
            const voucher = vouchers.find((v) => v.id === row.id);
            if (voucher) {
              editingFromOverdueRef.current = true;
              setOverdueVoucherToEdit(voucher);
            }
          }}
          onHistoryVoucher={(row: OverdueTransactionRow) => {
            const voucher = vouchers.find((v) => v.id === row.id);
            if (voucher) setHistoryVoucher(voucher);
          }}
          onAddLink={(row: OverdueTransactionRow) => {
            const voucher = vouchers.find((v) => v.id === row.id);
            if (!voucher) return;
            const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
            if (isPaymentType) setLinkPaymentVoucher(voucher);
            else setLinkAdvancesVoucher(voucher);
          }}
        />
      )}
      {(activeView === "parties" ||
        activeView === "ic_ac" ||
        activeView === "subscribers" ||
        activeView === "agents") &&
        selectedParty &&
        selectedParty.id !== OVERDUE_ACCOUNT_ID && (
        <PartyDetails
          key={`${selectedParty.id}:${icGroupMemberFilterId ?? "all"}`}
          party={selectedParty}
          allParties={processedParties}
          icGroupMemberParties={selectedIcGroupMemberParties ?? undefined}
          icGroupMemberFilterId={icGroupMemberFilterId}
          onPartyUpdated={handlePartyUpdated}
          onPartyDeleted={() => setSelected(null)}
          dateRange={partyDetailsDateRange}
          onDateRangeChange={setPartyDetailsDateRange}
          userNames={mergedUserNames}
          hideMobilePeriodLabelRow={isMobile}
        />
      )}
      {activeView === 'groups' && selectedGroup && (
        <GroupDetails
          key={`${selectedGroup.id}:${icGroupPeerCompanyFilterId ?? "all"}:${icGroupMemberFilterId ?? "all"}:${groupMemberFilterId ?? "all"}`}
          group={selectedGroup}
          allGroups={processedGroups}
          allParties={partiesForSelectedGroup}
          icGroupPeerCompanyFilterId={icGroupPeerCompanyFilterId}
          icGroupMemberFilterId={icGroupMemberFilterId}
          groupMemberFilterId={groupMemberFilterId}
          onGroupUpdated={() => {}}
          onGroupDeleted={() => setSelected(null)}
          onPartyUpdated={handlePartyUpdated}
          dateRange={groupDetailsDateRange}
          onDateRangeChange={setGroupDetailsDateRange}
          userNames={mergedUserNames}
          hideMobilePeriodLabelRow={isMobile}
        />
      )}
      {!selected && <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>}
    </>
  );

  // Mobile: full-screen Overdue view – same UI as Party Details (header, To Pay, search, cards, Bill wise bar)
  if (isMobile && selectedParty?.id === OVERDUE_ACCOUNT_ID) {
    const handleOverdueRowClick = (t: any) => {
      const voucher = vouchers.find((v) => v.id === t.id);
      if (voucher) {
        editingFromOverdueRef.current = true;
        setOverdueVoucherToEdit(voucher);
      }
    };
    const handleOverdueHistory = (t: any) => {
      const voucher = vouchers.find((v) => v.id === t.id);
      if (voucher) setHistoryVoucher(voucher);
    };
    const handleOverdueAddLink = (t: any) => {
      const voucher = vouchers.find((v) => v.id === t.id);
      if (!voucher) return;
      const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
      if (isPaymentType) setLinkPaymentVoucher(voucher);
      else setLinkAdvancesVoucher(voucher);
    };
    return (
      <>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden pb-24">
          {/* Row 1: Back | Title | Showing x of y */}
          <div className="px-2 py-1.5 border-b flex items-center justify-between gap-2 flex-shrink-0">
            <Button variant="ghost" size="icon" className="flex-shrink-0 h-8 w-8" onClick={() => { setSelected(null); router.push("/party"); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-base font-bold truncate flex-1 min-w-0">Overdue Vouchers</h1>
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
              Showing {mobileFilteredOverdue.length} of {overdueAsTransactions.length} voucher(s)
            </span>
          </div>
          {/* Row 2: All / Important / Normal — desktop overdue header jaisa */}
          <div className="px-2 py-1.5 border-b flex justify-center items-center gap-2 flex-shrink-0">
            <Button
              type="button"
              variant={overdueImportanceFilter === "all" ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => handleOverdueImportanceFilterChange("all")}
            >
              All
            </Button>
            <Button
              type="button"
              variant={overdueImportanceFilter === "important" ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => handleOverdueImportanceFilterChange("important")}
            >
              Important
            </Button>
            <Button
              type="button"
              variant={overdueImportanceFilter === "normal" ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => handleOverdueImportanceFilterChange("normal")}
            >
              Normal
            </Button>
          </div>
          {/* To Pay total */}
          <div className="px-3 py-3 border-b flex-shrink-0">
            <p className="text-2xl font-bold text-center text-red-600">
              <span className="text-[0.6em]">To Pay</span> {formatCurrency(Math.abs(overdueClosingBalance), { noSuffix: true })}
            </p>
          </div>
          {/* Transaction list – mobile cards; scroll-touch + inline for APK/WebView touch scroll */}
          <div
            className="flex-1 min-h-0 overflow-auto scroll-touch pb-[calc(env(safe-area-inset-bottom,0px)+5rem)]"
          >
            <TransactionsTable
              transactions={mobileFilteredOverdue}
              context="party"
              contextId={OVERDUE_ACCOUNT_ID}
              openingBalance={0}
              showNarration={overdueShowNarration}
              userNames={mergedUserNames}
              accountNames={overduePartyNames}
              onRowClick={handleOverdueRowClick}
              onHistoryVoucher={handleOverdueHistory}
              onAddLink={handleOverdueAddLink}
              filters={overdueFilters}
              setFilters={setOverdueFilters}
              activeFilter={overdueActiveFilter}
              setActiveFilter={setOverdueActiveFilter}
              periodDr={overduePeriodDr}
              periodCr={overduePeriodCr}
              closingBalance={overdueClosingBalance}
              scrollOnlyTransactions
              visibleColumns={{ status: true }}
            />
          </div>
        </div>
        {/* Fixed bottom: search (pager slot) + Receive, Pay, New Sale */}
        <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t bg-background/95 backdrop-blur">
          <MobileEntityTxnToolbarRow placement="belowPager" className="border-t border-blue-300/80 bg-background/95">
            <MobileEntityTxnToolbarSearch>
              <Search className={mdc.mobileTxnToolbarSearchIcon} />
              <Input
                placeholder="Search transactions"
                className={mdc.mobileTxnToolbarSearchInput}
                value={overdueMobileSearchTerm}
                onChange={(e) => setOverdueMobileSearchTerm(e.target.value)}
              />
            </MobileEntityTxnToolbarSearch>
          </MobileEntityTxnToolbarRow>
        <div
          className="flex items-center justify-around gap-1.5 p-1.5 border-t"
          data-pl-mobile-ledger-action-footer=""
        >
          <Button className="flex-1 h-6 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-medium" onClick={() => { editingFromOverdueRef.current = true; setOverdueFooterDialog("payment_in"); }}>
            Receive
          </Button>
          <Button className="flex-1 h-6 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium" onClick={() => { editingFromOverdueRef.current = true; setOverdueFooterDialog("payment_out"); }}>
            Pay
          </Button>
          <Button className="flex-1 h-6 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium" onClick={() => { editingFromOverdueRef.current = true; setOverdueFooterDialog("sale"); }}>
            New Sale
          </Button>
        </div>
        </div>
        <MobileLedgerFooterChevronFab />
        <AddVoucherDialog
          isOpen={!!overdueVoucherToEdit || !!overdueFooterDialog}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setOverdueVoucherToEdit(null);
              setOverdueFooterDialog(null);
              restoreOverdueDetailAfterVoucherDialog();
            }
          }}
          voucher={overdueVoucherToEdit}
          defaultTab={overdueFooterDialog || undefined}
          defaultVoucherData={overdueVoucherToEdit ? undefined : {}}
          onVoucherAction={() => {
            setOverdueVoucherToEdit(null);
            setOverdueFooterDialog(null);
            restoreOverdueDetailAfterVoucherDialog();
          }}
        />
        <HistoryDialog
          voucher={historyVoucher}
          isOpen={!!historyVoucher}
          onOpenChange={(open) => !open && setHistoryVoucher(null)}
          onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)}
        />
        {linkAdvancesVoucher && (
          <LinkAdvancesToVoucherDialog
            isOpen={!!linkAdvancesVoucher}
            onOpenChange={(open) => !open && setLinkAdvancesVoucher(null)}
            mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
            targetVoucherId={linkAdvancesVoucher.id}
            targetPartyId={linkAdvancesVoucher.partyId ?? ""}
            targetPartyName={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.name ?? "Party"}
            partyOpeningBalance={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.openingBalance ?? 0}
            balanceKind="all"
            onDone={() => setLinkAdvancesVoucher(null)}
          />
        )}
        {linkPaymentVoucher && (
          <LinkPaymentToTxnsDialog
            isOpen={!!linkPaymentVoucher}
            onOpenChange={(open) => !open && setLinkPaymentVoucher(null)}
            variant={linkPaymentVoucher.type === "payment_out" || linkPaymentVoucher.type === "direct_expense" ? "payment_out" : "payment_in"}
            partyId={linkPaymentVoucher.partyId ?? null}
            partyName={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.name ?? "Party"}
            receivedAmount={Number(linkPaymentVoucher.amount ?? linkPaymentVoucher.total ?? 0)}
            existingAllocations={Array.isArray(linkPaymentVoucher.allocations) ? linkPaymentVoucher.allocations : []}
            paymentInId={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
            paymentOutId={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
            paymentInVoucherNumber={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
            paymentInDate={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
            paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
            paymentOutDate={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
            partyOpeningBalance={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.openingBalance ?? 0}
            onDone={async (allocations, _amount) => {
              if (!companyId || !linkPaymentVoucher?.id) return;
              const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
              const result = await runWithVoucherLinkSaveProgress(async () => {
                await applyPaymentBillWiseLinkAllocations(companyId, linkPaymentVoucher, allocations);
                setLinkPaymentVoucher(null);
              }, { successTitle: "Allocations updated" });
              if (!result.ok) {
                toast.error(
                  result.error instanceof Error
                    ? result.error.message
                    : "Failed to update allocations."
                );
              }
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <ResponsiveMasterDetail
        listChromeRouteKey="party"
        mobileTabsDocked={isMobile}
        title={responsiveMasterDetailTitle}
        mobileSelectionLabel={mobilePartyGroupSelectionLabel}
        mobileSelectionLabelClassName={mobilePartyGroupSelectionLabelClassName}
        mobileDetailHeaderEnd={mobileDetailHeaderAvatar}
        mobileDetailHeaderSecondary={partyMobileHeaderSecondary}
        balance={
          <span className={cn(
              "font-semibold",
              totalBalance >= 0 ? "text-green-600" : "text-red-600"
          )}>
              {formatCurrency(totalBalance, { showDrCr: true })}
          </span>
        }
        tabs={isMobile ? undefined : partyTabsEl}
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
        isOpen={!!overdueVoucherToEdit}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setOverdueVoucherToEdit(null);
            restoreOverdueDetailAfterVoucherDialog();
          }
        }}
        voucher={overdueVoucherToEdit}
        onVoucherAction={() => {
          setOverdueVoucherToEdit(null);
          restoreOverdueDetailAfterVoucherDialog();
        }}
      />
      <HistoryDialog
        voucher={historyVoucher}
        isOpen={!!historyVoucher}
        onOpenChange={(open) => !open && setHistoryVoucher(null)}
        onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)}
      />
      {linkAdvancesVoucher && (
        <LinkAdvancesToVoucherDialog
          isOpen={!!linkAdvancesVoucher}
          onOpenChange={(open) => !open && setLinkAdvancesVoucher(null)}
          mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
          targetVoucherId={linkAdvancesVoucher.id}
          targetPartyId={linkAdvancesVoucher.partyId ?? ""}
          targetPartyName={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.name ?? "Party"}
          partyOpeningBalance={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.openingBalance ?? 0}
          balanceKind="all"
          onDone={() => setLinkAdvancesVoucher(null)}
        />
      )}
      {linkPaymentVoucher && (
        <LinkPaymentToTxnsDialog
          isOpen={!!linkPaymentVoucher}
          onOpenChange={(open) => !open && setLinkPaymentVoucher(null)}
          variant={linkPaymentVoucher.type === "payment_out" || linkPaymentVoucher.type === "direct_expense" ? "payment_out" : "payment_in"}
          partyId={linkPaymentVoucher.partyId ?? null}
          partyName={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.name ?? "Party"}
          receivedAmount={Number(linkPaymentVoucher.amount ?? linkPaymentVoucher.total ?? 0)}
          existingAllocations={Array.isArray(linkPaymentVoucher.allocations) ? linkPaymentVoucher.allocations : []}
          paymentInId={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
          paymentOutId={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
          paymentInVoucherNumber={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
          paymentInDate={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
          paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
          paymentOutDate={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
          partyOpeningBalance={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.openingBalance ?? 0}
          onDone={async (allocations, _amount) => {
            if (!companyId || !linkPaymentVoucher?.id) return;
            const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
            const result = await runWithVoucherLinkSaveProgress(async () => {
              await applyPaymentBillWiseLinkAllocations(companyId, linkPaymentVoucher, allocations);
              setLinkPaymentVoucher(null);
            }, { successTitle: "Allocations updated" });
            if (!result.ok) {
              toast.error(
                result.error instanceof Error
                  ? result.error.message
                  : "Failed to update allocations."
              );
            }
          }}
        />
      )}
    </>
  );
}

export default function PartyPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<LoadingSpinner />}>
      <PartyPageContent />
    </Suspense>
  );
}
