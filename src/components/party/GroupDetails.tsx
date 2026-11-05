
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import * as React from "react";
import { toast } from "sonner";
import { openPrintDirect, companyFiscalFieldsForPrint } from "@/lib/printDirect";
import { applyLedgerPageToPrintPayload } from "@/lib/ledgerPagePrint";
import { resolveGroupBooksOpeningBalance } from "@/lib/ledgerOpeningBalanceDisplay";
import type { Party, Group } from "@/components/party/types";
import {
  IC_COMPANY_PARTY_GROUP_ID,
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";
import { isPartySystemGroupId } from "@/lib/partySystemGroups";
import {
  collectPartyGroupScopeBucketIds,
  filterPartiesForPartyGroupScope,
} from "@/lib/partyGroupScope";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LedgerViewModePills, LedgerViewModeToggleButton } from "@/components/ui/LedgerViewModePills";
import { LedgerTdsFilterPill } from "@/components/ui/LedgerTdsFilterPill";
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
  Users,
  Calendar as CalendarIcon,
  FilePlus,
  XCircle,
  MoreVertical,
  ArrowLeft,
  Scroll,
  DollarSign,
  ChevronDown,
  Columns3,
  Filter,
  Search,
  Pencil,
} from "lucide-react";
import { TransactionsTable, type TransactionColumnKey } from "../vouchers/TransactionsTable";
import { TransactionTableSortDropdown, type TransactionSortBy, type TransactionSortOrder } from "@/components/vouchers/TransactionTableSortDropdown";
import { LedgerFooterColumnsMenu } from "@/components/vouchers/LedgerFooterColumnsMenu";
import { LedgerDesktopFooter } from "@/components/vouchers/LedgerDesktopFooter";

import { COLUMN_LABELS, useShowNotes, useTransactionVisibleColumns } from "../vouchers/transactionColumnVisibility";
import { StatementCheckModeFooterControls } from "@/components/vouchers/StatementCheckModeFooterControls";
import { LedgerFooterCheckboxPill } from "@/components/vouchers/ledgerFooterChrome";
import { useStatementLedgerCheckModePaging } from "@/hooks/useStatementLedgerCheckModePaging";
import { useLedgerUnapprovedOnlyFilter } from "@/hooks/useLedgerUnapprovedOnlyFilter";
import { useLedgerDetailSessionMemory } from "@/hooks/useLedgerDetailSessionMemory";
import {
  ledgerDetailSessionStorageKey,
  writeLedgerDetailSessionSnapshot,
  type LedgerDetailViewMode,
} from "@/lib/ledgerDetailSessionMemory";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerHeaderReminderButton } from "@/components/vouchers/LedgerHeaderReminderButton";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";
import {
  sortTransactionsWithFiscalMergeForCompany,
  recomputeRunningBalanceTopToBottom,
  DEFAULT_TRANSACTION_SORT_ORDER,
} from "@/lib/transactionSort";
import { getTransactionQuickSearchHaystack } from "@/components/vouchers/transactionTableShared";
import {
  buildTaxNameById,
  expandPartyLedgerTdsRows,
  ledgerTdsFooterColumnMenuKeys,
  mergeLedgerTdsVisibleColumnsWithPrefs,
  sortLedgerTdsRowsForDisplay,
} from "@/lib/partyLedgerTdsView";
import { mergeLedgerUserDisplayNameMaps } from "@/lib/ledgerUserColumnDisplay";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "@/lib/utils";
import { ReportHeaderSummaryCards, type ReportStatementSummaryCardData } from "@/components/reports/ReportStatementSummaryCards";
import { MobileDetailSummaryCollapsible } from "@/components/layout/MobileDetailSummaryCollapsible";
import { mdc, mdcMobileTxnBalanceRowData, mdcMobileTxnDateRowData, mobileTxnScrollBodyClass } from "@/lib/mobileDetailChrome";
import { ledgerMasterDateRangeLabel } from "@/lib/ledgerMasterDefaultView";
import {
  MobileEntityTxnToolbarPicker,
  MobileEntityTxnToolbarRow,
  MobileEntityTxnToolbarSearch,
  MobileEntityTxnToolbarUnapprovedBadge,
} from "@/components/entity/MobileEntityTxnToolbarRow";
import { countLedgerUnapprovedTransactions } from "@/lib/ledgerPendingApproval";
import { MobileEntityLedgerFooterPrintButton } from "@/components/entity/MobileEntityLedgerFooterPrintButton";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  patchMasterDetailUrlAfterModalClose,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import { startOfDay, endOfDay, format } from "date-fns";
import { formatVoucherEntryTimeLocal } from "@/lib/voucherDateNormalize";
import AdCalendar from "../ui/ad-calendar";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useDate } from "@/hooks/useDate";
import { useBalanceMode } from "@/hooks/useBalanceMode";
import BsDatePicker from "@/components/ui/BsDatePicker";
import {
  LEDGER_HEADER_RIBBON_WRAP_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_BOX_CN,
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
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { useCompany } from "@/hooks/useCompany";
import { useFyLoadOnDateRangeChange } from "@/hooks/useFyLoadOnDateRangeChange";
import { useAuth } from "@/hooks/useAuth";
import { useLedgerPaginationReset } from "@/hooks/useLedgerPaginationReset";
import { useRowsPerPage } from "@/hooks/useRowsPerPage";
import { useSyncTempDateRangeFromProp } from "@/hooks/useLedgerDetailDateRange";
import { ROWS_PER_PAGE_OPTIONS_DEFAULT } from "@/lib/rowsPerPageSelect";
import { EditGroupDialog } from "./EditGroupDialog";
import { EditPartyDialog } from "./EditPartyDialog";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { GroupDetailNestedNameHeader } from "@/components/entity/GroupDetailNestedNameHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { CreateNoteForm } from "../vouchers/CreateNoteForm";
import { Checkbox } from "../ui/checkbox";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { AdjustBalancePillLabel } from "../vouchers/AdjustBalancePillLabel";
import { ShareForReconcilingDetailButtons } from "../reconciliation/ShareForReconcilingDetailButtons";
import { HistoryDialog } from "../vouchers/HistoryDialog";
import { LinkAdvancesToVoucherDialog } from "../vouchers/LinkAdvancesToVoucherDialog";
import { LinkPaymentToTxnsDialog } from "../vouchers/LinkPaymentToTxnsDialog";
import { useTransactions } from "@/hooks/use-transactions";
import { useVouchers } from "@/hooks/useVouchers";
import { useMasterEntityLivePatch } from "@/hooks/useMasterEntityLivePatch";
import { useMasterAccountFreezeDetailsChrome } from "@/hooks/useMasterAccountFreezeDetailsChrome";
import { MasterAccountFreezeTxnShell } from "@/components/masterAccountFreeze/MasterAccountFreezeTxnShell";
import { PARTY_FREEZE_COLLECTION } from "@/lib/masterAccountFreeze/partyFreezeAdapter";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { Input } from "../ui/input";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useUrlModalBack } from "@/contexts/DialogBackHandlerContext";
import { Combobox } from "../ui/combobox";
import NepaliCalendar from "../ui/nepali-calendar";
import { MasterLedgerDateRangePresetRow } from "@/components/ui/MasterLedgerDateRangePresetRow";
import type { BSDate } from "@/lib/bs-date";
import { Badge } from "../ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { doc, query, collection, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { batchFetchUserDisplayNamesFromFirestore } from "@/lib/batchFetchUserDisplayNames";
import { firestore } from "@/lib/firebase";
import { applyPaymentBillWiseLinkAllocations } from "@/lib/voucherActionsClient";
import { StaffGroupDetails } from "../staff/StaffGroupDetails";
import type { StaffGroup, Staff } from "../staff/types";
import { AccountGroupDetails } from "../bank-cash/AccountGroupDetails";
import type { AccountGroup, Account } from "../bank-cash/types";
import { TaxGroupDetails } from "../tax/TaxGroupDetails";
import type { TaxGroup, Tax } from "../tax/types";
import { ExpenseGroupDetails } from "../expenses/ExpenseGroupDetails";
import type { ExpenseGroup, ExpenseAccount } from "../expenses/types";
import { ItemGroupDetails } from "../items/ItemGroupDetails";
import type { ItemGroup, Item } from "../items/types";
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
import { MobileTransactionsPager } from "@/components/vouchers/MobileTransactionsPager";
import { getLocalAuthUser } from "@/lib/localApiClient";
import { isLocalOnlyMode } from "@/lib/localMode";

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
    if (t.type === "note") return true; // Notes have no payment status; always show
    // Journal/Adjustment/Contra/Inter Company — bill-wise status nahi; filter se hide na hon
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

