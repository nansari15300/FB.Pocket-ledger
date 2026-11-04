"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Briefcase, Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";

/**
 * Wrapper for HR pages: children render only when the plan has HR (hrModuleEnabled) and the
 * role has hr_view. Otherwise a friendly "not in your plan" / "no access" screen. Spinner while loading.
 */
export function HrGate({ children }: { children: ReactNode }) {
  const { enabled, loading, planEnabled } = useHrModuleFeature();

  if (loading) return <LoadingSpinner />;
  if (enabled) return <>{children}</>;

  const reason = planEnabled
    ? "Your role does not have permission to view HR (hr_view). Ask the company owner or an admin."
    : "HR is not included in your plan. Upgrade your plan to use HR (Employees, Attendance, Leaves, Payroll).";

  return (
    <div data-pl-hr-root="" className="flex h-full min-h-0 flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {planEnabled ? (
            <Lock className="h-6 w-6 text-muted-foreground" />
          ) : (
            <Briefcase className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <h2 className="text-lg font-semibold">
          {planEnabled ? "No HR access" : "HR is not in your plan"}
        </h2>
        <p data-pl-intro="" className="mt-2 text-sm text-muted-foreground">
          {reason}
        </p>
        {!planEnabled ? (
          <Button asChild className="mt-4" size="sm">
            <Link href="/billing">Billing &amp; Plans</Link>
          </Button>
        ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
