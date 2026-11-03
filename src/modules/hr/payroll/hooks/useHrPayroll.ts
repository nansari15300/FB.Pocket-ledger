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
import { hrApi, isHrDisabledError } from "../../services/hrApi";
import type { HrPayroll, HrUpsertInput } from "../../types";
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
  /** false → fetch nahi. Default true. */
  enabled?: boolean;
};

/** Draft save input (status hamesha "draft"; posted record kabhi overwrite nahi hota). */
export type HrPayrollDraftInput = {
  /** Existing record ka app_id (na ho to deterministic `pay_<employee>_<YYYY-MM>`). */
  app_id?: string;
  employee: string;
  month: string;
  /** Payable days (present + 0.5*half + holiday + paid leave). */
  present_days: number;
  gross: number;
  deductions: number;
  /** Extra JSON (addition / counts / notes). Existing data ke upar merge hota hai. */
  data?: HrPayrollData;
};

export type HrPayrollPostInput = HrPayrollDraftInput & {
  /** Existing staff master id (voucher credit side — same as Add Salary). */
  staffId: string;
  staffName: string;
  /** Salary expense account (voucher debit side — same as Add Salary "Debit Account"). */
  debitAccountId: string;
  narration?: string;
};

const ADD_SALARY_DEFAULT_PREFIX = "ADSAL-";

/** Module-level lock: same payroll ek saath do baar post na ho (double click / bulk + row). */
const POSTING_LOCK = new Set<string>();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Payroll list (month) + draft upsert + post.
 * Post = existing `saveVoucher` se Add Salary jaisa voucher (type "journal", subType "add_salary"),
 * phir `/api/pl/hr/payroll/post` (voucher_app_id ke saath). Posted record read-only.
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
  const [disabled, setDisabled] = useState(false);
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
      const items = await hrApi.list("payroll", cid, { month });
      if (req !== reqRef.current) return;
      setDisabled(false);
      setRecords(items.filter((r) => r && r.deleted !== true && r.month === month));
    } catch (e) {
      if (req !== reqRef.current) return;
      if (isHrDisabledError(e)) {
        setDisabled(true);
        setRecords([]);
      } else {
        setError(errMsg(e));
      }
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [cid, enabled, monthOk, month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** employee app_id → latest payroll (is month ka). */
  const byEmployee = useMemo(() => {
    const m = new Map<string, HrPayroll>();
    for (const r of latestPayrollByKey(records).values()) m.set(r.employee, r);
    return m;
  }, [records]);

  const buildDraft = useCallback(
    (input: HrPayrollDraftInput, existing?: HrPayroll): HrUpsertInput<"payroll"> => {
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

  /** Server se is employee+month ka taza record (double-post check ke liye). */
  const fetchFresh = useCallback(
    async (employee: string, m: string): Promise<HrPayroll | undefined> => {
      const items = await hrApi.list("payroll", cid, { month: m, employee });
      const map = latestPayrollByKey(items.filter((r) => r && r.month === m && r.employee === employee));
      return map.get(payrollKey(employee, m));
    },
    [cid]
  );

  /** Drafts bulk upsert. Posted records skip (read-only). Returns saved count. */
  const saveDrafts = useCallback(
    async (inputs: HrPayrollDraftInput[]): Promise<number> => {
      if (!cid) throw new Error("HR: company id missing");
      const payload: HrUpsertInput<"payroll">[] = [];
      for (const input of inputs) {
        if (!input || !input.employee || !isIsoMonth(input.month)) continue;
        const existing = input.month === month ? byEmployee.get(input.employee) : undefined;
        if (isPayrollPosted(existing)) continue;
        payload.push(buildDraft(input, existing));
      }
      if (payload.length === 0) return 0;
      setSaving(true);
      try {
        await hrApi.upsert("payroll", cid, payload);
        await reload();
        return payload.length;
      } catch (e) {
        if (isHrDisabledError(e)) setDisabled(true);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [cid, month, byEmployee, buildDraft, reload]
  );

  /**
   * Ek payroll post: draft save → Add Salary voucher (saveVoucher) → /payroll/post.
   * Returns voucher id. Already posted → error (kuch nahi banta).
   */
  const postOne = useCallback(
    async (input: HrPayrollPostInput): Promise<string> => {
      if (!cid || !company) throw new Error("HR: company missing");
      if (!user?.uid) throw new Error("Login required.");
      if (!isIsoMonth(input.month)) throw new Error("Invalid month.");
      if (!String(input.staffId || "").trim()) throw new Error("Employee ka staff ledger missing hai.");
      if (!String(input.debitAccountId || "").trim()) throw new Error("Salary expense (Debit) account चुनें।");

      const lockKey = payrollKey(input.employee, input.month);
      if (POSTING_LOCK.has(lockKey)) throw new Error("Already posting…");
      POSTING_LOCK.add(lockKey);
      setPosting((p) => [...p, lockKey]);
      try {
        const voucherDate = monthEndDate(input.month) || new Date();
        // Same permission gates as SalaryForm create.
        assertCan(can, "create_records");
        assertCanPerformBackdated(canPerformBackdatedAction, "create", voucherDate);

        // 1) Taza server state — posted ho to ruk jao.
        const fresh = await fetchFresh(input.employee, input.month);
        if (isPayrollPosted(fresh)) {
          throw new Error("Ye payroll pehle hi posted hai (read-only).");
        }

        // 2) Draft save (current values).
        const draft = buildDraft(input, fresh);
        if (!(draft.net > 0)) throw new Error("Net salary 0 hai — post nahi kar sakte.");
        await hrApi.upsert("payroll", cid, [draft]);

        const draftData = (draft.data || {}) as HrPayrollData;
        let voucherId = String(draftData.pending_voucher_app_id || "").trim();
        let voucherNumber = String(draftData.voucher_number || "").trim();

        // Pichhli koshish me voucher bana tha par post fail hua → wahi reuse (jab tak delete na hua ho).
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
          // 3) Add Salary voucher — SalaryForm.processAndSave jaisa payload.
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

          // 4) Voucher id draft me yaad rakho (post fail ho to retry bina naya voucher).
          await hrApi.upsert("payroll", cid, [
            {
              ...draft,
              data: { ...draftData, pending_voucher_app_id: voucherId, voucher_number: voucherNumber },
            },
          ]);
        }

        // 5) Server par post (status → posted, voucher_app_id set).
        await hrApi.postPayroll(cid, draft.app_id, voucherId);
        await reload();
        return voucherId;
      } catch (e) {
        if (isHrDisabledError(e)) setDisabled(true);
        throw e;
      } finally {
        POSTING_LOCK.delete(lockKey);
        setPosting((p) => p.filter((k) => k !== lockKey));
      }
    },
    [cid, company, user?.uid, can, canPerformBackdatedAction, vouchers, fetchFresh, buildDraft, reload]
  );

  /** Bulk post (ek-ek karke, sequential). Returns { ok, failed }. */
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
