/**
 * HR module record types.
 * Employees = staff ledgers (`staff` collection, HR fields in `staff.hr`).
 * Attendance / leaves / payroll = PocketBase `pl_docs` collections `hr_attendance`, `hr_leaves`, `hr_payroll`.
 * Common fields: app_id, data (JSON), updatedAtMs, deleted, deviceId.
 */

export type HrCollection = "employees" | "attendance" | "leaves" | "payroll";

/** Common sync/meta fields jo har HR record me hote hain. */
export type HrRecordBase = {
  app_id: string;
  /** Free-form extra JSON (future fields bina schema change ke). */
  data?: Record<string, unknown> | null;
  updatedAtMs: number;
  deleted?: boolean;
  deviceId?: string;
};

export type HrEmployeeStatus = "active" | "left";
export type HrSalaryType = "monthly" | "daily";

/** HR fields stored on the staff record (`staff.hr`). All optional; defaults applied in useHrEmployees. */
export type StaffHrFields = {
  designation?: string;
  department?: string;
  /** YYYY-MM-DD */
  joining_date?: string;
  status?: HrEmployeeStatus;
  /** YYYY-MM-DD last working day. Only kept while status is "left" (required then). */
  left_date?: string;
  salary_type?: HrSalaryType;
  base_salary?: number;
  updatedAtMs?: number;
};

/** Employee view derived from a staff ledger. app_id === staff_app_id === staff.id */
export type HrEmployee = HrRecordBase & {
  /** Staff master (`staff` collection) id. */
  staff_app_id: string;
  /** Staff name / contact (read-only in HR). */
  name?: string;
  phone?: string;
  email?: string;
  designation: string;
  department: string;
  /** YYYY-MM-DD */
  joining_date: string;
  status: HrEmployeeStatus;
  /** YYYY-MM-DD last working day when status is "left" ("" when active or not set). */
  left_date: string;
  salary_type: HrSalaryType;
  base_salary: number;
};

export type HrAttendanceStatus = "present" | "absent" | "half_day" | "leave" | "holiday";

export type HrAttendance = HrRecordBase & {
  /** HrEmployee.app_id */
  employee: string;
  /** YYYY-MM-DD */
  date: string;
  status: HrAttendanceStatus;
  note?: string;
};

export type HrLeaveType = "casual" | "sick" | "paid" | "unpaid";
export type HrLeaveStatus = "pending" | "approved" | "rejected";

export type HrLeave = HrRecordBase & {
  employee: string;
  from_date: string;
  to_date: string;
  leave_type: HrLeaveType;
  reason?: string;
  status: HrLeaveStatus;
  decided_by?: string | null;
  decided_at?: number | string | null;
};

export type HrPayrollStatus = "draft" | "posted";

export type HrPayroll = HrRecordBase & {
  employee: string;
  /** YYYY-MM */
  month: string;
  present_days: number;
  gross: number;
  deductions: number;
  net: number;
  status: HrPayrollStatus;
  voucher_app_id?: string | null;
  voucher_number?: string | null;
  posted_at?: number | null;
};

export type HrRecordByCollection = {
  employees: HrEmployee;
  attendance: HrAttendance;
  leaves: HrLeave;
  payroll: HrPayroll;
};

/** Upsert input: meta fields (updatedAtMs/deviceId) client khud bhar deta hai. */
export type HrUpsertInput<C extends HrCollection> = Omit<
  HrRecordByCollection[C],
  "updatedAtMs" | "deviceId" | "deleted"
> & {
  updatedAtMs?: number;
  deviceId?: string;
};

export type HrListParams = {
  /** Sirf is time (ms) ke baad updated records. */
  since?: number;
  /** HrEmployee.app_id filter (attendance / leaves / payroll). */
  employee?: string;
  /** YYYY-MM-DD range (attendance / leaves). */
  from?: string;
  to?: string;
  /** YYYY-MM (payroll). */
  month?: string;
};

export type HrStatus = {
  enabled: boolean;
  plan_id: string | null;
};
