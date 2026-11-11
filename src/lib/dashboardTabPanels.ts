/** Dashboard Daybook tab: voucher pipeline lookback (not full SQLite mirror). */
export const DASHBOARD_EMBEDDED_DAYBOOK_VOUCHER_LOOKBACK_DAYS = 32;

/** Daybook (TransactionsTable + useTransactions) — hide when inactive, do not unmount after first open. */
export const DASHBOARD_KEEP_ALIVE_TAB_IDS = new Set<string>(["daybook"]);

export function dashboardTabShouldKeepAlivePanel(tabId: string): boolean {
  return DASHBOARD_KEEP_ALIVE_TAB_IDS.has(normalizeDashboardVisibleCard(tabId));
}

/** Dashboard footer tab → panel ids (legacy helper). */
export function dashboardKeepAlivePanelIdsForTab(tabId: string): string[] {
  switch (normalizeDashboardVisibleCard(tabId)) {
    case "financial-summaries":
      return ["financial-summaries"];
    case "stock-summary":
      return ["stock-summary"];
    case "dashboard-charts":
      return ["dashboard-charts"];
    case "bank-cash-summary":
      return ["bank-cash-summary"];
    case "daybook":
      return ["daybook"];
    case "recent-transactions":
      return ["recent-transactions"];
    default:
      return ["financial-summaries"];
  }
}

export const DASHBOARD_TAB_CHANGED_EVENT = "pl-dashboard-tab-changed";
export const DASHBOARD_TAB_SESSION_KEY = "dashboardVisibleCard";
/** Chart footer = Summary screen + mini charts (not a separate route tab id). */
export const DASHBOARD_SUMMARY_CHARTS_SESSION_KEY = "dashboardSummaryChartsActive";
export const DASHBOARD_SUMMARY_CHART_KIND_KEY = "dashboardSummaryChartKind";
export type DashboardSummaryChartKind = "bar" | "line";

export function normalizeDashboardVisibleCard(saved: string | null | undefined): string {
  if (!saved || saved === "auto-recurring" || saved === "all") return "financial-summaries";
  if (saved === "dashboard-charts") return "financial-summaries";
  const allowed = new Set([
    "financial-summaries",
    "stock-summary",
    "bank-cash-summary",
    "daybook",
    "recent-transactions",
  ]);
  return allowed.has(saved) ? saved : "financial-summaries";
}

export function readDashboardSummaryChartsFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const session = sessionStorage.getItem(DASHBOARD_SUMMARY_CHARTS_SESSION_KEY);
    const local = localStorage.getItem(DASHBOARD_SUMMARY_CHARTS_SESSION_KEY);
    if (session === "1" || local === "1") return true;
    const tabSession = sessionStorage.getItem(DASHBOARD_TAB_SESSION_KEY);
    const tabLocal = localStorage.getItem(DASHBOARD_TAB_SESSION_KEY);
    return tabSession === "dashboard-charts" || tabLocal === "dashboard-charts";
  } catch {
    return false;
  }
}

export function readDashboardSummaryChartKindFromStorage(): DashboardSummaryChartKind {
  if (typeof window === "undefined") return "bar";
  try {
    const session = sessionStorage.getItem(DASHBOARD_SUMMARY_CHART_KIND_KEY);
    const local = localStorage.getItem(DASHBOARD_SUMMARY_CHART_KIND_KEY);
    return session === "line" || local === "line" ? "line" : "bar";
  } catch {
    return "bar";
  }
}

export function syncDashboardSummaryChartKindToSession(kind: DashboardSummaryChartKind): void {
  try {
    sessionStorage.setItem(DASHBOARD_SUMMARY_CHART_KIND_KEY, kind);
    localStorage.setItem(DASHBOARD_SUMMARY_CHART_KIND_KEY, kind);
  } catch {
    /* private mode / quota */
  }
}

export function syncDashboardSummaryChartsToSession(active: boolean): void {
  const v = active ? "1" : "0";
  try {
    sessionStorage.setItem(DASHBOARD_SUMMARY_CHARTS_SESSION_KEY, v);
    localStorage.setItem(DASHBOARD_SUMMARY_CHARTS_SESSION_KEY, v);
  } catch {
    /* private mode / quota */
  }
}

export function readDashboardVisibleCardFromStorage(): string {
  if (typeof window === "undefined") return "financial-summaries";
  try {
    const session = sessionStorage.getItem(DASHBOARD_TAB_SESSION_KEY);
    const local = localStorage.getItem(DASHBOARD_TAB_SESSION_KEY);
    const raw = session || local;
    if (raw === "dashboard-charts") {
      syncDashboardSummaryChartsToSession(true);
      syncDashboardTabToSession("financial-summaries");
      return "financial-summaries";
    }
    const tab = normalizeDashboardVisibleCard(raw);
    if (local === "all" || local === "auto-recurring") {
      localStorage.setItem(DASHBOARD_TAB_SESSION_KEY, tab);
    }
    return tab;
  } catch {
    return "financial-summaries";
  }
}

export function syncDashboardTabToSession(tabId: string): string {
  const id = normalizeDashboardVisibleCard(tabId);
  try {
    sessionStorage.setItem(DASHBOARD_TAB_SESSION_KEY, id);
    localStorage.setItem(DASHBOARD_TAB_SESSION_KEY, id);
  } catch {
    /* private mode / quota */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DASHBOARD_TAB_CHANGED_EVENT, { detail: id }));
  }
  return id;
}

/** SQLite / master prefetch scope for active dashboard tab only. */
export function dashboardMasterCollectionPathsForTab(tabId: string): Set<string> {
  switch (normalizeDashboardVisibleCard(tabId)) {
    case "bank-cash-summary":
      return new Set(["vouchers", "bank_accounts", "account_groups", "taxes"]);
    case "daybook":
      return new Set([
        "vouchers",
        "bank_accounts",
        "account_groups",
        "taxes",
        "parties",
        "groups",
        "staff",
        "expense_accounts",
      ]);
    case "recent-transactions":
      return new Set([
        "vouchers",
        "parties",
        "bank_accounts",
        "staff",
        "expense_accounts",
        "taxes",
        "groups",
        "account_groups",
      ]);
    case "dashboard-charts":
    case "financial-summaries":
    case "stock-summary":
      return new Set([
        "vouchers",
        "parties",
        "staff",
        "bank_accounts",
        "taxes",
        "expense_accounts",
        "items",
        "groups",
        "account_groups",
      ]);
    default:
      return new Set(["vouchers", "bank_accounts", "account_groups", "taxes"]);
  }
}

export function readDashboardActiveTabForBootstrap(): string {
  return readDashboardVisibleCardFromStorage();
}

/** Tab needs full voucher → recent txn pipeline (useTransactions daybook context). */
export function dashboardTabLoadsRecentTransactionPipeline(tabId: string): boolean {
  return normalizeDashboardVisibleCard(tabId) === "recent-transactions";
}

/** Tab needs stock / stat card voucher scans. */
export function dashboardTabLoadsSummaryStockStats(tabId: string): boolean {
  const tab = normalizeDashboardVisibleCard(tabId);
  return tab === "financial-summaries" || tab === "stock-summary";
}
