"use client";

/**
 * Client → `sync_outbox` row (`client_write_id`, `nonce`, `payload_hash`) → `flushVoucherOutbox` →
 * Firestore `runTransaction`: first duplicate check on `companies/{fs}/_pl_ledger_idem/{client_write_id}`,
 * then write idem doc + target subcollection doc together — same `payload_hash` is not applied twice.
 */

import { isServerQuotaHoldActive, startServerQuotaHold } from "@/lib/serverQuotaHold";
import { isPocketBaseOnlyAppSession } from "@/lib/pbOnlySessionMarker";
import {
  doc,
  serverTimestamp,
  Timestamp,
  enableNetwork,
  deleteField,
} from "@/lib/pbCompat/firestore";
// Reads/writes of company docs go through the seam / write gateway so PocketBase companies hit the
// server (`pl_data`), never Firestore. Importing `getDoc`/`setDoc` straight from pbCompat/ was a
// leak: these call sites run for every company, including server ones.
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { firestoreRunTransaction as runTransaction } from "@/lib/writeGateway/firestoreMutationsInternal";
import {
  firestore,
  firestoreNetworkDisabledByApi,
  queueFirestoreNetworkOp,
  markFirestoreNetworkDisabledByApi,
  settleAfterFirestoreNetworkEnabled,
} from "@/lib/plClientSession";
import { getBrowserDbForCompanyId } from "@/lib/localSqlite";
import {
  apkEmbeddedSqliteFirstWritesPreferred,
  shouldAutoFlushOutboxAfterEnqueue,
} from "@/lib/apkOnlineFirestoreWritePolicy";
import { isFirebaseLedgerDataSyncDisabled } from "@/lib/firebaseLedgerDataSyncDisabled";
import { isFirebaseLedgerCompanyDataSyncEnabled } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { isPocketBaseCompany, isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import {
  PB_OUTBOX_BLOCKED_PREFIX,
  blockPbOutboxCompany,
  clearPbOutboxCompanyBlock,
  clearPbOutboxRowBackoff,
  clearPbServerBackoff,
  deferPbOutboxCompanyProbe,
  getPbOutboxCompanyBlock,
  isPbOutboxRowBackedOff,
  isPbServerBackedOff,
  isPocketBaseCompanyMissingError,
  notePbOutboxRowFailure,
  notePbServerDown,
} from "@/lib/pocketbaseData/pbOutboxBlock";
import { mirrorCompanyDocToBrowserDb, getCompanyDocFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { getLocalCompanyById, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { coerceVoucherDocumentDate } from "@/lib/voucherDateNormalize";
import { PL_CLIENT_OFFLINE_FIRST_PERSIST_MS } from "@/lib/localMirrorServerMeta";
import {
  PL_ENCRYPTED_IV_FIELD,
  PL_ENCRYPTED_PAYLOAD_FIELD,
  PL_ENCRYPTED_V1_FIELD,
  decryptServerBackupPayloadJson,
  encryptServerBackupPayloadJson,
  getBackupEncryptionPassphraseFromSession,
} from "@/lib/serverBackupEncryption";
import { normalizeFileUrlsField } from "@/lib/voucherAttachmentNormalize";
import { isDeviceLocalCompany } from "@/lib/companyStorageKind";
import { isLocalFileRef } from "@/lib/localPendingFiles";
import {
  hydrateVoucherLocalAttachmentsForServer,
  hydratePendingLocalFileRefsDeep,
} from "@/lib/hydrateVoucherLocalAttachmentsForServer";
import { isCompanyNotFoundError } from "@/lib/companyUpdateGuard";
import {
  canReconcileLocalDocViaFirebase,
  readLocalFirebaseReconcileConfig,
  stripAttachmentFieldsForInvitedLedgerReconcile,
} from "@/lib/localFirebaseReconcile";

/** REST `Commit` pe idem create race → `already-exists`; outbox duplicate-cleanup pehchan ke liye. */
function isFirestoreAlreadyExistsError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = String((e as { code?: string }).code || "");
  return code === "already-exists" || code === "already_exists";
}

function attachmentUrlsFingerprint(urls: readonly string[]): string {
  return urls.map((u) => String(u || "").trim()).filter(Boolean).join("\x1e");
}

/** Web/other devices cannot resolve `local:` — never persist those refs to Firestore. */
function cloudSafeVoucherFileUrls(urls: readonly string[]): string[] {
  return urls.filter((u) => typeof u === "string" && u.trim() && !isLocalFileRef(u));
}

function stripLocalFileRefsFromFirestoreDoc(docFields: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return isLocalFileRef(v) ? "" : v;
    if (Array.isArray(v)) {
      return v
        .map(walk)
        .filter((x) => x !== "" && x != null);
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v instanceof Date) return v;
      if (typeof (v as { toDate?: unknown }).toDate === "function") return v;
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o)) {
        const next = walk(o[k]);
        if (k === "unassignedFile" && next && typeof next === "object") {
          const uf = next as Record<string, unknown>;
          const url = typeof uf.url === "string" ? uf.url.trim() : "";
          if (!url || isLocalFileRef(url)) {
            out[k] = null;
            continue;
          }
        }
        out[k] = next;
      }
      return out;
    }
    return v;
  };
  const stripped = walk(docFields) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(stripped, "fileUrls")) {
    stripped.fileUrls = cloudSafeVoucherFileUrls(normalizeFileUrlsField(stripped.fileUrls));
    stripped.files = [];
    stripped.unassignedFile = null;
  }
  for (const key of MASTER_ATTACHMENT_SCALAR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(stripped, key)) continue;
    const raw = stripped[key];
    if (typeof raw === "string" && isLocalFileRef(raw)) stripped[key] = "";
  }
  if (Object.prototype.hasOwnProperty.call(stripped, "documentFileUrls")) {
    stripped.documentFileUrls = cloudSafeVoucherFileUrls(normalizeFileUrlsField(stripped.documentFileUrls));
  }
  return stripped;
}

const MASTER_ATTACHMENT_SCALAR_KEYS = ["fileUrl", "avatarUrl", "logoUrl"] as const;
const MASTER_ATTACHMENT_COLLECTIONS = new Set([
  "parties",
  "bank_accounts",
  "staff",
  "taxes",
  "expense_accounts",
  "items",
]);

function isClearedMasterAttachmentScalar(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return true;
  const low = s.toLowerCase();
  return low === "null" || low === "undefined" || low === "none" || low === "n/a";
}

function scalarAttachmentFingerprint(value: unknown): string {
  if (isClearedMasterAttachmentScalar(value)) return "";
  return String(value || "").trim();
}

/** EXE/APK outbox merge: empty master avatar must `deleteField` — `null` merge miss se web par purani photo reh jati hai. */
function applyMasterAttachmentFieldsForFirestoreMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const key of MASTER_ATTACHMENT_SCALAR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (isClearedMasterAttachmentScalar(source[key])) {
      target[key] = deleteField();
    } else if (typeof source[key] === "string" && isLocalFileRef(String(source[key]))) {
      target[key] = deleteField();
    } else {
      target[key] = source[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, "documentFileUrls")) {
    target.documentFileUrls = Array.isArray(source.documentFileUrls)
      ? source.documentFileUrls.filter(
          (u): u is string => typeof u === "string" && Boolean(u.trim()) && !isLocalFileRef(u)
        )
      : [];
  }
}

