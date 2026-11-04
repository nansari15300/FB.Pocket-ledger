import type { HrAttendance, HrAttendanceStatus } from "../types";

export const HR_ATTENDANCE_STATUSES: HrAttendanceStatus[] = ["present", "absent", "half_day", "leave", "holiday"];

export const HR_ATTENDANCE_LABEL: Record<HrAttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  leave: "Leave",
  holiday: "Holiday",
};

/** Monthly grid ke liye 1-2 akshar ka code. */
export const HR_ATTENDANCE_SHORT: Record<HrAttendanceStatus, string> = {
  present: "P",
  absent: "A",
  half_day: "½",
  leave: "L",
  holiday: "H",
};

export function isHrAttendanceStatus(v: unknown): v is HrAttendanceStatus {
  return typeof v === "string" && (HR_ATTENDANCE_STATUSES as string[]).includes(v);
}

/**
 * Deterministic app_id: ek employee + ek date = ek record.
 * Dobara save karne par wahi app_id jata hai, isliye server upsert update karta hai (duplicate nahi).
 */
export function hrAttendanceAppId(employeeAppId: string, date: string): string {
  return `att_${String(employeeAppId).trim()}_${String(date).trim()}`.slice(0, 200);
}

export function attendanceKey(employeeAppId: string, date: string): string {
  return `${employeeAppId}|${date}`;
}

/** YYYY-MM (local). */
export function currentIsoMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM → { from: YYYY-MM-01, to: YYYY-MM-<last>, days: [YYYY-MM-DD...] }. Invalid → null. */
export function monthRange(month: string): { from: string; to: string; days: string[] } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!(mo >= 1 && mo <= 12)) return null;
  const last = new Date(y, mo, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= last; d++) days.push(`${m[1]}-${m[2]}-${String(d).padStart(2, "0")}`);
  return { from: days[0], to: days[days.length - 1], days };
}

export function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}

/**
 * Same employee+date ke multiple rows (purane random app_id / deleted) me se latest non-deleted chuno.
 * Map key = attendanceKey(employee, date).
 */
export function latestAttendanceByKey(records: HrAttendance[]): Map<string, HrAttendance> {
  const out = new Map<string, HrAttendance>();
  for (const r of records) {
    if (!r || r.deleted === true || !r.employee || !r.date) continue;
    const k = attendanceKey(r.employee, r.date);
    const prev = out.get(k);
    if (!prev || Number(r.updatedAtMs || 0) >= Number(prev.updatedAtMs || 0)) out.set(k, r);
  }
  return out;
}
