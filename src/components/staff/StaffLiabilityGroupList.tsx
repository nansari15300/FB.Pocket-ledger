"use client";

import type { Staff, StaffGroup } from "@/components/staff/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDate } from "@/hooks/useDate";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCallback, useState } from "react";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { masterListShellCn } from "@/lib/masterListChrome";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { MasterGroupNestedListBody } from "@/components/entity/MasterGroupNestedListBody";
import { STAFF_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { useMasterGroupListForest } from "@/hooks/useMasterGroupListForest";
import { GroupListMemberRow } from "@/components/entity/GroupListMemberRow";
import { groupListMemberAvatarFromRow } from "@/components/entity/GroupListMemberAvatar";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import { masterDetailBalanceToneClass } from "@/lib/utils";

export function StaffLiabilityGroupList({
  systemGroup: _systemGroup,
  childGroups,
  groupMembersByGroupId,
  searchTerm,
  selectedGroup,
  onSelectGroup,
  pendingApprovalByGroupId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
  selectedGroupMemberFilterId = null,
  pendingApprovalByMemberId = {},
  moveAccountsEnabled = false,
  onMoveAccountToGroup,
  canMoveMember,
  onMoveGroupToGroup,
  canMoveGroup,
  allGroupsForMove,
}: {
  systemGroup: StaffGroup;
  childGroups: StaffGroup[];
  groupMembersByGroupId: Record<string, Staff[]>;
  searchTerm: string;
  selectedGroup: StaffGroup | null;
  onSelectGroup: (group: StaffGroup, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  getItemHref?: (group: StaffGroup) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  selectedGroupMemberFilterId?: string | null;
  pendingApprovalByMemberId?: Record<string, number>;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (staff: Staff, targetGroupId: string) => void | Promise<void>;
  canMoveMember?: (staff: Staff) => boolean;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: StaffGroup) => boolean;
  allGroupsForMove?: StaffGroup[];
}) {
  void _systemGroup;
  const { formatCurrency } = useDate();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const visibleGroupFilter = useCallback((group: StaffGroup) => !!group?.name && !!group.id, []);

  const { forest, visibleGroups, displayOrderKey } = useMasterGroupListForest({
    groups: childGroups,
    config: STAFF_GROUP_LIST_CONFIG,
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
              config={STAFF_GROUP_LIST_CONFIG}
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
              balanceToneClass={masterDetailBalanceToneClass}
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
                  isAccountFrozen={Boolean(member.isFrozen)}
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
