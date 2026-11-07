import {
  dashboardMasterCollectionPathsForTab,
  readDashboardActiveTabForBootstrap,
} from "@/lib/dashboardTabPanels";
import { withoutWebAppBasePath } from "@/lib/webAppBasePath";

/** Voucher forms + cross-device master live sync — shared route → collection scope. */

export const VOUCHER_FORM_MASTER_COLLECTION_PATHS = new Set([
  "vouchers",
  "parties",
  "staff",
  "bank_accounts",
  "taxes",
  "expense_accounts",
  "items",
  "item_groups",
  "groups",
  "account_groups",
  "staff_groups",
  "tax_groups",
  "expense_groups",
]);

export function activeMasterCollectionPathsForRoute(
  pathname: string,
  voucherFormMasterScope = false
): Set<string> {
  if (voucherFormMasterScope) return VOUCHER_FORM_MASTER_COLLECTION_PATHS;
  const cleanPath = withoutWebAppBasePath(pathname);
  const route = String(cleanPath || "").trim().toLowerCase();
  if (route.startsWith("/bank-cash")) return new Set(["vouchers", "bank_accounts", "account_groups"]);
  if (route.startsWith("/party")) return new Set(["vouchers", "parties", "groups", "expense_accounts"]);
  if (route.startsWith("/staff")) return new Set(["vouchers", "staff", "staff_groups"]);
  if (route.startsWith("/loans")) {
    return new Set([
      "vouchers",
      "staff",
      "staff_groups",
      "bank_accounts",
      "account_groups",
      "expense_accounts",
      "expense_groups",
    ]);
  }
  if (route.startsWith("/tax")) return new Set(["vouchers", "taxes", "tax_groups"]);
  if (route.startsWith("/items")) return new Set(["vouchers", "items", "item_groups"]);
  if (route.startsWith("/incomes")) return new Set(["vouchers", "expense_accounts", "expense_groups"]);
  if (route.startsWith("/gallery")) return new Set(["vouchers"]);
  // Reports hub (`/reports`) embeds Trial Balance, Party P&L, registers, etc. — masters chahiye (pehle vouchers-only → Unknown Party).
  if (route === "/reports" || route === "/reports/" || route.startsWith("/reports/")) {
    return VOUCHER_FORM_MASTER_COLLECTION_PATHS;
  }
  if (route.startsWith("/dashboard")) {
    return dashboardMasterCollectionPathsForTab(readDashboardActiveTabForBootstrap());
  }
  return VOUCHER_FORM_MASTER_COLLECTION_PATHS;
}
