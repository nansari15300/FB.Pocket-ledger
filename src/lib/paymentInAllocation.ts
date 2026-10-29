/**
 * Allocate a total amount across selected "in" voucher IDs (Payment In, Direct Income, Contra in) in order.
 * Used by Payment, Direct Expense, and Contra (pay-from side) when linking (Spend Wise).
 */
import { getOpeningBalanceBaseAmount, SPEND_WISE_OPENING_BALANCE_ID } from "@/lib/spendWiseOpeningBalance";

function isInVoucherForAccount(v: any, accountId: string): boolean {
  // Compatibility matcher: handle both current and legacy account key locations.
  const inAccountId = v.accountId ?? v.toAccountId ?? v.bankAccountId;
  return (
    ((v.type === "payment_in" || v.type === "direct_income") && inAccountId === accountId) ||
    (v.type === "contra" && (v.toAccountId ?? v.accountId) === accountId)
  );
}

export function allocatePaymentInAmounts(
  totalToAllocate: number,
  piIds: string[],
  allVouchers: any[],
  accountId: string,
  linkedAmountByPaymentInId: Map<string, number>,
  accountOpeningBalance: number = 0
): Record<string, number> {
  if (!totalToAllocate || !piIds?.length || !allVouchers?.length) return {};
  const result: Record<string, number> = {};
  const getPi = (id: string) =>
    allVouchers.find((x: any) => x.id === id && isInVoucherForAccount(x, accountId));
  const getLinkable = (id: string) => {
    if (id === SPEND_WISE_OPENING_BALANCE_ID) {
      // Spend-wise OB row on Payment side only consumes Dr opening balance.
      const base = getOpeningBalanceBaseAmount(accountOpeningBalance, "dr");
      const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
      return Math.max(0, base - alreadyLinked);
    }
    const v = getPi(id);
    const amount = Number(v?.total ?? v?.amount ?? 0) || 0;
    const alreadyLinked = linkedAmountByPaymentInId.get(id) ?? 0;
    return Math.max(0, amount - alreadyLinked);
  };
  let remaining = totalToAllocate;
  for (const id of piIds) {
    if (remaining <= 0) break;
    const linkable = getLinkable(id);
    const take = Math.min(linkable, remaining);
    if (take > 0) result[id] = take;
    remaining -= take;
  }
  return result;
}

function trimName(names: Record<string, string>, id?: string | null): string {
  if (!id) return "";
  const n = names[id];
  return typeof n === "string" && n.trim() ? n.trim() : "";
}

/** Spend-wise inflow row: party/payee; fallback bank/cash account name. */
export function getSpendWiseInflowPartyLabel(v: any, names: Record<string, string>): string {
  if (!v) return "—";
  if (v.type === "contra") {
    return trimName(names, v.fromAccountId) || trimName(names, v.toAccountId) || "—";
  }
  const label =
    trimName(names, v.partyId) ||
    trimName(names, v.staffId) ||
    trimName(names, v.taxAccountId) ||
    trimName(names, v.incomeAccountId) ||
    (typeof v.payeeName === "string" ? v.payeeName.trim() : "");
  if (label) return label;
  const acctId = v.accountId ?? v.toAccountId ?? v.bankAccountId;
  return trimName(names, acctId) || "—";
}

/** Spend-wise outflow row: payee/expense; fallback bank/cash account name. */
export function getSpendWiseOutflowPartyLabel(v: any, names: Record<string, string>): string {
  if (!v) return "—";
  if (v.type === "contra") {
    return trimName(names, v.toAccountId) || trimName(names, v.fromAccountId) || "—";
  }
  const label =
    trimName(names, v.partyId) ||
    trimName(names, v.staffId) ||
    trimName(names, v.expenseAccountId) ||
    trimName(names, v.toAccountId) ||
    (typeof v.payeeName === "string" ? v.payeeName.trim() : "");
  if (label) return label;
  const acctId = v.accountId ?? v.fromAccountId;
  return trimName(names, acctId) || "—";
}
