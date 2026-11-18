import assert from "node:assert/strict";
import {
  DEFAULT_RECENT_OCR_SORT_BY,
  DEFAULT_RECENT_OCR_SORT_ORDER,
  sortRecentOcrTransactions,
} from "../../src/modules/ocr/recentOcrTransactionSort";

const voucherDay = new Date(2023, 7, 4, 10, 0, 0);
const postedEarly = new Date(2026, 10, 17, 8, 0, 0);
const postedMid = new Date(2026, 10, 18, 16, 25, 0);
const postedLate = new Date(2026, 10, 18, 23, 18, 0);

const rows = [
  { id: "old-bill", createdAt: postedLate, date: voucherDay, debit: 8000, voucherNumber: "DEXP-83-84-002" },
  { id: "mid", createdAt: postedMid, date: postedLate, debit: 12000, voucherNumber: "PUR-80-81-001" },
  { id: "early", createdAt: postedEarly, date: postedLate, debit: 500, voucherNumber: "SAL-83-84-010" },
];

assert.equal(DEFAULT_RECENT_OCR_SORT_BY, "date");
assert.equal(DEFAULT_RECENT_OCR_SORT_ORDER, "desc");

// Default / By Date desc = newest posted first, ignoring voucher date.
assert.deepEqual(
  sortRecentOcrTransactions(rows).map((row) => row.id),
  ["old-bill", "mid", "early"],
);
assert.deepEqual(
  sortRecentOcrTransactions(rows, "date", "desc").map((row) => row.id),
  ["old-bill", "mid", "early"],
);
assert.deepEqual(
  sortRecentOcrTransactions(rows, "date", "asc").map((row) => row.id),
  ["early", "mid", "old-bill"],
);

// By Amount keeps asc/desc.
assert.deepEqual(
  sortRecentOcrTransactions(rows, "amount", "desc").map((row) => row.id),
  ["mid", "old-bill", "early"],
);
assert.deepEqual(
  sortRecentOcrTransactions(rows, "amount", "asc").map((row) => row.id),
  ["early", "old-bill", "mid"],
);

// By Voucher No. keeps asc/desc (localeCompare).
assert.deepEqual(
  sortRecentOcrTransactions(rows, "voucherNo", "asc").map((row) => row.id),
  ["old-bill", "mid", "early"],
);
assert.deepEqual(
  sortRecentOcrTransactions(rows, "voucherNo", "desc").map((row) => row.id),
  ["early", "mid", "old-bill"],
);

// Posted date can come from the voucher record when the row has none.
const sparse = [
  { id: "from-voucher", date: voucherDay, debit: 1, voucherNumber: "A-1" },
  { id: "on-row", createdAt: postedEarly, date: postedLate, debit: 1, voucherNumber: "A-2" },
];
const voucherById = new Map([["from-voucher", { createdAt: postedLate }]]);
assert.deepEqual(
  sortRecentOcrTransactions(sparse, "date", "desc", voucherById).map((row) => row.id),
  ["from-voucher", "on-row"],
);

// Does not mutate the input list; sort applies to the full list (before any page slice).
const originalIds = rows.map((row) => row.id);
const sorted = sortRecentOcrTransactions(rows, "amount", "asc");
assert.deepEqual(rows.map((row) => row.id), originalIds);
assert.notEqual(sorted, rows);
assert.deepEqual(sorted.slice(0, 2).map((row) => row.id), ["early", "old-bill"]);

// Amount ties break by posted date, newest first.
const ties = [
  { id: "a", createdAt: postedEarly, debit: 100, voucherNumber: "T-1" },
  { id: "b", createdAt: postedLate, debit: 100, voucherNumber: "T-2" },
];
assert.deepEqual(
  sortRecentOcrTransactions(ties, "amount", "asc").map((row) => row.id),
  ["b", "a"],
);

console.log("recentOcrTransactionSort selftest: OK");
