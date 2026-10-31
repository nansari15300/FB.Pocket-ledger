"use client";

import { collection, limit, query, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getDriveApiUser } from "@/lib/firebaseAuthForApi";
import { postDriveJsonViaClient } from "@/lib/localCloudSync/driveApiClient";
import { getLocalCompanyById, listLocalCompanies, upsertLocalCompany } from "@/lib/localCompanyStore";
import { runLocalCloudSyncCycle, scheduleDriveAttachmentSyncAfterRestore } from "@/lib/localCloudSync/engine";
import { mergeRemoteCloudSyncManifestIntoLocalCompany } from "@/lib/localCloudSync/companyConfig";
import {
  CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG,
  isCloudSyncEncryptionReady,
} from "@/lib/localCloudSync/driveEncryption";
import { setCloudSyncCursor } from "@/lib/localCloudSync/queue";
import type { CloudSyncManifest, DriveSharedCompanyListItem } from "@/lib/localCloudSync/types";
import { markDriveRestoreSelectionGrace } from "@/lib/driveRestoredLocalCompany";
import { downloadAndMergeOpeningUsersFromDrive } from "@/lib/localCloudSync/openingDriveSnapshot";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

export type DriveSharedCompanyInvite = DriveSharedCompanyListItem;

export type DriveSharedJoinCompleteSource = "select" | "join" | "resync";

/** Owner uid lookup — selector me "Shared by" email ke saath. */
async function resolveOwnerUidByEmail(email: string): Promise<string | null> {
  const em = String(email || "").trim().toLowerCase();
  if (!em) return null;
  try {
    const snap = await getDocs(query(collection(firestore, "users"), where("email", "==", em), limit(1)));
    const d = snap.docs[0];
    if (!d) return null;
    const data = d.data() as { uid?: string };
    return String(data.uid || d.id || "").trim() || null;
  } catch {
    return null;
  }
}

/** Drive par shared company folders — joined rows UI me "Connected" dikhane ke liye filter mat karo. */
export async function listDriveSharedLocalCompanyInvites(): Promise<DriveSharedCompanyInvite[]> {
  if (isLocalGoogleDriveSyncDisabled()) return [];
  const res = await postDriveJsonViaClient<{ companies?: DriveSharedCompanyInvite[] }>(
    "/api/local-cloud-sync/drive/list-shared-companies",
    {}
  );
  return res.companies ?? [];
}

type DriveJoinLocalRow = {
  id?: string;
  storageOption?: unknown;
  syncPolicy?: unknown;
  syncedFromCloud?: unknown;
  cloudSyncEnabled?: unknown;
  cloudSyncProvider?: unknown;
  cloudSyncDriveFolderId?: unknown;
  driveSharedJoin?: unknown;
  isDeleted?: unknown;
};

/** Firestore online mirror row — id suffix match par galat "Connected" mat dikhao. */
export function isLocalDriveRegistryJoinRow(row: DriveJoinLocalRow): boolean {
  if (row.isDeleted === true) return false;
  if (row.syncedFromCloud === true) return false;
  const so = String(row.storageOption ?? "").toLowerCase().trim();
  if (so === "firebase" || so === "drive") return false;
  if (String(row.syncPolicy ?? "").toLowerCase().trim() === "online") return false;
  const folderId = String(row.cloudSyncDriveFolderId ?? "").trim();
  if (folderId) return true;
  if (so === "local" && row.cloudSyncEnabled === true && String(row.cloudSyncProvider ?? "").toLowerCase() === "google_drive") {
    return true;
  }
  return false;
}

function driveInviteMatchesLocalRow(
  invite: DriveSharedCompanyInvite,
  row: DriveJoinLocalRow
): boolean {
  const inviteId = String(invite.companyId || "").trim();
  const folderId = String(invite.driveFolderId || "").trim();
  const localId = String(row.id || "").trim();
  const localFolder = String(row.cloudSyncDriveFolderId ?? "").trim();
  if (folderId && localFolder && localFolder === folderId) return true;
  if (localId && inviteId && (localId === inviteId || localId.endsWith(`_${inviteId}`))) return true;
  return false;
}

/** Local registry me is Drive folder / company ke liye device-local join row. */
export function findJoinedLocalCompanyForDriveInvite<T extends DriveJoinLocalRow>(
  invite: DriveSharedCompanyInvite,
  locals: T[]
): T | null {
  for (const row of locals) {
    if (!isLocalDriveRegistryJoinRow(row)) continue;
    if (driveInviteMatchesLocalRow(invite, row)) return row;
  }
  return null;
}

