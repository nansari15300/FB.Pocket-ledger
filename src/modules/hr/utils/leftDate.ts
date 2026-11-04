import type { HrEmployee } from "../types";
import { isIsoDate } from "./attendance";

type LeftInfo = Pick<HrEmployee, "status"> & { left_date?: string | null };

/** Left date (YYYY-MM-DD) of an employee whose status is "left"; "" when active or the date is not set. */
export function employeeLeftDate(e: LeftInfo | null | undefined): string {
  if (!e || e.status !== "left") return "";
  const d = String(e.left_date || "").trim();
  return isIsoDate(d) ? d : "";
}

/** True when `date` is after the employee's left date: no attendance and no pay on that day. */
export function isAfterLeftDate(e: LeftInfo | null | undefined, date: string): boolean {
  const left = employeeLeftDate(e);
  return !!left && date > left;
}

/**
 * True when attendance can be marked for the employee on `date`:
 * joined on or before it, and active, or left with a left date on or after it.
 */
export function isEmployeeWorkingOn(e: LeftInfo & Pick<HrEmployee, "joining_date">, date: string): boolean {
  if (e.joining_date && isIsoDate(e.joining_date) && e.joining_date > date) return false;
  if (e.status === "active") return true;
  const left = employeeLeftDate(e);
  return !!left && date <= left;
}
