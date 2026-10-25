"use client";

import {
  getLocalCompanyById,
  listLocalCompanies,
  localCompanyRowIsDeleted,
  removeLocalCompanyById,
  type LocalCompanyDoc,
} from "@/lib/localCompanyStore";
import { readCloudSyncConfigFromCompany } from "@/lib/localCloudSync/companyConfig";
import { postDriveJsonViaClient } from "@/lib/localCloudSync/driveApiClient";
import { logLocalCloudSync, warnLocalCloudSync } from "@/lib/localCloudSync/logger";
import { hasDriveApiAuthSession } from "@/lib/firebaseAuthForApi";
import { isDeviceLocalCompany } from "@/lib/companyStorageKind";
import { isLocalBackupRestoredCompanyRow } from "@/lib/localBackupRestoreCompany";
import { isWithinDriveRestorePurgeGrace } from "@/lib/driveRestoredLocalCompany";

export function isLocalCompanyDriveFolderOwner(
  reg: LocalCompanyDoc | Record<string, unknown>,
  firebaseUid: string | null | undefined
): boolean {
  if ((reg as { driveSharedJoin?: unknown }).driveSharedJoin === true) return false;
  const uid = String(firebaseUid || "").trim();
  const ownerId = String((reg as { ownerId?: unknown }).ownerId || "").trim();
  return !!uid && !!ownerId && uid === ownerId;
}

/** Drive sync ON + folder Drive par nahi — local SQLite se hatao (owner + shared join). Sync OFF par local rehni chahiye. */
export function shouldPurgeLocalCompanyWhenDriveFolderMissing(
  reg: LocalCompanyDoc | Record<string, unknown>,
  _firebaseUid: string | null | undefined
): boolean {
  const cfg = readCloudSyncConfigFromCompany(reg as LocalCompanyDoc);
  if (!cfg.cloudSyncEnabled || cfg.cloudSyncProvider !== "google_drive") return false;
  if (localCompanyRowIsDeleted(reg)) return false;
  return true;
}

/** Recycle bin permanent delete — pehle owner ka Drive folder, phir SQLite. */
export async function deleteDriveCompanyFolderIfOwner(
  reg: LocalCompanyDoc | Record<string, unknown>,
  firebaseUid: string | null | undefined
): Promise<boolean> {
  const cfg = readCloudSyncConfigFromCompany(reg as LocalCompanyDoc);
  if (!cfg.cloudSyncEnabled || cfg.cloudSyncProvider !== "google_drive") return false;
  if (!isLocalCompanyDriveFolderOwner(reg, firebaseUid)) return false;

  const companyId = String((reg as { id?: unknown }).id || "").trim();
  if (!companyId) return false;

  try {
    const res = await postDriveJsonViaClient<{ ok?: boolean; deleted?: boolean }>(
      "/api/local-cloud-sync/drive/delete-company-folder",
      {
        companyId,
        companyName: typeof (reg as { name?: unknown }).name === "string" ? (reg as { name: string }).name : undefined,
        driveSharedFolderId:
          typeof (reg as { cloudSyncDriveFolderId?: unknown }).cloudSyncDriveFolderId === "string"
            ? String((reg as { cloudSyncDriveFolderId: string }).cloudSyncDriveFolderId).trim()
            : undefined,
      }
    );
    logLocalCloudSync("drive company folder deleted", { companyId, deleted: res.deleted === true });
    return res.deleted === true;
  } catch (e) {
    warnLocalCloudSync("drive company folder delete failed (local delete continues)", {
      companyId,
      msg: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** SQLite + Drive folder (owner) — recycle bin permanent delete helper. */
export async function permanentDeleteLocalCompanyWithDriveCleanup(
  companyId: string,
  options?: { firebaseUid?: string | null }
): Promise<{ driveFolderDeleted: boolean }> {
  const cid = String(companyId || "").trim();
  if (!cid) return { driveFolderDeleted: false };

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  let driveFolderDeleted = false;
  if (reg) {
    driveFolderDeleted = await deleteDriveCompanyFolderIfOwner(reg, options?.firebaseUid ?? null);
  }
  await removeLocalCompanyById(cid, { firebaseUid: options?.firebaseUid ?? null });
  return { driveFolderDeleted };
}

export type DriveMissingPurgeResult = { companyId: string; companyName: string };

/** Drive sync ON + folder missing — device se local row hatao (owner ya shared join). */
export async function purgeLocalCompanyIfDriveFolderMissing(
  companyId: string,
  firebaseUid: string | null | undefined
): Promise<DriveMissingPurgeResult | null> {
  const cid = String(companyId || "").trim();
  if (!cid) return null;
  if (!hasDriveApiAuthSession()) return null;

  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!reg) return null;
  if (isDeviceLocalCompany(reg as Parameters<typeof isDeviceLocalCompany>[0])) return null;
  if (isLocalBackupRestoredCompanyRow(reg as Record<string, unknown>)) return null;
  if (isWithinDriveRestorePurgeGrace(reg as Record<string, unknown>)) return null;
  if (!shouldPurgeLocalCompanyWhenDriveFolderMissing(reg, firebaseUid)) return null;

  const folderId = String(reg.cloudSyncDriveFolderId ?? "").trim();
  const companyName = typeof reg.name === "string" ? reg.name : cid;

  try {
    const res = await postDriveJsonViaClient<{ accessible?: boolean }>(
      "/api/local-cloud-sync/drive/folder-accessible",
      {
        companyId: cid,
        companyName: typeof reg.name === "string" ? reg.name : undefined,
        driveFolderId: folderId || undefined,
      }
    );
    if (res.accessible === true) return null;

    await removeLocalCompanyById(cid, { firebaseUid: firebaseUid ?? null });
    logLocalCloudSync("purged local company — drive folder gone", { companyId: cid, folderId: folderId || null });
    return { companyId: cid, companyName };
  } catch (e) {
    // Offline / Drive not connected — local row mat todo.
    warnLocalCloudSync("drive folder check skipped", {
      companyId: cid,
      msg: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Background tick — Drive sync ON companies jinka Drive folder gayab ho. */
export async function purgeAllLocalCompaniesMissingOnDrive(
  firebaseUid: string | null | undefined
): Promise<DriveMissingPurgeResult[]> {
  if (!hasDriveApiAuthSession()) return [];
  const rows = await listLocalCompanies();
  const purged: DriveMissingPurgeResult[] = [];
  for (const row of rows) {
    const result = await purgeLocalCompanyIfDriveFolderMissing(row.id, firebaseUid);
    if (result) purged.push(result);
  }
  return purged;
}
