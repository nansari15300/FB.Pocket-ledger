/**
 * Over-lit / tilted photo of the Pratik Trade Center tax invoice (user report Nov 10: "same bill 2 hai ek me jada
 * light hai"). The fixture text reproduces the failure pattern of the bright photo (the original photo was not
 * available to the worker, so the text is built from the observed OCR damage on a synthetic over-lit copy +
 * the live symptoms): garbage line above the seller name, "Customer Name" label lost, garbled labels
 * ("lnvoice N0", "Invoice Mit1", "Dat3", "Grand Tota1"), our PAN with one confused digit, decimal points read as
 * spaces / commas / dropped ("479,694 80", "542,055,12", "6236032").
 * Before the fix: party = garbage, no Bill No / Date / Total, VAT 6236032. Run: npx tsx tests/ocr/pratikBright.selftest.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBill } from "../../src/modules/ocr/parser";
import { ocrKeyFieldScore, needsEnhancedPass, betterPass } from "../../src/modules/ocr/ocrQuality";
import { panConfusionDistance, textHasOwnPanLoose } from "../../src/modules/ocr/ownCompany";
import { normalizeOcrLine, parseStrictAmount } from "../../src/modules/ocr/normalize";
import { AUTO_SWITCH_MIN_CONF } from "../../src/lib/ocr/receiptDetect/types";
import type { OcrRawResult } from "../../src/modules/ocr/types";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");
let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; for (const d of dbg ?? []) console.log("   dbg:", d); }
};
const raw = (text: string): OcrRawResult => {
  const lines = text.split(/\r?\n/).filter((t) => t.trim());
  return { text, lines: lines.map((t, i) => ({ text: t, confidence: 70, y: 40 + i * 30 })), meanConfidence: 70, pageHeight: 40 + 30 * Math.max(20, lines.length) };
};
const PROFILE = { name: "New parsa Engineering WorkShop Demo Company", pan: "303687786" };
const PRATIK = { id: "p-pratik", name: "Pratik Trade Center Pvt. Ltd.", pan: "619727215" };
const OTHER = { id: "p-other", name: "Sharma Hardware", pan: "609111222" };
const parse = (text: string, parties: any[] = []) =>
  parseBill(raw(text), { kind: "payment_out" as never, parties, items: [], ownPan: PROFILE.pan, ownName: PROFILE.name });
const ymd = (d?: Date) => (d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "-");

/* ---- helpers ---- */
ok(normalizeOcrLine("Invoice No : SI-02833") === "Invoice No : SI-02833", "invoice series prefix SI kept (was 51-02833)");
ok(normalizeOcrLine("Bill No B3-1O") === "Bill No 83-10", "digit confusions still fixed in numeric parts (B3 -> 83)");
ok(parseStrictAmount("62,360,32") === 62360.32 && parseStrictAmount("479,694,80") === 479694.8, "decimal comma amounts");
ok(parseStrictAmount("4,79,694.80") === 479694.8 && parseStrictAmount("1,250") === 1250, "lakh / thousands grouping unchanged");
ok(panConfusionDistance("818727218", "619727215") === 3, "PAN 818727218 vs 619727215: 3 confusable digits");
ok(panConfusionDistance("619727215", "609111222") === Infinity, "unrelated PAN not confusable");
ok(textHasOwnPanLoose("PAN No : 303687788", PROFILE.pan) && !textHasOwnPanLoose("PAN No : 303681186", PROFILE.pan), "own PAN: 1 confused digit tolerated, more not");

