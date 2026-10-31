"use client";
import { voucherTypeDisplayText, voucherTypeSearchText } from "@/lib/voucherTypeDisplay";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Info } from "lucide-react";
import React, { Suspense, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { AccountDetails } from "@/components/bank-cash/AccountDetails";
import { AccountGroupDetails } from "@/components/bank-cash/AccountGroupDetails";
import { PayeeDetails } from "@/components/payee/PayeeDetails";
import { GroupDetails } from "@/components/party/GroupDetails";
import { StaffGroupDetails } from "@/components/staff/StaffGroupDetails";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { TaxGroupDetails } from "@/components/tax/TaxGroupDetails";
import { ExpenseGroupDetails } from "@/components/expenses/ExpenseGroupDetails";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Account, AccountGroup } from "@/components/bank-cash/types";
import type { Party, Group } from "@/components/party/types";
import type { Staff } from "@/components/staff/types";
import type { Tax } from "@/components/tax/types";
import type { ExpenseAccount } from "@/components/expenses/types";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { isSystemParentGroup } from "@/lib/system-groups";
import {
  isPartyDirectOnSystemBranch,
  isPartySystemGroupId,
  PARTY_SYSTEM_DEBTORS_ID,
  PARTY_SYSTEM_GROUP_OPTIONS,
  buildPartySystemBranchSelectionGroup,
  resolvePartyListGroupBucketId,
} from "@/lib/partySystemGroups";
import { filterPartiesForPartyGroupScope } from "@/lib/partyGroupScope";
import {
  buildIcPeerCompanyGroupRows,
  IC_COMPANY_PARTY_GROUP_ID,
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";
import { isInterCompanyPartyListAccount } from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import type { IcCompanyGroupTabSelectOptions } from "@/components/party/IcCompanyGroupTabListTree";
import {
  GroupSummaryTreeList,
  type GroupSummaryTreeNode,
} from "@/components/reports/GroupSummaryTreeList";
import { ItemGroupDetails } from "@/components/items/ItemGroupDetails";
import { MasterListViewShell } from "@/components/layout/MasterListViewShell";
import { ReportShowListButton } from "@/components/reports/ReportShowListButton";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { masterListRowUnselectedCn } from "@/lib/masterListChrome";
import { MasterListRow } from "@/components/ui/master-list-row";
import { ResizeWidthHandle, useResizablePixelWidth } from "@/components/layout/ResizablePaneWidth";
import { mlc, mlcListChromeRootData } from "@/lib/mobileListChrome";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { format } from "date-fns";
import { doc, query, collection, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  clearPlModalParentQueryBackup,
  pathnameForModalRouterReplace,
  persistPlModalParentQuery,
  searchParamsStringAfterClosingModal,
  searchParamsStringForModalClose,
} from "@/lib/modalUrlSync";
import { useMobileLedgerModalUrlGuard } from "@/hooks/useMobileLedgerModalUrlGuard";
import { ChevronRight, ChevronDown, Landmark, Users, Crown, Building2, UserCheck, Receipt, TrendingUp, Briefcase, X, ArrowLeft, Calendar as CalendarIcon, File, Printer, Share2, BarChart2 } from "lucide-react";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";
import { useIsMobile, useCalendarMonths } from "@/hooks/use-mobile";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useReportPage } from "@/contexts/ReportPageContext";
import { useTransactions } from "@/hooks/use-transactions";
import { useCompany } from "@/hooks/useCompany";
import { mergeLedgerUserDisplayNameMaps } from "@/lib/ledgerUserColumnDisplay";
import { openPrintDirect } from "@/lib/printDirect";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Calendar } from "@/components/ui/calendar";
import NepaliCalendar from "@/components/ui/nepali-calendar";
import type { BSDate } from "@/lib/bs-date";
import * as XLSX from "xlsx";
import { RunningBalanceFullChart } from "@/components/reports/RunningBalanceFullChart";
import { Combobox } from "@/components/ui/combobox";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { isPocketBaseAppSessionActive, readPocketBaseAppProfile, pocketBaseSessionUid } from "@/lib/pocketbaseData/pbAppSession";

type UnifiedAccount = {
  id: string;
  name: string;
  balance: number;
  debit: number;
  credit: number;
  accountType: 'party' | 'staff' | 'tax' | 'expense' | 'bank';
  parentId?: string;
  groupId?: string;
  entity?: Party | Staff | Tax | ExpenseAccount | Account;
};

type UnifiedGroup = {
  id: string;
  name: string;
  balance: number;
  debit: number;
  credit: number;
  groupType: 'party' | 'staff' | 'tax' | 'expense' | 'bank' | 'item';
  parentId?: string;
  isSystemGroup?: boolean;
  entity?: Group | AccountGroup | any;
};

type AccountTreeItem = {
  id: string;
  name: string;
  balance: number;
  debit: number;
  credit: number;
  type: 'group' | 'account';
  parentId?: string;
  level: number;
  children?: AccountTreeItem[];
  account?: UnifiedAccount;
  group?: UnifiedGroup;
};

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
};

const ReportSummaryCard = React.memo(function ReportSummaryCard({
  title,
  amount,
  color,
}: {
  title: string;
  amount: number;
  color: string;
}) {
  const { formatCurrency, formatCurrencyForPrint } = useDate();
  const formatted = formatCurrency(amount, { showDrCr: title === "Balance" });
  const titleStr = formatCurrencyForPrint(amount, { showDrCr: title === "Balance" });
  return (
    <div className="px-2 py-1.5 w-fit flex-shrink-0 border rounded-lg overflow-hidden bg-card">
      <div className="flex flex-col">
        <p className="text-xs text-muted-foreground whitespace-nowrap">{title}</p>
        <p className={cn("text-sm sm:text-base font-bold whitespace-nowrap tabular-nums", color)} title={titleStr}>
          {formatted}
        </p>
      </div>
    </div>
  );
}, (prev, next) => prev.title === next.title && prev.amount === next.amount && prev.color === next.color);

type AccountsStatementPageProps = {
  onPartySelectionChange?: (isParty: boolean) => void;
  /** 'account' = Account Summary (entity + account), 'group' = Group Summary (entity + group) */
  mode?: "account" | "group";
};

