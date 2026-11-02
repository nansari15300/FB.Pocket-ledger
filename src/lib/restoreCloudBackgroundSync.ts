"use client";

/**
 * Cloud restore: SQLite + reload (BackupRestore) → data upload (progress) → reload → attachments background.
 */

import { setDoc, writeBatch } from "@/lib/writeGateway/pbWrites";
import { collection, doc, limit, query, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { COLLECTIONS_TO_BACKUP } from "@/lib/companyBackupCore";
import { getLocalCompanyById, upsertLocalCompany } from "@/lib/localCompanyStore";
import { forceUploadLocalCompanyToServer } from "@/lib/forceUploadLocalCompanyToServer";
import { bumpLocalCompanyRegistry } from "@/lib/applyStripePlanToLocalCompany";
import {
  FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT,
  replaceFirebaseLedgerCompanySyncEntries,
} from "@/lib/firebaseLedgerCompanySyncPrefs";
import { setFirebaseLedgerDataSyncEnabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import {
  readCompanyInterCompanyCode,
} from "@/lib/interCompany/interCompanyCompanyCode";
import { sharedWithEmailsLowerFromList } from "@/lib/sharedWithEmailsQuery";
import { pocketLedgerStorageDocFields } from "@/lib/firebaseStoragePaths";

const STORAGE_KEY = "pl_pending_restore_cloud_push_v1";
const PROGRESS_STORAGE_KEY = "pl_restore_cloud_push_progress_v1";
const UPLOAD_LEADER_KEY = "pl_restore_cloud_upload_leader_v1";
const TAB_ID_KEY = "pl_restore_tab_id";
const LEADER_STALE_MS = 14_000;

export const RESTORE_CLOUD_PUSH_PROGRESS_EVENT = "pl-restore-cloud-push-progress";
export const RESTORE_CLOUD_VOUCHERS_REFRESH_EVENT = "pl-restore-cloud-vouchers-refresh";
export const RESTORE_CLOUD_PUSH_JOB_EVENT = "pl-restore-cloud-push-job";

export type RestoreCloudPushPhase = "data" | "files" | "sync";

export type PendingRestoreCloudPush = {
  companyId: string;
  ownerUid: string;
  ownerEmail: string;
  companyName: string;
  replaceCurrent: boolean;
  /** With attachments overwrite — files phase se pehle storage wipe. */
  restoreWithAttachments?: boolean;
  storageFolderCleared?: boolean;
  createdAtMs: number;
  phase?: RestoreCloudPushPhase;
  dataUploaded?: boolean;
  /** Files phase: total attachment count (persisted — new tab resumes same %). */
  filesTotal?: number;
  /** Files already uploaded to cloud (persisted across tabs / refresh). */
  filesUploaded?: number;
};

export type RestoreCloudPushProgressState = {
  companyId: string;
  companyName: string;
  phase: RestoreCloudPushPhase;
  phaseLabel: string;
  done: number;
  total: number;
  percent: number;
  status: "running" | "complete" | "failed" | "paused";
  message?: string;
};

function writeProgress(state: RestoreCloudPushProgressState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!state) window.localStorage.removeItem(PROGRESS_STORAGE_KEY);
    else window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(RESTORE_CLOUD_PUSH_PROGRESS_EVENT, { detail: state }));
  } catch {
    /* quota */
  }
}

export function getRestoreCloudPushProgress(): RestoreCloudPushProgressState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RestoreCloudPushProgressState;
  } catch {
    return null;
  }
}

export function subscribeRestoreCloudPushProgress(
  listener: (state: RestoreCloudPushProgressState | null) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    listener((e as CustomEvent<RestoreCloudPushProgressState | null>).detail ?? null);
  };
  window.addEventListener(RESTORE_CLOUD_PUSH_PROGRESS_EVENT, onEvent);
  listener(getRestoreCloudPushProgress());
  return () => window.removeEventListener(RESTORE_CLOUD_PUSH_PROGRESS_EVENT, onEvent);
}

export function isCompanyPendingRestoreCloudPush(companyId: string): boolean {
  const job = readPendingRestoreCloudPush();
  return !!job && job.companyId === companyId;
}

/**
 * Files upload ke baad: SQLite HTTPS attachment fields Firestore pe merge karo
 * (with-files data phase HTTPS strip se fields gayab hoti hain).
 */
