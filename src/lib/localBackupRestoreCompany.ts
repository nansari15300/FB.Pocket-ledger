"use client";

import { deleteDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { isDeviceLocalCompany } from "@/lib/companyStorageKind";

/** Online / Firebase / Drive link fields — local backup-restore company row me nahi rehne chahiye. */
export const ONLINE_LINK_FIELDS_STRIPPED_FOR_LOCAL_BACKUP = [
  "authoritativeCompanyId",
  /** Online Manage Sharing list — local PL server users alag (`localCompanyUsers`). */
  "sharedWith",
  "cloudSyncLastSyncAt",
  "cloudSyncStatus",
  "cloudSyncLastError",
  "cloudSyncLastSyncSummary",
  "cloudSyncEnabled",
  "cloudSyncProvider",
  "cloudSyncDriveFolderId",
  "cloudSyncSharedEmails",
  "cloudSyncDriveShareUsers",
  "cloudSyncDriveDateFolderMode",
  "cloudSyncEncryptDrive",
  "cloudSyncEncryptDriveData",
  "cloudSyncEncryptDriveFiles",
  "cloudSyncDriveEncryptionSalt",
  "cloudSyncIntervalSec",
  "cloudSyncHistoricalBackfillDone",
  "plServerShared",
  "driveSharedJoin",
  "demoteReason",
  "demotedFromOnlineAt",
  "backupOfflineFiles",
  /** Restore-as-local: purani online company id / mirror stamp mat chipkao. */
  "firestoreCompanyId",
  "onlineCompanyId",
  "cloudCompanyId",
  /** Online share evidence — inhi emails se Firestore shared-company queries row ko dubara cloud bana deti hain. */
  "sharedWithEmails",
  "sharedWithEmailsLower",
  /** Admin recycle / delete markers: restored local company invisible ho jati thi (selector se drop). */
  "movedToAdminRecycleAt",
  "isDeleted",
  "deletedAt",
  /** Plan sync ka cloud company pointer — local row ki identity nahi. */
  "planSyncFirestoreCompanyId",
] as const;

/** Voucher / master rows: online-only sync stamps — local SQLite restore par hatao. */
const ONLINE_DOC_FIELDS_STRIPPED_ON_LOCAL_RESTORE = [
  "syncPendingFiles",
  "firestoreSyncPending",
  "cloudSyncPending",
  "authoritativeCompanyId",
  "crossCompanySourceRef",
  /** Firestore mirror stamp — restore hui doc ko cloud-backed maan kar attachment cloud se mat khojo. */
  "__mirrorBackedByFirestore",
] as const;

export function stripOnlineFieldsFromBackupLedgerDoc(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...row };
  for (const k of ONLINE_DOC_FIELDS_STRIPPED_ON_LOCAL_RESTORE) delete out[k];
  return out;
}

export function stripOnlineLinkFieldsFromCompanyRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const k of ONLINE_LINK_FIELDS_STRIPPED_FOR_LOCAL_BACKUP) delete out[k];
  return out;
}

export function isLocalBackupRestoredCompanyRow(
  row: Record<string, unknown> | null | undefined
): boolean {
  if (!row) return false;
  const ts = (row as { localRestoredFromBackupAt?: unknown }).localRestoredFromBackupAt;
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0;
}

/** SQLite registry row after `.plbp` restore → device-local only (Firestore auto-purge se bachao). */
export function finalizeLocalCompanyRowAfterBackupRestore(
  row: Record<string, unknown>,
  opts: {
    companyId: string;
    ownerUid: string;
    ownerEmail?: string | null;
    companyName: string;
  }
): Record<string, unknown> {
  const cleaned = stripOnlineLinkFieldsFromCompanyRow(row);
  return {
    ...cleaned,
    id: opts.companyId,
    ownerId: opts.ownerUid,
    ownerEmail: opts.ownerEmail ?? null,
    name: opts.companyName || String(cleaned.name || opts.companyId),
    storageOption: "local",
    syncedFromCloud: false,
    syncPolicy: "offline",
    plServerShared: false,
    localRestoredFromBackupAt: Date.now(),
  };
}

/** Post-restore reload: listRecovery ko turant clearCompanyId se bachane ke liye (sessionStorage, ~20s). */
export const LOCAL_BACKUP_RESTORE_SELECTION_GRACE_KEY = "pl-local-backup-restore-selection-grace";

