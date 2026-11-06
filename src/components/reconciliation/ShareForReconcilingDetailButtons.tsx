"use client";

import * as React from "react";
import { Info, Scale } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShareForReconciliationDialog } from "@/components/reconciliation/ShareForReconciliationDialog";
import { useReconciliationFeature } from "@/hooks/useReconciliationFeature";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { pickReconIntro } from "@/lib/reconciliation/reconIntroCopy";
import { LEDGER_HEADER_PILL_CN } from "@/lib/ledgerHeaderChrome";
import { cn } from "@/lib/utils";

type Props = {
  /** Party id of the open account detail (pre-selected in the dialog). */
  accountId: string;
  /** Hide (e.g. frozen/system/all rows) */
  disabled?: boolean;
};

const PILL_PART_CN =
  "inline-flex h-full items-center justify-center whitespace-nowrap bg-transparent text-xs text-inherit outline-none transition-colors hover:bg-blue-200/70 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

/**
 * Party detail pages: ONE pill "[icon Share | (i)]" placed left of Adjust Balance.
 * Main part opens the Share for Reconciling dialog; the (i) part opens the intro popover.
 * The pill is a span wrapper holding two sibling <button>s (no nested buttons).
 * Renders as a single flex item so the closing-row container's gap-2 spaces it from Adjust Balance.
 * Same gating as the PC header button (plan + company setting + permissions).
 */
export function ShareForReconcilingDetailButtons({ accountId, disabled }: Props) {
  const { enabled, canShare, canLink, canView, canViewSharedList, canViewUnlinkedList } =
    useReconciliationFeature();
  const i18n = usePlI18nOptional();
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  if (!enabled || !accountId) return null;
  if (!(canShare || canLink || canView || canViewSharedList || canViewUnlinkedList)) return null;

  const intro = pickReconIntro(i18n?.intro ?? "en");

  return (
    <>
      <span
        data-pl-share-recon-detail-pill=""
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          LEDGER_HEADER_PILL_CN,
          "!h-[27px] min-h-[27px] gap-0 overflow-hidden !px-0 text-xs",
          disabled && "opacity-50"
        )}
      >
        <button
          type="button"
          disabled={disabled}
          className={cn(PILL_PART_CN, "gap-1 rounded-l-full pl-2.5 pr-2")}
          title="Share account ledger for reconciling with another user"
          onClick={(e) => {
            e.stopPropagation();
            setMounted(true);
            setOpen(true);
          }}
        >
          <Scale className="h-3.5 w-3.5 shrink-0" />
          {isMobile ? "Share" : "Share for Reconciling"}
        </button>
        <span aria-hidden className="h-3.5 w-px shrink-0 bg-current opacity-30" />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(PILL_PART_CN, "rounded-r-full pl-1.5 pr-2")}
              aria-label="Share for Reconciling info"
              title="Share for Reconciling info"
              data-pl-share-recon-info-btn=""
              onClick={(e) => e.stopPropagation()}
            >
              <Info className="h-3.5 w-3.5 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={8}
            className="z-[200] w-[min(22rem,calc(100vw-1.5rem))] p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="border-b px-3 py-2">
              <p className="text-sm font-semibold leading-tight" data-pl-intro="">
                {intro.title}
              </p>
            </div>
            <ul className="space-y-0 divide-y text-xs leading-snug text-muted-foreground">
              <li className="px-3 py-2" data-pl-intro="">{intro.share}</li>
              <li className="px-3 py-2" data-pl-intro="">{intro.link}</li>
              <li className="px-3 py-2" data-pl-intro="">{intro.recon}</li>
              <li className="px-3 py-2" data-pl-intro="">{intro.manage}</li>
            </ul>
            <p
              className="border-t px-3 py-2 text-[11px] font-medium leading-snug text-foreground"
              data-pl-intro=""
            >
              {intro.note}
            </p>
          </PopoverContent>
        </Popover>
      </span>
      {mounted ? (
        <ShareForReconciliationDialog
          open={open}
          onOpenChange={setOpen}
          initialEntityType="party"
          initialAccountId={accountId}
        />
      ) : null}
    </>
  );
}