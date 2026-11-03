"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Download, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { hrApi, isHrDisabledError } from "../../services/hrApi";
import { useHrEmployees } from "../../hooks/useHrEmployees";
import type { HrPayroll } from "../../types";
import {
  isPayrollPosted,
  latestPayrollByKey,
  parseHrPayrollAppId,
  payrollAddition,
  payrollData,
  round2,
} from "../utils/payrollCalc";

const SLIP_ELEMENT_ID = "hr-salary-slip-print-root";

/** Print layout sirf is component me scoped (globals.css untouched). */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body * { visibility: hidden !important; }
  #${SLIP_ELEMENT_ID}, #${SLIP_ELEMENT_ID} * { visibility: visible !important; }
  #${SLIP_ELEMENT_ID} {
    position: absolute !important; left: 0 !important; top: 0 !important;
    width: 100% !important; margin: 0 !important; box-shadow: none !important; border: none !important;
    background: #fff !important; color: #000 !important;
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

export type SalarySlipPageProps = {
  /** Payroll record app_id (`pay_<employee>_<YYYY-MM>`). */
  id: string;
};

export function SalarySlipPage({ id }: SalarySlipPageProps) {
  const router = useRouter();
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
      const parsed = parseHrPayrollAppId(appId);
      let items = await hrApi.list("payroll", cid, parsed ? { month: parsed.month, employee: parsed.employee } : {});
      let found = items.filter((r) => r && r.app_id === appId && r.deleted !== true);
      if (found.length === 0 && parsed) {
        // app_id custom ho sakta hai — month se dobara try.
        items = await hrApi.list("payroll", cid, { month: parsed.month });
        found = items.filter((r) => r && r.app_id === appId && r.deleted !== true);
      }
      if (req !== reqRef.current) return;
      const latest = [...latestPayrollByKey(found).values()][0] || found[0] || null;
      setRecord(latest);
      if (!latest) setError("Payroll record नहीं मिला।");
    } catch (e) {
      if (req !== reqRef.current) return;
      setRecord(null);
      setError(isHrDisabledError(e) ? "HR आपके plan में उपलब्ध नहीं है (hr_disabled)." : e instanceof Error ? e.message : String(e));
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
    if (!employee) return "";
    const s = (processedStaff || []).find((x) => x.id === employee.staff_app_id);
    return String(s?.name || "");
  }, [employee, processedStaff]);

  const data = payrollData(record);
  const posted = isPayrollPosted(record);
  const voucherId = String(record?.voucher_app_id || "").trim();

  const voucherNumber = useMemo(() => {
    if (data.voucher_number) return String(data.voucher_number);
    if (!voucherId) return "";
    const v = (vouchers || []).find((x: { id?: string }) => x?.id === voucherId) as
      | { voucherNumber?: string }
      | undefined;
    return String(v?.voucherNumber || "");
  }, [data.voucher_number, voucherId, vouchers]);

  const counts = data.counts;
  const addition = payrollAddition(record);
  const gross = Number(record?.gross || 0);
  const deductions = Number(record?.deductions || 0);
  const net = Number(record?.net || 0);
  const payable = Number(record?.present_days || 0);
  const companyName = String(company?.name || "");

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  const handlePdf = async () => {
    const el = slipRef.current;
    if (!el || !record) return;
    setPdfBusy(true);
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
      toast.error("PDF नहीं बना", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPdfBusy(false);
    }
  };

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  const busy = loading || empLoading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <style>{PRINT_CSS}</style>
      <div className="h-full min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="hr-slip-noprint flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr/payroll")} aria-label="Back to payroll">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Salary slip</h1>
          {record ? (
            posted ? (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90">Posted</Badge>
            ) : (
              <Badge variant="secondary">Draft</Badge>
            )
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className={busy ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
              Refresh
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handlePrint} disabled={!record}>
              <Printer className="mr-1 h-4 w-4" />
              Print
            </Button>
            <Button type="button" size="sm" onClick={() => void handlePdf()} disabled={!record || pdfBusy}>
              <Download className="mr-1 h-4 w-4" />
              {pdfBusy ? "PDF…" : "Download PDF"}
            </Button>
          </div>
        </div>

        {error ? <p className="hr-slip-noprint text-sm text-destructive">{error}</p> : null}
        {busy && !record ? <p className="hr-slip-noprint text-sm text-muted-foreground">Loading…</p> : null}

        {record ? (
          <div
            id={SLIP_ELEMENT_ID}
            ref={slipRef}
            className="mx-auto w-full max-w-[210mm] rounded-xl border bg-white p-8 text-[13px] leading-relaxed text-black shadow-sm"
          >
            <div className="border-b border-black/70 pb-3 text-center">
              <div className="text-xl font-bold uppercase tracking-wide">{companyName || "Company"}</div>
              <div className="mt-1 text-sm font-semibold">Salary Slip — {monthLabel(record.month)}</div>
              {!posted ? <div className="mt-1 text-xs italic text-gray-600">(Draft — not posted)</div> : null}
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
                <div className="border-b border-black/60 pb-1 font-semibold">Attendance</div>
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
                <div className="border-b border-black/60 pb-1 font-semibold">Earnings &amp; deductions</div>
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
                <div className="border-t border-black/70 pt-1">Employee signature</div>
              </div>
              <div>
                <div className="border-t border-black/70 pt-1">Authorised signatory</div>
              </div>
            </div>
            <div className="mt-6 text-center text-[10px] text-gray-500">This is a computer generated salary slip.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SlipLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-black/60 font-semibold" : undefined}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 text-right tabular-nums">{value}</td>
    </tr>
  );
}
