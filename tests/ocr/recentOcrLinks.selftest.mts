import assert from "node:assert/strict";
import {
  isAliveRecentOcrVoucher,
  mergeRecentOcrLinks,
  normalizeRecentOcrLink,
  voucherLookupIds,
} from "../../src/modules/ocr/recentOcrLinks";

assert.deepEqual(normalizeRecentOcrLink({ autoOcrVoucherId: "voucher_1", autoOcrProvider: "gemini", autoOcrRunnerMode: "semi" }), {
  voucherId: "voucher_1",
  provider: "gemini",
  mode: "semi",
});
assert.equal(normalizeRecentOcrLink({ voucherId: "  " }), null);

const merged = mergeRecentOcrLinks([
  [{ voucherId: "a", provider: "google", mode: "full" }],
  [{ voucherId: "a", provider: "gemini", mode: "semi" }, { voucherId: "b", provider: "", mode: "manual" }],
]);
assert.deepEqual(merged, [
  { voucherId: "a", provider: "gemini", mode: "semi" },
  { voucherId: "b", provider: "", mode: "manual" },
]);

assert.equal(isAliveRecentOcrVoucher({ id: "a" }), true);
assert.equal(isAliveRecentOcrVoucher({ id: "a", isDeleted: true }), false);
assert.equal(isAliveRecentOcrVoucher({ id: "a", _pbHardDeleted: true }), false);

const ids = voucherLookupIds({ id: "app-1", app_id: "app-1", _pbId: "pb123" }, "pb123");
assert.deepEqual([...ids].sort(), ["app-1", "pb123"]);

console.log("recentOcrLinks selftest: OK");
