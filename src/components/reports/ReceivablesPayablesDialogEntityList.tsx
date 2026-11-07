"use client";

import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { highlightQueryInText } from "@/lib/highlightQueryInText";
import { useDate } from "@/hooks/useDate";
import { motion, AnimatePresence } from "framer-motion";
import { AlarmClock, CheckCircle2, ChevronDown, Plus, X } from "lucide-react";
import { MasterListChromeChevronToggle } from "@/components/layout/MasterListChromeChevronToggle";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MasterListRow } from "@/components/ui/master-list-row";
import { masterListRowUnselectedCn } from "@/lib/masterListChrome";
import {
  masterListOrderKey,
  useMasterListDisplayRows,
  useMasterListRowMotion,
} from "@/hooks/useMasterListRowMotion";
import { GROUP_LIST_CHILD_INDENT_CLASS } from "@/lib/groupListExpand";
import type { RpDeadlineNarrationsMap, RpDeadlinesMap, RpDialogRow, RpDialogSection, RpEntityKind } from "@/lib/receivablesPayablesDialogUi";
import {
  formatRpDeadlineYmd,
  parseRpDeadlineYmd,
  rpDialogRowSelectionKey,
} from "@/lib/receivablesPayablesDialogUi";
import { DIALOG_DIM_GREEN_BORDER } from "@/lib/dialogShellChrome";
import { chromeProPillCn, chromeProPillTextCn } from "@/lib/chromePillButton";

export type RpDialogListMotion = ReturnType<typeof useMasterListRowMotion>;

/** R/P dialog inner boxes — same dim green as popup shell. */
export const RP_DIALOG_DIM_GREEN_BORDER = DIALOG_DIM_GREEN_BORDER;

const RP_RIBBON_HEIGHT_CN = "h-[27px] min-h-[27px]";

/** R/P popup shell — globals.css scoped borders (dashboard-financial-popup 0.4px override se bachne). */
export const RP_DIALOG_SHELL_ATTR = { "data-pl-rp-dialog-shell": "" } as const;
export const RP_DIALOG_HEADER_DIVIDER_CN =
  "data-pl-rp-header-divider shrink-0 w-full border-t border-gray-300 dark:border-gray-600";
export const RP_DIALOG_GROUP_DIVIDER_CN =
  "data-pl-rp-group-divider my-[3px] w-full border-t border-gray-300 dark:border-gray-600";

/** Print pill jaisa — charo taraf blue border. */
const RP_CATEGORY_RIBBON_BAR_CN = cn(
  chromeProPillCn,
  RP_RIBBON_HEIGHT_CN,
  "flex min-w-0 items-center rounded-md px-2 hover:bg-blue-100/80",
  "!border-[1px] !border-blue-300"
);

export function rpDialogListScrollHandlers(motion: RpDialogListMotion) {
  return {
    onScroll: motion.markListScrolling,
    onTouchMove: motion.markListScrolling,
  } as const;
}

/** Outstanding dialog: portal popover / calendar par click se poora dialog band na ho. */
export function rpDialogPreventDismissForNestedPopover(e: {
  target: EventTarget | null;
  preventDefault: () => void;
}) {
  const target = e.target as HTMLElement | null;
  if (
    target?.closest("[data-radix-popover-content]") ||
    target?.closest("[data-radix-popper-content-wrapper]") ||
    target?.closest("[data-pl-rp-deadline-btn]")
  ) {
    e.preventDefault();
  }
}

function normalizeRpAmountQuery(q: string): string {
  return q.replace(/[,\s]/g, "").toLowerCase();
}

function rpRowMatchesName(row: RpDialogRow, nameQ: string): boolean {
  if (!nameQ) return false;
  const q = nameQ.toLowerCase();
  if (row.party.toLowerCase().includes(q)) return true;
  if (row.secondaryLabel?.toLowerCase().includes(q)) return true;
  return row.icChildren?.some((child) => rpRowMatchesName(child, nameQ)) ?? false;
}

