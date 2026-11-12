/**
 * AI (Gemini) engine: the server returns our voucher JSON (structured output). The client maps it onto the bill
 * and re-checks every value (qty x rate = amount, sum = Sub Total, Sub Total - Discount = Taxable, VAT 13%,
 * Taxable + VAT = Grand, PAN 9 digits, AD date vs BS Miti). Mocked answer for Pratik SI-00780 (no network).
 * Build 2026-11-12.3: Gemini returns JSON only (no raw_text); the parser reads a summary built from the JSON; the AI
 * counter-party drives the party match; a clear BS Miti fills even when the AD date is missing / unsure.
 * Run: npx tsx tests/ocr/aiGeminiPratik.selftest.mts
 */
import { parseBill } from "../../src/modules/ocr/parser";
import { rawFromCloudText } from "../../src/modules/ocr/cloud/cloudRaw";
import { aiCounterParty, aiFallbackText, normalizeAiVoucher, type OcrAiResult } from "../../src/modules/ocr/ai/aiVoucher";
import type { OcrRawResult } from "../../src/modules/ocr/types";

let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) {
    fail++;
    for (const d of dbg ?? []) console.log("   dbg:", d);
  }
};

const ITEMS: [string, string | null, number, string, number, number][] = [
  ["HR SHEET 4MM", "7208", 179.5, "KG", 98, 17591],
  ["HR SHEET 2.5MM", "7208", 121.3, "KG", 98, 11887.4],
  ['CHANNEL 4"MEDIUM', null, 49.8, "KG", 89, 4432.2],
  ['CHANNEL 4"S/L', null, 39.7, "KG", 91, 3612.7],
  ['CHANNEL 3"MEDIUM', null, 134.1, "KG", 89, 11934.9],
  ['CHANNEL 3"S/L', null, 73.1, "KG", 91, 6652.1],
  ['CHANNEL 6"X13.5FT', null, 137, "KG", 90, 12330],
  ['MS PIPE RECT 3"X1.5"X3MM', "7306", 64.6, "KG", 97, 6266.2],
  ["ANGLE 40X40X5", null, 35.9, "KG", 85, 3051.5],
  ["PLAIN ROD 20MM", null, 30.5, "KG", 92, 2806],
  ["FLAT 25X5", null, 11.9, "KG", 87, 1035.3],
  ["WELDING ROD 3.2MM", "8311", 4, "PKT", 686, 2744],
];

function gemini(): Record<string, unknown> {
  return {
    doc_type: "purchase",
    our_company_role: "buyer",
    party_name: "PRATIK TRADE CENTER PVT.LTD.",
    party_pan: "619727215",
    party_address: "ITAHARI-5, SUNSARI, NEPAL",
    party_phone: "00977-25-581953 / 00977-25-586624",
    invoice_no: "SI-00780",
    date_ad: "2026-08-12",
    date_bs: "2083-04-27",
    payment_mode: "Credit",
    items: ITEMS.map(([d, hs, q, u, r, a], i) => ({ sn: i + 1, description: d, hs_code: hs, qty: q, unit: u, rate: r, amount: a })),
    subtotal: 84343.3,
    discount: 0,
    taxable: 84343.3,
    vat_percent: 13,
    vat_amount: 10964.63,
    grand_total: 95307.93,
    uncertain_fields: [],
    notes: null,
  };
}

const PROFILE = { name: "New parsa Engineering WorkShop Demo Compnany", pan: "303687786" };
const PARTIES = [
  { id: "party_pratik", name: "Pratik Trade Center Pvt.Ltd Safiullah", aliasName: "PRATIK TRADE CENTER PVT.LTD", pan: "619727215" },
  { id: "party_jay", name: "Jay Syarsekalika Oil Center", pan: "600000001" },
  { id: "purchase_account", name: "Purchase Account" },
];

function rawFor(data: Record<string, unknown>): OcrRawResult {
  const ai: OcrAiResult = {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    data: normalizeAiVoucher(data),
    usage: { promptTokens: 1810, outputTokens: 1240, thoughtsTokens: 0, totalTokens: 3050 },
  };
  const base = rawFromCloudText(aiFallbackText(ai.data), { engine: "gemini", pageWidth: 1364, pageHeight: 1766 });
  return { ...base, engine: "gemini", preprocess: "ai (gemini)", passNote: "model gemini-3.5-flash-lite, tokens in 1810 / out 1240 / total 3050", ai };
}
const parse = (data: Record<string, unknown>, kind: "purchase" | "sale" = "purchase") =>
  parseBill(rawFor(data), { kind, parties: PARTIES, items: [], ownPan: PROFILE.pan, ownName: PROFILE.name });
