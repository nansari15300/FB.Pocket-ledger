"use client";

/**
 * Local + Drive companies: voucher/master soft-delete → SQLite bin + cloud_sync op;
 * permanent delete → SQLite row + Drive attachments + `plPermanentlyPurged` op (doosre devices).
 */

import { deleteDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { Timestamp, collection, doc, query, serverTimestamp, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, auth } from "@/lib/plClientSession";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isEmbeddedOfflinePreloadClient } from "@/lib/isEmbeddedOfflinePreloadClient";
import { isCloudBackedCompanyShape } from "@/lib/offlineFullWarmSync";
import type { Company } from "@/hooks/useCompany";
import {
  mirrorCollectionDocsToBrowserDbSilent,
  notifyBrowserDbCollectionUpdated,
} from "@/lib/localCompanyDocMirror";
import { decryptFirestoreCompanyDocIfNeeded, type ServerBackupCryptoContext } from "@/lib/serverBackupEncryption";
import { stampLocalMirrorBackedByFirestore } from "@/lib/localMirrorServerMeta";
import { remotePathFromDriveFileRef, isDriveFileRef } from "@/lib/legacyDriveFileRef";
import type { DeletedItem } from "@/components/recycle-bin/RecycleBinItem";
import {
  deleteCompanyDocFromBrowserDb,
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { coerceDeletedAtToDate } from "@/lib/coerceDeletedAt";
import { isLocalFileRef, removePendingFile } from "@/lib/localPendingFiles";
import { writeEntity, type WriteEntityResult } from "@/lib/writeGateway";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import { patchVoucherFields, softDeleteVoucherMoveToRecycleBin } from "@/lib/writeGateway/voucherActionsClient";
import { purgeInterCompanyCounterpartyPartyIfUnused } from "@/lib/interCompany/cleanupInterCompanyCounterpartyParty";
import { collectDriveAttachmentRefsFromDoc, deleteDriveAttachmentRef } from "@/lib/localCloudSync/driveAttachmentDelete";
import { shouldUseLocalCloudSync } from "@/lib/localCloudSync/companyConfig";
import { tryGetStoragePathFromFirebaseDownloadUrl } from "@/lib/firebaseStorageDownloadUrl";
import { getVoucherAttachmentUrlsForUi } from "@/lib/voucherAttachmentNormalize";

/** Drive/cloud_sync permanent delete marker — remote device SQLite row hard-remove kare. */
export const PL_PERMANENT_PURGE_KEY = "plPermanentlyPurged";

export function isPermanentPurgePayload(payload: Record<string, unknown> | null | undefined): boolean {
  return payload?.[PL_PERMANENT_PURGE_KEY] === true;
}

/** Soft-delete timestamp — APK/local JSON-safe `Timestamp.now()`, web `serverTimestamp()`. */
export function recycleBinDeletedAt(): InstanceType<typeof Timestamp> | ReturnType<typeof serverTimestamp> {
  return isLocalOnlyMode() ? Timestamp.now() : serverTimestamp();
}

async function resolveRecycleBinCompanyIds(companyId: string): Promise<{ localId: string; fsId: string; reg: LocalCompanyDoc | null }> {
  const localId = String(companyId || "").trim();
  const reg = localId ? await getLocalCompanyById(localId, { includeDeleted: true }) : null;
  const fsId =
    String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || localId).trim() ||
    localId;
  return { localId, fsId, reg };
}

/** Recycle bin list SQLite se bhi load karni hai (Firestore empty ho sakta hai local+Drive par). */
export async function companyUsesSqliteRecycleBinSource(companyId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  if (isLocalOnlyMode()) return true;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  if (String((reg as { storageOption?: string } | null)?.storageOption || "").toLowerCase() === "local") {
    return true;
  }
  // Static / EXE / APK: online company bhi SQLite mirror se bin — Firestore listener alone sync miss karta tha.
  if (isEmbeddedOfflinePreloadClient() && reg && isCloudBackedCompanyShape(reg as Company)) {
    return true;
  }
  return false;
}

