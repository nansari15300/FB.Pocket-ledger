"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardWelcomeClockLine } from "@/components/dashboard/DashboardWelcomeClockLine";
import { proDashboardRibbonClass } from "@/lib/proTheme";
import { cn } from "@/lib/utils";
import { useAnimationSettings } from "@/hooks/useAnimationSettings";

export const DAYBOOK_SHIFT_DATE_EVENT = "pl-daybook-shift-date";

export type DashboardWelcomeNewYearInfo = {
  event: string;
  isNewYear: boolean;
  daysLeft: number;
  year: number;
} | null;

type DashboardWelcomeFooterBannerProps = {
  greeting: string;
  displayName: string;
  newYearInfo: DashboardWelcomeNewYearInfo;
  className?: string;
  /** Dashboard merged footer stack — no card gap/shadow between rows. */
  embedded?: boolean;
  /** Recent desktop: flat rows, horizontal line only (no amber box). */
  lineSections?: boolean;
  /** Daybook desktop: prev/next day on this ribbon (toolbar arrows hidden). */
  showDaybookDateNav?: boolean;
};

function dispatchDaybookDateShift(deltaDays: -1 | 1) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DAYBOOK_SHIFT_DATE_EVENT, { detail: deltaDays }));
}

/** Greeting + live clock — dashboard tab bar ke upar fixed footer strip. */
export function DashboardWelcomeFooterBanner({
  greeting,
  displayName,
  newYearInfo,
  className,
  embedded = false,
  lineSections = false,
  showDaybookDateNav = false,
}: DashboardWelcomeFooterBannerProps) {
  const { settings: animationSettings, loading: animationSettingsLoading } = useAnimationSettings();
  /** Settings → Row Animation off → New Year pop-in nahi (seedha final state). */
  const motionOn = !animationSettingsLoading && animationSettings?.rows?.enabled === true;
  const shellCn = cn(
    "col-span-full overflow-hidden relative py-1 px-2",
    lineSections
      ? "rounded-none border-0 bg-background shadow-none"
      : cn(
          proDashboardRibbonClass(3),
          embedded
            ? "rounded-none border-0 bg-background shadow-none"
            : "border shadow-sm",
        ),
    className
  );
  const body = (
    <>
      {newYearInfo && !newYearInfo.isNewYear ? (
        <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-md animate-pulse">
          {newYearInfo.daysLeft} days to {newYearInfo.year}!
        </div>
      ) : null}
      <CardHeader className="relative p-0 text-center space-y-0">
        {newYearInfo?.isNewYear ? (
          <div className="flex flex-col items-center justify-center py-0.5">
            <motion.div
              initial={motionOn ? { scale: 0, y: 12 } : false}
              animate={{ scale: 1, y: 0 }}
              transition={motionOn ? { type: "spring", stiffness: 260, damping: 20 } : { duration: 0 }}
              className="text-lg font-bold leading-tight bg-gradient-to-r from-amber-400 via-red-500 to-fuchsia-600 bg-clip-text text-transparent sm:text-xl"
            >
              {newYearInfo.event}
            </motion.div>
            <p className="text-xs font-semibold">{displayName}</p>
          </div>
        ) : (
          <CardTitle className="text-sm font-bold leading-snug text-green-600 dark:text-green-400 sm:text-base">
            {greeting}, {displayName}! Welcome To Pocket Ledger
          </CardTitle>
        )}
        <DashboardWelcomeClockLine className="text-[11px] leading-tight sm:text-xs" />
      </CardHeader>
    </>
  );
  if (embedded) {
    return <div className={shellCn}>{body}</div>;
  }
  return <Card className={shellCn}>{body}</Card>;
}

/** Scroll padding for fixed welcome strip above dashboard tabs / ledger footer. */
export function dashboardWelcomeFooterReservePx(newYearInfo: DashboardWelcomeNewYearInfo): number {
  return newYearInfo?.isNewYear ? 72 : 54;
}
