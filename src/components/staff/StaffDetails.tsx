
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import { useShowAllTdsCards } from "@/lib/useShowAllTdsCards";
import * as React from "react";
import { openPrintDirect, getPdfBlob, companyFiscalFieldsForPrint } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import type { Staff, StaffGroup } from "@/components/staff/types";
import { ReconciliationAccountButton } from "@/components/reconciliation/ReconciliationAccountButton";
import { Button } from "@/components/ui/button";
import { LedgerViewModePills } from "@/components/ui/LedgerViewModePills";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Calendar as CalendarIcon,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  FilePlus,
  MoreVertical,
  XCircle,
  ArrowLeft,
  Columns3,
  ChevronDown,
  Search,
  Pencil,
} from "lucide-react";
import { StaffAccountFallbackIcon } from "@/components/entity/StaffEntityIcon";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { DateRange } from "@/components/ui/ad-calendar";
import { format, startOfDay, endOfDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerDescription as MobileDialogDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { nestedLedgerChildDialogShell } from "@/lib/nestedLedgerMasterEditPresentation";
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
import { mdc, mdcMobileTxnBalanceRowData, mdcNoEdgeSwipeCapture, mobileTxnScrollBodyClass } from "@/lib/mobileDetailChrome";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import AdCalendar from "@/components/ui/ad-calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDate } from "@/hooks/useDate";
import { EditStaffDialog } from "./EditStaffDialog";
import { EntityAlarmPopup } from "@/components/messages/EntityAlarmPopup";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_PEN_CN,
  LEDGER_HEADER_NAME_CARD_CN,
  LEDGER_HEADER_BALANCE_CARD_CN,
  LEDGER_HEADER_BALANCE_STACK_CN,
  LEDGER_HEADER_BALANCE_LABEL_CN,
  LEDGER_HEADER_TITLE_CN,
  LEDGER_HEADER_BALANCE_CN,
  LEDGER_HEADER_TDS_BALANCE_CARD_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_PILL_ROW_CN,
  LEDGER_TXN_PAGE_ROOT_CN,
} from "@/lib/ledgerHeaderChrome";
import { LedgerTxnScrollColumn } from "@/components/vouchers/LedgerTxnScrollColumn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useAuth } from "@/hooks/useAuth";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { AdjustBalancePillLabel } from "@/components/vouchers/AdjustBalancePillLabel";
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { HistoryDialog } from "../vouchers/HistoryDialog";
import { LinkAdvancesToVoucherDialog } from "../vouchers/LinkAdvancesToVoucherDialog";
import { LinkPaymentToTxnsDialog } from "../vouchers/LinkPaymentToTxnsDialog";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import { useMasterAccountFreezeDetailsChrome } from "@/hooks/useMasterAccountFreezeDetailsChrome";
import { useLedgerConfirmationSendPill } from "@/hooks/useLedgerConfirmationSendPill";
import { ledgerConfirmationPrintVisibleColumns } from "@/lib/reports/ledgerConfirmationShare";
import { STAFF_FREEZE_COLLECTION } from "@/lib/masterAccountFreeze/freezeAdapter";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { TransactionTableSortDropdown, type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";

import { useTransactionVisibleColumns, COLUMN_LABELS, useShowNotes } from "../vouchers/transactionColumnVisibility";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import {
  mapTransactionsForStaffSalaryDetailsView,
  mapTransactionsForStaffTaxPageView,
  type StaffLedgerSplitMode,
} from "@/lib/staffTaxDetailsLedger";
import {
  expandStaffLedgerTdsRows,
  summarizeStaffTdsBalances,
} from "@/lib/staffLedgerTdsView";
import { getReportVoucherTypeKey, ReportHeaderSummaryCards, reportTdsFilterSide, reportVoucherMatchesSummaryCard, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import {
  buildTaxNameById,
  ledgerTdsFooterColumnMenuKeys,
  mergeLedgerTdsVisibleColumnsWithPrefs,
  sortLedgerTdsRowsForDisplay,
} from "@/lib/partyLedgerTdsView";
import { getTaxTransactionAmounts } from "@/hooks/use-transactions";
import { getTaxOppositeAccountIdsFromVoucher } from "@/lib/taxOppositeAccountFilter";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { useStatementLedgerCheckModePaging } from "@/hooks/useStatementLedgerCheckModePaging";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { useLedgerDetailSessionMemory } from "@/hooks/useLedgerDetailSessionMemory";
import {
  ledgerDetailSessionStorageKey,
  readStaffTdsLedgerMode,
  writeLedgerDetailSessionSnapshot,
  writeStaffTdsLedgerMode,
  type LedgerDetailViewMode,
} from "@/lib/ledgerDetailSessionMemory";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { applyPaymentBillWiseLinkAllocations } from "@/lib/voucherActionsClient";
import { useTransactions } from "@/hooks/use-transactions";
import { useVouchers } from "@/hooks/useVouchers";
import { useMasterEntityLivePatch } from "@/hooks/useMasterEntityLivePatch";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useDateRangeTimestamps } from "@/hooks/useLedgerDetailDateRange";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPageSelectControl } from "@/hooks/useRowsPerPageSelect";
import { ROWS_PER_PAGE_OPTIONS_STAFF } from "@/lib/rowsPerPageSelect";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "../ui/combobox";
import NepaliCalendar from "../ui/nepali-calendar";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import { useEnsureEntityMinTxnsInScope } from "@/hooks/useEnsureEntityMinTxnsInScope";
import { ledgerMasterDateRangeLabel } from "@/lib/ledgerMasterDefaultView";
import type { BSDate } from "@/lib/bs-date";
import { Badge } from "../ui/badge";
import { toast } from "sonner";
import { isLocalOnlyMode } from "@/lib/localMode";
import {
  BillWiseAutoLinkPromptDialog,
  usePartyBillWiseAutoLinkPrompt,
} from "@/components/vouchers/BillWiseAutoLinkPrompt";

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
};

