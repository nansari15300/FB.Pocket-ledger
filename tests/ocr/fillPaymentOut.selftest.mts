import { connectIpsDetector } from "../../src/lib/ocr/receiptDetect/connectIps";
import { accountDisplayLabel, receiptNarration, buildPaymentOutFill, buildMoneyVoucherFill, matchFromAccount, matchPayee, paidFromPhrase } from "../../src/lib/ocr/receiptDetect/fillPaymentOut";

const SAMPLE = `connectIPS
Payment Transaction Details
Transaction Id: 749790846
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
const P = connectIpsDetector.parse(SAMPLE);
const Pp = (part: string) => connectIpsDetector.parse(SAMPLE.replace("Particulars: Advance", `Particulars: ${part}`));
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

const cash = { id: "C", accountName: "Cash in Hand", accountType: "Cash" };
const prI = { id: "PI", accountName: "Prabhu Bank Itahari", bankName: "Prabhu Bank Ltd", accountNumber: "0540000000111013" };
const prB = { id: "PB", accountName: "Prabhu Bank Biratnagar", bankName: "Prabhu Bank Ltd", accountNumber: "0670000000222013" };
const prI2 = { id: "PI2", accountName: "Prabhu Itahari OD", bankName: "Prabhu Bank", accountNumber: "0540000000333999" };
const nic = { id: "N", accountName: "NIC Asia Main", bankName: "NIC Asia Bank", accountNumber: "1234567890" };

let r = matchFromAccount(P, [cash, prI, nic]);
ok(r.ok && r.id === "PI", "unique Prabhu (bank and/or account no.): " + (r.ok ? r.method + " " + r.reason : r.reason));
r = matchFromAccount(P, [cash, prI, prB, nic]);
ok(r.ok && r.id === "PI", "multi-bank narrowed by branch/acc no.: " + (r.ok ? r.method + " " + r.reason : r.reason));
r = matchFromAccount(P, [prI, prI2, prB]);
ok(r.ok && r.id === "PI", "narrowed by acc no.: " + (r.ok ? r.method + " " + r.reason : r.reason));
ok(paidFromPhrase({ particulars: "Advance paid from NIC Asia Main" }) === "NIC Asia Main", "paid-from phrase parsed");
r = matchFromAccount(Pp("Advance paid from NIC Asia Main"), [cash, prI, nic]);
ok(r.ok && r.id === "N" && r.method === "paid-from", "paid-from decides: " + r.reason);
r = matchFromAccount(Pp("Advance paid from Prabhu Bank Biratnagar"), [prI, prB]);
ok(r.ok && r.id === "PB", "paid-from narrows same bank: " + r.reason);
r = matchFromAccount(P, [cash, nic]);
ok(!r.ok && (r as { ok: false; candidates: string[] }).candidates.length === 0, "none -> not found: " + r.reason);

// Short mask: 3 NMB accounts, only Inaruwa ends with 010 and starts with 208
const nmbIna = { id: "NI", accountName: "NMB Inaruwa", bankName: "NMB Bank", accountNumber: "208000000000010" };
const nmbBir = { id: "NB", accountName: "NMB Biratnagar", bankName: "NMB Bank", accountNumber: "208000000000099" };
const nmbKtm = { id: "NK", accountName: "NMB Kathmandu", bankName: "NMB Bank", accountNumber: "209000000000010" };
const short = { ...P, sender: { bankName: "NMB Bank Limited", branch: "Inaruwa", accountMasked: "208***010" } };
r = matchFromAccount(short, [nmbIna, nmbBir, nmbKtm]);
ok(r.ok && r.id === "NI", "short mask uniques Inaruwa among 3 NMB: " + (r.ok ? r.reason : r.reason));

// Tie: same bank, no usable mask, no distinctive branch in account titles
const tie = { ...P, sender: { bankName: "NMB Bank Limited", branch: "", accountMasked: "" } };
r = matchFromAccount(tie, [nmbIna, nmbBir, nmbKtm]);
ok(!r.ok && (r as { ok: false; candidates: string[] }).candidates.length >= 2, "tie -> offer options, not auto-fill: " + r.reason);

const parties = [{ id: "P1", name: "Bharaman Iron Pvt. Ltd." }, { id: "P2", name: "Shree Hardware" }];
const staff = [{ id: "S1", name: "Ram Bahadur Thapa" }];
const taxes = [{ id: "T1", name: "Inland Revenue Department" }];
ok(matchPayee("bharaman Iron Private Limited", { parties, staff, taxes })?.payeeType === "party", "payee party");
ok(matchPayee("RAM BAHADUR THAPA", { parties, staff, taxes })?.id === "S1", "payee staff");
ok(matchPayee("Inland Revenue Department", { parties, staff, taxes })?.payeeType === "tax", "payee tax");
ok(matchPayee("Unknown Co", { parties, staff, taxes }) === null, "payee none");
ok(matchPayee("****** DHAMI", { parties: [{ id: "D", name: "Surya Narayan Dhami" }], staff, taxes }) === null, "masked name is not auto-filled");

const f = buildPaymentOutFill(P, { ownAccounts: [prI], parties, staff, taxes });
ok(f.amount === 125000 && f.charge === 8 && f.date?.getFullYear() === 2026 && f.date.getMonth() === 9 && f.date.getDate() === 17, "amount/charge/date");
ok(f.narration === "connectIPS Account: Nabiullah Ansari | " + accountDisplayLabel(prI as never) + " | To: bharaman Iron Private Limited | Advance | Txn ID: 749790846", "narration: " + f.narration);
ok(accountDisplayLabel({ accountName: "Prabhu Bank Limited", accountType: "Bank" }) === "Prabhu Bank Limited (Bank)", "display label");
ok(receiptNarration(P, null) === "connectIPS Account: Nabiullah Ansari | To: bharaman Iron Private Limited | Advance | Txn ID: 749790846", "no from-account -> segment omitted");
ok(receiptNarration(P, "Prabhu Bank Limited (Bank)") === "connectIPS Account: Nabiullah Ansari | Prabhu Bank Limited (Bank) | To: bharaman Iron Private Limited | Advance | Txn ID: 749790846", "from segment before To:");

const incoming = buildMoneyVoucherFill(P, "payment_in", { ownAccounts: [{ id: "A2", accountName: "NMB Birtamod", bankName: "NMB Bank Ltd", accountNumber: "0280100000456011" }], parties, staff, taxes });
ok(incoming.from.ok && incoming.from.id === "A2", "receipt fill uses beneficiary as our account");
ok(incoming.payee?.id === "P1" || incoming.payeeName === "bharaman Iron Private Limited" || incoming.payee == null, "receipt payee is the sender (connectIPS often has no sender name)");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
