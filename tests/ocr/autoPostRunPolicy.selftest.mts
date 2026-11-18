/** Auto post run policy helpers. Run: npx tsx tests/ocr/autoPostRunPolicy.selftest.mts */
import assert from "node:assert/strict";
import {
  classifyOcrFailure,
  exclusiveScanTriggers,
  scanTriggerChoice,
  isManualStartTrigger,
  fatalOcrMessage,
  isAmountMismatchField,
  isIdleRunState,
  isNoLineItemsField,
  isServerRunLocation,
  missingFieldRuleKey,
  normalizeDefaultDueDayValue,
  normalizeExclusiveTriggers,
  normalizeRunLocation,
  ocrHandoffDefaultDueDays,
  OCR_RETRY_LIMIT,
  OCR_UNAVAILABLE_MESSAGE,
  rateLimitWaitMs,
  recordRateLimitCall,
  retryBackoffMs,
  shouldBeginNewBudget,
  shouldSkipScheduleTick,
  startBudgetReason,
} from "../../src/components/gallery/autoPostRunPolicy";

assert.deepEqual(
  exclusiveScanTriggers({ runOnUpload: true }, { runOnUpload: false, runOnSchedule: true }),
  { runOnUpload: true, runOnSchedule: false },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnSchedule: true }, { runOnUpload: true, runOnSchedule: false }),
  { runOnUpload: false, runOnSchedule: true },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnUpload: false }, { runOnUpload: true, runOnSchedule: false }),
  { runOnUpload: false, runOnSchedule: false },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnSchedule: false }, { runOnUpload: false, runOnSchedule: true }),
  { runOnUpload: false, runOnSchedule: false },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnManualStart: true }, { runOnUpload: true, runOnSchedule: false }),
  { runOnUpload: false, runOnSchedule: false },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnManualStart: true }, { runOnUpload: false, runOnSchedule: true }),
  { runOnUpload: false, runOnSchedule: false },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnManualStart: false }, { runOnUpload: false, runOnSchedule: false }),
  { runOnUpload: false, runOnSchedule: false },
);
assert.deepEqual(
  exclusiveScanTriggers({ runOnUpload: true }, { runOnUpload: false, runOnSchedule: false }),
  { runOnUpload: true, runOnSchedule: false },
);
assert.equal(isManualStartTrigger({ runOnUpload: false, runOnSchedule: false }), true);
assert.equal(isManualStartTrigger({ runOnUpload: true, runOnSchedule: false }), false);
assert.equal(isManualStartTrigger({ runOnUpload: false, runOnSchedule: true }), false);
assert.equal(scanTriggerChoice({ runOnUpload: false, runOnSchedule: false }), "manual");
assert.equal(scanTriggerChoice({ runOnUpload: true, runOnSchedule: false }), "upload");
assert.equal(scanTriggerChoice({ runOnUpload: false, runOnSchedule: true }), "schedule");
assert.deepEqual(normalizeExclusiveTriggers(true, true), { runOnUpload: true, runOnSchedule: false });
assert.deepEqual(normalizeExclusiveTriggers(false, true), { runOnUpload: false, runOnSchedule: true });
assert.deepEqual(normalizeExclusiveTriggers(false, false), { runOnUpload: false, runOnSchedule: false });

assert.equal(shouldBeginNewBudget("reset"), true);
assert.equal(shouldBeginNewBudget("idle-start"), true);
assert.equal(shouldBeginNewBudget("idle-schedule"), true);
assert.equal(shouldBeginNewBudget("resume"), false);
assert.equal(shouldBeginNewBudget("active-schedule"), false);

assert.equal(isIdleRunState({ busy: false, draining: false, remaining: 0 }), true);
assert.equal(isIdleRunState({ busy: false, draining: false, remaining: null }), true);
assert.equal(isIdleRunState({ busy: true, draining: false, remaining: 4 }), false);
assert.equal(isIdleRunState({ busy: false, draining: true, remaining: 4 }), false);
assert.equal(isIdleRunState({ busy: false, draining: true, remaining: null }), false);
assert.equal(isIdleRunState({ busy: false, draining: true, remaining: 0 }), true);

assert.equal(shouldSkipScheduleTick({ busy: true, draining: false, remaining: 3 }), true);
assert.equal(shouldSkipScheduleTick({ busy: false, draining: true, remaining: 3 }), true);
assert.equal(shouldSkipScheduleTick({ busy: false, draining: false, remaining: 0, held: true }), true);
assert.equal(shouldSkipScheduleTick({ busy: false, draining: false, remaining: 0 }), false);
assert.equal(startBudgetReason({ busy: false, draining: true, remaining: 4 }), "resume");
assert.equal(startBudgetReason({ busy: false, draining: false, remaining: 0 }), "idle-start");

assert.equal(normalizeRunLocation("server"), "local-pc");
assert.equal(normalizeRunLocation("local-pc"), "local-pc");
assert.equal(isServerRunLocation("server"), true);
assert.equal(isServerRunLocation("local-pc"), false);

