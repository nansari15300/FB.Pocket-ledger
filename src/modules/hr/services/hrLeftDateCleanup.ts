"use client";

/**
 * When an employee is saved with Status = Left and a Left date, attendance marked AFTER that date is removed
 * (only that employee, only dates > left date). Delete = deleteHrDocs (tombstone in pl_docs + outbox).
 * Before deleting, a JSON copy of the removed records is kept in this browser's localStorage
 * (`pl_hr_left_cleanup_v1:<company>:<employee>:<time>`) and the count is logged and shown in a toast.
 */

import { toast } from "sonner";
import type { HrAttendance, StaffHrFields } from "../types";
import { isIsoDate } from "../utils/attendance";
import { deleteHrDocs, listHrDocs } from "./hrDocs";

const BACKUP_PREFIX = "pl_hr_left_cleanup_v1:";

/** Live attendance records of one employee dated after `leftDate`. */
export async function listAttendanceAfterLeftDate(
  companyId: string,
  employeeId: string,
  leftDate: string
): Promise<HrAttendance[]> {
  const cid = String(companyId || "").trim();
  const emp = String(employeeId || "").trim();
  if (!cid || !emp || !isIsoDate(leftDate)) return [];
  const all = await listHrDocs(cid, "attendance");
  return all.filter((a) => a && a.employee === emp && isIsoDate(String(a.date || "")) && a.date > leftDate);
}

function keepBackup(cid: string, emp: string, leftDate: string, records: HrAttendance[]) {
  if (typeof window === "undefined") return;
  try {
    const key = `${BACKUP_PREFIX}${cid}:${emp}:${Date.now()}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({ companyId: cid, employee: emp, left_date: leftDate, removedAt: new Date().toISOString(), records })
    );
  } catch {
    /* storage full / blocked: the tombstoned docs still keep their data */
  }
}

/** Removes the employee's attendance after `leftDate`. Returns how many records were removed. */
export async function removeAttendanceAfterLeftDate(
  companyId: string,
  employeeId: string,
  leftDate: string
): Promise<number> {
  const cid = String(companyId || "").trim();
  const emp = String(employeeId || "").trim();
  const records = await listAttendanceAfterLeftDate(cid, emp, leftDate);
  if (records.length === 0) return 0;
  keepBackup(cid, emp, leftDate, records);
  const n = await deleteHrDocs(
    cid,
    "attendance",
    records.map((r) => r.app_id)
  );
  console.info(`[HR] Left date ${leftDate}: removed ${n} attendance record(s) after it for employee ${emp}.`);
  return n;
}

/** Fire-and-forget after a staff HR save: runs the cleanup only for Status = Left with a valid Left date. */
export function scheduleLeftDateCleanup(
  companyId: string | null | undefined,
  staffId: string,
  hr: StaffHrFields | null | undefined
) {
  const cid = String(companyId || "").trim();
  const leftDate = String(hr?.left_date || "").trim();
  if (!cid || !staffId || hr?.status !== "left" || !isIsoDate(leftDate)) return;
  void removeAttendanceAfterLeftDate(cid, staffId, leftDate)
    .then((n) => {
      if (n > 0) toast.info(`${n} attendance record(s) after the left date (${leftDate}) were removed.`);
    })
    .catch((e) => {
      toast.error("Could not remove attendance after the left date", {
        description: e instanceof Error ? e.message : String(e),
      });
    });
}
