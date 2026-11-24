"use client";

import * as React from "react";
import { endOfDay, startOfDay } from "date-fns";
import { AlertCircle, Landmark, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { getFiscalRangeForCountry } from "@/lib/fiscalRange";
import { openPrintDirect } from "@/lib/printDirect";
import { computeFinancialSummary } from "@/lib/reports/financialSummary";
import { buildFinancialSummaryPrintContent } from "@/lib/reports/financialSummaryPrint";
import {
  resolveComparisonRange,
  type FinancialSummaryComparisonMode,
  type FinancialSummaryPeriodPreset,
} from "@/lib/reports/financialSummaryPresets";
import { cn } from "@/lib/utils";
import { FinancialSummaryHeader, FinancialSummaryPrintHeader } from "./FinancialSummaryHeader";
import { FinancialSummaryFilters } from "./FinancialSummaryFilters";
import { FinancialSummaryKpiCard } from "./FinancialSummaryKpiCard";
import { ProfitLossSummary } from "./ProfitLossSummary";
import { BalanceSheetSnapshot } from "./BalanceSheetSnapshot";
import { WorkingCapitalSummary } from "./WorkingCapitalSummary";
import { FinancialSummaryChart } from "./FinancialSummaryChart";

function initialRangeForCountry(country?: string | null): DateRange {
  const { start, end } = getFiscalRangeForCountry(country || "Nepal");
  return { from: startOfDay(start), to: endOfDay(end) };
}

type FinancialSummaryPageBodyProps = {
  country?: string | null;
};

function FinancialSummaryPageBody({ country }: FinancialSummaryPageBodyProps) {
  const { company } = useCompany();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const {
    vouchers,
    loading,
    processedParties,
    processedStaff,
    processedTaxes,
    processedAccounts,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedItems,
  } = useFyScopedVouchers();

  const [draftRange, setDraftRange] = React.useState<DateRange | undefined>(() =>
    initialRangeForCountry(country)
  );
  const [appliedRange, setAppliedRange] = React.useState<DateRange | undefined>(() =>
    initialRangeForCountry(country)
  );
  const [preset, setPreset] = React.useState<FinancialSummaryPeriodPreset>("this_fy");
  const [comparisonMode, setComparisonMode] =
    React.useState<FinancialSummaryComparisonMode>("previous_period");
  const [exporting, setExporting] = React.useState(false);

  const handleApply = React.useCallback(() => {
    if (draftRange?.from) {
      setAppliedRange({
        from: startOfDay(draftRange.from),
        to: endOfDay(draftRange.to || draftRange.from),
      });
    }
  }, [draftRange]);

  const summaryResult = React.useMemo(() => {
    if (!appliedRange?.from || loading) return { summary: null, error: null as string | null };
    try {
      const period = {
        from: startOfDay(appliedRange.from),
        to: endOfDay(appliedRange.to || appliedRange.from),
      };
      const comparisonPeriod = resolveComparisonRange(comparisonMode, period, country);
      return {
        summary: computeFinancialSummary({
          vouchers,
          processedParties,
          processedStaff,
          processedTaxes,
          processedAccounts,
          processedExpenseAccounts,
          processedExpenseGroups,
          processedItems,
          period,
          comparisonPeriod,
          dateSystem,
        }),
        error: null as string | null,
      };
    } catch (e) {
      return {
        summary: null,
        error: e instanceof Error ? e.message : "Calculation failed",
      };
    }
  }, [
    appliedRange,
    comparisonMode,
    country,
    loading,
    processedAccounts,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedItems,
    processedParties,
    processedStaff,
    processedTaxes,
    vouchers,
    dateSystem,
  ]);

  const summary = summaryResult.summary;
  const effectiveError = summaryResult.error;

  const periodLabel = React.useMemo(() => {
    if (!appliedRange?.from) return "";
    const from = appliedRange.from;
    const to = appliedRange.to || appliedRange.from;
    if (dateSystem === "BS") return `${formatDateBS(from)} → ${formatDateBS(to)}`;
    if (dateSystem === "Both") {
      return `${formatDate(from)} → ${formatDate(to)} | ${formatDateBS(from)} → ${formatDateBS(to)}`;
    }
    return `${formatDate(from)} → ${formatDate(to)}`;
  }, [appliedRange, dateSystem, formatDate, formatDateBS]);

  const generatedLabel = React.useMemo(() => {
    const now = new Date();
    if (dateSystem === "BS") return formatDateBS(now);
    return formatDate(now);
  }, [dateSystem, formatDate, formatDateBS]);

  const showComparison = comparisonMode !== "none";

  const buildPrintPayload = React.useCallback(() => {
    if (!company || !summary) return null;
    return {
      company: {
        name: company.name,
        pan: company.pan,
        phone: company.phone,
        address: company.address,
        decimalPlaces: company.decimalPlaces,
        showDrCr: company.showDrCr,
        showCurrencySymbol: company.showCurrencySymbol,
        logoUrl: company.logoUrl,
      },
      title: "Financial Summary",
      context: "daybook" as const,
      dateSystem,
      dateRangeText: periodLabel,
      vouchersCount: 0,
      openingBalance: 0,
      transactions: [],
      customContent: buildFinancialSummaryPrintContent(summary, periodLabel),
      printIncludeTitle: true,
    };
  }, [company, summary, dateSystem, periodLabel]);

  const handlePrint = async () => {
    const payload = buildPrintPayload();
    if (!payload) return;
    await openPrintDirect(payload);
  };

  const handleExportPdf = async () => {
    const payload = buildPrintPayload();
    if (!payload) return;
    setExporting(true);
    try {
      await openPrintDirect(payload, true);
    } finally {
      setExporting(false);
    }
  };

  const handleRetry = () => {
    setAppliedRange((r) => (r ? { from: r.from, to: r.to } : r));
  };

  const scrollShellClass = cn(
    /* No top padding and no `space-y` on the shell: the header wrapper below owns the single 8px
     * gap to the pills, so no ancestor class can add to it. */
    "w-full h-full min-h-0 overflow-y-auto overflow-x-hidden pb-[72px] px-4 md:px-6"
  );
  /** Vertical rhythm between report sections (was `space-y-6` before the top-gap fix). */
  const sectionGapClass = "mt-6";

  if (loading) {
    return (
      <div className={scrollShellClass}>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-24 w-full" />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (effectiveError) {
    return (
      <div className={cn(scrollShellClass, "flex flex-col items-center justify-center text-center min-h-[320px]")}>
        <AlertCircle className="h-10 w-10 text-destructive" />
        <div>
          <h2 className="text-lg font-semibold">Unable to load financial summary</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Something went wrong while calculating the report.
          </p>
        </div>
        <Button onClick={handleRetry}>Retry</Button>
      </div>
    );
  }

  return (
    <div className={scrollShellClass} id="financial-summary-report">
      <FinancialSummaryPrintHeader
        companyName={company?.name || "Company"}
        periodLabel={periodLabel}
        generatedLabel={generatedLabel}
      />

      {/* Top 8px gap comes from the reports detail wrapper, so the header sits flush here. */}
      <FinancialSummaryHeader
        onPrint={handlePrint}
        onExportPdf={handleExportPdf}
        exporting={exporting}
        printDisabled={!summary?.hasData}
      />

      <div className={sectionGapClass}>
        <FinancialSummaryFilters
          draftRange={draftRange}
          onDraftRangeChange={setDraftRange}
          onApply={handleApply}
          preset={preset}
          onPresetChange={setPreset}
          comparisonMode={comparisonMode}
          onComparisonModeChange={setComparisonMode}
          country={country}
        />
      </div>

      {!summary?.hasData ? (
        <div className={cn(sectionGapClass, "rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 text-center")}>
          <h2 className="text-lg font-semibold">No financial data for this period</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Try selecting another date range or recording transactions.
          </p>
        </div>
      ) : (
        <>
          <div className={cn(sectionGapClass, "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4")}>
            <FinancialSummaryKpiCard
              title="Revenue"
              value={summary.revenue.total}
              previousValue={showComparison ? summary.revenue.previous : undefined}
              icon={<TrendingUp className="h-4 w-4" />}
              riseIsPositive
            />
            <FinancialSummaryKpiCard
              title="Gross Profit"
              value={summary.grossProfit.total}
              previousValue={showComparison ? summary.grossProfit.previous : undefined}
              icon={<Receipt className="h-4 w-4" />}
              riseIsPositive
            />
            <FinancialSummaryKpiCard
              title="Net Profit"
              value={summary.netProfit.total}
              previousValue={showComparison ? summary.netProfit.previous : undefined}
              icon={<TrendingUp className="h-4 w-4" />}
              riseIsPositive
            />
            <FinancialSummaryKpiCard
              title="Cash + Bank"
              value={summary.cashAndBank.total}
              previousValue={showComparison ? summary.cashAndBank.previous : undefined}
              icon={<Wallet className="h-4 w-4" />}
              riseIsPositive
            />
            <FinancialSummaryKpiCard
              title="Receivable"
              value={summary.receivable.total}
              previousValue={showComparison ? summary.receivable.previous : undefined}
              icon={<Landmark className="h-4 w-4" />}
              riseIsPositive
            />
            <FinancialSummaryKpiCard
              title="Payable"
              value={summary.payable.total}
              previousValue={showComparison ? summary.payable.previous : undefined}
              icon={<TrendingDown className="h-4 w-4" />}
              riseIsPositive={false}
            />
          </div>

          <div className={sectionGapClass}>
            <ProfitLossSummary
              incomeRows={summary.profitLossIncomeRows}
              expenseRows={summary.profitLossExpenseRows}
              revenue={summary.revenue.total}
              directCost={summary.directCost.total}
              grossProfit={summary.grossProfit.total}
              operatingExpenses={summary.operatingExpenses.total}
              operatingProfit={summary.operatingProfit.total}
              financeCost={summary.financeCost.total}
              netProfit={summary.netProfit.total}
            />
          </div>

          <div className={sectionGapClass}>
            <BalanceSheetSnapshot
              assets={summary.assets}
              liabilities={summary.liabilities}
              equity={summary.equity}
              isBalanced={summary.isBalanced}
              balanceDifference={summary.balanceDifference}
            />
          </div>

          <div className={sectionGapClass}>
            <WorkingCapitalSummary workingCapital={summary.workingCapital} />
          </div>

          <div className={sectionGapClass}>
            <FinancialSummaryChart data={summary.monthlyChart} />
          </div>
        </>
      )}
    </div>
  );
}

export function FinancialSummaryPage() {
  const { company } = useCompany();
  return <FinancialSummaryPageBody key={company?.country || "Nepal"} country={company?.country} />;
}

export default FinancialSummaryPage;