function AccountsStatementPageContent({ onPartySelectionChange, mode = "account" }: AccountsStatementPageProps) {
  const { formatCurrency, formatDateBS, formatDate, dateSystem } = useDate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { company } = useCompany();
  const companyId = company?.id || "";
  const { onBackToReportList } = useReportPage();
  const { 
    vouchers: allVouchers, 
    loading: vouchersLoading, 
    processedParties,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedExpenseAccounts,
    processedGroups,
    processedAccountGroups,
    processedStaffGroups,
    processedTaxGroups,
    processedExpenseGroups,
    processedItemGroups,
    processedItems,
    journalAccountNames,
    userNames: vouchersUserNames 
  } = useVouchers();
  
  const [selectedAccount, setSelectedAccount] = useState<UnifiedAccount | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<UnifiedGroup | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroupMemberFilterId, setSelectedGroupMemberFilterId] = useState<string | null>(null);
  const [selectedIcPeerCompanyId, setSelectedIcPeerCompanyId] = useState<string | null>(null);
  const [selectedIcMemberAccountId, setSelectedIcMemberAccountId] = useState<string | null>(null);
  const [groupExpandOnly, setGroupExpandOnly] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [transactionSearch, setTransactionSearch] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [view, setView] = useState<"list" | "chart">("list");
  const openingModalRef = useRef(false);
  const hasAutoSelected = useRef(false);
  const { settings: animationSettings } = useAnimationSettings();
  const isMobile = useIsMobile();
  const calendarMonths = useCalendarMonths();
  const summaryListWidthStorageKey =
    mode === "group" ? "pl-group-summary-list-width-px" : "pl-account-summary-list-width-px";
  const { widthPx: summaryListWidthPx, beginResize: beginSummaryListResize } = useResizablePixelWidth({
    storageKey: summaryListWidthStorageKey,
    defaultPx: 320,
    minPx: Math.round(256 * 0.7),
    maxPx: 450,
  });

  const hasDateFilter = !!dateRange?.from || !!dateRange?.to;
  const dateRangeLabel = useMemo(() => {
    if (!hasDateFilter) return "Last 10 Txns";
    const from = dateRange!.from!;
    const to = dateRange!.to || from;
    const fromAD = format(from, "LLL dd, y");
    const toAD = to ? format(to, "LLL dd, y") : fromAD;
    const fromBS = formatDateBS(from);
    const toBS = to ? formatDateBS(to) : fromBS;
    if (dateSystem === "AD") return `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
    if (dateSystem === "BS") return `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
    return `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
  }, [dateRange, dateSystem, formatDateBS, hasDateFilter]);
  const isRowAnimationEnabled = animationSettings.rows.enabled === true;
  const rowAnimationDuration = isRowAnimationEnabled ? animationSettings.rows.duration : 0;

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    // Check if already fetched
    const existingName = vouchersUserNames?.[userId] || userNames[userId];
    if (existingName && existingName !== "Unknown" && existingName !== "N/A") return existingName;
    
    // Pocket Ledger Server session: no Firebase user, so Firestore would only fail ("client is offline").
    if (isPocketBaseAppSessionActive()) {
      const p = readPocketBaseAppProfile();
      if (p && (userId === pocketBaseSessionUid(p) || userId === p.id)) {
        const nm = p.name || p.email;
        if (nm) return nm;
      }
    } else try {
      // User doc ID may be name_uid format (e.g. manishshah46_AaCbiR708nhGe28Ltf2I7YZzpNv1), so query by uid field first
      const q = query(collection(firestore, "users"), where("uid", "==", userId));
      const snap = await getDocs(q);
      let data = snap.docs[0]?.data();
      
      if (!data) {
        // Fallback 1: doc ID might be uid (legacy)
        const userDoc = await getDoc(doc(firestore, 'users', userId));
        if (userDoc.exists()) {
          data = userDoc.data();
        }
      }
      
      const displayName = data?.displayName || data?.name || data?.email || null;
      if (displayName && displayName !== userId && displayName !== "Unknown" && displayName !== "N/A") {
        // Check if it's not a UID pattern (long alphanumeric string without spaces/email)
        const isUIDPattern = displayName.length > 15 && /^[a-zA-Z0-9_-]+$/.test(displayName) && !displayName.includes('@') && !displayName.includes(' ');
        if (!isUIDPattern) {
          return displayName;
        }
      }
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === "unavailable") { console.debug('[AccountSummary] userName lookup skipped (offline) for', userId); } else { console.error('[AccountSummary] Error fetching userName for', userId, e); }
    }
    return "N/A";
  }, [vouchersUserNames, userNames]);

  useEffect(() => {
    if (!allVouchers || allVouchers.length === 0) return;
    const uids = new Set(allVouchers.map((t) => t.userId).filter(Boolean) as string[]);
    // Only fetch if not in vouchersUserNames or if it's "Unknown"/"N/A"
    const uidsToFetch = Array.from(uids).filter(uid => {
      const vouchersName = vouchersUserNames?.[uid];
      return !vouchersName || vouchersName === "Unknown" || vouchersName === "N/A";
    });
    
    if (uidsToFetch.length === 0) return;
    
    // Fetch all user names in parallel
    Promise.all(
      uidsToFetch.map(async (uid) => {
        const name = await fetchUserName(uid);
        return { uid, name };
      })
    ).then(results => {
      const newUserNames: Record<string, string> = {};
      results.forEach(({ uid, name }) => {
        // Only store valid names (not "Unknown", not "N/A", not UID)
        if (name && name !== "Unknown" && name !== "N/A" && name !== uid && !name.match(/^[a-zA-Z0-9_-]{20,}$/)) {
          newUserNames[uid] = name;
        }
      });
      if (Object.keys(newUserNames).length > 0) {
        setUserNames((prev) => ({ ...prev, ...newUserNames }));
      }
    });
  }, [allVouchers, vouchersUserNames, fetchUserName]);

  // Combine all accounts into unified format
  const allUnifiedAccounts = useMemo(() => {
    const accounts: UnifiedAccount[] = [];
    
    // Party accounts
    processedParties.forEach(p => {
      accounts.push({
        id: p.id,
        name: p.name,
        balance: p.balance || 0,
        debit: p.debit || 0,
        credit: p.credit || 0,
        accountType: 'party',
        parentId: p.groupId,
        groupId: p.groupId,
        entity: p,
      });
    });
    
    // Staff accounts
    processedStaff.forEach(s => {
      accounts.push({
        id: s.id,
        name: s.name,
        balance: s.balance || 0,
        debit: s.debit || 0,
        credit: s.credit || 0,
        accountType: 'staff',
        parentId: s.groupId,
        groupId: s.groupId,
        entity: s,
      });
    });
    
    // Tax accounts
    processedTaxes.forEach(t => {
      accounts.push({
        id: t.id,
        name: t.name,
        balance: t.balance || 0,
        debit: t.debit || 0,
        credit: t.credit || 0,
        accountType: 'tax',
        parentId: t.groupId,
        groupId: t.groupId,
        entity: t,
      });
    });
    
    // Expense accounts
    processedExpenseAccounts.forEach(e => {
      accounts.push({
        id: e.id,
        name: e.name,
        balance: e.balance || 0,
        debit: e.debit || 0,
        credit: e.credit || 0,
        accountType: 'expense',
        parentId: e.groupId,
        groupId: e.groupId,
        entity: e,
      });
    });
    
    // Bank accounts
    processedAccounts.forEach(a => {
      accounts.push({
        id: a.id,
        name: a.accountName,
        balance: a.balance || 0,
        debit: a.debit || 0,
        credit: a.credit || 0,
        accountType: 'bank',
        parentId: a.groupId,
        groupId: a.groupId,
        entity: a,
      });
    });
    
    return accounts;
  }, [processedParties, processedStaff, processedTaxes, processedExpenseAccounts, processedAccounts]);

  // Combine all groups into unified format
  const allUnifiedGroups = useMemo(() => {
    const groups: UnifiedGroup[] = [];
    // Keep system-group detection strict so user-created groups are never hidden as system rows.
    const detectSystemGroup = (raw: any, groupType: UnifiedGroup["groupType"]): boolean => {
      const id = String(raw?.id || "");
      const hasParent = Boolean(raw?.parentId);
      const reserved = Boolean(raw?.isSystemReserved || raw?.isSystemGroup || raw?.isReserved);
      const isKnownSystemParent =
        (groupType === "party" && isSystemParentGroup("groups", id)) ||
        (groupType === "staff" && isSystemParentGroup("staff_groups", id)) ||
        (groupType === "tax" && isSystemParentGroup("tax_groups", id)) ||
        (groupType === "bank" && isSystemParentGroup("account_groups", id)) ||
        (groupType === "expense" && isSystemParentGroup("expense_groups", id)) ||
        (groupType === "item" && isSystemParentGroup("item_groups", id));
      // Guard: treat child groups as user groups even if old data accidentally has reserved=true.
      if (hasParent) return isKnownSystemParent;
      // Root groups can still use legacy reserved flag when system-parent ids are not listed.
      if (reserved) return true;
      if (isKnownSystemParent) return true;
      return false;
    };
    
    // Party groups (include both system and user groups for hierarchical sidebar rendering).
    processedGroups.forEach(g => {
      const isReportOnly = (g as any).isReportOnly;
      const isAutoUngrouped = (g as any).isAutoUngrouped === true;
      if (!isReportOnly && !isAutoUngrouped) {
        groups.push({
          id: g.id,
          name: g.name,
          balance: g.balance || 0,
          debit: g.debit || 0,
          credit: g.credit || 0,
          groupType: 'party',
          parentId: (g as any).parentId,
          isSystemGroup: detectSystemGroup(g, "party"),
          entity: g,
        });
      }
    });
    
    // Staff groups
    processedStaffGroups.forEach(sg => {
      if ((sg as any).isAutoUngrouped === true) return;
      groups.push({
        id: sg.id,
        name: sg.name,
        balance: sg.balance || 0,
        debit: sg.debit || 0,
        credit: sg.credit || 0,
        groupType: 'staff',
        parentId: (sg as any).parentId,
        isSystemGroup: detectSystemGroup(sg, "staff"),
        entity: sg,
      });
    });
    
    // Tax groups
    processedTaxGroups.forEach(tg => {
      if ((tg as any).isAutoUngrouped === true) return;
      groups.push({
        id: tg.id,
        name: tg.name,
        balance: tg.balance || 0,
        debit: tg.debit || 0,
        credit: tg.credit || 0,
        groupType: 'tax',
        parentId: (tg as any).parentId,
        isSystemGroup: detectSystemGroup(tg, "tax"),
        entity: tg,
      });
    });
    
    // Expense groups
    processedExpenseGroups.forEach(eg => {
      if ((eg as any).isAutoUngrouped === true) return;
      groups.push({
        id: eg.id,
        name: eg.name,
        balance: eg.balance || 0,
        debit: eg.debit || 0,
        credit: eg.credit || 0,
        groupType: 'expense',
        parentId: (eg as any).parentId,
        isSystemGroup: detectSystemGroup(eg, "expense"),
        entity: eg,
      });
    });
    
    // Bank account groups
    processedAccountGroups.forEach(ag => {
      const isReportOnly = (ag as any).isReportOnly;
      const isAutoUngrouped = (ag as any).isAutoUngrouped === true;
      if (!isReportOnly && !isAutoUngrouped) {
        groups.push({
          id: ag.id,
          name: ag.name,
          balance: ag.balance || 0,
          debit: ag.debit || 0,
          credit: ag.credit || 0,
          groupType: 'bank',
          parentId: (ag as any).parentId,
          isSystemGroup: detectSystemGroup(ag, "bank"),
          entity: ag,
        });
      }
    });
    
    // Item groups
    processedItemGroups.forEach((ig) => {
      if ((ig as any).isAutoUngrouped === true) return;
      if ((ig as any).isReportOnly === true) return;
      groups.push({
        id: ig.id,
        name: ig.name,
        balance: ig.balance || 0,
        debit: ig.debit || 0,
        credit: ig.credit || 0,
        groupType: "item",
        parentId: (ig as any).parentId,
        isSystemGroup: detectSystemGroup(ig, "item"),
        entity: ig,
      });
    });
    
    return groups;
  }, [processedGroups, processedStaffGroups, processedTaxGroups, processedExpenseGroups, processedAccountGroups, processedItemGroups]);

  // Build tree structure: entity types as top-level, ONLY accounts (no groups) under each entity
  const accountTree = useMemo(() => {
    const tree: AccountTreeItem[] = [];
    const entityMap = new Map<string, AccountTreeItem>();
    
    // Keep entity naming/order aligned with left sidebar navigation labels.
    const entityTypes: Array<{ id: string; name: string; accountType: UnifiedAccount['accountType'] }> = [
      { id: 'entity-party', name: 'Parties', accountType: 'party' },
      { id: 'entity-bank', name: 'Bank/Cash', accountType: 'bank' },
      { id: 'entity-staff', name: STAFF_ENTITY_LABEL, accountType: 'staff' },
      { id: 'entity-tax', name: 'Tax', accountType: 'tax' },
      { id: 'entity-expense', name: 'Income & Expense', accountType: 'expense' },
    ];

    // Create entity type nodes
    entityTypes.forEach(entity => {
      const entityItem: AccountTreeItem = {
        id: entity.id,
        name: entity.name,
        balance: 0,
        debit: 0,
        credit: 0,
        type: 'group',
        level: 0,
        children: [],
        group: {
          id: entity.id,
          name: entity.name,
          balance: 0,
          debit: 0,
          credit: 0,
          groupType: entity.accountType,
        },
      };
      entityMap.set(entity.accountType, entityItem);
      tree.push(entityItem);
    });

    // Add ONLY accounts directly to their entity types (no groups)
    allUnifiedAccounts.forEach(account => {
      const accountItem: AccountTreeItem = {
        id: account.id,
        name: account.name,
        balance: account.balance || 0,
        debit: account.debit || 0,
        credit: account.credit || 0,
        type: 'account',
        parentId: undefined,
        level: 1,
        account: account,
      };

      // Add account directly to its entity type
      const entityItem = entityMap.get(account.accountType);
      if (entityItem) {
        entityItem.children = entityItem.children || [];
        entityItem.children.push(accountItem);
        entityItem.balance += account.balance || 0;
        entityItem.debit += account.debit || 0;
        entityItem.credit += account.credit || 0;
      }
    });

    // Sort tree items: accounts sorted by balance within each entity
    const sortItems = (items: AccountTreeItem[]): AccountTreeItem[] => {
      return items.sort((a, b) => {
        // Groups first, then accounts
        if (a.type !== b.type) {
          return a.type === 'group' ? -1 : 1;
        }
        // Then by balance (absolute value) - highest first
        return Math.abs(b.balance) - Math.abs(a.balance);
      }).map(item => ({
        ...item,
        children: item.children ? sortItems(item.children) : undefined,
      }));
    };

    // Filter out empty entity types
    const filteredTree = tree.filter(entity => {
      const hasChildren = entity.children && entity.children.length > 0;
      return hasChildren;
    });

    return sortItems(filteredTree);
  }, [allUnifiedAccounts]);

  // Flatten tree for filtering
  const flattenedItems = useMemo(() => {
    const flatten = (items: AccountTreeItem[], result: AccountTreeItem[] = []): AccountTreeItem[] => {
      items.forEach(item => {
        result.push(item);
        if (item.children) {
          flatten(item.children, result);
        }
      });
      return result;
    };
    return flatten(accountTree);
  }, [accountTree]);

  // Filter by search term
  const filteredTree = useMemo(() => {
    if (!searchTerm) return accountTree;
    
    const searchLower = searchTerm.toLowerCase();
    const filterTree = (items: AccountTreeItem[]): AccountTreeItem[] => {
      return items
        .filter(item => {
          const matches = item.name.toLowerCase().includes(searchLower);
          const childrenMatch = item.children ? filterTree(item.children).length > 0 : false;
          return matches || childrenMatch;
        })
        .map(item => ({
          ...item,
          children: item.children ? filterTree(item.children) : undefined,
        }));
    };
    return filterTree(accountTree);
  }, [accountTree, searchTerm]);

  // Group tree for desktop when mode is group (entity types -> groups)
  const groupTree = useMemo(() => {
    // Keep group-summary entity naming/order aligned with left sidebar navigation labels.
    const entityTypes: Array<{ id: string; name: string; groupType: UnifiedGroup['groupType'] }> = [
      { id: 'entity-party', name: 'Parties', groupType: 'party' },
      { id: 'entity-bank', name: 'Bank/Cash', groupType: 'bank' },
      { id: 'entity-staff', name: STAFF_ENTITY_LABEL, groupType: 'staff' },
      { id: 'entity-tax', name: 'Tax', groupType: 'tax' },
      { id: 'entity-expense', name: 'Income & Expense', groupType: 'expense' },
      { id: 'entity-item', name: 'Item', groupType: 'item' },
    ];
    const tree: AccountTreeItem[] = entityTypes.map(e => ({
      id: e.id,
      name: e.name,
      balance: 0,
      debit: 0,
      credit: 0,
      type: 'group',
      level: 0,
      children: [] as AccountTreeItem[],
      group: { id: e.id, name: e.name, balance: 0, debit: 0, credit: 0, groupType: e.groupType },
    }));
    // Build entity-wise hierarchy: system groups as parent, user groups under them.
    const groupsByType = new Map<UnifiedGroup["groupType"], UnifiedGroup[]>();
    allUnifiedGroups.forEach((g) => {
      const arr = groupsByType.get(g.groupType) || [];
      arr.push(g);
      groupsByType.set(g.groupType, arr);
    });
    tree.forEach((entityItem) => {
      const groupType = (entityItem.group as any)?.groupType as UnifiedGroup["groupType"];
      const entityGroups = groupsByType.get(groupType) || [];
      const groupMap = new Map(entityGroups.map((g) => [g.id, g]));
      const systemNodes = new Map<string, AccountTreeItem>();
      entityItem.children = [];
      // Expense entity may have legacy data where Direct/Indirect groups are not flagged system; treat them as pseudo-system parents for hierarchy.
      const isExpensePseudoSystem = (g?: UnifiedGroup): boolean => {
        if (!g || groupType !== "expense") return false;
        const id = String(g.id || "").toLowerCase();
        const name = String(g.name || "").toLowerCase();
        const parentId = String(g.parentId || "").toLowerCase();
        return (
          g.isSystemGroup === true ||
          parentId === "income" ||
          parentId === "expenses" ||
          id === "income" ||
          id === "expenses" ||
          id === "direct_income" ||
          id === "indirect_income" ||
          id === "direct_expense" ||
          id === "indirect_expense" ||
          name === "income" ||
          name === "expenses" ||
          name === "direct income" ||
          name === "indirect income" ||
          name === "direct expenses" ||
          name === "indirect expenses" ||
          name === "direct expense" ||
          name === "indirect expense"
        );
      };

      // System groups become level-1 parent nodes.
      entityGroups
        .filter((g) => (groupType === "expense" ? isExpensePseudoSystem(g) : g.isSystemGroup))
        .forEach((g) => {
          systemNodes.set(g.id, {
            id: g.id,
            name: g.name,
            balance: g.balance || 0,
            debit: g.debit || 0,
            credit: g.credit || 0,
            type: "group",
            parentId: undefined,
            level: 1,
            children: [],
            group: g,
          });
        });

      // Attach non-system groups under nearest system ancestor, otherwise keep top-level.
      entityGroups
        .filter((g) => !(groupType === "expense" ? isExpensePseudoSystem(g) : g.isSystemGroup))
        .forEach((g) => {
          let parentId = g.parentId;
          let systemAncestorId: string | undefined;
          while (parentId) {
            const parentGroup = groupMap.get(parentId);
            if (!parentGroup) break;
            if (groupType === "expense" ? isExpensePseudoSystem(parentGroup) : parentGroup.isSystemGroup) {
              systemAncestorId = parentGroup.id;
              break;
            }
            parentId = parentGroup.parentId;
          }
          // Fallback: in tax-like single-system trees, pin orphan user groups under that single system group.
          if (!systemAncestorId) {
            const systemIds = Array.from(systemNodes.keys());
            if ((groupType === "tax" || groupType === "staff") && systemIds.length === 1) {
              systemAncestorId = systemIds[0];
            }
          }
          const childNode: AccountTreeItem = {
            id: g.id,
            name: g.name,
            balance: g.balance || 0,
            debit: g.debit || 0,
            credit: g.credit || 0,
            type: "group",
            parentId: systemAncestorId,
            level: systemAncestorId ? 2 : 1,
            group: g,
          };
          if (systemAncestorId && systemNodes.has(systemAncestorId)) {
            systemNodes.get(systemAncestorId)!.children!.push(childNode);
          } else {
            entityItem.children!.push(childNode);
          }
        });

      // Recompute system-group balances from user-group children for collapsed aggregate display.
      systemNodes.forEach((systemNode) => {
        const children = systemNode.children || [];
        if (children.length > 0) {
          systemNode.balance = children.reduce((sum, child) => sum + (child.balance || 0), 0);
          systemNode.debit = children.reduce((sum, child) => sum + (child.debit || 0), 0);
          systemNode.credit = children.reduce((sum, child) => sum + (child.credit || 0), 0);
        }
      });

      // Income & Expense requires one extra parent level: Income/Expense -> system groups -> user groups.
      if (groupType === "expense") {
        // Only expense parent-like rows should sit under virtual Income/Expense parents.
        const expenseSystemNodes = Array.from(systemNodes.values())
          .filter((n) => isExpensePseudoSystem(n.group as UnifiedGroup))
          .sort((a, b) => a.name.localeCompare(b.name));
        const incomeParentNode: AccountTreeItem = {
          id: "expense-parent-income",
          name: "Income",
          balance: 0,
          debit: 0,
          credit: 0,
          type: "group",
          level: 1,
          children: [],
        };
        const expenseParentNode: AccountTreeItem = {
          id: "expense-parent-expense",
          name: "Expense",
          balance: 0,
          debit: 0,
          credit: 0,
          type: "group",
          level: 1,
          children: [],
        };

        expenseSystemNodes.forEach((systemNode) => {
          // Classify by parentId first, then id/name fallback so old data still renders correctly.
          const rawParentId = String(systemNode.group?.parentId || "").toLowerCase();
          const rawId = String(systemNode.id || "").toLowerCase();
          const rawName = String(systemNode.name || "").toLowerCase();
          const isIncomeNode =
            rawParentId === "income" ||
            rawId.includes("income") ||
            (rawName.includes("income") && !rawName.includes("expense"));
          const isExpenseNode =
            rawParentId === "expenses" ||
            rawId.includes("expense") ||
            rawName.includes("expense");

          if (isIncomeNode) {
            systemNode.level = 2;
            incomeParentNode.children!.push(systemNode);
            return;
          }
          if (isExpenseNode) {
            systemNode.level = 2;
            expenseParentNode.children!.push(systemNode);
            return;
          }
          // Safety: keep unclassified system groups visible under entity.
          entityItem.children!.push(systemNode);
        });

        if ((incomeParentNode.children || []).length > 0) {
          incomeParentNode.balance = incomeParentNode.children!.reduce((sum, child) => sum + (child.balance || 0), 0);
          incomeParentNode.debit = incomeParentNode.children!.reduce((sum, child) => sum + (child.debit || 0), 0);
          incomeParentNode.credit = incomeParentNode.children!.reduce((sum, child) => sum + (child.credit || 0), 0);
          entityItem.children!.push(incomeParentNode);
        }
        if ((expenseParentNode.children || []).length > 0) {
          expenseParentNode.balance = expenseParentNode.children!.reduce((sum, child) => sum + (child.balance || 0), 0);
          expenseParentNode.debit = expenseParentNode.children!.reduce((sum, child) => sum + (child.debit || 0), 0);
          expenseParentNode.credit = expenseParentNode.children!.reduce((sum, child) => sum + (child.credit || 0), 0);
          entityItem.children!.push(expenseParentNode);
        }
      } else {
        systemNodes.forEach((systemNode) => {
          entityItem.children!.push(systemNode);
        });
      }

      // Keep ordering deterministic: system groups first, then standalone user groups, by name.
      entityItem.children = (entityItem.children || [])
        .map((child) => ({
          ...child,
          children: child.children?.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => {
          const aIsSystem = Boolean(a.group?.isSystemGroup);
          const bIsSystem = Boolean(b.group?.isSystemGroup);
          if (aIsSystem !== bIsSystem) return aIsSystem ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      entityItem.balance = (entityItem.children || []).reduce((sum, child) => sum + (child.balance || 0), 0);
      entityItem.debit = (entityItem.children || []).reduce((sum, child) => sum + (child.debit || 0), 0);
      entityItem.credit = (entityItem.children || []).reduce((sum, child) => sum + (child.credit || 0), 0);
    });
    const addUngroupedRow = (
      groupType: UnifiedGroup["groupType"],
      rows: any[],
      id: string,
      storageGroupId: string
    ) => {
      if (!rows.some((r: any) => !r.groupId || r.groupId === storageGroupId)) return;
      const entityRow = tree.find((t) => (t.group as any)?.groupType === groupType);
      if (!entityRow) return;
      const ungroupedRows = rows.filter((r: any) => !r.groupId || r.groupId === storageGroupId);
      const balance = ungroupedRows.reduce((sum, r) => sum + (r.balance || 0), 0);
      const debit = ungroupedRows.reduce((sum, r) => sum + (r.debit || 0), 0);
      const credit = ungroupedRows.reduce((sum, r) => sum + (r.credit || 0), 0);
      // Show Ungrouped only when at least one ledger/account is saved without group.
      const ungroupedNode: AccountTreeItem = {
        id,
        name: "Ungrouped",
        balance,
        debit,
        credit,
        type: "group",
        // Keep as child category when a system group exists.
        level: 1,
        group: {
          id,
          name: "Ungrouped",
          balance,
          debit,
          credit,
          groupType,
          isSystemGroup: false,
          entity: { id, name: "Ungrouped", balance } as any,
        },
      };
      const firstSystemChild = (entityRow.children || []).find((c) => c.group?.isSystemGroup);
      if (firstSystemChild) {
        firstSystemChild.children = firstSystemChild.children || [];
        ungroupedNode.parentId = firstSystemChild.id;
        ungroupedNode.level = 2;
        // Place ungrouped as first child for quick access.
        firstSystemChild.children.unshift(ungroupedNode);
        firstSystemChild.balance = (firstSystemChild.children || []).reduce((sum, child) => sum + (child.balance || 0), 0);
        firstSystemChild.debit = (firstSystemChild.children || []).reduce((sum, child) => sum + (child.debit || 0), 0);
        firstSystemChild.credit = (firstSystemChild.children || []).reduce((sum, child) => sum + (child.credit || 0), 0);
      } else {
        entityRow.children!.unshift(ungroupedNode);
      }
    };
    addUngroupedRow("bank", processedAccounts, "ungrouped-bank", "ungrouped_account");
    addUngroupedRow("staff", processedStaff, "ungrouped-staff", "ungrouped_staff");
    addUngroupedRow("tax", processedTaxes, "ungrouped-tax", "ungrouped_tax");
    addUngroupedRow("expense", processedExpenseAccounts, "ungrouped-expense", "ungrouped_expense");
    return tree.filter(e => e.children && e.children.length > 0);
  }, [allUnifiedGroups, processedParties, processedAccounts, processedStaff, processedTaxes, processedExpenseAccounts]);

  const flattenedGroupItems = useMemo(() => {
    const flatten = (items: AccountTreeItem[], result: AccountTreeItem[] = []): AccountTreeItem[] => {
      items.forEach(item => {
        result.push(item);
        if (item.children) flatten(item.children, result);
      });
      return result;
    };
    return flatten(groupTree);
  }, [groupTree]);

  const filteredGroupTree = useMemo(() => {
    if (!searchTerm) return groupTree;
    const q = searchTerm.toLowerCase();
    const filterTree = (items: AccountTreeItem[]): AccountTreeItem[] => {
      return items
        .filter(item => {
          const matches = item.name.toLowerCase().includes(q);
          const childrenMatch = item.children ? filterTree(item.children).length > 0 : false;
          return matches || childrenMatch;
        })
        .map(item => ({ ...item, children: item.children ? filterTree(item.children) : undefined }));
    };
    return filterTree(groupTree);
  }, [groupTree, searchTerm]);

  const icParties = useMemo(
    () => processedParties.filter((p) => isInterCompanyPartyListAccount(p)),
    [processedParties]
  );

  const partyGroupsForList = useMemo(() => {
    const userDefinedGroups = processedGroups.filter((g) => {
      const anyG = g as any;
      const isReportOnly = anyG.isReportOnly === true;
      const isAutoUngrouped = anyG.isAutoUngrouped === true;
      const isSystemParent =
        anyG.isSystemReserved === true || isSystemParentGroup("groups", anyG.id);
      return !isReportOnly && !isSystemParent && !isAutoUngrouped;
    });

    const syntheticGroups: Group[] = [];
    for (const branch of PARTY_SYSTEM_GROUP_OPTIONS) {
      syntheticGroups.push(
        buildPartySystemBranchSelectionGroup(branch.id, companyId, 0) as Group
      );
    }
    return [...userDefinedGroups, ...syntheticGroups];
  }, [processedGroups, companyId]);

  const icCompanyGroupForDetails = useMemo((): Group | null => {
    if (icParties.length === 0) return null;
    return {
      id: IC_COMPANY_PARTY_GROUP_ID,
      name: "IC Company",
      balance: icParties.reduce((sum, p) => sum + (p.balance || 0), 0),
      companyId,
      debit: icParties.reduce((sum, p) => sum + (p.debit || 0), 0),
      credit: icParties.reduce((sum, p) => sum + (p.credit || 0), 0),
      parentId: PARTY_SYSTEM_DEBTORS_ID,
    };
  }, [icParties, companyId]);

  const icPeerCompanyRowsForGroupTab = useMemo(
    () => buildIcPeerCompanyGroupRows(icParties),
    [icParties]
  );

  const mapAccountTreeToSummaryNodes = useCallback((items: AccountTreeItem[]): GroupSummaryTreeNode[] => {
    return items.map((item) => {
      const isEntityRow = item.id.startsWith("entity-");
      const isVirtualExpenseParent = item.id.startsWith("expense-parent-");
      return {
        id: item.id,
        name: item.name,
        balance: item.balance || 0,
        level: item.level,
        isEntityRow,
        isVirtualExpenseParent,
        isSystemGroup: Boolean(item.group?.isSystemGroup),
        groupId: isEntityRow || isVirtualExpenseParent ? undefined : item.group?.id || item.id,
        groupType: (item.group as any)?.groupType,
        children: item.children?.length ? mapAccountTreeToSummaryNodes(item.children) : undefined,
      };
    });
  }, []);

  const groupSummaryTree = useMemo((): GroupSummaryTreeNode[] => {
    const toAccountNode = (
      accountType: UnifiedAccount["accountType"],
      id: string,
      name: string,
      balance: number
    ): GroupSummaryTreeNode => ({
      id: `gs-account-${accountType}-${id}`,
      name,
      balance: balance || 0,
      level: 0,
      isAccountRow: true,
      accountId: id,
      accountType,
    });

    const accountsForGroup = (groupId: string, groupType?: string): GroupSummaryTreeNode[] => {
      if (!groupType) return [];
      if (groupType === "party") {
        if (isPartySystemGroupId(groupId)) {
          return processedParties
            .filter(
              (p) =>
                !isInterCompanyPartyListAccount(p) && isPartyDirectOnSystemBranch(p, groupId)
            )
            .map((p) => toAccountNode("party", p.id, p.name, p.balance || 0));
        }
        return processedParties
          .filter(
            (p) =>
              !isInterCompanyPartyListAccount(p) &&
              resolvePartyListGroupBucketId(p) === groupId
          )
          .map((p) => toAccountNode("party", p.id, p.name, p.balance || 0));
      }
      if (groupType === "bank") {
        return processedAccounts
          .filter((a) =>
            groupId === "ungrouped-bank"
              ? !a.groupId || a.groupId === "ungrouped_account"
              : a.groupId === groupId
          )
          .map((a) => toAccountNode("bank", a.id, a.accountName, a.balance || 0));
      }
      if (groupType === "staff") {
        return processedStaff
          .filter((s: any) =>
            groupId === "ungrouped-staff"
              ? !s.groupId || s.groupId === "ungrouped_staff"
              : s.groupId === groupId
          )
          .map((s) => toAccountNode("staff", s.id, s.name, s.balance || 0));
      }
      if (groupType === "tax") {
        return processedTaxes
          .filter((t: any) =>
            groupId === "ungrouped-tax"
              ? !t.groupId || t.groupId === "ungrouped_tax"
              : t.groupId === groupId
          )
          .map((t) => toAccountNode("tax", t.id, t.name, t.balance || 0));
      }
      if (groupType === "expense") {
        return processedExpenseAccounts
          .filter((e: any) =>
            groupId === "ungrouped-expense"
              ? !e.groupId || e.groupId === "ungrouped_expense"
              : e.groupId === groupId
          )
          .map((e) => toAccountNode("expense", e.id, e.name, e.balance || 0));
      }
      return [];
    };

    const appendAccountLeaves = (nodes: GroupSummaryTreeNode[]): GroupSummaryTreeNode[] =>
      nodes.map((node) => {
        const groupChildren = node.children ? appendAccountLeaves(node.children) : [];
        const accountChildren =
          node.groupId &&
          node.groupType &&
          !node.isEntityRow &&
          !node.isVirtualExpenseParent &&
          !node.isIcEntity &&
          !node.isIcPeerRow &&
          !node.isIcMemberRow &&
          !node.isAccountRow
            ? accountsForGroup(node.groupId, node.groupType)
            : [];
        const children = [...groupChildren, ...accountChildren];
        return { ...node, children: children.length ? children : undefined };
      });

    let base = mapAccountTreeToSummaryNodes(filteredGroupTree);
    if (!groupExpandOnly) {
      base = appendAccountLeaves(base);
    }

    if (icParties.length === 0 || !icCompanyGroupForDetails) return base;

    const icBalance = icCompanyGroupForDetails.balance || 0;
    const peerRows = icPeerCompanyRowsForGroupTab;
    const icEntity: GroupSummaryTreeNode = {
      id: "entity-ic-company",
      name: "IC Company",
      balance: icBalance,
      level: 0,
      isIcEntity: true,
      groupId: IC_COMPANY_PARTY_GROUP_ID,
      children: peerRows.map((peer) => ({
        id: peer.id,
        name: icPeerCompanyGroupListTitleLines(peer).primary,
        balance: peer.balance || 0,
        level: 1,
        isIcPeerRow: true,
        icPeerCompanyId: peer.id,
        groupId: IC_COMPANY_PARTY_GROUP_ID,
        children: groupExpandOnly
          ? undefined
          : (peer.icMemberParties || []).map((member) => ({
              id: member.id,
              name: interCompanyClearingAccountDisplayName(member),
              balance: member.balance || 0,
              level: 2,
              isIcMemberRow: true,
              icPeerCompanyId: peer.id,
              icMemberAccountId: member.id,
              groupId: IC_COMPANY_PARTY_GROUP_ID,
            })),
      })),
    };
    return [...base, icEntity];
  }, [
    filteredGroupTree,
    groupExpandOnly,
    icParties.length,
    icCompanyGroupForDetails,
    icPeerCompanyRowsForGroupTab,
    mapAccountTreeToSummaryNodes,
    processedParties,
    processedAccounts,
    processedStaff,
    processedTaxes,
    processedExpenseAccounts,
  ]);

  const partiesForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    if (selectedGroup.id === IC_COMPANY_PARTY_GROUP_ID) {
      return buildIcPeerCompanyGroupRows(icParties);
    }
    if (selectedGroup.groupType === "party") {
      return filterPartiesForPartyGroupScope(
        selectedGroup.id,
        processedParties,
        partyGroupsForList
      );
    }
    return [];
  }, [selectedGroup, icParties, processedParties, partyGroupsForList]);

  type GroupSummaryListRow = Group & {
    groupType?: UnifiedGroup["groupType"] | "account";
    isSystemGroup?: boolean;
  };

  const toUnifiedGroupFromListGroup = useCallback(
    (group: GroupSummaryListRow): UnifiedGroup => {
      const existing = allUnifiedGroups.find((g) => g.id === group.id);
      if (existing) return existing;
      const groupType = (
        group.groupType === "account" ? "bank" : group.groupType || "party"
      ) as UnifiedGroup["groupType"];
      return {
        id: group.id,
        name: group.name,
        balance: group.balance || 0,
        debit: group.debit || 0,
        credit: group.credit || 0,
        groupType,
        parentId: group.parentId,
        isSystemGroup: Boolean(
          group.isSystemGroup ||
            (group as any).isSystemReserved ||
            isPartySystemGroupId(group.id)
        ),
        entity: group,
      };
    },
    [allUnifiedGroups]
  );

  const handleSelectIcCompanyGroup = useCallback(
    (options?: IcCompanyGroupTabSelectOptions) => {
      if (!icCompanyGroupForDetails) return;
      setSelectedIcPeerCompanyId(options?.peerCompanyId ?? null);
      setSelectedIcMemberAccountId(options?.memberAccountId ?? null);
      setSelectedGroupMemberFilterId(null);
      setSelectedAccount(null);
      setSelectedGroup(
        toUnifiedGroupFromListGroup({ ...icCompanyGroupForDetails, groupType: "party" })
      );
    },
    [icCompanyGroupForDetails, toUnifiedGroupFromListGroup]
  );

  const handleSelectGroupFromTree = useCallback(
    (groupId: string) => {
      setSelectedIcPeerCompanyId(null);
      setSelectedIcMemberAccountId(null);
      setSelectedGroupMemberFilterId(null);
      setSelectedAccount(null);
      const unified = allUnifiedGroups.find((g) => g.id === groupId);
      if (unified) {
        setSelectedGroup(unified);
        return;
      }
      const partyGroup = partyGroupsForList.find((g) => g.id === groupId);
      if (partyGroup) {
        setSelectedGroup(toUnifiedGroupFromListGroup({ ...partyGroup, groupType: "party" }));
      }
    },
    [allUnifiedGroups, partyGroupsForList, toUnifiedGroupFromListGroup]
  );

  const handleSelectAccountFromTree = useCallback(
    (accountId: string) => {
      const acc = allUnifiedAccounts.find((a) => a.id === accountId);
      if (!acc) return;
      setSelectedAccount(acc);
      setSelectedGroup(null);
      setSelectedIcPeerCompanyId(null);
      setSelectedIcMemberAccountId(null);
      setSelectedGroupMemberFilterId(null);
    },
    [allUnifiedAccounts]
  );

  const toggleGroupSummaryExpand = useCallback((nodeId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        return next;
      }
      if (nodeId.startsWith("entity-")) {
        for (const id of [...next]) {
          if (id.startsWith("entity-")) next.delete(id);
        }
      }
      next.add(nodeId);
      return next;
    });
  }, []);

  const totalBalance = useMemo(
    () =>
      mode === "group"
        ? groupSummaryTree.reduce((sum, item) => sum + (item.balance || 0), 0)
        : flattenedItems.reduce((sum, item) => sum + (item.balance || 0), 0),
    [mode, flattenedItems, groupSummaryTree]
  );

  // Mobile: entity dropdown options (Party, Staff, Bank, Tax, Income & Expense)
  const entityDropdownOptions = useMemo(() => {
    return accountTree
      .filter((e) => e.id.startsWith("entity-"))
      .map((e) => ({ value: (e.group as any)?.groupType || e.id.replace("entity-", ""), label: e.name }));
  }, [accountTree]);

  // Mobile: selected entity type (for filtering accounts or groups)
  const selectedEntityType = useMemo(() => {
    if (mode === "group") {
      if (!selectedGroup) return entityDropdownOptions[0]?.value || "party";
      return (selectedGroup as any).groupType || "party";
    }
    if (!selectedAccount) return entityDropdownOptions[0]?.value || "party";
    return selectedAccount.accountType;
  }, [mode, selectedAccount, selectedGroup, entityDropdownOptions]);

  const buildUngroupedVirtualGroup = useCallback((groupType: UnifiedGroup["groupType"]): UnifiedGroup | null => {
    if (groupType === "party") {
      return null;
    }
    if (groupType === "staff") {
      const rows = processedStaff.filter((s: any) => !s.groupId || s.groupId === "ungrouped_staff");
      if (rows.length === 0) return null;
      const balance = rows.reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
      return { id: "ungrouped-staff", name: "Ungrouped", balance, debit: rows.reduce((sum: number, r: any) => sum + (r.debit || 0), 0), credit: rows.reduce((sum: number, r: any) => sum + (r.credit || 0), 0), groupType: "staff", isSystemGroup: false, entity: { id: "ungrouped-staff", name: "Ungrouped", balance } as any };
    }
    if (groupType === "tax") {
      const rows = processedTaxes.filter((t: any) => !t.groupId || t.groupId === "ungrouped_tax");
      if (rows.length === 0) return null;
      const balance = rows.reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
      return { id: "ungrouped-tax", name: "Ungrouped", balance, debit: rows.reduce((sum: number, r: any) => sum + (r.debit || 0), 0), credit: rows.reduce((sum: number, r: any) => sum + (r.credit || 0), 0), groupType: "tax", isSystemGroup: false, entity: { id: "ungrouped-tax", name: "Ungrouped", balance } as any };
    }
    if (groupType === "bank") {
      const rows = processedAccounts.filter((a: any) => !a.groupId || a.groupId === "ungrouped_account");
      if (rows.length === 0) return null;
      const balance = rows.reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
      return { id: "ungrouped-bank", name: "Ungrouped", balance, debit: rows.reduce((sum: number, r: any) => sum + (r.debit || 0), 0), credit: rows.reduce((sum: number, r: any) => sum + (r.credit || 0), 0), groupType: "bank", isSystemGroup: false, entity: { id: "ungrouped-bank", name: "Ungrouped", balance } as any };
    }
    const rows = processedExpenseAccounts.filter((e: any) => !e.groupId || e.groupId === "ungrouped_expense");
    if (rows.length === 0) return null;
    const balance = rows.reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
    return { id: "ungrouped-expense", name: "Ungrouped", balance, debit: rows.reduce((sum: number, r: any) => sum + (r.debit || 0), 0), credit: rows.reduce((sum: number, r: any) => sum + (r.credit || 0), 0), groupType: "expense", isSystemGroup: false, entity: { id: "ungrouped-expense", name: "Ungrouped", balance } as any };
  }, [processedParties, processedStaff, processedTaxes, processedAccounts, processedExpenseAccounts]);

  // Mobile: account dropdown options (accounts under selected entity)
  const accountDropdownOptions = useMemo(() => {
    const entityItem = accountTree.find((e) => e.id.startsWith("entity-") && (e.group as any)?.groupType === selectedEntityType);
    if (!entityItem?.children) return [];
    return entityItem.children
      .filter((c) => c.type === "account" && c.account)
      .map((c) => ({ value: c.account!.id, label: c.account!.name }));
  }, [accountTree, selectedEntityType]);

  // Mobile: group dropdown options (groups under selected entity) - for Group Summary mode
  const groupDropdownOptions = useMemo(() => {
    if (mode !== "group") return [];
    if (selectedEntityType === "party") {
      return partyGroupsForList.map((g) => ({ value: g.id, label: g.name }));
    }
    const base = allUnifiedGroups
      .filter((g) => (g as any).groupType === selectedEntityType)
      .map((g) => ({ value: g.id, label: g.name }));
    const ungrouped = buildUngroupedVirtualGroup(selectedEntityType as UnifiedGroup["groupType"]);
    if (ungrouped) {
      base.unshift({ value: ungrouped.id, label: ungrouped.name });
    }
    return base;
  }, [mode, selectedEntityType, allUnifiedGroups, buildUngroupedVirtualGroup, partyGroupsForList]);

  // Resolve selected scope: collapsed system group => include all nested user groups.
  const selectedGroupScopeIds = useMemo(() => {
    if (mode !== "group" || !selectedGroup) return new Set<string>();
    // Any virtual ungrouped group behaves like a single concrete scope.
    if (selectedGroup.id.startsWith("ungrouped-")) return new Set<string>([selectedGroup.id]);
    const selectedIsSystem = Boolean(selectedGroup.isSystemGroup);
    const selectedExpanded = expandedGroups.has(selectedGroup.id);
    if (!selectedIsSystem || selectedExpanded) {
      return new Set<string>([selectedGroup.id]);
    }

    const byId = new Map(allUnifiedGroups.map((g) => [g.id, g]));
    const descendants = new Set<string>();
    const queue = [selectedGroup.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      allUnifiedGroups.forEach((g) => {
        if (g.parentId === current) {
          queue.push(g.id);
          if (!g.isSystemGroup && byId.has(g.id)) {
            descendants.add(g.id);
          }
        }
      });
    }

    // Fallback to selected group itself when no child user groups exist.
    if (descendants.size === 0) {
      return new Set<string>([selectedGroup.id]);
    }
    return descendants;
  }, [mode, selectedGroup, expandedGroups, allUnifiedGroups]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      const wasExpanded = next.has(groupId);
      
      if (wasExpanded) {
        next.delete(groupId);
      } else {
        // If expanding an entity type, collapse all other entity types first
        if (groupId.startsWith('entity-')) {
          // Remove all other entity types from expanded set
          next.clear();
          // Add only this entity type
          next.add(groupId);
          
          // Auto-select first account/group when expanding an entity type
          const findEntityInTree = (items: AccountTreeItem[]): AccountTreeItem | null => {
            for (const item of items) {
              if (item.id === groupId) return item;
              if (item.children) {
                const found = findEntityInTree(item.children);
                if (found) return found;
              }
            }
            return null;
          };
          const treeToUse = mode === "group" ? groupTree : accountTree;
          const entityItem = findEntityInTree(treeToUse);
          if (entityItem && entityItem.children && entityItem.children.length > 0) {
            // Skip virtual parent rows while auto-selecting the first real group.
            const findFirstSelectableGroup = (items: AccountTreeItem[]): UnifiedGroup | null => {
              for (const row of items) {
                if (row.group && !row.id.startsWith("entity-") && !row.id.startsWith("expense-parent-")) {
                  return row.group as UnifiedGroup;
                }
                if (row.children?.length) {
                  const nested = findFirstSelectableGroup(row.children);
                  if (nested) return nested;
                }
              }
              return null;
            };
            if (mode === "group") {
              const firstGroup = findFirstSelectableGroup(entityItem.children);
              if (firstGroup) {
                setTimeout(() => {
                  setSelectedGroup(firstGroup);
                  setSelectedAccount(null);
                }, 0);
              }
            } else {
              const firstAccount = entityItem.children.find(child => child.type === 'account' && child.account);
              if (firstAccount?.account) {
                setTimeout(() => {
                  setSelectedAccount(firstAccount.account!);
                  setSelectedGroup(null);
                }, 0);
              }
            }
          }
        } else {
          // For non-entity groups, toggle and prefer first user group when expanding a system group.
          next.add(groupId);
          if (mode === "group") {
            const findNode = (items: AccountTreeItem[]): AccountTreeItem | null => {
              for (const item of items) {
                if (item.id === groupId) return item;
                if (item.children) {
                  const child = findNode(item.children);
                  if (child) return child;
                }
              }
              return null;
            };
            const node = findNode(groupTree);
            if (node?.group?.isSystemGroup && node.children && node.children.length > 0 && selectedGroup?.id === groupId) {
              const firstUserGroup = node.children.find((child) => Boolean(child.group));
              if (firstUserGroup?.group) {
                setTimeout(() => {
                  setSelectedGroup(firstUserGroup.group as UnifiedGroup);
                  setSelectedAccount(null);
                }, 0);
              }
            }
          }
        }
      }
      
      return next;
    });
  }, [accountTree, groupTree, mode, processedParties, selectedGroup]);

  const handleSelectItem = useCallback((item: AccountTreeItem) => {
    // Entity rows and virtual Income/Expense parent rows should only expand/collapse, not open details.
    if (item.id.startsWith('entity-') || item.id.startsWith("expense-parent-")) {
      // Just toggle expand/collapse, don't select for details
      toggleGroup(item.id);
      return;
    }
    
    if (mode === "group") {
      if (item.group && !item.id.startsWith("entity-")) {
        const grp = item.group as UnifiedGroup;
        setSelectedGroup(grp);
        setSelectedAccount(null);
      }
    } else if (item.type === 'account' && item.account) {
      setSelectedAccount(item.account);
      setSelectedGroup(null);
    }
  }, [toggleGroup, mode]);

  const REPORT_MEMORY_KEY = mode === "group" ? "reportGroupStatementState" : "reportAccountsStatementState";

  // Restore last-visited account/group or auto-expand first entity and select first
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (mode === "group") {
      if (
        groupSummaryTree.length === 0 &&
        !buildUngroupedVirtualGroup("party") &&
        !buildUngroupedVirtualGroup("bank") &&
        !buildUngroupedVirtualGroup("staff") &&
        !buildUngroupedVirtualGroup("tax") &&
        !buildUngroupedVirtualGroup("expense")
      ) return;
      hasAutoSelected.current = true;
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
        const saved = raw ? (JSON.parse(raw) as { groupId?: string }) : null;
        const savedGroupId = saved?.groupId;
        if (savedGroupId) {
          const savedIsUngrouped = savedGroupId.startsWith("ungrouped-");
          const found = savedIsUngrouped
            ? buildUngroupedVirtualGroup((savedGroupId.replace("ungrouped-", "") as UnifiedGroup["groupType"]))
            : allUnifiedGroups.find((g) => g.id === savedGroupId) ||
              (savedGroupId === IC_COMPANY_PARTY_GROUP_ID && icCompanyGroupForDetails
                ? toUnifiedGroupFromListGroup({ ...icCompanyGroupForDetails, groupType: "party" })
                : partyGroupsForList.find((g) => g.id === savedGroupId)
                  ? toUnifiedGroupFromListGroup({
                      ...partyGroupsForList.find((g) => g.id === savedGroupId)!,
                      groupType: "party",
                    })
                  : null);
          if (found) {
            setSelectedGroup(found as UnifiedGroup);
            setSelectedAccount(null);
            if (savedGroupId === IC_COMPANY_PARTY_GROUP_ID) {
              setSelectedIcPeerCompanyId(null);
              setSelectedIcMemberAccountId(null);
            }
            return;
          }
        }
      } catch (_) {}
      return;
    }
    if (accountTree.length === 0) return;
    hasAutoSelected.current = true;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { accountId?: string }) : null;
      const savedAccountId = saved?.accountId;
      if (savedAccountId) {
        for (const entity of accountTree) {
          if (!entity.id.startsWith("entity-") || !entity.children) continue;
          const accountItem = entity.children.find((c) => c.type === "account" && c.account?.id === savedAccountId);
          if (accountItem?.account) {
            setExpandedGroups((prev) => {
              const next = new Set(prev);
              next.clear();
              next.add(entity.id);
              return next;
            });
            setTimeout(() => {
              setSelectedAccount(accountItem.account!);
              setSelectedGroup(null);
            }, 50);
            return;
          }
        }
      }
    } catch (_) {}
    const firstEntity = accountTree[0];
    if (firstEntity?.id.startsWith("entity-")) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.clear();
        next.add(firstEntity.id);
        return next;
      });
      if (firstEntity.children?.length) {
        const firstAccount = firstEntity.children.find((c) => c.type === "account" && c.account);
        if (firstAccount?.account) {
          setTimeout(() => {
            setSelectedAccount(firstAccount.account!);
            setSelectedGroup(null);
          }, 100);
        }
      }
    }
  }, [accountTree, allUnifiedGroups, groupSummaryTree, icCompanyGroupForDetails, partyGroupsForList, mode, buildUngroupedVirtualGroup, toUnifiedGroupFromListGroup]);

  useEffect(() => {
    if (mode === "group" && selectedGroup && typeof window !== "undefined") {
      try {
        localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ groupId: selectedGroup.id }));
      } catch (_) {}
    }
  }, [mode, selectedGroup?.id]);

  useEffect(() => {
    if (mode === "account" && selectedAccount && typeof window !== "undefined") {
      try {
        localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ accountId: selectedAccount.id }));
      } catch (_) {}
    }
  }, [mode, selectedAccount?.id]);

  useEffect(() => {
    const isParty =
      selectedAccount?.accountType === "party" ||
      (!!selectedGroup && (selectedGroup as any).groupType === "party");
    onPartySelectionChange?.(isParty);
  }, [selectedAccount?.accountType, selectedGroup, onPartySelectionChange]);

  // Merge vouchersUserNames with fetched userNames
  // Voucher snapshot naam (Auto) ko page-level Firestore fetch se overwrite na hon
  const mergedUserNames = useMemo(() => mergeLedgerUserDisplayNameMaps(vouchersUserNames || {}, userNames), [vouchersUserNames, userNames]);

  // useTransactions for mobile - account or group
  const accountContext = selectedAccount?.accountType === "bank" ? "account" : (selectedAccount?.accountType || "party");
  const accountEntityList = useMemo(() => {
    if (!selectedAccount) return undefined;
    switch (selectedAccount.accountType) {
      case "party":
        return processedParties;
      case "staff":
        return processedStaff;
      case "tax":
        return processedTaxes;
      case "expense":
        return processedExpenseAccounts;
      case "bank":
        return processedAccounts;
      default:
        return undefined;
    }
  }, [selectedAccount, processedParties, processedStaff, processedTaxes, processedExpenseAccounts, processedAccounts]);

  // Group entity for useTransactions when mode is group
  const groupEntityForTransactions = useMemo(() => {
    if (mode !== "group" || !selectedGroup?.entity) return null;
    const group = selectedGroup.entity as any;
    const groupType = (selectedGroup as any).groupType;
    // For collapsed system groups we aggregate all nested user groups by scope IDs.
    const inScope = (groupId?: string) => selectedGroupScopeIds.has(groupId || "");
    if (groupType === "expense") {
      const accounts = selectedGroup.id === "ungrouped-expense"
        ? processedExpenseAccounts.filter((e: any) => !e.groupId || e.groupId === "ungrouped_expense")
        : processedExpenseAccounts.filter((e: any) => inScope(e.groupId));
      return { ...group, items: accounts, expenseGroupIds: Array.from(selectedGroupScopeIds) };
    }
    if (groupType === "party") {
      const parties = isPartySystemGroupId(selectedGroup.id)
        ? processedParties.filter((p: any) => isPartyDirectOnSystemBranch(p, selectedGroup.id))
        : processedParties.filter((p: any) => inScope(p.groupId));
      return { ...group, items: parties };
    }
    if (groupType === "staff") {
      const staff = selectedGroup.id === "ungrouped-staff"
        ? processedStaff.filter((s: any) => !s.groupId || s.groupId === "ungrouped_staff")
        : processedStaff.filter((s: any) => inScope(s.groupId));
      return { ...group, items: staff };
    }
    if (groupType === "tax") {
      const taxes = selectedGroup.id === "ungrouped-tax"
        ? processedTaxes.filter((t: any) => !t.groupId || t.groupId === "ungrouped_tax")
        : processedTaxes.filter((t: any) => inScope(t.groupId));
      return { ...group, items: taxes };
    }
    if (groupType === "bank" || groupType === "account") {
      const accounts = selectedGroup.id === "ungrouped-bank"
        ? processedAccounts.filter((a: any) => !a.groupId || a.groupId === "ungrouped_account")
        : processedAccounts.filter((a: any) => inScope(a.groupId));
      return { ...group, items: accounts };
    }
    return { ...group, items: [] };
  }, [mode, selectedGroup, selectedGroupScopeIds, processedParties, processedStaff, processedTaxes, processedExpenseAccounts, processedAccounts]);

  const groupEntityList = useMemo(() => {
    if (mode !== "group" || !selectedGroup) return undefined;
    const groupType = (selectedGroup as any).groupType;
    // Keep entity-list aligned with selected group scope so detail helpers stay consistent.
    if (groupType === "expense") {
      if (selectedGroup.id === "ungrouped-expense") return processedExpenseAccounts.filter((e: any) => !e.groupId || e.groupId === "ungrouped_expense");
      return processedExpenseAccounts.filter((e: any) => selectedGroupScopeIds.has(e.groupId || ""));
    }
    if (groupType === "party") {
      if (isPartySystemGroupId(selectedGroup.id)) {
        return processedParties.filter((p: any) => isPartyDirectOnSystemBranch(p, selectedGroup.id));
      }
      return processedParties.filter((p: any) => selectedGroupScopeIds.has(p.groupId || ""));
    }
    if (groupType === "staff") {
      if (selectedGroup.id === "ungrouped-staff") return processedStaff.filter((s: any) => !s.groupId || s.groupId === "ungrouped_staff");
      return processedStaff.filter((s: any) => selectedGroupScopeIds.has(s.groupId || ""));
    }
    if (groupType === "tax") {
      if (selectedGroup.id === "ungrouped-tax") return processedTaxes.filter((t: any) => !t.groupId || t.groupId === "ungrouped_tax");
      return processedTaxes.filter((t: any) => selectedGroupScopeIds.has(t.groupId || ""));
    }
    if (groupType === "bank" || groupType === "account") {
      if (selectedGroup.id === "ungrouped-bank") return processedAccounts.filter((a: any) => !a.groupId || a.groupId === "ungrouped_account");
      return processedAccounts.filter((a: any) => selectedGroupScopeIds.has(a.groupId || ""));
    }
    return undefined;
  }, [mode, selectedGroup, selectedGroupScopeIds, processedParties, processedStaff, processedTaxes, processedExpenseAccounts, processedAccounts]);

  const activeEntity = mode === "group" ? groupEntityForTransactions : selectedAccount?.entity ?? null;
  const activeContext = mode === "group" ? "group" : (accountContext as any);
  const activeEntityList = mode === "group" ? groupEntityList : accountEntityList;

  const {
    processedTransactions,
    openingBalanceForPeriod,
    periodDr,
    periodCr,
    closingBalance,
  } = useTransactions(
    activeEntity,
    activeContext,
    dateRange,
    undefined,
    activeEntityList,
    allVouchers,
    undefined,
    undefined,
    undefined,
    journalAccountNames,
    mergedUserNames
  );

  // Mobile: report display transactions (last 10 when no date filter)
  const reportDisplayTransactions = useMemo(() => {
    if (hasDateFilter) return processedTransactions;
    if (processedTransactions.length <= 10) return processedTransactions;
    return processedTransactions.slice(-10);
  }, [processedTransactions, hasDateFilter]);

  const filteredReportTransactions = useMemo(() => {
    if (!transactionSearch.trim()) return reportDisplayTransactions;
    const q = transactionSearch.trim().toLowerCase();
    return reportDisplayTransactions.filter((t: any) => {
      const vno = (t.voucherNumber || "").toLowerCase();
      const narr = (t.narration || "").toLowerCase();
      const type = voucherTypeSearchText(t.type);
      const amount = String(t.debit ?? t.credit ?? t.total ?? "").toLowerCase();
      return vno.includes(q) || narr.includes(q) || type.includes(q) || amount.includes(q);
    });
  }, [reportDisplayTransactions, transactionSearch]);

  // Summary cards: for expense use direct_income/direct_expense, for others use periodDr/periodCr
  const isExpenseContext = (mode === "account" && selectedAccount?.accountType === "expense") || (mode === "group" && (selectedGroup as any)?.groupType === "expense");
  const accountSummaryData = useMemo(() => {
    const hasSelection = mode === "account" ? selectedAccount : selectedGroup;
    if (!hasSelection) return { income: 0, expense: 0 };
    if (isExpenseContext) {
      return {
        income: processedTransactions
          .filter((v: any) => v.type === "direct_income")
          .reduce((sum: number, v: any) => sum + (v.amount || 0), 0),
        expense: processedTransactions
          .filter((v: any) => v.type === "direct_expense")
          .reduce((sum: number, v: any) => sum + (v.amount || 0), 0),
      };
    }
    return { income: periodDr, expense: periodCr };
  }, [mode, selectedAccount, selectedGroup, isExpenseContext, processedTransactions, periodDr, periodCr]);

  const summaryCards = useMemo(
    () => [
      { title: "Balance", amount: closingBalance, color: closingBalance >= 0 ? "text-green-600" : "text-red-600" },
      { title: "Income", amount: accountSummaryData.income, color: "text-green-600" },
      { title: "Expense", amount: accountSummaryData.expense, color: "text-red-600" },
    ],
    [closingBalance, accountSummaryData.income, accountSummaryData.expense]
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
    const q = params.toString();
    const basePath = pathnameForModalRouterReplace(pathname);
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    clearPlModalParentQueryBackup();
  }, [pathname, searchParams, router]);

  const modalParam = searchParams.get("modal");
  const anyReportPopupOpen = isVoucherDialogOpen || isCalendarOpen;
  useMobileLedgerModalUrlGuard({
    isMobile,
    modalParam,
    anyPopupOpen: anyReportPopupOpen,
    openingModalRef,
    pathname,
    searchParams,
    router,
  });

  const handleReportBack = useCallback(() => {
    if (isVoucherDialogOpen) {
      setIsVoucherDialogOpen(false);
      setSelectedVoucher(null);
      closeModalInUrl();
      return;
    }
    if (isCalendarOpen) {
      setIsCalendarOpen(false);
      closeModalInUrl();
      return;
    }
    if (onBackToReportList) {
      onBackToReportList();
      return;
    }
    router.back();
  }, [isVoucherDialogOpen, isCalendarOpen, closeModalInUrl, router, onBackToReportList]);

  const handleEditVoucher = useCallback(
    (voucher: any) => {
      openingModalRef.current = true;
      setSelectedVoucher(voucher);
      openModalInUrl();
      setIsVoucherDialogOpen(true);
    },
    [openModalInUrl]
  );

  const handleNepaliSelect = useCallback(
    (bsDate: BSDate, adDate: Date) => {
      const range = dateRange;
      if (!range?.from || (range.from && range.to)) {
        setDateRange({ from: adDate, to: undefined });
      } else if (adDate < range.from) {
        setDateRange({ from: adDate, to: range.from });
        setIsCalendarOpen(false);
      } else {
        setDateRange({ from: range.from, to: adDate });
        setIsCalendarOpen(false);
      }
    },
    [dateRange]
  );

  const activeSelection = mode === "group" ? selectedGroup : selectedAccount;
  const activeSelectionName = activeSelection?.name;

  const handlePrint = useCallback(() => {
    if (!activeSelection || !company) return;
    let dateRangeText = "All Time";
    if (dateRange?.from) {
      const from = dateRange.from;
      const to = dateRange.to || from;
      const fromBS = formatDateBS(from);
      const toBS = formatDateBS(to);
      const fromAD = formatDate(from);
      const toAD = formatDate(to);
      if (dateSystem === "AD") dateRangeText = `AD: ${fromAD}${to !== from ? " to " + toAD : ""}`;
      else if (dateSystem === "BS") dateRangeText = `BS: ${fromBS}${to !== from ? " to " + toBS : ""}`;
      else dateRangeText = `AD: ${fromAD} to ${toAD} (BS: ${fromBS} to ${toBS})`;
    }
    openPrintDirect(
      {
        company: {
          name: company.name,
          pan: company.pan,
          phone: company.phone,
          address: company.address,
          logoUrl: company.logoUrl,
        },
        title: `${mode === "group" ? "Group Summary" : "Account Summary"}: ${activeSelectionName}`,
        context: mode === "group" ? "group" : (accountContext as any),
        contextId: activeSelection.id,
        dateSystem: dateSystem,
        dateRangeText,
        vouchersCount: processedTransactions.length,
        openingBalance: openingBalanceForPeriod,
        transactions: processedTransactions,
        showNarration: true,
        userNames: mergedUserNames,
      },
      true
    );
  }, [activeSelection, activeSelectionName, company, dateRange, dateSystem, formatDateBS, formatDate, mode, accountContext, processedTransactions, openingBalanceForPeriod, mergedUserNames]);

  const handleExcel = useCallback(() => {
    if (!activeSelection) return;
    const dataForExport = processedTransactions.map((t: any) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return {
        "Date (BS)": formatDateBS(d),
        "Date (AD)": formatDate(d),
        "Voucher No.": t.voucherNumber,
        Type: voucherTypeDisplayText(t.type),
        Narration: t.narration || "",
        Debit: t.debit,
        Credit: t.credit,
        Balance: `${Math.abs(t.balance).toFixed(2)} ${t.balance >= 0 ? "Dr" : "Cr"}`,
      };
    });
    const periodDrTotal = processedTransactions.reduce((s: number, t: any) => s + (t.debit || 0), 0);
    const periodCrTotal = processedTransactions.reduce((s: number, t: any) => s + (t.credit || 0), 0);
    const summaryRows = [
      {
        "Date (BS)": "Opening Balance",
        Balance: `${Math.abs(openingBalanceForPeriod).toFixed(2)} ${openingBalanceForPeriod >= 0 ? "Dr" : "Cr"}`,
      },
      { "Date (BS)": "Total", Debit: periodDrTotal, Credit: periodCrTotal },
      {
        "Date (BS)": "Closing Balance",
        Balance: `${Math.abs(closingBalance).toFixed(2)} ${closingBalance >= 0 ? "Dr" : "Cr"}`,
      },
    ];
    const finalData = [...dataForExport, {}, ...summaryRows];
    const worksheet = XLSX.utils.json_to_sheet(finalData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, mode === "group" ? "Group Summary" : "Account Summary");
    XLSX.writeFile(workbook, `${activeSelectionName}_statement.xlsx`);
  }, [activeSelection, activeSelectionName, mode, processedTransactions, openingBalanceForPeriod, closingBalance, formatDateBS, formatDate]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Statement for ${activeSelectionName}`,
          text: `Here is the financial statement for ${activeSelectionName}.`,
          url: window.location.href,
        });
      } catch (error) {
        console.error("Error sharing:", error);
      }
    } else {
      alert("Web Share API not supported in your browser.");
    }
  }, [activeSelectionName]);

  // Get icon for account type
  const getAccountIcon = (accountType?: string) => {
    switch (accountType) {
      case 'party':
        return <Building2 className="h-4 w-4" />;
      case 'staff':
        return <UserCheck className="h-4 w-4" />;
      case 'tax':
        return <Receipt className="h-4 w-4" />;
      case 'expense':
        return <TrendingUp className="h-4 w-4" />;
      case 'bank':
        return <Landmark className="h-4 w-4" />;
      default:
        return <Landmark className="h-4 w-4" />;
    }
  };

  // Render tree item recursively
  const renderTreeItem = (item: AccountTreeItem, level: number = 0): React.ReactNode => {
    const isExpanded = expandedGroups.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    // Virtual Income/Expense parent rows are for hierarchy only (no details view binding).
    const isVirtualExpenseParent = mode === "group" && item.id.startsWith("expense-parent-");
    const isSystemGroupItem = mode === "group" && Boolean(item.group?.isSystemGroup);
    // Collapsed system group shows aggregate child balance; expanded state hides system balance.
    const displayBalance = isSystemGroupItem && hasChildren
      ? (isExpanded ? null : (item.children || []).reduce((sum, child) => sum + (child.balance || 0), 0))
      : item.balance;
    const isSelectableGroup = mode === "group" && item.group && !item.id.startsWith("entity-") && !isVirtualExpenseParent;
    const isSelectableAccount = mode === "account" && item.type === "account" && item.account;
    const isSelected = (
      (isSelectableAccount && selectedAccount?.id === item.id) || 
      (isSelectableGroup && selectedGroup?.id === item.id)
    );

    const isNonSelectableRow = item.id.startsWith("entity-") || isVirtualExpenseParent;
    const rowSelected = isSelected && !isNonSelectableRow;

    return (
      <motion.div
        key={item.id}
        layout="position"
        initial={false}
        exit={{ transition: { duration: 0 } }}
        transition={{
          duration: rowAnimationDuration,
          ease: "easeInOut"
        }}
      >
        <MasterListRow
          selected={rowSelected}
          className={cn(
            "p-1.5",
            isNonSelectableRow
              ? "cursor-default bg-muted/50"
              : "cursor-pointer",
            !isNonSelectableRow && masterListRowUnselectedCn(rowSelected)
          )}
          style={{ marginLeft: `${level * 25}px` }}
          onClick={() => handleSelectItem(item)}
        >
          <div className="flex items-center justify-between w-full gap-2 min-w-0">
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
              {hasChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(item.id);
                  }}
                  className="flex-shrink-0 p-0.5 hover:bg-muted rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              )}
              {!hasChildren && <div className="w-5" />}
              {item.type === 'group' ? (
                <div className="h-8 w-8 flex items-center justify-center bg-muted rounded-md text-muted-foreground flex-shrink-0">
                  <Users className="h-5 w-5" />
                </div>
              ) : item.account ? (
                <ResolvedEntityAvatar
                  className="h-8 w-8 text-xs flex-shrink-0 border bg-muted text-muted-foreground font-bold"
                  src={trimEntityFileUrlForPreview((item.account.entity as any)?.fileUrl) ?? undefined}
                  alt={item.name}
                  fallbackSlot={
                    item.account.entity && "isSpecial" in item.account.entity && item.account.entity.isSpecial ? (
                      <Crown className="h-4 w-4 text-amber-500" />
                    ) : item.account.accountType === "party" ? (
                      getInitials(item.name)
                    ) : item.account.accountType === "staff" ? (
                      <Briefcase className="h-4 w-4" />
                    ) : item.account.accountType === "tax" ? (
                      <Receipt className="h-4 w-4" />
                    ) : item.account.accountType === "expense" ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : item.account.accountType === "bank" ? (
                      <Landmark className="h-4 w-4" />
                    ) : (
                      getInitials(item.name)
                    )
                  }
                />
              ) : (
                <div className="h-8 w-8 flex items-center justify-center bg-muted rounded-md text-muted-foreground flex-shrink-0">
                  <Landmark className="h-4 w-4" />
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-semibold text-sm whitespace-nowrap truncate min-w-0 cursor-default">
                    {item.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{item.name}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                {displayBalance === null ? (
                  <p className="font-bold text-xs whitespace-nowrap flex-shrink-0 ml-1 px-1 rounded text-muted-foreground/60 cursor-default">
                    -
                  </p>
                ) : (
                  <p
                    className={cn(
                      "font-bold text-xs whitespace-nowrap flex-shrink-0 ml-1 px-1 rounded cursor-default",
                      displayBalance >= 0 ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {formatCurrency(displayBalance, { showDrCr: true })}
                  </p>
                )}
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="font-medium">
                  {displayBalance === null ? "Expand to view user-group balances" : formatCurrency(displayBalance, { showDrCr: true })}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </MasterListRow>
        {hasChildren && isExpanded && (
          <div className="mt-1 space-y-1">
            {item.children!.map(child => renderTreeItem(child, level + 1))}
          </div>
        )}
      </motion.div>
    );
  };

  // Render details view based on selected account or group
  const renderDetailsView = () => {
    if (selectedAccount) {
      const account = selectedAccount;
      
      // Use TaxDetails for tax accounts
      if (account.accountType === 'tax') {
        return (
          <TaxDetails
            tax={account.entity as Tax}
            allTaxes={processedTaxes}
            transactions={allVouchers}
            onTaxUpdated={() => {}}
            onTaxDeleted={() => setSelectedAccount(null)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
            context="report"
          />
        );
      }
      
      // Use PayeeDetails for party, staff, expense accounts
      if (account.accountType === 'party' || account.accountType === 'staff' || account.accountType === 'expense') {
        return (
          <PayeeDetails
            party={account.entity as any}
            allParties={[...processedParties, ...processedStaff, ...processedExpenseAccounts] as any}
            transactions={allVouchers}
            onPartyUpdated={() => {}}
            onPartyDeleted={() => setSelectedAccount(null)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            journalAccountNames={journalAccountNames}
            userNames={mergedUserNames}
          />
        );
      }
      
      // Use AccountDetails for bank accounts
      if (account.accountType === 'bank') {
        return (
          <AccountDetails
            account={account.entity as Account}
            allAccounts={processedAccounts}
            onAccountUpdated={() => {}}
            onAccountDeleted={() => setSelectedAccount(null)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
            transactions={allVouchers}
          />
        );
      }
    } else if (selectedGroup && selectedGroup.entity) {
      const group = selectedGroup;
      const groupEntity = group.entity;
      const inScope = (groupId?: string) => selectedGroupScopeIds.has(groupId || "");
      // When a system group is collapsed, details should show aggregate child-group data.
      const isCollapsedSystemSelection = Boolean(group.isSystemGroup) && !expandedGroups.has(group.id);
      
      // Render appropriate group details component based on group type
      switch (group.groupType) {
        case 'party': {
          const scopedParties =
            group.id === IC_COMPANY_PARTY_GROUP_ID
              ? partiesForSelectedGroup
              : isPartySystemGroupId(group.id)
                ? processedParties.filter((p: any) => isPartyDirectOnSystemBranch(p, group.id))
                : processedParties.filter((p) => inScope(p.groupId));
          const needsSyntheticGrouping = isCollapsedSystemSelection;
          const effectivePartyGroupId = needsSyntheticGrouping ? `${group.id}-aggregate` : group.id;
          // Rebind scoped parties to synthetic group id so GroupDetails can render scoped rows reliably.
          const effectiveParties =
            group.id === IC_COMPANY_PARTY_GROUP_ID
              ? scopedParties
              : needsSyntheticGrouping
                ? scopedParties.map((p) => ({ ...p, groupId: effectivePartyGroupId }))
                : scopedParties;
          const effectiveGroupEntity =
            group.id === IC_COMPANY_PARTY_GROUP_ID
              ? (icCompanyGroupForDetails ?? groupEntity)
              : needsSyntheticGrouping
                ? { ...(groupEntity as any), id: effectivePartyGroupId, groupType: "party", name: group.name }
                : groupEntity;
          return (
            <GroupDetails
              key={`${group.id}:${selectedIcPeerCompanyId ?? "all"}:${selectedIcMemberAccountId ?? "all"}:${selectedGroupMemberFilterId ?? "all"}`}
              group={effectiveGroupEntity as Group}
              allGroups={partyGroupsForList}
              allParties={effectiveParties}
              icGroupPeerCompanyFilterId={selectedIcPeerCompanyId}
              icGroupMemberFilterId={selectedIcMemberAccountId}
              groupMemberFilterId={selectedGroupMemberFilterId}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onPartyUpdated={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
            />
          );
        }
        case 'staff':
          return (
            <StaffGroupDetails
              group={groupEntity as any}
              allGroups={processedStaffGroups}
              staff={group.id === "ungrouped-staff"
                ? processedStaff.filter((s: any) => !s.groupId || s.groupId === "ungrouped_staff")
                : processedStaff.filter((s) => inScope((s as any).groupId))}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onStaffUpdated={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
            />
          );
        case 'tax':
          return (
            <TaxGroupDetails
              group={groupEntity as any}
              allGroups={processedTaxGroups}
              taxes={group.id === "ungrouped-tax"
                ? processedTaxes.filter((t: any) => !t.groupId || t.groupId === "ungrouped_tax")
                : processedTaxes.filter((t) => inScope((t as any).groupId))}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onTaxUpdated={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
            />
          );
        case 'expense':
          return (
            <ExpenseGroupDetails
              group={groupEntity as any}
              allGroups={processedExpenseGroups}
              accounts={group.id === "ungrouped-expense"
                ? processedExpenseAccounts.filter((e: any) => !e.groupId || e.groupId === "ungrouped_expense")
                : processedExpenseAccounts.filter((e) => inScope((e as any).groupId))}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onAccountUpdated={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
            />
          );
        case 'bank':
          return (
            <AccountGroupDetails
              group={groupEntity as AccountGroup}
              allGroups={processedAccountGroups}
              accounts={group.id === "ungrouped-bank"
                ? processedAccounts.filter((a: any) => !a.groupId || a.groupId === "ungrouped_account")
                : processedAccounts.filter((a) => inScope((a as any).groupId))}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onAccountUpdated={() => {}}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
            />
          );
        case 'item':
          return (
            <ItemGroupDetails
              group={groupEntity as any}
              allGroups={processedItemGroups as any}
              items={processedItems.filter((i: any) => inScope(i.groupId)) as any}
              allItems={processedItems as any}
              onGroupUpdated={() => {}}
              onGroupDeleted={() => setSelectedGroup(null)}
              onItemUpdated={() => {}}
              stockView={"amount"}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
              transactions={allVouchers}
            />
          );
        default:
          return null;
      }
    }
    
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Select an account</CardTitle>
            <CardDescription>
              Choose an account or group from the list to view transactions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {flattenedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accounts found. Create an account to see it here.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  };

  if (vouchersLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  // Mobile: same UI as In/Exp Report - header, showing count, entity/account dropdowns, summary cards, search, transactions, bottom buttons
  if (isMobile) {
    return (
      <div className="h-full min-h-0 flex flex-col bg-gray-50 overflow-hidden">
        <header className="sticky top-0 z-10 flex-shrink-0 flex flex-col gap-2 p-3 border-b bg-white">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0 h-8 w-8"
              onClick={handleReportBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-base font-bold truncate flex-1 min-w-0">{mode === "group" ? "Group Summary" : "Account Summary"}</h1>
            {activeSelection && (
              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                Showing {filteredReportTransactions.length} of {reportDisplayTransactions.length} voucher(s)
              </span>
            )}
          </div>
          <div className="flex justify-center items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{dateRangeLabel}</span>
            {hasDateFilter && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => setDateRange(undefined)}
                title="Clear date filter"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Combobox
                options={entityDropdownOptions}
                value={selectedEntityType}
                onChange={(value) => {
                  const entityItem = accountTree.find((e) => e.id.startsWith("entity-") && (e.group as any)?.groupType === value);
                  if (mode === "group") {
                    if (value === "party") {
                      const firstPartyGroup = partyGroupsForList[0];
                      if (firstPartyGroup) {
                        setSelectedGroup(toUnifiedGroupFromListGroup({ ...firstPartyGroup, groupType: "party" }));
                        setSelectedAccount(null);
                        setSelectedGroupMemberFilterId(null);
                        setSelectedIcPeerCompanyId(null);
                        setSelectedIcMemberAccountId(null);
                      } else {
                        setSelectedGroup(null);
                        setSelectedAccount(null);
                      }
                      return;
                    }
                    const firstGroup = allUnifiedGroups.find((g) => (g as any).groupType === value);
                    if (firstGroup) {
                      setSelectedGroup(firstGroup);
                      setSelectedAccount(null);
                    } else {
                      setSelectedGroup(null);
                      setSelectedAccount(null);
                    }
                  } else {
                    const firstAccount = entityItem?.children?.find((c) => c.type === "account" && c.account)?.account;
                    if (firstAccount) {
                      setSelectedAccount(firstAccount);
                      setSelectedGroup(null);
                    } else {
                      setSelectedAccount(null);
                      setSelectedGroup(null);
                    }
                  }
                }}
                placeholder="Entity"
              />
            </div>
            <div className="flex-1 min-w-0">
              {mode === "group" ? (
                <Combobox
                  options={groupDropdownOptions}
                  value={selectedGroup?.id || ""}
                  onChange={(value) => {
                    if (value.startsWith("ungrouped-")) {
                      const ungroupedGroup = buildUngroupedVirtualGroup((value.replace("ungrouped-", "") as UnifiedGroup["groupType"]));
                      if (ungroupedGroup) {
                        setSelectedGroup(ungroupedGroup);
                      }
                      setSelectedAccount(null);
                      setSelectedGroupMemberFilterId(null);
                      setSelectedIcPeerCompanyId(null);
                      setSelectedIcMemberAccountId(null);
                      return;
                    }
                    if (selectedEntityType === "party") {
                      const partyGroup = partyGroupsForList.find((g) => g.id === value);
                      if (partyGroup) {
                        setSelectedGroup(toUnifiedGroupFromListGroup({ ...partyGroup, groupType: "party" }));
                        setSelectedAccount(null);
                        setSelectedGroupMemberFilterId(null);
                        setSelectedIcPeerCompanyId(null);
                        setSelectedIcMemberAccountId(null);
                      }
                      return;
                    }
                    const grp = allUnifiedGroups.find((g) => g.id === value);
                    if (grp) {
                      setSelectedGroup(grp);
                      setSelectedAccount(null);
                      setSelectedGroupMemberFilterId(null);
                      setSelectedIcPeerCompanyId(null);
                      setSelectedIcMemberAccountId(null);
                    }
                  }}
                  placeholder="Group"
                />
              ) : (
                <Combobox
                  options={accountDropdownOptions}
                  value={selectedAccount?.id || ""}
                  onChange={(value) => {
                    const acc = allUnifiedAccounts.find((a) => a.id === value);
                    if (acc) {
                      setSelectedAccount(acc);
                      setSelectedGroup(null);
                    }
                  }}
                  placeholder="Account"
                />
                )}
            </div>
          </div>
        </header>

        <Drawer
          open={isCalendarOpen}
          onOpenChange={(open: boolean) => {
            if (open) {
              openingModalRef.current = true;
              openModalInUrl();
            } else {
              closeModalInUrl();
            }
            setIsCalendarOpen(open);
          }}
        >
          <DrawerContent>
            <DrawerHeader className="p-4 text-left">
              <DrawerTitle>Select Date Range</DrawerTitle>
              <DrawerDescription>
                Select a starting and ending date for the transaction list.
              </DrawerDescription>
            </DrawerHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              {(dateSystem === "BS" || dateSystem === "Both") && (
                <NepaliCalendar
                  onSelect={handleNepaliSelect}
                  valueAD={dateRange}
                  isRange={true}
                  numberOfMonths={calendarMonths}
                />
              )}
              {(dateSystem === "AD" || dateSystem === "Both") && (
                <div className="flex-1">
                  <Calendar
                    className="p-0 w-full"
                    classNames={{ table: "w-full" }}
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={asCalendarRange(dateRange)}
                    onSelect={(range) => {
                      setDateRange(range as DateRange | undefined);
                      if (range?.from && range.to) setIsCalendarOpen(false);
                    }}
                    numberOfMonths={calendarMonths}
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

        {/* Mobile: no pb-20 so scroll extends to footer; inner pb-24 so last row clears fixed footer */}
        <main className={cn("flex-1 flex flex-col min-h-0 px-4 pt-0.5", !isMobile && "pb-20")}>
          {activeSelection ? (
            view === "chart" ? (
              <div className="-mx-4 w-[calc(100%+2rem)] max-w-none flex-shrink-0">
                <RunningBalanceFullChart
                  transactions={reportDisplayTransactions}
                  openingBalance={openingBalanceForPeriod}
                />
              </div>
            ) : (
              <>
                <div className="flex flex-nowrap gap-2 pt-0.5 pb-3 overflow-x-auto scrollbar-slim-dim flex-shrink-0">
                  {summaryCards.map((card) => (
                    <ReportSummaryCard
                      key={card.title}
                      title={card.title}
                      amount={card.amount}
                      color={card.color}
                    />
                  ))}
                </div>
                <div
                  className="flex-1 min-h-0 overflow-y-auto px-0.5 -mx-4 md:mx-0 md:px-0"
                  data-floating-button-scroll
                >
                  {isMobile ? (
                    <div className="pb-24">
                      <TransactionsTable
                        transactions={filteredReportTransactions}
                        context={activeContext}
                        contextId={activeSelection?.id}
                        openingBalance={openingBalanceForPeriod}
                        userNames={mergedUserNames}
                        journalAccountNames={journalAccountNames}
                        onRowClick={handleEditVoucher}
                        openingBalanceLabel="Opening"
                        openingBalanceSearch={
                          <Input
                            placeholder="Search..."
                            value={transactionSearch}
                            onChange={(e) => setTransactionSearch(e.target.value)}
                            className="h-8 w-32 max-w-[140px] text-sm"
                          />
                        }
                      />
                    </div>
                  ) : (
                    <TransactionsTable
                      transactions={filteredReportTransactions}
                      context={activeContext}
                      contextId={activeSelection?.id}
                      openingBalance={openingBalanceForPeriod}
                      userNames={mergedUserNames}
                      journalAccountNames={journalAccountNames}
                      onRowClick={handleEditVoucher}
                      openingBalanceLabel="Opening"
                      openingBalanceSearch={
                        <Input
                          placeholder="Search..."
                          value={transactionSearch}
                          onChange={(e) => setTransactionSearch(e.target.value)}
                          className="h-8 w-32 max-w-[140px] text-sm"
                        />
                      }
                    />
                  )}
                </div>
              </>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <Card className="w-full max-w-md text-center">
                <CardHeader>
                  <CardTitle>{mode === "group" ? "Select a group" : "Select an account"}</CardTitle>
                  <CardDescription>
                    {mode === "group"
                      ? "Choose a group from the entity and group dropdowns above."
                      : "Choose an account from the entity and account dropdowns above."}
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          )}
        </main>

        <footer className="flex items-stretch justify-around p-1.5 border-t bg-white gap-1 fixed bottom-0 left-0 right-0">
          <PermissionButton
            permission="export_data"
            className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-green-500 hover:bg-green-600 text-white rounded-md disabled:opacity-50"
            onClick={handlePrint}
            disabled={!activeSelection}
          >
            <Printer className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Print</span>
          </PermissionButton>
          <PermissionButton
            permission="export_data"
            className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md disabled:opacity-50"
            onClick={handleExcel}
            disabled={!activeSelection}
          >
            <File className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Excel</span>
          </PermissionButton>
          <Button
            className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md disabled:opacity-50"
            onClick={handleShare}
            disabled={!activeSelection}
          >
            <Share2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Share</span>
          </Button>
          <Button
            className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-slate-500 hover:bg-slate-600 text-white rounded-md"
            onClick={() => {
              openingModalRef.current = true;
              setIsCalendarOpen(true);
              openModalInUrl();
            }}
          >
            <CalendarIcon className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Date</span>
          </Button>
          <Button
            className="flex-1 flex flex-col items-center justify-center py-1 min-w-0 bg-violet-500 hover:bg-violet-600 text-white rounded-md disabled:opacity-50"
            onClick={() => setView((v) => (v === "list" ? "chart" : "list"))}
            disabled={!activeSelection}
          >
            <BarChart2 className="w-4 h-4 mb-0" /> <span className="text-[10px] leading-tight">Chart</span>
          </Button>
        </footer>

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
      </div>
    );
  }

  if (!isMobile && mode === "group") {
    const groupSearchRow = (
      <div className={mlc.searchRow}>
        <div className={mlc.searchWrap}>
          <Search className={mlc.searchIcon} />
          <Input
            placeholder="Search groups..."
            listChrome
            listChromeSearch
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
    );

    const groupSectionLabel = (
      <div className={mlc.sectionLabelRow}>
        <Users className={mlc.sectionIcon} />
        <span>Groups ({groupSummaryTree.length})</span>
      </div>
    );

    const groupListView = (
      <MasterListViewShell
        isMobile={false}
        searchRow={groupSearchRow}
        sectionLabel={groupSectionLabel}
      >
        <GroupSummaryTreeList
          items={groupSummaryTree}
          expandedIds={expandedGroups}
          onToggleExpand={toggleGroupSummaryExpand}
          onSelectGroup={handleSelectGroupFromTree}
          onSelectAccount={handleSelectAccountFromTree}
          onSelectIcCompany={handleSelectIcCompanyGroup}
          selectedGroupId={selectedGroup?.id ?? null}
          selectedAccountId={selectedAccount?.id ?? null}
          selectedIcPeerCompanyId={selectedIcPeerCompanyId}
          selectedIcMemberAccountId={selectedIcMemberAccountId}
          searchTerm={searchTerm}
        />
      </MasterListViewShell>
    );

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <div
          className="flex-1 grid min-h-0 overflow-hidden"
          style={{ gridTemplateColumns: `${summaryListWidthPx}px minmax(0, 1fr)` }}
        >
          <div
            className="relative flex flex-col min-h-0 min-w-0 border-r overflow-hidden bg-muted/30"
            {...mlcListChromeRootData}
          >
            <div className={cn(mlc.pageHeader, "flex flex-col items-stretch border-b")}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <ReportShowListButton />
                  <h2 className={cn(mlc.pageTitle, "min-w-0 truncate")}>Group Summary</h2>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Checkbox
                    id="group-summary-expand-only"
                    checked={groupExpandOnly}
                    onCheckedChange={(checked) => setGroupExpandOnly(checked === true)}
                    className="h-3.5 w-3.5"
                    aria-label="Group expand only"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                        aria-label="About group expand only"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end" className="max-w-[260px] text-xs">
                      <p>Tick: expand shows sub-groups only — accounts stay hidden.</p>
                      <p className="mt-1">Untick: accounts also appear when you expand a group.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="mt-1 border-b border-blue-300/60" aria-hidden />
              <Card className="mt-1 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Balance</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    totalBalance >= 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  {formatCurrency(totalBalance, { showDrCr: true, noSuffix: true })}
                </p>
              </Card>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{groupListView}</div>
            <ResizeWidthHandle onPointerDown={beginSummaryListResize} title="Resize group list" />
          </div>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            {renderDetailsView()}
          </div>
        </div>
      </div>
    );
  }

  const sidebarTree = mode === "group" ? filteredGroupTree : filteredTree;
  const sidebarItemCount = mode === "group" ? flattenedGroupItems.length : flattenedItems.length;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div
        className="flex-1 grid min-h-0 overflow-hidden"
        style={{ gridTemplateColumns: `${summaryListWidthPx}px minmax(0, 1fr)` }}
      >
        <div className="relative flex flex-col min-h-0 min-w-0 border-r overflow-hidden bg-muted/30">
          <div className="p-4 border-b space-y-3 flex-shrink-0">
            <ReportRegisterListHeading>
              {mode === "group" ? "Group Summary" : "Account Summary"}
            </ReportRegisterListHeading>
            <Card className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Balance</p>
              <p className={cn(
                "text-xl font-bold",
                totalBalance >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {formatCurrency(totalBalance, { showDrCr: true, noSuffix: true })}
              </p>
            </Card>
          </div>
          <div className="p-3 border-b flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={mode === "group" ? "Search groups..." : "Search accounts..."}
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
            <h3 className="text-sm font-semibold">{mode === "group" ? `Groups (${sidebarItemCount})` : `Accounts (${sidebarItemCount})`}</h3>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-1">
              <AnimatePresence mode="popLayout">
                {sidebarTree.map(item => renderTreeItem(item))}
              </AnimatePresence>
              {sidebarTree.length === 0 && (
                <div className="text-center text-muted-foreground p-8">
                  {mode === "group" ? "No groups found." : "No accounts found."}
                </div>
              )}
            </div>
          </ScrollArea>
          <ResizeWidthHandle
            onPointerDown={beginSummaryListResize}
            title={mode === "group" ? "Resize group list" : "Resize account list"}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {renderDetailsView()}
        </div>
      </div>
    </div>
  );
}

function AccountsStatementLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center text-muted-foreground">Loading report...</div>
    </div>
  );
}

export default function AccountsStatementPage(props: AccountsStatementPageProps) {
  return (
    // Wrap useSearchParams consumer tree for Next.js static prerender compatibility.
    <Suspense fallback={<AccountsStatementLoading />}>
      <AccountsStatementPageContent {...props} />
    </Suspense>
  );
}
