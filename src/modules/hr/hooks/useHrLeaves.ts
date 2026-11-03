"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { hrApi, isHrDisabledError, newHrAppId } from "../services/hrApi";
import type { HrLeave, HrLeaveStatus, HrLeaveType, HrUpsertInput } from "../types";
import { isIsoDate } from "../utils/attendance";
import { rangesOverlap } from "../utils/leaves";

export type UseHrLeavesParams = {
  /** Sirf ek employee (HrEmployee.app_id) — server filter. */
  employee?: string;
  /** YYYY-MM-DD: sirf wo leaves jo [from, to] se overlap karein (client-side filter). */
  from?: string;
  to?: string;
  /** Client-side status filter. */
  status?: HrLeaveStatus;
  /** false → fetch nahi. Default true. */
  enabled?: boolean;
};

export type HrLeaveRequestInput = {
  employee: string;
  from_date: string;
  to_date: string;
  leave_type: HrLeaveType;
  reason?: string;
};

/**
 * Leaves list + new request (upsert, status pending) + approve/reject (`/leaves/decide`).
 * Date range server ko nahi bhejte: server ki `from/to` semantics (overlap vs within) abhi tay nahi,
 * isliye overlap filter client-side (pehle se shuru hui leave miss na ho).
 */
export function useHrLeaves({ employee, from, to, status, enabled = true }: UseHrLeavesParams = {}) {
  const { companyId } = useCompany();
  const [all, setAll] = useState<HrLeave[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const reqRef = useRef(0);
  const cid = String(companyId || "").trim();

  const reload = useCallback(async () => {
    const req = ++reqRef.current;
    if (!cid || !enabled) {
      setAll([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await hrApi.list("leaves", cid, { employee: employee || undefined });
      if (req !== reqRef.current) return;
      setDisabled(false);
      setAll(items.filter((l) => l && l.deleted !== true));
    } catch (e) {
      if (req !== reqRef.current) return;
      if (isHrDisabledError(e)) {
        setDisabled(true);
        setAll([]);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, enabled, employee]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const leaves = useMemo(() => {
    const f = from && isIsoDate(from) ? from : "";
    const t = to && isIsoDate(to) ? to : "";
    return all
      .filter((l) => (status ? l.status === status : true))
      .filter((l) => (f || t ? rangesOverlap(l.from_date, l.to_date, f || "0000-01-01", t || "9999-12-31") : true))
      .sort((a, b) =>
        a.from_date === b.from_date
          ? Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0)
          : a.from_date < b.from_date
            ? 1
            : -1
      );
  }, [all, status, from, to]);

  const approved = useMemo(() => all.filter((l) => l.status === "approved"), [all]);

  /** Naya leave request (status "pending"). Returns app_id. */
  const createRequest = useCallback(
    async (input: HrLeaveRequestInput): Promise<string> => {
      if (!cid) throw new Error("HR: company id missing");
      const app_id = newHrAppId("lv");
      const rec: HrUpsertInput<"leaves"> = {
        app_id,
        employee: input.employee,
        from_date: input.from_date,
        to_date: input.to_date,
        leave_type: input.leave_type,
        reason: String(input.reason || "").trim(),
        status: "pending",
        decided_by: null,
        decided_at: null,
      };
      setSaving(true);
      try {
        await hrApi.upsert("leaves", cid, [rec]);
        await reload();
        return app_id;
      } catch (e) {
        if (isHrDisabledError(e)) setDisabled(true);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [cid, reload]
  );

  /** Approve / reject — server decided_by / decided_at bharta hai. */
  const decide = useCallback(
    async (appId: string, next: "approved" | "rejected") => {
      if (!cid) throw new Error("HR: company id missing");
      setDeciding(appId);
      try {
        await hrApi.decideLeave(cid, appId, next);
        await reload();
      } catch (e) {
        if (isHrDisabledError(e)) setDisabled(true);
        throw e;
      } finally {
        setDeciding(null);
      }
    },
    [cid, reload]
  );

  return {
    companyId: cid || null,
    all,
    leaves,
    approved,
    loading,
    saving,
    deciding,
    error,
    disabled,
    reload,
    createRequest,
    decide,
  };
}
