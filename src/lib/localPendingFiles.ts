"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { openDB } from "./offlineDb";
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { doc, type DocumentReference } from "@/lib/pbCompat/firestore";
// Seam imports: company docs of a PocketBase company must come from the server mirror, never
// Firestore (Firebase is authentication only now).
import { getDoc, getDocFromCache, getDocFromServer } from "@/lib/pocketbaseData/pbReadSeam";
import { storage } from "@/lib/plClientSession";
import { firestore } from "@/lib/plClientSession";
import { writeEntity } from "@/lib/writeGateway";
import { Capacitor } from "@capacitor/core";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { electronAttachmentDisplayUrlFromPath } from "@/lib/electronAttachmentFs";
import { usesEmbeddedNativeAttachmentStorage } from "@/lib/usesEmbeddedNativeAttachmentStorage";
import {
  deleteAttachmentBlobFromDataDir,
  getAttachmentFileUriFromDataDir,
  readAttachmentBlobFromDataDir,
  writeAttachmentBlobToDataDir,
} from "@/lib/capacitorAttachmentFs";
import { computeSha256HexFromBlob } from "@/lib/security/sha256Hex";
import {
  deleteAttachmentFileRef,
  getAttachmentFileRef,
  listAttachmentFileRefs,
  upsertAttachmentFileRef,
} from "@/lib/attachmentFileRefStore";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { inferAttachmentContentTypeFromName } from "@/lib/attachmentFormatLabel";
import { isGoogleDriveCloudSyncCompany, uploadPendingAttachmentPayloadToDrive } from "@/lib/localCloudSync/driveCloudSyncClient";
import { getLocalCompanyById, listLocalCompanies } from "@/lib/localCompanyStore";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { isPureLocalLedgerCompany } from "@/lib/companyStorageKind";
import { isOfflineCompanyStorage, isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { shouldReadLedgerFromSqliteOnly } from "@/lib/companyStorageKind";
import { shouldUseLocalCloudSync, isEligibleLocalDriveSyncCompanyRow } from "@/lib/localCloudSync/companyConfig";
import { resolveAuthoritativeFirestoreCompanyId } from "@/lib/resolveAuthoritativeFirestoreCompanyId";
import { apkEmbeddedSqliteFirstWritesPreferred } from "@/lib/apkOnlineFirestoreWritePolicy";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyAttachmentUploadEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import {
  companyIdFromStoragePathPrefix,
  buildPendingAttachmentStorageObjectPath,
  buildStoragePathPrefix,
  buildStoragePathPrefixCandidates,
  resolveCompanyUsesPocketLedgerStorage,
} from "@/lib/firebaseStoragePaths";

const STORE = "pendingFiles";
const ATTACHMENT_HOLD_CLIPBOARD_PREFIX = "PL_ATTACH_V1:";

/** Forensic: `NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG=1` â€” pending replace vs append + delete order proof. */
function localPendingFilesForensicEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_ATTACHMENT_FORENSIC_DEBUG === "1";
}

/** Upload ke baad SQLite mirror me final ref (https / drive:) verify. */
async function verifyLocalMirrorHasFieldRef(
  companyId: string,
  collection: string,
  docId: string,
  field: string,
  expectedRef: string
): Promise<boolean> {
  const row = await getCompanyDocFromBrowserDb(companyId, collection, docId, { includeDeleted: true });
  if (!row) return false;
  return fieldValueContainsExactRef(row[field], expectedRef);
}

/** `unassignedFile: { url }` + scalar/array attachment fields. */
function fieldValueContainsExactRef(fieldValue: unknown, expectedRef: string): boolean {
  if (typeof fieldValue === "string") return fieldValue === expectedRef;
  if (Array.isArray(fieldValue)) return fieldValue.some((v) => v === expectedRef);
  if (fieldValue && typeof fieldValue === "object") {
    const url = (fieldValue as { url?: unknown }).url;
    return typeof url === "string" && url === expectedRef;
  }
  return false;
}

function replaceLocalRefInFieldValue(
  fieldValue: unknown,
  localId: string,
  newValue: string
): { next: unknown; matched: boolean } {
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  if (Array.isArray(fieldValue)) {
    const idx = fieldValue.findIndex((v) => v === needle);
    if (idx < 0) return { next: fieldValue, matched: false };
    const arr = [...fieldValue];
    arr[idx] = newValue;
    return { next: arr, matched: true };
  }
  if (typeof fieldValue === "string") {
    if (fieldValue !== needle) return { next: fieldValue, matched: false };
    return { next: newValue, matched: true };
  }
  if (fieldValue && typeof fieldValue === "object") {
    const url = (fieldValue as { url?: unknown }).url;
    if (url === needle) {
      return { next: { ...(fieldValue as Record<string, unknown>), url: newValue }, matched: true };
    }
  }
  return { next: fieldValue, matched: false };
}

async function mirrorUploadedFileUrlToLocalSqlite(
  docPath: string,
  field: string,
  localId: string,
  finalRef: string
): Promise<boolean> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return false;
  const [, companyId, collection, docId] = m;
  const existing = await getCompanyDocFromBrowserDb(companyId!, collection!, docId!, { includeDeleted: true });
  if (!existing) return false;
  const patch: Record<string, unknown> = {};
  const replaced = replaceLocalRefInFieldValue(existing[field], localId, finalRef);
  if (!replaced.matched) return false;
  patch[field] = replaced.next;
  const { upsertCompanyDocInBrowserDb, notifyBrowserDbCollectionUpdated } = await import(
    "@/lib/localCompanyDocMirror"
  );
  await upsertCompanyDocInBrowserDb(
    companyId!,
    collection!,
    docId!,
    { ...existing, ...patch, id: docId },
    { notify: true, force: true }
  );
  notifyBrowserDbCollectionUpdated(companyId!, collection!);
  return verifyLocalMirrorHasFieldRef(companyId!, collection!, docId!, field, finalRef);
}

async function replaceExactAttachmentRefInLocalSqlite(
  docPath: string,
  field: string,
  oldRef: string,
  finalRef: string
): Promise<boolean> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return false;
  const [, companyId, collection, docId] = m;
  const existing = await getCompanyDocFromBrowserDb(companyId!, collection!, docId!, { includeDeleted: true });
  if (!existing) return false;
  const patch: Record<string, unknown> = {};
  const cur = existing[field];
  if (Array.isArray(cur)) {
    const idx = cur.findIndex((v) => v === oldRef);
    if (idx < 0) return false;
    const arr = [...cur];
    arr[idx] = finalRef;
    patch[field] = arr;
  } else if (cur === oldRef) {
    patch[field] = finalRef;
  } else if (cur && typeof cur === "object" && (cur as { url?: unknown }).url === oldRef) {
    patch[field] = { ...(cur as Record<string, unknown>), url: finalRef };
  } else {
    return false;
  }
  const { upsertCompanyDocInBrowserDb, notifyBrowserDbCollectionUpdated } = await import(
    "@/lib/localCompanyDocMirror"
  );
  await upsertCompanyDocInBrowserDb(
    companyId!,
    collection!,
    docId!,
    { ...existing, ...patch, id: docId },
    { notify: true, force: true }
  );
  notifyBrowserDbCollectionUpdated(companyId!, collection!);
  return verifyLocalMirrorHasFieldRef(companyId!, collection!, docId!, field, finalRef);
}

/** Upload ke baad SQLite mirror me HTTPS URL â€” verify hone ke baad hi local blob delete. */
async function verifyLocalMirrorHasHttpsUrl(
  companyId: string,
  collection: string,
  docId: string,
  field: string,
  httpsUrl: string
): Promise<boolean> {
  return verifyLocalMirrorHasFieldRef(companyId, collection, docId, field, httpsUrl);
}

/** Firestore pe HTTPS aa chuka ho lekin SQLite abhi `local:` â€” dubara upload ke bina mirror + delete. */
function resolveHttpsUrlAfterPendingPatch(fieldValue: unknown, localId: string): string | null {
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  const isHttps = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);
  if (typeof fieldValue === "string") {
    if (fieldValue === needle) return null;
    return isHttps(fieldValue) ? fieldValue : null;
  }
  if (Array.isArray(fieldValue)) {
    if (fieldValue.some((v) => v === needle)) return null;
    for (const v of fieldValue) {
      if (isHttps(v)) return v;
    }
  }
  return null;
}

function fieldStillHasLocalPendingRef(fieldValue: unknown, localId: string): boolean {
  return fieldValueContainsExactRef(fieldValue, `${LOCAL_FILE_PREFIX}${localId}`);
}

function firstDriveFileRef(fieldValue: unknown): string | null {
  if (typeof fieldValue === "string" && isDriveFileRef(fieldValue)) return fieldValue;
  if (Array.isArray(fieldValue)) {
    for (const v of fieldValue) {
      if (typeof v === "string" && isDriveFileRef(v)) return v;
    }
  }
  return null;
}

/**
 * Mirror-verify backoff: a pending blob whose HTTPS mirror can't be verified was re-tried every sync cycle
 * (Firestore read + SQLite write + console.warn each time). Exponential backoff per localId: 1m .. 30m.
 */
const mirrorVerifyBackoff = new Map<string, { fails: number; nextAt: number }>();
function mirrorVerifyBackedOff(localId: string): boolean {
  const b = mirrorVerifyBackoff.get(localId);
  return !!b && Date.now() < b.nextAt;
}
function noteMirrorVerifyFail(localId: string): number {
  const prev = mirrorVerifyBackoff.get(localId);
  const fails = (prev?.fails ?? 0) + 1;
  const delay = Math.min(30 * 60_000, 60_000 * 2 ** (fails - 1));
  mirrorVerifyBackoff.set(localId, { fails, nextAt: Date.now() + delay });
  return delay;
}

