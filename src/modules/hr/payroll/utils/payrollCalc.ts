import type { HrAttendance, HrEmployee, HrLeave, HrPayroll } from "../../types";
import { attendanceKey, isIsoDate, latestAttendanceByKey, monthRange } from "../../utils/attendance";
import { approvedLeaveOn } from "../../utils/leaves";

/** 2 decimal rounding (paisa). */
export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Deterministic payroll app_id: ek employee + ek month = ek record. */
export function hrPayrollAppId(employeeAppId: string, month: string): string {
  return `pay_${String(employeeAppId).trim()}_${String(month).trim()}`.slice(0, 200);
}

/** `pay_<employee>_<YYYY-MM>` → { employee, month } (invalid → null). */
export function parseHrPayrollAppId(appId: string): { employee: string; month: string } | null {
  const m = /^pay_(.+)_(\d{4}-\d{2})$/.exec(String(appId || "").trim());
  if (!m) return null;
  return { employee: m[1], month: m[2] };
}

export function isIsoMonth(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || "").trim());
}

export function payrollKey(employeeAppId: string, month: string): string {
  return `${employeeAppId}|${month}`;
}

/** Same employee+month ke multiple rows me se latest non-deleted. Key = payrollKey(employee, month). */
export function latestPayrollByKey(records: HrPayroll[]): Map<string, HrPayroll> {
  const out = new Map<string, HrPayroll>();
  for (const r of records) {
    if (!r || r.deleted === true || !r.employee || !r.month) continue;
    const k = payrollKey(r.employee, r.month);
    const prev = out.get(k);
    // Posted record hamesha draft par jeetta hai (double-post se bachav).
    if (prev && prev.status === "posted" && r.status !== "posted") continue;
    if (!prev || (r.status === "posted" && prev.status !== "posted") || Number(r.updatedAtMs || 0) >= Number(prev.updatedAtMs || 0)) {
      out.set(k, r);
    }
  }
  return out;
}

export type PayrollDayCounts = {
  present: number;
  half_day: number;
  holiday: number;
  /** Paid leave days (casual / sick / paid, ya attendance "leave" bina unpaid approved leave). */
  paid_leave: number;
  /** Unpaid leave days (approved leave_type "unpaid") — pay nahi. */
  unpaid_leave: number;
  absent: number;
  /** Na attendance record na approved leave. */
  unmarked: number;
  /** Joining se pehle ke din (count nahi). */
  not_joined: number;
};

export type PayrollCalcResult = {
  month: string;
  days_in_month: number;
  counts: PayrollDayCounts;
  /** present + 0.5*half_day + holiday + paid_leave */
  payable_days: number;
  salary_type: HrEmployee["salary_type"];
  base_salary: number;
  gross: number;
};

export function emptyDayCounts(): PayrollDayCounts {
  return { present: 0, half_day: 0, holiday: 0, paid_leave: 0, unpaid_leave: 0, absent: 0, unmarked: 0, not_joined: 0 };
}

/**
 * Ek employee + month ka payable days + gross.
 * - Attendance record pehle: present=1, half_day=0.5, holiday=1, absent=0.
 * - Attendance "leave": us din approved leave_type "unpaid" ho to unpaid, warna paid.
 * - Record nahi par approved leave: unpaid → unpaid, baaki → paid leave.
 * - monthly: gross = base * payable / days_in_month; daily: gross = base * payable. 2 decimal.
 */
export function computeEmployeePayroll(
  employee: Pick<HrEmployee, "app_id" | "salary_type" | "base_salary" | "joining_date">,
  month: string,
  attendance: HrAttendance[],
  approvedLeaves: HrLeave[] = []
): PayrollCalcResult | null {
  const range = monthRange(month);
  if (!range) return null;
  const counts = emptyDayCounts();
  const own = attendance.filter((a) => a && a.employee === employee.app_id);
  const byKey = latestAttendanceByKey(own);
  const leaves = approvedLeaves.filter((l) => l && l.status === "approved" && l.deleted !== true);
  const joining = employee.joining_date && isIsoDate(employee.joining_date) ? employee.joining_date : "";

  for (const d of range.days) {
    const rec = byKey.get(attendanceKey(employee.app_id, d));
    if (!rec && joining && d < joining) {
      counts.not_joined += 1;
      continue;
    }
    const leave = approvedLeaveOn(leaves, employee.app_id, d);
    if (rec) {
      switch (rec.status) {
        case "present":
          counts.present += 1;
          break;
        case "half_day":
          counts.half_day += 1;
          break;
        case "holiday":
          counts.holiday += 1;
          break;
        case "leave":
          if (leave && leave.leave_type === "unpaid") counts.unpaid_leave += 1;
          else counts.paid_leave += 1;
          break;
        case "absent":
        default:
          counts.absent += 1;
          break;
      }
      continue;
    }
    if (leave) {
      if (leave.leave_type === "unpaid") counts.unpaid_leave += 1;
      else counts.paid_leave += 1;
      continue;
    }
    counts.unmarked += 1;
  }

  const payable_days = round2(counts.present + 0.5 * counts.half_day + counts.holiday + counts.paid_leave);
  const days_in_month = range.days.length;
  const base = Number(employee.base_salary || 0);
  const base_salary = Number.isFinite(base) ? base : 0;
  const gross =
    employee.salary_type === "daily"
      ? round2(base_salary * payable_days)
      : round2(days_in_month > 0 ? (base_salary * payable_days) / days_in_month : 0);

  return {
    month,
    days_in_month,
    counts,
    payable_days,
    salary_type: employee.salary_type,
    base_salary,
    gross,
  };
}

/** net = gross + addition - deductions (2 decimal, kabhi negative nahi). */
export function computeNet(gross: number, deductions: number, addition = 0): number {
  return Math.max(0, round2(Number(gross || 0) + Number(addition || 0) - Number(deductions || 0)));
}

/** `data` JSON ke andar payroll extras (schema change ke bina). */
export type HrPayrollData = {
  /** Bonus / addition (gross ke upar). */
  addition?: number;
  addition_note?: string;
  deduction_note?: string;
  payable_days?: number;
  days_in_month?: number;
  salary_type?: string;
  base_salary?: number;
  counts?: PayrollDayCounts;
  /** Voucher ban gaya par /payroll/post fail hua → retry bina naya voucher. */
  pending_voucher_app_id?: string;
  voucher_number?: string;
  posted_at?: number;
};

export function payrollData(rec: Pick<HrPayroll, "data"> | null | undefined): HrPayrollData {
  const d = rec?.data;
  return d && typeof d === "object" ? (d as HrPayrollData) : {};
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function payrollAddition(rec: Pick<HrPayroll, "data"> | null | undefined): number {
  return round2(num(payrollData(rec).addition));
}

export function isPayrollPosted(rec: Pick<HrPayroll, "status"> | null | undefined): boolean {
  return rec?.status === "posted";
}

/** Month ka last date (voucher date) — local midnight. */
export function monthEndDate(month: string): Date | null {
  const range = monthRange(month);
  if (!range) return null;
  const [y, m, d] = range.to.split("-").map(Number);
  return new Date(y, m - 1, d);
}
