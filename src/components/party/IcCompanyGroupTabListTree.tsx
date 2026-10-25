"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { MasterListChromeChevronToggle } from "@/components/layout/MasterListChromeChevronToggle";
import { motion, AnimatePresence } from "framer-motion";
import type { Party, Group } from "@/components/party/types";
import type { EntityListQuickFilter } from "@/components/entity/EntityListQuickFilterBar";
import { MasterListRow } from "@/components/ui/master-list-row";
import { MasterListNameTooltip, masterListNameMeasureProps } from "@/components/entity/MasterListNameTooltip";
import { cn } from "@/lib/utils";
import { masterListRowUnselectedCn, MASTER_LIST_AVATAR_CN, MASTER_LIST_AVATAR_FALLBACK_CN } from "@/lib/masterListChrome";
import { useDate } from "@/hooks/useDate";
import { masterListOrderKey, useMasterListDisplayRows } from "@/hooks/useMasterListRowMotion";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { MasterListGroupIcon } from "@/components/entity/MasterListGroupIcon";
import {
  icPeerCompanyGroupListTitleLines,
  interCompanyClearingAccountDisplayName,
} from "@/lib/interCompany/icPeerCompanyGroups";
import { sortIcMemberParties, sortPartyListRows } from "@/lib/interCompany/partyListRowSort";
import {
  icPeerListExpandKey,
  isIcListLevel1Expanded,
  parseIcPeerListExpandKey,
  toggleGroupListAccordionExpand,
} from "@/lib/groupListExpand";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { useLastVoucherMsByEntityId } from "@/hooks/useLastVoucherMsByEntityId";
import { useEntityListHideSettled } from "@/components/entity/entityListHideSettled";
import { shouldHideEntityListSettledRow } from "@/lib/filterMasterEntityListRows";

const getInitials = (name: string) => {
  if (!name) return "NA";
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
};

export type IcCompanyGroupTabSelectOptions = {
  peerCompanyId?: string | null;
  memberAccountId?: string | null;
};

type CardContentRenderer = (
  primary: string,
  secondary: string | null,
  balance: number,
  pendingCount: number,
  avatarFallback: string,
  fileUrl?: string | null,
  companyId?: string,
  expandControl?: React.ReactNode,
  leadingIcon?: React.ReactNode,
  compactPrimary?: boolean
) => React.ReactNode;

type RowShellRenderer = (
  rowSelected: boolean,
  onClick: () => void,
  content: React.ReactNode,
  rowHref?: string
) => React.ReactNode;

type IcCompanyGroupTabListTreeProps = {
  group: Group;
  icPeerCompanyRows: Party[];
  selectedGroup: Group | null;
  selectedIcPeerCompanyId: string | null;
  selectedIcMemberAccountId: string | null;
  onSelect: (options: IcCompanyGroupTabSelectOptions) => void;
  quickFilter: EntityListQuickFilter;
  pendingApprovalByGroupId?: Record<string, number>;
  pendingApprovalByPartyId?: Record<string, number>;
  getItemHref?: (group: Group) => string | undefined;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  rowMotionProps: React.ComponentProps<typeof motion.div>;
  isRowAnimationEnabled: boolean;
  layoutHoldMs: number;
  /** List-level accordion — coordinates with sibling group rows in PartyGroupList. */
  expandedListNodeId?: string | null;
  onExpandedListNodeIdChange?: (next: string | null) => void;
  searchTerm?: string;
  onFocusGroup?: () => void;
};

