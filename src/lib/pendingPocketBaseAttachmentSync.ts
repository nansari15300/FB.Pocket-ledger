"use client";

/**
 * Retry path for PocketBase (server-gate) voucher/doc attachments that stayed as `local:<id>`
 * after a reload. The in-memory `/__pl_attachment` queue does not survive reload and is not
 * the PocketBase `pbatt:` writer. The normal outbox push (`pushOutboxRowToPocketBase`) uploads
 * the IndexedDB/native pending blob to `pl_attachments` and rewrites the doc to `pbatt:`.
 * This module re-enqueues that save when the first push already finished with `local:` still
 * in the doc.
 */

import { Timestamp } from "@/lib/pbCompat/firestore";
import { getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import {
  enqueueCompanyDocOutbox,
  flushVoucherOutbox,
  awaitVoucherOutboxFlushIdle,
  listPendingOutboxDocIdsForCompany,
} from "@/lib/localVoucherOutbox";
import {
  getPendingPayloadForLocalRef,
  removePendingFile,
  resolvePendingPayloadCompanyId,
  resolveRegistryCompanyIdForPendingItem,
  type PendingFilePayload,
} from "@/lib/localPendingFiles";
import { isPocketBaseCompany } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { isPocketBaseCompanyAttachmentSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { isServerQuotaHoldActive } from "@/lib/serverQuotaHold";
import {
  PENDING_PB_ATTACHMENT_SYNC_LOCK,
  decidePendingPocketBaseAttachmentSync,
  docHasLocalRef,
  localRefFromId,
  parseCompanyDocPath,
  pendingBlobIsUsable,
} from "@/lib/pendingPocketBaseAttachmentSyncLogic";

export type PendingPocketBaseAttachmentSyncResult = {
  success: boolean;
  uploaded?: boolean;
  error?: string;
};

const inFlightLocalIds = new Set<string>();

function webLocks(): Pick<LockManager, "request"> | null {
  try {
    if (typeof navigator === "undefined") return null;
    return navigator.locks ?? null;
  } catch {
    return null;
  }
}

async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (!locks?.request) return fn();
  return locks.request(PENDING_PB_ATTACHMENT_SYNC_LOCK, { mode: "exclusive" }, fn);
}

async function loadTargetDoc(
  registryCompanyId: string,
  collection: string,
  docId: string,
  pathCompanyId: string
): Promise<Record<string, unknown> | null> {
  const first = await getCompanyDocFromBrowserDb(registryCompanyId, collection, docId, {
    includeDeleted: true,
  });
  if (first) return first as Record<string, unknown>;
  if (pathCompanyId && pathCompanyId !== registryCompanyId) {
    const second = await getCompanyDocFromBrowserDb(pathCompanyId, collection, docId, {
      includeDeleted: true,
    });
    if (second) return second as Record<string, unknown>;
  }
  return null;
}

/**
 * Upload one persisted `local:` blob for a PocketBase company and push the rewritten
 * voucher/doc through the normal outbox path. Missing blobs are left alone.
 */
export async function syncOnePendingPocketBaseAttachment(
  item: PendingFilePayload
): Promise<PendingPocketBaseAttachmentSyncResult> {
  const localId = String(item?.id || "").trim();
  if (!localId) return { success: true, uploaded: false };

  if (inFlightLocalIds.has(localId)) {
    return { success: true, uploaded: false };
  }
  inFlightLocalIds.add(localId);
  try {
    return await withSyncLock(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return { success: false, uploaded: false, error: "offline" };
      }
      if (isServerQuotaHoldActive()) {
        return { success: false, uploaded: false, error: "Server quota pause is active: attachment kept local." };
      }

      const live = (await getPendingPayloadForLocalRef(localRefFromId(localId))) ?? item;
      const hasBlob = pendingBlobIsUsable(live?.blob ?? item.blob);
      const registryCompanyId =
        (await resolveRegistryCompanyIdForPendingItem(live || item)) ||
        resolvePendingPayloadCompanyId(live || item);
      if (!registryCompanyId) {
        return { success: false, uploaded: false, error: "pending attachment has no company id" };
      }
      const companyRow = await getLocalCompanyById(registryCompanyId, { includeDeleted: true });
      if (!isPocketBaseCompany(registryCompanyId, companyRow)) {
        return { success: false, uploaded: false, error: "not a Pocket Ledger Server company" };
      }
      if (!isPocketBaseCompanyAttachmentSyncEnabled(registryCompanyId)) {
        return { success: false, uploaded: false, error: "Pocket Ledger Server attachment sync is off" };
      }

      const parsed = parseCompanyDocPath(live?.docPath || item.docPath);
      if (!parsed) {
        return { success: false, uploaded: false, error: "invalid doc path" };
      }

      const doc = await loadTargetDoc(
        registryCompanyId,
        parsed.collection,
        parsed.docId,
        parsed.companyId
      );
      const decision = decidePendingPocketBaseAttachmentSync({
        hasBlob,
        doc,
        localId,
      });
      if (decision.action === "skip_missing_blob") {
        return { success: true, uploaded: false };
      }
      if (decision.action === "skip_not_in_doc") {
        return { success: true, uploaded: false };
      }

      try {
        const { getValidPocketBaseAuth } = await import("@/lib/pocketbaseData/pbClient");
        if (!getValidPocketBaseAuth()) {
          return { success: false, uploaded: false, error: "not signed in to Pocket Ledger Server" };
        }
      } catch {
        return { success: false, uploaded: false, error: "Pocket Ledger Server auth unavailable" };
      }

      const pendingIds = await listPendingOutboxDocIdsForCompany(registryCompanyId, parsed.collection);
      if (!pendingIds.has(parsed.docId)) {
        const payload: Record<string, unknown> = {
          ...(doc as Record<string, unknown>),
          id: parsed.docId,
          updatedAt: Timestamp.now(),
          lastEditedAt: Timestamp.now(),
          updatedAtMs: Date.now(),
        };
        await enqueueCompanyDocOutbox(
          registryCompanyId,
          parsed.collection,
          "update",
          parsed.docId,
          payload
        );
      }

      await flushVoucherOutbox();
      await awaitVoucherOutboxFlushIdle();

      const after = await loadTargetDoc(
        registryCompanyId,
        parsed.collection,
        parsed.docId,
        parsed.companyId
      );
      if (docHasLocalRef(after, localId)) {
        return {
          success: false,
          uploaded: false,
          error: "voucher still has local: file after outbox flush",
        };
      }

      const stillPending = await getPendingPayloadForLocalRef(localRefFromId(localId));
      if (stillPending) {
        await removePendingFile(localId);
      }
      return { success: true, uploaded: true };
    });
  } catch (error) {
    return {
      success: false,
      uploaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    inFlightLocalIds.delete(localId);
  }
}
