"use client";

/**
 * Recompress reuse: company me sab jagah HTTPS URL replace → verify → purana Storage turant delete.
 */
import { writeEntity } from "@/lib/writeGateway/writeEntity";
import {
  getCompanyDocFromBrowserDb,
  upsertCompanyDocInBrowserDb,
} from "@/lib/localCompanyDocMirror";
import {
  ATTACHMENT_REUSE_COUNT_EVENT,
  attachmentPersistableRefsMatch,
  countAttachmentUsageInCompany,
  deleteFirebaseStorageUrlsWithRegistry,
  invalidateAttachmentUsagePlacesCacheForCompany,
  listAttachmentUsagePlacesInCompany,
  removeFirebaseAttachmentRegistryDoc,
  setFirebaseAttachmentRegistryRefCount,
} from "@/lib/companyAttachmentRegistry";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";

const ATTACHMENT_SCAN_FIELDS = [
  "fileUrls",
  "documentFileUrls",
  "fileUrl",
  "logoUrl",
  "avatarUrl",
  "unassignedFile",
] as const;

function isHttpsRef(url: string): boolean {
  return /^https?:\/\//i.test(String(url || "").trim());
}

function replaceAttachmentRefInValue(
  value: unknown,
  fromUrl: string,
  toUrl: string
): { next: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (attachmentPersistableRefsMatch(value, fromUrl)) return { next: toUrl, changed: true };
    return { next: value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const r = replaceAttachmentRefInValue(item, fromUrl, toUrl);
      if (r.changed) changed = true;
      return r.next;
    });
    return { next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [k, v] of Object.entries(out)) {
      const r = replaceAttachmentRefInValue(v, fromUrl, toUrl);
      if (r.changed) {
        out[k] = r.next;
        changed = true;
      }
    }
    return { next: out, changed };
  }
  return { next: value, changed: false };
}

function buildAttachmentFieldPatch(
  row: Record<string, unknown>,
  fromUrl: string,
  toUrl: string
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let any = false;
  void ATTACHMENT_SCAN_FIELDS;
  // Same field set as the strict usage scan (companyAttachmentRegistry): every field except history/id,
  // so IC interCompanyOwnFileUrls, loan docs, templates etc. are swapped too.
  for (const field of Object.keys(row)) {
    if (field === "history" || field === "id") continue;
    const r = replaceAttachmentRefInValue(row[field], fromUrl, toUrl);
    if (r.changed) {
      patch[field] = r.next;
      any = true;
    }
  }
  return any ? patch : null;
}

