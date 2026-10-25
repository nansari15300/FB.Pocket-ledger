/** Bank-receipt detection (step 1: format detection + voucher-type classification only; no field filling). */
export type ReceiptVoucherType = "contra" | "payment_in" | "payment_out" | "direct_income" | "direct_expense";

export type ReceiptAccountSide = { bankName?: string; branch?: string; accountMasked?: string; accountName?: string };

export type ParsedReceipt = {
  txnId?: string; amount?: number; charge?: number; date?: string; referenceId?: string; remarks?: string; particulars?: string;
  sender: ReceiptAccountSide; beneficiary: ReceiptAccountSide;
};

/** Company's own Bank/Cash ledger (subset of components/bank-cash/types Account). */
export type OwnAccountLike = { id: string; accountName?: string; bankName?: string; accountNumber?: string; accountType?: string };

export type ReceiptFormatDetector = {
  format: string;
  /** 0..1 — how sure the text is this receipt UI. */
  detect(text: string): number;
  parse(text: string): ParsedReceipt;
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
  /** Counter-party name: Beneficiary Account Name for OUT; null for IN (connectIPS sender has no name). */
  counterParty: string | null;
  /** OUT-type only (payment_out, direct_expense, contra): Charge Amount -> otherChargeAmount/otherChargeAccountId. */
  otherCharge?: { amount: number };
  /** Suggested narration incl. "connectIPS Account: <mediator>", particulars, remarks, txn id. */
  narration?: string;
  reason: string;
};
