"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
import { MasterListChromeChevronToggle } from "@/components/layout/MasterListChromeChevronToggle";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { GroupListMemberMotionList } from "@/components/entity/GroupListMemberMotionList";
import { GroupListTreeNodeMotionList } from "@/components/entity/GroupListTreeNodeMotionList";
import { masterListOrderKey } from "@/hooks/useMasterListRowMotion";
import {
  GroupListExpandNameRow,
  renderGroupListRowShell,
} from "@/components/entity/GroupListMemberRow";
import {
  GROUP_LIST_CHILD_INDENT_CLASS,
  groupListMembersForDisplay,
  type GroupListSelectOptions,
} from "@/lib/groupListExpand";
import { masterEntityTextMatchesSearch } from "@/lib/filterMasterEntityListRows";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import {
  groupListAmountCn,
  GROUP_LIST_FOCUS_DIM_CLASS,
} from "@/lib/groupListUi";
import { formatGroupListCardCountSubtitle } from "@/lib/groupListCardCounts";
import type {
  MasterGroupListBranchDef,
  MasterGroupListConfig,
  MasterGroupListRow,
  MasterGroupTreeNode,
} from "@/lib/masterGroupListTree";
import {
  defaultMasterGroupListExpandedIds,
  masterGroupBranchListExpandKey,
  masterGroupTreeExpandKey,
  splitMasterGroupForestByBranch,
  isMasterGroupBranchListExpanded,
  isMasterGroupUserGroupExpanded,
  toggleMasterGroupSystemBranchExpand,
  toggleMasterGroupUserGroupExpand,
  buildMasterGroupFocusBrightIds,
  applyMasterGroupParentFocusExpand,
  buildMasterGroupSearchExpandedIds,
  buildMasterGroupSystemBranchGroup,
  collectMasterGroupDescendantIds,
  sortMasterGroupTreeNodes,
  sortMasterGroupListBranches,
  collectMasterGroupMoveExpandAncestorIds,
  isMasterGroupAncestorOf,
  ensureMasterGroupUserGroupExpanded,
  collapseMasterGroupUserGroupExpanded,
  sumMasterGroupForestBalance,
  sumMasterGroupForestPending,
  masterGroupBranchForestContainsGroupId,
} from "@/lib/masterGroupListTree";
import {
  useGroupListAccountMove,
  type GroupListMemberMoveProps,
} from "@/hooks/useGroupListAccountMove";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { stampLastVoucherMsOnGroupForest } from "@/lib/masterListLastVoucherMs";
import { GroupListAccountMoveOverlay } from "@/components/entity/GroupListAccountMoveOverlay";

export type MasterGroupMemberRowContext = {
  highlightQuery?: string;
  isSelected: boolean;
  onClick: () => void;
  pendingCount: number;
  memberMoveProps?: GroupListMemberMoveProps;
  isMoveMode?: boolean;
  rowDimClass?: string;
};

export type MasterGroupNestedListBodyProps<
  G extends MasterGroupListRow,
  M,
> = {
  config: MasterGroupListConfig;
  forest: MasterGroupTreeNode<G>[];
  allGroups: G[];
  displayOrderKey: string;
  searchTerm?: string;
  selectedGroup: G | null;
  selectedGroupMemberFilterId: string | null;
  groupMembersByGroupId: Record<string, M[]>;
  onSelectGroup: (group: G, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  pendingApprovalByMemberId?: Record<string, number>;
  getItemHref?: (group: G) => string | undefined;
  quickFilter: EntityListQuickFilter;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  rowMotionProps: Record<string, unknown>;
  isRowAnimationEnabled: boolean;
  layoutHoldMs: number;
  formatCurrency: (amount: number, options?: { showDrCr?: boolean }) => React.ReactNode;
  renderGroupLeading?: (group: G) => React.ReactNode;
  renderBranchLeading?: (branch: MasterGroupListBranchDef) => React.ReactNode;
  renderMemberRow: (
    member: M,
    group: G,
    ctx: MasterGroupMemberRowContext
  ) => React.ReactNode;
  balanceToneClass?: (balance: number) => string;
  isGroupBalanceMasked?: (group: G) => boolean;
  /** Party Groups — lift focus to PartyGroupList for IC tree dim parity with Expense. */
  focusGroupId?: string | null;
  onFocusGroupIdChange?: (id: string | null) => void;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (member: M, targetGroupId: string) => void | Promise<void>;
  canMoveMember?: (member: M) => boolean;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: G) => boolean;
  /** Optional inset rows inside a system branch (e.g. IC Company under Sundry Debtors). */
  branchInsetById?: Partial<
    Record<
      string,
      (ctx: {
        focusGroupId: string | null;
        searchTerm: string;
        rowDimClass?: string;
      }) => React.ReactNode
    >
  >;
};

