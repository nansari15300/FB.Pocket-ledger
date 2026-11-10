/** Per-voucher-type OCR field mapping (spec §3). One generic hook, one small adapter per form. */
export type OcrFormAdapter = {
  /** AddVoucherDialog tab key this form represents. */
  voucherType: string;
  /** Bank/cash account field (payments) for "change account" suggestions. */
  accountPath?: string;
  /** Which PAN/name on the bill is the counter-party. */
  partySide: "seller" | "buyer";
  party?: { path: string; payeeTypePath?: string; payeeTypeValue?: string; allowedPayeeTypes?: string[] };
  date?: string;
  dueDate?: string;
  amount?: string;
  narration?: string;
  lineItems?: {
    path: string;
    makeEmpty: () => Record<string, unknown>;
    discountPath?: string;
    discountSignPath?: string;
  };
  /** Purchase/Sale ledger account (Dr for purchase). systemDefault = built-in "Purchase A/c" value. */
  ledgerAccount?: { path: string; systemDefault: string; nameRx: RegExp };
  /** Auto Post supported for this type (OCR can fill everything the form requires). */
  autoPost: boolean;
  /** Extra form paths that must already be non-empty before Auto Post (e.g. bank/cash account). */
  requiredPaths?: string[];
  /** Contra: source / destination Bank-Cash paths. */
  fromAccountPath?: string;
  toAccountPath?: string;
  /** Payment-out / contra may keep the party amount on `payeeAmount`. */
  payeeAmount?: string;
};

type MkLine = () => Record<string, unknown>;
const pay = (side: "seller" | "buyer", voucherType: string): OcrFormAdapter => ({
  voucherType,
  accountPath: "accountId",
  partySide: side,
  party: { path: "partyId", payeeTypePath: "payeeType", payeeTypeValue: "party", allowedPayeeTypes: ["party"] },
  date: "date",
  amount: "amount",
  narration: "narration",
  autoPost: true,
  requiredPaths: ["accountId"],
});

export const ocrAdapters = {
  purchase: (makeEmpty: MkLine): OcrFormAdapter => ({
    voucherType: "purchase",
    partySide: "seller",
    party: { path: "partyId" },
    date: "date",
    dueDate: "dueDate",
    narration: "narration",
    lineItems: { path: "lineItems", makeEmpty, discountPath: "discount", discountSignPath: "discountSign" },
    ledgerAccount: { path: "purchaseAccountId", systemDefault: "purchase_account", nameRx: /\bpurchases?\b/i },
    autoPost: true,
  }),
  sale: (makeEmpty: MkLine): OcrFormAdapter => ({
    voucherType: "sale",
    partySide: "buyer",
    party: { path: "partyId" },
    date: "date",
    dueDate: "dueDate",
    narration: "narration",
    lineItems: { path: "lineItems", makeEmpty, discountPath: "discount", discountSignPath: "discountSign" },
    autoPost: true,
  }),
  /** Payment In + Direct Income (same form). Party only when payee type is Party. */
  paymentIn: (): OcrFormAdapter => pay("buyer", "payment_in"),
  /** Payment + Direct Expense (same form). Expense payee: party skipped, amount/date/narration still filled. */
  paymentOut: (): OcrFormAdapter => pay("seller", "payment_out"),
  contra: (): OcrFormAdapter => ({ voucherType: "contra", partySide: "seller", date: "date", amount: "amount", payeeAmount: "payeeAmount", fromAccountPath: "fromAccountId", toAccountPath: "toAccountId", narration: "narration", autoPost: false, requiredPaths: ["fromAccountId", "toAccountId"] }),
  journal: (): OcrFormAdapter => ({ voucherType: "journal", partySide: "seller", date: "date", narration: "narration", autoPost: false }),
  salary: (): OcrFormAdapter => ({ voucherType: "add_salary", partySide: "seller", date: "date", narration: "narration", autoPost: false }),
  adjustment: (): OcrFormAdapter => ({ voucherType: "adjustment", partySide: "seller", date: "date", amount: "amount", narration: "narration", autoPost: false }),
  production: (): OcrFormAdapter => ({ voucherType: "production", partySide: "seller", date: "date", narration: "narration", autoPost: false }),
  note: (): OcrFormAdapter => ({ voucherType: "note", partySide: "seller", date: "date", narration: "content", autoPost: false }),
};
