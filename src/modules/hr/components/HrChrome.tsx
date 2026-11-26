"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { voucherTypePillClassName } from "@/components/vouchers/transactionTableShared";
import { mlc, mlcListChromeRootData } from "@/lib/mobileListChrome";
import { cn } from "@/lib/utils";

/**
 * HR page chrome built only from shared app pieces:
 * - Card (ui/card) + `pl-dashboard-tone-card pl-dashboard-ribbon-*` (StockSummary / Financial Summary cards) for colourful sections;
 * - Staff list search row (`mlc.searchRow` + Input `listChrome listChromeSearch`, staff/page.tsx);
 * - ledger type pills (`voucherTypePillClassName`, TransactionsTable Type column) for status badges.
 * Every line is the theme's own 1px line; no colours are hardcoded here.
 */

export type HrRibbonTone = "emerald" | "sky" | "violet" | "amber" | "rose" | "teal" | "indigo";

const RIBBON: Record<HrRibbonTone, string> = {
  emerald: "pl-dashboard-tone-card pl-dashboard-ribbon-emerald",
  sky: "pl-dashboard-tone-card pl-dashboard-ribbon-sky",
  violet: "pl-dashboard-tone-card pl-dashboard-ribbon-violet",
  amber: "pl-dashboard-tone-card pl-dashboard-ribbon-amber",
  rose: "pl-dashboard-tone-card pl-dashboard-ribbon-rose",
  teal: "pl-dashboard-tone-card pl-dashboard-ribbon-teal",
  indigo: "pl-dashboard-tone-card pl-dashboard-ribbon-indigo",
};

export function hrRibbon(tone: HrRibbonTone) {
  return RIBBON[tone];
}

/** Scroll body of every HR page. */
export const HR_PAGE_BODY = "h-full min-h-0 space-y-3 overflow-y-auto p-3";

/**
 * HR field scope (put on the HR page root, HR dialogs and the Staff form HR section):
 * every input (text, number, date, month, search), textarea and select trigger inside gets a 1px border in the
 * app pill blue (`border-blue-300`, the same class as chromeProPillCn / outline pill buttons); focus = primary.
 * Theme form rules (e.g. Pro `main input` black border, `main .rounded-md.border` #000) are !important with up to
 * [0,21,2] / [2,3,1] specificity, so these selectors carry three never-matching `:not(#id)` parts ([3,x,x]) to win.
 * Only the border changes (background and size stay as the theme sets them). Checkbox / radio and `border-0` fields are skipped.
 * Every class is also listed in src/app/(dashboard)/hr/hrTailwindClasses.ts.
 */
export const HR_FIELD_SCOPE = [
  "[&_input:not([type=checkbox]):not([type=radio]):not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope)]:!border",
  "[&_input:not([type=checkbox]):not([type=radio]):not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope)]:!border-blue-300",
  "[&_input:not([type=checkbox]):not([type=radio]):not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope):focus-visible]:!border-primary",
  "[&_textarea:not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope)]:!border",
  "[&_textarea:not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope)]:!border-blue-300",
  "[&_textarea:not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope):focus-visible]:!border-primary",
  "[&_button[role=combobox]:not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope)]:!border",
  "[&_button[role=combobox]:not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope)]:!border-blue-300",
  "[&_button[role=combobox]:not(.border-0):not(#pl-hr-none):not(#pl-hr-field):not(#pl-hr-scope):focus-visible]:!border-primary",
].join(" ");

/** Header-strip pickers (month / date) and the debit account select: pill shape like the This month / Refresh buttons. */
export const HR_FIELD_PILL = "h-9 rounded-full px-3";

/**
 * Description / help line on HR pages: same look as the Narration sub-row in the transaction table
 * (`src/components/vouchers/transactionTableShared.tsx` NarrationRow: `text-[11px] italic leading-tight` + `font-normal`,
 * wrap `whitespace-normal break-words`). Narration uses `text-black`; here the theme token `text-foreground` is used instead.
 */
export const HR_NARRATION_TEXT = "text-[11px] italic leading-tight font-normal text-foreground whitespace-normal break-words";

/** Page header strip (title + actions) — Dashboard ribbon card. */
export function HrHeaderCard({
  tone = "sky",
  className,
  children,
}: {
  tone?: HrRibbonTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-pl-hr-header="" className={cn(hrRibbon(tone), "flex flex-wrap items-center gap-2 px-3 py-2", className)}>
      {children}
    </Card>
  );
}

/** Search box — same chrome as the Staff list search. */
export function HrSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div {...mlcListChromeRootData} className={cn("max-w-sm", className)}>
      <div className={cn(mlc.searchRow, "px-0")}>
        <div className={mlc.searchWrap}>
          <Search className={mlc.searchIcon} />
          <Input
            listChrome
            listChromeSearch
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel || placeholder}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}

export type HrPillTone = "good" | "info" | "muted" | "bad";

/**
 * Status badge = the ledger Type pill (outline Badge + `voucherTypePillClassName`):
 * good = green (Dr), bad = red outline (Cr), info = blue, muted = grey outline (ledger Journal / Note).
 */
const PILL_MUTED = "border-muted-foreground/40 text-muted-foreground";

function hrPillClassName(tone: HrPillTone): string {
  if (tone === "good") return voucherTypePillClassName("dr");
  if (tone === "bad") return voucherTypePillClassName("cr");
  if (tone === "info") return voucherTypePillClassName(null, { interCompanyReversed: true });
  return cn(voucherTypePillClassName(null), PILL_MUTED);
}

export function HrPill({
  tone,
  className,
  children,
  title,
}: {
  tone: HrPillTone;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Badge variant="outline" data-pl-hr-pill={tone} title={title} className={cn(hrPillClassName(tone), className)}>
      {children}
    </Badge>
  );
}
