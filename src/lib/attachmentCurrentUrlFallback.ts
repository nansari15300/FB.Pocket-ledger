"use client";

/**
 * Viewer fallback: an attachment URL failed to load (404 / object-not-found, e.g. old object deleted
 * after a recompress swap on another device). Re-read the owning doc (local SQLite first, then server)
 * and return the CURRENT https URL that replaced it — never keep showing a broken image when a newer URL exists.
 */
import { doc } from "@/lib/pbCompat/firestore";
import { getDocFromServer } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { attachmentPersistableRefsMatch } from "@/lib/companyAttachmentRegistry";

const tried = new Map<string, number>();
const RETRY_MS = 60_000;

function collectHttpsUrls(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value.trim())) out.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectHttpsUrls(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "history") continue;
      collectHttpsUrls(v, out, depth + 1);
    }
  }
}

/** Ordered attachment URLs of a row (primary list fields first, then any other field). */
function rowAttachmentUrls(row: Record<string, unknown>): { primary: string[]; all: string[] } {
  const primary: string[] = [];
  for (const k of ["fileUrls", "documentFileUrls", "interCompanyOwnFileUrls", "fileUrl", "logoUrl", "avatarUrl"]) {
    collectHttpsUrls(row[k], primary);
  }
  const all: string[] = [];
  collectHttpsUrls(row, all);
  return { primary, all };
}

function pickReplacement(
  row: Record<string, unknown> | null,
  badUrl: string,
  siblingUrls: string[],
  index: number | undefined
): string | null {
  if (!row || row.isDeleted === true) return null;
  const { primary, all } = rowAttachmentUrls(row);
  // Still referenced → nothing newer to show.
  if (all.some((u) => attachmentPersistableRefsMatch(u, badUrl))) return null;
  const isSibling = (u: string) => siblingUrls.some((s) => attachmentPersistableRefsMatch(s, u));
  const fresh = primary.filter((u) => !isSibling(u));
  if (fresh.length === 1) return fresh[0];
  if (index != null && index >= 0 && index < primary.length && !isSibling(primary[index])) return primary[index];
  return fresh[0] ?? null;
}

export async function resolveCurrentAttachmentUrlAfterLoadError(params: {
  companyId: string | null | undefined;
  /** `collection/docId` */
  placeKey: string | null | undefined;
  badUrl: string;
  /** Other URLs shown alongside (gallery) — excluded from candidates. */
  siblingUrls?: string[];
  index?: number;
  allowServer?: boolean;
}): Promise<string | null> {
  const companyId = String(params.companyId || "").trim();
  const placeKey = String(params.placeKey || "").trim();
  const badUrl = String(params.badUrl || "").trim();
  if (!companyId || !placeKey || !/^https?:\/\//i.test(badUrl) || placeKey.startsWith("peer:")) return null;
  const slash = placeKey.indexOf("/");
  if (slash <= 0) return null;
  const collectionName = placeKey.slice(0, slash);
  const docId = placeKey.slice(slash + 1);
  const key = `${companyId}|${placeKey}|${badUrl}`;
  const last = tried.get(key);
  if (last && Date.now() - last < RETRY_MS) return null;
  tried.set(key, Date.now());
  const siblings = (params.siblingUrls || []).filter((u) => !attachmentPersistableRefsMatch(u, badUrl));

  try {
    const local = (await getCompanyDocFromBrowserDb(companyId, collectionName, docId).catch(() => null)) as
      | Record<string, unknown>
      | null;
    const fromLocal = pickReplacement(local, badUrl, siblings, params.index);
    if (fromLocal) return fromLocal;
  } catch {
    /* fall through to server */
  }
  if (params.allowServer === false) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  try {
    const snap = await getDocFromServer(doc(firestore, "companies", companyId, collectionName, docId));
    if (!snap.exists()) return null;
    return pickReplacement(snap.data() as Record<string, unknown>, badUrl, siblings, params.index);
  } catch {
    return null;
  }
}
