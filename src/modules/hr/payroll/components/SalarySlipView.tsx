"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, Printer, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { cn } from "@/lib/utils";
import { getHrDoc, listHrDocs } from "../../services/hrDocs";
import { HrPill } from "../../components/HrChrome";
import { useHrEmployees } from "../../hooks/useHrEmployees";
import { useHrAttendance } from "../../hooks/useHrAttendance";
import { useHrLeaves } from "../../hooks/useHrLeaves";
import { monthRange } from "../../utils/attendance";
import type { HrPayroll } from "../../types";
import {
  computeEmployeePayroll,
  isPayrollPosted,
  latestPayrollByKey,
  parseHrPayrollAppId,
  payrollData,
  payrollFigures,
  round2,
  type PayrollFiguresEdit,
} from "../utils/payrollCalc";

/**
 * Salary slip shared by the slip page (/hr/payroll/slip/<id>) and the Payroll "Slip" popup (SalarySlipDialog):
 * - useSalarySlip(id) loads the payroll record and gives Refresh / Print / Download PDF;
 * - SalarySlipView draws the slip; SalarySlipActions and SalarySlipStatusPill are the header pieces.
 * Print and PDF contain only the slip element (#hr-salary-slip-print-root), plain black on white.
 */

const SLIP_ELEMENT_ID = "hr-salary-slip-print-root";

/** PDF export toggles this class so the captured slip is plain black on white. */
const SLIP_PDF_CLASS = "hr-slip-pdf";

/**
 * Scoped slip CSS (globals.css untouched).
 * Screen: the ID selector beats the global theme table rule (black / 3px borders on 4K), so slip lines stay
 * 1px theme-coloured. Print and PDF: plain black on white (the only place black is used in HR).
 */
const PRINT_CSS = `
#${SLIP_ELEMENT_ID} table, #${SLIP_ELEMENT_ID} tr, #${SLIP_ELEMENT_ID} td, #${SLIP_ELEMENT_ID} th {
  border-width: 0 !important; border-color: hsl(var(--border)) !important;
}
#${SLIP_ELEMENT_ID} tr.hr-slip-strong { border-top-width: 1px !important; border-top-style: solid !important; }
#${SLIP_ELEMENT_ID}.${SLIP_PDF_CLASS}, #${SLIP_ELEMENT_ID}.${SLIP_PDF_CLASS} * {
  background: #fff !important; color: #000 !important; border-color: #000 !important; box-shadow: none !important;
}
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body * { visibility: hidden !important; }
  #${SLIP_ELEMENT_ID}, #${SLIP_ELEMENT_ID} * { visibility: visible !important; }
  #${SLIP_ELEMENT_ID} {
    position: absolute !important; left: 0 !important; top: 0 !important;
    width: 100% !important; margin: 0 !important; box-shadow: none !important; border: none !important;
    background: #fff !important; color: #000 !important;
  }
  #${SLIP_ELEMENT_ID} *, #${SLIP_ELEMENT_ID} table, #${SLIP_ELEMENT_ID} tr, #${SLIP_ELEMENT_ID} td {
    color: #000 !important; border-color: #000 !important;
  }
  .hr-slip-noprint { display: none !important; }
}
`;

function money(n: number): string {
  return round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function safeFilePart(s: string): string {
  return String(s || "").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60) || "slip";
}

