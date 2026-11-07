"use client";

import {
  sharedUserCanApproveInterCompanyVoucher,
  sharedUserCanEditInterCompanyVoucher,
} from "@/lib/interCompany/interCompanyVoucherAccess";
import * as React from "react";
import { columnFieldValuesHaystack, drCrChipKey, drCrColumnFilterResult, drCrOppositeKey, tdsBadgeHighlightQuery } from "@/lib/transactionColumnHeaderFilter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { useDate } from "@/hooks/useDate";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { cn } from "@/lib/utils";
import { isTransactionColumnVisible } from "@/lib/transactionVisibleColumnShow";
import {
  LEDGER_TDS_ROW_FLAG,
  SALE_PURCHASE_TDS_VERIFIED_MESSAGE,
  isSalePurchaseTdsVerifyLedgerContext,
  partyTdsLedgerBooksDrCrFromRow,
  isLedgerTdsTableRow,
  resolveSalePurchaseTdsVerifyLabel,
  taxLedgerBooksDrCrFromRow,
  taxAccountIsTdsVerifyLegOnVoucher,
} from "@/lib/partyLedgerTdsView";
import type { StockView, Item } from "@/components/items/types";
import { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Filter, MoreVertical, CheckSquare, MousePointerClick, Printer, Pencil, History, X, CheckCircle, CheckCheck, CircleOff, Trash2 } from "lucide-react";
import { txnTableIconBtnCn } from "@/lib/listSelectionChrome";
import { scrollTransactionSelectedRowIntoView } from "@/lib/ledgerScrollToSelection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { Virtuoso } from "react-virtuoso";
import { VoucherTypeFilter } from "@/components/vouchers/VoucherTypeFilter";
import {
  type Context,
  type Transaction,
  TransactionRow,
  MobileTransactionFilePreview,
  OpeningBalanceFileCellContent,
  getConversionFactor,
  formatQuantity,
  getOppositeAccountLabel,
  getParticularsText,
  getStatusLabel,
  getStatusLabels,
  transactionIsOverdueStatus,
  getStatusBadgeOutlineClassName,
  getStatusDetail,
  getStatusDetailVouchers,
  LinkedVouchersColored,
  LinkedVouchersColoredCollapsible,
  BillWiseLinkedDetailCells,
  voucherTypePillClassName,
  type FileColumnDisplayMode,
  readSavedFileColumnViewPrefs,
  saveFileColumnViewPrefs,
  type TxnDrCrSide,
} from "./transactionTableShared";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { AdaptiveClosingScope } from "@/components/vouchers/AdaptiveClosingScope";
import { Card } from "@/components/ui/card";
import { differenceInDays, format, startOfDay } from "date-fns";
import {
  formatVoucherEntryTimeLocal,
  parseFirestoreDateFieldToJsDate,
  parseOpeningBalanceDateToLocalNoon,
} from "@/lib/voucherDateNormalize";
import { flushVoucherOutbox, listPendingOutboxDocIdsForCompany } from "@/lib/localVoucherOutbox";
import { mirrorVoucherDocToBrowserDb } from "@/lib/localCompanyDocMirror";
import {
  FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT,
  isFirebaseLedgerDataSyncDisabled,
} from "@/lib/firebaseLedgerDataSyncDisabled";
import { SPEND_WISE_OPENING_GROUP_ID } from "@/lib/spendWiseDateRangeGroups";
import { resolveSpendWiseRowBaseVoucherId } from "@/lib/spendWisePagination";
import { useCompany } from "@/hooks/useCompany";
import type { SpendWiseBlinkMode } from "@/components/vouchers/transactionColumnVisibility";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import usePermissions from "@/hooks/usePermissions";
import {
  approveVoucherWithHistory,
  approveVouchersWithHistoryBatch,
  unapproveVoucherWithHistory,
} from "@/lib/writeGateway/voucherActionsClient";
import {
  type MobileTransactionCardColor,
  MOBILE_TRANSACTION_CARD_COLOR_CHANGED_EVENT,
  readMobileTransactionCardColor,
  writeMobileTransactionCardColor,
} from "@/lib/mobileTransactionCardColor";
import {
  MobileTransactionCardColorPicker,
  type MobileTransactionCardPreview,
} from "./MobileTransactionCardColorPicker";
import { isLedgerTransactionUnapproved } from "@/lib/ledgerPendingApproval";
import {
  buildFiscalMergePartitionEntriesFromCompany,
  insertFiscalPartitionRowsMulti,
  FISCAL_YEAR_PARTITION_ROW_TYPE,
} from "@/lib/fiscalPartitionRows";
import { buildPartitionClosingSummaryMap } from "@/lib/fiscalPartitionClosingSummary";
import {
  FiscalPartitionClosingSummaryBlock,
  FiscalPartitionStartLabelBlock,
} from "@/components/vouchers/FiscalPartitionClosingSummaryBlock";
import {
  computeFyOpeningBalanceByBoundary,
  insertFyOpeningRowsAfterPartitions,
  FY_OPENING_ROW_TYPE,
} from "@/lib/fyPagination/fyOpeningRows";
import {
  loadFyPartitionOpeningsForEntity,
  loadFyPartitionOpeningsFromLocalCache,
  loadFyPartitionOpeningsFromSqliteMirror,
} from "@/lib/fyPagination/fyPartitionOpeningHydrate";
import { hasFullLocalLedgerVoucherMirror } from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import {
  extractEntityBalanceFromFySnapshot,
  isLedgerDateFilterFromAtFyStart,
  ledgerOpeningPillLabel,
  resolveTopLedgerOpeningPillKind,
} from "@/lib/fyPagination/ledgerOpeningMeta";
import {
  buildFiscalMergePartitionBannerSplitForDateSystem,
  buildFyOpeningPillSplit,
  buildFyPartitionOpeningPillLabel,
  parseFiscalPartitionBoundaryMs,
} from "@/lib/fiscalYearLabel";
import { useFyOpeningPillFormat } from "@/hooks/useFyOpeningPillFormat";
import { FyOpeningPillFormatPill } from "@/components/vouchers/FyOpeningPillFormatPill";
import { useFyVoucherScope } from "@/contexts/FyVoucherScopeContext";
import {
  LEDGER_OB_BOOK_KEY,
  LEDGER_OB_DATED_KEY,
  ledgerFyOpeningAmountKey,
  readHiddenLedgerOpeningAmountKeys,
  writeHiddenLedgerOpeningAmountKeys,
} from "@/lib/ledgerOpeningAmountVisibility";
import { LEDGER_OPENING_HIDE_AMOUNT_ENABLED } from "@/lib/ledgerOpeningHideAmountFreeze";
import {
  applyBillWiseLinkPreviewGrouping,
  ledgerRowStableId,
  type BillWiseLinkPreviewSelection,
} from "@/lib/billWiseLinkPreviewGroup";
import {
  applyHiddenLedgerOpeningAmountAdjustments,
  patchFyOpeningRowsBillWiseBalances,
  signedBillWiseOutstandingForRow,
  signedFyOpeningRowAmount,
  signedToOpeningDrCr,
} from "@/lib/billWiseOpeningBalanceSum";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { resolveLedgerTransactionUserDisplayName, buildActiveRecurringTriggerVoucherIdSet } from "@/lib/ledgerUserColumnDisplay";
import {
  computeLedgerUnifiedTableMinPx,
  stabilizeLedgerUnifiedPx,
  measureLedgerNaturalColWidths,
  mergeLedgerMeasuredColWidths,
  LEDGER_UNIFIED_WIDTH_STABLE_EPS_PX,
} from "@/lib/ledgerUnifiedContentWidth";
import { isRecurringVoucherGenerationEnabled } from "@/lib/recurringVoucherSettings";
import { useRecurringAccrualTemplates } from "@/hooks/useDashboardRecurringAccrual";
import {
  prewarmHoverPreviewHttpsUrls,
  prewarmVisibleAttachmentRefsForInstantOpen,
} from "@/components/vouchers/attachmentHoverPreviewBody";
import { updateAttachmentPrefetchPriorityFromVisibleRows } from "@/lib/attachmentPrefetchPriorityBuffer";
import {
  isOnlineCompanyAttachmentFilesTickEnabled,
  setVisiblePageAttachmentUrls,
} from "@/lib/attachmentNetworkGate";
import { shouldAutoWarmAttachmentForLedgerRow } from "@/lib/fyPagination/attachmentFyAutoLoadPolicy";
import { companyUsesOnlineSelectorSyncTicks } from "@/lib/onlineCompanySelectorSyncPolicy";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { shouldSkipVisibleRowFullIdlePrewarmOnWeb } from "@/lib/webAttachmentLazyLoadPolicy";
import { getVoucherAttachmentUrlsForUi, voucherAttachmentUiOptionsForCompany } from "@/lib/voucherAttachmentNormalize";
import { publishVoucherAttachmentListReuseIndex } from "@/lib/voucherAttachmentListReuseIndex";
import { statementCheckTxnId } from "@/lib/statementCheckModeStorage";
import { useLedgerStatementChecked } from "@/hooks/useLedgerStatementChecked";
import { statementCheckedMessageColumn } from "@/lib/statementCheckRowMessage";
import { StatementCheckedRowMessageLabel } from "@/components/vouchers/StatementCheckedRowMessageLabel";
import { isInterCompanyVoucherEditDeleteBlocked } from "@/lib/interCompany/interCompanyVoucherHydrate";
import {
  type LedgerTxnTableTone,
  readLedgerTxnTableTone,
  writeLedgerTxnTableTone,
  LEDGER_TXN_TABLE_TONE_CHANGED_EVENT,
} from "@/lib/ledgerTxnTableTone";
import { LedgerTxnTableTonePills } from "@/components/vouchers/LedgerTxnTableTonePills";
import {
  LEDGER_CLOSING_BALANCE_ACTIONS_CN,
  LEDGER_CLOSING_BALANCE_CARD_ROW_CN,
  LEDGER_CLOSING_BALANCE_TOTAL_CN,
  LEDGER_ENTITY_BALANCE_COL_PX,
  LEDGER_ENTITY_TYPE_COL_PX,
  LEDGER_ENTITY_FILE_COL_PX,
  LEDGER_TDS_FILE_COL_PX,
  LEDGER_TDS_FILE_CELL_PAD_CN,
  LEDGER_ENTITY_USER_COL_PX,
  LEDGER_TDS_AMOUNT_CELL_PAD_CN,
  LEDGER_TDS_AMOUNT_COL_PX,
  LEDGER_TDS_TAXABLE_CELL_PAD_CN,
  LEDGER_TDS_TAXABLE_COL_PX,
  LEDGER_TDS_VOUCHER_NO_COL_PX,
  LEDGER_TDS_USER_CELL_PAD_CN,
  LEDGER_TDS_ROW_TEXT_CELL_PAD_CN,
  LEDGER_TDS_DR_CR_CELL_PAD_CN,
  LEDGER_TDS_DR_CR_COL_PX,
  LEDGER_TDS_DR_CR_AMOUNT_CELL_CN,
  LEDGER_BOTH_DATE_BS_AD_GAP_PX,
  LEDGER_BOTH_DATE_BS_CELL_PAD_CN,
  LEDGER_ENTITY_DATE_BS_COL_PX,
  DAYBOOK_ACCOUNTS_COL_PX,
  LEDGER_VOUCHER_NO_HEADER_COL_PX,
  LEDGER_TDS_DATE_TO_TYPE_GAP_PX,
  LEDGER_ENTRY_TIME_TO_TYPE_MIN_GAP_PX,
  LEDGER_TDS_DATE_COL_PX,
  LEDGER_TDS_LAST_DATE_CELL_PAD_CN,
  LEDGER_TXN_BALANCE_HEADER_PAD_CN,
  LEDGER_TXN_BALANCE_TO_MENU_PAD_CN,
  LEDGER_TXN_ROW_MENU_COL_PX,
  LEDGER_TXN_ROW_MENU_CELL_CN,
  measureLedgerTxnVerticalScrollPads,
  LEDGER_TXN_BODY_CELL_PAD_CN,
  LEDGER_TXN_COL_MAX_GAP_PAD_CN,
  LEDGER_TXN_DR_CR_AMOUNT_CELL_CN,
  LEDGER_TXN_DR_CR_COL_PX,
} from "@/lib/ledgerHeaderChrome";
import { stripSpendWiseSyntheticOpeningMaster } from "@/lib/ledgerPagePrint";
import {
  BOOK_OB_EPS as SHARED_BOOK_OB_EPS,
  isMasterOpeningDateInLedgerQueryRange as isMasterOpeningDateInLedgerQueryRangeShared,
  shouldStackBookOpeningAboveDatedRow,
} from "@/lib/ledgerOpeningBalanceDisplay";
import {
  extractSpendWiseGroupTransactions,
  printSpendWiseGroupTransactions,
  type SpendWiseGroupPrintConfig,
} from "@/lib/spendWiseGroupPrint";

export type { Context, Transaction };

export type TransactionColumnKey =
  | "syncStatus"
  | "date"
  | "type"
  | "voucherNo"
  | "tdsTaxable"
  | "tdsAmount"
  | "user"
  | "file"
  | "dr"
  | "cr"
  | "status"
  | "runningBalance";
export type VisibleColumns = Partial<Record<TransactionColumnKey, boolean>>;

export { TransactionRow, getConversionFactor, formatQuantity };

const SPEND_WISE_TYPE_COL_PX = 112;
/** Split thead/body: default voucher col — body cells use min-w-[105px]. */
const LEDGER_VOUCHER_NO_COL_PX = 105;
/** IC row with “Change Detected” badge — wide only when such rows are on screen. */
const LEDGER_VOUCHER_NO_IC_COL_PX = 172;
function rowHasInterCompanyPeerPending(t: unknown): boolean {
  const proposed = (t as { interCompanyPeerPending?: { proposed?: unknown } })?.interCompanyPeerPending
    ?.proposed;
  return !!(
    proposed &&
    typeof proposed === "object" &&
    Object.keys(proposed as object).length > 0
  );
}

/** Spend-wise table-fixed: type pill ("direct expense") — 75px par voucher no overlap hota tha. */
function normalizeLedgerObDateField(v: unknown): Date | null {
  return parseOpeningBalanceDateToLocalNoon(v);
}

/** Form "As on" date ledger query range (from/to days, inclusive) ke andar? — shared helper. */
function isMasterOpeningDateInLedgerQueryRange(
  range: { from?: Date | null; to?: Date | null } | null | undefined,
  masterObDay: Date | null
): boolean {
  return isMasterOpeningDateInLedgerQueryRangeShared(range, masterObDay);
}

/** Spend-wise row grouping — mobile cards + desktop table must share shape; hooks using this stay above any conditional return. */
type MobileBlock =
  | { type: "spacer" }
  | { type: "group"; colorIndex: number; items: any[] }
  | { type: "single"; item: any };
type TableBlock =
  | { type: "spacer"; id: string }
  | { type: "group"; colorIndex: number; items: any[]; clippedTop?: boolean; clippedBottom?: boolean }
  | { type: "single"; item: any };

interface TransactionsTableProps {
  transactions: Transaction[];
  context: Context;
  contextId?: string;
  openingBalance?: number;
  /** Online dated/FY opening could not be loaded from server snapshot. */
  periodOpeningUnavailable?: boolean;
  periodOpeningLoading?: boolean;
  /** Party/staff: master books opening (signed). Opening row Dr/Cr when period-brought balance is 0 but bill-wise row still shows OB links. */
  booksOpeningBalance?: number;
  openingBalanceOutstanding?: number;
  openingBalanceLinkedVoucherNos?: string[];
  /** Party (etc.): opening row ke turant baad voucher-style narration line */
  openingBalanceNarration?: string;
  /** Opening row File column: party/bank `documentFileUrls` (voucher jaisa tick + hover) */
  openingBalanceAttachmentUrls?: string[];
  /** Entity "As on" date — opening row ke Date column(s) me dikhai (party/bank/staff/tax/item/expense) */
  openingBalanceDate?: unknown;
  showNarration?: boolean;
  /** Daybook: narration column me note-text filter (parent state) */
  narrationNoteSearch?: string;
  stockView?: StockView;
  item?: Item;
  displayUnit?: string;
  setDisplayUnit?: (unit: string) => void;
  journalAccountNames?: Record<string, string>;
  userNames?: Record<string, string>;
  /** Account id -> name for resolving opposite account in bank/account context */
  accountNames?: Record<string, string>;
  filters?: Record<string, string>;
  setFilters?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  activeFilter?: string | null;
  setActiveFilter?: React.Dispatch<React.SetStateAction<string | null>>;
  onRowClick?: (transaction: any) => void;
  /** Inter-company peer pending: blue badge opens compare dialog (not plain row edit). */
  onInterCompanyChangeDetectedClick?: (transaction: any) => void;
  periodDr?: number;
  periodCr?: number;
  closingBalance?: number;
  isTaxContext?: boolean;
  isAllVouchersView?: boolean;
  hideDebitColumn?: boolean;
  hideCreditColumn?: boolean;
  /** Optional header labels (e.g. staff tax-details: Tax / Salary). */
  debitColumnHeaderLabel?: string;
  creditColumnHeaderLabel?: string;
  hideBalanceColumn?: boolean;
  hideFooter?: boolean;
  /** Ledger date filter range — Books opening sirf tab jab `openingBalanceDate` is inclusive range me ho. */
  dateRange?: { from?: Date | null; to?: Date | null };
  isInitialLoad?: boolean;
  isDateChange?: boolean;
  getDisplayValue?: (value: number) => string;
  voucherTypes?: string[];
  onVoucherTypeChange?: (types: string[]) => void;
  isBalanceMasked?: boolean;
  visibleColumns?: Record<string, boolean>;
  openingBalanceActions?: React.ReactNode;
  /** Label for the opening balance row (e.g. "Opening" on report page) */
  openingBalanceLabel?: string;
  /** Optional search input to show on the left of the opening balance row (same row) */
  openingBalanceSearch?: React.ReactNode;
  /** Optional content to show to the left of the opening balance row (e.g. unit selector) */
  openingBalanceLeftContent?: React.ReactNode;
  /** Closing Balance row — Adjust Balance (same row as label + amount on mobile). */
  closingBalanceRowActions?: React.ReactNode;
  /** Second row (mobile) / before label (desktop) — Freeze, Send Statement, etc. */
  closingBalanceActions?: React.ReactNode;
  /** Footer closing label (default "Closing Balance"; party TDS details uses "TDS Closing Balance"). */
  closingBalanceLabel?: string;
  /** Opt-in (Account/Group detail pages): no closing label text; the yellow Adjust Balance pill adapts ("Adjust Closing Balance" -> "Ajt Cls Blc"); amount never splits. */
  adaptiveClosingLabel?: boolean;
  onDeleteVoucher?: (transaction: any) => void;
  /** Row menu: recycle bin (corrupt / master-missing vouchers — sirf id se). */
  onMoveVoucherToRecycleBin?: (transaction: any) => void;
  onHistoryVoucher?: (transaction: any) => void;
  onAddLink?: (transaction: any) => void;
  onApproveVoucher?: (transaction: any) => void;
  onUnapproveVoucher?: (transaction: any) => void;
  scrollOnlyTransactions?: boolean;
  /** Status filter for bill-wise Status header dropdown */
  statusFilter?: { paid: boolean; unpaid: boolean; partial: boolean; overdue: boolean };
  statusFilterAllChecked?: boolean;
  onStatusFilterAll?: () => void;
  onStatusFilterChange?: (key: "paid" | "unpaid" | "partial" | "overdue", checked: boolean) => void;
  statusFilterIdPrefix?: string;
  /** When context=group, indicates group type for opposite account display */
  groupEntityType?: "party" | "account" | "staff" | "tax" | "expense" | "item";
  /** When true, disables layout animation (e.g. when switching Spend wise / Statement view) */
  disableLayoutAnimation?: boolean;
  /** Spend-wise balance blink multi-select modes ('all' | 'group' | 'row'). Empty = Off. */
  blinkMode?: SpendWiseBlinkMode[];
  /** Optional override for pages that always want a fixed balance layout regardless of the shared page preference. */
  forceBalanceMode?: "statement" | "bill_wise";
  /** Item context: allow Party column show/hide from columns dropdown. */
  showItemPartyColumn?: boolean;
  /** When true (default), `isApproved` !== true rows get pink tint (main + narration). Party details use default. */
  highlightPendingApproval?: boolean;
  /** Entity ledger: pills on when set; dated vs book wording `dateRange` + master OB date se decide. */
  ledgerDateFilterActive?: boolean;
  /** Recent tab footer search: mobile card lines me is query ka pink highlight (sirf in cards). */
  transactionCardSearchHighlight?: string;
  /** Dashboard Recent: mobile cards = party/ledger list layout (gap/inset/3D). Desktop daybook columns unchanged. */
  mobileCardLayoutLikeParty?: boolean;
  /** Daybook desktop inside `DaybookTxnScrollColumn` — party-style col mins + one outer H-scroll. */
  daybookDesktopUnifiedScroll?: boolean;
  /** Page-1: upar stacked Book row (jab master OB nonzero + OB date range me); page>1 sirf dated carry. */
  ledgerShowBookOpeningRow?: boolean;
  /** Staff tax-details view: hide Book/Dated opening rows entirely. */
  hideLedgerOpeningRows?: boolean;
  /** Hide FY partition / FY opening divider rows (e.g. filtered TDS views). */
  hideFiscalPartitionRows?: boolean;
  /** Range `from` — period-carry opening row ki Date column (BS/AD). */
  openingBalancePeriodStartDate?: unknown;
  /** Statement check mode (PC): focus / mark rows — Tally-style reconciliation */
  statementCheckModeActive?: boolean;
  statementCheckFocusId?: string | null;
  statementCheckMarkedIds?: ReadonlySet<string>;
  onStatementCheckRowFocus?: (transaction: { id?: string; _rowKey?: string }) => void;
  /** Spend-wise group view: row 3-dot → Select / Print (group-only print). */
  spendWiseGroupPrint?: SpendWiseGroupPrintConfig;
  /** Full unpaginated ledger rows — FY divider opening = running balance at boundary (not stale snapshot). */
  ledgerTransactionsForFyOpening?: Transaction[];
  /** Signed opening before first row in `ledgerTransactionsForFyOpening` (book OB + pre-first-txn carry). */
  fyLedgerScopeOpeningBalance?: number;
}

function samePendingOutboxIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Outbox drain background me hota hai — badge live rakhne ke liye pending rows tak halka poll. */
const PENDING_OUTBOX_POLL_MS = 10_000;

