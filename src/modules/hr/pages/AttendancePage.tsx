"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CheckCheck, RefreshCw, Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableBody, TableCell, TableFooter, TableHead, TableRow } from "@/components/ui/table";
import { useCompany } from "@/hooks/useCompany";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { cn } from "@/lib/utils";
import {
  HR_TABLE_FOOTER,
  HR_FILL_COLUMN,
  HR_FILL_TAB_CONTENT,
  HR_FILL_TABS,
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
import { HR_FIELD_PILL, HR_FIELD_SCOPE, HR_NARRATION_TEXT, HR_PAGE_BODY, HrHeaderCard, HrPill } from "../components/HrChrome";
import { useHrEmployees } from "../hooks/useHrEmployees";
import { useHrAttendance, type HrAttendanceMark } from "../hooks/useHrAttendance";
import { useHrLeaves } from "../hooks/useHrLeaves";
import { HR_LEAVE_TYPE_LABEL, approvedLeaveOn } from "../utils/leaves";
import { todayIsoDate } from "../utils/employeeDefaults";
import { employeeLeftDate, isAfterLeftDate, isEmployeeWorkingOn } from "../utils/leftDate";
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

/**
 * Status text colors: theme tokens only. `--pl-pos` / `--pl-warn` come from the active theme
 * (if a theme does not define them, the text keeps the normal foreground color).
 */
const STATUS_TEXT: Record<HrAttendanceStatus, string> = {
  present: "text-[color:var(--pl-pos)]",
  absent: "text-destructive",
  half_day: "text-[color:var(--pl-warn)]",
  leave: "text-primary",
  holiday: "text-muted-foreground",
};

type Draft = { status?: HrAttendanceStatus; note: string };

/** The /hr/attendance route wraps this in HrGate. */
/** `embedded`: shown inside the HR home tab panel (no back arrow / title; the tab card is the title). */
export function AttendancePage({ embedded = false }: { embedded?: boolean } = {}) {
  return <AttendancePageBody embedded={embedded} />;
}

function employeeName(e: HrEmployee): string {
  return e.name || "(no name)";
}

function AttendancePageBody({ embedded }: { embedded: boolean }) {
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
    <div data-pl-hr-root="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", HR_FIELD_SCOPE)}>
      <div className={cn(HR_PAGE_BODY, HR_FILL_COLUMN)}>
        {!embedded || !editable ? (
          <HrHeaderCard tone="emerald">
            {!embedded ? (
              <>
                <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="text-lg font-semibold">Attendance</h1>
              </>
            ) : null}
            {!editable ? (
              <HrPill tone="info" title="You do not have the hr_attendance permission">
                Read-only
              </HrPill>
            ) : null}
          </HrHeaderCard>
        ) : null}

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v === "monthly" ? "monthly" : "daily")}
          className={HR_FILL_TABS}
        >
          <TabsList>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
          <TabsContent value="daily" className={cn("mt-3", HR_FILL_TAB_CONTENT)}>
            <DailyAttendance date={date} onDateChange={setDate} editable={editable} active={tab === "daily"} />
          </TabsContent>
          <TabsContent value="monthly" className={cn("mt-3", HR_FILL_TAB_CONTENT)}>
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
  const emp = useHrEmployees();
  const att = useHrAttendance({ from: date, to: date, enabled: active && isIsoDate(date) });
  const lv = useHrLeaves({ from: date, to: date, status: "approved", enabled: active && isIsoDate(date) });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // Changing the date clears unsaved drafts.
  useEffect(() => {
    setDrafts({});
  }, [date]);

  const rows = useMemo(() => {
    const list = emp.employees.filter((e) => {
      // Left employees: never after their left date (no marking there).
      if (isAfterLeftDate(e, date)) return false;
      const hasRecord = att.byKey.has(attendanceKey(e.app_id, date));
      if (hasRecord) return true; // show saved records (even for employees who left)
      // Joined on/before this date, and active or left on/after it.
      return isEmployeeWorkingOn(e, date);
    });
    return list
      .map((e) => ({
        emp: e,
        name: employeeName(e),
        saved: att.byKey.get(attendanceKey(e.app_id, date)),
        leave: approvedLeaveOn(lv.leaves, e.app_id, date),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [emp.employees, att.byKey, lv.leaves, date]);

  const effective = useCallback(
    (empId: string, saved?: { status: HrAttendanceStatus; note?: string }, leave?: HrLeave) => {
      const d = drafts[empId];
      // Approved leave and no saved record → prefill "leave" (still needs Save).
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
      if (!d && !(r.leave && !r.saved)) continue; // leave prefill also needs saving
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
        // Do not mark people on approved leave (without a saved record) as present.
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
      if (!r || isAfterLeftDate(r.emp, date)) continue;
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
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const changeDate = (next: string) => {
    if (next === date) return;
    if (dirtyIds.length > 0 && !window.confirm("You have unsaved changes. Change the date anyway?")) return;
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
  const error = emp.error || att.error;

  return (
    <div className={cn("space-y-3", HR_FILL_COLUMN)}>
      <HrHeaderCard tone="teal">
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && changeDate(e.target.value)}
          className={cn("w-auto", HR_FIELD_PILL)}
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
      </HrHeaderCard>

      <div className="flex flex-wrap gap-2 text-xs">
        {HR_ATTENDANCE_STATUSES.map((s) => (
          <span key={s} className={cn("font-medium", STATUS_TEXT[s])}>
            {HR_ATTENDANCE_LABEL[s]}: {counts.c[s]}
          </span>
        ))}
        <span className="text-muted-foreground">Unmarked: {counts.unmarked}</span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load attendance</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className={cn(HR_TABLE_FRAME, HR_TABLE_FRAME_FILL)} {...HR_TABLE_FRAME_DATA}>
        <HrTable stickyHeaderFooter>
          <HrTableHeader>
            <TableRow className={HR_TABLE_ROW}>
              <TableHead className={HR_SNO_HEAD}>S.No.</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[30%]">Note</TableHead>
            </TableRow>
          </HrTableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow className={HR_TABLE_ROW}>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className={HR_TABLE_ROW}>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  No active employees on this date.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, ri) => {
                const cur = effective(r.emp.app_id, r.saved, r.leave);
                const dirty = dirtyIds.includes(r.emp.app_id);
                return (
                  <TableRow key={r.emp.app_id} {...hrStripe(ri)} className={cn(HR_TABLE_ROW, dirty && "bg-muted/40")}>
                    <TableCell className={HR_SNO_CELL}>{ri + 1}</TableCell>
                    <TableCell className="font-medium">
                      <div>{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[r.emp.designation, r.emp.department].filter(Boolean).join(" · ") || "—"}
                        {r.emp.status !== "active"
                          ? employeeLeftDate(r.emp)
                            ? ` · Left (${employeeLeftDate(r.emp)})`
                            : " · Left"
                          : ""}
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
                              className={cn("h-7 px-2 text-xs", cur.status !== s && STATUS_TEXT[s])}
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
                        <div className="mt-1 text-xs italic text-primary">
                          From approved leave ({HR_LEAVE_TYPE_LABEL[r.leave.leave_type] || r.leave.leave_type},{" "}
                          {r.leave.from_date} → {r.leave.to_date}). Press Save to record it.
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Input
                          value={cur.note}
                          onChange={(e) => setNote(r.emp.app_id, e.target.value, r.saved?.status)}
                          placeholder="Note (optional)"
                          aria-label={`Note for ${r.name}`}
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
        </HrTable>
      </div>
      {editable && counts.unmarked > 0 && dirtyIds.length > 0 ? (
        <p data-pl-intro="" className={HR_NARRATION_TEXT}>
          Unmarked employees are not saved.
        </p>
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
    const byKey = att.byKey;
    const leaves = lv.leaves;
    const withRecords = new Set<string>();
    for (const r of byKey.values()) withRecords.add(r.employee);
    return emp.employees
      .filter((e) => {
        if (withRecords.has(e.app_id)) return true;
        if (e.joining_date && isIsoDate(e.joining_date) && e.joining_date > range.to) return false;
        if (e.status === "active") return true;
        // Left: only while the left date is in/after this month.
        const left = employeeLeftDate(e);
        return !!left && left >= range.from;
      })
      .map((e) => {
        const c: Record<HrAttendanceStatus, number> = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0 };
        const cells = range.days.map((d) => {
          // After the left date: blank, not counted, no marking.
          if (isAfterLeftDate(e, d)) return { s: undefined, fromLeave: false, afterLeft: true };
          const s = byKey.get(attendanceKey(e.app_id, d))?.status;
          if (s) {
            c[s] += 1;
            return { s, fromLeave: false, afterLeft: false };
          }
          // No saved record but an approved leave → faded "L" (not counted).
          const leave = approvedLeaveOn(leaves, e.app_id, d);
          return leave
            ? { s: "leave" as HrAttendanceStatus, fromLeave: true, afterLeft: false }
            : { s: undefined, fromLeave: false, afterLeft: false };
        });
        return { emp: e, name: employeeName(e), cells, counts: c };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [range, emp.employees, att.byKey, lv.leaves]);

  const totals = useMemo(() => {
    const t: Record<HrAttendanceStatus, number> = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0 };
    for (const r of rows) for (const s of HR_ATTENDANCE_STATUSES) t[s] += r.counts[s];
    return t;
  }, [rows]);

  const loading = emp.loading || att.loading;
  const error = emp.error || att.error;
  const today = todayIsoDate();

  return (
    <div className={cn("space-y-3", HR_FILL_COLUMN)}>
      <HrHeaderCard tone="teal">
        <Input
          type="month"
          value={month}
          onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          className={cn("w-auto", HR_FIELD_PILL)}
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
          <span className="italic text-primary opacity-50" title="Approved leave, attendance not saved">
            Faded L = approved leave, not marked (not counted)
          </span>
        </div>
      </HrHeaderCard>

      {!range ? (
        <p className="text-sm text-muted-foreground">Select a month (YYYY-MM).</p>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load attendance</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {range ? (
        <div className={cn(HR_TABLE_FRAME, HR_TABLE_FRAME_FILL)} {...HR_TABLE_FRAME_DATA}>
          <HrTable stickyHeaderFooter className="border-collapse text-xs">
            <HrTableHeader>
              <TableRow className={HR_TABLE_ROW}>
                <TableHead className="sticky left-0 z-10 w-12 min-w-[3rem] bg-card p-2 text-center font-medium">
                  S.No.
                </TableHead>
                <TableHead className="sticky left-12 z-10 min-w-[10rem] bg-card p-2 text-left font-medium">
                  Employee
                </TableHead>
                {range.days.map((d) => (
                  <TableHead key={d} className="h-auto p-0 text-center font-normal">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 w-7 rounded-none p-0 text-xs font-normal",
                        d === today && "font-semibold text-primary"
                      )}
                      title={`${d}: open the daily view`}
                      aria-label={`Open daily attendance for ${d}`}
                      onClick={() => onOpenDay(d)}
                    >
                      {Number(d.slice(8))}
                    </Button>
                  </TableHead>
                ))}
                {HR_ATTENDANCE_STATUSES.map((s) => (
                  <TableHead key={s} className={cn("px-2 py-2 text-center font-medium", STATUS_TEXT[s])}>
                    {HR_ATTENDANCE_SHORT[s]}
                  </TableHead>
                ))}
              </TableRow>
            </HrTableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={range.days.length + 7} className="p-3 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={range.days.length + 7} className="p-3 text-center text-muted-foreground">
                    No employees.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, ri) => (
                  <TableRow key={r.emp.app_id} {...hrStripe(ri)} className={HR_TABLE_ROW}>
                    <TableCell className="sticky left-0 z-10 w-12 min-w-[3rem] bg-card p-2 text-center tabular-nums text-muted-foreground">
                      {ri + 1}
                    </TableCell>
                    <TableCell className="sticky left-12 z-10 bg-card p-2 font-medium">
                      {r.name}
                      {r.emp.status === "left" ? (
                        <HrPill
                          tone="muted"
                          className="ml-2"
                          title={r.emp.left_date ? `Left on ${r.emp.left_date}` : "Left"}
                        >
                          Left
                        </HrPill>
                      ) : null}
                    </TableCell>
                    {r.cells.map(({ s, fromLeave, afterLeft }, i) =>
                      afterLeft ? (
                        <TableCell
                          key={range.days[i]}
                          className="w-7 bg-muted/40 text-center"
                          title={`${range.days[i]}: after the left date`}
                        />
                      ) : (
                        <TableCell
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
                        </TableCell>
                      )
                    )}
                    {HR_ATTENDANCE_STATUSES.map((s) => (
                      <TableCell key={s} className="px-2 text-center tabular-nums">
                        {r.counts[s]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
            {rows.length > 0 ? (
              <TableFooter className={HR_TABLE_FOOTER}>
                <TableRow className={cn(HR_TABLE_ROW, "font-medium")}>
                  <TableCell className="sticky left-0 z-10 w-12 min-w-[3rem] bg-card p-2" />
                  <TableCell className="sticky left-12 z-10 bg-card p-2">Total</TableCell>
                  <TableCell colSpan={range.days.length} />
                  {HR_ATTENDANCE_STATUSES.map((s) => (
                    <TableCell key={s} className={cn("px-2 py-2 text-center tabular-nums", STATUS_TEXT[s])}>
                      {totals[s]}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            ) : null}
          </HrTable>
        </div>
      ) : null}
    </div>
  );
}
