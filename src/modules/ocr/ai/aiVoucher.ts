/**
 * AI (Gemini) voucher JSON -> the same OcrParsedBill the voucher fill uses.
 *
 * Gemini's JSON schema guarantees the SHAPE, not the VALUES, so every value is re-checked here with our own rules:
 *   qty x rate = amount (per item), sum(items) = Sub Total, Sub Total - Discount = Taxable, Taxable x VAT% = VAT,
 *   Taxable + VAT = Grand Total, PAN = 9 digits (never our own PAN), AD date agrees with the BS Miti.
 * A field is "fill" only when its checks pass; otherwise "flag" (shown in the bubbles / "OCR could not find" flow, not written).
 * Gemini returns ONLY the voucher JSON (no transcription: saves output tokens). The text the classic parser and
 * "Show OCR text" see is a compact summary built from that JSON (aiFallbackText); nothing is invented.
 * Party fields are the counter-party only (aiCounterParty: buyer on our sale, seller on our purchase, never us).
 * Pure (no React / network) so the selftests can run it.
 */
import { defaultVoucherDateWindow, resolveBillDate } from "@/lib/ocr/dates";
import { bestUniqueMatch, namesOf } from "../fuzzy";
import { normalizeName } from "../normalize";
import { isOcrSelectableParty } from "../types";
import type { OcrDocType, OcrField, OcrItemLike, OcrLineItem, OcrParsedBill, OcrPartyLike } from "../types";

export type OcrAiDocType = "purchase" | "sale" | "receipt" | "payment" | "expense" | "other";
export type OcrAiItem = {
  sn: number | null;
  description: string;
  hs_code: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
};
export type OcrAiVoucher = {
  doc_type: OcrAiDocType | null;
  our_company_role: "buyer" | "seller" | "none" | null;
  party_name: string | null;
  party_pan: string | null;
  party_address: string | null;
  party_phone: string | null;
  invoice_no: string | null;
  date_ad: string | null;
  date_bs: string | null;
  payment_mode: string | null;
  items: OcrAiItem[];
  subtotal: number | null;
  discount: number | null;
  taxable: number | null;
  vat_percent: number | null;
  vat_amount: number | null;
  grand_total: number | null;
  uncertain_fields: string[];
  notes: string | null;
};
export type OcrAiUsage = { promptTokens: number; outputTokens: number; thoughtsTokens: number; totalTokens: number };
export type OcrAiResult = { provider: "gemini"; model: string; data: OcrAiVoucher; usage: OcrAiUsage; /** Taught rules the server added to the prompt. */ rulesUsed?: number };

const DOC_TYPES: readonly OcrAiDocType[] = ["purchase", "sale", "receipt", "payment", "expense", "other"];

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && !/^(null|n\/?a|-+)$/i.test(s) ? s : null;
}

