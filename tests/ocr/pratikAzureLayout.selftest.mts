/**
 * Azure Read returns each tax-invoice table cell as its own line. The hook maps those
 * lines to Google-like pages with bounding boxes; rawFromCloudText groups cells that
 * share a y-row so the bill parser sees "366.000 KG x 102 = 37,332.00" (QTY, not ALT QTY).
 * Run: npx tsx tests/ocr/pratikAzureLayout.selftest.mts
 */
import { parseBill } from "../../src/modules/ocr/parser";
import { rawFromCloudText } from "../../src/modules/ocr/cloud/cloudRaw";
import type { OcrRawResult } from "../../src/modules/ocr/types";

let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) {
    fail++;
    for (const d of dbg ?? []) console.log("   dbg:", d);
  }
};

const PAGE_W = 1860;
const PAGE_H = 2284;
const COL = { sn: 40, hs: 130, desc: 280, alt: 980, qty: 1180, uom: 1320, rate: 1460, amt: 1640 } as const;
const CW = { sn: 70, hs: 120, desc: 660, alt: 170, qty: 120, uom: 80, rate: 130, amt: 180 } as const;

function verts(x: number, y: number, w: number, h = 22) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function cell(text: string, x: number, y: number, w: number, h = 22) {
  const box = { vertices: verts(x, y, w, h) };
  return {
    boundingBox: box,
    paragraphs: [{
      text,
      boundingBox: box,
      words: [{ text, confidence: 0.96, boundingBox: box, symbols: [{ text, confidence: 0.96 }] }],
    }],
  };
}

type Item = { sn: string; hs?: string; desc: string; alt: string; qty: string; uom: string; rate: string; amt: string | string[] };

const items: Item[] = [
  { sn: "1", hs: "7208", desc: "HR SHEET 4MM", alt: "4.000 PCS", qty: "366.000", uom: "KG", rate: "102.00", amt: "37,332.00" },
  { sn: "2", hs: "7208", desc: "HR SHEET 2.5MM", alt: "2.000 PCS", qty: "120.500", uom: "KG", rate: "102.00", amt: "12,291.00" },
  { sn: "3", desc: "CHANNEL 4\" MD", alt: "2.000 PCS", qty: "98.800", uom: "KG", rate: "93.00", amt: "9,188.40" },
  { sn: "4", desc: "CHANNEL 4\"SL", alt: "1.000 PCS", qty: "39,800", uom: "KG", rate: "95.00", amt: "3,781.00" },
  { sn: "5", desc: "CHANNEL 3\" MD", alt: "10.000 PCS", qty: "337.100", uom: "KG", rate: "93.00", amt: "31,350.30" },
  { sn: "6", desc: "CHANNEL 3\" SL", alt: "8.000 PCS", qty: "200.200", uom: "KG", rate: "95.00", amt: "19,019.00" },
  { sn: "7", desc: "PLAIN ROD 8MM", alt: "3.000 PCS", qty: "4.400", uom: "KG", rate: "100.00", amt: "440.00" },
  { sn: "B", desc: "PLAIN ROD 32MM", alt: "1.000 PCS", qty: "37.700", uom: "KG", rate: "105.00", amt: "3,958.50" },
  { sn: "9", desc: "FLAT 25X5", alt: "1.000 PCS", qty: "11.300", uom: "KG", rate: "91.00", amt: "1,028.30" },
  { sn: "10", desc: "ANGLE 40X40X5", alt: "2.000 PCS", qty: "34.800", uom: "KG", rate: "89.00", amt: ["3,097", "20"] },
  { sn: "11", hs: "7306", desc: "MS PIPE RECT 3\"X1.5\" X3MM", alt: "4.000 PCS", qty: "129.800", uom: "KG", rate: "102.00", amt: "13,239.60" },
  { sn: "12", desc: "CHANNEL 6\"X13FT", alt: "4.000 PCS", qty: "272.200", uom: "KG", rate: "94.00", amt: "25,586.80" },
  { sn: "13", hs: "8311", desc: "WELDING ROD 3.2MM", alt: "2.000 CTN", qty: "8.000", uom: "PKT", rate: "697.00", amt: "5,576.00" },
  { sn: "14", hs: "8311", desc: "WELDING ROD 2.5MM", alt: "CTN", qty: "1.000", uom: "PKT", rate: "753.00", amt: "753.00" },
];

const blocks: object[] = [];
const texts: string[] = [
  "PRATIK TRADE CENTER PVT.LTD.",
  "TAX INVOICE",
  "CUSTOMER NAME : NEW PARSA ENGINEERING WORKSHOP",
  "INVOICE DATE : 05/09/2026",
  "PAN NO. : 619727215",
];
let y = 40;
for (const t of texts) {
  blocks.push(cell(t, 40, y, 800));
  y += 36;
}
const headY = 800;
blocks.push(cell("S.N.", COL.sn, headY, CW.sn));
blocks.push(cell("HS CODE", COL.hs, headY, CW.hs));
blocks.push(cell("PARTICULARS", COL.desc, headY, CW.desc));
blocks.push(cell("ALT QTY", COL.alt, headY, CW.alt));
blocks.push(cell("QTY", COL.qty, headY, CW.qty));
blocks.push(cell("UOM", COL.uom, headY, CW.uom));
blocks.push(cell("RATE", COL.rate, headY, CW.rate));
blocks.push(cell("AMOUNT", COL.amt, headY, CW.amt));

