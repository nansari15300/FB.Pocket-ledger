import type { ExpenseGroup } from "@/components/expenses/types";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import {
  compareGroupListMembers,
  filterGroupListMembersByQuickFilter,
  resolveGroupListMemberSearchText,
  sortGroupListMembers,
} from "@/lib/groupListExpand";
import { masterEntityTextMatchesSearch, shouldHideEntityListSettledRow } from "@/lib/filterMasterEntityListRows";
import {
  isMasterEntityLegacyUngroupedGroupId,
  isMasterEntitySystemGroupId,
  resolveExpenseListGroupBucketId,
} from "@/lib/masterEntitySystemGroups";
import { EXPENSE_ENTITY_GROUP_PRESET } from "@/lib/masterEntityGroupFormPresets";
import { collectMasterGroupUserGroupIdsUnderBranch } from "@/lib/masterGroupMemberScope";

/** Form + account picker nested indent (px per level). */
export const EXPENSE_GROUP_TREE_INDENT_PX = 15;

/** Virtual P&L roots — user groups chain inke niche ya kisi user group ke niche. */
export const EXPENSE_GROUP_ROOT_PARENT_IDS = new Set([
  "income",
  "expenses",
  "direct_income",
  "indirect_income",
  "direct_expense",
  "indirect_expense",
]);

export const EXPENSE_GROUP_TOP_PARENT_OPTIONS = [
  { id: "income", name: "Income" },
  { id: "expenses", name: "Expenses" },
] as const;

export type ExpenseGroupTreeNode = {
  group: ExpenseGroup;
  children: ExpenseGroupTreeNode[];
  depth: number;
};

