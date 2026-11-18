/** Auto post mode mapping. Run: npx tsx tests/ocr/autoPostMode.selftest.mts */
import assert from "node:assert/strict";
import {
  AUTO_POST_MODE_INDEX,
  AUTO_POST_MODES,
  activeRunnerFromSettings,
  isAutoPostMode,
  runnerModePersistFields,
  runnerProfileSelectedMode,
  withExclusiveRunnerProfiles,
} from "../../src/components/gallery/autoPostMode";

assert.deepEqual(AUTO_POST_MODES, ["manual", "semi", "full"]);
assert.equal(AUTO_POST_MODE_INDEX.manual, 0);
assert.equal(AUTO_POST_MODE_INDEX.semi, 1);
assert.equal(AUTO_POST_MODE_INDEX.full, 2);
assert.equal(isAutoPostMode("manual"), true);
assert.equal(isAutoPostMode("semi"), true);
assert.equal(isAutoPostMode("full"), true);
assert.equal(isAutoPostMode("auto"), false);

// The reported desync: Select Runner Manual ON, top-level still looks like Semi.
assert.equal(
  activeRunnerFromSettings({
    enabled: true,
    processingMode: "semi",
    activeRunnerMode: "manual",
    runnerProfiles: {
      manual: { manualScan: true },
      semi: { enabled: false },
      full: { enabled: false },
    },
  }),
  "manual",
);

// Unique profile flags win over a stale activeRunnerMode (slider wrote Semi, dialog still Manual).
assert.equal(
  activeRunnerFromSettings({
    enabled: true,
    processingMode: "semi",
    activeRunnerMode: "semi",
    runnerProfiles: {
      manual: { manualScan: true },
      semi: { enabled: false },
      full: { enabled: false },
    },
  }),
  "manual",
);

// Unique Semi profile.
assert.equal(
  activeRunnerFromSettings({
    enabled: true,
    processingMode: "semi",
    activeRunnerMode: "semi",
    runnerProfiles: {
      manual: { manualScan: false },
      semi: { enabled: true },
      full: { enabled: false },
    },
  }),
  "semi",
);

// Unique Full profile.
assert.equal(
  activeRunnerFromSettings({
    enabled: true,
    processingMode: "full",
    activeRunnerMode: "full",
    runnerProfiles: {
      manual: { manualScan: false },
      semi: { enabled: false },
      full: { enabled: true },
    },
  }),
  "full",
);

// Prefer activeRunnerMode when profile flags are missing or ambiguous.
assert.equal(activeRunnerFromSettings({ activeRunnerMode: "full", enabled: false, processingMode: "semi" }), "full");
assert.equal(
  activeRunnerFromSettings({
    activeRunnerMode: "semi",
    enabled: false,
    processingMode: "full",
    runnerProfiles: {
      manual: { manualScan: true },
      semi: { enabled: true },
      full: { enabled: false },
    },
  }),
  "semi",
);

// Legacy fallback: enabled + processingMode when no mode / profiles.
assert.equal(activeRunnerFromSettings({ enabled: true, processingMode: "full" }), "full");
assert.equal(activeRunnerFromSettings({ enabled: true, processingMode: "semi" }), "semi");
assert.equal(activeRunnerFromSettings({ enabled: false, processingMode: "full" }), "manual");
assert.equal(activeRunnerFromSettings({}), "manual");
assert.equal(activeRunnerFromSettings(null), "manual");
assert.equal(activeRunnerFromSettings(undefined), "manual");

assert.equal(runnerProfileSelectedMode({ manual: { manualScan: true }, semi: { enabled: false }, full: { enabled: false } }), "manual");
assert.equal(runnerProfileSelectedMode({ manual: { manualScan: false }, semi: { enabled: true }, full: { enabled: false } }), "semi");
assert.equal(runnerProfileSelectedMode({ manual: { manualScan: false }, semi: { enabled: false }, full: { enabled: true } }), "full");
assert.equal(runnerProfileSelectedMode({ manual: { manualScan: true }, semi: { enabled: true }, full: { enabled: false } }), null);
assert.equal(runnerProfileSelectedMode({}), null);

assert.deepEqual(runnerModePersistFields("manual"), { enabled: false, processingMode: "semi", activeRunnerMode: "manual" });
assert.deepEqual(runnerModePersistFields("semi"), { enabled: true, processingMode: "semi", activeRunnerMode: "semi" });
assert.deepEqual(runnerModePersistFields("full"), { enabled: true, processingMode: "full", activeRunnerMode: "full" });

const exclusive = withExclusiveRunnerProfiles(
  { semi: { enabled: true, scanEngine: "google" }, full: { enabled: false }, manual: { manualScan: false, foo: 1 } },
  "manual",
);
assert.equal((exclusive.manual as { manualScan: boolean; foo: number }).manualScan, true);
assert.equal((exclusive.manual as { enabled: boolean }).enabled, false);
assert.equal((exclusive.manual as { foo: number }).foo, 1);
assert.equal((exclusive.semi as { enabled: boolean; scanEngine: string }).enabled, false);
assert.equal((exclusive.semi as { scanEngine: string }).scanEngine, "google");
assert.equal((exclusive.full as { enabled: boolean; manualScan: boolean }).enabled, false);
assert.equal((exclusive.full as { manualScan: boolean }).manualScan, false);

const exclusiveSemi = withExclusiveRunnerProfiles(exclusive, "semi");
assert.equal((exclusiveSemi.semi as { enabled: boolean }).enabled, true);
assert.equal((exclusiveSemi.manual as { manualScan: boolean }).manualScan, false);
assert.equal((exclusiveSemi.full as { enabled: boolean }).enabled, false);

const exclusiveFull = withExclusiveRunnerProfiles({}, "full");
assert.equal((exclusiveFull.full as { enabled: boolean }).enabled, true);
assert.equal((exclusiveFull.semi as { enabled: boolean }).enabled, false);
assert.equal((exclusiveFull.manual as { manualScan: boolean }).manualScan, false);

// Persist fields stay consistent with the resolved mode.
for (const mode of AUTO_POST_MODES) {
  const persisted = {
    ...runnerModePersistFields(mode),
    runnerProfiles: withExclusiveRunnerProfiles({}, mode),
  };
  assert.equal(activeRunnerFromSettings(persisted), mode);
  assert.equal(runnerProfileSelectedMode(persisted.runnerProfiles), mode);
}

console.log("autoPostMode.selftest: ok");
