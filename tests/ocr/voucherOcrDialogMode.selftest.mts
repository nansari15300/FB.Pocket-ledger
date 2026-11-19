import assert from "node:assert/strict";
import {
  applyDialogModeChoice,
  canSelectDialogMode,
  dialogModeFromState,
  dialogRunnerModeFromSettings,
  isVoucherOcrDialogMode,
  runnerModeAfterOcrOn,
  runnerNeedsLocalDevice,
  runnerProfileForMode,
  VOUCHER_OCR_DIALOG_MODE_INDEX,
  VOUCHER_OCR_DIALOG_MODES,
} from "../../src/modules/ocr/voucherOcrDialogMode";
import {
  buildSwitchToManualPatch,
  buildSwitchToRunnerModePatch,
  isCompanyAdminUser,
} from "../../src/modules/ocr/manualOcrRunnerGate";
import {
  VOUCHER_OCR_MODE_FULL,
  VOUCHER_OCR_MODE_OFF_PILL,
  VOUCHER_OCR_MODE_SHORT,
  voucherOcrModeFull,
  voucherOcrModeOffPill,
  voucherOcrModeShort,
} from "../../src/modules/ocr/voucherOcrDialogModeIntro";

assert.deepEqual([...VOUCHER_OCR_DIALOG_MODES], ["off", "manual", "semi", "full"]);
assert.equal(VOUCHER_OCR_DIALOG_MODE_INDEX.off, 0);
assert.equal(VOUCHER_OCR_DIALOG_MODE_INDEX.manual, 1);
assert.equal(VOUCHER_OCR_DIALOG_MODE_INDEX.semi, 2);
assert.equal(VOUCHER_OCR_DIALOG_MODE_INDEX.full, 3);
assert.equal(isVoucherOcrDialogMode("off"), true);
assert.equal(isVoucherOcrDialogMode("manual"), true);
assert.equal(isVoucherOcrDialogMode("semi"), true);
assert.equal(isVoucherOcrDialogMode("full"), true);
assert.equal(isVoucherOcrDialogMode("auto"), false);
assert.equal(isVoucherOcrDialogMode(null), false);

assert.equal(dialogModeFromState({ ocrEnabled: false, runnerMode: "manual" }), "off");
assert.equal(dialogModeFromState({ ocrEnabled: false, runnerMode: "semi" }), "off");
assert.equal(dialogModeFromState({ ocrEnabled: false, runnerMode: "full" }), "off");
assert.equal(dialogModeFromState({ ocrEnabled: true, runnerMode: "manual" }), "manual");
assert.equal(dialogModeFromState({ ocrEnabled: true, runnerMode: "semi" }), "semi");
assert.equal(dialogModeFromState({ ocrEnabled: true, runnerMode: "full" }), "full");

assert.equal(runnerModeAfterOcrOn("manual"), "manual");
assert.equal(runnerModeAfterOcrOn("semi"), "semi");
assert.equal(runnerModeAfterOcrOn("full"), "full");

const offKeepsSemi = applyDialogModeChoice({ next: "off", runnerMode: "semi" });
assert.deepEqual(offKeepsSemi, { ocrEnabled: false, runnerMode: "semi", runnerModeChanged: false });

const offKeepsFull = applyDialogModeChoice({ next: "off", runnerMode: "full" });
assert.equal(offKeepsFull.ocrEnabled, false);
assert.equal(offKeepsFull.runnerMode, "full");
assert.equal(offKeepsFull.runnerModeChanged, false);

const turnOnLastSemi = applyDialogModeChoice({ next: "semi", runnerMode: "semi" });
assert.deepEqual(turnOnLastSemi, { ocrEnabled: true, runnerMode: "semi", runnerModeChanged: false });

const turnOnLastFull = applyDialogModeChoice({ next: "full", runnerMode: "full" });
assert.equal(turnOnLastFull.ocrEnabled, true);
assert.equal(turnOnLastFull.runnerMode, "full");
assert.equal(turnOnLastFull.runnerModeChanged, false);

const changeToFull = applyDialogModeChoice({ next: "full", runnerMode: "manual" });
assert.deepEqual(changeToFull, { ocrEnabled: true, runnerMode: "full", runnerModeChanged: true });

const changeToManual = applyDialogModeChoice({ next: "manual", runnerMode: "full" });
assert.deepEqual(changeToManual, { ocrEnabled: true, runnerMode: "manual", runnerModeChanged: true });

assert.equal(canSelectDialogMode({ next: "off", runnerMode: "semi", isCompanyAdmin: false }), true);
assert.equal(canSelectDialogMode({ next: "semi", runnerMode: "semi", isCompanyAdmin: false }), true);
assert.equal(canSelectDialogMode({ next: "full", runnerMode: "semi", isCompanyAdmin: false }), false);
assert.equal(canSelectDialogMode({ next: "manual", runnerMode: "semi", isCompanyAdmin: false }), false);
assert.equal(canSelectDialogMode({ next: "full", runnerMode: "semi", isCompanyAdmin: true }), true);
assert.equal(canSelectDialogMode({ next: "manual", runnerMode: "full", isCompanyAdmin: true }), true);

