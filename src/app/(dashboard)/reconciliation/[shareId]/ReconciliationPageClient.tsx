"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { useCalendarMonths } from "@/hooks/use-mobile";
import { useReconciliationFeature } from "@/hooks/useReconciliationFeature";
import { useSidebar } from "@/components/ui/sidebar";
import { ReconciliationPageRibbon } from "@/components/reconciliation/ReconciliationPageRibbon";
import { ReconciliationLedgerFooter } from "@/components/reconciliation/ReconciliationLedgerFooter";
import {
  getReconciliationShare,
  refreshReconciliationSideSnapshot,
  fetchVoucherForReconciliationEdit,
  saveReconciliationRowComment,
  remoteReconciliationCommentSide,
  otherPartyCommentsOnMyRowsSide,
} from "@/lib/reconciliation/reconciliationStore";
import { ReconciliationRowCommentDialog } from "@/components/reconciliation/ReconciliationRowCommentDialog";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { toast } from "sonner";
import { collection, doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { isLocalOnlyMode } from "@/lib/localMode";
import {
  applyClientDateRangeFilter,
  mergeReconciliationLedgerRows,
  rowsWithOpeningFromSnapshot,
  shareDocDateRange,
} from "@/lib/reconciliation/ledgerSnapshot";
import {
  pairReconciliationRows,
  sortReconciliationPairs,
  paginateReconciliationPairs,
  countReconciliationSideRows,
} from "@/lib/reconciliation/matchRows";
import { buildSyncVoucherDraftFromRemoteRowAsync, getMyReconciliationSideContext, getRemoteReconciliationSideContext } from "@/lib/reconciliation/buildSyncVoucherDraft";
import {
  buildLiveReconciliationSideRows,
  ensureFreshParticipantSnapshotNotes,
  resolveRemoteReconciliationRows,
  reconciliationLedgerRowDisplayNarration,
  reconciliationLedgerRowHasNarrationLine,
  reconciliationLedgerRowNarrationLabel,
} from "@/lib/reconciliation/reconciliationRowNarration";
import type { ReconciliationLedgerRow, ReconciliationShare } from "@/lib/reconciliation/types";
import {
  buildReconSideMeta,
  reconciliationViewerSide,
  reconSideCompanyId,
  withLiveReconCompanyName,
  type ReconSideMeta,
} from "@/lib/reconciliation/sideMeta";
import type { TransactionSortBy, TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { DEFAULT_TRANSACTION_SORT_ORDER } from "@/lib/transactionSort";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { RECON_PAIR_OPENING_KEY, useReconPairRowHeightSync } from "@/hooks/useReconPairRowHeightSync";
import { scrollReconciliationSelectedRowIntoView } from "@/lib/ledgerScrollToSelection";
import { cn } from "@/lib/utils";
import { RECON_PAGE_TITLE } from "@/lib/reconciliation/labels";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { reconciliationPagePath } from "@/lib/reconciliation/reconciliationChat";
import {
  parseReconciliationShareIdFromPathname,
  resolveReconciliationShareIdFromRoute,
} from "@/lib/reconciliation/resolveReconciliationShareId";
import { txnSelectedMainRowCn, txnSelectedNarrationRowCn } from "@/lib/listSelectionChrome";
import { ArrowLeft, Info, Loader2 } from "lucide-react";

/** Comment preview — sirf 10 chars table me. */
const RECON_COMMENT_PREVIEW_LEN = 10;

/** Reconciling page shell — dashboard emerald card tone (Financial Summary / sidebar jaisa) */
const RECON_PAGE_SURFACE_CLASS = cn(
  "pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald pl-dashboard-ribbon-emerald",
  "rounded-lg border-2 border-emerald-300/70",
);

/** Top meta row — Company / Entity / Account labels + values (ReconSideMeta alias). */
type ReconLedgerSideMeta = ReconSideMeta;

/** Top row — 3 column: Company, Entity, Account (label upar, name niche) */
const RECON_META_LABEL_CLASS = "!font-bold text-[11px] text-foreground/85";

function ReconLedgerSideMetaHeader({ meta }: { meta: ReconLedgerSideMeta }) {
  return (
    <div className="grid grid-cols-3 bg-muted/40 text-xs">
      <div className="min-w-0 border-r px-2 py-1.5">
        <div className={RECON_META_LABEL_CLASS} data-pl-recon-meta-label="">
          Company
        </div>
        <div className="truncate font-semibold" title={meta.companyName}>
          {meta.companyName}
        </div>
      </div>
      <div className="min-w-0 border-r px-2 py-1.5">
        <div className={RECON_META_LABEL_CLASS} data-pl-recon-meta-label="">
          Entity
        </div>
        <div className="truncate font-semibold" title={meta.entityName}>
          {meta.entityName}
        </div>
      </div>
      <div className="min-w-0 px-2 py-1.5">
        <div className={RECON_META_LABEL_CLASS} data-pl-recon-meta-label="">
          Account
        </div>
        <div className="truncate font-semibold" title={meta.accountName}>
          {meta.accountName}
        </div>
      </div>
    </div>
  );
}

function previewReconciliationComment(text: string | undefined): string {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.length <= RECON_COMMENT_PREVIEW_LEN) return t;
  return `${t.slice(0, RECON_COMMENT_PREVIEW_LEN)}…`;
}

/** Compact cell padding — accounting rows fixed height ke saath align. */
const RECON_TABLE_CELL_CLASS = "px-2 py-1 align-top leading-tight box-border";

/** AD date — alag column. */
function formatADDate(rawDate: string, formatDate: (d: Date) => string) {
  if (!rawDate) return "";
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return "";
  return formatDate(d);
}

/** BS date — alag column. */
function formatBSDate(rawDate: string, formatDateBS: (d: Date) => string) {
  if (!rawDate) return "";
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return "";
  return formatDateBS(d);
}

/** Amount cell — sirf number (no Dr/Cr/Rs); color se debit/credit/balance */
function ReconLedgerAmount({
  amount,
  column,
  decimalPlaces = 2,
}: {
  amount: number;
  column: "debit" | "credit" | "balance";
  decimalPlaces?: number;
}) {
  const n = Number(amount) || 0;
  if (n === 0) return null;

  let colorClass: string;
  const displayAmount = Math.abs(n);

  if (column === "debit") {
    colorClass = "text-green-600 font-semibold";
  } else if (column === "credit") {
    colorClass = "text-red-600 font-semibold";
  } else {
    colorClass = n >= 0 ? "text-green-700 font-bold" : "text-red-700 font-bold";
  }

  const isZeroDecimal = decimalPlaces === 0;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: isZeroDecimal ? 0 : decimalPlaces,
    maximumFractionDigits: isZeroDecimal ? 20 : decimalPlaces,
  }).format(displayAmount);

  return <span className={cn("tabular-nums whitespace-nowrap", colorClass)}>{formatted}</span>;
}

/** Date range label — system calendar ke hisaab se (toolbar / shared range). */
function formatDateRangeLabel(
  range: DateRange | undefined,
  dateSystem: "AD" | "BS" | "Both",
  formatDate: (d: Date) => string,
  formatDateBS: (d: Date) => string,
  emptyLabel = "All time"
): string {
  if (!range?.from && !range?.to) return emptyLabel;
  const from = range.from;
  const to = range.to ?? range.from;
  if (!from) return emptyLabel;
  if (dateSystem === "AD") {
    return to && to.getTime() !== from.getTime()
      ? `${formatDate(from)} – ${formatDate(to)}`
      : formatDate(from);
  }
  if (dateSystem === "BS") {
    return to && to.getTime() !== from.getTime()
      ? `${formatDateBS(from)} – ${formatDateBS(to)}`
      : formatDateBS(from);
  }
  const ad =
    to && to.getTime() !== from.getTime()
      ? `${formatDate(from)} – ${formatDate(to)}`
      : formatDate(from);
  const bs =
    to && to.getTime() !== from.getTime()
      ? `${formatDateBS(from)} – ${formatDateBS(to)}`
      : formatDateBS(from);
  return `${bs} (${ad})`;
}

type ReconDateSystem = "AD" | "BS" | "Both";

