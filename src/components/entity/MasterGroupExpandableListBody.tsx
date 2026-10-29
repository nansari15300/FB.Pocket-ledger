"use client";

import React, { useState } from "react";
import { Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { ExpandableGroupListTree } from "@/components/entity/ExpandableGroupListTree";
import {
  GroupListExpandNameRow,
  GroupListMemberRow,
  renderGroupListRowShell,
} from "@/components/entity/GroupListMemberRow";
import { formatGroupListCardCountSubtitle } from "@/lib/groupListCardCounts";
import {
  toggleGroupListAccordionExpand,
  type GroupListSelectOptions,
} from "@/lib/groupListExpand";
import { groupListMemberAvatarFromRow } from "@/components/entity/GroupListMemberAvatar";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";

type MasterGroupRow = {
  id: string;
  name: string;
  balance?: number;
  fileUrl?: string | null;
  fileUrls?: string[] | null;
  companyId?: string;
};

type MasterGroupExpandableListBodyProps<
  G extends MasterGroupRow,
  M extends MasterGroupRow,
> = {
  displayListRows: G[];
  displayOrderKey: string;
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
  expandAriaLabel: string;
  formatCurrency: (amount: number, options?: { showDrCr?: boolean }) => React.ReactNode;
  renderGroupLeading?: (group: G) => React.ReactNode;
  renderMemberLeading?: (member: M) => React.ReactNode;
};

export function MasterGroupExpandableListBody<
  G extends MasterGroupRow,
  M extends MasterGroupRow,
>({
  displayListRows,
  displayOrderKey,
  selectedGroup,
  selectedGroupMemberFilterId,
  groupMembersByGroupId,
  onSelectGroup,
  pendingApprovalByGroupId = {},
  pendingApprovalByMemberId = {},
  getItemHref,
  quickFilter,
  animatePresenceMode,
  rowMotionProps,
  isRowAnimationEnabled,
  layoutHoldMs,
  expandAriaLabel,
  formatCurrency,
  renderGroupLeading,
  renderMemberLeading,
}: MasterGroupExpandableListBodyProps<G, M>) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const defaultLeading = (
    <MasterListGroupIcon>
      <Users className="h-5 w-5" />
    </MasterListGroupIcon>
  );

  return (
    <AnimatePresence mode={animatePresenceMode}>
      {displayListRows.map((group) => {
        const href = getItemHref?.(group);
        const members = groupMembersByGroupId[group.id] ?? [];
        const isGroupSelectedOnly =
          selectedGroup?.id === group.id && !selectedGroupMemberFilterId;
        const groupPending = pendingApprovalByGroupId[group.id] ?? 0;
        const groupBalance = Number(group.balance || 0);
        const groupLeading = renderGroupLeading?.(group) ?? defaultLeading;

        const groupCountSubtitle = formatGroupListCardCountSubtitle(0, members.length);

        const renderGroupCard = (expandControl: React.ReactNode | null) => (
          <div className="pl-master-list-row">
            <div className="pl-master-list-row-leading">
              <div className="relative flex-shrink-0">
                {groupLeading}
                <MasterListPendingBadge count={groupPending} />
              </div>
              <GroupListExpandNameRow
                name={group.name}
                expandControl={expandControl}
                pendingCount={groupPending}
                secondaryLabel={groupCountSubtitle}
              />
            </div>
            <p
              className={cn(
                "pl-master-list-row-amount-xs ml-1 rounded px-1",
                groupBalance >= 0 ? "text-green-600" : "text-red-600"
              )}
            >
              {formatCurrency(groupBalance, { showDrCr: true })}
            </p>
          </div>
        );

        return (
          <motion.li key={group.id} layoutDependency={displayOrderKey} {...rowMotionProps}>
            <ExpandableGroupListTree
              members={members}
              isGroupSelectedOnly={isGroupSelectedOnly}
              selectedMemberId={
                selectedGroup?.id === group.id ? selectedGroupMemberFilterId : null
              }
              expanded={expandedGroupId === group.id}
              onExpandedChange={() =>
                setExpandedGroupId((prev) => toggleGroupListAccordionExpand(prev, group.id))
              }
              onSelectGroup={() => onSelectGroup(group, { memberId: null })}
              onSelectMember={(memberId) => onSelectGroup(group, { memberId })}
              quickFilter={quickFilter}
              expandAriaLabel={expandAriaLabel}
              animatePresenceMode={animatePresenceMode}
              rowMotionProps={rowMotionProps}
              isRowAnimationEnabled={isRowAnimationEnabled}
              layoutHoldMs={layoutHoldMs}
              renderGroupRow={({ expandControl }) =>
                renderGroupListRowShell(
                  isGroupSelectedOnly,
                  () => onSelectGroup(group, { memberId: null }),
                  renderGroupCard(expandControl),
                  href
                )
              }
              renderMemberRow={(member, memberSelected, onClick) => (
                <GroupListMemberRow
                  name={member.name}
                  balance={member.balance}
                  isSelected={memberSelected}
                  onClick={onClick}
                  pendingCount={pendingApprovalByMemberId[member.id] ?? 0}
                  leading={
                    renderMemberLeading?.(member) ??
                    groupListMemberAvatarFromRow(member)
                  }
                />
              )}
            />
          </motion.li>
        );
      })}
    </AnimatePresence>
  );
}