type MasterGroupFocusContext = {
  isBright: (id: string) => boolean;
  dimClassName: string;
};

type MasterGroupMoveContext<M, G extends MasterGroupListRow> = {
  getMemberRowProps: (member: M) => GroupListMemberMoveProps;
  getGroupRowMoveProps: (group: G) => GroupListMemberMoveProps;
  getGroupRowDataAttrs: (
    groupId: string,
    hasChildGroups: boolean,
    dropAllowedWhenIdle?: boolean
  ) => Record<string, string>;
  isMoveMode: boolean;
};

type MasterGroupTreeNodeRowProps<
  G extends MasterGroupListRow,
  M,
> = Omit<MasterGroupNestedListBodyProps<G, M>, "config" | "forest"> & {
  config: MasterGroupListConfig;
  node: MasterGroupTreeNode<G>;
  expandedIds: Set<string>;
  onExpandedChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  depth: number;
  focusContext: MasterGroupFocusContext;
  moveContext: MasterGroupMoveContext<M, G>;
  onUserGroupExpandToggle: (groupId: string) => void;
  onUserGroupFocus: (groupId: string) => void;
  /** Per-container sort key (system branch / nested siblings). Falls back to displayOrderKey. */
  siblingOrderKey?: string;
  /** When true, outer motion.li is provided by GroupListTreeNodeMotionList. */
  disableOuterMotion?: boolean;
};

function memberRowKey<M>(member: M, group: MasterGroupListRow, index: number): string {
  const row = member as { id?: string; name?: string };
  return row.id || `${group.id}-member-${row.name ?? index}`;
}

function defaultGroupLeading() {
  return (
    <MasterListGroupIcon>
      <Users className="h-5 w-5" />
    </MasterListGroupIcon>
  );
}

function renderGroupAmount<G extends MasterGroupListRow>(
  group: G,
  balance: number,
  expanded: boolean,
  formatCurrency: MasterGroupNestedListBodyProps<G, unknown>["formatCurrency"],
  balanceToneClass?: (balance: number) => string,
  isGroupBalanceMasked?: (group: G) => boolean,
  rowFocusDimmed?: boolean
) {
  const masked = isGroupBalanceMasked?.(group) ?? false;
  return (
    <p
      className={groupListAmountCn(
        balance,
        expanded,
        balanceToneClass?.(balance),
        rowFocusDimmed
      )}
    >
      {masked ? "*****" : formatCurrency(balance, { showDrCr: true })}
    </p>
  );
}

