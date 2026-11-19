/**
 * AI (Gemini) voucher JSON -> the same OcrParsedBill the voucher fill uses.
 *
 * Gemini's JSON schema guarantees the SHAPE, not the VALUES, so every value is re-checked here with our own rules:
 *   qty x rate = amount (per item), sum(items) = Sub Total, Sub Total - Discount = Taxable, Taxable x VAT% = VAT,
 *   Taxable + VAT = Grand Total, PAN = 9 digits (never our own PAN), AD date agrees with the BS Miti.
 * A field is "fill" only when its checks pass; otherwise "flag" (shown in the bubbles / "OCR could not find" flow, not written).
 * Gemini returns the voucher JSON plus `raw_text` (the document transcribed as printed). raw.text stays the compact
 * summary built from the JSON (aiFallbackText) so the validated values drive the fill; raw_text rides along as
 * raw.printedText: "Show OCR text" shows it, and parseBill runs the classic parser on it to fill only the fields the
 * JSON left empty (fillGapsFromPrintedText). Nothing is invented.
 * Per-type field lists (AI_VOUCHER_TYPE_FIELDS) mirror VOUCHER_TYPE_FIELDS in the server's ocr_cloud.js.
 * Party fields are the counter-party only (aiCounterParty: buyer on our sale, seller on our purchase, never us).
 * Pure (no React / network) so the selftests can run it.
 */
import { defaultVoucherDateWindow, resolveBillDate } from "@/lib/ocr/dates";
import { hasCashWording } from "@/lib/ocr/receiptDetect/paymentAccountEvidence";
import { digitConfusionExplains, parseAmountInWords } from "./amountWords";
import { bestUniqueMatch, namesOf } from "../fuzzy";
import { matchPartyIdentity } from "../masterMatch";
import { normalizeName } from "../normalize";
import { isOcrSelectableParty } from "../types";
import type { OcrDocType, OcrField, OcrItemLike, OcrLineItem, OcrParsedBill, OcrPartyLike } from "../types";

export type OcrAiDocType = "purchase" | "sale" | "receipt" | "payment" | "contra" | "expense" | "other";
export type OcrAiDocKind = "tax_invoice" | "vat_bill" | "bank_transfer" | "cheque" | "deposit_slip" | "purchase_order" | "receipt" | "other";
/** Which way money moves; own_to_own = our bank -> our bank (contra). */
export type OcrAiBankFlow = "own_to_own" | "out" | "in" | "none" | "unclear";
/** The app's own voucher tabs. Gemini answers with one of these; the app opens that form as-is. */
export type OcrAiVoucherType =
  | "sale" | "purchase" | "payment_out" | "payment_in"
  | "contra" | "direct_expense" | "direct_income" | "journal"
  | "credit_note" | "debit_note";

/** What master collection a Dr/Cr line points at. The app looks the ledger up in that collection only. */
export type OcrAiLineKind =
  | "party" | "bank" | "cash" | "staff" | "tax" | "expense" | "income" | "item" | "discount" | "roundoff";

/** One side of the double entry, as printed. The app never decides the sides itself. */
export type OcrAiLine = {
  side: "dr" | "cr";
  kind: OcrAiLineKind;
  name: string | null;
  /** Bank / cash account number if printed (masked OK). */
  account_no: string | null;
  bank_name: string | null;
  pan: string | null;
  amount: number | null;
};

export type OcrAiItem = {
  sn: number | null;
  description: string;
  hs_code: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
  /** Raw printed cells: header text -> printed value, so columns map by header instead of by position. */
  cells?: Record<string, string> | null;
};
export type OcrAiEnglishTranslation = { source: string; english: string };
export type OcrAiVoucher = {
  /**
   * THE answer the app acts on: which voucher form to open. Everything else is field data for that form.
   * The app never re-derives the type from raw text (that is what made supplier payments show as contra).
   */
  voucher_type: OcrAiVoucherType | null;
  /** One short line of printed evidence for the type. */
  voucher_type_reason: string | null;
  /** Double entry as printed (max AI_MAX_LINES = 30). Empty for a plain item bill (purchase/sale build lines from items). */
  lines: OcrAiLine[];
  /** The printed item table's column headers, left to right. */
  item_columns?: string[] | null;
  doc_type: OcrAiDocType | null;
  /** Document family Gemini picked before the accounting type. */
  doc_kind: OcrAiDocKind | null;
  our_company_role: "buyer" | "seller" | "none" | null;
  /** Money documents only: direction of the transfer + the printed evidence. */
  bank_flow: OcrAiBankFlow | null;
  bank_flow_reason: string | null;
  /** Printed holder name of the SOURCE account (e.g. "Nabiullah Ansari" from "ACCOUNTFT:Nabiullah Ansari"). */
  account_holder_name: string | null;
  debit_account: string | null;
  debit_bank: string | null;
  credit_account: string | null;
  credit_bank: string | null;
  /** "Account Name" printed under Beneficiary Details — usually OUR company on a bank-to-bank slip. */
  beneficiary_name: string | null;
  transfer_reference: string | null;
  transfer_mode: string | null;
  transfer_charges: number | null;
  party_name: string | null;
  party_pan: string | null;
  party_address: string | null;
  party_phone: string | null;
  invoice_no: string | null;
  date_ad: string | null;
  date_bs: string | null;
  /** Date line exactly as printed (original digits / separators). */
  date_bs_raw: string | null;
  payment_mode: string | null;
  /** Printed due date (YYYY-MM-DD AD) - never computed by the AI. */
  due_date: string | null;
  /** Printed credit period in days. */
  credit_days: number | null;
  /** Printed amount-in-words line, as printed. */
  amount_in_words: string | null;
  /** Whole document transcribed as printed (original script + digits), line by line. */
  raw_text: string | null;
  items: OcrAiItem[];
  subtotal: number | null;
  discount: number | null;
  taxable: number | null;
  vat_percent: number | null;
  vat_amount: number | null;
  grand_total: number | null;
  uncertain_fields: string[];
  notes: string | null;
  /** Precomputed one-call translations for popup display; source fields remain untouched for matching. */
  english_translations: OcrAiEnglishTranslation[];
};
export type OcrAiUsage = { promptTokens: number; outputTokens: number; thoughtsTokens: number; totalTokens: number };
/** Server-side per-type check (ocr_cloud.js validateVoucherByType): required fields missing / fields the type should leave empty. */
export type OcrAiTypeCheck = { voucher_type: string | null; missing: string[]; unexpected: string[] };
export type OcrAiResult = { provider: "gemini"; model: string; data: OcrAiVoucher; usage: OcrAiUsage; /** Taught rules the server added to the prompt. */ rulesUsed?: number; typeCheck?: OcrAiTypeCheck | null; /** Server read it with the fallback model (primary was busy). */ fallbackUsed?: boolean; primaryModel?: string };

