"use client";

import React, { useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { masterListOrderKey, useMasterListDisplayRows } from "@/hooks/useMasterListRowMotion";
import { cn } from "@/lib/utils";

type GroupListTreeNodeMotionListProps<T> = {
  items: readonly T[];
  quickFilter: EntityListQuickFilter;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  rowMotionProps: Record<string, unknown>;
  isRowAnimationEnabled: boolean;
  layoutHoldMs: number;
  getItemKey: (item: T, index: number) => string;
  getItemId: (item: T) => string | undefined;
  getItemClassName?: (item: T, index: number) => string | undefined;
  renderItem: (item: T, index: number) => React.ReactNode;
};

/** Sibling group rows inside one card — same FLIP/sort animation as nested account rows. */
export function GroupListTreeNodeMotionList<T>({
  items,
  quickFilter,
  animatePresenceMode,
  rowMotionProps,
  isRowAnimationEnabled,
  layoutHoldMs,
  getItemKey,
  getItemId,
  getItemClassName,
  renderItem,
}: GroupListTreeNodeMotionListProps<T>) {
  const getItemKeyRef = React.useRef(getItemKey);
  getItemKeyRef.current = getItemKey;
  const getItemIdRef = React.useRef(getItemId);
  getItemIdRef.current = getItemId;
  const getItemClassNameRef = React.useRef(getItemClassName);
  getItemClassNameRef.current = getItemClassName;
  const renderItemRef = React.useRef(renderItem);
  renderItemRef.current = renderItem;

  const stableGetItemKey = useCallback(
    (item: T, index: number) => getItemKeyRef.current(item, index),
    []
  );
  const stableGetItemClassName = useCallback(
    (item: T, index: number) => getItemClassNameRef.current?.(item, index),
    []
  );

  const listOrderKey = useMemo(() => {
    const ids: (string | undefined)[] = [];
    for (const item of items) ids.push(getItemIdRef.current(item));
    return `${quickFilter}|${masterListOrderKey(ids)}`;
  }, [items, quickFilter]);

  const { displayRows, displayOrderKey } = useMasterListDisplayRows(items as T[], listOrderKey, {
    enabled: isRowAnimationEnabled,
    holdMs: layoutHoldMs,
  });

  return (
    <AnimatePresence mode={animatePresenceMode}>
      {displayRows.map((item, index) => (
        <motion.li
          key={stableGetItemKey(item, index)}
          layoutDependency={displayOrderKey}
          className={cn(stableGetItemClassName(item, index))}
          {...rowMotionProps}
        >
          {renderItemRef.current(item, index)}
        </motion.li>
      ))}
    </AnimatePresence>
  );
}
