/**
 * Hand-filled Nepali tax invoice (कर बिजक) of OUR company, read by Google Cloud Vision (demo page output, user t82u).
 * Vision put a space between every akshara / digit / letter. Expect: Sale, party = buyer, buyer PAN joined across
 * two lines, BS date, bill no, one item, rupee + paisa columns split (/100) and reconciled.
 * Run: npx tsx tests/ocr/handmadeSaleGoogle.selftest.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBill, detectDocType } from "../../src/modules/ocr/parser";
import { joinSpacedLine, joinSpacedOcrText, isSpacedOcrText, devanagariDigits } from "../../src/lib/ocr/devanagariJoin";
import { amountFromWords, canonicalizeNepaliBill } from "../../src/lib/ocr/nepaliBill";
import { rawFromCloudText } from "../../src/modules/ocr/cloud/cloudRaw";
import { adToBs } from "../../src/lib/bs-date";
import type { OcrRawResult } from "../../src/modules/ocr/types";

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, "fixtures", "handmade-sale-google.txt"), "utf8");
let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; for (const d of dbg ?? []) console.log("   dbg:", d); }
};
const PROFILE = { name: "New parsa Engineering WorkShop Demo Company", pan: "303687786" };
const SHRESTHA = { id: "p-shrestha", name: "Shrestha Oil Supplires", pan: "604031028" };
const OTHER = { id: "p-other", name: "Pratik Trade Center Pvt.Ltd Safiullah", pan: "619727215" };

/* ---- join helpers ---- */
ok(joinSpacedLine("क र वि ज क") === "करविजक", "Devanagari aksharas re-joined");
ok(joinSpacedLine("ज म्मा") === "जम्मा", "conjunct akshara joined (ज म्मा)");
ok(joinSpacedLine("4 4 2 4 7 7 9") === "4424779", "spaced digits joined");
ok(joinSpacedLine("क र दा ता द र्ता नं . ३ ० ३ ६ ८ ७ ७ ८ ६") === "करदातादर्तानं. 303687786", "Devanagari digits -> ASCII number");
ok(joinSpacedLine("मि ति : 2 0 / 0 5 / 2 0 8 3") === "मिति: 20/05/2083", "spaced date joined");
ok(joinSpacedLine("S h r e s t h a O i l S u p p f i r e s .") === "Shrestha Oil Suppfires.", "Latin letters joined, words split at capitals");
ok(devanagariDigits("१३") === "13", "Devanagari digits ०-९");
ok(isSpacedOcrText(text) && !isSpacedOcrText("PRATIK TRADE CENTER\nTAX INVOICE\nInvoice No: SI-02833\nNepali Date: 15/07/2083\nPAN: 123456789\nGrand Total 542055.12"), "spaced-layout detection (normal text untouched)");
ok(!joinSpacedOcrText("Invoice No: SI-02833 Grand Total 542055.12").joined, "normal text not re-joined");
ok(amountFromWords("Fiftythousandong.") === 50000 && amountFromWords("One lakh twenty five thousand only") === 125000, "amount in words");
ok(canonicalizeNepaliBill(["PRATIK TRADE CENTER", "Invoice No: SI-02833", "Grand Total 542055.12"]).applied === false, "English bill not canonicalized");

/* ---- full parse ---- */
const parse = (raw: OcrRawResult, parties: any[] = []) =>
  parseBill(raw, { kind: "sale", parties, items: [], ownPan: PROFILE.pan, ownName: PROFILE.name });
const ymdBs = (d?: Date) => {
  if (!d || Number.isNaN(d.getTime())) return "-";
  const b: any = adToBs(d);
  const y = b.year ?? b.y, m = b.month ?? b.m, dd = b.day ?? b.date ?? b.d;
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};
for (const [label, raw] of [
  ["engine path (rawFromCloudText)", rawFromCloudText(text, { engine: "google" })],
  ["raw Vision text straight to parser", { text, lines: text.split(/\r?\n/).filter((t) => t.trim()).map((t, i) => ({ text: t, confidence: 90, y: 40 + i * 30 })), meanConfidence: 90, pageHeight: 2000 } as OcrRawResult],
] as const) {
  for (const parties of [[], [SHRESTHA, OTHER]]) {
    const tag = `[${label}${parties.length ? ", party master" : ""}]`;
    const b = parse(raw, parties);
    const d = b.debug;
    ok(b.docType?.type === "sale", `${tag} Sale (our PAN on seller side): ${b.docType?.type} ${b.docType?.reason ?? ""}`, d);
    ok(/^Shrestha Oil Supp[fl]ires$/.test(b.partyName?.value ?? ""), `${tag} party name = buyer: "${b.partyName?.value}"`, d);
    ok(b.pan?.value === "604031028", `${tag} buyer PAN 604031028 (split over 2 lines): ${b.pan?.value}`, d);
    if (parties.length) ok(b.partyId?.value === SHRESTHA.id && b.partyId.status === "fill", `${tag} party matched by PAN: ${b.partyId?.value} ${b.partyId?.status}`, d);
    else ok(!b.partyId || b.partyId.status !== "fill", `${tag} no master -> no fill (create suggestion)`, d);
    ok(b.billNo?.value === "13", `${tag} bill no 13: ${b.billNo?.value} ${b.billNo?.status}`, d);
    ok(ymdBs(b.date?.value) === "2083-05-20", `${tag} date BS 2083-05-20: ${ymdBs(b.date?.value)} ${b.date?.status}`, d);
    const li = b.lineItems?.value ?? [];
    ok(li.length === 1, `${tag} 1 item: ${li.length}`, d);
    ok(li[0]?.description.replace(/\s+/g, "") === "टैंकीबनाएको", `${tag} item 'टैंकी बनाएको': "${li[0]?.description}"`, d);
    ok(li[0]?.quantity === 1 && /pcs/i.test(li[0]?.unit ?? "") && li[0]?.rate === 44247.79 && li[0]?.amount === 44247.79, `${tag} qty 1 pcs rate 44247.79: ${li[0]?.quantity} ${li[0]?.unit} ${li[0]?.rate} ${li[0]?.amount}`, d);
    ok(b.subTotal?.value === 44247.79, `${tag} subtotal/taxable 44247.79: ${b.subTotal?.value} ${b.subTotal?.status}`, d);
    ok(b.vat?.value === 5752.21, `${tag} VAT 13% 5752.21: ${b.vat?.value} ${b.vat?.status}`, d);
    ok(b.total?.value === 50000 && b.total.status === "fill", `${tag} total 50000.00: ${b.total?.value} ${b.total?.status}`, d);
  }
}
void detectDocType;
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