/** Fixed column widths — date + balance stable; beech Voucher/Dr/Cr spread */
const RECON_COL = {
  bsDate: "13%",
  adDate: "13%",
  voucher: "20%",
  dr: "16%",
  cr: "16%",
  balance: "18%",
} as const;

/** Comment column — ℹ️ icon; % se table 100% fill (right gap na ho) */
const RECON_COMMENT_COL_WIDTH = "4%";

/** Voucher No. — thoda right padding; header/body same */
const RECON_VOUCHER_HEAD_CLASS = "pl-3";
const RECON_VOUCHER_CELL_CLASS = "pl-3";

/** dateSystem se BS/AD show/hide; narration = dates se Balance tak colspan (ℹ️ alag col) */
function getReconTableLayout(dateSystem: ReconDateSystem) {
  const showBsDate = dateSystem === "BS" || dateSystem === "Both";
  const showAdDate = dateSystem === "AD" || dateSystem === "Both";
  const dateColCount = (showBsDate ? 1 : 0) + (showAdDate ? 1 : 0);
  /** BS/AD + Voucher + Debit + Credit + Balance — comment icon last col alag */
  const narrationColSpan = dateColCount + 4;
  return {
    showBsDate,
    showAdDate,
    narrationColSpan,
  } as const;
}

/** table-fixed: th/td ko colgroup width follow karwane ke liye w-0 (content se stretch na ho). */
const RECON_TABLE_CELL_W0 = "w-0 max-w-none";

/** Header cells — fixed row height, barabar horizontal padding. */
const RECON_TABLE_HEAD_CLASS = cn(
  RECON_TABLE_CELL_CLASS,
  RECON_TABLE_CELL_W0,
  "h-[32px] px-1.5 text-[11px] font-semibold align-middle"
);

/** Body data cells — header ke saath same width + padding. */
const RECON_TABLE_DATA_CLASS = cn(
  RECON_TABLE_CELL_CLASS,
  RECON_TABLE_CELL_W0,
  "h-[32px] px-1.5 align-middle"
);

/** Narration sub-row — label + text (party txn table jaisa "Narration: …") */
const RECON_NARRATION_CELL_CLASS = cn(
  RECON_TABLE_DATA_CLASS,
  "h-auto px-2 pb-1 pt-1 text-[11px] leading-tight whitespace-normal break-words align-top box-border w-full min-w-0"
);

/** Amount cells — poora number, right edge align (no truncate). */
const RECON_AMOUNT_CELL_CLASS = cn(RECON_TABLE_DATA_CLASS, "whitespace-nowrap text-right");

/** Balance ↔ ℹ️ beech exact 10px — header + body dono flex gap se */
const RECON_BALANCE_COMMENT_GAP_CLASS = "gap-[10px]";

/** Body: Balance + ℹ️ ek colspan=2 cell — right edge container touch (no pr gap) */
const RECON_BALANCE_COMMENT_CELL_CLASS = cn(
  RECON_TABLE_DATA_CLASS,
  "px-0 pr-0 text-right"
);

/** ℹ️ button — balance cell ke andar; comment ho to green, warna blue (add comment) */
function ReconCommentIcon({
  commentText,
  readOnly = false,
  row,
  onCommentInfoClick,
}: {
  commentText?: string;
  readOnly?: boolean;
  row?: ReconciliationLedgerRow;
  onCommentInfoClick?: (row: ReconciliationLedgerRow) => void;
}) {
  const showIcon = Boolean(row);
  const hasComment = Boolean(String(commentText || "").trim());
  if (!showIcon) {
    return <span className="inline-block h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      data-pl-recon-comment-icon=""
      data-pl-recon-comment-has={hasComment ? "" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors",
        hasComment
          ? "h-5 w-5 bg-green-600 text-white shadow-sm ring-1 ring-green-700 hover:bg-green-700 dark:bg-green-500 dark:text-white dark:ring-green-400 dark:hover:bg-green-600"
          : "h-4 w-4 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-950"
      )}
      title={hasComment ? (readOnly ? "View comment from other side" : "View / edit comment") : "Add comment"}
      onClick={(e) => {
        e.stopPropagation();
        if (row) onCommentInfoClick?.(row);
      }}
    >
      <Info className={cn(hasComment ? "h-3.5 w-3.5 stroke-[2.5]" : "h-3.5 w-3.5")} />
    </button>
  );
}

