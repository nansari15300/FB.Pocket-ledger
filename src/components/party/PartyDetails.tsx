

"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import { useShowAllTdsCards } from "@/lib/useShowAllTdsCards";
import * as React from "react";
import { toast } from "sonner";
import { openPrintDirect, getPdfBlob, companyFiscalFieldsForPrint } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import type { Party, Group } from "@/components/party/types";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { Button } from "@/components/ui/button";
import { LedgerViewModePills, LedgerViewModeToggleButton } from "@/components/ui/LedgerViewModePills";
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
  Search,
  Filter,
  XCircle,
  ArrowLeft,
  MoreVertical,
  Phone,
  MessageSquare,
  Gift,
  FileDigit,
  Columns3,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { DateRange } from "@/components/ui/ad-calendar";
import { addDays, format, startOfDay, endOfDay, isSameDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { isAdminPanelCompanyLocalId } from "@/lib/adminPanelCompany/ledgerMode";
import {
  isSubscriberPartyRow,
  resolveSubscriberPartyDisplayName,
} from "@/lib/adminPanelCompany/subscriberPartyListDisplay";
import { isPackedMyCompanyOnly } from "@/lib/plServerPackedApp";
import {
  isMyCompanyAgentParty,
  isMyCompanySubscriberParty,
  myCompanyDetailsTitle,
} from "@/lib/myCompanyPartyList";
import {
  nestedLedgerChildDialogShell,
  type MasterEditPresentationMode,
} from "@/lib/nestedLedgerMasterEditPresentation";
import {
  mdc,
  mdcMobileTxnBalanceRowData,
  mdcMobileTxnDateRowData,
  mobileTxnScrollBodyClass,
} from "@/lib/mobileDetailChrome";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import * as XLSX from "xlsx";
import { ReportMobileLedgerFooter } from "@/components/reports/ReportMobileLedgerFooter";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
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
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { CreateNoteForm } from "@/components/vouchers/CreateNoteForm";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useFyVoucherScope } from "@/contexts/FyVoucherScopeContext";
import {
  companyUsesFiscalMergeDividers,
  hasFullLocalLedgerVoucherMirror,
} from "@/lib/fyPagination/fiscalMergeFullVoucherScope";
import {
  extractEntityBalanceFromFySnapshot,
  isLedgerDateFilterFromAtFyStart,
} from "@/lib/fyPagination/ledgerOpeningMeta";
import { useAuth } from "@/hooks/useAuth";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { EditPartyDialog } from "@/components/party/EditPartyDialog";
import { useVouchers } from "@/hooks/useVouchers";
import { useMasterEntityLivePatch } from "@/hooks/useMasterEntityLivePatch";
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
import { doc, query, collection, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { batchFetchUserDisplayNamesFromFirestore } from "@/lib/batchFetchUserDisplayNames";
import { firestore } from "@/lib/firebase";
import { applyPaymentBillWiseLinkAllocations } from "@/lib/voucherActionsClient";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { useInterCompanyLedgerChangeDetectDialog } from "@/hooks/useInterCompanyLedgerChangeDetectDialog";
import { AdjustBalancePillLabel } from "@/components/vouchers/AdjustBalancePillLabel";
import { HistoryDialog } from "@/components/vouchers/HistoryDialog";
import { LinkAdvancesToVoucherDialog } from "@/components/vouchers/LinkAdvancesToVoucherDialog";
import { EntityAlarmPopup } from "@/components/messages/EntityAlarmPopup";
import { LinkPaymentToTxnsDialog } from "@/components/vouchers/LinkPaymentToTxnsDialog";
import { MasterAccountFreezeOwnerToggle } from "@/components/masterAccountFreeze/MasterAccountFreezeOwnerToggle";
import { MasterAccountFreezeTxnOverlay } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnOverlay";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import {
  PARTY_FREEZE_COLLECTION,
  partyFreezePatchFromSave,
} from "@/lib/masterAccountFreeze/partyFreezeAdapter";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { useMasterAccountFreezeFeature } from "@/hooks/useMasterAccountFreezeFeature";
import { useLedgerConfirmationSendPill } from "@/hooks/useLedgerConfirmationSendPill";
import { ledgerConfirmationPrintVisibleColumns } from "@/lib/reports/ledgerConfirmationShare";
import {
  BillWiseAutoLinkPromptDialog,
  usePartyBillWiseAutoLinkPrompt,
} from "@/components/vouchers/BillWiseAutoLinkPrompt";
import {
  COLUMN_LABELS,
  useTransactionVisibleColumns,
} from "@/components/vouchers/transactionColumnVisibility";
import { TransactionsTable, type Context, type TransactionColumnKey } from "@/components/vouchers/TransactionsTable";
import { OpeningBalanceLedgerAccountsTable } from "@/components/reports/OpeningBalanceLedgerAccountsTable";
import {
  computeOpeningBalanceLedgerBreakdown,
  type OpeningBalanceLedgerAccountRow,
} from "@/lib/reports/openingBalanceLedgerAccounts";
import { OpeningBalanceMasterEditHost } from "@/components/reports/OpeningBalanceMasterEditHost";
import { getReportVoucherTypeKey, ReportHeaderSummaryCards, reportTdsFilterSide, reportVoucherMatchesSummaryCard, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { TransactionTableSortDropdown, type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT, rowsPerPageSelectValue } from "@/lib/rowsPerPageSelect";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { useStatementLedgerCheckModePaging } from "@/hooks/useStatementLedgerCheckModePaging";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { useLedgerDetailSessionMemory } from "@/hooks/useLedgerDetailSessionMemory";
import {
  ledgerDetailSessionStorageKey,
  readPartyTdsLedgerViewMode,
  writeLedgerDetailSessionSnapshot,
  writePartyTdsLedgerViewMode,
  type LedgerDetailViewMode,
  type PartyTdsLedgerViewMode,
} from "@/lib/ledgerDetailSessionMemory";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerHeaderReminderButton } from "@/components/vouchers/LedgerHeaderReminderButton";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";
import {
  computeAccountConfirmationSummary,
  formatAccountConfirmationFyLabel,
} from "@/lib/reports/accountConfirmationSummary";

import { useShowNotes } from "@/components/vouchers/transactionColumnVisibility";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  stampRunningBalanceFromFullLedger,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import {
  buildTaxNameById,
  expandPartyLedgerTdsRows,
  ledgerTdsFooterColumnMenuKeys,
  mergeLedgerTdsVisibleColumnsWithPrefs,
  sortLedgerTdsRowsForDisplay,
  summarizePartyTdsBalances,
} from "@/lib/partyLedgerTdsView";
import { mergeLedgerUserDisplayNameMaps } from "@/lib/ledgerUserColumnDisplay";
import { formatVoucherEntryTimeLocal } from "@/lib/voucherDateNormalize";
import { useTransactions } from "@/hooks/use-transactions";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import NepaliCalendar from "../ui/nepali-calendar";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import { useEnsureEntityMinTxnsInScope } from "@/hooks/useEnsureEntityMinTxnsInScope";
import { ledgerMasterDateRangeLabel } from "@/lib/ledgerMasterDefaultView";
import type { BSDate } from "@/lib/bs-date";
import { Combobox } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { NotificationBell } from "../vouchers/NotificationBell";
import { ReconciliationAccountButton } from "@/components/reconciliation/ReconciliationAccountButton";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { getLocalAuthUser } from "@/lib/localApiClient";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { MobileLedgerFooterChevronFab } from "@/components/layout/MobileLedgerFooterChevronFab";
import { isLocalOnlyMode } from "@/lib/localMode";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { GroupDetailNestedNameHeader } from "@/components/entity/GroupDetailNestedNameHeader";
import {
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";
// Shared header pill height â€” Party + sab ledger detail/report headers
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
  LEDGER_HEADER_TDS_BALANCE_CARD_CN,
  LEDGER_HEADER_TITLE_CN,
  LEDGER_HEADER_BALANCE_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_DATE_RANGE_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_PILL_ROW_CN,
  LEDGER_TXN_PAGE_ROOT_CN,
} from "@/lib/ledgerHeaderChrome";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
};

const DEFAULT_STATUS_FILTER = { paid: true, unpaid: true, partial: true, overdue: true };
type StatusFilter = { paid: boolean; unpaid: boolean; partial: boolean; overdue: boolean };
const STATUS_FILTER_KEY = "transactionStatusFilter";

function filterByStatus(txns: any[], statusFilter: StatusFilter): any[] {
  const anySelected = statusFilter.paid || statusFilter.unpaid || statusFilter.partial || statusFilter.overdue;
  if (!anySelected) return txns;
  return txns.filter((t) => {
    // Notes have no payment status; always show them regardless of status filter
    if (t.type === "note") return true;
    // Journal/Adjustment/Contra/Inter Company â€” bill-wise status nahi; filter se hide na hon
    if (
      t.type === "journal" ||
      t.type === "adjustment" ||
      t.type === "contra" ||
      t.type === "inter_company"
    )
      return true;
    if (statusFilter.paid && t.paymentStatus === "paid") return true;
    if (statusFilter.unpaid && t.paymentStatus === "unpaid") return true;
    if (statusFilter.partial && t.paymentStatus === "partially_paid") return true;
    if (statusFilter.overdue && t.isOverdue) return true;
    return false;
  });
}

