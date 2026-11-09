"use client";

/**
 * Restore / force-upload recovery: bucket me file hai, docs me abhi `local:uuid` —
 * Storage se HTTPS resolve karke SQLite + Firestore patch.
 */

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { ref, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore, storage } from "@/lib/plClientSession";
import { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } from "@/lib/firestoreToLocalCompanyPull";
import {
  deserializeLocalDbValue,
  listCompanyDocRawRowsWithLocalRefHint,
  upsertCompanyDocInBrowserDb,
  notifyBrowserDbCollectionUpdated,
  getCompanyDocFromBrowserDb,
} from "@/lib/localCompanyDocMirror";
import {
  getLocalFileRefMeta,
  isLocalFileRef,
  LOCAL_FILE_PREFIX,
} from "@/lib/localPendingFiles";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import {
  buildPendingAttachmentStorageObjectPath,
  buildStoragePathPrefix,
  buildStoragePathPrefixCandidates,
  companyUsesPocketLedgerStorage,
  type CompanyStorageLayoutRow,
} from "@/lib/firebaseStoragePaths";
import { yieldToMain } from "@/lib/yieldToMain";
import { withOnlineTriggerScope } from "@/lib/onlineTriggerLog";

type LocalRefHit = {
  localId: string;
  docPath: string;
  field: string;
  storagePathPrefix: string;
  fileName?: string;
};

function inferStoragePathPrefix(
  collectionName: string,
  docRow: Record<string, unknown>,
  fsCompanyId: string,
  fieldKey: string,
  usePocketLedger: boolean
): string {
  const voucherType =
    collectionName === "vouchers" ? String(docRow.type || "journal").trim() || "journal" : undefined;
  return buildStoragePathPrefix({
    companyId: fsCompanyId,
    usePocketLedger,
    collectionName,
    fieldKey,
    voucherType,
  });
}

function scrapeLocalRefsFromValue(
  value: unknown,
  fieldKey: string,
  docPath: string,
  collectionName: string,
  docRow: Record<string, unknown>,
  fsCompanyId: string,
  out: LocalRefHit[],
  depth: number,
  usePocketLedger: boolean
): void {
  if (depth > 24) return;
  if (typeof value === "string" && isLocalFileRef(value)) {
    const localId = value.slice(LOCAL_FILE_PREFIX.length).trim();
    if (!localId) return;
    out.push({
      localId,
      docPath,
      field: fieldKey,
      storagePathPrefix: inferStoragePathPrefix(collectionName, docRow, fsCompanyId, fieldKey, usePocketLedger),
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scrapeLocalRefsFromValue(
        item,
        fieldKey,
        docPath,
        collectionName,
        docRow,
        fsCompanyId,
        out,
        depth + 1,
        usePocketLedger
      );
    }
    return;
  }
  if (value && typeof value === "object") {
    const keepParentField = fieldKey === "unassignedFile";
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      scrapeLocalRefsFromValue(
        v,
        keepParentField ? fieldKey : k,
        docPath,
        collectionName,
        docRow,
        fsCompanyId,
        out,
        depth + 1,
        usePocketLedger
      );
    }
  }
}

async function collectLocalRefsFromSqlite(
  localCompanyId: string,
  fsCompanyId: string,
  usePocketLedger: boolean
): Promise<LocalRefHit[]> {
  const hits: LocalRefHit[] = [];
  const seenDoc = new Set<string>();

  for (const collectionName of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
    await yieldToMain();
    const rawRows = await listCompanyDocRawRowsWithLocalRefHint(localCompanyId, fsCompanyId, collectionName);
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i]!;
      const docId = String(row.id ?? "").trim();
      if (!docId) continue;
      const docPath = `companies/${fsCompanyId}/${collectionName}/${docId}`;
      if (seenDoc.has(docPath)) continue;
      seenDoc.add(docPath);
      try {
        const parsed = JSON.parse(row.data) as Record<string, unknown>;
        const data = deserializeLocalDbValue(parsed) as Record<string, unknown>;
        for (const [k, v] of Object.entries(data)) {
          if (k === "id") continue;
          scrapeLocalRefsFromValue(v, k, docPath, collectionName, data, fsCompanyId, hits, 0, usePocketLedger);
        }
      } catch {
        /* corrupt row */
      }
      if (i > 0 && i % 20 === 0) await yieldToMain();
    }
  }
  return hits;
}

