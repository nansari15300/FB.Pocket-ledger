"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";

/** i stem/dot — circle chrome se; border + i same color (CSS). */
const FRESH_INFO_STROKE = 1;

const FRESH_INFO_SIZES = {
  /** Switch track ke andar — pehle wala compact */
  embedded: { btn: "h-[13px] w-[13px] min-h-[13px] min-w-[13px]", icon: "h-2 w-2" },
  xs: { btn: "h-4 w-4 min-h-4 min-w-4", icon: "h-2.5 w-2.5" },
  sm: { btn: "h-[18px] w-[18px] min-h-[18px] min-w-[18px]", icon: "h-2.5 w-2.5" },
  md: { btn: "h-[22px] w-[22px] min-h-[22px] min-w-[22px]", icon: "h-3 w-3" },
  lg: { btn: "h-6 w-6 min-h-6 min-w-6", icon: "h-3.5 w-3.5" },
} as const;

export type AppFreshInfoSize = keyof typeof FRESH_INFO_SIZES;

export function AppFreshInfoMark({
  className,
  size = "sm",
}: {
  className?: string;
  size?: AppFreshInfoSize;
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn(FRESH_INFO_SIZES[size].icon, "shrink-0 text-current", className)}
      aria-hidden
    >
      <circle cx="6" cy="3.05" r={FRESH_INFO_STROKE / 2} fill="currentColor" />
      <path
        d="M6 5.15v4.35"
        fill="none"
        stroke="currentColor"
        strokeWidth={FRESH_INFO_STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function appFreshInfoBtnCn(size: AppFreshInfoSize = "sm", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full p-0 pl-chrome-btn-drop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60 focus-visible:ring-offset-1",
    FRESH_INFO_SIZES[size].btn,
    chromeProPillCn,
    "text-blue-300 hover:text-blue-400",
    className
  );
}

export type AppFreshInfoButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: AppFreshInfoSize;
};

/** Global (i) — blue circle + i same tone; use in popovers / tooltips / footers. */
export const AppFreshInfoButton = React.forwardRef<HTMLButtonElement, AppFreshInfoButtonProps>(
  function AppFreshInfoButton({ className, size = "sm", type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-pl-fresh-info=""
        data-pl-intro=""
        className={appFreshInfoBtnCn(size, className)}
        {...props}
      >
        <AppFreshInfoMark size={size} />
      </button>
    );
  }
);
