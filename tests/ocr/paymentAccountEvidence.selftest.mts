/**
 * Create-bank-from is offered only when the document actually names a payment account.
 * Company letterhead / display name is not a bank account. Run:
 *   npx --yes tsx tests/ocr/paymentAccountEvidence.selftest.mts
 */
import { companyNameMatches } from "../../src/lib/ocr/receiptDetect/match";
import {
  hasCashWording,
  mergeReceiptAccountSide,
  ownCashAccounts,
  paymentAccountEvidence,
  planMissingPaymentAccount,
  printedAccountLabel,
} from "../../src/lib/ocr/receiptDetect/paymentAccountEvidence";
import { noPaymentAccountOnDocIntro, NO_PAYMENT_ACCOUNT_ON_DOC } from "../../src/modules/ocr/paymentAccountIntro";
import type { OwnAccountLike, ParsedReceipt } from "../../src/lib/ocr/receiptDetect/types";

let fail = 0;
const ok = (c: boolean, m: string, dbg?: unknown) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) {
    fail++;
    if (dbg !== undefined) console.log("   dbg:", dbg);
  }
};

const company = "New parsa Engineering WorkShop Demo Compnany";
const own: OwnAccountLike[] = [
  { id: "h1", accountName: "New Parsa Engineering Workshop Himalayan Bank", bankName: "Himalayan Bank", accountType: "Bank" },
  { id: "p1", accountName: "New Parsa Engineering Workshop Prabhu Bank", bankName: "Prabhu Bank", accountType: "Bank" },
  { id: "p2", accountName: "Nabiullaha Ansari Prabhu bank", bankName: "Prabhu Bank", accountType: "Bank" },
  { id: "r1", accountName: "Ritika Dhami", accountType: "Bank" },
];
const ownWithCash: OwnAccountLike[] = [...own, { id: "c1", accountName: "Cash in Hand", accountType: "Cash" }];

const kharcha: ParsedReceipt = {
  voucherNo: "170",
  date: "18/04/2078",
  amount: 14200,
  particulars: "साकिर हुसेन, नगद दिइएको",
  paymentMode: undefined,
  sender: { accountName: company },
  beneficiary: { accountName: "साकिर हुसेन" },
};

ok(hasCashWording("साकिर हुसेन, नगद दिइएको"), "nagd diye ko is cash wording");
ok(hasCashWording("Cash paid to Surya"), "english cash paid is cash wording");
ok(!hasCashWording("kharcha voucher of New Parsa Engineering Workshop"), "company heading alone is not cash wording");

ok(printedAccountLabel(company, company) === "", "company display name is not a printed account label");
ok(printedAccountLabel("Prabhu Bank Limited", company) === "Prabhu Bank Limited", "real bank name is kept");
ok(companyNameMatches(company, "New Parsa Engineering Workshop Demo Company") || companyNameMatches("New Parsa Engineering Workshop", "New Parsa Engineering WorkShop"), "company matcher still works on close names");

const evKharcha = paymentAccountEvidence({
  side: kharcha.sender,
  parsed: kharcha,
  companyName: company,
  paymentMode: null,
  text: "Kharcha voucher\n" + "साकिर हुसेन, नगद दिइएको",
});
ok(evKharcha.hasCashWording, "kharcha voucher has cash wording", evKharcha);
ok(!evKharcha.hasBankOrWalletEvidence, "kharcha voucher has no bank/wallet evidence", evKharcha);
ok(evKharcha.prefillName === "", "kharcha voucher prefill is not the company name", evKharcha);
ok(planMissingPaymentAccount(evKharcha, own).kind === "info-no-account", "no cash ledger -> info note, not create bank");
ok(planMissingPaymentAccount(evKharcha, ownWithCash).kind === "use-cash", "cash wording + cash ledger -> use existing cash");
ok((planMissingPaymentAccount(evKharcha, ownWithCash) as { kind: string; accounts?: { id: string }[] }).accounts?.[0]?.id === "c1", "use-cash points at the cash ledger");

const evEmpty = paymentAccountEvidence({
  side: {},
  parsed: { sender: {}, beneficiary: {}, particulars: "workshop supplies" },
  companyName: company,
  text: "expense voucher",
});
ok(!evEmpty.hasCashWording && !evEmpty.hasBankOrWalletEvidence, "no account mention -> no evidence");
ok(planMissingPaymentAccount(evEmpty, own).kind === "info-no-account", "no mention -> info note");
ok(planMissingPaymentAccount(evEmpty, ownWithCash).kind === "info-no-account", "no mention does not offer cash just because a cash ledger exists");

const evBank = paymentAccountEvidence({
  side: { bankName: "Prabhu Bank Limited", accountMasked: "054**********013", accountName: company },
  parsed: { sender: { bankName: "Prabhu Bank Limited", accountMasked: "054**********013", accountName: company }, beneficiary: {} },
  companyName: company,
});
ok(evBank.hasBankOrWalletEvidence, "bank name + account no is evidence");
ok(evBank.prefillName === "Prabhu Bank Limited", "prefill is the bank, not the company", evBank);
ok(planMissingPaymentAccount(evBank, own).kind === "create-bank", "bank evidence -> create bank");
ok((planMissingPaymentAccount(evBank, own) as { name?: string }).name === "Prabhu Bank Limited", "create-bank name is the bank");

const evWallet = paymentAccountEvidence({
  side: { bankName: "eSewa" },
  parsed: { sender: { bankName: "eSewa" }, beneficiary: {}, paymentMode: "eSewa" },
  companyName: company,
  paymentMode: "eSewa",
});
ok(evWallet.hasBankOrWalletEvidence && planMissingPaymentAccount(evWallet, own).kind === "create-bank", "wallet is payment-account evidence");

const evCheque = paymentAccountEvidence({
  side: {},
  parsed: { sender: {}, beneficiary: {}, chequeNumber: "123456" },
  chequeNumber: "123456",
  docKind: "cheque",
  companyName: company,
});
ok(evCheque.hasBankOrWalletEvidence && planMissingPaymentAccount(evCheque, own).kind === "create-bank", "cheque is payment-account evidence");

ok(ownCashAccounts(own).length === 0, "listed company banks are not cash ledgers");
ok(ownCashAccounts(ownWithCash).map((a) => a.id).join() === "c1", "cash ledger is detected by accountType");

const merged = mergeReceiptAccountSide({ accountName: "Cash", bankName: "Cash" }, { accountName: undefined, bankName: undefined });
ok(merged.bankName === "Cash" && merged.accountName === "Cash", "undefined AI fields must not wipe a text Cash side");

ok(noPaymentAccountOnDocIntro("en") === "No payment account on doc", "intro en");
ok(noPaymentAccountOnDocIntro("hi") === NO_PAYMENT_ACCOUNT_ON_DOC.hi, "intro hi");
ok(noPaymentAccountOnDocIntro("ne") === NO_PAYMENT_ACCOUNT_ON_DOC.ne, "intro ne");
ok(/[\u0900-\u097F]/.test(NO_PAYMENT_ACCOUNT_ON_DOC.hi) && /[\u0900-\u097F]/.test(NO_PAYMENT_ACCOUNT_ON_DOC.ne), "hi/ne are Devanagari");
ok(noPaymentAccountOnDocIntro("fr") === "No payment account on doc", "unknown intro lang falls back to en");

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
