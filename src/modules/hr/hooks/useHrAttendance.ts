"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { hrApi, isHrDisabledError } from "../services/hrApi";
import type { HrAttendance, HrAttendanceStatus, HrUpsertInput } from "../types";
import { hrAttendanceAppId, isIsoDate, latestAttendanceByKey } from "../utils/attendance";

export type UseHrAttendanceParams = {
  /** YYYY-MM-DD (inclusive) */
  from: string;
  /** YYYY-MM-DD (inclusive) */
  to: string;
  /** Sirf ek employee (HrEmployee.app_id) */
  employee?: string;
  /** false → fetch nahi (jaise inactive tab). Default true. */
  enabled?: boolean;
};

export type HrAttendanceMark = {
  /** Existing record ka app_id (purana random id ho to wahi update ho). Na ho to deterministic. */
  app_id?: string;
  employee: string;
  date: string;
  status: HrAttendanceStatus;
  note?: string;
  /** Existing record ka extra JSON (preserve). */
  data?: Record<string, unknown> | null;
};

/**
 * Attendance list (date range / employee) + bulk upsert.
 * app_id deterministic (`att_<employee>_<date>`) — re-save update karta hai.
 */
export function useHrAttendance({ from, to, employee, enabled = true }: UseHrAttendanceParams) {
  const { companyId } = useCompany();
  const [records, setRecords] = useState<HrAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
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
      const items = await hrApi.list("attendance", cid, { from, to, employee: employee || undefined });
      if (req !== reqRef.current) return;
      setDisabled(false);
      setRecords(items.filter((r) => r && r.deleted !== true));
    } catch (e) {
      if (req !== reqRef.current) return;
      if (isHrDisabledError(e)) {
        setDisabled(true);
        setRecords([]);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, enabled, rangeOk, from, to, employee]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** employee|date → latest record */
  const byKey = useMemo(() => latestAttendanceByKey(records), [records]);

  /** Bulk upsert; success par reload. Returns saved count. */
  const saveMarks = useCallback(
    async (marks: HrAttendanceMark[]): Promise<number> => {
      if (!cid) throw new Error("HR: company id missing");
      const payload: HrUpsertInput<"attendance">[] = marks
        .filter((m) => m && m.employee && isIsoDate(m.date))
        .map((m) => {
          const note = String(m.note || "").trim();
          const rec: HrUpsertInput<"attendance"> = {
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
        await hrApi.upsert("attendance", cid, payload);
        await reload();
        return payload.length;
      } catch (e) {
        if (isHrDisabledError(e)) setDisabled(true);
        throw e;
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
