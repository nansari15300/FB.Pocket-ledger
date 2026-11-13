/** Pure reactive OCR-bubble rules: drop or update bubbles from current form values. */
import type { OcrFormAdapter } from "./adapters";

const MONEY_EPS = 0.05;

export type OcrFormLineSnapshot = {
  itemId?: unknown;
  quantity?: unknown;
  rate?: unknown;
  amount?: unknown;
  taxAccountId?: unknown;
};

export type OcrFormSnapshot = {
  partyId?: unknown;
  staffId?: unknown;
  taxAccountId?: unknown;
  date?: unknown;
  dueDate?: unknown;
  amount?: unknown;
  payeeAmount?: unknown;
  accountId?: unknown;
  fromAccountId?: unknown;
  toAccountId?: unknown;
  otherChargeAccountId?: unknown;
  narration?: unknown;
  discount?: unknown;
  subTotal?: unknown;
  tax?: unknown;
  total?: unknown;
  ledgerAccountId?: unknown;
  billNo?: unknown;
  voucherNumber?: unknown;
  lineItems?: readonly OcrFormLineSnapshot[];
};

export type OcrBillSnapshot = {
  total?: number | null;
  subTotal?: number | null;
  vat?: number | null;
  discount?: number | null;
  date?: Date | string | number | null;
  amount?: number | null;
  billNo?: string | null;
};

export type OcrReactiveSuggestion = {
  id: string;
  value?: string;
  reason?: string;
};

export type OcrReactiveInput = {
  missing: readonly string[];
  suggestions: readonly OcrReactiveSuggestion[];
  /** Missing-field keys (ocrFieldForMissing) the user dismissed. Never re-show. */
  dismissedMissingKeys?: ReadonlySet<string> | readonly string[];
  /** Suggestion ids the user dismissed. Never re-show. */
  dismissedSuggestionIds?: ReadonlySet<string> | readonly string[];
  /** Suggestion ids already applied. Never re-show. */
  doneIds?: ReadonlySet<string> | readonly string[];
  form: OcrFormSnapshot;
  bill?: OcrBillSnapshot | null;
  vatTaxId?: string | null;
};

export type OcrReactiveResult = {
  missing: string[];
  suggestions: OcrReactiveSuggestion[];
};

function asSet(v?: ReadonlySet<string> | readonly string[]): Set<string> {
  if (!v) return new Set();
  return v instanceof Set ? new Set(v) : new Set(v);
}

export function asMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function moneyClose(a: number, b: number, eps = MONEY_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function hasId(v: unknown): boolean {
  return String(v ?? "").trim().length > 0;
}

export function hasDate(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return !Number.isNaN(d.getTime());
  }
  if (typeof v === "object" && typeof (v as { getTime?: unknown }).getTime === "function") {
    return !Number.isNaN((v as Date).getTime());
  }
  return false;
}

/** A money field is filled when it is a non-zero finite number, or it matches the bill value (including 0). */
export function hasMoney(v: unknown, billValue?: number | null): boolean {
  const n = asMoney(v);
  if (n == null) return false;
  if (billValue != null && Number.isFinite(billValue) && moneyClose(n, billValue)) return true;
  return Math.abs(n) > MONEY_EPS;
}

export function hasLineItems(form: OcrFormSnapshot): boolean {
  const rows = form.lineItems;
  if (!rows || !rows.length) return false;
  return rows.some((r) => hasId(r.itemId) || ((asMoney(r.quantity) ?? 0) > 0 && ((asMoney(r.rate) ?? 0) > 0 || (asMoney(r.amount) ?? 0) > 0)));
}

function textOf(v: unknown): string {
  return String(v ?? "").trim();
}

export function hasBillNo(form: OcrFormSnapshot, bill?: OcrBillSnapshot | null, suggestionValue?: string): boolean {
  const needle = String(suggestionValue || bill?.billNo || "").trim();
  const hay = [form.narration, form.billNo, form.voucherNumber].map(textOf).filter(Boolean).join(" ");
  if (needle) return hay.includes(needle);
  return textOf(form.billNo).length > 0 || textOf(form.voucherNumber).length > 0;
}

