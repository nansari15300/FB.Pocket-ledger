/**
 * Stable keys for the labels in pl:gallery:auto-post-required-fields-missing (`missing` stays the human labels).
 * Lets the gallery runner pick a rule per field without parsing English / translated text.
 */
import { ocrRunStrings } from "./ocrRunStrings";

export type OcrMissingFieldKey =
  | "voucherType" | "party" | "date" | "dueDate" | "amount" | "amountMismatch" | "items" | "itemRowCount"
  | "itemAmount" | "account" | "ledgerAccount" | "taxAccount" | "chargeAccount" | "billNo" | "journalLines" | "other";

export function ocrMissingFieldKey(label: string): OcrMissingFieldKey {
  const S = ocrRunStrings();
  const t = String(label || "").trim();
  if (t === S.voucherTypeSwitchPending) return "voucherType";
  if (t === S.amountMismatch) return "amountMismatch";
  if (t === S.journalNoLines || t === S.journalLines || t.startsWith(S.journalLineAccount.split("{")[0])) return "journalLines";
  const l = t.toLowerCase();
  if (/row count mismatch/.test(l)) return "itemRowCount";
  if (/row amount does not match/.test(l)) return "itemAmount";
  if (/other charge account|bank (transfer )?charge/.test(l)) return "chargeAccount";
  if (/^item on line|line items|^required (item|service)/.test(l)) return "items";
  if (/vat|tax account/.test(l)) return "taxAccount";
  if (/purchase account|sales? account|ledger/.test(l)) return "ledgerAccount";
  if (/bank ?\/ ?cash|to account|from account|^required (to |from )?account|bank\/cash account/.test(l)) return "account";
  if (/party|payee|customer|supplier/.test(l)) return "party";
  if (/due date/.test(l)) return "dueDate";
  if (/date/.test(l)) return "date";
  if (/bill no|invoice no|reference|\bref\b/.test(l)) return "billNo";
  if (/amount|total/.test(l)) return "amount";
  return "other";
}

/** Unique keys, same order as the labels. */
export function ocrMissingFieldKeys(labels: readonly string[]): OcrMissingFieldKey[] {
  return [...new Set(labels.map(ocrMissingFieldKey))];
}
