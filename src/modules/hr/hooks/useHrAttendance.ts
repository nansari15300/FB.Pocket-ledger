"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { listHrDocs, subscribeHrDocs, writeHrDocs, type HrDocWriteInput } from "../services/hrDocs";
import type { HrAttendance, HrAttendanceStatus } from "../types";
import { hrAttendanceAppId, isIsoDate, latestAttendanceByKey } from "../utils/attendance";

export type UseHrAttendanceParams = {
  /** YYYY-MM-DD (inclusive) */
  from: string;
  /** YYYY-MM-DD (inclusive) */
  to: string;
  /** Only one employee (HrEmployee.app_id) */
  employee?: string;
  /** false = do not load (e.g. inactive tab). Default true. */
  enabled?: boolean;
};

export type HrAttendanceMark = {
  /** Existing record app_id (an old random id is updated in place). Otherwise deterministic. */
  app_id?: string;
  employee: string;
  date: string;
  status: HrAttendanceStatus;
  note?: string;
  /** Existing record extra JSON (preserved). */
  data?: Record<string, unknown> | null;
};

/**
 * Attendance list (date range / employee) + bulk upsert, stored in pl_docs `hr_attendance`.
 * app_id is deterministic (`att_<staffId>_<date>`), so saving again updates the same doc.
 */
export function useHrAttendance({ from, to, employee, enabled = true }: UseHrAttendanceParams) {
  const { companyId } = useCompany();
  const [records, setRecords] = useState<HrAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = false;
  const reqRef = useRef(0);

  const cid = String(companyId || "").trim();
  const rangeOk = isIsoDate(from) && isIsoDate(to) && from <= to;

  const reload = useCallback(async () => {
    const req = ++reqRef.current;
    if (!cid || !enabled || !rangeOk) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await listHrDocs(cid, "attendance");
      if (req !== reqRef.current) return;
      setRecords(
        items.filter(
          (r) =>
            r &&
            isIsoDate(r.date) &&
            r.date >= from &&
            r.date <= to &&
            (!employee || r.employee === employee)
        )
      );
    } catch (e) {
      if (req !== reqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, enabled, rangeOk, from, to, employee]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!cid || !enabled) return;
    return subscribeHrDocs(cid, ["attendance"], () => void reload());
  }, [cid, enabled, reload]);

  /** employee|date → latest record */
  const byKey = useMemo(() => latestAttendanceByKey(records), [records]);

  /** Bulk upsert, then reload. Returns the saved count. */
  const saveMarks = useCallback(
    async (marks: HrAttendanceMark[]): Promise<number> => {
      if (!cid) throw new Error("HR: company id is missing.");
      const payload: HrDocWriteInput<"attendance">[] = marks
        .filter((m) => m && m.employee && isIsoDate(m.date))
        .map((m) => {
          const note = String(m.note || "").trim();
          const rec: HrDocWriteInput<"attendance"> = {
            app_id: String(m.app_id || "").trim() || hrAttendanceAppId(m.employee, m.date),
            employee: m.employee,
            date: m.date,
            status: m.status,
            note,
          };
          if (m.data && typeof m.data === "object") rec.data = m.data;
          return rec;
        });
      if (payload.length === 0) return 0;
      setSaving(true);
      try {
        await writeHrDocs(cid, "attendance", payload);
        await reload();
        return payload.length;
      } finally {
        setSaving(false);
      }
    },
    [cid, reload]
  );

  return {
    companyId: cid || null,
    records,
    byKey,
    loading,
    saving,
    error,
    disabled,
    reload,
    saveMarks,
  };
}
