"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, X, ChevronDown, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Combobox } from "@/components/ui/combobox";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { GroupDetails } from "@/components/party/GroupDetails";
import { PayeeDetails } from "@/components/payee/PayeeDetails";
import { TaxDetails } from "@/components/tax/TaxDetails";
import { TaxGroupDetails } from "@/components/tax/TaxGroupDetails";
import { StaffGroupDetails } from "@/components/staff/StaffGroupDetails";
import { AccountDetails } from "@/components/bank-cash/AccountDetails";
import { AccountGroupDetails } from "@/components/bank-cash/AccountGroupDetails";
import { ExpenseAccountDetails } from "@/components/expenses/ExpenseAccountDetails";
import { ExpenseGroupDetails } from "@/components/expenses/ExpenseGroupDetails";
import { ItemGroupDetails } from "@/components/items/ItemGroupDetails";
import type { Group, Party } from "@/components/party/types";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc, query, collection, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { ReportRegisterListHeading } from "@/components/reports/ReportRegisterListHeading";
import { masterListSelectedCn, masterListUnselectedCn } from "@/lib/listSelectionChrome";
import { format } from "date-fns";
import { getAllSystemGroupNames } from "@/lib/system-group-names";
import { isPocketBaseAppSessionActive, readPocketBaseAppProfile, pocketBaseSessionUid } from "@/lib/pocketbaseData/pbAppSession";

type GroupStatementPageProps = {
  onPartySelectionChange?: (isParty: boolean) => void;
};

type ReportGroup = (Group & {
  groupType?: "party" | "tax" | "staff" | "account" | "expense" | "item";
  parentId?: string;
  isSystemGroup?: boolean;
});

