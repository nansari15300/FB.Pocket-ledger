"use client";

import { useMemo } from "react";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { masterListOrderKey } from "@/hooks/useMasterListRowMotion";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { stampLastVoucherMsOnGroupForest } from "@/lib/masterListLastVoucherMs";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import {
  buildMasterGroupListForest,
  filterMasterGroupForest,
  flattenMasterGroupForest,
  masterGroupSearchHasVisibleResults,
  sortMasterGroupTreeNodes,
  splitMasterGroupForestByBranch,
  type MasterGroupListConfig,
  type MasterGroupListRow,
} from "@/lib/masterGroupListTree";

export function useMasterGroupListForest<G extends MasterGroupListRow>({
  groups,
  config,
  searchTerm,
  quickFilter,
  groupMembersByGroupId,
  visibleGroupFilter,
}: {
  groups: G[];
  config: MasterGroupListConfig;
  searchTerm: string;
  quickFilter: EntityListQuickFilter;
  groupMembersByGroupId: Record<string, { id?: string; name?: string }[]>;
  visibleGroupFilter: (group: G) => boolean;
}) {
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const visibleGroups = useMemo(
    () => (groups || []).filter(visibleGroupFilter),
    [groups, visibleGroupFilter]
  );

  const forest = useMemo(() => {
    const raw = buildMasterGroupListForest(visibleGroups, config);
    const filtered = filterMasterGroupForest(
      raw,
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
    return sortMasterGroupTreeNodes(filtered, quickFilter, stamped);
  }, [visibleGroups, config, searchTerm, quickFilter, groupMembersByGroupId, lastVoucherMsById, hideSettled]);

  const branchForests = useMemo(
    () => splitMasterGroupForestByBranch(forest, config, visibleGroups),
    [forest, config, visibleGroups]
  );

  const searchHasVisibleResults = useMemo(
    () =>
      masterGroupSearchHasVisibleResults(
        config,
        branchForests,
        searchTerm,
        groupMembersByGroupId
      ),
    [config, branchForests, searchTerm, groupMembersByGroupId]
  );

  const displayOrderKey = useMemo(
    () =>
      `${quickFilter}|${masterListOrderKey(flattenMasterGroupForest(forest).map((n) => n.group.id))}`,
    [forest, quickFilter]
  );

  return { forest, visibleGroups, displayOrderKey, searchHasVisibleResults };
}