/** Sync transaction link — text ke baad medium ← shaft (<-- jaisa, pehle se chhota) */
function ReconSyncLongArrow({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3.5 w-9 shrink-0", className)}
      viewBox="0 0 36 14"
      fill="none"
      aria-hidden
    >
      <path
        d="M34 7H16M16 7L21 2M16 7L21 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Transaction row — amount + ℹ️ header jaisa right align (colspan=2) */
function ReconBalanceCommentCell({
  balanceContent,
  commentText,
  commentPreview,
  onCommentInfoClick,
  row,
  readOnly = false,
  className,
}: {
  balanceContent?: React.ReactNode;
  commentText?: string;
  commentPreview?: string;
  onCommentInfoClick?: (row: ReconciliationLedgerRow) => void;
  row?: ReconciliationLedgerRow;
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <td colSpan={2} className={cn(RECON_BALANCE_COMMENT_CELL_CLASS, className)}>
      <div className={cn("flex w-full items-center justify-end", RECON_BALANCE_COMMENT_GAP_CLASS)}>
        {balanceContent ? (
          <div className="shrink-0 [&_.flex.w-full]:w-auto">{balanceContent}</div>
        ) : (
          <span className="inline-block min-w-0 shrink-0" aria-hidden="true" />
        )}
        {commentPreview ? (
          <span className="sr-only" title={commentText || undefined}>
            {commentPreview}
          </span>
        ) : null}
        <ReconCommentIcon
          commentText={commentText}
          readOnly={readOnly}
          row={row}
          onCommentInfoClick={onCommentInfoClick}
        />
      </div>
    </td>
  );
}

function ReconLedgerHeaderRow({ layout }: { layout: ReturnType<typeof getReconTableLayout> }) {
  return (
    <tr className="text-blue-950 dark:text-blue-100">
      {layout.showBsDate ? (
        <th className={cn(RECON_TABLE_HEAD_CLASS, "text-left")}>BS Date</th>
      ) : null}
      {layout.showAdDate ? (
        <th className={cn(RECON_TABLE_HEAD_CLASS, "text-left")}>
          {layout.showBsDate ? "AD Date" : "Date"}
        </th>
      ) : null}
      {/* Voucher No. — thoda right; Dr/Cr right aligned */}
      <th className={cn(RECON_TABLE_HEAD_CLASS, RECON_VOUCHER_HEAD_CLASS, "text-left")}>Voucher No.</th>
      <th className={cn(RECON_TABLE_HEAD_CLASS, "text-right")}>Debit</th>
      <th className={cn(RECON_TABLE_HEAD_CLASS, "text-right")}>Credit</th>
      {/* Balance + ℹ️ ek hi header cell — colgroup ke last 2 cols; body alag rahega */}
      <th
        colSpan={2}
        className={cn(RECON_TABLE_HEAD_CLASS, "overflow-hidden px-0 text-right pr-0")}
      >
        <div className="flex w-full items-center justify-end gap-[10px]">
          <span>Balance</span>
          <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Comment</span>
        </div>
      </th>
    </tr>
  );
}

/** Dono tables identical colgroup — header/body same RECON_COL widths */
function ReconTableColGroup({ layout }: { layout: ReturnType<typeof getReconTableLayout> }) {
  return (
    <colgroup>
      {layout.showBsDate ? <col style={{ width: RECON_COL.bsDate }} /> : null}
      {layout.showAdDate ? <col style={{ width: RECON_COL.adDate }} /> : null}
      <col style={{ width: RECON_COL.voucher }} />
      <col style={{ width: RECON_COL.dr }} />
      <col style={{ width: RECON_COL.cr }} />
      <col style={{ width: RECON_COL.balance }} />
      <col style={{ width: RECON_COMMENT_COL_WIDTH }} />
    </colgroup>
  );
}

/** Dono split tables par same layout — border-collapse accounting style. */
const RECON_LEDGER_TABLE_CLASS = "w-full table-fixed border-collapse text-xs";

/** Dono ledger — ek scroll + pair height sync (sirf linked share pe mount) */
function ReconciliationLedgerPairGrid({
  leftMeta,
  rightMeta,
  pairCount,
  syncKey,
  selectedRowKey,
  onRowSelectPair,
  onSyncTransaction,
  left,
  right,
}: {
  leftMeta: ReconLedgerSideMeta;
  rightMeta: ReconLedgerSideMeta;
  pairCount: number;
  syncKey: string;
  /** `${side}:${pairIndex}` — filled + blank dono select */
  selectedRowKey?: string | null;
  onRowSelectPair?: (side: "left" | "right", pairIndex: number) => void;
  /** Blank left row se remote txn copy — add voucher dialog */
  onSyncTransaction?: (pairIndex: number) => void;
  left: Omit<
    React.ComponentProps<typeof LedgerSideTable>,
    "embedded" | "tbodyRef" | "title" | "shellClassName" | "selectedRowKey" | "onRowSelect" | "onSyncTransaction"
  >;
  right: Omit<
    React.ComponentProps<typeof LedgerSideTable>,
    "embedded" | "tbodyRef" | "title" | "shellClassName" | "selectedRowKey" | "onRowSelect" | "onSyncTransaction"
  >;
}) {
  const leftBodyRef = React.useRef<HTMLTableSectionElement>(null);
  const rightBodyRef = React.useRef<HTMLTableSectionElement>(null);
  const scrollHostRef = React.useRef<HTMLDivElement>(null);
  useReconPairRowHeightSync(leftBodyRef, rightBodyRef, pairCount, syncKey);
  /** Bottom fixed closing row ke liye balance values table props se alag nikaale. */
  const { closingBalance: leftClosingBalance, ...leftTableProps } = left;
  const { closingBalance: rightClosingBalance, ...rightTableProps } = right;

  /** Space — selected row par scroll; refresh/height sync par manual scroll position safe */
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (!selectedRowKey) return;
      e.preventDefault();
      scrollReconciliationSelectedRowIntoView(scrollHostRef.current, selectedRowKey);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedRowKey]);

  // Ledger pair card — page shell jaisa dashboard emerald green tone
  return (
    <div
      className={cn(RECON_PAGE_SURFACE_CLASS, "flex min-h-0 flex-1 flex-col overflow-hidden")}
      data-pl-reconciliation-ledger=""
    >
      <div className="grid grid-cols-2 border-b">
        <ReconLedgerSideMetaHeader meta={leftMeta} />
        <div className="border-l">
          <ReconLedgerSideMetaHeader meta={rightMeta} />
        </div>
      </div>
      {/* overflow-anchor off — selected row anchor se auto jump na ho; Space se scroll alag */}
      <div
        ref={scrollHostRef}
        data-recon-scroll-host=""
        className="min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-slim-dim [overflow-anchor:none]"
      >
        <div className="grid w-full grid-cols-2">
          <LedgerSideTable
            embedded
            tbodyRef={leftBodyRef}
            title=""
            {...leftTableProps}
            selectedRowKey={selectedRowKey}
            onRowSelect={onRowSelectPair ? (pairIndex) => onRowSelectPair("left", pairIndex) : undefined}
            onSyncTransaction={onSyncTransaction}
          />
          <LedgerSideTable
            embedded
            tbodyRef={rightBodyRef}
            shellClassName="border-l"
            title=""
            {...rightTableProps}
            selectedRowKey={selectedRowKey}
            onRowSelect={onRowSelectPair ? (pairIndex) => onRowSelectPair("right", pairIndex) : undefined}
          />
        </div>
      </div>
      {/* Closing balance fixed row — scroll area ke bahar same ledger box ke niche pin rahe. */}
      <div className="grid grid-cols-2 border-t border-blue-300/80 bg-blue-100/80">
        <ReconLedgerFixedClosingRow
          dateSystem={leftTableProps.dateSystem}
          decimalPlaces={leftTableProps.decimalPlaces}
          closingBalance={leftClosingBalance}
        />
        <ReconLedgerFixedClosingRow
          dateSystem={rightTableProps.dateSystem}
          decimalPlaces={rightTableProps.decimalPlaces}
          closingBalance={rightClosingBalance}
          className="border-l border-blue-300/80"
        />
      </div>
    </div>
  );
}