export default function GroupStatementPage({ onPartySelectionChange }: GroupStatementPageProps) {
  const { formatCurrency, formatDateBS, dateSystem } = useDate();
  const { vouchers: allVouchers, loading: vouchersLoading, processedGroups: initialProcessedGroups, processedParties, processedStaff, processedTaxes, processedAccounts, processedExpenseAccounts, processedItems, processedTaxGroups, processedStaffGroups, processedAccountGroups, processedExpenseGroups, processedItemGroups, journalAccountNames, userNames: vouchersUserNames } = useVouchers();
  const [selectedGroup, setSelectedGroup] = useState<ReportGroup | null>(null);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  // System groups are expandable in report sidebar.
  const [expandedSystemGroupIds, setExpandedSystemGroupIds] = useState<Set<string>>(new Set());
  // Income & Expense entity only: expand state for parent "Income" / "Expense" rows.
  const [expandedExpenseParentIds, setExpandedExpenseParentIds] = useState<Set<"income" | "expense">>(new Set());
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const hasAutoSelected = useRef(false);
  const isMobile = useIsMobile();

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
      if ((e as { code?: unknown } | null)?.code === "unavailable") { console.debug('[GroupSummary] userName lookup skipped (offline) for', userId); } else { console.error('[GroupSummary] Error fetching userName for', userId, e); }
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

  // Build a unified group list that includes both system groups and user groups.
  const processedGroups = useMemo<ReportGroup[]>(() => {
    const rows: ReportGroup[] = [];
    const systemGroupNames = getAllSystemGroupNames().map((n) => n.toLowerCase());
    const systemGroupIds = new Set([
      "party",
      "staff",
      "tax",
      "bank",
      "bank_cash",
      "income_expense",
      "item",
      "sundry_debtors",
      "sundry_creditors",
      "duties_taxes",
      "loans_liabilities",
      "bank_accounts_group",
      "cash_in_hand_group",
      "direct_income",
      "indirect_income",
      "direct_expense",
      "indirect_expense",
      "assets",
      "liabilities",
      "income",
      "expenses",
      "equity",
      "stock_items",
      "services",
    ]);
    const mapRow = (g: any, groupType: ReportGroup["groupType"]): ReportGroup => {
      const groupId = String(g?.id || "");
      const groupName = String(g?.name || "");
      const parentId = g?.parentId ? String(g.parentId) : undefined;
      const isSystemByFlag = g?.isSystemReserved === true;
      const isSystemById = systemGroupIds.has(groupId.toLowerCase());
      const isSystemByName = systemGroupNames.includes(groupName.toLowerCase());
      const isSystemByRoot = !parentId;
      return {
        ...g,
        id: groupId,
        name: groupName,
        parentId,
        groupType,
        // System-group detection drives expandable report behavior.
        isSystemGroup: isSystemByFlag || isSystemById || isSystemByName || isSystemByRoot,
      } as ReportGroup;
    };
    rows.push(...(initialProcessedGroups || []).filter((g: any) => !g?.isReportOnly).map((g: any) => mapRow(g, "party")));
    rows.push(...(processedTaxGroups || []).filter((g: any) => !g?.isReportOnly).map((g: any) => mapRow(g, "tax")));
    rows.push(...(processedStaffGroups || []).filter((g: any) => !g?.isReportOnly).map((g: any) => mapRow(g, "staff")));
    rows.push(...(processedAccountGroups || []).filter((g: any) => !g?.isReportOnly).map((g: any) => mapRow(g, "account")));
    rows.push(...(processedExpenseGroups || []).filter((g: any) => !g?.isReportOnly).map((g: any) => mapRow(g, "expense")));
    rows.push(...(processedItemGroups || []).filter((g: any) => !g?.isReportOnly).map((g: any) => mapRow(g, "item")));
    // Remove accidental duplicate ids across lists while keeping first occurrence.
    const seen = new Set<string>();
    return rows.filter((g) => {
      if (!g.id || seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  }, [initialProcessedGroups, processedTaxGroups, processedStaffGroups, processedAccountGroups, processedExpenseGroups, processedItemGroups]);

  const totalBalance = useMemo(
    () => processedGroups.reduce((sum, g) => sum + (g.balance || 0), 0),
    [processedGroups]
  );

  // Group relationships for system-group expand/collapse and aggregate detail selection.
  const groupById = useMemo(() => {
    const map = new Map<string, ReportGroup>();
    processedGroups.forEach((g) => map.set(g.id, g));
    return map;
  }, [processedGroups]);

  const systemGroups = useMemo(
    () => processedGroups.filter((g) => g.isSystemGroup === true),
    [processedGroups]
  );

  const userGroups = useMemo(
    () => processedGroups.filter((g) => g.isSystemGroup !== true),
    [processedGroups]
  );

  const getTopSystemAncestorId = useCallback(
    (group: ReportGroup): string | null => {
      let cursor: ReportGroup | undefined = group;
      while (cursor?.parentId) {
        const parent = groupById.get(cursor.parentId);
        if (!parent) break;
        if (parent.isSystemGroup) return parent.id;
        cursor = parent;
      }
      return null;
    },
    [groupById]
  );

  const systemChildrenMap = useMemo(() => {
    const map = new Map<string, ReportGroup[]>();
    systemGroups.forEach((sys) => map.set(sys.id, []));
    userGroups.forEach((ug) => {
      const topSystemId = getTopSystemAncestorId(ug);
      if (topSystemId && map.has(topSystemId)) {
        map.get(topSystemId)!.push(ug);
      }
    });
    return map;
  }, [systemGroups, userGroups, getTopSystemAncestorId]);

  // Income & Expense entity: split system groups into Income (parentId "income" / Direct–Indirect Income) vs Expense (parentId "expenses" / Direct–Indirect Expense) for sidebar parent row.
  const expenseIncomeSystemGroups = useMemo(() => {
    const incomeIds = new Set(["direct_income", "indirect_income", "income"]);
    return systemGroups.filter((g) => {
      if ((g as ReportGroup).groupType !== "expense") return false;
      const parentId = String((g as ReportGroup).parentId || "").toLowerCase();
      if (parentId === "income") return true;
      const id = String(g.id).toLowerCase();
      const name = String(g.name || "").toLowerCase();
      if (incomeIds.has(id)) return true;
      return /income/i.test(name) && !/expense/i.test(name);
    });
  }, [systemGroups]);
  const expenseExpenseSystemGroups = useMemo(() => {
    const expenseIds = new Set(["direct_expense", "indirect_expense", "expenses"]);
    return systemGroups.filter((g) => {
      if ((g as ReportGroup).groupType !== "expense") return false;
      const parentId = String((g as ReportGroup).parentId || "").toLowerCase();
      if (parentId === "expenses") return true;
      const id = String(g.id).toLowerCase();
      const name = String(g.name || "").toLowerCase();
      if (expenseIds.has(id)) return true;
      return /expense/i.test(name);
    });
  }, [systemGroups]);
  const otherSystemGroups = useMemo(
    () => systemGroups.filter((g) => (g as ReportGroup).groupType !== "expense"),
    [systemGroups]
  );

  const toggleExpenseParent = useCallback((key: "income" | "expense") => {
    setExpandedExpenseParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Mobile: group dropdown options (entity)
  const groupDropdownOptions = useMemo(() => {
    return processedGroups.map((g) => ({ value: g.id, label: g.name }));
  }, [processedGroups]);

  const filteredGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return processedGroups;
    return processedGroups.filter((g) => {
      const selfMatch = g.name.toLowerCase().includes(q);
      if (selfMatch) return true;
      const children = systemChildrenMap.get(g.id) || [];
      return children.some((c) => c.name.toLowerCase().includes(q));
    });
  }, [processedGroups, searchTerm, systemChildrenMap]);

  const filteredGroupIds = useMemo(
    () => new Set(filteredGroups.map((g) => g.id)),
    [filteredGroups]
  );

  const REPORT_MEMORY_KEY = "reportGroupStatementState";

  useEffect(() => {
    if (processedGroups.length === 0) return;
    if (hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(REPORT_MEMORY_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as { groupId?: string }) : null;
      const groupId = saved?.groupId;
      if (groupId) {
        const found = processedGroups.find((g) => g.id === groupId);
        if (found) {
          setSelectedGroup(found);
          return;
        }
      }
    } catch (_) {}
    setSelectedGroup(processedGroups[0]);
  }, [processedGroups]);

  const handleSelectGroup = useCallback((group: ReportGroup) => {
    setSelectedMember(null);
    setSelectedGroup(group);
    try {
      localStorage.setItem(REPORT_MEMORY_KEY, JSON.stringify({ groupId: group.id }));
    } catch (_) {}
  }, []);

  const toggleSystemGroup = useCallback((group: ReportGroup) => {
    if (!group.isSystemGroup) return;
    setExpandedSystemGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(group.id)) {
        next.delete(group.id);
      } else {
        next.add(group.id);
        // When expanding a system group, switch details to first user group by default.
        if (selectedGroup?.id === group.id) {
          const firstChild = (systemChildrenMap.get(group.id) || [])[0];
          if (firstChild) {
            setSelectedMember(null);
            setSelectedGroup(firstChild);
          }
        }
      }
      return next;
    });
  }, [selectedGroup, systemChildrenMap]);

  useEffect(() => {
    // Party groups don't have groupType; non-party groups have groupType: 'tax' | 'staff' | 'account' | 'expense' | 'item'
    const groupType = (selectedGroup as any)?.groupType;
    const isParty = !!selectedGroup && !["tax", "staff", "account", "expense", "item"].includes(groupType);
    onPartySelectionChange?.(isParty);
  }, [selectedGroup, onPartySelectionChange]);

  // Merge vouchersUserNames with fetched userNames
  const mergedUserNames = useMemo(() => {
    return { ...vouchersUserNames, ...userNames };
  }, [vouchersUserNames, userNames]);

  const selectedGroupIdsForDetails = useMemo(() => {
    if (!selectedGroup) return new Set<string>();
    if (!selectedGroup.isSystemGroup) return new Set([selectedGroup.id]);
    const children = systemChildrenMap.get(selectedGroup.id) || [];
    // System group (collapsed) should show all child-group transactions together.
    if (children.length > 0) return new Set(children.map((c) => c.id));
    return new Set([selectedGroup.id]);
  }, [selectedGroup, systemChildrenMap]);

  const selectedPartiesForDetails = useMemo(() => {
    if (!selectedGroup) return [];
    if (selectedGroup.id === "ungrouped") return processedParties.filter((p) => !p.groupId);
    return processedParties.filter((p: any) => selectedGroupIdsForDetails.has(String(p.groupId || "")));
  }, [selectedGroup, processedParties, selectedGroupIdsForDetails]);

  const selectedStaffForDetails = useMemo(
    () => processedStaff.filter((s: any) => selectedGroupIdsForDetails.has(String(s.groupId || ""))),
    [processedStaff, selectedGroupIdsForDetails]
  );
  const selectedTaxesForDetails = useMemo(
    () => processedTaxes.filter((t: any) => selectedGroupIdsForDetails.has(String(t.groupId || ""))),
    [processedTaxes, selectedGroupIdsForDetails]
  );
  const selectedAccountsForDetails = useMemo(
    () => processedAccounts.filter((a: any) => selectedGroupIdsForDetails.has(String(a.groupId || ""))),
    [processedAccounts, selectedGroupIdsForDetails]
  );
  const selectedExpenseAccountsForDetails = useMemo(
    () => processedExpenseAccounts.filter((a: any) => selectedGroupIdsForDetails.has(String(a.groupId || ""))),
    [processedExpenseAccounts, selectedGroupIdsForDetails]
  );
  const selectedItemsForDetails = useMemo(
    () => processedItems.filter((i: any) => selectedGroupIdsForDetails.has(String(i.groupId || ""))),
    [processedItems, selectedGroupIdsForDetails]
  );

  const partiesForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    const groupType = (selectedGroup as any).groupType;
    // Non-party group details should not hydrate party members.
    if (groupType === "staff" || groupType === "tax" || groupType === "account" || groupType === "expense" || groupType === "item") {
      return [];
    }
    return selectedPartiesForDetails;
  }, [selectedGroup, selectedPartiesForDetails]);

  // Mobile: account dropdown options (members of selected group)
  const accountDropdownOptions = useMemo(() => {
    if (!selectedGroup) return [];
    const groupType = (selectedGroup as any).groupType;
    if (groupType === 'tax') {
      return processedTaxes.filter((t: any) => selectedGroupIdsForDetails.has(String(t.groupId || ""))).map((t: any) => ({ value: t.id, label: t.name }));
    }
    if (groupType === 'staff') {
      return processedStaff.filter((s: any) => selectedGroupIdsForDetails.has(String(s.groupId || ""))).map((s: any) => ({ value: s.id, label: s.name }));
    }
    if (groupType === 'account') {
      return processedAccounts.filter((a: any) => selectedGroupIdsForDetails.has(String(a.groupId || ""))).map((a: any) => ({ value: a.id, label: a.name }));
    }
    if (groupType === 'expense') {
      return processedExpenseAccounts.filter((e: any) => selectedGroupIdsForDetails.has(String(e.groupId || ""))).map((e: any) => ({ value: e.id, label: e.name }));
    }
    if (groupType === 'item') {
      return processedItems.filter((i: any) => selectedGroupIdsForDetails.has(String((i as any).groupId || ""))).map((i: any) => ({ value: i.id, label: i.name }));
    }
    // Party groups
    if (selectedGroup.id === 'ungrouped') {
      return processedParties.filter((p: any) => !p.groupId).map((p: any) => ({ value: p.id, label: p.name }));
    }
    return processedParties.filter((p: any) => selectedGroupIdsForDetails.has(String(p.groupId || ""))).map((p: any) => ({ value: p.id, label: p.name }));
  }, [selectedGroup, selectedGroupIdsForDetails, processedParties, processedStaff, processedTaxes, processedAccounts, processedExpenseAccounts, processedItems]);

  if (vouchersLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  // Mobile: same UI as In/Exp Report - entity (group) dropdown + account dropdown
  const renderGroupDetailsContent = () => {
    if (selectedMember) {
      const groupType = (selectedGroup as any)?.groupType;
      if (groupType === 'tax') {
        const tax = processedTaxes.find((t: any) => t.id === selectedMember.id);
        if (tax) {
          return (
            <TaxDetails
              tax={tax}
              allTaxes={processedTaxes}
              transactions={allVouchers}
              onTaxUpdated={() => {}}
              onTaxDeleted={() => setSelectedMember(null)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
              context="report"
            />
          );
        }
      }
      if (groupType === 'staff') {
        const staff = processedStaff.find((s: any) => s.id === selectedMember.id);
        if (staff) {
          return (
            <PayeeDetails
              party={staff as any}
              allParties={[...processedParties, ...processedStaff, ...processedExpenseAccounts] as any}
              transactions={allVouchers}
              onPartyUpdated={() => {}}
              onPartyDeleted={() => setSelectedMember(null)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              journalAccountNames={journalAccountNames}
              userNames={mergedUserNames}
            />
          );
        }
      }
      if (groupType === 'account') {
        const acc = processedAccounts.find((a: any) => a.id === selectedMember.id);
        if (acc) {
          return (
            <AccountDetails
              account={acc as any}
              allAccounts={processedAccounts}
              onAccountUpdated={() => {}}
              onAccountDeleted={() => setSelectedMember(null)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
              transactions={allVouchers}
            />
          );
        }
      }
      if (groupType === 'expense') {
        const exp = processedExpenseAccounts.find((e: any) => e.id === selectedMember.id);
        if (exp) {
          return (
            <ExpenseAccountDetails
              account={exp as any}
              allAccounts={processedExpenseAccounts}
              onAccountUpdated={() => {}}
              onAccountDeleted={() => setSelectedMember(null)}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              userNames={mergedUserNames}
            />
          );
        }
      }
      const party = processedParties.find((p: any) => p.id === selectedMember.id);
      if (party) {
        return (
          <PayeeDetails
            party={party as any}
            allParties={[...processedParties, ...processedStaff, ...processedExpenseAccounts] as any}
            transactions={allVouchers}
            onPartyUpdated={() => {}}
            onPartyDeleted={() => setSelectedMember(null)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            journalAccountNames={journalAccountNames}
            userNames={mergedUserNames}
          />
        );
      }
    }
    if (selectedGroup) {
      const groupEntity = (selectedGroup as any).entity ?? selectedGroup;
      const groupType = (selectedGroup as any).groupType;
      if (groupType === 'party' || !groupType) {
        return (
          <GroupDetails
            group={groupEntity as Group}
            // Party details should receive party-group list only.
            allGroups={initialProcessedGroups}
            allParties={partiesForSelectedGroup}
            onGroupUpdated={() => {}}
            onGroupDeleted={() => setSelectedGroup(null)}
            onPartyUpdated={() => {}}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
          />
        );
      }
      if (groupType === 'staff') {
        return (
          <StaffGroupDetails
            group={groupEntity as any}
            allGroups={processedStaffGroups}
            // System-group selection should include combined child-group members.
            staff={selectedStaffForDetails}
            onGroupUpdated={() => {}}
            onGroupDeleted={() => setSelectedGroup(null)}
            onStaffUpdated={() => {}}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
          />
        );
      }
      if (groupType === 'tax') {
        return (
          <TaxGroupDetails
            group={groupEntity as any}
            allGroups={processedTaxGroups}
            taxes={selectedTaxesForDetails}
            onGroupUpdated={() => {}}
            onGroupDeleted={() => setSelectedGroup(null)}
            onTaxUpdated={() => {}}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
          />
        );
      }
      if (groupType === 'expense') {
        return (
          <ExpenseGroupDetails
            group={groupEntity as any}
            allGroups={processedExpenseGroups}
            accounts={selectedExpenseAccountsForDetails}
            onGroupUpdated={() => {}}
            onGroupDeleted={() => setSelectedGroup(null)}
            onAccountUpdated={() => {}}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
          />
        );
      }
      if (groupType === 'account') {
        return (
          <AccountGroupDetails
            group={groupEntity as any}
            allGroups={processedAccountGroups}
            accounts={selectedAccountsForDetails}
            onGroupUpdated={() => {}}
            onGroupDeleted={() => setSelectedGroup(null)}
            onAccountUpdated={() => {}}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
          />
        );
      }
      if (groupType === "item") {
        return (
          <ItemGroupDetails
            group={groupEntity as any}
            allGroups={processedItemGroups as any}
            items={selectedItemsForDetails as any}
            allItems={processedItems as any}
            onGroupUpdated={() => {}}
            onGroupDeleted={() => setSelectedGroup(null)}
            onItemUpdated={() => {}}
            stockView={"amount"}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            userNames={mergedUserNames}
            // ItemGroupDetails requires transactions for report-side ledger rendering.
            transactions={allVouchers}
          />
        );
      }
    }
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Select a group</CardTitle>
            <CardDescription>Choose a group from the list to view transactions.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  };

  if (isMobile) {
    const mobileSummaryName =
      selectedMember != null
        ? String(selectedMember.name ?? selectedMember.accountName ?? "").trim()
        : selectedGroup != null
          ? String(selectedGroup.name ?? "").trim()
          : "";
    const mobileSummaryBalance =
      selectedMember != null ? selectedMember.balance : selectedGroup != null ? selectedGroup.balance : undefined;

    return (
      <div className="h-full flex flex-col min-h-0 overflow-hidden bg-background">
        {mobileSummaryName ? (
          <div className="flex flex-shrink-0 items-center gap-1.5 border-b px-3 py-2 min-w-0">
            <h1 className="shrink-0 text-base font-bold">Group Summary</h1>
            <span className="shrink-0 select-none text-muted-foreground/55" aria-hidden>
              ·
            </span>
            <span
              className={cn("min-w-0 truncate text-sm font-medium", masterDetailBalanceToneClass(mobileSummaryBalance))}
              title={mobileSummaryName}
            >
              {mobileSummaryName}
            </span>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 p-3 border-b flex-shrink-0">
          <div className="flex justify-center items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{dateRangeLabel}</span>
            {hasDateFilter && (
              <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => setDateRange(undefined)} title="Clear date filter">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Combobox
                options={groupDropdownOptions}
                value={selectedGroup?.id || ""}
                onChange={(value) => {
                  const grp = processedGroups.find((g) => g.id === value);
                  if (grp) {
                    setSelectedGroup(grp);
                    setSelectedMember(null);
                  }
                }}
                placeholder="Group"
              />
            </div>
            <div className="flex-1 min-w-0">
              <Combobox
                options={accountDropdownOptions}
                value={selectedMember?.id || ""}
                onChange={(value) => {
                  const groupType = (selectedGroup as any)?.groupType;
                  let member: any = null;
                  if (groupType === 'tax') member = processedTaxes.find((t: any) => t.id === value);
                  else if (groupType === 'staff') member = processedStaff.find((s: any) => s.id === value);
                  else if (groupType === 'account') member = processedAccounts.find((a: any) => a.id === value);
                  else if (groupType === 'expense') member = processedExpenseAccounts.find((e: any) => e.id === value);
                  else if (groupType === 'item') member = processedItems.find((i: any) => i.id === value);
                  else member = selectedPartiesForDetails.find((p: any) => p.id === value) || null;
                  setSelectedMember(member || null);
                }}
                placeholder="Account"
              />
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{renderGroupDetailsContent()}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(280px,max-content)_minmax(0,1fr)] min-h-0 overflow-hidden">
        <div className="flex flex-col min-h-0 border-r overflow-hidden bg-muted/30">
          <div className="p-4 border-b space-y-3 flex-shrink-0">
            <ReportRegisterListHeading>Group Summary</ReportRegisterListHeading>
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
                placeholder="Search groups..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="px-3 pt-2 pb-1 border-b flex-shrink-0">
            <h3 className="text-sm font-semibold">Groups ({filteredGroups.length})</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
            {/* Non–Income & Expense system groups (Parties, Bank/Cash, Staff, Tax, Items): system group → user groups. */}
            {otherSystemGroups
              .filter((sys) => {
                if (filteredGroupIds.has(sys.id)) return true;
                const children = systemChildrenMap.get(sys.id) || [];
                return children.some((c) => filteredGroupIds.has(c.id));
              })
              .map((sys) => {
                const children = (systemChildrenMap.get(sys.id) || []).filter((c) => filteredGroupIds.has(c.id));
                const isExpanded = expandedSystemGroupIds.has(sys.id);
                const systemBalance = children.reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
                return (
                  <div key={sys.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => handleSelectGroup(sys)}
                      className={cn(
                        "w-full flex items-center justify-between rounded-md border px-2 py-1.5 text-left",
                        selectedGroup?.id === sys.id && masterListSelectedCn,
                        selectedGroup?.id !== sys.id && masterListUnselectedCn
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {children.length > 0 ? (
                          <span
                            className="cursor-pointer text-muted-foreground"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSystemGroup(sys);
                            }}
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </span>
                        ) : (
                          <span className="w-3.5" />
                        )}
                        <span className="truncate text-sm font-medium">{sys.name}</span>
                      </div>
                      {!isExpanded && (
                        <span className={cn("text-xs font-semibold", systemBalance >= 0 ? "text-green-600" : "text-red-600")}>
                          {formatCurrency(systemBalance, { showDrCr: true, noSuffix: true })}
                        </span>
                      )}
                    </button>
                    {isExpanded && children.length > 0 && (
                      <div className="ml-5 space-y-1">
                        {children.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            onClick={() => handleSelectGroup(child)}
                            className={cn(
                              "w-full flex items-center justify-between rounded-md border px-2 py-1.5 text-left",
                              selectedGroup?.id === child.id && masterListSelectedCn,
                              selectedGroup?.id !== child.id && masterListUnselectedCn
                            )}
                          >
                            <span className="truncate text-sm">{child.name}</span>
                            <span className={cn("text-xs font-semibold", (Number(child.balance) || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                              {formatCurrency(Number(child.balance) || 0, { showDrCr: true, noSuffix: true })}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            {/* Income & Expense entity only: parent "Income" / "Expense" and under them system groups → user groups. */}
            {(expenseIncomeSystemGroups.some((s) => filteredGroupIds.has(s.id) || (systemChildrenMap.get(s.id) || []).some((c) => filteredGroupIds.has(c.id))) ||
              expenseExpenseSystemGroups.some((s) => filteredGroupIds.has(s.id) || (systemChildrenMap.get(s.id) || []).some((c) => filteredGroupIds.has(c.id)))) && (
              <>
                <div className="pt-1 border-t mt-1" />
                {[
                  { key: "income" as const, label: "Income", systemGroups: expenseIncomeSystemGroups },
                  { key: "expense" as const, label: "Expense", systemGroups: expenseExpenseSystemGroups },
                ].map(({ key, label, systemGroups: sysList }) => {
                  const visibleSys = sysList.filter((s) => filteredGroupIds.has(s.id) || (systemChildrenMap.get(s.id) || []).some((c) => filteredGroupIds.has(c.id)));
                  if (visibleSys.length === 0) return null;
                  const isParentExpanded = expandedExpenseParentIds.has(key);
                  const parentBalance = visibleSys.reduce((sum, s) => {
                    const children = (systemChildrenMap.get(s.id) || []).filter((c) => filteredGroupIds.has(c.id));
                    const bal = children.length > 0 ? children.reduce((a, c) => a + (Number(c.balance) || 0), 0) : Number(s.balance) || 0;
                    return sum + bal;
                  }, 0);
                  return (
                    <div key={key} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleExpenseParent(key)}
                        className={cn(
                          "w-full flex items-center justify-between rounded-md border px-2 py-1.5 text-left font-medium",
                          "bg-muted/50"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-muted-foreground">
                            {isParentExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </span>
                          <span className="truncate text-sm">{label}</span>
                        </div>
                        {!isParentExpanded && (
                          <span className={cn("text-xs font-semibold", parentBalance >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(parentBalance, { showDrCr: true, noSuffix: true })}
                          </span>
                        )}
                      </button>
                      {isParentExpanded &&
                        visibleSys.map((sys) => {
                          const children = (systemChildrenMap.get(sys.id) || []).filter((c) => filteredGroupIds.has(c.id));
                          const isExpanded = expandedSystemGroupIds.has(sys.id);
                          const systemBalance = children.reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
                          return (
                            <div key={sys.id} className="ml-4 space-y-1">
                              <button
                                type="button"
                                onClick={() => handleSelectGroup(sys)}
                                className={cn(
                                  "w-full flex items-center justify-between rounded-md border px-2 py-1.5 text-left",
                                  selectedGroup?.id === sys.id && masterListSelectedCn,
                        selectedGroup?.id !== sys.id && masterListUnselectedCn
                                )}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {children.length > 0 ? (
                                    <span
                                      className="cursor-pointer text-muted-foreground"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleSystemGroup(sys);
                                      }}
                                    >
                                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    </span>
                                  ) : (
                                    <span className="w-3.5" />
                                  )}
                                  <span className="truncate text-sm font-medium">{sys.name}</span>
                                </div>
                                {!isExpanded && (
                                  <span className={cn("text-xs font-semibold", systemBalance >= 0 ? "text-green-600" : "text-red-600")}>
                                    {formatCurrency(systemBalance, { showDrCr: true, noSuffix: true })}
                                  </span>
                                )}
                              </button>
                              {isExpanded && children.length > 0 && (
                                <div className="ml-5 space-y-1">
                                  {children.map((child) => (
                                    <button
                                      key={child.id}
                                      type="button"
                                      onClick={() => handleSelectGroup(child)}
                                      className={cn(
                                        "w-full flex items-center justify-between rounded-md border px-2 py-1.5 text-left",
                                        selectedGroup?.id === child.id && masterListSelectedCn,
                              selectedGroup?.id !== child.id && masterListUnselectedCn
                                      )}
                                    >
                                      <span className="truncate text-sm">{child.name}</span>
                                      <span className={cn("text-xs font-semibold", (Number(child.balance) || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                                        {formatCurrency(Number(child.balance) || 0, { showDrCr: true, noSuffix: true })}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </>
            )}
            {userGroups
              .filter((g) => filteredGroupIds.has(g.id) && !getTopSystemAncestorId(g))
              .map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleSelectGroup(g)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-md border px-2 py-1.5 text-left",
                    selectedGroup?.id === g.id && masterListSelectedCn,
                    selectedGroup?.id !== g.id && masterListUnselectedCn
                  )}
                >
                  <span className="truncate text-sm">{g.name}</span>
                  <span className={cn("text-xs font-semibold", (Number(g.balance) || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(Number(g.balance) || 0, { showDrCr: true, noSuffix: true })}
                  </span>
                </button>
              ))}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {selectedGroup ? (
            renderGroupDetailsContent()
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <Card className="w-full max-w-md text-center">
                <CardHeader>
                  <CardTitle>Select a group</CardTitle>
                  <CardDescription>
                    Choose a group from the list to view transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No groups found. Create a group to see it here.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
