
"use client";

import type { Party } from "@/components/party/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils"
import { masterListShellCn, masterListRowUnselectedCn, MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import { MasterListNameTooltip, masterListNameMeasureProps } from "@/components/entity/MasterListNameTooltip";
import { MasterAccountFreezeListBadge } from "@/components/masterAccountFreeze/MasterAccountFreezeListBadge";
import { readMasterAccountFrozen } from "@/lib/masterAccountFreeze/types";
import { TooltipProvider } from "../ui/tooltip";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows, useMasterListRowMotion } from "@/hooks/useMasterListRowMotion";
import { useRowChangeHighlight } from "@/hooks/useRowChangeHighlight";
import { MasterListRow } from "@/components/ui/master-list-row";
import React, { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { EntityListQuickFilterBar,
  type EntityListQuickFilter,
} from "@/components/entity/EntityListQuickFilterBar";
import { usePrewarmVisibleAttachments } from "@/hooks/usePrewarmVisibleAttachments";
import { useCompany } from "@/hooks/useCompany";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { shouldHideEntityListSettledRow } from "@/lib/filterMasterEntityListRows";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { MasterAliasSearchHint } from "@/components/entity/MasterAliasSearchHint";
import { getInterCompanyPartyListTitleLines, isInterCompanyPartyListAccount } from "@/lib/interCompany/interCompanyCounterpartyPartyName";
import {
  icPartyListFlatSecondaryLabel,
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";
import { sortIcMemberParties, sortPartyListRows } from "@/lib/interCompany/partyListRowSort";
import { partyListRowMatchesSearch } from "@/lib/interCompany/partyListRowSearch";
import { MasterListChromeChevronToggle } from "@/components/layout/MasterListChromeChevronToggle";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";
import { toggleGroupListAccordionExpand } from "@/lib/groupListExpand";

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
};

type IcCompanyChildRowsProps = {
  companyParty: Party;
  members: Party[];
  quickFilter: EntityListQuickFilter;
  selectedParty: Party | null;
  selectedIcMemberAccountId: string | null;
  onSelectMember: (memberId: string) => void;
  pendingApprovalByPartyId: Record<string, number>;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  rowMotionProps: React.ComponentProps<typeof motion.div>;
  isRowAnimationEnabled: boolean;
  layoutHoldMs: number;
  renderCardContent: (
    rowParty: Party,
    rowTitleLines: { primary: string; secondary?: string | null },
    rowBalance: number,
    rowPendingCount: number,
    expandControl?: React.ReactNode
  ) => React.ReactNode;
  renderRowShell: (
    rowSelected: boolean,
    onClick: () => void,
    content: React.ReactNode,
    rowHref?: string,
    rowIcProps?: { "data-pl-ic-company-row": "" }
  ) => React.ReactNode;
  icCompanyRowProps?: { "data-pl-ic-company-row": "" };
};

function IcCompanyChildRows({
  companyParty,
  members,
  quickFilter,
  selectedParty,
  selectedIcMemberAccountId,
  onSelectMember,
  pendingApprovalByPartyId,
  animatePresenceMode,
  rowMotionProps,
  isRowAnimationEnabled,
  layoutHoldMs,
  renderCardContent,
  renderRowShell,
  icCompanyRowProps,
}: IcCompanyChildRowsProps) {
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const sortedMembers = useMemo(() => {
    const visible = members.filter(
      (member) => !shouldHideEntityListSettledRow(member.balance, hideSettled, quickFilter)
    );
    return sortIcMemberParties(visible, quickFilter, lastVoucherMsById);
  }, [members, quickFilter, lastVoucherMsById, hideSettled]);
  const sortedOrderKey = useMemo(
    () => masterListOrderKey(sortedMembers.map((member) => member.id)),
    [sortedMembers]
  );
  const { displayRows: displayChildRows, displayOrderKey: childDisplayOrderKey } =
    useMasterListDisplayRows(sortedMembers, sortedOrderKey, {
      enabled: isRowAnimationEnabled,
      holdMs: layoutHoldMs,
    });

  return (
    <div className="flex flex-col gap-1">
      <AnimatePresence mode={animatePresenceMode}>
        {displayChildRows.map((member) => {
          const memberSelected =
            selectedParty?.id === companyParty.id && selectedIcMemberAccountId === member.id;
          const memberTitle = interCompanyClearingAccountDisplayName(member);
          const memberPending = pendingApprovalByPartyId[member.id] ?? 0;
          const memberContent = renderCardContent(
            member,
            {
              primary: memberTitle,
              secondary: icPartyListFlatSecondaryLabel(companyParty.name || ""),
            },
            Number(member.balance || 0),
            memberPending
          );
          return (
            <motion.div
              key={member.id}
              layoutDependency={childDisplayOrderKey}
              className="pl-[10px]"
              {...rowMotionProps}
            >
              {renderRowShell(
                memberSelected,
                () => onSelectMember(member.id),
                memberContent,
                undefined,
                icCompanyRowProps
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export type PartyListSelectOptions = { icMemberAccountId?: string | null };

export const PartyList = React.memo(({
  parties,
  selectedParty,
  onSelectParty,
  selectedIcMemberAccountId = null,
  searchTerm,
  topPartyId,
  overdueVoucherCount,
  pendingApprovalByPartyId = {},
  getItemHref,
  quickFilter: quickFilterProp,
  onQuickFilterChange,
  hideQuickFilterBar = false,
  resolvePartyTitleLines,
  emptyLabel = "No parties found.",
}: {
  parties: Party[];
  selectedParty: Party | null;
  onSelectParty: (party: Party, options?: PartyListSelectOptions) => void;
  /** IC company child account filter — null = company-wide ledger. */
  selectedIcMemberAccountId?: string | null;
  searchTerm: string;
  /** When set, the party with this id is always shown first (e.g. Overdue Vouchers). */
  topPartyId?: string;
  /** When set and party is the top (Overdue Vouchers), show "X vouchers" instead of balance. */
  overdueVoucherCount?: number;
  /** Pending approval count per party id (only passed when approve notifications on list). */
  pendingApprovalByPartyId?: Record<string, number>;
  /** When provided, use Link for navigation (mobile/Capacitor) – ensures details page opens reliably */
  getItemHref?: (party: Party) => string | undefined;
  quickFilter?: EntityListQuickFilter;
  onQuickFilterChange?: (next: EntityListQuickFilter) => void;
  hideQuickFilterBar?: boolean;
  /** Admin subscribers etc. — primary name + secondary email under title. */
  resolvePartyTitleLines?: (party: Party) => { primary: string; secondary?: string | null };
  emptyLabel?: string;
}) => {
  const { formatCurrency } = useDate();
  const { company } = useCompany();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled, setHideSettled } = useEntityListHideSettled();
  const { animatePresenceMode, rowMotionProps, markListScrolling, isRowAnimationEnabled, layoutHoldMs } = useMasterListRowMotion();
  const [internalQuickFilter, setInternalQuickFilter] = useState<EntityListQuickFilter>("latest");
  const quickFilter = quickFilterProp ?? internalQuickFilter;
  const setQuickFilter = onQuickFilterChange ?? setInternalQuickFilter;
  const highlightSearch = searchTerm.trim();
  const [expandedIcCompanyId, setExpandedIcCompanyId] = useState<string | null>(null);

  const toggleIcCompanyExpanded = useCallback((companyId: string) => {
    setExpandedIcCompanyId((prev) => toggleGroupListAccordionExpand(prev, companyId));
  }, []);

  const filteredAndSortedParties = useMemo(() => {
    const isSettled = (bal: number) => Math.abs(Number(bal || 0)) < 1e-6;
    const list = parties || [];
    const filterFn = (party: Party) => {
      const isSystemAccount = (party as any).isSystemAccount === true;
      if (!partyListRowMatchesSearch(party, searchTerm) || isSystemAccount) return false;
      const bal = Number(party.balance || 0);
      // Footer quick filters: list short/filter from same control on mobile + desktop.
      if (quickFilter === "dr") return bal > 0;
      if (quickFilter === "cr") return bal < 0;
      if (shouldHideEntityListSettledRow(bal, hideSettled, quickFilter)) return false;
      if (quickFilter === "settled") return isSettled(bal);
      if (quickFilter === "non_settled") return !isSettled(bal);
      return true;
    };
    const pinned = topPartyId ? list.filter((p) => p.id === topPartyId && filterFn(p)) : [];
    const rest = topPartyId ? list.filter((p) => p.id !== topPartyId) : list;
    const filteredRest = sortPartyListRows(rest.filter(filterFn), quickFilter, lastVoucherMsById);
    return [...pinned, ...filteredRest];
  }, [parties, searchTerm, topPartyId, quickFilter, lastVoucherMsById, hideSettled]);

  const visiblePartyAttachmentUrls = useMemo(
    () =>
      filteredAndSortedParties
        .map((party) => trimEntityFileUrlForPreview(party.fileUrl))
        .filter((u): u is string => Boolean(u)),
    [filteredAndSortedParties]
  );
  usePrewarmVisibleAttachments(visiblePartyAttachmentUrls, company?.id);

  const listOrderKey = useMemo(
    () => masterListOrderKey(filteredAndSortedParties.map((p) => p.id)),
    [filteredAndSortedParties]
  );

  const { displayRows: displayListRows, displayOrderKey } = useMasterListDisplayRows(
    filteredAndSortedParties,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );
  /** Add/edit (naya ya data change) row par ~1s highlight; sort/filter/first load par nahi. */
  const rowChangeHighlight = useRowChangeHighlight(displayListRows, { getId: (row) => row.id });

  // यदि कुनै पार्टी भेटिएन भने
  if (displayListRows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground bg-background rounded-b-lg border-t-0">
        {emptyLabel}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* min-w-0: grid 25% column bhitra ScrollArea overflow — lamba naam failaaundaina */}
      <div className={masterListShellCn} data-theme-list="account-list">
        <ScrollArea
          listChrome
          className="min-h-0 min-w-0 flex-1"
          onViewportScroll={markListScrolling}
          onViewportTouchMove={markListScrolling}
        >
          <ul className="pl-master-list-ul">
            <AnimatePresence mode={animatePresenceMode}>
              {displayListRows.map((party) => {
                const isIcPeerCompanyGroup = Boolean(
                  (party as Party & { isIcPeerCompanyGroup?: boolean }).isIcPeerCompanyGroup
                );
                const isIcClearingAccount = isInterCompanyPartyListAccount(party);
                const isMainSelected =
                  selectedParty?.id === party.id &&
                  (!selectedIcMemberAccountId || isIcClearingAccount);
                const href = getItemHref?.(party);
                const attachmentPreviewUrl = trimEntityFileUrlForPreview(party.fileUrl);
                const titleLines = resolvePartyTitleLines
                  ? resolvePartyTitleLines(party)
                  : isIcPeerCompanyGroup
                    ? icPeerCompanyGroupListTitleLines(party)
                    : isIcClearingAccount
                      ? {
                          primary: interCompanyClearingAccountDisplayName(party),
                          secondary: icPartyListFlatSecondaryLabel(
                            party.interCompanyPeerCompanyName || ""
                          ),
                        }
                      : getInterCompanyPartyListTitleLines(party);
                const pendingApprovalCount =
                  (party.icMemberParties?.reduce(
                    (sum, member) => sum + (pendingApprovalByPartyId[member.id] ?? 0),
                    0
                  ) ?? 0) || (pendingApprovalByPartyId[party.id] ?? 0);
                const isExpanded = isIcPeerCompanyGroup && expandedIcCompanyId === party.id;
                const icMemberParties = party.icMemberParties ?? [];

                const renderCardContent = (
                  rowParty: Party,
                  rowTitleLines: { primary: string; secondary?: string | null },
                  rowBalance: number,
                  rowPendingCount: number,
                  expandControl?: React.ReactNode
                ) => {
                  const rowIsIcPeerGroup = Boolean(
                    (rowParty as Party & { isIcPeerCompanyGroup?: boolean }).isIcPeerCompanyGroup
                  );
                  const rowIsIcClearingFlat =
                    isInterCompanyPartyListAccount(rowParty) && !rowIsIcPeerGroup;

                  const amountClassName = cn(
                    "pl-master-list-row-amount",
                    rowIsIcClearingFlat ? "ml-0 shrink-0" : "ml-2",
                    topPartyId && rowParty.id === topPartyId && overdueVoucherCount != null
                      ? "text-muted-foreground"
                      : rowBalance >= 0
                        ? "text-green-600"
                        : "text-red-600"
                  );
                  const amountText =
                    topPartyId && rowParty.id === topPartyId && overdueVoucherCount != null
                      ? `${overdueVoucherCount} voucher${overdueVoucherCount === 1 ? "" : "s"}`
                      : formatCurrency(rowBalance, { showDrCr: true });

                  const avatarBlock = (
                    <div className="relative flex-shrink-0">
                      <EntityFileAttachmentHover
                        fileUrl={trimEntityFileUrlForPreview(rowParty.fileUrl)}
                        triggerClassName="inline-flex h-full w-full shrink-0 rounded-lg"
                      >
                        <ResolvedEntityAvatar
                          className={MASTER_LIST_AVATAR_CN}
                          fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                          companyId={rowParty.companyId}
                          src={trimEntityFileUrlForPreview(rowParty.fileUrl) ?? undefined}
                          alt={rowTitleLines.primary}
                          fallbackText={getInitials(rowTitleLines.primary)}
                        />
                      </EntityFileAttachmentHover>
                      <MasterListPendingBadge count={rowPendingCount} />
                    </div>
                  );

                  if (rowIsIcClearingFlat) {
                    return (
                      <div className="pl-master-list-row grid-cols-1">
                        <div className="pl-master-list-row-leading items-start">
                          {avatarBlock}
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                            <div className="flex min-w-0 w-full items-start justify-between gap-2">
                              <MasterListNameTooltip
                                measureKey={`${rowTitleLines.primary}|${rowTitleLines.secondary ?? ""}`}
                                className="min-w-0 flex-1"
                                tooltipContent={
                                  <>
                                    <p className="font-medium">{rowTitleLines.primary}</p>
                                    {rowTitleLines.secondary ? (
                                      <p className="text-xs text-muted-foreground">
                                        {rowTitleLines.secondary}
                                      </p>
                                    ) : null}
                                    {rowPendingCount > 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        {rowPendingCount} pending approval
                                      </p>
                                    )}
                                  </>
                                }
                              >
                                <span
                                  {...masterListNameMeasureProps()}
                                  className="block min-w-0 truncate text-left"
                                >
                                  {highlightSearch
                                    ? highlightQueryInText(rowTitleLines.primary, highlightSearch)
                                    : rowTitleLines.primary}
                                </span>
                                <MasterAliasSearchHint alias={(party as { aliasName?: string }).aliasName} name={rowTitleLines.primary} search={highlightSearch} />
                              </MasterListNameTooltip>
                              <p className={amountClassName}>{amountText}</p>
                            </div>
                            {rowTitleLines.secondary ? (
                              <span
                                {...masterListNameMeasureProps(
                                  "min-w-0 text-left text-[11px] font-normal leading-tight text-muted-foreground"
                                )}
                              >
                                {highlightSearch
                                  ? highlightQueryInText(rowTitleLines.secondary, highlightSearch)
                                  : rowTitleLines.secondary}
                              </span>
                            ) : null}
                            {readMasterAccountFrozen(rowParty) ? (
                              <MasterAccountFreezeListBadge className="mt-0.5" />
                            ) : null}
                          </div>
                          {expandControl ? (
                            <div className="ml-auto shrink-0 self-center pl-1">{expandControl}</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  return (
                  <div className="pl-master-list-row">
                    <div className="pl-master-list-row-leading">
                      {avatarBlock}
                      <div className="flex min-w-0 flex-1 items-start gap-0.5 overflow-hidden">
                        <MasterListNameTooltip
                          measureKey={`${rowTitleLines.primary}|${rowTitleLines.secondary ?? ""}`}
                          className={cn(
                            "min-w-0 flex-1",
                            rowTitleLines.secondary && "items-start py-0.5"
                          )}
                          tooltipContent={
                            <>
                              <p className="font-medium">{rowTitleLines.primary}</p>
                              {rowTitleLines.secondary ? (
                                <p className="text-xs text-muted-foreground">{rowTitleLines.secondary}</p>
                              ) : null}
                              {rowPendingCount > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {rowPendingCount} pending approval
                                </p>
                              )}
                            </>
                          }
                        >
                          <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
                            <span {...masterListNameMeasureProps()}>
                              {highlightSearch
                                ? highlightQueryInText(rowTitleLines.primary, highlightSearch)
                                : rowTitleLines.primary}
                            </span>
                            <MasterAliasSearchHint alias={(party as { aliasName?: string }).aliasName} name={rowTitleLines.primary} search={highlightSearch} />
                            {rowTitleLines.secondary ? (
                              <span
                                {...masterListNameMeasureProps(
                                  "text-[11px] font-normal leading-tight text-muted-foreground"
                                )}
                              >
                                {highlightSearch
                                  ? highlightQueryInText(rowTitleLines.secondary, highlightSearch)
                                  : rowTitleLines.secondary}
                              </span>
                            ) : null}
                            {readMasterAccountFrozen(rowParty) ? (
                              <MasterAccountFreezeListBadge className="mt-0.5" />
                            ) : null}
                          </span>
                        </MasterListNameTooltip>
                        {expandControl ? (
                          <div className="ml-auto shrink-0 self-center pl-1">{expandControl}</div>
                        ) : null}
                      </div>
                    </div>
                    <p className={amountClassName}>{amountText}</p>
                  </div>
                  );
                };

                const expandControl = isIcPeerCompanyGroup ? (
                  <MasterListChromeChevronToggle
                    variant="row"
                    expanded={isExpanded}
                    ariaLabelWhenExpanded="Collapse accounts"
                    ariaLabelWhenCollapsed="Expand accounts"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleIcCompanyExpanded(party.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                ) : null;

                const cardContent = renderCardContent(
                  party,
                  titleLines,
                  Number(party.balance || 0),
                  pendingApprovalCount,
                  expandControl
                );
                const cardClassName = masterListRowUnselectedCn(isMainSelected);
                const icCompanyRowProps =
                  isIcPeerCompanyGroup || isIcClearingAccount
                    ? ({ "data-pl-ic-company-row": "" } as const)
                    : {};

                const renderRowShell = (
                  rowSelected: boolean,
                  onClick: () => void,
                  content: React.ReactNode,
                  rowHref?: string,
                  rowIcProps?: typeof icCompanyRowProps
                ) => {
                  const rowClassName = masterListRowUnselectedCn(rowSelected);
                  if (rowHref) {
                    return (
                      <Link
                        prefetch={false}
                        href={rowHref}
                        onClick={onClick}
                        className="block min-w-0 max-w-full overflow-hidden"
                      >
                        <MasterListRow selected={rowSelected} className={rowClassName} {...rowIcProps}>
                          {content}
                        </MasterListRow>
                      </Link>
                    );
                  }
                  return (
                    <MasterListRow
                      selected={rowSelected}
                      className={rowClassName}
                      onClick={onClick}
                      {...rowIcProps}
                    >
                      {content}
                    </MasterListRow>
                  );
                };

                return (
                  <motion.li key={party.id} layoutDependency={displayOrderKey} {...rowMotionProps} className={rowChangeHighlight.highlightClassName(party.id)}>
                    {isIcPeerCompanyGroup && isExpanded ? (
                      <div data-pl-ic-company-group="">
                        {renderRowShell(
                          isMainSelected,
                          () => onSelectParty(party, { icMemberAccountId: null }),
                          cardContent,
                          href,
                          icCompanyRowProps
                        )}
                        <IcCompanyChildRows
                          companyParty={party}
                          members={icMemberParties}
                          quickFilter={quickFilter}
                          selectedParty={selectedParty}
                          selectedIcMemberAccountId={selectedIcMemberAccountId}
                          onSelectMember={(memberId) =>
                            onSelectParty(party, { icMemberAccountId: memberId })
                          }
                          pendingApprovalByPartyId={pendingApprovalByPartyId}
                          animatePresenceMode={animatePresenceMode}
                          rowMotionProps={rowMotionProps}
                          isRowAnimationEnabled={isRowAnimationEnabled}
                          layoutHoldMs={layoutHoldMs}
                          renderCardContent={renderCardContent}
                          renderRowShell={renderRowShell}
                          icCompanyRowProps={{ "data-pl-ic-company-row": "" }}
                        />
                      </div>
                    ) : (
                      renderRowShell(
                        isMainSelected,
                        () => onSelectParty(party, { icMemberAccountId: null }),
                        cardContent,
                        href,
                        icCompanyRowProps
                      )
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
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
    </TooltipProvider>
  );
});

PartyList.displayName = 'PartyList';
