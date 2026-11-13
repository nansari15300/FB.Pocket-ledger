/**
 * AI chat / teaching model selftest (pure helpers, no network).
 * Run: npx tsx tests/ocr/aiChat.selftest.mts
 */
import {
  AI_CHAT_SEND_LAST,
  OCR_AI_DOC_TYPES,
  OCR_AI_DOC_TYPE_LABELS,
  aiDocTypeForVoucher,
  chatPayload,
  normDocType,
  normalizeProposedRule,
  normalizeRulesList,
  rulesCount,
  type OcrAiChatTurn,
} from "../../src/modules/ocr/ai/aiChatModel";
import { aiChatStrings } from "../../src/modules/ocr/ai/aiChatStrings";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (detail !== undefined ? "  -- " + JSON.stringify(detail) : "")); }
}

/* ---- 1. doc types ---- */
ok("11 voucher-type buckets, general first", OCR_AI_DOC_TYPES.length === 11 && OCR_AI_DOC_TYPES[0] === "general");
ok("every type has a single-language English label", OCR_AI_DOC_TYPES.every((t) => /^[A-Za-z ()_]+$/.test(OCR_AI_DOC_TYPE_LABELS[t])));
ok("normDocType trims + lowercases", normDocType(" Sale ") === "sale" && normDocType("PURCHASE") === "purchase");
ok("normDocType maps retired buckets", normDocType("payment") === "payment_out" && normDocType("expense") === "direct_expense" && normDocType("other") === "general");
ok("normDocType rejects unknown", normDocType("../x") === null && normDocType("") === null && normDocType(null) === null);

/* ---- 2. voucher -> doc type (one bucket per voucher type) ---- */
ok("sale -> sale", aiDocTypeForVoucher("sale") === "sale");
ok("purchase -> purchase", aiDocTypeForVoucher("purchase") === "purchase");
ok("quotation -> quotation", aiDocTypeForVoucher("quotation") === "quotation");
ok("payment_in -> payment_in", aiDocTypeForVoucher("payment_in") === "payment_in");
ok("payment_out -> payment_out", aiDocTypeForVoucher("payment_out") === "payment_out");
ok("direct_income -> direct_income", aiDocTypeForVoucher("direct_income") === "direct_income");
ok("direct_expense -> direct_expense", aiDocTypeForVoucher("direct_expense") === "direct_expense");
ok("contra -> contra", aiDocTypeForVoucher("contra") === "contra");
ok("journal -> journal", aiDocTypeForVoucher("journal") === "journal");
ok("all voucher types hit their own bucket", ["sale", "purchase", "quotation", "payment_in", "payment_out", "contra", "journal", "direct_income", "direct_expense"].every((v) => aiDocTypeForVoucher(v) === v));
ok("unknown type falls back to party side", aiDocTypeForVoucher(undefined, "seller") === "purchase" && aiDocTypeForVoucher(null, "buyer") === "sale");

/* ---- 3. chat payload (cost control) ---- */
const mk = (i: number, extra: Partial<OcrAiChatTurn> = {}): OcrAiChatTurn => ({ id: "t" + i, role: i % 2 ? "model" : "user", text: "msg " + i, at: i, ...extra });
const many = Array.from({ length: 20 }, (_, i) => mk(i));
many.push({ id: "last", role: "user", text: "new question", at: 99 });
const p1 = chatPayload(many);
ok("sends at most AI_CHAT_SEND_LAST (12) turns", AI_CHAT_SEND_LAST === 12 && p1.length <= 12, p1.length);
ok("payload ends with the new user turn", p1[p1.length - 1].text === "new question" && p1[p1.length - 1].role === "user");
ok("payload never starts with a model turn", p1[0].role === "user", p1[0]);
const withErr = [mk(0), { id: "e", role: "model" as const, text: "Gemini is not reachable", at: 1, error: true }, { id: "u2", role: "user" as const, text: "again", at: 2 }];
const p2 = chatPayload(withErr);
ok("error notes are not sent to the AI", p2.length === 2 && !p2.some((t) => /not reachable/.test(t.text)), p2);
const p3 = chatPayload([{ id: "x", role: "user", text: "  hi  ", at: 1, hadImage: true }]);
ok("payload is text only (no photo / flags)", p3.length === 1 && p3[0].text === "hi" && Object.keys(p3[0]).sort().join(",") === "role,text", p3);
const p4 = chatPayload([{ id: "x", role: "user", text: "a".repeat(9000), at: 1 }]);
ok("each message capped to 4000 chars", p4[0].text.length === 4000);
ok("empty / whitespace turns dropped", chatPayload([{ id: "x", role: "user", text: "   ", at: 1 }]).length === 0);

