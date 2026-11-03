import { RECON_PERMISSIONS_GROUP_TITLE } from "@/lib/reconciliation/labels";

export type Permission =
  | "view_own_records"
  | "view_all_records"
  | "create_records"
  | "edit_own_records"
  | "edit_all_records"
  | "delete_records"
  | "approve_transactions"
  | "add_adjustment_voucher"
  | "edit_adjustment_voucher"
  | "edit_approved_voucher"
  | "delete_approved_voucher"
  | "view_history"
  | "manage_users_roles"
  | "configure_company_settings"
  | "permanently_delete_records"
  | "export_data"
  | "import_data"
  | "view_receivable_payable_summary"
  | "view_payment_in_out_summary"
  | "view_entity_counts_summary"
  | "view_voucher_type_summaries"
  | "view_bank_cash_summary"
  | "view_daybook"
  | "view_recent_transactions"
  | "manage_special_bank_accounts"
  | "view_special_bank_accounts"
  | "view_special_account_balance"
  | "edit_item_rates_in_vouchers"
  | "edit_voucher_numbers"
  | "view_voucher_history"
  | "reset_voucher_history"
  | "add_link"
  | "edit_link"
  /** Header Copy ledger — doosri company ka party ledger */
  | "copy_ledger_cross_company"
  /** Dashboard “Auto recurring” summary card (read accrued / schedules). */
  | "view_recurring_auto_summary"
  /** Company master toggle + run scope (Voucher Settings / dashboard card). */
  | "configure_recurring_auto_company"
  /** Journal voucher: Auto Monthly strip (read-only without add/edit). */
  | "view_recurring_voucher_controls"
  /** Turn Auto Monthly ON on a journal voucher. */
  | "add_recurring_auto_monthly"
  /** Schedule day, rate bump, nested settings dialog. */
  | "edit_recurring_auto_monthly"
  /** Generate now / missed-period Create & batch picker. */
  | "generate_recurring_voucher_now"
  /** Month-end auto-create when app opens (with company run scope). */
  | "trigger_recurring_auto_on_app_open"
  /** Inter Company Join tab — view join settings, groups, invite inbox */
  | "inter_company_read"
  /** Inter Company Join tab — save joins, groups, accept invites (shared user inherits admin joins) */
  | "inter_company_write"
  /** Shared user — Inter Company voucher create (header + tab). */
  | "create_inter_company_voucher"
  /** Shared user — saved Inter Company voucher edit. */
  | "edit_inter_company_voucher"
  /** IC voucher Approve (clearing/master row 3-dot + edit mode), either side. Separate from approve_transactions. */
  | "approve_inter_company_voucher"
  /** Header Share for Reconciliation — naya share bhejna */
  | "share_for_reconciliation"
  /** Shared list se apna account link karna (receiver) */
  | "link_reconciliation_accounts"
  /** Linked accounts par Reconciliation page kholna */
  | "view_reconciliation"
  /** Share dialog — Shared list tab */
  | "view_reconciliation_shared_list"
  /** Share dialog — Unlinked tab */
  | "view_reconciliation_unlinked_list"
  /** Reconciling page — blank row par remote txn se sync voucher */
  | "sync_reconciliation_transaction"
  /** Freeze party / bank / staff / tax master account (block new txns + banner). */
  | "freeze_master_account"
  | "unlock_locked_pdf"
  /** HR module (plan-gated: entitlements.hrModuleEnabled) */
  | "hr_view"
  | "hr_manage"
  | "hr_attendance"
  | "hr_leave_approve"
  | "hr_payroll";

export type PermissionInfo = {
  key: Permission;
  label: string;
  /** Manage Sharing — (i) popover English help (optional) */
  description?: string;
};

export type PermissionGroup = {
  title: string;
  permissions: PermissionInfo[];
};


