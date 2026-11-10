/**
 * Narration builder: Full (current wording, with items) vs Short (Bill No / party / date).
 * Run: npx tsx tests/ocr/narration.selftest.mts
 */
import { buildOcrNarration, itemsNarrationTag, shortNarrationVerb } from "../../src/modules/ocr/narration";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

const items = itemsNarrationTag([
  { description: "HR SHEET 4MM", quantity: 179.5, unit: "Pcs", rate: 98 },
  { description: "HR SHEET 2.5MM", quantity: 121.3, unit: "Pcs", rate: 98 },
]);
ok(items === "Items: HR SHEET 4MM 179.5 Pcs x 98; HR SHEET 2.5MM 121.3 Pcs x 98", `items tag: ${items}`);

const full = buildOcrNarration({
  style: "full",
  voucherType: "purchase",
  billNo: "SI-00780",
  partyName: "Pratik Trade Center Pvt.Ltd Safiullah",
  dateText: "Shr-27-2083",
  itemsText: items,
});
ok(
  full === "Items: HR SHEET 4MM 179.5 Pcs x 98; HR SHEET 2.5MM 121.3 Pcs x 98 | Bill No: SI-00780 | Pratik Trade Center Pvt.Ltd Safiullah | OCR",
  `full purchase: ${full}`,
);

const short = buildOcrNarration({
  style: "short",
  voucherType: "purchase",
  billNo: "SI-00780",
  partyName: "Pratik Trade Center Pvt.Ltd Safiullah",
  dateText: "Shr-27-2083",
  itemsText: items,
});
ok(
  short === "Bill No SI-00780 Pur from Pratik Trade Center Pvt.Ltd Safiullah on Shr-27-2083",
  `short purchase: ${short}`,
);

ok(shortNarrationVerb("sale") === "Sale to", "sale verb");
ok(
  buildOcrNarration({ style: "short", voucherType: "sale", billNo: "SI-00780", partyName: "New Parsa Engineering Workshop", dateText: "2083-04-27" })
    === "Bill No SI-00780 Sale to New Parsa Engineering Workshop on 2083-04-27",
  "short sale",
);
ok(
  buildOcrNarration({ style: "short", voucherType: "payment_out", partyName: "Pratik Trade Center", dateText: "Shr-27-2083" })
    === "Payment to Pratik Trade Center on Shr-27-2083",
  "short payment (no bill no)",
);
ok(
  buildOcrNarration({ style: "short", voucherType: "payment_in", billNo: "R-12", partyName: "Ram Traders", dateText: "12-08-2026" })
    === "Bill No R-12 Receipt from Ram Traders on 12-08-2026",
  "short receipt",
);
ok(
  buildOcrNarration({ style: "short", voucherType: "contra", fromName: "Cash", toName: "Prabhu Bank Limited (Bank)", dateText: "Shr-27-2083" })
    === "Contra from Cash to Prabhu Bank Limited (Bank) on Shr-27-2083",
  "short contra",
);
ok(
  buildOcrNarration({ style: "short", voucherType: "purchase", billNo: "SI-00780", partyName: "Pratik Trade Center" })
    === "Bill No SI-00780 Pur from Pratik Trade Center",
  "short skips missing date",
);
ok(
  buildOcrNarration({ style: "short", voucherType: "purchase", partyName: "Pratik Trade Center", dateText: "Shr-27-2083" })
    === "Pur from Pratik Trade Center on Shr-27-2083",
  "short skips missing bill no",
);
ok(
  buildOcrNarration({ style: "full", receiptFull: "Prabhu Bank Limited (Bank) | To: Pratik | Txn ID: 123" })
    === "Prabhu Bank Limited (Bank) | To: Pratik | Txn ID: 123",
  "full money voucher keeps receiptNarration",
);
ok(shortNarrationVerb("direct_expense") === "Payment to" && shortNarrationVerb("direct_income") === "Sale to", "direct income/expense verbs");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
