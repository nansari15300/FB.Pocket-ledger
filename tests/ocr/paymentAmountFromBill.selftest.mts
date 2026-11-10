/** Payment Amount from bill Grand Total when amount is not confident. Run: npx tsx tests/ocr/paymentAmountFromBill.selftest.mts */
import { isAmountConfident, paymentAmountFromBill } from "../../src/modules/ocr/fillPaymentOut";
import type { OcrField } from "../../src/modules/ocr/types";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};

const amt = (value: number, status: OcrField<number>["status"], confidence: number, note?: string): OcrField<number> =>
  (note ? { value, status, confidence, note } : { value, status, confidence });

eq("isAmountConfident: fill and positive", isAmountConfident(amt(125000, "fill", 0.97)), true);
eq("isAmountConfident: flagged is not confident", isAmountConfident(amt(125000, "flag", 0.6, "Amount seen only once - not confirmed")), false);
eq("isAmountConfident: missing", isAmountConfident(undefined), false);
eq("isAmountConfident: fill but zero", isAmountConfident(amt(0, "fill", 0.97)), false);

eq(
  "confident amount wins over total",
  paymentAmountFromBill({ amount: amt(100, "fill", 0.97), total: amt(200, "fill", 0.97) }),
  { value: 100, source: "amount", confidence: 0.97, mode: "fill" },
);

eq(
  "flagged amount + fill total -> auto-fill from total",
  paymentAmountFromBill({
    amount: amt(100, "flag", 0.6, "Amount seen only once - not confirmed"),
    total: amt(200, "fill", 0.97),
  }),
  { value: 200, source: "total", confidence: 0.97, mode: "fill", note: "Amount taken from Grand Total" },
);

eq(
  "missing amount + fill total -> auto-fill from total",
  paymentAmountFromBill({ total: amt(200, "fill", 0.97) }),
  { value: 200, source: "total", confidence: 0.97, mode: "fill", note: "Amount taken from Grand Total" },
);

eq(
  "flagged amount + flagged total -> suggest only, do not auto-fill",
  paymentAmountFromBill({
    amount: amt(100, "flag", 0.6, "Amount seen only once - not confirmed"),
    total: amt(200, "flag", 0.6, "Totals did not reconcile with line items"),
  }),
  { value: 200, source: "total", confidence: 0.6, mode: "suggest", note: "Totals did not reconcile with line items" },
);

eq("no amount and no total", paymentAmountFromBill({}), null);
eq("total is zero", paymentAmountFromBill({ total: amt(0, "fill", 0.97) }), null);

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
