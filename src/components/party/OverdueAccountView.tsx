"use client";

import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { differenceInDays } from "date-fns";
import { useDate } from "@/hooks/useDate";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { motion, AnimatePresence } from "framer-motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { sortTransactionsWithFiscalMergeForCompany, sortTransactions, DEFAULT_TRANSACTION_SORT_ORDER } from "@/lib/transactionSort";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, CheckSquare, Filter, Pencil, Printer, History, X } from "lucide-react";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
import {
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_BOX_CN,
  LEDGER_HEADER_NAME_CARD_CN,
  LEDGER_HEADER_BALANCE_CARD_CN,
  LEDGER_HEADER_BALANCE_STACK_CN,
  LEDGER_HEADER_BALANCE_LABEL_CN,
  LEDGER_HEADER_TITLE_CN,
  LEDGER_HEADER_BALANCE_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_PILL_ROW_CN,
  LEDGER_TXN_PAGE_ROOT_CN,
  LEDGER_ENTITY_BALANCE_COL_PX,
  LEDGER_TXN_BALANCE_TO_MENU_PAD_CN,
  LEDGER_TXN_ROW_MENU_CELL_CN,
  LEDGER_TXN_ROW_MENU_COL_PX,
} from "@/lib/ledgerHeaderChrome";
import { txnSelectedMainRowCn, txnSelectedNarrationRowCn, txnTableIconBtnCn } from "@/lib/listSelectionChrome";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import {
  LEDGER_TXN_TABLE_TONE_CHANGED_EVENT,
  readLedgerTxnTableTone,
  type LedgerTxnTableTone,
} from "@/lib/ledgerTxnTableTone";
import { getVoucherAttachmentUrlsForUi } from "@/lib/voucherAttachmentNormalize";
import {
  resolveTxnDrCrSide,
  transactionRowHasFileAttachment,
  OpeningBalanceFileCellContent,
  voucherTypePillClassName,
  getStatusLabels,
  getStatusBadgeOutlineClassName,
  getStatusDetailVouchers,
  LinkedVouchersColoredCollapsible,
  transactionIsOverdueStatus,
  STATUS_LABEL_PARTIAL_OVERDUE,
  type FileColumnDisplayMode,
} from "@/components/vouchers/transactionTableShared";
import {
  matchesOverdueImportanceFilter,
  readOverdueImportanceFilter,
  writeOverdueImportanceFilter,
  type OverdueImportanceFilter,
} from "@/lib/overdueImportanceFilter";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import {
  ROWS_PER_PAGE_OPTIONS_DEFAULT,
  rowsPerPageSelectValue,
} from "@/lib/rowsPerPageSelect";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { openPrintDirect } from "@/lib/printDirect";
import { toast } from "sonner";
import { formatVoucherEntryTimeLocal, parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import {
  buildFiscalMergePartitionEntriesFromCompany,
  insertFiscalPartitionRowsMulti,
  FISCAL_YEAR_PARTITION_ROW_TYPE,
} from "@/lib/fiscalPartitionRows";
import {
  buildFiscalMergePartitionBannerLabelForDateSystem,
  parseFiscalPartitionBoundaryMs,
} from "@/lib/fiscalYearLabel";

export type OverdueColumnKey = "date" | "type" | "voucherNo" | "party" | "user" | "file" | "debit" | "credit" | "status" | "netBalance";
const OVERDUE_COLUMN_LABELS: Record<OverdueColumnKey, string> = {
  date: "Date",
  type: "Type",
  voucherNo: "Voucher No.",
  party: "Accounts",
  user: "User",
  file: "File",
  debit: "Debit",
  credit: "Credit",
  status: "Status",
  netBalance: "Net Balance",
};
type OverdueVisibleColumns = Record<OverdueColumnKey, boolean>;
const DEFAULT_OVERDUE_VISIBLE: OverdueVisibleColumns = {
  date: true,
  type: true,
  voucherNo: true,
  party: true,
  user: true,
  file: true,
  debit: true,
  credit: true,
  status: true,
  netBalance: true,
};
const OVERDUE_FILE_COLUMN_VIEW_PREF_KEY = "pocket-ledger:transactions:file-column-view:v1";

function readOverdueFileColumnPrefs(): { displayMode: FileColumnDisplayMode; showAll: boolean } {
  if (typeof window === "undefined") return { displayMode: "preview", showAll: false };
  try {
    const raw = window.localStorage.getItem(OVERDUE_FILE_COLUMN_VIEW_PREF_KEY);
    if (!raw) return { displayMode: "preview", showAll: false };
    const parsed = JSON.parse(raw) as { displayMode?: unknown; showAll?: unknown };
    const displayMode: FileColumnDisplayMode = parsed.displayMode === "tick" ? "tick" : "preview";
    return { displayMode, showAll: displayMode === "preview" && parsed.showAll === true };
  } catch {
    return { displayMode: "preview", showAll: false };
  }
}

function saveOverdueFileColumnPrefs(displayMode: FileColumnDisplayMode, showAll: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    OVERDUE_FILE_COLUMN_VIEW_PREF_KEY,
    JSON.stringify({ displayMode, showAll: displayMode === "preview" && showAll })
  );
}

export type OverdueTransactionRow = {
  id: string;
  type: string;
  date: any;
  voucherNumber: string;
  partyId: string;
  partyName: string;
  total: number;
  outstanding: number;
  debit: number;
  credit: number;
  dueDate?: any;
  isOverdue: boolean;
  paymentStatus: string;
  /** Sale/Purchase form: Due Date ke niche tick — Important filter ke liye */
  overdueImportant?: boolean;
  userId?: string;
  userName?: string;
  narration?: string;
  fileUrls?: string[];
  unassignedFile?: unknown;
  createdAt?: any;
  lastEditedAt?: any;
  updatedAt?: any;
};

const safeToDate = (date: any): Date | null => {
  // Overdue restore/read path can receive Firestore Timestamp JSON; keep days/date display in sync with voucher parser.
  return parseFirestoreDateFieldToJsDate(date);
};

