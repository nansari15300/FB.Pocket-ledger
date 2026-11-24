"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Landmark, PlusCircle } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { AccountDetails } from "@/components/bank-cash/AccountDetails";
import { AccountList } from "@/components/bank-cash/AccountList";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { useReportShowApproveOnList } from "@/components/reports/ReportListParityChrome";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParams } from "next/navigation";

type JournalAccount = {
  id: string;
  accountName: string;
  accountType: string;
  balance: number;
  openingBalance?: number;
  [key: string]: any;
};

export function JournalReportDetail() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const showApproveOnList = useReportShowApproveOnList();
  const {
    vouchers: allVouchers,
    loading: vouchersLoading,
    processedAccounts,
    processedParties,
    processedStaff,
    processedTaxes,
    expenseAccounts: unprocessedExpenseAccounts,
  } = useFyScopedVouchers();
  const [selectedAccount, setSelectedAccount] = useState<JournalAccount | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [accountListQuickFilter, setAccountListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const [showOnlyUnapproved, setShowOnlyUnapproved] = useState(false);
  const hasAutoSelected = useRef(false);

  const journalVouchers = useMemo(
    () => allVouchers.filter((v) => v.type === "journal" && v.subType !== "add_salary"),
    [allVouchers]
  );
  const isJournalVoucher = useCallback(
    (transaction: any) => transaction?.type === "journal" && transaction?.subType !== "add_salary",
    []
  );
  const accountIdValue = useCallback((value: unknown) => {
    if (value && typeof value === "object" && "id" in value) {
      return String((value as { id?: unknown }).id ?? "").trim();
    }
    return String(value ?? "").trim();
  }, []);

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    try {
      const userDoc = await getDoc(doc(firestore, "users", userId));
      if (userDoc.exists()) {
        return userDoc.data().displayName || userDoc.data().email || "Unknown";
      }
    } catch (_) {}
    return "Unknown";
  }, []);

  useEffect(() => {
    const uids = new Set(allVouchers.map((t) => t.userId).filter(Boolean) as string[]);
    uids.forEach(async (uid) => {
      if (!userNames[uid]) {
        const name = await fetchUserName(uid);
        setUserNames((prev) => ({ ...prev, [uid]: name }));
      }
    });
  }, [allVouchers, userNames, fetchUserName]);

  const allAccounts = useMemo(() => {
    const accounts: JournalAccount[] = [];
    processedParties.forEach((p) => accounts.push({ ...p, id: p.id, accountName: p.name, accountType: "Party" }));
    processedStaff.forEach((s) => accounts.push({ ...s, id: s.id, accountName: s.name, accountType: "Staff" }));
    processedAccounts.forEach((a) => accounts.push({ ...a, id: a.id, accountName: a.accountName, accountType: a.accountType }));
    processedTaxes.forEach((t) => accounts.push({ ...t, id: t.id, accountName: t.name, accountType: "Tax" }));
    unprocessedExpenseAccounts.forEach((e) => accounts.push({ ...e, id: e.id, accountName: e.name, accountType: "Expense" }));
    return accounts;
  }, [processedParties, processedStaff, processedAccounts, processedTaxes, unprocessedExpenseAccounts]);

  const accountsWithJournal = useMemo(() => {
    if (vouchersLoading || journalVouchers.length === 0) return [];
    const accountIds = new Set<string>();
    journalVouchers.forEach((v) => {
      for (const entry of [...(v.entries || []), ...(v.lines || [])] as any[]) {
        const id = accountIdValue(entry.accountId);
        if (id) accountIds.add(id);
      }
    });
    return allAccounts.filter((p) => accountIds.has(p.id));
  }, [journalVouchers, allAccounts, vouchersLoading, accountIdValue]);

  const totalJournalAmount = useMemo(
    () => journalVouchers.reduce((sum, v) => sum + (v.total || 0), 0),
    [journalVouchers]
  );

  const accountTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    return journalVouchers.filter((v) =>
      [...(v.entries || []), ...(v.lines || [])].some(
        (entry: any) => accountIdValue(entry.accountId) === selectedAccount.id
      )
    );
  }, [journalVouchers, selectedAccount, accountIdValue]);

  const allJournalAccount = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    return {
      id: "all",
      accountName: "All Journal Vouchers",
      balance: 0,
      openingBalance: 0,
      accountType: "journal_view",
    } as unknown as JournalAccount;
  }, [showAllCompanyVouchers]);

  const currentAccount = showAllCompanyVouchers ? allJournalAccount : selectedAccount;
  const currentTransactions = showAllCompanyVouchers ? journalVouchers : accountTransactions;

  const unapprovedJournalByAccount = useMemo(() => {
    const accountIds = new Set(accountsWithJournal.map((account) => account.id));
    const touchedAccountIds = new Set<string>();
    const byAccountId: Record<string, number> = {};
    let voucherCount = 0;
    if (!showApproveOnList || accountIds.size === 0) {
      return { accountIds: touchedAccountIds, byAccountId, voucherCount };
    }
    for (const voucher of journalVouchers as any[]) {
      if (voucher?.isApproved === true) continue;
      const voucherAccountIds = new Set<string>();
      for (const entry of [...(voucher.entries || []), ...(voucher.lines || [])]) {
        const id = accountIdValue(entry?.accountId);
        if (id && accountIds.has(id)) voucherAccountIds.add(id);
      }
      if (!voucherAccountIds.size) continue;
      voucherCount += 1;
      voucherAccountIds.forEach((id) => {
        touchedAccountIds.add(id);
        byAccountId[id] = (byAccountId[id] ?? 0) + 1;
      });
    }
    return { accountIds: touchedAccountIds, byAccountId, voucherCount };
  }, [accountIdValue, accountsWithJournal, journalVouchers, showApproveOnList]);

  const filteredAccounts = useMemo(
    () => accountsWithJournal.filter(
      (account) =>
        (!showOnlyUnapproved || unapprovedJournalByAccount.accountIds.has(account.id)) &&
        account.accountName.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [accountsWithJournal, searchTerm, showOnlyUnapproved, unapprovedJournalByAccount.accountIds]
  );

  useEffect(() => {
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllCompanyVouchers(true);
        setSelectedAccount(null);
      }
      return;
    }
    if (accountsWithJournal.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    // Default to the report-wide ledger so journal vouchers from every entity are visible.
    setShowAllCompanyVouchers(true);
    setSelectedAccount(null);
  }, [accountsWithJournal, isMobile, searchParams]);

  const handleSelectAccount = useCallback((account: JournalAccount) => {
    setShowAllCompanyVouchers(false);
    setSelectedAccount(account);
  }, []);

  if (vouchersLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  // Mobile: show list first, then details when selected (like party page)
  if (isMobile) {
    if (currentAccount) {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AccountDetails
            account={currentAccount as any}
            allAccounts={allAccounts as any}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => {
              setSelectedAccount(null);
              setShowAllCompanyVouchers(false);
            }}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={userNames}
            reportTransactionFilter={isJournalVoucher}
            onBack={() => {
              setSelectedAccount(null);
              setShowAllCompanyVouchers(false);
            }}
          />
          </div>
        </div>
      );
    }
    return (
      <ReportRegisterMobileListChrome
        title="Journals"
        actionSlot={
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="chromePill"
                size="list"
                onClick={() => setShowAllCompanyVouchers(true)}
              >
                All Journals
              </Button>
              {showApproveOnList ? (
                <PendingApprovalListFilterBadge
                  compact
                  count={unapprovedJournalByAccount.voucherCount}
                  pressed={showOnlyUnapproved}
                  onToggle={() => setShowOnlyUnapproved((value) => !value)}
                  tooltipFilterHint={`Only accounts with unapproved journal vouchers - ${unapprovedJournalByAccount.voucherCount} voucher(s) (click)`}
                  tooltipShowAllHint="Show all journal accounts (click)"
                  ariaLabelFilter={`Filter ${unapprovedJournalByAccount.voucherCount} unapproved journal vouchers`}
                  ariaLabelShowAll="Show all journal accounts"
                />
              ) : null}
            </div>
            <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="journal">
              <PermissionButton permission="create_records" className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Create Journal Voucher
              </PermissionButton>
            </AddVoucherDialog>
          </div>
        }
        summary={{
          label: "Total Journal Amount",
          // Mobile chrome sticky summary: plain string totals only
          amountText: formatCurrencyForPrint(totalJournalAmount, { noSuffix: true }),
          amountClassName: "text-blue-600",
        }}
        searchPlaceholder="Search accounts..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        listSectionTitle={`Accounts involved (${filteredAccounts.length})`}
      >
        <AccountList
          accounts={filteredAccounts as any}
          onSelectAccount={handleSelectAccount as any}
          selectedAccount={selectedAccount as any}
          searchTerm={searchTerm}
          pendingApprovalByAccountId={unapprovedJournalByAccount.byAccountId}
        />
      </ReportRegisterMobileListChrome>
    );
  }

  return (
    <ReportStatementDesktopShell
      isMobile={false}
      listChromeRouteKey="bank-cash"
      pageTitle="Journal Report"
      listTab="accounts"
      entityTabValue="accounts"
      groupTabValue="groups"
      entityTabLabel="Accounts"
      hideGroupTab
      hideTabsRow
      onListTabChange={() => {}}
      balance={
        <span className="font-semibold text-blue-600">
          {formatCurrency(totalJournalAmount, { noSuffix: true })}
        </span>
      }
      searchRowExtras={
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="chromePill"
            size="list"
            onClick={() => setShowAllCompanyVouchers(true)}
          >
            All Journals
          </Button>
          {showApproveOnList ? (
            <PendingApprovalListFilterBadge
              compact
              count={unapprovedJournalByAccount.voucherCount}
              pressed={showOnlyUnapproved}
              onToggle={() => setShowOnlyUnapproved((value) => !value)}
              tooltipFilterHint={`Only accounts with unapproved journal vouchers - ${unapprovedJournalByAccount.voucherCount} voucher(s) (click)`}
              tooltipShowAllHint="Show all journal accounts (click)"
              ariaLabelFilter={`Filter ${unapprovedJournalByAccount.voucherCount} unapproved journal vouchers`}
              ariaLabelShowAll="Show all journal accounts"
            />
          ) : null}
        </div>
      }
      listSearchTerm={searchTerm}
      onListSearchChange={setSearchTerm}
      entitySearchPlaceholder="Search accounts..."
      groupSearchPlaceholder="Search accounts..."
      entitySectionLabel={
        <div className="flex items-center gap-2 text-sm font-medium">
          <Landmark className="h-4 w-4" />
          <span>Accounts ({filteredAccounts.length})</span>
        </div>
      }
      groupSectionLabel={null}
      entityQuickFilter={accountListQuickFilter}
      groupQuickFilter="latest"
      onEntityQuickFilterChange={setAccountListQuickFilter}
      onGroupQuickFilterChange={() => {}}
      summaryCards={[]}
      showSummary={!!currentAccount}
      entityList={
        <AccountList
          accounts={filteredAccounts as any}
          onSelectAccount={handleSelectAccount as any}
          selectedAccount={selectedAccount as any}
          searchTerm={searchTerm}
          quickFilter={accountListQuickFilter}
          onQuickFilterChange={setAccountListQuickFilter}
          pendingApprovalByAccountId={unapprovedJournalByAccount.byAccountId}
          hideQuickFilterBar
        />
      }
      groupList={null}
      detailView={
        currentAccount ? (
          <AccountDetails
            account={currentAccount as any}
            allAccounts={allAccounts as any}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => setSelectedAccount(null)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={userNames}
            reportTransactionFilter={isJournalVoucher}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <Card className="w-full max-w-md text-center">
              <CardHeader>
                <CardTitle>Select an account</CardTitle>
                <CardDescription>
                  Choose an account from the list to view journal transactions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {accountsWithJournal.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No journal vouchers yet. Create a journal voucher to see accounts here.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )
      }
    />
  );
}
