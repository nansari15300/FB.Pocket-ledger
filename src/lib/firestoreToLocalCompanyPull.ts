"use client";

/**
 * Firestore company subcollections → browser SQLite (`company_docs`) — explicit “sync / download” layer.
 * `useVouchers` prefetch + `onSnapshot` both feed the same mirror via `mirrorCollectionDocsToBrowserDbSilent`.
 * Har change ke saath: yahan se pull = local DB me rows guarantee (decrypt + upsert).
 */

import { collection, doc, getDoc, getDocs, query } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import type { Company } from "@/hooks/useCompany";
import {
  deleteCompanyDocFromBrowserDb,
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
  mirrorCollectionDocsToBrowserDbSilent,
} from "@/lib/localCompanyDocMirror";
import {
  isLocalMirrorMarkedServerBacked,
  stampLocalMirrorBackedByFirestore,
} from "@/lib/localMirrorServerMeta";
import { decryptFirestoreCompanyDocIfNeeded, type ServerBackupCryptoContext } from "@/lib/serverBackupEncryption";
import { isLocalOnlyMode } from "@/lib/localMode";
import { preserveLocalVoucherApprovalOverIncoming } from "@/lib/ledgerPendingApproval";
import {
  readPendingApprovalOutboxByVoucherId,
  readPendingBillWiseOutboxByVoucherId,
  readPendingOutboxPayloadsForCompany,
} from "@/lib/localVoucherOutbox";
import { PL_CLIENT_OFFLINE_FIRST_PERSIST_MS } from "@/lib/localMirrorServerMeta";
import { preserveLocalVoucherBillWiseOverIncoming } from "@/lib/ledgerPendingBillWiseLinks";

/** Merge options: `storageOption: local` par same doc id pe Firestore purana na jeete (restore / backup). */
export type MergeRemoteLocalDocsOptions = {
  /** True: SQLite row same `id` par remote ko replace kare — extras-only merge se zyada zaroori jab authoritativeCompanyId + Firestore stale ho */
  preferLocalSqliteWhenIdsConflict?: boolean;
  /**
   * Online restore sync: Firestore pe vouchers abhi incomplete/empty ho sakte hain —
   * orphan delete SQLite vouchers hata deta tha ("restore pe vouchers nahi dikhe").
   */
  skipOrphanSqliteDelete?: boolean;
};

function sortMergedByField(merged: any[], orderByField: string): any[] {
  const copy = [...merged];
  copy.sort((a: any, b: any) => {
    const dateA = a[orderByField]?.toDate ? a[orderByField].toDate() : new Date(a[orderByField]);
    const dateB = b[orderByField]?.toDate ? b[orderByField].toDate() : new Date(b[orderByField]);
    return dateA.getTime() - dateB.getTime();
  });
  return copy;
}

/**
 * Firestore list me abhi nahi — sirf SQLite + outbox (pending create/update flush se pehle).
 * `onSnapshot` / pull sirf server rows set karte the → cross-copy / naya voucher refresh pe "gayab" dikhta tha.
 *
 * **Server-hard-delete orphans:** SQLite row jisme `__mirrorBackedByFirestore` aur ab server snapshot me wo id nahin —
 * stale “extra” ghost ban jati thi + mirror usko wapas bake karta tha → hard-delete SQLite row (restore impossible).
 */
import { isLocalFileRef } from "@/lib/localPendingFiles";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { isPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import {
  resolveUrlsAgainstAttachmentIntent,
  shouldPreserveClearedVoucherAttachments,
  shouldPreserveIntendedVoucherAttachments,
} from "@/lib/attachmentDeleteTrace";

function isHttpsAttachmentRef(u: unknown): boolean {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim());
}

function isClearedMasterAttachmentScalar(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return true;
  const low = s.toLowerCase();
  return low === "null" || low === "undefined" || low === "none" || low === "n/a";
}

/**
 * Bank/party/staff profile pics live in `fileUrl` (not voucher `fileUrls`).
 * EXE/APK SQLite used to keep stale HTTPS after web/other-device clear because
 * empty remote was treated as "don't wipe". Newer remote with no HTTPS must clear.
 */
function mergeMasterAttachmentScalars(
  out: Record<string, unknown>,
  remote: Record<string, unknown>,
  local: Record<string, unknown>,
  localMs: number,
  remoteMs: number
): void {
  for (const key of ["fileUrl", "avatarUrl", "logoUrl"] as const) {
    const r = remote[key];
    const l = local[key];
    const hasLocalKey = Object.prototype.hasOwnProperty.call(local, key);
    if (hasLocalKey && localMs >= remoteMs) {
      if (isClearedMasterAttachmentScalar(l)) {
        out[key] = null;
        continue;
      }
      if (isLocalFileRef(String(l || "")) && isHttpsAttachmentRef(r)) out[key] = r;
      else out[key] = l;
      continue;
    }
    if (isHttpsAttachmentRef(r)) {
      out[key] = r;
      continue;
    }
    if (isLocalFileRef(String(l || ""))) {
      out[key] = l;
      continue;
    }
    if (remoteMs > localMs || !hasLocalKey) {
      out[key] = null;
    } else if (isHttpsAttachmentRef(l)) {
      out[key] = l;
    }
  }
}