function getOverdueDays(dueDate: any): number {
  const due = safeToDate(dueDate);
  if (!due) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueOnly = new Date(due);
  dueOnly.setHours(0, 0, 0, 0);
  if (today <= dueOnly) return 0;
  return differenceInDays(today, dueOnly);
}

const resolveUserName = (t: OverdueTransactionRow, userNames: Record<string, string>): string => {
  const mappedName = t.userId ? userNames[t.userId] : undefined;
  if (mappedName && mappedName !== "Unknown" && mappedName !== "N/A") return mappedName;
  if (t.userName && t.userName !== "Unknown" && t.userName !== "N/A") return t.userName;
  return t.userId || "—";
};

export function OverdueAccountView({
  overdueTransactions,
  importanceFilter: importanceFilterProp,
  onImportanceFilterChange,
  onEditVoucher,
  onHistoryVoucher,
  onAddLink,
  userNames = {},
}: {
  overdueTransactions: OverdueTransactionRow[];
  /** Parent se control ho to mobile/desktop filter sync rahe */
  importanceFilter?: OverdueImportanceFilter;
  onImportanceFilterChange?: (filter: OverdueImportanceFilter) => void;
  onEditVoucher?: (row: OverdueTransactionRow) => void;
  onHistoryVoucher?: (row: OverdueTransactionRow) => void;
  onAddLink?: (row: OverdueTransactionRow) => void;
  userNames?: Record<string, string>;
}) {
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } = useDate();
  const { company } = useCompany();
  const { can } = usePermissions();
  const { settings: animationSettings } = useAnimationSettings();
  const isRowAnimationEnabled = animationSettings?.rows?.enabled === true;
  const rowAnimationDuration = isRowAnimationEnabled ? (animationSettings?.rows?.duration ?? 0) : 0;
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [fileDisplayMode, setFileDisplayMode] = useState<FileColumnDisplayMode>(() => readOverdueFileColumnPrefs().displayMode);
  const [fileShowAll, setFileShowAll] = useState(() => readOverdueFileColumnPrefs().showAll);
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [internalImportanceFilter, setInternalImportanceFilter] = useState<OverdueImportanceFilter>(() =>
    readOverdueImportanceFilter()
  );
  const importanceFilter = importanceFilterProp ?? internalImportanceFilter;
  const [showNarration, setShowNarration] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return sessionStorage.getItem("showNarration") !== "false";
    } catch {
      return true;
    }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [txnTableTone, setTxnTableTone] = useState<LedgerTxnTableTone>("default");
  useEffect(() => {
    setTxnTableTone(readLedgerTxnTableTone());
    const onToneChange = () => setTxnTableTone(readLedgerTxnTableTone());
    window.addEventListener(LEDGER_TXN_TABLE_TONE_CHANGED_EVENT, onToneChange);
    return () => window.removeEventListener(LEDGER_TXN_TABLE_TONE_CHANGED_EVENT, onToneChange);
  }, []);
  /** Main + narration hover ek block — globals.css [data-pl-txn-hovered] (normal ledger jaisa) */
  const [hoveredTxnId, setHoveredTxnId] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const filterInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusFilterInputSoon = useCallback((key: string) => {
    requestAnimationFrame(() => {
      const input = filterInputRefs.current[key];
      if (!input) return;
      if (typeof document !== "undefined" && document.activeElement === input) return;
      input.focus({ preventScroll: true });
    });
  }, []);

  const clearOverduePairHoverUnlessMovingTo = useCallback(
    (txnId: string, e: React.MouseEvent, siblingDomId: string) => {
      const rel = e.relatedTarget;
      if (rel instanceof Node) {
        const sibling = document.getElementById(siblingDomId);
        if (sibling?.contains(rel)) return;
      }
      setHoveredTxnId((cur) => (cur === txnId ? null : cur));
    },
    []
  );
  const [visibleColumns, setVisibleColumns] = useState<OverdueVisibleColumns>(() => {
    if (typeof window === "undefined") return DEFAULT_OVERDUE_VISIBLE;
    try {
      const saved = sessionStorage.getItem("overdueVisibleColumns");
      if (saved) {
        const parsed = JSON.parse(saved) as OverdueVisibleColumns;
        return { ...DEFAULT_OVERDUE_VISIBLE, ...parsed };
      }
    } catch {}
    return DEFAULT_OVERDUE_VISIBLE;
  });

  const handleColumnVisibilityChange = (key: OverdueColumnKey, checked: boolean) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: checked };
      sessionStorage.setItem("overdueVisibleColumns", JSON.stringify(next));
      return next;
    });
  };

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const handleImportanceFilterChange = (next: OverdueImportanceFilter) => {
    if (onImportanceFilterChange) onImportanceFilterChange(next);
    else {
      setInternalImportanceFilter(next);
      writeOverdueImportanceFilter(next);
    }
    setCurrentPage(1);
  };

  const filteredRows = useMemo(() => {
    let list = overdueTransactions.filter((t) => matchesOverdueImportanceFilter(t, importanceFilter));
    const dateQ = (filters.date || "").trim().toLowerCase();
    if (dateQ) {
      list = list.filter((t) => {
        const d = safeToDate(t.date);
        const values = [
          d ? formatDateBS(d) : "",
          d ? formatDate(d) : "",
          formatVoucherEntryTimeLocal(t as unknown as Record<string, unknown>),
        ];
        return values.some((value) => String(value || "").toLowerCase().includes(dateQ));
      });
    }
    const typeVal = (filters.type || "").trim().toLowerCase();
    if (typeVal) {
      list = list.filter((t) => voucherTypeSearchText(t.type).includes(typeVal));
    }
    const voucherQ = (filters.voucherNumber || "").trim().toLowerCase();
    if (voucherQ) {
      list = list.filter((t) => (t.voucherNumber || "").toLowerCase().includes(voucherQ));
    }
    const partyQ = (filters.party || "").trim().toLowerCase();
    if (partyQ) {
      list = list.filter(
        (t) =>
          (t.partyName || "").toLowerCase().includes(partyQ) ||
          (t.partyId || "").toLowerCase().includes(partyQ)
      );
    }
    const userQ = (filters.user || "").trim().toLowerCase();
    if (userQ) {
      list = list.filter((t) => {
        const name = resolveUserName(t, userNames).toLowerCase();
        return name.includes(userQ) || (t.userId || "").toLowerCase().includes(userQ);
      });
    }
    const fileMode = (filters.file || "").trim().toLowerCase();
    if (fileMode === "with") {
      list = list.filter((t) => transactionRowHasFileAttachment(t));
    } else if (fileMode === "without") {
      list = list.filter((t) => !transactionRowHasFileAttachment(t));
    }
    const debitQ = (filters.debit || "").trim().toLowerCase();
    if (debitQ) {
      list = list.filter((t) =>
        [t.debit, formatCurrencyForPrint(t.debit || 0, { noSuffix: true, context: "transaction" })]
          .some((value) => String(value ?? "").toLowerCase().includes(debitQ))
      );
    }
    const creditQ = (filters.credit || "").trim().toLowerCase();
    if (creditQ) {
      list = list.filter((t) =>
        [t.credit, formatCurrencyForPrint(t.credit || 0, { noSuffix: true, context: "transaction" })]
          .some((value) => String(value ?? "").toLowerCase().includes(creditQ))
      );
    }
    const statusDaysMode = filters.statusDaysMode;
    const statusDays = Number((filters.statusDays || "").trim());
    const hasStatusDaysFilter =
      (statusDaysMode === "less" || statusDaysMode === "more") && Number.isFinite(statusDays);
    const statusQ = hasStatusDaysFilter ? "" : (filters.status || "").trim().toLowerCase();
    if (statusQ) {
      list = list.filter((t) => {
        const days = getOverdueDays(t.dueDate);
        const labels = getStatusLabels(t);
        return [
          ...labels,
          "overdue",
          "partial/overdue",
          days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : "",
        ].some((value) => value.toLowerCase().includes(statusQ));
      });
    }
    if (hasStatusDaysFilter) {
      list = list.filter((t) => {
        const days = getOverdueDays(t.dueDate);
        return statusDaysMode === "less" ? days < statusDays : days > statusDays;
      });
    }
    const balanceQ = (filters.balance || "").trim().toLowerCase();
    if (balanceQ) {
      list = list.filter((t) => {
        const value = t.type === "purchase" ? -t.outstanding : t.outstanding;
        const side = value >= 0 ? "Dr" : "Cr";
        return [
          value,
          Math.abs(value),
          `${formatCurrencyForPrint(Math.abs(value), { noSuffix: true, context: "transaction" })} ${side}`,
        ].some((candidate) => String(candidate ?? "").toLowerCase().includes(balanceQ));
      });
    }
    return list;
  }, [overdueTransactions, importanceFilter, filters, userNames, formatDateBS, formatDate, formatCurrencyForPrint]);

  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const fiscalMergePartitions = useMemo(
    () => buildFiscalMergePartitionEntriesFromCompany(company),
    [company?.fiscalSplitMode, company?.fiscalMergePartitionAt, company?.fiscalMergePartitionAtIsos, company?.fiscalPartitionLabel, company?.country, company?.fiscalYearStart]
  );
  const sortedRows = useMemo(
    () => sortTransactionsWithFiscalMergeForCompany(filteredRows, sortBy, sortOrder, undefined, company),
    [filteredRows, sortBy, sortOrder, company]
  );
  const overdueTableColSpan = useMemo(() => {
    let span = 1;
    (Object.keys(visibleColumns) as OverdueColumnKey[]).forEach((key) => {
      if (visibleColumns[key]) span += 1;
    });
    return span;
  }, [visibleColumns]);

  // Tail paging — page 1 = latest overdue (Party ledger / global footer jaisa)
  const overduePaging = useMemo(() => {
    const total = sortedRows.length;
    const totalPagesLocal = rowsPerPage > 0 ? Math.max(1, Math.ceil(total / rowsPerPage)) : 1;
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const withFyDividersOnPage = (slice: OverdueTransactionRow[]) => {
      if (!fiscalMergePartitions.length) return slice;
      return insertFiscalPartitionRowsMulti(slice as any[], fiscalMergePartitions) as OverdueTransactionRow[];
    };
    if (rowsPerPage <= 0) {
      return {
        totalPages: 1,
        pageRows: withFyDividersOnPage(sortedRows),
        beforeCount: 0,
        afterCount: 0,
      };
    }
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    const pageSlice = sortedRows.slice(start, end);
    return {
      totalPages: totalPagesLocal,
      pageRows: withFyDividersOnPage(pageSlice),
      beforeCount: start,
      afterCount: Math.max(0, total - end),
    };
  }, [sortedRows, currentPage, rowsPerPage, fiscalMergePartitions]);

  const totalPages = overduePaging.totalPages;
  const paginatedRows = overduePaging.pageRows;
  const hasAnyFilter = useMemo(
    () => Object.values(filters).some((value) => String(value || "").trim().length > 0),
    [filters]
  );
  const clearAllFilters = useCallback(() => {
    setFilters({});
    setActiveFilter(null);
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    setCurrentPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  useEffect(() => {
    if (selectedId && !paginatedRows.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [paginatedRows, selectedId]);

  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (paginatedRows.length === 0) return;
      const idx = paginatedRows.findIndex((t) => t.id === selectedId);
      const currentIndex = idx >= 0 ? idx : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIndex + 1, paginatedRows.length - 1);
        setSelectedId(paginatedRows[next]?.id ?? null);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        setSelectedId(paginatedRows[prev]?.id ?? null);
      } else if (e.key === "Enter" && selectedId) {
        e.preventDefault();
        const t = paginatedRows.find((x) => x.id === selectedId);
        if (t) onEditVoucher?.(t);
      }
    },
    [paginatedRows, selectedId, onEditVoucher]
  );

  const OVERDUE_HEADER_MIN_PX = {
    date: 112,
    type: 75,
    voucherNo: 105,
    party: 120,
    user: 85,
    debit: 100,
    credit: 100,
    status: 95,
    netBalance: 145,
  } as const;

  /** Bill-wise visual parity: fixed Date/Balance, with safe equal-width middle columns. */
  const overdueColumnWidths = useMemo(() => {
    const widths: number[] = [];
    if (visibleColumns.date) widths.push(OVERDUE_HEADER_MIN_PX.date);

    const middleBaseWidths: number[] = [];
    if (visibleColumns.type) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.type);
    if (visibleColumns.voucherNo) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.voucherNo);
    if (visibleColumns.party) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.party);
    if (visibleColumns.user) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.user);
    if (visibleColumns.file) middleBaseWidths.push(44);
    if (visibleColumns.debit) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.debit);
    if (visibleColumns.credit) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.credit);
    if (visibleColumns.status) middleBaseWidths.push(OVERDUE_HEADER_MIN_PX.status);
    if (middleBaseWidths.length > 0) widths.push(...middleBaseWidths.map(() => 120));

    if (visibleColumns.netBalance) widths.push(LEDGER_ENTITY_BALANCE_COL_PX);
    widths.push(LEDGER_TXN_ROW_MENU_COL_PX);
    return widths;
  }, [visibleColumns]);
  const overdueTableMinWidth = useMemo(
    () => overdueColumnWidths.reduce((sum, width) => sum + width, 0),
    [overdueColumnWidths]
  );

  const overdueColgroup = (
    <colgroup>
      {overdueColumnWidths.map((width, index) => (
        <col key={index} style={{ width: `${width}px` }} />
      ))}
    </colgroup>
  );

  const renderHeaderWithFilter = (key: string, label: string, isNumeric: boolean = false, minWidthPx?: number) => {
    const isFiltered =
      !!(filters[key] ?? "").trim() ||
      (key === "status" && (!!(filters.statusDaysMode ?? "").trim() || !!(filters.statusDays ?? "").trim()));
    const filterValue = filters[key] ?? "";
    const renderTextFilterInput = () => (
      <div className="relative">
        <Input
          ref={(el) => {
            filterInputRefs.current[key] = el;
            if (el && activeFilter === key) focusFilterInputSoon(key);
          }}
          className={cn(
            key === "status"
              ? "h-9 border border-input shadow-none outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              : "border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            filterValue && "pr-9"
          )}
          placeholder={`Filter ${label}...`}
          value={filterValue}
          onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") setActiveFilter(null); }}
          autoFocus
        />
        {filterValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFilters((p) => ({ ...p, [key]: "" }));
              focusFilterInputSoon(key);
            }}
            aria-label={`Clear ${label} filter`}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    );
    return (
      <TableHead className={cn("p-0", isNumeric && "text-right")} style={minWidthPx != null ? { minWidth: `${minWidthPx}px` } : undefined}>
        {/* Header style — TransactionsTable jaisa (black bar + filter icons) */}
        <div
          className={cn(
            "flex items-center gap-1 whitespace-nowrap py-3 font-bold",
            key === "balance" ? LEDGER_TXN_BALANCE_TO_MENU_PAD_CN : "px-[10px]",
            isFiltered ? "text-red-600" : "text-black",
            isNumeric ? "justify-end" : "justify-start"
          )}
        >
          <span>{label}</span>
          <Popover modal open={activeFilter === key} onOpenChange={(open) => setActiveFilter(open ? key : null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" data-pl-txn-icon-btn="" className={cn(txnTableIconBtnCn, "h-6 w-6 shrink-0")}>
                <Filter className={cn("h-4 w-4", isFiltered && "text-red-600")} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="center"
              sideOffset={6}
              className={cn("overflow-hidden", key === "status" ? "w-72 p-0" : "w-48 p-0")}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                focusFilterInputSoon(key);
              }}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {key === "status" ? (
                <div className="space-y-2 p-2">
                  {renderTextFilterInput()}
                  <div className="grid grid-cols-[1fr_1fr_80px] gap-2">
                    <Button
                      type="button"
                      variant={filters.statusDaysMode === "less" ? "default" : "outline"}
                      className="h-9 rounded-md"
                      onClick={() => setFilters((p) => ({ ...p, statusDaysMode: "less" }))}
                    >
                      Less than
                    </Button>
                    <Button
                      type="button"
                      variant={filters.statusDaysMode === "more" ? "default" : "outline"}
                      className="h-9 rounded-md"
                      onClick={() => setFilters((p) => ({ ...p, statusDaysMode: "more" }))}
                    >
                      More than
                    </Button>
                    <Input
                      className="h-9 border border-input shadow-none outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      inputMode="numeric"
                      placeholder="Overdue days"
                      value={filters.statusDays ?? ""}
                      onChange={(e) => setFilters((p) => ({ ...p, statusDays: e.target.value.replace(/[^\d]/g, "") }))}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              ) : (
                renderTextFilterInput()
              )}
            </PopoverContent>
          </Popover>
        </div>
      </TableHead>
    );
  };

  const renderFileHeaderWithFilter = () => {
    const fileFilterRaw = filters.file ?? "";
    const fileFilterMode: "all" | "with" | "without" =
      fileFilterRaw === "with" || fileFilterRaw === "without" ? fileFilterRaw : "all";
    const isFiltered = fileFilterMode !== "all";
    const setFileFilter = (mode: "all" | "with" | "without") => {
      setFilters((prev) => ({ ...prev, file: mode === "all" ? "" : mode }));
    };
    return (
      <TableHead className="p-0 text-center font-semibold" style={{ minWidth: "44px" }} data-theme-header="file">
        <div className={cn("flex items-center justify-center gap-1 whitespace-nowrap px-[10px] py-3 font-bold", isFiltered ? "text-red-600" : "text-black")}>
          <span>File</span>
          <Popover modal open={activeFilter === "file"} onOpenChange={(open) => setActiveFilter(open ? "file" : null)}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-pl-txn-icon-btn=""
                className={cn(txnTableIconBtnCn, "h-6 w-6")}
                aria-label="Filter by file attachment"
              >
                <CheckSquare className={cn("h-4 w-4", isFiltered && "text-red-600")} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="center" onCloseAutoFocus={(e) => e.preventDefault()}>
              <div className="flex items-center gap-2 py-1">
                <Checkbox
                  id="overdue-file-filter-all"
                  checked={fileFilterMode === "all"}
                  onCheckedChange={() => setFileFilter("all")}
                />
                <label htmlFor="overdue-file-filter-all" className="flex-1 cursor-pointer text-sm font-medium">
                  All
                </label>
              </div>
              <div className="flex items-center gap-2 py-1">
                <Checkbox
                  id="overdue-file-filter-with"
                  checked={fileFilterMode === "with"}
                  onCheckedChange={() => setFileFilter("with")}
                />
                <label htmlFor="overdue-file-filter-with" className="flex-1 cursor-pointer text-sm font-medium">
                  With file
                </label>
              </div>
              <div className="flex items-center gap-2 py-1">
                <Checkbox
                  id="overdue-file-filter-without"
                  checked={fileFilterMode === "without"}
                  onCheckedChange={() => setFileFilter("without")}
                />
                <label htmlFor="overdue-file-filter-without" className="flex-1 cursor-pointer text-sm font-medium">
                  Without file
                </label>
              </div>
              <div className="mt-2 border-t pt-2 text-[11px] font-bold uppercase text-muted-foreground">View</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 py-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={fileDisplayMode === "preview"}
                    onCheckedChange={() => setFileDisplayMode("preview")}
                  />
                  Preview
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={fileDisplayMode === "preview" && fileShowAll}
                    disabled={fileDisplayMode !== "preview"}
                    onCheckedChange={(checked) => setFileShowAll(checked === true)}
                  />
                  Show all
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={fileDisplayMode === "tick"}
                    onCheckedChange={() => setFileDisplayMode("tick")}
                  />
                  Tick only
                </label>
              </div>
              <Button
                type="button"
                className="mt-2 h-9 w-full rounded-full"
                onClick={() => {
                  saveOverdueFileColumnPrefs(fileDisplayMode, fileShowAll);
                  setActiveFilter(null);
                  toast.success("File view saved.");
                }}
              >
                Save
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </TableHead>
    );
  };

  const totalDebit = sortedRows.reduce((s, t) => s + (t.debit || 0), 0);
  const totalCredit = sortedRows.reduce((s, t) => s + (t.credit || 0), 0);
  const netBalance = totalDebit - totalCredit;

  const runPrintDirect = async () => {
    if (!company) {
      toast.error("Company not loaded. Please try again.");
      return;
    }
    try {
      await openPrintDirect(
        {
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
          title: "Overdue Vouchers",
          context: "overdue",
          dateSystem: dateSystem === "BS" ? "BS" : dateSystem === "AD" ? "AD" : "Both",
          dateRangeText: "All overdue vouchers across parties",
          vouchersCount: sortedRows.length,
          openingBalance: 0,
          transactions: sortedRows,
          userNames,
          showNarration,
        },
        true
      );
    } catch (e) {
      console.error("Overdue print failed:", e);
      toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
    }
  };

  const overdueTotalFooter = (
    <TableFooter data-pl-txn-split-scroll-footer="" className="border-0 bg-blue-100/80 shadow-none">
      <TableRow data-pl-txn-footer-total-row="" className="border-0 font-semibold">
        <TableCell
          colSpan={
            (visibleColumns.date ? 1 : 0) +
            (visibleColumns.type ? 1 : 0) +
            (visibleColumns.voucherNo ? 1 : 0) +
            (visibleColumns.party ? 1 : 0) +
            (visibleColumns.user ? 1 : 0) +
            (visibleColumns.file ? 1 : 0)
          }
          className="pl-3 pr-2 text-right"
        >
          Total
        </TableCell>
        {visibleColumns.debit && (
          <TableCell className="text-right text-green-600">
            {formatCurrency(totalDebit, { noSuffix: true, context: "transaction" })}
          </TableCell>
        )}
        {visibleColumns.credit && (
          <TableCell className="text-right text-red-600">
            {formatCurrency(totalCredit, { noSuffix: true, context: "transaction" })}
          </TableCell>
        )}
        {visibleColumns.status && <TableCell />}
        {visibleColumns.netBalance && (
          <TableCell
            className={LEDGER_TXN_BALANCE_TO_MENU_PAD_CN}
            style={{ minWidth: LEDGER_ENTITY_BALANCE_COL_PX }}
          />
        )}
        <TableCell className={LEDGER_TXN_ROW_MENU_CELL_CN} />
      </TableRow>
    </TableFooter>
  );


  return (
    <div
      data-pl-ledger-txn-page=""
      data-pl-overdue-billwise-ui=""
      className={cn(LEDGER_TXN_PAGE_ROOT_CN, "h-full min-h-full")}
      style={{ "--pl-ledger-txn-table-min-px": overdueTableMinWidth } as React.CSSProperties}
    >
      <LedgerTxnScrollColumn
        header={
          <>
      {/* Header: Party Details jaisa — title, balance, print */}
      <div className={cn("flex-shrink-0", LEDGER_HEADER_RIBBON_WRAP_CN)}>
        <div className={LEDGER_HEADER_OUTER_ROW_CN}>
          <div className={LEDGER_HEADER_IDENTITY_CN}>
            <div className={LEDGER_HEADER_AVATAR_CN}>
              <div className={cn(LEDGER_HEADER_AVATAR_BOX_CN, "flex items-center justify-center rounded-lg border border-blue-300 bg-amber-100 dark:bg-amber-900/30")}>
                <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-500" />
              </div>
            </div>
            <div className={LEDGER_HEADER_NAME_CARD_CN}>
              <h2 className={LEDGER_HEADER_TITLE_CN} title="Overdue Vouchers">
                Overdue Vouchers
              </h2>
            </div>
            <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
              <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                <div
                  className={cn(
                    LEDGER_HEADER_BALANCE_CN,
                    masterDetailBalanceToneClass(netBalance)
                  )}
                >
                  {formatCurrency(netBalance, { showDrCr: true })}
                </div>
              </div>
            </div>
          </div>
          <div className={LEDGER_HEADER_PILL_ROW_CN}>
            {/* Important ke baayein: All / Important / Normal — overdueImportant tick filter */}
            <Button
              type="button"
              variant={importanceFilter === "all" ? "default" : "outline"}
              size="sm"
              className={LEDGER_HEADER_PILL_CN}
              onClick={() => handleImportanceFilterChange("all")}
            >
              All
            </Button>
            <Button
              type="button"
              variant={importanceFilter === "important" ? "default" : "outline"}
              size="sm"
              className={LEDGER_HEADER_PILL_CN}
              onClick={() => handleImportanceFilterChange("important")}
            >
              Important
            </Button>
            <Button
              type="button"
              variant={importanceFilter === "normal" ? "default" : "outline"}
              size="sm"
              className={LEDGER_HEADER_PILL_CN}
              onClick={() => handleImportanceFilterChange("normal")}
            >
              Normal
            </Button>
            {hasAnyFilter ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={LEDGER_HEADER_PILL_ICON_CN}
                onClick={clearAllFilters}
                title="Clear all filters"
                aria-label="Clear all filters"
              >
                <X className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon"
              className={LEDGER_HEADER_PILL_ICON_CN}
              onClick={() => runPrintDirect()}
              title="Print"
              data-theme-detail="print"
            >
              <Printer className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
            </Button>
          </div>
        </div>
      </div>
          </>
        }
        table={
          <>
      <Card className="flex min-h-0 flex-1 flex-col border-0 bg-[#ecfdf5] shadow-none rounded-none">
        {/* scroll-touch + inline style for APK/WebView touch scroll */}
        <CardContent
          className="flex-1 min-h-0 overflow-auto scroll-touch bg-[#ecfdf5] p-0"
        >
          <div
            ref={tableContainerRef}
            tabIndex={0}
            role="grid"
            aria-label="Overdue vouchers"
            data-theme-table="transactions"
            data-pl-txn-table-tone={txnTableTone}
            data-pl-ledger-txn=""
            className="outline-none focus:outline-none min-h-0 w-full min-w-0 overflow-x-auto bg-[#ecfdf5] scrollbar-slim-dim"
            onKeyDown={handleTableKeyDown}
            onClick={() => tableContainerRef.current?.focus()}
          >
          <Table
            className="table-fixed w-full border-separate border-spacing-0"
            style={{ minWidth: overdueTableMinWidth }}
            scrollContainer={false}
          >
            {overdueColgroup}
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                {visibleColumns.date && renderHeaderWithFilter("date", "Date", false, OVERDUE_HEADER_MIN_PX.date)}
                {visibleColumns.type && renderHeaderWithFilter("type", "Type", false, OVERDUE_HEADER_MIN_PX.type)}
                {visibleColumns.voucherNo && renderHeaderWithFilter("voucherNumber", "Voucher No.", false, OVERDUE_HEADER_MIN_PX.voucherNo)}
                {visibleColumns.party && renderHeaderWithFilter("party", "Accounts", false, OVERDUE_HEADER_MIN_PX.party)}
                {visibleColumns.user && renderHeaderWithFilter("user", "User", false, OVERDUE_HEADER_MIN_PX.user)}
                {visibleColumns.file && renderFileHeaderWithFilter()}
                {visibleColumns.debit && renderHeaderWithFilter("debit", "Debit", true, OVERDUE_HEADER_MIN_PX.debit)}
                {visibleColumns.credit && renderHeaderWithFilter("credit", "Credit", true, OVERDUE_HEADER_MIN_PX.credit)}
                {visibleColumns.status && renderHeaderWithFilter("status", "Status", false, OVERDUE_HEADER_MIN_PX.status)}
                {visibleColumns.netBalance && renderHeaderWithFilter("balance", "Net Balance", true, OVERDUE_HEADER_MIN_PX.netBalance)}
                <TableHead className={LEDGER_TXN_ROW_MENU_CELL_CN} />
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
              {paginatedRows.map((t, rowIndex) => {
                if ((t as any).type === FISCAL_YEAR_PARTITION_ROW_TYPE) {
                  const boundaryMs = parseFiscalPartitionBoundaryMs(t as { id?: string });
                  const partitionDate = boundaryMs != null ? new Date(boundaryMs) : null;
                  const label =
                    partitionDate && !Number.isNaN(partitionDate.getTime())
                      ? buildFiscalMergePartitionBannerLabelForDateSystem(
                          company,
                          partitionDate,
                          dateSystem,
                          formatDate,
                          company?.fiscalPartitionLabel ?? null
                        )
                      : typeof (t as any)._partitionLabel === "string" && (t as any)._partitionLabel
                        ? (t as any)._partitionLabel
                        : "── Closing fiscal period · New fiscal period ──";
                  return (
                    <TableRow
                      key={(t as any).id || `fy-partition-${rowIndex}`}
                      data-row="fiscal-partition-label"
                      className="cursor-default border-0 bg-background hover:!bg-background"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <TableCell colSpan={overdueTableColSpan} className="py-2.5 px-3 text-center align-middle">
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-100">
                          {label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                }
                const d = safeToDate(t.date);
                const dateStr = d ? (dateSystem === "BS" ? formatDateBS(d) : formatDate(d)) : "—";
                const entryClock = formatVoucherEntryTimeLocal(t as unknown as Record<string, unknown>);
                const isCreditSide = t.type === "purchase";
                const balanceVal = isCreditSide ? -t.outstanding : t.outstanding;
                const displayUserName = resolveUserName(t, userNames);
                const txnStripeAttr = String(rowIndex % 2);
                const isSelected = selectedId === t.id;
                const pairHovered = hoveredTxnId === t.id;
                const mainRowDomId = `overdue-main-${t.id}`;
                const narrRowDomId = `overdue-narr-${t.id}`;
                const highlightQ = Object.values(filters)
                  .map((v) => String(v || "").trim())
                  .filter((v) => v && v !== "with" && v !== "without")
                  .join(" ");
                const hl = (s: string) => highlightQ ? (highlightQueryInText(s, highlightQ) as React.ReactNode) : s;
                return (
                  <React.Fragment key={t.id}>
                  <motion.tr
                    id={mainRowDomId}
                    layout="position"
                    initial={false}
                    exit={{ transition: { duration: 0 } }}
                    transition={{
                      duration: isRowAnimationEnabled ? rowAnimationDuration : 0,
                      ease: "easeInOut",
                    }}
                    className={cn(
                      "transaction-main-row min-h-[28px] cursor-pointer",
                      showNarration ? "border-b-0" : "border-b",
                      isSelected && txnSelectedMainRowCn(showNarration),
                      showNarration && "[&>td]:pb-0.5"
                    )}
                    data-txn-stripe={txnStripeAttr}
                    data-pl-txn-hovered={pairHovered ? "" : undefined}
                    data-pl-txn-selected={isSelected ? "" : undefined}
                    onMouseEnter={() => setHoveredTxnId(t.id)}
                    onMouseLeave={(e) => clearOverduePairHoverUnlessMovingTo(t.id, e, narrRowDomId)}
                    onClick={() => setSelectedId(t.id)}
                    onDoubleClick={() => onEditVoucher?.(t)}
                  >
                    {visibleColumns.date && (
                      <TableCell className="overflow-hidden whitespace-nowrap pl-3 pr-2">
                        {hl(dateStr)}
                        {entryClock ? <span className="ml-1 text-[10px] text-muted-foreground">• {hl(entryClock)}</span> : null}
                      </TableCell>
                    )}
                    {visibleColumns.type && (
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            voucherTypePillClassName(resolveTxnDrCrSide(t.debit || 0, t.credit || 0, balanceVal)),
                            "capitalize"
                          )}
                        >
                          {hl(voucherTypeDisplayText(t.type))}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleColumns.voucherNo && (
                      <TableCell className="overflow-hidden">
                        <span className="block truncate" title={t.voucherNumber || "—"}>
                          {hl(t.voucherNumber || "—")}
                        </span>
                      </TableCell>
                    )}
                    {visibleColumns.party && (
                      <TableCell className="overflow-hidden font-medium">
                        <span className="block truncate" title={t.partyName || "—"}>
                          {hl(t.partyName || "—")}
                        </span>
                      </TableCell>
                    )}
                    {visibleColumns.user && (
                      <TableCell className="overflow-hidden text-muted-foreground">
                        <span className="block truncate" title={displayUserName}>
                          {hl(displayUserName)}
                        </span>
                      </TableCell>
                    )}
                    {visibleColumns.file && (
                      <TableCell className="min-w-[44px] px-[5px] text-center" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const rowUrls = getVoucherAttachmentUrlsForUi(t);
                          if (rowUrls.length === 0) return "-";
                          return (
                            <OpeningBalanceFileCellContent
                              fileUrls={rowUrls}
                              displayMode={fileDisplayMode}
                              showAll={fileShowAll}
                            />
                          );
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.debit && (
                      <TableCell className="text-right text-green-600">
                        {t.debit > 0 ? hl(formatCurrencyForPrint(t.debit, { noSuffix: true, context: "transaction" })) : "—"}
                      </TableCell>
                    )}
                    {visibleColumns.credit && (
                      <TableCell className="text-right text-red-600">
                        {t.credit > 0 ? hl(formatCurrencyForPrint(t.credit, { noSuffix: true, context: "transaction" })) : "—"}
                      </TableCell>
                    )}
                    {visibleColumns.status && (
                      <TableCell className="text-center align-middle">
                        {(() => {
                          const statusLabels = getStatusLabels(t);
                          const statusDetailVouchersForRow = getStatusDetailVouchers(t, { billWiseOnly: true });
                          const isOverdueRow =
                            statusLabels.includes("Overdue") ||
                            statusLabels.includes(STATUS_LABEL_PARTIAL_OVERDUE) ||
                            transactionIsOverdueStatus(t);
                          const overdueDays = isOverdueRow ? getOverdueDays(t.dueDate) : 0;
                          return (
                            <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                              {statusLabels.length > 0 ? (
                                statusLabels.map((statusLabel) => (
                                  <Badge
                                    key={statusLabel}
                                    variant="outline"
                                    className={cn(
                                      "inline-flex h-[22px] font-semibold shrink-0",
                                      getStatusBadgeOutlineClassName(statusLabel, t, {
                                        debit: t.debit,
                                        credit: t.credit,
                                      })
                                    )}
                                  >
                                    {hl(statusLabel)}
                                  </Badge>
                                ))
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-red-600 border-red-600/50 inline-flex h-[22px] font-semibold shrink-0"
                                >
                                  {hl("Overdue")}
                                </Badge>
                              )}
                              {statusDetailVouchersForRow.length > 0 && (
                                <LinkedVouchersColoredCollapsible
                                  vouchers={statusDetailVouchersForRow}
                                  align="center"
                                  billWisePink
                                  className="text-[10px] leading-tight"
                                />
                              )}
                              {overdueDays > 0 && (
                                <span className="text-[10px] text-red-600 font-medium leading-tight text-center">
                                  {hl(`${overdueDays} ${overdueDays === 1 ? "day" : "days"}`)}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.netBalance && (
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-right font-semibold",
                          LEDGER_TXN_BALANCE_TO_MENU_PAD_CN,
                          balanceVal >= 0 ? "text-green-600" : "text-red-600"
                        )}
                        style={{ minWidth: LEDGER_ENTITY_BALANCE_COL_PX }}
                      >
                        {hl(`${formatCurrencyForPrint(Math.abs(balanceVal), { noSuffix: true, context: "transaction" })} ${balanceVal >= 0 ? "Dr" : "Cr"}`)}
                      </TableCell>
                    )}
                    <TableCell
                      className={LEDGER_TXN_ROW_MENU_CELL_CN}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-pl-txn-icon-btn=""
                            className={cn(txnTableIconBtnCn, "relative h-8 w-3 min-w-[12px] shrink-0 p-0")}
                          >
                            <span
                              aria-hidden="true"
                              className="absolute right-[4px] top-1/2 -translate-y-1/2 text-base leading-none text-muted-foreground"
                            >
                              ⋮
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {can('view_voucher_history') && onHistoryVoucher && (
                            <DropdownMenuItem
                              onClick={() => onHistoryVoucher(t)}
                              className="flex items-center gap-2"
                            >
                              <History className="h-3.5 w-3.5" />
                              History
                            </DropdownMenuItem>
                          )}
                          {/* Add Link action removed from 3-dot menu to match transaction table behavior. */}
                          <DropdownMenuItem
                            onClick={() => onEditVoucher?.(t)}
                            className="flex items-center gap-2"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </motion.tr>
                  {showNarration && (() => {
                    const narrationColSpan =
                          (visibleColumns.date ? 1 : 0) +
                          (visibleColumns.type ? 1 : 0) +
                          (visibleColumns.voucherNo ? 1 : 0) +
                          (visibleColumns.party ? 1 : 0) +
                          (visibleColumns.user ? 1 : 0) +
                          (visibleColumns.file ? 1 : 0) +
                          (visibleColumns.debit ? 1 : 0) +
                          (visibleColumns.credit ? 1 : 0) +
                          (visibleColumns.status ? 0 : 1);
                    return (
                    <motion.tr
                      id={narrRowDomId}
                      layout="position"
                      initial={false}
                      exit={{ transition: { duration: 0 } }}
                      transition={{
                        duration: isRowAnimationEnabled ? rowAnimationDuration : 0,
                        ease: "easeInOut",
                      }}
                      role="button"
                      tabIndex={-1}
                      onClick={() => setSelectedId(t.id)}
                      onDoubleClick={() => onEditVoucher?.(t)}
                      data-txn-stripe={txnStripeAttr}
                      data-pl-txn-hovered={pairHovered ? "" : undefined}
                      data-pl-txn-selected={isSelected ? "" : undefined}
                      onMouseEnter={() => setHoveredTxnId(t.id)}
                      onMouseLeave={(e) => clearOverduePairHoverUnlessMovingTo(t.id, e, mainRowDomId)}
                      className={cn(
                        "narration-row -mt-1.5 cursor-pointer border-b",
                        isSelected && txnSelectedNarrationRowCn()
                      )}
                    >
                      <TableCell
                        colSpan={narrationColSpan}
                        className="pt-0.5 pb-0.5 px-3 text-[11px] italic text-muted-foreground leading-tight align-top whitespace-normal break-words min-w-0 max-w-full"
                      >
                        <span className="font-semibold not-italic">Narration:</span> {hl(t.narration || "No narration")}
                      </TableCell>
                      {visibleColumns.status && (
                        <TableCell className="pt-0.5 pb-0.5 px-2 text-center align-top" aria-hidden="true" />
                      )}
                      {visibleColumns.netBalance && (
                        <TableCell
                          className={cn("py-0", LEDGER_TXN_BALANCE_TO_MENU_PAD_CN)}
                          style={{ minWidth: LEDGER_ENTITY_BALANCE_COL_PX }}
                        />
                      )}
                      <TableCell className={LEDGER_TXN_ROW_MENU_CELL_CN} />
                    </motion.tr>
                    );
                  })()}
                </React.Fragment>
                );
              })}
              </AnimatePresence>
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
      <div
        data-pl-ledger-txn-fixed-summary=""
        data-theme-table="transactions"
        data-pl-txn-table-tone={txnTableTone}
        className="w-full min-w-0 shrink-0 overflow-hidden bg-blue-100/80"
      >
        <Table
          className="table-fixed w-full border-separate border-spacing-0"
          style={{ minWidth: overdueTableMinWidth }}
          scrollContainer={false}
        >
          {overdueColgroup}
          {overdueTotalFooter}
        </Table>
      </div>
          </>
        }
        footer={
          <>
      {/* Footer: global PC shell — Party Details jaisa LedgerDesktopFooter */}
      <LedgerDesktopFooter
        left={
          <>
            {/* Count sirf pagination bar par Total Trxn — left duplicate mat */}
            <LedgerFooterCheckboxPill
              id="show-narration-overdue"
              checked={showNarration}
              onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
              label="Show Narration"
            />
            <LedgerFooterColumnsMenu>
              <DropdownMenuContent align="start" className="w-52 p-2">
                {(Object.keys(OVERDUE_COLUMN_LABELS) as OverdueColumnKey[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={(e) => e.preventDefault()}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <Checkbox
                      id={`overdue-col-${key}`}
                      checked={visibleColumns[key] !== false}
                      onCheckedChange={(c) => handleColumnVisibilityChange(key, Boolean(c))}
                    />
                    <label htmlFor={`overdue-col-${key}`} className="flex-1 cursor-pointer text-sm font-medium">
                      {OVERDUE_COLUMN_LABELS[key]}
                    </label>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </LedgerFooterColumnsMenu>
          </>
        }
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(by, order) => {
          setSortBy(by);
          setSortOrder(order);
        }}
        viewMode="bill_wise"
        currentPage={currentPage}
        totalPages={totalPages}
        setCurrentPage={setCurrentPage}
        rowsPerPageSelectValue={rowsPerPageSelectValue(rowsPerPage, ROWS_PER_PAGE_OPTIONS_DEFAULT, "10")}
        onRowsPerPageChange={(value) => {
          setRowsPerPage(Number(value) || 0);
          setCurrentPage(1);
        }}
        beforeCount={overduePaging.beforeCount}
        afterCount={overduePaging.afterCount}
        totalCount={sortedRows.length}
      />
          </>
        }
      />
    </div>
  );
}
