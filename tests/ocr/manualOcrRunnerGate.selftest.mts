import assert from "node:assert/strict";
import {
  buildSwitchToManualPatch,
  isNonManualRunnerMode,
  runnerModeFromSettings,
  shouldGateManualOcrAction,
} from "../../src/modules/ocr/manualOcrRunnerGate";
import {
  MANUAL_OCR_RUNNER_GATE_MESSAGE,
  MANUAL_OCR_RUNNER_GATE_OK,
  MANUAL_OCR_RUNNER_GATE_SWITCH,
  MANUAL_OCR_RUNNER_GATE_TITLE,
  manualOcrRunnerGateAdmin,
  manualOcrRunnerGateMessage,
  manualOcrRunnerGateOk,
  manualOcrRunnerGateSwitch,
  manualOcrRunnerGateTitle,
  runnerModeFullLabel,
} from "../../src/modules/ocr/manualOcrRunnerGateIntro";

assert.equal(isNonManualRunnerMode("manual"), false);
assert.equal(isNonManualRunnerMode("semi"), true);
assert.equal(isNonManualRunnerMode("full"), true);
assert.equal(isNonManualRunnerMode("other"), false);
assert.equal(isNonManualRunnerMode(null), false);

assert.equal(shouldGateManualOcrAction({ runnerMode: "manual", runnerOpenedVoucher: false }), false);
assert.equal(shouldGateManualOcrAction({ runnerMode: "manual", runnerOpenedVoucher: true }), false);
assert.equal(shouldGateManualOcrAction({ runnerMode: "semi", runnerOpenedVoucher: false }), true);
assert.equal(shouldGateManualOcrAction({ runnerMode: "semi", runnerOpenedVoucher: true }), false);
assert.equal(shouldGateManualOcrAction({ runnerMode: "full", runnerOpenedVoucher: false }), true);
assert.equal(shouldGateManualOcrAction({ runnerMode: "full", runnerOpenedVoucher: true }), false);
assert.equal(shouldGateManualOcrAction({ runnerMode: undefined, runnerOpenedVoucher: false }), false);
assert.equal(shouldGateManualOcrAction({ runnerMode: "semi", runnerOpenedVoucher: false }), true);

assert.equal(runnerModeFromSettings("semi"), "semi");
assert.equal(runnerModeFromSettings("full"), "full");
assert.equal(runnerModeFromSettings("manual"), "manual");
assert.equal(runnerModeFromSettings({ activeRunnerMode: "full", enabled: true }), "full");
assert.equal(runnerModeFromSettings({
  enabled: true,
  processingMode: "full",
  runnerProfiles: {
    full: { enabled: true, manualScan: false },
    semi: { enabled: false, manualScan: false },
    manual: { enabled: false, manualScan: false },
  },
}), "full");
assert.equal(runnerModeFromSettings({
  enabled: true,
  processingMode: "semi",
  runnerProfiles: {
    full: { enabled: false, manualScan: false },
    semi: { enabled: true, manualScan: false },
    manual: { enabled: false, manualScan: false },
  },
}), "semi");
assert.equal(runnerModeFromSettings({
  enabled: false,
  runnerProfiles: {
    full: { enabled: false, manualScan: false },
    semi: { enabled: false, manualScan: false },
    manual: { enabled: false, manualScan: true },
  },
}), "manual");

const patch = buildSwitchToManualPatch({
  enabled: true,
  processingMode: "semi",
  activeRunnerMode: "semi",
  scanEngine: "gemini",
  runnerProfiles: {
    semi: { enabled: true, manualScan: false, scanEngine: "auto" },
    full: { enabled: false, manualScan: false, scanEngine: "gemini" },
    manual: { enabled: false, manualScan: false, scanEngine: "gemini", autoPost: false },
  },
});
assert.equal(patch.enabled, false);
assert.equal(patch.activeRunnerMode, "manual");
assert.equal(patch.processingMode, "semi");
assert.equal(patch.scanEngine, "gemini");
const profiles = patch.runnerProfiles as Record<string, Record<string, unknown>>;
assert.equal(profiles.manual.manualScan, true);
assert.equal(profiles.manual.enabled, false);
assert.equal(profiles.semi.enabled, false);
assert.equal(profiles.semi.manualScan, false);
assert.equal(profiles.full.enabled, false);
assert.equal(profiles.full.manualScan, false);
// Manual profile fields are preserved; other profiles keep their own settings except the exclusive flags.
assert.equal(profiles.manual.autoPost, false);
assert.equal(profiles.full.scanEngine, "gemini");