export async function patchSqliteHttpsAttachmentsToFirestore(companyId: string): Promise<{
  patched: number;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { patched: 0 };

  const { listCompanyDocsFromBrowserDb, notifyBrowserDbCollectionUpdated } = await import(
    "@/lib/localCompanyDocMirror"
  );
  const { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } = await import("@/lib/firestoreToLocalCompanyPull");
  const { isLocalFileRef } = await import("@/lib/localPendingFiles");
  const { resolveAuthoritativeFirestoreCompanyId } = await import("@/lib/resolveAuthoritativeFirestoreCompanyId");
  const { doc, setDoc } = await import("@/lib/pbCompat/firestore");
  const { firestore } = await import("@/lib/firebase");

  const fsCompanyId = await resolveAuthoritativeFirestoreCompanyId(cid);
  let patched = 0;
  const attachmentFields = ["fileUrls", "documentFileUrls", "fileUrl", "avatarUrl", "logoUrl"] as const;

  for (const collectionName of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
    const rows = await listCompanyDocsFromBrowserDb(cid, collectionName, { forBackupMerge: true });
    for (const row of rows) {
      const docId = String((row as { id?: string }).id || "").trim();
      if (!docId) continue;
      const httpsOnly: Record<string, unknown> = {};
      for (const field of attachmentFields) {
        const cur = (row as Record<string, unknown>)[field];
        if (Array.isArray(cur)) {
          const https = cur
            .map((u) => String(u || "").trim())
            .filter((u) => u && !isLocalFileRef(u) && /^https?:\/\//i.test(u));
          if (https.length) httpsOnly[field] = https;
        } else if (typeof cur === "string") {
          const u = cur.trim();
          if (u && !isLocalFileRef(u) && /^https?:\/\//i.test(u)) httpsOnly[field] = u;
        }
      }
      const unassigned = (row as Record<string, unknown>).unassignedFile;
      if (unassigned && typeof unassigned === "object") {
        const url = String((unassigned as { url?: unknown }).url || "").trim();
        if (url && !isLocalFileRef(url) && /^https?:\/\//i.test(url)) {
          httpsOnly.unassignedFile = { ...(unassigned as Record<string, unknown>), url };
        }
      }
      if (Object.keys(httpsOnly).length === 0) continue;
      try {
        await setDoc(
          doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId),
          { ...httpsOnly, id: docId },
          { merge: true }
        );
        patched++;
      } catch {
        /* ignore */
      }
    }
    notifyBrowserDbCollectionUpdated(cid, collectionName);
  }
  return { patched };
}

/**
 * Restore files phase: pending sync + HTTPS Firestore/SQLite patch.
 * Pending bytes sirf tab hatao jab sync HTTPS likh chuka ho — blind delete mat
 * (warna bucket me file, docs me `local:` = doosre PC pe blank).
 */
export async function drainRestoreCloudPendingAttachments(companyId: string): Promise<{
  remaining: number;
  cleared: number;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { remaining: 0, cleared: 0 };
  const { listPendingFilesForCompany, syncOnePendingFile } = await import("@/lib/localPendingFiles");
  let cleared = 0;
  for (let round = 0; round < 3; round++) {
    const before = await listPendingFilesForCompany(cid);
    if (!before.length) break;
    for (const item of before) {
      const result = await syncOnePendingFile(item, { forceUploadPendingBlob: true });
      if (result.success) cleared++;
    }
    const after = await listPendingFilesForCompany(cid);
    if (after.length >= before.length) break;
  }
  const remaining = (await listPendingFilesForCompany(cid)).length;
  return { remaining, cleared };
}

/**
 * Files upload ke baad: SQLite HTTPS attachment fields Firestore pe merge karo
 * (data phase `omitLocalFileRefs` se fileUrls hata chuka hota hai).
 */
export async function finalizeRestoreAttachmentHttpsUrls(companyId: string): Promise<{
  patched: number;
}> {
  const cid = String(companyId || "").trim();
  if (!cid) return { patched: 0 };
  await drainRestoreCloudPendingAttachments(cid);

  // Bucket pe file hai lekin docs me `local:` — Storage se HTTPS relink (pending empty case).
  try {
    const { relinkLocalAttachmentsFromFirebaseStorage } = await import(
      "@/lib/relinkLocalAttachmentsFromStorage"
    );
    await relinkLocalAttachmentsFromFirebaseStorage(cid);
  } catch (e) {
    console.warn("[restoreCloud] relink local→HTTPS from Storage failed", e);
  }

  return patchSqliteHttpsAttachmentsToFirestore(cid);
}

/** Batch size — upload 10, HTTPS fix, next 10. */
const RESTORE_ATTACHMENT_UPLOAD_BATCH = 10;

/**
 * With-files restore: 10 pending upload → HTTPS docs pe fix → next 10.
 * Offline → pause (resume refresh / online).
 */
export async function uploadRestoreAttachmentsInBatches(
  companyId: string,
  opts: {
    filesUploaded: number;
    filesTotal: number;
    onProgress: (uploaded: number, total: number, detail?: string) => void;
  }
): Promise<{ ok: boolean; paused?: boolean; filesUploaded: number; remaining: number; message?: string }> {
  const cid = String(companyId || "").trim();
  if (!cid) return { ok: false, filesUploaded: opts.filesUploaded, remaining: 0, message: "Missing company id." };

  const { listPendingFilesForCompany, syncOnePendingFile } = await import("@/lib/localPendingFiles");
  let filesUploaded = Math.max(0, opts.filesUploaded);
  const filesTotal = Math.max(1, opts.filesTotal);

  while (true) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      opts.onProgress(filesUploaded, filesTotal, "Paused — offline");
      return {
        ok: false,
        paused: true,
        filesUploaded,
        remaining: (await listPendingFilesForCompany(cid)).length,
        message: "Offline — attachment upload paused. Reconnect or refresh to resume.",
      };
    }

    const pending = await listPendingFilesForCompany(cid);
    if (!pending.length) {
      await patchSqliteHttpsAttachmentsToFirestore(cid);
      opts.onProgress(filesTotal, filesTotal, "Attachments linked");
      return { ok: true, filesUploaded: Math.max(filesUploaded, filesTotal), remaining: 0 };
    }

    const batch = pending.slice(0, RESTORE_ATTACHMENT_UPLOAD_BATCH);
    for (const item of batch) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        opts.onProgress(filesUploaded, filesTotal, "Paused — offline");
        return {
          ok: false,
          paused: true,
          filesUploaded,
          remaining: (await listPendingFilesForCompany(cid)).length,
          message: "Offline — attachment upload paused. Reconnect or refresh to resume.",
        };
      }
      const result = await syncOnePendingFile(item, { forceUploadPendingBlob: true });
      if (result.success) {
        filesUploaded = Math.min(filesTotal, filesUploaded + 1);
        opts.onProgress(
          filesUploaded,
          filesTotal,
          item.fileName || `Uploaded ${filesUploaded}/${filesTotal}`
        );
      }
    }

    // Har 10 ke baad masters/vouchers/opening pe HTTPS fix.
    await patchSqliteHttpsAttachmentsToFirestore(cid);
    opts.onProgress(filesUploaded, filesTotal, `Linked batch — ${filesUploaded}/${filesTotal}`);
  }
}