/**
 * Embedded online company: Firestore soft-deleted rows → SQLite mirror taaki recycle bin web jaisa dikhe.
 */
export async function syncOnlineRecycleBinFromFirestoreToSqlite(
  companyId: string,
  collections: RecycleBinCollectionMeta[]
): Promise<void> {
  const { localId, fsId, reg } = await resolveRecycleBinCompanyIds(companyId);
  if (!localId || !fsId || !reg || !isEmbeddedOfflinePreloadClient()) return;
  if (!isCloudBackedCompanyShape(reg as Company)) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  const cryptoCtx: ServerBackupCryptoContext | null = reg.encryptServerBackupSalt
    ? { encryptServerBackupSalt: String(reg.encryptServerBackupSalt) }
    : null;

  for (const coll of collections) {
    try {
      const q = query(
        collection(firestore, `companies/${fsId}/${coll.path}`),
        where("isDeleted", "==", true)
      );
      const snap = await getDocs(q);
      const rows: Record<string, unknown>[] = [];
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (data.movedToAdminRecycleAt) continue;
        const raw = { ...data, id: docSnap.id } as Record<string, unknown> & { id: string };
        const decrypted = await decryptFirestoreCompanyDocIfNeeded(raw, cryptoCtx, localId);
        if (!decrypted || (decrypted as { isDeleted?: unknown }).isDeleted !== true) continue;
        rows.push(
          stampLocalMirrorBackedByFirestore({ ...(decrypted as Record<string, unknown>), id: docSnap.id })
        );
      }
      if (rows.length) {
        await mirrorCollectionDocsToBrowserDbSilent(localId, coll.path, rows, {
          cloudBackedOfflineCache: !isLocalOnlyMode(),
        });
        notifyBrowserDbCollectionUpdated(localId, coll.path, {
          immediate: true,
          source: "recycle_bin_firestore_pull",
        });
      }
    } catch {
      /* best effort per collection */
    }
  }
}

/** Live mirror: web se delete hote hi embedded SQLite bin refresh. */
export function subscribeOnlineRecycleBinFirestoreToSqliteMirror(
  companyId: string,
  collections: RecycleBinCollectionMeta[],
  onUpdated: () => void
): () => void {
  let cancelled = false;
  let unsubs: Array<() => void> = [];

  void (async () => {
    if (cancelled || !isEmbeddedOfflinePreloadClient()) return;
    if (!(await companyUsesSqliteRecycleBinSource(companyId))) return;
    const { localId, fsId, reg } = await resolveRecycleBinCompanyIds(companyId);
    if (cancelled || !localId || !fsId || !reg) return;

    const cryptoCtx: ServerBackupCryptoContext | null = reg.encryptServerBackupSalt
      ? { encryptServerBackupSalt: String(reg.encryptServerBackupSalt) }
      : null;

    unsubs = collections.map((coll) => {
      const q = query(
        collection(firestore, `companies/${fsId}/${coll.path}`),
        where("isDeleted", "==", true)
      );
      return onSnapshot(q, (snapshot) => {
        void (async () => {
          try {
            const rows: Record<string, unknown>[] = [];
            for (const docSnap of snapshot.docs) {
              const data = docSnap.data();
              if (data.movedToAdminRecycleAt) continue;
              const raw = { ...data, id: docSnap.id } as Record<string, unknown> & { id: string };
              const decrypted = await decryptFirestoreCompanyDocIfNeeded(raw, cryptoCtx, localId);
              if (!decrypted || (decrypted as { isDeleted?: unknown }).isDeleted !== true) continue;
              rows.push(
                stampLocalMirrorBackedByFirestore({ ...(decrypted as Record<string, unknown>), id: docSnap.id })
              );
            }
            if (rows.length) {
              await mirrorCollectionDocsToBrowserDbSilent(localId, coll.path, rows, {
                cloudBackedOfflineCache: !isLocalOnlyMode(),
              });
            }
            notifyBrowserDbCollectionUpdated(localId, coll.path, {
              immediate: true,
              source: "recycle_bin_firestore_mirror",
            });
          } catch {
            /* ignore */
          } finally {
            if (!cancelled) onUpdated();
          }
        })();
      });
    });
  })();

  return () => {
    cancelled = true;
    unsubs.forEach((u) => u());
    unsubs = [];
  };
}

