import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectReceipt, maskedAccountMatches } from "../../src/lib/ocr/receiptDetect/index";
import { buildMoneyVoucherFill, suggestMaskedPayees } from "../../src/lib/ocr/receiptDetect/fillPaymentOut";
import { parseSingleDocDate } from "../../src/lib/ocr/dates";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

const ownPrabhu = { id: "OP", accountName: "Prabhu Current", bankName: "Prabhu Bank", accountNumber: "0540168800011" };
const ownNmb = { id: "ON", accountName: "NMB Inaruwa", bankName: "NMB Bank", accountNumber: "208000000000010", branch: "Inaruwa" };
const dinesh = { id: "PD", name: "Dinesh sah Kanu" };

/* ---- 1. Prabhu payment receipt ---- */
{
  const text = fx("prabhu-payment-receipt.txt");
  const r = detectReceipt(text, { ownAccounts: [ownPrabhu], parties: [], staff: [] });
  ok(r.format === "prabhu", `prabhu format: ${r.format}`);
  ok(r.parsed?.amount === 68710, `prabhu amount ${r.parsed?.amount}`);
  ok(r.parsed?.initiatorPhone === "9800985312", `initiator ${r.parsed?.initiatorPhone}`);
  ok(r.parsed?.remarks?.toLowerCase().includes("jasta ra cement"), `remarks ${r.parsed?.remarks}`);
  const d = parseSingleDocDate(r.parsed?.date ?? "");
  ok(!!d && d.getFullYear() === 2026 && d.getMonth() === 10 && d.getDate() === 6, `prabhu date ${r.parsed?.date}`);
  ok(r.voucherType === "payment_out" && r.partyMissing === true, `prabhu type payment + party missing: ${r.voucherType} ${r.reason}`);
  ok(!r.statusWarning, "prabhu SUCCESS has no status warning");
  const sug = suggestMaskedPayees(r.parsed?.beneficiary.accountName, { parties: [{ id: "SH", name: "Hari SHRESTHA" }] });
  ok(sug.length === 1 && sug[0].id === "SH", "masked ******* SHRESTHA suggests Hari SHRESTHA (not auto-fill)");
}

/* ---- 2. connectIPS NMB ---- */
{
  const text = fx("connectips-nmb.txt");
  ok(maskedAccountMatches("208***010", ownNmb.accountNumber), "NMB short mask matches stored A/c");
  const unknown = detectReceipt(text, { ownAccounts: [ownNmb], parties: [], staff: [], companyName: "New Parsa Engineering WorkShop" });
  ok(unknown.format === "connectips", `connectips format: ${unknown.format}`);
  ok(unknown.parsed?.amount === 120000 && unknown.parsed?.charge === 8 && unknown.parsed?.txnId === "761083772", "connectips amounts/txn");
  ok(unknown.voucherType === "payment_out" && unknown.partyMissing === true, `connectips: Payment + create Dinesh, not DE: ${unknown.reason}`);
  const known = detectReceipt(text, { ownAccounts: [ownNmb], parties: [dinesh], staff: [], companyName: "New Parsa Engineering WorkShop" });
  ok(known.voucherType === "payment_out" && known.payeeType === "party" && known.master.id === "PD", "connectips payee Dinesh when in masters");
  const fill = buildMoneyVoucherFill(unknown.parsed!, "payment_out", { ownAccounts: [ownNmb], parties: [dinesh] });
  ok(fill.from.ok && fill.from.id === "ON", "connectips from-account is NMB Inaruwa: " + (fill.from.ok ? fill.from.reason : fill.from.reason));
  ok(fill.date?.getDate() === 6 && fill.date.getMonth() === 10, "connectips date 6 Nov");
  ok(fill.narration.includes("761083772") && fill.narration.toLowerCase().includes("butwal"), "narration has txn + particulars");
}

/* ---- 3. Pratik tax invoice ---- */
{
  const text = fx("pratik-tax-invoice.txt");
  const r = detectReceipt(text, { ownAccounts: [], companyName: "New Parsa Engineering Workshop" });
  ok(r.format === "tax_invoice", `tax invoice format: ${r.format}`);
  ok(r.parsed === null, "tax invoice is bill-like — parseBill handles fields");
  const d = parseSingleDocDate("15/07/2083");
  ok(!!d && !Number.isNaN(d.getTime()), "invoice miti 15/07/2083 parses");
}

/* ---- 4. Handwritten kharcha voucher ---- */
{
  const text = fx("handwritten-kharcha-voucher.txt");
  const cash = { id: "CA", accountName: "Cash in Hand", accountType: "Cash", bankName: "Cash" };
  const r = detectReceipt(text, { ownAccounts: [cash], parties: [], staff: [] });
  ok(r.format === "handwritten_voucher", `handwritten format: ${r.format}`);
  ok(r.parsed?.amount === 2000, `amount ${r.parsed?.amount}`);
  ok(r.parsed?.voucherNo === "95", `voucher no ${r.parsed?.voucherNo}`);
  ok(r.parsed?.beneficiary.accountName?.toLowerCase().includes("surya narayan"), `payee ${r.parsed?.beneficiary.accountName}`);
  const d = parseSingleDocDate(r.parsed?.date ?? "");
  ok(!!d && !Number.isNaN(d.getTime()), `miti ${r.parsed?.date}`);
  ok(r.voucherType === "payment_out" || r.candidates[0] === "payment_out", `type payment-ish: ${r.voucherType} ${r.reason}`);
  const fill = buildMoneyVoucherFill(r.parsed!, "payment_out", { ownAccounts: [cash], parties: [] });
  ok(fill.from.ok && fill.from.id === "CA", "cash account matched: " + (fill.from.ok ? fill.from.reason : fill.from.reason));
  ok(fill.payee == null && !!fill.payeeName, "Surya Narayan Dhami not in masters -> create party");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