const DOC_TYPES: readonly OcrAiDocType[] = ["purchase", "sale", "receipt", "payment", "contra", "expense", "other"];
const DOC_KINDS: readonly OcrAiDocKind[] = ["tax_invoice", "vat_bill", "bank_transfer", "cheque", "deposit_slip", "purchase_order", "receipt", "other"];
const BANK_FLOWS: readonly OcrAiBankFlow[] = ["own_to_own", "out", "in", "none", "unclear"];
export const AI_VOUCHER_TYPES: readonly OcrAiVoucherType[] = ["sale", "purchase", "credit_note", "debit_note", "payment_out", "payment_in", "contra", "direct_expense", "direct_income", "journal"];
const VOUCHER_TYPES = AI_VOUCHER_TYPES;
/** Same cap as the server schema (lines maxItems). */
export const AI_MAX_LINES = 30;

/**
 * Per voucher type: which JSON fields the type needs ("a|b" = one of them), may use, and must leave empty.
 * MUST stay identical to VOUCHER_TYPE_FIELDS in PocketLedger-Server/sub-server/pb_hooks/lib/ocr_cloud.js
 * (tests/ocr/aiVoucherSchema.selftest.mts compares them).
 */
type TypeFields = { required: readonly string[]; optional: readonly string[]; empty: readonly string[] };
const BILL_OPT = ["party_pan", "party_address", "party_phone", "due_date", "credit_days", "item_columns", "subtotal", "discount", "taxable", "vat_percent", "vat_amount", "amount_in_words", "payment_mode"] as const;
const BILL_EMPTY = ["lines", "debit_account", "debit_bank", "credit_account", "credit_bank", "beneficiary_name", "account_holder_name", "transfer_reference", "transfer_charges"] as const;
const NOTE_OPT = ["party_pan", "party_address", "party_phone", "items", "item_columns", "subtotal", "discount", "taxable", "vat_percent", "vat_amount", "amount_in_words"] as const;
const NOTE_EMPTY = ["lines", "due_date", "credit_days", "debit_account", "debit_bank", "credit_account", "credit_bank", "beneficiary_name", "account_holder_name", "transfer_reference", "transfer_charges"] as const;
const PAY_OPT = ["party_name", "party_pan", "party_phone", "debit_account", "debit_bank", "credit_account", "credit_bank", "beneficiary_name", "account_holder_name", "transfer_mode", "transfer_reference", "transfer_charges", "payment_mode", "invoice_no", "amount_in_words", "lines"] as const;
const PAY_EMPTY = ["items", "item_columns", "subtotal", "discount", "taxable", "vat_percent", "vat_amount", "due_date", "credit_days"] as const;
const DIRECT_OPT = ["debit_account", "debit_bank", "credit_account", "credit_bank", "beneficiary_name", "account_holder_name", "transfer_mode", "transfer_reference", "transfer_charges", "payment_mode", "invoice_no", "amount_in_words"] as const;
const DIRECT_EMPTY = ["party_name", "party_pan", "items", "item_columns", "subtotal", "discount", "taxable", "due_date", "credit_days"] as const;
export const AI_VOUCHER_TYPE_FIELDS: Record<OcrAiVoucherType, TypeFields> = {
  sale: { required: ["party_name", "invoice_no", "date_ad|date_bs", "grand_total", "items"], optional: BILL_OPT, empty: BILL_EMPTY },
  purchase: { required: ["party_name", "invoice_no", "date_ad|date_bs", "grand_total", "items"], optional: BILL_OPT, empty: BILL_EMPTY },
  credit_note: { required: ["party_name", "invoice_no", "date_ad|date_bs", "grand_total"], optional: NOTE_OPT, empty: NOTE_EMPTY },
  debit_note: { required: ["party_name", "invoice_no", "date_ad|date_bs", "grand_total"], optional: NOTE_OPT, empty: NOTE_EMPTY },
  payment_out: { required: ["date_ad|date_bs", "grand_total", "bank_flow"], optional: PAY_OPT, empty: PAY_EMPTY },
  payment_in: { required: ["date_ad|date_bs", "grand_total", "bank_flow"], optional: PAY_OPT, empty: PAY_EMPTY },
  contra: {
    required: ["date_ad|date_bs", "grand_total", "debit_account|debit_bank", "credit_account|credit_bank"],
    optional: ["beneficiary_name", "account_holder_name", "transfer_mode", "transfer_reference", "transfer_charges", "amount_in_words", "lines"],
    empty: ["party_name", "party_pan", "party_address", "party_phone", "items", "item_columns", "subtotal", "discount", "taxable", "vat_percent", "vat_amount", "due_date", "credit_days"],
  },
  direct_expense: { required: ["date_ad|date_bs", "grand_total", "lines"], optional: DIRECT_OPT, empty: DIRECT_EMPTY },
  direct_income: { required: ["date_ad|date_bs", "grand_total", "lines"], optional: DIRECT_OPT, empty: DIRECT_EMPTY },
  journal: {
    required: ["date_ad|date_bs", "grand_total", "lines"],
    optional: ["invoice_no", "amount_in_words"],
    empty: ["party_name", "party_pan", "items", "item_columns", "subtotal", "discount", "taxable", "vat_percent", "vat_amount", "due_date", "credit_days", "transfer_charges"],
  },
};

