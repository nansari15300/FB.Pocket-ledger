"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HR_FIELD_SCOPE, HR_PAGE_BODY, HrHeaderCard } from "../../components/HrChrome";
import { SalarySlipActions, SalarySlipStatusPill, SalarySlipView, useSalarySlip } from "../components/SalarySlipView";

export type SalarySlipPageProps = {
  /** Payroll record app_id (`pay_<employee>_<YYYY-MM>`). */
  id: string;
};

/**
 * Salary slip as its own page (/hr/payroll/slip/<id>, for direct links and the static export).
 * The Payroll table opens the same slip in a popup (SalarySlipDialog); both use SalarySlipView.
 */
export function SalarySlipPage({ id }: SalarySlipPageProps) {
  const router = useRouter();
  const slip = useSalarySlip(id);

  if (!slip.company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  return (
    <div data-pl-hr-root="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", HR_FIELD_SCOPE)}>
      <div className={HR_PAGE_BODY}>
        <HrHeaderCard tone="violet" className="hr-slip-noprint">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr/payroll")} aria-label="Back to payroll">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Salary slip</h1>
          <SalarySlipStatusPill slip={slip} />
          <SalarySlipActions slip={slip} className="ml-auto" />
        </HrHeaderCard>
        <SalarySlipView slip={slip} />
      </div>
    </div>
  );
}
