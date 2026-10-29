"use client";

/**
 * Attachments for Pocket Ledger Server (PocketBase) companies.
 *
 * - Upload: a `local:<id>` file (IndexedDB / device pending blob) goes to `pl_attachments` (file field).
 * - Link: the doc keeps `pbatt:<recordId>/<storedFileName>` (the file name keeps the extension, so the
 *   existing image / PDF detection by path keeps working).
 * - Preview: bytes are read back with a short-lived file token (the file field is protected) and shown
 *   through a blob URL, so the preview UI is the same as for `local:` files.
 */

import {
  getValidPocketBaseAuth,
  pbFirst,
  pbFormRequest,
  pbQuote,
  pbRequest,
  pbFileBlob,
} from "@/lib/pocketbaseData/pbClient";

export const PB_ATTACHMENT_PREFIX = "pbatt:";

export function isPbAttachmentRef(url: unknown): boolean {
  return typeof url === "string" && url.startsWith(PB_ATTACHMENT_PREFIX);
}

export function parsePbAttachmentRef(ref: string): { recordId: string; fileName: string } | null {
  if (!isPbAttachmentRef(ref)) return null;
  const rest = ref.slice(PB_ATTACHMENT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const recordId = rest.slice(0, slash);
  const fileName = rest.slice(slash + 1);
  if (!/^[a-z0-9]{5,50}$/i.test(recordId) || !fileName || fileName.includes("/")) return null;
  return { recordId, fileName };
}

function categoryForCollection(coll: string): string {
  switch (coll) {
    case "vouchers":
      return "voucher";
    case "unassigned_documents":
      return "unassigned";
    case "parties":
      return "party";
    case "items":
      return "item";
    case "staff":
      return "staff";
    default:
      return "other";
  }
}

// ---- small in-memory blob cache (keeps previews instant after upload / first view) ----
const MAX_CACHED = 24;
const blobCache = new Map<string, { blob: Blob; url: string | null }>();
let fileToken: { token: string; atMs: number; url: string } | null = null;
/** Signed-in server user the cache belongs to (cleared when the user / server changes). */
let cacheOwner = "";

function syncCacheOwner(): void {
  const auth = getValidPocketBaseAuth();
  const owner = auth ? `${auth.url}|${auth.userId}` : "";
  if (owner === cacheOwner) return;
  cacheOwner = owner;
  fileToken = null;
  for (const ent of blobCache.values()) {
    if (ent.url && typeof URL !== "undefined") {
      try {
        URL.revokeObjectURL(ent.url);
      } catch {
        /* ignore */
      }
    }
  }
  blobCache.clear();
}

function cachePut(ref: string, blob: Blob): void {
  syncCacheOwner();
  const old = blobCache.get(ref);
  if (old) {
    blobCache.delete(ref);
    blobCache.set(ref, old);
    return;
  }
  blobCache.set(ref, { blob, url: null });
  while (blobCache.size > MAX_CACHED) {
    const first = blobCache.keys().next().value as string | undefined;
    if (first === undefined) break;
    const ent = blobCache.get(first);
    blobCache.delete(first);
    if (ent?.url && typeof URL !== "undefined") {
      try {
        URL.revokeObjectURL(ent.url);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---- file token (protected files): `fileToken` is declared with the cache above ----

async function getFileToken(): Promise<string> {
  syncCacheOwner();
  const auth = getValidPocketBaseAuth();
  const now = Date.now();
  // Server file tokens are short-lived (~2 min); renew well before that.
  if (fileToken && auth && fileToken.url === auth.url && now - fileToken.atMs < 90_000) return fileToken.token;
  const res = (await pbRequest("/api/files/token", { method: "POST" })) as { token?: string };
  const token = String(res?.token || "");
  if (!token) throw new Error("Pocket Ledger Server: file token missing");
  fileToken = { token, atMs: now, url: auth?.url || "" };
  return token;
}

const inflight = new Map<string, Promise<Blob | null>>();

/** Attachment bytes from the server (cached). Null when missing / not allowed / offline. */
export async function fetchPbAttachmentBlob(ref: string): Promise<Blob | null> {
  const p = parsePbAttachmentRef(ref);
  if (!p) return null;
  syncCacheOwner();
  const hit = blobCache.get(ref);
  if (hit) return hit.blob;
  const running = inflight.get(ref);
  if (running) return running;
  const job = (async () => {
    try {
      if (!getValidPocketBaseAuth()) return null;
      const token = await getFileToken();
      const blob = await pbFileBlob(
        `/api/files/pl_attachments/${encodeURIComponent(p.recordId)}/${encodeURIComponent(p.fileName)}?token=${encodeURIComponent(token)}`
      );
      if (blob && blob.size > 0) cachePut(ref, blob);
      return blob && blob.size > 0 ? blob : null;
    } catch {
      return null;
    } finally {
      inflight.delete(ref);
    }
  })();
  inflight.set(ref, job);
  return job;
}

/** Same shape as the static attachment resolver result. */
export async function resolvePbAttachmentDisplay(
  ref: string
): Promise<{ displayUrl: string | null; blob: Blob | null; contentType: string | null }> {
  const blob = await fetchPbAttachmentBlob(ref);
  if (!blob) return { displayUrl: null, blob: null, contentType: null };
  const ent = blobCache.get(ref);
  let url: string | null = ent?.url ?? null;
  if (!url && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    url = URL.createObjectURL(blob);
    if (ent) ent.url = url;
  }
  return { displayUrl: url, blob, contentType: blob.type || null };
}

// ---- upload ----

type PendingLike = { id: string; blob: Blob; contentType?: string; fileName?: string };

function attachmentAppId(localId: string): string {
  return `att_${localId}`.slice(0, 200);
}

function refFromRecord(rec: Record<string, unknown>): string | null {
  const id = String(rec.id || "");
  const file = String(rec.file || "");
  if (!id || !file) return null;
  return `${PB_ATTACHMENT_PREFIX}${id}/${file}`;
}

/**
 * Upload one pending file. Idempotent: the record app_id is `att_<localId>`, so a retry after a
 * failed doc push re-uses the record that is already on the server.
 */
export async function uploadPendingFileToPocketBase(input: {
  pbCompanyId: string;
  localRef: string;
  pending: PendingLike | null;
  ownerColl: string;
  ownerAppId: string;
  deviceId: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (input.signal?.aborted) return null;
  const localId = input.localRef.slice("local:".length);
  if (!localId) return null;
  const appId = attachmentAppId(localId);
  const existing = await pbFirst<Record<string, unknown>>(
    "pl_attachments",
    `company = ${pbQuote(input.pbCompanyId)} && app_id = ${pbQuote(appId)}`
  ).catch(() => null);
  if (existing) return refFromRecord(existing);
  const pending = input.pending;
  if (!pending?.blob || pending.blob.size <= 0) return null;
  const fileName = String(pending.fileName || "file").trim() || "file";
  const contentType = String(pending.contentType || pending.blob.type || "application/octet-stream");
  const fd = new FormData();
  fd.append("company", input.pbCompanyId);
  fd.append("app_id", appId);
  fd.append("category", categoryForCollection(input.ownerColl));
  fd.append("owner_coll", input.ownerColl);
  fd.append("owner_app_id", input.ownerAppId);
  fd.append("file_name", fileName.slice(0, 300));
  fd.append("mime", contentType.slice(0, 100));
  fd.append("size", String(pending.blob.size));
  fd.append("source_url", input.localRef.slice(0, 2000));
  fd.append("updatedAtMs", String(Date.now()));
  fd.append("deviceId", input.deviceId.slice(0, 100));
  const typed = pending.blob.type ? pending.blob : new Blob([pending.blob], { type: contentType });
  fd.append("file", typed, fileName);
  const rec = (await pbFormRequest("/api/collections/pl_attachments/records", fd, "POST", {
    signal: input.signal,
  })) as Record<string, unknown>;
  const ref = refFromRecord(rec);
  if (ref) cachePut(ref, typed);
  return ref;
}

function shouldRecurse(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  if (v instanceof Date) return false;
  if (typeof (v as { toDate?: unknown }).toDate === "function") return false;
  if (typeof Blob !== "undefined" && v instanceof Blob) return false;
  return true;
}

/** Replace strings in a doc (deep) through `map`; returns the same object when nothing changed. */
export function replaceRefsDeep<T>(value: T, map: Map<string, string>): T {
  if (!map.size) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (!shouldRecurse(v)) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = walk(o[k]);
    return out;
  };
  return walk(value) as T;
}

function collectLocalRefs(v: unknown, into: Set<string>): void {
  if (typeof v === "string") {
    if (v.startsWith("local:") && v.length > 6) into.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectLocalRefs(x, into);
    return;
  }
  if (!shouldRecurse(v)) return;
  for (const x of Object.values(v as Record<string, unknown>)) collectLocalRefs(x, into);
}

export type PbAttachmentConversion = {
  data: Record<string, unknown>;
  /** `local:` ref -> `pbatt:` ref for every file now on the server. */
  converted: Map<string, string>;
  /** Pending ids that can be dropped once the doc push succeeded. */
  uploadedPendingIds: string[];
};

/**
 * Outbox push: upload every `local:` file in the doc and swap in `pbatt:` links.
 * Files whose bytes are not on this device keep the `local:` ref as-is (same rule as the Firebase path).
 */
export async function convertLocalRefsForPocketBase(input: {
  pbCompanyId: string;
  coll: string;
  docId: string;
  data: Record<string, unknown>;
  deviceId: string;
  getPending: (localRef: string) => Promise<PendingLike | null>;
  signal?: AbortSignal;
}): Promise<PbAttachmentConversion> {
  const refs = new Set<string>();
  collectLocalRefs(input.data, refs);
  const converted = new Map<string, string>();
  const uploadedPendingIds: string[] = [];
  for (const localRef of refs) {
    if (input.signal?.aborted) break;
    let pending: PendingLike | null = null;
    try {
      pending = await input.getPending(localRef);
    } catch {
      pending = null;
    }
    const ref = await uploadPendingFileToPocketBase({
      pbCompanyId: input.pbCompanyId,
      localRef,
      pending,
      ownerColl: input.coll,
      ownerAppId: input.docId,
      deviceId: input.deviceId,
      signal: input.signal,
    });
    if (!ref) {
      console.warn(`[sync] Attachment bytes not on this device for ${localRef} - keeping ref as-is`);
      continue;
    }
    converted.set(localRef, ref);
    if (pending?.id) uploadedPendingIds.push(pending.id);
  }
  return { data: replaceRefsDeep(input.data, converted), converted, uploadedPendingIds };
}
