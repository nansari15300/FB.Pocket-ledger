"use client";

import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import { sidebarEntityMenuLabel } from "@/lib/sidebarEntityMenuLabels";
import { chromeProPillTextMutedCn } from "@/lib/chromePillButton";
import { cn } from "@/lib/utils";

import React, { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableCaption,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronUp, ChevronRight, Users, Check, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useDate } from "@/hooks/useDate";
import { BalanceSheetLedgerDetailMirror } from "@/components/reports/BalanceSheetLedgerDetailMirror";
import {
  NESTED_LEDGER_POPUP_ATTR,
  NESTED_LEDGER_POPUP_CONTENT_CN,
  NESTED_LEDGER_POPUP_OVERLAY_CN,
} from "@/lib/nestedLedgerMasterEditPresentation";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useCompany } from "@/hooks/useCompany";
import { useBalanceSheetLedgerLiveRevision } from "@/hooks/useBalanceSheetLedgerLiveRevision";
import { MonthYearFilter } from "@/components/dashboard/MonthYearFilter";
import { openPrintDirect } from "@/lib/printDirect";
import { Printer } from "lucide-react";
import { PrintOptionsDialog } from "@/components/ui/PrintOptionsDialog";
import type { DateRange } from "@/components/ui/ad-calendar";
import { endOfDay } from "date-fns";
import {
  computeBalanceSheetReport,
  computeBalanceSheetNetProfit,
  computeBalanceSheetTotals,
  computeMasterOpeningBalanceAudit,
  computeBalanceSheetRowGapParts,
  type BalanceSheetRow,
  type BalanceSheetUncategorizedAccount,
} from "@/lib/reports/balanceSheetAccounting";
import {
  buildBalanceSheetUncategorizedResavePatch,
  resaveBalanceSheetUncategorizedAccount,
} from "@/lib/reports/balanceSheetUncategorizedResave";
import {
  balanceSheetDisplaySystemGroupCell,
  balanceSheetExpandedLabelColCount,
  balanceSheetFlattenUnderSystemBranch,
  balanceSheetSystemBranchExpandId,
  groupBalanceSheetItemsBySystemBranch,
  sortBalanceSheetExpandedGroupItems,
  type BalanceSheetExpandedColumnFlags,
  type BalanceSheetGroupHierarchyContext,
} from "@/lib/reports/balanceSheetGroupHierarchy";
import {
  balanceSheetIcSearchText,
  BS_IC_COMPANY_GROUP_NAME,
  isBalanceSheetIcCompanyGroupRow,
  isBalanceSheetIcPeerGroupRow,
} from "@/lib/reports/balanceSheetInterCompany";
import {
  computeBalanceSheetDifferenceBreakdown,
} from "@/lib/reports/balanceSheetDifferenceAnalysis";
import {
  computeLedgerEarliestActivityDate,
} from "@/lib/reports/balanceSheetLedgerDateRange";
import {
  BALANCE_SHEET_DIFF_TRACE_LANGS,
  buildBalanceSheetFiscalYearContext,
  balanceSheetDiffTraceReconciliationParagraphs,
  balanceSheetDiffTraceReconciliationTitle,
  balanceSheetOpeningMismatchIntroSummary,
  balanceSheetOpeningMismatchIntroTitle,
} from "@/lib/reports/balanceSheetDifferenceTraceLocales";
import { BalanceSheetFiscalYearDisplay } from "@/components/reports/BalanceSheetFiscalYearDisplay";
import { OpeningTraceGrid } from "@/components/reports/opening_trace";
import { TrxnTraceGrid } from "@/components/reports/trxn_trace";
import { OtherDifferentRemainingTrace } from "@/components/reports/otherDifferentRemainingTrace";
import type { BalanceSheetDiffTraceMainView } from "@/components/reports/opening_trace";
import { runBalanceSheetCheckEngine, type BalanceSheetCheckEngineInput } from "@/lib/reports/balanceSheetCheckEngine";
import { OPENING_BALANCE_SYSTEM_LEDGER_ID } from "@/lib/reports/openingBalanceLedgerAccounts";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import { resolveInterCompanyLegsForVoucher } from "@/lib/interCompany/interCompanyPostingLegs";
import { getRpLedgerDebitCredit, type RpLedgerContext } from "@/lib/receivablesPayablesLedgerAmounts";
import { toast as sonnerToast } from "sonner";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import {
  balanceSheetAccountMatchesQuery,
  balanceSheetGroupMatchesQuery,
  balanceSheetTextMatchesQuery,
  collectBalanceSheetSearchExpandIds,
} from "@/lib/reports/balanceSheetSearch";

/**
 * HELPERS
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNepaliCurrency = (n: number) =>
  n === 0
    ? "-"
    : new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);


function safeToDate(date: any): Date | null {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (date.toDate instanceof Function) return date.toDate();
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Balance Sheet report tables — 1px grid lines (override ui/table 3px defaults). */
const BS_CARD_SHELL_CLASS = "rounded-2xl border border-black w-full overflow-x-auto";
const BS_TABLE_CLASS =
  "[&_tr]:!border-b-[1px] [&_tr]:!border-t-0 [&_tr]:border-black [&_tbody_tr:last-child]:!border-b-0 [&_tfoot_tr:last-child]:!border-b-0 [&_tbody_tr:first-child]:!border-t-0";
const BS_TABLE_FIXED_CLASS = "table-fixed w-full";
const BS_TABLE_HEADER_CLASS = "[&_tr]:!border-b-[1px] [&_tr]:!border-t-0 [&_tr]:border-black";
const BS_TABLE_ROW_CLASS = "!border-b-[1px] !border-t-0 border-black";
const BS_TABLE_FOOTER_ROW_CLASS = "!border-b-[1px] !border-t-0 border-black";
/** Check Difference popup — grid shell owns vertical scroll; header/footer stay fixed. */
const BS_DIFF_TRACE_WRAP_CLASS = "flex min-h-0 flex-1 w-full flex-col overflow-hidden";
const BS_ACCOUNT_NAME_CLASS = cn("font-light", chromeProPillTextMutedCn);
const BS_ACCOUNT_AMOUNT_CLASS = "font-light tabular-nums text-foreground/75";
const BS_ENTITY_TYPE_CLASS = cn("font-light text-xs", chromeProPillTextMutedCn);

function balanceSheetRowEntityLabel(row: BalanceSheetRow): string {
  switch (row.entityType) {
    case "party":
      return sidebarEntityMenuLabel("party");
    case "staff":
      return sidebarEntityMenuLabel("staff");
    case "tax":
      return sidebarEntityMenuLabel("tax");
    case "opening_balance":
      return "Opening Balance";
    case "account":
      return sidebarEntityMenuLabel("bankCash");
    default:
      return "";
  }
}

function BalanceSheetExpandedColGroup({ flags }: { flags: BalanceSheetExpandedColumnFlags }) {
  const labelCount = balanceSheetExpandedLabelColCount(flags);
  const labelPct = 64 / labelCount;
  return (
    <colgroup>
      {Array.from({ length: labelCount }, (_, i) => (
        <col key={i} style={{ width: `${labelPct}%` }} />
      ))}
      <col style={{ width: "18%" }} />
      <col style={{ width: "18%" }} />
    </colgroup>
  );
}

/** Expanded tree: System Group → Parent Group (on branch expand) → Account Name (on parent expand) */
const BS_TREE_INDENT_PARENT_PX = 5;
const BS_TREE_CHEVRON_CLASS = "h-4 w-4 shrink-0";
const BS_LABEL_CELL_CLASS = "max-w-0 overflow-hidden";
const BS_TRUNCATE_LABEL_CLASS = "min-w-0 truncate";

function BalanceSheetTruncatedLabel({
  text,
  leading,
  className,
  textClassName,
  highlightQuery,
}: {
  text: string;
  leading?: React.ReactNode;
  className?: string;
  textClassName?: string;
  highlightQuery?: string;
}) {
  const label =
    highlightQuery?.trim() ? highlightQueryInText(text, highlightQuery) : text;
  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {leading}
      <span className={cn(BS_TRUNCATE_LABEL_CLASS, textClassName)} title={text}>
        {label}
      </span>
    </div>
  );
}

function balanceSheetHighlightCell(text: string, highlightQuery?: string) {
  if (!highlightQuery?.trim()) return text;
  return highlightQueryInText(text, highlightQuery);
}

type BalanceSheetDifferenceTraceRow = {
  accountId: string;
  accountName: string;
  group: string;
  /** Sidebar/menu label for display (Parties, Bank/Cash, …) */
  entityType: string;
  /** Raw entity key for opening ledger detail */
  ledgerEntityType: NonNullable<BalanceSheetRow["entityType"]>;
  reason: string;
  /** FY-adjusted opening used for movement / side-change analysis */
  opening: number;
  /** Raw master opening — matches Opening Balance Mismatch card */
  masterRawOpening: number;
  movementDebit: number;
  movementCredit: number;
  movementDifference: number;
  closing: number;
  closingDifference: number;
  systemGroup: string;
  expectedSide: string;
  actualSide: string;
  /** Listed because no side conflict — shown after conflict rows */
  isOtherAccount?: boolean;
  /** Opening non-zero, movement in period, closing net zero (cleared / settled). */
  isSettledToZero?: boolean;
};

function differenceTraceIsSettledToZero(row: {
  masterRawOpening: number;
  closing: number;
  movementDebit: number;
  movementCredit: number;
}): boolean {
  if (Math.abs(row.masterRawOpening) < 0.005) return false;
  if (Math.abs(row.closing) >= 0.005) return false;
  return row.movementDebit >= 0.005 || row.movementCredit >= 0.005;
}

function signedSide(amount: number): string {
  if (Math.abs(amount) < 0.005) return "—";
  return amount > 0 ? "Dr" : "Cr";
}

function differenceTraceRowKey(row: BalanceSheetDifferenceTraceRow): string {
  if (row.entityType === "Income/Expense") return `expense-${row.accountId}`;
  return `${row.ledgerEntityType}-${row.accountId}`;
}

function differenceTraceMasterEntityLabel(
  traceType: DifferenceTraceMasterOpeningRow["traceType"]
): string {
  switch (traceType) {
    case "party":
      return sidebarEntityMenuLabel("party");
    case "account":
      return sidebarEntityMenuLabel("bankCash");
    case "staff":
      return sidebarEntityMenuLabel("staff");
    case "tax":
      return sidebarEntityMenuLabel("tax");
    case "expense":
      return "Income/Expense";
    default:
      return "";
  }
}

function findBalanceSheetRowForMasterOpening(
  balanceSheetData: BalanceSheetRow[],
  master: DifferenceTraceMasterOpeningRow
): BalanceSheetRow | undefined {
  const accountId = String(master.id ?? "");
  if (!accountId || master.traceType === "expense") return undefined;
  const entityType = master.traceType as NonNullable<BalanceSheetRow["entityType"]>;
  return (
    balanceSheetData.find(
      (row) => !row.isGroup && row.accountId === accountId && row.entityType === entityType
    ) ??
    balanceSheetData.find((row) => !row.isGroup && row.accountId === accountId && row.entityType)
  );
}

type DifferenceTraceMasterMetaContext = {
  processedAccounts: Array<{ id?: string; accountName?: string; groupId?: string }>;
  processedParties: Array<{ id?: string; name?: string; groupId?: string }>;
  processedStaff: Array<{ id?: string; name?: string; groupId?: string }>;
  processedTaxes: Array<{ id?: string; name?: string; groupId?: string }>;
  processedExpenseAccounts: Array<{ id?: string; name?: string; groupId?: string }>;
  processedGroups: Array<{ id?: string; name?: string }>;
  processedAccountGroups: Array<{ id?: string; name?: string }>;
  processedStaffGroups: Array<{ id?: string; name?: string }>;
  processedTaxGroups: Array<{ id?: string; name?: string }>;
  processedExpenseGroups: Array<{ id?: string; name?: string }>;
};

function resolveDifferenceTraceMasterMeta(
  master: DifferenceTraceMasterOpeningRow,
  ctx: DifferenceTraceMasterMetaContext
): { accountName: string; group: string } {
  const accountId = String(master.id ?? "");
  const groupName = (groups: Array<{ id?: string; name?: string }>, groupId?: string) =>
    groups.find((group) => group.id === groupId)?.name ?? "Ungrouped";

  switch (master.traceType) {
    case "account": {
      const account = ctx.processedAccounts.find((item) => item.id === accountId);
      return {
        accountName: String(account?.accountName ?? accountId),
        group: groupName(ctx.processedAccountGroups, account?.groupId),
      };
    }
    case "party": {
      const party = ctx.processedParties.find((item) => item.id === accountId);
      return {
        accountName: String(party?.name ?? accountId),
        group: groupName(ctx.processedGroups, party?.groupId),
      };
    }
    case "staff": {
      const staff = ctx.processedStaff.find((item) => item.id === accountId);
      return {
        accountName: String(staff?.name ?? accountId),
        group: groupName(ctx.processedStaffGroups, staff?.groupId),
      };
    }
    case "tax": {
      const tax = ctx.processedTaxes.find((item) => item.id === accountId);
      return {
        accountName: String(tax?.name ?? accountId),
        group: groupName(ctx.processedTaxGroups, tax?.groupId),
      };
    }
    case "expense": {
      const expense = ctx.processedExpenseAccounts.find((item) => item.id === accountId);
      return {
        accountName: String(expense?.name ?? accountId),
        group: groupName(ctx.processedExpenseGroups, expense?.groupId),
      };
    }
    default:
      return { accountName: accountId, group: "Ungrouped" };
  }
}

/** Every master with raw opening — same population as Opening Balance Mismatch card. */
function buildDifferenceTraceAllOpeningRows(
  balanceSheetData: BalanceSheetRow[],
  fiscalYearStart: Date | undefined,
  masterOpeningRows: DifferenceTraceMasterOpeningRow[],
  openingSplit: { previous: number; current: number },
  filteredVouchers: any[],
  processedTaxes: any[],
  masterMetaCtx: DifferenceTraceMasterMetaContext
): BalanceSheetDifferenceTraceRow[] {
  const rows: BalanceSheetDifferenceTraceRow[] = [];
  const seen = new Set<string>();

  for (const master of masterOpeningRows) {
    const accountId = String(master.id ?? "");
    if (!accountId || accountId === OPENING_BALANCE_SYSTEM_LEDGER_ID) continue;
    const masterRawOpening = round2(Number(master.openingBalance) || 0);
    if (Math.abs(masterRawOpening) < 0.005) continue;

    const bsRow = findBalanceSheetRowForMasterOpening(balanceSheetData, master);
    if (bsRow) {
      const built = buildDifferenceTraceRowFromBalanceSheetRow(
        bsRow,
        fiscalYearStart,
        masterOpeningRows,
        openingSplit,
        filteredVouchers,
        processedTaxes,
        { requireConflictReason: false }
      );
      if (!built) continue;
      const key = differenceTraceRowKey(built);
      if (seen.has(key)) continue;
      seen.add(key);
      const sideChanged = differenceTraceSideChangedReason(built.masterRawOpening, built.closing);
      rows.push(annotateDifferenceTraceOpeningRow(built, sideChanged));
      continue;
    }

    const meta = resolveDifferenceTraceMasterMeta(master, masterMetaCtx);
    const openingDate = safeToDate(master.openingBalanceDate);
    const isCurrentFiscalOpening = Boolean(
      fiscalYearStart && openingDate && openingDate >= fiscalYearStart
    );
    const opening = isCurrentFiscalOpening ? 0 : masterRawOpening;
    const metrics = computeDifferenceTraceMetricsForMasterOpening(
      master,
      fiscalYearStart,
      filteredVouchers,
      processedTaxes
    );
    const isExpense = master.traceType === "expense";
    const sideChanged = differenceTraceSideChangedReason(masterRawOpening, metrics.closing);
    const syntheticBase: BalanceSheetDifferenceTraceRow = {
      accountId,
      accountName: meta.accountName,
      group: meta.group,
      entityType: differenceTraceMasterEntityLabel(master.traceType),
      ledgerEntityType: isExpense
        ? "party"
        : (master.traceType as NonNullable<BalanceSheetRow["entityType"]>),
      reason: "Master opening balance — not listed on Balance Sheet in this period.",
      opening,
      masterRawOpening,
      movementDebit: metrics.movementDebit,
      movementCredit: metrics.movementCredit,
      movementDifference: metrics.movementDifference,
      closing: metrics.closing,
      closingDifference: 0,
      systemGroup: masterRawOpening >= 0 ? "Assets" : "Liabilities",
      expectedSide: masterRawOpening >= 0 ? "Dr / Asset" : "Cr / Liability",
      actualSide: signedSide(metrics.closing),
      isOtherAccount: !sideChanged,
    };
    const synthetic = annotateDifferenceTraceOpeningRow(syntheticBase, sideChanged);
    const key = differenceTraceRowKey(synthetic);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(synthetic);
  }

  return rows.sort((a, b) => {
    const aConflict = differenceTraceSideChangedReason(a.masterRawOpening, a.closing) ? 1 : 0;
    const bConflict = differenceTraceSideChangedReason(b.masterRawOpening, b.closing) ? 1 : 0;
    if (aConflict !== bConflict) return bConflict - aConflict;
    return Math.abs(b.masterRawOpening) - Math.abs(a.masterRawOpening);
  });
}