/** Keep in sync with ocrFieldForMissing in OcrFieldBubbles.tsx. */
export function ocrMissingFieldKey(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith("party")) return "party";
  if (l.startsWith("to account")) return "account";
  if (l.startsWith("bank") || l.startsWith("account")) return "account";
  if (l.startsWith("other charge")) return "other-charge";
  if (l.startsWith("date")) return "date";
  if (l.includes("vat") || l.includes("tax")) return "tax";
  if (l.startsWith("line")) return "lines";
  if (l.startsWith("total")) return "total";
  if (l.startsWith("amount")) return "amount";
  if (l.startsWith("bill")) return "bill-no";
  return "lines";
}

export function isMissingFieldResolved(label: string, form: OcrFormSnapshot, bill?: OcrBillSnapshot | null, vatTaxId?: string | null): boolean {
  const l = label.toLowerCase();
  if (l.startsWith("party")) return hasId(form.partyId) || hasId(form.staffId) || hasId(form.taxAccountId);
  if (l.startsWith("to account")) return hasId(form.toAccountId);
  if (l.startsWith("bank") || l.startsWith("account")) return hasId(form.accountId) || hasId(form.fromAccountId);
  if (l.startsWith("other charge")) return hasId(form.otherChargeAccountId);
  if (l.startsWith("date")) return hasDate(form.date);
  if (l.includes("vat") && l.includes("tax account")) {
    return hasId(vatTaxId) || !!(form.lineItems && form.lineItems.some((r) => hasId(r.taxAccountId)));
  }
  if (l.startsWith("line")) return hasLineItems(form);
  if (l.startsWith("total")) return hasMoney(form.total, bill?.total);
  if (l.startsWith("amount")) return hasMoney(form.amount, bill?.amount) || hasMoney(form.payeeAmount, bill?.amount);
  if (l.startsWith("bill")) return hasBillNo(form, bill);
  return false;
}

export function formTotalsReconcile(form: OcrFormSnapshot, bill?: OcrBillSnapshot | null): boolean | null {
  const ft = asMoney(form.total);
  const bt = bill?.total ?? null;
  if (ft != null && bt != null && Number.isFinite(bt)) return moneyClose(ft, bt);
  const fs = asMoney(form.subTotal);
  const ftax = asMoney(form.tax) ?? 0;
  const fd = asMoney(form.discount) ?? 0;
  if (ft != null && fs != null) {
    return moneyClose(fs + ftax - Math.abs(fd), ft) || moneyClose(fs + ftax + fd, ft);
  }
  if (fs != null && bill?.subTotal != null && Number.isFinite(bill.subTotal)) return moneyClose(fs, bill.subTotal);
  return null;
}

const KEEP_SUGGESTION_IDS = new Set(["switch", "cannot-detect", "status-failed", "duplicate-ref", "tds", "drcr"]);

export function isSuggestionResolved(s: OcrReactiveSuggestion, form: OcrFormSnapshot, bill?: OcrBillSnapshot | null, vatTaxId?: string | null): boolean {
  const id = s.id;
  if (KEEP_SUGGESTION_IDS.has(id)) return false;
  if (id === "create-party" || id === "find-party" || id === "use-party" || id.startsWith("account-payee-")) {
    return hasId(form.partyId) || hasId(form.staffId) || hasId(form.taxAccountId);
  }
  if (id === "date") return hasDate(form.date);
  if (id === "due") return hasDate(form.dueDate);
  if (id === "amount" || id === "amount-total") return hasMoney(form.amount, bill?.amount) || hasMoney(form.payeeAmount, bill?.amount);
  if (id === "disc") {
    const n = asMoney(form.discount);
    if (n == null) return false;
    if (bill?.discount != null && Number.isFinite(bill.discount) && moneyClose(n, bill.discount)) return true;
    return Math.abs(n) > MONEY_EPS;
  }
  if (id === "billno") return hasBillNo(form, bill, s.value);
  if (id === "account-to" || (id.startsWith("account-") && /\(to\)\s*$/i.test(s.value ?? ""))) return hasId(form.toAccountId);
  if (id === "account" || id.startsWith("account-")) return hasId(form.accountId) || hasId(form.fromAccountId);
  const itemM = /^create-item-(\d+)$/.exec(id);
  if (itemM) return hasId(form.lineItems?.[Number(itemM[1])]?.itemId);
  if (id === "lines") return hasLineItems(form);
  if (id === "vat") {
    if (!vatTaxId || !form.lineItems || !form.lineItems.length) return false;
    const rows = form.lineItems.filter((r) => hasId(r.itemId) || (asMoney(r.amount) ?? 0) > 0);
    return rows.length > 0 && rows.every((r) => String(r.taxAccountId ?? "") === vatTaxId);
  }
  if (id === "create-vat") return hasId(vatTaxId);
  if (id === "create-ledger" || id === "ledger") return hasId(form.ledgerAccountId);
  return false;
}

