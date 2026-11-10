/**
 * Key-field score of a raw OCR text (ACR). Pure. The engine uses it to decide whether the standard pass is good
 * enough or an enhanced retry pass (flat-field + deskew, preprocessOps.ts) is needed, and to pick the better pass.
 * Checks only what a bill needs: Bill/Invoice No with a value, a date, a 9-digit PAN, VAT and Grand Total amounts.
 */
import { amountsInLine, normalizeOcrLine } from "./normalize";

export type OcrKeyField = "billNo" | "date" | "pan" | "vat" | "total";
export type OcrQuality = { score: number; found: OcrKeyField[]; missing: OcrKeyField[] };

const BILL = /\b(?:bill|[il1|]nv(?:oice)?|receipt|ref)\.?\s*(?:n[o0]|number|#|mo)\b\.?\s*[:.;#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,24})/i;
const DATE = /(?<!\d)(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})(?!\d)/;
const PAN = /\b(?:pan|vat)\b[^\n\d]{0,20}(?<!\d)(\d[\d\s-]{8,12})/i;
const VAT = /\bvat\b(?!\s*(?:no|reg|number))[^\n]*/i;
const TOTAL = /\b(?:gr[a@]nd\s*t[o0]t[a@][l1i]|net\s*(?:amount|total|payable)|total\s*amount|bill\s*amount|invoice\s*total)\b[^\n]*/i;

function hasAmount(line: string): boolean {
  return amountsInLine(normalizeOcrLine(line.replace(/\b\d{1,2}(\.\d+)?\s*%/g, " "))).some((n) => n >= 1);
}

export function ocrKeyFieldScore(text: string): OcrQuality {
  const t = String(text ?? "");
  const found: OcrKeyField[] = [];
  const b = BILL.exec(t)?.[1];
  if (b && /\d/.test(b)) found.push("billNo");
  if (DATE.test(t)) found.push("date");
  const p = PAN.exec(t)?.[1]?.replace(/\D/g, "");
  if (p && p.length === 9) found.push("pan");
  const v = t.split(/\r?\n/).find((l) => VAT.test(l) && hasAmount(l.slice(l.search(/\bvat\b/i) + 3)));
  if (v) found.push("vat");
  const g = t.split(/\r?\n/).find((l) => TOTAL.test(l) && hasAmount(l));
  if (g) found.push("total");
  const all: OcrKeyField[] = ["billNo", "date", "pan", "vat", "total"];
  return { score: found.length, found, missing: all.filter((k) => !found.includes(k)) };
}

/**
 * Standard pass needs a retry when tesseract is unsure (mean confidence < 70) or an invoice-like text misses key
 * fields (bank slips / handwritten vouchers have no Bill No / VAT, so they only retry on low confidence).
 */
export function needsEnhancedPass(q: OcrQuality, meanConfidence: number, text = ""): boolean {
  if (meanConfidence < 70) return true;
  const invoiceLike = /\b(tax\s*invoice|invoice|vat|taxable|grand\s*total|pan\s*n[o0])\b/i.test(text);
  return invoiceLike && q.score < 4;
}

/** Pick the better of two passes: more key fields first, then mean confidence. */
export function betterPass<T extends { quality: OcrQuality; meanConfidence: number }>(a: T, b: T): T {
  if (b.quality.score !== a.quality.score) return b.quality.score > a.quality.score ? b : a;
  return b.meanConfidence > a.meanConfidence + 2 ? b : a;
}
