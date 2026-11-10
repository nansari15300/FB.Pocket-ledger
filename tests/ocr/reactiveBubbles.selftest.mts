/** Reactive OCR bubble dismiss/update. Run: npx tsx tests/ocr/reactiveBubbles.selftest.mts */
import { resolveOcrBubbles, snapshotFromForm, ocrMissingFieldKey } from "../../src/modules/ocr/reactiveBubbles";
import { ocrAdapters } from "../../src/modules/ocr/adapters";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};

const empty = { total: 0, date: undefined, lineItems: [{ itemId: "", quantity: 0, rate: 0, amount: 0 }] };
const bill = { total: 22600, subTotal: 20000, vat: 2600, discount: 0, billNo: "5396", amount: 22600 };

eq("Total stays missing while form total is 0",
  resolveOcrBubbles({ missing: ["Total"], suggestions: [], form: empty, bill }).missing,
  ["Total"]);

eq("Total bubble drops when item select makes total non-zero",
  resolveOcrBubbles({ missing: ["Total"], suggestions: [], form: { ...empty, total: 22600, lineItems: [{ itemId: "i1", quantity: 1, rate: 22600, amount: 22600 }] }, bill }).missing,
  []);

eq("Date stays missing when empty",
  resolveOcrBubbles({ missing: ["Date"], suggestions: [], form: { date: undefined } }).missing,
  ["Date"]);

eq("Date stays missing when invalid",
  resolveOcrBubbles({ missing: ["Date"], suggestions: [], form: { date: new Date("invalid") } }).missing,
  ["Date"]);

eq("Date bubble drops when the user sets a date",
  resolveOcrBubbles({ missing: ["Date"], suggestions: [], form: { date: new Date("2026-10-18") } }).missing,
  []);

eq("user-dismissed Total is never re-shown, even if total is still 0",
  resolveOcrBubbles({ missing: ["Total"], suggestions: [], dismissedMissingKeys: ["total"], form: empty, bill }).missing,
  []);

eq("user-dismissed Date is never re-shown if the field is cleared again",
  resolveOcrBubbles({ missing: ["Date"], suggestions: [], dismissedMissingKeys: ["date"], form: { date: undefined } }).missing,
  []);

eq("ocrMissingFieldKey(Total) is total", ocrMissingFieldKey("Total"), "total");
eq("ocrMissingFieldKey(Date) is date", ocrMissingFieldKey("Date"), "date");

eq("Party missing drops when partyId is set",
  resolveOcrBubbles({ missing: ["Party"], suggestions: [], form: { partyId: "p1" } }).missing,
  []);

eq("Party / payee drops when staff is chosen",
  resolveOcrBubbles({ missing: ["Party / payee"], suggestions: [], form: { staffId: "s1" } }).missing,
  []);

eq("Amount missing drops when amount is filled",
  resolveOcrBubbles({ missing: ["Amount (not confirmed)"], suggestions: [], form: { amount: 500 }, bill }).missing,
  []);

eq("Amount can be filled on payeeAmount (payment out)",
  resolveOcrBubbles({ missing: ["Amount"], suggestions: [], form: { payeeAmount: 500 }, bill }).missing,
  []);

eq("Bank / cash account drops when accountId is set",
  resolveOcrBubbles({ missing: ["Bank / cash account (tie)"], suggestions: [], form: { accountId: "a1" } }).missing,
  []);

eq("To account drops when toAccountId is set",
  resolveOcrBubbles({ missing: ["To account (not unique)"], suggestions: [], form: { toAccountId: "b2" } }).missing,
  []);

eq("Other charge account drops when set",
  resolveOcrBubbles({ missing: ["Other charge account (bank charge)"], suggestions: [], form: { otherChargeAccountId: "ch1" } }).missing,
  []);

eq("Line items missing drops when an item is selected",
  resolveOcrBubbles({ missing: ["Line items (did not reconcile)"], suggestions: [], form: { lineItems: [{ itemId: "i1", quantity: 1, rate: 10, amount: 10 }] } }).missing,
  []);

eq("Bill No drops when narration includes the bill number",
  resolveOcrBubbles({ missing: ["Bill No"], suggestions: [], form: { narration: "Bill No: 5396 | OCR" }, bill }).missing,
  []);

eq("VAT tax-account missing drops when the tax exists",
  resolveOcrBubbles({ missing: ["VAT 13% tax account (see Suggestions)"], suggestions: [], form: {}, vatTaxId: "tax13" }).missing,
  []);