const aiFilled = (v: unknown) => v != null && (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : typeof v === "number" ? Number.isFinite(v) && v !== 0 : true);
/** Client copy of the server's per-type check (used when an older server sent no typeCheck). Never changes values. */
export function aiTypeCheck(d: OcrAiVoucher): OcrAiTypeCheck {
  const t = d.voucher_type;
  if (!t) return { voucher_type: null, missing: ["voucher_type"], unexpected: [] };
  const f = AI_VOUCHER_TYPE_FIELDS[t];
  const rec = d as unknown as Record<string, unknown>;
  return {
    voucher_type: t,
    missing: f.required.filter((k) => !k.split("|").some((x) => aiFilled(rec[x]))),
    unexpected: f.empty.filter((k) => aiFilled(rec[k])),
  };
}
const LINE_KINDS: readonly OcrAiLineKind[] = ["party", "bank", "cash", "staff", "tax", "expense", "income", "item", "discount", "roundoff"];

function normalizeCells(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k ?? "").replace(/\s+/g, " ").trim();
    const val = str(v);
    if (!key || !val) continue;
    out[key] = val;
    if (++n >= 16) break;
  }
  return n ? out : null;
}

function normalizeLines(raw: unknown): OcrAiLine[] {  if (!Array.isArray(raw)) return [];
  const out: OcrAiLine[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const l = x as Record<string, unknown>;
    const side = str(l.side)?.toLowerCase();
    const kind = str(l.kind)?.toLowerCase() as OcrAiLineKind | undefined;
    if (side !== "dr" && side !== "cr") continue;
    if (!kind || !LINE_KINDS.includes(kind)) continue;
    out.push({
      side,
      kind,
      name: str(l.name),
      account_no: str(l.account_no),
      bank_name: str(l.bank_name),
      pan: str(l.pan),
      amount: aiNum(l.amount),
    });
    if (out.length >= AI_MAX_LINES) break;
  }
  return out;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && !/^(null|n\/?a|-+)$/i.test(s) ? s : null;
}

/** "17,591.00" / "Rs. 1,035.30" / 179.5 -> number; anything else -> null. */
export function aiNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = devanagariDigitsToLatin(v).replace(/rs\.?|npr|\/-|,|\s/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "१०,०००" -> "10,000": Devanagari digits are mapped one by one (१ is 1, never 9). */
export function devanagariDigitsToLatin(s: string): string {
  return String(s ?? "").replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}

/** "2026-08-12" / "२०२६-०८-१२" -> "2026-08-12"; anything else -> null. */
function isoDate(v: unknown): string | null {
  const t = devanagariDigitsToLatin(String(v ?? "")).trim();
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

/** Keep the transcription as printed (line breaks kept, control chars dropped, capped). */
function rawText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]+/g, " ").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  return t ? t.slice(0, 20000) : null;
}

/** Coerce whatever the server returned into OcrAiVoucher (never throws). */
export function normalizeAiVoucher(raw: unknown): OcrAiVoucher {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dt = str(o.doc_type)?.toLowerCase() as OcrAiDocType | undefined;
  const role = str(o.our_company_role)?.toLowerCase();
  const kind = str(o.doc_kind)?.toLowerCase() as OcrAiDocKind | undefined;
  const flow = str(o.bank_flow)?.toLowerCase() as OcrAiBankFlow | undefined;
  const items = Array.isArray(o.items) ? o.items : [];
  const vt = str(o.voucher_type)?.toLowerCase() as OcrAiVoucherType | undefined;
  const docType = dt && DOC_TYPES.includes(dt) ? dt : null;
  const cols = Array.isArray(o.item_columns)
    ? o.item_columns.map((c) => str(c)).filter((c): c is string => !!c).slice(0, 14)
    : [];
  return {
    /* Do not infer the type from doc_type: only Gemini's explicit decision is authoritative. */
    voucher_type: vt && VOUCHER_TYPES.includes(vt) ? vt : null,
    voucher_type_reason: str(o.voucher_type_reason),
    lines: normalizeLines(o.lines),
    item_columns: cols.length ? cols : null,
    doc_type: docType,
    doc_kind: downgradeCashBankTransfer(kind && DOC_KINDS.includes(kind) ? kind : null, o),
    our_company_role: role === "buyer" || role === "seller" || role === "none" ? role : null,
    bank_flow: flow && BANK_FLOWS.includes(flow) ? flow : null,
    bank_flow_reason: str(o.bank_flow_reason),
    account_holder_name: str(o.account_holder_name),
    debit_account: str(o.debit_account),
    debit_bank: str(o.debit_bank),
    credit_account: str(o.credit_account),
    credit_bank: str(o.credit_bank),
    beneficiary_name: str(o.beneficiary_name),
    transfer_reference: str(o.transfer_reference),
    transfer_mode: str(o.transfer_mode),
    transfer_charges: aiNum(o.transfer_charges),
    party_name: str(o.party_name),
    party_pan: str(o.party_pan),
    party_address: str(o.party_address),
    party_phone: str(o.party_phone),
    invoice_no: str(o.invoice_no),
    date_ad: str(o.date_ad),
    date_bs: str(o.date_bs),
    date_bs_raw: str(o.date_bs_raw),
    payment_mode: str(o.payment_mode),
    due_date: isoDate(o.due_date),
    credit_days: (() => { const n = aiNum(o.credit_days); return n != null && n > 0 && n <= 3650 ? Math.round(n) : null; })(),
    amount_in_words: str(o.amount_in_words),
    raw_text: rawText(o.raw_text),
    items: items
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        sn: aiNum(x.sn),
        description: str(x.description) ?? "",
        hs_code: str(x.hs_code),
        qty: aiNum(x.qty),
        unit: str(x.unit),
        rate: aiNum(x.rate),
        amount: aiNum(x.amount),
        cells: normalizeCells(x.cells),
      }))
      .filter((x) => x.description || x.amount != null),
    subtotal: aiNum(o.subtotal),
    discount: aiNum(o.discount),
    taxable: aiNum(o.taxable),
    vat_percent: aiNum(o.vat_percent),
    vat_amount: aiNum(o.vat_amount),
    grand_total: aiNum(o.grand_total),
    uncertain_fields: Array.isArray(o.uncertain_fields) ? o.uncertain_fields.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12) : [],
    notes: str(o.notes),
    english_translations: Array.isArray(o.english_translations)
      ? o.english_translations.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({ source: str(x.source) ?? "", english: str(x.english) ?? "" }))
        .filter((x) => x.source && x.english && x.source !== x.english).slice(0, 80)
      : [],
  };
}