async function pendingStorageHoldActive(): Promise<boolean> {
  try {
    const { isServerQuotaHoldActive } = await import("@/lib/serverQuotaHold");
    return isServerQuotaHoldActive();
  } catch {
    return false;
  }
}

function isStorageQuotaError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code || "");
  const msg = e instanceof Error ? e.message : String(e);
  return /quota-exceeded|resource-exhausted|quota/i.test(`${code} ${msg}`);
}

/** SQLite mirror ready â†’ tab hi pending bytes hatao (HTTPS load hone ke baad). */
async function removePendingFileAfterMirrorReady(
  localId: string,
  docPath: string,
  field: string,
  httpsUrl: string
): Promise<boolean> {
  const mirrored = await mirrorUploadedFileUrlToLocalSqlite(docPath, field, localId, httpsUrl);
  if (!mirrored) {
    const retryMs = noteMirrorVerifyFail(localId);
    console.warn("[localPendingFiles] kept local blob â€” SQLite HTTPS mirror not verified yet", {
      localId,
      docPath,
      field,
      retryInSec: Math.round(retryMs / 1000),
    });
    return false;
  }
  mirrorVerifyBackoff.delete(localId);
  await removePendingFile(localId);
  return true;
}

/** `companies/{cid}/{col}/{id}` par partial patch â€” direct `updateDoc` ki jagah write gateway. */
async function patchCompanyDocViaGateway(docRef: DocumentReference, patch: Record<string, unknown>): Promise<void> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(docRef.path);
  if (!m) throw new Error(`[localPendingFiles] invalid ref path: ${docRef.path}`);
  const r = await writeEntity({
    companyId: m[1],
    collectionName: m[2],
    docId: m[3],
    operation: "update",
    data: patch,
  });
  if (r.ok === false) throw new Error(r.error);
}

function rowHasLocalAttachmentRefsForPending(data: Record<string, unknown>): boolean {
  for (const key of ["fileUrls", "documentFileUrls"] as const) {
    const arr = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
    if (arr.some((u) => isLocalFileRef(String(u)))) return true;
  }
  for (const key of ["fileUrl", "avatarUrl", "logoUrl"] as const) {
    if (isLocalFileRef(String(data[key] || ""))) return true;
  }
  const unassigned = data.unassignedFile;
  if (unassigned && typeof unassigned === "object") {
    const url = (unassigned as { url?: unknown }).url;
    if (typeof url === "string" && isLocalFileRef(url)) return true;
  }
  return false;
}

/** Pending file target doc — local company SQLite, online company Firestore. */
async function readCompanyDocForPendingSync(
  docPath: string,
  opts?: { includeDeleted?: boolean }
): Promise<Record<string, unknown> | null> {
  const p = String(docPath || "").trim();
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(p);
  if (!m) return null;
  const [, companyId, collection, docId] = m;
  const pathsToTry: string[] = [];
  const seen = new Set<string>();
  const push = async (cid: string) => {
    const id = String(cid || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    pathsToTry.push(`companies/${id}/${collection}/${docId}`);
  };
  await push(companyId!);
  await push(await resolveAuthoritativeFirestoreCompanyId(companyId!));

  for (const path of pathsToTry) {
    const parts = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
    if (!parts) continue;
    const [, cid, coll, did] = parts;
    const reg = await getLocalCompanyById(cid!, { includeDeleted: true });
    const readSqliteMirror =
      (reg &&
        (isOfflineCompanyStorage(reg as { storageOption?: string }) ||
          shouldReadLedgerFromSqliteOnly(reg as Parameters<typeof shouldReadLedgerFromSqliteOnly>[0]))) ||
      apkEmbeddedSqliteFirstWritesPreferred();
    if (readSqliteMirror) {
      const row = (await getCompanyDocFromBrowserDb(cid!, coll!, did!, {
        includeDeleted: opts?.includeDeleted === true,
      })) as Record<string, unknown> | null;
      if (row) return row;
      if (reg && isOfflineCompanyStorage(reg as { storageOption?: string })) continue;
    }
    // Online restore: SQLite me `local:` refs ho, Firestore doc abhi bina files — upload patch ke liye SQLite padho.
    if (reg && isCloudLinkedCompanyStorage(reg as { storageOption?: string; syncedFromCloud?: boolean })) {
      const sqliteRow = (await getCompanyDocFromBrowserDb(cid!, coll!, did!, {
        includeDeleted: opts?.includeDeleted === true,
      })) as Record<string, unknown> | null;
      if (sqliteRow && rowHasLocalAttachmentRefsForPending(sqliteRow)) {
        return sqliteRow;
      }
    }
    const snap = await getDoc(firestoreDocRefFromPath(path));
    if (snap.exists()) return snap.data() as Record<string, unknown>;
  }
  return null;
}

/**
 * Pending patch se pehle target doc â€” recycle-bin (`isDeleted`) par bhi read;
 * doc bilkul nahi mila to queue row hatao taaki Drive sync "Document not found" par na atke.
 */
/**
 * Delete-safety: `local:{id}` abhi kisi copy (SQLite local+authoritative cid, Firestore cache incl. pending SDK write)
 * me hai ya read fail hua => true (bytes KEEP). Sirf confirmed "kahin nahi" par false.
 */
async function pendingLocalRefStillReferenced(
  docPath: string,
  localId: string,
  opts?: { requireServerMissing?: boolean }
): Promise<boolean> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return true;
  const [, companyId, coll, did] = m;
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  try {
    const cids = new Set<string>([companyId!]);
    try {
      cids.add(await resolveAuthoritativeFirestoreCompanyId(companyId!));
    } catch {
      /* ignore */
    }
    for (const cid of cids) {
      if (!cid) continue;
      const row = await getCompanyDocFromBrowserDb(cid, coll!, did!, { includeDeleted: true });
      if (row && JSON.stringify(row).includes(needle)) return true;
      try {
        const cached = await getDocFromCache(doc(firestore, `companies/${cid}/${coll}`, did!));
        if (cached.exists() && (cached.metadata.hasPendingWrites || JSON.stringify(cached.data()).includes(needle))) {
          return true;
        }
      } catch {
        /* not in cache */
      }
      if (opts?.requireServerMissing) {
        const srv = await getDocFromServer(doc(firestore, `companies/${cid}/${coll}`, did!));
        if (srv.exists()) return true;
      }
    }
    return false;
  } catch (e) {
    console.warn("[localPendingFiles] ref check failed - pending blob KEPT", { docPath, localId, e });
    return true;
  }
}

async function resolvePendingTargetDocOrRemoveOrphan(
  docPath: string,
  localId: string
): Promise<Record<string, unknown> | null> {
  if (!isValidPendingSubcollectionDocPath(docPath)) {
    console.warn("[localPendingFiles] pending sync skipped â€” invalid docPath (blob kept for requeue)", {
      docPath,
      localId,
    });
    return null;
  }
  let data = await readCompanyDocForPendingSync(docPath);
  if (!data) {
    data = await readCompanyDocForPendingSync(docPath, { includeDeleted: true });
  }
  if (!data) {
    const companyId = companyIdFromDocPath(docPath);
    const { isLocalAttachmentRestoreHoldActive, readLocalBackupRestoreSelectionGrace } = await import(
      "@/lib/localBackupRestoreCompany"
    );
    // Restore window: vouchers abhi likhe ja rahe hain â€” pending bytes delete mat karo.
    if (
      (companyId && isLocalAttachmentRestoreHoldActive(companyId)) ||
      (companyId && readLocalBackupRestoreSelectionGrace(companyId, 180_000))
    ) {
      console.warn("[localPendingFiles] orphan delete skipped â€” backup restore in progress", {
        docPath,
        localId,
      });
      return null;
    }
    const { isCompanyPendingRestoreCloudPush, readPendingRestoreCloudPush } = await import(
      "@/lib/restoreCloudBackgroundSync"
    );
    const restoreJob = companyId ? readPendingRestoreCloudPush() : null;
    const restoreActive =
      Boolean(companyId) &&
      (isCompanyPendingRestoreCloudPush(companyId) ||
        (restoreJob?.companyId === companyId &&
          (restoreJob.phase === "files" ||
            restoreJob.phase === "sync" ||
            restoreJob.phase === "data" ||
            restoreJob.dataUploaded === true)));
    // Restore window me pending bytes kabhi orphan-delete mat karo —
    // data push ke baad Firestore empty ho sakta hai, SQLite me `local:` abhi bhi zinda.
    if (restoreActive) {
      console.warn("[localPendingFiles] orphan delete skipped — restore cloud push active", {
        docPath,
        localId,
        phase: restoreJob?.phase || null,
        dataUploaded: restoreJob?.dataUploaded ?? null,
      });
      return null;
    }
    if (await pendingLocalRefStillReferenced(docPath, localId, { requireServerMissing: true })) {
      console.warn("[localPendingFiles] orphan delete skipped - doc unconfirmed / local: still referenced (blob kept)", {
        docPath,
        localId,
      });
      return null;
    }
    try {
      await removePendingFile(localId);
    } catch {
      /* ignore */
    }
    console.warn("[localPendingFiles] orphan pending removed — target doc missing", {
      docPath,
      localId,
    });
    return null;
  }
  return data;
}

async function readFirestoreDocForPendingSync(docPath: string): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(firestoreDocRefFromPath(docPath));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * SQLite `local:` + Firestore HTTPS (restore/data push) — dubara upload na ho.
 * Important: jab user ne attachment hata diya (SQLite me `local:{id}` nahi), Firestore ke
 * kisi bhi HTTPS ko is pending id ka mirror mat samjho — warna remove ke baad file wapas aati hai.
 */
