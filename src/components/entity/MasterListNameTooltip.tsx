"use client";

import * as React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { masterListNameTriggerCn } from "@/lib/listSelectionChrome";
import { useIsTextTruncated } from "@/hooks/useIsTextTruncated";

/** Mark inner truncate lines (Party/IC two-line titles) for overflow detection. */
export function masterListNameMeasureProps(className?: string) {
  return {
    "data-pl-master-list-name-measure": "",
    className: cn("block w-full truncate", className),
  } as const;
}

type MasterListNameTooltipProps = {
  children: React.ReactNode;
  tooltipContent: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
  align?: React.ComponentProps<typeof TooltipContent>["align"];
  /** Re-measure when label or list layout changes. */
  measureKey?: string | number;
};

/**
 * Master list naam hover — sirf jab text clip / ellipsis ho (…).
 * Web, Electron, Capacitor: ResizeObserver se measure.
 *
 * IMPORTANT (infinite loop fix): jab text truncate nahi hai, Radix `Tooltip` **mount hi nahi hota**.
 * Pehle har row me `Tooltip`/`TooltipTrigger`/`PopperAnchor` mounted rehta tha aur Radix ke composed
 * refs (`setRef` -> setState) commit ke waqt chain-reaction bana kar
 * "Maximum update depth exceeded" dete the (Party Statement ke group tree me saaf dikhta tha).
 * Ab non-truncated rows sirf ek plain `<button>` hain — koi Radix ref, koi state update nahi.
 */
export function MasterListNameTooltip({
  children,
  tooltipContent,
  className,
  triggerClassName = masterListNameTriggerCn,
  side = "bottom",
  align = "start",
  measureKey,
}: MasterListNameTooltipProps) {
  const plainRef = React.useRef<HTMLButtonElement>(null);
  /* `children` ko deps me mat daalo — ye har parent re-render par naya object hota hai.
   * `measureKey` hi label/layout badalne ka stable signal hai. */
  const isTruncated = useIsTextTruncated(plainRef, [measureKey]);
  const [open, setOpen] = React.useState(false);

  const triggerProps = {
    type: "button" as const,
    ref: plainRef,
    "data-pl-list-name": "",
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    className: cn(triggerClassName, className),
  };

  // Not clipped → no tooltip needed, and no Radix tree mounted at all.
  if (!isTruncated) {
    return <button {...triggerProps}>{children}</button>;
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger ref={plainRef} {...triggerProps} data-pl-list-name="">
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
