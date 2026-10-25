
"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Users, Lock } from "lucide-react";
import type { ExpenseGroup, ExpenseAccount } from "@/components/expenses/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { TooltipProvider } from "../ui/tooltip";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { isSystemParentGroup } from "@/lib/system-groups";
import { masterListShellCn } from "@/lib/masterListChrome";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import { ExpenseGroupNestedListBody } from "@/components/expenses/ExpenseGroupNestedListBody";
import {
  buildExpenseGroupForest,
  filterExpenseGroupForest,
  flattenExpenseGroupForest,
  sortExpenseGroupTreeNodes,
} from "@/lib/expenseGroupTree";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { stampLastVoucherMsOnGroupForest } from "@/lib/masterListLastVoucherMs";

export function ExpenseGroupList({
  groups,
  searchTerm,
  selectedGroup,
  onSelectGroup,
  collapsible = true,
  disabled = false,
  pendingApprovalByGroupId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
  groupMembersByGroupId = {},
  selectedGroupMemberFilterId = null,
  pendingApprovalByMemberId = {},
  moveAccountsEnabled = true,
  onMoveAccountToGroup,
  onMoveGroupToGroup,
  canMoveGroup,
  allGroupsForMove,
}: {
  groups: ExpenseGroup[];
  searchTerm: string;
  selectedGroup: ExpenseGroup | null;
  onSelectGroup: (group: ExpenseGroup, options?: GroupListSelectOptions) => void;
  collapsible?: boolean;
  disabled?: boolean;
  pendingApprovalByGroupId?: Record<string, number>;
  getItemHref?: (group: ExpenseGroup) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  groupMembersByGroupId?: Record<string, ExpenseAccount[]>;
  selectedGroupMemberFilterId?: string | null;
  pendingApprovalByMemberId?: Record<string, number>;
  moveAccountsEnabled?: boolean;
  onMoveAccountToGroup?: (account: ExpenseAccount, targetGroupId: string) => void | Promise<void>;
  onMoveGroupToGroup?: (sourceGroupId: string, targetGroupId: string) => void | Promise<void>;
  canMoveGroup?: (group: ExpenseGroup) => boolean;
  allGroupsForMove?: ExpenseGroup[];
}) {
  void collapsible;
  const { formatCurrency } = useDate();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const visibleGroups = useMemo(() => {
    return (groups || []).filter((group) => {
      const isReportOnly = (group as any).isReportOnly === true;
      const isSystem =
        (group as any).isSystemReserved === true ||
        isSystemParentGroup("expense_groups", (group as any).id);
      if (isReportOnly || isSystem) return false;
      return !!group.name;
    });
  }, [groups]);

  const groupForest = useMemo(() => {
    const forest = buildExpenseGroupForest(visibleGroups);
    const filtered = filterExpenseGroupForest(
      forest,
      searchTerm,
      quickFilter,
      groupMembersByGroupId,
      hideSettled
    );
    const stamped = stampLastVoucherMsOnGroupForest(
      filtered,
      lastVoucherMsById,
      groupMembersByGroupId
    );
    return sortExpenseGroupTreeNodes(filtered, quickFilter, stamped);
  }, [visibleGroups, searchTerm, quickFilter, groupMembersByGroupId, lastVoucherMsById, hideSettled]);

  const flatForCount = useMemo(
    () => flattenExpenseGroupForest(groupForest),
    [groupForest]
  );

  const listOrderKey = useMemo(
    () => masterListOrderKey(flatForCount.map((n) => n.group.id)),
    [flatForCount]
  );

  const renderLeading = (isSystem: boolean) => (
    <MasterListGroupIcon>
      {isSystem ? <Lock className="h-4 w-4" /> : <Users className="h-4 w-4" />}
    </MasterListGroupIcon>
  );

  const displayOrderKey = useMemo(
    () => `${quickFilter}|${listOrderKey}`,
    [quickFilter, listOrderKey]
  );

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div className={cn(masterListShellCn, disabled && "pointer-events-none opacity-60")}>
        <ScrollArea
          listChrome
          className="min-h-0 min-w-0 w-full flex-1"
          onViewportScroll={markListScrolling}
          onViewportTouchMove={markListScrolling}
        >
          <ul className="pl-master-list-ul w-full">
            <ExpenseGroupNestedListBody
              forest={groupForest}
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
              renderGroupLeading={(group) => renderLeading(Boolean((group as any).isSystemReserved))}
              moveAccountsEnabled={moveAccountsEnabled && !disabled}
              onMoveAccountToGroup={onMoveAccountToGroup}
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
