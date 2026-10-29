"use client";

import { Building2, HardDrive, Server } from "lucide-react";
import type { Company } from "@/hooks/useCompany";
import { resolveCompanySelectorGateInfo } from "@/lib/companySelectorGateLabel";
import { cn } from "@/lib/utils";

export function CompanyUnlockGateBadge({
  company,
  className,
}: {
  company: Company;
  className?: string;
}) {
  const info = resolveCompanySelectorGateInfo(company);
  const Icon =
    info.tabLabel === "PL Server" || info.tabLabel === "PocketBase"
      ? Server
      : info.tabLabel === "Firebase"
        ? Building2
        : HardDrive;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm",
        className
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        Gate: <span className="font-medium text-foreground">{info.tabLabel}</span>
        {info.gateName ? (
          <span className="text-muted-foreground"> · {info.gateName}</span>
        ) : null}
      </span>
    </div>
  );
}