function resolveHttpsForPendingFromLocalAndFirestore(
  localField: unknown,
  firestoreField: unknown,
  localId: string
): string | null {
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  const isHttps = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

  // Abhi bhi `local:{id}` hai → sirf usi index / scalar pe Firestore HTTPS accept karo.
  if (fieldStillHasLocalPendingRef(localField, localId)) {
    if (Array.isArray(localField) && Array.isArray(firestoreField)) {
      const idx = localField.findIndex((v) => v === needle);
      if (idx >= 0 && isHttps(firestoreField[idx])) return firestoreField[idx]!;
    }
    if (typeof localField === "string" && localField === needle && isHttps(firestoreField)) {
      return firestoreField;
    }
    if (
      localField &&
      typeof localField === "object" &&
      (localField as { url?: unknown }).url === needle
    ) {
      const fsUrl =
        firestoreField && typeof firestoreField === "object"
          ? (firestoreField as { url?: unknown }).url
          : firestoreField;
      if (isHttps(fsUrl)) return fsUrl;
    }
    return null;
  }

  // Needle gayab: scalar field pe pehle se HTTPS = already mirrored. Array pe guess mat karo.
  if (typeof localField === "string" && isHttps(localField)) return localField;
  if (
    localField &&
    typeof localField === "object" &&
    isHttps((localField as { url?: unknown }).url)
  ) {
    return (localField as { url: string }).url;
  }
  return null;
}

/** `local:uuid` ko Drive URL / Storage URL se replace karke doc patch karo. */
async function patchPendingFileTargetField(
  docPath: string,
  field: string,
  localId: string,
  newValue: string
): Promise<void> {
  const data = await resolvePendingTargetDocOrRemoveOrphan(docPath, localId);
  // Orphan cleanup ho chuka â€” Drive bytes upload ho chuki ho to bhi sync cycle aage badhe.
  if (!data) return;
  const current = data[field];
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  const docRef = firestoreDocRefFromPath(docPath);
  const decodeMarkerLocalSrc = (value: unknown): string | null => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return null;
    const b64 = s.slice(ATTACHMENT_HOLD_CLIPBOARD_PREFIX.length);
    try {
      const json = decodeURIComponent(escape(atob(b64)));
      const obj = JSON.parse(json) as { src?: unknown };
      const src = typeof obj?.src === "string" ? obj.src.trim() : "";
      // Marker payload carries original local ref; match it so we replace instead of append duplicate.
      return src || null;
    } catch {
      return null;
    }
  };
  if (Array.isArray(current)) {
    const arr = [...current];
    const idx = arr.findIndex((v) => {
      if (v === needle) return true;
      const markerSrc = decodeMarkerLocalSrc(v);
      return markerSrc === needle;
    });
    if (idx >= 0) {
      arr[idx] = newValue;
    } else if (arr.includes(newValue)) {
      /* already patched â€” race se duplicate push mat karo */
    } else {
      const orphanLocalIdx = arr.findIndex((v) => {
        if (typeof v !== "string") return false;
        if (isLocalFileRef(v)) return true;
        const markerSrc = decodeMarkerLocalSrc(v);
        return markerSrc === needle;
      });
      if (orphanLocalIdx >= 0) {
        arr[orphanLocalIdx] = newValue;
      } else {
        // User ne ye attachment hata diya (`local:{id}` array me nahi) — HTTPS wapas append mat karo.
        return;
      }
    }
    await patchCompanyDocViaGateway(docRef, { [field]: arr });
    return;
  }
  const replaced = replaceLocalRefInFieldValue(current, localId, newValue);
  if (!replaced.matched) {
    // Scalar already HTTPS / cleared — object field without needle mat overwrite.
    if (current != null && current !== newValue) return;
  }
  await patchCompanyDocViaGateway(docRef, { [field]: replaced.matched ? replaced.next : newValue });
}

/**
 * Restore / force upload: seedha Firestore pe HTTPS likho (writeEntity/outbox skip).
 * Data push `omitLocalFileRefs` se fileUrls hata chuka hota hai — yahan wapas HTTPS set.
 */
function decodeHoldClipboardLocalSrc(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s.startsWith(ATTACHMENT_HOLD_CLIPBOARD_PREFIX)) return null;
  const b64 = s.slice(ATTACHMENT_HOLD_CLIPBOARD_PREFIX.length);
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const obj = JSON.parse(json) as { src?: unknown };
    const src = typeof obj?.src === "string" ? obj.src.trim() : "";
    return src || null;
  } catch {
    return null;
  }
}

async function forcePatchAttachmentHttpsToFirestore(
  docPath: string,
  field: string,
  localId: string,
  httpsUrl: string,
  sourceRow: Record<string, unknown>
): Promise<boolean> {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return false;
  const [, companyId, collectionName, docId] = m;
  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(companyId!);
  const needle = `${LOCAL_FILE_PREFIX}${localId}`;
  const current = sourceRow[field];
  let value: unknown = httpsUrl;
  if (Array.isArray(current)) {
    // Local/source row is authoritative after edit-remove. Do NOT merge all Firestore HTTPS —
    // that re-appends URLs the user already cleared from the doc.
    const idx = current.findIndex((v) => {
      if (v === needle) return true;
      return decodeHoldClipboardLocalSrc(v) === needle;
    });
    if (idx >= 0) {
      value = current.map((v, i) => (i === idx ? httpsUrl : v));
    } else {
      // Needle missing = user removed this attachment (or already upgraded). Never append HTTPS —
      // that undoes edit-remove. Restore heal uses relink while `local:` still present in SQLite.
      return false;
    }
  } else {
    const replaced = replaceLocalRefInFieldValue(current, localId, httpsUrl);
    if (!replaced.matched) {
      if (current != null && current !== needle && decodeHoldClipboardLocalSrc(current) !== needle) {
        return false;
      }
      value = httpsUrl;
    } else {
      value = replaced.next;
    }
  }
  await setDoc(
    doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId!),
    { [field]: value, id: docId },
    { merge: true }
  );
  return true;
}

/**
 * Restore force-upload: doc me `local:{pendingId}` nahi (map miss / id mismatch) lekin
 * field me stranded `local:` hai jiska blob missing — pending id pe remap karke HTTPS patch enable.
 */
async function healForceRestorePendingOntoStrandedLocalRef(
  item: PendingFilePayload,
  preData: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const field = String(item.field || "").trim();
  if (!field) return null;
  const cur = preData[field];
  const strandedIds: string[] = [];
  if (Array.isArray(cur)) {
    for (const v of cur) {
      if (typeof v === "string" && isLocalFileRef(v)) {
        const id = v.slice(LOCAL_FILE_PREFIX.length).trim();
        if (id) strandedIds.push(id);
      }
    }
  } else if (typeof cur === "string" && isLocalFileRef(cur)) {
    const id = cur.slice(LOCAL_FILE_PREFIX.length).trim();
    if (id) strandedIds.push(id);
  } else if (cur && typeof cur === "object") {
    const url = (cur as { url?: unknown }).url;
    if (typeof url === "string" && isLocalFileRef(url)) {
      const id = url.slice(LOCAL_FILE_PREFIX.length).trim();
      if (id) strandedIds.push(id);
    }
  }
  if (!strandedIds.length) return null;

  const pendingNeedle = `${LOCAL_FILE_PREFIX}${item.id}`;
  for (const strandedId of strandedIds) {
    if (strandedId === item.id) {
      return fieldStillHasLocalPendingRef(preData[field], item.id) ? preData : null;
    }
    let hasOwnBlob = false;
    try {
      const blob = await getBlobFromLocalFileRef(`${LOCAL_FILE_PREFIX}${strandedId}`);
      hasOwnBlob = Boolean(blob && blob.size > 0);
    } catch {
      hasOwnBlob = false;
    }
    // Blob pehle se stranded id pe hai → alag file; remap mat karo.
    if (hasOwnBlob) continue;

    const ok = await replaceExactAttachmentRefInLocalSqlite(
      item.docPath,
      field,
      `${LOCAL_FILE_PREFIX}${strandedId}`,
      pendingNeedle
    );
    if (!ok) continue;
    const refreshed = await readCompanyDocForPendingSync(item.docPath, { includeDeleted: true });
    if (refreshed && fieldStillHasLocalPendingRef(refreshed[field], item.id)) {
      console.warn("[localPendingFiles] restore heal: remapped stranded local: to pending id", {
        from: strandedId,
        to: item.id,
        docPath: item.docPath,
        field,
      });
      return refreshed;
    }
  }
  return null;
}

function companyIdFromStoragePrefix(prefix: string | undefined): string | null {
  return companyIdFromStoragePathPrefix(prefix);
}

function companyIdFromDocPath(docPath: string): string | null {
  const m = /^companies\/([^/]+)\//.exec(String(docPath || "").trim());
  return m?.[1] ? m[1] : null;
}

/** Pending upload route: docPath fallback fail ho to bhi storage prefix se company detect karke Drive path force karo. */
export function resolvePendingPayloadCompanyId(item: {
  docPath?: string;
  storagePathPrefix?: string;
}): string | null {
  return companyIdFromDocPath(String(item.docPath || "")) ?? companyIdFromStoragePrefix(item.storagePathPrefix);
}

async function shouldKeepAttachmentsOffFirebase(companyId: string): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  if (await shouldUseLocalCloudSync(cid)) return true;
  if (await isGoogleDriveCloudSyncCompany(cid)) return true;
  const row = await getLocalCompanyById(cid, { includeDeleted: true });
  if (!row) return false;
  if (isOfflineCompanyStorage(row as { storageOption?: string })) return true;
  if (isEligibleLocalDriveSyncCompanyRow(row)) return true;
  return isPureLocalLedgerCompany(row as Parameters<typeof isPureLocalLedgerCompany>[0]);
}

