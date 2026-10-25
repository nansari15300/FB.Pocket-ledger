"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { MasterListChromeChevronToggle } from "@/components/layout/MasterListChromeChevronToggle";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import {
  GroupListExpandNameRow,
  GroupListMemberRow,
  renderGroupListRowShell,
} from "@/components/entity/GroupListMemberRow";
import { GroupListMemberMotionList } from "@/components/entity/GroupListMemberMotionList";
import { GroupListTreeNodeMotionList } from "@/components/entity/GroupListTreeNodeMotionList";
import { masterListOrderKey } from "@/hooks/useMasterListRowMotion";
import {
  GROUP_LIST_CHILD_INDENT_CLASS,
  groupListMembersForDisplay,
  type GroupListSelectOptions,
} from "@/lib/groupListExpand";
import { groupListMemberAvatarFromRow } from "@/components/entity/GroupListMemberAvatar";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import type { ExpenseAccount, ExpenseGroup } from "@/components/expenses/types";
import type { ExpenseGroupListBranch, ExpenseGroupTreeNode } from "@/lib/expenseGroupTree";
import {
  EXPENSE_GROUP_TOP_PARENT_OPTIONS,
  defaultExpenseGroupListExpandedIds,
  ensureExpenseGroupUserGroupExpanded,
  ensureExpenseGroupBranchListExpanded,
  collapseExpenseGroupUserGroupExpanded,
  expenseGroupBranchListExpandKey,
  isExpenseGroupBranchListExpanded,
  isExpenseGroupUserGroupExpanded,
  splitExpenseGroupForestByBranch,
  toggleExpenseGroupSystemBranchExpand,
  toggleExpenseGroupUserGroupExpand,
  buildExpenseGroupFocusBrightIds,
  applyExpenseGroupParentFocusCollapse,
  applyExpenseGroupParentFocusExpand,
  buildExpenseGroupSearchExpandedIds,
  buildExpenseGroupSystemBranchGroup,
  expenseGroupTreeExpandKey,
  collectExpenseGroupDescendantIds,
  collectExpenseGroupAncestorIds,
  isExpenseGroupAncestorOf,
  sortExpenseGroupTreeNodes,
  sortExpenseGroupListBranches,
  expenseGroupBranchDirectMembersFromMap,
  expenseGroupBranchForestContainsGroupId,
  sumExpenseGroupBranchDirectMemberBalance,
} from "@/lib/expenseGroupTree";
import { formatGroupListCardCountSubtitle } from "@/lib/groupListCardCounts";
import { groupListAmountCn, GROUP_LIST_FOCUS_DIM_CLASS } from "@/lib/groupListUi";
import { useGroupListAccountMove } from "@/hooks/useGroupListAccountMove";
import { canMoveExpenseAccountInGroupList } from "@/lib/expenseGroupAccountMove";
import { GroupListAccountMoveOverlay } from "@/components/entity/GroupListAccountMoveOverlay";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { stampLastVoucherMsOnGroupForest } from "@/lib/masterListLastVoucherMs";

type ExpenseGroupNestedListBodyProps = {
  forest: ExpenseGroupTreeNode[];
  allGroups: ExpenseGroup[];
  displayOrderKey: string;
  searchTerm?: string;
  selectedGroup: ExpenseGroup | null;
  selectedGroupMemberFilterId: string | null;
  groupMembersByGroupId: Record<string, ExpenseAccount[]>;
  onSelectGroup: (group: ExpenseGroup, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  pendingApprovalByMemberId?: Record<string, number>;
  getItemHref?: (group: ExpenseGroup) => string | undefined;
  quickFilter: EntityListQuickFilter;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  rowMotionProps: Record<string, unknown>;
  isRowAnimationEnabled: boolean;
  layoutHoldMs: number;
  formatCurrency: (amount: number, options?: { showDrCr?: boolean }) => React.ReactNode;
  renderGroupLeading?: (group: ExpenseGroup) => React.ReactNode;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (account: ExpenseAccount, targetGroupId: string) => void | Promise<void>;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: ExpenseGroup) => boolean;
};

function sumForestBalance(nodes: ExpenseGroupTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + Number(node.group.balance || 0), 0);
}

function sumForestPending(
  nodes: ExpenseGroupTreeNode[],
  pendingApprovalByGroupId: Record<string, number>
): number {
  const walk = (n: ExpenseGroupTreeNode): number => {
    let total = pendingApprovalByGroupId[n.group.id] ?? 0;
    for (const c of n.children) total += walk(c);
    return total;
  };
  return nodes.reduce((sum, node) => sum + walk(node), 0);
}

