
"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Users, Crown, Landmark } from "lucide-react";
import type { AccountGroup } from "@/components/bank-cash/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDate } from "@/hooks/useDate";
import { useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { TooltipProvider } from "../ui/tooltip";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { motion } from "framer-motion";
import { isSystemParentGroup } from "@/lib/system-groups";
import { masterListShellCn, MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import type { Account } from "@/components/bank-cash/types";
import { bankAccountDisplayName } from "@/lib/bankAccountDisplayName";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import { MasterGroupNestedListBody } from "@/components/entity/MasterGroupNestedListBody";
import { BANK_ACCOUNT_GROUP_LIST_CONFIG } from "@/lib/masterGroupListConfigs";
import { useMasterGroupListForest } from "@/hooks/useMasterGroupListForest";
import { GroupListMemberRow } from "@/components/entity/GroupListMemberRow";

export function AccountGroupList({
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
  groups: AccountGroup[];
  searchTerm: string;
  selectedGroup: AccountGroup | null;
  onSelectGroup: (group: AccountGroup, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  getItemHref?: (group: AccountGroup) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  groupMembersByGroupId?: Record<string, Account[]>;
  selectedGroupMemberFilterId?: string | null;
  pendingApprovalByMemberId?: Record<string, number>;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (account: Account, targetGroupId: string) => void | Promise<void>;
  canMoveMember?: (account: Account) => boolean;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: AccountGroup) => boolean;
  allGroupsForMove?: AccountGroup[];
}) {
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const { formatCurrency } = useDate();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const visibleGroupFilter = useCallback((group: AccountGroup) => {
    const isReportOnly = (group as { isReportOnly?: boolean }).isReportOnly === true;
    const isSystemParent =
      (group as { isSystemReserved?: boolean }).isSystemReserved === true ||
      isSystemParentGroup("account_groups", group.id);
    if (isReportOnly || isSystemParent) return false;
    return !!group.name;
  }, []);

  const groupMembersForSearch = useMemo(() => {
    const out: Record<string, { name?: string }[]> = {};
    for (const [groupId, members] of Object.entries(groupMembersByGroupId)) {
      out[groupId] = members.map((member) => ({ name: bankAccountDisplayName(member) }));
    }
    return out;
  }, [groupMembersByGroupId]);

  const { forest, visibleGroups, displayOrderKey } = useMasterGroupListForest({
    groups,
    config: BANK_ACCOUNT_GROUP_LIST_CONFIG,
    searchTerm,
    quickFilter,
    groupMembersByGroupId: groupMembersForSearch,
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
              config={BANK_ACCOUNT_GROUP_LIST_CONFIG}
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
              isGroupBalanceMasked={(group) =>
                Boolean((group as { balanceMasked?: boolean }).balanceMasked)
              }
              renderGroupLeading={(group) => (
                <MasterListGroupIcon>
                  {(group as { hasSpecial?: boolean }).hasSpecial ? (
                    <Crown className="h-5 w-5 text-amber-500" />
                  ) : (
                    <Users className="h-5 w-5" />
                  )}
                </MasterListGroupIcon>
              )}
              renderMemberRow={(member, _group, ctx) => {
                const memberHasSpecial = (member as { isSpecial?: boolean }).isSpecial;
                const memberBalanceMasked = typeof member.balance !== "number";
                const displayName = bankAccountDisplayName(member);
                const attachmentPreviewUrl = trimEntityFileUrlForPreview(member.fileUrl);
                return (
                  <GroupListMemberRow
                    key={member.id || displayName}
                    name={displayName}
                    balance={member.balance}
                    isSelected={ctx.isSelected}
                    onClick={ctx.onClick}
                    balanceMasked={memberBalanceMasked}
                    pendingCount={ctx.pendingCount}
                    highlightQuery={ctx.highlightQuery}
                    isAccountFrozen={Boolean(member.isFrozen)}
                    rowDimClass={ctx.rowDimClass}
                    {...ctx.memberMoveProps}
                    leading={
                      <EntityFileAttachmentHover
                        fileUrl={attachmentPreviewUrl}
                        triggerClassName="inline-flex shrink-0 rounded-full"
                      >
                        <ResolvedEntityAvatar
                          className={MASTER_LIST_AVATAR_CN}
                          fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                          companyId={member.companyId}
                          src={attachmentPreviewUrl ?? undefined}
                          alt={displayName}
                          fallbackSlot={
                            memberHasSpecial ? (
                              <Crown className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Landmark className="h-4 w-4 text-muted-foreground" />
                            )
                          }
                        />
                      </EntityFileAttachmentHover>
                    }
                  />
                );
              }}
              moveAccountsEnabled={moveAccountsEnabled}
              onMoveAccountToGroup={onMoveAccountToGroup}
              canMoveMember={canMoveMember}
              onMoveGroupToGroup={onMoveGroupToGroup}
              canMoveGroup={canMoveGroup}
            />
          </ul>
        </ScrollArea>
        {!hideQuickFilterBar ? (
          <EntityListQuickFilterBar
            active={quickFilter}
            onChange={setQuickFilter}
            hideSettled={hideSettled}
            onHideSettledChange={setHideSettled}
          />
        ) : null}
      </motion.div>
    </TooltipProvider>
  );
}
