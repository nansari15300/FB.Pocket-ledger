"use client";

import Link from "next/link";
import { Briefcase, CalendarCheck, CalendarOff, ChevronRight, Users, Wallet } from "lucide-react";
import { useCompany } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";

type HrSection = {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
};

const HR_SECTIONS: HrSection[] = [
  { id: "employees", label: "Employees", hint: "कर्मचारी profile", href: "/hr/employees", icon: Users, active: true },
  { id: "attendance", label: "Attendance", hint: "हाज़िरी", href: "/hr/attendance", icon: CalendarCheck, active: true },
  { id: "leaves", label: "Leaves", hint: "छुट्टी", href: "/hr/leaves", icon: CalendarOff, active: true },
  { id: "payroll", label: "Payroll", hint: "वेतन", href: "/hr/payroll", icon: Wallet, active: false },
];

export function HrHomePage() {
  const { company } = useCompany();

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="h-full min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">HR</h1>
          <span className="text-sm text-muted-foreground">({company.name})</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HR_SECTIONS.map((s) => {
            const Icon = s.icon;
            const body = (
              <div
                className={cn(
                  "flex h-full items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors",
                  s.active ? "hover:bg-muted/60" : "cursor-not-allowed opacity-60"
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.active ? s.hint : "जल्द आ रहा है"}</div>
                </div>
                {s.active ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
              </div>
            );
            return s.active ? (
              <Link key={s.id} href={s.href} className="block">
                {body}
              </Link>
            ) : (
              <div key={s.id} aria-disabled="true" title="जल्द आ रहा है">
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
