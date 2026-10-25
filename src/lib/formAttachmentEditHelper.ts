"use client";

/**
 * Edit-mode attachment monitor: baseline snapshot, diff removed vs kept, async Storage/local cleanup.
 * Forms still save themselves — call `finalizeFormAttachmentEditAfterSave` after a successful save.
 */
import { isLocalFileRef, LOCAL_FILE_PREFIX, removePendingFile } from "@/lib/localPendingFiles";
import {
  attachmentPersistableRefsMatch,
  deleteFirebaseStorageUrlsWithRegistry,
} from "@/lib/companyAttachmentRegistry";
import { isRemoteAttachmentUrl } from "@/lib/resolveVoucherAttachmentRemoteUrl";
import { isDriveFileRef } from "@/lib/legacyDriveFileRef";
import { getVoucherAttachmentUrlsForEditCleanup } from "@/lib/voucherAttachmentNormalize";

export function normalizeFormAttachmentUrlList(urls: readonly unknown[] | null | undefined): string[] {
  if (!urls) return [];
  return urls
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
}

/** Edit dialog open par ref me rakho — removed detect + stale-local resolve ke liye. */
export function captureFormAttachmentBaseline(urls: readonly string[]): string[] {
  return normalizeFormAttachmentUrlList(urls);
}

export function captureEntityFormAttachmentBaseline(fields: {
  fileUrl?: string | null;
  documentFileUrls?: string[] | null;
  avatarUrl?: string | null;
  fileUrls?: string[] | null;
}): string[] {
  const out: string[] = [];
  const push = (u: unknown) => {
    const s = typeof u === "string" ? u.trim() : "";
    if (s) out.push(s);
  };
  push(fields.fileUrl);
  push(fields.avatarUrl);
  for (const u of fields.documentFileUrls ?? []) push(u);
  for (const u of fields.fileUrls ?? []) push(u);
  return out;
}

function localIdFromRef(url: string): string {
  if (!isLocalFileRef(url)) return "";
  return url.slice(LOCAL_FILE_PREFIX.length).trim();
}

/** Baseline slot ab bhi final me hai (exact URL, same local id, ya remote kept). */
function isBaselineSlotKeptInFinal(
  baselineUrl: string,
  baselineIndex: number,
  baseline: readonly string[],
  final: readonly string[]
): boolean {
  if (final.includes(baselineUrl)) return true;
  const localId = localIdFromRef(baselineUrl);
  if (localId && final.some((f) => localIdFromRef(f) === localId)) return true;
  if (isRemoteAttachmentUrl(baselineUrl) && final.includes(baselineUrl)) return true;
  // Edit open par HTTPS tha, form ab local: dikha raha hai — same index par local id baseline se match
  for (const f of final) {
    if (!isLocalFileRef(f)) continue;
    const origIdx = baseline.findIndex((b) => b === f || localIdFromRef(b) === localIdFromRef(f));
    if (origIdx === baselineIndex) return true;
  }
  return false;
}