/** Local registry me ye shared folder pehle se join ho chuka? (Drive folder id primary match). */
export function isDriveSharedInviteAlreadyJoined(
  invite: DriveSharedCompanyInvite,
  locals: DriveJoinLocalRow[]
): boolean {
  return findJoinedLocalCompanyForDriveInvite(invite, locals) != null;
}

/** Join se pehle manifest — encryption salt / flags pata karne ke liye. */
export async function peekDriveSharedCompanyManifest(
  invite: DriveSharedCompanyInvite
): Promise<CloudSyncManifest> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  return postDriveJsonViaClient<CloudSyncManifest>("/api/local-cloud-sync/drive/manifest", {
    companyId: invite.companyId,
    companyName: invite.companyName,
    driveSharedFolderId: invite.driveFolderId,
    action: "get",
  });
}

export type JoinDriveSharedLocalCompanyOptions = {
  /** Owner wala Company Profile password — Drive encrypt decrypt ke liye. */
  companyPassword?: string;
};

/** Join: local registry row + bootstrap sync (download ops from Drive folder). */
export async function joinDriveSharedLocalCompany(
  invite: DriveSharedCompanyInvite,
  options?: JoinDriveSharedLocalCompanyOptions
): Promise<string> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  const firebaseUser = await getDriveApiUser();

  let manifest: CloudSyncManifest = { latestOp: 0 };
  try {
    manifest = await peekDriveSharedCompanyManifest(invite);
  } catch {
    /* manifest optional — sync cycle dubara read karega */
  }

  const canonicalCompanyId = String(manifest.companyId || invite.companyId).trim() || invite.companyId;
  const locals = await listLocalCompanies({ includeDeleted: true });
  if (isDriveSharedInviteAlreadyJoined(invite, locals)) {
    throw new Error("This company is already on your device.");
  }

  const existing = await getLocalCompanyById(canonicalCompanyId, { includeDeleted: true });
  if (existing && existing.isDeleted !== true) {
    throw new Error("This company is already on your device.");
  }

  const isOwnedOnDrive = invite.isOwnedOnDrive === true;
  const ownerUid = isOwnedOnDrive
    ? firebaseUser.uid
    : (await resolveOwnerUidByEmail(invite.sharedByEmail)) || invite.sharedByEmail;
  const ownerEmail = isOwnedOnDrive
    ? String(firebaseUser.email || invite.sharedByEmail || "")
        .trim()
        .toLowerCase()
    : invite.sharedByEmail;
  const companyPassword = String(options?.companyPassword ?? "").trim();
  const encryptData = manifest.cloudSyncEncryptDriveData === true;
  const encryptFiles = manifest.cloudSyncEncryptDriveFiles === true;
  const encryptAny = encryptData || encryptFiles;

  if (encryptAny && !companyPassword) {
    throw new Error(
      `${CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG} Enter the owner's company password below, then Join again.`
    );
  }

  await upsertLocalCompany({
    id: canonicalCompanyId,
    name: invite.companyName,
    ownerId: ownerUid,
    ownerEmail,
    storageOption: "local",
    // Owner restore: khud ka My Drive folder — shared-join flag mat lagao (upload/sync owner path).
    driveSharedJoin: isOwnedOnDrive ? false : true,
    sharedByEmail: isOwnedOnDrive ? null : invite.sharedByEmail,
    cloudSyncEnabled: true,
    cloudSyncProvider: "google_drive",
    cloudSyncDriveFolderId: invite.driveFolderId,
    cloudSyncStatus: "syncing",
    cloudSyncLastError: null,
    cloudSyncEncryptDrive: encryptAny,
    cloudSyncEncryptDriveData: encryptData,
    cloudSyncEncryptDriveFiles: encryptFiles,
    cloudSyncDriveEncryptionSalt: manifest.driveEncryptionSalt ?? null,
    ...(manifest.cloudSyncDriveDateFolderMode
      ? { cloudSyncDriveDateFolderMode: manifest.cloudSyncDriveDateFolderMode }
      : {}),
    ...(companyPassword ? { password: companyPassword } : {}),
    localRestoredFromDriveAt: Date.now(),
    updatedAt: Date.now(),
  });

  await mergeRemoteCloudSyncManifestIntoLocalCompany(canonicalCompanyId, manifest);

  if (encryptAny && !(await isCloudSyncEncryptionReady(canonicalCompanyId))) {
    throw new Error(
      `${CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG} Check the company password and try Join again.`
    );
  }

  await setCloudSyncCursor(canonicalCompanyId, {
    lastSyncedOp: 0,
    lastSyncAt: null,
    syncStatus: "syncing",
    lastError: null,
  });

  const res = await runLocalCloudSyncCycle(canonicalCompanyId, { force: true, ledgerOnly: true });
  if (!res.ok) {
    throw new Error(res.error || "Sync failed after join");
  }
  scheduleDriveAttachmentSyncAfterRestore(canonicalCompanyId);
  markDriveRestoreSelectionGrace(canonicalCompanyId);
  return canonicalCompanyId;
}