/** Exact object GET only — folder `list()` Class A storm (heal retry) band. */
async function findDownloadUrlAtExactPath(
  prefix: string,
  localId: string,
  fileName?: string
): Promise<string | null> {
  const p = String(prefix || "").replace(/\/+$/, "");
  const id = String(localId || "").trim();
  if (!p || !id) return null;
  const names = [...new Set([String(fileName || "").trim(), "file"].filter(Boolean))];
  for (const name of names) {
    try {
      const exact = buildPendingAttachmentStorageObjectPath({
        storagePathPrefix: p,
        pendingFileId: id,
        fileName: name,
      });
      return await getDownloadURL(ref(storage, exact));
    } catch {
      /* next name / prefix */
    }
  }
  return null;
}

async function resolveHttpsForLocalId(
  hit: LocalRefHit,
  fsCompanyId: string,
  docRow: Record<string, unknown>
): Promise<string | null> {
  const meta = await getLocalFileRefMeta(`${LOCAL_FILE_PREFIX}${hit.localId}`);
  const fileName = meta?.fileName || hit.fileName;
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(hit.docPath);
  const collectionName = m?.[2] || "vouchers";
  const voucherType =
    collectionName === "vouchers" ? String(docRow.type || "journal").trim() || "journal" : undefined;
  const candidatePrefixes = buildStoragePathPrefixCandidates({
    companyId: fsCompanyId,
    usePocketLedger: true,
    collectionName,
    fieldKey: hit.field,
    voucherType,
  });
  const prefixes = [
    String(meta?.storagePathPrefix || "").trim(),
    hit.storagePathPrefix,
    ...candidatePrefixes,
    inferStoragePathPrefix(collectionName, docRow, fsCompanyId, hit.field, false),
  ].filter(Boolean);
  const seen = new Set<string>();
  for (const prefix of prefixes) {
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    const url = await findDownloadUrlAtExactPath(prefix, hit.localId, fileName);
    if (url) return url;
  }
  return null;
}

async function mirrorHttpsToSqlite(
  localCompanyId: string,
  docPath: string,
  field: string,
  localId: string,
  httpsUrl: string
): Promise<boolean> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return false;
  const [, pathCompanyId, collection, docId] = m;
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  const tryIds = [localCompanyId, pathCompanyId!].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const companyId of tryIds) {
    const existing = await getCompanyDocFromBrowserDb(companyId, collection!, docId!, { includeDeleted: true });
    if (!existing) continue;
    const cur = existing[field];
    let next: unknown;
    if (Array.isArray(cur)) {
      const arr = [...cur];
      const idx = arr.findIndex((v) => v === needle);
      if (idx < 0) continue;
      arr[idx] = httpsUrl;
      next = arr;
    } else if (cur === needle) {
      next = httpsUrl;
    } else if (cur && typeof cur === "object" && (cur as { url?: unknown }).url === needle) {
      next = { ...(cur as Record<string, unknown>), url: httpsUrl };
    } else {
      continue;
    }
    await upsertCompanyDocInBrowserDb(
      companyId,
      collection!,
      docId!,
      { ...existing, [field]: next, id: docId },
      { notify: true, force: true }
    );
    notifyBrowserDbCollectionUpdated(companyId, collection!);
    return true;
  }
  return false;
}

async function patchHttpsToFirestore(
  docPath: string,
  field: string,
  localId: string,
  httpsUrl: string,
  sourceRow: Record<string, unknown>
): Promise<void> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return;
  const [, companyId, collectionName, docId] = m;
  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(companyId!);
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  const current = sourceRow[field];
  let value: unknown = httpsUrl;
  if (Array.isArray(current)) {
    // Source row authoritative — only replace this `local:{id}`. Never merge all Firestore HTTPS
    // (that re-appends URLs the user already removed) and never push when needle is gone.
    const idx = current.findIndex((v) => v === needle);
    if (idx < 0) return;
    value = current.map((v, i) => (i === idx ? httpsUrl : v));
  } else if (typeof current === "string") {
    if (current !== needle) return;
  } else if (current && typeof current === "object") {
    const url = (current as { url?: unknown }).url;
    if (url !== needle) return;
    value = { ...(current as Record<string, unknown>), url: httpsUrl };
  } else if (current != null) {
    return;
  }
  await setDoc(
    doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId!),
    { [field]: value, id: docId },
    { merge: true }
  );
}

