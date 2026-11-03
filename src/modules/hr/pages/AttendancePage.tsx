"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CheckCheck, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { cn } from "@/lib/utils";
import { useHrEmployees } from "../hooks/useHrEmployees";
import { useHrAttendance, type HrAttendanceMark } from "../hooks/useHrAttendance";
import { useHrLeaves } from "../hooks/useHrLeaves";
import { HR_LEAVE_TYPE_LABEL, approvedLeaveOn } from "../utils/leaves";
import { todayIsoDate } from "../utils/employeeDefaults";
import {
  HR_ATTENDANCE_LABEL,
  HR_ATTENDANCE_SHORT,
  HR_ATTENDANCE_STATUSES,
  attendanceKey,
  currentIsoMonth,
  isIsoDate,
  monthRange,
} from "../utils/attendance";
import type { HrAttendanceStatus, HrEmployee, HrLeave } from "../types";

/** Status ke rang — sirf is module ke andar Tailwind classes (globals.css nahi). */
const STATUS_TONE: Record<HrAttendanceStatus, string> = {
  present: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  absent: "bg-red-600 text-white hover:bg-red-600/90",
  half_day: "bg-amber-500 text-white hover:bg-amber-500/90",
  leave: "bg-sky-600 text-white hover:bg-sky-600/90",
  holiday: "bg-violet-600 text-white hover:bg-violet-600/90",
};

const STATUS_TEXT: Record<HrAttendanceStatus, string> = {
  present: "text-emerald-600",
  absent: "text-red-600",
  half_day: "text-amber-600",
  leave: "text-sky-600",
  holiday: "text-violet-600",
};

type Draft = { status?: HrAttendanceStatus; note: string };

/** Route /hr/attendance isko HrGate me wrap karta hai. */
export function AttendancePage() {
  return <AttendancePageBody />;
}

function useStaffNames() {
  const { processedStaff } = useVouchers();
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const s of processedStaff || []) m.set(s.id, String(s.name || ""));
    return m;
  }, [processedStaff]);
}

function employeeName(e: HrEmployee, names: Map<string, string>): string {
  return names.get(e.staff_app_id) || "(staff missing)";
}