/** Amount filter — displayed string + digit run (highlight jaisa; false `.661` boundary match nahi). */
function rpRowMatchesAmountText(formatted: string, amountQ: string): boolean {
  if (!amountQ) return false;
  const q = amountQ.trim();
  if (!q) return false;
  if (formatted.toLowerCase().includes(q.toLowerCase())) return true;
  const digitQ = normalizeRpAmountQuery(q);
  if (!digitQ || !/\d/.test(digitQ)) return false;
  const digitsOnly = formatted.replace(/[^\d]/g, "");
  return digitsOnly.includes(digitQ);
}

/** Single search box — name ya amount, jo match ho. */
function rpRowMatchesQuery(
  row: RpDialogRow,
  query: string,
  formatAmountText: (balance: number) => string
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (rpRowMatchesName(row, q)) return true;
  if (rpRowMatchesAmountText(formatAmountText(row.balance), q)) return true;
  return (
    row.icChildren?.some(
      (child) => rpRowMatchesName(child, q) || rpRowMatchesAmountText(formatAmountText(child.balance), q)
    ) ?? false
  );
}

function rpIcGroupParentMatchesDirectly(
  row: RpDialogRow,
  query: string,
  formatAmountText: (balance: number) => string
): boolean {
  const q = query.trim();
  if (!q) return false;
  if (row.party.toLowerCase().includes(q.toLowerCase())) return true;
  if (row.secondaryLabel?.toLowerCase().includes(q.toLowerCase())) return true;
  return rpRowMatchesAmountText(formatAmountText(row.balance), q);
}

function rpIcChildMatchesQuery(
  child: RpDialogRow,
  query: string,
  formatAmountText: (balance: number) => string
): boolean {
  const q = query.trim();
  if (!q) return true;
  return (
    rpRowMatchesName({ ...child, icChildren: undefined }, q) ||
    rpRowMatchesAmountText(formatAmountText(child.balance), q)
  );
}

/** Filter ke baad matching child ho to auto-expand — sirf un accounts dikhane ke liye. */
function rpIcGroupShouldAutoExpandFromFilter(row: RpDialogRow, query: string): boolean {
  if (!query.trim() || !row.isIcPeerCompanyGroup) return false;
  return (row.icChildren?.length ?? 0) > 0;
}

function filterRpDialogRows(
  rows: RpDialogRow[],
  query: string,
  formatAmountText: (balance: number) => string
): RpDialogRow[] {
  const q = query.trim();
  if (!q) return rows;

  return rows.flatMap((row) => {
    if (row.isIcPeerCompanyGroup && row.icChildren?.length) {
      const filteredChildren = row.icChildren.filter((child) => rpIcChildMatchesQuery(child, q, formatAmountText));
      const parentMatches = rpIcGroupParentMatchesDirectly(row, q, formatAmountText);
      if (parentMatches || filteredChildren.length > 0) {
        return [{ ...row, icChildren: filteredChildren }];
      }
      return [];
    }
    if (rpRowMatchesQuery(row, q, formatAmountText)) return [row];
    return [];
  });
}

function countRpDialogLeafRows(rows: RpDialogRow[]): number {
  return rows.reduce((count, row) => {
    if (row.isIcPeerCompanyGroup && row.icChildren?.length) return count + row.icChildren.length;
    return count + 1;
  }, 0);
}

const RP_HIGHLIGHT_MARK_CN =
  "rounded-sm bg-fuchsia-200 px-px text-inherit dark:bg-fuchsia-500/40";

/** Dashboard R/P dialog — same options as `formatRpDialogAmount`. */
function formatRpRowAmountText(
  formatCurrencyForPrint: (amount: number, options?: { noSuffix?: boolean; showDrCr?: boolean; context?: string }) => string,
  balance: number,
  listSide: "receivables" | "payables"
): string {
  const amount = listSide === "payables" ? Math.abs(balance) : balance;
  return formatCurrencyForPrint(amount, {
    noSuffix: true,
    showDrCr: true,
    context: "transaction",
  });
}

