import type { GalleryDocLike } from "@/modules/ocr/galleryDocVisibility";

const LOCAL_FILE_PREFIX = "local:";

export type OfflinePendingUnassignedLike = GalleryDocLike & {
  url?: unknown;
  offlinePending?: unknown;
  uploadPending?: unknown;
};

/** A file kept only on this PC because it has not reached the server yet. */
export function isOfflinePendingUnassignedFile(file: OfflinePendingUnassignedLike): boolean {
  if (file.offlinePending === true || file.uploadPending === true) return true;
  const url = String(file.url || "").trim();
  return url.startsWith(LOCAL_FILE_PREFIX);
}

/** Pending rows whose ids are not already in the server/local listed set (avoid double counting). */
export function listLocalPendingNotOnServer<T extends { id?: unknown }>(
  pending: readonly T[],
  alreadyListedIds: Iterable<unknown>
): T[] {
  const seen = new Set<string>();
  for (const id of alreadyListedIds) {
    const key = String(id || "").trim();
    if (key) seen.add(key);
  }
  const out: T[] = [];
  const added = new Set<string>();
  for (const row of pending) {
    const id = String(row.id || "").trim();
    if (!id || seen.has(id) || added.has(id)) continue;
    added.add(id);
    out.push(row);
  }
  return out;
}

export function countLocalPendingNotOnServer<T extends { id?: unknown }>(
  pending: readonly T[],
  alreadyListedIds: Iterable<unknown>
): number {
  return listLocalPendingNotOnServer(pending, alreadyListedIds).length;
}

/** Badge number: server (or local fallback) plus this-PC pending files that are not on the server yet. */
export function combineGalleryBadgeCount(
  baseCount: number,
  pendingNotOnServer: number
): number {
  const base = Number.isFinite(baseCount) ? Math.max(0, Math.floor(baseCount)) : 0;
  const extra = Number.isFinite(pendingNotOnServer) ? Math.max(0, Math.floor(pendingNotOnServer)) : 0;
  return base + extra;
}

export function mergeOfflinePendingIntoUnassigned<T extends { id?: unknown }>(
  listed: readonly T[],
  pending: readonly T[]
): T[] {
  const extras = listLocalPendingNotOnServer(pending, listed.map((row) => row.id));
  if (extras.length === 0) return [...listed];
  return [...extras, ...listed];
}