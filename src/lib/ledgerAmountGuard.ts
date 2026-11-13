/**
 * One guard shared by every voucher form whose "Paid from / From" side is a Bank/Cash ledger.
 *
 * Two different failures used to look the same in the UI:
 *   1. the ledger is already negative (someone posted a wrong entry), and
 *   2. this voucher is bigger than what the ledger has.
 * Both block Save, but the message must say which one — "negative balance" is not an amount problem.
 */

export type LedgerAmountGuardInput = {
  /** Ledger id on the paying side; empty = nothing to check. */
  accountId?: string | null;
  /** Balance the ledger shows right now (signed; negative = already overdrawn). */
  balance?: number | null;
  /** Amount this voucher takes out of that ledger. */
  outflow?: number | null;
  /** Company/master policy that lets this ledger go negative — then there is nothing to block. */
  minusAllowed?: boolean;
  /** Edit mode: the saved voucher already took its own amount out of this ledger, so add it back. */
  creditBack?: number | null;
};

export type LedgerAmountGuard = {
  /** Save must be blocked. */
  blocked: boolean;
  /** 'negative' = ledger already overdrawn, 'exceeds' = this voucher is too big, null = fine. */
  reason: "negative" | "exceeds" | null;
  /** Signed balance used for the decision. */
  balance: number;
  /** Balance + credit-back — what is actually spendable. */
  available: number;
  /** Red text under the account field; null when fine. */
  message: string | null;
};

const fmt = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Pure guard: no React, no formatting deps, so Contra / Payment / Journal can all call it. */
export function checkLedgerAmountGate(input: LedgerAmountGuardInput): LedgerAmountGuard {
  const balance = Number(input.balance) || 0;
  const creditBack = Number(input.creditBack) || 0;
  const available = balance + creditBack;
  const outflow = Number(input.outflow) || 0;
  const idle: LedgerAmountGuard = { blocked: false, reason: null, balance, available, message: null };
  if (!input.accountId || input.minusAllowed) return idle;
  // Nothing being taken out yet: a pre-existing negative balance is the ledger's problem, not this form's.
  if (outflow <= 0) return idle;

  if (available < 0) {
    return {
      blocked: true,
      reason: "negative",
      balance,
      available,
      message: `Cannot save: this account already has a negative balance (${fmt(available)} ${available < 0 ? "Cr" : ""}). Receive / adjust funds in this ledger first.`,
    };
  }
  if (outflow > available) {
    return {
      blocked: true,
      reason: "exceeds",
      balance,
      available,
      message: `Cannot save: amount is more than this account's balance (${fmt(available)}).`,
    };
  }
  return idle;
}
