"use client";

import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StaffEntityNavIcon } from "@/components/entity/StaffEntityIcon";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { mlc } from "@/lib/mobileListChrome";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DateRange } from "@/components/ui/ad-calendar";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { PermissionButton } from "@/components/permission";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { type EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { resolveMasterListSelection } from "@/lib/masterEntityLiveUpdate";
import { masterEntityTextMatchesSearch } from "@/lib/filterMasterEntityListRows";
import { createMasterEntityGroupMoveHandler } from "@/lib/createMasterEntityGroupMoveHandler";
import { createMasterEntityGroupTreeMoveHandler } from "@/lib/createMasterEntityGroupTreeMoveHandler";
import { staffGroupAccountMove } from "@/lib/masterEntityGroupAccountMove";
import { staffGroupTreeMove } from "@/lib/masterEntityGroupTreeMoveHelpers";
import { LOAN_ACCOUNT_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import type { Staff, StaffGroup } from "@/components/staff/types";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { isLoanLiabilityStaff } from "../utils/loanLiabilityStaff";
import { LOAN_LIABILITY_GROUP_ID } from "../constants/loanConstants";
import { findLoanForAccount } from "../db/loanQueries";
import type { Loan, LoanDraftInput } from "../types/loanTypes";
import { resolveLoanAccountAvatarUrl } from "../utils/resolveLoanAccountAvatarUrl";
import { buildLoanGroupTree, loanAccountsForGroupSelection } from "../utils/loanGroupTree";
import { LoanAccountList } from "./LoanAccountList";
import { LoanAccountGroupList } from "./LoanAccountGroupList";
import { LoanWorkspaceDetails } from "./LoanWorkspaceDetails";
import { LoanStaffNavTitle } from "@/components/layout/LoanStaffNavTitle";
import { ReportShowListButton } from "@/components/reports/ReportShowListButton";

export type LoanOverviewChromeMode = "entityNav" | "reports";

export function LoanOverviewMasterDetail({
  loans,
  selectedId,
  activeView,
  onSelectAccountId,
  onCreate,
  onReloadList,
  chromeMode = "entityNav",
  loansHydrated = true,
}: {
  loans: Loan[];
  selectedId?: string | null;
  activeView: "accounts" | "groups";
  onSelectAccountId: (accountId: string | null, tab?: "accounts" | "groups") => void;
  onCreate: (initial?: Partial<LoanDraftInput>) => void;
  onReloadList?: () => Promise<void> | void;
  /** `reports` = embedded in Reports hub (no `/loans` sidebar highlight). */
  chromeMode?: LoanOverviewChromeMode;
  /** False while loan SQLite list is still loading — avoid false "Create Loan" empty state. */
  loansHydrated?: boolean;
}) {
  const effectiveActiveView: "accounts" | "groups" = activeView;
  const { formatCurrencyForPrint } = useDate();
  const isMobile = useIsMobile();
  const { companyId, company } = useCompany();
  const {
    loading: vouchersLoading,
    processedStaff,
    processedStaffGroups,
    processedAccounts,
    userNames,
    patchMasterEntity,
  } = useVouchers();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [accountListQuickFilter, setAccountListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupListQuickFilter, setGroupListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [groupMemberFilterId, setGroupMemberFilterId] = useState<string | null>(null);

  const loanAccounts = useMemo(
    () => (processedStaff || []).filter((row) => isLoanLiabilityStaff(row)),
    [processedStaff]
  );

  const loanAccountsForList = useMemo(
    () =>
      loanAccounts.map((acc) => {
        const linkedLoan = findLoanForAccount(loans, acc.id, acc);
        const avatar = resolveLoanAccountAvatarUrl(acc, linkedLoan, processedAccounts);
        return avatar ? { ...acc, fileUrl: avatar } : acc;
      }),
    [loanAccounts, loans, processedAccounts]
  );

  const loanGroupTree = useMemo(
    () =>
      buildLoanGroupTree({
        loanAccounts: loanAccountsForList,
        staffGroups: processedStaffGroups || [],
        companyId: companyId || "",
      }),
    [loanAccountsForList, processedStaffGroups, companyId]
  );

  const loanGroups = loanGroupTree.allGroups;

  const selected = useMemo(() => {
    const list = effectiveActiveView === "accounts" ? loanAccounts : loanGroups;
    if (selectedId) {
      return list.find((row) => row.id === selectedId) || loanAccounts.find((row) => row.id === selectedId) || null;
    }
    if (!isMobile && effectiveActiveView === "groups") return loanGroupTree.systemGroup;
    if (!isMobile && list.length > 0) return list[0]!;
    return null;
  }, [selectedId, effectiveActiveView, loanAccounts, loanGroups, loanGroupTree.systemGroup, isMobile]);

  const selectedAccountRaw = effectiveActiveView === "accounts" ? (selected as Staff | null) : null;
  const selectedAccount = useMemo(
    () => resolveMasterListSelection(selectedAccountRaw, loanAccounts),
    [selectedAccountRaw, loanAccounts]
  );
  const selectedGroup = effectiveActiveView === "groups" ? (selected as StaffGroup | null) : null;

  const totalBalance = useMemo(() => {
    return loanAccounts.reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
  }, [loanAccounts]);

  const filteredAccountCount = useMemo(
    () => loanAccounts.filter((a) => a.name && masterEntityTextMatchesSearch(a.name, searchTerm)).length,
    [loanAccounts, searchTerm]
  );
  const filteredGroupCount = useMemo(() => {
    const q = searchTerm.trim();
    if (!q) return Math.max(1, loanGroupTree.childGroups.length || 1);
    const childMatches = loanGroupTree.childGroups.filter((g) =>
      masterEntityTextMatchesSearch(g.name, searchTerm)
    ).length;
    return childMatches > 0 ? childMatches : masterEntityTextMatchesSearch(loanGroupTree.systemGroup.name, searchTerm) ? 1 : 0;
  }, [loanGroupTree, searchTerm]);

  const accountsForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    return loanAccountsForGroupSelection(selectedGroup.id, loanAccountsForList, loanGroupTree);
  }, [selectedGroup, loanAccountsForList, loanGroupTree]);

  const groupMembersByGroupId = loanGroupTree.groupMembersByGroupId;

  const handleMoveLoanAccountToGroup = useCallback(
    (staff: Staff, targetGroupId: string) =>
      createMasterEntityGroupMoveHandler({
        companyId,
        company,
        groupsForName: loanGroupTree.allGroups,
        moveHelpers: staffGroupAccountMove,
        entityLabel: "Account",
      })(staff, targetGroupId),
    [companyId, company, loanGroupTree.allGroups]
  );

  const handleMoveLoanGroupToGroup = useCallback(
    (sourceGroupId: string, targetGroupId: string) =>
      createMasterEntityGroupTreeMoveHandler({
        companyId,
        company,
        groupsForName: loanGroupTree.allGroups,
        allGroups: processedStaffGroups || [],
        config: LOAN_ACCOUNT_GROUP_LIST_CONFIG,
        moveHelpers: staffGroupTreeMove,
      })(sourceGroupId, targetGroupId),
    [companyId, company, loanGroupTree.allGroups, processedStaffGroups]
  );

  const handleSelectAccount = useCallback(
    (account: Staff) => {
      setGroupMemberFilterId(null);
      onSelectAccountId(account.id, "accounts");
    },
    [onSelectAccountId]
  );

  const handleSelectGroup = useCallback(
    (group: StaffGroup, options?: GroupListSelectOptions) => {
      setGroupMemberFilterId(options?.memberId ?? null);
      onSelectAccountId(group.id, "groups");
    },
    [onSelectAccountId]
  );

  const handleTabChange = (next: string) => {
    const tab = next === "groups" ? "groups" : "accounts";
    setGroupMemberFilterId(null);
    setSearchTerm("");
    const list = tab === "groups" ? loanGroups : loanAccounts;
    const first =
      !isMobile && list.length > 0
        ? tab === "groups"
          ? LOAN_LIABILITY_GROUP_ID
          : list[0]!.id
        : null;
    onSelectAccountId(first, tab);
  };

  const handleStaffUpdated = useCallback(
    (accountId: string, updated?: Partial<Staff>) => {
      const id = String(updated?.id || accountId || "").trim();
      if (!id) return;
      patchMasterEntity("staff", id, (updated || {}) as Record<string, unknown>);
    },
    [patchMasterEntity]
  );

  const handleStaffDeleted = useCallback(
    (deletedId: string) => {
      if (!deletedId) return;
      if (selectedAccount?.id === deletedId || groupMemberFilterId === deletedId) {
        setGroupMemberFilterId(null);
        onSelectAccountId(null, effectiveActiveView);
      }
    },
    [selectedAccount?.id, groupMemberFilterId, onSelectAccountId, effectiveActiveView]
  );

  const linkedLoan = findLoanForAccount(loans, selectedAccount?.id, selectedAccount);
  const detailAccount = groupMemberFilterId
    ? loanAccounts.find((a) => a.id === groupMemberFilterId) || null
    : selectedAccount;
  const groupMemberLoan = findLoanForAccount(loans, detailAccount?.id, detailAccount);

  if (vouchersLoading && loanAccounts.length === 0) {
    return <LoadingSpinner />;
  }

  const loanTabsEl = (
    <Tabs value={effectiveActiveView} onValueChange={handleTabChange} className="w-full">
      <TabsList listChrome>
        <TabsTrigger listChrome value="accounts" className="flex-1">
          Accounts
        </TabsTrigger>
        <TabsTrigger listChrome value="groups" className="flex-1">
          Groups
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const searchRowEl = (
    <div className={mlc.searchRow}>
      <div className={mlc.searchWrap}>
        <Search className={mlc.searchIcon} />
        <Input
          placeholder={effectiveActiveView === "groups" ? "Search groups/account" : "Search accounts..."}
          listChrome
          listChromeSearch
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {effectiveActiveView === "accounts" ? (
        <div className="flex shrink-0 items-center gap-1">
          <PermissionButton permission="create_records" variant="chromePill" size="list" onClick={() => onCreate()}>
            + Add Account
          </PermissionButton>
        </div>
      ) : null}
    </div>
  );

  const actionRowEl = undefined;

  const sectionLabelEl =
    effectiveActiveView === "accounts" ? (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <StaffEntityNavIcon className={mlc.sectionIcon} />
        <span>Accounts ({filteredAccountCount})</span>
      </div>
    ) : (
      <div className={cn(mlc.sectionLabelRow, isMobile && "px-[2px]")}>
        <StaffEntityNavIcon className={mlc.sectionIcon} />
        <span>Groups ({filteredGroupCount})</span>
      </div>
    );

  const listView = (
    <MasterListViewShell
      isMobile={isMobile}
      searchRow={searchRowEl}
      actionRow={actionRowEl}
      sectionLabel={sectionLabelEl}
      tabs={loanTabsEl}
      quickFilter={effectiveActiveView === "groups" ? groupListQuickFilter : accountListQuickFilter}
      onQuickFilterChange={effectiveActiveView === "groups" ? setGroupListQuickFilter : setAccountListQuickFilter}
    >
      {effectiveActiveView === "accounts" ? (
        <LoanAccountList
          accounts={loanAccountsForList}
          loans={loans}
          onSelectAccount={handleSelectAccount}
          selectedAccount={selectedAccount}
          searchTerm={searchTerm}
          quickFilter={accountListQuickFilter}
          onQuickFilterChange={setAccountListQuickFilter}
          hideQuickFilterBar
        />
      ) : (
        <LoanAccountGroupList
          systemGroup={loanGroupTree.systemGroup}
          childGroups={loanGroupTree.childGroups}
          groupMembersByGroupId={groupMembersByGroupId}
          loans={loans}
          bankAccounts={processedAccounts || []}
          onSelectGroup={handleSelectGroup}
          selectedGroup={selectedGroup}
          searchTerm={searchTerm}
          selectedGroupMemberFilterId={groupMemberFilterId}
          quickFilter={groupListQuickFilter}
          onQuickFilterChange={setGroupListQuickFilter}
          hideQuickFilterBar
          moveAccountsEnabled={!!companyId}
          onMoveAccountToGroup={handleMoveLoanAccountToGroup}
          canMoveMember={staffGroupAccountMove.canMoveAccount}
          onMoveGroupToGroup={handleMoveLoanGroupToGroup}
          canMoveGroup={staffGroupTreeMove.canMoveGroup}
          allGroupsForMove={processedStaffGroups || []}
        />
      )}
    </MasterListViewShell>
  );

  /** List account is a staff loan-liability row; SQLite loan doc may be missing — still show profile/ledger. */
  const unlinkedLoanAccountDetails = (account: Staff) => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Loan EMI record not found. Edit or delete this account from the profile, or create a loan.
        </p>
        <PermissionButton
          permission="create_records"
          variant="chromePill"
          size="list"
          onClick={() =>
            onCreate({
              loanName: account.name,
              loanAccountId: account.id,
              createLoanAccount: false,
            })
          }
        >
          Create Loan
        </PermissionButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <StaffDetails
          key={`loan-staff-${account.id}`}
          staff={account}
          allStaff={processedStaff}
          allGroups={processedStaffGroups}
          onStaffUpdated={(updated) => handleStaffUpdated(account.id, updated)}
          onStaffDeleted={handleStaffDeleted}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          userNames={userNames}
          mobileFooterVariant={chromeMode === "reports" ? "report" : "ledger"}
        />
      </div>
    </div>
  );

  const detailView = (
    <>
      {effectiveActiveView === "accounts" && selectedAccount ? (
        !loansHydrated ? (
          <div className="flex h-full min-h-0 items-center justify-center p-6">
            <LoadingSpinner />
          </div>
        ) : linkedLoan ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <LoanWorkspaceDetails loanId={linkedLoan.id} onReloadList={onReloadList} />
          </div>
        ) : (
          unlinkedLoanAccountDetails(selectedAccount)
        )
      ) : null}
      {effectiveActiveView === "groups" && selectedGroup ? (
        groupMemberFilterId && detailAccount ? (
          !loansHydrated ? (
            <div className="flex h-full min-h-0 items-center justify-center p-6">
              <LoadingSpinner />
            </div>
          ) : groupMemberLoan ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <LoanWorkspaceDetails loanId={groupMemberLoan.id} onReloadList={onReloadList} />
            </div>
          ) : (
            unlinkedLoanAccountDetails(detailAccount)
          )
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-4 py-3">
              <h2 className="text-base font-semibold">{selectedGroup.name}</h2>
              <p className="text-xs text-muted-foreground">
                {accountsForSelectedGroup.length} account{accountsForSelectedGroup.length === 1 ? "" : "s"}
              </p>
            </div>
            <LoanAccountList
              accounts={accountsForSelectedGroup}
              selectedAccount={null}
              onSelectAccount={(account) => {
                handleSelectAccount(account);
              }}
              searchTerm=""
              hideQuickFilterBar
            />
          </div>
        )
      ) : null}
      {!selected && (
        <div className="p-6 text-center text-muted-foreground">Select an item to see details</div>
      )}
    </>
  );

  const loanOverviewTitleEl =
    chromeMode === "reports" ? (
      <span className="text-xs font-bold leading-snug">Loan Overview</span>
    ) : (
      <LoanStaffNavTitle active="loans" />
    );

  return (
      <ResponsiveMasterDetail
        title={loanOverviewTitleEl}
        balance={formatCurrencyForPrint(totalBalance, { showDrCr: true })}
        listHeaderLeading={chromeMode === "reports" ? <ReportShowListButton /> : undefined}
        tabs={isMobile ? undefined : loanTabsEl}
        mobileTabsDocked={isMobile}
        listView={listView}
        detailView={detailView}
        isMobile={isMobile}
        mobileListOnly
        hasSelectedItem={!!selected}
        onBackToList={() => {
          setGroupMemberFilterId(null);
          onSelectAccountId(null, effectiveActiveView);
        }}
        mobileListSelectionKey={
          selected
            ? `${selected.id}:${effectiveActiveView === "groups" ? groupMemberFilterId ?? "" : ""}`
            : null
        }
        mobileSelectionLabel={
          effectiveActiveView === "groups"
            ? selectedGroup?.name
            : selectedAccount?.name
        }
        mobileSelectionLabelClassName={
          selected
            ? masterDetailBalanceToneClass((selected as Staff | StaffGroup).balance)
            : undefined
        }
      />
  );
}
