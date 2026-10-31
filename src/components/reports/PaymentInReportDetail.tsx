"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PartyDetails } from "@/components/party/PartyDetails";
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
import { firestore } from "@/lib/firebase";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParams } from "next/navigation";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportRegisterDesktopSplit } from "@/components/reports/ReportRegisterDesktopSplit";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { ReportRegisterListSearchRow } from "@/components/reports/ReportRegisterListSearchRow";

export function PaymentInReportDetail() {
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
  const [defaultTab, setDefaultTab] = useState<"payment_in" | "direct_income">("payment_in");
  const hasAutoSelected = useRef(false);

  // Dashboard deep-link `voucherScope`: same split as stat cards (Payment In vs Direct Income).
  const voucherScope = searchParams.get("voucherScope");

  // List/register title vs all-vouchers aggregate label (header me duplicate na ho).
  const reportRegisterTitle = useMemo(() => {
    if (voucherScope === "directIncomeOnly") return "Direct Income";
    if (voucherScope === "paymentInOnly") return "Receipt";
    return "Receipt";
  }, [voucherScope]);

  const reportAllVouchersTitle = useMemo(() => {
    if (voucherScope === "directIncomeOnly") return "All Direct Income";
    if (voucherScope === "paymentInOnly") return "All Receipts";
    return "All Receipts";
  }, [voucherScope]);

  const paymentInVouchers = useMemo(() => {
    const family = allVouchers.filter((v) => ["payment_in", "direct_income"].includes(v.type));
    if (voucherScope === "directIncomeOnly") return family.filter((v) => v.type === "direct_income");
    if (voucherScope === "paymentInOnly") return family.filter((v) => v.type === "payment_in");
    return family;
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

  const payeesWithReceipts = useMemo(() => {
    if (vouchersLoading || paymentInVouchers.length === 0) return [];
    const payeeMap = new Map<string, UnifiedPayee>();
    const addOrUpdatePayee = (
      id: string,
      name: string,
      type: UnifiedPayee["type"],
      entity: any,
      amount: number
    ) => {
      if (!payeeMap.has(id)) {
        payeeMap.set(id, { id, name, type, entity, balance: 0 });
      }
      const payee = payeeMap.get(id)!;
      payee.balance += amount;
    };
    paymentInVouchers.forEach((v) => {
      const amount = v.amount || v.total || 0;
      if (v.partyId) {
        const party = processedParties.find((p) => p.id === v.partyId);
        if (party) addOrUpdatePayee(party.id, party.name, "Party", party, amount);
      } else if (v.staffId) {
        const staff = processedStaff.find((s) => s.id === v.staffId);
        if (staff) addOrUpdatePayee(staff.id, staff.name, "Staff", staff, amount);
      } else if (v.taxAccountId) {
        const tax = processedTaxes.find((t) => t.id === v.taxAccountId);
        if (tax) addOrUpdatePayee(tax.id, tax.name, "Tax", tax, amount);
      } else if (v.incomeAccountId) {
        const incomeAcc = expenseAccounts.find((e) => e.id === v.incomeAccountId);
        if (incomeAcc) addOrUpdatePayee(incomeAcc.id, incomeAcc.name, "Income", incomeAcc, amount);
      } else if (v.payeeName) {
        addOrUpdatePayee(v.payeeName, v.payeeName, "Other", { id: v.payeeName, name: v.payeeName }, amount);
      }
    });
    return Array.from(payeeMap.values());
  }, [paymentInVouchers, processedParties, processedStaff, processedTaxes, expenseAccounts, vouchersLoading]);

  const totalPayments = useMemo(
    () => paymentInVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0),
    [paymentInVouchers]
  );

  const payeeTransactions = useMemo(() => {
    if (!selectedPayee) return [];
    return paymentInVouchers.filter((v) => {
      const matchesId =
        v.partyId === selectedPayee.id ||
        v.staffId === selectedPayee.id ||
        v.taxAccountId === selectedPayee.id ||
        v.incomeAccountId === selectedPayee.id ||
        v.payeeName === selectedPayee.id;
      const matchesEntity =
        selectedPayee.entity &&
        (v.partyId === selectedPayee.entity.id ||
          v.staffId === selectedPayee.entity.id ||
          v.taxAccountId === selectedPayee.entity.id ||
          v.incomeAccountId === selectedPayee.entity.id);
      return matchesId || matchesEntity;
    });
  }, [paymentInVouchers, selectedPayee]);

  const allPaymentsEntity = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    const totalAmount = paymentInVouchers.reduce((sum, v) => sum + (v.total || v.amount || 0), 0);
    return {
      id: "all",
      name: reportAllVouchersTitle,
      type: "Other" as const,
      balance: totalAmount,
      entity: { id: "all", name: reportAllVouchersTitle, balance: totalAmount, openingBalance: 0 },
    };
  }, [showAllCompanyVouchers, paymentInVouchers, reportAllVouchersTitle]);

  const currentEntity = showAllCompanyVouchers ? allPaymentsEntity : selectedPayee;
  const currentTransactions = showAllCompanyVouchers ? paymentInVouchers : payeeTransactions;

  const filteredPayees = useMemo(
    () => filterPayeeListRows(payeesWithReceipts, searchTerm, listQuickFilter, lastVoucherMsById, hideSettled),
    [payeesWithReceipts, searchTerm, listQuickFilter, lastVoucherMsById, hideSettled]
  );

  const REPORT_MEMORY_KEY = "reportPaymentInState";

  useEffect(() => {
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllCompanyVouchers(true);
        setSelectedPayee(null);
      }
      return;
    }
    if (payeesWithReceipts.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { payeeId?: string }) : null;
      const payeeId = saved?.payeeId;
      if (payeeId) {
        const found = payeesWithReceipts.find((p) => p.id === payeeId);
        if (found) {
          setSelectedPayee(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedPayee(payeesWithReceipts[0]);
  }, [payeesWithReceipts, isMobile, searchParams]);

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

  const openVoucherDialog = (type: "payment_in" | "direct_income") => {
    setDefaultTab(type);
    setIsVoucherOpen(true);
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PartyDetails
                party={currentEntity as any}
                transactions={currentTransactions}
                onPartyUpdated={() => {}}
                onPartyDeleted={() => { setSelectedPayee(null); setShowAllCompanyVouchers(false); }}
                onShowAll={() => setShowAllCompanyVouchers(true)}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                isAllVouchersView={showAllCompanyVouchers}
                userNames={userNames}
                context="payment-in"
                mobileFooterVariant="report"
                mobileReportStickyTitle={showAllCompanyVouchers ? reportAllVouchersTitle : reportRegisterTitle}
                onBack={() => { setSelectedPayee(null); setShowAllCompanyVouchers(false); }}
              />
            </div>
          </div>
          <AddVoucherDialog
            isOpen={isVoucherOpen}
            onOpenChange={setIsVoucherOpen}
            onVoucherCreated={() => {}}
            defaultTab={defaultTab}
            voucher={undefined}
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
              <PermissionButton permission="create_records" className="w-full" onClick={() => openVoucherDialog("payment_in")}>
                <PlusCircle className="mr-2 h-4 w-4" /> Receipt
              </PermissionButton>
              <PermissionButton permission="create_records" className="w-full" variant="outline" onClick={() => openVoucherDialog("direct_income")}>
                <PlusCircle className="mr-2 h-4 w-4" /> Direct Income
              </PermissionButton>
            </div>
          }
          summary={{
            label: "Total Received",
            // Sticky chrome summary typings: string, not animated `formatCurrency` node
            amountText: formatCurrencyForPrint(totalPayments, { noSuffix: true }),
            amountClassName: "text-green-600",
          }}
          searchPlaceholder="Search payees..."
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          listSectionTitle={`Received from (${filteredPayees.length})`}
        >
          <PayeeList
            payees={payeesWithReceipts}
            selectedPayee={selectedPayee}
            onSelectPayee={handleSelectPayee}
            searchTerm={searchTerm}
            quickFilter={listQuickFilter}
            onQuickFilterChange={setListQuickFilter}
          />
        </ReportRegisterMobileListChrome>
        <AddVoucherDialog
          isOpen={isVoucherOpen}
          onOpenChange={setIsVoucherOpen}
          onVoucherCreated={() => {}}
          defaultTab={defaultTab}
          voucher={undefined}
        />
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
                <ReportRegisterListHeading>{reportRegisterTitle}</ReportRegisterListHeading>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Received</p>
                  <p className="text-xl font-bold text-green-600">
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
                <h3 className="text-sm font-semibold">Received from ({filteredPayees.length})</h3>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <PayeeList
                  payees={payeesWithReceipts}
                  selectedPayee={selectedPayee}
                  onSelectPayee={handleSelectPayee}
                  searchTerm={searchTerm}
                  quickFilter={listQuickFilter}
                  onQuickFilterChange={setListQuickFilter}
                />
              </div>
            </>
          }
          detailPanel={
            currentEntity ? (
              <PartyDetails
                party={currentEntity as any}
                transactions={currentTransactions}
                onPartyUpdated={() => {}}
                onPartyDeleted={() => setSelectedPayee(null)}
                onShowAll={() => setShowAllCompanyVouchers(true)}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                isAllVouchersView={showAllCompanyVouchers}
                userNames={userNames}
                context="payment-in"
                mobileFooterVariant="report"
                mobileReportStickyTitle={showAllCompanyVouchers ? reportAllVouchersTitle : reportRegisterTitle}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <Card className="w-full max-w-md text-center">
                  <CardHeader>
                    <CardTitle>Select a payee</CardTitle>
                    <CardDescription>Choose a payee from the list to view transactions.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {payeesWithReceipts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No receipts recorded yet. Record a receipt to see payees here.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            )
          }
        />
      </div>
      <AddVoucherDialog
        isOpen={isVoucherOpen}
        onOpenChange={setIsVoucherOpen}
        onVoucherCreated={() => {}}
        defaultTab={defaultTab}
        voucher={undefined}
      />
    </>
  );
}
