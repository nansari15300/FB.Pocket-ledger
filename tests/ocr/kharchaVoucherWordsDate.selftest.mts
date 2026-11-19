/**
 * Handwritten Nepali खर्च भौचर (New Parsa, भौ. नं. 170): Gemini read the
 * amount digits as 98200 and the miti as 2079-08-18, while the printed
 * amount in words is "चौध हजार दुई सय मात्र" (14200) and the year on the
 * paper is older / overwritten. The app must prefer the words amount when
 * a digit confusion explains the gap, flag the out-of-window date instead
 * of silently filling it, keep Man/Mangsir as month 08 (conversion is
 * correct), and not keep doc_kind bank_transfer for a cash voucher.
 * Run: npx --yes tsx tests/ocr/kharchaVoucherWordsDate.selftest.mts
 */
import { adToBs, NEPALI_MONTHS, NEPALI_MONTHS_SHORT } from "../../src/lib/bs-date";
import { defaultVoucherDateWindow, localYmd, resolveBillDate } from "../../src/lib/ocr/dates";
import {
  aiAmountCheck,
  applyAiToBill,
  downgradeCashBankTransfer,
  normalizeAiVoucher,
  parseAmountInWords,
  resolveAiAmounts,
  type OcrAiResult,
} from "../../src/modules/ocr/ai/aiVoucher";
import { digitConfusionExplains } from "../../src/modules/ocr/ai/amountWords";
import { parseBill } from "../../src/modules/ocr/parser";
import type { OcrRawResult } from "../../src/modules/ocr/types";

let fail = 0;
const ok = (c: boolean, m: string, dbg?: unknown) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; if (dbg !== undefined) console.log("   dbg:", typeof dbg === "string" ? dbg : JSON.stringify(dbg)); }
};

const WORDS = "चौध हजार दुई सय मात्र";
const WORDS_LINE = "अक्षरेपी रु. चौध हजार दुई सय मात्र";
const NOW = new Date(2026, 10, 19); // 19 Nov 2026, BS 2083-08-03
const window = defaultVoucherDateWindow(NOW);

ok(parseAmountInWords(WORDS) === 14200, `words: चौध हजार दुई सय मात्र -> 14200 (got ${parseAmountInWords(WORDS)})`);
ok(parseAmountInWords(WORDS_LINE) === 14200, `words with अक्षरेपी/रु: ${parseAmountInWords(WORDS_LINE)}`);
ok(parseAmountInWords("चौदह हजार दो सौ मात्र") === 14200, "Hindi: चौदह हजार दो सौ");
ok(parseAmountInWords("Rupees Ten Thousand Only") === 10000, "English words still parse");
ok(parseAmountInWords("Rs. One Lakh Twenty Thousand Five Hundred and Paisa Fifty Only") === 120500.5, "English lakh + paisa still parse");
ok(parseAmountInWords("१०,०००/- मात्र") === 10000, "Devanagari digits-only words line still parses");

ok(digitConfusionExplains(98200, 14200), "98200 vs 14200 is ९↔१ and ८↔४");
ok(digitConfusionExplains(90000, 10000), "90000 vs 10000 is ९↔१");
ok(!digitConfusionExplains(50000, 10000), "50000 vs 10000 is not a known confusion");

const gemini = normalizeAiVoucher({
  voucher_type: "direct_expense",
  voucher_type_reason: "Expense voucher paid in cash with no party ledger on the other side.",
  doc_kind: "bank_transfer",
  doc_type: "expense",
  our_company_role: "none",
  bank_flow: "out",
  bank_flow_reason: "Cash paid out for expense voucher.",
  payment_mode: "cash",
  invoice_no: "170",
  date_ad: null,
  date_bs: "2079-08-18",
  date_bs_raw: "१८/०८/२०७९",
  amount_in_words: WORDS,
  grand_total: 98200,
  lines: [
    { side: "dr", kind: "expense", name: "साकिर हुसेन नगद दिईएको", amount: 98200 },
    { side: "cr", kind: "cash", name: "Cash", amount: 98200 },
  ],
  raw_text: [
    "न्यु पर्सा इन्जिनियरीङ् वर्कशप",
    "खर्च भौचर | मिति: १८/०८/२०७९",
    "भौ. नं.: १७०",
    "क्र.सं. | विवरण | खाता पान नं. | डेबिट रकम",
    "| साकिर हुसेन | | ९८२००/-",
    "| नगद दिईएको | |",
    "| हस्ते: साकिर हुसेन | |",
    "| | जम्मा | ९८२००/-",
    "अक्षरेपी रु. चौध हजार दुई सय मात्र",
  ].join("\n"),
  uncertain_fields: [],
});

