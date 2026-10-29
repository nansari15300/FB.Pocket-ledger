import type { CompanyListTab } from "@/lib/companyStorageKind";
import { isPlServerPackedApp } from "@/lib/plServerPackedApp";

/** Admin Add/Remove Features → Company tabs (Local / Server / Online). */
export const COMPANY_STORAGE_TAB_FEATURE = {
  parent: "company-storage-tabs",
  local: "company_tab_local",
  server: "company_tab_server",
  online: "company_tab_online",
} as const;

export const COMPANY_STORAGE_TAB_FEATURE_LABEL = "Company tabs (Local / Server / Online)";

const TAB_FEATURE_KEY: Record<CompanyListTab, string> = {
  local: COMPANY_STORAGE_TAB_FEATURE.local,
  server: COMPANY_STORAGE_TAB_FEATURE.server,
  online: COMPANY_STORAGE_TAB_FEATURE.online,
};

const ALL_TABS: CompanyListTab[] = ["local", "server", "online"];

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
 * Visible Local / Server / Online tabs for company selector / unlock / voucher picker.
 * If admin hid every tab, fall back to all three so the app stays usable.
 */
export function visibleCompanySelectorTabs(
  featureConfig: Record<string, boolean> | null | undefined
): CompanyListTab[] {
  if (isPlServerPackedApp()) return ["server"];
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
