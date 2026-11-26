"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { cn } from "@/lib/utils";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import { LoanSystemDateField } from "@/modules/loans/components/LoanSystemDateField";
import { rememberStaffHr } from "../services/hrStaffWrite";
import { scheduleLeftDateCleanup } from "../services/hrLeftDateCleanup";
import { isIsoDate } from "../utils/attendance";
import { todayIsoDate } from "../utils/employeeDefaults";
import { HR_FIELD_SCOPE } from "./HrChrome";
import type { HrEmployeeStatus, StaffHrFields } from "../types";

/**
 * "HR details" block for the shared Create Staff / Edit Staff forms.
 * Only HR fields that the staff form does not already have:
 * Designation, Joining date, Status, and Left date (required when Status = Left).
 * Base salary = staff "Salary"; salary type = staff "Salary period"; department = staff "Group/Department".
 */
export type StaffHrDraft = {
  designation: string;
  joining_date: string;
  status: HrEmployeeStatus;
  /** YYYY-MM-DD, only used when status is "left". */
  left_date: string;
};

export function staffHrDraftFrom(hr: StaffHrFields | null | undefined): StaffHrDraft {
  const h = hr && typeof hr === "object" ? hr : {};
  return {
    designation: String(h.designation || ""),
    joining_date: String(h.joining_date || ""),
    status: h.status === "left" ? "left" : "active",
    left_date: h.status === "left" ? String(h.left_date || "") : "",
  };
}

/**
 * New `staff.hr` value to save with the staff record.
 * Keeps other existing hr keys (e.g. department); drops hr salary keys so the
 * form's Salary / Salary period stay the single source of base salary.
 * Status Left always saves a Left date: the field is pre-filled with today when Left is picked and cannot be
 * cleared; if it is still missing here, today is used. Status Active removes the Left date.
 */
export function staffHrPatchFromDraft(draft: StaffHrDraft, existing: StaffHrFields | null | undefined): StaffHrFields {
  const base: StaffHrFields = { ...(existing && typeof existing === "object" ? existing : {}) };
  delete base.base_salary;
  delete base.salary_type;
  delete base.left_date;
  const left = draft.status === "left";
  const leftDate = String(draft.left_date || "").trim();
  return {
    ...base,
    designation: draft.designation.trim(),
    joining_date: draft.joining_date.trim(),
    status: left ? "left" : "active",
    ...(left ? { left_date: isIsoDate(leftDate) ? leftDate : todayIsoDate() } : {}),
    updatedAtMs: Date.now(),
  };
}

/** Same flag as HrGate (plan + hr_view) AND Account Type = Staff. */
export function useStaffHrSection(accountType: string | undefined) {
  const { enabled, canManage } = useHrModuleFeature();
  return { show: enabled && accountType === STAFF_SYSTEM_GROUP_ID, canEdit: canManage };
}

/** Draft state that re-seeds whenever `resetKey` changes (dialog open / staff id). */
export function useStaffHrDraft(resetKey: string, source: StaffHrFields | null | undefined) {
  const [state, setState] = useState(() => ({ key: resetKey, draft: staffHrDraftFrom(source) }));
  if (state.key !== resetKey) {
    const next = { key: resetKey, draft: staffHrDraftFrom(source) };
    setState(next);
    return { draft: next.draft, setDraft: (d: StaffHrDraft) => setState({ key: resetKey, draft: d }) };
  }
  return { draft: state.draft, setDraft: (d: StaffHrDraft) => setState({ key: resetKey, draft: d }) };
}

/**
 * Updates the HR list right away (same overlay as writeStaffHrFields).
 * Status Left with a Left date: attendance marked after that date is removed (see hrLeftDateCleanup).
 */
export function announceStaffHrSaved(companyId: string | null | undefined, staffId: string, hr: StaffHrFields) {
  if (!companyId || !staffId) return;
  rememberStaffHr(companyId, staffId, hr);
  scheduleLeftDateCleanup(companyId, staffId, hr);
}

export function StaffHrDetailsSection({
  value,
  onChange,
  disabled,
}: {
  value: StaffHrDraft;
  onChange: (next: StaffHrDraft) => void;
  disabled?: boolean;
}) {
  const isLeft = value.status === "left";
  const leftMissing = isLeft && !isIsoDate(value.left_date);
  const leftBeforeJoining =
    isLeft && !leftMissing && isIsoDate(value.joining_date) && value.left_date < value.joining_date;
  return (
    <div data-pl-staff-hr-section="" className={cn("space-y-3 rounded-md border border-border p-3", HR_FIELD_SCOPE)}>
      <div className="text-sm font-medium">HR details</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pl-staff-hr-designation">Designation</Label>
          <Input
            id="pl-staff-hr-designation"
            value={value.designation}
            disabled={disabled}
            placeholder="e.g., Accountant"
            onChange={(e) => onChange({ ...value, designation: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Joining date</Label>
          <LoanSystemDateField
            value={value.joining_date}
            allowEmpty
            disabled={disabled}
            onChange={(iso) => onChange({ ...value, joining_date: iso })}
          />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={value.status}
            disabled={disabled}
            onValueChange={(v) =>
              onChange(
                v === "left"
                  ? { ...value, status: "left", left_date: isIsoDate(value.left_date) ? value.left_date : todayIsoDate() }
                  : { ...value, status: "active", left_date: "" }
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="left">Left</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isLeft ? (
          <div className="space-y-2">
            <Label>
              Left date <span className="text-destructive">*</span>
            </Label>
            <LoanSystemDateField
              value={value.left_date}
              disabled={disabled}
              onChange={(iso) => onChange({ ...value, left_date: iso })}
            />
            {leftMissing ? (
              <p className="text-xs text-destructive">Left date is required when Status is Left.</p>
            ) : leftBeforeJoining ? (
              <p className="text-xs text-destructive">Left date is before the Joining date.</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Last working day. Attendance after this date is removed and not paid.
              </p>
            )}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Salary and Salary period above are used as the HR base salary.
      </p>
    </div>
  );
}