assert.equal(runnerNeedsLocalDevice({ runLocation: "local-pc" }, "semi"), true);
assert.equal(runnerNeedsLocalDevice({ runLocation: "local-pc" }, "full"), true);
assert.equal(runnerNeedsLocalDevice({ runLocation: "local-pc" }, "manual"), false);
assert.equal(runnerNeedsLocalDevice({
  runLocation: "local-pc",
  localRunnerUid: "u1",
  localRunnerDeviceId: "d1",
}, "semi"), false);
assert.equal(runnerNeedsLocalDevice({ runLocation: "server" }, "full"), false);

const settings = {
  enabled: true,
  processingMode: "semi",
  activeRunnerMode: "semi",
  scanEngine: "gemini",
  runnerProfiles: {
    semi: { enabled: true, manualScan: false, scanEngine: "auto", runLocation: "local-pc" },
    full: { enabled: false, manualScan: false, scanEngine: "gemini", runLocation: "local-pc", localRunnerUid: "u1", localRunnerDeviceId: "d1" },
    manual: { enabled: false, manualScan: false, scanEngine: "gemini", autoPost: false },
  },
};
assert.equal(dialogRunnerModeFromSettings(settings), "semi");
assert.equal(dialogRunnerModeFromSettings("full"), "full");
assert.equal(runnerProfileForMode(settings, "full").scanEngine, "gemini");
assert.equal(runnerProfileForMode(settings, "semi").runLocation, "local-pc");
assert.equal(runnerNeedsLocalDevice(runnerProfileForMode(settings, "semi"), "semi"), true);
assert.equal(runnerNeedsLocalDevice(runnerProfileForMode(settings, "full"), "full"), false);

const toFull = buildSwitchToRunnerModePatch(settings, "full");
assert.equal(toFull.enabled, true);
assert.equal(toFull.activeRunnerMode, "full");
assert.equal(toFull.processingMode, "full");
assert.equal((toFull.runnerProfiles as { full: { enabled: boolean } }).full.enabled, true);
assert.equal((toFull.runnerProfiles as { semi: { enabled: boolean } }).semi.enabled, false);
assert.equal((toFull.runnerProfiles as { manual: { manualScan: boolean } }).manual.manualScan, false);
assert.equal(toFull.localRunnerUid, "u1");

const toManual = buildSwitchToRunnerModePatch(settings, "manual");
const legacy = buildSwitchToManualPatch(settings);
assert.deepEqual(toManual, legacy);
assert.equal(legacy.enabled, false);
assert.equal(legacy.activeRunnerMode, "manual");
assert.equal(legacy.processingMode, "semi");
assert.equal((legacy.runnerProfiles as { manual: { manualScan: boolean } }).manual.manualScan, true);
assert.equal((legacy.runnerProfiles as { semi: { enabled: boolean } }).semi.enabled, false);
assert.equal((legacy.runnerProfiles as { full: { enabled: boolean } }).full.enabled, false);

assert.equal(isCompanyAdminUser({ ownerId: "u1" }, "u1"), true);
assert.equal(isCompanyAdminUser({ owner: "u1" }, "u1"), true);
assert.equal(isCompanyAdminUser({
  ownerId: "u0",
  sharedWith: [{ uid: "u2", role: "CompanyAdmin" }],
}, "u2"), true);
assert.equal(isCompanyAdminUser({
  ownerId: "u0",
  sharedWith: [{ uid: "u2", role: "editor" }],
}, "u2"), false);
assert.equal(isCompanyAdminUser({ ownerId: "u0" }, "u9"), false);
assert.equal(isCompanyAdminUser(null, "u1"), false);

assert.equal(voucherOcrModeShort("en", "off"), "Off");
assert.equal(voucherOcrModeShort("hi", "off"), VOUCHER_OCR_MODE_SHORT.hi.off);
assert.equal(voucherOcrModeShort("ne", "off"), VOUCHER_OCR_MODE_SHORT.ne.off);
assert.equal(voucherOcrModeShort("en", "full"), "Full Auto");
assert.equal(voucherOcrModeFull("en", "manual"), "Manual Runner");
assert.equal(voucherOcrModeOffPill("en"), "OCR Off");
assert.equal(voucherOcrModeOffPill("hi"), VOUCHER_OCR_MODE_OFF_PILL.hi);
assert.equal(VOUCHER_OCR_MODE_FULL.en.off, "OCR Off");

console.log("voucherOcrDialogMode.selftest ok");