function highlightDigitsInFormattedAmount(formatted: string, digitQuery: string): ReactNode {
  const digitsOnly = formatted.replace(/[^\d]/g, "");
  const idx = digitsOnly.indexOf(digitQuery);
  if (idx < 0) return formatted;

  let digitCount = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < formatted.length; i++) {
    if (!/\d/.test(formatted[i])) continue;
    if (digitCount >= idx && digitCount < idx + digitQuery.length) {
      if (start < 0) start = i;
      end = i + 1;
    }
    digitCount++;
  }
  if (start < 0 || end <= start) return formatted;

  return (
    <>
      {formatted.slice(0, start)}
      <mark className={RP_HIGHLIGHT_MARK_CN}>{formatted.slice(start, end)}</mark>
      {formatted.slice(end)}
    </>
  );
}

function renderRpHighlightedText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q || !text) return text;
  return highlightQueryInText(text, q);
}

function renderRpHighlightedAmountText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q || !text) return text;
  const literal = highlightQueryInText(text, q);
  if (literal !== text) return literal;
  const digitQ = normalizeRpAmountQuery(q);
  if (!digitQ || !/\d/.test(digitQ)) return text;
  const highlighted = highlightDigitsInFormattedAmount(text, digitQ);
  return highlighted === text ? text : highlighted;
}

type ReceivablesPayablesDialogEntityListProps = {
  sections: RpDialogSection[];
  side: "receivables" | "payables";
  formatAmount: (amount: number, abs?: boolean) => ReactNode;
  isMobile?: boolean;
  listMotion?: RpDialogListMotion;
  selectedKey?: string | null;
  onSelectRow?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  onOpenRow?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  deadlines?: RpDeadlinesMap;
  deadlineNarrations?: RpDeadlineNarrationsMap;
  onDeadlineChange?: (side: "receivables" | "payables", row: RpDialogRow, ymd: string | null) => void;
  /** Opens the shared "Set New Reminder" popup (LedgerReminderDialog) for this row. */
  onOpenDeadlineReminder?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  showDeadlineControls?: boolean;
};

