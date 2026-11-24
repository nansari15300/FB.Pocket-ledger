"use client";

import React, { useMemo } from "react";
import { PendingApprovalListFilterBadge } from "@/components/layout/PendingApprovalListFilterBadge";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import { useVouchers } from "@/hooks/useVouchers";
import { collectPartyIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesPartyLedger";
import { collectBankAccountIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesBankLedger";
import { collectStaffIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesStaffLedger";
import { collectItemIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesItemLedger";
import { collectInterCompanyIdsForPendingApproval } from "@/lib/interCompany/interCompanyVoucherHydrate";

function collectContraAccountIdsTouchedByUnapprovedVoucher(voucher: any, accountIds: Set<string>): Set<string> {
  const touched = new Set<string>();
  if (voucher?.type !== "contra" || voucher?.isApproved === true) return touched;
  for (const value of [
    voucher.fromAccountId,
    voucher.toAccountId,
    voucher.otherChargeAccountId,
    voucher.accountId,
    voucher.bankAccountId,
  ]) {
    const id = value && typeof value === "object" && "id" in value
      ? String(value.id ?? "").trim()
      : String(value ?? "").trim();
    if (id && accountIds.has(id)) touched.add(id);
  }
  return touched;
}

function collectJournalAccountIdsTouchedByUnapprovedVoucher(voucher: any, accountIds: Set<string>): Set<string> {
  const touched = new Set<string>();
  if (voucher?.type !== "journal" || voucher?.subType === "add_salary" || voucher?.isApproved === true) return touched;
  for (const entry of [...(voucher.entries || []), ...(voucher.lines || [])]) {
    const value = entry?.accountId;
    const id = value && typeof value === "object" && "id" in value
      ? String(value.id ?? "").trim()
      : String(value ?? "").trim();
    if (id && accountIds.has(id)) touched.add(id);
  }
  return touched;
}

function collectAddSalaryStaffIdsTouchedByUnapprovedVoucher(voucher: any, staffIds: Set<string>): Set<string> {
  const touched = new Set<string>();
  const isAddSalary =
    (voucher?.type === "journal" && voucher?.subType === "add_salary") || voucher?.type === "add_salary";
  if (!isAddSalary || voucher?.isApproved === true) return touched;
  for (const entry of [...(voucher.entries || []), ...(voucher.lines || [])]) {
    const value = entry?.accountId;
    const id = value && typeof value === "object" && "id" in value
      ? String(value.id ?? "").trim()
      : String(value ?? "").trim();
    if (id && staffIds.has(id) && Number(entry?.credit || 0) > 0) touched.add(id);
  }
  const staffId = voucher?.staffId != null && voucher?.staffId !== "" ? String(voucher.staffId).trim() : "";
  if (staffId && staffIds.has(staffId)) touched.add(staffId);
  return touched;
}

function collectNoteEntityKeysTouchedByUnapprovedVoucher(voucher: any, entityKeys: Set<string>): Set<string> {
  const touched = new Set<string>();
  if (voucher?.type !== "note" || voucher?.isApproved === true) return touched;
  const entityId = String(voucher?.entityId ?? "").trim();
  const context = String(voucher?.context ?? "").trim();
  const key = `${context}:${entityId}`;
  if (entityId && context && entityKeys.has(key)) touched.add(key);
  return touched;
}

/** Main master list page jaisa: approve-on-list setting + permission. */
export function useReportShowApproveOnList(): boolean {
  const { effectiveNotificationSettings } = useCompany();
  const { can } = usePermissions();
  return (
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onList !== false
  );
}

/**
 * Pending-approval counts for report entity lists (same shape as main master pages):
 * per entity id, per list-group bucket id, and total vouchers touching any entity (pink badge).
 */
export function useReportListPendingApproval<T extends { id: string }>(opts: {
  enabled: boolean;
  vouchers: readonly any[] | null | undefined;
  entities: readonly T[] | null | undefined;
  collect: (voucher: any, idSet: Set<string>) => Iterable<string>;
  bucket: (entity: T) => string;
}) {
  const { enabled, vouchers, entities, collect, bucket } = opts;
  return useMemo(() => {
    const byId: Record<string, number> = {};
    const byGroupId: Record<string, number> = {};
    let total = 0;
    if (!enabled || !vouchers?.length || !entities?.length) return { byId, byGroupId, total };
    const idSet = new Set(entities.map((e) => e.id));
    for (const v of vouchers) {
      if (v?.isApproved === true) continue;
      let hit = false;
      for (const id of collect(v, idSet)) {
        byId[id] = (byId[id] || 0) + 1;
        hit = true;
      }
      if (hit) total += 1;
    }
    for (const e of entities) {
      const n = byId[e.id] || 0;
      if (!n) continue;
      const gid = bucket(e);
      byGroupId[gid] = (byGroupId[gid] || 0) + n;
    }
    return { byId, byGroupId, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, vouchers, entities]);
}

/** Search row ke baad pink badge (entity / group tab) + "+ Add" button slot. */
export function ReportListSearchExtras({
  show,
  count,
  isGroupsTab,
  entityPressed,
  onEntityToggle,
  groupPressed,
  onGroupToggle,
  entityNoun,
  addButton,
}: {
  show: boolean;
  count: number;
  isGroupsTab: boolean;
  entityPressed: boolean;
  onEntityToggle: () => void;
  groupPressed: boolean;
  onGroupToggle: () => void;
  /** e.g. "accounts", "staff", "taxes", "items" */
  entityNoun: string;
  addButton?: React.ReactNode;
}) {
  const noun = isGroupsTab ? "groups" : entityNoun;
  return (
    <>
      {show && count > 0 ? (
        <PendingApprovalListFilterBadge
          compact
          count={count}
          pressed={isGroupsTab ? groupPressed : entityPressed}
          onToggle={isGroupsTab ? onGroupToggle : onEntityToggle}
          tooltipFilterHint={`Only ${noun} with pending approval - ${count} voucher(s) (click)`}
          tooltipShowAllHint={`Show all ${noun} (click)`}
          ariaLabelFilter={`Filter ${count} pending approval vouchers`}
          ariaLabelShowAll={`Show all ${noun}`}
        />
      ) : null}
      {addButton}
    </>
  );
}

/** Header total balance span (main pages jaisa green >= 0 / red < 0, Dr/Cr). */
export function ReportListTotalBalance({
  value,
  format,
}: {
  value: number;
  format: (n: number, o?: any) => React.ReactNode;
}) {
  return (
    <span className={value >= 0 ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
      {format(value, { showDrCr: true })}
    </span>
  );
}

/** Tax page jaisa pending-approval touch (header / line items / entries + inter-company). */
export function collectTaxIdsTouchedByUnapprovedVoucherForReport(v: any, ids: Set<string>): Set<string> {
  const out = new Set<string>();
  if (v?.isApproved === true) return out;
  if (String(v?.type || "") === "inter_company") {
    collectInterCompanyIdsForPendingApproval(v, ids, "tax").forEach((id: string) => out.add(id));
    return out;
  }
  if (v?.taxAccountId && ids.has(v.taxAccountId)) out.add(v.taxAccountId);
  (v?.lineItems || []).forEach((l: any) => { if (l?.taxAccountId && ids.has(l.taxAccountId)) out.add(l.taxAccountId); });
  (v?.entries || []).forEach((e: any) => { if (e?.accountId && ids.has(e.accountId)) out.add(e.accountId); });
  return out;
}

/** Incomes/Expenses page jaisa pending-approval touch. */
export function collectExpenseIdsTouchedByUnapprovedVoucherForReport(v: any, ids: Set<string>): Set<string> {
  const out = new Set<string>();
  if (v?.isApproved === true) return out;
  if (String(v?.type || "") === "inter_company") {
    collectInterCompanyIdsForPendingApproval(v, ids, "expense").forEach((id: string) => out.add(id));
    return out;
  }
  for (const k of ["incomeAccountId", "expenseAccountId", "accountId"]) {
    if (v?.[k] && ids.has(v[k])) out.add(v[k]);
  }
  (v?.entries || []).forEach((e: any) => { if (e?.accountId && ids.has(e.accountId)) out.add(e.accountId); });
  return out;
}

/**
 * Left "Reports" menu: per statement report (party/bank/staff/tax/expense/item) kitne unapproved vouchers
 * us entity type ko touch karte hain + total (kisi bhi statement ko touch karne wale vouchers).
 */
export function useReportsMenuPendingApproval() {
  const enabled = useReportShowApproveOnList();
  const v = useVouchers() as any;
  const { vouchers, processedParties, processedAccounts, processedStaff, processedTaxes, processedExpenseAccounts, processedItems } = v;
  return useMemo(() => {
    const byReportId: Record<string, number> = {};
    let total = 0;
    if (!enabled || !vouchers?.length) return { byReportId, total };
    const sets: Array<[string, Set<string>, (vv: any, s: Set<string>) => Set<string>]> = [
      ["party-statement", new Set((processedParties || []).map((e: any) => e.id)), collectPartyIdsTouchedByUnapprovedVoucher],
      ["bank-statement", new Set((processedAccounts || []).map((e: any) => e.id)), collectBankAccountIdsTouchedByUnapprovedVoucher],
      ["contra", new Set((processedAccounts || []).map((e: any) => e.id)), collectContraAccountIdsTouchedByUnapprovedVoucher],
      ["journal", new Set([
        ...(processedAccounts || []).map((e: any) => e.id),
        ...(processedParties || []).map((e: any) => e.id),
        ...(processedStaff || []).map((e: any) => e.id),
        ...(processedTaxes || []).map((e: any) => e.id),
        ...(processedExpenseAccounts || []).map((e: any) => e.id),
      ]), collectJournalAccountIdsTouchedByUnapprovedVoucher],
      ["notes", new Set([
        ...(processedParties || []).map((e: any) => `Party:${e.id}`),
        ...(processedAccounts || []).map((e: any) => `Bank/Cash:${e.id}`),
        ...(processedStaff || []).map((e: any) => `Staff:${e.id}`),
        ...(processedTaxes || []).map((e: any) => `Tax:${e.id}`),
        ...(processedItems || []).map((e: any) => `Items:${e.id}`),
      ]), collectNoteEntityKeysTouchedByUnapprovedVoucher],
      ["staff-statement", new Set((processedStaff || []).map((e: any) => e.id)), collectStaffIdsTouchedByUnapprovedVoucher],
      ["add-salary", new Set((processedStaff || []).map((e: any) => e.id)), collectAddSalaryStaffIdsTouchedByUnapprovedVoucher],
      ["tax-statement", new Set((processedTaxes || []).map((e: any) => e.id)), collectTaxIdsTouchedByUnapprovedVoucherForReport],
      ["expense-statement", new Set((processedExpenseAccounts || []).map((e: any) => e.id)), collectExpenseIdsTouchedByUnapprovedVoucherForReport],
      ["item-statement", new Set((processedItems || []).map((e: any) => e.id)), collectItemIdsTouchedByUnapprovedVoucher],
    ];
    for (const voucher of vouchers as any[]) {
      if (voucher?.isApproved === true) continue;
      let hit = false;
      for (const [rid, ids, collect] of sets) {
        if (!ids.size) continue;
        if (collect(voucher, ids).size > 0) {
          byReportId[rid] = (byReportId[rid] || 0) + 1;
          hit = true;
        }
      }
      if (hit) total += 1;
    }
    return { byReportId, total };
  }, [enabled, vouchers, processedParties, processedAccounts, processedStaff, processedTaxes, processedExpenseAccounts, processedItems]);
}