function AttendancePageBody() {
  const router = useRouter();
  const { company } = useCompany();
  const { canAttendance, canManage } = useHrModuleFeature();
  const editable = canAttendance || canManage;
  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  const [date, setDate] = useState<string>(() => todayIsoDate());
  const [month, setMonth] = useState<string>(() => currentIsoMonth());

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="h-full min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Attendance</h1>
          {!editable ? (
            <Badge variant="secondary" title="hr_attendance permission नहीं है">
              Read-only
            </Badge>
          ) : null}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v === "monthly" ? "monthly" : "daily")}>
          <TabsList>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
          <TabsContent value="daily" className="mt-3">
            <DailyAttendance date={date} onDateChange={setDate} editable={editable} active={tab === "daily"} />
          </TabsContent>
          <TabsContent value="monthly" className="mt-3">
            <MonthlyAttendance
              month={month}
              onMonthChange={setMonth}
              active={tab === "monthly"}
              onOpenDay={(d) => {
                setDate(d);
                setTab("daily");
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Daily                                                               */
/* ------------------------------------------------------------------ */

function DailyAttendance({
  date,
  onDateChange,
  editable,
  active,
}: {
  date: string;
  onDateChange: (d: string) => void;
  editable: boolean;
  active: boolean;
}) {
  const names = useStaffNames();
  const emp = useHrEmployees();
  const att = useHrAttendance({ from: date, to: date, enabled: active && isIsoDate(date) });
  const lv = useHrLeaves({ from: date, to: date, status: "approved", enabled: active && isIsoDate(date) });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // Date badalne par unsaved draft hata do.
  useEffect(() => {
    setDrafts({});
  }, [date]);

  const rows = useMemo(() => {
    const list = emp.employees.filter((e) => {
      const hasRecord = att.byKey.has(attendanceKey(e.app_id, date));
      if (hasRecord) return true; // purana record hai to (left employee bhi) dikhao
      if (e.status !== "active") return false;
      // Joining se pehle ki date par nahi dikhana.
      return !e.joining_date || !isIsoDate(e.joining_date) || e.joining_date <= date;
    });
    return list
      .map((e) => ({
        emp: e,
        name: employeeName(e, names),
        saved: att.byKey.get(attendanceKey(e.app_id, date)),
        leave: approvedLeaveOn(lv.leaves, e.app_id, date),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [emp.employees, att.byKey, lv.leaves, names, date]);

  const effective = useCallback(
    (empId: string, saved?: { status: HrAttendanceStatus; note?: string }, leave?: HrLeave) => {
      const d = drafts[empId];
      // Approved leave + koi saved record nahi → "leave" prefill (Save abhi bhi zaroori).
      const leavePrefill: HrAttendanceStatus | undefined = !saved && leave ? "leave" : undefined;
      const status = (d?.status ?? saved?.status ?? leavePrefill) as HrAttendanceStatus | undefined;
      return {
        status,
        note: d ? d.note : String(saved?.note || ""),
        fromLeave: !!leavePrefill && status === "leave",
      };
    },
    [drafts]
  );

  const dirtyIds = useMemo(() => {
    const out: string[] = [];
    for (const r of rows) {
      const d = drafts[r.emp.app_id];
      if (!d && !(r.leave && !r.saved)) continue; // leave-prefill bhi save karna hai
      const cur = effective(r.emp.app_id, r.saved, r.leave);
      if (!cur.status) continue;
      if (cur.status !== r.saved?.status || cur.note.trim() !== String(r.saved?.note || "").trim()) {
        out.push(r.emp.app_id);
      }
    }
    return out;
  }, [rows, drafts, effective]);

  const setStatus = (empId: string, status: HrAttendanceStatus, savedNote?: string) => {
    setDrafts((prev) => ({
      ...prev,
      [empId]: { status, note: prev[empId]?.note ?? String(savedNote || "") },
    }));
  };

  const setNote = (empId: string, note: string, savedStatus?: HrAttendanceStatus) => {
    setDrafts((prev) => ({
      ...prev,
      [empId]: { status: prev[empId]?.status ?? savedStatus, note },
    }));
  };

  const markAllPresent = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        // Approved leave wale (bina saved record) ko present nahi karte.
        if (!r.saved && r.leave && !prev[r.emp.app_id]) continue;
        next[r.emp.app_id] = {
          status: "present",
          note: prev[r.emp.app_id]?.note ?? String(r.saved?.note || ""),
        };
      }
      return next;
    });
  };

  const save = async () => {
    if (!editable || dirtyIds.length === 0) return;
    const byId = new Map(rows.map((r) => [r.emp.app_id, r]));
    const marks: HrAttendanceMark[] = [];
    for (const id of dirtyIds) {
      const r = byId.get(id);
      if (!r) continue;
      const cur = effective(id, r.saved, r.leave);
      if (!cur.status) continue;
      marks.push({
        app_id: r.saved?.app_id,
        employee: id,
        date,
        status: cur.status,
        note: cur.note,
        data: r.saved?.data ?? (cur.fromLeave && r.leave ? { leave_app_id: r.leave.app_id } : null),
      });
    }
    try {
      const n = await att.saveMarks(marks);
      setDrafts({});
      toast.success(`${n} attendance saved (${date}).`);
    } catch (e) {
      toast.error(`Save नहीं हुआ: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const changeDate = (next: string) => {
    if (next === date) return;
    if (dirtyIds.length > 0 && !window.confirm("Unsaved changes हैं। फिर भी date बदलें?")) return;
    onDateChange(next);
  };

  const counts = useMemo(() => {
    const c: Record<HrAttendanceStatus, number> = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0 };
    let unmarked = 0;
    for (const r of rows) {
      const s = effective(r.emp.app_id, r.saved, r.leave).status;
      if (s) c[s] += 1;
      else unmarked += 1;
    }
    return { c, unmarked };
  }, [rows, effective]);

  const loading = emp.loading || att.loading;
  const disabled = emp.disabled || att.disabled;
  const error = emp.error || att.error;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && changeDate(e.target.value)}
          className="w-auto"
          aria-label="Attendance date"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => changeDate(todayIsoDate())}>
          Today
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void emp.reload();
            void att.reload();
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
          Refresh
        </Button>
        {editable ? (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={markAllPresent} disabled={rows.length === 0}>
              <CheckCheck className="mr-1 h-4 w-4" />
              Mark all present
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={att.saving || dirtyIds.length === 0}>
              <Save className="mr-1 h-4 w-4" />
              {att.saving ? "Saving…" : `Save${dirtyIds.length ? ` (${dirtyIds.length})` : ""}`}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {HR_ATTENDANCE_STATUSES.map((s) => (
          <span key={s} className={cn("font-medium", STATUS_TEXT[s])}>
            {HR_ATTENDANCE_LABEL[s]}: {counts.c[s]}
          </span>
        ))}
        <span className="text-muted-foreground">Unmarked: {counts.unmarked}</span>
      </div>

      {disabled ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Server: HR आपके plan में उपलब्ध नहीं है (hr_disabled).
        </p>
      ) : error ? (
        <p className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
          Attendance load नहीं हो पाई: {error}
        </p>
      ) : null}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[30%]">Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  इस date पर कोई active employee नहीं।
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const cur = effective(r.emp.app_id, r.saved, r.leave);
                const dirty = dirtyIds.includes(r.emp.app_id);
                return (
                  <TableRow key={r.emp.app_id} className={dirty ? "bg-muted/40" : undefined}>
                    <TableCell className="font-medium">
                      <div>{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[r.emp.designation, r.emp.department].filter(Boolean).join(" · ") || "—"}
                        {r.emp.status !== "active" ? " · Left" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <div className="flex flex-wrap gap-1">
                          {HR_ATTENDANCE_STATUSES.map((s) => (
                            <Button
                              key={s}
                              type="button"
                              size="sm"
                              variant={cur.status === s ? "default" : "outline"}
                              className={cn("h-7 px-2 text-xs", cur.status === s && STATUS_TONE[s])}
                              onClick={() => setStatus(r.emp.app_id, s, r.saved?.note)}
                              aria-pressed={cur.status === s}
                            >
                              {HR_ATTENDANCE_LABEL[s]}
                            </Button>
                          ))}
                        </div>
                      ) : cur.status ? (
                        <span className={cn("text-sm font-medium", STATUS_TEXT[cur.status])}>
                          {HR_ATTENDANCE_LABEL[cur.status]}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                      {cur.fromLeave && r.leave ? (
                        <div className="mt-1 text-xs italic text-sky-600">
                          Approved leave ({HR_LEAVE_TYPE_LABEL[r.leave.leave_type] || r.leave.leave_type}, {r.leave.from_date} → {r.leave.to_date}) से — Save करें
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Input
                          value={cur.note}
                          onChange={(e) => setNote(r.emp.app_id, e.target.value, r.saved?.status)}
                          placeholder="Note (optional)"
                          className="h-8"
                          maxLength={500}
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">{cur.note || "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {editable && counts.unmarked > 0 && dirtyIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">Unmarked employees save नहीं होंगे।</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monthly (read-only grid)                                            */
/* ------------------------------------------------------------------ */

function MonthlyAttendance({
  month,
  onMonthChange,
  active,
  onOpenDay,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  active: boolean;
  onOpenDay: (date: string) => void;
}) {
  const names = useStaffNames();
  const emp = useHrEmployees();
  const range = useMemo(() => monthRange(month), [month]);
  const att = useHrAttendance({
    from: range?.from || "",
    to: range?.to || "",
    enabled: active && !!range,
  });
  const lv = useHrLeaves({
    from: range?.from,
    to: range?.to,
    status: "approved",
    enabled: active && !!range,
  });

  const rows = useMemo(() => {
    if (!range) return [];
    const withRecords = new Set<string>();
    for (const r of att.byKey.values()) withRecords.add(r.employee);
    return emp.employees
      .filter((e) => {
        if (withRecords.has(e.app_id)) return true;
        if (e.status !== "active") return false;
        return !e.joining_date || !isIsoDate(e.joining_date) || e.joining_date <= range.to;
      })
      .map((e) => {
        const c: Record<HrAttendanceStatus, number> = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0 };
        const cells = range.days.map((d) => {
          const s = att.byKey.get(attendanceKey(e.app_id, d))?.status;
          if (s) {
            c[s] += 1;
            return { s, fromLeave: false };
          }
          // Saved record nahi, par approved leave → halka "L" (counts me nahi).
          const leave = approvedLeaveOn(lv.leaves, e.app_id, d);
          return leave ? { s: "leave" as HrAttendanceStatus, fromLeave: true } : { s: undefined, fromLeave: false };
        });
        return { emp: e, name: employeeName(e, names), cells, counts: c };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [range, emp.employees, att.byKey, lv.leaves, names]);

  const totals = useMemo(() => {
    const t: Record<HrAttendanceStatus, number> = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0 };
    for (const r of rows) for (const s of HR_ATTENDANCE_STATUSES) t[s] += r.counts[s];
    return t;
  }, [rows]);

  const loading = emp.loading || att.loading;
  const disabled = emp.disabled || att.disabled;
  const error = emp.error || att.error;
  const today = todayIsoDate();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="month"
          value={month}
          onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          className="w-auto"
          aria-label="Attendance month"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => onMonthChange(currentIsoMonth())}>
          This month
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void emp.reload();
            void att.reload();
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
          Refresh
        </Button>
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          {HR_ATTENDANCE_STATUSES.map((s) => (
            <span key={s} className={cn("font-medium", STATUS_TEXT[s])}>
              {HR_ATTENDANCE_SHORT[s]} = {HR_ATTENDANCE_LABEL[s]}
            </span>
          ))}
          <span className="italic text-sky-600 opacity-50" title="Approved leave, attendance save नहीं हुई">
            L (हल्का) = approved leave, unmarked (count में नहीं)
          </span>
        </div>
      </div>

      {!range ? (
        <p className="text-sm text-muted-foreground">Month चुनें (YYYY-MM)।</p>
      ) : disabled ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Server: HR आपके plan में उपलब्ध नहीं है (hr_disabled).
        </p>
      ) : error ? (
        <p className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
          Attendance load नहीं हो पाई: {error}
        </p>
      ) : null}

      {range ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 min-w-[10rem] bg-card p-2 text-left font-medium">Employee</th>
                {range.days.map((d) => (
                  <th key={d} className="p-0 text-center font-normal">
                    <button
                      type="button"
                      className={cn(
                        "w-7 py-2 hover:bg-muted",
                        d === today && "font-semibold text-primary"
                      )}
                      title={`${d} — daily view खोलें`}
                      onClick={() => onOpenDay(d)}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </th>
                ))}
                {HR_ATTENDANCE_STATUSES.map((s) => (
                  <th key={s} className={cn("px-2 py-2 text-center font-medium", STATUS_TEXT[s])}>
                    {HR_ATTENDANCE_SHORT[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={range.days.length + 6} className="p-3 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={range.days.length + 6} className="p-3 text-center text-muted-foreground">
                    No employees.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.emp.app_id} className="border-b last:border-b-0">
                    <td className="sticky left-0 z-10 bg-card p-2 font-medium">{r.name}</td>
                    {r.cells.map(({ s, fromLeave }, i) => (
                      <td
                        key={range.days[i]}
                        className={cn(
                          "w-7 text-center",
                          s ? STATUS_TEXT[s] : "text-muted-foreground/40",
                          fromLeave && "italic opacity-50"
                        )}
                        title={
                          s
                            ? `${range.days[i]}: ${HR_ATTENDANCE_LABEL[s]}${fromLeave ? " (approved leave, not marked)" : ""}`
                            : range.days[i]
                        }
                      >
                        {s ? HR_ATTENDANCE_SHORT[s] : "·"}
                      </td>
                    ))}
                    {HR_ATTENDANCE_STATUSES.map((s) => (
                      <td key={s} className="px-2 text-center tabular-nums">
                        {r.counts[s]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="sticky left-0 z-10 bg-card p-2">Total</td>
                  <td colSpan={range.days.length} />
                  {HR_ATTENDANCE_STATUSES.map((s) => (
                    <td key={s} className={cn("px-2 py-2 text-center tabular-nums", STATUS_TEXT[s])}>
                      {totals[s]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}
    </div>
  );
}
