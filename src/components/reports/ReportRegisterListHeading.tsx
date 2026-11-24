"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ReportRegisterListHeadingProps = {
  children: ReactNode;
  className?: string;
};

/** Register / legacy report list column title. */
export function ReportRegisterListHeading({ children, className }: ReportRegisterListHeadingProps) {
  const title =
    typeof children === "string" && !/\breport\b/i.test(children)
      ? `${children} Report`
      : children;
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <h2 className="min-w-0 truncate text-lg font-bold font-headline">{title}</h2>
    </div>
  );
}
