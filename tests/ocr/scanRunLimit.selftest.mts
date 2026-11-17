/**
 * Per-run voucher scan limit: All (no cap) vs a number 1–500.
 * Run: npx tsx tests/ocr/scanRunLimit.selftest.mts
 */
import {
  initialRunRemaining,
  normalizeScanRunLimit,
  SCAN_RUN_LIMIT_DEFAULT,
  SCAN_RUN_LIMIT_MAX,
  SCAN_RUN_LIMIT_MIN,
  scanRunBudget,
  scanRunLimitValue,
  shouldContinueScanRun,
} from "../../src/components/gallery/scanRunLimit";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

ok(normalizeScanRunLimit("all").unlimited === true, "all (string) is unlimited");
ok(normalizeScanRunLimit("ALL").unlimited === true, "ALL is unlimited");
ok(normalizeScanRunLimit(" All ").unlimited === true, "padded All is unlimited");
ok(normalizeScanRunLimit(undefined).unlimited === true, "missing is unlimited");
ok(normalizeScanRunLimit(null).unlimited === true, "null is unlimited");
ok(normalizeScanRunLimit("").unlimited === true, "empty is unlimited");
ok(normalizeScanRunLimit(Number.NaN).unlimited === true, "NaN is unlimited");
ok(scanRunLimitValue(undefined) === "all", "stored default is all");

ok(scanRunLimitValue(10) === 10, "stored 10 stays 10");
ok(scanRunLimitValue(1) === SCAN_RUN_LIMIT_MIN, "1 is the minimum");
ok(scanRunLimitValue(500) === SCAN_RUN_LIMIT_MAX, "500 is the maximum");
ok(scanRunLimitValue(0) === SCAN_RUN_LIMIT_MIN, "0 clamps to 1");
ok(scanRunLimitValue(-4) === SCAN_RUN_LIMIT_MIN, "negative clamps to 1");
ok(scanRunLimitValue(501) === SCAN_RUN_LIMIT_MAX, "501 clamps to 500");
ok(scanRunLimitValue(12.7) === 13, "12.7 rounds to 13");
ok(scanRunLimitValue("25") === 25, "numeric string 25");

ok(scanRunBudget({ unlimited: true }, 20) === 20, "All processes every pending file");
ok(scanRunBudget({ unlimited: false, max: 10 }, 20) === 10, "limit 10 of 20 pending");
ok(scanRunBudget({ unlimited: false, max: 10 }, 3) === 3, "limit 10 but only 3 pending");
ok(scanRunBudget({ unlimited: false, max: 10 }, 0) === 0, "no pending files");

ok(shouldContinueScanRun(0, { unlimited: false, max: 10 }), "start of a limited run continues");
ok(shouldContinueScanRun(9, { unlimited: false, max: 10 }), "9 of 10 continues");
ok(!shouldContinueScanRun(10, { unlimited: false, max: 10 }), "stops after 10");
ok(shouldContinueScanRun(100, { unlimited: true }), "All never stops on the count");

ok(initialRunRemaining({ unlimited: true }) === null, "All remaining is null (unlimited)");
ok(initialRunRemaining({ unlimited: false, max: 10 }) === 10, "limited remaining starts at max");

// Simulate a run: process N, leftover waits for the next trigger.
function runOnce(pending: number, raw: unknown): { processed: number; leftover: number } {
  const limit = normalizeScanRunLimit(raw);
  let remaining = initialRunRemaining(limit);
  let processed = 0;
  let left = pending;
  while (left > 0 && (remaining === null || remaining > 0)) {
    processed += 1;
    left -= 1;
    if (remaining !== null) remaining -= 1;
  }
  return { processed, leftover: left };
}

const first = runOnce(20, 10);
ok(first.processed === 10 && first.leftover === 10, `first run of 10/20: processed ${first.processed}, leftover ${first.leftover}`);
const second = runOnce(first.leftover, 10);
ok(second.processed === 10 && second.leftover === 0, `next run finishes the leftover: processed ${second.processed}, leftover ${second.leftover}`);
const allRun = runOnce(20, "all");
ok(allRun.processed === 20 && allRun.leftover === 0, "All in one run processes every file");
ok(SCAN_RUN_LIMIT_DEFAULT === 10, "draft default when leaving All is 10");

if (fail) {
  console.error(`${fail} assertion(s) failed`);
  process.exit(1);
}
console.log("All scanRunLimit selftests passed");