/** SQLite bin rows — embedded online par pehle Firestore se mirror. */
export async function loadDeletedSubdocsForRecycleBin(
  companyId: string,
  collections: RecycleBinCollectionMeta[]
): Promise<DeletedItem[]> {
  if (await companyUsesSqliteRecycleBinSource(companyId)) {
    await syncOnlineRecycleBinFromFirestoreToSqlite(companyId, collections);
  }
  return listDeletedSubdocsFromSqlite(companyId, collections);
}

export type RecycleBinCollectionMeta = {
  path: string;
  nameField: string;
  type: string;
};

/** SQLite `company_docs` se `isDeleted` rows → recycle bin UI items. */
export async function listDeletedSubdocsFromSqlite(
  companyId: string,
  collections: RecycleBinCollectionMeta[]
): Promise<DeletedItem[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const out: DeletedItem[] = [];
  for (const coll of collections) {
    const rows = await listCompanyDocsFromBrowserDb(cid, coll.path, { includeSoftDeleted: true });
    for (const data of rows) {
      if (data?.isDeleted !== true) continue;
      if (data.movedToAdminRecycleAt) continue;
      const item: DeletedItem = {
        id: String(data.id || ""),
        name:
          String(data[coll.nameField] ?? "") ||
          String(data.title ?? "") ||
          (coll.path === "vouchers" ? `Voucher ${data.voucherNumber ?? ""}` : "Unnamed"),
        type: coll.type,
        deletedAt: coerceDeletedAtToDate(data.deletedAt) ?? undefined,
        collectionPath: coll.path,
        convertedToType: data.convertedToType as string | undefined,
        convertedToVoucherNumber: data.convertedToVoucherNumber as string | undefined,
      };
      if (coll.path === "vouchers") {
        item.voucherNumber = data.voucherNumber as string | undefined;
        const rawDate = data.date;
        item.date =
          rawDate && typeof rawDate === "object" && "toDate" in (rawDate as object) && typeof (rawDate as { toDate: () => Date }).toDate === "function"
            ? (rawDate as { toDate: () => Date }).toDate()
            : rawDate instanceof Date
              ? rawDate
              : rawDate
                ? new Date(rawDate as string | number)
                : null;
        item.voucherType = data.type as string | undefined;
        item.accountId = data.accountId as string | undefined;
        item.fromAccountId = data.fromAccountId as string | undefined;
        item.toAccountId = data.toAccountId as string | undefined;
        item.bankAccountId = data.bankAccountId as string | undefined;
        item.partyId = data.partyId as string | undefined;
        item.staffId = data.staffId as string | undefined;
        item.taxAccountId = data.taxAccountId as string | undefined;
        item.incomeAccountId = data.incomeAccountId as string | undefined;
        item.expenseAccountId = data.expenseAccountId as string | undefined;
        item.salesAccountId = data.salesAccountId as string | undefined;
        item.purchaseAccountId = data.purchaseAccountId as string | undefined;
        item.payeeName = data.payeeName as string | undefined;
        item.partyName = data.partyName as string | undefined;
        item.userId = data.userId as string | undefined;
        item.deletedBy = (data.deletedBy as string | undefined) || (data.userId as string | undefined);
      }
      if (item.id) out.push(item);
    }
  }
  return out;
}