/* ---- bright photo text ---- */
const bright = fx("pratik-tax-invoice-bright.txt");
{
  const b = parse(bright);
  const d = b.debug;
  ok(/^.?RATIK TRADE CENTER PVT\.LTD\.$/i.test(b.partyName?.value ?? ""), `party name = seller header line (first letter lost by OCR), not garbage: "${b.partyName?.value}"`, d);
  ok(b.pan?.value === "619727215", `supplier PAN 619727215: ${b.pan?.value}`, d);
  ok(b.billNo?.value === "SI-02833" && b.billNo.status === "fill", `Bill No SI-02833 (label "lnvoice N0"): ${b.billNo?.value} ${b.billNo?.status}`, d);
  ok(ymd(b.date?.value) === "2026-11-01" && b.date?.status === "fill", `Invoice Miti 15/07/2083 -> 2026-11-01: ${ymd(b.date?.value)} ${b.date?.status}`, d);
  ok(b.subTotal?.value === 479694.8 && b.subTotal.status === "fill", `Sub total / Taxable 479,694.80: ${b.subTotal?.value} ${b.subTotal?.status}`, d);
  ok(b.vat?.value === 62360.32 && b.vat.status === "fill", `VAT 6236032 -> 62,360.32: ${b.vat?.value} ${b.vat?.status}`, d);
  ok(b.total?.value === 542055.12 && b.total.status === "fill", `Grand Total 542,055.12: ${b.total?.value} ${b.total?.status}`, d);
  ok((b.discount?.value ?? 0) === 0, `Discount 0: ${b.discount?.value}`);
  ok(b.amount?.value === 542055.12 && b.amount.status === "fill", `Payment amount = grand total: ${b.amount?.value} ${b.amount?.status}`, d);
  ok(/credit/i.test(b.paymentMode ?? ""), `Mode Credit: ${b.paymentMode}`);
  ok(b.docType?.type === "purchase" && (b.docType?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF, `our company is the customer -> purchase: ${b.docType?.type} ${b.docType?.confidence} (${b.docType?.reason})`, d);
  ok((b.lineItems?.value.length ?? 0) >= 2, `line items read: ${b.lineItems?.value.length} (${b.lineItems?.status})`);
}
/* ---- party by PAN: exact, and misread PAN (818727218) -> suggestion only ---- */
{
  const b = parse(bright, [PRATIK, OTHER]);
  ok(b.partyId?.value === "p-pratik" && b.partyId.status === "fill", `party filled by PAN: ${b.partyId?.value} ${b.partyId?.status}`, b.debug);
  const mis = parse(bright.replace("PAN NO : 619727215", "PAN NO : 818727218").replace('"RATIK TRADE CENTER PVT.LTD.', "rar TRADE ar"), [PRATIK, OTHER]);
  ok(mis.partyId?.value === "p-pratik" && mis.partyId.status === "flag", `misread PAN 818727218 -> Pratik suggested (flag): ${mis.partyId?.value} ${mis.partyId?.status}`, mis.debug);
  ok(mis.pan?.value === "619727215" && mis.pan.status === "flag", `PAN shown as master PAN, flagged: ${mis.pan?.value} ${mis.pan?.status}`);
}
/* ---- "Customer Name" label lost: TAX INVOICE title splits seller / buyer (was: Sale 90%) ---- */
{
  const t = bright.replace("lnvoice N0 : SI-02833", "").replace("PAN No : 303687788", "0 : 303687");
  const b = parse(t);
  ok(b.docType?.type === "purchase", `no Customer label, name below TAX INVOICE -> purchase (not sale): ${b.docType?.type} ${b.docType?.reason}`, b.debug);
}
/* ---- engine retry decision ---- */
{
  const qBright = ocrKeyFieldScore("PRATIK TRADE CENTER PVT.LTD.\nPAN NO : 6197272158\nTAX INVOICE\nner Nas NEW PARSA\nSub Total 479,694.80");
  ok(needsEnhancedPass(qBright, 66, "TAX INVOICE"), `bright standard pass (missing ${qBright.missing.join(",")}) -> enhanced retry`);
  const qGood = ocrKeyFieldScore(fx("pratik-tax-invoice-live.txt"));
  ok(!needsEnhancedPass(qGood, 89, fx("pratik-tax-invoice-live.txt")), `good photo (score ${qGood.score}/5) -> no retry`);
  ok(!needsEnhancedPass(ocrKeyFieldScore(fx("connectips-nmb.txt")), 85, fx("connectips-nmb.txt")), "bank slip with good confidence -> no retry");
  const a = { quality: qBright, meanConfidence: 66 }, e = { quality: ocrKeyFieldScore(bright), meanConfidence: 81 };
  ok(betterPass(a, e) === e, `better pass = more key fields (${qBright.score} vs ${e.quality.score})`);
}
/* ---- good photo (A) unchanged ---- */
{
  const b = parse(fx("pratik-tax-invoice-live.txt"));
  ok(b.billNo?.value === "SI-02833" && b.pan?.value === "619727215" && b.total?.value === 47008 && b.docType?.type === "purchase", `photo A fixture unchanged: ${b.billNo?.value} ${b.pan?.value} ${b.total?.value} ${b.docType?.type}`, b.debug);
}

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
