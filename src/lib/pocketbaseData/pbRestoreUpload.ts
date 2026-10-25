"use client";

/**
 * Backup restore -> Pocket Ledger Server (PocketBase).
 *
 * Used by the restore dialog when the company goes Online on the Pocket Ledger Server
 * (server-login session, or the admin-selected online server is PocketBase).
 * The server is written directly - no Firestore read or write happens here.
 *
 * Steps: server company (pl_companies) -> company root -> attachments (`local:` -> `pbatt:`)
 * -> every document in batches -> (replace) remove server rows the backup does not have.
 */

import { getValidPocketBaseAuth, pbListAll, pbQuote } from "@/lib/pocketbaseData/pbClient";
import { appCollectionForPbRecord, anyDateToMs, PB_DATA_COLLECTIONS } from "@/lib/pocketbaseData/pbMapping";
import { registerPocketBaseCompanyId } from "@/lib/pocketbaseData/pbCompanyRegistry";
import { patchFirebaseLedgerCompanySyncEntry } from "@/lib/firebaseLedgerCompanySyncPrefs";
import {
  ensurePocketBaseCompany,
  pbBatchWrite,
  pbDeviceId,
  pbWriteCompanyRoot,
  type PbBatchOp,
} from "@/lib/pocketbaseData/pbSync";

export type PbRestoreDoc = { coll: string; id: string; data: Record<string, unknown> };

export type PbRestoreProgress = (label: string, detail: string) => void;

/** Small batches: low-end PCs and large vouchers stay well under the request size limit. */
const RESTORE_BATCH_SIZE = 100;

function strOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Creates (or reuses) the company on the Pocket Ledger Server and uploads the restored data.
 * Throws when the server rejects a step; the caller shows the error.
 */