function differenceTraceSideChangedReason(masterRawOpening: number, closing: number): string | null {
  if (Math.abs(masterRawOpening) < 0.005 || Math.abs(closing) < 0.005) return null;
  const openingSide = signedSide(masterRawOpening);
  const closingSide = signedSide(closing);
  if (openingSide === "—" || closingSide === "—" || openingSide === closingSide) return null;
  return `Opening balance is ${openingSide} but closing balance is ${closingSide} — debit/credit side changed from opening to closing.`;
}

function differenceTraceContext(entityType: BalanceSheetRow["entityType"]): RpLedgerContext | null {
  switch (entityType) {
    case "party":
    case "opening_balance":
      return "party";
    case "account":
      return "account";
    case "staff":
      return "staff";
    case "tax":
      return "tax";
    default:
      return null;
  }
}

type DifferenceTraceMasterOpeningRow = {
  id?: string;
  openingBalance?: number;
  openingBalanceDate?: unknown;
  traceType: BalanceSheetRow["entityType"] | "expense";
};

function buildDifferenceTraceMasterOpeningRows(
  processedAccounts: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedParties: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedStaff: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedTaxes: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedExpenseAccounts: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>
): DifferenceTraceMasterOpeningRow[] {
  return [
    ...processedAccounts.map((item) => ({ ...item, traceType: "account" as const })),
    ...processedParties
      .filter((item) => item.id !== OPENING_BALANCE_SYSTEM_LEDGER_ID)
      .map((item) => ({ ...item, traceType: "party" as const })),
    ...processedStaff.map((item) => ({ ...item, traceType: "staff" as const })),
    ...processedTaxes.map((item) => ({ ...item, traceType: "tax" as const })),
    ...processedExpenseAccounts.map((item) => ({ ...item, traceType: "expense" as const })),
  ];
}

/** Master form opening — same basis as Opening Balance Mismatch card (excludes system OB ledger). */
function readDifferenceTraceMasterRawOpening(
  accountId: string,
  masterOpeningRows: DifferenceTraceMasterOpeningRow[]
): number {
  if (accountId === OPENING_BALANCE_SYSTEM_LEDGER_ID) return 0;
  const source = masterOpeningRows.find((item) => String(item.id) === String(accountId));
  if (!source) return 0;
  return round2(Number(source.openingBalance) || 0);
}

function computeDifferenceTraceMetricsForRow(
  row: BalanceSheetRow,
  fiscalYearStart: Date | undefined,
  masterOpeningRows: DifferenceTraceMasterOpeningRow[],
  openingSplit: { previous: number; current: number },
  filteredVouchers: any[],
  processedTaxes: any[]
): { movementDebit: number; movementCredit: number; movementDifference: number; closing: number } | null {
  if (row.isGroup || !row.entityType) return null;
  const rawOpening = round2(Number(row.openingBalance) || 0);
  const source = masterOpeningRows.find(
    (item) => item.traceType === row.entityType && String(item.id) === String(row.accountId)
  );
  const openingDate = safeToDate(source?.openingBalanceDate);
  const isCurrentFiscalOpening = Boolean(fiscalYearStart && openingDate && openingDate >= fiscalYearStart);
  const isSystemOpeningLedger =
    row.entityType === "opening_balance" && row.accountId === OPENING_BALANCE_SYSTEM_LEDGER_ID;
  const context = differenceTraceContext(row.entityType);
  const movementTotals = context
    ? filteredVouchers.reduce(
        (totals, voucher) => {
          const amounts = getRpLedgerDebitCredit(voucher, row.accountId, context, processedTaxes);
          return {
            debit: totals.debit + amounts.debit,
            credit: totals.credit + amounts.credit,
          };
        },
        { debit: 0, credit: 0 }
      )
    : { debit: 0, credit: 0 };
  let movementDebit = round2(movementTotals.debit);
  let movementCredit = round2(movementTotals.credit);
  if (isSystemOpeningLedger) {
    movementDebit = round2(movementDebit + Math.max(0, -openingSplit.current));
    movementCredit = round2(movementCredit + Math.max(0, openingSplit.current));
  } else if (isCurrentFiscalOpening) {
    movementDebit = round2(movementDebit + Math.max(0, rawOpening));
    movementCredit = round2(movementCredit + Math.max(0, -rawOpening));
  }
  return {
    movementDebit,
    movementCredit,
    movementDifference: round2(movementDebit - movementCredit),
    closing: round2(row.signedBalance),
  };
}

function computeDifferenceTraceMetricsForMasterOpening(
  master: DifferenceTraceMasterOpeningRow,
  fiscalYearStart: Date | undefined,
  filteredVouchers: any[],
  processedTaxes: any[]
): { movementDebit: number; movementCredit: number; movementDifference: number; closing: number } {
  if (master.traceType === "expense") {
    const rawOpening = round2(Number(master.openingBalance) || 0);
    return {
      movementDebit: 0,
      movementCredit: 0,
      movementDifference: 0,
      closing: rawOpening,
    };
  }

  const accountId = String(master.id ?? "");
  const entityType = master.traceType as NonNullable<BalanceSheetRow["entityType"]>;
  const context = differenceTraceContext(entityType);
  const rawOpening = round2(Number(master.openingBalance) || 0);
  const openingDate = safeToDate(master.openingBalanceDate);
  const isCurrentFiscalOpening = Boolean(fiscalYearStart && openingDate && openingDate >= fiscalYearStart);
  const movementTotals = context
    ? filteredVouchers.reduce(
        (totals, voucher) => {
          const amounts = getRpLedgerDebitCredit(voucher, accountId, context, processedTaxes);
          return {
            debit: totals.debit + amounts.debit,
            credit: totals.credit + amounts.credit,
          };
        },
        { debit: 0, credit: 0 }
      )
    : { debit: 0, credit: 0 };
  let movementDebit = round2(movementTotals.debit);
  let movementCredit = round2(movementTotals.credit);
  if (isCurrentFiscalOpening) {
    movementDebit = round2(movementDebit + Math.max(0, rawOpening));
    movementCredit = round2(movementCredit + Math.max(0, -rawOpening));
  }
  const movementDifference = round2(movementDebit - movementCredit);
  const openingForLedger = isCurrentFiscalOpening ? 0 : rawOpening;
  return {
    movementDebit,
    movementCredit,
    movementDifference,
    closing: round2(openingForLedger + movementDifference),
  };
}

function annotateDifferenceTraceOpeningRow(
  row: BalanceSheetDifferenceTraceRow,
  sideChanged: string | null
): BalanceSheetDifferenceTraceRow {
  const isSettledToZero = differenceTraceIsSettledToZero(row);
  let reason = row.reason;
  if (sideChanged) {
    reason = sideChanged;
  } else if (isSettledToZero) {
    reason = "Opening balance settled to zero — movement in this period cleared the balance.";
  } else if (Math.abs(row.closing) >= 0.005) {
    reason = "Opening and closing stay on the same Dr/Cr side — listed under Side Not changed.";
  }
  return {
    ...row,
    isSettledToZero,
    reason,
    isOtherAccount: !sideChanged,
  };
}

function buildDifferenceTraceRowFromBalanceSheetRow(
  row: BalanceSheetRow,
  fiscalYearStart: Date | undefined,
  masterOpeningRows: DifferenceTraceMasterOpeningRow[],
  openingSplit: { previous: number; current: number },
  filteredVouchers: any[],
  processedTaxes: any[],
  options: { requireConflictReason: boolean; isOtherAccount?: boolean }
): BalanceSheetDifferenceTraceRow | null {
  const metrics = computeDifferenceTraceMetricsForRow(
    row,
    fiscalYearStart,
    masterOpeningRows,
    openingSplit,
    filteredVouchers,
    processedTaxes
  );
  if (!metrics) return null;
  const opening = computeDifferenceTraceOpeningForRow(row, fiscalYearStart, masterOpeningRows, openingSplit);
  const masterRawOpening = readDifferenceTraceMasterRawOpening(row.accountId, masterOpeningRows);
  const reason = differenceTraceSideChangedReason(masterRawOpening, metrics.closing);
  if (options.requireConflictReason && !reason) return null;
  if (options.isOtherAccount) {
    if (Math.abs(masterRawOpening) < 0.005) return null;
    const hasActivity =
      Math.abs(metrics.closing) >= 0.005 ||
      metrics.movementDebit >= 0.005 ||
      metrics.movementCredit >= 0.005;
    if (!hasActivity) return null;
  }
  const expectedSide =
    row.ledgerClass === "Asset" ? "Dr / Asset" : row.ledgerClass === "Liability" ? "Cr / Liability" : "Equity";
  const expectedNaturalSide = row.ledgerClass === "Asset" ? "Dr" : row.ledgerClass === "Liability" ? "Cr" : "—";
  const closingDifference =
    expectedNaturalSide !== "—" &&
    signedSide(row.signedBalance) !== "—" &&
    signedSide(row.signedBalance) !== expectedNaturalSide
      ? round2(Math.abs(row.signedBalance))
      : 0;
  return {
    accountId: row.accountId,
    accountName: row.accountName,
    group: row.group || "Ungrouped",
    entityType: balanceSheetRowEntityLabel(row),
    ledgerEntityType: row.entityType!,
    reason:
      reason ??
      "Opening and closing stay on the same Dr/Cr side — listed under Side Not changed.",
    opening,
    masterRawOpening,
    movementDebit: metrics.movementDebit,
    movementCredit: metrics.movementCredit,
    movementDifference: metrics.movementDifference,
    closing: metrics.closing,
    closingDifference,
    systemGroup: row.ledgerClass === "Asset" ? "Assets" : row.ledgerClass === "Liability" ? "Liabilities" : "Equity",
    expectedSide,
    actualSide: signedSide(row.signedBalance),
    isOtherAccount: options.isOtherAccount,
  };
}

function buildDifferenceTraceOpeningContext(
  processedAccounts: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedParties: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedStaff: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedTaxes: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  processedExpenseAccounts: Array<{ id?: string; openingBalance?: number; openingBalanceDate?: unknown }>,
  fiscalYearStart: Date | undefined
) {
  const masterOpeningRows = buildDifferenceTraceMasterOpeningRows(
    processedAccounts,
    processedParties,
    processedStaff,
    processedTaxes,
    processedExpenseAccounts
  );
  const openingSplit = masterOpeningRows.reduce(
    (totals, item) => {
      const amount = Number(item.openingBalance) || 0;
      const openingDate = safeToDate(item.openingBalanceDate);
      const isCurrentFiscalOpening = Boolean(fiscalYearStart && openingDate && openingDate >= fiscalYearStart);
      if (isCurrentFiscalOpening) totals.current += amount;
      else totals.previous += amount;
      return totals;
    },
    { previous: 0, current: 0 }
  );
  return { masterOpeningRows, openingSplit };
}

function balanceSheetTraceRowKey(row: Pick<BalanceSheetRow, "entityType" | "accountId">): string {
  return `${row.entityType}-${row.accountId}`;
}

