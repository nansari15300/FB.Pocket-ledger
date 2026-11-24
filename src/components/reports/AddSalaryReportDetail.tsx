"use client";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_SEARCH_PLACEHOLDER } from "@/lib/staffEntityDisplayName";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, User } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { StaffDetails } from "@/components/staff/StaffDetails";
import { StaffList } from "@/components/staff/StaffList";
import type { Staff } from "@/components/staff/types";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { useReportShowApproveOnList } from "@/components/reports/ReportListParityChrome";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParams } from "next/navigation";
import { ReportRegisterMobileListChrome } from "@/components/reports/ReportRegisterMobileListChrome";
import { ReportStatementDesktopShell } from "@/components/reports/ReportStatementDesktopShell";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { mlc } from "@/lib/mobileListChrome";

export function AddSalaryReportDetail() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedStaff, userNames } = useFyScopedVouchers();
  const showApproveOnList = useReportShowApproveOnList();
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [staffListQuickFilter, setStaffListQuickFilter] = useState<EntityListQuickFilter>("latest");
  const [showAllCompanyVouchers, setShowAllCompanyVouchers] = useState(false);
  const [showOnlyUnapproved, setShowOnlyUnapproved] = useState(false);
  const [isVoucherOpen, setIsVoucherOpen] = useState(false);
  const hasAutoSelected = useRef(false);

  useEffect(() => {
    if (!isMobile) return;
    // Dashboard `allVouchers=1` mobile par bhi combined list dikhaye — warna pehle list view.
    if (searchParams.get("allVouchers") === "1") return;
    setSelectedStaff(null);
    setShowAllCompanyVouchers(false);
  }, [isMobile, searchParams]);

  const addSalaryVouchers = useMemo(
    () =>
      allVouchers.filter(
        (v) => v.type === "add_salary" || (v.type === "journal" && v.subType === "add_salary")
      ),
    [allVouchers]
  );

  const staffWithSalary = useMemo(() => {
    if (vouchersLoading || addSalaryVouchers.length === 0) return [];
    const staffIdsWithSalary = new Set<string>();
    addSalaryVouchers.forEach((v) =>
      v.entries?.forEach((e: any) => staffIdsWithSalary.add(e.accountId))
    );
    return processedStaff.filter((s) => staffIdsWithSalary.has(s.id));
  }, [addSalaryVouchers, processedStaff, vouchersLoading]);

  const totalSalaryAdded = useMemo(() => {
    return addSalaryVouchers.reduce((sum, v) => {
      const salaryExpenseDebit = v.entries?.find((e: any) => e.debit > 0)?.debit || 0;
      return sum + salaryExpenseDebit;
    }, 0);
  }, [addSalaryVouchers]);

  const staffTransactions = useMemo(() => {
    if (!selectedStaff) return [];
    return addSalaryVouchers.filter((v) =>
      v.entries?.some((e: any) => e.accountId === selectedStaff.id)
    );
  }, [addSalaryVouchers, selectedStaff]);

  const allSalaryVouchersStaff = useMemo(() => {
    if (!showAllCompanyVouchers) return null;
    return { id: "all", name: "All Voucher", balance: 0, openingBalance: 0 };
  }, [showAllCompanyVouchers]);

  const currentStaff = showAllCompanyVouchers ? (allSalaryVouchersStaff as Staff) : selectedStaff;
  const currentTransactions = showAllCompanyVouchers ? addSalaryVouchers : staffTransactions;

  const unapprovedSalaryByStaff = useMemo(() => {
    const staffIds = new Set(staffWithSalary.map((staff) => staff.id));
    const touchedStaffIds = new Set<string>();
    const byStaffId: Record<string, number> = {};
    let voucherCount = 0;
    if (!showApproveOnList || staffIds.size === 0) {
      return { staffIds: touchedStaffIds, byStaffId, voucherCount };
    }
    for (const voucher of addSalaryVouchers as any[]) {
      if (voucher?.isApproved === true) continue;
      const voucherStaffIds = new Set<string>();
      for (const entry of [...(voucher.entries || []), ...(voucher.lines || [])]) {
        const value = entry?.accountId;
        const id =
          value && typeof value === "object" && "id" in value
            ? String((value as { id?: unknown }).id ?? "").trim()
            : String(value ?? "").trim();
        if (id && staffIds.has(id) && Number(entry?.credit || 0) > 0) voucherStaffIds.add(id);
      }
      const staffId = voucher?.staffId != null && voucher?.staffId !== "" ? String(voucher.staffId).trim() : "";
      if (staffId && staffIds.has(staffId)) voucherStaffIds.add(staffId);
      if (!voucherStaffIds.size) continue;
      voucherCount += 1;
      voucherStaffIds.forEach((id) => {
        touchedStaffIds.add(id);
        byStaffId[id] = (byStaffId[id] ?? 0) + 1;
      });
    }
    return { staffIds: touchedStaffIds, byStaffId, voucherCount };
  }, [addSalaryVouchers, showApproveOnList, staffWithSalary]);

  const filteredStaff = useMemo(
    () =>
      staffWithSalary.filter(
        (s) =>
          (!showOnlyUnapproved || unapprovedSalaryByStaff.staffIds.has(s.id)) &&
          s.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [staffWithSalary, searchTerm, showOnlyUnapproved, unapprovedSalaryByStaff.staffIds]
  );

  const REPORT_MEMORY_KEY = "reportAddSalaryState";

  useEffect(() => {
    if (searchParams.get("allVouchers") === "1") {
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setShowAllCompanyVouchers(true);
        setSelectedStaff(null);
      }
      return;
    }
    if (staffWithSalary.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (isMobile) return; // Mobile: don't auto-select, show list first
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { staffId?: string }) : null;
      const staffId = saved?.staffId;
      if (staffId) {
        const found = staffWithSalary.find((s) => s.id === staffId);
        if (found) {
          setSelectedStaff(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedStaff(staffWithSalary[0]);
  }, [staffWithSalary, isMobile, searchParams]);

  const handleSelectStaff = useCallback((staff: Staff) => {
    setShowAllCompanyVouchers(false);
    setSelectedStaff(staff);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ staffId: staff.id }));
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
    if (currentStaff) {
      return (
        <>
          <div className="flex flex-col h-full min-h-0 overflow-hidden">
            {/* Report mobile: flex chain taaki andar scroll + report footer (Party/Sale jaisa) kaam kare. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <StaffDetails
                staff={currentStaff}
                allStaff={staffWithSalary}
                transactions={currentTransactions}
                onStaffUpdated={() => {}}
                onStaffDeleted={() => { setSelectedStaff(null); setShowAllCompanyVouchers(false); }}
                onShowAll={() => setShowAllCompanyVouchers(true)}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                isAllVouchersView={showAllCompanyVouchers}
                userNames={userNames}
                context="add_salary"
                mobileFooterVariant="report"
                mobileReportStickyTitle={showAllCompanyVouchers ? "All Voucher" : "Add Salary"}
                onBack={() => { setSelectedStaff(null); setShowAllCompanyVouchers(false); }}
                onSelectStaff={(staffId) => {
                  const next = staffWithSalary.find((s) => s.id === staffId);
                  if (next) {
                    setShowAllCompanyVouchers(false);
                    setSelectedStaff(next);
                  }
                }}
              />
            </div>
          </div>
          <AddVoucherDialog isOpen={isVoucherOpen} onOpenChange={setIsVoucherOpen} onVoucherCreated={() => {}} defaultTab="add_salary" />
        </>
      );
    }
    return (
      <>
        <ReportRegisterMobileListChrome
          title="Add Salary"
          actionSlot={
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                {showApproveOnList ? (
                  <PendingApprovalListFilterBadge
                    compact
                    count={unapprovedSalaryByStaff.voucherCount}
                    pressed={showOnlyUnapproved}
                    onToggle={() => setShowOnlyUnapproved((value) => !value)}
                    tooltipFilterHint={`Only staff with unapproved salary vouchers - ${unapprovedSalaryByStaff.voucherCount} voucher(s) (click)`}
                    tooltipShowAllHint="Show all staff (click)"
                    ariaLabelFilter={`Filter ${unapprovedSalaryByStaff.voucherCount} unapproved salary vouchers`}
                    ariaLabelShowAll="Show all staff"
                  />
                ) : null}
              </div>
              <PermissionButton permission="create_records" className="w-full" onClick={() => setIsVoucherOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Salary Voucher
              </PermissionButton>
            </div>
          }
          summary={{
            label: "Total Salary Added",
            /* Mobile chrome summary slot typed as string (see ReportRegisterMobileListChrome) */
            amountText: formatCurrencyForPrint(totalSalaryAdded, { noSuffix: true }),
            amountClassName: "text-blue-600",
          }}
          searchPlaceholder={STAFF_ENTITY_SEARCH_PLACEHOLDER}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          listSectionTitle={`${STAFF_ENTITY_LABEL} (${filteredStaff.length})`}
        >
          <StaffList
            staff={filteredStaff}
            onSelectStaff={handleSelectStaff}
            selectedStaff={selectedStaff}
            searchTerm={searchTerm}
            pendingApprovalByStaffId={unapprovedSalaryByStaff.byStaffId}
          />
        </ReportRegisterMobileListChrome>
        <AddVoucherDialog isOpen={isVoucherOpen} onOpenChange={setIsVoucherOpen} onVoucherCreated={() => {}} defaultTab="add_salary" />
      </>
    );
  }

  return (
    <>
      <ReportStatementDesktopShell
        isMobile={false}
        listChromeRouteKey="staff"
        pageTitle="Add Salary"
        listTab="staff"
        entityTabValue="staff"
        groupTabValue="groups"
        entityTabLabel={STAFF_ENTITY_LABEL}
        hideGroupTab
        hideTabsRow
        onListTabChange={() => {}}
        balance={
          <span className="font-semibold text-blue-600">
            {formatCurrency(totalSalaryAdded, { noSuffix: true })}
          </span>
        }
        searchRowExtras={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="chromePill"
              size="list"
              onClick={() => {
                setShowAllCompanyVouchers(true);
                setSelectedStaff(null);
              }}
            >
              All Voucher
            </Button>
            {showApproveOnList ? (
              <PendingApprovalListFilterBadge
                compact
                count={unapprovedSalaryByStaff.voucherCount}
                pressed={showOnlyUnapproved}
                onToggle={() => setShowOnlyUnapproved((value) => !value)}
                tooltipFilterHint={`Only staff with unapproved salary vouchers - ${unapprovedSalaryByStaff.voucherCount} voucher(s) (click)`}
                tooltipShowAllHint="Show all staff (click)"
                ariaLabelFilter={`Filter ${unapprovedSalaryByStaff.voucherCount} unapproved salary vouchers`}
                ariaLabelShowAll="Show all staff"
              />
            ) : null}
          </div>
        }
        listSearchTerm={searchTerm}
        onListSearchChange={setSearchTerm}
        entitySearchPlaceholder={STAFF_ENTITY_SEARCH_PLACEHOLDER}
        groupSearchPlaceholder={STAFF_ENTITY_SEARCH_PLACEHOLDER}
        entitySectionLabel={
          <div className={mlc.sectionLabelRow}>
            <User className={mlc.sectionIcon} />
            <span>
              {STAFF_ENTITY_LABEL} ({filteredStaff.length})
            </span>
          </div>
        }
        groupSectionLabel={null}
        entityQuickFilter={staffListQuickFilter}
        groupQuickFilter="latest"
        onEntityQuickFilterChange={setStaffListQuickFilter}
        onGroupQuickFilterChange={() => {}}
        summaryCards={[]}
        showSummary={!!currentStaff}
        entityList={
          <StaffList
            staff={filteredStaff}
            onSelectStaff={handleSelectStaff}
            selectedStaff={showAllCompanyVouchers ? null : selectedStaff}
            searchTerm={searchTerm}
            quickFilter={staffListQuickFilter}
            onQuickFilterChange={setStaffListQuickFilter}
            pendingApprovalByStaffId={unapprovedSalaryByStaff.byStaffId}
            hideQuickFilterBar
          />
        }
        groupList={null}
        detailView={
          currentStaff ? (
            <StaffDetails
              staff={currentStaff}
              allStaff={staffWithSalary}
              transactions={currentTransactions}
              onStaffUpdated={() => {}}
              onStaffDeleted={() => setSelectedStaff(null)}
              onShowAll={() => setShowAllCompanyVouchers(true)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              isAllVouchersView={showAllCompanyVouchers}
              userNames={userNames}
              context="add_salary"
              onSelectStaff={(staffId) => {
                const next = staffWithSalary.find((s) => s.id === staffId);
                if (next) {
                  setShowAllCompanyVouchers(false);
                  setSelectedStaff(next);
                }
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <Card className="w-full max-w-md text-center">
                <CardHeader>
                  <CardTitle>Select staff</CardTitle>
                  <CardDescription>Choose a staff from the list to view salary transactions.</CardDescription>
                </CardHeader>
                <CardContent>
                  {staffWithSalary.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No salary vouchers recorded yet. Add a salary voucher to see staff here.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )
        }
      />
      <AddVoucherDialog isOpen={isVoucherOpen} onOpenChange={setIsVoucherOpen} onVoucherCreated={() => {}} defaultTab="add_salary" />
    </>
  );
}
