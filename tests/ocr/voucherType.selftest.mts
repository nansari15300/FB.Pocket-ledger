/** Voucher type detection (ACR): own company position on an invoice -> Sale / Purchase; bank slips untouched. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBill } from "../../src/modules/ocr/parser";
import { ownNameRule, textHasOwnName } from "../../src/modules/ocr/ownCompany";
import { isOwnCompany } from "../../src/modules/ocr/extras";
import { sameVoucherBucket } from "../../src/modules/ocr/handoff";
import { detectReceipt } from "../../src/lib/ocr/receiptDetect/index";
import { AUTO_SWITCH_MIN_CONF } from "../../src/lib/ocr/receiptDetect/types";
import type { OcrRawResult } from "../../src/modules/ocr/types";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");
let fail = 0;
const ok = (c: boolean, m: string, dbg?: string[]) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) { fail++; for (const d of dbg ?? []) console.log("   dbg:", d); }
};
const raw = (text: string): OcrRawResult => {
  const lines = text.split(/\r?\n/).filter((t) => t.trim());
  return { text, lines: lines.map((t, i) => ({ text: t, confidence: 85, y: 40 + i * 30 })), meanConfidence: 85, pageHeight: 40 + 30 * Math.max(20, lines.length) };
};
// company profile as the app shows it (trailing "Demo Company" and mixed case) + profile PAN (only in tests)
const PROFILE = { name: "New parsa Engineering WorkShop Demo Company", pan: "303687786" };
const parse = (text: string, own: { name?: string | null; pan?: string | null } = PROFILE, kind: "purchase" | "sale" = "sale") =>
  parseBill(raw(text), { kind, parties: [], items: [], ownPan: own.pan ?? null, ownName: own.name ?? null });

/* ---- name rule ---- */
{
  const r = ownNameRule(PROFILE.name);
  ok(JSON.stringify(r?.tokens) === JSON.stringify(["new", "parsa", "engineering", "workshop"]), `profile tokens drop "Demo Company": ${r?.tokens}`);
  ok(textHasOwnName("Customer Name : NEW PARSA ENGINEERING WORKSHOP", r), "uppercase bill name matches");
  ok(textHasOwnName("M/S New Parsa Engineering Works", r), "first 3 tokens (prefix) match");
  ok(textHasOwnName("NEW PARSA ENGINEERlNG WORKSHOP PVT. LTD.", r), "one OCR slip + Pvt. Ltd. tolerated");
  ok(!textHasOwnName("New Engineering Workshop", r), "generic words only -> no match");
  ok(!textHasOwnName("Parsa Engineering Workshop", r), "missing first token -> no match");
  ok(!textHasOwnName("PRATIK TRADE CENTER PVT.LTD.", r), "other company -> no match");
  ok(ownNameRule("New parsa Engineering WorkShop Demo Compn...")?.tokens.join(" ") === "new parsa engineering workshop", "truncated 'Compn...' dropped");
  ok(isOwnCompany("NEW PARSA ENGINEERING WORKSHOP", null, { name: PROFILE.name }), "isOwnCompany: tolerant name");
  ok(!isOwnCompany("PRATIK TRADE CENTER PVT.LTD.", null, { name: PROFILE.name }), "isOwnCompany: other party");
}