/** Pehle se device-local join ho to dubara Drive se pull — purge ke baad re-restore. */
export async function resyncDriveLocalCompanyFromInvite(
  invite: DriveSharedCompanyInvite,
  options?: JoinDriveSharedLocalCompanyOptions
): Promise<string> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  const locals = await listLocalCompanies({ includeDeleted: true });
  const joined = findJoinedLocalCompanyForDriveInvite(invite, locals);
  if (!joined?.id) {
    return joinDriveSharedLocalCompany(invite, options);
  }

  const companyId = String(joined.id).trim();
  let manifest: CloudSyncManifest = { latestOp: 0 };
  try {
    manifest = await peekDriveSharedCompanyManifest(invite);
  } catch {
    /* manifest optional */
  }

  const companyPassword = String(options?.companyPassword ?? "").trim();
  const encryptData = manifest.cloudSyncEncryptDriveData === true;
  const encryptFiles = manifest.cloudSyncEncryptDriveFiles === true;
  const encryptAny = encryptData || encryptFiles;
  if (encryptAny && !companyPassword) {
    throw new Error(
      `${CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG} Enter the company password below, then Sync from Drive again.`
    );
  }

  await upsertLocalCompany({
    ...joined,
    id: companyId,
    name: invite.companyName,
    storageOption: "local",
    driveSharedJoin: invite.isOwnedOnDrive === true ? false : true,
    cloudSyncEnabled: true,
    cloudSyncProvider: "google_drive",
    cloudSyncDriveFolderId: invite.driveFolderId,
    cloudSyncStatus: "syncing",
    cloudSyncLastError: null,
    cloudSyncEncryptDrive: encryptAny,
    cloudSyncEncryptDriveData: encryptData,
    cloudSyncEncryptDriveFiles: encryptFiles,
    cloudSyncDriveEncryptionSalt: manifest.driveEncryptionSalt ?? null,
    ...(manifest.cloudSyncDriveDateFolderMode
      ? { cloudSyncDriveDateFolderMode: manifest.cloudSyncDriveDateFolderMode }
      : {}),
    ...(companyPassword ? { password: companyPassword } : {}),
    localRestoredFromDriveAt: Date.now(),
    updatedAt: Date.now(),
  });

  await mergeRemoteCloudSyncManifestIntoLocalCompany(companyId, manifest);

  if (encryptAny && !(await isCloudSyncEncryptionReady(companyId))) {
    throw new Error(
      `${CLOUD_SYNC_ENCRYPTION_KEY_REQUIRED_MSG} Check the company password and try Sync from Drive again.`
    );
  }

  await setCloudSyncCursor(companyId, {
    lastSyncedOp: 0,
    lastSyncAt: null,
    syncStatus: "syncing",
    lastError: null,
  });

  const res = await runLocalCloudSyncCycle(companyId, { force: true, ledgerOnly: true });
  if (!res.ok) {
    throw new Error(res.error || "Sync from Drive failed");
  }
  scheduleDriveAttachmentSyncAfterRestore(companyId);
  markDriveRestoreSelectionGrace(companyId);
  return companyId;
}

/** Connected Drive row — Select se pehle `opening/users.json` se login users device par lao. */
export async function preloadDriveSharedCompanyLoginFromInvite(
  invite: DriveSharedCompanyInvite
): Promise<string> {
  if (isLocalGoogleDriveSyncDisabled()) throw new Error(LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE);
  const locals = await listLocalCompanies({ includeDeleted: true });
  const joined = findJoinedLocalCompanyForDriveInvite(invite, locals);
  if (!joined?.id) {
    throw new Error("Company not on this device yet. Use Join or Sync from Drive first.");
  }
  const companyId = String(joined.id).trim();
  const syncRef = {
    companyId,
    companyName: invite.companyName,
    driveSharedFolderId: invite.driveFolderId,
  };
  try {
    await downloadAndMergeOpeningUsersFromDrive(companyId, syncRef);
  } catch {
    /* login users optional — company password / admin fallback ho sakta hai */
  }
  return companyId;
}
