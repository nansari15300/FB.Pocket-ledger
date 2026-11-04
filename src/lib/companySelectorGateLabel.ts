"use client";

import type { Company } from "@/hooks/useCompany";
import {
  isServerGateCompany,
  isSharedOnlineCompany,
  isServerSelectorCompanyRow,
  isPocketBaseSelectorCompanyRow,
  partitionCompaniesForUnlockDialog,
  type CompanyListTab,
  type SelectorCompanyBuckets,
} from "@/lib/companyStorageKind";
import { isCloudLinkedCompanyStorage, isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { getActiveGate, getGateById, listGates, normalizeServerUrl } from "@/lib/gates/gateStore";
import type { GateRecord } from "@/lib/gates/gateTypes";
import { fetchPlServerCompanyLoginMeta } from "@/lib/plServerRemoteCompanyLogin";
import { isPlRemoteServerClientMode } from "@/lib/plRemoteServerClient";
import { readRememberedSharedUnlockUsername } from "@/lib/onlineSharedUnlockRememberUsername";

type CompanyGateRow = Company & {
  plServerGateId?: string;
  plServerShared?: boolean;
  usernameHint?: string | null;
};

export type CompanySelectorGateInfo = {
  tabLabel: "Local" | "PL Server" | "Firebase" | "PocketBase";
  gateName: string | null;
};

export const COMPANY_SELECTOR_TAB_LABELS: Record<CompanyListTab, string> = {
  local: "Local",
  server: "PL Server",
  online: "Firebase",
  pocketbase: "Online",
};

/** Short line under company picker tabs — login method vs which books live where. */
export const COMPANY_SELECTOR_TAB_HINT =
  "Local = this device. PL Server = EXE/LAN share. Online = Pocket Ledger Server.";

/** Server company row se PL gate — id, stamped URL, ya active local_server gate. */
export function resolveServerGateForCompany(company: {
  plServerGateId?: string;
  plServerGateServerUrl?: string;
}): GateRecord | null {
  const gateId = String(company.plServerGateId || "").trim();
  if (gateId) {
    const gate = getGateById(gateId);
    if (gate?.type === "local_server") return gate;
  }
  const rowUrl = normalizeServerUrl(String(company.plServerGateServerUrl || "").trim());
  if (rowUrl) {
    for (const gate of listGates()) {
      if (gate.type !== "local_server") continue;
      if (normalizeServerUrl(gate.serverUrl || "") === rowUrl) return gate;
    }
  }
  const active = getActiveGate();
  return active.type === "local_server" ? active : null;
}

/** Company picker credential dialog: Local / Server / Online + optional gate label. */
export function resolveCompanySelectorGateInfo(
  company: CompanyGateRow | null | undefined
): CompanySelectorGateInfo {
  if (!company) return { tabLabel: "Local", gateName: null };

  if (isPocketBaseSelectorCompanyRow(company)) {
    return { tabLabel: "PocketBase", gateName: null };
  }

  const remoteClient = typeof window !== "undefined" && isPlRemoteServerClientMode();
  if (
    isServerGateCompany(company) ||
    isServerSelectorCompanyRow(company) ||
    (remoteClient && isOfflineCompanyStorage(company))
  ) {
    const gate = resolveServerGateForCompany(company);
    return {
      tabLabel: "PL Server",
      gateName: gate?.label ?? (remoteClient ? "Server PC" : null),
    };
  }

  if (
    isCloudLinkedCompanyStorage(company) ||
    isSharedOnlineCompany(company) ||
    (company.syncedFromCloud === true && !isOfflineCompanyStorage(company))
  ) {
    const active = getActiveGate();
    return {
      tabLabel: "Firebase",
      gateName: active.type === "online" ? active.label : null,
    };
  }

  const gateId = String(company.plServerGateId || "").trim();
  const gate = gateId ? getGateById(gateId) : getActiveGate();
  return {
    tabLabel: "Local",
    gateName: gate?.label ?? null,
  };
}

/** Staff thin client par server SQLite HTTP login; host `:3001` / `:3000` par direct local SQLite. */
export function companyUsesRemotePlServerLogin(
  company: CompanyGateRow | null | undefined
): boolean {
  if (!company) return false;
  if (typeof window !== "undefined" && isPlRemoteServerClientMode()) {
    return isOfflineCompanyStorage(company) || isServerGateCompany(company);
  }
  return isServerGateCompany(company);
}

/** Unlock dialog username — remembered, row hint, phir server meta API. */
export async function prefetchCompanyUnlockUsernameHint(
  company: CompanyGateRow,
  appUser: { uid?: string | null; email?: string | null },
  options?: { gate?: GateRecord | null; allowRememberedUsername?: boolean }
): Promise<string> {
  const allowRemembered = options?.allowRememberedUsername !== false;
  if (allowRemembered && appUser.uid) {
    const remembered = readRememberedSharedUnlockUsername(
      appUser.uid,
      company.id,
      appUser.email
    );
    if (remembered) return remembered;
  }

  const rowHint = String(company.usernameHint || "").trim();
  if (rowHint) return rowHint;

  if (!companyUsesRemotePlServerLogin(company) && !isServerGateCompany(company)) {
    return "";
  }

  const gate = options?.gate ?? resolveServerGateForCompany(company);
  const meta = await fetchPlServerCompanyLoginMeta(company.id, {
    gate,
    appEmail: appUser.email,
    appUid: appUser.uid,
  });
  return meta.usernameHint?.trim() || "";
}

/** Company picker tab (Local / Server / Online) for unlock dialog. */
export function resolveCompanySelectorTab(
  company: CompanyGateRow | null | undefined
): CompanyListTab {
  if (!company) return "local";
  const info = resolveCompanySelectorGateInfo(company);
  if (info.tabLabel === "PocketBase") return "pocketbase";
  if (info.tabLabel === "PL Server") return "server";
  if (info.tabLabel === "Firebase") return "online";
  return "local";
}

export function unlockTabCompanies(
  buckets: SelectorCompanyBuckets,
  tab: CompanyListTab
): Company[] {
  if (tab === "local") return buckets.localTabCompanies;
  if (tab === "server") return buckets.serverTabCompanies;
  if (tab === "pocketbase") return buckets.pocketbaseTabCompanies;
  return buckets.onlineTabCompanies;
}

/** Credential dialog: hamesha teeno gate tabs — Server khali ho to bhi Gate page par jaa sako. */
export function availableUnlockTabs(): CompanyListTab[] {
  return ["local", "server", "online", "pocketbase"];
}

/** Unlock dialog tab — bucket membership pehle, heuristic fallback. */
export function resolveCompanyUnlockTab(
  company: CompanyGateRow,
  buckets: SelectorCompanyBuckets
): CompanyListTab {
  if (buckets.pocketbaseTabCompanies.some((c) => c.id === company.id)) return "pocketbase";
  if (buckets.serverTabCompanies.some((c) => c.id === company.id)) return "server";
  if (buckets.onlineTabCompanies.some((c) => c.id === company.id)) return "online";
  if (buckets.localTabCompanies.some((c) => c.id === company.id)) return "local";
  return resolveCompanySelectorTab(company);
}

export function pickCompanyForUnlockTab(
  companies: Company[],
  tab: CompanyListTab,
  preferId?: string | null
): Company | null {
  const buckets = partitionCompaniesForUnlockDialog(companies);
  const list = unlockTabCompanies(buckets, tab);
  if (list.length === 0) return null;
  if (preferId) {
    const kept = list.find((c) => c.id === preferId);
    if (kept) return kept;
  }
  return list[0] ?? null;
}
