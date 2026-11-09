"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search, Users } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PartyDetails } from "@/components/party/PartyDetails";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { ExpenseAccountDetails } from "@/components/expenses/ExpenseAccountDetails";
import { PayeeList, filterPayeeListRows } from "@/components/payee/PayeeList";
import type { UnifiedPayee } from "@/components/payee/PayeeList";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParams } from "next/navigation";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportRegisterDesktopSplit } from "@/components/reports/ReportRegisterDesktopSplit";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { ReportRegisterListSearchRow } from "@/components/reports/ReportRegisterListSearchRow";
import {
  voucherCountsAsDashboardPaySalary,
  voucherCountsAsDashboardPaymentOutExcludingPaySalary,
} from "@/lib/dashboardPaySalaryStat";

export function PaymentOutReportDetail() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const {
    vouchers: allVouchers,
    loading: vouchersLoading,
    processedParties,
    processedStaff,
    processedTaxes,
    expenseAccounts: unprocessedExpenseAccounts,
  } = useFyScopedVouchers();
  const [selectedPayee, setSelectedPayee] = useState<UnifiedPayee | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [listQuickFilter, setListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const [isVoucherOpen, setIsVoucherOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<"payment_out" | "direct_expense">("payment_out");
  const hasAutoSelected = useRef(false);

  const voucherScope = searchParams.get("voucherScope");

  // List/register title vs all-vouchers aggregate label (header me duplicate na ho).
  const reportRegisterTitle = useMemo(() => {
    if (voucherScope === "directExpenseOnly") return "Direct Expense";
    if (voucherScope === "paySalary") return "Pay Salary";
    return "Payment";
  }, [voucherScope]);

  const reportAllVouchersTitle = useMemo(() => {
    if (voucherScope === "directExpenseOnly") return "All Direct Exp";
    if (voucherScope === "paySalary") return "All Pay Salary";
    return "All Payments";
  }, [voucherScope]);

  const paymentOutVouchers = useMemo(() => {
    // Pay Salary dashboard count = `pay_salary` type + staff `payment_out` (see `dashboardPaySalaryStat`) — not only payment_out/direct_expense.
    if (voucherScope === "paySalary") {
      return allVouchers.filter((v) => voucherCountsAsDashboardPaySalary(v));
    }
    let list = allVouchers.filter((v) => ["payment_out", "direct_expense"].includes(v.type));
    if (voucherScope === "paymentOutExclPaySalary") {
      list = list.filter((v) => voucherCountsAsDashboardPaymentOutExcludingPaySalary(v));
    } else if (voucherScope === "directExpenseOnly") {
      // Direct Expense card: sirf `direct_expense` vouchers; Payment family mix nahi.
      list = list.filter((v) => v.type === "direct_expense");
    }
    return list;
  }, [allVouchers, voucherScope]);

  const expenseAccounts = unprocessedExpenseAccounts;

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

  const payeesWithPayments = useMemo(() => {
    if (vouchersLoading || paymentOutVouchers.length === 0) return [];
    const payeeMap = new Map<string, UnifiedPayee>();
    const allEntities = [
      ...processedParties.map((p) => ({ ...p, type: "Party" as const })),
      ...processedStaff.map((s) => ({ ...s, type: "Staff" as const })),
      ...processedTaxes.map((t) => ({ ...t, type: "Tax" as const })),
      ...expenseAccounts.map((e) => ({ ...e, type: "Expense" as const, name: e.name || e.id })),
    ];
    const involvedIds = new Set<string>();
    paymentOutVouchers.forEach((v) => {
      if (v.partyId) involvedIds.add(`Party-${v.partyId}`);
      if (v.staffId) involvedIds.add(`Staff-${v.staffId}`);
      if (v.taxAccountId) involvedIds.add(`Tax-${v.taxAccountId}`);
      if (v.expenseAccountId) involvedIds.add(`Expense-${v.expenseAccountId}`);
      if (v.toAccountId) involvedIds.add(`Expense-${v.toAccountId}`);
    });
    allEntities.forEach((entity) => {
      const key = `${entity.type}-${entity.id}`;
      if (involvedIds.has(key)) {
        payeeMap.set(key, {
          id: entity.id,
          name: (entity as any).name || (entity as any).accountName,
          type: entity.type,
          entity: entity,
          balance: entity.balance || 0,
        });
      }
    });
    paymentOutVouchers.forEach((v) => {
      if (v.payeeName && !payeeMap.has(`Other-${v.payeeName}`)) {
        const otherAmount = paymentOutVouchers
          .filter((tx) => tx.payeeName === v.payeeName)
          .reduce((sum, tx) => sum + (tx.total || tx.amount || 0), 0);
        payeeMap.set(`Other-${v.payeeName}`, {
          id: v.payeeName,
          name: v.payeeName,
          type: "Other",
          entity: { id: v.payeeName, name: v.payeeName, balance: -otherAmount },
          balance: -otherAmount,
        });
      }
    });
    return Array.from(payeeMap.values());
  }, [paymentOutVouchers, processedParties, processedStaff, processedTaxes, expenseAccounts, vouchersLoading]);

  const totalPayments = useMemo(
    () => paymentOutVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0),
    [paymentOutVouchers]
  );

  const payeeTransactions = useMemo(() => {
    if (!selectedPayee) return [];
    return paymentOutVouchers.filter(
      (v) =>
        v.partyId === selectedPayee.id ||
        v.staffId === selectedPayee.id ||
        v.taxAccountId === selectedPayee.id ||
        v.expenseAccountId === selectedPayee.id ||
        v.toAccountId === selectedPayee.id ||
        v.payeeName === selectedPayee.id
    );
  }, [paymentOutVouchers, selectedPayee]);

  const allPaymentsEntity = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    const totalAmount = paymentOutVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0);
    return {
      id: "all",
      name: reportAllVouchersTitle,
      type: "Other" as const,
      balance: totalAmount,
      entity: { id: "all", name: reportAllVouchersTitle, balance: totalAmount, openingBalance: 0 },
    };
  }, [showAllCompanyVouchers, paymentOutVouchers, reportAllVouchersTitle]);

  const currentEntity = showAllCompanyVouchers ? allPaymentsEntity : selectedPayee;
  const currentTransactions = showAllCompanyVouchers ? paymentOutVouchers : payeeTransactions;

  const filteredPayees = useMemo(
    () => filterPayeeListRows(payeesWithPayments, searchTerm, listQuickFilter, lastVoucherMsById, hideSettled),
    [payeesWithPayments, searchTerm, listQuickFilter, lastVoucherMsById, hideSettled]
  );

  const REPORT_MEMORY_KEY = "reportPaymentOutState";

  useEffect(() => {
    // Dashboard deep-link: `?allVouchers=1` → "All Vouchers" table (useTransactions `payment-out` + entity all pehle empty tha — fix hooks me)
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllCompanyVouchers(true);
        setSelectedPayee(null);
      }
      return;
    }
    if (payeesWithPayments.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { payeeId?: string }) : null;
      const payeeId = saved?.payeeId;
      if (payeeId) {
        const found = payeesWithPayments.find((p) => p.id === payeeId);
        if (found) {
          setSelectedPayee(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedPayee(payeesWithPayments[0]);
  }, [payeesWithPayments, isMobile, searchParams]);

  const handleSelectPayee = useCallback(
    (payee: UnifiedPayee) => {
      setShowAllCompanyVouchers(false);
      setSelectedPayee(payee);
      try {
        localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ payeeId: payee.id }));
      } catch (_) {}
    },
    []
  );

  const openVoucherDialog = (type: "payment_out" | "direct_expense") => {
    setDefaultTab(type);
    setIsVoucherOpen(true);
  };

  const reportMobileDetailProps = useMemo(
    () => ({
      mobileFooterVariant: "report" as const,
      mobileReportStickyTitle: showAllCompanyVouchers ? reportAllVouchersTitle : reportRegisterTitle,
      onBack: () => {
        setSelectedPayee(null);
        setShowAllCompanyVouchers(false);
      },
    }),
    [showAllCompanyVouchers, reportAllVouchersTitle, reportRegisterTitle]
  );

  const renderDetailsView = () => {
    if (!currentEntity) {
      return (
        <div className="flex flex-col items-center justify-center min-h-0 w-full h-full overflow-hidden bg-muted/20">
          <div className="text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">Select a Payee</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a payee from the list to view their detailed transaction history.
            </p>
          </div>
        </div>
      );
    }

    if (showAllCompanyVouchers && allPaymentsEntity) {
      return (
        <PartyDetails
          party={allPaymentsEntity as any}
          transactions={currentTransactions}
          onPartyUpdated={() => {}}
          onPartyDeleted={() => setSelectedPayee(null)}
          onShowAll={() => setShowAllCompanyVouchers(true)}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          isAllVouchersView={showAllCompanyVouchers}
          userNames={userNames}
          context="payment-out"
          {...reportMobileDetailProps}
        />
      );
    }

    if (!selectedPayee) return null;

    switch (selectedPayee.type) {
      case "Party":
        return (
          <PartyDetails
            party={selectedPayee.entity}
            allParties={processedParties}
            transactions={currentTransactions}
            onPartyUpdated={() => {}}
            onPartyDeleted={() => setSelectedPayee(null)}
            onShowAll={() => setShowAllCompanyVouchers(true)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            isAllVouchersView={showAllCompanyVouchers}
            context="payment-out"
            userNames={userNames}
            {...reportMobileDetailProps}
          />
        );
      case "Staff":
        return (
          <StaffDetails
            staff={selectedPayee.entity}
            transactions={currentTransactions}
            onStaffUpdated={() => {}}
            onStaffDeleted={() => setSelectedPayee(null)}
            onShowAll={() => setShowAllCompanyVouchers(true)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            isAllVouchersView={showAllCompanyVouchers}
            context="payment-out"
            userNames={userNames}
            {...reportMobileDetailProps}
          />
        );
      case "Tax":
        return (
          <TaxDetails
            tax={selectedPayee.entity}
            allTaxes={processedTaxes}
            transactions={currentTransactions}
            onTaxUpdated={() => {}}
            onTaxDeleted={() => setSelectedPayee(null)}
            onShowAll={() => setShowAllCompanyVouchers(true)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            context="payment-out"
            userNames={userNames}
            {...reportMobileDetailProps}
          />
        );
      case "Expense":
        return (
          <ExpenseAccountDetails
            account={selectedPayee.entity}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => setSelectedPayee(null)}
            onShowAll={() => setShowAllCompanyVouchers(true)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            isAllVouchersView={showAllCompanyVouchers}
            context="payment-out"
            userNames={userNames}
            {...reportMobileDetailProps}
          />
        );
      default:
        return (
          <ExpenseAccountDetails
            account={{ ...selectedPayee.entity, name: selectedPayee.name, balance: selectedPayee.balance }}
            transactions={currentTransactions}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => setSelectedPayee(null)}
            onShowAll={() => setShowAllCompanyVouchers(true)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            isAllVouchersView={showAllCompanyVouchers}
            context="payment-out"
            userNames={userNames}
            {...reportMobileDetailProps}
          />
        );
    }
  };

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
    if (currentEntity) {
      return (
        <>
          <div className="flex flex-col h-full min-h-0 overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderDetailsView()}</div>
          </div>
          <AddVoucherDialog
            isOpen={isVoucherOpen}
            onOpenChange={setIsVoucherOpen}
            onVoucherCreated={() => {}}
            defaultTab={defaultTab}
          />
        </>
      );
    }
    return (
      <>
        <ReportRegisterMobileListChrome
          title={reportRegisterTitle}
          actionSlot={
            <div className="grid grid-cols-2 gap-2">
              <PermissionButton permission="create_records" className="w-full" onClick={() => openVoucherDialog("payment_out")}>
                <PlusCircle className="mr-2 h-4 w-4" /> Payment
              </PermissionButton>
              <PermissionButton permission="create_records" className="w-full" variant="outline" onClick={() => openVoucherDialog("direct_expense")}>
                <PlusCircle className="mr-2 h-4 w-4" /> Direct Expense
              </PermissionButton>
            </div>
          }
          summary={{
            label: "Total Paid",
            // Same as Payment In: mobile list chrome `amountText` must be plain string
            amountText: formatCurrencyForPrint(totalPayments, { noSuffix: true }),
            amountClassName: "text-red-600",
          }}
          searchPlaceholder="Search payees..."
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          listSectionTitle={`Paid to (${filteredPayees.length})`}
        >
          <PayeeList
            payees={payeesWithPayments}
            selectedPayee={selectedPayee}
            onSelectPayee={handleSelectPayee}
            searchTerm={searchTerm}
            quickFilter={listQuickFilter}
            onQuickFilterChange={setListQuickFilter}
          />
        </ReportRegisterMobileListChrome>
        <AddVoucherDialog isOpen={isVoucherOpen} onOpenChange={setIsVoucherOpen} onVoucherCreated={() => {}} defaultTab={defaultTab} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <ReportRegisterDesktopSplit
          resizeTitle="Resize payee list"
          listPanel={
            <>
              <div className="p-4 border-b space-y-3 flex-shrink-0">
                <ReportRegisterListHeading>Payment</ReportRegisterListHeading>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Paid</p>
                  <p className="text-xl font-bold text-red-600">
                    {formatCurrency(totalPayments, { noSuffix: true })}
                  </p>
                </Card>
              </div>
              <ReportRegisterListSearchRow
                placeholder="Search payees..."
                value={searchTerm}
                onChange={setSearchTerm}
              />
              <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
                <h3 className="text-sm font-semibold">Paid to ({filteredPayees.length})</h3>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <PayeeList
                  payees={payeesWithPayments}
                  selectedPayee={selectedPayee}
                  onSelectPayee={handleSelectPayee}
                  searchTerm={searchTerm}
                  quickFilter={listQuickFilter}
                  onQuickFilterChange={setListQuickFilter}
                />
              </div>
            </>
          }
          detailPanel={renderDetailsView()}
        />
      </div>
      <AddVoucherDialog
        isOpen={isVoucherOpen}
        onOpenChange={setIsVoucherOpen}
        onVoucherCreated={() => {}}
        defaultTab={defaultTab}
      />
    </>
  );
}
