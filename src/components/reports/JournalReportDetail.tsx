"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountDetails } from "@/components/account/AccountDetails";
import { AccountList } from "@/components/bank-cash/AccountList";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportRegisterDesktopSplit } from "@/components/reports/ReportRegisterDesktopSplit";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { ReportRegisterListSearchRow } from "@/components/reports/ReportRegisterListSearchRow";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
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
  const {
    vouchers: allVouchers,
    loading: vouchersLoading,
    processedAccounts,
    journalAccountNames,
    processedParties,
    processedStaff,
    processedTaxes,
    expenseAccounts: unprocessedExpenseAccounts,
  } = useFyScopedVouchers();
  const [selectedAccount, setSelectedAccount] = useState<JournalAccount | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const hasAutoSelected = useRef(false);

  const journalVouchers = useMemo(
    () => allVouchers.filter((v) => v.type === "journal" && v.subType !== "add_salary"),
    [allVouchers]
  );

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
      (v.entries || []).forEach((e: any) => {
        if (e.accountId) accountIds.add(e.accountId);
      });
    });
    return allAccounts.filter((p) => accountIds.has(p.id));
  }, [journalVouchers, allAccounts, vouchersLoading]);

  const totalJournalAmount = useMemo(
    () => journalVouchers.reduce((sum, v) => sum + (v.total || 0), 0),
    [journalVouchers]
  );

  const accountTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    return journalVouchers.filter((v) =>
      v.entries?.some((e: any) => e.accountId === selectedAccount.id)
    );
  }, [journalVouchers, selectedAccount]);

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

  const filteredAccounts = useMemo(
    () =>
      accountsWithJournal.filter((p) =>
        p.accountName.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [accountsWithJournal, searchTerm]
  );

  const REPORT_MEMORY_KEY = "reportJournalState";

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
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { accountId?: string }) : null;
      const accountId = saved?.accountId;
      if (accountId) {
        const found = accountsWithJournal.find((a) => a.id === accountId);
        if (found) {
          setSelectedAccount(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedAccount(accountsWithJournal[0]);
  }, [accountsWithJournal, isMobile, searchParams]);

  const handleSelectAccount = useCallback((account: JournalAccount) => {
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
          <AccountDetails
            account={currentAccount as any}
            allAccounts={allAccounts as any}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => {
              setSelectedAccount(null);
              setShowAllCompanyVouchers(false);
            }}
            onShowAll={() => setShowAllCompanyVouchers(true)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={userNames}
            journalAccountNames={journalAccountNames}
            isAllVouchersView={showAllCompanyVouchers}
            onBack={() => {
              setSelectedAccount(null);
              setShowAllCompanyVouchers(false);
            }}
            mobileFooterVariant="report"
            mobileReportStickyTitle={showAllCompanyVouchers ? "All Journal" : "Journal"}
          />
          </div>
        </div>
      );
    }
    return (
      <ReportRegisterMobileListChrome
        title="Journals"
        actionSlot={
          <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="journal">
            <PermissionButton permission="create_records" className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" /> Create Journal Voucher
            </PermissionButton>
          </AddVoucherDialog>
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
        />
      </ReportRegisterMobileListChrome>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ReportRegisterDesktopSplit
        listPanel={
          <>
            <div className="p-4 border-b space-y-3 flex-shrink-0">
              <ReportRegisterListHeading>Journals</ReportRegisterListHeading>
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Journal Amount</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(totalJournalAmount, { noSuffix: true })}
                </p>
              </Card>
            </div>
            <ReportRegisterListSearchRow
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={setSearchTerm}
            />
            <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
              <h3 className="text-sm font-semibold">Accounts involved ({filteredAccounts.length})</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <AccountList
                accounts={filteredAccounts as any}
                onSelectAccount={handleSelectAccount as any}
                selectedAccount={selectedAccount as any}
                searchTerm={searchTerm}
              />
            </div>
          </>
        }
        detailPanel={
          currentAccount ? (
            <AccountDetails
              account={currentAccount as any}
              allAccounts={allAccounts as any}
              transactions={currentTransactions}
              onAccountUpdated={() => {}}
              onAccountDeleted={() => setSelectedAccount(null)}
              onShowAll={() => setShowAllCompanyVouchers(true)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={userNames}
              journalAccountNames={journalAccountNames}
              isAllVouchersView={showAllCompanyVouchers}
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
    </div>
  );
}
