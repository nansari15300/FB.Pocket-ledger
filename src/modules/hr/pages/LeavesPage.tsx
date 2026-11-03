"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { cn } from "@/lib/utils";
import { useHrEmployees } from "../hooks/useHrEmployees";
import { useHrLeaves } from "../hooks/useHrLeaves";
import { todayIsoDate } from "../utils/employeeDefaults";
import { isIsoDate } from "../utils/attendance";
import {
  HR_LEAVE_STATUS_LABEL,
  HR_LEAVE_TYPES,
  HR_LEAVE_TYPE_LABEL,
  formatDecidedAt,
  leaveDayCount,
  rangesOverlap,
} from "../utils/leaves";
import type { HrLeaveStatus, HrLeaveType } from "../types";

const STATUS_BADGE: Record<HrLeaveStatus, string> = {
  pending: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "border-emerald-600/60 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  rejected: "border-red-600/60 bg-red-600/10 text-red-700 dark:text-red-400",
};

type FormState = {
  employee: string;
  from_date: string;
  to_date: string;
  leave_type: HrLeaveType;
  reason: string;
};

function emptyForm(): FormState {
  const t = todayIsoDate();
  return { employee: "", from_date: t, to_date: t, leave_type: "casual", reason: "" };
}

/** Route /hr/leaves isko HrGate me wrap karta hai. */
export function LeavesPage() {
  return <LeavesPageBody />;
}

