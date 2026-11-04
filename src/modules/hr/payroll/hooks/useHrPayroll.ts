"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast as sonnerToast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { useVouchers } from "@/hooks/useVouchers";
import { saveVoucher, isVoucherLimitError } from "@/lib/voucherActionsClient";
import { getNextVoucherNumberForCompany } from "@/lib/nextVoucherNumber";
import { dispatchVoucherLivePatch, voucherAttachmentFieldsForSave } from "@/lib/voucherFormAttachmentSave";
import { beginVoucherSaveLoadingOrBlock, voucherSaveErrorToast } from "@/lib/voucherSaveUi";
import { assertCan, assertCanPerformBackdated, PermissionDeniedError } from "@/lib/permissions/enforcePermission";
import { getHrDoc, listHrDocs, subscribeHrDocs, writeHrDocs, type HrDocWriteInput } from "../../services/hrDocs";
import type { HrPayroll } from "../../types";
import {
  computeNet,
  hrPayrollAppId,
  isIsoMonth,
  isPayrollPosted,
  latestPayrollByKey,
  monthEndDate,
  payrollData,
  payrollKey,
  round2,
  type HrPayrollData,
} from "../utils/payrollCalc";

export type UseHrPayrollParams = {
  /** YYYY-MM */
  month: string;
  /** false = do not load. Default true. */
  enabled?: boolean;
};

/** Draft save input (status is always "draft"; a posted record is never overwritten). */
export type HrPayrollDraftInput = {
  /** Existing record app_id (otherwise deterministic `pay_<staffId>_<YYYY-MM>`). */
  app_id?: string;
  employee: string;
  month: string;
  /** Payable days (present + 0.5*half + holiday + paid leave). */
  present_days: number;
  gross: number;
  deductions: number;
  /** Extra JSON (addition / counts / notes). Merged over the existing data. */
  data?: HrPayrollData;
};

export type HrPayrollPostInput = HrPayrollDraftInput & {
  /** Staff ledger id (voucher credit side, same as Add Salary). */
  staffId: string;
  staffName: string;
  /** Salary expense account (voucher debit side, same as Add Salary "Debit Account"). */
  debitAccountId: string;
  narration?: string;
};

const ADD_SALARY_DEFAULT_PREFIX = "ADSAL-";

/** Module-level lock: the same payroll cannot be posted twice at once (double click / bulk + row). */
const POSTING_LOCK = new Set<string>();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Payroll list (month) + draft upsert + post, stored in pl_docs `hr_payroll`.
 * Post = Add Salary voucher via the existing `saveVoucher` (type "journal", subType "add_salary"),
 * then the pl_docs record is updated to status "posted" with voucher_app_id + voucher number. Posted = read-only.
 */
