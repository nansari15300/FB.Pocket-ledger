
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
import { Search, Landmark, Pencil } from "lucide-react";
import { EditAccountDialog } from "@/components/bank-cash/EditAccountDialog";
import { EditAccountGroupDialog } from "@/components/bank-cash/EditAccountGroupDialog";
import { LEDGER_HEADER_AVATAR_PEN_CN } from "@/lib/ledgerHeaderChrome";
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
import { useDate } from "@/hooks/useDate";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { AccountList } from "@/components/bank-cash/AccountList";
import { AccountDetails } from "@/components/bank-cash/AccountDetails";
import { AccountGroupList } from "@/components/bank-cash/AccountGroupList";
import { AccountGroupDetails } from "@/components/bank-cash/AccountGroupDetails";
import { CreateBankAccountDialog } from "@/components/bank-cash/CreateBankAccountDialog";
import { CreateAccountGroupDialog } from "@/components/bank-cash/CreateAccountGroupDialog";
import { PermissionButton } from "@/components/permission";
import { useVouchers } from "@/hooks/useVouchers";
import { useLiveMasterSelection } from "@/hooks/useLiveMasterSelection";
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { bankAccountDisplayName } from "@/lib/bankAccountDisplayName";
import { userCanViewSpecialAccountBalance, userIsSpecialAccountOwner } from "@/lib/specialAccountUsage";
import { useMasterDetailQueryNav } from "@/hooks/useMasterDetailQueryNav";
import { useRegisterMasterDetailHardwareBack } from "@/hooks/useRegisterMasterDetailHardwareBack";
import { useSyncMasterDetailHeaderId } from "@/hooks/useSyncMasterDetailHeaderId";
import { applyMasterDetailBackToListUrl } from "@/lib/masterDetailListPath";
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
import { useResponsiveListLayout } from "@/hooks/useResponsiveListLayout";
import usePermissions from "@/hooks/usePermissions";