/** Removed attachments — Storage delete ke liye HTTPS prefer; `local:` pending alag cleanup. */
export function computeRemovedFormAttachmentUrls(params: {
  baselineUrls: readonly string[];
  finalUrls: readonly string[];
  /** Save se pehle doc par authoritative remote URLs (Firestore / synced row). */
  oldDocRemoteUrls?: readonly string[];
}): { storageDeleteUrls: string[]; localPendingRefs: string[]; driveRefs: string[] } {
  const baseline = normalizeFormAttachmentUrlList(params.baselineUrls);
  const final = normalizeFormAttachmentUrlList(params.finalUrls);
  const remotes = normalizeFormAttachmentUrlList(params.oldDocRemoteUrls ?? baseline);

  const storageDeleteUrls: string[] = [];
  const localPendingRefs: string[] = [];
  const driveRefs: string[] = [];

  const finalKeepsUrl = (url: string): boolean =>
    final.some((f) => f === url || attachmentPersistableRefsMatch(f, url));

  // Prefer captured form baseline. Empty baseline + shorter final = trim/clear vs Firestore remotes.
  // Empty baseline + final.length >= remotes = add/reuse — do NOT schedule Storage deletes
  // (was wiping shared reused HTTPS when SQLite baseline was 0).
  const removalSlots: string[] =
    baseline.length > 0
      ? baseline
      : remotes.length > 0 && final.length < remotes.length
        ? remotes
        : [];

  for (let i = 0; i < removalSlots.length; i++) {
    const b = removalSlots[i]!;
    if (isBaselineSlotKeptInFinal(b, i, removalSlots, final) || finalKeepsUrl(b)) continue;

    const remoteAtSlot =
      remotes[i] && isRemoteAttachmentUrl(remotes[i]!) ? remotes[i]! : isRemoteAttachmentUrl(b) ? b : null;
    if (remoteAtSlot && !finalKeepsUrl(remoteAtSlot)) storageDeleteUrls.push(remoteAtSlot);
    else if (isDriveFileRef(b) && !finalKeepsUrl(b)) driveRefs.push(b);
    else if (isLocalFileRef(b) && !final.includes(b)) localPendingRefs.push(b);
  }

  // Extra remote HTTPS that was in form baseline but missed index alignment.
  for (const url of baseline) {
    if (!isRemoteAttachmentUrl(url)) continue;
    if (finalKeepsUrl(url) || storageDeleteUrls.includes(url)) continue;
    storageDeleteUrls.push(url);
  }
  for (const url of baseline) {
    if (isLocalFileRef(url) && !final.includes(url) && !localPendingRefs.includes(url)) {
      localPendingRefs.push(url);
    }
    if (isDriveFileRef(url) && !finalKeepsUrl(url) && !driveRefs.includes(url)) {
      driveRefs.push(url);
    }
  }

  return {
    storageDeleteUrls: [...new Set(storageDeleteUrls)],
    localPendingRefs: [...new Set(localPendingRefs)],
    driveRefs: [...new Set(driveRefs)],
  };
}

async function deleteDriveAttachmentRefBestEffort(companyId: string, ref: string): Promise<void> {
  try {
    const { shouldUseLocalCloudSync } = await import("@/lib/localCloudSync/companyConfig");
    if (!(await shouldUseLocalCloudSync(companyId))) return;
    const { deleteDriveAttachmentRef } = await import("@/lib/localCloudSync/driveAttachmentDelete");
    await deleteDriveAttachmentRef(companyId, ref);
  } catch {
    /* optional */
  }
}