/** "17,591.00" / "Rs. 1,035.30" / 179.5 -> number; anything else -> null. */
export function aiNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/rs\.?|npr|\/-|,|\s/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Coerce whatever the server returned into OcrAiVoucher (never throws). */
export function normalizeAiVoucher(raw: unknown): OcrAiVoucher {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dt = str(o.doc_type)?.toLowerCase() as OcrAiDocType | undefined;
  const role = str(o.our_company_role)?.toLowerCase();
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    doc_type: dt && DOC_TYPES.includes(dt) ? dt : null,
    our_company_role: role === "buyer" || role === "seller" || role === "none" ? role : null,
    party_name: str(o.party_name),
    party_pan: str(o.party_pan),
    party_address: str(o.party_address),
    party_phone: str(o.party_phone),
    invoice_no: str(o.invoice_no),
    date_ad: str(o.date_ad),
    date_bs: str(o.date_bs),
    payment_mode: str(o.payment_mode),
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
  const bs = toDmy(d.date_bs);
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
  return L.join("\n");
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

const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const f = <T,>(value: T, status: "fill" | "flag", confidence: number, note?: string): OcrField<T> => ({ value, status, confidence, ...(note ? { note } : {}) });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2026-08-12" / "2083/04/27" -> "12/08/2026" (the printed Nepali layout our date resolver reads). */
function toDmy(s: string | null): string | null {
  const m = String(s ?? "").match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}`;
  const d = String(s ?? "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return d ? `${d[1].padStart(2, "0")}/${d[2].padStart(2, "0")}/${d[3]}` : null;
}

/** Map + validate Gemini's answer onto the bill parsed from its raw_text. Mutates `bill`. */
export function applyAiToBill(bill: OcrParsedBill, ai: OcrAiResult, ctx: AiApplyContext): void {
  const d = ai.data;
  if (!bill.debug) bill.debug = [];
  const dbg = (m: string) => bill.debug!.push(m);
  const unsure = new Set(d.uncertain_fields.map((x) => x.toLowerCase().replace(/\s+/g, "")));
  const isUnsure = (...keys: string[]) => keys.some((k) => unsure.has(k));
  const unsureNote = "AI was not sure - please confirm";
  const u = ai.usage;
  dbg(`AI (gemini): model ${ai.model || "-"}; tokens in ${u.promptTokens} / out ${u.outputTokens}${u.thoughtsTokens ? ` / thinking ${u.thoughtsTokens}` : ""} / total ${u.totalTokens}`);

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
  if (d.date_ad || d.date_bs) {
    const bs = toDmy(d.date_bs);
    const bsUnsure = isUnsure("date_bs", "date", "miti");
    const adUnsure = isUnsure("date_ad");
    const adDropped = !!d.date_ad && adUnsure && !!bs && !bsUnsure;
    const ad = adDropped ? null : toDmy(d.date_ad);
    const text = [ad ? `INVOICE DATE : ${ad}` : "", bs ? `INVOICE MITI : ${bs}` : ""].filter(Boolean).join("\n");
    const res = text ? resolveBillDate(text, defaultVoucherDateWindow()) : null;
    if (res) {
      const unsureHit = (bsUnsure && !!bs) || (adUnsure && !!ad);
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

  /* ---- Party match (existing rules: PAN exact, then strict unique name) ---- */
  const pool = ctx.parties.filter(isOcrSelectableParty);
  const panOf = (p: OcrPartyLike) => [p.pan, p.panNo, p.vatNo].map((x) => String(x ?? "").replace(/\D/g, "")).filter(Boolean);
  if (pan) {
    const hits = pool.filter((p) => panOf(p).includes(pan!));
    if (hits.length === 1) {
      if (bill.partyId?.value && bill.partyId.value !== hits[0].id) dbg(`AI Party: PAN ${pan} -> "${hits[0].name}" replaces text parser pick`);
      bill.partyId = f(hits[0].id, "fill", 0.99);
      dbg(`AI Party: "${hits[0].name}" by PAN ${pan}`);
    } else if (hits.length > 1) bill.partyId = f("", "flag", 0.5, "Several parties share this PAN");
  }
  if (bill.partyId?.status !== "fill" && cp.name) {
    const best = bestUniqueMatch(normalizeName(cp.name), pool, (p) => namesOf(p).map(normalizeName), 0.95, 0.1);
    if (best) { bill.partyId = f(best.item.id, "fill", best.score); dbg(`AI Party: "${best.item.name}" by name (${Math.round(best.score * 100)}%)`); }
  }

  /* ---- Items: qty x rate = amount ---- */
  const rows: OcrLineItem[] = [];
  const bad: string[] = [];
  d.items.forEach((it, i) => {
    let qty = it.qty;
    const rate = it.rate;
    const amount = it.amount;
    const label = `row ${it.sn ?? i + 1}`;
    if (amount == null || amount <= 0) { bad.push(`${label}: no amount`); return; }
    if (qty == null && rate) { qty = r2(amount / rate); bad.push(`${label}: qty missing (derived ${qty})`); }
    if (qty == null || rate == null) { bad.push(`${label}: qty/rate missing`); rows.push({ description: it.description, quantity: qty ?? 1, unit: unitOf(it.unit, ctx), rate: rate ?? amount, amount }); return; }
    if (!near(qty * rate, amount, Math.max(1, amount * 0.002))) bad.push(`${label}: ${qty} x ${rate} = ${r2(qty * rate)} but amount ${amount}`);
    else if (isUnsure(`items[${i}]`, `items[${i + 1}]`, `item${i + 1}`)) bad.push(`${label}: AI was not sure`);
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
  if (parserTotal != null && grand != null && !near(parserTotal, grand) && bill.total) {
    bill.total = f(grand, "flag", 0.6, `AI Grand Total ${grand} vs text parser ${parserTotal}`);
    if (bill.amount) bill.amount = { ...bill.total };
    dbg(`AI Grand Total ${grand} disagrees with text parser ${parserTotal} - flagged`);
  }

  /* ---- Document type (relative to our company) ---- */
  const aiType: OcrDocType | null =
    d.our_company_role === "buyer" ? "purchase" : d.our_company_role === "seller" ? "sale"
    : d.doc_type === "receipt" ? "payment_in" : d.doc_type === "payment" ? "payment_out"
    : d.doc_type === "purchase" || d.doc_type === "expense" ? "purchase" : d.doc_type === "sale" ? "sale" : null;
  if (aiType) {
    // The text rules only saw the summary built from this same answer, so the AI's role decides.
    const cur = bill.docType;
    const conf = d.our_company_role === "buyer" || d.our_company_role === "seller" ? 0.95 : 0.9;
    if (cur && cur.type !== aiType) dbg(`AI document type ${aiType} replaces text rule guess (${cur.type})`);
    bill.docType = { type: aiType, confidence: cur?.type === aiType ? Math.max(cur.confidence, conf) : conf, reason: `AI: ${d.doc_type ?? "-"}, our company = ${d.our_company_role ?? "-"}` };
  }
  if (d.notes) dbg(`AI note: ${d.notes.slice(0, 200)}`);
  if (d.uncertain_fields.length) dbg(`AI unsure about: ${d.uncertain_fields.slice(0, 12).join(", ")}`);
}

function unitOf(raw: string | null, ctx: AiApplyContext): string | undefined {
  if (!raw) return undefined;
  return (ctx.normUnit ? ctx.normUnit(raw) : undefined) || raw;
}
