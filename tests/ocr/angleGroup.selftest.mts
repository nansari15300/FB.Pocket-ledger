/** Angle size "%" fix + Angles group inference. Run: npx tsx tests/ocr/angleGroup.selftest.mts */
import { cleanItemName, inferItemGroupFromName, normalizeItemDescription, restoreItemSizeSeparators } from "../../src/modules/ocr/extras";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};

eq("40x40%5 -> 40x40x5", restoreItemSizeSeparators("ANGLE 40x40%5"), "ANGLE 40x40x5");
eq("40%40x5 -> 40x40x5", restoreItemSizeSeparators("ANGLE 40%40x5"), "ANGLE 40x40x5");
eq("40%40%5 -> 40x40x5", restoreItemSizeSeparators("ANGLE 40%40%5"), "ANGLE 40x40x5");
eq("uppercase X kept", restoreItemSizeSeparators("ANGLE 40X40%5"), "ANGLE 40X40X5");
eq("already 40x40x5 unchanged", restoreItemSizeSeparators("ANGLE 40x40x5"), "ANGLE 40x40x5");
eq("plain 13% unchanged", restoreItemSizeSeparators("VAT 13%"), "VAT 13%");
eq("lone 5% unchanged", restoreItemSizeSeparators("5%"), "5%");
eq("discount 5% 100 unchanged", restoreItemSizeSeparators("Discount 5% 100"), "Discount 5% 100");
eq("2-part 40%40 unchanged", restoreItemSizeSeparators("40%40"), "40%40");
eq("cleanItemName fixes %", cleanItemName("ANGLE 40x40%5"), "ANGLE 40x40x5");
eq("normalizeItemDescription fixes % + strips qty", normalizeItemDescription("ANGLE 40x40%5 10 PCS"), "ANGLE 40x40x5");

eq("infer ANGLE 40x40x5", inferItemGroupFromName("ANGLE 40x40x5"), { parentName: "Angles", size: "Angle 40x40x5" });
eq("infer ANGLE 40x40%5 (OCR %)", inferItemGroupFromName("ANGLE 40x40%5"), { parentName: "Angles", size: "Angle 40x40x5" });
eq("infer MS Angle 50 X 50 X 6", inferItemGroupFromName("MS Angle 50 X 50 X 6"), { parentName: "Angles", size: "Angle 50x50x6" });
eq("infer ANGLE with leaked qty", inferItemGroupFromName("ANGLE 40x40x5 12 PCS"), { parentName: "Angles", size: "Angle 40x40x5" });
eq("angle with no size -> null", inferItemGroupFromName("ANGLE"), null);
eq("sheet still Sheet", inferItemGroupFromName("HR SHEET 3 5MM 8.000 PCS"), { parentName: "Sheet", size: "3.5MM" });
eq("plate still Sheet", inferItemGroupFromName("MS PLATE 2.5 mm"), { parentName: "Sheet", size: "2.5MM" });
eq("diesel null", inferItemGroupFromName("Diesel 3.5MM"), null);

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
