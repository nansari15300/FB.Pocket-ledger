
"use client";

import React, { useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDate } from "@/hooks/useDate";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { TooltipProvider } from "../ui/tooltip";
import type { TaxGroup, Tax } from "@/components/tax/types";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { motion } from "framer-motion";
import { isSystemParentGroup } from "@/lib/system-groups";
import { masterListShellCn } from "@/lib/masterListChrome";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { MasterGroupNestedListBody } from "@/components/entity/MasterGroupNestedListBody";
import { TAX_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { useMasterGroupListForest } from "@/hooks/useMasterGroupListForest";
import { GroupListMemberRow } from "@/components/entity/GroupListMemberRow";
import { groupListMemberAvatarFromRow } from "@/components/entity/GroupListMemberAvatar";
import { Users } from "lucide-react";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";

export function TaxGroupList({
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
  groups: TaxGroup[];
  searchTerm: string;
  selectedGroup: TaxGroup | null;
  onSelectGroup: (group: TaxGroup, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  getItemHref?: (group: TaxGroup) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  groupMembersByGroupId?: Record<string, Tax[]>;
  selectedGroupMemberFilterId?: string | null;
  pendingApprovalByMemberId?: Record<string, number>;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (tax: Tax, targetGroupId: string) => void | Promise<void>;
  canMoveMember?: (tax: Tax) => boolean;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: TaxGroup) => boolean;
  allGroupsForMove?: TaxGroup[];
}) {
  const { formatCurrency } = useDate();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const visibleGroupFilter = useCallback((group: TaxGroup) => {
    const isReportOnly = (group as { isReportOnly?: boolean }).isReportOnly === true;
    const isSystemParent =
      (group as { isSystemReserved?: boolean }).isSystemReserved === true ||
      isSystemParentGroup("tax_groups", group.id);
    if (isReportOnly || isSystemParent) return false;
    return !!group.name;
  }, []);

  const { forest, visibleGroups, displayOrderKey } = useMasterGroupListForest({
    groups,
    config: TAX_GROUP_LIST_CONFIG,
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
          className="min-h-0 min-w-0 flex-1"
          onViewportScroll={markListScrolling}
          onViewportTouchMove={markListScrolling}
        >
          <ul className="pl-master-list-ul">
            <MasterGroupNestedListBody
              config={TAX_GROUP_LIST_CONFIG}
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
                  <Users className="h-5 w-5" />
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
                  isAccountFrozen={Boolean((member as Tax).isFrozen)}
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
