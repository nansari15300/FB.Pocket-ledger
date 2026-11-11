import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";

/** Report header + filter pills — same blue chrome, same height */
export const financialSummaryPillCn = cn(
  chromeProPillCn,
  "h-10 min-h-10 rounded-full px-3 text-sm"
);

/** Report list (`MasterListRow`) jaisa shell — Pro theme black border override se bachne ke liye tone-card. */
export const financialSummaryCardClass = cn(
  "pl-dashboard-tone-card pl-dashboard-ribbon-emerald shadow-sm"
);

/** Report list border match — `globals.css` `[data-pl-financial-summary-card]` */
export const financialSummaryCardProps = {
  "data-pl-financial-summary-card": "",
} as const;

/** Data row with dim black divider below */
export const financialSummaryRowClass = cn(
  "flex items-center justify-between py-2 text-sm border-b border-foreground/20"
);

/**
 * Hairline (exactly 1px) horizontal divider — row ke upar, text se pehle.
 * Global theme CSS card borders ko 3px !important karti hai; stock card ke Top-5 rows ki line 1px chahiye,
 * isliye dedicated attribute selector (theme CSS se neeche) + inline 1px fallback.
 */
export const financialSummaryHairlineRowClass = cn(
  "flex items-center justify-between gap-2 border-t border-t-[color:var(--border)]",
  "[border-top-width:1px] [border-top-style:solid]"
);

/** Subtotal / total row */
export const financialSummaryTotalRowClass = cn(
  "flex items-center justify-between py-2.5 text-sm font-semibold border-t border-foreground/30"
);

export const financialSummarySectionTitleClass = cn(
  "text-sm font-semibold py-2 border-b border-foreground/20"
);