/* ---- 4. proposed rule ---- */
const r1 = normalizeProposedRule({ docType: "sale", text: " Use the QTY column, not ALT QTY. " });
ok("proposed rule normalized", r1?.docType === "sale" && r1.text === "Use the QTY column, not ALT QTY.", r1);
ok("doc_type (snake) accepted", normalizeProposedRule({ doc_type: "purchase", text: "x" })?.docType === "purchase");
ok("unknown type -> general", normalizeProposedRule({ docType: "zzz", text: "x" })?.docType === "general");
ok("empty text / null -> null", normalizeProposedRule({ docType: "sale", text: " " }) === null && normalizeProposedRule(null) === null);
ok("rule text capped at 600", (normalizeProposedRule({ text: "b".repeat(900) })?.text.length ?? 0) === 600);

/* ---- 5. rules list ---- */
const L = normalizeRulesList({
  canEdit: true,
  folder: "C:\\PocketLedger-AI-Training\\abc",
  types: {
    sale: { rules: [{ id: "r_1", text: "बिक्री बिल में QTY column लें", created: "2026-11-12T10:00:00Z", source: "chat" }, { id: "", text: "no id" }, null], removed: 2 },
    general: { rules: [{ id: "r_2", text: "Dates are BS" }], removed: 0, error: "file is not valid JSON" },
    bogus: { rules: [{ id: "r_x", text: "ignored" }] },
  },
});
ok("rules list keeps canEdit + folder", L.canEdit === true && L.folder === "C:\\PocketLedger-AI-Training\\abc");
ok("every doc type present", OCR_AI_DOC_TYPES.every((t) => Array.isArray(L.types[t].rules)));
ok("bad rows dropped, Devanagari kept", L.types.sale.rules.length === 1 && L.types.sale.rules[0].text.startsWith("बिक्री"), L.types.sale);
ok("removed count + file error kept", L.types.sale.removed === 2 && L.types.general.error === "file is not valid JSON");
ok("unknown type ignored, count = 2", rulesCount(L) === 2 && !("bogus" in L.types));
const L0 = normalizeRulesList(null);
ok("null list -> empty, not editable", L0.canEdit === false && rulesCount(L0) === 0 && L0.folder === undefined);

/* ---- 6. labels follow the app language (single language, English fallback) ---- */
const DEVA = /[\u0900-\u097F]/;
const sEn = aiChatStrings({ ui: "en", intro: "en" });
const sHi = aiChatStrings({ ui: "hi", intro: "hi" });
const sNe = aiChatStrings({ ui: "ne", intro: "ne" });
const sFr = aiChatStrings({ ui: "fr", intro: "fr" });
const vals = (o: Record<string, unknown>) => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v as Record<string, string>)));
ok("English labels have no Devanagari", vals(sEn).every((v) => !DEVA.test(v)), vals(sEn).find((v) => DEVA.test(v)));
ok("Hindi: title / attach / send / placeholder in Hindi", [sHi.attachBill, sHi.send, sHi.placeholder, sHi.intro].every((v) => DEVA.test(v)) && sHi.attachBill === "यह डॉक्यूमेंट भेजें");
ok("Nepali differs from Hindi", sNe.send !== sHi.send && DEVA.test(sNe.attachBill));
ok("unknown language falls back to English", sFr.attachBill === sEn.attachBill && sFr.intro === sEn.intro);
ok("no mixed \"English / हिन्दी\" labels", vals(sHi).every((v) => !/ \/ [\u0900-\u097F]/.test(v)));
ok("UI and intro language are separate", aiChatStrings({ ui: "en", intro: "hi" }).send === "Send" && DEVA.test(aiChatStrings({ ui: "en", intro: "hi" }).intro));
ok("Teach button + title per language", [sEn, sHi, sNe, sFr].every((v) => v.chatButton === "Teach me" && v.openChatTeaching === "Teach me" && v.title === "Teach me — Gemini"));
ok("document, not bill, in Teach strings", sEn.attachBill === "Attach this document" && sEn.buttonTitle === "Chat with Gemini and teach it how to read your documents"
  && sNe.attachBill === "यो कागजात पठाउनुहोस्" && ![sEn.attachBill, sEn.buttonTitle, sEn.cardHint, sEn.noBill, sHi.attachBill, sHi.buttonTitle, sHi.noBill, sNe.buttonTitle, sNe.noBill].some((v) => /\bbills?\b|बिल/i.test(v)));
ok("intro has the {n} placeholder", [sEn, sHi, sNe].every((x) => x.intro.includes("{n}")));

console.log(`\n${fail ? "FAILED" : "ALL PASS"}: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