export function GroupDetails({
  group: initialGroup,
  allGroups,
  allParties,
  onGroupUpdated,
  onGroupDeleted,
  onPartyUpdated,
  dateRange,
  onDateRangeChange,
  userNames,
  onBack,
  icGroupPeerCompanyFilterId = null,
  icGroupMemberFilterId = null,
  groupMemberFilterId = null,
  hideMobilePeriodLabelRow = false,
  reportSummaryCards,
}: {
  group: Group;
  allGroups: Group[];
  allParties: Party[];
  onGroupUpdated: () => void;
  onGroupDeleted: () => void;
  onPartyUpdated: (patch?: Partial<Party>) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (dateRange: DateRange | undefined) => void;
  userNames: Record<string, string>;
  onBack?: () => void;
  icGroupPeerCompanyFilterId?: string | null;
  icGroupMemberFilterId?: string | null;
  groupMemberFilterId?: string | null;
  hideMobilePeriodLabelRow?: boolean;
  reportSummaryCards?: ReportStatementSummaryCardData[];
}) {
  const { dateSystem, formatDateBS, formatDate, formatCurrency } = useDate();
  const { balanceMode, setBalanceMode } = useBalanceMode();
  const { company, companyId } = useCompany();
  useFyLoadOnDateRangeChange(dateRange);
  const group = useMemo(
    () => allGroups.find((row) => row.id === initialGroup.id) || initialGroup,
    [allGroups, initialGroup]
  );
  const {
    vouchers,
    vouchersAll,
    processedParties,
    processedAccounts,
    processedExpenseAccounts,
    processedAccountGroups,
    processedExpenseGroups,
    processedTaxGroups,
    processedStaffGroups,
    processedTaxes,
    processedStaff,
    processedItems,
    processedItemGroups,
    journalAccountNames,
  } = useVouchers();
  const router = useRouter();
  const [reminderOpen, setReminderOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const [rowsPerPage, setRowsPerPage] = useRowsPerPage(10);
  const [currentPage, setCurrentPage] = useState(1);
  const ledgerPaginationReset = useLedgerPaginationReset(setRowsPerPage, setCurrentPage);
  const ledgerViewMode: LedgerDetailViewMode =
    balanceMode === "bill_wise" ? "bill_wise" : "statement";
  const ledgerSessionKey = useMemo(
    () =>
      companyId && group?.id
        ? ledgerDetailSessionStorageKey(companyId, "group", group.id, ledgerViewMode)
        : null,
    [companyId, group?.id, ledgerViewMode]
  );
  useEffect(() => {
    setCurrentPage(1);
  }, [ledgerViewMode]);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteEntityId, setNoteEntityId] = useState<string | null>(null);
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
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [historyVoucher, setHistoryVoucher] = useState<any>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(dateRange);
  // dateRange object har render par naya ref ho sakta hai — sirf from/to timestamps (infinite loop avoid).
  const dateRangeFromMs = dateRange?.from?.getTime();
  const dateRangeToMs = dateRange?.to?.getTime();
  const [mobileSearchTerm, setMobileSearchTerm] = useState("");
  const [isDateSearchMode, setIsDateSearchMode] = useState(false);
  const [mobileFooterDialogOpen, setMobileFooterDialogOpen] = useState<null | "sale" | "purchase">(null);
  const openingModalRef = useRef(false);

  // Radix Select: value list me na ho to ref/setState loop — sirf maujood option strings.
  const rowsPerPageSelectValue = useMemo(() => {
    if (rowsPerPage === 0) return "0";
    if ((ROWS_PER_PAGE_OPTIONS_DEFAULT as readonly number[]).includes(rowsPerPage)) return `${rowsPerPage}`;
    return "10";
  }, [rowsPerPage]);
  const handleRowsPerPageChange = useCallback(
    (value: string) => {
      setRowsPerPage(Number(value) || 0);
      setCurrentPage(1);
    },
    [setRowsPerPage, setCurrentPage]
  );

  useSyncTempDateRangeFromProp(dateRange, setTempDateRange);

  // Determine group type
  const isAutoSyntheticPartyGroup =
    group.id === IC_COMPANY_PARTY_GROUP_ID || isPartySystemGroupId(group.id);

  const groupType = useMemo(() => {
    if ((group as any).groupType) return (group as any).groupType;
    // Check if it's a tax group
    if (processedTaxGroups.some(tg => tg.id === group.id)) return 'tax';
    // Check if it's a staff group
    if (processedStaffGroups.some(sg => sg.id === group.id)) return 'staff';
    // Check if it's an account group
    if (processedAccountGroups.some(ag => ag.id === group.id)) return 'account';
    // Check if it's an expense group
    if (processedExpenseGroups.some(eg => eg.id === group.id)) return 'expense';
    // Default to party group
    return 'party';
  }, [group, processedTaxGroups, processedStaffGroups, processedAccountGroups, processedExpenseGroups]);

  const partiesInGroup = useMemo(() => {
    if (group.id === IC_COMPANY_PARTY_GROUP_ID) return allParties;
    if (groupType === "party") {
      return filterPartiesForPartyGroupScope(group.id, allParties, allGroups);
    }
    return [];
  }, [allParties, allGroups, group.id, groupType]);

  const selectedMemberParty = useMemo(() => {
    if (!groupMemberFilterId || group.id === IC_COMPANY_PARTY_GROUP_ID) return null;
    return partiesInGroup.find((party) => party.id === groupMemberFilterId) ?? null;
  }, [groupMemberFilterId, partiesInGroup, group.id]);

  const icHeaderPeerCompany = useMemo(() => {
    if (group.id !== IC_COMPANY_PARTY_GROUP_ID || !icGroupPeerCompanyFilterId) return null;
    return partiesInGroup.find((party) => party.id === icGroupPeerCompanyFilterId) ?? null;
  }, [group.id, icGroupPeerCompanyFilterId, partiesInGroup]);

  const icHeaderMemberAccount = useMemo(() => {
    if (group.id !== IC_COMPANY_PARTY_GROUP_ID || !icGroupMemberFilterId) return null;
    const peerMembers = icHeaderPeerCompany?.icMemberParties ?? [];
    return (
      peerMembers.find((member) => member.id === icGroupMemberFilterId) ??
      partiesInGroup.find((party) => party.id === icGroupMemberFilterId) ??
      null
    );
  }, [group.id, icGroupMemberFilterId, icHeaderPeerCompany, partiesInGroup]);

  const headerIdentityParty = selectedMemberParty ?? icHeaderMemberAccount ?? icHeaderPeerCompany ?? null;

  const selectedMemberAttachmentUrl = useMemo(
    () => trimEntityFileUrlForPreview(headerIdentityParty?.fileUrl),
    [headerIdentityParty?.fileUrl, headerIdentityParty?.id]
  );

  const childGroups = useMemo(() => {
    if (groupType === "party") {
      const scopeIds = collectPartyGroupScopeBucketIds(group.id, allGroups);
      return allGroups.filter((g) => scopeIds.has(g.id) && g.id !== group.id);
    }
    return allGroups.filter((g) => (g as { parentId?: string }).parentId === group.id);
  }, [allGroups, group.id, groupType]);

  // Get all accounts (bank accounts, expense accounts) that belong to this group or its child groups
  const accountsInGroup = useMemo(() => {
    const groupIds = new Set([group.id, ...childGroups.map(g => g.id)]);
    
    // Handle different group types
    if (groupType === 'tax') {
      // For tax groups, get taxes that belong to this group
      return processedTaxes.filter((tax) => tax.groupId === group.id);
    }
    
    if (groupType === 'staff') {
      // For staff groups, get staff that belong to this group
      return processedStaff.filter((staff) => staff.groupId === group.id);
    }
    
    if (groupType === 'account') {
      // For account groups, get accounts that belong to this group
      return processedAccounts.filter((acc) => acc.groupId === group.id);
    }
    
    if (groupType === 'expense') {
      // For expense groups, get expense accounts that belong to this group
      return processedExpenseAccounts.filter((acc) => acc.groupId === group.id);
    }
    
    if (groupType === 'item') {
      // For item groups, get items that belong to this group
      return processedItems.filter((item) => item.groupId === group.id);
    }
    
    // For party groups, use the existing logic
    // Get account groups (bank/cash groups) that belong to this party group or its child groups
    const accountGroupIds = processedAccountGroups
      .filter(ag => {
        const parentId = (ag as any).parentId;
        return parentId && groupIds.has(parentId);
      })
      .map(ag => ag.id);
    
    // Get expense groups (income/expense groups) that belong to this party group or its child groups
    const expenseGroupIds = processedExpenseGroups
      .filter(eg => {
        const parentId = (eg as any).parentId;
        return parentId && groupIds.has(parentId);
      })
      .map(eg => eg.id);
    
    // Get tax groups that belong to this party group or its child groups
    const taxGroupIds = processedTaxGroups
      .filter(tg => {
        const parentId = (tg as any).parentId;
        return parentId && groupIds.has(parentId);
      })
      .map(tg => tg.id);
    
    // Get staff groups that belong to this party group or its child groups
    const staffGroupIds = processedStaffGroups
      .filter(sg => {
        const parentId = (sg as any).parentId;
        return parentId && groupIds.has(parentId);
      })
      .map(sg => sg.id);
    
    // Get bank accounts that belong to those account groups
    const bankAccounts = processedAccounts.filter((acc) => 
      acc.groupId && accountGroupIds.includes(acc.groupId)
    );
    
    // Get expense accounts that belong to those expense groups
    const expenseAccounts = processedExpenseAccounts.filter((acc) => 
      acc.groupId && expenseGroupIds.includes(acc.groupId)
    );
    
    // Get taxes that belong to those tax groups
    const taxesInGroup = processedTaxes.filter((tax) => 
      tax.groupId && taxGroupIds.includes(tax.groupId)
    );
    
    // Get staff that belong to those staff groups
    const staffInGroup = processedStaff.filter((staff) => 
      staff.groupId && staffGroupIds.includes(staff.groupId)
    );
    
    return [...bankAccounts, ...expenseAccounts, ...taxesInGroup, ...staffInGroup];
  }, [group, groupType, childGroups, processedAccounts, processedExpenseAccounts, processedAccountGroups, processedExpenseGroups, processedTaxGroups, processedStaffGroups, processedTaxes, processedStaff, processedItems]);

  // Get expense group IDs that belong to this group (for transaction filtering)
  const expenseGroupIdsInGroup = useMemo(() => {
    const groupIds = new Set([group.id, ...childGroups.map(g => g.id)]);
    return processedExpenseGroups
      .filter(eg => {
        const parentId = (eg as any).parentId;
        return parentId && groupIds.has(parentId);
      })
      .map(eg => eg.id);
  }, [group, childGroups, processedExpenseGroups]);

  // Combine parties and accounts for the group
  const allItemsInGroup = useMemo(() => {
    if (group.id === IC_COMPANY_PARTY_GROUP_ID) {
      let companies = partiesInGroup;
      if (icGroupPeerCompanyFilterId) {
        companies = companies.filter((row) => row.id === icGroupPeerCompanyFilterId);
      }
      const icLedgerMembers = companies.flatMap((row) => {
        const members = (row as Party).icMemberParties;
        const list = members?.length ? members : [row];
        if (icGroupMemberFilterId) {
          return list.filter((member) => member.id === icGroupMemberFilterId);
        }
        return list;
      });
      return [...icLedgerMembers, ...accountsInGroup];
    }
    let parties = partiesInGroup;
    if (groupMemberFilterId) {
      parties = parties.filter((p) => p.id === groupMemberFilterId);
    }
    return [...parties, ...accountsInGroup];
  }, [
    group.id,
    partiesInGroup,
    accountsInGroup,
    icGroupPeerCompanyFilterId,
    icGroupMemberFilterId,
    groupMemberFilterId,
  ]);

  const isFilterActive =
    dateRange !== undefined || Object.values(filters).some((v) => v);
  /** Party ledger jaisa dated opening row: filter lagne par range-from dikhao. */
  const hasLedgerDateFilter = Boolean(dateRange?.from != null || dateRange?.to != null);

  // For staff groups, use the group's balance directly if no date range is set
  // This ensures consistency with the list view
  const shouldUseGroupBalance = !dateRange && groupType === 'staff' && group.balance !== undefined;
  
  // Maintain local userNames state that merges with prop
  const [localFetchedUserNames, setLocalFetchedUserNames] = useState<Record<string, string>>({});
  const { user, customUser } = useAuth();
  const isLocalMode = isLocalOnlyMode();

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
  }, [isLocalMode, companyId, (company as { adminUsername?: string })?.adminUsername]);
  
  // Merge prop userNames with locally fetched userNames
  // Merge: recurring "Auto" jaise voucher naam Firestore fetch se overwrite na hon
  const mergedUserNames = useMemo(() => mergeLedgerUserDisplayNameMaps(userNames || {}, localFetchedUserNames), [userNames, localFetchedUserNames]);

  const mobileSearchNames = useMemo(
    () => ({ ...journalAccountNames, ...mergedUserNames }),
    [journalAccountNames, mergedUserNames]
  );
  
  // useTransactions ko har render par naya entity object mat do — sirf group/items badle tab.
  const groupTransactionEntity = useMemo(
    () => ({ ...group, items: allItemsInGroup, expenseGroupIds: expenseGroupIdsInGroup }),
    [group, allItemsInGroup, expenseGroupIdsInGroup]
  );

  const {
    openingBalanceForPeriod,
    processedTransactions,
    periodDr,
    periodCr,
    closingBalance: calculatedClosingBalance,
    openingBalanceOutstanding,
    openingBalanceLinkedVoucherNos,
  } = useTransactions(
    groupTransactionEntity,
    "group",
    dateRange,
    undefined,
    allParties,
    undefined,
    undefined,
    filters,
    undefined,
    undefined,
    mergedUserNames
  );
  
  // User ids stable key — processedTransactions naya array ref par effect loop na chale.
  const transactionUserIdsKey = useMemo(() => {
    if (!processedTransactions?.length) return "";
    return [...new Set(processedTransactions.map((t: any) => t.userId).filter(Boolean) as string[])].sort().join(",");
  }, [processedTransactions]);

  // Fetch missing user names directly from Firestore and store in local state
  useEffect(() => {
    if (!transactionUserIdsKey) return;
    if (isLocalMode) return;
    
    const uids = new Set(transactionUserIdsKey.split(",").filter(Boolean));
    
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
      setLocalFetchedUserNames((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [uid, name] of Object.entries(fetched)) {
          if (next[uid] !== name) {
            next[uid] = name;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [transactionUserIdsKey, userNames, isLocalMode, localFetchedUserNames]);

  // Use group balance if no date range, otherwise use calculated balance
  const closingBalance = shouldUseGroupBalance ? (group.balance || 0) : calculatedClosingBalance;

  const adjustBalanceTargetParty = icHeaderMemberAccount ?? selectedMemberParty ?? null;
  const canShowAdjustBalance =
    groupType === "party" &&
    (group.id === IC_COMPANY_PARTY_GROUP_ID || Boolean(adjustBalanceTargetParty));
  const adjustBalanceTarget = adjustBalanceTargetParty
    ? {
        id: adjustBalanceTargetParty.id,
        entityType: "party" as const,
        name: icHeaderMemberAccount
          ? interCompanyClearingAccountDisplayName(icHeaderMemberAccount)
          : adjustBalanceTargetParty.name,
      }
    : undefined;
  const adjustBalanceClosingActions = canShowAdjustBalance ? (
    <>
    <ShareForReconcilingDetailButtons accountId={icHeaderMemberAccount ? "" : adjustBalanceTarget?.id ?? ""} />
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
        className={cn(LEDGER_HEADER_PILL_CN, "!h-[27px] min-h-[27px] text-xs")}
        title="Adjust Balance"
      >
        <AdjustBalancePillLabel />
      </Button>
    </AddVoucherDialog>
    </>
  ) : null;

  const liveFreezeTargetParty = useMemo(() => {
    if (!adjustBalanceTargetParty) return null;
    return (
      processedParties.find((party) => party.id === adjustBalanceTargetParty.id) ??
      adjustBalanceTargetParty
    );
  }, [adjustBalanceTargetParty, processedParties]);

  const handleFreezeTargetPartyUpdated = useMasterEntityLivePatch<Party>({
    collection: "parties",
    entityId: liveFreezeTargetParty?.id ?? "",
    onUpdated: onPartyUpdated,
  });

  const memberAdjustBalanceActions =
    liveFreezeTargetParty && adjustBalanceTarget ? (
      <>
      <ShareForReconcilingDetailButtons accountId={icHeaderMemberAccount ? "" : adjustBalanceTarget.id} />
      <AddVoucherDialog
        defaultTab="adjustment"
        allowedTabs={["adjustment"]}
        defaultVoucherData={{
          defaultTab: "adjustment",
          adjustmentTarget: adjustBalanceTarget,
        }}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={readMasterAccountFrozen(liveFreezeTargetParty)}
          className={cn(LEDGER_HEADER_PILL_CN, "!h-[27px] min-h-[27px] text-xs")}
          title="Adjust Balance"
        >
          <AdjustBalancePillLabel />
        </Button>
      </AddVoucherDialog>
      </>
    ) : null;

  const {
    freezeOverlay: memberFreezeOverlay,
    closingBalanceRowActions: memberClosingBalanceRowActions,
    closingBalanceActions: memberClosingBalanceActions,
    blockNewTransactions: blockMemberNewTransactions,
  } = useMasterAccountFreezeDetailsChrome({
    companyId,
    collection: PARTY_FREEZE_COLLECTION,
    entityId: liveFreezeTargetParty?.id ?? "",
    entity: liveFreezeTargetParty ?? { id: "", isFrozen: false },
    entityEligible: groupType === "party" && Boolean(liveFreezeTargetParty),
    onEntityUpdated: handleFreezeTargetPartyUpdated,
    adjustBalanceActions: memberAdjustBalanceActions,
  });

  const tableClosingBalanceRowActions =
    liveFreezeTargetParty && groupType === "party"
      ? memberClosingBalanceRowActions
      : adjustBalanceClosingActions;
  const tableClosingBalanceActions =
    liveFreezeTargetParty && groupType === "party" ? memberClosingBalanceActions : null;

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

  const handleEditVoucher = (voucher: any) => {
    openingModalRef.current = true;
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    setIsVoucherDialogOpen(true);
  };

  const handleHistoryVoucher = (voucher: any) => {
    openingModalRef.current = true;
    setHistoryVoucher(voucher);
  };

  const [linkAdvancesVoucher, setLinkAdvancesVoucher] = useState<any>(null);
  const [linkPaymentVoucher, setLinkPaymentVoucher] = useState<any>(null);

  const handleDeleteVoucher = (voucher: any) => {
    openingModalRef.current = true;
    setSelectedVoucher(voucher);
    if (ledgerSessionKey && voucher?.id) {
      writeLedgerDetailSessionSnapshot(ledgerSessionKey, {
        page: currentPage,
        openVoucherId: String(voucher.id),
      });
    }
    setIsVoucherDialogOpen(true);
  };

  useEffect(() => {
    const savedState = sessionStorage.getItem("showNarration");
    setShowNarration(savedState !== "false");
  }, []);

  const anyMobilePopupOpen = isMobile && (
    !!mobileFooterDialogOpen || isCalendarOpen || isVoucherDialogOpen || isNoteOpen || !!historyVoucher || !!linkAdvancesVoucher || !!linkPaymentVoucher
  );
  const openModalInUrl = useCallback(() => {
    if (!isMobile || !pathname) return;
    persistPlModalParentQuery(searchParams.toString());
    const params = new URLSearchParams(searchParamsStringForModalClose(searchParams.toString()));
    params.set("modal", "1");
    router.push(`${pathname}?${params.toString()}`);
  }, [isMobile, pathname, searchParams, router]);
  const closeModalInUrl = useCallback(() => {
    if (!pathname) return;
    const raw = searchParamsStringAfterClosingModal(searchParams.toString());
    const params = new URLSearchParams(raw);
    params.delete("modal");
    params.delete("modalts");
    // Party groups tab: `view=groups` + `selected` dono pakke â€” approve ke baad Parties tab pe mat kheench
    patchMasterDetailUrlAfterModalClose(params, { entityId: group.id, groupsTab: true });
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router, group.id]);
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

  const handleAddLink = useCallback((voucher: any) => {
    openModalInUrl?.();
    const isPaymentType = ["payment_in", "payment_out", "direct_income", "direct_expense"].includes(voucher?.type);
    if (isPaymentType) {
      setLinkPaymentVoucher(voucher);
    } else {
      setLinkAdvancesVoucher(voucher);
    }
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

  const { setShowNotes, includeNotesInTable, notesPreferenceLockedOnMobile } = useShowNotes();
  // PC: preference; mobile: hamesha notes (includeNotesInTable)
  const displayTransactions = useMemo(
    () => (includeNotesInTable ? processedTransactions : processedTransactions.filter((t: any) => t.type !== "note")),
    [processedTransactions, includeNotesInTable]
  );
  const statusFilteredTransactions = useMemo(
    () => filterByStatus(displayTransactions, statusFilter),
    [displayTransactions, statusFilter]
  );

  const [tdsLedgerOnly, setTdsLedgerOnly] = useState(false);
  const tdsLedgerOnlyActive = tdsLedgerOnly && groupType === "party";
  const taxNameById = useMemo(() => buildTaxNameById(processedTaxes), [processedTaxes]);
  const vouchersByIdForTds = useMemo(() => {
    const src = vouchersAll?.length ? vouchersAll : vouchers;
    return new Map(
      src.map((v: { id?: string }) => [String(v.id ?? ""), v as Record<string, unknown>])
    );
  }, [vouchers, vouchersAll]);
  const ledgerTableSourceTransactions = useMemo(() => {
    if (!tdsLedgerOnlyActive) return statusFilteredTransactions;
    return expandPartyLedgerTdsRows(statusFilteredTransactions, taxNameById, {
      voucherById: vouchersByIdForTds,
    });
  }, [statusFilteredTransactions, tdsLedgerOnlyActive, taxNameById, vouchersByIdForTds]);
  const mobileUnapprovedTxnCount = useMemo(
    () => countLedgerUnapprovedTransactions(ledgerTableSourceTransactions),
    [ledgerTableSourceTransactions]
  );

  const effectiveVisibleColumns = useMemo(() => {
    if (tdsLedgerOnlyActive) {
      return mergeLedgerTdsVisibleColumnsWithPrefs(visibleColumns, balanceMode === "bill_wise");
    }
    const base =
      balanceMode === "bill_wise" ? { ...visibleColumns, status: true } : visibleColumns;
    return { ...base, tdsTaxable: false, tdsAmount: false };
  }, [tdsLedgerOnlyActive, balanceMode, visibleColumns]);

  const toggleTdsLedgerOnly = useCallback(() => {
    setTdsLedgerOnly((prev) => !prev);
    setCurrentPage(1);
  }, [setCurrentPage]);

  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortOrder, setSortOrder] = useState<TransactionSortOrder>(DEFAULT_TRANSACTION_SORT_ORDER);
  const sortedTransactions = useMemo(() => {
    const base = filterByUnapprovedOnly(ledgerTableSourceTransactions);
    if (tdsLedgerOnlyActive) {
      return sortLedgerTdsRowsForDisplay(base, sortBy, sortOrder);
    }
    return recomputeRunningBalanceTopToBottom(
      sortTransactionsWithFiscalMergeForCompany(base, "date", DEFAULT_TRANSACTION_SORT_ORDER, undefined, company),
      openingBalanceForPeriod
    );
  }, [
    ledgerTableSourceTransactions,
    tdsLedgerOnlyActive,
    sortBy,
    sortOrder,
    filterByUnapprovedOnly,
    openingBalanceForPeriod,
    company,
  ]);

  // Statement check mode + desktop tail paging (PartyDetails jaisa)
  const {
    statementCheck,
    ledgerListForPaging,
    desktopPaginationMeta,
    paginatedTransactions,
    totalPages,
  } = useStatementLedgerCheckModePaging({
    companyId,
    context: "group",
    contextId: group?.id,
    viewMode: balanceMode === "bill_wise" ? "bill_wise" : "statement",
    searchFilteredTransactions: sortedTransactions,
    rowsPerPage,
    currentPage,
    ledgerOpeningForRunning: openingBalanceForPeriod,
    pageSortBy: sortBy,
    pageSortOrder: sortOrder,
    company,
  });

  useLedgerDetailSessionMemory({
    companyId: companyId ?? undefined,
    context: "group",
    contextId: group?.id,
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

  /** Desktop table: Book OB sirf jab slice chronological shuru se (PartyDetails jaisa). */
  const desktopLedgerOpeningPeriodStartDate = useMemo(() => {
    const list = sortedTransactions as any[];
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
  }, [sortedTransactions, rowsPerPage, desktopPaginationMeta.sliceStart, hasLedgerDateFilter, dateRange?.from]);

  const booksOpeningForGroup = useMemo(() => {
    const members = selectedMemberParty ? [selectedMemberParty] : partiesInGroup;
    return resolveGroupBooksOpeningBalance(group, members);
  }, [group, selectedMemberParty, partiesInGroup]);

  const handleOpenNoteDialog = (partyId?: string) => {
    if (partiesInGroup.length === 1) {
      setNoteEntityId(partiesInGroup[0].id);
    } else if (partyId) {
      setNoteEntityId(partyId);
    }
    setIsNoteOpen(true);
  };

  const buildDateRangeText = () => {
    if (!company) return;
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
      else
        dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    return dateRangeText;
  };

  const getPrintTitle = (variant: "statement" | "bill_wise") => {
    const title = `Group Statement: ${group.name}`;
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
          context: "group",
          contextId: group.id,
          dateSystem: dateSystem,
          dateRangeText: dateRangeText || "All Time",
          vouchersCount: paginatedTransactions.length,
          openingBalance: desktopPaginationMeta.openingForPage,
          openingBalanceDate: (group as any).openingBalanceDate,
          openingBalanceNarration: (group as any).openingBalanceNarration ?? null,
          transactions: paginatedTransactions,
          showNarration: showNarration,
          includeNotes: includeNotesInTable,
          visibleColumns: printVisibleColumns,
          userNames: userNames,
          billWise: variant === "bill_wise",
          ...(variant === "bill_wise" && { openingBalanceOutstanding, openingBalanceLinkedVoucherNos, vouchers }),
        },
        {
          paginatedTransactions,
          openingForPage: desktopPaginationMeta.openingForPage,
          periodDrForPage: desktopPaginationMeta.periodDrForPage,
          periodCrForPage: desktopPaginationMeta.periodCrForPage,
          closingForPage: desktopPaginationMeta.closingForPage,
          booksOpeningBalance: booksOpeningForGroup,
          ledgerShowBookOpeningRow: rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0,
          ledgerDateFilterActive: hasLedgerDateFilter,
          openingBalancePeriodStartDate: desktopLedgerOpeningPeriodStartDate,
          masterOpeningBalanceDate: (group as any).openingBalanceDate,
          dateRange,
        }
      ),
      true
    );
  };

  const handlePrint = () => {
    (async () => {
      try {
        await printTransactions(balanceMode === "bill_wise" ? "bill_wise" : "statement");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Print failed. Please try again.");
      }
    })();
  };

  const balanceText = closingBalance >= 0 ? "To Receive" : "To Pay";
  // Group opening row: Balance column should stay on ledger opening, not OB outstanding override.
  const groupOpeningOutstandingForTable: number | undefined = undefined;

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

  const filteredMobileTransactions = useMemo(() => {
    if (!mobileSearchTerm) return sortedTransactions;
    const lowerCaseSearch = mobileSearchTerm.toLowerCase();
    return sortedTransactions.filter((t) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const debitCreditAmount = t.debit > 0 ? t.debit : t.credit;
      return (
        getTransactionQuickSearchHaystack(t, mobileSearchNames, "group", group.id, "party").includes(lowerCaseSearch) ||
        formatDate(d).toLowerCase().includes(lowerCaseSearch) ||
        formatDateBS(d).toLowerCase().includes(lowerCaseSearch) ||
        String(t.total || t.amount || 0)
          .toLowerCase()
          .includes(lowerCaseSearch) ||
        String(t.debit).toLowerCase().includes(lowerCaseSearch) ||
        String(t.credit).toLowerCase().includes(lowerCaseSearch) ||
        String(debitCreditAmount).toLowerCase().includes(lowerCaseSearch) ||
        String(t.balance).toLowerCase().includes(lowerCaseSearch)
      );
    });
  }, [sortedTransactions, mobileSearchTerm, formatDate, formatDateBS, mobileSearchNames, group.id]);

  // Keep page in valid range when list size/page-size changes (dateRange object deps se loop avoid).
  useEffect(() => {
    const perPage = rowsPerPage <= 0 ? filteredMobileTransactions.length || 1 : rowsPerPage;
    const total = Math.max(1, Math.ceil(filteredMobileTransactions.length / perPage));
    setCurrentPage((prev) => {
      const next = Math.min(Math.max(1, prev), total);
      return next === prev ? prev : next;
    });
  }, [dateRangeFromMs, dateRangeToMs, filteredMobileTransactions.length, rowsPerPage, group.id]);

  const mobileTransactionsToShow = useMemo(() => {
    if (rowsPerPage <= 0) return filteredMobileTransactions;
    const total = filteredMobileTransactions.length;
    const totalPagesLocal = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), totalPagesLocal);
    const end = total - (safePage - 1) * rowsPerPage;
    const start = Math.max(0, end - rowsPerPage);
    return filteredMobileTransactions.slice(start, Math.max(start, end));
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
    const list = filteredMobileTransactions;
    const total = list.length;
    if (rowsPerPage <= 0) {
      const pageDr = list.reduce((sum, t: any) => sum + (Number(t?.debit) || 0), 0);
      const pageCr = list.reduce((sum, t: any) => sum + (Number(t?.credit) || 0), 0);
      return {
        sliceStart: 0,
        openingForPage: openingBalanceForPeriod,
        periodDrForPage: pageDr,
        periodCrForPage: pageCr,
        closingForPage: openingBalanceForPeriod + pageDr - pageCr,
      };
    }
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
        : openingBalanceForPeriod;
    const periodDrForPage = pageTransactions.reduce((sum, t: any) => sum + (Number(t?.debit) || 0), 0);
    const periodCrForPage = pageTransactions.reduce((sum, t: any) => sum + (Number(t?.credit) || 0), 0);
    return {
      sliceStart: start,
      openingForPage,
      periodDrForPage,
      periodCrForPage,
      closingForPage: openingForPage + periodDrForPage - periodCrForPage,
    };
  }, [filteredMobileTransactions, rowsPerPage, currentPage, openingBalanceForPeriod]);

  /** Mobile search list: tail slice ke hisaab se dated OB (desktop se alag list ho sakti hai). */
  const mobileLedgerOpeningPeriodStartDate = useMemo(() => {
    const list = filteredMobileTransactions as any[];
    const start = mobilePaginationMeta.sliceStart;
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
  }, [filteredMobileTransactions, rowsPerPage, mobilePaginationMeta.sliceStart, hasLedgerDateFilter, dateRange?.from]);

  const dateRangeLabel = ledgerMasterDateRangeLabel(dateRange, buildDateRangeText());

  // Group dropdown: hide Assets, Equity, Expenses, Income, Liabilities (show Sundry Creditors, Sundry Debtors, etc.)
  const groupDropdownOptions = useMemo(() => {
    const exclude = ["assets", "equity", "expenses", "income", "liabilities", "liability"];
    return allGroups
      .filter(
        (g) =>
          g.id === group?.id || !exclude.includes((g.name || "").trim().toLowerCase())
      )
      .map((g) => ({ value: g.id, label: g.name }));
  }, [allGroups, group?.id]);

  const TransactionRow = React.memo(({ transaction }: { transaction: any }) => {
    const { dateSystem, formatDate, formatDateBS, formatCurrency } = useDate();

    const d = transaction.date?.toDate
      ? transaction.date.toDate()
      : transaction.date
      ? new Date(transaction.date)
      : null;

    if (!d) {
      return (
        <Card className="p-2 m-2 mb-0">
          <p className="text-red-500">Invalid date found</p>
        </Card>
      );
    }

    const displayDate = () => {
      switch (dateSystem) {
        case "AD":
          return formatDate(d);
        case "BS":
          return formatDateBS(d);
        case "Both":
          return `${formatDateBS(d)} (${formatDate(d)})`;
        default:
          return formatDateBS(d);
      }
    };

    return (
      <Card
        className="p-2 m-2 mb-0 rounded-lg shadow-sm border overflow-hidden"
        onClick={() => handleEditVoucher(transaction)}
      >
        <div className="flex justify-between items-start">
          <div>
            <p className="font-semibold text-xs">
              {transaction.voucherNumber} -{" "}
              {transaction.type
                ? voucherTypeDisplayText(transaction.type)
                : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">
              {transaction.narration || "No narration"}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                "font-bold text-sm",
                transaction.debit > 0 ? "text-red-600" : "text-green-600"
              )}
            >
              {formatCurrency(
                transaction.debit > 0 ? transaction.debit : transaction.credit
              )}
            </p>
          </div>
        </div>
        <div className="flex justify-between items-center mt-1">
          <p className="text-xs text-muted-foreground">
            {displayDate()} â€¢ {formatVoucherEntryTimeLocal(transaction as Record<string, unknown>)}
          </p>
          <Badge
            variant="secondary"
            className={cn(
              "font-normal text-xs px-1.5 py-0.5",
              transaction.balance >= 0
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            )}
          >
            Bal: {formatCurrency(transaction.balance)}
          </Badge>
        </div>
      </Card>
    );
  });
  TransactionRow.displayName = "TransactionRow";

  const mobileEntityTxnToolbar = (
    <MobileEntityTxnToolbarRow placement="belowPager">
      <MobileEntityTxnToolbarPicker>
        <Combobox
          options={groupDropdownOptions}
          value={group?.id || ""}
          onChange={(value) => {
            if (value && value !== group.id) router.push(`/party?view=groups&selected=${value}`);
          }}
          placeholder="Select group"
        />
      </MobileEntityTxnToolbarPicker>
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

  const renderMobileView = () => (
    <>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
        {/* Mobile: scroll area extends to footer; inner pb-24 so last row clears fixed footer */}
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
        <div className={mdc.mobileTxnBalanceRow} {...mdcMobileTxnBalanceRowData}>
          <p className={cn(mdc.mobileTxnBalanceTextLg, closingBalance >= 0 ? "text-green-600" : "text-red-600")}>
            <span className="text-[0.6em]">{balanceText}</span> {formatCurrency(Math.abs(closingBalance), { noSuffix: true })}
          </p>
        </div>
        </MobileDetailSummaryCollapsible>
        {/* scroll-touch + inline style for APK/WebView touch scroll */}
        <div
          className={mobileTxnScrollBodyClass(false)}
        >
          <div className="pb-2">
          <MasterAccountFreezeTxnShell className="min-h-[8rem]" overlay={memberFreezeOverlay}>
          {/* Unapproved: pink row â€” default `highlightPendingApproval` */}
          <TransactionsTable adaptiveClosingLabel
            transactions={mobileTransactionsToShow}
            context="group"
            // Mark this as party-group context so bill-wise table keeps running-balance behavior.
            groupEntityType="party"
            contextId={group.id}
            openingBalance={mobilePaginationMeta.openingForPage}
            openingBalanceOutstanding={groupOpeningOutstandingForTable}
            openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
            openingBalanceDate={(group as any).openingBalanceDate}
            openingBalanceNarration={(group as any).openingBalanceNarration}
            booksOpeningBalance={booksOpeningForGroup}
            ledgerDateFilterActive={hasLedgerDateFilter}
            ledgerShowBookOpeningRow={!tdsLedgerOnlyActive && (rowsPerPage <= 0 || mobilePaginationMeta.sliceStart === 0)}
            hideLedgerOpeningRows={tdsLedgerOnlyActive}
            openingBalancePeriodStartDate={mobileLedgerOpeningPeriodStartDate}
            dateRange={dateRange}
            openingBalanceActions={undefined}
            showNarration={showNarration}
            visibleColumns={effectiveVisibleColumns}
            journalAccountNames={journalAccountNames}
            userNames={mergedUserNames}
            onRowClick={(t) => { openModalInUrl(); handleEditVoucher(t); }}
            onDeleteVoucher={handleDeleteVoucher}
            onHistoryVoucher={(v) => { openModalInUrl(); handleHistoryVoucher(v); }}
            onAddLink={handleAddLink}
            filters={filters}
            setFilters={setFilters}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            periodDr={mobilePaginationMeta.periodDrForPage}
            periodCr={mobilePaginationMeta.periodCrForPage}
            closingBalance={mobilePaginationMeta.closingForPage}
            isAllVouchersView={false}
            hideDebitColumn={false}
            hideCreditColumn={false}
            hideBalanceColumn={false}
            isDateChange={false}
            scrollOnlyTransactions
            closingBalanceRowActions={tableClosingBalanceRowActions}
            closingBalanceActions={tableClosingBalanceActions}
            statusFilter={statusFilter}
            statusFilterAllChecked={statusFilterAllChecked}
            onStatusFilterAll={handleStatusFilterAll}
            onStatusFilterChange={handleStatusFilterChange}
            statusFilterIdPrefix="group"
            {...statementCheck.tableProps}
          />
          </MasterAccountFreezeTxnShell>
          </div>
        </div>
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
      </div>
      <div
        className="fixed bottom-0 left-0 right-0 p-1.5 border-t bg-background/95 backdrop-blur z-50 flex items-center justify-around gap-1.5"
        data-pl-mobile-ledger-action-footer=""
      >
        {/* Mobile footer: ek button — Statement ↔ Bill wise toggle */}
        <LedgerViewModeToggleButton
          value={balanceMode}
          onChange={setBalanceMode}
          options={[
            { value: "statement", label: "Statement" },
            { value: "bill_wise", label: "Bill wise" },
          ]}
        />
        <Button className="flex-1 h-6 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium" onClick={() => { openingModalRef.current = true; setMobileFooterDialogOpen("sale"); openModalInUrl(); }}>
          New Sale
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
    </>
  );

  const renderDesktopView = () => (
    <div data-pl-ledger-txn-page="" className={LEDGER_TXN_PAGE_ROOT_CN}>
      {/* Header: identity + pills — Party-style single row */}
      <LedgerTxnScrollColumn
          header={
<div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
        <div className={LEDGER_HEADER_OUTER_ROW_CN}>
          <div className={LEDGER_HEADER_IDENTITY_CN}>
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0 self-center">
                <ArrowLeft className="h-3 w-3" />
              </Button>
            )}
            <div className={LEDGER_HEADER_AVATAR_CN}>
              {headerIdentityParty ? (
                <>
                  <EntityFileAttachmentHover
                    fileUrl={selectedMemberAttachmentUrl}
                    triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}
                  >
                    <ResolvedEntityAvatar
                      className={LEDGER_HEADER_AVATAR_IMAGE_CN}
                      companyId={headerIdentityParty.companyId}
                      src={selectedMemberAttachmentUrl ?? undefined}
                      alt={headerIdentityParty.name}
                      fallbackText={getInitials(headerIdentityParty.name)}
                    />
                  </EntityFileAttachmentHover>
                  <EditPartyDialog
                    party={headerIdentityParty}
                    onPartyUpdated={onPartyUpdated}
                    onPartyDeleted={() => onPartyUpdated()}
                    hasTransactions={processedTransactions.length > 0}
                  >
                    <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </EditPartyDialog>
                </>
              ) : (
                <>
                  <Avatar className={cn(LEDGER_HEADER_AVATAR_BOX_CN, "rounded-lg text-lg")}>
                    <AvatarFallback className="bg-muted text-muted-foreground">
                      <Users className="h-6 w-6" />
                    </AvatarFallback>
                  </Avatar>
                  {!isAutoSyntheticPartyGroup && (
                    <EditGroupDialog
                      group={group}
                      allGroups={allGroups}
                      onGroupUpdated={onGroupUpdated}
                      onGroupDeleted={onGroupDeleted}
                      hasAccounts={partiesInGroup.length > 0 || childGroups.length > 0}
                    >
                      <button type="button" className={LEDGER_HEADER_AVATAR_PEN_CN} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                    </EditGroupDialog>
                  )}
                </>
              )}
            </div>
            <div className={LEDGER_HEADER_NAME_CARD_CN}>
              <GroupDetailNestedNameHeader
                groupName={group.name}
                middleName={
                  group.id === IC_COMPANY_PARTY_GROUP_ID && icHeaderPeerCompany
                    ? icPeerCompanyGroupListTitleLines(icHeaderPeerCompany).primary
                    : null
                }
                memberName={
                  group.id === IC_COMPANY_PARTY_GROUP_ID
                    ? icHeaderMemberAccount
                      ? interCompanyClearingAccountDisplayName(icHeaderMemberAccount)
                      : null
                    : selectedMemberParty?.name ?? null
                }
              />
            </div>
            {reportSummaryCards?.length ? (
              <ReportHeaderSummaryCards cards={reportSummaryCards} />
            ) : (
            <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
              <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                <div
                  className={cn(LEDGER_HEADER_BALANCE_CN,
                    closingBalance >= 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  {formatCurrency(closingBalance, { showDrCr: true })}
                </div>
              </div>
            </div>
            )}
          </div>
          <div className={LEDGER_HEADER_PILL_ROW_CN}>
              <LedgerHeaderPrintButton variant="chromePill" onClick={handlePrint} />
              <LedgerHeaderReminderButton
                variant="chromePill"
                onClick={() => setReminderOpen(true)}
              />
              <LedgerReminderDialog
                open={reminderOpen}
                onOpenChange={setReminderOpen}
                context="Party Group"
                entityId={group.id}
                title={group.name}
              />
              <LedgerUnapprovedFilterButton active={unapprovedOnly} onClick={toggleUnapprovedOnly} />
            {(dateSystem === "BS" || dateSystem === "Both") && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <BsDatePicker
                  isRange
                  masterLedgerDatePresets
                  ledgerPaginationReset={ledgerPaginationReset}
                  valueAD={dateRange}
                  onChangeAD={(range) =>
                    onDateRangeChange(range as DateRange | undefined)
                  }
                  transactionDates={transactionDates}
                  className={cn("w-auto", LEDGER_HEADER_PILL_CN)}
                />
              </div>
            )}
            {(dateSystem === "AD" || dateSystem === "Both") && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <Popover
                  open={isDesktopCalendarOpen}
                  onOpenChange={setIsDesktopCalendarOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant={"outline"}
                      className={cn(
                        "justify-start text-left font-normal px-2 w-auto",
                        LEDGER_HEADER_PILL_CN,
                        !dateRange && "text-muted-foreground"
                      )}
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
              </div>
            )}
            {isFilterActive && (
              // Header par duplicate clear controls hata kar single clear button.
              <Button
                variant="ghost"
                size="icon"
                onClick={clearFilters}
                className={cn(LEDGER_HEADER_PILL_ICON_CN, "text-muted-foreground hover:text-foreground")}
                aria-label="Clear date filter"
              >
                <XCircle className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
              </Button>
            )}
            <LedgerViewModePills
              value={balanceMode}
              onChange={setBalanceMode}
              options={[
                { value: "statement", label: "Statement" },
                { value: "bill_wise", label: "Bill wise" },
              ]}
            />
            {groupType === "party" ? (
              <LedgerTdsFilterPill active={tdsLedgerOnlyActive} onToggle={toggleTdsLedgerOnly} />
            ) : null}
            <Button
              variant="chromePill"
              size="sm"
              onClick={() => handleOpenNoteDialog()}
              disabled={Boolean(liveFreezeTargetParty) && blockMemberNewTransactions}
              className={LEDGER_HEADER_PILL_CN}
              data-theme-detail="add-note"
            >
              <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} /> Add Note
            </Button>
            
          </div>
        </div>
      </div>
          }
          table={
          <>
          <MasterAccountFreezeTxnShell className="min-h-[8rem]" overlay={memberFreezeOverlay}>
          <TransactionsTable adaptiveClosingLabel
            transactions={paginatedTransactions}
            ledgerTransactionsForFyOpening={ledgerListForPaging}
            fyLedgerScopeOpeningBalance={openingBalanceForPeriod}
            context="group"
            // Mark this as party-group context so bill-wise table keeps running-balance behavior.
            groupEntityType="party"
            contextId={group.id}
            showNarration={showNarration}
            visibleColumns={effectiveVisibleColumns}
            openingBalance={desktopPaginationMeta.openingForPage}
            openingBalanceOutstanding={groupOpeningOutstandingForTable}
            openingBalanceLinkedVoucherNos={openingBalanceLinkedVoucherNos}
            openingBalanceDate={(group as any).openingBalanceDate}
            openingBalanceNarration={(group as any).openingBalanceNarration}
            booksOpeningBalance={booksOpeningForGroup}
            ledgerDateFilterActive={hasLedgerDateFilter}
            ledgerShowBookOpeningRow={!tdsLedgerOnlyActive && (rowsPerPage <= 0 || desktopPaginationMeta.sliceStart === 0)}
            hideLedgerOpeningRows={tdsLedgerOnlyActive}
            openingBalancePeriodStartDate={desktopLedgerOpeningPeriodStartDate}
            dateRange={dateRange}
            openingBalanceActions={
              !isAutoSyntheticPartyGroup ? (
                <EditGroupDialog
                  group={group}
                  allGroups={allGroups}
                  onGroupUpdated={onGroupUpdated}
                  onGroupDeleted={onGroupDeleted}
                  hasAccounts={partiesInGroup.length > 0 || childGroups.length > 0}
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </EditGroupDialog>
              ) : null
            }
            userNames={mergedUserNames}
            onRowClick={handleEditVoucher}
            onDeleteVoucher={handleDeleteVoucher}
            onHistoryVoucher={handleHistoryVoucher}
            onAddLink={handleAddLink}
            filters={filters}
            setFilters={setFilters}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            periodDr={desktopPaginationMeta.periodDrForPage}
            periodCr={desktopPaginationMeta.periodCrForPage}
            closingBalance={desktopPaginationMeta.closingForPage}
            scrollOnlyTransactions
            closingBalanceRowActions={tableClosingBalanceRowActions}
            closingBalanceActions={tableClosingBalanceActions}
            statusFilter={statusFilter}
            statusFilterAllChecked={statusFilterAllChecked}
            onStatusFilterAll={handleStatusFilterAll}
            onStatusFilterChange={handleStatusFilterChange}
            statusFilterIdPrefix="group"
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
                id="show-narration-party-group"
                checked={showNarration}
                onCheckedChange={(checked) => handleShowNarrationChange(Boolean(checked))}
                label="Show Narration"
              />
            <LedgerFooterColumnsMenu>
                <DropdownMenuContent align="start" className="w-52 p-2">
                {(tdsLedgerOnlyActive
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
                        id={`col-${key}-group`}
                        checked={columnChecked}
                        disabled={isStatusLocked}
                        onCheckedChange={isStatusLocked ? undefined : (c) => handleColumnVisibilityChange(key, Boolean(c))}
                      />
                      <label htmlFor={`col-${key}-group`} className={cn("text-sm font-medium flex-1", isStatusLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                        {COLUMN_LABELS[key]}
                      </label>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
              </LedgerFooterColumnsMenu>
              <LedgerFooterCheckboxPill
                id="show-notes-group"
                checked={includeNotesInTable}
                disabled={notesPreferenceLockedOnMobile}
                onCheckedChange={(c) => setShowNotes(Boolean(c))}
                label="Note"
              />
            <StatementCheckModeFooterControls
              idPrefix="party-group"
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
        rowsPerPageSelectValue={rowsPerPageSelectValue}
        onRowsPerPageChange={handleRowsPerPageChange}
        beforeCount={desktopPaginationMeta.beforeCount}
        afterCount={desktopPaginationMeta.afterCount}
        totalCount={statusFilteredTransactions.length}
      />
        }
      />
    </div>
  );

  // For staff groups, use the reusable StaffGroupDetails component
  if (groupType === 'staff') {
    const staffInGroup = accountsInGroup as Staff[]; // accountsInGroup contains staff for staff groups
    const staffGroup = group as unknown as StaffGroup;
    return (
      <StaffGroupDetails
        group={staffGroup}
        allGroups={processedStaffGroups as StaffGroup[]}
        staff={staffInGroup}
        groupMemberFilterId={groupMemberFilterId}
        onGroupUpdated={onGroupUpdated}
        onGroupDeleted={onGroupDeleted}
        onStaffUpdated={onPartyUpdated}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onBack={onBack}
        userNames={userNames}
      />
    );
  }

  // For account groups (bank/cash), use the reusable AccountGroupDetails component
  if (groupType === 'account') {
    const accountsInAccountGroup = accountsInGroup as Account[]; // accountsInGroup contains accounts for account groups
    const accountGroup = group as unknown as AccountGroup;
    return (
      <AccountGroupDetails
        group={accountGroup}
        allGroups={processedAccountGroups as AccountGroup[]}
        accounts={accountsInAccountGroup}
        onGroupUpdated={onGroupUpdated}
        onGroupDeleted={onGroupDeleted}
        onAccountUpdated={onPartyUpdated}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onBack={onBack}
        userNames={userNames}
      />
    );
  }

  // For tax groups, use the reusable TaxGroupDetails component
  if (groupType === 'tax') {
    const taxesInGroup = accountsInGroup as Tax[]; // accountsInGroup contains taxes for tax groups
    const taxGroup = group as unknown as TaxGroup;
    return (
      <TaxGroupDetails
        group={taxGroup}
        allGroups={processedTaxGroups as TaxGroup[]}
        taxes={taxesInGroup}
        groupMemberFilterId={groupMemberFilterId}
        onGroupUpdated={onGroupUpdated}
        onGroupDeleted={onGroupDeleted}
        onTaxUpdated={onPartyUpdated}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onBack={onBack}
        userNames={userNames}
      />
    );
  }

  // For expense groups, use the reusable ExpenseGroupDetails component
  if (groupType === 'expense') {
    const expenseAccountsInGroup = accountsInGroup as ExpenseAccount[]; // accountsInGroup contains expense accounts for expense groups
    const expenseGroup = group as unknown as ExpenseGroup;
    return (
      <ExpenseGroupDetails
        group={expenseGroup}
        allGroups={processedExpenseGroups as ExpenseGroup[]}
        accounts={expenseAccountsInGroup}
        groupMemberFilterId={groupMemberFilterId}
        onGroupUpdated={onGroupUpdated}
        onGroupDeleted={onGroupDeleted}
        onAccountUpdated={onPartyUpdated}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onBack={onBack}
        userNames={userNames}
      />
    );
  }

  // For item groups, use the reusable ItemGroupDetails component
  if (groupType === 'item') {
    const itemsInGroup = accountsInGroup as Item[]; // accountsInGroup contains items for item groups
    const itemGroup = group as unknown as ItemGroup;
    return (
      <ItemGroupDetails
        group={itemGroup}
        allGroups={processedItemGroups as ItemGroup[]}
        items={itemsInGroup}
        allItems={processedItems}
        groupMemberFilterId={groupMemberFilterId}
        onGroupUpdated={onGroupUpdated}
        onGroupDeleted={onGroupDeleted}
        onItemUpdated={onPartyUpdated}
        stockView="amount"
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onBack={onBack}
        userNames={userNames}
        transactions={vouchers}
      />
    );
  }

  return (
    <>
      <div className={cn("h-full min-h-0", isMobile && "flex flex-col")}>
        {isMobile ? renderMobileView() : renderDesktopView()}
      </div>
      <Dialog
        open={isNoteOpen}
        onOpenChange={(open: boolean) => {
          setIsNoteOpen(open);
          if (!open && isMobile) closeModalInUrl();
        }}
      >
        <DialogContent className="h-[95vh] w-full max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>Add a New Note for a Party in {group.name}</DialogTitle>
            <DialogDescription>
              {partiesInGroup.length > 1
                ? "Select which party this note applies to."
                : "Record a new note for this party."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {partiesInGroup.length > 1 && !noteEntityId && (
              <div className="flex flex-col gap-2 p-4">
                <p className="font-semibold">Select a party for the note:</p>
                {partiesInGroup.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    onClick={() => setNoteEntityId(p.id)}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            )}
            {noteEntityId && (
              <CreateNoteForm
                onVoucherAction={() => {
                  onPartyUpdated();
                  setIsNoteOpen(false);
                  setNoteEntityId(null);
                }}
                initialContext="Party"
                initialEntityId={noteEntityId}
                compactFooter
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setIsVoucherDialogOpen(false);
            setSelectedVoucher(null);
            if (isMobile) closeModalInUrl();
          } else {
            setIsVoucherDialogOpen(open);
          }
        }}
        voucher={selectedVoucher}
        onVoucherAction={() => setSelectedVoucher(null)}
      />
      <HistoryDialog
        voucher={historyVoucher}
        isOpen={!!historyVoucher}
        onOpenChange={(open: boolean) => !open && setHistoryVoucher(null)}
        onHistoryReset={() => setHistoryVoucher((prev: any) => prev ? { ...prev, history: [] } : null)}
      />
      {linkAdvancesVoucher && (
        <LinkAdvancesToVoucherDialog
          isOpen={!!linkAdvancesVoucher}
          onOpenChange={(open: boolean) => !open && setLinkAdvancesVoucher(null)}
          mode={linkAdvancesVoucher.type === "purchase" || linkAdvancesVoucher.type === "purchase_service" ? "purchase" : "sale"}
          targetVoucherId={linkAdvancesVoucher.id}
          targetPartyId={linkAdvancesVoucher.partyId ?? ""}
          targetPartyName={allParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.name ?? "Party"}
          partyOpeningBalance={allParties?.find((p) => p.id === linkAdvancesVoucher.partyId)?.openingBalance ?? 0}
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