/** @deprecated â€” use shouldKeepAttachmentsOffFirebase */
async function isLocalOnlyPendingAttachmentCompany(companyId: string): Promise<boolean> {
  return shouldKeepAttachmentsOffFirebase(companyId);
}

/** Cloud sync removed â€” pending attachments always use Firebase Storage / native paths. */
export async function resolvePendingAttachmentCloudSyncProvider(
  companyId: string
): Promise<"google_drive" | null> {
  return (await isGoogleDriveCloudSyncCompany(companyId)) ? "google_drive" : null;
}

/** Pending item â†’ device registry company id (Drive upload + SQLite patch). */
export async function resolveRegistryCompanyIdForPendingItem(item: PendingFilePayload): Promise<string | null> {
  const fromPath = resolvePendingPayloadCompanyId(item);
  if (!fromPath) return null;
  const reg = await getLocalCompanyById(fromPath, { includeDeleted: true });
  if (reg) return fromPath;
  const rows = await listLocalCompanies({ includeDeleted: true });
  for (const row of rows) {
    const auth = String((row as Record<string, unknown>).authoritativeCompanyId ?? "").trim();
    if (row.id === fromPath || auth === fromPath) return row.id;
  }
  return fromPath;
}

async function syncOnePendingFileToDrive(
  item: PendingFilePayload,
  preData: Record<string, unknown>,
  registryCompanyId: string
): Promise<{ success: boolean; uploaded?: boolean; error?: string }> {
  try {
    if (!item.blob || item.blob.size <= 0) {
      throw new Error("Pending attachment bytes missing on this device.");
    }
    const docMatch = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(item.docPath || "").trim());
    if (!docMatch) return { success: false, error: "invalid doc path" };
    const [, , collection, docId] = docMatch;
    const reg = await getLocalCompanyById(registryCompanyId, { includeDeleted: true });
    const oldDriveRef = !fieldStillHasLocalPendingRef(preData[item.field], item.id)
      ? firstDriveFileRef(preData[item.field])
      : null;
    if (oldDriveRef) {
      try {
        const { downloadDriveAttachmentBlob } = await import("@/lib/localCloudSync/driveCloudSyncClient");
      const existingBlob = await downloadDriveAttachmentBlob(oldDriveRef, registryCompanyId);
      if (existingBlob && existingBlob.size > 0) {
        await removePendingFile(item.id);
        return { success: true, uploaded: false };
      }
      } catch {
        /* broken Drive ref: re-upload the pending local blob below */
      }
    } else if (!fieldStillHasLocalPendingRef(preData[item.field], item.id)) {
      await removePendingFile(item.id);
      return { success: true, uploaded: false };
    }
    const driveRef = await uploadPendingAttachmentPayloadToDrive({
      companyId: registryCompanyId,
      companyName: typeof reg?.name === "string" ? reg.name : undefined,
      company: (reg ?? null) as Record<string, unknown> | null,
      collection,
      docId,
      field: item.field,
      blob: item.blob,
      contentType: item.contentType,
      fileName: item.fileName,
    });
    if (oldDriveRef) {
      const mirrored = await replaceExactAttachmentRefInLocalSqlite(item.docPath, item.field, oldDriveRef, driveRef);
      if (!mirrored) {
        return {
          success: true,
          uploaded: true,
          error: "Uploaded to Drive; old Drive reference is kept until local mirror can be updated.",
        };
      }
      await removePendingFile(item.id);
      return { success: true, uploaded: true };
    }
    await patchPendingFileTargetField(item.docPath, item.field, item.id, driveRef);
    const deleted = await removePendingFileAfterMirrorReady(item.id, item.docPath, item.field, driveRef);
    if (!deleted) {
      return {
        success: true,
        uploaded: true,
        error: "Uploaded to Drive; local copy kept until this device finishes loading the file.",
      };
    }
    return { success: true, uploaded: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/** Party/Bank/Staff/Item pending sync ke liye bhi yahi ref (pehle sirf vouchers tha). */
const PENDING_SYNC_COLLECTIONS = new Set([
  "vouchers",
  "parties",
  "bank_accounts",
  "staff",
  "items",
  "taxes",
  "expense_accounts",
]);

function isValidPendingSubcollectionDocPath(docPath: string): boolean {
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(docPath || "").trim());
  if (!m) return false;
  return PENDING_SYNC_COLLECTIONS.has(m[2]!);
}

export { isValidPendingSubcollectionDocPath };

export function firestoreDocRefFromPath(docPath: string): DocumentReference {
  const p = String(docPath || "").trim().replace(/^\/+|\/+$/g, "");
  const m = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(p);
  if (!m || !PENDING_SYNC_COLLECTIONS.has(m[2])) {
    throw new Error(`[localPendingFiles] invalid or unsupported docPath: ${docPath}`);
  }
  return doc(firestore, "companies", m[1], m[2], m[3]);
}

/** `@deprecated` â€” `firestoreDocRefFromPath` use karo; vouchers ke liye bhi wahi. */
export function voucherDocRefFromPath(docPath: string): DocumentReference {
  return firestoreDocRefFromPath(docPath);
}

export type PendingFilePayload = {
  id: string;
  blob: Blob;
  contentType: string;
  /** Firestore path e.g. companies/xxx/vouchers/yyy */
  docPath: string;
  /** Field to update e.g. fileUrls (array) or attachmentUrl (string) */
  field: string;
  /** For array fields: replace value at this index. Omit for single string field. */
  arrayIndex?: number;
  /** Storage path prefix e.g. voucher-files/companyId/payment_out */
  storagePathPrefix: string;
  fileName?: string;
  createdAt?: number;
  /** Backup restore: SQLite index missing ho to fail â€” silent skip mat karo. */
  requireSqliteIndex?: boolean;  /** Phase 2 hotfix: this file replaces an existing HTTPS URL (edit-time recompress). After upload + patch,
   * swap old→new everywhere and delete the old Storage object only when no place still uses it. */
  replacesUrl?: string;
};

type PendingFileMeta = {
  replacesUrl?: string;
  docPath: string;
  field: string;
  arrayIndex?: number;
  storagePathPrefix: string;
  fileName?: string;
  createdAt: number;
};

export type LocalFileRefMeta = {
  id: string;
  contentType: string | null;
  fileName?: string;
  filePath?: string;
  fileUri?: string;
  displayUrl?: string;
  size: number;
  createdAt?: number;
  docPath?: string;
  field?: string;
  storagePathPrefix?: string;
};

/** Runtime hot-cache: render/open fast-path ke liye `local:uuid` metadata sync milta rahe. */
const localFileRefMetaRuntimeCache = new Map<string, LocalFileRefMeta>();

export function generateLocalFileId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Prefix for URLs that are still in IndexedDB (to be uploaded when online). */
export const LOCAL_FILE_PREFIX = "local:";

export function isLocalFileRef(url: string): boolean {
  return typeof url === "string" && url.startsWith(LOCAL_FILE_PREFIX);
}

/** Sync lookup: render phase me Promise wait avoid karne ke liye. */
export function getLocalFileRefMetaSync(url: string): LocalFileRefMeta | null {
  if (!isLocalFileRef(url)) return null;
  const localId = url.slice(LOCAL_FILE_PREFIX.length);
  if (!localId) return null;
  return localFileRefMetaRuntimeCache.get(localId) ?? null;
}

/** Shared cache upsert helper taaki preview/open dono same resolved path use karein. */
function setLocalFileRefMetaCache(meta: LocalFileRefMeta | null): void {
  if (!meta?.id) return;
  localFileRefMetaRuntimeCache.set(meta.id, meta);
}

/** App boot warm-up: native pending refs ko runtime cache me preload karo taaki `getLocalFileRefMetaSync` hit mile. */
export async function primeLocalFileRefMetaRuntimeCache(): Promise<void> {
  if (!usesEmbeddedNativeAttachmentStorage()) return;
  try {
    const rows = await listAttachmentFileRefs("pending_file");
    for (const row of rows) {
      if (!row?.id) continue;
      const meta = parsePendingMeta(row.metaJson);
      const fileUri = row.filePath ? await getAttachmentFileUriFromDataDir(row.filePath) : null;
      let displayUrl: string | undefined;
      if (fileUri && isCapacitorNativeApp()) {
        displayUrl = Capacitor.convertFileSrc(fileUri);
      } else if (row.filePath) {
        displayUrl =
          (await electronAttachmentDisplayUrlFromPath(row.filePath, row.contentType)) ?? undefined;
      }
      setLocalFileRefMetaCache({
        id: row.id,
        contentType: row.contentType ?? null,
        fileName: meta?.fileName,
        filePath: row.filePath,
        fileUri: fileUri ?? undefined,
        displayUrl,
        size: Number(row.size || 0),
        createdAt: meta?.createdAt,
        docPath: meta?.docPath,
        field: meta?.field,
        storagePathPrefix: meta?.storagePathPrefix,
      });
    }
  } catch {
    /* cache prime best-effort */
  }
}

/** Capacitor DataDirectory path â€” SQLite me isi string ka reference store hota hai (blob à¤¨à¤¹à¥€à¤‚). */
function pendingFileDataDirPath(id: string, fileName?: string): string {
  const extRaw = String(fileName || "").split(".").pop()?.trim().toLowerCase() || "bin";
  const ext = /^[a-z0-9]{1,10}$/.test(extRaw) ? extRaw : "bin";
  return `attachments/pending/${id}.${ext}`;
}

function safePortableCompanyFolderSegment(value: unknown): string {
  const raw = String(value || "").trim();
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Company";
}

async function pendingFilePortableCompanyDataDirPath(
  id: string,
  fileName: string | undefined,
  docPath: string
): Promise<string> {
  const legacy = pendingFileDataDirPath(id, fileName);
  const companyId = companyIdFromDocPath(docPath);
  if (!companyId) return legacy;
  let companyName = "";
  let ownerEmail: string | null = null;
  try {
    const row = await getLocalCompanyById(companyId, { includeDeleted: true });
    companyName = String(row?.name || "").trim();
    ownerEmail = row?.ownerEmail ? String(row.ownerEmail) : null;
  } catch {
    companyName = "";
  }
  const file = legacy.split("/").pop() || `${id}.bin`;
  const folder = `${safePortableCompanyFolderSegment(companyName || companyId)}__${safePortableCompanyFolderSegment(companyId)}`;
  try {
    const manifest = {
      pocketLedgerCompanyFolder: true,
      version: 1,
      id: companyId,
      name: companyName || companyId,
      ownerEmail,
      createdAtMs: Date.now(),
      note: "Portable company folder. Encryption will be added in a later phase.",
    };
    await writeAttachmentBlobToDataDir(
      `companies/${folder}/company.json`,
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" })
    );
  } catch {
    /* manifest is best-effort; attachment write must continue */
  }
  return `companies/${folder}/pl-attachments/pending/${file}`;
}

function parsePendingMeta(metaJson: string | null): PendingFileMeta | null {
  if (!metaJson) return null;
  try {
    const parsed = JSON.parse(metaJson) as Partial<PendingFileMeta>;
    if (!parsed || !parsed.docPath || !parsed.field || !parsed.storagePathPrefix) return null;
    return {
      docPath: String(parsed.docPath),
      field: String(parsed.field),
      arrayIndex:
        typeof parsed.arrayIndex === "number" && Number.isFinite(parsed.arrayIndex)
          ? parsed.arrayIndex
          : undefined,
      storagePathPrefix: String(parsed.storagePathPrefix),
      fileName: parsed.fileName ? String(parsed.fileName) : undefined,
      replacesUrl: parsed.replacesUrl ? String(parsed.replacesUrl) : undefined,
      createdAt:
        typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
          ? parsed.createdAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Lightweight metadata lookup: preview/open path ko Blob read ke bina local path/uri mile. */
export async function getLocalFileRefMeta(url: string): Promise<LocalFileRefMeta | null> {
  if (!isLocalFileRef(url)) return null;
  const localId = url.slice(LOCAL_FILE_PREFIX.length);
  if (!localId) return null;
  const cached = localFileRefMetaRuntimeCache.get(localId);
  if (cached) return cached;
  if (usesEmbeddedNativeAttachmentStorage()) {
    const row = await getAttachmentFileRef("pending_file", localId);
    if (!row) return null;
    const meta = parsePendingMeta(row.metaJson);
    const fileUri = row.filePath ? await getAttachmentFileUriFromDataDir(row.filePath) : null;
    let displayUrl: string | undefined;
    if (fileUri && isCapacitorNativeApp()) {
      displayUrl = Capacitor.convertFileSrc(fileUri);
    } else if (row.filePath) {
      displayUrl =
        (await electronAttachmentDisplayUrlFromPath(row.filePath, row.contentType)) ?? undefined;
    }
    const mapped: LocalFileRefMeta = {
      id: localId,
      contentType: row.contentType ?? null,
      fileName: meta?.fileName,
      filePath: row.filePath,
      fileUri: fileUri ?? undefined,
      displayUrl,
      size: Number(row.size || 0),
      createdAt: meta?.createdAt,
      docPath: meta?.docPath,
      field: meta?.field,
      storagePathPrefix: meta?.storagePathPrefix,
    };
    setLocalFileRefMetaCache(mapped);
    return mapped;
  }
  const pending = await getPendingFiles();
  const row = pending.find((p) => p.id === localId);
  if (!row) return null;
  const mapped: LocalFileRefMeta = {
    id: localId,
    contentType: row.contentType || row.blob?.type || null,
    fileName: row.fileName,
    size: row.blob?.size || 0,
    createdAt: row.createdAt,
    docPath: row.docPath,
    field: row.field,
    storagePathPrefix: row.storagePathPrefix,
  };
  setLocalFileRefMetaCache(mapped);
  return mapped;
}

type LocalFileReadOptions = {
  /**
   * Preview pipeline guard: native me `Filesystem.readFile` slow JS bridge path avoid karna hai.
   * Isko false karo to native read attempt par hard-fail throw hoga.
   */
  allowNativeRead?: boolean;
  /** Error diagnostics: kis context se read attempt aaya. */
  context?: string;
  /** `drive:` cloud download â€” company registry se Drive resolve. */
  companyId?: string;
};

/** Hot path helper: local:uuid open/preview ke liye full list read avoid. */
async function getPendingFileById(
  localId: string,
  options?: LocalFileReadOptions
): Promise<PendingFilePayload | null> {
  if (!localId?.trim()) return null;
  if (usesEmbeddedNativeAttachmentStorage()) {
    if (options?.allowNativeRead === false) {
      throw new Error(
        `[localPendingFiles] Native read blocked for context=${options?.context || "unknown"}; expected convertFileSrc fast path`
      );
    }
    const row = await getAttachmentFileRef("pending_file", localId);
    if (!row) return null;
    const meta = parsePendingMeta(row.metaJson);
    const blob = await readAttachmentBlobFromDataDir(
      row.filePath,
      row.contentType,
      row.sha256Hex ?? undefined
    );
    if (!blob || blob.size <= 0) return null;
    // Meta incomplete (restore race) â€” preview/open ke liye bytes phir bhi return karo.
    return {
      id: localId,
      blob,
      contentType: row.contentType || blob.type || "application/octet-stream",
      docPath: meta?.docPath || `companies/_/pending/${localId}`,
      field: meta?.field || "fileUrls",
      arrayIndex: meta?.arrayIndex,
      storagePathPrefix: meta?.storagePathPrefix || `companies/_/pending-files`,
      fileName: meta?.fileName,
      createdAt: meta?.createdAt,
    };
  }
  // Direct `get(id)` â€” `getAll` se zyada reliable + race kam (flush/hydrate hot path).
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(localId.trim());
    req.onsuccess = () => {
      db.close();
      const row = req.result as (PendingFilePayload & { createdAt?: number }) | undefined;
      if (!row?.blob) {
        resolve(null);
        return;
      }
      const blob = row.blob;
      if (!(blob instanceof Blob) || blob.size <= 0) {
        resolve(null);
        return;
      }
      resolve({
        id: row.id,
        blob,
        contentType: row.contentType || blob.type || "application/octet-stream",
        docPath: row.docPath,
        field: row.field,
        arrayIndex: row.arrayIndex,
        storagePathPrefix: row.storagePathPrefix,
        fileName: row.fileName,
        createdAt: row.createdAt,
      });
    };
    req.onerror = () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(req.error);
    };
  });
}

/** Preview / open: `local:uuid` â†’ blob (Capacitor: DataDirectory file, web/electron: IndexedDB). */
export async function getBlobFromLocalFileRef(
  url: string,
  options?: LocalFileReadOptions
): Promise<Blob | null> {
  if (isDriveFileRef(url)) {
    try {
      const { downloadDriveAttachmentBlob } = await import("@/lib/localCloudSync/driveCloudSyncClient");
      return await downloadDriveAttachmentBlob(url, options?.companyId);
    } catch {
      return null;
    }
  }
  if (!isLocalFileRef(url)) return null;
  const localId = url.slice(LOCAL_FILE_PREFIX.length);
  if (!localId) return null;
  const item = await getPendingFileById(localId, options);
  return item?.blob ?? null;
}

/** Gallery label + FilePreview `resolvedName` â€” puri pending row (fileName / contentType / blob) */
export async function getPendingPayloadForLocalRef(url: string): Promise<PendingFilePayload | null> {
  if (!isLocalFileRef(url)) return null;
  const localId = url.slice(LOCAL_FILE_PREFIX.length);
  if (!localId) return null;
  return await getPendingFileById(localId);
}

export async function uploadPendingLocalFileRef(
  localFileRef: string,
  storagePathPrefix: string,
  /** Sync cycle ne blob pehle hi padha ho to APK par dobara readFile/fetch avoid. */
  preloaded?: PendingFilePayload | null
): Promise<string> {
  if (isFirebaseLedgerDataSyncDisabled()) return localFileRef;
  if (!isLocalFileRef(localFileRef)) return localFileRef;
  if (await pendingStorageHoldActive()) {
    throw new Error("Server quota pause is active: attachment upload postponed (kept local).");
  }
  const localId = localFileRef.slice(LOCAL_FILE_PREFIX.length);
  if (!localId) return localFileRef;
  const item = preloaded ?? (await getPendingFileById(localId));
  // Missing/corrupt bytes â€” caller ko fail dikhao; silent `local:` return sync "success" jaisa dikhta tha.
  if (!item?.blob || item.blob.size <= 0) {
    throw new Error(
      "Pending attachment could not be read on this device. Re-open the file or re-attach, then save and sync again."
    );
  }

  const docMatch = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(item.docPath || "").trim());
  const targetCompanyId = resolvePendingPayloadCompanyId(item);
  void docMatch;
  void targetCompanyId;

  // Upload one local file ref and return its final public URL for caller-side payload replacement.
  const storagePath = buildPendingAttachmentStorageObjectPath({
    storagePathPrefix,
    pendingFileId: item.id,
    fileName: item.fileName,
  });
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, item.blob, { contentType: item.contentType || "application/octet-stream" });
  const url = await getDownloadURL(storageRef);
  await patchPendingFileTargetField(item.docPath, item.field, item.id, url);
  const deleted = await removePendingFileAfterMirrorReady(item.id, item.docPath, item.field, url);
  if (!deleted && localPendingFilesForensicEnabled()) {
    console.warn("[FORENSIC_PENDING_UPLOAD]", {
      phase: "uploadPendingLocalFileRef",
      localId: item.id,
      step: "KEPT_LOCAL_BLOB_UNTIL_SQLITE_HTTPS",
    });
  }
  if (deleted && localPendingFilesForensicEnabled()) {
    console.warn("[FORENSIC_PENDING_UPLOAD]", {
      phase: "uploadPendingLocalFileRef",
      localId: item.id,
      step: "AFTER_REMOVE_PENDING_FILE_COMPLETE",
      pendingBytesDeleted: true,
    });
  }
  return url;
}

