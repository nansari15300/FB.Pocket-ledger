
"use client";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MasterListRow } from "@/components/ui/master-list-row";
import { Item } from "@/components/items/types";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { Package } from "lucide-react";
import type { StockView } from "./ItemDetails";
import React, { useMemo, useState } from "react";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { TooltipProvider } from "../ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { filterAndSortMasterEntityListRows } from "@/lib/filterMasterEntityListRows"
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { masterListShellCn, masterListRowUnselectedCn, MASTER_LIST_ITEM_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { usePrewarmVisibleAttachments } from "@/hooks/usePrewarmVisibleAttachments";
import { useCompany } from "@/hooks/useCompany";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { MasterAliasSearchHint } from "@/components/entity/MasterAliasSearchHint";

interface ItemListProps {
  items: Item[];
  onSelectItem: (item: Item) => void;
  selectedItem: Item | null;
  searchTerm: string;
  stockView?: StockView;
  itemDisplayUnits: Record<string, string>;
  /** Pending approval count per item id (only when approve notifications on list). */
  pendingApprovalByItemId?: Record<string, number>;
  /** When provided, use Link for navigation (mobile/Capacitor) – static export ke liye query params */
  getItemHref?: (item: Item) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
}

/** Qty/amount row — footer Dr/Cr/settled `balance` field jaisa hi number (Party list semantically). */
function getItemRowDisplayMetrics(
  item: Item,
  stockView: StockView,
  itemDisplayUnits: Record<string, string>,
  formatCurrency: (v: number, o?: { showDrCr?: boolean }) => React.ReactNode
) {
  const conversions = (item.unitConversions || []) as any[];
  const smallestUnit =
    conversions.length > 0 ? conversions[conversions.length - 1].toUnit : ((item as any).openingBalanceUnit || "");
  const displayUnit = itemDisplayUnits[item.id] || smallestUnit || "";

  const getSmallestUnitFactor = (unit: string): number => {
    if (!unit || conversions.length === 0) return 1;
    if (unit === smallestUnit) return 1;
    let factor = 1;
    let currentUnit = unit;
    for (let i = 0; i < 10; i++) {
      const conv = conversions.find((c) => c.fromUnit === currentUnit);
      if (!conv) return 0;
      factor *= Number(conv.conversionFactor) || 1;
      currentUnit = conv.toUnit;
      if (currentUnit === smallestUnit) break;
    }
    return factor;
  };

  const displayUnitFactor = getSmallestUnitFactor(displayUnit);
  const displayQty = displayUnitFactor > 0 ? (item.stockQty || 0) / displayUnitFactor : 0;
  const displayValue = stockView === "amount" ? Number(item.balance) || 0 : displayQty;
  const isPositive = displayValue >= 0;
  const formattedDisplayValue =
    stockView === "amount" ? formatCurrency(displayValue, { showDrCr: true }) : `${displayValue.toFixed(2)}`;

  return { displayValue, displayUnit, formattedDisplayValue, isPositive };
}

type ItemListFilterRow = {
  item: Item;
  id: string;
  name?: string;
  balance: number;
  openingBalanceDate?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastEditedAt?: unknown;
  metrics: ReturnType<typeof getItemRowDisplayMetrics>;
};

export function ItemList({
  items,
  onSelectItem,
  selectedItem,
  searchTerm,
  stockView = "amount",
  itemDisplayUnits,
  pendingApprovalByItemId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
}: ItemListProps) {
  const { formatCurrency } = useDate();
  const { company } = useCompany();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } = useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;
  const quickFilterFooter = !hideQuickFilterBar ? (
    <EntityListQuickFilterBar
      active={quickFilter}
      onChange={setQuickFilter}
      hideSettled={hideSettled}
      onHideSettledChange={setHideSettled}
    />
  ) : null;
  const highlightSearch = searchTerm.trim();

  const enrichedRows: ItemListFilterRow[] = useMemo(() => {
    return (items || []).map((item) => {
      const metrics = getItemRowDisplayMetrics(item, stockView, itemDisplayUnits, formatCurrency);
      return {
        item,
        id: item.id,
        name: item.name,
        balance: metrics.displayValue,
        openingBalanceDate: item.openingBalanceDate,
        createdAt: (item as { createdAt?: unknown }).createdAt,
        updatedAt: (item as { updatedAt?: unknown }).updatedAt,
        lastEditedAt: (item as { lastEditedAt?: unknown }).lastEditedAt,
        metrics,
      };
    });
  }, [items, stockView, itemDisplayUnits, formatCurrency]);

  const filteredAndSortedRows = useMemo(() => {
    return filterAndSortMasterEntityListRows(enrichedRows, searchTerm, quickFilter, {
      lastVoucherMsById,
      hideSettled,
    }) as ItemListFilterRow[];
  }, [enrichedRows, searchTerm, quickFilter, lastVoucherMsById, hideSettled]);

  const visibleItemAttachmentUrls = useMemo(
    () =>
      filteredAndSortedRows
        .map(({ item }) => trimEntityFileUrlForPreview(item.fileUrls?.[0]))
        .filter((u): u is string => Boolean(u)),
    [filteredAndSortedRows]
  );
  usePrewarmVisibleAttachments(visibleItemAttachmentUrls, company?.id);

  const listOrderKey = useMemo(
    () => masterListOrderKey(filteredAndSortedRows.map(({ item }) => item.id)),
    [filteredAndSortedRows]
  );

  const { displayRows: displayListRows, displayOrderKey } = useMasterListDisplayRows(
    filteredAndSortedRows,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );

  if (displayListRows.length === 0) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className={masterListShellCn} data-theme-list="account-list">
          <div className="flex flex-1 min-h-[120px] items-center justify-center p-4 text-sm text-muted-foreground">
            No items found.
          </div>
          {quickFilterFooter}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className={masterListShellCn} data-theme-list="account-list">
        <ScrollArea
          listChrome
          className="min-h-0 flex-1 min-w-0"
          onViewportScroll={markListScrolling}
          onViewportTouchMove={markListScrolling}
        >
          <div className="pl-master-list-ul">
            <AnimatePresence mode={animatePresenceMode}>
              {displayListRows.map(({ item, metrics }) => {
                const isSelected = selectedItem?.id === item.id;
                const { formattedDisplayValue, isPositive, displayUnit } = metrics;

                const href = getItemHref?.(item);
                const attachmentPreviewUrl = trimEntityFileUrlForPreview(item.fileUrls?.[0]);
                const cardClassName = masterListRowUnselectedCn(isSelected);
                const cardContent = (
                  <div className="pl-master-list-row">
                    <div className="pl-master-list-row-leading">
                      <div className="relative flex-shrink-0">
                        {/* `fileUrls[0]` = master photo — hover portal list row pe pehle band tha */}
                        <EntityFileAttachmentHover
                          fileUrl={attachmentPreviewUrl}
                          triggerClassName="inline-flex shrink-0 rounded-md"
                        >
                          <ResolvedEntityAvatar
                            className={cn(MASTER_LIST_ITEM_AVATAR_CN, "text-sm")}
                            fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                            companyId={item.companyId}
                            src={attachmentPreviewUrl ?? undefined}
                            alt={item.name}
                            fallbackSlot={<Package />}
                          />
                        </EntityFileAttachmentHover>
                        <MasterListPendingBadge count={pendingApprovalByItemId[item.id] ?? 0} />
                      </div>
                      <MasterListNameTooltip
                        measureKey={item.name}
                        tooltipContent={
                          <>
                            <p>{item.name}</p>
                            {(pendingApprovalByItemId[item.id] ?? 0) > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {pendingApprovalByItemId[item.id]} pending approval
                              </p>
                            )}
                          </>
                        }
                      >
                        {highlightSearch ? highlightQueryInText(item.name, highlightSearch) : item.name}
<MasterAliasSearchHint alias={(item as { aliasName?: string }).aliasName} name={item.name} search={highlightSearch} />
                      </MasterListNameTooltip>
                    </div>
                    <div
                      className={cn(
                        "pl-master-list-row-amount flex items-baseline gap-1 font-semibold ml-2",
                        isPositive ? "text-green-600" : "text-red-600",
                        isSelected && (isPositive ? "text-green-800" : "text-red-800")
                      )}
                    >
                      {formattedDisplayValue}
                      {stockView === "qty" && <span className="text-xs">{displayUnit}</span>}
                    </div>
                  </div>
                );
                return (
                  <motion.li key={item.id} layoutDependency={displayOrderKey} {...rowMotionProps}>
                    {href ? (
                      // Master list navigation: per-row auto-prefetch off rakho to avoid repeat background bursts on revisit.
                      <Link
                        prefetch={false}
                        href={href}
                        onClick={() => onSelectItem(item)}
                        className="block min-w-0 max-w-full overflow-hidden"
                      >
                        <MasterListRow selected={isSelected} className={cardClassName}>{cardContent}</MasterListRow>
                      </Link>
                    ) : (
                      <MasterListRow selected={isSelected} className={cardClassName} onClick={() => onSelectItem(item)}>
                        {cardContent}
                      </MasterListRow>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </div>
        </ScrollArea>
        {quickFilterFooter}
      </div>
    </TooltipProvider>
  );
}
