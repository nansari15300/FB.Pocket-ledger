"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { BROWSER_DB_COLLECTION_BUMP, listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import { LOAN_LIABILITY_GROUP_ID } from "@/modules/loans/constants/loanConstants";
import { isLoanLiabilityStaff } from "@/modules/loans/utils/loanLiabilityStaff";
import type { Staff } from "@/components/staff/types";
import { HR_STAFF_OVERLAY_EVENT, getHrOverlay, pickLatestHr, writeStaffHrFields } from "../services/hrStaffWrite";
import type { HrEmployee, StaffHrFields } from "../types";
import { salaryPrefillFromStaff, todayIsoDate } from "../utils/employeeDefaults";

type StaffRow = Staff & { isLoanAccount?: unknown };
type GroupRow = { id: string; parentId?: string | null };

/** "employee" = staff ledger, "loan" = loan liability ledger (hidden), "unsure" = type not set. */
export type HrStaffKind = "employee" | "loan" | "unsure";

/** True when the group chain (groupId → parentId …) reaches the Staff system group before Loan & Liabilities. */
function groupChainIsStaff(groupId: string | undefined, groupsById: Map<string, GroupRow>): boolean {
  let id = String(groupId || "").trim();
  for (let i = 0; i < 25 && id; i++) {
    if (id === STAFF_SYSTEM_GROUP_ID) return true;
    if (id === LOAN_LIABILITY_GROUP_ID) return false;
    const g = groupsById.get(id);
    id = String(g?.parentId || "").trim();
  }
  return false;
}

/**
 * "Type not set" rule:
 * not a loan liability (isLoanLiabilityStaff false) AND `isLoanAccount` is not a boolean
 * AND the group chain does not reach `staff_system`.
 */
export function classifyStaffForHr(staff: StaffRow, groupsById: Map<string, GroupRow>): HrStaffKind {
  if (isLoanLiabilityStaff(staff as { groupId?: string | null; isLoanAccount?: boolean | null })) return "loan";
  if (typeof staff.isLoanAccount === "boolean") return "employee";
  if (groupChainIsStaff(staff.groupId, groupsById)) return "employee";
  return "unsure";
}

function toEmployee(staff: StaffRow, hr: StaffHrFields | undefined): HrEmployee {
  const prefill = salaryPrefillFromStaff(staff);
  const h = hr || {};
  const base = Number(h.base_salary);
  return {
    app_id: staff.id,
    staff_app_id: staff.id,
    name: String(staff.name || ""),
    phone: String(staff.phone || ""),
    email: String(staff.email || ""),
    designation: String(h.designation || ""),
    department: String(h.department || ""),
    joining_date: String(h.joining_date || ""),
    status: h.status === "left" ? "left" : "active",
    left_date: h.status === "left" ? String(h.left_date || "") : "",
    salary_type: h.salary_type === "daily" || h.salary_type === "monthly" ? h.salary_type : prefill.salary_type,
    base_salary: h.base_salary !== undefined && Number.isFinite(base) ? base : prefill.base_salary,
    updatedAtMs: Number(h.updatedAtMs || 0),
    data: null,
  };
}

/**
 * HR employees = staff ledgers (`useVouchers().processedStaff`) that are not loan liability accounts.
 * HR fields come from `staff.hr` (latest of context / local DB / this session's writes).
 * `typeUnsure` rows ("Type not set") are listed separately and are NOT used by attendance or payroll.
 */