/** Soft-delete outbox flush remirrors; permanent purge must hard-wipe local again. */
async function applyLocalMirrorAfterOutboxFlush(params: {
  companyId: string;
  collectionName: string;
  docId: string;
  outboxPayload: unknown;
  writtenFields?: Record<string, unknown> | null;
  isPermanentHardPurge: boolean;
}): Promise<void> {
  if (params.isPermanentHardPurge) {
    const { deleteCompanyDocFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
    await deleteCompanyDocFromBrowserDb(params.companyId, params.collectionName, params.docId, {
      force: true,
      notify: true,
    });
    return;
  }
  await mirrorCompanyDocAfterOutboxFlush(
    params.companyId,
    params.collectionName,
    params.docId,
    params.outboxPayload,
    params.writtenFields
  );
}

/**
 * Post-flush: outbox ki intended `fileUrls` enforce karo.
 * Server/cache kabhi purani HTTPS wapas laata hai (merge miss / unassignedFile leftover) — SQLite + Firestore dubara trim.
 */
async function mirrorCompanyDocAfterOutboxFlush(
  companyId: string,
  collectionName: string,
  docId: string,
  outboxPayload: unknown,
  writtenFields?: Record<string, unknown> | null
): Promise<void> {
  await mirrorCompanyDocToBrowserDb(companyId, collectionName, docId);
  const payloadObj =
    outboxPayload && typeof outboxPayload === "object"
      ? (outboxPayload as Record<string, unknown>)
      : null;
  const source =
    writtenFields && typeof writtenFields === "object" ? writtenFields : payloadObj;

  if (collectionName === "vouchers") {
    const voucherSource =
      writtenFields && Object.prototype.hasOwnProperty.call(writtenFields, "fileUrls")
        ? writtenFields
        : payloadObj;
    if (!voucherSource || !Object.prototype.hasOwnProperty.call(voucherSource, "fileUrls")) return;

    const rawIntended = normalizeFileUrlsField(voucherSource.fileUrls);
    const hadLocalRefs = rawIntended.some((u) => isLocalFileRef(u));
    const intended = cloudSafeVoucherFileUrls(rawIntended);
    const explicitEmptySave =
      Object.prototype.hasOwnProperty.call(voucherSource, "fileUrls") &&
      Array.isArray(voucherSource.fileUrls) &&
      rawIntended.length === 0;
    // Pending hydrate only: payload still all-`local:` — Firestore pe purani HTTPS mat [] se clobber.
    // Explicit `fileUrls: []` (user delete) hamesha enforce — ghost URL / generic tile rokne ke liye.
    if (hadLocalRefs && intended.length === 0 && !explicitEmptySave) return;
    const intendedFp = attachmentUrlsFingerprint(intended);
    const { upsertCompanyDocInBrowserDb, notifyBrowserDbCollectionUpdated } = await import(
      "@/lib/localCompanyDocMirror"
    );

    const local = await getCompanyDocFromBrowserDb(companyId, collectionName, docId, { includeDeleted: true });
    const localFp = attachmentUrlsFingerprint(normalizeFileUrlsField(local?.fileUrls));
    const localUf =
      local?.unassignedFile && typeof local.unassignedFile === "object"
        ? String((local.unassignedFile as { url?: string }).url || "").trim()
        : "";
    if (local && (localFp !== intendedFp || (intended.length === 0 && Boolean(localUf)))) {
      await upsertCompanyDocInBrowserDb(
        companyId,
        collectionName,
        docId,
        {
          ...(local as Record<string, unknown>),
          fileUrls: intended,
          files: [],
          unassignedFile: null,
          id: docId,
        },
        { notify: true, force: true, skipPlanMutationGate: true }
      );
      notifyBrowserDbCollectionUpdated(companyId, collectionName);
    }

    try {
      const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
      const fsCompanyId =
        String((reg as Record<string, unknown> | null)?.authoritativeCompanyId || companyId).trim() || companyId;
      const ref = doc(firestore, `companies/${fsCompanyId}/vouchers`, docId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const remote = snap.data() as Record<string, unknown>;
      const remoteFp = attachmentUrlsFingerprint(normalizeFileUrlsField(remote.fileUrls));
      const remoteUf =
        remote.unassignedFile && typeof remote.unassignedFile === "object"
          ? String((remote.unassignedFile as { url?: string }).url || "").trim()
          : "";
      if (process.env.NODE_ENV !== "production") {
        void import("@/lib/attachmentDeleteTrace").then((m) =>
          m.traceAttachmentUrlsChange({
            source: "outbox.postFlush.firestoreReadback",
            companyId,
            voucherId: docId,
            prevUrls: intended,
            nextUrls: normalizeFileUrlsField(remote.fileUrls),
            extra: { hadUnassignedFile: Boolean(remoteUf), remoteMatchesIntent: remoteFp === intendedFp && !remoteUf },
          })
        );
      }
      if (remoteFp === intendedFp && !remoteUf) return;
      await setDoc(
        ref,
        {
          fileUrls: intended,
          files: [],
          unassignedFile: deleteField(),
          id: docId,
        },
        { merge: true }
      );
      if (process.env.NODE_ENV !== "production") {
        console.warn("[QUEUE_FLUSH] attachment enforce after bounce", {
          companyId,
          docId,
          intendedCount: intended.length,
          remoteCount: normalizeFileUrlsField(remote.fileUrls).length,
          hadUnassignedFile: Boolean(remoteUf),
        });
      }
    } catch (e) {
      console.warn("[localVoucherOutbox] post-flush attachment enforce failed", e);
    }
    return;
  }

  if (!MASTER_ATTACHMENT_COLLECTIONS.has(collectionName) || !source) return;
  const hasExplicitScalar = MASTER_ATTACHMENT_SCALAR_KEYS.some((k) =>
    Object.prototype.hasOwnProperty.call(source, k)
  );
  const hasExplicitDocs = Object.prototype.hasOwnProperty.call(source, "documentFileUrls");
  const hasExplicitFileUrls = Object.prototype.hasOwnProperty.call(source, "fileUrls");
  if (!hasExplicitScalar && !hasExplicitDocs && !hasExplicitFileUrls) return;

  const intendedDocs = hasExplicitDocs
    ? Array.isArray(source.documentFileUrls)
      ? source.documentFileUrls.filter((u): u is string => typeof u === "string" && Boolean(u.trim()))
      : []
    : null;
  const intendedFileUrls = hasExplicitFileUrls ? normalizeFileUrlsField(source.fileUrls) : null;

  const { upsertCompanyDocInBrowserDb, notifyBrowserDbCollectionUpdated } = await import(
    "@/lib/localCompanyDocMirror"
  );
  const local = await getCompanyDocFromBrowserDb(companyId, collectionName, docId, { includeDeleted: true });
  if (local) {
    let localMismatch = false;
    const patch: Record<string, unknown> = { ...(local as Record<string, unknown>), id: docId };
    for (const key of MASTER_ATTACHMENT_SCALAR_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const intended = isClearedMasterAttachmentScalar(source[key]) ? null : String(source[key] || "").trim();
      const have = scalarAttachmentFingerprint(local[key]);
      if (have !== (intended || "")) {
        patch[key] = intended;
        localMismatch = true;
      }
    }
    if (intendedDocs && attachmentUrlsFingerprint(normalizeFileUrlsField(local.documentFileUrls)) !== attachmentUrlsFingerprint(intendedDocs)) {
      patch.documentFileUrls = intendedDocs;
      localMismatch = true;
    }
    if (
      intendedFileUrls &&
      attachmentUrlsFingerprint(normalizeFileUrlsField(local.fileUrls)) !== attachmentUrlsFingerprint(intendedFileUrls)
    ) {
      patch.fileUrls = intendedFileUrls;
      localMismatch = true;
    }
    if (localMismatch) {
      await upsertCompanyDocInBrowserDb(companyId, collectionName, docId, patch, {
        notify: true,
        force: true,
        skipPlanMutationGate: true,
      });
      notifyBrowserDbCollectionUpdated(companyId, collectionName, { immediate: true, source: "local_write" });
    }
  }

  try {
    const reg = await getLocalCompanyById(companyId, { includeDeleted: true });
    const fsCompanyId =
      String((reg as Record<string, unknown> | null)?.authoritativeCompanyId || companyId).trim() || companyId;
    const ref = doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const remote = snap.data() as Record<string, unknown>;
    const firestorePatch: Record<string, unknown> = {};
    let remoteMismatch = false;
    for (const key of MASTER_ATTACHMENT_SCALAR_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const intendedCleared = isClearedMasterAttachmentScalar(source[key]);
      const remoteFp = scalarAttachmentFingerprint(remote[key]);
      const intendedFp = intendedCleared ? "" : String(source[key] || "").trim();
      if (remoteFp === intendedFp) continue;
      firestorePatch[key] = intendedCleared ? deleteField() : source[key];
      remoteMismatch = true;
    }
    if (intendedDocs) {
      const remoteDocs = normalizeFileUrlsField(remote.documentFileUrls);
      if (attachmentUrlsFingerprint(remoteDocs) !== attachmentUrlsFingerprint(intendedDocs)) {
        firestorePatch.documentFileUrls = intendedDocs;
        remoteMismatch = true;
      }
    }
    if (intendedFileUrls) {
      const remoteFiles = normalizeFileUrlsField(remote.fileUrls);
      if (attachmentUrlsFingerprint(remoteFiles) !== attachmentUrlsFingerprint(intendedFileUrls)) {
        firestorePatch.fileUrls = intendedFileUrls;
        remoteMismatch = true;
      }
    }
    if (!remoteMismatch) return;
    await setDoc(ref, firestorePatch, { merge: true });
  } catch (e) {
    console.warn("[localVoucherOutbox] post-flush master attachment enforce failed", e);
  }
}

/**
 * Encrypted flush: merge server doc + outbox delta on update (partial outbox can become full ciphertext).
 * When merging from plaintext server docs, strip `plEncrypted*` fields before mixing.
 */
async function mergeForEncryptedFlush(
  fsCompanyId: string,
  collectionName: string,
  docId: string,
  op: string,
  docFields: Record<string, unknown>,
  localCompanyId: string,
  reg: LocalCompanyDoc
): Promise<Record<string, unknown>> {
  if (op === "create") return { ...docFields };
  const ref = doc(firestore, `companies/${fsCompanyId}/${collectionName}`, docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ...docFields };
  const existing = snap.data() as Record<string, unknown>;
  if (existing[PL_ENCRYPTED_V1_FIELD] === true) {
    const phrase = getBackupEncryptionPassphraseFromSession(localCompanyId);
    const salt = String((reg as Record<string, unknown>).encryptServerBackupSalt ?? "");
    if (!phrase || !salt) throw new Error("mergeForEncryptedFlush: missing session key or salt — log in with company username/password");
    const iv = String(existing[PL_ENCRYPTED_IV_FIELD] ?? "");
    const payload = String(existing[PL_ENCRYPTED_PAYLOAD_FIELD] ?? "");
    const json = await decryptServerBackupPayloadJson(iv, payload, phrase, salt);
    const prev = outboxJsonParse(json);
    return { ...prev, ...docFields };
  }
  const {
    [PL_ENCRYPTED_V1_FIELD]: _e,
    [PL_ENCRYPTED_IV_FIELD]: _i,
    [PL_ENCRYPTED_PAYLOAD_FIELD]: _p,
    ...rest
  } = existing as Record<string, unknown>;
  return { ...rest, ...docFields };
}

/** Treat as offline for queueing when the network/backend is down (not permission errors). */
export function isLikelyOfflineFirestoreError(err: unknown): boolean {
  if (err == null) return false;
  const any = err as { code?: string; message?: string };
  const code = any.code ? String(any.code) : "";
  const msg = any.message ? String(any.message).toLowerCase() : "";
  if (code === "unavailable" || code === "deadline-exceeded") return true;
  if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("client is offline")) return true;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return false;
}

function stripUndefinedDeep(obj: unknown): unknown {
  if (typeof obj === "bigint") return (obj as bigint).toString();
  if (typeof File !== "undefined" && obj instanceof File) return undefined;
  if (typeof Blob !== "undefined" && obj instanceof Blob) return undefined;
  if (Array.isArray(obj)) return (obj as unknown[]).map(stripUndefinedDeep).filter((v) => v !== undefined);
  if (obj !== null && typeof obj === "object") {
    // `Date` has no enumerable keys — if `Object.keys` walks it you get `{}` and wipe voucher `date` from outbox/SQLite.
    if (obj instanceof Date) {
      return isNaN((obj as Date).getTime()) ? undefined : obj;
    }
    if (obj instanceof Timestamp) return obj;
    if (typeof (obj as { toDate?: () => Date }).toDate === "function") return obj;
    const o = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === undefined) continue;
      const next = stripUndefinedDeep(v);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return obj;
}

/** Serialize Firestore-like values to JSON-safe form (revive on flush). */
export function outboxJsonStringify(payload: Record<string, unknown>): string {
  const cleaned = stripUndefinedDeep(payload) as Record<string, unknown>;
  return JSON.stringify(cleaned, (_k, v) => {
    if (v && typeof v === "object" && "seconds" in v && "nanoseconds" in v && typeof (v as Timestamp).toDate === "function") {
      const t = v as Timestamp;
      return { __fsTs: true, seconds: t.seconds, nanoseconds: t.nanoseconds };
    }
    if (v instanceof Date) {
      return { __fsTs: true, seconds: Math.floor(v.getTime() / 1000), nanoseconds: 0 };
    }
    return v;
  });
}

export function outboxJsonParse(raw: string): Record<string, unknown> {
  return JSON.parse(raw, (_k, v) => {
    if (v && typeof v === "object" && (v as { __fsTs?: boolean }).__fsTs === true && typeof (v as { seconds?: number }).seconds === "number") {
      const o = v as { seconds: number; nanoseconds?: number };
      return new Timestamp(o.seconds, o.nanoseconds ?? 0);
    }
    return v;
  }) as Record<string, unknown>;
}

export type VoucherOutboxOp = "create" | "update" | "delete";

/** Outbox / patchVoucherFields: true for online-mirror companies — direct Firestore sync is allowed. */
export async function canSyncCompanyToServer(companyId: string): Promise<boolean> {
  // Cloud mirror row: `storageOption` may be missing — old `(c.storageOption || "local")` incorrectly blocked sync
  const localCompany = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!localCompany) return false;
  if ((localCompany as { plServerShared?: boolean }).plServerShared === true) return false;
  if (isPocketBaseCompany(companyId, localCompany)) return true;
  const c = localCompany as Record<string, unknown>;
  const soRaw = c.storageOption;
  const storageOption =
    typeof soRaw === "string" && soRaw.trim() !== "" ? soRaw.toLowerCase().trim() : "";
  const syncPolicy = String(c.syncPolicy || "").toLowerCase();
  const syncedFromCloud = c.syncedFromCloud === true;
  const hasAuthoritative = String(c.authoritativeCompanyId || "").trim().length > 0;
  const explicitOfflineOnly =
    storageOption === "local" &&
    !syncedFromCloud &&
    !hasAuthoritative &&
    syncPolicy !== "online";
  if (explicitOfflineOnly) return false;
  return (
    storageOption === "firebase" ||
    syncPolicy === "online" ||
    syncedFromCloud === true ||
    hasAuthoritative ||
    storageOption === ""
  );
}

