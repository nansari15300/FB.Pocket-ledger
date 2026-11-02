"use client";

import { cn } from "@/lib/utils";

export type PendingApprovalListFilterBadgeProps = {
  /** Toolbar total: kitne unapproved vouchers is entity type ko touch karte hain */
  count: number;
  pressed: boolean;
  onToggle: () => void;
  tooltipFilterHint: string;
  tooltipShowAllHint: string;
  ariaLabelFilter: string;
  ariaLabelShowAll: string;
  /** List search row: h-9 badge search row ko lamba na kare */
  compact?: boolean;
  /** Optional extra classes (e.g. min width for a roomier box). */
  className?: string;
};

/** Master list: search aur + Add ke beech pink count — click se sirf pending wale rows (party page pattern) */
export function PendingApprovalListFilterBadge({
  count,
  pressed,
  onToggle,
  tooltipFilterHint,
  tooltipShowAllHint,
  ariaLabelFilter,
  ariaLabelShowAll,
  compact = false,
  className,
}: PendingApprovalListFilterBadgeProps) {
  if (count <= 0) return null;

  // Plain button + native `title` tooltip: Radix Tooltip/Popper asChild composes refs that call setState on
  // detach, which looped ("Maximum update depth exceeded") when the badge mounted/unmounted with live counts.
  return (
    <button
      type="button"
      onClick={onToggle}
      title={pressed ? tooltipShowAllHint : tooltipFilterHint}
      className={cn(
        // `w-fit` + tabular-nums - digit count ke hisaab se width
        "inline-flex w-fit max-w-[5rem] shrink-0 items-center justify-center rounded-md border font-bold tabular-nums transition-colors",
        compact
          ? "pl-mlc-pending-badge box-border h-7 min-h-7 max-h-7 self-center px-1 py-0 text-[10px] leading-none"
          : "h-9 px-1.5 text-xs sm:px-2",
        pressed
          ? "border-pink-600 bg-pink-600 text-white shadow-sm"
          : "border-pink-200 bg-pink-100 text-pink-900 hover:bg-pink-200/90 dark:border-pink-800 dark:bg-pink-950/60 dark:text-pink-100 dark:hover:bg-pink-900/50",
        className
      )}
      aria-pressed={pressed}
      aria-label={pressed ? ariaLabelShowAll : ariaLabelFilter}
    >
      {count}
    </button>
  );
}