/** Same ledger box ka non-scroll closing row (blue tone), table columns ke saath aligned. */
function ReconLedgerFixedClosingRow({
  dateSystem,
  decimalPlaces = 2,
  closingBalance,
  className,
}: {
  dateSystem: ReconDateSystem;
  decimalPlaces?: number;
  closingBalance: number;
  className?: string;
}) {
  const layout = React.useMemo(() => getReconTableLayout(dateSystem), [dateSystem]);
  return (
    <div className={cn("min-w-0 w-full", className)}>
      <table className={RECON_LEDGER_TABLE_CLASS}>
        <ReconTableColGroup layout={layout} />
        <tbody>
          <tr className="border-b border-blue-300/80 bg-blue-100/65">
            {layout.showBsDate ? <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td> : null}
            {layout.showAdDate ? <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td> : null}
            <td className={cn(RECON_TABLE_DATA_CLASS, "font-semibold text-blue-900")}>Closing Balance</td>
            <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td>
            <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td>
            <ReconBalanceCommentCell
              balanceContent={
                <ReconLedgerAmount amount={closingBalance} column="balance" decimalPlaces={decimalPlaces} />
              }
              readOnly
            />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Party txn jaisa — main+narration pair hover; rows ke beech move par highlight na toote */
function handleReconPairHoverLeave(
  rowSelectKey: string,
  mainDomId: string,
  narrDomId: string | null,
  setHoveredRowKey: React.Dispatch<React.SetStateAction<string | null>>,
  e: React.MouseEvent<HTMLTableRowElement>
) {
  const rel = e.relatedTarget;
  if (rel instanceof Node) {
    const mainEl = document.getElementById(mainDomId);
    const narrEl = narrDomId ? document.getElementById(narrDomId) : null;
    if (mainEl?.contains(rel) || narrEl?.contains(rel)) return;
  }
  setHoveredRowKey((cur) => (cur === rowSelectKey ? null : cur));
}

function LedgerSideTable({
  title,
  rows,
  side,
  /** Same pair index — dono column par matched row green */
  matchedPairIndices,
  openingBalance,
  /** Pair-grid fixed bottom row ke liye carry prop; is table body me render nahi hota. */
  closingBalance: _closingBalance,
  formatDate,
  formatDateBS,
  dateSystem,
  /** Company decimal places — amount cells me sirf number format */
  decimalPlaces = 2,
  onRowDoubleClick,
  /** Single click — party page jaisa row select (filled + blank dono) */
  selectedRowKey,
  onRowSelect,
  /** Selected blank row pe — remote txn se naya voucher */
  onSyncTransaction,
  rowComments,
  onCommentInfoClick,
  commentReadOnly = false,
  /** Same index par doosri side ka row — filler height pair ke saath match */
  pairedRows,
  /** Pair height sync — left/right tbody ref */
  tbodyRef,
  /** Pair grid ke andar — alag scroll nahi */
  embedded = false,
  shellClassName,
}: {
  title: string;
  rows: (ReconciliationLedgerRow | null)[];
  side: "left" | "right";
  matchedPairIndices: Set<number>;
  openingBalance: number;
  /** Fixed closing row parent pair-grid me render hota hai; yahan type compatibility ke liye. */
  closingBalance?: number;
  formatDate: (d: Date) => string;
  formatDateBS: (d: Date) => string;
  /** System date — AD / BS / Both columns show/hide */
  dateSystem: ReconDateSystem;
  /** Amount formatting — Dr/Cr/Rs nahi, sirf number */
  decimalPlaces?: number;
  /** You-side: double-click → voucher edit */
  onRowDoubleClick?: (row: ReconciliationLedgerRow) => void;
  /** Is side par selected row key — `${side}:${pairIndex}` */
  selectedRowKey?: string | null;
  /** Click pe pair select — index se blank row bhi select ho sake */
  onRowSelect?: (pairIndex: number) => void;
  /** Apni side blank row select + remote filled → sync voucher dialog */
  onSyncTransaction?: (pairIndex: number) => void;
  /** row id → comment text */
  rowComments?: Record<string, string>;
  onCommentInfoClick?: (row: ReconciliationLedgerRow) => void;
  /** You-side: remote ka comment sirf dekho */
  commentReadOnly?: boolean;
  /** Opposite column rows — filler (—) ko paired txn/narration height match */
  pairedRows?: (ReconciliationLedgerRow | null)[];
  /** useReconPairRowHeightSync ke liye tbody ref */
  tbodyRef?: React.RefObject<HTMLTableSectionElement | null>;
  embedded?: boolean;
  shellClassName?: string;
}) {
  const layout = React.useMemo(() => getReconTableLayout(dateSystem), [dateSystem]);

  /** Opening / empty rows — date cells placeholder */
  const datePlaceholders = (
    <>
      {layout.showBsDate ? <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td> : null}
      {layout.showAdDate ? <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td> : null}
    </>
  );

  /** Transaction row — dateSystem ke hisaab se BS / AD / dono */
  const renderDateCells = (rawDate: string) => (
    <>
      {layout.showBsDate ? (
        <td className={cn(RECON_TABLE_DATA_CLASS, "whitespace-nowrap")}>
          {formatBSDate(rawDate, formatDateBS)}
        </td>
      ) : null}
      {layout.showAdDate ? (
        <td className={cn(RECON_TABLE_DATA_CLASS, "whitespace-nowrap")}>
          {formatADDate(rawDate, formatDate)}
        </td>
      ) : null}
    </>
  );

  /** ℹ️ button click row select na trigger kare */
  const handlePairRowClick = React.useCallback(
    (pairIndex: number, e: React.MouseEvent<HTMLTableRowElement>) => {
      if ((e.target as HTMLElement).closest("button")) return;
      onRowSelect?.(pairIndex);
    },
    [onRowSelect]
  );

  /** Party page jaisa orange hover — main + narration ek block */
  const [hoveredRowKey, setHoveredRowKey] = React.useState<string | null>(null);

  return embedded ? (
    <div className={cn("min-w-0 w-full", shellClassName)}>{renderLedgerTable()}</div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
      <div className="truncate border-b bg-muted/40 px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-slim-dim [scrollbar-gutter:stable]">
        {renderLedgerTable()}
      </div>
    </div>
  );

  function renderLedgerTable() {
    return (
      <>
        <div className="sticky top-0 z-10 w-full border-b border-blue-200/80 bg-blue-100/90 dark:border-blue-800 dark:bg-blue-950/45">
          <table className={RECON_LEDGER_TABLE_CLASS}>
            <ReconTableColGroup layout={layout} />
            <thead>
              <ReconLedgerHeaderRow layout={layout} />
            </thead>
          </table>
        </div>
        <table className={RECON_LEDGER_TABLE_CLASS} data-theme-table="transactions">
          <ReconTableColGroup layout={layout} />
          <tbody ref={tbodyRef}>
            <tr data-recon-pair={RECON_PAIR_OPENING_KEY} className="border-b bg-muted/20">
              {datePlaceholders}
              <td className={cn(RECON_TABLE_DATA_CLASS, "font-medium")}>Opening Balance</td>
              <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td>
              <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td>
              <ReconBalanceCommentCell
                balanceContent={
                  <ReconLedgerAmount amount={openingBalance} column="balance" decimalPlaces={decimalPlaces} />
                }
                readOnly={commentReadOnly}
              />
            </tr>
            {rows.map((r, i) => {
              const pairKey = String(i);
              const rowSelectKey = `${side}:${i}`;
              const isSelected = selectedRowKey === rowSelectKey;
              const rowInteractive = Boolean(onRowSelect || (r && onRowDoubleClick));
              const rowTitle = r && onRowDoubleClick
                ? "Click to select, double-click to edit voucher"
                : onRowSelect
                  ? "Click to select"
                  : undefined;
              if (!r) {
                // Filler (—) — click se bhi select; height sync hook paired row match karega
                const mainDomId = `recon-${side}-main-${i}`;
                const isHovered = !isSelected && hoveredRowKey === rowSelectKey;
                const onPairHoverEnter = rowInteractive ? () => setHoveredRowKey(rowSelectKey) : undefined;
                const onPairHoverLeave = rowInteractive
                  ? (e: React.MouseEvent<HTMLTableRowElement>) =>
                      handleReconPairHoverLeave(rowSelectKey, mainDomId, null, setHoveredRowKey, e)
                  : undefined;
                // Remote side blank (—) — paired you-side txn par comment (matching notes)
                const pairedRow = pairedRows?.[i] ?? null;
                const pairedHasTxn = Boolean(pairedRow);
                const fillerMatched = matchedPairIndices.has(i) && pairedHasTxn;
                const fillerUnmatched = pairedHasTxn && !matchedPairIndices.has(i);
                const fillerCommentRow =
                  !commentReadOnly && pairedRow && onCommentInfoClick ? pairedRow : undefined;
                const fillerCommentText = fillerCommentRow ? rowComments?.[fillerCommentRow.id] : undefined;
                const fillerCommentPreview = previewReconciliationComment(fillerCommentText);
                return (
                  <tr
                    key={`empty-${side}-${i}`}
                    id={mainDomId}
                    data-recon-pair={pairKey}
                    data-txn-stripe={String(i % 2)}
                    data-pl-recon-matched={fillerMatched ? "" : undefined}
                    data-pl-recon-unmatched={fillerUnmatched && !isSelected ? "" : undefined}
                    className={cn(
                      "transaction-main-row border-b",
                      rowInteractive && "cursor-pointer",
                      isSelected && !fillerMatched && txnSelectedMainRowCn(false)
                    )}
                    data-pl-txn-selected={isSelected ? "" : undefined}
                    data-pl-txn-hovered={isHovered ? "" : undefined}
                    onMouseEnter={onPairHoverEnter}
                    onMouseLeave={onPairHoverLeave}
                    onClick={onRowSelect ? (e) => handlePairRowClick(i, e) : undefined}
                    title={rowTitle}
                  >
                    {datePlaceholders}
                    {isSelected && onSyncTransaction && pairedRows?.[i] ? (
                      /* Blank row sync — poori row ke right edge par link + lamba ← arrow text ke baad */
                      <td colSpan={5} className={cn(RECON_TABLE_DATA_CLASS, "px-2 text-right")}>
                        <div className={cn("flex w-full items-center justify-end", RECON_BALANCE_COMMENT_GAP_CLASS)}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 underline hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200"
                            title="Copy opposite-side transaction into new voucher"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSyncTransaction(i);
                            }}
                          >
                            Sync transaction
                            <ReconSyncLongArrow />
                          </button>
                          <ReconCommentIcon
                            commentText={fillerCommentText}
                            readOnly={commentReadOnly}
                            row={fillerCommentRow}
                            onCommentInfoClick={onCommentInfoClick}
                          />
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className={cn(RECON_TABLE_DATA_CLASS, RECON_VOUCHER_CELL_CLASS, "text-center")}>
                          <span className="text-muted-foreground italic">—</span>
                        </td>
                        <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td>
                        <td className={RECON_TABLE_DATA_CLASS}>&nbsp;</td>
                        <ReconBalanceCommentCell
                          readOnly={commentReadOnly}
                          row={fillerCommentRow}
                          commentText={fillerCommentText}
                          commentPreview={fillerCommentPreview}
                          onCommentInfoClick={onCommentInfoClick}
                        />
                      </>
                    )}
                  </tr>
                );
              }
              // Pair index se match — green; selected par sirf orange outline, bg green hi
              const matched = matchedPairIndices.has(i);
              const unmatchedTxn = !matched;
              const commentText = rowComments?.[r.id];
              const commentPreview = previewReconciliationComment(commentText);
              const displayNarration = reconciliationLedgerRowDisplayNarration(r);
              const narrationLabel = reconciliationLedgerRowNarrationLabel(r);
              const hasNarration = reconciliationLedgerRowHasNarrationLine(r);
              const mainDomId = `recon-${side}-main-${i}`;
              const narrDomId = hasNarration ? `recon-${side}-narr-${i}` : null;
              const isHovered = !isSelected && hoveredRowKey === rowSelectKey;
              const onPairHoverEnter = rowInteractive ? () => setHoveredRowKey(rowSelectKey) : undefined;
              const onPairHoverLeave = rowInteractive
                ? (e: React.MouseEvent<HTMLTableRowElement>) =>
                    handleReconPairHoverLeave(rowSelectKey, mainDomId, narrDomId, setHoveredRowKey, e)
                : undefined;
              const rowChrome = cn(rowInteractive && "cursor-pointer");
              const onDblClick = onRowDoubleClick ? () => onRowDoubleClick(r) : undefined;
              return (
                <React.Fragment key={r.id}>
                  <tr
                    id={mainDomId}
                    data-recon-pair={pairKey}
                    data-txn-stripe={String(i % 2)}
                    data-pl-recon-matched={matched ? "" : undefined}
                    data-pl-recon-unmatched={unmatchedTxn && !isSelected ? "" : undefined}
                    className={cn(
                      "transaction-main-row",
                      rowChrome,
                      hasNarration ? "border-b-0 [&>td]:h-auto [&>td]:pb-0 [&>td]:align-top" : "border-b",
                      isSelected && !matched && txnSelectedMainRowCn(hasNarration)
                    )}
                    data-pl-txn-selected={isSelected ? "" : undefined}
                    data-pl-txn-hovered={isHovered ? "" : undefined}
                    onMouseEnter={onPairHoverEnter}
                    onMouseLeave={onPairHoverLeave}
                    onClick={onRowSelect ? (e) => handlePairRowClick(i, e) : undefined}
                    onDoubleClick={onDblClick}
                    title={rowTitle}
                  >
                    {renderDateCells(r.rawDate)}
                    <td className={cn(RECON_TABLE_DATA_CLASS, RECON_VOUCHER_CELL_CLASS, "font-medium truncate")}>
                      {r.voucherNumber}
                    </td>
                    <td className={RECON_AMOUNT_CELL_CLASS}>
                      {r.debit ? <ReconLedgerAmount amount={r.debit} column="debit" decimalPlaces={decimalPlaces} /> : null}
                    </td>
                    <td className={RECON_AMOUNT_CELL_CLASS}>
                      {r.credit ? <ReconLedgerAmount amount={r.credit} column="credit" decimalPlaces={decimalPlaces} /> : null}
                    </td>
                    <ReconBalanceCommentCell
                      balanceContent={
                        r.balance != null ? (
                          <ReconLedgerAmount amount={r.balance} column="balance" decimalPlaces={decimalPlaces} />
                        ) : undefined
                      }
                      commentText={commentText}
                      commentPreview={commentPreview}
                      onCommentInfoClick={onCommentInfoClick}
                      row={r}
                      readOnly={commentReadOnly}
                    />
                  </tr>
                  {hasNarration ? (
                    <tr
                      id={narrDomId ?? undefined}
                      data-recon-pair={pairKey}
                      data-txn-stripe={String(i % 2)}
                      data-pl-recon-matched={matched ? "" : undefined}
                      data-pl-recon-unmatched={unmatchedTxn && !isSelected ? "" : undefined}
                      className={cn(
                        "narration-row border-b",
                        rowChrome,
                        isSelected && !matched && txnSelectedNarrationRowCn()
                      )}
                      data-pl-txn-selected={isSelected ? "" : undefined}
                      data-pl-txn-hovered={isHovered ? "" : undefined}
                      onMouseEnter={onPairHoverEnter}
                      onMouseLeave={onPairHoverLeave}
                      onClick={onRowSelect ? (e) => handlePairRowClick(i, e) : undefined}
                      onDoubleClick={onDblClick}
                      title={rowTitle}
                    >
                      <td
                        colSpan={layout.narrationColSpan}
                        className={RECON_NARRATION_CELL_CLASS}
                        data-pl-recon-narration=""
                        style={{ overflowWrap: "anywhere" }}
                      >
                        <span className="block min-w-0 break-words">
                          <span className={cn(RECON_META_LABEL_CLASS, "not-italic")} data-pl-recon-meta-label="">
                            {narrationLabel}:
                          </span>{" "}
                          {/* Narration / Note title — gray body text */}
                          <span className="!font-semibold !text-muted-foreground">{displayNarration}</span>
                        </span>
                      </td>
                      {/* Narration row — ℹ️ sirf main txn row par; yahan empty col alignment ke liye */}
                      <td className={cn(RECON_TABLE_DATA_CLASS, "h-auto w-0 px-0 align-top")} aria-hidden="true">
                        &nbsp;
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }
}

export default function ReconciliationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const shareId = resolveReconciliationShareIdFromRoute({
    paramShareId: params?.shareId,
    searchShareId: searchParams.get("shareId"),
  });
  const router = useRouter();
  const { user } = useAuth();
  const { companyId, company, allCompaniesRegistry } = useCompany();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const calendarMonths = useCalendarMonths();
  const { canView, enabled, canSyncTrxn } = useReconciliationFeature();
  const { setIsOpen } = useSidebar();
  const [share, setShare] = React.useState<ReconciliationShare | null>(null);
  const [myRowsSource, setMyRowsSource] = React.useState<ReconciliationLedgerRow[]>([]);
  const [remoteRows, setRemoteRows] = React.useState<ReconciliationLedgerRow[]>([]);
  const [myOpeningSource, setMyOpeningSource] = React.useState(0);
  const [remoteOpeningBalance, setRemoteOpeningBalance] = React.useState(0);
  const [myDateRange, setMyDateRange] = React.useState<DateRange | undefined>(undefined);
  const [tempMyDateRange, setTempMyDateRange] = React.useState<DateRange | undefined>(undefined);
  const [isAdCalendarOpen, setIsAdCalendarOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = React.useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "10");
  const [selectedVoucher, setSelectedVoucher] = React.useState<Record<string, unknown> | null>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = React.useState(false);
  const [commentRow, setCommentRow] = React.useState<ReconciliationLedgerRow | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = React.useState(false);
  const [commentSaving, setCommentSaving] = React.useState(false);
  const [voucherLoading, setVoucherLoading] = React.useState(false);
  /** Sync blank row → remote txn copy draft (AddVoucherDialog create mode) */
  const [syncVoucherDraft, setSyncVoucherDraft] = React.useState<Record<string, unknown> | null>(null);
  const [syncDefaultTab, setSyncDefaultTab] = React.useState<string>("payment_in");
  const [voucherDialogSeedKey, setVoucherDialogSeedKey] = React.useState(0);
  /** Party page jaisa — ek time pe ek row select (filled + blank); key = side:index */
  const [selectedRowKey, setSelectedRowKey] = React.useState<string | null>(null);

  /** Static/EXE: purana `/reconciliation/{id}/` → `?shareId=` (full reload 404 → root → dashboard band) */
  React.useEffect(() => {
    if (!isStaticAppBuild() || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("shareId");
    if (q?.trim()) return;
    const fromPath = parseReconciliationShareIdFromPathname(window.location.pathname);
    if (!fromPath) return;
    router.replace(reconciliationPagePath(fromPath), { scroll: false });
  }, [router]);

  // Reconciling page — zyada width: sidebar collapse + refresh par bhi band rahe
  React.useEffect(() => {
    setIsOpen(false);
    try {
      localStorage.setItem("sidebar-isOpen", JSON.stringify(false));
    } catch {
      /* ignore */
    }
  }, [setIsOpen]);

  React.useEffect(() => {
    setTempMyDateRange(myDateRange);
  }, [myDateRange]);

  /** silent=true — table dikhte hue background refresh (full-page loader nahi) */
  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!shareId || !user?.uid) return;
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const s0 = await getReconciliationShare(shareId, companyId ?? undefined);
      if (!s0 || s0.status !== "linked") {
        setShare(s0);
        setMyRowsSource([]);
        setRemoteRows([]);
        setMyOpeningSource(0);
        setRemoteOpeningBalance(0);
        return;
      }
      // Apni side snapshot me purane NOTE ho to refresh — other party ko sahi title dikhe
      const s = (await ensureFreshParticipantSnapshotNotes(s0, user.uid)) ?? s0;
      setShare(s);
      const senderSide = rowsWithOpeningFromSnapshot(s.senderLedgerSnapshot, s.senderOpeningBalance);
      const receiverSide = rowsWithOpeningFromSnapshot(s.receiverLedgerSnapshot, s.receiverOpeningBalance);
      let mine: ReconciliationLedgerRow[] = [];
      let remote: ReconciliationLedgerRow[] = [];
      let myOpening = 0;
      let remoteOpening = 0;

      // Owned + Other — same live build; other fail ho to share snapshot + NOTE title enrich
      const myCtx = getMyReconciliationSideContext(s, user.uid, companyId ?? "");
      const remoteCtx = getRemoteReconciliationSideContext(s, user.uid, companyId ?? "");
      const viewerOnSenderSide = myCtx?.companyId === s.senderCompanyId;

      const myBuilt = await buildLiveReconciliationSideRows(myCtx);
      const mySnapshotRows = viewerOnSenderSide ? senderSide.rows : receiverSide.rows;
      const mySnapshotOpening = viewerOnSenderSide ? senderSide.openingBalance : receiverSide.openingBalance;
      if (myBuilt && myBuilt.rows.length > 0) {
        // Owned side — live + snapshot union (local mirror adhoora ho to bhi)
        mine = mergeReconciliationLedgerRows(myBuilt.rows, mySnapshotRows, myBuilt.openingBalance);
        myOpening = myBuilt.openingBalance;
      } else {
        mine = mySnapshotRows;
        myOpening = mySnapshotOpening;
      }

      remote = viewerOnSenderSide ? receiverSide.rows : senderSide.rows;
      remoteOpening = viewerOnSenderSide ? receiverSide.openingBalance : senderSide.openingBalance;

      const remoteResolved = await resolveRemoteReconciliationRows({
        share: s,
        userId: user.uid,
        remoteCtx,
        snapshotRows: remote,
        snapshotOpening: remoteOpening,
      });
      remote = remoteResolved.rows;
      remoteOpening = remoteResolved.openingBalance;
      setMyRowsSource(mine);
      setRemoteRows(remote);
      setMyOpeningSource(myOpening);
      setRemoteOpeningBalance(remoteOpening);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [shareId, user?.uid, companyId]);

  /** Background live sync — save/delete + Firestore listener; full-page loader nahi */
  const liveRefreshTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Live listeners (share doc + vouchers): burst updates ko debounce karke silent reload. */
  const scheduleLiveSilentReload = React.useCallback((runner: () => void) => {
    if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = setTimeout(() => {
      liveRefreshTimerRef.current = null;
      runner();
    }, 700);
  }, []);
  const refreshMySideSilent = React.useCallback(async () => {
    if (!shareId || !user?.uid) return;
    try {
      const s = await getReconciliationShare(shareId, companyId ?? undefined);
      if (!s || s.status !== "linked") return;
      // Viewer ki owned side — sender+receiver same uid par galat side refresh na ho
      const viewerSide = reconciliationViewerSide(s, user.uid, companyId ?? undefined);
      const side =
        viewerSide === "receiver"
          ? "receiver"
          : viewerSide === "sender"
            ? "sender"
            : s.senderUserId === user.uid
              ? "sender"
              : "receiver";
      await refreshReconciliationSideSnapshot({ shareId: s.id, side });
    } catch {
      /* snapshot fail — live voucher load phir bhi try karo */
    }
    await load({ silent: true });
  }, [shareId, user?.uid, companyId, load]);

  React.useEffect(() => {
    if (!enabled || !canView) return;
    load();
  }, [enabled, canView, load]);

  // You-side: user date range filter + period opening
  const { rows: myRows, openingBalance: myOpeningBalance } = React.useMemo(
    () => applyClientDateRangeFilter(myRowsSource, myOpeningSource, myDateRange),
    [myRowsSource, myOpeningSource, myDateRange]
  );

  const pairs = React.useMemo(() => {
    const myCtx =
      share && user?.uid ? getMyReconciliationSideContext(share, user.uid, companyId ?? "") : null;
    const remoteCtx =
      share && user?.uid ? getRemoteReconciliationSideContext(share, user.uid, companyId ?? "") : null;
    return sortReconciliationPairs(
      pairReconciliationRows(myRows, remoteRows, {
        leftCompanyId: myCtx?.companyId,
        rightCompanyId: remoteCtx?.companyId,
      }),
      sortBy,
      sortOrder
    );
  }, [myRows, remoteRows, sortBy, sortOrder, share, user?.uid, companyId]);

  const pagination = React.useMemo(
    () => paginateReconciliationPairs(pairs, rowsPerPage, currentPage),
    [pairs, rowsPerPage, currentPage]
  );

  const paginatedPairs = pagination.paginated;
  const totalPages = pagination.totalPages;

  React.useEffect(() => {
    // Sirf user filter/sort/page-size — live refresh (pairs.length) se last page par jump na ho
    setCurrentPage(1);
  }, [myDateRange, rowsPerPage, sortBy, sortOrder]);

  React.useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  // Side totals — meta pills ke liye; pagination ek hi bar (pair slice counts).
  const leftTotalCount = React.useMemo(
    () => countReconciliationSideRows(pairs, "left"),
    [pairs]
  );

  const rightTotalCount = React.useMemo(
    () => countReconciliationSideRows(pairs, "right"),
    [pairs]
  );

  /** Footer fixed closing balance: last running balance, warna opening fallback. */
  const leftClosingBalance = React.useMemo(() => {
    const last = myRows[myRows.length - 1];
    return typeof last?.balance === "number" ? last.balance : myOpeningBalance;
  }, [myRows, myOpeningBalance]);

  /** Footer fixed closing balance: remote side ka latest visible running balance. */
  const rightClosingBalance = React.useMemo(() => {
    const last = remoteRows[remoteRows.length - 1];
    return typeof last?.balance === "number" ? last.balance : remoteOpeningBalance;
  }, [remoteRows, remoteOpeningBalance]);

  const pairFooterCounts = React.useMemo(
    () => ({
      before: pagination.sliceStart,
      after: pairs.length - pagination.sliceEnd,
      total: pairs.length,
    }),
    [pairs.length, pagination.sliceStart, pagination.sliceEnd]
  );

  /** Paginated pair index — same date+amount dono side green highlight */
  const matchedPairIndices = React.useMemo(
    () =>
      new Set(
        paginatedPairs.map((p, i) => (p.matched ? i : -1)).filter((i) => i >= 0)
      ),
    [paginatedPairs]
  );

  const handleSortChange = React.useCallback((nextSortBy: TransactionSortBy, nextSortOrder: TransactionSortOrder) => {
    setSortBy(nextSortBy);
    setSortOrder(nextSortOrder);
    setCurrentPage(1);
  }, []);

  const sharedRange = React.useMemo(() => (share ? shareDocDateRange(share) : undefined), [share]);
  const sharedRangeLabel = React.useMemo(
    () =>
      share?.shareScope === "date_range"
        ? formatDateRangeLabel(sharedRange, dateSystem, formatDate, formatDateBS, "Shared range")
        : "All transactions (shared)",
    [share?.shareScope, sharedRange, dateSystem, formatDate, formatDateBS]
  );
  const myRangeLabel = React.useMemo(
    () => formatDateRangeLabel(myDateRange, dateSystem, formatDate, formatDateBS),
    [myDateRange, dateSystem, formatDate, formatDateBS]
  );

  /** Live company names — share doc snapshot stale ho to bhi rename turant dikhe. */
  const [liveReconCompanyNames, setLiveReconCompanyNames] = React.useState<Record<string, string>>({});

  const mySideMeta = React.useMemo((): ReconLedgerSideMeta => {
    if (!share || !user?.uid) {
      return { companyName: "—", entityName: "—", accountName: "—" };
    }
    const viewerSide = reconciliationViewerSide(share, user.uid, companyId ?? undefined);
    const ownedSide: "sender" | "receiver" =
      viewerSide === "sender"
        ? "sender"
        : viewerSide === "receiver"
          ? "receiver"
          : share.senderUserId === user.uid
            ? "sender"
            : "receiver";
    const meta = buildReconSideMeta(share, ownedSide);
    return withLiveReconCompanyName(meta, reconSideCompanyId(share, ownedSide), liveReconCompanyNames);
  }, [share, user?.uid, companyId, liveReconCompanyNames]);

  const remoteSideMeta = React.useMemo((): ReconLedgerSideMeta => {
    if (!share || !user?.uid) {
      return { companyName: "—", entityName: "—", accountName: "—" };
    }
    const viewerSide = reconciliationViewerSide(share, user.uid, companyId ?? undefined);
    const remoteSide: "sender" | "receiver" =
      viewerSide === "sender"
        ? "receiver"
        : viewerSide === "receiver"
          ? "sender"
          : share.senderUserId === user.uid
            ? "receiver"
            : "sender";
    const meta = buildReconSideMeta(share, remoteSide);
    return withLiveReconCompanyName(meta, reconSideCompanyId(share, remoteSide), liveReconCompanyNames);
  }, [share, user?.uid, companyId, liveReconCompanyNames]);

  const handleRefreshMySide = async () => {
    if (!share || !user?.uid || refreshing) return;
    setRefreshing(true);
    try {
      await refreshMySideSilent();
    } finally {
      setRefreshing(false);
    }
  };

  const remoteCommentSide = React.useMemo(
    () => (share && user?.uid ? remoteReconciliationCommentSide(share, user.uid, companyId ?? undefined) : "receiver"),
    [share, user?.uid, companyId]
  );

  const remoteRowComments = React.useMemo(
    () => share?.rowComments?.[remoteCommentSide] ?? {},
    [share?.rowComments, remoteCommentSide]
  );

  /** You-side: dusre party ne meri (left) row id par jo comment save kiya — sender/receiver map alag hota hai. */
  const otherPartyCommentsOnMyRowsSideKey = React.useMemo(
    () => (share && user?.uid ? otherPartyCommentsOnMyRowsSide(share, user.uid, companyId ?? undefined) : "sender"),
    [share, user?.uid, companyId]
  );

  const otherPartyCommentsOnMyRows = React.useMemo(
    () => share?.rowComments?.[otherPartyCommentsOnMyRowsSideKey] ?? {},
    [share?.rowComments, otherPartyCommentsOnMyRowsSideKey]
  );

  const [commentDialogReadOnly, setCommentDialogReadOnly] = React.useState(false);

  /** Share ki apni side company — sidebar company alag ho to bhi sahi voucher fetch ho */
  const myReconCompanyId = React.useMemo(() => {
    if (!share || !user?.uid) return companyId ?? null;
    return getMyReconciliationSideContext(share, user.uid, companyId ?? "")?.companyId ?? companyId ?? null;
  }, [share, user?.uid, companyId]);

  /** Other party company — remote ledger live refresh listener ke liye */
  const remoteReconCompanyId = React.useMemo(() => {
    if (!share || !user?.uid) return null;
    return getRemoteReconciliationSideContext(share, user.uid, companyId ?? "")?.companyId ?? null;
  }, [share, user?.uid, companyId]);

  /** Company rename — `companies/{id}.name` live overlay (share doc me purana naam reh sakta hai). */
  React.useEffect(() => {
    const ids = [myReconCompanyId, remoteReconCompanyId].filter(Boolean) as string[];
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length || !enabled || !canView || isLocalOnlyMode()) return;

    const unsubs = uniqueIds.map((cid) =>
      onSnapshot(
        doc(firestore, `companies/${cid}`),
        (snap) => {
          const name = String(snap.data()?.name || "").trim();
          if (!name) return;
          setLiveReconCompanyNames((prev) => (prev[cid] === name ? prev : { ...prev, [cid]: name }));
        },
        () => {
          /* Permission fail — registry fallback effect niche handle karega. */
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [myReconCompanyId, remoteReconCompanyId, enabled, canView]);

  /** Local/APK: Firestore company listener skip — registry + selected company se naam sync. */
  React.useEffect(() => {
    const ids = [myReconCompanyId, remoteReconCompanyId].filter(Boolean) as string[];
    if (!ids.length) return;
    setLiveReconCompanyNames((prev) => {
      let next: Record<string, string> | null = null;
      for (const cid of ids) {
        let name = "";
        if (cid === companyId && company?.name) {
          name = String(company.name).trim();
        } else {
          const found = allCompaniesRegistry.find((c) => c.id === cid);
          if (found?.name) name = String(found.name).trim();
        }
        if (!name) continue;
        const bucket = next ?? prev;
        if (bucket[cid] === name) continue;
        if (!next) next = { ...prev };
        next[cid] = name;
      }
      return next ?? prev;
    });
  }, [myReconCompanyId, remoteReconCompanyId, companyId, company?.name, allCompaniesRegistry]);

  /** Owned company vouchers change → debounced background refresh (live row add/remove) */
  React.useEffect(() => {
    const cid = myReconCompanyId;
    if (!cid || !enabled || !canView || isLocalOnlyMode()) return;

    let skipInitial = true;
    const schedule = () => {
      if (skipInitial) {
        skipInitial = false;
        return;
      }
      scheduleLiveSilentReload(() => {
        void refreshMySideSilent();
      });
    };

    const unsub = onSnapshot(collection(firestore, `companies/${cid}/vouchers`), schedule);
    return () => {
      unsub();
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
    };
  }, [myReconCompanyId, enabled, canView, refreshMySideSilent, scheduleLiveSilentReload]);

  /** Other party vouchers change → poori table silent reload (super admin sender company se dekhe) */
  React.useEffect(() => {
    const cid = remoteReconCompanyId;
    if (!cid || cid === myReconCompanyId || !enabled || !canView || isLocalOnlyMode()) return;

    let skipInitial = true;
    const schedule = () => {
      if (skipInitial) {
        skipInitial = false;
        return;
      }
      scheduleLiveSilentReload(() => {
        void load({ silent: true });
      });
    };

    const unsub = onSnapshot(collection(firestore, `companies/${cid}/vouchers`), schedule);
    return () => {
      unsub();
    };
  }, [remoteReconCompanyId, myReconCompanyId, enabled, canView, load, scheduleLiveSilentReload]);

  /** Reconciliation share doc/index live listener — comment/link/snapshot updates turant lane ke liye. */
  React.useEffect(() => {
    if (!shareId || !enabled || !canView || isLocalOnlyMode()) return;
    let skipInitial = true;
    const schedule = () => {
      if (skipInitial) {
        skipInitial = false;
        return;
      }
      scheduleLiveSilentReload(() => {
        void load({ silent: true });
      });
    };
    const unsubs: Array<() => void> = [];
    unsubs.push(
      onSnapshot(
        doc(firestore, "reconciliation_shares", shareId),
        schedule,
        () => {
          /* Top-level permission fail ho sakta hai; company index listener niche fallback hai. */
        }
      )
    );
    if (companyId) {
      unsubs.push(
        onSnapshot(
          doc(firestore, `companies/${companyId}/reconciliation_shares`, shareId),
          schedule,
          () => {
            /* Ignore: fallback listener best-effort. */
          }
        )
      );
    }
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [shareId, companyId, enabled, canView, load, scheduleLiveSilentReload]);

  /** You-side row double-click — voucher edit dialog (share wali company se load). */
  const handleEditMyVoucher = React.useCallback(
    async (row: ReconciliationLedgerRow) => {
      const editCompanyId = myReconCompanyId;
      if (!editCompanyId || !row?.id || voucherLoading) return;
      setVoucherLoading(true);
      try {
        const voucher = await fetchVoucherForReconciliationEdit(editCompanyId, row.id);
        if (!voucher) {
          toast.error("Voucher not found.");
          return;
        }
        setSyncVoucherDraft(null);
        setSelectedVoucher(voucher);
        setVoucherDialogSeedKey((k) => k + 1);
        setIsVoucherDialogOpen(true);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Could not open voucher.");
      } finally {
        setVoucherLoading(false);
      }
    },
    [myReconCompanyId, voucherLoading]
  );

  const handleCommentInfoClick = React.useCallback((row: ReconciliationLedgerRow) => {
    setCommentRow(row);
    setCommentDialogReadOnly(false);
    setCommentDialogOpen(true);
  }, []);

  /** You-side — remote ne jo comment likha paired row par woh dekho. */
  const handleViewPairedComment = React.useCallback((row: ReconciliationLedgerRow) => {
    setCommentRow(row);
    setCommentDialogReadOnly(true);
    setCommentDialogOpen(true);
  }, []);

  const handleSaveRemoteComment = React.useCallback(
    async (comment: string) => {
      if (!share || !commentRow?.id || !user?.uid) return;
      setCommentSaving(true);
      try {
        await saveReconciliationRowComment({
          shareId: share.id,
          side: remoteCommentSide,
          rowId: commentRow.id,
          comment,
        });
        setShare((prev) => {
          if (!prev) return prev;
          const sideMap = { ...(prev.rowComments?.[remoteCommentSide] ?? {}) };
          const trimmed = comment.trim();
          if (trimmed) sideMap[commentRow.id] = trimmed;
          else delete sideMap[commentRow.id];
          return {
            ...prev,
            rowComments: {
              ...prev.rowComments,
              [remoteCommentSide]: sideMap,
            },
          };
        });
        toast.success("Comment saved.");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Could not save comment.");
        throw e;
      } finally {
        setCommentSaving(false);
      }
    },
    [share, commentRow?.id, user?.uid, remoteCommentSide]
  );

  /** Blank left row — remote txn ka opposite voucher pre-fill + dialog */
  const handleSyncTransaction = React.useCallback(
    async (pairIndex: number) => {
      const syncCompanyId = myReconCompanyId ?? companyId;
      if (!share || !user?.uid || !syncCompanyId) return;
      const pair = paginatedPairs[pairIndex];
      if (!pair?.right || pair.left) {
        toast.error("No remote transaction to sync for this row.");
        return;
      }
      setVoucherLoading(true);
      try {
        const built = await buildSyncVoucherDraftFromRemoteRowAsync({
          remoteRow: pair.right,
          share,
          userId: user.uid,
          companyId: syncCompanyId,
        });
        if (!built) {
          toast.error("Could not build sync voucher.");
          return;
        }
        setSelectedVoucher(null);
        setSyncVoucherDraft(built.defaultVoucherData);
        setSyncDefaultTab(built.defaultTab);
        setVoucherDialogSeedKey((k) => k + 1);
        setIsVoucherDialogOpen(true);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Could not open sync voucher.");
      } finally {
        setVoucherLoading(false);
      }
    },
    [share, user?.uid, companyId, myReconCompanyId, paginatedPairs]
  );

  /** Click pe pair select — blank (—) row bhi */
  const handleReconRowSelect = React.useCallback((side: "left" | "right", pairIndex: number) => {
    setSelectedRowKey(`${side}:${pairIndex}`);
  }, []);

  /** Page/sort/range change par selection clear */
  React.useEffect(() => {
    setSelectedRowKey(null);
  }, [currentPage, rowsPerPage, sortBy, sortOrder, myDateRange]);

  if (!enabled || !canView) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{RECON_PAGE_TITLE} is not enabled or you don&apos;t have permission.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!share || share.status !== "linked") {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
        <p className="text-muted-foreground">Share not found or not linked yet.</p>
      </div>
    );
  }

  const leftColumn = paginatedPairs.map((p) => p.left);
  const rightColumn = paginatedPairs.map((p) => p.right);
  const matchedCount = pairs.filter((p) => p.matched).length;

  const pairRowSyncKey = paginatedPairs
    .map(
      (p) =>
        `${p.left?.id ?? ""}|${p.right?.id ?? ""}|${String(p.left?.narration ?? "").length}|${String(p.right?.narration ?? "").length}`
    )
    .join(";");

  return (
    <div
      className={cn(
        RECON_PAGE_SURFACE_CLASS,
        "flex h-[calc(100vh-4rem)] min-h-0 flex-col gap-2 overflow-hidden p-3 md:p-4",
      )}
    >
      <ReconciliationPageRibbon
        onBack={() => router.back()}
        matchedCount={matchedCount}
        totalRows={pairs.length}
        refreshing={refreshing}
        onRefresh={handleRefreshMySide}
        dateSystem={dateSystem}
        myDateRange={myDateRange}
        tempMyDateRange={tempMyDateRange}
        isAdCalendarOpen={isAdCalendarOpen}
        setMyDateRange={setMyDateRange}
        setTempMyDateRange={setTempMyDateRange}
        setIsAdCalendarOpen={setIsAdCalendarOpen}
        myRangeLabel={myRangeLabel}
        sharedRangeLabel={sharedRangeLabel}
        calendarMonths={calendarMonths}
        companyCountry={company?.country}
      />

      <ReconciliationLedgerPairGrid
        leftMeta={mySideMeta}
        rightMeta={remoteSideMeta}
        pairCount={leftColumn.length}
        syncKey={pairRowSyncKey}
        selectedRowKey={selectedRowKey}
        onRowSelectPair={handleReconRowSelect}
        onSyncTransaction={canSyncTrxn ? handleSyncTransaction : undefined}
        left={{
          rows: leftColumn,
          side: "left",
          matchedPairIndices,
          openingBalance: myOpeningBalance,
          // Left table ke bottom me closing balance row.
          closingBalance: leftClosingBalance,
          formatDate,
          formatDateBS,
          dateSystem,
          decimalPlaces: company?.decimalPlaces ?? 2,
          onRowDoubleClick: handleEditMyVoucher,
          rowComments: otherPartyCommentsOnMyRows,
          onCommentInfoClick: handleViewPairedComment,
          commentReadOnly: true,
          pairedRows: rightColumn,
        }}
        right={{
          rows: rightColumn,
          side: "right",
          matchedPairIndices,
          openingBalance: remoteOpeningBalance,
          // Right table ke bottom me closing balance row.
          closingBalance: rightClosingBalance,
          formatDate,
          formatDateBS,
          dateSystem,
          decimalPlaces: company?.decimalPlaces ?? 2,
          rowComments: remoteRowComments,
          onCommentInfoClick: handleCommentInfoClick,
          pairedRows: leftColumn,
        }}
      />

      <ReconciliationLedgerFooter
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
        currentPage={currentPage}
        totalPages={totalPages}
        setCurrentPage={setCurrentPage}
        rowsPerPageSelectValue={rowsPerPageSelectValue}
        onRowsPerPageChange={handleRowsPerPageChange}
        pairBeforeCount={pairFooterCounts.before}
        pairAfterCount={pairFooterCounts.after}
        pairTotalCount={pairFooterCounts.total}
        leftTotalCount={leftTotalCount}
        rightTotalCount={rightTotalCount}
        leftOwnedCompanyName={mySideMeta.companyName}
        leftOwnedAccountName={mySideMeta.accountName}
        rightOtherCompanyName={remoteSideMeta.companyName}
        rightOtherAccountName={remoteSideMeta.accountName}
        className="border-emerald-200/60 bg-transparent"
      />

      <AddVoucherDialog
        key={`recon-voucher-${voucherDialogSeedKey}`}
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open) => {
          setIsVoucherDialogOpen(open);
          if (!open) {
            setSelectedVoucher(null);
            setSyncVoucherDraft(null);
          }
        }}
        voucher={selectedVoucher ?? undefined}
        editCompanyId={myReconCompanyId ?? companyId ?? undefined}
        defaultTab={syncVoucherDraft ? syncDefaultTab : undefined}
        defaultVoucherData={syncVoucherDraft ?? undefined}
        onVoucherAction={(status) => {
          setSelectedVoucher(null);
          setSyncVoucherDraft(null);
          // Save / delete (bin) ke baad turant background live sync
          if (status === "saved" || status === "cancelled") {
            void refreshMySideSilent();
          }
        }}
      />

      <ReconciliationRowCommentDialog
        open={commentDialogOpen}
        onOpenChange={(open) => {
          setCommentDialogOpen(open);
          if (!open) setCommentRow(null);
        }}
        voucherLabel={commentRow ? `${commentRow.voucherNumber} — ${reconciliationLedgerRowDisplayNarration(commentRow) || ""}` : ""}
        initialComment={
          commentRow
            ? commentDialogReadOnly
              ? otherPartyCommentsOnMyRows[commentRow.id] ?? ""
              : remoteRowComments[commentRow.id] ?? ""
            : ""
        }
        readOnly={commentDialogReadOnly}
        saving={commentSaving}
        onSave={handleSaveRemoteComment}
      />
    </div>
  );
}
