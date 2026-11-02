import { isLocalFileRef } from "@/lib/localPendingFiles";
import { canResolveLocalFileRefsOnThisDevice } from "@/lib/canResolveLocalFileRefs";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import { looksLikeFirebaseStorageDownloadUrl } from "@/lib/storageGetBlobFromDownloadUrl";

/**
 * Party / staff / bank / tax list avatar + hover portal:
 * kabhi-kabhi Firestore/SQLite me `fileUrl` string `"null"` / khali save ho jata — bina file ke bhi PDF preview spinner.
 * Ye helper se sirf usable URL par hover + `ResolvedEntityAvatar` src lagao.
 */
export function trimEntityFileUrlForPreview(raw: string | null | undefined): string | null {
  const u = String(raw ?? "").trim();
  if (!u) return null;
  const low = u.toLowerCase();
  if (low === "null" || low === "undefined" || low === "none" || low === "n/a") return null;
  // Hosted web cannot resolve EXE IndexedDB `local:` — hide instead of broken FILE tile.
  if (!canResolveLocalFileRefsOnThisDevice() && isLocalFileRef(u)) return null;
  // Pocket Ledger Server login: leftover Firebase Storage URLs quota 402 dete hain — img src mat lagao.
  if (isPocketBaseOnlyAppSession() && looksLikeFirebaseStorageDownloadUrl(u)) return null;
  return u;
}