/** Voucher / master / item → recycle bin (soft delete), sab devices par `isDeleted` sync. */
export async function softDeleteCompanySubdocToRecycleBin(
  companyId: string,
  collectionName: string,
  docId: string,
  deletedByUid: string
): Promise<WriteEntityResult> {
  const cid = String(companyId || "").trim();
  const id = String(docId || "").trim();
  if (!cid || !id) return { ok: false, error: "Missing companyId or docId" };
  if (collectionName === "vouchers") {
    await softDeleteVoucherMoveToRecycleBin(cid, id, deletedByUid);
    return { ok: true, docId: id };
  }
  {
    const { tryHardDeleteNeverSyncedDoc } = await import("@/lib/localOnlyHardDelete");
    const hd = await tryHardDeleteNeverSyncedDoc(cid, collectionName, id);
    if (hd === "cancelled") return { ok: false, error: "Delete cancelled" };
    if (hd === "hard") return { ok: true, docId: id };
  }
  const patch = {
    isDeleted: true,
    deletedAt: recycleBinDeletedAt(),
    deletedBy: deletedByUid || auth.currentUser?.uid || "",
  };
  const res = await writeEntity({
    companyId: cid,
    collectionName,
    docId: id,
    operation: "update",
    data: patch,
  });
  if (!res.ok) return res;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  const fsId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || cid).trim();
  void updateDoc(doc(firestore, `companies/${fsId}/${collectionName}`, id), patch).catch(() => {});
  const { scheduleSystemOpeningBalanceReconcileAfterMasterLifecycle } = await import(
    "@/lib/localCompanyDocMirror"
  );
  scheduleSystemOpeningBalanceReconcileAfterMasterLifecycle({
    companyId: cid,
    collectionName,
    docId: id,
  });
  return res;
}

/** Bin se restore — SQLite + Firestore (agar doc ho) + cloud_sync update. */
export async function restoreCompanySubdocFromRecycleBin(
  companyId: string,
  collectionPath: string,
  docId: string
): Promise<void> {
  const cid = String(companyId || "").trim();
  const id = String(docId || "").trim();
  if (!cid || !id) throw new Error("Missing company or document id");
  const patch = { isDeleted: false, deletedAt: null, deletedBy: null };
  if (collectionPath === "vouchers") {
    await patchVoucherFields(cid, id, patch);
  } else {
    const res = await writeEntity({
      companyId: cid,
      collectionName: collectionPath,
      docId: id,
      operation: "update",
      data: patch,
    });
    if (!res.ok) throw new Error("error" in res ? res.error : "restore failed");
  }
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  const fsId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || cid).trim();
  void updateDoc(doc(firestore, `companies/${fsId}/${collectionPath}`, id), patch).catch(() => {});
  const { scheduleSystemOpeningBalanceReconcileAfterMasterLifecycle } = await import(
    "@/lib/localCompanyDocMirror"
  );
  scheduleSystemOpeningBalanceReconcileAfterMasterLifecycle({
    companyId: cid,
    collectionName: collectionPath,
    docId: id,
  });
}

function collectFirebaseStoragePaths(data: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    paths.add(trimmed);
  };

  if (Array.isArray(data.filePaths)) {
    for (const p of data.filePaths) push(p);
  }
  push(data.storagePath);
  push(data.path);
  push(data.fileUrl);
  push(data.avatarUrl);
  push(data.logoUrl);

  if (Array.isArray(data.documentFileUrls)) {
    for (const u of data.documentFileUrls) push(u);
  }

  for (const u of getVoucherAttachmentUrlsForUi(data)) push(u);

  const uf = data.unassignedFile;
  if (uf && typeof uf === "object" && uf !== null) {
    push((uf as { url?: string }).url);
    push((uf as { path?: string }).path);
  }

  if (Array.isArray(data.files)) {
    for (const entry of data.files) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as { url?: string; storagePath?: string; path?: string };
      push(row.url);
      push(row.storagePath);
      push(row.path);
    }
  }

  return [...paths];
}

function resolveFirebaseStoragePath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return tryGetStoragePathFromFirebaseDownloadUrl(trimmed);
  }
  if (
    trimmed.startsWith("companies/") ||
    trimmed.startsWith("voucher-files/") ||
    trimmed.startsWith("pocket-ledger/")
  ) {
    return trimmed;
  }
  return tryGetStoragePathFromFirebaseDownloadUrl(trimmed) || trimmed;
}