items.forEach((it, i) => {
  const ry = 850 + i * 40;
  blocks.push(cell(it.sn, COL.sn, ry, CW.sn));
  if (it.hs) blocks.push(cell(it.hs, COL.hs, ry, CW.hs));
  blocks.push(cell(it.desc, COL.desc, ry, CW.desc));
  blocks.push(cell(it.alt, COL.alt, ry, CW.alt));
  blocks.push(cell(it.qty, COL.qty, ry, CW.qty));
  blocks.push(cell(it.uom, COL.uom, ry, CW.uom));
  blocks.push(cell(it.rate, COL.rate, ry, CW.rate));
  const amts = Array.isArray(it.amt) ? it.amt : [it.amt];
  amts.forEach((a, k) => blocks.push(cell(a, COL.amt + k * 70, ry, 70)));
});

const footY = 850 + items.length * 40 + 40;
blocks.push(cell("44.00", COL.rate, footY, CW.rate));
blocks.push(cell("1,661.60", COL.amt, footY, CW.amt));
blocks.push(cell("SUB TOTAL", COL.desc, footY + 40, 300));
blocks.push(cell("166,641.10", COL.amt, footY + 40, CW.amt));
blocks.push(cell("DISCOUNT", COL.desc, footY + 80, 300));
blocks.push(cell("0.00", COL.amt, footY + 80, CW.amt));
blocks.push(cell("TAXABLE AMOUNT", COL.desc, footY + 120, 300));
blocks.push(cell("166,641.10", COL.amt, footY + 120, CW.amt));
blocks.push(cell("VAT 13%", COL.desc, footY + 160, 300));
blocks.push(cell("21,663.34", COL.amt, footY + 160, CW.amt));
blocks.push(cell("GRAND TOTAL", COL.desc, footY + 200, 300));
blocks.push(cell("188,304.44", COL.amt, footY + 200, CW.amt));

const pages = [{ text: "", width: PAGE_W, height: PAGE_H, blocks }];
const raw: OcrRawResult = rawFromCloudText("", { engine: "azure", pages, pageWidth: PAGE_W, pageHeight: PAGE_H, note: "fixture" });

ok((raw.pageWidth ?? 0) === PAGE_W && (raw.pageHeight ?? 0) === PAGE_H, `page size ${raw.pageWidth}x${raw.pageHeight}`);
const header = raw.lines.find((l) => /PARTICULARS/i.test(l.text) && /QTY/i.test(l.text));
ok(!!header && (header.words?.length ?? 0) >= 6, `header row grouped: "${header?.text ?? ""}" words=${header?.words?.length ?? 0}`);
const firstRow = raw.lines.find((l) => /HR SHEET 4MM/i.test(l.text));
ok(!!firstRow && /366\.000/.test(firstRow!.text) && /4\.000 PCS/.test(firstRow!.text), `first item row: "${firstRow?.text ?? ""}`);

const PROFILE = { name: "New parsa Engineering WorkShop Demo Compnany", pan: "303687786" };
const bill = parseBill(raw, { kind: "purchase", parties: [], items: [], ownPan: PROFILE.pan, ownName: PROFILE.name });
const rows = bill.lineItems?.value ?? [];
ok(rows.length === 14 && bill.lineItems?.status === "fill", `14 line items filled: ${rows.length} (${bill.lineItems?.status})`, bill.debug);
const r0 = rows[0];
ok(!!r0 && Math.abs(r0.quantity - 366) < 0.001 && Math.abs(r0.rate - 102) < 0.001 && Math.abs(r0.amount - 37332) < 0.05, `row1 QTY 366 KG x 102 = 37332 (not ALT QTY 4): qty=${r0?.quantity} rate=${r0?.rate} amt=${r0?.amount} unit=${r0?.unit}`, bill.debug);
ok(!!r0 && Math.abs(r0.quantity - 4) > 1, "row1 did not take ALT QTY 4.000 PCS as quantity");
const r4 = rows[3];
ok(!!r4 && Math.abs(r4.quantity - 39.8) < 0.01 && Math.abs(r4.rate - 95) < 0.001 && Math.abs(r4.amount - 3781) < 0.05, `row4 39,800 -> 39.8 x 95 = 3781: qty=${r4?.quantity} amt=${r4?.amount}`, bill.debug);
const r10 = rows[9];
ok(!!r10 && Math.abs(r10.amount - 3097.2) < 0.05 && Math.abs(r10.quantity - 34.8) < 0.01, `row10 amount "3,097 20" -> 3097.20: qty=${r10?.quantity} amt=${r10?.amount}`, bill.debug);
ok(bill.subTotal?.value === 166641.1 && bill.subTotal.status === "fill", `Sub total 166,641.10: ${bill.subTotal?.value} ${bill.subTotal?.status}`, bill.debug);
ok(bill.vat?.value === 21663.34 && bill.vat.status === "fill", `VAT 21,663.34: ${bill.vat?.value} ${bill.vat?.status}`, bill.debug);
ok(bill.total?.value === 188304.44 && bill.total.status === "fill", `Grand 188,304.44: ${bill.total?.value} ${bill.total?.status}`, bill.debug);

if (fail) {
  console.error(`\n${fail} failure(s)`);
  process.exit(1);
}
console.log("\nALL PASSED (0 failure(s))");
