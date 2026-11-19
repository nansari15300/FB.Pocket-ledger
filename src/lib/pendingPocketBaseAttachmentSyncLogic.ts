/**
 * Pure helpers for retrying PocketBase voucher/doc attachments that stayed as `local:`
 * after a reload. No IndexedDB / network — safe for selftests.
 */

export const LOCAL_FILE_PREFIX = "local:";

export type ParsedCompanyDocPath = {
  companyId: string;
  collection: string;
  docId: string;
};

export function parseCompanyDocPath(docPath: string | null | undefined): ParsedCompanyDocPath | null {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return null;
  const companyId = m[1].trim();
  const collection = m[2].trim();
  const docId = m[3].trim();
  if (!companyId || !collection || !docId) return null;
  return { companyId, collection, docId };
}

export function pendingBlobIsUsable(blob: { size?: number } | null | undefined): boolean {
  return Boolean(blob && typeof blob.size === "number" && blob.size > 0);
}

export function localRefFromId(localId: string): string {
  return `${LOCAL_FILE_PREFIX}${String(localId || "").trim()}`;
}

function shouldRecurse(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  if (value instanceof Date) return false;
  return true;
}

export function collectLocalRefs(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith(LOCAL_FILE_PREFIX) && value.length > LOCAL_FILE_PREFIX.length) into.add(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocalRefs(item, into);
    return into;
  }
  if (!shouldRecurse(value)) return into;
  for (const item of Object.values(value as Record<string, unknown>)) collectLocalRefs(item, into);
  return into;
}

export function docHasLocalRef(doc: unknown, localId: string): boolean {
  const id = String(localId || "").trim();
  if (!id) return false;
  return collectLocalRefs(doc).has(localRefFromId(id));
}

export type PendingPocketBaseAttachmentDecision =
  | { action: "skip_missing_blob" }
  | { action: "skip_not_in_doc" }
  | { action: "upload_and_patch" };

/**
 * If the blob is not on this PC, do nothing (another device created the `local:` ref).
 * If the local doc no longer contains that ref, do not invent a patch or delete the blob.
 */
export function decidePendingPocketBaseAttachmentSync(input: {
  hasBlob: boolean;
  doc: unknown;
  localId: string;
}): PendingPocketBaseAttachmentDecision {
  if (!input.hasBlob) return { action: "skip_missing_blob" };
  if (!input.doc || typeof input.doc !== "object") return { action: "skip_not_in_doc" };
  if (!docHasLocalRef(input.doc, input.localId)) return { action: "skip_not_in_doc" };
  return { action: "upload_and_patch" };
}

export function applyLocalToPbattRefs<T>(value: T, converted: Map<string, string> | Record<string, string>): T {
  const map = converted instanceof Map ? converted : new Map(Object.entries(converted));
  if (!map.size) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (!shouldRecurse(v)) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(o)) out[key] = walk(o[key]);
    return out;
  };
  return walk(value) as T;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "[::1]", "::1"]);
const PB_FILE_PATH = /\/api\/files\/(pl_stored_files|pl_attachments)\/[^?#]+/i;

/**
 * Display-only: map a stored `http://127.0.0.1:8090/api/files/...` URL to the current
 * PocketBase base (LAN host or same-origin `/pb` proxy). Does not change non-file URLs.
 */
export function rewriteLoopbackPocketBaseFileUrlForDisplay(url: string, pbBaseUrl: string): string {
  const raw = String(url || "").trim();
  const base = String(pbBaseUrl || "").trim().replace(/\/+$/, "");
  if (!raw || !base) return raw;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return raw;
  const filePath = parsed.pathname + parsed.search + parsed.hash;
  if (!PB_FILE_PATH.test(parsed.pathname)) return raw;
  try {
    const next = new URL(base);
    return `${next.origin}${next.pathname.replace(/\/+$/, "")}${filePath}`;
  } catch {
    return raw;
  }
}

/** Firebase company upload pref is off for PocketBase companies; they still must be scanned. */
export function shouldScanPendingFileForSync(flags: {
  firebaseUploadEnabled: boolean;
  pocketBaseAttachmentSyncEnabled: boolean;
}): boolean {
  return flags.pocketBaseAttachmentSyncEnabled || flags.firebaseUploadEnabled;
}

export const PENDING_PB_ATTACHMENT_SYNC_LOCK = "pl-pending-pb-attachment-sync";