export async function uploadRestoredCompanyToPocketBase(input: {
  companyId: string;
  rootDoc: Record<string, unknown>;
  docs: PbRestoreDoc[];
  /** Replace: server rows of the restored collections that are not in the backup are removed. */
  replaceCurrent: boolean;
  onProgress?: PbRestoreProgress;
}): Promise<{ uploaded: number; removed: number; attachments: number }> {
  const companyId = String(input.companyId || "").trim();
  if (!companyId) throw new Error("Pocket Ledger Server: missing company id.");
  if (!getValidPocketBaseAuth()) {
    throw new Error("Pocket Ledger Server: sign in to the server first, then restore again.");
  }
  const progress = input.onProgress ?? (() => {});
  const root = input.rootDoc;

  registerPocketBaseCompanyId(companyId);
  patchFirebaseLedgerCompanySyncEntry(companyId, { data: true });

  progress("Creating company on Pocket Ledger Server", String(root.name ?? ""));
  const pbCompanyId = await ensurePocketBaseCompany(companyId, {
    createIfMissing: true,
    info: {
      name: strOrUndefined(root.name),
      pan: strOrUndefined(root.pan),
      country: strOrUndefined(root.country),
      currencyCode: strOrUndefined(root.currencyCode),
      fiscalYearStartMs: anyDateToMs(root.fiscalYearStart),
      fiscalYearEndMs: anyDateToMs(root.fiscalYearEnd),
      planId: strOrUndefined(root.planId),
    },
  });
  await pbWriteCompanyRoot(companyId, root, "set", { throwOnError: true });

  // Attachments restored as `local:` files -> server files (`pbatt:` links).
  let attachments = 0;
  const docs: PbRestoreDoc[] = [];
  const convertedLocal: Array<{ doc: PbRestoreDoc; map: Map<string, string> }> = [];
  const uploadedPendingIds: string[] = [];
  const withFiles = input.docs.filter((d) => JSON.stringify(d.data).includes('"local:'));
  if (withFiles.length) {
    const [{ convertLocalRefsForPocketBase }, { getPendingPayloadForLocalRef }] = await Promise.all([
      import("@/lib/pocketbaseData/pbAttachments"),
      import("@/lib/localPendingFiles"),
    ]);
    const deviceId = pbDeviceId();
    let n = 0;
    const byKey = new Map<string, PbRestoreDoc>();
    for (const d of withFiles) {
      n += 1;
      progress("Uploading attachments to Pocket Ledger Server", `${n} / ${withFiles.length}`);
      const conversion = await convertLocalRefsForPocketBase({
        pbCompanyId,
        coll: d.coll,
        docId: d.id,
        data: d.data,
        deviceId,
        getPending: getPendingPayloadForLocalRef,
      });
      const next = { coll: d.coll, id: d.id, data: conversion.data };
      byKey.set(`${d.coll}/${d.id}`, next);
      if (conversion.converted.size) {
        attachments += conversion.converted.size;
        convertedLocal.push({ doc: next, map: conversion.converted });
      }
      uploadedPendingIds.push(...conversion.uploadedPendingIds);
    }
    for (const d of input.docs) docs.push(byKey.get(`${d.coll}/${d.id}`) ?? d);
  } else {
    docs.push(...input.docs);
  }

  // Documents, in small all-or-nothing batches.
  let uploaded = 0;
  for (let i = 0; i < docs.length; i += RESTORE_BATCH_SIZE) {
    const chunk = docs.slice(i, i + RESTORE_BATCH_SIZE);
    const ops: PbBatchOp[] = chunk.map((d) => ({ coll: d.coll, id: d.id, mode: "set", data: d.data }));
    await pbBatchWrite(companyId, ops);
    uploaded += chunk.length;
    progress("Uploading to Pocket Ledger Server", `${uploaded} / ${docs.length} record(s)`);
  }

  // Replace: rows of the restored collections that the backup does not contain are removed.
  let removed = 0;
  if (input.replaceCurrent) {
    progress("Cleaning old server records", "");
    const keep = new Map<string, Set<string>>();
    for (const d of docs) {
      const s = keep.get(d.coll) ?? new Set<string>();
      s.add(d.id);
      keep.set(d.coll, s);
    }
    const stale: PbBatchOp[] = [];
    for (const collection of PB_DATA_COLLECTIONS) {
      const recs = await pbListAll<Record<string, unknown>>(
        collection,
        `company = ${pbQuote(pbCompanyId)} && deleted = false`,
        { fields: "id,app_id,kind,coll" }
      );
      for (const rec of recs) {
        const appColl = appCollectionForPbRecord(collection, rec);
        const appId = String(rec.app_id ?? "").trim();
        if (!appColl || !appId) continue;
        const kept = keep.get(appColl);
        // Only collections the backup restored; anything else on the server is left alone.
        if (!kept || kept.has(appId)) continue;
        stale.push({ coll: appColl, id: appId, mode: "delete" });
      }
    }
    for (let i = 0; i < stale.length; i += RESTORE_BATCH_SIZE) {
      const chunk = stale.slice(i, i + RESTORE_BATCH_SIZE);
      await pbBatchWrite(companyId, chunk);
      removed += chunk.length;
      progress("Cleaning old server records", `${removed} / ${stale.length}`);
    }
  }

  // Local copy gets the server attachment links; uploaded pending bytes can go.
  if (convertedLocal.length) {
    try {
      const [{ getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb }, { replaceRefsDeep }] = await Promise.all([
        import("@/lib/localCompanyDocMirror"),
        import("@/lib/pocketbaseData/pbAttachments"),
      ]);
      for (const { doc, map } of convertedLocal) {
        const local = (await getCompanyDocFromBrowserDb(companyId, doc.coll, doc.id, {
          includeDeleted: true,
        })) as Record<string, unknown> | null;
        if (!local) continue;
        await upsertCompanyDocInBrowserDb(
          companyId,
          doc.coll,
          doc.id,
          { ...replaceRefsDeep(local, map), id: doc.id },
          { force: true, notify: false, skipPlanMutationGate: true, skipCloudSyncEnqueue: true }
        );
      }
    } catch {
      /* next server pull brings the links */
    }
  }
  if (uploadedPendingIds.length) {
    try {
      const { removePendingFile } = await import("@/lib/localPendingFiles");
      for (const id of uploadedPendingIds) await removePendingFile(id);
    } catch {
      /* ignore */
    }
  }

  return { uploaded, removed, attachments };
}