"use client";

/**
 * Save a photo into the Unassigned Documents list from anywhere (gallery FAB and the
 * dashboard FAB share this path).
 *
 * Mirrors what the gallery's drop handler does for an online company: upload the binary,
 * bump storage usage, write the `unassigned_documents` row, then mirror it into the browser
 * SQLite database with an immediate IndexedDB flush — so a refresh right after the shot still
 * lists the photo (the list is read from SQLite, not from the network).
 *
 * Returns `ok: false` when the company cannot sync to the server; the caller falls back to
 * the gallery's local-only (device) storage path.
 */

import { collection, doc, serverTimestamp, Timestamp } from "@/lib/pbCompat/firestore";
import { writeBatch } from "@/lib/writeGateway/pbWrites";
import { firestore } from "@/lib/firebase";
import { uploadFileClient } from "@/lib/storageClient";
import { incrementCompanyStorage } from "@/lib/storageUsageClient";

/** Same rule as the gallery: PocketBase-backed companies write to their authoritative id. */
function firestoreCompanyIdForGallery(
  companyId: string,
  company: { authoritativeCompanyId?: string } | null | undefined
): string {
  return String(company?.authoritativeCompanyId || companyId).trim() || companyId;
}

export type SavedPhotoResult = { ok: true; docId: string } | { ok: false; error: string };

export async function savePhotoToUnassigned(opts: {
  companyId: string;
  companyName?: string;
  uploadedBy: string;
  file: File;
  /** Company record — resolves the authoritative Firestore id for PocketBase-backed companies. */
  company?: { authoritativeCompanyId?: string } | null;
}): Promise<SavedPhotoResult> {
  const { companyId, companyName, uploadedBy, file, company } = opts;
  if (!companyId || !uploadedBy) return { ok: false, error: "missing_company_or_user" };

  try {
    const fsId = firestoreCompanyIdForGallery(companyId, company);
    const uploadResult = await uploadFileClient(
      { name: file.name, type: file.type, arrayBuffer: await file.arrayBuffer() },
      fsId,
      companyName,
      new Date()
    );
    if (uploadResult.success === true) {
      // uploaded — continue below
    } else {
      return { ok: false, error: uploadResult.error || "upload_failed" };
    }

    try {
      await incrementCompanyStorage(fsId, {
        attachmentsBytes: file.size,
        storageBytes: file.size,
      });
    } catch {
      /* storage stats are advisory */
    }

    const docRef = doc(collection(firestore, `companies/${fsId}/unassigned_documents`));
    const docData = {
      url: uploadResult.url,
      path: uploadResult.path,
      name: file.name,
      type: file.type.startsWith("image/") ? "image" : "pdf",
      size: file.size,
      uploadedAt: serverTimestamp(),
      uploadedBy,
      status: "FREE",
    };
    const batch = writeBatch(firestore);
    batch.set(docRef, docData);
    await batch.commit();

    // Local mirror first (the list reads SQLite), then hold it on disk so an instant
    // refresh keeps showing the photo instead of the pre-capture snapshot.
    try {
      const { upsertCompanyDocInBrowserDb } = await import("@/lib/localCompanyDocMirror");
      await upsertCompanyDocInBrowserDb(
        fsId,
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

    return { ok: true, docId: docRef.id };
  } catch (e) {
    console.warn("[savePhotoToUnassigned] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown_error" };
  }
}