eq("create-item-0 drops when that line gets an item; create-item-1 stays",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "create-item-0", value: "A" }, { id: "create-item-1", value: "B" }],
    form: { lineItems: [{ itemId: "i1" }, { itemId: "" }] },
  }).suggestions.map((s) => s.id),
  ["create-item-1"]);

eq("create-party / find-party drop when a party is selected",
  resolveOcrBubbles({
    missing: ["Party"],
    suggestions: [{ id: "create-party" }, { id: "find-party" }],
    form: { partyId: "p1" },
  }).suggestions.map((s) => s.id),
  []);

eq("date suggestion drops when the user sets any date (override)",
  resolveOcrBubbles({
    missing: ["Date"],
    suggestions: [{ id: "date", value: "Sun Oct 18 2026" }],
    form: { date: new Date("2026-11-01") },
  }).suggestions.map((s) => s.id),
  []);

eq("amount suggestion drops when the form amount is filled (match or override)",
  resolveOcrBubbles({
    missing: ["Amount"],
    suggestions: [{ id: "amount-total", value: "22600" }],
    form: { amount: 22600 },
    bill,
  }).suggestions.map((s) => s.id),
  []);

eq("VAT reason updates to reconciled when form total matches the bill",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "vat", reason: "Totals not reconciled", value: "VAT 2600" }],
    form: { total: 22600, subTotal: 20000, tax: 2600, lineItems: [{ itemId: "i1", amount: 20000, taxAccountId: "" }] },
    bill,
    vatTaxId: "tax13",
  }).suggestions,
  [{ id: "vat", reason: "Reconciled with totals", value: "VAT 2600" }]);

eq("VAT reason stays unreconciled when totals still differ",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "vat", reason: "Totals not reconciled" }],
    form: { total: 100, subTotal: 100, tax: 0, lineItems: [{ itemId: "i1", amount: 100 }] },
    bill,
    vatTaxId: "tax13",
  }).suggestions[0]?.reason,
  "Totals not reconciled");

eq("VAT suggestion is not dropped just because totals now match",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "vat", reason: "Totals not reconciled" }],
    form: { total: 22600, lineItems: [{ itemId: "i1", taxAccountId: "" }] },
    bill,
    vatTaxId: "tax13",
  }).suggestions.length,
  1);

eq("VAT suggestion drops once the tax is applied on all item lines",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "vat", reason: "Reconciled with totals" }],
    form: { total: 22600, lineItems: [{ itemId: "i1", taxAccountId: "tax13" }] },
    bill,
    vatTaxId: "tax13",
  }).suggestions.map((s) => s.id),
  []);

eq("doneIds are never re-shown",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "date", value: "x" }],
    doneIds: ["date"],
    form: { date: undefined },
  }).suggestions.map((s) => s.id),
  []);

eq("user-dismissed suggestion is never re-shown even if the field is still empty",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "create-party" }],
    dismissedSuggestionIds: ["create-party"],
    form: { partyId: "" },
  }).suggestions.map((s) => s.id),
  []);

eq("switch suggestion is not auto-dropped",
  resolveOcrBubbles({
    missing: [],
    suggestions: [{ id: "switch", value: "purchase" }],
    form: { partyId: "p1", date: new Date("2026-10-18"), total: 22600 },
    bill,
  }).suggestions.map((s) => s.id),
  ["switch"]);

const payOut = snapshotFromForm({ payeeAmount: 900, fromAccountId: "bank1", date: new Date("2026-10-18") }, ocrAdapters.paymentOut());
eq("snapshotFromForm maps payment-out payeeAmount", payOut.payeeAmount, 900);
eq("snapshotFromForm maps payment-out accountPath", payOut.accountId, undefined);
const contra = snapshotFromForm({ fromAccountId: "a", toAccountId: "b", amount: 10 }, ocrAdapters.contra());
eq("snapshotFromForm maps contra from/to", [contra.fromAccountId, contra.toAccountId], ["a", "b"]);

eq("several missing labels update independently",
  resolveOcrBubbles({
    missing: ["Party", "Date", "Total", "Line items"],
    suggestions: [],
    form: { partyId: "p1", date: undefined, total: 22600, lineItems: [{ itemId: "i1" }] },
    bill,
  }).missing,
  ["Date"]);

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