/* ---- 1. Pratik tax invoice: we are the CUSTOMER -> Purchase (auto-switch grade) ---- */
const pratik = fx("pratik-tax-invoice-live.txt");
{
  const b = parse(pratik);
  ok(b.docType?.type === "purchase", `Pratik -> purchase: ${b.docType?.type} (${b.docType?.reason})`, b.debug);
  ok((b.docType?.confidence ?? 0) >= 0.95, `Pratik confidence ${b.docType?.confidence} >= 0.95 (PAN + name + Tax Invoice)`);
  ok((b.docType?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF, "Pratik confidence clears the auto-switch threshold");
  ok(!sameVoucherBucket("payment_out", b.docType!.type), "from Payment form: switch suggestion is created");
  ok(b.pan?.value === "619727215", `counter-party PAN is the seller's: ${b.pan?.value}`);
  ok(!/parsa/i.test(b.partyName?.value ?? ""), `party is not us: ${b.partyName?.value}`);
  const noPan = parse(pratik, { name: PROFILE.name, pan: null });
  ok(noPan.docType?.type === "purchase" && (noPan.docType?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF, `Pratik, profile without PAN (name only): ${noPan.docType?.type} ${noPan.docType?.confidence}`, noPan.debug);
  const panOnly = parse(pratik, { name: null, pan: PROFILE.pan });
  ok(panOnly.docType?.type === "purchase" && panOnly.docType.confidence >= 0.95, `Pratik, PAN only: ${panOnly.docType?.type} ${panOnly.docType?.confidence}`);
  const fx0 = parse(fx("pratik-tax-invoice.txt"));
  ok(fx0.docType?.type === "purchase", `old Pratik fixture (Buyer / Party Name) -> purchase: ${fx0.docType?.type}`);
}

/* ---- name split over two OCR lines ---- */
{
  const t = pratik.replace("Customer Name : NEW PARSA ENGINEERING WORKSHOP", "Customer Name : NEW PARSA\nENGINEERING WORKSHOP").replace(/PAN No\s*:\s*303687786\n?/, "");
  const b = parse(t, { name: PROFILE.name, pan: null });
  ok(b.docType?.type === "purchase" && (b.docType?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF, `name across 2 lines -> purchase ${b.docType?.confidence}`, b.debug);
}

/* ---- 2. Invoice issued BY us -> Sale ---- */
{
  const t = [
    "NEW PARSA ENGINEERING WORKSHOP",
    "Birgunj-13, Parsa",
    "PAN No : 303687786",
    "TAX INVOICE",
    "Invoice No : NPE-0045 Date : 2083/07/20",
    "Bill To : Sharma Builders Pvt. Ltd.",
    "Address : Kalaiya",
    "PAN No : 609111222",
    "S.N. Particulars Qty Rate Amount",
    "1 Gate Fabrication 1 20000 20,000.00",
    "Taxable Amount 20,000.00",
    "VAT 13% 2,600.00",
    "Grand Total 22,600.00",
  ].join("\n");
  const b = parse(t, PROFILE, "purchase");
  ok(b.docType?.type === "sale" && (b.docType?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF, `issued by us -> sale ${b.docType?.confidence} (${b.docType?.reason})`, b.debug);
  const n = parse(t.replace("PAN No : 303687786\n", ""), { name: PROFILE.name, pan: null }, "purchase");
  ok(n.docType?.type === "sale" && n.docType.confidence >= 0.9, `issued by us, name only -> sale ${n.docType?.confidence}`);
}

/* ---- 3. Our company absent -> Purchase ---- */
{
  const t = [
    "RAM HARDWARE SUPPLIERS",
    "Kalaiya, Bara",
    "PAN No : 600555444",
    "TAX INVOICE",
    "Invoice No : RH-778 Date : 2083/07/18",
    "Customer : Cash",
    "S.N. Particulars Qty Rate Amount",
    "1 Welding Rod 2 1500 3,000.00",
    "Taxable Amount 3,000.00",
    "VAT 13% 390.00",
    "Grand Total 3,390.00",
  ].join("\n");
  const b = parse(t);
  ok(b.docType?.type === "purchase" && (b.docType?.confidence ?? 0) >= AUTO_SWITCH_MIN_CONF, `absent -> purchase ${b.docType?.confidence} (${b.docType?.reason})`, b.debug);
  const np = parse(t, { name: null, pan: null });
  ok(np.docType?.type === "purchase" && np.docType.confidence < AUTO_SWITCH_MIN_CONF, `no company profile -> purchase suggestion only ${np.docType?.confidence}`);
}

/* ---- 4. Bank slips: fallback (receipt detector) unchanged, invoice rules never applied ---- */
{
  const prabhu = fx("prabhu-payment-receipt.txt");
  const own = { id: "OP", accountName: "Prabhu Current", bankName: "Prabhu Bank", accountNumber: "0540168800011" };
  const r = detectReceipt(prabhu, { ownAccounts: [own], parties: [], staff: [], companyName: PROFILE.name });
  ok(r.format === "prabhu" && r.voucherType === "payment_out", `prabhu slip still Payment via receipt detector: ${r.format} ${r.voucherType}`);
  const ips = detectReceipt(fx("connectips-nmb.txt"), { ownAccounts: [{ id: "ON", accountName: "NMB Inaruwa", bankName: "NMB Bank", accountNumber: "208000000000010" }], parties: [], staff: [], companyName: PROFILE.name });
  ok(ips.format === "connectips" && ips.voucherType === "payment_out", `connectIPS still Payment: ${ips.voucherType}`);
  const slip = parse(["NABIL BANK LIMITED", "CASH DEPOSIT SLIP", "Account Name : New Parsa Engineering Workshop", "Account No : 01234567890", "Amount : 50,000.00", "Depositor : Ram"].join("\n"));
  ok(slip.docType == null, `deposit slip with our name -> no invoice type (fallback): ${slip.docType?.type ?? "none"}`);
  const chq = parse(["CHEQUE", "Pay New Parsa Engineering Workshop", "Bill payment", "Rs 12,000.00"].join("\n"));
  ok(chq.docType == null, `cheque with "bill" word -> no invoice type: ${chq.docType?.type ?? "none"}`);
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