/** Save success ke baad background me removed files hatao — form save block mat karo. */
export function scheduleFormAttachmentEditCleanup(params: {
  companyId: string;
  entityId?: string;
  voucherType?: string;
  baselineUrls: readonly string[];
  finalUrls: readonly string[];
  oldDocRemoteUrls?: readonly string[];
}): void {
  const cid = String(params.companyId || "").trim();
  if (!cid) return;
  const { storageDeleteUrls, localPendingRefs, driveRefs } = computeRemovedFormAttachmentUrls(params);

  void import("@/lib/attachmentDeleteTrace").then((trace) => {
    if (storageDeleteUrls.length === 0 && localPendingRefs.length === 0 && driveRefs.length === 0) {
      const baseline = normalizeFormAttachmentUrlList(params.baselineUrls);
      const final = normalizeFormAttachmentUrlList(params.finalUrls);
      const remotes = normalizeFormAttachmentUrlList(params.oldDocRemoteUrls);
      if (baseline.length === 0 && remotes.length > 0 && final.length >= remotes.length) {
        trace.traceStorageCleanupSkip({
          companyId: cid,
          entityId: params.entityId,
          reason: "skip_delete_empty_baseline_add_or_reuse",
          baselineUrls: baseline,
          finalUrls: final,
        });
        trace.logAttachWipe({
          source: "scheduleFormAttachmentEditCleanup",
          reason: "skipped_storage_delete_empty_baseline_add",
          companyId: cid,
          voucherId: params.entityId,
          beforeUrls: remotes,
          afterUrls: final,
        });
      } else if (baseline.length > final.length || baseline.some((u, i) => final[i] !== u)) {
        trace.traceStorageCleanupSkip({
          companyId: cid,
          entityId: params.entityId,
          reason: "computeRemovedFormAttachmentUrls returned empty delete lists",
          baselineUrls: baseline,
          finalUrls: final,
        });
      }
      return;
    }
    trace.traceStorageCleanupPlan({
      companyId: cid,
      entityId: params.entityId,
      baselineUrls: params.baselineUrls,
      finalUrls: params.finalUrls,
      oldDocRemoteUrls: params.oldDocRemoteUrls,
      storageDeleteUrls,
      localPendingRefs,
      driveRefs,
    });
    if (normalizeFormAttachmentUrlList(params.baselineUrls).length === 0) {
      trace.logAttachWipe({
        source: "scheduleFormAttachmentEditCleanup",
        reason: "storage_delete_with_empty_baseline",
        companyId: cid,
        voucherId: params.entityId,
        beforeUrls: params.oldDocRemoteUrls,
        afterUrls: params.finalUrls,
        extra: { storageDeleteUrls: storageDeleteUrls.slice(0, 4) },
      });
    }
  });

  if (storageDeleteUrls.length === 0 && localPendingRefs.length === 0 && driveRefs.length === 0) {
    return;
  }

  void (async () => {
    const trace = await import("@/lib/attachmentDeleteTrace");
    const { shouldDeleteAttachmentBytesOnRemove } = await import("@/lib/companyAttachmentRegistry");
    const localIds: string[] = [];
    for (const localRef of localPendingRefs) {
      const id = localIdFromRef(localRef);
      if (!id) continue;
      // Reused elsewhere (local / PL) — pending bytes / host file mat mitao.
      if (!(await shouldDeleteAttachmentBytesOnRemove(cid, localRef))) {
        trace.traceStorageDeleteUrlResult({
          phase: "registry_unlink",
          companyId: cid,
          entityId: params.entityId,
          url: localRef,
          outcome: "skipped_refcount",
          detail: { note: "local: still used elsewhere — kept pending/host bytes" },
        });
        continue;
      }
      localIds.push(id);
      try {
        await removePendingFile(id);
      } catch {
        /* ignore */
      }
    }
    // PL Server: drop queued host uploads for removed locals (SQLite voucher delta already cleared refs).
    if (localIds.length > 0) {
      try {
        const { cancelPlServerAttachmentUploads } = await import("@/lib/plServerAttachmentUploadQueue");
        cancelPlServerAttachmentUploads(cid, localIds);
      } catch {
        /* optional */
      }
      try {
        await deletePlServerHostAttachmentsBestEffort(cid, localIds);
      } catch (e) {
        console.warn("[formAttachmentEditHelper] PL host attachment delete failed", e);
      }
    }
    for (const driveRef of driveRefs) {
      if (!(await shouldDeleteAttachmentBytesOnRemove(cid, driveRef))) {
        trace.traceStorageDeleteUrlResult({
          phase: "registry_unlink",
          companyId: cid,
          entityId: params.entityId,
          url: driveRef,
          outcome: "skipped_refcount",
          detail: { note: "drive: still used elsewhere — skip Drive delete" },
        });
        continue;
      }
      await deleteDriveAttachmentRefBestEffort(cid, driveRef);
    }
    if (storageDeleteUrls.length > 0) {
      try {
        // Reuse-safe: registry / live count pe decide — shared file ki bytes force-delete mat karo.
        await deleteFirebaseStorageUrlsWithRegistry(cid, storageDeleteUrls, {
          forceDeleteBytes: false,
          traceEntityId: params.entityId,
        });
      } catch (e) {
        console.warn("[formAttachmentEditHelper] Storage cleanup failed", e);
        trace.traceStorageDeleteUrlResult({
          phase: "force_delete",
          companyId: cid,
          entityId: params.entityId,
          outcome: "failed",
          error: e,
          detail: { note: "deleteFirebaseStorageUrlsWithRegistry threw" },
        });
      }
    }
    // Restore orphan: docs me `local:` tha, bucket me `{localId}_*` — pending empty hone par bhi bytes hatao.
    if (localIds.length > 0) {
      try {
        await deleteFirebaseStorageObjectsByLocalFileIds(
          cid,
          localIds,
          params.entityId,
          params.voucherType
        );
      } catch (e) {
        console.warn("[formAttachmentEditHelper] Storage delete by local id failed", e);
        trace.traceStorageDeleteUrlResult({
          phase: "local_id_walk",
          companyId: cid,
          entityId: params.entityId,
          outcome: "failed",
          error: e,
        });
      }
    }
    trace.traceStorageCleanupDone({
      companyId: cid,
      entityId: params.entityId,
      storageDeleteCount: storageDeleteUrls.length,
      localPendingCount: localIds.length,
    });
    // Prefix orphan walk nukes `{voucherId}_*` — only safe after full clear, not on partial/false deletes.
    const finalAfter = normalizeFormAttachmentUrlList(params.finalUrls);
    if (
      params.entityId?.startsWith("voucher_") &&
      storageDeleteUrls.length > 0 &&
      finalAfter.length === 0
    ) {
      try {
        await deleteFirebaseStorageObjectsByVoucherIdPrefix(
          cid,
          params.entityId,
          params.voucherType,
          params.entityId
        );
      } catch (e) {
        trace.traceStorageDeleteUrlResult({
          phase: "local_id_walk",
          companyId: cid,
          entityId: params.entityId,
          outcome: "failed",
          error: e,
          detail: { note: "voucher prefix orphan cleanup" },
        });
      }
    }
  })();
}

