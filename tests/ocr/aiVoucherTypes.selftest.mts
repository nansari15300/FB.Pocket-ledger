/**
 * AI voucher types (items 12-17 + runner flags): all AI types honoured, type-change carry, due date order,
 * Dr = Cr, Grand Total vs items vs amount in words, Devanagari digits, own aliases for text engines, journal rows,
 * printed raw_text gap fill. Run: npx --yes tsx tests/ocr/aiVoucherTypes.selftest.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aiAmountCheck, aiNum, aiTypeCheck, AI_MAX_LINES, AI_VOUCHER_TYPES, devanagariDigitsToLatin, normalizeAiVoucher, parseAmountInWords, type OcrAiResult } from "../../src/modules/ocr/ai/aiVoucher";
import { parseBill } from "../../src/modules/ocr/parser";
import { carriedValueWrites, collectOcrUserValues } from "../../src/modules/ocr/handoff";
import { resolveOcrDueDate, partyCreditDaysOf, normalizeDefaultDueDays } from "../../src/modules/ocr/dueDate";
import { mapAiJournalLines } from "../../src/modules/ocr/journalLines";
import { ownAliasesFromRows } from "../../src/modules/ocr/ownAliases";
import { detectReceipt } from "../../src/lib/ocr/receiptDetect/index";
import { classifyAiReceipt } from "../../src/lib/ocr/receiptDetect/aiClassify";
import type { OcrRawResult } from "../../src/modules/ocr/types";

const here = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c: boolean, m: string, dbg?: unknown) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; if (dbg !== undefined) console.log("   dbg:", typeof dbg === "string" ? dbg : JSON.stringify(dbg)); }
};
const aiRes = (data: Record<string, unknown>): OcrAiResult => ({ provider: "gemini", model: "test", data: normalizeAiVoucher(data), usage: { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 } });
const rawOf = (ai: OcrAiResult, text = "VOUCHER TYPE : x"): OcrRawResult => {
  const lines = text.split("\n").filter((t) => t.trim());
  return { text, lines: lines.map((t, i) => ({ text: t, confidence: 95, y: 40 + i * 30 })), meanConfidence: 95, pageHeight: 800, engine: "gemini", ai };
};
const ctx = { kind: "purchase" as const, parties: [{ id: "P1", name: "Shree Hardware Suppliers", pan: "601234567" }], items: [], ownPan: "303687786", ownName: "New Parsa Engineering Workshop" };

/* ---- 12. every AI voucher type is honoured by applyAiToBill ---- */
{
  ok(AI_VOUCHER_TYPES.length === 10, "10 AI voucher types (8 + credit/debit note)");
  for (const t of AI_VOUCHER_TYPES) {
    const ai = aiRes({ voucher_type: t, voucher_type_reason: "test", grand_total: 1000, date_ad: new Date().toISOString().slice(0, 10) });
    ok(ai.data.voucher_type === t, `normalizeAiVoucher keeps ${t}`);
    const bill = parseBill(rawOf(ai), ctx);
    ok(bill.docType?.type === t, `applyAiToBill docType = ${t}`, bill.docType);
  }
  const bad = aiRes({ voucher_type: "salary" });
  ok(bad.data.voucher_type === null, "unknown AI type (salary) -> null");
}

/* ---- 12b. manual type change carries user values by meaning ---- */
{
  const form: Record<string, unknown> = { date: new Date(2026, 10, 1), narration: "typed by user", partyId: "P1", lineItems: [] , dueDate: null };
  const ocrFilled = new Map<string, unknown>([["partyId", "P1"]]);
  const dirty = new Set(["date", "narration", "partyId"]);
  const carried = collectOcrUserValues(
    { date: "date", dueDate: "dueDate", narration: "narration", party: "partyId" },
    (p) => form[p],
    (p, v) => !(ocrFilled.has(p) && JSON.stringify(ocrFilled.get(p)) === JSON.stringify(v)) && dirty.has(p),
    (v) => v == null || v === "",
  );
  ok(carried.narration === "typed by user" && carried.date instanceof Date, "user-typed date + narration carried");
  ok(carried.party === undefined, "OCR-filled party is not treated as a user edit (re-mapped instead)");
  ok(!("dueDate" in carried), "empty field not carried");
  const writes = carriedValueWrites({ ...carried, amount: 500 }, { date: "date", narration: "narration", amount: undefined });
  ok(writes.length === 2 && writes.every(([k]) => k === "date" || k === "narration"), "target writes only fields it has (amount dropped)", writes);
  // OCR data re-maps into a different type: purchase JSON read on a payment form keeps party / date / amount / bill no
  const ai = aiRes({ voucher_type: "purchase", party_name: "Shree Hardware Suppliers", party_pan: "601234567", invoice_no: "INV-77", date_ad: "2026-11-02", grand_total: 1130, subtotal: 1000, taxable: 1000, vat_amount: 130, vat_percent: 13, items: [{ description: "Bolt", qty: 10, rate: 100, amount: 1000, unit: "PCS" }] });
  const bill = parseBill(rawOf(ai), { ...ctx, kind: "sale" });
  ok(bill.partyId?.value === "P1" && bill.billNo?.value === "INV-77" && bill.total?.value === 1130, "re-map keeps party, bill no, total", { p: bill.partyId, b: bill.billNo, t: bill.total });
}