async function patchPlaceAttachmentUrl(params: {
  companyId: string;
  collectionName: string;
  docId: string;
  fromUrl: string;
  toUrl: string;
}): Promise<boolean> {
  const { companyId, collectionName, docId, fromUrl, toUrl } = params;
  const scanIds = [companyId];
  try {
    const auth = await resolveAuthoritativeFirestoreCompanyId(companyId);
    if (auth && auth !== companyId) scanIds.push(auth);
  } catch {
    /* cid only */
  }

  let row: Record<string, unknown> | null = null;
  let rowCid = companyId;
  for (const cid of scanIds) {
    row = (await getCompanyDocFromBrowserDb(cid, collectionName, docId).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (row) {
      rowCid = cid;
      break;
    }
  }
  if (!row) return false;

  const patch = buildAttachmentFieldPatch(row, fromUrl, toUrl);
  if (!patch) return false;

  const writeCid =
    String((await resolveAuthoritativeFirestoreCompanyId(companyId)) || companyId).trim() || companyId;
  const r = await writeEntity({
    companyId: writeCid,
    collectionName,
    docId,
    operation: "update",
    data: patch,
  });
  if (r.ok === false) {
    console.warn("[rewriteCompanyHttpsAttachmentUrl] writeEntity failed", {
      place: `${collectionName}/${docId}`,
      error: r.error,
    });
    return false;
  }

  const merged = { ...row, ...patch, id: docId };
  await upsertCompanyDocInBrowserDb(rowCid, collectionName, docId, merged).catch(() => undefined);
  return true;
}

export type RewriteCompanyHttpsAttachmentResult = {
  rewrittenPlaces: number;
  deletedOld: boolean;
  remainingOldUsage: number;
};

/**
 * Sab company places pe `fromUrl` → `toUrl`, verify live(old)=0, phir Storage force-delete.
 */
export async function rewriteCompanyHttpsAttachmentUrlEverywhere(params: {
  companyId: string;
  fromUrl: string;
  toUrl: string;
}): Promise<RewriteCompanyHttpsAttachmentResult> {
  const companyId = String(params.companyId || "").trim();
  const fromUrl = String(params.fromUrl || "").trim();
  const toUrl = String(params.toUrl || "").trim();
  if (!companyId || !isHttpsRef(fromUrl) || !isHttpsRef(toUrl)) {
    return { rewrittenPlaces: 0, deletedOld: false, remainingOldUsage: 0 };
  }
  if (attachmentPersistableRefsMatch(fromUrl, toUrl)) {
    return { rewrittenPlaces: 0, deletedOld: false, remainingOldUsage: 0 };
  }

  invalidateAttachmentUsagePlacesCacheForCompany(companyId, fromUrl);
  const places = await listAttachmentUsagePlacesInCompany(companyId, fromUrl);
  let rewrittenPlaces = 0;
  for (const place of places) {
    // IC peer-company places are counted (blocks delete) but not rewritten from this company.
    if (place.placeKey.startsWith("peer:")) continue;
    const slash = place.placeKey.indexOf("/");
    if (slash <= 0) continue;
    const collectionName = place.placeKey.slice(0, slash);
    const docId = place.placeKey.slice(slash + 1);
    if (!collectionName || !docId) continue;
    const ok = await patchPlaceAttachmentUrl({
      companyId,
      collectionName,
      docId,
      fromUrl,
      toUrl,
    });
    if (ok) rewrittenPlaces += 1;
  }

  invalidateAttachmentUsagePlacesCacheForCompany(companyId, fromUrl);
  invalidateAttachmentUsagePlacesCacheForCompany(companyId, toUrl);

  const expectedCount = Math.max(1, places.length || rewrittenPlaces);
  await setFirebaseAttachmentRegistryRefCount(companyId, toUrl, expectedCount);

  // Session paste hint / UI badge — purani URL se nayi URL pe migrate.
  try {
    const {
      getAttachmentReuseSessionHintAsync,
      bumpAttachmentReuseSessionHint,
      rememberAttachmentReuseOriginPlace,
      getAttachmentReuseSessionOriginPlaceAsync,
    } = await import("@/lib/companyAttachmentRegistry");
    const hint = await getAttachmentReuseSessionHintAsync(companyId, fromUrl);
    if (hint > 0) {
      await bumpAttachmentReuseSessionHint(companyId, toUrl, Math.max(1, hint - 1));
    } else if (rewrittenPlaces >= 2 || places.length >= 2) {
      await bumpAttachmentReuseSessionHint(companyId, toUrl, Math.max(1, places.length - 1));
    }
    const origin =
      (await getAttachmentReuseSessionOriginPlaceAsync(companyId, fromUrl)) ||
      places[0]?.placeKey ||
      null;
    if (origin) rememberAttachmentReuseOriginPlace(companyId, toUrl, origin);
  } catch {
    /* non-fatal */
  }

  const remainingOldUsage = await countAttachmentUsageInCompany(companyId, fromUrl);
  let deletedOld = false;
  if (remainingOldUsage === 0) {
    await removeFirebaseAttachmentRegistryDoc(companyId, fromUrl);
    await deleteFirebaseStorageUrlsWithRegistry(companyId, [fromUrl], {
      forceDeleteBytes: true,
      traceEntityId: "recompress-reuse-replace",
    });
    deletedOld = true;
  } else {
    console.warn("[rewriteCompanyHttpsAttachmentUrl] old URL still referenced — skip force delete", {
      companyId,
      fromUrl: fromUrl.slice(0, 80),
      remainingOldUsage,
      rewrittenPlaces,
    });
  }

  invalidateAttachmentUsagePlacesCacheForCompany(companyId, fromUrl);
  invalidateAttachmentUsagePlacesCacheForCompany(companyId, toUrl);

  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(ATTACHMENT_REUSE_COUNT_EVENT, {
          detail: { companyId, fromUrl, toUrl, rewrittenPlaces },
        })
      );
    } catch {
      /* ignore */
    }
  }

  return { rewrittenPlaces, deletedOld, remainingOldUsage };
}
