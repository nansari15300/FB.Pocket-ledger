"use client";

import React, { useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import { chromeProPillTextMutedCn } from "@/lib/chromePillButton";
import {
  BALANCE_SHEET_DIFF_TRACE_LANGS,
  BALANCE_SHEET_DIFF_TRACE_OTHERS_ACCOUNTS_INTRO,
  type BalanceSheetDiffTraceCardId,
  balanceSheetDiffTraceAccountCountHeaderLabel,
  balanceSheetDiffTraceCardIntro,
  balanceSheetDiffTraceCardTitle,
  balanceSheetDiffTraceOthersAccountsIntroLines,
  balanceSheetDiffTraceOthersAccountsTitle,
  balanceSheetDiffTraceOthersAccountsTitleWithCount,
  balanceSheetDiffTraceFilterTabAll,
  balanceSheetDiffTraceFilterTabOther,
  balanceSheetDiffTraceFilterTabSideConflict,
  balanceSheetDiffTraceFilterTabWithoutOpening,
  balanceSheetDiffTraceFilterTabIntroLines,
  balanceSheetDiffTraceFilterTabIntroTitle,
  type BalanceSheetDiffTraceFilter,
} from "@/lib/reports/balanceSheetDifferenceTraceLocales";
import type { BalanceSheetDiffTraceMainView } from "@/components/reports/opening_trace";

export type TrxnTraceGridRow = {
  accountId: string;
  accountName: string;
  group: string;
  entityType: string;
  ledgerEntityType: string;
  reason: string;
  masterRawOpening: number;
  movementDebit: number;
  movementCredit: number;
  movementDifference: number;
  closing: number;
  closingDifference: number;
  systemGroup: string;
  expectedSide: string;
  isOtherAccount?: boolean;
};

const BS_ACCOUNT_NAME_CLASS = cn("font-light", chromeProPillTextMutedCn);
const BS_TRACE_TABLE_CLASS = "w-full text-xs sm:text-sm";
const BS_TRACE_CARDS_ROW_CLASS = "flex w-max min-w-full items-stretch gap-1";
const BS_TRACE_H_SCROLL_CLASS = "flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-slim-dim";
const BS_TRACE_GRID_SHELL_CLASS = "flex h-full min-h-0 min-w-max w-max min-w-full flex-col overflow-hidden";
const BS_TRACE_BODY_SCROLL_CLASS = "min-h-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-slim-dim";
const BS_TRACE_X_TRACK_CLASS = "shrink-0";
const BS_TRACE_IDENTITY_CARD_CLASS = "w-max shrink-0";
const BS_TRACE_METRIC_CARD_CLASS = "min-w-max shrink-0 flex-1";
const BS_TRACE_AMOUNT_HEAD_CLASS = "min-w-[8.25rem] text-right whitespace-nowrap px-1.5";
const BS_TRACE_DIFF_HEAD_CLASS = "min-w-[8.5rem] text-right whitespace-nowrap px-1.5";
const BS_TRACE_AMOUNT_CELL_CLASS = "min-w-[8.25rem] px-1.5 text-right tabular-nums whitespace-nowrap";
const BS_TRACE_DIFF_CELL_CLASS = "min-w-[8.5rem] px-1.5 text-right tabular-nums whitespace-nowrap";
const BS_TRACE_GROUP_HEAD_CLASS = "text-center whitespace-nowrap px-1.5";
const BS_TRACE_SECTION_DIVIDER_HEAD_CLASS = "border-l border-black/20";
const BS_TRACE_SECTION_DIVIDER_CELL_CLASS = "border-l border-black/20";
const BS_TRACE_ACCOUNT_NAME_MAX_CHARS = 35;
const BS_TRACE_OPENING_EPS = 0.005;
const BS_TRACE_IDENTITY_TABLE_CLASS = "table-fixed";
const BS_TRACE_IDENTITY_COL_ACCOUNT = "max-w-0 overflow-hidden px-1.5";
const BS_TRACE_IDENTITY_COL_ACCOUNT_TEXT = "block truncate whitespace-nowrap";
const BS_TRACE_IDENTITY_COL_GROUP = "px-1.5 whitespace-nowrap";
const BS_TRACE_CHROME_BG_CLASS = "bg-[var(--bs-diff-trace-chrome)]";
const BS_TRACE_TITLE_BAR_CLASS =
  cn(
    "flex h-[1.625rem] shrink-0 items-center justify-center gap-1 border-b border-black/20 px-2 text-center text-[11px] font-semibold leading-none sm:text-xs",
    "bg-[var(--bs-diff-trace-header-blue)]"
  );
const BS_TRACE_HEADER_ROW_CLASS =
  cn(
    "h-[1.625rem] [&>th]:h-[1.625rem] [&>th]:align-middle [&>th]:py-0 [&>th]:leading-none",
    "bg-[var(--bs-diff-trace-header-blue)]",
    "[&>th]:bg-[var(--bs-diff-trace-header-blue)]"
  );
const BS_TRACE_COMPACT_ROW_CLASS =
  "h-[1.625rem] [&>td]:h-[1.625rem] [&>td]:align-middle [&>td]:overflow-visible [&>td]:py-0 [&>td]:leading-none";
const BS_TRACE_GRAND_TOTAL_ROW_CLASS =
  cn(
    BS_TRACE_COMPACT_ROW_CLASS,
    "bg-[var(--bs-diff-trace-total-orange)] font-semibold",
    "[&>td]:bg-[var(--bs-diff-trace-total-orange)]"
  );
const BS_TRACE_BODY_ROW_CLASS =
  "h-[3rem] [&>td]:h-[3rem] [&>td]:align-middle [&>td]:py-0.5 [&>td]:leading-snug";
const BS_TRACE_SUMMARY_ROW_CLASS = cn(
  BS_TRACE_COMPACT_ROW_CLASS,
  BS_TRACE_CHROME_BG_CLASS,
  "font-semibold [&>td]:bg-[var(--bs-diff-trace-chrome)] pointer-events-none"
);

type TraceIdentityLayout = {
  accountColCh: number;
  groupColCh: number;
};

function truncateTraceAccountText(text: string, maxChars = BS_TRACE_ACCOUNT_NAME_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function computeTraceIdentityLayout(rows: TrxnTraceGridRow[], accountCount?: number): TraceIdentityLayout {
  let accountColCh = balanceSheetDiffTraceAccountCountHeaderLabel(
    accountCount ?? rows.length
  ).length;
  let groupColCh = "Group".length;
  for (const row of rows) {
    accountColCh = Math.max(
      accountColCh,
      Math.min(row.accountName.length, BS_TRACE_ACCOUNT_NAME_MAX_CHARS)
    );
    groupColCh = Math.max(groupColCh, row.systemGroup.length);
  }
  return { accountColCh, groupColCh };
}

function traceIdentityCardStyle(layout: TraceIdentityLayout): React.CSSProperties {
  return {
    ["--bs-diff-trace-identity-account-ch" as string]: layout.accountColCh,
    ["--bs-diff-trace-identity-group-ch" as string]: layout.groupColCh,
  };
}

type TraceBand = "header" | "body" | "summary" | "footer" | "full";

/** Net signed balance: Dr − Cr. */
function traceDrMinusCr(debit: number, credit: number): number {
  return Math.round((debit - credit + Number.EPSILON) * 100) / 100;
}

export type TraceRowSetTotals = {
  openingDr: number;
  openingCr: number;
  openingNet: number;
  /** Same cross-card difference in Opening and Closing Difference columns (Closing Dr − Opening Cr). */
  crossDifference: number;
  closingDr: number;
  closingCr: number;
  closingNet: number;
  movementDebit: number;
  movementCredit: number;
  movementDifference: number;
  movementDifferenceDr: number;
  movementDifferenceCr: number;
};

function traceRound2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function traceRowMovementDifferenceDrCr(movementDifference: number) {
  const diff = traceRound2(movementDifference);
  return {
    movementDifferenceDr: diff > 0.005 ? diff : 0,
    movementDifferenceCr: diff < -0.005 ? Math.abs(diff) : 0,
  };
}

/** Signed running balance: previous + Dr − Cr. */
function traceApplyDrCrToSignedBalance(balance: number, dr: number, cr: number): number {
  return traceRound2(balance + dr - cr);
}

function buildTraceAccountEntries(displayRows: TrxnTraceGridRow[]): TraceBodyEntry[] {
  return displayRows.map((row, index) => ({ kind: "account", row, index }));
}

function traceMovementNetDrCr(movementDebit: number, movementCredit: number) {
  const net = traceRound2(movementDebit - movementCredit);
  return traceRowMovementDifferenceDrCr(net);
}

function buildDifferenceRunningBalances(rows: TrxnTraceGridRow[]): number[] {
  let balance = 0;
  return rows.map((row) => {
    const { movementDifferenceDr, movementDifferenceCr } = traceMovementNetDrCr(
      row.movementDebit,
      row.movementCredit
    );
    balance = traceApplyDrCrToSignedBalance(balance, movementDifferenceDr, movementDifferenceCr);
    return balance;
  });
}

function traceRowDrCrAmounts(row: TrxnTraceGridRow) {
  const openingDr = row.masterRawOpening > 0.005 ? row.masterRawOpening : 0;
  const openingCr = row.masterRawOpening < -0.005 ? Math.abs(row.masterRawOpening) : 0;
  const closingDr = row.closing > 0.005 ? row.closing : 0;
  const closingCr = row.closing < -0.005 ? Math.abs(row.closing) : 0;
  return { openingDr, openingCr, closingDr, closingCr };
}

/** Cross-card difference — same Dr/Cr in Opening and Closing Difference (Closing Dr − Opening Cr). */
function traceCrossCardDifference(row: TrxnTraceGridRow): number {
  const { openingDr, openingCr, closingDr, closingCr } = traceRowDrCrAmounts(row);
  const primary = traceDrMinusCr(closingDr, openingCr);
  if (Math.abs(primary) >= 0.005) return primary;
  return traceDrMinusCr(closingCr, openingDr);
}

function computeTraceRowSetTotals(rows: TrxnTraceGridRow[]): TraceRowSetTotals {
  let openingDr = 0;
  let openingCr = 0;
  let crossDifference = 0;
  let closingDr = 0;
  let closingCr = 0;
  let closingNet = 0;
  let movementDebit = 0;
  let movementCredit = 0;
  let movementDifference = 0;
  let movementDifferenceDr = 0;
  let movementDifferenceCr = 0;
  for (const row of rows) {
    const amounts = traceRowDrCrAmounts(row);
    if (amounts.openingDr >= 0.005) openingDr += amounts.openingDr;
    if (amounts.openingCr >= 0.005) openingCr += amounts.openingCr;
    if (amounts.closingDr >= 0.005) closingDr += amounts.closingDr;
    if (amounts.closingCr >= 0.005) closingCr += amounts.closingCr;
    closingNet += row.closing;
    crossDifference += traceCrossCardDifference(row);
    movementDebit += row.movementDebit;
    movementCredit += row.movementCredit;
    movementDifference += row.movementDifference;
    const { movementDifferenceDr: rowDiffDr, movementDifferenceCr: rowDiffCr } =
      traceRowMovementDifferenceDrCr(row.movementDifference);
    movementDifferenceDr += rowDiffDr;
    movementDifferenceCr += rowDiffCr;
  }
  return {
    openingDr,
    openingCr,
    openingNet: openingDr - openingCr,
    crossDifference,
    closingDr,
    closingCr,
    closingNet,
    movementDebit,
    movementCredit,
    movementDifference,
    movementDifferenceDr,
    movementDifferenceCr,
  };
}

type TraceBodyEntry =
  | {
      kind: "summary";
      id: string;
      label: string;
      sublabel?: string;
      totals: TraceRowSetTotals;
    }
  | {
      kind: "account";
      row: TrxnTraceGridRow;
      index: number;
    };

type TraceFooterEntry = {
  id: string;
  label: string;
  totals: TraceRowSetTotals;
  isGrandTotal?: boolean;
};

function trxnTraceRowHasMovement(row: TrxnTraceGridRow): boolean {
  return row.movementDebit >= 0.005 || row.movementCredit >= 0.005;
}

function buildTrxnMovementFooterEntries(rows: TrxnTraceGridRow[]): TraceFooterEntry[] {
  return [
    {
      id: "grand-total",
      label: "Total",
      totals: computeTraceRowSetTotals(rows),
      isGrandTotal: true,
    },
  ];
}

function mergeTraceRowsUnique(
  keyOf: (row: TrxnTraceGridRow) => string,
  ...groups: TrxnTraceGridRow[][]
): TrxnTraceGridRow[] {
  const seen = new Set<string>();
  const merged: TrxnTraceGridRow[] = [];
  for (const group of groups) {
    for (const row of group) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}

function BalanceSheetDiffTraceLangTabs({
  className,
  tabsListClassName,
  contentClassName,
  renderContent,
}: {
  className?: string;
  tabsListClassName?: string;
  contentClassName?: string;
  renderContent: (lang: (typeof BALANCE_SHEET_DIFF_TRACE_LANGS)[number]["value"]) => React.ReactNode;
}) {
  const i18n = usePlI18nOptional();
  return (
    <Tabs defaultValue={introTabLang(i18n?.intro)} className={cn("w-full", className)}>
      <TabsList className={cn("grid h-8 w-full grid-cols-3 sm:h-9", tabsListClassName)}>
        {BALANCE_SHEET_DIFF_TRACE_LANGS.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} className="text-[11px] sm:text-xs">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {BALANCE_SHEET_DIFF_TRACE_LANGS.map(({ value }) => (
        <TabsContent key={value} value={value} className={cn("mt-2", contentClassName)}>
          {renderContent(value)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TraceSectionInfoPopover({
  cardId,
  ariaLabel,
  othersAccountCount,
}: {
  cardId?: BalanceSheetDiffTraceCardId | "others";
  ariaLabel: string;
  othersAccountCount?: number;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="embedded"
          className="text-blue-300 hover:text-blue-400"
          aria-label={ariaLabel}
          title={ariaLabel}
          onClick={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-[min(24rem,calc(100vw-2rem))] p-3 text-left text-xs sm:text-sm leading-relaxed"
        onClick={(e) => e.stopPropagation()}
      >
        <BalanceSheetDiffTraceLangTabs
          tabsListClassName="mb-1"
          contentClassName="space-y-2 text-muted-foreground leading-relaxed"
          renderContent={(lang) => {
            if (cardId === "others") {
              const count = othersAccountCount ?? 0;
              return (
                <>
                  <p className="font-semibold text-foreground">
                    {count > 0
                      ? balanceSheetDiffTraceOthersAccountsTitleWithCount(count, lang)
                      : balanceSheetDiffTraceOthersAccountsTitle(lang)}
                  </p>
                  {(count > 0
                    ? balanceSheetDiffTraceOthersAccountsIntroLines(count, lang)
                    : BALANCE_SHEET_DIFF_TRACE_OTHERS_ACCOUNTS_INTRO[lang]
                  ).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </>
              );
            }
            return (
              <>
                <p className="font-semibold text-foreground">
                  {balanceSheetDiffTraceCardTitle(cardId!, lang)}
                </p>
                {balanceSheetDiffTraceCardIntro(cardId!, lang).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </>
            );
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TraceSectionCard({
  cardId,
  title,
  stickyIdentity,
  identityLayout,
  band = "full",
  children,
  className,
  extraTitleInfo,
  hideTitleBar = false,
}: {
  cardId: BalanceSheetDiffTraceCardId;
  title: string;
  stickyIdentity?: boolean;
  identityLayout?: TraceIdentityLayout;
  band?: TraceBand;
  children: React.ReactNode;
  className?: string;
  extraTitleInfo?: React.ReactNode;
  hideTitleBar?: boolean;
}) {
  return (
    <div
      data-bs-diff-trace-section-card=""
      data-bs-diff-trace-band={band === "full" ? undefined : band}
      data-bs-diff-trace-identity-card={stickyIdentity ? "" : undefined}
      style={stickyIdentity && identityLayout ? traceIdentityCardStyle(identityLayout) : undefined}
      className={cn(
        "flex min-w-max shrink-0 flex-col self-stretch bg-white shadow-sm",
        band === "full" && "overflow-hidden rounded-lg border border-black/30",
        band === "header" && "overflow-hidden rounded-t-lg border border-b-0 border-black/30",
        band === "body" && "overflow-hidden rounded-none border-x border-black/30",
        band === "summary" && "overflow-hidden rounded-none border-x border-t border-black/30",
        band === "footer" && "overflow-hidden rounded-b-lg border border-t-0 border-black/30",
        stickyIdentity && "sticky left-0 z-20",
        className
      )}
    >
      {(!hideTitleBar && (band === "full" || band === "header")) ? (
        <div data-bs-diff-trace-card-title="" className={BS_TRACE_TITLE_BAR_CLASS}>
          <span className={cn(stickyIdentity && "flex-1 text-center")}>{title}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <TraceSectionInfoPopover cardId={cardId} ariaLabel={`${title} — what this section shows`} />
            {extraTitleInfo}
          </span>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function TraceIdentityColGroup({ layout }: { layout: TraceIdentityLayout }) {
  return (
    <colgroup>
      <col style={{ width: `${layout.accountColCh}ch` }} />
      <col style={{ width: `${layout.groupColCh}ch` }} />
    </colgroup>
  );
}

function TraceIdentityTable({
  layout,
  children,
  className,
}: {
  layout: TraceIdentityLayout;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Table
      data-balance-sheet-difference-trace=""
      scrollContainer={false}
      className={cn(BS_TRACE_TABLE_CLASS, BS_TRACE_IDENTITY_TABLE_CLASS, className)}
    >
      <TraceIdentityColGroup layout={layout} />
      {children}
    </Table>
  );
}

function TraceMetricTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Table
      data-balance-sheet-difference-trace=""
      scrollContainer={false}
      className={cn(BS_TRACE_TABLE_CLASS, className)}
    >
      {children}
    </Table>
  );
}

const BS_TRACE_DR_AMOUNT_CLASS = "font-medium text-green-600 dark:text-green-500";
const BS_TRACE_CR_AMOUNT_CLASS = "font-medium text-red-600 dark:text-red-500";

function TraceDrAmountText({
  amount,
  formatAmount,
  className,
  empty = "—",
  showZero = false,
}: {
  amount: number;
  formatAmount: (n: number) => string;
  className?: string;
  empty?: React.ReactNode;
  showZero?: boolean;
}) {
  if (amount < 0.005 && !showZero) return <>{empty}</>;
  return (
    <span className={cn(BS_TRACE_DR_AMOUNT_CLASS, className)}>
      {formatAmount(amount)} Dr
    </span>
  );
}

function TraceCrAmountText({
  amount,
  formatAmount,
  className,
  empty = "—",
  showZero = false,
}: {
  amount: number;
  formatAmount: (n: number) => string;
  className?: string;
  empty?: React.ReactNode;
  showZero?: boolean;
}) {
  if (amount < 0.005 && !showZero) return <>{empty}</>;
  return (
    <span className={cn(BS_TRACE_CR_AMOUNT_CLASS, className)}>
      {formatAmount(amount)} Cr
    </span>
  );
}

function TraceSignedAmountText({
  amount,
  formatAmount,
  className,
  empty = "—",
  showZero = false,
}: {
  amount: number;
  formatAmount: (n: number) => string;
  className?: string;
  empty?: React.ReactNode;
  showZero?: boolean;
}) {
  if (amount > 0.005) {
    return (
      <span className={cn(BS_TRACE_DR_AMOUNT_CLASS, className)}>
        {formatAmount(amount)} Dr
      </span>
    );
  }
  if (amount < -0.005) {
    return (
      <span className={cn(BS_TRACE_CR_AMOUNT_CLASS, className)}>
        {formatAmount(Math.abs(amount))} Cr
      </span>
    );
  }
  if (showZero) {
    return (
      <span className={cn(BS_TRACE_DR_AMOUNT_CLASS, className)}>
        {formatAmount(0)} Dr
      </span>
    );
  }
  return <>{empty}</>;
}

function TraceIdentityHeader({ accountCount }: { accountCount: number }) {
  return (
    <TableHeader data-bs-diff-trace-table-header="">
      <TableRow className={BS_TRACE_HEADER_ROW_CLASS}>
        <TableHead className={BS_TRACE_IDENTITY_COL_ACCOUNT}>
          {balanceSheetDiffTraceAccountCountHeaderLabel(accountCount)}
        </TableHead>
        <TableHead className={BS_TRACE_IDENTITY_COL_GROUP}>Group</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function TraceMovementDifferenceHeader() {
  return (
    <TableHeader data-bs-diff-trace-table-header="">
      <TableRow className={BS_TRACE_HEADER_ROW_CLASS}>
        <TableHead
          colSpan={2}
          className={cn(BS_TRACE_GROUP_HEAD_CLASS, "border-b border-black/20")}
        >
          trxn Movement
        </TableHead>
        <TableHead
          colSpan={3}
          className={cn(
            BS_TRACE_GROUP_HEAD_CLASS,
            BS_TRACE_SECTION_DIVIDER_HEAD_CLASS,
            "border-b border-black/20"
          )}
        >
          Difference
        </TableHead>
      </TableRow>
      <TableRow className={BS_TRACE_HEADER_ROW_CLASS}>
        <TableHead className={BS_TRACE_AMOUNT_HEAD_CLASS}>Dr</TableHead>
        <TableHead className={BS_TRACE_AMOUNT_HEAD_CLASS}>Cr</TableHead>
        <TableHead className={cn(BS_TRACE_AMOUNT_HEAD_CLASS, BS_TRACE_SECTION_DIVIDER_HEAD_CLASS)}>
          Dr
        </TableHead>
        <TableHead className={BS_TRACE_AMOUNT_HEAD_CLASS}>Cr</TableHead>
        <TableHead className={BS_TRACE_DIFF_HEAD_CLASS}>Running Balance</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function TraceMovementDifferenceCells({
  totals,
  row,
  formatAmount,
  className,
  runningBalance,
}: {
  totals?: TraceRowSetTotals;
  row?: TrxnTraceGridRow;
  formatAmount: (n: number) => string;
  className?: string;
  runningBalance: number;
}) {
  const movementDebit = row?.movementDebit ?? totals?.movementDebit ?? 0;
  const movementCredit = row?.movementCredit ?? totals?.movementCredit ?? 0;
  const { movementDifferenceDr: differenceDr, movementDifferenceCr: differenceCr } = row
    ? traceMovementNetDrCr(row.movementDebit, row.movementCredit)
    : {
        movementDifferenceDr: totals?.movementDifferenceDr ?? 0,
        movementDifferenceCr: totals?.movementDifferenceCr ?? 0,
      };

  return (
    <>
      <TableCell className={cn(BS_TRACE_AMOUNT_CELL_CLASS, className)}>
        <TraceDrAmountText amount={movementDebit} formatAmount={formatAmount} showZero />
      </TableCell>
      <TableCell className={cn(BS_TRACE_AMOUNT_CELL_CLASS, className)}>
        <TraceCrAmountText amount={movementCredit} formatAmount={formatAmount} showZero />
      </TableCell>
      <TableCell className={cn(BS_TRACE_AMOUNT_CELL_CLASS, BS_TRACE_SECTION_DIVIDER_CELL_CLASS, className)}>
        <TraceDrAmountText amount={differenceDr} formatAmount={formatAmount} showZero />
      </TableCell>
      <TableCell className={cn(BS_TRACE_AMOUNT_CELL_CLASS, className)}>
        <TraceCrAmountText amount={differenceCr} formatAmount={formatAmount} showZero />
      </TableCell>
      <TableCell
        className={cn(BS_TRACE_DIFF_CELL_CLASS, className)}
        title={
          row
            ? `Running balance = previous balance + ${formatAmount(differenceDr)} Dr − ${formatAmount(differenceCr)} Cr`
            : undefined
        }
      >
        <TraceSignedAmountText amount={runningBalance} formatAmount={formatAmount} showZero />
      </TableCell>
    </>
  );
}

function TraceFilterTabInfoPopover({ tabId }: { tabId: BalanceSheetDiffTraceFilter }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="sm"
          className="h-5 w-5 shrink-0 text-blue-400 hover:text-blue-600"
          aria-label="What this tab shows"
          title="What this tab shows"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[min(26rem,calc(100vw-2rem))] p-3 text-left text-xs sm:text-sm leading-relaxed"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <BalanceSheetDiffTraceLangTabs
          tabsListClassName="mb-1"
          contentClassName="space-y-2"
          renderContent={(lang) => (
            <>
              <p className="font-semibold text-foreground">
                {balanceSheetDiffTraceFilterTabIntroTitle(tabId, lang)}
              </p>
              {balanceSheetDiffTraceFilterTabIntroLines(tabId, lang).map((line, idx) => (
                <p key={idx} className="text-muted-foreground">
                  {line}
                </p>
              ))}
            </>
          )}
        />
      </PopoverContent>
    </Popover>
  );
}

const BS_TRACE_FILTER_TAB_STYLES: Record<
  BalanceSheetDiffTraceFilter,
  { active: string; inactive: string }
> = {
  all: {
    active: "bg-blue-700 text-white border-blue-700 hover:bg-blue-700/90",
    inactive: "border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100",
  },
  conflict: {
    active: "bg-red-700 text-white border-red-700 hover:bg-red-700/90",
    inactive: "border-red-300 bg-red-50 text-red-950 hover:bg-red-100",
  },
  other: {
    active: "bg-green-700 text-white border-green-700 hover:bg-green-700/90",
    inactive: "border-green-300 bg-green-50 text-green-950 hover:bg-green-100",
  },
  noOpening: {
    active: "bg-pink-500 text-white border-pink-500 hover:bg-pink-500/90",
    inactive: "border-pink-300 bg-pink-100 text-pink-900 hover:bg-pink-200",
  },
};

function TraceFilterTabs({
  filter,
  onFilterChange,
  allCount,
  conflictCount,
  otherCount,
  noOpeningCount,
}: {
  filter: BalanceSheetDiffTraceFilter;
  onFilterChange: (filter: BalanceSheetDiffTraceFilter) => void;
  allCount: number;
  conflictCount: number;
  otherCount: number;
  noOpeningCount: number;
}) {
  const tabs: Array<{ id: BalanceSheetDiffTraceFilter; label: string; disabled?: boolean }> = [
    { id: "all", label: balanceSheetDiffTraceFilterTabAll(allCount, "en") },
    { id: "conflict", label: balanceSheetDiffTraceFilterTabSideConflict(conflictCount, "en"), disabled: conflictCount === 0 },
    { id: "other", label: balanceSheetDiffTraceFilterTabOther(otherCount, "en"), disabled: otherCount === 0 },
    {
      id: "noOpening",
      label: balanceSheetDiffTraceFilterTabWithoutOpening(noOpeningCount, "en"),
      disabled: noOpeningCount === 0,
    },
  ];

  return (
    <div
      data-bs-diff-trace-filter-tabs=""
      className="flex shrink-0 flex-wrap gap-1 bg-background px-1 pb-2 pt-0.5"
    >
      {tabs.map(({ id, label, disabled }) => {
        const styles = BS_TRACE_FILTER_TAB_STYLES[id];
        const isActive = filter === id;
        return (
          <div
            key={id}
            className={cn(
              "inline-flex h-8 items-center gap-0.5 rounded-full border pl-2.5 pr-0.5 text-[11px] font-medium sm:text-xs",
              isActive ? styles.active : styles.inactive,
              disabled && "opacity-50"
            )}
          >
            <button
              type="button"
              disabled={disabled}
              className="h-full shrink-0 border-0 bg-transparent p-0 text-inherit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
              onClick={() => onFilterChange(id)}
            >
              {label}
            </button>
            <TraceFilterTabInfoPopover tabId={id} />
          </div>
        );
      })}
    </div>
  );
}

function traceFooterSelectKey(entryId: string): string {
  return `footer:${entryId}`;
}

function diffTraceFooterRowProps(
  footerKey: string,
  isSelected: boolean,
  isHovered: boolean,
  onSelect: () => void,
  onHover: (key: string | null) => void
) {
  return {
    "data-bs-diff-trace-row": "",
    "data-bs-diff-trace-footer-row": "",
    "data-bs-diff-trace-hovered": isHovered && !isSelected ? "" : undefined,
    "data-bs-diff-trace-selected": isSelected ? "" : undefined,
    className: "cursor-pointer",
    onClick: onSelect,
    onMouseEnter: () => onHover(footerKey),
    onMouseLeave: () => onHover(null),
  };
}

function diffTraceRowProps(
  rowKey: string,
  isSelected: boolean,
  isHovered: boolean,
  onSelect: () => void,
  onOpen: () => void,
  onHover: (key: string | null) => void,
  options?: { isOtherAccount?: boolean; isOtherSectionStart?: boolean }
) {
  return {
    "data-bs-diff-trace-row": "",
    "data-bs-diff-trace-body-row": "",
    "data-bs-diff-trace-hovered": isHovered && !isSelected ? "" : undefined,
    "data-bs-diff-trace-selected": isSelected ? "" : undefined,
    "data-bs-diff-trace-other-account": options?.isOtherAccount ? "" : undefined,
    "data-bs-diff-trace-other-section-start": options?.isOtherSectionStart ? "" : undefined,
    className: cn("cursor-pointer", BS_TRACE_BODY_ROW_CLASS),
    onClick: onSelect,
    onDoubleClick: onOpen,
    onMouseEnter: () => onHover(rowKey),
    onMouseLeave: () => onHover(null),
  };
}

export type TrxnTraceGridProps = {
  allOpeningRows: TrxnTraceGridRow[];
  conflictRows: TrxnTraceGridRow[];
  otherRows: TrxnTraceGridRow[];
  noOpeningRows: TrxnTraceGridRow[];
  mainView: BalanceSheetDiffTraceMainView;
  rowKey: (row: TrxnTraceGridRow) => string;
  formatAmount: (n: number) => string;
  selectedKey: string | null;
  hoveredKey: string | null;
  onSelectKey: (key: string | null) => void;
  onOpenRow: (row: TrxnTraceGridRow) => void;
  onHoverKey: (key: string | null) => void;
};

export function TrxnTraceGrid({
  allOpeningRows,
  conflictRows,
  otherRows,
  noOpeningRows,
  mainView,
  rowKey,
  formatAmount,
  selectedKey,
  hoveredKey,
  onSelectKey,
  onOpenRow,
  onHoverKey,
}: TrxnTraceGridProps) {
  const conflictKeySet = useMemo(() => new Set(conflictRows.map(rowKey)), [conflictRows, rowKey]);

  const withoutOpeningTabRows = useMemo(
    () => noOpeningRows.filter((row) => !conflictKeySet.has(rowKey(row))),
    [noOpeningRows, conflictKeySet, rowKey]
  );

  const movementDisplayRows = useMemo(
    () =>
      mergeTraceRowsUnique(
        rowKey,
        allOpeningRows,
        conflictRows,
        otherRows,
        withoutOpeningTabRows
      ).filter(trxnTraceRowHasMovement),
    [allOpeningRows, conflictRows, otherRows, withoutOpeningTabRows, rowKey]
  );

  const displayRows = movementDisplayRows;
  const allCount = movementDisplayRows.length;
  const accountCount = displayRows.length;

  const accountEntries = useMemo(
    () => buildTraceAccountEntries(displayRows),
    [displayRows]
  );

  const differenceRunningBalances = useMemo(
    () => buildDifferenceRunningBalances(displayRows),
    [displayRows]
  );

  const finalDifferentBalance = useMemo(
    () => differenceRunningBalances.at(-1) ?? 0,
    [differenceRunningBalances]
  );

  const footerEntries = useMemo(
    () => buildTrxnMovementFooterEntries(movementDisplayRows),
    [movementDisplayRows]
  );

  const identityLayout = useMemo(
    () =>
      computeTraceIdentityLayout(
        displayRows.length > 0 ? displayRows : movementDisplayRows,
        accountCount
      ),
    [displayRows, movementDisplayRows, accountCount]
  );
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headerTrackRef = useRef<HTMLDivElement>(null);
  const footerTrackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bodyEl = bodyScrollRef.current;
    const headerEl = headerTrackRef.current;
    const footerEl = footerTrackRef.current;
    if (!bodyEl || !headerEl || !footerEl) return;

    const syncScrollbarGutter = () => {
      const gutter = Math.max(0, bodyEl.offsetWidth - bodyEl.clientWidth);
      headerEl.style.paddingRight = `${gutter}px`;
      footerEl.style.paddingRight = `${gutter}px`;
    };

    syncScrollbarGutter();
    const observer = new ResizeObserver(syncScrollbarGutter);
    observer.observe(bodyEl);
    return () => observer.disconnect();
  }, [accountEntries.length, footerEntries.length, identityLayout.accountColCh, identityLayout.groupColCh]);

  const rowInteraction = (row: TrxnTraceGridRow, index: number) => {
    const key = rowKey(row);
    const firstOtherIndex = displayRows.findIndex((r) => r.isOtherAccount);
    return diffTraceRowProps(
      key,
      selectedKey === key,
      hoveredKey === key,
      () => onSelectKey(key),
      () => onOpenRow(row),
      onHoverKey,
      {
        isOtherAccount: row.isOtherAccount,
        isOtherSectionStart: row.isOtherAccount && index === firstOtherIndex,
      }
    );
  };

  const renderIdentityBodyRow = (entry: TraceBodyEntry) => {
    if (entry.kind === "summary") {
      return (
        <TableRow
          key={entry.id}
          data-bs-diff-trace-summary-row=""
          className={BS_TRACE_SUMMARY_ROW_CLASS}
        >
          <TableCell className={BS_TRACE_IDENTITY_COL_ACCOUNT}>
            <span
              className={cn("block font-semibold leading-tight", BS_TRACE_IDENTITY_COL_ACCOUNT_TEXT)}
              title={entry.label.length > BS_TRACE_ACCOUNT_NAME_MAX_CHARS ? entry.label : undefined}
            >
              {truncateTraceAccountText(entry.label)}
            </span>
            {entry.sublabel ? (
              <span className="text-[10px] leading-tight text-muted-foreground">{entry.sublabel}</span>
            ) : null}
          </TableCell>
          <TableCell className={BS_TRACE_IDENTITY_COL_GROUP}>—</TableCell>
        </TableRow>
      );
    }
    const { row, index } = entry;
    return (
      <TableRow key={rowKey(row)} {...rowInteraction(row, index)}>
        <TableCell className={BS_TRACE_IDENTITY_COL_ACCOUNT}>
          <div className="flex h-full min-w-0 flex-col justify-center gap-0 leading-tight">
            <span
              className={cn("font-medium leading-tight", BS_TRACE_IDENTITY_COL_ACCOUNT_TEXT, BS_ACCOUNT_NAME_CLASS)}
              title={row.accountName.length > BS_TRACE_ACCOUNT_NAME_MAX_CHARS ? row.accountName : undefined}
            >
              {truncateTraceAccountText(row.accountName)}
            </span>
            <span className={cn("text-[10px] leading-tight text-muted-foreground", BS_TRACE_IDENTITY_COL_ACCOUNT_TEXT)}>
              {row.entityType} · {row.group}
            </span>
          </div>
        </TableCell>
        <TableCell className={BS_TRACE_IDENTITY_COL_GROUP}>{row.systemGroup}</TableCell>
      </TableRow>
    );
  };

  const renderMovementDifferenceBodyRow = (entry: TraceBodyEntry) => {
    if (entry.kind === "summary") {
      return (
        <TableRow key={entry.id} data-bs-diff-trace-summary-row="" className={BS_TRACE_SUMMARY_ROW_CLASS}>
          <TraceMovementDifferenceCells
            totals={entry.totals}
            formatAmount={formatAmount}
            className="font-semibold"
            runningBalance={finalDifferentBalance}
          />
        </TableRow>
      );
    }
    const { row, index } = entry;
    return (
      <TableRow key={rowKey(row)} {...rowInteraction(row, index)}>
        <TraceMovementDifferenceCells
          row={row}
          formatAmount={formatAmount}
          runningBalance={differenceRunningBalances[index] ?? 0}
        />
      </TableRow>
    );
  };

  const footerRowClass = (entry: TraceFooterEntry) =>
    entry.isGrandTotal ? BS_TRACE_GRAND_TOTAL_ROW_CLASS : BS_TRACE_SUMMARY_ROW_CLASS;

  const footerRowInteraction = (entry: TraceFooterEntry) => {
    const key = traceFooterSelectKey(entry.id);
    return {
      ...diffTraceFooterRowProps(
        key,
        selectedKey === key,
        hoveredKey === key,
        () => onSelectKey(key),
        onHoverKey
      ),
      className: cn("cursor-pointer", footerRowClass(entry)),
    };
  };

  const renderIdentityFooterRow = (entry: TraceFooterEntry) => (
    <TableRow
      key={entry.id}
      {...footerRowInteraction(entry)}
      data-bs-diff-trace-summary-row={entry.isGrandTotal ? undefined : ""}
      data-bs-diff-trace-grand-total-row={entry.isGrandTotal ? "" : undefined}
    >
      <TableCell className={BS_TRACE_IDENTITY_COL_ACCOUNT}>
        <span
          className={cn("block font-semibold leading-tight", BS_TRACE_IDENTITY_COL_ACCOUNT_TEXT)}
          title={entry.label.length > BS_TRACE_ACCOUNT_NAME_MAX_CHARS ? entry.label : undefined}
        >
          {truncateTraceAccountText(entry.label)}
        </span>
      </TableCell>
      <TableCell className={BS_TRACE_IDENTITY_COL_GROUP}>—</TableCell>
    </TableRow>
  );

  const renderMovementDifferenceFooterRow = (entry: TraceFooterEntry) => (
    <TableRow
      key={entry.id}
      {...footerRowInteraction(entry)}
      data-bs-diff-trace-summary-row={entry.isGrandTotal ? undefined : ""}
      data-bs-diff-trace-grand-total-row={entry.isGrandTotal ? "" : undefined}
    >
      <TraceMovementDifferenceCells
        totals={entry.totals}
        formatAmount={formatAmount}
        className="font-semibold"
        runningBalance={finalDifferentBalance}
      />
    </TableRow>
  );

  if (allCount === 0) {
    return (
      <div data-bs-diff-trace-cards-row="" className={BS_TRACE_CARDS_ROW_CLASS}>
        <TraceSectionCard
          cardId="account"
          title="Account & Group"
          stickyIdentity
          identityLayout={identityLayout}
          className={BS_TRACE_IDENTITY_CARD_CLASS}
        >
          <TraceIdentityTable layout={identityLayout}>
            <TraceIdentityHeader accountCount={0} />
            <TableBody>
              <TableRow className={BS_TRACE_BODY_ROW_CLASS}>
                <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                  No accounts with period movement in this date range.
                </TableCell>
              </TableRow>
            </TableBody>
          </TraceIdentityTable>
        </TraceSectionCard>
      </div>
    );
  }

  return (
    <div
      data-bs-diff-trace-main-view={mainView}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div data-bs-diff-trace-h-scroll="" className={BS_TRACE_H_SCROLL_CLASS}>
      <div data-bs-diff-trace-grid-shell="" className={BS_TRACE_GRID_SHELL_CLASS}>
        <div ref={headerTrackRef} data-bs-diff-trace-x-track="header" className={BS_TRACE_X_TRACK_CLASS}>
        <div data-bs-diff-trace-cards-row="" className={BS_TRACE_CARDS_ROW_CLASS}>
          <TraceSectionCard
            cardId="account"
            title="Account & Group"
            band="header"
            stickyIdentity
            identityLayout={identityLayout}
            className={BS_TRACE_IDENTITY_CARD_CLASS}
          >
            <TraceIdentityTable layout={identityLayout}>
              <TraceIdentityHeader accountCount={accountCount} />
            </TraceIdentityTable>
          </TraceSectionCard>
          <TraceSectionCard
            cardId="movement"
            title="Movement & Difference"
            band="header"
            className={BS_TRACE_METRIC_CARD_CLASS}
            hideTitleBar
          >
            <TraceMetricTable>
              <TraceMovementDifferenceHeader />
            </TraceMetricTable>
          </TraceSectionCard>
        </div>
      </div>

      <div ref={bodyScrollRef} data-bs-diff-trace-body-scroll="" className={BS_TRACE_BODY_SCROLL_CLASS}>
        <div data-bs-diff-trace-cards-row="" className={BS_TRACE_CARDS_ROW_CLASS}>
          <TraceSectionCard
            cardId="account"
            title="Account & Group"
            band="body"
            stickyIdentity
            identityLayout={identityLayout}
            className={BS_TRACE_IDENTITY_CARD_CLASS}
          >
            <TraceIdentityTable layout={identityLayout}>
              <TableBody>
                {accountEntries.map((entry) => renderIdentityBodyRow(entry))}
              </TableBody>
            </TraceIdentityTable>
          </TraceSectionCard>

          <TraceSectionCard cardId="movement" title="Movement & Difference" band="body" className={BS_TRACE_METRIC_CARD_CLASS}>
            <TraceMetricTable>
              <TableBody>
                {accountEntries.map((entry) => renderMovementDifferenceBodyRow(entry))}
              </TableBody>
            </TraceMetricTable>
          </TraceSectionCard>
        </div>
      </div>

      <div ref={footerTrackRef} data-bs-diff-trace-x-track="footer" className={BS_TRACE_X_TRACK_CLASS}>
        <div data-bs-diff-trace-cards-row="" className={BS_TRACE_CARDS_ROW_CLASS}>
          <TraceSectionCard
            cardId="account"
            title="Account & Group"
            band="footer"
            stickyIdentity
            identityLayout={identityLayout}
            className={BS_TRACE_IDENTITY_CARD_CLASS}
          >
            <TraceIdentityTable layout={identityLayout}>
              <TableFooter data-bs-diff-trace-table-footer="" className="[&_tr]:border-b-0">
                {footerEntries.map((entry) => renderIdentityFooterRow(entry))}
              </TableFooter>
            </TraceIdentityTable>
          </TraceSectionCard>

          <TraceSectionCard cardId="movement" title="Movement & Difference" band="footer" className={BS_TRACE_METRIC_CARD_CLASS}>
            <TraceMetricTable>
              <TableFooter data-bs-diff-trace-table-footer="" className="[&_tr]:border-b-0">
                {footerEntries.map((entry) => renderMovementDifferenceFooterRow(entry))}
              </TableFooter>
            </TraceMetricTable>
          </TraceSectionCard>
        </div>
      </div>
      </div>
    </div>
    </div>
  );
}
