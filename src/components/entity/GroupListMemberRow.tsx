"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MasterListRow } from "@/components/ui/master-list-row";
import { MasterListNameTooltip, masterListNameMeasureProps } from "@/components/entity/MasterListNameTooltip";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { masterListRowUnselectedCn } from "@/lib/masterListChrome";
import {
  groupListChildMemberNameTriggerCn,
  masterListNameTriggerStrongCn,
} from "@/lib/listSelectionChrome";
import { useDate } from "@/hooks/useDate";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsTextTruncated } from "@/hooks/useIsTextTruncated";
import { MasterAccountFreezeListBadge } from "@/components/masterAccountFreeze/MasterAccountFreezeListBadge";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";
import type { GroupListMemberMoveProps } from "@/hooks/useGroupListAccountMove";

type GroupListMemberRowProps = {
  name: string;
  balance: number | undefined;
  isSelected: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  pendingCount?: number;
  balanceMasked?: boolean;
  nameTriggerClassName?: string;
  amountClassName?: string;
  rowDataAttrs?: Record<string, string>;
  isAccountFrozen?: boolean;
  highlightQuery?: string;
  moveHoverHint?: string;
  moveHoldingHint?: string;
  moveActive?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  onClickCapture?: (e: React.MouseEvent) => void;
  onPointerDownCapture?: (e: React.PointerEvent) => void;
  onPointerMoveCapture?: (e: React.PointerEvent) => void;
  onPointerUpCapture?: (e: React.PointerEvent) => void;
  onPointerCancelCapture?: (e: React.PointerEvent) => void;
  rowDimClass?: string;
};

