/** Bank / money-document detection: format registry + generic field map + voucher-type classification. */
export type ReceiptVoucherType = "contra" | "payment_in" | "payment_out" | "direct_income" | "direct_expense";

export type ReceiptAccountSide = { bankName?: string; branch?: string; accountMasked?: string; accountName?: string };

export type ParsedReceipt = {
  txnId?: string;
  amount?: number;
  charge?: number;
  date?: string;
  referenceId?: string;
  remarks?: string;
  particulars?: string;
  initiatorPhone?: string;
  status?: string;
  voucherNo?: string;
  paymentMode?: string;
  sender: ReceiptAccountSide;
  beneficiary: ReceiptAccountSide;
};

/** Company's own Bank/Cash ledger (subset of components/bank-cash/types Account). */
export type OwnAccountLike = { id: string; accountName?: string; bankName?: string; accountNumber?: string; accountType?: string; branch?: string };

export type ReceiptFormatDetector = {
  format: string;
  /** 0..1 — how sure the text is this receipt/document UI. */
  detect(text: string): number;
  parse(text: string): ParsedReceipt;
  /** When true, useVoucherOcr should run the bill/invoice parser instead of money-voucher fill. */
  billLike?: boolean;
};

export type ReceiptMaster = { kind: "party" | "staff" | "own_bank" | null; id?: string; name?: string; score: number };
export type NamedMaster = { id: string; name: string; aliasName?: string };

export type ReceiptDetection = {
  format: string | null;
  confidence: number;
  parsed: ParsedReceipt | null;
  voucherType: ReceiptVoucherType | null;
  candidates: ReceiptVoucherType[];
  senderAccountId?: string;
  beneficiaryAccountId?: string;
  /** Master identified from Beneficiary Account Name (or own bank by account no.). */
  master: ReceiptMaster;
  /** For payment_out to staff: app records it as payment_out with payeeType "staff" + staffId. */
  payeeType?: "party" | "staff" | "other";
  /** 0..1 confidence in voucherType (0.5 = undecided Payment vs Direct). */
  typeConfidence: number;
  /** How sure the own side was identified (0.99 when beneficiary matched by company name). */
  ownSideConfidence?: number;
  /** Counter-party name: Beneficiary Account Name for OUT; sender name for IN. */
  counterParty: string | null;
  /** OUT-type only (payment_out, direct_expense, contra): Charge Amount -> otherChargeAmount/otherChargeAccountId. */
  otherCharge?: { amount: number };
  /** Suggested narration incl. "connectIPS Account: <mediator>", particulars, remarks, txn id. */
  narration?: string;
  reason: string;
  /** Named counter-party was not found in party/staff masters — stay on Payment/Receipt and offer create. */
  partyMissing?: boolean;
  /** Status printed on the slip is present and is not SUCCESS. */
  statusWarning?: string;
};

export const AUTO_SWITCH_MIN_CONF = 0.85;

export function isSuccessStatus(status?: string): boolean {
  const s = String(status ?? "").trim();
  if (!s) return true;
  return /^(success(ful)?|ok|completed?|done)$/i.test(s);
}