/**
 * Online company → restore as local (replace current): Firestore root doc hatao taaki
 * permission/share purani cloud row se dubara mirror na ho. Subcollections Firebase par reh sakti hain.
 */
export async function tryDetachOnlineCompanyDocAfterLocalRestore(
  companyId: string,
  ownerUid: string
): Promise<{ detached: boolean; reason?: string }> {
  const cid = String(companyId || "").trim();
  const uid = String(ownerUid || "").trim();
  if (!cid || !uid) return { detached: false, reason: "missing_id" };
  try {
    const ref = doc(firestore, "companies", cid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { detached: false, reason: "no_firestore_doc" };
    const data = snap.data() as { ownerId?: unknown } | undefined;
    const docOwner = String(data?.ownerId || "").trim();
    if (docOwner && docOwner !== uid) return { detached: false, reason: "not_owner" };
    await deleteDoc(ref);
    return { detached: true };
  } catch (e) {
    return { detached: false, reason: e instanceof Error ? e.message : "delete_failed" };
  }
}

export function markLocalBackupRestoreSelectionGrace(companyId: string): void {
  if (typeof window === "undefined") return;
  const id = String(companyId || "").trim();
  if (!id) return;
  try {
    sessionStorage.setItem(
      LOCAL_BACKUP_RESTORE_SELECTION_GRACE_KEY,
      JSON.stringify({ companyId: id, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function readLocalBackupRestoreSelectionGrace(
  companyId: string,
  maxAgeMs = 20_000
): boolean {
  if (typeof window === "undefined") return false;
  const id = String(companyId || "").trim();
  if (!id) return false;
  try {
    const raw = sessionStorage.getItem(LOCAL_BACKUP_RESTORE_SELECTION_GRACE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { companyId?: string; at?: number };
    if (String(parsed.companyId || "").trim() !== id) return false;
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!at || Date.now() - at > maxAgeMs) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Backup restore: attachments vouchers se pehle disk pe likhe jate hain.
 * Us window me pending "orphan" sync files delete na kare — warna local: preview toot jata hai.
 */
const attachmentRestoreHoldCompanies = new Set<string>();
let attachmentRestoreHoldUntilMs = 0;

export function beginLocalAttachmentRestoreHold(companyId: string): void {
  const id = String(companyId || "").trim();
  if (!id) return;
  attachmentRestoreHoldCompanies.add(id);
  attachmentRestoreHoldUntilMs = Math.max(attachmentRestoreHoldUntilMs, Date.now() + 180_000);
}

export function endLocalAttachmentRestoreHold(companyId?: string): void {
  const id = String(companyId || "").trim();
  if (id) attachmentRestoreHoldCompanies.delete(id);
  else attachmentRestoreHoldCompanies.clear();
  if (attachmentRestoreHoldCompanies.size === 0) attachmentRestoreHoldUntilMs = 0;
}

export function isLocalAttachmentRestoreHoldActive(companyId?: string): boolean {
  if (typeof window === "undefined") return false;
  if (Date.now() > attachmentRestoreHoldUntilMs) {
    attachmentRestoreHoldCompanies.clear();
    attachmentRestoreHoldUntilMs = 0;
    return false;
  }
  const id = String(companyId || "").trim();
  if (!id) return attachmentRestoreHoldCompanies.size > 0;
  return attachmentRestoreHoldCompanies.has(id);
}

/** Owner ki local backup company — periodic Firestore ghost purge / online mirror stamp se protect. */
export function isProtectedOwnerLocalBackupCompany(
  row: Record<string, unknown> | null | undefined,
  user: { uid: string; email: string | null }
): boolean {
  if (!row) return false;
  const uid = String(user.uid || "").trim();
  if (!uid) return false;
  const ownerId = String(row.ownerId || "").trim();
  const ownerEmail = String(row.ownerEmail || "")
    .toLowerCase()
    .trim();
  const userEmail = String(user.email || "")
    .toLowerCase()
    .trim();
  const isOwner = (ownerId && ownerId === uid) || (!!ownerEmail && !!userEmail && ownerEmail === userEmail);
  if (!isOwner) return false;
  return isDeviceLocalCompany(row as Parameters<typeof isDeviceLocalCompany>[0]) || isLocalBackupRestoredCompanyRow(row);
}