const ymd = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "-");

/* ---- 1. clean answer: everything fills ---- */
console.log("\n== correct Gemini JSON");
{
  const bill = parse(gemini());
  const dbg = bill.debug ?? [];
  const rows = bill.lineItems?.value ?? [];
  ok(dbg.some((d) => /^OCR pass: ai \(gemini\)/.test(d) && /tokens in 1810/.test(d) && /total 3050/.test(d)), "rule log: 'OCR pass: ai (gemini)' + tokens", dbg);
  ok(rows.length === 12 && bill.lineItems?.status === "fill", `12 line items filled (${rows.length}, ${bill.lineItems?.status})`, dbg);
  ITEMS.forEach(([d, , q, u, r, a], i) => {
    const x = rows[i];
    ok(!!x && x.description === d && Math.abs(x.quantity - q) < 1e-6 && Math.abs(x.rate - r) < 1e-6 && Math.abs(x.amount - a) < 0.005 && (x.unit ?? "").toUpperCase() === u,
      `row ${i + 1}: ${x?.description} ${x?.quantity} ${x?.unit} x ${x?.rate} = ${x?.amount}`);
  });
  ok(bill.subTotal?.status === "fill" && Math.abs((bill.subTotal?.value ?? 0) - 84343.3) < 0.005, `taxable/sub total 84343.30 (${bill.subTotal?.value} ${bill.subTotal?.status})`, dbg);
  ok(bill.discount?.status === "fill" && bill.discount.value === 0, "discount 0 filled");
  ok(bill.vat?.status === "fill" && Math.abs((bill.vat?.value ?? 0) - 10964.63) < 0.005, `VAT 10964.63 (${bill.vat?.value})`);
  ok(bill.total?.status === "fill" && Math.abs((bill.total?.value ?? 0) - 95307.93) < 0.005, `grand total 95307.93 (${bill.total?.value} ${bill.total?.status})`, dbg);
  ok(bill.billNo?.status === "fill" && bill.billNo.value === "SI-00780", `bill no SI-00780 (${bill.billNo?.value} ${bill.billNo?.status})`, dbg);
  ok(bill.pan?.status === "fill" && bill.pan.value === "619727215", `PAN 619727215 (${bill.pan?.value})`);
  ok(bill.date?.status === "fill" && ymd(bill.date.value) === "2026-08-12", `date 2026-08-12 agrees with BS 2083-04-27 (${ymd(bill.date?.value)} ${bill.date?.status} ${bill.date?.note ?? ""})`, dbg);
  ok(bill.partyId?.status === "fill" && bill.partyId.value === "party_pratik", `party matched by PAN (${bill.partyId?.value})`, dbg);
  ok(bill.docType?.type === "purchase", `doc type purchase (${bill.docType?.type})`);
  ok(bill.identifiers?.paymentMode === "Credit" && bill.identifiers?.pan === "619727215", "identifiers: PAN + payment mode");
  ok(dbg.some((d) => /AI Totals:.*check1\(sum=subtotal\)=true check2\(subtotal-disc=taxable\)=true check3\(VAT 13%\)=true check4\(grand\)=true/.test(d)), "rule log: all AI checks true", dbg);
}

/* ---- 2. deliberately wrong amount on row 2 -> items flagged, totals still fill (printed totals agree) ---- */
console.log("\n== wrong amount on row 2 (11987.40 instead of 11887.40)");
{
  const g = gemini();
  (g.items as { amount: number }[])[1].amount = 11987.4;
  const bill = parse(g);
  const dbg = bill.debug ?? [];
  ok(bill.lineItems?.status === "flag", `line items flagged (${bill.lineItems?.status})`, dbg);
  ok(/row 2: 121\.3 x 98 = 11887\.4 but amount 11987\.4/.test(bill.lineItems?.note ?? ""), `flag note names row 2: "${bill.lineItems?.note}"`, dbg);
  ok(dbg.some((d) => /AI item check: row 2/.test(d)) && dbg.some((d) => /check1\(sum=subtotal\)=false/.test(d)), "rule log shows the row 2 check and sum mismatch", dbg);
  ok(bill.total?.status === "fill" && Math.abs((bill.total?.value ?? 0) - 95307.93) < 0.005, `printed totals self-consistent -> grand total still filled (${bill.total?.status})`, dbg);
}

/* ---- 3. wrong VAT -> totals flagged, nothing written ---- */
console.log("\n== wrong VAT (10946.63)");
{
  const g = gemini();
  g.vat_amount = 10946.63;
  const bill = parse(g);
  const dbg = bill.debug ?? [];
  ok(bill.vat?.status === "flag" && bill.total?.status === "flag" && bill.lineItems?.status === "flag", `VAT / total / items flagged (${bill.vat?.status}/${bill.total?.status}/${bill.lineItems?.status})`, dbg);
  ok(/VAT is not 13% of Taxable/.test(bill.total?.note ?? ""), `note: ${bill.total?.note}`);
}