export type PutPendingFileOptions = {
  /** Server receive path â€” remote `POST /__pl_attachment` must not re-enqueue upload. */
  skipPlServerAttachmentUploadEnqueue?: boolean;
};

/**
 * PL staff / local: save ke turant baad FilePreview spinner â†’ generic FILE avoid â€”
 * blob URL + offline cache + hover LRU seed (host upload ke pehle hi).
 */
async function seedPendingAttachmentPreviewUi(
  localId: string,
  blob: Blob,
  displayUrl?: string | null
): Promise<void> {
  const id = String(localId || "").trim();
  if (!id || !blob?.size) return;
  const localRef = `${LOCAL_FILE_PREFIX}${id}`;
  let url = String(displayUrl || "").trim();
  if (!url && typeof URL !== "undefined") {
    try {
      url = URL.createObjectURL(blob);
    } catch {
      url = "";
    }
  }
  if (url) {
    const prev = localFileRefMetaRuntimeCache.get(id);
    if (prev && !prev.displayUrl) {
      setLocalFileRefMetaCache({ ...prev, displayUrl: url });
    }
    try {
      const { rememberHoverBlobUrl } = await import("@/lib/attachmentHoverBlobCache");
      rememberHoverBlobUrl(localRef, url);
      // `::cell-thumb` = <img> thumb only. PDF/other blobs: ledger/FilePreview build a raster themselves.
      if (String(blob.type || "").toLowerCase().startsWith("image/")) {
        rememberHoverBlobUrl(`${localRef}::cell-thumb`, url);
      }
    } catch {
      /* preview optional */
    }
  }
  try {
    const { seedOfflineAttachmentCacheFromBlob } = await import("@/lib/offlineAttachmentUrlCache");
    await seedOfflineAttachmentCacheFromBlob(localRef, blob);
  } catch {
    /* cache optional */
  }
  try {
    const { markAttachmentUrlReady, requestAttachmentUiRefresh } = await import("@/lib/attachmentLoadReady");
    markAttachmentUrlReady(localRef);
    requestAttachmentUiRefresh();
  } catch {
    /* ui optional */
  }
}

