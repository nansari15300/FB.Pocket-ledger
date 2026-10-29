import type { Account } from "@/components/bank-cash/types";

/** Edit Account checkbox ON — Payment / Direct Expense / Contra se balance se zyada amount save ho sake. */
export function bankAccountAllowsVoucherMinusBalance(
  account: Pick<Account, "allowVoucherMinusBalance"> | null | undefined
): boolean {
  return account?.allowVoucherMinusBalance === true;
}

/** Info tooltip — AllowVoucherMinusBalanceField + docs ke liye shared English copy. */
export const ALLOW_VOUCHER_MINUS_BALANCE_INFO =
  "When enabled, vouchers that pay from this account (Payment, Direct Expense, Contra out) can be saved even if the amount is greater than the current balance, so the account may go into minus (credit). When disabled, saving is blocked when the amount exceeds available balance.";