/* ---- 13. due date order ---- */
{
  const bd = new Date(2026, 10, 1);
  const d = (r: ReturnType<typeof resolveOcrDueDate>) => r ? `${r.source}:${r.date.getMonth() + 1}/${r.date.getDate()}` : "null";
  ok(d(resolveOcrDueDate({ printedDue: "2026-12-15", billCreditDays: 30, billDate: bd, partyCreditDays: 45, defaultDays: 60 })) === "printed:12/15", "printed due date first");
  ok(d(resolveOcrDueDate({ billCreditDays: 30, billDate: bd, partyCreditDays: 45, defaultDays: 60 })) === "bill_credit_days:12/1", "bill credit days second");
  ok(d(resolveOcrDueDate({ billDate: bd, partyCreditDays: 45, defaultDays: 60 })) === "party_credit_days:12/16", "party credit days third");
  ok(d(resolveOcrDueDate({ billDate: bd, defaultDays: 15 })) === "default_days:11/16", "Common Setting default days last");
  ok(resolveOcrDueDate({ billDate: bd, defaultDays: "" }) === null, "blank default -> no due date");
  ok(resolveOcrDueDate({ billDate: null, defaultDays: 30 }) === null, "no bill date -> no computed due date");
  ok(d(resolveOcrDueDate({ printedDue: "2026-10-01", billDate: bd, defaultDays: 10 })) === "default_days:11/11", "printed due before bill date ignored");
  ok(partyCreditDaysOf({ creditDays: "30" }) === 30 && partyCreditDaysOf({}) === null, "party credit days read");
  const nd = normalizeDefaultDueDays({ defaultDueDaysSale: 30, defaultDueDaysPurchase: "" });
  ok(nd.sale === 30 && nd.purchase === null, "setting doc keys -> sale 30 / purchase blank");
  const ai = aiRes({ voucher_type: "purchase", due_date: "२०२६-१२-०१", credit_days: "३०", grand_total: 10 });
  ok(ai.data.due_date === "2026-12-01" && ai.data.credit_days === 30, "due_date / credit_days normalized (Devanagari digits)", ai.data);
  const bill = parseBill(rawOf(ai), ctx);
  ok(bill.dueTerms?.printedDue === "2026-12-01" && bill.dueTerms?.creditDays === 30, "applyAiToBill passes due terms on");
}

/* ---- 14. per-type field check ---- */
{
  const tc = aiTypeCheck(normalizeAiVoucher({ voucher_type: "contra", grand_total: 5, date_ad: "2026-11-01", debit_account: "123", party_name: "X" }));
  ok(tc.missing.join() === "credit_account|credit_bank", "contra missing credit side", tc);
  ok(tc.unexpected.includes("party_name"), "contra flags party_name as unused", tc);
}

/* ---- 15. raw_text: summary stays raw.text, printed text fills only gaps ---- */
{
  const printed = "SHREE HARDWARE SUPPLIERS\nINVOICE NO. : HB-5521\nINVOICE DATE : 02/11/2026\nGRAND TOTAL 1130.00";
  const ai = aiRes({ voucher_type: "purchase", party_name: "Shree Hardware Suppliers", grand_total: 1130, date_ad: "2026-11-02", raw_text: printed });
  ok(ai.data.raw_text === printed, "raw_text kept line by line");
  const raw = rawOf(ai);
  raw.printedText = printed;
  const bill = parseBill(raw, ctx);
  ok(bill.billNo?.value === "HB-5521", "bill no missed by JSON filled from printed text", bill.billNo);
  ok((bill.debug ?? []).some((l) => l.startsWith("Printed text (AI raw_text) filled")), "gap fill logged");
  const ai2 = aiRes({ voucher_type: "purchase", invoice_no: "JSON-1", raw_text: printed, grand_total: 1130 });
  const r2 = rawOf(ai2); r2.printedText = printed;
  ok(parseBill(r2, ctx).billNo?.value === "JSON-1", "printed text never overrides a JSON value");
}