function docAttachmentEditTimeMs(row: Record<string, unknown> | null | undefined): number {
  if (!row) return 0;
  for (const key of ["lastEditedAt", "updatedAt", "createdAt"] as const) {
    const d = parseFirestoreDateFieldToJsDate(row[key]);
    if (d && !Number.isNaN(d.getTime())) return d.getTime();
  }
  const pl = row[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
  if (typeof pl === "number" && Number.isFinite(pl)) return pl;
  return 0;
}

/** `local:` slots ko same-index remote HTTPS se upgrade — list length grow mat karo (delete undo). */
function upgradeLocalAttachmentListFromRemote(localArr: unknown[], remoteArr: unknown[]): unknown[] {
  if (localArr.length === 0) return [];
  if (remoteArr.length === localArr.length) {
    return localArr.map((localRef, i) => {
      const remoteRef = remoteArr[i];
      if (isLocalFileRef(String(localRef || "")) && isHttpsAttachmentRef(remoteRef)) return remoteRef;
      return localRef;
    });
  }
  return localArr;
}

/** SQLite mirror row me stale `local:` ho aur Firestore snapshot HTTPS ho — attachment fields remote se. */
function mergeDocAttachmentFieldsPreferRemote(
  remote: Record<string, unknown>,
  local: Record<string, unknown>,
  localCompanyId?: string
): Record<string, unknown> {
  const out = { ...local };
  const localMs = docAttachmentEditTimeMs(local);
  const remoteMs = docAttachmentEditTimeMs(remote);
  const beforeUrls = Array.isArray(local.fileUrls) ? (local.fileUrls as unknown[]) : [];
  const docId = String(out.id || local.id || remote.id || "").trim();
  const companyId = String(localCompanyId || "").trim();
  const preserveCleared =
    Boolean(docId) && shouldPreserveClearedVoucherAttachments(companyId, docId);
  for (const key of ["fileUrls", "documentFileUrls"] as const) {
    const hasLocalKey = Object.prototype.hasOwnProperty.call(local, key);
    const rArr = Array.isArray(remote[key]) ? (remote[key] as unknown[]) : [];
    const lArr = Array.isArray(local[key]) ? (local[key] as unknown[]) : [];
    const rHttps = rArr.filter(isHttpsAttachmentRef);
    const lHttps = lArr.filter(isHttpsAttachmentRef);
    const lHasLocal = lArr.some((u) => isLocalFileRef(String(u)));
    const remoteViolatesIntent =
      key === "fileUrls" &&
      Boolean(docId) &&
      shouldPreserveIntendedVoucherAttachments(companyId, docId, rArr.map(String));
    const intendedUrls =
      key === "fileUrls" && remoteViolatesIntent
        ? resolveUrlsAgainstAttachmentIntent(companyId, docId, rArr.map(String))
        : null;

    if (preserveCleared && key === "fileUrls" && !lHasLocal) {
      out[key] = [];
      continue;
    }

    // Partial trim / stale empty pull: never bake local [] over non-empty save intent.
    if (intendedUrls && key === "fileUrls" && !lHasLocal) {
      out[key] =
        hasLocalKey && lArr.length > 0 && lArr.length <= intendedUrls.length
          ? local[key]
          : intendedUrls;
      continue;
    }

    // Explicit local empty — same race guard as mergeForPull.
    if (hasLocalKey && Array.isArray(local[key]) && lArr.length === 0) {
      if (key === "fileUrls") {
        const healIntent = resolveUrlsAgainstAttachmentIntent(companyId, docId, []);
        if (healIntent && healIntent.length > 0) {
          out[key] = healIntent;
          continue;
        }
      }
      if (
        preserveCleared ||
        localMs >= remoteMs ||
        localMs === 0 ||
        rArr.length === 0 ||
        !(remoteMs > localMs && rHttps.length > 0)
      ) {
        out[key] = [];
        continue;
      }
      out[key] = remote[key];
      continue;
    }

    // Newer/equal local list wins — keep local HTTPS; never wipe to empty because remote is still [].
    if (hasLocalKey && localMs >= remoteMs) {
      if (
        Object.prototype.hasOwnProperty.call(remote, key) &&
        Array.isArray(remote[key]) &&
        rArr.length === 0 &&
        lArr.length > 0
      ) {
        // Stale empty remote after local add/save — keep local.
        out[key] = local[key];
        continue;
      }
      if (lHasLocal && rHttps.length > 0) {
        out[key] = upgradeLocalAttachmentListFromRemote(lArr, rArr);
        continue;
      }
      out[key] = local[key];
      continue;
    }

    // Remote newer + empty: only clear when intentional clear-intent, else keep local HTTPS.
    if (
      Object.prototype.hasOwnProperty.call(remote, key) &&
      Array.isArray(remote[key]) &&
      rArr.length === 0 &&
      lArr.length > 0
    ) {
      if (preserveCleared) {
        out[key] = lHasLocal
          ? lArr.filter((u) => isLocalFileRef(String(u)))
          : [];
      } else if (remoteMs > localMs && !lHasLocal) {
        out[key] = [];
      } else {
        out[key] = local[key];
      }
      continue;
    }

    // Same-device outbox lag: shorter local beats longer stale remote — not when remote is newer (other tab/user).
    if (hasLocalKey && !lHasLocal && lArr.length > 0 && lArr.length < rArr.length && localMs >= remoteMs) {
      out[key] = local[key];
      continue;
    }

    if (remoteMs > localMs && !lHasLocal) {
      out[key] = remote[key];
      continue;
    }

    if (rHttps.length > lHttps.length) out[key] = remote[key];
    else if (lHttps.length > rHttps.length && localMs >= remoteMs) out[key] = local[key];
    else if (rHttps.length === lHttps.length && rArr.some(isHttpsAttachmentRef) && lHasLocal) {
      out[key] = upgradeLocalAttachmentListFromRemote(lArr, rArr);
    }
  }
  const mergedFileUrls = Array.isArray(out.fileUrls) ? (out.fileUrls as unknown[]) : [];
  if (mergedFileUrls.length === 0) {
    out.files = [];
    out.unassignedFile = null;
  }
  mergeMasterAttachmentScalars(out, remote, local, localMs, remoteMs);
  if (process.env.NODE_ENV !== "production") {
    const afterUrls = Array.isArray(out.fileUrls) ? (out.fileUrls as unknown[]) : [];
    void import("@/lib/attachmentDeleteTrace").then((m) => {
      m.traceAttachmentUrlsChange({
        source: "firestorePull.mergePreferRemote",
        companyId,
        voucherId: String(out.id || local.id || remote.id || ""),
        prevUrls: beforeUrls.map(String),
        nextUrls: afterUrls.map(String),
        extra: { localMs, remoteMs, preserveCleared },
      });
      m.logAttachWipe({
        source: "firestorePull.mergePreferRemote",
        reason: "merge_shrank_fileUrls",
        companyId,
        voucherId: String(out.id || local.id || remote.id || ""),
        beforeUrls: beforeUrls.map(String),
        afterUrls: afterUrls.map(String),
        extra: { localMs, remoteMs, preserveCleared },
      });
    });
  }
  return out;
}

/** Firestore pull: ledger remote se; attachments jis side par zyada / abhi-pending URLs hon. */
function mergeDocAttachmentFieldsForPull(
  remote: Record<string, unknown>,
  local: Record<string, unknown>,
  localCompanyId?: string
): Record<string, unknown> {
  const out = { ...remote };
  const localMs = docAttachmentEditTimeMs(local);
  const remoteMs = docAttachmentEditTimeMs(remote);
  const beforeLocalUrls = Array.isArray(local.fileUrls) ? (local.fileUrls as unknown[]) : [];
  const beforeRemoteUrls = Array.isArray(remote.fileUrls) ? (remote.fileUrls as unknown[]) : [];
  const docId = String(out.id || local.id || remote.id || "").trim();
  const companyId = String(localCompanyId || "").trim();
  const preserveCleared =
    Boolean(docId) && shouldPreserveClearedVoucherAttachments(companyId, docId);
  for (const key of ["fileUrls", "documentFileUrls"] as const) {
    const hasLocalKey = Object.prototype.hasOwnProperty.call(local, key);
    const rArr = Array.isArray(remote[key]) ? (remote[key] as unknown[]) : [];
    const lArr = Array.isArray(local[key]) ? (local[key] as unknown[]) : [];
    const rHttps = rArr.filter(isHttpsAttachmentRef);
    const lHttps = lArr.filter(isHttpsAttachmentRef);
    const lHasLocal = lArr.some((u) => isLocalFileRef(String(u)));
    const remoteViolatesIntent =
      key === "fileUrls" &&
      Boolean(docId) &&
      shouldPreserveIntendedVoucherAttachments(companyId, docId, rArr.map(String));
    const intendedUrls =
      key === "fileUrls" && remoteViolatesIntent
        ? resolveUrlsAgainstAttachmentIntent(companyId, docId, rArr.map(String))
        : null;

    // Session delete/trim tombstone — F5 / delta pull purani HTTPS SQLite pe wapas mat bake karo.
    if (preserveCleared && key === "fileUrls" && !lHasLocal) {
      out[key] = [];
      continue;
    }
    // Partial trim / stale empty pull: never bake local [] over non-empty save intent.
    if (intendedUrls && key === "fileUrls" && !lHasLocal) {
      out[key] =
        hasLocalKey && lArr.length > 0 && lArr.length <= intendedUrls.length
          ? local[key]
          : intendedUrls;
      continue;
    }

    // Explicit local empty = user removed attachments. Stale remote HTTPS must not win the race
    // (mirror then live-patches React and undoes delete). Only a clearly newer remote can re-add.
    // Exception: durable non-empty intent (just saved files) — empty local is a race, restore intent.
    if (hasLocalKey && Array.isArray(local[key]) && lArr.length === 0) {
      if (key === "fileUrls") {
        const healIntent = resolveUrlsAgainstAttachmentIntent(companyId, docId, []);
        if (healIntent && healIntent.length > 0) {
          out[key] = healIntent;
          continue;
        }
      }
      if (preserveCleared || localMs >= remoteMs || localMs === 0 || rArr.length === 0) {
        out[key] = [];
        continue;
      }
      // remote newer with files — another device may have added after delete
      if (!preserveCleared && remoteMs > localMs && rHttps.length > 0) {
        out[key] = remote[key];
        continue;
      }
      out[key] = [];
      continue;
    }

    // Delete/trim on newer local must beat stale remote HTTPS (outbox lag / snapshot race).
    if (hasLocalKey && localMs >= remoteMs) {
      if (lArr.length < rArr.length && !lHasLocal) {
        out[key] = local[key];
        continue;
      }
      if (lHasLocal && rHttps.length > 0) {
        out[key] = upgradeLocalAttachmentListFromRemote(lArr, rArr);
        continue;
      }
    }

    // Server cleared attachments — only win when remote is actually newer, or user clear-intent is active.
    // Stale empty Firestore (common ~1s after save before write lands) must NOT wipe local HTTPS.
    if (
      Object.prototype.hasOwnProperty.call(remote, key) &&
      Array.isArray(remote[key]) &&
      rArr.length === 0 &&
      lArr.length > 0
    ) {
      if (lHasLocal && lHttps.length === 0) {
        out[key] = local[key];
      } else if (preserveCleared) {
        out[key] = lHasLocal
          ? lArr.filter((u) => isLocalFileRef(String(u)))
          : [];
        if (Array.isArray(out[key]) && (out[key] as unknown[]).length === 0) out[key] = [];
      } else if (remoteMs > localMs) {
        // Genuinely newer empty server doc.
        if (lHasLocal) {
          const pending = lArr.filter((u) => isLocalFileRef(String(u)));
          out[key] = pending.length > 0 ? pending : [];
        } else {
          out[key] = [];
        }
      } else {
        // Stale empty remote vs local/saved HTTPS — keep local.
        out[key] = local[key];
      }
      continue;
    }

    // Same-device outbox lag: shorter local beats longer stale remote — not when remote is newer (other tab/user).
    if (hasLocalKey && !lHasLocal && lArr.length > 0 && lArr.length < rArr.length && localMs >= remoteMs) {
      out[key] = local[key];
      continue;
    }

    if (remoteMs > localMs && !lHasLocal) {
      out[key] = remote[key];
      continue;
    }

    if (lHttps.length > rHttps.length && localMs >= remoteMs) {
      out[key] = local[key];
    } else if (rHttps.length > lHttps.length) {
      out[key] = remote[key];
    } else if (rHttps.length === 0 && lHasLocal) {
      out[key] = local[key];
    } else if (lHasLocal && rHttps.length > 0) {
      out[key] = upgradeLocalAttachmentListFromRemote(lArr, rArr);
    }
  }
  const mergedFileUrls = Array.isArray(out.fileUrls) ? (out.fileUrls as unknown[]) : [];
  if (mergedFileUrls.length === 0) {
    out.files = [];
    out.unassignedFile = null;
  }
  mergeMasterAttachmentScalars(out, remote, local, localMs, remoteMs);
  if (process.env.NODE_ENV !== "production") {
    const afterUrls = Array.isArray(out.fileUrls) ? (out.fileUrls as unknown[]) : [];
    void import("@/lib/attachmentDeleteTrace").then((m) => {
      m.traceAttachmentUrlsChange({
        source: "firestorePull.mergeForPull",
        companyId,
        voucherId: String(out.id || local.id || remote.id || ""),
        prevUrls: beforeLocalUrls.map(String),
        nextUrls: afterUrls.map(String),
        extra: {
          localMs,
          remoteMs,
          remoteCount: beforeRemoteUrls.length,
          localCount: beforeLocalUrls.length,
          preserveCleared,
        },
      });
      m.logAttachWipe({
        source: "firestorePull.mergeForPull",
        reason: "merge_shrank_fileUrls",
        companyId,
        voucherId: String(out.id || local.id || remote.id || ""),
        beforeUrls: beforeLocalUrls.map(String),
        afterUrls: afterUrls.map(String),
        extra: { localMs, remoteMs, preserveCleared, remoteCount: beforeRemoteUrls.length },
      });
    });
  }
  return out;
}

const plKeptUnsyncedLogged = new Set<string>();
export async function mergeRemoteSnapshotWithLocalOnlyDocs(
  localCompanyId: string,
  collectionPath: string,
  remoteData: any[],
  orderByField?: string,
  options?: MergeRemoteLocalDocsOptions
): Promise<any[]> {
  try {
    const isVoucherCollection = collectionPath === "vouchers";
    const pendingApprovalById = isVoucherCollection
      ? await readPendingApprovalOutboxByVoucherId(localCompanyId)
      : new Map<string, Record<string, unknown>>();
    const pendingBillWiseById = isVoucherCollection
      ? await readPendingBillWiseOutboxByVoucherId(localCompanyId)
      : new Map<string, Record<string, unknown>>();
    const preserveVoucherApproval = (
      localRow: Record<string, unknown> | null | undefined,
      incoming: Record<string, unknown>
    ): Record<string, unknown> => {
      if (!isVoucherCollection) return incoming;
      const id = String(incoming?.id || localRow?.id || "").trim();
      const withApproval = preserveLocalVoucherApprovalOverIncoming(
        localRow,
        incoming,
        id ? pendingApprovalById.get(id) : undefined
      );
      return preserveLocalVoucherBillWiseOverIncoming(
        localRow,
        withApproval,
        id ? pendingBillWiseById.get(id) : undefined
      );
    };
    // Har Firestore snapshot row ko mirror marker lagao taaki purge vs pending-local differentiate ho sake.
    let cached = await listCompanyDocsFromBrowserDb(localCompanyId, collectionPath, { forBackupMerge: true });
    // Unsynced local edit wins: any doc with a sync_outbox row (pending/failed/paused - e.g. quota hold) keeps the
    // LOCAL row. A stale server snapshot must never overwrite an edit the server has not accepted yet.
    const unsyncedPayloads = await readPendingOutboxPayloadsForCompany(localCompanyId, collectionPath).catch(
      () => new Map<string, Record<string, unknown>>()
    );
    const unsyncedIds = new Set(unsyncedPayloads.keys());
    const cachedForUnsynced = new Map<string, Record<string, unknown>>();
    if (unsyncedIds.size) {
      for (const c of cached) {
        const id = String((c as { id?: unknown })?.id ?? "").trim();
        if (id && unsyncedIds.has(id)) cachedForUnsynced.set(id, c as Record<string, unknown>);
      }
    }
    const keepUnsyncedLocal = (id: string, remoteRow: Record<string, unknown> | null | undefined) => {
      const fromOutbox = unsyncedPayloads.get(id);
      const fromSqlite = cachedForUnsynced.get(id);
      const localRow = fromOutbox && Object.keys(fromOutbox).length > 1 ? fromOutbox : fromSqlite ?? fromOutbox;
      if (!localRow) return null;
      if (remoteRow && docAttachmentEditTimeMs(remoteRow) > docAttachmentEditTimeMs(localRow)) return null;
      return { ...localRow, id };
    };
    const remoteStamped = remoteData.map((r: any) => {
      const id = String(r?.id ?? "").trim();
      const kept = id ? keepUnsyncedLocal(id, r as Record<string, unknown>) : null;
      if (kept) {
        if (!plKeptUnsyncedLogged.has(id)) {
          plKeptUnsyncedLogged.add(id);
          console.info("[PL-DEBUG-SAVE] pull kept unsynced local row over server snapshot", { collectionPath, id });
        }
        return kept;
      }
      const stamped = stampLocalMirrorBackedByFirestore({ ...(typeof r === "object" && r ? r : {}), id: r?.id } as Record<string, unknown>);
      const localRow = id ? cachedForUnsynced.get(id) ?? (undefined as Record<string, unknown> | undefined) : undefined;
      if (localRow && docAttachmentEditTimeMs(localRow) >= docAttachmentEditTimeMs(stamped)) {
        return { ...localRow, id };
      }
      return stamped;
    });

    const fsIds = new Set(remoteStamped.map((d: any) => String(d?.id ?? "")));
    const orphanSqliteIds: string[] = [];
    if (!options?.skipOrphanSqliteDelete) {
      for (const row of cached) {
        const id = String((row as any)?.id ?? "").trim();
        if (!id || (row as any)?.isDeleted === true) continue;
        if (!fsIds.has(id) && isLocalMirrorMarkedServerBacked(row as Record<string, unknown>)) {
          orphanSqliteIds.push(id);
        }
      }
    }
    if (orphanSqliteIds.length) {
      // Online row server se hat chuki → local mirror se DELETE; extras merge ghosts restore na lau.
      // Sequential har id = zyada orphans par lamba critical path — chhota parallel batch SQLite pressure safe rakhta hai.
      const ORPHAN_DELETE_CONCURRENCY = 8;
      for (let i = 0; i < orphanSqliteIds.length; i += ORPHAN_DELETE_CONCURRENCY) {
        const slice = orphanSqliteIds.slice(i, i + ORPHAN_DELETE_CONCURRENCY);
        await Promise.all(
          slice.map((oid) =>
            deleteCompanyDocFromBrowserDb(localCompanyId, collectionPath, oid, { force: true, notify: false })
          )
        );
      }
      cached = await listCompanyDocsFromBrowserDb(localCompanyId, collectionPath, { forBackupMerge: true });
    }

    // Local registry: restore ke baad Firestore purane rows same id rakhe → pehle wala "extras only" merge un rows ko chhod deta tha
    if (options?.preferLocalSqliteWhenIdsConflict && cached.length) {
      const byId = new Map<string, any>();
      const remoteById = new Map<string, any>();
      for (const r of remoteStamped) {
        const id = String(r?.id ?? "");
        if (id) {
          byId.set(id, r);
          remoteById.set(id, r);
        }
      }
      for (const c of cached) {
        const id = String(c?.id ?? "");
        if (!id || c?.isDeleted === true) continue;
        const remoteRow = remoteById.get(id) as Record<string, unknown> | undefined;
        const mergedRow = remoteRow
          ? mergeDocAttachmentFieldsPreferRemote(remoteRow, c as Record<string, unknown>, localCompanyId)
          : (c as Record<string, unknown>);
        byId.set(id, preserveVoucherApproval(c as Record<string, unknown>, mergedRow));
      }
      const merged = [...byId.values()];
      if (!orderByField) return merged;
      return sortMergedByField(merged, orderByField);
    }

    // Sirf snapshot — poora stamped server list waapas do (purge ke baad local empty).
    if (!cached.length) {
      if (!orderByField) return remoteStamped;
      return sortMergedByField(remoteStamped, orderByField);
    }

    /** Pending local/outbox extras: META false / missing — snapshot me id nahin kyunki abhi flush nahi. */
    const extras = cached.filter((c: any) => {
      if (c?.isDeleted === true) return false;
      const id = String(c?.id ?? "");
      if (!id) return false;
      if (!fsIds.has(id) && isLocalMirrorMarkedServerBacked(c as Record<string, unknown>)) return false;
      return !fsIds.has(id);
    });
    if (!extras.length) {
      if (cached.length) {
        const cachedById = new Map<string, Record<string, unknown>>();
        for (const c of cached) {
          const id = String((c as { id?: unknown })?.id ?? "").trim();
          if (id) cachedById.set(id, c as Record<string, unknown>);
        }
        const merged = remoteStamped.map((r: Record<string, unknown>) => {
          const id = String(r?.id ?? "").trim();
          const localRow = id ? cachedById.get(id) : undefined;
          if (!localRow) {
            return preserveVoucherApproval(null, r);
          }
          const kept = id ? keepUnsyncedLocal(id, r) : null;
          if (kept) {
            return preserveVoucherApproval(localRow, kept);
          }
          if (docAttachmentEditTimeMs(localRow) >= docAttachmentEditTimeMs(r)) {
            return preserveVoucherApproval(localRow, { ...localRow, id });
          }
          return preserveVoucherApproval(
            localRow,
            mergeDocAttachmentFieldsForPull(r, localRow, localCompanyId)
          );
        });
        if (!orderByField) return merged;
        return sortMergedByField(merged, orderByField);
      }
      if (!orderByField) return remoteStamped;
      return sortMergedByField(remoteStamped, orderByField);
    }
    const merged = [...remoteStamped, ...extras];
    if (!orderByField) return merged;
    return sortMergedByField(merged, orderByField);
  } catch {
    try {
      return remoteData.map((r: any) =>
        stampLocalMirrorBackedByFirestore({ ...(typeof r === "object" && r ? r : {}), id: r?.id } as Record<string, unknown>)
      );
    } catch {
      return remoteData;
    }
  }
}

/** Same list as `useVouchers` listeners — ek hi source taaki sync gap na ho. */
export const COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS = [
  "vouchers",
  "parties",
  "staff",
  "bank_accounts",
  "taxes",
  "expense_accounts",
  "items",
  "item_groups",
  "groups",
  "account_groups",
  "staff_groups",
  "tax_groups",
  "expense_groups",
  /** Auto Monthly templates — backup/restore + local mirror (Firestore recurring runner). */
  "recurring_voucher_templates",
  "loans",
  "loan_schedules",
  "loan_transactions",
  "loan_rate_history",
  "loan_charges",
  "loan_audit_logs",
  "loan_settings",
  "loan_documents",
  /** HR module (pl_docs, keyed by company + coll + app_id). */
  "hr_attendance",
  "hr_leaves",
  "hr_payroll",
  /** Per-ledger statement checked marks (per user + context). */
  "ledger_statement_checks",
] as const;

export type CompanyLocalMirrorSubcollection = (typeof COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS)[number];

/**
 * Ek subcollection: Firestore getDocs → decrypt (agar encrypted) → SQLite upsert → decrypted rows return (React state ke liye).
 */
export async function pullCompanySubcollectionFromFirestoreToLocalDb(
  fsCompanyId: string,
  localCompanyId: string,
  collectionPath: string,
  company: Company | null,
  /** vouchers: `date` sort — merge ke baad timeline sahi */
  orderByField?: string,
  mergeOpts?: MergeRemoteLocalDocsOptions
): Promise<any[]> {
  /**
   * PocketBase company: the server copy lives in `pl_data`, never in Firestore. This module is a
   * Firestore-specific downloader — running it for a server company asked Firebase (now dead) for
   * rows and could bake an empty/foreign snapshot over the good SQLite mirror. Callers in a server
   * company mode use `pbSync` / the mirror instead; returning `[]` leaves the mirror untouched.
   */
  if (isPocketBaseCompanyId(fsCompanyId) || isPocketBaseCompanyId(localCompanyId)) return [];
  const cryptoCtx: ServerBackupCryptoContext | null = company
    ? { encryptServerBackupSalt: company.encryptServerBackupSalt }
    : null;
  const q = query(collection(firestore, `companies/${fsCompanyId}/${collectionPath}`));
  const snapRemote = await getDocs(q);
  const remoteData = (
    await Promise.all(
      snapRemote.docs.map(async (d) => {
        const raw = { ...d.data(), id: d.id } as Record<string, unknown> & { id: string };
        return decryptFirestoreCompanyDocIfNeeded(raw, cryptoCtx, localCompanyId);
      })
    )
  )
    .filter((x): x is NonNullable<typeof x> => x != null)
    .filter((item: any) => item.isDeleted !== true);
  const preferLocal =
    mergeOpts?.preferLocalSqliteWhenIdsConflict === true ||
    String(company?.storageOption || "").toLowerCase() === "local";
  const merged = await mergeRemoteSnapshotWithLocalOnlyDocs(localCompanyId, collectionPath, remoteData, orderByField, {
    preferLocalSqliteWhenIdsConflict: preferLocal,
    skipOrphanSqliteDelete: mergeOpts?.skipOrphanSqliteDelete === true,
  });
  /** Purani bugfix: sirf remoteData mirror se offline extras + purge/META SQLite me align nahi ho paate — merged hi bake karo */
  if (merged.length > 0) {
    await mirrorCollectionDocsToBrowserDbSilent(localCompanyId, collectionPath, merged, {
      cloudBackedOfflineCache: !isLocalOnlyMode(),
    });
  }
  return merged;
}

/** Saari listed subcollections ek baar — manual “download / refresh local cache” ya health check ke liye. */
/** Full warm sync: parallel pulls — optional progress har subcollection complete par (overlay % ke liye). */
export async function pullCompanyDocFromFirestoreToLocalDb(
  fsCompanyId: string,
  localCompanyId: string,
  collectionPath: string,
  docId: string,
  company: Company | null,
  options?: { op?: string }
): Promise<Record<string, unknown> | null> {
  const fsId = String(fsCompanyId || "").trim();
  const localId = String(localCompanyId || "").trim();
  const path = String(collectionPath || "").trim();
  const id = String(docId || "").trim();
  if (!fsId || !localId || !path || !id) return null;
  /** Server company: no Firestore row exists for this doc — the PB pull feeds the mirror. */
  if (isPocketBaseCompanyId(fsId) || isPocketBaseCompanyId(localId)) return null;

  const op = String(options?.op || "").toLowerCase();
  if (op === "delete" || op === "deleted" || op === "remove" || op === "removed") {
    await deleteCompanyDocFromBrowserDb(localId, path, id, { force: true, notify: true });
    return null;
  }

  const cryptoCtx: ServerBackupCryptoContext | null = company
    ? { encryptServerBackupSalt: company.encryptServerBackupSalt }
    : null;
  const snap = await getDoc(doc(firestore, `companies/${fsId}/${path}`, id));
  if (!snap.exists()) {
    await deleteCompanyDocFromBrowserDb(localId, path, id, { force: true, notify: true });
    return null;
  }
  const raw = { ...snap.data(), id: snap.id } as Record<string, unknown> & { id: string };
  const decrypted = await decryptFirestoreCompanyDocIfNeeded(raw, cryptoCtx, localId);
  if (!decrypted) {
    await deleteCompanyDocFromBrowserDb(localId, path, id, { force: true, notify: true });
    return null;
  }
  if ((decrypted as { isDeleted?: unknown }).isDeleted === true) {
    let toMirror = decrypted as Record<string, unknown>;
    try {
      const localRow = (await getCompanyDocFromBrowserDb(localId, path, id, {
        includeDeleted: true,
      })) as Record<string, unknown> | null;
      if (localRow) {
        toMirror = mergeDocAttachmentFieldsForPull(toMirror, localRow, localId);
      }
    } catch {
      /* optional merge */
    }
    await mirrorCollectionDocsToBrowserDbSilent(localId, path, [toMirror], {
      cloudBackedOfflineCache: !isLocalOnlyMode(),
    });
    return toMirror;
  }
  let toMirror = decrypted as Record<string, unknown>;
  // Unsynced local edit (outbox row pending/failed/paused) wins over the server copy.
  try {
    const unsynced = await readPendingOutboxPayloadsForCompany(localId, path);
    const pending = unsynced.get(id);
    if (pending) {
      const localRow = (await getCompanyDocFromBrowserDb(localId, path, id)) as Record<string, unknown> | null;
      const kept =
        pending && Object.keys(pending).length > 1
          ? pending
          : localRow;
      if (kept) {
        console.info("[PL-DEBUG-SAVE] single-doc pull skipped (unsynced local edit)", { path, id });
        return kept;
      }
    }
  } catch {
    /* fall through */
  }
  // Delta sync raw Firestore bake se local empty attachments undo na ho.
  try {
    const localRow = (await getCompanyDocFromBrowserDb(localId, path, id, {
      includeDeleted: true,
    })) as Record<string, unknown> | null;
    if (localRow) {
      toMirror = mergeDocAttachmentFieldsForPull(toMirror, localRow, localId);
    } else if (path === "vouchers" && shouldPreserveClearedVoucherAttachments(localId, id)) {
      toMirror = {
        ...toMirror,
        fileUrls: [],
        files: [],
        unassignedFile: null,
      };
    }
  } catch {
    if (path === "vouchers" && shouldPreserveClearedVoucherAttachments(localId, id)) {
      toMirror = {
        ...toMirror,
        fileUrls: [],
        files: [],
        unassignedFile: null,
      };
    }
  }
  await mirrorCollectionDocsToBrowserDbSilent(localId, path, [toMirror], {
    cloudBackedOfflineCache: !isLocalOnlyMode(),
  });
  return toMirror;
}

export async function pullAllCompanySubcollectionsFromFirestoreToLocalDb(
  fsCompanyId: string,
  localCompanyId: string,
  company: Company | null,
  opts?: {
    onSubcollectionDone?: (info: { path: string; completed: number; total: number }) => void;
    mergeOpts?: MergeRemoteLocalDocsOptions;
  }
): Promise<{ path: string; count: number }[]> {
  const paths = [...COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS];
  const total = paths.length;
  let completed = 0;
  return await Promise.all(
    paths.map(async (path) => {
      try {
        const rows = await pullCompanySubcollectionFromFirestoreToLocalDb(
          fsCompanyId,
          localCompanyId,
          path,
          company,
          path === "vouchers" ? "date" : undefined,
          opts?.mergeOpts
        );
        completed++;
        opts?.onSubcollectionDone?.({ path, completed, total });
        return { path, count: rows.length };
      } catch (e) {
        console.warn("[pullAllCompanySubcollectionsFromFirestoreToLocalDb]", path, e);
        completed++;
        opts?.onSubcollectionDone?.({ path, completed, total });
        return { path, count: 0 };
      }
    })
  );
}

/** Debug / Settings: SQLite mirror me kitni rows hain (sirf tab jab `listCompanyDocsFromBrowserDb` allow kare). */
export async function getLocalMirrorRowCountsBySubcollection(
  localCompanyId: string
): Promise<Partial<Record<CompanyLocalMirrorSubcollection, number>>> {
  const counts: Partial<Record<CompanyLocalMirrorSubcollection, number>> = {};
  for (const path of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
    const rows = await listCompanyDocsFromBrowserDb(localCompanyId, path);
    counts[path] = rows.length;
  }
  return counts;
}
