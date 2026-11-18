/** Gallery runner rules (2026-11-18, decisions 1-11). Run: npx tsx tests/ocr/galleryRunnerRules.selftest.mts */
import assert from "node:assert/strict";
import {
  activeRunnerFromSettings,
  buildRunnerSettingsSave,
  COPYABLE_PROFILE_KEYS,
  copyRunnerProfileFields,
  enforceProfileRules,
  pickProfileRules,
} from "../../src/components/gallery/autoPostMode";
import { resetRunCounterState, shouldHoldWhenQueueEmpty, shouldRestoreRunOnLoad } from "../../src/components/gallery/autoPostRunPolicy";
import { pickAutoEngine, scanEngineHasKey } from "../../src/modules/ocr/engineKeys";
import { parseManualOcrProfile, resolveVoucherAutoPost } from "../../src/modules/ocr/manualProfileCore";

const rules = (item: string, other = "pause-and-hold") => ({
  missingFieldRules: { debitMaster: other, creditMaster: other, item, date: other, tax: other, other },
  itemRowMismatchAction: other,
  amountMismatchAction: other,
});
const profile = (extra: Record<string, unknown>) => ({
  enabled: false, manualScan: false, processingMode: "semi", scanEngine: "gemini", autoSaveEnabled: true, autoSaveSeconds: 4,
  overwriteEdited: false, maxVouchersPerRun: 5, runOnUpload: false, runOnSchedule: false, localRunnerDeviceId: "dev-a", localRunnerUid: "u1",
  ...rules("save-without"), ...extra,
});

// ---- Decision 1: Save keeps the Select Runner choice, not the viewed tab; top level agrees with the flags ----
{
  const profiles = {
    manual: profile({ manualScan: false }),
    semi: profile({ enabled: true }),
    full: profile({ enabled: false, scanEngine: "google" }),
  };
  // User only *viewed* Full and pressed Save: active stays Semi.
  const saved = buildRunnerSettingsSave(profiles, "semi");
  assert.equal(saved.enabled, true);
  assert.equal(saved.processingMode, "semi");
  assert.equal(saved.activeRunnerMode, "semi");
  assert.equal(saved.runnerProfiles.semi.enabled, true);
  assert.equal(saved.runnerProfiles.full.enabled, false);
  assert.equal(saved.runnerProfiles.manual.manualScan, false);
  assert.equal(saved.runnerProfiles.full.processingMode, "full");
  assert.equal(activeRunnerFromSettings(saved), "semi");
  // Full profile edits are still saved (with Full's forced rules).
  assert.equal(saved.runnerProfiles.full.scanEngine, "google");
  // Manual chosen: nothing runs automatically.
  const manual = buildRunnerSettingsSave(profiles, "manual");
  assert.equal(manual.enabled, false);
  assert.equal(manual.activeRunnerMode, "manual");
  assert.equal(manual.runnerProfiles.manual.manualScan, true);
  assert.equal(manual.runnerProfiles.semi.enabled, false);
  assert.equal(activeRunnerFromSettings(manual), "manual");
  const full = buildRunnerSettingsSave(profiles, "full");
  assert.equal(full.enabled, true);
  assert.equal(full.processingMode, "full");
  assert.equal(activeRunnerFromSettings(full), "full");
}

// ---- Decision 4: Copy settings copies only engine / Auto Post / countdown / overwrite / limit / missing rules ----
{
  const source = profile({ enabled: true, scanEngine: "azure", autoSaveSeconds: 9, overwriteEdited: true, maxVouchersPerRun: "all", runOnUpload: true, localRunnerDeviceId: "dev-src", ...rules("fail-and-continue", "fail-and-continue") });
  const target = profile({ enabled: false, runOnSchedule: true, scheduleMinutes: 30, localRunnerDeviceId: "dev-tgt" });
  const copied = copyRunnerProfileFields(target, source, "semi");
  assert.equal(copied.scanEngine, "azure");
  assert.equal(copied.autoSaveSeconds, 9);
  assert.equal(copied.overwriteEdited, true);
  assert.equal(copied.maxVouchersPerRun, "all");
  assert.equal((copied.missingFieldRules as Record<string, string>).item, "fail-and-continue");
  assert.equal(copied.enabled, false, "target keeps its on/off flag");
  assert.equal(copied.runOnSchedule, true, "target keeps its triggers");
  assert.equal(copied.runOnUpload, false);
  assert.equal(copied.localRunnerDeviceId, "dev-tgt", "target keeps its device");
  assert.equal((copied as Record<string, unknown>).scheduleMinutes, 30);
  assert.notEqual(copied.missingFieldRules, source.missingFieldRules, "rules object is cloned");
  assert.ok(!COPYABLE_PROFILE_KEYS.includes("enabled" as never));
  // Copy into Full: pause rules become fail.
  const intoFull = copyRunnerProfileFields(profile({}), profile({ autoSaveEnabled: false, ...rules("pause-and-hold") }), "full");
  assert.equal((intoFull.missingFieldRules as Record<string, string>).item, "fail-and-continue");
  assert.equal(intoFull.autoSaveEnabled, true);
}

// ---- Decision 5: Start-only stops when the queue empties and never auto-starts after reload ----
{
  const startOnly = { runOnUpload: false, runOnSchedule: false };
  assert.equal(shouldHoldWhenQueueEmpty(startOnly), true);
  assert.equal(shouldHoldWhenQueueEmpty({ runOnUpload: true, runOnSchedule: false }), false);
  assert.equal(shouldHoldWhenQueueEmpty({ runOnUpload: false, runOnSchedule: true }), false);
  assert.equal(shouldRestoreRunOnLoad(startOnly, false), false);
  assert.equal(shouldRestoreRunOnLoad({ runOnUpload: true, runOnSchedule: false }, false), true);
  assert.equal(shouldRestoreRunOnLoad({ runOnUpload: false, runOnSchedule: true }, false), true);
  assert.equal(shouldRestoreRunOnLoad({ runOnUpload: true, runOnSchedule: false }, true), false);
}