function MasterGroupTreeNodeRow<G extends MasterGroupListRow, M>({
  config,
  node,
  displayOrderKey,
  selectedGroup,
  selectedGroupMemberFilterId,
  groupMembersByGroupId,
  onSelectGroup,
  pendingApprovalByGroupId = {},
  pendingApprovalByMemberId = {},
  getItemHref,
  quickFilter,
  rowMotionProps,
  formatCurrency,
  renderGroupLeading,
  renderMemberRow,
  balanceToneClass,
  isGroupBalanceMasked,
  expandedIds,
  onExpandedChange,
  depth,
  searchTerm = "",
  allGroups,
  animatePresenceMode,
  isRowAnimationEnabled,
  layoutHoldMs,
  focusContext,
  moveContext,
  onUserGroupExpandToggle,
  onUserGroupFocus,
  siblingOrderKey,
  disableOuterMotion = false,
}: MasterGroupTreeNodeRowProps<G, M>) {
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const rowLayoutKey = siblingOrderKey ?? displayOrderKey;
  const rowShellClassName = cn(
    depth > 0 ? GROUP_LIST_CHILD_INDENT_CLASS : undefined,
    focusContext.isBright(node.group.id) ? undefined : focusContext.dimClassName
  );
  const wrapRowShell = (body: React.ReactNode) =>
    disableOuterMotion ? (
      <div className={rowShellClassName}>{body}</div>
    ) : (
      <motion.li
        key={node.group.id || `master-grp-node-${depth}-${node.group.name}`}
        layoutDependency={rowLayoutKey}
        {...rowMotionProps}
        className={rowShellClassName}
      >
        {body}
      </motion.li>
    );
  const group = node.group;
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
    return sortMasterGroupTreeNodes(node.children, quickFilter, stamped);
  }, [node.children, quickFilter, lastVoucherMsById, groupMembersByGroupId]);
  const childGroupsListKey = useMemo(
    () => `${quickFilter}|${masterListOrderKey(sortedChildNodes.map((n) => n.group.id))}`,
    [quickFilter, sortedChildNodes]
  );
  const renderChildTreeNode = (child: MasterGroupTreeNode<G>) => (
    <MasterGroupTreeNodeRow
      disableOuterMotion
      config={config}
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
      renderMemberRow={renderMemberRow}
      balanceToneClass={balanceToneClass}
      isGroupBalanceMasked={isGroupBalanceMasked}
      expandedIds={expandedIds}
      onExpandedChange={onExpandedChange}
      depth={depth + 1}
      searchTerm={searchTerm}
      allGroups={allGroups}
      focusContext={focusContext}
      moveContext={moveContext}
      onUserGroupExpandToggle={onUserGroupExpandToggle}
      onUserGroupFocus={onUserGroupFocus}
    />
  );
  const hasChildGroups = node.children.length > 0;
  const isLeaf = !hasChildGroups;
  const isExpanded = isMasterGroupUserGroupExpanded(expandedIds, config, group.id);
  const canExpand = hasChildGroups || displayMembers.length > 0 || isLeaf;

  const isGroupSelectedOnly =
    selectedGroup?.id === group.id && !selectedGroupMemberFilterId;
  const groupPending = pendingApprovalByGroupId[group.id] ?? 0;
  const groupBalance = Number(group.balance || 0);
  const groupLeading = renderGroupLeading?.(group) ?? defaultGroupLeading();
  const rowDimClass = focusContext.isBright(group.id) ? undefined : focusContext.dimClassName;
  const rowFocusDimmed = Boolean(rowDimClass);
  const groupMoveProps = moveContext.getGroupRowMoveProps(group);
  const groupMoveAttrs = moveContext.getGroupRowDataAttrs(group.id, hasChildGroups, true);
  const groupCountSubtitle = formatGroupListCardCountSubtitle(
    node.children.length,
    members.length
  );

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
      {renderGroupAmount(
        group,
        groupBalance,
        isExpanded,
        formatCurrency,
        balanceToneClass,
        isGroupBalanceMasked,
        rowFocusDimmed
      )}
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
            getMemberKey={(member, index) => memberRowKey(member, group, index)}
            renderMember={(member) => {
              const memberId = (member as { id?: string }).id;
              return renderMemberRow(member, group, {
                highlightQuery: highlightQuery || undefined,
                isSelected:
                  selectedGroup?.id === group.id && selectedGroupMemberFilterId === memberId,
                onClick: () => {
                  if (moveContext.isMoveMode) return;
                  onUserGroupFocus(group.id);
                  onSelectGroup(group, { memberId: memberId ?? null });
                },
                pendingCount: pendingApprovalByMemberId[memberId ?? ""] ?? 0,
                memberMoveProps: moveContext.getMemberRowProps(member),
                isMoveMode: moveContext.isMoveMode,
              });
            }}
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
                child.group.id || `master-grp-child-${depth}-${child.group.name}`
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
              getMemberKey={(member, index) => memberRowKey(member, group, index)}
              renderMember={(member) =>
                renderMemberRow(member, group, {
                  highlightQuery: highlightQuery || undefined,
                  isSelected:
                    selectedGroup?.id === group.id &&
                    selectedGroupMemberFilterId === (member as { id?: string }).id,
                  onClick: () => {
                    if (moveContext.isMoveMode) return;
                    onUserGroupFocus(group.id);
                    onSelectGroup(group, {
                      memberId: (member as { id?: string }).id ?? null,
                    });
                  },
                  pendingCount:
                    pendingApprovalByMemberId[(member as { id?: string }).id ?? ""] ?? 0,
                  memberMoveProps: moveContext.getMemberRowProps(member),
                  isMoveMode: moveContext.isMoveMode,
                })
              }
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

