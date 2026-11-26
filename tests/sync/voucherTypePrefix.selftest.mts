import {
  DEFAULT_VOUCHER_PREFIX_LABELS,
  getVoucherPrefixKeyFromLike,
  isPrefixAllowedForVoucherLike,
  resolvePrefixForVoucherLike,
  voucherNumberBelongsToType,
} from "../../src/lib/nextVoucherNumber";
import {
  coerceVoucherNumberToAllowedPrefix,
  extractFySegmentLoose,
  voucherNumberUsesPrefixList,
} from "../../src/lib/voucherNumbering";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

type Case = {
  name: string;
  voucherLike: { type: string; subType?: string; lineItems?: Array<{ type?: string }> };
  prefix: string;
};

const CASES: Case[] = [
  { name: "sale", voucherLike: { type: "sale", lineItems: [{ type: "item" }] }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.sale },
  { name: "purchase", voucherLike: { type: "purchase", lineItems: [{ type: "item" }] }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.purchase },
  { name: "receipt", voucherLike: { type: "payment_in" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.payment_in },
  { name: "payment", voucherLike: { type: "payment_out" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.payment_out },
  { name: "direct income", voucherLike: { type: "direct_income" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.direct_income },
  { name: "direct expense", voucherLike: { type: "direct_expense" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.direct_expense },
  { name: "contra out/in", voucherLike: { type: "contra" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.contra },
  { name: "journal", voucherLike: { type: "journal" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.journal },
  { name: "adjustment", voucherLike: { type: "adjustment" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.adjustment },
  { name: "note", voucherLike: { type: "note" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.note },
  { name: "salary add", voucherLike: { type: "journal", subType: "add_salary" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.add_salary },
  { name: "salary pay", voucherLike: { type: "payment_out", subType: "pay_salary" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.pay_salary },
  { name: "production", voucherLike: { type: "production" }, prefix: DEFAULT_VOUCHER_PREFIX_LABELS.production },
];

assert(extractFySegmentLoose("PYMT-83-84-001") === "83-84", "loose FY parse");
assert(DEFAULT_VOUCHER_PREFIX_LABELS.direct_expense === "DEXP-", "default DEXP prefix");
assert(DEFAULT_VOUCHER_PREFIX_LABELS.payment_out === "PYMT-", "default PYMT prefix");

for (const c of CASES) {
  const key = getVoucherPrefixKeyFromLike(c.voucherLike);
  const prefix = resolvePrefixForVoucherLike(null, c.voucherLike);
  assert(prefix === c.prefix, `${c.name}: default prefix should be ${c.prefix}, got ${prefix} (key=${key})`);
  assert(
    !isPrefixAllowedForVoucherLike("PYMT-", null, c.voucherLike) || c.prefix === "PYMT-" || c.voucherLike.subType === "pay_salary",
    `${c.name}: PYMT- must not be allowed unless this really is the payment series`
  );
  // A foreign selectedPrefix must not steal this type's series.
  const resolvedAgainstPymt = resolvePrefixForVoucherLike(null, c.voucherLike, "PYMT-");
  if (c.prefix !== "PYMT-" && c.voucherLike.subType !== "pay_salary") {
    assert(resolvedAgainstPymt === c.prefix, `${c.name}: selected PYMT- must be ignored, got ${resolvedAgainstPymt}`);
  }

  const taken = new Set(["PYMT-83-84-001"]);
  const coerced = coerceVoucherNumberToAllowedPrefix("PYMT-83-84-001", [c.prefix], taken);
  assert(voucherNumberUsesPrefixList(coerced, [c.prefix]), `${c.name}: coerced ${coerced} must use ${c.prefix}`);
  assert(coerced.includes("83-84"), `${c.name}: FY span must be kept in ${coerced}`);
  assert(voucherNumberBelongsToType(coerced, null, c.voucherLike), `${c.name}: ${coerced} belongs to type`);
  if (c.prefix !== "PYMT-") {
    assert(coerced !== "PYMT-83-84-001", `${c.name}: must leave the payment number alone and take its own series (${coerced})`);
  } else {
    assert(coerced === "PYMT-83-84-002", `payment collision must bump to PYMT-83-84-002, got ${coerced}`);
  }
}

// The exact regression: Direct Expense must never keep a Payment number.
const expense = coerceVoucherNumberToAllowedPrefix(
  "PYMT-83-84-001",
  [DEFAULT_VOUCHER_PREFIX_LABELS.direct_expense],
  new Set(["PYMT-83-84-001"])
);
assert(expense === "DEXP-83-84-001", `direct expense regression: expected DEXP-83-84-001, got ${expense}`);
assert(!voucherNumberBelongsToType("PYMT-83-84-001", null, { type: "direct_expense" }), "PYMT number is not a DEXP number");
assert(voucherNumberBelongsToType("DEXP-83-84-047", null, { type: "direct_expense" }), "real-company DEXP number belongs");

// Two types can both have serial 001 — they are not a collision across series.
const saleNo = coerceVoucherNumberToAllowedPrefix("Sale Inv-83-84-001", [DEFAULT_VOUCHER_PREFIX_LABELS.sale], new Set(["PUR-83-84-001", "PYMT-83-84-001"]));
assert(saleNo === "Sale Inv-83-84-001" || saleNo.endsWith("001"), `sale keeps its own 001, got ${saleNo}`);

console.log(`voucherTypePrefix.selftest: ${CASES.length} types ok`);