const emptyPatch = buildSwitchToManualPatch({});
assert.equal(emptyPatch.enabled, false);
assert.equal(emptyPatch.activeRunnerMode, "manual");
const emptyProfiles = emptyPatch.runnerProfiles as Record<string, Record<string, unknown>>;
assert.equal(emptyProfiles.manual.manualScan, true);
assert.equal(emptyProfiles.semi.enabled, false);
assert.equal(emptyProfiles.full.enabled, false);

assert.equal(runnerModeFullLabel("en", "semi"), "Semi Automatic");
assert.equal(runnerModeFullLabel("en", "full"), "Full Auto Post");
assert.equal(runnerModeFullLabel("hi", "semi"), "Semi Automatic");
assert.equal(runnerModeFullLabel("ne", "full"), "Full Auto Post");

const en = manualOcrRunnerGateMessage("en", "semi");
assert.equal(en, "Runner mode is on Semi Automatic mode. Do you want to change to Manual?");
assert.equal(manualOcrRunnerGateMessage("en", "full"), "Runner mode is on Full Auto Post mode. Do you want to change to Manual?");
assert.equal(en, MANUAL_OCR_RUNNER_GATE_MESSAGE.en.split("{mode}").join("Semi Automatic"));

const hi = manualOcrRunnerGateMessage("hi", "full");
assert.match(hi, /रनर मोड/);
assert.match(hi, /Full Auto Post/);
assert.match(hi, /Manual/);
assert.equal(hi, MANUAL_OCR_RUNNER_GATE_MESSAGE.hi.split("{mode}").join("Full Auto Post"));

const ne = manualOcrRunnerGateMessage("ne", "semi");
assert.match(ne, /रनर मोड/);
assert.match(ne, /Semi Automatic/);
assert.match(ne, /Manual/);
assert.equal(ne, MANUAL_OCR_RUNNER_GATE_MESSAGE.ne.split("{mode}").join("Semi Automatic"));

assert.equal(manualOcrRunnerGateMessage("fr", "semi"), en);
assert.equal(manualOcrRunnerGateTitle("en"), "Runner mode");
assert.equal(manualOcrRunnerGateTitle("hi"), MANUAL_OCR_RUNNER_GATE_TITLE.hi);
assert.equal(manualOcrRunnerGateTitle("ne"), MANUAL_OCR_RUNNER_GATE_TITLE.ne);
assert.equal(manualOcrRunnerGateSwitch("en"), "Switch to Manual Runner");
assert.match(manualOcrRunnerGateSwitch("hi"), /Manual Runner/);
assert.match(manualOcrRunnerGateSwitch("ne"), /Manual Runner/);
assert.equal(manualOcrRunnerGateOk("en"), "OK");
assert.equal(manualOcrRunnerGateOk("hi"), MANUAL_OCR_RUNNER_GATE_OK.hi);
assert.equal(manualOcrRunnerGateOk("ne"), MANUAL_OCR_RUNNER_GATE_OK.ne);
assert.match(manualOcrRunnerGateAdmin("en"), /company admin/i);
assert.match(manualOcrRunnerGateAdmin("hi"), /एडमिन/);
assert.match(manualOcrRunnerGateAdmin("ne"), /एडмин/);
assert.equal(MANUAL_OCR_RUNNER_GATE_SWITCH.en.includes("Manual Runner"), true);

console.log("manualOcrRunnerGate selftest: OK");