/** Doc-level gate: local company par sirf invited reconciliation ledger + related vouchers. */
export async function canSyncCompanyCollectionToServer(
  companyId: string,
  collectionName: string,
  docId?: string,
  payload?: Record<string, unknown>
): Promise<boolean> {
  const localCompany = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!localCompany) return false;
  if (await canSyncCompanyToServer(companyId)) return true;
  if (!docId) return false;
  return canReconcileLocalDocViaFirebase(localCompany, companyId, collectionName, docId, payload);
}

/** Drop outbox rows only for truly local-only companies — if `storageOption` is missing, treat as ambiguous and do not delete. */
function isPureLocalOnlyCompanyRow(localCompany: LocalCompanyDoc): boolean {
  const c = localCompany as Record<string, unknown>;
  const soRaw = c.storageOption;
  const storageOption =
    typeof soRaw === "string" && soRaw.trim() !== "" ? soRaw.toLowerCase().trim() : "";
  if (storageOption === "") return false;
  if (storageOption === "firebase") return false;
  if (c.syncedFromCloud === true) return false;
  if (String(c.syncPolicy || "").toLowerCase() === "online") return false;
  if (String(c.authoritativeCompanyId || "").trim()) return false;
  return storageOption === "local";
}

/** Remove any prior pending row for the same doc+op so we do not flush stale duplicates. */
export async function enqueueCompanyDocOutbox(
  companyId: string,
  collectionName: string,
  op: VoucherOutboxOp,
  docId: string,
  payload: Record<string, unknown>
): Promise<void> {
  // SQLite-first callers enqueue; live online Firebase bhi (background flush). Pure local-only canSync false → skip.
  if (!companyId || !collectionName || !docId) return;
  // Pocket Ledger Server companies always queue (registry row may not be mirrored yet on web).
  if (
    !isPocketBaseCompanyId(companyId) &&
    !(await canSyncCompanyCollectionToServer(companyId, collectionName, docId, payload))
  ) {
    return;
  }
  const db = await getBrowserDbForCompanyId(companyId);
  if (!db) return;
  const outboxId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `ob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const json = outboxJsonStringify(payload);
  const now = Date.now();
  // Anti-spoof / replay-ready metadata — server future: `client_write_id` idempotency + `payload_hash` integrity.
  const clientWriteId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `cw_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const nonce =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `n_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const { computeSha256HexFromStringUtf8 } = await import("@/lib/security/sha256Hex");
  const payloadHash = await computeSha256HexFromStringUtf8(json);
  // Remove older row for same entity+op so the latest payload is what gets flushed.
  db.prepare(`DELETE FROM sync_outbox WHERE company_id = ? AND collection_name = ? AND doc_id = ? AND op = ?`).run(
    companyId,
    collectionName,
    docId,
    op
  );
  db.prepare(
    `INSERT INTO sync_outbox (outbox_id, company_id, collection_name, doc_id, op, payload, created_at, client_write_id, nonce, payload_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(outboxId, companyId, collectionName, docId, op, json, now, clientWriteId, nonce, payloadHash);
  // Offline-first: flush background — embedded offline par band taaki Firestore Write stream + "Saving…" na atke.
  if (shouldAutoFlushOutboxAfterEnqueue()) {
    void flushVoucherOutbox().catch((e) => {
      console.warn("[localVoucherOutbox] background flush after enqueue failed", e);
    });
  }
}

/** Backward compatibility: legacy voucher code can keep calling this wrapper. */
export async function enqueueVoucherOutbox(
  companyId: string,
  op: VoucherOutboxOp,
  docId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await enqueueCompanyDocOutbox(companyId, "vouchers", op, docId, payload);
}

/** Before a full local restore: clear old pending outbox rows or a stale flush can overwrite fresh data */
export async function clearSyncOutboxForCompany(companyId: string): Promise<void> {
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db || !companyId) return;
    db.prepare(`DELETE FROM sync_outbox WHERE company_id = ?`).run(companyId);
  } catch (e) {
    console.warn("[localVoucherOutbox] clearSyncOutboxForCompany failed", e);
  }
}