export function snapshotFromForm(values: Record<string, unknown> | undefined, adapter?: Partial<OcrFormAdapter> | null): OcrFormSnapshot {
  const v = values ?? {};
  const A = adapter ?? {};
  const linePath = A.lineItems?.path ?? "lineItems";
  const rawLines = v[linePath];
  return {
    partyId: A.party?.path ? v[A.party.path] : v.partyId,
    staffId: v.staffId,
    taxAccountId: v.taxAccountId,
    date: A.date ? v[A.date] : v.date,
    dueDate: A.dueDate ? v[A.dueDate] : v.dueDate,
    amount: A.amount ? v[A.amount] : v.amount,
    payeeAmount: A.payeeAmount ? v[A.payeeAmount] : v.payeeAmount,
    accountId: A.accountPath ? v[A.accountPath] : v.accountId,
    fromAccountId: A.fromAccountPath ? v[A.fromAccountPath] : v.fromAccountId,
    toAccountId: A.toAccountPath ? v[A.toAccountPath] : v.toAccountId,
    otherChargeAccountId: v.otherChargeAccountId,
    narration: A.narration ? v[A.narration] : v.narration,
    discount: A.lineItems?.discountPath ? v[A.lineItems.discountPath] : v.discount,
    subTotal: v.subTotal,
    tax: v.tax,
    total: v.total,
    ledgerAccountId: A.ledgerAccount?.path ? v[A.ledgerAccount.path] : (v.purchaseAccountId ?? v.salesAccountId),
    billNo: v.billNo,
    voucherNumber: v.voucherNumber,
    lineItems: Array.isArray(rawLines) ? rawLines as OcrFormLineSnapshot[] : undefined,
  };
}

export function resolveOcrBubbles(input: OcrReactiveInput): OcrReactiveResult {
  const dismissedMissing = asSet(input.dismissedMissingKeys);
  const dismissedSug = asSet(input.dismissedSuggestionIds);
  const done = asSet(input.doneIds);
  const form = input.form;
  const bill = input.bill ?? null;
  const vatTaxId = input.vatTaxId ?? null;

  const missing = input.missing.filter((label) => {
    if (dismissedMissing.has(ocrMissingFieldKey(label))) return false;
    return !isMissingFieldResolved(label, form, bill, vatTaxId);
  });

  const totalsOk = formTotalsReconcile(form, bill);
  const suggestions: OcrReactiveSuggestion[] = [];
  for (const s of input.suggestions) {
    if (dismissedSug.has(s.id) || done.has(s.id)) continue;
    if (isSuggestionResolved(s, form, bill, vatTaxId)) continue;
    let reason = s.reason;
    if ((s.reason === "Totals not reconciled" || s.reason === "Reconciled with totals") && totalsOk != null) {
      reason = totalsOk ? "Reconciled with totals" : "Totals not reconciled";
    }
    suggestions.push(reason === s.reason ? s : { ...s, reason });
  }
  return { missing, suggestions };
}
