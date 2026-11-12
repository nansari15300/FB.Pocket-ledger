/**
 * Live server (ocr_cloud.js before the geometry mapping) returns Azure Read as text only: `pages: [{ text }]`,
 * every table cell on its own line. Before 2026-11-12 the client built 144 lines without word boxes, so the
 * parser found no header, no qty x rate = amount row and no totals (label and amount on separate lines).
 * Run: npx tsx tests/ocr/pratikAzureText.selftest.mts
 */
import { parseBill } from "../../src/modules/ocr/parser";
import { rawFromCloudText } from "../../src/modules/ocr/cloud/cloudRaw";

let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) {
    fail++;
    for (const d of dbg ?? []) console.log("   dbg:", d);
  }
};

// Raw OCR text exactly as shown in the app's "Raw OCR text" panel (Pratik SI-00780, Azure, 2026-11-12).
const TEXT = `PRATIK TRADE CENTER PVT.LTD.
PTC
ITAHARI-5, SUNSARI, NEPAL
PHONE NO. : 00977- 25-581953 / 00977-25-586624
PAN NO. : 619727215
E-MAIL: pratiktrade23@gmail.com
Copy of Original-1
INVOICE
CUSTOMER NAME : NEW PARSA ENGINEERING WORKSHOP
INVOICE NO. : SI-00780
ADDRESS
: INARUWA-6,HALESI CHOWK SUNSARI
INVOICE DATE : 12/08/2026 7:04:00F1
PAN NUMBER
: 303687786
INVOICE MITI : 27/04/2083
PHONE NUMBER : 9804215300 / 9805307786
MODE OF PAYMENT : Credit
S.N
HS CODE
PARTICULARS
ALT QTY
QTY
UOM
RATE
AMOUNT
1
7208
HR SHEET 4MM
2.000 PCS
179.500
KG
98.00
17,591.00
2
7208
HR SHEET 2.5MM
2.000 PCS
121.300
KG
98.00
11,887.40
3
CHANNEL 4"MEDIUM
1.000 PCS
49.800
KG
89.00
4,432.20
CHANNEL 4"S/L
1.000 PCS
39.700
KG
91.00
3,612.70
5
CHANNEL 3"MEDIUM
4.000 PCS
134.100
KG
89.00
11,934.90
6
CHANNEL 3"S/L
3.000 PCS
73.100
KG
91.00
6,652.10
7
CHANNEL 6"X13.5FT
2.000 PCS
137.000
KG
90.00
12,330.00
8
7306
MS PIPE RECT 3"X1.5"X3MM
2.000 PCS
64.600
KG
97.00
6,266.20
9
ANGLE 40X40X5
2.000 PCS
35.900
KG
85.00
3,051.50
10
PLAIN ROD 20MM
2.000 PCS
30.500
KG
92.00
2,806.00
11
FLAT 25X5
1.000 PCS
11.900
KG
87.00
1,035.30
12 8311
WELDING ROD 3.2MM
1.000 CTN
4.000
PKT
686.00
2,744.00
23.00
881.40
SUB TOTAL
84,343.30
REMARKS : SC
DISCOUNT
0.00
GOODS ONCE SOLD WILL NOT BE EXCHANGED / TAKEN BACK.
TAXABLE AMOUNT
84,343.30
In Words : Ninety-Five Thousand Three Hundred Seven And Ninety-Three
Paisa Only
VAT 13%
10,964.63
GRAND TOTAL
95,307.93
TRANSPORT NAME
:
VEHICLE NO.
: KO1TA 8704
RECEIVER'S NAME
:
DRIVER'S NAME : SANTOSH CHAUDHARY
RECEIVER'S NO.
DRIVER'S NO.
: 9816380953
..
वजीवे
ADMIN
RECEIVER'S SIGNATURE
PREPARED / CHECKED BY
AUTHORIZED SIGNATURE`;