/**
 * Compact text built from the AI JSON: "Show OCR text" and the lines the classic parser reads (labels it knows:
 * INVOICE NO. / INVOICE DATE / INVOICE MITI / PAN NO. / SUB TOTAL ...). Every value comes from the JSON.
 */
export function aiFallbackText(d: OcrAiVoucher): string {
  const L: string[] = [];
  const side = d.our_company_role === "seller" ? "BUYER" : d.our_company_role === "buyer" ? "SELLER" : "PARTY";
  if (d.party_name) L.push(`${side} NAME : ${d.party_name}`);
  if (d.party_address) L.push(`ADDRESS : ${d.party_address}`);
  if (d.party_phone) L.push(`PHONE : ${d.party_phone}`);
  if (d.party_pan) L.push(`PAN NO. : ${d.party_pan}`);
  if (d.invoice_no) L.push(`INVOICE NO. : ${d.invoice_no}`);
  const ad = toDmy(d.date_ad);
  const bs = bsDateText(d.date_bs);
  if (ad) L.push(`INVOICE DATE : ${ad}`);
  if (bs) L.push(`INVOICE MITI : ${bs}`);
  if (d.payment_mode) L.push(`MODE OF PAYMENT : ${d.payment_mode}`);
  if (d.items.length) L.push("S.N | PARTICULARS | QTY | RATE | AMOUNT");
  d.items.forEach((it, i) => {
    const name = [it.description, it.hs_code ? `(HS ${it.hs_code})` : ""].filter(Boolean).join(" ");
    const qty = [it.qty, it.unit].filter((x) => x != null && x !== "").join(" ");
    L.push([`${it.sn ?? i + 1}.`, name, qty || "-", it.rate ?? "-", it.amount ?? "-"].join(" | "));
  });
  if (d.subtotal != null) L.push(`SUB TOTAL ${d.subtotal.toFixed(2)}`);
  if (d.discount != null) L.push(`DISCOUNT ${d.discount.toFixed(2)}`);
  if (d.taxable != null) L.push(`TAXABLE AMOUNT ${d.taxable.toFixed(2)}`);
  if (d.vat_amount != null) L.push(`VAT ${d.vat_percent ?? 13}% ${d.vat_amount.toFixed(2)}`);
  if (d.grand_total != null) L.push(`GRAND TOTAL ${d.grand_total.toFixed(2)}`);
  /* Keep the compact text machine-readable: the classification reason is AI metadata, not bill text.
   * It is shown separately in OCR debug details. */
  if (d.voucher_type) L.push(`VOUCHER TYPE : ${d.voucher_type}`);
  if (d.lines.length) {
    L.push("DR / CR");
    for (const ln of d.lines) {
      const who = [ln.name, ln.account_no ? `#${ln.account_no}` : "", ln.bank_name].filter(Boolean).join(" ");
      L.push(`${ln.side.toUpperCase()} | ${ln.kind} | ${who || "-"} | ${ln.amount ?? "-"}`);
    }
  }
  if (d.due_date) L.push(`DUE DATE : ${toDmy(d.due_date) ?? d.due_date}`);
  if (d.credit_days) L.push(`CREDIT DAYS : ${d.credit_days}`);
  if (d.amount_in_words) L.push(`IN WORDS : ${d.amount_in_words}`);
  return L.join("\n");
}

/* ---------------- Amount cross-checks (Dr = Cr, Grand Total vs items vs words) ---------------- */

export { parseAmountInWords, digitConfusionExplains, confusedYearAlternatives } from "./amountWords";