export function PartyDetails({
  party: initialParty,
  allParties,
  transactions: passedTransactions,
  onPartyUpdated,
  onPartyDeleted,
  onShowAll,
  dateRange,
  onDateRangeChange,
  isAllVouchersView,
  journalAccountNames,
  userNames,
  onBack,
  context,
  reportCardFilter,
  reportSummaryCards,
  /** Jab PartyDetails kisi report ke andar ho: dropdown se party badle bina `/party` par na jao */
  onEmbeddedPartyChange,
  /** Reports / dashboard txn-count: PrintÂ·ExcelÂ·Bill wiseÂ·DateÂ·Chart footer (party page Receive/Pay hide). */
  mobileFooterVariant = "ledger",
  mobileReportStickyTitle,
  /** IC / Ac company filter — is peer company ke saare accounts ka merged ledger. */
  icGroupMemberParties,
  icGroupMemberFilterId = null,
  confirmationFyKey,
  confirmationFyRange,
  confirmationAllVouchers,
  ledgerPresentationMode = "default",
  /** Master shell merged header me period label ho to andar wali row mat dikhao (party mobile). */
  hideMobilePeriodLabelRow = false,
}: {
  party: Party & { saleTotal?: number; purchaseTotal?: number };
  allParties?: Party[];
  transactions?: any[];
  onPartyUpdated: (updated?: Partial<Party>) => void;
  onPartyDeleted: (deletedId: string) => void;
  onShowAll?: () => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  isAllVouchersView?: boolean;
  journalAccountNames?: Record<string, string>;
  userNames?: Record<string, string>;
  onBack?: () => void;
  context?: string;
  /** Report details card strip — Sale/Pur TDS + Sales/Purchases filters. */
  reportCardFilter?: string | null;
  reportSummaryCards?: ReportStatementSummaryCardData[];
  onEmbeddedPartyChange?: (partyId: string) => void;
  mobileFooterVariant?: "ledger" | "report";
  icGroupMemberParties?: Party[];
  icGroupMemberFilterId?: string | null;
  mobileReportStickyTitle?: string;
  confirmationFyKey?: string;
  confirmationFyRange?: { start: Date; end: Date };
  confirmationAllVouchers?: any[];
  ledgerPresentationMode?: MasterEditPresentationMode;
  hideMobilePeriodLabelRow?: boolean;
}) {
  const nestedLedgerNoteDialogShell =
    ledgerPresentationMode === "nested-ledger"
      ? nestedLedgerChildDialogShell("h-[95vh] w-full max-w-3xl flex flex-col")
      : { overlayClassName: undefined, className: "h-[95vh] w-full max-w-3xl flex flex-col" };
  const { company, companyId } = useCompany();
  const { balanceMode: balanceModeRaw, setBalanceMode } = useBalanceMode();
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatCurrencyForPrint } =
    useDate();
  const {
    vouchers,
    vouchersAll,
    processedParties,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedExpenseAccounts,
    journalAccountNames: voucherJournalAccountNames,
  } = useVouchers();
  // Auto link must see every DR/CR row of the party, not just the current view filter.
  const vouchersForAutoLink = vouchersAll?.length ? vouchersAll : vouchers;
  const handlePartyUpdated = useMasterEntityLivePatch<Party>({
    collection: "parties",
    entityId: initialParty.id,
    onUpdated: onPartyUpdated,
  });
  const resolvedJournalAccountNames = journalAccountNames ?? voucherJournalAccountNames;
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const [reminderOpen, setReminderOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  useFyLoadOnDateRangeChange(dateRange);
  const fy = useFyVoucherScope();
  const [isDateChange, setIsDateChange] = useState(false);
  const [mobileReportView, setMobileReportView] = useState<"list" | "chart">("list");

  const party = useMemo(() => {
    if (!processedParties || !initialParty) return initialParty;
    return processedParties.find(p => p.id === initialParty.id) || initialParty;
  }, [processedParties, initialParty]);

  /** Mobile AddVoucher â€” inline `{ partyId }` har render = naya object â†’ dialog `initialVoucherData` + sale form date reset; stable deps */
  const addVoucherDefaultPartyOnly = useMemo(() => ({ partyId: party.id }), [party.id]);

  const transactionDates = useMemo(() => {
    const dates = new Set<number>();
    vouchers.forEach((v) => {
      if (v.partyId === party.id || (Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === party.id))) {
          const dateValue = v.date?.toDate ? v.date.toDate() : new Date(v.date);
          if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
              dates.add(startOfDay(dateValue).getTime());
          }
      }
    });
    return Array.from(dates).map((d) => new Date(d));
  }, [vouchers, party.id]);

  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceModeRaw === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && party?.id
        ? ledgerDetailSessionStorageKey(companyId, "party", party.id, ledgerViewMode)
        : null,
    [companyId, party?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [isAllVouchersView]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [openingBalanceEditRow, setOpeningBalanceEditRow] =
    useState<OpeningBalanceLedgerAccountRow | null>(null);
  const [openingBalanceEditOpen, setOpeningBalanceEditOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const { visibleColumns, handleColumnVisibilityChange, ledgerColumnMenuFilter } = useTransactionVisibleColumns();
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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const { handleInterCompanyChangeDetectedClick, interCompanyChangeDetectDialog } =
    useInterCompanyLedgerChangeDetectDialog(() => onPartyUpdated());
  const [historyVoucher, setHistoryVoucher] = useState<any>(null);
  const [linkAdvancesVoucher, setLinkAdvancesVoucher] = useState<any>(null);
  const [linkPaymentVoucher, setLinkPaymentVoucher] = useState<any>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "payment_in" | "payment_out" | "sale">(null);
  const openingModalRef = useRef(false);

  useEffect(() => {
    setTempDateRange(dateRange);
  }, [dateRange]);
  
  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const anyMobilePopupOpen = isMobile && (
    !!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen || isNoteOpen || !!historyVoucher || !!linkAdvancesVoucher || !!linkPaymentVoucher
  );

  const openModalInUrl = useCallback(() => {
    if (!isMobile || !pathname) return;
    // APK: modal khulte waqt merged query session me â€” approve ke baad hook/location empty ho to bhi `selected` restore
    persistPlModalParentQuery(searchParams.toString());
    const params = new URLSearchParams(searchParamsStringForModalClose(searchParams.toString()));
    params.set("modal", "1");
    router.push(`${pathname}?${params.toString()}`);
  }, [isMobile, pathname, searchParams, router]);

  const closeModalInUrl = useCallback(() => {
    if (!pathname) return;
    // APK: approve ke baad stale `searchParams` + backup se `?selected=` mat hatao
    const raw = searchParamsStringAfterClosingModal(searchParams.toString());
    const params = new URLSearchParams(raw);
    params.delete("modal");
    // Party ledger: merge fail hone par bhi isi party pe rehe â€” `/party` bare list pe jump na ho
    patchMasterDetailUrlAfterModalClose(params, { entityId: party.id });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, party.id]);

  const modalParam = searchParams.get("modal");
  const urlModalOpen = isMobile && modalParam === "1" && anyMobilePopupOpen;
  const closeUrlModal = useCallback(() => {
    setMobileFooterDialogOpen(null);
    setIsCalendarOpen(false);
    setIsVoucherDialogOpen(false);
    setSelectedVoucher(null);
    setIsNoteOpen(false);
    setHistoryVoucher(null);
    setLinkAdvancesVoucher(null);
    setLinkPaymentVoucher(null);
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

  const handleShowNarrationChange = (checked: boolean) => {
    setShowNarration(checked);
    sessionStorage.setItem("showNarration", String(checked));
  };

  const { showNotes, setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();

  const handleStatusFilterChange = (key: keyof StatusFilter, checked: boolean) => {
    const next = { ...statusFilter, [key]: checked };
    setStatusFilter(next);
    sessionStorage.setItem(STATUS_FILTER_KEY, JSON.stringify(next));
    setCurrentPage(1);
  };
  
  // Maintain local userNames state that merges with prop
  const [localFetchedUserNames, setLocalFetchedUserNames] = useState<Record<string, string>>({});
  const { user, customUser } = useAuth();
  const isLocalMode = isLocalOnlyMode();
  const isCompanyAdmin = React.useMemo(() => {
    const role = String(customUser?.role || "").trim();
    if (role === "CompanyAdmin" || role === "SuperAdmin" || role === "owner") return true;
    if (!company || !user) return false;
    if (company.ownerId && user.uid && company.ownerId === user.uid) return true;
    const ownerEmail = String((company as any).ownerEmail || "").trim().toLowerCase();
    const email = String(user.email || "").trim().toLowerCase();
    return !!ownerEmail && !!email && ownerEmail === email;
  }, [customUser?.role, company, user]);

  // Always seed current user's display name so own transactions never fall back to raw UID.
  useEffect(() => {
    if (!user?.uid) return;
    const me = customUser?.displayName || user.displayName || user.email || "";
    if (!me) return;
    setLocalFetchedUserNames((prev) => (prev[user.uid] === me ? prev : { ...prev, [user.uid]: me }));
  }, [user?.uid, user?.displayName, user?.email, customUser?.displayName]);

  useEffect(() => {
    if (!isLocalMode || !companyId) return;
    const localUser = getLocalAuthUser(companyId);
    const localDisplayName = (
      localUser?.displayName ||
      localUser?.username ||
      ((company as any)?.adminUsername as string) ||
      "Admin"
    ).trim();
    if (!localDisplayName) return;
    setLocalFetchedUserNames((prev) => {
      // Keep a stable local-id map so transaction rows resolve local actor names.
      const next = { ...prev };
      next["local"] = localDisplayName;
      next["local_guest_user"] = localDisplayName;
      if (localUser?.id) next[String(localUser.id)] = localDisplayName;
      if (localUser?.username) next[String(localUser.username)] = localDisplayName;
      return next;
    });
  }, [isLocalMode, companyId, company]);
  
  // Merge: voucher-sourced naam (e.g. recurring "Auto") ko local Firestore fetch se upar â€” `{...prop,...local}` se overwrite ho raha tha
  const mergedUserNames = useMemo(() => mergeLedgerUserDisplayNameMaps(userNames || {}, localFetchedUserNames), [userNames, localFetchedUserNames]);

  const mobileSearchNames = useMemo(
    () => ({ ...resolvedJournalAccountNames, ...mergedUserNames }),
    [resolvedJournalAccountNames, mergedUserNames]
  );

  const isIcCompanyGroupView = Boolean(icGroupMemberParties && icGroupMemberParties.length > 0);

  const icGroupFilteredMember = useMemo(() => {
    if (!isIcCompanyGroupView || !icGroupMemberParties || !icGroupMemberFilterId) return null;
    return icGroupMemberParties.find((row) => row.id === icGroupMemberFilterId) ?? null;
  }, [isIcCompanyGroupView, icGroupMemberParties, icGroupMemberFilterId]);

  const headerIdentityParty = icGroupFilteredMember ?? party;

  const icPeerCompanyPrimaryName = useMemo(() => {
    if (!isIcCompanyGroupView) return null;
    return icPeerCompanyGroupListTitleLines(party).primary;
  }, [isIcCompanyGroupView, party]);

  const icMemberDisplayName = useMemo(() => {
    if (!icGroupFilteredMember) return null;
    return interCompanyClearingAccountDisplayName(icGroupFilteredMember);
  }, [icGroupFilteredMember]);

  const packedMyCompanyDetails =
    isPackedMyCompanyOnly() &&
    (isMyCompanySubscriberParty(party) || isMyCompanyAgentParty(party));
  const headerDisplayTitle =
    icMemberDisplayName ??
    (packedMyCompanyDetails
      ? myCompanyDetailsTitle(party)
      : isAdminPanelCompanyLocalId(companyId) && isSubscriberPartyRow(party)
        ? resolveSubscriberPartyDisplayName(party)
        : party.name);
  const headerDisplayEmail =
    packedMyCompanyDetails
      ? String(party.email ?? "").trim() || null
      : isAdminPanelCompanyLocalId(companyId) && isSubscriberPartyRow(party)
        ? String(party.email ?? "").trim() || null
        : null;

  const adminSubscriberPartyLedger =
    isAdminPanelCompanyLocalId(companyId) && isSubscriberPartyRow(party);

  const canShowAdjustBalance =
    party.id !== "all" && !(party as any).isSystemAccount;

  const buildStatementPdfRef = useRef<(() => Promise<Blob | null>) | null>(null);

  const confirmationSendPill = useLedgerConfirmationSendPill({
    entity: headerIdentityParty,
    collection: "parties",
    eligible:
      canShowAdjustBalance && (!isIcCompanyGroupView || Boolean(icGroupFilteredMember)),
    onEntityUpdated: handlePartyUpdated,
    buildStatementPdfBlob: useCallback(async () => {
      if (!buildStatementPdfRef.current) return null;
      return buildStatementPdfRef.current();
    }, []),
  });

  const { enabled: freezeFeatureEnabled } = useMasterAccountFreezeFeature();
  const [partyBannerToggleFits, setPartyBannerToggleFits] = useState(true);

  const showAccountFreezeChrome =
    party.id !== "all" &&
    !(party as any).isSystemAccount &&
    (!isIcCompanyGroupView || !!icGroupFilteredMember) &&
    (freezeFeatureEnabled || readMasterAccountFrozen(party));

  const isPartyFrozen = showAccountFreezeChrome && readMasterAccountFrozen(party);
  const blockPartyNewTransactions = isPartyFrozen;

  const handleFreezeSaved = useCallback(
    (patch: { isFrozen: boolean; freezeMessage?: string | null }) => {
      handlePartyUpdated(partyFreezePatchFromSave(patch));
    },
    [handlePartyUpdated]
  );

  const adjustBalanceTarget = icGroupFilteredMember
    ? {
        id: icGroupFilteredMember.id,
        entityType: "party" as const,
        name: interCompanyClearingAccountDisplayName(icGroupFilteredMember),
      }
    : !isIcCompanyGroupView
      ? {
          id: headerIdentityParty.id,
          entityType: "party" as const,
          name: party.name,
        }
      : undefined;

  const partyFreezeToggle = useMemo(() => {
    if (!showAccountFreezeChrome || !companyId || !freezeFeatureEnabled) return null;
    return (
      <MasterAccountFreezeOwnerToggle
        companyId={companyId}
        collection={PARTY_FREEZE_COLLECTION}
        entityId={headerIdentityParty.id}
        isFrozen={isPartyFrozen}
        onSaved={handleFreezeSaved}
      />
    );
  }, [
    showAccountFreezeChrome,
    companyId,
    freezeFeatureEnabled,
    headerIdentityParty.id,
    isPartyFrozen,
    handleFreezeSaved,
  ]);

  const partyClosingBalanceRowActions = useMemo(
    () =>
      canShowAdjustBalance ? (
        <AddVoucherDialog
          defaultTab="adjustment"
          allowedTabs={["adjustment"]}
          defaultVoucherData={{
            defaultTab: "adjustment",
            ...(adjustBalanceTarget ? { adjustmentTarget: adjustBalanceTarget } : {}),
          }}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={blockPartyNewTransactions}
            className={cn(LEDGER_HEADER_PILL_CN, "!h-[27px] min-h-[27px] text-xs")}
            title="Adjust Balance"
          >
            <AdjustBalancePillLabel />
          </Button>
        </AddVoucherDialog>
      ) : null,
    [canShowAdjustBalance, adjustBalanceTarget, blockPartyNewTransactions]
  );

  const partyClosingBalanceActions = useMemo(() => {
    if (!isPartyFrozen && !partyFreezeToggle && !confirmationSendPill) return null;
    if (isPartyFrozen) {
      const footerToggle = isMobile && !partyBannerToggleFits ? partyFreezeToggle : null;
      return (
        <div className="flex flex-wrap items-center gap-2">
          {footerToggle}
          {confirmationSendPill}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        {partyFreezeToggle}
        {confirmationSendPill}
      </div>
    );
  }, [
    confirmationSendPill,
    isPartyFrozen,
    isMobile,
    partyBannerToggleFits,
    partyFreezeToggle,
  ]);

  const partyFreezeOverlay = useMemo(() => {
    if (!showAccountFreezeChrome || !companyId || !isPartyFrozen) return null;
    return (
      <MasterAccountFreezeTxnOverlay
        companyId={companyId}
        collection={PARTY_FREEZE_COLLECTION}
        entityId={headerIdentityParty.id}
        isFrozen={isPartyFrozen}
        freezeMessage={party.freezeMessage}
        bannerTopActions={partyFreezeToggle}
        onBannerToggleFitsChange={setPartyBannerToggleFits}
        onSaved={(patch) =>
          handlePartyUpdated(partyFreezePatchFromSave({ isFrozen: true, ...patch }))
        }
      />
    );
  }, [
    showAccountFreezeChrome,
    companyId,
    isPartyFrozen,
    headerIdentityParty.id,
    party.freezeMessage,
    partyFreezeToggle,
    handlePartyUpdated,
  ]);

  /** Header avatar hover — child IC account select par uska photo/initials */
  const partyHeaderAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(headerIdentityParty.fileUrl),
    [headerIdentityParty.fileUrl, headerIdentityParty.id]
  );

  const icGroupTransactionEntity = useMemo(() => {
    if (icGroupFilteredMember) return null;
    if (!isIcCompanyGroupView || !icGroupMemberParties) return null;
    const openingBalance = icGroupMemberParties.reduce(
      (sum, row) => sum + (Number(row.openingBalance) || 0),
      0
    );
    return {
      ...party,
      items: icGroupMemberParties,
      openingBalance,
    };
  }, [isIcCompanyGroupView, icGroupMemberParties, party, icGroupFilteredMember]);

  const transactionEntity = icGroupFilteredMember ?? icGroupTransactionEntity ?? party;
  const transactionContext: Context = icGroupFilteredMember
    ? "party"
    : icGroupTransactionEntity
      ? "group"
      : "party";
  const ledgerContextId = String(transactionEntity.id || party.id);

  const isOpeningBalanceLedger = party.id === "opening_balance_ledger";

  const openingBalanceLedgerBreakdown = useMemo(
    () =>
      isOpeningBalanceLedger
        ? computeOpeningBalanceLedgerBreakdown({
            processedParties,
            processedStaff,
            processedAccounts,
            processedTaxes,
            processedExpenseAccounts,
          })
        : null,
    [
      isOpeningBalanceLedger,
      processedParties,
      processedStaff,
      processedAccounts,
      processedTaxes,
      processedExpenseAccounts,
    ]
  );
  
  const {
    processedTransactions,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    openingBalanceOutstanding,
    openingBalanceLinkedVoucherNos,
    periodOpeningUnavailable,
    periodOpeningLoading,
  } = useTransactions(
    transactionEntity,
    transactionContext,
    dateRange,
    undefined,
    allParties,
    passedTransactions,
    context,
    filters,
    undefined,
    resolvedJournalAccountNames,
    mergedUserNames
  );

  // View/period brought-forward can be 0 (date range) while books still have an opening; running balance must
  // start from the same value as the opening row (see TransactionsTable booksOpeningBalance).
  const fyStartDateFilterActive = useMemo(
    () => isLedgerDateFilterFromAtFyStart(company?.country, dateRange),
    [company?.country, dateRange]
  );
  const fySnapshotPartyOpening = useMemo(
    () => extractEntityBalanceFromFySnapshot(fy.openingBalances, ledgerContextId),
    [fy.openingBalances, ledgerContextId]
  );
  const useSqliteBooksRunningBalance = useMemo(
    () =>
      companyUsesFiscalMergeDividers(company) ||
      hasFullLocalLedgerVoucherMirror(company, fy.activeScope),
    [company, fy.activeScope]
  );
  const ledgerOpeningForRunning = useMemo(() => {
    if (periodOpeningUnavailable || periodOpeningLoading) return openingBalanceForPeriod;
    if (fyStartDateFilterActive && !useSqliteBooksRunningBalance) {
      if (fySnapshotPartyOpening != null && Number.isFinite(fySnapshotPartyOpening)) {
        return fySnapshotPartyOpening;
      }
      return openingBalanceForPeriod;
    }
    const master = Number(transactionEntity?.openingBalance ?? party?.openingBalance) || 0;
    if (Math.abs(openingBalanceForPeriod) < 1e-6 && Math.abs(master) > 1e-6) return master;
    return openingBalanceForPeriod;
  }, [
    periodOpeningUnavailable,
    periodOpeningLoading,
    fyStartDateFilterActive,
    useSqliteBooksRunningBalance,
    fySnapshotPartyOpening,
    openingBalanceForPeriod,
    transactionEntity?.openingBalance,
    party?.openingBalance,
  ]);

  const masterPartyOpeningForAutoLink =
    Number(transactionEntity?.openingBalance ?? party?.openingBalance) || 0;
  const autoLinkPrompt = usePartyBillWiseAutoLinkPrompt({
    enabled: isCompanyAdmin && !!party?.id && party.id !== "all" && !(party as any).isSystemAccount,
    companyId,
    userId: user?.uid || (isLocalMode && companyId ? "local" : null),
    ledgerId: party?.id,
    ledgerName: party?.name,
    ledgerKind: "party",
    vouchers: vouchersForAutoLink,
    ledgerOpeningBalance: masterPartyOpeningForAutoLink,
    openingBalanceOutstanding:
      balanceModeRaw === "bill_wise" ? openingBalanceOutstanding : undefined,
  });
  const openBillWiseAutoLink = React.useCallback(() => {
    if (autoLinkPrompt.proposal) {
      autoLinkPrompt.setOpen(true);
      return;
    }
    toast.info("No eligible unlinked bill-wise payment found for this ledger.");
  }, [autoLinkPrompt.proposal, autoLinkPrompt.setOpen]);

  
  // Fetch missing user names directly from Firestore and store in local state
  useEffect(() => {
    if (!processedTransactions || processedTransactions.length === 0) return;
    if (isLocalMode) return;
    
    const uids = new Set(processedTransactions.map((t: any) => t.userId).filter(Boolean) as string[]);
    
    // Fetch missing user names - check both prop and local state
    const missingUids = Array.from(uids).filter(uid => {
      const propName = userNames?.[uid];
      const localName = localFetchedUserNames[uid];
      return (!propName || propName === "Unknown" || propName === "N/A") && 
             (!localName || localName === "Unknown" || localName === "N/A");
    });
    
    if (missingUids.length === 0) return;

    let cancelled = false;
    void batchFetchUserDisplayNamesFromFirestore(missingUids, () => cancelled).then((fetched) => {
      if (cancelled || Object.keys(fetched).length === 0) return;
      setLocalFetchedUserNames((prev) => ({ ...prev, ...fetched }));
    });
    return () => {
      cancelled = true;
    };
  }, [processedTransactions, userNames, localFetchedUserNames, isLocalMode]);

  const handleEditVoucher = (voucher: any) => {
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
  };

  const handleHistoryVoucher = (voucher: any) => {
    openingModalRef.current = true;
    openModalInUrl();
    setHistoryVoucher(voucher);
  };

  const handleDeleteVoucher = (voucher: any) => {
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
  };

  const handleAddLink = (voucher: any) => {
    openingModalRef.current = true;
    openModalInUrl();
    const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
    if (isPaymentType) {
      setLinkPaymentVoucher(voucher);
    } else {
      setLinkAdvancesVoucher(voucher);
    }
  };

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
  
  // PC: preference; mobile: hamesha notes (includeNotesInTable)
  const displayTransactions = useMemo(
    () => {
      const base = includeNotesInTable ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note");
      if (context !== "report" || !reportCardFilter || reportTdsFilterSide(reportCardFilter)) return base;
      return base.filter((t: any) =>
        reportCardFilter.startsWith("summary:")
          ? reportVoucherMatchesSummaryCard(t, reportCardFilter.slice(8), "party", party.id)
          : getReportVoucherTypeKey(t, "party", party.id) === reportCardFilter
      );
    },
    [processedTransactions, includeNotesInTable, context, reportCardFilter, party.id]
  );
  const statusFilteredTransactions = useMemo(
    () => filterByStatus(displayTransactions, statusFilter),
    [displayTransactions, statusFilter]
  );

  const [tdsLedgerViewMode, setTdsLedgerViewMode] = useState<PartyTdsLedgerViewMode>(() => {
    if (context === "report") {
      return reportTdsFilterSide(reportCardFilter) ?? "account";
    }
    return companyId && party?.id ? readPartyTdsLedgerViewMode(companyId, party.id) : "account";
  });
  const tdsLedgerOnly = tdsLedgerViewMode !== "account";
  const reportTypeFilterActive = context === "report" && !!reportCardFilter && !tdsLedgerOnly;
  /** Party TDS balance page never offers bill-wise: force statement. */
  const balanceMode: typeof balanceModeRaw = tdsLedgerOnly ? "statement" : balanceModeRaw;
  /** Party TDS details: show entity-wise linked settlement payments/journals. */
  const [showTdsLinkedTrxn, setShowTdsLinkedTrxn] = useState(true);
  const taxNameById = useMemo(() => buildTaxNameById(processedTaxes), [processedTaxes]);
  const vouchersByIdForTds = useMemo(() => {
    const src = vouchersAll?.length ? vouchersAll : vouchers;
    return new Map(
      src.map((v: { id?: string }) => [String(v.id ?? ""), v as Record<string, unknown>])
    );
  }, [vouchers, vouchersAll]);
  const ledgerTableSourceTransactions = useMemo(() => {
    if (!tdsLedgerOnly) return statusFilteredTransactions;
    const rows = expandPartyLedgerTdsRows(statusFilteredTransactions, taxNameById, {
      partyId: party.id,
      voucherById: vouchersByIdForTds,
      includeSettlements: showTdsLinkedTrxn,
    });
    if (tdsLedgerViewMode === "sale" || tdsLedgerViewMode === "purchase") {
      return rows.filter(
        (r) => String((r as { _ledgerTdsSide?: unknown })._ledgerTdsSide ?? "").toLowerCase() === tdsLedgerViewMode
      );
    }
    return rows;
  }, [
    statusFilteredTransactions,
    tdsLedgerOnly,
    tdsLedgerViewMode,
    taxNameById,
    party.id,
    vouchersByIdForTds,
    showTdsLinkedTrxn,
  ]);
  const mobileUnapprovedTxnCount = useMemo(
    () => countLedgerUnapprovedTransactions(ledgerTableSourceTransactions),
    [ledgerTableSourceTransactions]
  );

  const effectiveVisibleColumns = useMemo(() => {
    if (tdsLedgerOnly) {
      return mergeLedgerTdsVisibleColumnsWithPrefs(visibleColumns, balanceMode === "bill_wise");
    }
    const base =
      balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns;
    return { ...base, tdsTaxable: false, tdsAmount: false };
  }, [tdsLedgerOnly, balanceMode, visibleColumns]);

  const setPartyTdsLedgerView = useCallback(
    (mode: PartyTdsLedgerViewMode) => {
      setTdsLedgerViewMode(mode);
      if (companyId && party?.id) writePartyTdsLedgerViewMode(companyId, party.id, mode);
      setCurrentPage(1);
    },
    [companyId, party?.id, setCurrentPage]
  );
  const [tdsCardsOpen, setTdsCardsOpen] = useState(false);
  const [tdsCardsOpenM, setTdsCardsOpenM] = useState(false);
  const [showAllTds, setShowAllTds] = useShowAllTdsCards();
  const openPartyLedgerDetails = useCallback(() => {
    setPartyTdsLedgerView("account");
  }, [setPartyTdsLedgerView]);
  const openSaleTdsLedgerDetails = useCallback(() => {
    setPartyTdsLedgerView("sale");
  }, [setPartyTdsLedgerView]);
  const openPurTdsLedgerDetails = useCallback(() => {
    setPartyTdsLedgerView("purchase");
  }, [setPartyTdsLedgerView]);
  const tdsClosingBalanceLabel =
    tdsLedgerViewMode === "sale"
      ? "Sale TDS Closing Balance"
      : tdsLedgerViewMode === "purchase"
        ? "Pur TDS Closing Balance"
        : tdsLedgerOnly
          ? "TDS Closing Balance"
          : undefined;

  const partyTdsBalanceSummary = useMemo(
    () =>
      summarizePartyTdsBalances(statusFilteredTransactions as Record<string, unknown>[], taxNameById, {
        partyId: party.id,
        voucherById: vouchersByIdForTds,
      }),
    [statusFilteredTransactions, taxNameById, party.id, vouchersByIdForTds]
  );
  const partyTdsHasSale = partyTdsBalanceSummary.saleTds > 0;
  const partyTdsHasPur = partyTdsBalanceSummary.purchaseTds > 0;
  useEffect(() => {
    if (context === "report") {
      setTdsLedgerViewMode(reportTdsFilterSide(reportCardFilter) ?? "account");
      setShowTdsLinkedTrxn(true);
      return;
    }
    setTdsLedgerViewMode(
      companyId && party.id ? readPartyTdsLedgerViewMode(companyId, party.id) : "account"
    );
    setShowTdsLinkedTrxn(true);
  }, [companyId, party.id, context, reportCardFilter]);

  // Sort state: footer dropdown â€” sirf current page par apply (paging hook); list chronological rahe
  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const sortedTransactions = useMemo(() => {
    const base = filterByUnapprovedOnly(ledgerTableSourceTransactions);
    if (tdsLedgerOnly) {
      return sortLedgerTdsRowsForDisplay(base, sortBy, sortOrder);
    }
    const sorted = sortTransactionsWithFiscalMergeForCompany(
      base,
      "date",
      DEFAULT_TRANSACTION_SORT_ORDER,
      undefined,
      company
    );
    if (useSqliteBooksRunningBalance) {
      return stampRunningBalanceFromFullLedger(sorted, processedTransactions);
    }
    return recomputeRunningBalanceTopToBottom(sorted, ledgerOpeningForRunning);
  }, [
    ledgerTableSourceTransactions,
    tdsLedgerOnly,
    sortBy,
    sortOrder,
    filterByUnapprovedOnly,
    ledgerOpeningForRunning,
    company,
    useSqliteBooksRunningBalance,
    processedTransactions,
  ]);

  const searchFilteredTransactions = useMemo(() => {
    if (!mobileSearchTerm.trim()) return sortedTransactions;
    const q = mobileSearchTerm.toLowerCase().trim();
    return sortedTransactions.filter((t) => {
      const d = t.date?.toDate ? t.date.toDate() : t.date ? new Date(t.date) : null;
      const dateStr = d ? (dateSystem === "BS" ? formatDateBS(d) : format(d, "yyyy-MM-dd")) : "";
      const timeStr = formatVoucherEntryTimeLocal(t as Record<string, unknown>) || (d ? format(d, "h:mm a") : "");
      const amt = t.debit > 0 ? t.debit : t.credit;
      const bal = t.balance ?? t.runningBalance ?? 0;
      const userStr = (mergedUserNames && t.userId && mergedUserNames[t.userId]) || "";
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "party", party.id).includes(q) ||
        dateStr.toLowerCase().includes(q) ||
        timeStr.toLowerCase().includes(q) ||
        String(amt || 0).toLowerCase().includes(q) ||
        String(t.debit || 0).toLowerCase().includes(q) ||
        String(t.credit || 0).toLowerCase().includes(q) ||
        String(bal).toLowerCase().includes(q) ||
        userStr.toLowerCase().includes(q)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, dateSystem, formatDateBS, format, mergedUserNames, mobileSearchNames, party.id]);

  useEnsureEntityMinTxnsInScope({
    dateRange,
    entityId: party?.id,
    entityKind: "party",
    entityTxnCount: searchFilteredTransactions.length,
    enabled: Boolean(party?.id && party.id !== "all"),
  });

  /** TDS details: running balance starts at 0 (only TDS Dr/Cr), not party books opening. */
  const tdsLedgerOpeningForRunning = 0;
  const ledgerOpeningForPaging = tdsLedgerOnly ? tdsLedgerOpeningForRunning : ledgerOpeningForRunning;

  // Statement check mode + tail paging (PC footer Check mode + hidden-row totals)
  const {
    statementCheck,
    ledgerListForPaging,
    ledgerClosingAfterHidden,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: transactionContext,
    contextId: ledgerContextId,
    viewMode: balanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning: ledgerOpeningForPaging,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  /** Footer Closing Balance: TDS details → TDS net; else party account closing. */
  const ledgerFooterClosingBalance = useMemo(() => {
    if (tdsLedgerOnly) {
      if (ledgerClosingAfterHidden != null) return ledgerClosingAfterHidden;
      return desktopPaginationMeta.closingForPage;
    }
    if (ledgerClosingAfterHidden != null) return ledgerClosingAfterHidden;
    if (!dateRange?.from && !dateRange?.to && currentPage === 1) {
      return closingBalance;
    }
    return desktopPaginationMeta.closingForPage;
  }, [
    tdsLedgerOnly,
    ledgerClosingAfterHidden,
    dateRange?.from,
    dateRange?.to,
    currentPage,
    closingBalance,
    desktopPaginationMeta.closingForPage,
  ]);

  /**
   * Top BALANCE card — always party account closing (never TDS row running balance).
   * TDS Balance card uses `partyTdsBalanceSummary` separately.
   */
  const headerClosingBalanceRaw = useMemo(() => {
    if (isOpeningBalanceLedger && openingBalanceLedgerBreakdown) {
      return -openingBalanceLedgerBreakdown.masterTotals.netSigned;
    }
    if (
      !dateRange?.from &&
      !dateRange?.to &&
      typeof closingBalance === "number" &&
      Number.isFinite(closingBalance)
    ) {
      return closingBalance;
    }
    // Date-filtered party closing: use party txn list (not TDS-expanded rows).
    if (!tdsLedgerOnly && ledgerClosingAfterHidden != null) {
      return ledgerClosingAfterHidden;
    }
    const partyList = (
      tdsLedgerOnly
        ? filterByUnapprovedOnly(statusFilteredTransactions)
        : (searchFilteredTransactions as any[])
    ) as any[];
    if (!tdsLedgerOnly && partyList.length > 0) {
      const last = partyList[partyList.length - 1];
      const bal = last?.balance ?? last?.runningBalance;
      if (typeof bal === "number" && Number.isFinite(bal)) return bal;
    }
    return ledgerOpeningForRunning + (Number(periodDr) || 0) - (Number(periodCr) || 0);
  }, [
    isOpeningBalanceLedger,
    openingBalanceLedgerBreakdown,
    dateRange?.from,
    dateRange?.to,
    closingBalance,
    tdsLedgerOnly,
    ledgerClosingAfterHidden,
    filterByUnapprovedOnly,
    statusFilteredTransactions,
    searchFilteredTransactions,
    ledgerOpeningForRunning,
    periodDr,
    periodCr,
  ]);
  /** Column header filters (Debit/Credit/etc.) must not change the Account Balance card: keep last unfiltered value. */
  const headerBalanceUnfilteredRef = useRef<{ key: string; value: number } | null>(null);
  const headerBalanceHasColFilter = Object.values(filters).some((v) => v && v !== "all");
  const headerBalanceKey = `${dateRange?.from?.getTime?.() ?? ""}|${dateRange?.to?.getTime?.() ?? ""}`;
  if (!headerBalanceHasColFilter) headerBalanceUnfilteredRef.current = { key: headerBalanceKey, value: headerClosingBalanceRaw };
  const headerClosingBalance =
    headerBalanceHasColFilter && headerBalanceUnfilteredRef.current?.key === headerBalanceKey
      ? headerBalanceUnfilteredRef.current.value
      : headerClosingBalanceRaw;

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "party",
    contextId: party?.id,
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

  /** Tail window: `before` = purane txn (kam index) abhi slice me nahi; `after` = naye (zyada index) hidden â€” MobileTransactionsPager ke count */
  const mobilePagerEdgeCounts = useMemo(() => {
    const total = searchFilteredTransactions.length;
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return { before: start, after: Math.max(0, total - end) };
  }, [searchFilteredTransactions.length, currentPage, rowsPerPage]);

  /** Book OB row: sirf jab slice me list[0] shamil ho (chronological shuru); Dated OB = slice se turant pehle txn ki date. */
  const ledgerOpeningPeriodStartDate = useMemo(() => {
    const list = searchFilteredTransactions as any[];
    const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);
    const start = desktopPaginationMeta.sliceStart;
    if (rowsPerPage <= 0) {
      if (hasLedgerDateFilter) return dateRange?.from;
      return undefined;
    }
    if (start === 0) {
      if (hasLedgerDateFilter) return dateRange?.from;
      return undefined;
    }
    const t = list[start - 1] as any;
    if (!t) return undefined;
    const raw = t.date?.toDate ? t.date.toDate() : t.date ? new Date(t.date) : undefined;
    return raw instanceof Date && !isNaN(raw.getTime()) ? raw : undefined;
  }, [searchFilteredTransactions, rowsPerPage, desktopPaginationMeta.sliceStart, dateRange?.from, dateRange?.to]);

  // Party dropdown: hide Owners Capital and Opening Balance (keep current party so selection shows)
  const partyDropdownOptions = useMemo(() => {
    const normalized = (name: string) =>
      (name || "").trim().toLowerCase().replace(/'/g, "");
    const excludeNames = ["owners capital", "opening balance"];
    return (allParties || []).filter((p) => {
      if (p.id === party?.id) return true;
      const n = normalized(p.name || "");
      return !excludeNames.includes(n) && !(n.includes("owner") && n.includes("capital"));
    }).map((p) => ({ value: p.id, label: p.name }));
  }, [allParties, party?.id]);

  // Keep page in valid range when list size/page-size changes.
  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [dateRange, totalPages]);

  const buildDateRangeText = () => {
    if (!company) return;
    const from = dateRange?.from;
    const to = dateRange?.to;
    let dateRangeText = "All Time";
    if(from) {
        const fromBS = formatDateBS(from);
        const toBS = to ? formatDateBS(to) : fromBS;
        const fromAD = formatDate(from);
        const toAD = to ? formatDate(to) : fromAD;
        
        if (dateSystem === 'AD') dateRangeText = `AD: ${fromAD} to ${toAD}`;
        else if (dateSystem === 'BS') dateRangeText = `BS: ${fromBS} to ${toBS}`;
        else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    return dateRangeText;
  };

  const confirmationStatementTransactions = useMemo(() => {
    const source = passedTransactions ?? vouchersAll.filter((v: any) =>
      v.partyId === party.id ||
      (Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === party.id))
    );
    if (!confirmationFyRange) return source;
    return source.filter((v: any) => {
      const raw = v?.date;
      const value = raw?.toDate ? raw.toDate() : raw;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) || (date >= confirmationFyRange.start && date <= confirmationFyRange.end);
    });
  }, [passedTransactions, vouchersAll, party.id, confirmationFyRange]);

  const getPrintTitle = (variant: "statement" | "bill_wise") => {
    let title = `Party Statement: ${party.name}`;
    if (context === 'sale') {
      title = `Sale Statement / ${party.name}`;
    } else if (context === 'purchase') {
      title = `Purchase Statement / ${party.name}`;
    } else if (context === 'payment-in') {
      title = `Receipt Statement / ${party.name}`;
    } else if (context === 'payment-out') {
      title = `Payment Statement / ${party.name}`;
    }
    return variant === "bill_wise" ? `Bill Wise ${title}` : title;
  };

  const printTransactions = (variant: "statement" | "bill_wise") => {
    if (!company) return Promise.resolve();
    const dateRangeText = buildDateRangeText();
    // Match printed columns and note visibility with current table controls.
    const printVisibleColumns = variant === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns;
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
            ...companyFiscalFieldsForPrint(company as Record<string, unknown>),
          },
          title: getPrintTitle(variant),
          context: "party",
          contextId: party.id,
          printConfirmationTabs: context === "report",
          ...(context === "report" && confirmationFyKey && confirmationFyRange
            ? {
                confirmationSummary: computeAccountConfirmationSummary(
                  party,
                  "party",
                  confirmationAllVouchers ?? vouchersAll ?? vouchers,
                  confirmationFyRange.start,
                  confirmationFyRange.end
                ),
                confirmationFyLabel: formatAccountConfirmationFyLabel(confirmationFyKey),
                confirmationFyRangeLabel:
                  dateSystem === "AD"
                    ? `${formatDate(confirmationFyRange.start)} to ${formatDate(confirmationFyRange.end)}`
                    : dateSystem === "BS"
                      ? `${formatDateBS(confirmationFyRange.start)} to ${formatDateBS(confirmationFyRange.end)}`
                      : `AD: ${formatDate(confirmationFyRange.start)} to ${formatDate(confirmationFyRange.end)} (BS: ${formatDateBS(confirmationFyRange.start)} to ${formatDateBS(confirmationFyRange.end)})`,
                confirmationRecipientName: party.name,
                confirmationRecipientPan: party.pan,
                confirmationRecipientAddress: party.address,
                confirmationLetterDate:
                  dateSystem === "AD"
                    ? formatDate(new Date())
                    : dateSystem === "BS"
                      ? formatDateBS(new Date())
                      : `AD: ${formatDate(new Date())} (BS: ${formatDateBS(new Date())})`,
                statementAllTransactions: confirmationStatementTransactions.map((t: any) => ({ ...t, dueDate: t.dueDate ?? t.due_date })),
              }
            : {}),
          dateSystem: dateSystem,
          dateRangeText: dateRangeText || "All Time",
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (party as any).openingBalanceDate,
          openingBalanceNarration: party.openingBalanceNarration ?? null,
          transactions: paginatedTransactions.map((t: any) => ({ ...t, dueDate: t.dueDate ?? t.due_date })),
          showNarration: showNarration,
          includeNotes: showNotes,
          visibleColumns: printVisibleColumns,
          userNames: mergedUserNames,
          journalAccountNames: resolvedJournalAccountNames,
          billWise: variant === "bill_wise",
          ...(variant === "bill_wise" && { openingBalanceOutstanding, openingBalanceLinkedVoucherNos, vouchers }),
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: Number(party.openingBalance) || 0,
          ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0,
          ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
          openingBalancePeriodStartDate: ledgerOpeningPeriodStartDate,
          masterOpeningBalanceDate: (party as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  const buildStatementPdfBlob = useCallback(async () => {
    if (!company) return null;
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
          ...companyFiscalFieldsForPrint(company as Record<string, unknown>),
        },
        title: getPrintTitle("statement"),
        context: "party",
        contextId: party.id,
        dateSystem: dateSystem,
        dateRangeText: buildDateRangeText() || "All Time",
        vouchersCount: paginatedTransactions.length,
        openingBalance: desktopPaginationMeta.openingForPage,
        openingBalanceDate: (party as any).openingBalanceDate,
        openingBalanceNarration: party.openingBalanceNarration ?? null,
        transactions: paginatedTransactions.map((t: any) => ({ ...t, dueDate: t.dueDate ?? t.due_date })),
        showNarration: showNarration,
        includeNotes: showNotes,
        visibleColumns: printVisibleColumns,
        userNames: mergedUserNames,
        journalAccountNames: resolvedJournalAccountNames,
        billWise: false,
      },
      {
        paginatedTransactions,
        openingForPage: desktopPaginationMeta.openingForPage,
        periodDrForPage: desktopPaginationMeta.periodDrForPage,
        periodCrForPage: desktopPaginationMeta.periodCrForPage,
        closingForPage: desktopPaginationMeta.closingForPage,
        booksOpeningBalance: Number(party.openingBalance) || 0,
        ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0,
        ledgerDateFilterActive: Boolean(dateRange?.from != null || dateRange?.to != null),
        openingBalancePeriodStartDate: ledgerOpeningPeriodStartDate,
        masterOpeningBalanceDate: (party as any).openingBalanceDate,
        dateRange,
      }
    );
    return getPdfBlob(payload);
  }, [
    company,
    visibleColumns,
    party,
    dateSystem,
    paginatedTransactions,
    desktopPaginationMeta,
    showNarration,
    showNotes,
    mergedUserNames,
    resolvedJournalAccountNames,
    rowsPerPage,
    dateRange,
    ledgerOpeningPeriodStartDate,
    getPrintTitle,
    buildDateRangeText,
  ]);

  buildStatementPdfRef.current = buildStatementPdfBlob;

  const handlePrint = () => {
    (async () => {
      try {
        await printTransactions(balanceMode === "bill_wise" ? "bill_wise" : "statement");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
      }
    })();
  };

  const handleExcelLedger = useCallback(() => {
    const rows = statusFilteredTransactions.map((t: Record<string, unknown>) => {
      const dRaw = (t as { date?: { toDate?: () => Date } }).date;
      const d = dRaw?.toDate ? dRaw.toDate() : new Date((t as { date?: unknown }).date as string | number | Date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": (t as { voucherNumber?: string }).voucherNumber,
        Type:
          typeof (t as { type?: string }).type === "string"
            ? voucherTypeDisplayText((t as { type: string }).type)
            : String((t as { type?: unknown }).type ?? ""),
        Narration: String((t as { narration?: string }).narration || ""),
        Debit: Number((t as { debit?: number }).debit) || 0,
        Credit: Number((t as { credit?: number }).credit) || 0,
        Balance: `${Math.abs(Number((t as { balance?: number }).balance) || 0).toFixed(2)} ${((t as { balance?: number }).balance ?? 0) >= 0 ? "Dr" : "Cr"}`,
      };
    });
    const summaryRows = [
      {
        "Date (BS)": "Opening Balance",
        Balance: `${Math.abs(openingBalanceForPeriod).toFixed(2)} ${openingBalanceForPeriod >= 0 ? "Dr" : "Cr"}`,
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
    const safeName = (party.name || "party").replace(/[/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeName}_ledger.xlsx`);
  }, [
    statusFilteredTransactions,
    formatDateBS,
    formatDate,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    headerClosingBalance,
    party.name,
  ]);

  const reportStickyTitle = useMemo(() => {
    if (mobileReportStickyTitle) return mobileReportStickyTitle;
    if (context === "sale") return "Sales";
    if (context === "purchase") return "Purchases";
    if (context === "payment-in") return "Receipt";
    if (context === "payment-out") return "Payment";
    return "Report";
  }, [mobileReportStickyTitle, context]);

  const handleMobileBack = useCallback(() => {
    if (mobileFooterDialogOpen) {
      setMobileFooterDialogOpen(null);
      closeModalInUrl();
      return;
    }
    if (isCalendarOpen) {
      setIsCalendarOpen(false);
      closeModalInUrl();
      return;
    }
    if (isVoucherDialogOpen) {
      setIsVoucherDialogOpen(false);
      setSelectedVoucher(null);
      closeModalInUrl();
      return;
    }
    if (isNoteOpen) {
      setIsNoteOpen(false);
      closeModalInUrl();
      return;
    }
    if (historyVoucher) {
      setHistoryVoucher(null);
      closeModalInUrl();
      return;
    }
    if (linkPaymentVoucher) {
      setLinkPaymentVoucher(null);
      closeModalInUrl();
      return;
    }
    if (linkAdvancesVoucher) {
      setLinkAdvancesVoucher(null);
      closeModalInUrl();
      return;
    }
    onBack?.();
  }, [mobileFooterDialogOpen, isCalendarOpen, isVoucherDialogOpen, isNoteOpen, historyVoucher, linkPaymentVoucher, linkAdvancesVoucher, closeModalInUrl, onBack]);

  const handleOpeningBalanceRowActivate = useCallback(
    (row: OpeningBalanceLedgerAccountRow) => {
      setOpeningBalanceEditRow(row);
      setOpeningBalanceEditOpen(true);
    },
    []
  );

  const handleOpeningBalanceEditOpenChange = useCallback((open: boolean) => {
    setOpeningBalanceEditOpen(open);
    if (!open) setOpeningBalanceEditRow(null);
  }, []);

  if(!party) return null;

  const dateRangeLabel = ledgerMasterDateRangeLabel(dateRange, buildDateRangeText());
  const balanceLabel = headerClosingBalance >= 0 ? "To Receive" : "To Pay";
  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);
  const masterPartyOpening = Number(transactionEntity?.openingBalance ?? party.openingBalance) || 0;
  // Statement: full period opening in Balance. Bill-wise: same as print â€” remaining on OB, status + linked voucher nos.
  const partyOpeningBalanceOutstandingForTable =
    balanceMode === "bill_wise" ? openingBalanceOutstanding : undefined;

  const autoLinkPromptUi =
    companyId && (user?.uid || isLocalMode) ? (
      <BillWiseAutoLinkPromptDialog
        open={autoLinkPrompt.open}
        onOpenChange={autoLinkPrompt.setOpen}
        proposal={autoLinkPrompt.proposal}
        companyId={companyId}
        userId={user?.uid || "local"}
        vouchers={vouchersForAutoLink}
      />
    ) : null;

  const openingBalanceMasterEditUi = (
    <OpeningBalanceMasterEditHost
      row={openingBalanceEditRow}
      open={openingBalanceEditOpen}
      onOpenChange={handleOpeningBalanceEditOpenChange}
      onMasterUpdated={() => onPartyUpdated()}
    />
  );

  const openingBalanceLedgerTable = isOpeningBalanceLedger && openingBalanceLedgerBreakdown ? (
    <OpeningBalanceLedgerAccountsTable
      breakdown={openingBalanceLedgerBreakdown}
      formatCurrency={formatCurrencyForPrint}
      className="px-1 pb-2"
      interactionLocked={openingBalanceEditOpen}
      onRowActivate={handleOpeningBalanceRowActivate}
    />
  ) : null;

  if (isMobile) {
    const isReportMobileChrome = mobileFooterVariant === "report";
    const hideReportPartyPicker = isReportMobileChrome && (isAllVouchersView || party.id === "all");
    // All-vouchers report: sirf ek title upar â€” balance neeche summary row me rahe.
    const reportHeaderTitleOnly = isReportMobileChrome && (isAllVouchersView || party.id === "all");

    const mobileEntityTxnToolbar = (
      <MobileEntityTxnToolbarRow placement="belowPager">
        {!hideReportPartyPicker && allParties && allParties.length > 0 && (
          <MobileEntityTxnToolbarPicker>
            <Combobox
              options={partyDropdownOptions}
              value={party.id}
              onChange={(value) => {
                if (!value || value === party.id) return;
                if (onEmbeddedPartyChange) onEmbeddedPartyChange(value);
                else router.push(`/party?selected=${value}`);
              }}
              placeholder="Select party"
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
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleMobileBack} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {reportHeaderTitleOnly ? (
                  <h1 className="min-w-0 flex-1 text-base font-bold text-muted-foreground">{reportStickyTitle}</h1>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <h1 className="shrink-0 text-base font-bold text-muted-foreground">{reportStickyTitle}</h1>
                      <span className="shrink-0 select-none text-muted-foreground/55" aria-hidden>
                        Â·
                      </span>
                      <span
                        className={cn("min-w-0 truncate text-sm font-medium", masterDetailBalanceToneClass(headerClosingBalance))}
                        title={headerDisplayTitle}
                      >
                        {headerDisplayTitle}
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
                  </>
                )}
              </div>
            </header>
          ) : onBack ? (
            <div className="flex flex-shrink-0 items-center gap-1.5 border-b px-2 py-1">
              <Button variant="ghost" size="icon" onClick={handleMobileBack} className="h-7 w-7 flex-shrink-0" aria-label="Back">
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <h1 className="shrink-0 text-base font-bold text-muted-foreground">Party details</h1>
              {isIcCompanyGroupView && icMemberDisplayName && icPeerCompanyPrimaryName ? (
                <div className="min-w-0 flex-1">
                  <GroupDetailNestedNameHeader
                    groupName={icPeerCompanyPrimaryName}
                    memberName={icMemberDisplayName}
                  />
                </div>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={headerDisplayTitle}>
                  {headerDisplayTitle}
                </span>
              )}
            </div>
          ) : null}
          {/* Mobile: date/balance/search â€” footer chevron se collapse */}
          <MobileDetailSummaryCollapsible>
          {!hideMobilePeriodLabelRow ? (
            <div
              className={cn(mdc.mobileTxnDateRow, "gap-1.5 px-2 py-1")}
              {...mdcMobileTxnDateRowData}
            >
              <span className="text-xs font-medium text-muted-foreground">{dateRangeLabel}</span>
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
          {/* Closing balance + Sale/Pur TDS on same gray row (no linked-trxn toggle on mobile) */}
          <div
            className={cn(mdc.mobileTxnBalanceRow, "w-full")}
            {...mdcMobileTxnBalanceRowData}
            {...(partyTdsBalanceSummary.hasAny ? { "data-pl-party-balance-with-tds": "" } : {})}
          >
            {partyTdsBalanceSummary.hasAny ? (
              <div
                data-pl-party-tds-inline=""
                className="flex shrink-0 flex-col items-start gap-1 text-left"
              >
                <Popover open={tdsCardsOpenM} onOpenChange={(o) => { if (o && !tdsLedgerOnly) { if (partyTdsHasPur) openPurTdsLedgerDetails(); else openSaleTdsLedgerDetails(); return; } setTdsCardsOpenM(o); }}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 flex-col gap-0 text-left cursor-pointer"
                      aria-pressed={tdsLedgerViewMode === "sale" || tdsLedgerViewMode === "purchase"}
                    >
                      <span className="text-[10px] font-semibold tracking-wide text-muted-foreground leading-none">
                        {tdsLedgerViewMode === "sale" || (tdsLedgerViewMode !== "purchase" && !partyTdsHasPur) ? "Sale TDS" : "Pur TDS"}
                      </span>
                      {tdsLedgerViewMode === "sale" || (tdsLedgerViewMode !== "purchase" && !partyTdsHasPur) ? (
                        <span className="text-xs font-bold text-green-600 leading-tight">
                          {formatCurrency(partyTdsBalanceSummary.saleTds, { showDrCr: true })}
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-red-600 leading-tight">
                          {formatCurrency(-partyTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <div className="flex flex-col gap-2">
                      {(partyTdsHasSale || showAllTds) ? (
                        <button
                          type="button"
                          className={cn("flex flex-col items-start rounded-md border px-3 py-1.5 text-left", tdsLedgerViewMode === "sale" && "ring-2 ring-primary")}
                          aria-pressed={tdsLedgerViewMode === "sale"}
                          onClick={() => {
                            openSaleTdsLedgerDetails();
                            setTdsCardsOpenM(false);
                          }}
                        >
                          <span className="text-[10px] font-semibold text-muted-foreground leading-none">Sale TDS Balance</span>
                          <span className="text-sm font-bold text-green-600 leading-tight">
                            {formatCurrency(partyTdsBalanceSummary.saleTds, { showDrCr: true })}
                          </span>
                        </button>
                      ) : null}
                      {(partyTdsHasPur || showAllTds) ? (
                        <button
                          type="button"
                          className={cn("flex flex-col items-start rounded-md border px-3 py-1.5 text-left", (tdsLedgerViewMode === "purchase" || (tdsLedgerViewMode !== "sale" && partyTdsHasPur)) && "order-first", tdsLedgerViewMode === "purchase" && "ring-2 ring-primary")}
                          aria-pressed={tdsLedgerViewMode === "purchase"}
                          onClick={() => {
                            openPurTdsLedgerDetails();
                            setTdsCardsOpenM(false);
                          }}
                        >
                          <span className="text-[10px] font-semibold text-muted-foreground leading-none">Pur TDS Balance</span>
                          <span className="text-sm font-bold text-red-600 leading-tight">
                            {formatCurrency(-partyTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                          </span>
                        </button>
                      ) : null}
                      {showAllTds ? (
                        <div className="flex flex-col items-start rounded-md border px-3 py-1.5 text-left">
                          <span className="text-[10px] font-semibold text-muted-foreground leading-none">Add Salary TDS Balance</span>
                          <span className="text-sm font-bold text-muted-foreground leading-tight">{formatCurrency(0, { showDrCr: true })}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {!showAllTds ? (<Button type="button" variant="chromePill" size="sm" aria-pressed={showAllTds} onClick={() => setShowAllTds(true)} className="h-8 w-auto min-w-[70px] whitespace-nowrap px-3 text-xs font-semibold">
                        Show all TDS type cards (always)
                      </Button>) : null}
                      {showAllTds ? (<Button type="button" variant="chromePill" size="sm" aria-pressed={!showAllTds} onClick={() => setShowAllTds(false)} className="h-8 w-auto min-w-[70px] whitespace-nowrap px-3 text-xs font-semibold">
                        Default
                      </Button>) : null}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ) : null}
            <button
              type="button"
              data-pl-party-account-balance=""
              className="min-w-0 flex-1 cursor-pointer text-center"
              onClick={openPartyLedgerDetails}
              aria-pressed={tdsLedgerViewMode === "account"}
            >
              <p
                className={cn(
                  mdc.mobileTxnBalanceText2xl,
                  headerClosingBalance >= 0 ? "text-green-600" : "text-red-600"
                )}
              >
                <span className="text-[0.6em]">{balanceLabel}</span> {formatCurrency(Math.abs(headerClosingBalance), { noSuffix: true })}
              </p>
            </button>
          </div>
          </MobileDetailSummaryCollapsible>
          {/* Transaction list â€” report: table + pager ek scroll (100/All par gap fix); ledger: pager bahar */}
          <div
            className={mobileTxnScrollBodyClass(isReportMobileChrome)}
          >
            <div className="pb-2">
            {isOpeningBalanceLedger ? (
              openingBalanceLedgerTable
            ) : mobileReportView === "chart" ? (
              <RunningBalanceFullChart
                transactions={searchFilteredTransactions}
                openingBalance={openingBalanceForPeriod}
              />
            ) : (
            <MasterAccountFreezeTxnShell
              className="min-h-[8rem]"
              overlay={partyFreezeOverlay}
            >
            <TransactionsTable
              transactions={paginatedTransactions}
              ledgerTransactionsForFyOpening={ledgerListForPaging}
              fyLedgerScopeOpeningBalance={ledgerOpeningForPaging}
              context={transactionContext}
              contextId={ledgerContextId}
              transactionCardSearchHighlight={mobileSearchTerm}
              openingBalance={desktopPaginationMeta.openingForPage}
              periodOpeningUnavailable={periodOpeningUnavailable}
              periodOpeningLoading={periodOpeningLoading}
              booksOpeningBalance={tdsLedgerOnly ? 0 : masterPartyOpening}
              openingBalanceOutstanding={partyOpeningBalanceOutstandingForTable}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceNarration={party.openingBalanceNarration}
              openingBalanceAttachmentUrls={party.documentFileUrls}
              openingBalanceDate={(party as any).openingBalanceDate}
              ledgerDateFilterActive={hasLedgerDateFilter}
              ledgerShowBookOpeningRow={!tdsLedgerOnly && !reportTypeFilterActive && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0)}
              hideLedgerOpeningRows={tdsLedgerOnly}
              openingBalancePeriodStartDate={ledgerOpeningPeriodStartDate}
              dateRange={dateRange}
              openingBalanceActions={undefined}
              showNarration={showNarration}
              visibleColumns={effectiveVisibleColumns}
              journalAccountNames={resolvedJournalAccountNames}
              userNames={mergedUserNames}
              onRowClick={handleEditVoucher}
              onInterCompanyChangeDetectedClick={handleInterCompanyChangeDetectedClick}
              onDeleteVoucher={handleDeleteVoucher}
              onHistoryVoucher={handleHistoryVoucher}
              onAddLink={handleAddLink}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={ledgerFooterClosingBalance}
              closingBalanceLabel={tdsClosingBalanceLabel}
              isAllVouchersView={isAllVouchersView}
              hideDebitColumn={false}
              hideCreditColumn={false}
              hideBalanceColumn={false}
              isDateChange={isDateChange}
              scrollOnlyTransactions
              closingBalanceRowActions={tdsLedgerOnly ? undefined : partyClosingBalanceRowActions}
              closingBalanceActions={tdsLedgerOnly ? undefined : partyClosingBalanceActions}
              highlightPendingApproval
              statusFilter={statusFilter}
              statusFilterAllChecked={statusFilterAllChecked}
              onStatusFilterAll={handleStatusFilterAll}
              onStatusFilterChange={handleStatusFilterChange}
              statusFilterIdPrefix="party"
              forceBalanceMode={tdsLedgerOnly || adminSubscriberPartyLedger ? "statement" : undefined}
              {...statementCheck.tableProps}
            />
            </MasterAccountFreezeTxnShell>
            )}
            </div>
          </div>
          {mobileReportView === "chart" && isReportMobileChrome ? (
            <div
              className={cn("pl-mobile-txn-pager-host relative flex-shrink-0", mdc.reportTxnPagerOutside)}
              data-pl-mobile-txn-pager-has-toolbar=""
            >
              <div className="border-t border-blue-300/60" aria-hidden />
              {mobileEntityTxnToolbar}
              <MobileLedgerFooterChevronFab />
            </div>
          ) : null}
          {mobileReportView === "list" && isReportMobileChrome ? (
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
          {mobileReportView === "list" && !isReportMobileChrome ? (
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
            onBalanceModeToggle={tdsLedgerOnly ? undefined : () => setBalanceMode(balanceMode === "bill_wise" ? "statement" : "bill_wise")}
            mobileView={mobileReportView}
            onViewToggle={() => setMobileReportView((v) => (v === "list" ? "chart" : "list"))}
          />
        ) : (
        <div
          className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur z-50 flex items-stretch justify-around"
          data-pl-mobile-ledger-action-footer=""
        >
          {/* Mobile footer: ek button â€” Statement â†” Bill wise toggle */}
          {!tdsLedgerOnly ? (
          <LedgerViewModeToggleButton
            value={balanceMode}
            onChange={setBalanceMode}
            options={[
              { value: "statement", label: "Statement" },
              { value: "bill_wise", label: "Bill wise" },
            ]}
          />
          ) : null}
          <Button className="flex-1 min-h-0 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-semibold" disabled={blockPartyNewTransactions} onClick={() => { if (blockPartyNewTransactions) return; openingModalRef.current = true; setMobileFooterDialogOpen("payment_in"); openModalInUrl(); }}>
            Receive
          </Button>
          <Button className="flex-1 min-h-0 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-semibold" disabled={blockPartyNewTransactions} onClick={() => { if (blockPartyNewTransactions) return; openingModalRef.current = true; setMobileFooterDialogOpen("payment_out"); openModalInUrl(); }}>
            Pay
          </Button>
          <MobileEntityLedgerFooterPrintButton onClick={handlePrint} />
          <AddVoucherDialog
            isOpen={!!mobileFooterDialogOpen}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setMobileFooterDialogOpen(null);
                closeModalInUrl();
              }
            }}
            defaultTab={mobileFooterDialogOpen || "sale"}
            defaultVoucherData={addVoucherDefaultPartyOnly}
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
              <Button className="flex-1 min-h-0 min-w-0 rounded-md px-1 text-sm font-semibold bg-pink-600 hover:bg-pink-700 text-white">
                <CalendarIcon className="h-4 w-4 shrink-0" />
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
                    onSelect={(_bs, adDate) => {
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
              <DialogTitle>Add a New Note for {party.name}</DialogTitle>
              <DialogDescription>Record a new note associated with this party.</DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
              <CreateNoteForm
                onVoucherAction={() => { onPartyUpdated(); setIsNoteOpen(false); }}
                initialContext="Party"
                initialEntityId={party.id}
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
            } else {
              setIsVoucherDialogOpen(open);
            }
          }}
          voucher={selectedVoucher}
          onVoucherAction={(status) => {
            if (status === "saved") onPartyUpdated();
            setSelectedVoucher(null);
          }}
          ledgerEntityId={party?.id}
          ledgerOpeningBalanceOutstanding={
            typeof openingBalanceOutstanding === "number"
              ? openingBalanceOutstanding
              : Math.abs(masterPartyOpening) > 0
                ? Math.abs(masterPartyOpening)
                : undefined
          }
          ledgerBooksOpeningBalanceSigned={ledgerOpeningForRunning}
        />
        <HistoryDialog
          voucher={historyVoucher}
          isOpen={!!historyVoucher}
          onOpenChange={(open: boolean) => !open && setHistoryVoucher(null)}
          onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)}
        />
        {interCompanyChangeDetectDialog}
        {linkAdvancesVoucher && (
          <LinkAdvancesToVoucherDialog
            isOpen={!!linkAdvancesVoucher}
            onOpenChange={(open: boolean) => !open && setLinkAdvancesVoucher(null)}
            mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
            targetVoucherId={linkAdvancesVoucher.id}
            targetPartyId={linkAdvancesVoucher.partyId ?? party?.id ?? ""}
            targetPartyName={allParties?.find((p) => p.id === (linkAdvancesVoucher.partyId ?? party?.id))?.name ?? party?.name ?? "Party"}
            partyOpeningBalance={allParties?.find((p) => p.id === (linkAdvancesVoucher.partyId ?? party?.id))?.openingBalance ?? party?.openingBalance ?? 0}
            balanceKind="all"
            onDone={() => setLinkAdvancesVoucher(null)}
          />
        )}
        {linkPaymentVoucher && (
          <LinkPaymentToTxnsDialog
            isOpen={!!linkPaymentVoucher}
            onOpenChange={(open: boolean) => !open && setLinkPaymentVoucher(null)}
            variant={linkPaymentVoucher.type === "payment_out" || linkPaymentVoucher.type === "direct_expense" ? "payment_out" : "payment_in"}
            partyId={linkPaymentVoucher.partyId ?? null}
            partyName={allParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.name ?? "Party"}
            receivedAmount={Number(linkPaymentVoucher.amount ?? linkPaymentVoucher.total ?? 0)}
            existingAllocations={Array.isArray(linkPaymentVoucher.allocations) ? linkPaymentVoucher.allocations : []}
            paymentInId={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
            paymentOutId={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
            paymentInVoucherNumber={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
            paymentInDate={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
            paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
            paymentOutDate={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
            partyOpeningBalance={allParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.openingBalance ?? 0}
            onDone={async (allocations, _amount) => {
              if (!companyId || !linkPaymentVoucher?.id) return;
              const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
              const result = await runWithVoucherLinkSaveProgress(async () => {
                await applyPaymentBillWiseLinkAllocations(companyId, linkPaymentVoucher, allocations);
                setLinkPaymentVoucher(null);
              }, { successTitle: "Allocations updated" });
              if (!result.ok) {
                toast.error(
                  result.error instanceof Error
                    ? result.error.message
                    : "Failed to update allocations."
                );
              }
            }}
          />
        )}
        {autoLinkPromptUi}
        {openingBalanceMasterEditUi}
      </>
    );
  }

  return (
    <>
      {party?.id && <EntityAlarmPopup context="Party" entityId={party.id} />}
      {autoLinkPromptUi}
      {openingBalanceMasterEditUi}
      <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
        {/* Header: identity + pills ek hi gap (pill gap); Party name chhoti width pe max 2 line (avatar h-12), pattika height nahi badhe */}
        {/* Party docs sirf table Opening row File column + Edit party dialog — yahan duplicate thumbnail strip nahi */}
        <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
          <div className={LEDGER_HEADER_OUTER_ROW_CN}>
            {/* Left 50%: fixed avatar + name card (H-scroll) + balance card */}
            <div className={LEDGER_HEADER_IDENTITY_CN}>
              {isMobile && onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div className={LEDGER_HEADER_AVATAR_CN}>
                <EntityFileAttachmentHover
                  fileUrl={partyHeaderAttachmentUrl}
                  triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
                >
                  <ResolvedEntityAvatar
                    className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                    companyId={headerIdentityParty.companyId}
                    src={partyHeaderAttachmentUrl ?? undefined}
                    alt={headerDisplayTitle}
                    fallbackText={getInitials(headerDisplayTitle)}
                    fallbackSlot={
                      (party as any).isSystemAccount ? <FileDigit className="h-6 w-6 text-muted-foreground" /> : undefined
                    }
                  />
                </EntityFileAttachmentHover>
                {party.id !== "all" &&
                  !(party as any).isSystemAccount &&
                  (!isIcCompanyGroupView || icGroupFilteredMember) && (
                  <EditPartyDialog
                    party={headerIdentityParty}
                    onPartyUpdated={handlePartyUpdated}
                    onPartyDeleted={() => onPartyDeleted(headerIdentityParty.id)}
                    hasTransactions={processedTransactions.length > 0}
                  >
                    <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </EditPartyDialog>
                )}
              </div>
              <div className={LEDGER_HEADER_NAME_CARD_CN}>
                {isIcCompanyGroupView && icMemberDisplayName && icPeerCompanyPrimaryName ? (
                  <GroupDetailNestedNameHeader
                    groupName={icPeerCompanyPrimaryName}
                    memberName={icMemberDisplayName}
                  />
                ) : (
                  <div className="min-w-0">
                    <h2 className={LEDGER_HEADER_TITLE_CN} title={headerDisplayTitle}>
                      {headerDisplayTitle}
                    </h2>
                    {headerDisplayEmail ? (
                      <p className="truncate text-xs font-normal text-muted-foreground">{headerDisplayEmail}</p>
                    ) : null}
                  </div>
                )}
              </div>
              {reportSummaryCards?.length ? (
                <ReportHeaderSummaryCards cards={reportSummaryCards} />
              ) : (
              <>
              <button
                type="button"
                className={cn(LEDGER_HEADER_BALANCE_CARD_CN, "cursor-pointer")}
                onClick={openPartyLedgerDetails}
                aria-pressed={tdsLedgerViewMode === "account"}
                title="Party balance details"
              >
                <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                  <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Account Balance</span>
                  <div className={cn(LEDGER_HEADER_BALANCE_CN, headerClosingBalance >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(headerClosingBalance, { showDrCr: true })}
                  </div>
                </div>
              </button>
              {partyTdsHasSale || partyTdsHasPur ? (
                <Popover open={tdsCardsOpen} onOpenChange={(o) => { if (o && !tdsLedgerOnly) { if (partyTdsHasPur) openPurTdsLedgerDetails(); else openSaleTdsLedgerDetails(); return; } setTdsCardsOpen(o); }}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "cursor-pointer text-left")}
                      aria-pressed={tdsLedgerViewMode === "sale" || tdsLedgerViewMode === "purchase"}
                      title="TDS Balance details"
                    >
                      <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                        <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>
                          {tdsLedgerViewMode === "sale" || (tdsLedgerViewMode !== "purchase" && !partyTdsHasPur)
                            ? "Sale TDS Balance"
                            : "Pur TDS Balance"}
                        </span>
                        {tdsLedgerViewMode === "sale" || (tdsLedgerViewMode !== "purchase" && !partyTdsHasPur) ? (
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-green-600")}>
                            {formatCurrency(partyTdsBalanceSummary.saleTds, { showDrCr: true })}
                          </div>
                        ) : (
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-red-600")}>
                            {formatCurrency(-partyTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                          </div>
                        )}
                      </div>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <div className="flex gap-2">
                      {(partyTdsHasSale || showAllTds) ? (
                        <button
                          type="button"
                          className={cn(
                            LEDGER_HEADER_TDS_BALANCE_CARD_CN,
                            "cursor-pointer text-left",
                            tdsLedgerViewMode === "sale" && "ring-2 ring-primary"
                          )}
                          onClick={() => {
                            openSaleTdsLedgerDetails();
                            setTdsCardsOpen(false);
                          }}
                          aria-pressed={tdsLedgerViewMode === "sale"}
                          title="Sale TDS Balance details"
                        >
                          <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                            <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Sale TDS Balance</span>
                            <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-green-600")}>
                              {formatCurrency(partyTdsBalanceSummary.saleTds, { showDrCr: true })}
                            </div>
                          </div>
                        </button>
                      ) : null}
                      {(partyTdsHasPur || showAllTds) ? (
                        <button
                          type="button"
                          className={cn(
                            LEDGER_HEADER_TDS_BALANCE_CARD_CN,
                            "cursor-pointer text-left",
                            (tdsLedgerViewMode === "purchase" || (tdsLedgerViewMode !== "sale" && partyTdsHasPur)) && "order-first",
                            tdsLedgerViewMode === "purchase" && "ring-2 ring-primary"
                          )}
                          onClick={() => {
                            openPurTdsLedgerDetails();
                            setTdsCardsOpen(false);
                          }}
                          aria-pressed={tdsLedgerViewMode === "purchase"}
                          title="Pur TDS Balance details"
                        >
                          <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                            <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Pur TDS Balance</span>
                            <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-red-600")}>
                              {formatCurrency(-partyTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                            </div>
                          </div>
                        </button>
                      ) : null}
                      {showAllTds ? (
                        <div className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "text-left")}>
                          <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                            <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Add Salary TDS Balance</span>
                            <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-muted-foreground")}>{formatCurrency(0, { showDrCr: true })}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {!showAllTds ? (<Button type="button" variant="chromePill" size="sm" aria-pressed={showAllTds} onClick={() => setShowAllTds(true)} className="h-8 w-auto min-w-[70px] whitespace-nowrap px-3 text-xs font-semibold">
                        Show all TDS type cards (always)
                      </Button>) : null}
                      {showAllTds ? (<Button type="button" variant="chromePill" size="sm" aria-pressed={!showAllTds} onClick={() => setShowAllTds(false)} className="h-8 w-auto min-w-[70px] whitespace-nowrap px-3 text-xs font-semibold">
                        Default
                      </Button>) : null}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
              </>
              )}
            </div>
            {/* Cluster: action pills â€” same gap-1.5 as identity cluster */}
            <div className={LEDGER_HEADER_PILL_ROW_CN}>
              {party.id !== "all" &&
                !(party as any).isSystemAccount &&
                (!isIcCompanyGroupView || icGroupFilteredMember) ? (
                <ReconciliationAccountButton accountId={headerIdentityParty.id} />
              ) : null}
              <LedgerHeaderPrintButton variant="outline" onClick={handlePrint} />
              <LedgerHeaderReminderButton
                variant="outline"
                disabled={party.id === "all" || (isIcCompanyGroupView && !icGroupFilteredMember)}
                onClick={() => setReminderOpen(true)}
              />
              <LedgerReminderDialog
                open={reminderOpen}
                onOpenChange={setReminderOpen}
                context="Party"
                entityId={headerIdentityParty.id}
                title={headerIdentityParty.name}
              />
              <LedgerUnapprovedFilterButton
                active={unapprovedOnly}
                onClick={toggleUnapprovedOnly}
              />
              {(dateSystem === 'BS' || dateSystem === 'Both') && (
                  <BsDatePicker
                    isRange
                    masterLedgerDatePresets
                    ledgerPaginationReset={ledgerPaginationReset}
                    valueAD={dateRange}
                    onChangeAD={(range) => onDateRangeChangeWithUnapprovedReset(range as DateRange | undefined)}
                    transactionDates={transactionDates}
                    className={cn("w-auto", LEDGER_DATE_RANGE_PILL_CN)}
                  />
              )}
              {(dateSystem === 'AD' || dateSystem === 'Both') && (
                  <Popover open={isDesktopCalendarOpen} onOpenChange={setIsDesktopCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                          "justify-start text-left px-2 w-auto",
                          LEDGER_DATE_RANGE_PILL_CN
                        )}
                        data-theme-detail="date-range"
                      >
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
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
                            onDateRangeChange(r);
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
                          onDateRangeChange(next);
                          setIsDesktopCalendarOpen(false);
                        } else {
                          const next = { from: range.from, to: adDate };
                          setTempDateRange(next);
                          onDateRangeChange(next);
                          setIsDesktopCalendarOpen(false);
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {isFilterActive && (
                // Header par BS/AD alag clear buttons hatakar single clear button rakha gaya.
                <Button variant="ghost" size="icon" onClick={clearFilters} className={cn(LEDGER_HEADER_PILL_ICON_CN, "text-muted-foreground hover:text-foreground")} aria-label="Clear date filter">
                  <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
                </Button>
              )}
              <NotificationBell context="Party" entityId={party.id} />
              {!isOpeningBalanceLedger && !tdsLedgerOnly ? (
              <LedgerViewModePills
                value={balanceMode}
                onChange={setBalanceMode}
                options={[
                  { value: "statement", label: "Statement" },
                  { value: "bill_wise", label: "Bill wise" },
                ]}
              />
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={blockPartyNewTransactions}
                onClick={() => setIsNoteOpen(true)}
                className={LEDGER_HEADER_PILL_CN}
                data-theme-detail="add-note"
              >
                <FilePlus className="mr-2 h-3.5 w-3.5" />
                Add Note
              </Button>
              {tdsLedgerOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTdsLinkedTrxn((v) => !v)}
                  className={LEDGER_HEADER_PILL_CN}
                  title={
                    showTdsLinkedTrxn
                      ? "Hide linked settlement payments / journals"
                      : "Show linked settlement payments / journals"
                  }
                >
                  {showTdsLinkedTrxn ? "Hide linked trxn" : "Show linked trxn"}
                </Button>
              ) : null}
              {onShowAll && (
                <Button variant="outline" size="sm" onClick={onShowAll} className={LEDGER_HEADER_PILL_CN}>
                  All Vouchers
                </Button>
              )}
              
              {isCompanyAdmin && !tdsLedgerOnly ? (
                <Button
                  type="button"
                  variant="chromePill"
                  size="sm"
                  className={LEDGER_HEADER_PILL_CN}
                  onClick={openBillWiseAutoLink}
                >
                  Link for Bill Wise
                </Button>
              ) : null}
            </div>
          </div>
        </div>
          }
          table={
            <MasterAccountFreezeTxnShell
              overlay={partyFreezeOverlay}
            >
            {isOpeningBalanceLedger ? (
              openingBalanceLedgerTable
            ) : (
            <TransactionsTable
              transactions={paginatedTransactions}
              ledgerTransactionsForFyOpening={ledgerListForPaging}
              fyLedgerScopeOpeningBalance={ledgerOpeningForPaging}
              context={transactionContext}
              contextId={ledgerContextId}
              openingBalance={desktopPaginationMeta.openingForPage}
              periodOpeningUnavailable={periodOpeningUnavailable}
              periodOpeningLoading={periodOpeningLoading}
              booksOpeningBalance={tdsLedgerOnly ? 0 : masterPartyOpening}
              openingBalanceOutstanding={partyOpeningBalanceOutstandingForTable}
              openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
              openingBalanceNarration={party.openingBalanceNarration}
              openingBalanceAttachmentUrls={party.documentFileUrls}
              openingBalanceDate={(party as any).openingBalanceDate}
              ledgerDateFilterActive={hasLedgerDateFilter}
              ledgerShowBookOpeningRow={!tdsLedgerOnly && !reportTypeFilterActive && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0)}
              hideLedgerOpeningRows={tdsLedgerOnly}
              openingBalancePeriodStartDate={ledgerOpeningPeriodStartDate}
              dateRange={dateRange}
              openingBalanceActions={
                !tdsLedgerOnly &&
                party.id !== "all" &&
                !(party as any).isSystemAccount &&
                !isIcCompanyGroupView ? (
                  <EditPartyDialog
                    party={party}
                    onPartyUpdated={handlePartyUpdated}
                    onPartyDeleted={() => onPartyDeleted(party.id)}
                    hasTransactions={processedTransactions.length > 0}
                  >
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </EditPartyDialog>
                ) : null
              }
              showNarration={showNarration}
              visibleColumns={effectiveVisibleColumns}
              journalAccountNames={resolvedJournalAccountNames}
              userNames={mergedUserNames}
              onRowClick={handleEditVoucher}
              onInterCompanyChangeDetectedClick={handleInterCompanyChangeDetectedClick}
              onDeleteVoucher={handleDeleteVoucher}
              onHistoryVoucher={handleHistoryVoucher}
              onAddLink={handleAddLink}
              filters={filters}
              setFilters={setFilters}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              periodDr={desktopPaginationMeta.periodDrForPage}
              periodCr={desktopPaginationMeta.periodCrForPage}
              closingBalance={ledgerFooterClosingBalance}
              closingBalanceLabel={tdsClosingBalanceLabel}
              isAllVouchersView={isAllVouchersView}
              hideDebitColumn={false}
              hideCreditColumn={false}
              hideBalanceColumn={false}
              isDateChange={isDateChange}
              scrollOnlyTransactions
              closingBalanceRowActions={tdsLedgerOnly ? undefined : partyClosingBalanceRowActions}
              closingBalanceActions={tdsLedgerOnly ? undefined : partyClosingBalanceActions}
              highlightPendingApproval
              statusFilter={statusFilter}
              statusFilterAllChecked={statusFilterAllChecked}
              onStatusFilterAll={handleStatusFilterAll}
              onStatusFilterChange={handleStatusFilterChange}
              statusFilterIdPrefix="party"
              forceBalanceMode={tdsLedgerOnly || adminSubscriberPartyLedger ? "statement" : undefined}
              {...statementCheck.tableProps}
            />
            )}
            </MasterAccountFreezeTxnShell>
          }
          footer={
        <LedgerDesktopFooter
          left={
            <>
              <LedgerFooterCheckboxPill
                id="show-narration-party"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
              <LedgerFooterColumnsMenu ledgerPresentationMode={ledgerPresentationMode}>
                <DropdownMenuContent align="start" className="w-52 p-2">
                  {(tdsLedgerOnly
                    ? ledgerTdsFooterColumnMenuKeys(balanceMode === "bill_wise")
                    : (Object.keys(COLUMN_LABELS) as TransactionColumnKey[]).filter(
                        (key) => !["tdsTaxable", "tdsAmount"].includes(key)
                      )
                  )
                    .filter(ledgerColumnMenuFilter).filter((key) => key !== "status" || balanceMode === "bill_wise")
                    .map((key) => {
                    const isStatusInStatement = key === "status" && balanceMode === "statement";
                    const isStatusInBillWise = key === "status" && balanceMode === "bill_wise";
                    const isStatusLocked = isStatusInStatement || isStatusInBillWise;
                    const columnChecked =
                      isStatusInStatement ? false : isStatusInBillWise ? true : effectiveVisibleColumns[key] !== false;
                    return (
                      <DropdownMenuItem
                        key={key}
                        onSelect={(e) => e.preventDefault()}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Checkbox
                          id={`col-${key}-party`}
                          checked={columnChecked}
                          disabled={isStatusLocked}
                          onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                        />
                        <label htmlFor={`col-${key}-party`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                          {COLUMN_LABELS[key]}
                        </label>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-party"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
              <StatementCheckModeFooterControls
                idPrefix="party"
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
          rowsPerPageSelectValue={rowsPerPageSelectValue(
            rowsPerPage,
            ROWS_PER_PAGE_OPTIONS_DEFAULT,
            "10"
          )}
          onRowsPerPageChange={(value) => {
            setRowsPerPage(Number(value) || 0);
            setCurrentPage(1);
          }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS_DEFAULT}
          beforeCount={desktopPaginationMeta.beforeCount}
          afterCount={desktopPaginationMeta.afterCount}
          totalCount={statusFilteredTransactions.length}
          ledgerPresentationMode={ledgerPresentationMode}
        />
          }
        />
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent
          overlayClassName={nestedLedgerNoteDialogShell.overlayClassName}
          className={nestedLedgerNoteDialogShell.className}
        >
          <DialogHeader>
            <DialogTitle>Add a New Note for {party.name}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this party.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onPartyUpdated();
                setIsNoteOpen(false);
              }}
              initialContext="Party"
              initialEntityId={party.id}
              compactFooter
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open) => {
          setIsVoucherDialogOpen(open);
          if (!open) {
            setSelectedVoucher(null);
            if (isMobile) closeModalInUrl();
          }
        }}
        voucher={selectedVoucher}
        onVoucherAction={(status) => {
          if (status === "saved") onPartyUpdated();
          setSelectedVoucher(null);
        }}
        ledgerEntityId={party?.id}
        ledgerOpeningBalanceOutstanding={
          typeof openingBalanceOutstanding === "number"
            ? openingBalanceOutstanding
            : Math.abs(masterPartyOpening) > 0
              ? Math.abs(masterPartyOpening)
              : undefined
        }
        ledgerBooksOpeningBalanceSigned={ledgerOpeningForRunning}
      />
      <HistoryDialog voucher={historyVoucher} isOpen={!!historyVoucher} onOpenChange={(open) => !open && setHistoryVoucher(null)} onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)} />
      {interCompanyChangeDetectDialog}
      {linkAdvancesVoucher && (
        <LinkAdvancesToVoucherDialog
          isOpen={!!linkAdvancesVoucher}
          onOpenChange={(open: boolean) => !open && setLinkAdvancesVoucher(null)}
          mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
          targetVoucherId={linkAdvancesVoucher.id}
          targetPartyId={linkAdvancesVoucher.partyId ?? party?.id ?? ""}
          targetPartyName={allParties?.find((p) => p.id === (linkAdvancesVoucher.partyId ?? party?.id))?.name ?? party?.name ?? "Party"}
          partyOpeningBalance={allParties?.find((p) => p.id === (linkAdvancesVoucher.partyId ?? party?.id))?.openingBalance ?? party?.openingBalance ?? 0}
          balanceKind="all"
          onDone={() => setLinkAdvancesVoucher(null)}
        />
      )}
      {linkPaymentVoucher && (
        <LinkPaymentToTxnsDialog
          isOpen={!!linkPaymentVoucher}
          onOpenChange={(open: boolean) => !open && setLinkPaymentVoucher(null)}
          variant={linkPaymentVoucher.type === "payment_out" || linkPaymentVoucher.type === "direct_expense" ? "payment_out" : "payment_in"}
          partyId={linkPaymentVoucher.partyId ?? null}
          partyName={allParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.name ?? "Party"}
          receivedAmount={Number(linkPaymentVoucher.amount ?? linkPaymentVoucher.total ?? 0)}
          existingAllocations={Array.isArray(linkPaymentVoucher.allocations) ? linkPaymentVoucher.allocations : []}
          paymentInId={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
          paymentOutId={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
          paymentInVoucherNumber={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
          paymentInDate={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
          paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
          paymentOutDate={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
          partyOpeningBalance={allParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.openingBalance ?? 0}
          onDone={async (allocations, _amount) => {
            if (!companyId || !linkPaymentVoucher?.id) return;
            const { runWithVoucherLinkSaveProgress } = await import("@/lib/voucherSaveUi");
            const result = await runWithVoucherLinkSaveProgress(async () => {
              await applyPaymentBillWiseLinkAllocations(companyId, linkPaymentVoucher, allocations);
              setLinkPaymentVoucher(null);
            }, { successTitle: "Allocations updated" });
            if (!result.ok) {
              toast.error(
                result.error instanceof Error
                  ? result.error.message
                  : "Failed to update allocations."
              );
            }
          }}
        />
      )}
    </>
  );
}

    