export function useHrEmployees() {
  const { companyId, company } = useCompany();
  const { processedStaff, processedStaffGroups, loading: vouchersLoading, patchMasterEntity } = useVouchers();
  const cid = String(companyId || "").trim();
  const [dbHr, setDbHr] = useState<Map<string, StaffHrFields>>(() => new Map());
  const [overlayTick, setOverlayTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const reqRef = useRef(0);

  const loadDbHr = useCallback(async () => {
    const req = ++reqRef.current;
    if (!cid) {
      setDbHr(new Map());
      return;
    }
    try {
      const rows = ((await listCompanyDocsFromBrowserDb(cid, "staff")) || []) as Array<Record<string, unknown>>;
      if (req !== reqRef.current) return;
      const m = new Map<string, StaffHrFields>();
      for (const r of rows) {
        const id = String(r?.id || "");
        if (id && r.hr && typeof r.hr === "object") m.set(id, r.hr as StaffHrFields);
      }
      setDbHr(m);
    } catch {
      /* context data is still used */
    }
  }, [cid]);

  useEffect(() => {
    void loadDbHr();
  }, [loadDbHr]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBump = (ev: Event) => {
      const d = (ev as CustomEvent<{ companyId?: string; collection?: string }>).detail || {};
      if (d.companyId && String(d.companyId) !== cid) return;
      if (d.collection && d.collection !== "staff") return;
      void loadDbHr();
    };
    const onOverlay = () => setOverlayTick((t) => t + 1);
    window.addEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
    window.addEventListener(HR_STAFF_OVERLAY_EVENT, onOverlay);
    return () => {
      window.removeEventListener(BROWSER_DB_COLLECTION_BUMP, onBump);
      window.removeEventListener(HR_STAFF_OVERLAY_EVENT, onOverlay);
    };
  }, [cid, loadDbHr]);

  const groupsById = useMemo(() => {
    const m = new Map<string, GroupRow>();
    for (const g of processedStaffGroups || []) if (g?.id) m.set(g.id, g);
    return m;
  }, [processedStaffGroups]);

  const { employees, typeUnsure, staffById } = useMemo(() => {
    void overlayTick;
    const ov = getHrOverlay(cid);
    const emps: HrEmployee[] = [];
    const unsure: HrEmployee[] = [];
    const byId = new Map<string, StaffRow>();
    for (const raw of (processedStaff || []) as StaffRow[]) {
      if (!raw || !raw.id || raw.isDeleted === true) continue;
      const kind = classifyStaffForHr(raw, groupsById);
      if (kind === "loan") continue;
      byId.set(raw.id, raw);
      const hr = pickLatestHr(raw.hr, dbHr.get(raw.id), ov?.get(raw.id));
      const e = toEmployee(raw, hr);
      if (kind === "employee") emps.push(e);
      else unsure.push(e);
    }
    const byName = (a: HrEmployee, b: HrEmployee) => String(a.name || "").localeCompare(String(b.name || ""));
    return { employees: emps.sort(byName), typeUnsure: unsure.sort(byName), staffById: byId };
  }, [processedStaff, groupsById, dbHr, overlayTick, cid]);

  const reload = useCallback(async () => {
    await loadDbHr();
  }, [loadDbHr]);

  /** Writes only `staff.hr` for this staff id. */
  const upsertEmployee = useCallback(
    async (staffId: string, patch: StaffHrFields): Promise<StaffHrFields> => {
      if (!cid) throw new Error("HR: company id is missing.");
      const current = [...employees, ...typeUnsure].find((e) => e.app_id === staffId);
      setSaving(true);
      try {
        const hr = await writeStaffHrFields({
          company,
          companyId: cid,
          staffId,
          patch,
          currentHr: current
            ? {
                designation: current.designation,
                department: current.department,
                joining_date: current.joining_date,
                status: current.status,
                ...(current.left_date ? { left_date: current.left_date } : {}),
                salary_type: current.salary_type,
                base_salary: current.base_salary,
                updatedAtMs: current.updatedAtMs,
              }
            : undefined,
        });
        try {
          patchMasterEntity("staff", staffId, { hr });
        } catch {
          /* live patch is best-effort; the overlay already has the new values */
        }
        return hr;
      } finally {
        setSaving(false);
      }
    },
    [cid, company, employees, typeUnsure, patchMasterEntity]
  );

  /** "Remove" from HR = status "left" (left date = the saved one, otherwise today). The staff record is never deleted. */
  const removeEmployee = useCallback(
    (staffId: string, leftDate?: string) => {
      const current = employees.find((e) => e.app_id === staffId);
      return upsertEmployee(staffId, {
        status: "left",
        left_date: leftDate || current?.left_date || todayIsoDate(),
      });
    },
    [upsertEmployee, employees]
  );

  return {
    companyId: cid || null,
    employees,
    typeUnsure,
    staffById,
    loading: !!vouchersLoading && (processedStaff || []).length === 0,
    saving,
    error: null as string | null,
    /** Kept for compatibility; HR now uses local company data, so it is never disabled by the server. */
    disabled: false,
    reload,
    upsertEmployee,
    removeEmployee,
  };
}