/** Firebase Storage attachments (online companies) — ref-count aware when registry enabled. */
export async function deleteFirebaseStorageFilesForDoc(
  data: Record<string, unknown>,
  companyId?: string,
  opts?: { entityId?: string }
): Promise<void> {
  const urls: string[] = [];
  const directPaths: string[] = [];
  for (const filePath of collectFirebaseStoragePaths(data)) {
    const trimmed = filePath.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      urls.push(trimmed);
      continue;
    }
    const storagePath = resolveFirebaseStoragePath(trimmed);
    if (storagePath) directPaths.push(storagePath);
  }
  const cid = String(companyId || "").trim();
  const entityId = String(opts?.entityId || "").trim() || undefined;

  // HTTPS: registry unlink — refCount>0 / SQLite me reuse → Storage skip; sirf orphan delete.
  if (cid && urls.length > 0) {
    const { deleteFirebaseStorageUrlsWithRegistry } = await import("@/lib/companyAttachmentRegistry");
    await deleteFirebaseStorageUrlsWithRegistry(cid, urls, { traceEntityId: entityId });
  } else if (urls.length > 0) {
    // No company id — best-effort delete (no reuse scan).
    const { ref, deleteObject } = await import("@/lib/pocketbaseData/pbStorage");
    const { storage } = await import("@/lib/plClientSession");
    for (const filePath of urls) {
      const storagePath = resolveFirebaseStoragePath(filePath);
      if (!storagePath) continue;
      try {
        await deleteObject(ref(storage, storagePath));
      } catch {
        /* already gone */
      }
    }
  }

  // Non-URL legacy paths only — never re-force-delete HTTPS objects already handled above
  // (warna reused source file delete ho jati).
  if (directPaths.length === 0) return;
  const { ref, deleteObject } = await import("@/lib/pocketbaseData/pbStorage");
  const { storage } = await import("@/lib/plClientSession");
  const { tryGetStoragePathFromFirebaseDownloadUrl: pathFromHttps } = await import(
    "@/lib/firebaseStorageDownloadUrl"
  );
  const httpsPaths = new Set(
    urls
      .map((u) => resolveFirebaseStoragePath(u) || pathFromHttps(u) || "")
      .filter(Boolean)
  );
  for (const storagePath of [...new Set(directPaths)]) {
    if (httpsPaths.has(storagePath)) continue;
    if (cid) {
      try {
        const live = await countLiveStoragePathRefsInCompany(cid, storagePath);
        if (live > 0) continue;
      } catch {
        /* if scan fails, do not wipe shared bytes */
        continue;
      }
    }
    try {
      await deleteObject(ref(storage, storagePath));
    } catch {
      /* already gone */
    }
  }
}

/** Walk doc payload for `local:` / legacy `drive:` attachment refs. */
function collectAttachmentFileRefsFromValue(value: unknown, bucket: Set<string>): void {
  if (typeof value === "string") {
    if (isLocalFileRef(value) || isDriveFileRef(value)) bucket.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAttachmentFileRefsFromValue(v, bucket);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectAttachmentFileRefsFromValue(v, bucket);
    }
  }
}

/** Permanent delete — Drive attachment refs remote se hatao. */
export async function deleteDriveAttachmentRefsForDoc(companyId: string, data: Record<string, unknown>): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid || !(await shouldUseLocalCloudSync(cid))) return;
  const refs = collectDriveAttachmentRefsFromDoc(data);
  for (const ref of refs) {
    try {
      await deleteDriveAttachmentRef(cid, ref);
    } catch {
      /* best effort */
    }
  }
}