function computeDifferenceTraceOpeningForRow(
  row: BalanceSheetRow,
  fiscalYearStart: Date | undefined,
  masterOpeningRows: DifferenceTraceMasterOpeningRow[],
  openingSplit: { previous: number; current: number }
): number {
  const rawOpening = round2(Number(row.openingBalance) || 0);
  const source = masterOpeningRows.find(
    (item) => item.traceType === row.entityType && String(item.id) === String(row.accountId)
  );
  const openingDate = safeToDate(source?.openingBalanceDate);
  const isCurrentFiscalOpening = Boolean(fiscalYearStart && openingDate && openingDate >= fiscalYearStart);
  const isSystemOpeningLedger =
    row.entityType === "opening_balance" && row.accountId === OPENING_BALANCE_SYSTEM_LEDGER_ID;
  if (isSystemOpeningLedger) return round2(-openingSplit.previous);
  if (isCurrentFiscalOpening) return 0;
  return rawOpening;
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

/**
 * MAIN BALANCE SHEET PAGE COMPONENT
 */
export function BalanceSheetPage() {
  const {
    vouchers,
    loading,
    processedParties,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedGroups,
    processedAccountGroups,
    processedTaxGroups,
    processedStaffGroups,
    userNames,
    journalAccountNames: voucherJournalAccountNames,
  } = useFyScopedVouchers();
  const { companyId, company } = useCompany();
  const ledgerLiveRevision = useBalanceSheetLedgerLiveRevision(companyId);
  const { dateSystem, formatDate, formatDateBS, formatCurrencyForPrint } = useDate();

  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const [sortBy, setSortBy] = useState<'entity' | 'balance' | 'date'>('entity');
  const [entityFilter, setEntityFilter] = useState<'all' | 'party' | 'account' | 'staff' | 'tax' | 'income' | 'expense'>('all');
  const [activeRow, setActiveRow] = useState<BalanceSheetRow | null>(null);
  const [detailDateRange, setDetailDateRange] = useState<DateRange | undefined>(undefined);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [showDifferenceDetails, setShowDifferenceDetails] = useState(false);
  const [checkDifferenceOpen, setCheckDifferenceOpen] = useState(false);
  const [differenceTraceSelectedKey, setDifferenceTraceSelectedKey] = useState<string | null>(null);
  const [differenceTraceHoveredKey, setDifferenceTraceHoveredKey] = useState<string | null>(null);
  const [differenceTraceMainView, setDifferenceTraceMainView] =
    useState<BalanceSheetDiffTraceMainView>("opening");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [resavingUncategorizedIds, setResavingUncategorizedIds] = useState<Set<string>>(new Set());
  const [recentlyMappedUncategorized, setRecentlyMappedUncategorized] = useState<
    BalanceSheetUncategorizedAccount[]
  >([]);
  const [optimisticGroupOverrides, setOptimisticGroupOverrides] = useState<Record<string, string>>({});
  const [checkEngineVoucher, setCheckEngineVoucher] = useState<any>(null);
  const [checkEngineVoucherOpen, setCheckEngineVoucherOpen] = useState(false);
  const router = useRouter();

  // Reset date range when date system changes
  useEffect(() => {
    setDateRange(undefined);
  }, [dateSystem]);

  useEffect(() => {
    if (!checkDifferenceOpen) {
      setDifferenceTraceSelectedKey(null);
      setDifferenceTraceHoveredKey(null);
      setDifferenceTraceMainView("opening");
    }
  }, [checkDifferenceOpen]);

  // Reset all local state when company changes
  useEffect(() => {
    if (companyId) {
      setQuery("");
      setDateRange(undefined);
      setActiveRow(null);
      setSortDesc(false);
      setResavingUncategorizedIds(new Set());
      setRecentlyMappedUncategorized([]);
      setOptimisticGroupOverrides({});
    }
  }, [companyId]);

  // Balance Sheet is point-in-time: primary cutoff is range end date (not start).
  const asOfDate = useMemo(() => {
    if (!dateRange?.from) return undefined;
    const to = dateRange.to ?? dateRange.from;
    return endOfDay(to);
  }, [dateRange]);

  // Vouchers on/before as-of (for drawer, double-entry check, display context)
  const filteredVouchers = useMemo(() => {
    if (!asOfDate) return vouchers;
    return vouchers.filter((v) => {
      const txDate = safeToDate(v.date);
      return txDate && txDate <= asOfDate;
    });
  }, [vouchers, asOfDate]);

  const accountsForBalanceSheet = useMemo(
    () =>
      processedAccounts.map((acc) =>
        optimisticGroupOverrides[acc.id]
          ? { ...acc, groupId: optimisticGroupOverrides[acc.id] }
          : acc
      ),
    [processedAccounts, optimisticGroupOverrides]
  );

  const partiesForBalanceSheet = useMemo(
    () =>
      processedParties.map((p) =>
        optimisticGroupOverrides[p.id]
          ? { ...p, groupId: optimisticGroupOverrides[p.id] }
          : p
      ),
    [processedParties, optimisticGroupOverrides]
  );

  const staffForBalanceSheet = useMemo(
    () =>
      processedStaff.map((s) =>
        optimisticGroupOverrides[s.id]
          ? { ...s, groupId: optimisticGroupOverrides[s.id] }
          : s
      ),
    [processedStaff, optimisticGroupOverrides]
  );

  const taxesForBalanceSheet = useMemo(
    () =>
      processedTaxes.map((t) =>
        optimisticGroupOverrides[t.id]
          ? { ...t, groupId: optimisticGroupOverrides[t.id] }
          : t
      ),
    [processedTaxes, optimisticGroupOverrides]
  );

  const { rows: balanceSheetData, uncategorized: uncategorizedAccounts } = useMemo(
    () =>
      computeBalanceSheetReport({
        processedAccounts: accountsForBalanceSheet,
        processedParties: partiesForBalanceSheet,
        processedStaff: staffForBalanceSheet,
        processedTaxes: taxesForBalanceSheet,
        processedExpenseAccounts,
        processedExpenseGroups,
        processedGroups,
        processedAccountGroups,
        processedTaxGroups,
        processedStaffGroups,
        vouchers,
        processedTaxesForLedger: processedTaxes,
        asOfDate,
      }),
    [
      accountsForBalanceSheet,
      partiesForBalanceSheet,
      staffForBalanceSheet,
      taxesForBalanceSheet,
      processedExpenseGroups,
      processedGroups,
      processedAccountGroups,
      processedTaxGroups,
      processedStaffGroups,
      vouchers,
      processedTaxes,
      processedExpenseAccounts,
      asOfDate,
      ledgerLiveRevision,
    ]
  );

  const openingBalanceAudit = useMemo(
    () =>
      computeMasterOpeningBalanceAudit([
        ...processedAccounts,
        ...processedParties,
        ...processedStaff,
        ...processedTaxes,
        ...processedExpenseAccounts,
      ]),
    [processedAccounts, processedParties, processedStaff, processedTaxes, processedExpenseAccounts, ledgerLiveRevision]
  );

  const ledgerEarliestDate = useMemo(
    () =>
      computeLedgerEarliestActivityDate(vouchers, [
        ...processedAccounts,
        ...processedParties,
        ...processedStaff,
        ...processedTaxes,
        ...processedExpenseAccounts,
      ]),
    [
      vouchers,
      processedAccounts,
      processedParties,
      processedStaff,
      processedTaxes,
      processedExpenseAccounts,
      ledgerLiveRevision,
    ]
  );

  const companyFiscalYearContext = useMemo(
    () =>
      buildBalanceSheetFiscalYearContext(
        safeToDate((company as Record<string, unknown> | null | undefined)?.fiscalYearStart),
        safeToDate((company as Record<string, unknown> | null | undefined)?.fiscalYearEnd),
        formatDate,
        formatDateBS,
        dateSystem,
        ledgerEarliestDate,
        asOfDate ?? new Date()
      ),
    [company, formatDate, formatDateBS, dateSystem, asOfDate, ledgerEarliestDate]
  );

  const effectiveFiscalYearStart = companyFiscalYearContext.effectiveStart;

  // Opening Balance Entities for Summary Table
  const openingBalanceEntities = useMemo(() => {
    // सबै लेजरहरू जम्मा गर्ने
    const data = [
      ...processedAccounts.map(a => ({ ...a, type: 'Account', accountName: a.accountName })),
      ...processedParties.map(p => ({ ...p, type: 'Party', accountName: p.name })),
      ...processedStaff.map(s => ({ ...s, type: 'Staff', accountName: s.name })),
      ...processedTaxes.map(t => ({ ...t, type: 'Tax', accountName: t.name })),
      ...processedExpenseAccounts.map(e => ({ ...e, type: 'Income/Expense', accountName: e.name }))
    ];
    // केवल ओपनिङ ब्यालेन्स भएका लेजरहरू मात्र फिल्टर गर्ने
    return data.filter(
      (e) =>
        Number(e.openingBalance) !== 0 &&
        (e as { id?: string }).id !== "opening_balance_ledger"
    );
  }, [processedAccounts, processedParties, processedStaff, processedTaxes, processedExpenseAccounts]);

  const netProfit = useMemo(
    () =>
      computeBalanceSheetNetProfit(
        processedExpenseAccounts,
        processedExpenseGroups,
        vouchers,
        processedTaxes,
        asOfDate
      ),
    [processedExpenseAccounts, processedExpenseGroups, vouchers, processedTaxes, asOfDate]
  );
  const doubleEntryCheck = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    const problematicVouchers: Array<{
      id: string;
      type: string;
      voucherNumber: string;
      date: Date | null;
      debit: number;
      credit: number;
      difference: number;
      description: string;
    }> = [];
    
    filteredVouchers.forEach(v => {
      const amount = Number(v.total || v.amount || 0);
      const subTotal = Number(v.subTotal || amount);
      let voucherDebit = 0;
      let voucherCredit = 0;
      
      if (v.type === 'sale') {
        // Sale: Debit Party (total amount), Credit Sales Account (subtotal) + Tax Account (tax)
        const saleSubTotal = subTotal - (v.discount || 0);
        // Calculate tax from lineItems if not directly available
        let taxAmount = Number(v.taxAmount || v.tax || 0);
        if (taxAmount === 0 && v.lineItems && Array.isArray(v.lineItems)) {
          taxAmount = v.lineItems.reduce((sum: number, li: any) => sum + Number(li.taxAmount || 0), 0);
        }
        const saleTotal = saleSubTotal + taxAmount;
        voucherDebit = saleTotal; // Party receives total
        voucherCredit = saleTotal; // Sales account + Tax account = total
        totalDebit += saleTotal;
        totalCredit += saleTotal;
      } else if (v.type === 'purchase') {
        // Purchase: Debit Purchase Account (subtotal) + Tax Account (tax), Credit Party (total)
        const purchaseSubTotal = subTotal - (v.discount || 0);
        // Calculate tax from lineItems if not directly available
        let taxAmount = Number(v.taxAmount || v.tax || 0);
        if (taxAmount === 0 && v.lineItems && Array.isArray(v.lineItems)) {
          taxAmount = v.lineItems.reduce((sum: number, li: any) => sum + Number(li.taxAmount || 0), 0);
        }
        const purchaseTotal = purchaseSubTotal + taxAmount;
        voucherDebit = purchaseTotal; // Purchase account + Tax account = total
        voucherCredit = purchaseTotal; // Party pays total
        totalDebit += purchaseTotal;
        totalCredit += purchaseTotal;
      } else if (v.type === 'payment_in') {
        // Payment In: Debit Account, Credit Party
        voucherDebit = amount;
        voucherCredit = amount;
        totalDebit += amount;
        totalCredit += amount;
      } else if (v.type === 'payment_out') {
        // Payment: Debit Party/Staff, Credit Account
        voucherDebit = amount;
        voucherCredit = amount;
        totalDebit += amount;
        totalCredit += amount;
      } else if (v.type === 'direct_income') {
        // Direct Income: Debit Account, Credit Income Account
        voucherDebit = amount;
        voucherCredit = amount;
        totalDebit += amount;
        totalCredit += amount;
      } else if (v.type === 'direct_expense') {
        // Direct Expense: Debit Expense Account, Credit Account
        voucherDebit = amount;
        voucherCredit = amount;
        totalDebit += amount;
        totalCredit += amount;
      } else if (v.type === 'contra') {
        // Contra: Debit To Account, Credit From Account
        voucherDebit = amount;
        voucherCredit = amount;
        totalDebit += amount;
        totalCredit += amount;
      } else if (v.type === 'journal' && Array.isArray(v.entries)) {
        // Journal: Sum of all entries
        v.entries.forEach((entry: any) => {
          const debit = Number(entry.debit || 0);
          const credit = Number(entry.credit || 0);
          voucherDebit += debit;
          voucherCredit += credit;
          totalDebit += debit;
          totalCredit += credit;
        });
      } else if (v.type === 'add_salary') {
        // Add Salary: handled in journal entries
        if (v.entries && Array.isArray(v.entries)) {
          v.entries.forEach((entry: any) => {
            const debit = Number(entry.debit || 0);
            const credit = Number(entry.credit || 0);
            voucherDebit += debit;
            voucherCredit += credit;
            totalDebit += debit;
            totalCredit += credit;
          });
        }
      } else if (v.type === 'inter_company') {
        const legs = resolveInterCompanyLegsForVoucher(v);
        legs.forEach((leg) => {
          const debit = Number(leg.debit || 0);
          const credit = Number(leg.credit || 0);
          voucherDebit += debit;
          voucherCredit += credit;
          totalDebit += debit;
          totalCredit += credit;
        });
      } else if (v.type === 'adjustment' && Array.isArray(v.entries)) {
        v.entries.forEach((entry: any) => {
          const debit = Number(entry.debit || 0);
          const credit = Number(entry.credit || 0);
          voucherDebit += debit;
          voucherCredit += credit;
          totalDebit += debit;
          totalCredit += credit;
        });
      }
      
      // Check if this voucher is unbalanced
      const voucherDiff = Math.abs(voucherDebit - voucherCredit);
      if (voucherDiff > 0.01) {
        const txDate = safeToDate(v.date);
        
        // Build description with group names
        const descriptionParts: string[] = [];
        if (v.voucherNumber) descriptionParts.push(`Voucher: ${v.voucherNumber}`);
        
        // Get party info with group
        if (v.partyId) {
          const party = processedParties.find(p => p.id === v.partyId);
          if (party) {
            const groupName = party.groupId ? processedGroups.find(g => g.id === party.groupId)?.name : 'Ungrouped';
            descriptionParts.push(`Party: ${party.name} (Group: ${groupName || 'Ungrouped'})`);
          } else {
            descriptionParts.push(`Party: ${v.partyId}`);
          }
        }
        
        // Get account info with group
        if (v.accountId) {
          const account = processedAccounts.find(a => a.id === v.accountId);
          if (account) {
            const groupName = account.groupId ? processedAccountGroups.find(g => g.id === account.groupId)?.name : 'Ungrouped';
            descriptionParts.push(`Account: ${account.accountName} (Group: ${groupName || 'Ungrouped'})`);
          } else {
            descriptionParts.push(`Account: ${v.accountId}`);
          }
        }
        
        // Get staff info with group
        if (v.staffId) {
          const staff = processedStaff.find(s => s.id === v.staffId);
          if (staff) {
            const groupName = staff.groupId ? processedStaffGroups.find(g => g.id === staff.groupId)?.name : 'Ungrouped';
            descriptionParts.push(`Staff: ${staff.name} (Group: ${groupName || 'Ungrouped'})`);
          } else {
            descriptionParts.push(`Staff: ${v.staffId}`);
          }
        }
        
        // Get tax info with group
        if (v.taxAccountId) {
          const tax = processedTaxes.find(t => t.id === v.taxAccountId);
          if (tax) {
            const groupName = tax.groupId ? processedTaxGroups.find(g => g.id === tax.groupId)?.name : 'Ungrouped';
            descriptionParts.push(`Tax: ${tax.name} (Group: ${groupName || 'Ungrouped'})`);
          } else {
            descriptionParts.push(`Tax: ${v.taxAccountId}`);
          }
        }
        
        // Get contra account info with groups
        if (v.type === 'contra') {
          if (v.fromAccountId) {
            const fromAcc = processedAccounts.find(a => a.id === v.fromAccountId);
            if (fromAcc) {
              const groupName = fromAcc.groupId ? processedAccountGroups.find(g => g.id === fromAcc.groupId)?.name : 'Ungrouped';
              descriptionParts.push(`From Account: ${fromAcc.accountName} (Group: ${groupName || 'Ungrouped'})`);
            }
          }
          if (v.toAccountId) {
            const toAcc = processedAccounts.find(a => a.id === v.toAccountId);
            if (toAcc) {
              const groupName = toAcc.groupId ? processedAccountGroups.find(g => g.id === toAcc.groupId)?.name : 'Ungrouped';
              descriptionParts.push(`To Account: ${toAcc.accountName} (Group: ${groupName || 'Ungrouped'})`);
            }
          }
        }
        
        // Get expense/income account info with groups
        if (v.expenseAccountId) {
          const expAcc = processedExpenseAccounts.find(e => e.id === v.expenseAccountId);
          if (expAcc) {
            descriptionParts.push(`Expense Account: ${expAcc.name}`);
          }
        }
        if (v.incomeAccountId) {
          const incAcc = processedExpenseAccounts.find(e => e.id === v.incomeAccountId);
          if (incAcc) {
            descriptionParts.push(`Income Account: ${incAcc.name}`);
          }
        }
        
        // Check journal entries for account groups
        if ((v.type === 'journal' || v.type === 'add_salary') && Array.isArray(v.entries)) {
          const entryAccounts = v.entries.map((e: any) => {
            const acc = processedAccounts.find(a => a.id === e.accountId);
            if (acc) {
              const groupName = acc.groupId ? processedAccountGroups.find(g => g.id === acc.groupId)?.name : 'Ungrouped';
              return `${acc.accountName} (Group: ${groupName || 'Ungrouped'})`;
            }
            return e.accountId || 'Unknown';
          }).filter(Boolean);
          if (entryAccounts.length > 0) {
            descriptionParts.push(`Journal Accounts: ${entryAccounts.join(', ')}`);
          }
        }
        
        problematicVouchers.push({
          id: v.id || '',
          type: v.type,
          voucherNumber: v.voucherNumber || '',
          date: txDate,
          debit: round2(voucherDebit),
          credit: round2(voucherCredit),
          difference: round2(voucherDiff),
          description: `${v.type.toUpperCase()}${descriptionParts.length > 0 ? ' - ' + descriptionParts.join(' | ') : ''}`
        });
      }
    });
    
    return {
      totalDebit: round2(totalDebit),
      totalCredit: round2(totalCredit),
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
      difference: round2(Math.abs(totalDebit - totalCredit)),
      problematicVouchers: problematicVouchers.sort((a, b) => b.difference - a.difference)
    };
  }, [filteredVouchers, processedParties, processedAccounts, processedStaff, processedTaxes, processedGroups, processedAccountGroups, processedTaxGroups, processedStaffGroups, ledgerLiveRevision]);

  const getIcPeerGroupsForCompany = useCallback(
    (companyRow: BalanceSheetRow): BalanceSheetRow[] => {
      if (!companyRow.isBalanceSheetIcCompanyGroup) return [];
      return balanceSheetData.filter(
        (r) =>
          r.isGroup &&
          r.isBalanceSheetIcPeerGroup &&
          r.balanceSheetBranchHint === companyRow.balanceSheetBranchHint
      );
    },
    [balanceSheetData]
  );

  const getAccountsForGroup = useCallback(
    (groupRow: BalanceSheetRow): BalanceSheetRow[] => {
      if (!groupRow.isGroup) return [];

      if (groupRow.isBalanceSheetIcCompanyGroup) {
        return getIcPeerGroupsForCompany(groupRow);
      }

      if (groupRow.isBalanceSheetIcPeerGroup) {
        const peerKey = groupRow.balanceSheetIcPeerGroupKey;
        return balanceSheetData.filter(
          (acc) =>
            !acc.isGroup &&
            acc.entityType === "party" &&
            acc.balanceSheetIcPeerGroupKey === peerKey
        );
      }

      const match = groupRow.accountId.match(/^group_(party|account|tax|staff)_(.+)$/);
      if (!match) return [];

      const [, groupType, groupId] = match;
      const groupName = groupRow.group;

      return balanceSheetData.filter((acc) => {
        if (acc.isGroup) return false;
        if (acc.group === groupName && acc.entityType === groupType) return true;
        if (groupType === "party" && groupId === "equity") {
          return (
            acc.group === groupName &&
            (acc.entityType === "party" || acc.entityType === "opening_balance")
          );
        }
        return false;
      });
    },
    [balanceSheetData, getIcPeerGroupsForCompany]
  );

  const balanceSheetGroupHierarchyCtx = useMemo(
    (): BalanceSheetGroupHierarchyContext => ({
      processedGroups,
      processedAccountGroups,
      processedTaxGroups,
      processedStaffGroups,
    }),
    [processedGroups, processedAccountGroups, processedTaxGroups, processedStaffGroups]
  );

  const filtered = useMemo(() => {
    let sortedData = [...balanceSheetData];

    // Apply sorting based on sortBy
    if (sortBy === 'balance') {
      if (sortDesc) {
        sortedData.sort((a, b) => b.amount - a.amount);
      } else {
        sortedData.sort((a, b) => a.amount - b.amount);
      }
    } else if (sortBy === 'entity') {
      if (sortDesc) {
        sortedData.sort((a, b) => b.accountName.localeCompare(a.accountName));
      } else {
        sortedData.sort((a, b) => a.accountName.localeCompare(b.accountName));
      }
    } else if (sortBy === 'date') {
      // For date sorting, we need to get the latest transaction date for each entity
      // Since we don't have direct date info, we'll sort by entity name as fallback
      // But first, let's try to get dates from transactions
      sortedData.sort((a, b) => {
        const aTransactions = filteredVouchers.filter(v => 
          v.partyId === a.accountId || v.staffId === a.accountId || v.accountId === a.accountId ||
          v.fromAccountId === a.accountId || v.toAccountId === a.accountId || v.taxAccountId === a.accountId ||
          (v.entries || []).some((e: any) => e.accountId === a.accountId)
        );
        const bTransactions = filteredVouchers.filter(v => 
          v.partyId === b.accountId || v.staffId === b.accountId || v.accountId === b.accountId ||
          v.fromAccountId === b.accountId || v.toAccountId === b.accountId || v.taxAccountId === b.accountId ||
          (v.entries || []).some((e: any) => e.accountId === b.accountId)
        );
        
        const aLatestDate = aTransactions.length > 0 
          ? Math.max(...aTransactions.map(t => safeToDate(t.date)?.getTime() || 0))
          : 0;
        const bLatestDate = bTransactions.length > 0 
          ? Math.max(...bTransactions.map(t => safeToDate(t.date)?.getTime() || 0))
          : 0;
        
        if (sortDesc) {
          return bLatestDate - aLatestDate;
        } else {
          return aLatestDate - bLatestDate;
        }
      });
    }

    // Filter to show only group totals (isGroup: true); IC peer rows nest under IC Company
    sortedData = sortedData.filter((r) => r.isGroup === true && !r.isBalanceSheetIcPeerGroup);

    // Filter by entity type (both groups and individual accounts)
    if (entityFilter !== 'all') {
      sortedData = sortedData.filter(r => {
        // Filter both groups and individual accounts by entity type
        if (r.entityType === entityFilter) return true;
        
        // Special case: Opening Balance filter in group view should also show Equity group
        // (since Equity group includes opening balance)
        if ((entityFilter as string) === 'opening_balance' && r.isGroup && r.accountId === 'group_party_equity') {
          return true;
        }
        
        return false;
      });
    }

    if (query.trim()) {
      return sortedData.filter((row) =>
        balanceSheetGroupMatchesQuery(
          row,
          query,
          balanceSheetGroupHierarchyCtx,
          getAccountsForGroup,
          getIcPeerGroupsForCompany
        )
      );
    }

    return sortedData;
  }, [
    balanceSheetData,
    query,
    sortDesc,
    sortBy,
    filteredVouchers,
    entityFilter,
    getAccountsForGroup,
    getIcPeerGroupsForCompany,
    balanceSheetGroupHierarchyCtx,
  ]);
  
  // Main groups (Assets, Liabilities, Equity) for collapsed view
  const mainGroupRows = useMemo((): BalanceSheetRow[] => {
    const byCategory: Record<string, number> = {};
    filtered.forEach((r) => {
      const groupAccounts = getAccountsForGroup(r);
      let sum = 0;
      groupAccounts.forEach((acc) => {
        if (acc.category === "Assets") sum += acc.amount || 0;
        else if (acc.category === "Liabilities" || acc.category === "Equity") sum += Math.abs(acc.amount || 0);
      });
      const cat = r.category;
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += sum;
    });
    const rows: BalanceSheetRow[] = [];
    if ((byCategory["Assets"] || 0) > 0) {
      rows.push({
        accountId: "main_Assets",
        accountName: "Assets",
        group: "Assets",
        category: "Assets",
        ledgerClass: "Asset",
        amount: byCategory["Assets"],
        signedBalance: byCategory["Assets"],
        isGroup: true,
      });
    }
    if ((byCategory["Liabilities"] || 0) > 0) {
      rows.push({
        accountId: "main_Liabilities",
        accountName: "Liabilities",
        group: "Liabilities",
        category: "Liabilities",
        ledgerClass: "Liability",
        amount: byCategory["Liabilities"],
        signedBalance: -byCategory["Liabilities"],
        isGroup: true,
      });
    }
    if ((byCategory["Equity"] || 0) > 0) {
      rows.push({
        accountId: "main_Equity",
        accountName: "Equity",
        group: "Equity",
        category: "Equity",
        ledgerClass: "Equity",
        amount: byCategory["Equity"],
        signedBalance: -byCategory["Equity"],
        isGroup: true,
      });
    }
    return rows;
  }, [filtered, getAccountsForGroup]);

  const getSubGroupsForMain = useCallback(
    (mainCategory: string): BalanceSheetRow[] => filtered.filter((r) => r.category === mainCategory),
    [filtered]
  );

  const balanceSheetSearchQuery = query.trim();
  const balanceSheetShowExpandedTree =
    expandedGroups.size > 0 || balanceSheetSearchQuery.length > 0;

  useLayoutEffect(() => {
    if (!balanceSheetSearchQuery) return;
    const ids = collectBalanceSheetSearchExpandIds(balanceSheetSearchQuery, {
      mainGroupRows,
      getSubGroupsForMain,
      getAccountsForGroup,
      getIcPeerGroupsForCompany,
      ctx: balanceSheetGroupHierarchyCtx,
    });
    if (ids.size > 0) {
      setExpandedGroups(ids);
    }
  }, [
    balanceSheetSearchQuery,
    mainGroupRows,
    getSubGroupsForMain,
    getAccountsForGroup,
    getIcPeerGroupsForCompany,
    balanceSheetGroupHierarchyCtx,
  ]);

  const balanceSheetExpandedColumnFlags = useMemo((): BalanceSheetExpandedColumnFlags => {
    if (!balanceSheetShowExpandedTree) {
      return { showParentGroup: false, showSubGroup: false, showAccountName: false };
    }
    let showParentGroup = false;
    let showSubGroup = false;
    let showAccountName = false;
    for (const main of mainGroupRows) {
      const sorted = sortBalanceSheetExpandedGroupItems(
        getSubGroupsForMain(main.category),
        balanceSheetGroupHierarchyCtx
      );
      for (const item of sorted) {
        const sysId = balanceSheetSystemBranchExpandId(main.accountId, item.systemGroupLabel);
        if (item.parentGroupLabel.trim() && expandedGroups.has(sysId)) {
          showParentGroup = true;
        }
        if (isBalanceSheetIcCompanyGroupRow(item.row) && expandedGroups.has(item.row.accountId)) {
          showSubGroup = true;
        }
        const accounts = getAccountsForGroup(item.row);
        if (accounts.length === 0) continue;
        if (balanceSheetFlattenUnderSystemBranch(item) && expandedGroups.has(sysId)) {
          showAccountName = true;
        }
        if (expandedGroups.has(item.row.accountId)) {
          if (accounts.some((a) => a.isBalanceSheetIcPeerGroup)) showSubGroup = true;
          else showAccountName = true;
        }
      }
    }
    return {
      showParentGroup: showParentGroup || showSubGroup || showAccountName,
      showSubGroup: showSubGroup || showAccountName,
      showAccountName,
    };
  }, [
    balanceSheetShowExpandedTree,
    expandedGroups,
    mainGroupRows,
    getSubGroupsForMain,
    getAccountsForGroup,
    balanceSheetGroupHierarchyCtx,
  ]);

  const balanceSheetAllSystemBranchExpandIds = useMemo(() => {
    return mainGroupRows.flatMap((main) => {
      const sorted = sortBalanceSheetExpandedGroupItems(
        getSubGroupsForMain(main.category),
        balanceSheetGroupHierarchyCtx
      );
      const labels = [...new Set(sorted.map((i) => i.systemGroupLabel.trim()))];
      return labels.map((label) => balanceSheetSystemBranchExpandId(main.accountId, label));
    });
  }, [mainGroupRows, getSubGroupsForMain, balanceSheetGroupHierarchyCtx]);

  const renderExpandedSystemGroupRows = useCallback(
    (main: BalanceSheetRow, columnFlags: BalanceSheetExpandedColumnFlags): React.ReactNode[] => {
      const { showParentGroup, showSubGroup, showAccountName } = columnFlags;
      const searchQ = balanceSheetSearchQuery;
      const mainExpanded = expandedGroups.has(main.accountId);
      const subGroups = getSubGroupsForMain(main.category);
      const hasSubGroups = subGroups.some((r) => getAccountsForGroup(r).length > 0);
      const assetsVal = main.category === "Assets" ? main.amount || 0 : 0;
      const liabVal =
        main.category === "Liabilities" || main.category === "Equity" ? main.amount || 0 : 0;
      const els: React.ReactNode[] = [];

      const sumRowAmounts = (row: BalanceSheetRow) => {
        const groupAccounts = getAccountsForGroup(row);
        let assetsSum = 0;
        let liabilitiesSum = 0;
        if (groupAccounts.length > 0) {
          if (groupAccounts[0]?.isGroup) {
            groupAccounts.forEach((child) => {
              const nested = sumRowAmounts(child);
              assetsSum += nested.assetsSum;
              liabilitiesSum += nested.liabilitiesSum;
            });
          } else {
            groupAccounts.forEach((acc) => {
              if (acc.category === "Assets") assetsSum += acc.amount || 0;
              else if (acc.category === "Liabilities" || acc.category === "Equity")
                liabilitiesSum += acc.amount || 0;
            });
          }
        } else if (row.amount) {
          if (row.category === "Assets") assetsSum += row.amount || 0;
          else if (row.category === "Liabilities" || row.category === "Equity")
            liabilitiesSum += row.amount || 0;
        }
        return { assetsSum, liabilitiesSum };
      };

      if (!mainExpanded) {
        els.push(
          <TableRow
            key={main.accountId}
            className={cn(
              "bg-muted/40 font-semibold cursor-pointer hover:bg-muted/60",
              BS_TABLE_ROW_CLASS
            )}
            onClick={() => {
              setExpandedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(main.accountId)) next.delete(main.accountId);
                else next.add(main.accountId);
                return next;
              });
            }}
          >
            <TableCell className={cn("font-medium text-primary", BS_LABEL_CELL_CLASS)}>
              <BalanceSheetTruncatedLabel
                text={main.accountName}
                highlightQuery={searchQ || undefined}
                leading={
                  <>
                    {hasSubGroups && <ChevronRight className={BS_TREE_CHEVRON_CLASS} />}
                    <Users className={cn(BS_TREE_CHEVRON_CLASS, "text-primary")} />
                  </>
                }
              />
            </TableCell>
            {showParentGroup && <TableCell />}
            {showSubGroup && <TableCell />}
            {showAccountName && <TableCell />}
            <TableCell className="text-right tabular-nums">
              {assetsVal > 0 ? toNepaliCurrency(assetsVal) : "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {liabVal > 0 ? toNepaliCurrency(liabVal) : "-"}
            </TableCell>
          </TableRow>
        );
        return els;
      }

      const sortedItems = sortBalanceSheetExpandedGroupItems(
        subGroups,
        balanceSheetGroupHierarchyCtx
      );
      const systemBranches = groupBalanceSheetItemsBySystemBranch(sortedItems);

      systemBranches.forEach(({ systemGroupLabel, items }) => {
        const sysExpandId = balanceSheetSystemBranchExpandId(main.accountId, systemGroupLabel);
        const branchMatchesSearch =
          !searchQ ||
          balanceSheetTextMatchesQuery(systemGroupLabel, searchQ) ||
          items.some(({ row }) =>
            balanceSheetGroupMatchesQuery(
              row,
              searchQ,
              balanceSheetGroupHierarchyCtx,
              getAccountsForGroup,
              getIcPeerGroupsForCompany
            )
          );
        if (!branchMatchesSearch) return;

        const sysExpanded = expandedGroups.has(sysExpandId);
        let branchAssets = 0;
        let branchLiab = 0;
        items.forEach(({ row }) => {
          const { assetsSum, liabilitiesSum } = sumRowAmounts(row);
          branchAssets += assetsSum;
          branchLiab += liabilitiesSum;
        });
        const branchHasChildren = items.length > 0;

        els.push(
          <TableRow
            key={sysExpandId}
            className={cn(
              "bg-muted/40 font-semibold cursor-pointer hover:bg-muted/60",
              BS_TABLE_ROW_CLASS
            )}
            onClick={() => {
              if (!branchHasChildren) return;
              setExpandedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(sysExpandId)) next.delete(sysExpandId);
                else next.add(sysExpandId);
                return next;
              });
            }}
          >
            <TableCell className={cn("font-medium text-primary", BS_LABEL_CELL_CLASS)}>
              <BalanceSheetTruncatedLabel
                text={systemGroupLabel}
                highlightQuery={searchQ || undefined}
                leading={
                  branchHasChildren ? (
                    sysExpanded ? (
                      <ChevronDown className={BS_TREE_CHEVRON_CLASS} />
                    ) : (
                      <ChevronRight className={BS_TREE_CHEVRON_CLASS} />
                    )
                  ) : undefined
                }
              />
            </TableCell>
            {showParentGroup && <TableCell />}
            {showSubGroup && <TableCell />}
            {showAccountName && <TableCell />}
            <TableCell className="text-right tabular-nums">
              {!sysExpanded && branchAssets > 0 ? toNepaliCurrency(branchAssets) : "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {!sysExpanded && branchLiab > 0 ? toNepaliCurrency(branchLiab) : "-"}
            </TableCell>
          </TableRow>
        );

        if (!sysExpanded) return;

        const renderedAccountIds = new Set<string>();

        const renderAccountRows = (accounts: BalanceSheetRow[], parentRowId: string) => {
          accounts.forEach((acc) => {
            if (searchQ && !balanceSheetAccountMatchesQuery(acc, searchQ)) return;
            if (renderedAccountIds.has(acc.accountId)) return;
            renderedAccountIds.add(acc.accountId);

            const isIcAccount = Boolean(acc.balanceSheetIcPeerGroupKey);
            const parentLabel = isIcAccount
              ? acc.balanceSheetIcParentGroup || BS_IC_COMPANY_GROUP_NAME
              : balanceSheetRowEntityLabel(acc);
            const subGroupLabel = isIcAccount ? acc.group : "";

            els.push(
              <TableRow
                key={`bs-acc:${sysExpandId}:${parentRowId}:${acc.accountId}`}
                className={cn(
                  "bg-muted/20 text-sm cursor-pointer hover:bg-muted/40",
                  BS_TABLE_ROW_CLASS
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  openDetail(acc);
                }}
              >
                <TableCell />
                {showParentGroup && (
                  <TableCell className={cn(BS_ENTITY_TYPE_CLASS, BS_LABEL_CELL_CLASS)}>
                    <span className={BS_TRUNCATE_LABEL_CLASS} title={parentLabel}>
                      {balanceSheetHighlightCell(parentLabel, searchQ || undefined)}
                    </span>
                  </TableCell>
                )}
                {showSubGroup && (
                  <TableCell className={cn(BS_ENTITY_TYPE_CLASS, BS_LABEL_CELL_CLASS)}>
                    <span className={BS_TRUNCATE_LABEL_CLASS} title={subGroupLabel}>
                      {balanceSheetHighlightCell(subGroupLabel, searchQ || undefined)}
                    </span>
                  </TableCell>
                )}
                {showAccountName && (
                  <TableCell className={cn(BS_ACCOUNT_NAME_CLASS, BS_LABEL_CELL_CLASS)}>
                    <span className={BS_TRUNCATE_LABEL_CLASS} title={acc.accountName}>
                      {balanceSheetHighlightCell(acc.accountName, searchQ || undefined)}
                    </span>
                  </TableCell>
                )}
                <TableCell className={cn("text-right", BS_ACCOUNT_AMOUNT_CLASS)}>
                  {acc.category === "Assets" ? toNepaliCurrency(acc.amount || 0) : "-"}
                </TableCell>
                <TableCell className={cn("text-right", BS_ACCOUNT_AMOUNT_CLASS)}>
                  {acc.category !== "Assets" ? toNepaliCurrency(acc.amount || 0) : "-"}
                </TableCell>
              </TableRow>
            );
          });
        };

        const renderIcPeerRows = (companyRow: BalanceSheetRow) => {
          const peerRows = getIcPeerGroupsForCompany(companyRow);
          peerRows.forEach((peer) => {
            if (
              searchQ &&
              !balanceSheetGroupMatchesQuery(
                peer,
                searchQ,
                balanceSheetGroupHierarchyCtx,
                getAccountsForGroup
              )
            ) {
              return;
            }
            const isPeerExpanded = expandedGroups.has(peer.accountId);
            const peerAccounts = getAccountsForGroup(peer);
            const { assetsSum, liabilitiesSum } = sumRowAmounts(peer);

            els.push(
              <TableRow
                key={`bs-ic-peer:${sysExpandId}:${peer.accountId}`}
                className={cn(
                  "bg-muted/25 font-semibold cursor-pointer hover:bg-muted/45",
                  BS_TABLE_ROW_CLASS
                )}
                onClick={() => {
                  if (peerAccounts.length === 0) return;
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(peer.accountId)) next.delete(peer.accountId);
                    else next.add(peer.accountId);
                    return next;
                  });
                }}
              >
                <TableCell />
                {showParentGroup && <TableCell />}
                {showSubGroup && (
                  <TableCell
                    className={cn("font-medium text-primary", BS_LABEL_CELL_CLASS)}
                    style={{ paddingLeft: BS_TREE_INDENT_PARENT_PX }}
                  >
                    <BalanceSheetTruncatedLabel
                      text={peer.accountName}
                      highlightQuery={searchQ || undefined}
                      leading={
                        peerAccounts.length > 0 ? (
                          isPeerExpanded ? (
                            <ChevronDown className={BS_TREE_CHEVRON_CLASS} />
                          ) : (
                            <ChevronRight className={BS_TREE_CHEVRON_CLASS} />
                          )
                        ) : undefined
                      }
                    />
                  </TableCell>
                )}
                {showAccountName && <TableCell />}
                <TableCell className="text-right tabular-nums">
                  {isPeerExpanded ? "-" : assetsSum > 0 ? toNepaliCurrency(assetsSum) : "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {isPeerExpanded
                    ? "-"
                    : liabilitiesSum > 0
                      ? toNepaliCurrency(liabilitiesSum)
                      : "-"}
                </TableCell>
              </TableRow>
            );

            if (isPeerExpanded && peerAccounts.length > 0) {
              renderAccountRows(peerAccounts, peer.accountId);
            }
          });
        };

        items.forEach((item) => {
          const { row: r, parentGroupLabel } = item;
          if (
            searchQ &&
            !balanceSheetGroupMatchesQuery(
              r,
              searchQ,
              balanceSheetGroupHierarchyCtx,
              getAccountsForGroup,
              getIcPeerGroupsForCompany
            )
          ) {
            return;
          }
          const isParentExpanded = expandedGroups.has(r.accountId);
          const groupAccounts = getAccountsForGroup(r);
          const { assetsSum, liabilitiesSum } = sumRowAmounts(r);
          const hasAccounts = groupAccounts.length > 0;
          const flatten = balanceSheetFlattenUnderSystemBranch(item);
          const isIcCompany = isBalanceSheetIcCompanyGroupRow(r);

          if (flatten && !isIcCompany) {
            if (hasAccounts) renderAccountRows(groupAccounts, r.accountId);
            return;
          }

          if (!parentGroupLabel.trim() && !hasAccounts && !isIcCompany) return;

          els.push(
            <TableRow
              key={`bs-parent:${sysExpandId}:${r.accountId}`}
              className={cn(
              "bg-muted/30 font-semibold cursor-pointer hover:bg-muted/50",
              BS_TABLE_ROW_CLASS
            )}
              onClick={() => {
                if (hasAccounts || isIcCompany) {
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.accountId)) next.delete(r.accountId);
                    else next.add(r.accountId);
                    return next;
                  });
                }
              }}
            >
              <TableCell />
              {showParentGroup && (
                <TableCell
                  className={cn("font-medium text-primary", BS_LABEL_CELL_CLASS)}
                  style={{ paddingLeft: BS_TREE_INDENT_PARENT_PX }}
                >
                  <BalanceSheetTruncatedLabel
                    text={isIcCompany ? BS_IC_COMPANY_GROUP_NAME : parentGroupLabel}
                    highlightQuery={searchQ || undefined}
                    leading={
                      hasAccounts || isIcCompany ? (
                        isParentExpanded ? (
                          <ChevronDown className={BS_TREE_CHEVRON_CLASS} />
                        ) : (
                          <ChevronRight className={BS_TREE_CHEVRON_CLASS} />
                        )
                      ) : undefined
                    }
                  />
                </TableCell>
              )}
              {showSubGroup && <TableCell />}
              {showAccountName && <TableCell />}
              <TableCell className="text-right tabular-nums">
                {isParentExpanded ? "-" : assetsSum > 0 ? toNepaliCurrency(assetsSum) : "-"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {isParentExpanded
                  ? "-"
                  : liabilitiesSum > 0
                    ? toNepaliCurrency(liabilitiesSum)
                    : "-"}
              </TableCell>
            </TableRow>
          );

          if (isParentExpanded && isIcCompany) {
            renderIcPeerRows(r);
            return;
          }

          if (isParentExpanded && hasAccounts && !groupAccounts[0]?.isGroup) {
            renderAccountRows(groupAccounts, r.accountId);
          }
        });
      });

      return els;
    },
    [
      balanceSheetSearchQuery,
      expandedGroups,
      getSubGroupsForMain,
      getAccountsForGroup,
      getIcPeerGroupsForCompany,
      balanceSheetGroupHierarchyCtx,
    ]
  );

  const balanceSheetExpandedTableHead = (columnFlags: BalanceSheetExpandedColumnFlags) => (
    <TableRow className={BS_TABLE_ROW_CLASS}>
      <TableHead>System Group</TableHead>
      {columnFlags.showParentGroup && <TableHead>Parent Group</TableHead>}
      {columnFlags.showSubGroup && <TableHead>Sub Group</TableHead>}
      {columnFlags.showAccountName && <TableHead>Account Name</TableHead>}
      <TableHead className="text-right">Assets</TableHead>
      <TableHead className="text-right">Liabilities + Equity</TableHead>
    </TableRow>
  );

  const totals = useMemo(
    () => computeBalanceSheetTotals(balanceSheetData, netProfit),
    [balanceSheetData, netProfit]
  );

  const differenceBreakdown = useMemo(
    () =>
      computeBalanceSheetDifferenceBreakdown({
        totals,
        openingBalanceAudit,
        uncategorizedAccounts,
        doubleEntryCheck,
        vouchers: filteredVouchers,
        openingBalanceEntities,
      }),
    [
      totals,
      openingBalanceAudit,
      uncategorizedAccounts,
      doubleEntryCheck,
      filteredVouchers,
      openingBalanceEntities,
      ledgerLiveRevision,
    ]
  );

  const differenceTraceConflictRows = useMemo<BalanceSheetDifferenceTraceRow[]>(() => {
    const fiscalYearStart = effectiveFiscalYearStart;
    const { masterOpeningRows, openingSplit } = buildDifferenceTraceOpeningContext(
      processedAccounts,
      processedParties,
      processedStaff,
      processedTaxes,
      processedExpenseAccounts,
      fiscalYearStart
    );

    return balanceSheetData
      .filter((row) => !row.isGroup)
      .map((row) =>
        buildDifferenceTraceRowFromBalanceSheetRow(
          row,
          fiscalYearStart,
          masterOpeningRows,
          openingSplit,
          filteredVouchers,
          processedTaxes,
          { requireConflictReason: true }
        )
      )
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
  }, [
    balanceSheetData,
    filteredVouchers,
    processedTaxes,
    processedAccounts,
    processedParties,
    processedStaff,
    processedExpenseAccounts,
    effectiveFiscalYearStart,
    ledgerLiveRevision,
  ]);

  const differenceTraceOtherRows = useMemo<BalanceSheetDifferenceTraceRow[]>(() => {
    const fiscalYearStart = effectiveFiscalYearStart;
    const { masterOpeningRows, openingSplit } = buildDifferenceTraceOpeningContext(
      processedAccounts,
      processedParties,
      processedStaff,
      processedTaxes,
      processedExpenseAccounts,
      fiscalYearStart
    );
    const conflictKeys = new Set(differenceTraceConflictRows.map(differenceTraceRowKey));

    return balanceSheetData
      .filter((row) => !row.isGroup && row.entityType && !conflictKeys.has(balanceSheetTraceRowKey(row)))
      .map((row) =>
        buildDifferenceTraceRowFromBalanceSheetRow(
          row,
          fiscalYearStart,
          masterOpeningRows,
          openingSplit,
          filteredVouchers,
          processedTaxes,
          { requireConflictReason: false, isOtherAccount: true }
        )
      )
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
  }, [
    balanceSheetData,
    differenceTraceConflictRows,
    filteredVouchers,
    processedTaxes,
    processedAccounts,
    processedParties,
    processedStaff,
    processedExpenseAccounts,
    effectiveFiscalYearStart,
    ledgerLiveRevision,
  ]);

  const differenceTraceAllOpeningRows = useMemo<BalanceSheetDifferenceTraceRow[]>(() => {
    const fiscalYearStart = effectiveFiscalYearStart;
    const { masterOpeningRows, openingSplit } = buildDifferenceTraceOpeningContext(
      processedAccounts,
      processedParties,
      processedStaff,
      processedTaxes,
      processedExpenseAccounts,
      fiscalYearStart
    );

    return buildDifferenceTraceAllOpeningRows(
      balanceSheetData,
      fiscalYearStart,
      masterOpeningRows,
      openingSplit,
      filteredVouchers,
      processedTaxes,
      {
        processedAccounts,
        processedParties,
        processedStaff,
        processedTaxes,
        processedExpenseAccounts,
        processedGroups,
        processedAccountGroups,
        processedStaffGroups,
        processedTaxGroups,
        processedExpenseGroups,
      }
    );
  }, [
    balanceSheetData,
    filteredVouchers,
    processedTaxes,
    processedAccounts,
    processedParties,
    processedStaff,
    processedExpenseAccounts,
    processedGroups,
    processedAccountGroups,
    processedStaffGroups,
    processedTaxGroups,
    processedExpenseGroups,
    effectiveFiscalYearStart,
    ledgerLiveRevision,
  ]);

  const differenceTraceNoOpeningRows = useMemo<BalanceSheetDifferenceTraceRow[]>(() => {
    const fiscalYearStart = effectiveFiscalYearStart;
    const { masterOpeningRows, openingSplit } = buildDifferenceTraceOpeningContext(
      processedAccounts,
      processedParties,
      processedStaff,
      processedTaxes,
      processedExpenseAccounts,
      fiscalYearStart
    );
    const conflictKeys = new Set(differenceTraceConflictRows.map(differenceTraceRowKey));

    return balanceSheetData
      .filter((row) => !row.isGroup && row.entityType)
      .map((row) => {
        const built = buildDifferenceTraceRowFromBalanceSheetRow(
          row,
          fiscalYearStart,
          masterOpeningRows,
          openingSplit,
          filteredVouchers,
          processedTaxes,
          { requireConflictReason: false }
        );
        if (!built || Math.abs(built.masterRawOpening) >= 0.005) return null;
        return {
          ...built,
          isOtherAccount: !conflictKeys.has(differenceTraceRowKey(built)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.accountName.localeCompare(b.accountName));
  }, [
    balanceSheetData,
    differenceTraceConflictRows,
    filteredVouchers,
    processedTaxes,
    processedAccounts,
    processedParties,
    processedStaff,
    processedExpenseAccounts,
    effectiveFiscalYearStart,
    ledgerLiveRevision,
  ]);

  const differenceTraceRows = useMemo(
    () => [...differenceTraceConflictRows, ...differenceTraceOtherRows],
    [differenceTraceConflictRows, differenceTraceOtherRows]
  );

  const differenceTraceTotals = useMemo(() => {
    const totals = differenceTraceRows.reduce(
      (sum, row) => {
        sum.opening += row.opening;
        if (row.masterRawOpening > 0.005) sum.openingDr += row.masterRawOpening;
        if (row.masterRawOpening < -0.005) sum.openingCr += Math.abs(row.masterRawOpening);
        sum.movementDebit += row.movementDebit;
        sum.movementCredit += row.movementCredit;
        sum.movementDifference += row.movementDifference;
        sum.closing += row.closing;
        if (row.closing > 0.005) sum.closingDr += row.closing;
        if (row.closing < -0.005) sum.closingCr += Math.abs(row.closing);
        if (row.closingDifference >= 0.005) {
          if (row.actualSide === "Dr") sum.closingDifferenceDr += row.closingDifference;
          if (row.actualSide === "Cr") sum.closingDifferenceCr += row.closingDifference;
        }
        return sum;
      },
      {
        opening: 0,
        openingDr: 0,
        openingCr: 0,
        movementDebit: 0,
        movementCredit: 0,
        movementDifference: 0,
        closing: 0,
        closingDr: 0,
        closingCr: 0,
        closingDifferenceDr: 0,
        closingDifferenceCr: 0,
      }
    );
    return {
      opening: round2(totals.opening),
      openingDr: round2(totals.openingDr),
      openingCr: round2(totals.openingCr),
      movementDebit: round2(totals.movementDebit),
      movementCredit: round2(totals.movementCredit),
      movementDifference: round2(totals.movementDifference),
      closing: round2(totals.closing),
      closingDr: round2(totals.closingDr),
      closingCr: round2(totals.closingCr),
      closingDifferenceDr: round2(totals.closingDifferenceDr),
      closingDifferenceCr: round2(totals.closingDifferenceCr),
    };
  }, [differenceTraceRows]);

  const differenceTraceGrandOpening = useMemo(
    () => ({
      openingDr: openingBalanceAudit.totalOpeningDr,
      openingCr: openingBalanceAudit.totalOpeningCr,
    }),
    [openingBalanceAudit.totalOpeningDr, openingBalanceAudit.totalOpeningCr]
  );

  const differenceTraceOpeningDifference = useMemo(
    () => round2(openingBalanceAudit.diff),
    [openingBalanceAudit.diff]
  );

  const differenceTraceReconciliation = useMemo(() => {
    let traceGapContribution = 0;
    for (const traceRow of differenceTraceConflictRows) {
      const bsRow = balanceSheetData.find(
        (r) =>
          !r.isGroup &&
          r.accountId === traceRow.accountId &&
          r.entityType === traceRow.ledgerEntityType
      );
      if (bsRow) {
        traceGapContribution += computeBalanceSheetRowGapParts(
          bsRow.ledgerClass,
          bsRow.signedBalance
        ).gapContribution;
      }
    }
    return {
      remainingAfterOpening: differenceBreakdown.remainingAfterOpening,
      residualDifference: differenceBreakdown.residualDifference,
      traceAccountCount: differenceTraceConflictRows.length,
      traceGapContribution: round2(traceGapContribution),
      traceWrongSideGross: round2(
        differenceTraceTotals.closingDifferenceDr + differenceTraceTotals.closingDifferenceCr
      ),
    };
  }, [
    differenceTraceConflictRows,
    balanceSheetData,
    differenceBreakdown.remainingAfterOpening,
    differenceBreakdown.residualDifference,
    differenceTraceTotals.closingDifferenceDr,
    differenceTraceTotals.closingDifferenceCr,
  ]);

  const differenceTraceReconciliationCopy = useMemo(
    () => ({
      totalDifferenceLabel: toNepaliCurrency(differenceBreakdown.totalDifference),
      openingMismatchLabel: toNepaliCurrency(differenceBreakdown.openingDifference),
      remainingAfterOpeningLabel: toNepaliCurrency(differenceBreakdown.remainingAfterOpening),
      residualDifferenceLabel: toNepaliCurrency(differenceBreakdown.residualDifference),
      hasResidual: differenceBreakdown.residualDifference >= 0.01,
      openingIsBalanced: openingBalanceAudit.isBalanced,
    }),
    [differenceBreakdown, openingBalanceAudit.isBalanced]
  );

  const balanceSheetCheckEngineInput = useMemo((): BalanceSheetCheckEngineInput => ({
    processedAccounts: accountsForBalanceSheet,
    processedParties: partiesForBalanceSheet,
    processedStaff: staffForBalanceSheet,
    processedTaxes: taxesForBalanceSheet,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedGroups,
    processedAccountGroups,
    processedTaxGroups,
    processedStaffGroups,
    vouchers,
    processedTaxesForLedger: processedTaxes,
    asOfDate,
    doubleEntryCheck,
    vouchersForAnalysis: filteredVouchers,
  }), [
    accountsForBalanceSheet,
    partiesForBalanceSheet,
    staffForBalanceSheet,
    taxesForBalanceSheet,
    processedExpenseAccounts,
    processedExpenseGroups,
    processedGroups,
    processedAccountGroups,
    processedTaxGroups,
    processedStaffGroups,
    vouchers,
    processedTaxes,
    asOfDate,
    doubleEntryCheck,
    filteredVouchers,
  ]);

  const balanceSheetCheckReport = useMemo(
    () => runBalanceSheetCheckEngine(balanceSheetCheckEngineInput),
    [balanceSheetCheckEngineInput, ledgerLiveRevision]
  );

  const scrollToBalanceSheetSection = useCallback((elementId: string) => {
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const openDetail = (row: BalanceSheetRow) => {
    setDetailDateRange(dateRange);
    setActiveRow(row);
  };

  const openAccountFromCheckEngine = useCallback(
    ({ accountId, entityType }: { accountId: string; entityType: string }) => {
      setDetailDateRange(dateRange);
      const et = entityType as BalanceSheetRow["entityType"];
      if (et === "party" || et === "opening_balance") {
        const party = processedParties.find((p) => p.id === accountId);
        if (party) {
          setActiveRow({
            accountId,
            accountName: String(party.name ?? accountId),
            group: processedGroups.find((g) => g.id === party.groupId)?.name ?? "Ungrouped",
            category: "Equity",
            ledgerClass: "Equity",
            amount: 0,
            signedBalance: 0,
            entityType: accountId === OPENING_BALANCE_SYSTEM_LEDGER_ID ? "opening_balance" : "party",
          });
        }
        return;
      }
      if (et === "account") {
        const account = processedAccounts.find((a) => a.id === accountId);
        if (account) {
          setActiveRow({
            accountId,
            accountName: String(account.accountName ?? accountId),
            group: processedAccountGroups.find((g) => g.id === account.groupId)?.name ?? "Ungrouped",
            category: "Assets",
            ledgerClass: "Asset",
            amount: 0,
            signedBalance: 0,
            entityType: "account",
          });
        }
        return;
      }
      if (et === "staff") {
        const staff = processedStaff.find((s) => s.id === accountId);
        if (staff) {
          setActiveRow({
            accountId,
            accountName: String(staff.name ?? accountId),
            group: processedStaffGroups.find((g) => g.id === staff.groupId)?.name ?? "Ungrouped",
            category: "Liabilities",
            ledgerClass: "Liability",
            amount: 0,
            signedBalance: 0,
            entityType: "staff",
          });
        }
        return;
      }
      if (et === "tax") {
        const tax = processedTaxes.find((t) => t.id === accountId);
        if (tax) {
          setActiveRow({
            accountId,
            accountName: String(tax.name ?? accountId),
            group: processedTaxGroups.find((g) => g.id === tax.groupId)?.name ?? "Ungrouped",
            category: "Liabilities",
            ledgerClass: "Liability",
            amount: 0,
            signedBalance: 0,
            entityType: "tax",
          });
        }
        return;
      }
      if (et === "expense") {
        router.push(`/incomes/${accountId}`);
      }
    },
    [
      processedParties,
      processedAccounts,
      processedStaff,
      processedTaxes,
      processedGroups,
      processedAccountGroups,
      processedStaffGroups,
      processedTaxGroups,
      dateRange,
      router,
    ]
  );

  const openDifferenceTraceRow = useCallback(
    (traceRow: BalanceSheetDifferenceTraceRow) => {
      if (traceRow.entityType === "Income/Expense") return;
      const bsRow = balanceSheetData.find(
        (r) =>
          !r.isGroup &&
          r.accountId === traceRow.accountId &&
          r.entityType === traceRow.ledgerEntityType
      );
      if (bsRow) {
        setDetailDateRange(dateRange);
        setActiveRow(bsRow);
        return;
      }
      openAccountFromCheckEngine({
        accountId: traceRow.accountId,
        entityType: traceRow.ledgerEntityType,
      });
    },
    [balanceSheetData, dateRange, openAccountFromCheckEngine]
  );

  const openVoucherFromCheckEngine = useCallback(
    (voucherId: string) => {
      const v = vouchers.find((x) => String(x.id) === voucherId);
      if (!v) {
        sonnerToast.error("Voucher not found", { description: "Refresh and try again." });
        return;
      }
      setCheckEngineVoucher(v);
      setCheckEngineVoucherOpen(true);
    },
    [vouchers]
  );

  const openOpeningBalanceLedgerDetail = useCallback(() => {
    const row = balanceSheetData.find(
      (r) =>
        !r.isGroup &&
        r.accountId === OPENING_BALANCE_SYSTEM_LEDGER_ID &&
        r.entityType === "opening_balance"
    );
    if (row) {
      openDetail(row);
      return;
    }
    openAccountFromCheckEngine({
      accountId: OPENING_BALANCE_SYSTEM_LEDGER_ID,
      entityType: "opening_balance",
    });
  }, [balanceSheetData, openAccountFromCheckEngine]);

  const openPlFromCheckEngine = useCallback(() => {
    router.push("/reports/profit-and-loss");
  }, [router]);

  const openUncategorized = (item: BalanceSheetUncategorizedAccount) => {
    openDetail({
      accountId: item.accountId,
      accountName: item.accountName,
      group: item.groupLabel,
      category: "Equity",
      ledgerClass: "Equity",
      amount: Math.abs(item.signedBalance),
      signedBalance: item.signedBalance,
      entityType: item.entityType,
    });
  };

  const findUncategorizedEntity = useCallback(
    (item: BalanceSheetUncategorizedAccount): Record<string, unknown> | null => {
      switch (item.entityType) {
        case "party":
        case "opening_balance":
          return (processedParties.find((p) => p.id === item.accountId) as Record<string, unknown> | undefined) ?? null;
        case "staff":
          return (processedStaff.find((s) => s.id === item.accountId) as Record<string, unknown> | undefined) ?? null;
        case "account":
          return (processedAccounts.find((a) => a.id === item.accountId) as Record<string, unknown> | undefined) ?? null;
        case "tax":
          return (processedTaxes.find((t) => t.id === item.accountId) as Record<string, unknown> | undefined) ?? null;
        default:
          return null;
      }
    },
    [processedParties, processedStaff, processedAccounts, processedTaxes]
  );

  const handleResaveUncategorized = useCallback(
    async (item: BalanceSheetUncategorizedAccount) => {
      if (!companyId || item.entityType === "opening_balance") return;

      const entity = findUncategorizedEntity(item);
      if (!entity) {
        sonnerToast.error("Account not found", {
          description: "Refresh the page and try again.",
        });
        return;
      }

      const rowKey = `${item.entityType}-${item.accountId}`;
      setResavingUncategorizedIds((prev) => new Set(prev).add(rowKey));

      try {
        const patch = buildBalanceSheetUncategorizedResavePatch(item.entityType, entity);
        const normalizedGroupId = String(patch.groupId ?? entity.groupId ?? "").trim();

        const result = await resaveBalanceSheetUncategorizedAccount(
          companyId,
          item.entityType,
          entity
        );

        if (result.ok === false) {
          sonnerToast.error("Resave failed", { description: result.error });
          return;
        }

        if (normalizedGroupId) {
          setOptimisticGroupOverrides((prev) => ({
            ...prev,
            [item.accountId]: normalizedGroupId,
          }));
        }

        const stillUncategorized = computeBalanceSheetReport({
          processedAccounts: accountsForBalanceSheet.map((acc) =>
            acc.id === item.accountId && normalizedGroupId
              ? { ...acc, groupId: normalizedGroupId }
              : acc
          ),
          processedParties: partiesForBalanceSheet.map((p) =>
            p.id === item.accountId && normalizedGroupId
              ? { ...p, groupId: normalizedGroupId }
              : p
          ),
          processedStaff: staffForBalanceSheet.map((s) =>
            s.id === item.accountId && normalizedGroupId
              ? { ...s, groupId: normalizedGroupId }
              : s
          ),
          processedTaxes: taxesForBalanceSheet.map((t) =>
            t.id === item.accountId && normalizedGroupId
              ? { ...t, groupId: normalizedGroupId }
              : t
          ),
          processedExpenseGroups,
          processedGroups,
          processedAccountGroups,
          processedTaxGroups,
          processedStaffGroups,
          vouchers,
          processedTaxesForLedger: processedTaxes,
          asOfDate,
        }).uncategorized.some((u) => u.accountId === item.accountId);

        if (!stillUncategorized) {
          setRecentlyMappedUncategorized((prev) => {
            const next = prev.filter(
              (row) =>
                !(row.accountId === item.accountId && row.entityType === item.entityType)
            );
            return [...next, item];
          });
          window.setTimeout(() => {
            setRecentlyMappedUncategorized((prev) =>
              prev.filter(
                (row) =>
                  !(row.accountId === item.accountId && row.entityType === item.entityType)
              )
            );
          }, 5000);
          sonnerToast.success("Mapped now", {
            description: `${item.accountName} is now classified for the Balance Sheet.`,
          });
        } else {
          sonnerToast.message("Account updated", {
            description: `${item.accountName} was saved but still needs a valid Balance Sheet group.`,
          });
        }
      } finally {
        setResavingUncategorizedIds((prev) => {
          const next = new Set(prev);
          next.delete(rowKey);
          return next;
        });
      }
    },
    [
      companyId,
      findUncategorizedEntity,
      accountsForBalanceSheet,
      partiesForBalanceSheet,
      staffForBalanceSheet,
      taxesForBalanceSheet,
      processedExpenseGroups,
      processedGroups,
      processedAccountGroups,
      processedTaxGroups,
      processedStaffGroups,
      vouchers,
      processedTaxes,
      asOfDate,
    ]
  );

  const uncategorizedDisplayRows = useMemo(() => {
    const activeKeys = new Set(
      uncategorizedAccounts.map((item) => `${item.entityType}-${item.accountId}`)
    );
    const rows = uncategorizedAccounts.map((item) => ({ item, mappedNow: false }));
    for (const item of recentlyMappedUncategorized) {
      const key = `${item.entityType}-${item.accountId}`;
      if (!activeKeys.has(key)) {
        rows.push({ item, mappedNow: true });
      }
    }
    return rows;
  }, [uncategorizedAccounts, recentlyMappedUncategorized]);

  const closeDrawer = () => {
    setActiveRow(null);
    setDetailDateRange(undefined);
  };

  const handlePrintBalanceSheet = (expandAll: boolean) => {
    if (!company) return;
    
    const getDateText = (date: Date) => {
      if (dateSystem === 'BS') return formatDateBS(date);
      if (dateSystem === 'Both') return `${formatDate(date)} / ${formatDateBS(date)}`;
      return formatDate(date);
    };
    
    const dateRangeText = dateRange?.from 
      ? dateRange.to 
        ? `${getDateText(dateRange.from)} - ${getDateText(dateRange.to)}`
        : getDateText(dateRange.from)
      : "All Time";

    // Determine if we should show parent/sub group columns
    const showColumns = expandAll;
    
    // Helper function to format currency without Rs. symbol (for print)
    const formatAmountForPrint = (amount: number): string => {
      if (typeof amount !== 'number' || isNaN(amount) || amount === 0) return '-';
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.abs(amount));
    };

    // Build table header based on mode
    const tableHeader: any[] = showColumns
      ? [
          { text: "System Group", bold: true, fontSize: 10 },
          { text: "Parent Group", bold: true, fontSize: 10 },
          { text: "Sub Group", bold: true, fontSize: 10 },
          { text: "Account Name", bold: true, fontSize: 10 },
          { text: "Assets", bold: true, alignment: "right", fontSize: 10 },
          { text: "Liabilities + Equity", bold: true, alignment: "right", fontSize: 10 },
        ]
      : [{ text: 'Group', bold: true, fontSize: 10 }, { text: 'Assets', bold: true, alignment: 'right', fontSize: 10 }, { text: 'Liabilities + Equity', bold: true, alignment: 'right', fontSize: 10 }];

    const tableBody: any[] = [tableHeader];

    // Filter out Net Profit from regular rows (it will be shown separately)
    const rowsWithoutNetProfit = filtered.filter(row => row.accountId !== 'net-profit');
    
    if (expandAll) {
      mainGroupRows.forEach((main) => {
        const subGroups = getSubGroupsForMain(main.category);
        const assetsVal = main.category === "Assets" ? main.amount || 0 : 0;
        const liabVal =
          main.category === "Liabilities" || main.category === "Equity" ? main.amount || 0 : 0;

        tableBody.push([
          { text: main.accountName, bold: true, fontSize: 9 },
          { text: "", fontSize: 9 },
          { text: "", fontSize: 9 },
          { text: "", fontSize: 9 },
          {
            text: assetsVal > 0 ? formatAmountForPrint(assetsVal) : "-",
            alignment: "right",
            fontSize: 9,
          },
          {
            text: liabVal > 0 ? formatAmountForPrint(liabVal) : "-",
            alignment: "right",
            fontSize: 9,
          },
        ]);

        let lastSystemKey = "";
        sortBalanceSheetExpandedGroupItems(subGroups, balanceSheetGroupHierarchyCtx).forEach(
          ({ row: groupRow, systemGroupLabel, parentGroupLabel }) => {
          const groupAccounts = getAccountsForGroup(groupRow);

          let assetsSum = 0;
          let liabilitiesSum = 0;

          groupAccounts.forEach((acc) => {
            if (acc.category === "Assets") {
              assetsSum += acc.amount || 0;
            } else if (acc.category === "Liabilities" || acc.category === "Equity") {
              liabilitiesSum += acc.amount || 0;
            }
          });

          const { display: systemCellLabel, nextKey } = balanceSheetDisplaySystemGroupCell(
            systemGroupLabel,
            lastSystemKey
          );
          lastSystemKey = nextKey;

          if (groupAccounts.length > 0) {
            tableBody.push([
              { text: systemCellLabel, bold: true, fontSize: 9 },
              {
                text: parentGroupLabel,
                bold: true,
                fontSize: 9,
                margin: parentGroupLabel ? [BS_TREE_INDENT_PARENT_PX, 0, 0, 0] : undefined,
              },
              { text: "", bold: true, fontSize: 9 },
              { text: "", bold: true, fontSize: 9 },
              { text: "-", alignment: "right", fontSize: 9 },
              { text: "-", alignment: "right", fontSize: 9 },
            ]);

            groupAccounts.forEach((acc) => {
              tableBody.push([
                { text: "", fontSize: 8 },
                { text: "", fontSize: 8 },
                { text: "", fontSize: 8 },
                { text: acc.accountName, fontSize: 8 },
                {
                  text: acc.category === "Assets" ? formatAmountForPrint(acc.amount) : "-",
                  alignment: "right",
                  color: acc.category === "Assets" ? "green" : undefined,
                  fontSize: 8,
                },
                {
                  text: acc.category !== "Assets" ? formatAmountForPrint(acc.amount) : "-",
                  alignment: "right",
                  color: acc.category !== "Assets" ? "red" : undefined,
                  fontSize: 8,
                },
              ]);
            });
          } else {
            tableBody.push([
              { text: systemCellLabel, bold: true, fontSize: 9 },
              {
                text: parentGroupLabel,
                bold: true,
                fontSize: 9,
                margin: parentGroupLabel ? [BS_TREE_INDENT_PARENT_PX, 0, 0, 0] : undefined,
              },
              { text: "", bold: true, fontSize: 9 },
              { text: "", bold: true, fontSize: 9 },
              {
                text: groupRow.category === "Assets" ? formatAmountForPrint(groupRow.amount) : "-",
                alignment: "right",
                color: groupRow.category === "Assets" ? "green" : undefined,
                fontSize: 9,
              },
              {
                text: groupRow.category !== "Assets" ? formatAmountForPrint(groupRow.amount) : "-",
                alignment: "right",
                color: groupRow.category !== "Assets" ? "red" : undefined,
                fontSize: 9,
              },
            ]);
          }
        });
      });
    } else {
      // Collapsed mode: Show only groups, no account column
      // Calculate sum of all accounts in each group (not net balance)
      rowsWithoutNetProfit.forEach(groupRow => {
        const groupAccounts = getAccountsForGroup(groupRow);
        
        // Calculate sum of Assets and Liabilities separately
        let assetsSum = 0;
        let liabilitiesSum = 0;
        
        groupAccounts.forEach(acc => {
          if (acc.category === 'Assets') {
            assetsSum += acc.amount || 0;
          } else if (acc.category === 'Liabilities' || acc.category === 'Equity') {
            liabilitiesSum += acc.amount || 0;
          }
        });
        
        // Show sum of all accounts, not net balance
        tableBody.push([
          { text: groupRow.accountName, fontSize: 9 },
          { text: assetsSum > 0 ? formatAmountForPrint(assetsSum) : '-', alignment: 'right', color: assetsSum > 0 ? 'green' : undefined, fontSize: 9 },
          { text: liabilitiesSum > 0 ? formatAmountForPrint(liabilitiesSum) : '-', alignment: 'right', color: liabilitiesSum > 0 ? 'red' : undefined, fontSize: 9 }
        ]);
      });
    }

    // Add TOTAL row (before Net Profit)
    // Adjust colSpan based on whether columns are shown
    const totalColSpan = showColumns ? 4 : 1;
    tableBody.push([
      { text: 'TOTAL', bold: true, colSpan: totalColSpan, fontSize: 10 },
      ...(showColumns ? [{}, {}, {}] : []),
      { text: formatAmountForPrint(totals.assets), bold: true, alignment: 'right', color: 'green', fontSize: 10 },
      { text: formatAmountForPrint(totals.liab), bold: true, alignment: 'right', color: 'red', fontSize: 10 }
    ]);

    // Add Net Profit as special row below TOTAL (with color based on positive/negative)
    // Net Profit is part of Equity, so it goes on Liabilities + Equity side
    if (netProfit !== 0) {
      const netProfitColor = netProfit >= 0 ? "green" : "red";
      tableBody.push([
        { text: "Net Profit", bold: true, colSpan: totalColSpan, fillColor: "#f3f4f6", fontSize: 10 },
        ...(showColumns ? [{}, {}, {}] : []),
        { text: "-", alignment: "right", fillColor: "#f3f4f6", fontSize: 10 },
        {
          text: formatAmountForPrint(netProfit),
          bold: true,
          alignment: "right",
          color: netProfitColor,
          fillColor: "#f3f4f6",
          fontSize: 10,
        },
      ]);
    }

    const balanceText = totals.isBalanced
      ? "TOTAL (Assets = Liabilities + Equity) ✓ Balanced"
      : `TOTAL (Assets = Liabilities + Equity) — Not Balanced — Difference: ${formatAmountForPrint(Math.abs(totals.difference))}`;

    tableBody.push([
      {
        text: balanceText,
        bold: true,
        colSpan: totalColSpan,
        fillColor: totals.isBalanced ? "#d1fae5" : "#fee2e2",
        fontSize: 10,
      },
      ...(showColumns ? [{}, {}, {}] : []),
      {
        text: formatAmountForPrint(totals.assets),
        bold: true,
        alignment: "right",
        color: "green",
        fillColor: totals.isBalanced ? "#d1fae5" : "#fee2e2",
        fontSize: 10,
      },
      {
        text: formatAmountForPrint(totals.totalLiabEquity),
        bold: true,
        alignment: "right",
        color: "red",
        fillColor: totals.isBalanced ? "#d1fae5" : "#fee2e2",
        fontSize: 10,
      },
    ]);

    openPrintDirect({
      company: {
        name: company.name || '',
        pan: company.pan,
        phone: company.phone,
        address: company.address,
        decimalPlaces: company.decimalPlaces,
        showDrCr: company.showDrCr,
        showCurrencySymbol: company.showCurrencySymbol,
        logoUrl: company.logoUrl,
      },
      title: "Balance Sheet",
      context: "daybook",
      dateSystem: dateSystem as "AD" | "BS" | "Both",
      dateRangeText,
      vouchersCount: 0,
      openingBalance: 0,
      transactions: [],
      customContent: [
        {
          table: {
            widths: showColumns ? ['*', '*', '*', '*', 'auto', 'auto'] : ['*', 'auto', 'auto'],
            body: tableBody,
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 || i === tableBody.length) ? 1 : 0.5,
            vLineWidth: () => 0.5,
            paddingLeft: () => 4,
            paddingRight: () => 4,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
        { text: '\nNote: Balance Sheet follows the rule: Assets = Liabilities + Equity', fontSize: 10, italics: true, margin: [0, 10, 0, 0] }
      ]
    }, true);
  };
  
  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="pb-[72px] p-0.5 w-full h-full overflow-y-auto">
      <div className="p-0 space-y-3">
        <Card className="border-2 border-foreground/20">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-2xl">Balance Sheet</CardTitle>
            <div className="flex items-center gap-2">
              <MonthYearFilter dateRange={dateRange} setDateRange={setDateRange} dateSystem={dateSystem} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const qs = asOfDate
                    ? `?asOf=${encodeURIComponent(asOfDate.toISOString())}`
                    : "";
                  router.push(`/reports/balance-sheet-2${qs}`);
                }}
                className="flex items-center gap-2 border-indigo-300 text-indigo-900 hover:bg-indigo-50"
              >
                Open Balance Sheet 2 – Audit
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowPrintDialog(true)} className="flex items-center gap-2">
                <Printer className="h-4 w-4" /> Print
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    const mainIds = ["main_Assets", "main_Liabilities", "main_Equity"];
                    const subGroupIds = filtered
                      .filter((r) => getAccountsForGroup(r).length > 0)
                      .map((r) => r.accountId);
                    const allIds = [
                      ...mainIds,
                      ...balanceSheetAllSystemBranchExpandIds,
                      ...subGroupIds,
                    ];
                    const allExpanded = allIds.every((id) => expandedGroups.has(id));

                    if (allExpanded) {
                      setExpandedGroups(new Set());
                    } else {
                      setExpandedGroups(new Set(allIds));
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  {[
                    "main_Assets",
                    "main_Liabilities",
                    "main_Equity",
                    ...balanceSheetAllSystemBranchExpandIds,
                    ...filtered.filter((r) => getAccountsForGroup(r).length > 0).map((r) => r.accountId),
                  ].every((id) => expandedGroups.has(id)) ? (
                    <>
                      <ChevronUp className="h-4 w-4" /> Collapse All
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" /> Expand All
                    </>
                  )}
                </Button>
              </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-70" />
                    <Input
                      placeholder="Search system group, parent, account…"
                      className="pl-8"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select
                    value={entityFilter}
                    onChange={(e) => setEntityFilter(e.target.value as 'all' | 'party' | 'account' | 'staff' | 'tax' | 'income' | 'expense')}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    <option value="all">All Entities</option>
                    <option value="party">Party</option>
                    <option value="account">Bank/Account</option>
                    <option value="staff">{STAFF_ENTITY_LABEL}</option>
                    <option value="tax">Tax</option>
                    <option value="opening_balance">Opening Balance</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as 'entity' | 'balance' | 'date')}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="entity">Sort by Entity</option>
                      <option value="balance">Sort by Balance</option>
                      <option value="date">Sort by Date</option>
                    </select>
                    <Button variant="outline" size="sm" onClick={() => setSortDesc((s) => !s)}>
                      <ArrowUpDown className="mr-2 h-4 w-4" /> {sortDesc ? "Desc" : "Asc"}
                    </Button>
                  </div>
                </div>
              </div>
              
                {!balanceSheetShowExpandedTree ? (
                <div className={BS_CARD_SHELL_CLASS}>
                  <Table className={BS_TABLE_CLASS}>
                    <TableCaption>Group totals - Summary view</TableCaption>
                    <TableHeader className={BS_TABLE_HEADER_CLASS}>
                      <TableRow className={BS_TABLE_ROW_CLASS}>
                        <TableHead>Group</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Assets</TableHead>
                        <TableHead className="text-right">Liabilities + Equity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mainGroupRows.map((main) => {
                          const assetsVal = main.category === 'Assets' ? (main.amount || 0) : 0;
                          const liabVal = (main.category === 'Liabilities' || main.category === 'Equity') ? (main.amount || 0) : 0;
                          const hasSubGroups = getSubGroupsForMain(main.category).some(r => getAccountsForGroup(r).length > 0);
                          return (
                            <TableRow
                              key={main.accountId}
                              className={cn(
              "bg-muted/40 font-semibold cursor-pointer hover:bg-muted/60",
              BS_TABLE_ROW_CLASS
            )}
                              onClick={() => {
                                if (hasSubGroups) {
                                  setExpandedGroups(prev => new Set([...prev, main.accountId]));
                                }
                              }}
                            >
                              <TableCell className={cn("font-medium text-primary", BS_LABEL_CELL_CLASS)}>
                                <BalanceSheetTruncatedLabel
                                  text={main.accountName}
                                  highlightQuery={balanceSheetSearchQuery || undefined}
                                  leading={
                                    <>
                                      {hasSubGroups && <ChevronRight className={BS_TREE_CHEVRON_CLASS} />}
                                      <Users className={cn(BS_TREE_CHEVRON_CLASS, "text-primary")} />
                                    </>
                                  }
                                />
                              </TableCell>
                              <TableCell></TableCell>
                              <TableCell className="text-right tabular-nums">
                                {assetsVal > 0 ? toNepaliCurrency(assetsVal) : '-'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {liabVal > 0 ? toNepaliCurrency(liabVal) : '-'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                    <TableFooter className="!border-t-[1px] border-black">
                      <TableRow className={BS_TABLE_FOOTER_ROW_CLASS}>
                          <TableCell colSpan={2} className="font-bold">TOTAL</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-green-600">{toNepaliCurrency(totals.assets)}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-red-600">{toNepaliCurrency(totals.liab + totals.equity)}</TableCell>
                      </TableRow>
                      {netProfit !== 0 && (
                        <TableRow className={cn("bg-muted/30", BS_TABLE_FOOTER_ROW_CLASS)}>
                          <TableCell colSpan={2} className="font-bold text-foreground">
                            {netProfit >= 0 ? "Net Profit" : "Net Loss"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">-</TableCell>
                          <TableCell className={`text-right font-bold tabular-nums ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {toNepaliCurrency(netProfit)}
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className={cn(`bg-muted/50 ${totals.isBalanced ? "border-green-500" : "border-orange-500"}`, BS_TABLE_FOOTER_ROW_CLASS)}>
                        <TableCell colSpan={2} className="font-bold text-foreground">
                          TOTAL (Assets = Liabilities + Equity)
                          {totals.isBalanced ? (
                            <span className="text-green-600 text-xs ml-2">✓ Balance Sheet Balanced</span>
                          ) : (
                            <span className="text-orange-600 text-xs ml-2 block sm:inline mt-1 sm:mt-0">
                              ⚠ Not Balanced — Difference: {toNepaliCurrency(Math.abs(totals.difference))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums text-green-600">{toNepaliCurrency(totals.assets)}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums text-red-600">{toNepaliCurrency(totals.totalLiabEquity)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                ) : (
                <div className="space-y-4">
                  {mainGroupRows.map((main) => {
                    const mainExpanded = expandedGroups.has(main.accountId);
                    const subGroups = getSubGroupsForMain(main.category);
                    const hasSubGroups = subGroups.some((r) => getAccountsForGroup(r).length > 0);
                    const columnFlags = balanceSheetExpandedColumnFlags;

                    return (
                    <div key={main.accountId} className={BS_CARD_SHELL_CLASS}>
                      {mainExpanded && (
                        <div
                          role="button"
                          tabIndex={0}
                          className="bg-muted/40 font-semibold cursor-pointer hover:bg-muted/60 px-4 py-3 !border-b-[1px] border-black flex items-center gap-2 text-primary min-w-0"
                          onClick={() => {
                            setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              next.delete(main.accountId);
                              for (const id of [...next]) {
                                if (id.startsWith(`bs-sys:${main.accountId}:`)) next.delete(id);
                              }
                              getSubGroupsForMain(main.category).forEach((r) => next.delete(r.accountId));
                              return next;
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExpandedGroups((prev) => {
                                const next = new Set(prev);
                                next.delete(main.accountId);
                                for (const id of [...next]) {
                                  if (id.startsWith(`bs-sys:${main.accountId}:`)) next.delete(id);
                                }
                                getSubGroupsForMain(main.category).forEach((r) => next.delete(r.accountId));
                                return next;
                              });
                            }
                          }}
                        >
                          {hasSubGroups && <ChevronDown className={BS_TREE_CHEVRON_CLASS} />}
                          <Users className={BS_TREE_CHEVRON_CLASS} />
                          <span className={cn("font-medium", BS_TRUNCATE_LABEL_CLASS)} title={main.accountName}>
                            {main.accountName}
                          </span>
                        </div>
                      )}
                      <Table className={cn(BS_TABLE_CLASS, BS_TABLE_FIXED_CLASS)}>
                        <BalanceSheetExpandedColGroup flags={columnFlags} />
                        <TableHeader className={BS_TABLE_HEADER_CLASS}>{balanceSheetExpandedTableHead(columnFlags)}</TableHeader>
                        <TableBody>{renderExpandedSystemGroupRows(main, columnFlags)}</TableBody>
                      </Table>
                    </div>
                    );
                  })}
                  <div className={BS_CARD_SHELL_CLASS}>
                    <Table className={cn(BS_TABLE_CLASS, BS_TABLE_FIXED_CLASS)}>
                      <BalanceSheetExpandedColGroup flags={balanceSheetExpandedColumnFlags} />
                      <TableBody>
                        <TableRow className={BS_TABLE_FOOTER_ROW_CLASS}>
                          <TableCell
                            colSpan={balanceSheetExpandedLabelColCount(balanceSheetExpandedColumnFlags)}
                            className="font-bold"
                          >
                            TOTAL
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-green-600">{toNepaliCurrency(totals.assets)}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-red-600">{toNepaliCurrency(totals.liab + totals.equity)}</TableCell>
                        </TableRow>
                        {netProfit !== 0 && (
                          <TableRow className={cn("bg-muted/30", BS_TABLE_FOOTER_ROW_CLASS)}>
                            <TableCell
                              colSpan={balanceSheetExpandedLabelColCount(balanceSheetExpandedColumnFlags)}
                              className="font-bold text-foreground"
                            >
                              {netProfit >= 0 ? "Net Profit" : "Net Loss"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">-</TableCell>
                            <TableCell className={`text-right font-bold tabular-nums ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {toNepaliCurrency(netProfit)}
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow className={cn(`bg-muted/50 ${totals.isBalanced ? "border-green-500" : "border-orange-500"}`, BS_TABLE_FOOTER_ROW_CLASS)}>
                          <TableCell
                            colSpan={balanceSheetExpandedLabelColCount(balanceSheetExpandedColumnFlags)}
                            className="font-bold text-foreground"
                          >
                            TOTAL (Assets = Liabilities + Equity)
                            {totals.isBalanced ? (
                              <span className="text-green-600 text-xs ml-2">✓ Balance Sheet Balanced</span>
                            ) : (
                              <span className="text-orange-600 text-xs ml-2 block sm:inline mt-1 sm:mt-0">
                                ⚠ Not Balanced — Difference: {toNepaliCurrency(Math.abs(totals.difference))}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-green-600">{toNepaliCurrency(totals.assets)}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-red-600">{toNepaliCurrency(totals.totalLiabEquity)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
                )}
            <div className="mt-2 space-y-2">
              <p className="text-sm opacity-80">
                Note: Balance Sheet follows the rule: Assets = Liabilities + Equity
                {asOfDate ? (
                  <span className="block mt-1">
                    Showing balances as of{" "}
                    {dateSystem === "BS"
                      ? formatDateBS(asOfDate)
                      : dateSystem === "Both"
                        ? `${formatDate(asOfDate)} / ${formatDateBS(asOfDate)}`
                        : formatDate(asOfDate)}
                    . Transactions after this date are excluded.
                  </span>
                ) : null}
              </p>

              {(uncategorizedAccounts.length > 0 || recentlyMappedUncategorized.length > 0) && (
                <div id="bs-uncategorized-accounts" className="p-4 mb-4 bg-amber-50 border-l-4 border-amber-500 rounded">
                  <h3 className="text-amber-900 font-bold flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    ⚠ Uncategorized Accounts
                  </h3>
                  <p className="text-sm text-amber-800 mt-2">
                    Some accounts could not be classified for the Balance Sheet. These accounts are
                    excluded from Balance Sheet totals until their account group/type is assigned.
                  </p>
                  <div className="mt-3 rounded-md border border-amber-200 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account Name</TableHead>
                          <TableHead className="text-right">Current Balance</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right w-[180px]">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {uncategorizedDisplayRows.map(({ item, mappedNow }) => {
                          const rowKey = `${item.entityType}-${item.accountId}`;
                          const isResaving = resavingUncategorizedIds.has(rowKey);

                          return (
                          <TableRow
                            key={rowKey}
                            className={cn(
                              "cursor-pointer hover:bg-amber-100/60",
                              mappedNow && "bg-green-50/80 hover:bg-green-50",
                              BS_TABLE_ROW_CLASS
                            )}
                            onClick={() => !mappedNow && openUncategorized(item)}
                          >
                            <TableCell className="font-medium">{item.accountName}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {toNepaliCurrency(item.signedBalance)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {mappedNow ? "Account group updated and mapped for Balance Sheet." : item.reason}
                            </TableCell>
                            <TableCell className="text-right">
                              {mappedNow ? (
                                <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                                  <Check className="h-4 w-4" />
                                  Mapped now
                                </span>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-amber-300 bg-white hover:bg-amber-50"
                                  disabled={isResaving || item.entityType === "opening_balance"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleResaveUncategorized(item);
                                  }}
                                >
                                  {isResaving ? (
                                    <>
                                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    <>
                                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                      Resave account
                                    </>
                                  )}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              
              <div
                className={cn(
                  "grid gap-4",
                  !openingBalanceAudit.isBalanced ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
                )}
              >
              {/* Opening Balance Audit Warning */}
              {!openingBalanceAudit.isBalanced && (
                <div id="bs-opening-balance-mismatch" className={cn(BS_CARD_SHELL_CLASS, "min-w-0 w-full bg-orange-50/80")}>
                  <div className="px-3 py-2 sm:px-4 sm:py-3 !border-b-[1px] border-black bg-orange-100/50">
                    <h3 className="text-orange-800 font-bold flex items-center gap-2 text-sm sm:text-base">
                      <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                      <span>Opening Balance Mismatch!</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <AppFreshInfoButton
                            size="sm"
                            className="h-5 w-5 shrink-0 text-orange-600 hover:text-orange-800"
                            aria-label="Opening balance mismatch — what this check means"
                            title="Opening balance mismatch"
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
                                  {balanceSheetOpeningMismatchIntroTitle(lang)}
                                </p>
                                <p className="text-muted-foreground">
                                  {balanceSheetOpeningMismatchIntroSummary(lang)}
                                </p>
                                <BalanceSheetFiscalYearDisplay
                                  ctx={companyFiscalYearContext}
                                  variant="master"
                                  lang={lang}
                                  labelClassName="text-muted-foreground"
                                  noteClassName="text-muted-foreground"
                                />
                              </>
                            )}
                          />
                        </PopoverContent>
                      </Popover>
                    </h3>
                  </div>
                  <Table className={cn(BS_TABLE_CLASS, "w-full min-w-[240px]")}>
                    <TableHeader className={BS_TABLE_HEADER_CLASS}>
                      <TableRow className={BS_TABLE_ROW_CLASS}>
                        <TableHead className="whitespace-normal sm:whitespace-nowrap">Item</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className={BS_TABLE_ROW_CLASS}>
                        <TableCell className="font-medium whitespace-normal sm:whitespace-nowrap">Total Opening Dr</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap">
                          {toNepaliCurrency(openingBalanceAudit.totalOpeningDr)}
                        </TableCell>
                      </TableRow>
                      <TableRow className={BS_TABLE_ROW_CLASS}>
                        <TableCell className="font-medium whitespace-normal sm:whitespace-nowrap">Total Opening Cr</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap">
                          {toNepaliCurrency(openingBalanceAudit.totalOpeningCr)}
                        </TableCell>
                      </TableRow>
                      <TableRow className={BS_TABLE_ROW_CLASS}>
                        <TableCell className="font-medium text-red-700 whitespace-normal sm:whitespace-nowrap">
                          Difference (master accounts)
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto p-0 text-[11px] sm:text-xs text-blue-600 hover:text-blue-800 underline"
                              onClick={openOpeningBalanceLedgerDetail}
                            >
                              View Details
                            </Button>
                            <span className="tabular-nums font-bold text-red-700">
                              {toNepaliCurrency(Math.abs(openingBalanceAudit.diff))}
                              {openingBalanceAudit.diff < 0 ? " Cr" : openingBalanceAudit.diff > 0 ? " Dr" : ""}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}

              <div
                className={cn(
                  BS_CARD_SHELL_CLASS,
                  "min-w-0 w-full",
                  totals.isBalanced ? "bg-green-50/80" : "bg-orange-50/80"
                )}
              >
                <div
                  className={cn(
                    "px-3 py-2 sm:px-4 sm:py-3 !border-b-[1px] border-black flex flex-wrap items-center justify-between gap-2",
                    totals.isBalanced ? "bg-green-100/50" : "bg-orange-100/50"
                  )}
                >
                  <p className="font-semibold text-sm sm:text-base">
                    {totals.isBalanced ? "✓ Balance Sheet Check" : "⚠ Balance Sheet Not Balanced"}
                  </p>
                  {!totals.isBalanced ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-orange-400 bg-white hover:bg-orange-50 text-orange-900"
                      onClick={() => setCheckDifferenceOpen(true)}
                    >
                      Check Difference
                    </Button>
                  ) : null}
                </div>
                {totals.isBalanced ? (
                  <p className="text-xs sm:text-sm text-green-700 px-3 sm:px-4 py-3">
                    Assets = Liabilities + Equity (including current profit/loss).
                  </p>
                ) : (
                  <>
                    <Table className={cn(BS_TABLE_CLASS, "w-full min-w-[240px]")}>
                      <TableHeader className={BS_TABLE_HEADER_CLASS}>
                        <TableRow className={BS_TABLE_ROW_CLASS}>
                          <TableHead className="whitespace-normal sm:whitespace-nowrap">Check</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className={BS_TABLE_ROW_CLASS}>
                          <TableCell className="font-medium text-orange-800 whitespace-normal sm:whitespace-nowrap">
                            Total difference (Assets − Liab − Equity − P/L)
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-bold text-red-700 whitespace-nowrap">
                            {toNepaliCurrency(differenceBreakdown.totalDifference)}
                          </TableCell>
                        </TableRow>
                        {!openingBalanceAudit.isBalanced && (
                          <TableRow className={BS_TABLE_ROW_CLASS}>
                            <TableCell className="font-medium text-orange-800 whitespace-normal sm:whitespace-nowrap">
                              Includes opening mismatch
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold text-red-700 whitespace-nowrap">
                              {toNepaliCurrency(differenceBreakdown.openingDifference)}
                            </TableCell>
                          </TableRow>
                        )}
                        {differenceBreakdown.remainingAfterOpening >= 0.01 && (
                          <TableRow className={BS_TABLE_ROW_CLASS}>
                            <TableCell className="font-medium text-orange-900 whitespace-normal sm:whitespace-nowrap">
                              Remaining to find (after opening)
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-red-700 whitespace-nowrap">
                              {toNepaliCurrency(differenceBreakdown.remainingAfterOpening)}
                            </TableCell>
                          </TableRow>
                        )}
                        {differenceBreakdown.lines
                          .filter((line) => line.kind !== "opening_mismatch")
                          .map((line) => (
                            <TableRow key={line.kind + line.label} className={BS_TABLE_ROW_CLASS}>
                              <TableCell className="font-medium text-orange-800 whitespace-normal sm:whitespace-nowrap">
                                {line.label}
                                {line.count != null && line.count > 0 ? (
                                  <span className="text-muted-foreground font-normal"> ({line.count})</span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {line.amount >= 0.01 ? (
                                  <span className="tabular-nums font-semibold text-red-700">
                                    {toNepaliCurrency(line.amount)}
                                  </span>
                                ) : (
                                  <span className="text-[11px] sm:text-xs text-orange-800">—</span>
                                )}
                                {line.scrollTargetId ? (
                                  <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto p-0 ml-2 text-[11px] sm:text-xs text-orange-800 underline"
                                    onClick={() => scrollToBalanceSheetSection(line.scrollTargetId!)}
                                  >
                                    View
                                  </Button>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </>
                )}
              </div>
              </div>

              {netProfit !== 0 && (
                <div className="text-sm space-y-1 p-2 bg-muted/30 rounded-md">
                  <p className="font-semibold">
                    {netProfit >= 0 ? '✓ Net Profit' : '⚠️ Net Loss'} Explanation:
                  </p>
                  <p className={netProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {netProfit >= 0 
                      ? `Green value (${toNepaliCurrency(netProfit)}) indicates Net Profit - your income exceeded expenses.`
                      : `Red value (${toNepaliCurrency(netProfit)}) indicates Net Loss - your expenses exceeded income.`
                    }
                  </p>
                </div>
              )}

              <div id="bs-double-entry-check" className="text-sm space-y-2 p-3 bg-muted/30 rounded-md border">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">
                    {doubleEntryCheck.isBalanced ? '✓' : '⚠️'} Double-Entry Check:
                  </p>
                  {!doubleEntryCheck.isBalanced && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDifferenceDetails(!showDifferenceDetails)}
                      className="h-auto p-1"
                    >
                      {showDifferenceDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
                {doubleEntryCheck.isBalanced ? (
                  <p className="text-green-600">
                    <strong>Debit = Credit = {toNepaliCurrency(doubleEntryCheck.totalDebit)}</strong> - All transactions are properly balanced.
                  </p>
                ) : (
                  <>
                    <div className="bg-destructive/10 border-2 border-destructive/30 rounded-lg p-3 shadow-sm">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-red-600 font-bold text-base">
                            Unbalanced Transactions Found!
                          </p>
                          <div className="mt-2 space-y-1 text-sm">
                            <div className="flex items-center gap-4 flex-wrap">
                              <span className="text-green-700 font-semibold">Total Debit: <strong>{toNepaliCurrency(doubleEntryCheck.totalDebit)}</strong></span>
                              <span className="text-red-700 font-semibold">Total Credit: <strong>{toNepaliCurrency(doubleEntryCheck.totalCredit)}</strong></span>
                            </div>
                            <div className="bg-red-100 border border-red-300 rounded px-2 py-1 inline-block">
                              <span className="text-red-800 font-bold text-base">
                                Total Difference: {toNepaliCurrency(doubleEntryCheck.difference)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    {showDifferenceDetails && doubleEntryCheck.problematicVouchers.length > 0 && (
                      <div className="mt-3 space-y-2 max-h-80 overflow-y-auto border rounded-lg p-2 bg-background">
                        <p className="text-sm font-bold text-red-600 mb-2 sticky top-0 bg-background pb-1 border-b">
                          Problematic Vouchers ({doubleEntryCheck.problematicVouchers.length}):
                        </p>
                        {doubleEntryCheck.problematicVouchers.map((v, idx) => (
                          <div key={idx} className="text-xs bg-muted/50 p-3 rounded border border-destructive/30 hover:bg-muted transition-colors">
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="font-bold text-red-700">{v.type.toUpperCase()}</span>
                                  {v.voucherNumber && <span className="text-muted-foreground">#{v.voucherNumber}</span>}
                                  {v.date && <span className="text-muted-foreground">({formatDate(v.date)})</span>}
                                </div>
                                <div className="bg-background/80 p-2 rounded mt-1 border">
                                  <p className="text-[11px] leading-relaxed break-words whitespace-pre-wrap">{v.description}</p>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0 border-l pl-3 ml-2">
                                <div className="space-y-0.5">
                                  <p className="text-green-700 font-semibold">Dr: {toNepaliCurrency(v.debit)}</p>
                                  <p className="text-red-700 font-semibold">Cr: {toNepaliCurrency(v.credit)}</p>
                                  <div className="bg-red-100 border border-red-300 rounded px-1.5 py-0.5 mt-1">
                                    <p className="text-red-800 font-bold">Diff: {toNepaliCurrency(v.difference)}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {showDifferenceDetails && doubleEntryCheck.problematicVouchers.length === 0 && (
                      <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                        <p className="text-xs text-yellow-800">
                          No individual vouchers found with imbalance. The difference may be due to:
                        </p>
                        <ul className="text-xs text-yellow-800 list-disc list-inside mt-1 space-y-0.5">
                          <li>Opening balances not properly balanced</li>
                          <li>Account classification issues</li>
                          <li>Rounding differences accumulating over time</li>
                          <li>Missing or incomplete journal entries</li>
                        </ul>
                      </div>
                    )}
                  </>
                )}
                <p className="text-xs opacity-70 mt-2 pt-2 border-t">
                  Balance Sheet check (Assets = Liabilities + Equity) is separate from Double-Entry check (Total Debit = Total Credit).
                  {Math.abs(totals.difference) >= 0.02 && (
                    <> Current Balance Sheet difference: {toNepaliCurrency(Math.abs(totals.difference))}.</>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account detail — full ledger page mirror (Bank / Party / Staff / Tax) */}
      <Dialog
        open={!!activeRow}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <DialogContent
          hideCloseButton
          {...{ [NESTED_LEDGER_POPUP_ATTR]: "" }}
          overlayClassName={NESTED_LEDGER_POPUP_OVERLAY_CN}
          style={{ height: "85vh", maxHeight: "85vh", width: "90vw", maxWidth: "90vw" }}
          className={cn(
            "balance-sheet-ledger-popup",
            NESTED_LEDGER_POPUP_CONTENT_CN,
            /* Avoid 50%+translate — subpixel blur on txn text (esp. few rows + empty fill). */
            "!left-0 !right-0 !top-0 !bottom-0 !translate-x-0 !translate-y-0 mx-auto my-auto",
            "!flex h-[85vh] max-h-[85vh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden p-0 rounded-lg bg-background",
            "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
            "data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0",
            "data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0"
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>
              {activeRow?.accountName} {activeRow?.group ? `· ${activeRow.group}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeRow ? (
              <BalanceSheetLedgerDetailMirror
                key={`${activeRow.entityType}-${activeRow.accountId}`}
                row={activeRow}
                dateRange={detailDateRange}
                onDateRangeChange={setDetailDateRange}
                onClose={closeDrawer}
                processedAccounts={processedAccounts}
                processedParties={processedParties}
                processedStaff={processedStaff}
                processedStaffGroups={processedStaffGroups}
                processedTaxes={processedTaxes}
                userNames={userNames}
                journalAccountNames={voucherJournalAccountNames}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={checkDifferenceOpen} onOpenChange={setCheckDifferenceOpen}>
        <DialogContent
          data-balance-sheet-difference-trace-popup=""
          className="w-[90vw] max-w-[90vw] h-[90vh] max-h-[90vh] overflow-hidden flex flex-col"
        >
          <DialogHeader className="shrink-0 space-y-0">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 pr-8">
              <div className="flex flex-wrap items-center gap-[10px]">
                <DialogTitle>Balance Sheet Difference Trace</DialogTitle>
                <div
                  data-bs-diff-trace-main-view-tabs=""
                  className="flex flex-wrap items-center gap-1"
                  role="tablist"
                  aria-label="Trace view"
                >
                  {(
                    [
                      { id: "opening" as const, label: "Opening trace" },
                      { id: "trxn" as const, label: "trxn trace" },
                      { id: "otherDifferent" as const, label: "other different trace" },
                    ] as const
                  ).map(({ id, label }) => {
                    const isActive = differenceTraceMainView === id;
                    const showRemainingOnPill =
                      id === "otherDifferent" &&
                      differenceBreakdown.remainingAfterOpening >= 0.01;
                    const pill = (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-tight sm:text-xs",
                          isActive
                            ? "border-blue-700 bg-blue-700 text-white hover:bg-blue-700/90"
                            : "border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100"
                        )}
                        onClick={() => {
                          setDifferenceTraceMainView(id);
                          setDifferenceTraceSelectedKey(null);
                          setDifferenceTraceHoveredKey(null);
                        }}
                      >
                        {label}
                        {showRemainingOnPill ? (
                          <>
                            <span className="font-normal opacity-80"> · </span>
                            <span
                              className={cn(
                                "tabular-nums font-bold",
                                isActive ? "text-red-200" : "text-red-700"
                              )}
                              title="Remaining after opening (Balance Sheet check)"
                            >
                              {toNepaliCurrency(
                                differenceTraceReconciliation.remainingAfterOpening
                              )}
                            </span>
                          </>
                        ) : null}
                      </button>
                    );
                    if (!showRemainingOnPill) return pill;
                    return (
                      <span key={id} className="inline-flex items-center gap-0.5">
                        {pill}
                        <Popover>
                          <PopoverTrigger asChild>
                            <AppFreshInfoButton
                              size="sm"
                              className="text-blue-400 hover:text-blue-500"
                              aria-label="Remaining after opening — how this amount is calculated"
                              title="Remaining after opening"
                            />
                          </PopoverTrigger>
                          <PopoverContent
                            side="bottom"
                            align="start"
                            className="w-[min(24rem,calc(100vw-2rem))] p-3 text-left text-xs sm:text-sm leading-relaxed"
                          >
                            <BalanceSheetDiffTraceLangTabs
                              tabsListClassName="mb-1"
                              contentClassName="space-y-2"
                              renderContent={(lang) => (
                                <>
                                  <p className="font-semibold text-foreground">
                                    {balanceSheetDiffTraceReconciliationTitle(lang)}
                                  </p>
                                  {balanceSheetDiffTraceReconciliationParagraphs(
                                    lang,
                                    differenceTraceReconciliationCopy
                                  ).map((paragraph, idx) => (
                                    <p key={idx} className="text-muted-foreground">
                                      {paragraph}
                                    </p>
                                  ))}
                                </>
                              )}
                            />
                          </PopoverContent>
                        </Popover>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </DialogHeader>
          <div className="shrink-0 text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
            <BalanceSheetFiscalYearDisplay
              ctx={companyFiscalYearContext}
              variant="trace"
              lang="en"
            />
          </div>
          <div data-balance-sheet-difference-trace-wrap="" className={BS_DIFF_TRACE_WRAP_CLASS}>
            {differenceTraceMainView === "opening" ? (
              <OpeningTraceGrid
                allOpeningRows={differenceTraceAllOpeningRows}
                openingAuditTotals={{
                  openingDr: openingBalanceAudit.totalOpeningDr,
                  openingCr: openingBalanceAudit.totalOpeningCr,
                  openingNet: round2(openingBalanceAudit.diff),
                }}
                mainView={differenceTraceMainView}
                rowKey={differenceTraceRowKey}
                formatAmount={toNepaliCurrency}
                selectedKey={differenceTraceSelectedKey}
                hoveredKey={differenceTraceHoveredKey}
                onSelectKey={setDifferenceTraceSelectedKey}
                onOpenRow={openDifferenceTraceRow}
                onHoverKey={setDifferenceTraceHoveredKey}
              />
            ) : differenceTraceMainView === "trxn" ? (
              <TrxnTraceGrid
                allOpeningRows={differenceTraceAllOpeningRows}
                conflictRows={differenceTraceConflictRows}
                otherRows={differenceTraceOtherRows}
                noOpeningRows={differenceTraceNoOpeningRows}
                mainView={differenceTraceMainView}
                rowKey={differenceTraceRowKey}
                formatAmount={toNepaliCurrency}
                selectedKey={differenceTraceSelectedKey}
                hoveredKey={differenceTraceHoveredKey}
                onSelectKey={setDifferenceTraceSelectedKey}
                onOpenRow={openDifferenceTraceRow}
                onHoverKey={setDifferenceTraceHoveredKey}
              />
            ) : (
              <OtherDifferentRemainingTrace
                mainView={differenceTraceMainView}
                breakdown={differenceBreakdown}
                checkReport={balanceSheetCheckReport}
                checkEngineInput={balanceSheetCheckEngineInput}
                openingIsBalanced={openingBalanceAudit.isBalanced}
                formatAmount={toNepaliCurrency}
                explanationActions={{
                  onOpenAccount: openAccountFromCheckEngine,
                  onOpenVoucher: openVoucherFromCheckEngine,
                  onOpenPl: openPlFromCheckEngine,
                }}
                liveRevision={ledgerLiveRevision}
                reportRunAtMs={balanceSheetCheckReport.runAtMs}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* PRINT OPTIONS DIALOG */}
      <PrintOptionsDialog
        open={showPrintDialog}
        onOpenChange={setShowPrintDialog}
        onSelect={(option) => {
          // For BalanceSheet, both options print the same (already flat structure)
          handlePrintBalanceSheet(option === 'expand');
        }}
      />

      <AddVoucherDialog
        isOpen={checkEngineVoucherOpen}
        onOpenChange={(open) => {
          setCheckEngineVoucherOpen(open);
          if (!open) setCheckEngineVoucher(null);
        }}
        voucher={checkEngineVoucher}
        onVoucherCreated={() => {
          setCheckEngineVoucherOpen(false);
          setCheckEngineVoucher(null);
        }}
      />
    </div>
  );
}