assert.equal(isNoLineItemsField("Invoice has no line items."), true);
assert.equal(isNoLineItemsField("line items"), true);
assert.equal(isNoLineItemsField("Invoice line items did not pass the totals check."), false);
assert.equal(isAmountMismatchField("Invoice line items did not pass the totals check."), true);
assert.equal(isAmountMismatchField("Invoice line item amounts do not match the bill total."), true);
assert.equal(isAmountMismatchField("Invoice has no line items."), false);

assert.equal(missingFieldRuleKey("Invoice has no line items."), "item");
assert.equal(missingFieldRuleKey("line items"), "item");
assert.equal(missingFieldRuleKey("To account", "contra"), "debitMaster");
assert.equal(missingFieldRuleKey("From account", "contra"), "creditMaster");
assert.equal(missingFieldRuleKey("Dr account", "journal"), "debitMaster");
assert.equal(missingFieldRuleKey("Credit ledger", "journal"), "creditMaster");
assert.equal(missingFieldRuleKey("Cr line", "journal"), "creditMaster");
assert.equal(missingFieldRuleKey("Customer", "sale"), "debitMaster");
assert.equal(missingFieldRuleKey("Supplier", "purchase"), "creditMaster");

assert.equal(classifyOcrFailure("ignored", "unreadable"), "unreadable");
assert.equal(classifyOcrFailure("ignored", "network"), "retryable");
assert.equal(classifyOcrFailure("ignored", "timeout"), "retryable");
assert.equal(classifyOcrFailure("ignored", "unavailable"), "retryable");
assert.equal(classifyOcrFailure("ignored", "quota", 429, 30), "retryable");
assert.equal(classifyOcrFailure("ignored", "unknown", 429, 15), "retryable");
assert.equal(classifyOcrFailure("ignored", "quota"), "fatal-auth");
assert.equal(classifyOcrFailure("ignored", "quota", 429, 0), "fatal-auth");
assert.equal(classifyOcrFailure("ignored", "no_key"), "fatal-auth");
assert.equal(classifyOcrFailure("ignored", "forbidden"), "fatal-auth");
assert.equal(classifyOcrFailure("ignored", "disabled"), "fatal-auth");
assert.equal(classifyOcrFailure("ignored", "not_signed_in"), "fatal-auth");
assert.equal(classifyOcrFailure("ignored", "region_unsupported"), "fatal-auth");
assert.equal(classifyOcrFailure("AI OCR timed out."), "retryable");
assert.equal(classifyOcrFailure("Could not read document"), "unreadable");
assert.equal(classifyOcrFailure("The saved Gemini key was rejected or has expired."), "fatal-auth");
assert.equal(classifyOcrFailure("Gemini quota exhausted. Check billing on the API key."), "fatal-auth");
assert.equal(classifyOcrFailure("Server is overloaded (503)", undefined, 503), "retryable");

assert.equal(normalizeDefaultDueDayValue(null), null);
assert.equal(normalizeDefaultDueDayValue(""), null);
assert.equal(normalizeDefaultDueDayValue("  "), null);
assert.equal(normalizeDefaultDueDayValue(0), 0);
assert.equal(normalizeDefaultDueDayValue("10"), 10);
assert.equal(normalizeDefaultDueDayValue(365), 365);
assert.equal(normalizeDefaultDueDayValue(366), 365);
assert.equal(normalizeDefaultDueDayValue(-4), 0);
assert.deepEqual(ocrHandoffDefaultDueDays({ defaultDueDaysSale: 7, defaultDueDaysPurchase: null }), { sale: 7, purchase: null });

assert.equal(retryBackoffMs(1), 30_000);
assert.equal(retryBackoffMs(2), 60_000);
assert.equal(retryBackoffMs(3), 120_000);
assert.equal(retryBackoffMs(99), 120_000);
assert.equal(OCR_RETRY_LIMIT, 3);

const now = 1_000_000;
assert.equal(rateLimitWaitMs([], 5, now), 0);
assert.equal(rateLimitWaitMs([now - 10_000, now - 5_000], 5, now), 0);
const five = [now - 50_000, now - 40_000, now - 30_000, now - 20_000, now - 10_000];
assert.equal(rateLimitWaitMs(five, 5, now), 10_000);
const recorded = recordRateLimitCall([now - 70_000, now - 3_000], now);
assert.deepEqual(recorded, [now - 3_000, now]);

assert.match(fatalOcrMessage("fatal-auth", "no_key: rejected or has expired") || "", /API key was rejected/);
assert.match(fatalOcrMessage("fatal-auth", "forbidden") || "", /forbidden/);
assert.match(fatalOcrMessage("fatal-auth", "region_unsupported") || "", /not available in this region/);
assert.equal(fatalOcrMessage("retryable", "timeout"), null);
assert.equal(OCR_UNAVAILABLE_MESSAGE, "Gemini/OCR not available now, Start later");

console.log("autoPostRunPolicy.selftest: ok");
