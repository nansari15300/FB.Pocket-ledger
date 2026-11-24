"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { LEDGER_HEADER_PILL_ROW_CN } from "@/lib/ledgerHeaderChrome";
import { LedgerHeaderFullscreenButton } from "@/components/vouchers/LedgerHeaderFullscreenButton";

/** Right 50% txn ribbon. Expand stays top-right on report pages. */
export function LedgerHeaderPillRow({
  children,
  className,
  fullscreen = true,
  ...props
}: ComponentProps<"div"> & { fullscreen?: boolean }) {
  return (
    <div
      className={cn(LEDGER_HEADER_PILL_ROW_CN, className)}
      {...props}
    >
      {children}
      {fullscreen ? (
        <div data-pl-ledger-header-window-controls="">
          <LedgerHeaderFullscreenButton />
        </div>
      ) : null}
    </div>
  );
}