function LeavesPageBody() {
  const router = useRouter();
  const { company } = useCompany();
  const { processedStaff } = useVouchers();
  const { canManage, canAttendance, canApproveLeave } = useHrModuleFeature();
  const canCreate = canManage || canAttendance;
  const emp = useHrEmployees();
  const lv = useHrLeaves();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of processedStaff || []) m.set(s.id, String(s.name || ""));
    return m;
  }, [processedStaff]);

  const empNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of emp.employees) m.set(e.app_id, staffNameById.get(e.staff_app_id) || "(staff missing)");
    return m;
  }, [emp.employees, staffNameById]);

  const activeEmployees = useMemo(
    () =>
      emp.employees
        .filter((e) => e.status === "active")
        .map((e) => ({ id: e.app_id, name: empNameById.get(e.app_id) || "(staff missing)", e }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [emp.employees, empNameById]
  );

  const rows = useMemo(
    () => (tab === "pending" ? lv.leaves.filter((l) => l.status === "pending") : lv.leaves),
    [lv.leaves, tab]
  );
  const pendingCount = useMemo(() => lv.leaves.filter((l) => l.status === "pending").length, [lv.leaves]);

  const days = leaveDayCount(form.from_date, form.to_date);

  const validate = (): string | null => {
    if (!form.employee) return "Employee चुनें।";
    if (!isIsoDate(form.from_date) || !isIsoDate(form.to_date)) return "From / To date दें।";
    if (form.to_date < form.from_date) return "To date, From date से पहले नहीं हो सकती।";
    const clash = lv.all.find(
      (l) =>
        l.employee === form.employee &&
        (l.status === "pending" || l.status === "approved") &&
        rangesOverlap(l.from_date, l.to_date, form.from_date, form.to_date)
    );
    if (clash) {
      return `इस employee की ${clash.from_date} → ${clash.to_date} की leave पहले से ${HR_LEAVE_STATUS_LABEL[clash.status]} है।`;
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    setFormError(err);
    if (err) return;
    try {
      await lv.createRequest({
        employee: form.employee,
        from_date: form.from_date,
        to_date: form.to_date,
        leave_type: form.leave_type,
        reason: form.reason,
      });
      toast.success(`Leave request बन गई (${days} दिन)।`);
      setForm(emptyForm());
      setFormOpen(false);
      setTab("pending");
    } catch (e) {
      toast.error(`Save नहीं हुआ: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const decide = async (appId: string, next: "approved" | "rejected") => {
    if (next === "rejected" && !window.confirm("यह leave request reject करें?")) return;
    try {
      await lv.decide(appId, next);
      toast.success(next === "approved" ? "Leave approved." : "Leave rejected.");
    } catch (e) {
      toast.error(`नहीं हो पाया: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  const loading = emp.loading || lv.loading;
  const disabled = emp.disabled || lv.disabled;
  const error = emp.error || lv.error;
  const showActions = canApproveLeave;
  const colCount = showActions ? 8 : 7;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="h-full min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Leaves</h1>
          {!canCreate && !canApproveLeave ? <Badge variant="secondary">Read-only</Badge> : null}
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void emp.reload();
                void lv.reload();
              }}
              disabled={loading}
            >
              <RefreshCw className={loading ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
              Refresh
            </Button>
            {canCreate && !formOpen ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setForm(emptyForm());
                  setFormError(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                New leave request
              </Button>
            ) : null}
          </div>
        </div>

        {canCreate && formOpen ? (
          <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="font-medium">New leave request</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <Label>Employee</Label>
                <Select value={form.employee} onValueChange={(v) => setForm((f) => ({ ...f, employee: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={activeEmployees.length ? "Select employee" : "No active employees"} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeEmployees.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.e.designation ? ` · ${a.e.designation}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Leave type</Label>
                <Select
                  value={form.leave_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, leave_type: v as HrLeaveType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HR_LEAVE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {HR_LEAVE_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Days</Label>
                <div
                  className={cn(
                    "flex h-10 items-center rounded-md border px-3 text-sm tabular-nums",
                    days === 0 && "text-destructive"
                  )}
                >
                  {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "—"}
                </div>
              </div>
              <div className="space-y-1">
                <Label>From</Label>
                <Input
                  type="date"
                  value={form.from_date}
                  onChange={(e) =>
                    setForm((f) => {
                      const from_date = e.target.value;
                      // To khali / pehle ho to From ke barabar kar do.
                      const to_date = !f.to_date || (from_date && f.to_date < from_date) ? from_date : f.to_date;
                      return { ...f, from_date, to_date };
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input
                  type="date"
                  value={form.to_date}
                  min={form.from_date || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Reason (optional)</Label>
                <Textarea
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={2}
                  maxLength={500}
                />
              </div>
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen(false)} disabled={lv.saving}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void submit()} disabled={lv.saving}>
                {lv.saving ? "Saving…" : "Submit request"}
              </Button>
            </div>
          </div>
        ) : null}

        <Tabs value={tab} onValueChange={(v) => setTab(v === "all" ? "all" : "pending")}>
          <TabsList>
            <TabsTrigger value="pending">Pending{pendingCount ? ` (${pendingCount})` : ""}</TabsTrigger>
            <TabsTrigger value="all">All ({lv.leaves.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        {disabled ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Server: HR आपके plan में उपलब्ध नहीं है (hr_disabled).
          </p>
        ) : error ? (
          <p className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
            Leaves load नहीं हो पाईं: {error}
          </p>
        ) : null}

        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided</TableHead>
                {showActions ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-sm text-muted-foreground">
                    {tab === "pending" ? "कोई pending leave नहीं।" : "अभी कोई leave नहीं।"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((l) => (
                  <TableRow key={l.app_id}>
                    <TableCell className="font-medium">{empNameById.get(l.employee) || "(employee missing)"}</TableCell>
                    <TableCell>{HR_LEAVE_TYPE_LABEL[l.leave_type] || l.leave_type}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {l.from_date} → {l.to_date}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{leaveDayCount(l.from_date, l.to_date)}</TableCell>
                    <TableCell className="max-w-[16rem] truncate" title={l.reason || ""}>
                      {l.reason || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE[l.status]}>
                        {HR_LEAVE_STATUS_LABEL[l.status] || l.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.status === "pending" ? (
                        "—"
                      ) : (
                        <>
                          <div>{l.decided_by || "—"}</div>
                          <div>{formatDecidedAt(l.decided_at)}</div>
                        </>
                      )}
                    </TableCell>
                    {showActions ? (
                      <TableCell className="text-right">
                        {l.status === "pending" ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-600/90"
                              onClick={() => void decide(l.app_id, "approved")}
                              disabled={lv.deciding !== null}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-red-600"
                              onClick={() => void decide(l.app_id, "rejected")}
                              disabled={lv.deciding !== null}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
