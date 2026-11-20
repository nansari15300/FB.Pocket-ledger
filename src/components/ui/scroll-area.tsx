
"use client"

import * as React from "react"

import { cn } from "@/lib/utils"


/**
 * Reports list / master-detail list ka scroll body.
 *
 * Pehle yahan Radix `ScrollArea` tha. PC (mouse) par Radix apna bar hover ke waqt mount karta hai
 * (tab hi `[data-orientation]` node banta hai), aur usi hover par dashboard ke `overflow-y-auto`
 * main ka native page bar bhi dikh jata tha — reports list ke right edge par do scrollbar dikhte the.
 * Ye native scroller hai: sirf ek OS bar, hover par kabhi doosra bar nahi banta. Chrome classes
 * same rakhi gayi hain (`pl-master-list-scroll`, `pl-ledger-txn-scroll`), isliye purani theme CSS
 * isi element par lagti hai.
 */
type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Master-detail list: `globals.css` `pl-master-list-scroll` */
  listChrome?: boolean;
  /** Ledger / report txn table vertical scroll (`pl-ledger-txn-scroll`) */
  txnChrome?: boolean;
  /** Inter Company voucher — light gray thumb; gutter par border-l nahi (4K black line avoid) */
  icVoucherChrome?: boolean;
  /** Viewport scroll (list scroll, not the root) */
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
  onViewportTouchMove?: React.TouchEventHandler<HTMLDivElement>;
};

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      className,
      children,
      listChrome,
      txnChrome,
      icVoucherChrome,
      onViewportScroll,
      onViewportTouchMove,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        "relative overflow-x-hidden overflow-y-auto",
        listChrome && "pl-master-list-scroll",
        txnChrome && "pl-ledger-txn-scroll",
        className
      )}
      onScroll={onViewportScroll}
      onTouchMove={onViewportTouchMove}
      data-pl-native-scroll=""
      data-pl-ic-voucher-scroll={icVoucherChrome ? "" : undefined}
      {...props}
    >
      {children}
    </div>
  )
)
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }
