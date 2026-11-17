/** OCR voucher autofill — shared types (Phase 1). */
export type OcrFieldStatus = "fill" | "flag" | "none";

export type OcrField<T> = {
  value: T;
  status: OcrFieldStatus;
  confidence: number;
  /** Short human reason when flagged. */
  note?: string;
};

export type OcrLineItem = {
  description: string;
  quantity: number;
  unit?: string;
  rate: number;
  amount: number;
  itemId?: string;
};

export type OcrVoucherKind = "purchase" | "sale";

export type OcrParsedBill = {
  date?: OcrField<Date>;
  dueDate?: OcrField<Date>;
  pan?: OcrField<string>;
  partyName?: OcrField<string>;
  partyId?: OcrField<string>;
  billNo?: OcrField<string>;
  subTotal?: OcrField<number>;
  discount?: OcrField<number>;
  vat?: OcrField<number>;
  tds?: OcrField<number>;
  total?: OcrField<number>;
  /** Single voucher amount (payments etc.). */
  amount?: OcrField<number>;
  lineItems?: OcrField<OcrLineItem[]>;
  /** Detected document type (relative to OUR company). */
  docType?: { type: OcrDocType; confidence: number; reason: string };
  /** Counter-party identifiers from the counter-party block only (never our own block). */
  identifiers?: import("./identifiers").OcrIdentifiers;
  /** Printed due date / credit days (AI). resolveOcrDueDate turns them (+ party / Common Setting days) into dueDate. */
  dueTerms?: { printedDue?: string | null; creditDays?: number | null };
  /**
   * Amount cross-check (AI): Dr = Cr, Grand Total vs item sum vs amount in words. ok=false is the
   * "amount mismatch" signal the Gallery runner applies its rule to (same as itemAmountMismatch).
   */
  amountCheck?: { ok: boolean; reasons: string[] };
  /** Payment mode printed on the bill (e.g. Cash / Cheque). */
  paymentMode?: string;
  /** Why fields were rejected (debug panel). */
  debug?: string[];
};

export type OcrWord = { text: string; x0: number; x1: number; y0: number; y1: number; conf: number };
export type OcrRawLine = { text: string; confidence: number; y: number; words?: OcrWord[] };

export type OcrRawResult = {
  text: string;
  lines: OcrRawLine[];
  meanConfidence: number;
  pageHeight: number;
  pageWidth?: number;
  /** Second (sparse-text) pass - only used to CONFIRM values the main pass could not read. */
  altText?: string;
  /** Which preprocessing produced `lines` ("standard" | "enhanced (deskew x deg)"), for the debug dump. */
  preprocess?: string;
  /** Standard vs enhanced retry pass summary (only when the retry ran). */
  passNote?: string;
  /** Which OCR engine produced the text. */
  engine?: "google" | "azure" | "gemini";
  /** Provider detail or diagnostic note. */
  engineNote?: string;
  /** AI (Gemini) only: the document transcribed as printed (raw_text). Shown in "Show OCR text"; parseBill reads it to fill fields the JSON missed. */
  printedText?: string;
  /** AI (Gemini) structured answer for this document; `parseBill` maps it onto the bill and validates it. */
  ai?: import("./ai/aiVoucher").OcrAiResult;
};

export type OcrPartyLike = {
  id: string;
  name: string;
  /** Optional "Alias Name" master field (matched like the name). */
  aliasName?: string;
  pan?: string;
  /** legacy / alternate field names seen on party records */
  panNo?: string;
  vatNo?: string;
  phone?: string;
  mobile?: string;
  isDeleted?: boolean;
  isFrozen?: boolean;
};

export type OcrItemLike = { id: string; name: string; aliasName?: string; isDeleted?: boolean };

export type OcrDocType =
  | "sale" | "purchase" | "payment_in" | "payment_out" | "contra" | "credit_note" | "debit_note"
  | "direct_expense" | "direct_income" | "journal";

/** System ledgers that ride along in the party list but are never selectable as a bill party (not in the Supplier/Customer combobox). */
export const OCR_NON_PARTY_IDS: readonly string[] = ["sales_account", "purchase_account", "owners_capital", "opening_balance_ledger"];
export function isOcrSelectableParty(p: { id: string; isDeleted?: boolean; isFrozen?: boolean } | null | undefined): boolean {
  return !!p && !p.isDeleted && !p.isFrozen && !OCR_NON_PARTY_IDS.includes(p.id);
}
