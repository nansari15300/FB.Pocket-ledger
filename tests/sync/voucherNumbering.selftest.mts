import {
  applyRenumberedVoucherFields,
  collectTakenVoucherNumbers,
  findDuplicateVoucherNumberGroups,
  nextFreeVoucherNumber,
  parseVoucherNumberParts,
  shouldRenumberIncomingOnCollision,
} from "../../src/lib/voucherNumbering";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const parts = parseVoucherNumberParts("PYMT-83-84-0183");
assert(parts && parts.head === "PYMT-83-84-" && parts.serial === 183, "parse FY number");
assert(parseVoucherNumberParts("CNTR Out - 028")?.serial === 28, "parse contra Out");

const taken = new Set(["PYMT-83-84-0183", "PYMT-83-84-0184"]);
assert(nextFreeVoucherNumber("PYMT-83-84-0185", taken) === "PYMT-83-84-0185", "free desired kept");
assert(nextFreeVoucherNumber("PYMT-83-84-0183", taken) === "PYMT-83-84-0185", "collision bumps past max");
assert(nextFreeVoucherNumber("PYMT-83-84-0184", taken) === "PYMT-83-84-0185", "later claim gets next free");

assert(
  shouldRenumberIncomingOnCollision({
    incomingId: "b",
    incomingNumber: "PYMT-83-84-0183",
    previousNumberOnThisRecord: "",
    otherId: "a",
  }),
  "new claim against an existing different voucher must renumber"
);
assert(
  !shouldRenumberIncomingOnCollision({
    incomingId: "a",
    incomingNumber: "PYMT-83-84-0183",
    previousNumberOnThisRecord: "PYMT-83-84-0183",
    otherId: "b",
  }),
  "historical duplicate being edited must not be auto-renumbered"
);
assert(
  !shouldRenumberIncomingOnCollision({
    incomingId: "a",
    incomingNumber: "PYMT-83-84-0183",
    previousNumberOnThisRecord: "PYMT-83-84-0183",
    otherId: "a",
  }),
  "same id is not a collision"
);

const later = applyRenumberedVoucherFields(
  {
    id: "b",
    voucherNumber: "PYMT-83-84-0183",
    voucherNumberOut: "CNTR Out - 0183",
    voucherNumberIn: "CNTR In - 0183",
    narration: "keep me",
  },
  "PYMT-83-84-0185",
  { reason: "collision", at: 1 }
);
assert(later.voucherNumber === "PYMT-83-84-0185", "main number updated");
assert(later.voucherNumberOut === "CNTR Out - 0185", "contra Out follows serial");
assert(later.voucherNumberIn === "CNTR In - 0185", "contra In follows serial");
assert(later.narration === "keep me", "other fields untouched");
assert(later.autoRenumberedFrom === "PYMT-83-84-0183", "audit from");
assert(Array.isArray(later.numberingAudit) && (later.numberingAudit as unknown[]).length === 1, "audit note kept");

const groups = findDuplicateVoucherNumberGroups([
  { id: "a", type: "payment_out", voucherNumber: "PYMT-83-84-0183" },
  { id: "b", type: "payment_out", voucherNumber: "PYMT-83-84-0183" },
  { id: "c", type: "payment_out", voucherNumber: "PYMT-83-84-0184" },
  { id: "d", type: "payment_out", voucherNumber: "PYMT-83-84-0184", isDeleted: true },
]);
assert(groups.length === 1 && groups[0]?.voucherNumber === "PYMT-83-84-0183" && groups[0]?.ids.length === 2, "detect live duplicates only");
assert(collectTakenVoucherNumbers(groups.length ? [
  { id: "a", voucherNumber: "PYMT-83-84-0183" },
  { id: "b", voucherNumber: "PYMT-83-84-0185" },
] : [], "b").has("PYMT-83-84-0183") && !collectTakenVoucherNumbers([
  { id: "a", voucherNumber: "PYMT-83-84-0183" },
  { id: "b", voucherNumber: "PYMT-83-84-0185" },
], "b").has("PYMT-83-84-0185"), "exclude id from taken set");

console.log("voucherNumbering.selftest: ok");