function RpRowDeadlineControl({
  side,
  row,
  deadlines,
  onDeadlineChange,
  onOpenDeadlineReminder,
}: {
  side: "receivables" | "payables";
  row: RpDialogRow;
  deadlines?: RpDeadlinesMap;
  onDeadlineChange?: (side: "receivables" | "payables", row: RpDialogRow, ymd: string | null) => void;
  onOpenDeadlineReminder?: (side: "receivables" | "payables", row: RpDialogRow) => void;
}) {
  const { formatDateBySystem } = useDate();
  const [open, setOpen] = useState(false);
  const rowKey = rpDialogRowSelectionKey(side, row);
  const storedYmd = deadlines?.[rowKey];
  const deadlineDate = storedYmd ? parseRpDeadlineYmd(storedYmd) : null;
  const hoverTitle = deadlineDate
    ? `Deadline: ${formatDateBySystem(deadlineDate)}`
    : onOpenDeadlineReminder
      ? "Set collection deadline / reminder"
      : "Set collection deadline";

  if (!onDeadlineChange && !onOpenDeadlineReminder) return null;

  const triggerButton = (onClick: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
    <button
      type="button"
      data-pl-rp-deadline-btn=""
      aria-label={hoverTitle}
      title={hoverTitle}
      className="inline-flex h-5 w-7 shrink-0 items-center justify-center self-center rounded p-0 text-foreground touch-manipulation hover:bg-muted/60"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {deadlineDate ? (
        <CheckCircle2
          className="h-[17px] w-[17px] text-green-600 dark:text-green-500"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : (
        <AlarmClock className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
      )}
    </button>
  );

  // New flow: same "Set New Reminder" popup as Account Details (LedgerReminderDialog, hosted in RpOutstandingDialogHost).
  if (onOpenDeadlineReminder) {
    return triggerButton((e) => {
      e.stopPropagation();
      onOpenDeadlineReminder(side, row);
    });
  }

  // Legacy fallback (no reminder host): old "Collection deadline" date-picker popover.
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{triggerButton((e) => e.stopPropagation())}</PopoverTrigger>
      <PopoverContent
        className="z-[110] w-auto p-2"
        align="end"
        side="bottom"
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground">Collection deadline</p>
        <BsDatePicker
          valueAD={deadlineDate ?? undefined}
          onChangeAD={(d) => {
            if (!d) return;
            d.setHours(12, 0, 0, 0);
            onDeadlineChange?.(side, row, formatRpDeadlineYmd(d));
            setOpen(false);
          }}
          isRange={false}
          className="h-9 text-xs w-full min-w-[220px]"
          popoverContentClassName="z-[120]"
        />
        {deadlineDate ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-8 w-full text-xs"
            onClick={() => {
              onDeadlineChange?.(side, row, null);
              setOpen(false);
            }}
          >
            Clear deadline
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const icCompanyRowProps = { "data-pl-ic-company-row": "" } as const;

function RpDialogEntityRow({
  row,
  side,
  formatAmount,
  isMobile,
  amountClass,
  rowMotionProps,
  displayOrderKey,
  indent = false,
  icAccountRow = false,
  selected = false,
  onSelect,
  onOpen,
  highlightQuery = "",
  formatAmountText,
  deadlines,
  deadlineNarrations,
  onDeadlineChange,
  onOpenDeadlineReminder,
  showDeadlineControls,
}: {
  row: RpDialogRow;
  side: "receivables" | "payables";
  formatAmount: (amount: number, abs?: boolean) => ReactNode;
  formatAmountText: (balance: number) => string;
  isMobile?: boolean;
  amountClass: string;
  rowMotionProps: Record<string, unknown>;
  displayOrderKey: string;
  indent?: boolean;
  /** IC company ke andar wale account — party list jaisa blue pill. */
  icAccountRow?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  highlightQuery?: string;
  deadlines?: RpDeadlinesMap;
  deadlineNarrations?: RpDeadlineNarrationsMap;
  onDeadlineChange?: (side: "receivables" | "payables", row: RpDialogRow, ymd: string | null) => void;
  /** Opens the shared "Set New Reminder" popup (LedgerReminderDialog) for this row. */
  onOpenDeadlineReminder?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  showDeadlineControls?: boolean;
}) {
  const amountText = formatAmountText(row.balance);
  const amountDisplay = highlightQuery
    ? renderRpHighlightedAmountText(amountText, highlightQuery)
    : formatAmount(row.balance, side === "payables");
  const { formatDateBySystem } = useDate();
  const deadlineKey = rpDialogRowSelectionKey(side, row);
  const deadlineYmd = deadlines?.[deadlineKey];
  const deadlineDate = deadlineYmd ? parseRpDeadlineYmd(deadlineYmd) : null;
  const deadlineNarration = deadlineNarrations?.[deadlineKey] ||
    "Need to call the party to ask payment";
  return (
    <motion.li
      layoutDependency={displayOrderKey}
      className={cn("min-w-0", indent && GROUP_LIST_CHILD_INDENT_CLASS)}
      {...rowMotionProps}
    >
      <MasterListRow
        selected={selected}
        className={cn(
          masterListRowUnselectedCn(selected),
          "cursor-pointer select-none !border-[1px]"
        )}
        {...(icAccountRow ? icCompanyRowProps : {})}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <div className="pl-master-list-row">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
            <p className="pl-master-list-row-name" title={isMobile ? row.party : undefined}>
              {renderRpHighlightedText(row.party, highlightQuery)}
            </p>
            {row.secondaryLabel ? (
              <p className="text-[11px] font-normal leading-tight text-muted-foreground">
                {renderRpHighlightedText(row.secondaryLabel, highlightQuery)}
              </p>
            ) : null}
            {deadlineDate ? (
              <p
                className="line-clamp-1 text-[10px] font-normal leading-tight text-muted-foreground"
                title={`${formatDateBySystem(deadlineDate)} — ${deadlineNarration}`}
              >
                {formatDateBySystem(deadlineDate)} — {renderRpHighlightedText(deadlineNarration, highlightQuery)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {showDeadlineControls ? (
              <RpRowDeadlineControl
                side={side}
                row={row}
                deadlines={deadlines}
                onDeadlineChange={onDeadlineChange}
                onOpenDeadlineReminder={onOpenDeadlineReminder}
              />
            ) : null}
            <p
              data-pl-list-balance={side === "receivables" ? "dr" : "cr"}
              className={cn("pl-master-list-row-amount", amountClass)}
            >
              {amountDisplay}
            </p>
          </div>
        </div>
      </MasterListRow>
    </motion.li>
  );
}

function RpIcCompanyExpandChevron({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <MasterListChromeChevronToggle
      variant="row"
      expanded={expanded}
      ariaLabelWhenExpanded="Collapse IC company accounts"
      ariaLabelWhenCollapsed="Expand IC company accounts"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function RpIcCompanyHeaderRow({
  row,
  side,
  formatAmount,
  isMobile,
  amountClass,
  expanded,
  onToggle,
  selected = false,
  onSelect,
  highlightQuery = "",
  formatAmountText,
}: {
  row: RpDialogRow;
  side: "receivables" | "payables";
  formatAmount: (amount: number, abs?: boolean) => ReactNode;
  formatAmountText: (balance: number) => string;
  isMobile?: boolean;
  amountClass: string;
  expanded: boolean;
  onToggle: () => void;
  selected?: boolean;
  onSelect?: () => void;
  highlightQuery?: string;
}) {
  const amountText = formatAmountText(row.balance);
  const amountDisplay = highlightQuery
    ? renderRpHighlightedAmountText(amountText, highlightQuery)
    : formatAmount(row.balance, side === "payables");
  return (
    <MasterListRow
      selected={selected}
      className={cn(
        masterListRowUnselectedCn(selected),
        "cursor-pointer select-none !border-[1px]"
      )}
      {...icCompanyRowProps}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault();
        onToggle();
      }}
    >
      <div className="pl-master-list-row">
        <div className="flex min-w-0 flex-1 items-start gap-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
            <p className="pl-master-list-row-name" title={isMobile ? row.party : undefined}>
              {renderRpHighlightedText(row.party, highlightQuery)}
            </p>
            {row.secondaryLabel ? (
              <p className="text-[11px] font-normal leading-tight text-muted-foreground">
                {renderRpHighlightedText(row.secondaryLabel, highlightQuery)}
              </p>
            ) : null}
          </div>
          <RpIcCompanyExpandChevron expanded={expanded} onToggle={onToggle} />
        </div>
        <p
          data-pl-list-balance={side === "receivables" ? "dr" : "cr"}
          className={cn(
            "pl-master-list-row-amount tabular-nums transition-opacity",
            amountClass,
            expanded && "opacity-40 text-muted-foreground font-normal saturate-50"
          )}
        >
          {amountDisplay}
        </p>
      </div>
    </MasterListRow>
  );
}

function RpIcCompanyGroupRow({
  row,
  side,
  formatAmount,
  isMobile,
  amountClass,
  rowMotionProps,
  displayOrderKey,
  animatePresenceMode,
  expanded,
  onToggle,
  selectedKey,
  onSelectRow,
  onOpenRow,
  highlightQuery = "",
  formatAmountText,
  deadlines,
  deadlineNarrations,
  onDeadlineChange,
  onOpenDeadlineReminder,
  showDeadlineControls,
}: {
  row: RpDialogRow;
  side: "receivables" | "payables";
  formatAmount: (amount: number, abs?: boolean) => ReactNode;
  formatAmountText: (balance: number) => string;
  isMobile?: boolean;
  amountClass: string;
  rowMotionProps: Record<string, unknown>;
  displayOrderKey: string;
  animatePresenceMode: "sync" | "wait" | "popLayout";
  expanded: boolean;
  onToggle: () => void;
  selectedKey?: string | null;
  onSelectRow?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  onOpenRow?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  highlightQuery?: string;
  deadlines?: RpDeadlinesMap;
  deadlineNarrations?: RpDeadlineNarrationsMap;
  onDeadlineChange?: (side: "receivables" | "payables", row: RpDialogRow, ymd: string | null) => void;
  /** Opens the shared "Set New Reminder" popup (LedgerReminderDialog) for this row. */
  onOpenDeadlineReminder?: (side: "receivables" | "payables", row: RpDialogRow) => void;
  showDeadlineControls?: boolean;
}) {
  const children = row.icChildren ?? [];
  const childOrderKey = useMemo(
    () => masterListOrderKey(children.map((child) => child.entityId || child.party)),
    [children]
  );

  const header = (
    <RpIcCompanyHeaderRow
      row={row}
      side={side}
      formatAmount={formatAmount}
      formatAmountText={formatAmountText}
      isMobile={isMobile}
      amountClass={amountClass}
      expanded={expanded}
      onToggle={onToggle}
      selected={selectedKey === rpDialogRowSelectionKey(side, row)}
      onSelect={() => onSelectRow?.(side, row)}
      highlightQuery={highlightQuery}
    />
  );

  return (
    <motion.li layoutDependency={displayOrderKey} className="min-w-0 list-none" {...rowMotionProps}>
      {expanded && children.length > 0 ? (
        <div data-pl-ic-company-group="">
          {header}
          <ul className="min-w-0 space-y-[3px]">
            <AnimatePresence mode={animatePresenceMode}>
              {children.map((child) => {
                const childKey = `${row.entityId}-${child.entityId || child.party}`;
                return (
                  <RpDialogEntityRow
                    key={childKey}
                    row={child}
                    side={side}
                    formatAmount={formatAmount}
                    formatAmountText={formatAmountText}
                    isMobile={isMobile}
                    amountClass={amountClass}
                    rowMotionProps={rowMotionProps}
                    displayOrderKey={childOrderKey}
                    indent
                    icAccountRow
                    selected={selectedKey === rpDialogRowSelectionKey(side, child)}
                    onSelect={() => onSelectRow?.(side, child)}
                    onOpen={() => onOpenRow?.(side, child)}
                    highlightQuery={highlightQuery}
                    deadlines={deadlines}
                    deadlineNarrations={deadlineNarrations}
                    onDeadlineChange={onDeadlineChange}
                    onOpenDeadlineReminder={onOpenDeadlineReminder}
                    showDeadlineControls={showDeadlineControls}
                  />
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      ) : (
        header
      )}
    </motion.li>
  );
}

/** R/P dialog entity rows — masters list jaisa card tone + IC company blue tree. */
export function ReceivablesPayablesDialogEntityList({
  sections,
  side,
  formatAmount,
  isMobile,
  listMotion: listMotionProp,
  selectedKey,
  onSelectRow,
  onOpenRow,
  deadlines,
  deadlineNarrations,
  onDeadlineChange,
  onOpenDeadlineReminder,
  showDeadlineControls = true,
}: ReceivablesPayablesDialogEntityListProps) {
  const internalMotion = useMasterListRowMotion();
  const listMotion = listMotionProp ?? internalMotion;
  const { animatePresenceMode, rowMotionProps, isRowAnimationEnabled, layoutHoldMs } = listMotion;
  const amountClass = side === "receivables" ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500";
  const [expandedIcCompanyIds, setExpandedIcCompanyIds] = useState<Set<string>>(() => new Set());
  const [expandedSectionKinds, setExpandedSectionKinds] = useState<Set<RpEntityKind>>(
    () => new Set(["party"])
  );
  const [listFilter, setListFilter] = useState("");
  const { formatCurrencyForPrint } = useDate();
  const formatAmountText = useCallback(
    (balance: number) => formatRpRowAmountText(formatCurrencyForPrint, balance, side),
    [formatCurrencyForPrint, side]
  );

  const listOrderKey = useMemo(
    () =>
      masterListOrderKey(
        sections.flatMap((section) =>
          section.rows.flatMap((row) =>
            row.isIcPeerCompanyGroup
              ? [row.entityId, ...(row.icChildren?.map((c) => c.entityId || c.party) ?? [])]
              : [row.entityId || row.party]
          )
        )
      ),
    [sections]
  );
  const { displayRows: displaySections, displayOrderKey } = useMasterListDisplayRows(
    sections,
    listOrderKey,
    { enabled: isRowAnimationEnabled, holdMs: layoutHoldMs }
  );

  const filteredSections = useMemo(() => {
    if (!listFilter.trim()) return displaySections;
    return displaySections
      .map((section) => {
        const rows = filterRpDialogRows(section.rows, listFilter, formatAmountText);
        return {
          ...section,
          rows,
          rowCount: countRpDialogLeafRows(rows),
        };
      })
      .filter((section) => section.rows.length > 0);
  }, [displaySections, listFilter, formatAmountText]);

  const highlightQuery = listFilter.trim();

  const isIcExpanded = (entityId: string) => expandedIcCompanyIds.has(entityId);

  const toggleIcExpanded = (entityId: string) => {
    setExpandedIcCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const toggleSectionExpanded = (kind: RpEntityKind) => {
    setExpandedSectionKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const isSectionExpanded = (kind: RpEntityKind, sectionHasRows: boolean) => {
    if (highlightQuery && sectionHasRows) return true;
    return expandedSectionKinds.has(kind);
  };

  /** Party (ya pehli section) ribbon ke saath search — mobile + desktop same row. */
  const ribbonInlineSearchSectionKind = useMemo((): RpEntityKind | null => {
    if (filteredSections.some((s) => s.kind === "party")) return "party";
    return filteredSections[0]?.kind ?? null;
  }, [filteredSections]);

  const renderListSearch = (compact: boolean) => (
    <div
      className={cn("relative min-w-0", compact ? "w-full" : "flex-1")}
      onClick={(e) => e.stopPropagation()}
    >
      <Input
        value={listFilter}
        onChange={(e) => setListFilter(e.target.value)}
        placeholder="Name or amount"
        className={cn(
          compact
            ? cn(
                RP_RIBBON_HEIGHT_CN,
                "w-full rounded-md border-blue-300 bg-white text-xs font-normal normal-case tracking-normal text-gray-900 dark:text-gray-900 shadow-none placeholder:text-gray-500 dark:placeholder:text-gray-500 dark:bg-white/95"
              )
            : "h-9 min-w-0 w-full text-sm shadow-sm",
          listFilter && (compact ? "pr-8" : "pr-9")
        )}
      />
      {listFilter ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "absolute right-0.5 top-1/2 -translate-y-1/2 rounded-full text-muted-foreground",
            compact ? "h-6 w-6 hover:bg-white/80 hover:text-foreground" : "h-7 w-7"
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setListFilter("");
          }}
          aria-label="Clear search"
        >
          <X className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </Button>
      ) : null}
    </div>
  );

  return (
    <div
      data-pl-rp-dialog=""
      data-theme-list="account-list"
      className="min-w-0 space-y-0 px-0 pb-1"
    >
      {filteredSections.map((section, sectionIndex) => {
        if (section.rows.length === 0) return null;
        const sectionExpanded = isSectionExpanded(section.kind, section.rows.length > 0);
        const showRibbonInlineSearch = ribbonInlineSearchSectionKind === section.kind;
        const ribbonToggle = (
          <button
            type="button"
            aria-expanded={sectionExpanded}
            onClick={() => toggleSectionExpanded(section.kind)}
            className={cn(
              "flex h-full min-w-0 w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide",
              chromeProPillTextCn
            )}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-transform duration-200",
                sectionExpanded ? "rotate-180" : "rotate-0"
              )}
            />
            <span className="truncate">
              {section.label} ({section.rowCount ?? section.rows.length})
            </span>
          </button>
        );
        return (
          <div key={section.kind} data-pl-rp-category="" className="min-w-0">
            {sectionIndex > 0 ? (
              <div
                className={cn(
                  RP_DIALOG_GROUP_DIVIDER_CN,
                  isMobile && "-mx-2 w-[calc(100%+1rem)]"
                )}
                aria-hidden
              />
            ) : null}
            {showRibbonInlineSearch ? (
              <div className="mb-0 grid min-w-0 grid-cols-2 gap-[3px]">
                <div data-pl-rp-category-header="" className={cn(RP_CATEGORY_RIBBON_BAR_CN, "mb-0 min-w-0 w-full")}>
                  {ribbonToggle}
                </div>
                <div data-pl-rp-list-search="" className="min-w-0 w-full">
                  {renderListSearch(true)}
                </div>
              </div>
            ) : (
              <div data-pl-rp-category-header="" className={cn(RP_CATEGORY_RIBBON_BAR_CN, "mb-0 w-full")}>
                {ribbonToggle}
              </div>
            )}
            {sectionExpanded ? (
            <ul className="pl-master-list-ul min-w-0 space-y-[3px] pb-0">
              <AnimatePresence mode={animatePresenceMode}>
                {section.rows.map((row) => {
                  const rowKey = `${section.kind}-${row.entityId || row.party}`;
                  if (row.isIcPeerCompanyGroup && row.icChildren?.length) {
                    return (
                      <RpIcCompanyGroupRow
                        key={rowKey}
                        row={row}
                        side={side}
                        formatAmount={formatAmount}
                        isMobile={isMobile}
                        amountClass={amountClass}
                        rowMotionProps={rowMotionProps}
                        displayOrderKey={displayOrderKey}
                        animatePresenceMode={animatePresenceMode}
                        expanded={
                          isIcExpanded(row.entityId) ||
                          rpIcGroupShouldAutoExpandFromFilter(row, highlightQuery)
                        }
                        onToggle={() => toggleIcExpanded(row.entityId)}
                        selectedKey={selectedKey}
                        onSelectRow={onSelectRow}
                        onOpenRow={onOpenRow}
                        highlightQuery={highlightQuery}
                        formatAmountText={formatAmountText}
                        deadlines={deadlines}
                        deadlineNarrations={deadlineNarrations}
                        onDeadlineChange={onDeadlineChange}
                        onOpenDeadlineReminder={onOpenDeadlineReminder}
                        showDeadlineControls={showDeadlineControls}
                      />
                    );
                  }
                  return (
                    <RpDialogEntityRow
                      key={rowKey}
                      row={row}
                      side={side}
                      formatAmount={formatAmount}
                      formatAmountText={formatAmountText}
                      isMobile={isMobile}
                      amountClass={amountClass}
                      rowMotionProps={rowMotionProps}
                      displayOrderKey={displayOrderKey}
                      selected={selectedKey === rpDialogRowSelectionKey(side, row)}
                      onSelect={() => onSelectRow?.(side, row)}
                      onOpen={() => onOpenRow?.(side, row)}
                      highlightQuery={highlightQuery}
                      deadlines={deadlines}
                      deadlineNarrations={deadlineNarrations}
                      onDeadlineChange={onDeadlineChange}
                      onOpenDeadlineReminder={onOpenDeadlineReminder}
                      showDeadlineControls={showDeadlineControls}
                    />
                  );
                })}
              </AnimatePresence>
            </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
