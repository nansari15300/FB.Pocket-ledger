/**
 * Bank/Cash ledger — Company vs Bank Dr/Cr perspective.
 *
 * Underlying books are asset-style (Payment In = Dr, Payment = Cr).
 * - Bank (default): keep asset / cash-book columns — Payment = Cr, Payment In = Dr.
 * - Company: treat bank like a party — Payment = Dr, Payment In = Cr.
 */

export type BankLedgerDrCrPerspective = "company" | "bank";

export const BANK_LEDGER_DRCR_PERSPECTIVE_STORAGE_KEY = "pocket-ledger-bank-ledger-drcr-perspective";

export function normalizeBankLedgerDrCrPerspective(
  raw: unknown
): BankLedgerDrCrPerspective {
  return raw === "company" ? "company" : "bank";
}

/**
 * Asset-base Dr/Cr → display columns for the selected perspective.
 * Company flips (party-like). Bank keeps asset columns.
 */
export function flipLedgerDrCr(
  debit: number,
  credit: number,
  perspective: BankLedgerDrCrPerspective
): { debit: number; credit: number } {
  const d = Number(debit) || 0;
  const c = Number(credit) || 0;
  if (perspective === "bank") return { debit: d, credit: c };
  return { debit: c, credit: d };
}

/** Asset +Dr cash → Company (party-like) shows Cr balance; Bank keeps Dr. */
export function flipLedgerSignedBalance(
  balance: number,
  perspective: BankLedgerDrCrPerspective
): number {
  const n = Number(balance) || 0;
  return perspective === "company" ? -n : n;
}

export function applyBankDrCrPerspectiveToTxnRow<
  T extends { debit?: number; credit?: number; balance?: number },
>(row: T, perspective: BankLedgerDrCrPerspective): T {
  if (perspective === "bank") return row;
  const flipped = flipLedgerDrCr(Number(row.debit) || 0, Number(row.credit) || 0, "company");
  const next: T = { ...row, debit: flipped.debit, credit: flipped.credit };
  if (typeof row.balance === "number") {
    next.balance = flipLedgerSignedBalance(row.balance, "company");
  }
  return next;
}

export function applyBankDrCrPerspectiveToTxnRows<
  T extends { debit?: number; credit?: number; balance?: number },
>(rows: T[] | null | undefined, perspective: BankLedgerDrCrPerspective): T[] {
  if (!rows?.length) return rows || [];
  if (perspective === "bank") return rows;
  return rows.map((r) => applyBankDrCrPerspectiveToTxnRow(r, perspective));
}

/** Bank/Cash txn table — Deposit/Withdraw column titles (flip with Company perspective). */
export function bankLedgerDepositWithdrawColumnLabels(
  perspective: BankLedgerDrCrPerspective
): { debitColumnHeaderLabel: string; creditColumnHeaderLabel: string } {
  if (perspective === "bank") {
    return { debitColumnHeaderLabel: "Deposit", creditColumnHeaderLabel: "Withdraw" };
  }
  return { debitColumnHeaderLabel: "Withdraw", creditColumnHeaderLabel: "Deposit" };
}

/** Cash account txn table — In/Out column titles (flip with Company perspective). */
export function bankLedgerInOutColumnLabels(
  perspective: BankLedgerDrCrPerspective
): { debitColumnHeaderLabel: string; creditColumnHeaderLabel: string } {
  if (perspective === "bank") {
    return { debitColumnHeaderLabel: "In", creditColumnHeaderLabel: "Out" };
  }
  return { debitColumnHeaderLabel: "Out", creditColumnHeaderLabel: "In" };
}

export function isBankCashAccountTypeCash(accountType: unknown): boolean {
  return String(accountType || "").toLowerCase() === "cash";
}

/** Bank account → Deposit/Withdraw; Cash account → In/Out (Company/Bank flip on both). */
export function bankLedgerTxnColumnLabels(
  accountType: unknown,
  perspective: BankLedgerDrCrPerspective
): { debitColumnHeaderLabel: string; creditColumnHeaderLabel: string } {
  return isBankCashAccountTypeCash(accountType)
    ? bankLedgerInOutColumnLabels(perspective)
    : bankLedgerDepositWithdrawColumnLabels(perspective);
}

/** Info popover — English intro for staff. */
export const BANK_LEDGER_DRCR_PERSPECTIVE_INFO = {
  title: "Company vs Bank Dr/Cr",
  body: [
    "Bank mode (default): Cash-book / bank-statement style for this account. Payment posts as Credit (Cr), Receipt as Debit (Dr). The balance Dr/Cr follows this Bank view.",
    "Company mode: Treat the bank/cash account like a party. Payment posts as Debit (Dr), Receipt as Credit (Cr). The balance Dr/Cr follows this Company view.",
    "Today In / Today Out still mean money in and money out. Only the Debit/Credit columns and the Dr/Cr balance label change with the switch.",
    "This switch is only for Bank/Cash statement, spend-wise, and day peek ledgers — not for Party or Staff ledgers.",
  ].join("\n\n"),
} as const;
