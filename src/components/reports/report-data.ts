
export type Report = {
  id: string;
  name: string;
  description: string;
  /** Report list category grouping (e.g., Party, Staff, Bank, Financial). */
  category:
    | "Financial"
    | "Party"
    | "Staff"
    | "Bank/Cash"
    | "Sales/Purchase"
    | "Payments"
    | "Tax/GST"
    | "Inventory"
    | "Accounting";
  /** When set, clicking this item navigates to the href instead of opening report details. */
  href?: string;
  /** When set, this report is only shown when company country matches (e.g. Nepal for Anusuchi 13). */
  countryOnly?: string;
  /** Master-detail report: reports page top bar = party detail blue ribbon. */
  ledgerDetailTopRibbon?: boolean;
};

export const reports: Report[] = [
  {
    id: "financialsummary",
    name: "Financial Summary",
    description: "Overview of receivables and payables.",
    category: "Financial",
  },
  {
    id: "balancesheet",
    name: "Balance Sheet",
    description: "A snapshot of the company's financial health.",
    category: "Financial",
  },
  {
    id: "trialbalance",
    name: "Trial Balance",
    description: "Summary of all ledger balances to verify equality.",
    category: "Financial",
  },
  {
    id: "profitandloss",
    // Reports list label requested: keep explicit Income & Expense P&L naming.
    name: "Income & Exp P&L",
    description: "Summarizes income and expense performance over a period.",
    category: "Financial",
  },
  {
    id: "profitandloss-party-wise",
    name: "Party Wise Profit & Loss",
    description: "Party-focused Profit & Loss view.",
    category: "Party",
  },
  {
    id: "profitandloss-bill-wise",
    name: "Bill Wise Profit & Loss",
    description: "Bill-wise Profit & Loss view.",
    category: "Party",
  },
  {
    id: "cashflow",
    name: "Cash Flow Statement",
    description: "Shows how cash moves in and out of the company.",
    category: "Financial",
  },
  {
    id: "day-book",
    name: "Day Book",
    description: "A chronological record of all daily transactions.",
    category: "Accounting",
  },
  /* Account Summary (accounts-statement) list se hata — Bank Statement hi bank/cash flow cover karta hai. */
  // Direct statement routes: keep list parity with "Report" buttons from entity details pages.
  {
    id: "party-statement",
    name: "Party Statement",
    description: "View party-wise statement details.",
    category: "Party",
    /** PartyDetails supplies its own desktop ribbon — hide reports shell title bar. */
    ledgerDetailTopRibbon: true,
  },
  {
    id: "staff-statement",
    name: "Staff Statement",
    description: "View staff-wise statement details.",
    category: "Staff",
  },
  {
    id: "bank-statement",
    name: "Bank Statement",
    description: "View bank/cash account statement details.",
    category: "Bank/Cash",
  },
  /* Income Statement list se hata — Income & Expense Report (expense-statement) same flow cover karta hai. */
  {
    id: "group-statement",
    name: "Group Summary",
    description: "View the transaction history for a specific group.",
    category: "Accounting",
  },
  {
    id: "expense-statement",
    name: "Income & Expense Statement",
    description: "View Income & Expense account or group transaction history.",
    category: "Accounting",
  },
  {
    id: "item-statement",
    name: "Item Statement",
    description: "View item or item group transaction history.",
    category: "Inventory",
  },
  {
    id: "stock-summary",
    name: "Stock Summary",
    description: "Overview of item stock levels and values.",
    category: "Inventory",
  },
  { id: "sale", name: "Sale Register", description: "Create and manage sales / invoices.", category: "Sales/Purchase" },
  { id: "purchase", name: "Purchase Register", description: "Create and manage purchases.", category: "Sales/Purchase" },
  { id: "payment-in", name: "Receipt", description: "Record incoming payments.", category: "Payments" },
  { id: "payment-out", name: "Payment Out", description: "Record outgoing payments.", category: "Payments" },
  { id: "add-salary", name: "Add Salary", description: "Add salary entries for staff.", category: "Staff" },
  { id: "contra", name: "Contra Report", description: "Transfer between bank and cash accounts.", category: "Bank/Cash" },
  { id: "journal", name: "Journals", description: "Create journal entries.", category: "Accounting" },
  {
    id: "notes",
    name: "Notes",
    description: "Create and manage notes.",
    category: "Accounting",
  },
  {
    id: "anusuchi-13",
    name: "Anusuchi 13",
    description: "Nepali VAT: Parties with transaction of one lac or above.",
    category: "Tax/GST",
    countryOnly: "Nepal",
    ledgerDetailTopRibbon: true,
  },
  {
    id: "gst-report-1",
    name: "GSTR-1",
    description: "Summary of all outward supplies (sales).",
    category: "Tax/GST",
  },
  {
    id: "gst-report-2",
    name: "GSTR-2",
    description: "Summary of all inward supplies (purchases).",
    category: "Tax/GST",
  },
  {
    id: "gst-report-3b",
    name: "GSTR-3B",
    description: "Monthly summary return of sales and purchases.",
    category: "Tax/GST",
  },
  // Tax account-focused report listing for quick access from Reports menu.
  {
    id: "tax-statement",
    name: "Tax Report",
    description: "View tax accounts and tax-group transaction details.",
    category: "Tax/GST",
  },
  {
    id: "loan-overview",
    name: "Loan Overview",
    description: "Loan dashboard, schedule, EMI, and accounting reports.",
    category: "Accounting",
  },
  {
    id: "loan-outstanding",
    name: "Outstanding Loan Report",
    description: "Current outstanding principal by loan.",
    category: "Accounting",
    href: "/loans?view=reports",
  },
  // Removed duplicate Party Ledger from list; Party Statement already covers this flow.
];