export function GroupListMemberRow({
  name,
  balance,
  isSelected,
  onClick,
  leading,
  pendingCount = 0,
  balanceMasked = false,
  nameTriggerClassName = groupListChildMemberNameTriggerCn,
  amountClassName = "pl-master-list-row-amount-xs ml-1",
  rowDataAttrs,
  isAccountFrozen = false,
  highlightQuery,
  moveHoverHint,
  moveHoldingHint,
  moveActive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClickCapture,
  onPointerDownCapture,
  onPointerMoveCapture,
  onPointerUpCapture,
  onPointerCancelCapture,
  rowDimClass,
}: GroupListMemberRowProps) {
  const { formatCurrency } = useDate();
  const [moveHintOpen, setMoveHintOpen] = useState(false);
  const nameMeasureRef = useRef<HTMLSpanElement>(null);
  const isNameTruncated = useIsTextTruncated(nameMeasureRef, [name, highlightQuery]);
  const isBalanceMasked = balanceMasked || typeof balance !== "number";
  const cardClassName = masterListRowUnselectedCn(isSelected);
  const moveEnabled = Boolean(moveHoverHint);
  const moveHintText = moveHoldingHint || moveHoverHint;
  const showMoveTooltip = moveEnabled && (moveHintOpen || Boolean(moveHoldingHint)) && !moveActive;

  const nameLabel = highlightQuery ? highlightQueryInText(name, highlightQuery) : name;

  const nameEl = moveEnabled ? (
    <span ref={nameMeasureRef} data-pl-list-name="" className={nameTriggerClassName}>
      <span {...masterListNameMeasureProps()}>{nameLabel}</span>
    </span>
  ) : (
    <MasterListNameTooltip
      measureKey={name}
      triggerClassName={nameTriggerClassName}
      tooltipContent={
        <>
          <p>{name}</p>
          {pendingCount > 0 ? (
            <p className="text-xs text-muted-foreground">{pendingCount} pending approval</p>
          ) : null}
        </>
      }
    >
      {nameLabel}
    </MasterListNameTooltip>
  );

  const row = (
    <MasterListRow
      selected={isSelected}
      className={cn(
        cardClassName,
        moveEnabled && "cursor-grab",
        moveActive && "cursor-grabbing ring-2 ring-primary/50"
      )}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={onPointerCancelCapture}
      onClickCapture={onClickCapture}
      onMouseEnter={() => {
        if (moveEnabled && !moveActive) setMoveHintOpen(true);
      }}
      onMouseLeave={() => setMoveHintOpen(false)}
      {...rowDataAttrs}
    >
      <div className="pl-master-list-row">
        <div className="pl-master-list-row-leading">
          <div className="relative flex-shrink-0">
            {leading}
            <MasterListPendingBadge count={pendingCount} />
          </div>
          <div className="flex min-w-0 flex-col">
            {nameEl}
            {isAccountFrozen ? <MasterAccountFreezeListBadge className="mt-0.5" /> : null}
          </div>
        </div>
        <p
          data-pl-list-balance={
            isBalanceMasked
              ? undefined
              : typeof balance === "number" && balance >= 0
                ? "dr"
                : "cr"
          }
          className={cn(
            amountClassName,
            !isBalanceMasked && masterDetailBalanceToneClass(balance ?? 0)
          )}
        >
          {isBalanceMasked ? "*****" : formatCurrency(balance ?? 0, { showDrCr: true })}
        </p>
      </div>
    </MasterListRow>
  );

  const wrappedRow = rowDimClass ? <div className={rowDimClass}>{row}</div> : row;

  if (!moveEnabled) return wrappedRow;

  return (
    <Tooltip open={showMoveTooltip} onOpenChange={setMoveHintOpen}>
      <TooltipTrigger asChild>{wrappedRow}</TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[280px] text-xs">
        {isNameTruncated ? <p className="font-medium">{name}</p> : null}
        {pendingCount > 0 ? (
          <p className="text-muted-foreground">{pendingCount} pending approval</p>
        ) : null}
        {moveHintText ? <p className="text-muted-foreground">{moveHintText}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

type GroupListExpandNameRowProps = {
  name: string;
  expandControl: React.ReactNode | null;
  pendingCount?: number;
  nameTriggerClassName?: string;
  tooltipExtra?: React.ReactNode;
  highlightQuery?: string;
  secondaryLabel?: string | null;
};

export function GroupListExpandNameRow({
  name,
  expandControl,
  pendingCount = 0,
  nameTriggerClassName = masterListNameTriggerStrongCn,
  tooltipExtra,
  highlightQuery,
  secondaryLabel,
}: GroupListExpandNameRowProps) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-0.5 overflow-hidden">
      <MasterListNameTooltip
        measureKey={`${name}|${secondaryLabel ?? ""}|${highlightQuery ?? ""}`}
        triggerClassName={nameTriggerClassName}
        className={cn("min-w-0 flex-1", secondaryLabel && "items-start py-0.5")}
        tooltipContent={
          <>
            <p className="font-medium">{name}</p>
            {secondaryLabel ? (
              <p className="text-xs text-muted-foreground">{secondaryLabel}</p>
            ) : null}
            {pendingCount > 0 ? (
              <p className="text-xs text-muted-foreground">{pendingCount} pending approval</p>
            ) : null}
            {tooltipExtra}
          </>
        }
      >
        <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
          <span {...masterListNameMeasureProps()}>
            {highlightQuery ? highlightQueryInText(name, highlightQuery) : name}
          </span>
          {secondaryLabel ? (
            <span
              {...masterListNameMeasureProps(
                "text-[11px] font-normal leading-tight text-muted-foreground"
              )}
            >
              {highlightQuery
                ? highlightQueryInText(secondaryLabel, highlightQuery)
                : secondaryLabel}
            </span>
          ) : null}
        </span>
      </MasterListNameTooltip>
      {expandControl ? (
        <div className="ml-auto shrink-0 self-center pl-1">{expandControl}</div>
      ) : null}
    </div>
  );
}

export type GroupListRowShellMoveProps = Pick<
  GroupListMemberMoveProps,
  | "moveHoverHint"
  | "moveHoldingHint"
  | "moveActive"
  | "onPointerDownCapture"
  | "onPointerMoveCapture"
  | "onPointerUpCapture"
  | "onPointerCancelCapture"
  | "onClickCapture"
>;

type GroupListRowShellProps = {
  isSelected: boolean;
  onClick: () => void;
  content: React.ReactNode;
  href?: string;
  rowDataAttrs?: Record<string, string>;
  moveProps?: GroupListRowShellMoveProps;
};

export function GroupListRowShell({
  isSelected,
  onClick,
  content,
  href,
  rowDataAttrs,
  moveProps,
}: GroupListRowShellProps) {
  const router = useRouter();
  const [moveHintOpen, setMoveHintOpen] = useState(false);
  const moveEnabled = Boolean(moveProps?.moveHoverHint);
  const moveHintText = moveProps?.moveHoldingHint || moveProps?.moveHoverHint;
  const showMoveTooltip =
    moveEnabled && (moveHintOpen || Boolean(moveProps?.moveHoldingHint)) && !moveProps?.moveActive;

  const rowClassName = cn(
    masterListRowUnselectedCn(isSelected),
    moveEnabled && "cursor-grab",
    moveProps?.moveActive && "cursor-grabbing ring-2 ring-primary/50"
  );

  const pointerProps = moveProps
    ? {
        onPointerDownCapture: moveProps.onPointerDownCapture,
        onPointerMoveCapture: moveProps.onPointerMoveCapture,
        onPointerUpCapture: moveProps.onPointerUpCapture,
        onPointerCancelCapture: moveProps.onPointerCancelCapture,
        onClickCapture: moveProps.onClickCapture,
      }
    : {};

  const handleRowClick = () => {
    onClick();
    if (href) router.push(href);
  };

  const row = (
    <MasterListRow
      selected={isSelected}
      className={rowClassName}
      onClick={handleRowClick}
      onMouseEnter={() => {
        if (moveEnabled && !moveProps?.moveActive) setMoveHintOpen(true);
      }}
      onMouseLeave={() => setMoveHintOpen(false)}
      {...rowDataAttrs}
      {...pointerProps}
    >
      {content}
    </MasterListRow>
  );

  if (!moveEnabled) {
    if (href) {
      return (
        <Link
          prefetch={false}
          href={href}
          onClick={onClick}
          className="block min-w-0 max-w-full overflow-hidden"
        >
          <MasterListRow selected={isSelected} className={rowClassName} {...rowDataAttrs}>
            {content}
          </MasterListRow>
        </Link>
      );
    }
    return row;
  }

  return (
    <Tooltip open={showMoveTooltip} onOpenChange={setMoveHintOpen}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[280px] text-xs">
        {moveHintText ? <p className="text-muted-foreground">{moveHintText}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function renderGroupListRowShell(
  isSelected: boolean,
  onClick: () => void,
  content: React.ReactNode,
  href?: string,
  rowDataAttrs?: Record<string, string>,
  moveProps?: GroupListRowShellMoveProps
) {
  return (
    <GroupListRowShell
      isSelected={isSelected}
      onClick={onClick}
      content={content}
      href={href}
      rowDataAttrs={rowDataAttrs}
      moveProps={moveProps}
    />
  );
}