/** Print frame only: the slip is the whole printed document. */
const PRINT_FRAME_CSS = `
html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; color: #000 !important; }
#${SLIP_ELEMENT_ID} { margin: 0 auto !important; box-shadow: none !important; border: none !important; }
`;

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wait until the copied app stylesheets (and fonts) are ready in the print frame, at most `timeoutMs`. */
function waitForFrameStyles(doc: Document, timeoutMs = 3000): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter((l) => !l.sheet);
  const linksReady = Promise.all(
    links.map(
      (l) =>
        new Promise<void>((resolve) => {
          l.addEventListener("load", () => resolve(), { once: true });
          l.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );
  const fontsReady = doc.fonts ? doc.fonts.ready.then(() => undefined) : Promise.resolve();
  return Promise.race([
    Promise.all([linksReady, fontsReady]).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Print only the slip: a hidden iframe gets a copy of the slip element plus the app stylesheets and the
 * black-on-white print CSS, then prints itself. The dialog, the page behind it and the app chrome are not in it.
 */
async function printSlipElement(el: HTMLElement, title: string): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-pl-hr-slip-print-frame", "");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);
  let removed = false;
  const removeFrame = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  try {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error("Print frame is not available.");
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((n) => n.outerHTML)
      .join("\n");
    const clone = el.cloneNode(true) as HTMLElement;
    clone.classList.add(SLIP_PDF_CLASS);
    doc.open();
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${escapeHtml(window.location.href)}">` +
        `<title>${escapeHtml(title)}</title>${styles}<style>${PRINT_CSS}${PRINT_FRAME_CSS}</style></head>` +
        `<body>${clone.outerHTML}</body></html>`
    );
    doc.close();
    await waitForFrameStyles(doc);
    win.addEventListener("afterprint", () => window.setTimeout(removeFrame, 300), { once: true });
    // Safety net when the browser never fires afterprint.
    window.setTimeout(removeFrame, 120000);
    win.focus();
    win.print();
  } catch (e) {
    removeFrame();
    throw e;
  }
}

/** Load one payroll record (`pay_<employee>_<YYYY-MM>`) and everything the slip shows. */
/**
 * `edit`: unsaved Deductions / Addition of the Payroll row (popup only). Draft slips use the same live figures
 * as the Payroll table (payrollFigures + computeEmployeePayroll on current attendance / approved leaves);
 * posted slips show the saved record.
 */
export function useSalarySlip(id: string, edit?: PayrollFiguresEdit) {
  const { company, companyId } = useCompany();
  const cid = String(companyId || "").trim();
  const { processedStaff, vouchers } = useVouchers();
  const { employees, loading: empLoading } = useHrEmployees();
  const [record, setRecord] = useState<HrPayroll | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const reqRef = useRef(0);
  const slipRef = useRef<HTMLDivElement | null>(null);

  const appId = String(id || "").trim();

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    if (!cid || !appId) {
      setRecord(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // pl_docs (hr_payroll) via the local browser DB: direct id first, then a scan as a fallback.
      const direct = await getHrDoc(cid, "payroll", appId);
      let found: HrPayroll[] = direct && direct.deleted !== true ? [direct] : [];
      if (found.length === 0) {
        const parsed = parseHrPayrollAppId(appId);
        const items = await listHrDocs(cid, "payroll");
        found = items.filter(
          (r) => r && r.deleted !== true && (r.app_id === appId || (!!parsed && r.employee === parsed.employee && r.month === parsed.month))
        );
      }
      if (req !== reqRef.current) return;
      const latest = [...latestPayrollByKey(found).values()][0] || found[0] || null;
      setRecord(latest);
      if (!latest) setError("Payroll record not found.");
    } catch (e) {
      if (req !== reqRef.current) return;
      setRecord(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const employee = useMemo(
    () => (record ? employees.find((e) => e.app_id === record.employee) || null : null),
    [record, employees]
  );

  const staffName = useMemo(() => {
    const staffId = employee?.staff_app_id || record?.employee || "";
    if (!staffId) return "";
    const s = (processedStaff || []).find((x) => x.id === staffId);
    return String(s?.name || employee?.name || "");
  }, [employee, record, processedStaff]);

  // Draft: recompute from attendance + approved leaves of the record month, exactly like the Payroll table row.
  const month = String(record?.month || "");
  const range = useMemo(() => monthRange(month), [month]);
  const live = !!record && !isPayrollPosted(record) && !!range;
  const att = useHrAttendance({ from: range?.from || "", to: range?.to || "", enabled: live });
  const lv = useHrLeaves({ from: range?.from, to: range?.to, status: "approved", enabled: live });
  const calc = useMemo(
    () => (live && employee ? computeEmployeePayroll(employee, month, att.records, lv.approved) : null),
    [live, employee, month, att.records, lv.approved]
  );
  const fig = payrollFigures(record, calc, edit);

  const savedData = payrollData(record);
  const data = calc
    ? { ...savedData, days_in_month: calc.days_in_month, salary_type: calc.salary_type, base_salary: calc.base_salary }
    : savedData;
  const posted = fig.posted;
  /** Draft whose live figures differ from the saved draft (Payroll shows "Draft *"). */
  const unsaved = !!record && !posted && fig.dirty;
  const voucherId = String(record?.voucher_app_id || "").trim();

  const voucherNumber = useMemo(() => {
    if (data.voucher_number) return String(data.voucher_number);
    if (!voucherId) return "";
    const v = (vouchers || []).find((x: { id?: string }) => x?.id === voucherId) as
      | { voucherNumber?: string }
      | undefined;
    return String(v?.voucherNumber || "");
  }, [data.voucher_number, voucherId, vouchers]);

  const counts = fig.counts;
  const addition = fig.addition;
  const gross = fig.gross;
  const deductions = fig.deductions;
  const net = fig.net;
  const payable = fig.payable_days;
  const companyName = String(company?.name || "");

  const busy = loading || empLoading;
  const fileBase = `Salary_Slip_${safeFilePart(staffName || record?.employee || "")}_${record?.month || ""}`;

  const print = async () => {
    const el = slipRef.current;
    if (!el || !record) return;
    try {
      await printSlipElement(el, fileBase);
    } catch {
      // Fallback: normal print; the scoped print CSS in SalarySlipView still hides everything except the slip.
      if (typeof window !== "undefined") window.print();
    }
  };

  const downloadPdf = async () => {
    const el = slipRef.current;
    if (!el || !record) return;
    setPdfBusy(true);
    el.classList.add(SLIP_PDF_CLASS);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const filename = `Salary_Slip_${safeFilePart(staffName || record.employee)}_${record.month}.pdf`;
      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename,
        image: { type: "jpeg" as const, quality: 1 },
        html2canvas: { scale: 3, useCORS: true },
        jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const, compress: true },
      };
      await html2pdf().from(el).set(opt).save();
    } catch (e) {
      toast.error("Could not create the PDF", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      el.classList.remove(SLIP_PDF_CLASS);
      setPdfBusy(false);
    }
  };

  return {
    company,
    companyName,
    record,
    employee,
    staffName,
    data,
    posted,
    unsaved,
    voucherId,
    voucherNumber,
    counts,
    addition,
    gross,
    deductions,
    net,
    payable,
    loading,
    busy,
    error,
    pdfBusy,
    slipRef,
    reload: load,
    print,
    downloadPdf,
  };
}

export type SalarySlipState = ReturnType<typeof useSalarySlip>;

/** Posted / Draft badge for the slip header. */
export function SalarySlipStatusPill({ slip }: { slip: SalarySlipState }) {
  if (!slip.record) return null;
  if (slip.posted) return <HrPill tone="good">Posted</HrPill>;
  return (
    <span title={slip.unsaved ? "Live figures from current attendance; Save the draft in Payroll to store them." : undefined}>
      <HrPill tone="info">Draft{slip.unsaved ? " *" : ""}</HrPill>
    </span>
  );
}

/** Refresh / Print / Download PDF, plus optional extra buttons (Close in the popup). */
export function SalarySlipActions({
  slip,
  className,
  children,
}: {
  slip: SalarySlipState;
  className?: string;
  children?: ReactNode;
}) {
  const { busy, record, pdfBusy } = slip;
  return (
    <div className={cn("hr-slip-noprint flex flex-wrap items-center gap-2", className)}>
      <Button type="button" variant="outline" size="sm" onClick={() => void slip.reload()} disabled={busy}>
        <RefreshCw className={busy ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
        Refresh
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => void slip.print()} disabled={!record}>
        <Printer className="mr-1 h-4 w-4" />
        Print
      </Button>
      <Button type="button" size="sm" onClick={() => void slip.downloadPdf()} disabled={!record || pdfBusy}>
        <Download className="mr-1 h-4 w-4" />
        {pdfBusy ? "PDF\u2026" : "Download PDF"}
      </Button>
      {children}
    </div>
  );
}

/** The slip itself (error / loading line + the A4 slip card). */
export function SalarySlipView({ slip }: { slip: SalarySlipState }) {
  const {
    record,
    companyName,
    posted,
    staffName,
    employee,
    data,
    voucherNumber,
    voucherId,
    counts,
    payable,
    gross,
    addition,
    deductions,
    net,
    slipRef,
    error,
    busy,
  } = slip;
  return (
    <>
      <style>{PRINT_CSS}</style>
      {error ? (
        <Alert variant="destructive" className="hr-slip-noprint">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy && !record ? <p className="hr-slip-noprint text-sm text-muted-foreground">Loading…</p> : null}

      {record ? (
        <Card
          id={SLIP_ELEMENT_ID}
          ref={slipRef}
          className="mx-auto w-full max-w-[210mm] p-8 text-[13px] leading-relaxed"
        >
          <div className="border-b border-border pb-3 text-center">
            <div className="text-xl font-bold uppercase tracking-wide">{companyName || "Company"}</div>
            <div className="mt-1 text-sm font-semibold">Salary Slip — {monthLabel(record.month)}</div>
            {!posted ? <div className="mt-1 text-xs italic text-muted-foreground">(Draft — not posted)</div> : null}
          </div>

          <table className="mt-4 w-full border-collapse text-[13px]">
            <tbody>
              <tr>
                <td className="w-1/4 py-1 font-semibold">Employee</td>
                <td className="w-1/4 py-1">{staffName || "—"}</td>
                <td className="w-1/4 py-1 font-semibold">Month</td>
                <td className="w-1/4 py-1">{record.month}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold">Designation</td>
                <td className="py-1">{employee?.designation || "—"}</td>
                <td className="py-1 font-semibold">Department</td>
                <td className="py-1">{employee?.department || "—"}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold">Salary type</td>
                <td className="py-1">
                  {(data.salary_type || employee?.salary_type) === "daily" ? "Daily" : "Monthly"} @{" "}
                  {money(Number(data.base_salary ?? employee?.base_salary ?? 0))}
                </td>
                <td className="py-1 font-semibold">Voucher ref.</td>
                <td className="py-1">{posted ? voucherNumber || voucherId || "—" : "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <div className="border-b border-border pb-1 font-semibold">Attendance</div>
              <table className="w-full border-collapse">
                <tbody>
                  <SlipLine label="Days in month" value={data.days_in_month != null ? String(data.days_in_month) : "—"} />
                  <SlipLine label="Present" value={counts ? String(counts.present) : "—"} />
                  <SlipLine label="Half day" value={counts ? String(counts.half_day) : "—"} />
                  <SlipLine label="Paid leave" value={counts ? String(counts.paid_leave) : "—"} />
                  <SlipLine label="Unpaid leave" value={counts ? String(counts.unpaid_leave) : "—"} />
                  <SlipLine label="Holiday" value={counts ? String(counts.holiday) : "—"} />
                  <SlipLine label="Absent" value={counts ? String(counts.absent) : "—"} />
                  {counts && counts.unmarked > 0 ? <SlipLine label="Unmarked" value={String(counts.unmarked)} /> : null}
                  <SlipLine label="Payable days" value={String(payable)} strong />
                </tbody>
              </table>
            </div>
            <div>
              <div className="border-b border-border pb-1 font-semibold">Earnings &amp; deductions</div>
              <table className="w-full border-collapse">
                <tbody>
                  <SlipLine label="Gross (earned)" value={money(gross)} />
                  <SlipLine
                    label={data.addition_note ? `Addition / Bonus (${data.addition_note})` : "Addition / Bonus"}
                    value={money(addition)}
                  />
                  <SlipLine
                    label={data.deduction_note ? `Deductions (${data.deduction_note})` : "Deductions"}
                    value={`− ${money(deductions)}`}
                  />
                  <SlipLine label="Net payable" value={money(net)} strong />
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-10 text-center text-xs">
            <div>
              <div className="border-t border-border pt-1">Employee signature</div>
            </div>
            <div>
              <div className="border-t border-border pt-1">Authorised signatory</div>
            </div>
          </div>
          <div className="mt-6 text-center text-[10px] text-muted-foreground">This is a computer generated salary slip.</div>
        </Card>
      ) : null}
    </>
  );
}

function SlipLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "hr-slip-strong border-t border-border font-semibold" : undefined}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 text-right tabular-nums">{value}</td>
    </tr>
  );
}
