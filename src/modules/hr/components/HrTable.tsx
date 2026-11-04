"use client";

import * as React from "react";
import { Table, TableHeader } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * HR line rules: every table line is at most 1px and uses the theme border color.
 * The shared ui/table and globals.css draw 3px / pure black lines (theme `main table … tr` rule,
 * 4K media block). These classes use `:not(#pl-hr-none)` (ID specificity) + `!important`
 * so they win inside HR tables only. Shared files are not changed.
 */
export const HR_TABLE_LINES =
  "[&:not(#pl-hr-none)]:!border-0 " +
  "[&_th:not(#pl-hr-none)]:!border-0 [&_td:not(#pl-hr-none)]:!border-0 " +
  "[&_tr:not(#pl-hr-none)]:!border-x-0 [&_tr:not(#pl-hr-none)]:!border-t-0 " +
  "[&_tr:not(#pl-hr-none)]:!border-b [&_tr:not(#pl-hr-none)]:!border-border " +
  // Single outer edge: the frame draws the last line, so the last body/footer row has none.
  "[&_tbody_tr:last-child:not(#pl-hr-none)]:!border-b-0 [&_tfoot_tr:last-child:not(#pl-hr-none)]:!border-b-0";

/**
 * Ledger row surface for the 8 theme-master themes (same list as globals.css section 6):
 * every body cell uses the theme's raised surface `--pl-raised`, the same colour as the ledger
 * transaction rows (light mint on Soft Green). Header (`--pl-surface-2`) and footer (`--card`)
 * already come from the globals ledger rules for `[data-theme-table="transactions"]`.
 * Pro and the other themes are not in the list, so they keep their own stripes and tones.
 */
export const HR_TABLE_LEDGER_SURFACE =
  "[:is(body.theme-pl-light,body.theme-pl-gray,body.theme-pl-medium,body.theme-soft-green,body.theme-dim-soft-green,body.theme-soft-blue,body.theme-sky-blue,body.theme-soft-yellow)_&_tbody_tr>td:not(#pl-hr-none)]:!bg-[hsl(var(--pl-raised))]";

/** Small italic note text, same style as the ledger narration line. */
export const HR_NARRATION = "text-[11px] italic leading-tight text-muted-foreground";

/** Ledger-style Total footer: one 1px theme line on top, light surface, medium weight. */
export const HR_TABLE_FOOTER = "border-t border-border bg-muted/50 font-medium";

/** Header row line (1px, theme color) for the shared TableHeader. */
export const HR_TABLE_HEADER = "[&_tr]:border-b [&_tr]:border-border";

/** Body / footer row line (1px, theme color) for the shared TableRow. */
export const HR_TABLE_ROW = "border-b border-border";

/**
 * Table box = the app's shared Card surface (`pl-card-3d rounded-lg border bg-card`, ui/card.tsx).
 * Pro: emerald ribbon + 1px theme line from globals; other themes: flat card. One 1px outer edge.
 */
export const HR_TABLE_FRAME = "pl-card-3d overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm";

/**
 * Put on the frame div: the app's themed list-table look (header tint, Pro stripes)
 * from globals `[data-theme-table="transactions"]` (same as ledger / day book tables).
 */
export const HR_TABLE_FRAME_DATA = { "data-theme-table": "transactions", "data-pl-hr-table-frame": "" } as const;

/** S.No. column (first column of HR tables): header and body cells. Numbers follow the displayed order (1..N). */
export const HR_SNO_HEAD = "w-12 whitespace-nowrap text-center";
export const HR_SNO_CELL = "w-12 whitespace-nowrap text-center tabular-nums text-muted-foreground";

/** Row stripe for the themed table (`data-txn-stripe` 0/1, same as transaction tables). */
export function hrStripe(index: number) {
  return { "data-txn-stripe": String(index % 2) } as const;
}

/**
 * Sticky header + Total row (opt-in: `<HrTable stickyHeaderFooter>`).
 * The ui/table wrapper (`overflow-auto scrollbar-slim-dim`, the app's slim theme scrollbar) is the only scroller,
 * so the table scrolls both ways inside it: thead sticks to its top and tfoot to its bottom.
 * Both are opaque: bg-card under the theme header tint; the footer keeps its muted/50 tint as a layer over bg-card.
 * Collapsed table borders do not move with sticky rows, so the header bottom line and the Total top line are
 * 1px inset box-shadows in the theme border colour (the header row border is removed so the line is not doubled).
 * z-20 keeps them above sticky-left body cells (z-10, Monthly attendance Employee column).
 */
export const HR_TABLE_STICKY =
  "[&>thead]:sticky [&>thead]:top-0 [&>thead]:z-20 [&>thead]:bg-card " +
  "[&>thead>tr:not(#pl-hr-none):not(#pl-hr-sticky)]:!border-b-0 " +
  "[&>thead>tr>th]:shadow-[inset_0_-1px_0_hsl(var(--border))] " +
  "[&>tfoot]:sticky [&>tfoot]:bottom-0 [&>tfoot]:z-20 [&>tfoot]:!border-t-0 [&>tfoot]:bg-card " +
  "[&>tfoot]:[background-image:linear-gradient(hsl(var(--muted)/0.5),hsl(var(--muted)/0.5))] " +
  "[&>tfoot>tr:first-child>td]:shadow-[inset_0_1px_0_hsl(var(--border))]";

/**
 * Page body (HR_PAGE_BODY) or section that holds a sticky table: a flex column that keeps the page height;
 * every other child keeps its own height, only the table frame (or the section around it) shrinks.
 */
export const HR_FILL_COLUMN = "flex min-h-0 flex-col [&>*]:shrink-0";

/** Tabs root between the page body and the table (Attendance): shrinks to the space left; tab list keeps its width. */
export const HR_FILL_TABS = "flex min-h-0 !shrink flex-col [&>[role=tablist]]:self-start";

/** Active TabsContent that holds a sticky table. */
export const HR_FILL_TAB_CONTENT = "min-h-0 !shrink flex-col data-[state=active]:flex";

/**
 * Table frame in a fill column: as tall as its rows, but never taller than the space left on the page
 * (never less than 10rem, then the page body scrolls on very small screens). The ui/table wrapper inside scrolls.
 */
export const HR_TABLE_FRAME_FILL = "flex min-h-[10rem] !shrink flex-col [&>div]:min-h-0";

type HrTableProps = React.ComponentPropsWithoutRef<typeof Table> & {
  /** Header and Total row stay in place; only the body rows scroll (see HR_TABLE_STICKY). */
  stickyHeaderFooter?: boolean;
};

/** Shared ui/table with HR 1px theme lines and the ledger row surface. */
export const HrTable = React.forwardRef<HTMLTableElement, HrTableProps>(
  ({ className, stickyHeaderFooter = false, ...props }, ref) => (
    <Table
      ref={ref}
      data-pl-hr-table=""
      data-pl-hr-sticky={stickyHeaderFooter ? "" : undefined}
      className={cn(HR_TABLE_LINES, HR_TABLE_LEDGER_SURFACE, stickyHeaderFooter && HR_TABLE_STICKY, className)}
      {...props}
    />
  )
);
HrTable.displayName = "HrTable";

type HrTableHeaderProps = React.ComponentPropsWithoutRef<typeof TableHeader>;

/** Shared TableHeader with a 1px theme-colored line. */
export const HrTableHeader = React.forwardRef<HTMLTableSectionElement, HrTableHeaderProps>(
  ({ className, ...props }, ref) => <TableHeader ref={ref} className={cn(HR_TABLE_HEADER, className)} {...props} />
);
HrTableHeader.displayName = "HrTableHeader";
