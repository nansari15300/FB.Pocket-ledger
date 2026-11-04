/** Company ledger subcollections — backup / mirror / restore lists (lightweight; `companyBackupCore` mat import). */
export const COLLECTIONS_TO_BACKUP = [
  "parties",
  "groups",
  "bank_accounts",
  "account_groups",
  "staff",
  "staff_groups",
  "items",
  "item_groups",
  "taxes",
  "tax_groups",
  "expense_accounts",
  "expense_groups",
  "unassigned_documents",
  "vouchers",
  "recurring_voucher_templates",
  "loans",
  "loan_schedules",
  "loan_transactions",
  "loan_rate_history",
  "loan_charges",
  "loan_audit_logs",
  "loan_settings",
  "loan_documents",
  /** HR module (pl_docs, keyed by company + coll + app_id). */
  "hr_attendance",
  "hr_leaves",
  "hr_payroll",
] as const;

export type CompanyBackupCollection = (typeof COLLECTIONS_TO_BACKUP)[number];
