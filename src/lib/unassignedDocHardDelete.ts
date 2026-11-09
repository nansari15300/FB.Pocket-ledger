import { deleteFileFromStorageClient } from "@/lib/storageClient";
import { deleteCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { deleteDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { isPocketBaseCompany, isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";

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

/** True when the row is really gone from the Pocket Ledger Server (or never answers). */
async function serverRowStillExists(companyId: string, docId: string): Promise<boolean> {
  try {
    const { pbReadAppDoc } = await import("@/lib/pocketbaseData/pbSync");
    const r = await pbReadAppDoc(companyId, "unassigned_documents", docId);
    return r.exists === true;
  } catch {
    // Server unreachable: do not claim a failure the caller cannot fix.
    return false;
  }
}

/**
 * Delete the row straight through the server's data API (`delete` op). This is the same endpoint
 * the write gateway uses for a PocketBase company, so it works even when the id is not registered
 * as a PocketBase company id on this device (the gateway would otherwise fall through to a closed
 * Firestore project and silently do nothing).
 */
async function deleteUnassignedRowOnServer(companyId: string, docId: string): Promise<boolean> {
  try {
    const { pbBatchWrite } = await import("@/lib/pocketbaseData/pbSync");
    const [result] = await pbBatchWrite(companyId, [
      { coll: "unassigned_documents", id: docId, mode: "delete", data: {} },
    ]);
    if (!result) return !(await serverRowStillExists(companyId, docId));
    if (result.status === "rejected") {
      // Another device saved a newer copy of the row (server keeps `prevAt > at`). Retry with the
      // server's own timestamp so the delete is not older than the stored row.
      const at = Math.max(Number(result.updatedAtMs) || 0, Date.now()) + 1;
      await pbBatchWrite(companyId, [{ coll: "unassigned_documents", id: docId, mode: "delete", data: {}, at }]);
    }
    return !(await serverRowStillExists(companyId, docId));
  } catch (e) {
    console.warn("[hardDeleteUnassignedDoc] server delete error:", e);
    return false;
  }
}

/**
 * Hard deletes an unassigned document:
 * 1. Removes the stored binary file from storage (`pl_stored_files`)
 * 2. Deletes the server row (`delete` op -> `_pbHardDeleted` tombstone)
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

  // The Gallery list reads `companies/{fsId}/unassigned_documents`, and the server row id is the
  // same doc id. Delete against the company this device knows as PocketBase; fall back to
  // `authoritativeCompanyId` only when that one is the registered server company.
  const isPb = isPocketBaseCompany(companyId, company);
  const authId = String(company?.authoritativeCompanyId || "").trim();
  const serverCompanyId = isPb
    ? companyId
    : authId && isPocketBaseCompanyId(authId)
      ? authId
      : companyId;

  // 1. Local first: tombstone the row and persist to IndexedDB before touching the network.
  //    The list reads SQLite, so a refresh right after the click must already see it gone.
  try {
    await deleteCompanyDocFromBrowserDb(serverCompanyId, "unassigned_documents", docId, {
      force: true,
      notify: true,
    });
    await upsertCompanyDocInBrowserDb(
      serverCompanyId,
      "unassigned_documents",
      docId,
      { id: docId, isDeleted: true, [HARD_DELETED_FLAG]: true, deletedAtMs: Date.now() },
      { force: true, notify: false, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
    );
  } catch (sqliteErr) {
    console.warn("[hardDeleteUnassignedDoc] SQLite delete error:", sqliteErr);
  }
  // SQLite is in-memory until the 5s persist debounce; export now so an instant refresh
  // reloads a snapshot that no longer has the file.
  try {
    const { flushBrowserDbToIndexedDB } = await import("@/lib/localSqlite");
    await flushBrowserDbToIndexedDB();
  } catch (persistErr) {
    console.warn("[hardDeleteUnassignedDoc] immediate IDB persist failed:", persistErr);
  }

  // 2. Delete the server row.
  const serverDeleted = isPb || isPocketBaseCompanyId(serverCompanyId)
    ? await deleteUnassignedRowOnServer(serverCompanyId, docId)
    : await (async () => {
        try {
          // Firebase company: plain document delete.
          await deleteDoc(doc(firestore, `companies/${serverCompanyId}/unassigned_documents`, docId));
          return true;
        } catch (gatewayErr) {
          console.warn("[hardDeleteUnassignedDoc] Gateway delete error:", gatewayErr);
          return false;
        }
      })();
  if (!serverDeleted) {
    console.warn("[hardDeleteUnassignedDoc] server still has the row", { companyId, serverCompanyId, docId });
    return false;
  }

  // 3. Delete physical file from storage
  const filePath = docItem.path || docItem.url;
  if (filePath) {
    try {
      await deleteFileFromStorageClient(filePath);
    } catch (e) {
      console.warn("[hardDeleteUnassignedDoc] file storage delete failed:", e);
    }
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
