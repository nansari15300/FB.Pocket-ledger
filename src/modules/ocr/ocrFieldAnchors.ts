/**
 * Suggestion id -> `data-ocr-field` key used by OcrFieldBubbles to point the
 * conversation bubble (and its tail) at the right form control.
 *
 * Voucher forms mark fields with `data-ocr-field="<key>"` (and optionally
 * `data-ocr-anchor="<id>"` for a more precise target). A suggestion whose id
 * is not listed here falls through to "lines" (Sale/Purchase item rows). That
 * used to hide the tail on Direct Expense / Payment / Contra bank-account
 * suggestions, because `create-account-from` does not start with `account-`.
 */

export function ocrFieldForSuggestion(id: string): string {
  if (id === "switch" || id.startsWith("switch-")) return "voucher-type";
  if (
    id === "create-party" ||
    id === "find-party" ||
    id === "use-party" ||
    id.startsWith("account-payee-")
  ) return "party";
  if (
    id === "create-expense-account" ||
    id === "open-expense-account-picker" ||
    id.startsWith("use-expense-account-")
  ) return "party";
  if (id === "date") return "date";
  if (id === "due") return "due-date";
  if (id === "create-vat" || id === "vat" || id === "choose-vat") return "tax";
  if (id === "create-ledger" || id === "ledger") return "ledger";
  if (id === "disc") return "discount";
  if (id.startsWith("amount")) return "amount";
  if (id === "billno") return "bill-no";
  // Contra "To" bank account — check before the generic account- prefix.
  if (id === "create-account-to" || id === "account-to" || id.startsWith("account-to-")) return "account-to";
  // From / Bank-Cash, including create-account-from (does not start with "account-").
  if (id === "account" || id === "create-account-from" || id.startsWith("account-")) return "account";
  if (id === "cannot-detect" || id === "status-failed" || id === "duplicate-ref") return "voucher-type";
  /** Reading-language / translate options attach to the OCR bar, not a form field. */
  if (id === "ocr-language" || id.startsWith("ocr-lang-") || id.startsWith("ocr-translate")) return "ocr-language";
  return "lines"; // lines, create-item-*, tds, drcr
}

/** Precise `data-ocr-anchor` for bank-account suggestions, when the form has one. */
export function ocrSuggestionFieldAnchor(id: string): string | undefined {
  if (id === "create-account-to" || id === "account-to" || id.startsWith("account-to-")) return "account-to";
  if (id === "create-account-from" || id === "account") return "account-from";
  if (id.startsWith("account-") && !id.startsWith("account-to") && !id.startsWith("account-payee-")) return "account-from";
  return undefined;
}

/**
 * Field keys each voucher type's form is expected to register while that tab
 * is open (`voucher-type` lives on AddVoucherDialog, the rest on the form).
 * Bank From/To are `account` / `account-to`. Direct Expense "To (Expense)" is `party`.
 */
export const OCR_FIELD_KEYS_BY_VOUCHER_TYPE: Record<string, readonly string[]> = {
  sale: ["voucher-type", "date", "party", "ledger", "lines", "tax", "discount", "total", "bill-no", "due-date"],
  purchase: ["voucher-type", "date", "party", "ledger", "lines", "tax", "discount", "total", "bill-no", "due-date"],
  payment_in: ["voucher-type", "date", "party", "account", "amount", "bill-no"],
  payment_out: ["voucher-type", "date", "party", "account", "amount", "other-charge", "bill-no"],
  direct_income: ["voucher-type", "date", "party", "account", "amount", "bill-no"],
  direct_expense: ["voucher-type", "date", "party", "account", "amount", "other-charge", "bill-no"],
  contra: ["voucher-type", "date", "account", "account-to", "amount", "other-charge", "bill-no"],
  journal: ["voucher-type", "date", "bill-no"],
  adjustment: ["voucher-type", "date", "amount", "bill-no"],
  note: ["voucher-type", "date", "bill-no"],
  add_salary: ["voucher-type", "date", "tax", "bill-no"],
  production: ["voucher-type", "date", "bill-no"],
};
