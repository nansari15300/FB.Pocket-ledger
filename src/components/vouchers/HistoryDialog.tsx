"use client";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format as formatFns, formatDistanceToNow } from "date-fns";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { collection, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { diff } from "deep-object-diff";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { useVouchers } from "@/hooks/useVouchers";
import usePermissions from "@/hooks/usePermissions";
import { useCompany } from "@/hooks/useCompany";
import { useDate } from "@/hooks/useDate";
import { resetVoucherHistory, deleteHistoryEntries } from "@/lib/voucherActionsClient";
import { SPEND_WISE_OPENING_BALANCE_ID, SPEND_WISE_OPENING_BALANCE_HISTORY_LABEL } from "@/lib/spendWiseOpeningBalance";
import {
  IC_HISTORY_KEYS,
  isInterCompanyCreateHistoryEntry,
  isRecurringAutoUserDisplayLabel,
  resolveHumanActorDisplayLabel,
  synthesizeInterCompanyCreateHistoryChanges,
  voucherHasInterCompanyCreateHistoryFields,
} from "@/lib/interCompany/interCompanyVoucherHistory";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { openAttachmentInApp } from "@/lib/openAttachmentInApp";
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
import {
  NESTED_VOUCHER_HISTORY_ALERT_CONTENT_CN,
  NESTED_VOUCHER_HISTORY_ALERT_OVERLAY_CN,
  NESTED_VOUCHER_HISTORY_CONTENT_CN,
  NESTED_VOUCHER_HISTORY_OVERLAY_CN,
} from "@/lib/dialogShellChrome";

/** Capitalize first letter of a label for display in Field column */
function capitalizeFirst(s: string): string {
  if (!s || !s.length) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Client Timestamp, `_seconds` export, ya `{ seconds, nanoseconds, type }` — history me raw metadata nahi, sirf readable date.
 */
function firestoreTimestampLikeToDate(value: unknown): Date | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Record<string, unknown> & { toDate?: () => Date };
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  const sec =
    typeof v._seconds === "number"
      ? v._seconds
      : typeof (v as { seconds?: unknown }).seconds === "number"
        ? ((v as { seconds: number }).seconds as number)
        : null;
  if (sec == null || !Number.isFinite(sec)) return null;
  const nsRaw =
    typeof v._nanoseconds === "number"
      ? v._nanoseconds
      : typeof (v as { nanoseconds?: unknown }).nanoseconds === "number"
        ? ((v as { nanoseconds: number }).nanoseconds as number)
        : 0;
  const ms = sec * 1000 + Math.floor(nsRaw / 1e6);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

type HistoryValueFormat = { formatDateTime: (d: Date) => string };

/** History Old/New: kabhi JSON / Firestore dump nahi — timestamp → date string, object → nested readable lines. */
function renderHistoryValueNode(value: any, fmt: HistoryValueFormat, depth = 0): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">N/A</span>;
  if (depth > 8) return <span className="text-muted-foreground">…</span>;

  const ts = firestoreTimestampLikeToDate(value);
  if (ts) return <span className="break-words whitespace-normal">{fmt.formatDateTime(ts)}</span>;

  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
          value ? "bg-green-600 text-white" : "bg-pink-500 text-white",
        )}
      >
        {value ? "Yes" : "No"}
      </span>
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return <span className="break-words whitespace-normal tabular-nums">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <span className="break-words whitespace-normal">{value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <ul className="my-0 list-disc space-y-0.5 pl-4 text-sm">
        {value.map((x, i) => (
          <li key={i} className="break-words">
            {renderHistoryValueNode(x, fmt, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="space-y-0.5 break-words text-xs leading-snug">
        {keys.map((k) => (
          <div key={k}>
            <span className="text-muted-foreground">{k}:</span>{" "}
            {renderHistoryValueNode((value as Record<string, unknown>)[k], fmt, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  return <span className="break-words whitespace-normal">{String(value)}</span>;
}

const APPROVAL_FIELDS = new Set([
  'isApproved', 'IsApproved',
  'approvedAt', 'ApprovedAt',
  'approvedByUserId', 'ApprovedByUserId',
  'approvedBy', 'ApprovedBy',
  'approvedByUserName', 'ApprovedByUserName',
]);

/**
 * Display order for history fields (lower = shown first).
 * Matches the desired order: voucher no → date → accounts → entries/items →
 * amounts → narration → linked voucher → file url → approval → last edited.
 * Unknown fields get order 999.
 */
const FIELD_ORDER: Record<string, number> = {
  // Inter Company create — sabse upar (pehli history card)
  [IC_HISTORY_KEYS.addedByUser]: 0.1,
  [IC_HISTORY_KEYS.userEmail]: 0.2,
  [IC_HISTORY_KEYS.userPhone]: 0.3,
  [IC_HISTORY_KEYS.voucherDate]: 0.4,
  [IC_HISTORY_KEYS.voucherTime]: 0.5,
  [IC_HISTORY_KEYS.fromCompany]: 0.6,
  [IC_HISTORY_KEYS.toCompany]: 0.7,
  // 1. Voucher identifiers
  voucherNumber: 1,
  date: 2,
  // 2. Accounts / parties
  partyId: 3,
  accountId: 4, debitAccountId: 4, fromAccountId: 4, toAccountId: 4,
  // 3. Line items / journal entries body (excludes narration rows which go after total)
  lineItems: 5,
  entries: 5, Entries: 5,
  // Account identifier rows from entries — rendered AFTER total (synthetic slot)
  __entries_ids__: 10.2,
  // Narration rows from entries — rendered after identifiers (synthetic slot)
  __entries_narration__: 10.5,
  // 4. Amounts
  subTotal: 6,
  discount: 7,
  tax: 8, taxAmount: 9,
  total: 10,
  // 5. Narration (overall)
  narration: 11,
  // 6. Linked voucher & link/unlink (bill wise / spend wise)
  linkedVoucherNo: 12,
  allocations: 12.1,
  linkedPaymentInIds: 12.2, LinkedPaymentInIds: 12.2,
  linkedPaymentInAmounts: 12.3, LinkedPaymentInAmounts: 12.3,
  // 7. File attachments
  fileUrls: 13, fileUrl: 13, url: 13,
  // 8. Approval fields
  ApprovedByUserName: 14, approvedByUserName: 14,
  approvedAt: 15, ApprovedAt: 15,
  IsApproved: 16, isApproved: 16,
  // 9. Edit metadata
  lastEditedBy: 17,
  lastEditedAt: 18,
  // 10. User info (at end)
  UserDisplayName: 19, userDisplayName: 19,
};

/** Entity name by field + voucher type: Party, Bank/Cash, Staff, etc. (instead of generic "Account"). */
function getEntityLabelForField(field: string, voucherType: string | undefined): string | null {
  const t = (voucherType || '').toLowerCase();
  if (field === 'partyId') return 'Party';
  if (field === 'fromAccountId') return 'From Bank/Cash';
  // direct_expense / payment_out: toAccountId = expense (other) ya counterparty — bank nahi; label galat ho to user UID samajh leta hai
  if (field === 'toAccountId') {
    if (t === 'direct_expense') return 'Expense Account';
    if (t === 'payment_out') return 'To Account';
    return 'To Bank/Cash';
  }
  if (field === 'accountId') {
    if (['payment_in', 'payment_out', 'direct_income', 'direct_expense'].includes(t)) return 'Bank/Cash';
    if (t === 'add_salary') return STAFF_ENTITY_LABEL;
    if (t === 'contra') return 'Bank/Cash';
    return 'Account';
  }
  if (field === 'debitAccountId') return 'Expense Account';
  return null;
}

/** Human-readable labels for history fields. */
const FIELD_LABELS: Record<string, string> = {
  [IC_HISTORY_KEYS.addedByUser]: "Added by user",
  [IC_HISTORY_KEYS.userEmail]: "Email",
  [IC_HISTORY_KEYS.userPhone]: "Phone",
  [IC_HISTORY_KEYS.voucherDate]: "Date",
  [IC_HISTORY_KEYS.voucherTime]: "Time",
  [IC_HISTORY_KEYS.fromCompany]: "From company",
  [IC_HISTORY_KEYS.toCompany]: "To company",
  voucherNumber: 'Voucher No',
  date: 'Voucher Date',
  partyId: 'Party',
  accountId: 'Account',
  debitAccountId: 'Debit Account',
  fromAccountId: 'From Account',
  toAccountId: 'To Account',
  lineItems: 'Line Items',
  entries: 'Entries', Entries: 'Entries',
  subTotal: 'Sub Total',
  discount: 'Discount',
  tax: 'Tax',
  taxAmount: 'Tax Amount',
  total: 'Total',
  narration: 'Overall Narration',
  linkedVoucherNo: 'Linked Voucher No',
  allocations: 'Bill wise linked/unlinked',
  linkedPaymentInIds: 'Spend wise linked/unlinked', LinkedPaymentInIds: 'Spend wise linked/unlinked',
  linkedPaymentInAmounts: 'Spend wise linked/unlinked (amounts)', LinkedPaymentInAmounts: 'Spend wise linked/unlinked (amounts)',
  fileUrls: 'File URLs', fileUrl: 'File URL', url: 'URL',
  ApprovedByUserName: 'Approved By', approvedByUserName: 'Approved By',
  approvedAt: 'Approved At', ApprovedAt: 'Approved At',
  IsApproved: 'Approved', isApproved: 'Approved',
  lastEditedBy: 'Last Edited By',
  lastEditedAt: 'Last Edited Date & Time',
  UserDisplayName: 'User Name', userDisplayName: 'User Name',
};

/** Renders a URL string (or array of URLs) as clickable links. */
function renderUrlValue(value: any): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">N/A</span>;
  const urls: string[] = Array.isArray(value)
    ? value.filter((u: any) => typeof u === 'string' && u)
    : typeof value === 'string' && value ? [value] : [];
  if (urls.length === 0) return <span className="text-muted-foreground">N/A</span>;
  return (
    <div className="flex flex-col gap-1">
      {urls.map((u, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => void openAttachmentInApp(u, { title: urls.length > 1 ? `File ${idx + 1}` : "Attachment" })}
          className="text-blue-600 underline hover:text-blue-800 break-all text-xs text-left"
        >
          {urls.length > 1 ? `View File ${idx + 1}` : "View File"}
        </button>
      ))}
    </div>
  );
}

const URL_FIELDS = new Set(['fileUrls', 'fileUrl', 'url', 'imageUrl', 'logoUrl']);

/** Bill wise / Spend wise: field keys for voucher-no row (From V. No. ... to V. No. ...). */
const LINK_UNLINK_VOUCHER_FIELDS = new Set([
  'allocations', 'Allocations',
  'linkedPaymentInIds', 'LinkedPaymentInIds',
]);
/** Amount-only row: show only linked amounts (e.g. 50 when only 50 of 100 was linked). */
const LINK_UNLINK_AMOUNT_FIELDS = new Set([
  'linkedPaymentInAmounts', 'LinkedPaymentInAmounts',
]);
const LINK_UNLINK_FIELDS = new Set([
  ...LINK_UNLINK_VOUCHER_FIELDS,
  ...LINK_UNLINK_AMOUNT_FIELDS,
]);

function isEmptyLinkValue(val: any): boolean {
  if (val == null) return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === 'object') return Object.keys(val).length === 0;
  return false;
}

/** Label: "Bill wise linked" / "unlinked" / "linked/unlinked" based on old→new. Same for Spend wise. */
function getLinkUnlinkFieldLabel(field: string, from: any, to: any): string {
  const isAmounts = LINK_UNLINK_AMOUNT_FIELDS.has(field);
  const base = field === 'allocations' || field === 'Allocations' ? 'Bill wise' : 'Spend wise';
  const suffix = isAmounts ? ' (amounts)' : '';
  const oldEmpty = isEmptyLinkValue(from);
  const newEmpty = isEmptyLinkValue(to);
  if (oldEmpty && !newEmpty) return `${base} linked${suffix}`;
  if (!oldEmpty && newEmpty) return `${base} unlinked${suffix}`;
  return `${base} linked/unlinked${suffix}`;
}

/**
 * Format link/unlink history value for Old/New: "From V. No. X to V. No. Y" (voucher numbers only).
 * val: [] | [id, ...] | [{ voucherId, amount }, ...]
 */
function formatLinkUnlinkDisplay(val: any, idToVoucherNo: Map<string, string>): string {
  if (val == null) return '—';
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    const ids = val.map((x: any) => (typeof x === 'object' && x?.voucherId) ? x.voucherId : x).filter(Boolean);
    const vNos = ids.map((id: string) =>
      id === SPEND_WISE_OPENING_BALANCE_ID
        ? SPEND_WISE_OPENING_BALANCE_HISTORY_LABEL
        : idToVoucherNo.get(id) || `#${id.slice(0, 8)}`
    );
    return vNos.length === 0 ? '—' : `From V. No. ${vNos.join(' to V. No. ')}`;
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    const ids = Object.keys(val).filter((k) => val[k] != null && val[k] !== 0);
    if (ids.length === 0) return '—';
    const vNos = ids.map((id: string) =>
      id === SPEND_WISE_OPENING_BALANCE_ID
        ? SPEND_WISE_OPENING_BALANCE_HISTORY_LABEL
        : idToVoucherNo.get(id) || `#${id.slice(0, 8)}`
    );
    return vNos.length === 0 ? '—' : `From V. No. ${vNos.join(' to V. No. ')}`;
  }
  return '—';
}

/**
 * Format link/unlink amounts only: show only the amount that was linked (e.g. 50 when 50 of 100 linked).
 * val: { voucherId: amount } | [{ voucherId, amount }, ...] → "Rs 50" or "V. No. X: Rs 50, V. No. Y: Rs 100"
 */
function formatLinkUnlinkAmountsDisplay(val: any, idToVoucherNo: Map<string, string>): string {
  if (val == null) return '—';
  const pairs: { vNo: string; amount: number }[] = [];
  if (Array.isArray(val)) {
    val.forEach((x: any) => {
      const id = typeof x === 'object' && x?.voucherId ? x.voucherId : null;
      const amt = typeof x === 'object' && x?.amount != null ? Number(x.amount) : 0;
      if (id != null && amt !== 0) {
        const vNo =
          id === SPEND_WISE_OPENING_BALANCE_ID
            ? SPEND_WISE_OPENING_BALANCE_HISTORY_LABEL
            : idToVoucherNo.get(id) || `#${id.slice(0, 8)}`;
        pairs.push({ vNo, amount: amt });
      }
    });
  } else if (typeof val === 'object') {
    Object.entries(val).forEach(([id, amt]) => {
      const n = Number(amt);
      if (n !== 0 && !Number.isNaN(n)) {
        const vNo =
          id === SPEND_WISE_OPENING_BALANCE_ID
            ? SPEND_WISE_OPENING_BALANCE_HISTORY_LABEL
            : idToVoucherNo.get(id) || `#${id.slice(0, 8)}`;
        pairs.push({ vNo, amount: n });
      }
    });
  }
  if (pairs.length === 0) return '—';
  if (pairs.length === 1) return `Rs ${pairs[0].amount}`;
  return pairs.map((p) => `V. No. ${p.vNo}: Rs ${p.amount}`).join(', ');
}

/**
 * Merges multiple history entries (from the same user, same timeframe) into one.
 * For each field: keep the earliest `from` and the latest `to`.
 */
function mergeEntryGroup(entries: any[]): any {
  // entries are sorted descending; reverse to process oldest→newest
  const sorted = [...entries].reverse();
  const mergedChanges: Record<string, { from: any; to: any }> = {};
  for (const entry of sorted) {
    for (const [field, values] of Object.entries(entry.changes || {}) as [string, any][]) {
      if (!(field in mergedChanges)) {
        mergedChanges[field] = { from: values.from, to: values.to };
      } else {
        // keep original `from`, update to the latest `to`
        mergedChanges[field] = { from: mergedChanges[field].from, to: values.to };
      }
    }
  }
  return {
    changes: mergedChanges,
    changedBy: entries[0].changedBy,
    changedAt: entries[0].changedAt, // most-recent timestamp
    _originalEntries: entries,       // keep originals for per-entry deletion
  };
}

function getMergedEntryBadge(changes: any): { label: string; className: string } {
  const allKeys = Object.keys(changes || {}).filter(
    k => k !== 'approvedByUserId' && k !== 'approvedBy' && k !== 'lastEditedByUserName'
  );
  const approvalKeys = allKeys.filter(k => APPROVAL_FIELDS.has(k));
  const editKeys = allKeys.filter(k => !APPROVAL_FIELDS.has(k));
  const hasApproval = approvalKeys.length > 0;
  const hasEdit = editKeys.length > 0;
  const isApprovedChange = changes['IsApproved'] ?? changes['isApproved'];
  const approvedTo = isApprovedChange?.to;

  if (hasEdit && hasApproval) {
    return approvedTo === true
      ? { label: 'Edited & Approved', className: 'bg-blue-600 text-white' }
      : { label: 'Edited & Unapproved', className: 'bg-blue-600 text-white' };
  }
  if (hasApproval) {
    return approvedTo === true
      ? { label: 'Approved', className: 'bg-green-600 text-white' }
      : { label: 'Unapproved', className: 'bg-rose-600 text-white' };
  }
  return { label: 'Edited', className: 'bg-blue-600 text-white' };
}

function LineItemChangesRows({ from, to, renderValue }: { from: any[]; to: any[]; renderValue: (v: any) => React.ReactNode }) {
    const { processedItems, processedTaxes } = useVouchers();

    const allItemIds = [...new Set([...(from || []).map((i: any) => i.itemId), ...(to || []).map((i: any) => i.itemId)])];

    const changedItems = allItemIds.map((id: string) => {
        const oldItem = (from || []).find((i: any) => i.itemId === id);
        const newItem = (to || []).find((i: any) => i.itemId === id);

        const oldItemName = processedItems.find((pi: any) => pi.id === oldItem?.itemId)?.name || oldItem?.itemId;
        const newItemName = processedItems.find((pi: any) => pi.id === newItem?.itemId)?.name || newItem?.itemId;

        const oldTaxName = processedTaxes.find((pt: any) => pt.id === oldItem?.taxAccountId)?.name || oldItem?.taxAccountId;
        const newTaxName = processedTaxes.find((pt: any) => pt.id === newItem?.taxAccountId)?.name || newItem?.taxAccountId;

        const displayOld = { ...oldItem, itemId: oldItemName, taxAccountId: oldTaxName };
        const displayNew = { ...newItem, itemId: newItemName, taxAccountId: newTaxName };

        if (JSON.stringify(oldItem) === JSON.stringify(newItem)) return null;

        return { id, oldItem: displayOld, newItem: displayNew };
    }).filter(Boolean);

    if (changedItems.length === 0) return null;

    return (
        <>
            {changedItems.map(({ id, oldItem, newItem }: any) => {
                const itemChanges = diff(oldItem || {}, newItem || {});
                const changedKeys = Object.keys(itemChanges);
                const itemName = processedItems.find((i: any) => i.id === id)?.name || `ID: ${id}`;

                if (changedKeys.length === 0) return null;

                return (
                    <React.Fragment key={id}>
                        {changedKeys.map((key) => (
                            <TableRow key={key} className="even:bg-muted/30">
                                <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">
                                    <span className="font-semibold text-amber-700">Item: {itemName}</span>
                                    <span className="mx-1 text-muted-foreground">—</span>
                                    <span>{capitalizeFirst(key)}</span>
                                </TableCell>
                                <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{renderValue(oldItem?.[key])}</TableCell>
                                <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{renderValue(newItem?.[key])}</TableCell>
                            </TableRow>
                        ))}
                    </React.Fragment>
                );
            })}
        </>
    );
}

/** Strip auto-appended "(Staff ID: ...)" from narration strings */
function cleanNarration(value: any): any {
  if (typeof value !== 'string') return value;
  return value.replace(/\s*\(Staff ID:[^)]*\)/gi, '').trim();
}

/** Semantic field labels per entry type */
const ENTRY_FIELD_LABELS: Record<string, Record<string, string>> = {
  staff:   { accountId: 'Staff Member',   credit: 'Salary Amount', debit: 'Debit',          narration: 'Narration' },
  tax:     { accountId: 'Tax Account',    credit: 'Tax Amount',    debit: 'Debit',          narration: 'Narration' },
  expense: { accountId: 'Debit Account',  credit: 'Credit',        debit: 'Total Salary',   narration: 'Narration' },
  other:   { accountId: 'Account',        credit: 'Credit',        debit: 'Debit',          narration: 'Narration' },
};

/** Field order inside an entry */
const ENTRY_FIELD_ORDER = ['accountId', 'credit', 'debit', 'narration'];

type EntriesMode = 'amounts' | 'ids' | 'narration';

function EntriesChangesRows({ from, to, renderValue, mode = 'amounts' }: { from: any[]; to: any[]; renderValue: (v: any) => React.ReactNode; mode?: EntriesMode }) {
  const { processedAccounts, processedStaff, processedParties, expenseAccounts, processedTaxes } = useVouchers();

  const resolveEntryInfo = (id: string): { type: 'staff' | 'tax' | 'expense' | 'other'; name: string } => {
    if (!id) return { type: 'other', name: id };
    const staff = processedStaff?.find((s: any) => s.id === id);
    if (staff) return { type: 'staff', name: staff.name };
    const tax = processedTaxes?.find((t: any) => t.id === id);
    if (tax) return { type: 'tax', name: tax.name ?? (tax as { accountName?: string }).accountName ?? '' };
    const expense = expenseAccounts?.find((e: any) => e.id === id);
    if (expense) return { type: 'expense', name: expense.name ?? (expense as { accountName?: string }).accountName ?? '' };
    const account = processedAccounts?.find((a: any) => a.id === id);
    if (account) return { type: 'other', name: account.accountName };
    const party = processedParties?.find((p: any) => p.id === id);
    if (party) return { type: 'other', name: party.name };
    return { type: 'other', name: id };
  };

  const fromArr = from || [];
  const toArr   = to   || [];

  // Split into: entries in both, only-removed, only-added
  const bothIds    = fromArr.filter((e: any) => toArr.some((n: any)  => n.accountId === e.accountId)).map((e: any) => e.accountId);
  const removedArr = fromArr.filter((e: any) => !toArr.some((n: any) => n.accountId === e.accountId));
  const addedArr   = toArr.filter((e: any)   => !fromArr.some((o: any) => o.accountId === e.accountId));

  // Pair removed ↔ added of the SAME type so the "Staff Member" row shows old→new in one row.
  // Sub-field rows (Salary Amount, Debit, Narration) remain SEPARATE per entry.
  const pairedNewForRemoved = new Map<string, any>(); // removedId → paired added entry
  const pairedAddedIds = new Set<string>();
  for (const removed of removedArr) {
    const { type: rType } = resolveEntryInfo(removed.accountId);
    const match = addedArr.find((a: any) =>
      !pairedAddedIds.has(a.accountId) && resolveEntryInfo(a.accountId).type === rType
    );
    if (match) {
      pairedNewForRemoved.set(removed.accountId, match);
      pairedAddedIds.add(match.accountId);
    }
  }

  // Build flat rows with sort priority
  // Priority: expense accountId (0) → staff accountId (1) → tax accountId (2) →
  //           amounts/credit (4) → other (5) → narration (10, always last)
  const rows: { key: string; label: string; oldVal: any; newVal: any; sort: number }[] = [];

  // Sort order within entries:
  // identifiers first (Debit Account → Staff Member → Tax Account)
  // then amounts (Salary Amount → Tax Amount) — so they sit right before Total
  // narration goes to __entries_narration__ slot (after Total)
  const entryTypeSortBase = (type: string, key: string): number => {
    if (key === 'accountId') {
      if (type === 'expense') return 1;   // Debit Account
      if (type === 'staff')   return 2;   // Staff Member
      if (type === 'tax')     return 3;   // Tax Account
      return 4;
    }
    if (key === 'narration') return 10;
    if (key === 'credit') {
      if (type === 'staff') return 5;     // Salary Amount
      if (type === 'tax')   return 6;     // Tax Amount
      return 7;
    }
    if (key === 'debit')  return 8;
    return 9;
  };

  /** Push sub-field rows (credit, debit, narration — NOT accountId) for one entry direction.
   *  Narration is only shown for staff entries (salary narration). Tax/expense narrations are skipped. */
  const pushSubFields = (rawOld: any, rawNew: any, prefix: string) => {
    const id = rawOld?.accountId ?? rawNew?.accountId;
    const { type } = resolveEntryInfo(id);
    const labels = ENTRY_FIELD_LABELS[type] ?? ENTRY_FIELD_LABELS.other;
    const keys = [
      ...ENTRY_FIELD_ORDER.filter(k => k !== 'accountId'),
      ...[...new Set([
        ...(rawOld ? Object.keys(rawOld) : []),
        ...(rawNew ? Object.keys(rawNew) : []),
      ])].filter(k => !ENTRY_FIELD_ORDER.includes(k) && k !== 'accountId'),
    ];
    for (const key of keys) {
      // Only show narration for staff entries; skip for tax/expense/other
      if (key === 'narration' && type !== 'staff') continue;
      // amounts mode: only credit/debit — skip narration (goes in narration slot)
      if (mode === 'amounts' && key === 'narration') continue;
      // ids mode: nothing here — accountId rows are pushed separately
      if (mode === 'ids') continue;
      // narration mode: only narration
      if (mode === 'narration' && key !== 'narration') continue;
      // Skip debit amount for expense/account entries (not meaningful to show)
      if (key === 'debit' && (type === 'expense' || type === 'other')) continue;
      let oldVal = rawOld ? (rawOld[key] ?? null) : null;
      let newVal = rawNew ? (rawNew[key] ?? null) : null;
      if (key === 'narration') {
        if (typeof oldVal === 'string') oldVal = cleanNarration(oldVal);
        if (typeof newVal === 'string') newVal = cleanNarration(newVal);
      }
      if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
      rows.push({ key: `${prefix}-${key}`, label: labels[key] ?? capitalizeFirst(key), oldVal, newVal, sort: entryTypeSortBase(type, key) });
    }
  };

  // 1. Modified entries (same accountId in both) — sub-fields only, no Staff Member row
  for (const id of bothIds) {
    const rawOld = fromArr.find((e: any) => e.accountId === id);
    const rawNew = toArr.find((e: any) => e.accountId === id);
    if (JSON.stringify(rawOld) === JSON.stringify(rawNew)) continue;
    pushSubFields(rawOld, rawNew, id);
  }

  // 2. Removed entries
  for (const rawOld of removedArr) {
    const id = rawOld.accountId;
    const { type } = resolveEntryInfo(id);
    const labels = ENTRY_FIELD_LABELS[type] ?? ENTRY_FIELD_LABELS.other;
    const pairedNew = pairedNewForRemoved.get(id) ?? null;
    // Debit Account (expense) → amounts slot (before Salary Amount)
    // Staff Member / Tax Account → ids slot (after Total)
    const accountIdSlot = type === 'expense' ? 'amounts' : 'ids';
    if (mode === accountIdSlot) {
      rows.push({
        key: `${id}-accountId`,
        label: labels.accountId ?? 'Account',
        oldVal: resolveEntryInfo(id).name,
        newVal: pairedNew ? resolveEntryInfo(pairedNew.accountId).name : null,
        sort: entryTypeSortBase(type, 'accountId'),
      });
    }
    // Sub-fields: amounts or narration slot
    pushSubFields(rawOld, pairedNew, `${id}-pair`);
  }

  // 3. Added entries — if paired, amounts/narration already shown above; only show ids row here if unpaired
  for (const rawNew of addedArr) {
    const id = rawNew.accountId;
    const isPaired = pairedAddedIds.has(id);
    if (mode === 'ids' && !isPaired) {
      const { type } = resolveEntryInfo(id);
      const labels = ENTRY_FIELD_LABELS[type] ?? ENTRY_FIELD_LABELS.other;
      rows.push({
        key: `${id}-accountId`,
        label: labels.accountId ?? 'Account',
        oldVal: null,
        newVal: resolveEntryInfo(id).name,
        sort: entryTypeSortBase(type, 'accountId'),
      });
    }
    if (!isPaired) {
      pushSubFields(null, rawNew, `${id}-add`);
    }
  }

  rows.sort((a, b) => a.sort - b.sort);
  if (rows.length === 0) return null;

  return (
    <>
      {rows.map(({ key, label, oldVal, newVal }) => (
        <TableRow key={key} className="even:bg-muted/30">
          <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{label}</TableCell>
          <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{renderValue(oldVal)}</TableCell>
          <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{renderValue(newVal)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function HistoryDialog({
  voucher,
  isOpen,
  onOpenChange,
  onHistoryReset,
  highlightTimestamp,
  highlightUid,
  onMarkAsReadFromAlert,
  nestedInVoucherEdit = false,
}: {
  voucher: any;
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  onHistoryReset?: () => void;
  highlightTimestamp?: any;
  highlightUid?: string;
  /** Alerts "View changes" flow: history ke niche mark-as-read action. */
  onMarkAsReadFromAlert?: () => Promise<void> | void;
  /** Edit Trxn dialog ke andar — stack above voucher shell z-[81]. */
  nestedInVoucherEdit?: boolean;
}) {
  const [historyUserNames, setHistoryUserNames] = useState<Record<string, string>>({});
  /** Inter Company create rows: creator email / phone (users collection). */
  const [historyUserMeta, setHistoryUserMeta] = useState<Record<string, { email?: string; phone?: string }>>({});
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isMarkingAlertRead, setIsMarkingAlertRead] = useState(false);
  const [deletingEntryIdx, setDeletingEntryIdx] = useState<number | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  // ms timestamps of entries that were deleted locally — excluded from display immediately
  const [deletedMs, setDeletedMs] = useState<Set<number>>(new Set());
  const { processedParties, processedAccounts, processedStaff, processedTaxes, processedItems, expenseAccounts, userNames: vouchersUserNames, vouchers } = useVouchers();
  const { can } = usePermissions();
  const { companyId, company } = useCompany();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Reset deleted-entry set when voucher or dialog changes
  useEffect(() => { setDeletedMs(new Set()); }, [voucher?.id, isOpen]);

  /** Convert any changedAt representation to a ms number (or null). */
  const changedAtToMs = (changedAt: any): number | null => {
    if (!changedAt) return null;
    if (changedAt?.toDate instanceof Function) return changedAt.toDate().getTime();
    if (changedAt?._seconds != null) return changedAt._seconds * 1000;
    if (changedAt?.seconds  != null) return changedAt.seconds  * 1000;
    if (typeof changedAt === 'number') return changedAt;
    const p = new Date(changedAt);
    return isNaN(p.getTime()) ? null : p.getTime();
  };

  const history = (voucher?.history || [])
    .filter((h: any) => h.changedAt)
    .filter((h: any) => {
      if (deletedMs.size === 0) return true;
      const ms = changedAtToMs(h.changedAt);
      return ms === null || !deletedMs.has(ms);
    })
    .sort((a: any, b: any) => {
        const dateA = a.changedAt?.toDate ? a.changedAt.toDate() : ( a.changedAt ? new Date(a.changedAt) : 0);
        const dateB = b.changedAt?.toDate ? b.changedAt.toDate() : ( b.changedAt ? new Date(b.changedAt) : 0);
        if (dateA instanceof Date && dateB instanceof Date) {
            return dateB.getTime() - dateA.getTime();
        }
        return 0;
    });

  const fetchUserProfile = useCallback(
    async (userId: string): Promise<{ name: string; email?: string; phone?: string }> => {
      const cachedName = historyUserNames[userId] || vouchersUserNames?.[userId];
      const cachedMeta = historyUserMeta[userId];
      const cachedEmail =
        cachedMeta?.email ||
        (typeof voucher?.userEmail === "string" ? voucher.userEmail : undefined);
      // "Auto" cache se mat ruko — Firestore se asli naam lao (recurring ke alawa)
      if (cachedName && cachedMeta && !isRecurringAutoUserDisplayLabel(cachedName)) {
        return {
          name: resolveHumanActorDisplayLabel({ candidate: cachedName, email: cachedEmail, userId }),
          email: cachedMeta.email,
          phone: cachedMeta.phone,
        };
      }
      try {
        const q = query(collection(firestore, "users"), where("uid", "==", userId));
        const snap = await getDocs(q);
        const byUid = snap.docs[0]?.data() as { displayName?: string; name?: string; email?: string; phone?: string; mobile?: string } | undefined;
        if (byUid) {
          const email = String(byUid.email || cachedEmail || "").trim() || undefined;
          const name = resolveHumanActorDisplayLabel({
            candidate: byUid.displayName || byUid.name,
            email,
            userId,
          });
          const phone = String(byUid.phone || byUid.mobile || "").trim() || undefined;
          return { name, email, phone };
        }
        const userDoc = await getDoc(doc(firestore, "users", userId));
        if (userDoc.exists()) {
          const data = userDoc.data() as { displayName?: string; name?: string; email?: string; phone?: string; mobile?: string };
          const email = String(data.email || cachedEmail || "").trim() || undefined;
          const name = resolveHumanActorDisplayLabel({
            candidate: data.displayName || data.name,
            email,
            userId,
          });
          const phone = String(data.phone || data.mobile || "").trim() || undefined;
          return { name, email, phone };
        }
      } catch {
        /* offline */
      }
      return {
        name: resolveHumanActorDisplayLabel({ candidate: cachedName, email: cachedEmail, userId }),
        email: cachedEmail,
        phone: cachedMeta?.phone,
      };
    },
    [historyUserNames, historyUserMeta, vouchersUserNames],
  );

  const fetchUserName = useCallback(
    async (userId: string): Promise<string> => {
      const p = await fetchUserProfile(userId);
      return p.name;
    },
    [fetchUserProfile],
  );

  useEffect(() => {
    if (!isOpen) return;
    const uids = new Set<string>();
    history.forEach((h: any) => {
      if (h?.changedBy) uids.add(String(h.changedBy));
      Object.entries(h?.changes || {}).forEach(([field, values]: [string, any]) => {
        if (field === "approvedByUserId" || field === "lastEditedBy" || field === "changedBy" || field === "lastEditedByUserName") {
          if (values?.from && values.from !== "N/A") uids.add(String(values.from));
          if (values?.to && values.to !== "N/A") uids.add(String(values.to));
        }
      });
    });

    const missing = Array.from(uids).filter((uid) => {
      const cached = historyUserNames[uid] || vouchersUserNames?.[uid];
      if (!cached) return true;
      if (isRecurringAutoUserDisplayLabel(cached)) return true;
      return !historyUserNames[uid];
    });
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(missing.map(async (uid) => ({ uid, ...(await fetchUserProfile(uid)) }))).then((results) => {
      if (cancelled) return;
      setHistoryUserNames((prev) => {
        let changed = false;
        const next = { ...prev };
        results.forEach(({ uid, name, email }) => {
          const resolved = resolveHumanActorDisplayLabel({ candidate: name, email, userId: uid });
          if (!next[uid] || isRecurringAutoUserDisplayLabel(next[uid])) {
            next[uid] = resolved;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setHistoryUserMeta((prev) => {
        let changed = false;
        const next = { ...prev };
        results.forEach(({ uid, email, phone }) => {
          if (!next[uid] && (email || phone)) {
            next[uid] = { email, phone };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [history, isOpen, historyUserNames, vouchersUserNames, fetchUserProfile]);

  const isInterCompanyVoucher = String(voucher?.type || "").toLowerCase() === "inter_company";

  const getNameById = (id: string, type: string) => {
    if (!id) return id;
    let found;
    switch(type) {
        case 'partyId': found = processedParties.find(p => p.id === id); break;
        case 'accountId':
        case 'fromAccountId':
        case 'toAccountId': {
            // Bank/cash pehle; direct_expense / payment_out ka toAccountId expense id ho sakta hai — processedAccounts mein nahi milta
            const bank = processedAccounts.find((a) => a.id === id);
            if (bank) return bank.accountName;
            const exp = expenseAccounts.find((e) => e.id === id);
            return exp?.name || id;
        }
        case 'staffId': found = processedStaff.find(s => s.id === id); break;
        case 'taxAccountId': found = processedTaxes.find(t => t.id === id); break;
        case 'expenseAccountId':
        case 'incomeAccountId':
            found = expenseAccounts.find(e => e.id === id); break;
        case 'lastEditedBy':
        case 'approvedByUserId':
        case 'changedBy':
        case 'lastEditedByUserName':
            return historyUserNames[id] || vouchersUserNames?.[id] || id;
        default: return id;
    }
    return found?.name || id;
  }

  const handleResetHistory = async () => {
    if (!companyId || !voucher?.id) return;
    setIsResetting(true);
    try {
      await resetVoucherHistory(companyId, voucher.id);
      toast.success("Voucher history has been reset.");
      onHistoryReset?.();
      setShowResetConfirm(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to reset history.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleDeleteEntry = async (entry: any, idx: number) => {
    if (!companyId || !voucher?.id) return;
    setDeletingEntryIdx(idx);
    try {
      const originals: any[] = entry._originalEntries ?? [entry];
      const msValues = originals.map((e: any) => {
        const c = e.changedAt;
        if (c?.toDate instanceof Function) return c.toDate().getTime();
        if (c?._seconds != null) return c._seconds * 1000;
        return typeof c === 'number' ? c : null;
      }).filter((ms: any) => ms !== null) as number[];
      await deleteHistoryEntries(companyId, voucher.id, msValues);
      // Immediately hide only the deleted entry — keep all others visible
      setDeletedMs(prev => new Set([...prev, ...msValues]));
      toast.success("History entry deleted.");
      setConfirmDeleteIdx(null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete history entry.");
    } finally {
      setDeletingEntryIdx(null);
    }
  };

  const canReset = can("reset_voucher_history") && (voucher?.history?.length ?? 0) > 0;

  /** Map voucher id → voucher number for link/unlink history display (From V. No. X to V. No. Y). */
  const idToVoucherNo = useMemo(() => {
    const m = new Map<string, string>();
    (vouchers || []).forEach((v: any) => {
      if (v?.id && v?.voucherNumber != null) m.set(v.id, String(v.voucherNumber));
    });
    return m;
  }, [vouchers]);

  const getHistoryChangedAt = useCallback((changedAt: any): Date | null => {
    if (!changedAt) return null;
    const fromFs = firestoreTimestampLikeToDate(changedAt);
    if (fromFs) return fromFs;
    const parsed = new Date(changedAt);
    return isNaN(parsed.getTime()) ? null : parsed;
  }, []);

  /** IC create card: legacy `created` ko alag rows me badal do; generic lastEdited rows hatao. */
  const resolveDisplayHistoryChanges = useCallback(
    (entry: { changedBy?: string; changedAt?: unknown; changes?: Record<string, { from: unknown; to: unknown }> }) => {
      const raw = { ...(entry.changes || {}) } as Record<string, { from: unknown; to: unknown }>;
      if (!isInterCompanyVoucher || !isInterCompanyCreateHistoryEntry(raw)) return raw;

      let changes = raw;
      if (!voucherHasInterCompanyCreateHistoryFields(raw)) {
        const at = getHistoryChangedAt(entry.changedAt) || new Date();
        const uid = String(entry.changedBy || "");
        const meta = historyUserMeta[uid];
        const email = meta?.email ?? (typeof voucher?.userEmail === "string" ? voucher.userEmail : null);
        const name = resolveHumanActorDisplayLabel({
          candidate: historyUserNames[uid] || vouchersUserNames?.[uid],
          email,
          userId: uid,
        });
        const synth = synthesizeInterCompanyCreateHistoryChanges({
          voucher: (voucher || {}) as Record<string, unknown>,
          changedByName: name,
          userEmail: email,
          userPhone: meta?.phone ?? null,
          changedAt: at,
        });
        if (!synth[IC_HISTORY_KEYS.fromCompany]?.to && company?.name) {
          synth[IC_HISTORY_KEYS.fromCompany] = { from: "N/A", to: company.name };
        }
        changes = { ...synth, ...raw };
      }

      const cleaned = { ...changes };
      delete cleaned.created;
      delete cleaned.lastEditedByUserName;
      delete cleaned.lastEditedAt;
      return cleaned;
    },
    [isInterCompanyVoucher, voucher, historyUserMeta, historyUserNames, vouchersUserNames, company?.name, getHistoryChangedAt],
  );

  /**
   * Group consecutive history entries by same user + timestamps within 15 seconds,
   * then merge each group into a single display entry.
   */
  const groupedHistory = useMemo(() => {
    const groups: any[][] = [];
    for (const entry of history) {
      const entryTime = getHistoryChangedAt(entry.changedAt)?.getTime() ?? 0;
      if (groups.length > 0) {
        const lastGroup = groups[groups.length - 1];
        const lastEntry = lastGroup[0];
        const lastTime = getHistoryChangedAt(lastEntry.changedAt)?.getTime() ?? 0;
        if (lastEntry.changedBy === entry.changedBy && Math.abs(entryTime - lastTime) <= 15000) {
          lastGroup.push(entry);
          continue;
        }
      }
      groups.push([entry]);
    }
    return groups.map((group) => mergeEntryGroup(group));
  }, [history, getHistoryChangedAt]);

  /**
   * Find the grouped entry index that best matches the notification timestamp + uid.
   * Tries: time+uid match (5min window) → time-only match → most-recent by same uid → index 0.
   */
  const highlightIndex = useMemo(() => {
    if (highlightTimestamp == null || groupedHistory.length === 0) return -1;
    // highlightTimestamp is already in ms (converted in messages/page.tsx)
    const hlTime = typeof highlightTimestamp === 'number' ? highlightTimestamp : null;
    if (!hlTime) return -1;

    let bestIdx = -1;
    let bestDiff = Infinity;

    // Pass 1: time within 5 min + uid match
    groupedHistory.forEach((entry: any, idx: number) => {
      const entryTime = getHistoryChangedAt(entry.changedAt)?.getTime() ?? 0;
      const diff = Math.abs(entryTime - hlTime);
      const uidMatch = !highlightUid || entry.changedBy === highlightUid;
      if (diff <= 300000 && uidMatch && diff < bestDiff) {
        bestDiff = diff;
        bestIdx = idx;
      }
    });

    // Pass 2: time-only match within 5 min
    if (bestIdx === -1) {
      bestDiff = Infinity;
      groupedHistory.forEach((entry: any, idx: number) => {
        const entryTime = getHistoryChangedAt(entry.changedAt)?.getTime() ?? 0;
        const diff = Math.abs(entryTime - hlTime);
        if (diff <= 300000 && diff < bestDiff) {
          bestDiff = diff;
          bestIdx = idx;
        }
      });
    }

    // Pass 3: most-recent entry by same uid
    if (bestIdx === -1 && highlightUid) {
      bestIdx = groupedHistory.findIndex((e: any) => e.changedBy === highlightUid);
    }

    // Pass 4: always highlight the most-recent entry when called from an alert
    if (bestIdx === -1) bestIdx = 0;

    return bestIdx;
  }, [highlightTimestamp, highlightUid, groupedHistory, getHistoryChangedAt]);

  // Scroll highlighted entry into center view — retry at 200ms, 500ms, 1000ms
  useEffect(() => {
    if (!isOpen || highlightIndex === -1) return;
    const scroll = () => highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t1 = setTimeout(scroll, 200);
    const t2 = setTimeout(scroll, 500);
    const t3 = setTimeout(scroll, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isOpen, highlightIndex]);

  const formatModifiedDate = useCallback((changedAt: any) => {
    const changedDate = getHistoryChangedAt(changedAt);
    if (!changedDate) return "N/A";
    const dateStr = dateSystem === "BS" || dateSystem === "Both" ? formatDateBS(changedDate) : formatDate(changedDate);
    const timeStr = formatFns(changedDate, "h:mm a");
    return `${dateStr}, ${timeStr}`;
  }, [dateSystem, formatDate, formatDateBS, getHistoryChangedAt]);

  /** Table Old/New: timestamps (sab Firestore shapes) + nested objects — kabhi raw JSON/metadata nahi. */
  const formatHistoryDateTime = useCallback(
    (d: Date) => {
      const dateStr = dateSystem === "BS" || dateSystem === "Both" ? formatDateBS(d) : formatDate(d);
      return `${dateStr}, ${formatFns(d, "h:mm a")}`;
    },
    [dateSystem, formatDate, formatDateBS],
  );

  const renderCellValue = useCallback(
    (value: any): React.ReactNode => renderHistoryValueNode(value, { formatDateTime: formatHistoryDateTime }),
    [formatHistoryDateTime],
  );

  /** IC history: Date row — sirf calendar date (time alag row). */
  const renderIcDateOnly = useCallback(
    (value: unknown): React.ReactNode => {
      const d =
        firestoreTimestampLikeToDate(value) ||
        (value instanceof Date && !Number.isNaN(value.getTime()) ? value : null) ||
        (typeof value === "string" && value.trim() ? new Date(value) : null);
      if (!d || Number.isNaN(d.getTime())) return <span className="text-muted-foreground">N/A</span>;
      const dateStr = dateSystem === "BS" || dateSystem === "Both" ? formatDateBS(d) : formatDate(d);
      return <span className="break-words whitespace-normal">{dateStr}</span>;
    },
    [dateSystem, formatDate, formatDateBS],
  );

  /** IC history: Time row — sirf clock time. */
  const renderIcTimeOnly = useCallback((value: unknown): React.ReactNode => {
    const d =
      firestoreTimestampLikeToDate(value) ||
      (value instanceof Date && !Number.isNaN(value.getTime()) ? value : null);
    if (!d || Number.isNaN(d.getTime())) return <span className="text-muted-foreground">N/A</span>;
    return <span className="break-words whitespace-normal">{formatFns(d, "h:mm a")}</span>;
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={nestedInVoucherEdit ? NESTED_VOUCHER_HISTORY_OVERLAY_CN : undefined}
        className={cn(
          "rounded-lg sm:rounded-xl left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-4px)] sm:w-[calc(100vw-30px)] max-w-[calc(100vw-4px)] sm:max-w-[12in] py-6 pl-[2px] pr-[2px] sm:pl-[15px] sm:pr-[15px] h-[90vh] flex flex-col min-w-0",
          nestedInVoucherEdit && NESTED_VOUCHER_HISTORY_CONTENT_CN
        )}
      >
        <DialogHeader>
          <DialogTitle>Voucher History #{voucher?.voucherNumber || ""}</DialogTitle>
          <DialogDescription>
            {groupedHistory.length > 0
              ? `${groupedHistory.length} modification${groupedHistory.length === 1 ? '' : 's'} recorded`
              : 'No modifications recorded.'}
          </DialogDescription>
        </DialogHeader>

        {/* Single scroll container: horizontal + vertical so small screens get scrollbar and no overlap */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="space-y-6 p-1 min-w-[480px]">
            {groupedHistory.length > 0 ? (
              groupedHistory.map((entry: any, i: number) => {
                const { label: badgeLabel, className: badgeClass } = getMergedEntryBadge(entry.changes);
                const isHighlighted = highlightIndex !== -1 && i === highlightIndex;
                const isDimmed = highlightIndex !== -1 && i !== highlightIndex;
                return (
                <div
                  key={i}
                  ref={isHighlighted ? highlightRef : undefined}
                  className={cn(
                    // History card frame — pehle 3px tha; ab ~50% patla (1.5px).
                    "overflow-hidden rounded-lg border-[1.5px] border-foreground/80 transition-opacity duration-300",
                    isHighlighted && "ring-2 ring-offset-2 ring-blue-500 shadow-xl shadow-blue-200/60",
                    isDimmed && "opacity-30 pointer-events-none"
                  )}
                >
                  {/* Header ↔ table divider — 3px se ~50% patla. */}
                  <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b-[1.5px] border-foreground/80 bg-muted p-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0", badgeClass)}>
                        {badgeLabel}
                      </span>
                      <p className="min-w-0 break-words">
                        <b>User:</b>{" "}
                        {resolveHumanActorDisplayLabel({
                          candidate: historyUserNames[entry.changedBy] || vouchersUserNames?.[entry.changedBy],
                          email:
                            historyUserMeta[entry.changedBy]?.email ??
                            (typeof voucher?.userEmail === "string" ? voucher.userEmail : null),
                          userId: entry.changedBy,
                        })}
                      </p>
                    </div>
                    <div className="flex items-start gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-muted-foreground">Modified: {formatModifiedDate(entry.changedAt)}</p>
                        <p className="text-muted-foreground">
                          {formatDistanceToNow(getHistoryChangedAt(entry.changedAt) || new Date(), { addSuffix: true })}
                        </p>
                      </div>
                      {canReset && (
                        confirmDeleteIdx === i ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs text-muted-foreground">Delete?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 px-2 text-xs"
                              disabled={deletingEntryIdx === i}
                              onClick={() => handleDeleteEntry(entry, i)}
                            >
                              {deletingEntryIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={deletingEntryIdx === i}
                              onClick={() => setConfirmDeleteIdx(null)}
                            >
                              No
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => setConfirmDeleteIdx(i)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Table row lines — 3px se adha (1.5px) taaki zyada mota na lage. */}
                  <Table
                    className="w-full min-w-[480px] [&_tr]:!border-b-[1.5px] [&_tr]:!border-foreground/90 [&_tbody>tr:last-child]:!border-b-0"
                    scrollContainer={false}
                  >
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left font-semibold min-w-[160px] w-1/3 pr-2.5">Field</TableHead>
                        <TableHead className="text-left font-semibold min-w-[140px] w-1/3 px-2.5">Old</TableHead>
                        <TableHead className="text-left font-semibold min-w-[140px] w-1/3 pl-2.5">New</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const displayChanges = resolveDisplayHistoryChanges(entry);
                        const baseEntries = Object.entries(displayChanges) as [string, any][];
                        // Inject __entries_ids__ and __entries_narration__ slots so they render after Total
                        const entriesField = baseEntries.find(([f]) => f === 'entries' || f === 'Entries');
                        const withSlot: [string, any][] = entriesField
                          ? [...baseEntries, ['__entries_ids__', entriesField[1]], ['__entries_narration__', entriesField[1]]]
                          : baseEntries;
                        return withSlot
                          .sort(([a], [b]) => (FIELD_ORDER[a] ?? 999) - (FIELD_ORDER[b] ?? 999))
                          .map(([field, values]) => {
                        // --- complex sub-renderers ---
                        if (field === 'lineItems') {
                          return (
                            <LineItemChangesRows
                              key={field}
                              from={values.from}
                              to={values.to}
                              renderValue={renderCellValue}
                            />
                          );
                        }
                        // entries amounts (credit/debit only — no accountId, no narration)
                        if (field === 'entries' || field === 'Entries') {
                          return (
                            <EntriesChangesRows
                              key={field}
                              from={values.from}
                              to={values.to}
                              renderValue={renderCellValue}
                              mode="amounts"
                            />
                          );
                        }
                        // entries account identifiers (Staff Member, Tax Account, Debit Account) — after Total
                        if (field === '__entries_ids__') {
                          return (
                            <EntriesChangesRows
                              key={field}
                              from={values.from}
                              to={values.to}
                              renderValue={renderCellValue}
                              mode="ids"
                            />
                          );
                        }
                        // entries narration only — after identifiers
                        if (field === '__entries_narration__') {
                          return (
                            <EntriesChangesRows
                              key={field}
                              from={values.from}
                              to={values.to}
                              renderValue={renderCellValue}
                              mode="narration"
                            />
                          );
                        }

                        // --- hidden / internal fields ---
                        // Skip 'files' (form state with long preview URLs); we show only fileUrls (clickable links)
                        // `__…` = client/SQLite mirror flags — user-facing history me nahi (purane entries bhi).
                        if (
                          field.startsWith("__") ||
                          field === 'files' ||
                          field === 'approvedByUserId' || field === 'approvedBy' ||
                          field === 'lastEditedByUserName' ||
                          field === 'userId' || field === 'UserId' ||
                          field === 'companyId' || field === 'CompanyId' ||
                          field === 'UserEmail' || field === 'userEmail'
                        ) return null;
                        // Inter Company create: generic Created / lastEdited rows duplicate — mat dikhao
                        if (
                          isInterCompanyVoucher &&
                          isInterCompanyCreateHistoryEntry(displayChanges) &&
                          (field === "created" || field === "lastEditedBy" || field === "lastEditedAt")
                        ) {
                          return null;
                        }
                        // Direct expense etc.: when both accountId and fromAccountId exist, show only From Account to avoid duplicate row
                        if (field === 'accountId' && entry.changes && 'fromAccountId' in entry.changes) return null;

                        // --- resolve display values ---
                        const isIdField = field.toLowerCase().endsWith('id');
                        const isUserRefField = field === 'lastEditedBy' || field === 'changedBy';
                        const resolveVal = (val: any) => (isIdField || isUserRefField) ? getNameById(val, field) : val;

                        let displayTo = values.to;
                        const isNullish = (v: any) => v == null || v === '' || String(v) === 'N/A';
                        if ((field === 'lastEditedBy' || field === 'UserDisplayName' || field === 'userDisplayName') && isNullish(values.to)) {
                          // Fall back to the user who made this change
                          displayTo = historyUserNames[entry.changedBy] || vouchersUserNames?.[entry.changedBy] || entry.changedBy;
                        } else if (field === 'approvedAt' && isNullish(values.to)) {
                          displayTo = entry.changedAt;
                        }

                        // --- skip rows with no real change (always keep IsApproved) ---
                        const isApprovedField = field === 'IsApproved' || field === 'isApproved';
                        const isTimestampLike = (v: any) => firestoreTimestampLikeToDate(v) != null;
                        if (!isApprovedField && !isTimestampLike(values.from) && !isTimestampLike(displayTo) && JSON.stringify(values.from) === JSON.stringify(displayTo)) return null;

                        // --- label: entity name (Party, Bank/Cash, Staff) for account/party fields ---
                        const entityLabel = getEntityLabelForField(field, voucher?.type);
                        const fieldLabel = (entityLabel != null ? entityLabel : FIELD_LABELS[field]) ?? capitalizeFirst(field);

                        // --- URL fields: render as clickable links ---
                        if (URL_FIELDS.has(field) || field.toLowerCase().includes('url')) {
                          return (
                            <TableRow key={field} className="even:bg-muted/30">
                              <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{fieldLabel}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{renderUrlValue(values.from)}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{renderUrlValue(displayTo)}</TableCell>
                            </TableRow>
                          );
                        }

                        // --- Bill wise / Spend wise: dynamic label (linked / unlinked / linked-unlinked) + Old/New ---
                        if (LINK_UNLINK_FIELDS.has(field)) {
                          const linkLabel = getLinkUnlinkFieldLabel(field, values.from, values.to);
                          const isAmountRow = LINK_UNLINK_AMOUNT_FIELDS.has(field);
                          const oldText = isAmountRow
                            ? formatLinkUnlinkAmountsDisplay(values.from, idToVoucherNo)
                            : formatLinkUnlinkDisplay(values.from, idToVoucherNo);
                          const newText = isAmountRow
                            ? formatLinkUnlinkAmountsDisplay(values.to, idToVoucherNo)
                            : formatLinkUnlinkDisplay(values.to, idToVoucherNo);
                          if (oldText === '—' && newText === '—') return null;
                          return (
                            <TableRow key={field} className="even:bg-muted/30">
                              <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{linkLabel}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{oldText}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{newText}</TableCell>
                            </TableRow>
                          );
                        }

                        // --- Inter Company: Date / Time alag format ---
                        if (field === IC_HISTORY_KEYS.voucherDate) {
                          return (
                            <TableRow key={field} className="even:bg-muted/30">
                              <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{fieldLabel}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{renderIcDateOnly(values.from)}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{renderIcDateOnly(displayTo)}</TableCell>
                            </TableRow>
                          );
                        }
                        if (field === IC_HISTORY_KEYS.voucherTime) {
                          return (
                            <TableRow key={field} className="even:bg-muted/30">
                              <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{fieldLabel}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{renderIcTimeOnly(values.from)}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{renderIcTimeOnly(displayTo)}</TableCell>
                            </TableRow>
                          );
                        }
                        // IC create: purani history me "Auto" save ho to email / Firestore se asli naam dikhao
                        if (field === IC_HISTORY_KEYS.addedByUser) {
                          const icEmail =
                            displayChanges[IC_HISTORY_KEYS.userEmail]?.to ??
                            historyUserMeta[entry.changedBy]?.email ??
                            (typeof voucher?.userEmail === "string" ? voucher.userEmail : null);
                          const fmtActor = (v: unknown) =>
                            resolveHumanActorDisplayLabel({
                              candidate: typeof v === "string" ? v : String(v ?? ""),
                              email: icEmail,
                              userId: entry.changedBy,
                            });
                          return (
                            <TableRow key={field} className="even:bg-muted/30">
                              <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{fieldLabel}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{fmtActor(values.from)}</TableCell>
                              <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{fmtActor(displayTo)}</TableCell>
                            </TableRow>
                          );
                        }

                        // --- standard row ---
                        return (
                          <TableRow key={field} className="even:bg-muted/30">
                            <TableCell className="font-medium min-w-[160px] w-1/3 align-top text-left pr-2.5 whitespace-normal break-words">{fieldLabel}</TableCell>
                            <TableCell className="min-w-[140px] w-1/3 align-top text-left px-2.5 whitespace-normal break-words">{renderCellValue(resolveVal(values.from))}</TableCell>
                            <TableCell className="min-w-[140px] w-1/3 align-top text-left pl-2.5 whitespace-normal break-words">{renderCellValue(resolveVal(displayTo))}</TableCell>
                          </TableRow>
                        );
                      });
                      })()}
                    </TableBody>
                  </Table>
                </div>
                );
              })
            ) : (
              <p className="text-center text-muted-foreground py-10">No history found for this voucher.</p>
            )}

          </div>
        </div>

        {(canReset || onMarkAsReadFromAlert) && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t-[1.5px] border-foreground/80 pt-3">
            <div className="flex items-center gap-2">
              {canReset && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowResetConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete All History
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onMarkAsReadFromAlert && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMarkingAlertRead}
                  onClick={async () => {
                    try {
                      setIsMarkingAlertRead(true);
                      await onMarkAsReadFromAlert();
                    } finally {
                      setIsMarkingAlertRead(false);
                    }
                  }}
                >
                  {isMarkingAlertRead && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Mark as Read
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}

        <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
          <AlertDialogContent
            overlayClassName={
              nestedInVoucherEdit ? NESTED_VOUCHER_HISTORY_ALERT_OVERLAY_CN : undefined
            }
            className={nestedInVoucherEdit ? NESTED_VOUCHER_HISTORY_ALERT_CONTENT_CN : undefined}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete voucher history?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all history for this voucher from the server. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleResetHistory(); }}
                disabled={isResetting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isResetting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete All History
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
