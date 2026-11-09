"use client";

/**
 * Drop-in for `firebase/storage` (ref / uploadBytes / getDownloadURL / deleteObject / getBlob /
 * getMetadata / list) — Pocket Ledger Server only.
 *
 * Files live in `pl_stored_files` on the server, one row per storage path, with a public file URL.
 * Firebase Storage is NOT used: an https Firebase signed URL painted in a desktop tab but stayed
 * blank inside the Capacitor WebView, and keeping two file stores caused PC/APK preview splits.
 */

/** Minimal shape of a storage reference — Pocket Ledger Server only, no Firebase Storage SDK. */
export type StorageReference = {
  fullPath: string;
  name: string;
  bucket: string;
};
import { getValidPocketBaseAuth, pbFormRequest, pbRequest, pbQuote } from "@/lib/pocketbaseData/pbClient";

type PbRef = StorageReference & {
  __pbStorage: true;
  recordId?: string;
  toString(): string;
};

const COLL = "pl_stored_files";

function isPbRef(r: unknown): r is PbRef {
  return !!r && typeof r === "object" && (r as { __pbStorage?: unknown }).__pbStorage === true;
}

function normalizePath(p: string): { path: string; recordId?: string } {
  const s = String(p || "").trim();
  // a stored-file URL (…/api/files/pl_stored_files/{id}/{name})
  const m = s.match(/\/api\/files\/pl_stored_files\/([A-Za-z0-9]+)\//);
  if (m) return { path: "", recordId: m[1] };
  // Firebase download URL / gs:// -> object path
  const fb = s.match(/\/o\/([^?]+)/);
  if (/^https?:\/\//i.test(s) && fb) {
    try {
      return { path: decodeURIComponent(fb[1]) };
    } catch {
      return { path: fb[1] };
    }
  }
  const gs = s.match(/^gs:\/\/[^/]+\/(.+)$/);
  if (gs) return { path: gs[1] };
  return { path: s.replace(/^\/+/, "").replace(/\/+$/, "") };
}

function makePbRef(path: string, recordId?: string): PbRef {
  const full = path;
  const name = full.split("/").pop() || "";
  return { __pbStorage: true, fullPath: full, name, bucket: "pocketledger-server", recordId, toString: () => `pb://${full}` };
}

export function ref(storage: unknown, path?: string): StorageReference {
  void storage;
  const n = normalizePath(path || "");
  return makePbRef(n.path, n.recordId) as unknown as StorageReference;
}

function storageError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, name: "FirebaseError" });
}

type StoredRow = { id: string; path: string; file: string; mime?: string; size?: number; created?: string; updated?: string };

async function findRow(r: PbRef): Promise<StoredRow | null> {
  const filter = r.recordId ? `id = ${pbQuote(r.recordId)}` : `path = ${pbQuote(r.fullPath)}`;
  const res = (await pbRequest(
    `/api/collections/${COLL}/records?perPage=1&filter=${encodeURIComponent(filter)}`,
    { method: "GET", timeoutMs: 20_000 }
  )) as { items?: StoredRow[] };
  const it = Array.isArray(res?.items) ? res.items[0] : null;
  return it || null;
}

function fileUrl(row: StoredRow): string {
  const a = getValidPocketBaseAuth();
  const base = (a?.url || "").replace(/\/+$/, "");
  return `${base}/api/files/${COLL}/${row.id}/${encodeURIComponent(row.file)}`;
}

