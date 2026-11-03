"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileText, RefreshCw, Save, Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { useHrEmployees } from "../../hooks/useHrEmployees";
import { useHrAttendance } from "../../hooks/useHrAttendance";
import { useHrLeaves } from "../../hooks/useHrLeaves";
import { currentIsoMonth, isIsoDate, monthRange } from "../../utils/attendance";
import type { HrEmployee, HrPayroll } from "../../types";
import { useHrPayroll, type HrPayrollDraftInput, type HrPayrollPostInput } from "../hooks/useHrPayroll";
import {
  computeEmployeePayroll,
  computeNet,
  isPayrollPosted,
  payrollAddition,
  payrollData,
  round2,
  type PayrollCalcResult,
} from "../utils/payrollCalc";

/** Row edits (string = input ki raw value). */
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
  /** Draft save karna baaki (edit ya attendance badla). */
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

/** Route /hr/payroll isko HrGate me wrap karta hai. */
export function PayrollPage() {
  return <PayrollPageBody />;
}

function PayrollPageBody() {
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

  const emp = useHrEmployees();
  const att = useHrAttendance({ from: range?.from || "", to: range?.to || "", enabled: !!range });
  const lv = useHrLeaves({ from: range?.from, to: range?.to, status: "approved", enabled: !!range });
  const pay = useHrPayroll({ month, enabled: !!range });

  // Month badalne par unsaved edits hata do.
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

  // Debit (salary expense) account: pehle saved choice, warna naam me "salary".
  useEffect(() => {
    if (!cid || expenseOptions.length === 0) return;
    if (debitAccountId && expenseOptions.some((o) => o.id === debitAccountId)) return;
    const stored = readStoredDebit(cid);
    if (stored && expenseOptions.some((o) => o.id === stored)) {
      setDebitAccountId(stored);
      return;
    }
    const guess = expenseOptions.find((o) => /salary|wage|वेतन|तलब/i.test(o.name));
    if (guess) setDebitAccountId(guess.id);
  }, [cid, expenseOptions, debitAccountId]);

  const rows: PayrollRow[] = useMemo(() => {
    if (!range) return [];
    return emp.employees
      .filter((e) => {
        if (pay.byEmployee.has(e.app_id)) return true;
        if (e.status !== "active") return false;
        return !e.joining_date || !isIsoDate(e.joining_date) || e.joining_date <= range.to;
      })
      .map((e) => {
        const saved = pay.byEmployee.get(e.app_id);
        const posted = isPayrollPosted(saved);
        const calc = computeEmployeePayroll(e, month, att.records, lv.approved);
        const edit = edits[e.app_id];
        const name = staffNames.get(e.staff_app_id) || "";
        if (posted && saved) {
          const addition = payrollAddition(saved);
          return {
            emp: e,
            name: name || "(staff missing)",
            staffExists: !!name,
            saved,
            posted,
            calc,
            payableDays: Number(saved.present_days || 0),
            gross: Number(saved.gross || 0),
            deductions: Number(saved.deductions || 0),
            addition,
            net: Number(saved.net || 0),
            dirty: false,
          };
        }
        const gross = calc ? calc.gross : Number(saved?.gross || 0);
        const payableDays = calc ? calc.payable_days : Number(saved?.present_days || 0);
        const deductions = parseAmount(edit?.deductions, Number(saved?.deductions || 0));
        const addition = parseAmount(edit?.addition, payrollAddition(saved));
        const net = computeNet(gross, deductions, addition);
        const dirty =
          !saved ||
          round2(Number(saved.gross || 0)) !== gross ||
          round2(Number(saved.present_days || 0)) !== payableDays ||
          round2(Number(saved.deductions || 0)) !== deductions ||
          payrollAddition(saved) !== addition;
        return {
          emp: e,
          name: name || "(staff missing)",
          staffExists: !!name,
          saved,
          posted,
          calc,
          payableDays,
          gross,
          deductions,
          addition,
          net,
          dirty,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [range, emp.employees, pay.byEmployee, att.records, lv.approved, edits, staffNames, month]);

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
      toast.info("Sab employees ke drafts pehle se hain.");
      return;
    }
    try {
      const n = await pay.saveDrafts(newRows.map(toDraftInput));
      toast.success(`${n} draft(s) generated`);
    } catch (e) {
      toast.error("Drafts save नहीं हुए", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveAll = async () => {
    if (!editable || dirtyRows.length === 0) return;
    try {
      const n = await pay.saveDrafts(dirtyRows.map(toDraftInput));
      setEdits({});
      toast.success(`${n} payroll draft(s) saved`);
    } catch (e) {
      toast.error("Save नहीं हुआ", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const postable = (r: PayrollRow) => editable && !r.posted && r.staffExists && r.net > 0;

  const askPost = (employees: string[]) => {
    if (!editable) return;
    if (!debitAccountId) {
      toast.error("पहले Salary expense (Debit) account चुनें।");
      return;
    }
    if (employees.length === 0) {
      toast.info("Post करने लायक कोई draft नहीं है।");
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
        toast.error(`${res.failed.length} post नहीं हुए`, {
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
  const disabled = emp.disabled || att.disabled || lv.disabled || pay.disabled;
  const error = emp.error || att.error || lv.error || pay.error;
  const busy = pay.saving || bulkBusy || pay.posting.length > 0;

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
          <h1 className="text-lg font-semibold">Payroll</h1>
          {!editable ? (
            <Badge variant="secondary" title="hr_payroll permission नहीं है">
              Read-only
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="w-auto"
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
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="hr-payroll-debit" className="text-muted-foreground">
              Salary expense (Debit) account:
            </label>
            <select
              id="hr-payroll-debit"
              value={debitAccountId}
              onChange={(e) => {
                setDebitAccountId(e.target.value);
                writeStoredDebit(cid, e.target.value);
              }}
              className="h-9 min-w-[14rem] rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— चुनें —</option>
              {expenseOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Post = Add Salary voucher (Dr expense / Cr staff, amount = Net), date = month का आखिरी दिन।
            </span>
          </div>
        ) : null}

        {!range ? (
          <p className="text-sm text-muted-foreground">Month चुनें (YYYY-MM)।</p>
        ) : disabled ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Server: HR आपके plan में उपलब्ध नहीं है (hr_disabled).
          </p>
        ) : error ? (
          <p className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
            Payroll load नहीं हो पाया: {error}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
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
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground">
                    No employees.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const c = r.posted ? payrollData(r.saved).counts || r.calc?.counts : r.calc?.counts;
                  const rowEditable = editable && !r.posted;
                  const postingNow = pay.isPosting(r.emp.app_id);
                  return (
                    <TableRow key={r.emp.app_id}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
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
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90">Posted</Badge>
                        ) : r.saved ? (
                          <Badge variant="secondary">Draft{r.dirty ? " *" : ""}</Badge>
                        ) : (
                          <Badge variant="outline">New</Badge>
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
                            title={r.saved ? "Salary slip" : "पहले draft save करें"}
                            onClick={() =>
                              r.saved && router.push(`/hr/payroll/slip/${encodeURIComponent(r.saved.app_id)}`)
                            }
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
              <TableFooter>
                <TableRow>
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
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Payable days = Present + ½×Half day + Holiday + Paid leave (unpaid leave / absent / unmarked = 0). Monthly: Gross =
          Base × Payable ÷ month days; Daily: Gross = Base × Payable. Net = Gross + Addition − Deductions. Posted payroll
          read-only है।
        </p>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Payroll post करें?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRows.length} employee(s) के लिए Add Salary voucher बनेगा — total Net{" "}
              {money(confirmRows.reduce((s, r) => s + r.net, 0))} ({month})। Post के बाद payroll edit नहीं होगा।
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmRows.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-md border text-sm">
              {confirmRows.map((r) => (
                <div key={r.emp.app_id} className="flex justify-between border-b px-3 py-1.5 last:border-b-0">
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
