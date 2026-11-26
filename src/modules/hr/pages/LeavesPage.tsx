"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Plus, RefreshCw, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { cn } from "@/lib/utils";
import {
  HR_NARRATION,
  HR_FILL_COLUMN,
  HR_SNO_CELL,
  HR_SNO_HEAD,
  HR_TABLE_FRAME,
  HR_TABLE_FRAME_DATA,
  HR_TABLE_FRAME_FILL,
  HR_TABLE_ROW,
  HrTable,
  HrTableHeader,
  hrStripe,
} from "../components/HrTable";
import { HR_FIELD_SCOPE, HR_PAGE_BODY, HrHeaderCard, HrPill, hrRibbon, type HrPillTone } from "../components/HrChrome";
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

const STATUS_PILL: Record<HrLeaveStatus, HrPillTone> = {
  pending: "info",
  approved: "good",
  rejected: "bad",
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

/** The /hr/leaves route wraps this in HrGate. */
/** `embedded`: shown inside the HR home tab panel (no back arrow / title; the tab card is the title). */
export function LeavesPage({ embedded = false }: { embedded?: boolean } = {}) {
  return <LeavesPageBody embedded={embedded} />;
}

function LeavesPageBody({ embedded }: { embedded: boolean }) {
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

  /** Employee id = staff id, so any staff name (also former employees) resolves. */
  const empNameById = useMemo(() => {
    const m = new Map<string, string>(staffNameById);
    for (const e of emp.employees) if (e.name) m.set(e.app_id, e.name);
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
    if (!form.employee) return "Select an employee.";
    if (!isIsoDate(form.from_date) || !isIsoDate(form.to_date)) return "Enter the From and To dates.";
    if (form.to_date < form.from_date) return "The To date cannot be before the From date.";
    const clash = lv.all.find(
      (l) =>
        l.employee === form.employee &&
        (l.status === "pending" || l.status === "approved") &&
        rangesOverlap(l.from_date, l.to_date, form.from_date, form.to_date)
    );
    if (clash) {
      return `This employee already has a ${String(HR_LEAVE_STATUS_LABEL[clash.status] || clash.status).toLowerCase()} leave for ${clash.from_date} → ${clash.to_date}.`;
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
      toast.success(`Leave request created (${days} day${days === 1 ? "" : "s"}).`);
      setForm(emptyForm());
      setFormOpen(false);
      setTab("pending");
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const decide = async (appId: string, next: "approved" | "rejected") => {
    if (next === "rejected" && !window.confirm("Reject this leave request?")) return;
    try {
      await lv.decide(appId, next);
      toast.success(next === "approved" ? "Leave approved." : "Leave rejected.");
    } catch (e) {
      toast.error(`Could not update: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  const loading = emp.loading || lv.loading;
  const error = emp.error || lv.error;
  const showActions = canApproveLeave;
  const colCount = showActions ? 9 : 8;

  return (
    <div data-pl-hr-root="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", HR_FIELD_SCOPE)}>
      <div className={cn(HR_PAGE_BODY, HR_FILL_COLUMN)}>
        <HrHeaderCard tone="amber">
          {!embedded ? (
            <>
              <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-lg font-semibold">Leaves</h1>
            </>
          ) : null}
          {!canCreate && !canApproveLeave ? <HrPill tone="info">Read-only</HrPill> : null}
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
        </HrHeaderCard>

        {canCreate && formOpen ? (
          <Card className={hrRibbon("amber")}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">New leave request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="hr-leave-employee">Employee</Label>
                <Select value={form.employee} onValueChange={(v) => setForm((f) => ({ ...f, employee: v }))}>
                  <SelectTrigger id="hr-leave-employee" aria-label="Employee">
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
                <Label htmlFor="hr-leave-type">Leave type</Label>
                <Select
                  value={form.leave_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, leave_type: v as HrLeaveType }))}
                >
                  <SelectTrigger id="hr-leave-type" aria-label="Leave type">
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
                    "flex h-10 items-center rounded-md border border-input px-3 text-sm tabular-nums",
                    days === 0 && "text-destructive"
                  )}
                >
                  {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "—"}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="hr-leave-from">From</Label>
                <Input
                  id="hr-leave-from"
                  type="date"
                  value={form.from_date}
                  onChange={(e) =>
                    setForm((f) => {
                      const from_date = e.target.value;
                      // If To is empty or earlier, set it to From.
                      const to_date = !f.to_date || (from_date && f.to_date < from_date) ? from_date : f.to_date;
                      return { ...f, from_date, to_date };
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="hr-leave-to">To</Label>
                <Input
                  id="hr-leave-to"
                  type="date"
                  value={form.to_date}
                  min={form.from_date || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="hr-leave-reason">Reason (optional)</Label>
                <Textarea
                  id="hr-leave-reason"
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
            </CardContent>
          </Card>
        ) : null}

        <Tabs value={tab} onValueChange={(v) => setTab(v === "all" ? "all" : "pending")}>
          <TabsList>
            <TabsTrigger value="pending">Pending{pendingCount ? ` (${pendingCount})` : ""}</TabsTrigger>
            <TabsTrigger value="all">All ({lv.leaves.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load leaves</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className={cn(HR_TABLE_FRAME, HR_TABLE_FRAME_FILL)} {...HR_TABLE_FRAME_DATA}>
          <HrTable stickyHeaderFooter>
            <HrTableHeader>
              <TableRow className={HR_TABLE_ROW}>
                <TableHead className={HR_SNO_HEAD}>S.No.</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided</TableHead>
                {showActions ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </HrTableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={colCount} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={colCount} className="text-center text-sm text-muted-foreground">
                    {tab === "pending" ? "No pending leave requests." : "No leave requests yet."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((l, li) => (
                  <TableRow key={l.app_id} {...hrStripe(li)} className={HR_TABLE_ROW}>
                    <TableCell className={HR_SNO_CELL}>{li + 1}</TableCell>
                    <TableCell className="font-medium">{empNameById.get(l.employee) || "(employee missing)"}</TableCell>
                    <TableCell>
                      <HrPill tone="muted">{HR_LEAVE_TYPE_LABEL[l.leave_type] || l.leave_type}</HrPill>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {l.from_date} → {l.to_date}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{leaveDayCount(l.from_date, l.to_date)}</TableCell>
                    <TableCell className={cn("max-w-[16rem] truncate", HR_NARRATION)} title={l.reason || ""}>
                      {l.reason || "—"}
                    </TableCell>
                    <TableCell>
                      <HrPill tone={STATUS_PILL[l.status] || "info"}>
                        {HR_LEAVE_STATUS_LABEL[l.status] || l.status}
                      </HrPill>
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
                              className="h-7 px-2 text-xs"
                              onClick={() => void decide(l.app_id, "approved")}
                              disabled={lv.deciding !== null}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2 text-xs"
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
          </HrTable>
        </div>
      </div>
    </div>
  );
}