ok(gemini.doc_kind === "other", `cash खर्च भौचर is not bank_transfer (got ${gemini.doc_kind})`);
ok(downgradeCashBankTransfer("bank_transfer", { payment_mode: "cash", raw_text: "नगद दिईएको खर्च भौचर" }) === "other", "downgrade helper: cash voucher");
ok(downgradeCashBankTransfer("bank_transfer", { payment_mode: null, transfer_reference: "TXN123", debit_bank: "NMB Bank", raw_text: "connectIPS" }) === "bank_transfer", "real bank slip stays bank_transfer");

const resolved = resolveAiAmounts(gemini);
ok(resolved.preferredWords?.from === 98200 && resolved.preferredWords?.to === 14200, "prefer words 14200 over confused digits 98200", resolved.preferredWords);
ok(resolved.data.grand_total === 14200 && resolved.data.lines.every((l) => l.amount === 14200), "grand + both lines corrected to 14200", resolved.data.lines);
ok(resolved.check.ok && resolved.check.wordsAmount === 14200, "after correction, amount check is ok", resolved.check);

const unexplained = aiAmountCheck(normalizeAiVoucher({
  voucher_type: "sale",
  grand_total: 50000,
  items: [{ description: "A", qty: 1, rate: 50000, amount: 50000 }],
  amount_in_words: "Ten Thousand Only",
}));
ok(!unexplained.ok, "unexplained words/digits mismatch is still flagged", unexplained);

const stillDetect = aiAmountCheck(normalizeAiVoucher({
  voucher_type: "sale",
  grand_total: 90000,
  items: [{ description: "A", qty: 1, rate: 10000, amount: 10000 }],
  amount_in_words: "Ten Thousand Only",
}));
ok(!stillDetect.ok && stillDetect.reasons.length === 2, "aiAmountCheck still reports the raw 90000 mismatch (correction is resolveAiAmounts)", stillDetect);

const rMan = resolveBillDate("INVOICE MITI : 2079-08-18", window);
ok(!!rMan && localYmd(rMan.date) === "2022-12-04", `2079-08-18 converts to 2022-12-04 AD (not April): ${rMan ? localYmd(rMan.date) : "null"}`);
const bs = adToBs(rMan!.date);
ok(bs.y === 2079 && bs.m === 8 && NEPALI_MONTHS[7] === "Mangsir" && NEPALI_MONTHS_SHORT[7] === "Man", `month 08 is Mangsir/Man (got ${NEPALI_MONTHS[bs.m - 1]}/${NEPALI_MONTHS_SHORT[bs.m - 1]})`);
ok(rMan?.status === "flag", `out-of-window 2079 date is flagged, not silently filled (${rMan?.status}: ${rMan?.note})`, rMan?.note);
ok(/confirm the year/i.test(rMan?.note ?? ""), "flag note asks the user to confirm the year");
ok(/2073/.test(rMan?.note ?? ""), `note mentions possible confusion with 2073 (${rMan?.note})`);

const current = resolveBillDate("INVOICE MITI : 2083-08-03", window);
ok(!!current && localYmd(current.date) === "2026-11-19" && current.status === "fill", `current-year Mangsir still fills: ${current ? `${localYmd(current.date)} ${current.status}` : "null"}`);

const inRangePratik = resolveBillDate("INVOICE MITI : 27/04/2083", window);
ok(!!inRangePratik && localYmd(inRangePratik.date) === "2026-08-12" && inRangePratik.status === "fill", `in-window Shrawan 2083 still fills: ${inRangePratik ? `${localYmd(inRangePratik.date)} ${inRangePratik.status}` : "null"}`);

const aiRes = (data = gemini): OcrAiResult => ({
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  data,
  usage: { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 },
});
const rawOf = (ai: OcrAiResult): OcrRawResult => {
  const text = "INVOICE NO. : 170\nINVOICE MITI : 2079-08-18\nMODE OF PAYMENT : cash\nGRAND TOTAL 98200.00\nIN WORDS : " + WORDS;
  const lines = text.split("\n");
  return { text, lines: lines.map((t, i) => ({ text: t, confidence: 95, y: 40 + i * 30 })), meanConfidence: 95, pageHeight: 800, engine: "gemini", ai };
};

const bill = parseBill(rawOf(aiRes()), { kind: "direct_expense" as never, parties: [], items: [], ownPan: "303687786", ownName: "New Parsa Engineering Workshop" });
// applyAiToBill is invoked from parseBill when ai is present; call again only if needed.
ok(bill.amount?.value === 14200 || bill.total?.value === 14200, `apply/parse fills 14200 not 98200 (amount=${bill.amount?.value} total=${bill.total?.value})`, bill.debug);
ok(bill.date?.status === "flag" && localYmd(bill.date.value) === "2022-12-04", `date suggested as 2022-12-04 but flagged (${bill.date?.status} ${localYmd(bill.date?.value)} ${bill.date?.note})`, bill.debug);
ok(bill.docType?.type === "direct_expense", `voucher type stays direct_expense (${bill.docType?.type})`);
ok((bill.debug ?? []).some((x) => /words 14200 preferred over digits 98200/i.test(x)), "debug records the words preference", bill.debug);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
