
"use client";

import type { Staff } from "@/components/staff/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils"
import { masterListShellCn, masterListRowUnselectedCn, MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { MasterListRow } from "@/components/ui/master-list-row";
import { MasterListNameTooltip } from "@/components/entity/MasterListNameTooltip";
import { MasterAccountFreezeListBadge } from "@/components/masterAccountFreeze/MasterAccountFreezeListBadge";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { StaffAccountFallbackIcon } from "@/components/entity/StaffEntityIcon";
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import {
  EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { usePrewarmVisibleAttachments } from "@/hooks/usePrewarmVisibleAttachments";
import { useCompany } from "@/hooks/useCompany";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { MasterAliasSearchHint } from "@/components/entity/MasterAliasSearchHint";
import {
  compareEntityListQuickFilterSort,
  masterEntityTextMatchesSearch,
  shouldHideEntityListSettledRow,
} from "@/lib/filterMasterEntityListRows";

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
};

export function StaffList({
  staff,
  selectedStaff,
  onSelectStaff,
  searchTerm,
  pendingApprovalByStaffId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
}: {
  staff: Staff[];
  selectedStaff: Staff | null;
  onSelectStaff: (staff: Staff) => void;
  searchTerm: string;
  /** Pending approval count per staff id (only when approve notifications on list). */
  pendingApprovalByStaffId?: Record<string, number>;
  /** When provided, use Link for navigation (mobile/Capacitor) */
  getItemHref?: (staff: Staff) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
}) {
  const { formatCurrency } = useDate();
  const { company } = useCompany();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } = useMasterListRowMotion();
  const highlightSearch = searchTerm.trim();
  const filteredAndSortedStaff = useMemo(() => {
    const isSettled = (bal: number) => Math.abs(Number(bal || 0)) < 1e-6;
    return staff
      .filter((s) => {
        if (!s.name || !(masterEntityTextMatchesSearch(s.name, searchTerm) || masterEntityTextMatchesSearch((s as { aliasName?: string }).aliasName || "\u0000", searchTerm))) return false;
        const bal = Number(s.balance || 0);
        // Footer quick filters: list short/filter from same control on mobile + desktop.
        if (quickFilter === "dr") return bal > 0;
        if (quickFilter === "cr") return bal < 0;
        if (shouldHideEntityListSettledRow(bal, hideSettled, quickFilter)) return false;
        if (quickFilter === "settled") return isSettled(bal);
        if (quickFilter === "non_settled") return !isSettled(bal);
        return true;
      })
      .sort((a, b) => compareEntityListQuickFilterSort(a, b, quickFilter, undefined, lastVoucherMsById));
  }, [staff, searchTerm, quickFilter, lastVoucherMsById, hideSettled]);

  const visibleStaffAttachmentUrls = useMemo(
    () =>
      filteredAndSortedStaff
        .map((s) => trimEntityFileUrlForPreview(s.fileUrl))
        .filter((u): u is string => Boolean(u)),
    [filteredAndSortedStaff]
  );
  usePrewarmVisibleAttachments(visibleStaffAttachmentUrls, company?.id);

  const listOrderKey = useMemo(
    () => masterListOrderKey(filteredAndSortedStaff.map((s) => s.id)),
    [filteredAndSortedStaff]
  );

  const { displayRows: displayListRows, displayOrderKey } = useMasterListDisplayRows(
    filteredAndSortedStaff,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );

  return (
    <div className={masterListShellCn} data-theme-list="account-list">
      <ScrollArea
        listChrome
        className="min-h-0 min-w-0 flex-1"
        onViewportScroll={markListScrolling}
        onViewportTouchMove={markListScrolling}
      >
        <ul className="pl-master-list-ul">
          <AnimatePresence mode={animatePresenceMode}>
            {displayListRows.map((staffMember) => {
              const isSelected = selectedStaff?.id === staffMember.id;
              const href = getItemHref?.(staffMember);
              /** List hover + avatar: stale `"null"` string par PDF spinner na kholo — `trimEntityFileUrlForPreview` */
              const attachmentPreviewUrl = trimEntityFileUrlForPreview(staffMember.fileUrl);
              const cardClassName = masterListRowUnselectedCn(isSelected);
              const cardContent = (
                <div className="pl-master-list-row">
                  <div className="pl-master-list-row-leading">
                    <div className="relative flex-shrink-0">
                      <EntityFileAttachmentHover
                        fileUrl={attachmentPreviewUrl}
                        triggerClassName="inline-flex shrink-0 rounded-full"
                      >
                        <ResolvedEntityAvatar
                          className={MASTER_LIST_AVATAR_CN}
                          fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                          companyId={staffMember.companyId}
                          src={attachmentPreviewUrl ?? undefined}
                          alt={staffMember.name}
                          fallbackSlot={<StaffAccountFallbackIcon staff={staffMember} />}
                        />
                      </EntityFileAttachmentHover>
                      {(pendingApprovalByStaffId[staffMember.id] ?? 0) > 0 && (
                        <span
                          className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-pink-500 text-white text-[10px] font-bold origin-center"
                          style={{ transform: "rotate(45deg) translate(25%, -25%)" }}
                          aria-label={`${pendingApprovalByStaffId[staffMember.id]} pending approval`}
                        >
                          <span style={{ transform: "rotate(-45deg)" }}>{pendingApprovalByStaffId[staffMember.id]}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col">
                    <MasterListNameTooltip
                      measureKey={staffMember.name}
                      tooltipContent={
                        <>
                          <p>{staffMember.name}</p>
                          {(pendingApprovalByStaffId[staffMember.id] ?? 0) > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {pendingApprovalByStaffId[staffMember.id]} pending approval
                            </p>
                          )}
                        </>
                      }
                    >
                      {highlightSearch ? highlightQueryInText(staffMember.name, highlightSearch) : staffMember.name}
<MasterAliasSearchHint alias={(staffMember as { aliasName?: string }).aliasName} name={staffMember.name} search={highlightSearch} />
                    </MasterListNameTooltip>
                    {readMasterAccountFrozen(staffMember) ? (
                      <MasterAccountFreezeListBadge className="mt-0.5" />
                    ) : null}
                    </div>
                  </div>
                  <p className={cn(
                    "pl-master-list-row-amount ml-2",
                    staffMember.balance >= 0 ? "text-green-600" : "text-red-600",
                    isSelected && (staffMember.balance >= 0 ? "text-green-800" : "text-red-800")
                  )}>
                    {formatCurrency(staffMember.balance, { showDrCr: true, context: 'list' })}
                  </p>
                </div>
              );
              return (
                <motion.li key={staffMember.id} layoutDependency={displayOrderKey} {...rowMotionProps}>
                  {href ? (
                    // Master list navigation: per-row auto-prefetch off rakho to avoid repeat background bursts on revisit.
                    <Link
                      prefetch={false}
                      href={href}
                      onClick={() => onSelectStaff(staffMember)}
                      className="block min-w-0 max-w-full overflow-hidden"
                    >
                      <MasterListRow selected={isSelected} className={cardClassName}>{cardContent}</MasterListRow>
                    </Link>
                  ) : (
                    <MasterListRow selected={isSelected} className={cardClassName} onClick={() => onSelectStaff(staffMember)}>
                      {cardContent}
                    </MasterListRow>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
          {displayListRows.length === 0 && (
            <div className="text-center text-muted-foreground p-8">
              No staff members found.
            </div>
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
    </div>
  );
};
