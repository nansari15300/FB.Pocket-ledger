/** Item name cleanup (dropped size decimal, leaked qty/unit) + Sheet/Plate group inference. */
import { canonicalOcrQty, cleanItemName, inferItemGroupFromName, normalizeItemDescription, parseOcrQtyToken, restoreItemSizeDecimal } from "../../src/modules/ocr/extras";
import { parseBill } from "../../src/modules/ocr/parser";
import type { OcrRawResult } from "../../src/modules/ocr/types";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};

eq("restore 3 5MM", restoreItemSizeDecimal("HR SHEET 3 5MM"), "HR SHEET 3.5MM");
eq("restore 3 5 mm", restoreItemSizeDecimal("HR SHEET 3 5 mm"), "HR SHEET 3.5MM");
eq("restore comma 3,5MM", restoreItemSizeDecimal("HR SHEET 3,5MM"), "HR SHEET 3.5MM");
eq("restore already 2.5 mm", restoreItemSizeDecimal("MS PLATE 2.5 mm"), "MS PLATE 2.5MM");
eq("do not change 35MM", restoreItemSizeDecimal("MS PLATE 35MM"), "MS PLATE 35MM");

eq("clean leaked qty+unit", cleanItemName("HR SHEET 3 5MM 8.000 PCS"), "HR SHEET 3.5MM");
eq("clean 8 PCS no decimals", cleanItemName("HR SHEET 3.5MM 8 PCS"), "HR SHEET 3.5MM");
eq("clean already-decimal size", cleanItemName("HR SHEET 2.5 mm"), "HR SHEET 2.5MM");
eq("clean diesel unchanged aside from brackets", cleanItemName("Diesel <HSD>"), "Diesel");
eq("clean 35MM stays 35MM", cleanItemName("MS PLATE 35MM 10 NOS"), "MS PLATE 35MM");

eq("ANGLE 40x40x3 4.000 2CS", cleanItemName("ANGLE 40x40x3 4.000 2CS"), "ANGLE 40x40x3");
eq("ANGLE 40X40X5 3000 CS", cleanItemName("ANGLE 40X40X5 3000 CS"), "ANGLE 40X40X5");
eq("CHANNEL 4\"S/L 1.000 degree-cs", cleanItemName("CHANNEL 4\"S/L 1.000 \u00b0cs"), "CHANNEL 4\"S/L");
eq("CHANNEL 5 5,000 CS", cleanItemName("CHANNEL 5 5,000 CS"), "CHANNEL 5");
eq("CHANNEL 8'X135FT 8.000 2CS", cleanItemName("CHANNEL 8'X135FT 8.000 2CS"), "CHANNEL 8'X135FT");
eq("Lil ANGLE 40x40x3 4.000 7CS", cleanItemName("Lil ANGLE 40x40x3 4.000 7CS"), "ANGLE 40x40x3");
eq("fr208 HE SHEET 3 SMM", cleanItemName("fr208 HE SHEET 3 SMM"), "HE SHEET 3.5MM");
eq("keep size 3\"X1.5\"X3MM", cleanItemName("ANGLE 3\"X1.5\"X3MM 2.000 PCS"), "ANGLE 3\"X1.5\"X3MM");
eq("keep HR prefix (not leading junk)", cleanItemName("HR SHEET 3.5MM"), "HR SHEET 3.5MM");
eq("keep HE prefix after serial strip", normalizeItemDescription("fr208 HE SHEET 3 SMM"), "HE SHEET 3.5MM");
eq("P CS unit", cleanItemName("ANGLE 40x40x3 4.000 P CS"), "ANGLE 40x40x3");
eq("PC5 unit", cleanItemName("ANGLE 40x40x3 4.000 PC5"), "ANGLE 40x40x3");
eq("desc keeps Diesel <HSD>", normalizeItemDescription("Diesel <HSD>"), "Diesel <HSD>");

eq("qty 4.000 -> 4", canonicalOcrQty(4.000), 4);
eq("qty 4.500 -> 4.5", canonicalOcrQty(4.500), 4.5);
eq("qty 65.663 kept", canonicalOcrQty(65.663), 65.663);
eq("parse 4.000", parseOcrQtyToken("4.000"), 4);
eq("parse 4.500", parseOcrQtyToken("4.500"), 4.5);
eq("parse 5,000 as 5 (qty decimals, no rate context)", parseOcrQtyToken("5,000"), 5);
eq("parse 5,000 as 5 when 5*rate=amount", parseOcrQtyToken("5,000", { rate: 100, amount: 500 }), 5);
eq("parse 5,000 as 5000 when 5000*rate=amount", parseOcrQtyToken("5,000", { rate: 2, amount: 10000 }), 5000);

eq("infer sheet 3.5MM", inferItemGroupFromName("HR SHEET 3 5MM 8.000 PCS"), { parentName: "Sheet", size: "3.5MM" });
eq("infer plate also parent Sheet", inferItemGroupFromName("MS PLATE 2.5 mm"), { parentName: "Sheet", size: "2.5MM" });
eq("infer whole mm 12MM", inferItemGroupFromName("CR SHEET 12MM"), { parentName: "Sheet", size: "12MM" });
eq("infer no sheet/plate", inferItemGroupFromName("Diesel 3.5MM"), null);
eq("infer size before keyword ignored", inferItemGroupFromName("3.5MM something"), null);

// Parser: description finalized (decimal restored, qty stripped) via triplet tokens
const words = (line: string, y = 40) => {
  let x = 10;
  return line.split(/\s+/).map((text) => {
    const w = { text, x0: x, x1: x + text.length * 8, y0: y, y1: y + 12, conf: 90 };
    x += text.length * 8 + 6;
    return w;
  });
};
const raw: OcrRawResult = {
  text: "Description Qty Unit Rate Amount\nHR SHEET 3 5MM 8.000 PCS 100.00 800.00\nGrand Total 800.00",
  meanConfidence: 90,
  pageHeight: 400,
  pageWidth: 600,
  lines: [
    { text: "Description Qty Unit Rate Amount", confidence: 90, y: 20, words: words("Description Qty Unit Rate Amount", 20) },
    { text: "HR SHEET 3 5MM 8.000 PCS 100.00 800.00", confidence: 90, y: 40, words: words("HR SHEET 3 5MM 8.000 PCS 100.00 800.00", 40) },
    { text: "Grand Total 800.00", confidence: 90, y: 80, words: words("Grand Total 800.00", 80) },
  ],
};
const bill = parseBill(raw, { kind: "purchase", parties: [], items: [] });
const desc = bill.lineItems?.value?.[0]?.description ?? null;
eq("parser description cleaned", desc, "HR SHEET 3.5MM");
eq("parser qty not lost", bill.lineItems?.value?.[0]?.quantity, 8);

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);