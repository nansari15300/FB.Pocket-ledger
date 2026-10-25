
"use client";

import React, { useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDate } from "@/hooks/useDate";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ItemGroup, Item } from "@/components/items/types";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { isSystemParentGroup } from "@/lib/system-groups";
import { Boxes } from "lucide-react";
import { masterListShellCn } from "@/lib/masterListChrome";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { MasterGroupNestedListBody } from "@/components/entity/MasterGroupNestedListBody";
import { resolveItemGroupListConfigForCompany } from "@/lib/adminPanelCompany/resolveItemGroupListConfig";
import { useCompany } from "@/hooks/useCompany";
import { useMasterGroupListForest } from "@/hooks/useMasterGroupListForest";
import { GroupListMemberRow } from "@/components/entity/GroupListMemberRow";
import { groupListMemberAvatarFromRow } from "@/components/entity/GroupListMemberAvatar";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import { motion } from "framer-motion";

export function ItemGroupList({
  groups,
  searchTerm,
  selectedGroup,
  onSelectGroup,
  pendingApprovalByGroupId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
  groupMembersByGroupId = {},
  selectedGroupMemberFilterId = null,
  pendingApprovalByMemberId = {},
  moveAccountsEnabled = false,
  onMoveAccountToGroup,
  canMoveMember,
  onMoveGroupToGroup,
  canMoveGroup,
  allGroupsForMove,
}: {
  groups: ItemGroup[];
  searchTerm: string;
  selectedGroup: ItemGroup | null;
  onSelectGroup: (group: ItemGroup, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  getItemHref?: (group: ItemGroup) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  groupMembersByGroupId?: Record<string, Item[]>;
  selectedGroupMemberFilterId?: string | null;
  pendingApprovalByMemberId?: Record<string, number>;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (item: Item, targetGroupId: string) => void | Promise<void>;
  canMoveMember?: (item: Item) => boolean;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: ItemGroup) => boolean;
  allGroupsForMove?: ItemGroup[];
}) {
  const { companyId } = useCompany();
  const groupListConfig = React.useMemo(
    () => resolveItemGroupListConfigForCompany(companyId),
    [companyId]
  );
  const { formatCurrency } = useDate();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const visibleGroupFilter = useCallback((group: ItemGroup) => {
    const isReportOnly = (group as { isReportOnly?: boolean }).isReportOnly === true;
    const isSystemParent =
      (group as { isSystemReserved?: boolean }).isSystemReserved === true ||
      isSystemParentGroup("item_groups", group.id);
    if (isReportOnly || isSystemParent) return false;
    return !!group.name;
  }, []);

  const { forest, visibleGroups, displayOrderKey } = useMasterGroupListForest({
    groups,
    config: groupListConfig,
    searchTerm,
    quickFilter,
    groupMembersByGroupId,
    visibleGroupFilter,
  });

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div className={masterListShellCn}>
        <ScrollArea
          listChrome
          className="min-h-0 min-w-0 w-full flex-1"
          onViewportScroll={markListScrolling}
          onViewportTouchMove={markListScrolling}
        >
          <ul className="pl-master-list-ul w-full">
            <MasterGroupNestedListBody
              config={groupListConfig}
              forest={forest}
              allGroups={allGroupsForMove ?? visibleGroups}
              displayOrderKey={displayOrderKey}
              searchTerm={searchTerm}
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
              formatCurrency={(amount, options) =>
                formatCurrency(amount, { ...options, noAnimation: true }) as React.ReactNode
              }
              renderGroupLeading={() => (
                <MasterListGroupIcon>
                  <Boxes className="h-5 w-5" />
                </MasterListGroupIcon>
              )}
              renderMemberRow={(member, group, ctx) => (
                <GroupListMemberRow
                  key={member.id || `${group.id}-member-${member.name}`}
                  name={member.name}
                  balance={member.balance}
                  isSelected={ctx.isSelected}
                  onClick={ctx.onClick}
                  pendingCount={ctx.pendingCount}
                  leading={groupListMemberAvatarFromRow(member)}
                  highlightQuery={ctx.highlightQuery}
                  isAccountFrozen={false}
                  rowDimClass={ctx.rowDimClass}
                  {...ctx.memberMoveProps}
                />
              )}
              moveAccountsEnabled={moveAccountsEnabled}
              onMoveAccountToGroup={onMoveAccountToGroup}
              canMoveMember={canMoveMember}
              onMoveGroupToGroup={onMoveGroupToGroup}
              canMoveGroup={canMoveGroup}
            />
          </ul>
        </ScrollArea>
        {!hideQuickFilterBar ? (
          <EntityListQuickFilterBar active={quickFilter} onChange={setQuickFilter} />
        ) : null}
      </motion.div>
    </TooltipProvider>
  );
}
