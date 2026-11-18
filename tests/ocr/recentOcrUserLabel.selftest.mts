import assert from "node:assert/strict";
import { recentOcrUserLabel, recentOcrUserLines, ocrEngineLabel } from "../../src/modules/ocr/recentOcrUserLabel";

assert.equal(ocrEngineLabel("gemini"), "OCR Gemini");
assert.equal(ocrEngineLabel(""), "OCR");
assert.equal(recentOcrUserLabel({ mode: "full", provider: "gemini", userName: "nansari15300" }).label, "OCR Gemini");
assert.equal(recentOcrUserLabel({ mode: "semi", provider: "gemini", userName: "nansari15300" }).label, "nansari15300, OCR Gemini");
assert.equal(recentOcrUserLabel({ mode: "manual", provider: "gemini", userName: "nansari15300" }).label, "nansari15300");
const old = recentOcrUserLabel({ mode: undefined, provider: "azure", userName: "nansari15300" });
assert.equal(old.label, "nansari15300, OCR Azure");
assert.equal(old.modeStored, false);
assert.equal(recentOcrUserLabel({ mode: "semi", provider: "gemini", userName: "" }).label, "OCR Gemini");
assert.equal(recentOcrUserLabel({ mode: "manual", provider: "gemini", userName: " " }).label, "OCR Gemini");
const semiLines = recentOcrUserLines({ mode: "semi", provider: "gemini", userName: "nansari15300" });
assert.deepEqual([semiLines.line1, semiLines.line2], ["nansari15300", "OCR Gemini"]);
assert.equal(semiLines.label, "nansari15300, OCR Gemini");
assert.deepEqual(
  (({ line1, line2 }) => [line1, line2])(recentOcrUserLines({ mode: "full", provider: "gemini", userName: "nansari15300" })),
  ["OCR Gemini", ""],
);
assert.deepEqual(
  (({ line1, line2 }) => [line1, line2])(recentOcrUserLines({ mode: "manual", provider: "gemini", userName: "nansari15300" })),
  ["nansari15300", ""],
);
console.log("recentOcrUserLabel selftest: OK");
