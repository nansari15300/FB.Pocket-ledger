/**
 * Where role `permissionConfig` is expected to come from for the active company.
 * Helps debug PL-server host → client vs Firebase vs local defaults.
 */
import {
  companyRowUsesSqliteLedgerWrites,
  isServerGateCompany,
  isServerSelectorCompanyRow,
} from "@/lib/companyStorageKind";
import { isCloudLinkedCompanyStorage, isOfflineCompanyStorage } from "@/lib/companyUnlockGate";
import { isLocalServerShareableCompany } from "@/lib/localServerShareableCompanies";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isPlServerThinStaffClient } from "@/lib/plServerThinStaffClient";
import { getPlServerAccessLabel, getPlServerContextGateId } from "@/lib/plServerAccessContext";
import { isPlRemoteServerClientMode } from "@/lib/plRemoteServerClient";

export type PermissionConfigSourceKind = "plserver" | "firebase" | "local-sqlite" | "default";

export type PermissionConfigSourceInfo = {
  kind: PermissionConfigSourceKind;
  /** Short label for UI */
  label: string;
  /** Origin / path that provides (or should provide) role permissions */
  url: string;
  detail: string;
};

type CompanyLike = {
  id?: string;
  plServerShared?: boolean;
  storageOption?: string | null;
  syncPolicy?: string | null;
  syncedFromCloud?: boolean;
  authoritativeCompanyId?: string;
  plServerHostCompanyId?: string;
  driveSharedJoin?: boolean;
  cloudSyncEnabled?: boolean;
  cloudSyncProvider?: string | null;
  cloudSyncDriveFolderId?: string | null;
} | null | undefined;

/** Google Drive cloud-sync / shared-join — roles via Drive sync, not Firebase sharedWith. */
function isDriveCloudSyncRoleAuthority(company: CompanyLike): boolean {
  if (!company) return false;
  if (company.driveSharedJoin === true) return true;
  const folderId = String(company.cloudSyncDriveFolderId ?? "").trim();
  if (!folderId || company.cloudSyncEnabled !== true) return false;
  return String(company.cloudSyncProvider ?? "").toLowerCase().trim() === "google_drive";
}

/**
 * Strict rule: local + PL-server/gate companies never use Firebase for role permissions.
 * Online Firebase companies only use Firestore.
 */
export function companyUsesDeviceOrPlPermissionConfig(company: CompanyLike): boolean {
  if (!company) return isPlServerThinStaffClient() || isPlRemoteServerClientMode();
  if (isPlServerThinStaffClient() || isPlRemoteServerClientMode()) return true;
  if (company.plServerShared === true) return true;
  if (isServerGateCompany(company) || isServerSelectorCompanyRow(company)) return true;
  if (String((company as { plServerHostCompanyId?: string }).plServerHostCompanyId || "").trim()) {
    return true;
  }
  if (isLocalServerShareableCompany(company)) return true;
  if (isOfflineCompanyStorage(company)) return true;
  if (companyRowUsesSqliteLedgerWrites(company)) return true;
  return false;
}

/**
 * Role authority root by company context:
 * - Online → Firebase
 * - PL Server / local device → SQLite / PL host URL (never Firebase sharedWith)
 * - Drive sync → Drive (never Firebase sharedWith)
 * Same company id in Online + PL tabs: PL context still excludes Firebase roles.
 */
export function companyRolesAuthorityExcludesFirebase(company: CompanyLike): boolean {
  if (companyUsesDeviceOrPlPermissionConfig(company)) return true;
  if (isDriveCloudSyncRoleAuthority(company)) return true;
  return false;
}

export function resolvePermissionConfigSource(company: CompanyLike): PermissionConfigSourceInfo {
  const cid = String(company?.id || "").trim();

  // Online company + global sync OFF → SQLite cache (not PL Server); avoid misleading plserver logs.
  if (
    company &&
    isCloudLinkedCompanyStorage(company) &&
    !isServerGateCompany(company) &&
    company.plServerShared !== true &&
    isFirebaseLedgerDataSyncDisabled()
  ) {
    return {
      kind: "firebase",
      label: "Firebase (sync paused)",
      url: cid ? `sqlite://online_cache/${cid}` : "sqlite://online_cache",
      detail:
        "Online company on this device — Cloud data sync is OFF; enable it to read/write Firestore permissions and ledger.",
    };
  }

  const deviceOrPl = companyUsesDeviceOrPlPermissionConfig(company);

  if (deviceOrPl) {
    if (company && isLocalServerShareableCompany(company) && !isServerGateCompany(company)) {
      return {
        kind: "plserver",
        label: "PL-server host (this PC)",
        url: typeof window !== "undefined" ? window.location.origin : "this-pc",
        detail:
          "Host SQLite local_companies.permissionConfig — staff clients sync from this PC via PL gate.",
      };
    }
    const accessLabel = getPlServerAccessLabel()?.trim() || "";
    const gateId = getPlServerContextGateId()?.trim() || "";
    let url = accessLabel;
    if (!url && typeof window !== "undefined") {
      try {
        url = window.location.origin;
      } catch {
        url = "";
      }
    }
    if (!url) url = gateId ? `pl-server gate:${gateId}` : "pl-server / local SQLite";
    const isPureLocal =
      Boolean(company) &&
      isOfflineCompanyStorage(company!) &&
      !isServerGateCompany(company!) &&
      company!.plServerShared !== true;
    return {
      kind: isPureLocal ? "local-sqlite" : "plserver",
      label: isPureLocal ? "Local SQLite" : "PL-server",
      url: isPureLocal
        ? cid
          ? `sqlite://local_companies/${cid}`
          : "sqlite://local_companies"
        : url,
      detail: isPureLocal
        ? "Offline company — permissionConfig on this device only (never Firebase)."
        : "Role permissions via host SQLite → company meta / delta (not Firebase).",
    };
  }

  if (isDriveCloudSyncRoleAuthority(company)) {
    return {
      kind: "local-sqlite",
      label: "Google Drive",
      url: cid ? `drive://company/${cid}` : "drive://company",
      detail: "Drive-synced company — roles from Drive share / local SQLite (not Firebase).",
    };
  }

  return {
    kind: "firebase",
    label: "Firebase",
    url: cid
      ? `firestore://companies/${cid}.permissionConfig`
      : "firestore://companies/{id}.permissionConfig",
    detail: "Online company — role permissions from Firestore company document.",
  };
}

/** Module-level dedupe: usePermissions runs in many trees; per-hook refs still flood HMR. */
const plPermLastByTag = new Map<string, string>();

/** Always-on trace for host→client permission delivery (DevTools filter: PL-PERM). */
export function logPlPerm(tag: string, payload: Record<string, unknown>): void {
  // Console flood off — re-enable when diagnosing permission delivery.
  void tag;
  void payload;
  void plPermLastByTag;
}

export function summarizePermissionDateLimits(
  config:
    | {
        dateLimits?: Record<
          string,
          { entryDays?: number; editDays?: number; deleteDays?: number }
        >;
      }
    | null
    | undefined,
  role?: string
): Record<string, unknown> {
  const dl = config?.dateLimits || {};
  if (role && dl[role]) {
    return { role, ...(dl[role] as object) };
  }
  const out: Record<string, unknown> = {};
  for (const r of ["viewer", "manager", "admin", "editor", "accountant", "data-entry", "owner"]) {
    if (dl[r]) out[r] = dl[r];
  }
  return out;
}