export async function uploadBytes(
  r: StorageReference,
  data: Blob | Uint8Array | ArrayBuffer,
  metadata?: { contentType?: string }
): Promise<{ ref: StorageReference; metadata: Record<string, unknown> }> {
  if (!isPbRef(r)) throw storageError("storage/invalid-argument", "Not a Pocket Ledger Server storage reference");
  const auth = getValidPocketBaseAuth();
  if (!auth) throw storageError("storage/unauthenticated", "Sign in to the Pocket Ledger Server first");
  const contentType = String(metadata?.contentType || (data as Blob).type || "application/octet-stream");
  const blob =
    typeof Blob !== "undefined" && data instanceof Blob
      ? data.type === contentType
        ? data
        : new Blob([data], { type: contentType })
      : new Blob([data as BlobPart], { type: contentType });
  const fd = new FormData();
  const existing = await findRow(r);
  fd.append("file", blob, r.name || "file");
  fd.append("mime", contentType.slice(0, 150));
  fd.append("size", String(blob.size));
  let row: StoredRow;
  if (existing) {
    row = (await pbFormRequest(`/api/collections/${COLL}/records/${existing.id}`, fd, "PATCH")) as StoredRow;
  } else {
    fd.append("path", r.fullPath);
    fd.append("owner", auth.userId);
    row = (await pbFormRequest(`/api/collections/${COLL}/records`, fd, "POST")) as StoredRow;
  }
  r.recordId = row.id;
  return { ref: r as unknown as StorageReference, metadata: { fullPath: r.fullPath, size: blob.size, contentType } };
}

export async function getDownloadURL(r: StorageReference): Promise<string> {
  if (!isPbRef(r)) throw storageError("storage/invalid-argument", "Not a Pocket Ledger Server storage reference");
  const row = await findRow(r);
  if (!row) throw storageError("storage/object-not-found", `Object does not exist: ${r.fullPath || r.recordId}`);
  return fileUrl(row);
}

export async function getBlob(r: StorageReference, maxDownloadSizeBytes?: number): Promise<Blob> {
  const url = await getDownloadURL(r as unknown as StorageReference);
  const res = await fetch(url);
  if (!res.ok) throw storageError("storage/object-not-found", `Download failed (${res.status})`);
  const blob = await res.blob();
  if (maxDownloadSizeBytes && blob.size > maxDownloadSizeBytes) {
    throw storageError("storage/unauthorized", `File is larger than ${maxDownloadSizeBytes} bytes`);
  }
  return blob;
}

export async function deleteObject(r: StorageReference): Promise<void> {
  if (!isPbRef(r)) throw storageError("storage/invalid-argument", "Not a Pocket Ledger Server storage reference");
  const row = await findRow(r);
  if (!row) throw storageError("storage/object-not-found", `Object does not exist: ${r.fullPath}`);
  await pbRequest(`/api/collections/${COLL}/records/${row.id}`, { method: "DELETE", timeoutMs: 20_000 });
}

export async function getMetadata(r: StorageReference): Promise<Record<string, unknown>> {
  if (!isPbRef(r)) throw storageError("storage/invalid-argument", "Not a Pocket Ledger Server storage reference");
  const row = await findRow(r);
  if (!row) throw storageError("storage/object-not-found", `Object does not exist: ${r.fullPath}`);
  return {
    name: row.path.split("/").pop() || "",
    fullPath: row.path,
    bucket: "pocketledger-server",
    size: Number(row.size) || 0,
    contentType: row.mime || "application/octet-stream",
    timeCreated: row.created || "",
    updated: row.updated || "",
  };
}

export async function list(
  r: StorageReference,
  options?: { maxResults?: number; pageToken?: string }
): Promise<{ items: StorageReference[]; prefixes: StorageReference[]; nextPageToken?: string }> {
  void options;
  if (!isPbRef(r)) throw storageError("storage/invalid-argument", "Not a Pocket Ledger Server storage reference");
  const prefix = r.fullPath ? `${r.fullPath}/` : "";
  const filter = prefix ? `path ~ ${pbQuote(prefix)}` : "";
  const res = (await pbRequest(
    `/api/collections/${COLL}/records?perPage=500&fields=id,path${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`,
    { method: "GET", timeoutMs: 30_000 }
  )) as { items?: { id: string; path: string }[] };
  const items: StorageReference[] = [];
  const prefixes = new Map<string, StorageReference>();
  for (const it of Array.isArray(res?.items) ? res.items : []) {
    if (!it.path.startsWith(prefix)) continue;
    const rest = it.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) items.push(makePbRef(it.path, it.id) as unknown as StorageReference);
    else {
      const pre = prefix + rest.slice(0, slash);
      if (!prefixes.has(pre)) prefixes.set(pre, makePbRef(pre) as unknown as StorageReference);
    }
  }
  return { items, prefixes: Array.from(prefixes.values()) };
}