/** Background job ya progress banner ke liye — koi bhi phase. */
export function isRestoreCloudPushActive(): boolean {
  const job = readPendingRestoreCloudPush();
  if (job) return true;
  const prog = getRestoreCloudPushProgress();
  return prog?.status === "running" || prog?.status === "failed" || prog?.status === "paused";
}

/**
 * User company switch / refresh kar sake — upload background resume (localStorage).
 * beforeunload warn optional; hard lock nahi.
 */
export function isRestoreCloudFileUploadLocked(): boolean {
  return false;
}

/** @deprecated Prefer isRestoreCloudFileUploadLocked for refresh/company-switch guards. */
export function isRestoreCloudUploadLocked(): boolean {
  return isRestoreCloudFileUploadLocked();
}

/** Dashboard / reload ke baad pending job dubara chalao. */
export function kickPendingRestoreCloudPush(): void {
  const job = readPendingRestoreCloudPush();
  if (job) dispatchRestoreCloudPushJob(job);
}

function getRestoreTabId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = window.sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

type UploadLeaderRow = { tabId: string; companyId: string; heartbeatMs: number };

function readUploadLeader(): UploadLeaderRow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UPLOAD_LEADER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UploadLeaderRow;
  } catch {
    return null;
  }
}

/** Sirf ek tab upload chalaye — doosra tab progress dekhe, dubara start na kare. */
export function tryAcquireRestoreCloudUploadLeader(companyId: string): boolean {
  if (typeof window === "undefined") return false;
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  const tabId = getRestoreTabId();
  const now = Date.now();
  try {
    const cur = readUploadLeader();
    if (
      cur &&
      cur.companyId === cid &&
      cur.tabId !== tabId &&
      now - cur.heartbeatMs < LEADER_STALE_MS
    ) {
      return false;
    }
    window.localStorage.setItem(
      UPLOAD_LEADER_KEY,
      JSON.stringify({ tabId, companyId: cid, heartbeatMs: now } satisfies UploadLeaderRow)
    );
    return true;
  } catch {
    return true;
  }
}

export function heartbeatRestoreCloudUploadLeader(companyId: string): void {
  if (typeof window === "undefined") return;
  const cid = String(companyId || "").trim();
  if (!cid) return;
  const tabId = getRestoreTabId();
  try {
    window.localStorage.setItem(
      UPLOAD_LEADER_KEY,
      JSON.stringify({ tabId, companyId: cid, heartbeatMs: Date.now() } satisfies UploadLeaderRow)
    );
  } catch {
    /* ignore */
  }
}

export function releaseRestoreCloudUploadLeader(companyId: string): void {
  if (typeof window === "undefined") return;
  const cid = String(companyId || "").trim();
  const tabId = getRestoreTabId();
  try {
    const cur = readUploadLeader();
    if (cur?.tabId === tabId && cur.companyId === cid) {
      window.localStorage.removeItem(UPLOAD_LEADER_KEY);
    }
  } catch {
    /* ignore */
  }
}

function dispatchRestoreCloudPushJob(job: PendingRestoreCloudPush | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RESTORE_CLOUD_PUSH_JOB_EVENT, { detail: job }));
}

export function queuePendingRestoreCloudPush(
  job: Omit<PendingRestoreCloudPush, "createdAtMs" | "phase" | "dataUploaded">,
  options?: { deferDispatch?: boolean }
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PendingRestoreCloudPush = { ...job, phase: "data", createdAtMs: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (!options?.deferDispatch) {
      dispatchRestoreCloudPushJob(payload);
    }
  } catch {
    /* quota */
  }
}