/* ---- 4. bad PAN (8 digits) -> PAN flagged; party still found by the text parser / name ---- */
console.log("\n== PAN with 8 digits");
{
  const g = gemini();
  g.party_pan = "61972721";
  const bill = parse(g);
  ok(bill.pan?.status === "flag" && /9 digits/.test(bill.pan?.note ?? ""), `PAN flagged (${bill.pan?.value} ${bill.pan?.status} ${bill.pan?.note})`, bill.debug);
  ok(bill.debug?.some((d) => /PAN 9 digits=false/.test(d)) === true, "rule log: PAN 9 digits=false", bill.debug);
}

/* ---- 5. Gemini left fields null -> nothing invented (no transcription to fall back on) ---- */
console.log("\n== Gemini null invoice_no / dates");
{
  const g = gemini();
  g.invoice_no = null;
  g.date_ad = null;
  g.date_bs = null;
  g.uncertain_fields = ["invoice_no", "date_ad"];
  const bill = parse(g);
  ok(bill.billNo?.status !== "fill", `bill no not invented (${bill.billNo?.value ?? "-"} ${bill.billNo?.status ?? "-"})`, bill.debug);
  ok(bill.date?.status !== "fill", `date not invented (${ymd(bill.date?.value)} ${bill.date?.status ?? "-"})`, bill.debug);
  ok(bill.lineItems?.status === "fill" && bill.total?.status === "fill", "items + totals still fill", bill.debug);
}/* ---- 6. uncertain field -> flagged even when the value looks fine ---- */
console.log("\n== Gemini unsure about grand_total");
{
  const g = gemini();
  g.uncertain_fields = ["grand_total"];
  const bill = parse(g);
  ok(bill.total?.status === "flag", `grand total flagged when AI is unsure (${bill.total?.status})`, bill.debug);
}

/* ---- 7. own company returned as the party -> ignored (never the party, PAN or create-party name) ---- */
console.log("\n== own company as party");
{
  const g = gemini();
  g.party_pan = "303687786";
  g.party_name = "NEW PARSA ENGINEERING WORKSHOP";
  const bill = parse(g);
  const dbg = bill.debug ?? [];
  ok(bill.pan?.value !== "303687786" && bill.identifiers?.pan !== "303687786" && dbg.some((d) => /our own company PAN - ignored/.test(d)), `own PAN never used (pan=${bill.pan?.value}, ids=${bill.identifiers?.pan})`, dbg);
  ok(!bill.partyName && dbg.some((d) => /is our own company - ignored/.test(d)), `own name never the party (${bill.partyName?.value ?? "-"})`, dbg);
  ok(bill.partyId?.status !== "fill", `no party filled from our own company (${bill.partyId?.value ?? "-"})`, dbg);
}/* ---- 8. normalizer: numbers as strings, junk values ---- */
console.log("\n== normalizer");
{
  const n = normalizeAiVoucher({ items: [{ description: "X", qty: "1,000.5", rate: "Rs. 2", amount: "2,001.00", unit: "" }], grand_total: "N/A", doc_type: "PURCHASE", our_company_role: "Buyer" });
  ok(n.items[0].qty === 1000.5 && n.items[0].rate === 2 && n.items[0].amount === 2001 && n.items[0].unit === null, "string numbers parsed, empty unit -> null");
  ok(n.grand_total === null && n.doc_type === "purchase" && n.our_company_role === "buyer" && Array.isArray(n.uncertain_fields), "junk -> null, enums lower-cased");
}

