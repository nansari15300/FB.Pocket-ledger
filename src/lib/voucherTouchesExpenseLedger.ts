import { interCompanyVoucherTouchesEntity } from "@/lib/interCompany/interCompanyLedgerAmounts";

function idEq(a: unknown, id: string): boolean {
  const b = String(id || "").trim();
  if (!b) return false;
  return String(a ?? "").trim() === b;
}

/** Same inclusion rules as expense-account rows in `use-transactions` entity filter. */
export function voucherTouchesExpenseAccountLedger(v: any, entityId: string): boolean {
  const id = String(entityId || "").trim();
  if (!v || !id || v.isDeleted === true) return false;

  if (
    idEq(v.expenseAccountId, id) ||
    idEq(v.incomeAccountId, id) ||
    idEq(v.accountId, id) ||
    idEq(v.toAccountId, id)
  ) {
    return true;
  }
  if (idEq(v.salesAccountId, id) || idEq(v.purchaseAccountId, id)) return true;
  if (v.type === "payment_out" && idEq(v.otherChargeAccountId, id)) return true;
  if (v.type === "direct_expense" && idEq(v.otherChargeAccountId, id)) return true;
  if (Array.isArray(v.entries) && v.entries.some((e: any) => idEq(e?.accountId, id))) return true;
  if (v.type === "note" && idEq(v.entityId, id)) return true;
  if (v.type === "contra" && (idEq(v.fromAccountId, id) || idEq(v.toAccountId, id))) return true;
  if (v.type === "contra" && idEq(v.otherChargeAccountId, id)) return true;
  if (v.type === "inter_company" && interCompanyVoucherTouchesEntity(v, id, "expense")) return true;
  if (id === "sales_account" && v.type === "sale") return true;
  if (id === "purchase_account" && v.type === "purchase") return true;
  return false;
}
