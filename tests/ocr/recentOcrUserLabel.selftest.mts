import assert from "node:assert/strict";
import { recentOcrUserLabel, ocrEngineLabel } from "../../src/modules/ocr/recentOcrUserLabel";

assert.equal(ocrEngineLabel("gemini"), "OCR Gemini");
assert.equal(ocrEngineLabel(""), "OCR");
assert.equal(recentOcrUserLabel({ mode: "full", provider: "gemini", userName: "nansari15300" }).label, "OCR Gemini");
assert.equal(recentOcrUserLabel({ mode: "semi", provider: "gemini", userName: "nansari15300" }).label, "OCR nansari15300, OCR Gemini");
assert.equal(recentOcrUserLabel({ mode: "manual", provider: "gemini", userName: "nansari15300" }).label, "nansari15300");
const old = recentOcrUserLabel({ mode: undefined, provider: "azure", userName: "nansari15300" });
assert.equal(old.label, "OCR nansari15300, OCR Azure");
assert.equal(old.modeStored, false);
assert.equal(recentOcrUserLabel({ mode: "semi", provider: "gemini", userName: "" }).label, "OCR Gemini");
assert.equal(recentOcrUserLabel({ mode: "manual", provider: "gemini", userName: " " }).label, "OCR Gemini");
console.log("recentOcrUserLabel selftest: OK");
