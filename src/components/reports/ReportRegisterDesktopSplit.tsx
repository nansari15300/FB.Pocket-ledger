"use client";

import * as React from "react";
import { ResizeWidthHandle, useResizablePixelWidth } from "@/components/layout/ResizablePaneWidth";

type ReportRegisterDesktopSplitProps = {
  listPanel: React.ReactNode;
  detailPanel: React.ReactNode;
  /** localStorage key — shared default keeps width across Sales/Purchase/etc. */
  storageKey?: string;
  resizeTitle?: string;
};

/** Desktop report register: resizable account/payee list + detail (Reports list jaisa drag handle). */
export function ReportRegisterDesktopSplit({
  listPanel,
  detailPanel,
  storageKey = "pl-report-register-account-list-width-px",
  resizeTitle = "Resize account list",
}: ReportRegisterDesktopSplitProps) {
  const { widthPx, beginResize } = useResizablePixelWidth({
    storageKey,
    defaultPx: 320,
    minPx: Math.round(256 * 0.7),
    maxPx: 450,
  });

  return (
    <div
      className="grid h-full min-h-0 flex-1 overflow-hidden"
      style={{ gridTemplateColumns: `${widthPx}px minmax(0, 1fr)` }}
    >
      <div
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-muted/30"
        data-pl-master-list-chrome=""
        data-pl-report-register-list=""
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listPanel}</div>
        <ResizeWidthHandle onPointerDown={beginResize} title={resizeTitle} />
      </div>
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-pl-report-register-trxn=""
        data-pl-report-ledger-txn-detail=""
      >
        {detailPanel}
      </div>
    </div>
  );
}