export function StaffDetails({
  staff: initialStaff,
  allGroups,
  allStaff,
  onStaffUpdated,
  onStaffDeleted,
  dateRange: parentDateRange,
  onDateRangeChange: parentOnDateRangeChange,
  onShowAll,
  isAllVouchersView,
  context,
  reportCardFilter,
  reportSummaryCards,
  onBack,
  onSelectStaff,
  transactions,
  userNames,
  /** Reports / dashboard txn-count: Print·Excel·Bill wise·Date·Chart footer (staff page Pay/Add hide). */
  mobileFooterVariant = "ledger",
  mobileReportStickyTitle,
  ledgerPresentationMode = "default",
  hideMobilePeriodLabelRow = false,
  onLedgerSplitModeChange,
  onRegisterClearDateRange,
}: {
  staff: Staff;
  allGroups?: StaffGroup[];
  allStaff?: Staff[];
  onStaffUpdated: (updatedStaff: Partial<Staff>) => void;
  onStaffDeleted: (deletedId: string) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  onShowAll?: () => void;
  isAllVouchersView?: boolean;
  context?: string;
  reportCardFilter?: string | null;
  reportSummaryCards?: ReportStatementSummaryCardData[];
  userNames?: Record<string, string>;
  onBack?: () => void;
  onSelectStaff?: (staffId: string) => void;
  transactions?: any[];
  mobileFooterVariant?: "ledger" | "report";
  mobileReportStickyTitle?: string;
  ledgerPresentationMode?: import("@/lib/nestedLedgerMasterEditPresentation").MasterEditPresentationMode;
  /** Mobile merged master-detail header already shows period label */
  hideMobilePeriodLabelRow?: boolean;
  /** tax | salary — parent updates "Staff tax/salary details" shell title */
  onLedgerSplitModeChange?: (mode: StaffLedgerSplitMode) => void;
  /** Top header X — same clear as search/calendar (date + search label) */
  onRegisterClearDateRange?: (clearFn: (() => void) | null) => void;
}) {
  const nestedLedgerNoteDialogShell =
    ledgerPresentationMode === "nested-ledger"
      ? nestedLedgerChildDialogShell("h-[95vh] w-full max-w-3xl flex flex-col")
      : { overlayClassName: undefined, className: "h-[95vh] w-full max-w-3xl flex flex-col" };
  const { company, companyId } = useCompany();
  const { dateSystem, formatDate, formatDateBS, formatCurrency, formatRunning } =
    useDate();
  const {
    vouchers,
    vouchersAll,
    processedStaff,
    processedAccounts,
    processedParties,
    processedExpenseAccounts,
    processedTaxes,
    journalAccountNames,
  } = useVouchers();
  const { user, customUser } = useAuth();
  const isLocalMode = isLocalOnlyMode();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [dateRange, setDateRange] = useState<DateRange | undefined>(parentDateRange);
  const [isDateChange, setIsDateChange] = useState(false);
  const parentFromMs = parentDateRange?.from?.getTime();
  const parentToMs = parentDateRange?.to?.getTime();
  useEffect(() => {
    setDateRange((prev) => {
      if (prev?.from?.getTime() === parentFromMs && prev?.to?.getTime() === parentToMs) return prev;
      return parentDateRange;
    });
  }, [parentFromMs, parentToMs, parentDateRange]);
  useFyLoadOnDateRangeChange(dateRange);

  const staff = useMemo(() => {
    if (!processedStaff) return initialStaff;
    return processedStaff.find(s => s.id === initialStaff.id) || initialStaff;
  }, [processedStaff, initialStaff]);
  // Auto link needs the complete staff ledger, not only the current date/filter view.
  const vouchersForAutoLink = vouchersAll?.length ? vouchersAll : vouchers;
  const isCompanyAdmin = React.useMemo(() => {
    const role = String(customUser?.role || "").trim();
    if (role === "CompanyAdmin" || role === "SuperAdmin" || role === "owner") return true;
    if (!company || !user) return false;
    if (company.ownerId && user.uid && company.ownerId === user.uid) return true;
    const ownerEmail = String((company as any).ownerEmail || "").trim().toLowerCase();
    const email = String(user.email || "").trim().toLowerCase();
    return !!ownerEmail && !!email && ownerEmail === email;
  }, [customUser?.role, company, user]);
  const handleStaffUpdated = useMasterEntityLivePatch<Staff>({
    collection: "staff",
    entityId: initialStaff.id,
    onUpdated: onStaffUpdated,
  });

  const staffFreezeEligible = !isAllVouchersView && staff.id !== "all";
  const buildStatementPdfRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const staffAdjustBalanceActions = staffFreezeEligible ? (
    <AddVoucherDialog
      defaultTab="adjustment"
      allowedTabs={["adjustment"]}
      defaultVoucherData={{
        defaultTab: "adjustment",
        adjustmentTarget: { id: staff.id, entityType: "staff", name: staff.name },
      }}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={readMasterAccountFrozen(staff)}
        className={cn(LEDGER_HEADER_PILL_CN, "!h-7 min-h-7 text-xs")}
        title="Adjust Balance"
      >
        <AdjustBalancePillLabel />
      </Button>
    </AddVoucherDialog>
  ) : null;

  const confirmationSendPill = useLedgerConfirmationSendPill({
    entity: staff,
    collection: "staff",
    eligible: staffFreezeEligible,
    onEntityUpdated: handleStaffUpdated,
    buildStatementPdfBlob: useCallback(async () => {
      if (!buildStatementPdfRef.current) return null;
      return buildStatementPdfRef.current();
    }, []),
  });

  const {
    blockNewTransactions: blockStaffNewTransactions,
    freezeOverlay: staffFreezeOverlay,
    closingBalanceRowActions: staffClosingBalanceRowActions,
    closingBalanceActions: staffClosingBalanceActions,
  } = useMasterAccountFreezeDetailsChrome({
    companyId,
    collection: STAFF_FREEZE_COLLECTION,
    entityId: staff.id,
    entity: staff,
    entityEligible: staffFreezeEligible,
    onEntityUpdated: handleStaffUpdated,
    adjustBalanceActions: staffAdjustBalanceActions,
    prependClosingBalanceActions: confirmationSendPill,
  });

  const staffHeaderAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(staff.fileUrl),
    [staff.fileUrl, staff.id]
  );

  const mobileSearchNames = useMemo(
    () => ({ ...journalAccountNames, ...(userNames || {}) }),
    [journalAccountNames, userNames]
  );

  const { balanceMode: balanceModeRaw, setBalanceMode } = useBalanceMode();
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceModeRaw === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && staff?.id
        ? ledgerDetailSessionStorageKey(companyId, "staff", staff.id, ledgerViewMode)
        : null,
    [companyId, staff?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  useEffect(() => {
    setCurrentPage(1);
  }, [isAllVouchersView]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [showNarration, setShowNarration] = useState(true);
  const { visibleColumns, handleColumnVisibilityChange } = useTransactionVisibleColumns();
  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  // Report mobile: list vs running-balance chart (Party report parity).
  const [mobileReportView, setMobileReportView] = useState<"list" | "chart">("list");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [historyVoucher, setHistoryVoucher] = useState<any>(null);
  const [linkAdvancesVoucher, setLinkAdvancesVoucher] = useState<any>(null);
  const [linkPaymentVoucher, setLinkPaymentVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "payment_in" | "payment_out" | "add_salary">(null);
  const [isEditStaffDialogOpen, setIsEditStaffDialogOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [isDateSearchMode, setIsDateSearchMode] = useState(false);
  const openingModalRef = useRef(false);

  // Desktop Calendar State
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [ledgerSplitMode, setLedgerSplitMode] = useState<StaffLedgerSplitMode>(() =>
    companyId && initialStaff?.id && readStaffTdsLedgerMode(companyId, initialStaff.id) ? "tax" : "salary"
  );
  const [showTdsLinkedTrxn, setShowTdsLinkedTrxn] = useState(true);
  const taxDetailsMode = ledgerSplitMode === "tax";
  /** Staff TDS balance page never offers bill-wise: force statement. */
  const balanceMode: typeof balanceModeRaw = taxDetailsMode ? "statement" : balanceModeRaw;
  /** TDS details hides books opening; salary = full account with taxable ADD-SAL. */
  const hideBooksOpeningForSplit = taxDetailsMode;
  
  // Local State for Calendar Buffer
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);

  const handleDateRangeChange = useCallback(
    (newRange: DateRange | undefined) => {
      setDateRange(newRange);
      parentOnDateRangeChange(newRange);
    },
    [parentOnDateRangeChange]
  );

  const {
    unapprovedOnly,
    toggleUnapprovedOnly,
    filterByUnapprovedOnly,
    onDateRangeChangeWithUnapprovedReset,
  } = useLedgerUnapprovedOnlyFilter({
    onDateRangeChange: handleDateRangeChange,
    setCurrentPage,
    setFilters,
    setActiveFilter,
  });

  const { fromMs: dateRangeFromMs, toMs: dateRangeToMs } = useDateRangeTimestamps(dateRange);
  const { selectValue: rowsPerPageSelectValue, onSelectValueChange: handleRowsPerPageChange } =
    useRowsPerPageSelectControl(rowsPerPage, setRowsPerPage, setCurrentPage, ROWS_PER_PAGE_OPTIONS_STAFF, "10");
  const handleBsDateRangeChange = useCallback(
    (range?: DateRange) => {
      onDateRangeChangeWithUnapprovedReset(range);
    },
    [onDateRangeChangeWithUnapprovedReset]
  );
  
  const transactionDates = useMemo(() => {
    const dates = new Set<number>();
    vouchers.forEach((v) => {
      if (
        v.staffId === staff.id ||
        (Array.isArray(v.entries) && v.entries.some((e: any) => e.accountId === staff.id))
      ) {
        const dateValue = v.date?.toDate
          ? v.date.toDate()
          : new Date(v.date);
        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
          dates.add(startOfDay(dateValue).getTime());
        }
      }
    });
    return Array.from(dates).map((d) => new Date(d));
  }, [vouchers, staff.id]);


  const {
    processedTransactions,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    openingBalanceOutstanding,
    openingBalanceLinkedVoucherNos,
  } = useTransactions(staff, 'staff', dateRange, undefined, allStaff, transactions, context, filters, undefined, undefined, userNames);


  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v);
  // Books opening + (date par filter) view-start: table first opening row se align
  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);
  const masterStaffOpening = Number(staff.openingBalance) || 0;
  const ledgerOpeningForRunning = useMemo(() => {
    if (Math.abs(openingBalanceForPeriod) < 1e-6 && Math.abs(masterStaffOpening) > 1e-6) return masterStaffOpening;
    return openingBalanceForPeriod;
  }, [openingBalanceForPeriod, masterStaffOpening]);

  const autoLinkPrompt = usePartyBillWiseAutoLinkPrompt({
    enabled: isCompanyAdmin && !!staff?.id && staff.id !== "all" && !(staff as any).isSystemAccount,
    companyId,
    userId: user?.uid || (isLocalMode && companyId ? "local" : null),
    ledgerId: staff?.id,
    ledgerName: staff?.name,
    ledgerKind: "staff",
    vouchers: vouchersForAutoLink,
    ledgerOpeningBalance: masterStaffOpening,
    openingBalanceOutstanding,
  });
  const openBillWiseAutoLink = useCallback(() => {
    if (autoLinkPrompt.proposal) {
      autoLinkPrompt.setOpen(true);
      return;
    }
    toast.info("No eligible unlinked bill-wise payment found for this staff ledger.");
  }, [autoLinkPrompt.proposal, autoLinkPrompt.setOpen]);

  const clearFilters = () => {
    handleDateRangeChange(undefined);
    setTempDateRange(undefined);
    setMobileSearchTerm("");
    setIsDateSearchMode(false);
    setFilters({});
  };

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const anyMobilePopupOpen =
    isMobile &&
    (!!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen || isNoteOpen || isEditStaffDialogOpen || !!historyVoucher || !!linkAdvancesVoucher || !!linkPaymentVoucher);

  const openModalInUrl = useCallback(() => {
    if (!isMobile || !pathname) return;
    persistPlModalParentQuery(searchParams.toString());
    const params = new URLSearchParams(searchParamsStringForModalClose(searchParams.toString()));
    params.set("modal", "1");
    params.set("modalts", String(Date.now()));
    router.push(`${pathname}?${params.toString()}`);
  }, [isMobile, pathname, searchParams, router]);

  const closeModalInUrl = useCallback(() => {
    if (!pathname) return;
    const raw = searchParamsStringAfterClosingModal(searchParams.toString());
    const params = new URLSearchParams(raw);
    params.delete("modal");
    params.delete("modalts");
    patchMasterDetailUrlAfterModalClose(params, { entityId: staff.id });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, staff.id]);

  const modalParam = searchParams.get("modal");
  const urlModalOpen = isMobile && modalParam === "1" && anyMobilePopupOpen;
  const closeUrlModal = useCallback(() => {
    setMobileFooterDialogOpen(null);
    setIsCalendarOpen(false);
    setIsVoucherDialogOpen(false);
    setSelectedVoucher(null);
    setIsNoteOpen(false);
    setIsEditStaffDialogOpen(false);
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

  const handleHistoryVoucher = useCallback((voucher: any) => {
    openingModalRef.current = true;
    setHistoryVoucher(voucher);
    openModalInUrl();
  }, [openModalInUrl]);

  const handleAddLink = useCallback((voucher: any) => {
    openingModalRef.current = true;
    const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
    if (isPaymentType) {
      setLinkPaymentVoucher(voucher);
    } else {
      setLinkAdvancesVoucher(voucher);
    }
    openModalInUrl();
  }, [openModalInUrl]);

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
    if (isEditStaffDialogOpen) {
      setIsEditStaffDialogOpen(false);
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
  }, [mobileFooterDialogOpen, isCalendarOpen, isVoucherDialogOpen, isNoteOpen, isEditStaffDialogOpen, historyVoucher, linkPaymentVoucher, linkAdvancesVoucher, closeModalInUrl, onBack]);

  // PC: preference; mobile: hamesha notes (includeNotesInTable)
  const displayTransactions = useMemo(
    () => {
      const base = includeNotesInTable ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note");
      if (context !== "report" || !reportCardFilter || reportTdsFilterSide(reportCardFilter)) return base;
      return base.filter((t: any) =>
        reportCardFilter.startsWith("summary:")
          ? reportVoucherMatchesSummaryCard(t, reportCardFilter.slice(8), "staff", staff.id)
          : getReportVoucherTypeKey(t, "staff", staff.id) === reportCardFilter
      );
    },
    [processedTransactions, includeNotesInTable, context, reportCardFilter, staff.id]
  );

  const taxNameById = useMemo(() => buildTaxNameById(processedTaxes), [processedTaxes]);

  const vouchersByIdForTds = useMemo(() => {
    const byId = new Map<string, Record<string, unknown>>();
    const allSource = vouchersAll?.length ? vouchersAll : vouchers;
    for (const v of allSource || []) {
      if (v?.id) byId.set(String(v.id), v as Record<string, unknown>);
    }
    for (const v of displayTransactions || []) {
      if (v?.id) byId.set(String(v.id), v as Record<string, unknown>);
    }
    return byId;
  }, [vouchers, vouchersAll, displayTransactions]);

  const staffTaxPageRows = useMemo(() => {
    let rows = mapTransactionsForStaffTaxPageView(
      Array.from(vouchersByIdForTds.values()),
      staff.id,
      processedTaxes || [],
      getTaxTransactionAmounts,
      getTaxOppositeAccountIdsFromVoucher
    );
    const range = dateRange ?? parentDateRange;
    if (range?.from || range?.to) {
      const fromMs = range.from ? startOfDay(range.from).getTime() : null;
      const toMs = range.to ? endOfDay(range.to).getTime() : null;
      rows = rows.filter((t) => {
        const d =
          parseFirestoreDateFieldToJsDate(t.date) ??
          parseFirestoreDateFieldToJsDate((t as any).createdAt);
        if (!d) return true;
        const ms = d.getTime();
        if (fromMs != null && ms < fromMs) return false;
        if (toMs != null && ms > toMs) return false;
        return true;
      });
    }
    return rows as Record<string, unknown>[];
  }, [
    vouchersByIdForTds,
    staff.id,
    processedTaxes,
    dateRange,
    parentDateRange,
  ]);

  const staffTdsExpandOptions = useMemo(
    () => ({
      staffId: staff.id,
      processedTaxes: processedTaxes || [],
      taxNameById,
      voucherById: vouchersByIdForTds,
      includeSettlements: showTdsLinkedTrxn,
    }),
    [staff.id, processedTaxes, taxNameById, vouchersByIdForTds, showTdsLinkedTrxn]
  );

  const staffTdsBalanceSummary = useMemo(
    () =>
      summarizeStaffTdsBalances(staffTaxPageRows, {
        ...staffTdsExpandOptions,
        includeSettlements: true,
      }),
    [staffTaxPageRows, staffTdsExpandOptions]
  );

  /** Show TDS card whenever staff has salary TDS history (even if fully settled). */
  const staffHasTdsHistory = useMemo(
    () =>
      expandStaffLedgerTdsRows(staffTaxPageRows, {
        ...staffTdsExpandOptions,
        includeSettlements: false,
      }).length > 0,
    [staffTaxPageRows, staffTdsExpandOptions]
  );

  const ledgerSourceTransactions = useMemo(() => {
    if (ledgerSplitMode === "salary") {
      return mapTransactionsForStaffSalaryDetailsView(
        displayTransactions,
        staff.id,
        processedTaxes || []
      );
    }
    return expandStaffLedgerTdsRows(staffTaxPageRows, staffTdsExpandOptions);
  }, [
    displayTransactions,
    ledgerSplitMode,
    staff.id,
    processedTaxes,
    staffTaxPageRows,
    staffTdsExpandOptions,
  ]);

  const mobileUnapprovedTxnCount = useMemo(
    () => countLedgerUnapprovedTransactions(ledgerSourceTransactions),
    [ledgerSourceTransactions]
  );

  const taxDetailsOpeningForRunning = hideBooksOpeningForSplit ? 0 : ledgerOpeningForRunning;
  const effectiveBalanceMode = taxDetailsMode ? "statement" : balanceMode;
  const canUseStaffTaxDetails = !isAllVouchersView && staff.id !== "all";

  const effectiveVisibleColumns = useMemo(() => {
    if (taxDetailsMode) {
      return mergeLedgerTdsVisibleColumnsWithPrefs(visibleColumns, true);
    }
    return {
      ...visibleColumns,
      tdsTaxable: false,
      tdsAmount: false,
      ...(effectiveBalanceMode === "bill_wise" ? { status: true } : {}),
    };
  }, [taxDetailsMode, visibleColumns, effectiveBalanceMode]);

  const openStaffLedgerDetails = useCallback(() => {
    setLedgerSplitMode("salary");
    if (companyId && staff?.id) writeStaffTdsLedgerMode(companyId, staff.id, false);
    setCurrentPage(1);
  }, [companyId, staff?.id, setCurrentPage]);

  const [tdsCardsOpen, setTdsCardsOpen] = useState(false);
  const [tdsCardsOpenM, setTdsCardsOpenM] = useState(false);
  const [showAllTds, setShowAllTds] = useShowAllTdsCards();
  const openStaffTdsLedgerDetails = useCallback(() => {
    setLedgerSplitMode("tax");
    if (companyId && staff?.id) writeStaffTdsLedgerMode(companyId, staff.id, true);
    setCurrentPage(1);
  }, [companyId, staff?.id, setCurrentPage]);

  useEffect(() => {
    if (!canUseStaffTaxDetails && ledgerSplitMode !== "salary") {
      setLedgerSplitMode("salary");
    }
  }, [canUseStaffTaxDetails, ledgerSplitMode, staff.id]);

  useEffect(() => {
    onLedgerSplitModeChange?.(ledgerSplitMode);
  }, [ledgerSplitMode, onLedgerSplitModeChange]);

  useEffect(() => {
    if (context === "report") {
      setLedgerSplitMode(reportTdsFilterSide(reportCardFilter) ? "tax" : "salary");
      setShowTdsLinkedTrxn(true);
      return;
    }
    setLedgerSplitMode(
      companyId && staff.id && readStaffTdsLedgerMode(companyId, staff.id) ? "tax" : "salary"
    );
    setShowTdsLinkedTrxn(true);
  }, [companyId, staff.id, context, reportCardFilter]);

  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const sortedTransactions = useMemo(() => {
    const base = filterByUnapprovedOnly(ledgerSourceTransactions);
    if (taxDetailsMode) {
      return sortLedgerTdsRowsForDisplay(base, sortBy, sortOrder);
    }
    return recomputeRunningBalanceTopToBottom(
      sortTransactionsWithFiscalMergeForCompany(
        base,
        "date",
        DEFAULT_TRANSACTION_SORT_ORDER,
        undefined,
        company
      ),
      taxDetailsOpeningForRunning
    );
  }, [
    ledgerSourceTransactions,
    filterByUnapprovedOnly,
    taxDetailsMode,
    sortBy,
    sortOrder,
    taxDetailsOpeningForRunning,
    company,
  ]);

  useEnsureEntityMinTxnsInScope({
    dateRange,
    entityId: staff?.id,
    entityKind: "staff",
    entityTxnCount: sortedTransactions.length,
    enabled: Boolean(staff?.id),
  });

  /**
   * Account Balance card — always staff salary account closing (never TDS row running balance).
   * TDS Balance card uses `staffTdsBalanceSummary` separately.
   */
  const headerClosingBalanceRaw = useMemo(() => {
    if (
      !dateRange?.from &&
      !dateRange?.to &&
      typeof closingBalance === "number" &&
      Number.isFinite(closingBalance)
    ) {
      return closingBalance;
    }
    if (!taxDetailsMode) {
      const list = sortedTransactions as any[];
      if (list.length > 0) {
        const last = list[list.length - 1];
        const bal = last?.balance ?? last?.runningBalance;
        if (typeof bal === "number" && Number.isFinite(bal)) return bal;
      }
    }
    return ledgerOpeningForRunning + (Number(periodDr) || 0) - (Number(periodCr) || 0);
  }, [
    dateRange?.from,
    dateRange?.to,
    closingBalance,
    taxDetailsMode,
    sortedTransactions,
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

  // Statement check mode + desktop tail paging (PartyDetails jaisa)
  const {
    statementCheck,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "staff",
    contextId: staff?.id,
    viewMode: effectiveBalanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions: sortedTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning: taxDetailsOpeningForRunning,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  /** Footer Closing Balance: TDS details → TDS net; else staff account closing. */
  const ledgerFooterClosingBalance = desktopPaginationMeta.closingForPage;

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "staff",
    contextId: staff?.id,
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

  const handlePrintStatement = () => {
    if (!company) return;
    // Match print with current table columns and note visibility.
    const printVisibleColumns = visibleColumns;
    openPrintDirect(
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
          title: `Staff Statement: ${staff.name}`,
          context: "staff",
          contextId: staff.id,
          dateSystem: dateSystem,
          dateRangeText: buildDateRangeText(),
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (staff as any).openingBalanceDate,
          openingBalanceNarration: staff.openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          userNames: userNames,
          billWise: false,
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: masterStaffOpening,
          ledgerShowBookOpeningRow: !hideBooksOpeningForSplit && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0),
          ledgerDateFilterActive: hasLedgerDateFilter,
          openingBalancePeriodStartDate: dateRange?.from,
          masterOpeningBalanceDate: (staff as any).openingBalanceDate,
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
        title: `Staff Statement: ${staff.name}`,
        context: "staff",
        contextId: staff.id,
        dateSystem: dateSystem,
        dateRangeText: buildDateRangeText(),
        vouchersCount: paginatedTransactions.length,
        openingBalance: desktopPaginationMeta.openingForPage,
        openingBalanceDate: (staff as any).openingBalanceDate,
        openingBalanceNarration: staff.openingBalanceNarration ?? null,
        transactions: paginatedTransactions,
        showNarration: showNarration,
        includeNotes: includeNotesInTable,
        visibleColumns: printVisibleColumns,
        userNames: userNames,
        billWise: false,
      },
      {
        paginatedTransactions,
        openingForPage: desktopPaginationMeta.openingForPage,
        periodDrForPage: desktopPaginationMeta.periodDrForPage,
        periodCrForPage: desktopPaginationMeta.periodCrForPage,
        closingForPage: desktopPaginationMeta.closingForPage,
        booksOpeningBalance: masterStaffOpening,
        ledgerShowBookOpeningRow: !hideBooksOpeningForSplit && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0),
        ledgerDateFilterActive: hasLedgerDateFilter,
        openingBalancePeriodStartDate: dateRange?.from,
        masterOpeningBalanceDate: (staff as any).openingBalanceDate,
        dateRange,
      }
    );
    return getPdfBlob(payload);
  }, [
    company,
    visibleColumns,
    staff,
    dateSystem,
    paginatedTransactions,
    desktopPaginationMeta,
    showNarration,
    includeNotesInTable,
    userNames,
    masterStaffOpening,
    hideBooksOpeningForSplit,
    rowsPerPage,
    hasLedgerDateFilter,
    dateRange,
    buildDateRangeText,
  ]);

  buildStatementPdfRef.current = buildStatementPdfBlob;

  const handlePrintBillWise = () => {
    if (!company) return;
    // Bill-wise print keeps Status column visible by design.
    const printVisibleColumns = { ...visibleColumns, status: true };
    openPrintDirect(
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
          title: `Bill Wise Staff Statement: ${staff.name}`,
          context: "staff",
          contextId: staff.id,
          dateSystem: dateSystem,
          dateRangeText: buildDateRangeText(),
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (staff as any).openingBalanceDate,
          openingBalanceNarration: staff.openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          userNames: userNames,
          billWise: true,
          openingBalanceOutstanding,
          openingBalanceLinkedVoucherNos,
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: masterStaffOpening,
          ledgerShowBookOpeningRow: !hideBooksOpeningForSplit && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0),
          ledgerDateFilterActive: hasLedgerDateFilter,
          openingBalancePeriodStartDate: dateRange?.from,
          masterOpeningBalanceDate: (staff as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  // Search box me date label dikhao, lekin TEXT filter mat lagao (FY pe 0 txn bug).
  // Clear date → search bhi clear (top X aur calendar dono sync).
  useEffect(() => {
    if (!isMobile) return;
    if (dateRange?.from) {
      const from = formatDate(dateRange.from);
      const to = dateRange.to ? formatDate(dateRange.to) : from;
      setMobileSearchTerm(from === to ? from : `${from} to ${to}`);
      setIsDateSearchMode(true);
    } else if (isDateSearchMode) {
      setMobileSearchTerm("");
      setIsDateSearchMode(false);
    }
  }, [dateRange, isMobile, formatDate, isDateSearchMode]);

  const clearDateRangeEverywhere = useCallback(() => {
    handleDateRangeChange(undefined);
    setMobileSearchTerm("");
    setIsDateSearchMode(false);
    setTempDateRange(undefined);
    setCurrentPage(1);
  }, [handleDateRangeChange]);

  useEffect(() => {
    onRegisterClearDateRange?.(clearDateRangeEverywhere);
    return () => onRegisterClearDateRange?.(null);
  }, [clearDateRangeEverywhere, onRegisterClearDateRange]);
  
    const handleNepaliSelect = (bsDate: BSDate, adDate: Date) => {
    if (!adDate) return;

    const normalizedAdDate = new Date(adDate.getFullYear(), adDate.getMonth(), adDate.getDate(), 12, 0, 0, 0); 
    const range = tempDateRange;
    let newRange: DateRange | undefined;
    
    if (!range?.from || (range.from && range.to)) {
      newRange = { from: normalizedAdDate, to: undefined };
    } else {
      if (normalizedAdDate < range.from) {
        newRange = { from: normalizedAdDate, to: range.from };
      } else {
        newRange = { from: range.from, to: normalizedAdDate };
      }
    }

    setTempDateRange(newRange);

    if (newRange.from && newRange.to) {
        handleDateRangeChange(newRange);
        setIsCalendarOpen(false);
        setIsDesktopCalendarOpen(false);
    }
  };
  
  const filteredMobileTransactions = useMemo(() => {
    // Date label search box me dikhe — dateRange already filters; text-match se FY pe 0 txn ho jata tha
    if (!mobileSearchTerm || isDateSearchMode) return sortedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();
    return sortedTransactions.filter(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "staff", staff.id).includes(lowerCaseSearch) ||
        formatDate(d).toLowerCase().includes(lowerCaseSearch) ||
        formatDateBS(d).toLowerCase().includes(lowerCaseSearch) ||
        String(t.total || t.amount || 0).toLowerCase().includes(lowerCaseSearch) ||
        String(t.debit).toLowerCase().includes(lowerCaseSearch) ||
        String(t.credit).toLowerCase().includes(lowerCaseSearch) ||
        String(debitCreditAmount).toLowerCase().includes(lowerCaseSearch) ||
        String(t.balance).toLowerCase().includes(lowerCaseSearch)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, isDateSearchMode, formatDate, formatDateBS, mobileSearchNames, staff.id]);
  const mobileTransactionsToShow = useMemo(() => {
    const list = filteredMobileTransactions;
    if (rowsPerPage <= 0) return list;
    const total = list.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return list.slice(start, Math.max(start, end));
  }, [filteredMobileTransactions, currentPage, rowsPerPage]);
  const mobilePagerEdgeCounts = useMemo(() => {
    const total = filteredMobileTransactions.length;
    if (rowsPerPage <= 0) return { before: 0, after: 0 };
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return { before: start, after: Math.max(0, total - end) };
  }, [filteredMobileTransactions.length, currentPage, rowsPerPage]);
  const mobilePaginationMeta = useMemo(() => {
    const list = filteredMobileTransactions as any[];
    if (rowsPerPage <= 0) {
      const pageDr = list.reduce((sum, t: any) => sum + (Number(t?.debit) || 0), 0);
      const pageCr = list.reduce((sum, t: any) => sum + (Number(t?.credit) || 0), 0);
      return {
        openingForPage: ledgerOpeningForRunning,
        periodDrForPage: pageDr,
        periodCrForPage: pageCr,
        closingForPage: ledgerOpeningForRunning + pageDr - pageCr,
      };
    }
    const total = list.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    const pageTransactions = list.slice(start, Math.max(start, end));
    const previousTx = start > 0 ? list[start - 1] : null;
    const previousRunningBalance =
      previousTx != null
        ? (typeof previousTx.balance === "number"
            ? previousTx.balance
            : typeof previousTx.runningBalance === "number"
              ? previousTx.runningBalance
              : undefined)
        : undefined;
    const openingForPage =
      typeof previousRunningBalance === "number" && !Number.isNaN(previousRunningBalance)
        ? previousRunningBalance
        : ledgerOpeningForRunning;
    const periodDrForPage = pageTransactions.reduce((sum, t: any) => sum + (Number(t?.debit) || 0), 0);
    const periodCrForPage = pageTransactions.reduce((sum, t: any) => sum + (Number(t?.credit) || 0), 0);
    return {
      openingForPage,
      periodDrForPage,
      periodCrForPage,
      closingForPage: openingForPage + periodDrForPage - periodCrForPage,
    };
  }, [filteredMobileTransactions, rowsPerPage, currentPage, ledgerOpeningForRunning]);

  useEffect(() => {
    const total = rowsPerPage > 0 ? Math.ceil(filteredMobileTransactions.length / rowsPerPage) : 1;
    const safeTotal = Math.max(1, total);
    setCurrentPage((prev) => {
      const next = Math.min(Math.max(1, prev), safeTotal);
      return next === prev ? prev : next;
    });
  }, [dateRangeFromMs, dateRangeToMs, filteredMobileTransactions.length, rowsPerPage]);

  const dateRangeLabel = useMemo(
    () => ledgerMasterDateRangeLabel(dateRange, buildDateRangeText()),
    [dateRange, dateSystem, formatDateBS, formatDate]
  );

  // Report sticky header title — dashboard Add Salary / all-vouchers drill-down.
  const reportStickyTitle = useMemo(() => {
    if (mobileReportStickyTitle) return mobileReportStickyTitle;
    if (context === "add_salary") return "Add Salary";
    return "Report";
  }, [mobileReportStickyTitle, context]);

  const handleExcelLedger = useCallback(() => {
    const rows = filteredMobileTransactions.map((t: Record<string, unknown>) => {
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
        Balance: `${Math.abs(closingBalance).toFixed(2)} ${closingBalance >= 0 ? "Dr" : "Cr"}`,
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet([...rows, {}, ...summaryRows] as Record<string, unknown>[]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger");
    const safeName = (staff.name || "staff").replace(/[/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeName}_ledger.xlsx`);
  }, [
    filteredMobileTransactions,
    formatDate,
    formatDateBS,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
    staff.name,
  ]);

  const accountNamesMap = useMemo(
    () => ({
      ...Object.fromEntries((processedAccounts || []).map((a: any) => [a.id, a.accountName])),
      ...Object.fromEntries((processedParties || []).map((p: any) => [p.id, p.name])),
      ...Object.fromEntries((processedStaff || []).map((s: any) => [s.id, s.name])),
      ...Object.fromEntries((processedExpenseAccounts || []).map((e: any) => [e.id, e.name])),
      ...Object.fromEntries((processedTaxes || []).map((t: any) => [t.id, t.name])),
    }),
    [processedAccounts, processedParties, processedStaff, processedExpenseAccounts, processedTaxes]
  );

  const renderMobileView = () => {
    const isReportMobileChrome = mobileFooterVariant === "report";
    // All-vouchers report: staff combobox hide — sirf search + date summary.
    const hideReportStaffPicker = isReportMobileChrome && (isAllVouchersView || staff.id === "all");
    // All Salary / all-vouchers: sirf ek title — "Add Salary · All Salary Vouchers" duplicate na ho.
    const reportHeaderTitleOnly = isReportMobileChrome && (isAllVouchersView || staff.id === "all");
    const handleMobilePrint = balanceMode === "bill_wise" ? handlePrintBillWise : handlePrintStatement;
    const balanceLabel = headerClosingBalance >= 0 ? "To Receive" : "To Pay";

    const mobileEntityTxnToolbar = (
      <MobileEntityTxnToolbarRow placement="belowPager">
        {!hideReportStaffPicker && allStaff && allStaff.length > 0 && (
          <MobileEntityTxnToolbarPicker>
            <Combobox
              options={[
                ...allStaff.map((s) => ({
                  value: s.id,
                  label: s.name,
                })),
                ...(onShowAll ? [{ value: "all-vouchers", label: "All Vouchers", isSpecial: true }] : []),
              ]}
              value={isAllVouchersView ? "all-vouchers" : (staff?.id || "")}
              onChange={(value) => {
                if (value === "all-vouchers") {
                  onShowAll?.();
                  return;
                }
                if (value === "add-new") {
                  router.push("/staff");
                  return;
                }
                if (value && value !== staff.id) {
                  if (onSelectStaff) onSelectStaff(value);
                  else router.push(`/staff?selected=${value}`);
                }
              }}
              placeholder="Select staff"
              addNewLabel="+ Add New Staff"
              maxVisibleOptions={15}
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
              const next = e.target.value;
              setMobileSearchTerm(next);
              setCurrentPage(1);
              if (!next) {
                // Search clear = date clear (top X aur search sync)
                if (isDateSearchMode || dateRange?.from) clearDateRangeEverywhere();
                else setIsDateSearchMode(false);
              }
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
                  <span className="shrink-0 select-none text-muted-foreground/55" aria-hidden>·</span>
                  <span
                    className={cn("min-w-0 truncate text-sm font-medium", masterDetailBalanceToneClass(headerClosingBalance))}
                    title={staff.name}
                  >
                    {staff.name}
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
        <div className="flex flex-shrink-0 items-center gap-1 border-b px-2 py-0.5" {...mdcNoEdgeSwipeCapture}>
          <Button variant="ghost" size="icon" onClick={handleMobileBack} className="h-6 w-6 flex-shrink-0" aria-label="Back">
            <ArrowLeft className="h-3 w-3" />
          </Button>
          <h1 className="shrink-0 text-sm font-bold text-muted-foreground">Staff details</h1>
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={staff.name}>
            {staff.name}
          </span>
        </div>
      ) : null}
      <MobileDetailSummaryCollapsible>
      {!hideMobilePeriodLabelRow ? (
        <div className="flex flex-shrink-0 items-center justify-center gap-1 border-b px-2 py-0.5">
          <span className="text-[11px] font-medium leading-tight text-muted-foreground">
            {dateRangeLabel}
          </span>
          {dateRange != null &&
            (dateRange.from != null || dateRange.to != null) && (
              <button
                type="button"
                onClick={clearDateRangeEverywhere}
                className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                aria-label="Clear date filter"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
        </div>
      ) : null}
      {/* Account Balance + TDS Balance on same gray row (no separate TDS band / linked-trxn toggle on mobile) */}
      <div
        className={cn(mdc.mobileTxnBalanceRow, "w-full")}
        {...mdcMobileTxnBalanceRowData}
        {...(canUseStaffTaxDetails && staffHasTdsHistory && !isReportMobileChrome
          ? { "data-pl-staff-balance-with-tds": "" }
          : {})}
      >
        {canUseStaffTaxDetails && staffHasTdsHistory && !isReportMobileChrome ? (
          <Popover open={tdsCardsOpenM} onOpenChange={(o) => { if (o && !taxDetailsMode) { openStaffTdsLedgerDetails(); return; } setTdsCardsOpenM(o); }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-pl-staff-tds-inline=""
                className="flex shrink-0 flex-col items-start gap-0 text-left cursor-pointer"
                aria-pressed={taxDetailsMode}
              >
                <span className="text-[10px] font-semibold tracking-wide text-muted-foreground leading-none">
                  TDS Balance
                </span>
                {staffTdsBalanceSummary.purchaseTds > 0 ? (
                  <span className="text-xs font-bold text-red-600 leading-tight">
                    {formatCurrency(-staffTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                  </span>
                ) : staffTdsBalanceSummary.saleTds > 0 ? (
                  <span className="text-xs font-bold text-green-600 leading-tight">
                    {formatCurrency(staffTdsBalanceSummary.saleTds, { showDrCr: true })}
                  </span>
                ) : (
                  <span className="text-xs font-bold text-muted-foreground leading-tight">Settled</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <div className="flex flex-col gap-2">
                {([
                  ["Sale TDS Balance", staffTdsBalanceSummary.saleTds, "text-green-600"],
                  ["Pur TDS Balance", 0, "text-muted-foreground"],
                  ["Add Salary TDS Balance", -staffTdsBalanceSummary.purchaseTds, "text-red-600"],
                ] as const)
                  .filter(([, v]) => v !== 0 || showAllTds)
                  .map(([label, v, tone]) => (
                    <button
                      key={label}
                      type="button"
                      className={cn("flex flex-col items-start rounded-md border px-3 py-1.5 text-left", taxDetailsMode && "ring-2 ring-primary")}
                      aria-pressed={taxDetailsMode}
                      onClick={() => {
                        openStaffTdsLedgerDetails();
                        setTdsCardsOpenM(false);
                      }}
                    >
                      <span className="text-[10px] font-semibold text-muted-foreground leading-none">{label}</span>
                      <span className={cn("text-sm font-bold leading-tight", tone)}>{formatCurrency(v, { showDrCr: true })}</span>
                    </button>
                  ))}
                {staffTdsBalanceSummary.saleTds <= 0 && staffTdsBalanceSummary.purchaseTds <= 0 && !showAllTds ? (
                  <button
                    type="button"
                    className={cn("flex flex-col items-start rounded-md border px-3 py-1.5 text-left", taxDetailsMode && "ring-2 ring-primary")}
                    onClick={() => {
                      openStaffTdsLedgerDetails();
                      setTdsCardsOpenM(false);
                    }}
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground leading-none">TDS Balance</span>
                    <span className="text-sm font-bold text-muted-foreground leading-tight">Settled</span>
                  </button>
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
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer text-center"
          onClick={openStaffLedgerDetails}
          aria-pressed={!taxDetailsMode}
        >
          <p
            className={cn(
              mdc.mobileTxnBalanceText2xl,
              headerClosingBalance >= 0 ? "text-green-600" : "text-red-600"
            )}
          >
            {headerClosingBalance === 0 ? (
              "Settled Up"
            ) : (
              <>
                <span className="text-[0.6em]">{balanceLabel}</span>{" "}
                {formatCurrency(Math.abs(headerClosingBalance), { noSuffix: true })}
              </>
            )}
          </p>
        </button>
      </div>
      </MobileDetailSummaryCollapsible>
      {/* scroll-touch + inline style for APK/WebView touch scroll */}
      <div
        className={mobileTxnScrollBodyClass(isReportMobileChrome)}
      >
        <div className="pb-2">
        {isReportMobileChrome && mobileReportView === "chart" ? (
          <RunningBalanceFullChart
            transactions={filteredMobileTransactions}
            openingBalance={openingBalanceForPeriod}
          />
        ) : (
        <MasterAccountFreezeTxnShell
          className="min-h-[8rem]"
          overlay={staffFreezeOverlay}
        >
        <TransactionsTable
          key={`staff-mobile-${staff.id}-${ledgerSplitMode}-${currentPage}-${rowsPerPage}`}
          transactions={mobileTransactionsToShow}
          context="staff"
          contextId={staff.id}
          forceBalanceMode={taxDetailsMode ? "statement" : undefined}
          transactionCardSearchHighlight={mobileSearchTerm}
          openingBalance={hideBooksOpeningForSplit ? 0 : mobilePaginationMeta.openingForPage}
          booksOpeningBalance={hideBooksOpeningForSplit ? 0 : masterStaffOpening}
          ledgerDateFilterActive={hasLedgerDateFilter}
          ledgerShowBookOpeningRow={!hideBooksOpeningForSplit && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0)}
          hideLedgerOpeningRows={hideBooksOpeningForSplit}
          openingBalancePeriodStartDate={dateRange?.from}
          dateRange={dateRange}
          openingBalanceOutstanding={openingBalanceOutstanding}
          openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
          openingBalanceNarration={staff.openingBalanceNarration}
          openingBalanceAttachmentUrls={staff.documentFileUrls}
          openingBalanceDate={(staff as any).openingBalanceDate}
          openingBalanceActions={undefined}
          showNarration={showNarration}
          visibleColumns={effectiveVisibleColumns}
          journalAccountNames={{}}
          accountNames={accountNamesMap}
          periodDr={mobilePaginationMeta.periodDrForPage}
          periodCr={mobilePaginationMeta.periodCrForPage}
          closingBalance={mobilePaginationMeta.closingForPage}
          closingBalanceLabel={taxDetailsMode ? "TDS Closing Balance" : undefined}
          onRowClick={handleEditVoucher}
          onHistoryVoucher={handleHistoryVoucher}
          onAddLink={handleAddLink}
          userNames={userNames}
          filters={filters}
          setFilters={setFilters}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          isAllVouchersView={isAllVouchersView}
          hideDebitColumn={false}
          hideCreditColumn={false}
          scrollOnlyTransactions
          closingBalanceRowActions={taxDetailsMode ? undefined : staffClosingBalanceRowActions}
          closingBalanceActions={taxDetailsMode ? undefined : staffClosingBalanceActions}
          {...statementCheck.tableProps}
        />
        </MasterAccountFreezeTxnShell>
        )}
        </div>
      </div>
      {isReportMobileChrome && mobileReportView === "list" ? (
        <MobileTransactionsPager
          className={mdc.reportTxnPagerOutside}
          currentPage={currentPage}
          totalItems={filteredMobileTransactions.length}
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
          totalItems={filteredMobileTransactions.length}
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
      <>
        <ReportMobileLedgerFooter
          onPrint={handleMobilePrint}
          onExcel={handleExcelLedger}
          onDateOpen={() => {
            openingModalRef.current = true;
            setIsCalendarOpen(true);
            openModalInUrl();
          }}
          balanceMode={balanceMode}
          onBalanceModeToggle={taxDetailsMode ? undefined : () => setBalanceMode(balanceMode === "bill_wise" ? "statement" : "bill_wise")}
          mobileView={mobileReportView}
          onViewToggle={() => setMobileReportView((v) => (v === "list" ? "chart" : "list"))}
        />
        <Drawer
          open={isCalendarOpen}
          onOpenChange={(open: boolean) => {
            setIsCalendarOpen(open);
            if (open) {
              openingModalRef.current = true;
              openModalInUrl();
            } else {
              closeModalInUrl();
            }
          }}
        >
          <DrawerContent>
            <DrawerHeader className="p-4 text-left">
              <DrawerTitle>Select Date Range</DrawerTitle>
              <MobileDialogDescription>
                Select a starting and ending date for the transaction list.
              </MobileDialogDescription>
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
                        handleDateRangeChange(r);
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
                          handleDateRangeChange(r);
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
                        handleDateRangeChange({ from: adDate, to: undefined });
                      } else if (adDate < range.from) {
                        handleDateRangeChange({ from: adDate, to: range.from });
                        setIsCalendarOpen(false);
                      } else {
                        handleDateRangeChange({ from: range.from, to: adDate });
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
      </>
    ) : (
      <div
        className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur z-50 flex items-stretch justify-around"
        data-pl-mobile-ledger-action-footer=""
      >
        {/* Mobile: ek button — Statement ↔ Bill wise toggle (Party ledger jaisa). */}
        {!taxDetailsMode ? (
        <Button
          type="button"
          className={cn(
            "flex-1 min-h-0 min-w-0 rounded-md text-sm font-semibold",
            balanceMode === "bill_wise"
              ? "bg-orange-600 hover:bg-orange-700 text-white"
              : "bg-violet-600 hover:bg-violet-700 text-white"
          )}
          onClick={() => setBalanceMode(balanceMode === "bill_wise" ? "statement" : "bill_wise")}
        >
          {balanceMode === "bill_wise" ? "Statement" : "Bill wise"}
        </Button>
        ) : null}
        <AddVoucherDialog
          defaultTab="payment_out"
          defaultVoucherData={{ payeeType: "staff", staffId: staff.id }}
          isOpen={mobileFooterDialogOpen === "payment_out"}
          onOpenChange={(open: boolean) => {
            if (open) {
              openingModalRef.current = true;
              setMobileFooterDialogOpen("payment_out");
              openModalInUrl();
            } else if (mobileFooterDialogOpen === "payment_out") {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
        >
          <Button className="flex-1 min-h-0 min-w-0 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">
            Pay Salary
          </Button>
        </AddVoucherDialog>
        <AddVoucherDialog
          defaultTab="add_salary"
          isOpen={mobileFooterDialogOpen === "add_salary"}
          onOpenChange={(open: boolean) => {
            if (open) {
              openingModalRef.current = true;
              setMobileFooterDialogOpen("add_salary");
              openModalInUrl();
            } else if (mobileFooterDialogOpen === "add_salary") {
              setMobileFooterDialogOpen(null);
              closeModalInUrl();
            }
          }}
        >
          <Button className="flex-1 min-h-0 min-w-0 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">
            Add Salary
          </Button>
        </AddVoucherDialog>
        <MobileEntityLedgerFooterPrintButton onClick={handleMobilePrint} />
        <Drawer
          open={isCalendarOpen}
          onOpenChange={(open: boolean) => {
            setIsCalendarOpen(open);
            if (open) {
              openingModalRef.current = true;
              openModalInUrl();
            } else {
              closeModalInUrl();
            }
          }}
        >
          <DrawerTrigger asChild>
            <Button className="flex-1 min-h-0 min-w-0 rounded-md text-sm font-semibold px-1 bg-pink-600 hover:bg-pink-700 text-white">
              <CalendarIcon className="h-4 w-4 shrink-0" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="p-4 text-left">
              <DrawerTitle>Select Date Range</DrawerTitle>
              <MobileDialogDescription>
                Select a starting and ending date for the transaction list.
              </MobileDialogDescription>
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
                        handleDateRangeChange(r);
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
                          handleDateRangeChange(r);
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
                        handleDateRangeChange({ from: adDate, to: undefined });
                      } else if (adDate < range.from) {
                        handleDateRangeChange({ from: adDate, to: range.from });
                        setIsCalendarOpen(false);
                      } else {
                        handleDateRangeChange({ from: range.from, to: adDate });
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
    </>
    );
  };

  const renderDesktopView = () => (
    <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
      {/* Header: identity + pills — Party-style single row */}
      {/* TABLE AREA - flex layout so table footer (Total / Closing Balance) stays visible */}
      <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
        <div className={LEDGER_HEADER_OUTER_ROW_CN}>
          <div className={LEDGER_HEADER_IDENTITY_CN}>
            {isMobile && onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                <ArrowLeft className="h-3 w-3" />
              </Button>
            )}
            <div className={LEDGER_HEADER_AVATAR_CN}>
              <EntityFileAttachmentHover
                fileUrl={staffHeaderAttachmentUrl}
                triggerClassName="inline-flex rounded-full"
              >
                <ResolvedEntityAvatar
                  className="h-12 w-12 text-lg flex-shrink-0"
                  src={staffHeaderAttachmentUrl ?? undefined}
                  alt={staff.name}
                  fallbackSlot={<StaffAccountFallbackIcon staff={staff} variant="detail" className="h-6 w-6" />}
                />
              </EntityFileAttachmentHover>
              <EditStaffDialog
                staff={staff}
                allGroups={allGroups}
                onStaffUpdated={handleStaffUpdated}
                onStaffDeleted={() => onStaffDeleted(staff.id)}
              >
                {/* All-vouchers mode safety: disable edit for aggregate view. */}
                <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit" disabled={Boolean(isAllVouchersView)}>
                  <Pencil className="h-3 w-3" />
                </button>
              </EditStaffDialog>
            </div>
            <div className={LEDGER_HEADER_NAME_CARD_CN}>
              <h2 className={LEDGER_HEADER_TITLE_CN} title={staff.name}>{staff.name}</h2>
            </div>
            {reportSummaryCards?.length ? (
              <ReportHeaderSummaryCards cards={reportSummaryCards} />
            ) : (
            <>
            <button
              type="button"
              className={cn(LEDGER_HEADER_BALANCE_CARD_CN, "cursor-pointer")}
              onClick={openStaffLedgerDetails}
              aria-pressed={!taxDetailsMode}
              title="Staff account balance details"
            >
              <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Account Balance</span>
                <div className={cn(LEDGER_HEADER_BALANCE_CN, headerClosingBalance < 0 ? "text-red-600" : "text-green-600")}>
                  {formatCurrency(headerClosingBalance, { showDrCr: true })}
                </div>
              </div>
            </button>
            {canUseStaffTaxDetails && staffHasTdsHistory ? (
              <Popover open={tdsCardsOpen} onOpenChange={(o) => { if (o && !taxDetailsMode) { openStaffTdsLedgerDetails(); return; } setTdsCardsOpen(o); }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "cursor-pointer text-left")}
                    aria-pressed={taxDetailsMode}
                    title="TDS Balance details"
                  >
                    <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                      <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>TDS Balance</span>
                      {staffTdsBalanceSummary.purchaseTds > 0 ? (
                        <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-red-600")}>
                          {formatCurrency(-staffTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                        </div>
                      ) : staffTdsBalanceSummary.saleTds > 0 ? (
                        <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-green-600")}>
                          {formatCurrency(staffTdsBalanceSummary.saleTds, { showDrCr: true })}
                        </div>
                      ) : (
                        <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-muted-foreground")}>Settled</div>
                      )}
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="flex gap-2">
                    {(staffTdsBalanceSummary.saleTds > 0 || showAllTds) ? (
                      <button
                        type="button"
                        className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "cursor-pointer text-left", taxDetailsMode && "ring-2 ring-primary")}
                        onClick={() => {
                          openStaffTdsLedgerDetails();
                          setTdsCardsOpen(false);
                        }}
                        aria-pressed={taxDetailsMode}
                        title="Sale TDS Balance details"
                      >
                        <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                          <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Sale TDS Balance</span>
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-green-600")}>
                            {formatCurrency(staffTdsBalanceSummary.saleTds, { showDrCr: true })}
                          </div>
                        </div>
                      </button>
                    ) : null}
                    {showAllTds ? (
                      <div className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "text-left")}>
                        <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                          <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Pur TDS Balance</span>
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-muted-foreground")}>{formatCurrency(0, { showDrCr: true })}</div>
                        </div>
                      </div>
                    ) : null}
                    {(staffTdsBalanceSummary.purchaseTds > 0 || showAllTds) ? (
                      <button
                        type="button"
                        className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "cursor-pointer text-left", staffTdsBalanceSummary.purchaseTds > 0 && "order-first", taxDetailsMode && "ring-2 ring-primary")}
                        onClick={() => {
                          openStaffTdsLedgerDetails();
                          setTdsCardsOpen(false);
                        }}
                        aria-pressed={taxDetailsMode}
                        title="Add Salary TDS Balance details"
                      >
                        <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                          <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Add Salary TDS Balance</span>
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-red-600")}>
                            {formatCurrency(-staffTdsBalanceSummary.purchaseTds, { showDrCr: true })}
                          </div>
                        </div>
                      </button>
                    ) : null}
                    {staffTdsBalanceSummary.saleTds <= 0 && staffTdsBalanceSummary.purchaseTds <= 0 && !showAllTds ? (
                      <button
                        type="button"
                        className={cn(LEDGER_HEADER_TDS_BALANCE_CARD_CN, "cursor-pointer text-left", taxDetailsMode && "ring-2 ring-primary")}
                        onClick={() => {
                          openStaffTdsLedgerDetails();
                          setTdsCardsOpen(false);
                        }}
                        aria-pressed={taxDetailsMode}
                      >
                        <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                          <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>TDS Balance</span>
                          <div className={cn(LEDGER_HEADER_BALANCE_CN, "text-muted-foreground")}>Settled</div>
                        </div>
                      </button>
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
          <div className={LEDGER_HEADER_PILL_ROW_CN}>
                <ReconciliationAccountButton accountId={staff.id} />
              <LedgerHeaderPrintButton variant="outline" onClick={balanceMode === "bill_wise" ? handlePrintBillWise : handlePrintStatement} />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
            {(dateSystem === 'BS' || dateSystem === 'Both') && (
              <BsDatePicker
                isRange
                masterLedgerDatePresets
                ledgerPaginationReset={ledgerPaginationReset}
                valueAD={dateRange}
                onChangeAD={handleBsDateRangeChange}
                transactionDates={transactionDates}
                className={cn("w-auto", LEDGER_HEADER_PILL_CN)}
              />
            )}
            {(dateSystem === 'AD' || dateSystem === 'Both') && (
              <Popover open={isDesktopCalendarOpen} onOpenChange={setIsDesktopCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="date"
                    variant="chromePill"
                    className={cn("justify-start text-left font-normal px-2 w-auto", LEDGER_HEADER_PILL_CN, !dateRange && "text-muted-foreground")}
                    data-theme-detail="date-range"
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
                          handleDateRangeChange(r);
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
            {!taxDetailsMode && (
              <LedgerViewModePills
                value={balanceMode}
                onChange={setBalanceMode}
                options={[
                  { value: "statement", label: "Statement" },
                  { value: "bill_wise", label: "Bill wise" },
                ]}
              />
            )}
            <Button
              variant="chromePill"
              size="sm"
              onClick={() => setIsNoteOpen(true)}
              className={LEDGER_HEADER_PILL_CN}
              data-theme-detail="add-note"
            >
              <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
              Add Note
            </Button>
            {taxDetailsMode ? (
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
              <Button variant="chromePill" size="sm" onClick={onShowAll} className={LEDGER_HEADER_PILL_CN}>
                All Vouchers
              </Button>
            )}
            
            {isCompanyAdmin && !taxDetailsMode ? (
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
                <>
                <MasterAccountFreezeTxnShell
                  overlay={staffFreezeOverlay}
                >
                <TransactionsTable
                  key={`staff-${staff.id}-${ledgerSplitMode}-${currentPage}-${rowsPerPage}`}
                  transactions={paginatedTransactions}
                  context="staff"
                  contextId={staff.id}
                  forceBalanceMode={taxDetailsMode ? "statement" : undefined}
                  openingBalance={hideBooksOpeningForSplit ? 0 : desktopPaginationMeta.openingForPage}
                  booksOpeningBalance={hideBooksOpeningForSplit ? 0 : masterStaffOpening}
                  ledgerDateFilterActive={hasLedgerDateFilter}
                  ledgerShowBookOpeningRow={!hideBooksOpeningForSplit && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0)}
                  hideLedgerOpeningRows={hideBooksOpeningForSplit}
                  openingBalancePeriodStartDate={dateRange?.from}
                  dateRange={dateRange}
                  openingBalanceOutstanding={openingBalanceOutstanding}
                  openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
                  openingBalanceNarration={staff.openingBalanceNarration}
                  openingBalanceAttachmentUrls={staff.documentFileUrls}
                  openingBalanceDate={(staff as any).openingBalanceDate}
                  openingBalanceActions={
                    !taxDetailsMode ? (
                    <EditStaffDialog
                      staff={staff}
                      allGroups={allGroups}
                      allStaff={allStaff}
                      onStaffUpdated={handleStaffUpdated}
                      onStaffDeleted={() => onStaffDeleted(staff.id)}
                      hasTransactions={processedTransactions.length > 0}
                    >
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </EditStaffDialog>
                    ) : null
                  }
                  showNarration={showNarration}
                  visibleColumns={effectiveVisibleColumns}
                  journalAccountNames={{}}
                  accountNames={accountNamesMap}
                  periodDr={desktopPaginationMeta.periodDrForPage}
                  periodCr={desktopPaginationMeta.periodCrForPage}
                  closingBalance={ledgerFooterClosingBalance}
                  closingBalanceLabel={taxDetailsMode ? "TDS Closing Balance" : undefined}
                  onRowClick={handleEditVoucher}
                  onHistoryVoucher={handleHistoryVoucher}
                  onAddLink={handleAddLink}
                  userNames={userNames}
                  filters={filters}
                  setFilters={setFilters}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  isAllVouchersView={isAllVouchersView}
                  hideDebitColumn={false}
                  hideCreditColumn={false}
                  scrollOnlyTransactions
                  closingBalanceRowActions={taxDetailsMode ? undefined : staffClosingBalanceRowActions}
                  closingBalanceActions={taxDetailsMode ? undefined : staffClosingBalanceActions}
                  {...statementCheck.tableProps}
                />
                </MasterAccountFreezeTxnShell>
                </>
        }
        footer={
      <LedgerDesktopFooter
        left={
          <>
              <LedgerFooterCheckboxPill
                id="show-narration-staff"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
            <LedgerFooterColumnsMenu ledgerPresentationMode={ledgerPresentationMode}>
                <DropdownMenuContent align="start" className="w-52 p-2">
                {(taxDetailsMode
                  ? ledgerTdsFooterColumnMenuKeys(true)
                  : (Object.keys(COLUMN_LABELS) as TransactionColumnKey[]).filter(
                      (key) => !["tdsTaxable", "tdsAmount"].includes(key)
                    )
                )
                  .filter((key) => key !== "status" || effectiveBalanceMode === "bill_wise")
                  .map((key) => {
                  const isStatusInStatement = key === "status" && effectiveBalanceMode === "statement";
                  const isStatusInBillWise = key === "status" && effectiveBalanceMode === "bill_wise";
                  const isStatusLocked = isStatusInStatement || isStatusInBillWise;
                  const columnChecked =
                    isStatusInStatement
                      ? false
                      : isStatusInBillWise
                        ? true
                        : effectiveVisibleColumns[key] !== false;
                  return (
                    <DropdownMenuItem
                      key={key}
                      onSelect={(e) => e.preventDefault()}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        id={`col-${key}-staff`}
                        checked={columnChecked}
                        disabled={isStatusLocked}
                        onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                      />
                      <label htmlFor={`col-${key}-staff`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                        {COLUMN_LABELS[key]}
                      </label>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-staff"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
            <StatementCheckModeFooterControls
              idPrefix="staff"
              enabled={statementCheck.checkModeEnabled}
              onEnabledChange={statementCheck.setCheckModeEnabled}
              viewMode={effectiveBalanceMode === "bill_wise" ? "bill_wise" : "statement"}
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
        viewMode={effectiveBalanceMode === "bill_wise" ? "bill_wise" : "statement"}
        currentPage={currentPage}
        totalPages={totalPages}
        setCurrentPage={setCurrentPage}
        rowsPerPageSelectValue={rowsPerPageSelectValue}
        onRowsPerPageChange={handleRowsPerPageChange}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS_STAFF}
        beforeCount={desktopPaginationMeta.beforeCount}
        afterCount={desktopPaginationMeta.afterCount}
        totalCount={sortedTransactions.length}
        ledgerPresentationMode={ledgerPresentationMode}
      />
        }
      />
    </div>
  );

  return (
    <>
      {staff?.id && <EntityAlarmPopup context="Staff" entityId={staff.id} />}
      {companyId && (user?.uid || isLocalMode) ? (
        <BillWiseAutoLinkPromptDialog
          open={autoLinkPrompt.open}
          onOpenChange={autoLinkPrompt.setOpen}
          proposal={autoLinkPrompt.proposal}
          companyId={companyId}
          userId={user?.uid || "local"}
          vouchers={vouchersForAutoLink}
        />
      ) : null}
      <div className={cn("flex flex-col min-h-0 overflow-hidden", isMobile ? "flex-1" : "h-full")}>
        {isMobile ? renderMobileView() : renderDesktopView()}
      </div>
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent
          overlayClassName={nestedLedgerNoteDialogShell.overlayClassName}
          className={nestedLedgerNoteDialogShell.className}
        >
          <DialogHeader>
            <DialogTitle>Add a New Note for {staff.name}</DialogTitle>
            <DialogDescription>
              Record a new note associated with this staff member.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <CreateNoteForm
              onVoucherAction={() => {
                onStaffUpdated({});
                setIsNoteOpen(false);
              }}
              initialContext="Staff"
              initialEntityId={staff.id}
              compactFooter
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open: boolean) => {
          setIsVoucherDialogOpen(open);
          if (!open) {
            setSelectedVoucher(null);
            if (isMobile) closeModalInUrl();
          }
        }}
        voucher={selectedVoucher}
        onVoucherCreated={() => {
          setSelectedVoucher(null);
          onStaffUpdated({});
        }}
        onVoucherAction={(status) => {
          if (status === "saved") onStaffUpdated({});
          setSelectedVoucher(null);
        }}
        ledgerEntityId={staff?.id}
        ledgerOpeningBalanceOutstanding={openingBalanceOutstanding}
        ledgerBooksOpeningBalanceSigned={ledgerOpeningForRunning}
      />
      <HistoryDialog
        voucher={historyVoucher}
        isOpen={!!historyVoucher}
        onOpenChange={(open) => !open && setHistoryVoucher(null)}
        onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)}
      />
      {linkAdvancesVoucher && (
        <LinkAdvancesToVoucherDialog
          isOpen={!!linkAdvancesVoucher}
          onOpenChange={(open: boolean) => !open && setLinkAdvancesVoucher(null)}
          mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
          targetVoucherId={linkAdvancesVoucher.id}
          targetPartyId={linkAdvancesVoucher.partyId ?? ""}
          targetPartyName={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.name ?? "Party"}
          partyOpeningBalance={processedParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.openingBalance ?? 0}
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
          partyName={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.name ?? "Party"}
          receivedAmount={Number(linkPaymentVoucher.amount ?? linkPaymentVoucher.total ?? 0)}
          existingAllocations={Array.isArray(linkPaymentVoucher.allocations) ? linkPaymentVoucher.allocations : []}
          paymentInId={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
          paymentOutId={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.id : undefined}
          paymentInVoucherNumber={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
          paymentInDate={["payment_in", "direct_income"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
          paymentOutVoucherNumber={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.voucherNumber : undefined}
          paymentOutDate={["payment_out", "direct_expense"].includes(linkPaymentVoucher.type) ? linkPaymentVoucher.date : undefined}
          partyOpeningBalance={processedParties?.find((p) => p.id === linkPaymentVoucher.partyId)?.openingBalance ?? 0}
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

    
