import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";

/**
 * Browser tab + **Electron EXE tab strip** (`webContents.getTitle()` = `document.title`).
 * EXE: sirf section label; web: `Parties · Pocket Ledger`. **AppSidebar** hrefs se sync rakho.
 */
const APP = "Pocket Ledger";
/** Pehle lambe `prefix` (nested route pe sahi title) */
const ROUTE_PREFIX_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/sale/invoice", label: "Sale invoice" },
  { prefix: "/billing/success", label: "Billing" },
  { prefix: "/billing/plan-change", label: "Billing" },
  { prefix: "/billing/cancel", label: "Billing" },
  { prefix: "/company/create", label: "New company" },
  { prefix: "/settings", label: "Settings" },
  { prefix: "/import-export", label: "Import/Export" },
  { prefix: "/distributor-signup", label: "Be a Distributor" },
  { prefix: "/recycle-bin", label: "Recycle Bin" },
  { prefix: "/sale-note", label: "Sale Note" },
  { prefix: "/purchase-note", label: "Purchase Note" },
  { prefix: "/reports", label: "Reports" },
  { prefix: "/gallery", label: "Gallery" },
  { prefix: "/production", label: "Production" },
  { prefix: "/quotations", label: "Quotations" },
  { prefix: "/dashboard", label: "Dashboard" },
  { prefix: "/bank-cash", label: "Bank/Cash" },
  { prefix: "/incomes", label: "Income & Expense" },
  { prefix: "/party", label: "Parties" },
  { prefix: "/payment-in", label: "Receipt" },
  { prefix: "/payment-out", label: "Payment Out" },
  { prefix: "/journal", label: "Journal" },
  { prefix: "/inter-company", label: "Inter Company" },
  { prefix: "/add-salary", label: "Add Salary" },
  { prefix: "/purchase", label: "Purchase" },
  { prefix: "/messages", label: "Messages" },
  { prefix: "/gate", label: "Gate" },
  { prefix: "/billing", label: "Billing & Plans" },
  { prefix: "/backup", label: "Backup & Restore" },
  { prefix: "/company", label: "Company" },
  { prefix: "/contra", label: "Contra" },
  { prefix: "/embed", label: "Voucher" },
  { prefix: "/sale", label: "Sale" },
  { prefix: "/loans", label: "Loan Overview" },
  { prefix: "/staff", label: STAFF_ENTITY_LABEL },
  { prefix: "/items", label: "Items & Service" },
  { prefix: "/tax", label: "Tax" },
  { prefix: "/notes", label: "Notes" },
].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Web: `Parties · Pocket Ledger`; EXE: sirf `Parties`.
 */
export function getDashboardDocumentTitle(pathname: string | null | undefined): string {
  if (!pathname) return APP;
  const path = pathname.replace(/\/$/, "") || "/";
  for (const { prefix, label } of ROUTE_PREFIX_LABELS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return isElectronDesktopApp() ? label : `${label} · ${APP}`;
    }
  }
  return APP;
}
