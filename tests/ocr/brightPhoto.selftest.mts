/**
 * Image regression for the over-lit photo fix (ACR). Synthetic Pratik Trade Center invoice images:
 *  - pratik-normal-synthetic.jpg: normal photo (standard pass must be enough, no retry)
 *  - pratik-bright-synthetic.jpg: pink paper, over-exposed with glare, tilted ~3 deg, blurred (same damage as the
 *    user's bright photo: PAN digit confusions, Bill No / Date / Total lost on the standard pass)
 * Mirrors engine.ts: standard = 2x upscale (<1500 px) + grayscale + 1-99 % stretch; enhanced = preprocessOps
 * (flat-field + 0.5-99.5 % stretch + deskew). Tesseract eng PSM 6 + sparse PSM 11. Needs sharp + tesseract.js
 * (same as jayOilBill.selftest). Run: npx tsx tests/ocr/brightPhoto.selftest.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { linesFromTesseractData } from "../../src/modules/ocr/layout";
import { parseBill } from "../../src/modules/ocr/parser";
import { enhanceForOcr, rgbToGray } from "../../src/modules/ocr/preprocessOps";
import { betterPass, needsEnhancedPass, ocrKeyFieldScore } from "../../src/modules/ocr/ocrQuality";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const localTess = path.join(root, "public/ocr/tessdata");
const langPath = process.env.OCR_TESSDATA || (fs.existsSync(localTess) ? localTess : undefined);
let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; for (const d of dbg ?? []) console.log("   dbg:", d); }
};
const w = await createWorker("eng", 1, { ...(langPath ? { langPath } : {}), cachePath: path.join(root, "node_modules/.cache/ocr-test"), gzip: true } as never);

async function recognize(buf: Buffer, w0: number, h0: number) {
  await w.setParameters({ tessedit_pageseg_mode: "6" } as never);
  const a = await w.recognize(buf, {}, { blocks: true, text: true } as never);
  await w.setParameters({ tessedit_pageseg_mode: "11" } as never);
  const b = await w.recognize(buf, {}, { text: true } as never);
  const text = String(a.data.text ?? "");
  return {
    quality: ocrKeyFieldScore(text),
    meanConfidence: Number(a.data.confidence ?? 0),
    raw: { text, lines: linesFromTesseractData(a.data), meanConfidence: Number(a.data.confidence ?? 0), pageHeight: h0, pageWidth: w0, altText: String(b.data.text ?? "") },
  };
}
async function standardPass(file: string) {
  const m = await sharp(file).metadata();
  const sc = Math.max(m.width!, m.height!) < 1500 ? 2 : 1;
  const W = Math.round(m.width! * sc), H = Math.round(m.height! * sc);
  const buf = await sharp(file).resize(W).grayscale().normalise({ lower: 1, upper: 99 }).png().toBuffer();
  return recognize(buf, W, H);
}
async function enhancedPass(file: string) {
  const m = await sharp(file).metadata();
  const sc = Math.max(m.width!, m.height!) < 1500 ? 2 : 1;
  const { data, info } = await sharp(file).resize(Math.round(m.width! * sc)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { gray, skewDeg } = enhanceForOcr(rgbToGray(data, info.width, info.height, info.channels));
  const img = sharp(Buffer.from(gray.data), { raw: { width: gray.width, height: gray.height, channels: 1 } }).rotate(skewDeg, { background: "#ffffff" });
  const { data: png, info: oi } = await img.png().toBuffer({ resolveWithObject: true });
  return { skewDeg, ...(await recognize(png, oi.width, oi.height)) };
}
const PROFILE = { ownPan: "303687786", ownName: "New parsa Engineering WorkShop Demo Company" };
const parse = (raw: any) => parseBill(raw, { kind: "payment_out" as never, parties: [], items: [], ...PROFILE });

/* ---- normal photo: standard pass is enough ---- */
{
  const s = await standardPass(path.join(here, "fixtures/pratik-normal-synthetic.jpg"));
  ok(!needsEnhancedPass(s.quality, s.meanConfidence, s.raw.text), `normal photo: standard ${s.quality.score}/5 ${Math.round(s.meanConfidence)}% -> no retry`);
  const b = parse(s.raw);
  ok(b.billNo?.value === "SI-02833", `normal photo Bill No SI-02833: ${b.billNo?.value}`, b.debug);
  ok(b.total?.value === 542055.12 && b.pan?.value === "619727215" && b.docType?.type === "purchase", `normal photo total/PAN/type: ${b.total?.value} ${b.pan?.value} ${b.docType?.type}`, b.debug);
}
/* ---- bright, tilted photo: standard fails, enhanced recovers ---- */
{
  const file = path.join(here, "fixtures/pratik-bright-synthetic.jpg");
  const s = await standardPass(file);
  const bs = parse(s.raw);
  console.log(`   standard: ${s.quality.score}/5 ${Math.round(s.meanConfidence)}% missing ${s.quality.missing.join(",")}; total=${bs.total?.value ?? "-"} vat=${bs.vat?.value ?? "-"} pan=${bs.pan?.value ?? "-"}`);
  ok(needsEnhancedPass(s.quality, s.meanConfidence, s.raw.text), "bright photo: standard pass asks for the enhanced retry");
  const e = await enhancedPass(file);
  ok(Math.abs(e.skewDeg + 3) <= 0.5, `deskew found the ~3 deg tilt: ${e.skewDeg}`);
  const be = parse(e.raw);
  console.log(`   enhanced: ${e.quality.score}/5 ${Math.round(e.meanConfidence)}% missing ${e.quality.missing.join(",")}`);
  ok(betterPass(s, e) === e, "enhanced pass picked");
  ok(e.meanConfidence > s.meanConfidence + 5, `confidence up: ${Math.round(s.meanConfidence)} -> ${Math.round(e.meanConfidence)}`);
  ok(be.pan?.value === "619727215", `PAN 619727215 (standard read ${bs.pan?.value ?? "-"}): ${be.pan?.value}`, be.debug);
  ok(be.vat?.value === 62360.32 && be.vat.status === "fill", `VAT 62,360.32 filled: ${be.vat?.value} ${be.vat?.status}`, be.debug);
  ok(be.total?.value === 542055.12 && be.total.status === "fill", `Grand Total 542,055.12 filled: ${be.total?.value} ${be.total?.status}`, be.debug);
  ok(/TRADE CENTER/i.test(be.partyName?.value ?? ""), `party name: ${be.partyName?.value}`);
  ok(be.docType?.type === "purchase", `purchase: ${be.docType?.type}`);
}
await w.terminate();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
