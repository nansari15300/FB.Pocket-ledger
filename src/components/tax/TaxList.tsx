
"use client";

import type { Tax } from "@/components/tax/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Receipt } from "lucide-react";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { useRowChangeHighlight } from "@/hooks/useRowChangeHighlight";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";
import { MasterAccountFreezeListBadge } from "@/components/masterAccountFreeze/MasterAccountFreezeListBadge";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { MasterListRow } from "@/components/ui/master-list-row";
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { filterAndSortMasterEntityListRows } from "@/lib/filterMasterEntityListRows";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { masterListShellCn, masterListRowUnselectedCn, MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { MasterAliasSearchHint } from "@/components/entity/MasterAliasSearchHint";
import { plHangEnsureLongTaskObserver, plHangStart } from "@/lib/plHangDiag";

export function TaxList({ 
    taxes, 
    selectedTax, 
    onSelectTax, 
    searchTerm,
    pendingApprovalByTaxId = {},
    getItemHref,
    quickFilter: quickFilterProp,
    onQuickFilterChange,
    hideQuickFilterBar = false,
}: { 
    taxes: Tax[], 
    selectedTax: Tax | null,
    onSelectTax: (tax: Tax) => void,
    searchTerm: string,
    /** Pending approval count per tax id (only when approve notifications on list). */
    pendingApprovalByTaxId?: Record<string, number>;
    /** When provided, use Link for navigation (mobile/Capacitor) – static export ke liye query params */
    getItemHref?: (tax: Tax) => string | undefined;
    quickFilter?: EntityListQuickFilter;
    onQuickFilterChange?: (next: EntityListQuickFilter) => void;
    hideQuickFilterBar?: boolean;
}) {
  const { formatCurrency } = useDate();
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

  const filteredAndSortedTaxes = useMemo(() => {
    return filterAndSortMasterEntityListRows(taxes, searchTerm, quickFilter, {
      lastVoucherMsById,
      hideSettled,
    });
  }, [taxes, searchTerm, quickFilter, lastVoucherMsById, hideSettled]);

  const listOrderKey = useMemo(
    () => masterListOrderKey(filteredAndSortedTaxes.map((t) => t.id)),
    [filteredAndSortedTaxes]
  );

  const { displayRows: displayListRows, displayOrderKey } = useMasterListDisplayRows(
    filteredAndSortedTaxes,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );
  /** Add/edit (naya ya data change) row par ~1s highlight; sort/filter/first load par nahi. */
  const rowChangeHighlight = useRowChangeHighlight(displayListRows, { getId: (row) => row.id });

  if (displayListRows.length === 0) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className={masterListShellCn} data-theme-list="account-list">
          <div className="flex flex-1 min-h-0 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No taxes found.
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
          className="min-h-0 min-w-0 flex-1"
          onViewportScroll={markListScrolling}
          onViewportTouchMove={markListScrolling}
        >
          <ul className="pl-master-list-ul">
          <AnimatePresence mode={animatePresenceMode}>
            {displayListRows.map(tax => {
                const isSelected = selectedTax?.id === tax.id;
                const href = getItemHref?.(tax);
                const attachmentPreviewUrl = trimEntityFileUrlForPreview(tax.fileUrl);
                const cardClassName = masterListRowUnselectedCn(isSelected);
                const cardContent = (
                        <div className="pl-master-list-row">
                            <div className="pl-master-list-row-leading">
                            <div className="relative flex-shrink-0">
                              <EntityFileAttachmentHover fileUrl={attachmentPreviewUrl} triggerClassName="inline-flex shrink-0 rounded-md">
                                <ResolvedEntityAvatar
                                  className={cn(MASTER_LIST_AVATAR_CN, "text-sm")}
                                  fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                                  src={attachmentPreviewUrl ?? undefined}
                                  alt={tax.name}
                                  fallbackSlot={<Receipt className="h-4 w-4" />}
                                />
                              </EntityFileAttachmentHover>
                              <MasterListPendingBadge count={pendingApprovalByTaxId[tax.id] ?? 0} />
                            </div>
                            <div className="flex min-w-0 flex-col">
                            <MasterListNameTooltip
                              measureKey={tax.name}
                              side="right"
                              tooltipContent={
                                <>
                                  <p className="font-medium">{tax.name}</p>
                                  {(pendingApprovalByTaxId[tax.id] ?? 0) > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                      {pendingApprovalByTaxId[tax.id]} pending approval
                                    </p>
                                  )}
                                </>
                              }
                            >
                              {highlightSearch ? highlightQueryInText(tax.name, highlightSearch) : tax.name}
<MasterAliasSearchHint alias={(tax as { aliasName?: string }).aliasName} name={tax.name} search={highlightSearch} />
                            </MasterListNameTooltip>
                            {readMasterAccountFrozen(tax) ? (
                              <MasterAccountFreezeListBadge className="mt-0.5" />
                            ) : null}
                            </div>
                      </div>

                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          className={cn(
                            "pl-master-list-row-amount ml-2 border-0 bg-transparent p-0 text-left shadow-none",
                            tax.balance >= 0 ? "text-green-600" : "text-red-600",
                            isSelected && (tax.balance >= 0 ? "text-green-700" : "text-red-700")
                          )}
                        >
                          {formatCurrency(tax.balance, { showDrCr: true })}
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p className="font-medium">{formatCurrency(tax.balance, { showDrCr: true })}</p>
                        </TooltipContent>
                      </Tooltip>
                        </div>
                );
                return (
                  <motion.li key={tax.id} layoutDependency={displayOrderKey} {...rowMotionProps} className={rowChangeHighlight.highlightClassName(tax.id)}>
                    {href ? (
                      // Master list navigation: per-row auto-prefetch off rakho to avoid repeat background bursts on revisit.
                      // preventDefault: Link soft-nav + handleSelect replaceState dono mat chalao (double mount hang).
                      <Link
                        prefetch={false}
                        href={href}
                        onClick={(e) => {
                          e.preventDefault();
                          plHangEnsureLongTaskObserver();
                          const end = plHangStart("TaxList.click", {
                            id: String(tax.id || ""),
                            name: String(tax.name || ""),
                            via: "link",
                          });
                          onSelectTax(tax);
                          end();
                        }}
                        className="block min-w-0 max-w-full overflow-hidden"
                      >
                        <MasterListRow selected={isSelected} className={cardClassName}>{cardContent}</MasterListRow>
                      </Link>
                    ) : (
                      <MasterListRow
                        selected={isSelected}
                        className={cardClassName}
                        onClick={() => {
                          plHangEnsureLongTaskObserver();
                          const end = plHangStart("TaxList.click", {
                            id: String(tax.id || ""),
                            name: String(tax.name || ""),
                            via: "row",
                          });
                          onSelectTax(tax);
                          end();
                        }}
                      >
                        {cardContent}
                      </MasterListRow>
                    )}
                  </motion.li>
                );
            })}
          </AnimatePresence>
        </ul>
      </ScrollArea>
      {quickFilterFooter}
    </div>
    </TooltipProvider>
  );
};
