"use client";

import { collection, doc, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
import { writeBatch } from "@/lib/writeGateway/pbWrites";
import { firestore } from "@/lib/plClientSession";
import {
  generateLocalFileId,
  getBlobFromLocalFileRef,
  LOCAL_FILE_PREFIX,
  putPendingFile,
  removePendingFile,
} from "@/lib/localPendingFiles";
import { uploadUnassignedFileToPocketLedgerServer } from "@/lib/uploadUnassignedFileToPocketLedgerServer";

export const GALLERY_OFFLINE_PENDING_CHANGED_EVENT = "pl:gallery:offline-pending-changed";

export type GalleryOfflinePendingRecord = {
  id: string;
  companyId: string;
  name: string;
  type: "image" | "pdf" | "other";
  size: number;
  uploadedBy: string;
  uploadedAtMs: number;
  localRef: string;
  offlinePending: true;
  status: "FREE";
};

const STORAGE_KEY = "pl:gallery:offline-pending-unassigned:v1";
let flushInFlight: Promise<{ uploaded: number; failed: number }> | null = null;

function fileKind(file: Blob, fileName?: string): "image" | "pdf" | "other" {
  const type = String(file.type || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  return "other";
}

function readAll(): Record<string, GalleryOfflinePendingRecord[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, GalleryOfflinePendingRecord[]>) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, GalleryOfflinePendingRecord[]>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  notifyGalleryOfflinePendingChanged();
}

export function notifyGalleryOfflinePendingChanged(companyId?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(GALLERY_OFFLINE_PENDING_CHANGED_EVENT, {
        detail: { companyId: String(companyId || "").trim() },
      })
    );
  } catch {
    /* ignore */
  }
}

export function listGalleryOfflinePending(companyId: string): GalleryOfflinePendingRecord[] {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const rows = readAll()[cid] || [];
  return rows.filter((row) => row && row.offlinePending === true && String(row.id || "").trim());
}

export async function saveGalleryOfflinePendingFile(input: {
  companyId: string;
  file: Blob;
  fileName: string;
  uploadedBy: string;
}): Promise<GalleryOfflinePendingRecord> {
  const companyId = String(input.companyId || "").trim();
  const uploadedBy = String(input.uploadedBy || "").trim();
  const fileName = String(input.fileName || "file").trim() || "file";
  if (!companyId || !uploadedBy) throw new Error("company and user required");
  if (!input.file || !input.file.size) throw new Error("file required");

  const id = `uadoc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const localId = generateLocalFileId();
  const localRef = `${LOCAL_FILE_PREFIX}${localId}`;
  await putPendingFile(
    {
      id: localId,
      blob: input.file,
      contentType: input.file.type || "application/octet-stream",
      docPath: `companies/${companyId}/unassigned_documents/${id}`,
      field: "url",
      storagePathPrefix: `unassigned/${companyId}`,
      fileName,
    },
    { skipPlServerAttachmentUploadEnqueue: true }
  );

  const record: GalleryOfflinePendingRecord = {
    id,
    companyId,
    name: fileName,
    type: fileKind(input.file, fileName),
    size: input.file.size,
    uploadedBy,
    uploadedAtMs: Date.now(),
    localRef,
    offlinePending: true,
    status: "FREE",
  };
  const all = readAll();
  all[companyId] = [record, ...(all[companyId] || []).filter((row) => row.id !== id)];
  writeAll(all);
  return record;
}

export async function removeGalleryOfflinePending(companyId: string, id: string): Promise<void> {
  const cid = String(companyId || "").trim();
  const docId = String(id || "").trim();
  if (!cid || !docId) return;
  const all = readAll();
  const rows = all[cid] || [];
  const found = rows.find((row) => row.id === docId);
  const next = rows.filter((row) => row.id !== docId);
  if (next.length === rows.length) return;
  if (next.length === 0) delete all[cid];
  else all[cid] = next;
  writeAll(all);
  const localId = String(found?.localRef || "").startsWith(LOCAL_FILE_PREFIX)
    ? String(found?.localRef).slice(LOCAL_FILE_PREFIX.length)
    : "";
  if (localId) {
    try {
      await removePendingFile(localId);
    } catch {
      /* blob already gone */
    }
  }
}

async function galleryEditTimestamp(): Promise<Timestamp> {
  try {
    const { pbServerTime } = await import("@/lib/pocketbaseData/pbSync");
    return Timestamp.fromMillis(pbServerTime());
  } catch {
    return Timestamp.now();
  }
}

async function uploadOnePending(row: GalleryOfflinePendingRecord): Promise<boolean> {
  const blob = await getBlobFromLocalFileRef(row.localRef);
  if (!blob || !blob.size) return false;
  const serverUpload = await uploadUnassignedFileToPocketLedgerServer({
    companyId: row.companyId,
    file: blob,
    fileName: row.name,
  });
  if (!serverUpload?.url) return false;

  const docRef = doc(firestore, `companies/${row.companyId}/unassigned_documents`, row.id);
  const editedAt = await galleryEditTimestamp();
  const docData = {
    url: serverUpload.url,
    path: serverUpload.path,
    name: row.name,
    type: row.type === "pdf" ? "pdf" : "image",
    size: row.size,
    uploadedAt: serverTimestamp(),
    uploadedBy: row.uploadedBy,
    status: "FREE",
    createdAt: editedAt,
    lastEditedAt: editedAt,
    updatedAt: editedAt,
  };
  const batch = writeBatch(firestore);
  batch.set(docRef, docData);
  await batch.commit();
  try {
    const { upsertCompanyDocInBrowserDb } = await import("@/lib/localCompanyDocMirror");
    await upsertCompanyDocInBrowserDb(
      row.companyId,
      "unassigned_documents",
      docRef.id,
      { ...docData, id: docRef.id, uploadedAt: Timestamp.now() },
      { force: true, notify: true, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
    );
  } catch {
    /* next pull repairs the mirror */
  }
  try {
    const { flushBrowserDbToIndexedDB } = await import("@/lib/localSqlite");
    await flushBrowserDbToIndexedDB();
  } catch {
    /* pagehide flush is the fallback */
  }
  await removeGalleryOfflinePending(row.companyId, row.id);
  return true;
}

export async function flushGalleryOfflinePendingUploads(options?: {
  companyId?: string;
}): Promise<{ uploaded: number; failed: number }> {
  if (typeof window === "undefined") return { uploaded: 0, failed: 0 };
  if (flushInFlight) return flushInFlight;
  const run = async (): Promise<{ uploaded: number; failed: number }> => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { uploaded: 0, failed: 0 };
  }
  const wanted = String(options?.companyId || "").trim();
  const all = readAll();
  const companies = wanted ? [wanted] : Object.keys(all);
  let uploaded = 0;
  let failed = 0;
  for (const companyId of companies) {
    const rows = listGalleryOfflinePending(companyId);
    for (const row of rows) {
      try {
        const ok = await uploadOnePending(row);
        if (ok) uploaded += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        console.warn("[Gallery] offline pending upload failed", row.name, error);
      }
    }
  }
  return { uploaded, failed };
  };
  flushInFlight = run().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}