// Custom Hook
import { usePageMemory } from "@/hooks/usePageMemory";
import { isSystemParentGroup } from "@/lib/system-groups";
import { shouldReplaceWithMasterDetailCanonical } from "@/lib/maybeReplaceMasterDetailUrl";
import { collectBankAccountIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesBankLedger";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { useBankLedgerDrCrPerspective } from "@/hooks/useBankLedgerDrCrPerspective";
import { flipLedgerSignedBalance } from "@/lib/bankLedgerDrCrPerspective";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { MobileMasterDetailHeaderAvatar } from "@/components/entity/MobileMasterDetailHeaderAvatar";
import { MobileMasterDetailHeaderDateSecondary } from "@/components/entity/MobileMasterDetailHeaderDateSecondary";
import { mobileEntityDetailShellTitle } from "@/lib/mobileDetailChrome";
import { usePendingApprovalListFilter } from "@/hooks/usePendingApprovalListFilter";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { type EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";
import { masterEntityTextMatchesSearch } from "@/lib/filterMasterEntityListRows";
import { createMasterEntityGroupMoveHandler } from "@/lib/createMasterEntityGroupMoveHandler";
import { createMasterEntityGroupTreeMoveHandler } from "@/lib/createMasterEntityGroupTreeMoveHandler";
import { BANK_ACCOUNT_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { computeMasterGroupListSearchVisibleCount } from "@/lib/masterGroupListTree";
import { bankGroupTreeMove } from "@/lib/masterEntityGroupTreeMoveHelpers";
import { bankGroupAccountMove } from "@/lib/masterEntityGroupAccountMove";
import { filterMembersByMasterGroupScope } from "@/lib/masterGroupMemberScope";
import { BANK_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import {
  appendMasterEntitySystemBranchGroups,
  isMasterEntitySystemGroupId,
  resolveBankListGroupBucketId,
  resolveMasterEntityGroupForSelection,
} from "@/lib/masterEntitySystemGroups";

function BankCashPageContent() {
  const icSystemEnabled = isInterCompanySystemEnabled();
  const { user } = useAuth();
  const { company, companyId, effectiveNotificationSettings } = useCompany();
  const { formatCurrency, formatRunning } = useDate();
  const { perspective: bankDrCrPerspective } = useBankLedgerDrCrPerspective();
  const { vouchers, loading: vouchersLoading, processedAccounts, processedAccountGroups: initialProcessedAccountGroups, userNames } = useVouchers();
  const pageColdLoading = vouchersLoading && processedAccounts.length === 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIdFromUrl = searchParams.get("selected");
  const viewFromUrl = searchParams.get("view");
  const isInitialMount = useRef(true);
  /** Tab switch — stale `useSearchParams` ignore (Party jaisa). */
  const pendingBankSelectIdRef = useRef<string | null>(null);
  const { can } = usePermissions();
  const showApproveOnList =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false;
  const pendingApprovalByAccountId = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedAccounts?.length) return {} as Record<string, number>;
    const accountIdSet = new Set(processedAccounts.map((a: Account) => a.id));
    const map: Record<string, number> = {};
    vouchers.forEach((v: any) => {
      const touched = collectBankAccountIdsTouchedByUnapprovedVoucher(v, accountIdSet);
      touched.forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }, [vouchers, showApproveOnList, processedAccounts]);
  const pendingApprovalByAccountGroupId = useMemo(() => {
    if (!showApproveOnList) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    processedAccounts.forEach((a: any) => {
      const n = pendingApprovalByAccountId[a.id] || 0;
      if (!n) return;
      const gid = resolveBankListGroupBucketId(a);
      map[gid] = (map[gid] || 0) + n;
    });
    return map;
  }, [processedAccounts, pendingApprovalByAccountId, showApproveOnList]);
  /** Toolbar pink box total: jitne unapproved vouchers kisi bank account ko touch karte hain */
  const totalPendingApprovalVoucherCount = useMemo(() => {
    if (!showApproveOnList || !vouchers?.length || !processedAccounts?.length) return 0;
    const accountIdSet = new Set(processedAccounts.map((a: Account) => a.id));
    let n = 0;
    for (const v of vouchers as any[]) {
      if (v?.isApproved === true) continue;
      if (collectBankAccountIdsTouchedByUnapprovedVoucher(v, accountIdSet).size > 0) n += 1;
    }
    return n;
  }, [vouchers, showApproveOnList, processedAccounts]);
  
  const [activeView, setActiveView] = useState("accounts");
  const { isMobile, selected, setSelected } = useResponsiveListLayout<Account | AccountGroup>(`bank_cash_view_${activeView}`);
  const useQueryNav = useMasterDetailQueryNav();

  // Detail → list: pehle URL clear (sync effect race) + replace + hardware back
  const onBackToList = useCallback(() => {
    pendingBankSelectIdRef.current = null;
    const href = applyMasterDetailBackToListUrl("bank-cash");
    setSelected(null);
    router.replace(href, { scroll: false });
  }, [setSelected, router]);
  useRegisterMasterDetailHardwareBack("bank-cash", onBackToList);

  const [searchTerm, setSearchTerm] = useState("");
  const [accountListQuickFilter, setAccountListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  /** Accounts tab: pink count click → sirf jinke paas pending approval */
  const {
    showOnlyEntities: showOnlyAccountsWithPendingApproval,
    setShowOnlyEntities: setShowOnlyAccountsWithPendingApproval,
    showOnlyGroups: showOnlyGroupsWithPendingApproval,
    setShowOnlyGroups: setShowOnlyGroupsWithPendingApproval,
  } = usePendingApprovalListFilter(totalPendingApprovalVoucherCount);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [accountDetailsDateRange, setAccountDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupDetailsDateRange, setGroupDetailsDateRange] = useState<DateRange | undefined>(undefined);
  const [groupMemberFilterId, setGroupMemberFilterId] = useState<string | null>(null);
  /** Mobile: AccountDetails se voucher count — master-detail title row me dikhane ke liye */
  const [bankMobileVoucherStats, setBankMobileVoucherStats] = useState<{ showing: number; total: number } | null>(null);

  // `clearing` tab bhi account detail use karta hai.
  const selectedAccountRaw = activeView !== 'groups' ? selected as Account : null;
  const selectedAccount = useLiveMasterSelection(selectedAccountRaw, setSelected, processedAccounts) as Account | null;
  const selectedGroupRaw = activeView === "groups" ? (selected as AccountGroup) : null;
  const handleAccountUpdated = useCallback((patch?: Partial<Account>) => {
    if (!patch?.id || !selectedAccountRaw || selectedAccountRaw.id !== patch.id) return;
    setSelected({ ...selectedAccountRaw, ...patch });
  }, [setSelected, selectedAccountRaw]);
  const handleAccountGroupUpdated = useCallback((patch?: Partial<AccountGroup>) => {
    if (!patch?.id || !selectedGroupRaw || selectedGroupRaw.id !== patch.id) return;
    setSelected({ ...selectedGroupRaw, ...patch });
  }, [setSelected, selectedGroupRaw]);
  // Account row = `accountName`; group row = `name` — sirf `.name` se bank detail header khali rehta tha
  const mobileBankCashSelectionLabelClassName = useMemo(() => {
    if (!selected) return undefined;
    return masterDetailBalanceToneClass((selected as Account | AccountGroup).balance);
  }, [selected]);
  const mobileBankCashSelectionLabel = useMemo((): ReactNode => {
    if (!selected) return null;
    if (activeView !== "groups") {
      const nm = selectedAccount?.accountName ?? (selected as Account).accountName;
      return nm && String(nm).trim() ? String(nm).trim() : null;
    }
    const group = selected as AccountGroup;
    if (groupMemberFilterId) {
      const member = processedAccounts.find((account) => account.id === groupMemberFilterId);
      return (
        <MobileMasterDetailNestedName
          groupName={group.name}
          memberName={member ? bankAccountDisplayName(member) : null}
          toneClassName={mobileBankCashSelectionLabelClassName}
        />
      );
    }
    const nm = group.name;
    return nm && String(nm).trim() ? String(nm).trim() : null;
  }, [selected, selectedAccount, activeView, groupMemberFilterId, processedAccounts, mobileBankCashSelectionLabelClassName]);
  const bankCashMasterDetailTitle = activeView === "groups" ? "Bank Groups" : "Bank & Cash";
  useSyncMasterDetailHeaderId("bank-cash", selectedAccount?.id ?? selectedGroupRaw?.id ?? null);

  useEffect(() => {
    if (!isMobile || activeView === "groups") setBankMobileVoucherStats(null);
  }, [isMobile, activeView, selectedAccount?.id]);

  const bankShellTitle = useMemo(
    () => mobileEntityDetailShellTitle(isMobile, Boolean(selected), bankCashMasterDetailTitle, "Bank details"),
    [isMobile, selected, bankCashMasterDetailTitle]
  );
  const mobileBankHeaderSecondary = useMemo((): ReactNode | undefined => {
    if (!isMobile || !selected) return undefined;
    const range = activeView === "groups" ? groupDetailsDateRange : accountDetailsDateRange;
    const onClear =
      activeView === "groups"
        ? () => setGroupDetailsDateRange(undefined)
        : () => setAccountDetailsDateRange(undefined);
    return <MobileMasterDetailHeaderDateSecondary dateRange={range} onClear={onClear} />;
  }, [isMobile, selected, activeView, accountDetailsDateRange, groupDetailsDateRange]);
  const isSpecialAccountOwner = userIsSpecialAccountOwner(
    String(user?.email || user?.uid || ""),
    company
  );
  const userCanSeeSpecialAccountBalance = useCallback(
    (acc: Account) =>
      userCanViewSpecialAccountBalance(acc, user?.email, isSpecialAccountOwner),
    [isSpecialAccountOwner, user?.email]
  );

   const processedAccountGroups = useMemo(() => {
    const userDefinedGroups = initialProcessedAccountGroups
        .filter((group: any) => {
          if (group.isAutoUngrouped === true) return false;
          if (group.isReportOnly === true || group.isSystemReserved === true) return false;
          if (isSystemParentGroup("account_groups", group.id)) return false;
          return true;
        })
        .map(group => {
        const accountsInGroup = processedAccounts.filter(acc => acc.groupId === group.id);
        const specialInGroup = accountsInGroup.filter((acc) => acc.isSpecial);
        const hasSpecial = specialInGroup.length > 0;
        const balance = accountsInGroup.reduce((sum, acc) => sum + acc.balance, 0);
        const balanceMasked =
          hasSpecial &&
          !specialInGroup.every((acc) => userCanSeeSpecialAccountBalance(acc));
        return { ...group, hasSpecial, balance, balanceMasked };
    });

    return appendMasterEntitySystemBranchGroups(
      userDefinedGroups,
      BANK_ENTITY_GROUP_PRESET,
      companyId || ""
    );
  }, [
    processedAccounts,
    initialProcessedAccountGroups,
    companyId,
    userCanSeeSpecialAccountBalance,
  ]);

  useLiveMasterSelection(selectedGroupRaw, setSelected, processedAccountGroups);
  const selectedGroup = useMemo(
    () =>
      selectedGroupRaw
        ? (resolveMasterEntityGroupForSelection(
            selectedGroupRaw.id,
            processedAccountGroups,
            BANK_ENTITY_GROUP_PRESET,
            companyId || ""
          ) as AccountGroup | null)
        : null,
    [selectedGroupRaw, processedAccountGroups, companyId]
  );

  const mobileBankDetailHeaderEnd = useMemo(() => {
    if (!isMobile || !selected) return null;

    if (activeView !== "groups" && selectedAccount) {
      const account = selectedAccount;
      const name = String(account.accountName || "").trim() || "Account";
      const attachmentUrl = trimEntityFileUrlForPreview((account as any).fileUrl);
      const canEditAccount =
        account.id !== "all" && (!account.isSpecial || can("manage_special_bank_accounts"));
      const hasTransactions = (account.debit ?? 0) !== 0 || (account.credit ?? 0) !== 0;
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            canEditAccount ? (
              <EditAccountDialog
                account={account}
                allAccounts={processedAccounts}
                onAccountUpdated={handleAccountUpdated}
                onAccountDeleted={() => setSelected(null)}
                hasTransactions={hasTransactions}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit account">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditAccountDialog>
            ) : undefined
          }
        />
      );
    }

    if (activeView === "groups" && selectedGroup) {
      const group = selectedGroup;
      const name = String(group.name || "").trim() || "Account";
      const attachmentUrl = trimEntityFileUrlForPreview((group as any).fileUrl);
      const isSystemBranchGroup = isMasterEntitySystemGroupId(BANK_ENTITY_GROUP_PRESET, group.id);
      const hasAccounts =
        processedAccounts.some((a) => a.groupId === group.id) ||
        processedAccountGroups.some((g) => g.parentId === group.id);
      return (
        <MobileMasterDetailHeaderAvatar
          name={name}
          attachmentUrl={attachmentUrl}
          editTrigger={
            !isSystemBranchGroup ? (
              <EditAccountGroupDialog
                group={group}
                allGroups={processedAccountGroups}
                onGroupUpdated={handleAccountGroupUpdated}
                onGroupDeleted={() => setSelected(null)}
                hasAccounts={hasAccounts}
              >
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit group">
                  <Pencil className="h-2.5 w-2.5" aria-hidden />
                </button>
              </EditAccountGroupDialog>
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
    selectedAccount,
    selectedGroup,
    processedAccounts,
    processedAccountGroups,
    can,
    handleAccountUpdated,
    handleAccountGroupUpdated,
    setSelected,
  ]);

  // ========== MEMORY LOGIC ==========
  usePageMemory(
    "bankCashPageState", 
    activeView,               
    setActiveView,            
    selected,                 
    setSelected,              
    activeView === 'groups' ? processedAccountGroups : processedAccounts, 
    vouchersLoading,
    isMobile, // static PC: pehli account auto-select — `useQueryNav` URL sync ke liye alag
    selectedIdFromUrl
  );

  useEffect(() => {
    if (!icSystemEnabled && activeView === "clearing") setActiveView("accounts");
  }, [icSystemEnabled, activeView]);
  // ==================================

  // Clear search when company changes (prevent email/other data from carrying over)
  useEffect(() => {
    setSearchTerm("");
  }, [companyId]);
  useEffect(() => {
    setShowOnlyAccountsWithPendingApproval(false);
    setShowOnlyGroupsWithPendingApproval(false);
  }, [companyId]);
  useEffect(() => {
    if (activeView !== "accounts") setShowOnlyAccountsWithPendingApproval(false);
    if (activeView !== "groups") setShowOnlyGroupsWithPendingApproval(false);
  }, [activeView]);

  const accountsForAccountList = useMemo(() => {
    const source = icSystemEnabled
      ? processedAccounts.filter((a) => a.isClearing !== true)
      : processedAccounts;
    if (!showOnlyAccountsWithPendingApproval || !showApproveOnList) return source;
    return source.filter((a) => (pendingApprovalByAccountId[a.id] ?? 0) > 0);
  }, [icSystemEnabled, processedAccounts, showOnlyAccountsWithPendingApproval, showApproveOnList, pendingApprovalByAccountId]);
  // Clearing tab: sirf bank/cash accounts jinke form me `isClearing` tick hai.
  const clearingAccountsForList = useMemo(() => {
    return processedAccounts.filter((a) => a.isClearing === true);
  }, [processedAccounts]);

  /** Party-style tab switch — set view + row + URL together (EXE/APK stale ?selected= snap-back band). */
  const handleBankCashTabChange = useCallback(
    (value: string) => {
      const tab =
        value === "groups"
          ? "groups"
          : value === "clearing" && icSystemEnabled
            ? "clearing"
            : "accounts";
      const items: (Account | AccountGroup)[] =
        tab === "groups"
          ? processedAccountGroups
          : tab === "clearing"
            ? clearingAccountsForList
            : accountsForAccountList;
      const nextSelected = tabSwitchSelection(
        isMobile,
        pickRememberedListSelection<Account | AccountGroup>("bankCashPageState", tab, items)
      );
      pendingBankSelectIdRef.current = nextSelected?.id ?? null;
      setActiveView(tab);
      setSelected(nextSelected);
      const href = isMobile
        ? masterDetailTabHref("bank-cash", { tab, defaultTab: "accounts", listOnly: true })
        : masterDetailCanonicalHref("bank-cash", {
            tab,
            defaultTab: "accounts",
            selectedId: nextSelected?.id ?? null,
          });
      replaceMasterDetailTabUrl(href, router, useQueryNav);
      writeMasterDetailPageState("bankCashPageState", tab, nextSelected?.id);
    },
    [
      isMobile,
      useQueryNav,
      icSystemEnabled,
      processedAccountGroups,
      clearingAccountsForList,
      accountsForAccountList,
      setActiveView,
      setSelected,
      router,
    ]
  );

  // Header count: `AccountList` jaisa — search + special-account permission
  const filteredAccountListCount = useMemo(() => {
    const canViewSpecialAccount = can("view_special_bank_accounts");
    return accountsForAccountList.filter((account) => {
      if (account.isSpecial && !canViewSpecialAccount) return false;
      const label = bankAccountDisplayName(account);
      return !!(label && masterEntityTextMatchesSearch(label, searchTerm));
    }).length;
  }, [accountsForAccountList, searchTerm, can]);
  const filteredClearingAccountListCount = useMemo(() => {
    const canViewSpecialAccount = can("view_special_bank_accounts");
    return clearingAccountsForList.filter((account) => {
      if (account.isSpecial && !canViewSpecialAccount) return false;
      const label = bankAccountDisplayName(account);
      return !!(label && masterEntityTextMatchesSearch(label, searchTerm));
    }).length;
  }, [clearingAccountsForList, searchTerm, can]);

  // Location-first URL sync (Party jaisa) — stale searchParams.view=groups se Accounts tab mat khicho.
  useEffect(() => {
    if (vouchersLoading) return;
    const { view, selectedId } = readMasterDetailLocationQuery();
    const pendingId = pendingBankSelectIdRef.current;
    if (pendingId) {
      if (selectedId === pendingId) pendingBankSelectIdRef.current = null;
      else if (selected?.id === pendingId) return;
    }

    if (!selectedId) {
      if (view === "groups") {
        if (activeView !== "groups") setActiveView("groups");
      } else if (view === "clearing" && icSystemEnabled) {
        if (activeView !== "clearing") setActiveView("clearing");
      } else if (activeView !== "accounts") {
        setActiveView("accounts");
      }
      return;
    }

    const groupItem = processedAccountGroups.find((i) => i.id === selectedId);
    const accountItem = processedAccounts.find((i) => i.id === selectedId);
    if (view === "groups" && groupItem) setActiveView("groups");
    else if (view === "clearing" && icSystemEnabled && accountItem) setActiveView("clearing");
    else if (view === "accounts" && accountItem) setActiveView("accounts");
    const item =
      groupItem && accountItem
        ? view === "groups"
          ? groupItem
          : accountItem
        : groupItem || accountItem;
    if (item && selected?.id !== item.id) setSelected(item);
    const canonical =
      view === "groups"
        ? `/bank-cash?view=groups&selected=${encodeURIComponent(selectedId)}`
        : view === "clearing" && icSystemEnabled
          ? `/bank-cash?view=clearing&selected=${encodeURIComponent(selectedId)}`
          : `/bank-cash?selected=${encodeURIComponent(selectedId)}`;
    if (shouldReplaceWithMasterDetailCanonical(canonical)) {
      router.replace(canonical, { scroll: false });
    }
  }, [
    selectedIdFromUrl,
    viewFromUrl,
    vouchersLoading,
    processedAccounts,
    processedAccountGroups,
    selected?.id,
    activeView,
    setSelected,
    setActiveView,
    router,
    icSystemEnabled,
  ]);
  
  // Initial Mount Safety
  useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
    }
  }, []);
  
  const totalBalance = useMemo(() => {
    if (activeView !== 'groups') {
        const accountsToSum = processedAccounts.filter(
          (acc) => !acc.isSpecial || userCanSeeSpecialAccountBalance(acc)
        );
        return accountsToSum.reduce((acc, account) => acc + account.balance, 0);
    } 
    // activeView === 'groups'
    return processedAccountGroups
      .filter((g) => {
        const anyG = g as AccountGroup & { isSystemReserved?: boolean; balanceMasked?: boolean };
        const isSystemParent =
          anyG.isSystemReserved === true ||
          isSystemParentGroup("account_groups", anyG.id);
        return !anyG.balanceMasked && !isSystemParent;
      })
      .reduce((acc, group) => acc + group.balance, 0);
  }, [activeView, processedAccounts, processedAccountGroups, userCanSeeSpecialAccountBalance]);

  const displayTotalBalance = useMemo(() => {
    if (activeView === "groups") return totalBalance;
    return flipLedgerSignedBalance(totalBalance, bankDrCrPerspective);
  }, [activeView, totalBalance, bankDrCrPerspective]);

  const handleSelect = useCallback((item: Account | AccountGroup, options?: GroupListSelectOptions) => {
    // Party/Staff jaisa: turant select + location replaceState —
    // warna stale ?selected= / URL effect click ke baad purane account pe snap-back karta hai (refresh pe).
    pendingBankSelectIdRef.current = item.id;
    setSelected(item);
    const isGroup = !("accountName" in item);
    if (isGroup) {
      setGroupMemberFilterId(options?.memberId ?? null);
    } else {
      setGroupMemberFilterId(null);
    }
    const path = isGroup
      ? `/bank-cash?view=groups&selected=${encodeURIComponent(item.id)}`
      : activeView === "clearing"
        ? `/bank-cash?view=clearing&selected=${encodeURIComponent(item.id)}`
        : `/bank-cash?selected=${encodeURIComponent(item.id)}`;
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
  }, [useQueryNav, router, setSelected, activeView]);

  /** Stable href — har render naya inline fn list ko re-mount kara ref loop */
  const getAccountItemHref = useCallback(
    (a: Account) => `/bank-cash?selected=${a.id}`,
    []
  );
  const getGroupItemHref = useCallback(
    (g: AccountGroup) => `/bank-cash?view=groups&selected=${g.id}`,
    []
  );
  
  const accountsForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    return filterMembersByMasterGroupScope<Account>(
      selectedGroup.id,
      processedAccounts,
      processedAccountGroups,
      resolveBankListGroupBucketId,
      (id) => isMasterEntitySystemGroupId(BANK_ENTITY_GROUP_PRESET, id),
      (account, branchId) => resolveBankListGroupBucketId(account) === branchId
    );
  }, [selectedGroup, processedAccounts, processedAccountGroups]);

  const accountsForGroupDetails = useMemo(() => {
    if (!groupMemberFilterId) return accountsForSelectedGroup;
    return accountsForSelectedGroup.filter((a) => a.id === groupMemberFilterId);
  }, [accountsForSelectedGroup, groupMemberFilterId]);

  const processedAccountGroupsForList = useMemo(() => {
    if (!showOnlyGroupsWithPendingApproval || !showApproveOnList) return processedAccountGroups;
    return processedAccountGroups.filter((g) => (pendingApprovalByAccountGroupId[g.id] ?? 0) > 0);
  }, [
    processedAccountGroups,
    showOnlyGroupsWithPendingApproval,
    showApproveOnList,
    pendingApprovalByAccountGroupId,
  ]);

  const accountGroupMembersByGroupId = useMemo(() => {
    const map: Record<string, Account[]> = {};
    for (const acc of processedAccounts) {
      const bucket = resolveBankListGroupBucketId(acc);
      if (!map[bucket]) map[bucket] = [];
      map[bucket].push(acc);
    }
    return map;
  }, [processedAccounts]);

  const accountGroupMembersForSearch = useMemo(() => {
    const out: Record<string, { name?: string }[]> = {};
    for (const [groupId, members] of Object.entries(accountGroupMembersByGroupId)) {
      out[groupId] = members.map((member) => ({ name: bankAccountDisplayName(member) }));
    }
    return out;
  }, [accountGroupMembersByGroupId]);

  const filteredGroupCount = useMemo(() => {
    return computeMasterGroupListSearchVisibleCount({
      groups: processedAccountGroupsForList || [],
      config: BANK_ACCOUNT_GROUP_LIST_CONFIG,
      searchTerm,
      quickFilter: groupListQuickFilter,
      groupMembersByGroupId: accountGroupMembersForSearch,
      visibleGroupFilter: (g) => {
        const anyG = g as { isReportOnly?: boolean; isSystemReserved?: boolean };
        if (anyG.isReportOnly === true) return false;
        if (anyG.isSystemReserved === true || isSystemParentGroup("account_groups", g.id)) return false;
        return !!g.name;
      },
    });
  }, [
    processedAccountGroupsForList,
    searchTerm,
    groupListQuickFilter,
    accountGroupMembersForSearch,
  ]);

  const handleMoveAccountToGroup = useCallback(
    (account: Account, targetGroupId: string) =>
      createMasterEntityGroupMoveHandler({
        companyId,
        company,
        groupsForName: processedAccountGroups,
        moveHelpers: bankGroupAccountMove,
        entityLabel: "Account",
      })(account, targetGroupId),
    [companyId, company, processedAccountGroups]
  );

  const handleMoveAccountGroupToGroup = useCallback(
    (sourceGroupId: string, targetGroupId: string) =>
      createMasterEntityGroupTreeMoveHandler({
        companyId,
        company,
        groupsForName: processedAccountGroups,
        allGroups: initialProcessedAccountGroups,
        config: BANK_ACCOUNT_GROUP_LIST_CONFIG,
        moveHelpers: bankGroupTreeMove,
      })(sourceGroupId, targetGroupId),
    [companyId, company, processedAccountGroups, initialProcessedAccountGroups]
  );

  if (pageColdLoading) {
    return <LoadingSpinner />;
  }
  
  if (!companyId) {
    return (
         <div className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8 h-full">
            <Card className="w-full max-w-md text-center">
                <CardHeader>
                    <CardTitle>No Company Selected</CardTitle>
                    <CardDescription>
                        Please select a company to view bank & cash data.
                    </CardDescription>
                </CardHeader>
            </Card>
        </div>
    );
  }
  
  const bankTabsEl = (
    <Tabs value={activeView} onValueChange={handleBankCashTabChange} className="w-full">
      <TabsList listChrome>
        <TabsTrigger listChrome value="accounts" className="flex-1">Accounts</TabsTrigger>
        <TabsTrigger listChrome value="groups" className="flex-1">Groups</TabsTrigger>
        {icSystemEnabled ? (
          <TabsTrigger listChrome value="clearing" className="flex-1">Clearing A/c</TabsTrigger>
        ) : null}
      </TabsList>
    </Tabs>
  );

  const bankSearchRowEl = (
    <div className={mlc.searchRow}>
      <div className={mlc.searchWrap}>
        <Search className={mlc.searchIcon} />
        <Input placeholder={activeView === 'groups' ? 'Search groups/account' : 'Search accounts...'} listChrome listChromeSearch value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoComplete="off" />
      </div>
      {activeView === "accounts" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyAccountsWithPendingApproval}
          onToggle={() => setShowOnlyAccountsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only accounts with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all accounts (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all accounts"
        />
      ) : null}
      {activeView === "groups" && showApproveOnList && totalPendingApprovalVoucherCount > 0 ? (
        <PendingApprovalListFilterBadge compact
          count={totalPendingApprovalVoucherCount}
          pressed={showOnlyGroupsWithPendingApproval}
          onToggle={() => setShowOnlyGroupsWithPendingApproval((v) => !v)}
          tooltipFilterHint={`Only groups with pending approval — ${totalPendingApprovalVoucherCount} voucher(s) (click)`}
          tooltipShowAllHint="Show all groups (click)"
          ariaLabelFilter={`Filter ${totalPendingApprovalVoucherCount} pending approval vouchers`}
          ariaLabelShowAll="Show all groups"
        />
      ) : null}
      {activeView === "groups" ? (
        <CreateAccountGroupDialog onGroupCreated={(id) => handleSelect({ id, name: "" } as AccountGroup)} groups={processedAccountGroups} isOpen={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateGroupOpen(true)}>
            + Add Group
          </PermissionButton>
        </CreateAccountGroupDialog>
      ) : (
        <CreateBankAccountDialog onAccountCreated={(id) => handleSelect({ id, accountName: "" } as Account)} isOpen={isCreateAccountOpen} onOpenChange={setIsCreateAccountOpen}>
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => setIsCreateAccountOpen(true)}>
            + Add Account
          </PermissionButton>
        </CreateBankAccountDialog>
      )}
    </div>
  );

  const bankSectionLabelEl =
    activeView === "accounts" ? (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Landmark className={mlc.sectionIcon} />
          <span>Accounts ({filteredAccountListCount})</span>
        </div>
      </div>
    ) : activeView === "clearing" ? (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Landmark className={mlc.sectionIcon} />
          <span>Clearing A/c ({filteredClearingAccountListCount})</span>
        </div>
      </div>
    ) : (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <Landmark className={mlc.sectionIcon} />
        <span>Groups ({filteredGroupCount})</span>
      </div>
    );

  const listView = (
    <MasterListViewShell
      isMobile={isMobile}
      searchRow={bankSearchRowEl}
      sectionLabel={bankSectionLabelEl}
      tabs={bankTabsEl}
      quickFilter={activeView === "groups" ? groupListQuickFilter : accountListQuickFilter}
      onQuickFilterChange={activeView === "groups" ? setGroupListQuickFilter : setAccountListQuickFilter}
    >
      {activeView === "accounts" ? (
        <AccountList
          accounts={accountsForAccountList}
          onSelectAccount={handleSelect as any}
          selectedAccount={selectedAccount}
          searchTerm={searchTerm}
          pendingApprovalByAccountId={pendingApprovalByAccountId}
          getItemHref={useQueryNav ? getAccountItemHref : undefined}
          quickFilter={accountListQuickFilter}
          onQuickFilterChange={setAccountListQuickFilter}
          hideQuickFilterBar
        />
      ) : activeView === "clearing" ? (
        <AccountList
          accounts={clearingAccountsForList}
          onSelectAccount={handleSelect as any}
          selectedAccount={selectedAccount}
          searchTerm={searchTerm}
          pendingApprovalByAccountId={pendingApprovalByAccountId}
          getItemHref={useQueryNav ? getAccountItemHref : undefined}
          quickFilter={accountListQuickFilter}
          onQuickFilterChange={setAccountListQuickFilter}
          hideQuickFilterBar
        />
      ) : (
        <AccountGroupList
          groups={processedAccountGroupsForList}
          onSelectGroup={handleSelect as any}
          selectedGroup={selectedGroup}
          searchTerm={searchTerm}
          pendingApprovalByGroupId={pendingApprovalByAccountGroupId}
          pendingApprovalByMemberId={pendingApprovalByAccountId}
          groupMembersByGroupId={accountGroupMembersByGroupId}
          selectedGroupMemberFilterId={groupMemberFilterId}
          getItemHref={useQueryNav ? getGroupItemHref : undefined}
          quickFilter={groupListQuickFilter}
          onQuickFilterChange={setGroupListQuickFilter}
          hideQuickFilterBar
          moveAccountsEnabled={!!companyId}
          onMoveAccountToGroup={handleMoveAccountToGroup}
          canMoveMember={bankGroupAccountMove.canMoveAccount}
          onMoveGroupToGroup={handleMoveAccountGroupToGroup}
          canMoveGroup={bankGroupTreeMove.canMoveGroup}
          allGroupsForMove={initialProcessedAccountGroups}
        />
      )}
    </MasterListViewShell>
  );

  const detailView = (
    <>
      {activeView !== 'groups' && selectedAccount && (
        <AccountDetails 
            account={selectedAccount} 
            allAccounts={processedAccounts}
            onAccountUpdated={handleAccountUpdated}
            onAccountDeleted={() => setSelected(null)} 
            dateRange={accountDetailsDateRange}
            onDateRangeChange={setAccountDetailsDateRange}
            userNames={userNames}
            onMobileVoucherListStatsChange={isMobile ? setBankMobileVoucherStats : undefined}
            hideMobilePeriodLabelRow={isMobile}
          />
      )}
      {activeView === 'groups' && selectedGroup && (
        <AccountGroupDetails
          key={`${selectedGroup.id}:${groupMemberFilterId ?? "all"}`}
          group={selectedGroup}
          allGroups={processedAccountGroups}
          accounts={accountsForGroupDetails}
          groupMemberFilterId={groupMemberFilterId}
          onGroupUpdated={() => {}}
          onGroupDeleted={() => setSelected(null)}
          onAccountUpdated={handleAccountUpdated}
          dateRange={groupDetailsDateRange}
          onDateRangeChange={setGroupDetailsDateRange}
          userNames={userNames}
          hideMobilePeriodLabelRow={isMobile}
        />
      )}
      {!selected && <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>}
    </>
  );

  return (
    <ResponsiveMasterDetail
      title={bankShellTitle}
      mobileSelectionLabel={mobileBankCashSelectionLabel}
      mobileSelectionLabelClassName={mobileBankCashSelectionLabelClassName}
      mobileDetailHeaderEnd={mobileBankDetailHeaderEnd}
      mobileDetailHeaderSecondary={mobileBankHeaderSecondary}
      balance={
        <span className={cn(
            "font-semibold",
            // >= 0 (Debit/Bank) Green, < 0 (Credit/Overdraft) Red
            displayTotalBalance >= 0 ? "text-green-600" : "text-red-600"
        )}>
            {formatRunning(displayTotalBalance)}
        </span>
      }
      tabs={isMobile ? undefined : bankTabsEl}
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

export default function BankCashPage() {
  return (
    // Keep useSearchParams consumer behind Suspense for Next.js static prerender compatibility.
    <Suspense fallback={<LoadingSpinner />}>
      <BankCashPageContent />
    </Suspense>
  );
}

    
