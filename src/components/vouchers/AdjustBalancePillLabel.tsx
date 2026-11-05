"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ADJUST_BALANCE_PILL_CN,
  LEDGER_CLOSING_BALANCE_ADJUST_PILL_CN,
} from "@/lib/ledgerHeaderChrome";
import { publicAssetUrl } from "@/lib/webAppBasePath";
import { useIsMobile } from "@/hooks/use-mobile";

/** Adjust Balance pill — pointing-hand pic (Closing Balance ki taraf). Mobile label: "Ajt Blc". */
export function AdjustBalancePillLabel() {
  const isMobile = useIsMobile();
  return (
    <>
      {isMobile ? (
        <span className="whitespace-nowrap" data-pl-no-translate="">
          Ajt Blc
        </span>
      ) : (
        "Adjust Balance"
      )}
      <img
        src={publicAssetUrl("/adjust-balance-point.png")}
        alt=""
        width={18}
        height={18}
        className="ml-1 inline-block h-[18px] w-[18px] shrink-0 object-contain align-middle"
        aria-hidden
        draggable={false}
      />
    </>
  );
}

/** Ledger closing footer — same width/height as `MasterAccountFreezeOwnerToggle` pill. */
export function AdjustBalanceLedgerPillButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      data-pl-adjust-balance-closing-pill=""
      className={cn(
        ADJUST_BALANCE_PILL_CN,
        LEDGER_CLOSING_BALANCE_ADJUST_PILL_CN,
        "!h-[27px] min-h-[27px] text-xs",
        className
      )}
      {...props}
    >
      <AdjustBalancePillLabel />
    </Button>
  );
}
