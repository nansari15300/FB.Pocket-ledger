"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileText, RefreshCw, Save, Send, Wand2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableFooter, TableHead, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { cn } from "@/lib/utils";
import {
  HR_TABLE_FOOTER,
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
} from "../../components/HrTable";
import { HR_FIELD_PILL, HR_FIELD_SCOPE, HR_NARRATION_TEXT, HR_PAGE_BODY, HrHeaderCard, HrPill } from "../../components/HrChrome";
import { SalarySlipDialog } from "../components/SalarySlipDialog";
import { useHrEmployees } from "../../hooks/useHrEmployees";
import { useHrAttendance } from "../../hooks/useHrAttendance";
import { useHrLeaves } from "../../hooks/useHrLeaves";
import { currentIsoMonth, isIsoDate, monthRange } from "../../utils/attendance";
import { employeeLeftDate } from "../../utils/leftDate";
import type { HrEmployee, HrPayroll } from "../../types";
import { useHrPayroll, type HrPayrollDraftInput, type HrPayrollPostInput } from "../hooks/useHrPayroll";
import {
  computeEmployeePayroll,
  isPayrollPosted,
  payrollAddition,
  payrollData,
  payrollFigures,
  round2,
  type PayrollCalcResult,
} from "../utils/payrollCalc";

/** Row edits (string = raw input value). */
type RowEdit = { deductions?: string; addition?: string };

type PayrollRow = {
  emp: HrEmployee;
  name: string;
  staffExists: boolean;
  saved?: HrPayroll;
  posted: boolean;
  calc: PayrollCalcResult | null;
  payableDays: number;
  gross: number;
  deductions: number;
  addition: number;
  net: number;
  /** Draft still needs saving (edited, or attendance changed). */
  dirty: boolean;
};

const DEBIT_ACCOUNT_STORAGE_PREFIX = "pl_hr_payroll_debit_account_v1:";

