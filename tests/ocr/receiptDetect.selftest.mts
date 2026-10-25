import { detectReceipt, maskedAccountMatches, companyNameMatches } from "../../src/lib/ocr/receiptDetect/index";

const SAMPLE = `connect IPS
Payment Transaction Details
Transaction Details
Transaction Id: 749790846
Debit Status: SUCCESS
Credit Status: SUCCESS
Transaction Amount: NPR 125,000.00
Charge Amount: NPR 8.00
Transaction Date: 17-Oct-2026 01:44:04 PM
Reference Id: ACCOUNTFT:Nabiullah Ansari
Remarks:
Particulars: Advance
Customer Account Details
Bank Name: 2601-Prabhu Bank Limited
Bank Branch: 54-Itahari Branch
Account No.: 054**********013
Beneficiary Details
Bank Name: 2501-NMB Bank Limited
Bank Branch: 28-Birtamod Branch
Account No.: 028**********011
Account Name.: bharaman Iron Private Limited
For any further information please contact Prabhu Bank Limited`;
const withPart = (p: string) => SAMPLE.replace("Particulars: Advance", `Particulars: ${p}`);

const prabhu = { id: "A1", accountName: "Prabhu Itahari", bankName: "Prabhu Bank", accountNumber: "0540000000123013" };
const nmb = { id: "A2", accountName: "NMB Birtamod", bankName: "NMB Bank Ltd", accountNumber: "0280100000456011" };
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

ok(maskedAccountMatches("054**********013", "0540000000123013"), "mask match");
ok(maskedAccountMatches("054**********9013", "0540000000129013"), "mask uses last 3 (4 shown)");
ok(!maskedAccountMatches("054**********013", "0540000000123014"), "mask mismatch suffix");
ok(!maskedAccountMatches("054**********013", "0640000000123013"), "mask mismatch prefix");
ok(companyNameMatches("bharaman Iron Private Limited", "Bharaman Iron Pvt. Ltd."), "company name fuzzy");
ok(!companyNameMatches("bharaman Iron Private Limited", "Balgram Traders Pvt Ltd"), "company name differs");

const r0 = detectReceipt(SAMPLE, { ownAccounts: [] });
ok(r0.format === "connectips" && r0.confidence >= 0.9, `format ${r0.format} ${r0.confidence}`);
ok(r0.parsed?.amount === 125000 && r0.parsed?.charge === 8 && r0.parsed?.txnId === "749790846", "amounts/txn");
ok(r0.voucherType === null && r0.candidates[0] === "payment_out" && r0.otherCharge?.amount === 8, "no own accounts + named beneficiary -> payment_out first, charge");
const rNo = detectReceipt(SAMPLE.replace("Account Name.: bharaman Iron Private Limited", ""), { ownAccounts: [] });
ok(rNo.voucherType === null && rNo.candidates.length === 5 && !rNo.otherCharge, "no own match, no beneficiary name -> unknown, no charge");

const c = detectReceipt(SAMPLE, { ownAccounts: [prabhu, nmb] });
ok(c.voucherType === "contra" && c.otherCharge?.amount === 8, "both -> contra + charge 8");

