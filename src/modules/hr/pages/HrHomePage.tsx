"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Briefcase, CalendarCheck, CalendarOff, ChevronRight, Users, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";
import { HR_FIELD_SCOPE, HR_NARRATION_TEXT, HR_PAGE_BODY, HrHeaderCard, hrRibbon, type HrRibbonTone } from "../components/HrChrome";
import { PayrollPage } from "../payroll/pages/PayrollPage";
import { AttendancePage } from "./AttendancePage";
import { EmployeesPage } from "./EmployeesPage";
import { LeavesPage } from "./LeavesPage";

type HrSectionId = "employees" | "attendance" | "leaves" | "payroll";

type HrSection = {
  id: HrSectionId;
  label: string;
  hint: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: HrRibbonTone;
};

const HR_SECTIONS: HrSection[] = [
  { id: "employees", label: "Employees", hint: "Employee profiles", href: "/hr/employees", icon: Users, tone: "sky" },
  { id: "attendance", label: "Attendance", hint: "Daily attendance", href: "/hr/attendance", icon: CalendarCheck, tone: "emerald" },
  { id: "leaves", label: "Leaves", hint: "Leave requests", href: "/hr/leaves", icon: CalendarOff, tone: "amber" },
  { id: "payroll", label: "Payroll", hint: "Monthly salary", href: "/hr/payroll", icon: Wallet, tone: "violet" },
];

/** Tailwind `md` (768px): from this width the cards act as tabs and the section opens below them. */
const HR_TABS_MEDIA = "(min-width: 768px)";
const HR_TAB_PANEL_ID = "pl-hr-tab-panel";

function parseHrTab(value: string | null): HrSectionId {
  return HR_SECTIONS.find((s) => s.id === value)?.id ?? "employees";
}

/** True on PC / tablet / large mobile (md and up); false on small mobile, where a card opens its own page. */
function useHrTabsLayout(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(HR_TABS_MEDIA).matches);
  useEffect(() => {
    const mq = window.matchMedia(HR_TABS_MEDIA);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return wide;
}

function HrTabPanel({ tab }: { tab: HrSectionId }) {
  if (tab === "attendance") return <AttendancePage embedded />;
  if (tab === "leaves") return <LeavesPage embedded />;
  if (tab === "payroll") return <PayrollPage embedded />;
  return <EmployeesPage embedded />;
}

export function HrHomePage() {
  const { company } = useCompany();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabsLayout = useHrTabsLayout();
  const activeTab = parseHrTab(searchParams.get("tab"));

  /** Active tab lives in the URL (?tab=...), so refresh and back keep it. */
  const selectTab = useCallback(
    (id: HrSectionId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  const activeSection = HR_SECTIONS.find((s) => s.id === activeTab) ?? HR_SECTIONS[0];

  return (
    <div data-pl-hr-root="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", HR_FIELD_SCOPE)}>
      <div className={cn(HR_PAGE_BODY, tabsLayout && "h-auto shrink-0 overflow-visible pb-0")}>
        <HrHeaderCard tone="sky">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">HR</h1>
          <span className="text-sm text-muted-foreground">({company.name})</span>
        </HrHeaderCard>
        <div
          role={tabsLayout ? "tablist" : undefined}
          aria-label={tabsLayout ? "HR sections" : undefined}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {HR_SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = tabsLayout && s.id === activeTab;
            return (
              <Link
                key={s.id}
                href={s.href}
                className="block"
                role={tabsLayout ? "tab" : undefined}
                aria-selected={tabsLayout ? active : undefined}
                aria-controls={tabsLayout ? HR_TAB_PANEL_ID : undefined}
                data-pl-hr-tab-active={active ? "" : undefined}
                onClick={(e) => {
                  // Small mobile: normal link to the section page. md and up: switch the tab below.
                  if (!tabsLayout || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  selectTab(s.id);
                }}
              >
                <Card
                  className={cn(
                    hrRibbon(s.tone),
                    "h-full transition-shadow hover:shadow-md",
                    active && "shadow-md ring-1 ring-primary"
                  )}
                >
                  <CardContent className="flex h-full items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card/70">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.label}</div>
                      <div className={HR_NARRATION_TEXT}>{s.hint}</div>
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        active && "rotate-90 text-primary"
                      )}
                    />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
      {tabsLayout ? (
        <div
          id={HR_TAB_PANEL_ID}
          role="tabpanel"
          aria-label={activeSection.label}
          data-pl-hr-tab-panel={activeTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <HrTabPanel key={activeTab} tab={activeTab} />
        </div>
      ) : null}
    </div>
  );
}