/* ---- 9. Asian Thai sale bill (2026-11-12 live read): BS-only date, AD unsure; buyer = counter-party ---- */
console.log("\n== Asian Thai sale bill (our company = seller)");
{
  const ROWS: [string, number, number, number][] = [["6mm Sheet Cutting", 35, 150, 5250], ["6mm Sheet Bend", 70, 150, 10500], ["Arc P&P", 48, 175, 8400], ["Circle", 36, 100, 3600], ["Ring", 48, 130, 6240], ["Strips", 48, 80, 3840]];
  const g: Record<string, unknown> = {
    doc_type: "sale", our_company_role: "seller", party_name: "Asian Thai food pvt. Ltd", party_pan: "300097599", party_address: "Sonapur", party_phone: null,
    invoice_no: "09", date_ad: null, date_bs: "2083-05-05", payment_mode: null,
    items: ROWS.map(([d, q, r, a]) => ({ description: d, hs_code: null, qty: q, unit: "P", rate: r, amount: a })),
    subtotal: 37830, discount: 0, taxable: 37830, vat_percent: 13, vat_amount: 4917.9, grand_total: 42747.9,
    uncertain_fields: ["date_ad", "payment_mode"], notes: "Invoice date BS is 2083-05-05.",
  };
  const bill = parse(g, "sale");
  const dbg = bill.debug ?? [];
  const text = aiFallbackText(normalizeAiVoucher(g));
  ok(bill.date?.status === "fill" && ymd(bill.date.value) === "2026-08-21", `BS 2083-05-05 fills 2026-08-21 although AD is unsure (${ymd(bill.date?.value)} ${bill.date?.status} ${bill.date?.note ?? ""})`, dbg);
  ok(bill.partyName?.value === "Asian Thai food pvt. Ltd", `party name = AI buyer (${bill.partyName?.value})`, dbg);
  ok(dbg.some((d) => /^Identifiers \(AI counter-party\): name="Asian Thai food pvt\. Ltd" PAN=300097599/.test(d)), "parser party match used the AI name + PAN", dbg);
  ok(bill.identifiers?.pan === "300097599" && bill.identifiers?.address === "Sonapur", `create-party prefill: PAN + address (${bill.identifiers?.pan} / ${bill.identifiers?.address})`, dbg);
  ok(!bill.partyId?.value, `no wrong party picked (${bill.partyId?.value ?? "none"})`, dbg);
  ok(bill.docType?.type === "sale", `doc type sale (${bill.docType?.type})`, dbg);
  ok(bill.lineItems?.status === "fill" && bill.lineItems.value.length === 6 && bill.total?.status === "fill" && bill.total.value === 42747.9 && bill.vat?.value === 4917.9, `6 items + totals fill (${bill.lineItems?.value.length} ${bill.total?.value} vat ${bill.vat?.value})`, dbg);
  ok(bill.billNo?.value === "09", `bill no 09 (${bill.billNo?.value})`, dbg);
  const lines = text.split("\n");
  ok(lines.length <= 18 && lines[0] === "BUYER NAME : Asian Thai food pvt. Ltd" && lines.includes("INVOICE MITI : 05/05/2083") && !/NEW PARSA/i.test(text), `compact OCR text from JSON (${lines.length} lines)`, lines);
}

/* ---- 10. AI name only (no PAN) -> the parser's alias / name rules match the party ---- */
console.log("\n== AI party name without PAN");
{
  const g = gemini();
  g.party_pan = null;
  g.party_name = "PRATIK TRADE CENTER PVT.LTD";
  const bill = parse(g);
  ok(bill.partyId?.value === "party_pratik", `party matched by AI name (${bill.partyId?.value} ${bill.partyId?.status})`, bill.debug);
}

/* ---- 11. AD + BS present, only AD unsure -> BS decides, still fills ---- */
console.log("\n== AD unsure, BS clear");
{
  const g = gemini();
  g.uncertain_fields = ["date_ad"];
  const bill = parse(g);
  ok(bill.date?.status === "fill" && ymd(bill.date.value) === "2026-08-12", `date fills from BS (${ymd(bill.date?.value)} ${bill.date?.status})`, bill.debug);
}

/* ---- 12. AD only and unsure -> flagged (no BS to confirm) ---- */
console.log("\n== AD only, unsure");
{
  const g = gemini();
  g.date_bs = null;
  g.uncertain_fields = ["date_ad"];
  const bill = parse(g);
  ok(bill.date?.status === "flag", `date flagged (${ymd(bill.date?.value)} ${bill.date?.status})`, bill.debug);
}

/* ---- 13. counter-party helper: phones normalized, own company dropped ---- */
console.log("\n== aiCounterParty");
{
  const cp = aiCounterParty(normalizeAiVoucher(gemini()), PROFILE.pan, PROFILE.name);
  ok(cp.name === "PRATIK TRADE CENTER PVT.LTD." && cp.pan === "619727215" && cp.phones.join(",") === "025-581953,025-586624", `phones ${cp.phones.join(",")}`);
  const own = aiCounterParty(normalizeAiVoucher({ party_name: "New Parsa Engineering Workshop", party_pan: "303687786", party_phone: "9812345678" }), PROFILE.pan, PROFILE.name);
  ok(own.name === null && own.pan === null && own.ownPan && own.ownName && own.phones.length === 0, "own company never returned as party");
  ok(!("raw_text" in normalizeAiVoucher({ raw_text: "x" })), "normalizer drops raw_text");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
if (fail) process.exit(1);