export function IcCompanyGroupTabListTree({
  group,
  icPeerCompanyRows,
  selectedGroup,
  selectedIcPeerCompanyId,
  selectedIcMemberAccountId,
  onSelect,
  quickFilter,
  pendingApprovalByGroupId = {},
  pendingApprovalByPartyId = {},
  getItemHref,
  animatePresenceMode,
  rowMotionProps,
  isRowAnimationEnabled,
  layoutHoldMs,
  expandedListNodeId: expandedListNodeIdProp,
  onExpandedListNodeIdChange,
  searchTerm = "",
  onFocusGroup,
}: IcCompanyGroupTabListTreeProps) {
  const { formatCurrency } = useDate();
  const lastVoucherMsById = useLastVoucherMsByEntityId();
  const { hideSettled } = useEntityListHideSettled();
  const highlightQuery = searchTerm.trim();
  const icCompanyRowProps = { "data-pl-ic-company-row": "" } as const;
  const href = getItemHref?.(group);

  const isLevel1Selected =
    selectedGroup?.id === group.id && !selectedIcPeerCompanyId && !selectedIcMemberAccountId;

  const [internalExpandedListNodeId, setInternalExpandedListNodeId] = useState<string | null>(
    null
  );
  const isListAccordionControlled = onExpandedListNodeIdChange != null;
  const expandedListNodeId = isListAccordionControlled
    ? (expandedListNodeIdProp ?? null)
    : internalExpandedListNodeId;

  const level1Expanded = isIcListLevel1Expanded(expandedListNodeId, group.id);
  const expandedPeerCompanyId = parseIcPeerListExpandKey(expandedListNodeId);

  const toggleLevel1 = useCallback(() => {
    const next = level1Expanded ? null : group.id;
    if (!level1Expanded) {
      onFocusGroup?.();
    }
    if (isListAccordionControlled) {
      onExpandedListNodeIdChange?.(next);
    } else {
      setInternalExpandedListNodeId(next);
    }
  }, [
    group.id,
    isListAccordionControlled,
    level1Expanded,
    onExpandedListNodeIdChange,
    onFocusGroup,
  ]);

  const togglePeerCompany = useCallback(
    (peerCompanyId: string) => {
      const peerKey = icPeerListExpandKey(peerCompanyId);
      const next =
        expandedPeerCompanyId === peerCompanyId
          ? group.id
          : toggleGroupListAccordionExpand(expandedListNodeId, peerKey);
      if (isListAccordionControlled) {
        onExpandedListNodeIdChange?.(next);
      } else {
        setInternalExpandedListNodeId(next);
      }
    },
    [
      expandedListNodeId,
      expandedPeerCompanyId,
      group.id,
      isListAccordionControlled,
      onExpandedListNodeIdChange,
    ]
  );

  const sortedPeerCompanies = useMemo(
    () =>
      sortPartyListRows(
        icPeerCompanyRows.filter(
          (row) => !shouldHideEntityListSettledRow(row.balance, hideSettled, quickFilter)
        ),
        quickFilter,
        lastVoucherMsById
      ),
    [icPeerCompanyRows, quickFilter, lastVoucherMsById, hideSettled]
  );
  const peerOrderKey = useMemo(
    () => masterListOrderKey(sortedPeerCompanies.map((row) => row.id)),
    [sortedPeerCompanies]
  );
  const { displayRows: displayPeerRows, displayOrderKey: peerDisplayOrderKey } =
    useMasterListDisplayRows(sortedPeerCompanies, peerOrderKey, {
      enabled: isRowAnimationEnabled,
      holdMs: layoutHoldMs,
    });

  const level1Pending = pendingApprovalByGroupId[group.id] ?? 0;
  const level1Secondary =
    icPeerCompanyRows.length > 0
      ? `${icPeerCompanyRows.length} Compan${icPeerCompanyRows.length === 1 ? "y" : "ies"}`
      : null;

  const renderRowShell: RowShellRenderer = (rowSelected, onClick, content, rowHref) => {
    const rowClassName = masterListRowUnselectedCn(rowSelected);
    if (rowHref) {
      return (
        <Link
          prefetch={false}
          href={rowHref}
          onClick={onClick}
          className="block min-w-0 max-w-full overflow-hidden"
        >
          <MasterListRow selected={rowSelected} className={rowClassName} {...icCompanyRowProps}>
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
        {...icCompanyRowProps}
      >
        {content}
      </MasterListRow>
    );
  };

  const renderCardContent: CardContentRenderer = (
    primary,
    secondary,
    balance,
    pendingCount,
    avatarFallback,
    fileUrl,
    companyId,
    expandControl,
    leadingIcon,
    compactPrimary = false
  ) => (
    <div className="pl-master-list-row">
      <div className="pl-master-list-row-leading">
        <div className="relative flex-shrink-0">
          {leadingIcon ?? (
            <EntityFileAttachmentHover
              fileUrl={trimEntityFileUrlForPreview(fileUrl)}
              triggerClassName="inline-flex shrink-0 rounded-full"
            >
              <ResolvedEntityAvatar
                className={MASTER_LIST_AVATAR_CN}
                fallbackClassName={MASTER_LIST_AVATAR_FALLBACK_CN}
                companyId={companyId}
                src={trimEntityFileUrlForPreview(fileUrl) ?? undefined}
                alt={primary}
                fallbackText={avatarFallback}
              />
            </EntityFileAttachmentHover>
          )}
          {pendingCount > 0 && (
            <span
              className="absolute top-0 right-0 flex h-4 w-4 items-center justify-center bg-pink-500 text-[10px] font-bold text-white origin-center"
              style={{ transform: "rotate(45deg) translate(25%, -25%)" }}
              aria-label={`${pendingCount} pending approval`}
            >
              <span style={{ transform: "rotate(-45deg)" }}>{pendingCount}</span>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-start gap-0.5 overflow-hidden">
          <MasterListNameTooltip
            measureKey={`${primary}|${secondary ?? ""}|${highlightQuery}`}
            className={cn("min-w-0 flex-1", secondary && "items-start py-0.5")}
            tooltipContent={
              <>
                <p className="font-medium">{primary}</p>
                {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
              </>
            }
          >
            <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
              <span
                {...masterListNameMeasureProps(
                  compactPrimary ? "text-[11px] font-medium leading-tight" : undefined
                )}
              >
                {highlightQuery ? highlightQueryInText(primary, highlightQuery) : primary}
              </span>
              {secondary ? (
                <span
                  {...masterListNameMeasureProps(
                    "text-[11px] font-normal leading-tight text-muted-foreground"
                  )}
                >
                  {highlightQuery ? highlightQueryInText(secondary, highlightQuery) : secondary}
                </span>
              ) : null}
            </span>
          </MasterListNameTooltip>
          {expandControl ? (
            <div className="ml-auto shrink-0 self-center pl-1">{expandControl}</div>
          ) : null}
        </div>
      </div>
      <p
        className={cn(
          "pl-master-list-row-amount ml-2",
          balance >= 0 ? "text-green-600" : "text-red-600"
        )}
      >
        {formatCurrency(balance, { showDrCr: true })}
      </p>
    </div>
  );

  const level1ExpandControl = (
    <MasterListChromeChevronToggle
      variant="row"
      expanded={level1Expanded}
      ariaLabelWhenExpanded="Collapse IC companies"
      ariaLabelWhenCollapsed="Expand IC companies"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleLevel1();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );

  const level1Content = renderCardContent(
    group.name,
    level1Secondary,
    Number(group.balance || 0),
    level1Pending,
    getInitials(group.name),
    undefined,
    group.companyId,
    level1ExpandControl,
    (
      <MasterListGroupIcon>
        <Users className="h-4 w-4" />
      </MasterListGroupIcon>
    )
  );

  const level1Row = renderRowShell(
    isLevel1Selected,
    () => {
      onFocusGroup?.();
      onSelect({ peerCompanyId: null, memberAccountId: null });
    },
    level1Content,
    href
  );

  const peerRows = level1Expanded ? (
    <div className="flex flex-col gap-1 pl-[10px] pt-1">
      <AnimatePresence mode={animatePresenceMode}>
        {displayPeerRows.map((peerCompany) => {
          const titleLines = icPeerCompanyGroupListTitleLines(peerCompany);
          const members = peerCompany.icMemberParties ?? [];
          const isPeerExpanded = expandedPeerCompanyId === peerCompany.id;
          const isLevel2Selected =
            selectedGroup?.id === group.id &&
            selectedIcPeerCompanyId === peerCompany.id &&
            !selectedIcMemberAccountId;
          const peerPending =
            members.reduce(
              (sum, member) => sum + (pendingApprovalByPartyId[member.id] ?? 0),
              0
            ) || (pendingApprovalByPartyId[peerCompany.id] ?? 0);

          const peerExpandControl = (
            <MasterListChromeChevronToggle
              variant="row"
              expanded={isPeerExpanded}
              ariaLabelWhenExpanded="Collapse accounts"
              ariaLabelWhenCollapsed="Expand accounts"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePeerCompany(peerCompany.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          );

          const sortedMembers = sortIcMemberParties(
            members.filter(
              (member) => !shouldHideEntityListSettledRow(member.balance, hideSettled, quickFilter)
            ),
            quickFilter,
            lastVoucherMsById
          );
          const memberOrderKey = masterListOrderKey(sortedMembers.map((m) => m.id));

          const peerRow = renderRowShell(
            isLevel2Selected,
            () => onSelect({ peerCompanyId: peerCompany.id, memberAccountId: null }),
            renderCardContent(
              titleLines.primary,
              titleLines.secondary,
              Number(peerCompany.balance || 0),
              peerPending,
              getInitials(titleLines.primary),
              peerCompany.fileUrl,
              peerCompany.companyId,
              peerExpandControl
            )
          );

          const peerChildRows = isPeerExpanded ? (
            <PeerAccountChildRows
              peerCompany={peerCompany}
              members={sortedMembers}
              memberOrderKey={memberOrderKey}
              groupId={group.id}
              selectedGroup={selectedGroup}
              selectedIcPeerCompanyId={selectedIcPeerCompanyId}
              selectedIcMemberAccountId={selectedIcMemberAccountId}
              onSelect={(memberId) =>
                onSelect({ peerCompanyId: peerCompany.id, memberAccountId: memberId })
              }
              pendingApprovalByPartyId={pendingApprovalByPartyId}
              animatePresenceMode={animatePresenceMode}
              rowMotionProps={rowMotionProps}
              isRowAnimationEnabled={isRowAnimationEnabled}
              layoutHoldMs={layoutHoldMs}
              renderCardContent={renderCardContent}
              renderRowShell={renderRowShell}
            />
          ) : null;

          return (
            <motion.div
              key={peerCompany.id}
              layoutDependency={peerDisplayOrderKey}
              {...rowMotionProps}
            >
              {isPeerExpanded ? (
                <div data-pl-ic-company-sub-group="">
                  {peerRow}
                  {peerChildRows}
                </div>
              ) : (
                peerRow
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  ) : null;

  if (level1Expanded) {
    return (
      <div data-pl-ic-company-group="">
        {level1Row}
        {peerRows}
      </div>
    );
  }

  return <>{level1Row}</>;
}

function PeerAccountChildRows({
  peerCompany,
  members,
  memberOrderKey,
  groupId,
  selectedGroup,
  selectedIcPeerCompanyId,
  selectedIcMemberAccountId,
  onSelect,
  pendingApprovalByPartyId,
  animatePresenceMode,
  rowMotionProps,
  isRowAnimationEnabled,
  layoutHoldMs,
  renderCardContent,
  renderRowShell,
}: {
  peerCompany: Party;
  members: Party[];
  memberOrderKey: string;
  groupId: string;
  selectedGroup: Group | null;
  selectedIcPeerCompanyId: string | null;
  selectedIcMemberAccountId: string | null;
  onSelect: (memberId: string) => void;
  pendingApprovalByPartyId: Record<string, number>;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  rowMotionProps: React.ComponentProps<typeof motion.div>;
  isRowAnimationEnabled: boolean;
  layoutHoldMs: number;
  renderCardContent: CardContentRenderer;
  renderRowShell: RowShellRenderer;
}) {
  const { displayRows: displayMembers, displayOrderKey: childDisplayOrderKey } =
    useMasterListDisplayRows(members, memberOrderKey, {
      enabled: isRowAnimationEnabled,
      holdMs: layoutHoldMs,
    });

  return (
    <div className="flex flex-col gap-1 pl-[10px]">
      <AnimatePresence mode={animatePresenceMode}>
        {displayMembers.map((member) => {
          const memberSelected =
            selectedGroup?.id === groupId &&
            selectedIcPeerCompanyId === peerCompany.id &&
            selectedIcMemberAccountId === member.id;
          const memberTitle = interCompanyClearingAccountDisplayName(member);
          const memberPending = pendingApprovalByPartyId[member.id] ?? 0;
          return (
            <motion.div
              key={member.id}
              layoutDependency={childDisplayOrderKey}
              {...rowMotionProps}
            >
              {renderRowShell(
                memberSelected,
                () => onSelect(member.id),
                renderCardContent(
                  memberTitle,
                  null,
                  Number(member.balance || 0),
                  memberPending,
                  getInitials(memberTitle),
                  member.fileUrl,
                  member.companyId,
                  undefined,
                  undefined,
                  true
                )
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
