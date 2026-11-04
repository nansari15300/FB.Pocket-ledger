"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { listHrDocs, newHrDocId, subscribeHrDocs, writeHrDocs, type HrDocWriteInput } from "../services/hrDocs";
import type { HrLeave, HrLeaveStatus, HrLeaveType } from "../types";
import { isIsoDate } from "../utils/attendance";
import { rangesOverlap } from "../utils/leaves";

export type UseHrLeavesParams = {
  /** Only one employee (HrEmployee.app_id). */
  employee?: string;
  /** YYYY-MM-DD: only leaves that overlap [from, to]. */
  from?: string;
  to?: string;
  /** Client-side status filter. */
  status?: HrLeaveStatus;
  /** false = do not load. Default true. */
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
 * Leaves list + new request (status pending) + approve / reject, stored in pl_docs `hr_leaves`.
 * Decide sets status, decided_by and decided_at on the client.
 */
export function useHrLeaves({ employee, from, to, status, enabled = true }: UseHrLeavesParams = {}) {
  const { companyId } = useCompany();
  const { user, customUser } = useAuth();
  const [all, setAll] = useState<HrLeave[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = false;
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
      const items = await listHrDocs(cid, "leaves");
      if (req !== reqRef.current) return;
      setAll(items.filter((l) => l && (!employee || l.employee === employee)));
    } catch (e) {
      if (req !== reqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, enabled, employee]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!cid || !enabled) return;
    return subscribeHrDocs(cid, ["leaves"], () => void reload());
  }, [cid, enabled, reload]);

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

  /** New leave request (status "pending"). Returns app_id. */
  const createRequest = useCallback(
    async (input: HrLeaveRequestInput): Promise<string> => {
      if (!cid) throw new Error("HR: company id is missing.");
      const app_id = newHrDocId("lv");
      const rec: HrDocWriteInput<"leaves"> = {
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
        await writeHrDocs(cid, "leaves", [rec]);
        await reload();
        return app_id;
      } finally {
        setSaving(false);
      }
    },
    [cid, reload]
  );

  const decidedBy = String(customUser?.displayName || customUser?.email || user?.email || user?.uid || "").trim();

  /** Approve / reject: sets status, decided_by and decided_at (ms). */
  const decide = useCallback(
    async (appId: string, next: "approved" | "rejected") => {
      if (!cid) throw new Error("HR: company id is missing.");
      const current = all.find((l) => l.app_id === appId);
      if (!current) throw new Error("Leave request was not found.");
      setDeciding(appId);
      try {
        const { updatedAtMs: _u, deviceId: _d, deleted: _x, ...rest } = current;
        void _u;
        void _d;
        void _x;
        await writeHrDocs(cid, "leaves", [
          { ...rest, status: next, decided_by: decidedBy || null, decided_at: Date.now() },
        ]);
        await reload();
      } finally {
        setDeciding(null);
      }
    },
    [cid, all, decidedBy, reload]
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
