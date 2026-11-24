"use client";

/**
 * Mobile register lists (Sale / Purchase / Payment / Contra / …):
 * Party statement jaisa sticky top — muted title row, center "All Time" line, summary card, search.
 */
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { mdc } from "@/lib/mobileDetailChrome";
import { REPORT_LIST_SEARCH_INPUT_CN } from "@/components/reports/ReportRegisterListSearchRow";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";

export type ReportRegisterMobileListChromeSummary = {
  label: string;
  amountText: string;
  amountClassName: string;
};

export type ReportRegisterMobileListChromeProps = {
  title: string;
  /** Center line under title; register list defaults to "All Time" (no range on list view). */
  subtitle?: string;
  actionSlot?: ReactNode;
  summary: ReportRegisterMobileListChromeSummary;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  listSectionTitle: string;
  children: ReactNode;
};

export function ReportRegisterMobileListChrome({
  title,
  subtitle = "All Time",
  actionSlot,
  summary,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  listSectionTitle,
  children,
}: ReportRegisterMobileListChromeProps) {
  const reportTitle = /\breport\b/i.test(title) ? title : `${title} Report`;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className={mdc.listHeader}>
        <h1 className={mdc.listTitle}>{reportTitle}</h1>
        {/* Mobile: summary + search + section label collapse — txn list ke liye zyada jagah */}
        <MobileDetailSummaryCollapsible>
          <div className="flex justify-center">
            <span className={mdc.listSubtitle}>{subtitle}</span>
          </div>
          {actionSlot ? <div className="flex flex-col gap-1">{actionSlot}</div> : null}
          <Card className={mdc.listSummaryCard}>
            <p className={mdc.listSummaryLabel}>{summary.label}</p>
            <p className={cn(mdc.listSummaryAmount, summary.amountClassName)}>{summary.amountText}</p>
          </Card>
          <div className={mdc.listSearchRow}>
            <div className={mdc.listSearchWrap}>
              <Search className={mdc.listSearchIcon} />
              <Input
                placeholder={searchPlaceholder}
                listChrome
                listChromeSearch
                className={REPORT_LIST_SEARCH_INPUT_CN}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className={mdc.listSectionRow}>
            <h3 className={mdc.listSectionTitle}>{listSectionTitle}</h3>
          </div>
        </MobileDetailSummaryCollapsible>
      </header>
      <div
        className="flex-1 min-h-0 overflow-hidden"
        data-pl-master-list-chrome=""
        data-pl-report-register-list=""
      >
        {children}
      </div>
    </div>
  );
}
