/**
 * Company Selector Online tab Data / Files ticks — same on web / EXE / APK / iOS.
 *
 * Data tick OFF = no cloud download/upload for masters/vouchers (outbox / pull / change-feed).
 * Local SQLite already on device still shows in UI (offline work).
 *
 * Files tick OFF = no attachment download/prefetch of existing cloud files; already-downloaded
 * device cache / local: still open. Newly added files may still upload when Data is on.
 * Voucher Attach Files UI + local add/save still allowed (role/plan only) — Files tick is NOT a role block.
 *
 * Local / Server companies do not use these ticks.
 */
import {
  getFirebaseLedgerCompanySyncEntry,
  isFirebaseLedgerCompanyAttachmentSyncEnabled,
  isFirebaseLedgerCompanyAttachmentUploadEnabled,
  isFirebaseLedgerCompanyDataSyncEnabled,
} from "@/lib/firebaseLedgerCompanySyncPrefs";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import type { Company } from "@/hooks/useCompany";

export type OnlineSelectorSyncCompany = Company | null | undefined;

/** Firebase Online companies that use Company Selector Data / Files columns. */
export function companyUsesOnlineSelectorSyncTicks(
  company: OnlineSelectorSyncCompany
): boolean {
  return isCloudBackedCompanyShape(company ?? null);
}

/**
 * Ledger UI may read Local SQLite / show masters & vouchers.
 * Always allowed when company id present — Data untick does NOT hide already-loaded local data.
 */
export function isOnlineCompanyLedgerUiAllowed(
  companyId: string,
  _company?: OnlineSelectorSyncCompany
): boolean {
  return Boolean(String(companyId || "").trim());
}

/**
 * Cloud download/upload for masters/vouchers (Firestore pull, change-feed, outbox flush).
 * Online + cloud sync ON → Company Selector Data tick required. Same all platforms.
 */
export function isOnlineCompanyLedgerCloudSyncAllowed(
  companyId: string,
  company?: OnlineSelectorSyncCompany
): boolean {
  const id = String(companyId || "").trim();
  if (!id) return false;
  if (!companyUsesOnlineSelectorSyncTicks(company ?? null)) return true;
  if (isFirebaseLedgerDataSyncDisabled()) return false;
  return isFirebaseLedgerCompanyDataSyncEnabled(id, company ?? null);
}

/**
 * Attachment download for Online companies (Company Selector Files tick).
 * Does NOT gate voucher Attach Files UI / local add — only cloud download of existing files.
 * Local/Server → allowed. Global cloud sync OFF → treat as local (no cloud transfer gate).
 */
export function isOnlineCompanyFilesUiAllowed(
  companyId: string,
  company?: OnlineSelectorSyncCompany
): boolean {
  const id = String(companyId || "").trim();
  if (!id) return false;
  // PocketBase companies: files always on (no Files tick / opt-in).
  if (isPocketBaseCompany(id, company)) return true;
  if (company != null && !companyUsesOnlineSelectorSyncTicks(company)) return true;
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  if (company != null && companyUsesOnlineSelectorSyncTicks(company)) {
    return isFirebaseLedgerCompanyAttachmentSyncEnabled(id, company);
  }
  // No company row: Data tick on ⇒ Files tick required for download; else don't block unknown/local.
  const entry = getFirebaseLedgerCompanySyncEntry(id);
  if (entry.data === true) return entry.attachments === true;
  return true;
}

/** Alias — network download for attachments (not local-cache open, not new-file upload). */
export function isOnlineCompanyAttachmentNetworkAllowed(
  companyId: string,
  company?: OnlineSelectorSyncCompany
): boolean {
  return isOnlineCompanyFilesUiAllowed(companyId, company);
}