/** Data pehle upload ho chuka — sirf attachments background me. */
export function queuePendingRestoreCloudPushFilesOnly(
  job: Omit<PendingRestoreCloudPush, "createdAtMs" | "phase" | "dataUploaded"> & {
    filesTotal?: number;
    filesUploaded?: number;
  }
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readPendingRestoreCloudPush();
    const payload: PendingRestoreCloudPush = {
      ...job,
      phase: "files",
      dataUploaded: true,
      createdAtMs: existing?.createdAtMs ?? Date.now(),
      filesTotal: job.filesTotal ?? existing?.filesTotal,
      filesUploaded: job.filesUploaded ?? existing?.filesUploaded ?? 0,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    dispatchRestoreCloudPushJob(payload);
  } catch {
    /* quota */
  }
}

export function readPendingRestoreCloudPush(): PendingRestoreCloudPush | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRestoreCloudPush;
    if (!parsed?.companyId || !parsed?.ownerUid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistPendingRestoreCloudPush(job: PendingRestoreCloudPush): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
    dispatchRestoreCloudPushJob(job);
  } catch {
    /* quota */
  }
}

export function clearPendingRestoreCloudPush(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearRestoreCloudPushProgress(): void {
  writeProgress(null);
}

async function clearFirestoreCompanySubcollectionsForRestore(fsCompanyId: string): Promise<void> {
  const cid = String(fsCompanyId || "").trim();
  if (!cid) return;
  for (const colName of COLLECTIONS_TO_BACKUP) {
    const colRef = collection(firestore, `companies/${cid}/${colName}`);
    for (;;) {
      const snap = await getDocs(query(colRef, limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(firestore);
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
    }
  }
}

async function ensureFirestoreCompanyRoot(
  companyId: string,
  ownerUid: string,
  ownerEmail: string,
  companyName: string
): Promise<void> {
  const local = await getLocalCompanyById(companyId, { includeDeleted: true });
  const localRow = (local || {}) as Record<string, unknown>;
  const name =
    companyName.trim() || String(localRow.name || "").trim() || "Company";
  const ownerEmailNorm = String(ownerEmail || "").trim();
  const sharedWithEmails = (() => {
    const fromLocal = localRow.sharedWithEmails;
    if (Array.isArray(fromLocal) && fromLocal.length > 0) {
      return fromLocal.map((e) => String(e || "").trim()).filter(Boolean);
    }
    return ownerEmailNorm ? [ownerEmailNorm] : [];
  })();

  const interCompanyCompanyCode = readCompanyInterCompanyCode(
    local as { interCompanyCompanyCode?: string }
  );

  const rootPayload: Record<string, unknown> = {
    id: companyId,
    name,
    address: String(localRow.address || ""),
    phone: String(localRow.phone || ""),
    email: String(localRow.email || ""),
    pan: String(localRow.pan || ""),
    country: String(localRow.country || ""),
    logoUrl: (localRow.logoUrl as string | null | undefined) ?? null,
    ownerId: ownerUid,
    ownerEmail: ownerEmailNorm,
    authoritativeCompanyId: companyId,
    storageOption: "firebase",
    syncPolicy: "online",
    syncedFromCloud: false,
    ...pocketLedgerStorageDocFields(companyId),
    sharedWith: Array.isArray(localRow.sharedWith) ? localRow.sharedWith : [],
    sharedWithEmails,
    sharedWithEmailsLower: sharedWithEmailsLowerFromList(sharedWithEmails),
    planId: String(localRow.planId || "basic"),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  if (interCompanyCompanyCode) {
    rootPayload.interCompanyCompanyCode = interCompanyCompanyCode;
  }

  await setDoc(doc(firestore, "companies", companyId), rootPayload, { merge: true });
}

async function markLocalCompanyCloudSynced(
  companyId: string,
  syncedFromCloud = true
): Promise<void> {
  const local = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!local) return;
  await upsertLocalCompany({
    ...(local as Parameters<typeof upsertLocalCompany>[0]),
    storageOption: "firebase",
    syncPolicy: "online",
    syncedFromCloud,
    authoritativeCompanyId: companyId,
    ...pocketLedgerStorageDocFields(companyId),
    updatedAt: Date.now(),
  });
  try {
    bumpLocalCompanyRegistry();
  } catch {
    /* ignore */
  }
}

function progressFromUpload(
  job: PendingRestoreCloudPush,
  phase: RestoreCloudPushPhase,
  phaseLabel: string,
  done: number,
  total: number,
  status: RestoreCloudPushProgressState["status"],
  message?: string
): RestoreCloudPushProgressState {
  const safeTotal = Math.max(1, total);
  let percent: number;
  if (status === "complete" && done >= safeTotal) {
    percent = 100;
  } else if (status === "paused") {
    percent = Math.min(99, Math.floor((done / safeTotal) * 100));
  } else if (status === "running") {
    percent = Math.min(99, Math.floor((done / safeTotal) * 100));
  } else if (phase === "files" && done < safeTotal) {
    percent = Math.min(99, Math.floor((done / safeTotal) * 100));
  } else {
    percent = Math.min(100, Math.round((done / safeTotal) * 100));
  }
  return {
    companyId: job.companyId,
    companyName: job.companyName,
    phase,
    phaseLabel,
    done,
    total: safeTotal,
    percent,
    status,
    message,
  };
}

/**
 * SQLite restore complete — cloud data/files background me (non-blocking).
 * Refresh / page change safe until files phase (see isRestoreCloudFileUploadLocked).
 */
export function startRestoreCloudBackgroundSync(
  job: Omit<PendingRestoreCloudPush, "createdAtMs" | "phase" | "dataUploaded">,
  options?: { kickDelayMs?: number }
): void {
  if (typeof window === "undefined") return;
  const companyId = String(job.companyId || "").trim();
  if (!companyId) return;
  setFirebaseLedgerDataSyncEnabled(true);
  replaceFirebaseLedgerCompanySyncEntries({
    [companyId]: { selected: true, data: true, attachments: true },
  });
  // UI / redirect pehle paint ho — data upload next tick se (Page Unresponsive avoid).
  queuePendingRestoreCloudPush(job, { deferDispatch: true });
  void import("@/lib/interCompany/interCompanyCompanyCode")
    .then(({ ensureCompanyInterCompanyCode }) =>
      ensureCompanyInterCompanyCode(companyId, job.companyName)
    )
    .catch(() => undefined);
  try {
    window.dispatchEvent(new CustomEvent(FIREBASE_LEDGER_COMPANY_REGISTRY_PULL_EVENT));
  } catch {
    /* ignore */
  }
  const delay = Math.max(0, options?.kickDelayMs ?? 300);
  window.setTimeout(() => kickPendingRestoreCloudPush(), delay);
}

/**
 * Online restore: pehle Firestore root doc (owner + sharedWith), phir background me data/files upload.
 */
export async function registerRestoredCompanyOnFirestore(input: {
  companyId: string;
  ownerUid: string;
  ownerEmail: string;
  companyName: string;
  replaceCurrent?: boolean;
  restoreWithAttachments?: boolean;
  storageFolderCleared?: boolean;
  onProgress?: (detail: string) => void;
}): Promise<{ ok: boolean; message?: string }> {
  const companyId = String(input.companyId || "").trim();
  const ownerUid = String(input.ownerUid || "").trim();
  if (!companyId) return { ok: false, message: "Missing company id." };
  if (!ownerUid) return { ok: false, message: "Sign in again, then retry online restore." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, message: "Offline — connect to the internet and try again." };
  }
  try {
    input.onProgress?.("Creating company profile on Firebase…");
    await ensureFirestoreCompanyRoot(
      companyId,
      ownerUid,
      input.ownerEmail,
      input.companyName
    );

    input.onProgress?.("Verifying Firebase registration…");
    const verify = await getDoc(doc(firestore, "companies", companyId));
    if (!verify.exists()) {
      return {
        ok: false,
        message:
          "Firebase company document was not created. Check you are signed in with the same account, then retry restore.",
      };
    }
    const rootOwnerId = String(verify.data()?.ownerId || "").trim();
    if (rootOwnerId && rootOwnerId !== ownerUid) {
      return {
        ok: false,
        message:
          "This company id is already linked to another Firebase account. Restore as a new company or use a different backup.",
      };
    }

    await markLocalCompanyCloudSynced(companyId, false);

    if (typeof window !== "undefined") {
      startRestoreCloudBackgroundSync({
        companyId,
        ownerUid,
        ownerEmail: input.ownerEmail,
        companyName: input.companyName,
        replaceCurrent: input.replaceCurrent === true,
        restoreWithAttachments: input.restoreWithAttachments === true,
        storageFolderCleared: input.storageFolderCleared === true,
      });
    }

    return {
      ok: true,
      message:
        "Company created on Firebase. Masters, vouchers, and attachments will upload in the background.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

/** Restore ke dauran turant — SQLite complete hone ke baad, reload se pehle. */
export async function uploadRestoreDataToCloudImmediately(
  job: Omit<PendingRestoreCloudPush, "createdAtMs" | "phase" | "dataUploaded">
): Promise<{ ok: boolean; message?: string; docsPushed?: number }> {
  const fullJob: PendingRestoreCloudPush = {
    ...job,
    phase: "data",
    createdAtMs: Date.now(),
  };
  const result = await runPendingRestoreCloudPushDataPhase(fullJob, { skipFilesQueue: true });
  return {
    ok: result.ok,
    message: result.message,
    docsPushed: result.docsPushed,
  };
}

/** Phase 1 — ledger docs to Firestore. */
export async function runPendingRestoreCloudPushDataPhase(
  job: PendingRestoreCloudPush,
  options?: { skipFilesQueue?: boolean }
): Promise<{ ok: boolean; message?: string; reload?: boolean; docsPushed?: number; paused?: boolean }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    writeProgress(
      progressFromUpload(job, "data", "Uploading company data", 0, 1, "paused", "Offline — resume when online.")
    );
    return { ok: false, paused: true, message: "Offline — cloud upload will resume when you are online." };
  }

  const companyId = String(job.companyId || "").trim();
  if (!companyId) return { ok: false, message: "Missing company id." };

  writeProgress(progressFromUpload(job, "data", "Uploading company data", 0, 1, "running"));

  try {
    if (job.replaceCurrent) {
      await clearFirestoreCompanySubcollectionsForRestore(companyId);
    }

    // With-files + replace: purana Storage wipe pehle — data-only HTTPS URLs mat todo.
    if (
      job.replaceCurrent &&
      job.restoreWithAttachments === true &&
      job.storageFolderCleared !== true
    ) {
      writeProgress(
        progressFromUpload(
          job,
          "data",
          "Clearing old cloud files",
          0,
          1,
          "running",
          "Removing previous attachment folder…"
        )
      );
      const { wipeCompanyFirebaseStorageForRestore } = await import("@/lib/deleteCompanyStorageFolder");
      await wipeCompanyFirebaseStorageForRestore({
        companyId,
        companyName: job.companyName,
      });
      job = { ...job, storageFolderCleared: true };
      persistPendingRestoreCloudPush({ ...job, phase: "data" });
    }

    await ensureFirestoreCompanyRoot(companyId, job.ownerUid, job.ownerEmail, job.companyName);

    const result = await forceUploadLocalCompanyToServer(companyId, {
      mode: "docsOnly",
      // Data-only: HTTPS bakho. With-files: HTTPS+local: strip — files phase repair.
      omitAllAttachmentUrls: job.restoreWithAttachments === true,
      onProgress: (p) => {
        writeProgress(
          progressFromUpload(job, "data", p.phase, p.done, p.total, "running", p.detail)
        );
      },
    });

    if (!result.ok && result.docsPushed === 0 && result.errors.length > 0) {
      const msg = result.message || result.errors[0] || "Cloud data upload failed.";
      writeProgress(progressFromUpload(job, "data", "Uploading company data", 0, 1, "failed", msg));
      return { ok: false, message: msg };
    }

    await markLocalCompanyCloudSynced(companyId);

    // Data complete → dashboard usable; files background (job phase=files).
    persistPendingRestoreCloudPush({
      ...job,
      phase: job.restoreWithAttachments === true ? "files" : "sync",
      dataUploaded: true,
      storageFolderCleared: job.storageFolderCleared === true,
    });

    writeProgress(
      progressFromUpload(
        job,
        "data",
        "Company data uploaded",
        1,
        1,
        job.restoreWithAttachments === true ? "running" : "complete",
        job.restoreWithAttachments === true
          ? "Data ready — uploading attachments in background…"
          : "Data ready — using backup HTTPS for files."
      )
    );

    if (!options?.skipFilesQueue && job.restoreWithAttachments !== true) {
      return {
        ok: true,
        reload: true,
        docsPushed: result.docsPushed,
        message: `Data uploaded (${result.docsPushed} records).`,
      };
    }

    return {
      ok: true,
      docsPushed: result.docsPushed,
      message: `Data uploaded (${result.docsPushed} records).`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeProgress(progressFromUpload(job, "data", "Uploading company data", 0, 1, "failed", msg));
    return { ok: false, message: msg };
  }
}

/** Files phase queue + progress seed — caller browse kare, upload background me. */
export async function beginRestoreCloudFilesUpload(
  job: Omit<PendingRestoreCloudPush, "createdAtMs" | "phase" | "dataUploaded" | "filesTotal" | "filesUploaded">
): Promise<{ filesTotal: number }> {
  const companyId = String(job.companyId || "").trim();
  const { countPendingFilesForCompany } = await import("@/lib/localPendingFiles");
  const pendingCount = companyId ? await countPendingFilesForCompany(companyId) : 0;
  const existing = readPendingRestoreCloudPush();
  const filesTotal = Math.max(1, existing?.filesTotal ?? pendingCount);
  const filesUploaded = Math.max(0, existing?.filesUploaded ?? filesTotal - pendingCount);
  const fullJob: PendingRestoreCloudPush = {
    ...job,
    phase: "files",
    dataUploaded: true,
    createdAtMs: existing?.createdAtMs ?? Date.now(),
    filesTotal,
    filesUploaded,
  };
  persistPendingRestoreCloudPush(fullJob);
  writeProgress(
    progressFromUpload(
      fullJob,
      "files",
      pendingCount > 0 ? "Uploading attachments" : "No attachments to upload",
      filesUploaded,
      filesTotal,
      pendingCount > 0 ? "running" : "complete"
    )
  );
  return { filesTotal };
}

/** Phase 2 — attachments; resume from persisted filesUploaded / filesTotal. */
export async function runPendingRestoreCloudPushFilesPhase(
  job: PendingRestoreCloudPush
): Promise<{
  ok: boolean;
  message?: string;
  reload?: boolean;
  needsLocalSync?: boolean;
  filesUploaded?: number;
  paused?: boolean;
}> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const filesUploaded = Math.max(0, job.filesUploaded ?? 0);
    const filesTotal = Math.max(1, job.filesTotal ?? 1);
    writeProgress(
      progressFromUpload(
        job,
        "files",
        "Uploading attachments",
        filesUploaded,
        filesTotal,
        "paused",
        "Offline — resume when online."
      )
    );
    return {
      ok: false,
      paused: true,
      filesUploaded,
      message: "Offline — attachment upload paused. Reconnect or refresh to resume.",
    };
  }

  const companyId = String(job.companyId || "").trim();
  if (!companyId) return { ok: false, message: "Missing company id." };

  if (job.restoreWithAttachments !== true) {
    const syncReadyJob: PendingRestoreCloudPush = {
      ...job,
      phase: "sync",
      dataUploaded: true,
      filesUploaded: job.filesTotal ?? 0,
      filesTotal: job.filesTotal ?? 0,
    };
    persistPendingRestoreCloudPush(syncReadyJob);
    return {
      ok: true,
      reload: true,
      needsLocalSync: true,
      filesUploaded: 0,
      message: "Cloud restore complete (data-only — backup HTTPS kept).",
    };
  }

  const { countPendingFilesForCompany } = await import("@/lib/localPendingFiles");
  const pendingCount = await countPendingFilesForCompany(companyId);

  let filesTotal = Math.max(1, job.filesTotal ?? 0);
  let filesUploaded = Math.max(0, job.filesUploaded ?? 0);

  if (!job.filesTotal || job.filesTotal < 1) {
    filesTotal = Math.max(1, pendingCount + filesUploaded);
  } else if (pendingCount > 0) {
    filesUploaded = Math.max(filesUploaded, filesTotal - pendingCount);
  }

  const workingJob: PendingRestoreCloudPush = { ...job, filesTotal, filesUploaded };
  persistPendingRestoreCloudPush(workingJob);

  if (pendingCount === 0) {
    try {
      await patchSqliteHttpsAttachmentsToFirestore(companyId);
    } catch {
      /* best-effort */
    }
    const syncReadyJob: PendingRestoreCloudPush = {
      ...workingJob,
      phase: "sync",
      filesUploaded: Math.max(filesUploaded, filesTotal > 0 ? filesUploaded : 0),
    };
    persistPendingRestoreCloudPush(syncReadyJob);
    writeProgress(
      progressFromUpload(
        syncReadyJob,
        "sync",
        "Syncing local cache",
        0,
        1,
        "running",
        "Attachments already on cloud — refreshing ledger…"
      )
    );
    return {
      ok: true,
      reload: true,
      needsLocalSync: true,
      filesUploaded: syncReadyJob.filesUploaded ?? filesUploaded,
      message: "Cloud restore complete (attachments already uploaded).",
    };
  }

  writeProgress(
    progressFromUpload(workingJob, "files", "Uploading attachments", filesUploaded, filesTotal, "running")
  );

  try {
    if (
      job.replaceCurrent &&
      job.restoreWithAttachments === true &&
      job.storageFolderCleared !== true
    ) {
      writeProgress(
        progressFromUpload(
          workingJob,
          "files",
          "Clearing old cloud files",
          filesUploaded,
          filesTotal,
          "running",
          "Removing previous attachment folder…"
        )
      );
      const { wipeCompanyFirebaseStorageForRestore } = await import("@/lib/deleteCompanyStorageFolder");
      await wipeCompanyFirebaseStorageForRestore({
        companyId,
        companyName: job.companyName,
      });
      const clearedJob: PendingRestoreCloudPush = { ...workingJob, storageFolderCleared: true };
      persistPendingRestoreCloudPush(clearedJob);
      Object.assign(workingJob, clearedJob);
    }

    const batchResult = await uploadRestoreAttachmentsInBatches(companyId, {
      filesUploaded,
      filesTotal,
      onProgress: (uploaded, total, detail) => {
        const mergedJob = { ...workingJob, filesUploaded: uploaded, filesTotal: total };
        persistPendingRestoreCloudPush(mergedJob);
        writeProgress(
          progressFromUpload(mergedJob, "files", "Uploading attachments", uploaded, total, "running", detail)
        );
      },
    });

    const finalUploaded = Math.min(filesTotal, Math.max(filesUploaded, batchResult.filesUploaded));
    persistPendingRestoreCloudPush({ ...workingJob, filesUploaded: finalUploaded });

    if (batchResult.paused) {
      writeProgress(
        progressFromUpload(
          { ...workingJob, filesUploaded: finalUploaded },
          "files",
          "Uploading attachments",
          finalUploaded,
          filesTotal,
          "paused",
          batchResult.message
        )
      );
      return {
        ok: false,
        paused: true,
        filesUploaded: finalUploaded,
        message: batchResult.message,
      };
    }

    if (!batchResult.ok && batchResult.remaining > 0) {
      writeProgress(
        progressFromUpload(
          { ...workingJob, filesUploaded: finalUploaded },
          "files",
          "Uploading attachments",
          finalUploaded,
          filesTotal,
          "failed",
          batchResult.message || "Attachment upload will retry."
        )
      );
      return {
        ok: false,
        filesUploaded: finalUploaded,
        message: batchResult.message || "Some attachments could not upload — will retry.",
      };
    }

    writeProgress(
      progressFromUpload(
        workingJob,
        "files",
        "Linking attachments",
        finalUploaded,
        filesTotal,
        "running",
        "Final HTTPS link pass…"
      )
    );
    try {
      await finalizeRestoreAttachmentHttpsUrls(companyId);
    } catch {
      await patchSqliteHttpsAttachmentsToFirestore(companyId);
    }

    const remainingAfter = await countPendingFilesForCompany(companyId);
    if (remainingAfter > 0) {
      writeProgress(
        progressFromUpload(
          { ...workingJob, filesUploaded: finalUploaded },
          "files",
          "Uploading attachments",
          finalUploaded,
          filesTotal,
          "paused",
          remainingAfter + " file(s) left — will resume."
        )
      );
      return {
        ok: false,
        paused: true,
        filesUploaded: finalUploaded,
        message: remainingAfter + " attachment(s) still pending — resume when online/ready.",
      };
    }

    const syncReadyJob: PendingRestoreCloudPush = {
      ...workingJob,
      phase: "sync",
      filesUploaded: finalUploaded,
    };
    persistPendingRestoreCloudPush(syncReadyJob);
    writeProgress(
      progressFromUpload(
        syncReadyJob,
        "files",
        "Attachments uploaded",
        finalUploaded,
        filesTotal,
        "running",
        "Refreshing local cache…"
      )
    );
    return {
      ok: true,
      reload: true,
      needsLocalSync: true,
      filesUploaded: finalUploaded,
      message: "Attachments uploaded (" + finalUploaded + "/" + filesTotal + ").",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeProgress(
      progressFromUpload(workingJob, "files", "Uploading attachments", filesUploaded, filesTotal, "failed", msg)
    );
    return { ok: false, message: msg, filesUploaded };
  }
}

export async function runRestoreCloudLocalSyncPhase(
  job: PendingRestoreCloudPush,
  opts?: { filesUploaded?: number }
): Promise<{ ok: boolean; message?: string; reload?: boolean }> {
  const companyId = String(job.companyId || "").trim();
  if (!companyId) return { ok: false, message: "Missing company id." };

  const { pullAllCompanySubcollectionsFromFirestoreToLocalDb, COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } =
    await import("@/lib/firestoreToLocalCompanyPull");
  const { flushBrowserDbToIndexedDB } = await import("@/lib/localSqlite");
  const { notifyBrowserDbCollectionUpdated } = await import("@/lib/localCompanyDocMirror");

  const total = Math.max(1, COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS.length);
  let completed = 0;
  const uploaded = opts?.filesUploaded ?? job.filesUploaded ?? 0;

  writeProgress(
    progressFromUpload(job, "sync", "Syncing local cache", 0, total, "running", "Downloading vouchers from cloud…")
  );

  try {
    // Ensure HTTPS URLs on Firestore before pull (other devices + this browser).
    try {
      await finalizeRestoreAttachmentHttpsUrls(companyId);
    } catch {
      /* best-effort */
    }

    // Vouchers/masters dubara push — warna empty Firestore pull SQLite vouchers orphan-delete kar deta tha.
    writeProgress(
      progressFromUpload(job, "sync", "Syncing local cache", 0, total, "running", "Re-uploading ledger docs…")
    );
    try {
      const { forceUploadLocalCompanyToServer } = await import("@/lib/forceUploadLocalCompanyToServer");
      await forceUploadLocalCompanyToServer(companyId, { mode: "docsOnly" });
    } catch (e) {
      console.warn("[restoreCloud] sync-phase docs re-push failed", e);
    }

    const localRow = await getLocalCompanyById(companyId, { includeDeleted: true });
    await pullAllCompanySubcollectionsFromFirestoreToLocalDb(
      companyId,
      companyId,
      (localRow as import("@/hooks/useCompany").Company) ?? null,
      {
        // Restore: local SQLite authoritative jab tak cloud incomplete — vouchers mat mitao.
        mergeOpts: {
          preferLocalSqliteWhenIdsConflict: true,
          skipOrphanSqliteDelete: true,
        },
        onSubcollectionDone: ({ path, completed: c, total: t }) => {
          completed = c;
          writeProgress(
            progressFromUpload(
              job,
              "sync",
              "Syncing local cache",
              c,
              t,
              "running",
              `Synced ${path.replace(/_/g, " ")} (${c}/${t})…`
            )
          );
        },
      }
    );
    await flushBrowserDbToIndexedDB();
    notifyBrowserDbCollectionUpdated(companyId, "vouchers");
    bumpLocalCompanyRegistry();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(RESTORE_CLOUD_VOUCHERS_REFRESH_EVENT, { detail: { companyId } })
      );
    }

    clearPendingRestoreCloudPush();
    const doneMsg =
      uploaded > 0
        ? `${uploaded} file(s) uploaded — ledger refreshed.`
        : "Local cache refreshed from cloud.";
    writeProgress(
      progressFromUpload(job, "sync", "Cloud restore complete", total, total, "complete", doneMsg)
    );

    // User request: data → files → refresh — HTTPS URLs UI me dikhein.
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          /* ignore */
        }
      }, 600);
    }
    return { ok: true, message: doneMsg, reload: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeProgress(
      progressFromUpload(job, "sync", "Syncing local cache", completed, total, "failed", msg)
    );
    return { ok: false, message: msg };
  }
}

/** Legacy single-shot entry — prefer phased runners from PendingRestoreCloudPushManager. */
export async function runPendingRestoreCloudPush(
  job: PendingRestoreCloudPush
): Promise<{ ok: boolean; message?: string }> {
  const phase = job.phase ?? "data";
  if (phase === "files") return runPendingRestoreCloudPushFilesPhase(job);
  const data = await runPendingRestoreCloudPushDataPhase(job);
  if (data.ok && data.reload) {
    window.location.reload();
    return { ok: true, message: data.message };
  }
  return data;
}
