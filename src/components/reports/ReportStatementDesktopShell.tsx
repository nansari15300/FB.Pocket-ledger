"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { ResponsiveMasterDetail } from "@/components/layout/ResponsiveMasterDetail";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { ReportShowListButton } from "@/components/reports/ReportShowListButton";
import { mlc } from "@/lib/mobileListChrome";
import { cn } from "@/lib/utils";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import type { MasterDetailListRouteKey } from "@/lib/masterDetailListPath";
import { type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { ReportLedgerTxnDetailPane } from "@/components/reports/ReportLedgerTxnDetailPane";
import { REPORT_LIST_SEARCH_INPUT_CN } from "@/components/reports/ReportRegisterListSearchRow";

export type ReportStatementDesktopShellProps = {
  listChromeRouteKey: MasterDetailListRouteKey;
  pageTitle: string;
  listTab: string;
  entityTabValue: string;
  groupTabValue: string;
  entityTabLabel: string;
  groupTabLabel?: string;
  onListTabChange: (tab: string) => void;
  listSearchTerm: string;
  onListSearchChange: (value: string) => void;
  entitySearchPlaceholder: string;
  groupSearchPlaceholder: string;
  entitySectionLabel: React.ReactNode;
  groupSectionLabel: React.ReactNode;
  entityQuickFilter: EntityListQuickFilter;
  groupQuickFilter: EntityListQuickFilter;
  onEntityQuickFilterChange: (filter: EntityListQuickFilter) => void;
  onGroupQuickFilterChange: (filter: EntityListQuickFilter) => void;
  summaryCards: ReportStatementSummaryCardData[];
  showSummary: boolean;
  entityList: React.ReactNode;
  groupList: React.ReactNode;
  detailView: React.ReactNode;
  footer?: React.ReactNode;
  /** Mobile: main master page jaisa full-screen list (row tap -> ledger statement). */
  isMobile?: boolean;
  /** Main master page jaisa header total balance (e.g. Bank & Cash / Parties). */
  balance?: React.ReactNode;
  /** Search ke baad: pink unapproved badge + "+ Add …" button (main list page parity). */
  searchRowExtras?: React.ReactNode;
  /** Entity/Groups ke alawa extra tabs (e.g. "Clearing A/c", "IC / Ac"). */
  extraTabs?: Array<{
    value: string;
    label: React.ReactNode;
    sectionLabel: React.ReactNode;
    list: React.ReactNode;
    searchPlaceholder?: string;
  }>;
  /** Hide the Groups tab for reports that list only individual accounts. */
  hideGroupTab?: boolean;
  /** Remove the tabs row entirely when a report has no tabs or replacement control. */
  hideTabsRow?: boolean;
  /** Hide the shared footer sort row when the entity list renders its own footer controls. */
  hideEntityQuickFilter?: boolean;
  /**
   * Report list pane collapse hone par "Show report list" icon list heading me dikhaya jaaye.
   * Default `false` — icon sirf report list ke collapsed rail me rehta hai, account list headings me nahi.
   */
  showListHeaderToggle?: boolean;
};

/** Party Statement PC layout — tabs + master list + ledger detail (shared by all entity reports). */
export function ReportStatementDesktopShell({
  listChromeRouteKey,
  pageTitle,
  listTab,
  entityTabValue,
  groupTabValue,
  entityTabLabel,
  groupTabLabel = "Groups",
  onListTabChange,
  listSearchTerm,
  onListSearchChange,
  entitySearchPlaceholder,
  groupSearchPlaceholder,
  entitySectionLabel,
  groupSectionLabel,
  entityQuickFilter,
  groupQuickFilter,
  onEntityQuickFilterChange,
  onGroupQuickFilterChange,
  summaryCards: _summaryCards,
  showSummary: _showSummary,
  entityList,
  groupList,
  detailView,
  footer,
  balance = null,
  isMobile = false,
  searchRowExtras,
  extraTabs,
  hideGroupTab = false,
  hideTabsRow = false,
  hideEntityQuickFilter = false,
  showListHeaderToggle = false,
}: ReportStatementDesktopShellProps) {
  const displayPageTitle = /\breport\b/i.test(pageTitle) ? pageTitle : `${pageTitle} Report`;
  const activeExtraTab = extraTabs?.find((t) => t.value === listTab);
  const reportListTabs = (
    <Tabs
      value={listTab}
      onValueChange={(value) =>
        onListTabChange(
          value === groupTabValue || extraTabs?.some((t) => t.value === value) ? value : entityTabValue
        )
      }
      className="w-full"
    >
      <TabsList listChrome>
        <TabsTrigger listChrome value={entityTabValue} className="flex-1">
          {entityTabLabel}
        </TabsTrigger>
        {!hideGroupTab ? (
          <TabsTrigger listChrome value={groupTabValue} className="flex-1">
            {groupTabLabel}
          </TabsTrigger>
        ) : null}
        {extraTabs?.map((t) => (
          <TabsTrigger key={t.value} listChrome value={t.value} className="flex-1">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  const reportSearchInput = (
    <div className={mlc.searchWrap}>
      <Search className={mlc.searchIcon} />
      <Input
        placeholder={
          activeExtraTab
            ? activeExtraTab.searchPlaceholder ?? entitySearchPlaceholder
            : listTab === groupTabValue
              ? groupSearchPlaceholder
              : entitySearchPlaceholder
        }
        listChrome
        listChromeSearch
        className={REPORT_LIST_SEARCH_INPUT_CN}
        value={listSearchTerm}
        onChange={(e) => onListSearchChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );

  const reportSearchRow = (
    <div className={mlc.searchRow}>
      {reportSearchInput}
      {searchRowExtras}
    </div>
  );

  const reportSectionLabel = activeExtraTab
    ? activeExtraTab.sectionLabel
    : listTab === groupTabValue
      ? groupSectionLabel
      : entitySectionLabel;

  /** Search row jaisa vertical inset — cards/tabs dono par same band chrome. */
  const reportListBandChrome = cn(mlc.searchRow, "box-border !gap-0");

  const reportListTabsRow = <div className={reportListBandChrome}>{reportListTabs}</div>;

  const reportListView = (
    <MasterListViewShell
      isMobile={isMobile}
      tabs={isMobile ? reportListTabs : undefined}
      searchRow={reportSearchRow}
      sectionLabel={reportSectionLabel}
      quickFilter={hideEntityQuickFilter && listTab === entityTabValue
        ? undefined
        : listTab === groupTabValue ? groupQuickFilter : entityQuickFilter}
      onQuickFilterChange={listTab === groupTabValue ? onGroupQuickFilterChange : onEntityQuickFilterChange}
    >
      <div className="relative h-full min-h-0 w-full overflow-hidden">
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            listTab !== entityTabValue && "pointer-events-none hidden"
          )}
          aria-hidden={listTab !== entityTabValue}
        >
          {entityList}
        </div>
        <div
          className={cn(
            "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
            listTab !== groupTabValue && "pointer-events-none hidden"
          )}
          aria-hidden={listTab !== groupTabValue}
        >
          {groupList}
        </div>
        {extraTabs?.map((t) => (
          <div
            key={t.value}
            className={cn(
              "absolute inset-0 flex h-full min-h-0 flex-col overflow-hidden",
              listTab !== t.value && "pointer-events-none hidden"
            )}
            aria-hidden={listTab !== t.value}
          >
            {t.list}
          </div>
        ))}
      </div>
    </MasterListViewShell>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ResponsiveMasterDetail
          listChromeRouteKey={listChromeRouteKey}
          title={displayPageTitle}
          balance={balance}
          listHeaderLeading={showListHeaderToggle ? <ReportShowListButton /> : undefined}
          tabsRowClassName="!min-h-0 !border-b-0 !p-0"
          tabs={isMobile || hideTabsRow ? undefined : reportListTabsRow}
          listView={reportListView}
          detailView={<ReportLedgerTxnDetailPane>{detailView}</ReportLedgerTxnDetailPane>}
          isMobile={isMobile}
          mobileListOnly={isMobile}
          mobileTabsDocked={isMobile}
          hasSelectedItem={false}
        />
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );
}
