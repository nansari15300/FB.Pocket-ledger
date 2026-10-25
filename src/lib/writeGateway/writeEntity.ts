"use client";

/**
 * Unified company-scoped write entry — nayi mutations yahi se karo taaki SQLite + outbox + plan gate ek pipeline rahe.
 * Purane direct `setDoc`/`updateDoc` calls ko dheere-dheere yahan migrate karo (see repo grep).
 */

import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { firestore } from "@/lib/firebase";
import { isLocalOnlyMode } from "@/lib/localMode";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import {
  deleteCompanyDocFromBrowserDb,
  getCompanyDocFromBrowserDb,
  upsertCompanyDocInBrowserDb,
  type UpsertCompanyBrowserOptions,
} from "@/lib/localCompanyDocMirror";
import { canSyncCompanyToServer, enqueueCompanyDocOutbox, type VoucherOutboxOp } from "@/lib/localVoucherOutbox";
import { assertCompanyAllowsLedgerMutations } from "@/lib/security/offlinePlanWriteGate";
import { isStaticApkLedgerTransportMode } from "@/lib/staticApkLedgerArchitecture";
import { buildLedgerTombstoneFields } from "@/lib/ledgerTombstone";
import {
  apkEmbeddedSqliteFirstWritesPreferred,
  shouldForceFirestoreWritesOnStaticOrApk,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import type { Company } from "@/hooks/useCompany";
import {
  displayNameFromRecycleBinPatch,
  inferRecycleBinEntityKind,
  removeRecycleBinAlerts,
  sendRecycleBinMovedAlert,
} from "@/lib/writeGateway/legacy/recycleBinAlerts";
import { auth } from "@/lib/firebase";
import { isSoftDeleteLedgerPatch, purgeGhostLocalCompanyDoc } from "@/lib/purgeGhostLocalCompanyDoc";
import { isCompanyNotFoundError } from "@/lib/companyUpdateGuard";
import { isPureLocalLedgerCompany, companyRowUsesSqliteLedgerWrites } from "@/lib/companyStorageKind";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { companyStrategyUsesSqliteFirstLedgerWrites } from "@/lib/staticAttachmentDisplayUrl";
import { isOnlineCompanyLedgerCloudSyncAllowed } from "@/lib/onlineCompanySelectorSyncPolicy";
import { isPocketBaseCompany, isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";

export type WriteEntityOperation = "create" | "update" | "delete";

export type WriteEntityRequest = {
  /** SQLite registry row id (often same as Firestore company id). */
  companyId: string;
  collectionName: string;
  docId: string;
  operation: WriteEntityOperation;
  /** create/update payload; delete par optional (ignored). */
  data?: Record<string, unknown>;
  /** SQLite mirror flags + Firestore `setDoc` merge + auto-id create. */
  options?: UpsertCompanyBrowserOptions & { useFirestoreAutoId?: boolean; merge?: boolean };
};

export type WriteEntityResult =
  | { ok: true; docId: string }
  | { ok: false; error: string };

/** Firestore path ke liye authoritative company id (mirror company mismatch fix). */
async function resolveFirestoreCompanyId(localCompanyId: string): Promise<string> {
  const reg = await getLocalCompanyById(localCompanyId, { includeDeleted: true });
  const raw = reg ? String((reg as Record<string, unknown>).authoritativeCompanyId || "").trim() : "";
  return raw || localCompanyId.trim();
}

/** Local-first: SQLite UPSERT + sync_outbox — local / PL Server / Online Firebase. */
async function shouldWriteLocalLedgerFirst(localCompanyId: string): Promise<boolean> {
  // Pocket Ledger Server (PocketBase) company: always SQLite + outbox; the outbox flush pushes to PocketBase.
  if (isPocketBaseCompanyId(localCompanyId)) return true;
  if (isFirebaseLedgerDataSyncDisabled()) return true;
  const reg = await getLocalCompanyById(localCompanyId, { includeDeleted: true });
  if (reg && isPocketBaseCompany(localCompanyId, reg)) return true;
  if (shouldForceFirestoreWritesOnStaticOrApk()) return false;
  if (!isOnlineCompanyLedgerCloudSyncAllowed(localCompanyId, reg as Company | null)) return true;
  // Global local-first (web = EXE): SQLite + outbox even when the company registry row is not mirrored yet.
  if (apkEmbeddedSqliteFirstWritesPreferred()) return true;
  if (reg && companyStrategyUsesSqliteFirstLedgerWrites(reg)) return true;
  if (isStaticAppBuild() && reg) return companyRowUsesSqliteLedgerWrites(reg);
  if (reg && companyRowUsesSqliteLedgerWrites(reg)) return true;
  if (reg && isPureLocalLedgerCompany(reg)) return true;
  if (!isLocalOnlyMode()) return false;
  return canSyncCompanyToServer(localCompanyId);
}

async function mergeWithExistingLocalDoc(
  companyId: string,
  collectionName: string,
  docId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const existing = (await getCompanyDocFromBrowserDb(companyId, collectionName, docId)) ?? {};
  return { ...existing, ...patch, id: docId };
}

async function touchLedgerChangeLog(
  fsCompanyId: string,
  collectionName: string,
  docId: string,
  op: WriteEntityOperation
): Promise<void> {
  const fsId = String(fsCompanyId || "").trim();
  const coll = String(collectionName || "").trim();
  const id = String(docId || "").trim();
  if (!fsId || !coll || !id || coll.startsWith("_")) return;
  const safe = `${Date.now()}_${coll}_${id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
  await setDoc(doc(firestore, `companies/${fsId}/_pl_change_log`, safe), {
    collectionName: coll,
    docId: id,
    op,
    at: serverTimestamp(),
    source: "writeEntity",
  });
}

/**
 * Single write gate: pehle plan (vouchers), phir local SQLite+outbox jab allowed, warna Firestore.
 * UI optimistic: yahan await ke baad caller apna state pehle hi update kar sakta tha — is function ko await karo.
 */
export async function writeEntity(req: WriteEntityRequest): Promise<WriteEntityResult> {
  const companyId = String(req.companyId || "").trim();
  const collectionName = String(req.collectionName || "").trim();
  const rawOpts = req.options ?? {};
  const { useFirestoreAutoId: useAutoId, merge: mergeSetDoc, ...upsertOpts } = rawOpts;
  const docIdRaw = String(req.docId || "").trim();
  const docIdRequired = !(useAutoId === true && req.operation === "create");
  const docId = docIdRaw;
  if (!companyId || !collectionName || (docIdRequired && !docId)) {
    return { ok: false, error: "writeEntity: missing companyId, collectionName, or docId" };
  }

  try {
    const { assertPlServerStaffWriteAllowed } = await import("@/lib/plServerStaffOfflinePolicy");
    await assertPlServerStaffWriteAllowed(companyId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  if (collectionName === "vouchers") {
    try {
      await assertCompanyAllowsLedgerMutations(companyId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  const fsCompanyId = await resolveFirestoreCompanyId(companyId);
  const colRef = collection(firestore, "companies", fsCompanyId, collectionName);
  const effectiveDocId =
    useAutoId === true && req.operation === "create" && !docIdRaw
      ? typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      : docId;
  const docRef = doc(firestore, "companies", fsCompanyId, collectionName, effectiveDocId);

  if (await shouldWriteLocalLedgerFirst(companyId)) {
    if (req.operation === "delete") {
      // Static/APK: hard-delete + ghost server doc avoid — tombstone SQLite + outbox `delete` (web local-only: purana hard path).
      if (true) {
        let merged: Record<string, unknown>;
        try {
          merged = await mergeWithExistingLocalDoc(
            companyId,
            collectionName,
            effectiveDocId,
            buildLedgerTombstoneFields(effectiveDocId)
          );
          const persisted = await upsertCompanyDocInBrowserDb(companyId, collectionName, effectiveDocId, merged, upsertOpts);
          if (!persisted) {
            return { ok: false, error: "sqlite tombstone skipped" };
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "sqlite tombstone failed" };
        }
        try {
          await enqueueCompanyDocOutbox(companyId, collectionName, "delete", effectiveDocId, merged);
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "outbox delete enqueue failed" };
        }
        return { ok: true, docId: effectiveDocId };
      }
      const canFlush = await canSyncCompanyToServer(companyId);
      if (canFlush && typeof navigator !== "undefined" && navigator.onLine) {
        try {
          await deleteDoc(docRef);
        } catch (e) {
          if (!isCompanyNotFoundError(e)) {
            return { ok: false, error: e instanceof Error ? e.message : "firestore delete failed" };
          }
        }
      }
      try {
        await deleteCompanyDocFromBrowserDb(companyId, collectionName, effectiveDocId, { force: true, notify: true });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "local delete failed" };
      }
      return { ok: true, docId: effectiveDocId };
    }

    const patch = { ...(req.data || {}) } as Record<string, unknown>;
    // create + setDoc merge: local pe bhi existing row ke upar shallow merge (Firestore merge semantics ke kareeb).
    const merged =
      req.operation === "create" && mergeSetDoc === true
        ? await mergeWithExistingLocalDoc(companyId, collectionName, effectiveDocId, { ...patch, id: effectiveDocId })
        : req.operation === "create"
          ? ({ ...patch, id: effectiveDocId } as Record<string, unknown>)
          : await mergeWithExistingLocalDoc(companyId, collectionName, effectiveDocId, patch);

    try {
      const persisted = await upsertCompanyDocInBrowserDb(companyId, collectionName, effectiveDocId, merged, upsertOpts);
      if (!persisted) {
        return { ok: false, error: "sqlite upsert skipped" };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "sqlite upsert failed" };
    }
    const op: VoucherOutboxOp = req.operation === "create" ? "create" : "update";
    try {
      await enqueueCompanyDocOutbox(companyId, collectionName, op, effectiveDocId, merged);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "outbox enqueue failed" };
    }
    void notifyRecycleBinAlertAfterWrite(fsCompanyId, companyId, collectionName, effectiveDocId, merged);
    return { ok: true, docId: effectiveDocId };
  }

  // Remote-first (normal web Firebase mode): seedha Firestore — SQLite mirror listeners/`mirrorCollection` se aayega.
  try {
    if (req.operation === "delete") {
      try {
        await deleteDoc(docRef);
      } catch (e) {
        if (!isCompanyNotFoundError(e)) throw e;
      }
      await purgeGhostLocalCompanyDoc(companyId, collectionName, effectiveDocId);
      void touchLedgerChangeLog(fsCompanyId, collectionName, effectiveDocId, "delete");
      return { ok: true, docId: effectiveDocId };
    }
    if (useAutoId && req.operation === "create") {
      const payload = { ...(req.data || {}), companyId: fsCompanyId };
      const ref = await addDoc(colRef, payload);
      void touchLedgerChangeLog(fsCompanyId, collectionName, ref.id, "create");
      return { ok: true, docId: ref.id };
    }
    if (req.operation === "create" && mergeSetDoc === true) {
      await setDoc(
        docRef,
        { ...(req.data || {}), id: effectiveDocId, companyId: fsCompanyId },
        { merge: true }
      );
      void touchLedgerChangeLog(fsCompanyId, collectionName, effectiveDocId, "create");
      return { ok: true, docId: effectiveDocId };
    }
    if (req.operation === "create") {
      await setDoc(docRef, { ...(req.data || {}), id: effectiveDocId, companyId: fsCompanyId });
      void touchLedgerChangeLog(fsCompanyId, collectionName, effectiveDocId, "create");
      return { ok: true, docId: effectiveDocId };
    }
    await updateDoc(docRef, req.data || {});
    void touchLedgerChangeLog(fsCompanyId, collectionName, effectiveDocId, "update");
    void notifyRecycleBinAlertAfterWrite(fsCompanyId, companyId, collectionName, effectiveDocId, req.data || {});
    return { ok: true, docId: effectiveDocId };
  } catch (e) {
    if (
      isCompanyNotFoundError(e) &&
      req.operation === "update" &&
      isSoftDeleteLedgerPatch(req.data)
    ) {
      const localRow = await getCompanyDocFromBrowserDb(companyId, collectionName, effectiveDocId).catch(
        () => null
      );
      if (!localRow) {
        await purgeGhostLocalCompanyDoc(companyId, collectionName, effectiveDocId);
      }
      return { ok: true, docId: effectiveDocId };
    }
    return { ok: false, error: e instanceof Error ? e.message : "firestore write failed" };
  }
}

/** Master soft-delete / restore par recycle bin alert sync. */
async function notifyRecycleBinAlertAfterWrite(
  fsCompanyId: string,
  localCompanyId: string,
  collectionName: string,
  entityId: string,
  patch: Record<string, unknown>
): Promise<void> {
  if (collectionName === "vouchers") return;
  const eid = entityId.trim();
  if (!eid) return;
  if (patch.isDeleted === true) {
    const reg = await getLocalCompanyById(localCompanyId, { includeDeleted: true });
    const u = auth.currentUser;
    void sendRecycleBinMovedAlert(fsCompanyId, (reg as Company) ?? null, {
      entityKind: inferRecycleBinEntityKind(collectionName),
      entityId: eid,
      entityName: displayNameFromRecycleBinPatch(collectionName, patch),
      collectionPath: collectionName,
      performedByUserId: u?.uid,
      performedByEmail: u?.email ?? undefined,
      performedByName: u?.displayName ?? undefined,
    });
    return;
  }
  if (patch.isDeleted === false && (patch.deletedAt === null || patch.deletedAt === undefined)) {
    void removeRecycleBinAlerts(fsCompanyId, eid);
  }
}

/** UI fire-and-forget: errors console — permission UI `errorEmitter` abhi non-blocking callers rare. */
export function writeEntityNonBlocking(req: WriteEntityRequest): void {
  void writeEntity(req).catch((e) => {
    console.warn("[writeEntityNonBlocking]", e);
  });
}