const BANK_TRANSFER_HINT =
  /(?:\b(?:connect\s*ips|rtgs|neft|imps|transaction\s*id|debit\s*status|beneficiary|cheque|account\s*(?:no\.?|number|#))\b|\u092c\u0948\u0902\u0915|\u092c\u0948\u0919\u094d\u0915|\u091a\u0947\u0915)/i;

/**
 * A cash / नगद / खर्च भौचर must not stay classified as bank_transfer when the paper
 * has no bank-slip, cheque, wallet or account-number evidence.
 */
export function downgradeCashBankTransfer(kind: OcrAiDocKind | null, o: Record<string, unknown>): OcrAiDocKind | null {
  if (kind !== "bank_transfer") return kind;
  const paymentMode = str(o.payment_mode);
  const transferMode = str(o.transfer_mode);
  const transferRef = str(o.transfer_reference);
  const raw = rawText(o.raw_text);
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const blob = [
    paymentMode, transferMode, transferRef, raw,
    str(o.debit_bank), str(o.credit_bank), str(o.debit_account), str(o.credit_account),
    str(o.voucher_type_reason), str(o.bank_flow_reason),
  ].filter(Boolean).join("\n");
  const cash = hasCashWording(blob) || /\bcash\b/i.test(`${paymentMode ?? ""} ${transferMode ?? ""}`);
  if (!cash) return kind;
  if (transferRef) return kind;
  const bankBits = [str(o.debit_bank), str(o.credit_bank), str(o.debit_account), str(o.credit_account)].filter(Boolean).join(" ");
  if (BANK_TRANSFER_HINT.test(bankBits) || /\d{6,}/.test(bankBits.replace(/\s/g, ""))) return kind;
  for (const ln of lines) {
    if (!ln || typeof ln !== "object") continue;
    const rec = ln as Record<string, unknown>;
    const acc = str(rec.account_no);
    const bank = str(rec.bank_name);
    const kindLn = str(rec.kind);
    if (acc && /\d{6,}/.test(acc.replace(/\s/g, ""))) return kind;
    if (kindLn === "bank" && bank && !hasCashWording(bank) && !/^cash$/i.test(bank)) return kind;
  }
  if (BANK_TRANSFER_HINT.test(blob)) return kind;
  return "other";
}

export type AiAmountResolve = { data: OcrAiVoucher; check: AiAmountCheck; preferredWords?: { from: number; to: number } };

/**
 * When the printed amount in words disagrees with Grand Total but a handwritten /
 * Devanagari digit confusion (४↔८, १↔९, …) explains the gap, prefer the words
 * value and correct line/item amounts that copied the wrong total. Otherwise the
 * existing aiAmountCheck mismatch stands.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

export function resolveAiAmounts(d: OcrAiVoucher): AiAmountResolve {
  const words = d.amount_in_words ? parseAmountInWords(d.amount_in_words) : null;
  const grand = d.grand_total;
  if (words == null || grand == null || near(words, grand) || !digitConfusionExplains(grand, words)) {
    return { data: d, check: aiAmountCheck(d) };
  }
  const data: OcrAiVoucher = {
    ...d,
    grand_total: words,
    items: d.items.map((it) => (it.amount != null && near(it.amount, grand) ? { ...it, amount: words } : it)),
    lines: d.lines.map((ln) => (ln.amount != null && near(ln.amount, grand) ? { ...ln, amount: words } : ln)),
  };
  return { data, check: aiAmountCheck(data), preferredWords: { from: grand, to: words } };
}

export type AiAmountCheck = { ok: boolean; reasons: string[]; drTotal?: number; crTotal?: number; wordsAmount?: number | null };

/**
 * Money cross-checks the runner treats as "amount mismatch":
 *  - Dr total = Cr total when Gemini returned ledger lines (both sides present),
 *  - printed amount in words = Grand Total,
 *  - item sum (- discount + VAT) = Grand Total when items and a Grand Total are both present.
 * Pure; reasons are short English debug text (the UI shows its own localized label).
 */
export function aiAmountCheck(d: OcrAiVoucher): AiAmountCheck {
  const reasons: string[] = [];
  const out: AiAmountCheck = { ok: true, reasons };
  const dr = d.lines.filter((l) => l.side === "dr");
  const cr = d.lines.filter((l) => l.side === "cr");
  if (dr.length && cr.length) {
    const sum = (ls: OcrAiLine[]) => r2(ls.reduce((a, l) => a + (l.amount ?? 0), 0));
    out.drTotal = sum(dr);
    out.crTotal = sum(cr);
    if (dr.some((l) => l.amount == null) || cr.some((l) => l.amount == null)) reasons.push("Dr/Cr line amount missing");
    else if (!near(out.drTotal, out.crTotal)) reasons.push(`Dr ${out.drTotal} does not equal Cr ${out.crTotal}`);
  }
  const grand = d.grand_total;
  if (d.amount_in_words) {
    const w = parseAmountInWords(d.amount_in_words);
    out.wordsAmount = w;
    if (w != null && grand != null && !near(w, grand)) reasons.push(`Amount in words ${w} does not match Grand Total ${grand}`);
  }
  const amounts = d.items.map((i) => i.amount).filter((x): x is number => x != null);
  if (grand != null && amounts.length && amounts.length === d.items.length) {
    const S = amounts.reduce((a, b) => a + b, 0);
    const expected = r2(S - (d.discount ?? 0) + (d.vat_amount ?? 0));
    /* A bill whose items are printed VAT-inclusive also passes (S itself = Grand Total). */
    if (!near(expected, grand, Math.max(1, grand * 0.002)) && !near(r2(S), grand, Math.max(1, grand * 0.002))) {
      reasons.push(`Items ${r2(S)} (- discount + VAT = ${expected}) do not match Grand Total ${grand}`);
    }
  }
  out.ok = reasons.length === 0;
  return out;
}

/** AI voucher_type -> the app's OcrDocType (all AI types are honoured). */
export function aiDocTypeOf(t: OcrAiVoucherType | null | undefined): OcrDocType | null {
  return t && (AI_VOUCHER_TYPES as readonly string[]).includes(t) ? (t as OcrDocType) : null;
}

export type AiCounterParty = {
  /** Counter-party name (null when missing or when Gemini returned our own company). */
  name: string | null;
  /** 9-digit counter-party PAN (never ours). */
  pan: string | null;
  /** PAN Gemini read that is not 9 digits (flag only). */
  badPan: string | null;
  ownPan: boolean;
  ownName: boolean;
  address: string | null;
  phones: string[];
};

/** "00977-25-581953" -> "025-581953", "+977 9812345678" -> "9812345678" (shapes the text parser keeps). */
function aiPhone(raw: string): string | null {
  let t = String(raw ?? "").replace(/\D/g, "");
  if (/^(00)?977/.test(t) && t.length > 10) t = t.replace(/^(00)?977/, "");
  if (/^9[678]\d{8}$/.test(t)) return t;
  if (t.length < 7 || t.length > 11) return null;
  if (!t.startsWith("0")) t = "0" + t;
  const m = t.match(/^(0\d{1,2})(\d{6,7})$/);
  return m ? `${m[1]}-${m[2]}` : t;
}

/**
 * The other party as Gemini read it: the buyer on our sale, the seller on our purchase. Our own company (by PAN or
 * name) is never returned as the party. Used by the parser's party match and the "Create new party" prefill.
 */
export function aiCounterParty(d: OcrAiVoucher, ownPan?: string | null, ownName?: string | null): AiCounterParty {
  const own = String(ownPan ?? "").replace(/\D/g, "");
  const ownKey = (ownName ? normalizeName(ownName) : "").split(" ").filter(Boolean).slice(0, 3).join(" ");
  const panDigits = (d.party_pan ?? "").replace(/\D/g, "");
  const isOwnPan = !!own && panDigits === own;
  const ownByName = !!d.party_name && ownKey.length >= 4 && normalizeName(d.party_name).includes(ownKey);
  const phones: string[] = [];
  if (!ownByName) for (const p of (d.party_phone ?? "").split(/[\/,;]| {2,}/)) { const t = aiPhone(p); if (t && !phones.includes(t)) phones.push(t); }
  return {
    name: d.party_name && !ownByName ? d.party_name : null,
    pan: !isOwnPan && panDigits.length === 9 ? panDigits : null,
    badPan: d.party_pan && !isOwnPan && panDigits.length !== 9 ? panDigits || d.party_pan : null,
    ownPan: isOwnPan,
    ownName: ownByName,
    address: ownByName ? null : d.party_address,
    phones,
  };
}

export type AiApplyContext = {
  parties: readonly OcrPartyLike[];
  items: readonly OcrItemLike[];
  ownPan?: string | null;
  ownName?: string | null;
  /** Parser's unit canonicalizer (KG -> Kg, PCS -> Pcs ...). */
  normUnit?: (raw?: string) => string | undefined;
};

const f = <T,>(value: T, status: "fill" | "flag", confidence: number, note?: string): OcrField<T> => ({ value, status, confidence, ...(note ? { note } : {}) });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2026-08-12" / "2083/04/27" -> "12/08/2026" (the printed Nepali layout our date resolver reads). */
function toDmy(s: string | null): string | null {
  const m = String(s ?? "").match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}`;
  const d = String(s ?? "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return d ? `${d[1].padStart(2, "0")}/${d[2].padStart(2, "0")}/${d[3]}` : null;
}

/** Keep Gemini's canonical BS YYYY-MM-DD intact; DD/MM/YYYY makes a BS Miti ambiguous. */
function bsDateText(s: string | null): string | null {
  const m = String(s ?? "").match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : toDmy(s);
}

/** Map + validate Gemini's answer onto the bill parsed from its raw_text. Mutates `bill`. */
export function applyAiToBill(bill: OcrParsedBill, ai: OcrAiResult, ctx: AiApplyContext): void {
  const resolvedAmt = resolveAiAmounts(ai.data);
  const d = resolvedAmt.data;
  if (!bill.debug) bill.debug = [];
  const dbg = (m: string) => bill.debug!.push(m);
  const unsure = new Set(d.uncertain_fields.map((x) => x.toLowerCase().replace(/\s+/g, "")));
  const isUnsure = (...keys: string[]) => keys.some((k) => unsure.has(k));
  const unsureNote = "AI was not sure - please confirm";
  const u = ai.usage;
  dbg(`AI (gemini): model ${ai.model || "-"}; tokens in ${u.promptTokens} / out ${u.outputTokens}${u.thoughtsTokens ? ` / thinking ${u.thoughtsTokens}` : ""} / total ${u.totalTokens}`);
  if (resolvedAmt.preferredWords) dbg(`AI amount: words ${resolvedAmt.preferredWords.to} preferred over digits ${resolvedAmt.preferredWords.from} (handwritten digit confusion)`);

  /* ---- Bill No ---- */
  if (d.invoice_no) {
    const parserBn = bill.billNo?.status === "fill" ? bill.billNo.value : null;
    const differs = parserBn && parserBn.replace(/\s/g, "").toUpperCase() !== d.invoice_no.replace(/\s/g, "").toUpperCase();
    bill.billNo = isUnsure("invoice_no") ? f(d.invoice_no, "flag", 0.6, unsureNote)
      : differs ? f(d.invoice_no, "flag", 0.7, `AI read "${d.invoice_no}", text parser read "${parserBn}"`)
      : f(d.invoice_no, "fill", 0.96);
    dbg(`AI Bill No: ${d.invoice_no} (${bill.billNo.status})`);
  }

  /* ---- Date: AD must agree with the BS Miti (same resolver as printed bills).
   * A missing or unsure AD date never blocks a clear BS Miti (many Nepali bills print only the Miti). ---- */
  if (d.date_ad || d.date_bs || d.date_bs_raw) {
    const bs = bsDateText(d.date_bs);
    const bsRaw = d.date_bs_raw ? devanagariDigitsToLatin(d.date_bs_raw) : null;
    // Gemini often reports a generic "date" uncertainty when the AD format is ambiguous.
    // Treat that as uncertainty about AD, not the separately extracted Nepali Miti. A clear
    // Miti can disambiguate DD/MM vs MM/DD and should still populate the voucher date.
    const bsUnsure = isUnsure("date_bs", "miti", "date_bs_raw");
    const adUnsure = isUnsure("date_ad", "date");
    const adDropped = !!d.date_ad && adUnsure && !!bs && !bsUnsure;
    const ad = adDropped ? null : toDmy(d.date_ad);
    const text = [
      ad ? `INVOICE DATE : ${ad}` : "",
      bs ? `INVOICE MITI : ${bs}` : "",
      bsRaw && bsRaw !== bs ? `INVOICE MITI : ${bsRaw}` : "",
    ].filter(Boolean).join("\n");
    const res = text ? resolveBillDate(text, defaultVoucherDateWindow()) : null;
    if (res) {
      const unsureHit = (bsUnsure && !!bs) || (adUnsure && !!ad && !bs);
      const st = unsureHit && res.status === "fill" ? "flag" : res.status;
      bill.date = f(res.date, st, res.confidence, st !== res.status ? unsureNote : res.note);
      dbg(`AI Date: ${bill.date.status} ${ymd(res.date)} (AD ${d.date_ad ?? "-"}${adDropped ? " (unsure - BS Miti used)" : ""} / BS ${d.date_bs ?? "-"}${res.note ? `; ${res.note}` : ""})`);
    } else {
      dbg(`AI Date: AD ${d.date_ad ?? "-"} / BS ${d.date_bs ?? "-"} not usable - kept text parser date`);
    }
  }

  /* ---- PAN (9 digits, never ours) + identifiers: counter-party only ---- */
  const cp = aiCounterParty(d, ctx.ownPan, ctx.ownName);
  const panDigits = (d.party_pan ?? "").replace(/\D/g, "");
  const pan = cp.pan;
  if (cp.ownPan) dbg(`AI PAN ${panDigits} is our own company PAN - ignored`);
  else if (cp.badPan) { bill.pan = f(cp.badPan, "flag", 0.5, "PAN must be 9 digits"); dbg(`AI PAN "${d.party_pan}" is not 9 digits - flagged`); }
  else if (pan) bill.pan = f(pan, isUnsure("party_pan") ? "flag" : "fill", isUnsure("party_pan") ? 0.6 : 0.97, isUnsure("party_pan") ? unsureNote : undefined);
  const ownByName = cp.ownName;
  if (cp.name) bill.partyName = f(cp.name, "flag", 0.9);
  else if (ownByName) dbg(`AI party name "${d.party_name}" is our own company - ignored`);
  const ids = bill.identifiers ?? { phones: [], emails: [], bankAccountNos: [] };
  if (pan) ids.pan = pan;
  if (cp.address) ids.address = cp.address;
  for (const t of cp.phones) if (!ids.phones.includes(t)) ids.phones.push(t);
  if (d.payment_mode) bill.paymentMode = ids.paymentMode = d.payment_mode;
  bill.identifiers = ids;

  /* ---- Party match: compare every identity field read from this bill ---- */
  const pool = ctx.parties.filter(isOcrSelectableParty);
  const identity = { name: cp.name, pan, phone: cp.phones[0] ?? null, address: cp.address };
  const identityMatch = matchPartyIdentity(identity, pool);
  // The text parser can match a party using a nearby phone/PAN even when the printed identifier
  // belongs to the bill's other side (for example, a customer's PAN on a purchase invoice).
  // Keep a parser pick only when it is the same master that passes the field-by-field policy.
  if (bill.partyId?.value) {
    const parsedParty = pool.find((p) => p.id === bill.partyId!.value);
    if (!parsedParty || identityMatch.decision !== "auto" || identityMatch.best?.item.id !== parsedParty.id) {
      dbg(`AI Party: cleared parser pick "${parsedParty?.name ?? bill.partyId.value}"; it is not a confident match for counter-party "${cp.name}"`);
      delete bill.partyId;
    }
  }
  if (identityMatch.decision === "auto" && identityMatch.best) {
    bill.partyId = f(identityMatch.best.item.id, "fill", identityMatch.best.total);
    dbg(`AI Party: "${identityMatch.best.item.name}" — ${identityMatch.reason}`);
  } else if ((identityMatch.decision === "suggest" || identityMatch.decision === "pick") && identityMatch.best) {
    bill.partyId = f(identityMatch.best.item.id, "flag", identityMatch.best.total, `${identityMatch.reason} — confirm the party`);
    dbg(`AI Party suggestion "${identityMatch.best.item.name}" — ${identityMatch.reason}`);
  } else if (identityMatch.decision === "none") {
    dbg(`AI Party: no existing party passed field checks for "${cp.name ?? "-"}" (${identityMatch.reason})`);
  }

  /* ---- Items: qty x rate = amount ---- */
  const rows: OcrLineItem[] = [];
  const bad: string[] = [];
  d.items.forEach((it, i) => {
    let qty = it.qty;
    let rate = it.rate;
    const amount = it.amount;
    const label = `row ${it.sn ?? i + 1}`;
    if (amount == null || amount <= 0) { bad.push(`${label}: no amount`); return; }
    if (qty == null && rate) { qty = r2(amount / rate); bad.push(`${label}: qty missing (derived ${qty})`); }
    // A printed dash means the unit rate is omitted. If quantity and row amount are clear,
    // derive the arithmetic rate so the voucher can retain the verified amount even when
    // no item master matched (e.g. 1 piece × Rs. 10,000 = Rs. 10,000).
    const rateDerived = rate == null && qty != null && qty > 0;
    if (rateDerived) {
      rate = r2(amount / qty!);
      dbg(`AI ${label}: rate not printed; derived ${rate} from amount ${amount} / qty ${qty}`);
    }
    if (qty == null || rate == null) { bad.push(`${label}: qty/rate missing`); rows.push({ description: it.description, quantity: qty ?? 1, unit: unitOf(it.unit, ctx), rate: rate ?? amount, amount }); return; }
    if (!near(qty * rate, amount, Math.max(1, amount * 0.002))) bad.push(`${label}: ${qty} x ${rate} = ${r2(qty * rate)} but amount ${amount}`);
    else if (!rateDerived && isUnsure(`items[${i}]`, `items[${i + 1}]`, `item${i + 1}`, "rate")) bad.push(`${label}: AI was not sure`);
    rows.push({ description: it.description, quantity: qty, unit: unitOf(it.unit, ctx), rate, amount });
  });
  const itemPool = ctx.items.filter((x) => !x.isDeleted);
  const matched = rows.map((r) => {
    const n = normalizeName(r.description.replace(/<[^>]*>/g, " "));
    const exact = itemPool.filter((x) => namesOf(x).some((y) => normalizeName(y) === n));
    if (exact.length === 1) return { ...r, itemId: exact[0].id };
    const best = bestUniqueMatch(n, itemPool, (x) => namesOf(x).map(normalizeName), 0.92, 0.08);
    return best ? { ...r, itemId: best.item.id } : r;
  });

  /* ---- Totals ---- */
  const S = r2(rows.reduce((a, r) => a + r.amount, 0));
  const disc = d.discount ?? 0;
  const sub = d.subtotal;
  const taxable = d.taxable ?? (sub != null ? r2(sub - disc) : rows.length ? r2(S - disc) : null);
  const vatPct = d.vat_percent ?? 13;
  const vat = d.vat_amount;
  const grand = d.grand_total;
  const c1 = sub == null || !rows.length || near(S, sub);
  const c2 = sub == null || taxable == null || near(sub - disc, taxable);
  const c3 = vat == null || (taxable != null && near(taxable * (vatPct / 100), vat));
  const c4 = grand != null && taxable != null && near(taxable + (vat ?? 0), grand);
  const panOk = !d.party_pan || panDigits.length === 9;
  dbg(`AI Totals: S=${S.toFixed(2)} subtotal=${sub ?? "-"} disc=${disc} taxable=${taxable ?? "-"} vat=${vat ?? "-"} (${vatPct}%) grand=${grand ?? "-"} | items ${rows.length - bad.length}/${d.items.length} qty x rate = amount | check1(sum=subtotal)=${c1} check2(subtotal-disc=taxable)=${c2} check3(VAT ${vatPct}%)=${c3} check4(grand)=${c4} | PAN 9 digits=${panOk}`);
  for (const b of bad) dbg(`AI item check: ${b}`);
  const unsureTotals = isUnsure("subtotal", "taxable", "vat_amount", "grand_total", "discount");
  const reconciled = rows.length > 0 && bad.length === 0 && c1 && c2 && c3 && c4 && !unsureTotals;
  const totalsOk = !reconciled && taxable != null && taxable > 0 && c2 && c3 && c4 && !unsureTotals;
  const parserTotal = bill.total?.status === "fill" ? bill.total.value : null;
  const totalNote = !c1 ? `Items sum ${S.toFixed(2)} does not match Sub Total ${sub}` : !c2 ? "Sub Total - Discount does not match Taxable" : !c3 ? `VAT is not ${vatPct}% of Taxable` : !c4 ? "Taxable + VAT does not match Grand Total" : unsureTotals ? unsureNote : "Line items did not reconcile";
  const itemNote = bad.length ? `AI items: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? ` (+${bad.length - 3})` : ""}` : totalNote;

  if (reconciled) {
    bill.lineItems = f(matched, "fill", 0.96);
    bill.subTotal = f(taxable!, "fill", 0.96);
    if (d.discount != null) bill.discount = f(disc, "fill", 0.96);
    if (vat != null) bill.vat = f(vat, "fill", 0.96);
    bill.total = f(grand!, "fill", 0.97);
    bill.amount = f(grand!, "fill", 0.97);
  } else if (totalsOk) {
    bill.subTotal = f(taxable!, "fill", 0.9);
    if (d.discount != null) bill.discount = f(disc, "fill", 0.9);
    if (vat != null) bill.vat = f(vat, "fill", 0.9);
    bill.total = f(grand!, "fill", 0.92);
    bill.amount = f(grand!, "fill", 0.92);
    if (rows.length) bill.lineItems = f(matched, "flag", 0.5, itemNote);
    else if (bill.lineItems?.status === "fill") dbg("AI returned no items - kept text parser items");
  } else {
    if (rows.length) bill.lineItems = f(matched, "flag", 0.5, itemNote);
    if (grand != null) { bill.total = f(grand, "flag", 0.6, totalNote); bill.amount = f(grand, "flag", 0.6, totalNote); }
    if (vat != null) bill.vat = f(vat, "flag", 0.6, totalNote);
    if (d.discount != null) bill.discount = f(disc, "flag", 0.6, totalNote);
    if (taxable != null) bill.subTotal = f(taxable, "flag", 0.6, totalNote);
  }
  if (parserTotal != null && grand != null && !near(parserTotal, grand) && bill.total && !resolvedAmt.preferredWords) {
    bill.total = f(grand, "flag", 0.6, `AI Grand Total ${grand} vs text parser ${parserTotal}`);
    if (bill.amount) bill.amount = { ...bill.total };
    dbg(`AI Grand Total ${grand} disagrees with text parser ${parserTotal} - flagged`);
  }
  if (resolvedAmt.preferredWords && grand != null) {
    const note = `Amount in words ${resolvedAmt.preferredWords.to} preferred over digits ${resolvedAmt.preferredWords.from}`;
    bill.total = f(grand, "fill", 0.9, note);
    bill.amount = f(grand, "fill", 0.9, note);
  }

  /* ---- Document type (relative to our company) ----
   * Only Gemini's explicit voucher_type may replace the parser's classification. */
  const aiType: OcrDocType | null = aiDocTypeOf(d.voucher_type);
  if (aiType) {
    // Keep the parsed voucher type aligned with Gemini's final JSON decision.
    const cur = bill.docType;
    const conf = 0.95;
    if (cur && cur.type !== aiType) dbg(`AI document type ${aiType} replaces text rule guess (${cur.type})`);
    bill.docType = { type: aiType, confidence: cur?.type === aiType ? Math.max(cur.confidence, conf) : conf, reason: `Gemini final: ${d.voucher_type}${d.voucher_type_reason ? ` (${d.voucher_type_reason.slice(0, 100)})` : ""}` };
  }
  /* ---- Per-type field check (server typeCheck, or the same rules here) ---- */
  const tc = ai.typeCheck ?? aiTypeCheck(d);
  if (tc.missing.length) dbg(`AI ${tc.voucher_type ?? "-"}: required field(s) not returned: ${tc.missing.join(", ")}`);
  if (tc.unexpected.length) dbg(`AI ${tc.voucher_type ?? "-"}: field(s) this type does not use were returned (kept for a type change): ${tc.unexpected.join(", ")}`);

  /* ---- Printed due date / credit days (party master + Common Setting are applied later by resolveOcrDueDate) ---- */
  if (d.due_date || d.credit_days) {
    bill.dueTerms = { printedDue: d.due_date, creditDays: d.credit_days };
    dbg(`AI due terms: due ${d.due_date ?? "-"} / credit days ${d.credit_days ?? "-"}`);
  }

  /* ---- Amount cross-checks: Dr = Cr, Grand Total vs items vs amount in words ---- */
  const chk = resolvedAmt.check;
  bill.amountCheck = { ok: chk.ok, reasons: chk.reasons };
  if (!chk.ok) {
    /* Fields are left as they are: the runner applies the "amount mismatch" rule from bill.amountCheck. */
    dbg(`AI amount check failed: ${chk.reasons.join("; ")}`);
  }
  if (d.account_holder_name) dbg(`AI account holder: ${d.account_holder_name}`);
  if (d.transfer_reference) dbg(`AI transfer ref: ${d.transfer_reference}${d.transfer_mode ? ` (${d.transfer_mode})` : ""}${d.transfer_charges ? `, charges ${d.transfer_charges}` : ""}`);
  if (d.notes) dbg(`AI note: ${d.notes.slice(0, 200)}`);
  if (d.uncertain_fields.length) dbg(`AI unsure about: ${d.uncertain_fields.slice(0, 12).join(", ")}`);
}

function unitOf(raw: string | null, ctx: AiApplyContext): string | undefined {
  if (!raw) return undefined;
  return (ctx.normUnit ? ctx.normUnit(raw) : undefined) || raw;
}
