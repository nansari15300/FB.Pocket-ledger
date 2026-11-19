/**
 * Decide whether a money document actually names a Bank/Cash/payment account.
 * The company's own letterhead or display name is not a bank account.
 */
import { companyNameMatches } from "./match";
import type { OwnAccountLike, ParsedReceipt, ReceiptAccountSide } from "./types";

const CASH_WORD =
  /(?:\b(?:cash|nagd|nagad|nagaad)\b|\u0928\u0917\u0926|\u0928\u0915\u0926|\u0915\u0948\u0936)/i;

const WALLET_WORD =
  /\b(?:e-?sewa|khalti|ime\s*pay|fone\s*pay|prabhu\s*pay|cell\s*pay|moru|connect\s*ips|nic\s*pay|prabhu\s*wallet)\b/i;

const BANK_OR_CHEQUE_WORD =
  /(?:\b(?:bank|a\/c|acct|account\s*(?:no\.?|number|#)|iban|ifsc|swift|rtgs|neft|imps|cheque|check\s*no\.?|chk\s*no\.?)\b|\u092c\u0948\u0902\u0915|\u092c\u0948\u0919\u094d\u0915|\u091a\u0947\u0915)/i;

export function hasCashWording(text?: string | null): boolean {
  return !!String(text ?? "").trim() && CASH_WORD.test(String(text));
}

function hasWalletWording(text?: string | null): boolean {
  return !!String(text ?? "").trim() && WALLET_WORD.test(String(text));
}

function isCashLikeToken(s?: string | null): boolean {
  const t = String(s ?? "").trim();
  if (!t) return false;
  return /^(cash|nagd|nagad|nagaad|\u0928\u0917\u0926|\u0928\u0915\u0926|\u0915\u0948\u0936)(?:\s+(?:in\s+hand|account|a\/c))?$/i.test(t);
}

function isCompanyName(value?: string | null, companyName?: string | null): boolean {
  const v = String(value ?? "").trim();
  const c = String(companyName ?? "").trim();
  if (!v || !c) return false;
  return companyNameMatches(v, c);
}

function hasAccountNumber(s?: string | null): boolean {
  const t = String(s ?? "").replace(/\s+/g, "");
  if (!t) return false;
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 6) return true;
  return digits.length >= 3 && /[0-9][*#xX]{2,}[0-9]/.test(t);
}

/** A printed value that may name a bank/wallet/cash ledger, never the company itself. */
export function printedAccountLabel(value?: string | null, companyName?: string | null): string {
  const t = String(value ?? "").trim();
  if (!t || isCompanyName(t, companyName)) return "";
  return t;
}

export function isCashLedger(a: OwnAccountLike): boolean {
  if (String(a.accountType ?? "").trim().toLowerCase() === "cash") return true;
  const name = String(a.accountName ?? "").trim();
  const bank = String(a.bankName ?? "").trim();
  return isCashLikeToken(name) || /^(cash in hand|petty cash)$/i.test(name) || isCashLikeToken(bank);
}

export function ownCashAccounts(own: readonly OwnAccountLike[]): { id: string; name: string }[] {
  return own.filter((a) => a.id && isCashLedger(a)).map((a) => ({ id: a.id, name: a.accountName || a.id }));
}

export function mergeReceiptAccountSide(base?: ReceiptAccountSide, over?: ReceiptAccountSide): ReceiptAccountSide {
  return {
    bankName: over?.bankName || base?.bankName,
    branch: over?.branch || base?.branch,
    accountMasked: over?.accountMasked || base?.accountMasked,
    accountName: over?.accountName || base?.accountName,
  };
}

export type PaymentAccountEvidence = {
  hasCashWording: boolean;
  hasBankOrWalletEvidence: boolean;
  /** Prefill for "Create bank account"; empty when the only name is the company or there is none. */
  prefillName: string;
};

export type PaymentAccountEvidenceInput = {
  side?: ReceiptAccountSide | null;
  parsed?: ParsedReceipt | null;
  companyName?: string | null;
  paymentMode?: string | null;
  transferMode?: string | null;
  chequeNumber?: string | null;
  docKind?: string | null;
  text?: string | null;
};

function sideEvidence(side: ReceiptAccountSide | null | undefined, companyName?: string | null): { bank: boolean; prefill: string } {
  if (!side) return { bank: false, prefill: "" };
  const bankName = printedAccountLabel(side.bankName, companyName);
  const accountName = printedAccountLabel(side.accountName, companyName);
  const numbered = hasAccountNumber(side.accountMasked);
  const bankNamed = !!bankName && !isCashLikeToken(bankName);
  const wallet = hasWalletWording(side.bankName) || hasWalletWording(side.accountName);
  const namedAccount = !!accountName && !isCashLikeToken(accountName) && (numbered || bankNamed || wallet);
  const bank = numbered || bankNamed || wallet || namedAccount;
  const prefill = bankName || (namedAccount ? accountName : "") || (wallet ? accountName || bankName : "");
  return { bank, prefill };
}

export function paymentAccountEvidence(input: PaymentAccountEvidenceInput): PaymentAccountEvidence {
  const side = input.side ?? null;
  const blob = [
    input.text,
    input.paymentMode,
    input.transferMode,
    input.chequeNumber,
    input.parsed?.paymentMode,
    input.parsed?.particulars,
    input.parsed?.remarks,
    input.parsed?.chequeNumber,
    side?.bankName,
    side?.accountName,
    side?.accountMasked,
  ].filter(Boolean).join("\n");

  const fromSide = sideEvidence(side, input.companyName);
  const cheque = !!String(input.chequeNumber || input.parsed?.chequeNumber || "").trim();
  const transfer = String(input.transferMode ?? "").trim();
  const transferIsCash = hasCashWording(transfer);
  const transferIsBank = !!transfer && !transferIsCash && (BANK_OR_CHEQUE_WORD.test(transfer) || hasWalletWording(transfer));
  const kind = String(input.docKind ?? "").trim().toLowerCase();
  const kindIsBank = kind === "cheque" || kind === "deposit_slip";
  const wallet = hasWalletWording(blob);
  const hasBankOrWalletEvidence = fromSide.bank || cheque || transferIsBank || kindIsBank || wallet;
  const cash = hasCashWording(input.paymentMode) || hasCashWording(input.parsed?.paymentMode) || hasCashWording(blob);

  let prefillName = fromSide.prefill;
  if (!prefillName && wallet) {
    const m = blob.match(WALLET_WORD);
    if (m) prefillName = m[0];
  }
  if (!prefillName && cheque) prefillName = printedAccountLabel(input.parsed?.sender?.bankName, input.companyName);
  prefillName = printedAccountLabel(prefillName, input.companyName);

  return { hasCashWording: cash, hasBankOrWalletEvidence, prefillName };
}

export type MissingPaymentAccountPlan =
  | { kind: "use-cash"; accounts: { id: string; name: string }[] }
  | { kind: "create-bank"; name: string }
  | { kind: "info-no-account" };

/**
 * When From/To did not auto-match an own ledger: create a bank account only if the
 * document actually names one. Cash wording offers existing Cash ledgers, never "Create bank".
 */
export function planMissingPaymentAccount(
  evidence: PaymentAccountEvidence,
  ownAccounts: readonly OwnAccountLike[],
): MissingPaymentAccountPlan {
  if (evidence.hasCashWording && !evidence.hasBankOrWalletEvidence) {
    const cash = ownCashAccounts(ownAccounts);
    return cash.length ? { kind: "use-cash", accounts: cash } : { kind: "info-no-account" };
  }
  if (evidence.hasBankOrWalletEvidence) {
    return { kind: "create-bank", name: evidence.prefillName };
  }
  return { kind: "info-no-account" };
}