function groupBuildOrderKey(a: ExpenseGroup, b: ExpenseGroup) {
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export type ExpenseGroupListBranch = "income" | "expenses";

/** User-visible groups se parentId chain tree. */
export function buildExpenseGroupForest(groups: ExpenseGroup[]): ExpenseGroupTreeNode[] {
  const byId = new Map<string, ExpenseGroup>();
  for (const g of groups) {
    if (g?.id) byId.set(g.id, g);
  }

  const childIdsByParent = new Map<string, string[]>();
  for (const g of groups) {
    const pid = String(g.parentId || "").trim();
    if (!pid) continue;
    const list = childIdsByParent.get(pid) ?? [];
    list.push(g.id);
    childIdsByParent.set(pid, list);
  }

  const buildNode = (group: ExpenseGroup, depth: number): ExpenseGroupTreeNode => {
    const childIds = childIdsByParent.get(group.id) ?? [];
    const children = childIds
      .map((id) => byId.get(id))
      .filter((g): g is ExpenseGroup => Boolean(g))
      .sort(groupBuildOrderKey)
      .map((g) => buildNode(g, depth + 1));
    return { group, children, depth };
  };

  const roots = groups
    .filter((g) => {
      const pid = String(g.parentId || "").trim();
      return !pid || EXPENSE_GROUP_ROOT_PARENT_IDS.has(pid) || !byId.has(pid);
    })
    .sort(groupBuildOrderKey);

  return roots.map((g) => buildNode(g, 0));
}

/** Flatten tree for counts / search helpers. */
export function flattenExpenseGroupForest(nodes: ExpenseGroupTreeNode[]): ExpenseGroupTreeNode[] {
  const out: ExpenseGroupTreeNode[] = [];
  const walk = (list: ExpenseGroupTreeNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function collectExpenseGroupDescendantIds(
  groupId: string,
  groups: ExpenseGroup[]
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const g of groups) {
    const pid = String(g.parentId || "").trim();
    if (!pid) continue;
    const list = childrenByParent.get(pid) ?? [];
    list.push(g.id);
    childrenByParent.set(pid, list);
  }
  const out = new Set<string>();
  const stack = [...(childrenByParent.get(groupId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return out;
}

/** Edit/create — parent picker (self + descendants exclude). */
export function buildExpenseGroupParentOptions(
  groups: ExpenseGroup[],
  excludeGroupId?: string
): { id: string; name: string; depth: number }[] {
  const exclude = new Set<string>();
  if (excludeGroupId) {
    exclude.add(excludeGroupId);
    collectExpenseGroupDescendantIds(excludeGroupId, groups).forEach((id) => exclude.add(id));
  }

  const forest = buildExpenseGroupForest(groups);
  const out: { id: string; name: string; depth: number }[] = [];

  for (const opt of EXPENSE_GROUP_TOP_PARENT_OPTIONS) {
    out.push({ id: opt.id, name: opt.name, depth: 0 });
  }

  const walk = (nodes: ExpenseGroupTreeNode[]) => {
    for (const n of nodes) {
      if (!exclude.has(n.group.id)) {
        const prefix = n.depth > 0 ? `${"—".repeat(n.depth)} ` : "";
        out.push({ id: n.group.id, name: `${prefix}${n.group.name}`, depth: n.depth + 1 });
      }
      walk(n.children);
    }
  };
  walk(forest);
  return out;
}

/** Nested create form — root + child names (empty middle rows allowed until delete). */
export function normalizeNestedExpenseGroupNames(rootName: string, childNames: string[]): string[] {
  const root = rootName.trim();
  if (!root) return [];
  const tail = childNames.map((s) => s.trim()).filter(Boolean);
  return [root, ...tail];
}

/** Create-group dialog — har level par existing id ya pending naam (save par tree banta hai). */
export type ExpenseGroupCreateChainSlot = {
  groupId?: string;
  pendingName?: string;
};

export const EXPENSE_GROUP_PENDING_SLOT_PREFIX = "__expense_pending__:";

export function expenseGroupPendingSlotValue(name: string): string {
  return `${EXPENSE_GROUP_PENDING_SLOT_PREFIX}${name}`;
}

export function parseExpenseGroupPendingSlotValue(value: string): string | null {
  if (!value.startsWith(EXPENSE_GROUP_PENDING_SLOT_PREFIX)) return null;
  const name = value.slice(EXPENSE_GROUP_PENDING_SLOT_PREFIX.length);
  return name || null;
}

export function isExpenseGroupCreateChainSlotEmpty(slot?: ExpenseGroupCreateChainSlot): boolean {
  return !slot?.groupId && !String(slot?.pendingName || "").trim();
}

export function trimTrailingEmptyCreateChainSlots(
  slots: ExpenseGroupCreateChainSlot[]
): ExpenseGroupCreateChainSlot[] {
  const next = [...slots];
  while (next.length > 0 && isExpenseGroupCreateChainSlotEmpty(next[next.length - 1])) {
    next.pop();
  }
  return next;
}

export function expenseGroupCreateChainPendingNames(slots: ExpenseGroupCreateChainSlot[]): string[] {
  return trimTrailingEmptyCreateChainSlots(slots)
    .map((s) => String(s.pendingName || "").trim())
    .filter(Boolean);
}

/** Existing group ids in chain (save se pehle parent walk). */
export function expenseGroupCreateChainGroupIds(slots: ExpenseGroupCreateChainSlot[]): string[] {
  return trimTrailingEmptyCreateChainSlots(slots)
    .map((s) => s.groupId)
    .filter((id): id is string => Boolean(id));
}

function nodeMatchesQuickFilter(
  group: ExpenseGroup,
  quickFilter: string,
  hideSettled?: boolean
): boolean {
  const balRaw = group.balance;
  const bal = typeof balRaw === "number" && !Number.isNaN(balRaw) ? balRaw : null;
  const isSettled = bal !== null && Math.abs(bal) < 1e-6;
  if (shouldHideEntityListSettledRow(balRaw, hideSettled, quickFilter as EntityListQuickFilter)) {
    return false;
  }
  if (
    quickFilter === "default" ||
    quickFilter === "latest" ||
    quickFilter === "amount" ||
    quickFilter === "amount_asc" ||
    quickFilter === "name" ||
    quickFilter === "date"
  )
    return true;
  if (quickFilter === "dr") return bal !== null && bal > 0;
  if (quickFilter === "cr") return bal !== null && bal < 0;
  if (quickFilter === "settled") return isSettled;
  if (quickFilter === "non_settled") return bal === null || !isSettled;
  return true;
}

/** Search + quick filter — parent dikhe jab khud ya koi child / account match ho. */
export function filterExpenseGroupForest(
  nodes: ExpenseGroupTreeNode[],
  searchTerm: string,
  quickFilter: string,
  groupMembersByGroupId: Record<string, { name?: string; accountName?: string }[]>,
  hideSettled?: boolean
): ExpenseGroupTreeNode[] {
  const q = searchTerm.trim().toLowerCase();

  const collectDescendantMembers = (node: ExpenseGroupTreeNode) => {
    const out: { name?: string; accountName?: string }[] = [
      ...(groupMembersByGroupId[node.group.id] ?? []),
    ];
    for (const child of node.children) {
      out.push(...collectDescendantMembers(child));
    }
    return out;
  };

  const walk = (node: ExpenseGroupTreeNode): ExpenseGroupTreeNode | null => {
    const nameMatch = !q || masterEntityTextMatchesSearch(node.group.name, searchTerm);
    const memberMatch =
      q.length > 0 &&
      collectDescendantMembers(node).some((m) =>
        masterEntityTextMatchesSearch(resolveGroupListMemberSearchText(m), searchTerm)
      );
    const selfMatch =
      (nameMatch || memberMatch) && nodeMatchesQuickFilter(node.group, quickFilter, hideSettled);

    const filteredChildren = node.children
      .map((c) => walk(c))
      .filter((c): c is ExpenseGroupTreeNode => Boolean(c));

    if (selfMatch || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  };

  return nodes.map((n) => walk(n)).filter((n): n is ExpenseGroupTreeNode => Boolean(n));
}

/** Search mode — expand every group on paths in filtered forest (+ ancestors). */
export function buildExpenseGroupSearchExpandedIds(
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[],
  allGroups: ExpenseGroup[]
): Set<string> {
  const ids = new Set<string>([
    expenseGroupBranchListExpandKey("income"),
    expenseGroupBranchListExpandKey("expenses"),
  ]);

  const walk = (node: ExpenseGroupTreeNode) => {
    ids.add(expenseGroupTreeExpandKey(node.group.id));
    collectExpenseGroupAncestorIds(node.group.id, allGroups).forEach((ancestorId) => {
      ids.add(expenseGroupTreeExpandKey(ancestorId));
    });
    node.children.forEach(walk);
  };

  for (const node of [...incomeForest, ...expensesForest]) walk(node);
  return ids;
}

export function countVisibleExpenseGroupForestNodes(
  forest: ExpenseGroupTreeNode[]
): number {
  return flattenExpenseGroupForest(forest).length;
}

export function isExpenseGroupSystemListBranchId(
  id: string | null | undefined
): id is ExpenseGroupListBranch {
  return id === "income" || id === "expenses";
}

export function sumExpenseGroupForestBalance(nodes: ExpenseGroupTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + Number(node.group.balance || 0), 0);
}

/** Accounts posted directly under Income / Expenses system branch (incl. direct_income / direct_expense). */
export function expenseGroupBranchDirectMembersFromMap<T extends { id: string; balance?: number }>(
  branch: ExpenseGroupListBranch,
  groupMembersByGroupId: Record<string, T[]>
): T[] {
  const byId = new Map<string, T>();
  const push = (list: T[] | undefined) => {
    for (const row of list ?? []) {
      if (row?.id) byId.set(row.id, row);
    }
  };
  push(groupMembersByGroupId[branch]);
  if (branch === "income") push(groupMembersByGroupId.direct_income);
  if (branch === "expenses") push(groupMembersByGroupId.direct_expense);
  return Array.from(byId.values());
}

export function sumExpenseGroupBranchDirectMemberBalance(
  branch: ExpenseGroupListBranch,
  groupMembersByGroupId: Record<string, { id: string; balance?: number }[]>
): number {
  return expenseGroupBranchDirectMembersFromMap(branch, groupMembersByGroupId).reduce(
    (sum, member) => sum + Number(member.balance || 0),
    0
  );
}

/** Filtered list — Income vs Expenses system branch net balance (forest roots). */
export function sumExpenseGroupSystemBranchBalancesFromForest(
  forest: ExpenseGroupTreeNode[]
): { income: number; expenses: number } {
  const { income, expenses } = splitExpenseGroupForestByBranch(forest);
  return {
    income: sumExpenseGroupForestBalance(income),
    expenses: sumExpenseGroupForestBalance(expenses),
  };
}

/** Filtered accounts — Income vs Expenses system branch net balance. */
export function sumExpenseGroupSystemBranchBalancesFromAccounts<
  T extends { balance?: unknown; groupId?: string },
>(accounts: T[], allGroups: ExpenseGroup[]): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const row of accounts) {
    const bal = Number(row.balance) || 0;
    if (resolveExpenseGroupSystemBranchFromParentId(row.groupId, allGroups) === "income") {
      income += bal;
    } else {
      expenses += bal;
    }
  }
  return { income, expenses };
}

export function buildExpenseGroupSystemBranchGroup(
  branch: ExpenseGroupListBranch,
  branchForest: ExpenseGroupTreeNode[],
  companyId: string
): ExpenseGroup {
  const label =
    EXPENSE_GROUP_TOP_PARENT_OPTIONS.find((o) => o.id === branch)?.name ?? branch;
  return {
    id: branch,
    name: label,
    companyId,
    parentId: "",
    balance: sumExpenseGroupForestBalance(branchForest),
    debit: 0,
    credit: 0,
    isSystemReserved: true,
  } as ExpenseGroup;
}

export function collectExpenseGroupBranchAccounts<T extends { id: string; groupId?: string }>(
  branch: ExpenseGroupListBranch,
  allGroups: ExpenseGroup[],
  allAccounts: T[],
  resolveGroupMembers?: (groupId: string) => T[]
): T[] {
  const byId = new Map<string, T>();

  for (const account of allAccounts) {
    if (
      resolveExpenseGroupSystemBranchFromParentId(account.groupId, allGroups) === branch
    ) {
      byId.set(account.id, account);
    }
  }

  if (resolveGroupMembers) {
    if (branch === "income") {
      for (const row of resolveGroupMembers("direct_income")) {
        if (row.id) byId.set(row.id, row);
      }
    }
    if (branch === "expenses") {
      for (const row of resolveGroupMembers("expenses")) {
        if (row.id) byId.set(row.id, row);
      }
      for (const row of resolveGroupMembers("direct_expense")) {
        if (row.id) byId.set(row.id, row);
      }
    }
  }

  return Array.from(byId.values());
}

function isExpensePresetSystemGroupId(id: string): boolean {
  return (
    isMasterEntitySystemGroupId(EXPENSE_ENTITY_GROUP_PRESET, id) ||
    isExpenseGroupSystemListBranchId(id)
  );
}

/** Group id + nested child group ids for ledger / voucher group context. */
export function collectExpenseGroupScopeGroupIds(
  groupId: string,
  allGroups: ExpenseGroup[]
): string[] {
  const gid = String(groupId || "").trim();
  if (!gid) return [];

  if (isExpenseGroupSystemListBranchId(gid)) {
    const out = new Set<string>([gid]);
    for (const g of allGroups) {
      if (!g?.id) continue;
      if (resolveExpenseGroupSystemBranchFromParentId(g.parentId, allGroups) === gid) {
        out.add(g.id);
        collectExpenseGroupDescendantIds(g.id, allGroups).forEach((id) => out.add(id));
      }
    }
    return Array.from(out);
  }

  const out = new Set<string>([gid]);
  collectExpenseGroupDescendantIds(gid, allGroups).forEach((id) => out.add(id));
  return Array.from(out);
}

/** All expense accounts under a group label (direct members + nested groups). */
export function collectExpenseGroupScopeAccounts<T extends { id: string; groupId?: string | null }>(
  groupId: string,
  allGroups: ExpenseGroup[],
  allAccounts: T[],
  resolveGroupMembers?: (groupId: string) => T[]
): T[] {
  const gid = String(groupId || "").trim();
  if (!gid) return [];

  if (isExpenseGroupSystemListBranchId(gid)) {
    return collectExpenseGroupBranchAccounts(gid, allGroups, allAccounts, resolveGroupMembers);
  }

  const byId = new Map<string, T>();
  const addRows = (rows: T[]) => {
    for (const row of rows) {
      if (row?.id) byId.set(row.id, row);
    }
  };

  if (isMasterEntitySystemGroupId(EXPENSE_ENTITY_GROUP_PRESET, gid)) {
    addRows(allAccounts.filter((acc) => resolveExpenseListGroupBucketId(acc) === gid));
    const nestedGroupIds = collectMasterGroupUserGroupIdsUnderBranch(
      gid,
      allGroups,
      isExpensePresetSystemGroupId
    );
    addRows(allAccounts.filter((acc) => nestedGroupIds.has(resolveExpenseListGroupBucketId(acc))));
    if (resolveGroupMembers) addRows(resolveGroupMembers(gid));
    return Array.from(byId.values());
  }

  const scopeGroupIds = new Set(collectExpenseGroupScopeGroupIds(gid, allGroups));
  addRows(allAccounts.filter((acc) => scopeGroupIds.has(String(acc.groupId || "").trim())));
  if (resolveGroupMembers) {
    for (const scopeId of scopeGroupIds) {
      addRows(resolveGroupMembers(scopeId));
    }
  }

  if (gid === "direct_income") {
    const salesAccount = allAccounts.find((acc) => acc.id === "sales_account");
    if (salesAccount) byId.set(salesAccount.id, salesAccount);
  }
  if (gid === "direct_expense") {
    const purchaseAccount = allAccounts.find((acc) => acc.id === "purchase_account");
    if (purchaseAccount) byId.set(purchaseAccount.id, purchaseAccount);
  }

  return Array.from(byId.values());
}

export function sumExpenseGroupForestLeafTotals(
  forest: ExpenseGroupTreeNode[]
): { debit: number; credit: number; balance: number } {
  const flat = flattenExpenseGroupForest(forest);
  const leaves = flat.filter((node) => node.children.length === 0);
  return leaves.reduce(
    (acc, node) => ({
      debit: acc.debit + Number(node.group.debit || 0),
      credit: acc.credit + Number(node.group.credit || 0),
      balance: acc.balance + Number(node.group.balance || 0),
    }),
    { debit: 0, credit: 0, balance: 0 }
  );
}

export function sortExpenseGroupTreeNodes(
  nodes: ExpenseGroupTreeNode[],
  quickFilter: EntityListQuickFilter | string,
  lastVoucherMsById?: Map<string, number> | null
): ExpenseGroupTreeNode[] {
  const filter = quickFilter as EntityListQuickFilter;
  const sorted = [...nodes].sort((a, b) =>
    compareGroupListMembers(a.group, b.group, filter, undefined, lastVoucherMsById)
  );
  return sorted.map((n) => ({
    ...n,
    children: sortExpenseGroupTreeNodes(n.children, filter, lastVoucherMsById),
  }));
}

export type ExpenseGroupListBranchSortRow = {
  branch: ExpenseGroupListBranch;
  balance: number;
  openingBalanceDate?: unknown;
};

/** Income / Expenses system branch cards — same footer filter + sort as account rows. */
export function sortExpenseGroupListBranches(
  rows: ExpenseGroupListBranchSortRow[],
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null
): ExpenseGroupListBranchSortRow[] {
  type BranchSortEntry = ExpenseGroupListBranchSortRow & {
    id: string;
    name: string;
  };

  const entries: BranchSortEntry[] = rows.map((row) => ({
    ...row,
    id: row.branch,
    name: EXPENSE_GROUP_TOP_PARENT_OPTIONS.find((o) => o.id === row.branch)?.name ?? row.branch,
  }));

  const filtered = filterGroupListMembersByQuickFilter(entries, quickFilter);
  return sortGroupListMembers(filtered, quickFilter, (entry) => entry.name, lastVoucherMsById);
}

export const EXPENSE_GROUP_TREE_EXPAND_PREFIX = "exp-grp:";

export const EXPENSE_GROUP_SYSTEM_EXPAND_PREFIX = "exp-sys:";

const EXPENSE_GROUP_INCOME_PARENT_IDS = new Set(["income", "direct_income", "indirect_income"]);
const EXPENSE_GROUP_EXPENSES_PARENT_IDS = new Set(["expenses", "direct_expense", "indirect_expense"]);

export const EXPENSE_GROUP_STEPPED_DIRECT_VALUE = "__expense_branch_direct__";

export function expenseGroupBranchParentIds(branch: ExpenseGroupListBranch): string[] {
  return branch === "income"
    ? Array.from(EXPENSE_GROUP_INCOME_PARENT_IDS)
    : Array.from(EXPENSE_GROUP_EXPENSES_PARENT_IDS);
}

export function resolveExpenseGroupSystemBranchFromParentId(
  parentId: string | undefined,
  allGroups: ExpenseGroup[]
): ExpenseGroupListBranch {
  const pid = String(parentId || "").trim();
  if (EXPENSE_GROUP_INCOME_PARENT_IDS.has(pid)) return "income";
  if (EXPENSE_GROUP_EXPENSES_PARENT_IDS.has(pid)) return "expenses";
  const byId = new Map(allGroups.map((g) => [g.id, g]));
  let walk = byId.get(pid);
  const seen = new Set<string>();
  while (walk && !seen.has(walk.id)) {
    seen.add(walk.id);
    const pp = String(walk.parentId || "").trim();
    if (EXPENSE_GROUP_INCOME_PARENT_IDS.has(pp)) return "income";
    if (EXPENSE_GROUP_EXPENSES_PARENT_IDS.has(pp)) return "expenses";
    if (!pp || EXPENSE_GROUP_ROOT_PARENT_IDS.has(pp)) break;
    walk = byId.get(pp);
  }
  return "expenses";
}

/** Edit open — system branch + ancestor ids (immediate parent chain, top = field 2). */
export function decodeExpenseGroupParentPath(
  group: ExpenseGroup,
  allGroups: ExpenseGroup[]
): { systemBranch: ExpenseGroupListBranch; parentPathIds: string[] } {
  const parentId = String(group.parentId || "").trim();
  const systemBranch = resolveExpenseGroupSystemBranchFromParentId(parentId, allGroups);
  if (!parentId || EXPENSE_GROUP_ROOT_PARENT_IDS.has(parentId)) {
    return { systemBranch, parentPathIds: [] };
  }
  const byId = new Map(allGroups.map((g) => [g.id, g]));
  const path: string[] = [];
  let walkId = parentId;
  const seen = new Set<string>();
  while (walkId && !seen.has(walkId)) {
    seen.add(walkId);
    path.unshift(walkId);
    const parent = byId.get(walkId);
    const pp = String(parent?.parentId || "").trim();
    if (!pp || EXPENSE_GROUP_ROOT_PARENT_IDS.has(pp)) break;
    walkId = pp;
  }
  return { systemBranch, parentPathIds: path };
}

export function resolveExpenseGroupParentIdFromPath(
  systemBranch: ExpenseGroupListBranch,
  parentPathIds: string[]
): string {
  const cleaned = parentPathIds.filter(Boolean);
  if (cleaned.length === 0) return systemBranch;
  return cleaned[cleaned.length - 1]!;
}

export function listExpenseGroupChildrenForParent(
  allGroups: ExpenseGroup[],
  parentId: string,
  excludeGroupId?: string
): ExpenseGroup[] {
  const exclude = new Set<string>();
  if (excludeGroupId) {
    exclude.add(excludeGroupId);
    collectExpenseGroupDescendantIds(excludeGroupId, allGroups).forEach((id) => exclude.add(id));
  }
  return allGroups
    .filter((g) => {
      if (!g?.id || exclude.has(g.id)) return false;
      return String(g.parentId || "").trim() === parentId;
    })
    .sort(groupBuildOrderKey);
}

export function listExpenseGroupLevelOptions(
  allGroups: ExpenseGroup[],
  branch: ExpenseGroupListBranch,
  parentPathIds: string[],
  levelIndex: number,
  excludeGroupId?: string
): ExpenseGroup[] {
  if (levelIndex === 0) {
    const branchParents = expenseGroupBranchParentIds(branch);
    const exclude = new Set<string>();
    if (excludeGroupId) {
      exclude.add(excludeGroupId);
      collectExpenseGroupDescendantIds(excludeGroupId, allGroups).forEach((id) => exclude.add(id));
    }
    return allGroups
      .filter((g) => {
        if (!g?.id || exclude.has(g.id)) return false;
        const pid = String(g.parentId || "").trim();
        return branchParents.includes(pid);
      })
      .sort(groupBuildOrderKey);
  }
  const parentId = parentPathIds[levelIndex - 1];
  if (!parentId) return [];
  return listExpenseGroupChildrenForParent(allGroups, parentId, excludeGroupId);
}

export function expenseGroupBranchListExpandKey(branch: ExpenseGroupListBranch): string {
  return `${EXPENSE_GROUP_SYSTEM_EXPAND_PREFIX}${branch}`;
}

export function defaultExpenseGroupListExpandedIds(): Set<string> {
  return new Set([
    expenseGroupBranchListExpandKey("income"),
    expenseGroupBranchListExpandKey("expenses"),
  ]);
}

export function toggleExpenseGroupSystemBranchExpand(
  expandedIds: Set<string>,
  branch: ExpenseGroupListBranch
): Set<string> {
  const key = expenseGroupBranchListExpandKey(branch);
  const next = new Set(expandedIds);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function collapseExpenseGroupSystemBranch(
  expandedIds: Set<string>,
  branch: ExpenseGroupListBranch
): Set<string> {
  const key = expenseGroupBranchListExpandKey(branch);
  if (!expandedIds.has(key)) return expandedIds;
  const next = new Set(expandedIds);
  next.delete(key);
  return next;
}

/** Top-level user groups directly under Income / Expenses system branches. */
export function listExpenseGroupParentGroupIds(
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[]
): string[] {
  return [...incomeForest, ...expensesForest].map((node) => node.group.id);
}

export function resolveExpenseGroupRootParentGroupId(
  groupId: string,
  allGroups: ExpenseGroup[],
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[]
): string {
  const rootIds = new Set(listExpenseGroupParentGroupIds(incomeForest, expensesForest));
  if (rootIds.has(groupId)) return groupId;
  for (const ancestorId of collectExpenseGroupAncestorIds(groupId, allGroups)) {
    if (rootIds.has(ancestorId)) return ancestorId;
  }
  return groupId;
}

/** Collapse every other parent group (Income + Expenses roots) while one stays open. */
export function collapseExpenseGroupRootParentsExcept(
  expandedIds: Set<string>,
  keepRootId: string,
  allGroups: ExpenseGroup[],
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[]
): Set<string> {
  const next = new Set(expandedIds);
  const removeGroupAndDescendants = (id: string) => {
    next.delete(expenseGroupTreeExpandKey(id));
    collectExpenseGroupDescendantIds(id, allGroups).forEach((childId) => {
      next.delete(expenseGroupTreeExpandKey(childId));
    });
  };
  for (const rootId of listExpenseGroupParentGroupIds(incomeForest, expensesForest)) {
    if (rootId !== keepRootId) removeGroupAndDescendants(rootId);
  }
  return next;
}

export function ensureExpenseGroupUserGroupExpanded(
  expandedIds: Set<string>,
  groupId: string
): Set<string> {
  const key = expenseGroupTreeExpandKey(groupId);
  if (expandedIds.has(key)) return expandedIds;
  const next = new Set(expandedIds);
  next.add(key);
  return next;
}

export function ensureExpenseGroupBranchListExpanded(
  expandedIds: Set<string>,
  branch: ExpenseGroupListBranch
): Set<string> {
  const key = expenseGroupBranchListExpandKey(branch);
  if (expandedIds.has(key)) return expandedIds;
  const next = new Set(expandedIds);
  next.add(key);
  return next;
}

export function collapseExpenseGroupUserGroupExpanded(
  expandedIds: Set<string>,
  groupId: string
): Set<string> {
  const key = expenseGroupTreeExpandKey(groupId);
  if (!expandedIds.has(key)) return expandedIds;
  const next = new Set(expandedIds);
  next.delete(key);
  return next;
}

export function collectExpenseGroupAncestorIds(
  groupId: string,
  groups: ExpenseGroup[]
): Set<string> {
  const byId = new Map(groups.filter((g) => g?.id).map((g) => [g.id, g]));
  const out = new Set<string>();
  let pid = String(byId.get(groupId)?.parentId || "").trim();
  while (pid && !EXPENSE_GROUP_ROOT_PARENT_IDS.has(pid)) {
    if (byId.has(pid)) out.add(pid);
    pid = String(byId.get(pid)?.parentId || "").trim();
  }
  return out;
}

export function isExpenseGroupAncestorOf(
  ancestorId: string,
  descendantId: string,
  groups: ExpenseGroup[]
): boolean {
  return collectExpenseGroupAncestorIds(descendantId, groups).has(ancestorId);
}

/** Expand focus — bright ids for active group + ancestors + descendants + system branch. */
export function buildExpenseGroupFocusBrightIds(
  focusGroupId: string | null,
  allGroups: ExpenseGroup[],
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[]
): Set<string> | null {
  if (!focusGroupId) return null;

  const bright = new Set<string>();

  if (focusGroupId === "income" || focusGroupId === "expenses") {
    bright.add(focusGroupId);
    const forest = focusGroupId === "income" ? incomeForest : expensesForest;
    for (const node of flattenExpenseGroupForest(forest)) {
      bright.add(node.group.id);
    }
    return bright;
  }

  bright.add(focusGroupId);
  collectExpenseGroupAncestorIds(focusGroupId, allGroups).forEach((id) => bright.add(id));
  collectExpenseGroupDescendantIds(focusGroupId, allGroups).forEach((id) => bright.add(id));

  const focusGroup = allGroups.find((g) => g.id === focusGroupId);
  if (focusGroup) {
    bright.add(resolveExpenseGroupSystemBranchFromParentId(focusGroup.parentId, allGroups));
  }

  return bright;
}

/** Collapse other parent groups; keep Income + Expenses system branches open. */
export function applyExpenseGroupParentFocusCollapse(
  expandedIds: Set<string>,
  focusGroupId: string,
  allGroups: ExpenseGroup[],
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[]
): Set<string> {
  const keepRootId = resolveExpenseGroupRootParentGroupId(
    focusGroupId,
    allGroups,
    incomeForest,
    expensesForest
  );
  let next = collapseExpenseGroupRootParentsExcept(
    expandedIds,
    keepRootId,
    allGroups,
    incomeForest,
    expensesForest
  );
  next = ensureExpenseGroupBranchListExpanded(next, "income");
  next = ensureExpenseGroupBranchListExpanded(next, "expenses");
  return next;
}

/** Focus expand — also open focused group path in the tree. */
export function applyExpenseGroupParentFocusExpand(
  expandedIds: Set<string>,
  focusGroupId: string,
  allGroups: ExpenseGroup[],
  incomeForest: ExpenseGroupTreeNode[],
  expensesForest: ExpenseGroupTreeNode[]
): Set<string> {
  let next = applyExpenseGroupParentFocusCollapse(
    expandedIds,
    focusGroupId,
    allGroups,
    incomeForest,
    expensesForest
  );
  const keepRootId = resolveExpenseGroupRootParentGroupId(
    focusGroupId,
    allGroups,
    incomeForest,
    expensesForest
  );
  next = ensureExpenseGroupUserGroupExpanded(next, keepRootId);
  if (keepRootId !== focusGroupId) {
    for (const ancestorId of collectExpenseGroupAncestorIds(focusGroupId, allGroups)) {
      next = ensureExpenseGroupUserGroupExpanded(next, ancestorId);
    }
    next = ensureExpenseGroupUserGroupExpanded(next, focusGroupId);
  }
  return next;
}

export const EXPENSE_GROUP_LIST_FOCUS_DIM_CLASS =
  "opacity-[0.38] saturate-[0.55] transition-opacity duration-200 pointer-events-auto";

/** Sibling accordion — legacy ungrouped / expenses branch share `expenses` parent. */
function expenseGroupAccordionParentId(group: ExpenseGroup | undefined, groupId: string): string {
  const id = group?.id || groupId;
  if (id === "expenses" || isMasterEntityLegacyUngroupedGroupId("expense", id)) return "expenses";
  return String(group?.parentId || "").trim();
}

export function toggleExpenseGroupUserGroupExpand(
  expandedIds: Set<string>,
  groupId: string,
  allGroups: ExpenseGroup[]
): Set<string> {
  const expandKey = expenseGroupTreeExpandKey(groupId);
  const next = new Set(expandedIds);

  const removeGroupAndDescendants = (id: string) => {
    next.delete(expenseGroupTreeExpandKey(id));
    collectExpenseGroupDescendantIds(id, allGroups).forEach((childId) => {
      next.delete(expenseGroupTreeExpandKey(childId));
    });
  };

  if (next.has(expandKey)) {
    removeGroupAndDescendants(groupId);
    return next;
  }

  const subject = allGroups.find((g) => g.id === groupId);
  const parentId = expenseGroupAccordionParentId(subject, groupId);

  for (const g of allGroups) {
    if (!g?.id || g.id === groupId) continue;
    if (expenseGroupAccordionParentId(g, g.id) !== parentId) continue;
    removeGroupAndDescendants(g.id);
  }

  next.add(expandKey);
  return next;
}

export function isExpenseGroupUserGroupExpanded(
  expandedIds: Set<string>,
  groupId: string
): boolean {
  return expandedIds.has(expenseGroupTreeExpandKey(groupId));
}

export function splitExpenseGroupForestByBranch(forest: ExpenseGroupTreeNode[]): {
  income: ExpenseGroupTreeNode[];
  expenses: ExpenseGroupTreeNode[];
} {
  const income: ExpenseGroupTreeNode[] = [];
  const expenses: ExpenseGroupTreeNode[] = [];
  for (const node of forest) {
    const pid = String(node.group.parentId || "").trim();
    if (EXPENSE_GROUP_INCOME_PARENT_IDS.has(pid)) {
      income.push(node);
    } else {
      expenses.push(node);
    }
  }
  return { income, expenses };
}

function branchContainsGroupId(nodes: ExpenseGroupTreeNode[], groupId: string): boolean {
  return flattenExpenseGroupForest(nodes).some((n) => n.group.id === groupId);
}

export function expenseGroupBranchForestContainsGroupId(
  branchForest: ExpenseGroupTreeNode[],
  groupId: string
): boolean {
  return branchContainsGroupId(branchForest, groupId);
}

export function isExpenseGroupBranchListExpanded(
  expandedIds: Set<string>,
  branch: ExpenseGroupListBranch,
  branchForest: ExpenseGroupTreeNode[]
): boolean {
  const branchKey = expenseGroupBranchListExpandKey(branch);
  if (expandedIds.has(branchKey)) return true;
  for (const id of expandedIds) {
    if (!id.startsWith(EXPENSE_GROUP_TREE_EXPAND_PREFIX)) continue;
    const groupId = parseExpenseGroupTreeExpandKey(id);
    if (groupId && branchContainsGroupId(branchForest, groupId)) return true;
  }
  return false;
}

export function expenseGroupTreeExpandKey(groupId: string): string {
  return `${EXPENSE_GROUP_TREE_EXPAND_PREFIX}${groupId}`;
}

export function parseExpenseGroupTreeExpandKey(key: string | null): string | null {
  if (!key?.startsWith(EXPENSE_GROUP_TREE_EXPAND_PREFIX)) return null;
  const id = key.slice(EXPENSE_GROUP_TREE_EXPAND_PREFIX.length);
  return id || null;
}

export type ExpenseGroupAccountComboboxOption = {
  value: string;
  label: string;
  triggerLabel?: string;
  depth?: number;
  disabled?: boolean;
  searchText?: string;
};

const EXPENSE_GROUP_BRANCH_HEADER_PREFIX = "__expense_branch_";

/** Account / loan forms — Income → Expenses tree with indent (group list jaisa). */
export function buildExpenseGroupAccountComboboxOptions(
  groups: Array<
    ExpenseGroup & { isReportOnly?: boolean; isAutoUngrouped?: boolean; isDeleted?: boolean }
  >
): ExpenseGroupAccountComboboxOption[] {
  const alive = groups.filter(
    (g) => g?.id && !g.isDeleted && g.isReportOnly !== true && g.isAutoUngrouped !== true
  );
  const forest = buildExpenseGroupForest(alive);
  const { income, expenses } = splitExpenseGroupForestByBranch(forest);

  const out: ExpenseGroupAccountComboboxOption[] = [];

  const appendBranch = (branchName: "Income" | "Expenses", nodes: ExpenseGroupTreeNode[]) => {
    if (nodes.length === 0) return;
    out.push({
      value: `${EXPENSE_GROUP_BRANCH_HEADER_PREFIX}${branchName.toLowerCase()}__`,
      label: branchName,
      triggerLabel: branchName,
      depth: 0,
      disabled: true,
    });
    const walk = (list: ExpenseGroupTreeNode[]) => {
      for (const n of list) {
        const triggerLabel = resolveExpenseGroupBreadcrumbLabel(n.group.id, alive);
        out.push({
          value: n.group.id,
          label: n.group.name,
          triggerLabel,
          depth: n.depth + 1,
          searchText: triggerLabel.toLowerCase(),
        });
        walk(n.children);
      }
    };
    walk(nodes);
  };

  appendBranch("Income", income);
  appendBranch("Expenses", expenses);
  return out;
}

/** Selected value trigger — full path e.g. Expenses / Balgram Home Epx / Sub. */
export function resolveExpenseGroupBreadcrumbLabel(
  groupId: string | null | undefined,
  groups: Array<ExpenseGroup & { parentId?: string }>,
  fallback = "Expenses"
): string {
  const gid = String(groupId || "").trim();
  if (!gid || isMasterEntityLegacyUngroupedGroupId("expense", gid)) return fallback;

  const byId = new Map(groups.filter((g) => g?.id).map((g) => [g.id, g]));
  const group = byId.get(gid);
  if (!group) return gid;

  const names: string[] = [String(group.name || "").trim() || gid];
  let pid = String(group.parentId || "").trim();
  while (pid && !EXPENSE_GROUP_ROOT_PARENT_IDS.has(pid)) {
    const parent = byId.get(pid);
    if (!parent) break;
    names.unshift(String(parent.name || "").trim() || pid);
    pid = String(parent.parentId || "").trim();
  }

  const branch = resolveExpenseGroupSystemBranchFromParentId(group.parentId, groups as ExpenseGroup[]);
  const branchName =
    EXPENSE_GROUP_TOP_PARENT_OPTIONS.find((o) => o.id === branch)?.name ?? "Expenses";
  if (names[0] !== branchName) names.unshift(branchName);
  return names.join(" / ");
}
