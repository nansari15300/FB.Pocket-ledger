import { deleteFileFromStorageClient } from "@/lib/storageClient";
import { deleteCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { deleteDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";

export type UnassignedDocToDelete = {
  id: string;
  url?: string;
  path?: string;
  size?: number;
};

/**
 * Local tombstone written after a hard delete. Without it the next server pull re-inserts the
 * row into the SQLite mirror (the mirror row was removed, so the pull sees a "new" doc and the
 * list shows the file again after a refresh). `_pbHardDeleted` is the same marker the server uses
 * for a deleteDoc tombstone; the read seam and the list filters both skip it.
 */
const HARD_DELETED_FLAG = "_pbHardDeleted";

/**
 * Hard deletes an unassigned document:
 * 1. Removes the stored binary file from storage (`pl_stored_files`)
 * 2. Deletes the server row (PocketBase = `delete` op; Firestore = plain delete)
 * 3. Removes the SQLite mirror row and leaves a hard-deleted tombstone so a pull cannot
 *    bring the file back
 *
 * Returns `true` only when the server really dropped the row — a silent failure used to leave
 * it on the server, so a refresh showed the file again.
 */
export async function hardDeleteUnassignedDoc(
  companyId: string,
  docItem: UnassignedDocToDelete,
  company?: { authoritativeCompanyId?: string } | null
): Promise<boolean> {
  const docId = String(docItem.id || "").trim();
  if (!companyId || !docId) return false;

  const fsId = String(company?.authoritativeCompanyId || companyId).trim() || companyId;

  // 1. Delete physical file from storage
  const filePath = docItem.path || docItem.url;
  if (filePath) {
    try {
      await deleteFileFromStorageClient(filePath);
    } catch (e) {
      console.warn("[hardDeleteUnassignedDoc] file storage delete failed:", e);
    }
  }

  // 2. Delete the document. For a Pocket Ledger Server company the write gateway sends the
  //    server's `delete` op (row tombstoned with `_pbHardDeleted`); a raw collection DELETE was
  //    silently rejected because collection writes only go through `/api/pl/data/batch`.
  try {
    await deleteDoc(doc(firestore, `companies/${fsId}/unassigned_documents`, docId));
  } catch (serverErr) {
    console.warn("[hardDeleteUnassignedDoc] server delete error:", serverErr);
    return false;
  }

  // 3. Mirror row gone + local hard-deleted tombstone (keeps the next pull from re-inserting it).
  try {
    await deleteCompanyDocFromBrowserDb(companyId, "unassigned_documents", docId, {
      force: true,
      notify: true,
    });
    if (isPocketBaseCompany(companyId, company)) {
      await upsertCompanyDocInBrowserDb(
        companyId,
        "unassigned_documents",
        docId,
        { id: docId, isDeleted: true, [HARD_DELETED_FLAG]: true, deletedAtMs: Date.now() },
        { force: true, notify: false, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
      );
    }
  } catch (sqliteErr) {
    console.warn("[hardDeleteUnassignedDoc] SQLite delete error:", sqliteErr);
  }

  return true;
}

/**
 * Hard deletes multiple unassigned documents in batch
 */
export async function hardDeleteUnassignedDocsBatch(
  companyId: string,
  docs: UnassignedDocToDelete[],
  company?: { authoritativeCompanyId?: string } | null,
  onProgress?: (completed: number, total: number) => void
): Promise<{ successCount: number; failCount: number }> {
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < docs.length; i++) {
    const item = docs[i];
    try {
      const ok = await hardDeleteUnassignedDoc(companyId, item, company);
      if (ok) successCount++;
      else failCount++;
    } catch {
      failCount++;
    }
    onProgress?.(i + 1, docs.length);
  }

  return { successCount, failCount };
}