/** After a direct Firestore update: remove matching outbox rows so an old flush cannot overwrite. */
/** APK online banner: count pending outbox rows in SQLite for the company. */
export async function countSyncOutboxRowsForCompany(companyId: string): Promise<number> {
  try {
    const cid = companyId.trim();
    if (!cid) return 0;
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(1) as c FROM sync_outbox WHERE company_id = ?`).get(cid) as { c?: number };
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

export async function listPendingOutboxDocIdsForCompany(
  companyId: string,
  collectionName: string
): Promise<Set<string>> {
  const payloads = await readPendingOutboxPayloadsForCompany(companyId, collectionName);
  return new Set(payloads.keys());
}

/** Pending/failed/paused outbox payloads — stale Firestore snapshot se local edit (narration etc.) mat wipe. */
export async function readPendingOutboxPayloadsForCompany(
  companyId: string,
  collectionName: string
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  try {
    const cid = companyId.trim();
    const coll = collectionName.trim();
    if (!cid || !coll) return out;
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return out;
    const rows = db
      .prepare(
        `SELECT doc_id, payload FROM sync_outbox WHERE company_id = ? AND collection_name = ?`
      )
      .all(cid, coll) as Array<{ doc_id?: string; payload?: string }>;
    for (const row of rows) {
      const id = String(row?.doc_id || "").trim();
      if (!id) continue;
      try {
        const payload = outboxJsonParse(String(row.payload || "{}"));
        if (payload && typeof payload === "object") {
          out.set(id, { ...(payload as Record<string, unknown>), id });
        } else {
          out.set(id, { id });
        }
      } catch {
        out.set(id, { id });
      }
    }
  } catch {
    /* empty */
  }
  return out;
}

/** Firestore pull merge: pending approve outbox row abhi flush na hua ho to `isApproved` preserve. */
export async function readPendingApprovalOutboxByVoucherId(
  companyId: string
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  try {
    const cid = companyId.trim();
    if (!cid) return out;
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return out;
    const rows = db
      .prepare(
        `SELECT doc_id, payload FROM sync_outbox WHERE company_id = ? AND collection_name = 'vouchers'`
      )
      .all(cid) as Array<{ doc_id?: string; payload?: string }>;
    for (const row of rows) {
      const id = String(row?.doc_id || "").trim();
      if (!id) continue;
      try {
        const payload = outboxJsonParse(String(row.payload || "{}"));
        if (payload.isApproved === true) out.set(id, payload);
      } catch {
        /* skip row */
      }
    }
  } catch {
    /* empty */
  }
  return out;
}

/** Bill-wise link: pending outbox allocations — stale snapshot mirror pe wipe mat karo. */
export async function readPendingBillWiseOutboxByVoucherId(
  companyId: string
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  try {
    const cid = companyId.trim();
    if (!cid) return out;
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return out;
    const rows = db
      .prepare(
        `SELECT doc_id, payload FROM sync_outbox WHERE company_id = ? AND collection_name = 'vouchers'`
      )
      .all(cid) as Array<{ doc_id?: string; payload?: string }>;
    for (const row of rows) {
      const id = String(row?.doc_id || "").trim();
      if (!id) continue;
      try {
        const payload = outboxJsonParse(String(row.payload || "{}"));
        if (Array.isArray(payload.allocations)) out.set(id, payload);
      } catch {
        /* skip row */
      }
    }
  } catch {
    /* empty */
  }
  return out;
}

/** Approve / Approve All: server pe turant push — refresh se pehle Firestore align ho. */
export function scheduleVoucherApprovalOutboxFlush(companyId: string, voucherIds: string[]): void {
  const cid = String(companyId || "").trim();
  const ids = Array.from(new Set((voucherIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!cid || !ids.length) return;
  void (async () => {
    for (const docId of ids) {
      await flushVoucherOutbox({
        priority: { companyId: cid, collectionName: "vouchers", docId },
        only: { companyId: cid, collectionName: "vouchers", docId },
      });
    }
  })().catch(() => undefined);
}

/** Bill-wise link: source + targets turant cloud — EXE live snapshot 20–50s wait mat kare. */
export function scheduleVoucherLinkOutboxFlush(companyId: string, voucherIds: string[]): void {
  scheduleVoucherApprovalOutboxFlush(companyId, voucherIds);
}

export async function removeOutboxRowsForCompanyDoc(
  companyId: string,
  collectionName: string,
  docId: string
): Promise<void> {
  if (!companyId || !collectionName || !docId) return;
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return;
    db.prepare(`DELETE FROM sync_outbox WHERE company_id = ? AND collection_name = ? AND doc_id = ?`).run(
      companyId,
      collectionName,
      docId
    );
  } catch (e) {
    console.warn("[localVoucherOutbox] removeOutboxRowsForCompanyDoc failed", e);
  }
}

/**
 * Drop every pending outbox row for one company collection (e.g. after permission-denied).
 * Synced / unwritable rows must leave `sync_outbox` — otherwise health shows hundreds “pending”
 * forever and every 8s flush re-walks them (tax/dashboard Page Unresponsive).
 */
export async function deleteOutboxRowsForCompanyCollection(
  companyId: string,
  collectionName: string
): Promise<number> {
  const cid = String(companyId || "").trim();
  const col = String(collectionName || "").trim();
  if (!cid || !col) return 0;
  try {
    const db = await getBrowserDbForCompanyId(cid);
    if (!db) return 0;
    const before = db
      .prepare(`SELECT COUNT(1) as c FROM sync_outbox WHERE company_id = ? AND collection_name = ?`)
      .get(cid, col) as { c?: number };
    const n = Number(before?.c ?? 0);
    if (n <= 0) return 0;
    // Phase 2 hotfix: never purge on permission-denied / billing. Keep rows, mark failed for retry.
    ensureOutboxRetryColumns(db);
    db.prepare(
      `UPDATE sync_outbox SET status = 'failed', last_error = COALESCE(last_error, ?) WHERE company_id = ? AND collection_name = ?`
    ).run("permission-denied (collection paused)", cid, col);
    return n;
  } catch (e) {
    console.warn("[localVoucherOutbox] deleteOutboxRowsForCompanyCollection failed", e);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Phase 2 hotfix: retry metadata on sync_outbox rows (status / attempts / last_error).
// Columns are added lazily (ALTER TABLE, idempotent) so localSqlite.ts schema is untouched.
// status: null|'pending' = queued, 'failed' = last attempt errored (kept), 'paused' = quota/billing hold.
// ---------------------------------------------------------------------------
type OutboxDbLike = { prepare: (sql: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown } };
const outboxRetryColumnsReady = new WeakSet<object>();

function ensureOutboxRetryColumns(db: unknown): void {
  if (!db || typeof db !== "object" || outboxRetryColumnsReady.has(db)) return;
  const d = db as OutboxDbLike;
  for (const sql of [
    "ALTER TABLE sync_outbox ADD COLUMN status TEXT",
    "ALTER TABLE sync_outbox ADD COLUMN attempts INTEGER DEFAULT 0",
    "ALTER TABLE sync_outbox ADD COLUMN last_error TEXT",
    "ALTER TABLE sync_outbox ADD COLUMN last_attempt_at INTEGER",
  ]) {
    try {
      d.prepare(sql).run();
    } catch {
      /* column already exists */
    }
  }
  outboxRetryColumnsReady.add(db);
}

function outboxErrorText(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? "");
  const message = String((e as { message?: string })?.message ?? (typeof e === "string" ? e : ""));
  return [code, message].filter(Boolean).join(": ").slice(0, 500) || "unknown error";
}

/** Quota / billing errors (incl. PERMISSION_DENIED whose text mentions billing) = pause, never purge. */
export function isOutboxQuotaOrBillingError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "").toLowerCase();
  const message = String((e as { message?: string })?.message ?? "").toLowerCase();
  if (code === "resource-exhausted" || code === "resource_exhausted" || code === "storage/quota-exceeded") return true;
  return (
    message.includes("billing") ||
    message.includes("quota exceeded") ||
    message.includes("quota-exceeded") ||
    message.includes("resource_exhausted") ||
    message.includes("resource-exhausted")
  );
}

async function markOutboxRowAttemptFailed(
  outboxId: string,
  companyId: string,
  e: unknown,
  status: "failed" | "paused"
): Promise<void> {
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (!db) return;
    ensureOutboxRetryColumns(db);
    db.prepare(
      `UPDATE sync_outbox SET status = ?, attempts = COALESCE(attempts, 0) + 1, last_error = ?, last_attempt_at = ? WHERE outbox_id = ?`
    ).run(status, outboxErrorText(e), Date.now(), outboxId);
  } catch (err) {
    console.warn("[localVoucherOutbox] markOutboxRowAttemptFailed failed", err);
  }
}

export type OutboxStatusCounts = {
  pending: number;
  failed: number;
  paused: number;
  total: number;
  /** Most common recent errors (for the trigger log / banner). */
  topErrors: Array<{ error: string; count: number }>;
};

/** Pending / failed / paused outbox counts across all SQLite namespaces (optionally one company). */
export async function getOutboxStatusCounts(companyId?: string): Promise<OutboxStatusCounts> {
  const out: OutboxStatusCounts = { pending: 0, failed: 0, paused: 0, total: 0, topErrors: [] };
  const errs = new Map<string, number>();
  try {
    const { getBrowserDbForNamespace } = await import("@/lib/localSqlite");
    const { SQLITE_STORAGE_NAMESPACES } = await import("@/lib/sqliteStorageNamespace");
    const seen = new Set<unknown>();
    for (const ns of SQLITE_STORAGE_NAMESPACES) {
      const db = await getBrowserDbForNamespace(ns);
      if (!db || seen.has(db)) continue;
      seen.add(db);
      ensureOutboxRetryColumns(db);
      const where = companyId ? "WHERE company_id = ?" : "";
      const args = companyId ? [companyId] : [];
      const rows = db
        .prepare(`SELECT status, last_error, COUNT(1) as c FROM sync_outbox ${where} GROUP BY status, last_error`)
        .all(...args) as Array<{ status?: string | null; last_error?: string | null; c?: number }>;
      for (const r of rows) {
        const n = Number(r.c ?? 0);
        out.total += n;
        if (r.status === "failed") out.failed += n;
        else if (r.status === "paused") out.paused += n;
        else out.pending += n;
        if (r.last_error && (r.status === "failed" || r.status === "paused")) {
          errs.set(r.last_error, (errs.get(r.last_error) ?? 0) + n);
        }
      }
    }
  } catch (e) {
    console.warn("[localVoucherOutbox] getOutboxStatusCounts failed", e);
  }
  out.topErrors = [...errs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([error, count]) => ({ error, count }));
  return out;
}

/**
 * Permanent server answer for a company (404 "company not found" / no access): stop flushing that company.
 * Rows stay in the outbox (never purged) but are marked failed with a "[blocked]" reason; the company is
 * skipped with exponential backoff (1..30 min) and only re-probed with one cheap lookup. Logs once.
 */
async function blockPbOutboxCompanyRows(companyId: string, triggerOutboxId: string, e: unknown): Promise<void> {
  const reason = outboxErrorText(e).slice(0, 300);
  const { first, block } = blockPbOutboxCompany(companyId, reason);
  await markOutboxRowAttemptFailed(triggerOutboxId, companyId, e, "failed");
  try {
    const db = await getBrowserDbForCompanyId(companyId);
    if (db) {
      ensureOutboxRetryColumns(db);
      db.prepare(
        `UPDATE sync_outbox SET status = 'failed', last_error = ?, last_attempt_at = ? WHERE company_id = ?`
      ).run(
        `${PB_OUTBOX_BLOCKED_PREFIX}${reason} (company blocked, next check ${new Date(block.until).toISOString()})`,
        Date.now(),
        companyId
      );
    }
  } catch (err) {
    console.warn("[localVoucherOutbox] could not mark blocked outbox rows", err);
  }
  if (first) {
    console.warn(
      "[flushVoucherOutbox] Pocket Ledger Server company missing/no access: outbox for this company is blocked (rows kept, retry with backoff / manual retry)",
      companyId,
      reason
    );
  }
}

/** One cheap lookup for a blocked company. "found" lifts the block and re-queues its [blocked] rows. */
async function probeBlockedPbCompany(companyId: string): Promise<"found" | "missing" | "unknown"> {
  try {
    const { ensurePocketBaseCompany } = await import("@/lib/pocketbaseData/pbSync");
    await ensurePocketBaseCompany(companyId);
    clearPbOutboxCompanyBlock(companyId);
    try {
      const db = await getBrowserDbForCompanyId(companyId);
      db?.prepare(
        `UPDATE sync_outbox SET status = 'pending', last_error = NULL WHERE company_id = ? AND last_error LIKE ?`
      ).run(companyId, `${PB_OUTBOX_BLOCKED_PREFIX}%`);
    } catch {
      /* rows are flushed regardless of status */
    }
    return "found";
  } catch (e) {
    if (isPocketBaseCompanyMissingError(e)) {
      blockPbOutboxCompany(companyId, outboxErrorText(e).slice(0, 300));
      return "missing";
    }
    deferPbOutboxCompanyProbe(companyId);
    return "unknown";
  }
}

/** Clear the session permission-denied parking and mark every failed/paused row pending again. */
export async function requeueFailedOutboxRows(companyId?: string): Promise<number> {
  permissionDeniedOutboxKeys.clear();
  // Manual retry: lift PocketBase company blocks + row/server backoff so the next flush tries again.
  clearPbOutboxCompanyBlock(companyId);
  clearPbServerBackoff();
  let n = 0;
  try {
    const { getBrowserDbForNamespace } = await import("@/lib/localSqlite");
    const { SQLITE_STORAGE_NAMESPACES } = await import("@/lib/sqliteStorageNamespace");
    const seen = new Set<unknown>();
    for (const ns of SQLITE_STORAGE_NAMESPACES) {
      const db = await getBrowserDbForNamespace(ns);
      if (!db || seen.has(db)) continue;
      seen.add(db);
      ensureOutboxRetryColumns(db);
      const where = companyId ? "AND company_id = ?" : "";
      const args = companyId ? [companyId] : [];
      const before = db
        .prepare(`SELECT COUNT(1) as c FROM sync_outbox WHERE status IN ('failed','paused') ${where}`)
        .get(...args) as { c?: number };
      n += Number(before?.c ?? 0);
      db.prepare(`UPDATE sync_outbox SET status = 'pending' WHERE status IN ('failed','paused') ${where}`).run(...args);
    }
  } catch (e) {
    console.warn("[localVoucherOutbox] requeueFailedOutboxRows failed", e);
  }
  return n;
}

/**
 * Recovery scan (RC-1): local SQLite docs of a server-synced company that have no outbox row and whose
 * Firestore *cache* copy is missing or older than the local edit. Uses getDocFromCache only (no server reads).
 */
export async function findUnsyncedLocalDocs(
  companyId: string,
  opts?: { collections?: string[]; limit?: number }
): Promise<Array<{ collectionName: string; docId: string }>> {
  const result: Array<{ collectionName: string; docId: string }> = [];
  const cid = String(companyId || "").trim();
  if (!cid) return result;
  if (!(await canSyncCompanyToServer(cid))) return result;
  const db = await getBrowserDbForCompanyId(cid);
  if (!db) return result;
  const reg = await getLocalCompanyById(cid, { includeDeleted: true });
  const fsCompanyId = String((reg as Record<string, unknown> | null)?.authoritativeCompanyId || cid).trim() || cid;
  const { getDocFromCache } = await import("@/lib/pbCompat/firestore");
  const { mirrorDocEditTimeMs, deserializeLocalDbValue } = await import("@/lib/localCompanyDocMirror");
  const { LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY } = await import("@/lib/localMirrorServerMeta");
  const collections = opts?.collections ?? ["vouchers"];
  const limit = opts?.limit ?? 5000;
  let scanned = 0;
  for (const coll of collections) {
    const queued = await listPendingOutboxDocIdsForCompany(cid, coll);
    const rows = db
      .prepare(`SELECT id, data FROM company_docs WHERE company_id = ? AND collection = ?`)
      .all(cid, coll) as Array<{ id: string; data: string }>;
    for (const r of rows) {
      if (scanned++ >= limit) return result;
      if (queued.has(r.id)) continue;
      let local: Record<string, unknown>;
      try {
        local = deserializeLocalDbValue(JSON.parse(r.data)) as Record<string, unknown>;
      } catch {
        continue;
      }
      const localMs = mirrorDocEditTimeMs(local);
      let unsynced = false;
      try {
        const snap = await getDocFromCache(doc(firestore, "companies", fsCompanyId, coll, r.id));
        if (!snap.exists()) {
          unsynced = local[LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY] !== true;
        } else {
          const serverMs = mirrorDocEditTimeMs(snap.data() as Record<string, unknown>);
          unsynced = localMs > 0 && serverMs > 0 && localMs > serverMs + 1000;
        }
      } catch {
        // Not in cache: only treat as unsynced when the local row was never confirmed by the server.
        unsynced = local[LOCAL_MIRROR_META_SERVER_CONFIRMED_KEY] !== true;
      }
      if (unsynced) result.push({ collectionName: coll, docId: r.id });
      if (scanned % 50 === 0) await new Promise<void>((res) => setTimeout(res, 0));
    }
  }
  return result;
}

/** Re-enqueue found docs (op=update; merge write) from their local SQLite copy. */
export async function requeueLocalDocsToOutbox(
  companyId: string,
  docs: Array<{ collectionName: string; docId: string }>
): Promise<number> {
  let n = 0;
  for (const d of docs) {
    try {
      const data = await getCompanyDocFromBrowserDb(companyId, d.collectionName, d.docId, {
        includeDeleted: true,
        sqliteOnly: true,
      });
      if (!data) continue;
      const { stripLocalMirrorMetaForUiRow } = await import("@/lib/localMirrorServerMeta");
      const payload = stripLocalMirrorMetaForUiRow({ ...data });
      await enqueueCompanyDocOutbox(companyId, d.collectionName, data.isDeleted === true ? "delete" : "update", d.docId, payload);
      n++;
    } catch (e) {
      console.warn("[localVoucherOutbox] requeueLocalDocsToOutbox failed", d, e);
    }
  }
  return n;
}

/**
 * Apply the queue to Firestore; delete rows; refresh local mirror from server snapshots.
 * Stops on the first failing row (network may still be bad).
 */
export type FlushVoucherOutboxOptions = {
  priority?: {
    companyId?: string;
    collectionName?: string;
    docId?: string;
  };
  only?: {
    companyId?: string;
    collectionName?: string;
    docId?: string;
  };
};

/** Parallel enqueue → double flush → REST `already-exists` (409) on `_pl_ledger_idem`. */
let flushVoucherOutboxInFlight: Promise<{ ok: number; failed: number }> | null = null;
/** Enqueue during an in-flight flush used to join that promise and never send the new row (journal files stuck on EXE). */
let flushVoucherOutboxQueued = false;
/**
 * While a flush is in flight, another caller may enqueue (link/approve). Drop `only` on the
 * follow-up round so newly queued docs are not stuck waiting 20–50s for a later full flush.
 */
let flushVoucherOutboxFollowUpOptions: FlushVoucherOutboxOptions | undefined;

/** Doc whose outbox row is being sent right now (company|collection|doc). Local-only hard delete checks this. */
let outboxRowInFlightKey: string | null = null;

export function isCompanyDocOutboxInFlight(companyId: string, collectionName: string, docId: string): boolean {
  return outboxRowInFlightKey === `${companyId}|${collectionName}|${docId}`;
}

/** Wait until the current outbox flush (if any) has finished. */
export async function awaitVoucherOutboxFlushIdle(): Promise<void> {
  const p = flushVoucherOutboxInFlight;
  if (!p) return;
  try {
    await p;
  } catch {
    /* ignore */
  }
}

/**
 * Firestore `permission-denied` on a collection (e.g. loan_schedules rules) must not
 * retry every queued row every 8s — that blocks the tab (tax page stays on screen, clicks do nothing).
 * One deny parks that company+collection for this session, **purges those outbox rows** (they can never
 * sync with current rules — leaving them made “Outbox pending: 800+” a lie for already-synced ledgers),
 * and other collections still flush.
 */
const permissionDeniedOutboxKeys = new Set<string>();

function outboxPermissionKey(companyId: string, collectionName: string): string {
  return `${companyId}:${collectionName}`;
}

function parseOutboxPermissionKey(key: string): { companyId: string; collectionName: string } | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  return { companyId: key.slice(0, i), collectionName: key.slice(i + 1) };
}

function isOutboxPermissionDenied(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "");
  const message = String((e as { message?: string })?.message ?? "");
  return (
    code === "permission-denied" ||
    code === "PERMISSION_DENIED" ||
    message.toLowerCase().includes("missing or insufficient permissions")
  );
}

export async function flushVoucherOutbox(options?: FlushVoucherOutboxOptions): Promise<{ ok: number; failed: number }> {
  // Quota pause (serverQuotaHold.ts): keep rows queued locally, send nothing; resumes on hold end.
  if (isServerQuotaHoldActive()) return { ok: 0, failed: 0 };
  if (flushVoucherOutboxInFlight) {
    flushVoucherOutboxQueued = true;
    flushVoucherOutboxFollowUpOptions = {
      ...(flushVoucherOutboxFollowUpOptions || {}),
      ...(options || {}),
      only: undefined,
      priority: options?.priority ?? flushVoucherOutboxFollowUpOptions?.priority,
    };
    return flushVoucherOutboxInFlight;
  }
  flushVoucherOutboxInFlight = (async () => {
    let last = { ok: 0, failed: 0 };
    let roundOptions = options;
    try {
      do {
        flushVoucherOutboxQueued = false;
        const followUp = flushVoucherOutboxFollowUpOptions;
        flushVoucherOutboxFollowUpOptions = undefined;
        const opts = followUp ?? roundOptions;
        roundOptions = followUp ? { ...followUp, only: undefined } : roundOptions;
        const round = await flushVoucherOutboxImpl(opts);
        last = { ok: last.ok + round.ok, failed: round.failed };
      } while (flushVoucherOutboxQueued);
      return last;
    } finally {
      const queuedAfter = flushVoucherOutboxQueued;
      const followAfter = flushVoucherOutboxFollowUpOptions;
      flushVoucherOutboxInFlight = null;
      outboxRowInFlightKey = null;
      if (queuedAfter) {
        // Enqueue landed after the while-check; without this the row sat until writer refresh.
        void flushVoucherOutbox(followAfter);
      } else {
        flushVoucherOutboxFollowUpOptions = undefined;
      }
    }
  })();
  return flushVoucherOutboxInFlight;
}

async function flushVoucherOutboxImpl(options?: FlushVoucherOutboxOptions): Promise<{ ok: number; failed: number }> {
  // Temporary kill-switch: ledger Firestore upload band (plan sync HTTP alag chalta rahe).
  if (isFirebaseLedgerDataSyncDisabled()) {
    return { ok: 0, failed: 0 };
  }
  // Online Firebase SQLite-first outbox bhi flush — pehle sirf local-only/deltaa allow tha.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: 0, failed: 0 };
  }
  // Only when the app called `disableNetwork` — otherwise repeated `enableNetwork` during flush can hit
  // Firestore 12.8 INTERNAL ASSERTION (da08 / ca9). Clear the flag inside the queued op — parallel flushes share one enable.
  if (firestoreNetworkDisabledByApi) {
    await queueFirestoreNetworkOp(async () => {
      if (!firestoreNetworkDisabledByApi) return;
      try {
        await enableNetwork(firestore);
        await settleAfterFirestoreNetworkEnabled();
      } catch {
        /* ignore */
      }
      markFirestoreNetworkDisabledByApi(false);
    });
  }
  const { getBrowserDbForNamespace, getBrowserDbForCompanyId: getDbForCid } = await import("@/lib/localSqlite");
  const { SQLITE_STORAGE_NAMESPACES } = await import("@/lib/sqliteStorageNamespace");
  const { computeSha256HexFromStringUtf8 } = await import("@/lib/security/sha256Hex");

  let rows: Array<{
    outbox_id: string;
    company_id: string;
    collection_name: string;
    doc_id: string;
    op: string;
    payload: string;
    created_at?: number | null;
    client_write_id: string | null;
    nonce: string | null;
    payload_hash: string | null;
  }> = [];
  for (const ns of SQLITE_STORAGE_NAMESPACES) {
    const nsDb = await getBrowserDbForNamespace(ns);
    if (!nsDb) continue;
    const part = nsDb
      .prepare(
        `SELECT outbox_id, company_id, collection_name, doc_id, op, payload, created_at, client_write_id, nonce, payload_hash FROM sync_outbox ORDER BY created_at ASC`
      )
      .all() as typeof rows;
    if (part.length) rows = rows.concat(part);
  }

  const deleteOutboxRow = async (outboxId: string, companyIdForRow: string) => {
    const rowDb = await getDbForCid(companyIdForRow);
    rowDb?.prepare(`DELETE FROM sync_outbox WHERE outbox_id = ?`).run(outboxId);
  };

  const only = options?.only;
  if (only?.companyId || only?.collectionName || only?.docId) {
    rows = rows.filter((row) => {
      if (only.companyId && row.company_id !== only.companyId) return false;
      if (only.collectionName && row.collection_name !== only.collectionName) return false;
      if (only.docId && row.doc_id !== only.docId) return false;
      return true;
    });
  }

  const priority = options?.priority;
  if (priority?.companyId || priority?.collectionName || priority?.docId) {
    const score = (row: (typeof rows)[number]) => {
      let s = 0;
      if (priority.companyId && row.company_id === priority.companyId) s += 4;
      if (priority.collectionName && row.collection_name === priority.collectionName) s += 2;
      if (priority.docId && row.doc_id === priority.docId) s += 8;
      return s;
    };
    rows = [...rows].sort((a, b) => score(b) - score(a));
  }

  // Session-parked collections (permission-denied this session): skip. Rows are KEPT (Phase 2 hotfix).
  {
    const parked = new Set<string>();
    for (const row of rows) {
      const k = outboxPermissionKey(row.company_id, row.collection_name);
      if (permissionDeniedOutboxKeys.has(k)) parked.add(k);
    }
    void parseOutboxPermissionKey;
    if (parked.size) {
      rows = rows.filter(
        (row) => !permissionDeniedOutboxKeys.has(outboxPermissionKey(row.company_id, row.collection_name))
      );
    }
  }

  let ok = 0;
  let failed = 0;
  /** One SSE pause for every PocketBase row in this flush — per-row drop/reconnect starved voucher POSTs. */
  let pbPushPaused = false;
  const pausePbForThisFlush = async () => {
    if (pbPushPaused) return;
    const { pausePocketBaseRealtimeForPush } = await import("@/lib/pocketbaseData/pbRealtime");
    await pausePocketBaseRealtimeForPush();
    pbPushPaused = true;
  };
  /** Yield to the UI every N network attempts so a large outbox cannot freeze the tab. */
  const YIELD_EVERY = 4;
  let attemptsSinceYield = 0;
  const pbProbeResult = new Map<string, "found" | "missing" | "unknown">();
  try {
  for (const row of rows) {
    outboxRowInFlightKey = null;
    const denyKey = outboxPermissionKey(row.company_id, row.collection_name);
    if (permissionDeniedOutboxKeys.has(denyKey)) {
      continue;
    }
    // Blocked PocketBase company / row in backoff: skip silently (no request, no failure count).
    const pbBlock = getPbOutboxCompanyBlock(row.company_id);
    if (pbBlock) {
      if (Date.now() < pbBlock.until) continue;
      if (!pbProbeResult.has(row.company_id)) pbProbeResult.set(row.company_id, await probeBlockedPbCompany(row.company_id));
      if (pbProbeResult.get(row.company_id) !== "found") continue;
    }
    if (isPbOutboxRowBackedOff(row.outbox_id)) continue;
    attemptsSinceYield += 1;
    if (attemptsSinceYield >= YIELD_EVERY) {
      attemptsSinceYield = 0;
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
    // Mark in-flight first, then skip rows removed meanwhile (local-only hard delete).
    outboxRowInFlightKey = `${row.company_id}|${row.collection_name}|${row.doc_id}`;
    {
      const stillQueued = (await getDbForCid(row.company_id))
        ?.prepare(`SELECT 1 AS x FROM sync_outbox WHERE outbox_id = ?`)
        .get(row.outbox_id) as { x?: number } | undefined;
      if (!stillQueued?.x) {
        outboxRowInFlightKey = null;
        continue;
      }
    }
    try {
      if (row.payload_hash) {
        const h = await computeSha256HexFromStringUtf8(row.payload);
        if (h !== row.payload_hash) {
          console.warn("[flushVoucherOutbox] payload_hash mismatch — tampered or corrupt row skipped", row.outbox_id);
          failed++;
          continue;
        }
      }
      const reg = await getLocalCompanyById(row.company_id, { includeDeleted: true });
      if (!reg) {
        // Company registry not hydrated yet — do not delete the row (used to wrongly drop online sync deletes here)
        continue;
      }
      const data = outboxJsonParse(row.payload);
      // Pocket Ledger Server (PocketBase) company: push this row there instead of Firestore.
      if (isPocketBaseCompany(row.company_id, reg)) {
        const { getValidPocketBaseAuth } = await import("@/lib/pocketbaseData/pbClient");
        // Not signed in to the server yet: keep the row for later.
        if (!getValidPocketBaseAuth()) continue;
        if (isPbServerBackedOff()) continue;
        try {
          const pbData = data as Record<string, unknown>;
          if (row.collection_name === "vouchers") {
            delete pbData[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
            coerceVoucherDocumentDate(pbData);
          }
          const { pushOutboxRowToPocketBase } = await import("@/lib/pocketbaseData/pbSync");
          // Only the writer POST needs the SSE slot — never drop the reader device's live feed.
          await pausePbForThisFlush();
          await pushOutboxRowToPocketBase({ ...row, payload: outboxJsonStringify(pbData) });
          await deleteOutboxRow(row.outbox_id, row.company_id);
          clearPbOutboxRowBackoff(row.outbox_id);
          clearPbServerBackoff();
          ok++;
        } catch (pbErr) {
          if (isPocketBaseCompanyMissingError(pbErr)) {
            // Permanent: block the whole company instead of retrying every row on every tick.
            await blockPbOutboxCompanyRows(row.company_id, row.outbox_id, pbErr);
            failed++;
            continue;
          }
          const pbStatus = Number((pbErr as { status?: number })?.status ?? -1);
          if (pbStatus === 0 || pbStatus >= 500) notePbServerDown();
          const waitMs = notePbOutboxRowFailure(row.outbox_id);
          console.warn(
            "[flushVoucherOutbox] Pocket Ledger Server push failed (next try in " + Math.round(waitMs / 1000) + "s)",
            row.collection_name,
            row.doc_id,
            pbErr
          );
          await markOutboxRowAttemptFailed(row.outbox_id, row.company_id, pbErr, "failed");
          failed++;
        }
        continue;
      }
      const rowSyncAllowed = await canSyncCompanyCollectionToServer(
        row.company_id,
        row.collection_name,
        row.doc_id,
        typeof data === "object" && data ? (data as Record<string, unknown>) : undefined
      );
      if (!rowSyncAllowed) {
        // Pure-local + no reconcile setting: drop row. Drive-connected pause: keep row for later.
        const localReconcileCfg = readLocalFirebaseReconcileConfig(reg);
        const dropPureLocalRow =
          isPureLocalOnlyCompanyRow(reg) &&
          !localReconcileCfg.blockedByDrive &&
          !(await canReconcileLocalDocViaFirebase(
            reg,
            row.company_id,
            row.collection_name,
            row.doc_id,
            typeof data === "object" && data ? (data as Record<string, unknown>) : undefined
          ));
        if (dropPureLocalRow) {
          await deleteOutboxRow(row.outbox_id, row.company_id);
        }
        continue;
      }
      if (!isFirebaseLedgerCompanyDataSyncEnabled(row.company_id)) {
        continue;
      }
      if (row.collection_name === "vouchers" && typeof data === "object" && data && PL_CLIENT_OFFLINE_FIRST_PERSIST_MS in data) {
        delete (data as Record<string, unknown>)[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
      }
      // Old outbox rows / corrupt `date` — normalize before Firestore flush so statements stay valid.
      if (row.collection_name === "vouchers") coerceVoucherDocumentDate(data as Record<string, unknown>);
      const { id: _docIdField, ...docFields } = data;
      // When SQLite `company_id` differs from Firestore doc id, use `authoritativeCompanyId` for the correct path (otherwise nothing appears server-side)
      const fsCompanyId =
        String((reg as Record<string, unknown>).authoritativeCompanyId || row.company_id).trim() || row.company_id;
      let docFieldsToWrite = docFields as Record<string, unknown>;
      const outboxHadExplicitFileUrls = Object.prototype.hasOwnProperty.call(docFieldsToWrite, "fileUrls");
      let outboxOmitVoucherFileUrlsFromFirestoreWrite = false;
      const outboxPayloadFileUrlsForAttachGuard = outboxHadExplicitFileUrls
        ? normalizeFileUrlsField(docFieldsToWrite.fileUrls)
        : [];
      // Recycle-bin "Delete Permanently" — hard remove. Soft delete (`op:delete` alone) stays a tombstone.
      const isPermanentHardPurge =
        row.op === "delete" && docFieldsToWrite.plPermanentlyPurged === true;
      if (row.collection_name === "vouchers") {
        try {
          const payloadUrls = normalizeFileUrlsField(docFieldsToWrite.fileUrls);
          // Explicit empty / trimmed list from save must stay — do not revive from mirror HTTPS.
          if (outboxHadExplicitFileUrls && payloadUrls.length === 0) {
            docFieldsToWrite = {
              ...docFieldsToWrite,
              fileUrls: [],
              files: [],
              unassignedFile: null,
            };
          } else if (payloadUrls.length > 0 && !Array.isArray(docFieldsToWrite.fileUrls)) {
            docFieldsToWrite = { ...docFieldsToWrite, fileUrls: payloadUrls };
          }
        } catch {
          /* mirror merge best-effort */
        }
        if (outboxHadExplicitFileUrls) {
          const urls = normalizeFileUrlsField(docFieldsToWrite.fileUrls);
          void import("@/lib/attachmentDeleteTrace").then((m) => {
            m.markAttachmentDeleteIntent({
              companyId: row.company_id,
              voucherId: row.doc_id,
              intendedUrls: urls,
              source: "localVoucherOutbox.flush",
            });
          });
        }
      }
      const localFirebaseReconcile = await canReconcileLocalDocViaFirebase(
        reg,
        row.company_id,
        row.collection_name,
        row.doc_id,
        docFieldsToWrite
      );
      // Invited-ledger reconcile: data-only — attachments Firebase par nahi.
      if (isPermanentHardPurge) {
        // Permanent purge hard-deletes the doc — skip attach hydrate / reconcile rewrite.
      } else if (localFirebaseReconcile) {
        docFieldsToWrite = stripAttachmentFieldsForInvitedLedgerReconcile(
          row.collection_name,
          docFieldsToWrite
        );
      } else {
        if (row.collection_name === "vouchers") {
          const skipAttachHydrate =
            apkEmbeddedSqliteFirstWritesPreferred() && isDeviceLocalCompany(reg);
          if (!skipAttachHydrate) {
            docFieldsToWrite = await hydrateVoucherLocalAttachmentsForServer(fsCompanyId, {
              ...docFieldsToWrite,
              id: String(docFieldsToWrite.id || row.doc_id || "").trim() || row.doc_id,
            });
          }
          if (outboxHadExplicitFileUrls) {
            const { resolveOnlineOutboxVoucherFileUrlsAfterHydrate } = await import(
              "@/lib/ledgerModes/online/outboxAttachmentFlush"
            );
            const resolution = resolveOnlineOutboxVoucherFileUrlsAfterHydrate({
              payloadFileUrls: outboxPayloadFileUrlsForAttachGuard,
              hydratedFileUrls: docFieldsToWrite.fileUrls,
              cloudSafe: cloudSafeVoucherFileUrls,
            });
            if (resolution.omitFileUrlsFromFirestoreWrite) {
              outboxOmitVoucherFileUrlsFromFirestoreWrite = true;
              const { fileUrls: _omitUrls, files: _omitFiles, unassignedFile: _omitUf, ...rest } =
                docFieldsToWrite;
              docFieldsToWrite = rest;
            } else {
              docFieldsToWrite = {
                ...docFieldsToWrite,
                fileUrls: resolution.fileUrls ?? [],
                files: [],
                unassignedFile: null,
              };
            }
          }
        } else {
          docFieldsToWrite = stripLocalFileRefsFromFirestoreDoc(
            await hydratePendingLocalFileRefsDeep(fsCompanyId, docFieldsToWrite)
          );
        }
      }
      const ref = doc(firestore, `companies/${fsCompanyId}/${row.collection_name}`, row.doc_id);
      const regAny = reg as Record<string, unknown>;
      const encFlag = regAny.encryptServerBackup === true;
      const encSalt = String(regAny.encryptServerBackupSalt ?? "").trim();
      const encPhrase = getBackupEncryptionPassphraseFromSession(row.company_id);
      // Optional server ciphertext — default OFF; encrypt needs active local login session (username+password → session key).
      if (encFlag && (!encSalt || !encPhrase)) {
        console.warn(
          "[flushVoucherOutbox] encryptServerBackup is on but salt or session key is missing — row skipped; log in with company username and password."
        );
        continue;
      }

      const idemKey = String(row.client_write_id || row.outbox_id || "").trim() || row.outbox_id;
      const idemRef = doc(firestore, `companies/${fsCompanyId}/_pl_ledger_idem`, idemKey);
      const safeChangeId = `${Date.now()}_${idemKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
      const changeLogRef = doc(firestore, `companies/${fsCompanyId}/_pl_change_log`, safeChangeId);
      const payloadHash = row.payload_hash || "";

      /** Build Firestore payload before `runTransaction` — do not run async encrypt inside the transaction callback. */
      let txnPayload:
        | { mode: "enc"; doc: Record<string, unknown> }
        | { mode: "set"; doc: Record<string, unknown>; merge: boolean }
        | { mode: "merge"; doc: Record<string, unknown> }
        | { mode: "hardDelete" };

      if (isPermanentHardPurge) {
        // Permanent recycle purge: hard delete — never re-merge `isDeleted:true` (bin bounce).
        txnPayload = { mode: "hardDelete" };
      } else if (encFlag && encSalt && encPhrase) {
        const mergeOp = row.op === "delete" ? "update" : row.op;
        const inner = await mergeForEncryptedFlush(
          fsCompanyId,
          row.collection_name,
          row.doc_id,
          mergeOp,
          docFieldsToWrite,
          row.company_id,
          reg
        );
        const json = outboxJsonStringify(inner);
        const { ivBase64, cipherTextBase64 } = await encryptServerBackupPayloadJson(json, encPhrase, encSalt);
        let createdAtField: ReturnType<typeof serverTimestamp> | Timestamp = serverTimestamp();
        if (row.op === "update" || row.op === "delete") {
          const prior = await getDoc(ref);
          if (prior.exists()) {
            const ca = prior.data()?.createdAt;
            if (ca) createdAtField = ca as Timestamp;
          }
        }
        txnPayload = {
          mode: "enc",
          doc: {
            companyId: fsCompanyId,
            [PL_ENCRYPTED_V1_FIELD]: true,
            [PL_ENCRYPTED_IV_FIELD]: ivBase64,
            [PL_ENCRYPTED_PAYLOAD_FIELD]: cipherTextBase64,
            createdAt: createdAtField,
            lastEditedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        };
      } else if (row.op === "delete") {
        // Soft delete / recycle bin: tombstone merge — do not hard-delete (bin list needs the doc).
        txnPayload = {
          mode: "merge",
          doc: {
            ...docFieldsToWrite,
            companyId: fsCompanyId,
            isDeleted: true,
            lastEditedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        };
      } else if (row.op === "create") {
        txnPayload = {
          mode: "set",
          merge: false,
          doc: {
            ...docFieldsToWrite,
            companyId: fsCompanyId,
            createdAt: serverTimestamp(),
            lastEditedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        };
      } else if (row.op === "update") {
        const { createdAt: _c, ...rest } = docFieldsToWrite;
        const updateDoc: Record<string, unknown> = {
          ...rest,
          companyId: fsCompanyId,
          lastEditedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        // merge:true + missing `fileUrls` / leftover `unassignedFile` = delete undo on server.
        if (
          !outboxOmitVoucherFileUrlsFromFirestoreWrite &&
          (outboxHadExplicitFileUrls || Object.prototype.hasOwnProperty.call(docFieldsToWrite, "fileUrls"))
        ) {
          updateDoc.fileUrls = normalizeFileUrlsField(docFieldsToWrite.fileUrls);
          updateDoc.files = [];
          updateDoc.unassignedFile = deleteField();
        }
        applyMasterAttachmentFieldsForFirestoreMerge(updateDoc, docFieldsToWrite);
        txnPayload = {
          mode: "merge",
          doc: updateDoc,
        };
      } else {
        failed++;
        continue;
      }

      // `set(merge:true)` + missing idem kabhi REST `exists:false` create bhejta — doc parallel me ban jaye to `already-exists` (sab voucher types).
      const idemWriteBody = {
        payloadHash,
        nonce: row.nonce,
        applied: true,
        op: row.op,
        collection: row.collection_name,
        docId: row.doc_id,
        at: serverTimestamp(),
      };
      const changeLogBody = {
        collectionName: row.collection_name,
        docId: row.doc_id,
        op: row.op,
        clientWriteId: idemKey,
        payloadHash,
        at: serverTimestamp(),
      };

      let flushResult: "duplicate" | "applied";
      try {
        flushResult = await runTransaction(firestore, async (tx) => {
          const idemSnap = await tx.get(idemRef);
          if (idemSnap.exists()) {
            const prev = idemSnap.data() as { payloadHash?: string; applied?: boolean };
            if (prev.applied === true && prev.payloadHash === payloadHash) return "duplicate" as const;
            if (prev.payloadHash && prev.payloadHash !== payloadHash) throw new Error("pl_idem_payload_conflict");
            tx.update(idemRef, idemWriteBody);
          } else {
            tx.set(idemRef, idemWriteBody, { merge: false });
          }
          if (txnPayload.mode === "enc") {
            tx.set(ref, txnPayload.doc, { merge: false });
          } else if (txnPayload.mode === "hardDelete") {
            tx.delete(ref);
          } else if (txnPayload.mode === "set") {
            tx.set(ref, txnPayload.doc, { merge: txnPayload.merge });
          } else {
            tx.set(ref, txnPayload.doc, { merge: true });
          }
          tx.set(changeLogRef, changeLogBody, { merge: false });
          return "applied" as const;
        });
      } catch (e) {
        if (isCompanyNotFoundError(e)) {
          const ghostPayload = outboxJsonParse(row.payload);
          const isGhostDelete =
            row.op === "delete" ||
            (typeof ghostPayload === "object" &&
              ghostPayload &&
              (ghostPayload as Record<string, unknown>).isDeleted === true);
          if (isGhostDelete) {
            const { purgeGhostLocalCompanyDoc } = await import("@/lib/purgeGhostLocalCompanyDoc");
            await purgeGhostLocalCompanyDoc(row.company_id, row.collection_name, row.doc_id);
            await deleteOutboxRow(row.outbox_id, row.company_id);
            ok++;
            continue;
          }
        }
        if (isFirestoreAlreadyExistsError(e)) {
          try {
            const snap = await getDoc(idemRef);
            if (snap.exists()) {
              const p = snap.data() as { payloadHash?: string; applied?: boolean };
              if (p.applied === true && p.payloadHash === payloadHash) {
                await deleteOutboxRow(row.outbox_id, row.company_id);
                ok++;
                await applyLocalMirrorAfterOutboxFlush({
                  companyId: row.company_id,
                  collectionName: row.collection_name,
                  docId: row.doc_id,
                  outboxPayload: data,
                  writtenFields: docFieldsToWrite,
                  isPermanentHardPurge,
                });
                continue;
              }
            }
          } catch {
            /* niche warn + failed */
          }
          console.warn("[flushVoucherOutbox] already-exists (idem race?) — row left for retry", row.outbox_id, e);
          failed++;
          continue;
        }
        throw e;
      }

      if (flushResult === "duplicate") {
        await deleteOutboxRow(row.outbox_id, row.company_id);
        ok++;
        // Idempotent replay: align local SQLite with the server doc (same as a fresh apply).
        await applyLocalMirrorAfterOutboxFlush({
          companyId: row.company_id,
          collectionName: row.collection_name,
          docId: row.doc_id,
          outboxPayload: data,
          writtenFields: docFieldsToWrite,
          isPermanentHardPurge,
        });
        continue;
      }

      await deleteOutboxRow(row.outbox_id, row.company_id);
      ok++;
      // Every collection: align SQLite with server timestamps + hydrated URLs (previously only vouchers were mirrored post-flush).
      await applyLocalMirrorAfterOutboxFlush({
        companyId: row.company_id,
        collectionName: row.collection_name,
        docId: row.doc_id,
        outboxPayload: data,
        writtenFields: docFieldsToWrite,
        isPermanentHardPurge,
      });
    } catch (e) {
      if (isCompanyNotFoundError(e)) {
        try {
          const ghostPayload = outboxJsonParse(row.payload);
          const isGhostDelete =
            row.op === "delete" ||
            (typeof ghostPayload === "object" &&
              ghostPayload &&
              (ghostPayload as Record<string, unknown>).isDeleted === true);
          if (isGhostDelete) {
            const { purgeGhostLocalCompanyDoc } = await import("@/lib/purgeGhostLocalCompanyDoc");
            await purgeGhostLocalCompanyDoc(row.company_id, row.collection_name, row.doc_id);
            await deleteOutboxRow(row.outbox_id, row.company_id);
            ok++;
            continue;
          }
        } catch {
          /* fall through */
        }
      }
      if (isOutboxQuotaOrBillingError(e)) {
        // Quota / billing (incl. PERMISSION_DENIED "billing account ... disabled"): keep row, global pause.
        // PocketBase-only login: no hold starts (Firebase quota is irrelevant), so keep the row retryable ("failed"), not "paused".
        const pbOnlyOutbox = isPocketBaseOnlyAppSession();
        await markOutboxRowAttemptFailed(row.outbox_id, row.company_id, e, pbOnlyOutbox ? "failed" : "paused");
        startServerQuotaHold();
        console.warn("[flushVoucherOutbox] quota/billing error: row kept, quota hold started", outboxErrorText(e));
        failed++;
        if (pbOnlyOutbox) continue;
        break;
      }
      if (isOutboxPermissionDenied(e)) {
        const firstDeny = !permissionDeniedOutboxKeys.has(denyKey);
        permissionDeniedOutboxKeys.add(denyKey);
        // Phase 2 hotfix: never purge. Keep the row, mark failed; collection parked for this session only.
        await markOutboxRowAttemptFailed(row.outbox_id, row.company_id, e, "failed");
        failed++;
        if (firstDeny) {
          console.warn(
            "[flushVoucherOutbox] permission-denied: collection paused for this session, rows kept for retry",
            row.collection_name,
            row.company_id
          );
        }
        // Later rows of this collection hit permissionDeniedOutboxKeys above and skip.
        continue;
      }
      console.warn(
        "[flushVoucherOutbox] row failed",
        row.outbox_id,
        row.collection_name,
        (e as { code?: string })?.code || (e as { message?: string })?.message || e
      );
      await markOutboxRowAttemptFailed(row.outbox_id, row.company_id, e, "failed");
      failed++;
      // One bad row should not block the entire outbox forever; keep flushing remaining rows.
      continue;
    }
  }
  } finally {
    if (pbPushPaused) {
      try {
        const { resumePocketBaseRealtimeAfterPush } = await import("@/lib/pocketbaseData/pbRealtime");
        resumePocketBaseRealtimeAfterPush();
      } catch {
        /* stream reconnect is best-effort */
      }
    }
  }
  return { ok, failed };
}
