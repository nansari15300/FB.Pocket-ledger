/**
 * Dashboard summary cards: "Pay Salary" = dedicated type + Payment jahan **Pay To = Staff**
 * (`payeeType === 'staff'` ya legacy `staffId` bina party/tax/expense/other payee).
 * "Payment" card is bucket se in vouchers ko hata kar double-count rokta hai.
 */
export function voucherCountsAsDashboardPaySalary(v: {
  type?: string;
  subType?: string;
  payeeType?: string;
  staffId?: string | null;
  partyId?: string | null;
}): boolean {
  if (!v) return false;
  if (v.type === "pay_salary") return true;
  if (v.type !== "payment_out") return false;
  if (v.subType === "pay_salary") return true;
  if (v.payeeType === "staff") return true;

  const sid = v.staffId != null ? String(v.staffId).trim() : "";
  if (!sid) return false;
  if (v.payeeType === "party" || v.payeeType === "tax" || v.payeeType === "expense" || v.payeeType === "other") {
    return false;
  }
  return true;
}

/** General Payment card: staff / pay-salary payouts isme nahi — wo `Pay Salary` card mein. */
export function voucherCountsAsDashboardPaymentOutExcludingPaySalary(v: {
  type?: string;
  subType?: string;
  payeeType?: string;
  staffId?: string | null;
  partyId?: string | null;
}): boolean {
  return v?.type === "payment_out" && !voucherCountsAsDashboardPaySalary(v);
}