export async function putPendingFile(
  payload: PendingFilePayload,
  options?: PutPendingFileOptions
): Promise<void> {
  const createdAt = payload.createdAt ?? Date.now();
  const normalizedContentType = inferAttachmentContentTypeFromName(
    payload.fileName,
    payload.contentType || payload.blob?.type
  );
  const normalizedPayload: PendingFilePayload = {
    ...payload,
    contentType: normalizedContentType,
  };
  if (usesEmbeddedNativeAttachmentStorage()) {
    // APK/EXE: bytes disk par; SQLite me path/meta row.
    const path = await pendingFilePortableCompanyDataDirPath(
      normalizedPayload.id,
      normalizedPayload.fileName,
      normalizedPayload.docPath
    );
    const ok = await writeAttachmentBlobToDataDir(path, normalizedPayload.blob);
    if (!ok) throw new Error("Failed to persist pending attachment on device storage");
    const sha256Hex = await computeSha256HexFromBlob(normalizedPayload.blob);
    const meta: PendingFileMeta = {
      docPath: normalizedPayload.docPath,
      field: normalizedPayload.field,
      arrayIndex: normalizedPayload.arrayIndex,
      storagePathPrefix: normalizedPayload.storagePathPrefix,
      fileName: normalizedPayload.fileName,
      replacesUrl: normalizedPayload.replacesUrl,
      createdAt,
    };
    await upsertAttachmentFileRef(
      {
        scope: "pending_file",
        id: normalizedPayload.id,
        filePath: path,
        contentType: normalizedPayload.contentType,
        size: normalizedPayload.blob.size || 0,
        metaJson: JSON.stringify(meta),
        updatedAt: createdAt,
        sha256Hex,
      },
      { required: normalizedPayload.requireSqliteIndex === true }
    );
    const fileUri = await getAttachmentFileUriFromDataDir(path);
    let displayUrl: string | undefined;
    if (fileUri && isCapacitorNativeApp()) {
      displayUrl = Capacitor.convertFileSrc(fileUri);
    } else {
      displayUrl = (await electronAttachmentDisplayUrlFromPath(path, normalizedPayload.contentType)) ?? undefined;
    }
    if (!displayUrl && typeof URL !== "undefined" && normalizedPayload.blob?.size) {
      try {
        displayUrl = URL.createObjectURL(normalizedPayload.blob);
      } catch {
        displayUrl = undefined;
      }
    }
    setLocalFileRefMetaCache({
      id: normalizedPayload.id,
      contentType: normalizedPayload.contentType,
      fileName: normalizedPayload.fileName,
      filePath: path,
      fileUri: fileUri ?? undefined,
      displayUrl,
      size: normalizedPayload.blob.size || 0,
      createdAt,
      docPath: normalizedPayload.docPath,
      field: normalizedPayload.field,
      storagePathPrefix: normalizedPayload.storagePathPrefix,
    });
    await seedPendingAttachmentPreviewUi(normalizedPayload.id, normalizedPayload.blob, displayUrl);
    if (!options?.skipPlServerAttachmentUploadEnqueue) {
      const { enqueuePlServerAttachmentUpload } = await import("@/lib/plServerAttachmentUploadQueue");
      enqueuePlServerAttachmentUpload(normalizedPayload);
    }
    return;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const row = { ...normalizedPayload, createdAt };
    store.put(row);
    tx.oncomplete = () => {
      db.close();
      // Web: blob URL seed â€” FilePreview `immediateLocalInfo` + hover LRU (IDB read race avoid).
      let displayUrl: string | undefined;
      if (typeof URL !== "undefined" && normalizedPayload.blob?.size) {
        try {
          displayUrl = URL.createObjectURL(normalizedPayload.blob);
        } catch {
          displayUrl = undefined;
        }
      }
      setLocalFileRefMetaCache({
        id: normalizedPayload.id,
        contentType: normalizedPayload.contentType,
        fileName: normalizedPayload.fileName,
        displayUrl,
        size: normalizedPayload.blob.size || 0,
        createdAt,
        docPath: normalizedPayload.docPath,
        field: normalizedPayload.field,
        storagePathPrefix: normalizedPayload.storagePathPrefix,
      });
      void seedPendingAttachmentPreviewUi(normalizedPayload.id, normalizedPayload.blob, displayUrl);
      if (!options?.skipPlServerAttachmentUploadEnqueue) {
        void import("@/lib/plServerAttachmentUploadQueue").then(({ enqueuePlServerAttachmentUpload }) => {
          enqueuePlServerAttachmentUpload(normalizedPayload);
        });
      }
      resolve();
    };
    tx.onerror = () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(tx.error);
    };
  });
}

/**
 * Backup restore: har file ek-ek karke pl-attachments (EXE/APK) ya IDB me likho,
 * phir SQLite index turant flush â€” agla file / reload se pehle bytes safe rahein.
 */
export async function saveRestoredAttachmentFile(payload: PendingFilePayload): Promise<string> {
  // Restore ke dauran PL/Firebase upload queue mat chalao â€” orphan sync bytes delete kar deta tha.
  await putPendingFile(
    { ...payload, requireSqliteIndex: true },
    { skipPlServerAttachmentUploadEnqueue: true }
  );
  const localRef = `${LOCAL_FILE_PREFIX}${payload.id}`;
  if (usesEmbeddedNativeAttachmentStorage()) {
    const row = await getAttachmentFileRef("pending_file", payload.id);
    if (!row?.filePath) {
      throw new Error(
        `Restore could not index attachment "${payload.fileName || payload.id}" in local database`
      );
    }
    const blob = await readAttachmentBlobFromDataDir(
      row.filePath,
      row.contentType,
      row.sha256Hex ?? undefined
    );
    if (!blob || blob.size <= 0) {
      throw new Error(
        `Restore could not verify attachment bytes on disk for "${payload.fileName || payload.id}"`
      );
    }
    const { flushPendingBrowserDbSave } = await import("@/lib/localSqlite");
    await flushPendingBrowserDbSave();
    return localRef;
  }
  const pending = await getPendingFileById(payload.id);
  if (!pending?.blob || pending.blob.size <= 0) {
    throw new Error(`Restore could not verify attachment blob for "${payload.fileName || payload.id}"`);
  }
  return localRef;
}