function money(n: number): string {
  return round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseAmount(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const t = String(v).trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? round2(n) : fallback;
}

function readStoredDebit(cid: string): string {
  if (typeof window === "undefined" || !cid) return "";
  try {
    return window.localStorage.getItem(DEBIT_ACCOUNT_STORAGE_PREFIX + cid) || "";
  } catch {
    return "";
  }
}

function writeStoredDebit(cid: string, id: string) {
  if (typeof window === "undefined" || !cid) return;
  try {
    window.localStorage.setItem(DEBIT_ACCOUNT_STORAGE_PREFIX + cid, id);
  } catch {
    /* ignore */
  }
}

/** The /hr/payroll route wraps this in HrGate. */
/** `embedded`: shown inside the HR home tab panel (no back arrow / title; the tab card is the title). */
export function PayrollPage({ embedded = false }: { embedded?: boolean } = {}) {
  return <PayrollPageBody embedded={embedded} />;
}

function PayrollPageBody({ embedded }: { embedded: boolean }) {
  const router = useRouter();
  const { company, companyId } = useCompany();
  const { canPayroll } = useHrModuleFeature();
  const editable = canPayroll;
  const cid = String(companyId || "").trim();
  const { processedStaff, processedExpenseAccounts } = useVouchers();
  const [month, setMonth] = useState<string>(() => currentIsoMonth());
  const range = useMemo(() => monthRange(month), [month]);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [debitAccountId, setDebitAccountId] = useState<string>("");
  const [confirm, setConfirm] = useState<{ employees: string[] } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Salary slip popup: last opened record stays mounted so the close animation can run. */
  const [slipId, setSlipId] = useState<string | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const openSlip = (payrollId: string) => {
    setSlipId(payrollId);
    setSlipOpen(true);
  };

  const emp = useHrEmployees();
  const att = useHrAttendance({ from: range?.from || "", to: range?.to || "", enabled: !!range });
  const lv = useHrLeaves({ from: range?.from, to: range?.to, status: "approved", enabled: !!range });
  const pay = useHrPayroll({ month, enabled: !!range });

  // Changing the month clears unsaved edits.
  useEffect(() => {
    setEdits({});
  }, [month]);

  const staffNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of processedStaff || []) m.set(s.id, String(s.name || ""));
    return m;
  }, [processedStaff]);

  const expenseOptions = useMemo(
    () =>
      (processedExpenseAccounts || [])
        .filter((a) => a.id !== "sales_account" && a.id !== "purchase_account")
        .map((a) => ({ id: a.id, name: String(a.name || a.id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [processedExpenseAccounts]
  );

  // Debit (salary expense) account: saved choice first, otherwise a name containing "salary".
  useEffect(() => {
    if (!cid || expenseOptions.length === 0) return;
    if (debitAccountId && expenseOptions.some((o) => o.id === debitAccountId)) return;
    const stored = readStoredDebit(cid);
    if (stored && expenseOptions.some((o) => o.id === stored)) {
      setDebitAccountId(stored);
      return;
    }
    const guess = expenseOptions.find((o) => /salary|wage|\u0935\u0947\u0924\u0928|\u0924\u0932\u092c/i.test(o.name));
    if (guess) setDebitAccountId(guess.id);
  }, [cid, expenseOptions, debitAccountId]);

  const rows: PayrollRow[] = useMemo(() => {
    if (!range) return [];
    // Left employees: shown when the left date is in/after this month's start, or they have attendance this month.
    const withAttendance = new Set(att.records.map((a) => a.employee));
    return emp.employees
      .filter((e) => {
        if (pay.byEmployee.has(e.app_id)) return true;
        if (e.joining_date && isIsoDate(e.joining_date) && e.joining_date > range.to) return false;
        if (e.status === "active") return true;
        const left = employeeLeftDate(e);
        return (!!left && left >= range.from) || withAttendance.has(e.app_id);
      })
      .map((e) => {
        const saved = pay.byEmployee.get(e.app_id);
        const posted = isPayrollPosted(saved);
        const calc = computeEmployeePayroll(e, month, att.records, lv.approved);
        const edit = edits[e.app_id];
        const name = staffNames.get(e.staff_app_id) || "";
        // Same figures as the salary slip (payrollFigures): posted = saved; draft = live calc + edits.
        const fig = payrollFigures(saved, calc, {
          deductions: parseAmount(edit?.deductions, Number(saved?.deductions || 0)),
          addition: parseAmount(edit?.addition, payrollAddition(saved)),
        });
        return {
          emp: e,
          name: name || "(staff missing)",
          staffExists: !!name,
          saved,
          posted,
          calc,
          payableDays: fig.payable_days,
          gross: fig.gross,
          deductions: fig.deductions,
          addition: fig.addition,
          net: fig.net,
          dirty: fig.dirty,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [range, emp.employees, pay.byEmployee, att.records, lv.approved, edits, staffNames, month]);

  /** Row behind the open slip: its unsaved Deductions / Addition go to the slip so both show the same Net. */
  const slipRow = slipId ? rows.find((r) => r.saved?.app_id === slipId) : undefined;

  const totals = useMemo(() => {
    const t = { gross: 0, addition: 0, deductions: 0, net: 0 };
    for (const r of rows) {
      t.gross += r.gross;
      t.addition += r.addition;
      t.deductions += r.deductions;
      t.net += r.net;
    }
    return { gross: round2(t.gross), addition: round2(t.addition), deductions: round2(t.deductions), net: round2(t.net) };
  }, [rows]);

  const toDraftInput = useCallback(
    (r: PayrollRow): HrPayrollDraftInput => ({
      app_id: r.saved?.app_id,
      employee: r.emp.app_id,
      month,
      present_days: r.payableDays,
      gross: r.gross,
      deductions: r.deductions,
      data: {
        addition: r.addition,
        payable_days: r.payableDays,
        days_in_month: r.calc?.days_in_month,
        salary_type: r.emp.salary_type,
        base_salary: Number(r.emp.base_salary || 0),
        counts: r.calc?.counts,
      },
    }),
    [month]
  );

  const toPostInput = useCallback(
    (r: PayrollRow): HrPayrollPostInput => ({
      ...toDraftInput(r),
      staffId: r.emp.staff_app_id,
      staffName: r.name,
      debitAccountId,
      narration: `HR Payroll ${month} — ${r.name} (payable ${r.payableDays} days)`,
    }),
    [toDraftInput, debitAccountId, month]
  );

  const draftRows = rows.filter((r) => !r.posted);
  const newRows = draftRows.filter((r) => !r.saved);
  const dirtyRows = draftRows.filter((r) => r.dirty);

  const generateDrafts = async () => {
    if (!editable) return;
    if (newRows.length === 0) {
      toast.info("All employees already have drafts.");
      return;
    }
    try {
      const n = await pay.saveDrafts(newRows.map(toDraftInput));
      toast.success(`${n} draft(s) generated`);
    } catch (e) {
      toast.error("Could not save drafts", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveAll = async () => {
    if (!editable || dirtyRows.length === 0) return;
    try {
      const n = await pay.saveDrafts(dirtyRows.map(toDraftInput));
      setEdits({});
      toast.success(`${n} payroll draft(s) saved`);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const postable = (r: PayrollRow) => editable && !r.posted && r.staffExists && r.net > 0;

  const askPost = (employees: string[]) => {
    if (!editable) return;
    if (!debitAccountId) {
      toast.error("Select the salary expense (debit) account first.");
      return;
    }
    if (employees.length === 0) {
      toast.info("There are no drafts ready to post.");
      return;
    }
    setConfirm({ employees });
  };

  const confirmRows = useMemo(() => {
    if (!confirm) return [];
    const set = new Set(confirm.employees);
    return rows.filter((r) => set.has(r.emp.app_id) && postable(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, rows, editable]);

  const doPost = async () => {
    const list = confirmRows;
    setConfirm(null);
    if (list.length === 0) return;
    writeStoredDebit(cid, debitAccountId);
    setBulkBusy(true);
    try {
      const res = await pay.postMany(list.map(toPostInput));
      if (res.ok > 0) toast.success(`${res.ok} payroll posted (salary voucher created)`);
      if (res.failed.length > 0) {
        const byId = new Map(rows.map((r) => [r.emp.app_id, r.name]));
        toast.error(`${res.failed.length} could not be posted`, {
          description: res.failed.map((f) => `${byId.get(f.employee) || f.employee}: ${f.error}`).join("\n"),
        });
      }
      setEdits((prev) => {
        const next = { ...prev };
        for (const r of list) delete next[r.emp.app_id];
        return next;
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const setEdit = (empId: string, patch: RowEdit) => {
    setEdits((prev) => ({ ...prev, [empId]: { ...prev[empId], ...patch } }));
  };

  const loading = emp.loading || att.loading || lv.loading || pay.loading;
  const error = emp.error || att.error || lv.error || pay.error;
  const busy = pay.saving || bulkBusy || pay.posting.length > 0;

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  return (
    <div data-pl-hr-root="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", HR_FIELD_SCOPE)}>
      <div className={cn(HR_PAGE_BODY, HR_FILL_COLUMN)}>
        {!embedded || !editable ? (
          <HrHeaderCard tone="violet">
            {!embedded ? (
              <>
                <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="text-lg font-semibold">Payroll</h1>
              </>
            ) : null}
            {!editable ? (
              <HrPill tone="info" title="You do not have the hr_payroll permission">
                Read-only
              </HrPill>
            ) : null}
          </HrHeaderCard>
        ) : null}

        <HrHeaderCard tone="indigo">
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className={cn("w-auto", HR_FIELD_PILL)}
            aria-label="Payroll month"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setMonth(currentIsoMonth())}>
            This month
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void emp.reload();
              void att.reload();
              void lv.reload();
              void pay.reload();
            }}
            disabled={loading}
          >
            <RefreshCw className={loading ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
            Refresh
          </Button>
          {editable ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={generateDrafts} disabled={busy || loading || !range}>
                <Wand2 className="mr-1 h-4 w-4" />
                Generate drafts{newRows.length > 0 ? ` (${newRows.length})` : ""}
              </Button>
              <Button type="button" size="sm" onClick={saveAll} disabled={busy || dirtyRows.length === 0}>
                <Save className="mr-1 h-4 w-4" />
                Save{dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ""}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => askPost(draftRows.filter(postable).map((r) => r.emp.app_id))}
                disabled={busy || draftRows.filter(postable).length === 0}
              >
                <Send className="mr-1 h-4 w-4" />
                Post all
              </Button>
            </>
          ) : null}
        </HrHeaderCard>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="hr-payroll-debit" className="text-muted-foreground">
              Salary expense (debit) account:
            </label>
            <Select
              value={debitAccountId}
              onValueChange={(v) => {
                setDebitAccountId(v);
                writeStoredDebit(cid, v);
              }}
            >
              <SelectTrigger
                id="hr-payroll-debit"
                className={cn("w-auto min-w-[14rem]", HR_FIELD_PILL)}
                aria-label="Salary expense account"
              >
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {expenseOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span data-pl-intro="" className={HR_NARRATION_TEXT}>
              Post creates an Add Salary voucher (Dr expense, Cr staff, amount = Net) dated the last day of the month.
            </span>
          </div>
        ) : null}

        {!range ? (
          <p className="text-sm text-muted-foreground">Select a month (YYYY-MM).</p>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load payroll</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className={cn(HR_TABLE_FRAME, HR_TABLE_FRAME_FILL)} {...HR_TABLE_FRAME_DATA}>
          <HrTable stickyHeaderFooter>
            <HrTableHeader>
              <TableRow className={HR_TABLE_ROW}>
                <TableHead className={HR_SNO_HEAD}>S.No.</TableHead>
                <TableHead className="min-w-[10rem]">Employee</TableHead>
                <TableHead className="text-center" title="Present">P</TableHead>
                <TableHead className="text-center" title="Half day">½</TableHead>
                <TableHead className="text-center" title="Paid leave / Unpaid leave">Leave (paid/unpaid)</TableHead>
                <TableHead className="text-center" title="Holiday">H</TableHead>
                <TableHead className="text-center">Payable days</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Addition / Bonus</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </HrTableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={13} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={13} className="text-center text-muted-foreground">
                    No employees.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, ri) => {
                  const c = r.posted ? payrollData(r.saved).counts || r.calc?.counts : r.calc?.counts;
                  const rowEditable = editable && !r.posted;
                  const postingNow = pay.isPosting(r.emp.app_id);
                  return (
                    <TableRow key={r.emp.app_id} {...hrStripe(ri)} className={HR_TABLE_ROW}>
                      <TableCell className={HR_SNO_CELL}>{ri + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">
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
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[r.emp.designation, r.emp.department].filter(Boolean).join(" · ") || "—"}
                          {" · "}
                          {r.emp.salary_type === "daily" ? "Daily" : "Monthly"} {money(Number(r.emp.base_salary || 0))}
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{c ? c.present : "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">{c ? c.half_day : "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {c ? (
                          <span>
                            {c.paid_leave}
                            <span className="text-muted-foreground"> / {c.unpaid_leave}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{c ? c.holiday : "—"}</TableCell>
                      <TableCell className="text-center font-medium tabular-nums">
                        {r.payableDays}
                        {r.calc && !r.posted ? (
                          <span className="text-xs text-muted-foreground"> / {r.calc.days_in_month}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.gross)}</TableCell>
                      <TableCell className="text-right">
                        {rowEditable ? (
                          <Input
                            inputMode="decimal"
                            value={edits[r.emp.app_id]?.addition ?? (r.addition ? String(r.addition) : "")}
                            onChange={(e) => setEdit(r.emp.app_id, { addition: e.target.value })}
                            placeholder="0"
                            className="ml-auto h-8 w-24 text-right"
                            aria-label={`Addition for ${r.name}`}
                          />
                        ) : (
                          <span className="tabular-nums">{money(r.addition)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {rowEditable ? (
                          <Input
                            inputMode="decimal"
                            value={edits[r.emp.app_id]?.deductions ?? (r.deductions ? String(r.deductions) : "")}
                            onChange={(e) => setEdit(r.emp.app_id, { deductions: e.target.value })}
                            placeholder="0"
                            className="ml-auto h-8 w-24 text-right"
                            aria-label={`Deductions for ${r.name}`}
                          />
                        ) : (
                          <span className="tabular-nums">{money(r.deductions)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(r.net)}</TableCell>
                      <TableCell>
                        {r.posted ? (
                          <HrPill tone="good">Posted</HrPill>
                        ) : r.saved ? (
                          <HrPill tone="info">Draft{r.dirty ? " *" : ""}</HrPill>
                        ) : (
                          <HrPill tone="muted">New</HrPill>
                        )}
                        {!r.staffExists ? <div className="mt-1 text-xs text-destructive">Staff ledger missing</div> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {postable(r) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={busy || postingNow}
                              onClick={() => askPost([r.emp.app_id])}
                            >
                              <Send className={cn("mr-1 h-3.5 w-3.5", postingNow && "animate-pulse")} />
                              Post
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            disabled={!r.saved}
                            title={r.saved ? "Salary slip" : "Save the draft first"}
                            aria-label={r.saved ? `Salary slip for ${r.name}` : "Save the draft first"}
                            onClick={() => r.saved && openSlip(r.saved.app_id)}
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            Slip
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            {rows.length > 0 ? (
              <TableFooter className={HR_TABLE_FOOTER}>
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell className={HR_SNO_CELL} />
                  <TableCell colSpan={6} className="font-medium">
                    Total ({rows.length})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(totals.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(totals.addition)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(totals.deductions)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(totals.net)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            ) : null}
          </HrTable>
        </div>

        <p data-pl-intro="" className={HR_NARRATION_TEXT}>
          Payable days = Present + ½×Half day + Holiday + Paid leave (unpaid leave / absent / unmarked = 0). Monthly: Gross =
          Base × Payable ÷ month days; Daily: Gross = Base × Payable. Net = Gross + Addition − Deductions. Posted payroll
          is read-only.
        </p>
      </div>

      {slipId ? (
        <SalarySlipDialog
          id={slipId}
          open={slipOpen}
          onOpenChange={setSlipOpen}
          edit={slipRow && !slipRow.posted ? { deductions: slipRow.deductions, addition: slipRow.addition } : undefined}
        />
      ) : null}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post payroll?</AlertDialogTitle>
            <AlertDialogDescription>
              An Add Salary voucher will be created for {confirmRows.length} employee(s), total Net{" "}
              {money(confirmRows.reduce((s, r) => s + r.net, 0))} ({month}). Posted payroll cannot be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmRows.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-md border border-border text-sm">
              {confirmRows.map((r) => (
                <div
                  key={r.emp.app_id}
                  className="flex justify-between border-b border-border px-3 py-1.5 last:border-b-0"
                >
                  <span>{r.name}</span>
                  <span className="tabular-nums">{money(r.net)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doPost()} disabled={confirmRows.length === 0}>
              Post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
