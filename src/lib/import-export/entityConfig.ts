/**
 * Import/Export: only two options — Master of Account and Vouchers.
 * Master of Account: one sheet with Type column (Party, Bank, Staff, Tax, Items, Income, Expense); type determines which collection/fields.
 * Vouchers: Date, Voucher No., Voucher Type, Dr Account, Cr Account, Narration, Amount.
 */

export type EntityColumn = {
  key: string;
  header: string;
  field?: string;
  format?: (v: unknown) => string | number;
  required?: boolean;
};

export type EntityConfig = {
  id: string;
  label: string;
  /** Empty for account_master (multi-collection). */
  collection: string;
  groupCollection?: string;
  voucherType?: string;
  nameKey: string;
  columns: EntityColumn[];
};

/** Account types for Master of Account sheet. */
export const ACCOUNT_TYPES = ["Party", "Bank", "Staff", "Tax", "Items", "Income", "Expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Voucher types for Vouchers sheet. */
export const VOUCHER_TYPES = [
  "quotation",
  "sale",
  "purchase",
  "payment_in",
  "payment_out",
  "journal",
  "contra",
  "direct_income",
  "direct_expense",
] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export const ENTITY_CONFIGS: EntityConfig[] = [
  {
    id: "account_master",
    label: "Master of Account",
    collection: "",
    nameKey: "name",
    columns: [
      { key: "type", header: "Type", required: true },
      { key: "name", header: "Name", required: true },
      { key: "groupName", header: "Group" },
      { key: "openingBalance", header: "Opening Balance", format: (v) => (v == null ? 0 : Number(v)) },
      { key: "openingBalanceDate", header: "Opening Balance Date" },
      { key: "address", header: "Address" },
      { key: "phone", header: "Phone" },
      { key: "email", header: "Email" },
      { key: "pan", header: "PAN" },
      { key: "accountType", header: "Account Type" },
      { key: "bankName", header: "Bank Name" },
      { key: "accountNumber", header: "Account Number" },
      { key: "ifscCode", header: "IFSC Code" },
      { key: "salary", header: "Salary", format: (v) => (v == null ? "" : Number(v)) },
      { key: "salaryPeriod", header: "Salary Period" },
      { key: "rate", header: "Rate (%)", format: (v) => (v == null ? 0 : Number(v)) },
      { key: "itemType", header: "Item Type" },
      { key: "salePrice", header: "Sale Price", format: (v) => (v == null ? 0 : Number(v)) },
      { key: "purchasePrice", header: "Purchase Price", format: (v) => (v == null ? 0 : Number(v)) },
      { key: "openingBalanceUnit", header: "Opening Balance Unit" },
      { key: "lowStockWarning", header: "Low Stock Warning", format: (v) => (v == null ? "" : Number(v)) },
      { key: "lowStockWarningUnit", header: "Low Stock Warning Unit" },
    ],
  },
  {
    id: "vouchers",
    label: "Vouchers",
    collection: "vouchers",
    nameKey: "voucherNumber",
    columns: [
      { key: "date", header: "Date", required: true },
      { key: "voucherNumber", header: "Voucher No.", required: true },
      { key: "voucherType", header: "Voucher Type", required: true },
      { key: "drAccount", header: "Dr Account", required: true },
      { key: "crAccount", header: "Cr Account", required: true },
      { key: "narration", header: "Narration" },
      { key: "amount", header: "Amount", required: true, format: (v) => (v == null ? 0 : Number(v)) },
    ],
  },
];

export function getEntityConfig(id: string): EntityConfig | undefined {
  return ENTITY_CONFIGS.find((c) => c.id === id);
}

/** Map Master of Account "Type" to Firestore collection and name field. */
export function getCollectionForAccountType(type: string): { collection: string; groupCollection?: string; nameKey: string } | null {
  const t = String(type).trim().toLowerCase();
  if (t === "party") return { collection: "parties", groupCollection: "groups", nameKey: "name" };
  if (t === "bank") return { collection: "bank_accounts", groupCollection: "account_groups", nameKey: "accountName" };
  if (t === "staff") return { collection: "staff", groupCollection: "staff_groups", nameKey: "name" };
  if (t === "tax") return { collection: "taxes", groupCollection: "tax_groups", nameKey: "name" };
  if (t === "items") return { collection: "items", groupCollection: "item_groups", nameKey: "name" };
  if (t === "income" || t === "expense") return { collection: "expense_accounts", groupCollection: "expense_groups", nameKey: "name" };
  return null;
}