export const PermissionGroups: PermissionGroup[] = [
    {
        title: "General Access",
        permissions: [
            { key: "view_own_records", label: "View Own Records" },
            { key: "view_all_records", label: "View All Records" },
            { key: "create_records", label: "Create Records" },
            { key: "edit_own_records", label: "Edit Own Records" },
            { key: "edit_all_records", label: "Edit All Records" },
            { key: "delete_records", label: "Delete Records (to Recycle Bin)" },
            { key: "approve_transactions", label: "Approve Transactions" },
            { key: "edit_approved_voucher", label: "Edit Approved Voucher" },
            { key: "delete_approved_voucher", label: "Delete Approved Voucher" },
            { key: "edit_voucher_numbers", label: "Edit Voucher Numbers" },
            { key: "view_voucher_history", label: "View Voucher History" },
            { key: "reset_voucher_history", label: "Delete Voucher History" },
        ],
    },
    {
        title: "Company & Users",
        permissions: [
            { key: "manage_users_roles", label: "Manage Users & Roles" },
            { key: "configure_company_settings", label: "Configure Company Settings" },
            { key: "permanently_delete_records", label: "Permanently Delete Records" },
            { key: "export_data", label: "Export Data" },
            { key: "import_data", label: "Import/Restore Data" },
        ],
    },
    {
        title: "Dashboard Summaries",
        permissions: [
            { key: "view_receivable_payable_summary", label: "View Receivable/Payable Summary" },
            { key: "view_payment_in_out_summary", label: "View Receipt / Payment Summary" },
            { key: "view_entity_counts_summary", label: "View Entity Counts" },
            { key: "view_voucher_type_summaries", label: "View Voucher Type Summaries" },
            { key: "view_bank_cash_summary", label: "View Bank/Cash Summary" },
            { key: "view_daybook", label: "View Daybook" },
            { key: "view_recent_transactions", label: "View Recent Transactions" },
        ],
    },
    {
        title: "Special Accounts",
        permissions: [
            { key: "manage_special_bank_accounts", label: "Manage Special Bank Accounts" },
            { key: "view_special_bank_accounts", label: "View Special Bank Accounts" },
            { key: "view_special_account_balance", label: "View Special Account Balance" },
            { key: "freeze_master_account", label: "Freeze Masters" },
        ],
    },
    {
        title: "Pricing & Rate Control",
        permissions: [
            { key: "edit_item_rates_in_vouchers", label: "Edit Item Rates in Vouchers"},
        ]
    },
    {
        title: "Link / Allocation",
        permissions: [
            { key: "add_link", label: "Add Link (Link to Txns)" },
            { key: "edit_link", label: "Edit Link (Unlink / Change allocation)" },
            { key: "copy_ledger_cross_company", label: "Copy ledger across companies" },
        ]
    },
    {
        title: "Recurring Auto Voucher",
        permissions: [
            { key: "view_recurring_auto_summary", label: "View recurring auto summary (dashboard card)" },
            { key: "configure_recurring_auto_company", label: "Configure company recurring auto (enable + run scope)" },
            { key: "view_recurring_voucher_controls", label: "View Auto Monthly on journal vouchers" },
            { key: "add_recurring_auto_monthly", label: "Turn on Auto Monthly on vouchers" },
            { key: "edit_recurring_auto_monthly", label: "Edit Auto Monthly settings (schedule & rates)" },
            { key: "generate_recurring_voucher_now", label: "Generate recurring voucher now" },
            { key: "trigger_recurring_auto_on_app_open", label: "Trigger month-end auto generation on app open" },
        ],
    },
    {
        title: "Inter Company",
        permissions: [
            { key: "inter_company_read", label: "View Inter Company join settings & groups" },
            { key: "inter_company_write", label: "Manage Inter Company joins & groups" },
            { key: "create_inter_company_voucher", label: "Add IC voucher" },
            { key: "edit_inter_company_voucher", label: "Edit IC voucher" },
            { key: "approve_inter_company_voucher", label: "Approve IC voucher" },
        ],
    },
    {
        title: RECON_PERMISSIONS_GROUP_TITLE,
        permissions: [
            {
                key: "share_for_reconciliation",
                label: "Share account for reconciling (header)",
                description:
                    "Shows the Share for Reconciling button in the app header. The user can choose a company account and send a ledger snapshot to another Pocket Ledger user by email to start reconciling.",
            },
            {
                key: "link_reconciliation_accounts",
                label: "Link shared account to local ledger",
                description:
                    "Allows accepting incoming reconciliation requests and linking them to an account in the user’s company (party, bank, etc.). Required before both sides can compare ledgers.",
            },
            {
                key: "view_reconciliation",
                label: "View reconciling compare page",
                description:
                    "Opens the side-by-side Reconciling page for linked shares. Also shows the Reconciling button on account detail screens when that account has an active linked share.",
            },
            {
                key: "view_reconciliation_shared_list",
                label: "View Shared list tab",
                description:
                    "Shows the Shared list tab in the Share for Reconciling dialog—pending invites, linked shares, and active reconciliation links for the selected company.",
            },
            {
                key: "view_reconciliation_unlinked_list",
                label: "View Unlinked tab",
                description:
                    "Shows the Unlinked tab in the Share for Reconciling dialog, where disconnected or revoked shares are listed and can be requested again.",
            },
            {
                key: "sync_reconciliation_transaction",
                label: "Can sync trxn",
                description:
                    "On the Reconciling compare page, allows copying a transaction from the other side into a new voucher on your ledger when your row is blank (Sync transaction link on selected rows).",
            },
        ],
    },
    {
        title: "Attachments",
        permissions: [
            {
                key: "unlock_locked_pdf",
                label: "Unlock locked PDF attachments",
                description:
                    "Allows turning off Lock As Pdf on saved voucher or master records that already have locked PDF attachments. Without this, locked PDFs stay as PDF and cannot be converted to JPEG.",
            },
        ],
    },
    {
        title: "Adjustment Voucher",
        permissions: [
            { key: "add_adjustment_voucher", label: "Add Adjustment Voucher" },
            { key: "edit_adjustment_voucher", label: "Edit Adjustment Voucher" },
        ],
    },
    {
        // HR group sabse aakhir me rakho — role arrays positional hain (usePermissions flattenedPermissions).
        title: "HR",
        permissions: [
            { key: "hr_view", label: "View HR" },
            { key: "hr_manage", label: "Manage Employees" },
            { key: "hr_attendance", label: "Mark Attendance" },
            { key: "hr_leave_approve", label: "Approve Leaves" },
            { key: "hr_payroll", label: "Manage Payroll" },
        ],
    },
];

export const allPermissions = PermissionGroups.flatMap(group => group.permissions.map(p => p.key));
