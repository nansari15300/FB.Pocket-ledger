import type { Staff } from "@/components/staff/types";
import type { HrSalaryType } from "../types";

/** Staff.salary / salaryPeriod se HR salary_type + base_salary prefill. */
export function salaryPrefillFromStaff(staff: Pick<Staff, "salary" | "salaryPeriod"> | null | undefined): {
  salary_type: HrSalaryType;
  base_salary: number;
} {
  const amount = Number(staff?.salary || 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  switch (staff?.salaryPeriod) {
    case "Daily":
      return { salary_type: "daily", base_salary: safe };
    case "Weekly":
      // Weekly → monthly approx (52 weeks / 12 months).
      return { salary_type: "monthly", base_salary: Math.round(((safe * 52) / 12) * 100) / 100 };
    case "Yearly":
      return { salary_type: "monthly", base_salary: Math.round((safe / 12) * 100) / 100 };
    case "Monthly":
    default:
      return { salary_type: "monthly", base_salary: safe };
  }
}

export function todayIsoDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