const parties = [{ id: "P1", name: "Bharaman Iron Pvt. Ltd." }, { id: "P2", name: "Shree Hardware Suppliers" }];
const staff = [{ id: "S1", name: "Ram Bahadur Thapa" }];
const o1 = detectReceipt(SAMPLE, { ownAccounts: [prabhu], parties, staff });
ok(o1.voucherType === "payment_out" && o1.payeeType === "party" && o1.master.kind === "party" && o1.master.id === "P1" && o1.otherCharge?.amount === 8, "out + party -> payment_out, master P1, charge: " + o1.reason);
ok(!!o1.narration?.includes("connectIPS Account: Nabiullah Ansari") && o1.narration.includes("749790846") && o1.narration.includes("Advance"), "narration: " + o1.narration);
ok(o1.counterParty === "bharaman Iron Private Limited", "counter-party = beneficiary name, not reference id");
const o1b = detectReceipt(SAMPLE.replace("bharaman", "bharamon"), { ownAccounts: [prabhu], parties, staff });
ok(o1b.master.id === "P1", "one OCR slip still matches party (score " + o1b.master.score.toFixed(2) + ")");
const o2 = detectReceipt(withPart("Salary Oct"), { ownAccounts: [prabhu], parties, staff });
ok(o2.voucherType === "payment_out" && o2.master.kind === "party", "Particulars 'Salary' no longer changes type");
const stf = SAMPLE.replace("bharaman Iron Private Limited", "RAM BAHADUR THAPA");
const o3 = detectReceipt(stf, { ownAccounts: [prabhu], parties, staff });
ok(o3.voucherType === "payment_out" && o3.payeeType === "staff" && o3.master.id === "S1", "out + staff -> payment_out (staff): " + o3.reason);
const o4 = detectReceipt(SAMPLE, { ownAccounts: [prabhu], parties: [{ id: "P9", name: "Unrelated Traders" }], staff });
ok(o4.voucherType === "direct_expense" && o4.candidates.join() === "direct_expense,payment_out" && o4.master.kind === null && o4.otherCharge?.amount === 8, "out + no master -> direct_expense / payment_out");
const own2 = { id: "A4", accountName: "bharaman Iron Private Limited", bankName: "NMB", accountNumber: "" };
const o5 = detectReceipt(SAMPLE, { ownAccounts: [prabhu, own2], parties });
ok(o5.voucherType === "contra" && o5.master.kind === "own_bank", "beneficiary name = own bank ledger name -> contra (beats party)");
const i1 = detectReceipt(SAMPLE, { ownAccounts: [nmb], parties });
ok(i1.voucherType === null && i1.candidates.join() === "payment_in,direct_income" && !i1.otherCharge && i1.counterParty === null && i1.master.kind === "own_bank", "in by acct -> payment_in/direct_income, no charge: " + i1.reason);
const i2 = detectReceipt(SAMPLE, { ownAccounts: [], companyName: "Bharaman Iron Pvt Ltd", parties });
ok(i2.master.kind === "own_bank" && i2.ownSideConfidence === 0.99 && i2.candidates[0] === "payment_in", "in by company name 0.99 (beats party list)");
const i3 = detectReceipt(SAMPLE, { ownAccounts: [prabhu], companyName: "Bharaman Iron Private Limited" });
ok(i3.voucherType === "contra", "sender own + beneficiary company name -> contra");

// User case: Sale tab, company "New Parsa Engineering WorkShop", no matching own accounts
const np = detectReceipt(SAMPLE, { ownAccounts: [{ id: "X1", accountName: "Cash", accountType: "Cash" }, { id: "X2", accountName: "Global IME", bankName: "Global IME Bank", accountNumber: "0123456789999" }], companyName: "New Parsa Engineering WorkShop", parties: [{ id: "P9", name: "Unrelated Traders" }], staff });
ok(np.voucherType === null && np.candidates[0] === "payment_out" && np.candidates[1] === "direct_expense" && np.master.kind !== "own_bank" && np.otherCharge?.amount === 8, "New Parsa, no own match -> Payment Out first, Direct Expense 2nd: " + np.candidates.join(","));
const np2 = detectReceipt(SAMPLE, { ownAccounts: [], companyName: "New Parsa Engineering WorkShop", parties, staff });
ok(np2.voucherType === "payment_out" && np2.payeeType === "party" && np2.master.id === "P1", "New Parsa, beneficiary is party -> payment_out decisive");
const np3 = detectReceipt(SAMPLE.replace("bharaman Iron Private Limited", "New Parsa Engineering Workshop Pvt Ltd"), { ownAccounts: [], companyName: "New Parsa Engineering WorkShop" });
ok(np3.candidates[0] === "payment_in" && np3.master.kind === "own_bank", "beneficiary = own company name -> payment_in first");

const flat = SAMPLE.replace(/\n/g, "; ").replace("connect IPS", "ConnectIPS");
ok(detectReceipt(flat, { ownAccounts: [prabhu, nmb] }).voucherType === "contra", "single-line/noisy text");
ok(detectReceipt("Some random bill", { ownAccounts: [] }).format === null, "non-receipt");
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