/** Pending `local:` attachment bytes — permanent delete par cleanup. */
export async function removeLocalPendingRefsFromDoc(data: Record<string, unknown>): Promise<void> {
  const refs = new Set<string>();
  collectAttachmentFileRefsFromValue(data, refs);
  for (const refStr of refs) {
    if (!isLocalFileRef(refStr)) continue;
    const localId = refStr.slice("local:".length).trim();
    if (!localId) continue;
    try {
      await removePendingFile(localId);
    } catch {
      /* ignore */
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then((v) => {
      if (timer) clearTimeout(timer);
      return v;
    }),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[permanentDelete] timed out after ${ms}ms:`, label);
        resolve(undefined);
      }, ms);
    }),
  ]);
}

/**
 * Bin se permanent delete — pehle local SQLite hatao (UI stuck na ho),
 * Storage/Drive/Firestore cleanup best-effort + timeout.
 */
export async function permanentDeleteCompanySubdocFromRecycleBin(
  companyId: string,
  collectionPath: string,
  docId: string
): Promise<void> {
  const cid = String(companyId || "").trim();
  const id = String(docId || "").trim();
  if (!cid || !id) throw new Error("Missing company or document id");

  // Delete dialog said 'only on this device' => local-only hard delete, no Firestore/Storage calls.
  {
    const { tryLocalOnlyHardDeleteFromDialogIntent } = await import("@/lib/localOnlyHardDelete");
    if (await tryLocalOnlyHardDeleteFromDialogIntent(cid, collectionPath, id)) return;
  }

  // Pending outbox upsert/flush pehle hatao — warna permanent delete ke baad soft-deleted
  // voucher recycle bin me wapas aa jata hai (INTENT flush / pull race).
  const { removeOutboxRowsForCompanyDoc } = await import("@/lib/localVoucherOutbox");
  await removeOutboxRowsForCompanyDoc(cid, collectionPath, id);

  const localRow = (await getCompanyDocFromBrowserDb(cid, collectionPath, id)) as Record<string, unknown> | null;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  const fsId = String((reg as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || cid).trim();
  let data: Record<string, unknown> = localRow ? { ...localRow } : {};
  try {
    const snap = await withTimeout(
      getDoc(doc(firestore, `companies/${fsId}/${collectionPath}`, id)),
      8000,
      `getDoc ${collectionPath}/${id}`
    );
    if (snap?.exists()) data = { ...data, ...(snap.data() as Record<string, unknown>) };
  } catch {
    /* optional */
  }

  // Critical: pehle local row hatao — Storage list/hang pe dialog stuck na rahe.
  await deleteCompanyDocFromBrowserDb(cid, collectionPath, id, { force: true, notify: true });
  await removeOutboxRowsForCompanyDoc(cid, collectionPath, id);

  await enqueueCompanyDocOutbox(cid, collectionPath, "delete", id, {
    ...data,
    id,
    [PL_PERMANENT_PURGE_KEY]: true,
    isDeleted: true,
  }).catch(() => {});

  // Best-effort bytes cleanup — object-not-found / permission / hang ignore
  await withTimeout(
    (async () => {
      try {
        await removeLocalPendingRefsFromDoc(data);
      } catch (e) {
        console.warn("[permanentDelete] local pending refs cleanup failed", id, e);
      }
      try {
        await deleteDriveAttachmentRefsForDoc(cid, data);
      } catch (e) {
        console.warn("[permanentDelete] Drive attachment cleanup failed", id, e);
      }
      try {
        await deleteFirebaseStorageFilesForDoc(data, cid, { entityId: id });
      } catch (e) {
        console.warn("[permanentDelete] Firebase Storage file cleanup failed", id, e);
      }
      if (collectionPath === "vouchers") {
        try {
          const vt = String(data.type || "").trim();
          await deleteVoucherFirebaseStorageObjectsReuseSafe({
            companyId: cid,
            voucherId: id,
            voucherType: vt || undefined,
          });
        } catch (e) {
          console.warn("[permanentDelete] voucher storage folder sweep failed", id, e);
        }
      }
    })(),
    15000,
    `attachment cleanup ${collectionPath}/${id}`
  );

  // Again: wipe upserts from cleanup side-effects
  await removeOutboxRowsForCompanyDoc(cid, collectionPath, id);

  try {
    await withTimeout(
      deleteDoc(doc(firestore, `companies/${fsId}/${collectionPath}`, id)),
      10000,
      `deleteDoc ${collectionPath}/${id}`
    );
  } catch (e) {
    console.warn("[permanentDelete] Firestore deleteDoc failed", collectionPath, id, e);
  }

  if (collectionPath === "vouchers" && String(data.type || "") === "inter_company") {
    const partyId = String(data.interCompanyCounterpartyPartyId || "").trim();
    if (partyId) {
      try {
        await withTimeout(
          purgeInterCompanyCounterpartyPartyIfUnused({
            companyId: cid,
            partyId,
          }),
          8000,
          `IC party purge ${partyId}`
        );
      } catch (err) {
        console.warn("[IC] counterparty party cleanup after permanent delete:", err);
      }
    }
  }
}

/** Voucher-folder orphan sweep with live reuse check (shared bytes mat mitao). */
async function deleteVoucherFirebaseStorageObjectsReuseSafe(input: {
  companyId: string;
  voucherId: string;
  voucherType?: string;
}): Promise<number> {
  const cid = String(input.companyId || "").trim();
  const vid = String(input.voucherId || "").trim();
  if (!cid || !vid) return 0;
  const { buildVoucherStorageScanPrefixes } = await import("@/lib/companyStorageWipePrefixes");
  const { ref, list, deleteObject } = await import("@/lib/pocketbaseData/pbStorage");
  const { storage } = await import("@/lib/plClientSession");
  const typeHint = String(input.voucherType || "").trim();
  // Missing type → sirf us voucherId ke orphans dhoondo, saare type folders me — bilkul journal pe force default mat.
  const types = typeHint
    ? [typeHint]
    : [
        "sale",
        "purchase",
        "journal",
        "payment_in",
        "payment_out",
        "contra",
        "direct_income",
        "direct_expense",
        "note",
        "adjustment",
      ];
  const prefixes = [
    ...new Set(types.flatMap((voucherType) => buildVoucherStorageScanPrefixes({ companyId: cid, voucherType }))),
  ];
  const needle = `${vid}_`;
  let deleted = 0;

  async function walk(r: ReturnType<typeof ref>): Promise<void> {
    let pageToken: string | undefined;
    do {
      const page = await list(r, {
        maxResults: 200,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of page.items) {
        const leaf = item.fullPath.split("/").pop() || "";
        if (!leaf.startsWith(needle)) continue;
        try {
          const live = await countLiveStoragePathRefsInCompany(cid, item.fullPath);
          if (live > 0) continue;
          await deleteObject(item);
          deleted += 1;
        } catch {
          /* already gone / permission */
        }
      }
      for (const prefix of page.prefixes) {
        await walk(prefix);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  for (const prefix of prefixes) {
    try {
      await walk(ref(storage, prefix));
    } catch (e) {
      console.warn("[deleteVoucherStorage] reuse-safe prefix skipped", prefix, e);
    }
  }
  return deleted;
}

async function countLiveStoragePathRefsInCompany(companyId: string, storagePath: string): Promise<number> {
  const path = String(storagePath || "").trim();
  if (!path) return 0;
  try {
    const { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } = await import("@/lib/firestoreToLocalCompanyPull");
    const { listCompanyDocsFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
    const { tryGetStoragePathFromFirebaseDownloadUrl } = await import(
      "@/lib/firebaseStorageDownloadUrl"
    );
    let n = 0;
    const hasPath = (value: unknown): boolean => {
      if (typeof value === "string") {
        const s = value.trim();
        if (!s) return false;
        if (s === path || s.includes(path)) return true;
        const p = tryGetStoragePathFromFirebaseDownloadUrl(s);
        return Boolean(p && p === path);
      }
      if (Array.isArray(value)) return value.some(hasPath);
      if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).some(hasPath);
      }
      return false;
    };
    for (const coll of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
      const rows = await listCompanyDocsFromBrowserDb(companyId, coll);
      for (const row of rows) {
        if ((row as { isDeleted?: unknown }).isDeleted === true) continue;
        if (
          hasPath(row.fileUrls) ||
          hasPath(row.documentFileUrls) ||
          hasPath(row.fileUrl) ||
          hasPath(row.logoUrl) ||
          hasPath(row.avatarUrl) ||
          hasPath(row.unassignedFile)
        ) {
          n += 1;
        }
      }
    }
    return n;
  } catch {
    return 0;
  }
}
