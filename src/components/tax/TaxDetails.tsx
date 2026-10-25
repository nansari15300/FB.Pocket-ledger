
"use client";

import * as React from "react";
import { toast } from "sonner";
import { openPrintDirect, getPdfBlob } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import type { Tax, TaxGroup } from "@/components/tax/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Edit,
  Printer,
  Calendar as CalendarIcon,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  FilePlus,
  Receipt,
  XCircle,
  MoreVertical,
  ArrowLeft,
  Columns3,
  ChevronDown,
  Search,
  Pencil,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { buildTaxTdsAutoLinkProposal, applyTaxTdsAutoLinkProposal, type TaxTdsAutoLinkProposal } from "@/lib/taxTdsAutoLink";
import { FISCAL_YEAR_PARTITION_ROW_TYPE } from "@/lib/fiscalPartitionRows";
import { FY_OPENING_ROW_TYPE } from "@/lib/fyPagination/fyOpeningRows";
import type { DateRange } from "@/components/ui/ad-calendar";
import { format, startOfDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { nestedLedgerChildDialogShell } from "@/lib/nestedLedgerMasterEditPresentation";
import { mdc, mdcMobileTxnBalanceRowData, mobileTxnScrollBodyClass } from "@/lib/mobileDetailChrome";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import { LedgerViewModePills, LedgerViewModeToggleButton } from "@/components/ui/LedgerViewModePills";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { ReportMobileLedgerFooter } from "@/components/reports/ReportMobileLedgerFooter";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  patchMasterDetailUrlAfterModalClose,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import AdCalendar from "@/components/ui/ad-calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_TRIGGER_CN,
  LEDGER_HEADER_AVATAR_IMAGE_CN,
  LEDGER_HEADER_AVATAR_PEN_CN,
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
} from "@/lib/ledgerHeaderChrome";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
import { ReportHeaderSummaryCards, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
import { Checkbox } from "../ui/checkbox";
import { doc } from "firebase/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { AdjustBalancePillLabel } from "@/components/vouchers/AdjustBalancePillLabel";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { EditTaxDialog } from "./EditTaxDialog";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import { useMasterAccountFreezeDetailsChrome } from "@/hooks/useMasterAccountFreezeDetailsChrome";
import { useLedgerConfirmationSendPill } from "@/hooks/useLedgerConfirmationSendPill";
import { ledgerConfirmationPrintVisibleColumns } from "@/lib/reports/ledgerConfirmationShare";
import { TAX_FREEZE_COLLECTION } from "@/lib/masterAccountFreeze/freezeAdapter";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { TransactionTableSortDropdown, type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { useStatementLedgerCheckModePaging } from "@/hooks/useStatementLedgerCheckModePaging";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { useLedgerDetailSessionMemory } from "@/hooks/useLedgerDetailSessionMemory";
import {
  ledgerDetailSessionStorageKey,
  writeLedgerDetailSessionSnapshot,
  type LedgerDetailViewMode,
} from "@/lib/ledgerDetailSessionMemory";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";

import { useTransactionVisibleColumns, COLUMN_LABELS, useShowNotes } from "../vouchers/transactionColumnVisibility";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import {
  taxLedgerBooksDrCrFromRow,
  taxAccountIsTdsVerifyLegOnVoucher,
  resolveSalePurchaseTdsVerifyLabel,
  SALE_PURCHASE_TDS_VERIFIED_MESSAGE,
  SALE_PURCHASE_TDS_UNVERIFIED_MESSAGE,
} from "@/lib/partyLedgerTdsView";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import { formatVoucherEntryTimeLocal } from "@/lib/voucherDateNormalize";

const DEFAULT_STATUS_FILTER = { paid: true, unpaid: true, partial: true, overdue: true };
type StatusFilter = { paid: boolean; unpaid: boolean; partial: boolean; overdue: boolean };
const STATUS_FILTER_KEY = "transactionStatusFilterTax";

function filterByStatus(txns: any[], statusFilter: StatusFilter): any[] {
  const anySelected = statusFilter.paid || statusFilter.unpaid || statusFilter.partial || statusFilter.overdue;
  if (!anySelected) return txns;
  return txns.filter((t) => {
    if (t.type === "note") return true; // Notes have no payment status; always show
    if (statusFilter.paid && t.paymentStatus === "paid") return true;
    if (statusFilter.unpaid && t.paymentStatus === "unpaid") return true;
    if (statusFilter.partial && t.paymentStatus === "partially_paid") return true;
    if (statusFilter.overdue && t.isOverdue) return true;
    return false;
  });
}
import { useBalanceMode } from "@/hooks/useBalanceMode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "../ui/input";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { getTaxTransactionAmounts, useTransactions } from "@/hooks/use-transactions";
import { useVouchers } from "@/hooks/useVouchers";
import {
  filterTaxLedgerByOppositeAccount,
  getTaxOppositeAccountFilterOptions,
} from "@/lib/taxOppositeAccountFilter";
import { chromePillBtn } from "@/lib/chromePillButton";
import { useMasterEntityLivePatch } from "@/hooks/useMasterEntityLivePatch";
import { NotificationBell } from "../vouchers/NotificationBell";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "@/components/ui/combobox";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import NepaliCalendar from "../ui/nepali-calendar";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import { useEnsureEntityMinTxnsInScope } from "@/hooks/useEnsureEntityMinTxnsInScope";
import {
  ledgerMasterDateRangeLabel,
  MASTER_LEDGER_DEFAULT_TXN_COUNT,
} from "@/lib/ledgerMasterDefaultView";
import type { BSDate } from "@/lib/bs-date";

interface TaxDetailsProps {
  tax: Tax;
  allTaxes: Tax[];
  transactions?: any[];
  onTaxUpdated: (updated?: Partial<Tax>) => void;
  onTaxDeleted: (id: string) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  onShowAll?: () => void;
  isTaxContext?: boolean;
  userNames?: Record<string, string>;
  journalAccountNames?: Record<string, string>;
  onBack?: () => void;
  context?: string;
  mobileFooterVariant?: "ledger" | "report";
  mobileReportStickyTitle?: string;
  ledgerPresentationMode?: import("@/lib/nestedLedgerMasterEditPresentation").MasterEditPresentationMode;
  hideMobilePeriodLabelRow?: boolean;
  reportSummaryCards?: ReportStatementSummaryCardData[];
}

export function TaxDetails({
  tax: initialTax,
  allTaxes,
  transactions,
  onTaxUpdated,
  onTaxDeleted,
  dateRange,
  onDateRangeChange,
  onShowAll,
  isTaxContext,
  userNames,
  journalAccountNames: journalAccountNamesProp,
  onBack,
  context,
  mobileFooterVariant = "ledger",
  mobileReportStickyTitle,
  ledgerPresentationMode = "default",
  hideMobilePeriodLabelRow = false,
  reportSummaryCards,
}: TaxDetailsProps) {
  const nestedLedgerNoteDialogShell =
    ledgerPresentationMode === "nested-ledger"
      ? nestedLedgerChildDialogShell("h-[95vh] w-full max-w-3xl flex flex-col")
      : { overlayClassName: undefined, className: "h-[95vh] w-full max-w-3xl flex flex-col" };
  useFyLoadOnDateRangeChange(dateRange);
  const { company, companyId } = useCompany();
  const { user, customUser } = useAuth();
  const { dateSystem, formatDate, formatDateBS, formatCurrency } = useDate();
  const {
    vouchers,
    journalAccountNames: journalAccountNamesFromHook,
    processedTaxes,
    processedAccounts,
    processedExpenseAccounts,
    processedStaff,
    processedParties,
  } = useVouchers();
  const isCompanyAdmin = React.useMemo(() => {
    const role = String(customUser?.role || "").trim();
    if (role === "CompanyAdmin" || role === "SuperAdmin" || role === "owner") return true;
    if (!company || !user) return false;
    if (company.ownerId && user.uid && company.ownerId === user.uid) return true;
    const ownerEmail = String((company as { ownerEmail?: string }).ownerEmail || "")
      .trim()
      .toLowerCase();
    const email = String(user.email || "").trim().toLowerCase();
    return !!ownerEmail && !!email && ownerEmail === email;
  }, [customUser?.role, company, user]);
  const journalAccountNames = journalAccountNamesProp ?? journalAccountNamesFromHook ?? {};
  const mobileSearchNames = useMemo(
    () => ({ ...journalAccountNames, ...(userNames ?? {}) }),
    [journalAccountNames, userNames]
  );

  const tax = useMemo(() => {
    if (!initialTax) return undefined;
    return allTaxes.find((t) => t.id === initialTax.id) || initialTax;
  }, [allTaxes, initialTax]);

  // Paint TaxDetails chrome first; full voucher scan on next frames (VAT / fiscal-merge companies).
  const [ledgerComputeReady, setLedgerComputeReady] = useState(false);
  useEffect(() => {
    setLedgerComputeReady(false);
    let cancelled = false;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (!cancelled) setLedgerComputeReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
    };
  }, [tax?.id]);

  const handleTaxUpdated = useMasterEntityLivePatch<Tax>({
    collection: "taxes",
    entityId: initialTax.id,
    onUpdated: onTaxUpdated,
  });

  const taxFreezeEligible = Boolean(tax?.id) && tax.id !== "all";
  const buildStatementPdfRef = React.useRef<(() => Promise<Blob | null>) | null>(null);
  const taxAdjustBalanceActions = tax && taxFreezeEligible ? (
    <AddVoucherDialog
      defaultTab="adjustment"
      allowedTabs={["adjustment"]}
      defaultVoucherData={{
        defaultTab: "adjustment",
        adjustmentTarget: { id: tax.id, entityType: "tax", name: tax.name },
      }}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={readMasterAccountFrozen(tax)}
        className={cn(LEDGER_HEADER_PILL_CN, "!h-7 min-h-7 text-xs")}
        title="Adjust Balance"
      >
        <AdjustBalancePillLabel />
      </Button>
    </AddVoucherDialog>
  ) : null;

  const confirmationSendPill = useLedgerConfirmationSendPill({
    entity: tax ?? { id: "", name: "", rate: 0, balance: 0, companyId: "", debit: 0, credit: 0 },
    collection: "taxes",
    eligible: taxFreezeEligible,
    onEntityUpdated: handleTaxUpdated,
    buildStatementPdfBlob: React.useCallback(async () => {
      if (!buildStatementPdfRef.current) return null;
      return buildStatementPdfRef.current();
    }, []),
  });

  const {
    freezeOverlay: taxFreezeOverlay,
    closingBalanceRowActions: taxClosingBalanceRowActions,
    closingBalanceActions: taxClosingBalanceActions,
  } = useMasterAccountFreezeDetailsChrome({
    companyId,
    collection: TAX_FREEZE_COLLECTION,
    entityId: tax?.id ?? "",
    entity: tax ?? { id: "", name: "", rate: 0, balance: 0, companyId: "", debit: 0, credit: 0 },
    entityEligible: taxFreezeEligible,
    onEntityUpdated: handleTaxUpdated,
    adjustBalanceActions: taxAdjustBalanceActions,
    prependClosingBalanceActions: confirmationSendPill,
  });

  const taxHeaderAttachmentUrl = useMemo(
    () => (tax ? trimEntityFileUrlForPreview(tax.fileUrl) : null),
    [tax?.fileUrl, tax?.id]
  );

  const { balanceMode, setBalanceMode } = useBalanceMode();
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceMode === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && tax?.id
        ? ledgerDetailSessionStorageKey(companyId, "tax", tax.id, ledgerViewMode)
        : null,
    [companyId, tax?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);

  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [oppositeAccountFilter, setOppositeAccountFilter] = useState("");
  /** TDS tax account header card: Balance (all) / Paid / Unpaid TDS rows. */
  const [tdsStatusView, setTdsStatusView] = useState<"balance" | "paid" | "unpaid">("balance");
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "payment_in" | "payment_out" | "sale">(null);
  const openingModalRef = React.useRef(false);

  useEffect(() => {
    setOppositeAccountFilter("");
    setCurrentPage(1);
  }, [tax?.id]);

  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_STATUS_FILTER };
    try {
      const saved = sessionStorage.getItem(STATUS_FILTER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<StatusFilter>;
        return {
          paid: parsed.paid ?? DEFAULT_STATUS_FILTER.paid,
          unpaid: parsed.unpaid ?? DEFAULT_STATUS_FILTER.unpaid,
          partial: parsed.partial ?? DEFAULT_STATUS_FILTER.partial,
          overdue: parsed.overdue ?? DEFAULT_STATUS_FILTER.overdue,
        };
      }
    } catch (_) {}
    return { ...DEFAULT_STATUS_FILTER };
  });
  const statusFilterAllChecked = statusFilter.paid && statusFilter.unpaid && statusFilter.partial && statusFilter.overdue;
  const handleStatusFilterAll = () => {
    const next = statusFilterAllChecked ? { paid: false, unpaid: false, partial: false, overdue: false } : { ...DEFAULT_STATUS_FILTER };
    setStatusFilter(next);
    sessionStorage.setItem(STATUS_FILTER_KEY, JSON.stringify(next));
    setCurrentPage(1);
  };

  useEffect(() => {
    setTempDateRange(dateRange);
  }, [dateRange]);

  const anyMobilePopupOpen = isMobile && (
    !!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen || isNoteOpen
  );

  const openModalInUrl = React.useCallback(() => {
    if (!isMobile || !pathname) return;
    persistPlModalParentQuery(searchParams.toString());
    const params = new URLSearchParams(searchParamsStringForModalClose(searchParams.toString()));
    params.set("modal", "1");
    router.push(`${pathname}?${params.toString()}`);
  }, [isMobile, pathname, searchParams, router]);

  const closeModalInUrl = React.useCallback(() => {
    if (!pathname) return;
    const raw = searchParamsStringAfterClosingModal(searchParams.toString());
    const params = new URLSearchParams(raw);
    params.delete("modal");
    params.delete("modalts");
    patchMasterDetailUrlAfterModalClose(params, { entityId: tax?.id ?? "" });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, tax?.id]);

  const modalParam = searchParams.get("modal");
  const urlModalOpen = isMobile && modalParam === "1" && anyMobilePopupOpen;
  const closeUrlModal = React.useCallback(() => {
    setMobileFooterDialogOpen(null);
    setIsCalendarOpen(false);
    setIsVoucherDialogOpen(false);
    setSelectedVoucher(null);
    setIsNoteOpen(false);
    closeModalInUrl();
  }, [closeModalInUrl]);
  useUrlModalBack(urlModalOpen, closeUrlModal);

  useMobileLedgerModalUrlGuard({
    isMobile,
    modalParam,
    anyPopupOpen: anyMobilePopupOpen,
    openingModalRef,
    pathname,
    searchParams,
    router,
  });
  
  const {
    processedTransactions,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    openingBalanceOutstanding,
    openingBalanceLinkedVoucherNos,
  } = useTransactions(
    tax,
    'tax',
    dateRange,
    undefined,
    allTaxes,
    transactions,
    context,
    filters,
    undefined,
    undefined,
    userNames,
    undefined,
    undefined,
    undefined,
    ledgerComputeReady,
    balanceMode === "bill_wise"
  );

  // Calendar dots from entity rows only — full vouchers.forEach was a VAT-select LONGTASK.
  const transactionDates = useMemo(() => {
    const dates = new Set<number>();
    processedTransactions.forEach((v: any) => {
      const dateValue = v.date?.toDate ? v.date.toDate() : new Date(v.date);
      if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        dates.add(startOfDay(dateValue).getTime());
      }
    });
    return Array.from(dates).map((d) => new Date(d));
  }, [processedTransactions]);

  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v);

  const clearFilters = () => {
    onDateRangeChange(undefined);
    setFilters({});
  };

  const {
    unapprovedOnly,
    toggleUnapprovedOnly,
    filterByUnapprovedOnly,
    onDateRangeChangeWithUnapprovedReset,
  } = useLedgerUnapprovedOnlyFilter({
    onDateRangeChange,
    setCurrentPage,
    setFilters,
    setActiveFilter,
  });

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const handleStatusFilterChange = (key: keyof StatusFilter, checked: boolean) => {
    const next = { ...statusFilter, [key]: checked };
    setStatusFilter(next);
    sessionStorage.setItem(STATUS_FILTER_KEY, JSON.stringify(next));
    setCurrentPage(1);
  };
  
  const handleEditVoucher = useCallback((voucher: any) => {
    openingModalRef.current = true;
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    openModalInUrl();
    setIsVoucherDialogOpen(true);
  }, [openModalInUrl, ledgerSessionKey, currentPage]);

  // PC: preference; mobile: hamesha notes (includeNotesInTable)
  const displayTransactions = useMemo(
    () => (includeNotesInTable ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note")),
    [processedTransactions, includeNotesInTable]
  );
  /** Paid / Unpaid view: only TDS rows of that label; balances/opening recomputed over filtered rows from 0. */
  const isTdsTaxAccount = useMemo(
    () => (processedTransactions as any[]).some((t) => taxAccountIsTdsVerifyLegOnVoucher(t, tax?.id)),
    [processedTransactions, tax?.id]
  );
  // Paid/Unpaid view only applies to TDS tax accounts (a stale view must not blank VAT etc.).
  const tdsViewFiltered = tdsStatusView !== "balance" && isTdsTaxAccount;
  useEffect(() => {
    setTdsStatusView("balance");
  }, [tax?.id]);
  const isFiscalOrOpeningRow = (t: any) =>
    t?.type === "opening_balance" || t?.type === FISCAL_YEAR_PARTITION_ROW_TYPE || t?.type === FY_OPENING_ROW_TYPE;
  const statusFilteredTransactions = useMemo(
    () => {
      const base =
        balanceMode !== "bill_wise" ? displayTransactions : filterByStatus(displayTransactions, statusFilter);
      if (!tdsViewFiltered || !tax?.id) return base;
      const want = tdsStatusView === "paid" ? SALE_PURCHASE_TDS_VERIFIED_MESSAGE : SALE_PURCHASE_TDS_UNVERIFIED_MESSAGE;
      return base.filter(
        (t: any) =>
          !isFiscalOrOpeningRow(t) &&
          taxAccountIsTdsVerifyLegOnVoucher(t, tax.id) &&
          resolveSalePurchaseTdsVerifyLabel(t, { context: "tax", contextId: tax.id }) === want
      );
    },
    [displayTransactions, statusFilter, balanceMode, tdsViewFiltered, tdsStatusView, tax?.id]
  );

  const resolveOppositeAccountName = useCallback(
    (id: string) => {
      const fromStaff = (processedStaff || []).find((s: any) => s.id === id);
      if (fromStaff) return fromStaff.name;
      const fromParty = (processedParties || []).find((p: any) => p.id === id);
      if (fromParty) return fromParty.name;
      const fromAccounts = (processedAccounts || []).find((a: any) => a.id === id);
      if (fromAccounts) return fromAccounts.accountName;
      const fromExpense = (processedExpenseAccounts || []).find((e: any) => e.id === id);
      if (fromExpense) return fromExpense.name;
      return journalAccountNames[id] || id;
    },
    [processedStaff, processedParties, processedAccounts, processedExpenseAccounts, journalAccountNames]
  );

  const oppositeAccountFilterOptions = useMemo(() => {
    if (!tax?.id) return [];
    return getTaxOppositeAccountFilterOptions(
      displayTransactions,
      tax.id,
      processedTaxes || [],
      resolveOppositeAccountName
    );
  }, [displayTransactions, tax?.id, processedTaxes, resolveOppositeAccountName]);

  const oppositeAccountFilteredTransactions = useMemo(() => {
    if (!tax?.id || !oppositeAccountFilter) return statusFilteredTransactions;
    return filterTaxLedgerByOppositeAccount(
      statusFilteredTransactions,
      tax.id,
      oppositeAccountFilter,
      processedTaxes || []
    );
  }, [statusFilteredTransactions, tax?.id, oppositeAccountFilter, processedTaxes]);
  const oppositeAccountFilterActive =
    Boolean(String(oppositeAccountFilter || "").trim()) || tdsViewFiltered;

  const [tdsCardsOpen, setTdsCardsOpen] = useState(false);
  const [tdsAutoLinkProposal, setTdsAutoLinkProposal] = useState<TaxTdsAutoLinkProposal | null>(null);
  const [tdsAutoLinkSaving, setTdsAutoLinkSaving] = useState(false);
  const openTdsAutoLink = useCallback(() => {
    const proposal = buildTaxTdsAutoLinkProposal({
      vouchers: (vouchers as any[]) || [],
      taxRows: processedTransactions as any[],
      taxId: String(tax?.id ?? ""),
    });
    if (!proposal) {
      toast.info("No unlinked Dr entry on this tax account to link against unpaid TDS.");
      return;
    }
    setTdsAutoLinkProposal(proposal);
  }, [vouchers, processedTransactions, tax?.id]);
  const confirmTdsAutoLink = useCallback(async () => {
    const proposal = tdsAutoLinkProposal;
    if (!proposal || !companyId) return;
    setTdsAutoLinkSaving(true);
    try {
      const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
      const result = await runWithVoucherLinkSaveProgress(
        async () => {
          const n = await applyTaxTdsAutoLinkProposal(companyId, proposal, (vouchers as any[]) || []);
          return `Linked ${n} allocation${n === 1 ? "" : "s"}.`;
        },
        { successTitle: "TDS links updated" }
      );
      if (!result.ok) {
        toast.error(result.error instanceof Error ? result.error.message : "Failed to save TDS links.");
      }
      setTdsAutoLinkProposal(null);
    } finally {
      setTdsAutoLinkSaving(false);
    }
  }, [tdsAutoLinkProposal, companyId, vouchers]);
  const { paid: tdsPaidNet, unpaid: tdsUnpaidNet } = useMemo(() => {
    const out = { paid: 0, unpaid: 0 };
    const id = String(tax?.id ?? "").trim();
    if (!id) return out;
    for (const t of displayTransactions as any[]) {
      if (!taxAccountIsTdsVerifyLegOnVoucher(t, id)) continue;
      const label = resolveSalePurchaseTdsVerifyLabel(t, { context: "tax", contextId: id });
      if (!label) continue;
      const b = taxLedgerBooksDrCrFromRow(t, id);
      const net = (Number(b.debit) || 0) - (Number(b.credit) || 0);
      if (label === SALE_PURCHASE_TDS_VERIFIED_MESSAGE) out.paid += net;
      else out.unpaid += net;
    }
    return out;
  }, [displayTransactions, tax?.id]);
  // Balance = full ledger balance; Paid/Unpaid = net of only their TDS rows.
  const headerAllNet =
    typeof closingBalance === "number" && Number.isFinite(closingBalance) ? closingBalance : 0;
  /** One opposite account: start books at 0 so To Receive / row Bal = that account only (not full tax). */
  const ledgerOpeningForRunning = oppositeAccountFilterActive ? 0 : openingBalanceForPeriod;
  const mobileUnapprovedTxnCount = useMemo(
    () => countLedgerUnapprovedTransactions(oppositeAccountFilteredTransactions),
    [oppositeAccountFilteredTransactions]
  );

  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const taxBooksRebalanceOptions = useMemo(
    () => {
      const taxId = String(tax?.id || "").trim();
      if (!taxId) return undefined;
      return {
        booksDrCrForRow: (tx: any) => taxLedgerBooksDrCrFromRow(tx, taxId),
      };
    },
    [tax?.id]
  );
  const fiscalMergeCompanyKey = `${company?.fiscalSplitMode ?? ""}:${String(
    (company as { fiscalMergePartitionAtIsos?: string[] | null } | null)?.fiscalMergePartitionAtIsos?.join(",") ??
      ""
  )}`;
  const sortedTransactions = useMemo(
    () =>
      recomputeRunningBalanceTopToBottom(
        sortTransactionsWithFiscalMergeForCompany(
          filterByUnapprovedOnly(oppositeAccountFilteredTransactions),
          "date",
          DEFAULT_TRANSACTION_SORT_ORDER,
          undefined,
          company
        ),
        ledgerOpeningForRunning,
        taxBooksRebalanceOptions
      ),
    // fiscalMergeCompanyKey — avoid rebalance when useCompany() returns a new company object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- company read inside; key tracks fiscal merge fields
    [
      oppositeAccountFilteredTransactions,
      filterByUnapprovedOnly,
      ledgerOpeningForRunning,
      fiscalMergeCompanyKey,
      taxBooksRebalanceOptions,
    ]
  );

  useEnsureEntityMinTxnsInScope({
    dateRange,
    entityId: tax?.id,
    entityKind: "tax",
    entityTxnCount: sortedTransactions.length,
    // Default “Last N” — do not FY-widen to full SQLite tax history (TDS hang).
    maxAutoWidenTarget: MASTER_LEDGER_DEFAULT_TXN_COUNT,
    enabled: Boolean(tax?.id),
  });

  const searchFilteredTransactions = useMemo(() => {
    if (!mobileSearchTerm.trim()) return sortedTransactions;
    const q = mobileSearchTerm.toLowerCase().trim();
    return sortedTransactions.filter((t) => {
      const d = t.date?.toDate ? t.date.toDate() : t.date ? new Date(t.date) : null;
      const dateStr = d ? (dateSystem === "BS" ? formatDateBS(d) : format(d, "yyyy-MM-dd")) : "";
      const timeStr = formatVoucherEntryTimeLocal(t as Record<string, unknown>) || (d ? format(d, "h:mm a") : "");
      const amt = t.debit > 0 ? t.debit : t.credit;
      const bal = t.balance ?? t.runningBalance ?? 0;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, tax ? "tax" : undefined, tax?.id).includes(q) ||
        dateStr.toLowerCase().includes(q) ||
        timeStr.toLowerCase().includes(q) ||
        String(amt || 0).toLowerCase().includes(q) ||
        String(t.debit || 0).toLowerCase().includes(q) ||
        String(t.credit || 0).toLowerCase().includes(q) ||
        String(bal).toLowerCase().includes(q)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, dateSystem, formatDateBS, format, mobileSearchNames, tax?.id]);

  const mobileTransactions = useMemo(() => {
    const list = searchFilteredTransactions;
    if (rowsPerPage <= 0) return list;
    const total = list.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return list.slice(start, Math.max(start, end));
  }, [searchFilteredTransactions, currentPage, rowsPerPage]);
  const mobilePagerEdgeCounts = useMemo(() => {
    const total = searchFilteredTransactions.length;
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return { before: start, after: Math.max(0, total - end) };
  }, [searchFilteredTransactions.length, currentPage, rowsPerPage]);

  const taxDropdownOptions = useMemo(
    () => (allTaxes || []).map((t) => ({ value: t.id, label: t.name })),
    [allTaxes]
  );

  useEffect(() => {
    const total = rowsPerPage > 0 ? Math.ceil(searchFilteredTransactions.length / rowsPerPage) : 1;
    const safeTotal = Math.max(1, total);
    setCurrentPage((prev) => Math.min(Math.max(1, prev), safeTotal));
  }, [dateRange, searchFilteredTransactions.length, rowsPerPage]);

  // Statement check mode + desktop tail paging (PC footer Check mode pill)
  const {
    statementCheck,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "tax",
    contextId: tax?.id,
    viewMode: balanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions: searchFilteredTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  /**
   * Top To Receive / To Pay:
   * - All accounts → full tax closingBalance
   * - One opposite account → last running balance of that filtered list
   */
  const headerClosingBalance = useMemo(() => {
    if (!oppositeAccountFilterActive) {
      return typeof closingBalance === "number" && Number.isFinite(closingBalance)
        ? closingBalance
        : 0;
    }
    const list = sortedTransactions as any[];
    if (list.length === 0) return 0;
    const last = list[list.length - 1];
    const bal = last?.balance ?? last?.runningBalance;
    if (typeof bal === "number" && Number.isFinite(bal)) return bal;
    return 0;
  }, [oppositeAccountFilterActive, closingBalance, sortedTransactions]);

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "tax",
    contextId: tax?.id,
    viewMode: ledgerViewMode,
    totalPages,
    currentPage,
    setCurrentPage,
    vouchers,
    selectedVoucherId: selectedVoucher?.id ?? null,
    isVoucherDialogOpen,
    setSelectedVoucher,
    setIsVoucherDialogOpen,
    onRestoreVoucherDialog: isMobile ? openModalInUrl : undefined,
  });


  const buildDateRangeText = () => {
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if (from) {
      const fromBS = formatDateBS(from);
      const toBS = to ? formatDateBS(to) : fromBS;
      const fromAD = formatDate(from);
      const toAD = to ? formatDate(to) : fromAD;
      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD} to ${toAD}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS} to ${toBS}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    return dateRangeText;
  };

  const dateRangeLabel = useMemo(
    () => ledgerMasterDateRangeLabel(dateRange, buildDateRangeText()),
    [dateRange, dateSystem, formatDateBS, formatDate]
  );

  const handlePrintStatement = (billWise: boolean = false) => {
    if (!company || !tax) return Promise.resolve();
    // Keep print headers aligned with currently selected table columns.
    const printVisibleColumns = billWise ? { ...visibleColumns, status: true } : visibleColumns;
    return openPrintDirect(
      applyLedgerPageToPrintPayload(
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
          title: `Tax Statement: ${tax.name}`,
          context: "tax",
          contextId: tax.id,
          dateSystem: dateSystem,
          dateRangeText: buildDateRangeText(),
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (tax as any).openingBalanceDate,
          openingBalanceNarration: tax.openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          billWise: billWise,
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: Number((tax as any).openingBalance) || 0,
          ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: dateRange?.from,
          masterOpeningBalanceDate: (tax as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  const buildStatementPdfBlob = React.useCallback(async () => {
    if (!company || !tax) return null;
    const printVisibleColumns = ledgerConfirmationPrintVisibleColumns(visibleColumns);
    const payload = applyLedgerPageToPrintPayload(
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
        title: `Tax Statement: ${tax.name}`,
        context: "tax",
        contextId: tax.id,
        dateSystem: dateSystem,
        dateRangeText: buildDateRangeText(),
        vouchersCount: paginatedTransactions.length,
        openingBalance: desktopPaginationMeta.openingForPage,
        openingBalanceDate: (tax as any).openingBalanceDate,
        openingBalanceNarration: tax.openingBalanceNarration ?? null,
        transactions: paginatedTransactions,
        showNarration: showNarration,
        includeNotes: includeNotesInTable,
        visibleColumns: printVisibleColumns,
        billWise: false,
      },
      {
        paginatedTransactions,
        openingForPage: desktopPaginationMeta.openingForPage,
        periodDrForPage: desktopPaginationMeta.periodDrForPage,
        periodCrForPage: desktopPaginationMeta.periodCrForPage,
        closingForPage: desktopPaginationMeta.closingForPage,
        booksOpeningBalance: Number((tax as any).openingBalance) || 0,
        ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0,
        ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
        openingBalancePeriodStartDate: dateRange?.from,
        masterOpeningBalanceDate: (tax as any).openingBalanceDate,
        dateRange,
      }
    );
    return getPdfBlob(payload);
  }, [
    company,
    tax,
    visibleColumns,
    dateSystem,
    paginatedTransactions,
    desktopPaginationMeta,
    showNarration,
    includeNotesInTable,
    rowsPerPage,
    dateRange,
    buildDateRangeText,
  ]);

  buildStatementPdfRef.current = buildStatementPdfBlob;

  const handlePrint = () => {
    setTimeout(async () => {
      try {
        await handlePrintStatement(balanceMode === "bill_wise");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
      }
    }, 200);
  };

  if (!tax) {
    return null;
  }

  const balanceLabel = headerClosingBalance >= 0 ? "To Receive" : "To Pay";
  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);
  const masterTaxOpening = oppositeAccountFilterActive || tdsViewFiltered
    ? 0
    : Number((tax as any).openingBalance) || 0;
  const showTaxBookOpeningRow =
    !oppositeAccountFilterActive &&
    !tdsViewFiltered &&
    (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0);

  const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
    const range = dateRange;
    if (!range?.from || (range.from && range.to)) {
      onDateRangeChange({ from: adDate, to: undefined });
    } else if (adDate < range.from) {
      onDateRangeChange({ from: adDate, to: range.from });
      setIsCalendarOpen(false);
    } else {
      onDateRangeChange({ from: range.from, to: adDate });
      setIsCalendarOpen(false);
    }
  };

  const reportStickyTitle = mobileReportStickyTitle ?? (context === "payment-out" ? "Payment Out" : "Report");

  const handleExcelLedger = useCallback(() => {
    const rows = searchFilteredTransactions.map((t: Record<string, unknown>) => {
      const dRaw = (t as { date?: { toDate?: () => Date } }).date;
      const d = dRaw?.toDate ? dRaw.toDate() : new Date((t as { date?: unknown }).date as string | number | Date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": (t as { voucherNumber?: string }).voucherNumber,
        Narration: String((t as { narration?: string }).narration || ""),
        Debit: Number((t as { debit?: number }).debit) || 0,
        Credit: Number((t as { credit?: number }).credit) || 0,
        Balance: `${Math.abs(Number((t as { balance?: number }).balance) || 0).toFixed(2)} ${((t as { balance?: number }).balance ?? 0) >= 0 ? "Dr" : "Cr"}`,
      };
    });
    const summaryRows = [
      {
        "Date (BS)": "Opening Balance",
        Balance: `${Math.abs(ledgerOpeningForRunning).toFixed(2)} ${ledgerOpeningForRunning >= 0 ? "Dr" : "Cr"}`,
      },
      { "Date (BS)": "Total", Debit: periodDr, Credit: periodCr },
      {
        "Date (BS)": "Closing Balance",
        Balance: `${Math.abs(headerClosingBalance).toFixed(2)} ${headerClosingBalance >= 0 ? "Dr" : "Cr"}`,
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet([...rows, {}, ...summaryRows] as Record<string, unknown>[]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger");
    const safeName = (tax?.name || "tax").replace(/[/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeName}_ledger.xlsx`);
  }, [
    searchFilteredTransactions,
    formatDate,
    formatDateBS,
    ledgerOpeningForRunning,
    periodDr,
    periodCr,
    headerClosingBalance,
    tax?.name,
  ]);

  if (isMobile) {
    const isReportMobileChrome = mobileFooterVariant === "report";
    const hideReportTaxPicker = isReportMobileChrome && context === "payment-out";

    const mobileEntityTxnToolbar = (
      <MobileEntityTxnToolbarRow placement="belowPager">
        {!hideReportTaxPicker && allTaxes && allTaxes.length > 0 && (
          <MobileEntityTxnToolbarPicker>
            <Combobox
              options={taxDropdownOptions}
              value={tax.id}
              onChange={(value) => {
                if (value && value !== tax.id) router.push(`/tax/${value}`);
              }}
              placeholder="Select tax"
            />
          </MobileEntityTxnToolbarPicker>
        )}
        <MobileEntityTxnToolbarUnapprovedBadge
          count={mobileUnapprovedTxnCount}
          pressed={unapprovedOnly}
          onToggle={toggleUnapprovedOnly}
        />
        <MobileEntityTxnToolbarSearch>
          <Search className={mdc.mobileTxnToolbarSearchIcon} />
          <Input
            placeholder="Search transactions"
            className={mdc.mobileTxnToolbarSearchInput}
            value={mobileSearchTerm}
            onChange={(e) => {
              setMobileSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </MobileEntityTxnToolbarSearch>
      </MobileEntityTxnToolbarRow>
    );

    return (
      <>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
          {isReportMobileChrome && onBack ? (
            <header className="sticky top-0 z-10 flex-shrink-0 border-b bg-white p-3 dark:bg-card">
              <div className="flex min-w-0 items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onBack} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <h1 className="shrink-0 text-base font-bold text-muted-foreground">{reportStickyTitle}</h1>
                  <span className="shrink-0 select-none text-muted-foreground/55" aria-hidden>Â·</span>
                  <span
                    className={cn("min-w-0 truncate text-sm font-medium", masterDetailBalanceToneClass(headerClosingBalance))}
                    title={tax.name}
                  >
                    {tax.name}
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm font-bold whitespace-nowrap",
                    headerClosingBalance >= 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  {formatCurrency(headerClosingBalance, { showDrCr: true })}
                </span>
              </div>
            </header>
          ) : null}
          {/* Mobile: date/balance/search â€” footer chevron se collapse (group pages jaisa) */}
          <MobileDetailSummaryCollapsible>
          {!hideMobilePeriodLabelRow ? (
            <div className="px-2 py-1 border-b flex justify-center items-center gap-1.5 flex-shrink-0">
              <span className="text-xs font-medium text-muted-foreground">
                {dateRangeLabel}
              </span>
              {dateRange != null && (dateRange.from != null || dateRange.to != null) && (
                <button
                  type="button"
                  onClick={() => onDateRangeChange(undefined)}
                  className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                  aria-label="Clear date filter"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : null}
          <div
            className={cn(
              mdc.mobileTxnBalanceRow,
              oppositeAccountFilterOptions.length > 0
                ? "justify-between gap-1.5 px-2"
                : ""
            )}
            {...mdcMobileTxnBalanceRowData}
            {...(oppositeAccountFilterOptions.length > 0
              ? { "data-pl-tax-balance-with-account-filter": "" }
              : {})}
          >
            {oppositeAccountFilterOptions.length > 0 ? (
              <div
                className="min-w-0 max-w-[50%] flex-[0_1_50%] w-[50%]"
                data-pl-tax-balance-account-filter=""
              >
                <Combobox
                  options={oppositeAccountFilterOptions}
                  value={oppositeAccountFilter}
                  onChange={(value) => {
                    setOppositeAccountFilter(value);
                    setCurrentPage(1);
                  }}
                  placeholder="All accounts"
                  showFullOptionText={true}
                  triggerClassName={cn(
                    LEDGER_HEADER_PILL_CN,
                    chromePillBtn(false),
                    "!h-7 min-h-7 w-full min-w-0 max-w-full text-xs truncate"
                  )}
                />
              </div>
            ) : null}
            <p
              className={cn(
                oppositeAccountFilterOptions.length > 0
                  ? cn(mdc.mobileTxnBalanceTextLg, "flex items-center justify-end gap-1 min-w-0 flex-1 overflow-hidden text-right")
                  : mdc.mobileTxnBalanceText2xl,
                headerClosingBalance >= 0 ? "text-green-600" : "text-red-600"
              )}
            >
              <span className="min-w-0 shrink truncate text-[0.6em] leading-none">{balanceLabel}</span>{" "}
              <span className="flex-none whitespace-nowrap">{formatCurrency(Math.abs(headerClosingBalance), { noSuffix: true })}</span>
            </p>
          </div>
          </MobileDetailSummaryCollapsible>
          {/* scroll-touch + inline style for APK/WebView touch scroll */}
          <div
            className={mobileTxnScrollBodyClass(isReportMobileChrome)}
          >
            <div className="pb-2">
            <MasterAccountFreezeTxnShell
              overlay={taxFreezeOverlay}
            >
            <TransactionsTable
              transactions={mobileTransactions}
              context="tax"
              contextId={tax.id}
              transactionCardSearchHighlight={mobileSearchTerm}
              openingBalance={desktopPaginationMeta.openingForPage}
              booksOpeningBalance={masterTaxOpening}
              ledgerDateFilterActive={hasLedgerDateFilter}
              ledgerShowBookOpeningRow={showTaxBookOpeningRow}
              hideLedgerOpeningRows={oppositeAccountFilterActive}
              hideFiscalPartitionRows={tdsViewFiltered}
              openingBalancePeriodStartDate={dateRange?.from}
              dateRange={dateRange}
              openingBalanceOutstanding={openingBalanceOutstanding}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceNarration={tax.openingBalanceNarration}
              openingBalanceAttachmentUrls={tax.documentFileUrls}
              openingBalanceDate={(tax as any).openingBalanceDate}
              openingBalanceActions={undefined}
              showNarration={showNarration}
              visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
              forceBalanceMode={balanceMode === "bill_wise" ? "bill_wise" : "statement"}
              journalAccountNames={journalAccountNames}
              userNames={userNames}
              onRowClick={handleEditVoucher}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={desktopPaginationMeta.closingForPage}
              isTaxContext={isTaxContext ?? true}
              scrollOnlyTransactions
              closingBalanceRowActions={taxClosingBalanceRowActions}
              closingBalanceActions={taxClosingBalanceActions}
              statusFilter={statusFilter}
              statusFilterAllChecked={statusFilterAllChecked}
              onStatusFilterAll={handleStatusFilterAll}
              onStatusFilterChange={handleStatusFilterChange}
              statusFilterIdPrefix="tax"
            
              {...statementCheck.tableProps}/>
            </MasterAccountFreezeTxnShell>
            </div>
          </div>
          {isReportMobileChrome ? (
            <MobileTransactionsPager
              className={mdc.reportTxnPagerOutside}
              currentPage={currentPage}
              totalItems={searchFilteredTransactions.length}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(nextRows) => {
                setRowsPerPage(nextRows);
                setCurrentPage(1);
              }}
              onPageChange={setCurrentPage}
              edgeCounts={rowsPerPage > 0 ? mobilePagerEdgeCounts : undefined}
              txnToolbar={mobileEntityTxnToolbar}
            />
          ) : null}
          {!isReportMobileChrome ? (
            <MobileTransactionsPager
              className={mdc.ledgerTxnPagerOutside}
              currentPage={currentPage}
              totalItems={searchFilteredTransactions.length}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(nextRows) => {
                setRowsPerPage(nextRows);
                setCurrentPage(1);
              }}
              onPageChange={setCurrentPage}
              edgeCounts={rowsPerPage > 0 ? mobilePagerEdgeCounts : undefined}
              txnToolbar={mobileEntityTxnToolbar}
            />
          ) : null}
        </div>
        {isReportMobileChrome ? (
          <ReportMobileLedgerFooter
            onPrint={handlePrint}
            onExcel={handleExcelLedger}
            onDateOpen={() => {
              openingModalRef.current = true;
              setIsCalendarOpen(true);
              openModalInUrl();
            }}
            balanceMode={balanceMode}
            onBalanceModeToggle={() => setBalanceMode(balanceMode === "bill_wise" ? "statement" : "bill_wise")}
            showChart={false}
          />
        ) : (
        <div
          className="fixed bottom-0 left-0 right-0 p-1.5 border-t bg-background/95 backdrop-blur z-50 flex items-center justify-around gap-1.5"
          data-pl-mobile-ledger-action-footer=""
        >
          {/* Mobile: Statement ↔ Bill wise (Party/Staff jaisa) — status column + bill-wise linking */}
          <LedgerViewModeToggleButton
            value={balanceMode}
            onChange={setBalanceMode}
            options={[
              { value: "statement", label: "Statement" },
              { value: "bill_wise", label: "Bill wise" },
            ]}
            className="h-6 text-xs font-medium"
          />
          <Button className="flex-1 h-6 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-medium" onClick={() => { openingModalRef.current = true; setMobileFooterDialogOpen("payment_in"); openModalInUrl(); }}>
            Receive
          </Button>
          <Button className="flex-1 h-6 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium" onClick={() => { openingModalRef.current = true; setMobileFooterDialogOpen("payment_out"); openModalInUrl(); }}>
            Pay
          </Button>
          <MobileEntityLedgerFooterPrintButton onClick={() => void handlePrint()} />
          <AddVoucherDialog
            isOpen={!!mobileFooterDialogOpen}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setMobileFooterDialogOpen(null);
                closeModalInUrl();
              }
            }}
            defaultTab={mobileFooterDialogOpen || "sale"}
            defaultVoucherData={{ payeeType: "tax", taxAccountId: tax.id }}
          />
          <Drawer
            open={isCalendarOpen}
            onOpenChange={(open: boolean) => {
              if (open) {
                openingModalRef.current = true;
                openModalInUrl();
              }
              setIsCalendarOpen(open);
              if (!open) closeModalInUrl();
            }}
          >
            <DrawerTrigger asChild>
              <Button className="flex-1 h-6 min-w-0 rounded-md text-xs font-medium px-1 bg-pink-600 hover:bg-pink-700 text-white">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader className="p-4 text-left">
                <DrawerTitle>Select Date Range</DrawerTitle>
                <DrawerDescription>Select a date range for the transaction list.</DrawerDescription>
              </DrawerHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                {(dateSystem === "BS" || dateSystem === "Both") && (
                  <NepaliCalendar
                    rangePresetSlot={
                      <MasterLedgerDateRangePresetRow
                        ledgerPaginationReset={ledgerPaginationReset}
                        country={company?.country}
                        onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                        onApply={(r) => {
                          onDateRangeChange(r);
                          setIsCalendarOpen(false);
                        }}
                        onAfterDefault={() => setIsCalendarOpen(false)}
                      />
                    }
                    onSelect={handleNepaliSelect}
                    valueAD={dateRange}
                    isRange={true}
                    numberOfMonths={calendarMonths}
                  />
                )}
                {(dateSystem === "AD" || dateSystem === "Both") && (
                  <div className="flex-1 w-full min-w-0">
                    <AdCalendar
                      rangePresetSlot={
                        <MasterLedgerDateRangePresetRow
                          ledgerPaginationReset={ledgerPaginationReset}
                          country={company?.country}
                          onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                          onApply={(r) => {
                            onDateRangeChange(r);
                            setIsCalendarOpen(false);
                          }}
                          onAfterDefault={() => setIsCalendarOpen(false)}
                        />
                      }
                      valueAD={dateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = dateRange;
                        if (!range?.from || (range.from && range.to)) {
                          onDateRangeChange({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          onDateRangeChange({ from: adDate, to: range.from });
                          setIsCalendarOpen(false);
                        } else {
                          onDateRangeChange({ from: range.from, to: adDate });
                          setIsCalendarOpen(false);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <DrawerFooter className="p-4 pt-2">
                <DrawerClose asChild>
                  <Button variant="outline">Close</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </div>
        )}
        {isReportMobileChrome ? (
          <Drawer
            open={isCalendarOpen}
            onOpenChange={(open: boolean) => {
              if (open) {
                openingModalRef.current = true;
                openModalInUrl();
              }
              setIsCalendarOpen(open);
              if (!open) closeModalInUrl();
            }}
          >
            <DrawerContent>
              <DrawerHeader className="p-4 text-left">
                <DrawerTitle>Select Date Range</DrawerTitle>
                <DrawerDescription>Select a date range for the transaction list.</DrawerDescription>
              </DrawerHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                {(dateSystem === "BS" || dateSystem === "Both") && (
                  <NepaliCalendar
                    rangePresetSlot={
                      <MasterLedgerDateRangePresetRow
                        ledgerPaginationReset={ledgerPaginationReset}
                        country={company?.country}
                        onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                        onApply={(r) => {
                          onDateRangeChange(r);
                          setIsCalendarOpen(false);
                        }}
                        onAfterDefault={() => setIsCalendarOpen(false)}
                      />
                    }
                    onSelect={handleNepaliSelect}
                    valueAD={dateRange}
                    isRange={true}
                    numberOfMonths={calendarMonths}
                  />
                )}
                {(dateSystem === "AD" || dateSystem === "Both") && (
                  <div className="flex-1 w-full min-w-0">
                    <AdCalendar
                      rangePresetSlot={
                        <MasterLedgerDateRangePresetRow
                          ledgerPaginationReset={ledgerPaginationReset}
                          country={company?.country}
                          onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                          onApply={(r) => {
                            onDateRangeChange(r);
                            setIsCalendarOpen(false);
                          }}
                          onAfterDefault={() => setIsCalendarOpen(false)}
                        />
                      }
                      valueAD={dateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = dateRange;
                        if (!range?.from || (range.from && range.to)) {
                          onDateRangeChange({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          onDateRangeChange({ from: adDate, to: range.from });
                          setIsCalendarOpen(false);
                        } else {
                          onDateRangeChange({ from: range.from, to: adDate });
                          setIsCalendarOpen(false);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <DrawerFooter className="p-4 pt-2">
                <DrawerClose asChild>
                  <Button variant="outline">Close</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        ) : null}
        <Dialog
          open={isNoteOpen}
          onOpenChange={(open: boolean) => {
            setIsNoteOpen(open);
            if (!open) closeModalInUrl();
          }}
        >
          <DialogContent
            overlayClassName={nestedLedgerNoteDialogShell.overlayClassName}
            className={nestedLedgerNoteDialogShell.className}
          >
            <DialogHeader>
              <DialogTitle>Add a New Note for {tax.name}</DialogTitle>
              <DialogDescription>Record a new note associated with this tax.</DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
              <CreateNoteForm
                onVoucherAction={() => { onTaxUpdated(); setIsNoteOpen(false); }}
                initialContext="Tax"
                initialEntityId={tax.id}
                compactFooter
              />
            </div>
          </DialogContent>
        </Dialog>
        <AddVoucherDialog
          isOpen={isVoucherDialogOpen}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setIsVoucherDialogOpen(false);
              setSelectedVoucher(null);
              closeModalInUrl();
            }
          }}
          voucher={selectedVoucher}
          onVoucherAction={() => setSelectedVoucher(null)}
        />
      </>
    );
  }

  return (
    <>
      <div className="h-full">
        <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Header: identity + pills â€” Party-style single row */}
        {/* TABLE AREA - flex layout so table footer (Total / Closing Balance) stays visible */}
        <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              {/* Local `local:â€¦` refs + HTTPS URLs â€” same as bank/party; hover = voucher preview frame */}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                <EntityFileAttachmentHover
                  fileUrl={taxHeaderAttachmentUrl}
                triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
              >
                <ResolvedEntityAvatar
                  className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                    src={taxHeaderAttachmentUrl ?? undefined}
                    alt={tax.name}
                    fallbackSlot={<Receipt className="h-6 w-6 text-muted-foreground" />}
                  />
                </EntityFileAttachmentHover>
                <EditTaxDialog
                  tax={tax}
                  allTaxes={allTaxes}
                  onTaxUpdated={handleTaxUpdated}
                  onTaxDeleted={() => onTaxDeleted(tax.id)}
                  hasTransactions={processedTransactions.length > 0}
                >
                  <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                    <Pencil className="h-3 w-3" />
                  </button>
                </EditTaxDialog>
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                <h2 className={LEDGER_HEADER_TITLE_CN} title={tax.name}>{tax.name}</h2>
              </div>
              {reportSummaryCards?.length ? (
                <ReportHeaderSummaryCards cards={reportSummaryCards} />
              ) : isTdsTaxAccount ? (
              <Popover open={tdsCardsOpen} onOpenChange={setTdsCardsOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className={cn(LEDGER_HEADER_BALANCE_CARD_CN, "cursor-pointer text-left")} title="Balance / Paid / Unpaid TDS">
                    <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                      <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>
                        {tdsStatusView === "paid" ? "Verified" : tdsStatusView === "unpaid" ? "Unverified/Unlinked" : "Balance"} <ChevronDown className="ml-0.5 inline-block h-4 w-4 align-[-3px]" />
                      </span>
                      <div className={cn(LEDGER_HEADER_BALANCE_CN, headerClosingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                        {formatCurrency(headerClosingBalance, { showDrCr: true })}
                      </div>
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="flex gap-2">
                    {([
                      ["balance", "Balance", headerAllNet],
                      ["paid", "Verified", tdsPaidNet],
                      ["unpaid", "Unverified/Unlinked", tdsUnpaidNet],
                    ] as const).map(([opt, label, net]) => (
                      <button
                        key={opt}
                        type="button"
                        className={cn(
                          LEDGER_HEADER_BALANCE_CARD_CN,
                          "cursor-pointer text-left",
                          tdsStatusView === opt && "ring-2 ring-primary"
                        )}
                        onClick={() => {
                          setTdsStatusView(opt);
                          setCurrentPage(1);
                          setTdsCardsOpen(false);
                        }}
                      >
                        <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                          <span className={cn(LEDGER_HEADER_BALANCE_LABEL_CN, "whitespace-nowrap")}>{label}</span>
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, net >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(net, { showDrCr: true })}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>                </PopoverContent>
              </Popover>
              ) : (
              <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
                <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                  <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                  <div className={cn(LEDGER_HEADER_BALANCE_CN, headerClosingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(headerClosingBalance, {showDrCr: true})}
                  </div>
                </div>
              </div>
              )}
            </div>
            <div className={LEDGER_HEADER_PILL_ROW_CN}>
            {oppositeAccountFilterOptions.length > 0 && (
              <div className="w-[200px] shrink-0 min-h-7 overflow-visible py-px">
                <Combobox
                  options={oppositeAccountFilterOptions}
                  value={oppositeAccountFilter}
                  onChange={(value) => {
                    setOppositeAccountFilter(value);
                    setCurrentPage(1);
                  }}
                  placeholder="All accounts"
                  triggerClassName={cn(LEDGER_HEADER_PILL_CN, chromePillBtn(false), "!h-7 min-h-7")}
                />
                  </div>
            )}
              <LedgerHeaderPrintButton variant="outline" onClick={handlePrint} />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
              {(dateSystem === 'BS' || dateSystem === 'Both') && (
                <BsDatePicker
                  isRange
                  masterLedgerDatePresets
                  ledgerPaginationReset={ledgerPaginationReset}
                  valueAD={dateRange}
                  onChangeAD={(range) => onDateRangeChangeWithUnapprovedReset(range as DateRange | undefined)}
                  transactionDates={transactionDates}
                  className={cn("w-auto", LEDGER_HEADER_PILL_CN)}
                />
              )}
              {(dateSystem === 'AD' || dateSystem === 'Both') && (
                <Popover open={isDesktopCalendarOpen} onOpenChange={setIsDesktopCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant={"outline"}
                      className={cn("justify-start text-left font-normal px-2 w-auto", LEDGER_HEADER_PILL_CN, !dateRange && "text-muted-foreground")}
                    >
                      <CalendarIcon className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <AdCalendar
                      rangePresetSlot={
                        <MasterLedgerDateRangePresetRow
                          ledgerPaginationReset={ledgerPaginationReset}
                          country={company?.country}
                          onDateRangeChange={onDateRangeChangeWithUnapprovedReset}
                          onApply={(r) => {
                            setTempDateRange(r);
                            onDateRangeChangeWithUnapprovedReset(r);
                            setIsDesktopCalendarOpen(false);
                          }}
                          onAfterDefault={() => {
                            setTempDateRange(undefined);
                            setIsDesktopCalendarOpen(false);
                          }}
                        />
                      }
                      valueAD={tempDateRange}
                      isRange
                      numberOfMonths={calendarMonths}
                      transactionDates={transactionDates}
                      onSelect={(adDate) => {
                        const range = tempDateRange;
                        if (!range?.from || (range.from && range.to)) {
                          setTempDateRange({ from: adDate, to: undefined });
                        } else if (adDate < range.from) {
                          const next = { from: adDate, to: range.from };
                          setTempDateRange(next);
                          onDateRangeChangeWithUnapprovedReset(next);
                          setIsDesktopCalendarOpen(false);
                        } else {
                          const next = { from: range.from, to: adDate };
                          setTempDateRange(next);
                          onDateRangeChangeWithUnapprovedReset(next);
                          setIsDesktopCalendarOpen(false);
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {isFilterActive && (
                <Button variant="ghost" size="icon" onClick={clearFilters} className={cn(LEDGER_HEADER_PILL_ICON_CN, "text-muted-foreground hover:text-foreground")} aria-label="Clear date filter">
                  <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
                </Button>
              )}
              <NotificationBell context="Tax" entityId={tax.id} />
              <LedgerViewModePills
                value={balanceMode}
                onChange={setBalanceMode}
                options={[
                  { value: "statement", label: "Statement" },
                  { value: "bill_wise", label: "Bill wise" },
                ]}
              />
              <Button variant="outline" size="sm" onClick={() => setIsNoteOpen(true)} className={LEDGER_HEADER_PILL_CN}>
                <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
              </Button>
              {isCompanyAdmin ? (
                <>
                <Button
                  type="button"
                  variant="chromePill"
                  size="sm"
                  className={LEDGER_HEADER_PILL_CN}
                  onClick={openTdsAutoLink}
                >
                  Link for Bill Wise
                </Button>
                <Dialog open={!!tdsAutoLinkProposal} onOpenChange={(o) => { if (!o && !tdsAutoLinkSaving) setTdsAutoLinkProposal(null); }}>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Link Dr entries to unpaid TDS</DialogTitle>
                      <DialogDescription>
                        {tax.name} · oldest unpaid TDS first · total {formatCurrency(tdsAutoLinkProposal?.total ?? 0)}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[50vh] overflow-auto text-sm">
                      {(tdsAutoLinkProposal?.rows ?? []).map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2 border-b py-1">
                          <span className="truncate">{r.sourceNo || r.sourceType} → {r.targetNo || r.targetType}</span>
                          <span className="font-semibold">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={tdsAutoLinkSaving} onClick={() => setTdsAutoLinkProposal(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" disabled={tdsAutoLinkSaving} onClick={() => void confirmTdsAutoLink()}>
                        Link
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                </>
              ) : null}
              {onShowAll && (
                <Button variant="outline" size="sm" onClick={onShowAll} className={LEDGER_HEADER_PILL_CN}>
                  All Vouchers
                </Button>
              )}
              
            </div>
          </div>
        </div>
          }
          table={
          <>
                <MasterAccountFreezeTxnShell
                  overlay={taxFreezeOverlay}
                >
                <TransactionsTable
                  transactions={paginatedTransactions}
                  context="tax"
                  contextId={tax.id}
                  openingBalance={desktopPaginationMeta.openingForPage}
                  booksOpeningBalance={masterTaxOpening}
                  ledgerDateFilterActive={hasLedgerDateFilter}
                  ledgerShowBookOpeningRow={showTaxBookOpeningRow}
                  hideLedgerOpeningRows={oppositeAccountFilterActive}
              hideFiscalPartitionRows={tdsViewFiltered}
                  openingBalancePeriodStartDate={dateRange?.from}
                  dateRange={dateRange}
                  openingBalanceOutstanding={openingBalanceOutstanding}
                  openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
                  openingBalanceNarration={tax.openingBalanceNarration}
                  openingBalanceAttachmentUrls={tax.documentFileUrls}
                  openingBalanceDate={(tax as any).openingBalanceDate}
                  openingBalanceActions={
                    <EditTaxDialog
                      tax={tax}
                      allTaxes={allTaxes}
                      onTaxUpdated={handleTaxUpdated}
                      onTaxDeleted={() => onTaxDeleted(tax.id)}
                      hasTransactions={processedTransactions.length > 0}
                    >
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </EditTaxDialog>
                  }
                  showNarration={showNarration}
                  visibleColumns={balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns}
                  forceBalanceMode={balanceMode === "bill_wise" ? "bill_wise" : "statement"}
                  periodDr={desktopPaginationMeta.periodDrForPage}
                  periodCr={desktopPaginationMeta.periodCrForPage}
                  closingBalance={desktopPaginationMeta.closingForPage}
                  onRowClick={handleEditVoucher}
                  userNames={userNames}
                  filters={filters}
                  setFilters={setFilters}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  isTaxContext={isTaxContext ?? true}
                  scrollOnlyTransactions
                  closingBalanceRowActions={taxClosingBalanceRowActions}
              closingBalanceActions={taxClosingBalanceActions}
                  highlightPendingApproval
                />
                </MasterAccountFreezeTxnShell>
          </>
          }
          footer={
        <LedgerDesktopFooter
          left={
            <>
              <LedgerFooterCheckboxPill
                id="show-narration-tax"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
              <LedgerFooterColumnsMenu ledgerPresentationMode={ledgerPresentationMode}>
                <DropdownMenuContent align="start" className="w-52 p-2">
                  {(Object.keys(COLUMN_LABELS) as TransactionColumnKey[])
                    .filter((key) => key !== "status" || balanceMode === "bill_wise")
                    .map((key) => {
                    const isStatusInStatement = key === "status" && balanceMode === "statement";
                    const isStatusInBillWise = key === "status" && balanceMode === "bill_wise";
                    const isStatusLocked = isStatusInStatement || isStatusInBillWise;
                    return (
                      <DropdownMenuItem
                        key={key}
                        onSelect={(e) => e.preventDefault()}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Checkbox
                          id={`col-${key}-tax`}
                          checked={isStatusInStatement ? false : (isStatusInBillWise ? true : visibleColumns[key] !== false)}
                          disabled={isStatusLocked}
                          onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                        />
                        <label htmlFor={`col-${key}-tax`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                          {COLUMN_LABELS[key]}
                        </label>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-tax"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="tax"
                enabled={statementCheck.checkModeEnabled}
                onEnabledChange={statementCheck.setCheckModeEnabled}
                viewMode={balanceMode === "bill_wise" ? "bill_wise" : "statement"}
                hiddenCount={statementCheck.hiddenCount}
              />
            </>
          }
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={(by, order) => {
            setSortBy(by);
            setSortOrder(order);
          }}
          viewMode={balanceMode === "bill_wise" ? "bill_wise" : "statement"}
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
          rowsPerPageSelectValue={`${rowsPerPage}`}
          onRowsPerPageChange={(value) => {
            setRowsPerPage(Number(value) || 0);
            setCurrentPage(1);
          }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS_DEFAULT}
          beforeCount={desktopPaginationMeta.beforeCount}
          afterCount={desktopPaginationMeta.afterCount}
          totalCount={searchFilteredTransactions.length}
          ledgerPresentationMode={ledgerPresentationMode}
        />
          }
        />
        </div>
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent
          overlayClassName={nestedLedgerNoteDialogShell.overlayClassName}
          className={nestedLedgerNoteDialogShell.className}
        >
          <DialogHeader>
            <DialogTitle>Add a New Note for {tax.name}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this tax.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onTaxUpdated();
                setIsNoteOpen(false);
              }}
              initialContext="Tax"
              initialEntityId={tax.id}
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open) => {
          setIsVoucherDialogOpen(!!open);
          if (!open) {
            setSelectedVoucher(null);
            if (isMobile) closeModalInUrl();
          }
        }}
        voucher={selectedVoucher}
        onVoucherCreated={() => {
          setSelectedVoucher(null);
          onTaxUpdated();
        }}
        onVoucherAction={(status) => {
          if (status === "saved") onTaxUpdated();
          setSelectedVoucher(null);
        }}
      />
    </>
  );
}