const EXPECT: [string, number, string, number, number][] = [
  ["HR SHEET 4MM", 179.5, "KG", 98, 17591],
  ["HR SHEET 2.5MM", 121.3, "KG", 98, 11887.4],
  ['CHANNEL 4"MEDIUM', 49.8, "KG", 89, 4432.2],
  ['CHANNEL 4"S/L', 39.7, "KG", 91, 3612.7],
  ['CHANNEL 3"MEDIUM', 134.1, "KG", 89, 11934.9],
  ['CHANNEL 3"S/L', 73.1, "KG", 91, 6652.1],
  ['CHANNEL 6"X13.5FT', 137, "KG", 90, 12330],
  ['MS PIPE RECT 3"X1.5"X3MM', 64.6, "KG", 97, 6266.2],
  ["ANGLE 40X40X5", 35.9, "KG", 85, 3051.5],
  ["PLAIN ROD 20MM", 30.5, "KG", 92, 2806],
  ["FLAT 25X5", 11.9, "KG", 87, 1035.3],
  ["WELDING ROD 3.2MM", 4, "PKT", 686, 2744],
];
const PROFILE = { name: "New parsa Engineering WorkShop Demo Compnany", pan: "303687786" };
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.]/g, "");

const CASES: [string, unknown][] = [
  ["live server: pages [{ text }] (no word boxes)", [{ text: TEXT }]],
  ["no pages at all", undefined],
  ["malformed pages: words without text", [{ width: 1364, height: 1766, blocks: TEXT.split("\n").map((_t, i) => ({ paragraphs: [{ words: [{ text: "", boundingBox: { vertices: [{ x: 10, y: 10 + i * 12 }, { x: 60, y: 10 + i * 12 }, { x: 60, y: 20 + i * 12 }, { x: 10, y: 20 + i * 12 }] } }] }] })) }]],
  ["mostly empty geometry (3 words only)", [{ width: 1364, height: 1766, blocks: [{ paragraphs: [{ words: ["PRATIK", "TRADE", "CENTER"].map((t, i) => ({ text: t, boundingBox: { vertices: [{ x: 40 + i * 90, y: 40 }, { x: 120 + i * 90, y: 40 }, { x: 120 + i * 90, y: 60 }, { x: 40 + i * 90, y: 60 }] } })) }] }] }]],
];

for (const [name, pages] of CASES) {
  console.log(`\n== ${name}`);
  const raw = rawFromCloudText(TEXT, { engine: "azure", pages, pageWidth: 1364, pageHeight: 1766, note: "fixture" });
  ok(raw.lines.length > 100 && raw.lines.every((l) => l.text.trim().length > 0), `no empty lines (${raw.lines.length} lines)`);
  const bill = parseBill(raw, { kind: "purchase", parties: [], items: [], ownPan: PROFILE.pan, ownName: PROFILE.name });
  const rows = bill.lineItems?.value ?? [];
  ok(rows.length === 12 && bill.lineItems?.status === "fill", `12 line items filled: ${rows.length} (${bill.lineItems?.status})`, bill.debug);
  EXPECT.forEach(([d, q, u, r, a], i) => {
    const x = rows[i];
    ok(
      !!x && squash(x.description) === squash(d) && Math.abs(x.quantity - q) < 0.001 && Math.abs(x.rate - r) < 0.001 && Math.abs(x.amount - a) < 0.005 && (x.unit ?? "").toUpperCase() === u.toUpperCase(),
      `row ${i + 1}: ${x?.description} ${x?.quantity} ${x?.unit} x ${x?.rate} = ${x?.amount}`,
    );
  });
  ok(bill.subTotal?.value === 84343.3 && bill.subTotal.status === "fill", `Sub total 84,343.30: ${bill.subTotal?.value} ${bill.subTotal?.status}`, bill.debug);
  ok(bill.vat?.value === 10964.63 && bill.vat.status === "fill", `VAT 10,964.63: ${bill.vat?.value} ${bill.vat?.status}`);
  ok(bill.total?.value === 95307.93 && bill.total.status === "fill", `Grand 95,307.93: ${bill.total?.value} ${bill.total?.status}`);
  ok(bill.billNo?.value === "SI-00780", `Bill No SI-00780: ${bill.billNo?.value}`);
  ok(bill.pan?.value === "619727215", `PAN 619727215: ${bill.pan?.value}`);
  ok(bill.docType?.type === "purchase", `doc type purchase: ${bill.docType?.type}`);
}

if (fail) {
  console.error(`\n${fail} failure(s)`);
  process.exit(1);
}
console.log("\nALL PASSED (0 failure(s))");
