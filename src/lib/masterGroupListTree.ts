/** Generic master group list tree — Income/Expense-style nested groups for all entities. */

import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import {
  compareGroupListMembers,
  filterGroupListMembersByQuickFilter,
  resolveGroupListMemberSearchText,
  sortGroupListMembers,
} from "@/lib/groupListExpand";
import { masterEntityTextMatchesSearch, shouldHideEntityListSettledRow } from "@/lib/filterMasterEntityListRows";

export type MasterGroupListRow = {
  id: string;
  name: string;
  parentId?: string;
  balance?: number;
  debit?: number;
  credit?: number;
  companyId?: string;
  isSystemReserved?: boolean;
  openingBalanceDate?: unknown;
};

export type MasterGroupTreeNode<G extends MasterGroupListRow = MasterGroupListRow> = {
  group: G;
  children: MasterGroupTreeNode<G>[];
  depth: number;
};

export type MasterGroupListBranchDef = {
  id: string;
  name: string;
  rootParentIds: string[];
};

export type MasterGroupListConfig = {
  sysExpandPrefix: string;
  grpExpandPrefix: string;
  branches: MasterGroupListBranchDef[];
  /** Parent ids that terminate ancestor walk (virtual P&L roots, etc.). */
  virtualRootIds?: Set<string>;
  /** Synthetic list rows mapped to a system branch (e.g. IC Company → Sundry Debtors). */
  focusBranchByGroupId?: Record<string, string>;
};

function groupBuildOrderKey<G extends MasterGroupListRow>(a: G, b: G) {
  return String(a.id || "").localeCompare(String(b.id || ""));
}

/** Default filter only — config order for system branch FLIP keys. */
export function masterGroupSystemBranchesLayoutKey(config: MasterGroupListConfig): string {
  return config.branches.map((b) => b.id).join("|");
}

export type MasterGroupListBranchSortRow = {
  branch: MasterGroupListBranchDef;
  balance: number;
  openingBalanceDate?: unknown;
};

/** System branch cards — same footer filter + sort as account rows (Default = amount high→low). */
export function sortMasterGroupListBranches(
  rows: MasterGroupListBranchSortRow[],
  _config: MasterGroupListConfig,
  quickFilter: EntityListQuickFilter,
  lastVoucherMsById?: Map<string, number> | null
): MasterGroupListBranchSortRow[] {
  type BranchSortEntry = MasterGroupListBranchSortRow & {
    id: string;
    name: string;
  };

  const entries: BranchSortEntry[] = rows.map((row) => ({
    ...row,
    id: row.branch.id,
    name: row.branch.name,
  }));

  const filtered = filterGroupListMembersByQuickFilter(entries, quickFilter);
  return sortGroupListMembers(filtered, quickFilter, (entry) => entry.branch.name, lastVoucherMsById);
}

export function masterGroupBranchListExpandKey(
  config: MasterGroupListConfig,
  branchId: string
): string {
  return `${config.sysExpandPrefix}${branchId}`;
}

export function masterGroupTreeExpandKey(
  config: MasterGroupListConfig,
  groupId: string
): string {
  return `${config.grpExpandPrefix}${groupId}`;
}

export function parseMasterGroupTreeExpandKey(
  config: MasterGroupListConfig,
  key: string | null
): string | null {
  if (!key?.startsWith(config.grpExpandPrefix)) return null;
  const id = key.slice(config.grpExpandPrefix.length);
  return id || null;
}

export function defaultMasterGroupListExpandedIds(config: MasterGroupListConfig): Set<string> {
  return new Set(config.branches.map((b) => masterGroupBranchListExpandKey(config, b.id)));
}

