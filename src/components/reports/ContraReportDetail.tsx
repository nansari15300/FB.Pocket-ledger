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
import type { Account } from "@/components/bank-cash/types";
import { useVouchers } from "@/hooks/useVouchers";
import { getOutflowBillWiseLinkAmount } from "@/lib/payment-allocation-utils";
import { useDate } from "@/hooks/useDate";
import { useReportShowApproveOnList } from "@/components/reports/ReportListParityChrome";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParams } from "next/navigation";

export function ContraReportDetail() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedAccounts, userNames } = useVouchers();
  const showApproveOnList = useReportShowApproveOnList();
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [accountListQuickFilter, setAccountListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const [showOnlyUnapproved, setShowOnlyUnapproved] = useState(false);
  const hasAutoSelected = useRef(false);

  const contraVouchers = useMemo(() => allVouchers.filter((v) => v.type === "contra"), [allVouchers]);
  const isContraVoucher = useCallback((transaction: any) => transaction?.type === "contra", []);

  const matchesAccountId = useCallback((value: unknown, accountId: string) => {
    const valueId =
      value && typeof value === "object" && "id" in value
        ? String((value as { id?: unknown }).id ?? "").trim()
        : String(value ?? "").trim();
    return Boolean(accountId) && valueId === accountId;
  }, []);
  const accountIdValue = useCallback((value: unknown) => {
    if (value && typeof value === "object" && "id" in value) {
      return String((value as { id?: unknown }).id ?? "").trim();
    }
    return String(value ?? "").trim();
  }, []);

  /**
   * List ka balance = **sirf contra ka net** (Dr positive / Cr negative).
   *
   * `account.balance` poora ledger balance hota hai — Contra report me wahan contra ka sum chahiye.
   * `toAccountId` → Dr (receiver), `fromAccountId` → Cr (sender, transfer + charge).
   */
  const contraNetByAccountId = useMemo(() => {
    const out = new Map<string, number>();
    const add = (id: unknown, delta: number) => {
      const normalizedId = accountIdValue(id);
      if (!normalizedId || !delta) return;
      out.set(normalizedId, (out.get(normalizedId) ?? 0) + delta);
    };
    for (const v of contraVouchers as any[]) {
      const transfer = getOutflowBillWiseLinkAmount(v) || 0;
      const otherCharge = Number(v.otherChargeAmount || 0) || 0;
      add(v.toAccountId, transfer);
      add(v.fromAccountId, -(transfer + otherCharge));
      add(v.otherChargeAccountId, otherCharge);
      const legacyAccountId = v.accountId || v.bankAccountId;
      const hasToAccount = accountIdValue(v.toAccountId) !== "";
      if (
        legacyAccountId &&
        (!hasToAccount ||
          (!matchesAccountId(v.fromAccountId, accountIdValue(legacyAccountId)) &&
            !matchesAccountId(v.toAccountId, accountIdValue(legacyAccountId))))
      ) {
        add(legacyAccountId, transfer);
      }
    }
    return out;
  }, [accountIdValue, contraVouchers, matchesAccountId]);

  const accountsWithContra = useMemo(() => {
    if (vouchersLoading) return [];
    const accountIds = new Set<string>();
    contraVouchers.forEach((v) => {
      const fromId = accountIdValue(v.fromAccountId);
      const toId = accountIdValue(v.toAccountId);
      const chargeId = accountIdValue(v.otherChargeAccountId);
      const legacyAccountId = accountIdValue(v.accountId);
      const legacyBankAccountId = accountIdValue(v.bankAccountId);
      if (fromId) accountIds.add(fromId);
      if (toId) accountIds.add(toId);
      if (chargeId) accountIds.add(chargeId);
      if (legacyAccountId) accountIds.add(legacyAccountId);
      if (legacyBankAccountId) accountIds.add(legacyBankAccountId);
    });
    return processedAccounts
      .filter((p) => accountIds.has(p.id))
      /* List sirf contra ka hisaab dikhaye — `balance` ko contra net se override. */
      .map((p) => ({ ...p, balance: contraNetByAccountId.get(p.id) ?? 0 }));
  }, [accountIdValue, contraVouchers, processedAccounts, vouchersLoading, contraNetByAccountId]);

  const unapprovedContraByAccount = useMemo(() => {
    const accountIds = new Set(accountsWithContra.map((account) => account.id));
    const touchedAccountIds = new Set<string>();
    const byAccountId: Record<string, number> = {};
    let voucherCount = 0;
    if (!showApproveOnList || accountIds.size === 0) {
      return { accountIds: touchedAccountIds, byAccountId, voucherCount };
    }
    for (const voucher of contraVouchers as any[]) {
      if (voucher?.isApproved === true) continue;
      const voucherAccountIds = new Set<string>();
      for (const value of [
        voucher.fromAccountId,
        voucher.toAccountId,
        voucher.otherChargeAccountId,
        voucher.accountId,
        voucher.bankAccountId,
      ]) {
        const id = accountIdValue(value);
        if (!id || !accountIds.has(id)) continue;
        touchedAccountIds.add(id);
        voucherAccountIds.add(id);
      }
      if (voucherAccountIds.size > 0) {
        voucherCount += 1;
        voucherAccountIds.forEach((id) => {
          byAccountId[id] = (byAccountId[id] ?? 0) + 1;
        });
      }
    }
    return { accountIds: touchedAccountIds, byAccountId, voucherCount };
  }, [accountIdValue, accountsWithContra, contraVouchers, showApproveOnList]);


  const totalContra = useMemo(
    () => contraVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0),
    [contraVouchers]
  );

  const allContraAccount = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    return {
      id: "all",
      accountName: "All Contra Vouchers",
      balance: 0,
      openingBalance: 0,
      accountType: "contra_view", // use-transactions: All Contra list scope (journal_view jaisa)
    };
  }, [showAllCompanyVouchers]);

  const currentAccount = showAllCompanyVouchers ? allContraAccount : selectedAccount;
  // Contra report is a contra-only ledger; pass the same source list for both a single
  // account and the All Contra view. AccountDetails then scopes this list to the selected
  // account while retaining balanced transfers where both ledgers are company accounts.
  const currentTransactions = contraVouchers;

  /**
   * `AccountDetails` ko sirf contra report ke accounts do — `processedAccounts` me full ledger balance
   * hota hai jo contra net ko override kar deta hai (aur list/detail ka hisaab alag ho jata hai).
   */
  const contraAccountsForDetails = useMemo(() => accountsWithContra, [accountsWithContra]);

  const filteredAccounts = useMemo(
    () =>
      accountsWithContra.filter(
        (account) =>
          (!showOnlyUnapproved || unapprovedContraByAccount.accountIds.has(account.id)) &&
          account.accountName.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [accountsWithContra, searchTerm, showOnlyUnapproved, unapprovedContraByAccount.accountIds]
  );

  const REPORT_MEMORY_KEY = "reportContraState";

  useEffect(() => {
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllCompanyVouchers(true);
        setSelectedAccount(null);
      }
      return;
    }
    if (accountsWithContra.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { accountId?: string }) : null;
      const accountId = saved?.accountId;
      if (accountId) {
        const found = accountsWithContra.find((a) => a.id === accountId);
        if (found) {
          setSelectedAccount(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedAccount(accountsWithContra[0]);
  }, [accountsWithContra, isMobile, searchParams]);

  const handleSelectAccount = useCallback((account: Account) => {
    setShowAllCompanyVouchers(false);
    setSelectedAccount(account);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ accountId: account.id }));
    } catch (_) {}
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
          {/* Sticky Party-style chrome + Print/Excel/Date – header AccountDetails ke andar (duplicate top bar hataya). */}
          <AccountDetails
            account={currentAccount as any}
            allAccounts={contraAccountsForDetails}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => {
              setSelectedAccount(null);
              setShowAllCompanyVouchers(false);
            }}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={userNames}
            reportTransactionFilter={isContraVoucher}
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
        title="Contra"
        actionSlot={
          <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="contra">
            <PermissionButton permission="create_records" className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" /> Create Contra Entry
            </PermissionButton>
          </AddVoucherDialog>
        }
        summary={{
          label: "Total Transferred",
          // Mobile chrome expects string totals; desktop card still uses `formatCurrency` (ReactNode)
          amountText: formatCurrencyForPrint(totalContra, { noSuffix: true }),
          amountClassName: "text-blue-600",
        }}
        searchPlaceholder="Search accounts..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        listSectionTitle={`Accounts (${filteredAccounts.length})`}
      >
        <AccountList
          accounts={filteredAccounts}
          onSelectAccount={handleSelectAccount}
          selectedAccount={selectedAccount}
          searchTerm={searchTerm}
        />
      </ReportRegisterMobileListChrome>
    );
  }

  return (
    <ReportStatementDesktopShell
      isMobile={false}
      listChromeRouteKey="bank-cash"
      pageTitle="Contra Report"
      listTab="accounts"
      entityTabValue="accounts"
      groupTabValue="groups"
      entityTabLabel="Accounts"
      hideGroupTab
      onListTabChange={() => {}}
      balance={
        <span className="font-semibold text-blue-600">
          {formatCurrency(totalContra, { noSuffix: true })}
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
            All Contra
          </Button>
          {showApproveOnList ? (
            <PendingApprovalListFilterBadge
              compact
              count={unapprovedContraByAccount.voucherCount}
              pressed={showOnlyUnapproved}
              onToggle={() => setShowOnlyUnapproved((value) => !value)}
              tooltipFilterHint={`Only accounts with unapproved contra vouchers - ${unapprovedContraByAccount.voucherCount} voucher(s) (click)`}
              tooltipShowAllHint="Show all contra accounts (click)"
              ariaLabelFilter={`Filter ${unapprovedContraByAccount.voucherCount} unapproved contra vouchers`}
              ariaLabelShowAll="Show all contra accounts"
            />
          ) : null}
        </div>
      }
      hideTabsRow
      listSearchTerm={searchTerm}
      onListSearchChange={setSearchTerm}
      entitySearchPlaceholder="Search accounts..."
      groupSearchPlaceholder="Search groups..."
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
          accounts={filteredAccounts}
          onSelectAccount={handleSelectAccount}
          selectedAccount={selectedAccount}
          searchTerm={searchTerm}
          quickFilter={accountListQuickFilter}
          onQuickFilterChange={setAccountListQuickFilter}
          pendingApprovalByAccountId={unapprovedContraByAccount.byAccountId}
          hideQuickFilterBar
        />
      }
      groupList={null}
      detailView={
        currentAccount ? (
          <AccountDetails
            account={currentAccount as any}
            allAccounts={contraAccountsForDetails}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => setSelectedAccount(null)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={userNames}
            reportTransactionFilter={isContraVoucher}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <Card className="w-full max-w-md text-center">
              <CardHeader>
                <CardTitle>Select an account</CardTitle>
                <CardDescription>
                  Choose an account from the list to view contra transactions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {accountsWithContra.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No contra entries yet. Create a contra entry to see accounts here.
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
