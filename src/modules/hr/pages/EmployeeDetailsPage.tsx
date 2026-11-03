"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { HrGate } from "../components/HrGate";
import { useHrEmployees } from "../hooks/useHrEmployees";
import { hrApi, isHrDisabledError } from "../services/hrApi";
import { salaryPrefillFromStaff, todayIsoDate } from "../utils/employeeDefaults";
import type { HrEmployee, HrEmployeeStatus, HrSalaryType, HrUpsertInput } from "../types";

/** `/hr/employees/new` = create; baaki id = HrEmployee.app_id (view/edit). */
export const NEW_EMPLOYEE_ROUTE_ID = "new";

type FormState = {
  staff_app_id: string;
  designation: string;
  department: string;
  joining_date: string;
  status: HrEmployeeStatus;
  salary_type: HrSalaryType;
  base_salary: string;
};

const EMPTY_FORM: FormState = {
  staff_app_id: "",
  designation: "",
  department: "",
  joining_date: todayIsoDate(),
  status: "active",
  salary_type: "monthly",
  base_salary: "",
};

function formFromEmployee(e: HrEmployee): FormState {
  return {
    staff_app_id: e.staff_app_id || "",
    designation: e.designation || "",
    department: e.department || "",
    joining_date: e.joining_date || "",
    status: e.status === "left" ? "left" : "active",
    salary_type: e.salary_type === "daily" ? "daily" : "monthly",
    base_salary: String(e.base_salary ?? ""),
  };
}

export function EmployeeDetailsPage({ employeeId }: { employeeId: string }) {
  return (
    <HrGate>
      <EmployeeDetailsBody employeeId={employeeId} />
    </HrGate>
  );
}

function EmployeeDetailsBody({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const { company, companyId } = useCompany();
  const { processedStaff } = useVouchers();
  const { canManage } = useHrModuleFeature();
  const { employees, loading } = useHrEmployees();
  const isNew = employeeId === NEW_EMPLOYEE_ROUTE_ID;

  const existing = useMemo(
    () => (isNew ? null : employees.find((e) => e.app_id === employeeId) || null),
    [employees, employeeId, isNew]
  );

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !existing) return;
    const key = `${existing.app_id}:${existing.updatedAtMs}`;
    if (hydratedFor === key) return;
    setForm(formFromEmployee(existing));
    setHydratedFor(key);
  }, [existing, isNew, hydratedFor]);

  const activeStaff = useMemo(
    () =>
      (processedStaff || [])
        .filter((s) => s && s.isDeleted !== true)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [processedStaff]
  );

  /** Ek staff = ek employee: already linked staff picker me hide (current record ko chhod kar). */
  const pickableStaff = useMemo(() => {
    const taken = new Set(
      employees.filter((e) => e.app_id !== existing?.app_id).map((e) => e.staff_app_id)
    );
    return activeStaff.filter((s) => !taken.has(s.id));
  }, [activeStaff, employees, existing?.app_id]);

  const staffName = useMemo(() => {
    const s = activeStaff.find((x) => x.id === form.staff_app_id);
    return s ? String(s.name || "") : "";
  }, [activeStaff, form.staff_app_id]);

  const readOnly = !canManage;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onPickStaff = (staffId: string) => {
    const s = activeStaff.find((x) => x.id === staffId);
    const prefill = salaryPrefillFromStaff(s);
    setForm((f) => ({
      ...f,
      staff_app_id: staffId,
      salary_type: prefill.salary_type,
      base_salary: prefill.base_salary ? String(prefill.base_salary) : "",
    }));
  };

  const onSave = async () => {
    const cid = String(companyId || "").trim();
    if (!cid || readOnly) return;
    if (!form.staff_app_id) {
      toast.error("Staff चुनें (Select staff).");
      return;
    }
    if (!form.joining_date) {
      toast.error("Joining date दें।");
      return;
    }
    const salary = Number(form.base_salary || 0);
    if (!Number.isFinite(salary) || salary < 0) {
      toast.error("Base salary sahi number hona chahiye.");
      return;
    }
    const appId = existing?.app_id || hrApi.newAppId("emp");
    const record: HrUpsertInput<"employees"> = {
      app_id: appId,
      data: existing?.data ?? null,
      staff_app_id: form.staff_app_id,
      designation: form.designation.trim(),
      department: form.department.trim(),
      joining_date: form.joining_date,
      status: form.status,
      salary_type: form.salary_type,
      base_salary: salary,
    };
    setSaving(true);
    try {
      await hrApi.upsert("employees", cid, [record]);
      toast.success(isNew ? "Employee added." : "Employee saved.");
      router.push("/hr/employees");
    } catch (e) {
      if (isHrDisabledError(e)) toast.error("HR आपके plan में उपलब्ध नहीं है।");
      else toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    const cid = String(companyId || "").trim();
    if (!cid || !existing || readOnly) return;
    if (typeof window !== "undefined" && !window.confirm("Is employee ko HR se hatayein? (Staff master same rahega)")) return;
    setSaving(true);
    try {
      await hrApi.remove("employees", cid, [existing.app_id]);
      toast.success("Employee removed.");
      router.push("/hr/employees");
    } catch (e) {
      if (isHrDisabledError(e)) toast.error("HR आपके plan में उपलब्ध नहीं है।");
      else toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  if (!isNew && !existing) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Employee not found."}</p>
        <Button type="button" variant="outline" onClick={() => router.push("/hr/employees")}>
          Back to Employees
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="h-full min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => router.push("/hr/employees")}
            aria-label="Back to Employees"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">
            {isNew ? "Add Employee" : staffName || "Employee"}
          </h1>
          {readOnly ? <span className="text-xs text-muted-foreground">(view only)</span> : null}
        </div>

        <div className="grid max-w-3xl gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Staff (कर्मचारी)</Label>
            {isNew ? (
              <Select value={form.staff_app_id} onValueChange={onPickStaff} disabled={readOnly}>
                <SelectTrigger>
                  <SelectValue placeholder={pickableStaff.length ? "Select staff" : "No staff available"} />
                </SelectTrigger>
                <SelectContent>
                  {pickableStaff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={staffName || "(staff missing)"} disabled />
            )}
            {isNew ? (
              <p className="text-xs text-muted-foreground">
                Existing staff चुनें — salary / period staff master से prefill होगा।
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hr-designation">Designation (पद)</Label>
            <Input
              id="hr-designation"
              value={form.designation}
              onChange={(e) => set("designation", e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-department">Department (विभाग)</Label>
            <Input
              id="hr-department"
              value={form.department}
              onChange={(e) => set("department", e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-joining">Joining Date</Label>
            <Input
              id="hr-joining"
              type="date"
              value={form.joining_date}
              onChange={(e) => set("joining_date", e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => set("status", v === "left" ? "left" : "active")}
              disabled={readOnly}
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
          <div className="space-y-1.5">
            <Label>Salary Type</Label>
            <Select
              value={form.salary_type}
              onValueChange={(v) => set("salary_type", v === "daily" ? "daily" : "monthly")}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-salary">Base Salary</Label>
            <Input
              id="hr-salary"
              type="number"
              inputMode="decimal"
              min={0}
              value={form.base_salary}
              onChange={(e) => set("base_salary", e.target.value)}
              disabled={readOnly}
            />
          </div>
        </div>

        {!readOnly ? (
          <div className="flex max-w-3xl flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void onSave()} disabled={saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/hr/employees")} disabled={saving}>
              Cancel
            </Button>
            {!isNew ? (
              <Button
                type="button"
                variant="destructive"
                className="ml-auto"
                onClick={() => void onDelete()}
                disabled={saving}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