/* ---- 16. lines cap 30 + Dr = Cr ---- */
{
  const many = Array.from({ length: 40 }, (_, i) => ({ side: i % 2 ? "cr" : "dr", kind: "expense", name: `L${i}`, account_no: null, amount: 10 }));
  ok(normalizeAiVoucher({ lines: many }).lines.length === AI_MAX_LINES && AI_MAX_LINES === 30, "lines capped at 30");
  const bal = aiAmountCheck(normalizeAiVoucher({ voucher_type: "journal", grand_total: 500, lines: [{ side: "dr", kind: "expense", name: "Bank Charges", amount: 500 }, { side: "cr", kind: "bank", name: "NMB", amount: 500 }] }));
  ok(bal.ok, "balanced Dr/Cr passes");
  const unb = aiAmountCheck(normalizeAiVoucher({ voucher_type: "journal", grand_total: 500, lines: [{ side: "dr", kind: "expense", name: "Rent", amount: 500 }, { side: "cr", kind: "bank", name: "NMB", amount: 450 }] }));
  ok(!unb.ok && /Dr 500 does not equal Cr 450/.test(unb.reasons.join()), "Dr != Cr -> mismatch", unb);
  const bill = parseBill(rawOf(aiRes({ voucher_type: "journal", grand_total: 500, lines: [{ side: "dr", kind: "expense", name: "Rent", amount: 500 }, { side: "cr", kind: "bank", name: "NMB", amount: 450 }] })), ctx);
  ok(bill.amountCheck?.ok === false, "bill.amountCheck carries the mismatch signal");
}

/* ---- 17. Devanagari digits + Grand Total vs items vs words ---- */
{
  ok(devanagariDigitsToLatin("१०,०००") === "10,000" && aiNum("१०") === 10 && aiNum("९०") === 90, "१० -> 10 (not 90), ९० -> 90");
  ok(parseAmountInWords("Rupees Ten Thousand Only") === 10000, "words: Ten Thousand");
  ok(parseAmountInWords("Rs. One Lakh Twenty Thousand Five Hundred and Paisa Fifty Only") === 120500.5, "words: lakh + paisa");
  ok(parseAmountInWords("रु १०,०००/- मात्र") === 10000, "words line with Devanagari digits");
  const good = aiAmountCheck(normalizeAiVoucher({ voucher_type: "sale", grand_total: 11300, vat_amount: 1300, items: [{ description: "A", qty: 1, rate: 10000, amount: 10000 }], amount_in_words: "Eleven Thousand Three Hundred Only" }));
  ok(good.ok, "items + VAT = total = words", good);
  const misread = aiAmountCheck(normalizeAiVoucher({ voucher_type: "sale", grand_total: 90000, items: [{ description: "A", qty: 1, rate: 10000, amount: 10000 }], amount_in_words: "Ten Thousand Only" }));
  ok(!misread.ok && misread.reasons.length === 2, "१० read as 90: words and item sum both disagree -> mismatch", misread);
}

/* ---- (b) own aliases for Google Vision / Azure text ---- */
{
  const text = readFileSync(join(here, "fixtures", "connectips-nmb.txt"), "utf8");
  const base = { ownAccounts: [], parties: [], staff: [] };
  const plain = detectReceipt(text, base);
  ok(plain.voucherType !== "payment_out" && plain.voucherType !== "contra", `no alias: sender not known (${plain.voucherType})`);
  const al = ownAliasesFromRows([{ kind: "account_holder", text: "New parsa Egeneering" }]);
  const out = detectReceipt(text, { ...base, ownAliases: al });
  ok(out.voucherType === "payment_out", `alias on ACCOUNTFT holder -> sender ours -> Payment (${out.reason})`);
  const both = detectReceipt(text, { ...base, ownAliases: ownAliasesFromRows([{ kind: "account_holder", text: "New parsa Egeneering" }, { kind: "beneficiary", text: "Dinesh sah Kanu" }]) });
  ok(both.voucherType === "contra", `alias on both sides -> contra (${both.reason})`);
  const digits = detectReceipt(text, { ...base, ownAliases: ownAliasesFromRows([{ kind: "account_last4", text: "010" }]) });
  ok(digits.voucherType === "payment_out", `account last digits alias -> sender ours (${digits.reason})`);
}

/* ---- AI bill / journal type is not re-routed by the money classifier ---- */
{
  const d = normalizeAiVoucher({ voucher_type: "journal", doc_kind: "bank_transfer", bank_flow: "out", grand_total: 8 });
  ok(classifyAiReceipt(d, { ownAccounts: [] }) === null, "AI journal on a bank slip stays journal (no payment re-route)");
}

/* ---- journal rows from AI lines ---- */
{
  const r = mapAiJournalLines(normalizeAiVoucher({ lines: [
    { side: "dr", kind: "expense", name: "Bank Charges", amount: 8 },
    { side: "cr", kind: "bank", name: null, account_no: "208***010", bank_name: "NMB Bank", amount: 8 },
    { side: "dr", kind: "party", name: "Unknown Traders", amount: 1 },
  ] }).lines, {
    accounts: [{ id: "ON", accountName: "NMB Bank Inaruwa", bankName: "NMB Bank", accountNumber: "20800000010" }],
    parties: [], staff: [], ledgers: [{ id: "EX1", name: "Bank Charges" }], taxes: [],
  });
  ok(r.rows[0].accountId === "EX1" && r.rows[0].type === "debit" && r.rows[0].entityType === "expense", "expense line -> ledger", r.rows[0]);
  ok(r.rows[1].accountId === "ON" && r.rows[1].type === "credit", "bank line -> own bank by account no", r.rows[1]);
  ok(r.unmatched.length === 1 && r.unmatched[0].index === 2 && r.rows[2].accountId === "", "unmatched ledger kept empty for the user");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