export function useHrPayroll({ month, enabled = true }: UseHrPayrollParams) {
  const { companyId, company } = useCompany();
  const { user } = useAuth();
  const { can, canPerformBackdatedAction } = usePermissions();
  const { vouchers } = useVouchers();
  const [records, setRecords] = useState<HrPayroll[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const disabled = false;
  const reqRef = useRef(0);

  const cid = String(companyId || "").trim();
  const monthOk = isIsoMonth(month);

  const reload = useCallback(async () => {
    const req = ++reqRef.current;
    if (!cid || !enabled || !monthOk) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await listHrDocs(cid, "payroll");
      if (req !== reqRef.current) return;
      setRecords(items.filter((r) => r && r.month === month));
    } catch (e) {
      if (req !== reqRef.current) return;
      setError(errMsg(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, enabled, monthOk, month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!cid || !enabled) return;
    return subscribeHrDocs(cid, ["payroll"], () => void reload());
  }, [cid, enabled, reload]);

  /** employee app_id → latest payroll of this month. */
  const byEmployee = useMemo(() => {
    const m = new Map<string, HrPayroll>();
    for (const r of latestPayrollByKey(records).values()) m.set(r.employee, r);
    return m;
  }, [records]);

  const buildDraft = useCallback(
    (input: HrPayrollDraftInput, existing?: HrPayroll): HrDocWriteInput<"payroll"> => {
      const prevData = payrollData(existing);
      const data: HrPayrollData = { ...prevData, ...(input.data || {}) };
      const gross = round2(input.gross);
      const deductions = round2(Math.max(0, Number(input.deductions || 0)));
      const addition = round2(Math.max(0, Number(data.addition || 0)));
      data.addition = addition;
      return {
        app_id: String(input.app_id || existing?.app_id || "").trim() || hrPayrollAppId(input.employee, input.month),
        employee: input.employee,
        month: input.month,
        present_days: round2(input.present_days),
        gross,
        deductions,
        net: computeNet(gross, deductions, addition),
        status: "draft",
        voucher_app_id: existing?.voucher_app_id ?? null,
        data: data as Record<string, unknown>,
      };
    },
    []
  );

  /** Fresh local record for this employee + month (double-post check). */
  const fetchFresh = useCallback(
    async (employee: string, m: string): Promise<HrPayroll | undefined> => {
      const direct = await getHrDoc(cid, "payroll", hrPayrollAppId(employee, m));
      if (direct && direct.month === m && direct.employee === employee) return direct;
      const items = await listHrDocs(cid, "payroll");
      const map = latestPayrollByKey(items.filter((r) => r && r.month === m && r.employee === employee));
      return map.get(payrollKey(employee, m));
    },
    [cid]
  );

  /** Bulk draft upsert. Posted records are skipped (read-only). Returns the saved count. */
  const saveDrafts = useCallback(
    async (inputs: HrPayrollDraftInput[]): Promise<number> => {
      if (!cid) throw new Error("HR: company id is missing.");
      const payload: HrDocWriteInput<"payroll">[] = [];
      for (const input of inputs) {
        if (!input || !input.employee || !isIsoMonth(input.month)) continue;
        const existing = input.month === month ? byEmployee.get(input.employee) : undefined;
        if (isPayrollPosted(existing)) continue;
        payload.push(buildDraft(input, existing));
      }
      if (payload.length === 0) return 0;
      setSaving(true);
      try {
        await writeHrDocs(cid, "payroll", payload);
        await reload();
        return payload.length;
      } finally {
        setSaving(false);
      }
    },
    [cid, month, byEmployee, buildDraft, reload]
  );

  /**
   * Post one payroll: save draft → Add Salary voucher (saveVoucher) → pl_docs status "posted".
   * Returns the voucher id. Already posted → error (nothing is created).
   */
  const postOne = useCallback(
    async (input: HrPayrollPostInput): Promise<string> => {
      if (!cid || !company) throw new Error("HR: company is missing.");
      if (!user?.uid) throw new Error("Login required.");
      if (!isIsoMonth(input.month)) throw new Error("Invalid month.");
      if (!String(input.staffId || "").trim()) throw new Error("This employee has no staff ledger.");
      if (!String(input.debitAccountId || "").trim()) throw new Error("Select the salary expense (debit) account.");

      const lockKey = payrollKey(input.employee, input.month);
      if (POSTING_LOCK.has(lockKey)) throw new Error("Already posting…");
      POSTING_LOCK.add(lockKey);
      setPosting((p) => [...p, lockKey]);
      try {
        const voucherDate = monthEndDate(input.month) || new Date();
        // Same permission gates as SalaryForm create.
        assertCan(can, "create_records");
        assertCanPerformBackdated(canPerformBackdatedAction, "create", voucherDate);

        // 1) Fresh local state: stop if already posted.
        const fresh = await fetchFresh(input.employee, input.month);
        if (isPayrollPosted(fresh)) {
          throw new Error("This payroll is already posted (read-only).");
        }

        // 2) Save draft (current values).
        const draft = buildDraft(input, fresh);
        if (!(draft.net > 0)) throw new Error("Net salary is 0, so it cannot be posted.");
        await writeHrDocs(cid, "payroll", [draft]);

        const draftData = (draft.data || {}) as HrPayrollData;
        let voucherId = String(draftData.pending_voucher_app_id || "").trim();
        let voucherNumber = String(draftData.voucher_number || "").trim();

        // A previous attempt created the voucher but the post failed → reuse it (unless deleted).
        if (voucherId) {
          const v = (vouchers || []).find((x: { id?: string }) => x?.id === voucherId) as
            | { isDeleted?: boolean }
            | undefined;
          if (v && v.isDeleted === true) {
            voucherId = "";
            voucherNumber = "";
          }
        }

        if (!voucherId) {
          // 3) Add Salary voucher, same payload as SalaryForm.processAndSave.
          const toastId = await beginVoucherSaveLoadingOrBlock(cid, "Saving salary voucher...");
          if (toastId == null) throw new Error("Cannot save voucher right now.");
          try {
            const companyDoc = company as unknown as Record<string, unknown>;
            const prefixes = (company as unknown as { voucherPrefixes?: Record<string, string[] | undefined> })
              .voucherPrefixes;
            voucherNumber = await getNextVoucherNumberForCompany({
              companyId: cid,
              companyDoc,
              voucherLike: { type: "journal", subType: "add_salary" },
              selectedPrefix: prefixes?.add_salary?.[0] || ADD_SALARY_DEFAULT_PREFIX,
              voucherDate,
            });
            const net = draft.net;
            const narration =
              String(input.narration || "").trim() || `HR Payroll ${input.month} — ${input.staffName || ""}`.trim();
            const entries = [
              {
                accountId: input.staffId,
                debit: 0,
                credit: net,
                narration: `Salary for ${input.staffName || ""}`,
              },
              {
                accountId: input.debitAccountId,
                debit: net,
                credit: 0,
                narration: "Salary expense for the period",
              },
            ];
            const submissionData: Record<string, unknown> = {
              voucherNumber,
              date: voucherDate,
              narration,
              total: net,
              type: "journal",
              subType: "add_salary",
              ...voucherAttachmentFieldsForSave([]),
              unassignedFile: null,
              entries,
            };
            const savedDoc = await saveVoucher(cid, user.uid, submissionData, null);
            if (!savedDoc || !savedDoc.id) throw new Error("Failed to save voucher and get ID.");
            voucherId = savedDoc.id;
            dispatchVoucherLivePatch(cid, voucherId, {
              ...submissionData,
              id: voucherId,
              type: "journal",
              subType: "add_salary",
              entries,
            });
            sonnerToast.success("Voucher saved successfully!", { id: toastId });
          } catch (e) {
            if (e instanceof PermissionDeniedError) {
              sonnerToast.error("Permission Denied", { id: toastId, description: e.message });
            } else if (isVoucherLimitError(e)) {
              sonnerToast.error("Voucher limit reached", { id: toastId, description: e.message });
            } else {
              voucherSaveErrorToast(toastId, e, "Failed to save salary voucher.");
            }
            throw e;
          }

          // 4) Remember the voucher id on the draft (a retry will not create a second voucher).
          await writeHrDocs(cid, "payroll", [
            {
              ...draft,
              data: { ...draftData, pending_voucher_app_id: voucherId, voucher_number: voucherNumber },
            },
          ]);
        }

        // 5) Mark posted in pl_docs (status, voucher_app_id, voucher number). Cr account = staff id.
        const postedAt = Date.now();
        await writeHrDocs(cid, "payroll", [
          {
            ...draft,
            status: "posted",
            voucher_app_id: voucherId,
            voucher_number: voucherNumber || null,
            posted_at: postedAt,
            data: {
              ...draftData,
              pending_voucher_app_id: voucherId,
              voucher_number: voucherNumber,
              posted_at: postedAt,
            },
          },
        ]);
        await reload();
        return voucherId;
      } finally {
        POSTING_LOCK.delete(lockKey);
        setPosting((p) => p.filter((k) => k !== lockKey));
      }
    },
    [cid, company, user?.uid, can, canPerformBackdatedAction, vouchers, fetchFresh, buildDraft, reload]
  );

  /** Bulk post (one by one, sequential). Returns { ok, failed }. */
  const postMany = useCallback(
    async (inputs: HrPayrollPostInput[]): Promise<{ ok: number; failed: { employee: string; error: string }[] }> => {
      let ok = 0;
      const failed: { employee: string; error: string }[] = [];
      for (const input of inputs) {
        try {
          await postOne(input);
          ok += 1;
        } catch (e) {
          failed.push({ employee: input.employee, error: errMsg(e) });
        }
      }
      return { ok, failed };
    },
    [postOne]
  );

  const isPosting = useCallback(
    (employee: string) => posting.includes(payrollKey(employee, month)),
    [posting, month]
  );

  return {
    companyId: cid || null,
    records,
    byEmployee,
    loading,
    saving,
    posting,
    isPosting,
    error,
    disabled,
    reload,
    saveDrafts,
    postOne,
    postMany,
  };
}