/** New attachment upload to cloud — Data tick; Files untick does not block. */
export function isOnlineCompanyAttachmentUploadAllowed(
  companyId: string,
  company?: OnlineSelectorSyncCompany
): boolean {
  const id = String(companyId || "").trim();
  if (!id) return false;
  // PocketBase companies: no Data/Files opt-in (uploads ride the PB outbox).
  if (isPocketBaseCompany(id, company)) return true;
  if (company != null && !companyUsesOnlineSelectorSyncTicks(company)) return true;
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  if (company != null && companyUsesOnlineSelectorSyncTicks(company)) {
    return isFirebaseLedgerCompanyAttachmentUploadEnabled(id, company);
  }
  const entry = getFirebaseLedgerCompanySyncEntry(id);
  if (entry.data === true) return true;
  return true;
}

/** Dashboard / ledger status ribbon for Online company Data / Files ticks. */
export type OnlineSyncStatusRibbon = {
  show: boolean;
  message: string;
};

/**
 * Single-line status:
 * Dashboard popup (2s on company / tick switch) — not a permanent ribbon:
 * - Data off → no online update (Local SQLite still shown; add/edit OK)
 * - Data on, Files off → data syncing; file updates disabled
 * - Both on → no message
 */
export function getOnlineCompanySyncStatusRibbon(
  companyId: string,
  company?: OnlineSelectorSyncCompany
): OnlineSyncStatusRibbon {
  const id = String(companyId || "").trim();
  if (!id || !companyUsesOnlineSelectorSyncTicks(company ?? null) || isPocketBaseCompany(id, company)) {
    return { show: false, message: "" };
  }
  if (isFirebaseLedgerDataSyncDisabled()) {
    return { show: false, message: "" };
  }
  const entry = getFirebaseLedgerCompanySyncEntry(id);
  if (!entry.data) {
    return {
      show: true,
      message:
        "Data tick is off (this Online company will not update online till enable tick)",
    };
  }
  if (!entry.attachments) {
    return {
      show: true,
      message: "Data is updating online. File download is off; new file uploads still go to cloud.",
    };
  }
  return { show: false, message: "" };
}

export type OnlineBackupTickGate = {
  /** Local SQLite data-only backup — always OK (offline). */
  dataAllowed: boolean;
  /**
   * Attachment embed allowed.
   * Local-only / device-bytes embed does NOT need Files tick.
   * Online merge that may download missing files → Files tick required.
   */
  filesAllowed: boolean;
  needDataTick: boolean;
  needFilesTick: boolean;
  dataMessage: string | null;
  filesMessage: string | null;
};

export type OnlineBackupTickGateOpts = {
  /**
   * `local_only` / `for_offline` / static SQLite embed — only bytes already on device;
   * missing stay as URLs. Files tick not required.
   * `online_merge` (default when omitted for Online companies) may download → Files tick.
   */
  attachmentEmbedMode?: "local_device_bytes" | "may_download";
};

export function getOnlineCompanyBackupTickGate(
  company: OnlineSelectorSyncCompany,
  opts?: OnlineBackupTickGateOpts
): OnlineBackupTickGate {
  const id = String((company as { id?: string } | null | undefined)?.id || "").trim();
  const allowWithoutFilesTick = opts?.attachmentEmbedMode === "local_device_bytes";
  if (!company || !id || !companyUsesOnlineSelectorSyncTicks(company) || isPocketBaseCompany(id, company)) {
    return {
      dataAllowed: true,
      filesAllowed: true,
      needDataTick: false,
      needFilesTick: false,
      dataMessage: null,
      filesMessage: null,
    };
  }
  if (isFirebaseLedgerDataSyncDisabled() || allowWithoutFilesTick) {
    return {
      dataAllowed: true,
      filesAllowed: true,
      needDataTick: false,
      needFilesTick: false,
      dataMessage: null,
      filesMessage: null,
    };
  }
  const entry = getFirebaseLedgerCompanySyncEntry(id);
  const filesAllowed = entry.attachments === true;
  return {
    dataAllowed: true,
    filesAllowed,
    needDataTick: false,
    needFilesTick: !filesAllowed,
    dataMessage: null,
    filesMessage: filesAllowed
      ? null
      : "Turn on Files for this company in Company Selector (Online tab), then Save — to download missing attachments into the backup. Local-only backup can still embed files already on this device without Files.",
  };
}
