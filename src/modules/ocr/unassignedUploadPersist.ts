/** Pure persist policy for unassigned / file-add uploads. Safe for selftests. */

export type UnassignedUploadPersist =
  | { action: "store"; url: string; path: string }
  | { action: "offline_pending" };

/**
 * After a Pocket Ledger Server unassigned upload, persist only a `pbatt:` ref.
 * Never store an absolute PocketBase file URL (including `http://127.0.0.1:8090/api/files/...`)
 * from the `uploadFileClient` / `getDownloadURL` fallback — that URL opens only on the PC
 * that stored a loopback host.
 */
export function decideUnassignedUploadPersist(
  serverUpload: { url?: string; path?: string } | null | undefined,
): UnassignedUploadPersist {
  const url = String(serverUpload?.url || "").trim();
  const path = String(serverUpload?.path || "").trim();
  if (url.startsWith("pbatt:")) return { action: "store", url, path: path || url };
  return { action: "offline_pending" };
}