type ExpenseGroupMoveContext = {
  getMemberRowProps: (account: ExpenseAccount) => import("@/hooks/useGroupListAccountMove").GroupListMemberMoveProps;
  getGroupRowMoveProps: (group: ExpenseGroup) => import("@/hooks/useGroupListAccountMove").GroupListMemberMoveProps;
  getGroupRowDataAttrs: (
    groupId: string,
    hasChildGroups: boolean,
    dropAllowed: boolean
  ) => Record<string, string>;
  isMoveMode: boolean;
};

type ExpenseGroupFocusContext = {
  isBright: (id: string) => boolean;
  dimClassName: string;
};

function ExpenseGroupTreeNodeRow({
  node,
  displayOrderKey,
  selectedGroup,
  selectedGroupMemberFilterId,
  groupMembersByGroupId,
  onSelectGroup,
  pendingApprovalByGroupId,
  pendingApprovalByMemberId,
  getItemHref,
  quickFilter,
  animatePresenceMode,
  rowMotionProps,
  isRowAnimationEnabled,
  layoutHoldMs,
  formatCurrency,
  renderGroupLeading,
  expandedIds,
  onExpandedChange,
  depth,
  searchTerm = "",
  allGroups,
  moveContext,
  focusContext,
  onUserGroupExpandToggle,
  onUserGroupFocus,
  siblingOrderKey,
  disableOuterMotion = false,
}: Omit<ExpenseGroupNestedListBodyProps, "forest" | "moveAccountsEnabled" | "onMoveAccountToGroup"> & {
  node: ExpenseGroupTreeNode;
  expandedIds: Set<string>;
  onExpandedChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  depth: number;
  moveContext: ExpenseGroupMoveContext;
  focusContext: ExpenseGroupFocusContext;
  onUserGroupExpandToggle: (groupId: string) => void;
  onUserGroupFocus: (groupId: string) => void;
  siblingOrderKey?: string;
  disableOuterMotion?: boolean;
}) {
  const group = node.group;
  const rowLayoutKey = siblingOrderKey ?? displayOrderKey;
  const rowShellClassName = cn(
    depth > 0 ? GROUP_LIST_CHILD_INDENT_CLASS : undefined,
    focusContext.isBright(group.id) ? undefined : focusContext.dimClassName
  );
  const wrapRowShell = (body: React.ReactNode) =>
    disableOuterMotion ? (
      <div className={rowShellClassName}>{body}</div>
    ) : (
      <motion.li
        key={group.id || `exp-grp-node-${depth}-${group.name}`}
        layoutDependency={rowLayoutKey}
        {...rowMotionProps}
        className={rowShellClassName}
      >
        {body}
      </motion.li>
    );
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const members = groupMembersByGroupId[group.id] ?? [];
  const highlightQuery = searchTerm.trim();
  const displayMembers = groupListMembersForDisplay(
    members,
    quickFilter,
    searchTerm,
    undefined,
    lastVoucherMsById,
    hideSettled
  );
  const sortedChildNodes = useMemo(() => {
    const stamped = stampLastVoucherMsOnGroupForest(
      node.children,
      lastVoucherMsById,
      groupMembersByGroupId
    );
    return sortExpenseGroupTreeNodes(node.children, quickFilter, stamped);
  }, [node.children, quickFilter, lastVoucherMsById, groupMembersByGroupId]);
  const childGroupsListKey = useMemo(
    () => `${quickFilter}|${masterListOrderKey(sortedChildNodes.map((n) => n.group.id))}`,
    [quickFilter, sortedChildNodes]
  );
  const renderChildTreeNode = (child: ExpenseGroupTreeNode) => (
    <ExpenseGroupTreeNodeRow
      disableOuterMotion
      node={child}
      displayOrderKey={displayOrderKey}
      siblingOrderKey={childGroupsListKey}
      selectedGroup={selectedGroup}
      selectedGroupMemberFilterId={selectedGroupMemberFilterId}
      groupMembersByGroupId={groupMembersByGroupId}
      onSelectGroup={onSelectGroup}
      pendingApprovalByGroupId={pendingApprovalByGroupId}
      pendingApprovalByMemberId={pendingApprovalByMemberId}
      getItemHref={getItemHref}
      quickFilter={quickFilter}
      animatePresenceMode={animatePresenceMode}
      rowMotionProps={rowMotionProps}
      isRowAnimationEnabled={isRowAnimationEnabled}
      layoutHoldMs={layoutHoldMs}
      formatCurrency={formatCurrency}
      renderGroupLeading={renderGroupLeading}
      expandedIds={expandedIds}
      onExpandedChange={onExpandedChange}
      depth={depth + 1}
      searchTerm={searchTerm}
      allGroups={allGroups}
      moveContext={moveContext}
      focusContext={focusContext}
      onUserGroupExpandToggle={onUserGroupExpandToggle}
      onUserGroupFocus={onUserGroupFocus}
    />
  );
  const hasChildGroups = node.children.length > 0;
  const isLeaf = !hasChildGroups;
  const isExpanded = isExpenseGroupUserGroupExpanded(expandedIds, group.id);
  const canExpand = hasChildGroups || displayMembers.length > 0 || isLeaf;

  const isGroupSelectedOnly =
    selectedGroup?.id === group.id && !selectedGroupMemberFilterId;
  const groupPending = pendingApprovalByGroupId[group.id] ?? 0;
  const groupBalance = Number(group.balance || 0);
  const groupLeading =
    renderGroupLeading?.(group) ?? (
      <MasterListGroupIcon>
        <Users className="h-5 w-5" />
      </MasterListGroupIcon>
    );
  const groupMoveAttrs = moveContext.getGroupRowDataAttrs(group.id, hasChildGroups, true);
  const groupMoveProps = moveContext.getGroupRowMoveProps(group);
  const groupCountSubtitle = formatGroupListCardCountSubtitle(
    node.children.length,
    members.length
  );

  const renderMemberRow = (member: ExpenseAccount) => {
    const moveProps = moveContext.getMemberRowProps(member);
    const isMemberSelected = selectedGroupMemberFilterId === member.id;
    return (
      <GroupListMemberRow
        name={member.name}
        balance={member.balance}
        isSelected={selectedGroup?.id === group.id && isMemberSelected}
        onClick={() => {
          if (moveContext.isMoveMode) return;
          onSelectGroup(group, { memberId: member.id });
        }}
        pendingCount={pendingApprovalByMemberId[member.id] ?? 0}
        leading={groupListMemberAvatarFromRow(member)}
        highlightQuery={highlightQuery || undefined}
        isAccountFrozen={Boolean(member.isFrozen)}
        {...moveProps}
      />
    );
  };

  const expandControl = canExpand ? (
    <MasterListChromeChevronToggle
      variant="row"
      expanded={isExpanded}
      ariaLabelWhenExpanded="Collapse group"
      ariaLabelWhenCollapsed="Expand group"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onUserGroupExpandToggle(group.id);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  ) : null;

  const renderGroupCard = () => (
    <div className="pl-master-list-row">
      <div className="pl-master-list-row-leading">
        <div className="relative flex-shrink-0">
          {groupLeading}
          {groupPending > 0 && (
            <span
              className="absolute top-0 right-0 flex h-4 w-4 origin-center items-center justify-center bg-pink-500 text-[10px] font-bold text-white"
              style={{ transform: "rotate(45deg) translate(25%, -25%)" }}
              aria-label={`${groupPending} pending approval`}
            >
              <span style={{ transform: "rotate(-45deg)" }}>{groupPending}</span>
            </span>
          )}
        </div>
        <GroupListExpandNameRow
          name={group.name}
          expandControl={expandControl}
          pendingCount={groupPending}
          highlightQuery={highlightQuery || undefined}
          secondaryLabel={groupCountSubtitle}
        />
      </div>
      <p className={groupListAmountCn(groupBalance, isExpanded)}>
        {formatCurrency(groupBalance, { showDrCr: true })}
      </p>
    </div>
  );

  if (hasChildGroups) {
    const selectGroupRow = () => {
      if (moveContext.isMoveMode) return;
      onUserGroupFocus(group.id);
      onSelectGroup(group, { memberId: null });
    };

    const groupRow = renderGroupListRowShell(
      isGroupSelectedOnly,
      selectGroupRow,
      renderGroupCard(),
      getItemHref?.(group),
      groupMoveAttrs,
      groupMoveProps
    );

    const memberRows =
      displayMembers.length > 0 ? (
        <div className={cn("flex flex-col gap-1 pt-1", GROUP_LIST_CHILD_INDENT_CLASS)}>
          <GroupListMemberMotionList
            members={displayMembers}
            animatePresenceMode={animatePresenceMode}
            rowMotionProps={rowMotionProps}
            isRowAnimationEnabled={isRowAnimationEnabled}
            layoutHoldMs={layoutHoldMs}
            getMemberKey={(member) => member.id || `${group.id}-member-${member.name}`}
            renderMember={(member) => renderMemberRow(member)}
          />
        </div>
      ) : null;

    return wrapRowShell(
      isExpanded ? (
        <div data-pl-group-expand-group="">
          {groupRow}
          {memberRows}
          <ul className="flex flex-col gap-1 pt-1">
            <GroupListTreeNodeMotionList
              items={sortedChildNodes}
              quickFilter={quickFilter}
              animatePresenceMode={animatePresenceMode}
              rowMotionProps={rowMotionProps}
              isRowAnimationEnabled={isRowAnimationEnabled}
              layoutHoldMs={layoutHoldMs}
              getItemKey={(child) =>
                child.group.id || `exp-grp-child-${depth}-${child.group.name}`
              }
              getItemId={(child) => child.group.id}
              getItemClassName={() => GROUP_LIST_CHILD_INDENT_CLASS}
              renderItem={(child) => renderChildTreeNode(child)}
            />
          </ul>
        </div>
      ) : (
        groupRow
      )
    );
  }

  const selectLeafGroupRow = () => {
    if (moveContext.isMoveMode) return;
    onUserGroupFocus(group.id);
    onSelectGroup(group, { memberId: null });
  };

  const leafGroupRow = renderGroupListRowShell(
    isGroupSelectedOnly,
    selectLeafGroupRow,
    renderGroupCard(),
    getItemHref?.(group),
    groupMoveAttrs,
    groupMoveProps
  );

  return wrapRowShell(
    isExpanded ? (
      <div data-pl-group-expand-group="">
        {leafGroupRow}
        {displayMembers.length > 0 ? (
          <div className={cn("flex flex-col gap-1 pt-1", GROUP_LIST_CHILD_INDENT_CLASS)}>
            <GroupListMemberMotionList
              members={displayMembers}
              animatePresenceMode={animatePresenceMode}
              rowMotionProps={rowMotionProps}
              isRowAnimationEnabled={isRowAnimationEnabled}
              layoutHoldMs={layoutHoldMs}
              getMemberKey={(member) => member.id || `${group.id}-member-${member.name}`}
              renderMember={(member) => renderMemberRow(member)}
            />
          </div>
        ) : !highlightQuery && members.length === 0 ? (
          <div className={cn("flex flex-col gap-1 pt-1", GROUP_LIST_CHILD_INDENT_CLASS)}>
            <div className="rounded-lg border border-dashed border-muted-foreground/35 bg-background/80 px-3 py-2.5 text-xs text-muted-foreground">
              No accounts in this group.
            </div>
          </div>
        ) : null}
      </div>
    ) : (
      leafGroupRow
    )
  );
}

