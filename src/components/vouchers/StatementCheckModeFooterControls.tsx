"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { LedgerFooterChromePill } from "@/components/vouchers/ledgerFooterChrome";

type Props = {
  idPrefix: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  viewMode: "statement" | "bill_wise";
  hiddenCount?: number;
};

export function StatementCheckModeFooterControls({
  idPrefix,
  enabled,
  onEnabledChange,
  viewMode,
  hiddenCount = 0,
}: Props) {
  const isMobile = useIsMobile();
  if (isMobile || viewMode !== "statement") return null;

  const checkId = `check-mode-${idPrefix}`;

  return (
    <LedgerFooterChromePill className="gap-1 pr-1">
      <Checkbox
        id={checkId}
        checked={enabled}
        onCheckedChange={(c) => onEnabledChange(Boolean(c))}
        className="shrink-0"
      />
      <label
        htmlFor={checkId}
        className="cursor-pointer whitespace-nowrap text-sm font-medium leading-none text-blue-900"
      >
        Reconcile
        {enabled && hiddenCount > 0 ? (
          <span className="font-normal text-blue-800/70"> ({hiddenCount} hidden)</span>
        ) : null}
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <AppFreshInfoButton size="sm" aria-label="Reconcile shortcuts" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 text-sm" data-pl-intro="">
          <p className="mb-2 font-semibold">Reconcile</p>
          <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
            <li><kbd className="rounded border bg-muted px-1 text-foreground">↑</kbd> / <kbd className="rounded border bg-muted px-1 text-foreground">↓</kbd> — move between transactions</li>
            <li><kbd className="rounded border bg-muted px-1 text-foreground">Space</kbd> — mark / unmark row (soft green highlight)</li>
            <li><kbd className="rounded border bg-muted px-1 text-foreground">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 text-foreground">H</kbd> — hide focused row (excluded from totals)</li>
            <li><kbd className="rounded border bg-muted px-1 text-foreground">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 text-foreground">Alt</kbd>+<kbd className="rounded border bg-muted px-1 text-foreground">H</kbd> — hide all marked rows</li>
            <li><kbd className="rounded border bg-muted px-1 text-foreground">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 text-foreground">U</kbd> — unhide one row</li>
            <li><kbd className="rounded border bg-muted px-1 text-foreground">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 text-foreground">Alt</kbd>+<kbd className="rounded border bg-muted px-1 text-foreground">U</kbd> — unhide all hidden rows</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Reconcile stays on when you leave and return. Turn it off to reset hidden rows and marks.
          </p>
        </PopoverContent>
      </Popover>
    </LedgerFooterChromePill>
  );
}
