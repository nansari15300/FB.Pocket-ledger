/**
 * Server <-> app sync: Gemini schema / per-type field lists / prompt in PocketLedger-Server ocr_cloud.js must match
 * the app's aiVoucher.ts. Run: npx --yes tsx tests/ocr/aiVoucherSchema.selftest.mts
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_MAX_LINES, AI_VOUCHER_TYPE_FIELDS, AI_VOUCHER_TYPES, normalizeAiVoucher } from "../../src/modules/ocr/ai/aiVoucher";

const here = dirname(fileURLToPath(import.meta.url));
const serverFile = process.env.PL_OCR_CLOUD_JS || join(here, "..", "..", "..", "PocketLedger-Server", "sub-server", "pb_hooks", "lib", "ocr_cloud.js");
let fail = 0;
const ok = (c: boolean, m: string, dbg?: unknown) => { console.log(c ? "PASS" : "FAIL", m); if (!c) { fail++; if (dbg !== undefined) console.log("   dbg:", JSON.stringify(dbg)); } };
if (!existsSync(serverFile)) {
  console.log(`SKIP server file not found: ${serverFile}`);
  process.exit(0);
}
const spec = createRequire(import.meta.url)(serverFile).aiVoucherSpec;
ok(!!spec, "server exports aiVoucherSpec");
const props = Object.keys(spec.VOUCHER_SCHEMA.properties);
const clientKeys = Object.keys(normalizeAiVoucher({}));
const missing = clientKeys.filter((k) => !props.includes(k));
ok(missing.length === 0, "every app field exists in the server schema", missing);
const extra = props.filter((k) => !clientKeys.includes(k));
ok(extra.length === 0, "every server schema field is read by the app", extra);
ok(JSON.stringify([...spec.VOUCHER_SCHEMA.properties.voucher_type.enum].sort()) === JSON.stringify([...AI_VOUCHER_TYPES].sort()), "voucher_type enum identical");
ok(spec.AI_MAX_LINES === AI_MAX_LINES && spec.VOUCHER_SCHEMA.properties.lines.maxItems === undefined, "lines cap identical (30); no maxItems on lines (Gemini HTTP 400)");
ok(!JSON.stringify(spec.VOUCHER_SCHEMA).includes("maxItems"), "no maxItems anywhere in the Gemini schema (complexity budget -> HTTP 400)");
const norm = (o: Record<string, { required: readonly string[]; optional: readonly string[]; empty: readonly string[] }>) =>
  JSON.stringify(Object.keys(o).sort().map((k) => [k, [...o[k].required], [...o[k].optional].sort(), [...o[k].empty].sort()]));
ok(norm(spec.VOUCHER_TYPE_FIELDS) === norm(AI_VOUCHER_TYPE_FIELDS as never), "per-type field lists identical");
for (const [t, f] of Object.entries(AI_VOUCHER_TYPE_FIELDS)) {
  const all = [...f.required.flatMap((x) => x.split("|")), ...f.optional, ...f.empty];
  const unknown = all.filter((k) => !props.includes(k));
  ok(unknown.length === 0, `${t}: field lists use schema names only`, unknown);
}
const P: string = spec.GEMINI_SYSTEM;
ok(P.includes("'१०' is 10 (not 90)") && P.includes("max 30") && P.includes("raw_text:") && P.includes("credit_note") && P.includes("due_date"), "prompt has digits / 30 lines / raw_text / notes / due date rules");
ok(!/Do NOT transcribe/.test(P), "prompt no longer forbids the transcription");
const tc = spec.validateVoucherByType({ voucher_type: "journal", grand_total: 5, date_ad: "2026-11-01", lines: [] });
ok(tc.missing.join() === "lines", "server per-type check", tc);
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