/**
 * SQLite me bache `local:` refs → Storage object dhundo → HTTPS SQLite + Firestore.
 * Banner gayab / pending empty hone ke baad bhi chal sakta hai.
 */
export async function relinkLocalAttachmentsFromFirebaseStorage(companyId: string): Promise<{
  localRefs: number;
  relinked: number;
  missed: number;
}> {
  return withOnlineTriggerScope(
    { feature: "heal", codePath: "relinkLocalAttachmentsFromStorage" },
    () => relinkLocalAttachmentsFromFirebaseStorageWork(companyId)
  );
}

async function relinkLocalAttachmentsFromFirebaseStorageWork(companyId: string): Promise<{
  localRefs: number;
  relinked: number;
  missed: number;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { localRefs: 0, relinked: 0, missed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { localRefs: 0, relinked: 0, missed: 0 };
  }

  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(cid);
  const localCompanyRow = await getLocalCompanyById(cid, { includeDeleted: true });
  let usePocketLedger = companyUsesPocketLedgerStorage(localCompanyRow);
  try {
    const companySnap = await getDoc(doc(firestore, "companies", fsCompanyId));
    if (companySnap.exists()) {
      usePocketLedger =
        usePocketLedger ||
        companyUsesPocketLedgerStorage(companySnap.data() as CompanyStorageLayoutRow);
    }
  } catch {
    /* ignore */
  }

  const hits = await collectLocalRefsFromSqlite(cid, fsCompanyId, usePocketLedger);
  if (!hits.length) return { localRefs: 0, relinked: 0, missed: 0 };

  let relinked = 0;
  let missed = 0;
  const doneIds = new Set<string>();

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const dedupeKey = `${hit.docPath}|${hit.field}|${hit.localId}`;
    if (doneIds.has(dedupeKey)) continue;
    doneIds.add(dedupeKey);

    const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(hit.docPath);
    const sourceRow =
      (m
        ? (await getCompanyDocFromBrowserDb(cid, m[2]!, m[3]!, { includeDeleted: true })) ||
          (await getCompanyDocFromBrowserDb(m[1]!, m[2]!, m[3]!, { includeDeleted: true }))
        : null) || {};

    const httpsUrl = await resolveHttpsForLocalId(hit, fsCompanyId, sourceRow);
    if (!httpsUrl) {
      missed++;
      continue;
    }

    if (process.env.NODE_ENV !== "production") {
      const mPath = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(hit.docPath);
      void import("@/lib/attachmentDeleteTrace").then((t) =>
        t.traceAttachmentUrlsChange({
          source: "relinkLocalAttachmentsFromStorage",
          companyId: cid,
          voucherId: mPath?.[3] || "",
          prevUrls: Array.isArray(sourceRow[hit.field])
            ? (sourceRow[hit.field] as unknown[]).map(String)
            : [],
          nextUrls: [
            ...(Array.isArray(sourceRow[hit.field])
              ? (sourceRow[hit.field] as unknown[]).map(String)
              : []),
            httpsUrl,
          ],
          extra: { localId: hit.localId, field: hit.field, note: "about to patch HTTPS for stuck local:" },
        })
      );
    }
    try {
      await patchHttpsToFirestore(hit.docPath, hit.field, hit.localId, httpsUrl, sourceRow);
    } catch (e) {
      console.warn("[relinkLocalAttachments] Firestore patch failed", hit.localId, e);
    }
    try {
      const ok = await mirrorHttpsToSqlite(cid, hit.docPath, hit.field, hit.localId, httpsUrl);
      if (ok) relinked++;
      else missed++;
    } catch (e) {
      console.warn("[relinkLocalAttachments] SQLite mirror failed", hit.localId, e);
      missed++;
    }
    if (i > 0 && i % 4 === 0) await yieldToMain();
  }

  return { localRefs: hits.length, relinked, missed };
}

/** True jab SQLite me abhi bhi `local:` attachment refs hain (online company heal candidate). */
export async function companyHasStuckLocalAttachmentRefs(companyId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  try {
    const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(cid);
    for (const collectionName of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
      const rawRows = await listCompanyDocRawRowsWithLocalRefHint(cid, fsCompanyId, collectionName);
      if (rawRows.length > 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}