export function TransactionsTable({
  transactions,
  context,
  contextId,
  openingBalance = 0,
  periodOpeningUnavailable = false,
  periodOpeningLoading = false,
  booksOpeningBalance,
  openingBalanceOutstanding,
  openingBalanceLinkedVoucherNos,
  openingBalanceNarration,
  openingBalanceAttachmentUrls,
  openingBalanceDate,
  showNarration = true,
  narrationNoteSearch: _narrationNoteSearch,
  stockView = "amount",
  item,
  displayUnit,
  setDisplayUnit,
  journalAccountNames,
  userNames,
  accountNames,
  filters,
  setFilters,
  activeFilter,
  setActiveFilter,
  onRowClick,
  onInterCompanyChangeDetectedClick,
  periodDr = 0,
  periodCr = 0,
  closingBalance = 0,
  isTaxContext,
  isAllVouchersView,
  hideDebitColumn,
  hideCreditColumn,
  debitColumnHeaderLabel,
  creditColumnHeaderLabel,
  hideBalanceColumn,
  hideFooter,
  dateRange,
  isInitialLoad,
  isDateChange,
  getDisplayValue: getDisplayValueProp,
  voucherTypes,
  onVoucherTypeChange,
  isBalanceMasked,
  visibleColumns,
  openingBalanceActions,
  openingBalanceLabel = "Opening Balance",
  openingBalanceSearch,
  openingBalanceLeftContent,
  closingBalanceRowActions,
  closingBalanceActions,
  closingBalanceLabel = "Closing Balance",
  adaptiveClosingLabel = false,
  onDeleteVoucher,
  onMoveVoucherToRecycleBin,
  onHistoryVoucher,
  onAddLink,
  onApproveVoucher,
  onUnapproveVoucher,
  scrollOnlyTransactions,
  statusFilter,
  statusFilterAllChecked,
  onStatusFilterAll,
  onStatusFilterChange,
  statusFilterIdPrefix,
  groupEntityType,
  disableLayoutAnimation = false,
  blinkMode,
  forceBalanceMode,
  showItemPartyColumn = true,
  highlightPendingApproval = true,
  ledgerDateFilterActive,
  ledgerShowBookOpeningRow = true,
  hideLedgerOpeningRows = false,
  hideFiscalPartitionRows = false,
  openingBalancePeriodStartDate,
  transactionCardSearchHighlight,
  mobileCardLayoutLikeParty = false,
  daybookDesktopUnifiedScroll = false,
  statementCheckModeActive = false,
  statementCheckFocusId = null,
  statementCheckMarkedIds,
  onStatementCheckRowFocus,
  spendWiseGroupPrint,
  ledgerTransactionsForFyOpening,
  fyLedgerScopeOpeningBalance,
}: TransactionsTableProps) {
  const { company, companyId, effectiveNotificationSettings } = useCompany();
  const ledgerStatementChecked = useLedgerStatementChecked({
    companyId: companyId ?? undefined,
    context,
    contextId,
  });
  const fy = useFyVoucherScope();
  const recurringCompanyEnabled = isRecurringVoucherGenerationEnabled(company);
  const { templates: recurringTemplates } = useRecurringAccrualTemplates(
    companyId ?? undefined,
    recurringCompanyEnabled,
  );
  const activeRecurringTriggerVoucherIds = useMemo(
    () => (recurringCompanyEnabled ? buildActiveRecurringTriggerVoucherIdSet(recurringTemplates) : null),
    [recurringCompanyEnabled, recurringTemplates],
  );
  const voucherAttachmentUiOpts = useMemo(() => voucherAttachmentUiOptionsForCompany(company), [company]);
  const [filesTickEpoch, setFilesTickEpoch] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrefs = () => setFilesTickEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
  }, []);
  const [syncingVoucherIds, setSyncingVoucherIds] = useState<Set<string>>(() => new Set());
  const [pendingOutboxVoucherIds, setPendingOutboxVoucherIds] = useState<Set<string>>(() => new Set());
  const [dataSyncEpoch, setDataSyncEpoch] = useState(0);
  const autoPrioritySyncKeyRef = useRef<string>("");
  const markVoucherSyncing = useCallback((voucherId: string, syncing: boolean) => {
    setSyncingVoucherIds((prev) => {
      const next = new Set(prev);
      if (syncing) next.add(voucherId);
      else next.delete(voucherId);
      return next;
    });
  }, []);
  const refreshPendingOutboxVoucherIds = useCallback(() => {
    const cid = String(companyId || "").trim();
    if (!cid) {
      setPendingOutboxVoucherIds((prev) => (prev.size ? new Set<string>() : prev));
      return;
    }
    void listPendingOutboxDocIdsForCompany(cid, "vouchers").then((next) => {
      // Same ids par identity stable rakho — warna har poll pe puri table re-render hogi.
      setPendingOutboxVoucherIds((prev) => (samePendingOutboxIdSet(prev, next) ? prev : next));
    });
  }, [companyId]);
  const handleSyncVoucherNow = useCallback(
    async (transaction: any) => {
      const voucherId = String(transaction?.id || "").trim();
      const cid = String(companyId || "").trim();
      if (!cid || !voucherId) return;
      markVoucherSyncing(voucherId, true);
      try {
        const result = await flushVoucherOutbox({
          only: { companyId: cid, collectionName: "vouchers", docId: voucherId },
        });
        if (result.ok > 0) toast.success("Voucher synced", { duration: 1800 });
        else if (result.failed > 0) toast.error("Voucher sync failed", { duration: 2500 });
        else {
          const mirrored = await mirrorVoucherDocToBrowserDb(cid, voucherId);
          if (mirrored) toast.success("Voucher already synced", { duration: 1800 });
          else toast.message("No pending sync for this voucher", { duration: 1800 });
        }
      } finally {
        markVoucherSyncing(voucherId, false);
        refreshPendingOutboxVoucherIds();
      }
    },
    [companyId, markVoucherSyncing, refreshPendingOutboxVoucherIds]
  );
  useEffect(() => {
    refreshPendingOutboxVoucherIds();
    const onDataSyncChanged = () => {
      autoPrioritySyncKeyRef.current = "";
      refreshPendingOutboxVoucherIds();
      setDataSyncEpoch((v) => v + 1);
    };
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onDataSyncChanged);
    window.addEventListener("online", onDataSyncChanged);
    return () => {
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, onDataSyncChanged);
      window.removeEventListener("online", onDataSyncChanged);
    };
  }, [refreshPendingOutboxVoucherIds]);
  // Pending rows rehne tak poll karo: background flush ke baad "Sync due" khud green tick ban jaye.
  useEffect(() => {
    if (!pendingOutboxVoucherIds.size) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) refreshPendingOutboxVoucherIds();
    }, PENDING_OUTBOX_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pendingOutboxVoucherIds.size, refreshPendingOutboxVoucherIds]);
  // FY merge: neela divider row — company par local fiscal merge `useCompany` se aa chuka hai.
  const fiscalMergePartitions = useMemo(
    () => (hideFiscalPartitionRows ? [] : buildFiscalMergePartitionEntriesFromCompany(company)),
    [hideFiscalPartitionRows, company?.fiscalSplitMode, company?.fiscalMergePartitionAt, company?.fiscalMergePartitionAtIsos, company?.fiscalPartitionLabel, company?.country, company?.fiscalYearStart]
  );
  const [fyPartitionOpenings, setFyPartitionOpenings] = useState<Map<number, number>>(() => new Map());
  const [fyPartitionOpeningsStatus, setFyPartitionOpeningsStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const fyOpeningFromLedger = useMemo(() => {
    if (!fiscalMergePartitions.length) return null;
    if (!ledgerTransactionsForFyOpening?.length && !hasFullLocalLedgerVoucherMirror(company, fy.activeScope)) return null;
    const source =
      ledgerTransactionsForFyOpening && ledgerTransactionsForFyOpening.length
        ? ledgerTransactionsForFyOpening
        : transactions;
    if (!source?.length) return null;
    const scopeOpening =
      typeof fyLedgerScopeOpeningBalance === "number" && Number.isFinite(fyLedgerScopeOpeningBalance)
        ? fyLedgerScopeOpeningBalance
        : Number(openingBalance) || 0;
    const map = computeFyOpeningBalanceByBoundary(
      source as any[],
      fiscalMergePartitions,
      scopeOpening
    );
    return map.size > 0 ? map : null;
  }, [
    fiscalMergePartitions,
    company,
    fy.activeScope,
    ledgerTransactionsForFyOpening,
    transactions,
    fyLedgerScopeOpeningBalance,
    openingBalance,
  ]);
  useEffect(() => {
    const cid = String(companyId || "").trim();
    const entityId = String(contextId || "").trim();
    if (!fiscalMergePartitions.length || !cid || !entityId || !fy.enabled) {
      setFyPartitionOpenings(new Map());
      setFyPartitionOpeningsStatus("idle");
      return;
    }
    if (fyOpeningFromLedger && fyOpeningFromLedger.size > 0) {
      setFyPartitionOpenings(fyOpeningFromLedger);
      setFyPartitionOpeningsStatus("ready");
      return;
    }
    const boundaries = fiscalMergePartitions
      .map((p) => startOfDay(p.at).getTime())
      .filter((ms) => Number.isFinite(ms));
    let cancelled = false;

    const fullMirror = hasFullLocalLedgerVoucherMirror(company, fy.activeScope);

    void (async () => {
      if (fullMirror) {
        const fromSqlite = await loadFyPartitionOpeningsFromSqliteMirror({
          company,
          companyId: cid,
          activeScope: fy.activeScope,
          boundaryMsList: boundaries,
          entityId,
        });
        if (cancelled) return;
        if (fromSqlite.openingsByBoundaryMs.size > 0) {
          setFyPartitionOpenings(fromSqlite.openingsByBoundaryMs);
          setFyPartitionOpeningsStatus("ready");
          return;
        }
      }

      const local = await loadFyPartitionOpeningsFromLocalCache({
        company,
        companyId: cid,
        boundaryMsList: boundaries,
        entityId,
      });
      if (cancelled) return;

      if (local.openingsByBoundaryMs.size > 0) {
        setFyPartitionOpenings(local.openingsByBoundaryMs);
        setFyPartitionOpeningsStatus("ready");
      } else if (!fullMirror) {
        setFyPartitionOpeningsStatus("loading");
      }

      if (fullMirror) return;

      const authoritative = await loadFyPartitionOpeningsForEntity({
        company,
        companyId: cid,
        boundaryMsList: boundaries,
        entityId,
      });
      if (cancelled) return;

      setFyPartitionOpenings((prev) => {
        const merged = new Map(prev);
        for (const [boundaryMs, signed] of authoritative.openingsByBoundaryMs) {
          if (Number.isFinite(signed)) merged.set(boundaryMs, signed);
        }
        return merged.size > 0 ? merged : prev;
      });

      if (authoritative.openingsByBoundaryMs.size > 0) {
        setFyPartitionOpeningsStatus("ready");
      } else if (local.openingsByBoundaryMs.size === 0) {
        setFyPartitionOpeningsStatus(authoritative.status);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    fiscalMergePartitions,
    companyId,
    contextId,
    company,
    fy.enabled,
    fy.activeScope,
    fy.openingBalances,
    transactions,
    fyOpeningFromLedger,
  ]);
  const effectiveFyPartitionOpenings = fyOpeningFromLedger ?? fyPartitionOpenings;
  const effectiveFyPartitionOpeningsStatus =
    fyOpeningFromLedger && fyOpeningFromLedger.size > 0
      ? "ready"
      : fyPartitionOpeningsStatus === "idle"
        ? "loading"
        : fyPartitionOpeningsStatus;
  const { formatCurrency: drCrFormatCurrency } = useDate();
  const tableTransactions = useMemo(() => {
    let list =
      fiscalMergePartitions.length
        ? insertFiscalPartitionRowsMulti(transactions as any[], fiscalMergePartitions)
        : transactions;
    if (fiscalMergePartitions.length) {
      list = insertFyOpeningRowsAfterPartitions(list as any[], fiscalMergePartitions, 0, {
        snapshotOpeningByBoundaryMs: effectiveFyPartitionOpenings,
        partitionOpeningsStatus: effectiveFyPartitionOpeningsStatus,
        company,
      });
    }
    list = stripSpendWiseSyntheticOpeningMaster(list) as typeof list;
    let mapped = (list as any[]).map((row) => {
      const id = String(row?.id || "").trim();
      if (!id || row?.type === FISCAL_YEAR_PARTITION_ROW_TYPE || row?.type === FY_OPENING_ROW_TYPE) return row;
      const nextStatus = pendingOutboxVoucherIds.has(id) ? "sync_due" : "synced";
      return row?.__plSyncStatus === nextStatus ? row : { ...row, __plSyncStatus: nextStatus };
    });
    // TDS ledger rows bypass useTransactions column filters: apply Debit and Credit header filters here,
    // each evaluated ONLY on its own column cell (amount + TDS badge text if the badge sits in that column).
    // Chip tokens "verified"/"unverified" are exact (handled by amountColumnHaystackMatchesFilter); other text = substring.
    const drCrFilterTexts = {
      debit: String(filters?.debit ?? "").trim(),
      credit: String(filters?.credit ?? "").trim(),
    };
    const drCrChips = { debit: String(filters?.debitChip ?? "").trim(), credit: String(filters?.creditChip ?? "").trim() };
    if (drCrFilterTexts.debit || drCrFilterTexts.credit || drCrChips.debit || drCrChips.credit) {
      mapped = mapped.filter((row) => {
        const isTdsLedgerRow = isLedgerTdsTableRow(row as { type?: string; [LEDGER_TDS_ROW_FLAG]?: boolean });
        // Processed row: badge label is final here (uses _tdsSettled / paymentStatus). Rows with a badge are filtered here.
        const label =
          isTdsLedgerRow || isSalePurchaseTdsVerifyLedgerContext(context, groupEntityType)
            ? String(resolveSalePurchaseTdsVerifyLabel(row, { context, contextId, groupEntityType }) ?? "").toLowerCase()
            : "";
        if (!isTdsLedgerRow && !label) return true;
        // Badge sits in ONE cell. Number tokens match own column amount; text tokens/chips match the badge in the OPPOSITE column.
        const badgeCol = label
          ? statementCheckedMessageColumn(Number((row as any)?.debit) || 0, Number((row as any)?.credit) || 0)
          : null;
        // Active filters (text and/or chip per column) are ORed. Number tokens: own column amount. Text/chip: badge in the OPPOSITE column.
        const drCrMatches = (["debit", "credit"] as const)
          .map((k) =>
            drCrColumnFilterResult(
              drCrFilterTexts[k],
              drCrChips[k],
              columnFieldValuesHaystack([
                (row as any)?.[k],
                (() => {
                  const amt = Number((row as any)?.[k]) || 0;
                  return amt ? String(drCrFormatCurrency(amt, { noAnimation: true }) ?? "") : "";
                })(),
                (() => {
                  const amt = Number((row as any)?.[k]) || 0;
                  return amt ? String(drCrFormatCurrency(amt, { noSuffix: true, noAnimation: true }) ?? "") : "";
                })(),
              ]),
              label && badgeCol && badgeCol !== k ? label : ""
            )
          )
          .filter((r): r is boolean => r !== null);        return drCrMatches.length === 0 || drCrMatches.some(Boolean);
      });
    }
    return mapped as typeof list;
  }, [
    filters?.debit,
    filters?.credit,
    filters?.debitChip,
    filters?.creditChip,
    drCrFormatCurrency,
    context,
    contextId,
    groupEntityType,
    transactions,
    fiscalMergePartitions,
    pendingOutboxVoucherIds,
    openingBalance,
    effectiveFyPartitionOpenings,
    effectiveFyPartitionOpeningsStatus,
  ]);
  /** Unverified TDS legs stay on the row (dim) but must not inflate FY End Total Dr/Cr. */
  /** Tax page only: TDS Paid/Unpaid filter applies to TDS tax accounts, not VAT etc. */
  const isTdsTaxAccountPage = useMemo(
    () =>
      context !== "tax" ||
      (transactions as any[]).some((t) => taxAccountIsTdsVerifyLegOnVoucher(t, String(contextId || ""))),
    [context, contextId, transactions]
  );
  const fiscalPartitionBooksDrCr = useMemo(() => {
    if (context === "tax") {
      const taxId = String(contextId || "").trim();
      if (!taxId) return undefined;
      return (tx: unknown) => taxLedgerBooksDrCrFromRow(tx as any, taxId);
    }
    if (context === "party" || context === "staff") {
      return (tx: unknown) => partyTdsLedgerBooksDrCrFromRow(tx as any);
    }
    return undefined;
  }, [context, contextId]);
  const fiscalPartitionClosingSummaryById = useMemo(
    () => buildPartitionClosingSummaryMap(tableTransactions as unknown[], fiscalPartitionBooksDrCr),
    [tableTransactions, fiscalPartitionBooksDrCr]
  );
  const fiscalPartitionSummaryForTxn = useCallback(
    (t: { type?: string; id?: string }) => {
      if (t?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE) return undefined;
      return fiscalPartitionClosingSummaryById.get(String(t.id || "").trim());
    },
    [fiscalPartitionClosingSummaryById]
  );
  useEffect(() => {
    publishVoucherAttachmentListReuseIndex(tableTransactions as any[], voucherAttachmentUiOpts);
  }, [tableTransactions, voucherAttachmentUiOpts]);
  /** OB narration row blue tint — openingBalanceNarrationRow `useSpendWiseOpeningBalanceCard` se pehle chahiye */
  useEffect(() => {
    const cid = String(companyId || "").trim();
    if (!cid || isFirebaseLedgerDataSyncDisabled()) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const due = (tableTransactions as any[])
      .filter((t) => t && t.type !== FISCAL_YEAR_PARTITION_ROW_TYPE && String(t.__plSyncStatus || "").trim() !== "synced")
      .map((t) => String(t.id || "").trim())
      .filter(Boolean);
    if (!due.length) return;
    const firstId = due[0];
    const key = `${cid}:${firstId}:${due.length}`;
    if (autoPrioritySyncKeyRef.current === key) return;
    autoPrioritySyncKeyRef.current = key;
    markVoucherSyncing(firstId, true);
    void (async () => {
      const result = await flushVoucherOutbox({
        priority: { companyId: cid, collectionName: "vouchers", docId: firstId },
      });
      if (result.ok === 0 && result.failed === 0) {
        await mirrorVoucherDocToBrowserDb(cid, firstId);
      }
    })().finally(() => {
      markVoucherSyncing(firstId, false);
      refreshPendingOutboxVoucherIds();
    });
  }, [
    companyId,
    tableTransactions,
    markVoucherSyncing,
    dataSyncEpoch,
    refreshPendingOutboxVoucherIds,
  ]);
  const hasSpendWiseGroups = tableTransactions?.some((t: any) => typeof t._spendWiseGroupColorIndex === "number");
  const useSpendWiseOpeningBalanceCard = context === "account" && hasSpendWiseGroups;
  const { user, customUser } = useAuth();
  const currentUserUid = user?.uid ?? null;
  const currentUserDisplayName = customUser?.displayName || user?.displayName || user?.email || null;
  const { balanceMode } = useBalanceMode();
  // Allow pages like Bank/Cash to stay on statement layout even if the shared balance-mode preference is bill-wise.
  const resolvedBalanceMode = forceBalanceMode ?? balanceMode;
  const [hiddenOpeningAmountKeys, setHiddenOpeningAmountKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setHiddenOpeningAmountKeys(readHiddenLedgerOpeningAmountKeys());
  }, []);
  const isLedgerOpeningAmountVisible = useCallback(
    (key: string) =>
      LEDGER_OPENING_HIDE_AMOUNT_ENABLED ? !hiddenOpeningAmountKeys.has(key) : true,
    [hiddenOpeningAmountKeys]
  );
  const toggleLedgerOpeningAmountVisible = useCallback((key: string, e?: React.MouseEvent) => {
    if (!LEDGER_OPENING_HIDE_AMOUNT_ENABLED) return;
    e?.stopPropagation();
    setHiddenOpeningAmountKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeHiddenLedgerOpeningAmountKeys(next);
      return next;
    });
  }, []);
  const handleApproveVoucherDefault = useCallback(
    async (transaction: any) => {
      if ((transaction as any)?.type === FISCAL_YEAR_PARTITION_ROW_TYPE || (transaction as any)?.type === FY_OPENING_ROW_TYPE) return;
      if (!companyId || !transaction?.id || !user?.uid) return;
      try {
        const approverName = customUser?.displayName || user?.displayName || user?.email || user.uid;
        await approveVoucherWithHistory(companyId, transaction.id, user.uid, approverName);
        refreshPendingOutboxVoucherIds();
        toast.success("Transaction approved.");
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : "Failed to approve transaction.";
        toast.error(message);
      }
    },
    [
      companyId,
      user?.uid,
      user?.displayName,
      user?.email,
      customUser?.displayName,
      refreshPendingOutboxVoucherIds,
    ]
  );
  const effectiveOnApproveVoucher = onApproveVoucher ?? handleApproveVoucherDefault;
  const handleUnapproveVoucherDefault = useCallback(
    async (transaction: any) => {
      if ((transaction as any)?.type === FISCAL_YEAR_PARTITION_ROW_TYPE || (transaction as any)?.type === FY_OPENING_ROW_TYPE) return;
      if (!companyId || !transaction?.id || !user?.uid) return;
      try {
        const actorName = customUser?.displayName || user?.displayName || user?.email || user.uid;
        await unapproveVoucherWithHistory(companyId, transaction.id, user.uid, actorName);
        refreshPendingOutboxVoucherIds();
        toast.success("Transaction marked as unapproved.");
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : "Failed to mark transaction as unapproved.";
        toast.error(message);
      }
    },
    [
      companyId,
      user?.uid,
      user?.displayName,
      user?.email,
      customUser?.displayName,
      refreshPendingOutboxVoucherIds,
    ]
  );
  const effectiveOnUnapproveVoucher = onUnapproveVoucher ?? handleUnapproveVoucherDefault;
  /** Current page slice — pagination 10/20/30 pe jo rows table me hain. */
  const pageUnapprovedVouchers = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const t of tableTransactions as any[]) {
      if (!t || t._spendWiseSpacer) continue;
      if (t.type === FISCAL_YEAR_PARTITION_ROW_TYPE || t.type === FY_OPENING_ROW_TYPE) continue;
      const id = String(t.id || "").trim();
      if (!id || seen.has(id)) continue;
      if (!isLedgerTransactionUnapproved(t)) continue;
      seen.add(id);
      out.push(t);
    }
    return out;
  }, [tableTransactions]);
  const approveAllTargets = pageUnapprovedVouchers;
  const approveAllInFlightRef = useRef(false);
  const handleApproveAllVisible = useCallback(async () => {
    if (!companyId || !user?.uid) return;
    if (approveAllInFlightRef.current) return;
    const pending = approveAllTargets;
    if (!pending.length) {
      toast.message("No unapproved transactions on this page.");
      return;
    }
    approveAllInFlightRef.current = true;
    const approverName = customUser?.displayName || user?.displayName || user?.email || user.uid;
    const pendingIds = pending
      .map((t) => String(t?.id || "").trim())
      .filter(Boolean);
    try {
      const result = await approveVouchersWithHistoryBatch(
        companyId,
        pendingIds,
        user.uid,
        approverName
      );
      refreshPendingOutboxVoucherIds();
      if (result.ok > 0) {
        toast.success(
          result.ok === 1 ? "1 transaction approved." : `${result.ok} transactions approved.`
        );
      }
      if (result.failed > 0) {
        toast.error(
          result.failed === 1
            ? "1 transaction failed to approve."
            : `${result.failed} transactions failed to approve.`
        );
      }
    } finally {
      approveAllInFlightRef.current = false;
    }
  }, [
    companyId,
    user?.uid,
    user?.displayName,
    user?.email,
    customUser?.displayName,
    approveAllTargets,
    refreshPendingOutboxVoucherIds,
  ]);
  const showApproveAllOnPage = approveAllTargets.length > 0;
  // Statement view = running balance. Bill wise: Party/Staff/Tax show per-row outstanding (closing balance).
  const isBillWiseMode = resolvedBalanceMode === "bill_wise";
  /** Party TDS details (Taxable / TDS Amount cols) — bill-wise still uses per-row outstanding. */
  const isPartyTdsLedgerTable =
    Boolean(visibleColumns?.tdsTaxable) || Boolean(visibleColumns?.tdsAmount);
  // Party/Staff/Tax (+ party TDS details) bill-wise: per-row outstanding. Daybook/account/expense keep running unless listed here.
  const shouldUseOutstandingBalance =
    isBillWiseMode &&
    (context === "party" ||
      context === "staff" ||
      context === "tax" ||
      isPartyTdsLedgerTable ||
      (context === "group" &&
        (groupEntityType === "party" || groupEntityType === "staff" || groupEntityType === "tax")));
  const billWiseLinkPreviewEnabled = isBillWiseMode && shouldUseOutstandingBalance;
  const [billWiseLinkPreview, setBillWiseLinkPreview] = useState<BillWiseLinkPreviewSelection | null>(null);
  const fyPatchedLedgerRows = useMemo(() => {
    return patchFyOpeningRowsBillWiseBalances(
      tableTransactions as any[],
      context,
      groupEntityType,
      shouldUseOutstandingBalance
    );
  }, [tableTransactions, context, groupEntityType, shouldUseOutstandingBalance]);
  /** Bill-wise carry belongs on FY opening rows — not duplicated on Book Opening when FY merge rows are present. */
  const hasFyOpeningRowsInLedger = useMemo(
    () => fyPatchedLedgerRows.some((r) => r?.type === FY_OPENING_ROW_TYPE),
    [fyPatchedLedgerRows]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fileDisplayMode, setFileDisplayMode] = useState<FileColumnDisplayMode>(
    () => readSavedFileColumnViewPrefs().displayMode
  );
  const [fileShowAll, setFileShowAll] = useState(() => readSavedFileColumnViewPrefs().showAll);
  const [txnTableTone, setTxnTableTone] = useState<LedgerTxnTableTone>("default");
  const [mobileCardColor, setMobileCardColor] = useState<MobileTransactionCardColor>("violet");
  const [mobileCardColorPickerOpen, setMobileCardColorPickerOpen] = useState(false);
  const { format: fyOpeningPillFormat } = useFyOpeningPillFormat();
  useEffect(() => {
    setTxnTableTone(readLedgerTxnTableTone());
    const onTone = () => setTxnTableTone(readLedgerTxnTableTone());
    window.addEventListener(LEDGER_TXN_TABLE_TONE_CHANGED_EVENT, onTone);
    return () => window.removeEventListener(LEDGER_TXN_TABLE_TONE_CHANGED_EVENT, onTone);
  }, []);
  const applyTxnTableTone = useCallback((next: LedgerTxnTableTone) => {
    setTxnTableTone(next);
    writeLedgerTxnTableTone(next);
  }, []);
  useEffect(() => {
    setMobileCardColor(readMobileTransactionCardColor());
    const onColor = () => setMobileCardColor(readMobileTransactionCardColor());
    window.addEventListener(MOBILE_TRANSACTION_CARD_COLOR_CHANGED_EVENT, onColor);
    return () => window.removeEventListener(MOBILE_TRANSACTION_CARD_COLOR_CHANGED_EVENT, onColor);
  }, []);
  /** File column filter popover — local open state so Save always closes even if parent filter state lags. */
  const [fileFilterPopoverOpen, setFileFilterPopoverOpen] = useState(false);
  const [internalActiveFilter, setInternalActiveFilter] = useState<string | null>(null);
  const effectiveActiveFilter = activeFilter !== undefined ? activeFilter : internalActiveFilter;
  const patchActiveFilter = setActiveFilter ?? setInternalActiveFilter;
  const filterInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusFilterInputSoon = useCallback((key: string) => {
    requestAnimationFrame(() => {
      const input = filterInputRefs.current[key];
      if (!input) return;
      if (typeof document !== "undefined" && document.activeElement === input) return;
      input.focus({ preventScroll: true });
    });
  }, []);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const dashboardRecentHeaderScrollRef = useRef<HTMLDivElement>(null);
  const dashboardRecentFooterHScrollRef = useRef<HTMLDivElement>(null);
  const [dashboardRecentHScrollWidth, setDashboardRecentHScrollWidth] = useState(0);
  const [intrinsicDateTypeColPx, setIntrinsicDateTypeColPx] = useState<{
    date: number;
    type: number;
  } | null>(null);
  const [ledgerUnifiedHScrollActive, setLedgerUnifiedHScrollActive] = useState(false);
  const ledgerUnifiedHScrollActiveRef = useRef(false);
  const resolveUnifiedHorizontalScrollHost = useCallback((): HTMLElement | null => {
    const body = tableContainerRef.current;
    if (!body) return null;
    return body.closest<HTMLElement>(
      "[data-pl-ledger-txn-unified-scroll], [data-pl-daybook-unified-scroll], [data-pl-dashboard-recent-full-bleed]"
    );
  }, []);

  const syncDashboardRecentHorizontalScroll = useCallback(
    (scrollLeft: number, source: "header" | "body" | "footer" | "unified") => {
      const body = tableContainerRef.current;
      const header = dashboardRecentHeaderScrollRef.current;
      const footer = dashboardRecentFooterHScrollRef.current;
      const unifiedHost = resolveUnifiedHorizontalScrollHost();
      const unifiedMode = Boolean(unifiedHost) && ledgerUnifiedHScrollActiveRef.current;

      // Unified H-scroll: poora inner ek saath shift — nested thead/body scrollLeft mat chhedo (misalign + V-scroll jump).
      if (unifiedMode && unifiedHost) {
        if (source === "body" || source === "footer" || source === "unified") return;
        if (source === "header" && unifiedHost.scrollLeft !== scrollLeft) {
          unifiedHost.scrollLeft = scrollLeft;
        }
        return;
      }

      if (source !== "header" && header && header.scrollLeft !== scrollLeft) {
        header.scrollLeft = scrollLeft;
      }
      if (source !== "body" && body && body.scrollLeft !== scrollLeft) {
        body.scrollLeft = scrollLeft;
      }
      if (source !== "footer" && footer && footer.scrollLeft !== scrollLeft) {
        footer.scrollLeft = scrollLeft;
      }
      if (unifiedHost && source !== "unified" && unifiedHost.scrollLeft !== scrollLeft) {
        unifiedHost.scrollLeft = scrollLeft;
      }
    },
    [resolveUnifiedHorizontalScrollHost]
  );
  useEffect(() => {
    if (effectiveActiveFilter === "file") setFileFilterPopoverOpen(true);
    else if (effectiveActiveFilter != null && effectiveActiveFilter !== "file") {
      setFileFilterPopoverOpen(false);
    }
  }, [effectiveActiveFilter]);
  useEffect(() => {
    if (!setFilters) return;
    const saved = readSavedFileColumnViewPrefs();
    if (saved.filterMode === "all") return;
    setFilters((prev: Record<string, string>) => {
      if (prev.file === "with" || prev.file === "without") return prev;
      return { ...prev, file: saved.filterMode };
    });
  }, [setFilters]);
  // Keep spend-wise blink/selection groups consistent for derived row ids.
  const normalizeSpendWiseRowBase = useCallback((id?: string) => {
    if (!id || typeof id !== "string") return id ?? "";
    if (id.includes("-in-")) return id.substring(0, id.indexOf("-in-"));
    if (id.endsWith("-ob-link")) return id.substring(0, id.length - "-ob-link".length);
    return id;
  }, []);
  const spendWiseVoucherMatchKey = useCallback((row: any) => {
    const baseId = resolveSpendWiseRowBaseVoucherId(row);
    if (baseId && baseId !== "__opening_balance_group__") return `id:${baseId}`;
    const vn = String(row?.voucherNumber ?? "").trim();
    if (vn) return `vn:${vn}`;
    return "";
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const isSpendWise = tableTransactions.some((t: any) => (t as any)._spendWiseChild === true || (t as any)._spendWiseGroupFirst === true);
    if (isSpendWise) {
      const selected = tableTransactions.find((t: any) => t?.id === selectedId);
      const key = selected ? spendWiseVoucherMatchKey(selected) : "";
      const stillPresent = key
        ? tableTransactions.some((t: any) => !t?._spendWiseSpacer && spendWiseVoucherMatchKey(t) === key)
        : false;
      if (!stillPresent) setSelectedId(null);
    } else if (!tableTransactions.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [tableTransactions, selectedId, spendWiseVoucherMatchKey]);

  // Click table ke bahar → row unselect; lekin Dialog/Dropdown/Popover radix portals body par hain — un par click se unselect mat karo (save ke baad edited row selected rahe)
  const isTargetInsidePortaledOverlay = useCallback((target: EventTarget | null) => {
    if (!target || !(target instanceof Element)) return false;
    return !!(
      target.closest('[role="dialog"]') ||
      target.closest('[role="alertdialog"]') ||
      target.closest("[data-radix-dropdown-menu-content]") ||
      target.closest("[data-radix-select-content]") ||
      target.closest("[data-radix-popover-content]") ||
      target.closest("[data-radix-sheet-content]")
    );
  }, []);

  // Unselect when user clicks anywhere in the app outside the table (empty area, sidebar, etc.)
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const el = tableContainerRef.current;
      if (!el || !selectedId) return;
      const t = e.target;
      if (el.contains(t as Node)) return;
      if (isTargetInsidePortaledOverlay(t)) return;
      setSelectedId(null);
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [selectedId, isTargetInsidePortaledOverlay]);

  // Staff group (statement + bill wise): focus table after row select so one Enter opens edit; delay so page doesn’t steal focus
  const isStaffGroup = context === "group" && groupEntityType === "staff";
  useEffect(() => {
    if (!isStaffGroup || !selectedId) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tableContainerRef.current?.focus();
      });
    });
    return () => cancelAnimationFrame(id);
  }, [isStaffGroup, selectedId]);

  // Check mode: focus badle tab hi scroll — table refresh par jump na ho (manual scroll safe rahe)
  const statementCheckFocusScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!statementCheckModeActive || !statementCheckFocusId) {
      statementCheckFocusScrollRef.current = statementCheckFocusId;
      return;
    }
    if (statementCheckFocusScrollRef.current === statementCheckFocusId) return;
    statementCheckFocusScrollRef.current = statementCheckFocusId;
    const el = tableContainerRef.current?.querySelector('[data-check-focus="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [statementCheckModeActive, statementCheckFocusId]);

  /** Space — sirf selected (orange) row par scroll; auto scroll refresh par band */
  const scrollSelectedRowIntoView = useCallback(() => {
    scrollTransactionSelectedRowIntoView(tableContainerRef.current);
  }, []);

  const getStatementCheckRowProps = useCallback(
    (t: any) => {
      const rowId = statementCheckTxnId(t);
      const isStatementChecked = ledgerStatementChecked.isChecked(t);
      const canMarkStatement =
        ledgerStatementChecked.canMark &&
        rowId &&
        t?.type !== "opening_balance" &&
        t?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE &&
        t?.type !== FY_OPENING_ROW_TYPE;
      const statementCheckedProps = {
        isStatementChecked,
        onMarkAsChecked: canMarkStatement ? () => ledgerStatementChecked.toggleChecked(t) : undefined,
      };
      if (statementCheckModeActive) {
        return {
          // Check mode: focus = normal blue selected border; Space mark = green border
          isSelected: statementCheckFocusId === rowId,
          isCheckModeFocused: statementCheckFocusId === rowId,
          isCheckModeMarked: statementCheckMarkedIds?.has(rowId) ?? false,
          onRowSelect: () => onStatementCheckRowFocus?.(t),
          ...statementCheckedProps,
        };
      }
      return {
        isSelected: selectedId === t.id,
        isCheckModeFocused: false,
        isCheckModeMarked: false,
        onRowSelect: () => setSelectedId(t.id),
        ...statementCheckedProps,
      };
    },
    [
      statementCheckModeActive,
      statementCheckFocusId,
      statementCheckMarkedIds,
      onStatementCheckRowFocus,
      selectedId,
      ledgerStatementChecked,
    ]
  );

  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Check mode shortcuts hook `useStatementCheckMode` window par handle karta hai
      if (statementCheckModeActive) return;
      if (tableTransactions.length === 0) return;
      const idx = tableTransactions.findIndex((t) => t.id === selectedId);
      const currentIndex = idx >= 0 ? idx : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIndex + 1, tableTransactions.length - 1);
        setSelectedId(tableTransactions[next]?.id ?? null);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        setSelectedId(tableTransactions[prev]?.id ?? null);
      } else if (e.key === "Enter" && selectedId) {
        e.preventDefault();
        const t = tableTransactions.find((x) => x.id === selectedId);
        if (t && (t as any).type !== FISCAL_YEAR_PARTITION_ROW_TYPE && (t as any).type !== FY_OPENING_ROW_TYPE) onRowClick?.(t);
      } else if ((e.key === " " || e.code === "Space") && selectedId) {
        // Manual scroll ke baad wapas selected row — sirf Space se
        e.preventDefault();
        scrollSelectedRowIntoView();
      }
    },
    [tableTransactions, selectedId, onRowClick, statementCheckModeActive, scrollSelectedRowIntoView]
  );

  /** Spend-wise multi-row: clicked row = selected (border); same voucher ki baaki rows = blink (row mode). */
  const isSpendWiseMultiRow = tableTransactions.some((t: any) => (t as any)._spendWiseChild === true || (t as any)._spendWiseGroupFirst === true);
  // Partial-linked voucher: linked child + unlinked remainder — dono rows same base id / voucher no.
  const spendWiseBaseRowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tableTransactions as any[]) {
      if (t?._spendWiseSpacer) continue;
      const key = spendWiseVoucherMatchKey(t);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [tableTransactions, spendWiseVoucherMatchKey]);
  const selectedSpendWiseRow = useMemo(
    () => (selectedId ? tableTransactions.find((t: any) => t?.id === selectedId) : undefined),
    [tableTransactions, selectedId]
  );
  const selectedVoucherMatchKey =
    selectedSpendWiseRow && isSpendWiseMultiRow ? spendWiseVoucherMatchKey(selectedSpendWiseRow) : null;
  const activeBlinkModes = Array.isArray(blinkMode) ? blinkMode : [];
  const canBlinkRelatedRows = activeBlinkModes.includes("all") || activeBlinkModes.includes("group");
  const getIsRelatedBlink = useCallback(
    (t: any) => {
      if (!isSpendWiseMultiRow || !selectedVoucherMatchKey) return false;
      if (t.id === selectedId) return false;
      if (spendWiseVoucherMatchKey(t) !== selectedVoucherMatchKey) return false;
      if ((spendWiseBaseRowCounts.get(selectedVoucherMatchKey) ?? 0) <= 1) return false;
      if (canBlinkRelatedRows) return true;
      return activeBlinkModes.includes("row");
    },
    [
      canBlinkRelatedRows,
      isSpendWiseMultiRow,
      selectedVoucherMatchKey,
      spendWiseVoucherMatchKey,
      spendWiseBaseRowCounts,
      selectedId,
      activeBlinkModes,
    ]
  );
  const getIsSelectedRowBlink = useCallback(
    (t: any) => {
      if (!activeBlinkModes.includes("row")) return false;
      if (!selectedId || t?.id !== selectedId) return false;
      const key = spendWiseVoucherMatchKey(t);
      return (spendWiseBaseRowCounts.get(key) ?? 0) > 1;
    },
    [activeBlinkModes, selectedId, spendWiseVoucherMatchKey, spendWiseBaseRowCounts]
  );

  const handlePrintSpendWiseGroupFromRow = useCallback(
    async (row: any) => {
      if (!spendWiseGroupPrint) return;
      const anchor =
        selectedId != null
          ? (tableTransactions.find((t) => t.id === selectedId) as Record<string, unknown> | undefined) ?? row
          : row;
      const groupTxns = extractSpendWiseGroupTransactions(tableTransactions, anchor);
      if (!groupTxns.length) {
        toast.error("Nothing to print", { description: "No transactions in this group." });
        return;
      }
      const toastId = toast.loading("Preparing print...");
      try {
        await printSpendWiseGroupTransactions(spendWiseGroupPrint, groupTxns);
        toast.dismiss(toastId);
      } catch (e) {
        toast.dismiss(toastId);
        console.error("Spend-wise group print failed:", e);
        toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
      }
    },
    [spendWiseGroupPrint, selectedId, tableTransactions]
  );

  const getSpendWiseRowMenuProps = useCallback(
    (t: any) => {
      const inGroup = Boolean((t as { _spendWiseGroupId?: string })._spendWiseGroupId);
      return {
        showSpendWiseGroupMenuActions: Boolean(spendWiseGroupPrint && hasSpendWiseGroups && inGroup),
        onPrintRow: () => void handlePrintSpendWiseGroupFromRow(t),
      };
    },
    [spendWiseGroupPrint, hasSpendWiseGroups, handlePrintSpendWiseGroupFromRow]
  );

  const openingBalanceMenuAnchor = useMemo(() => {
    const rows = tableTransactions as any[];
    const synthetic = rows.find((x) => x?.id === "__opening_balance_group__");
    if (synthetic) return synthetic;
    return rows.find(
      (x) =>
        !x?._spendWiseSpacer &&
        String(x?._spendWiseGroupId || "") === SPEND_WISE_OPENING_GROUP_ID
    );
  }, [tableTransactions]);

  const showOpeningSpendWiseMenu = Boolean(
    spendWiseGroupPrint && hasSpendWiseGroups && openingBalanceMenuAnchor
  );

  const renderOpeningBalanceEditMenuItem = useCallback(() => {
    if (!openingBalanceActions) return null;
    if (!React.isValidElement(openingBalanceActions)) return null;
    const dialogEl = openingBalanceActions as React.ReactElement<{ children?: React.ReactNode }>;
    return (
      <DropdownMenuItem onSelect={(e) => e.preventDefault()} asChild>
        {React.cloneElement(dialogEl, {
          children: (
            <span className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </span>
          ),
        })}
      </DropdownMenuItem>
    );
  }, [openingBalanceActions]);

  const renderOpeningBalanceRowMenu = useCallback(() => {
    if (!showOpeningSpendWiseMenu && !openingBalanceActions) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-pl-txn-icon-btn=""
            className={cn(txnTableIconBtnCn, "relative h-8 w-[18px] min-w-[18px] shrink-0 p-0 flex items-center justify-center")}
          >
            <span
              aria-hidden="true"
              className="text-base leading-none text-muted-foreground select-none"
            >
              ⋮
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {showOpeningSpendWiseMenu ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  const anchor = openingBalanceMenuAnchor;
                  if (anchor?.id) setSelectedId(anchor.id);
                }}
                className="flex items-center gap-2"
              >
                <MousePointerClick className="h-3.5 w-3.5" />
                Select
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handlePrintSpendWiseGroupFromRow(openingBalanceMenuAnchor)}
                className="flex items-center gap-2"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
              </DropdownMenuItem>
            </>
          ) : null}
          {renderOpeningBalanceEditMenuItem()}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }, [
    showOpeningSpendWiseMenu,
    openingBalanceActions,
    openingBalanceMenuAnchor,
    handlePrintSpendWiseGroupFromRow,
    renderOpeningBalanceEditMenuItem,
  ]);

  const {
    formatDate,
    formatDateBS,
    formatCurrency,
    formatCurrencyForPrint,
    dateSystem,
  } = useDate();
  /* FREEZE: Mobile txn card title — no voucher type in header. See AGENTS.md. */
  const mobileCardPreviews = useMemo<MobileTransactionCardPreview[]>(() =>
    tableTransactions
      .filter((row: any) => row?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE && row?.type !== FY_OPENING_ROW_TYPE && !row?._spendWiseSpacer)
      .slice(0, 10)
      .map((row: any, index) => {
        const credit = Number(row?.credit ?? 0);
        const debit = Number(row?.debit ?? 0);
        const balance = Number(row?.balance ?? row?.runningBalance ?? 0);
        return {
          id: String(row?.id ?? `preview-${index}`),
          tone: highlightPendingApproval && row?.isApproved !== true ? "pink" : "green",
          title: String(row?.voucherNumber || row?.type || "Transaction"),
          narration: String(row?.narration || "—"),
          date: String(row?.date || "—"),
          user: String(row?.userName || "—"),
          amount: String(formatCurrency(Math.abs(credit || debit), { noSuffix: true, context: "transaction", noAnimation: true })),
          amountSide: credit > 0 ? "cr" : debit > 0 ? "dr" : "none",
          balance: String(formatCurrency(Math.abs(balance), { noSuffix: true, context: "transaction", noAnimation: true })),
          balanceSide: balance < 0 ? "cr" : balance > 0 ? "dr" : "none",
        };
      }),
    [tableTransactions, highlightPendingApproval, formatCurrency]
  );
  const { settings: animationSettings } = useAnimationSettings();
  
  // Get animation settings - check enabled flag explicitly (match PartyList / list motion). Disable when parent asks (e.g. view toggle).
  const isRowAnimationEnabled = !disableLayoutAnimation && animationSettings?.rows?.enabled === true;
  const rowAnimationDuration = isRowAnimationEnabled ? (animationSettings?.rows?.duration ?? 2.5) : 0;
  const isNumberAnimationEnabled = animationSettings?.numbers?.enabled === true;
  const numberAnimationDuration = isNumberAnimationEnabled ? (animationSettings?.numbers?.duration ?? 2.5) : 0;
  /** Row reorder animation — bank statement (short txn) same as party/staff when settings enabled. */
  const useTxnRowLayoutAnimation = isRowAnimationEnabled;
  /** Date filter par popLayout purani row positions preserve karta hai — spend-wise list neeche chipak jati hai. */
  const ledgerListAnimateKey = useMemo(() => {
    const prefix = hasSpendWiseGroups ? "spend-wise" : "statement";
    if (!ledgerDateFilterActive) return `${prefix}-all`;
    const fromMs =
      dateRange?.from instanceof Date
        ? dateRange.from.getTime()
        : dateRange?.from
          ? new Date(dateRange.from as string | number).getTime()
          : "";
    const toMs =
      dateRange?.to instanceof Date
        ? dateRange.to.getTime()
        : dateRange?.to
          ? new Date(dateRange.to as string | number).getTime()
          : "";
    return `${prefix}-filter-${fromMs}-${toMs}`;
  }, [hasSpendWiseGroups, ledgerDateFilterActive, dateRange?.from, dateRange?.to]);

  useEffect(() => {
    setBillWiseLinkPreview(null);
  }, [ledgerListAnimateKey]);

  // formatCurrency returns an AnimatedNumber React node when number animation is on; that cannot be text-highlighted.
  // While a Debit/Credit header filter has text, render the amount as a plain string ("Rs. 1.00") so highlight works.
  const drCrFilterTypingForAmountText = Boolean(String(filters?.debit ?? "").trim() || String(filters?.credit ?? "").trim());
  const getDisplayValue = useCallback((value: number) => {
    if (getDisplayValueProp) return getDisplayValueProp(value);
    return formatCurrency(value, {noSuffix: true, context: 'transaction', ...(drCrFilterTypingForAmountText ? { noAnimation: true } : {})});
  }, [getDisplayValueProp, formatCurrency, drCrFilterTypingForAmountText]);

  const rowTextSearchHighlight = useMemo(
    () => String(transactionCardSearchHighlight || "").trim(),
    [transactionCardSearchHighlight]
  );


  // Header filter popover — modal: filter input pe click se popover band na ho (Recent/daybook + party).
  const renderHeaderWithFilter = (key: string, label: string, isNumeric: boolean = false, minWidthPx?: number) => {
    const drCrChipValue = key === "debit" || key === "credit" ? String((filters && filters[drCrChipKey(key)]) || "") : "";
    const isFiltered = !!(filters && filters[key]) || !!drCrChipValue || (key === 'type' && voucherTypes && !voucherTypes.includes('all'));
    const hasTdsLedgerCols = showCol("tdsTaxable") || showCol("tdsAmount");
    // Status body pills are centered — keep header label over the pill (not left-aligned).
    const statusHeaderCenter = key === "status";
    // Same as Account Details: numeric headers right-aligned (Taxable / TDS Amount / Dr / Cr / Balance).
    const tdsLeftAlignHeader =
      hasTdsLedgerCols && (key === "tdsTaxable" || key === "tdsAmount" || key === "debit" || key === "credit");
    const thClass = cn(
      "p-0",
      isNumeric && !tdsLeftAlignHeader && "text-right",
      statusHeaderCenter && "text-center"
    );
    const innerPadding =
      ensureMinGaps && key === "balance"
        ? LEDGER_TXN_BALANCE_HEADER_PAD_CN
        : ensureMinGaps && (key === "debit" || key === "credit")
          ? hasTdsLedgerCols
            ? LEDGER_TDS_DR_CR_CELL_PAD_CN
            : LEDGER_TXN_COL_MAX_GAP_PAD_CN
        : ensureMinGaps && key === "tdsTaxable"
          ? LEDGER_TDS_TAXABLE_CELL_PAD_CN
          : ensureMinGaps && key === "tdsAmount"
            ? LEDGER_TDS_AMOUNT_CELL_PAD_CN
            : ensureMinGaps && key === "user" && hasTdsLedgerCols
              ? LEDGER_TDS_USER_CELL_PAD_CN
              : ensureMinGaps &&
                  hasTdsLedgerCols &&
                  showCol("type") &&
                  (key === "date_ad" || (key === "date" && dateSystem !== "Both"))
                ? LEDGER_TDS_LAST_DATE_CELL_PAD_CN
                : ensureMinGaps && key === "date_bs" && dateSystem === "Both"
                  ? LEDGER_BOTH_DATE_BS_CELL_PAD_CN
                  : ensureMinGaps
                    ? LEDGER_TXN_COL_MAX_GAP_PAD_CN
                    : "px-2";
    const filterValue = filters ? filters[key] || "" : "";
    const filterOpen = effectiveActiveFilter === key;
    const isTaxPageForFilter = context === "tax" || (context === "group" && groupEntityType === "tax");
    // Verified/Unverified chips: always visible in the Debit and Credit filter popups.
    const showTdsPaidFilterButtons = key === "debit" || key === "credit";
    const activeTdsPaidToken = drCrChipValue.trim().toLowerCase();
    const renderTdsPaidFilterButtons = () => {
      if (!setFilters || !showTdsPaidFilterButtons) return null;
      return (
        <div className="flex gap-1 border-t p-1" data-pl-txn-filter-popover="">
          {([
            ["verified", "Verified"],
            ["unverified", "Unverified"],
          ] as const).map(([tok, text]) => (
            <Button
              key={tok}
              type="button"
              size="sm"
              variant={activeTdsPaidToken === tok ? "default" : "outline"}
              className="h-7 flex-1 px-1 text-[11px] font-semibold"
              onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Chip is its own state (debitChip / creditChip); the text input is not touched.
                setFilters((prev: Record<string, string>) => ({
                  ...prev,
                  [drCrChipKey(key as "debit" | "credit")]:
                    String(prev[drCrChipKey(key as "debit" | "credit")] ?? "").trim().toLowerCase() === tok ? "" : tok,
                }));
              }}
            >
              {text}
            </Button>
          ))}
        </div>
      );
    };
    const renderTextFilterInput = () => {
      if (!setFilters) return null;
      return (
        <div className="relative" data-pl-txn-filter-popover="">
          <Input
            ref={(el) => {
              filterInputRefs.current[key] = el;
              if (el && filterOpen) focusFilterInputSoon(key);
            }}
            className={cn(
              "border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
              filterValue && "pr-9"
            )}
            placeholder={`Filter ${label}...`}
            value={filterValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const newValue = e.target.value;
              setFilters((prev: Record<string, string>) => ({ ...prev, [key]: newValue }));
            }}
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
            onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter") patchActiveFilter(null);
            }}
          />
          {filterValue || drCrChipValue ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Clear action: text and chip of this column.
                setFilters((prev: Record<string, string>) => ({
                  ...prev,
                  [key]: "",
                  ...(key === "debit" || key === "credit" ? { [drCrChipKey(key)]: "" } : {}),
                }));
                focusFilterInputSoon(key);
              }}
              aria-label={`Clear ${label} filter`}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      );
    };
    const renderFilterPopover = (btnClass: string) => (
      <Popover modal open={filterOpen} onOpenChange={(open) => patchActiveFilter(open ? key : null)}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" data-pl-txn-icon-btn="" className={btnClass}>
            <Filter className={cn("h-4 w-4", isFiltered && "text-red-600")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={context === "daybook" ? { top: 56, bottom: 8, left: 8, right: 8 } : 8}
          className={cn("z-[120] p-0 overflow-hidden", showTdsPaidFilterButtons ? "w-56" : "w-48")}
          onOpenAutoFocus={(e: Event) => {
            e.preventDefault();
            focusFilterInputSoon(key);
          }}
          onCloseAutoFocus={(e: Event) => e.preventDefault()}
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-pl-txn-filter-popover]")) e.preventDefault();
          }}
        >
          {key === "type" && onVoucherTypeChange ? (
            <VoucherTypeFilter selectedTypes={voucherTypes || ["all"]} onSelectionChange={onVoucherTypeChange} />
          ) : (
            <>
              {renderTextFilterInput()}
              {renderTdsPaidFilterButtons()}
            </>
          )}
        </PopoverContent>
      </Popover>
    );

    const skipIntrinsicDateTypeHeaderMin =
      dashboardRecentFyAttachmentGate &&
      !useMobileCardView &&
      (daybookDesktopUnifiedScroll || !splitScrollColProportionalGate) &&
      (key === "date" || key === "date_ad" || key === "type");
    return (
      <TableHead
        data-pl-col={key}
        className={thClass}
        style={
          ensureMinGaps && minWidthPx != null && !skipIntrinsicDateTypeHeaderMin
            ? { minWidth: `${minWidthPx}px` }
            : undefined
        }
      >
        <div
          className={cn(
            "flex w-full items-center gap-1 font-bold py-3 text-black whitespace-nowrap",
            innerPadding,
            isFiltered ? "text-red-600" : "text-black",
            isNumeric && !tdsLeftAlignHeader ? "justify-end" : statusHeaderCenter ? "justify-center" : "justify-start"
          )}
        >
          {/* Label pehle, filter right — Debit/Credit/Balance; Status centered over row pill. */}
          <span>{label}</span>
          {(setFilters || (key === "type" && onVoucherTypeChange)) &&
            renderFilterPopover(cn(txnTableIconBtnCn, "h-6 w-6 shrink-0"))}
        </div>
      </TableHead>
    );
  };

  /** File column — checkbox dropdown: All / with file / without file */
  const renderFileHeaderWithFilter = () => {
    const fileFilterRaw = filters?.file ?? "";
    const fileFilterMode: "all" | "with" | "without" =
      fileFilterRaw === "with" || fileFilterRaw === "without" ? fileFilterRaw : "all";
    const hasTdsFileCenter = (showCol("tdsTaxable") || showCol("tdsAmount")) && showFileBySelection;
    const innerPadding = ensureMinGaps
      ? hasTdsFileCenter
        ? LEDGER_TDS_FILE_CELL_PAD_CN
        : LEDGER_TXN_COL_MAX_GAP_PAD_CN
      : "px-2";
    const setFileFilter = (mode: "all" | "with" | "without") => {
      if (!setFilters) return;
      setFilters((prev: Record<string, string>) => ({
        ...prev,
        file: mode === "all" ? "" : mode,
      }));
    };
    const saveFileView = (e?: React.MouseEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      saveFileColumnViewPrefs(fileDisplayMode, fileShowAll, fileFilterMode);
      toast.success("File view saved.");
      setFileFilterPopoverOpen(false);
      patchActiveFilter(null);
    };

    return (
      <TableHead
        className="font-semibold p-0 text-center"
        style={
          ensureMinGaps
            ? { minWidth: hasTdsFileCenter ? `${LEDGER_TDS_FILE_COL_PX}px` : "44px" }
            : undefined
        }
        data-theme-header="file"
      >
        <div
          className={cn(
            "flex w-full items-center justify-center gap-1 font-bold py-3 whitespace-nowrap",
            innerPadding,
            "text-black"
          )}
        >
          <span>File</span>
          {setFilters ? (
            <Popover
              modal
              open={fileFilterPopoverOpen}
              onOpenChange={(open) => {
                setFileFilterPopoverOpen(open);
                patchActiveFilter(open ? "file" : null);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-pl-txn-icon-btn=""
                  className={cn(txnTableIconBtnCn, "h-6 w-6")}
                  aria-label="Filter by file attachment"
                >
                  <CheckSquare className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-2 w-64" align="center" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
                <div className="flex items-center gap-2 border-b pb-2 mb-1">
                  <Checkbox
                    id="txn-file-filter-all"
                    checked={fileFilterMode === "all"}
                    onCheckedChange={() => setFileFilter("all")}
                  />
                  <label htmlFor="txn-file-filter-all" className="text-sm font-medium cursor-pointer flex-1">
                    All
                  </label>
                </div>
                <div className="flex items-center gap-2 py-1">
                  <Checkbox
                    id="txn-file-filter-with"
                    checked={fileFilterMode === "with"}
                    onCheckedChange={() => setFileFilter("with")}
                  />
                  <label htmlFor="txn-file-filter-with" className="text-sm font-medium cursor-pointer flex-1">
                    With file
                  </label>
                </div>
                <div className="flex items-center gap-2 py-1">
                  <Checkbox
                    id="txn-file-filter-without"
                    checked={fileFilterMode === "without"}
                    onCheckedChange={() => setFileFilter("without")}
                  />
                  <label htmlFor="txn-file-filter-without" className="text-sm font-medium cursor-pointer flex-1">
                    Without file
                  </label>
                </div>
                <div className="mt-2 border-t pt-2">
                  <p className="mb-1 px-0.5 text-xs font-semibold uppercase text-muted-foreground">View</p>
                  <div className="flex items-center gap-4 py-1">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Checkbox
                        id="txn-file-display-preview"
                        checked={fileDisplayMode === "preview"}
                        onCheckedChange={() => setFileDisplayMode("preview")}
                      />
                      <label htmlFor="txn-file-display-preview" className="text-sm font-medium cursor-pointer flex-1">
                        Preview
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="txn-file-display-show-all"
                        checked={fileShowAll}
                        disabled={fileDisplayMode !== "preview"}
                        onCheckedChange={(checked) => setFileShowAll(checked === true)}
                      />
                      <label
                        htmlFor="txn-file-display-show-all"
                        className={cn(
                          "whitespace-nowrap text-sm font-medium cursor-pointer",
                          fileDisplayMode !== "preview" && "cursor-not-allowed opacity-50"
                        )}
                      >
                        Show all
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 py-1">
                    <Checkbox
                      id="txn-file-display-tick"
                      checked={fileDisplayMode === "tick"}
                      onCheckedChange={() => setFileDisplayMode("tick")}
                    />
                    <label htmlFor="txn-file-display-tick" className="text-sm font-medium cursor-pointer flex-1">
                      Tick only
                    </label>
                  </div>
                  <div className="mt-2 border-t pt-2">
                    <Button type="button" size="sm" className="h-8 w-full" onClick={(e) => saveFileView(e)}>
                      Save
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </TableHead>
    );
  };
  
  // === TOTALS AND CLOSING BALANCE CONVERSION LOGIC ===
  const conversionFactor = useMemo(() => {
     if (context === 'item' && stockView === 'qty' && item) {
         return getConversionFactor(item, displayUnit);
     }
     return 1;
  }, [context, stockView, item, displayUnit]);

  // Apply conversion to totals
  // Ensure openingBalance is a valid number (handle undefined, null, NaN)
  const safeOpeningBalance = (typeof openingBalance === 'number' && !isNaN(openingBalance)) ? openingBalance : 0;
  const displayOpeningBalance = safeOpeningBalance / conversionFactor;
  const booksObScaled =
    typeof booksOpeningBalance === "number" && !isNaN(booksOpeningBalance)
      ? booksOpeningBalance / conversionFactor
      : null;
  const obOutstandingDisplay = openingBalanceOutstanding != null ? openingBalanceOutstanding / conversionFactor : null;
  const fyStartDateFilterActive =
    Boolean(ledgerDateFilterActive) && isLedgerDateFilterFromAtFyStart(company?.country, dateRange);
  // View/period opening can be 0 (e.g. date filter) while books still have a master OB — use master for Dr/Cr.
  // Statement + bill-wise: same fallback so first row is not empty when "View start" is 0 but books opening exists.
  // FY filter at FY start: never substitute master book OB — carry comes from prior FY closing snapshot.
  const authoritativeOpeningPending = periodOpeningLoading || periodOpeningUnavailable;
  const useBooksObForRowDrCr =
    !authoritativeOpeningPending &&
    !fyStartDateFilterActive &&
    (context === "party" || context === "staff" || context === "item") &&
    booksObScaled != null &&
    Math.abs(safeOpeningBalance) < 1e-7 &&
    Math.abs(booksObScaled) > 1e-7;
  // Bill-wise Book Opening only: gross books Dr/Cr + outstanding Balance. Period/FY carry rows use running balance (statement parity).
  const periodOpeningDiffersFromBooksOb =
    booksObScaled != null && Math.abs(safeOpeningBalance - booksObScaled) > 1e-7;
  const useGrossBooksForBillWiseObRow =
    !fyStartDateFilterActive &&
    !hasFyOpeningRowsInLedger &&
    isBillWiseMode &&
    (context === "party" || context === "staff") &&
    openingBalanceOutstanding != null &&
    booksObScaled != null &&
    Math.abs(booksObScaled) > 1e-7 &&
    !periodOpeningDiffersFromBooksOb;
  const displayOpeningForDrCr = useGrossBooksForBillWiseObRow
    ? booksObScaled!
    : useBooksObForRowDrCr
      ? booksObScaled!
      : displayOpeningBalance;
  const obSignIsNonNegative =
    !fyStartDateFilterActive &&
    isBillWiseMode &&
    (context === "party" || context === "staff") &&
    obOutstandingDisplay != null &&
    booksObScaled != null
      ? booksObScaled >= 0
      : Math.abs(safeOpeningBalance) > 1e-7
        ? safeOpeningBalance >= 0
        : booksObScaled != null && Math.abs(booksObScaled) > 1e-7
          ? booksObScaled >= 0
          : safeOpeningBalance >= 0;
  // Bill-wise party/staff: opening row Balance = remaining on opening (unpaid on OB). Other ledgers
  // (tax, bank, expense, item, …) always use period ledger opening — never the bill-wise outstanding field.
  const useOutstandingForOpeningRowBalance =
    !fyStartDateFilterActive &&
    !hasFyOpeningRowsInLedger &&
    isBillWiseMode &&
    (context === "party" || context === "staff") &&
    obOutstandingDisplay != null &&
    !periodOpeningDiffersFromBooksOb;
  // Statement: when period opening is 0, Balance column = books opening (brought in via displayOpeningForDrCr).
  const displayOpeningBalanceForRow = useOutstandingForOpeningRowBalance
    ? (obSignIsNonNegative ? obOutstandingDisplay! : -obOutstandingDisplay!)
    : useBooksObForRowDrCr && !isBillWiseMode
      ? displayOpeningForDrCr
      : displayOpeningBalance;
  /** Bill-wise Book Opening = master form OB only; txn outstanding stays on txn rows (not summed into this row). */
  const billWiseDatedOpeningBalance = displayOpeningBalanceForRow;
  const billWiseDatedOpeningDrCr = signedToOpeningDrCr(
    shouldUseOutstandingBalance ? billWiseDatedOpeningBalance : displayOpeningForDrCr
  );
  const obAmount = Math.abs(displayOpeningForDrCr);
  const obStatusLabel = obOutstandingDisplay != null
    ? (obOutstandingDisplay <= 0 ? "Paid" : obOutstandingDisplay >= obAmount ? "Unpaid" : "Partial")
    : null;
  const displayOpeningBalanceDr = displayOpeningForDrCr > 0 ? displayOpeningForDrCr : 0;
  const displayOpeningBalanceCr = displayOpeningForDrCr < 0 ? Math.abs(displayOpeningForDrCr) : 0;
  const displayPeriodDr = periodDr / conversionFactor;
  const displayPeriodCr = periodCr / conversionFactor;
  const displayClosingBalance = closingBalance / conversionFactor;
  
  // Total includes opening balance: Dr opening balance adds to Debit total, Cr opening balance adds to Credit total
  const displayTotalDr = (displayPeriodDr || 0) + displayOpeningBalanceDr;
  const displayTotalCr = (displayPeriodCr || 0) + displayOpeningBalanceCr;
  /** Hide opening Dr/Cr from footer + running balance chain (User column toggle). */
  const datedOpeningAmountVisible = isLedgerOpeningAmountVisible(LEDGER_OB_DATED_KEY);
  const bookOpeningAmountVisible = isLedgerOpeningAmountVisible(LEDGER_OB_BOOK_KEY);

  // Ledger contexts: Type pill — master books OB = "Book Opening"; pagination/date-filter carry = "Dated Opening".
  const ledgerOpeningPillsEnabled =
    typeof ledgerDateFilterActive === "boolean" &&
    ["party", "account", "staff", "tax", "item", "expense", "group"].includes(context);
  const BOOK_OB_EPS = SHARED_BOOK_OB_EPS;
  const masterBookSignedScaled = booksObScaled ?? 0;
  const billWiseBookOpeningBalance = useOutstandingForOpeningRowBalance
    ? displayOpeningBalanceForRow
    : masterBookSignedScaled;
  const billWiseBookOpeningDrCr = signedToOpeningDrCr(billWiseBookOpeningBalance);
  const bookRowOpeningDr = useOutstandingForOpeningRowBalance
    ? billWiseBookOpeningDrCr.debit
    : masterBookSignedScaled > 0
      ? masterBookSignedScaled
      : 0;
  const bookRowOpeningCr = useOutstandingForOpeningRowBalance
    ? billWiseBookOpeningDrCr.credit
    : masterBookSignedScaled < 0
      ? Math.abs(masterBookSignedScaled)
      : 0;
  /** Spend-wise dated opening row — statement period carry (Book Opening row alag stacked row me books OB). */
  const spendWiseDatedOpeningRowSigned = displayOpeningForDrCr;
  const spendWiseBookOpeningRowDr = shouldUseOutstandingBalance
    ? billWiseDatedOpeningDrCr.debit
    : displayOpeningBalanceDr;
  const spendWiseBookOpeningRowCr = shouldUseOutstandingBalance
    ? billWiseDatedOpeningDrCr.credit
    : displayOpeningBalanceCr;
  const spendWiseBookOpeningBalanceForRow = shouldUseOutstandingBalance
    ? billWiseDatedOpeningBalance
    : displayOpeningBalanceForRow;

  // Footer Formatters (Same Logic as Row). When balance is 0 show "Settled" (opening row + closing balance).
  const formatFooterBalance = (value: number) => {
    if (isBalanceMasked) return '*****';
    if (typeof value !== 'number' || isNaN(value)) return '-';
    const isItemQty = context === 'item' && stockView === 'qty';
    if (isItemQty) {
      if (Math.abs(value) < 1e-6) return <span className="font-bold text-green-700">Settled</span>;
      return `${formatQuantity(value)} ${displayUnit || ''}`;
    }
    if (Math.abs(value) < 1e-6) return <span className="font-bold text-green-700">Settled</span>;
    const absValue = Math.abs(value);
    const suffix = value >= 0 ? "Dr" : "Cr";
    return (
      <span className={cn("font-bold", value >= 0 ? "text-green-700" : "text-red-700")}>
        {formatCurrency(absValue, { noSuffix: true, context: 'transaction' })} {suffix}
      </span>
    );
  };

  const formatOpeningRowBalanceCell = (value: number, amountVisible: boolean) => {
    if (Math.abs(value) < 1e-6) return formatFooterBalance(0);
    return amountVisible ? formatFooterBalance(value) : "-";
  };
  
  const formatFooterAmount = (val: number) => {
      if (val === 0 || (typeof val === 'number' && isNaN(val))) return '-';
      if (context === 'item' && stockView === 'qty') {
          return `${formatQuantity(val)} ${displayUnit || ''}`;
      }
      return getDisplayValue(val);
  }

  // File column: `usePermissions` local/SQLite company par plan cache miss ya "basic" par bhi `canAddFileImagePdf` boost karta hai — seedha plan se mat lo
  const { can, canAddFileImagePdf, canDeleteVoucher } = usePermissions();
  const showFileColumn = canAddFileImagePdf === true;
  const showCol = (key: string) =>
    isTransactionColumnVisible(visibleColumns, key);
  const showFileBySelection = showFileColumn && showCol("file");
  const filesTickEnabled = Boolean(
    companyId?.trim() && isOnlineCompanyAttachmentFilesTickEnabled(companyId)
  );
  /** Dashboard Recent: current FY auto thumb only. Online + Files tick: same FY rule. */
  const dashboardRecentFyAttachmentGate = Boolean(hideFooter && context === "daybook");
  const tableBottomBorderCn = dashboardRecentFyAttachmentGate
    ? "border-b-0"
    : "border-b-2 border-border";
  const tableScrollBottomBorderCn = dashboardRecentFyAttachmentGate
    ? "border-b-0"
    : "border-b-2 border-border";
  /** Online + Files tick ON: auto warm current FY only; prior FY = click/hover grant. */
  // Pocket Ledger Server (PocketBase) companies: all files are pulled to this device, so there is no
  // "older FY loads on click" rule - every row's file shows as soon as it is on screen.
  const pbCompanyNoFyAttachmentGate = isPocketBaseCompany(companyId, company);
  const restrictAutoLoadToCurrentFy =
    !pbCompanyNoFyAttachmentGate &&
    (dashboardRecentFyAttachmentGate ||
      (filesTickEnabled && companyUsesOnlineSelectorSyncTicks(company)));
  const dateCols = dateSystem === "Both" ? 2 : 1;
  const userCol = context === 'note' ? 0 : 1;
  const fileCol = showFileBySelection ? 1 : 0;
  const isItemPartyContext = context === "item" || (context === "group" && groupEntityType === "item");
  // Item/Item-group Party column count should follow page-level visibility toggle.
  const syncStatusCol = showCol("syncStatus") ? 1 : 0;
  const baseCols = syncStatusCol + dateCols + 2 + userCol + fileCol + (context === 'daybook' ? 1 : 0) + (isItemPartyContext && showItemPartyColumn ? 1 : 0);
  const debitCol = hideDebitColumn ? 0 : 1;
  const creditCol = hideCreditColumn ? 0 : 1;
  // Hide status column in statement view (bill-wise only shows per-bill status)
  const hideStatusColumn = resolvedBalanceMode === "statement";
  const statusCol = hideStatusColumn ? 0 : 1;

  const visibleDateCols = visibleColumns != null ? (showCol("date") ? dateCols : 0) : dateCols;
  const visibleTdsCols =
    visibleColumns != null
      ? (showCol("tdsTaxable") ? 1 : 0) + (showCol("tdsAmount") ? 1 : 0)
      : 0;
  const visibleBaseCols = visibleColumns != null
    ? (showCol("syncStatus") ? 1 : 0) +
      (showCol("date") ? dateCols : 0) +
      (showCol("type") ? 1 : 0) +
      (showCol("voucherNo") ? 1 : 0) +
      (context === "daybook" ? 1 : 0) +
      (isItemPartyContext && showItemPartyColumn ? 1 : 0) +
      (showCol("user") && context !== "note" ? 1 : 0) +
      (showFileBySelection ? 1 : 0) +
      visibleTdsCols
    : baseCols;
  const visibleDebitCol = visibleColumns != null ? (showCol("dr") && !hideDebitColumn ? 1 : 0) : debitCol;
  const visibleCreditCol = visibleColumns != null ? (showCol("cr") && !hideCreditColumn ? 1 : 0) : creditCol;
  const visibleStatusCol = visibleColumns != null ? (showCol("status") && !hideStatusColumn ? 1 : 0) : statusCol;
  const visibleBalanceCol = visibleColumns != null ? (showCol("runningBalance") && !hideBalanceColumn ? 1 : 0) : (hideBalanceColumn ? 0 : 1);

  const openingBalanceColSpan = visibleBaseCols + (context === 'note' ? 1 : 0);
  const hasTdsLedgerFooterCols = showCol("tdsTaxable") || showCol("tdsAmount");
  /** Closing card spans every column before Balance (matches body / FY partition col slots). */
  const footerClosingLabelColSpan =
    openingBalanceColSpan + visibleDebitCol + visibleCreditCol + visibleStatusCol;
  const fullRowColSpan = openingBalanceColSpan + visibleDebitCol + visibleCreditCol + visibleStatusCol + visibleBalanceCol + 1;
  const fiscalPartitionColumnLayout = useMemo(
    () => ({
      leadingColSpan: openingBalanceColSpan,
      showDebit: visibleDebitCol > 0,
      showCredit: visibleCreditCol > 0,
      showStatus: visibleStatusCol > 0,
      showBalance: visibleBalanceCol > 0,
      trailingMenuCol: 1,
    }),
    [openingBalanceColSpan, visibleDebitCol, visibleCreditCol, visibleStatusCol, visibleBalanceCol]
  );
  const openingBalanceNarrationTrimmed = (openingBalanceNarration ?? "").trim();
  /** Main OB `<tr>` aur narration `<tr>` ke beech double border na ho */
  const hasOpeningBalanceNarrationSubRow = showNarration && Boolean(openingBalanceNarrationTrimmed);
  /** Firestore Timestamp | Date | string — entity form ki "As on" date */
  const openingBalanceRowDate = useMemo(() => normalizeLedgerObDateField(openingBalanceDate), [openingBalanceDate]);
  /** Date filter start — period-carry row ki Date column (BS/AD) */
  const periodOpeningRowDate = useMemo(
    () => normalizeLedgerObDateField(openingBalancePeriodStartDate),
    [openingBalancePeriodStartDate]
  );
  /** Form "As on" range ke andar ho to stacked master row + dated row; bahar ho to sirf ek OB row. */
  const masterOpeningDateWithinLedgerRange = useMemo(
    () => isMasterOpeningDateInLedgerQueryRange(dateRange, openingBalanceRowDate),
    [dateRange, openingBalanceRowDate]
  );
  // "All" preset still sets from→to — stack only when period carry ≠ books OB (pre-filter txs cut).
  const showBookOpeningAboveDatedRow =
    ledgerOpeningPillsEnabled &&
    shouldStackBookOpeningAboveDatedRow({
      ledgerDateFilterActive: Boolean(ledgerDateFilterActive),
      ledgerShowBookOpeningRow,
      booksOpeningBalance: booksObScaled,
      periodOpeningBalance: displayOpeningBalance,
      masterOpeningDateWithinLedgerRange,
    });
  const datedOpeningHiddenSigned = datedOpeningAmountVisible ? 0 : displayOpeningBalance;
  const bookOpeningHiddenSigned =
    bookOpeningAmountVisible || !showBookOpeningAboveDatedRow
      ? 0
      : shouldUseOutstandingBalance
        ? billWiseBookOpeningBalance
        : masterBookSignedScaled;
  const ledgerHiddenOpeningSignedTotal = useMemo(() => {
    let total = datedOpeningHiddenSigned + bookOpeningHiddenSigned;
    for (const row of fyPatchedLedgerRows) {
      if (row?.type !== FY_OPENING_ROW_TYPE) continue;
      const key = ledgerFyOpeningAmountKey(String((row as { id?: string }).id || ""));
      if (!hiddenOpeningAmountKeys.has(key)) continue;
      total += signedFyOpeningRowAmount(row, shouldUseOutstandingBalance);
    }
    return total;
  }, [
    fyPatchedLedgerRows,
    hiddenOpeningAmountKeys,
    datedOpeningHiddenSigned,
    bookOpeningHiddenSigned,
    shouldUseOutstandingBalance,
  ]);
  const ledgerTableRows = useMemo(() => {
    if (!LEDGER_OPENING_HIDE_AMOUNT_ENABLED) return fyPatchedLedgerRows;
    return applyHiddenLedgerOpeningAmountAdjustments(fyPatchedLedgerRows, {
      hiddenKeys: hiddenOpeningAmountKeys,
      fyOpeningKey: ledgerFyOpeningAmountKey,
      datedOpeningHiddenSigned,
      bookOpeningHiddenSigned,
      billWisePartyStaff: shouldUseOutstandingBalance,
    });
  }, [
    fyPatchedLedgerRows,
    hiddenOpeningAmountKeys,
    datedOpeningHiddenSigned,
    bookOpeningHiddenSigned,
    shouldUseOutstandingBalance,
  ]);
  const displayLedgerRows = useMemo(
    () =>
      billWiseLinkPreviewEnabled
        ? applyBillWiseLinkPreviewGrouping(ledgerTableRows, billWiseLinkPreview)
        : ledgerTableRows,
    [ledgerTableRows, billWiseLinkPreview, billWiseLinkPreviewEnabled]
  );

  const rowsForRender = displayLedgerRows;
  const enforceCurrentFyAttachmentAutoLoad = dashboardRecentFyAttachmentGate && !pbCompanyNoFyAttachmentGate;
  const attachmentWarmSourceRows = tableTransactions;
  const dashboardRecentPagedList =
    hideFooter && context === "daybook";
  const visibleAttachmentUrls = useMemo(() => {
    const urls: string[] = [];
    const allowRowAutoWarm = (rowDate: unknown) => {
      if (!restrictAutoLoadToCurrentFy) return true;
      return shouldAutoWarmAttachmentForLedgerRow(company?.country, rowDate, true);
    };
    if (showFileBySelection && Array.isArray(attachmentWarmSourceRows)) {
      for (const row of attachmentWarmSourceRows as any[]) {
        if (row?._fiscalPartitionRow || row?._fyOpeningRow) continue;
        if (!allowRowAutoWarm(row?.date)) continue;
        for (const url of getVoucherAttachmentUrlsForUi(row, voucherAttachmentUiOpts)) {
          if (url) urls.push(url);
        }
      }
    }
    if (showFileBySelection && Array.isArray(openingBalanceAttachmentUrls)) {
      const obRaw = openingBalanceDate as
        | { toDate?: () => Date }
        | Date
        | string
        | number
        | null
        | undefined;
      const obDate =
        obRaw && typeof obRaw === "object" && typeof (obRaw as { toDate?: () => Date }).toDate === "function"
          ? (obRaw as { toDate: () => Date }).toDate()
          : obRaw instanceof Date
            ? obRaw
            : obRaw != null && obRaw !== ""
              ? new Date(obRaw as string | number)
              : null;
      if (allowRowAutoWarm(obDate)) {
        for (const candidate of openingBalanceAttachmentUrls) {
          const url = String(candidate ?? "").trim();
          if (url) urls.push(url);
        }
      }
    }
    return urls;
  }, [
    showFileBySelection,
    attachmentWarmSourceRows,
    openingBalanceAttachmentUrls,
    openingBalanceDate,
    company?.country,
    restrictAutoLoadToCurrentFy,
    voucherAttachmentUiOpts,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const warmCompanyId = companyId?.trim() || undefined;
    setVisiblePageAttachmentUrls(warmCompanyId, visibleAttachmentUrls);
    if (visibleAttachmentUrls.length === 0) return;
    if (warmCompanyId && !isOnlineCompanyAttachmentFilesTickEnabled(warmCompanyId)) {
      if (!dashboardRecentFyAttachmentGate) return;
    }
    updateAttachmentPrefetchPriorityFromVisibleRows(visibleAttachmentUrls);
    const warmMaxUrls = dashboardRecentPagedList ? 56 : 220;
    const browserWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const ac = new AbortController();
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const runWarm = () => {
      if (shouldSkipVisibleRowFullIdlePrewarmOnWeb(company)) return;
      void prewarmHoverPreviewHttpsUrls(visibleAttachmentUrls, {
        signal: ac.signal,
        maxUrls: warmMaxUrls,
        companyId: warmCompanyId,
      });
      void prewarmVisibleAttachmentRefsForInstantOpen(visibleAttachmentUrls, {
        signal: ac.signal,
        maxUrls: warmMaxUrls,
        companyId: warmCompanyId,
      });
    };
    if (typeof browserWindow.requestIdleCallback === "function") {
      idleHandle = browserWindow.requestIdleCallback(runWarm, { timeout: 450 });
    } else {
      timeoutHandle = globalThis.setTimeout(runWarm, 80);
    }
    return () => {
      ac.abort();
      if (idleHandle != null && typeof browserWindow.cancelIdleCallback === "function") {
        browserWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) globalThis.clearTimeout(timeoutHandle);
    };
  }, [visibleAttachmentUrls, companyId, filesTickEpoch, dashboardRecentPagedList, dashboardRecentFyAttachmentGate, company]);

  const handleBillWiseStatusLinkedVoucherClick = useCallback(
    (transaction: any, voucherNo: string) => {
      if (!billWiseLinkPreviewEnabled) return;
      const anchorRowId = ledgerRowStableId(transaction);
      const no = String(voucherNo || "").trim();
      if (!anchorRowId || !no) return;
      setBillWiseLinkPreview((prev) =>
        prev?.anchorRowId === anchorRowId && prev.linkedVoucherNo === no
          ? null
          : { anchorRowId, linkedVoucherNo: no }
      );
    },
    [billWiseLinkPreviewEnabled]
  );
  const getBillWiseLinkPreviewRowProps = useCallback(
    (t: any) => {
      if (!billWiseLinkPreviewEnabled) return {};
      const id = ledgerRowStableId(t);
      if (!id || id !== billWiseLinkPreview?.anchorRowId) return {};
      return {
        onStatusLinkedVoucherClick: (voucherNo: string) =>
          handleBillWiseStatusLinkedVoucherClick(t, voucherNo),
        statusLinkedVoucherPreviewActive: billWiseLinkPreview?.linkedVoucherNo ?? null,
      };
    },
    [billWiseLinkPreviewEnabled, billWiseLinkPreview, handleBillWiseStatusLinkedVoucherClick]
  );
  const footerTotalDr = useMemo(() => {
    let dr = displayPeriodDr || 0;
    if (datedOpeningAmountVisible) dr += displayOpeningBalanceDr;
    if (showBookOpeningAboveDatedRow && bookOpeningAmountVisible) dr += bookRowOpeningDr;
    return dr;
  }, [
    displayPeriodDr,
    datedOpeningAmountVisible,
    displayOpeningBalanceDr,
    showBookOpeningAboveDatedRow,
    bookOpeningAmountVisible,
    bookRowOpeningDr,
  ]);
  const footerTotalCr = useMemo(() => {
    let cr = displayPeriodCr || 0;
    if (datedOpeningAmountVisible) cr += displayOpeningBalanceCr;
    if (showBookOpeningAboveDatedRow && bookOpeningAmountVisible) cr += bookRowOpeningCr;
    return cr;
  }, [
    displayPeriodCr,
    datedOpeningAmountVisible,
    displayOpeningBalanceCr,
    showBookOpeningAboveDatedRow,
    bookOpeningAmountVisible,
    bookRowOpeningCr,
  ]);
  const footerClosingBalance = LEDGER_OPENING_HIDE_AMOUNT_ENABLED
    ? displayClosingBalance - ledgerHiddenOpeningSignedTotal
    : displayClosingBalance;

  const footerTdsTaxableTotal = useMemo(() => {
    let sum = 0;
    for (const t of transactions) {
      const row = t as { type?: string; _tdsTaxable?: unknown; [LEDGER_TDS_ROW_FLAG]?: boolean };
      if (!row[LEDGER_TDS_ROW_FLAG] && row.type !== "tds") continue;
      sum += Number(row._tdsTaxable) || 0;
    }
    return sum;
  }, [transactions]);

  const footerTdsAmountTotal = useMemo(() => {
    let sum = 0;
    for (const t of transactions) {
      const row = t as { type?: string; _tdsAmount?: unknown; [LEDGER_TDS_ROW_FLAG]?: boolean };
      if (!row[LEDGER_TDS_ROW_FLAG] && row.type !== "tds") continue;
      sum += Number(row._tdsAmount) || 0;
    }
    return sum;
  }, [transactions]);
  /** Stacked / single dated row: master book pill vs period/pagination carry pill. */
  const bookOpeningRowPillText = ledgerOpeningPillsEnabled ? "Book Opening" : openingBalanceLabel;
  const entitySnapshotOpening = useMemo(
    () => extractEntityBalanceFromFySnapshot(fy.openingBalances, contextId),
    [fy.openingBalances, contextId]
  );
  const topLedgerOpeningPillKind = useMemo(
    () =>
      resolveTopLedgerOpeningPillKind({
        ledgerDateFilterActive: Boolean(ledgerDateFilterActive),
        ledgerShowBookOpeningRow: Boolean(ledgerShowBookOpeningRow),
        booksOpeningBalance: booksObScaled,
        periodOpeningBalance: displayOpeningBalance,
        masterOpeningDateWithinLedgerRange,
        dateRange,
        country: company?.country,
        fyScopeEnabled: fy.enabled,
        activeScope: fy.activeScope,
        entitySnapshotOpening,
      }),
    [
      ledgerDateFilterActive,
      ledgerShowBookOpeningRow,
      booksObScaled,
      displayOpeningBalance,
      masterOpeningDateWithinLedgerRange,
      dateRange,
      company?.country,
      fy.enabled,
      fy.activeScope,
      entitySnapshotOpening,
    ]
  );
  const fyOpeningPillDate = useMemo(() => {
    if (topLedgerOpeningPillKind !== "fy") return null;
    if (ledgerDateFilterActive && isLedgerDateFilterFromAtFyStart(company?.country, dateRange)) {
      return periodOpeningRowDate;
    }
    if (fy.activeScope?.fyFloorMs) {
      return normalizeLedgerObDateField(new Date(fy.activeScope.fyFloorMs));
    }
    return null;
  }, [
    topLedgerOpeningPillKind,
    ledgerDateFilterActive,
    company?.country,
    dateRange,
    periodOpeningRowDate,
    fy.activeScope?.fyFloorMs,
  ]);
  /** Dated row pill — stacked mode me hamesha; single row me Book/FY/Dated per FY pagination rules. */
  const primaryOpeningRowPillText = ledgerOpeningPillsEnabled
    ? showBookOpeningAboveDatedRow
      ? "Dated Opening"
      : topLedgerOpeningPillKind === "fy" && fyOpeningPillDate
        ? buildFyPartitionOpeningPillLabel(
            company,
            fyOpeningPillDate instanceof Date ? fyOpeningPillDate : new Date(fyOpeningPillDate)
          )
        : ledgerOpeningPillLabel(topLedgerOpeningPillKind)
    : openingBalanceLabel;
  const datedOpeningRowLabel = periodOpeningLoading
    ? "Loading opening…"
    : periodOpeningUnavailable
      ? "Opening unavailable"
      : primaryOpeningRowPillText;
  const showDatedOpeningAmounts = datedOpeningAmountVisible && !authoritativeOpeningPending;

  /** Narration sub-row: date se credit tak — `transactionTableShared` colsThroughCredit jaisa */
  const openingBalanceNarrationColSpan =
    visibleColumns == null
      ? dateCols +
        (showCol("syncStatus") ? 1 : 0) +
        2 +
        (context === "daybook" ? 1 : 0) +
        (isItemPartyContext && showItemPartyColumn ? 1 : 0) +
        userCol +
        fileCol +
        visibleDebitCol +
        visibleCreditCol
      : (showCol("syncStatus") ? 1 : 0) +
        (showCol("date") ? dateCols : 0) +
        (showCol("type") ? 1 : 0) +
        (showCol("voucherNo") ? 1 : 0) +
        (context === "daybook" ? 1 : 0) +
        (isItemPartyContext && showItemPartyColumn ? 1 : 0) +
        (showCol("user") && context !== "note" ? 1 : 0) +
        (showFileBySelection ? 1 : 0) +
        visibleTdsCols +
        visibleDebitCol +
        visibleCreditCol;

  const showOpeningBalance = ["party", "account", "staff", "tax", "item", "expense", "group"].includes(context);
  /** Bill-wise party/staff: no master OB in form → hide bogus "Book Opening" row (txns carry bill-wise balance). */
  const hideBillWiseBookOpeningWithNoMasterOb =
    shouldUseOutstandingBalance &&
    !ledgerDateFilterActive &&
    !showBookOpeningAboveDatedRow &&
    Math.abs(masterBookSignedScaled) < BOOK_OB_EPS &&
    !useOutstandingForOpeningRowBalance;
  const showLedgerOpeningRows =
    showOpeningBalance && !hideLedgerOpeningRows && !hideBillWiseBookOpeningWithNoMasterOb;

  const debitHeaderLabel =
    debitColumnHeaderLabel ?? (stockView === "amount" ? "Debit" : "In");
  const creditHeaderLabel =
    creditColumnHeaderLabel ?? (stockView === "amount" ? "Credit" : "Out");

  const hasTdsLedgerColsForLayout = showCol("tdsTaxable") || showCol("tdsAmount");
  const tdsLedgerTableLayout = hasTdsLedgerColsForLayout;
  const ledgerDateBsColMinPx =
    LEDGER_ENTITY_DATE_BS_COL_PX +
    (showCol("date") && dateSystem === "Both" ? LEDGER_BOTH_DATE_BS_AD_GAP_PX : 0);
  const ledgerEntryTimeDateColPx =
    hasTdsLedgerColsForLayout || dashboardRecentFyAttachmentGate
      ? LEDGER_TDS_DATE_COL_PX
      : 112 +
        (showCol("date") && showCol("type") ? LEDGER_ENTRY_TIME_TO_TYPE_MIN_GAP_PX : 0);
  const ledgerLastDateColMinPx = ledgerEntryTimeDateColPx;

  // Prevent header/amount overlap — opening row cells helpers
  const ensureMinGaps = true;
  const ledgerBalanceColStyle = { minWidth: LEDGER_ENTITY_BALANCE_COL_PX };

  /** Dated row Date column: filter from, ya page 2+ continuation (openingBalancePeriodStartDate); Book row = master OB date. */
  const datedOpeningBalanceRowDate = useMemo(() => {
    if (ledgerOpeningPillsEnabled && topLedgerOpeningPillKind === "fy") {
      if (ledgerDateFilterActive && isLedgerDateFilterFromAtFyStart(company?.country, dateRange)) {
        return periodOpeningRowDate;
      }
      if (fy.activeScope?.fyFloorMs) {
        return normalizeLedgerObDateField(new Date(fy.activeScope.fyFloorMs));
      }
    }
    if (ledgerOpeningPillsEnabled && ledgerDateFilterActive) {
      return periodOpeningRowDate;
    }
    if (ledgerOpeningPillsEnabled && !ledgerShowBookOpeningRow && periodOpeningRowDate) {
      return periodOpeningRowDate;
    }
    if (ledgerOpeningPillsEnabled && topLedgerOpeningPillKind === "dated" && periodOpeningRowDate) {
      return periodOpeningRowDate;
    }
    return openingBalanceRowDate;
  }, [
    ledgerOpeningPillsEnabled,
    topLedgerOpeningPillKind,
    fy.activeScope?.fyFloorMs,
    ledgerDateFilterActive,
    ledgerShowBookOpeningRow,
    periodOpeningRowDate,
    openingBalanceRowDate,
    company?.country,
    dateRange,
  ]);

  /** Opening row dates — normal transaction row jaisa */
  const renderOpeningBalanceDateCells = (rowDate: Date | null) => (
    <>
      {showCol("syncStatus") && <TableCell className={cn("text-center align-top", ensureMinGaps && "min-w-[78px] px-[5px]")}>-</TableCell>}
      {showOpeningBalance && showLedgerOpeningRows && showCol("date") ? (
        dateSystem === "Both" ? (
          <>
            <TableCell
              className={cn(
                "align-top",
                ensureMinGaps &&
                  (dateSystem === "Both" ? LEDGER_BOTH_DATE_BS_CELL_PAD_CN : "min-w-[95px] px-[5px]")
              )}
              style={
                ensureMinGaps && dateSystem === "Both" ? { minWidth: `${ledgerDateBsColMinPx}px` } : undefined
              }
            >
              {rowDate ? formatDateBS(rowDate) : ""}
            </TableCell>
            <TableCell
              className={cn(
                "align-top",
                ensureMinGaps &&
                  (hasTdsLedgerColsForLayout && showCol("type")
                    ? LEDGER_TDS_LAST_DATE_CELL_PAD_CN
                    : "min-w-[95px] px-[5px]")
              )}
              style={
                ensureMinGaps && hasTdsLedgerColsForLayout && showCol("type")
                  ? { minWidth: `${ledgerLastDateColMinPx}px` }
                  : undefined
              }
            >
              {rowDate ? formatDate(rowDate) : ""}
            </TableCell>
          </>
        ) : (
          <TableCell
            className={cn(
              "align-top",
              ensureMinGaps &&
                (hasTdsLedgerColsForLayout && showCol("type")
                  ? LEDGER_TDS_LAST_DATE_CELL_PAD_CN
                  : "min-w-[95px] px-[5px]")
            )}
            style={
              ensureMinGaps && hasTdsLedgerColsForLayout && showCol("type")
                ? { minWidth: `${ledgerLastDateColMinPx}px` }
                : undefined
            }
          >
            {rowDate ? (dateSystem === "AD" ? formatDate(rowDate) : formatDateBS(rowDate)) : ""}
          </TableCell>
        )
      ) : null}
    </>
  );

  const renderOpeningBalanceMiddleCells = (
    pillLabel: string,
    showSearchSlot: boolean,
    drCrSide: TxnDrCrSide
  ) => (
    <>
      {showCol("type") && (
        <TableCell
          className={cn("align-middle overflow-visible", ensureMinGaps && "px-[5px]")}
          style={
            ensureMinGaps
              ? {
                  minWidth: hasSpendWiseGroups
                    ? Math.max(SPEND_WISE_TYPE_COL_PX, LEDGER_ENTITY_TYPE_COL_PX)
                    : LEDGER_ENTITY_TYPE_COL_PX,
                }
              : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {showSearchSlot ? openingBalanceLeftContent : null}
            {showSearchSlot ? openingBalanceSearch : null}
            <Badge variant="outline" className={voucherTypePillClassName(drCrSide)}>
              {pillLabel}
            </Badge>
          </div>
        </TableCell>
      )}
      {showCol("voucherNo") && (
        <TableCell className={ensureMinGaps ? cn("min-w-[105px]", LEDGER_TXN_BODY_CELL_PAD_CN) : undefined} />
      )}
      {context === "daybook" && <TableCell className="max-w-[200px] truncate" />}
      {isItemPartyContext && showItemPartyColumn && (
        <TableCell className="max-w-[180px] truncate text-muted-foreground" />
      )}
    </>
  );

  const renderOpeningBalanceUserCell = () =>
    showCol("user") && context !== "note" ? (
      <TableCell className={ensureMinGaps ? "min-w-[148px] px-[5px] align-top" : "align-top"} />
    ) : null;

  const renderOpeningBalanceTdsCells = () => (
    <>
      {showCol("tdsTaxable") && (
        <TableCell
          className={ensureMinGaps ? LEDGER_TDS_TAXABLE_CELL_PAD_CN : undefined}
          style={ensureMinGaps ? { minWidth: `${LEDGER_TDS_TAXABLE_COL_PX}px` } : undefined}
        />
      )}
      {showCol("tdsAmount") && (
        <TableCell
          className={ensureMinGaps ? LEDGER_TDS_AMOUNT_CELL_PAD_CN : undefined}
          style={ensureMinGaps ? { minWidth: `${LEDGER_TDS_AMOUNT_COL_PX}px` } : undefined}
        />
      )}
    </>
  );

  const renderOpeningBalanceDrCrCell = (
    side: "dr" | "cr",
    drAmount: number,
    crAmount: number,
    rowKey: string
  ): React.ReactNode => {
    const amount = side === "dr" ? drAmount : crAmount;
    const rowVisible = isLedgerOpeningAmountVisible(rowKey);
    if (!rowVisible) {
      if (!LEDGER_OPENING_HIDE_AMOUNT_ENABLED) {
        return side === "dr" ? formatFooterAmount(amount) : "-";
      }
      return side === "dr" ? (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
          onClick={(e) => toggleLedgerOpeningAmountVisible(rowKey, e)}
        >
          Show Amount
        </button>
      ) : (
        "-"
      );
    }
    if (amount > 0) return formatFooterAmount(amount);
    const showHideToggle =
      (side === "cr" && drAmount > 0) ||
      (side === "dr" && crAmount > 0) ||
      (side === "dr" && drAmount <= 0 && crAmount <= 0);
    if (showHideToggle && LEDGER_OPENING_HIDE_AMOUNT_ENABLED) {
      return (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
          onClick={(e) => toggleLedgerOpeningAmountVisible(rowKey, e)}
        >
          Hide Amount
        </button>
      );
    }
    return "-";
  };

  /** Bill-wise OB linked voucher detail — narration sub-row ya alag linked-only row par */
  const hasObLinkedVoucherDetail =
    isBillWiseMode && showNarration && (openingBalanceLinkedVoucherNos?.length ?? 0) > 0;
  /** Dated OB row ke turant baad narration ya bill-wise linked sub-row — beech ki horizontal line hide */
  const hideDatedOpeningRowBottomBeforeSubRow =
    (hasOpeningBalanceNarrationSubRow && !showBookOpeningAboveDatedRow) || hasObLinkedVoucherDetail;
  const hideBookOpeningRowBottomBeforeSubRow =
    showBookOpeningAboveDatedRow && hasOpeningBalanceNarrationSubRow;

  const openingBalanceNarrationRow = (embeddedInGroupCard = false) =>
    hasOpeningBalanceNarrationSubRow ? (
      <tr
        data-row="opening-balance-narration"
        data-pl-spend-wise-opening={useSpendWiseOpeningBalanceCard && !embeddedInGroupCard ? "" : undefined}
        className={cn(
          "narration-row border-b",
          useSpendWiseOpeningBalanceCard && !embeddedInGroupCard && "bg-blue-50/50 dark:bg-blue-950/20",
          /* OB main row + narration ke beech `TableCell` p-1 gap — tight */
          "[&>td]:!pt-0 [&>td]:!pb-0 [&>td]:border-t-0"
        )}
      >
        <TableCell
          colSpan={openingBalanceNarrationColSpan}
          className={cn(
            "px-3 text-[11px] italic leading-tight align-top whitespace-normal break-words w-full min-w-0 overflow-hidden text-black"
          )}
        >
          <span className="block min-w-0 overflow-hidden break-words font-normal" style={{ overflowWrap: "anywhere" }}>
            <span className="not-italic">Narration:</span>{" "}
            <span className="whitespace-pre-wrap">{openingBalanceNarrationTrimmed}</span>
          </span>
        </TableCell>
        {/* Bill-wise OB: linked vouchers Status+Balance span; warna empty status/balance cells */}
        {isBillWiseMode && hasObLinkedVoucherDetail ? (
          <BillWiseLinkedDetailCells
            vouchers={openingBalanceLinkedVoucherNos ?? []}
            billWisePink
            showStatus={showCol("status")}
            hideStatusColumn={hideStatusColumn}
            showBalance={showCol("runningBalance")}
            hideBalanceColumn={hideBalanceColumn}
            ensureMinGaps={ensureMinGaps}
          />
        ) : (
          <>
            {showCol("status") && !hideStatusColumn && (
              <TableCell className={cn("text-center align-top py-0", ensureMinGaps && "min-w-[95px] px-[5px]")} />
            )}
            {showCol("runningBalance") && !hideBalanceColumn && (
              <TableCell
                className={cn("text-right", ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN))}
                style={ledgerBalanceColStyle}
              />
            )}
          </>
        )}
        <TableCell className={cn(ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-10 p-0", "!bg-white dark:!bg-card")} />
      </tr>
    ) : null;

  const openingBalanceLinkedOnlyRow = (embeddedInGroupCard = false) =>
    hasObLinkedVoucherDetail && !hasOpeningBalanceNarrationSubRow ? (
      <tr
        data-row="opening-balance-linked"
        data-pl-spend-wise-opening={useSpendWiseOpeningBalanceCard && !embeddedInGroupCard ? "" : undefined}
        className={cn(
          "narration-row border-b",
          useSpendWiseOpeningBalanceCard && !embeddedInGroupCard && "bg-blue-50/50 dark:bg-blue-950/20",
          "[&>td]:!pt-0 [&>td]:!pb-0 [&>td]:border-t-0"
        )}
      >
        <TableCell colSpan={openingBalanceNarrationColSpan} className="py-0" />
        <BillWiseLinkedDetailCells
          vouchers={openingBalanceLinkedVoucherNos ?? []}
          billWisePink
          showStatus={showCol("status")}
          hideStatusColumn={hideStatusColumn}
          showBalance={showCol("runningBalance")}
          hideBalanceColumn={hideBalanceColumn}
          ensureMinGaps={ensureMinGaps}
        />
        <TableCell className={cn(ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-10 p-0", "!bg-white dark:!bg-card")} />
      </tr>
    ) : null;

  const isMobile = useIsMobile();
  const names = useMemo(() => ({ ...(journalAccountNames || {}), ...(userNames || {}), ...(accountNames || {}) }), [journalAccountNames, userNames, accountNames]);

  // On mobile, party/group use same card UI for both Statement and Bill wise (not PC table).
  const useMobileCardView =
    isMobile &&
    (context === "daybook" ||
      context === "account" ||
      context === "expense" ||
      context === "staff" ||
      context === "tax" ||
      context === "item" ||
      context === "party" ||
      context === "group" ||
      context === "note");
  // Bill-wise in mobile card: party, group, staff, account, tax
  const isBillWiseCardContext =
    resolvedBalanceMode === "bill_wise" &&
    (context === "party" ||
      context === "group" ||
      context === "staff" ||
      context === "account" ||
      context === "tax");
  // In party/staff/group/tax billwise view, status shows only bill-wise link voucher no (not spend-wise RCPT/PYMT/Contra).
  const statusBillWiseOnly =
    resolvedBalanceMode === "bill_wise" &&
    (context === "party" || context === "staff" || context === "group" || context === "tax");
  /** Desktop entity ledgers: fixed thead strip + body scroll (same as Dashboard Recent). */
  const ledgerDesktopSplitScrollGate = !useMobileCardView && !dashboardRecentFyAttachmentGate;
  const daybookPartyTableGate =
    Boolean(daybookDesktopUnifiedScroll && dashboardRecentFyAttachmentGate && !useMobileCardView);
  const splitScrollColProportionalGate = ledgerDesktopSplitScrollGate || daybookPartyTableGate;
  const ledgerEntityContentAutoWidth = ledgerDesktopSplitScrollGate || daybookPartyTableGate;
  const desktopSplitTableScrollGate =
    dashboardRecentFyAttachmentGate || ledgerDesktopSplitScrollGate;

  // Always run these useMemos — mobile used to return early and skip them, breaking hook order when isMobile flipped.
  const mobileBlocks = useMemo((): MobileBlock[] => {
    if (!useMobileCardView) return [];
    const blocks: MobileBlock[] = [];
    let i = 0;
    while (i < rowsForRender.length) {
      const t = rowsForRender[i] as any;
      if (t._spendWiseSpacer) {
        blocks.push({ type: "spacer" });
        i++;
        continue;
      }
      if (t._billWiseLinkPreviewGroupFirst === true) {
        const colorIndex =
          typeof t._billWiseLinkPreviewGroupColorIndex === "number" ? t._billWiseLinkPreviewGroupColorIndex : 0;
        const items: any[] = [];
        while (i < rowsForRender.length) {
          const cur = rowsForRender[i] as any;
          if (cur._spendWiseSpacer) break;
          items.push(cur);
          if (cur._billWiseLinkPreviewGroupLast === true) {
            i++;
            break;
          }
          i++;
        }
        if (items.length > 0) {
          blocks.push({ type: "group", colorIndex, items });
        }
        continue;
      }
      if (t._spendWiseGroupFirst === true) {
        const colorIndex = typeof t._spendWiseGroupColorIndex === "number" ? t._spendWiseGroupColorIndex : 0;
        const items: any[] = [];
        while (i < rowsForRender.length) {
          const cur = rowsForRender[i] as any;
          if (cur._spendWiseSpacer) break;
          items.push(cur);
          if (cur._spendWiseGroupLast === true) {
            i++;
            break;
          }
          i++;
        }
        // Mobile: single spend-wise bhi group shell — linked jaisa rounded card
        if (items.length > 0) {
          blocks.push({ type: "group", colorIndex, items });
        }
        continue;
      }
      blocks.push({ type: "single", item: t });
      i++;
    }
    return blocks;
  }, [useMobileCardView, rowsForRender]);

  const hasBillWiseLinkPreviewGroups =
    billWiseLinkPreviewEnabled && billWiseLinkPreview != null && displayLedgerRows.some((r) => r?._billWiseLinkPreviewGroupId);
  const useLedgerGroupCardLayout = hasSpendWiseGroups || hasBillWiseLinkPreviewGroups;

  const statementCheckedCols = useMemo(() => {
    let hasDr = false;
    let hasCr = false;
    if (!ledgerStatementChecked || ledgerStatementChecked.checkedIds.size === 0) return { hasDr, hasCr };
    for (const r of displayLedgerRows || []) {
      if (ledgerStatementChecked.isChecked(r)) {
        const debit = Number((r as any)?.debit) || 0;
        const credit = Number((r as any)?.credit) || 0;
        const col = statementCheckedMessageColumn(debit, credit);
        if (col === "debit") hasDr = true;
        if (col === "credit") hasCr = true;
      }
    }
    return { hasDr, hasCr };
  }, [displayLedgerRows, ledgerStatementChecked]);

  const spendWiseColWidths = useMemo((): number[] => {
    if (!useLedgerGroupCardLayout) return [];
    const w: number[] = [];
    if (showCol("syncStatus")) w.push(78);
    if (showCol("date")) {
      if (dateSystem === "Both") {
        w.push(95, 112);
      } else {
        w.push(112);
      }
    }
    if (showCol("type")) w.push(SPEND_WISE_TYPE_COL_PX);
    if (showCol("voucherNo")) w.push(105);
    if (context === "daybook") w.push(120);
    if (isItemPartyContext && showItemPartyColumn) w.push(90);
    if (showCol("user") && context !== "note") w.push(148);
    if (showFileBySelection) w.push(44);
    if (showCol("dr") && !hideDebitColumn) w.push(statementCheckedCols.hasDr ? Math.max(185, LEDGER_TDS_DR_CR_COL_PX) : 100);
    if (showCol("cr") && !hideCreditColumn) w.push(statementCheckedCols.hasCr ? Math.max(185, LEDGER_TDS_DR_CR_COL_PX) : 100);
    if (showCol("status") && !hideStatusColumn) w.push(95);
    if (showCol("runningBalance") && !hideBalanceColumn) w.push(115);
    w.push(LEDGER_TXN_ROW_MENU_COL_PX);
    return w;
  }, [
    useLedgerGroupCardLayout,
    dateSystem,
    context,
    groupEntityType,
    hideDebitColumn,
    hideCreditColumn,
    hideStatusColumn,
    hideBalanceColumn,
    showFileBySelection,
    showItemPartyColumn,
    isItemPartyContext,
    visibleColumns,
    statementCheckedCols,
  ]);

  const ledgerVoucherNoColPx = useMemo(() => {
    if (!ledgerDesktopSplitScrollGate) return LEDGER_VOUCHER_NO_COL_PX;
    if (!displayLedgerRows?.some(rowHasInterCompanyPeerPending)) return LEDGER_VOUCHER_NO_COL_PX;
    return LEDGER_VOUCHER_NO_IC_COL_PX;
  }, [ledgerDesktopSplitScrollGate, displayLedgerRows]);

  /**
   * Entity ledger desktop (party, bank, IC clearing, …): fixed cols so split thead/body
   * stay same width. Per-column mins (Type, Voucher No, User, …); wide panes scale cols
   * proportionally so 4K does not leave empty gaps between headers.
   */
  const ledgerEntityColWidths = useMemo((): number[] => {
    if (!ledgerDesktopSplitScrollGate && !(dashboardRecentFyAttachmentGate && context === "daybook")) {
      return [];
    }
    const w: number[] = [];
    if (showCol("syncStatus")) w.push(78);
    const hasTdsLedgerCols = showCol("tdsTaxable") || showCol("tdsAmount");
    const dateToTypeGapPx =
      showCol("date") && showCol("type")
        ? hasTdsLedgerCols
          ? LEDGER_TDS_DATE_TO_TYPE_GAP_PX
          : LEDGER_ENTRY_TIME_TO_TYPE_MIN_GAP_PX
        : 0;
    const entryTimeDateColPx =
      hasTdsLedgerCols || dashboardRecentFyAttachmentGate
        ? LEDGER_TDS_DATE_COL_PX
        : 112 + dateToTypeGapPx;
    const bsAdDateGap = showCol("date") && dateSystem === "Both" ? LEDGER_BOTH_DATE_BS_AD_GAP_PX : 0;
    if (showCol("date")) {
      if (dateSystem === "Both") {
        w.push(LEDGER_ENTITY_DATE_BS_COL_PX + bsAdDateGap, entryTimeDateColPx);
      } else {
        w.push(entryTimeDateColPx);
      }
    }
    const middleWidths: number[] = [];
    if (showCol("type")) {
      middleWidths.push(
        hasSpendWiseGroups
          ? Math.max(SPEND_WISE_TYPE_COL_PX, LEDGER_ENTITY_TYPE_COL_PX)
          : LEDGER_ENTITY_TYPE_COL_PX
      );
    }
    if (showCol("voucherNo")) {
      const voucherNoColPx =
        context === "daybook"
          ? Math.max(ledgerVoucherNoColPx, LEDGER_VOUCHER_NO_HEADER_COL_PX)
          : hasTdsLedgerCols
            ? Math.max(LEDGER_TDS_VOUCHER_NO_COL_PX, ledgerVoucherNoColPx)
            : ledgerVoucherNoColPx;
      middleWidths.push(voucherNoColPx);
    }
    if (context === "daybook") middleWidths.push(DAYBOOK_ACCOUNTS_COL_PX);
    if (isItemPartyContext && showItemPartyColumn) middleWidths.push(90);
    if (!hasTdsLedgerCols) {
      if (showCol("user") && context !== "note") middleWidths.push(LEDGER_ENTITY_USER_COL_PX);
      if (showFileBySelection) middleWidths.push(LEDGER_ENTITY_FILE_COL_PX);
    }
    if (middleWidths.length > 0) {
      w.push(...middleWidths);
    }
    if (hasTdsLedgerCols) {
      if (showCol("user") && context !== "note") w.push(LEDGER_ENTITY_USER_COL_PX);
      if (showFileBySelection) w.push(LEDGER_TDS_FILE_COL_PX);
    }
    if (showCol("tdsTaxable")) w.push(LEDGER_TDS_TAXABLE_COL_PX);
    if (showCol("tdsAmount")) w.push(LEDGER_TDS_AMOUNT_COL_PX);
    // TDS details: Dr/Cr race = badge/amount content width (not bare 100px).
    if (showCol("dr") && !hideDebitColumn) {
      const minDr = statementCheckedCols.hasDr ? Math.max(185, LEDGER_TDS_DR_CR_COL_PX) : hasTdsLedgerCols ? LEDGER_TDS_DR_CR_COL_PX : LEDGER_TXN_DR_CR_COL_PX;
      w.push(minDr);
    }
    if (showCol("cr") && !hideCreditColumn) {
      const minCr = statementCheckedCols.hasCr ? Math.max(185, LEDGER_TDS_DR_CR_COL_PX) : hasTdsLedgerCols ? LEDGER_TDS_DR_CR_COL_PX : LEDGER_TXN_DR_CR_COL_PX;
      w.push(minCr);
    }
    if (showCol("status") && !hideStatusColumn) w.push(95);
    if (showCol("runningBalance") && !hideBalanceColumn) w.push(LEDGER_ENTITY_BALANCE_COL_PX);
    w.push(LEDGER_TXN_ROW_MENU_COL_PX);
    return w;
  }, [
    ledgerDesktopSplitScrollGate,
    dashboardRecentFyAttachmentGate,
    dateSystem,
    context,
    hasSpendWiseGroups,
    hideDebitColumn,
    hideCreditColumn,
    hideStatusColumn,
    hideBalanceColumn,
    showFileBySelection,
    showItemPartyColumn,
    isItemPartyContext,
    visibleColumns,
    statementCheckedCols,
    ledgerVoucherNoColPx,
  ]);

  const ledgerEntityColKeys = useMemo((): string[] => {
    if (!ledgerDesktopSplitScrollGate && !(dashboardRecentFyAttachmentGate && context === "daybook")) {
      return [];
    }
    const keys: string[] = [];
    if (showCol("syncStatus")) keys.push("syncStatus");
    if (showCol("date")) {
      if (dateSystem === "Both") keys.push("date_bs", "date_ad");
      else keys.push("date");
    }
    if (showCol("type")) keys.push("type");
    if (showCol("voucherNo")) keys.push("voucherNumber");
    if (context === "daybook") keys.push("accounts");
    if (isItemPartyContext && showItemPartyColumn) keys.push("itemParty");
    const hasTdsLedgerCols = showCol("tdsTaxable") || showCol("tdsAmount");
    if (!hasTdsLedgerCols) {
      if (showCol("user") && context !== "note") keys.push("user");
      if (showFileBySelection) keys.push("file");
    } else {
      if (showCol("user") && context !== "note") keys.push("user");
      if (showFileBySelection) keys.push("file");
    }
    if (showCol("tdsTaxable")) keys.push("tdsTaxable");
    if (showCol("tdsAmount")) keys.push("tdsAmount");
    if (showCol("dr") && !hideDebitColumn) keys.push("debit");
    if (showCol("cr") && !hideCreditColumn) keys.push("credit");
    if (showCol("status") && !hideStatusColumn) keys.push("status");
    if (showCol("runningBalance") && !hideBalanceColumn) keys.push("balance");
    keys.push("rowMenu");
    return keys;
  }, [
    ledgerDesktopSplitScrollGate,
    dashboardRecentFyAttachmentGate,
    dateSystem,
    context,
    hideDebitColumn,
    hideCreditColumn,
    hideStatusColumn,
    hideBalanceColumn,
    showFileBySelection,
    showItemPartyColumn,
    isItemPartyContext,
    visibleColumns,
    statementCheckedCols,
  ]);

  const intrinsicDateTypeCols = Boolean(
    dashboardRecentFyAttachmentGate &&
      !useMobileCardView &&
      (daybookPartyTableGate || !splitScrollColProportionalGate)
  );

  const splitScrollColWidths: (number | string)[] =
    dashboardRecentFyAttachmentGate || ledgerDesktopSplitScrollGate
      ? ledgerEntityColWidths
      : [];

  const [ledgerHostClientWidth, setLedgerHostClientWidth] = useState(0);
  const unifiedLedgerWidthApplyRef = useRef<(() => void) | null>(null);
  const lastUnifiedScaleTargetRef = useRef(0);
  const lastUnifiedTableMinRef = useRef(0);
  const unifiedWidthApplyingRef = useRef(false);
  /** Survives width remount (Show/Hide linked, row count) — cleanup must not lose H position. */
  const ledgerUnifiedScrollLeftRef = useRef(0);

  const effectiveSplitScrollColWidths = useMemo((): (number | string)[] => {
    if (!splitScrollColProportionalGate || splitScrollColWidths.length === 0) return splitScrollColWidths;
    if (!splitScrollColWidths.every((w) => typeof w === "number")) return splitScrollColWidths;
    const nums = splitScrollColWidths as number[];
    const keys = ledgerEntityColKeys;
    if (intrinsicDateTypeColPx && intrinsicDateTypeCols && keys.length === nums.length) {
      let fixedSum = 0;
      const withIntrinsic = nums.map((w, i) => {
        const colKey = keys[i];
        if (colKey === "date" || colKey === "date_ad") {
          fixedSum += intrinsicDateTypeColPx.date;
          return intrinsicDateTypeColPx.date;
        }
        if (colKey === "type") {
          fixedSum += intrinsicDateTypeColPx.type;
          return intrinsicDateTypeColPx.type;
        }
        return w;
      });
      const flexSum = withIntrinsic.reduce((s, w, i) => {
        const colKey = keys[i];
        if (colKey === "date" || colKey === "date_ad" || colKey === "type") return s;
        return s + w;
      }, 0);
      if (ledgerHostClientWidth <= 0 || fixedSum + flexSum >= ledgerHostClientWidth) {
        return withIntrinsic;
      }
      const scale = (ledgerHostClientWidth - fixedSum) / flexSum;
      return withIntrinsic.map((w, i) => {
        const colKey = keys[i];
        if (colKey === "date" || colKey === "date_ad" || colKey === "type") return w;
        return Math.round(w * scale);
      });
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    if (ledgerHostClientWidth <= 0 || sum >= ledgerHostClientWidth) return nums;
    const scale = ledgerHostClientWidth / sum;
    return nums.map((w) => Math.round(w * scale));
  }, [
    splitScrollColWidths,
    ledgerDesktopSplitScrollGate,
    ledgerHostClientWidth,
    splitScrollColProportionalGate,
    intrinsicDateTypeColPx,
    intrinsicDateTypeCols,
    ledgerEntityColKeys,
  ]);

  const splitScrollTableMinPx = useMemo(() => {
    if (!splitScrollColProportionalGate || effectiveSplitScrollColWidths.length === 0) return 0;
    let sum = 0;
    for (const w of effectiveSplitScrollColWidths) {
      if (typeof w !== "number") return 0;
      sum += w;
    }
    return sum;
  }, [splitScrollColProportionalGate, effectiveSplitScrollColWidths]);

  useLayoutEffect(() => {
    if (!splitScrollColProportionalGate) {
      ledgerUnifiedHScrollActiveRef.current = false;
      setLedgerUnifiedHScrollActive(false);
      return;
    }
    const host = resolveUnifiedHorizontalScrollHost();
    const unifiedOn = Boolean(host) && (ledgerDesktopSplitScrollGate || daybookPartyTableGate);
    ledgerUnifiedHScrollActiveRef.current = unifiedOn;
    setLedgerUnifiedHScrollActive(unifiedOn);
    if (!host) return;

    let widthApplyFrame = 0;
    let widthSettlePass = 0;
    const scheduleApplyUnifiedTableWidthVar = () => {
      if (widthApplyFrame) cancelAnimationFrame(widthApplyFrame);
      widthApplyFrame = requestAnimationFrame(() => {
        widthApplyFrame = 0;
        applyUnifiedTableWidthVar();
      });
    };

    const applyUnifiedTableWidthVar = () => {
      if (unifiedWidthApplyingRef.current) return;
      unifiedWidthApplyingRef.current = true;
      try {
        // Prefer live scrollLeft; if CSS remount clamped to 0, keep last user/host position.
        const savedUnifiedScrollLeft = Math.max(
          host.scrollLeft,
          ledgerUnifiedScrollLeftRef.current
        );
        const zoom =
          typeof document !== "undefined"
            ? parseFloat(
                document.documentElement.style.getPropertyValue("--pl-app-ui-zoom") ||
                  document.documentElement.dataset?.plAppUiZoom ||
                  "1"
              ) || 1
            : 1;
        const hostW = Math.ceil(
          host.clientWidth || ((host.getBoundingClientRect().width || 0) / zoom) || 0
        );

        const bodyEl = tableContainerRef.current;
        const isDaybookUnifiedHost = host.hasAttribute("data-pl-daybook-unified-scroll");
        let ledgerVScrollGutterPx = 0;
        if (bodyEl) {
          const { headerPadPx, bodyPadPx } = measureLedgerTxnVerticalScrollPads(bodyEl);
          if (!isDaybookUnifiedHost) ledgerVScrollGutterPx = headerPadPx;
          const headerPadVar = `${headerPadPx}px`;
          const bodyPadVar = `${bodyPadPx}px`;
          if (isDaybookUnifiedHost) {
            const shell = bodyEl.closest(".pl-ledger-detail-table-shell") as HTMLElement | null;
            if (shell) {
              if (shell.style.getPropertyValue("--pl-dashboard-recent-txn-header-vscroll-pad") !== headerPadVar) {
                shell.style.setProperty("--pl-dashboard-recent-txn-header-vscroll-pad", headerPadVar);
              }
              if (shell.style.getPropertyValue("--pl-dashboard-recent-txn-body-vscroll-pad") !== bodyPadVar) {
                shell.style.setProperty("--pl-dashboard-recent-txn-body-vscroll-pad", bodyPadVar);
              }
            }
          } else {
            if (host.style.getPropertyValue("--pl-ledger-txn-body-vscroll-pad") !== headerPadVar) {
              host.style.setProperty("--pl-ledger-txn-body-vscroll-pad", headerPadVar);
            }
          }
        }

        let baseColSum = 0;
        if (
          splitScrollColWidths.length > 0 &&
          splitScrollColWidths.every((colW) => typeof colW === "number")
        ) {
          const nums = splitScrollColWidths as number[];
          const keys = ledgerEntityColKeys;
          if (intrinsicDateTypeColPx && intrinsicDateTypeCols && keys.length === nums.length) {
            baseColSum = nums.reduce((sum, w, i) => {
              const colKey = keys[i];
              if (colKey === "date" || colKey === "date_ad") {
                return sum + intrinsicDateTypeColPx.date;
              }
              if (colKey === "type") return sum + intrinsicDateTypeColPx.type;
              return sum + w;
            }, 0);
          } else {
            baseColSum = nums.reduce((a, b) => a + b, 0);
          }
        }

        if (baseColSum > 0) {
          baseColSum += ledgerVScrollGutterPx;
        }

        const { tableMinPx: rawTableMinPx, scaleTargetPx: rawScaleTargetPx } = computeLedgerUnifiedTableMinPx({
          host,
          bodyTable: bodyEl?.querySelector("table") ?? null,
          baseColSum,
          hostViewportPx: hostW,
        });

        let tableMinPx = stabilizeLedgerUnifiedPx(rawTableMinPx, lastUnifiedTableMinRef.current);
        // Body V-scrollbar eats ledgerVScrollGutterPx of the body width: column sum (fixed layout) must fit
        // clientWidth, else the last (3-dot) column is clipped under the scrollbar.
        let scaleTargetPx = stabilizeLedgerUnifiedPx(
          Math.max(0, rawScaleTargetPx - ledgerVScrollGutterPx),
          lastUnifiedScaleTargetRef.current
        );
        if (isDaybookUnifiedHost && baseColSum > 0) {
          tableMinPx = Math.max(tableMinPx, baseColSum);
          if (baseColSum > hostW) {
            scaleTargetPx = Math.max(scaleTargetPx, baseColSum);
          }
        }

        const minVar = tableMinPx > 0 ? String(tableMinPx) : "";
        const scaleChanged = scaleTargetPx !== lastUnifiedScaleTargetRef.current;
        const minChanged = minVar !== String(lastUnifiedTableMinRef.current);

        if (scaleChanged) {
          lastUnifiedScaleTargetRef.current = scaleTargetPx;
          setLedgerHostClientWidth((prev) => (prev === scaleTargetPx ? prev : scaleTargetPx));
        }

        {
          const tableMinVarName = isDaybookUnifiedHost
            ? "--pl-daybook-txn-table-min-px"
            : "--pl-ledger-txn-table-min-px";
          if (minVar) {
            host.style.setProperty(tableMinVarName, minVar);
          } else {
            host.style.removeProperty(tableMinVarName);
          }
          if (minChanged) {
            lastUnifiedTableMinRef.current = tableMinPx;
          }
        }

        if ((scaleChanged || minChanged) && widthSettlePass < 1) {
          widthSettlePass += 1;
          requestAnimationFrame(() => {
            unifiedWidthApplyingRef.current = false;
            applyUnifiedTableWidthVar();
          });
          return;
        }
        widthSettlePass = 0;

        const maxScrollLeft = Math.max(0, host.scrollWidth - host.clientWidth);
        const restoredLeft = Math.min(savedUnifiedScrollLeft, maxScrollLeft);
        if (host.scrollLeft !== restoredLeft) {
          host.scrollLeft = restoredLeft;
        }
        ledgerUnifiedScrollLeftRef.current = restoredLeft;
      } finally {
        unifiedWidthApplyingRef.current = false;
      }
    };

    unifiedLedgerWidthApplyRef.current = scheduleApplyUnifiedTableWidthVar;
    scheduleApplyUnifiedTableWidthVar();
    const ro = new ResizeObserver(() => scheduleApplyUnifiedTableWidthVar());
    ro.observe(host);
    const onHostScroll = () => {
      if (unifiedWidthApplyingRef.current) return;
      ledgerUnifiedScrollLeftRef.current = host.scrollLeft;
    };
    host.addEventListener("scroll", onHostScroll, { passive: true });
    window.addEventListener("resize", scheduleApplyUnifiedTableWidthVar);
    return () => {
      // Capture before removing min-width — that clamp would zero scrollLeft.
      if (host.scrollLeft > 0) {
        ledgerUnifiedScrollLeftRef.current = host.scrollLeft;
      }
      unifiedLedgerWidthApplyRef.current = null;
      host.removeEventListener("scroll", onHostScroll);
      ro.disconnect();
      if (widthApplyFrame) cancelAnimationFrame(widthApplyFrame);
      window.removeEventListener("resize", scheduleApplyUnifiedTableWidthVar);
      lastUnifiedTableMinRef.current = 0;
      lastUnifiedScaleTargetRef.current = 0;
      host.style.removeProperty("--pl-ledger-txn-table-min-px");
      host.style.removeProperty("--pl-daybook-txn-table-min-px");
      host.style.removeProperty("--pl-ledger-txn-body-vscroll-pad");
      if (host.hasAttribute("data-pl-daybook-unified-scroll")) {
        const shell = tableContainerRef.current?.closest(".pl-ledger-detail-table-shell") as
          | HTMLElement
          | null;
        shell?.style.removeProperty("--pl-dashboard-recent-txn-header-vscroll-pad");
        shell?.style.removeProperty("--pl-dashboard-recent-txn-body-vscroll-pad");
      }
    };
  }, [
    splitScrollColProportionalGate,
    daybookPartyTableGate,
    ledgerDesktopSplitScrollGate,
    resolveUnifiedHorizontalScrollHost,
    syncDashboardRecentHorizontalScroll,
    transactions.length,
    visibleColumns,
    statementCheckedCols,
    splitScrollColWidths,
    ledgerEntityColKeys,
    intrinsicDateTypeColPx,
    intrinsicDateTypeCols,
  ]);

  useLayoutEffect(() => {
    if (!splitScrollColProportionalGate || ledgerHostClientWidth <= 0) return;
    unifiedLedgerWidthApplyRef.current?.();
  }, [splitScrollColProportionalGate, ledgerHostClientWidth]);

  /**
   * Row count change (daybook date / Show–Hide linked trxn): remasure width and
   * re-apply preserved H-scroll so scrollLeft does not jump left.
   */
  useLayoutEffect(() => {
    if (!splitScrollColProportionalGate) return;
    const preserved = ledgerUnifiedScrollLeftRef.current;
    const run = () => {
      unifiedLedgerWidthApplyRef.current?.();
      const host = resolveUnifiedHorizontalScrollHost();
      if (!host || preserved <= 0) return;
      const maxScrollLeft = Math.max(0, host.scrollWidth - host.clientWidth);
      const left = Math.min(preserved, maxScrollLeft);
      if (host.scrollLeft !== left) host.scrollLeft = left;
      ledgerUnifiedScrollLeftRef.current = left;
    };
    run();
    const id1 = requestAnimationFrame(run);
    const id2 = requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [splitScrollColProportionalGate, transactions.length, resolveUnifiedHorizontalScrollHost]);

  useEffect(() => {
    if (!desktopSplitTableScrollGate) return;
    const measureRecentHorizontalScrollWidth = () => {
      const body = tableContainerRef.current;
      const header = dashboardRecentHeaderScrollRef.current;
      const shell = body?.closest(".pl-ledger-detail-table-shell") as HTMLElement | null;
      const bodyTable = body?.querySelector("table");
      const headerTable = header?.querySelector("table");
      const w = Math.max(
        body?.scrollWidth ?? 0,
        header?.scrollWidth ?? 0,
        bodyTable?.scrollWidth ?? 0,
        headerTable?.scrollWidth ?? 0,
        body?.clientWidth ?? 0
      );
      setDashboardRecentHScrollWidth((prev) =>
        Math.abs(prev - w) <= LEDGER_UNIFIED_WIDTH_STABLE_EPS_PX ? prev : w
      );
      if (dashboardRecentFyAttachmentGate && shell && body) {
        const { headerPadPx, bodyPadPx } = measureLedgerTxnVerticalScrollPads(body);
        const headerPadVar = `${headerPadPx}px`;
        const bodyPadVar = `${bodyPadPx}px`;
        if (shell.style.getPropertyValue("--pl-dashboard-recent-txn-header-vscroll-pad") !== headerPadVar) {
          shell.style.setProperty("--pl-dashboard-recent-txn-header-vscroll-pad", headerPadVar);
        }
        if (shell.style.getPropertyValue("--pl-dashboard-recent-txn-body-vscroll-pad") !== bodyPadVar) {
          shell.style.setProperty("--pl-dashboard-recent-txn-body-vscroll-pad", bodyPadVar);
        }
      }
      if (intrinsicDateTypeCols && header && body) {
        const measureRecentTxnCellPx = (el: HTMLElement) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const zoom =
            typeof document !== "undefined"
              ? parseFloat(
                  document.documentElement.style.getPropertyValue("--pl-app-ui-zoom") ||
                    document.documentElement.dataset?.plAppUiZoom ||
                    "1"
                ) || 1
              : 1;
          const contentW = range.getBoundingClientRect().width / zoom;
          range.detach();
          const style = window.getComputedStyle(el);
          const pl = parseFloat(style.paddingLeft) || 0;
          const pr = parseFloat(style.paddingRight) || 0;
          return Math.ceil(contentW + pl + pr);
        };
        const dateColKey = dateSystem === "Both" ? "date_ad" : "date";
        const dateTh = header.querySelector(
          `th[data-pl-col="${dateColKey}"]`
        ) as HTMLElement | null;
        const typeTh = header.querySelector('th[data-pl-col="type"]') as HTMLElement | null;
        const dateHeaderInner = dateTh?.querySelector(":scope > div") as HTMLElement | null;
        const typeHeaderInner = typeTh?.querySelector(":scope > div") as HTMLElement | null;
        let datePx = 0;
        let typePx = 0;
        if (dateHeaderInner) datePx = Math.max(datePx, measureRecentTxnCellPx(dateHeaderInner));
        if (typeHeaderInner) typePx = Math.max(typePx, measureRecentTxnCellPx(typeHeaderInner));
        const measureRowCap = 48;
        let measuredRows = 0;
        body.querySelectorAll("[data-pl-ledger-txn-last-date-cell]").forEach((node) => {
          if (measuredRows >= measureRowCap) return;
          measuredRows += 1;
          datePx = Math.max(datePx, measureRecentTxnCellPx(node as HTMLElement));
        });
        measuredRows = 0;
        body.querySelectorAll("[data-pl-ledger-txn-type-cell]").forEach((node) => {
          if (measuredRows >= measureRowCap) return;
          measuredRows += 1;
          typePx = Math.max(typePx, measureRecentTxnCellPx(node as HTMLElement));
        });
        if (datePx > 0 && typePx > 0) {
          setIntrinsicDateTypeColPx((prev) => {
            if (
              prev &&
              Math.abs(prev.date - datePx) <= LEDGER_UNIFIED_WIDTH_STABLE_EPS_PX &&
              Math.abs(prev.type - typePx) <= LEDGER_UNIFIED_WIDTH_STABLE_EPS_PX
            ) {
              return prev;
            }
            return { date: datePx, type: typePx };
          });
        }
      }
    };
    let measureRecentFrame = 0;
    const scheduleMeasureRecentHorizontalScrollWidth = () => {
      if (measureRecentFrame) cancelAnimationFrame(measureRecentFrame);
      measureRecentFrame = requestAnimationFrame(() => {
        measureRecentFrame = 0;
        measureRecentHorizontalScrollWidth();
      });
    };
    scheduleMeasureRecentHorizontalScrollWidth();
    const ro = new ResizeObserver(() => scheduleMeasureRecentHorizontalScrollWidth());
    if (dashboardRecentHeaderScrollRef.current) ro.observe(dashboardRecentHeaderScrollRef.current);
    const shellForRo = tableContainerRef.current?.closest(".pl-ledger-detail-table-shell");
    if (shellForRo instanceof HTMLElement) ro.observe(shellForRo);
    window.addEventListener("resize", scheduleMeasureRecentHorizontalScrollWidth);
    return () => {
      ro.disconnect();
      if (measureRecentFrame) cancelAnimationFrame(measureRecentFrame);
      window.removeEventListener("resize", scheduleMeasureRecentHorizontalScrollWidth);
      const shell = tableContainerRef.current?.closest(".pl-ledger-detail-table-shell") as
        | HTMLElement
        | null;
      shell?.style.removeProperty("--pl-dashboard-recent-txn-header-vscroll-pad");
      shell?.style.removeProperty("--pl-dashboard-recent-txn-body-vscroll-pad");
    };
  }, [
    desktopSplitTableScrollGate,
    dashboardRecentFyAttachmentGate,
    transactions.length,
    visibleColumns,
    statementCheckedCols,
    dateSystem,
    showNarration,
    ledgerEntityColWidths,
    intrinsicDateTypeCols,
    intrinsicDateTypeColPx,
    daybookPartyTableGate,
  ]);

  const tableBlocks = useMemo((): TableBlock[] | null => {
    if (!useLedgerGroupCardLayout || !displayLedgerRows?.length) return null;
    const blocks: TableBlock[] = [];
    let i = 0;
    while (i < displayLedgerRows.length) {
      const t = displayLedgerRows[i] as any;
      if (t._spendWiseSpacer) {
        blocks.push({ type: "spacer", id: t.id ?? (t._rowKey ?? `spacer-${i}`) });
        i++;
        continue;
      }
      const linkPreviewGroupId =
        typeof t._billWiseLinkPreviewGroupId === "string" ? t._billWiseLinkPreviewGroupId : "";
      if (linkPreviewGroupId) {
        const colorIndex =
          typeof t._billWiseLinkPreviewGroupColorIndex === "number" ? t._billWiseLinkPreviewGroupColorIndex : 0;
        const items: any[] = [];
        while (i < displayLedgerRows.length) {
          const cur = displayLedgerRows[i] as any;
          if (cur._spendWiseSpacer) break;
          if (String(cur._billWiseLinkPreviewGroupId || "") !== linkPreviewGroupId) break;
          items.push(cur);
          i++;
        }
        if (items.length > 0) {
          blocks.push({ type: "group", colorIndex, items, clippedTop: false, clippedBottom: false });
          continue;
        }
      }
      const groupId = typeof t._spendWiseGroupId === "string" ? t._spendWiseGroupId : "";
      if (groupId) {
        const colorIndex = typeof t._spendWiseGroupColorIndex === "number" ? t._spendWiseGroupColorIndex : 0;
        const items: any[] = [];
        while (i < displayLedgerRows.length) {
          const cur = displayLedgerRows[i] as any;
          if (cur._spendWiseSpacer) break;
          if (String(cur._spendWiseGroupId || "") !== groupId) break;
          items.push(cur);
          i++;
        }
        const firstItem = items[0] as any;
        const lastItem = items[items.length - 1] as any;
        const clippedTop = firstItem?._spendWiseGroupFirst !== true;
        const clippedBottom = lastItem?._spendWiseGroupLast !== true;
        // Har linked/unlinked spend-wise voucher — group card (rounded box); single row par scalloped border na ho
        if (items.length > 0) {
          blocks.push({ type: "group", colorIndex, items, clippedTop, clippedBottom });
          continue;
        }
      }
      if (t._spendWiseGroupFirst === true) {
        const colorIndex = typeof t._spendWiseGroupColorIndex === "number" ? t._spendWiseGroupColorIndex : 0;
        const items: any[] = [];
        while (i < displayLedgerRows.length) {
          const cur = displayLedgerRows[i] as any;
          if (cur._spendWiseSpacer) break;
          items.push(cur);
          if (cur._spendWiseGroupLast === true) {
            i++;
            break;
          }
          i++;
        }
        if (items.length > 0) {
          blocks.push({ type: "group", colorIndex, items, clippedTop: false, clippedBottom: false });
        }
        continue;
      }
      blocks.push({ type: "single", item: t });
      i++;
    }
    return blocks;
  }, [useLedgerGroupCardLayout, displayLedgerRows]);

  /** Book/Dated opening — spend-wise group ke andar (opening-linked group ya pehla group). */
  const spendWiseOpeningEmbedBlockIndex = useMemo(() => {
    if (!useSpendWiseOpeningBalanceCard || !showOpeningBalance || !tableBlocks?.length) return -1;
    const obGroupIdx = tableBlocks.findIndex(
      (b) =>
        b.type === "group" &&
        b.items.some((t: any) => t._spendWiseGroupId === SPEND_WISE_OPENING_GROUP_ID)
    );
    if (obGroupIdx >= 0) return obGroupIdx;
    if (ledgerShowBookOpeningRow) {
      return tableBlocks.findIndex((b) => b.type === "group");
    }
    return -1;
  }, [
    useSpendWiseOpeningBalanceCard,
    showOpeningBalance,
    tableBlocks,
    ledgerShowBookOpeningRow,
  ]);

  const embedSpendWiseOpeningInGroup = spendWiseOpeningEmbedBlockIndex >= 0;

  const spendWiseOpeningRowClass = (embeddedInGroupCard: boolean, hideBottom?: boolean) =>
    embeddedInGroupCard
      ? cn(hideBottom && "[&>td]:border-b-0", hideBottom && "[&>td]:!pb-0")
      : cn(
          "bg-blue-50/50 dark:bg-blue-950/20",
          "[&>td]:border-y [&>td]:border-blue-500 [&>td]:border-solid",
          "[&>td:first-child]:border-l [&>td:last-child]:border-r",
          "[&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl",
          "[&>td:first-child]:overflow-hidden [&>td:last-child]:overflow-hidden",
          hideBottom && "[&>td]:border-b-0",
          hideBottom && "[&>td]:!pb-0"
        );

  const renderSpendWiseOpeningTableRows = (embeddedInGroupCard: boolean) => (
    <>
      {showBookOpeningAboveDatedRow && (
        <tr
          data-row="opening-book"
          data-pl-spend-wise-opening={embeddedInGroupCard ? undefined : ""}
          data-ob-narration-follows={showBookOpeningAboveDatedRow && hideBookOpeningRowBottomBeforeSubRow ? true : undefined}
          className={spendWiseOpeningRowClass(embeddedInGroupCard, hideBookOpeningRowBottomBeforeSubRow)}
        >
          {renderOpeningBalanceDateCells(openingBalanceRowDate)}
          {renderOpeningBalanceMiddleCells(
            bookOpeningRowPillText,
            false,
            masterBookSignedScaled >= 0 ? "dr" : "cr"
          )}
          {renderOpeningBalanceUserCell()}
          {showFileBySelection && (
            <TableCell
              className={cn("text-center align-top", ensureMinGaps && "min-w-[44px] px-[5px]")}
              onClick={(e) => e.stopPropagation()}
            >
              <OpeningBalanceFileCellContent fileUrls={openingBalanceAttachmentUrls} displayMode={fileDisplayMode} showAll={fileShowAll} />
            </TableCell>
          )}
          {renderOpeningBalanceTdsCells()}
          {showCol("dr") && !hideDebitColumn && (
            <TableCell className={cn("text-right font-semibold align-top text-green-700", ensureMinGaps && "min-w-[100px] px-[5px]")}>
              {renderOpeningBalanceDrCrCell("dr", bookRowOpeningDr, bookRowOpeningCr, LEDGER_OB_BOOK_KEY)}
            </TableCell>
          )}
          {showCol("cr") && !hideCreditColumn && (
            <TableCell className={cn("text-right font-semibold align-top text-red-700", ensureMinGaps && "min-w-[100px] px-[5px]")}>
              {renderOpeningBalanceDrCrCell("cr", bookRowOpeningDr, bookRowOpeningCr, LEDGER_OB_BOOK_KEY)}
            </TableCell>
          )}
          {showCol("status") && !hideStatusColumn && (
            <TableCell className={cn("text-center align-top", ensureMinGaps && "min-w-[95px] px-[5px]")}>
              <span className="font-semibold">-</span>
            </TableCell>
          )}
          {showCol("runningBalance") && !hideBalanceColumn && (
            <TableCell className={cn("text-right font-semibold align-top", masterBookSignedScaled >= 0 ? "text-green-600" : "text-red-600", ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN))} style={ledgerBalanceColStyle}>
              {bookOpeningAmountVisible ? formatFooterBalance(billWiseBookOpeningBalance) : "-"}
            </TableCell>
          )}
          <TableCell className={LEDGER_TXN_ROW_MENU_CELL_CN} onClick={(e) => e.stopPropagation()}>
            {renderOpeningBalanceRowMenu()}
          </TableCell>
        </tr>
      )}
      {showBookOpeningAboveDatedRow && openingBalanceNarrationRow(embeddedInGroupCard)}
      <tr
        data-row="opening-balance-dated"
        data-pl-spend-wise-opening={embeddedInGroupCard ? undefined : ""}
        data-ob-narration-follows={!showBookOpeningAboveDatedRow && hideDatedOpeningRowBottomBeforeSubRow ? true : undefined}
        className={spendWiseOpeningRowClass(embeddedInGroupCard, hideDatedOpeningRowBottomBeforeSubRow)}
      >
        {renderOpeningBalanceDateCells(datedOpeningBalanceRowDate)}
        {renderOpeningBalanceMiddleCells(
          datedOpeningRowLabel,
          true,
          spendWiseDatedOpeningRowSigned >= 0 ? "dr" : "cr"
        )}
        {renderOpeningBalanceUserCell()}
        {showFileBySelection && (
          <TableCell
            className={cn("text-center align-top", ensureMinGaps && "min-w-[44px] px-[5px]")}
            onClick={(e) => e.stopPropagation()}
          >
            <OpeningBalanceFileCellContent
              fileUrls={showBookOpeningAboveDatedRow ? undefined : openingBalanceAttachmentUrls}
              displayMode={fileDisplayMode}
              showAll={fileShowAll}
            />
          </TableCell>
        )}
        {renderOpeningBalanceTdsCells()}
        {showCol("dr") && !hideDebitColumn && (
          <TableCell className={cn("text-right text-green-700 font-semibold align-top", ensureMinGaps && "min-w-[100px] px-[5px]")}>
            {!authoritativeOpeningPending
              ? renderOpeningBalanceDrCrCell(
                  "dr",
                  useSpendWiseOpeningBalanceCard ? spendWiseBookOpeningRowDr : billWiseDatedOpeningDrCr.debit,
                  useSpendWiseOpeningBalanceCard ? spendWiseBookOpeningRowCr : billWiseDatedOpeningDrCr.credit,
                  LEDGER_OB_DATED_KEY
                )
              : "-"}
          </TableCell>
        )}
        {showCol("cr") && !hideCreditColumn && (
          <TableCell className={cn("text-right text-red-700 font-semibold align-top", ensureMinGaps && "min-w-[100px] px-[5px]")}>
            {!authoritativeOpeningPending
              ? renderOpeningBalanceDrCrCell(
                  "cr",
                  useSpendWiseOpeningBalanceCard ? spendWiseBookOpeningRowDr : billWiseDatedOpeningDrCr.debit,
                  useSpendWiseOpeningBalanceCard ? spendWiseBookOpeningRowCr : billWiseDatedOpeningDrCr.credit,
                  LEDGER_OB_DATED_KEY
                )
              : "-"}
          </TableCell>
        )}
        {showCol("status") && !hideStatusColumn && (
          <TableCell className={cn("text-center align-top", ensureMinGaps && "min-w-[95px] px-[5px]")}>
            {topLedgerOpeningPillKind === "fy" ? (
              <span className="font-semibold">-</span>
            ) : openingBalanceOutstanding != null && !(hasFyOpeningRowsInLedger && shouldUseOutstandingBalance) ? (
              <div className="flex flex-col items-center gap-[1px] leading-tight">
                <Badge
                  variant="outline"
                  className={cn(
                    "inline-flex h-6 items-center rounded-xl px-2.5 font-medium leading-none shrink-0",
                    openingBalanceOutstanding <= 0 ? "text-green-600 border-green-600/50" : "text-red-600 border-red-600/50"
                  )}
                >
                  {openingBalanceOutstanding <= 0 ? "Paid" : openingBalanceOutstanding >= obAmount ? "Unpaid" : "Partial"}
                </Badge>
                {showNarration && openingBalanceLinkedVoucherNos?.length && !isBillWiseMode ? (
                  <LinkedVouchersColored vouchers={openingBalanceLinkedVoucherNos} align="center" />
                ) : null}
              </div>
            ) : (
              <span className="font-semibold">-</span>
            )}
          </TableCell>
        )}
        {showCol("runningBalance") && !hideBalanceColumn && (
          <TableCell className={cn("text-right font-semibold align-top", spendWiseBookOpeningBalanceForRow >= 0 ? "text-green-600" : "text-red-600", ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN))} style={ledgerBalanceColStyle}>
            {formatOpeningRowBalanceCell(
              useSpendWiseOpeningBalanceCard ? spendWiseBookOpeningBalanceForRow : displayOpeningBalanceForRow,
              showDatedOpeningAmounts
            )}
          </TableCell>
        )}
        <TableCell className={LEDGER_TXN_ROW_MENU_CELL_CN} onClick={(e) => e.stopPropagation()}>
          {renderOpeningBalanceRowMenu()}
        </TableCell>
      </tr>
      {!showBookOpeningAboveDatedRow && openingBalanceNarrationRow(embeddedInGroupCard)}
      {openingBalanceLinkedOnlyRow(embeddedInGroupCard)}
    </>
  );

  if (useMobileCardView) {
    /** Daybook mobile strip (-mx / no side inset) — off when Recent uses party parity layout. */
    const mobileListUsesDaybookStrip = context === "daybook" && !mobileCardLayoutLikeParty;
    const globalHlQ = (rowTextSearchHighlight ?? "").trim();
    const hlForColumn = (columnKey: string) => {
      const colQ = String((filters && filters[columnKey]) || "").trim();
      const q = [globalHlQ, colQ].filter(Boolean).join(" ");
      const amountCol = columnKey === "debit" || columnKey === "credit";
      return (s: string) => highlightQueryInText(s, q, amountCol ? { amount: true } : undefined);
    };
    const hl = hlForColumn("");
    const mobileCardPaletteStyle = (tone: "green" | "pink" | "blue"): React.CSSProperties => {
      const unapproved = tone === "pink";
      if (mobileCardColor === "violet") {
        return {
          borderWidth: 0,
          borderColor: "transparent",
          backgroundColor: unapproved ? "#e5e7eb" : "#fff",
          color: "#000",
        };
      }
      if (mobileCardColor === "blue") return { borderColor: unapproved ? "#9ca3af" : "#93c5fd", backgroundColor: unapproved ? "#e5e7eb" : "#dbeafe", color: "#000" };
      if (mobileCardColor === "pink") return { borderColor: unapproved ? "#fbbf24" : "#f9a8d4", backgroundColor: unapproved ? "#fef3c7" : "#fce7f3", color: "#000" };
      if (mobileCardColor === "amber") return { borderColor: unapproved ? "#ffa500" : "#fcd34d", backgroundColor: unapproved ? "#ffa500" : "#fef3c7", color: "#000" };
      return { borderColor: unapproved ? "#f472b6" : "#86efac", backgroundColor: unapproved ? "#fce7f3" : "#ecfdf5", backgroundImage: unapproved ? "none" : "linear-gradient(90deg, rgba(236, 253, 245, .98), #fff 50%, rgba(209, 250, 229, .92))", color: "#000" };
    };
    const mobileCardPaletteClass = (tone: "green" | "pink" | "blue") => {
      const unapproved = tone === "pink";
      if (mobileCardColor === "violet") return unapproved ? "!border-0 !bg-[#e5e7eb] !text-black" : "!border-0 !bg-white !text-black";
      if (mobileCardColor === "blue") return unapproved ? "!border-gray-400 !bg-gray-200 !text-black" : "!border-blue-300 !bg-blue-100 !text-black";
      if (mobileCardColor === "pink") return unapproved ? "!border-amber-400 !bg-amber-100 !text-black" : "!border-pink-300 !bg-pink-100 !text-black";
      if (mobileCardColor === "amber") return unapproved ? "!border-[#ffa500] !bg-[#ffa500] !text-black" : "!border-amber-300 !bg-amber-100 !text-black";
      return unapproved ? "!border-pink-300 !bg-pink-100 !text-black" : "!border-emerald-300 !bg-emerald-50 !text-black";
    };
    const mobileCardThemeOptions: Array<{ value: MobileTransactionCardColor; label: string }> = [
      { value: "violet", label: "Default" },
      { value: "default", label: "Green" },
      { value: "blue", label: "Blue" },
      { value: "pink", label: "Pink" },
      { value: "amber", label: "Amber" },
    ];
    const applyMobileCardTheme = (value: MobileTransactionCardColor) => {
      setMobileCardColor(value);
      writeMobileTransactionCardColor(value);
    };
    const mobileOpeningHideAmountRowCn =
      "ml-auto flex min-w-0 max-w-full shrink flex-wrap items-center justify-end gap-x-2 gap-y-0.5";
    const mobileOpeningHideAmountBtnCn =
      "order-1 shrink-0 text-xs font-medium text-primary hover:underline whitespace-nowrap";
    const mobileOpeningAmountValueCn = (signed: number) =>
      cn(
        "order-2 shrink-0 text-sm font-bold whitespace-nowrap",
        signed >= 0 ? "text-green-700" : "text-red-700"
      );
    const renderMobileOpeningDateLabel = (openingDate: Date | null | undefined) => {
      if (!openingDate || !showCol("date")) return null;
      return (
        <span className="shrink-0 text-sm font-medium text-foreground whitespace-nowrap">
          {dateSystem === "Both" ? (
            <>
              {formatDateBS(openingDate)} <span className="opacity-70">·</span> {formatDate(openingDate)}
            </>
          ) : dateSystem === "AD" ? (
            formatDate(openingDate)
          ) : (
            formatDateBS(openingDate)
          )}
        </span>
      );
    };
    const renderMobileCard = (t: any, key: string, insideGroup: boolean) => {
      if (t.type === FY_OPENING_ROW_TYPE) {
        const signed = Number(t.balance ?? t.runningBalance) || 0;
        const rowDate = parseFirestoreDateFieldToJsDate(t.date);
        const pillSplit = rowDate
          ? buildFyOpeningPillSplit(company, rowDate, dateSystem, fyOpeningPillFormat)
          : null;
        const fyOpeningSide = signed >= 0 ? "dr" : "cr";
        const dateLabel =
          rowDate && dateSystem === "Both"
            ? `${formatDateBS(rowDate)} · ${formatDate(rowDate)}`
            : rowDate && dateSystem === "BS"
              ? formatDateBS(rowDate)
              : rowDate
                ? formatDate(rowDate)
                : "—";
        const fyOpeningMobileTone = "green" as const;
        return (
          <Card
            key={key}
            data-pl-mobile-transaction-card={fyOpeningMobileTone}
            data-pl-mobile-card-color={mobileCardColor}
            data-pl-mobile-fy-opening=""
            style={mobileCardPaletteStyle(fyOpeningMobileTone)}
            className={cn(
              "relative min-w-0 w-full overflow-hidden border-2 px-2.5 py-1 text-sm shadow-sm transition-colors",
              mobileListUsesDaybookStrip && "rounded-lg",
              mobileCardPaletteClass(fyOpeningMobileTone)
            )}
            onDoubleClick={() => toast.message("This row cannot be edit", { duration: 2000 })}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="shrink-0 text-sm font-medium text-foreground whitespace-nowrap">{dateLabel}</span>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <FyOpeningPillFormatPill>
                  <span
                    className={cn(
                      "rounded-xl border px-2 py-0.5 text-xs font-medium",
                      voucherTypePillClassName(fyOpeningSide)
                    )}
                  >
                    {pillSplit?.typePill ?? String(t._ledgerOpeningPillLabel || "fy opening").trim()}
                  </span>
                </FyOpeningPillFormatPill>
                {pillSplit?.voucherPill ? (
                  <FyOpeningPillFormatPill>
                    <span
                      className={cn(
                        "rounded-xl border px-2 py-0.5 text-xs font-medium",
                        voucherTypePillClassName(fyOpeningSide)
                      )}
                    >
                      {pillSplit.voucherPill}
                    </span>
                  </FyOpeningPillFormatPill>
                ) : null}
              </div>
              <div className={mobileOpeningHideAmountRowCn}>
                {LEDGER_OPENING_HIDE_AMOUNT_ENABLED ? (
                  <button
                    type="button"
                    className={mobileOpeningHideAmountBtnCn}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLedgerOpeningAmountVisible(ledgerFyOpeningAmountKey(String(t.id || "")), e);
                    }}
                  >
                    {isLedgerOpeningAmountVisible(ledgerFyOpeningAmountKey(String(t.id || "")))
                      ? "Hide Amount"
                      : "Show Amount"}
                  </button>
                ) : null}
                {isLedgerOpeningAmountVisible(ledgerFyOpeningAmountKey(String(t.id || ""))) ? (
                  <span className={mobileOpeningAmountValueCn(signed)}>{formatFooterBalance(signed)}</span>
                ) : null}
              </div>
            </div>
          </Card>
        );
      }
      if (t.type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
        const boundaryMs = parseFiscalPartitionBoundaryMs(t);
        const partitionDate = boundaryMs != null ? new Date(boundaryMs) : null;
        const partitionLabels =
          partitionDate && !Number.isNaN(partitionDate.getTime())
            ? buildFiscalMergePartitionBannerSplitForDateSystem(
                company,
                partitionDate,
                dateSystem,
                formatDate,
                company?.fiscalPartitionLabel ?? null,
                fyOpeningPillFormat
              )
            : null;
        const closingEndLabel =
          partitionLabels?.closingEndLabel ??
          (typeof t._partitionLabel === "string" && t._partitionLabel
            ? t._partitionLabel
            : "── Closing fiscal period · New fiscal period ──");
        const newStartLabel = partitionLabels?.newStartLabel ?? closingEndLabel;
        const mobileSummary = fiscalPartitionSummaryForTxn(t);
        const mobileFyPartitionBleedClass =
          mobileCardColor === "violet"
            ? "-mx-[8px] w-[calc(100%+16px)] max-w-none"
            : mobileListUsesDaybookStrip
              ? "w-full"
              : "-mx-0.5 w-[calc(100%+4px)] max-w-none";
        return (
          <div
            key={key}
            data-pl-mobile-fy-partition=""
            className={cn("min-w-0 shrink-0", mobileFyPartitionBleedClass)}
            role="separator"
          >
            {mobileSummary ? (
              <div className="normal-case w-full font-normal tracking-normal border-y border-black text-left">
                <FiscalPartitionClosingSummaryBlock
                  summary={mobileSummary}
                  formatAmount={(n) =>
                    formatCurrencyForPrint(n, { noSuffix: true, context: "transaction", noAnimation: true })
                  }
                  showDrCr={company?.showDrCr !== false}
                  partitionClosingEndLabel={closingEndLabel}
                />
              </div>
            ) : null}
            <FiscalPartitionStartLabelBlock
              label={newStartLabel}
              className={!mobileSummary ? "border-t border-black" : undefined}
            />
          </div>
        );
      }
      let debit = t.debit ?? 0;
      let credit = t.credit ?? 0;
      let balance = t.balance ?? t.runningBalance ?? 0;
      if (typeof (t as any)._spendWiseLedgerRunningBalance === "number") {
        balance = (t as any)._spendWiseLedgerRunningBalance;
      } else if (typeof (t as any)._spendWiseRunningBalance === "number") {
        balance = (t as any)._spendWiseRunningBalance;
      }
      const spendWiseLinkedAmount = (t as any)._spendWiseLinkedAmount;
      if ((t as any)._spendWiseChild && typeof spendWiseLinkedAmount === "number" && spendWiseLinkedAmount > 0) {
        const isOutflow = (t.type === "payment_out" || t.type === "direct_expense") || (Number(t.credit) > 0);
        if (isOutflow) {
          debit = 0;
          credit = spendWiseLinkedAmount;
        } else {
          debit = spendWiseLinkedAmount;
          credit = 0;
        }
      }
      // Bill-wise mobile card: outstanding (same sign rules as table / signedBillWiseOutstandingForRow).
      const useOutstanding = shouldUseOutstandingBalance && isBillWiseCardContext && (t.outstanding != null);
      if (useOutstanding) {
        const signed = signedBillWiseOutstandingForRow(t, context, groupEntityType);
        if (signed != null) balance = signed;
        else {
          const out = Number(t.outstanding) ?? 0;
          balance =
            t.type === "purchase" || t.type === "payment_out" || t.type === "direct_expense" ? -out : out;
        }
      }
      if (context === "item" && stockView === "qty" && item) {
        debit = debit / conversionFactor;
        credit = credit / conversionFactor;
        balance = balance / conversionFactor;
      }
      const amount = credit > 0 ? credit : debit;
      const mainAmountClass =
        amount <= 0
          ? "text-muted-foreground"
          : credit > 0
            ? "text-red-600"
            : "text-green-600";
      // Mobile/local-company rows me `date` Firestore-like object ho sakta hai; direct `new Date(obj)` se date blank ho jata hai.
      const d =
        parseFirestoreDateFieldToJsDate(t.date) ??
        parseFirestoreDateFieldToJsDate((t as Record<string, unknown>).createdAt);
      const entryClock = formatVoucherEntryTimeLocal(t as Record<string, unknown>);
      const balanceSuffix = balance >= 0 ? "Dr" : "Cr";
      const balanceAbs = Math.abs(balance);
      const userName = resolveLedgerTransactionUserDisplayName(t, userNames, {
        currentUserUid,
        currentUserDisplayName,
      });
      const isItemQty = context === "item" && stockView === "qty";
      const formatAmountOrQty = (val: number) =>
        isItemQty && item ? `${formatQuantity(val)} ${displayUnit || ""}` : formatCurrency(val, { noSuffix: true, context: "transaction", noAnimation: true });
      const renderMobileAmountOrQty = (val: number) => {
        if (isItemQty && item) return `${formatQuantity(val)} ${displayUnit || ""}`;
        if (context === "daybook" || !isNumberAnimationEnabled || numberAnimationDuration <= 0 || drCrFilterTypingForAmountText) {
          return formatCurrency(val, { noSuffix: true, context: "transaction", noAnimation: true });
        }
        return (
          <AnimatedNumber
            value={val}
            duration={numberAnimationDuration}
            formatter={(next) => formatCurrency(Number(next) || 0, { noSuffix: true, context: "transaction", noAnimation: true })}
          />
        );
      };
      const renderHighlightedMobileAmountOrQty = (val: number, columnKey?: "debit" | "credit"): React.ReactNode => {
        const rendered = renderMobileAmountOrQty(val);
        const hlAmt = columnKey ? hlForColumn(columnKey) : hl;
        return typeof rendered === "string" || typeof rendered === "number" ? hlAmt(String(rendered)) : rendered;
      };
      const oppositeLabel = getOppositeAccountLabel(t, names, context, contextId, groupEntityType);
      const oppositeClean = (() => {
        const text = String(oppositeLabel || "").trim();
        if (!text || text === "—" || text === "N/A" || text === "-") return "";
        return text;
      })();
      /*
       * FREEZE: Mobile txn card title — voucher no + opposite account only; no getDisplayType().
       * See AGENTS.md "Freeze: Mobile txn card title — no voucher type".
       */
      const titleLabel = [t.voucherNumber || t.type || "", oppositeClean]
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        .join(" · ") || "Transaction";
      const getGroupAccountName = () => {
        const getName = (id: string | undefined) => (id ? (names[id] || "—") : "");
        const id = t.type === "direct_expense" ? (t.toAccountId || t.expenseAccountId) :
          t.type === "direct_income" ? t.incomeAccountId :
          t.type === "payment_out" ? (t.expenseAccountId || t.toAccountId) :
          t.type === "payment_in" ? t.incomeAccountId :
          t.type === "journal" && Array.isArray(t.entries) ? t.entries.find((e: any) => e?.accountId)?.accountId :
          t.type === "note" ? t.entityId : undefined;
        return id ? getName(id) : "";
      };
      const groupAccountName = context === "group" ? getGroupAccountName() : "";
      const showStatusInCard = isBillWiseCardContext;
      const statusLabels = showStatusInCard ? getStatusLabels(t, context) : [];
      const statusDetailVouchers = showStatusInCard ? getStatusDetailVouchers(t, { billWiseOnly: statusBillWiseOnly }) : [];
      const showStatusDetailInCard = statusDetailVouchers.length > 0;
      // Mobile parity with desktop: show overdue age below "Overdue" badge.
      const overdueDaysInCard = (() => {
        if (!transactionIsOverdueStatus(t)) return 0;
        const due = parseFirestoreDateFieldToJsDate((t as any).dueDate);
        if (!due) return 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueOnly = new Date(due);
        dueOnly.setHours(0, 0, 0, 0);
        if (today <= dueOnly) return 0;
        return differenceInDays(today, dueOnly);
      })();
      // Mobile card narration: Note vouchers should surface note title (same intent as desktop narration row).
      const mobileNarrationLabel = t.type === "note" ? "Title" : "Narration";
      const mobileNarrationValue =
        t.type === "note"
          ? (String(t.title || "").trim() || String(t.narration || "").trim() || "—")
          : (String(t.narration || "").trim() || "—");
      const icRowLinked = !!String((t as any)?.interCompanyLink?.linkId || "").trim();
      const icViewOnly =
        isInterCompanyVoucherEditDeleteBlocked(t as Record<string, unknown>) ||
        (icRowLinked && !sharedUserCanEditInterCompanyVoucher(company, can));
      const canApproveCardRow = icRowLinked
        ? sharedUserCanApproveInterCompanyVoucher(company, can)
        : can("approve_transactions");
      const isPendingApproval = highlightPendingApproval && (t as any).isApproved !== true; // mobile card — theme stripe N/A
      const isPeerPendingChange =
        String((t as any).type || "") === "inter_company" &&
        !!(t as any).interCompanyPeerPending?.proposed &&
        typeof (t as any).interCompanyPeerPending.proposed === "object" &&
        Object.keys((t as any).interCompanyPeerPending.proposed).length > 0;
      const swBorder = !insideGroup && typeof (t as any)._spendWiseGroupColorIndex === "number"
        ? ((t as any)._spendWiseGroupColorIndex === 1 ? "border-l-4 border-l-green-500" : (t as any)._spendWiseGroupColorIndex === 2 ? "border-l-4 border-l-pink-500" : "border-l-4 border-l-blue-500")
        : "";
      const mobileCardTone = isPeerPendingChange ? "blue" : isPendingApproval ? "pink" : "green";
      const isStatementChecked = ledgerStatementChecked.isChecked(t);
      const showCheckedMessage =
        isStatementChecked && statementCheckedMessageColumn(debit, credit) !== null;
      const mobileTdsVerifyLabel = isSalePurchaseTdsVerifyLedgerContext(context, groupEntityType)
        ? resolveSalePurchaseTdsVerifyLabel(t, { context, contextId, groupEntityType })
        : null;
      const canMarkStatement =
        ledgerStatementChecked.canMark &&
        statementCheckTxnId(t) &&
        t?.type !== "opening_balance" &&
        t?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE &&
        t?.type !== FY_OPENING_ROW_TYPE;
      const statementCheckedMobileStyle: React.CSSProperties = {
        borderWidth: 2,
        borderStyle: "solid",
        borderColor: "rgb(245, 158, 11)",
        backgroundColor: "rgb(254, 243, 199)",
        backgroundImage: "none",
        color: "#000000",
      };
      // Mobile transaction cards: border + amount chips follow 3-dot card color (not site theme).
      return (
        <Card
          key={key}
          data-pl-mobile-transaction-card={mobileCardTone}
          data-pl-mobile-card-color={mobileCardColor}
          data-pl-statement-checked={isStatementChecked ? "" : undefined}
          style={isStatementChecked ? statementCheckedMobileStyle : mobileCardPaletteStyle(mobileCardTone)}
          className={cn(
            "relative min-w-0 w-full overflow-hidden border-2 px-2.5 py-1 shadow-sm cursor-pointer transition-colors",
            mobileListUsesDaybookStrip && "rounded-lg",
            swBorder,
            "hover:opacity-90",
            !isStatementChecked && mobileCardPaletteClass(mobileCardTone)
          )}
          onClick={() => onRowClick?.(t)}
        >
          <div data-pl-mobile-card-rows="" className="flex min-w-0 flex-col gap-[4px]">
          <div className="flex items-start gap-2 min-w-0">
            <div className="min-w-0 flex-1 flex flex-col gap-[4px] overflow-hidden">
              <div className="min-w-0 overflow-hidden">
                <p className="font-bold text-sm truncate">{hl(titleLabel)}</p>
                {isPeerPendingChange ? (
                  <button
                    type="button"
                    className="mt-0.5 inline-flex cursor-pointer items-center rounded-full border border-blue-600/50 bg-blue-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm hover:bg-blue-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onInterCompanyChangeDetectedClick?.(t);
                    }}
                  >
                    Change Detected
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground break-words whitespace-normal line-clamp-none min-w-0">
                <span className="font-semibold">{mobileNarrationLabel} : </span>
                {hl(mobileNarrationValue)}
              </p>
            </div>
            <div
              data-pl-mobile-card-file-amount-stack=""
              className="flex shrink-0 items-start gap-[4px]"
            >
              {showFileBySelection ? (
                <div
                  className="shrink-0 self-center"
                  data-pl-txn-file-cell=""
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <MobileTransactionFilePreview
                    transaction={t}
                    showAll={fileShowAll && fileDisplayMode === "preview"}
                    suppressAutoThumbLoad={
                      enforceCurrentFyAttachmentAutoLoad &&
                      !shouldAutoWarmAttachmentForLedgerRow(company?.country, t?.date, true)
                    }
                  />
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col items-end gap-[4px]">
                <div
                  data-pl-mobile-card-amount-actions=""
                  className="-mr-[7px] flex shrink-0 items-center justify-end gap-[4px] font-bold text-sm"
                >
                  <span
                    data-pl-mobile-card-amount=""
                    className={cn(
                      "whitespace-nowrap font-bold",
                      mainAmountClass === "text-red-600"
                        ? "!text-red-600"
                        : mainAmountClass === "text-green-600"
                          ? "!text-green-600"
                          : mainAmountClass
                    )}
                  >
                    {debit > 0 && credit > 0 && !isItemQty ? (
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span className="!text-green-600">{renderHighlightedMobileAmountOrQty(debit, "debit")}</span>
                        <span className="!text-red-600">{renderHighlightedMobileAmountOrQty(credit, "credit")}</span>
                      </span>
                    ) : amount > 0 ? renderHighlightedMobileAmountOrQty(amount) : "-"}
                  </span>
                  {useMobileCardView ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-pl-mobile-card-row-menu=""
                      className="inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-foreground/80 shadow-none hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0"
                      aria-label="Approve"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                    {canMarkStatement ? (
                      <DropdownMenuItem
                        onClick={() => ledgerStatementChecked.toggleChecked(t)}
                        className="flex items-center gap-2"
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                        {isStatementChecked ? "Unmark as reconciled" : "Mark as reconciled"}
                      </DropdownMenuItem>
                    ) : null}
                    {isPendingApproval && canApproveCardRow ? (
                      <DropdownMenuItem
                        onClick={() => effectiveOnApproveVoucher?.(t)}
                        className="flex items-center gap-2"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Approve
                      </DropdownMenuItem>
                    ) : null}
                    {!isPendingApproval &&
                    canApproveCardRow &&
                    (t as any).isApproved === true &&
                    t?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE &&
                    t?.type !== FY_OPENING_ROW_TYPE ? (
                      <DropdownMenuItem
                        onClick={() => effectiveOnUnapproveVoucher?.(t)}
                        className="flex items-center gap-2"
                      >
                        <CircleOff className="h-3.5 w-3.5" />
                        Mark as unapproved
                      </DropdownMenuItem>
                    ) : null}
                    {showApproveAllOnPage ? (
                      <DropdownMenuItem
                        onClick={() => void handleApproveAllVisible()}
                        className="flex items-center gap-2"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Approve All
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => onRowClick?.(t)}
                      className="flex items-center gap-2"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {icViewOnly ? "View" : "Edit"}
                    </DropdownMenuItem>
                    {can("view_voucher_history") && onHistoryVoucher ? (
                      <DropdownMenuItem
                        onClick={() => onHistoryVoucher(t)}
                        className="flex items-center gap-2"
                      >
                        <History className="h-3.5 w-3.5" />
                        History
                      </DropdownMenuItem>
                    ) : null}
                    {onMoveVoucherToRecycleBin &&
                    canDeleteVoucher(t as { isApproved?: boolean }) &&
                    t?.id &&
                    t?.type !== FISCAL_YEAR_PARTITION_ROW_TYPE &&
                    t?.type !== FY_OPENING_ROW_TYPE ? (
                      <DropdownMenuItem
                        onClick={() => onMoveVoucherToRecycleBin(t)}
                        className="flex items-center gap-2 text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Move to recycle bin
                      </DropdownMenuItem>
                    ) : null}
                    <div data-pl-card-theme-section="" className="mt-1 border-t border-border/60 px-1 pt-1">
                      <DropdownMenuItem
                        onSelect={() => setMobileCardColorPickerOpen(true)}
                        className="px-2 py-1 text-xs font-semibold text-muted-foreground"
                      >
                        View Card Theme
                      </DropdownMenuItem>
                      <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 p-1">
                        {mobileCardThemeOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              "w-full rounded-full border px-2 py-1 text-left text-xs hover:bg-accent",
                              mobileCardColor === option.value
                                ? "border-primary bg-accent font-semibold"
                                : "border-border/60"
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              applyMobileCardTheme(option.value);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                  ) : null}
                </div>
                {showStatusInCard && (statusLabels.length > 0 || showStatusDetailInCard) ? (
                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                    {statusLabels.map((statusLabel) => (
                      <Badge
                        key={statusLabel}
                        variant="outline"
                        className={cn(
                          "text-xs font-semibold h-[22px]",
                          getStatusBadgeOutlineClassName(statusLabel, t, { debit, credit })
                        )}
                      >
                        {hl(statusLabel)}
                      </Badge>
                    ))}
                    {overdueDaysInCard > 0 ? (
                      <span className="text-[10px] font-medium text-red-600">
                        {hl(
                          `${overdueDaysInCard} ${overdueDaysInCard === 1 ? "day" : "days"}`
                        )}
                      </span>
                    ) : null}
                  </div>
                ) : !hideBalanceColumn ? (
                  <span
                    data-pl-mobile-card-amount=""
                    className={cn(
                      "text-xs font-semibold whitespace-nowrap shrink-0",
                      balance >= 0 ? "text-green-700" : "text-red-600"
                    )}
                  >
                    <span>Bal:</span>
                    {renderHighlightedMobileAmountOrQty(balanceAbs)}
                    {!isItemQty ? <span> {balanceSuffix}</span> : null}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {showCheckedMessage ? (
            <StatementCheckedRowMessageLabel className="w-full" align="start" />
          ) : null}
          {/* Bill-wise mobile: linked vouchers Status→Balance width par wrap (print parity) */}
          {showStatusDetailInCard ? (
            <div className="w-full min-w-0 flex justify-end">
              <LinkedVouchersColoredCollapsible
                vouchers={statusDetailVouchers}
                wrapInline
                align="start"
                billWisePink
                className="max-w-full"
                onVoucherClick={
                  getBillWiseLinkPreviewRowProps(t).onStatusLinkedVoucherClick
                    ? (voucherNo, e) => {
                        e.stopPropagation();
                        getBillWiseLinkPreviewRowProps(t).onStatusLinkedVoucherClick?.(voucherNo);
                      }
                    : undefined
                }
                activeVoucherNo={getBillWiseLinkPreviewRowProps(t).statusLinkedVoucherPreviewActive}
              />
            </div>
          ) : null}
          <div className="flex justify-between items-end gap-2 min-w-0">
            <div className="min-w-0 flex-1 overflow-hidden flex flex-col items-start gap-0.5">
              {groupAccountName ? (
                <p className="text-xs text-muted-foreground truncate font-medium w-full">{hl(`Account: ${groupAccountName}`)}</p>
              ) : null}
              {mobileTdsVerifyLabel ? (
                <span
                  className={cn(
                    "inline-flex w-max max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-md border box-border pl-2 pr-2.5 py-0.5 text-[11px] font-bold italic leading-none",
                    mobileTdsVerifyLabel === SALE_PURCHASE_TDS_VERIFIED_MESSAGE
                      ? "border-green-600 bg-green-100 text-green-800 dark:border-green-500 dark:bg-green-950/40 dark:text-green-200"
                      : "border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200"
                  )}
                >
                  {(() => {
                    const badgeColKey = drCrOppositeKey(statementCheckedMessageColumn(debit, credit));
                    const badgeColQ = tdsBadgeHighlightQuery(
                      String((filters && filters[badgeColKey]) || ""),
                      mobileTdsVerifyLabel,
                      String((filters && filters[drCrChipKey(badgeColKey)]) || "")
                    );
                    return highlightQueryInText(mobileTdsVerifyLabel, [globalHlQ, badgeColQ].filter(Boolean).join(" "));
                  })()}
                </span>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {hl(
                  `${
                    d
                      ? // Mobile transaction row: keep date behavior aligned with opening card for AD/BS/Both.
                        dateSystem === "Both"
                        ? `${formatDateBS(d)} · ${formatDate(d)}`
                        : dateSystem === "BS"
                          ? formatDateBS(d)
                          : formatDate(d)
                      : ""
                  }${
                    entryClock ? ` ${entryClock}` : ""
                  }`
                )}
              </p>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-0.5 flex-shrink-0">
              {showStatusInCard && !hideBalanceColumn && (
                <span
                  data-pl-mobile-card-amount=""
                  className={cn(
                    "text-xs font-semibold whitespace-nowrap",
                    balance >= 0 ? "text-green-700" : "text-red-600"
                  )}
                >
                  <span>Bal:</span>
                  {renderHighlightedMobileAmountOrQty(balanceAbs)}
                  {!isItemQty ? <span> {balanceSuffix}</span> : null}
                </span>
              )}
              {/* User line: single row — `max-w-[120px]` se lamba naam wrap ho jata tha */}
              <p className="text-[10px] text-muted-foreground whitespace-nowrap truncate max-w-[min(42vw,9rem)] sm:max-w-[10rem]">
                {hl(`User: ${userName}`)}
              </p>
            </div>
          </div>
          </div>
        </Card>
      );
    };

    const groupContainerClass = (colorIndex: number) => {
      const border = colorIndex === 1 ? "border-2 border-green-500" : colorIndex === 2 ? "border-2 border-pink-500" : "border-2 border-blue-500";
      const bg = colorIndex === 1 ? "bg-green-50 dark:bg-green-950/30" : colorIndex === 2 ? "bg-pink-50 dark:bg-pink-950/30" : "bg-blue-50 dark:bg-blue-950/30";
      // Add a same-color outer outline so rounded corners look uniformly thick.
      const outerLayer = colorIndex === 1 ? "outline outline-1 outline-green-500/80" : colorIndex === 2 ? "outline outline-1 outline-pink-500/80" : "outline outline-1 outline-blue-500/80";
      return cn("rounded-xl overflow-hidden", border, bg, outerLayer);
    };

    /*
     * FREEZE: Mobile Default card theme (violet) — party-parity list layout.
     * See AGENTS.md "Freeze: Mobile Default txn card UI". Do not edit unless human asks in same message.
     * Default: 8px side inset + 8px card gap + blue gap strip + 3D white cards (globals.css).
     */
    const isDefaultMobileTxnCardTheme = mobileCardColor === "violet";
    const mobileTxnListGapClass = isDefaultMobileTxnCardTheme
      ? "flex flex-col gap-[8px] pt-[8px]"
      : "space-y-1 pt-1";
    const mobileTxnListSideClass = isDefaultMobileTxnCardTheme
      ? cn("px-[8px]", mobileListUsesDaybookStrip && "-mx-[2px]")
      : cn(mobileListUsesDaybookStrip ? "" : "px-0.5");
    const mobileTxnGroupGapClass = isDefaultMobileTxnCardTheme ? "flex flex-col gap-[8px]" : "space-y-1";
    return (
      <div
        key={mobileCardColor}
        data-pl-mobile-card-page-color={mobileCardColor}
        data-pl-mobile-txn-list=""
        className={cn("w-full min-w-0 pb-4 overflow-hidden", mobileTxnListGapClass, mobileTxnListSideClass)}
      >
        <MobileTransactionCardColorPicker
          open={mobileCardColorPickerOpen}
          value={mobileCardColor}
          samples={mobileCardPreviews}
          onOpenChange={setMobileCardColorPickerOpen}
          onChange={setMobileCardColor}
        />
        {showLedgerOpeningRows && (
          <>
            {/* Date filter + master OB: pehla card (stacked); search slot sirf neeche wale card par */}
            {showBookOpeningAboveDatedRow ? (
              <Card data-pl-mobile-transaction-card="green" data-pl-mobile-card-color={mobileCardColor} style={mobileCardPaletteStyle("green")} className={cn("p-2.5 min-h-9 min-w-0 overflow-hidden bg-card border-2 border-emerald-300/85 dark:border-emerald-800/50 shadow-sm", mobileCardPaletteClass("green"))}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {renderMobileOpeningDateLabel(openingBalanceRowDate)}
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit shrink-0",
                      voucherTypePillClassName(masterBookSignedScaled >= 0 ? "dr" : "cr")
                    )}
                  >
                    {bookOpeningRowPillText}
                  </Badge>
                  <div className={mobileOpeningHideAmountRowCn}>
                    {LEDGER_OPENING_HIDE_AMOUNT_ENABLED ? (
                      <button
                        type="button"
                        className={mobileOpeningHideAmountBtnCn}
                        onClick={(e) => toggleLedgerOpeningAmountVisible(LEDGER_OB_BOOK_KEY, e)}
                      >
                        {bookOpeningAmountVisible ? "Hide Amount" : "Show Amount"}
                      </button>
                    ) : null}
                    {bookOpeningAmountVisible ? (
                      <span className={mobileOpeningAmountValueCn(masterBookSignedScaled)}>
                        {context === "item" && stockView === "qty" && item
                          ? `${formatQuantity(Math.abs(masterBookSignedScaled))} ${displayUnit || ""}`
                          : (
                            <>
                              {formatCurrency(Math.abs(masterBookSignedScaled), { noSuffix: true, context: "transaction" })}{" "}
                              {masterBookSignedScaled >= 0 ? "Dr" : "Cr"}
                            </>
                          )}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Card>
            ) : null}
            {showBookOpeningAboveDatedRow && showNarration && openingBalanceNarrationTrimmed ? (
              <p className="mt-1 pl-0 text-[11px] leading-tight text-black break-words whitespace-normal line-clamp-none min-w-0 w-full px-0.5">
                <span className="not-italic font-normal">Narration:</span>{" "}
                <span className="whitespace-pre-wrap font-normal">{openingBalanceNarrationTrimmed}</span>
              </p>
            ) : null}
            <Card data-pl-mobile-transaction-card="green" data-pl-mobile-card-color={mobileCardColor} style={mobileCardPaletteStyle("green")} className={cn("p-2.5 min-h-9 min-w-0 overflow-hidden bg-card border border-border/80 shadow-sm", mobileCardPaletteClass("green"))}>
              <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  {renderMobileOpeningDateLabel(datedOpeningBalanceRowDate)}
                  {openingBalanceLeftContent}
                  {openingBalanceSearch}
                  {/* Table ke Type column pill: ledger = Book/Dated Opening; reports = `openingBalanceLabel` */}
                  <Badge
                    variant="outline"
                    className={cn("shrink-0", voucherTypePillClassName(displayOpeningForDrCr >= 0 ? "dr" : "cr"))}
                  >
                    {primaryOpeningRowPillText}
                  </Badge>
                </div>
              <div className="ml-auto flex min-w-0 max-w-full shrink flex-col items-end gap-0.5">
                {/* Bill-wise: show main amount (full OB) on top like normal transaction, then balance (outstanding) below. */}
                {isBillWiseCardContext && obOutstandingDisplay != null ? (
                  <>
                    <div className={mobileOpeningHideAmountRowCn}>
                      {LEDGER_OPENING_HIDE_AMOUNT_ENABLED ? (
                        <button
                          type="button"
                          className={mobileOpeningHideAmountBtnCn}
                          onClick={(e) => toggleLedgerOpeningAmountVisible(LEDGER_OB_DATED_KEY, e)}
                        >
                          {datedOpeningAmountVisible ? "Hide Amount" : "Show Amount"}
                        </button>
                      ) : null}
                      {datedOpeningAmountVisible ? (
                        <span className={mobileOpeningAmountValueCn(displayOpeningForDrCr)}>
                          {stockView === "qty" && item
                            ? `${formatQuantity(Math.abs(displayOpeningForDrCr))} ${displayUnit || ""}`
                            : (
                              <>
                                {formatCurrency(Math.abs(displayOpeningForDrCr), { noSuffix: true, context: "transaction" })}{" "}
                                {displayOpeningForDrCr >= 0 ? "Dr" : "Cr"}
                              </>
                            )}
                        </span>
                      ) : null}
                    </div>
                    {datedOpeningAmountVisible ? (
                    <div className="flex flex-col items-end gap-0.5 mt-0.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-semibold h-[22px]",
                          obStatusLabel === "Paid" ? "text-green-600 border-green-600/50" : "text-red-600 border-red-600/50"
                        )}
                      >
                        {obStatusLabel}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-xs font-semibold px-1.5 py-0 whitespace-nowrap",
                          displayOpeningBalanceForRow >= 0 ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                        )}
                      >
                        Bal:{formatCurrency(Math.abs(displayOpeningBalanceForRow), { noSuffix: true, context: "transaction" })}{displayOpeningBalanceForRow >= 0 ? " Dr" : " Cr"}
                      </Badge>
                    </div>
                    ) : null}
                    {/* Bill-wise OB mobile: linked vouchers Status→Balance wrap */}
                    {showNarration && openingBalanceLinkedVoucherNos?.length ? (
                      <div className="mt-0.5 w-full min-w-0 flex justify-end">
                        <LinkedVouchersColoredCollapsible
                          vouchers={openingBalanceLinkedVoucherNos}
                          wrapInline
                          align="start"
                          billWisePink
                          className="max-w-full"
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className={mobileOpeningHideAmountRowCn}>
                    {LEDGER_OPENING_HIDE_AMOUNT_ENABLED ? (
                      <button
                        type="button"
                        className={mobileOpeningHideAmountBtnCn}
                        onClick={(e) => toggleLedgerOpeningAmountVisible(LEDGER_OB_DATED_KEY, e)}
                      >
                        {datedOpeningAmountVisible ? "Hide Amount" : "Show Amount"}
                      </button>
                    ) : null}
                    {datedOpeningAmountVisible ? (
                      <span
                        className={mobileOpeningAmountValueCn(
                          isBillWiseCardContext ? displayOpeningBalanceForRow : displayOpeningForDrCr
                        )}
                      >
                        {context === "item" && stockView === "qty" && item
                          ? `${formatQuantity(Math.abs(displayOpeningForDrCr))} ${displayUnit || ""}`
                          : (() => {
                              const ob = isBillWiseCardContext ? displayOpeningBalanceForRow : displayOpeningForDrCr;
                              return (
                                <>
                                  {formatCurrency(Math.abs(ob), { noSuffix: true, context: "transaction" })}{" "}
                                  {ob >= 0 ? "Dr" : "Cr"}
                                </>
                              );
                            })()}
                      </span>
                    ) : null}
                  </div>
                )}
                {/* Bill-wise OB (no outstanding split): linked vouchers full-width wrap */}
                {isBillWiseCardContext && showNarration && openingBalanceLinkedVoucherNos?.length && obOutstandingDisplay == null ? (
                  <div className="mt-0.5 w-full min-w-0 flex justify-end">
                    <LinkedVouchersColoredCollapsible
                      vouchers={openingBalanceLinkedVoucherNos}
                      wrapInline
                      align="start"
                      billWisePink
                      className="max-w-full"
                    />
                  </div>
                ) : null}
              </div>
              </div>
            {!showBookOpeningAboveDatedRow && showNarration && openingBalanceNarrationTrimmed ? (
              <p className="mt-1.5 pl-0 text-[11px] leading-tight text-black break-words whitespace-normal line-clamp-none min-w-0 w-full">
                <span className="not-italic font-normal">Narration:</span>{" "}
                <span className="whitespace-pre-wrap font-normal">{openingBalanceNarrationTrimmed}</span>
              </p>
            ) : null}
          </Card>
          </>
        )}
        {(() => {
          // Large mobile ledgers: blocks ko virtualize karo; poori list map karne se WebView freeze spikes aate hain.
          const mobileVirtualizationEnabled =
            !scrollOnlyTransactions &&
            mobileBlocks.length > (hideFooter ? 36 : 80);
          if (!mobileVirtualizationEnabled) {
            return mobileBlocks.map((block, blockIdx) => {
              if (block.type === "spacer") {
                return <div key={`spacer-${blockIdx}`} className="shrink-0 w-full" style={{ height: 20 }} aria-hidden />;
              }
              if (block.type === "group") {
                const groupKey = `group-${blockIdx}-${block.items[0]?.id ?? block.items.map((t: any) => t.id).join("-")}`;
                return (
                  <motion.div
                    key={groupKey}
                    layout="position"
                    initial={false}
                    transition={isRowAnimationEnabled ? { duration: rowAnimationDuration, ease: "easeInOut" } : { duration: 0 }}
                    className={cn(mobileTxnGroupGapClass, groupContainerClass(block.colorIndex))}
                  >
                    {block.items.map((t: any, itemIdx: number) => (
                      <motion.div
                        key={t.id ?? (t as any)._rowKey ?? `${blockIdx}-${itemIdx}`}
                        layout="position"
                        initial={false}
                        transition={isRowAnimationEnabled ? { duration: rowAnimationDuration, ease: "easeInOut" } : { duration: 0 }}
                      >
                        {renderMobileCard(t, t.id, true)}
                      </motion.div>
                    ))}
                  </motion.div>
                );
              }
              return (
                <motion.div
                  key={block.item.id}
                  layout="position"
                  initial={false}
                  transition={isRowAnimationEnabled ? { duration: rowAnimationDuration, ease: "easeInOut" } : { duration: 0 }}
                >
                  {renderMobileCard(block.item, block.item.id, false)}
                </motion.div>
              );
            });
          }

          return (
            <Virtuoso
              key={mobileCardColor}
              // Mobile long ledgers: only visible cards mount (plus overscan) to reduce freeze.
              style={{
                height: Math.min(
                  760,
                  Math.max(320, (typeof window !== "undefined" ? window.innerHeight : 760) - 220)
                ),
                width: "100%",
              }}
              totalCount={mobileBlocks.length}
              overscan={400}
              itemContent={(index) => {
                const block = mobileBlocks[index];
                if (!block) return null;
                if (block.type === "spacer") {
                  return <div className="w-full" style={{ height: 20 }} aria-hidden />;
                }
                if (block.type === "group") {
                  return (
                    <div className={cn(mobileTxnGroupGapClass, "pr-1", groupContainerClass(block.colorIndex))}>
                      {block.items.map((t: any, itemIdx: number) => (
                        <div key={`${index}-${itemIdx}-${t.id ?? (t as any)._rowKey ?? ""}`}>
                          {renderMobileCard(t, t.id, true)}
                        </div>
                      ))}
                    </div>
                  );
                }
                return <div>{renderMobileCard(block.item, block.item.id, false)}</div>;
              }}
            />
          );
        })()}
        {!hideFooter ? (
          <Card
            data-pl-mobile-transaction-card="green"
            data-pl-mobile-card-color={mobileCardColor}
            data-pl-closing-balance-card=""
            {...(closingBalanceActions ? { "data-pl-mobile-closing-balance-stack": "" } : {})}
            style={mobileCardPaletteStyle("green")}
            className={cn("p-2.5 min-w-0 overflow-visible bg-card border-2 border-emerald-300/85 dark:border-emerald-800/50 shadow-sm", mobileCardPaletteClass("green"))}
          >
            <div className="flex w-full min-w-0 flex-col gap-2">
              {!hideBalanceColumn ? (
                <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-1.5">
                  {closingBalanceRowActions ? (
                    <div
                      data-pl-closing-balance-row-actions=""
                      className="mr-auto flex min-w-0 shrink flex-wrap items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <AdaptiveClosingScope enabled={adaptiveClosingLabel} label={closingBalanceLabel}>{closingBalanceRowActions}</AdaptiveClosingScope>
                    </div>
                  ) : null}
                  {adaptiveClosingLabel ? (
                    <span data-pl-closing-amount="" className="shrink-0 whitespace-nowrap text-sm font-semibold">{formatFooterBalance(footerClosingBalance)}</span>
                  ) : (
                    <>
                      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{closingBalanceLabel}</span>
                      <span className="shrink-0 text-sm font-semibold">{formatFooterBalance(footerClosingBalance)}</span>
                    </>
                  )}
                </div>
              ) : null}
              {closingBalanceActions ? (
                <div
                  data-pl-closing-balance-actions=""
                  className={cn(LEDGER_CLOSING_BALANCE_ACTIONS_CN, "ml-0 max-w-full")}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <AdaptiveClosingScope enabled={adaptiveClosingLabel} label={closingBalanceLabel}>{closingBalanceActions}</AdaptiveClosingScope>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    );
  }

  const ledgerTableClassName = cn(
    splitScrollColProportionalGate
      ? "table-fixed"
      : ledgerEntityContentAutoWidth
        ? "table-auto w-max min-w-full"
        : ensureMinGaps
          ? "table-auto w-full min-w-full"
          : "table-fixed w-full",
    "border-separate border-spacing-0",
    hasSpendWiseGroups && "w-full min-w-0 table-fixed",
    tableBottomBorderCn
  );

  const recentTableColgroup = (
    <>
      {effectiveSplitScrollColWidths.length > 0 && (
        <colgroup>
          {effectiveSplitScrollColWidths.map((width, i) => {
            const colKey = ledgerEntityColKeys[i] ?? `col-${i}`;
            if (
              intrinsicDateTypeCols &&
              intrinsicDateTypeColPx &&
              (colKey === "date" || colKey === "date_ad")
            ) {
              return (
                <col
                  key={i}
                  data-pl-col={colKey}
                  style={{ width: `${intrinsicDateTypeColPx.date}px` }}
                />
              );
            }
            if (intrinsicDateTypeCols && intrinsicDateTypeColPx && colKey === "type") {
              return (
                <col
                  key={i}
                  data-pl-col={colKey}
                  style={{ width: `${intrinsicDateTypeColPx.type}px` }}
                />
              );
            }
            if (intrinsicDateTypeCols && colKey === "accounts") {
              return (
                <col
                  key={i}
                  data-pl-col={colKey}
                  style={{ minWidth: `${DAYBOOK_ACCOUNTS_COL_PX}px` }}
                />
              );
            }
            return (
              <col
                key={i}
                data-pl-col={colKey}
                style={
                  typeof width === "number"
                    ? splitScrollColProportionalGate
                      ? { width: `${width}px` }
                      : ledgerEntityContentAutoWidth
                        ? { minWidth: `${width}px` }
                        : { width: `${width}px` }
                    : splitScrollColProportionalGate
                      ? { width }
                      : ledgerEntityContentAutoWidth
                        ? { minWidth: width }
                        : { width }
                }
              />
            );
          })}
        </colgroup>
      )}
      {hasSpendWiseGroups && spendWiseColWidths.length > 0 && splitScrollColWidths.length === 0 && (
        <colgroup>
          {spendWiseColWidths.map((width, i) => (
            <col key={i} style={{ width: `${width}px` }} />
          ))}
        </colgroup>
      )}
    </>
  );

  const recentTableHeader = (
    <TableHeader
      className={cn(
        desktopSplitTableScrollGate &&
          "pl-dashboard-recent-sticky-thead [&_tr]:!border-b-0 [&_tr]:border-b-0"
      )}
    >
      <TableRow
        className={cn(
          "border-black hover:bg-transparent [&>th]:border-black",
          desktopSplitTableScrollGate
            ? "border-b-0 [&>th]:border-b-0"
            : "border-b-2 [&>th]:border-b-2"
        )}
      >
        {showCol("syncStatus") && renderHeaderWithFilter("syncStatus", "Sync", false, ensureMinGaps ? 78 : undefined)}
        {showCol("date") && (dateSystem === "Both" ? (
          <>
            {renderHeaderWithFilter(
              "date_bs",
              "Date (BS)",
              false,
              ensureMinGaps ? ledgerDateBsColMinPx : undefined
            )}
            {renderHeaderWithFilter(
              "date_ad",
              "Date (AD)",
              false,
              ensureMinGaps && !intrinsicDateTypeCols ? ledgerLastDateColMinPx : undefined
            )}
          </>
        ) : (
          renderHeaderWithFilter(
            "date",
            "Date",
            false,
            ensureMinGaps && !intrinsicDateTypeCols ? ledgerLastDateColMinPx : undefined
          )
        ))}
        {showCol("type") &&
          renderHeaderWithFilter(
            "type",
            "Type",
            false,
            ensureMinGaps && !intrinsicDateTypeCols
              ? desktopSplitTableScrollGate
                ? hasSpendWiseGroups
                  ? Math.max(SPEND_WISE_TYPE_COL_PX, LEDGER_ENTITY_TYPE_COL_PX)
                  : LEDGER_ENTITY_TYPE_COL_PX
                : hasSpendWiseGroups
                  ? SPEND_WISE_TYPE_COL_PX
                  : 75
              : undefined
          )}
        {showCol("voucherNo") &&
          renderHeaderWithFilter(
            "voucherNumber",
            "Voucher No.",
            false,
            ensureMinGaps
              ? dashboardRecentFyAttachmentGate
                ? Math.max(ledgerVoucherNoColPx, LEDGER_VOUCHER_NO_HEADER_COL_PX)
                : desktopSplitTableScrollGate
                  ? tdsLedgerTableLayout
                    ? Math.max(LEDGER_TDS_VOUCHER_NO_COL_PX, ledgerVoucherNoColPx)
                    : ledgerVoucherNoColPx
                  : LEDGER_VOUCHER_NO_COL_PX
              : undefined
          )}
        {context === "daybook" &&
          renderHeaderWithFilter(
            "accounts",
            "Accounts",
            false,
            ensureMinGaps ? DAYBOOK_ACCOUNTS_COL_PX : undefined
          )}
        {isItemPartyContext && showItemPartyColumn && (
          <TableHead className="font-semibold p-0" style={ensureMinGaps ? { minWidth: "90px" } : undefined}>
            Party
          </TableHead>
        )}
        {showCol("user") && context !== "note" && renderHeaderWithFilter("user", "User", false, ensureMinGaps ? 148 : undefined)}
        {showFileBySelection && renderFileHeaderWithFilter()}
        {showCol("tdsTaxable") &&
          renderHeaderWithFilter(
            "tdsTaxable",
            "Taxable",
            true,
            ensureMinGaps ? LEDGER_TDS_TAXABLE_COL_PX : undefined
          )}
        {showCol("tdsAmount") &&
          renderHeaderWithFilter(
            "tdsAmount",
            "TDS Amount",
            true,
            ensureMinGaps ? LEDGER_TDS_AMOUNT_COL_PX : undefined
          )}
        {showCol("dr") &&
          !hideDebitColumn &&
          renderHeaderWithFilter(
            "debit",
            debitHeaderLabel,
            true,
            ensureMinGaps
              ? tdsLedgerTableLayout
                ? LEDGER_TDS_DR_CR_COL_PX
                : LEDGER_TXN_DR_CR_COL_PX
              : undefined
          )}
        {showCol("cr") &&
          !hideCreditColumn &&
          renderHeaderWithFilter(
            "credit",
            creditHeaderLabel,
            true,
            ensureMinGaps
              ? tdsLedgerTableLayout
                ? LEDGER_TDS_DR_CR_COL_PX
                : LEDGER_TXN_DR_CR_COL_PX
              : undefined
          )}
        {showCol("status") && !hideStatusColumn && renderHeaderWithFilter("status", "Status", false, ensureMinGaps ? 95 : undefined)}
        {showCol("runningBalance") &&
          !hideBalanceColumn &&
          renderHeaderWithFilter(
            "balance",
            stockView === "amount" ? "Balance" : "Stock",
            true,
            ensureMinGaps ? (desktopSplitTableScrollGate ? LEDGER_ENTITY_BALANCE_COL_PX : 115) : undefined
          )}
        <TableHead className={ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-10 p-0"} />
      </TableRow>
    </TableHeader>
  );

  const renderTransactionTableFooter = () =>
    !hideFooter ? (
      <TableFooter
        {...(desktopSplitTableScrollGate ? { "data-pl-txn-split-scroll-footer": "" } : {})}
        className={cn(
          "bg-white",
          desktopSplitTableScrollGate ? "border-0 shadow-none" : "border-t border-b border-border shadow-inner"
        )}
      >
        <TableRow data-pl-txn-footer-total-row="">
          {showCol("syncStatus") && (
            <TableCell className={cn("align-middle", ensureMinGaps && "min-w-[78px] px-[5px]")} />
          )}
          {showCol("date") &&
            (dateSystem === "Both" ? (
              <>
                <TableCell
                  className={cn("align-middle", ensureMinGaps && LEDGER_BOTH_DATE_BS_CELL_PAD_CN)}
                  style={ensureMinGaps ? { minWidth: `${ledgerDateBsColMinPx}px` } : undefined}
                />
                <TableCell
                  className={cn("align-middle", ensureMinGaps && LEDGER_TDS_LAST_DATE_CELL_PAD_CN)}
                  style={ensureMinGaps ? { minWidth: `${ledgerLastDateColMinPx}px` } : undefined}
                />
              </>
            ) : (
              <TableCell
                className={cn("align-middle", ensureMinGaps && LEDGER_TDS_LAST_DATE_CELL_PAD_CN)}
                style={ensureMinGaps ? { minWidth: `${ledgerLastDateColMinPx}px` } : undefined}
              />
            ))}
          {showCol("type") && (
            <TableCell
              className={cn(
                "align-middle",
                ensureMinGaps && LEDGER_TXN_COL_MAX_GAP_PAD_CN,
                !showCol("voucherNo") && "text-right font-semibold"
              )}
              style={
                ensureMinGaps
                  ? {
                      minWidth: `${hasSpendWiseGroups ? Math.max(SPEND_WISE_TYPE_COL_PX, LEDGER_ENTITY_TYPE_COL_PX) : LEDGER_ENTITY_TYPE_COL_PX}px`,
                    }
                  : undefined
              }
            >
              {!showCol("voucherNo") ? "Total" : null}
            </TableCell>
          )}
          {showCol("voucherNo") && (
            <TableCell
              className={cn(
                "align-middle text-right font-semibold",
                ensureMinGaps && LEDGER_TXN_BODY_CELL_PAD_CN
              )}
              style={
                ensureMinGaps && desktopSplitTableScrollGate
                  ? {
                      minWidth: `${
                        tdsLedgerTableLayout
                          ? Math.max(LEDGER_TDS_VOUCHER_NO_COL_PX, ledgerVoucherNoColPx)
                          : ledgerVoucherNoColPx
                      }px`,
                    }
                  : ensureMinGaps
                    ? { minWidth: `${LEDGER_VOUCHER_NO_COL_PX}px` }
                    : undefined
              }
            >
              Total
            </TableCell>
          )}
          {context === "daybook" && (
            <TableCell
              className={cn("align-middle", ensureMinGaps && "px-[5px]")}
              style={ensureMinGaps ? { minWidth: `${DAYBOOK_ACCOUNTS_COL_PX}px` } : undefined}
            />
          )}
          {isItemPartyContext && showItemPartyColumn && (
            <TableCell className={cn("align-middle", ensureMinGaps && "min-w-[90px] px-[5px]")} />
          )}
          {showCol("user") && context !== "note" && (
            <TableCell
              className={cn(
                "align-middle",
                ensureMinGaps &&
                  (hasTdsLedgerFooterCols ? LEDGER_TDS_USER_CELL_PAD_CN : "min-w-[148px] px-[5px]")
              )}
              style={ensureMinGaps ? { minWidth: `${LEDGER_ENTITY_USER_COL_PX}px` } : undefined}
            />
          )}
          {showFileBySelection && (
            <TableCell
              className={cn(
                "align-middle",
                ensureMinGaps &&
                  (hasTdsLedgerFooterCols ? LEDGER_TDS_FILE_CELL_PAD_CN : "min-w-[44px] px-[5px]")
              )}
              style={
                ensureMinGaps
                  ? {
                      minWidth: `${hasTdsLedgerFooterCols ? LEDGER_TDS_FILE_COL_PX : LEDGER_ENTITY_FILE_COL_PX}px`,
                    }
                  : undefined
              }
            />
          )}
          {showCol("tdsTaxable") && (
            <TableCell
              className={cn(
                "text-left font-semibold tabular-nums align-middle",
                ensureMinGaps && LEDGER_TDS_TAXABLE_CELL_PAD_CN
              )}
              style={ensureMinGaps ? { minWidth: `${LEDGER_TDS_TAXABLE_COL_PX}px` } : undefined}
            >
              {footerTdsTaxableTotal > 0 ? formatFooterAmount(footerTdsTaxableTotal) : "-"}
            </TableCell>
          )}
          {showCol("tdsAmount") && (
            <TableCell
              className={cn(
                "text-left font-semibold tabular-nums align-middle",
                ensureMinGaps && LEDGER_TDS_AMOUNT_CELL_PAD_CN
              )}
              style={ensureMinGaps ? { minWidth: `${LEDGER_TDS_AMOUNT_COL_PX}px` } : undefined}
            >
              {footerTdsAmountTotal > 0 ? formatFooterAmount(footerTdsAmountTotal) : "-"}
            </TableCell>
          )}
          {showCol("dr") && !hideDebitColumn && (
            <TableCell
              className={cn(
                "font-semibold text-green-700 align-middle",
                tdsLedgerTableLayout ? "text-left" : "text-right",
                ensureMinGaps &&
                  (tdsLedgerTableLayout
                    ? LEDGER_TDS_DR_CR_AMOUNT_CELL_CN
                    : LEDGER_TXN_DR_CR_AMOUNT_CELL_CN),
                tdsLedgerTableLayout && "text-left"
              )}
              style={
                ensureMinGaps
                  ? {
                      minWidth: `${
                        tdsLedgerTableLayout ? LEDGER_TDS_DR_CR_COL_PX : LEDGER_TXN_DR_CR_COL_PX
                      }px`,
                    }
                  : undefined
              }
            >
              {formatFooterAmount(footerTotalDr)}
            </TableCell>
          )}
          {showCol("cr") && !hideCreditColumn && (
            <TableCell
              className={cn(
                "font-semibold text-red-700 align-middle",
                tdsLedgerTableLayout ? "text-left" : "text-right",
                ensureMinGaps &&
                  (tdsLedgerTableLayout
                    ? LEDGER_TDS_DR_CR_AMOUNT_CELL_CN
                    : LEDGER_TXN_DR_CR_AMOUNT_CELL_CN),
                tdsLedgerTableLayout && "text-left"
              )}
              style={
                ensureMinGaps
                  ? {
                      minWidth: `${
                        tdsLedgerTableLayout ? LEDGER_TDS_DR_CR_COL_PX : LEDGER_TXN_DR_CR_COL_PX
                      }px`,
                    }
                  : undefined
              }
            >
              {formatFooterAmount(footerTotalCr)}
            </TableCell>
          )}
          {showCol("status") && !hideStatusColumn && (
            <TableCell className={cn("text-center font-semibold", ensureMinGaps && "min-w-[95px] px-[5px]")}>
              -
            </TableCell>
          )}
          {showCol("runningBalance") && !hideBalanceColumn && (
            <TableCell
              className={cn(
                "text-right font-semibold",
                ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN)
              )}
              style={ledgerBalanceColStyle}
            >
              -
            </TableCell>
          )}
          <TableCell className={cn(ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-10 p-0", "!bg-white dark:!bg-card")} />
        </TableRow>
        <TableRow
          data-pl-txn-footer-closing-row=""
          className={cn(
            "font-bold text-base bg-blue-100/80",
            desktopSplitTableScrollGate
              ? "border-0"
              : "border-t-2 border-black border-b-2 border-black"
          )}
        >
          <TableCell colSpan={footerClosingLabelColSpan} className="align-middle">
            <div data-pl-closing-balance-card="" className={LEDGER_CLOSING_BALANCE_CARD_ROW_CN}>
              <LedgerTxnTableTonePills value={txnTableTone} onChange={applyTxnTableTone} />
              <div className={LEDGER_CLOSING_BALANCE_TOTAL_CN}>
                {closingBalanceActions ? (
                  <div
                    data-pl-closing-balance-actions=""
                    className={cn(LEDGER_CLOSING_BALANCE_ACTIONS_CN, "mr-0")}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <AdaptiveClosingScope enabled={adaptiveClosingLabel} label={closingBalanceLabel}>{closingBalanceActions}</AdaptiveClosingScope>
                  </div>
                ) : null}
                {closingBalanceRowActions ? (
                  <div
                    data-pl-closing-balance-row-actions=""
                    className={cn(LEDGER_CLOSING_BALANCE_ACTIONS_CN, "mr-0 flex-none")}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <AdaptiveClosingScope enabled={adaptiveClosingLabel} label={closingBalanceLabel}>{closingBalanceRowActions}</AdaptiveClosingScope>
                  </div>
                ) : null}
                {adaptiveClosingLabel ? null : (
                  <span className="shrink-0 text-right">{closingBalanceLabel}</span>
                )}
              </div>
            </div>
          </TableCell>
          {showCol("runningBalance") && !hideBalanceColumn && (
            <TableCell
              className={cn(
                "text-right font-bold",
                footerClosingBalance >= 0 ? "text-green-700" : "text-red-700",
                ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN)
              )}
              style={ledgerBalanceColStyle}
            >
              {formatFooterBalance(footerClosingBalance)}
            </TableCell>
          )}
          <TableCell className={cn(ensureMinGaps ? LEDGER_TXN_ROW_MENU_CELL_CN : "w-10 p-0", "!bg-white dark:!bg-card")} />
        </TableRow>
      </TableFooter>
    ) : null;

  const tableContent = (
      <Table className={ledgerTableClassName} scrollContainer={false}>
        {recentTableColgroup}
        {!desktopSplitTableScrollGate ? recentTableHeader : null}

      <TableBody>
        <>
            {showLedgerOpeningRows && (
              useSpendWiseOpeningBalanceCard ? (
                !embedSpendWiseOpeningInGroup ? (
                  <>
                    {renderSpendWiseOpeningTableRows(false)}
                    {/* Spend-wise bank/account view: keep visual gap between OB and first group. */}
                    <tr data-row="opening-balance-gap" aria-hidden="true" className="spend-wise-gap-row">
                      <td
                        colSpan={fullRowColSpan}
                        className="p-0 m-0 border-0 bg-transparent align-middle"
                        style={{ height: "12px", minHeight: "12px", lineHeight: 0, verticalAlign: "middle" }}
                      />
                    </tr>
                  </>
                ) : null
              ) : (
                <>
                  {/* Non–spend-wise: Book + Dated pills (dual jab filter + master OB alag ho); narration dual mein book ke baad */}
                  {showBookOpeningAboveDatedRow && (
                    <tr
                      data-row="opening-book"
                      data-ob-narration-follows={showBookOpeningAboveDatedRow && hideBookOpeningRowBottomBeforeSubRow ? true : undefined}
                      className={cn(
                        hideBookOpeningRowBottomBeforeSubRow && "border-b-0 [&>td]:border-b-0",
                        hideBookOpeningRowBottomBeforeSubRow && "[&>td]:!pb-0"
                      )}
                    >
                      {renderOpeningBalanceDateCells(openingBalanceRowDate)}
                      {renderOpeningBalanceMiddleCells(
                        bookOpeningRowPillText,
                        false,
                        masterBookSignedScaled >= 0 ? "dr" : "cr"
                      )}
                      {renderOpeningBalanceUserCell()}
                      {showFileBySelection && (
                        <TableCell
                          className={cn("text-center align-top", ensureMinGaps && "min-w-[44px] px-[5px]")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <OpeningBalanceFileCellContent fileUrls={openingBalanceAttachmentUrls} displayMode={fileDisplayMode} showAll={fileShowAll} />
                        </TableCell>
                      )}
                      {renderOpeningBalanceTdsCells()}
                      {showCol("dr") && !hideDebitColumn && (
                        <TableCell className={cn("text-right text-green-700 font-semibold align-top", ensureMinGaps && "min-w-[100px] px-[5px]")}>
                          {renderOpeningBalanceDrCrCell("dr", bookRowOpeningDr, bookRowOpeningCr, LEDGER_OB_BOOK_KEY)}
                        </TableCell>
                      )}
                      {showCol("cr") && !hideCreditColumn && (
                        <TableCell className={cn("text-right text-red-700 font-semibold align-top", ensureMinGaps && "min-w-[100px] px-[5px]")}>
                          {renderOpeningBalanceDrCrCell("cr", bookRowOpeningDr, bookRowOpeningCr, LEDGER_OB_BOOK_KEY)}
                        </TableCell>
                      )}
                      {showCol("status") && !hideStatusColumn && (
                        <TableCell className={cn("text-center align-top", ensureMinGaps && "min-w-[95px] px-[5px]")}>
                          <span className="font-semibold">-</span>
                        </TableCell>
                      )}
                      {showCol("runningBalance") && !hideBalanceColumn && (
                        <TableCell className={cn("text-right font-semibold align-top", masterBookSignedScaled >= 0 ? "text-green-600" : "text-red-600", ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN))} style={ledgerBalanceColStyle}>
                          {bookOpeningAmountVisible ? formatFooterBalance(billWiseBookOpeningBalance) : "-"}
                        </TableCell>
                      )}
                      <TableCell className={LEDGER_TXN_ROW_MENU_CELL_CN} onClick={(e) => e.stopPropagation()}>
                        {renderOpeningBalanceRowMenu()}
                      </TableCell>
                    </tr>
                  )}
                  {showBookOpeningAboveDatedRow && openingBalanceNarrationRow()}
                  <tr
                    data-row="opening-balance-dated"
                    data-ob-narration-follows={!showBookOpeningAboveDatedRow && hideDatedOpeningRowBottomBeforeSubRow ? true : undefined}
                    className={cn(
                      hideDatedOpeningRowBottomBeforeSubRow && "border-b-0 [&>td]:border-b-0",
                      hideDatedOpeningRowBottomBeforeSubRow && "[&>td]:!pb-0"
                    )}
                  >
                    {renderOpeningBalanceDateCells(datedOpeningBalanceRowDate)}
                    {renderOpeningBalanceMiddleCells(
                      primaryOpeningRowPillText,
                      true,
                      displayOpeningForDrCr >= 0 ? "dr" : "cr"
                    )}
                    {renderOpeningBalanceUserCell()}
                    {showFileBySelection && (
                      <TableCell
                        className={cn("text-center align-top", ensureMinGaps && "min-w-[44px] px-[5px]")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <OpeningBalanceFileCellContent
                          fileUrls={showBookOpeningAboveDatedRow ? undefined : openingBalanceAttachmentUrls}
                          displayMode={fileDisplayMode}
                          showAll={fileShowAll}
                        />
                      </TableCell>
                    )}
                    {renderOpeningBalanceTdsCells()}
                    {showCol("dr") && !hideDebitColumn && (
                      <TableCell className={cn("text-right text-green-700 font-semibold align-top", ensureMinGaps && "min-w-[100px] px-[5px]")}>
                        {!authoritativeOpeningPending
                          ? renderOpeningBalanceDrCrCell("dr", billWiseDatedOpeningDrCr.debit, billWiseDatedOpeningDrCr.credit, LEDGER_OB_DATED_KEY)
                          : "-"}
                      </TableCell>
                    )}
                    {showCol("cr") && !hideCreditColumn && (
                      <TableCell className={cn("text-right text-red-700 font-semibold align-top", ensureMinGaps && "min-w-[100px] px-[5px]")}>
                        {!authoritativeOpeningPending
                          ? renderOpeningBalanceDrCrCell("cr", billWiseDatedOpeningDrCr.debit, billWiseDatedOpeningDrCr.credit, LEDGER_OB_DATED_KEY)
                          : "-"}
                      </TableCell>
                    )}
                    {showCol("status") && !hideStatusColumn && (
                      <TableCell className={cn("text-center align-top", ensureMinGaps && "min-w-[95px] px-[5px]")}>
                        {openingBalanceOutstanding != null && !(hasFyOpeningRowsInLedger && shouldUseOutstandingBalance) ? (
                          <div className="flex flex-col items-center gap-[1px] leading-tight">
                            <Badge
                              variant="outline"
                              className={cn(
                                "inline-flex h-6 items-center rounded-xl px-2.5 font-medium leading-none shrink-0",
                                openingBalanceOutstanding <= 0 ? "text-green-600 border-green-600/50" : "text-red-600 border-red-600/50"
                              )}
                            >
                              {openingBalanceOutstanding <= 0 ? "Paid" : openingBalanceOutstanding >= obAmount ? "Unpaid" : "Partial"}
                            </Badge>
                            {showNarration && openingBalanceLinkedVoucherNos?.length && !isBillWiseMode ? (
                              <LinkedVouchersColored vouchers={openingBalanceLinkedVoucherNos} align="center" />
                            ) : null}
                          </div>
                        ) : (
                          <span className="font-semibold">-</span>
                        )}
                      </TableCell>
                    )}
                    {showCol("runningBalance") && !hideBalanceColumn && (
                        <TableCell className={cn("text-right font-semibold align-top", billWiseDatedOpeningBalance >= 0 ? "text-green-600" : "text-red-600", ensureMinGaps && cn("tabular-nums", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN))} style={ledgerBalanceColStyle}>
                            {formatOpeningRowBalanceCell(billWiseDatedOpeningBalance, datedOpeningAmountVisible)}
                        </TableCell>
                    )}
                    <TableCell className={LEDGER_TXN_ROW_MENU_CELL_CN} onClick={(e) => e.stopPropagation()}>
                        {renderOpeningBalanceRowMenu()}
                    </TableCell>
                  </tr>
                  {!showBookOpeningAboveDatedRow && openingBalanceNarrationRow()}
                  {openingBalanceLinkedOnlyRow()}
                </>
              )
            )}
            {rowsForRender.length > 0 ? (
              tableBlocks ? (
                <AnimatePresence
                  key={ledgerListAnimateKey}
                  mode={ledgerDateFilterActive ? "sync" : "popLayout"}
                  initial={false}
                >
                  {(() => {
                    let txnStripeSeq = 0;
                    return tableBlocks.map((block, blockIndex) => {
                    if (block.type === "spacer") {
                      return (
                        <React.Fragment key={block.id}>
                          <motion.tr
                            layout={false}
                            initial={false}
                            exit={{ transition: { duration: 0 } }}
                            aria-hidden="true"
                            className="spend-wise-gap-row"
                          >
                            <td
                              colSpan={openingBalanceColSpan + visibleDebitCol + visibleCreditCol + visibleStatusCol + visibleBalanceCol + 1}
                              className="p-0 m-0 border-0 bg-transparent align-middle"
                              style={{ height: "12px", minHeight: "12px", lineHeight: 0, verticalAlign: "middle" }}
                            />
                          </motion.tr>
                        </React.Fragment>
                      );
                    }
                    if (block.type === "group") {
                      // Stable key by first item (payment_in) so date reorder doesn't remount — all cards animate same speed
                      const groupKey = `group-${block.items[0]?.id ?? block.items.map((t: any) => t.id).join("-")}`;
                      const embedOpeningHere =
                        embedSpendWiseOpeningInGroup && blockIndex === spendWiseOpeningEmbedBlockIndex;
                      const innerColSpan = spendWiseColWidths.length || fullRowColSpan;
                      const tableGroupCardClass = (colorIndex: number, clippedTop?: boolean, clippedBottom?: boolean) =>
                        cn(
                          // Add a same-color outer outline so rounded corners look uniformly thick.
                          "overflow-hidden border-[2.5px] shadow-sm",
                          clippedTop && clippedBottom
                            ? "rounded-none border-y-0"
                            : clippedTop
                              ? "rounded-b-xl border-t-0"
                              : clippedBottom
                                ? "rounded-t-xl border-b-0"
                                : "rounded-xl",
                          colorIndex === 1 && "border-green-500 bg-green-50/50 dark:bg-green-950/20",
                          colorIndex === 2 && "border-pink-500 bg-pink-50/50 dark:bg-pink-950/20",
                          (colorIndex === 0 || colorIndex === 3) && "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
                          !clippedTop && !clippedBottom && colorIndex === 1 && "outline outline-1 outline-green-500/80",
                          !clippedTop && !clippedBottom && colorIndex === 2 && "outline outline-1 outline-pink-500/80",
                          !clippedTop && !clippedBottom && (colorIndex === 0 || colorIndex === 3) && "outline outline-1 outline-blue-500/80"
                        );
                      return (
                        <tr key={groupKey} className="spend-wise-group-card-row">
                          <td
                            colSpan={fullRowColSpan}
                            className="p-0 align-top border-none bg-transparent"
                            style={{ verticalAlign: "top" }}
                          >
                            <motion.div
                              layout={useTxnRowLayoutAnimation && !ledgerDateFilterActive ? "position" : false}
                              initial={false}
                              exit={{ transition: { duration: 0 } }}
                              transition={{ duration: rowAnimationDuration, ease: "easeInOut" }}
                              data-pl-spend-group-card=""
                              className={tableGroupCardClass(block.colorIndex, block.clippedTop, block.clippedBottom)}
                            >
                              {/* Inner spend-wise rows should follow the same min-width contract as the outer header table. */}
                              <table className="w-full min-w-full border-0 border-collapse table-fixed">
                                {spendWiseColWidths.length > 0 && (
                                  <colgroup>
                                    {spendWiseColWidths.map((width, i) => (
                                      <col key={i} style={{ width: `${width}px` }} />
                                    ))}
                                  </colgroup>
                                )}
                                <tbody>
                                  {embedOpeningHere ? renderSpendWiseOpeningTableRows(true) : null}
                                  {embedOpeningHere && block.items.length > 0 ? (
                                    <tr aria-hidden="true" className="spend-wise-inner-txn-sep">
                                      <td colSpan={innerColSpan} />
                                    </tr>
                                  ) : null}
                                  {block.items.map((t: any, itemIdx: number) => {
                                    const rowKey = (t as any)._rowKey ?? (t as any).id;
                                    const txnStripeIndex = txnStripeSeq++;
                                    return (
                                      <React.Fragment key={rowKey}>
                                        <TransactionRow
                                          txnStripeIndex={txnStripeIndex}
                                          transaction={t}
                                          fullRowColSpan={fullRowColSpan}
                                          fiscalPartitionClosingSummary={fiscalPartitionSummaryForTxn(t)}
                                          fiscalPartitionColumnLayout={fiscalPartitionColumnLayout}
                                          animateLayout={useTxnRowLayoutAnimation}
                                          layoutTransition={isRowAnimationEnabled ? { duration: rowAnimationDuration, ease: "easeInOut" } : { duration: 0 }}
                                          isSpendWiseChild={
                                            !!(t as any)._spendWiseChild ||
                                            !!(t as any)._billWiseLinkPreviewGroupLast
                                          }
                                          isSpendWiseGroupFirst={
                                            !!(t as any)._billWiseLinkPreviewGroupFirst ||
                                            !!(t as any)._spendWiseGroupFirst
                                          }
                                          isSpendWiseGroupLast={
                                            !!(t as any)._billWiseLinkPreviewGroupLast ||
                                            !!(t as any)._spendWiseGroupLast
                                          }
                                          spendWiseRunningBalance={(t as any)._spendWiseRunningBalance}
                                          spendWiseGroupColorIndex={
                                            (t as any)._billWiseLinkPreviewGroupColorIndex ??
                                            (t as any)._spendWiseGroupColorIndex
                                          }
                                          spendWiseGroupSize={block.items.length}
                                          spendWiseInGroupCard
                                          blinkMode={blinkMode}
                                          showNarration={showNarration}
                                          userNames={userNames}
                                          journalAccountNames={journalAccountNames}
                                          accountNames={accountNames}
                                          context={context}
                                          contextId={contextId}
                                          groupEntityType={groupEntityType}
                                          showItemPartyColumn={showItemPartyColumn}
                                          stockView={stockView}
                                          displayUnit={displayUnit}
                                          item={item}
                                          onRowClick={onRowClick}
                                          onAddLink={onAddLink}
                                          onHistoryVoucher={onHistoryVoucher}
                                          onMoveVoucherToRecycleBin={onMoveVoucherToRecycleBin}
                                          onApproveVoucher={effectiveOnApproveVoucher}
                                          onUnapproveVoucher={effectiveOnUnapproveVoucher}
                                          onApproveAllVisible={handleApproveAllVisible}
                                          showApproveAll={showApproveAllOnPage}
                                          {...getStatementCheckRowProps(t)}
                                          isRelatedBlink={getIsRelatedBlink(t)}
                                          isSelectedRowBlink={getIsSelectedRowBlink(t)}
                                          getDisplayValue={getDisplayValue}
                                          isTaxContext={isTaxContext}
                                          isBalanceMasked={isBalanceMasked}
                                          hideBalanceColumn={hideBalanceColumn}
                                          hideStatusColumn={hideStatusColumn}
                                          visibleColumns={visibleColumns}
                                          useOutstandingForBalance={shouldUseOutstandingBalance}
                                          isBillWise={isBillWiseMode}
                                          ensureMinGaps={ensureMinGaps}
                                          showFileColumn={showFileBySelection}
                                          fileDisplayMode={fileDisplayMode}
                                          fileShowAll={fileShowAll}
                                          statusBillWiseOnly={statusBillWiseOnly}
                                          highlightPendingApproval={highlightPendingApproval}
                                          enforceCurrentFyAttachmentAutoLoad={enforceCurrentFyAttachmentAutoLoad}
                                          syncInFlight={syncingVoucherIds.has(String((t as any).id || ""))}
                                          onSyncNow={handleSyncVoucherNow}
                                          onInterCompanyChangeDetectedClick={onInterCompanyChangeDetectedClick}
                                          activeRecurringTriggerVoucherIds={activeRecurringTriggerVoucherIds}
                                          textSearchHighlight={rowTextSearchHighlight}
                                          columnFilters={filters}
                                          showOpeningBalanceAmount={
                                            (t as any).type === FY_OPENING_ROW_TYPE
                                              ? isLedgerOpeningAmountVisible(
                                                  ledgerFyOpeningAmountKey(String((t as any).id || ""))
                                                )
                                              : true
                                          }
                                          onToggleOpeningBalanceAmount={
                                            LEDGER_OPENING_HIDE_AMOUNT_ENABLED &&
                                            (t as any).type === FY_OPENING_ROW_TYPE
                                              ? (e: React.MouseEvent) =>
                                                  toggleLedgerOpeningAmountVisible(
                                                    ledgerFyOpeningAmountKey(String((t as any).id || "")),
                                                    e
                                                  )
                                              : undefined
                                          }
                                          {...getBillWiseLinkPreviewRowProps(t)}
                                          {...getSpendWiseRowMenuProps(t)}
                                        />
                                        {/* Card ke andar txn ke beech — alag sep row (zoom-stable border-top) */}
                                        {itemIdx < block.items.length - 1 ? (
                                          <tr aria-hidden="true" className="spend-wise-inner-txn-sep">
                                            <td colSpan={innerColSpan} />
                                          </tr>
                                        ) : null}
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </motion.div>
                          </td>
                        </tr>
                      );
                    }
                    const t = block.item;
                    const rowKey = (t as any)._rowKey ?? (t as any).id;
                    const txnStripeIndex = txnStripeSeq++;
                    return (
                      <React.Fragment key={rowKey}>
                        <TransactionRow
                          key={rowKey}
                          txnStripeIndex={txnStripeIndex}
                          transaction={t}
                          fullRowColSpan={fullRowColSpan}
                          fiscalPartitionClosingSummary={fiscalPartitionSummaryForTxn(t)}
                          fiscalPartitionColumnLayout={fiscalPartitionColumnLayout}
                          animateLayout={useTxnRowLayoutAnimation}
                          layoutTransition={isRowAnimationEnabled ? { duration: rowAnimationDuration, ease: "easeInOut" } : { duration: 0 }}
                          isSpendWiseChild={!!(t as any)._spendWiseChild}
                          isSpendWiseGroupFirst={!!(t as any)._spendWiseGroupFirst}
                          isSpendWiseGroupLast={!!(t as any)._spendWiseGroupLast}
                          spendWiseRunningBalance={(t as any)._spendWiseRunningBalance}
                          spendWiseGroupColorIndex={(t as any)._spendWiseGroupColorIndex}
                          spendWiseGroupSize={1}
                          blinkMode={blinkMode}
                          showNarration={showNarration}
                          userNames={userNames}
                          journalAccountNames={journalAccountNames}
                          accountNames={accountNames}
                          context={context}
                          contextId={contextId}
                          groupEntityType={groupEntityType}
                          showItemPartyColumn={showItemPartyColumn}
                          stockView={stockView}
                          displayUnit={displayUnit}
                          item={item}
                          onRowClick={onRowClick}
                          onAddLink={onAddLink}
                          onHistoryVoucher={onHistoryVoucher}
                          onMoveVoucherToRecycleBin={onMoveVoucherToRecycleBin}
                          onApproveVoucher={effectiveOnApproveVoucher}
                          onUnapproveVoucher={effectiveOnUnapproveVoucher}
                          onApproveAllVisible={handleApproveAllVisible}
                          showApproveAll={showApproveAllOnPage}
                          {...getStatementCheckRowProps(t)}
                          isRelatedBlink={getIsRelatedBlink(t)}
                          isSelectedRowBlink={getIsSelectedRowBlink(t)}
                          getDisplayValue={getDisplayValue}
                          isTaxContext={isTaxContext}
                          isBalanceMasked={isBalanceMasked}
                          hideBalanceColumn={hideBalanceColumn}
                          hideStatusColumn={hideStatusColumn}
                          visibleColumns={visibleColumns}
                          useOutstandingForBalance={shouldUseOutstandingBalance}
                          isBillWise={isBillWiseMode}
                          ensureMinGaps={ensureMinGaps}
                          showFileColumn={showFileBySelection}
                          fileDisplayMode={fileDisplayMode}
                          fileShowAll={fileShowAll}
                          statusBillWiseOnly={statusBillWiseOnly}
                          highlightPendingApproval={highlightPendingApproval}
                          enforceCurrentFyAttachmentAutoLoad={enforceCurrentFyAttachmentAutoLoad}
                          syncInFlight={syncingVoucherIds.has(String((t as any).id || ""))}
                          onSyncNow={handleSyncVoucherNow}
                          onInterCompanyChangeDetectedClick={onInterCompanyChangeDetectedClick}
                          activeRecurringTriggerVoucherIds={activeRecurringTriggerVoucherIds}
                          textSearchHighlight={rowTextSearchHighlight}
                          columnFilters={filters}
                          showOpeningBalanceAmount={
                            (t as any).type === FY_OPENING_ROW_TYPE
                              ? isLedgerOpeningAmountVisible(
                                  ledgerFyOpeningAmountKey(String((t as any).id || ""))
                                )
                              : true
                          }
                          onToggleOpeningBalanceAmount={
                            LEDGER_OPENING_HIDE_AMOUNT_ENABLED &&
                            (t as any).type === FY_OPENING_ROW_TYPE
                              ? (e: React.MouseEvent) =>
                                  toggleLedgerOpeningAmountVisible(
                                    ledgerFyOpeningAmountKey(String((t as any).id || "")),
                                    e
                                  )
                              : undefined
                          }
                          {...getBillWiseLinkPreviewRowProps(t)}
                          {...getSpendWiseRowMenuProps(t)}
                        />
                      </React.Fragment>
                    );
                  });
                  })()}
                </AnimatePresence>
              ) : (
                <AnimatePresence
                  key={ledgerListAnimateKey}
                  mode={ledgerDateFilterActive ? "sync" : "popLayout"}
                  initial={false}
                >
                  {(() => {
                    let txnStripeSeq = 0;
                    return rowsForRender.map((t: any, rowIndex: number) => {
                      const rowKey = (t as any)._rowKey ?? (t as any).id ?? `row-${rowIndex}`;
                      return (t as any)._spendWiseSpacer ? (
                        <motion.tr
                          key={rowKey}
                          layout={false}
                          initial={false}
                          exit={{ transition: { duration: 0 } }}
                          aria-hidden="true"
                          className="spend-wise-gap-row"
                        >
                          <td
                            colSpan={openingBalanceColSpan + visibleDebitCol + visibleCreditCol + visibleStatusCol + visibleBalanceCol + 1}
                            className="p-0 m-0 border-0 bg-transparent align-middle"
                            style={{ height: "12px", minHeight: "12px", lineHeight: 0, verticalAlign: "middle" }}
                          />
                        </motion.tr>
                      ) : (
                        <TransactionRow
                          key={rowKey}
                          txnStripeIndex={txnStripeSeq++}
                          transaction={t}
                          fullRowColSpan={fullRowColSpan}
                          fiscalPartitionClosingSummary={fiscalPartitionSummaryForTxn(t)}
                          fiscalPartitionColumnLayout={fiscalPartitionColumnLayout}
                          animateLayout={useTxnRowLayoutAnimation}
                          layoutTransition={isRowAnimationEnabled ? { duration: rowAnimationDuration, ease: "easeInOut" } : { duration: 0 }}
                          isSpendWiseChild={!!(t as any)._spendWiseChild}
                          isSpendWiseGroupFirst={!!(t as any)._spendWiseGroupFirst}
                          isSpendWiseGroupLast={!!(t as any)._spendWiseGroupLast}
                          spendWiseRunningBalance={(t as any)._spendWiseRunningBalance}
                          spendWiseGroupColorIndex={(t as any)._spendWiseGroupColorIndex}
                          blinkMode={blinkMode}
                          showNarration={showNarration}
                          userNames={userNames}
                          journalAccountNames={journalAccountNames}
                          accountNames={accountNames}
                          context={context}
                          contextId={contextId}
                          groupEntityType={groupEntityType}
                          showItemPartyColumn={showItemPartyColumn}
                          stockView={stockView}
                          displayUnit={displayUnit}
                          item={item}
                          onRowClick={onRowClick}
                          onAddLink={onAddLink}
                          onHistoryVoucher={onHistoryVoucher}
                          onMoveVoucherToRecycleBin={onMoveVoucherToRecycleBin}
                          onApproveVoucher={effectiveOnApproveVoucher}
                          onUnapproveVoucher={effectiveOnUnapproveVoucher}
                          onApproveAllVisible={handleApproveAllVisible}
                          showApproveAll={showApproveAllOnPage}
                          {...getStatementCheckRowProps(t)}
                          isRelatedBlink={getIsRelatedBlink(t)}
                          isSelectedRowBlink={getIsSelectedRowBlink(t)}
                          getDisplayValue={getDisplayValue}
                          isTaxContext={isTaxContext}
                          isBalanceMasked={isBalanceMasked}
                          hideBalanceColumn={hideBalanceColumn}
                          hideStatusColumn={hideStatusColumn}
                          visibleColumns={visibleColumns}
                          useOutstandingForBalance={shouldUseOutstandingBalance}
                          isBillWise={isBillWiseMode}
                          ensureMinGaps={ensureMinGaps}
                          showFileColumn={showFileBySelection}
                          fileDisplayMode={fileDisplayMode}
                          fileShowAll={fileShowAll}
                          statusBillWiseOnly={statusBillWiseOnly}
                          highlightPendingApproval={highlightPendingApproval}
                          enforceCurrentFyAttachmentAutoLoad={enforceCurrentFyAttachmentAutoLoad}
                          syncInFlight={syncingVoucherIds.has(String((t as any).id || ""))}
                          onSyncNow={handleSyncVoucherNow}
                          onInterCompanyChangeDetectedClick={onInterCompanyChangeDetectedClick}
                          activeRecurringTriggerVoucherIds={activeRecurringTriggerVoucherIds}
                          textSearchHighlight={rowTextSearchHighlight}
                          columnFilters={filters}
                          showOpeningBalanceAmount={
                            (t as any).type === FY_OPENING_ROW_TYPE
                              ? isLedgerOpeningAmountVisible(
                                  ledgerFyOpeningAmountKey(String((t as any).id || ""))
                                )
                              : true
                          }
                          onToggleOpeningBalanceAmount={
                            LEDGER_OPENING_HIDE_AMOUNT_ENABLED &&
                            (t as any).type === FY_OPENING_ROW_TYPE
                              ? (e: React.MouseEvent) =>
                                  toggleLedgerOpeningAmountVisible(
                                    ledgerFyOpeningAmountKey(String((t as any).id || "")),
                                    e
                                  )
                              : undefined
                          }
                          {...getBillWiseLinkPreviewRowProps(t)}
                          {...getSpendWiseRowMenuProps(t)}
                        />
                      );
                    });
                  })()}
                </AnimatePresence>
              )
            ) : (
             <tr key="no-records-row">
              <TableCell
                colSpan={openingBalanceColSpan + visibleDebitCol + visibleCreditCol + visibleStatusCol + visibleBalanceCol + 1}
                className="text-center text-gray-500 py-2"
              >
                No matching records found
              </TableCell>
            </tr>
            )}
        </>
      </TableBody>
       
       {!desktopSplitTableScrollGate ? renderTransactionTableFooter() : null}
      </Table>
  );

  return (
    <div className="pl-ledger-detail-table-shell flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {desktopSplitTableScrollGate ? (
        <div
          ref={dashboardRecentHeaderScrollRef}
          {...(dashboardRecentFyAttachmentGate ? { "data-pl-dashboard-recent-txn-header": "" } : {})}
          {...(ledgerDesktopSplitScrollGate ? { "data-pl-ledger-txn-header": "" } : {})}
          data-theme-table="transactions"
          data-pl-txn-table-tone={txnTableTone}
          className={cn(
            "w-full shrink-0 overflow-y-hidden pl-dashboard-recent-txn-header-scroll pl-dashboard-recent-hide-hscroll",
            ledgerUnifiedHScrollActive || dashboardRecentFyAttachmentGate
              ? cn(
                  "max-w-none overflow-x-hidden",
                  dashboardRecentFyAttachmentGate ? "min-w-0" : "min-w-full"
                )
              : "min-w-0 max-w-full overflow-x-auto"
          )}
          onScroll={
            ledgerUnifiedHScrollActive
              ? undefined
              : (e) => syncDashboardRecentHorizontalScroll(e.currentTarget.scrollLeft, "header")
          }
        >
          <Table className={ledgerTableClassName} scrollContainer={false}>
            {recentTableColgroup}
            {recentTableHeader}
          </Table>
        </div>
      ) : null}
      {ledgerDesktopSplitScrollGate ? (
        <div
          data-pl-ledger-txn-header-divider=""
          aria-hidden="true"
          className="w-full shrink-0 bg-black"
          style={{ height: 1, minHeight: 1 }}
        />
      ) : null}
      <div
        ref={tableContainerRef}
        tabIndex={0}
        role="grid"
        aria-label="Transactions"
        data-theme-table="transactions"
        data-pl-txn-table-tone={txnTableTone}
        {...(dashboardRecentFyAttachmentGate ? { "data-pl-dashboard-recent-txn": "" } : {})}
        {...(ledgerDesktopSplitScrollGate ? { "data-pl-ledger-txn": "" } : {})}
        className={cn(
          "w-full pl-ledger-txn-scroll-native outline-none focus:outline-none",
          desktopSplitTableScrollGate
            ? cn(
                "h-0 min-h-0 max-w-full flex-1 overflow-y-auto overflow-x-hidden pl-dashboard-recent-hide-hscroll",
                dashboardRecentFyAttachmentGate ? "min-w-0" : "min-w-full"
              )
            : "overflow-x-auto",
          tableScrollBottomBorderCn
        )}
        onScroll={
          desktopSplitTableScrollGate
            ? (e) => syncDashboardRecentHorizontalScroll(e.currentTarget.scrollLeft, "body")
            : undefined
        }
        onKeyDown={handleTableKeyDown}
        onClick={() => tableContainerRef.current?.focus()}
      >
        {tableContent}
      </div>
      {desktopSplitTableScrollGate && !hideFooter ? (
        <div
          data-pl-ledger-txn-fixed-summary=""
          data-theme-table="transactions"
          data-pl-txn-table-tone={txnTableTone}
          className={cn(
            "w-full min-w-full max-w-full shrink-0 bg-blue-100/80",
            ledgerUnifiedHScrollActive ? "overflow-x-visible overflow-y-visible" : "overflow-hidden"
          )}
          style={
            splitScrollTableMinPx > 0
              ? ({ minWidth: `${splitScrollTableMinPx}px` } as React.CSSProperties)
              : undefined
          }
        >
          <Table className={ledgerTableClassName} scrollContainer={false}>
            {recentTableColgroup}
            {renderTransactionTableFooter()}
          </Table>
        </div>
      ) : null}
      {desktopSplitTableScrollGate && !ledgerUnifiedHScrollActive && !dashboardRecentFyAttachmentGate ? (
        <div
          ref={dashboardRecentFooterHScrollRef}
          {...(dashboardRecentFyAttachmentGate ? { "data-pl-dashboard-recent-txn-hscroll": "" } : {})}
          {...(ledgerDesktopSplitScrollGate ? { "data-pl-ledger-txn-hscroll": "" } : {})}
          className="h-[var(--pl-ledger-txn-scroll-size)] w-full min-w-0 max-w-full shrink-0 overflow-x-auto overflow-y-hidden pl-ledger-txn-scroll-native"
          onScroll={(e) => syncDashboardRecentHorizontalScroll(e.currentTarget.scrollLeft, "footer")}
          aria-hidden
        >
          <div className="h-px" style={{ width: Math.max(dashboardRecentHScrollWidth, 0) }} />
        </div>
      ) : null}
      {!desktopSplitTableScrollGate ? (
        <div className="pl-ledger-detail-empty-fill min-h-0 flex-1" aria-hidden />
      ) : null}
    </div>
  );
}