export async function getPendingFiles(): Promise<PendingFilePayload[]> {
  if (usesEmbeddedNativeAttachmentStorage()) {
    const rows = await listAttachmentFileRefs("pending_file");
    const out: PendingFilePayload[] = [];
    for (const row of rows) {
      const meta = parsePendingMeta(row.metaJson);
      if (!meta) continue;
      const blob = await readAttachmentBlobFromDataDir(
        row.filePath,
        row.contentType,
        row.sha256Hex ?? undefined
      );
      if (!blob || blob.size <= 0) continue;
      out.push({
        id: row.id,
        blob,
        contentType: row.contentType || blob.type || "application/octet-stream",
        docPath: meta.docPath,
        field: meta.field,
        arrayIndex: meta.arrayIndex,
        storagePathPrefix: meta.storagePathPrefix,
        fileName: meta.fileName,
        replacesUrl: meta.replacesUrl,
        createdAt: meta.createdAt,
      });
    }
    return out;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function removePendingFile(id: string): Promise<void> {
  console.warn("[localPendingFiles] removePendingFile", id, new Error("caller").stack?.split("\n").slice(2, 5).join(" | "));
  if (localPendingFilesForensicEnabled()) {
    console.warn("[FORENSIC_PENDING_REMOVE]", {
      phase: "removePendingFile_start",
      localId: id,
      note: "pending_bytes_deleted_here_SQLite_mirror_update_is_separate_async",
      navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  }
  if (usesEmbeddedNativeAttachmentStorage()) {
    const row = await getAttachmentFileRef("pending_file", id);
    if (row?.filePath) await deleteAttachmentBlobFromDataDir(row.filePath);
    await deleteAttachmentFileRef("pending_file", id);
    localFileRefMetaRuntimeCache.delete(id);
    if (localPendingFilesForensicEnabled()) {
      console.warn("[FORENSIC_PENDING_REMOVE]", {
        phase: "removePendingFile_done_native",
        localId: id,
        hadFilePath: Boolean(row?.filePath),
      });
    }
    return;
  }
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  // Web/electron path me bhi stale cache clean.
  localFileRefMetaRuntimeCache.delete(id);
  if (localPendingFilesForensicEnabled()) {
    console.warn("[FORENSIC_PENDING_REMOVE]", { phase: "removePendingFile_done_indexeddb", localId: id });
  }
}

/**
 * Upload one pending file to Storage and update Firestore doc.
 * Local blob tab hi delete jab SQLite me HTTPS URL verify ho jaye.
 */
export async function syncOnePendingFile(
  item: PendingFilePayload,
  options?: { forceUploadPendingBlob?: boolean }
): Promise<{ success: boolean; uploaded?: boolean; error?: string }> {
  try {
    const pendingCompanyId = resolvePendingPayloadCompanyId(item);
    const registryCompanyId =
      (pendingCompanyId ? await resolveRegistryCompanyIdForPendingItem(item) : null) ?? pendingCompanyId;
    // Pocket Ledger Server (PocketBase) company: the outbox push uploads its files (never Firebase Storage).
    if (registryCompanyId && isPocketBaseCompanyId(registryCompanyId)) {
      return { success: false, uploaded: false, error: "Pocket Ledger Server company: file uploads with its data sync." };
    }
    const driveSync = registryCompanyId
      ? (await resolvePendingAttachmentCloudSyncProvider(registryCompanyId)) === "google_drive"
      : false;
    if (!driveSync && isFirebaseLedgerDataSyncDisabled()) {
      return { success: false, uploaded: false, error: "Cloud data sync is off: attachment upload skipped." };
    }
    if (!driveSync && !options?.forceUploadPendingBlob && (await pendingStorageHoldActive())) {
      // Quota pause: no Firestore read, no Storage getDownloadURL/uploadBytes. Blob stays local.
      return { success: false, uploaded: false, error: "Server quota pause is active: attachment kept local." };
    }
    if (mirrorVerifyBackedOff(item.id)) {
      return { success: false, uploaded: false, error: "Attachment mirror verify backing off; will retry later." };
    }
    // Quota hold ke BAAD orphan check - pehle chalta tha to quota me doc read miss = blob delete.
    const preData = await resolvePendingTargetDocOrRemoveOrphan(item.docPath, item.id);
    if (!preData) {
      return { success: true, uploaded: false };
    }
    const keepOffFirebase = registryCompanyId
      ? await shouldKeepAttachmentsOffFirebase(registryCompanyId)
      : false;
    if (keepOffFirebase && registryCompanyId) {
      if (driveSync) {
        return syncOnePendingFileToDrive(item, preData, registryCompanyId);
      }
      return {
        success: false,
        uploaded: false,
        error: "Attachment kept pending because Drive sync is not active for this local company.",
      };
    }

    let workingRow = preData;
    let localStillHasPendingRef = fieldStillHasLocalPendingRef(workingRow[item.field], item.id);
    const fsData = await readFirestoreDocForPendingSync(item.docPath);
    const existingHttps = resolveHttpsForPendingFromLocalAndFirestore(
      workingRow[item.field],
      fsData?.[item.field],
      item.id
    );
    if (existingHttps) {
      // Sirf jab SQLite me abhi `local:{id}` ho — warna HTTPS wapas likhne se remove undo ho jata hai.
      if (localStillHasPendingRef) {
        await removePendingFileAfterMirrorReady(item.id, item.docPath, item.field, existingHttps);
      } else {
        try {
          await removePendingFile(item.id);
        } catch {
          /* ignore */
        }
      }
      return { success: true, uploaded: false };
    }

    if (!localStillHasPendingRef) {
      const hasBlob = Boolean(item.blob && item.blob.size > 0);
      if (!options?.forceUploadPendingBlob || !hasBlob) {
        if (await pendingLocalRefStillReferenced(item.docPath, item.id)) {
          console.warn("[localPendingFiles] no-ref delete skipped - local: still in SQLite/Firestore cache (blob kept)", {
            docPath: item.docPath,
            localId: item.id,
          });
          return { success: false, uploaded: false, error: "Pending ref still referenced; kept." };
        }
        // User ne attachment hata diya / doc se local: clear — orphan pending blob drop.
        try {
          await removePendingFile(item.id);
        } catch {
          /* ignore */
        }
        return { success: true, uploaded: false };
      }
      // Restore force: stranded `local:` (alag id, blob missing) → pending id pe remap, phir normal HTTPS patch.
      // Pehle orphan bucket upload bina doc link ke — HTTPS miss + delete fail.
      const healed = await healForceRestorePendingOntoStrandedLocalRef(item, workingRow);
      if (!healed) {
        console.warn(
          "[localPendingFiles] restore force-upload blocked: no stranded local: target to link HTTPS",
          { id: item.id, docPath: item.docPath, field: item.field }
        );
        return {
          success: false,
          uploaded: false,
          error: "Pending attachment has no matching local: field to write HTTPS URL.",
        };
      }
      workingRow = healed;
      localStillHasPendingRef = fieldStillHasLocalPendingRef(workingRow[item.field], item.id);
      if (!localStillHasPendingRef) {
        return {
          success: false,
          uploaded: false,
          error: "Restore heal remapped local: but target field still missing pending id.",
        };
      }
    }

    const preferredPrefix = String(item.storagePathPrefix || "").trim() || "attachments";
    const mDoc = /^companies\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(item.docPath || "").trim());
    const collectionName = mDoc?.[2] || "vouchers";
    const cidForPath =
      resolvePendingPayloadCompanyId(item) ||
      companyIdFromStoragePathPrefix(preferredPrefix) ||
      mDoc?.[1] ||
      "";
    const voucherType =
      collectionName === "vouchers"
        ? String((workingRow as { type?: unknown }).type || "journal").trim() || "journal"
        : undefined;

    // Online restore / pocket-ledger company: kabhi legacy companies|voucher-files pe mat bhejo.
    let forcePocketLedger = preferredPrefix.startsWith("pocket-ledger/");
    if (!forcePocketLedger && cidForPath) {
      try {
        forcePocketLedger =
          (await resolveCompanyUsesPocketLedgerStorage(cidForPath)) ||
          options?.forceUploadPendingBlob === true;
      } catch {
        forcePocketLedger = options?.forceUploadPendingBlob === true;
      }
    } else if (options?.forceUploadPendingBlob === true) {
      forcePocketLedger = true;
    }

    let effectivePreferred = preferredPrefix;
    if (forcePocketLedger && cidForPath && !preferredPrefix.startsWith("pocket-ledger/")) {
      effectivePreferred = buildStoragePathPrefix({
        companyId: cidForPath,
        usePocketLedger: true,
        collectionName,
        fieldKey: item.field || "fileUrls",
        voucherType,
      });
    }

    let prefixCandidates = [
      effectivePreferred,
      ...buildStoragePathPrefixCandidates({
        companyId: cidForPath,
        usePocketLedger: forcePocketLedger,
        collectionName,
        fieldKey: item.field || "fileUrls",
        voucherType,
      }),
    ].filter((p, i, a) => p && a.indexOf(p) === i);

    if (forcePocketLedger) {
      prefixCandidates = prefixCandidates.filter((p) => p.startsWith("pocket-ledger/"));
      if (!prefixCandidates.length && cidForPath) {
        prefixCandidates = [
          buildStoragePathPrefix({
            companyId: cidForPath,
            usePocketLedger: true,
            collectionName,
            fieldKey: item.field || "fileUrls",
            voucherType,
          }),
        ];
      }
    }

    let url: string | null = null;
    let usedPrefix = effectivePreferred;
    let lastUploadError: unknown = null;
    let sawPermissionDenied = false;
    for (const prefix of prefixCandidates) {
      const storagePath = buildPendingAttachmentStorageObjectPath({
        storagePathPrefix: prefix,
        pendingFileId: item.id,
        fileName: item.fileName,
      });
      const storageRef = ref(storage, storagePath);
      try {
        // Pehle se bucket me ho (restore retry) — overwrite skip, sirf URL lo.
        try {
          url = await getDownloadURL(storageRef);
        } catch {
          await uploadBytes(storageRef, item.blob, {
            contentType: item.contentType || "application/octet-stream",
          });
          url = await getDownloadURL(storageRef);
        }
        usedPrefix = prefix;
        lastUploadError = null;
        break;
      } catch (e) {
        lastUploadError = e;
        if (isStorageQuotaError(e)) {
          try {
            const { startServerQuotaHold } = await import("@/lib/serverQuotaHold");
            startServerQuotaHold();
          } catch {
            /* ignore */
          }
          throw e;
        }
        const code = String((e as { code?: string })?.code || "");
        const msg = e instanceof Error ? e.message : String(e);
        const permission =
          /storage\/unauthorized|permission-denied|403/i.test(`${code} ${msg}`);
        if (!permission) throw e;
        sawPermissionDenied = true;
        console.warn("[localPendingFiles] storage write denied — trying next pocket-ledger prefix", {
          id: item.id,
          prefix,
          code,
        });
      }
    }
    if (!url) {
      if (forcePocketLedger && sawPermissionDenied) {
        throw new Error(
          "Firebase Storage blocked pocket-ledger/ writes. Deploy storage.rules (pocket-ledger match), then retry restore / attachment upload."
        );
      }
      throw lastUploadError instanceof Error
        ? lastUploadError
        : new Error("Attachment upload failed for all storage path prefixes.");
    }
    if (usedPrefix !== preferredPrefix) {
      try {
        await putPendingFile({ ...item, storagePathPrefix: usedPrefix });
        item.storagePathPrefix = usedPrefix;
      } catch {
        /* best-effort — upload already succeeded */
      }
    }

    // Upload ke baad HTTPS docs me likho — sirf jab `local:{id}` abhi field me hai (upar guard).
    let patchedRemote = false;
    let patchedLocal = false;
    try {
      await patchPendingFileTargetField(item.docPath, item.field, item.id, url);
      // Gateway patch no-ops silently when needle gone — verify via SQLite mirror below.
    } catch (e) {
      console.warn("[localPendingFiles] patch after upload failed", item.id, e);
    }
    try {
      patchedRemote = await forcePatchAttachmentHttpsToFirestore(
        item.docPath,
        item.field,
        item.id,
        url,
        workingRow
      );
    } catch (e) {
      console.warn("[localPendingFiles] direct Firestore HTTPS patch failed", item.id, e);
    }
    try {
      patchedLocal = await mirrorUploadedFileUrlToLocalSqlite(item.docPath, item.field, item.id, url);
    } catch {
      /* best-effort */
    }

    // Pending bytes tabhi hatao jab HTTPS docs me likh chuka — warna bucket+local: stuck.
    if (!patchedRemote && !patchedLocal) {
      return {
        success: false,
        uploaded: true,
        error: "Uploaded to Storage but HTTPS URL was not written to docs yet.",
      };
    }
    try {
      await removePendingFile(item.id);
    } catch {
      /* ignore */
    }

    // Phase 2 hotfix: 'replace old URL' kind (edit-time recompress whose re-upload failed earlier).
    if (item.replacesUrl && /^https?:\/\//i.test(item.replacesUrl) && item.replacesUrl !== url) {
      try {
        const swapCompanyId = registryCompanyId || pendingCompanyId;
        if (swapCompanyId) {
          const { rewriteCompanyHttpsAttachmentUrlEverywhere } = await import(
            "@/lib/rewriteCompanyHttpsAttachmentUrl"
          );
          // Same rule as rewriteCompanyHttpsAttachmentUrl.ts: deletes old bytes only when remainingOldUsage === 0.
          await rewriteCompanyHttpsAttachmentUrlEverywhere({
            companyId: swapCompanyId,
            fromUrl: item.replacesUrl,
            toUrl: url,
          });
        }
      } catch (e) {
        console.warn("[localPendingFiles] replace-old-url swap failed (old file kept)", item.id, e);
      }
    }

    if (localPendingFilesForensicEnabled()) {
      console.warn("[FORENSIC_PENDING_SYNC_ONE]", {
        phase: "syncOnePendingFile",
        localId: item.id,
        step: "AFTER_REMOVE_PENDING_FILE_COMPLETE",
        pendingBytesDeleted: true,
        success: true,
        patchedRemote,
        patchedLocal,
        storagePathPrefix: usedPrefix,
      });
    }
    return { success: true, uploaded: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (localPendingFilesForensicEnabled()) {
      console.warn("[FORENSIC_PENDING_SYNC_ONE]", {
        phase: "syncOnePendingFile",
        localId: item.id,
        success: false,
        error: msg,
      });
    }
    return { success: false, error: msg };
  }
}

/**
 * Sync all pending files to Storage and update Firestore docs. Call when online.
 */
export async function syncPendingFiles(options?: {
  /** Only upload pending files whose `local:` ref is in this list (voucher save: do not drain unrelated pending files). */
  onlyLocalRefs?: string[];
}): Promise<{
  synced: number;
  uploaded: number;
  failed: number;
  /** Pehla failure reason â€” mobile sync status UI me generic count ke saath detail. */
  lastError?: string;
}> {
  if (isFirebaseLedgerDataSyncDisabled()) {
    return { synced: 0, uploaded: 0, failed: 0 };
  }
  // Phase 2 hotfix: quota / billing pause — keep files pending, retry after the hold ends.
  {
    const { isServerQuotaHoldActive } = await import("@/lib/serverQuotaHold");
    if (isServerQuotaHoldActive()) return { synced: 0, uploaded: 0, failed: 0 };
  }
  const allPending = await getPendingFiles();
  const onlyRefs = options?.onlyLocalRefs?.length ? new Set(options.onlyLocalRefs) : null;
  const pending = onlyRefs ? allPending.filter((item) => onlyRefs.has(LOCAL_FILE_PREFIX + String(item.id))) : allPending;
  let synced = 0;
  let uploaded = 0;
  let failed = 0;
  let lastError: string | undefined;
  const syncOne = async (item: (typeof pending)[number]) => {
    const itemCompanyId = resolvePendingPayloadCompanyId(item);
    if (itemCompanyId && !isFirebaseLedgerCompanyAttachmentUploadEnabled(itemCompanyId)) return;
    const result = await syncOnePendingFile(item);
    if (result.success) {
      synced++;
      if (result.uploaded) uploaded++;
    }
    else {
      failed++;
      if (!lastError && result.error) lastError = result.error;
      if (result.error) {
        try {
          const { reportOnlineTriggerQuotaExceeded } = await import("@/lib/onlineTriggerLog");
          reportOnlineTriggerQuotaExceeded(result.error);
        } catch {
          /* ignore */
        }
      }
    }
  };
  if (onlyRefs) {
    // A voucher has only a few files: upload them in parallel.
    await Promise.all(pending.map(syncOne));
  } else {
    for (const item of pending) await syncOne(item);
  }
  return { synced, uploaded, failed, lastError };
}

/** Drive sync cycle â€” sirf is company ke pending attachments/avatars upload karo. */
async function resolveCompanyTargetAliases(companyId: string): Promise<Set<string>> {
  const cid = String(companyId || "").trim();
  const targetAliases = new Set<string>();
  if (!cid) return targetAliases;
  targetAliases.add(cid);
  try {
    const reg = await getLocalCompanyById(cid, { includeDeleted: true });
    const auth = String((reg as Record<string, unknown> | null)?.authoritativeCompanyId ?? "").trim();
    if (auth) targetAliases.add(auth);
    const all = await listLocalCompanies({ includeDeleted: true });
    for (const row of all) {
      const rid = String(row.id || "").trim();
      const rauth = String((row as Record<string, unknown>).authoritativeCompanyId ?? "").trim();
      if (
        targetAliases.has(rid) ||
        (rauth && targetAliases.has(rauth)) ||
        (rid && auth && rid === auth) ||
        (rauth && rauth === cid)
      ) {
        if (rid) targetAliases.add(rid);
        if (rauth) targetAliases.add(rauth);
      }
    }
  } catch {
    /* keep primary id only */
  }
  return targetAliases;
}

export async function listPendingFilesForCompany(companyId: string): Promise<PendingFilePayload[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const targetAliases = await resolveCompanyTargetAliases(cid);
  const pending = await getPendingFiles();
  return pending.filter((item) => {
    const itemCompanyId = resolvePendingPayloadCompanyId(item) ?? "";
    return itemCompanyId && targetAliases.has(itemCompanyId);
  });
}

export async function countPendingFilesForCompany(companyId: string): Promise<number> {
  return (await listPendingFilesForCompany(companyId)).length;
}

export async function syncPendingFilesForCompany(
  companyId: string,
  options?: {
    onProgress?: (done: number, total: number, fileName?: string) => void;
    /** Online restore: Firestore data push strips `local:` — still upload pending bytes. */
    forceUploadPendingBlob?: boolean;
  }
): Promise<{
  synced: number;
  uploaded: number;
  failed: number;
  lastError?: string;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { synced: 0, uploaded: 0, failed: 0 };
  const driveSync = (await resolvePendingAttachmentCloudSyncProvider(cid)) === "google_drive";
  if (!driveSync && isFirebaseLedgerDataSyncDisabled()) {
    return { synced: 0, uploaded: 0, failed: 0 };
  }
  if (!driveSync && !isFirebaseLedgerCompanyAttachmentUploadEnabled(cid)) {
    return { synced: 0, uploaded: 0, failed: 0 };
  }
  const items = await listPendingFilesForCompany(cid);
  const total = items.length;
  let synced = 0;
  let uploaded = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    options?.onProgress?.(uploaded, total, item.fileName);
    const result = await syncOnePendingFile(item, {
      forceUploadPendingBlob: options?.forceUploadPendingBlob,
    });
    if (result.success) {
      synced++;
      if (result.uploaded) uploaded++;
    }
    else {
      failed++;
      if (!lastError && result.error) lastError = result.error;
    }
    options?.onProgress?.(uploaded, total, item.fileName);
  }
  return { synced, uploaded, failed, lastError };
}
