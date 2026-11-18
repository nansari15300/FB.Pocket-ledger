import assert from "node:assert/strict";
import {
  RUNNER_WRONG_PC_INTRO,
  RUNNER_WRONG_PC_OK,
  RUNNER_WRONG_PC_TITLE,
  runnerWrongPcDeviceLabel,
  runnerWrongPcIntro,
  runnerWrongPcOk,
  runnerWrongPcTitle,
} from "../../src/modules/ocr/runnerWrongPcIntro";

assert.equal(runnerWrongPcDeviceLabel("Office laptop", "dev-123"), "Office laptop");
assert.equal(runnerWrongPcDeviceLabel("  ", "dev-123"), "dev-123");
assert.equal(runnerWrongPcDeviceLabel("", ""), "");

const en = runnerWrongPcIntro("en", "DESKTOP-M4HAJE9");
assert.match(en, /wrong PC/i);
assert.match(en, /DESKTOP-M4HAJE9/);
assert.match(en, /Settings/);
assert.match(en, /Start/);
assert.equal(en, RUNNER_WRONG_PC_INTRO.en.split("{name}").join("DESKTOP-M4HAJE9"));

const hi = runnerWrongPcIntro("hi", "DESKTOP-M4HAJE9");
assert.match(hi, /गलत PC/);
assert.match(hi, /DESKTOP-M4HAJE9/);
assert.match(hi, /Settings/);
assert.match(hi, /Start/);

const ne = runnerWrongPcIntro("ne", "DESKTOP-M4HAJE9");
assert.match(ne, /गलत PC/);
assert.match(ne, /DESKTOP-M4HAJE9/);
assert.match(ne, /Settings/);
assert.match(ne, /Start/);

assert.equal(runnerWrongPcIntro("fr", "PC-1"), RUNNER_WRONG_PC_INTRO.en.split("{name}").join("PC-1"));
assert.match(runnerWrongPcIntro("en", ""), /selected PC/);
assert.match(runnerWrongPcIntro("hi", ""), /चुना हुआ PC/);
assert.match(runnerWrongPcIntro("ne", ""), /चयन गरिएको PC/);

assert.equal(runnerWrongPcTitle("en"), RUNNER_WRONG_PC_TITLE.en);
assert.equal(runnerWrongPcTitle("hi"), "गलत PC");
assert.equal(runnerWrongPcTitle("ne"), "गलत PC");
assert.equal(runnerWrongPcOk("en"), "OK");
assert.equal(runnerWrongPcOk("hi"), RUNNER_WRONG_PC_OK.hi);
assert.equal(runnerWrongPcOk("ne"), RUNNER_WRONG_PC_OK.ne);

console.log("runnerWrongPcIntro selftest: OK");
