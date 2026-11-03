"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Briefcase, Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";

/**
 * HR pages ka wrapper: plan (hrModuleEnabled) + hr_view permission dono hon tabhi children.
 * Warna friendly "plan me nahi" screen. Loading par spinner.
 */
export function HrGate({ children }: { children: ReactNode }) {
  const { enabled, loading, planEnabled } = useHrModuleFeature();

  if (loading) return <LoadingSpinner />;
  if (enabled) return <>{children}</>;

  const reason = planEnabled
    ? "आपके role में HR देखने की permission (hr_view) नहीं है। Company owner/admin से पूछें।"
    : "HR आपके plan में उपलब्ध नहीं है। HR (Employees, Attendance, Leaves, Payroll) के लिए plan upgrade करें।";

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {planEnabled ? (
            <Lock className="h-6 w-6 text-muted-foreground" />
          ) : (
            <Briefcase className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <h2 className="text-lg font-semibold">
          {planEnabled ? "HR access नहीं है" : "HR आपके plan में उपलब्ध नहीं है"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
        {!planEnabled ? (
          <Button asChild className="mt-4" size="sm">
            <Link href="/billing">Billing &amp; Plans</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
