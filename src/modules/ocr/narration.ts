import { format } from "date-fns";
import { formatBsFromAD } from "@/lib/bs-date";
import type { ADFormatKey, BSFormatKey } from "@/lib/dateFormatOptions";

/** Build the voucher narration written by OCR (full vs short). */
export type OcrNarrationStyle = "full" | "short";

export type OcrNarrationInput = {
  style: OcrNarrationStyle;
  /** purchase / sale / payment_out / payment_in / contra / direct_expense / direct_income / ... */
  voucherType?: string | null;
  billNo?: string | null;
  partyName?: string | null;
  /** Already formatted in the form's current date mode (BS or AD as shown on the voucher). */
  dateText?: string | null;
  /** Full-style item list, including the "Items: " prefix, e.g. "Items: HR SHEET 4MM 179.5 Pcs x 98". */
  itemsText?: string | null;
  /** Money-voucher full narration (receiptNarration). Used only when style is full. */
  receiptFull?: string | null;
  fromName?: string | null;
  toName?: string | null;
};

function clean(s?: string | null): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function typeKey(t?: string | null): string {
  return String(t ?? "").toLowerCase().replace(/[\s-]+/g, "_");
}

/** Short-narration verb phrase before the party ("Pur from", "Sale to", ...). Empty if none. */
export function shortNarrationVerb(voucherType?: string | null): string {
  const t = typeKey(voucherType);
  if (t === "sale" || t === "sales" || t === "direct_income") return "Sale to";
  if (t === "purchase" || t === "purchases") return "Pur from";
  if (t === "payment_in" || t === "receipt" || t === "paymentin") return "Receipt from";
  if (t === "payment_out" || t === "payment" || t === "paymentout" || t === "direct_expense") return "Payment to";
  if (t === "contra") return "Contra";
  return "";
}

function shortPartyPhrase(voucherType: string | undefined | null, partyName: string, fromName: string, toName: string): string {
  const verb = shortNarrationVerb(voucherType);
  const t = typeKey(voucherType);
  if (t === "contra") {
    const bits = ["Contra"];
    if (fromName) bits.push("from", fromName);
    if (toName) bits.push("to", toName);
    return bits.join(" ");
  }
  if (verb && partyName) return `${verb} ${partyName}`;
  if (partyName) return partyName;
  return verb;
}

/**
 * Full narration keeps the current bill wording (items + "Bill No: … | party | OCR").
 * Short narration is "Bill No SI-00780 Pur from <party> on <date>" (missing parts skipped).
 */
export function buildOcrNarration(input: OcrNarrationInput): string {
  const style: OcrNarrationStyle = input.style === "short" ? "short" : "full";
  const billNo = clean(input.billNo);
  const party = clean(input.partyName);
  const dateText = clean(input.dateText);
  const itemsText = clean(input.itemsText);
  const receiptFull = clean(input.receiptFull);
  const fromName = clean(input.fromName);
  const toName = clean(input.toName);

  if (style === "short") {
    const parts: string[] = [];
    if (billNo) parts.push(`Bill No ${billNo}`);
    const mid = shortPartyPhrase(input.voucherType, party, fromName, toName);
    if (mid) parts.push(mid);
    if (dateText) parts.push(`on ${dateText}`);
    return parts.join(" ");
  }

  if (receiptFull) return receiptFull;

  const bits: string[] = [];
  if (itemsText) bits.push(itemsText.startsWith("Items:") ? itemsText : `Items: ${itemsText}`);
  const tail = [`${billNo ? `Bill No: ${billNo}` : ""}`, party, "OCR"].filter(Boolean);
  if (billNo || party) bits.push(tail.join(" | "));
  return bits.join(" | ");
}

export function itemsNarrationTag(rows: { description: string; quantity: number | string; unit?: string; rate: number | string }[]): string {
  if (!rows.length) return "";
  return `Items: ${rows.map((r) => `${r.description} ${r.quantity}${r.unit ? " " + r.unit : ""} x ${r.rate}`).join("; ")}`;
}


const DEFAULT_AD: ADFormatKey = "MM-dd-yyyy";
const DEFAULT_BS: BSFormatKey = "MMM DD, YYYY";

/** Format a Date the way the voucher date field does (company/localStorage calendar + format). */
export function formatOcrNarrationDate(
  date: Date,
  prefs?: { dateSystem?: string | null; dateFormatAD?: string | null; dateFormatBS?: string | null },
): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const sys = prefs?.dateSystem === "AD" || prefs?.dateSystem === "BS" || prefs?.dateSystem === "Both" ? prefs.dateSystem : "BS";
  const adFmt = (prefs?.dateFormatAD || DEFAULT_AD) as ADFormatKey;
  const bsFmt = (prefs?.dateFormatBS || DEFAULT_BS) as BSFormatKey;
  let ad = "";
  try { ad = format(date, adFmt); } catch { ad = format(date, DEFAULT_AD); }
  let bs = "";
  try { bs = formatBsFromAD(date, bsFmt); } catch { bs = formatBsFromAD(date, DEFAULT_BS); }
  if (sys === "AD") return ad;
  if (sys === "Both") return bs ? `${bs} (${ad})` : ad;
  return bs || ad;
}

export function readDateDisplayPrefs(): { dateSystem?: string; dateFormatAD?: string; dateFormatBS?: string } {
  try {
    if (typeof localStorage === "undefined") return {};
    return {
      dateSystem: localStorage.getItem("dateSystem") ?? undefined,
      dateFormatAD: localStorage.getItem("dateFormatAD") ?? undefined,
      dateFormatBS: localStorage.getItem("dateFormatBS") ?? undefined,
    };
  } catch {
    return {};
  }
}