// ---- Decision 10: missing-info rules per profile; Full never pauses; migration from Common ----
{
  const full = enforceProfileRules("full", profile({ autoSaveEnabled: false, ...rules("pause-and-hold") }));
  for (const v of Object.values(full.missingFieldRules)) assert.equal(v, "fail-and-continue");
  assert.equal(full.itemRowMismatchAction, "fail-and-continue");
  assert.equal(full.amountMismatchAction, "fail-and-continue");
  assert.equal(full.autoSaveEnabled, true, "Full saves directly");
  const fullSaveWithout = enforceProfileRules("full", profile({ ...rules("save-without") }));
  assert.equal(fullSaveWithout.missingFieldRules.item, "save-without", "save without item stays allowed in Full");
  const semi = enforceProfileRules("semi", profile({ ...rules("pause-and-hold") }));
  assert.equal(semi.missingFieldRules.debitMaster, "pause-and-hold", "Semi keeps pause");
  const legacy = rules("save-without", "fail-and-continue");
  const normalizedDefault = rules("save-without", "pause-and-hold");
  // Old profile without its own rules -> takes the old Common values.
  assert.deepEqual(pickProfileRules({ scanEngine: "gemini" }, normalizedDefault, legacy), legacy);
  // Profile that already has its own rules keeps them.
  const own = rules("fail-and-continue", "pause-and-hold");
  assert.deepEqual(pickProfileRules({ ...own }, own, legacy), own);
  // Save writes each profile's own rules (Full forced).
  const saved = buildRunnerSettingsSave({ manual: profile({ ...rules("pause-and-hold") }), semi: profile({ enabled: true, ...rules("pause-and-hold") }), full: profile({ ...rules("pause-and-hold") }) }, "semi");
  assert.equal(saved.runnerProfiles.semi.missingFieldRules.debitMaster, "pause-and-hold");
  assert.equal(saved.runnerProfiles.manual.missingFieldRules.debitMaster, "pause-and-hold");
  assert.equal(saved.runnerProfiles.full.missingFieldRules.debitMaster, "fail-and-continue");
  assert.equal((saved as Record<string, unknown>).missingFieldRules && (saved.missingFieldRules as Record<string, string>).debitMaster, "pause-and-hold", "top level mirrors the active profile");
}

// ---- Decision 11: Reset only refills the counter ----
{
  const r = resetRunCounterState(5, { draining: false });
  assert.deepEqual(r, { remaining: 5, scanned: 0, draining: false, startProcessing: false });
  const r2 = resetRunCounterState(null, { draining: true });
  assert.equal(r2.remaining, null);
  assert.equal(r2.draining, true, "a run already going keeps going; reset does not stop it");
  assert.equal(r2.startProcessing, false);
}

// ---- Decisions 6 + 7: only keyed engines ----
{
  const none = { geminiModels: [], google: false, azure: false };
  assert.equal(pickAutoEngine(none), null);
  assert.equal(scanEngineHasKey("auto", none), false);
  assert.equal(scanEngineHasKey("gemini", none), false);
  assert.deepEqual(pickAutoEngine({ geminiModels: [{ id: "m" }], google: true, azure: true }), { enginePref: "ai", cloudProvider: "" });
  assert.deepEqual(pickAutoEngine({ geminiModels: [], google: false, azure: true }), { enginePref: "online", cloudProvider: "azure" });
  assert.equal(scanEngineHasKey("google", { geminiModels: [], google: true, azure: false }), true);
  assert.equal(scanEngineHasKey("azure", { geminiModels: [], google: true, azure: false }), false);
  assert.equal(scanEngineHasKey("auto", { geminiModels: [], google: true, azure: false }), true);
}

// ---- Decision 2: hand-opened vouchers read the Manual Runner profile ----
{
  const doc = { scanEngine: "gemini", autoSaveEnabled: true, runnerProfiles: { manual: { scanEngine: "azure", autoSaveEnabled: true, autoSaveSeconds: 7, overwriteEdited: true, missingFieldRules: { item: "fail-and-continue" } } } };
  const m = parseManualOcrProfile(doc);
  assert.equal(m.enginePref, "online");
  assert.equal(m.cloudProvider, "azure");
  assert.equal(m.autoPost, true);
  assert.equal(m.autoPostSeconds, 7);
  assert.equal(m.overwriteEdited, true);
  assert.equal(m.itemRule, "fail-and-continue");
  const legacyOnly = parseManualOcrProfile({ scanEngine: "gemini", autoSaveEnabled: true });
  assert.equal(legacyOnly.enginePref, "ai");
  assert.equal(legacyOnly.autoPost, false, "no manual profile yet -> Auto Post off");
  assert.equal(parseManualOcrProfile(null).loaded, false);
  assert.equal(resolveVoucherAutoPost({ runnerJob: false, manual: { autoPost: true } }), true);
  assert.equal(resolveVoucherAutoPost({ runnerJob: false, override: false, manual: { autoPost: true } }), false);
  assert.equal(resolveVoucherAutoPost({ runnerJob: true, runnerAutoPost: false, manual: { autoPost: true } }), false, "runner job ignores manual profile");
  assert.equal(resolveVoucherAutoPost({ runnerJob: true, override: true, runnerAutoPost: false, manual: { autoPost: false } }), true);
}

console.log("galleryRunnerRules selftest: OK");
