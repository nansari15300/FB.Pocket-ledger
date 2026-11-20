"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { financialSummaryPillCn } from "./financialSummaryCardStyles";
import { ReportPageExpandButton } from "@/components/reports/ReportPageExpandButton";

type FinancialSummaryHeaderProps = {
  onPrint: () => void;
  onExportPdf: () => void;
  exporting?: boolean;
  printDisabled?: boolean;
};

export function FinancialSummaryHeader({
  onPrint,
  onExportPdf,
  exporting = false,
  printDisabled = false,
}: FinancialSummaryHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Financial Summary</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your business financial position
        </p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <Button type="button" variant="outline" onClick={onPrint} disabled={printDisabled} className={financialSummaryPillCn}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
        <Button type="button" variant="outline" onClick={onExportPdf} disabled={exporting || printDisabled} className={financialSummaryPillCn}>
          <FileDown className="h-4 w-4 mr-2" />
          Export PDF
        </Button>
        <ReportPageExpandButton />
      </div>
    </div>
  );
}

export function FinancialSummaryPrintHeader({
  companyName,
  periodLabel,
  generatedLabel,
}: {
  companyName: string;
  periodLabel: string;
  generatedLabel: string;
}) {
  return (
    <div className="hidden print:block mb-6 border-b pb-4">
      <h1 className="text-xl font-bold">{companyName}</h1>
      <h2 className="text-lg font-semibold mt-1">Financial Summary</h2>
      <p className="text-sm text-muted-foreground">Period: {periodLabel}</p>
      <p className="text-xs text-muted-foreground">Generated: {generatedLabel}</p>
    </div>
  );
}
