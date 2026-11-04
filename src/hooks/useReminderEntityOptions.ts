"use client";

import * as React from "react";
import { useVouchers } from "@/hooks/useVouchers";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import type { LedgerReminderContext } from "@/components/vouchers/LedgerHeaderReminderButton";

/** Reminder "Link to" contexts (Messages -> Reminder tab + Details pages ka Reminder popup). */
export const REMINDER_CONTEXT_OPTIONS: { value: LedgerReminderContext; label: string }[] = [
  { value: "Party", label: "Party" },
  { value: "Staff", label: STAFF_ENTITY_LABEL },
  { value: "Bank/Cash", label: "Bank/Cash Account" },
  { value: "Tax", label: "Tax" },
  { value: "Items", label: "Items" },
  { value: "Income/Expense", label: "Income/Expense Account" },
  { value: "Party Group", label: "Party Group" },
  { value: "Staff Group", label: `${STAFF_ENTITY_LABEL} Group` },
  { value: "Bank/Cash Group", label: "Bank/Cash Group" },
  { value: "Tax Group", label: "Tax Group" },
  { value: "Item Group", label: "Item Group" },
  { value: "Income/Expense Group", label: "Income/Expense Group" },
];

export function reminderContextLabel(context?: string | null): string {
  if (!context) return "";
  return REMINDER_CONTEXT_OPTIONS.find((o) => o.value === context)?.label ?? context;
}

export type ReminderEntityOption = {
  /** Combobox value: `${context}::${entityId}` */
  value: string;
  label: string;
  searchText: string;
  context: LedgerReminderContext;
  entityId: string;
  name: string;
};

const KEY_SEP = "::";

export function reminderEntityKey(context?: string | null, entityId?: string | null): string {
  if (!context || !entityId) return "";
  return `${context}${KEY_SEP}${entityId}`;
}

export function parseReminderEntityKey(key?: string | null): { context: string; entityId: string } | null {
  const k = String(key ?? "");
  const i = k.indexOf(KEY_SEP);
  if (i <= 0) return null;
  const entityId = k.slice(i + KEY_SEP.length);
  if (!entityId) return null;
  return { context: k.slice(0, i), entityId };
}

function rowName(row: any): string {
  return String(row?.name ?? row?.accountName ?? row?.groupName ?? "").trim();
}

/** Sab accounts + entities (aur unke groups) ek searchable list me, `useVouchers()` se. */
export function useReminderEntityOptions() {
  const {
    processedPartiesForSelection,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedItems,
    expenseAccounts,
    processedGroups,
    processedStaffGroups,
    processedAccountGroups,
    processedTaxGroups,
    processedItemGroups,
    processedExpenseGroups,
  } = useVouchers();

  const options = React.useMemo<ReminderEntityOption[]>(() => {
    const out: ReminderEntityOption[] = [];
    const seen = new Set<string>();
    const push = (context: LedgerReminderContext, list: any[] | undefined) => {
      const ctxLabel = reminderContextLabel(context);
      for (const row of list || []) {
        const id = String(row?.id ?? "").trim();
        const name = rowName(row);
        if (!id || !name) continue;
        const value = reminderEntityKey(context, id);
        if (seen.has(value)) continue;
        seen.add(value);
        out.push({ value, label: `${name} (${ctxLabel})`, searchText: `${name} ${ctxLabel}`, context, entityId: id, name });
      }
    };
    push("Party", processedPartiesForSelection);
    push("Staff", processedStaff);
    push("Bank/Cash", processedAccounts);
    push("Tax", processedTaxes);
    push("Items", processedItems);
    push("Income/Expense", expenseAccounts);
    push("Party Group", processedGroups);
    push("Staff Group", processedStaffGroups);
    push("Bank/Cash Group", processedAccountGroups);
    push("Tax Group", processedTaxGroups);
    push("Item Group", processedItemGroups);
    push("Income/Expense Group", processedExpenseGroups);
    return out;
  }, [
    processedPartiesForSelection,
    processedStaff,
    processedAccounts,
    processedTaxes,
    processedItems,
    expenseAccounts,
    processedGroups,
    processedStaffGroups,
    processedAccountGroups,
    processedTaxGroups,
    processedItemGroups,
    processedExpenseGroups,
  ]);

  const byKey = React.useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);

  return { options, byKey };
}