type MasterGroupSystemBranchRowProps<
  G extends MasterGroupListRow,
  M,
> = Omit<MasterGroupNestedListBodyProps<G, M>, "config" | "forest"> & {
  config: MasterGroupListConfig;
  branch: MasterGroupListBranchDef;
  branchForest: MasterGroupTreeNode<G>[];
  expandedIds: Set<string>;
  onExpandedChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  focusContext: MasterGroupFocusContext;
  moveContext: MasterGroupMoveContext<M, G>;
  focusGroupId: string | null;
  branchInsetById?: MasterGroupNestedListBodyProps<G, M>["branchInsetById"];
  onUserGroupExpandToggle: (groupId: string) => void;
  onUserGroupFocus: (groupId: string) => void;
  onBranchExpandToggle: (branch: MasterGroupListBranchDef) => void;
  onBranchFocus: (branch: MasterGroupListBranchDef) => void;
  siblingOrderKey?: string;
  disableOuterMotion?: boolean;
};

function MasterGroupSystemBranchRow<G extends MasterGroupListRow, M>({
  config,
  branch,
  branchForest,
  displayOrderKey,
  expandedIds,
  onExpandedChange,
  pendingApprovalByGroupId = {},
  rowMotionProps,
  formatCurrency,
  renderBranchLeading,
  balanceToneClass,
  isGroupBalanceMasked,
  focusContext,
  moveContext,
  focusGroupId,
  branchInsetById,
  onUserGroupExpandToggle,
  onUserGroupFocus,
  onBranchExpandToggle,
  onBranchFocus,
  quickFilter,
  siblingOrderKey,
  disableOuterMotion = false,
  ...rest
}: MasterGroupSystemBranchRowProps<G, M>) {
  const branchLabel = branch.name;
  const branchLayoutKey = masterGroupBranchListExpandKey(config, branch.id);
  const branchRowLayoutKey = siblingOrderKey ?? branchLayoutKey;
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const highlightQuery = (rest.searchTerm || "").trim();
  const branchDirectMembers = rest.groupMembersByGroupId[branch.id] ?? [];
  const displayBranchDirectMembers = groupListMembersForDisplay(
    branchDirectMembers,
    quickFilter,
    rest.searchTerm || "",
    undefined,
    lastVoucherMsById,
    hideSettled
  );
  const sortedBranchForest = useMemo(() => {
    const stamped = stampLastVoucherMsOnGroupForest(
      branchForest,
      lastVoucherMsById,
      rest.groupMembersByGroupId
    );
    return sortMasterGroupTreeNodes(branchForest, quickFilter, stamped);
  }, [branchForest, quickFilter, lastVoucherMsById, rest.groupMembersByGroupId]);
  const branchGroupsListKey = useMemo(
    () =>
      `${quickFilter}|${masterListOrderKey(sortedBranchForest.map((n) => n.group.id))}`,
    [quickFilter, sortedBranchForest]
  );
  const branchExpanded = isMasterGroupBranchListExpanded(
    expandedIds,
    config,
    branch.id,
    branchForest
  );
  const directBalance = displayBranchDirectMembers.reduce(
    (sum, member) => sum + Number((member as { balance?: number }).balance || 0),
    0
  );
  const directPending = displayBranchDirectMembers.reduce((sum, member) => {
    const memberId = (member as { id?: string }).id ?? "";
    return sum + (rest.pendingApprovalByMemberId?.[memberId] ?? 0);
  }, 0);
  const branchBalance = sumMasterGroupForestBalance(branchForest) + directBalance;
  const branchPending =
    sumMasterGroupForestPending(branchForest, pendingApprovalByGroupId) + directPending;
  const branchHeaderDimClass = focusContext.isBright(branch.id) ? undefined : focusContext.dimClassName;
  const branchRowFocusDimmed = Boolean(branchHeaderDimClass);
  const directMemberDimClass = branchHeaderDimClass;
  const branchCountSubtitle = formatGroupListCardCountSubtitle(
    branchForest.length,
    branchDirectMembers.length
  );
  const isBranchSelected =
    rest.selectedGroup?.id === branch.id && !rest.selectedGroupMemberFilterId;
  const companyId = rest.allGroups[0]?.companyId ?? "";
  const branchSelectionGroup = {
    ...buildMasterGroupSystemBranchGroup(branch, branchForest, companyId),
    balance: branchBalance,
  };

  const searchQuery = highlightQuery.toLowerCase();
  const branchNameMatchesSearch =
    !searchQuery || masterEntityTextMatchesSearch(branchLabel, rest.searchTerm || "");
  const hideBranchDirectMembers =
    !searchQuery &&
    Boolean(focusGroupId) &&
    focusGroupId !== branch.id &&
    (masterGroupBranchForestContainsGroupId(branchForest, focusGroupId) ||
      config.focusBranchByGroupId?.[focusGroupId ?? ""] === branch.id);
  const visibleBranchDirectMembers = hideBranchDirectMembers ? [] : displayBranchDirectMembers;
  const branchInset = branchInsetById?.[branch.id]?.({
    focusGroupId,
    searchTerm: rest.searchTerm || "",
    rowDimClass: branchHeaderDimClass,
  });
  const branchHasVisibleMatches =
    branchForest.length > 0 || visibleBranchDirectMembers.length > 0 || Boolean(branchInset);
  if (searchQuery && !branchNameMatchesSearch && !branchHasVisibleMatches) {
    return null;
  }

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

  const branchLeading = renderBranchLeading?.(branch) ?? defaultGroupLeading();

  const branchCard = (
    <div className="pl-master-list-row">
      <div className="pl-master-list-row-leading">
        <div className="relative flex-shrink-0">
          {branchLeading}
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
      {renderGroupAmount(
        branchSelectionGroup,
        branchBalance,
        branchExpanded,
        formatCurrency,
        balanceToneClass,
        isGroupBalanceMasked,
        branchRowFocusDimmed
      )}
    </div>
  );

  const branchRow = renderGroupListRowShell(
    isBranchSelected,
    selectBranchRow,
    branchCard,
    rest.getItemHref?.(branchSelectionGroup),
    moveContext.getGroupRowDataAttrs(
      branch.id,
      branchForest.length > 0,
      Boolean(rest.moveAccountsEnabled)
    )
  );

  const renderBranchUserGroup = (node: MasterGroupTreeNode<G>) => (
    <MasterGroupTreeNodeRow
      disableOuterMotion
      config={config}
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
      renderGroupLeading={rest.renderGroupLeading}
      renderMemberRow={rest.renderMemberRow}
      balanceToneClass={balanceToneClass}
      isGroupBalanceMasked={isGroupBalanceMasked}
      focusContext={focusContext}
      moveContext={moveContext}
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
              getMemberKey={(member, index) =>
                memberRowKey(member, branchSelectionGroup, index)
              }
              renderMember={(member) => {
                const memberId = (member as { id?: string }).id;
                return rest.renderMemberRow(member, branchSelectionGroup, {
                  highlightQuery: highlightQuery || undefined,
                  isSelected:
                    rest.selectedGroup?.id === branch.id &&
                    rest.selectedGroupMemberFilterId === memberId,
                  onClick: () => {
                    if (moveContext.isMoveMode) return;
                    onBranchFocus(branch);
                    rest.onSelectGroup(branchSelectionGroup, {
                      memberId: memberId ?? null,
                    });
                  },
                  pendingCount: rest.pendingApprovalByMemberId?.[memberId ?? ""] ?? 0,
                  memberMoveProps: moveContext.getMemberRowProps(member),
                  isMoveMode: moveContext.isMoveMode,
                  rowDimClass: directMemberDimClass,
                });
              }}
            />
          </div>
        ) : null}
        {branchInset ? <div className="flex flex-col gap-1">{branchInset}</div> : null}
        {sortedBranchForest.length === 0 && visibleBranchDirectMembers.length === 0 && !branchInset ? (
          <li className="px-2 py-2 text-xs text-muted-foreground">
            No groups in {branchLabel}.
          </li>
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

export function MasterGroupNestedListBody<G extends MasterGroupListRow, M>({
  config,
  forest,
  displayOrderKey,
  pendingApprovalByGroupId = {},
  pendingApprovalByMemberId = {},
  focusGroupId: focusGroupIdProp,
  onFocusGroupIdChange,
  moveAccountsEnabled = false,
  onMoveAccountToGroup,
  canMoveMember,
  onMoveGroupToGroup,
  canMoveGroup,
  branchInsetById,
  ...rest
}: MasterGroupNestedListBodyProps<G, M>) {
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const [expandedIds, setExpandedIds] = useState(() =>
    defaultMasterGroupListExpandedIds(config)
  );
  const [internalFocusGroupId, setInternalFocusGroupId] = useState<string | null>(null);
  const isFocusControlled = onFocusGroupIdChange != null;
  const focusGroupId = isFocusControlled ? (focusGroupIdProp ?? null) : internalFocusGroupId;
  const setFocusGroupId = useCallback(
    (next: string | null | ((current: string | null) => string | null)) => {
      if (isFocusControlled) {
        const resolved =
          typeof next === "function" ? next(focusGroupIdProp ?? null) : next;
        onFocusGroupIdChange?.(resolved);
        return;
      }
      setInternalFocusGroupId(next);
    },
    [isFocusControlled, onFocusGroupIdChange, focusGroupIdProp]
  );
  const branchForests = useMemo(() => {
    const split = splitMasterGroupForestByBranch(forest, config, rest.allGroups);
    const out: Record<string, MasterGroupTreeNode<G>[]> = {};
    for (const branch of config.branches) {
      const branchNodes = split[branch.id] ?? [];
      const stamped = stampLastVoucherMsOnGroupForest(
        branchNodes,
        lastVoucherMsById,
        rest.groupMembersByGroupId
      );
      out[branch.id] = sortMasterGroupTreeNodes(branchNodes, rest.quickFilter, stamped);
    }
    return out;
  }, [forest, config, rest.allGroups, rest.quickFilter, lastVoucherMsById, rest.groupMembersByGroupId]);
  const searchActive = Boolean((rest.searchTerm || "").trim());

  useEffect(() => {
    if (!searchActive) return;
    setFocusGroupId(null);
    setExpandedIds(buildMasterGroupSearchExpandedIds(config, branchForests, rest.allGroups));
  }, [searchActive, rest.searchTerm, config, branchForests, rest.allGroups, setFocusGroupId]);

  const prevControlledFocusRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isFocusControlled || searchActive) return;
    if (focusGroupIdProp === prevControlledFocusRef.current) return;
    prevControlledFocusRef.current = focusGroupIdProp;
    if (!focusGroupIdProp) {
      setExpandedIds(defaultMasterGroupListExpandedIds(config));
      return;
    }
    setExpandedIds((prev) =>
      applyMasterGroupParentFocusExpand(
        prev,
        config,
        focusGroupIdProp,
        rest.allGroups,
        branchForests
      )
    );
  }, [
    focusGroupIdProp,
    isFocusControlled,
    searchActive,
    config,
    branchForests,
    rest.allGroups,
  ]);

  const focusContext = useMemo(() => {
    if (searchActive) {
      return {
        isBright: () => true,
        dimClassName: GROUP_LIST_FOCUS_DIM_CLASS,
      };
    }
    const brightIds = buildMasterGroupFocusBrightIds(
      focusGroupId,
      rest.allGroups,
      config,
      branchForests
    );
    return {
      isBright: (id: string) => !brightIds || brightIds.has(id),
      dimClassName: GROUP_LIST_FOCUS_DIM_CLASS,
    };
  }, [searchActive, focusGroupId, rest.allGroups, config, branchForests]);

  const handleUserGroupFocus = useCallback(
    (groupId: string) => {
      if (searchActive) return;
      setFocusGroupId(groupId);
      setExpandedIds((prev) =>
        applyMasterGroupParentFocusExpand(
          prev,
          config,
          groupId,
          rest.allGroups,
          branchForests
        )
      );
    },
    [searchActive, config, rest.allGroups, branchForests, setFocusGroupId]
  );

  const handleUserGroupExpandToggle = useCallback(
    (groupId: string) => {
      if (searchActive) {
        setExpandedIds((prev) => {
          const key = masterGroupTreeExpandKey(config, groupId);
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
            collectMasterGroupDescendantIds(groupId, rest.allGroups).forEach((childId) => {
              next.delete(masterGroupTreeExpandKey(config, childId));
            });
          } else {
            next.add(key);
          }
          return next;
        });
        return;
      }
      setExpandedIds((prev) => {
        const wasExpanded = isMasterGroupUserGroupExpanded(prev, config, groupId);
        let next = toggleMasterGroupUserGroupExpand(prev, config, groupId, rest.allGroups);
        const nowExpanded = isMasterGroupUserGroupExpanded(next, config, groupId);
        if (nowExpanded && !wasExpanded) {
          next = applyMasterGroupParentFocusExpand(
            next,
            config,
            groupId,
            rest.allGroups,
            branchForests
          );
          setFocusGroupId(groupId);
        } else if (!nowExpanded && wasExpanded) {
          setFocusGroupId((current) => (current === groupId ? null : current));
        }
        return next;
      });
    },
    [searchActive, config, rest.allGroups, branchForests, setFocusGroupId]
  );

  const handleBranchFocus = useCallback(
    (branch: MasterGroupListBranchDef) => {
      if (searchActive) return;
      setFocusGroupId(branch.id);
      setExpandedIds((prev) =>
        applyMasterGroupParentFocusExpand(
          prev,
          config,
          branch.id,
          rest.allGroups,
          branchForests
        )
      );
    },
    [searchActive, config, rest.allGroups, branchForests, setFocusGroupId]
  );

  const handleBranchExpandToggle = useCallback(
    (branch: MasterGroupListBranchDef) => {
      if (searchActive) {
        setExpandedIds((prev) => toggleMasterGroupSystemBranchExpand(prev, config, branch.id));
        return;
      }
      setExpandedIds((prev) => {
        const key = masterGroupBranchListExpandKey(config, branch.id);
        const wasExpanded = prev.has(key);
        const next = toggleMasterGroupSystemBranchExpand(prev, config, branch.id);
        const nowExpanded = next.has(key);
        if (nowExpanded && !wasExpanded) {
          setFocusGroupId(branch.id);
          return applyMasterGroupParentFocusExpand(
            next,
            config,
            branch.id,
            rest.allGroups,
            branchForests
          );
        } else if (!nowExpanded && wasExpanded) {
          setFocusGroupId((current) => (current === branch.id ? null : current));
        }
        return next;
      });
    },
    [config, setFocusGroupId, searchActive, rest.allGroups, branchForests]
  );

  const {
    moveHint,
    cursor,
    getMemberRowProps,
    getGroupRowMoveProps,
    getGroupRowDataAttrs,
    isMoveMode,
  } = useGroupListAccountMove<M & { id: string }>({
    disabled: !moveAccountsEnabled || (!onMoveAccountToGroup && !onMoveGroupToGroup),
    collectMoveExpandIds: (groupId) =>
      collectMasterGroupMoveExpandAncestorIds(groupId, rest.allGroups, config),
    isMoveTreeAncestorOf: (ancestorId, descendantId) =>
      isMasterGroupAncestorOf(ancestorId, descendantId, rest.allGroups, config),
    isInvalidGroupDropTarget: onMoveGroupToGroup
      ? (sourceGroupId, targetGroupId) =>
          isMasterGroupAncestorOf(sourceGroupId, targetGroupId, rest.allGroups, config) ||
          sourceGroupId === targetGroupId
      : undefined,
    canMoveAccount: canMoveMember as ((account: M & { id: string }) => boolean) | undefined,
    canMoveGroup: canMoveGroup
      ? (groupId) => {
          const group = rest.allGroups.find((g) => g.id === groupId);
          return group ? canMoveGroup(group) : false;
        }
      : undefined,
    onMoveAccount: (member, targetGroupId) =>
      onMoveAccountToGroup?.(member as M, targetGroupId) ?? Promise.resolve(),
    onMoveGroup: onMoveGroupToGroup,
    onAutoExpandGroup: (groupId) => {
      if (config.branches.some((branch) => branch.id === groupId)) {
        setExpandedIds((prev) => {
          const key = masterGroupBranchListExpandKey(config, groupId);
          if (prev.has(key)) return prev;
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        return;
      }
      setExpandedIds((prev) => ensureMasterGroupUserGroupExpanded(prev, config, groupId));
    },
    onAutoCollapseGroup: (groupId) => {
      if (config.branches.some((branch) => branch.id === groupId)) return;
      setExpandedIds((prev) => collapseMasterGroupUserGroupExpanded(prev, config, groupId));
    },
  });

  const moveContext = useMemo(
    (): MasterGroupMoveContext<M, G> => ({
      getMemberRowProps: (member) => {
        const memberId = (member as { id?: string }).id;
        if (!memberId) return {};
        return getMemberRowProps({ ...(member as object), id: memberId } as M & { id: string });
      },
      getGroupRowMoveProps: (group) => getGroupRowMoveProps(group.id),
      getGroupRowDataAttrs,
      isMoveMode,
    }),
    [getMemberRowProps, getGroupRowMoveProps, getGroupRowDataAttrs, isMoveMode]
  );

  const displayBranches = useMemo(() => {
    const rows = config.branches.map((branch) => {
      const branchForest = branchForests[branch.id] ?? [];
      const directMembers = rest.groupMembersByGroupId[branch.id] ?? [];
      const directBalance = directMembers.reduce(
        (sum, member) => sum + Number((member as { balance?: number }).balance || 0),
        0
      );
      return {
        branch,
        balance: sumMasterGroupForestBalance(branchForest) + directBalance,
      };
    });
    return sortMasterGroupListBranches(rows, config, rest.quickFilter, lastVoucherMsById);
  }, [config, branchForests, rest.groupMembersByGroupId, rest.quickFilter, lastVoucherMsById]);

  const systemBranchesListKey = useMemo(
    () =>
      `${rest.quickFilter}|${masterListOrderKey(displayBranches.map((row) => row.branch.id))}`,
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
        getItemKey={(row) => masterGroupBranchListExpandKey(config, row.branch.id)}
        getItemId={(row) => row.branch.id}
        renderItem={(row) => (
          <MasterGroupSystemBranchRow
            disableOuterMotion
            siblingOrderKey={systemBranchesListKey}
            config={config}
            branch={row.branch}
            branchForest={branchForests[row.branch.id] ?? []}
            displayOrderKey={displayOrderKey}
            expandedIds={expandedIds}
            onExpandedChange={setExpandedIds}
            pendingApprovalByGroupId={pendingApprovalByGroupId}
            pendingApprovalByMemberId={pendingApprovalByMemberId}
            focusContext={focusContext}
            moveContext={moveContext}
            focusGroupId={focusGroupId}
            branchInsetById={branchInsetById}
            onUserGroupExpandToggle={handleUserGroupExpandToggle}
            onUserGroupFocus={handleUserGroupFocus}
            onBranchExpandToggle={handleBranchExpandToggle}
            onBranchFocus={handleBranchFocus}
            moveAccountsEnabled={moveAccountsEnabled}
            onMoveAccountToGroup={onMoveAccountToGroup}
            canMoveMember={canMoveMember}
            onMoveGroupToGroup={onMoveGroupToGroup}
            canMoveGroup={canMoveGroup}
            quickFilter={rest.quickFilter}
            selectedGroup={rest.selectedGroup}
            selectedGroupMemberFilterId={rest.selectedGroupMemberFilterId}
            groupMembersByGroupId={rest.groupMembersByGroupId}
            onSelectGroup={rest.onSelectGroup}
            getItemHref={rest.getItemHref}
            searchTerm={rest.searchTerm}
            allGroups={rest.allGroups}
            animatePresenceMode={rest.animatePresenceMode}
            rowMotionProps={rest.rowMotionProps}
            isRowAnimationEnabled={rest.isRowAnimationEnabled}
            layoutHoldMs={rest.layoutHoldMs}
            formatCurrency={rest.formatCurrency}
            renderGroupLeading={rest.renderGroupLeading}
            renderBranchLeading={rest.renderBranchLeading}
            renderMemberRow={rest.renderMemberRow}
            balanceToneClass={rest.balanceToneClass}
            isGroupBalanceMasked={rest.isGroupBalanceMasked}
          />
        )}
      />
      <GroupListAccountMoveOverlay visible={isMoveMode} hint={moveHint} cursor={cursor} />
    </>
  );
}