/** PL Server host: best-effort DELETE on `/__pl_attachment` for removed pending ids. */
async function deletePlServerHostAttachmentsBestEffort(
  companyId: string,
  localIds: readonly string[]
): Promise<void> {
  const cid = String(companyId || "").trim();
  const ids = [...new Set(localIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (!cid || ids.length === 0) return;

  let transport: { baseUrl: string; accessToken: string } | null = null;
  try {
    const { resolvePlServerHostLoopbackTransport } = await import("@/lib/plServerHostDeltaPublish");
    const host = await resolvePlServerHostLoopbackTransport(cid);
    if (host) transport = host;
  } catch {
    /* try client transport */
  }
  if (!transport) {
    try {
      const { resolvePlServerDeltaTransport } = await import("@/lib/plServerClientDeltaSync");
      const { shouldFetchPlServerAccessContext } = await import("@/lib/plServerAccessContext");
      if (!shouldFetchPlServerAccessContext()) return;
      const t = resolvePlServerDeltaTransport(cid);
      if (!t?.baseUrl || !t.accessToken) return;
      if (!(t.gateAllowed || t.unlockedLocally)) {
        const { getLocalCompanyById } = await import("@/lib/localCompanyStore");
        const { isServerGateCompany } = await import("@/lib/companyStorageKind");
        const row = await getLocalCompanyById(cid, { includeDeleted: true });
        if (!(row && isServerGateCompany(row))) return;
      }
      transport = { baseUrl: t.baseUrl, accessToken: t.accessToken };
    } catch {
      return;
    }
  }
  if (!transport) return;

  const { gateHttpPost } = await import("@/lib/gates/gateServerFetch");
  const { resolvePlServerHostCompanyId } = await import("@/lib/plServerHostCompanyId");
  const hostCompanyId = (await resolvePlServerHostCompanyId(cid)) || cid;
  const url = `${transport.baseUrl.replace(/\/$/, "")}/__pl_attachment`;

  for (const id of ids) {
    try {
      await gateHttpPost(
        url,
        transport.accessToken,
        { companyId: hostCompanyId, id, action: "delete" },
        { timeoutMs: 15_000 }
      );
    } catch {
      /* host may be offline / older build without delete */
    }
  }
}

/** Known path pe `deleteObject` — poori company tree `list()` mat. */
async function deleteFirebaseStorageObjectsByLocalFileIds(
  companyId: string,
  localIds: readonly string[],
  entityId?: string,
  voucherType?: string
): Promise<void> {
  const cid = String(companyId || "").trim();
  const ids = [...new Set(localIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (!cid || !ids.length) return;
  const trace = await import("@/lib/attachmentDeleteTrace");
  const { ref, deleteObject } = await import("firebase/storage");
  const { storage } = await import("@/lib/firebase");
  const { getLocalFileRefMeta } = await import("@/lib/localPendingFiles");
  const {
    buildPendingAttachmentStorageObjectPath,
    buildStoragePathPrefixCandidates,
    pocketLedgerCompanyRoot,
  } = await import("@/lib/firebaseStoragePaths");

  const prefixes = new Set<string>();
  const namesById = new Map<string, string[]>();
  for (const id of ids) {
    const names = new Set<string>(["file"]);
    try {
      const meta = await getLocalFileRefMeta(`${LOCAL_FILE_PREFIX}${id}`);
      const fn = String(meta?.fileName || "").trim();
      if (fn) names.add(fn);
      const p = String(meta?.storagePathPrefix || "").trim();
      if (p) prefixes.add(p.replace(/\/+$/, ""));
    } catch {
      /* pending already gone */
    }
    namesById.set(id, [...names]);
  }

  const vt = String(voucherType || "").trim();
  for (const usePocketLedger of [true, false]) {
    prefixes.add(
      buildStoragePathPrefixCandidates({
        companyId: cid,
        usePocketLedger,
        collectionName: "vouchers",
        fieldKey: "fileUrls",
        voucherType: vt || "journal",
      })[0] || ""
    );
    prefixes.add(
      buildStoragePathPrefixCandidates({
        companyId: cid,
        usePocketLedger,
        collectionName: "vouchers",
        fieldKey: "unassignedFile",
        voucherType: vt || "journal",
      })[0] || ""
    );
  }
  prefixes.add(`${pocketLedgerCompanyRoot(cid)}/unassigned`);

  trace.traceStorageDeleteBatchStart({
    companyId: cid,
    entityId,
    registryEnabled: false,
    forceDeleteBytes: true,
    urlCount: ids.length,
  });

  for (const prefix of prefixes) {
    if (!prefix) continue;
    for (const id of ids) {
      for (const fileName of namesById.get(id) || ["file"]) {
        const storagePath = buildPendingAttachmentStorageObjectPath({
          storagePathPrefix: prefix,
          pendingFileId: id,
          fileName,
        });
        try {
          await deleteObject(ref(storage, storagePath));
          trace.traceStorageDeleteUrlResult({
            phase: "local_id_walk",
            companyId: cid,
            entityId,
            storagePath,
            outcome: "deleted",
            detail: { localIdPrefix: id, note: "exact path" },
          });
        } catch (e) {
          const code = (e as { code?: string })?.code || "";
          if (code === "storage/object-not-found") continue;
          trace.traceStorageDeleteUrlResult({
            phase: "local_id_walk",
            companyId: cid,
            entityId,
            storagePath,
            outcome: "failed",
            error: e,
          });
        }
      }
    }
  }
}

/** Outbox hydrate / duplicate upload orphans — `{voucherId}_*` objects bucket se hatao. */
async function deleteFirebaseStorageObjectsByVoucherIdPrefix(
  companyId: string,
  voucherId: string,
  voucherType: string | undefined,
  entityId?: string
): Promise<void> {
  const cid = String(companyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid) return;
  const trace = await import("@/lib/attachmentDeleteTrace");
  const { resolveCompanyUsesPocketLedgerStorage } = await import("@/lib/firebaseStoragePaths");
  const usePocketLedger = await resolveCompanyUsesPocketLedgerStorage(cid);
  const typeHint = String(voucherType || "").trim();
  const voucherTypes = typeHint
    ? [typeHint]
    : [];
  if (!voucherTypes.length) return;
  const { ref, list, deleteObject } = await import("firebase/storage");
  const { storage } = await import("@/lib/firebase");
  const rootPrefix = usePocketLedger ? `pocket-ledger/${cid}/vouchers` : `voucher-files/${cid}`;

  for (const vt of voucherTypes) {
    const folder = `${rootPrefix}/${vt}`;
    let pageToken: string | undefined;
    let pages = 0;
    do {
      let page;
      try {
        page = await list(ref(storage, folder), {
          maxResults: 200,
          ...(pageToken ? { pageToken } : {}),
        });
      } catch {
        break;
      }
      pages += 1;
      if (pages > 3) break;
      for (const item of page.items) {
        const leaf = item.fullPath.split("/").pop() || "";
        if (!leaf.startsWith(`${vid}_`)) continue;
        try {
          await deleteObject(item);
          trace.traceStorageDeleteUrlResult({
            phase: "local_id_walk",
            companyId: cid,
            entityId,
            storagePath: item.fullPath,
            outcome: "deleted",
            detail: { note: "voucher prefix orphan" },
          });
        } catch (e) {
          const code = (e as { code?: string })?.code || "";
          trace.traceStorageDeleteUrlResult({
            phase: "local_id_walk",
            companyId: cid,
            entityId,
            storagePath: item.fullPath,
            outcome: code === "storage/object-not-found" ? "not_found" : "failed",
            error: e,
            detail: { note: "voucher prefix orphan" },
          });
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
}

/** Voucher / entity save success — baseline vs final diff se cleanup schedule. */
export function finalizeFormAttachmentEditAfterSave(params: {
  companyId: string;
  entityId?: string;
  voucherType?: string;
  baselineUrls: readonly string[];
  finalUrls: readonly string[];
  oldDocRemoteUrls?: readonly string[];
}): void {
  scheduleFormAttachmentEditCleanup(params);
}

/**
 * Edit save: `local:` ko dubara upload na karo — baseline index + oldDoc remote se HTTPS reuse.
 * Naye `local:` (baseline me nahi) → `uploadLocal` callback.
 */
export async function resolveFormAttachmentUrlsForEditSave(params: {
  baselineUrls?: readonly string[];
  oldDocRemoteUrls?: readonly string[];
  finalUrls: readonly string[];
  uploadLocal: (localUrl: string) => Promise<string | null>;
  tryResolveStaleLocal?: (localUrl: string, clientUrls: readonly string[]) => Promise<string | null>;
}): Promise<string[]> {
  const baseline = normalizeFormAttachmentUrlList(params.baselineUrls ?? []);
  const remotes = normalizeFormAttachmentUrlList(params.oldDocRemoteUrls ?? baseline);
  const final = normalizeFormAttachmentUrlList(params.finalUrls);
  const out: string[] = [];

  for (const url of final) {
    if (!isLocalFileRef(url)) {
      out.push(url);
      continue;
    }

    const baselineIdx = baseline.findIndex(
      (b) => b === url || (isLocalFileRef(b) && localIdFromRef(b) === localIdFromRef(url))
    );
    if (baselineIdx >= 0 && remotes[baselineIdx] && isRemoteAttachmentUrl(remotes[baselineIdx]!)) {
      out.push(remotes[baselineIdx]!);
      continue;
    }

    if (params.tryResolveStaleLocal) {
      const resolved = await params.tryResolveStaleLocal(url, final);
      if (resolved && !isLocalFileRef(resolved)) {
        out.push(resolved);
        continue;
      }
    }

    const uploaded = await params.uploadLocal(url);
    out.push(uploaded || url);
  }

  return out.filter((u, i) => out.indexOf(u) === i);
}

/** Voucher row se baseline + remote arrays — SQLite `local:` + Firestore HTTPS align. */
export function readVoucherAttachmentBaselineFromRow(
  row: Record<string, unknown> | null | undefined
): { baselineUrls: string[]; remoteUrls: string[] } {
  const baselineUrls = getVoucherAttachmentUrlsForEditCleanup(row);
  const remoteUrls = baselineUrls.filter((u) => isRemoteAttachmentUrl(u));
  return { baselineUrls, remoteUrls };
}

function rowHasLegacyUnassignedRemote(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  const uf = row.unassignedFile;
  if (!uf || typeof uf !== "object") return false;
  const url = String((uf as { url?: string }).url || "").trim();
  return Boolean(url && isRemoteAttachmentUrl(url));
}

/** Early read + pre-merge SQLite row — zyada URLs rakho taaki bucket cleanup miss na ho. */
export function mergeAttachmentCleanupContexts(
  early: { baselineUrls: string[]; remoteUrls: string[] } | null | undefined,
  fromRow: { baselineUrls: string[]; remoteUrls: string[] }
): { baselineUrls: string[]; remoteUrls: string[] } {
  const baselineUrls =
    fromRow.baselineUrls.length > 0 ? fromRow.baselineUrls : (early?.baselineUrls ?? []);
  const remoteSet = new Set<string>();
  for (const u of [
    ...(early?.remoteUrls ?? []),
    ...fromRow.remoteUrls,
    ...fromRow.baselineUrls,
    ...baselineUrls,
  ]) {
    if (isRemoteAttachmentUrl(u)) remoteSet.add(u);
  }
  return { baselineUrls, remoteUrls: [...remoteSet] };
}

/** Firestore row remote URLs ko SQLite baseline ke saath index-align karo (same length). */
export function mergeVoucherRemoteUrlsForEditBaseline(
  baselineUrls: readonly string[],
  firestoreRemoteUrls: readonly string[]
): string[] {
  const remotes = normalizeFormAttachmentUrlList(firestoreRemoteUrls);
  if (remotes.length === 0) return [];
  if (baselineUrls.length === remotes.length) return remotes;
  if (baselineUrls.length === 0) return remotes;
  // Length mismatch — best-effort: remote list as-is for index mapping when lengths match partial
  return remotes;
}

/** Edit save se pehle: SQLite baseline + Firestore HTTPS (index-aligned). */
export async function readVoucherEditAttachmentContext(
  companyId: string,
  voucherId: string
): Promise<{ baselineUrls: string[]; remoteUrls: string[] }> {
  const cid = String(companyId || "").trim();
  const vid = String(voucherId || "").trim();
  if (!cid || !vid) return { baselineUrls: [], remoteUrls: [] };

  let sqliteRow: Record<string, unknown> | null = null;
  try {
    const { getCompanyDocFromBrowserDb } = await import("@/lib/localCompanyDocMirror");
    sqliteRow = (await getCompanyDocFromBrowserDb(cid, "vouchers", vid)) as Record<string, unknown> | null;
  } catch {
    sqliteRow = null;
  }

  const { baselineUrls, remoteUrls: sqliteRemotes } = readVoucherAttachmentBaselineFromRow(sqliteRow);
  let remoteUrls = sqliteRemotes;

  const needsFirestoreRemotes =
    baselineUrls.some((u) => isLocalFileRef(u)) ||
    (remoteUrls.length > 0 && remoteUrls.length < baselineUrls.length) ||
    (baselineUrls.length === 0 && rowHasLegacyUnassignedRemote(sqliteRow)) ||
    baselineUrls.length === 0;

  // Save critical path: under web/APK local-first or the quota pause, NEVER await Firestore here (resource-exhausted
  // => SDK backoff kept "Saving payment..." up 20-40 s on edit). SQLite baseline only; otherwise cap at 1.5 s.
  let skipFsRemotes = false;
  try {
    const [{ apkEmbeddedSqliteFirstWritesPreferred }, { isServerQuotaHoldActive }] = await Promise.all([
      import("@/lib/apkOnlineFirestoreWritePolicy"),
      import("@/lib/serverQuotaHold"),
    ]);
    skipFsRemotes = apkEmbeddedSqliteFirstWritesPreferred() || isServerQuotaHoldActive();
  } catch {
    /* ignore */
  }
  if (!skipFsRemotes && needsFirestoreRemotes && typeof navigator !== "undefined" && navigator.onLine !== false) {
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { firestore } = await import("@/lib/firebase");
      const { resolveAuthoritativeFirestoreCompanyId } = await import(
        "@/lib/resolveAuthoritativeFirestoreCompanyId"
      );
      const fsId = await resolveAuthoritativeFirestoreCompanyId(cid);
      const snap = await Promise.race([
        getDoc(doc(firestore, `companies/${fsId}/vouchers`, vid)),
        new Promise<null>((r) => setTimeout(() => r(null), 1500)),
      ]);
      if (snap && snap.exists()) {
        const fsRemotes = readVoucherAttachmentBaselineFromRow(snap.data() as Record<string, unknown>).remoteUrls;
        remoteUrls = mergeVoucherRemoteUrlsForEditBaseline(baselineUrls, fsRemotes);
      }
    } catch {
      /* sqlite baseline only */
    }
  }

  if (remoteUrls.length === 0 && baselineUrls.every((u) => isRemoteAttachmentUrl(u))) {
    remoteUrls = [...baselineUrls];
  }

  return { baselineUrls, remoteUrls };
}