export function buildMasterGroupForest<G extends MasterGroupListRow>(
  groups: G[],
  config: MasterGroupListConfig
): MasterGroupTreeNode<G>[] {
  const virtualRoots = config.virtualRootIds ?? new Set<string>();
  const byId = new Map<string, G>();
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

  const buildNode = (group: G, depth: number): MasterGroupTreeNode<G> => {
    const childIds = childIdsByParent.get(group.id) ?? [];
    const children = childIds
      .map((id) => byId.get(id))
      .filter((g): g is G => Boolean(g))
      .sort(groupBuildOrderKey)
      .map((g) => buildNode(g, depth + 1));
    return { group, children, depth };
  };

  const roots = groups
    .filter((g) => {
      const pid = String(g.parentId || "").trim();
      return !pid || virtualRoots.has(pid) || !byId.has(pid);
    })
    .sort(groupBuildOrderKey);

  return roots.map((g) => buildNode(g, 0));
}

export function flattenMasterGroupForest<G extends MasterGroupListRow>(
  nodes: MasterGroupTreeNode<G>[]
): MasterGroupTreeNode<G>[] {
  const out: MasterGroupTreeNode<G>[] = [];
  const walk = (list: MasterGroupTreeNode<G>[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function collectMasterGroupDescendantIds<G extends MasterGroupListRow>(
  groupId: string,
  groups: G[]
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

export function collectMasterGroupAncestorIds<G extends MasterGroupListRow>(
  groupId: string,
  groups: G[],
  config: MasterGroupListConfig
): Set<string> {
  const virtualRoots = config.virtualRootIds ?? new Set<string>();
  const byId = new Map(groups.filter((g) => g?.id).map((g) => [g.id, g]));
  const out = new Set<string>();
  let pid = String(byId.get(groupId)?.parentId || "").trim();
  while (pid && !virtualRoots.has(pid)) {
    if (byId.has(pid)) out.add(pid);
    pid = String(byId.get(pid)?.parentId || "").trim();
  }
  return out;
}

export function isMasterGroupAncestorOf<G extends MasterGroupListRow>(
  ancestorId: string,
  descendantId: string,
  groups: G[],
  config: MasterGroupListConfig
): boolean {
  if (ancestorId === descendantId) return true;
  return collectMasterGroupAncestorIds(descendantId, groups, config).has(ancestorId);
}

/** Drag-hover expand — include system branch ids for nested user groups. */
export function collectMasterGroupMoveExpandAncestorIds<G extends MasterGroupListRow>(
  groupId: string,
  groups: G[],
  config: MasterGroupListConfig
): Set<string> {
  const ids = collectMasterGroupAncestorIds(groupId, groups, config);
  ids.add(groupId);
  const branchDef = config.branches.find((b) => b.id === groupId);
  if (branchDef) return ids;
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    ids.add(resolveMasterGroupBranchId(group.parentId, groups, config));
  }
  return ids;
}

function nodeMatchesQuickFilter(
  group: MasterGroupListRow,
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

type MasterGroupSearchMemberRow = { name?: string; accountName?: string };

function masterGroupMemberListMatchesSearch(
  members: MasterGroupSearchMemberRow[],
  searchTerm: string
): boolean {
  return members.some((m) =>
    masterEntityTextMatchesSearch(resolveGroupListMemberSearchText(m), searchTerm)
  );
}

function collectMasterGroupNodeDescendantMembers<G extends MasterGroupListRow>(
  node: MasterGroupTreeNode<G>,
  groupMembersByGroupId: Record<string, MasterGroupSearchMemberRow[]>
): MasterGroupSearchMemberRow[] {
  const out: MasterGroupSearchMemberRow[] = [...(groupMembersByGroupId[node.group.id] ?? [])];
  for (const child of node.children) {
    out.push(...collectMasterGroupNodeDescendantMembers(child, groupMembersByGroupId));
  }
  return out;
}

export function filterMasterGroupForest<G extends MasterGroupListRow>(
  nodes: MasterGroupTreeNode<G>[],
  searchTerm: string,
  quickFilter: string,
  groupMembersByGroupId: Record<string, MasterGroupSearchMemberRow[]>,
  hideSettled?: boolean
): MasterGroupTreeNode<G>[] {
  const q = searchTerm.trim().toLowerCase();

  const walk = (node: MasterGroupTreeNode<G>): MasterGroupTreeNode<G> | null => {
    const nameMatch = masterEntityTextMatchesSearch(node.group.name, searchTerm);
    const descendantMembers = collectMasterGroupNodeDescendantMembers(node, groupMembersByGroupId);
    const memberMatch = q.length > 0 && masterGroupMemberListMatchesSearch(descendantMembers, searchTerm);
    const selfMatch =
      (nameMatch || memberMatch) && nodeMatchesQuickFilter(node.group, quickFilter, hideSettled);

    const filteredChildren = node.children
      .map((c) => walk(c))
      .filter((c): c is MasterGroupTreeNode<G> => Boolean(c));

    if (selfMatch || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  };

  return nodes.map((n) => walk(n)).filter((n): n is MasterGroupTreeNode<G> => Boolean(n));
}

/** Group tab section count — group names + nested accounts (search mode). */
export function computeMasterGroupListSearchVisibleCount<G extends MasterGroupListRow>(args: {
  groups: G[];
  config: MasterGroupListConfig;
  searchTerm: string;
  quickFilter: EntityListQuickFilter;
  groupMembersByGroupId: Record<string, MasterGroupSearchMemberRow[]>;
  visibleGroupFilter: (group: G) => boolean;
}): number {
  const visibleGroups = (args.groups || []).filter(args.visibleGroupFilter);
  const q = args.searchTerm.trim();
  if (!q) return visibleGroups.length;

  const raw = buildMasterGroupListForest(visibleGroups, args.config);
  const filtered = filterMasterGroupForest(
    raw,
    args.searchTerm,
    args.quickFilter,
    args.groupMembersByGroupId
  );
  const nodeCount = flattenMasterGroupForest(filtered).length;
  if (nodeCount > 0) return nodeCount;

  const branchForests = splitMasterGroupForestByBranch(filtered, args.config, visibleGroups);
  return masterGroupSearchHasVisibleResults(
    args.config,
    branchForests,
    args.searchTerm,
    args.groupMembersByGroupId
  )
    ? 1
    : 0;
}

/** Search mode — koi branch / user group / direct member dikhe. */
export function masterGroupSearchHasVisibleResults(
  config: MasterGroupListConfig,
  branchForests: Record<string, MasterGroupTreeNode[]>,
  searchTerm: string,
  groupMembersByGroupId: Record<string, MasterGroupSearchMemberRow[]>
): boolean {
  const q = searchTerm.trim();
  if (!q) return true;

  for (const branch of config.branches) {
    if (masterEntityTextMatchesSearch(branch.name, searchTerm)) return true;
    const directMembers = groupMembersByGroupId[branch.id] ?? [];
    if (masterGroupMemberListMatchesSearch(directMembers, searchTerm)) {
      return true;
    }
    if ((branchForests[branch.id] ?? []).length > 0) return true;
  }
  return false;
}

export function sortMasterGroupTreeNodes<G extends MasterGroupListRow>(
  nodes: MasterGroupTreeNode<G>[],
  quickFilter: EntityListQuickFilter | string,
  lastVoucherMsById?: Map<string, number> | null
): MasterGroupTreeNode<G>[] {
  const filter = quickFilter as EntityListQuickFilter;
  const sorted = [...nodes].sort((a, b) =>
    compareGroupListMembers(a.group, b.group, filter, undefined, lastVoucherMsById)
  );
  return sorted.map((n) => ({
    ...n,
    children: sortMasterGroupTreeNodes(n.children, filter, lastVoucherMsById),
  }));
}

export function resolveMasterGroupBranchId<G extends MasterGroupListRow>(
  parentId: string | undefined,
  allGroups: G[],
  config: MasterGroupListConfig
): string {
  const pid = String(parentId || "").trim();
  // Chart root lives in `groups`; staff/tax/bank sub-trees reference it via parentId.
  if (pid === "liabilities") {
    const loanBranch = config.branches.find((b) => b.id === "loans_liabilities");
    if (loanBranch) return loanBranch.id;
  }
  if (pid === "assets") {
    const bankBranch = config.branches.find((b) => b.id === "bank_accounts_group");
    if (bankBranch) return bankBranch.id;
  }
  for (const branch of config.branches) {
    if (branch.rootParentIds.includes(pid)) return branch.id;
  }
  const byId = new Map(allGroups.map((g) => [g.id, g]));
  let walk = byId.get(pid);
  const seen = new Set<string>();
  while (walk && !seen.has(walk.id)) {
    seen.add(walk.id);
    const pp = String(walk.parentId || "").trim();
    for (const branch of config.branches) {
      if (branch.rootParentIds.includes(pp)) return branch.id;
    }
    const virtualRoots = config.virtualRootIds ?? new Set<string>();
    if (!pp || virtualRoots.has(pp)) break;
    walk = byId.get(pp);
  }
  return config.branches[config.branches.length - 1]?.id ?? "";
}

/** Walk from a user group up to Sundry Debtors / Creditors (or other branch roots). */
export function resolveMasterGroupBranchForGroup<G extends MasterGroupListRow>(
  group: G,
  allGroups: G[],
  config: MasterGroupListConfig
): string {
  const byId = new Map(allGroups.map((g) => [g.id, g]));
  for (const branch of config.branches) {
    if (!byId.has(branch.id)) {
      byId.set(branch.id, { id: branch.id, parentId: "", name: branch.name } as G);
    }
  }
  let walk: G | undefined = group;
  const seen = new Set<string>();
  while (walk && !seen.has(walk.id)) {
    seen.add(walk.id);
    const pid = String(walk.parentId || "").trim();
    for (const branch of config.branches) {
      if (branch.rootParentIds.includes(pid) || branch.id === pid) return branch.id;
    }
    if (!pid) break;
    walk = byId.get(pid);
  }
  return config.branches[config.branches.length - 1]?.id ?? "";
}

export function splitMasterGroupForestByBranch<G extends MasterGroupListRow>(
  forest: MasterGroupTreeNode<G>[],
  config: MasterGroupListConfig,
  allGroups?: G[]
): Record<string, MasterGroupTreeNode<G>[]> {
  const groupIndex =
    allGroups && allGroups.length > 0
      ? allGroups
      : flattenMasterGroupForest(forest).map((n) => n.group);
  const out: Record<string, MasterGroupTreeNode<G>[]> = {};
  for (const branch of config.branches) {
    out[branch.id] = [];
  }
  for (const node of forest) {
    const pid = String(node.group.parentId || "").trim();
    let branchId: string | null = null;
    for (const branch of config.branches) {
      if (branch.rootParentIds.includes(pid) || branch.id === pid) {
        branchId = branch.id;
        break;
      }
    }
    if (!branchId) {
      branchId = resolveMasterGroupBranchForGroup(node.group, groupIndex, config);
    }
    if (!out[branchId]) out[branchId] = [];
    out[branchId]!.push(node);
  }
  return out;
}

export function sumMasterGroupForestBalance<G extends MasterGroupListRow>(
  nodes: MasterGroupTreeNode<G>[]
): number {
  return nodes.reduce((sum, node) => sum + Number(node.group.balance || 0), 0);
}

export function sumMasterGroupForestPending(
  forest: MasterGroupTreeNode[],
  pendingApprovalByGroupId: Record<string, number>
): number {
  return flattenMasterGroupForest(forest).reduce(
    (sum, node) => sum + (pendingApprovalByGroupId[node.group.id] ?? 0),
    0
  );
}

export function buildMasterGroupSystemBranchGroup<G extends MasterGroupListRow>(
  branch: MasterGroupListBranchDef,
  branchForest: MasterGroupTreeNode<G>[],
  companyId: string
): G {
  return {
    id: branch.id,
    name: branch.name,
    companyId,
    parentId: "",
    balance: sumMasterGroupForestBalance(branchForest),
    debit: 0,
    credit: 0,
    isSystemReserved: true,
  } as G;
}

function branchContainsGroupId<G extends MasterGroupListRow>(
  nodes: MasterGroupTreeNode<G>[],
  groupId: string
): boolean {
  return flattenMasterGroupForest(nodes).some((n) => n.group.id === groupId);
}

export function masterGroupBranchForestContainsGroupId<G extends MasterGroupListRow>(
  forest: MasterGroupTreeNode<G>[],
  groupId: string
): boolean {
  return branchContainsGroupId(forest, groupId);
}

export function isMasterGroupBranchListExpanded<G extends MasterGroupListRow>(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  branchId: string,
  branchForest: MasterGroupTreeNode<G>[]
): boolean {
  const branchKey = masterGroupBranchListExpandKey(config, branchId);
  if (expandedIds.has(branchKey)) return true;
  for (const id of expandedIds) {
    if (!id.startsWith(config.grpExpandPrefix)) continue;
    const groupId = parseMasterGroupTreeExpandKey(config, id);
    if (groupId && branchContainsGroupId(branchForest, groupId)) return true;
  }
  return false;
}

export function isMasterGroupUserGroupExpanded(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  groupId: string
): boolean {
  return expandedIds.has(masterGroupTreeExpandKey(config, groupId));
}

export function toggleMasterGroupSystemBranchExpand(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  branchId: string
): Set<string> {
  const key = masterGroupBranchListExpandKey(config, branchId);
  const next = new Set(expandedIds);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function ensureMasterGroupUserGroupExpanded(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  groupId: string
): Set<string> {
  const key = masterGroupTreeExpandKey(config, groupId);
  if (expandedIds.has(key)) return expandedIds;
  const next = new Set(expandedIds);
  next.add(key);
  return next;
}

export function collapseMasterGroupUserGroupExpanded(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  groupId: string
): Set<string> {
  const key = masterGroupTreeExpandKey(config, groupId);
  if (!expandedIds.has(key)) return expandedIds;
  const next = new Set(expandedIds);
  next.delete(key);
  return next;
}

export function toggleMasterGroupUserGroupExpand<G extends MasterGroupListRow>(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  groupId: string,
  allGroups: G[]
): Set<string> {
  const expandKey = masterGroupTreeExpandKey(config, groupId);
  const next = new Set(expandedIds);

  const removeGroupAndDescendants = (id: string) => {
    next.delete(masterGroupTreeExpandKey(config, id));
    collectMasterGroupDescendantIds(id, allGroups).forEach((childId) => {
      next.delete(masterGroupTreeExpandKey(config, childId));
    });
  };

  if (next.has(expandKey)) {
    removeGroupAndDescendants(groupId);
    return next;
  }

  const subject = allGroups.find((g) => g.id === groupId);
  const parentId = String(subject?.parentId || "").trim();

  for (const g of allGroups) {
    if (!g?.id || g.id === groupId) continue;
    if (String(g.parentId || "").trim() !== parentId) continue;
    removeGroupAndDescendants(g.id);
  }

  next.add(expandKey);
  return next;
}

export function listMasterGroupParentGroupIds<G extends MasterGroupListRow>(
  branchForests: Record<string, MasterGroupTreeNode<G>[]>
): string[] {
  const ids: string[] = [];
  for (const forest of Object.values(branchForests)) {
    for (const node of forest) {
      ids.push(node.group.id);
    }
  }
  return ids;
}

export function resolveMasterGroupRootParentGroupId<G extends MasterGroupListRow>(
  groupId: string,
  allGroups: G[],
  config: MasterGroupListConfig,
  branchForests: Record<string, MasterGroupTreeNode<G>[]>
): string {
  const rootIds = new Set(listMasterGroupParentGroupIds(branchForests));
  if (rootIds.has(groupId)) return groupId;
  for (const ancestorId of collectMasterGroupAncestorIds(groupId, allGroups, config)) {
    if (rootIds.has(ancestorId)) return ancestorId;
  }
  return groupId;
}

export function collapseMasterGroupRootParentsExcept<G extends MasterGroupListRow>(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  keepRootId: string,
  allGroups: G[],
  branchForests: Record<string, MasterGroupTreeNode<G>[]>
): Set<string> {
  const next = new Set(expandedIds);
  const removeGroupAndDescendants = (id: string) => {
    next.delete(masterGroupTreeExpandKey(config, id));
    collectMasterGroupDescendantIds(id, allGroups).forEach((childId) => {
      next.delete(masterGroupTreeExpandKey(config, childId));
    });
  };
  for (const rootId of listMasterGroupParentGroupIds(branchForests)) {
    if (rootId !== keepRootId) removeGroupAndDescendants(rootId);
  }
  return next;
}

/** Collapse expanded sibling groups under the same parent (nested parent accordion). */
export function collapseMasterGroupDirectSiblingGroupsExcept<G extends MasterGroupListRow>(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  keepGroupId: string,
  allGroups: G[]
): Set<string> {
  const byId = new Map(allGroups.filter((g) => g?.id).map((g) => [g.id, g]));
  const keepGroup = byId.get(keepGroupId);
  if (!keepGroup) return expandedIds;

  const parentId = String(keepGroup.parentId || "").trim();
  const next = new Set(expandedIds);
  const removeGroupAndDescendants = (id: string) => {
    next.delete(masterGroupTreeExpandKey(config, id));
    collectMasterGroupDescendantIds(id, allGroups).forEach((childId) => {
      next.delete(masterGroupTreeExpandKey(config, childId));
    });
  };

  for (const g of allGroups) {
    if (!g?.id || g.id === keepGroupId) continue;
    if (String(g.parentId || "").trim() !== parentId) continue;
    removeGroupAndDescendants(g.id);
  }
  return next;
}

export function buildMasterGroupSearchExpandedIds<G extends MasterGroupListRow>(
  config: MasterGroupListConfig,
  branchForests: Record<string, MasterGroupTreeNode<G>[]>,
  allGroups: G[]
): Set<string> {
  const ids = defaultMasterGroupListExpandedIds(config);

  const walk = (node: MasterGroupTreeNode<G>) => {
    ids.add(masterGroupTreeExpandKey(config, node.group.id));
    collectMasterGroupAncestorIds(node.group.id, allGroups, config).forEach((ancestorId) => {
      ids.add(masterGroupTreeExpandKey(config, ancestorId));
    });
    node.children.forEach(walk);
  };

  for (const forest of Object.values(branchForests)) {
    for (const node of forest) walk(node);
  }
  return ids;
}

export function buildMasterGroupFocusBrightIds<G extends MasterGroupListRow>(
  focusGroupId: string | null,
  allGroups: G[],
  config: MasterGroupListConfig,
  branchForests: Record<string, MasterGroupTreeNode<G>[]>
): Set<string> | null {
  if (!focusGroupId) return null;

  const bright = new Set<string>();
  const branchDef = config.branches.find((b) => b.id === focusGroupId);

  if (branchDef) {
    bright.add(focusGroupId);
    const forest = branchForests[focusGroupId] ?? [];
    for (const node of flattenMasterGroupForest(forest)) {
      bright.add(node.group.id);
    }
    return bright;
  }

  if (config.focusBranchByGroupId?.[focusGroupId]) {
    bright.add(focusGroupId);
    return bright;
  }

  bright.add(focusGroupId);
  collectMasterGroupAncestorIds(focusGroupId, allGroups, config).forEach((id) => bright.add(id));
  collectMasterGroupDescendantIds(focusGroupId, allGroups).forEach((id) => bright.add(id));

  const focusGroup = allGroups.find((g) => g.id === focusGroupId);
  if (focusGroup) {
    bright.add(resolveMasterGroupBranchId(focusGroup.parentId, allGroups, config));
  }

  return bright;
}

export function resolveMasterGroupFocusBranchId<G extends MasterGroupListRow>(
  focusGroupId: string,
  allGroups: G[],
  config: MasterGroupListConfig
): string {
  if (config.branches.some((branch) => branch.id === focusGroupId)) return focusGroupId;
  const mappedBranch = config.focusBranchByGroupId?.[focusGroupId];
  if (mappedBranch) return mappedBranch;
  const group = allGroups.find((g) => g.id === focusGroupId);
  return resolveMasterGroupBranchId(group?.parentId, allGroups, config);
}

export function applyMasterGroupParentFocusCollapse<G extends MasterGroupListRow>(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  focusGroupId: string,
  allGroups: G[],
  branchForests: Record<string, MasterGroupTreeNode<G>[]>
): Set<string> {
  const keepRootId = resolveMasterGroupRootParentGroupId(
    focusGroupId,
    allGroups,
    config,
    branchForests
  );
  let next = collapseMasterGroupRootParentsExcept(
    expandedIds,
    config,
    keepRootId,
    allGroups,
    branchForests
  );
  if (!config.branches.some((branch) => branch.id === focusGroupId)) {
    const siblingCollapseTargets = [
      focusGroupId,
      ...collectMasterGroupAncestorIds(focusGroupId, allGroups, config),
    ];
    for (const id of siblingCollapseTargets) {
      next = collapseMasterGroupDirectSiblingGroupsExcept(next, config, id, allGroups);
    }
  }
  const activeBranchId = resolveMasterGroupFocusBranchId(focusGroupId, allGroups, config);
  for (const branch of config.branches) {
    const key = masterGroupBranchListExpandKey(config, branch.id);
    if (branch.id === activeBranchId) {
      next.add(key);
      continue;
    }
    next.delete(key);
    const forest = branchForests[branch.id] ?? [];
    for (const node of flattenMasterGroupForest(forest)) {
      next.delete(masterGroupTreeExpandKey(config, node.group.id));
    }
  }
  return next;
}

export function applyMasterGroupParentFocusExpand<G extends MasterGroupListRow>(
  expandedIds: Set<string>,
  config: MasterGroupListConfig,
  focusGroupId: string,
  allGroups: G[],
  branchForests: Record<string, MasterGroupTreeNode<G>[]>
): Set<string> {
  let next = applyMasterGroupParentFocusCollapse(
    expandedIds,
    config,
    focusGroupId,
    allGroups,
    branchForests
  );
  const keepRootId = resolveMasterGroupRootParentGroupId(
    focusGroupId,
    allGroups,
    config,
    branchForests
  );
  next = ensureMasterGroupUserGroupExpanded(next, config, keepRootId);
  if (keepRootId !== focusGroupId) {
    for (const ancestorId of collectMasterGroupAncestorIds(focusGroupId, allGroups, config)) {
      next = ensureMasterGroupUserGroupExpanded(next, config, ancestorId);
    }
    next = ensureMasterGroupUserGroupExpanded(next, config, focusGroupId);
  }
  return next;
}

/** Build forest from all groups, excluding system branch ids themselves from user tree. */
export function buildMasterGroupListForest<G extends MasterGroupListRow>(
  allGroups: G[],
  config: MasterGroupListConfig
): MasterGroupTreeNode<G>[] {
  const systemIds = new Set(config.branches.map((b) => b.id));
  const userGroups = allGroups.filter((g) => g?.id && !systemIds.has(g.id));
  return buildMasterGroupForest(userGroups, config);
}
