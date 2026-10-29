import type { CompanyListTab } from "@/lib/companyStorageKind";
import { isPlServerPackedApp } from "@/lib/plServerPackedApp";

/** Admin Add/Remove Features → Company tabs (Local / PL Server / Firebase / PocketBase). */
export const COMPANY_STORAGE_TAB_FEATURE = {
  parent: "company-storage-tabs",
  local: "company_tab_local",
  server: "company_tab_server",
  online: "company_tab_online",
  pocketbase: "company_tab_pocketbase",
} as const;

export const COMPANY_STORAGE_TAB_FEATURE_LABEL =
  "Company tabs (Local / PL Server / Firebase / PocketBase)";

const TAB_FEATURE_KEY: Record<CompanyListTab, string> = {
  local: COMPANY_STORAGE_TAB_FEATURE.local,
  server: COMPANY_STORAGE_TAB_FEATURE.server,
  online: COMPANY_STORAGE_TAB_FEATURE.online,
  pocketbase: COMPANY_STORAGE_TAB_FEATURE.pocketbase,
};

const ALL_TABS: CompanyListTab[] = ["local", "server", "online", "pocketbase"];

/** Missing key = enabled (same as other app_settings/features flags). */
export function isCompanySelectorTabFeatureEnabled(
  featureConfig: Record<string, boolean> | null | undefined,
  tab: CompanyListTab
): boolean {
  if (!featureConfig) return true;
  if (featureConfig[COMPANY_STORAGE_TAB_FEATURE.parent] === false) return false;
  return featureConfig[TAB_FEATURE_KEY[tab]] !== false;
}

/**
 * Visible Local / PL Server / Firebase / PocketBase tabs for company selector.
 * Packed country app is PocketBase My Company only.
 */
export function visibleCompanySelectorTabs(
  featureConfig: Record<string, boolean> | null | undefined
): CompanyListTab[] {
  if (isPlServerPackedApp()) return ["pocketbase"];
  const visible = ALL_TABS.filter((tab) => isCompanySelectorTabFeatureEnabled(featureConfig, tab));
  return visible.length > 0 ? visible : [...ALL_TABS];
}

export function resolveVisibleCompanySelectorTab(
  featureConfig: Record<string, boolean> | null | undefined,
  prefer?: CompanyListTab | null
): CompanyListTab {
  const visible = visibleCompanySelectorTabs(featureConfig);
  if (prefer && visible.includes(prefer)) return prefer;
  return visible[0] ?? "local";
}

export function companySelectorTabsGridClass(tabCount: number): string {
  if (tabCount <= 1) return "grid-cols-1";
  if (tabCount === 2) return "grid-cols-2";
  if (tabCount === 3) return "grid-cols-3";
  return "grid-cols-4";
}
