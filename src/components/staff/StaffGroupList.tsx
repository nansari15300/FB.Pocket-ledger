
"use client";

import type { StaffGroup, Staff } from "@/components/staff/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { TooltipProvider } from "../ui/tooltip";
import { useMemo, useState } from "react";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { filterAndSortEntityGroups } from "@/lib/entityGroupListQuickFilter";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { stampLastVoucherMsFromMemberGroups } from "@/lib/masterListLastVoucherMs";
import { motion } from "framer-motion";
import { isSystemParentGroup } from "@/lib/system-groups";
import { masterListShellCn } from "@/lib/masterListChrome";
import type { GroupListSelectOptions } from "@/lib/groupListExpand";
import { MasterGroupExpandableListBody } from "@/components/entity/MasterGroupExpandableListBody";

export function StaffGroupList({
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
}: {
  groups: StaffGroup[];
  searchTerm: string;
  selectedGroup: StaffGroup | null;
  onSelectGroup: (group: StaffGroup, options?: GroupListSelectOptions) => void;
  pendingApprovalByGroupId?: Record<string, number>;
  getItemHref?: (group: StaffGroup) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  groupMembersByGroupId?: Record<string, Staff[]>;
  selectedGroupMemberFilterId?: string | null;
  pendingApprovalByMemberId?: Record<string, number>;
}) {
  const { formatCurrency } = useDate();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } =
    useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;

  const filteredAndSortedGroups = useMemo(() => {
    const base = groups.filter((group) => {
      const isReportOnly = (group as any).isReportOnly === true;
      const isSystemParent =
        (group as any).isSystemReserved === true ||
        isSystemParentGroup("staff_groups", (group as any).id);
      if (isReportOnly || isSystemParent) return false;
      return !!group.name;
    });
    return filterAndSortEntityGroups(
      base,
      searchTerm,
      quickFilter,
      stampLastVoucherMsFromMemberGroups(lastVoucherMsById, groupMembersByGroupId),
      hideSettled
    );
  }, [groups, searchTerm, quickFilter, lastVoucherMsById, groupMembersByGroupId, hideSettled]);

  const listOrderKey = useMemo(
    () => masterListOrderKey(filteredAndSortedGroups.map((g) => g.id)),
    [filteredAndSortedGroups]
  );

  const { displayRows: displayListRows, displayOrderKey } = useMasterListDisplayRows(
    filteredAndSortedGroups,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );

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
            <MasterGroupExpandableListBody
              displayListRows={displayListRows}
              displayOrderKey={displayOrderKey}
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
              expandAriaLabel="staff"
              formatCurrency={formatCurrency}
            />
            {displayListRows.length === 0 && (
              <div className="text-center text-muted-foreground p-8">No staff groups found.</div>
            )}
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