function ExpenseGroupSystemBranchRow({
  branch,
  branchForest,
  displayOrderKey,
  expandedIds,
  onExpandedChange,
  pendingApprovalByGroupId,
  rowMotionProps,
  formatCurrency,
  moveContext,
  focusContext,
  onUserGroupExpandToggle,
  onUserGroupFocus,
  onBranchExpandToggle,
  onBranchFocus,
  quickFilter,
  siblingOrderKey,
  disableOuterMotion = false,
  focusGroupId = null,
  ...rest
}: Omit<ExpenseGroupNestedListBodyProps, "forest" | "moveAccountsEnabled" | "onMoveAccountToGroup"> & {
  branch: ExpenseGroupListBranch;
  branchForest: ExpenseGroupTreeNode[];
  expandedIds: Set<string>;
  onExpandedChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  moveContext: ExpenseGroupMoveContext;
  focusContext: ExpenseGroupFocusContext;
  onUserGroupExpandToggle: (groupId: string) => void;
  onUserGroupFocus: (groupId: string) => void;
  onBranchExpandToggle: (branch: ExpenseGroupListBranch) => void;
  onBranchFocus: (branch: ExpenseGroupListBranch) => void;
  siblingOrderKey?: string;
  disableOuterMotion?: boolean;
  focusGroupId?: string | null;
}) {
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const branchLabel =
    EXPENSE_GROUP_TOP_PARENT_OPTIONS.find((o) => o.id === branch)?.name ?? branch;
  const branchLayoutKey = expenseGroupBranchListExpandKey(branch);
  const branchRowLayoutKey = siblingOrderKey ?? branchLayoutKey;
  const sortedBranchForest = useMemo(() => {
    const stamped = stampLastVoucherMsOnGroupForest(
      branchForest,
      lastVoucherMsById,
      rest.groupMembersByGroupId
    );
    return sortExpenseGroupTreeNodes(branchForest, quickFilter, stamped);
  }, [branchForest, quickFilter, lastVoucherMsById, rest.groupMembersByGroupId]);
  const branchGroupsListKey = useMemo(
    () =>
      `${quickFilter}|${masterListOrderKey(sortedBranchForest.map((n) => n.group.id))}`,
    [quickFilter, sortedBranchForest]
  );
  const highlightQuery = (rest.searchTerm || "").trim();
  const branchDirectMembers = useMemo(
    () => expenseGroupBranchDirectMembersFromMap(branch, rest.groupMembersByGroupId),
    [branch, rest.groupMembersByGroupId]
  );
  const displayBranchDirectMembers = groupListMembersForDisplay(
    branchDirectMembers,
    quickFilter,
    rest.searchTerm || "",
    undefined,
    lastVoucherMsById,
    hideSettled
  );
  const branchExpanded = isExpenseGroupBranchListExpanded(expandedIds, branch, branchForest);
  const directBalance = displayBranchDirectMembers.reduce(
    (sum, member) => sum + Number(member.balance || 0),
    0
  );
  const directPending = displayBranchDirectMembers.reduce(
    (sum, member) => sum + (rest.pendingApprovalByMemberId?.[member.id] ?? 0),
    0
  );
  const branchBalance = sumForestBalance(branchForest) + directBalance;
  const branchPending = sumForestPending(branchForest, pendingApprovalByGroupId) + directPending;
  const branchHeaderDimClass = focusContext.isBright(branch) ? undefined : focusContext.dimClassName;
  const directMemberDimClass = branchHeaderDimClass;
  const searchQuery = highlightQuery.toLowerCase();
  const hideBranchDirectMembers =
    !searchQuery &&
    Boolean(focusGroupId) &&
    focusGroupId !== branch &&
    expenseGroupBranchForestContainsGroupId(branchForest, focusGroupId);
  const visibleBranchDirectMembers = hideBranchDirectMembers ? [] : displayBranchDirectMembers;
  const branchCountSubtitle = formatGroupListCardCountSubtitle(
    branchForest.length,
    branchDirectMembers.length
  );
  const isBranchSelected =
    rest.selectedGroup?.id === branch && !rest.selectedGroupMemberFilterId;
  const companyId = rest.allGroups[0]?.companyId ?? "";
  const branchSelectionGroup = {
    ...buildExpenseGroupSystemBranchGroup(branch, branchForest, companyId),
    balance: branchBalance,
  };

  const selectBranchRow = () => {
    if (moveContext.isMoveMode) return;
    onBranchFocus(branch);
    rest.onSelectGroup(branchSelectionGroup, { memberId: null });
  };

  const expandControl = (
    <MasterListChromeChevronToggle
      variant="row"
      expanded={branchExpanded}
      ariaLabelWhenExpanded={`Collapse ${branchLabel}`}
      ariaLabelWhenCollapsed={`Expand ${branchLabel}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onBranchExpandToggle(branch);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );

  const branchCard = (
    <div className="pl-master-list-row">
      <div className="pl-master-list-row-leading">
        <div className="relative flex-shrink-0">
          <MasterListGroupIcon>
            <Users className="h-5 w-5" />
          </MasterListGroupIcon>
          {branchPending > 0 && (
            <span
              className="absolute top-0 right-0 flex h-4 w-4 origin-center items-center justify-center bg-pink-500 text-[10px] font-bold text-white"
              style={{ transform: "rotate(45deg) translate(25%, -25%)" }}
              aria-label={`${branchPending} pending approval`}
            >
              <span style={{ transform: "rotate(-45deg)" }}>{branchPending}</span>
            </span>
          )}
        </div>
        <GroupListExpandNameRow
          name={branchLabel}
          expandControl={expandControl}
          pendingCount={branchPending}
          highlightQuery={highlightQuery || undefined}
          secondaryLabel={branchCountSubtitle}
        />
      </div>
      <p className={groupListAmountCn(branchBalance, branchExpanded)}>
        {formatCurrency(branchBalance, { showDrCr: true })}
      </p>
    </div>
  );

  const branchRow = renderGroupListRowShell(
    isBranchSelected,
    selectBranchRow,
    branchCard,
    rest.getItemHref?.(branchSelectionGroup),
    moveContext.getGroupRowDataAttrs(branch, branchForest.length > 0, true)
  );

  const renderBranchUserGroup = (node: ExpenseGroupTreeNode) => (
    <ExpenseGroupTreeNodeRow
      disableOuterMotion
      node={node}
      displayOrderKey={displayOrderKey}
      siblingOrderKey={branchGroupsListKey}
      quickFilter={quickFilter}
      expandedIds={expandedIds}
      onExpandedChange={onExpandedChange}
      pendingApprovalByGroupId={pendingApprovalByGroupId}
      depth={0}
      rowMotionProps={rowMotionProps}
      formatCurrency={formatCurrency}
      moveContext={moveContext}
      focusContext={focusContext}
      onUserGroupExpandToggle={onUserGroupExpandToggle}
      onUserGroupFocus={onUserGroupFocus}
      selectedGroup={rest.selectedGroup}
      selectedGroupMemberFilterId={rest.selectedGroupMemberFilterId}
      groupMembersByGroupId={rest.groupMembersByGroupId}
      onSelectGroup={rest.onSelectGroup}
      pendingApprovalByMemberId={rest.pendingApprovalByMemberId}
      getItemHref={rest.getItemHref}
      searchTerm={rest.searchTerm}
      allGroups={rest.allGroups}
      animatePresenceMode={rest.animatePresenceMode}
      isRowAnimationEnabled={rest.isRowAnimationEnabled}
      layoutHoldMs={rest.layoutHoldMs}
      renderGroupLeading={rest.renderGroupLeading}
    />
  );

  const branchBody = branchExpanded ? (
    <div data-pl-group-expand-group="">
      <div className={branchHeaderDimClass}>{branchRow}</div>
      <ul className={cn("flex flex-col gap-1 pt-1", GROUP_LIST_CHILD_INDENT_CLASS)}>
        {visibleBranchDirectMembers.length > 0 ? (
          <div className={cn("flex flex-col gap-1", GROUP_LIST_CHILD_INDENT_CLASS)}>
            <GroupListMemberMotionList
              members={visibleBranchDirectMembers}
              animatePresenceMode={rest.animatePresenceMode}
              rowMotionProps={rowMotionProps}
              isRowAnimationEnabled={rest.isRowAnimationEnabled}
              layoutHoldMs={rest.layoutHoldMs}
              getMemberKey={(member) => member.id || `${branch}-member-${member.name}`}
              renderMember={(member) => {
                const moveProps = moveContext.getMemberRowProps(member);
                const isMemberSelected =
                  rest.selectedGroup?.id === branch &&
                  rest.selectedGroupMemberFilterId === member.id;
                return (
                  <GroupListMemberRow
                    name={member.name}
                    balance={member.balance}
                    isSelected={isMemberSelected}
                    onClick={() => {
                      if (moveContext.isMoveMode) return;
                      onBranchFocus(branch);
                      rest.onSelectGroup(branchSelectionGroup, { memberId: member.id });
                    }}
                    pendingCount={rest.pendingApprovalByMemberId?.[member.id] ?? 0}
                    leading={groupListMemberAvatarFromRow(member)}
                    highlightQuery={highlightQuery || undefined}
                    isAccountFrozen={Boolean(member.isFrozen)}
                    rowDimClass={directMemberDimClass}
                    {...moveProps}
                  />
                );
              }}
            />
          </div>
        ) : null}
        {sortedBranchForest.length === 0 && visibleBranchDirectMembers.length === 0 ? (
          <li className="px-2 py-2 text-xs text-muted-foreground">No groups in {branchLabel}.</li>
        ) : sortedBranchForest.length > 0 ? (
          <GroupListTreeNodeMotionList
            items={sortedBranchForest}
            quickFilter={quickFilter}
            animatePresenceMode={rest.animatePresenceMode}
            rowMotionProps={rowMotionProps}
            isRowAnimationEnabled={rest.isRowAnimationEnabled}
            layoutHoldMs={rest.layoutHoldMs}
            getItemKey={(node) => node.group.id}
            getItemId={(node) => node.group.id}
            renderItem={(node) => renderBranchUserGroup(node)}
          />
        ) : null}
      </ul>
    </div>
  ) : (
    <div className={branchHeaderDimClass}>{branchRow}</div>
  );

  if (disableOuterMotion) return <>{branchBody}</>;

  return (
    <motion.li
      key={branchLayoutKey}
      layoutDependency={branchRowLayoutKey}
      {...rowMotionProps}
    >
      {branchBody}
    </motion.li>
  );
}

export function ExpenseGroupNestedListBody({
  forest,
  displayOrderKey,
  pendingApprovalByGroupId = {},
  moveAccountsEnabled = false,
  onMoveAccountToGroup,
  onMoveGroupToGroup,
  canMoveGroup,
  ...rest
}: ExpenseGroupNestedListBodyProps) {
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const [expandedIds, setExpandedIds] = useState(defaultExpenseGroupListExpandedIds);
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const branchForests = useMemo(() => {
    const split = splitExpenseGroupForestByBranch(forest);
    const incomeStamped = stampLastVoucherMsOnGroupForest(
      split.income,
      lastVoucherMsById,
      rest.groupMembersByGroupId
    );
    const expensesStamped = stampLastVoucherMsOnGroupForest(
      split.expenses,
      lastVoucherMsById,
      rest.groupMembersByGroupId
    );
    return {
      income: sortExpenseGroupTreeNodes(split.income, rest.quickFilter, incomeStamped),
      expenses: sortExpenseGroupTreeNodes(split.expenses, rest.quickFilter, expensesStamped),
    };
  }, [forest, rest.quickFilter, lastVoucherMsById, rest.groupMembersByGroupId]);
  const income = branchForests.income;
  const expenses = branchForests.expenses;
  const searchActive = Boolean((rest.searchTerm || "").trim());

  useEffect(() => {
    if (!searchActive) return;
    setFocusGroupId(null);
    setExpandedIds(buildExpenseGroupSearchExpandedIds(income, expenses, rest.allGroups));
  }, [searchActive, rest.searchTerm, income, expenses, rest.allGroups]);

  const focusContext = useMemo(() => {
    if (searchActive) {
      return {
        isBright: () => true,
        dimClassName: GROUP_LIST_FOCUS_DIM_CLASS,
      };
    }
    const brightIds = buildExpenseGroupFocusBrightIds(
      focusGroupId,
      rest.allGroups,
      income,
      expenses
    );
    return {
      isBright: (id: string) => !brightIds || brightIds.has(id),
      dimClassName: GROUP_LIST_FOCUS_DIM_CLASS,
    };
  }, [searchActive, focusGroupId, rest.allGroups, income, expenses]);

  const handleUserGroupFocus = useCallback(
    (groupId: string) => {
      if (searchActive) return;
      setFocusGroupId(groupId);
      setExpandedIds((prev) =>
        applyExpenseGroupParentFocusCollapse(prev, groupId, rest.allGroups, income, expenses)
      );
    },
    [searchActive, rest.allGroups, income, expenses]
  );

  const handleUserGroupExpandToggle = useCallback(
    (groupId: string) => {
      if (searchActive) {
        setExpandedIds((prev) => {
          const key = expenseGroupTreeExpandKey(groupId);
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
            collectExpenseGroupDescendantIds(groupId, rest.allGroups).forEach((childId) => {
              next.delete(expenseGroupTreeExpandKey(childId));
            });
          } else {
            next.add(key);
          }
          return next;
        });
        return;
      }
      setExpandedIds((prev) => {
        const wasExpanded = isExpenseGroupUserGroupExpanded(prev, groupId);
        let next = toggleExpenseGroupUserGroupExpand(prev, groupId, rest.allGroups);
        const nowExpanded = isExpenseGroupUserGroupExpanded(next, groupId);
        if (nowExpanded && !wasExpanded) {
          next = applyExpenseGroupParentFocusExpand(
            next,
            groupId,
            rest.allGroups,
            income,
            expenses
          );
          setFocusGroupId(groupId);
        } else if (!nowExpanded && wasExpanded) {
          setFocusGroupId((current) => (current === groupId ? null : current));
        }
        return next;
      });
    },
    [searchActive, rest.allGroups, income, expenses]
  );

  const handleBranchFocus = useCallback(
    (branch: ExpenseGroupListBranch) => {
      if (searchActive) return;
      setFocusGroupId(branch);
    },
    [searchActive]
  );

  const handleBranchExpandToggle = useCallback((branch: ExpenseGroupListBranch) => {
    setExpandedIds((prev) => {
      const key = expenseGroupBranchListExpandKey(branch);
      const wasExpanded = prev.has(key);
      const next = toggleExpenseGroupSystemBranchExpand(prev, branch);
      const nowExpanded = next.has(key);
      if (nowExpanded && !wasExpanded) {
        setFocusGroupId(branch);
      } else if (!nowExpanded && wasExpanded) {
        setFocusGroupId((current) => (current === branch ? null : current));
      }
      return next;
    });
  }, []);

  const {
    moveHint,
    cursor,
    getMemberRowProps,
    getGroupRowMoveProps,
    getGroupRowDataAttrs,
    isMoveMode,
  } = useGroupListAccountMove<ExpenseAccount>({
    disabled: !moveAccountsEnabled || (!onMoveAccountToGroup && !onMoveGroupToGroup),
    collectMoveExpandIds: (groupId) => collectExpenseGroupAncestorIds(groupId, rest.allGroups),
    isMoveTreeAncestorOf: (ancestorId, descendantId) =>
      isExpenseGroupAncestorOf(ancestorId, descendantId, rest.allGroups),
    isInvalidGroupDropTarget: onMoveGroupToGroup
      ? (sourceGroupId, targetGroupId) =>
          isExpenseGroupAncestorOf(sourceGroupId, targetGroupId, rest.allGroups) ||
          sourceGroupId === targetGroupId
      : undefined,
    canMoveAccount: canMoveExpenseAccountInGroupList,
    canMoveGroup: canMoveGroup
      ? (groupId) => {
          const group = rest.allGroups.find((g) => g.id === groupId);
          return group ? canMoveGroup(group) : false;
        }
      : undefined,
    onMoveAccount: onMoveAccountToGroup ?? (async () => {}),
    onMoveGroup: onMoveGroupToGroup,
    onAutoExpandGroup: (groupId) => {
      if (groupId === "income" || groupId === "expenses") {
        setExpandedIds((prev) =>
          ensureExpenseGroupBranchListExpanded(prev, groupId as ExpenseGroupListBranch)
        );
        return;
      }
      setExpandedIds((prev) => ensureExpenseGroupUserGroupExpanded(prev, groupId));
    },
    onAutoCollapseGroup: (groupId) => {
      if (groupId === "income" || groupId === "expenses") return;
      setExpandedIds((prev) => collapseExpenseGroupUserGroupExpanded(prev, groupId));
    },
  });

  const moveContext = useMemo(
    () => ({
      getMemberRowProps,
      getGroupRowMoveProps: (group: ExpenseGroup) => getGroupRowMoveProps(group.id),
      getGroupRowDataAttrs,
      isMoveMode,
    }),
    [getMemberRowProps, getGroupRowMoveProps, getGroupRowDataAttrs, isMoveMode]
  );

  const displayBranches = useMemo(() => {
    const rows = [
      {
        branch: "income" as const,
        balance:
          sumForestBalance(income) +
          sumExpenseGroupBranchDirectMemberBalance("income", rest.groupMembersByGroupId),
      },
      {
        branch: "expenses" as const,
        balance:
          sumForestBalance(expenses) +
          sumExpenseGroupBranchDirectMemberBalance("expenses", rest.groupMembersByGroupId),
      },
    ];
    return sortExpenseGroupListBranches(rows, rest.quickFilter, lastVoucherMsById);
  }, [income, expenses, rest.quickFilter, rest.groupMembersByGroupId, lastVoucherMsById]);

  const systemBranchesListKey = useMemo(
    () =>
      `${rest.quickFilter}|${masterListOrderKey(displayBranches.map((row) => row.branch))}`,
    [displayBranches, rest.quickFilter]
  );

  return (
    <>
      <GroupListTreeNodeMotionList
        items={displayBranches}
        quickFilter={rest.quickFilter}
        animatePresenceMode={rest.animatePresenceMode}
        rowMotionProps={rest.rowMotionProps}
        isRowAnimationEnabled={rest.isRowAnimationEnabled}
        layoutHoldMs={rest.layoutHoldMs}
        getItemKey={(row) => expenseGroupBranchListExpandKey(row.branch)}
        getItemId={(row) => row.branch}
        renderItem={(row) => (
          <ExpenseGroupSystemBranchRow
            disableOuterMotion
            siblingOrderKey={systemBranchesListKey}
            branch={row.branch}
            branchForest={branchForests[row.branch]}
            displayOrderKey={displayOrderKey}
            expandedIds={expandedIds}
            onExpandedChange={setExpandedIds}
            pendingApprovalByGroupId={pendingApprovalByGroupId}
            moveContext={moveContext}
            focusContext={focusContext}
            onUserGroupExpandToggle={handleUserGroupExpandToggle}
            onUserGroupFocus={handleUserGroupFocus}
            onBranchExpandToggle={handleBranchExpandToggle}
            onBranchFocus={handleBranchFocus}
            focusGroupId={focusGroupId}
            quickFilter={rest.quickFilter}
            {...rest}
          />
        )}
      />
      <GroupListAccountMoveOverlay visible={isMoveMode} hint={moveHint} cursor={cursor} />
    </>
  );
}
